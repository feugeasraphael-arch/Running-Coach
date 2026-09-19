// Shared time-range options for trend charts. `weeks` feeds the weekly
// aggregates (mileage, pace), `days` the daily wellness series.
export const RANGES = [
  { key: "1m", label: "1M", title: "1 month", days: 30, weeks: 5 },
  { key: "3m", label: "3M", title: "3 months", days: 90, weeks: 13 },
  { key: "6m", label: "6M", title: "6 months", days: 182, weeks: 26 },
  { key: "1y", label: "1Y", title: "1 year", days: 365, weeks: 52 },
  { key: "all", label: "All", title: "All time", days: 3650, weeks: 520 },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

export const rangeOf = (key: RangeKey) => RANGES.find((r) => r.key === key) ?? RANGES[1];
