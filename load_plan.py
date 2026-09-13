"""Loads plan_data.json into the `planned_workouts` table.

plan_data.json is a periodic export of the training plan from Google
Calendar (feugeasraphael@gmail.com) — Claude re-exports it by hand when the
plan changes (no live Calendar API access from this app). Re-running this
is always safe: it replaces the whole table with the current file contents,
so a workout deleted/moved in the calendar disappears here too on next sync.

Usage:
    python load_plan.py
"""
import json
import sys
from pathlib import Path

from db import get_connection

PLAN_PATH = Path(__file__).parent / "plan_data.json"


def load() -> int:
    if not PLAN_PATH.exists():
        print("No plan_data.json found — nothing to load.")
        return 0

    entries = json.loads(PLAN_PATH.read_text())
    conn = get_connection()
    conn.execute("DELETE FROM planned_workouts")
    for e in entries:
        conn.execute(
            """INSERT INTO planned_workouts
               (date, workout_type, title, planned_distance_km, pace_target, hr_target, notes)
               VALUES (:date, :workout_type, :title, :planned_distance_km, :pace_target, :hr_target, :notes)""",
            e,
        )
    conn.commit()
    conn.close()
    return len(entries)


if __name__ == "__main__":
    n = load()
    print(f"Training plan loaded: {n} planned workouts.")
    sys.exit(0 if n else 1)
