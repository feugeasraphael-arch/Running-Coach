// Route geometry helpers. Strava gives two forms of GPS for the same run:
// a reduced encoded polyline on every activity (cheap, already in our DB) and
// a full-resolution `latlng` stream on the detail endpoint. Both end up as
// LatLng[] here, so the SVG and Leaflet renderers don't care which they got.

/** [latitude, longitude], the order Strava and Leaflet both use. */
export type LatLng = [number, number];

/**
 * Decode a Google-algorithm encoded polyline (what Strava's
 * `map.summary_polyline` is, at precision 5).
 *
 * Tolerant by design: a truncated or malformed string yields the points it
 * could read rather than throwing, since a broken thumbnail shouldn't take
 * a page down with it.
 */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const nextDelta = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    // Low bit is the sign flag; the rest is the value, zig-zag encoded.
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    const dLat = nextDelta();
    const dLng = nextDelta();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    points.push([lat / factor, lng / factor]);
  }
  return points;
}

export interface Box {
  width: number;
  height: number;
  padding?: number;
}

/**
 * Project one or more routes into a shared SVG viewBox.
 *
 * Equirectangular with a cos(latitude) correction on longitude: over a single
 * run (a few km) that's visually indistinguishable from a proper projection,
 * and it keeps the route's true proportions instead of stretching it
 * east-west. All routes share one bounding box, so several drawn together
 * stay in correct relative position.
 *
 * Returns one SVG path string per input route ("" for routes with no points).
 */
export function routesToPaths(routes: LatLng[][], { width, height, padding = 2 }: Box): string[] {
  const all = routes.flat();
  if (all.length === 0) return routes.map(() => "");

  const lats = all.map((p) => p[0]);
  const lngs = all.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);

  // Screen space: x east, y south (SVG's y grows downward, latitude doesn't).
  const xs = lngs.map((v) => v * kx);
  const ys = lats.map((v) => -v);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const innerW = Math.max(width - padding * 2, 1);
  const innerH = Math.max(height - padding * 2, 1);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  // A stationary GPS blob has zero span in one or both axes -- fall back to a
  // scale that keeps it a dot in the middle instead of dividing by zero.
  const scale = Math.min(spanX > 0 ? innerW / spanX : Infinity, spanY > 0 ? innerH / spanY : Infinity);
  const k = Number.isFinite(scale) ? scale : 1;
  const offsetX = padding + (innerW - spanX * k) / 2;
  const offsetY = padding + (innerH - spanY * k) / 2;

  const round = (n: number) => Math.round(n * 100) / 100;
  return routes.map((route) => {
    if (route.length === 0) return "";
    return route
      .map(([lat, lng], i) => {
        const x = round((lng * kx - minX) * k + offsetX);
        const y = round((-lat - minY) * k + offsetY);
        return `${i === 0 ? "M" : "L"}${x} ${y}`;
      })
      .join(" ");
  });
}

/** Drop points that project to nearly the same spot, so a 1 Hz GPS stream
 *  doesn't become a 3,000-segment path for a 60-pixel thumbnail. */
export function simplify(points: LatLng[], maxPoints = 240): LatLng[] {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const out: LatLng[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(points[Math.floor(i * step)]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
