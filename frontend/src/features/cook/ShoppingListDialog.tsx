import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useShoppingList } from "@/lib/queries";
import { euro } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ShoppingList } from "@/lib/types";

const asText = (d: ShoppingList) =>
  [
    `Shopping list — next ${d.days} days (~${euro(d.total_estimated_cost_eur)})`,
    "",
    ...d.categories.flatMap((c) => [c.category.toUpperCase(), ...c.items.map((i) => `- ${i.item}: ${i.quantity}`), ""]),
  ].join("\n").trim();

export function ShoppingListDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useShoppingList(open);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  const copy = async () => {
    if (!q.data) return;
    try {
      await navigator.clipboard.writeText(asText(q.data));
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied(null), 1600);
  };

  const toggle = (key: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Shopping list"
      description={q.data ? `Next ${q.data.days} days · ${q.data.distinct_recipes} recipes · ~${euro(q.data.total_estimated_cost_eur)}` : undefined}
      actions={
        q.data && (
          <Button size="sm" onClick={copy}>
            {copied === "ok" ? <Check /> : <Copy />}
            {copied === "ok" ? "Copied" : copied === "fail" ? "Couldn't copy" : "Copy"}
          </Button>
        )
      }
    >
      {q.isPending ? (
        <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : !q.data ? (
        <EmptyState title="No shopping list available yet" />
      ) : (
        <div className="columns-1 gap-8 sm:columns-2">
          {q.data.categories.map((c) => (
            <section key={c.category} className="mb-5 break-inside-avoid">
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{c.category}</h3>
              <ul>
                {c.items.map((i) => {
                  const key = `${c.category}|${i.item}`;
                  const done = checked.has(key);
                  return (
                    <li key={key}>
                      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg py-1.5 text-[13px]">
                        <input type="checkbox" checked={done} onChange={() => toggle(key)} className="size-4 accent-[var(--accent)]" />
                        <span className={cn("flex-1", done && "text-subtle line-through")}>{i.item}</span>
                        <span className="tnum text-xs text-muted">{i.quantity}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}
