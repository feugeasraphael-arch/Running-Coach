"""Garmin ingestion for run-coach.

Pulls daily wellness metrics (resting HR, HRV, body battery, training
readiness/status, VO2max, sleep, stress) and non-running activities from
Garmin Connect, and upserts them into the shared `wellness` / `activities`
tables (see schema.sql / db.py). Runs are Strava-is-source-of-truth for
running activities: Garmin activities whose type looks like a run are
skipped here to avoid double-counting.

Uses the unofficial `garminconnect` package (thin wrapper over `garth`),
which authenticates with your regular Garmin Connect email/password.
Session tokens are cached in .garminconnect/ (gitignored) so subsequent
runs don't re-authenticate.

Usage:
    python ingest_garmin.py [--days N]

Requires GARMIN_EMAIL and GARMIN_PASSWORD in .env.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
import os

from db import get_connection, upsert_activity, upsert_wellness, get_sync_cursor, set_sync_cursor

TOKENSTORE = str(Path(__file__).parent / ".garminconnect")
DEFAULT_BACKFILL_DAYS = 30

# Garmin activity typeKeys that represent running — skipped here since
# Strava is the source of truth for runs (see ingest_strava.py).
RUNNING_TYPE_MARKERS = ("run",)


def _safe(fn, *args, **kwargs) -> Any:
    """Call a Garmin API method, swallowing errors/empty responses to None.

    Wellness endpoints routinely 404 or return [] / null for days with no
    data (no device worn, feature unsupported, etc.) — that's normal, not
    a failure, so every field in this module is best-effort.
    """
    try:
        result = fn(*args, **kwargs)
        return result if result else None
    except Exception:
        return None


def _dig(obj: Any, *path, default=None):
    """Nested dict/list lookup that returns `default` on any missing key/index/type mismatch."""
    cur = obj
    for key in path:
        try:
            cur = cur[key]
        except (KeyError, IndexError, TypeError):
            return default
        if cur is None:
            return default
    return cur


def fetch_wellness_day(client, day: date) -> Optional[dict]:
    d = day.isoformat()

    rhr_resp = _safe(client.get_rhr_day, d)
    resting_hr = _dig(rhr_resp, "allMetrics", "metricsMap", "WELLNESS_RESTING_HEART_RATE", 0, "value")

    hrv_resp = _safe(client.get_hrv_data, d)
    hrv_ms = _dig(hrv_resp, "hrvSummary", "lastNightAvg") if isinstance(hrv_resp, dict) else None

    bb_resp = _safe(client.get_body_battery, d)
    body_battery_high = body_battery_low = None
    if isinstance(bb_resp, list) and bb_resp:
        values = [v[1] for v in (bb_resp[0].get("bodyBatteryValuesArray") or []) if v and v[1] is not None]
        if values:
            body_battery_high, body_battery_low = max(values), min(values)

    tr_resp = _safe(client.get_training_readiness, d)
    training_readiness = _dig(tr_resp, 0, "score") if isinstance(tr_resp, list) else None

    ts_resp = _safe(client.get_training_status, d)
    training_status = None
    vo2max = _dig(ts_resp, "mostRecentVO2Max", "generic", "vo2MaxPreciseValue") or \
        _dig(ts_resp, "mostRecentVO2Max", "generic", "vo2MaxValue")
    most_recent_status = _dig(ts_resp, "mostRecentTrainingStatus")
    if isinstance(most_recent_status, dict):
        # Shape varies by account/device; grab whatever looks like the status label.
        for candidate_key in ("latestTrainingStatus", "trainingStatus", "trainingStatusFeedbackPhrase"):
            if most_recent_status.get(candidate_key):
                training_status = str(most_recent_status[candidate_key])
                break
    elif most_recent_status:
        training_status = str(most_recent_status)

    if vo2max is None:
        mm_resp = _safe(client.get_max_metrics, d)
        vo2max = _dig(mm_resp, 0, "generic", "vo2MaxPreciseValue") or _dig(mm_resp, 0, "generic", "vo2MaxValue")

    sleep_resp = _safe(client.get_sleep_data, d)
    sleep_dto = _dig(sleep_resp, "dailySleepDTO") or {}
    sleep_duration_s = sleep_dto.get("sleepTimeSeconds")
    sleep_score = _dig(sleep_resp, "sleepScores", "overall", "value") or \
        _dig(sleep_dto, "sleepScores", "overall", "value")

    stress_resp = _safe(client.get_stress_data, d)
    stress_avg = stress_resp.get("avgStressLevel") if isinstance(stress_resp, dict) else None

    row = {
        "date": d,
        "resting_hr": resting_hr,
        "hrv_ms": hrv_ms,
        "body_battery_high": body_battery_high,
        "body_battery_low": body_battery_low,
        "training_readiness": training_readiness,
        "training_status": training_status,
        "vo2max": vo2max,
        "sleep_score": sleep_score,
        "sleep_duration_s": sleep_duration_s,
        "stress_avg": stress_avg,
    }

    if all(v is None for k, v in row.items() if k != "date"):
        return None  # nothing at all for this day — don't clutter the table

    row["raw_json"] = json.dumps({
        "rhr": rhr_resp, "hrv": hrv_resp, "body_battery": bb_resp,
        "training_readiness": tr_resp, "training_status": ts_resp,
        "sleep": sleep_resp, "stress": stress_resp,
    })
    return row


def _parse_garmin_datetime(s: str) -> str:
    # Garmin returns "YYYY-MM-DD HH:MM:SS" in GMT for startTimeGMT.
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_non_running_activities(client, start_day: date, end_day: date) -> tuple[list[dict], int]:
    raw = client.get_activities_by_date(start_day.isoformat(), end_day.isoformat()) or []
    rows, skipped_running = [], 0

    for a in raw:
        sport_type = ((a.get("activityType") or {}).get("typeKey") or "").lower()
        if any(marker in sport_type for marker in RUNNING_TYPE_MARKERS):
            skipped_running += 1
            continue

        distance_m = a.get("distance")
        moving_time_s = a.get("movingDuration") or a.get("duration")
        avg_pace_s_per_km = (
            moving_time_s / (distance_m / 1000)
            if distance_m and moving_time_s and distance_m > 0 else None
        )
        rows.append({
            "id": f"garmin_{a['activityId']}",
            "source": "garmin",
            "external_id": str(a["activityId"]),
            "name": a.get("activityName"),
            "sport_type": sport_type or None,
            "start_time": _parse_garmin_datetime(a["startTimeGMT"]),
            "timezone": str(a.get("timeZoneId")) if a.get("timeZoneId") is not None else None,
            "distance_m": distance_m,
            "moving_time_s": round(moving_time_s) if moving_time_s else None,
            "elapsed_time_s": round(a["elapsedDuration"]) if a.get("elapsedDuration") else None,
            "elevation_gain_m": a.get("elevationGain"),
            "avg_speed_mps": a.get("averageSpeed"),
            "avg_pace_s_per_km": avg_pace_s_per_km,
            "avg_hr": a.get("averageHR"),
            "max_hr": a.get("maxHR"),
            "avg_cadence": a.get("averageRunningCadenceInStepsPerMinute") or a.get("averageBikingCadenceInRevPerMinute"),
            "calories": a.get("calories"),
            "perceived_effort": None,  # Garmin's list endpoint has no suffer-score equivalent
            "raw_json": json.dumps(a),
        })
    return rows, skipped_running


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=DEFAULT_BACKFILL_DAYS,
                        help=f"Days to backfill on first run (default {DEFAULT_BACKFILL_DAYS})")
    args = parser.parse_args()

    load_dotenv()
    email, password = os.environ.get("GARMIN_EMAIL"), os.environ.get("GARMIN_PASSWORD")
    if not email or not password:
        print("Missing GARMIN_EMAIL/GARMIN_PASSWORD in .env", file=sys.stderr)
        sys.exit(1)

    from garminconnect import Garmin  # imported here so --help works without the dep installed

    client = Garmin(email, password)
    try:
        client.login(TOKENSTORE)
    except Exception:
        try:
            client.login()
            client.garth.dump(TOKENSTORE)
        except Exception as e:
            print(f"Garmin login failed: {type(e).__name__}: {e}", file=sys.stderr)
            sys.exit(1)

    conn = get_connection()
    cursor = get_sync_cursor(conn, "garmin")
    start_day = date.fromisoformat(cursor) + timedelta(days=1) if cursor else date.today() - timedelta(days=args.days)
    end_day = date.today()

    if start_day > end_day:
        print("Already up to date.")
        return

    wellness_written = 0
    day = start_day
    while day <= end_day:
        row = fetch_wellness_day(client, day)
        if row:
            upsert_wellness(conn, row)
            wellness_written += 1
        day += timedelta(days=1)

    activity_rows, skipped_running = fetch_non_running_activities(client, start_day, end_day)
    for row in activity_rows:
        upsert_activity(conn, row)

    set_sync_cursor(conn, "garmin", end_day.isoformat())
    conn.commit()
    conn.close()

    print(
        f"Garmin sync {start_day} -> {end_day}: "
        f"{wellness_written} wellness day(s) written, "
        f"{len(activity_rows)} non-running activities written "
        f"({skipped_running} running activities skipped, Strava is source of truth for those)."
    )


if __name__ == "__main__":
    main()
