import type { Tone } from "@/components/ui/Badge";
import type { AcwrFlag, Recovery } from "@/lib/types";

// Band edges mirror the thresholds in coach.compute_acwr.
export const ACWR_BANDS = [
  { flag: "undertrained", from: 0, to: 0.8, tone: "info" as Tone, label: "Undertrained" },
  { flag: "sweet_spot", from: 0.8, to: 1.3, tone: "good" as Tone, label: "Sweet spot" },
  { flag: "caution", from: 1.3, to: 1.5, tone: "warn" as Tone, label: "Caution" },
  { flag: "high_injury_risk", from: 1.5, to: 2, tone: "bad" as Tone, label: "High injury risk" },
];

export const ACWR_HEADLINE: Record<AcwrFlag, { tone: Tone; headline: string }> = {
  no_data: { tone: "neutral", headline: "Not enough data yet" },
  undertrained: { tone: "info", headline: "Room to build back up" },
  sweet_spot: { tone: "good", headline: "You're on track" },
  caution: { tone: "warn", headline: "Load is elevated" },
  high_injury_risk: { tone: "bad", headline: "Back off this week" },
};

export const RECOVERY: Record<Recovery["status"], { tone: Tone; label: string; detail: string }> = {
  no_data: { tone: "neutral", label: "No data", detail: "No Garmin wellness data yet" },
  well_recovered: { tone: "good", label: "Well recovered", detail: "Signals up vs. your prior 7 days" },
  normal: { tone: "info", label: "Normal", detail: "In line with your prior 7 days" },
  fatigued: { tone: "warn", label: "Fatigued", detail: "Signals down vs. your prior 7 days" },
};

// Rough general-population running bands (not personalized by age/sex).
export function vo2Band(v: number): { tone: Tone; label: string } {
  if (v < 35) return { tone: "bad", label: "Below average" };
  if (v < 42) return { tone: "warn", label: "Fair" };
  if (v < 48) return { tone: "info", label: "Good" };
  if (v < 55) return { tone: "good", label: "Very good" };
  return { tone: "accent", label: "Excellent" };
}

export const WORKOUT_LABEL: Record<string, string> = {
  easy: "Easy run",
  long: "Long run",
  interval: "Intervals",
  benchmark: "Benchmark test",
};
