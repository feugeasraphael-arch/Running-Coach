import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { decodePolyline, type LatLng } from "@/lib/polyline";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/cn";

// CARTO's basemaps, rendered from OpenStreetMap data. Two reasons over raw
// OSM tiles: a muted palette that doesn't fight the route line, and a dark
// variant that matches the app's dark theme. Attribution for both is
// required, and set on the layer below.
const TILES = {
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Leaflet writes colors into SVG presentation attributes, which don't
 *  resolve `var(--token)` -- so read the theme's computed value instead of
 *  passing the custom property through. */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * The run's actual route on a real basemap.
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
  const host = useRef<HTMLDivElement>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const { theme } = useTheme();
  const dark = theme === "dark";

  const track = useMemo<LatLng[]>(
    () => (points?.length ? points : polyline ? decodePolyline(polyline) : []),
    [points, polyline],
  );
  const coarse = !points?.length && track.length > 0;

  useEffect(() => {
    if (!host.current || track.length < 2) return;

    const map = L.map(host.current, {
      zoomControl: true,
      scrollWheelZoom: false, // don't hijack the page scroll on the way past
    });

    tiles.current = L.tileLayer(dark ? TILES.dark : TILES.light, {
      attribution: ATTRIBUTION,
      maxZoom: 19,
      detectRetina: true,
    }).addTo(map);

    const line = L.polyline(track, {
      color: token("--accent", "#3b6cf6"),
      weight: 4,
      opacity: 0.95,
      lineJoin: "round",
      lineCap: "round",
    }).addTo(map);

    const endpoint = (at: LatLng, color: string, label: string) =>
      L.circleMarker(at, { radius: 5, color, fillColor: color, fillOpacity: 1, weight: 2 })
        .bindTooltip(label)
        .addTo(map);
    endpoint(track[0], token("--good", "#0f9f6e"), "Start");
    endpoint(track[track.length - 1], token("--bad", "#e0445a"), "Finish");

    map.fitBounds(line.getBounds(), { padding: [24, 24] });

    return () => {
      map.remove();
      tiles.current = null;
    };
    // `dark` is deliberately not a dependency: a theme flip swaps the tile
    // URL in the effect below rather than tearing the whole map down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  useEffect(() => {
    tiles.current?.setUrl(dark ? TILES.dark : TILES.light);
  }, [dark]);

  if (track.length < 2) return null;

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
