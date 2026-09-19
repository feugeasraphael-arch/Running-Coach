import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  good: "bg-good/12 text-good",
  warn: "bg-warn/14 text-warn",
  bad: "bg-bad/12 text-bad",
  info: "bg-info/12 text-info",
  accent: "bg-accent-soft text-accent",
};

export function Badge({ tone = "neutral", dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", tones[tone], className)}>
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
