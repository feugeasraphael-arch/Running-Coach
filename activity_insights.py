"""Per-activity breakdown: splits derived from streams, and short rule-based
commentary comparing one run against the athlete's recent baseline.

Kept separate from coach.py (which reasons about training load *across*
weeks) since this reasons about a single activity's internal shape.
"""
from __future__ import annotations

import statistics


def splits_from_streams(streams: dict, split_m: float = 1000.0) -> list[dict]:
    """Build even splits (default 1km) from raw distance/time/hr streams.
    Strava's own /laps endpoint gives lap splits (manual or auto-lap), which
    the caller should prefer when present — this is the fallback for
    activities with streams but no meaningful laps (e.g. one giant lap)."""
    distance = streams.get("distance") or []
    time = streams.get("time") or []
    heartrate = streams.get("heartrate") or []
    altitude = streams.get("altitude") or []
    if not distance or not time or len(distance) != len(time):
        return []

    splits = []
    next_boundary = split_m
    start_idx = 0
    for i, d in enumerate(distance):
        if d >= next_boundary or i == len(distance) - 1:
            seg_distance = d - distance[start_idx]
            seg_time = time[i] - time[start_idx]
            if seg_distance <= 0 or seg_time <= 0:
                start_idx = i
                next_boundary += split_m
                continue
            seg_hr = heartrate[start_idx:i + 1] if heartrate else []
            seg_alt = altitude[start_idx:i + 1] if altitude else []
            splits.append({
                "distance_m": round(seg_distance, 1),
                "time_s": seg_time,
                "pace_s_per_km": seg_time / (seg_distance / 1000),
                "avg_hr": round(statistics.mean(seg_hr), 1) if seg_hr else None,
                "elevation_gain_m": round(max(seg_alt) - min(seg_alt), 1) if len(seg_alt) > 1 else None,
            })
            start_idx = i
            next_boundary += split_m
    return splits


def detect_intervals(streams: dict, min_segment_s: float = 20.0) -> list[dict]:
    """For activities with no manual lap markers (a single continuous
    recording), detect work/recovery reps from the pace stream itself and
    compute each segment's average HR by matching heartrate samples to the
    same time indices — rather than cutting blindly at fixed distances,
    which slices straight through a rep/recovery boundary.

    Returns [] if the run doesn't actually look like structured intervals
    (no clear alternation between fast and slow segments) — callers should
    fall back to fixed-distance splits in that case.
    """
    time = streams.get("time") or []
    distance = streams.get("distance") or []
    velocity = streams.get("velocity_smooth") or []
    heartrate = streams.get("heartrate") or []
    altitude = streams.get("altitude") or []
    n = len(time)
    if n < 10 or len(distance) != n:
        return []

    # velocity_smooth is Strava's own smoothed speed stream (m/s); derive it
    # from distance/time deltas if a particular activity doesn't have it.
    if len(velocity) != n:
        velocity = [0.0] * n
        for i in range(1, n):
            dt = time[i] - time[i - 1]
            velocity[i] = (distance[i] - distance[i - 1]) / dt if dt > 0 else velocity[i - 1]
        velocity[0] = velocity[1] if n > 1 else 0.0

    # Light smoothing (moving average) so GPS/pace jitter doesn't register
    # as a state change; a real rep/recovery transition is a sustained shift.
    window = 5
    smoothed = []
    for i in range(n):
        lo, hi = max(0, i - window), min(n, i + window + 1)
        smoothed.append(sum(velocity[lo:hi]) / (hi - lo))

    # Threshold between the two speed clusters (recovery vs. work), NOT the
    # overall median: if work reps account for more total *time* than
    # recovery (common — e.g. 4min-on/2min-off), the median sample lands
    # inside the work cluster itself, and a threshold derived from it can
    # end up on the wrong side of every real work sample, so the detector
    # locks into "recovery" and never flips back. Q1/Q3 track the two
    # clusters' typical speeds regardless of how much time each occupies.
    try:
        q1, _, q3 = statistics.quantiles(smoothed, n=4)
    except statistics.StatisticsError:
        return []
    if q3 <= 0 or (q3 - q1) < q3 * 0.15:
        return []  # not enough speed variation to be structured intervals

    threshold = (q1 + q3) / 2
    band = (q3 - q1) * 0.15
    hi_thresh, lo_thresh = threshold + band, threshold - band
    state = "work" if smoothed[0] >= threshold else "recovery"
    states = [state]
    for v in smoothed[1:]:
        if state == "work" and v < lo_thresh:
            state = "recovery"
        elif state == "recovery" and v > hi_thresh:
            state = "work"
        states.append(state)

    # Merge consecutive same-state samples into segments, dropping ones too
    # short to be a real rep/recovery (GPS noise, a momentary slowdown).
    raw_segments = []
    seg_start = 0
    for i in range(1, n + 1):
        if i == n or states[i] != states[seg_start]:
            raw_segments.append((seg_start, i - 1, states[seg_start]))
            seg_start = i

    segments = [s for s in raw_segments if time[s[1]] - time[s[0]] >= min_segment_s]
    work_segments = [s for s in segments if s[2] == "work"]
    if len(work_segments) < 2:
        return []  # doesn't look like a structured interval session

    result = []
    for start_idx, end_idx, kind in segments:
        seg_distance = distance[end_idx] - distance[start_idx]
        seg_time = time[end_idx] - time[start_idx]
        if seg_distance <= 0 or seg_time <= 0:
            continue
        seg_hr = heartrate[start_idx:end_idx + 1] if heartrate else []
        seg_alt = altitude[start_idx:end_idx + 1] if altitude else []
        result.append({
            "distance_m": round(seg_distance, 1),
            "time_s": round(seg_time),
            "pace_s_per_km": seg_time / (seg_distance / 1000),
            "avg_hr": round(statistics.mean(seg_hr), 1) if seg_hr else None,
            "elevation_gain_m": round(max(seg_alt) - min(seg_alt), 1) if len(seg_alt) > 1 else None,
            "kind": kind,
        })
    return result


