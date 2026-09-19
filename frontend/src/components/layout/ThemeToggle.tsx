import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useTheme } from "@/lib/theme";

const SWAP = "transition-[opacity,rotate,scale] duration-[280ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none";

/** Switches the ground between Instrument's dark base and its light variant.
 *  The two icons are stacked and crossfaded rather than swapped, so the button
 *  itself does not jump while the page behind it is still fading. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  const label = dark ? "Switch to the light theme" : "Switch to the dark theme";

  return (
    <Tooltip side="bottom" content={label}>
      <Button size="icon" variant="ghost" onClick={toggle} aria-label={label}>
        <span className="relative grid size-4 place-items-center">
          <Sun aria-hidden className={`col-start-1 row-start-1 ${SWAP}`} style={{ opacity: dark ? 1 : 0, rotate: dark ? "0deg" : "-70deg", scale: dark ? 1 : 0.6 }} />
          <Moon aria-hidden className={`col-start-1 row-start-1 ${SWAP}`} style={{ opacity: dark ? 0 : 1, rotate: dark ? "70deg" : "0deg", scale: dark ? 0.6 : 1 }} />
        </span>
      </Button>
    </Tooltip>
  );
}
