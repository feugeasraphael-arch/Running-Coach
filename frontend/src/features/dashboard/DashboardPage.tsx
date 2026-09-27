import { CoachHero } from "./CoachHero";
import { RecoveryCard, ThisWeekCard, TrainingLoadCard, Vo2maxCard } from "./KpiCards";
import { EffortHeatmap } from "./EffortHeatmap";
import { PaceHrChart, WeeklyMileageChart, WellnessChart } from "./TrendCharts";
import { RaceTimes } from "./RaceTimes";
import { RecentActivities } from "./RecentActivities";
import { FormCard } from "./FormCard";
import { TrainingMap } from "./TrainingMap";

export function DashboardPage() {
  return (
    <div className="space-y-4">
      <CoachHero />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TrainingLoadCard />
        <RecoveryCard />
        <ThisWeekCard />
        <Vo2maxCard />
      </div>

      <EffortHeatmap />

      <TrainingMap />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 [&>section]:h-full"><WeeklyMileageChart /></div>
        <RaceTimes />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 [&>section]:h-full"><PaceHrChart /></div>
        <RecentActivities />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 [&>section]:h-full"><WellnessChart /></div>
        <FormCard />
      </div>
    </div>
  );
}
