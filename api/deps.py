"""Shared plumbing for the API routers: DB connection lifetime and the
"no_data" soft-failure convention.

Connections are opened inside each request handler (not via a FastAPI
yield-dependency) because sqlite3 connections are bound to the thread that
created them, and FastAPI may run a sync dependency and the sync endpoint
that uses it on different threadpool workers.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Callable, Iterator

from fastapi.responses import JSONResponse

from db import get_connection

log = logging.getLogger("run_coach.api")


@contextmanager
def db() -> Iterator[Any]:
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


def no_data(detail: str = "Not synced yet") -> JSONResponse:
    """200 + {"status": "no_data"}: the analytics layer legitimately has
    nothing to show yet (fresh DB, no Garmin data, ...). The frontend renders
    an empty state for this rather than an error."""
    return JSONResponse(status_code=200, content={"status": "no_data", "detail": detail})


def run_analytics(fn: Callable[..., Any], *args: Any, is_empty: Callable[[Any], bool] = lambda r: r is None) -> Any:
    """Call an analytics function (coach.py / cook.py / effort.py) with a
    fresh connection. Empty results and failures both become a no_data
    response instead of a 500 so one broken card can't take the dashboard
    down -- but failures are logged with a traceback so they aren't silent."""
    try:
        with db() as conn:
            result = fn(conn, *args)
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see docstring
        log.exception("%s failed", getattr(fn, "__name__", fn))
        return no_data(str(exc))
    if is_empty(result):
        return no_data()
    if isinstance(result, dict) and result.get("status") == "no_data":
        return no_data(result.get("detail") or "Not synced yet")
    return result
