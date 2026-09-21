import { useMemo } from "react";
import { decodePolyline, routesToPaths, simplify, type LatLng } from "@/lib/polyline";
import { cn } from "@/lib/cn";

const VIEW = { width: 64, height: 44 };

/** One route as a bare SVG shape -- no basemap, no tiles, no network. Cheap
 *  enough to put in every row of a list. Renders nothing when the activity
 *  has no GPS (treadmill, manual entry), so callers can fall back. */
export function RouteShape({
  polyline,
  points,
  className,
  strokeWidth = 2,
}: {
  polyline?: string | null;
  points?: LatLng[];
  className?: string;
  strokeWidth?: number;
}) {
  const path = useMemo(() => {
    const pts = points ?? (polyline ? decodePolyline(polyline) : []);
    if (pts.length < 2) return "";
    return routesToPaths([simplify(pts, 160)], { ...VIEW, padding: strokeWidth })[0];
  }, [polyline, points, strokeWidth]);

  if (!path) return null;

  return (
    <svg
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      className={cn("text-accent", className)}
      aria-hidden
      role="presentation"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface Trail {
  id: string;
  polyline: string;
}

/**
 * Several routes projected into one shared frame, so their real relative
 * positions show -- repeated loops pile up into a dense core, one-off
 * excursions trail away from it. The newest route is drawn last and
 * highlighted, the rest recede.
 */
export function RouteTrails({
  routes,
  className,
  width = 480,
  height = 260,
}: {
  routes: Trail[];
  className?: string;
  width?: number;
  height?: number;
}) {
  const paths = useMemo(() => {
    const decoded = routes.map((r) => simplify(decodePolyline(r.polyline), 220));
    return routesToPaths(decoded, { width, height, padding: 8 });
  }, [routes, width, height]);

  if (paths.every((p) => !p)) return null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("w-full", className)}
      aria-label={`Map of ${routes.length} recent routes`}
      role="img"
    >
      {/* Oldest first: SVG paints in document order, so the newest run ends
          up on top of the pile rather than buried under it. */}
      {[...paths.keys()].reverse().map((i) =>
        paths[i] ? (
          <path
            key={routes[i].id}
            d={paths[i]}
            fill="none"
            // The newest run gets the accent; older ones fade back, so the
            // shape of the habit reads before any single run does.
            stroke={i === 0 ? "var(--accent)" : "var(--muted)"}
            strokeOpacity={i === 0 ? 1 : 0.5}
            strokeWidth={i === 0 ? 2.5 : 1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null,
      )}
    </svg>
  );
}
