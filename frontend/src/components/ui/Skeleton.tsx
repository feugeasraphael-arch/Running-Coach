import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={cn("animate-shimmer rounded-md bg-surface-2", className)} style={style} />;
}

const BARS = [48, 72, 60, 88, 54, 76, 92, 66, 80, 58, 70, 84];

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div className="flex items-end gap-2" style={{ height }} role="status" aria-label="Loading chart">
      {BARS.map((h, i) => (
        <Skeleton key={i} className="flex-1 rounded-b-none" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
