"""Training plan vs. what was actually run."""
from __future__ import annotations

from fastapi import APIRouter, Query

import coach
from api.deps import run_analytics

router = APIRouter(prefix="/api/plan", tags=["plan"])


@router.get("/status")
def status(weeks_back: int = Query(8, ge=0, le=104), weeks_forward: int = Query(3, ge=0, le=52)):
    return run_analytics(coach.get_plan_status, weeks_back, weeks_forward, is_empty=lambda r: not r or not r.get("days"))
