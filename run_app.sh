#!/bin/bash
# Entry point for the com.runcoach.app LaunchAgent (see README).
#
# launchd hands a job a bare PATH, so everything here is absolute.
#
# The UI is served out of frontend/dist by FastAPI, and a stale dist/ is
# invisible until you notice the page is older than the API behind it --
# so rebuild on every start. A failed build is logged and skipped rather
# than fatal: the previous dist/ still serves, and a type error caught
# mid-edit shouldn't be what takes the whole app offline.
cd "$(dirname "$0")" || exit 1

echo "=== $(date) starting run-coach ==="
if ! /usr/local/bin/npm --prefix frontend run build; then
    echo "UI build failed -- serving the previous frontend/dist as-is."
fi

exec ./.venv/bin/python app.py
