/** The domain colour scales, as literal token names.
 *
 * These names used to be built at runtime -- `var(--heat-${level})`,
 * `var(--zone-${zone})`, `var(--${tone})` -- which put them outside anything
 * TypeScript can see. Renaming or dropping a token produced an invalid var()
 * that painted nothing, with no build error, no type error and no console
 * warning; the heatmap simply went blank. Spelling every name out here is what
 * turns that into a compile error.
 *
 * Step counts are a backend contract, not a design choice: effort.py returns
 * levels 1-5 and the client adds 0 for a rest day, and HR zones come from the
 * API as 1-5. Neither can be resized from the frontend alone.
 */
import type { Tone } from "@/components/ui/Badge";

/** Rest day (0) through Max effort (5). A future day renders no cell at all --
 *  see EffortHeatmap -- so the grid shows seven states, not six. */
export const HEAT = [
  "var(--heat-0)",
  "var(--heat-1)",
  "var(--heat-2)",
  "var(--heat-3)",
  "var(--heat-4)",
  "var(--heat-5)",
] as const;

export const HEAT_LEVELS = [0, 1, 2, 3, 4, 5] as const;

export function heatColor(level: number): string {
  return HEAT[Math.min(Math.max(level, 0), HEAT.length - 1)];
}

/** Z1-Z5, in the Garmin/Strava convention (grey, blue, green, orange, red).
 *  Zone 0 means "no zone recorded", not "easy". */
export const ZONE = [
  "var(--zone-1)",
  "var(--zone-2)",
  "var(--zone-3)",
  "var(--zone-4)",
  "var(--zone-5)",
] as const;

export function zoneColor(zone: number): string {
  return zone ? ZONE[Math.min(zone, ZONE.length) - 1] : "var(--surface-2)";
}

/** A Badge tone as a raw colour, for the places that need one (a bar fill, an
 *  SVG stroke) rather than a Tailwind utility. `neutral` has no colour token of
 *  its own and borrows --subtle. */
export const TONE: Record<Tone, string> = {
  neutral: "var(--subtle)",
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  info: "var(--info)",
  accent: "var(--accent)",
};

export function toneColor(tone: Tone): string {
  return TONE[tone];
}
