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
    hrv_ms                  REAL,
    body_battery_high       REAL,
    body_battery_low        REAL,
    training_readiness      REAL,               -- Garmin score 0-100
    training_status         TEXT,               -- e.g. 'productive', 'peaking', 'overreaching'
    vo2max                  REAL,
    sleep_score             REAL,
    sleep_duration_s        INTEGER,
    stress_avg              REAL,
    raw_json                TEXT,
    created_at              TEXT DEFAULT (datetime('now'))
);

-- Tracks incremental sync progress per source so re-runs don't re-fetch everything.
CREATE TABLE IF NOT EXISTS sync_state (
    source              TEXT PRIMARY KEY,       -- 'strava' | 'garmin'
    last_synced_at      TEXT,                   -- ISO 8601 UTC, when the sync last ran
    cursor              TEXT                    -- source-specific bookmark (e.g. last activity start_time)
);
