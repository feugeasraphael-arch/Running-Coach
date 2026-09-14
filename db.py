"""Shared SQLite access for run-coach. All modules import this instead of
opening sqlite3 directly, so there's one place that knows the DB path and
applies schema.sql.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("RUN_COACH_DB", Path(__file__).parent / "run_coach.db"))
SCHEMA_PATH = Path(__file__).parent / "schema.sql"


# Columns added after the initial release. `CREATE TABLE IF NOT EXISTS` in
# schema.sql doesn't retrofit columns onto a table that already exists on
# disk, so any DB created before a given column was added needs it patched
# in here once.
_ADDED_COLUMNS = {
    "activities": [("gear_id", "TEXT")],
    "wellness": [
        ("sleep_deep_s", "INTEGER"),
        ("sleep_light_s", "INTEGER"),
        ("sleep_rem_s", "INTEGER"),
        ("sleep_awake_s", "INTEGER"),
        ("sleep_avg_respiration", "REAL"),
        ("sleep_avg_hr", "REAL"),
        ("sleep_avg_stress", "REAL"),
    ],
}


def _migrate(conn: sqlite3.Connection) -> None:
    for table, columns in _ADDED_COLUMNS.items():
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        for name, sql_type in columns:
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA_PATH.read_text())
    _migrate(conn)
    return conn


def upsert_activity(conn: sqlite3.Connection, activity: dict) -> None:
    """activity must match the `activities` table columns (raw_json as a JSON string)."""
    columns = [
        "id", "source", "external_id", "name", "sport_type", "start_time", "timezone",
        "distance_m", "moving_time_s", "elapsed_time_s", "elevation_gain_m",
        "avg_speed_mps", "avg_pace_s_per_km", "avg_hr", "max_hr", "avg_cadence",
        "calories", "perceived_effort", "gear_id", "raw_json",
    ]
    placeholders = ", ".join(f":{c}" for c in columns)
    updates = ", ".join(f"{c}=excluded.{c}" for c in columns if c != "id")
    conn.execute(
        f"""INSERT INTO activities ({", ".join(columns)}) VALUES ({placeholders})
            ON CONFLICT(id) DO UPDATE SET {updates}""",
        {c: activity.get(c) for c in columns},
    )


def upsert_wellness(conn: sqlite3.Connection, day: dict) -> None:
    """day must match the `wellness` table columns (raw_json as a JSON string)."""
    columns = [
        "date", "resting_hr", "avg_hr_day", "max_hr_day", "hrv_ms", "body_battery_high", "body_battery_low",
        "training_readiness", "training_status", "vo2max", "sleep_score",
        "sleep_duration_s", "sleep_deep_s", "sleep_light_s", "sleep_rem_s", "sleep_awake_s",
        "sleep_avg_respiration", "sleep_avg_hr", "sleep_avg_stress", "stress_avg", "raw_json",
    ]
    placeholders = ", ".join(f":{c}" for c in columns)
    updates = ", ".join(f"{c}=excluded.{c}" for c in columns if c != "date")
    conn.execute(
        f"""INSERT INTO wellness ({", ".join(columns)}) VALUES ({placeholders})
            ON CONFLICT(date) DO UPDATE SET {updates}""",
        {c: day.get(c) for c in columns},
    )


def upsert_gear(conn: sqlite3.Connection, gear: dict) -> None:
    """gear must match the `gear` table columns."""
    columns = ["id", "name", "distance_m", "retired"]
    placeholders = ", ".join(f":{c}" for c in columns)
    updates = ", ".join(f"{c}=excluded.{c}" for c in columns if c != "id")
    conn.execute(
        f"""INSERT INTO gear ({", ".join(columns)}, synced_at) VALUES ({placeholders}, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET {updates}, synced_at=excluded.synced_at""",
        {c: gear.get(c) for c in columns},
    )


def upsert_strava_prediction(conn: sqlite3.Connection, prediction: dict) -> None:
    """prediction must match the `strava_predictions` table columns (raw_json as a JSON string)."""
    columns = ["captured_at", "period_date", "distance_label", "predicted_time_s", "raw_json"]
    placeholders = ", ".join(f":{c}" for c in columns)
    updates = ", ".join(f"{c}=excluded.{c}" for c in columns if c not in ("period_date", "distance_label"))
    conn.execute(
        f"""INSERT INTO strava_predictions ({", ".join(columns)}) VALUES ({placeholders})
            ON CONFLICT(period_date, distance_label) DO UPDATE SET {updates}""",
        {c: prediction.get(c) for c in columns},
    )


def get_sync_cursor(conn: sqlite3.Connection, source: str) -> str | None:
    row = conn.execute("SELECT cursor FROM sync_state WHERE source = ?", (source,)).fetchone()
    return row["cursor"] if row else None


def set_sync_cursor(conn: sqlite3.Connection, source: str, cursor: str) -> None:
    conn.execute(
        """INSERT INTO sync_state (source, last_synced_at, cursor)
           VALUES (?, datetime('now'), ?)
           ON CONFLICT(source) DO UPDATE SET last_synced_at=excluded.last_synced_at, cursor=excluded.cursor""",
        (source, cursor),
    )
