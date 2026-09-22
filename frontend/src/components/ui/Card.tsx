import type { HTMLAttributes, ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/cn";
import { enter } from "@/lib/motion";

/** A panel. It rises into place the first time it scrolls into view, so a
 *  long page (dashboard, activity detail, plan) settles in as it is read
 *  rather than all at once. `data-reveal` lets print CSS force it visible. */
export function Card({ className, ...props }: HTMLMotionProps<"section">) {
  return (
    <motion.section
      data-reveal
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -40px 0px" }}
      transition={enter}
      className={cn("rounded-2xl bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 px-3.5 pt-3", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-muted [&_svg]:size-3.5">{icon}</span>}
        <div className="min-w-0">
          <h2 className="label-mono truncate text-muted">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-3.5 pb-3.5 pt-2.5", className)} {...props} />;
}