def laps_to_splits(laps: list[dict]) -> list[dict]:
    """Normalize Strava's /laps payload into the same split shape as
    splits_from_streams, so the frontend renders either uniformly."""
    return [
        {
            "distance_m": lap.get("distance"),
            "time_s": lap.get("moving_time") or lap.get("elapsed_time"),
            "pace_s_per_km": (
                (lap.get("moving_time") or lap.get("elapsed_time")) / (lap["distance"] / 1000)
                if lap.get("distance") else None
            ),
            "avg_hr": lap.get("average_heartrate"),
            "elevation_gain_m": lap.get("total_elevation_gain"),
        }
        for lap in laps
        if lap.get("distance")
    ]


def generate_commentary(activity: dict, splits: list[dict], baseline_runs: list[dict]) -> list[str]:
    """Short, plain-English observations about this run. `baseline_runs` is
    a list of {avg_pace_s_per_km, avg_hr, distance_m} from the athlete's
    recent similar-distance runs, for comparison — not a personal record
    database, just a rough "typical for you" reference point.
    """
    notes = []

    # Pacing shape: compare first-half vs second-half pace from splits.
    if len(splits) >= 4:
        mid = len(splits) // 2
        first_half = [s["pace_s_per_km"] for s in splits[:mid] if s.get("pace_s_per_km")]
        second_half = [s["pace_s_per_km"] for s in splits[mid:] if s.get("pace_s_per_km")]
        if first_half and second_half:
            delta = statistics.mean(second_half) - statistics.mean(first_half)
            pct = delta / statistics.mean(first_half) * 100
            if pct <= -3:
                notes.append(f"Negative split — you sped up {abs(pct):.0f}% in the second half.")
            elif pct >= 5:
                notes.append(f"Positive split — you slowed {pct:.0f}% in the second half, consistent with fading late.")
            else:
                notes.append("Even pacing throughout — first and second half were close in effort.")

    # HR drift within the run: late-splits HR vs early-splits HR at similar pace.
    hr_vals = [s["avg_hr"] for s in splits if s.get("avg_hr")]
    if len(hr_vals) >= 4:
        mid = len(hr_vals) // 2
        drift = statistics.mean(hr_vals[mid:]) - statistics.mean(hr_vals[:mid])
        if drift >= 6:
            notes.append(f"Heart rate drifted up ~{drift:.0f} bpm over the run — a sign of accumulating fatigue or heat/hydration effects.")

    # Compare to recent baseline of similar runs.
    pace = activity.get("avg_pace_s_per_km")
    hr = activity.get("avg_hr")
    baseline_paces = [b["avg_pace_s_per_km"] for b in baseline_runs if b.get("avg_pace_s_per_km")]
    baseline_hrs = [b["avg_hr"] for b in baseline_runs if b.get("avg_hr")]
    if pace and baseline_paces:
        baseline_avg = statistics.mean(baseline_paces)
        pct = (baseline_avg - pace) / baseline_avg * 100  # positive => faster than baseline
        if pct >= 5:
            notes.append(f"{pct:.0f}% faster average pace than your recent runs of similar distance.")
        elif pct <= -5:
            notes.append(f"{abs(pct):.0f}% slower average pace than your recent runs of similar distance.")
    if pace and hr and baseline_paces and baseline_hrs and statistics.mean(baseline_hrs) > 0:
        baseline_pace = statistics.mean(baseline_paces)
        baseline_hr = statistics.mean(baseline_hrs)
        # Efficiency: pace achieved per unit HR, vs your recent baseline.
        this_eff = 1 / (pace * hr) if pace and hr else None
        base_eff = 1 / (baseline_pace * baseline_hr) if baseline_pace and baseline_hr else None
        if this_eff and base_eff:
            eff_pct = (this_eff - base_eff) / base_eff * 100
            if eff_pct >= 5:
                notes.append("Better pace-for-HR efficiency than your recent baseline — a good aerobic-fitness sign.")
            elif eff_pct <= -5:
                notes.append("Lower pace-for-HR efficiency than your recent baseline — could be fatigue, heat, or terrain.")

    elevation = activity.get("elevation_gain_m")
    distance = activity.get("distance_m")
    if elevation and distance and distance > 0 and (elevation / distance) > 0.015:
        notes.append(f"Hilly run ({elevation:.0f} m gain) — pace alone understates the effort here.")

    if not notes:
        notes.append("Nothing unusual to flag — a fairly typical effort.")
    return notes
