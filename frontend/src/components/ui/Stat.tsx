import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Stat({ label, value, unit, hint, className, size = "md" }: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="label-mono truncate text-subtle">{label}</div>
      <div
        className={cn(
          "readout mt-0.5 flex items-baseline gap-1 font-bold",
          size === "lg" ? "text-[32px] leading-none" : size === "md" ? "text-xl" : "text-base",
        )}
      >
        {value}
        {unit && <span className="text-xs font-medium text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 truncate text-xs text-subtle">{hint}</div>}
    </div>
  );
}
