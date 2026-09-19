import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart, Area } from "recharts";
import { BarChart3, Moon, TrendingUp } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueryState } from "@/components/ui/QueryState";
import { C, ChartTip, Legend, axisProps, gridProps } from "@/components/charts/chartKit";
import { usePaceTrend, useWeeklyMileage, useWellnessTrend } from "@/lib/queries";
import { RANGES, rangeOf, type RangeKey } from "@/lib/ranges";
import { isNum, num, pace, shortDate } from "@/lib/format";
import type { WellnessDay } from "@/lib/types";

const H = 240;

const dateTick = (v: string) => shortDate(v);

function RangeSelect({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  return <Segmented label="Time range" options={RANGES} value={value} onChange={onChange} />;
}

export function WeeklyMileageChart() {
  const [range, setRange] = useState<RangeKey>("3m");
  const q = useWeeklyMileage(rangeOf(range).weeks);
  return (
    <Card>
      <CardHeader title="Weekly distance" subtitle="Kilometres per week, Monday start" icon={<BarChart3 />} actions={<RangeSelect value={range} onChange={setRange} />} />
      <CardBody>
        <QueryState query={q} loading={<ChartSkeleton height={H} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No weekly mileage yet" />}>
          {(d) => {
            const total = d.reduce((s, w) => s + w.distance_km, 0);
            const runs = d.reduce((s, w) => s + w.num_runs, 0);
            return (
              <>
                <div className="tnum mb-3 flex gap-6 text-xs text-muted">
                  <span><span className="text-base font-semibold text-fg">{total.toFixed(0)}</span> km total</span>
                  <span><span className="text-base font-semibold text-fg">{runs}</span> runs</span>
                  <span><span className="text-base font-semibold text-fg">{(total / d.length).toFixed(1)}</span> km/week</span>
                </div>
                <div style={{ height: H }} className={q.isPlaceholderData ? "opacity-60 transition-opacity" : "transition-opacity"}>
                  <ResponsiveContainer>
                    <BarChart data={d} margin={{ top: 4, right: 0, bottom: 0, left: -18 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="week_start" {...axisProps} tickFormatter={dateTick} minTickGap={24} />
                      <YAxis {...axisProps} width={44} />
                      <Tooltip
                        cursor={{ fill: "var(--surface-2)" }}
                        content={({ active, payload }) =>
                          active && payload?.length ? (
                            <ChartTip
                              title={`Week of ${shortDate(payload[0].payload.week_start)}`}
                              rows={[
                                { label: "Distance", value: `${payload[0].payload.distance_km} km`, color: C.distance },
                                { label: "Runs", value: payload[0].payload.num_runs },
                              ]}
                            />
                          ) : null
                        }
                      />
                      <Bar dataKey="distance_km" fill={C.distance} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            );
          }}
        </QueryState>
      </CardBody>
    </Card>
  );
}

export function PaceHrChart() {
  const [range, setRange] = useState<RangeKey>("3m");
  const q = usePaceTrend(rangeOf(range).weeks);
  return (
    <Card>
      <CardHeader title="Pace & heart rate" subtitle="Weekly averages across runs" icon={<TrendingUp />} actions={<RangeSelect value={range} onChange={setRange} />} />
      <CardBody>
        <QueryState
          query={q}
          loading={<ChartSkeleton height={H} />}
          isEmpty={(d) => !d.some((w) => isNum(w.avg_pace_s_per_km))}
          empty={<EmptyState title="No runs with pace data in this range" />}
        >
          {(d) => (
            <>
              <Legend items={[{ label: "Pace (faster = higher)", color: C.distance }, { label: "Avg heart rate", color: C.hr }]} />
              <div style={{ height: H }} className="mt-3">
                <ResponsiveContainer>
                  <LineChart data={d} margin={{ top: 4, right: -8, bottom: 0, left: -8 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="week_start" {...axisProps} tickFormatter={dateTick} minTickGap={24} />
                    <YAxis yAxisId="pace" reversed {...axisProps} width={48} domain={["dataMin - 10", "dataMax + 10"]} tickFormatter={(v) => pace(v, false)} />
                    <YAxis yAxisId="hr" orientation="right" {...axisProps} width={40} domain={["dataMin - 5", "dataMax + 5"]} tickFormatter={(v) => Math.round(v).toString()} />
                    <Tooltip
                      content={({ active, payload }) =>
                        active && payload?.length ? (
                          <ChartTip
                            title={`Week of ${shortDate(payload[0].payload.week_start)}`}
                            rows={[
                              { label: "Pace", value: pace(payload[0].payload.avg_pace_s_per_km), color: C.distance },
                              { label: "Heart rate", value: `${num(payload[0].payload.avg_hr)} bpm`, color: C.hr },
                            ]}
                          />
                        ) : null
                      }
                    />
                    <Line yAxisId="pace" type="monotone" dataKey="avg_pace_s_per_km" stroke={C.distance} strokeWidth={2} dot={false} connectNulls />
                    <Line yAxisId="hr" type="monotone" dataKey="avg_hr" stroke={C.hr} strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}

type Metric = "sleep" | "battery" | "hr" | "vo2";
const METRICS: { key: Metric; label: string }[] = [
  { key: "sleep", label: "Sleep" },
  { key: "battery", label: "Body battery" },
  { key: "hr", label: "Heart rate" },
  { key: "vo2", label: "VO₂max" },
];

const has = (d: WellnessDay[], ...keys: (keyof WellnessDay)[]) => d.some((x) => keys.some((k) => isNum(x[k])));

export function WellnessChart() {
  const [range, setRange] = useState<RangeKey>("1m");
  const [metric, setMetric] = useState<Metric>("sleep");
  const q = useWellnessTrend(rangeOf(range).days);

  return (
    <Card>
      <CardHeader
        title="Wellness"
        subtitle="Daily Garmin readings"
        icon={<Moon />}
        actions={<RangeSelect value={range} onChange={setRange} />}
      />
      <CardBody>
        <Segmented label="Metric" options={METRICS} value={metric} onChange={setMetric} className="mb-4" />
        <QueryState query={q} loading={<ChartSkeleton height={H} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No Garmin wellness data in this range" />}>
          {(d) => <WellnessBody data={d} metric={metric} />}
        </QueryState>
      </CardBody>
    </Card>
  );
}

function avg(d: WellnessDay[], k: keyof WellnessDay) {
  const v = d.map((x) => x[k]).filter(isNum);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

function Summary({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="tnum mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label}>
          <span className="text-base font-semibold text-fg">{i.value}</span> {i.label}
        </span>
      ))}
    </div>
  );
}

function WellnessBody({ data, metric }: { data: WellnessDay[]; metric: Metric }) {
  const x = <XAxis dataKey="date" {...axisProps} tickFormatter={dateTick} minTickGap={32} />;
  const title = (p: WellnessDay) => shortDate(p.date);

  if (metric === "sleep") {
    if (!has(data, "sleep_hours")) return <EmptyState title="No sleep data in this range" />;
    const a = avg(data, "sleep_hours");
    return (
      <>
        <Summary items={[{ label: "h average", value: num(a, 1) }, { label: "nights", value: String(data.filter((d) => isNum(d.sleep_hours)).length) }]} />
        <div style={{ height: H }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -18 }}>
              <CartesianGrid {...gridProps} />
              {x}
              <YAxis {...axisProps} width={44} domain={[0, (max: number) => Math.max(10, Math.ceil(max))]} />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <ChartTip
                      title={title(payload[0].payload)}
                      rows={[
                        { label: "Sleep", value: `${num(payload[0].payload.sleep_hours, 1)} h`, color: C.sleep },
                        ...(isNum(payload[0].payload.sleep_score) ? [{ label: "Score", value: num(payload[0].payload.sleep_score) }] : []),
                      ]}
                    />
                  ) : null
                }
              />
              <Bar dataKey="sleep_hours" fill={C.sleep} radius={[3, 3, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </>
    );
  }

  if (metric === "battery") {
    if (!has(data, "body_battery_high")) return <EmptyState title="No body battery data in this range" />;
    const rows = data.map((d) => ({ ...d, band: isNum(d.body_battery_high) && isNum(d.body_battery_low) ? [d.body_battery_low, d.body_battery_high] : null }));
    return (
      <>
        <Summary items={[{ label: "avg daily high", value: num(avg(data, "body_battery_high")) }, { label: "avg stress", value: num(avg(data, "stress_avg")) }]} />
        <div style={{ height: H }}>
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: -18 }}>
              <CartesianGrid {...gridProps} />
              {x}
              <YAxis {...axisProps} width={44} domain={[0, 100]} />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <ChartTip
                      title={title(payload[0].payload)}
                      rows={[
                        { label: "High", value: num(payload[0].payload.body_battery_high), color: C.battery },
                        { label: "Low", value: num(payload[0].payload.body_battery_low) },
                        { label: "Stress", value: num(payload[0].payload.stress_avg), color: C.stress },
                      ]}
                    />
                  ) : null
                }
              />
              <Area type="monotone" dataKey="band" stroke="none" fill={C.battery} fillOpacity={0.18} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="body_battery_high" stroke={C.battery} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="stress_avg" stroke={C.stress} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3">
          <Legend items={[{ label: "Daily high (band = low→high)", color: C.battery }, { label: "Avg stress", color: C.stress, dashed: true }]} />
        </div>
      </>
    );
  }

  if (metric === "hr") {
    if (!has(data, "resting_hr", "avg_hr_day")) return <EmptyState title="No heart-rate data in this range" />;
    return (
      <>
        <Summary items={[{ label: "bpm avg resting", value: num(avg(data, "resting_hr")) }, { label: "bpm avg 24h", value: num(avg(data, "avg_hr_day")) }]} />
        <div style={{ height: H }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -18 }}>
              <CartesianGrid {...gridProps} />
              {x}
              <YAxis {...axisProps} width={44} domain={["dataMin - 3", "dataMax + 3"]} tickFormatter={(v) => Math.round(v).toString()} />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <ChartTip
                      title={title(payload[0].payload)}
                      rows={[
                        { label: "Resting", value: `${num(payload[0].payload.resting_hr)} bpm`, color: C.hr },
                        { label: "24h average", value: `${num(payload[0].payload.avg_hr_day)} bpm`, color: C.distance },
                      ]}
                    />
                  ) : null
                }
              />
              <Line type="monotone" dataKey="resting_hr" stroke={C.hr} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="avg_hr_day" stroke={C.distance} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3">
          <Legend items={[{ label: "Resting HR", color: C.hr }, { label: "24h average HR", color: C.distance }]} />
        </div>
      </>
    );
  }

  const points = data.filter((d) => isNum(d.vo2max));
  if (!points.length) return <EmptyState title="No VO₂max readings in this range" />;
  return (
    <>
      <Summary items={[{ label: "latest", value: num(points[points.length - 1].vo2max, 1) }, { label: "peak", value: num(Math.max(...points.map((p) => p.vo2max as number)), 1) }]} />
      <div style={{ height: H }}>
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: -18 }}>
            <CartesianGrid {...gridProps} />
            {x}
            <YAxis {...axisProps} width={44} domain={["dataMin - 1", "dataMax + 1"]} tickFormatter={(v) => Math.round(v).toString()} />
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <ChartTip title={title(payload[0].payload)} rows={[{ label: "VO₂max", value: num(payload[0].payload.vo2max, 1), color: C.sleep }]} />
                ) : null
              }
            />
            <Line type="stepAfter" dataKey="vo2max" stroke={C.sleep} strokeWidth={2} dot={points.length < 40 ? { r: 2.5, fill: C.sleep } : false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
