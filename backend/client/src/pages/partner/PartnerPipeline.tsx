/**
 * Pipeline — Kanban tracker. Sub-role gates server-enforced; UI hides write
 * affordances for viewer/analyst as a hint.
 *
 * NEW: Promote-to-Collective + Refer-to-Capavate actions per deal card.
 * Server-enforced as assertSubRole("managing_partner","associate"); UI
 * mirrors that gate as a hint. Conflict (409) → toast; success → toast +
 * refresh promotions query so badges appear.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { PartnerEmptyState } from "@/components/partner/PartnerShell";
import { AppCard } from "@/components/ui/app-card";
import { PartnerPortfolioProfileDialog } from "@/components/partner/PartnerPortfolioProfileDialog";
import { PartnerPipelineActivityDialog } from "@/components/partner/PartnerPipelineActivityDialog"; /* WAVE 27 · CP-PIPE-04 */
import Lock1NoticePanel from "@/components/partner/Lock1NoticePanel"; /* WAVE 33 · CP-PIPE-10 */
import { canWritePortfolioProfile } from "@shared/partnerRoles"; /* w-partner F-new2 — one source of truth with the server guard */
import {
  PARTNER_PIPELINE_STAGES,
  PARTNER_PIPELINE_STAGE_LABELS,
  PARTNER_PIPELINE_STAGE_DESCRIPTIONS,
  type PartnerPipelineStageKey,
} from "@shared/crmStages";

/* v25.50.0 Phase 2 (spec 2c, LOCKED) — canonical company deal funnel, verbatim. */
const STAGES = PARTNER_PIPELINE_STAGES;
type Stage = PartnerPipelineStageKey;

interface Deal { id: string; dealName: string; stage: Stage; estCheckSizeMinor: number | null; currency: string | null; ownerUserId: string; sector: string | null; companyId?: string | null }
interface SpvRow { id: string; name?: string | null; spvName?: string | null; status?: string | null; type?: string | null; spvType?: string | null; distributionScope?: string | null }
interface FollowRow { companyId: string; companyName: string | null; logoUrl: string | null }

/* Wave B2 (3b) — SPV lifecycle columns for the SPV process-box row (answer
   3b-5 = a: the SPV's REAL lifecycle, not the company funnel). Ordered by
   lifecycle; covers every SPV_STATUSES value so no SPV is dropped from the row. */
const SPV_LIFECYCLE_STAGES = ["draft", "open", "deployed", "distributing", "closed", "wound_down"] as const;
type SpvLifecycleStage = (typeof SPV_LIFECYCLE_STAGES)[number];
const SPV_LIFECYCLE_LABELS: Record<SpvLifecycleStage, string> = {
  draft: "Draft", open: "Open", deployed: "Deployed", distributing: "Distributing", closed: "Closed", wound_down: "Wound-down",
};
const SPV_LIFECYCLE_DESCRIPTIONS: Record<SpvLifecycleStage, string> = {
  draft: "Being set up",
  open: "Raising commitments",
  deployed: "Capital deployed",
  distributing: "Returning capital",
  closed: "Subscription closed",
  wound_down: "Fully wound down",
};
/* SPV “Publish to Collective” = collective_only scope (first-class Collective
   visibility); “Make Private” = private scope. Instant toggle (answer 3b-6 = a:
   companies use the reviewed Promote flow; SPVs keep the SPV Engine's own
   instant private/collective scope switch). */
const SPV_SCOPE_COLLECTIVE = "collective_only";
const SPV_SCOPE_PRIVATE = "private";

interface Promotion {
  id: string;
  pipelineDealId: string;
  promotionType: "collective_deal_room" | "capavate_referral";
  // v25.15 — collective_deal_room promotions are created as
  // "pending_collective_review" and only flip to "live" on chapter-admin
  // approval. Include it so the Publish/Make-Private toggle recognises a
  // company that is under review as already-published (offer Make Private).
  status: "pending" | "pending_collective_review" | "live" | "withdrawn" | "rejected";
}

