function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const CHART_COLOR = {
    blue: cssVar("--accent"),
    red: cssVar("--bad"),
    purple: cssVar("--chart-purple"),
    green: cssVar("--chart-green"),
    text: cssVar("--text-dim"),
    grid: cssVar("--border"),
};

if (window.Chart) {
    Chart.defaults.color = CHART_COLOR.text;
    Chart.defaults.borderColor = CHART_COLOR.grid;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
}

// --- Time-range picker shared by every trend chart ----------------------
// "weeks" feeds the two weekly-aggregated endpoints (weekly-mileage,
// pace-trend — the backend only buckets those by week, so "Today"/"1 week"
// both just show the current week); "days" feeds the daily wellness-trend
// endpoint (sleep, body battery, heart rate, VO2max).
const RANGES = [
    { key: "today", label: "Today", days: 1, weeks: 1 },
    { key: "1w", label: "1 week", days: 7, weeks: 1 },
    { key: "1m", label: "1 month", days: 30, weeks: 4 },
    { key: "3m", label: "3 months", days: 90, weeks: 13 },
    { key: "1y", label: "1 year", days: 365, weeks: 52 },
    { key: "all", label: "All time", days: 3650, weeks: 300 },
];
const DEFAULT_RANGE = "1m";

function rangeInfo(key) {
    return RANGES.find((r) => r.key === key) || rangeInfo(DEFAULT_RANGE);
}

// Remembers each chart's current selection so it survives an Update-triggered
// re-render instead of snapping back to the 1-month default every time.
const chartRangeState = {
    "weekly-mileage": DEFAULT_RANGE,
    "pace-trend": DEFAULT_RANGE,
    "sleep-trend": DEFAULT_RANGE,
    "body-battery-trend": DEFAULT_RANGE,
    "heart-rate-trend": DEFAULT_RANGE,
};

function skeleton(kind = "list") {
    if (kind === "chart") {
        return `<div class="skeleton"><div class="skeleton-bar tall"></div></div>`;
    }
    if (kind === "stats") {
        return `<div class="skeleton"><div class="skeleton-bar short"></div><div class="skeleton-bar"></div><div class="skeleton-bar"></div></div>`;
    }
    return `<div class="skeleton"><div class="skeleton-bar short"></div><div class="skeleton-bar"></div><div class="skeleton-bar"></div><div class="skeleton-bar"></div></div>`;
}

// Cards keep their <h2> title (and, for chart cards, the expand button in
// .card-header) in the DOM permanently; all dynamic content (loading
// skeleton, empty state, or real data) goes into a sibling .card-body so a
// render pass never wipes the title/button out from under it.
function cardBody(container) {
    let body = container.querySelector(":scope > .card-body");
    if (!body) {
        body = document.createElement("div");
        body.className = "card-body";
        container.appendChild(body);
    }
    return body;
}

async function fetchJSON(url) {
    try {
        const res = await fetch(url);
        return await res.json();
    } catch (err) {
        return { status: "no_data", detail: String(err) };
    }
}

function isNoData(resp) {
    return !resp || resp.status === "no_data";
}

function emptyState(container, message) {
    cardBody(container).innerHTML = `<div class="empty-state">${message}</div>`;
}

function fmtPace(secPerKm) {
    if (secPerKm == null) return "–";
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return `${m}:${String(s).padStart(2, "0")}/km`;
}

function fmtKm(m) {
    if (m == null) return "–";
    return (m / 1000).toFixed(1);
}

function fmtDuration(sec) {
    if (sec == null) return "–";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.round(sec % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// --- Expandable charts ------------------------------------------------
// Each renderX() below builds its small in-card chart, then registers a
// `build(canvas)` closure (capturing the already-fetched data) under a key.
// Clicking a card's expand button re-runs that same closure against the
// overlay's canvas, so the big view is guaranteed to match the small one —
// no separate "large chart" config to keep in sync.
const chartBuilders = {};
let expandedChart = null;

const RANGE_SHORT_LABEL = { today: "Today", "1w": "1W", "1m": "1M", "3m": "3M", "1y": "1Y", all: "All" };

function rangePickerButtonsHtml(activeKey) {
    return RANGES.map(
        (r) => `<button data-range="${r.key}" title="${r.label}" class="${r.key === activeKey ? "active" : ""}">${RANGE_SHORT_LABEL[r.key]}</button>`
    ).join("");
}

function openChartOverlay(key, title) {
    document.getElementById("chart-overlay-title").textContent = title;
    if (expandedChart) {
        expandedChart.destroy();
        expandedChart = null;
    }
    const rangeEl = document.getElementById("chart-overlay-range");

    if (key === VO2_KEY) {
        rangeEl.style.display = "flex";
        rangeEl.innerHTML = rangePickerButtonsHtml(vo2RangeKey);
        document.getElementById("chart-overlay").hidden = false;
        renderVo2maxHistory(vo2RangeKey);
        return;
    }

    rangeEl.style.display = "none";
    rangeEl.innerHTML = "";
    const wrap = document.getElementById("chart-overlay-wrap");
    wrap.innerHTML = `<canvas id="chart-overlay-canvas"></canvas>`;
    const build = chartBuilders[key];
    if (build) expandedChart = build(document.getElementById("chart-overlay-canvas"));
    document.getElementById("chart-overlay").hidden = false;
}

function closeChartOverlay() {
    document.getElementById("chart-overlay").hidden = true;
    if (expandedChart) {
        expandedChart.destroy();
        expandedChart = null;
    }
}

const ACWR_ZONE = {
    no_data: { cls: "", headline: "Not enough data yet" },
    undertrained: { cls: "rec-moderate", headline: "Room to build back up" },
    sweet_spot: { cls: "rec-easy", headline: "On track" },
    caution: { cls: "rec-hard", headline: "Load is elevated" },
    high_injury_risk: { cls: "rec-rest", headline: "Back off this week" },
};

async function renderCoachSummary() {
    const el = document.getElementById("banner");
    const data = await fetchJSON("/api/coach-summary");
    if (isNoData(data) || !data.acwr) {
        el.className = "banner";
        el.innerHTML = `<div class="headline">No recommendation yet</div><div class="detail">Sync some activities to get your first coaching update.</div>`;
        return;
    }
    const zone = ACWR_ZONE[data.acwr.flag] ?? { cls: "", headline: "Today's guidance" };
    el.className = `banner ${zone.cls}`;
    el.innerHTML = `<div class="headline">${zone.headline}</div><div class="detail">${data.recommendation ?? ""}</div>`;
}

async function renderWeeklyMileage(rangeKey = chartRangeState["weekly-mileage"]) {
    chartRangeState["weekly-mileage"] = rangeKey;
    const container = document.getElementById("weekly-mileage-card");
    const body = cardBody(container);
    body.innerHTML = skeleton("chart");
    const data = await fetchJSON(`/api/weekly-mileage?weeks=${rangeInfo(rangeKey).weeks}`);
    if (isNoData(data) || !Array.isArray(data) || data.length === 0) {
        return emptyState(container, "No weekly mileage yet.");
    }
    function build(canvas) {
        return new Chart(canvas, {
            type: "bar",
            data: {
                labels: data.map((d) => d.week_start),
                datasets: [
                    {
                        label: "km",
                        data: data.map((d) => d.distance_km),
                        backgroundColor: CHART_COLOR.blue,
                        borderRadius: 4,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { afterLabel: (ctx) => `${data[ctx.dataIndex].num_runs} run(s)` } },
                },
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: "km" }, grid: { color: CHART_COLOR.grid } },
                    x: { grid: { display: false } },
                },
            },
        });
    }
    body.innerHTML = `<div class="chart-wrap"><canvas></canvas></div>`;
    build(body.querySelector("canvas"));
    chartBuilders["weekly-mileage"] = build;
}

