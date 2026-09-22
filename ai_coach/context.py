"""The coach's context: a static knowledge base plus a live view of the athlete.

Two halves, with different lifetimes:

- `block()` — the doctrine and the physiology reference files. Static, read
  once and cached, placed at the top of the system prompt where a provider-side
  prefix cache can hold it.
- `live_block()` — training load, recovery, recent runs and the current
  training plan, rebuilt from the database on every conversation. Never
  cached: the plan is re-imported from Google Calendar whenever the athlete
  syncs, so a cached copy would go stale silently.

Set RUN_COACH_CONTEXT=0 to drop the static half (smaller prompt, no
physiological calibration) — useful when debugging token usage.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Optional

import coach
from api.deps import db

log = logging.getLogger("run_coach.ai")

ROOT = Path(__file__).resolve().parent.parent
DOCTRINE_FILE = ROOT / "system_prompt_coach.md"
CONTEXT_DIR = ROOT / "context"
PHYSIOLOGY_FILE = CONTEXT_DIR / "physiology_rules.md"
PACING_FILE = CONTEXT_DIR / "pacing_and_zones.md"

# How much of the live view to inline. Enough to answer "how has my training
# been going" without a tool call; the tools cover anything deeper.
RECENT_RUNS = 20
RUN_HISTORY_DAYS = 120
PLAN_WEEKS_BACK = 2
PLAN_WEEKS_FORWARD = 3


# --- static half ----------------------------------------------------------

def enabled() -> bool:
    return os.environ.get("RUN_COACH_CONTEXT", "1").strip().lower() not in ("0", "false", "no")


def _read(path: Path) -> str:
    """File contents, or "" with a warning when missing or unreadable.

    A missing reference file degrades the coach rather than breaking the chat.
    """
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        log.warning("coach context: cannot read %s (%s)", path.name, exc)
        return ""


@lru_cache(maxsize=1)
def doctrine() -> str:
    return _read(DOCTRINE_FILE)


@lru_cache(maxsize=1)
def physiology_rules() -> str:
    return _read(PHYSIOLOGY_FILE)


@lru_cache(maxsize=1)
def pacing_and_zones() -> str:
    return _read(PACING_FILE)


@lru_cache(maxsize=1)
def block() -> str:
    """Doctrine + reference files ("" when disabled or all files are missing)."""
    if not enabled():
        return ""
    parts = []
    if doctrine():
        parts.append("# COACHING DOCTRINE (system_prompt_coach.md)\n\n" + doctrine())
    if physiology_rules():
        parts.append("# REFERENCE — context/physiology_rules.md\n\n" + physiology_rules())
    if pacing_and_zones():
        parts.append("# REFERENCE — context/pacing_and_zones.md\n\n" + pacing_and_zones())
    if not parts:
        log.warning("coach context: no reference file found under %s", ROOT)
        return ""
    return "\n\n---\n\n".join(parts)


def reload() -> None:
    """Drop the caches so an edited reference file is picked up without a
    restart. The live half needs no reloading — it is never cached."""
    for fn in (doctrine, physiology_rules, pacing_and_zones, block):
        fn.cache_clear()


# --- live half ------------------------------------------------------------

def _pace(s_per_km: Optional[float]) -> str:
    if not s_per_km:
        return "-"
    s = int(round(s_per_km))
    return "{}:{:02d}".format(s // 60, s % 60)


def _dur(seconds: Optional[float]) -> str:
    if not seconds:
        return "-"
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return "{}:{:02d}:{:02d}".format(h, m, sec) if h else "{}:{:02d}".format(m, sec)


def _num(v: Optional[float], digits: int = 1) -> str:
    """Trim trailing decimal zeros only -- never digits of the integer part
    (160 bpm formatted with digits=0 must stay 160, not 16)."""
    if v is None:
        return "-"
    out = "{:.{d}f}".format(v, d=digits)
    return out.rstrip("0").rstrip(".") if "." in out else out


def _load_and_recovery(conn) -> list[str]:
    lines = []
    acwr = coach.compute_acwr(conn)
    if acwr.get("flag") and acwr["flag"] != "no_data":
        lines.append(
            "- ACWR {} ({}): last 7d {} km, 28d weekly avg {} km".format(
                acwr["ratio"], acwr["flag"], acwr["acute_km"], acwr["chronic_km"]
            )
        )
    rec = coach.get_recovery_status(conn)
    if rec.get("status") and rec["status"] != "no_data":
        lines.append(
            "- Recovery {} on {}: body battery high {}, HRV {}, readiness {}".format(
                rec["status"], rec["date"], rec.get("body_battery_high"),
                rec.get("hrv_ms"), rec.get("training_readiness"),
            )
        )
    return lines or ["- (no load or recovery data synced yet)"]


def _recent_runs(conn) -> list[str]:
    rows = conn.execute(
        """SELECT start_time, name, distance_m, moving_time_s, avg_pace_s_per_km,
                  avg_hr, max_hr, avg_cadence
           FROM activities
           WHERE sport_type = 'run' AND start_time >= date('now', ?)
           ORDER BY start_time DESC LIMIT ?""",
        ("-{} days".format(RUN_HISTORY_DAYS), RECENT_RUNS),
    ).fetchall()
    if not rows:
        return ["(no run recorded in the last {} days)".format(RUN_HISTORY_DAYS)]
    out = [
        "| date | session | km | time | pace /km | avg HR | max HR | cadence |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        out.append("| {} | {} | {} | {} | {} | {} | {} | {} |".format(
            (r["start_time"] or "")[:10],
            (r["name"] or "").replace("|", "/")[:48],
            _num((r["distance_m"] or 0) / 1000, 2),
            _dur(r["moving_time_s"]),
            _pace(r["avg_pace_s_per_km"]),
            _num(r["avg_hr"], 0),
            _num(r["max_hr"], 0),
            _num(r["avg_cadence"], 0),
        ))
    return out


def _training_plan(conn) -> list[str]:
    plan = coach.get_plan_status(conn, PLAN_WEEKS_BACK, PLAN_WEEKS_FORWARD)
    days = plan.get("days") or []
    if not days:
        return ["(no training plan loaded — see load_plan.py)"]
    rate = plan.get("adherence_rate")
    out = ["Adherence {}  ({} completed / {} partial / {} missed over the tracked window)".format(
        "{:.0%}".format(rate) if rate is not None else "n/a",
        plan.get("completed", 0), plan.get("partial", 0), plan.get("missed", 0),
    ), ""]
    out += [
        "| date | status | type | session | planned | pace target | HR target | actually run |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for d in days:
        actual = "-" if d.get("actual_distance_km") is None else "{} km{}".format(
            _num(d["actual_distance_km"], 1),
            " @ {} bpm".format(_num(d["actual_avg_hr"], 0)) if d.get("actual_avg_hr") else "",
        )
        out.append("| {} | {} | {} | {} | {} | {} | {} | {} |".format(
            d["date"], d["status"], d.get("workout_type") or "-",
            (d.get("title") or "").replace("|", "/")[:48],
            "{} km".format(_num(d["planned_distance_km"], 1)) if d.get("planned_distance_km") else "-",
            (d.get("pace_target") or "-").replace("|", "/"),
            (d.get("hr_target") or "-").replace("|", "/"),
            actual,
        ))
    if plan.get("advice"):
        out += ["", "Rule-based note: " + plan["advice"]]
    return out


def live_block() -> str:
    """The athlete's current state: load, recovery, recent runs, training plan.

    Rebuilt on every call. Returns a short error note rather than raising: the
    coach can still answer general questions without it.
    """
    try:
        with db() as conn:
            sections = [
                "### Training load and recovery",
                "\n".join(_load_and_recovery(conn)),
                "",
                "### Last {} runs (newest first)".format(RECENT_RUNS),
                "\n".join(_recent_runs(conn)),
                "",
                "### Training plan — {} weeks back, {} weeks ahead".format(PLAN_WEEKS_BACK, PLAN_WEEKS_FORWARD),
                "\n".join(_training_plan(conn)),
            ]
    except Exception as exc:  # noqa: BLE001
        log.warning("coach context: live snapshot unavailable (%s)", exc)
        return "(live snapshot unavailable: {}. Use your tools to fetch the athlete's data.)".format(exc)

    header = (
        "Snapshot taken at {} — the athlete's plan is re-imported from their calendar on every sync, "
        "so it may have changed since. Re-read it with get_training_plan whenever it matters."
    ).format(datetime.now().strftime("%Y-%m-%d %H:%M"))
    return header + "\n\n" + "\n".join(sections)


def status() -> dict:
    """Which reference files were found, and how big each half of the context is."""
    files = {
        "system_prompt_coach.md": DOCTRINE_FILE,
        "context/physiology_rules.md": PHYSIOLOGY_FILE,
        "context/pacing_and_zones.md": PACING_FILE,
    }
    live = live_block()
    return {
        "enabled": enabled(),
        "files": {name: path.exists() for name, path in files.items()},
        "static_chars": len(block()),
        "live_chars": len(live),
        "approx_tokens": (len(block()) + len(live)) // 4,
    }
