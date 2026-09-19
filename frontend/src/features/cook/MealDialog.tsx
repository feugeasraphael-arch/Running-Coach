import { useEffect, useState } from "react";
import { Lightbulb, ThumbsDown, ThumbsUp } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Stat } from "@/components/ui/Stat";
import { useRateRecipe } from "@/lib/queries";
import { euro } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Rating, Recipe } from "@/lib/types";

export function RatingIcon({ rating }: { rating: Exclude<Rating, null> }) {
  return rating === "like" ? <ThumbsUp className="size-3 shrink-0 text-good" /> : <ThumbsDown className="size-3 shrink-0 text-bad" />;
}

export function RateButtons({ recipe, compact }: { recipe: Recipe; compact?: boolean }) {
  const rate = useRateRecipe();
  // Local copy so the buttons flip instantly even when `recipe` is a
  // snapshot (the meal dialog keeps showing a recipe a dislike just rotated
  // out of the plan); resyncs whenever fresh data arrives from the cache.
  const [current, setCurrent] = useState<Rating>(recipe.rating);
  useEffect(() => {
    setCurrent(recipe.rating);
  }, [recipe.id, recipe.rating]);
  const set = (r: Exclude<Rating, null>) => {
    const next = current === r ? null : r;
    setCurrent(next);
    rate.mutate({ id: recipe.id, rating: next }, { onError: () => setCurrent(recipe.rating) });
  };
  return (
    <div className="flex gap-1.5">
      <Button
        size={compact ? "icon" : "sm"}
        aria-pressed={current === "like"}
        aria-label="Like"
        onClick={(e) => { e.stopPropagation(); set("like"); }}
        className={cn(current === "like" && "border-good/40 bg-good/10 text-good hover:bg-good/15")}
      >
        <ThumbsUp />{!compact && "Like"}
      </Button>
      <Button
        size={compact ? "icon" : "sm"}
        aria-pressed={current === "dislike"}
        aria-label="Dislike"
        onClick={(e) => { e.stopPropagation(); set("dislike"); }}
        className={cn(current === "dislike" && "border-bad/40 bg-bad/10 text-bad hover:bg-bad/15")}
      >
        <ThumbsDown />{!compact && "Dislike"}
      </Button>
    </div>
  );
}

export function MealDialog({ selection, onClose }: { selection: { recipe: Recipe; context?: string } | null; onClose: () => void }) {
  const m = selection?.recipe;
  return (
    <Dialog
      open={!!m}
      onOpenChange={(o) => !o && onClose()}
      title={m?.name ?? ""}
      description={m ? `${selection?.context ?? ""} · ${m.prep_time_min} min · ~${euro(m.est_cost_eur)}` : undefined}
    >
      {m && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {m.tags.map((t) => <Badge key={t}>{t.replace(/_/g, " ")}</Badge>)}
            </div>
            <RateButtons recipe={m} />
          </div>

          <div className="grid grid-cols-4 gap-3 rounded-xl bg-surface-2 p-4">
            <Stat size="sm" label="Calories" value={m.macros.calories} />
            <Stat size="sm" label="Protein" value={m.macros.protein_g} unit="g" />
            <Stat size="sm" label="Carbs" value={m.macros.carbs_g} unit="g" />
            <Stat size="sm" label="Fat" value={m.macros.fat_g} unit="g" />
          </div>

          <div className="grid gap-6 sm:grid-cols-[2fr_3fr]">
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Ingredients</h3>
              <ul className="divide-y divide-line text-[13px]">
                {m.ingredients.map((i) => (
                  <li key={i.item} className="flex justify-between gap-3 py-1.5">
                    <span>{i.item}</span>
                    <span className="readout shrink-0 text-muted">{i.qty}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Method</h3>
              <ol className="space-y-2.5 text-[13px] leading-relaxed">
                {m.steps.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="tnum grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <p className="flex gap-2.5 rounded-xl border border-line p-3.5 text-[13px] leading-relaxed text-muted">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-warn" />
            {m.tip}
          </p>
        </div>
      )}
    </Dialog>
  );
}
