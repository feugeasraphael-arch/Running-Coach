"""Per-run "relative effort" scoring and the daily effort calendar that feeds
the dashboard's training heatmap.

Moved here from the old static/app.js so the scoring rules live next to the
rest of the analytics (coach.py) instead of being re-implemented in the
browser, and so the frontend no longer has to download the whole activity
history just to colour a grid.

There's no ground-truth effort metric in the data, so this blends what every
activity row already has: how long the run was relative to your longest on
record, how hard relative to your own average pace/HR (or logged
perceived_effort when present), a bonus for interval-shaped names, and a
personal-best override so a 5K PB or a half marathon reads as maximally
intense even if the blended score alone wouldn't get there.
"""
from __future__ import annotations

import re
from typing import Optional

INTERVAL_NAME_RE = re.compile(
    r"\d+\s*x\s*\d+|interval|fartlek|vma|s[ée]rie|allure sp[ée]cifique|norv[ée]gien|tempo",
    re.IGNORECASE,
)

LEVEL_LABEL = {1: "Light", 2: "Moderate", 3: "Solid", 4: "Hard", 5: "Max"}


def _clamp01(v: float) -> float:
    return min(max(v, 0.0), 1.0)


def _score_to_level(score: float) -> int:
    if score >= 0.85:
        return 5
    if score >= 0.65:
        return 4
    if score >= 0.45:
        return 3
    if score >= 0.25:
        return 2
    return 1


def _load_runs(conn) -> list[dict]:
    rows = conn.execute(
        """SELECT id, name, sport_type, start_time, distance_m, avg_pace_s_per_km,
                  avg_hr, max_hr, perceived_effort
           FROM activities WHERE distance_m > 0 ORDER BY start_time"""
    ).fetchall()
    return [dict(r) for r in rows]


def _is_personal_best(run: dict, runs: list[dict]) -> bool:
    if run["avg_pace_s_per_km"] is None or not run["distance_m"]:
        return False
    lo, hi = run["distance_m"] * 0.85, run["distance_m"] * 1.15
    peers = [
        o["avg_pace_s_per_km"] for o in runs
        if lo <= o["distance_m"] <= hi and o["avg_pace_s_per_km"] is not None
    ]
    if len(peers) < 2:
        return False
    return run["avg_pace_s_per_km"] <= min(peers) + 1e-6


def score_runs(runs: list[dict]) -> list[float]:
    """Effort score in [0, 1] for each run, relative to the whole `runs` set."""
    if not runs:
        return []
    max_dist_km = max(r["distance_m"] for r in runs) / 1000
    paces = [r["avg_pace_s_per_km"] for r in runs if r["avg_pace_s_per_km"] is not None]
    avg_pace = sum(paces) / len(paces) if paces else 0.0
    max_hrs = [r["max_hr"] for r in runs if r["max_hr"] is not None]
    max_hr = max(max_hrs) if max_hrs else 0.0

    scores = []
    for r in runs:
        dist_score = _clamp01((r["distance_m"] / 1000) / max_dist_km) if max_dist_km > 0 else 0.0

        signals = []
        if r["perceived_effort"] is not None:
            signals.append(_clamp01(r["perceived_effort"] / 10))
        if r["avg_pace_s_per_km"] and avg_pace > 0:
            ratio = avg_pace / r["avg_pace_s_per_km"]  # >1 = faster than your average
            signals.append(_clamp01((ratio - 0.7) / 0.6))
        if r["avg_hr"] is not None and max_hr > 0:
            signals.append(_clamp01(r["avg_hr"] / max_hr))
        intensity = sum(signals) / len(signals) if signals else 0.4

        score = dist_score * 0.45 + intensity * 0.55
        if r["name"] and INTERVAL_NAME_RE.search(r["name"]):
            score += 0.15
        if _is_personal_best(r, runs):
            score = max(score, 0.92)
        scores.append(_clamp01(score))
    return scores


def get_effort_calendar(conn, start: Optional[str] = None, end: Optional[str] = None) -> dict:
    """One entry per day that has at least one activity, keeping that day's
    hardest session. Scores are always computed against the full history (so
    a day's colour doesn't change depending on which window you page to);
    `start`/`end` (inclusive ISO dates) only filter what's returned.

        {earliest_date, days: [{date, score, level, level_label, count,
                               activity: {id, name, sport_type, distance_m,
                                          avg_pace_s_per_km, avg_hr}}, ...]}
    """
    runs = _load_runs(conn)
    scores = score_runs(runs)

    by_date: dict[str, dict] = {}
    for run, score in zip(runs, scores):
        day = (run["start_time"] or "")[:10]
        if not day:
            continue
        entry = by_date.get(day)
        if entry is None:
            by_date[day] = {"date": day, "score": score, "count": 1, "run": run}
        else:
            entry["count"] += 1
            if score > entry["score"]:
                entry["score"], entry["run"] = score, run

    days = []
    for day in sorted(by_date):
        if (start and day < start) or (end and day > end):
            continue
        e = by_date[day]
        level = _score_to_level(e["score"])
        run = e["run"]
        days.append({
            "date": day,
            "score": round(e["score"], 3),
            "level": level,
            "level_label": LEVEL_LABEL[level],
            "count": e["count"],
            "activity": {
                "id": run["id"],
                "name": run["name"],
                "sport_type": run["sport_type"],
                "distance_m": run["distance_m"],
                "avg_pace_s_per_km": run["avg_pace_s_per_km"],
                "avg_hr": run["avg_hr"],
            },
        })

    return {"earliest_date": min(by_date) if by_date else None, "days": days}
