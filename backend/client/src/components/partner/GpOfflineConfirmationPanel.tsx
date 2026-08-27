/* client/src/components/partner/GpOfflineConfirmationPanel.tsx
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WAVE 166 · BATCH 3 ITEM D · PATH 1 · R131.1 — THE GP'S CONFIRM STEP.
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE OWNER'S MODEL, VERBATIM: "The GP will confirm the investment when the LP
 * signs the proper subscription docs and the funds are in the bank account
 * (OFFLINE process)."
 *
 * Both facts live outside this platform. It cannot observe either one, so it must
 * not infer either one — and before this wave it effectively did: a GP moved a
 * soft-circled row to `committed` with a single status change, and a non-binding
 * indication became confirmed capital with nobody having stated that anything was
 * signed or that any money had arrived.
 *
 * This panel is the ACT that was missing. Two separate affirmations, each about
 * one fact, each requiring a deliberate click, and a Confirm button that stays
 * disabled until BOTH are checked. Never inferred, never automatic, and never one
 * checkbox standing in for two facts.
 *
 * WHY A NEW FILE RATHER THAN AN ADDITION TO `SpvOperationsPanels.tsx`.
 * A concurrent build owns the wording sweep across the partner surfaces. A new
 * file cannot collide with it, and this control's copy is load-bearing legal
 * language that must not be swept: the sentences below are the owner's own words
 * and they are the record of what the GP asserted.
 *
 * WHY THE CONSEQUENCE IS SPELLED OUT BENEATH THE BOXES.
 * Because the GP is about to change three things at once — what the LP owns, what
 * the vehicle has raised, and what the partner is billed — and a control that
 * moves money without naming what it moves is how a confirmation becomes a
 * reflex. The server enforces the same rule independently
 * (`spvEngineStore.recordGpOfflineConfirmation`): this panel is the honest
 * surface, not the enforcement.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { serverRefusalMessage } from "@/lib/serverRefusalMessage";

/* ── THE COPY. Declared as named constants, not inlined, so the server test and
      the DOM test can both assert the SAME strings, and so a wording sweep that
      touches this file has to touch a named legal assertion deliberately rather
      than as a formatting side effect. ─────────────────────────────────────── */

/** Affirmation 1 — the documents. The owner's wording, unaltered. */
export const GP_CONFIRM_DOCS_AFFIRMATION =
  "I confirm the subscription documents for this LP are signed. I have seen them.";

/** Affirmation 2 — the funds. The owner's wording, unaltered. */
export const GP_CONFIRM_FUNDS_AFFIRMATION =
  "I confirm the funds for this LP are in the bank. I have seen them.";

/** What confirming actually does. Named, because a GP must read it. */
export const GP_CONFIRM_CONSEQUENCE_NOTICE =
  "Confirming records this as committed capital. It changes what this LP owns, " +
  "what the vehicle has raised, and what you are billed. Only confirm if both " +
  "statements above are true.";

/** Why the button is disabled, said plainly rather than left to be guessed. */
export const GP_CONFIRM_BLOCKED_HINT =
  "Both statements must be true before this LP can be confirmed. A soft-circle " +
  "with only one of the two is still not a commitment.";

export function GpOfflineConfirmationPanel({
  spvId,
  subscriptionId,
  stageLabel,
  canWrite,
  onConfirmed,
}: {
  spvId: string;
  subscriptionId: string;
  /** The LP's CURRENT stage, already labelled by the server (R132.3 wording). */
  stageLabel: string;
  canWrite: boolean;
  onConfirmed?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  /* TWO pieces of state, deliberately. One "I confirm everything" box would be a
     single click asserting two independent facts, which is the inference this
     wave exists to remove. */
  const [docsSigned, setDocsSigned] = useState(false);
  const [fundsReceived, setFundsReceived] = useState(false);
  const [docRef, setDocRef] = useState("");

  const both = docsSigned && fundsReceived;

  const confirmMut = useMutation({
    mutationFn: async () =>
      (
        await apiRequest(
          "POST",
          `/api/partner/me/spv/${spvId}/subscriptions/${subscriptionId}/gp-confirm`,
          {
            /* Sent as literal booleans. The server accepts STRICTLY `true` and
               refuses anything else rather than coercing, so a UI bug cannot
               turn an empty form into a commitment. */
            documentsSigned: docsSigned,
            fundsReceived: fundsReceived,
            subscriptionDocRef: docRef.trim() || undefined,
          },
        )
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId] });
      setDocsSigned(false);
      setFundsReceived(false);
      setDocRef("");
      toast({
        title: "LP confirmed",
        description:
          "Recorded as committed capital, with your affirmation of both offline conditions " +
          "stored against this subscription.",
      });
      onConfirmed?.();
    },
    onError: (e: unknown) =>
      toast({
        title: "Not confirmed",
        /* The server's own sentence, never a bare code (R77). */
        /* `serverRefusalMessage` returns null when the server sent no sentence.
           The fallback is a plain statement of what did NOT happen — never a
           bare code, and never an invented cause. */
        description:
          serverRefusalMessage(e) ??
          "This LP was not confirmed and nothing was changed. Reload the subscription to see its current stage.",
        variant: "destructive",
      }),
  });

  return (
    <div
      className="mt-4 rounded-md border p-3"
      data-testid="gp-offline-confirmation-panel"
    >
      <div className="font-medium text-sm mb-1">Confirm this LP&apos;s investment</div>
      <div
        className="text-[10px] text-[var(--cv-color-text-faint)] mb-2"
        data-testid="gp-offline-confirmation-stage"
      >
        Current stage: {stageLabel}
      </div>

      <label
        className="flex items-start gap-2 text-xs py-1"
        data-testid="gp-offline-confirmation-docs-label"
      >
        <input
          type="checkbox"
          checked={docsSigned}
          disabled={!canWrite || confirmMut.isPending}
          onChange={(ev) => setDocsSigned(ev.target.checked)}
          data-testid="gp-offline-confirmation-docs"
        />
        <span>{GP_CONFIRM_DOCS_AFFIRMATION}</span>
      </label>

      <label
        className="flex items-start gap-2 text-xs py-1"
        data-testid="gp-offline-confirmation-funds-label"
      >
        <input
          type="checkbox"
          checked={fundsReceived}
          disabled={!canWrite || confirmMut.isPending}
          onChange={(ev) => setFundsReceived(ev.target.checked)}
          data-testid="gp-offline-confirmation-funds"
        />
        <span>{GP_CONFIRM_FUNDS_AFFIRMATION}</span>
      </label>

      <div
        className="text-[10px] text-[var(--cv-color-text-muted)] mt-2"
        data-testid="gp-offline-confirmation-consequence"
      >
        {GP_CONFIRM_CONSEQUENCE_NOTICE}
      </div>

      {/* The reason the button is disabled, always rendered rather than shown
          only on hover: a disabled control with no stated reason is a dead end. */}
      <div
        className="text-[10px] text-[var(--cv-color-text-faint)] mt-1"
        data-testid="gp-offline-confirmation-blocked-hint"
      >
        {both ? "Both statements confirmed." : GP_CONFIRM_BLOCKED_HINT}
      </div>

      <div className="mt-2">
        <Button
          size="sm"
          disabled={!canWrite || !both || confirmMut.isPending}
          onClick={() => confirmMut.mutate()}
          data-testid="gp-offline-confirmation-submit"
        >
          {confirmMut.isPending ? "Confirming…" : "Confirm as committed capital"}
        </Button>
      </div>
    </div>
  );
}
