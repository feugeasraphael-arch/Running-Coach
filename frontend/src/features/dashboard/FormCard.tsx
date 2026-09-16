import { Footprints } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stat } from "@/components/ui/Stat";
import { useCadence, useGear } from "@/lib/queries";
import { num } from "@/lib/format";
import type { Cadence, Gear } from "@/lib/types";

const CADENCE: Record<Cadence["flag"], { tone: Tone; label: string; hint: string }> = {
  no_data: { tone: "neutral", label: "No data", hint: "" },
  low: { tone: "warn", label: "Low", hint: "A slightly quicker, shorter stride usually reduces impact load." },
  moderate: { tone: "info", label: "Moderate", hint: "Reasonable range — small increases can help efficiency." },
  good: { tone: "good", label: "Good", hint: "Efficient turnover for your pace." },
};

const GEAR: Record<Gear["gear"][number]["flag"], { tone: Tone; label: string }> = {
  ok: { tone: "good", label: "OK" },
  monitor: { tone: "info", label: "Monitor" },
  replace_soon: { tone: "warn", label: "Replace soon" },
  overdue: { tone: "bad", label: "Overdue" },
  retired: { tone: "neutral", label: "Retired" },
};

// Typical running-shoe lifespan used only to draw the wear bar.
const SHOE_LIFE_KM = 800;

export function FormCard() {
  const cadence = useCadence(8);
  const gear = useGear();
  const shoes = (gear.data?.gear ?? []).filter((g) => g.flag !== "retired");

  return (
    <Card className="flex flex-col">
      <CardHeader title="Form & gear" icon={<Footprints />} />
      <CardBody className="flex flex-1 flex-col gap-5">
        {cadence.isPending ? (
          <Skeleton className="h-16" />
        ) : cadence.data && cadence.data.flag !== "no_data" ? (
          <div>
            <div className="flex items-start justify-between gap-2">
              <Stat label="Cadence · 8-week avg" value={num(cadence.data.recent_avg_cadence)} unit="spm" />
              <Badge tone={CADENCE[cadence.data.flag].tone} dot>{CADENCE[cadence.data.flag].label}</Badge>
            </div>
            <p className="mt-1.5 text-xs text-muted">{CADENCE[cadence.data.flag].hint}</p>
          </div>
        ) : (
          <EmptyState compact title="No cadence data yet" />
        )}

        <div className="border-t border-line pt-4">
          <div className="mb-3 text-xs text-muted">Shoes</div>
          {gear.isPending ? (
            <Skeleton className="h-10" />
          ) : shoes.length === 0 ? (
            <p className="text-xs text-subtle">No active gear synced from Strava.</p>
          ) : (
            <ul className="space-y-3">
              {shoes.map((g) => (
                <li key={g.id}>
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate font-medium">{g.name}</span>
                    <Badge tone={GEAR[g.flag].tone}>{GEAR[g.flag].label}</Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-current opacity-70" style={{ width: `${Math.min((g.distance_km / SHOE_LIFE_KM) * 100, 100)}%`, color: `var(--${GEAR[g.flag].tone === "neutral" ? "subtle" : GEAR[g.flag].tone})` }} />
                    </div>
                    <span className="tnum text-xs text-muted">{Math.round(g.distance_km)} km</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {gear.data?.alert && <p className="mt-3 text-xs text-warn">{gear.data.alert}</p>}
        </div>
      </CardBody>
    </Card>
  );
}
