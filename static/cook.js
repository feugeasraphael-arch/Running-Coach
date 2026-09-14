async function fetchJSON(url) {
    try {
        const res = await fetch(url);
        return await res.json();
    } catch (err) {
        return { status: "no_data", detail: String(err) };
    }
}

const MEAL_LABEL = { breakfast: "Breakfast", lunch: "Lunch", snack: "Snack", dinner: "Dinner" };
const MEAL_ICON = { breakfast: "\u{1F373}", lunch: "\u{1F957}", snack: "\u{1F34C}", dinner: "\u{1F35D}" };

const WORKOUT_BADGE = {
    long: { text: "Long run", cls: "badge-hard" },
    interval: { text: "Interval", cls: "badge-hard" },
    benchmark: { text: "Benchmark test", cls: "badge-hard" },
    easy: { text: "Easy run", cls: "badge-easy" },
};

// meal_type -> recipe, keyed by "YYYY-MM-DD|meal_type" for the detail overlay
let mealIndex = {};
// recipe -> recipe, keyed by "chef|<recipe_id>" -- the full library, independent of the rolling plan
let chefIndex = {};

const RATING_ICON = { like: "\u{1F44D}", dislike: "\u{1F44E}" };

function findMeal(key) {
    return mealIndex[key] || chefIndex[key];
}

function fmtCost(v) {
    return v != null ? `€${v.toFixed(2)}` : "–";
}

function renderMealChip(dateKey, meal) {
    const ratingBadge = meal.rating ? `<span class="meal-rating-badge">${RATING_ICON[meal.rating]}</span>` : "";
    return `
        <button class="meal-chip" data-key="${dateKey}|${meal.meal_type}">
            <div class="meal-chip-top">
                <span class="meal-type-label">${MEAL_ICON[meal.meal_type] || ""} ${MEAL_LABEL[meal.meal_type] || meal.meal_type}</span>
                <span class="meal-cal">${meal.macros.calories} kcal</span>
            </div>
            <div class="meal-chip-name">${ratingBadge}${meal.name}</div>
            <div class="meal-chip-bottom">
                <span>${meal.prep_time_min} min</span>
                <span>${fmtCost(meal.est_cost_eur)}</span>
            </div>
        </button>`;
}

function renderDay(day) {
    mealIndex = mealIndex || {};
    day.meals.forEach((m) => {
        mealIndex[`${day.date}|${m.meal_type}`] = { ...m, day_label: day.day_label };
    });

    const badge = WORKOUT_BADGE[day.workout_type];
    const badgeHtml = badge
        ? `<span class="status-badge ${badge.cls}">${badge.text}</span>`
        : day.workout_type === null
            ? ""
            : `<span class="status-badge badge-rest">Rest</span>`;

    const dateObj = new Date(`${day.date}T00:00:00`);
    const isToday = day.date === new Date().toISOString().slice(0, 10);

    return `
        <div class="card cook-day">
            <div class="card-header">
                <h2>${isToday ? "Today" : dateObj.toLocaleDateString(undefined, { weekday: "long" })} &middot; ${dateObj.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</h2>
                ${badgeHtml}
            </div>
            <div class="meal-grid">
                ${day.meals.map((m) => renderMealChip(day.date, m)).join("")}
            </div>
        </div>`;
}

async function loadMealPlan() {
    const container = document.getElementById("meal-plan-list");
    const data = await fetchJSON("/api/meal-plan?days=7");

    if (!Array.isArray(data)) {
        container.innerHTML = `<div class="card"><div class="empty-state">${(data && data.detail) || "No meal plan available yet."}</div></div>`;
        return;
    }

    mealIndex = {};
    container.innerHTML = `<div class="cook-day-list">${data.map(renderDay).join("")}</div>`;
}

function closeMealDetail() {
    document.getElementById("meal-overlay").hidden = true;
}

