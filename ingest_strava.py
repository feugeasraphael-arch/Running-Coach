"""Strava ingestion for run-coach.

Pulls activities from the Strava API and upserts them into the shared
`activities` table (see schema.sql / db.py). Uses its own OAuth token
handling so it can run unattended (e.g. from cron) without depending on
the `strava` MCP server being alive.

Usage:
    python ingest_strava.py

Requires STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env (same Strava
API app used by the strava MCP server). On first run, if STRAVA_REFRESH_TOKEN
isn't set yet, it is seeded from the strava MCP server's own stored token
at ~/.config/strava-mcp/config.json if present; otherwise this script
walks you through Strava's OAuth flow via a short-lived localhost server.
"""
from __future__ import annotations

import json
import os
import sys
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
from dotenv import dotenv_values, load_dotenv

import db

ENV_PATH = Path(__file__).parent / ".env"
ENV_EXAMPLE_PATH = Path(__file__).parent / ".env.example"
STRAVA_MCP_CONFIG_PATH = Path.home() / ".config" / "strava-mcp" / "config.json"

TOKEN_URL = "https://www.strava.com/oauth/token"
AUTHORIZE_URL = "https://www.strava.com/oauth/authorize"
ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities"
CALLBACK_PORT = 8721
CALLBACK_PATH = "/exchange_token"

# Strava activity "type" values that represent running (sport_type is the
# newer, more granular field; `type` is the legacy one — we normalize both).
_RUN_TYPES = {"run", "trailrun", "trail_run"}


def _ensure_env_file() -> None:
    if not ENV_PATH.exists() and ENV_EXAMPLE_PATH.exists():
        ENV_PATH.write_text(ENV_EXAMPLE_PATH.read_text())


def _set_env_value(key: str, value: str) -> None:
    """Persist a single key into .env, preserving other lines/comments."""
    lines = ENV_PATH.read_text().splitlines() if ENV_PATH.exists() else []
    found = False
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            found = True
            break
    if not found:
        lines.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(lines) + "\n")
    os.environ[key] = value


def _seed_refresh_token_from_mcp() -> str | None:
    if not STRAVA_MCP_CONFIG_PATH.exists():
        return None
    try:
        config = json.loads(STRAVA_MCP_CONFIG_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    return config.get("refreshToken")


def _run_oauth_flow(client_id: str) -> str:
    """Interactive fallback: opens a browser for Strava's authorization-code
    flow and runs a one-shot localhost server to catch the redirect."""
    auth_code: dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 (http.server API)
            qs = parse_qs(urlparse(self.path).query)
            if "code" in qs:
                auth_code["code"] = qs["code"][0]
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"Strava authorized. You can close this tab.")
            else:
                self.send_response(400)
                self.end_headers()

        def log_message(self, *args):  # silence default request logging
            pass

    redirect_uri = f"http://localhost:{CALLBACK_PORT}{CALLBACK_PATH}"
    auth_url = (
        f"{AUTHORIZE_URL}?client_id={client_id}&response_type=code"
        f"&redirect_uri={redirect_uri}&approval_prompt=auto"
        f"&scope=read,activity:read_all"
    )
    print(f"Opening browser for Strava authorization:\n{auth_url}")
    webbrowser.open(auth_url)

    server = HTTPServer(("localhost", CALLBACK_PORT), Handler)
    while "code" not in auth_code:
        server.handle_request()
    server.server_close()
    return auth_code["code"]


