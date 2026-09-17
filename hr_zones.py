"""Heart-rate zones: the athlete's zone boundaries, a compact per-activity HR
series cached from Strava streams, and the zone timeline / time-in-zone
summary the frontend draws as a coloured bar on each run.
"""
from __future__ import annotations

import json
from typing import Optional

SERIES_STEP_S = 5
# A gap longer than this between two stream samples is a pause (auto-pause,
# stopped at a light): it isn't attributed to the zone of the sample before it.
_MAX_SAMPLE_GAP_S = 15

# Strava's own five zone names, with what each one trains.
ZONE_INFO = [
    {"name": "Endurance", "description": "Recovery and very easy running. Warm-ups, cool-downs and recovery jogs between reps."},
    {"name": "Moderate", "description": "Aerobic base. Comfortable, conversational pace: most easy runs and long runs belong here."},
    {"name": "Tempo", "description": "Steady, 'comfortably hard'. Builds aerobic power, but too much time here makes easy days not easy."},
    {"name": "Threshold", "description": "Hard, sustainable for ~30-60 min. Race-pace reps and threshold intervals raise the lactate threshold."},
    {"name": "Anaerobic", "description": "Near max effort. Short, hard reps (VO2max work) — sustainable for a few minutes at most."},
]


def load_zones(conn) -> list[dict]:
    """[{zone, min_bpm, max_bpm, name, description}]: Strava's zones when
    synced, otherwise Strava's default split derived from the highest HR seen
    across all activities (so the bar still works before the first sync)."""
    rows = [dict(r) for r in conn.execute("SELECT zone, min_bpm, max_bpm FROM hr_zones ORDER BY zone").fetchall()]
    if not rows:
        max_hr = conn.execute("SELECT MAX(max_hr) FROM activities").fetchone()[0] or 190
        cuts = [0, 0.65, 0.81, 0.89, 0.97]  # Strava's default % of max HR
        rows = [
            {"zone": i + 1, "min_bpm": round(max_hr * c), "max_bpm": round(max_hr * cuts[i + 1]) if i < 4 else None}
            for i, c in enumerate(cuts)
        ]
    return [{**r, **ZONE_INFO[min(r["zone"], len(ZONE_INFO)) - 1]} for r in rows]


def strava_zones_to_rows(zones: list[dict]) -> list[dict]:
    return [
        {"zone": i + 1, "min_bpm": z.get("min") or 0, "max_bpm": z["max"] if z.get("max", -1) > 0 else None}
        for i, z in enumerate(zones)
    ]


def resample_hr(streams: dict, step_s: int = SERIES_STEP_S) -> list[Optional[int]]:
    """HR at a fixed time step (moving time: pauses are squeezed out), one
    value per bucket, None where there was no reading. [] if no HR stream."""
    time = streams.get("time") or []
    hr = streams.get("heartrate") or []
    if not hr or len(hr) != len(time):
        return []
    moving_t = 0.0
    sums: list[float] = []
    counts: list[int] = []
    for i in range(len(time)):
        if i > 0:
            dt = time[i] - time[i - 1]
            moving_t += dt if 0 < dt <= _MAX_SAMPLE_GAP_S else 1
        b = int(moving_t // step_s)
        while len(sums) <= b:
            sums.append(0.0)
            counts.append(0)
        if hr[i]:
            sums[b] += hr[i]
            counts[b] += 1
    return [round(s / c) if c else None for s, c in zip(sums, counts)]


def zone_of(bpm: float, zones: list[dict]) -> int:
    for z in zones:
        if z["max_bpm"] is None or bpm < z["max_bpm"]:
            return z["zone"]
    return zones[-1]["zone"]


def summarize(hr: list, step_s: int, zones: list[dict], buckets: int) -> Optional[dict]:
    """{timeline: [zone|0 per bucket], time_in_zone_s: [...per zone]} or None
    when the activity has no HR. Each timeline bucket takes the dominant zone
    of the samples it covers (0 = no reading)."""
    if not any(hr):
        return None
    # Short dropouts (a skipped sample, a 5 s bucket with no reading) would show
    # as gaps in the bar: carry the last reading across gaps of up to 30 s.
    filled, last, gap = [], None, 0
    for v in hr:
        if v:
            last, gap = v, 0
        else:
            gap += step_s
            v = last if gap <= 30 else None
        filled.append(v)
    hr = filled
    time_in_zone = [0] * len(zones)
    sample_zones = []
    for v in hr:
        zn = zone_of(v, zones) if v else 0
        sample_zones.append(zn)
        if zn:
            time_in_zone[zn - 1] += step_s

    n = len(sample_zones)
    buckets = max(1, min(buckets, n))
    timeline = []
    for b in range(buckets):
        chunk = sample_zones[b * n // buckets:max((b + 1) * n // buckets, b * n // buckets + 1)]
        counts: dict[int, int] = {}
        for zn in chunk:
            if zn:
                counts[zn] = counts.get(zn, 0) + 1
        timeline.append(max(counts, key=counts.get) if counts else 0)
    return {"timeline": timeline, "time_in_zone_s": time_in_zone}


def load_series(conn, activity_ids: list[str]) -> dict[str, tuple[int, list]]:
    if not activity_ids:
        return {}
    marks = ",".join("?" * len(activity_ids))
    rows = conn.execute(
        f"SELECT activity_id, step_s, hr_json FROM activity_hr_series WHERE activity_id IN ({marks})",
        activity_ids,
    ).fetchall()
    return {r["activity_id"]: (r["step_s"], json.loads(r["hr_json"])) for r in rows}
