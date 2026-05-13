/**
 * Wave C-3 — Collective Deal Room (list view)
 * Table of M&A-active companies with filters and composite scores.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Briefcase, Search } from "lucide-react";

interface DealRoomCompany {
  companyId: string;
  companyName: string;
  sector: string | null;
  stage: string | null;
  lastRaise: string | null;
  lastRaiseAmount: number | null;
  transactionPrepStatus: string;
  compositeScore: number | null;
  autoTier: string | null;
  dscTier: string | null;
  tagline: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  exploring: "bg-amber-100 text-amber-700",
  active: "bg-blue-100 text-blue-700",
  closing: "bg-emerald-100 text-emerald-700",
  not_pursuing: "bg-slate-100 text-slate-500",
};

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700",
  B: "bg-blue-100 text-blue-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-red-100 text-red-600",
};

export default function CollectiveDealRoom() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data, isLoading, error } = useQuery<{ companies: DealRoomCompany[]; total: number }>({
    queryKey: ["/api/collective/dealroom/companies"],
    queryFn: () => apiRequest("GET", "/api/collective/dealroom/companies").then((r) => r.json()),
    refetchInterval: 30_000,
  });

  const companies = data?.companies ?? [];

  const filtered = companies.filter((c) => {
    if (search && !c.companyName.toLowerCase().includes(search.toLowerCase())) return false;
    if (stageFilter !== "all" && c.stage !== stageFilter) return false;
    if (statusFilter !== "all" && c.transactionPrepStatus !== statusFilter) return false;
    return true;
  });

  const allStages = Array.from(new Set(companies.map((c) => c.stage).filter(Boolean))) as string[];
  const allStatuses = Array.from(new Set(companies.map((c) => c.transactionPrepStatus)));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-semibold flex items-center gap-2"
            style={{ color: "#1A1A2E" }}
            data-testid="heading-dealroom"
          >
            <Briefcase className="h-5 w-5 text-[#8E2A4E]" />
            Deal Room
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Companies with active M&A or transaction-prep channels.
          </p>
        </div>
        <Badge
          className="bg-[#8E2A4E]/10 text-[#8E2A4E] border-0"
          data-testid="badge-total-companies"
        >
          {data?.total ?? 0} companies
        </Badge>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48 max-w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Search companies…"
            className="pl-9 text-sm h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-companies"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-36 h-9 text-sm" data-testid="select-filter-stage">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {allStages.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-9 text-sm" data-testid="select-filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {allStatuses.map((s) => (
              <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {error && (
            <div className="p-6 text-sm text-red-600" data-testid="error-dealroom">
              Failed to load Deal Room data. Please refresh.
            </div>
          )}
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-500" data-testid="empty-dealroom">
              <Briefcase className="h-10 w-10 mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium">No companies in Deal Room</p>
              <p className="text-xs mt-1">
                Companies with transactionPrepStatus in <strong>exploring, active, or closing</strong> will appear here.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Last Raise</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Composite</TableHead>
                  <TableHead>Auto-Tier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((company) => (
                  <TableRow
                    key={company.companyId}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/collective/dealroom/${company.companyId}`)}
                    data-testid={`row-dealroom-${company.companyId}`}
                  >
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-slate-800">{company.companyName}</p>
                        {company.tagline && (
                          <p className="text-xs text-slate-400 truncate max-w-60">{company.tagline}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-600">{company.sector ?? "—"}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-600">{company.stage ?? "—"}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-500">
                        {company.lastRaise
                          ? new Date(company.lastRaise).toLocaleDateString()
                          : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-[10px] capitalize ${STATUS_COLORS[company.transactionPrepStatus] ?? "bg-slate-100 text-slate-500"}`}
                        data-testid={`badge-status-${company.companyId}`}
                      >
                        {company.transactionPrepStatus.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {company.compositeScore !== null ? (
                        <span
                          className="text-sm font-semibold"
                          style={{ color: "#8E2A4E" }}
                          data-testid={`score-${company.companyId}`}
                        >
                          {company.compositeScore}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">No DSC score yet</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {company.autoTier ? (
                        <Badge
                          className={`text-[10px] ${TIER_COLORS[company.autoTier] ?? "bg-slate-100 text-slate-500"}`}
                          data-testid={`tier-${company.companyId}`}
                        >
                          Tier {company.autoTier}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
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
