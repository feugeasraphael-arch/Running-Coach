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
from strava_client import ACTIVITIES_URL, ENV_PATH, ensure_env_file, get_access_token

# Strava activity "type" values that represent running (sport_type is the
# newer, more granular field; `type` is the legacy one — we normalize both).
_RUN_TYPES = {"run", "trailrun", "trail_run"}


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
        "avg_cadence": activity.get("average_cadence"),
        "calories": activity.get("calories"),
        "perceived_effort": activity.get("suffer_score"),
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

        conn.commit()
        if len(activities) < per_page:
            break
        page += 1

    if latest_start:
        db.set_sync_cursor(conn, "strava", latest_start)
        conn.commit()

    conn.close()

    if total == 0:
        print("Strava sync: no new activities.")
    else:
        span = f"{earliest_start} to {latest_start}" if earliest_start else latest_start
        print(f"Strava sync: {total} activities upserted ({span}).")


if __name__ == "__main__":
    ensure_env_file()
    sync()
