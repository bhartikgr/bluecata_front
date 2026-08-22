/**
 * WAVE 24 · ITEM 2 — EN-3's ADMIN HALF: manual investor identity linkage.
 *
 * FINAL REVIEW B (R-1) pinned three endpoints in
 * `server/lib/reportingEngineRoutes.ts` with zero UI callers:
 *   · `GET  /api/admin/investor-aliases`                     (:666)
 *   · `POST /api/admin/investor-aliases`                     (:674)
 *   · `POST /api/admin/investor-aliases/:aliasInvestorId/revoke` (:689)
 *
 * VERIFIED AT SOURCE before building: the LP SELF-CLAIM half IS wired
 * (`/api/me/investor-identity` + `/claim`, reportingEngineRoutes.ts:604/626).
 * The ADMIN half is not, and the two are not interchangeable — self-claim
 * derives the alias id from the CALLER'S OWN session email and can only ever
 * link a user to themselves. When an LP's ledger rows sit under a synthetic id
 * derived from an email they no longer control, or under a spelling that never
 * matched, nobody but an admin can link it, and there was no screen to do so.
 * This is a genuine orphan, not a duplicate of the self-serve path.
 *
 * THE SINK (Rule 2). `investor_identity_alias`, written by exactly two store
 * functions — `claimAlias()` and `revokeAlias()`
 * (`server/lib/investorIdentityAliasStore.ts`) — reached from this panel only
 * through the two admin routes above. The SECOND path to the same sink is
 * `selfClaimByEmail()`, the LP route; it is deliberately left alone. The
 * difference is recorded IN THE DATA: the admin route hardcodes
 * `basis: "admin_manual"` (reportingEngineRoutes.ts:680) and stamps the acting
 * admin, so an operator-made link and a self-made link are distinguishable
 * forever. This panel renders `basis` for exactly that reason.
 *
 * WHAT THE LINK ACTUALLY DOES, stated on screen: it widens
 * `resolveInvestorIdSet()`, so ledger, roster and cash-flow rows recorded under
 * the alias id start resolving to the canonical user. That is a consequential
 * act on an investor-facing surface, so revocation requires a reason and the
 * reason is displayed with the revoked row.
 *
 * NO MONEY is displayed on this panel, so there is nothing here to format or
 * to sum — noted explicitly so a later reader does not add a total.
 *
 * FAIL-CLOSED (Rule 5). `LoadFailedRefusal` on read failure; the empty state is
 * gated on `isSuccess`, never on `!isLoading && !isError`.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterChip } from "@/components/ui/filter-chip";
import { Link2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { LoadFailedRefusal } from "@/components/LoadFailedRefusal";

/* `InvestorAlias` — server/lib/investorIdentityAliasStore.ts, mirrored field
   for field. `basis` and `state` unions copied from :37-38. */
