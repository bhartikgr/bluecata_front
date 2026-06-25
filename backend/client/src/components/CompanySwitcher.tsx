import { asArray } from "@/lib/safeArray";
/**
 * Sprint 11 — CompanySwitcher
 *
 * Dropdown shown in the founder topbar. Lists every company the founder
 * is associated with (via /api/founder/companies) and lets them flip the
 * active company. The active company drives founder-scoped queries
 * (cap table, rounds, dataroom, reports, CRM, settings).
 *
 * Visible only when role === "founder".
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Building2, Check, ChevronDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { NewCompanyDialog } from "@/components/NewCompanyDialog";

type FounderCompany = {
  companyId: string;
  companyName: string;
  legalName: string;
  logoUrl: string | null;
  role: "founder" | "co-founder" | "operator" | "advisor";
  lastActiveAt: string;
  kpi: {
    capTableHolders: number;
    activeRoundsCount: number;
    raisedThisYearUsd: number;
    dataroomFiles: number;
    pendingSoftCircles: number;
    ownershipPct: number;
  };
  collective: { status: string; memberSince?: string };
  billing: {
    plan: string; // e.g. "Founder Free" | "Founder Pro" | "Founder Scale"
    monthlyUsd: number;
    nextBillingDate?: string;
    cardLast4?: string;
    invoiceCount: number;
  };
  sector: string;
  stage: string;
  hq: string;
};

type ActiveCompanyResponse = {
  activeCompanyId: string;
  company: FounderCompany | null;
};

function shortPlan(plan: string): string {
  // "Founder Pro" -> "PRO", "Founder Free" -> "FREE", "Founder Scale" -> "SCALE"
  const tail = plan.split(" ").slice(-1)[0] ?? plan;
  return tail.toUpperCase();
}

export function CompanySwitcher() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const companiesQuery = useQuery<FounderCompany[]>({
    queryKey: ["/api/founder/companies"],
  });
  const activeQuery = useQuery<ActiveCompanyResponse>({
    queryKey: ["/api/founder/active-company"],
  });

  const activate = useMutation({
    mutationFn: async (companyId: string) => {
      return apiRequest("POST", `/api/founder/companies/${companyId}/activate`);
    },
    onSuccess: (_data, companyId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/active-company"] });
      // Cross-company invalidations: cap table, rounds, dataroom, reports, CRM
      queryClient.invalidateQueries({ queryKey: ["/api/founder/captable"] });
      // v23.4.5 BUG 020 fix: the rounds list page uses queryKey ["/api/rounds", ...]
      // (no "founder" prefix). Previously we only invalidated the
      // "/api/founder/rounds" namespace, so the rounds cache was never
      // cleared on company-switch and the founder saw rounds from their
      // PREVIOUS company. Invalidate both prefixes plus the cap-table flavour.
      queryClient.invalidateQueries({ queryKey: ["/api/founder/rounds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rounds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/captable"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/dataroom/files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/reports2"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/investor-crm"] });
      // v25.20 Lane 6 NH fix: /api/auth/me carries the user's active company
      // context and the billing surface keys off it. Billing previously kept
      // showing the prior company's subscription/plan after a switch until
      // hard-reload. Also flush billing / settings / profile namespaces that
      // are tied to the active company so subsequent reads refetch fresh.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/billing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/subscription"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/settings"] });
      // v25.21 Lane D NM fix — Collective surfaces (dashboard, companies, DSC
      // scores, eligibility, deal-room, soft-circles, transaction-prep) are
      // server-resolved against the active company / membership context, but
      // the query keys carry no company discriminator, so they stuck on the
      // prior company until hard reload (same pattern as the v25.20 Billing
      // fix). Flush every collective namespace on switch.
      queryClient.invalidateQueries({ queryKey: ["/api/collective/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/dsc/scores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/dsc/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/eligibility"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/membership/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/dealroom/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/soft-circles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/activity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/applications/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/network"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collective/transaction-prep"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/collective/applications/mine"] });
      const co = asArray(companiesQuery.data).find((c) => c.companyId === companyId);
      if (co) toast({ title: "Switched company", description: `Now viewing ${co.companyName}` });
    },
    onError: (e: any) =>
      toast({
        title: "Switch failed",
        description: e?.message ?? "Try again",
        variant: "destructive",
      }),
  });

  const companies = companiesQuery.data ?? [];
  const activeId = activeQuery.data?.activeCompanyId ?? null;
  const active = companies.find((c) => c.companyId === activeId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="button-company-switcher"
        className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-white text-xs font-medium border border-white/10 transition-colors outline-none"
        aria-label="Switch company"
      >
        <Building2 className="h-3.5 w-3.5" />
        <span className="max-w-[140px] truncate">
          {companiesQuery.isLoading ? "Loading…" : active?.companyName ?? "Select company"}
        </span>
        {active ? (
          <span className="text-[9px] uppercase tracking-wide bg-white/15 px-1.5 py-0.5 rounded">
            {shortPlan(active.billing.plan)}
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" data-testid="menu-company-switcher">
        <div className="px-2 py-1.5 text-xs font-semibold" data-testid="label-company-switcher">
          {`Your companies · ${companies.length}`}
        </div>
        <DropdownMenuSeparator />
        {companies.map((co) => {
          const isActive = co.companyId === activeId;
          return (
            <DropdownMenuItem
              key={co.companyId}
              onSelect={() => !isActive && activate.mutate(co.companyId)}
              className="flex items-start gap-2 cursor-pointer"
              data-testid={`menu-item-company-${co.companyId}`}
            >
              <div className="flex items-start gap-2 w-full">
                <div className="mt-0.5 w-4 flex-shrink-0">
                  {isActive ? (
                    <Check className="h-4 w-4 text-[hsl(0_100%_40%)]" />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{co.companyName}</span>
                    <span className="text-[9px] uppercase tracking-wide bg-secondary px-1.5 py-0.5 rounded">
                      {shortPlan(co.billing.plan)}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {[co.sector, co.stage, co.hq].filter(Boolean).join(" · ")}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                    {co.kpi.capTableHolders} holders · {co.kpi.activeRoundsCount} active round
                    {co.kpi.activeRoundsCount === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            // Prevent the menu from closing before we open the dialog.
            e.preventDefault();
            setAddOpen(true);
          }}
          className="text-xs cursor-pointer"
          data-testid="menu-item-add-company"
        >
          <Plus className="h-3.5 w-3.5 mr-2" /> Add company
        </DropdownMenuItem>
      </DropdownMenuContent>
      <NewCompanyDialog open={addOpen} onOpenChange={setAddOpen} />
    </DropdownMenu>
  );
}
