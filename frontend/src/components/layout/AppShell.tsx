import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Suspense, useEffect } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Activity, CalendarCheck, ChefHat, LayoutDashboard, Sparkles } from "lucide-react";
import { SyncButton } from "./SyncButton";
import { cn } from "@/lib/cn";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/activities", label: "Activities", icon: Activity },
  { to: "/plan", label: "Training plan", icon: CalendarCheck },
  { to: "/cook", label: "The Cook", icon: ChefHat },
  { to: "/coach", label: "AI Coach", icon: Sparkles },
];

export function AppShell() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

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
                    "flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors",
                    isActive ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                  )
                }
              >
                <n.icon className="size-4" />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <SyncButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-6 md:pb-12">
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
          <Outlet />
        </Suspense>
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
              cn("flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium", isActive ? "text-accent" : "text-muted")
            }
          >
            <n.icon className="size-5" />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
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
