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
