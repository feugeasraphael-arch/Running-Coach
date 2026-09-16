"""Training-load analytics from coach.py: load, pace, cadence, gear, races."""
from __future__ import annotations

from fastapi import APIRouter, Query

import coach
from api.deps import run_analytics

router = APIRouter(prefix="/api/coach", tags=["coach"])


def _empty_list(r) -> bool:
    return not r


@router.get("/summary")
def summary():
    """Headline recommendation plus the current ACWR/recovery snapshot."""
    return run_analytics(coach.get_coach_summary)


@router.get("/acwr")
def acwr():
    return run_analytics(coach.compute_acwr)


@router.get("/weekly-mileage")
def weekly_mileage(weeks: int = Query(12, ge=1, le=520)):
    return run_analytics(coach.get_weekly_mileage, weeks, is_empty=_empty_list)


@router.get("/pace-trend")
def pace_trend(weeks: int = Query(12, ge=1, le=520)):
    return run_analytics(coach.get_pace_trend, weeks, is_empty=_empty_list)


@router.get("/cadence")
def cadence(weeks: int = Query(12, ge=1, le=520)):
    return run_analytics(coach.get_cadence_trend, weeks)


@router.get("/gear")
def gear():
    return run_analytics(coach.get_gear_status)


@router.get("/predictions")
def predictions(days: int = Query(120, ge=7, le=3650)):
    """All-time PRs per standard distance + Riegel predictions."""
    return run_analytics(coach.get_race_predictions, days)
