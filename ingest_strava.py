"""Strava ingestion for run-coach.

Pulls activities from the Strava API and upserts them into the shared
`activities` table (see schema.sql / db.py). Uses its own OAuth token
handling so it can run unattended (e.g. from cron) without depending on
the `strava` MCP server being alive.

Usage:
    python ingest_strava.py

Requires STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env (same Strava
API app used by the strava MCP server). On first run, if STRAVA_REFRESH_TOKEN
isn't set yet, it is seeded from the strava MCP server's own stored token
at ~/.config/strava-mcp/config.json if present; otherwise this script
walks you through Strava's OAuth flow via a short-lived localhost server.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import dotenv_values, load_dotenv

import db
import hr_zones
from strava_client import (
    ACTIVITIES_URL,
    ENV_PATH,
    ensure_env_file,
    get_access_token,
    get_activity_best_efforts,
    get_activity_streams,
    get_athlete_hr_zones,
    get_gear,
)

# Strava activity "type" values that represent running (sport_type is the
# newer, more granular field; `type` is the legacy one — we normalize both).
_RUN_TYPES = {"run", "trailrun", "trail_run"}

# Only the standard race distances the dashboard reports on -- Strava returns
# many more (400m, 1K, 1 mile, ...) that we don't need to store.
_BEST_EFFORT_NAMES = {"5K", "10K", "Half-Marathon", "Marathon"}


def _sync_best_efforts(conn, access_token: str, activity_ids: list[str]) -> int:
    """Fetch and store Strava's official best_efforts for each given
    `activities.id`. Best-effort in the error-handling sense too: a rate
    limit or a single bad activity stops the loop rather than failing the
    whole sync, since this is a nice-to-have layered on top of the core
    activity sync above."""
    synced = 0
    for activity_id in activity_ids:
        external_id = activity_id.split("_", 1)[1]
        try:
            efforts = get_activity_best_efforts(access_token, external_id)
        except RuntimeError:
            break  # rate limited
        for e in efforts:
            if e.get("name") not in _BEST_EFFORT_NAMES:
                continue
            db.upsert_best_effort(conn, {
                "activity_id": activity_id,
                "name": e["name"],
                "distance_m": e.get("distance"),
                "moving_time_s": e.get("moving_time"),
                "elapsed_time_s": e.get("elapsed_time"),
                "start_date": e.get("start_date"),
            })
        synced += 1
    conn.commit()
    return synced


def backfill_best_efforts() -> None:
    """One-off (or re-run-when-needed) catch-up: fetch best_efforts for every
    run/trail_run activity already in the DB, not just newly-synced ones.
    Needed once when this feature was added, since `sync()` below only does
    this for activities it just inserted."""
    load_dotenv(ENV_PATH)
    access_token = get_access_token()
    conn = db.get_connection()
    ids = [
        r["id"] for r in conn.execute(
            "SELECT id FROM activities WHERE source = 'strava' AND sport_type IN ('run', 'trail_run')"
        ).fetchall()
    ]
    synced = _sync_best_efforts(conn, access_token, ids)
    conn.close()
    print(f"Best-efforts backfill: {synced}/{len(ids)} activities processed.")


def _sync_hr_zones(conn, access_token: str) -> bool:
    try:
        zones = get_athlete_hr_zones(access_token)
    except (RuntimeError, requests.HTTPError):
        return False
    if zones:
        db.replace_hr_zones(conn, hr_zones.strava_zones_to_rows(zones))
        conn.commit()
    return bool(zones)


def _sync_hr_series(conn, access_token: str, limit: int | None = None) -> int:
    """Cache a compact HR series for runs that don't have one yet, newest
    first (one streams call per run). Capped per sync and stops at the first
    rate limit, so the backlog is worked through over successive syncs
    instead of burning the whole 15-minute Strava quota at once."""
    ids = [
        r["id"] for r in conn.execute(
            """SELECT a.id FROM activities a
               LEFT JOIN activity_hr_series s ON s.activity_id = a.id
               WHERE a.source = 'strava' AND a.sport_type IN ('run', 'trail_run') AND s.activity_id IS NULL
               ORDER BY a.start_time DESC"""
        ).fetchall()
    ]
    synced = 0
    for activity_id in ids[:limit]:
        try:
            streams = get_activity_streams(access_token, activity_id.split("_", 1)[1])
        except (RuntimeError, requests.HTTPError):
            break
        db.upsert_hr_series(conn, activity_id, hr_zones.SERIES_STEP_S, hr_zones.resample_hr(streams))
        conn.commit()
        synced += 1
    return synced


def backfill_hr_series() -> None:
    """Fetch HR series for every run still missing one (stops at Strava's
    rate limit -- just re-run it 15 minutes later to continue)."""
    load_dotenv(ENV_PATH)
    access_token = get_access_token()
    conn = db.get_connection()
    _sync_hr_zones(conn, access_token)
    synced = _sync_hr_series(conn, access_token)
    missing = conn.execute(
        """SELECT COUNT(*) FROM activities a LEFT JOIN activity_hr_series s ON s.activity_id = a.id
           WHERE a.source = 'strava' AND a.sport_type IN ('run', 'trail_run') AND s.activity_id IS NULL"""
    ).fetchone()[0]
    conn.close()
    print(f"HR series backfill: {synced} run(s) fetched, {missing} still missing.")


def _normalize_sport_type(activity: dict) -> str:
    raw = activity.get("sport_type") or activity.get("type") or ""
    return raw.lower()


def _to_row(activity: dict) -> dict:
    sport_type = _normalize_sport_type(activity)
    distance_m = activity.get("distance")
    moving_time_s = activity.get("moving_time")
    avg_pace_s_per_km = None
    if sport_type in _RUN_TYPES and distance_m:
        avg_pace_s_per_km = moving_time_s / (distance_m / 1000)

    # Strava's average_cadence for runs counts one leg's strides/min (like
    # cycling RPM), not total steps/min -- roughly half of what a runner
    # would call their cadence and what Garmin's own field reports. Double
    # it here so avg_cadence means the same thing (true steps/min) no matter
    # which source an activity came from.
    avg_cadence = activity.get("average_cadence")
    if sport_type in _RUN_TYPES and avg_cadence is not None:
        avg_cadence *= 2

    return {
        "id": f"strava_{activity['id']}",
        "source": "strava",
        "external_id": str(activity["id"]),
        "name": activity.get("name"),
        "sport_type": sport_type,
        "start_time": activity.get("start_date"),  # already ISO 8601 UTC from Strava
        "timezone": activity.get("timezone"),
        "distance_m": distance_m,
        "moving_time_s": moving_time_s,
        "elapsed_time_s": activity.get("elapsed_time"),
        "elevation_gain_m": activity.get("total_elevation_gain"),
        "avg_speed_mps": activity.get("average_speed"),
        "avg_pace_s_per_km": avg_pace_s_per_km,
        "avg_hr": activity.get("average_heartrate"),
        "max_hr": activity.get("max_heartrate"),
        "avg_cadence": avg_cadence,
        "calories": activity.get("calories"),
        "perceived_effort": activity.get("suffer_score"),
        "gear_id": activity.get("gear_id"),
        "raw_json": json.dumps(activity),
    }


def sync() -> None:
    load_dotenv(ENV_PATH)
    try:
        access_token = get_access_token()
    except RuntimeError as exc:
        sys.exit(str(exc))
    headers = {"Authorization": f"Bearer {access_token}"}

    conn = db.get_connection()
    cursor = db.get_sync_cursor(conn, "strava")
    after_epoch = None
    if cursor:
        after_epoch = int(datetime.fromisoformat(cursor.replace("Z", "+00:00")).timestamp())

    page = 1
    per_page = 100
    total = 0
    latest_start = cursor
    earliest_start = None
    gear_ids = set()
    new_run_ids = []

    while True:
        params = {"page": page, "per_page": per_page}
        if after_epoch:
            params["after"] = after_epoch
        resp = requests.get(ACTIVITIES_URL, headers=headers, params=params, timeout=30)
        if resp.status_code == 429:
            sys.exit(
                "Strava API rate limit exceeded (429). This is common right after creating "
                "a new app. Wait 15 minutes and re-run."
            )
        resp.raise_for_status()
        activities = resp.json()
        if not activities:
            break

        for activity in activities:
            row = _to_row(activity)
            db.upsert_activity(conn, row)
            total += 1
            start = row["start_time"]
            if start and (latest_start is None or start > latest_start):
                latest_start = start
            if start and (earliest_start is None or start < earliest_start):
                earliest_start = start
            if row["gear_id"]:
                gear_ids.add(row["gear_id"])
            if row["sport_type"] in _RUN_TYPES:
                new_run_ids.append(row["id"])

        conn.commit()
        if len(activities) < per_page:
            break
        page += 1

    efforts_synced = _sync_best_efforts(conn, access_token, new_run_ids)
    _sync_hr_zones(conn, access_token)
    hr_synced = _sync_hr_series(conn, access_token, limit=30)

    if latest_start:
        db.set_sync_cursor(conn, "strava", latest_start)
        conn.commit()

    # Also refresh gear seen on any run we already have, not just this sync's
    # batch, since a shoe's total distance keeps climbing after the activity
    # that introduced it to our DB was ingested.
    gear_ids |= {
        r["gear_id"] for r in conn.execute(
            "SELECT DISTINCT gear_id FROM activities WHERE gear_id IS NOT NULL"
        ).fetchall()
    }
    gear_synced = 0
    for gear_id in gear_ids:
        try:
            gear = get_gear(access_token, gear_id)
        except RuntimeError:
            break  # rate limited -- stop, not worth failing the whole sync over gear
        if gear:
            db.upsert_gear(conn, {
                "id": gear_id,
                "name": gear.get("name"),
                "distance_m": gear.get("distance"),
                "retired": int(bool(gear.get("retired"))),
            })
            gear_synced += 1
    conn.commit()

    conn.close()

    if total == 0:
        print(f"Strava sync: no new activities ({gear_synced} gear record(s) refreshed, HR data for {hr_synced} run(s)).")
    else:
        span = f"{earliest_start} to {latest_start}" if earliest_start else latest_start
        print(
            f"Strava sync: {total} activities upserted ({span}), {gear_synced} gear record(s) refreshed, "
            f"best efforts fetched for {efforts_synced}/{len(new_run_ids)} new run(s), HR data for {hr_synced} run(s)."
        )


if __name__ == "__main__":
    ensure_env_file()
    if len(sys.argv) > 1 and sys.argv[1] == "--backfill-efforts":
        backfill_best_efforts()
    elif len(sys.argv) > 1 and sys.argv[1] == "--backfill-hr":
        backfill_hr_series()
    else:
        sync()
