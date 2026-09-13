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

async function renderActivities() {
    const container = document.getElementById("activities-card");
    const data = await fetchJSON("/api/activities?limit=20");
    if (isNoData(data) || !Array.isArray(data) || data.length === 0) {
        return emptyState(container, "No activities synced yet. Run your Strava/Garmin sync scripts, then refresh.");
    }
    const rows = data
        .map(
            (a) => `<tr>
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
}

function init() {
    renderCoachSummary();
    renderWeeklyMileage();
    renderPaceTrend();
    renderAcwr();
    renderRecovery();
    renderActivities();
}

document.addEventListener("DOMContentLoaded", init);
