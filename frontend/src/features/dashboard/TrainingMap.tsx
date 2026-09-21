import { Map as MapIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryState } from "@/components/ui/QueryState";
import { RouteTrails, type Trail } from "@/components/maps/RouteShape";
import { useActivities } from "@/lib/queries";
import { fmtDate } from "@/lib/format";

const RUNS = 40;

/**
 * Every recent route drawn in one shared frame: the ground you actually
 * cover, rather than one run at a time. Deliberately tile-free -- it's a
 * shape-of-your-training card, and 40 embedded basemaps on the dashboard
 * would be slow and visually noisy.
 */
export function TrainingMap() {
  const q = useActivities({ limit: RUNS, offset: 0 });

  return (
    <Card>
      <CardHeader
        title="Training map"
        subtitle={`Your last ${RUNS} activities, newest highlighted`}
        icon={<MapIcon />}
      />
      <CardBody className="pt-2">
        <QueryState
          query={q}
          loading={<Skeleton className="h-64" />}
          isEmpty={(d) => d.items.every((a) => !a.summary_polyline)}
          empty={<EmptyState compact title="No mapped activities yet" hint="Runs recorded with GPS will show up here." />}
        >
          {(d) => {
            const trails: Trail[] = d.items
              .filter((a): a is typeof a & { summary_polyline: string } => Boolean(a.summary_polyline))
              .map((a) => ({ id: a.id, polyline: a.summary_polyline }));
            const newest = d.items.find((a) => a.summary_polyline);
            return (
              <>
                <RouteTrails routes={trails} className="h-64" />
                <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span>
                    {trails.length} of {d.items.length} recent activities have GPS
                  </span>
                  {newest && (
                    <Link
                      to={`/activities/${encodeURIComponent(newest.id)}`}
                      className="flex items-center gap-1.5 font-medium text-accent hover:underline"
                    >
                      <span className="inline-block h-0.5 w-4 rounded-full bg-accent" aria-hidden />
                      {fmtDate(newest.start_time, { day: "numeric", month: "short" })} · {newest.name ?? "Latest run"}
                    </Link>
                  )}
                </p>
              </>
            );
          }}
        </QueryState>
      </CardBody>
    </Card>
  );
}
