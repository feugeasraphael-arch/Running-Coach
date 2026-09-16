import type * as T from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Analytics endpoints answer 200 + {status: "no_data"} when there's simply
 *  nothing to show yet. That's an empty state, not an error, so it resolves
 *  to `null` and components render their empty placeholder. */
async function request<R>(path: string, init?: RequestInit): Promise<R | null> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (body && typeof body.detail === "string" && body.detail) || res.statusText);
  }
  if (body && !Array.isArray(body) && body.status === "no_data") return null;
  return body as R;
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export const api = {
  activities: (p: { limit?: number; offset?: number; q?: string }) => request<T.Page<T.Activity>>(`/activities${qs(p)}`),
  activity: (id: string) => request<T.ActivityDetail>(`/activities/${encodeURIComponent(id)}`),
  effortCalendar: () => request<T.EffortCalendar>(`/activities/effort-calendar`),

  coachSummary: () => request<T.CoachSummary>(`/coach/summary`),
  acwr: () => request<T.Acwr>(`/coach/acwr`),
  weeklyMileage: (weeks: number) => request<T.WeeklyMileage[]>(`/coach/weekly-mileage${qs({ weeks })}`),
  paceTrend: (weeks: number) => request<T.PaceWeek[]>(`/coach/pace-trend${qs({ weeks })}`),
  cadence: (weeks: number) => request<T.Cadence>(`/coach/cadence${qs({ weeks })}`),
  gear: () => request<T.Gear>(`/coach/gear`),
  predictions: (days = 120) => request<T.RacePredictions>(`/coach/predictions${qs({ days })}`),

  recovery: () => request<T.Recovery>(`/wellness/recovery`),
  wellnessTrend: (days: number) => request<T.WellnessDay[]>(`/wellness/trend${qs({ days })}`),

  planStatus: (weeksBack = 10, weeksForward = 3) =>
    request<T.PlanStatus>(`/plan/status${qs({ weeks_back: weeksBack, weeks_forward: weeksForward })}`),

  mealPlan: (days = 7) => request<T.MealDay[]>(`/cook/meal-plan${qs({ days })}`),
  shoppingList: (days = 7) => request<T.ShoppingList>(`/cook/shopping-list${qs({ days })}`),
  recipes: () => request<T.Recipe[]>(`/cook/recipes`),
  rateRecipe: (id: string, rating: T.Rating) =>
    request<{ recipe_id: string; rating: T.Rating }>(`/cook/recipes/${encodeURIComponent(id)}/rating`, {
      method: "PUT",
      body: JSON.stringify({ rating }),
    }),

  syncStatus: () => request<T.SyncStatus>(`/sync/status`),
  sync: () => request<T.SyncResult>(`/sync`, { method: "POST" }),
};