async function renderPaceTrend(rangeKey = chartRangeState["pace-trend"]) {
    chartRangeState["pace-trend"] = rangeKey;
    const container = document.getElementById("pace-trend-card");
    const body = cardBody(container);
    body.innerHTML = skeleton("chart");
    const data = await fetchJSON(`/api/pace-trend?weeks=${rangeInfo(rangeKey).weeks}`);
    if (isNoData(data) || !Array.isArray(data) || data.length === 0) {
        return emptyState(container, "No runs with pace data yet.");
    }
    function build(canvas) {
        return new Chart(canvas, {
            type: "line",
            data: {
                labels: data.map((d) => d.week_start),
                datasets: [
                    {
                        label: "Pace (s/km, lower = faster)",
                        data: data.map((d) => d.avg_pace_s_per_km),
                        borderColor: CHART_COLOR.blue,
                        yAxisID: "pace",
                        tension: 0.2,
                    },
                    {
                        label: "Avg HR",
                        data: data.map((d) => d.avg_hr),
                        borderColor: CHART_COLOR.red,
                        yAxisID: "hr",
                        tension: 0.2,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (ctx) =>
                                ctx.dataset.yAxisID === "pace"
                                    ? `Pace: ${fmtPace(ctx.raw)}`
                                    : `HR: ${ctx.raw ?? "–"} bpm`,
                        },
                    },
                },
                scales: {
                    pace: { type: "linear", position: "left", reverse: true, title: { display: true, text: "pace" }, grid: { color: CHART_COLOR.grid } },
                    hr: { type: "linear", position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "bpm" } },
                },
            },
        });
    }
    body.innerHTML = `<div class="chart-wrap"><canvas></canvas></div>`;
    build(body.querySelector("canvas"));
    chartBuilders["pace-trend"] = build;
}

const ACWR_ZONE_LABEL = {
    undertrained: "Undertrained",
    sweet_spot: "Sweet spot",
    caution: "Caution",
    high_injury_risk: "High injury risk",
};

// compute_acwr() returns only a current snapshot, not a history series, so
// this renders as a gauge (position on a 0-2.0 ratio track) rather than a
// trend line. Band edges (0.8 / 1.3 / 1.5) mirror the thresholds in coach.py.
async function renderAcwr() {
    const container = document.getElementById("acwr-card");
    const body = cardBody(container);
    body.innerHTML = skeleton("stats");
    const data = await fetchJSON("/api/acwr");
    if (isNoData(data) || !data.flag || data.flag === "no_data") {
        return emptyState(container, "Not enough training history for ACWR yet (need a few weeks of runs).");
    }
    const max = 2.0;
    const pct = Math.min(data.ratio / max, 1) * 100;
    body.innerHTML = `
        <div class="acwr-gauge">
            <div class="acwr-track">
                <div class="acwr-band undertrained" style="width:${(0.8 / max) * 100}%"></div>
                <div class="acwr-band sweet_spot" style="width:${((1.3 - 0.8) / max) * 100}%"></div>
                <div class="acwr-band caution" style="width:${((1.5 - 1.3) / max) * 100}%"></div>
                <div class="acwr-band high_injury_risk" style="width:${((max - 1.5) / max) * 100}%"></div>
                <div class="acwr-marker" style="left:${pct}%"></div>
            </div>
        </div>
        <div class="recovery-stats" style="margin-top:14px">
            <div class="stat"><div class="value">${data.ratio.toFixed(2)}</div><div class="label">Ratio (${ACWR_ZONE_LABEL[data.flag] ?? data.flag})</div></div>
            <div class="stat"><div class="value">${data.acute_km.toFixed(1)} km</div><div class="label">Last 7 days</div></div>
            <div class="stat"><div class="value">${data.chronic_km.toFixed(1)} km/wk</div><div class="label">28-day avg</div></div>
        </div>`;
}

