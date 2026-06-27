/**
 * Wave C-3 — Collective Companies List
 * All companies visible to the Collective (broader than Deal Room).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Building2, Search } from "lucide-react";

interface Company {
  companyId: string;
  companyName: string;
  sector: string | null;
  stage: string | null;
  tagline: string | null;
  logoUrl: string | null;
  transactionPrepStatus: string | null;
  compositeScore: number | null;
  autoTier: string | null;
  dscTier: string | null;
  jurisdiction: string | null;
  employees: number | null;
  hq: string | null;
}

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700",
  B: "bg-blue-100 text-blue-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-red-100 text-red-600",
};

export default function CollectiveCompanies() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [sectorFilter, setSectorFilter] = useState("all");

  const { data, isLoading, error } = useQuery<{ companies: Company[]; total: number }>({
    queryKey: ["/api/collective/companies"],
    queryFn: () => apiRequest("GET", "/api/collective/companies").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const companies = data?.companies ?? [];

  const filtered = companies.filter((c) => {
    if (search && !c.companyName.toLowerCase().includes(search.toLowerCase())) return false;
    if (stageFilter !== "all" && c.stage !== stageFilter) return false;
    if (sectorFilter !== "all" && c.sector !== sectorFilter) return false;
    return true;
  });

  const allStages = Array.from(new Set(companies.map((c) => c.stage).filter(Boolean))) as string[];
  const allSectors = Array.from(new Set(companies.map((c) => c.sector).filter(Boolean))) as string[];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-semibold flex items-center gap-2"
            style={{ color: "#1A1A2E" }}
            data-testid="heading-companies"
          >
            <Building2 className="h-5 w-5 text-[#cc0001]" />
            Companies
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            All companies on the Capavate Collective platform.
          </p>
        </div>
        <Badge className="bg-[#cc0001]/10 text-[#cc0001] border-0" data-testid="badge-total">
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
            data-testid="input-search"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-36 h-9 text-sm" data-testid="select-stage">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {allStages.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sectorFilter} onValueChange={setSectorFilter}>
          <SelectTrigger className="w-40 h-9 text-sm" data-testid="select-sector">
            <SelectValue placeholder="Sector" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sectors</SelectItem>
            {allSectors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {error && (
            <div className="p-6 text-sm text-red-600" data-testid="error-companies">
              Failed to load companies. Please refresh.
            </div>
          )}
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-500" data-testid="empty-companies">
              <Building2 className="h-10 w-10 mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium">No companies found</p>
              <p className="text-xs mt-1">Adjust filters or check back later.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>HQ</TableHead>
                  <TableHead>M&A Status</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Tier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((company) => (
                  <TableRow
                    key={company.companyId}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/collective/companies/${company.companyId}`)}
                    data-testid={`row-company-${company.companyId}`}
                  >
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-slate-800">{company.companyName}</p>
                        {company.tagline && (
                          <p className="text-xs text-slate-400 truncate max-w-56">{company.tagline}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{company.sector ?? "—"}</TableCell>
                    <TableCell className="text-sm text-slate-600">{company.stage ?? "—"}</TableCell>
                    <TableCell className="text-xs text-slate-500">{company.hq ?? "—"}</TableCell>
                    <TableCell>
                      {company.transactionPrepStatus ? (
                        <Badge className="text-[10px] capitalize bg-slate-100 text-slate-600">
                          {company.transactionPrepStatus.replace("_", " ")}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {company.compositeScore !== null ? (
                        <span className="text-sm font-semibold" style={{ color: "#cc0001" }}
                          data-testid={`score-${company.companyId}`}>
                          {company.compositeScore}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {company.autoTier ? (
                        <Badge
                          className={`text-[10px] ${TIER_COLORS[company.autoTier] ?? "bg-slate-100 text-slate-500"}`}
                          data-testid={`tier-${company.companyId}`}
                        >
                          {company.autoTier}
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
