from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

import activity_insights
import effort
from api.deps import db, log, run_analytics
from strava_client import get_access_token, get_activity_laps, get_activity_streams

router = APIRouter(prefix="/api/activities", tags=["activities"])

_LIST_COLUMNS = (
    "id, source, name, sport_type, start_time, distance_m, moving_time_s, elevation_gain_m, "
    "avg_pace_s_per_km, avg_hr, max_hr, avg_cadence, calories, perceived_effort"
)


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
    return {"items": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


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

    streams, splits, splits_kind, note = {}, [], None, None
    if activity["source"] == "strava":
        try:
            token = get_access_token()
            streams = get_activity_streams(token, activity["external_id"])
            raw_laps = get_activity_laps(token, activity["external_id"])
            if raw_laps and len(raw_laps) > 1:
                # Real lap markers (manual or auto-lap) -- Strava already
                # computed each lap's own average HR, use those as-is.
                splits, splits_kind = activity_insights.laps_to_splits(raw_laps), "laps"
            else:
                # No useful lap markers: detect work/recovery reps from the
                # pace stream so interval HR isn't averaged across a fixed-km
                # line that cuts through a rep boundary.
                splits, splits_kind = activity_insights.detect_intervals(streams), "intervals"
                if not splits:
                    splits, splits_kind = activity_insights.splits_from_streams(streams), "km"
        except Exception as exc:  # noqa: BLE001 - surface as a soft note, not a 500
            log.warning("Strava detail fetch failed for %s: %s", activity_id, exc)
            note = f"Couldn't fetch full detail from Strava right now: {exc}"
    else:
        note = "Detailed streams aren't available for Garmin-sourced activities yet — showing summary stats only."

    commentary = activity_insights.generate_commentary(activity, splits, baseline_runs)
    activity.pop("raw_json", None)  # large and only useful for reprocessing

    return {
        "activity": activity,
        "streams": streams,
        "splits": splits,
        "splits_kind": splits_kind if splits else None,
        "commentary": commentary,
        "note": note,
    }
