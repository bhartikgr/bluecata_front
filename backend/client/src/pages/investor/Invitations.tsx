/**
 * Sprint 10 — Investor Invitations index (rebuild).
 * Sprint 20 — removed COMPANY_BLURBS, added tab filter, fixed loading/empty,
 *             fixed pro-rata badge condition.
 * Sprint 21 Wave B — B1: "Review Deal and Soft-Circle" button label.
 *                    B2: useMemo tab counts, SSE invalidation useEffect.
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StateBadge } from "@/components/common";
import { ArrowRight, Check, Activity, AlertTriangle, Users } from "lucide-react";
import { fmtUSD, fmtPct, fmtDate } from "@/lib/format";
import type { MaIntelligence } from "@shared/schema";
import { useRealtimeSync } from "@/lib/realtimeSync";
// SPINE-0 (Wave 2): the ONE canonical source of investor ladder derivation.
// This surface must NOT re-derive `state === x` locally — it groups by spine
// buckets. FIX #3 (count parity, Option A): the "Active" (pending) tab counts
// and shows the IDENTICAL set as the Dashboard pending badge —
// spine.pendingInvitations = invited + viewed + accepted (isPendingStage).
// soft_circled/confirmed/signed live in the "Soft-circle" tab (isSoftCircledStage),
// so no invitation is ever dropped from every tab.
import {
  useInvestorSpine,
  isPendingStage,
  isSoftCircledStage,
  type NormalizedStage,
} from "@/lib/investor/investorSpine";

type Inv = {
  id: string;
  company: { id: string; name: string; sector: string; description?: string };
  round: { id: string; name: string; type: string };
  state: string;
  receivedAt: string;
  expiresAt: string;
  targetAmount: number;
  raisedAmount: number;
  minTicket: number;
  preMoney: number;
  hasProRata?: boolean;
};

type TabFilter = "all" | "pending" | "soft_circled" | "declined" | "expired";

/**
 * Map a TabFilter onto a spine-bucket predicate over the canonical
 * NormalizedStage. This is the single place that decides tab membership; it
 * uses the SAME spine derivations every surface reads — never exact
 * `state === tab` equality.
 *
 * FIX #3 (count parity, Option A): the "Active" (pending) tab === the Dashboard
 * pending badge === spine.pendingInvitations = isPendingStage (invited + viewed
 * + accepted). soft_circled/confirmed/signed are NOT in "Active" — they belong
 * to the "Soft-circle" tab (isSoftCircledStage). Every ladder invitation short
 * of funded therefore lands in exactly one tab (pending OR soft_circled),
 * declined/expired/revoked in their own tabs — no invitation is silently
 * dropped from all tabs. (funded is a holding, surfaced in Portfolio.)
 */
function matchesTab(tab: Exclude<TabFilter, "all">, stage: NormalizedStage): boolean {
  switch (tab) {
    // "Active" (pending tab key) = the Ozan-locked pending set, byte-identical
    // to spine.pendingInvitations: invited + viewed + accepted only.
    case "pending":
      return isPendingStage(stage);
    // Soft-circle tab absorbs soft_circled + confirmed + signed (on/past the
    // soft-circle rung, short of funded) — nothing here is dropped.
    case "soft_circled":
      return isSoftCircledStage(stage);
    case "declined":
      return stage === "declined";
    case "expired":
      return stage === "expired" || stage === "revoked";
  }
}

const TAB_LABELS: { key: TabFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Active" },
  { key: "soft_circled", label: "Soft-circle" },
  { key: "declined", label: "Declined" },
  { key: "expired", label: "Expired" },
];

