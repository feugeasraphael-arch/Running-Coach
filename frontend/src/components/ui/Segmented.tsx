import { cn } from "@/lib/cn";

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
              "h-6 rounded-md px-2 text-[11px] font-medium transition-colors",
              active ? "bg-accent/18 text-accent" : "text-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
