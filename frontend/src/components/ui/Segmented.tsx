import { useId } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { glide } from "@/lib/motion";

export function Segmented<K extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly { key: K; label: string; title?: string }[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  className?: string;
}) {
  // layoutId is global to the page, so each control needs its own or two
  // range pickers on the dashboard would pass one thumb back and forth.
  const thumbId = useId();
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-lg bg-surface-2 p-0.5", className)}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.key)}
            className={cn(
              "relative h-6 rounded-md px-2 text-[11px] font-medium transition-colors",
              active ? "text-accent" : "text-muted hover:text-fg",
            )}
          >
            {active && <motion.span layoutId={thumbId} transition={glide} className="absolute inset-0 rounded-md bg-accent/18" />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
