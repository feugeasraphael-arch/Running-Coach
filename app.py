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
"""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from db import get_connection

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


@app.get("/api/coach-summary")
def coach_summary():
    return _call("get_coach_summary")


static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
