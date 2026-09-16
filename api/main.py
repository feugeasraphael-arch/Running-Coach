"""FastAPI application: JSON API under /api, plus the built React frontend
(frontend/dist) for everything else.

In development, run the Vite dev server instead (`npm run dev` in frontend/),
which proxies /api to this app -- see frontend/vite.config.ts.
"""
from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()

from api.routers import activities, nutrition, plan, system, training, wellness  # noqa: E402

FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"

app = FastAPI(title="run-coach API", version="2.0.0")

for r in (activities, training, wellness, plan, nutrition, system):
    app.include_router(r.router)


@app.get("/api/{path:path}", include_in_schema=False)
def api_not_found(path: str):
    # Without this, an unknown /api/... URL would fall through to the SPA
    # catch-all below and come back as index.html with a 200.
    raise HTTPException(status_code=404, detail=f"Unknown API route: /api/{path}")


if (FRONTEND_DIST / "assets").is_dir():
    # Vite fingerprints everything under assets/, so it's safe to cache hard.
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    """Serve a real file from dist/ if one matches (favicon, etc.), otherwise
    index.html so client-side routes like /plan survive a hard refresh."""
    index = FRONTEND_DIST / "index.html"
    if not index.is_file():
        return HTMLResponse(
            "<h1>Frontend not built</h1><p>Run <code>cd frontend && npm install && npm run build</code>, "
            "or use <code>npm run dev</code> and open http://localhost:5173.</p>",
            status_code=503,
        )
    candidate = (FRONTEND_DIST / path).resolve()
    if path and candidate.is_file() and FRONTEND_DIST in candidate.parents:
        return FileResponse(candidate)
    # index.html must never be cached, or a rebuild's new asset hashes won't be picked up.
    return FileResponse(index, headers={"Cache-Control": "no-store"})
