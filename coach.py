"""Analytics / coaching-logic for run-coach.

Pure reads against the SQLite DB (via db.get_connection()). No network
calls, no writes. All thresholds below are rule-of-thumb judgment calls,
called out in comments where they matter, so they're easy to find and tune.
"""
from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta


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


# Below this cadence (steps/min), overstriding and higher impact loading
# become more likely -- a widely cited running-form heuristic, not something
# fit to this athlete's biomechanics, so treat it as a nudge to look closer
# rather than a diagnosis. Same spirit as the ACWR thresholds above.
_LOW_CADENCE_SPM = 160
_GOOD_CADENCE_SPM = 172


def get_cadence_trend(conn, weeks: int = 12) -> dict:
    """Weekly average running cadence, plus a rule-of-thumb flag on the most
    recent weeks with data (see _LOW_CADENCE_SPM)."""
    rows = conn.execute(
        "SELECT start_time, avg_cadence FROM activities WHERE sport_type = 'run' AND avg_cadence IS NOT NULL"
    ).fetchall()

    by_week = defaultdict(list)
    for row in rows:
        key = _iso_week_start(_parse_dt(row["start_time"])).isoformat()
        by_week[key].append(row["avg_cadence"])

    current_week_start = _iso_week_start(datetime.utcnow().date())
    weekly = []
    for i in range(weeks - 1, -1, -1):
        key = (current_week_start - timedelta(weeks=i)).isoformat()
        vals = by_week.get(key)
        weekly.append({
            "week_start": key,
            "avg_cadence": round(statistics.mean(vals), 1) if vals else None,
        })

    recent = [w["avg_cadence"] for w in weekly[-4:] if w["avg_cadence"] is not None]
    if not recent:
        flag = "no_data"
    else:
        recent_avg = statistics.mean(recent)
        if recent_avg < _LOW_CADENCE_SPM:
            flag = "low"
        elif recent_avg < _GOOD_CADENCE_SPM:
            flag = "moderate"
        else:
            flag = "good"

    return {
        "weekly": weekly,
        "recent_avg_cadence": round(statistics.mean(recent), 1) if recent else None,
        "flag": flag,
    }


# Rule-of-thumb running-shoe lifespan before midsole cushioning degrades
# enough to raise injury risk. Commonly cited range is ~500-800km; treated
# here as an escalating flag rather than a hard cutoff since actual lifespan
# depends heavily on shoe model, runner weight, and surface.
_GEAR_MONITOR_KM = 500
_GEAR_REPLACE_SOON_KM = 650
_GEAR_OVERDUE_KM = 800


def get_gear_status(conn) -> dict:
    """Strava shoe/bike mileage vs. the rule-of-thumb thresholds above.
    distance_m is Strava's own lifetime total for the gear item, which can
    include mileage the athlete manually back-logged when first adding it,
    not just what run-coach has ingested since."""
    rows = conn.execute(
        "SELECT id, name, distance_m, retired FROM gear ORDER BY distance_m DESC"
    ).fetchall()
    if not rows:
        return {"gear": [], "alert": None}

    gear = []
    alert = None
    for r in rows:
        km = round((r["distance_m"] or 0) / 1000, 1)
        if r["retired"]:
            flag = "retired"
        elif km >= _GEAR_OVERDUE_KM:
            flag = "overdue"
        elif km >= _GEAR_REPLACE_SOON_KM:
            flag = "replace_soon"
        elif km >= _GEAR_MONITOR_KM:
            flag = "monitor"
        else:
            flag = "ok"
        gear.append({"id": r["id"], "name": r["name"], "distance_km": km, "flag": flag})
        if alert is None and flag in ("overdue", "replace_soon"):
            verb = "is overdue for replacement" if flag == "overdue" else "should be replaced soon"
            alert = f"{r['name']} {verb} ({km}km)."

    return {"gear": gear, "alert": alert}


# Signals a recovery read can be built from, best first. Garmin only fills in
# some of these depending on the device and account -- HRV, training readiness
# and sleep score come back empty for every day on some watches -- so the read
# uses whichever ones actually carry data instead of a fixed trio. `scale` says
# how a change is normalised: "points" for the 0-100 scored metrics (raw
# difference), "percent" for open-ended ones (percent off baseline), so they
# can be averaged together.
_RECOVERY_SIGNALS = [
    # key, label, unit, higher_is_better, scale, decimals
    ("body_battery_high", "Body battery", None, True, "points", 0),
    ("training_readiness", "Readiness", None, True, "points", 0),
    ("hrv_ms", "HRV", "ms", True, "percent", 0),
    ("sleep_hours", "Sleep", "h", True, "percent", 1),
    ("resting_hr", "Resting HR", "bpm", False, "percent", 0),
    ("stress_avg", "Stress", None, False, "points", 0),
]

