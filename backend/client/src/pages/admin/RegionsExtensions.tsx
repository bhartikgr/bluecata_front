/**
 * Sprint 28 Wave 5 — Admin Regions Extensions list page.
 *
 * Workflow: Research → Draft → Review → Approved → Live (system-wide).
 * The frozen 9 canonical regions are read-only; this page manages NEW region additions.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Globe, Plus, Search, ChevronRight, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { RegionStatus, RegionExtension } from "./types/regionExtension";
// v25.42 R9 — regional KPI rollup card (members + companies aggregated by region).
import { RegionalKpiRollup } from "@/components/collective/RegionalKpiRollup";

/* ============================================================
 * Types
 * ============================================================ */

interface ExtensionsApiResponse {
  total: number;
  stats: {
    total: number;
    byStatus: Record<RegionStatus, number>;
  };
  extensions: RegionExtension[];
}

/* ============================================================
 * Helpers
 * ============================================================ */

const STATUS_LABELS: Record<RegionStatus, string> = {
  research: "Research",
  draft: "Draft",
  review: "In Review",
  approved: "Approved",
  live: "Live",
  rejected: "Rejected",
  archived: "Archived",
};

const STATUS_COLORS: Record<RegionStatus, string> = {
  research: "bg-slate-100 text-slate-700 border-slate-200",
  draft: "bg-blue-100 text-blue-800 border-blue-200",
  review: "bg-amber-100 text-amber-800 border-amber-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  live: "bg-green-100 text-green-900 border-green-200",
  rejected: "bg-rose-100 text-rose-800 border-rose-200",
  archived: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

const WORKFLOW_STEPS: RegionStatus[] = ["research", "draft", "review", "approved", "live"];

function WorkflowPills({ status }: { status: RegionStatus }) {
  const currentIdx = WORKFLOW_STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-0.5" aria-label={`Workflow stage: ${status}`}>
      {WORKFLOW_STEPS.map((step, idx) => {
        const done = currentIdx > idx;
        const active = currentIdx === idx;
        const future = currentIdx < idx;
        return (
          <div
            key={step}
            title={STATUS_LABELS[step]}
            className={[
              "h-2 rounded-full transition-all",
              idx === 0 ? "w-5" : "w-3",
              done ? "bg-emerald-500" : active ? "bg-[hsl(0_100%_40%)]" : future ? "bg-zinc-200" : "",
              status === "rejected" ? "bg-rose-300" : "",
              status === "archived" ? "bg-zinc-200" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        );
      })}
    </div>
  );
}

/* ============================================================
 * Component
 * ============================================================ */

export default function AdminRegionsExtensions() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [codeSearch, setCodeSearch] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposeCode, setProposeCode] = useState("");
  const [proposeName, setProposeName] = useState("");
  const [proposeConfirm, setProposeConfirm] = useState(false);
  const [proposeError, setProposeError] = useState("");

  /* ---------- Query ---------- */
  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (codeSearch.trim()) params.set("code", codeSearch.trim());
  if (nameSearch.trim()) params.set("name", nameSearch.trim());

  const query = useQuery<ExtensionsApiResponse>({
    queryKey: ["/api/admin/regions/extensions", statusFilter, codeSearch, nameSearch],
    queryFn: async () => {
      const url = `/api/admin/regions/extensions?${params.toString()}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  /* ---------- Propose mutation ---------- */
  const proposeMutation = useMutation({
    mutationFn: async ({ code, name }: { code: string; name: string }) => {
      const res = await apiRequest("POST", "/api/admin/regions/extensions", { code, name });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.reason ?? body.error ?? "Failed to propose region");
      }
      return res.json();
    },
    onSuccess: (data: RegionExtension) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/regions/extensions"] });
      setProposeOpen(false);
      setProposeCode("");
      setProposeName("");
      setProposeConfirm(false);
      setProposeError("");
      toast({
        title: "Region proposed",
        description: `${data.name} (${data.code}) is now in Research stage.`,
      });
      navigate(`/admin/regions/${data.id}`);
    },
    onError: (err: Error) => {
      setProposeError(err.message);
    },
  });

  function handleProposeSubmit() {
    if (!proposeCode.trim() || !proposeName.trim()) {
      setProposeError("Both code and name are required.");
      return;
    }
    if (proposeCode.trim().length !== 2) {
      setProposeError("Code must be exactly 2 characters (ISO 3166-1 alpha-2).");
      return;
    }
    if (!proposeConfirm) {
      setProposeError("Please confirm you want to propose this region.");
      return;
    }
    setProposeError("");
    // Call with x-confirm: true — but apiRequest doesn't support custom headers directly.
    // We'll use fetch with credentials here and pass x-confirm.
    (async () => {
      try {
        const res = await fetch("/api/admin/regions/extensions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-confirm": "true",
          },
          credentials: "include",
          body: JSON.stringify({ code: proposeCode.trim().toUpperCase(), name: proposeName.trim() }),
        });
        const body = await res.json();
        if (!res.ok) {
          setProposeError(body.reason ?? body.error ?? "Failed to propose region");
          return;
        }
        qc.invalidateQueries({ queryKey: ["/api/admin/regions/extensions"] });
        setProposeOpen(false);
        setProposeCode("");
        setProposeName("");
        setProposeConfirm(false);
        setProposeError("");
        toast({ title: "Region proposed", description: `${body.name} (${body.code}) is now in Research stage.` });
        navigate(`/admin/regions/${body.id}`);
      } catch (err) {
        setProposeError((err as Error).message);
      }
    })();
  }

  const extensions = query.data?.extensions ?? [];
  const stats = query.data?.stats;

  return (
    <>
      <PageHeader
        title="Region Extensions"
        description="Add a new operating region. Workflow: Research → Draft → Review → Approved → Live (system-wide). Existing canonical formulas are frozen."
        breadcrumbs={[{ label: "Admin" }, { label: "Regions" }]}
        actions={
          <Button
            onClick={() => { setProposeOpen(true); setProposeError(""); }}
            data-testid="button-propose-region"
            className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
          >
            <Plus className="h-4 w-4 mr-2" /> Propose new region
          </Button>
        }
      />

      <PageBody>
        {/* v25.42 R9 — regional KPI rollup (members + companies by region). */}
        <RegionalKpiRollup />
        {/* Stats bar */}
        {stats && (
          <div
            className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-5"
            data-testid="stats-region-extensions"
          >
            {(
              [
                ["Total", stats.total, "text-foreground"],
                ["Research", stats.byStatus.research, "text-slate-600"],
                ["Draft", stats.byStatus.draft, "text-blue-700"],
                ["In Review", stats.byStatus.review, "text-amber-700"],
                ["Approved", stats.byStatus.approved, "text-emerald-700"],
                ["Live", stats.byStatus.live, "text-green-700"],
                ["Rejected", stats.byStatus.rejected, "text-rose-700"],
              ] as [string, number, string][]
            ).map(([label, count, cls]) => (
              <div key={label} className="text-center p-2 rounded-lg bg-secondary/50 border border-border">
                <div className={`text-lg font-bold leading-none ${cls}`} data-testid={`stat-${label.toLowerCase().replace(/ /g, "-")}`}>
                  {count}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wide">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[130px]" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {(Object.keys(STATUS_LABELS) as RegionStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative flex-1 min-w-[140px]">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Code..."
              value={codeSearch}
              onChange={(e) => setCodeSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
              data-testid="input-code-search"
            />
          </div>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Region name..."
              value={nameSearch}
              onChange={(e) => setNameSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
              data-testid="input-name-search"
            />
          </div>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="px-0">
            {query.isLoading ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : query.isError ? (
              <div className="px-6 py-10 text-center text-sm text-rose-600 flex items-center justify-center gap-2">
                <AlertCircle className="h-4 w-4" /> Failed to load region extensions.
              </div>
            ) : extensions.length === 0 ? (
              <div className="px-6 py-16 text-center" data-testid="empty-regions">
                <Globe className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium text-muted-foreground">No region extensions yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Click "Propose new region" to start the workflow.</p>
              </div>
            ) : (
              <table className="w-full text-sm" data-testid="table-region-extensions">
                <thead>
                  <tr className="text-xs uppercase text-muted-foreground border-b border-border">
                    <th className="text-left font-medium px-6 py-2.5">Code</th>
                    <th className="text-left font-medium px-3 py-2.5">Name</th>
                    <th className="text-left font-medium px-3 py-2.5">Status</th>
                    <th className="text-left font-medium px-3 py-2.5">Stage</th>
                    <th className="text-left font-medium px-3 py-2.5">Updated</th>
                    <th className="text-left font-medium px-3 py-2.5">By</th>
                    <th className="px-3 py-2.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {extensions.map((ext) => (
                    <tr
                      key={ext.id}
                      className="border-b border-border/60 hover:bg-secondary/40 cursor-pointer"
                      onClick={() => navigate(`/admin/regions/${ext.id}`)}
                      data-testid={`row-region-${ext.id}`}
                    >
                      <td className="px-6 py-3">
                        <span className="font-mono font-semibold text-sm text-[hsl(0_100%_40%)]">{ext.code}</span>
                      </td>
                      <td className="px-3 py-3 font-medium">{ext.name}</td>
                      <td className="px-3 py-3">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${STATUS_COLORS[ext.status]}`}
                          data-testid={`badge-status-${ext.id}`}
                        >
                          {STATUS_LABELS[ext.status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <WorkflowPills status={ext.status} />
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {new Date(ext.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground font-mono truncate max-w-[120px]">
                        {ext.updatedBy}
                      </td>
                      <td className="px-3 py-3">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </PageBody>

      {/* Propose dialog */}
      <Dialog open={proposeOpen} onOpenChange={(open) => { setProposeOpen(open); if (!open) { setProposeError(""); setProposeConfirm(false); } }}>
        <DialogContent data-testid="dialog-propose-region">
          <DialogHeader>
            <DialogTitle>Propose new region</DialogTitle>
            <DialogDescription>
              Enter a 2-letter ISO 3166-1 alpha-2 code (e.g. DE, NL, BR) and a display name. The new region will start in "Research" stage.
              It must not collide with the 9 canonical regions: US, CA, UK, SG, HK, CN, IN, JP, AU.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="propose-code">ISO Code (2 letters)</Label>
              <Input
                id="propose-code"
                placeholder="e.g. DE"
                value={proposeCode}
                onChange={(e) => setProposeCode(e.target.value.toUpperCase().slice(0, 2))}
                className="font-mono uppercase"
                maxLength={2}
                data-testid="input-propose-code"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="propose-name">Region name</Label>
              <Input
                id="propose-name"
                placeholder="e.g. Germany"
                value={proposeName}
                onChange={(e) => setProposeName(e.target.value)}
                data-testid="input-propose-name"
              />
            </div>
            <label className="flex items-start gap-2 cursor-pointer group" data-testid="checkbox-propose-confirm">
              <input
                type="checkbox"
                checked={proposeConfirm}
                onChange={(e) => setProposeConfirm(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs text-muted-foreground group-hover:text-foreground">
                I confirm I want to propose region <strong>{proposeCode || "??"}</strong> and start the research workflow.
              </span>
            </label>
            {proposeError && (
              <div className="text-xs text-rose-600 flex items-center gap-1.5" data-testid="error-propose-region">
                <AlertCircle className="h-3.5 w-3.5" /> {proposeError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setProposeOpen(false)} data-testid="button-propose-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleProposeSubmit}
              disabled={!proposeCode.trim() || !proposeName.trim() || !proposeConfirm}
              data-testid="button-propose-submit"
              className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
            >
              Propose region
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
