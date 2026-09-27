"""Shared Strava OAuth + API access for run-coach.

Both ingest_strava.py (bulk sync) and app.py (on-demand activity detail)
import this instead of duplicating token handling.
"""
from __future__ import annotations

import json
import os
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests

ENV_PATH = Path(__file__).parent / ".env"
ENV_EXAMPLE_PATH = Path(__file__).parent / ".env.example"
STRAVA_MCP_CONFIG_PATH = Path.home() / ".config" / "strava-mcp" / "config.json"

TOKEN_URL = "https://www.strava.com/oauth/token"
AUTHORIZE_URL = "https://www.strava.com/oauth/authorize"
ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities"
CALLBACK_PORT = 8721
CALLBACK_PATH = "/exchange_token"


def ensure_env_file() -> None:
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
        raise RuntimeError(
            "STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET missing from .env. "
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
        raise RuntimeError("Strava API rate limit hit while refreshing the token. Try again later.")
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("refresh_token") and payload["refresh_token"] != refresh_token:
        _set_env_value("STRAVA_REFRESH_TOKEN", payload["refresh_token"])
    return payload["access_token"]


STREAM_KEYS = "time,distance,heartrate,altitude,velocity_smooth,cadence,grade_smooth,latlng"


def get_activity_streams(access_token: str, external_id: str) -> dict:
    """Returns {key: [values...]} for the stream types in STREAM_KEYS that
    the activity actually has (manual/indoor activities may have few/none)."""
    resp = requests.get(
        f"https://www.strava.com/api/v3/activities/{external_id}/streams",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"keys": STREAM_KEYS, "key_by_type": "true"},
        timeout=30,
    )
    if resp.status_code == 429:
        raise RuntimeError("Strava rate limit hit fetching streams.")
    if resp.status_code == 404:
        return {}
    resp.raise_for_status()
    raw = resp.json()
    return {k: v.get("data", []) for k, v in raw.items()}


def get_gear(access_token: str, gear_id: str) -> dict:
    """Returns Strava's gear record: {id, name, distance (m, lifetime total), retired, ...}."""
    resp = requests.get(
        f"https://www.strava.com/api/v3/gear/{gear_id}",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    if resp.status_code == 429:
        raise RuntimeError("Strava rate limit hit fetching gear.")
    if resp.status_code == 404:
        return {}
    resp.raise_for_status()
    return resp.json()


def get_activity_best_efforts(access_token: str, external_id: str) -> list[dict]:
    """Strava's own sliding-window best-segment computation for this run
    (e.g. its fastest 5K, which can start partway through the activity, not
    just from the start) -- only present on the detailed activity resource,
    not the summary one used for bulk listing. Returns [] for non-runs or
    activities too short to have any standard-distance effort."""
    resp = requests.get(
        f"https://www.strava.com/api/v3/activities/{external_id}",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"include_all_efforts": "true"},
        timeout=30,
    )
    if resp.status_code == 429:
        raise RuntimeError("Strava rate limit hit fetching best efforts.")
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    return resp.json().get("best_efforts", [])


def get_athlete_hr_zones(access_token: str) -> list[dict]:
    """The athlete's heart-rate zones as [{min, max}, ...] (max == -1 for the
    open-ended top zone). [] if the athlete has none configured."""
    resp = requests.get(
        "https://www.strava.com/api/v3/athlete/zones",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    if resp.status_code == 429:
        raise RuntimeError("Strava rate limit hit fetching athlete zones.")
    resp.raise_for_status()
    return (resp.json().get("heart_rate") or {}).get("zones") or []


def get_activity_laps(access_token: str, external_id: str) -> list[dict]:
    resp = requests.get(
        f"https://www.strava.com/api/v3/activities/{external_id}/laps",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    if resp.status_code == 429:
        raise RuntimeError("Strava rate limit hit fetching laps.")
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    return resp.json()
