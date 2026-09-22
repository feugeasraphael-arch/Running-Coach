import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { decodePolyline, type LatLng } from "@/lib/polyline";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/cn";

// Esri's grey canvas basemaps: no API key, a muted palette that doesn't
// fight the route line, and a dark variant matching the app's dark theme.
// (CARTO's equivalents now stamp "API KEY REQUIRED" across every tile.)
//
// Note the {z}/{y}/{x} order -- Esri puts row before column, unlike the
// {z}/{x}/{y} most tile servers use.
//
// To swap providers, replace these two constants and nothing else:
//   Satellite  https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
//   Plain OSM  https://tile.openstreetmap.org/{z}/{x}/{y}.png   (light only)
const TILES = {
  light: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  dark: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
};
const ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Leaflet writes colors into SVG presentation attributes, which don't
 *  resolve `var(--token)` -- so read the theme's computed value instead of
 *  passing the custom property through. */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Builds a Leaflet map over `tracks` and fits it to them, then hands the map
 * to `decorate` for markers and anything else the caller wants on top.
 *
 * The map is rebuilt when the tracks change and the tiles are swapped in
 * place when the theme flips -- a theme change shouldn't tear down the map
 * and lose the viewer's pan and zoom.
 */
function useRouteMap(
  tracks: LatLng[][],
  options: { color: (i: number) => string; weight: (i: number) => number; opacity: (i: number) => number },
  decorate?: (map: L.Map, tracks: LatLng[][]) => void,
) {
  const host = useRef<HTMLDivElement>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const { theme } = useTheme();
  const dark = theme === "dark";
  // Only the initial tile choice belongs to map construction; later flips go
  // through the effect below, so `dark` must not re-run the builder.
  const initialDark = useRef(dark);
  initialDark.current = dark;

  const drawable = tracks.filter((t) => t.length >= 2);

  useEffect(() => {
    if (!host.current || drawable.length === 0) return;

    const map = L.map(host.current, {
      zoomControl: true,
      scrollWheelZoom: false, // don't hijack the page scroll on the way past
    });
    tiles.current = L.tileLayer(initialDark.current ? TILES.dark : TILES.light, {
      attribution: ATTRIBUTION,
      maxZoom: 19,
      maxNativeZoom: 16, // past this Esri has no tiles; upscale rather than 404
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    // Drawn last to first, so the highlighted newest route sits on top of
    // the older ones rather than under them.
    for (let i = drawable.length - 1; i >= 0; i--) {
      const line = L.polyline(drawable[i], {
        color: options.color(i),
        weight: options.weight(i),
        opacity: options.opacity(i),
        lineJoin: "round",
        lineCap: "round",
      }).addTo(map);
      bounds.extend(line.getBounds());
    }
    map.fitBounds(bounds, { padding: [24, 24] });

    decorate?.(map, drawable);

    return () => {
      map.remove();
      tiles.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawable.length, drawable[0]?.[0]?.[0], drawable[0]?.[0]?.[1]]);

  useEffect(() => {
    tiles.current?.setUrl(dark ? TILES.dark : TILES.light);
  }, [dark]);

  return { host, empty: drawable.length === 0 };
}

/**
 * One run's route on a real basemap.
 *
 * Prefers the full-resolution `latlng` stream; falls back to the stored
 * summary polyline when the live Strava fetch didn't come back. The fallback
 * still draws a recognisable route, just coarser -- and trimmed by any Strava
 * privacy zone, which the stream is not.
 */
export function RouteMap({
  points,
  polyline,
  className,
}: {
  points?: LatLng[];
  polyline?: string | null;
  className?: string;
}) {
  const track = useMemo<LatLng[]>(
    () => (points?.length ? points : polyline ? decodePolyline(polyline) : []),
    [points, polyline],
  );
  const coarse = !points?.length && track.length > 0;

  const { host, empty } = useRouteMap(
    [track],
    { color: () => token("--accent", "#e9a13b"), weight: () => 4, opacity: () => 0.95 },
    (map, tracks) => {
      const t = tracks[0];
      const endpoint = (at: LatLng, color: string, label: string) =>
        L.circleMarker(at, { radius: 5, color, fillColor: color, fillOpacity: 1, weight: 2 })
          .bindTooltip(label)
          .addTo(map);
      endpoint(t[0], token("--good", "#56c08d"), "Start");
      endpoint(t[t.length - 1], token("--bad", "#e2564a"), "Finish");
    },
  );

  if (empty) return null;

  return (
    <div className={cn("relative", className)}>
      <div ref={host} className="size-full rounded-xl" />
      {coarse && (
        <p className="absolute top-2 right-2 z-[400] rounded-md bg-surface/90 px-2 py-1 text-[11px] text-muted shadow-card">
          Approximate route
        </p>
      )}
    </div>
  );
}

/**
 * Several routes on one basemap: the ground you actually cover, with the
 * streets and parks underneath rather than bare lines. The newest run is
 * highlighted; the rest recede into a trace of the habit.
 */
export function RoutesMap({ tracks, className }: { tracks: LatLng[][]; className?: string }) {
  const { host, empty } = useRouteMap(tracks, {
    color: (i) => (i === 0 ? token("--accent", "#e9a13b") : token("--muted", "#8b9691")),
    weight: (i) => (i === 0 ? 3.5 : 2),
    opacity: (i) => (i === 0 ? 1 : 0.55),
  });

  if (empty) return null;
  return <div ref={host} className={cn("rounded-xl", className)} />;
}
