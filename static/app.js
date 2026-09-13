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
    container.innerHTML = `<div class="empty-state">${message}</div>`;
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

async function renderWeeklyMileage() {
    const container = document.getElementById("weekly-mileage-card");
    const data = await fetchJSON("/api/weekly-mileage?weeks=12");
    if (isNoData(data) || !Array.isArray(data) || data.length === 0) {
        return emptyState(container, "No weekly mileage yet.");
    }
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);
    new Chart(canvas, {
        type: "bar",
        data: {
            labels: data.map((d) => d.week_start),
            datasets: [
                {
                    label: "km",
                    data: data.map((d) => d.distance_km),
                    backgroundColor: "#2563eb",
                    borderRadius: 4,
                },
            ],
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { afterLabel: (ctx) => `${data[ctx.dataIndex].num_runs} run(s)` } },
            },
            scales: { y: { beginAtZero: true, title: { display: true, text: "km" } } },
        },
    });
}

async function renderPaceTrend() {
    const container = document.getElementById("pace-trend-card");
    const data = await fetchJSON("/api/pace-trend?weeks=12");
    if (isNoData(data) || !Array.isArray(data) || data.length === 0) {
        return emptyState(container, "No runs with pace data yet.");
    }
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);
    new Chart(canvas, {
        type: "line",
        data: {
            labels: data.map((d) => d.week_start),
            datasets: [
                {
                    label: "Pace (s/km, lower = faster)",
                    data: data.map((d) => d.avg_pace_s_per_km),
                    borderColor: "#2563eb",
                    yAxisID: "pace",
                    tension: 0.2,
                },
                {
                    label: "Avg HR",
                    data: data.map((d) => d.avg_hr),
                    borderColor: "#dc2626",
                    yAxisID: "hr",
                    tension: 0.2,
                },
            ],
        },
        options: {
            responsive: true,
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
                pace: { type: "linear", position: "left", reverse: true, title: { display: true, text: "pace" } },
                hr: { type: "linear", position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "bpm" } },
            },
        },
    });
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
    const data = await fetchJSON("/api/acwr");
    if (isNoData(data) || !data.flag || data.flag === "no_data") {
        return emptyState(container, "Not enough training history for ACWR yet (need a few weeks of runs).");
    }
    const max = 2.0;
    const pct = Math.min(data.ratio / max, 1) * 100;
    container.innerHTML = `
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
    container.innerHTML = `
        <div class="recovery-stats">
            ${stats.map(([label, value]) => `<div class="stat"><div class="value">${value}</div><div class="label">${label}</div></div>`).join("")}
        </div>
        <div class="subtitle" style="margin-top:12px">${RECOVERY_STATUS_LABEL[data.status] ?? ""}</div>
    `;
}

async function renderWellnessTrend() {
    const container = document.getElementById("wellness-trend-card");
    const data = await fetchJSON("/api/wellness-trend?days=400");
    if (isNoData(data) || !Array.isArray(data) || data.length === 0) {
        return emptyState(container, "No Garmin wellness history yet.");
    }
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);
    new Chart(canvas, {
        type: "line",
        data: {
            labels: data.map((d) => d.date),
            datasets: [
                {
                    label: "Sleep (hours)",
                    data: data.map((d) => d.sleep_hours),
                    borderColor: "#7c3aed",
                    yAxisID: "hours",
                    spanGaps: true,
                    tension: 0.2,
                },
                {
                    label: "Body battery (high)",
                    data: data.map((d) => d.body_battery_high),
                    borderColor: "#059669",
                    yAxisID: "battery",
                    spanGaps: true,
                    tension: 0.2,
                },
                {
                    label: "Body battery (low)",
                    data: data.map((d) => d.body_battery_low),
                    borderColor: "#059669",
                    borderDash: [4, 4],
                    yAxisID: "battery",
                    spanGaps: true,
                    tension: 0.2,
                },
            ],
        },
        options: {
            responsive: true,
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
                hours: { type: "linear", position: "left", title: { display: true, text: "hours" } },
                battery: { type: "linear", position: "right", min: 0, max: 100, grid: { drawOnChartArea: false }, title: { display: true, text: "body battery" } },
            },
        },
    });
}

async function renderHeartRateTrend() {
    const container = document.getElementById("heart-rate-trend-card");
    const data = await fetchJSON("/api/wellness-trend?days=400");
    if (isNoData(data) || !Array.isArray(data) || data.length === 0) {
        return emptyState(container, "No Garmin heart-rate history yet.");
    }
    const hasAny = data.some((d) => d.resting_hr != null || d.avg_hr_day != null);
    if (!hasAny) {
        return emptyState(container, "No resting/average heart-rate history yet.");
    }
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);
    new Chart(canvas, {
        type: "line",
        data: {
            labels: data.map((d) => d.date),
            datasets: [
                {
                    label: "Resting HR",
                    data: data.map((d) => d.resting_hr),
                    borderColor: "#dc2626",
                    spanGaps: true,
                    pointRadius: 0,
                    tension: 0.2,
                },
                {
                    label: "Average HR (24h)",
                    data: data.map((d) => d.avg_hr_day),
                    borderColor: "#2563eb",
                    spanGaps: true,
                    pointRadius: 0,
                    tension: 0.2,
                },
            ],
        },
        options: {
            responsive: true,
            interaction: { mode: "index", intersect: false },
            scales: {
                y: { title: { display: true, text: "bpm" } },
            },
        },
    });
}

async function renderRacePredictions() {
    const container = document.getElementById("race-predictions-card");
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

    container.innerHTML = `<div class="race-grid">${items}</div>${refHtml}`;
}

async function renderActivities() {
    const container = document.getElementById("activities-card");
    const data = await fetchJSON("/api/activities?limit=20");
    if (isNoData(data) || !Array.isArray(data) || data.length === 0) {
        return emptyState(container, "No activities synced yet. Run your Strava/Garmin sync scripts, then refresh.");
    }
    const rows = data
        .map(
            (a) => `<tr class="activity-row" data-id="${a.id}">
                <td>${new Date(a.start_time).toLocaleDateString()}</td>
                <td>${a.name ?? ""}</td>
                <td>${a.sport_type ?? ""}</td>
                <td>${fmtKm(a.distance_m)} km</td>
                <td>${fmtPace(a.avg_pace_s_per_km)}</td>
                <td>${a.avg_hr != null ? Math.round(a.avg_hr) : "–"}</td>
                <td style="text-transform:capitalize">${a.source}</td>
            </tr>`
        )
        .join("");
    container.innerHTML = `
        <div class="table-scroll">
            <table>
                <thead><tr><th>Date</th><th>Name</th><th>Type</th><th>Distance</th><th>Pace</th><th>HR</th><th>Source</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    container.querySelectorAll("tr.activity-row").forEach((tr) => {
        tr.addEventListener("click", () => openActivityDetail(tr.dataset.id));
    });
}