const RECOVERY_STATUS_LABEL = {
    well_recovered: "Well recovered vs. your last 7 days",
    fatigued: "Recovery signals down vs. your last 7 days",
    normal: "In line with your last 7 days",
};

async function renderRecovery() {
    const container = document.getElementById("recovery-card");
    const body = cardBody(container);
    body.innerHTML = skeleton("stats");
    const data = await fetchJSON("/api/recovery");
    if (isNoData(data)) {
        return emptyState(container, "No Garmin wellness data synced yet.");
    }
    const stats = [
        ["Readiness", data.training_readiness != null ? Math.round(data.training_readiness) : "–"],
        ["HRV", data.hrv_ms != null ? `${Math.round(data.hrv_ms)} ms` : "–"],
        ["Body battery (high)", data.body_battery_high != null ? Math.round(data.body_battery_high) : "–"],
        ["7d avg readiness", data.prior_7d_avg_training_readiness != null ? Math.round(data.prior_7d_avg_training_readiness) : "–"],
    ];
    body.innerHTML = `
        <div class="recovery-stats">
            ${stats.map(([label, value]) => `<div class="stat"><div class="value">${value}</div><div class="label">${label}</div></div>`).join("")}
        </div>
        <div class="subtitle" style="margin-top:12px">${RECOVERY_STATUS_LABEL[data.status] ?? ""}</div>
    `;
}

