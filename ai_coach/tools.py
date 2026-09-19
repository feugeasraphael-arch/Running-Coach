"""Read-only tools the coach model can call to look at the athlete's data.

Every tool wraps an existing analytics function (coach.py, effort.py,
activity_insights via the activity router) so numbers always come from the
same code the dashboard uses -- the model explains them, it never computes
or remembers them.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any, Callable

import coach
from api.deps import db


def _round(obj: Any) -> Any:
    """Trim float noise so tool results cost fewer tokens."""
    if isinstance(obj, float):
        return round(obj, 2)
    if isinstance(obj, dict):
        return {k: _round(v) for k, v in obj.items() if k != "raw_json"}
    if isinstance(obj, list):
        return [_round(v) for v in obj]
    return obj


def _with_conn(fn: Callable, *args: Any) -> Any:
    with db() as conn:
        return fn(conn, *args)


def _clamp(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


# --- tool implementations -------------------------------------------------

def get_coach_summary(_: dict) -> Any:
    return _with_conn(coach.get_coach_summary)


def get_recovery(_: dict) -> Any:
    return _with_conn(coach.get_recovery_status)


def get_wellness_trend(args: dict) -> Any:
    return _with_conn(coach.get_wellness_trend, _clamp(args.get("days"), 1, 180, 28))


def get_training_load(args: dict) -> Any:
    weeks = _clamp(args.get("weeks"), 1, 104, 12)
    with db() as conn:
        return {
            "acwr": coach.compute_acwr(conn),
            "weekly_mileage": coach.get_weekly_mileage(conn, weeks),
            "weekly_pace_and_hr": coach.get_pace_trend(conn, weeks),
            "cadence": coach.get_cadence_trend(conn, weeks),
        }


def get_training_plan(args: dict) -> Any:
    return _with_conn(
        coach.get_plan_status,
        _clamp(args.get("weeks_back"), 0, 26, 2),
        _clamp(args.get("weeks_forward"), 0, 12, 2),
    )


def list_activities(args: dict) -> Any:
    limit = _clamp(args.get("limit"), 1, 50, 15)
    days = _clamp(args.get("days"), 1, 3650, 60)
    since = (date.today() - timedelta(days=days)).isoformat()
    with db() as conn:
        rows = conn.execute(
            """SELECT id, name, sport_type, start_time, distance_m, moving_time_s, elevation_gain_m,
                      avg_pace_s_per_km, avg_hr, max_hr, avg_cadence, perceived_effort
               FROM activities WHERE start_time >= ? ORDER BY start_time DESC LIMIT ?""",
            (since, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def get_activity_detail(args: dict) -> Any:
    from api.routers.activities import activity_detail  # local: avoids a router import cycle at startup

    activity_id = str(args.get("activity_id") or "")
    detail = activity_detail(activity_id)
    detail.pop("streams", None)  # thousands of samples; splits + commentary carry the useful shape
    return detail


def get_race_predictions(_: dict) -> Any:
    return _with_conn(coach.get_race_predictions, 120)


def get_gear(_: dict) -> Any:
    return _with_conn(coach.get_gear_status)


# --- registry ---------------------------------------------------------------

def _spec(name: str, description: str, properties: dict | None = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties or {}, "required": []},
        },
    }


TOOLS: dict[str, tuple[dict, Callable[[dict], Any], str]] = {
    "get_coach_summary": (
        _spec("get_coach_summary", "Snapshot: ACWR load ratio, recovery status, last 4 weeks of mileage/pace, cadence, gear and the rule-based recommendation."),
        get_coach_summary,
        "Reading your coach summary",
    ),
    "get_recovery": (
        _spec("get_recovery", "Latest complete day of Garmin recovery (training readiness, HRV, body battery) vs. the prior 7-day average."),
        get_recovery,
        "Checking your recovery",
    ),
    "get_wellness_trend": (
        _spec(
            "get_wellness_trend",
            "Daily Garmin wellness series: resting/avg HR, HRV, body battery high/low, training readiness, VO2max, sleep hours/score, stress.",
            {"days": {"type": "integer", "description": "How many days back (1-180, default 28)."}},
        ),
        get_wellness_trend,
        "Reading your wellness data",
    ),
    "get_training_load": (
        _spec(
            "get_training_load",
            "Training load: current ACWR (acute 7d km vs chronic 28d weekly avg), weekly mileage and run counts, weekly average pace (s/km) and HR, weekly cadence.",
            {"weeks": {"type": "integer", "description": "Weeks of history (1-104, default 12)."}},
        ),
        get_training_load,
        "Analysing your training load",
    ),
    "get_training_plan": (
        _spec(
            "get_training_plan",
            "Planned workouts (type, targets, notes) vs. what was actually run (completed/partial/missed/upcoming), adherence rate, next workout and rule-based advice.",
            {
                "weeks_back": {"type": "integer", "description": "Past weeks to include (0-26, default 2)."},
                "weeks_forward": {"type": "integer", "description": "Future weeks to include (0-12, default 2)."},
            },
        ),
        get_training_plan,
        "Reading your training plan",
    ),
    "list_activities": (
        _spec(
            "list_activities",
            "Recent activities, newest first, with distance (m), moving time (s), pace (s/km), avg/max HR, cadence, elevation and perceived effort.",
            {
                "days": {"type": "integer", "description": "Look back this many days (default 60)."},
                "limit": {"type": "integer", "description": "Max activities (1-50, default 15)."},
            },
        ),
        list_activities,
        "Reading your recent activities",
    ),
    "get_activity_detail": (
        _spec(
            "get_activity_detail",
            "One activity in depth: full stats, laps / detected work-recovery intervals / km splits with pace and HR, and rule-based commentary vs. similar recent runs.",
            {"activity_id": {"type": "string", "description": "Activity id from list_activities, e.g. 'strava_123'."}},
        ),
        get_activity_detail,
        "Analysing the session",
    ),
    "get_race_predictions": (
        _spec("get_race_predictions", "All-time PRs for 5K/10K/half/marathon and Riegel-formula predictions from the best effort of the last 120 days."),
        get_race_predictions,
        "Reading your race predictions",
    ),
    "get_gear": (
        _spec("get_gear", "Shoe mileage and replacement flags."),
        get_gear,
        "Checking your shoes",
    ),
}

TOOL_SPECS = [spec for spec, _, _ in TOOLS.values()]
# Keeps a multi-tool question well under the account's 20k tokens/minute limit.
MAX_RESULT_CHARS = 8_000


def run_tool(name: str, raw_args: str) -> str:
    """Execute a tool call and return a JSON string for the model. Errors are
    returned to the model as data (so it can say what's missing) rather
    than raised."""
    if name not in TOOLS:
        return json.dumps({"error": f"Unknown tool {name}"})
    try:
        args = json.loads(raw_args) if raw_args else {}
        if not isinstance(args, dict):
            args = {}
    except ValueError:
        args = {}
    try:
        result = TOOLS[name][1](args)
    except Exception as exc:  # noqa: BLE001 - surfaced to the model, not the user
        return json.dumps({"error": f"{type(exc).__name__}: {exc}"})
    text = json.dumps(_round(result), ensure_ascii=False, default=str)
    if len(text) > MAX_RESULT_CHARS:
        text = text[:MAX_RESULT_CHARS] + ' …"[truncated — ask for a shorter range]"'
    return text


def tool_label(name: str) -> str:
    return TOOLS[name][2] if name in TOOLS else name
