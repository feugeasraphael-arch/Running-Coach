# run-coach

A self-hosted running dashboard and AI coach for a single athlete.

It pulls your training data out of **Strava** and **Garmin Connect** into a local
SQLite database, computes the kind of analytics a coach would look at (training
load, fitness/fatigue balance, heart-rate zones, pace and cadence trends, race
predictions), and serves it as a React dashboard. On top of that sits a chat
coach: an LLM that answers questions about *your* training by calling read-only
tools against the same numbers the dashboard shows.

Everything runs on your own machine, against your own accounts. There is no
multi-user mode, no hosting, no account system — one athlete, one database.

---

## What it does

**Collects**
- Runs from Strava (source of truth for running), via the Strava API.
- Daily wellness from Garmin Connect: resting HR, HRV, body battery, training
  readiness and status, VO2max, sleep, stress — plus non-running activities.
- Your training plan, exported from Google Calendar into `plan_data.json`.
- Strava's subscriber-only race-time predictions (see the caveat below).

**Analyses** (`coach.py`, `effort.py`, `hr_zones.py`, `activity_insights.py`)
- Training load and ACWR (acute:chronic workload ratio) — are you ramping up
  too fast?
- Weekly mileage, pace trend, cadence trend, gear mileage.
- A per-run "relative effort" score and a calendar heatmap built from it.
- Per-activity breakdown: splits, detected intervals, time in each HR zone, and
  short rule-based commentary comparing the run to your recent baseline.
- Planned vs. actually-run, week by week.

**Advises**
- A chat coach (Mistral) with a coaching doctrine in its system prompt
  (`system_prompt_coach.md`, plus the reference files in `context/`) and a set
  of read-only tools (`ai_coach/tools.py`). The tools wrap the same analytics
  functions the dashboard uses, so the model explains numbers rather than
  inventing them.

**Feeds you**
- "The Cook": a rolling 7-day meal plan, shopping list and rated recipe library
  (`cook.py`, `cook_data.json`). Meals are picked deterministically from the
  date — no AI call, no stored state — and biased toward higher-carb or
  higher-protein recipes around hard sessions in your plan.

---

## Architecture

```
Strava API ─┐
Garmin API ─┼─> ingest_*.py ──> run_coach.db (SQLite) ──> coach.py / effort.py / ...
Calendar ───┘                          │                   (pure read-only analytics)
  (plan_data.json -> load_plan.py)     │                            │
                                       │                  ┌─────────┴──────────┐
                                       │                  │                    │
                                       └────────────> FastAPI /api        ai_coach/
                                                          │             (Mistral + tools)
                                                          │
                                                   React SPA (frontend/)
```

| Path | Role |
|---|---|
| `app.py`, `api/` | FastAPI app. One router per domain under `/api`; also serves the built frontend. |
| `db.py`, `schema.sql` | The only place that opens SQLite. Schema is applied on connect. |
| `ingest_strava.py`, `ingest_garmin.py`, `load_plan.py` | The three ingestion legs, also runnable from cron. |
| `coach.py` | Cross-week training-load analytics. Pure reads, no writes, no network. |
| `effort.py`, `hr_zones.py`, `activity_insights.py` | Per-run effort scoring, HR zones, single-activity breakdown. |
| `strava_predictions.py`, `strava_client.py` | Strava OAuth/API access and the predictions scraper. |
| `cook.py`, `cook_data.json` | Meal planning. |
| `ai_coach/` | The chat coach: Mistral client, conversation loop, tool definitions, context builder. |
| `context/`, `system_prompt_coach.md` | The coach's doctrine and physiology reference, injected into the system prompt. |
| `frontend/` | React 19 + Vite + Tailwind + TanStack Query + Recharts SPA. |

**Stack:** Python 3.9, FastAPI, SQLite, React 19, TypeScript, Vite, Tailwind v4.

---

## Setup

```bash
git clone <this repo> && cd run-coach
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
cp .env.example .env    # then fill it in
```

`.env` needs:

| Variable | Where to get it |
|---|---|
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | Create an API app at [strava.com/settings/api](https://www.strava.com/settings/api). |
| `STRAVA_REFRESH_TOKEN` | Leave empty. The first `ingest_strava.py` run opens a browser for the OAuth consent and writes the token back into `.env`. |
| `GARMIN_EMAIL`, `GARMIN_PASSWORD` | Your normal Garmin Connect login. Used only locally; session tokens are cached in `.garminconnect/`. |
| `MISTRAL_API_KEY` | [console.mistral.ai](https://console.mistral.ai/api-keys). Only needed for the chat coach. |

Then load your data and start the app:

```bash
./.venv/bin/python ingest_strava.py
./.venv/bin/python ingest_garmin.py
./.venv/bin/python load_plan.py
cd frontend && npm install && npm run build && cd ..
./.venv/bin/python app.py          # http://127.0.0.1:8000
```

### Development

```bash
./.venv/bin/python app.py          # API on :8000
cd frontend && npm run dev         # UI on :5173, proxies /api to :8000
```

### Keeping it up to date

The dashboard has a sync button that runs all three ingestion legs. For an
unattended daily refresh, point cron at `sync_daily.sh`:

```bash
0 6 * * * /path/to/run-coach/sync_daily.sh
```

---

## Caveats

- **Personal project, single athlete.** The database, the training plan and the
  coach's doctrine are all built around one runner targeting a 10K. Nothing is
  multi-tenant and there is no authentication — don't expose it to the internet.
- **`strava_predictions.py` scrapes the Strava web app** with Playwright. Those
  predicted race times exist nowhere in the public API. Automated access is
  against Strava's Terms of Service, and the scraper will break whenever Strava
  changes its frontend. It's optional — skip it and the rest still works.
- **Garmin ingestion uses the unofficial `garminconnect` package**, which logs in
  with your regular email/password. Unofficial means it can break at any time.
- **The training plan is a manual export**, not a live Google Calendar sync:
  `plan_data.json` is re-exported by hand when the plan changes, and
  `load_plan.py` replaces the whole table with its contents.
- **Thresholds are rules of thumb.** The effort score, the ACWR bands and the
  interval detection are judgment calls, flagged in comments where they matter
  so they're easy to tune.
