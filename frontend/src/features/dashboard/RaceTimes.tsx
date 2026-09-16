import { Trophy } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryState } from "@/components/ui/QueryState";
import { usePredictions } from "@/lib/queries";
import { duration, fmtDate, isNum, km, pace } from "@/lib/format";
import { cn } from "@/lib/cn";

export function RaceTimes() {
  const q = usePredictions();
  return (
    <Card className="flex flex-col">
      <CardHeader title="Race times" subtitle="Personal bests & Riegel predictions" icon={<Trophy />} />
      <CardBody className="flex flex-1 flex-col">
        <QueryState
          query={q}
          loading={<div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
          empty={<EmptyState compact title="Not enough runs to predict yet" />}
        >
          {(d) => (
            <>
              <ul className="divide-y divide-line">
                {d.predictions.map((p) => {
                  const beaten = isNum(p.real_time_s) && isNum(p.predicted_time_s) && p.predicted_time_s < p.real_time_s;
                  return (
                    <li key={p.label} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                      <div className="min-w-0">
                        <div className="font-medium">{p.label}</div>
                        <div className="truncate text-xs text-muted">
                          {isNum(p.real_time_s) ? <>PB {duration(p.real_time_s)}{p.real_date && ` · ${fmtDate(p.real_date, { month: "short", year: "numeric" })}`}</> : "Not raced yet"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={cn("tnum text-lg font-semibold tracking-tight", beaten && "text-good")}>
                          {duration(p.predicted_time_s)}
                        </div>
                        <div className="tnum text-xs text-muted">
                          {isNum(p.predicted_time_s) ? pace(p.predicted_time_s / (p.distance_m / 1000)) : "predicted"}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {d.reference && (
                <p className="mt-auto border-t border-line pt-3 text-xs leading-relaxed text-muted">
                  Based on <span className="text-fg">{d.reference.name ?? "a recent run"}</span>: {km(d.reference.distance_m, 2)} km in{" "}
                  {duration(d.reference.time_s)} on {fmtDate(d.reference.date, { day: "numeric", month: "short" })}. Green = predicted faster than your PB.
                </p>
              )}
            </>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}
