"""Meal planning for run-coach ("The Cook").

Generates a rolling 7-day meal plan (breakfast/lunch/snack/dinner) from a
curated recipe library in cook_data.json. No AI call and no stored plan
state: each day's meals are picked deterministically from the calendar date,
so the window simply slides forward every day on its own, and re-requesting
the same date always returns the same meals.

The only place this reads from the DB is `planned_workouts`, to bias
breakfast/dinner selection toward higher-carb ("pre_run") or higher-protein
("recovery") recipes around hard training days -- see _HARD_WORKOUT_TYPES.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

DATA_PATH = Path(__file__).parent / "cook_data.json"
MEAL_TYPES = ["breakfast", "lunch", "snack", "dinner"]

# Workout types worth fuelling/recovering around specifically. 'easy' and no
# plan at all both fall back to plain rotation, no special tag preference.
_HARD_WORKOUT_TYPES = {"long", "interval", "benchmark"}

# Fixed anchor so the rotation index (and therefore which recipe lands on
# which date) never shifts as the DB or code changes -- just picks a
# consistent point far enough in the past to predate any real usage.
_EPOCH = date(2024, 1, 1)
_MEAL_OFFSET = {"breakfast": 0, "lunch": 5, "snack": 11, "dinner": 17}


def _load_recipes() -> dict[str, list[dict]]:
    recipes = json.loads(DATA_PATH.read_text())
    by_type: dict[str, list[dict]] = {m: [] for m in MEAL_TYPES}
    for r in recipes:
        by_type[r["meal_type"]].append(r)
    return by_type


_RECIPES_BY_TYPE = _load_recipes()


_LIKE_WEIGHT = 3  # a liked recipe occupies this many rotation slots vs. 1 for a neutral one


def _weight_by_rating(pool: list[dict], ratings: dict[str, str]) -> list[dict]:
    """Expand `pool` into a rotation list that drops disliked recipes
    entirely and repeats liked ones, so both preferences show up as rotation
    frequency rather than a separate scoring pass."""
    weighted = []
    for r in pool:
        rating = ratings.get(r["id"])
        if rating == "dislike":
            continue
        weighted.append(r)
        if rating == "like":
            weighted.extend([r] * (_LIKE_WEIGHT - 1))
    return weighted


def _pick(pool: list[dict], index: int, prefer_tag: str | None, ratings: dict[str, str]) -> dict:
    """Rotate deterministically through `pool` (or a tag-filtered subset of
    it when one exists and is non-empty) using `index`, weighted by
    `ratings` (see `_weight_by_rating`). Falls back to an unweighted/
    untagged pool rather than erroring if a filter would leave nothing to
    pick from (e.g. every tagged recipe happens to be disliked)."""
    candidates = pool
    if prefer_tag:
        tagged = [r for r in pool if prefer_tag in r.get("tags", [])]
        if tagged:
            candidates = tagged
    weighted = _weight_by_rating(candidates, ratings) or _weight_by_rating(pool, ratings) or pool
    return weighted[index % len(weighted)]


def get_recipe_ratings(conn) -> dict[str, str]:
    rows = conn.execute("SELECT recipe_id, rating FROM recipe_ratings").fetchall()
    return {r["recipe_id"]: r["rating"] for r in rows}


def get_all_recipes(conn) -> list[dict]:
    """Every recipe in the library, grouped by meal_type in the same fixed
    order as MEAL_TYPES, each tagged with its current rating. Powers "The
    Chef's Menu" -- unlike the rolling plan, a disliked recipe still needs
    to show up somewhere so it can be reviewed or un-disliked."""
    ratings = get_recipe_ratings(conn)
    return [
        {**r, "rating": ratings.get(r["id"])}
        for meal_type in MEAL_TYPES
        for r in _RECIPES_BY_TYPE[meal_type]
    ]


def set_recipe_rating(conn, recipe_id: str, rating: str | None) -> None:
    """rating is 'like', 'dislike', or None to clear back to neutral."""
    if rating is None:
        conn.execute("DELETE FROM recipe_ratings WHERE recipe_id = ?", (recipe_id,))
    else:
        conn.execute(
            """INSERT INTO recipe_ratings (recipe_id, rating, updated_at) VALUES (?, ?, datetime('now'))
               ON CONFLICT(recipe_id) DO UPDATE SET rating=excluded.rating, updated_at=excluded.updated_at""",
            (recipe_id, rating),
        )
    conn.commit()


def get_meal_plan(conn, days: int = 7) -> list[dict]:
    """Rolling meal plan starting today. Each day: {date, day_label,
    workout_type, is_hard_day, meals: [{meal_type, ...full recipe}, ...]}."""
    today = datetime.utcnow().date()
    rows = conn.execute(
        "SELECT date, workout_type FROM planned_workouts WHERE date >= ? AND date <= ?",
        (today.isoformat(), (today + timedelta(days=days)).isoformat()),
    ).fetchall()
    workout_by_day = {r["date"]: r["workout_type"] for r in rows}
    ratings = get_recipe_ratings(conn)

    plan = []
    for i in range(days):
        day = today + timedelta(days=i)
        day_key = day.isoformat()
        is_hard_day = workout_by_day.get(day_key) in _HARD_WORKOUT_TYPES
        next_day_hard = workout_by_day.get((day + timedelta(days=1)).isoformat()) in _HARD_WORKOUT_TYPES
        epoch_day = (day - _EPOCH).days

        meals = []
        for meal_type in MEAL_TYPES:
            prefer_tag = None
            if meal_type == "breakfast" and is_hard_day:
                prefer_tag = "pre_run"
            elif meal_type == "dinner" and is_hard_day:
                prefer_tag = "recovery"
            elif meal_type == "dinner" and next_day_hard:
                prefer_tag = "pre_run"  # carb-load tonight for tomorrow's hard session

            index = epoch_day + _MEAL_OFFSET[meal_type]
            recipe = _pick(_RECIPES_BY_TYPE[meal_type], index, prefer_tag, ratings)
            meals.append({"meal_type": meal_type, "rating": ratings.get(recipe["id"]), **recipe})

        plan.append({
            "date": day_key,
            "day_label": day.strftime("%A %d/%m"),
            "workout_type": workout_by_day.get(day_key),
            "is_hard_day": is_hard_day,
            "meals": meals,
        })

    return plan


# Grocery-aisle grouping for the shopping list, keyed by the ingredient name
# with any trailing "(...)" qualifier stripped (see _strip_qualifier) and
# lowercased. Anything not listed here falls back to "Pantry & other" rather
# than erroring -- new recipes/ingredients still show up, just ungrouped.
CATEGORY_ORDER = [
    "Produce", "Dairy & eggs", "Meat & fish", "Grains, pasta & bread",
    "Canned, legumes & jars", "Condiments, oils & spices", "Pantry & other",
]
_CATEGORY_BY_ITEM = {
    **{k: "Produce" for k in (
        "asparagus", "avocado", "banana", "basil", "bell pepper", "blueberries", "broccoli",
        "carrot", "cherry tomatoes", "cucumber", "dill", "dried apricots", "garlic", "ginger",
        "grated carrot", "green beans", "lemon", "medjool dates", "mixed berries",
        "mixed salad leaves", "mushrooms", "onion", "pak choi", "pineapple chunks", "potatoes",
        "red onion", "salad leaves", "spinach", "sweet potato", "sweetcorn", "tomato",
    )},
    **{k: "Dairy & eggs" for k in (
        "butter", "cottage cheese", "egg", "eggs", "feta", "greek yogurt", "milk", "parmesan",
    )},
    **{k: "Meat & fish" for k in (
        "beef mince", "beef steak", "beef strips", "chicken breast", "salmon fillet", "shrimp",
        "tuna in water", "turkey breast slices", "turkey mince",
    )},
    **{k: "Grains, pasta & bread" for k in (
        "arborio rice", "breadcrumbs", "crusty bread", "egg noodles", "granola", "oat flour",
        "pasta", "pita bread", "quinoa", "rice", "rice cakes", "rice noodles", "rolled oats",
        "spaghetti", "wholegrain bread", "wholewheat wrap",
    )},
    **{k: "Canned, legumes & jars" for k in (
        "black beans", "chickpeas", "chopped tomatoes", "falafel", "kidney beans", "red lentils",
        "tomato passata", "tomato paste", "vegetable stock",
    )},
    **{k: "Condiments, oils & spices" for k in (
        "almond butter", "chili powder", "cinnamon", "cocoa powder", "cumin", "garlic powder",
        "honey", "hummus", "lemon juice", "maple syrup", "olive oil", "paprika", "peanut butter",
        "salt & pepper", "soy sauce", "tahini sauce", "vegetable oil",
    )},
    **{k: "Pantry & other" for k in ("almonds", "chia seeds", "whey protein powder", "white wine")},
}

_QUALIFIER_RE = re.compile(r"\s*\([^)]*\)\s*$")
_QTY_RE = re.compile(r"^\s*(\d+(?:[./]\d+)?)\s*([a-zA-Z]+)?")


def _strip_qualifier(item: str) -> str:
    """"Chopped tomatoes" from "Kidney beans (drained)" etc -- so the same
    ingredient used two different ways still groups into one shopping-list line."""
    return _QUALIFIER_RE.sub("", item).strip()


def _parse_qty(qty: str) -> tuple[float, str] | None:
    """Best-effort (value, unit) from a free-text quantity like "80 g" or
    "1/2". Returns None for non-numeric quantities ("to taste", "pinch",
    "handful", ...) so callers can fall back to listing them as-is instead
    of pretending a sum is meaningful."""
    m = _QTY_RE.match(qty)
    if not m:
        return None
    num_str, unit = m.groups()
    if "/" in num_str:
        n, d = num_str.split("/")
        value = float(n) / float(d)
    else:
        value = float(num_str)
    unit = (unit or "").lower()
    if len(unit) > 2 and unit.endswith("s"):
        unit = unit[:-1]  # "slices"/"cloves" -> "slice"/"clove" so plurals still group
    return value, unit


def _fmt_qty(value: float) -> str:
    return str(int(value)) if value == int(value) else f"{value:.2g}"


# tsp/tbsp are both common in these recipes for the same kind of ingredient
# (oil, honey) -- worth reconciling into one unit rather than falling back
# to a raw list just because one recipe said tsp and another said tbsp.
_SPOON_TO_TSP = {"tsp": 1.0, "tbsp": 3.0}


def _reconcile_units(parsed: list[tuple[float, str]]) -> list[tuple[float, str]]:
    units = {u for _, u in parsed}
    if units and units <= set(_SPOON_TO_TSP):
        return [(v * _SPOON_TO_TSP[u], "tsp") for v, u in parsed]
    return parsed


def get_shopping_list(conn, days: int = 7) -> dict:
    """Consolidated grocery list for the rolling meal plan: every ingredient
    across all `days` x 4 meals, summed where quantities share a parseable
    unit, grouped by grocery-aisle category. Repeats of the same recipe
    within the window count multiple times (you need to buy for each), so
    both quantities and the estimated total cost sum every meal slot, not
    just the distinct recipes used.
    """
    plan = get_meal_plan(conn, days)

    occurrences: dict[str, list] = defaultdict(list)
    total_cost = 0.0
    recipe_ids_used = set()
    for day in plan:
        for meal in day["meals"]:
            total_cost += meal.get("est_cost_eur") or 0.0
            recipe_ids_used.add(meal["id"])
            for ing in meal["ingredients"]:
                base = _strip_qualifier(ing["item"])
                occurrences[base].append((ing["qty"], _parse_qty(ing["qty"])))

    grouped: dict[str, list] = defaultdict(list)
    for base, occ in occurrences.items():
        parsed = _reconcile_units([p for _, p in occ if p])
        units = {p[1] for p in parsed}
        if len(parsed) == len(occ) and len(units) == 1:
            unit = next(iter(units))
            total = sum(p[0] for p in parsed)
            if unit == "tsp" and total >= 3 and total % 3 == 0:
                total, unit = total / 3, "tbsp"  # read back out as tbsp once it's a whole number of them
            quantity = f"{_fmt_qty(total)} {unit}".strip() if unit else f"{_fmt_qty(total)}x"
        else:
            # Mixed or non-numeric quantities ("pinch", "to taste", ...) --
            # list what's actually needed rather than a false-precision sum.
            counts = Counter(q for q, _ in occ)
            quantity = " + ".join(f"{q} (×{n})" if n > 1 else q for q, n in counts.items())
        category = _CATEGORY_BY_ITEM.get(base.lower(), "Pantry & other")
        grouped[category].append({"item": base, "quantity": quantity, "used_in": len(occ)})

    ordered_categories = CATEGORY_ORDER + sorted(c for c in grouped if c not in CATEGORY_ORDER)
    categories = [
        {"category": cat, "items": sorted(grouped[cat], key=lambda x: x["item"])}
        for cat in ordered_categories
        if grouped.get(cat)
    ]

    return {
        "days": days,
        "total_estimated_cost_eur": round(total_cost, 2),
        "distinct_recipes": len(recipe_ids_used),
        "categories": categories,
    }
