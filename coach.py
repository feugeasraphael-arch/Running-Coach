"""Analytics / coaching-logic for run-coach.

Pure reads against the SQLite DB (via db.get_connection()). No network
calls, no writes. All thresholds below are rule-of-thumb judgment calls,
called out in comments where they matter, so they're easy to find and tune.
"""
from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import datetime, timedelta


def _parse_dt(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def _iso_week_start(d):
    if isinstance(d, datetime):
        d = d.date()
    return d - timedelta(days=d.weekday())


def get_weekly_mileage(conn, weeks: int = 12) -> list[dict]:
    """Most recent `weeks` ISO weeks (Mon-Sun) of running distance, zero-filled
    for weeks with no runs so callers get a continuous series for charting."""
    rows = conn.execute(
        "SELECT start_time, distance_m FROM activities WHERE sport_type = 'run'"
    ).fetchall()

    by_week = defaultdict(lambda: {"distance_m": 0.0, "num_runs": 0})
    for row in rows:
        key = _iso_week_start(_parse_dt(row["start_time"])).isoformat()
        by_week[key]["distance_m"] += row["distance_m"] or 0.0
        by_week[key]["num_runs"] += 1

    current_week_start = _iso_week_start(datetime.utcnow().date())
    result = []
    for i in range(weeks - 1, -1, -1):
        key = (current_week_start - timedelta(weeks=i)).isoformat()
        agg = by_week.get(key, {"distance_m": 0.0, "num_runs": 0})
        result.append({
            "week_start": key,
            "distance_km": round(agg["distance_m"] / 1000, 2),
            "num_runs": agg["num_runs"],
        })
    return result


def compute_acwr(conn) -> dict:
    """Acute:Chronic Workload Ratio on trailing running distance.
    acute = trailing 7 days, chronic = average weekly distance over trailing 28 days.
    """
    today = datetime.utcnow().date()
    acute_start = today - timedelta(days=7)
    chronic_start = today - timedelta(days=28)

    rows = conn.execute(
        "SELECT start_time, distance_m FROM activities WHERE sport_type = 'run' AND start_time >= ?",
        (chronic_start.isoformat(),),
    ).fetchall()

    acute_km = 0.0
    chronic_km = 0.0
    for row in rows:
        dt = _parse_dt(row["start_time"]).date()
        km = (row["distance_m"] or 0.0) / 1000
        chronic_km += km
        if dt >= acute_start:
            acute_km += km

    chronic_weekly_avg_km = chronic_km / 4  # 28 days = 4 weeks
    ratio = (acute_km / chronic_weekly_avg_km) if chronic_weekly_avg_km > 0 else 0.0

    # Thresholds from the commonly-cited ACWR injury-risk literature
    # (Gabbett 2016 and follow-ons): 0.8-1.3 is the "sweet spot" associated
    # with lowest injury risk; above ~1.5, risk rises sharply. These are
    # population-level heuristics, not fit to this athlete's data -- a
    # guardrail to flag for attention, not a hard rule.
    if chronic_weekly_avg_km == 0:
        flag = "no_data"
    elif ratio < 0.8:
        flag = "undertrained"
    elif ratio <= 1.3:
        flag = "sweet_spot"
    elif ratio <= 1.5:
        flag = "caution"
    else:
        flag = "high_injury_risk"

    return {
        "acute_km": round(acute_km, 2),
        "chronic_km": round(chronic_weekly_avg_km, 2),
        "ratio": round(ratio, 2),
        "flag": flag,
    }


def get_pace_trend(conn, weeks: int = 12) -> list[dict]:
    """Per-week average pace (s/km) and average HR for runs, so pace-per-HR
    (efficiency) trend is visible even as pace alone varies with effort."""
    rows = conn.execute(
        "SELECT start_time, distance_m, moving_time_s, avg_hr FROM activities WHERE sport_type = 'run'"
    ).fetchall()

    by_week = defaultdict(lambda: {"distance_m": 0.0, "moving_time_s": 0, "hr_sum": 0.0, "hr_count": 0})
    for row in rows:
        key = _iso_week_start(_parse_dt(row["start_time"])).isoformat()
        agg = by_week[key]
        agg["distance_m"] += row["distance_m"] or 0.0
        agg["moving_time_s"] += row["moving_time_s"] or 0
        if row["avg_hr"] is not None:
            agg["hr_sum"] += row["avg_hr"]
            agg["hr_count"] += 1

    current_week_start = _iso_week_start(datetime.utcnow().date())
    result = []
    for i in range(weeks - 1, -1, -1):
        key = (current_week_start - timedelta(weeks=i)).isoformat()
        agg = by_week.get(key)
        if not agg or agg["distance_m"] == 0:
            result.append({"week_start": key, "avg_pace_s_per_km": None, "avg_hr": None})
            continue
        avg_pace = agg["moving_time_s"] / (agg["distance_m"] / 1000)
        avg_hr = (agg["hr_sum"] / agg["hr_count"]) if agg["hr_count"] else None
        result.append({
            "week_start": key,
            "avg_pace_s_per_km": round(avg_pace, 1),
            "avg_hr": round(avg_hr, 1) if avg_hr is not None else None,
        })
    return result


def get_recovery_status(conn) -> dict:
    """Latest wellness reading vs. the trailing 7-day average of prior days."""
    rows = conn.execute("SELECT * FROM wellness ORDER BY date DESC LIMIT 8").fetchall()

    if not rows:
        return {"status": "no_data", "detail": "No Garmin wellness data synced yet."}

    latest, prior = rows[0], rows[1:8]

    def avg(field):
        vals = [r[field] for r in prior if r[field] is not None]
        return statistics.mean(vals) if vals else None

    prior_readiness = avg("training_readiness")
    prior_battery = avg("body_battery_high")
    prior_hrv = avg("hrv_ms")

    signals = []
    if latest["training_readiness"] is not None and prior_readiness is not None:
        signals.append(latest["training_readiness"] - prior_readiness)
    if latest["body_battery_high"] is not None and prior_battery is not None:
        signals.append(latest["body_battery_high"] - prior_battery)
    if latest["hrv_ms"] is not None and prior_hrv is not None:
        # HRV moves in much smaller absolute units than the 0-100 scores
        # above; express it as a percent-off-baseline so it's comparable.
        signals.append((latest["hrv_ms"] - prior_hrv) / max(prior_hrv, 1) * 100)

    if not signals:
        status = "no_data"
    else:
        avg_signal = statistics.mean(signals)
        if avg_signal >= 5:
            status = "well_recovered"
        elif avg_signal <= -5:
            status = "fatigued"
        else:
            status = "normal"

    return {
        "status": status,
        "date": latest["date"],
        "training_readiness": latest["training_readiness"],
        "body_battery_high": latest["body_battery_high"],
        "hrv_ms": latest["hrv_ms"],
        "prior_7d_avg_training_readiness": round(prior_readiness, 1) if prior_readiness is not None else None,
        "prior_7d_avg_body_battery_high": round(prior_battery, 1) if prior_battery is not None else None,
        "prior_7d_avg_hrv_ms": round(prior_hrv, 1) if prior_hrv is not None else None,
    }


def get_wellness_trend(conn, days: int = 90) -> list[dict]:
    """Daily wellness history for charting (sleep, body battery, resting HR,
    stress, HRV/readiness where available). Only returns days that actually
    exist in `wellness` — callers should not assume a continuous series."""
    start = (datetime.utcnow().date() - timedelta(days=days)).isoformat()
    rows = conn.execute(
        """SELECT date, resting_hr, hrv_ms, body_battery_high, body_battery_low,
                  training_readiness, vo2max, sleep_score, sleep_duration_s, stress_avg
           FROM wellness WHERE date >= ? ORDER BY date ASC""",
        (start,),
    ).fetchall()
    return [
        {
            "date": r["date"],
            "resting_hr": r["resting_hr"],
            "hrv_ms": r["hrv_ms"],
            "body_battery_high": r["body_battery_high"],
            "body_battery_low": r["body_battery_low"],
            "training_readiness": r["training_readiness"],
            "vo2max": r["vo2max"],
            "sleep_score": r["sleep_score"],
            "sleep_hours": round(r["sleep_duration_s"] / 3600, 2) if r["sleep_duration_s"] else None,
            "stress_avg": r["stress_avg"],
        }
        for r in rows
    ]


def get_coach_summary(conn) -> dict:
    """Everything a dashboard needs in one call: current load/recovery
    status plus a plain-English recommendation. Deliberately simple,
    readable rules rather than a model -- easy to see through and tune.
    """
    acwr = compute_acwr(conn)
    recovery = get_recovery_status(conn)
    weekly = get_weekly_mileage(conn, weeks=4)
    pace_trend = get_pace_trend(conn, weeks=4)

    if acwr["flag"] == "no_data":
        recommendation = "Not enough training history yet to make a call — sync a few weeks of activities first."
    elif acwr["flag"] == "high_injury_risk":
        recommendation = (
            f"Your acute training load is well above your recent average (ACWR {acwr['ratio']}) — "
            "high injury risk. Back off volume/intensity this week."
        )
    elif acwr["flag"] == "caution" and recovery["status"] == "fatigued":
        recommendation = (
            f"Load is elevated (ACWR {acwr['ratio']}) and recovery signals are down — "
            "take an easy day or rest day before adding more."
        )
    elif acwr["flag"] == "caution":
        recommendation = f"Load is a bit elevated (ACWR {acwr['ratio']}). Fine to continue but don't add another jump this week."
    elif acwr["flag"] == "sweet_spot" and recovery["status"] == "fatigued":
        recommendation = "Training load is well balanced, but recovery signals are down — consider an easier day before your next hard session."
    elif acwr["flag"] == "sweet_spot":
        recommendation = "Recovery and training load both look solid — safe to hold or slightly increase volume this week."
    elif acwr["flag"] == "undertrained":
        recommendation = "Recent volume is well below your usual chronic load — room to build back up gradually."
    else:
        recommendation = "Keep monitoring — mixed signals this week."

    return {
        "acwr": acwr,
        "recovery": recovery,
        "recent_weekly_mileage": weekly,
        "recent_pace_trend": pace_trend,
        "recommendation": recommendation,
    }


if __name__ == "__main__":
    import json

    from db import get_connection

    conn = get_connection()
    print(json.dumps(get_coach_summary(conn), indent=2))
