import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, HeartPulse, Info, MessageSquareQuote, Timer } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stat } from "@/components/ui/Stat";
import { C, ChartTip, Legend, axisProps, downsample, gridProps } from "@/components/charts/chartKit";
import { HrZoneStrip, ZoneBreakdown } from "@/components/charts/HrZoneBar";
import { useActivity } from "@/lib/queries";
import { capitalize, dateTime, duration, isNum, km, LOCALE, num, pace } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ActivityDetail, HrZone, HrZoneSummary, IntervalSession, Split, Streams, TargetStatus } from "@/lib/types";

export function ActivityDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const q = useActivity(id);

  const back = (
    <button
      onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/activities"))}
      className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-fg"
    >
      <ArrowLeft className="size-3.5" /> Back
    </button>
  );

  if (q.isPending) {
    return (
      <>
        {back}
        <Skeleton className="mb-2 h-8 w-72" />
        <Skeleton className="mb-6 h-4 w-52" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </>
    );
  }
  if (q.isError || !q.data) {
    return (
      <>
        {back}
        <EmptyState error title="Couldn't load this activity" hint={q.error ? String(q.error.message) : undefined} />
        <div className="text-center"><Link to="/activities" className="text-xs text-accent hover:underline">All activities</Link></div>
      </>
    );
  }
  return (
    <>
      {back}
      <Detail data={q.data} />
    </>
  );
}

