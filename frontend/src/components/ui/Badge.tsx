import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";

const tones: Record<Tone, string> = {
  neutral: "border-line bg-surface-2 text-muted",
  good: "border-good/35 bg-good/12 text-good",
  warn: "border-warn/35 bg-warn/14 text-warn",
  bad: "border-bad/35 bg-bad/12 text-bad",
  info: "border-info/35 bg-info/12 text-info",
  accent: "border-accent/40 bg-accent-soft text-accent",
};

export function Badge({ tone = "neutral", dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn("label-mono inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 whitespace-nowrap", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const toneText: Record<Tone, string> = {
  neutral: "text-muted",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-info",
  accent: "text-accent",
};
