/**
 * WAVE 43 · OWNER RULING R7 — the founder's explicit, audited late-acceptance
 * surface.
 *
 * THE RULING, VERBATIM: "Go with your recommendation to enforce the close.
 * Accepting late commitments should be allowed."
 *
 * So the close is enforced on the server (`server/lib/roundCloseEnforcement.ts`
 * refuses a soft-circle against a closed round on all three money paths), and
 * this component is the ONLY way back in. It exposes the two capabilities the
 * brief names, and nothing else:
 *
 *   1. REOPEN THE ROUND — a bounded, reasoned reopening. Every commitment that
 *      arrives during it is still marked accepted-after-close.
 *   2. ACCEPT ONE SPECIFIC LATE COMMITMENT — a single-use admission for one
 *      named investor, without reopening anything for anybody else.
 *
 * THREE PROPERTIES THE BRIEF REQUIRES, AND WHERE EACH ONE LIVES:
 *
 *   · DELIBERATE — "never a side effect of viewing or a default". Nothing here
 *     fires on mount or on render. Both actions require a dialog to be opened,
 *     a free-text reason to be typed, and a confirmation checkbox to be ticked;
 *     the checkbox starts UNCHECKED and the submit button is disabled until all
 *     of it is true. The server independently rejects any request without
 *     `confirm: true` and a non-empty reason, so a scripted POST cannot skip
 *     the deliberation either.
 *
 *   · ATTRIBUTED AND AUDITED — the server records who, when, which commitment,
 *     and the deadline that was passed, in the append-only
 *     `round_late_acceptances` ledger (migration 0184). The client sends no
 *     identity: attribution is taken from the authenticated session, so it
 *     cannot be forged by the caller. This panel READS that ledger back and
 *     shows it, because an audit trail nobody can see is not an audit trail.
 *
 *   · VISIBLY MARKED — the mark is DERIVED from that ledger wherever a
 *     commitment appears (founder list, investor list, cap table), never stored
 *     as a boolean on the commitment. "The money is allowed in, but the record
 *     must never look like it arrived on time."
 *
 * REAL POINTER EVENTS: every control here is a plain button or a Radix control
 * driven by real interaction. Tests must dispatch pointerdown/mousedown, never a
 * synthetic `element.click()`.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Lock, Unlock, ShieldCheck, AlertTriangle } from "lucide-react";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { NO_CLOSE_DATE_COPY } from "@shared/roundClose";

/** One row of the append-only late-acceptance ledger, as the server returns it. */
export interface LateAcceptanceGrant {
  id: string;
  roundId: string;
  kind: "reopen" | "late_commitment";
  invitationId: string | null;
  softCircleId: string | null;
  closedAt: string;
  acceptedByUserId: string;
  acceptedByName: string | null;
  acceptedAt: string;
  reason: string | null;
  reopenUntil: string | null;
  consumedAt: string | null;
  revokedAt: string | null;
}

export interface CloseStatus {
  ok: boolean;
  roundId: string;
  closed: boolean;
  hasCloseDate: boolean;
  closedAt: string | null;
  closeSource: string;
  statement: string | null;
  lateAcceptanceLabel: string;
  grants: LateAcceptanceGrant[];
}

export interface LateAcceptanceInvitationOption {
  id: string;
  investorName?: string;
  investorEmail?: string;
  state?: string;
}

