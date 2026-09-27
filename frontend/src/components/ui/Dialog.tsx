import * as D from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { EASE_OUT, fade } from "@/lib/motion";

/* Radix unmounts the portal the moment `open` turns false, which leaves no time
 * for an exit. forceMount hands mounting to AnimatePresence instead, so the
 * dialog can scale back down and the scrim fade before they leave the DOM.
 *
 * The motion `y` below is a transform; the centring uses Tailwind's
 * -translate-* utilities, which compile to the separate `translate` property.
 * The two compose, so animating y never disturbs the centring. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <D.Portal key="dialog" forceMount>
            <D.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-scrim backdrop-blur-[3px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade}
              />
            </D.Overlay>
            <D.Content asChild forceMount>
              <motion.div
                className={cn(
                  "fixed top-1/2 left-1/2 z-50 flex max-h-[min(88dvh,860px)] w-[calc(100vw-24px)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface-2 shadow-2xl",
                  className,
                )}
                initial={{ opacity: 0, scale: 0.96, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT } }}
                exit={{ opacity: 0, scale: 0.98, y: 4, transition: { duration: 0.14, ease: "easeIn" } }}
              >
                <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
                  <div className="min-w-0">
                    <D.Title className="text-base font-semibold tracking-tight">{title}</D.Title>
                    {description ? (
                      <D.Description className="mt-0.5 text-xs text-muted">{description}</D.Description>
                    ) : (
                      <D.Description className="sr-only">{typeof title === "string" ? title : "Details"}</D.Description>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {actions}
                    <D.Close className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
                      <X className="size-4" />
                    </D.Close>
                  </div>
                </div>
                <div className="overflow-y-auto px-6 py-5">{children}</div>
              </motion.div>
            </D.Content>
          </D.Portal>
        )}
      </AnimatePresence>
    </D.Root>
  );
}
