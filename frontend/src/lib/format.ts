const DASH = "–";

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function pace(secPerKm: number | null | undefined, unit = true): string {
  if (!isNum(secPerKm) || secPerKm <= 0) return DASH;
  let m = Math.floor(secPerKm / 60);
  let s = Math.round(secPerKm % 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${String(s).padStart(2, "0")}${unit ? " /km" : ""}`;
}

export function duration(sec: number | null | undefined): string {
  if (!isNum(sec)) return DASH;
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function km(meters: number | null | undefined, digits = 1): string {
  return isNum(meters) ? (meters / 1000).toFixed(digits) : DASH;
}

export function num(v: number | null | undefined, digits = 0): string {
  return isNum(v) ? v.toFixed(digits) : DASH;
}

export function euro(v: number | null | undefined): string {
  return isNum(v) ? new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(v) : DASH;
}

/** Date-only strings ("2026-09-14") are parsed as local midnight, not UTC,
 *  so they don't shift to the previous day west of Greenwich. */
export function toDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

export const fmtDate = (value: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) =>
  toDate(value).toLocaleDateString(undefined, opts);

export const shortDate = (value: string) => fmtDate(value, { day: "numeric", month: "short" });

export const dateTime = (value: string) =>
  toDate(value).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function relativeTime(value: string): string {
  // sync_state stores "YYYY-MM-DD HH:MM:SS" in UTC without a zone marker.
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
