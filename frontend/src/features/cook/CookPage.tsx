import { useMemo, useState } from "react";
import { BookOpen, Clock, Flame, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useMealPlan } from "@/lib/queries";
import { euro, fmtDate, isoDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { MealType, Recipe } from "@/lib/types";
import { WORKOUT_LABEL } from "@/features/dashboard/tones";
import { MealDialog, RatingIcon } from "./MealDialog";
import { ShoppingListDialog } from "./ShoppingListDialog";
import { ChefsMenuDialog } from "./ChefsMenuDialog";

export const MEAL_LABEL: Record<MealType, string> = { breakfast: "Breakfast", lunch: "Lunch", snack: "Snack", dinner: "Dinner" };

export function CookPage() {
  const q = useMealPlan();
  const [selected, setSelected] = useState<{ recipe: Recipe; context?: string } | null>(null);
  const [shopping, setShopping] = useState(false);
  const [chef, setChef] = useState(false);
  // Opening a recipe from the Chef's menu swaps dialogs (Radix dialogs
  // shouldn't stack) and returns to the menu when the recipe is closed.
  const [returnToChef, setReturnToChef] = useState(false);
  const today = isoDay(new Date());

  const weekTotals = useMemo(() => {
    const meals = q.data?.flatMap((d) => d.meals) ?? [];
    return { cost: meals.reduce((s, m) => s + (m.est_cost_eur ?? 0), 0), kcal: meals.reduce((s, m) => s + m.macros.calories, 0) / Math.max(q.data?.length ?? 1, 1) };
  }, [q.data]);

  return (
    <>
      <PageHeader
        title="The Cook"
        subtitle="Seven days of meals, nudged toward carbs or protein around your hard sessions."
        actions={
          <>
            <Button onClick={() => setChef(true)}><BookOpen /> Chef's menu</Button>
            <Button variant="primary" onClick={() => setShopping(true)}><ShoppingCart /> Shopping list</Button>
          </>
        }
      />

      {q.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}</div>
      ) : q.isError ? (
        <EmptyState error title="Couldn't load the meal plan" hint={String(q.error)} />
      ) : !q.data ? (
        <EmptyState title="No meal plan available yet" />
      ) : (
        <>
          <div className="tnum mb-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <span><span className="text-base font-semibold text-fg">{euro(weekTotals.cost)}</span> estimated for {q.data.length} days</span>
            <span><span className="text-base font-semibold text-fg">{Math.round(weekTotals.kcal)}</span> kcal / day average</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {q.data.map((day) => {
              const isToday = day.date === today;
              const kcal = day.meals.reduce((s, m) => s + m.macros.calories, 0);
              return (
                <Card key={day.date} className={cn("flex flex-col", isToday && "ring-2 ring-accent/40")}>
                  <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
                    <div>
                      <div className="font-semibold tracking-tight">{isToday ? "Today" : fmtDate(day.date, { weekday: "long" })}</div>
                      <div className="tnum text-xs text-muted">{fmtDate(day.date, { day: "numeric", month: "short" })} · {kcal} kcal</div>
                    </div>
                    {day.workout_type ? (
                      <Badge tone={day.is_hard_day ? "warn" : "good"} dot>{WORKOUT_LABEL[day.workout_type] ?? day.workout_type}</Badge>
                    ) : (
                      <Badge>Rest day</Badge>
                    )}
                  </div>
                  <ul className="flex-1 space-y-1 px-2 pb-2">
                    {day.meals.map((m) => (
                      <li key={m.meal_type}>
                        <button
                          type="button"
                          onClick={() => setSelected({ recipe: m, context: `${MEAL_LABEL[m.meal_type]} · ${fmtDate(day.date, { weekday: "long", day: "numeric", month: "short" })}` })}
                          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-semibold tracking-wide text-subtle uppercase">{MEAL_LABEL[m.meal_type]}</div>
                            <div className="flex items-center gap-1.5 truncate font-medium">
                              {m.rating && <RatingIcon rating={m.rating} />}
                              <span className="truncate">{m.name}</span>
                            </div>
                          </div>
                          <div className="tnum shrink-0 text-right text-[11px] text-muted">
                            <div className="flex items-center justify-end gap-1"><Flame className="size-3" />{m.macros.calories}</div>
                            <div className="flex items-center justify-end gap-1"><Clock className="size-3" />{m.prep_time_min}′</div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <MealDialog
        selection={selected}
        onClose={() => {
          setSelected(null);
          if (returnToChef) {
            setReturnToChef(false);
            setChef(true);
          }
        }}
      />
      <ShoppingListDialog open={shopping} onOpenChange={setShopping} />
      <ChefsMenuDialog open={chef} onOpenChange={setChef} onOpenRecipe={(r) => {
          setChef(false);
          setReturnToChef(true);
          setSelected({ recipe: r, context: `${MEAL_LABEL[r.meal_type]} · Chef's menu` });
        }} />
    </>
  );
}
