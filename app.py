"""FastAPI dashboard backend for run-coach.

Thin HTTP layer only — all analytics logic lives in coach.py, all storage
access in db.py. This file just wires HTTP requests to those functions and
serves the static frontend.

coach.py contract (verified against the actual implementation):
    get_weekly_mileage(conn, weeks: int) -> list[dict]
        each item: {week_start, distance_km, num_runs}, zero-filled, oldest first
    compute_acwr(conn) -> dict
        {acute_km, chronic_km, ratio, flag}  -- current snapshot only, no history
        flag in {no_data, undertrained, sweet_spot, caution, high_injury_risk}
    get_pace_trend(conn, weeks: int) -> list[dict]
        each item: {week_start, avg_pace_s_per_km, avg_hr}  -- weekly averages, running only
    get_recovery_status(conn) -> dict
        {status, date, training_readiness, body_battery_high, hrv_ms,
         prior_7d_avg_training_readiness, prior_7d_avg_body_battery_high, prior_7d_avg_hrv_ms}
        status in {no_data, well_recovered, fatigued, normal}
    get_coach_summary(conn) -> dict
        {acwr, recovery, recent_weekly_mileage, recent_pace_trend, recommendation}
        recommendation is a full sentence, not a short category label.
    get_wellness_trend(conn, days: int) -> list[dict]
        each item: {date, resting_hr, hrv_ms, body_battery_high, body_battery_low,
                    training_readiness, vo2max, sleep_score, sleep_hours, stress_avg}
        only includes days actually present in `wellness` (not zero-filled)
    get_race_predictions(conn, days: int) -> dict
        {reference: {name, date, distance_m, time_s} | None,
         predictions: [{label, distance_m, real_time_s, real_date, predicted_time_s}, ...]}
    get_plan_status(conn, weeks_back: int, weeks_forward: int) -> dict
        {days: [{date, workout_type, title, planned_distance_km, pace_target, hr_target,
                 notes, status, actual_distance_km, actual_avg_hr}, ...],
         adherence_rate, completed, partial, missed, next_workout, advice}
        status in {completed, partial, missed, upcoming}
"""
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import activity_insights
from db import get_connection
from strava_client import get_access_token, get_activity_laps, get_activity_streams

load_dotenv()

PROJECT_DIR = Path(__file__).parent

try:
    import coach
except ImportError:
    coach = None

app = FastAPI(title="run-coach")


def _no_data(detail: str = "Not synced yet") -> JSONResponse:
    return JSONResponse(status_code=200, content={"status": "no_data", "detail": detail})


def _call(fn_name: str, *args):
    """Call a coach.py function by name, translating any failure (missing
    module, missing function, empty DB, whatever) into a no_data response
    instead of a 500, so the frontend always has something safe to render."""
    if coach is None or not hasattr(coach, fn_name):
        return _no_data("coach.py not available yet")
    conn = get_connection()
    try:
        result = getattr(coach, fn_name)(conn, *args)
        if result is None:
            return _no_data()
        return result
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see docstring
        return _no_data(str(exc))
    finally:
        conn.close()


@app.get("/api/activities")
def list_activities(limit: int = 30):
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, source, name, sport_type, start_time, distance_m, moving_time_s, "
            "elevation_gain_m, avg_pace_s_per_km, avg_hr, max_hr, avg_cadence, calories, "
            "perceived_effort FROM activities ORDER BY start_time DESC LIMIT ?",
            (limit,),
        ).fetchall()
    finally:
        conn.close()
    if not rows:
        return _no_data("No activities synced yet")
    return [dict(r) for r in rows]


@app.get("/api/weekly-mileage")
def weekly_mileage(weeks: int = 12):
    return _call("get_weekly_mileage", weeks)


@app.get("/api/acwr")
def acwr():
    return _call("compute_acwr")


@app.get("/api/pace-trend")
def pace_trend(weeks: int = 12):
    return _call("get_pace_trend", weeks)


@app.get("/api/recovery")
def recovery():
    return _call("get_recovery_status")


@app.get("/api/wellness-trend")
def wellness_trend(days: int = 90):
    return _call("get_wellness_trend", days)


@app.get("/api/race-predictions")
def race_predictions(days: int = 120):
    return _call("get_race_predictions", days)