export default function PartnerPipeline() {
  const role = useRequirePartnerRole();
  const { toast } = useToast();
  const q = useQuery<{ pipeline: Deal[]; stages: Stage[] }>({
    queryKey: ["/api/partner/me/pipeline"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/pipeline")).json(),
  });
  const promoQ = useQuery<{ promotions: Promotion[] }>({
    queryKey: ["/api/partner/me/promotions"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/promotions")).json(),
  });
  // v25.50.0 Phase 2 (2b) — SPVs + Following categories.
  const spvQ = useQuery<{ spvs?: SpvRow[] } | SpvRow[]>({
    queryKey: ["/api/partner/me/spv"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/spv")).json(),
  });
  const followingQ = useQuery<{ following: FollowRow[] }>({
    queryKey: ["/api/partner/me/following"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/following")).json(),
  });
  const [name, setName] = useState("");
  const canWrite = role.identity && ["managing_partner", "associate", "bd"].includes(role.identity.subRole);
  const canPromote = role.identity && ["managing_partner", "associate"].includes(role.identity.subRole);
  // Wave B2 (3b) — "Make Private" (withdraw a promotion) is managing_partner-only
  // server-side (POST /api/partner/me/promotions/:id/withdraw), so the UI gate
  // must match: associates can Publish/Refer but must NOT see Make Private.
  const canWithdrawPromotion = role.identity?.subRole === "managing_partner";
  // Stage advancement is gated identically to the PATCH endpoint (managing_partner|associate).
  const canAdvance = canPromote;
  // w-partner F-new2 — the portfolio-profile editor reads the SAME constant the
  // server guard uses, so the client predicate can never re-diverge from it.
  const canEditPortfolioProfile = canWritePortfolioProfile(role.identity?.subRole);

  // v25.50.0 Phase 2 (2c-b) — advance a deal to ANY stage (skipping allowed;
  // server validates membership-in-set, not adjacency).
  const stageMut = useMutation({
    mutationFn: async (vars: { dealId: string; stage: Stage }) => {
      const res = await apiRequest("PATCH", `/api/partner/me/pipeline/${vars.dealId}`, { stage: vars.stage });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/partner/me/pipeline"] }),
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not move deal", description: e.message }),
  });

  // Promote/Refer modal state
  const [promoteDeal, setPromoteDeal] = useState<Deal | null>(null);
  const [referDeal, setReferDeal] = useState<Deal | null>(null);
  const [modalNotes, setModalNotes] = useState("");
  const [referEmail, setReferEmail] = useState("");
  // v25.50.0 Phase 3 — Private Portfolio profile editor target (deal w/ companyId).
  const [profileDeal, setProfileDeal] = useState<Deal | null>(null);
  /* WAVE 27 · CP-PIPE-04 — deal whose activity log is open. Null = closed. */
  const [activityDeal, setActivityDeal] = useState<Deal | null>(null);

  const createMut = useMutation({
    /* v25.33 — apiRequest() throws ApiError on non-2xx, so the prior `if (!res.ok)`
     * guard here (and in the promote/refer mutations below) was unreachable dead
     * code. The thrown ApiError propagates to onError unchanged, preserving the
     * exact failure toast. Removed the dead branches across all three mutations. */
    mutationFn: async (dealName: string) => {
      const res = await apiRequest("POST", "/api/partner/me/pipeline", { dealName });
      return res.json();
    },
    /* v25.16 NH3 — only clear the deal-name input on success so a server
       error doesn't lose what the user typed. */
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/pipeline"] });
    },
    /* v25.12 NH8 — surface add-deal failures (validation, seat-limit, etc). */
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not add deal", description: e.message }),
  });

  const promoteMut = useMutation({
    mutationFn: async (vars: { dealId: string; notes: string }) => {
      const res = await apiRequest("POST", `/api/partner/me/pipeline/${vars.dealId}/promote-to-collective`, { notes: vars.notes || undefined });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Promoted to Collective Deal Room", description: "Submitted for Collective review. Visible once admin approves." });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/promotions"] });
      setPromoteDeal(null);
      setModalNotes("");
    },
    onError: (e: Error) => {
      toast({ title: "Could not promote", description: e.message, variant: "destructive" });
    },
  });

  const referMut = useMutation({
    mutationFn: async (vars: { dealId: string; notes: string; targetEmail: string }) => {
      const res = await apiRequest("POST", `/api/partner/me/pipeline/${vars.dealId}/refer-to-capavate`, {
        notes: vars.notes || undefined,
        targetEmail: vars.targetEmail || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Referred to Capavate", description: "Capavate admin will review your referral." });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/promotions"] });
      setReferDeal(null);
      setModalNotes("");
      setReferEmail("");
    },
    onError: (e: Error) => {
      toast({ title: "Could not refer", description: e.message, variant: "destructive" });
    },
  });

  // Wave B2 (3b) — "Make Private" for a COMPANY: withdraw the live/pending
  // Collective promotion (returns the card to private-portfolio-only). Reuses
  // the existing audited withdraw endpoint (managing_partner only, matching the
  // server gate). Answer 3b-7 = Yes.
  const withdrawMut = useMutation({
    mutationFn: async (vars: { promotionId: string }) => {
      const res = await apiRequest("POST", `/api/partner/me/promotions/${vars.promotionId}/withdraw`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Made private", description: "Withdrawn from the Collective. Now private-portfolio-only." });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/promotions"] });
    },
    onError: (e: Error) => {
      toast({ title: "Could not make private", description: e.message, variant: "destructive" });
    },
  });

  // Wave B2 (3b) — advance an SPV to any lifecycle status. On success the SPV
  // list is invalidated so the card automatically re-buckets into the column
  // matching its new status (mirrors the company stage dropdown behavior).
  const spvStatusMut = useMutation({
    mutationFn: async (vars: { spvId: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/partner/me/spv/${vars.spvId}`, { status: vars.status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/spv"] });
    },
    onError: (e: Error) => {
      toast({ title: "Could not update SPV status", description: e.message, variant: "destructive" });
    },
  });

  // Wave B2 (3b) — SPV private/collective visibility toggle. Instant scope flip
  // via the SPV Engine's own PATCH (answer 3b-6 = a: SPVs keep the instant
  // toggle; companies use the reviewed Promote flow). collective_only makes the
  // SPV discoverable in the Collective; private returns it to private-only.
  const spvScopeMut = useMutation({
    mutationFn: async (vars: { spvId: string; scope: string }) => {
      const res = await apiRequest("PATCH", `/api/partner/me/spv/${vars.spvId}`, { distributionScope: vars.scope });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({
        title: vars.scope === SPV_SCOPE_COLLECTIVE ? "Published to Collective" : "Made private",
        description: vars.scope === SPV_SCOPE_COLLECTIVE
          ? "Collective visibility set. The SPV becomes discoverable in the Collective once it leaves Draft."
          : "This SPV is now private-only.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/spv"] });
    },
    onError: (e: Error) => {
      toast({ title: "Could not update SPV visibility", description: e.message, variant: "destructive" });
    },
  });

  if (!role.ready || !role.identity) return null;
  const byStage: Record<Stage, Deal[]> = { invited: [], viewed: [], soft_circle: [], signed: [], funded: [], committed: [] };
  for (const d of q.data?.pipeline ?? []) { if (byStage[d.stage]) byStage[d.stage].push(d); }
  const spvList: SpvRow[] = Array.isArray(spvQ.data) ? spvQ.data : (spvQ.data?.spvs ?? []);
  // Wave B2 (3b) — bucket each SPV into its lifecycle column BY ITS status, so an
  // SPV automatically appears under the correct box; when its status changes it
  // re-buckets on the next fetch (the query is invalidated on every status /
  // scope change). An unknown/legacy status falls back to "draft" so no SPV is
  // ever dropped from the row.
  const bySpvStage: Record<SpvLifecycleStage, SpvRow[]> = { draft: [], open: [], deployed: [], distributing: [], closed: [], wound_down: [] };
  for (const s of spvList) {
    const st = (s.status ?? "draft") as SpvLifecycleStage;
    (bySpvStage[st] ?? bySpvStage.draft).push(s);
  }
  const followList: FollowRow[] = followingQ.data?.following ?? [];

  /* v25.23 NM-2 — explicit loading / error / empty states for the pipeline
     query (mirrors PartnerClients). Previously a fetch failure rendered an
     empty Kanban indistinguishable from “no deals”. promoQ errors are
     surfaced as a non-blocking notice since the board still renders. */
  const pipelineDeals = q.data?.pipeline ?? [];
  const showLoading = q.isLoading;
  const showError = q.isError;
  const showEmpty = !q.isLoading && !q.isError && pipelineDeals.length === 0;

  // Index promotions by pipeline deal id so we can render badges
  const promosByDeal = new Map<string, Promotion[]>();
  for (const p of promoQ.data?.promotions ?? []) {
    const arr = promosByDeal.get(p.pipelineDealId) ?? [];
    arr.push(p);
    promosByDeal.set(p.pipelineDealId, arr);
  }

  return (
    <PartnerShell title="Pipeline" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      {/* v25.50.0 Phase 2 (2a) — purpose copy. */}
      <AppCard className="mb-5" data-testid="pipeline-intro">
        <h2 className="partner-section-title text-lg mb-1">Your deal pipeline</h2>
        <p className="text-sm text-[var(--cv-color-text-secondary)]">
          Track every company you work with in one place — your own <strong>Private Portfolio</strong> companies,
          the <strong>SPVs</strong> you launch to syndicate deals, and the companies you’re <strong>Following</strong> as
          a Collective member. Portfolio companies and SPVs each advance through their own process rows and move
          between columns automatically as they progress — companies through Capavate’s standard company funnel
          (Invitation → Committed), and SPVs through their lifecycle (Draft → Wound-down). Publish either to the
          Collective or make it private from its card.
        </p>
      </AppCard>

      {/* ============================================================
          CATEGORY 1 — Private Portfolio (canonical funnel Kanban)
          ============================================================ */}
      <section className="mb-8" data-testid="category-private-portfolio">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="partner-section-title text-base">Private Portfolio</h3>
            <p className="text-xs text-[var(--cv-color-text-muted)]">Your own portfolio companies, tracked through Capavate’s company funnel.</p>
          </div>
        </div>
        {canWrite && (
          <div className="flex gap-2 mb-4" data-testid="add-deal-bar">
            <Input
              data-testid="deal-name-input"
              placeholder="New portfolio company"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="max-w-xs"
            />
            {/* v25.16 NL2 — disable while pending to prevent double-submit. */}
            <Button
              data-testid="add-deal-btn"
              disabled={!name || createMut.isPending}
              onClick={() => createMut.mutate(name)}
            >
              {createMut.isPending ? "Adding…" : "Add company"}
            </Button>
          </div>
        )}
        {showLoading && (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="pipeline-loading">Loading…</div>
        )}
        {showError && (
          <div
            className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
            data-testid="pipeline-error"
          >
            Could not load your pipeline. Please refresh and try again.
          </div>
        )}
        {/* Non-blocking: the board still renders even if the promotions overlay fails. */}
        {!showError && promoQ.isError && (
          <div
            className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
            data-testid="pipeline-promotions-error"
          >
            Deal promotion badges couldn’t be loaded. Deals are still shown.
          </div>
        )}
        {showEmpty && (
          <PartnerEmptyState
            title="No portfolio companies yet"
            description={canWrite ? "Add your first company above to start tracking your pipeline." : "No companies have been added to this workspace yet."}
          />
        )}
        {!showLoading && !showError && !showEmpty && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3" data-testid="pipeline-kanban">
          {STAGES.map((s) => (
            <div key={s} className="bg-white rounded-lg border p-2 min-h-[120px]" data-testid={`column-${s}`}>
              <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-secondary)] font-semibold">{PARTNER_PIPELINE_STAGE_LABELS[s]} ({byStage[s].length})</div>
              {/* v25.50.0 Phase 2 (2c-a) — per-stage description. */}
              <div className="text-[10px] leading-tight text-[var(--cv-color-text-faint)] mb-2" data-testid={`column-${s}-desc`}>{PARTNER_PIPELINE_STAGE_DESCRIPTIONS[s]}</div>
              <div className="space-y-2">
                {byStage[s].map((d) => {
                  const promos = promosByDeal.get(d.id) ?? [];
                  const liveCollective = promos.find((p) => p.promotionType === "collective_deal_room" && p.status === "live");
                  const pendingRefer = promos.find((p) => p.promotionType === "capavate_referral" && (p.status === "pending" || p.status === "live"));
                  return (
                    <div key={d.id} className="border rounded p-2 text-xs bg-[var(--cv-color-surface-2)]" data-testid={`deal-${d.id}`}>
                      <div className="font-medium">{d.dealName}</div>
                      <div className="text-[var(--cv-color-text-muted)]">{d.sector ?? "—"}</div>
                      {(liveCollective || pendingRefer) && (
                        <div className="flex flex-wrap gap-1 mt-1" data-testid={`deal-${d.id}-badges`}>
                          {liveCollective && (
                            <Badge variant="secondary" className="text-[10px] py-0" data-testid={`badge-promoted-${d.id}`}>In Deal Room</Badge>
                          )}
                          {pendingRefer && (
                            <Badge variant="outline" className="text-[10px] py-0" data-testid={`badge-referred-${d.id}`}>Referred</Badge>
                          )}
                        </div>
                      )}
                      {/* v25.50.0 Phase 2 (2c-b) — advance to ANY stage (skipping allowed). */}
                      {canAdvance && (
                        <select
                          data-testid={`stage-select-${d.id}`}
                          className="mt-2 w-full text-[10px] border rounded px-1 py-0.5 bg-white"
                          value={d.stage}
                          disabled={stageMut.isPending}
                          onChange={(e) => stageMut.mutate({ dealId: d.id, stage: e.target.value as Stage })}
                        >
                          {STAGES.map((opt) => (
                            <option key={opt} value={opt}>{PARTNER_PIPELINE_STAGE_LABELS[opt]}</option>
                          ))}
                        </select>
                      )}
                      {/* WAVE 27 · CP-PIPE-04 — read the deal's activity log. A
                          SIBLING button, not extra text inside an existing node.
                          Unconditional: every deal has a history the moment it
                          changes stage, and unlike Profile it needs no
                          `companyId`. Read-only, so it is offered to every
                          sub-role that can see the board — the append route
                          stays narrower. */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2 mt-2 w-full"
                        data-testid={`pipeline-activity-btn-${d.id}`}
                        onClick={() => setActivityDeal(d)}
                      >History</Button>
                      {/* v25.50.0 Phase 3 — open this company's private portfolio profile. */}
                      {d.companyId && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 mt-2 w-full"
                          data-testid={`portfolio-profile-btn-${d.id}`}
                          onClick={() => setProfileDeal(d)}
                        >Profile</Button>
                      )}
                      {canPromote && (() => {
                        // Wave B2 (3b) — Publish to Collective / Make Private toggle.
                        // A COMPANY publishes via the reviewed Promote flow (answer
                        // 3b-6 = a). A collective promotion that is live, pending, OR
                        // pending_collective_review (the real create status) means
                        // it is already published / under review, so we offer
                        // "Make Private" (withdraw) instead. Answer 3b-7 = Yes.
                        const collectivePromo = promos.find(
                          (p) => p.promotionType === "collective_deal_room"
                            && (p.status === "live" || p.status === "pending" || p.status === "pending_collective_review"),
                        );
                        const underReview = collectivePromo && collectivePromo.status !== "live";
                        return (
                          <div className="flex flex-wrap gap-1 mt-2" data-testid={`deal-${d.id}-visibility`}>
                            {collectivePromo ? (
                              // Make Private = withdraw (managing_partner-only, matching
                              // the server gate). Associates see a read-only status
                              // badge instead of a destructive control they can't use.
                              canWithdrawPromotion ? (
                                /* w-partner F8 — the managing_partner branch showed
                                   "Make Private" with NO state, so a managing partner
                                   could not tell an approved promotion from one still
                                   awaiting chapter-admin review. The already-computed
                                   `underReview` now renders as a badge ALONGSIDE the
                                   withdraw control (which is deliberately NOT gated on
                                   `live` — withdrawing a pending promotion is exactly
                                   what a partner needs to be able to do). */
                                <>
                                  {underReview && (
                                    <Badge variant="outline" className="text-[10px] py-0" data-testid={`promo-under-review-mp-${d.id}`}>
                                      In review
                                    </Badge>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-[10px] px-2"
                                    data-testid={`make-private-btn-${d.id}`}
                                    disabled={withdrawMut.isPending}
                                    onClick={() => withdrawMut.mutate({ promotionId: collectivePromo.id })}
                                  >Make Private</Button>
                                </>
                              ) : (
                                <Badge variant="outline" className="text-[10px] py-0" data-testid={`collective-status-${d.id}`}>
                                  {underReview ? "In review" : "In Collective"}
                                </Badge>
                              )
                            ) : d.companyId ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] px-2"
                                data-testid={`publish-collective-btn-${d.id}`}
                                onClick={() => { setPromoteDeal(d); setModalNotes(""); }}
                              >Publish to Collective</Button>
                            ) : (
                              // INVARIANT: the company must be ON CAPAVATE (cap table +
                              // rounds operating) before it can be published. A bare
                              // name-only deal has no Capavate company yet, so we point
                              // the partner to "Add Portfolio Company" first.
                              <a
                                href="/collective/partner/add-portfolio-company"
                                className="h-6 inline-flex items-center text-[10px] px-2 border rounded text-[var(--cv-color-text-muted)] hover:text-[var(--cv-color-text-secondary)]"
                                data-testid={`add-to-capavate-hint-${d.id}`}
                                title="Add this as a portfolio company on Capavate (cap table + rounds) before publishing to the Collective."
                              >Add to Capavate first</a>
                            )}
                            {!pendingRefer && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] px-2"
                                data-testid={`refer-btn-${d.id}`}
                                onClick={() => { setReferDeal(d); setModalNotes(""); setReferEmail(""); }}
                              >Refer</Button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        )}
      </section>

      {/* ============================================================
          CATEGORY 2 — SPVs  (Wave B2 3b: process-box row mirroring Row 1,
          keyed by the SPV's REAL lifecycle. Each SPV auto-appears under the
          column matching its status and moves when the status changes.)
          ============================================================ */}
      <section className="mb-8" data-testid="category-spvs">
        <div className="mb-2">
          <h3 className="partner-section-title text-base">SPVs</h3>
          <p className="text-xs text-[var(--cv-color-text-muted)]">Special-purpose vehicles you’ve created to syndicate deals, tracked through their own lifecycle. Each SPV moves between columns automatically as its status progresses.</p>
        </div>
        {spvQ.isError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900" data-testid="spv-list-error">Could not load your SPVs.</div>
        ) : spvList.length === 0 ? (
          <PartnerEmptyState title="No SPVs yet" description="Launch an SPV from the SPVs page to syndicate a deal." />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3" data-testid="spv-kanban">
            {SPV_LIFECYCLE_STAGES.map((st) => (
              <div key={st} className="bg-white rounded-lg border p-2 min-h-[120px]" data-testid={`spv-column-${st}`}>
                <div className="text-xs uppercase tracking-wide text-[var(--cv-color-text-secondary)] font-semibold">{SPV_LIFECYCLE_LABELS[st]} ({bySpvStage[st].length})</div>
                <div className="text-[10px] leading-tight text-[var(--cv-color-text-faint)] mb-2" data-testid={`spv-column-${st}-desc`}>{SPV_LIFECYCLE_DESCRIPTIONS[st]}</div>
                <div className="space-y-2">
                  {bySpvStage[st].map((s) => {
                    const isCollective = s.distributionScope === SPV_SCOPE_COLLECTIVE;
                    // Draft SPVs are EXCLUDED from Collective discovery by the SPV
                    // engine, so a draft SPV's collective_only scope is not yet
                    // actually discoverable. Gate publish on non-draft and label
                    // the badge accurately (scope set vs. actually discoverable).
                    const isDraft = (s.status ?? "draft") === "draft";
                    const liveInCollective = isCollective && !isDraft;
                    return (
                      <div key={s.id} className="border rounded p-2 text-xs bg-[var(--cv-color-surface-2)]" data-testid={`spv-card-${s.id}`}>
                        <div className="font-medium">{s.spvName ?? s.name ?? s.id}</div>
                        <div className="text-[var(--cv-color-text-muted)]">{s.spvType ?? s.type ?? "SPV"}</div>
                        {isCollective && (
                          <div className="mt-1">
                            <Badge variant="secondary" className="text-[10px] py-0" data-testid={`spv-${s.id}-collective-badge`}>
                              {liveInCollective ? "In Collective" : "Collective (on launch)"}
                            </Badge>
                          </div>
                        )}
                        {/* Inline lifecycle change — moves the SPV to the matching
                            column automatically (write roles only; server enforces). */}
                        {canWrite && (
                          <select
                            data-testid={`spv-status-select-${s.id}`}
                            className="mt-2 w-full text-[10px] border rounded px-1 py-0.5 bg-white"
                            value={(s.status ?? "draft")}
                            disabled={spvStatusMut.isPending}
                            onChange={(e) => spvStatusMut.mutate({ spvId: s.id, status: e.target.value })}
                          >
                            {SPV_LIFECYCLE_STAGES.map((opt) => (
                              <option key={opt} value={opt}>{SPV_LIFECYCLE_LABELS[opt]}</option>
                            ))}
                          </select>
                        )}
                        {/* Make Private / Publish to Collective (instant scope flip). */}
                        {canWrite && (
                          <div className="mt-2">
                            {isCollective ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] px-2 w-full"
                                data-testid={`spv-make-private-btn-${s.id}`}
                                disabled={spvScopeMut.isPending}
                                onClick={() => spvScopeMut.mutate({ spvId: s.id, scope: SPV_SCOPE_PRIVATE })}
                              >Make Private</Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] px-2 w-full"
                                data-testid={`spv-publish-btn-${s.id}`}
                                // A draft SPV is not Collective-discoverable yet;
                                // block publish with an explanatory title until it
                                // reaches a discoverable status (open+).
                                disabled={spvScopeMut.isPending || isDraft}
                                title={isDraft ? "Move the SPV out of Draft before publishing to the Collective." : undefined}
                                onClick={() => spvScopeMut.mutate({ spvId: s.id, scope: SPV_SCOPE_COLLECTIVE })}
                              >Publish to Collective</Button>
                            )}
                          </div>
                        )}
                        <a
                          href={`/collective/partner/spv-engine`}
                          className="mt-2 block text-[10px] text-center underline text-[var(--cv-color-text-muted)] hover:text-[var(--cv-color-text-secondary)]"
                          data-testid={`spv-manage-${s.id}`}
                        >Manage in SPV Engine</a>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============================================================
          CATEGORY 3 — Following from Collective
          ============================================================ */}
      <section className="mb-4" data-testid="category-following">
        <div className="mb-2">
          <h3 className="partner-section-title text-base">Following from Collective</h3>
          <p className="text-xs text-[var(--cv-color-text-muted)]">Companies you follow as a Collective member. Opening one launches the Collective view in a new tab.</p>
        </div>
        {followingQ.isError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900" data-testid="following-error">Could not load followed companies.</div>
        ) : followList.length === 0 ? (
          <PartnerEmptyState title="Not following anyone yet" description="Express interest in a company in the Collective to start following it here." />
        ) : (
          /* Wave B2 (3c) — restyled from pill chips into cards for visual
             consistency with the two process-box rows above; same click-through
             to the full Collective profile (new tab). */
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="following-list">
            {followList.map((c) => (
              <a
                key={c.companyId}
                href={`/collective/companies/${c.companyId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block border rounded-lg p-3 bg-white hover:shadow-sm"
                data-testid={`following-row-${c.companyId}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm truncate">{c.companyName ?? c.companyId}</div>
                  <span aria-hidden className="text-[var(--cv-color-text-faint)] shrink-0">↗</span>
                </div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--cv-color-text-faint)] mt-1">Following · Collective</div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Promote to Collective Modal */}
      {/* v25.16 NM2 — also clear modal notes on Escape/outside-click dismiss
         so a half-typed note doesn't bleed into the next modal opened. */}
      <Dialog open={!!promoteDeal} onOpenChange={(o) => { if (!o) { setPromoteDeal(null); setModalNotes(""); } }}>
        <DialogContent data-testid="promote-modal">
          <DialogHeader>
            <DialogTitle>Promote to Collective Deal Room</DialogTitle>
            <DialogDescription>
              This deal will be submitted for Collective admin review.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-[var(--cv-color-text-secondary)]">Deal: <span className="font-medium">{promoteDeal?.dealName}</span></div>
            <label className="text-xs font-medium">Notes (optional)</label>
            <Textarea
              data-testid="promote-notes"
              value={modalNotes}
              onChange={(e) => setModalNotes(e.target.value)}
              placeholder="Why this deal fits the Collective..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteDeal(null)}>Cancel</Button>
            <Button
              data-testid="promote-confirm"
              disabled={promoteMut.isPending}
              onClick={() => promoteDeal && promoteMut.mutate({ dealId: promoteDeal.id, notes: modalNotes })}
            >Promote</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refer to Capavate Modal */}
      <Dialog open={!!referDeal} onOpenChange={(o) => { if (!o) { setReferDeal(null); setModalNotes(""); setReferEmail(""); } }}>
        <DialogContent data-testid="refer-modal">
          <DialogHeader>
            <DialogTitle>Refer to Capavate</DialogTitle>
            <DialogDescription>
              A Capavate admin will review your referral. Status will appear here once decided.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-[var(--cv-color-text-secondary)]">Deal: <span className="font-medium">{referDeal?.dealName}</span></div>
            <label className="text-xs font-medium">Founder contact email (optional)</label>
            <Input
              data-testid="refer-email"
              value={referEmail}
              onChange={(e) => setReferEmail(e.target.value)}
              placeholder="founder@example.com"
            />
            <label className="text-xs font-medium">Notes (optional)</label>
            <Textarea
              data-testid="refer-notes"
              value={modalNotes}
              onChange={(e) => setModalNotes(e.target.value)}
              placeholder="Why Capavate should onboard this deal..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReferDeal(null)}>Cancel</Button>
            <Button
              data-testid="refer-confirm"
              disabled={referMut.isPending}
              onClick={() => referDeal && referMut.mutate({ dealId: referDeal.id, notes: modalNotes, targetEmail: referEmail })}
            >Refer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* v25.50.0 Phase 3 — Private Portfolio company profile editor */}
      {profileDeal?.companyId && (
        <PartnerPortfolioProfileDialog
          companyId={profileDeal.companyId}
          companyName={profileDeal.dealName}
          canEdit={canEditPortfolioProfile}
          open={!!profileDeal}
          onOpenChange={(o) => { if (!o) setProfileDeal(null); }}
        />
      )}

      {/* WAVE 27 · CP-PIPE-04 — the read surface for the write-only activity log. */}
      <PartnerPipelineActivityDialog
        deal={activityDeal}
        onOpenChange={(o) => { if (!o) setActivityDeal(null); }}
      />

      {/* WAVE 33 · CP-PIPE-10 — LOCK 1. APPENDED as the LAST sibling inside the
          shell, never inserted mid-list. The lock governs the provenance of
          partner-sourced soft circles, which originate on this surface, so this
          is where it is stated. Its wording is OQ-5 and ships NOT SUPPLIED; the
          panel says so explicitly rather than approximating it. */}
      <Lock1NoticePanel />
    </PartnerShell>
  );
}