async function renderSleepTrend(rangeKey = chartRangeState["sleep-trend"]) {
    chartRangeState["sleep-trend"] = rangeKey;
    const container = document.getElementById("sleep-trend-card");
    const body = cardBody(container);
    body.innerHTML = skeleton("chart");
    const data = await fetchJSON(`/api/wellness-trend?days=${rangeInfo(rangeKey).days}`);
    if (isNoData(data) || !Array.isArray(data) || !data.some((d) => d.sleep_hours != null)) {
        return emptyState(container, "No Garmin sleep history in this range.");
    }
    function build(canvas) {
        return new Chart(canvas, {
            type: "line",
            data: {
                labels: data.map((d) => d.date),
                datasets: [
                    {
                        label: "Sleep (hours)",
                        data: data.map((d) => d.sleep_hours),
                        borderColor: CHART_COLOR.purple,
                        spanGaps: true,
                        tension: 0.2,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { title: { display: true, text: "hours" }, grid: { color: CHART_COLOR.grid } },
                    x: { grid: { display: false } },
                },
            },
        });
    }
    body.innerHTML = `<div class="chart-wrap"><canvas></canvas></div>`;
    build(body.querySelector("canvas"));
    chartBuilders["sleep-trend"] = build;
}

async function renderBodyBatteryTrend(rangeKey = chartRangeState["body-battery-trend"]) {
    chartRangeState["body-battery-trend"] = rangeKey;
    const container = document.getElementById("body-battery-card");
    const body = cardBody(container);
    body.innerHTML = skeleton("chart");
    const data = await fetchJSON(`/api/wellness-trend?days=${rangeInfo(rangeKey).days}`);
    if (isNoData(data) || !Array.isArray(data) || !data.some((d) => d.body_battery_high != null)) {
        return emptyState(container, "No Garmin body battery history in this range.");
    }
    function build(canvas) {
        return new Chart(canvas, {
            type: "line",
            data: {
                labels: data.map((d) => d.date),
                datasets: [
                    {
                        label: "Body battery (high)",
                        data: data.map((d) => d.body_battery_high),
                        borderColor: CHART_COLOR.green,
                        spanGaps: true,
                        tension: 0.2,
                    },
                    {
                        label: "Body battery (low)",
                        data: data.map((d) => d.body_battery_low),
                        borderColor: CHART_COLOR.green,
                        borderDash: [4, 4],
                        spanGaps: true,
                        tension: 0.2,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    tooltip: {
                        callbacks: {
                            afterBody: (items) => {
                                const d = data[items[0].dataIndex];
                                return d.stress_avg != null ? `Avg stress: ${Math.round(d.stress_avg)}` : "";
                            },
                        },
                    },
                },
                scales: {
                    y: { min: 0, max: 100, title: { display: true, text: "body battery" }, grid: { color: CHART_COLOR.grid } },
                    x: { grid: { display: false } },
                },
            },
        });
    }
    body.innerHTML = `<div class="chart-wrap"><canvas></canvas></div>`;
    build(body.querySelector("canvas"));
    chartBuilders["body-battery-trend"] = build;
}

async function renderHeartRateTrend(rangeKey = chartRangeState["heart-rate-trend"]) {
    chartRangeState["heart-rate-trend"] = rangeKey;
    const container = document.getElementById("heart-rate-trend-card");
    const body = cardBody(container);
    body.innerHTML = skeleton("chart");
    const data = await fetchJSON(`/api/wellness-trend?days=${rangeInfo(rangeKey).days}`);
    if (isNoData(data) || !Array.isArray(data) || data.length === 0) {
        return emptyState(container, "No Garmin heart-rate history yet.");
    }
    const hasAny = data.some((d) => d.resting_hr != null || d.avg_hr_day != null);
    if (!hasAny) {
        return emptyState(container, "No resting/average heart-rate history yet.");
    }
    function build(canvas) {
        return new Chart(canvas, {
            type: "line",
            data: {
                labels: data.map((d) => d.date),
                datasets: [
                    {
                        label: "Resting HR",
                        data: data.map((d) => d.resting_hr),
                        borderColor: CHART_COLOR.red,
                        spanGaps: true,
                        pointRadius: 0,
                        tension: 0.2,
                    },
                    {
                        label: "Average HR (24h)",
                        data: data.map((d) => d.avg_hr_day),
                        borderColor: CHART_COLOR.blue,
                        spanGaps: true,
                        pointRadius: 0,
                        tension: 0.2,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                scales: {
                    y: { title: { display: true, text: "bpm" }, grid: { color: CHART_COLOR.grid } },
                    x: { grid: { display: false } },
                },
            },
        });
    }
    body.innerHTML = `<div class="chart-wrap"><canvas></canvas></div>`;
    build(body.querySelector("canvas"));
    chartBuilders["heart-rate-trend"] = build;
}

async function renderRacePredictions() {
    const container = document.getElementById("race-predictions-card");
    const body = cardBody(container);
    body.innerHTML = skeleton("stats");
    const data = await fetchJSON("/api/race-predictions?days=120");
    if (isNoData(data) || !data.predictions) {
        return emptyState(container, "Not enough recent runs yet to predict race times.");
    }
    const items = data.predictions
        .map((p) => {
            const real = p.real_time_s != null
                ? `<div class="race-real">${fmtDuration(p.real_time_s)}</div>`
                : `<div class="race-real no-data">Not yet run</div>`;
            const predicted = p.predicted_time_s != null
                ? `<div class="race-predicted">predicted ${fmtDuration(p.predicted_time_s)}</div>`
                : "";
            return `<div class="race-item">
                <div class="race-label">${p.label}</div>
                ${real}
                ${predicted}
            </div>`;
        })
        .join("");

    const ref = data.reference;
    const refHtml = ref
        ? `<div class="race-reference">Predictions based on your best recent effort: ${ref.name ?? "a run"}
            (${fmtKm(ref.distance_m)} km in ${fmtDuration(ref.time_s)}, ${new Date(ref.date).toLocaleDateString()}).</div>`
        : "";

    body.innerHTML = `<div class="race-grid">${items}</div>${refHtml}`;
}

// --- VO2max stat + history ----------------------------------------------
// Rough general-population running bands (not personalized by age/sex —
// coach.py doesn't expose norms), just enough to color-code "how good is
// this number" at a glance.
function vo2maxColor(v) {
    if (v < 35) return CHART_COLOR.red;
    if (v < 42) return cssVar("--warn");
    if (v < 48) return CHART_COLOR.blue;
    if (v < 55) return CHART_COLOR.green;
    return CHART_COLOR.purple;
}
function vo2maxLabel(v) {
    if (v < 35) return "Below average";
    if (v < 42) return "Fair";
    if (v < 48) return "Good";
    if (v < 55) return "Very good";
    return "Excellent";
}

async function renderVo2maxCard() {
    const container = document.getElementById("vo2max-card");
    const body = cardBody(container);
    body.innerHTML = skeleton("stats");
    const data = await fetchJSON("/api/wellness-trend?days=365");
    const withReading = Array.isArray(data) ? data.filter((d) => d.vo2max != null) : [];
    if (isNoData(data) || !withReading.length) {
        return emptyState(container, "No VO2max readings yet.");
    }
    const latest = withReading[withReading.length - 1];
    const color = vo2maxColor(latest.vo2max);
    body.innerHTML = `
        <div class="vo2max-value" style="color:${color}">${latest.vo2max.toFixed(1)}</div>
        <div class="vo2max-caption" style="color:${color}">${vo2maxLabel(latest.vo2max)}</div>
        <div class="subtitle" style="margin-top:6px">ml/kg/min · as of ${new Date(latest.date).toLocaleDateString()}</div>
    `;
}

// VO2max has no small in-card chart (it's a single stat), so its history
// chart — and the only place it needs a range picker — lives entirely
// inside the expand overlay. See openChartOverlay()'s VO2_KEY special case.
const VO2_KEY = "vo2max-trend";
let vo2RangeKey = DEFAULT_RANGE;

async function renderVo2maxHistory(rangeKey) {
    vo2RangeKey = rangeKey;
    const wrap = document.getElementById("chart-overlay-wrap");
    wrap.innerHTML = skeleton("chart");
    const data = await fetchJSON(`/api/wellness-trend?days=${rangeInfo(rangeKey).days}`);
    const points = Array.isArray(data) ? data.filter((d) => d.vo2max != null) : [];
    if (!points.length) {
        wrap.innerHTML = `<div class="empty-state">No VO2max history in this range.</div>`;
        return;
    }
    wrap.innerHTML = `<canvas id="chart-overlay-canvas"></canvas>`;
    expandedChart = new Chart(document.getElementById("chart-overlay-canvas"), {
        type: "line",
        data: {
            labels: points.map((d) => d.date),
            datasets: [
                {
                    label: "VO2max",
                    data: points.map((d) => d.vo2max),
                    borderColor: CHART_COLOR.purple,
                    tension: 0.2,
                    pointRadius: points.length < 60 ? 3 : 0,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { title: { display: true, text: "ml/kg/min" }, grid: { color: CHART_COLOR.grid } },
                x: { grid: { display: false } },
            },
        },
    });
}

// --- Recent activities sidebar + full-history overlay + heatmap ---------
// One fetch (a generous limit so the heatmap has years of history to page
// through) feeds the sidebar's 5-most-recent list, the "View all" overlay,
// and the training heatmap below — avoiding three separate round-trips.
let allActivitiesCache = [];

async function loadActivities() {
    const data = await fetchJSON("/api/activities?limit=5000");
    allActivitiesCache = isNoData(data) || !Array.isArray(data) ? [] : data;
    return allActivitiesCache;
}

function activityRowHtml(a) {
    return `<tr class="activity-row" data-id="${a.id}">
        <td data-label="Date">${new Date(a.start_time).toLocaleDateString()}</td>
        <td data-label="Name" class="cell-wrap">${a.name ?? ""}</td>
        <td data-label="Type">${a.sport_type ?? ""}</td>
        <td data-label="Distance">${fmtKm(a.distance_m)} km</td>
        <td data-label="Pace">${fmtPace(a.avg_pace_s_per_km)}</td>
        <td data-label="HR">${a.avg_hr != null ? Math.round(a.avg_hr) : "–"}</td>
        <td data-label="Source" style="text-transform:capitalize">${a.source}</td>
    </tr>`;
}

async function renderRecentActivities(activitiesP) {
    const container = document.getElementById("recent-activities-card");
    const body = cardBody(container);
    body.innerHTML = skeleton("list");
    const data = await activitiesP;
    if (!data.length) {
        return emptyState(container, "No activities synced yet. Run your Strava/Garmin sync scripts, then refresh.");
    }
    const recent = data.slice(0, 5);
    const items = recent
        .map(
            (a) => `<button class="mini-activity-item" data-id="${a.id}">
                <div class="mini-top">
                    <span>${a.name || a.sport_type || "Run"}</span>
                    <span class="mini-date">${new Date(a.start_time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                </div>
                <div class="mini-bottom">
                    <span>${fmtKm(a.distance_m)} km</span>
                    <span>${fmtPace(a.avg_pace_s_per_km)}</span>
                </div>
            </button>`
        )
        .join("");
    body.innerHTML = `
        <div class="mini-activity-list">${items}</div>
        <div class="card-footer"><button id="view-all-activities-btn" class="btn-secondary">View all activities →</button></div>
    `;
    body.querySelectorAll(".mini-activity-item").forEach((btn) => {
        btn.addEventListener("click", () => openActivityDetail(btn.dataset.id));
    });
    document.getElementById("view-all-activities-btn").addEventListener("click", openActivitiesOverlay);
}

function openActivitiesOverlay() {
    const content = document.getElementById("activities-overlay-content");
    if (!allActivitiesCache.length) {
        content.innerHTML = `<div class="empty-state">No activities synced yet.</div>`;
    } else {
        const rows = allActivitiesCache.map(activityRowHtml).join("");
        content.innerHTML = `
            <div class="table-scroll">
                <table class="stack-on-mobile">
                    <thead><tr><th>Date</th><th>Name</th><th>Type</th><th>Distance</th><th>Pace</th><th>HR</th><th>Source</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        content.querySelectorAll("tr.activity-row").forEach((tr) => {
            tr.addEventListener("click", () => {
                closeActivitiesOverlay();
                openActivityDetail(tr.dataset.id);
            });
        });
    }
    document.getElementById("activities-overlay").hidden = false;
}

function closeActivitiesOverlay() {
    document.getElementById("activities-overlay").hidden = true;
}

// --- Training heatmap -----------------------------------------------
// coach.py has no "relative effort" concept, so this is computed here from
// what /api/activities already gives us: how long the run was relative to
// your longest on record, how hard relative to your own average pace/HR (or
// logged perceived_effort when present), a bonus for interval-shaped names,
// and a personal-best override so a 5K PB or a half marathon reads as
// maximally intense even if the blended score alone wouldn't get there.
const INTERVAL_NAME_RE = /\d+\s*x\s*\d+|interval|fartlek|vma|s[ée]rie|allure sp[ée]cifique|norv[ée]gien|tempo/i;

function computeEffortStats(runs) {
    const dists = runs.map((a) => a.distance_m).filter((v) => v);
    const maxDistKm = dists.length ? Math.max(...dists) / 1000 : 0;
    const paces = runs.map((a) => a.avg_pace_s_per_km).filter((v) => v != null);
    const avgPace = paces.length ? paces.reduce((s, v) => s + v, 0) / paces.length : 0;
    const maxHrs = runs.map((a) => a.max_hr).filter((v) => v != null);
    const maxHr = maxHrs.length ? Math.max(...maxHrs) : 0;

    function isPersonalBest(a) {
        if (a.avg_pace_s_per_km == null || !a.distance_m) return false;
        const lo = a.distance_m * 0.85, hi = a.distance_m * 1.15;
        const peers = runs.filter((o) => o.distance_m >= lo && o.distance_m <= hi && o.avg_pace_s_per_km != null);
        if (peers.length < 2) return false;
        return a.avg_pace_s_per_km <= Math.min(...peers.map((o) => o.avg_pace_s_per_km)) + 1e-6;
    }

    return { maxDistKm, avgPace, maxHr, isPersonalBest };
}

function runEffortScore(a, stats) {
    const distKm = (a.distance_m || 0) / 1000;
    const distScore = stats.maxDistKm > 0 ? Math.min(distKm / stats.maxDistKm, 1) : 0;

    const signals = [];
    if (a.perceived_effort != null) signals.push(Math.min(Math.max(a.perceived_effort / 10, 0), 1));
    if (a.avg_pace_s_per_km != null && stats.avgPace > 0) {
        const ratio = stats.avgPace / a.avg_pace_s_per_km; // >1 = faster than your average
        signals.push(Math.min(Math.max((ratio - 0.7) / 0.6, 0), 1));
    }
    if (a.avg_hr != null && stats.maxHr > 0) {
        signals.push(Math.min(Math.max(a.avg_hr / stats.maxHr, 0), 1));
    }
    const intensityScore = signals.length ? signals.reduce((s, v) => s + v, 0) / signals.length : 0.4;

    let score = distScore * 0.45 + intensityScore * 0.55;
    if (a.name && INTERVAL_NAME_RE.test(a.name)) score += 0.15;
    if (stats.isPersonalBest(a)) score = Math.max(score, 0.92);
    return Math.min(Math.max(score, 0), 1);
}

function scoreToLevel(score) {
    if (score >= 0.85) return 5;
    if (score >= 0.65) return 4;
    if (score >= 0.45) return 3;
    if (score >= 0.25) return 2;
    return 1;
}

function computeDailyEffort(activities) {
    const runs = activities.filter((a) => a.distance_m);
    const stats = computeEffortStats(runs);
    const byDate = new Map();
    for (const a of runs) {
        const day = (a.start_time || "").slice(0, 10);
        if (!day) continue;
        const score = runEffortScore(a, stats);
        const prev = byDate.get(day);
        if (!prev) {
            byDate.set(day, { score, activity: a, count: 1 });
        } else {
            prev.count += 1;
            if (score > prev.score) {
                prev.score = score;
                prev.activity = a;
            }
        }
    }
    return byDate;
}

const HEATMAP_WEEKS = 53;
const HEATMAP_SHIFT_WEEKS = 26;
const EFFORT_LEVEL_LABEL = { 1: "Light", 2: "Moderate", 3: "Solid", 4: "Hard", 5: "Max" };
let heatmapAnchor = null; // Monday (UTC) starting the visible window; set lazily on first render
let heatmapByDate = new Map(); // repopulated on every render; read by the hover tooltip

function mondayOf(d) {
    const dow = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    const m = new Date(d);
    m.setUTCDate(d.getUTCDate() - dow);
    m.setUTCHours(0, 0, 0, 0);
    return m;
}
function isoDate(d) {
    return d.toISOString().slice(0, 10);
}

function fmtTipDate(dateStr) {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function showHeatmapTooltip(cell) {
    const tip = document.getElementById("heatmap-tooltip");
    const date = cell.dataset.date;
    const entry = heatmapByDate.get(date);
    tip.innerHTML = entry
        ? `<div class="heatmap-tip-date">${fmtTipDate(date)}</div>
           <div class="heatmap-tip-name">${entry.activity.name || entry.activity.sport_type || "Run"}</div>
           <div class="heatmap-tip-stats">
               <span>${fmtKm(entry.activity.distance_m)} km</span>
               ${entry.activity.avg_pace_s_per_km != null ? `<span>${fmtPace(entry.activity.avg_pace_s_per_km)}</span>` : ""}
               ${entry.activity.avg_hr != null ? `<span>${Math.round(entry.activity.avg_hr)} bpm</span>` : ""}
           </div>
           <div class="heatmap-tip-level"><span class="heatmap-tip-dot level-${scoreToLevel(entry.score)}"></span>${EFFORT_LEVEL_LABEL[scoreToLevel(entry.score)]} effort</div>
           ${entry.count > 1 ? `<div class="heatmap-tip-extra">+${entry.count - 1} more that day</div>` : ""}
           <div class="heatmap-tip-hint">Click to view</div>`
        : `<div class="heatmap-tip-date">${fmtTipDate(date)}</div><div class="heatmap-tip-empty">No run</div>`;

    tip.hidden = false;
    const rect = cell.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
    let top = rect.top - tipRect.height - 8;
    if (top < 8) top = rect.bottom + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function hideHeatmapTooltip() {
    document.getElementById("heatmap-tooltip").hidden = true;
}

async function renderHeatmap(activitiesP) {
    const container = document.getElementById("heatmap-card");
    const body = cardBody(container);
    body.innerHTML = skeleton("chart");
    const activities = await activitiesP;
    if (!activities.length) {
        document.getElementById("heatmap-range-label").textContent = "";
        return emptyState(container, "No activities synced yet.");
    }
    const byDate = computeDailyEffort(activities);
    heatmapByDate = byDate;
    const earliestDay = activities.reduce((min, a) => {
        const d = (a.start_time || "").slice(0, 10);
        return d && (!min || d < min) ? d : min;
    }, null);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (heatmapAnchor == null) {
        heatmapAnchor = mondayOf(today);
        heatmapAnchor.setUTCDate(heatmapAnchor.getUTCDate() - (HEATMAP_WEEKS - 1) * 7);
    }
    const windowStart = new Date(heatmapAnchor);
    const windowEnd = new Date(windowStart);
    windowEnd.setUTCDate(windowStart.getUTCDate() + HEATMAP_WEEKS * 7 - 1);

    // Month labels: collect each month's start column first, then size each
    // label's span to the gap before the NEXT month starts (instead of a
    // fixed span). A fixed span could overlap the next label's column range,
    // and CSS Grid's auto-placement then silently bumps the colliding label
    // into an implicit second row — which bleeds into the calendar below it.
    // Non-overlapping, explicitly-sized spans (plus a pinned grid-row) rule
    // that out entirely.
    const monthStarts = [];
    let lastMonth = null;
    for (let col = 1; col <= HEATMAP_WEEKS; col++) {
        const d = new Date(windowStart);
        d.setUTCDate(windowStart.getUTCDate() + (col - 1) * 7);
        const month = d.getUTCMonth();
        if (month !== lastMonth) {
            monthStarts.push({ col, label: d.toLocaleDateString(undefined, { month: "short" }) });
            lastMonth = month;
        }
    }
    const monthsHtml = monthStarts
        .map((m, i) => {
            const nextCol = i + 1 < monthStarts.length ? monthStarts[i + 1].col : HEATMAP_WEEKS + 1;
            const span = Math.max(1, nextCol - m.col);
            return `<span class="heatmap-month" style="grid-row:1;grid-column:${m.col} / span ${span}">${m.label}</span>`;
        })
        .join("");

    let cellsHtml = "";
    for (let i = 0; i < HEATMAP_WEEKS * 7; i++) {
        const d = new Date(windowStart);
        d.setUTCDate(windowStart.getUTCDate() + i);
        const dateStr = isoDate(d);
        const col = Math.floor(i / 7) + 1;
        const row = (i % 7) + 1;

        if (d > today) {
            cellsHtml += `<div class="heatmap-cell future" style="grid-row:${row};grid-column:${col}"></div>`;
            continue;
        }
        const entry = byDate.get(dateStr);
        if (entry) {
            const level = scoreToLevel(entry.score);
            cellsHtml += `<div class="heatmap-cell has-run level-${level}" style="grid-row:${row};grid-column:${col}" data-date="${dateStr}" data-activity-id="${entry.activity.id}" aria-label="${dateStr}, run logged"></div>`;
        } else {
            cellsHtml += `<div class="heatmap-cell" style="grid-row:${row};grid-column:${col}" data-date="${dateStr}" aria-label="${dateStr}, no run"></div>`;
        }
    }

    body.innerHTML = `
        <div class="heatmap-body">
            <div class="heatmap-daylabels"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
            <div class="heatmap-scroll">
                <div class="heatmap-months">${monthsHtml}</div>
                <div class="heatmap-grid">${cellsHtml}</div>
            </div>
        </div>
        <div class="heatmap-legend">
            <span>Less</span>
            <span class="heatmap-cell level-1"></span>
            <span class="heatmap-cell level-2"></span>
            <span class="heatmap-cell level-3"></span>
            <span class="heatmap-cell level-4"></span>
            <span class="heatmap-cell level-5"></span>
            <span>More</span>
        </div>
    `;

    document.getElementById("heatmap-range-label").textContent =
        `${windowStart.toLocaleDateString(undefined, { month: "short", year: "numeric" })} – ${windowEnd.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
    document.getElementById("heatmap-next").disabled = windowEnd >= today;
    document.getElementById("heatmap-prev").disabled = !!earliestDay && isoDate(windowStart) <= earliestDay;
}

function shiftHeatmap(weeks) {
    if (heatmapAnchor == null) return;
    heatmapAnchor.setUTCDate(heatmapAnchor.getUTCDate() + weeks * 7);
    renderHeatmap(Promise.resolve(allActivitiesCache));
}

let detailCharts = [];

function closeActivityDetail() {
    document.getElementById("detail-overlay").hidden = true;
    detailCharts.forEach((c) => c.destroy());
    detailCharts = [];
}

async function openActivityDetail(id) {
    const overlay = document.getElementById("detail-overlay");
    const content = document.getElementById("detail-content");
    content.innerHTML = `<div class="empty-state">Loading…</div>`;
    overlay.hidden = false;

    const data = await fetchJSON(`/api/activities/${encodeURIComponent(id)}/detail`);
    if (!data || !data.activity) {
        content.innerHTML = `<div class="empty-state">${(data && data.detail) || "Couldn't load this activity."}</div>`;
        return;
    }

    const a = data.activity;
    const stats = [
        ["Distance", `${fmtKm(a.distance_m)} km`],
        ["Duration", fmtDuration(a.moving_time_s)],
        ["Pace", fmtPace(a.avg_pace_s_per_km)],
        ["Avg HR", a.avg_hr != null ? `${Math.round(a.avg_hr)} bpm` : "–"],
        ["Max HR", a.max_hr != null ? `${Math.round(a.max_hr)} bpm` : "–"],
        ["Elevation", a.elevation_gain_m != null ? `${Math.round(a.elevation_gain_m)} m` : "–"],
        ["Cadence", a.avg_cadence != null ? Math.round(a.avg_cadence) : "–"],
        ["Calories", a.calories != null ? Math.round(a.calories) : "–"],
    ];

    const commentaryHtml = (data.commentary || []).map((c) => `<li>${c}</li>`).join("");
    const noteHtml = data.note ? `<div class="empty-state" style="padding:8px 0">${data.note}</div>` : "";

    const splits = data.splits || [];
    const hasKind = splits.some((s) => s.kind);
    const splitsRows = splits
        .map(
            (s, i) => `<tr>
                <td data-label="#">${i + 1}</td>
                ${hasKind ? `<td data-label="Type" class="split-kind ${s.kind ?? ""}">${s.kind === "work" ? "Work" : s.kind === "recovery" ? "Recovery" : "–"}</td>` : ""}
                <td data-label="Distance">${(s.distance_m / 1000).toFixed(2)} km</td>
                <td data-label="Time">${fmtDuration(s.time_s)}</td>
                <td data-label="Pace">${fmtPace(s.pace_s_per_km)}</td>
                <td data-label="Avg HR">${s.avg_hr != null ? Math.round(s.avg_hr) : "–"}</td>
                <td data-label="Elev +">${s.elevation_gain_m != null ? Math.round(s.elevation_gain_m) : "–"}</td>
            </tr>`
        )
        .join("");
    const splitsHtml = splits.length
        ? `<div class="detail-section-title">${hasKind ? "Detected intervals" : "Splits"}</div>
           <div class="table-scroll"><table class="stack-on-mobile">
               <thead><tr><th>#</th>${hasKind ? "<th>Type</th>" : ""}<th>Distance</th><th>Time</th><th>Pace</th><th>Avg HR</th><th>Elev +</th></tr></thead>
               <tbody>${splitsRows}</tbody>
           </table></div>`
        : "";

    content.innerHTML = `
        <div class="detail-header">
            <h2>${a.name ?? "Activity"}</h2>
            <div class="subtitle">${new Date(a.start_time).toLocaleString()} · ${a.sport_type ?? ""} · ${a.source}</div>
        </div>
        <div class="detail-stats">
            ${stats.map(([label, value]) => `<div class="stat"><div class="value">${value}</div><div class="label">${label}</div></div>`).join("")}
        </div>
        <div class="detail-section-title">Coach's notes</div>
        <ul class="commentary-list">${commentaryHtml}</ul>
        ${noteHtml}
        <div id="detail-charts"></div>
        ${splitsHtml}
    `;

    renderDetailCharts(data.streams || {});
}

function renderDetailCharts(streams) {
    const container = document.getElementById("detail-charts");
    const distanceKm = (streams.distance || []).map((d) => d / 1000);
    if (!distanceKm.length) return;

    const chartDefs = [
        { key: "heartrate", label: "Heart rate (bpm)", color: CHART_COLOR.red },
        { key: "velocity_smooth", label: "Pace (min/km)", color: CHART_COLOR.blue, transform: (v) => (v > 0 ? 1000 / v / 60 : null), reverse: true },
        { key: "altitude", label: "Elevation (m)", color: CHART_COLOR.green },
    ];

    chartDefs.forEach((def) => {
        const raw = streams[def.key];
        if (!raw || !raw.length) return;
        const wrap = document.createElement("div");
        wrap.style.marginBottom = "16px";
        wrap.innerHTML = `<div class="detail-section-title">${def.label}</div>`;
        const canvasWrap = document.createElement("div");
        canvasWrap.style.height = "180px";
        const canvas = document.createElement("canvas");
        canvasWrap.appendChild(canvas);
        wrap.appendChild(canvasWrap);
        container.appendChild(wrap);

        const values = def.transform ? raw.map(def.transform) : raw;
        const points = distanceKm.map((x, i) => ({ x, y: values[i] })).filter((p) => p.y != null);

        const yScale = { reverse: !!def.reverse, grid: { color: CHART_COLOR.grid } };
        if (def.key === "velocity_smooth") {
            // Pace axis: clamp to a sane running-pace band (3-9 min/km) so a
            // brief stop (traffic light, water stop) doesn't blow the scale
            // out to 30+ min/km, but zoom in tighter than that band when the
            // run's actual pace range is narrower (e.g. a fast tempo session).
            const PACE_MIN = 3, PACE_MAX = 9;
            const inBand = points.map((p) => p.y).filter((y) => y >= PACE_MIN && y <= PACE_MAX);
            if (inBand.length) {
                const pad = 0.2;
                yScale.min = Math.max(PACE_MIN, Math.min(...inBand) - pad);
                yScale.max = Math.min(PACE_MAX, Math.max(...inBand) + pad);
            } else {
                yScale.min = PACE_MIN;
                yScale.max = PACE_MAX;
            }
        }

        const chart = new Chart(canvas, {
            type: "line",
            data: {
                datasets: [{ data: points, borderColor: def.color, pointRadius: 0, borderWidth: 1.5, tension: 0.15 }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { type: "linear", title: { display: true, text: "km" }, ticks: { maxTicksLimit: 8 }, grid: { color: CHART_COLOR.grid } },
                    y: yScale,
                },
            },
        });
        detailCharts.push(chart);
    });
}

function renderAll() {
    renderCoachSummary();
    renderAcwr();
    renderRecovery();
    renderRacePredictions();
    renderVo2maxCard();
    renderWeeklyMileage();
    renderPaceTrend();
    renderSleepTrend();
    renderBodyBatteryTrend();
    renderHeartRateTrend();

    const activitiesP = loadActivities();
    renderRecentActivities(activitiesP);
    renderHeatmap(activitiesP);
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
        renderAll();
    }
}

// Maps each card's range-picker (data-chart) to the render function that
// refetches and redraws it for the clicked range.
const RANGE_RENDER_FN = {
    "weekly-mileage": renderWeeklyMileage,
    "pace-trend": renderPaceTrend,
    "sleep-trend": renderSleepTrend,
    "body-battery-trend": renderBodyBatteryTrend,
    "heart-rate-trend": renderHeartRateTrend,
};

function init() {
    renderAll();

    document.getElementById("update-btn").addEventListener("click", handleUpdateClick);

    document.querySelectorAll(".expand-btn[data-chart]").forEach((btn) => {
        btn.addEventListener("click", () => openChartOverlay(btn.dataset.chart, btn.dataset.title));
    });
    document.getElementById("chart-overlay-close").addEventListener("click", closeChartOverlay);
    document.getElementById("chart-overlay").addEventListener("click", (e) => {
        if (e.target.id === "chart-overlay") closeChartOverlay();
    });
    document.getElementById("chart-overlay-range").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-range]");
        if (!btn) return;
        document.querySelectorAll("#chart-overlay-range button").forEach((b) => b.classList.toggle("active", b === btn));
        renderVo2maxHistory(btn.dataset.range);
    });

    document.getElementById("heatmap-prev").addEventListener("click", () => shiftHeatmap(-HEATMAP_SHIFT_WEEKS));
    document.getElementById("heatmap-next").addEventListener("click", () => shiftHeatmap(HEATMAP_SHIFT_WEEKS));

    // Delegated on the card shell (not the re-rendered .card-body) so hover
    // preview + click-to-open keep working across every heatmap re-render.
    const heatmapCard = document.getElementById("heatmap-card");
    heatmapCard.addEventListener("mouseover", (e) => {
        const cell = e.target.closest(".heatmap-cell");
        if (cell && cell.dataset.date) showHeatmapTooltip(cell);
    });
    heatmapCard.addEventListener("mouseout", (e) => {
        if (e.target.closest(".heatmap-cell")) hideHeatmapTooltip();
    });
    heatmapCard.addEventListener("click", (e) => {
        const cell = e.target.closest(".heatmap-cell.has-run");
        if (cell) openActivityDetail(cell.dataset.activityId);
    });

    document.querySelectorAll(".range-picker[data-chart]").forEach((picker) => {
        picker.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-range]");
            if (!btn) return;
            picker.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
            const renderFn = RANGE_RENDER_FN[picker.dataset.chart];
            if (renderFn) renderFn(btn.dataset.range);
        });
    });

    document.getElementById("activities-overlay-close").addEventListener("click", closeActivitiesOverlay);
    document.getElementById("activities-overlay").addEventListener("click", (e) => {
        if (e.target.id === "activities-overlay") closeActivitiesOverlay();
    });

    document.getElementById("detail-close").addEventListener("click", closeActivityDetail);
    document.getElementById("detail-overlay").addEventListener("click", (e) => {
        if (e.target.id === "detail-overlay") closeActivityDetail();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        closeActivityDetail();
        closeChartOverlay();
        closeActivitiesOverlay();
    });
}

document.addEventListener("DOMContentLoaded", init);
