-- Shared SQLite schema for run-coach.
-- Both ingestion sources (Strava, Garmin) write into `activities`.
-- Garmin also writes daily wellness metrics that Strava doesn't provide.

CREATE TABLE IF NOT EXISTS activities (
    id                  TEXT PRIMARY KEY,      -- "<source>_<external_id>", e.g. "strava_12345678"
    source              TEXT NOT NULL CHECK (source IN ('strava', 'garmin')),
    external_id         TEXT NOT NULL,
    name                TEXT,
    sport_type          TEXT,                  -- 'run', 'trail_run', 'ride', etc. (normalized, lowercase)
    start_time          TEXT NOT NULL,          -- ISO 8601 UTC
    timezone            TEXT,
    distance_m          REAL,
    moving_time_s        INTEGER,
    elapsed_time_s       INTEGER,
    elevation_gain_m    REAL,
    avg_speed_mps       REAL,
    avg_pace_s_per_km   REAL,                  -- derived: moving_time_s / (distance_m/1000)
    avg_hr              REAL,
    max_hr              REAL,
    avg_cadence         REAL,
    calories            REAL,
    perceived_effort    REAL,                  -- Strava suffer_score or Garmin trainingEffort, scaled 0-100
    gear_id             TEXT,                  -- Strava gear id (shoe/bike), e.g. "g12345678"
    raw_json            TEXT,                  -- original payload, for reprocessing if schema evolves
    created_at          TEXT DEFAULT (datetime('now')),
    UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_activities_start_time ON activities (start_time);
CREATE INDEX IF NOT EXISTS idx_activities_sport_type ON activities (sport_type);

-- Daily wellness/recovery metrics. Garmin-only for now; nullable columns
-- because not every day has every metric (e.g. no HRV reading that night).
CREATE TABLE IF NOT EXISTS wellness (
    date                    TEXT PRIMARY KEY,   -- 'YYYY-MM-DD', local calendar date
    resting_hr              REAL,
    avg_hr_day              REAL,               -- mean of the day's continuous HR samples (not resting, not a workout)
    max_hr_day               REAL,
    hrv_ms                  REAL,
    body_battery_high       REAL,
    body_battery_low        REAL,
    training_readiness      REAL,               -- Garmin score 0-100
    training_status         TEXT,               -- e.g. 'productive', 'peaking', 'overreaching'
    vo2max                  REAL,
    sleep_score             REAL,
    sleep_duration_s        INTEGER,
    sleep_deep_s            INTEGER,           -- sleep-stage breakdown; deep+REM ratio is a recovery-quality signal
    sleep_light_s           INTEGER,
    sleep_rem_s             INTEGER,
    sleep_awake_s           INTEGER,
    sleep_avg_respiration   REAL,              -- breaths/min overnight; elevated values can flag illness/fatigue
    sleep_avg_hr            REAL,              -- mean of overnight HR samples (distinct from resting_hr, a spot value)
    sleep_avg_stress        REAL,              -- mean of overnight stress samples
    stress_avg              REAL,
    raw_json                TEXT,
    created_at              TEXT DEFAULT (datetime('now'))
);

-- Training plan snapshot, sourced from Google Calendar (feugeasraphael@gmail.com).
-- Loaded via load_plan.py from plan_data.json -- there's no live Calendar API
-- access from this app, so the plan is periodically re-exported by Claude
-- rather than fetched on demand (see /api/sync's "plan" leg).
CREATE TABLE IF NOT EXISTS planned_workouts (
    date                TEXT PRIMARY KEY,   -- 'YYYY-MM-DD'
    workout_type        TEXT,               -- 'easy' | 'long' | 'interval' | 'benchmark'
    title               TEXT,
    planned_distance_km REAL,
    pace_target         TEXT,                -- free text, e.g. "4'35-4'45/km"
    hr_target           TEXT,                -- free text, e.g. "140-160 bpm"
    notes               TEXT,
    synced_at           TEXT DEFAULT (datetime('now'))
);

-- Strava gear (shoes/bikes). distance_m is Strava's own accumulated total for
-- that gear item -- it can include mileage the athlete manually back-logged
-- when the gear was first added, not just what run-coach has ingested.
CREATE TABLE IF NOT EXISTS gear (
    id                  TEXT PRIMARY KEY,   -- Strava gear id, e.g. "g12345678"
    name                TEXT,
    distance_m          REAL,
    retired             INTEGER,             -- 0/1, as reported by Strava
    synced_at           TEXT DEFAULT (datetime('now'))
);

-- Tracks incremental sync progress per source so re-runs don't re-fetch everything.
CREATE TABLE IF NOT EXISTS sync_state (
    source              TEXT PRIMARY KEY,       -- 'strava' | 'garmin'
    last_synced_at      TEXT,                   -- ISO 8601 UTC, when the sync last ran
    cursor              TEXT                    -- source-specific bookmark (e.g. last activity start_time)
);

-- Strava's own "Performance Predictions" (subscriber-only ML feature, not
-- exposed via the public API — scraped from the logged-in web app by
-- strava_predictions.py). One row per (period_date, distance) so re-scraping
-- the same day/week just refreshes the value instead of duplicating it.
CREATE TABLE IF NOT EXISTS strava_predictions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at         TEXT NOT NULL,          -- ISO 8601 UTC, when we scraped this snapshot
    period_date         TEXT NOT NULL,          -- 'YYYY-MM-DD' Strava attributes this value to
    distance_label      TEXT NOT NULL,          -- '5K' | '10K' | 'Half Marathon' | 'Marathon'
    predicted_time_s    INTEGER NOT NULL,
    raw_json            TEXT,
    UNIQUE (period_date, distance_label)
);