function openMealDetail(key) {
    const meal = findMeal(key);
    const overlay = document.getElementById("meal-overlay");
    const content = document.getElementById("meal-content");
    if (!meal) {
        content.innerHTML = `<div class="empty-state">Couldn't find that meal.</div>`;
        overlay.hidden = false;
        return;
    }

    const stats = [
        ["Calories", meal.macros.calories],
        ["Protein", `${meal.macros.protein_g} g`],
        ["Carbs", `${meal.macros.carbs_g} g`],
        ["Fat", `${meal.macros.fat_g} g`],
    ];

    const ingredientsHtml = meal.ingredients
        .map((i) => `<li><span class="ingredient-item">${i.item}</span><span class="ingredient-qty">${i.qty}</span></li>`)
        .join("");
    const stepsHtml = meal.steps.map((s) => `<li>${s}</li>`).join("");

    const subtitleParts = [MEAL_LABEL[meal.meal_type] || meal.meal_type];
    if (meal.day_label) subtitleParts.push(meal.day_label);
    subtitleParts.push(`${meal.prep_time_min} min`, `~${fmtCost(meal.est_cost_eur)}`);

    content.innerHTML = `
        <div class="detail-header">
            <h2>${meal.name}</h2>
            <div class="subtitle">${subtitleParts.join(" &middot; ")}</div>
        </div>
        <div class="rating-row" data-rating-key="${key}">
            <button class="rating-btn${meal.rating === "like" ? " active-like" : ""}" data-rating="like">\u{1F44D} Like</button>
            <button class="rating-btn${meal.rating === "dislike" ? " active-dislike" : ""}" data-rating="dislike">\u{1F44E} Dislike</button>
        </div>
        <div class="detail-stats">
            ${stats.map(([label, value]) => `<div class="stat"><div class="value">${value}</div><div class="label">${label}</div></div>`).join("")}
        </div>
        <div class="detail-section-title">Ingredients</div>
        <ul class="ingredient-list">${ingredientsHtml}</ul>
        <div class="detail-section-title">Recipe</div>
        <ol class="recipe-steps">${stepsHtml}</ol>
        <div class="tip-box">\u{1F4A1} ${meal.tip}</div>
    `;
    overlay.hidden = false;
}

// Toggling a rating never re-navigates whatever's currently open -- it just
// flips the two buttons in place (wherever `key` is rendered: the detail
// modal, a Chef's Menu row, or both at once) and refreshes the rolling plan
// and Chef's Menu list in the background. That's what makes a disliked
// recipe disappear from the day view without yanking the modal you're
// looking at over to a replacement recipe you didn't ask to see.
async function rateRecipe(key, rating) {
    const meal = findMeal(key);
    if (!meal) return;
    const newRating = meal.rating === rating ? null : rating;
    meal.rating = newRating;
    updateRatingButtonsInDOM(key, newRating);

    try {
        await fetch("/api/recipe-rating", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipe_id: meal.id, rating: newRating }),
        });
    } catch (err) {
        // best-effort -- a later reload reconciles state if this silently failed
    }

    loadMealPlan();
    if (!document.getElementById("chef-overlay").hidden) loadChefsMenu();
}

function updateRatingButtonsInDOM(key, newRating) {
    document.querySelectorAll(`[data-rating-key="${key}"]`).forEach((wrap) => {
        wrap.querySelectorAll(".rating-btn").forEach((btn) => {
            const kind = btn.dataset.rating;
            btn.classList.toggle("active-like", kind === "like" && newRating === "like");
            btn.classList.toggle("active-dislike", kind === "dislike" && newRating === "dislike");
        });
    });
}

function renderChefRow(recipe) {
    const key = `chef|${recipe.id}`;
    return `
        <div class="chef-row" data-key="${key}">
            <div class="chef-row-main">
                <div class="chef-row-name">${recipe.name}</div>
                <div class="chef-row-meta">${recipe.prep_time_min} min &middot; ${fmtCost(recipe.est_cost_eur)} &middot; ${recipe.macros.calories} kcal</div>
            </div>
            <div class="rating-row chef-row-ratings" data-rating-key="${key}">
                <button class="rating-btn${recipe.rating === "like" ? " active-like" : ""}" data-rating="like">\u{1F44D}</button>
                <button class="rating-btn${recipe.rating === "dislike" ? " active-dislike" : ""}" data-rating="dislike">\u{1F44E}</button>
            </div>
        </div>`;
}

async function loadChefsMenu() {
    const content = document.getElementById("chef-content");
    const data = await fetchJSON("/api/recipes");

    if (!Array.isArray(data)) {
        content.innerHTML = `<div class="empty-state">${(data && data.detail) || "No recipes available."}</div>`;
        return;
    }

    chefIndex = {};
    const byType = {};
    data.forEach((r) => {
        chefIndex[`chef|${r.id}`] = r;
        (byType[r.meal_type] = byType[r.meal_type] || []).push(r);
    });

    const sectionsHtml = Object.keys(MEAL_LABEL)
        .filter((type) => byType[type] && byType[type].length)
        .map(
            (type) => `
        <div class="chef-section">
            <div class="chef-section-title">${MEAL_ICON[type] || ""} ${MEAL_LABEL[type]}</div>
            <div class="chef-list">${byType[type].map(renderChefRow).join("")}</div>
        </div>`
        )
        .join("");

    content.innerHTML = `
        <div class="detail-header">
            <h2>The Chef's Menu</h2>
            <div class="subtitle">Every recipe in the library &middot; ${data.length} total</div>
        </div>
        ${sectionsHtml}
    `;
}

function openChefsMenu() {
    document.getElementById("chef-overlay").hidden = false;
    document.getElementById("chef-content").innerHTML = `<div class="empty-state">Loading…</div>`;
    loadChefsMenu();
}

function closeChefsMenu() {
    document.getElementById("chef-overlay").hidden = true;
}

