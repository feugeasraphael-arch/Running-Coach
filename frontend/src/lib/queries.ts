import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { MealDay, Rating, Recipe } from "./types";

export const useCoachSummary = () => useQuery({ queryKey: ["coach", "summary"], queryFn: api.coachSummary });
export const useAcwr = () => useQuery({ queryKey: ["coach", "acwr"], queryFn: api.acwr });
export const useRecovery = () => useQuery({ queryKey: ["wellness", "recovery"], queryFn: api.recovery });
export const usePredictions = () => useQuery({ queryKey: ["coach", "predictions"], queryFn: () => api.predictions() });
export const useGear = () => useQuery({ queryKey: ["coach", "gear"], queryFn: api.gear });
export const useEffortCalendar = () => useQuery({ queryKey: ["activities", "effort"], queryFn: api.effortCalendar });

export const useWeeklyMileage = (weeks: number) =>
  useQuery({ queryKey: ["coach", "mileage", weeks], queryFn: () => api.weeklyMileage(weeks), placeholderData: keepPreviousData });
export const usePaceTrend = (weeks: number) =>
  useQuery({ queryKey: ["coach", "pace", weeks], queryFn: () => api.paceTrend(weeks), placeholderData: keepPreviousData });
export const useCadence = (weeks: number) =>
  useQuery({ queryKey: ["coach", "cadence", weeks], queryFn: () => api.cadence(weeks), placeholderData: keepPreviousData });
export const useWellnessTrend = (days: number) =>
  useQuery({ queryKey: ["wellness", "trend", days], queryFn: () => api.wellnessTrend(days), placeholderData: keepPreviousData });

export const useActivities = (p: { limit: number; offset: number; q?: string }) =>
  useQuery({ queryKey: ["activities", "list", p], queryFn: () => api.activities(p), placeholderData: keepPreviousData });
export const useActivity = (id: string) =>
  useQuery({ queryKey: ["activities", "detail", id], queryFn: () => api.activity(id), staleTime: 5 * 60_000 });

export const usePlanStatus = () => useQuery({ queryKey: ["plan", "status"], queryFn: () => api.planStatus() });

export const useMealPlan = () => useQuery({ queryKey: ["cook", "plan"], queryFn: () => api.mealPlan() });
export const useRecipes = (enabled = true) => useQuery({ queryKey: ["cook", "recipes"], queryFn: api.recipes, enabled });
export const useShoppingList = (enabled = true) =>
  useQuery({ queryKey: ["cook", "shopping"], queryFn: () => api.shoppingList(), enabled });

export const useSyncStatus = () => useQuery({ queryKey: ["sync", "status"], queryFn: api.syncStatus, refetchInterval: 60_000 });

export function useSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.sync,
    onSettled: () => qc.invalidateQueries(),
  });
}

/** Optimistic like/dislike: patch every cached copy of the recipe at once so
 *  the meal dialog, the plan grid and the Chef's Menu all flip instantly,
 *  then refetch the plan (a disliked recipe rotates out of it). */
export function useRateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rating }: { id: string; rating: Rating }) => api.rateRecipe(id, rating),
    onMutate: async ({ id, rating }) => {
      await qc.cancelQueries({ queryKey: ["cook"] });
      const prevPlan = qc.getQueryData<MealDay[] | null>(["cook", "plan"]);
      const prevRecipes = qc.getQueryData<Recipe[] | null>(["cook", "recipes"]);
      const patch = (r: Recipe) => (r.id === id ? { ...r, rating } : r);
      if (prevPlan) qc.setQueryData(["cook", "plan"], prevPlan.map((d) => ({ ...d, meals: d.meals.map(patch) })));
      if (prevRecipes) qc.setQueryData(["cook", "recipes"], prevRecipes.map(patch));
      return { prevPlan, prevRecipes };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevPlan) qc.setQueryData(["cook", "plan"], ctx.prevPlan);
      if (ctx?.prevRecipes) qc.setQueryData(["cook", "recipes"], ctx.prevRecipes);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["cook", "plan"] });
      qc.invalidateQueries({ queryKey: ["cook", "shopping"] });
    },
  });
}