# One unusual night (sleep especially) swings far harder than the other
# signals; clamp each contribution so a single outlier can't decide the status.
_RECOVERY_SIGNAL_CAP = 25.0


def _recovery_values(row) -> dict:
    """The row's signal values, with sleep converted to the hours the
    frontend shows rather than raw seconds."""
    vals = {
        k: row[k]
        for k in ("resting_hr", "hrv_ms", "body_battery_high", "training_readiness", "stress_avg")
    }
    vals["sleep_hours"] = row["sleep_duration_s"] / 3600 if row["sleep_duration_s"] else None
    return vals


def get_recovery_status(conn) -> dict:
    """The most recent wellness reading vs. the average of the 7 readings
    before it -- the same latest day the wellness chart draws, so the card and
    the chart never disagree about what "today" is.

    Body battery is an intraday running max, so a reading taken mid-morning is
    still climbing; that is true of most stored days too (each row is whatever
    Garmin had at sync time), which keeps today comparable to its own baseline.
    """
    rows = conn.execute(
        """SELECT date, resting_hr, hrv_ms, body_battery_high, training_readiness,
                  stress_avg, sleep_duration_s
           FROM wellness ORDER BY date DESC LIMIT 8"""
    ).fetchall()

    if not rows:
        return {"status": "no_data", "detail": "No Garmin wellness data synced yet.", "metrics": []}

    latest = _recovery_values(rows[0])
    prior = [_recovery_values(r) for r in rows[1:8]]

    metrics, signals = [], []
    for key, label, unit, higher_is_better, scale, decimals in _RECOVERY_SIGNALS:
        value = latest[key]
        if value is None:
            continue
        past = [p[key] for p in prior if p[key] is not None]
        baseline = statistics.mean(past) if past else None
        metrics.append(
            {
                "key": key,
                "label": label,
                "unit": unit,
                "value": round(value, decimals),
                "prior_7d_avg": round(baseline, decimals) if baseline is not None else None,
                "higher_is_better": higher_is_better,
                "decimals": decimals,
            }
        )
        if baseline is None:
            continue
        diff = value - baseline
        if scale == "percent":
            diff = diff / max(abs(baseline), 1e-9) * 100
        if not higher_is_better:
            diff = -diff  # lower resting HR / stress means better recovered
        signals.append(max(-_RECOVERY_SIGNAL_CAP, min(_RECOVERY_SIGNAL_CAP, diff)))

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

    by_key = {m["key"]: m for m in metrics}

    def val(key, field):
        return by_key[key][field] if key in by_key else None

    return {
        "status": status,
        "date": rows[0]["date"],
        "metrics": metrics,
        # Flat keys kept for the AI-coach context block and anything else that
        # reads the three original fields by name.
        "training_readiness": val("training_readiness", "value"),
        "body_battery_high": val("body_battery_high", "value"),
        "hrv_ms": val("hrv_ms", "value"),
        "prior_7d_avg_training_readiness": val("training_readiness", "prior_7d_avg"),
        "prior_7d_avg_body_battery_high": val("body_battery_high", "prior_7d_avg"),
        "prior_7d_avg_hrv_ms": val("hrv_ms", "prior_7d_avg"),
    }