type AliasRow = {
  id: string;
  tenantId: string;
  aliasInvestorId: string;
  canonicalUserId: string;
  matchEmail: string | null;
  basis: "email_verified" | "admin_manual" | "partner_manual" | "import";
  state: "active" | "revoked";
  verifiedBy: string | null;
  verifiedAt: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type AliasesResponse = { ok: boolean; aliases: AliasRow[]; total: number };

const MIN_REVOKE_REASON = 10;

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function InvestorAliasAdminPanel() {
  const { toast } = useToast();
  const [stateFilter, setStateFilter] = useState<"active" | "revoked" | "all">("active");
  const [aliasInvestorId, setAliasInvestorId] = useState("");
  const [canonicalUserId, setCanonicalUserId] = useState("");
  const [matchEmail, setMatchEmail] = useState("");
  const [revokeFor, setRevokeFor] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const q = useQuery<AliasesResponse>({
    queryKey: ["/api/admin/investor-aliases", stateFilter],
    queryFn: async () => {
      const qs = stateFilter === "all" ? "" : `?state=${encodeURIComponent(stateFilter)}`;
      return (await apiRequest("GET", `/api/admin/investor-aliases${qs}`)).json();
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/investor-aliases"] });
    /* An alias widens the resolved id set, so an LP's own identity view is
       stale the moment this succeeds. */
    queryClient.invalidateQueries({ queryKey: ["/api/me/investor-identity"] });
  };

  const linkMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/investor-aliases", {
        aliasInvestorId: aliasInvestorId.trim(),
        canonicalUserId: canonicalUserId.trim(),
        matchEmail: matchEmail.trim() === "" ? null : matchEmail.trim(),
      });
      return (await res.json()) as { ok?: boolean; error?: string; message?: string };
    },
    onSuccess: (d) => {
      if (!d?.ok) {
        toast({ title: "Link refused", description: d?.message ?? d?.error ?? "The server refused this linkage.", variant: "destructive" });
        return;
      }
      setAliasInvestorId("");
      setCanonicalUserId("");
      setMatchEmail("");
      invalidate();
      toast({ title: "Identity linked" });
    },
    onError: (e: unknown) =>
      toast({ title: "Could not link the identity", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const revokeMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/investor-aliases/${encodeURIComponent(id)}/revoke`, {
        reason: revokeReason.trim(),
      });
      return (await res.json()) as { ok?: boolean; error?: string; message?: string };
    },
    onSuccess: (d) => {
      if (!d?.ok) {
        toast({ title: "Revoke refused", description: d?.message ?? d?.error ?? "The server refused this revocation.", variant: "destructive" });
        return;
      }
      setRevokeFor(null);
      setRevokeReason("");
      invalidate();
      toast({ title: "Alias revoked" });
    },
    onError: (e: unknown) =>
      toast({ title: "Could not revoke the alias", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const rows = q.data?.aliases ?? [];
  const canLink = aliasInvestorId.trim() !== "" && canonicalUserId.trim() !== "";
  const revokeBlocked = revokeReason.trim().length < MIN_REVOKE_REASON;

  return (
    <Card className="mt-4" data-testid="card-investor-alias-admin">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4" /> Investor identity aliases
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <span className="block text-xs text-muted-foreground" data-testid="text-alias-explainer">
          Linking an alias widens the set of investor ids that resolve to one canonical user, so ledger, roster
          and cash-flow rows recorded under the alias start appearing as that user&rsquo;s. Links made here are
          recorded with basis <span className="font-mono">admin_manual</span> and the acting admin, so an
          operator-made link is never mistaken for one an LP made for themselves.
        </span>

        {/* ── manual linkage ── */}
        <div className="grid items-end gap-3 md:grid-cols-4">
          <div>
            <Label className="text-xs">Alias investor id</Label>
            <Input value={aliasInvestorId} onChange={(e) => setAliasInvestorId(e.target.value)} data-testid="input-alias-investor-id" />
          </div>
          <div>
            <Label className="text-xs">Canonical user id</Label>
            <Input value={canonicalUserId} onChange={(e) => setCanonicalUserId(e.target.value)} data-testid="input-alias-canonical-user-id" />
          </div>
          <div>
            <Label className="text-xs">Match email (optional)</Label>
            <Input value={matchEmail} onChange={(e) => setMatchEmail(e.target.value)} data-testid="input-alias-match-email" />
          </div>
          <div>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!canLink || linkMut.isPending}
              onClick={() => linkMut.mutate()}
              data-testid="button-link-alias"
            >
              {linkMut.isPending ? "Linking…" : "Link identity"}
            </Button>
          </div>
        </div>

        {/* ── the roster ── */}
        <div className="flex flex-wrap gap-2" role="tablist" data-testid="alias-state-filters">
          <FilterChip active={stateFilter === "active"} onClick={() => setStateFilter("active")} data-testid="filter-aliases-active">Active</FilterChip>
          <FilterChip active={stateFilter === "revoked"} onClick={() => setStateFilter("revoked")} data-testid="filter-aliases-revoked">Revoked</FilterChip>
          <FilterChip active={stateFilter === "all"} onClick={() => setStateFilter("all")} data-testid="filter-aliases-all">All</FilterChip>
        </div>

        {q.isError ? (
          <LoadFailedRefusal
            what="the investor alias roster"
            onRetry={() => q.refetch()}
            isRetrying={q.isFetching}
            testId="investor-aliases-load-failed"
          />
        ) : !q.isSuccess ? (
          <span className="block text-xs text-muted-foreground" data-testid="text-aliases-loading">Loading aliases…</span>
        ) : rows.length === 0 ? (
          <span className="block text-xs text-muted-foreground" data-testid="text-aliases-empty">
            {stateFilter === "all" ? "No investor aliases are recorded." : `No ${stateFilter} investor aliases are recorded.`}
          </span>
        ) : (
          <ul className="divide-y" data-testid="list-investor-aliases">
            {rows.map((a) => (
              <li key={a.id} className="py-2" data-testid={`row-investor-alias-${a.aliasInvestorId}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="block font-mono text-xs" data-testid={`alias-ids-${a.aliasInvestorId}`}>
                      {`${a.aliasInvestorId} → ${a.canonicalUserId}`}
                    </span>
                    <span className="block text-[11px] text-muted-foreground" data-testid={`alias-provenance-${a.aliasInvestorId}`}>
                      {`basis ${a.basis} · created by ${a.createdBy} at ${fmtWhen(a.createdAt)}${a.matchEmail ? ` · matched ${a.matchEmail}` : ""}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* WAVE 101 - active alias chip was brand red. Colour only. */}
                    <Badge variant={a.state === "active" ? "positive" : "outline"} data-testid={`alias-state-${a.aliasInvestorId}`}>
                      {a.state}
                    </Badge>
                    {a.state === "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setRevokeFor(a.aliasInvestorId);
                          setRevokeReason("");
                        }}
                        data-testid={`button-revoke-alias-${a.aliasInvestorId}`}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>

                {a.state === "revoked" && (
                  <span className="mt-1 block text-[11px] text-muted-foreground" data-testid={`alias-revoked-detail-${a.aliasInvestorId}`}>
                    {a.revokeReason
                      ? `Revoked by ${a.revokedBy ?? "unknown"} at ${fmtWhen(a.revokedAt)} — ${a.revokeReason}`
                      : `Revoked by ${a.revokedBy ?? "unknown"} at ${fmtWhen(a.revokedAt)} — no reason was recorded.`}
                  </span>
                )}

                {revokeFor === a.aliasInvestorId && (
                  <div className="mt-2 space-y-2 border-t pt-2" data-testid={`revoke-form-${a.aliasInvestorId}`}>
                    <Label className="text-xs" htmlFor={`revoke-reason-${a.aliasInvestorId}`}>
                      Reason for revoking (required)
                    </Label>
                    <Input
                      id={`revoke-reason-${a.aliasInvestorId}`}
                      value={revokeReason}
                      onChange={(e) => setRevokeReason(e.target.value)}
                      data-testid={`input-revoke-reason-${a.aliasInvestorId}`}
                    />
                    <span className="block text-[11px] text-muted-foreground" data-testid={`revoke-hint-${a.aliasInvestorId}`}>
                      {revokeBlocked
                        ? `Un-linking an identity changes which rows an LP can see. Record at least ${MIN_REVOKE_REASON} characters of why.`
                        : "This reason is stored on the alias and shown beside it from now on."}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        disabled={revokeBlocked || revokeMut.isPending}
                        onClick={() => revokeMut.mutate(a.aliasInvestorId)}
                        data-testid={`button-confirm-revoke-${a.aliasInvestorId}`}
                      >
                        {revokeMut.isPending ? "Revoking…" : "Confirm revoke"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setRevokeFor(null)}
                        data-testid={`button-cancel-revoke-${a.aliasInvestorId}`}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default InvestorAliasAdminPanel;
