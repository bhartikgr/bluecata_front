/**
 * v25.42 W4 — Vetting pipeline donut.
 * Reads /api/collective/dsc/pipeline. Recharts donut of counts grouped by
 * transactionPrepStatus (the endpoint already returns `counts` keyed by
 * status). Loading / error / empty states handled.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { BarChart3 } from "lucide-react";

interface PipelineResponse {
  counts?: Record<string, number>;
  total?: number;
}

const STATUS_LABELS: Record<string, string> = {
  not_pursuing: "Not Pursuing",
  exploring: "Exploring",
  active: "Active",
  closing: "Closing",
  closed: "Closed",
};

const STATUS_COLORS: Record<string, string> = {
  not_pursuing: "#CBD5E1",
  exploring: "#A78BFA",
  active: "#cc0001",
  closing: "#F59E0B",
  closed: "#10B981",
};

export function VettingPipelineDonut() {
  const { data, isLoading, error } = useQuery<PipelineResponse>({
    queryKey: ["/api/collective/dsc/pipeline", "donut-widget"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/dsc/pipeline")).json(),
    staleTime: 30_000,
  });

  const counts = data?.counts ?? {};
  const chartData = Object.entries(counts)
    .map(([status, value]) => ({
      name: STATUS_LABELS[status] ?? status,
      status,
      value: Number(value) || 0,
    }))
    .filter((d) => d.value > 0);

  const total = chartData.reduce((s, d) => s + d.value, 0);

  return (
    <Card data-testid="widget-pipeline-donut">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <BarChart3 className="h-4 w-4 text-[#cc0001]" />
          Vetting Pipeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-48 w-full" data-testid="widget-pipeline-loading" />
        ) : error ? (
          <div className="text-sm text-red-700" data-testid="widget-pipeline-error">
            Couldn't load the vetting pipeline.
          </div>
        ) : total === 0 ? (
          <div className="text-center py-10 text-slate-500" data-testid="widget-pipeline-empty">
            <p className="text-sm">No companies in the pipeline yet.</p>
          </div>
        ) : (
          <div className="h-48" data-testid="widget-pipeline-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={2}
                >
                  {chartData.map((d) => (
                    <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? "#94A3B8"} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
