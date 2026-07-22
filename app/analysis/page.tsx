import { fetchTelemetryData } from "@/lib/telemetry-queries";
import { AnalysisDashboard } from "@/components/AnalysisDashboard";
import { SurfaceNav } from "@/components/SurfaceNav";

export const dynamic = "force-dynamic";

export default async function AnalysisPage() {
  const telemetryData = await fetchTelemetryData();

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <SurfaceNav active="analysis" />
        </div>
        <AnalysisDashboard initialData={telemetryData} />
      </div>
    </main>
  );
}
