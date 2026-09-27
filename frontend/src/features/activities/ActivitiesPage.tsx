import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { HrZoneBar } from "@/components/charts/HrZoneBar";
import { RouteShape } from "@/components/maps/RouteShape";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useActivities } from "@/lib/queries";
import { capitalize, duration, fmtDate, km, num, pace } from "@/lib/format";
import { cn } from "@/lib/cn";
import { enter } from "@/lib/motion";

const PAGE = 25;

export function ActivitiesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);

  // Debounce the search box into the URL (so results are linkable / survive refresh).
  useEffect(() => {
    const t = setTimeout(() => {
      if (draft !== q) setParams(draft ? { q: draft } : {}, { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [draft, q, setParams]);

  const query = useActivities({ limit: PAGE, offset: (page - 1) * PAGE, q: q || undefined });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const go = (p: number) => setParams({ ...(q ? { q } : {}), page: String(p) });

  return (
    <>
      <PageHeader title="Activities" subtitle={data ? `${data.total} activities` : undefined} />
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search className="size-4 text-subtle" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search by name…"
            aria-label="Search activities"
            className="h-8 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
          />
        </div>

        {query.isPending ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : query.isError ? (
          <EmptyState error title="Couldn't load activities" hint={String(query.error)} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title={q ? `No activities matching “${q}”` : "No activities synced yet"} />
        ) : (
          <div className={cn("overflow-x-auto transition-opacity", query.isPlaceholderData && "opacity-60")}>
            <table className="w-full text-left text-[13px]">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="hidden py-2.5 font-medium sm:table-cell"><span className="sr-only">Route</span></th>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 text-right font-medium">Distance</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Time</th>
                  <th className="px-4 py-2.5 text-right font-medium">Pace</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Avg HR</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">Elev.</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Source</th>
                </tr>
              </thead>
              <tbody className="readout">
                {data.items.map((a, i) => (
                  // Rows cascade in whenever a new page or search result arrives.
                  <motion.tr
                    key={a.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...enter, delay: Math.min(i, 16) * 0.018 }}
                    tabIndex={0}
                    onClick={() => navigate(`/activities/${encodeURIComponent(a.id)}`)}
                    onKeyDown={(e) => e.key === "Enter" && navigate(`/activities/${encodeURIComponent(a.id)}`)}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2 focus-visible:bg-surface-2"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{fmtDate(a.start_time, { weekday: "short", day: "numeric", month: "short", year: "2-digit" })}</td>
                    <td className="hidden w-16 py-2 sm:table-cell">
                      <RouteShape polyline={a.summary_polyline} className="h-8 w-14 opacity-80" strokeWidth={2.5} />
                    </td>
                    <td className="max-w-72 px-4 py-2.5">
                      <div className="truncate font-medium">{a.name || capitalize(a.sport_type ?? "Run")}</div>
                      <HrZoneBar summary={a.hr_zones} zones={data.zones} className="mt-1 max-w-56" />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{km(a.distance_m, 2)} km</td>
                    <td className="hidden px-4 py-3 text-right sm:table-cell">{duration(a.moving_time_s)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{pace(a.avg_pace_s_per_km)}</td>
                    <td className="hidden px-4 py-3 text-right md:table-cell">{num(a.avg_hr)}</td>
                    <td className="hidden px-4 py-3 text-right lg:table-cell">{a.elevation_gain_m != null ? `${Math.round(a.elevation_gain_m)} m` : "–"}</td>
                    <td className="hidden px-4 py-3 lg:table-cell"><Badge>{capitalize(a.source)}</Badge></td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > PAGE && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
            <span className="readout">
              {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, data.total)} of {data.total}
            </span>
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => go(page - 1)} disabled={page <= 1}><ChevronLeft /> Previous</Button>
              <Button size="sm" onClick={() => go(page + 1)} disabled={page >= pages}>Next <ChevronRight /></Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