def get_access_token() -> str:
    """Returns a valid access token, refreshing (or bootstrapping) as needed."""
    client_id = os.environ.get("STRAVA_CLIENT_ID")
    client_secret = os.environ.get("STRAVA_CLIENT_SECRET")
    refresh_token = os.environ.get("STRAVA_REFRESH_TOKEN")

    if not client_id or not client_secret:
        sys.exit(
            "STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET missing from .env.\n"
            "Get them from strava.com/settings/api and add them to .env first."
        )

    if not refresh_token:
        refresh_token = _seed_refresh_token_from_mcp()
        if refresh_token:
            print("Seeded STRAVA_REFRESH_TOKEN from the strava MCP server's stored token.")
            _set_env_value("STRAVA_REFRESH_TOKEN", refresh_token)

    if not refresh_token:
        print("No refresh token found — starting Strava OAuth flow.")
        code = _run_oauth_flow(client_id)
        resp = requests.post(
            TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "grant_type": "authorization_code",
            },
            timeout=15,
        )
        resp.raise_for_status()
        payload = resp.json()
        _set_env_value("STRAVA_REFRESH_TOKEN", payload["refresh_token"])
        return payload["access_token"]

    resp = requests.post(
        TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
        timeout=15,
    )
    if resp.status_code == 429:
        sys.exit("Strava API rate limit hit while refreshing the token. Try again later.")
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("refresh_token") and payload["refresh_token"] != refresh_token:
        _set_env_value("STRAVA_REFRESH_TOKEN", payload["refresh_token"])
    return payload["access_token"]


def _normalize_sport_type(activity: dict) -> str:
    raw = activity.get("sport_type") or activity.get("type") or ""
    return raw.lower()


def _to_row(activity: dict) -> dict:
    sport_type = _normalize_sport_type(activity)
    distance_m = activity.get("distance")
    moving_time_s = activity.get("moving_time")
    avg_pace_s_per_km = None
    if sport_type in _RUN_TYPES and distance_m:
        avg_pace_s_per_km = moving_time_s / (distance_m / 1000)

    return {
        "id": f"strava_{activity['id']}",
        "source": "strava",
        "external_id": str(activity["id"]),
        "name": activity.get("name"),
        "sport_type": sport_type,
        "start_time": activity.get("start_date"),  # already ISO 8601 UTC from Strava
        "timezone": activity.get("timezone"),
        "distance_m": distance_m,
        "moving_time_s": moving_time_s,
        "elapsed_time_s": activity.get("elapsed_time"),
        "elevation_gain_m": activity.get("total_elevation_gain"),
        "avg_speed_mps": activity.get("average_speed"),
        "avg_pace_s_per_km": avg_pace_s_per_km,
        "avg_hr": activity.get("average_heartrate"),
        "max_hr": activity.get("max_heartrate"),
        "avg_cadence": activity.get("average_cadence"),
        "calories": activity.get("calories"),
        "perceived_effort": activity.get("suffer_score"),
        "raw_json": json.dumps(activity),
    }


def sync() -> None:
    load_dotenv(ENV_PATH)
    access_token = get_access_token()
    headers = {"Authorization": f"Bearer {access_token}"}

    conn = db.get_connection()
    cursor = db.get_sync_cursor(conn, "strava")
    after_epoch = None
    if cursor:
        after_epoch = int(datetime.fromisoformat(cursor.replace("Z", "+00:00")).timestamp())

    page = 1
    per_page = 100
    total = 0
    latest_start = cursor
    earliest_start = None

    while True:
        params = {"page": page, "per_page": per_page}
        if after_epoch:
            params["after"] = after_epoch
        resp = requests.get(ACTIVITIES_URL, headers=headers, params=params, timeout=30)
        if resp.status_code == 429:
            sys.exit(
                "Strava API rate limit exceeded (429). This is common right after creating "
                "a new app. Wait 15 minutes and re-run."
            )
        resp.raise_for_status()
        activities = resp.json()
        if not activities:
            break

        for activity in activities:
            row = _to_row(activity)
            db.upsert_activity(conn, row)
            total += 1
            start = row["start_time"]
            if start and (latest_start is None or start > latest_start):
                latest_start = start
            if start and (earliest_start is None or start < earliest_start):
                earliest_start = start

        conn.commit()
        if len(activities) < per_page:
            break
        page += 1

    if latest_start:
        db.set_sync_cursor(conn, "strava", latest_start)
        conn.commit()

    conn.close()

    if total == 0:
        print("Strava sync: no new activities.")
    else:
        span = f"{earliest_start} to {latest_start}" if earliest_start else latest_start
        print(f"Strava sync: {total} activities upserted ({span}).")


if __name__ == "__main__":
    _ensure_env_file()
    sync()
