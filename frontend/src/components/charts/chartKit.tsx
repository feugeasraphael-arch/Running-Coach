import type { ReactNode } from "react";

// Shared Recharts styling. Colors reference CSS variables so charts follow
// the light/dark theme with no JS involved.
export const C = {
  distance: "var(--chart-1)",
  hr: "var(--chart-2)",
  sleep: "var(--chart-3)",
  battery: "var(--chart-4)",
  stress: "var(--chart-5)",
  grid: "var(--grid)",
  axis: "var(--subtle)",
} as const;

export const axisProps = {
  stroke: C.axis,
  tick: { fill: C.axis, fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const gridProps = { stroke: C.grid, vertical: false } as const;

export function ChartTip({ title, rows }: { title: ReactNode; rows: { label: ReactNode; value: ReactNode; color?: string }[] }) {
  return (
    <div className="min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-xl">
      <div className="mb-1.5 font-medium">{title}</div>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              {r.color && <span className="size-2 rounded-full" style={{ background: r.color }} />}
              {r.label}
            </span>
            <span className="tnum font-medium">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span
            className="h-0.5 w-3.5 rounded-full"
            style={i.dashed ? { backgroundImage: `linear-gradient(90deg, ${i.color} 50%, transparent 50%)`, backgroundSize: "5px 2px" } : { background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Evenly thin a long stream to at most `max` points so the SVG stays light. */
export function downsample<T>(points: T[], max = 600): T[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}
