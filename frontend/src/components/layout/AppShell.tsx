import { NavLink, useLocation, useOutlet } from "react-router-dom";
import { Suspense, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Activity, CalendarCheck, ChefHat, LayoutDashboard, Sparkles } from "lucide-react";
import { SyncButton } from "./SyncButton";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/cn";
import { enter, fade, glide } from "@/lib/motion";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/activities", label: "Activities", icon: Activity },
  { to: "/plan", label: "Training plan", icon: CalendarCheck },
  { to: "/cook", label: "The Cook", icon: ChefHat },
  { to: "/coach", label: "AI Coach", icon: Sparkles },
];

export function AppShell() {
  const { pathname } = useLocation();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/favicon.svg" alt="" className="size-6" />
            <span className="hidden sm:inline">Run Coach</span>
          </NavLink>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "relative flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors",
                    isActive ? "text-fg" : "text-muted hover:text-fg",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* One pill, shared by every link, that slides to the active one. */}
                    {isActive && <motion.span layoutId="nav-pill" transition={glide} className="absolute inset-0 rounded-lg bg-surface-2" />}
                    <n.icon className="relative size-4" />
                    <span className="relative">{n.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <SyncButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-6 md:pb-12">
        {/* The outgoing page fades out before the next one fades in; the scroll
            reset waits for that exit so the old page never jumps to the top
            while it is still visible. */}
        <AnimatePresence mode="wait" onExitComplete={() => window.scrollTo({ top: 0 })}>
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: enter }}
            exit={{ opacity: 0, transition: { ...fade, duration: 0.12 } }}
          >
            <ErrorBoundary>
              <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
                <FrozenOutlet />
              </Suspense>
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom tab bar on small screens */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn("relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors", isActive ? "text-accent" : "text-muted")
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="tab-indicator" transition={glide} className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-accent" />}
                <n.icon className="size-5" />
                {n.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** The route's element as it was when this page mounted. AnimatePresence keeps
 *  the outgoing page rendered during its exit, but a live <Outlet /> would
 *  already show the NEXT route inside it; freezing the element keeps the old
 *  page on screen until it has faded. */
function FrozenOutlet() {
  const outlet = useOutlet();
  const [frozen] = useState(outlet);
  return frozen;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
