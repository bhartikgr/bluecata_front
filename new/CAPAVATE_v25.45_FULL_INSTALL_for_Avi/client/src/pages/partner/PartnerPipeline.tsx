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

const STAGES = ["sourcing", "qualifying", "committee", "committed", "closed_won", "closed_lost"] as const;
type Stage = typeof STAGES[number];

interface Deal { id: string; dealName: string; stage: Stage; estCheckSizeMinor: number | null; currency: string | null; ownerUserId: string; sector: string | null; companyId?: string | null }

interface Promotion {
  id: string;
  pipelineDealId: string;
  promotionType: "collective_deal_room" | "capavate_referral";
  status: "pending" | "live" | "withdrawn" | "rejected";
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
  const [name, setName] = useState("");
  const canWrite = role.identity && ["managing_partner", "associate", "bd"].includes(role.identity.subRole);
  const canPromote = role.identity && ["managing_partner", "associate"].includes(role.identity.subRole);

  // Promote/Refer modal state
  const [promoteDeal, setPromoteDeal] = useState<Deal | null>(null);
  const [referDeal, setReferDeal] = useState<Deal | null>(null);
  const [modalNotes, setModalNotes] = useState("");
  const [referEmail, setReferEmail] = useState("");

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

  if (!role.ready || !role.identity) return null;
  const byStage: Record<Stage, Deal[]> = { sourcing: [], qualifying: [], committee: [], committed: [], closed_won: [], closed_lost: [] };
  for (const d of q.data?.pipeline ?? []) byStage[d.stage].push(d);

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
      {canWrite && (
        <div className="flex gap-2 mb-4" data-testid="add-deal-bar">
          <Input
            data-testid="deal-name-input"
            placeholder="New deal name"
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
            {createMut.isPending ? "Adding…" : "Add deal"}
          </Button>
        </div>
      )}
      {showLoading && (
        <div className="text-sm text-slate-500" data-testid="pipeline-loading">Loading…</div>
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
          title="No deals yet"
          description={canWrite ? "Add your first deal above to start tracking your pipeline." : "No deals have been added to this workspace yet."}
        />
      )}
      {!showLoading && !showError && !showEmpty && (
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3" data-testid="pipeline-kanban">
        {STAGES.map((s) => (
          <div key={s} className="bg-white rounded-lg border p-2 min-h-[120px]" data-testid={`column-${s}`}>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">{s.replace("_", " ")} ({byStage[s].length})</div>
            <div className="space-y-2">
              {byStage[s].map((d) => {
                const promos = promosByDeal.get(d.id) ?? [];
                const liveCollective = promos.find((p) => p.promotionType === "collective_deal_room" && p.status === "live");
                const pendingRefer = promos.find((p) => p.promotionType === "capavate_referral" && (p.status === "pending" || p.status === "live"));
                return (
                  <div key={d.id} className="border rounded p-2 text-xs bg-slate-50" data-testid={`deal-${d.id}`}>
                    <div className="font-medium">{d.dealName}</div>
                    <div className="text-slate-500">{d.sector ?? "—"}</div>
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
                    {canPromote && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {!liveCollective && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2"
                            data-testid={`promote-btn-${d.id}`}
                            onClick={() => { setPromoteDeal(d); setModalNotes(""); }}
                          >Promote</Button>
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
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      )}

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
            <div className="text-xs text-slate-600">Deal: <span className="font-medium">{promoteDeal?.dealName}</span></div>
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
            <div className="text-xs text-slate-600">Deal: <span className="font-medium">{referDeal?.dealName}</span></div>
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
    </PartnerShell>
  );
}
