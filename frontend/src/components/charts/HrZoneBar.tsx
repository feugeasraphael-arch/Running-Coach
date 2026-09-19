import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";
import { duration } from "@/lib/format";
import type { HrZone, HrZoneSummary } from "@/lib/types";

export const zoneColor = (zone: number) => (zone ? `var(--zone-${Math.min(zone, 5)})` : "var(--surface-2)");

const bpmRange = (z: HrZone) => (z.max_bpm == null ? `> ${Math.round(z.min_bpm)} bpm` : `${Math.round(z.min_bpm)}–${Math.round(z.max_bpm)} bpm`);

/** Merge consecutive same-zone slices so the bar renders a handful of divs, not one per slice. */
function runs(timeline: number[]) {
  const out: { zone: number; len: number }[] = [];
  for (const z of timeline) {
    const last = out[out.length - 1];
    if (last && last.zone === z) last.len += 1;
    else out.push({ zone: z, len: 1 });
  }
  return out;
}

function Strip({ summary, className }: { summary: HrZoneSummary; className?: string }) {
  const total = summary.timeline.length;
  return (
    <div className={cn("flex w-full overflow-hidden rounded-full bg-surface-2", className)}>
      {runs(summary.timeline).map((r, i) => (
        <div key={i} style={{ width: `${(r.len / total) * 100}%`, background: zoneColor(r.zone) }} />
      ))}
    </div>
  );
}

/** One row per zone: colour, name, bpm range, time and share of the run. */
export function ZoneBreakdown({ summary, zones, descriptions = true }: { summary: HrZoneSummary; zones: HrZone[]; descriptions?: boolean }) {
  const total = summary.time_in_zone_s.reduce((s, v) => s + v, 0) || 1;
  return (
    <ul className="space-y-2">
      {zones.map((z) => {
        const t = summary.time_in_zone_s[z.zone - 1] ?? 0;
        const pct = (t / total) * 100;
        return (
          <li key={z.zone} className={cn(t === 0 && "opacity-50")}>
            <div className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: zoneColor(z.zone) }} />
              <span className="font-medium">Z{z.zone} {z.name}</span>
              <span className="text-subtle">{bpmRange(z)}</span>
              <span className="tnum ml-auto pl-3 whitespace-nowrap">
                {duration(t)} <span className="text-muted">· {Math.round(pct)}%</span>
              </span>
            </div>
            <div className="mt-1 ml-4.5 h-1 rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: zoneColor(z.zone) }} />
            </div>
            {descriptions && <p className="mt-1 ml-4.5 leading-snug text-muted">{z.description}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** Compact zone timeline for lists: a thin bar that thickens on hover and
 *  opens a card with a bigger bar and what each zone means. */
export function HrZoneBar({ summary, zones, className }: { summary: HrZoneSummary | null | undefined; zones: HrZone[] | undefined; className?: string }) {
  if (!summary || !zones?.length) return <div className={cn("h-1.5 w-full rounded-full bg-surface-2/60", className)} aria-hidden />;
  return (
    <Tooltip
      side="bottom"
      className="w-80 max-w-[calc(100vw-2rem)] p-3"
      content={
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 flex justify-between text-muted">
              <span className="font-medium text-fg">Heart-rate zones</span>
              <span>start → finish</span>
            </div>
            <Strip summary={summary} className="h-4 rounded-md" />
          </div>
          <ZoneBreakdown summary={summary} zones={zones} />
        </div>
      }
    >
      <div
        tabIndex={0}
        role="img"
        aria-label="Heart-rate zone timeline"
        className={cn("group flex h-3 w-full cursor-help items-center", className)}
      >
        <Strip summary={summary} className="h-1.5 transition-[height] duration-150 group-hover:h-3 group-focus-visible:h-3" />
      </div>
    </Tooltip>
  );
}

/** Full-width version for the activity page. */
export function HrZoneStrip({ summary }: { summary: HrZoneSummary }) {
  return <Strip summary={summary} className="h-5 rounded-md" />;
}
