#!/bin/bash
# Daily sync entry point for cron. Runs both ingestion scripts and logs output.
cd "$(dirname "$0")" || exit 1
echo "=== $(date) ===" >> sync.log
./.venv/bin/python ingest_strava.py >> sync.log 2>&1
./.venv/bin/python ingest_garmin.py >> sync.log 2>&1
