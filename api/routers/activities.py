from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

import activity_insights
import db as dbmod
import effort
import hr_zones
from api.deps import db, log, run_analytics
from strava_client import get_access_token, get_activity_laps, get_activity_streams

router = APIRouter(prefix="/api/activities", tags=["activities"])

_LIST_COLUMNS = (
    "id, source, name, sport_type, start_time, distance_m, moving_time_s, elevation_gain_m, "
    "avg_pace_s_per_km, avg_hr, max_hr, avg_cadence, calories, perceived_effort, "
    "summary_polyline, start_lat, start_lng"
)


LIST_ZONE_BUCKETS = 60
DETAIL_ZONE_BUCKETS = 240


@router.get("/hr-zones")
def get_hr_zones():
    """The athlete's HR zones: [{zone, min_bpm, max_bpm, name, description}]."""
    with db() as conn:
        return hr_zones.load_zones(conn)


@router.get("")
def list_activities(
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    q: Optional[str] = Query(None, description="Case-insensitive match on the activity name"),
    sport_type: Optional[str] = None,
):
    """Paginated activity list, newest first: {items, total, limit, offset}."""
    where, params = [], []
    if q:
        where.append("name LIKE ?")
        params.append(f"%{q}%")
    if sport_type:
        where.append("sport_type = ?")
        params.append(sport_type)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    with db() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM activities {where_sql}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT {_LIST_COLUMNS} FROM activities {where_sql} ORDER BY start_time DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        items = [dict(r) for r in rows]
        zones = hr_zones.load_zones(conn)
        series = hr_zones.load_series(conn, [a["id"] for a in items])
    for a in items:
        step_s, hr = series.get(a["id"], (0, []))
        a["hr_zones"] = hr_zones.summarize(hr, step_s, zones, buckets=LIST_ZONE_BUCKETS)
    return {"items": items, "total": total, "limit": limit, "offset": offset, "zones": zones}


@router.get("/effort-calendar")
def effort_calendar(start: Optional[str] = None, end: Optional[str] = None):
    """Daily hardest-session effort level for the training heatmap."""
    return run_analytics(effort.get_effort_calendar, start, end)


@router.get("/{activity_id}")
def activity_detail(activity_id: str):
    """Full activity row + Strava streams, splits (laps, detected intervals
    or 1km fallback) and rule-based coach commentary."""
    with db() as conn:
        row = conn.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Activity not found")
        activity = dict(row)

        baseline_runs = []
        if activity.get("sport_type") and activity.get("distance_m"):
            lo, hi = activity["distance_m"] * 0.7, activity["distance_m"] * 1.3
            baseline_runs = [
                dict(r)
                for r in conn.execute(
                    """SELECT avg_pace_s_per_km, avg_hr, distance_m FROM activities
                       WHERE sport_type = ? AND id != ? AND distance_m BETWEEN ? AND ?
                       ORDER BY start_time DESC LIMIT 10""",
                    (activity["sport_type"], activity_id, lo, hi),
                ).fetchall()
            ]

        planned = activity_insights.match_planned_interval(conn, activity)
        zones = hr_zones.load_zones(conn)

    name = activity.get("name") or ""
    name_says_interval = bool(activity_insights.INTERVAL_NAME_RE.search(name))
    expect_intervals = name_says_interval or planned is not None

    streams, splits, splits_kind, note = {}, [], None, None
    signals: list[str] = []
    if activity["source"] == "strava":
        try:
            token = get_access_token()
            streams = get_activity_streams(token, activity["external_id"])
            raw_laps = get_activity_laps(token, activity["external_id"])
            lap_splits = activity_insights.laps_to_splits(raw_laps) if raw_laps and len(raw_laps) > 1 else []
            if lap_splits and activity_insights.classify_lap_splits(lap_splits, expect_intervals):
                # Structured workout laps (e.g. a Garmin workout): Strava
                # already computed each lap's own average HR, use as-is.
                splits, splits_kind = lap_splits, "intervals"
                signals.append("laps")
            elif lap_splits and not expect_intervals:
                splits, splits_kind = lap_splits, "laps"
            else:
                # No usable lap markers: detect work/recovery reps from the
                # pace stream so interval HR isn't averaged across a fixed-km
                # line that cuts through a rep boundary.
                splits = activity_insights.detect_intervals(streams)
                if splits:
                    splits_kind = "intervals"
                    signals.append("pace stream")
                else:
                    splits, splits_kind = lap_splits, "laps"
                    if not splits:
                        splits, splits_kind = activity_insights.splits_from_streams(streams), "km"
        except Exception as exc:  # noqa: BLE001 - surface as a soft note, not a 500
            log.warning("Strava detail fetch failed for %s: %s", activity_id, exc)
            note = f"Couldn't fetch full detail from Strava right now: {exc}"
    else:
        note = "Detailed streams aren't available for Garmin-sourced activities yet — showing summary stats only."

    intervals = None
    if splits_kind == "intervals":
        if name_says_interval:
            signals.insert(0, "activity name")
        if planned:
            signals.insert(0, "training plan")
        target = activity_insights.apply_pace_targets(splits, name, planned)
        work = [sp for sp in splits if sp.get("kind") == "work"]
        statuses = [sp.get("target_status") for sp in work]
        intervals = {
            "signals": signals,
            "planned": planned,
            "target": target,
            "reps": len(work),
            "on_target": statuses.count("on"),
            "too_fast": statuses.count("fast"),
            "too_slow": statuses.count("slow"),
        }

    # Cache the HR series for the activity list's zone bar while we have the streams.
    hr_series = hr_zones.resample_hr(streams) if streams else None
    if hr_series is not None:
        with db() as conn:
            dbmod.upsert_hr_series(conn, activity_id, hr_zones.SERIES_STEP_S, hr_series)
            conn.commit()
    else:
        with db() as conn:
            hr_series = hr_zones.load_series(conn, [activity_id]).get(activity_id, (0, []))[1]

    # Pacing/HR-drift notes on an interval session only make sense across the reps themselves.
    work_splits = [sp for sp in splits if sp.get("kind") == "work"]
    commentary = activity_insights.generate_commentary(activity, work_splits or splits, baseline_runs)
    if intervals and intervals["target"] and intervals["reps"]:
        commentary.insert(0, _interval_comment(intervals))
    activity.pop("raw_json", None)  # large and only useful for reprocessing

    return {
        "activity": activity,
        "streams": streams,
        "splits": splits,
        "splits_kind": splits_kind if splits else None,
        "intervals": intervals,
        "hr_zones": hr_zones.summarize(hr_series, hr_zones.SERIES_STEP_S, zones, buckets=DETAIL_ZONE_BUCKETS),
        "zones": zones,
        "commentary": commentary,
        "note": note,
    }


def _interval_comment(iv: dict) -> str:
    n, on = iv["reps"], iv["on_target"]
    if on == n:
        return f"All {n} reps on target pace — well-controlled session."
    parts = []
    if iv["too_fast"]:
        parts.append(f"{iv['too_fast']} too fast")
    if iv["too_slow"]:
        parts.append(f"{iv['too_slow']} too slow")
    return f"{on}/{n} reps on target pace ({', '.join(parts)})."
