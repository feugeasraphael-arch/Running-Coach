import { StrictMode, lazy } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { AppShell } from "@/components/layout/AppShell";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { EmptyState } from "@/components/ui/EmptyState";

const CookPage = lazy(() => import("@/features/cook/CookPage").then((m) => ({ default: m.CookPage })));
const PlanPage = lazy(() => import("@/features/plan/PlanPage").then((m) => ({ default: m.PlanPage })));
const ActivityDetailPage = lazy(() => import("@/features/activities/ActivityDetailPage").then((m) => ({ default: m.ActivityDetailPage })));
const ActivitiesPage = lazy(() => import("@/features/activities/ActivitiesPage").then((m) => ({ default: m.ActivitiesPage })));
const DashboardPage = lazy(() => import("@/features/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={120}>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="activities" element={<ActivitiesPage />} />
              <Route path="activities/:id" element={<ActivityDetailPage />} />
              <Route path="plan" element={<PlanPage />} />
              <Route path="cook" element={<CookPage />} />
              <Route path="*" element={<EmptyState title="Page not found" hint="That URL doesn't match anything in Run Coach." />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