@app.get("/api/plan-status")
def plan_status(weeks_back: int = 8, weeks_forward: int = 3):
    return _call("get_plan_status", weeks_back, weeks_forward)


@app.post("/api/sync")
def trigger_sync():
    """Runs both ingestion scripts plus a training-plan reload synchronously
    (each is normally a few-second incremental sync) and returns per-source
    pass/fail so the "Update" button can report what happened without a
    background job queue.

    The "plan" leg reloads plan_data.json (Claude's periodic export of the
    Google Calendar training plan — see load_plan.py's docstring for why
    this isn't a live Calendar API call) and recomputes plan status against
    whatever activities were just synced above."""
    results = {}
    for source, script in (("strava", "ingest_strava.py"), ("garmin", "ingest_garmin.py"), ("plan", "load_plan.py")):
        try:
            proc = subprocess.run(
                [sys.executable, str(PROJECT_DIR / script)],
                cwd=str(PROJECT_DIR),
                capture_output=True,
                text=True,
                timeout=300,
            )
            # stdout/stderr are captured as separate buffers, not interleaved
            # chronologically, so concatenating them can put an unrelated
            # stderr warning (e.g. urllib3's LibreSSL notice) after the
            # script's real result line. Prefer stdout (where the actual
            # summary is printed); fall back to stderr, filtered of known
            # noise, only when stdout has nothing (typically a hard failure).
            stdout_lines = [l for l in proc.stdout.strip().splitlines() if l]
            stderr_lines = [
                l for l in proc.stderr.strip().splitlines()
                if l and "NotOpenSSLWarning" not in l and "warnings.warn" not in l
            ]
            if stdout_lines:
                message = stdout_lines[-1]
            elif stderr_lines:
                message = stderr_lines[-1]
            else:
                message = ""
            results[source] = {"ok": proc.returncode == 0, "message": message}
        except subprocess.TimeoutExpired:
            results[source] = {"ok": False, "message": "Timed out after 5 minutes."}
        except Exception as exc:  # noqa: BLE001
            results[source] = {"ok": False, "message": str(exc)}
    return results


@app.get("/api/coach-summary")
def coach_summary():
    return _call("get_coach_summary")


@app.get("/api/activities/{activity_id}/detail")
def activity_detail(activity_id: str):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Activity not found")
        activity = dict(row)

        baseline_runs = []
        if activity.get("sport_type") and activity.get("distance_m"):
            lo, hi = activity["distance_m"] * 0.7, activity["distance_m"] * 1.3
            baseline_rows = conn.execute(
                """SELECT avg_pace_s_per_km, avg_hr, distance_m FROM activities
                   WHERE sport_type = ? AND id != ? AND distance_m BETWEEN ? AND ?
                   ORDER BY start_time DESC LIMIT 10""",
                (activity["sport_type"], activity_id, lo, hi),
            ).fetchall()
            baseline_runs = [dict(r) for r in baseline_rows]
    finally:
        conn.close()

    streams, splits, note = {}, [], None
    if activity["source"] == "strava":
        try:
            token = get_access_token()
            streams = get_activity_streams(token, activity["external_id"])
            raw_laps = get_activity_laps(token, activity["external_id"])
            if raw_laps and len(raw_laps) > 1:
                # Real lap markers (manual or auto-lap) — Strava already
                # computed each lap's own average HR, use those as-is.
                splits = activity_insights.laps_to_splits(raw_laps)
            else:
                # No useful lap markers: try to detect actual work/recovery
                # reps from the pace stream so interval HR isn't averaged
                # across a fixed-km line that cuts through a rep boundary.
                splits = activity_insights.detect_intervals(streams)
                if not splits:
                    splits = activity_insights.splits_from_streams(streams)
        except Exception as exc:  # noqa: BLE001 - surface as a soft note, not a 500
            note = f"Couldn't fetch full detail from Strava right now: {exc}"
    else:
        note = "Detailed streams aren't wired up for Garmin-sourced activities yet — showing summary stats only."

    commentary = activity_insights.generate_commentary(activity, splits, baseline_runs)

    return {
        "activity": activity,
        "streams": streams,
        "splits": splits,
        "commentary": commentary,
        "note": note,
    }


static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