function fmtDuration(sec) {
    if (sec == null) return "–";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.round(sec % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
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
                <td>${i + 1}</td>
                ${hasKind ? `<td class="split-kind ${s.kind ?? ""}">${s.kind === "work" ? "Work" : s.kind === "recovery" ? "Recovery" : "–"}</td>` : ""}
                <td>${(s.distance_m / 1000).toFixed(2)} km</td>
                <td>${fmtDuration(s.time_s)}</td>
                <td>${fmtPace(s.pace_s_per_km)}</td>
                <td>${s.avg_hr != null ? Math.round(s.avg_hr) : "–"}</td>
                <td>${s.elevation_gain_m != null ? Math.round(s.elevation_gain_m) : "–"}</td>
            </tr>`
        )
        .join("");
    const splitsHtml = splits.length
        ? `<div class="detail-section-title">${hasKind ? "Detected intervals" : "Splits"}</div>
           <div class="table-scroll"><table>
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
        { key: "heartrate", label: "Heart rate (bpm)", color: "#dc2626" },
        { key: "velocity_smooth", label: "Pace (min/km)", color: "#2563eb", transform: (v) => (v > 0 ? 1000 / v / 60 : null), reverse: true },
        { key: "altitude", label: "Elevation (m)", color: "#059669" },
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

        const yScale = { reverse: !!def.reverse };
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
                    x: { type: "linear", title: { display: true, text: "km" }, ticks: { maxTicksLimit: 8 } },
                    y: yScale,
                },
            },
        });
        detailCharts.push(chart);
    });
}

function renderAll() {
    renderCoachSummary();
    renderWeeklyMileage();
    renderPaceTrend();
    renderAcwr();
    renderRecovery();
    renderWellnessTrend();
    renderHeartRateTrend();
    renderRacePredictions();
    renderActivities();
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

function init() {
    renderAll();

    document.getElementById("update-btn").addEventListener("click", handleUpdateClick);

    document.getElementById("detail-close").addEventListener("click", closeActivityDetail);
    document.getElementById("detail-overlay").addEventListener("click", (e) => {
        if (e.target.id === "detail-overlay") closeActivityDetail();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeActivityDetail();
    });
}

document.addEventListener("DOMContentLoaded", init);
