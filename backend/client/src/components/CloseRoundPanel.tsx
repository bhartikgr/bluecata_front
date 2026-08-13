/**
 * Close Round panel — sign-off flow gated by dual-engine reconciliation.
 *
 * Steps:
 * 1. Run reconciliation → primary vs reference engines.
 * 2. If divergence: BLOCKING red card; close cannot proceed.
 * 3. If match: founder confirms → admin counter-signs → commit close transaction.
 * 4. After close: round is locked, ledger sealed, audit trail visible.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
 ShieldCheck, AlertTriangle, RefreshCw, GitCompareArrows, Stamp, Lock,
 CheckCircle2, ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
 runReconciliation, buildDemoComputeOpts, useSprint3, emit,
} from "@/lib/sprint3";
import { useRole } from "@/lib/role";
import { appendTransaction, type ReconciliationResult } from "@capavate/cap-table-engine";
import { apiRequest, queryClient } from "@/lib/queryClient"; /* v25.20 Lane 4 — real server close */

type Props = {
 roundId: string;
 companyId?: string;
 roundName?: string;
 founderName?: string;
};

/* ============================================================
 * WAVE 22 · ITEM 1 (REVIEW B F-2) — NO FABRICATED AUDIT METADATA.
 *
 * THE DEFECT. This file used to carry two generators:
 *   • `fakeIp()`        → `"203.0.113." + Math.floor(Math.random() * 255)`
 *   • `identityHash()`  → a "demo-grade FNV" of `actor + "|" + ts`
 * Their output was written into the founder and admin round-close sign-offs,
 * into the `signoff.requested` / `signoff.granted` / `round.closed` telemetry
 * context, into the appended `round_close` ledger transaction, and — via
 * `setCloseState` → `mirrorSignoffToAuditLog` — into the durable server-side
 * audit log. An invented IP inside an evidence record is strictly worse than
 * an absent one: absent is honest, invented is a false statement that reads
 * as fact to anyone auditing the close.
 *
 * THE RULE APPLIED. Record the real value, or record an explicit
 * "not captured". Never synthesise, and never silently drop the field.
 *
 * WHAT IS ACTUALLY AVAILABLE HERE. A browser cannot observe its own public
 * address, and this component has no identity-attestation service to hash
 * against. Both values are therefore genuinely unavailable AT THIS POINT, so
 * both are persisted as `null` carrying a machine-readable reason
 * (`ipAddressUnavailableReason` / `identityHashUnavailableReason`), and the
 * UI renders "not captured" instead of a value.
 *
 * WHERE THE REAL IP NOW COMES FROM. The server stamps the address it actually
 * observed on the socket: `POST /api/admin/audit-log/append`
 * (`server/adminPlatformStore.ts`) overwrites any client-supplied `ipAddress`
 * with `serverObservedIp`, resolved through the same hardened trusted-hop
 * resolver as Wave 22 ITEM 2. The canonical close is likewise recorded
 * server-side by `POST /api/founder/rounds/:id/close`. The client no longer
 * claims to know something it cannot know.
 * ============================================================ */

/** Persisted in place of a value the client genuinely cannot observe. Never a
 *  synthesised stand-in; consumers must render it as "not captured". */
const AUDIT_VALUE_NOT_CAPTURED = null;

const IP_NOT_CAPTURED_REASON =
 "client-side capture unavailable: a browser cannot observe its own public address. " +
 "The server stamps the peer address it observed (serverObservedIp) on the durable audit record.";

const IDENTITY_HASH_NOT_CAPTURED_REASON =
 "no identity-attestation service is wired to this surface; a locally computed hash would attest to nothing.";

/** Display text for an audit field that was not captured. Used only for
 *  rendering — the persisted value stays `null`. */
function auditDisplay(value: string | null | undefined): string {
 return value == null || value === "" ? "not captured" : value;
}

