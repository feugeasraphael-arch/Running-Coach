import * as T from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const TooltipProvider = T.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn("z-50 max-w-64 animate-fade-in rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs shadow-xl", className)}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
