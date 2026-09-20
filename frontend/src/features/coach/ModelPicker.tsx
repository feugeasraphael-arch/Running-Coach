import * as M from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";

export type CoachModel = {
  id: string;
  label: string;
  description: string;
};

/** Claude-style model menu in the composer: each model with a one-line
 *  description and a check on the active one. */
export function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: CoachModel[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const current = models.find((m) => m.id === value);

  return (
    <M.Root>
      <M.Trigger
        disabled={disabled || models.length === 0}
        className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-muted transition-colors outline-none hover:bg-surface-2 hover:text-fg focus-visible:bg-surface-2 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-surface-2 data-[state=open]:text-fg"
        aria-label="Choose the model"
      >
        {current ? current.label : "Model"}
        <ChevronDown className="size-3.5" />
      </M.Trigger>
      <M.Portal>
        <M.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-h-[min(70dvh,var(--radix-dropdown-menu-content-available-height))] w-72 animate-scale-in overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl"
        >
          <M.RadioGroup value={value} onValueChange={onChange}>
            {models.map((m) => (
              <M.RadioItem
                key={m.id}
                value={m.id}
                className="flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2 outline-none select-none data-[highlighted]:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{m.label}</div>
                  <div className="truncate text-[11px] text-muted">{m.description}</div>
                </div>
                <M.ItemIndicator>
                  <Check className="size-4 text-accent" />
                </M.ItemIndicator>
              </M.RadioItem>
            ))}
          </M.RadioGroup>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
