import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { Gauge, HeartPulse, Route, Wind } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge, toneText } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryState } from "@/components/ui/QueryState";
import { Stat } from "@/components/ui/Stat";
import { useAcwr, useRecovery, useWeeklyMileage, useWellnessTrend } from "@/lib/queries";
import { fmtDate, isNum, num } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ACWR_BANDS, RECOVERY, vo2Band } from "./tones";
import { C } from "@/components/charts/chartKit";

const StatsSkeleton = () => (
  <div className="space-y-3">
    <Skeleton className="h-8 w-24" />
    <Skeleton className="h-3 w-full" />
    <Skeleton className="h-3 w-2/3" />
  </div>
);

function KpiCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col">
      <CardHeader title={title} icon={icon} />
      <CardBody className="flex flex-1 flex-col">{children}</CardBody>
    </Card>
  );
}

export function TrainingLoadCard() {
  const q = useAcwr();
  return (
    <KpiCard title="Training load" icon={<Gauge />}>
      <QueryState
        query={q}
        loading={<StatsSkeleton />}
        isEmpty={(d) => d.flag === "no_data"}
        empty={<EmptyState compact title="Not enough history" hint="ACWR needs a few weeks of runs." />}
      >
        {(d) => {
          const band = ACWR_BANDS.find((b) => b.flag === d.flag);
          const pct = Math.min(d.ratio / 2, 1) * 100;
          return (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <Stat label="Acute : chronic ratio" value={d.ratio.toFixed(2)} size="lg" />
                {band && <Badge tone={band.tone} dot>{band.label}</Badge>}
              </div>
              <div className="relative mt-4 mb-1">
                <div className="flex h-2 overflow-hidden rounded-full">
                  {ACWR_BANDS.map((b) => (
                    <div
                      key={b.flag}
                      className={cn("h-full", toneText[b.tone], b.flag === d.flag ? "opacity-90" : "opacity-30")}
                      style={{ width: `${((b.to - b.from) / 2) * 100}%`, background: "currentColor" }}
                    />
                  ))}
                </div>
                <div
                  className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-fg shadow"
                  style={{ left: `${pct}%` }}
                />
              </div>
              <div className="tnum flex justify-between text-[10px] text-subtle">
                <span>0</span><span>0.8</span><span>1.3</span><span>1.5</span><span>2.0</span>
              </div>
              <div className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-3">
                <Stat size="sm" label="Last 7 days" value={d.acute_km.toFixed(1)} unit="km" />
                <Stat size="sm" label="28-day weekly avg" value={d.chronic_km.toFixed(1)} unit="km" />
              </div>
            </>
          );
        }}
      </QueryState>
    </KpiCard>
  );
}

export function RecoveryCard() {
  const q = useRecovery();
  return (
    <KpiCard title="Recovery" icon={<HeartPulse />}>
      <QueryState query={q} loading={<StatsSkeleton />} empty={<EmptyState compact title="No wellness data" hint="Sync Garmin to see recovery." />}>
        {(d) => {
          const r = RECOVERY[d.status] ?? RECOVERY.no_data;
          const delta = (cur: number | null, prev: number | null) =>
            isNum(cur) && isNum(prev) ? (
              <span className={cn("tnum", cur >= prev ? "text-good" : "text-warn")}>
                {cur >= prev ? "▲" : "▼"} {Math.abs(cur - prev).toFixed(0)} vs 7d
              </span>
            ) : undefined;
          return (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <div className={cn("text-2xl font-semibold tracking-tight", toneText[r.tone])}>{r.label}</div>
              </div>
              <p className="mt-1 text-xs text-muted">
                {r.detail} · {fmtDate(d.date, { weekday: "short", day: "numeric", month: "short" })}
              </p>
              <div className="mt-auto grid grid-cols-3 gap-3 border-t border-line pt-3">
                <Stat size="sm" label="Body battery" value={num(d.body_battery_high)} hint={delta(d.body_battery_high, d.prior_7d_avg_body_battery_high)} />
                <Stat size="sm" label="HRV" value={num(d.hrv_ms)} unit={isNum(d.hrv_ms) ? "ms" : undefined} hint={delta(d.hrv_ms, d.prior_7d_avg_hrv_ms)} />
                <Stat size="sm" label="Readiness" value={num(d.training_readiness)} hint={delta(d.training_readiness, d.prior_7d_avg_training_readiness)} />
              </div>
            </>
          );
        }}
      </QueryState>
    </KpiCard>
  );
}

export function Vo2maxCard() {
  const q = useWellnessTrend(365);
  return (
    <KpiCard title="VO₂max" icon={<Wind />}>
      <QueryState
        query={q}
        loading={<StatsSkeleton />}
        isEmpty={(d) => !d.some((x) => isNum(x.vo2max))}
        empty={<EmptyState compact title="No VO₂max readings yet" />}
      >
        {(d) => {
          const points = d.filter((x) => isNum(x.vo2max)).map((x) => ({ date: x.date, v: x.vo2max as number }));
          const latest = points[points.length - 1];
          const first = points[0];
          const band = vo2Band(latest.v);
          const change = latest.v - first.v;
          return (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <Stat label={`As of ${fmtDate(latest.date, { day: "numeric", month: "short" })}`} value={latest.v.toFixed(1)} unit="ml/kg/min" size="lg" />
                <Badge tone={band.tone} dot>{band.label}</Badge>
              </div>
              <div className="mt-3 -mx-1 h-16">
                <ResponsiveContainer>
                  <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <defs>
                      <linearGradient id="vo2fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.sleep} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={C.sleep} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
                    <Area type="monotone" dataKey="v" stroke={C.sleep} strokeWidth={2} fill="url(#vo2fill)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-auto pt-2 text-xs text-muted">
                <span className={cn("tnum font-medium", change >= 0 ? "text-good" : "text-warn")}>
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(1)}
                </span>{" "}
                over the last 12 months
              </p>
            </>
          );
        }}
      </QueryState>
    </KpiCard>
  );
}

export function ThisWeekCard() {
  const q = useWeeklyMileage(9);
  return (
    <KpiCard title="This week" icon={<Route />}>
      <QueryState query={q} loading={<StatsSkeleton />} isEmpty={(d) => d.length === 0} empty={<EmptyState compact title="No runs yet" />}>
        {(d) => {
          const current = d[d.length - 1];
          const previous = d.slice(0, -1);
          const avg = previous.length ? previous.reduce((s, w) => s + w.distance_km, 0) / previous.length : 0;
          const max = Math.max(...d.map((w) => w.distance_km), 1);
          return (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <Stat label={`${current.num_runs} run${current.num_runs === 1 ? "" : "s"} since Monday`} value={current.distance_km.toFixed(1)} unit="km" size="lg" />
              </div>
              <div className="mt-3 flex h-16 items-end gap-1.5" aria-hidden>
                {d.map((w, i) => (
                  <div
                    key={w.week_start}
                    className={cn("flex-1 rounded-sm", i === d.length - 1 ? "bg-accent" : "bg-line-strong")}
                    style={{ height: `${Math.max((w.distance_km / max) * 100, 4)}%` }}
                    title={`${w.week_start}: ${w.distance_km} km`}
                  />
                ))}
              </div>
              <p className="mt-auto pt-2 text-xs text-muted">
                8-week average <span className="tnum font-medium text-fg">{avg.toFixed(1)} km</span>
              </p>
            </>
          );
        }}
      </QueryState>
    </KpiCard>
  );
}
