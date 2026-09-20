import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useEffortCalendar } from "@/lib/queries";
import { fmtDate, isoDay, km, LOCALE, pace } from "@/lib/format";
import type { EffortDay } from "@/lib/types";
import { HEAT_LEVELS, heatColor } from "@/lib/scales";

const WEEKS = 53;
const SHIFT = 26;
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

function mondayOf(d: Date) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function EffortHeatmap() {
  const q = useEffortCalendar();
  const navigate = useNavigate();
  const [offsetWeeks, setOffsetWeeks] = useState(0);
  const [hover, setHover] = useState<{ date: string; entry?: EffortDay; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const byDate = useMemo(() => new Map((q.data?.days ?? []).map((d) => [d.date, d])), [q.data]);

  const today = new Date();
  const todayIso = isoDay(today);
  const start = addDays(mondayOf(today), -(WEEKS - 1 - offsetWeeks) * 7);
  const end = addDays(start, WEEKS * 7 - 1);
  const earliest = q.data?.earliest_date;

  const weeks = useMemo(() => {
    const cols: { date: Date; iso: string }[][] = [];
    for (let w = 0; w < WEEKS; w++) {
      cols.push(Array.from({ length: 7 }, (_, i) => {
        const date = addDays(start, w * 7 + i);
        return { date, iso: isoDay(date) };
      }));
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start.getTime()]);

  const inWindow = (q.data?.days ?? []).filter((d) => d.date >= isoDay(start) && d.date <= isoDay(end));
  const activeDays = inWindow.length;
  const hardDays = inWindow.filter((d) => d.level >= 4).length;

  const range = `${start.toLocaleDateString(LOCALE, { month: "short", year: "numeric" })} – ${end.toLocaleDateString(LOCALE, { month: "short", year: "numeric" })}`;

  return (
    <Card>
      <CardHeader
        title="Training consistency"
        subtitle={q.data ? `${activeDays} active days · ${hardDays} hard sessions · ${range}` : range}
        icon={<Flame />}
        actions={
          <>
            <Button size="icon" variant="ghost" aria-label="Earlier" disabled={!!earliest && isoDay(start) <= earliest} onClick={() => setOffsetWeeks((o) => o - SHIFT)}>
              <ChevronLeft />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Later" disabled={offsetWeeks >= 0} onClick={() => setOffsetWeeks((o) => Math.min(0, o + SHIFT))}>
              <ChevronRight />
            </Button>
          </>
        }
      />
      <CardBody>
        {q.isPending ? (
          <Skeleton className="h-[122px] w-full" />
        ) : !q.data || q.data.days.length === 0 ? (
          <EmptyState compact title="No activities synced yet" />
        ) : (
          <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
              <div className="grid shrink-0 grid-rows-[14px_repeat(7,minmax(0,1fr))] gap-[3px] pr-1 text-[10px] leading-none text-subtle">
                <span />
                {DAY_LABELS.map((l, i) => (
                  <span key={i} className="flex items-center">{l}</span>
                ))}
              </div>
              <div className="grid flex-1 grid-flow-col gap-[3px]" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(13px, 1fr))` }}>
                {weeks.map((col, w) => {
                  const first = col[0].date;
                  const prev = w > 0 ? weeks[w - 1][0].date : null;
                  const showMonth = !prev || prev.getMonth() !== first.getMonth();
                  return (
                    <div key={col[0].iso} className="grid grid-rows-[14px_repeat(7,minmax(0,1fr))] gap-[3px]">
                      <span className="relative text-[10px] leading-none text-subtle">
                        {showMonth && <span className="absolute left-0 whitespace-nowrap">{first.toLocaleDateString(LOCALE, { month: "short" })}</span>}
                      </span>
                      {col.map(({ iso }) => {
                        if (iso > todayIso) return <span key={iso} className="aspect-square rounded-[3px]" />;
                        const entry = byDate.get(iso);
                        const level = entry?.level ?? 0;
                        const show = (el: HTMLElement) => {
                          const r = el.getBoundingClientRect();
                          const p = wrapRef.current!.getBoundingClientRect();
                          setHover({ date: iso, entry, x: r.left - p.left + r.width / 2, y: r.top - p.top });
                        };
                        return entry ? (
                          <button
                            key={iso}
                            type="button"
                            aria-label={`${fmtDate(iso)}: ${entry.level_label} effort, ${entry.activity.name ?? "run"}`}
                            className="aspect-square rounded-[3px] ring-fg/40 transition-shadow hover:ring-2"
                            style={{ background: heatColor(level) }}
                            onMouseEnter={(e) => show(e.currentTarget)}
                            onFocus={(e) => show(e.currentTarget)}
                            onBlur={() => setHover(null)}
                            onClick={() => navigate(`/activities/${encodeURIComponent(entry.activity.id)}`)}
                          />
                        ) : (
                          <span
                            key={iso}
                            className="aspect-square rounded-[3px]"
                            style={{ background: heatColor(0) }}
                            onMouseEnter={(e) => show(e.currentTarget)}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-subtle">
              Easier
              {HEAT_LEVELS.map((l) => (
                <span key={l} className="size-[11px] rounded-[3px]" style={{ background: heatColor(l) }} />
              ))}
              Harder
            </div>

            {hover && (
              <div
                role="tooltip"
                className="pointer-events-none absolute z-20 w-max max-w-60 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-xl"
                style={{ left: Math.max(90, Math.min(hover.x, (wrapRef.current?.clientWidth ?? 0) - 90)), top: hover.y - 6 }}
              >
                <div className="text-muted">{fmtDate(hover.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</div>
                {hover.entry ? (
                  <>
                    <div className="mt-0.5 font-medium">{hover.entry.activity.name ?? "Run"}</div>
                    <div className="tnum mt-1 flex gap-3 text-muted">
                      <span>{km(hover.entry.activity.distance_m)} km</span>
                      <span>{pace(hover.entry.activity.avg_pace_s_per_km)}</span>
                      {hover.entry.activity.avg_hr != null && <span>{Math.round(hover.entry.activity.avg_hr)} bpm</span>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: heatColor(hover.entry.level) }} />
                      {hover.entry.level_label} effort
                      {hover.entry.count > 1 && <span className="text-subtle">· +{hover.entry.count - 1} more</span>}
                    </div>
                  </>
                ) : (
                  <div className="mt-0.5 text-subtle">Rest day</div>
                )}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