function Detail({ data }: { data: ActivityDetail }) {
  const a = data.activity;
  const stats = [
    { label: "Distance", value: km(a.distance_m, 2), unit: "km" },
    { label: "Moving time", value: duration(a.moving_time_s) },
    { label: "Avg pace", value: pace(a.avg_pace_s_per_km, false), unit: "/km" },
    { label: "Avg HR", value: num(a.avg_hr), unit: "bpm" },
    { label: "Max HR", value: num(a.max_hr), unit: "bpm" },
    { label: "Elevation", value: num(a.elevation_gain_m), unit: "m" },
    { label: "Cadence", value: num(a.avg_cadence), unit: "spm" },
    { label: "Calories", value: num(a.calories), unit: "kcal" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Badge>{capitalize(a.sport_type ?? "activity")}</Badge>
          <Badge>{capitalize(a.source)}</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{a.name ?? "Activity"}</h1>
        <p className="mt-1 text-[13px] text-muted">{dateTime(a.start_time)}</p>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-4 lg:grid-cols-8">
          {stats.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} unit={s.value === "–" ? undefined : s.unit} />
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {data.intervals && <IntervalSummary iv={data.intervals} />}
          <StreamCharts streams={data.streams} splits={data.splits_kind === "intervals" ? data.splits : []} />
          {data.splits.length > 0 && <Splits splits={data.splits} kind={data.splits_kind} />}
        </div>
        <div className="h-fit space-y-4">
          {data.hr_zones && data.zones.length > 0 && <ZonesCard summary={data.hr_zones} zones={data.zones} />}
          <Card>
            <CardHeader title="Coach's notes" icon={<MessageSquareQuote />} />
            <CardBody>
              {data.commentary.length ? (
                <ul className="space-y-3">
                  {data.commentary.map((c, i) => (
                    <li key={i} className="flex gap-3 text-[13px] leading-relaxed">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                      {c}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">Nothing notable to flag for this run.</p>
              )}
              {data.note && (
                <p className="mt-4 flex gap-2 rounded-lg bg-surface-2 p-3 text-xs text-muted">
                  <Info className="mt-0.5 size-3.5 shrink-0" /> {data.note}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

const STATUS: Record<TargetStatus, { label: string; color: string; tone: "good" | "warn" | "bad" }> = {
  on: { label: "On target", color: "var(--good)", tone: "good" },
  fast: { label: "Too fast", color: "var(--warn)", tone: "warn" },
  slow: { label: "Too slow", color: "var(--bad)", tone: "bad" },
};

const paceRange = (min: number, max: number) => `${pace(min, false)}–${pace(max, false)} /km`;

function IntervalSummary({ iv }: { iv: IntervalSession }) {
  const counts = [
    { n: iv.on_target, s: STATUS.on },
    { n: iv.too_fast, s: STATUS.fast },
    { n: iv.too_slow, s: STATUS.slow },
  ];
  return (
    <Card>
      <CardHeader
        title="Interval session"
        icon={<Timer />}
        subtitle={`Detected from ${iv.signals.join(", ")}`}
        actions={<Badge tone="accent">{iv.reps} reps</Badge>}
      />
      <CardBody className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <Stat
          label={iv.target?.source === "plan" ? "Target pace (plan)" : "Target pace (activity name)"}
          value={iv.target ? paceRange(iv.target.min_s_per_km, iv.target.max_s_per_km) : "–"}
        />
        {iv.target && (
          <div className="flex flex-wrap gap-1.5">
            {counts.map(({ n, s }) => (n > 0 || s === STATUS.on) && (
              <Badge key={s.label} tone={s.tone} dot>{n}/{iv.reps} {s.label.toLowerCase()}</Badge>
            ))}
          </div>
        )}
        {iv.planned && (
          <p className="basis-full text-xs text-muted">
            Plan · {fmtPlanDate(iv.planned.date)}: <span className="text-fg">{iv.planned.title}</span>
            {iv.planned.pace_target && <> · {iv.planned.pace_target}</>}
          </p>
        )}
        {!iv.target && <p className="basis-full text-xs text-muted">No target pace found — add it to the activity name (e.g. “4x4min 4’35”) or to the plan.</p>}
      </CardBody>
    </Card>
  );
}

const fmtPlanDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" });

function ZonesCard({ summary, zones }: { summary: HrZoneSummary; zones: HrZone[] }) {
  return (
    <Card>
      <CardHeader title="Heart-rate zones" icon={<HeartPulse />} subtitle="Zone at each moment, start → finish" />
      <CardBody className="space-y-4 text-xs">
        <HrZoneStrip summary={summary} />
        <ZoneBreakdown summary={summary} zones={zones} />
      </CardBody>
    </Card>
  );
}

const PACE_MIN = 180, PACE_MAX = 540; // clamp 3:00–9:00 /km so stops don't blow out the axis

function StreamCharts({ streams, splits }: { streams: Streams; splits: Split[] }) {
  const rows = useMemo(() => {
    const dist = streams.distance ?? [];
    // GPS velocity is noisy sample-to-sample; a centred ~10-sample rolling
    // mean shows the pacing shape without hiding real surges.
    const vel = streams.velocity_smooth ?? [];
    const W = 5;
    const smoothVel = vel.map((_, i) => {
      const win = vel.slice(Math.max(0, i - W), i + W + 1).filter((v) => isNum(v) && v > 0);
      return win.length ? win.reduce((s, v) => s + v, 0) / win.length : null;
    });
    return downsample(
      dist.map((d, i) => {
        const v = smoothVel[i];
        const p = isNum(v) && v > 0 ? 1000 / v : null;
        return {
          km: d / 1000,
          hr: streams.heartrate?.[i] ?? null,
          pace: p != null && p >= PACE_MIN && p <= PACE_MAX ? p : null,
          alt: streams.altitude?.[i] ?? null,
        };
      }),
      700,
    );
  }, [streams]);

  const reps = splits
    .map((s, i) => ({ ...s, n: splits.slice(0, i + 1).filter((x) => x.kind === "work").length }))
    .filter((s) => s.kind === "work" && isNum(s.start_m) && isNum(s.end_m));
  const repAt = (kmVal: number) => reps.find((r) => kmVal * 1000 >= r.start_m! && kmVal * 1000 <= r.end_m!);

  if (!rows.length) return null;

  const defs = [
    { key: "pace", title: "Pace", color: C.distance, fmt: (v: number) => pace(v), tick: (v: number) => pace(v, false), reversed: true },
    { key: "hr", title: "Heart rate", color: C.hr, fmt: (v: number) => `${Math.round(v)} bpm`, tick: (v: number) => String(Math.round(v)) },
    { key: "alt", title: "Elevation", color: C.battery, fmt: (v: number) => `${Math.round(v)} m`, tick: (v: number) => String(Math.round(v)) },
  ] as const;

  return (
    <Card>
      <CardHeader title="Run profile" subtitle="By distance" />
      <CardBody className="space-y-5">
        {defs.map((def) => {
          if (!rows.some((r) => r[def.key] != null)) return null;
          const gid = `fill-${def.key}`;
          return (
            <div key={def.key}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted">{def.title}</span>
                {def.key === "pace" && reps.length > 0 && (
                  <Legend
                    items={[
                      ...(reps.some((r) => r.target_status) ? [] : [{ label: "Rep", color: C.distance }]),
                      ...(Object.keys(STATUS) as TargetStatus[])
                        .filter((k) => reps.some((r) => r.target_status === k))
                        .map((k) => ({ label: `Target band · ${STATUS[k].label.toLowerCase()}`, color: STATUS[k].color, dashed: true })),
                    ]}
                  />
                )}
              </div>
              <div className={def.key === "pace" && reps.length > 0 ? "h-52" : "h-36"}>
                <ResponsiveContainer>
                  <AreaChart data={rows} syncId="run" margin={{ top: 4, right: 0, bottom: 0, left: -6 }}>
                    <defs>
                      <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={def.color} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={def.color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="km" type="number" domain={["dataMin", "dataMax"]} {...axisProps} tickFormatter={(v) => `${v.toFixed(1)}`} unit=" km" minTickGap={30} />
                    <YAxis
                      {...axisProps}
                      width={46}
                      reversed={"reversed" in def && def.reversed}
                      domain={["auto", "auto"]}
                      tickFormatter={def.tick}
                    />
                    <Tooltip
                      content={({ active, payload }) =>
                        active && payload?.length ? (
                          <ChartTip
                            title={`${(payload[0].payload.km as number).toFixed(2)} km`}
                            rows={[
                              ...(() => {
                                const r = repAt(payload[0].payload.km);
                                if (!r) return [];
                                return [
                                  { label: `Rep ${r.n}`, value: pace(r.pace_s_per_km), color: r.target_status ? STATUS[r.target_status].color : C.distance },
                                  ...(isNum(r.target_min_s_per_km) && isNum(r.target_max_s_per_km)
                                    ? [{ label: "Target", value: paceRange(r.target_min_s_per_km, r.target_max_s_per_km) }]
                                    : []),
                                ];
                              })(),
                              { label: "Pace", value: pace(payload[0].payload.pace), color: C.distance },
                              { label: "HR", value: isNum(payload[0].payload.hr) ? `${Math.round(payload[0].payload.hr)} bpm` : "–", color: C.hr },
                              { label: "Elevation", value: isNum(payload[0].payload.alt) ? `${Math.round(payload[0].payload.alt)} m` : "–", color: C.battery },
                            ]}
                          />
                        ) : null
                      }
                    />
                    {def.key === "pace" &&
                      reps.map((r) => {
                        const x1 = r.start_m! / 1000, x2 = r.end_m! / 1000;
                        const color = r.target_status ? STATUS[r.target_status].color : C.distance;
                        return [
                          // Rep span, tinted by how the rep went against its target.
                          <ReferenceArea key={`rep-${r.n}`} x1={x1} x2={x2} fill={color} fillOpacity={0.08} stroke="none" ifOverflow="hidden" />,
                          // Target pace band inside the rep.
                          isNum(r.target_min_s_per_km) && isNum(r.target_max_s_per_km) && (
                            <ReferenceArea
                              key={`target-${r.n}`}
                              x1={x1}
                              x2={x2}
                              y1={r.target_min_s_per_km}
                              y2={r.target_max_s_per_km}
                              fill={color}
                              fillOpacity={0.28}
                              stroke={color}
                              strokeDasharray="3 3"
                              strokeOpacity={0.9}
                              ifOverflow="extendDomain"
                              label={{ value: `R${r.n}`, position: "insideTop", fontSize: 10, fill: "var(--muted)" }}
                            />
                          ),
                        ];
                      })}
                    <Area
                      type="monotone"
                      dataKey={def.key}
                      stroke={def.color}
                      strokeWidth={1.75}
                      fill={`url(#${gid})`}
                      baseValue={"reversed" in def ? "dataMax" : "dataMin"}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

function Splits({ splits, kind }: { splits: Split[]; kind: ActivityDetail["splits_kind"] }) {
  const hasKind = splits.some((s) => s.kind);
  const paces = splits.map((s) => s.pace_s_per_km).filter(isNum);
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  const title = hasKind ? "Reps & recoveries" : kind === "laps" ? "Laps" : "Splits";
  const hasTarget = splits.some((s) => s.target_status);

  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} subtitle={hasKind ? "Work reps compared against the target pace" : undefined} />
      <div className="mt-3 overflow-x-auto">
        <table className="readout w-full text-[13px]">
          <thead className="text-xs text-muted">
            <tr className="border-y border-line">
              <th className="px-5 py-2 text-left font-medium">#</th>
              {hasKind && <th className="px-3 py-2 text-left font-medium">Type</th>}
              <th className="px-3 py-2 text-right font-medium">Distance</th>
              <th className="px-3 py-2 text-right font-medium">Time</th>
              <th className="w-2/5 px-3 py-2 text-left font-medium">Pace</th>
              {hasTarget && <th className="px-3 py-2 text-left font-medium">vs target</th>}
              <th className="px-3 py-2 text-right font-medium">HR</th>
              <th className="px-5 py-2 text-right font-medium">Elev.</th>
            </tr>
          </thead>
          <tbody>
            {splits.map((s, i) => {
              const p = s.pace_s_per_km;
              // Bar length: fastest split = full width.
              const w = isNum(p) && slowest > fastest ? 35 + ((slowest - p) / (slowest - fastest)) * 65 : 100;
              return (
                <tr key={i} className={cn("border-b border-line last:border-0", s.kind && s.kind !== "work" && "text-muted")}>
                  <td className="px-5 py-2 text-muted">{i + 1}</td>
                  {hasKind && (
                    <td className="px-3 py-2">
                      {s.kind === "work" ? <Badge tone="accent">Work</Badge> : s.kind ? <Badge>{KIND_LABEL[s.kind]}</Badge> : "–"}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">{km(s.distance_m, 2)} km</td>
                  <td className="px-3 py-2 text-right">{duration(s.time_s)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-12 shrink-0">{pace(p, false)}</span>
                      <div className="h-1.5 flex-1 rounded-full bg-surface-2">
                        <div
                          className={cn("h-full rounded-full", s.kind && s.kind !== "work" ? "bg-subtle/50" : "bg-accent")}
                          style={{ width: `${w}%`, opacity: p === fastest ? 1 : 0.6 }}
                        />
                      </div>
                    </div>
                  </td>
                  {hasTarget && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      {s.target_status && <TargetDelta split={s} status={s.target_status} />}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">{num(s.avg_hr)}</td>
                  <td className="px-5 py-2 text-right">{isNum(s.elevation_gain_m) ? `${Math.round(s.elevation_gain_m)} m` : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const KIND_LABEL: Record<NonNullable<Split["kind"]>, string> = { work: "Work", recovery: "Recovery", warmup: "Warm-up", cooldown: "Cool-down" };

function TargetDelta({ split, status }: { split: Split; status: TargetStatus }) {
  const p = split.pace_s_per_km;
  const lo = split.target_min_s_per_km, hi = split.target_max_s_per_km;
  const delta = !isNum(p) || !isNum(lo) || !isNum(hi) ? 0 : status === "fast" ? Math.round(lo - p) : status === "slow" ? Math.round(p - hi) : 0;
  return (
    <Badge tone={STATUS[status].tone} dot>
      {status === "on" ? "On target" : `${delta}s ${status === "fast" ? "fast" : "slow"}`}
    </Badge>
  );
}