export default function Invitations() {
  useRealtimeSync();
  const queryClient = useQueryClient();
  // DEF-050: staleTime prevents flash-of-skeleton on every mount
  const inv = useQuery<Inv[]>({ queryKey: ["/api/investor/invitations"], staleTime: 30_000 });
  const [activeTab, setActiveTab] = useState<TabFilter>("all");

  // SPINE-0 (Wave 2): read the canonical ladder-attached invitations from the
  // spine. Every count and filter below is derived from spine buckets — this
  // surface no longer re-buckets raw `state` locally.
  const spine = useInvestorSpine();
  const spineInvs = spine.allInvitations;

  // The card renderer still wants the enriched Inv rows. Build a stage lookup
  // from the spine keyed by id so grouping stays spine-authoritative while the
  // card keeps its rich fields.
  const stageById = useMemo(() => {
    const m = new Map<string, NormalizedStage>();
    for (const si of spineInvs) m.set(si.id, si.stage);
    return m;
  }, [spineInvs]);

  const allData = inv.data ?? [];

  // B2 / Wave 2: counts derived from spine buckets (NOT exact `state === key`).
  // FIX #3: "pending" (label "Active") counts EXACTLY invited+viewed+accepted,
  // identical to spine.pendingInvitations that the Dashboard badge reads.
  const tabCounts = useMemo<Record<TabFilter, number>>(() => {
    return {
      all: spineInvs.length,
      pending: spineInvs.filter((si) => matchesTab("pending", si.stage)).length,
      soft_circled: spineInvs.filter((si) => matchesTab("soft_circled", si.stage)).length,
      declined: spineInvs.filter((si) => matchesTab("declined", si.stage)).length,
      expired: spineInvs.filter((si) => matchesTab("expired", si.stage)).length,
    };
  }, [spineInvs]);

  const filtered =
    activeTab === "all"
      ? allData
      : allData.filter((i) => {
          const stage = stageById.get(i.id);
          // Fail-closed: if the spine hasn't attached a stage for this row yet
          // (e.g. mid-hydration), normalize its own state via the same bucket
          // predicate would still be spine-consistent, but during the gap we
          // simply hide it rather than mis-bucket.
          return stage !== undefined && matchesTab(activeTab, stage);
        });

  // DEF-050: removed the blanket invalidateQueries on every mount (was causing flicker).
  // The realtimeSync.ts already maps "invitation" aggregate → "/api/investor/invitations".
  // SSE events keep this fresh; staleTime handles navigating back.

  return (
    <>
      <PageHeader
        title="Round invitations"
        description="Companies have invited you onto their cap table. Soft-circle to indicate interest or decline politely."
        breadcrumbs={[{ href: "/investor/dashboard", label: "Workspace" }, { label: "Invitations" }]}
      />
      <PageBody>
        {/* B2: Tab filter bar with live count badges */}
        <div className="flex items-center gap-1 mb-4 border-b border-border pb-2">
          {TAB_LABELS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setActiveTab(t.key);
                // Sprint 23 Wave B: re-fire query on every tab click (including "all" re-click) so count stays fresh.
                queryClient.invalidateQueries({ queryKey: ["/api/investor/invitations"] });
              }}
              data-testid={`tab-inv-${t.key}`}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors flex items-center gap-1.5 ${
                activeTab === t.key
                  ? "bg-primary text-primary-foreground font-medium"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {/* Pill-style count badge */}
              <span
                data-testid={`tab-count-${t.key}`}
                className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-medium ${
                  activeTab === t.key
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {tabCounts[t.key]}
              </span>
            </button>
          ))}
        </div>

        <div className="grid gap-3">
          {/* Loading skeleton */}
          {inv.isLoading && (
            <>
              <Skeleton className="h-40 w-full rounded-lg" />
              <Skeleton className="h-40 w-full rounded-lg" />
            </>
          )}
          {/* Cards */}
          {!inv.isLoading && filtered.map((i) => <InvitationCard key={i.id} inv={i} />)}
          {/* Empty state */}
          {!inv.isLoading && filtered.length === 0 && (
            <div className="text-sm text-muted-foreground py-12 text-center">
              {activeTab === "all"
                ? "No invitations yet. Apply to the Capavate Collective to discover deals."
                : `No ${activeTab.replace("_", "-")} invitations.`}
            </div>
          )}
        </div>
      </PageBody>
    </>
  );
}

