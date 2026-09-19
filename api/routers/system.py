"""Sync trigger and sync status."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter

from api.deps import db

router = APIRouter(prefix="/api", tags=["system"])

PROJECT_DIR = Path(__file__).resolve().parents[2]

# (source, script) -- the "plan" leg reloads plan_data.json (Claude's periodic
# export of the Google Calendar training plan, see load_plan.py's docstring
# for why this isn't a live Calendar API call).
SYNC_STEPS = (("strava", "ingest_strava.py"), ("garmin", "ingest_garmin.py"), ("plan", "load_plan.py"))


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/sync/status")
def sync_status():
    """When each source last synced: {sources: [{source, last_synced_at}]}."""
    with db() as conn:
        rows = conn.execute("SELECT source, last_synced_at FROM sync_state ORDER BY source").fetchall()
    return {"sources": [dict(r) for r in rows]}


def _run_step(script: str) -> dict:
    try:
        proc = subprocess.run(
            [sys.executable, str(PROJECT_DIR / script)],
            cwd=str(PROJECT_DIR),
            capture_output=True,
            text=True,
            timeout=300,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "message": "Timed out after 5 minutes."}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "message": str(exc)}

    # stdout/stderr are separate buffers, not interleaved chronologically, so
    # concatenating them can put an unrelated stderr warning (e.g. urllib3's
    # LibreSSL notice) after the script's real result line. Prefer stdout
    # (where the summary is printed); fall back to stderr, filtered of known
    # noise, only when stdout has nothing (typically a hard failure).
    stdout_lines = [l for l in proc.stdout.strip().splitlines() if l]
    stderr_lines = [
        l for l in proc.stderr.strip().splitlines()
        if l and "NotOpenSSLWarning" not in l and "warnings.warn" not in l
    ]
    message = (stdout_lines or stderr_lines or [""])[-1]
    return {"ok": proc.returncode == 0, "message": message}


@router.post("/sync")
def trigger_sync():
    """Runs the ingestion scripts and the plan reload synchronously (each is
    normally a few-second incremental sync) and returns per-source pass/fail."""
    return {source: _run_step(script) for source, script in SYNC_STEPS}