def get_wellness_trend(conn, days: int = 90) -> list[dict]:
    """Daily wellness history for charting (sleep, body battery, resting HR,
    stress, HRV/readiness where available). Only returns days that actually
    exist in `wellness` — callers should not assume a continuous series."""
    start = (datetime.utcnow().date() - timedelta(days=days)).isoformat()
    rows = conn.execute(
        """SELECT date, resting_hr, avg_hr_day, max_hr_day, hrv_ms, body_battery_high, body_battery_low,
                  training_readiness, vo2max, sleep_score, sleep_duration_s, stress_avg
           FROM wellness WHERE date >= ? ORDER BY date ASC""",
        (start,),
    ).fetchall()
    return [
        {
            "date": r["date"],
            "resting_hr": r["resting_hr"],
            "avg_hr_day": r["avg_hr_day"],
            "max_hr_day": r["max_hr_day"],
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


# Standard race distances (meters) we predict/report times for, and the
# matching name Strava uses in its own best_efforts (see best_efforts table).
_RACE_DISTANCES = [
    ("5K", 5000.0, "5K"),
    ("10K", 10000.0, "10K"),
    ("Half Marathon", 21097.5, "Half-Marathon"),
    ("Marathon", 42195.0, "Marathon"),
]
_RIEGEL_EXPONENT = 1.06  # standard Riegel endurance-fatigue exponent


def get_race_predictions(conn, days: int = 120) -> dict:
    """Real recorded best time per standard distance (within +/-3%, "what you
    actually ran") — an all-time PR lookup, not limited to `days` — plus a
    Riegel-formula prediction for every distance based on your single best
    effort within the last `days` (the run with the fastest 5K-equivalent
    pace) — the same method Strava/most race calculators use, not a model
    fit to your data specifically.
    """
    all_time_rows = conn.execute(
        """SELECT name, start_time, distance_m, moving_time_s FROM activities
           WHERE sport_type = 'run' AND distance_m > 1000 AND moving_time_s > 0""",
    ).fetchall()

    start = (datetime.utcnow().date() - timedelta(days=days)).isoformat()
    rows = [r for r in all_time_rows if r["start_time"] >= start]

    if not rows:
        predictions = [
            {
                "label": l,
                "distance_m": d,
                **_best_real_time(conn, all_time_rows, d, strava_name),
                "predicted_time_s": None,
            }
            for l, d, strava_name in _RACE_DISTANCES
        ]
        return {"reference": None, "predictions": predictions}

    # Riegel extrapolation assumes the reference is itself a genuine
    # sustained effort — a single fast 1km interval rep isn't representative
    # of marathon-pace endurance, so it would skew every longer prediction
    # wildly optimistic. Require a minimum distance for the reference only
    # (short runs can still match/report as a "real" time for 5K etc. below).
    ref_candidates = [r for r in rows if r["distance_m"] >= 2500] or rows

    best_ref, best_5k_equiv = None, None
    for r in ref_candidates:
        equiv = r["moving_time_s"] * (5000.0 / r["distance_m"]) ** _RIEGEL_EXPONENT
        if best_5k_equiv is None or equiv < best_5k_equiv:
            best_5k_equiv, best_ref = equiv, r

    reference = {
        "name": best_ref["name"],
        "date": best_ref["start_time"],
        "distance_m": best_ref["distance_m"],
        "time_s": best_ref["moving_time_s"],
    }

    predictions = []
    for label, dist, strava_name in _RACE_DISTANCES:
        predicted_time_s = best_ref["moving_time_s"] * (dist / best_ref["distance_m"]) ** _RIEGEL_EXPONENT
        predictions.append({
            "label": label,
            "distance_m": dist,
            **_best_real_time(conn, all_time_rows, dist, strava_name),
            "predicted_time_s": round(predicted_time_s),
        })

    return {"reference": reference, "predictions": predictions}


def _best_real_time(conn, rows, dist: float, strava_name: str) -> dict:
    """All-time PR for `dist`, taking the best of two sources:

    1. Strava's own best_efforts (see schema.sql) -- a proper sliding-window
       best segment within each run, e.g. a run's fastest 5K can start
       partway through it, not just from the start. This is what Strava
       itself shows as your PR, and is the accurate source whenever it's
       available.
    2. A naive whole-activity distance match (within +/-3% of `dist`) as a
       fallback, so Garmin-sourced runs (no Strava best_efforts) or Strava
       runs not yet backfilled (see ingest_strava.py --backfill-efforts)
       still contribute a real time instead of being silently dropped.
    """
    candidates: list[tuple[int, str | None]] = []

    best_effort = conn.execute(
        "SELECT moving_time_s, start_date FROM best_efforts WHERE name = ? ORDER BY moving_time_s ASC LIMIT 1",
        (strava_name,),
    ).fetchone()
    if best_effort:
        candidates.append((best_effort["moving_time_s"], best_effort["start_date"]))

    naive_matches = [r for r in rows if abs(r["distance_m"] - dist) / dist <= 0.03]
    if naive_matches:
        best_naive = min(naive_matches, key=lambda r: r["moving_time_s"])
        candidates.append((best_naive["moving_time_s"], best_naive["start_time"]))

    if not candidates:
        return {"real_time_s": None, "real_date": None}
    best_time_s, best_date = min(candidates, key=lambda c: c[0])
    return {"real_time_s": best_time_s, "real_date": best_date}


def get_plan_status(conn, weeks_back: int = 8, weeks_forward: int = 3) -> dict:
    """Compares the training plan (planned_workouts, loaded from the Google
    Calendar export) against what was actually run, and gives advice for the
    next planned session using current ACWR/recovery state.
    """
    today = datetime.utcnow().date()
    start = (today - timedelta(weeks=weeks_back)).isoformat()
    end = (today + timedelta(weeks=weeks_forward)).isoformat()

    planned_rows = conn.execute(
        """SELECT date, workout_type, title, planned_distance_km, pace_target, hr_target, notes
           FROM planned_workouts WHERE date >= ? AND date <= ? ORDER BY date ASC""",
        (start, end),
    ).fetchall()
    if not planned_rows:
        return {
            "days": [],
            "adherence_rate": None,
            "next_workout": None,
            "advice": "No training plan loaded yet.",
        }

    activity_rows = conn.execute(
        """SELECT substr(start_time, 1, 10) AS day, distance_m, moving_time_s, avg_pace_s_per_km, avg_hr
           FROM activities WHERE sport_type = 'run' AND start_time >= ? AND start_time <= ?""",
        (start, end + "T23:59:59Z"),
    ).fetchall()
    activities_by_day: dict[str, list] = {}
    for r in activity_rows:
        activities_by_day.setdefault(r["day"], []).append(r)

    days = []
    completed = partial = missed = 0
    next_workout = None
    for p in planned_rows:
        day = p["date"]
        day_date = date.fromisoformat(day)
        acts = activities_by_day.get(day, [])
        total_km = sum((a["distance_m"] or 0) for a in acts) / 1000

        if day_date > today:
            status = "upcoming"
            if next_workout is None:
                next_workout = dict(p)
        elif not acts:
            status = "missed"
            missed += 1
        elif p["planned_distance_km"] and total_km < p["planned_distance_km"] * 0.6:
            status = "partial"
            partial += 1
        else:
            status = "completed"
            completed += 1

        days.append({
            "date": day,
            "workout_type": p["workout_type"],
            "title": p["title"],
            "planned_distance_km": p["planned_distance_km"],
            "pace_target": p["pace_target"],
            "hr_target": p["hr_target"],
            "notes": p["notes"],
            "status": status,
            "actual_distance_km": round(total_km, 1) if acts else None,
            "actual_avg_hr": round(statistics.mean([a["avg_hr"] for a in acts if a["avg_hr"]]), 1)
                if any(a["avg_hr"] for a in acts) else None,
        })

    tracked = completed + partial + missed
    adherence_rate = round(completed / tracked, 2) if tracked else None

    advice = "No upcoming session in the plan."
    if next_workout:
        acwr = compute_acwr(conn)
        recovery = get_recovery_status(conn)
        when = date.fromisoformat(next_workout["date"])
        day_label = "today" if when == today else "tomorrow" if when == today + timedelta(days=1) else when.strftime("%A %d/%m")
        target = next_workout["pace_target"] or (f"{next_workout['planned_distance_km']}km" if next_workout["planned_distance_km"] else "")
        base = f"Next up: {next_workout['title']} ({day_label})" + (f" at {target}" if target else "") + "."

        if next_workout["workout_type"] in ("interval", "benchmark") and (
            acwr["flag"] in ("caution", "high_injury_risk") or recovery["status"] == "fatigued"
        ):
            advice = base + " Your load/recovery signals are down right now — consider easing the target pace slightly or extending recovery jogs rather than forcing the prescribed numbers."
        elif next_workout["workout_type"] in ("interval", "benchmark"):
            advice = base + " Recovery and training load look fine — you're set up to hit this one as prescribed."
        else:
            advice = base + " It's an easy/long day — keep it conversational regardless of how the harder sessions have felt."

    return {
        "days": days,
        "adherence_rate": adherence_rate,
        "completed": completed,
        "partial": partial,
        "missed": missed,
        "next_workout": next_workout,
        "advice": advice,
    }


def get_coach_summary(conn) -> dict:
    """Everything a dashboard needs in one call: current load/recovery
    status plus a plain-English recommendation. Deliberately simple,
    readable rules rather than a model -- easy to see through and tune.
    """
    acwr = compute_acwr(conn)
    recovery = get_recovery_status(conn)
    weekly = get_weekly_mileage(conn, weeks=4)
    pace_trend = get_pace_trend(conn, weeks=4)
    cadence = get_cadence_trend(conn, weeks=4)
    gear = get_gear_status(conn)

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

    if gear["alert"]:
        recommendation += f" Also: {gear['alert']}"

    return {
        "acwr": acwr,
        "recovery": recovery,
        "recent_weekly_mileage": weekly,
        "recent_pace_trend": pace_trend,
        "cadence": cadence,
        "gear": gear,
        "recommendation": recommendation,
    }


if __name__ == "__main__":
    import json

    from db import get_connection

    conn = get_connection()
    print(json.dumps(get_coach_summary(conn), indent=2))
