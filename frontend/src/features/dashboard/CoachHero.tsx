import { Link } from "react-router-dom";
import { ArrowRight, CalendarClock, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge, toneText } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCoachSummary, usePlanStatus } from "@/lib/queries";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ACWR_HEADLINE, WORKOUT_LABEL } from "./tones";

const glow: Record<string, string> = {
  neutral: "from-surface-2",
  good: "from-good/14",
  info: "from-info/14",
  warn: "from-warn/16",
  bad: "from-bad/14",
  accent: "from-accent/14",
};

export function CoachHero() {
  const summary = useCoachSummary();
  const plan = usePlanStatus();
  const next = plan.data?.next_workout;

  const zone = summary.data ? ACWR_HEADLINE[summary.data.acwr.flag] ?? ACWR_HEADLINE.no_data : ACWR_HEADLINE.no_data;

  return (
    <Card className="relative overflow-hidden">
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent to-60%", glow[zone.tone])} />
      <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
            <Sparkles className={cn("size-3.5", toneText[zone.tone])} />
            Coach
          </div>
          {summary.isPending ? (
            <div className="space-y-2.5">
              <Skeleton className="h-7 w-64" />
              <Skeleton className="h-4 w-full max-w-xl" />
            </div>
          ) : summary.data ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{zone.headline}</h1>
              <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">{summary.data.recommendation}</p>
              <Link to="/coach" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
                <Sparkles className="size-3.5" /> Demander au coach IA
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">No recommendation yet</h1>
              <p className="mt-2 text-muted">Sync some activities to get your first coaching update.</p>
            </>
          )}
        </div>

        {next && (
          <Link
            to="/plan"
            className="group flex min-w-64 items-center gap-4 rounded-xl border border-line bg-surface/70 p-4 backdrop-blur transition-colors hover:border-line-strong"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <CalendarClock className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-muted">
                Next session · {fmtDate(next.date, { weekday: "short", day: "numeric", month: "short" })}
              </div>
              <div className="truncate font-medium">{next.title}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {next.workout_type && <Badge tone="accent">{WORKOUT_LABEL[next.workout_type] ?? next.workout_type}</Badge>}
                {next.pace_target && <Badge>{next.pace_target}</Badge>}
              </div>
            </div>
            <ArrowRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
    </Card>
  );
}
