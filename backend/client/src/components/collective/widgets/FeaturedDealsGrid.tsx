/**
 * v25.42 W3 — Featured deals 6-tile grid.
 * Reads /api/collective/dsc/scores, sorts by DSC composite score descending
 * (Ozan HARD CONSTRAINT #4), takes the top 6. Each tile shows company name +
 * sector + DSC composite score + soft-circle % if available.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Star } from "lucide-react";
import { Link } from "wouter";

interface ScoreRow {
  companyId: string;
  companyName: string;
  sector?: string | null;
  compositeScore?: number | null;
  softCirclePct?: number | null;
}
interface ScoresResponse {
  scores?: ScoreRow[];
  total?: number;
}

export function FeaturedDealsGrid() {
  const { data, isLoading, error } = useQuery<ScoresResponse>({
    queryKey: ["/api/collective/dsc/scores", "featured-widget"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/dsc/scores")).json(),
    staleTime: 30_000,
  });

  const top6 = (data?.scores ?? [])
    .slice()
    .sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0))
    .slice(0, 6);

  return (
    <Card data-testid="widget-featured-deals">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <Star className="h-4 w-4 text-[#cc0001]" />
          Featured Deals
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="widget-featured-loading">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-red-700" data-testid="widget-featured-error">
            Couldn't load featured deals.
          </div>
        ) : top6.length === 0 ? (
          <div className="text-center py-6 text-slate-500" data-testid="widget-featured-empty">
            <p className="text-sm">No scored deals yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="widget-featured-grid">
            {top6.map((row) => (
              <Link key={row.companyId} href={`/collective/companies/${row.companyId}`}>
                <div
                  className="rounded-md border border-slate-200 p-3 hover:border-[#cc0001]/40 transition-colors cursor-pointer"
                  data-testid={`widget-featured-tile-${row.companyId}`}
                >
                  <p className="text-sm font-medium truncate" style={{ color: "#1A1A2E" }}>
                    {row.companyName}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{row.sector ?? "—"}</p>
                  <div className="flex items-center justify-between mt-2">
                    <Badge className="text-[10px] bg-[#cc0001]/15 text-[#cc0001]">
                      DSC {row.compositeScore ?? "—"}
                    </Badge>
                    {row.softCirclePct != null && (
                      <span className="text-[10px] text-emerald-600">
                        {row.softCirclePct}% soft-circled
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