function InvitationCard({ inv: i }: { inv: Inv }) {
  const intel = useQuery<MaIntelligence>({ queryKey: ["/api/investor/ma/intelligence", i.company.id] });
  const pct = (i.raisedAmount / i.targetAmount) * 100;
  // Sprint 20 fix: pro-rata based on minTicket OR backend flag — not pct condition
  const proRata = i.hasProRata === true || i.minTicket >= 250_000;
  const days = Math.max(0, Math.floor((new Date(i.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  const maHigh = (intel.data?.acquirerFitScore ?? 0) >= 65;
  // Sprint 20 fix: use description from API response, not hardcoded map
  const description = i.company.description ?? "No description available.";

  return (
    <Card data-testid={`card-inv-${i.id}`}>
      <CardContent className="p-5">
        <div className="flex flex-col md:flex-row md:items-start gap-5">
          {/* Logo */}
          <div className="h-12 w-12 rounded-md bg-[hsl(219_45%_20%)] text-white flex items-center justify-center text-sm font-semibold shrink-0">
            {i.company.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
          </div>

          <div className="flex-1 min-w-0">
            {/* Title row with chips */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold">{i.company.name}</h3>
              <StateBadge state={i.state} />
              <Badge variant="outline" className="text-[10px] capitalize" data-testid={`chip-stage-${i.id}`}>{i.round.type.replace("_", " ")}</Badge>
              <Badge variant="outline" className="text-[10px]" data-testid={`chip-sector-${i.id}`}>{i.company.sector}</Badge>
              {proRata && <Badge variant="outline" className="text-[10px] bg-[hsl(0_100%_40%)]/10 text-[hsl(0_100%_40%)] border-[hsl(0_100%_40%)]/40" data-testid={`chip-prorata-${i.id}`}><Users className="h-3 w-3 mr-1" />Pro-rata</Badge>}
              {maHigh && <Badge variant="outline" className="text-[10px] bg-[hsl(7_61%_43%)]/10 text-[hsl(7_61%_43%)] border-[hsl(7_61%_43%)]/40" data-testid={`chip-ma-${i.id}`}><AlertTriangle className="h-3 w-3 mr-1" />M&amp;A signal</Badge>}
            </div>

            {/* Subline */}
            <div className="text-sm text-muted-foreground">{i.round.name}</div>

            {/* Company description (from API, not hardcoded map) */}
            <div className="grid md:grid-cols-2 gap-2 mt-3 text-sm">
              <div className="flex items-start gap-1.5">
                <Check className="h-3.5 w-3.5 text-[hsl(0_100%_40%)] mt-1 shrink-0" />
                <div data-testid={`text-bio-${i.id}`}>
                  <span className="text-muted-foreground">About — </span>{description}
                </div>
              </div>
              <div className="flex items-start gap-1.5">
                <Activity className="h-3.5 w-3.5 text-[hsl(0_100%_40%)] mt-1 shrink-0" />
                <div data-testid={`text-traction-${i.id}`}>
                  <span className="text-muted-foreground">Traction — </span>Details inside the deal room.
                </div>
              </div>
            </div>

            {/* Soft-circle countdown */}
            <div className="mt-4">
              <div className="flex items-baseline justify-between text-sm mb-1">
                <div>
                  <span className="font-semibold">{fmtUSD(i.raisedAmount, { compact: true })}</span>
                  <span className="text-muted-foreground"> soft-circled of {fmtUSD(i.targetAmount, { compact: true })}</span>
                </div>
                <div className="text-xs text-muted-foreground">{fmtPct(pct, 0)}</div>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-[hsl(0_100%_40%)]" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground mt-1.5">
                <span>Min ticket {fmtUSD(i.minTicket, { compact: true })} · pre-money {fmtUSD(i.preMoney, { compact: true })}</span>
                <span data-testid={`text-countdown-${i.id}`}>
                  {days > 0 ? <>Closes in <span className="text-foreground font-medium">{days} day{days === 1 ? "" : "s"}</span> · {fmtDate(i.expiresAt)}</>
                            : <span className="text-[hsl(7_61%_43%)] font-medium">Window closed</span>}
                </span>
              </div>
            </div>
          </div>

          {/* CTA column — B1: "Review Deal and Soft-Circle" primary button.
              W3 Shadie 7a — the label was clipped ("eview Deal and Soft-Circle"):
              the fixed md:w-52 column + the Button's default whitespace-nowrap +
              trailing arrow overflowed and hid the leading "R". Fix: widen the
              column, allow the label to wrap (whitespace-normal), let the button
              grow to fit (h-auto + vertical padding), shrink the text a touch,
              and keep the icon from pushing the text off-canvas. */}
          <div className="md:w-60 flex flex-col gap-2 shrink-0">
            <Link href={`/investor/invitations/${i.id}`}>
              <Button className="w-full h-auto min-h-9 py-2 whitespace-normal text-center text-sm leading-snug bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid={`button-open-${i.id}`}>
                <span className="inline-flex items-center justify-center gap-1.5">Review Deal and Soft-Circle <ArrowRight className="h-4 w-4 shrink-0" /></span>
              </Button>
            </Link>
            <Link href={`/investor/invitations/${i.id}?tab=decision`}>
              <Button variant="outline" className="w-full" data-testid={`button-decide-${i.id}`}>Decline</Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
