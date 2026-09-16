"""The Cook: rolling meal plan, shopping list, recipe library and ratings."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import cook
from api.deps import db, run_analytics

router = APIRouter(prefix="/api/cook", tags=["cook"])


class RatingIn(BaseModel):
    rating: Optional[str] = None  # "like" | "dislike" | None to clear


@router.get("/meal-plan")
def meal_plan(days: int = Query(7, ge=1, le=28)):
    return run_analytics(cook.get_meal_plan, days, is_empty=lambda r: not r)


@router.get("/shopping-list")
def shopping_list(days: int = Query(7, ge=1, le=28)):
    return run_analytics(cook.get_shopping_list, days, is_empty=lambda r: not r or not r.get("categories"))


@router.get("/recipes")
def recipes():
    """Every recipe in the library, each with its current rating."""
    return run_analytics(cook.get_all_recipes, is_empty=lambda r: not r)


@router.put("/recipes/{recipe_id}/rating")
def set_rating(recipe_id: str, body: RatingIn):
    if body.rating not in (None, "like", "dislike"):
        raise HTTPException(status_code=422, detail="rating must be 'like', 'dislike', or null")
    with db() as conn:
        cook.set_recipe_rating(conn, recipe_id, body.rating)
    return {"recipe_id": recipe_id, "rating": body.rating}
