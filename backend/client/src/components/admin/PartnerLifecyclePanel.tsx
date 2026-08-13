/**
 * WAVE 7 AD-1 / AD-2 — admin partner lifecycle controls.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * `server/partnerRoutes.ts` has carried these admin endpoints for several
 * releases with NO caller anywhere in `client/src`:
 *
 *   POST   /api/admin/partners/:id/promote-tier          (partnerRoutes.ts:410)
 *   POST   /api/admin/partners/:id/suspend               (partnerRoutes.ts:434)
 *   POST   /api/admin/partners/:id/reactivate            (partnerRoutes.ts:459)
 *   POST   /api/admin/partners/:id/archive               (partnerRoutes.ts:478)
 *   POST   /api/admin/partners/:id/attributions          (partnerRoutes.ts:592)
 *   DELETE /api/admin/partners/:id/attributions/:companyId (partnerRoutes.ts:628)
 *
 * Every one of those line numbers was re-read in the tree before this panel was
 * written. The only string match for "promote-tier" in the client was a HINT
 * STRING in AdminFeesConsolidated.tsx:1000 telling the admin the action happens
 * "from the partner detail page" — a page that did not have it. That is the
 * project's recurring failure shape exactly: the engine exists, the copy claims
 * the surface exists, and the surface does not.
 *
 * SINK, NAMED PER ACTION
 * ----------------------
 * promote-tier  → updateContact(..., { tier }) → contacts table
 * suspend       → updateContact(..., { status: "suspended" }) → contacts
 * reactivate    → updateContact(..., { status: "active" })    → contacts
 * archive       → updateContact(..., { status: "archived" })  → contacts
 * attributions  → partnerAttributionStore → partner_attributions (+ the
 *                 hash-chained partner_attribution_revisions companion)
 *
 * SECOND PATH: the partner's own status is also readable from
 * useRequirePartnerRole on the partner side, but that is a READ. The only other
 * writer of contact.status for a consortium partner is the consortium
 * application approval flow, which creates the contact; it never transitions an
 * existing one. So these four buttons are the sole post-creation status writer.
 *
 * AD-2 specifically: the DELETE takes `:companyId` as a SECOND path parameter.
 * The delete button below builds the URL with both segments and encodes each,
 * which is the call site AD-2 says was missing.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, Link2, TrendingUp, Users } from "lucide-react";

/** The canonical 5-tier ladder, mirroring partnerRoutes.ts:412 exactly. */
const PARTNER_TIERS = [
  "catalyst",
  "builder",
  "amplifier",
  "nexus",
  "founding_member",
] as const;

/** ATTRIBUTION_SOURCES from partnerWorkspaceStore.ts:1584 (also the 0114 CHECK). */
const ATTRIBUTION_SOURCES = [
  "admin_manual",
  "referral_code",
  "partner_claim",
  "partner_portfolio",
] as const;

type AttributionRow = {
  companyId: string;
  companyName: string | null;
  attributionSource: string;
  notes: string | null;
  attributedAt: string | null;
  revokedAt: string | null;
};

type SeatReport = {
  activeSeats?: number;
  seatLimit?: number | null;
  pendingInvites?: number;
};

