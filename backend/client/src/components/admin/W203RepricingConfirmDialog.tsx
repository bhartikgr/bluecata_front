/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 203 · ITEM B — SEPARATE DETECTION FROM REMEDIATION (R178.6).
 * ══════════════════════════════════════════════════════════════════════════════
 * THE RULING THIS FILE EXISTS TO SATISFY, stated as the defect it closes:
 *
 * A one-click control that changes what a partner is CHARGED TO SEE must not sit
 * inside an automated comparison screen. In financial controls the system that
 * DETECTS a discrepancy does not also EXECUTE the correction in one gesture —
 * otherwise a misreading of the comparison becomes a billing change. And this
 * particular comparison has already been wrong once: before wave 201 it offered
 * this same destructive button on rows it could not even compare (R176.1).
 *
 * Before this wave, `onClick={() => ack.mutate(r.feeKind)}` posted
 * `confirm: true` immediately. The confirmation existed only as a hardcoded
 * literal in the mutation body, so it asserted deliberation without evidencing
 * any, and no reason was captured or required.
 *
 * THIS COMPONENT IS THE DELIBERATE STEP. It names, on screen, before anything is
 * sent:
 *   • the OLD amount   (what the partner is shown today)
 *   • the NEW amount   (what the authoritative source says)
 *   • the AFFECTED PARTY (the tier, and the specific partner when one is scoped)
 *   • a REASON, typed by the person doing it. Confirm stays disabled until it is
 *     non-empty, and the server refuses an empty one as well (defence in depth,
 *     not decoration: the route is reachable without this screen).
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 *
 *  · It sends NO AMOUNT. Both figures are re-resolved server-side at
 *    confirmation time, exactly as before. The browser's numbers are display
 *    only, which is why this screen cannot mis-state a price into the ledger.
 *  · It performs NO ARITHMETIC on money. No `Number()`, `parseInt` or
 *    `parseFloat` touches an amount here, no difference is computed, and no
 *    currency is converted or hardcoded — the two sides are formatted
 *    independently by `formatMinorOrUnavailable`, each with its own currency.
 *  · It is NEVER RENDERED FOR A CANNOT-COMPARE ROW. Wave 201's third state keeps
 *    no action at all; this dialog is reachable only from the mismatch branch.
 *  · It shows NO ALL-CAPS UNDERSCORE CODE (R143.4). `feeKind` and the source key
 *    are machine keys and are therefore passed through `humanizeMachineKey`.
 *
 * ── WHY A NEW FILE ──────────────────────────────────────────────────────────
 *
 * `AdminFeesConsolidated.tsx` is wave 202's territory this cycle. Putting the
 * whole surface here keeps that file's diff to four lines (an import, a state
 * hook, one `onClick` expression and one rendered element) and keeps every
 * existing copy literal there byte-verbatim, including `Confirm repricing`
 * (R143.1 — a replaced text node scores as a REMOVED copy string).
 *
 * A plain overlay is used rather than the shared `Dialog` primitive so that the
 * whole surface mounts in the real component tree under jsdom and can be proved
 * by a rendered-DOM test rather than by a mocked portal (handbook §8: never
 * prove a replica).
 * ════════════════════════════════════════════════════════════════════════════ */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatMinorOrUnavailable } from "@/lib/moneyDisplay";
import { humanizeMachineKey, planTierLabel } from "@/lib/partnerDisplay";

/** Only the fields this surface reads. Amounts stay integer minor units. */
export interface W203RepricingSubject {
  feeKind: string;
  authoritativeSource: string;
  displayed: { amountMinor: number | null; currency: string | null };
  authoritative: { amountMinor: number | null; currency: string | null };
}

export interface W203RepricingConfirmDialogProps {
  /** The mismatch row being acted on. `null` closes the surface entirely. */
  subject: W203RepricingSubject | null;
  /** The tier the comparison was run for — part of "who is affected". */
  tier: string;
  /** The specific partner, when the admin scoped the comparison to one. */
  partnerId: string;
  /** True while the confirmed request is in flight. */
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export function W203RepricingConfirmDialog({
  subject,
  tier,
  partnerId,
  pending,
  onCancel,
  onConfirm,
}: W203RepricingConfirmDialogProps) {
  const [reason, setReason] = useState("");
  if (!subject) return null;

  const reasonGiven = reason.trim() !== "";
  const feeName = humanizeMachineKey(subject.feeKind, "This fee");
  const affected = partnerId
    ? `${planTierLabel(tier)} — partner ${partnerId}`
    : `every partner on ${planTierLabel(tier)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="w203-repricing-confirm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm a change to what a partner is shown"
        className="w-full max-w-lg rounded-lg border border-border bg-background p-5 shadow-lg"
      >
        <h2 className="text-base font-semibold" data-testid="w203-confirm-heading">
          Change what a partner is shown
        </h2>

        {/* The whole point of the ruling: say plainly that a comparison screen is
            not a billing screen, and that this gesture is the billing one. */}
        <p className="mt-2 text-sm text-muted-foreground" data-testid="w203-confirm-explainer">
          Detecting a difference and correcting it are separate acts. This is the
          correcting one, so it is stated in full and recorded in the audit log.
        </p>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">What is being changed</dt>
            <dd data-testid="w203-confirm-feekind">{feeName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Who is affected</dt>
            <dd data-testid="w203-confirm-affected">{affected}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Amount shown today</dt>
            <dd data-testid="w203-confirm-old-amount">
              {formatMinorOrUnavailable(subject.displayed.amountMinor, subject.displayed.currency)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Amount they will be shown</dt>
            <dd data-testid="w203-confirm-new-amount">
              {formatMinorOrUnavailable(
                subject.authoritative.amountMinor,
                subject.authoritative.currency,
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Where the new amount comes from</dt>
            <dd data-testid="w203-confirm-source">
              {humanizeMachineKey(subject.authoritativeSource, "Source not named on record")}
            </dd>
          </div>
        </dl>

        <label className="mt-4 block text-sm font-medium" htmlFor="w203-reason">
          Why is this being changed
        </label>
        <textarea
          id="w203-reason"
          rows={3}
          className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="w203-confirm-reason"
        />
        {!reasonGiven ? (
          <p className="mt-1 text-xs text-muted-foreground" data-testid="w203-confirm-reason-required">
            A reason is required. It is stored with the decision and written to the
            audit log, so whoever reads the ledger later can see why this happened.
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} data-testid="w203-confirm-cancel">
            Leave it as it is
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!reasonGiven || pending}
            onClick={() => onConfirm(reason.trim())}
            data-testid="w203-confirm-submit"
          >
            Record this change
          </Button>
        </div>
      </div>
    </div>
  );
}

export default W203RepricingConfirmDialog;
