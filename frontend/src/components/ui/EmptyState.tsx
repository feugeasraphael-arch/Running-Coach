import type { ReactNode } from "react";
import { CircleDashed, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

export function EmptyState({
  title,
  hint,
  icon,
  error,
  className,
  compact,
}: {
  title: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  error?: boolean;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-1.5 py-6" : "gap-2 py-12",
        className,
      )}
    >
      <span className={cn("grid size-9 place-items-center rounded-full bg-surface-2 [&_svg]:size-4", error ? "text-bad" : "text-subtle")}>
        {icon ?? (error ? <TriangleAlert /> : <CircleDashed />)}
      </span>
      <p className="text-[13px] font-medium">{title}</p>
      {hint && <p className="max-w-xs text-xs text-muted">{hint}</p>}
    </div>
  );
}