export function RoundCloseLateAcceptance({
  roundId,
  invitations,
}: {
  roundId: string;
  invitations: LateAcceptanceInvitationOption[];
}) {
  const { toast } = useToast();
  const status = useQuery<CloseStatus>({ queryKey: [`/api/rounds/${roundId}/close-status`] });

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenUntil, setReopenUntil] = useState("");
  const [reopenConfirm, setReopenConfirm] = useState(false);

  const [lateOpen, setLateOpen] = useState(false);
  const [lateInvitationId, setLateInvitationId] = useState("");
  const [lateReason, setLateReason] = useState("");
  const [lateConfirm, setLateConfirm] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/rounds/${roundId}/close-status`] });
    queryClient.invalidateQueries({ queryKey: [`/api/rounds/${roundId}/soft-circles`] });
    queryClient.invalidateQueries({ queryKey: [`/api/rounds/${roundId}/invitations`] });
  };

  const reopenMut = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/rounds/${roundId}/reopen`, {
        /* `confirm` is sent because the FOUNDER ticked the box, and the server
         * refuses the request without it. Two independent deliberation gates. */
        confirm: true,
        reason: reopenReason.trim(),
        reopenUntil: new Date(reopenUntil).toISOString(),
      })).json(),
    onSuccess: () => {
      toast({
        title: "Round reopened",
        description: "Commitments received during the reopening are recorded as accepted after close.",
      });
      setReopenOpen(false);
      setReopenReason(""); setReopenUntil(""); setReopenConfirm(false);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Could not reopen the round", description: e.message, variant: "destructive" }),
  });

  const lateMut = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/rounds/${roundId}/late-acceptance`, {
        confirm: true,
        invitationId: lateInvitationId,
        reason: lateReason.trim(),
      })).json(),
    onSuccess: () => {
      toast({
        title: "Late commitment accepted",
        description: "This investor may now commit once. The commitment will be marked accepted after close.",
      });
      setLateOpen(false);
      setLateInvitationId(""); setLateReason(""); setLateConfirm(false);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Could not accept the late commitment", description: e.message, variant: "destructive" }),
  });

  const revokeMut = useMutation({
    mutationFn: async (grantId: string) =>
      (await apiRequest("POST", `/api/rounds/${roundId}/late-acceptance/${grantId}/revoke`, { confirm: true })).json(),
    onSuccess: () => {
      toast({ title: "Admission revoked", description: "The ledger row is retained and marked revoked." });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Could not revoke", description: e.message, variant: "destructive" }),
  });

  /* R6 — a round with no recorded close date says so. It is NOT reported as
   * closed, and it is NOT given a 0-day countdown or a blank. */
  const noCloseDate = status.data ? !status.data.hasCloseDate : false;
  const closed = status.data?.closed === true;
  const grants = status.data?.grants ?? [];
  const liveReopen = grants.find((g) => g.kind === "reopen" && !g.revokedAt && g.reopenUntil && Date.parse(g.reopenUntil) > Date.now());

  const reopenReady = reopenConfirm && reopenReason.trim().length > 0 && reopenUntil.trim().length > 0;
  const lateReady = lateConfirm && lateReason.trim().length > 0 && lateInvitationId.trim().length > 0;

  return (
    <Card className="mb-4" data-testid="card-round-close-late-acceptance">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          {closed ? <Lock className="h-4 w-4 text-[hsl(7_61%_43%)]" /> : <Unlock className="h-4 w-4" />}
          Round close and late acceptance
        </CardTitle>
        {status.data && (
          <Badge
            variant="outline"
            className={closed ? "border-[hsl(7_61%_43%)]/40 text-[hsl(7_61%_43%)]" : "border-emerald-500/40 text-emerald-700"}
            data-testid="badge-close-state"
          >
            {closed ? "Closed" : noCloseDate ? NO_CLOSE_DATE_COPY : "Open"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {status.isLoading && <div className="text-sm text-muted-foreground">Loading close status…</div>}
        {status.isError && (
          <div className="text-sm text-[hsl(7_61%_43%)]" data-testid="text-close-status-unavailable">
            Close status could not be loaded, so it is not being stated. Reload before relying on this panel.
          </div>
        )}

        {status.data && (
          <>
            {/* THE FACT, STATED. Never a muted caption beside a live action. */}
            <div className="text-sm" data-testid="text-close-statement">
              {closed ? (
                <span className="font-medium text-[hsl(7_61%_43%)]">{status.data.statement}</span>
              ) : noCloseDate ? (
                /* R6 — the honest refusal, in the founder's own words rather than
                 * an implied "open forever". */
                <span className="italic text-muted-foreground">
                  {NO_CLOSE_DATE_COPY}. Commitments are accepted, and nothing here can be enforced until a close date is set on the round.
                </span>
              ) : (
                <span>
                  Open until <span className="font-medium">{fmtDate(status.data.closedAt)}</span>
                  <span className="text-muted-foreground"> · source: {status.data.closeSource}</span>
                </span>
              )}
            </div>

            {liveReopen && (
              <div className="text-xs rounded-md border border-amber-400/40 bg-amber-50/40 p-2.5" data-testid="text-live-reopen">
                <AlertTriangle className="h-3.5 w-3.5 inline mr-1 text-amber-600" />
                Reopened by {liveReopen.acceptedByName ?? liveReopen.acceptedByUserId} until{" "}
                <span className="font-medium">{fmtDateTime(liveReopen.reopenUntil)}</span>. Commitments received now are still
                marked <strong>{status.data.lateAcceptanceLabel}</strong>.
              </div>
            )}

            {/* Both doors. Shown only on a closed round: offering to "accept a
                late commitment" on an open round would be meaningless, and the
                server refuses it with ROUND_NOT_CLOSED. */}
            {closed && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setReopenOpen(true)} data-testid="button-open-reopen-dialog">
                  <Unlock className="h-3.5 w-3.5 mr-1" /> Reopen the round…
                </Button>
                <Button size="sm" variant="outline" onClick={() => setLateOpen(true)} data-testid="button-open-late-acceptance-dialog">
                  <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Accept one late commitment…
                </Button>
              </div>
            )}

            {/* THE AUDIT TRAIL, VISIBLE. */}
            {grants.length > 0 && (
              <div className="border-t border-border pt-3">
                <div className="text-xs uppercase text-muted-foreground mb-2">Late-acceptance record</div>
                <ul className="space-y-2" data-testid="list-late-acceptance-grants">
                  {grants.map((g) => (
                    <li key={g.id} className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1" data-testid={`row-grant-${g.id}`}>
                      <Badge variant="outline" className="text-[10px]">
                        {g.kind === "reopen" ? "Round reopened" : "Late commitment accepted"}
                      </Badge>
                      <span className="font-medium">{g.acceptedByName ?? g.acceptedByUserId}</span>
                      <span className="text-muted-foreground">on {fmtDateTime(g.acceptedAt)}</span>
                      <span className="text-muted-foreground">· closed {fmtDate(g.closedAt)}</span>
                      {g.invitationId && <span className="font-mono text-muted-foreground">· invitation {g.invitationId}</span>}
                      {g.softCircleId && <span className="font-mono text-muted-foreground">· commitment {g.softCircleId}</span>}
                      {g.reason && <span className="italic">“{g.reason}”</span>}
                      {g.consumedAt && <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-700">used {fmtDateTime(g.consumedAt)}</Badge>}
                      {g.revokedAt && <Badge variant="outline" className="text-[10px] border-[hsl(7_61%_43%)]/40 text-[hsl(7_61%_43%)]">revoked {fmtDateTime(g.revokedAt)}</Badge>}
                      {!g.consumedAt && !g.revokedAt && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => revokeMut.mutate(g.id)}
                          disabled={revokeMut.isPending}
                          data-testid={`button-revoke-grant-${g.id}`}
                        >
                          Revoke
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* ── DOOR 1: reopen ─────────────────────────────────────────────────── */}
      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent data-testid="dialog-reopen-round">
          <DialogHeader>
            <DialogTitle>Reopen this round</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground text-xs">
              {status.data?.statement ?? "This round is closed."} Reopening admits new commitments until the date you set. Every
              commitment received while reopened is permanently marked <strong>{status.data?.lateAcceptanceLabel ?? "Accepted after close"}</strong>{" "}
              and attributed to you. The original close date is not altered.
            </p>
            <div>
              <Label htmlFor="w43-reopen-until">Reopen until</Label>
              <Input
                id="w43-reopen-until"
                type="datetime-local"
                className="mt-1"
                value={reopenUntil}
                onChange={(e) => setReopenUntil(e.target.value)}
                data-testid="input-reopen-until"
              />
            </div>
            <div>
              <Label htmlFor="w43-reopen-reason">Reason (recorded in the audit trail)</Label>
              <Textarea
                id="w43-reopen-reason"
                rows={2}
                className="mt-1"
                maxLength={500}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="Why this round is being reopened…"
                data-testid="input-reopen-reason"
              />
            </div>
            <div className="flex items-start gap-2 text-xs">
              {/* Unchecked by default. The action cannot be a default or an
                  accident; R7 requires it to be deliberate. */}
              <Checkbox id="w43-reopen-confirm" checked={reopenConfirm} onCheckedChange={(v) => setReopenConfirm(!!v)} data-testid="checkbox-reopen-confirm" />
              <label htmlFor="w43-reopen-confirm" className="cursor-pointer">
                I am deliberately reopening a closed round. Commitments received will be recorded as accepted after close, attributed to me.
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenOpen(false)} data-testid="button-cancel-reopen">Cancel</Button>
            <Button
              onClick={() => reopenMut.mutate()}
              disabled={!reopenReady || reopenMut.isPending}
              data-testid="button-confirm-reopen"
            >
              Reopen the round
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DOOR 2: accept ONE late commitment ─────────────────────────────── */}
      <Dialog open={lateOpen} onOpenChange={setLateOpen}>
        <DialogContent data-testid="dialog-late-acceptance">
          <DialogHeader>
            <DialogTitle>Accept one late commitment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground text-xs">
              This admits a single commitment from ONE investor without reopening the round for anyone else. It is single-use: once
              that investor commits, the admission is consumed. The commitment is marked{" "}
              <strong>{status.data?.lateAcceptanceLabel ?? "Accepted after close"}</strong> for you, for them, and on the cap table.
            </p>
            <div>
              <Label>Investor invitation</Label>
              <Select value={lateInvitationId} onValueChange={setLateInvitationId}>
                <SelectTrigger className="mt-1" data-testid="select-late-invitation">
                  <SelectValue placeholder="Choose the investor…" />
                </SelectTrigger>
                <SelectContent>
                  {invitations.map((inv) => (
                    <SelectItem key={inv.id} value={inv.id} data-testid={`option-late-invitation-${inv.id}`}>
                      {inv.investorName || inv.investorEmail || inv.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {invitations.length === 0 && (
                <div className="text-xs text-muted-foreground mt-1" data-testid="text-no-invitations-for-late">
                  No invitations on this round, so there is no one to admit.
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="w43-late-reason">Reason (recorded in the audit trail)</Label>
              <Textarea
                id="w43-late-reason"
                rows={2}
                className="mt-1"
                maxLength={500}
                value={lateReason}
                onChange={(e) => setLateReason(e.target.value)}
                placeholder="Why this commitment is being admitted after close…"
                data-testid="input-late-reason"
              />
            </div>
            <div className="flex items-start gap-2 text-xs">
              <Checkbox id="w43-late-confirm" checked={lateConfirm} onCheckedChange={(v) => setLateConfirm(!!v)} data-testid="checkbox-late-confirm" />
              <label htmlFor="w43-late-confirm" className="cursor-pointer">
                I am deliberately accepting a commitment after this round closed. It will be labelled accepted after close everywhere it appears.
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLateOpen(false)} data-testid="button-cancel-late-acceptance">Cancel</Button>
            <Button
              onClick={() => lateMut.mutate()}
              disabled={!lateReady || lateMut.isPending}
              data-testid="button-confirm-late-acceptance"
            >
              Accept this late commitment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default RoundCloseLateAcceptance;
