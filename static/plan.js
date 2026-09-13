async function fetchJSON(url) {
    try {
        const res = await fetch(url);
        return await res.json();
    } catch (err) {
        return { status: "no_data", detail: String(err) };
    }
}

function emptyState(container, message) {
    container.innerHTML = `<div class="empty-state">${message}</div>`;
}

function fmtDuration(sec) {
    if (sec == null) return "–";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.round(sec % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

const STATUS_LABEL = {
    completed: { text: "Completed", cls: "status-completed" },
    partial: { text: "Partial", cls: "status-partial" },
    missed: { text: "Missed", cls: "status-missed" },
    upcoming: { text: "Upcoming", cls: "status-upcoming" },
};

const TYPE_LABEL = {
    easy: "Easy",
    long: "Long run",
    interval: "Interval",
    benchmark: "Benchmark test",
};

let planData = null;

async function loadPlan() {
    const data = await fetchJSON("/api/plan-status?weeks_back=10&weeks_forward=3");
    planData = data;

    const banner = document.getElementById("advice-banner");
    const adherenceCard = document.getElementById("adherence-card");
    const timelineCard = document.getElementById("plan-timeline-card");

    if (!data || !data.days) {
        banner.innerHTML = `<div class="headline">No training plan loaded</div><div class="detail">${(data && data.detail) || ""}</div>`;
        emptyState(adherenceCard, "No plan data yet.");
        emptyState(timelineCard, "No plan data yet.");
        return;
    }

    banner.innerHTML = `<div class="headline">Advice for your next session</div><div class="detail">${data.advice}</div>`;

    if (data.adherence_rate == null) {
        emptyState(adherenceCard, "Not enough tracked sessions yet.");
    } else {
        const pct = Math.round(data.adherence_rate * 100);
        adherenceCard.innerHTML = `
            <div class="recovery-stats">
                <div class="stat"><div class="value">${pct}%</div><div class="label">Adherence</div></div>
                <div class="stat"><div class="value">${data.completed}</div><div class="label">Completed</div></div>
                <div class="stat"><div class="value">${data.partial}</div><div class="label">Partial</div></div>
                <div class="stat"><div class="value">${data.missed}</div><div class="label">Missed</div></div>
            </div>`;
    }

    const rows = data.days
        .slice()
        .reverse()
        .map((d) => {
            const status = STATUS_LABEL[d.status] || { text: d.status, cls: "" };
            const target = [d.planned_distance_km ? `${d.planned_distance_km}km` : null, d.pace_target, d.hr_target]
                .filter(Boolean)
                .join(" · ");
            const actual = d.actual_distance_km != null
                ? `${d.actual_distance_km}km${d.actual_avg_hr != null ? ` @ ${Math.round(d.actual_avg_hr)}bpm` : ""}`
                : "–";
            return `<tr>
                <td>${new Date(d.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</td>
                <td>${TYPE_LABEL[d.workout_type] || d.workout_type || ""}</td>
                <td>${d.title}</td>
                <td>${target || "–"}</td>
                <td>${actual}</td>
                <td><span class="status-badge ${status.cls}">${status.text}</span></td>
            </tr>`;
        })
        .join("");

    timelineCard.innerHTML = `
        <div class="table-scroll">
            <table>
                <thead><tr><th>Date</th><th>Type</th><th>Session</th><th>Target</th><th>Actual</th><th>Status</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
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
        loadPlan();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadPlan();
    document.getElementById("update-btn").addEventListener("click", handleUpdateClick);
});
