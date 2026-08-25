/**
 * Sprint 15 D6 — Founder multi-company picker.
 *
 * Per design Part 3:
 *  - Each tile: company name, current stage, investor count, last-active timestamp
 *  - Click → POST /api/founder/companies/:id/activate → /founder/dashboard
 *  - "+ New company" tile → /auth/signup (re-uses founder signup wizard)
 *  - Auto-skip when companies.length === 1 (jump straight to dashboard)
 *  - Redirect to /auth/signup when companies.length === 0
 *
 * SANDBOX-SAFE: no Web Storage APIs.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, Plus, Users, Clock, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEntitlement, type FounderCompany } from "@/lib/entitlement";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { NewCompanyDialog } from "@/components/NewCompanyDialog";
/* WAVE 125 · FINDING 2 — the words for a holder count that has not been derived. */
import { CAP_TABLE_HOLDERS_NOT_DERIVED_STATEMENT } from "@/lib/captable/capTableHolderCount";

function formatLastActive(iso: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / day);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function SelectCompany() {
  const [, navigate] = useLocation();
  const { data: ctx, isLoading } = useEntitlement();
  const { toast } = useToast();

  // v23.4.7 Phase 2 (BUG 024): the "+ New company" tile opens the same
  // NewCompanyDialog modal that the top-bar CompanySwitcher uses, so the
  // founder can create a new company in-place instead of being navigated
  // to /auth/signup (which dropped them onto a stale dashboard route).
  const [newCompanyOpen, setNewCompanyOpen] = useState(false);

  const activate = useMutation({
    mutationFn: async (companyId: string) => {
      return apiRequest("POST", `/api/founder/companies/${companyId}/activate`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      navigate("/founder/dashboard");
    },
    onError: () => {
      toast({
        title: "Couldn't switch company",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const companies = ctx?.founder.companies ?? [];

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 125 · FINDING 2 — WHERE "0 INVESTORS" CAME FROM.
     ═══════════════════════════════════════════════════════════════════════════
     Each tile printed `{c.capTableHolders} investors`. `capTableHolders` has NO
     WRITER anywhere in live code (29 live occurrences, 0 computations — see
     `build_log/wave125/enum_captable_holders.py`), so this screen told every
     founder that every one of his companies had `0 investors` before he had even
     opened one.

     The derived count cannot arrive on this screen's own payload: these companies
     come from `/api/auth/me`, whose projection is built by
     `server/lib/userContext.ts:309` — a SACRED file that lists its fields
     explicitly and drops anything added to `kpi`. Rather than print a figure
     nobody computed, this reads the SAME derived field from
     `GET /api/founder/companies`, which `withComputedOwnership` overlays and which
     the top-bar CompanySwitcher already queries, and joins it by `companyId`. When
     that read has not landed, or the engine could not derive a count, the tile says
     so in plain English instead of showing a number. */
  const derivedCompanies = useQuery<Array<{ companyId: string; kpi?: { capTableHoldersOnRecord?: number | null } }>>({
    queryKey: ["/api/founder/companies"],
  });
  const holderCountByCompanyId = new Map<string, number>();
  for (const row of derivedCompanies.data ?? []) {
    const n = row?.kpi?.capTableHoldersOnRecord;
    if (typeof n === "number") holderCountByCompanyId.set(row.companyId, n);
  }
  const founderName =
    ctx?.identity.screenName ?? ctx?.identity.name?.split(" ")[0] ?? "there";

  // Edge cases: 0 companies → signup, 1 company → auto-skip.
  useEffect(() => {
    if (isLoading || !ctx) return;
    if (companies.length === 0) {
      // B-V11-1 fix: send 0-company founders to the founder dashboard's empty
      // state (company creation prompt). Previously navigated to /auth/signup
      // which then routed back here, producing an infinite redirect loop.
      navigate("/founder/dashboard");
      return;
    }
    if (companies.length === 1 && !activate.isPending) {
      activate.mutate(companies[0].companyId);
    }
    // Intentionally narrow deps: only re-run when company set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, companies.length]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-sm text-muted-foreground" data-testid="select-company-loading">
          Loading your companies…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 md:p-12">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-select-greeting">
            Welcome back, {founderName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Which company do you want to work on today?
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map((c: FounderCompany) => (
            <Card
              key={c.companyId}
              role="button"
              tabIndex={0}
              data-testid={`card-company-${c.companyId}`}
              data-company-id={c.companyId}
              onClick={() => activate.mutate(c.companyId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activate.mutate(c.companyId);
                }
              }}
              className="cursor-pointer hover:shadow-md hover:border-primary/40 transition group"
            >
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-9 w-9 rounded-md bg-primary/10 grid place-items-center text-primary">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                    {c.stage || "—"}
                  </Badge>
                </div>
                <div className="font-semibold text-sm mb-0.5" data-testid={`text-company-name-${c.companyId}`}>
                  {c.companyName}
                </div>
                <div className="text-xs text-muted-foreground mb-3 truncate">
                  {c.legalName !== c.companyName ? c.legalName : c.sector || c.hq || "—"}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1" data-testid={`text-investor-count-${c.companyId}`}>
                    <Users className="h-3 w-3" />
                    {holderCountByCompanyId.has(c.companyId)
                      ? `${holderCountByCompanyId.get(c.companyId)} ${holderCountByCompanyId.get(c.companyId) === 1 ? "holder" : "holders"}`
                      : CAP_TABLE_HOLDERS_NOT_DERIVED_STATEMENT}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatLastActive(c.lastActiveAt)}
                  </span>
                </div>
                <div className="mt-4 pt-3 border-t flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    {c.activeRoundsCount} active {c.activeRoundsCount === 1 ? "round" : "rounds"}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition" />
                </div>
              </CardContent>
            </Card>
          ))}

          {/* + New company tile (v23.4.7 Phase 2 BUG 024: opens NewCompanyDialog) */}
          <Card
            role="button"
            tabIndex={0}
            data-testid="card-new-company"
            onClick={() => setNewCompanyOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setNewCompanyOpen(true);
              }
            }}
            className="cursor-pointer hover:shadow-md hover:border-primary/40 transition border-dashed"
          >
            <CardContent className="p-5 h-full flex flex-col items-center justify-center text-center min-h-[180px]">
              <div className="h-9 w-9 rounded-md bg-muted grid place-items-center text-muted-foreground mb-3">
                <Plus className="h-4 w-4" />
              </div>
              <div className="font-semibold text-sm mb-1">New company</div>
              <div className="text-xs text-muted-foreground">
                Start a new cap table & dataroom
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-10 text-center text-xs text-muted-foreground">
          You can switch companies any time from the top-bar switcher.
          <Button
            variant="link"
            size="sm"
            className="text-xs h-auto px-2"
            onClick={() => navigate("/")}
            data-testid="button-back-to-landing"
          >
            ← Back to landing
          </Button>
        </div>
      </div>
      <NewCompanyDialog open={newCompanyOpen} onOpenChange={setNewCompanyOpen} />
    </div>
  );
}
