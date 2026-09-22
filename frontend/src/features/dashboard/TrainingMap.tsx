import { Map as MapIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryState } from "@/components/ui/QueryState";
import { RoutesMap } from "@/components/maps/RouteMap";
import { decodePolyline, simplify, type LatLng } from "@/lib/polyline";
import { useActivities } from "@/lib/queries";
import { fmtDate } from "@/lib/format";

const RUNS = 40;

/**
 * Every recent route on one basemap: the ground you actually cover, rather
 * than one run at a time. It's a single map with many lines on it, not one
 * map per run, so the dashboard pays for Leaflet once.
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
            // Newest first: RoutesMap highlights index 0 and draws it on top.
            const tracks: LatLng[][] = d.items
              .filter((a) => a.summary_polyline)
              .map((a) => simplify(decodePolyline(a.summary_polyline as string), 220));
            const newest = d.items.find((a) => a.summary_polyline);
            return (
              <>
                <RoutesMap tracks={tracks} className="h-72" />
                <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span>
                    {tracks.length} of {d.items.length} recent activities have GPS
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