CREATE INDEX IF NOT EXISTS idx_strava_predictions_period ON strava_predictions (period_date);

-- Strava's own "Best Efforts" per run (GET /activities/{id}?include_all_efforts=true).
-- This is Strava's sliding-window best-segment computation -- e.g. a run's
-- best 5K effort can start partway through the activity, not just from the
-- start -- so it's the authoritative source for real PRs, not something we
-- can derive from an activity's total distance/time. One row per
-- (activity_id, name); re-ingesting the same activity just refreshes it.
CREATE TABLE IF NOT EXISTS best_efforts (
    activity_id         TEXT NOT NULL,        -- references activities.id
    name                TEXT NOT NULL,        -- Strava's own label, e.g. '5K', '10K', 'Half-Marathon'
    distance_m          REAL NOT NULL,
    moving_time_s        INTEGER NOT NULL,
    elapsed_time_s       INTEGER,
    start_date          TEXT,
    synced_at           TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (activity_id, name)
);

CREATE INDEX IF NOT EXISTS idx_best_efforts_name ON best_efforts (name);

-- Athlete heart-rate zones as configured on Strava (GET /athlete/zones).
-- One row per zone, 1-based; max_bpm NULL for the open-ended top zone.
CREATE TABLE IF NOT EXISTS hr_zones (
    zone                INTEGER PRIMARY KEY,
    min_bpm             REAL NOT NULL,
    max_bpm             REAL,
    synced_at           TEXT DEFAULT (datetime('now'))
);

-- Compact per-activity heart-rate series (resampled to a fixed step from
-- Strava's heartrate stream), so the activity list can draw a time-in-zone
-- bar per run without one Strava streams call per row. Zones are applied at
-- read time, so changing zone settings on Strava recolours history too.
CREATE TABLE IF NOT EXISTS activity_hr_series (
    activity_id         TEXT PRIMARY KEY,     -- references activities.id
    step_s              INTEGER NOT NULL,
    hr_json             TEXT NOT NULL,        -- JSON array of bpm (null where no reading); [] = activity has no HR
    synced_at           TEXT DEFAULT (datetime('now'))
);

-- Per-recipe like/dislike, keyed by the recipe "id" field in cook_data.json.
-- A missing row means "no opinion yet" -- cook.py treats that as neutral.
CREATE TABLE IF NOT EXISTS recipe_ratings (
    recipe_id           TEXT PRIMARY KEY,
    rating              TEXT NOT NULL CHECK (rating IN ('like', 'dislike')),
    updated_at          TEXT DEFAULT (datetime('now'))
);
