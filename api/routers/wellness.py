"""Garmin wellness: recovery snapshot and daily trends."""
from __future__ import annotations

from fastapi import APIRouter, Query

import coach
from api.deps import run_analytics

router = APIRouter(prefix="/api/wellness", tags=["wellness"])


@router.get("/recovery")
def recovery():
    return run_analytics(coach.get_recovery_status)


@router.get("/trend")
def trend(days: int = Query(90, ge=1, le=3650)):
    """Daily readings (resting/avg HR, HRV, body battery, VO2max, sleep,
    stress); only days present in the DB, not zero-filled."""
    return run_analytics(coach.get_wellness_trend, days, is_empty=lambda r: not r)