export function PartnerLifecyclePanel({
  partnerId,
  status,
  tier,
}: {
  partnerId: string;
  status: string | null | undefined;
  tier: string | null | undefined;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [nextTier, setNextTier] = useState<string>("");
  const [rationale, setRationale] = useState("");
  const [attrCompanyId, setAttrCompanyId] = useState("");
  const [attrSource, setAttrSource] = useState<string>("admin_manual");
  const [attrNotes, setAttrNotes] = useState("");

  /* AD-1 — seat report for THIS partner. Same store method as the all-partner
     roster report at partnerRoutes.ts:207, so the two cannot disagree. */
  const seatQ = useQuery<SeatReport & { ok: boolean }>({
    queryKey: [`/api/admin/partners/${partnerId}/seat-report`],
    enabled: !!partnerId,
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/partners/${partnerId}/seat-report`)).json(),
  });

  /* AD-1 / AD-2 — the attribution roster, revoked rows included. */
  const attrQ = useQuery<{ ok: boolean; attributions: AttributionRow[] }>({
    queryKey: [`/api/admin/partners/${partnerId}/attributions`],
    enabled: !!partnerId,
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/partners/${partnerId}/attributions`)).json(),
  });

  /* Every lifecycle write invalidates the partner detail read as well as its
     own list, so the status Badge at the top of the page cannot keep showing
     the pre-action value. */
  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: [`/api/admin/partners/${partnerId}`] });
    qc.invalidateQueries({ queryKey: [`/api/admin/partners/${partnerId}/attributions`] });
    qc.invalidateQueries({ queryKey: [`/api/admin/partners/${partnerId}/seat-report`] });
    qc.invalidateQueries({ queryKey: ["/api/admin/partners"] });
  };

  const promote = useMutation({
    mutationFn: async () => {
      if (!nextTier) throw new Error("Choose a tier");
      return (
        await apiRequest("POST", `/api/admin/partners/${partnerId}/promote-tier`, {
          tier: nextTier,
          rationale: rationale.trim() || undefined,
        })
      ).json();
    },
    onSuccess: () => {
      setRationale("");
      refreshAll();
      toast({ title: "Tier updated", description: `Partner is now on ${nextTier}.` });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Tier change failed", description: e.message }),
  });

  /* suspend / reactivate / archive share one mutation because they share one
     sink (updateContact → contacts.status). One writer, one invalidation. */
  const statusMut = useMutation({
    mutationFn: async (action: "suspend" | "reactivate" | "archive") =>
      (await apiRequest("POST", `/api/admin/partners/${partnerId}/${action}`, {})).json(),
    onSuccess: (_d, action) => {
      refreshAll();
      toast({ title: `Partner ${action}d` });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Status change failed", description: e.message }),
  });

  const addAttribution = useMutation({
    mutationFn: async () => {
      if (!attrCompanyId.trim()) throw new Error("Company ID is required");
      return (
        await apiRequest("POST", `/api/admin/partners/${partnerId}/attributions`, {
          companyId: attrCompanyId.trim(),
          source: attrSource,
          notes: attrNotes.trim() || undefined,
        })
      ).json();
    },
    onSuccess: () => {
      setAttrCompanyId("");
      setAttrNotes("");
      refreshAll();
      toast({ title: "Attribution added" });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not attribute", description: e.message }),
  });

  /* AD-2 — the missing call site. Both `:id` and `:companyId` are supplied and
     both are encoded; a call that omitted the second segment would hit
     POST/GET on the collection path instead and silently do nothing. */
  const removeAttribution = useMutation({
    mutationFn: async (companyId: string) =>
      (
        await apiRequest(
          "DELETE",
          `/api/admin/partners/${encodeURIComponent(partnerId)}/attributions/${encodeURIComponent(companyId)}`,
        )
      ).json(),
    onSuccess: () => {
      refreshAll();
      toast({ title: "Attribution revoked" });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not revoke", description: e.message }),
  });

  const seat = seatQ.data;
  const rows = attrQ.data?.attributions ?? [];

  return (
    <Card className="p-5 mb-6" data-testid="admin-partner-lifecycle">
      <div className="flex items-center gap-2 mb-4">
        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">Lifecycle &amp; attributions</h3>
        <Badge variant="outline" className="ml-auto text-[10px]">
          {status ?? "unknown"}
        </Badge>
      </div>

      {/* ── Seat report (AD-1) ─────────────────────────────────── */}
      <div className="flex items-center gap-4 mb-5 text-sm" data-testid="admin-partner-seat-report">
        <Users className="h-4 w-4 text-muted-foreground" />
        {seatQ.isPending ? (
          <span className="text-muted-foreground">Loading seats…</span>
        ) : seatQ.isError ? (
          <span className="text-destructive">Seat report unavailable.</span>
        ) : (
          <>
            <span>
              <strong data-testid="seat-active">{seat?.activeSeats ?? 0}</strong> active seats
            </span>
            <span className="text-muted-foreground">
              limit {seat?.seatLimit ?? "—"} · {seat?.pendingInvites ?? 0} pending invites
            </span>
          </>
        )}
      </div>

      {/* ── Tier promotion (AD-1) ──────────────────────────────── */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium uppercase text-muted-foreground">
            Tier — currently {tier ?? "unassigned"}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={nextTier} onValueChange={setNextTier}>
            <SelectTrigger className="w-52" data-testid="select-promote-tier">
              <SelectValue placeholder="Move to tier…" />
            </SelectTrigger>
            <SelectContent>
              {PARTNER_TIERS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Rationale (recorded in the audit trail)"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            className="max-w-sm"
            data-testid="input-promote-rationale"
          />
          <Button
            size="sm"
            disabled={!nextTier || promote.isPending}
            onClick={() => promote.mutate()}
            data-testid="button-promote-tier"
          >
            Apply tier
          </Button>
        </div>
      </div>

      {/* ── Status actions (AD-1) ──────────────────────────────── */}
      <div className="flex gap-2 flex-wrap mb-6">
        <Button
          size="sm"
          variant="outline"
          disabled={statusMut.isPending || status === "suspended"}
          onClick={() => {
            if (window.confirm("Suspend this partner? Their workspace becomes read-only."))
              statusMut.mutate("suspend");
          }}
          data-testid="button-partner-suspend"
        >
          Suspend
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={statusMut.isPending || status === "active"}
          onClick={() => statusMut.mutate("reactivate")}
          data-testid="button-partner-reactivate"
        >
          Reactivate
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={statusMut.isPending || status === "archived"}
          onClick={() => {
            if (window.confirm("Archive this partner? Their records are retained."))
              statusMut.mutate("archive");
          }}
          data-testid="button-partner-archive"
        >
          Archive
        </Button>
      </div>

      {/* ── Attributions (AD-1 add / AD-2 delete) ──────────────── */}
      <div className="flex items-center gap-2 mb-2">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium uppercase text-muted-foreground">
          Attributed companies ({rows.filter((r) => !r.revokedAt).length})
        </span>
      </div>

      <div className="flex gap-2 flex-wrap items-center mb-3">
        <Input
          placeholder="Company ID"
          value={attrCompanyId}
          onChange={(e) => setAttrCompanyId(e.target.value)}
          className="max-w-xs"
          data-testid="input-attribution-company"
        />
        <Select value={attrSource} onValueChange={setAttrSource}>
          <SelectTrigger className="w-44" data-testid="select-attribution-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ATTRIBUTION_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Notes"
          value={attrNotes}
          onChange={(e) => setAttrNotes(e.target.value)}
          className="max-w-xs"
          data-testid="input-attribution-notes"
        />
        <Button
          size="sm"
          disabled={!attrCompanyId.trim() || addAttribution.isPending}
          onClick={() => addAttribution.mutate()}
          data-testid="button-attribution-add"
        >
          Attribute
        </Button>
      </div>

      {attrQ.isPending && (
        <p className="text-sm text-muted-foreground">Loading attributions…</p>
      )}
      {attrQ.isError && (
        <p className="text-sm text-destructive">Attributions unavailable.</p>
      )}
      {!attrQ.isPending && !attrQ.isError && rows.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="attributions-empty">
          No companies attributed to this partner.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="space-y-1" data-testid="attributions-list">
          {rows.map((r) => (
            <li
              key={r.companyId}
              className="flex items-center gap-3 text-sm border-b last:border-0 py-1.5"
              data-testid={`attribution-${r.companyId}`}
            >
              <span className={r.revokedAt ? "line-through text-muted-foreground" : ""}>
                {r.companyName ?? r.companyId}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {r.attributionSource}
              </Badge>
              {r.notes && (
                <span className="text-xs text-muted-foreground truncate">{r.notes}</span>
              )}
              {/* Revoked rows stay visible — nothing is dropped from the UI. */}
              {r.revokedAt ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  revoked {new Date(r.revokedAt).toLocaleDateString()}
                </span>
              ) : (
                <button
                  type="button"
                  className="ml-auto text-red-600 text-xs hover:underline disabled:opacity-50"
                  disabled={removeAttribution.isPending}
                  data-testid={`attribution-remove-${r.companyId}`}
                  onClick={() => {
                    if (window.confirm(`Revoke the attribution of ${r.companyName ?? r.companyId}?`))
                      removeAttribution.mutate(r.companyId);
                  }}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default PartnerLifecyclePanel;
