// Response shapes of the FastAPI app (api/routers/*). Kept in sync by hand
// with the contracts documented in coach.py / cook.py / effort.py.

export type Nullable<T> = T | null;

export interface Activity {
  id: string;
  source: "strava" | "garmin";
  name: Nullable<string>;
  sport_type: Nullable<string>;
  start_time: string;
  distance_m: Nullable<number>;
  moving_time_s: Nullable<number>;
  elevation_gain_m: Nullable<number>;
  avg_pace_s_per_km: Nullable<number>;
  avg_hr: Nullable<number>;
  max_hr: Nullable<number>;
  avg_cadence: Nullable<number>;
  calories: Nullable<number>;
  perceived_effort: Nullable<number>;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Split {
  distance_m: number;
  time_s: number;
  pace_s_per_km: Nullable<number>;
  avg_hr: Nullable<number>;
  elevation_gain_m: Nullable<number>;
  kind?: "work" | "recovery";
}

export type Streams = Partial<Record<"time" | "distance" | "heartrate" | "velocity_smooth" | "altitude" | "cadence" | "grade_smooth", number[]>>;

export interface ActivityDetail {
  activity: Activity & { external_id: string; timezone: Nullable<string>; elapsed_time_s: Nullable<number> };
  streams: Streams;
  splits: Split[];
  splits_kind: Nullable<"laps" | "intervals" | "km">;
  commentary: string[];
  note: Nullable<string>;
}

export interface EffortDay {
  date: string;
  score: number;
  level: 1 | 2 | 3 | 4 | 5;
  level_label: string;
  count: number;
  activity: Pick<Activity, "id" | "name" | "sport_type" | "distance_m" | "avg_pace_s_per_km" | "avg_hr">;
}

export interface EffortCalendar {
  earliest_date: Nullable<string>;
  days: EffortDay[];
}

export type AcwrFlag = "no_data" | "undertrained" | "sweet_spot" | "caution" | "high_injury_risk";

export interface Acwr {
  acute_km: number;
  chronic_km: number;
  ratio: number;
  flag: AcwrFlag;
}

export interface Recovery {
  status: "no_data" | "well_recovered" | "fatigued" | "normal";
  date: string;
  training_readiness: Nullable<number>;
  body_battery_high: Nullable<number>;
  hrv_ms: Nullable<number>;
  prior_7d_avg_training_readiness: Nullable<number>;
  prior_7d_avg_body_battery_high: Nullable<number>;
  prior_7d_avg_hrv_ms: Nullable<number>;
}

export interface WeeklyMileage {
  week_start: string;
  distance_km: number;
  num_runs: number;
}

export interface PaceWeek {
  week_start: string;
  avg_pace_s_per_km: Nullable<number>;
  avg_hr: Nullable<number>;
}

export interface Cadence {
  weekly: { week_start: string; avg_cadence: Nullable<number> }[];
  recent_avg_cadence: Nullable<number>;
  flag: "no_data" | "low" | "moderate" | "good";
}

export interface Gear {
  gear: { id: string; name: string; distance_km: number; flag: "ok" | "monitor" | "replace_soon" | "overdue" | "retired" }[];
  alert: Nullable<string>;
}

export interface CoachSummary {
  acwr: Acwr;
  recovery: Recovery;
  recent_weekly_mileage: WeeklyMileage[];
  recent_pace_trend: PaceWeek[];
  cadence: Cadence;
  gear: Gear;
  recommendation: string;
}

export interface WellnessDay {
  date: string;
  resting_hr: Nullable<number>;
  avg_hr_day: Nullable<number>;
  max_hr_day: Nullable<number>;
  hrv_ms: Nullable<number>;
  body_battery_high: Nullable<number>;
  body_battery_low: Nullable<number>;
  training_readiness: Nullable<number>;
  vo2max: Nullable<number>;
  sleep_score: Nullable<number>;
  sleep_hours: Nullable<number>;
  stress_avg: Nullable<number>;
}

export interface RacePredictions {
  reference: Nullable<{ name: Nullable<string>; date: string; distance_m: number; time_s: number }>;
  predictions: {
    label: string;
    distance_m: number;
    real_time_s: Nullable<number>;
    real_date: Nullable<string>;
    predicted_time_s: Nullable<number>;
  }[];
}

export type PlanStatusKind = "completed" | "partial" | "missed" | "upcoming";

export interface PlanDay {
  date: string;
  workout_type: Nullable<string>;
  title: string;
  planned_distance_km: Nullable<number>;
  pace_target: Nullable<string>;
  hr_target: Nullable<string>;
  notes: Nullable<string>;
  status: PlanStatusKind;
  actual_distance_km: Nullable<number>;
  actual_avg_hr: Nullable<number>;
}

export interface PlanStatus {
  days: PlanDay[];
  adherence_rate: Nullable<number>;
  completed: number;
  partial: number;
  missed: number;
  next_workout: Nullable<PlanDay>;
  advice: string;
}

export type MealType = "breakfast" | "lunch" | "snack" | "dinner";
export type Rating = "like" | "dislike" | null;

export interface Recipe {
  id: string;
  meal_type: MealType;
  name: string;
  tags: string[];
  prep_time_min: number;
  ingredients: { item: string; qty: string }[];
  steps: string[];
  macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  est_cost_eur: Nullable<number>;
  tip: string;
  rating: Rating;
}

export interface MealDay {
  date: string;
  day_label: string;
  workout_type: Nullable<string>;
  is_hard_day: boolean;
  meals: Recipe[];
}

export interface ShoppingList {
  days: number;
  total_estimated_cost_eur: number;
  distinct_recipes: number;
  categories: { category: string; items: { item: string; quantity: string; used_in: number }[] }[];
}

export type SyncResult = Record<string, { ok: boolean; message: string }>;

export interface SyncStatus {
  sources: { source: string; last_synced_at: Nullable<string> }[];
}