export default function CloseRoundPanel({ roundId, companyId = "co-acme", roundName = "this round", founderName = "Avi Barnes" }: Props) {
 const { role } = useRole();
 const { toast } = useToast();
 const closeStates = useSprint3((s) => s.closeStates);
 const setCloseState = useSprint3((s) => s.setCloseState);
 const ledger = useSprint3((s) => s.ledger);
 const setLedger = useSprint3((s) => s.setLedger);

 const state = closeStates[roundId] ?? { roundId, closed: false };
 const [running, setRunning] = useState(false);
 // v25.48.2 Q13 — pending (un-confirmed) soft-circle commitments that a close
 // will lapse. Drives the pre-finalize warning + acknowledgement.
 const [ackLapse, setAckLapse] = useState(false);
 const pending = useQuery<{ ok: boolean; count: number; totalMinor: number }>({
   queryKey: [`/api/founder/rounds/${roundId}/pending-commitments`],
   enabled: !state.closed,
   staleTime: 10_000,
 });
 const pendingCount = pending.data?.count ?? 0;

 function runRecon() {
 setRunning(true);
 setTimeout(() => {
 const opts = buildDemoComputeOpts(companyId);
 const r = runReconciliation(opts, {
 actorId: role === "admin" ? "admin-platform" : "founder-avi",
 actorRole: role === "admin" ? "admin" : "founder",
 companyId,
 /* WAVE 22 · ITEM 1 — was `fakeIp()`. Undefined here means the telemetry
    context carries no address at all rather than an invented one; the
    durable record's address is stamped server-side. */
 ipAddress: undefined,
 });
 setCloseState({ ...state, reconciliation: r });
 setRunning(false);
 toast({
 title: r.status === "match" ? "Reconciliation match" : "Reconciliation divergence",
 description: r.status === "match"
 ? `Both engines agree. ${r.runDurationMs}ms · ${r.formulaIdsUsed.length} formulas.`
 : `${r.diffs.length} diffs detected. Round close is BLOCKED.`,
 });
 }, 200);
 }

 function founderSign() {
 const ts = new Date().toISOString();
 const sig = {
 actorId: "founder-avi",
 actorName: founderName,
 actorRole: "founder" as const,
 ts,
 /* WAVE 22 · ITEM 1 — explicit not-captured, never a synthesised address. */
 ipAddress: AUDIT_VALUE_NOT_CAPTURED,
 ipAddressUnavailableReason: IP_NOT_CAPTURED_REASON,
 identityHash: AUDIT_VALUE_NOT_CAPTURED,
 identityHashUnavailableReason: IDENTITY_HASH_NOT_CAPTURED_REASON,
 };
 setCloseState({ ...state, founderSignoff: sig });
 emit({ type: "signoff.requested", payload: { signoffId: `so-${roundId}-f`, roundId, signerRole: "founder" } }, { companyId, roundId, actorId: "founder-avi", actorRole: "founder", ipAddress: sig.ipAddress ?? undefined });
 emit({ type: "signoff.granted", payload: { signoffId: `so-${roundId}-f`, roundId, signerRole: "founder", identityHash: sig.identityHash } }, { companyId, roundId, actorId: "founder-avi", actorRole: "founder", ipAddress: sig.ipAddress ?? undefined });
 toast({ title: "Founder sign-off captured", description: `Identity ${auditDisplay(sig.identityHash)} · ${new Date(sig.ts).toLocaleTimeString()}` });
 }

 function adminSign() {
 const ts = new Date().toISOString();
 const sig = {
 actorId: "admin-platform",
 actorName: "Capavate Admin",
 actorRole: "admin" as const,
 ts,
 /* WAVE 22 · ITEM 1 — explicit not-captured, never a synthesised address. */
 ipAddress: AUDIT_VALUE_NOT_CAPTURED,
 ipAddressUnavailableReason: IP_NOT_CAPTURED_REASON,
 identityHash: AUDIT_VALUE_NOT_CAPTURED,
 identityHashUnavailableReason: IDENTITY_HASH_NOT_CAPTURED_REASON,
 };
 setCloseState({ ...state, adminSignoff: sig });
 emit({ type: "signoff.requested", payload: { signoffId: `so-${roundId}-a`, roundId, signerRole: "admin" } }, { companyId, roundId, actorId: "admin-platform", actorRole: "admin", ipAddress: sig.ipAddress ?? undefined });
 emit({ type: "signoff.granted", payload: { signoffId: `so-${roundId}-a`, roundId, signerRole: "admin", identityHash: sig.identityHash } }, { companyId, roundId, actorId: "admin-platform", actorRole: "admin", ipAddress: sig.ipAddress ?? undefined });
 toast({ title: "Admin counter-signature captured", description: `Identity ${auditDisplay(sig.identityHash)}` });
 }

 function commitClose() {
 if (!state.reconciliation || !state.founderSignoff || !state.adminSignoff) return;
 const r = state.reconciliation;
 const founder = state.founderSignoff!;
 const admin = state.adminSignoff!;
 // Append immutable close entry to the ledger
 const newLedger = appendTransaction(ledger, {
 id: `close-${roundId}-${Date.now()}`,
 companyId,
 type: "round_close",
 instrumentRef: null,
 timestamp: new Date().toISOString(),
 actorId: admin.actorId,
 actorRole: "admin",
 /* WAVE 22 · ITEM 1 — the field is KEPT (not silently dropped) and carries
    an explicit null; the reason lives on the sign-off record below. */
 ipAddress: admin.ipAddress ?? undefined,
 idempotencyKey: `close-${roundId}`,
 payload: {
 type: "round_close",
 data: {
 roundId,
 primaryHash: r.primaryHash,
 referenceHash: r.referenceHash,
 founderSignoff: { actorId: founder.actorId, ts: founder.ts, ipAddress: founder.ipAddress, identityHash: founder.identityHash, ipAddressUnavailableReason: founder.ipAddressUnavailableReason, identityHashUnavailableReason: founder.identityHashUnavailableReason },
 adminSignoff: { actorId: admin.actorId, ts: admin.ts, ipAddress: admin.ipAddress, identityHash: admin.identityHash, ipAddressUnavailableReason: admin.ipAddressUnavailableReason, identityHashUnavailableReason: admin.identityHashUnavailableReason },
 },
 },
 });
 setLedger(newLedger);
 const closedAt = new Date().toISOString();
 setCloseState({ ...state, closed: true, closedAt });
 // Emit telemetry events for the close
 emit({ type: "round.closed", payload: { roundId, primaryHash: r.primaryHash, referenceHash: r.referenceHash, finalAmount: "0" } }, { companyId, roundId, actorId: admin.actorId, actorRole: "admin", ipAddress: admin.ipAddress ?? undefined });
 emit({ type: "cap_table.mutated", payload: { beforeHash: r.referenceHash, afterHash: r.primaryHash, reason: `round close: ${roundId}` } }, { companyId, roundId, actorId: admin.actorId, actorRole: "admin" });
 /* v25.20 Lane 4 — PERSIST the close to the server. Previously commitClose
    only mutated the client-local sprint3 ledger + telemetry, so the round
    state was never written to the DB (the "Commit & close" button POSTed
    nowhere). We now call the canonical POST /api/founder/rounds/:id/close,
    which runs roundsStore.closeRound (DB UPDATE + audit + bridge event +
    per-company chain-head freeze, v25.18 NH4). The local seal is kept for
    the demo reconciliation UX; the server call is the source of truth. */
 void (async () => {
   try {
     await apiRequest("POST", `/api/founder/rounds/${roundId}/close`, {
       reason: "manual_close",
       finalCurrency: "USD",
       // v25.48.2 Q13 — founder acknowledged the warning; lapse un-confirmed
       // commitments server-side (confirmed/wired/committed are preserved).
       lapsePending: pendingCount > 0,
     });
     queryClient.invalidateQueries({ queryKey: ["/api/rounds"] });
     queryClient.invalidateQueries({ queryKey: [`/api/founder/rounds/${roundId}/pending-commitments`] });
     toast({ title: "Round closed", description: "Round state persisted; ledger sealed. Audit trail in /admin/audit-log." });
   } catch (err) {
     toast({
       title: "Close not persisted",
       description: "The ledger was sealed locally but the server close failed. Retry.",
       variant: "destructive",
     });
   }
 })();
 }

 return (
 <div className="space-y-4" data-testid="panel-close-round">
 {/* Step 1 — reconciliation */}
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2"><GitCompareArrows className="h-4 w-4 text-[hsl(0_100%_40%)]" />Step 1 — Run reconciliation</CardTitle>
 </CardHeader>
 <CardContent>
 <p className="text-sm text-muted-foreground mb-3">Compute the projected post-close cap table with both the primary engine (decimal.js) and the independent reference engine (BigInt scaled fixed-point). They must agree to the share / cent for the round to close.</p>
 <div className="flex items-center gap-2 mb-3">
 <Button onClick={runRecon} disabled={running || state.closed} className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid="button-run-recon">
 <RefreshCw className={`h-4 w-4 mr-2 ${running ? "animate-spin" : ""}`} />
 {state.reconciliation ? "Re-run reconciliation" : "Run reconciliation"}
 </Button>
 {state.reconciliation && (
 state.reconciliation.status === "match"
 ? <Badge className="bg-emerald-100 text-emerald-900 border-0"><ShieldCheck className="h-3 w-3 mr-1" />Match · {state.reconciliation.runDurationMs}ms</Badge>
 : <Badge className="bg-rose-100 text-rose-900 border-0"><AlertTriangle className="h-3 w-3 mr-1" />Divergence · {state.reconciliation.diffs.length} diffs</Badge>
 )}
 </div>

 {state.reconciliation && (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
 <HashCard label="Primary engine" hash={state.reconciliation.primaryHash} total={state.reconciliation.primaryTotal} />
 <HashCard label="Reference engine" hash={state.reconciliation.referenceHash} total={state.reconciliation.referenceTotal} />
 </div>
 )}
 </CardContent>
 </Card>

 {/* Block if divergence */}
 {state.reconciliation?.status === "divergence" && (
 <Card className="border-rose-300 bg-rose-50 ">
 <CardContent className="py-4">
 <div className="flex items-start gap-3">
 <AlertTriangle className="h-5 w-5 text-rose-700 flex-shrink-0 mt-0.5" />
 <div>
 <div className="font-semibold text-rose-900 ">Round close blocked — divergence detected</div>
 <p className="text-sm text-rose-800 mt-1">
 The primary and reference engines disagree on the projected cap table. <strong>You cannot close this round until the divergence is resolved.</strong>
 Contact your platform admin and share the diff details below.
 </p>
 <div className="mt-3 bg-card border border-rose-300 rounded p-2 text-xs">
 <table className="w-full">
 <thead><tr className="text-muted-foreground"><th className="text-left py-1">Holder</th><th className="text-left py-1">Kind</th><th className="text-right py-1">Primary</th><th className="text-right py-1">Reference</th><th className="text-right py-1">Δ</th></tr></thead>
 <tbody>
 {state.reconciliation.diffs.map((d) => (
 <tr key={d.key} className="border-t border-rose-200 ">
 <td className="py-1">{d.holderId}</td>
 <td className="py-1">{d.kind}</td>
 <td className="py-1 text-right font-mono">{d.primaryShares}</td>
 <td className="py-1 text-right font-mono">{d.referenceShares}</td>
 <td className="py-1 text-right font-mono text-rose-700">{d.shareDelta}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 </CardContent>
 </Card>
 )}

 {/* Step 2 — sign-offs (only when match) */}
 {state.reconciliation?.status === "match" && !state.closed && (
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2"><Stamp className="h-4 w-4 text-[hsl(0_100%_40%)]" />Step 2 — Sign-offs</CardTitle>
 </CardHeader>
 <CardContent>
 <SignoffRow label={`I, ${founderName}, confirm the projected post-close cap table is correct.`}
 role="founder" sig={state.founderSignoff} onSign={founderSign} canSign={role !== "investor"}
 testid="signoff-founder" />
 <SignoffRow label="Capavate platform admin counter-signature"
 role="admin" sig={state.adminSignoff} onSign={adminSign} canSign={role === "admin"}
 hint={role === "admin" ? undefined : "Switch to admin role chip on landing to counter-sign (preview only)."}
 testid="signoff-admin" />
 </CardContent>
 </Card>
 )}

 {/* v25.48.2 Q13 — pending-commitment warning (shown before finalize when any
     un-confirmed soft-circle exists). Confirmed/wired/committed are preserved. */}
 {state.reconciliation?.status === "match" && state.founderSignoff && state.adminSignoff && !state.closed && pendingCount > 0 && (
 <Card className="border-amber-300 bg-amber-50" data-testid="close-pending-warning">
 <CardContent className="py-4">
 <div className="flex items-start gap-3">
 <AlertTriangle className="h-5 w-5 text-amber-700 flex-shrink-0 mt-0.5" />
 <div className="flex-1">
 <div className="font-semibold text-amber-900">
 {pendingCount} pending commitment{pendingCount === 1 ? "" : "s"} will be closed out and marked lapsed
 </div>
 <p className="text-sm text-amber-800 mt-1">
 These are un-confirmed / open soft-circles. Closing the round will mark them
 <strong> lapsed</strong> (not funded) with an audit-trail entry. Confirmed, wired, and
 committed commitments are <strong>not</strong> affected.
 </p>
 <label className="flex items-center gap-2 mt-3 text-sm text-amber-900 cursor-pointer">
 <input
 type="checkbox"
 checked={ackLapse}
 onChange={(e) => setAckLapse(e.target.checked)}
 data-testid="checkbox-ack-lapse"
 />
 I understand these {pendingCount} pending commitment{pendingCount === 1 ? "" : "s"} will be lapsed.
 </label>
 </div>
 </div>
 </CardContent>
 </Card>
 )}

 {/* Step 3 — commit close */}
 {state.reconciliation?.status === "match" && state.founderSignoff && state.adminSignoff && !state.closed && (
 <Card className="border-[hsl(0_100%_40%)] bg-[hsl(0_100%_40%)]/5">
 <CardContent className="py-4 flex items-center gap-3">
 <CheckCircle2 className="h-5 w-5 text-[hsl(0_100%_40%)]" />
 <div className="flex-1">
 <div className="font-semibold">All sign-offs captured</div>
 <p className="text-sm text-muted-foreground">Click <strong>Close round</strong> to write the immutable close transaction to the ledger and emit final telemetry events.</p>
 </div>
 <Button onClick={commitClose} disabled={pendingCount > 0 && !ackLapse} className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid="button-commit-close">
 Close round <ChevronRight className="h-4 w-4 ml-1" />
 </Button>
 </CardContent>
 </Card>
 )}

 {state.closed && (
 <Card className="border-emerald-300 bg-emerald-50 ">
 <CardContent className="py-5 flex items-start gap-3">
 <Lock className="h-5 w-5 text-emerald-700 mt-0.5" />
 <div>
 <div className="font-semibold text-emerald-900 ">Round closed and sealed</div>
 <p className="text-sm text-emerald-800 mt-1">
 Ledger entry written at {state.closedAt ? new Date(state.closedAt).toLocaleString() : "—"}.
 Founder hash <span className="font-mono text-xs">{auditDisplay(state.founderSignoff?.identityHash)}</span>,
 admin hash <span className="font-mono text-xs">{auditDisplay(state.adminSignoff?.identityHash)}</span>.
 Audit trail in <span className="font-mono text-xs">/admin/audit-log</span>.
 </p>
 {/* WAVE 22 · ITEM 1 — sibling paragraph (never text appended into the node
     above). States plainly why the client-side evidence fields are empty, so a
     "not captured" is never mistaken for a lost value. */}
 <p className="text-xs text-emerald-800/80 mt-2" data-testid="close-audit-capture-note">
 Client-side IP and identity hash are recorded as <strong>not captured</strong>: a browser cannot observe its own
 public address and no identity-attestation service is wired to this surface. The address the server actually
 observed is stamped on the durable audit record.
 </p>
 </div>
 </CardContent>
 </Card>
 )}
 </div>
 );
}

function HashCard({ label, hash, total }: { label: string; hash: string; total: string }) {
 return (
 <div className="rounded-md border border-border bg-card p-3">
 <div className="text-[10px] uppercase text-muted-foreground mb-1">{label}</div>
 <div className="text-muted-foreground text-[10px]">Total shares</div>
 <div className="font-mono tabular-nums text-sm font-semibold mb-1.5">{Number(total).toLocaleString()}</div>
 <div className="text-muted-foreground text-[10px]">Hash</div>
 <div className="font-mono text-[9px] break-all leading-snug">{hash}</div>
 </div>
 );
}

function SignoffRow({ label, role, sig, onSign, canSign, hint, testid }: {
 label: string;
 role: "founder" | "admin";
 /* WAVE 22 · ITEM 1 — both evidence fields are nullable: `null` means "not
    captured", carried with a machine-readable reason. */
 sig?: {
 actorName: string;
 ts: string;
 ipAddress?: string | null;
 ipAddressUnavailableReason?: string;
 identityHash: string | null;
 identityHashUnavailableReason?: string;
 };
 onSign: () => void;
 canSign: boolean;
 hint?: string;
 testid: string;
}) {
 return (
 <div className="border-b border-border/60 py-3 last:border-b-0 last:pb-0 first:pt-0">
 <div className="flex items-start gap-3">
 <div className="flex-1">
 <div className="text-sm font-medium">{label}</div>
 {sig ? (
 <div className="text-xs text-muted-foreground mt-1">
 Signed by <strong className="text-foreground">{sig.actorName}</strong> at {new Date(sig.ts).toLocaleString()}
 {sig.ipAddress && <span> · IP <span className="font-mono">{sig.ipAddress}</span></span>}
 {/* WAVE 22 · ITEM 1 — SIBLING element, deliberately not text appended inside
     the node above (that reads to the silent-drop guard as a removal plus an
     addition). Renders the explicit not-captured state instead of a
     synthesised address; `title` carries the documented reason. */}
 {!sig.ipAddress && (
 <span data-testid={`${testid}-ip-not-captured`} title={sig.ipAddressUnavailableReason}> · IP <span className="font-mono">{auditDisplay(sig.ipAddress)}</span></span>
 )}
 <span> · identity <span className="font-mono" title={sig.identityHash ? undefined : sig.identityHashUnavailableReason}>{auditDisplay(sig.identityHash)}</span></span>
 </div>
 ) : hint ? (
 <div className="text-xs text-muted-foreground italic mt-1">{hint}</div>
 ) : (
 <div className="text-xs text-muted-foreground mt-1">Awaiting {role} sign-off…</div>
 )}
 </div>
 {sig
 ? <Badge className="bg-emerald-100 text-emerald-900 border-0"><CheckCircle2 className="h-3 w-3 mr-1" />Signed</Badge>
 : <Button size="sm" disabled={!canSign} onClick={onSign} data-testid={`button-${testid}`}>{role === "founder" ? "I confirm" : "Counter-sign"}</Button>}
 </div>
 </div>
 );
}
