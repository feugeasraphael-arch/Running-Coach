import { useMemo } from "react";
import { CalendarCheck, CheckCircle2, CircleDashed, CircleDot, Lightbulb, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stat } from "@/components/ui/Stat";
import { usePlanStatus } from "@/lib/queries";
import { fmtDate, isoDay, toDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { PlanDay, PlanStatusKind } from "@/lib/types";
import { WORKOUT_LABEL } from "@/features/dashboard/tones";

const STATUS: Record<PlanStatusKind, { tone: Tone; label: string; icon: typeof CheckCircle2 }> = {
  completed: { tone: "good", label: "Completed", icon: CheckCircle2 },
  partial: { tone: "warn", label: "Partial", icon: CircleDot },
  missed: { tone: "bad", label: "Missed", icon: XCircle },
  upcoming: { tone: "neutral", label: "Upcoming", icon: CircleDashed },
};

const BAR = { completed: "bg-good", partial: "bg-warn", missed: "bg-bad" } as const;

const TYPE_TONE: Record<string, Tone> = { interval: "accent", long: "info", benchmark: "warn", easy: "good" };

function weekKey(date: string) {
  const d = toDate(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDay(d);
}

export function PlanPage() {
  const q = usePlanStatus();
  const data = q.data;

  const weeks = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, PlanDay[]>();
    for (const d of data.days) map.set(weekKey(d.date), [...(map.get(weekKey(d.date)) ?? []), d]);
    return [...map.entries()];
  }, [data]);

  const thisWeek = weekKey(isoDay(new Date()));
  // "Coming up" reads forward in time from this week; "History" reads backward.
  const upcoming = weeks.filter(([w]) => w >= thisWeek).sort(([a], [b]) => (a < b ? -1 : 1));
  const history = weeks.filter(([w]) => w < thisWeek).sort(([a], [b]) => (a < b ? 1 : -1));

  return (
    <>
      <PageHeader title="Training plan" subtitle="Planned sessions vs. what you actually ran" />
      {q.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-96" />
        </div>
      ) : q.isError ? (
        <EmptyState error title="Couldn't load the plan" hint={String(q.error)} />
      ) : !data ? (
        <EmptyState title="No training plan loaded" hint="Export the plan to plan_data.json, then press Sync." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:sticky lg:top-20 lg:order-2 lg:h-fit">
            <Card className="relative overflow-hidden">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/10 to-transparent to-60%" />
              <CardHeader title="Advice for your next session" icon={<Lightbulb />} className="relative" />
              <CardBody className="relative">
                <p className="text-[14px] leading-relaxed">{data.advice}</p>
                {data.next_workout && (
                  <div className="mt-4 rounded-xl bg-surface-2 p-3">
                    <div className="text-xs text-muted">{fmtDate(data.next_workout.date, { weekday: "long", day: "numeric", month: "long" })}</div>
                    <div className="mt-0.5 font-medium">{data.next_workout.title}</div>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Adherence" subtitle="Past sessions in this window" icon={<CalendarCheck />} />
              <CardBody>
                {data.adherence_rate == null ? (
                  <p className="text-xs text-muted">Not enough tracked sessions yet.</p>
                ) : (
                  <>
                    <Stat label="Completion rate" value={`${Math.round(data.adherence_rate * 100)}%`} size="lg" />
                    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-2">
                      {(["completed", "partial", "missed"] as const).map((k) => {
                        const total = data.completed + data.partial + data.missed;
                        return <div key={k} className={cn("h-full", BAR[k])} style={{ width: `${total ? (data[k] / total) * 100 : 0}%` }} />;
                      })}
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <Stat size="sm" label="Completed" value={data.completed} />
                      <Stat size="sm" label="Partial" value={data.partial} />
                      <Stat size="sm" label="Missed" value={data.missed} />
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4 lg:col-span-2">
            {upcoming.length > 0 && <SectionTitle>Coming up</SectionTitle>}
            {upcoming.map(([week, days]) => <WeekCard key={week} week={week} days={days} thisWeek={thisWeek} />)}
            {history.length > 0 && <SectionTitle>History</SectionTitle>}
            {history.map(([week, days]) => <WeekCard key={week} week={week} days={days} thisWeek={thisWeek} />)}
          </div>
        </div>
      )}
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 pt-2 text-xs font-semibold tracking-wide text-muted uppercase first:pt-0">{children}</h2>;
}

function weekSubtitle(days: PlanDay[]) {
  const planned = days.reduce((s, d) => s + (d.planned_distance_km ?? 0), 0);
  const past = days.filter((d) => d.status !== "upcoming");
  const done = days.filter((d) => d.status === "completed").length;
  const sessions = `${days.length} session${days.length === 1 ? "" : "s"}`;
  const progress = past.length ? `${done}/${past.length} completed` : sessions;
  return `${progress} · ${planned.toFixed(0)} km planned`;
}

function WeekCard({ week, days, thisWeek }: { week: string; days: PlanDay[]; thisWeek: string }) {
  return (
    <Card>
      <CardHeader
        title={week === thisWeek ? "This week" : `Week of ${fmtDate(week, { day: "numeric", month: "long" })}`}
        subtitle={weekSubtitle(days)}
      />
      <ul className="mt-3 divide-y divide-line border-t border-line">
        {[...days].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => {
          const st = STATUS[d.status] ?? STATUS.upcoming;
          const Icon = st.icon;
          const target = [d.planned_distance_km ? `${d.planned_distance_km} km` : null, d.pace_target, d.hr_target].filter(Boolean).join(" · ");
          return (
            <li key={d.date} className="flex gap-4 px-5 py-3.5">
              <div className="w-11 shrink-0 text-center leading-tight">
                <div className="text-[10px] font-medium text-muted uppercase">{fmtDate(d.date, { weekday: "short" })}</div>
                <div className="tnum text-lg font-semibold">{fmtDate(d.date, { day: "numeric" })}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.title}</span>
                  {d.workout_type && <Badge tone={TYPE_TONE[d.workout_type] ?? "neutral"}>{WORKOUT_LABEL[d.workout_type] ?? d.workout_type}</Badge>}
                </div>
                {target && <div className="tnum mt-0.5 text-xs text-muted">Target: {target}</div>}
                {d.notes && <div className="mt-1 text-xs text-subtle">{d.notes}</div>}
              </div>
              <div className="shrink-0 text-right">
                <Badge tone={st.tone}><Icon className="size-3" />{st.label}</Badge>
                {d.actual_distance_km != null && (
                  <div className="tnum mt-1 text-xs text-muted">
                    {d.actual_distance_km} km{d.actual_avg_hr != null && ` · ${Math.round(d.actual_avg_hr)} bpm`}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
