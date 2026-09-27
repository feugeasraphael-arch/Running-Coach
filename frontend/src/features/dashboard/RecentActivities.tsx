import { Link } from "react-router-dom";
import { ArrowRight, ListChecks } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { HrZoneBar } from "@/components/charts/HrZoneBar";
import { RouteShape } from "@/components/maps/RouteShape";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryState } from "@/components/ui/QueryState";
import { useActivities } from "@/lib/queries";
import { duration, fmtDate, km, pace } from "@/lib/format";

export function RecentActivities() {
  const q = useActivities({ limit: 6, offset: 0 });
  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Recent activities"
        icon={<ListChecks />}
        actions={
          <Link to="/activities" className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            View all <ArrowRight className="size-3.5" />
          </Link>
        }
      />
      <CardBody className="px-2 pb-2">
        <QueryState
          query={q}
          loading={<div className="space-y-2 px-3 pb-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-11" />)}</div>}
          isEmpty={(d) => d.items.length === 0}
          empty={<EmptyState compact title="No activities synced yet" />}
        >
          {(d) => (
            <ul>
              {d.items.map((a) => (
                <li key={a.id}>
                  <Link to={`/activities/${encodeURIComponent(a.id)}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2">
                    <div className="grid w-10 shrink-0 text-center leading-tight">
                      <span className="text-[10px] font-medium text-muted uppercase">{fmtDate(a.start_time, { month: "short" })}</span>
                      <span className="tnum text-base font-semibold">{fmtDate(a.start_time, { day: "numeric" })}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{a.name || a.sport_type || "Run"}</div>
                      <div className="tnum flex gap-3 text-xs text-muted">
                        <span>{km(a.distance_m, 2)} km</span>
                        <span>{duration(a.moving_time_s)}</span>
                        <span>{pace(a.avg_pace_s_per_km)}</span>
                      </div>
                      <HrZoneBar summary={a.hr_zones} zones={d.zones} className="mt-1" />
                    </div>
                    <RouteShape polyline={a.summary_polyline} className="h-9 w-12 shrink-0 opacity-70" strokeWidth={2.5} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}