function closeShoppingList() {
    document.getElementById("shopping-overlay").hidden = true;
}

function shoppingListAsText(data) {
    const lines = [`Shopping list — next ${data.days} days (~€${data.total_estimated_cost_eur.toFixed(2)})`, ""];
    data.categories.forEach((cat) => {
        lines.push(cat.category.toUpperCase());
        cat.items.forEach((item) => lines.push(`- ${item.item}: ${item.quantity}`));
        lines.push("");
    });
    return lines.join("\n").trim();
}

async function openShoppingList() {
    const overlay = document.getElementById("shopping-overlay");
    const content = document.getElementById("shopping-content");
    content.innerHTML = `<div class="empty-state">Loading…</div>`;
    overlay.hidden = false;

    const data = await fetchJSON("/api/shopping-list?days=7");
    if (!data || !data.categories) {
        content.innerHTML = `<div class="empty-state">${(data && data.detail) || "No shopping list available yet."}</div>`;
        return;
    }

    const categoriesHtml = data.categories
        .map(
            (cat) => `
        <div class="shopping-category">
            <div class="shopping-category-title">${cat.category}</div>
            <ul class="shopping-list">
                ${cat.items.map((i) => `<li><span>${i.item}</span><span class="shopping-qty">${i.quantity}</span></li>`).join("")}
            </ul>
        </div>`
        )
        .join("");

    content.innerHTML = `
        <div class="detail-header">
            <h2>Shopping list</h2>
            <div class="subtitle">Next ${data.days} days &middot; ${data.distinct_recipes} distinct recipes</div>
        </div>
        <div class="shopping-summary">
            <div class="stat"><div class="value">€${data.total_estimated_cost_eur.toFixed(2)}</div><div class="label">Est. total cost</div></div>
        </div>
        ${categoriesHtml}
        <div style="margin-top:16px">
            <button id="shopping-copy-btn" class="btn-secondary">Copy as text</button>
        </div>
    `;

    document.getElementById("shopping-copy-btn").addEventListener("click", async () => {
        const btn = document.getElementById("shopping-copy-btn");
        try {
            await navigator.clipboard.writeText(shoppingListAsText(data));
            btn.textContent = "Copied!";
        } catch (err) {
            btn.textContent = "Couldn't copy";
        }
        setTimeout(() => { btn.textContent = "Copy as text"; }, 1500);
    });
}

async function handleUpdateClick() {
    const btn = document.getElementById("update-btn");
    const status = document.getElementById("update-status");
    btn.disabled = true;
    btn.textContent = "Updating…";
    status.textContent = "";

    try {
        const res = await fetch("/api/sync", { method: "POST" });
        const result = await res.json();
        const parts = Object.entries(result).map(
            ([source, r]) => `${source}: ${r.ok ? "ok" : "failed"}${r.message ? ` (${r.message})` : ""}`
        );
        status.textContent = parts.join(" · ");
    } catch (err) {
        status.textContent = `Update failed: ${err}`;
    } finally {
        btn.disabled = false;
        btn.textContent = "Update";
        loadMealPlan();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadMealPlan();
    document.getElementById("update-btn").addEventListener("click", handleUpdateClick);
    document.getElementById("meal-close").addEventListener("click", closeMealDetail);
    document.getElementById("meal-overlay").addEventListener("click", (e) => {
        if (e.target.id === "meal-overlay") closeMealDetail();
    });
    document.getElementById("meal-plan-list").addEventListener("click", (e) => {
        const chip = e.target.closest(".meal-chip");
        if (chip) openMealDetail(chip.dataset.key);
    });
    document.getElementById("shopping-list-btn").addEventListener("click", openShoppingList);
    document.getElementById("shopping-close").addEventListener("click", closeShoppingList);
    document.getElementById("shopping-overlay").addEventListener("click", (e) => {
        if (e.target.id === "shopping-overlay") closeShoppingList();
    });
    document.getElementById("chef-menu-btn").addEventListener("click", openChefsMenu);
    document.getElementById("chef-close").addEventListener("click", closeChefsMenu);
    document.getElementById("chef-overlay").addEventListener("click", (e) => {
        if (e.target.id === "chef-overlay") closeChefsMenu();
    });
    document.getElementById("chef-content").addEventListener("click", (e) => {
        if (e.target.closest(".rating-btn")) return;
        const row = e.target.closest(".chef-row");
        if (row) openMealDetail(row.dataset.key);
    });
    // Delegated at document level so rating buttons work no matter which
    // surface rendered them (day-plan detail modal or a Chef's Menu row),
    // without re-binding a fresh listener every time either re-renders.
    document.addEventListener("click", (e) => {
        const btn = e.target.closest(".rating-btn");
        if (!btn) return;
        const wrap = btn.closest("[data-rating-key]");
        if (!wrap) return;
        rateRecipe(wrap.dataset.ratingKey, btn.dataset.rating);
    });
});
