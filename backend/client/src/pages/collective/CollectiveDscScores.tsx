/**
 * Wave C-3 — Collective DSC Composite Scores
 * Sortable table of all companies with live-computed scores.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { TrendingUp, ArrowUpDown } from "lucide-react";

interface ScoreRow {
  companyId: string;
  companyName: string;
  sector: string | null;
  compositeScore: number;
  mnaScore: number;
  roundScore: number;
  autoTier: string;
  sectorBenchmark: number | null;
  dscTier: string | null;
  lastUpdated: string | null;
}

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700",
  B: "bg-blue-100 text-blue-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-red-100 text-red-600",
};

const DSC_TIER_COLORS: Record<string, string> = {
  priority: "bg-purple-100 text-purple-700",
  featured: "bg-emerald-100 text-emerald-700",
  qualified: "bg-blue-100 text-blue-700",
  watch: "bg-amber-100 text-amber-700",
};

type SortKey = "compositeScore" | "mnaScore" | "roundScore" | "companyName";
type SortDir = "asc" | "desc";

export default function CollectiveDscScores() {
  const [, navigate] = useLocation();
  const [sortKey, setSortKey] = useState<SortKey>("compositeScore");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, isLoading, error } = useQuery<{ scores: ScoreRow[]; total: number }>({
    queryKey: ["/api/collective/dsc/scores"],
    queryFn: () => apiRequest("GET", "/api/collective/dsc/scores").then((r) => r.json()),
    refetchInterval: 30_000,
  });

  const scores = data?.scores ?? [];

  const sorted = [...scores].sort((a, b) => {
    const va = a[sortKey];
    const vb = b[sortKey];
    if (typeof va === "number" && typeof vb === "number") {
      return sortDir === "desc" ? vb - va : va - vb;
    }
    if (typeof va === "string" && typeof vb === "string") {
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return 0;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-semibold flex items-center gap-2"
            style={{ color: "#1A1A2E" }}
            data-testid="heading-dsc-scores"
          >
            <TrendingUp className="h-5 w-5 text-[#cc0001]" />
            Composite Scores
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Live-computed M&A readiness composites for all companies.
          </p>
        </div>
        {data && (
          <Badge className="bg-[#cc0001]/10 text-[#cc0001] border-0" data-testid="badge-total-scores">
            {data.total} companies scored
          </Badge>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="error-scores">
          Failed to load scores. Please refresh.
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-16 text-center text-slate-500" data-testid="empty-scores">
              <TrendingUp className="h-10 w-10 mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium">No scores yet</p>
              <p className="text-xs mt-1">
                Scores will appear here once companies have M&A readiness data. Use <strong>DSC Pipeline</strong> to compute.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs font-semibold p-0 hover:bg-transparent gap-1"
                      onClick={() => toggleSort("companyName")}
                      data-testid="sort-company"
                    >
                      Company <ArrowUpDown className="h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs font-semibold p-0 hover:bg-transparent gap-1"
                      onClick={() => toggleSort("compositeScore")}
                      data-testid="sort-composite"
                    >
                      Composite <ArrowUpDown className="h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs font-semibold p-0 hover:bg-transparent gap-1"
                      onClick={() => toggleSort("mnaScore")}
                      data-testid="sort-mna"
                    >
                      M&A Sub-score <ArrowUpDown className="h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs font-semibold p-0 hover:bg-transparent gap-1"
                      onClick={() => toggleSort("roundScore")}
                      data-testid="sort-round"
                    >
                      Round Sub-score <ArrowUpDown className="h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>Sector Benchmark</TableHead>
                  <TableHead>Auto-Tier</TableHead>
                  <TableHead>DSC Tier</TableHead>
                  <TableHead>Last Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row) => (
                  <TableRow
                    key={row.companyId}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/collective/dealroom/${row.companyId}`)}
                    data-testid={`row-score-${row.companyId}`}
                  >
                    <TableCell className="font-medium text-sm text-slate-800">
                      {row.companyName}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{row.sector ?? "—"}</TableCell>
                    <TableCell>
                      <span
                        className="text-sm font-bold"
                        style={{ color: "#cc0001" }}
                        data-testid={`composite-${row.companyId}`}
                      >
                        {row.compositeScore}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm" data-testid={`mna-score-${row.companyId}`}>
                        {row.mnaScore}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm" data-testid={`round-score-${row.companyId}`}>
                        {row.roundScore}
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.sectorBenchmark !== null ? (
                        <span className="text-xs text-slate-500" data-testid={`benchmark-${row.companyId}`}>
                          {row.sectorBenchmark}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-[10px] ${TIER_COLORS[row.autoTier] ?? "bg-slate-100 text-slate-500"}`}
                        data-testid={`auto-tier-${row.companyId}`}
                      >
                        Tier {row.autoTier}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.dscTier ? (
                        <Badge
                          className={`text-[10px] capitalize ${DSC_TIER_COLORS[row.dscTier] ?? "bg-slate-100 text-slate-500"}`}
                          data-testid={`dsc-tier-${row.companyId}`}
                        >
                          {row.dscTier}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {row.lastUpdated ? new Date(row.lastUpdated).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
