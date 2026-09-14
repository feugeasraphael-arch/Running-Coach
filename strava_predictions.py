"""Strava "Performance Predictions" scraper for run-coach.

Strava's predicted race times (5K/10K/Half/Marathon, ML-based, subscriber-only)
are NOT exposed by the public Strava API — there is no documented endpoint
for them anywhere in developers.strava.com/docs/reference. They only exist
inside the logged-in web app's Progress page. This module drives a real
browser (Playwright) against your own authenticated Strava session to read
them, which is against Strava's Terms of Service (automated access) — you
accepted that trade-off for personal use on your own account. It will also
break whenever Strava changes their front-end, since there's no stable
contract to code against.

Two-phase workflow, because the exact shape of the Progress page's network
traffic/DOM isn't known ahead of time:

    python strava_predictions.py login      # one-time: opens a real browser,
                                             # you log in by hand, session is
                                             # saved to .strava_session/state.json
    python strava_predictions.py discover   # dumps candidate network responses
                                             # + a screenshot + the page HTML to
                                             # strava_discovery/, for inspection

`sync()` (wired into the DB) is intentionally left unimplemented until
`discover` output shows what to actually parse.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

PROJECT_DIR = Path(__file__).parent
SESSION_DIR = PROJECT_DIR / ".strava_session"
STATE_PATH = SESSION_DIR / "state.json"
DISCOVERY_DIR = PROJECT_DIR / "strava_discovery"

# Response URLs/bodies containing any of these (case-insensitive) are dumped
# by `discover` as candidates for where predictions live.
_CANDIDATE_KEYWORDS = ("predict", "progress", "fitness")


def login_interactive(timeout_s: int = 600) -> None:
    from playwright.sync_api import sync_playwright

    SESSION_DIR.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto("https://www.strava.com/login")
        print("Log into Strava in the opened browser window (handles 2FA/captcha manually).", flush=True)
        print(f"Waiting up to {timeout_s}s for login to complete...", flush=True)

        # Login can bounce through a third-party SSO domain (e.g. "Sign in
        # with Apple" hits appleid.apple.com, whose own query string embeds
        # "www.strava.com" in its redirect_uri param — so a plain substring
        # check on the URL is fooled by that and fires early). Check the
        # actual hostname instead, and only count it done once we're back on
        # strava.com and past the /login page.
        #
        # Also, SSO buttons ("Sign in with Apple"/"with Google") commonly
        # open the auth flow in a *popup* window rather than navigating the
        # original tab, which then never changes URL until the popup closes.
        # So watch every page/popup in the context, not just the first one.
        pages = [page]

        def _on_new_page(new_page):
            pages.append(new_page)
            print(f"  [popup opened] {new_page.url}", flush=True)

        context.on("page", _on_new_page)

        deadline = time.time() + timeout_s
        last_urls: dict = {}
        logged_in = False
        while time.time() < deadline:
            for p in list(pages):
                try:
                    url = p.url
                except Exception:
                    continue
                if last_urls.get(p) != url:
                    print(f"  [{int(deadline - time.time())}s left] page: {url}", flush=True)
                    last_urls[p] = url
                host = urlparse(url).hostname or ""
                if host.endswith("strava.com") and "/login" not in urlparse(url).path:
                    logged_in = True
                    break
            if logged_in:
                break
            time.sleep(1)
        else:
            browser.close()
            raise TimeoutError("Timed out waiting for login. Run again and log in faster.")

        page.wait_for_timeout(2000)  # let post-login redirect settle
        context.storage_state(path=str(STATE_PATH))
        browser.close()
        print(f"Session saved to {STATE_PATH}")


def discover() -> None:
    from playwright.sync_api import sync_playwright

    if not STATE_PATH.exists():
        raise RuntimeError("No saved session — run `python strava_predictions.py login` first.")
    DISCOVERY_DIR.mkdir(exist_ok=True)

    captures: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(storage_state=str(STATE_PATH))
        page = context.new_page()

        def on_response(response):
            url = response.url
            if not any(k in url.lower() for k in _CANDIDATE_KEYWORDS):
                return
            try:
                body = response.text()
            except Exception:
                return
            captures.append({"url": url, "status": response.status, "body": body[:20000]})

        page.on("response", on_response)

        page.goto("https://www.strava.com/dashboard", wait_until="networkidle", timeout=60000)
        if "login" in page.url:
            raise RuntimeError("Saved session is expired/invalid — run `login` again.")

        for text in ("Progress", "You"):
            try:
                page.get_by_role("link", name=text, exact=False).first.click(timeout=5000)
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass

        page.wait_for_timeout(3000)

        (DISCOVERY_DIR / "network_captures.json").write_text(json.dumps(captures, indent=2))
        page.screenshot(path=str(DISCOVERY_DIR / "progress_page.png"), full_page=True)
        (DISCOVERY_DIR / "progress_page.html").write_text(page.content())
        browser.close()

    print(f"Wrote {len(captures)} candidate network response(s), a screenshot, and the page HTML to {DISCOVERY_DIR}/")
    print("Share these with Claude to finish the real scraper.")


def sync(conn=None) -> dict:
    raise NotImplementedError(
        "Not implemented yet — run `discover` first so we know what to parse, "
        "then this function gets filled in against the real page/response shape."
    )


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else None
    if cmd == "login":
        login_interactive()
    elif cmd == "discover":
        discover()
    else:
        print("Usage: python strava_predictions.py [login|discover]")
        sys.exit(1)
