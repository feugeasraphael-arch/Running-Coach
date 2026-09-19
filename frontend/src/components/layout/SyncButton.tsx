import { useEffect, useState } from "react";
import { Check, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useSync, useSyncStatus } from "@/lib/queries";
import { capitalize, relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";

export function SyncButton() {
  const status = useSyncStatus();
  const sync = useSync();
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    if (!sync.isSuccess && !sync.isError) return;
    setShowResult(true);
    const t = setTimeout(() => setShowResult(false), 8000);
    return () => clearTimeout(t);
  }, [sync.isSuccess, sync.isError, sync.submittedAt]);

  const lastSynced = status.data?.sources
    .map((s) => s.last_synced_at)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);

  const results = sync.data ? Object.entries(sync.data) : [];
  const failed = sync.isError || results.some(([, r]) => !r.ok);

  return (
    <div className="flex items-center gap-3">
      {showResult && (sync.data || sync.isError) ? (
        <Tooltip
          side="bottom"
          content={
            sync.isError ? (
              <span>{String(sync.error)}</span>
            ) : (
              <ul className="space-y-1.5">
                {results.map(([source, r]) => (
                  <li key={source}>
                    <span className={cn("font-medium", r.ok ? "text-good" : "text-bad")}>{capitalize(source)}</span>
                    {r.message && <span className="block text-muted">{r.message}</span>}
                  </li>
                ))}
              </ul>
            )
          }
        >
          <span className={cn("hidden items-center gap-1.5 text-xs sm:flex", failed ? "text-bad" : "text-good")} tabIndex={0}>
            {failed ? <TriangleAlert className="size-3.5" /> : <Check className="size-3.5" />}
            {failed ? "Sync had errors" : "Synced"}
          </span>
        </Tooltip>
      ) : (
        lastSynced && <span className="hidden text-xs text-muted sm:inline">Updated {relativeTime(lastSynced)}</span>
      )}
      <Button variant="primary" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
        <RefreshCw className={cn(sync.isPending && "animate-spin")} />
        {sync.isPending ? "Syncing…" : "Sync"}
      </Button>
    </div>
  );
}
