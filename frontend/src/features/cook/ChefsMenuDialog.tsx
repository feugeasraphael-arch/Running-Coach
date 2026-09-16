import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Segmented";
import { Skeleton } from "@/components/ui/Skeleton";
import { useRecipes } from "@/lib/queries";
import { euro } from "@/lib/format";
import type { MealType, Recipe } from "@/lib/types";
import { RateButtons } from "./MealDialog";

const TYPES: { key: MealType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "snack", label: "Snack" },
  { key: "dinner", label: "Dinner" },
];

export function ChefsMenuDialog({ open, onOpenChange, onOpenRecipe }: { open: boolean; onOpenChange: (o: boolean) => void; onOpenRecipe: (r: Recipe) => void }) {
  const q = useRecipes(open);
  const [type, setType] = useState<MealType | "all">("all");
  const list = useMemo(() => (q.data ?? []).filter((r) => type === "all" || r.meal_type === type), [q.data, type]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Chef's menu"
      description={q.data ? `Every recipe in the library · ${q.data.length} total. Likes appear more often; dislikes are rotated out.` : undefined}
      className="max-w-3xl"
    >
      <Segmented label="Meal type" options={TYPES} value={type} onChange={setType} className="mb-4" />
      {q.isPending ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : !q.data ? (
        <EmptyState title="No recipes available" />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2">
              <button type="button" className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2" onClick={() => onOpenRecipe(r)}>
                <div className="truncate font-medium">{r.name}</div>
                <div className="tnum text-xs text-muted">
                  {r.prep_time_min} min · {euro(r.est_cost_eur)} · {r.macros.calories} kcal · {r.macros.protein_g} g protein
                </div>
              </button>
              <RateButtons recipe={r} compact />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
