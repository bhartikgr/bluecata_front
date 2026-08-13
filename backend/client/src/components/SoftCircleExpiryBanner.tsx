/**
 * Sprint 14 D6 — Soft-circle expiry countdown banner.
 *
 * Wave 38 · Row 5: this component previously re-implemented the countdown and
 * the copy, and its copy did NOT match the runner ("day(s)" vs "day"/"days").
 * Both now come from `@shared/softCircleExpiry`, the same module
 * `server/lib/softCircleExpiryRunner.ts` imports, so the banner an investor
 * reads and the runner that lapses the soft-circle can never disagree.
 *
 * `softCircledAtIso` MUST be the server decision record's derived
 * `softCircledAt` (GET /api/rounds/:roundId/invitations/:invId/decision), which
 * is read off the durable decision history. It is never a client-held value and
 * never a guess: when the server cannot supply the timestamp the banner renders
 * NOTHING rather than show an investor a date we invented.
 *
 * Renders nothing when the soft-circle is missing or already past expiry — the
 * expiry runner handles those server-side.
 */
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  daysRemaining,
  expiryBannerCopyForDays,
  SOFT_CIRCLE_EXPIRY_DAYS,
} from "@shared/softCircleExpiry";

export { daysRemaining, SOFT_CIRCLE_EXPIRY_DAYS };

export interface SoftCircleExpiryBannerProps {
  /**
   * ISO timestamp of when the soft-circle entered the `soft_circled` state, as
   * reported by the server decision record. `null`/`undefined` means the server
   * did not supply one — render nothing.
   */
  softCircledAtIso: string | null | undefined;
  onConfirm?: () => void;
  onRelease?: () => void;
  /** When true, hides the action buttons (read-only). */
  readOnly?: boolean;
}

export function SoftCircleExpiryBanner({ softCircledAtIso, onConfirm, onRelease, readOnly = false }: SoftCircleExpiryBannerProps) {
  if (!softCircledAtIso) return null;
  const daysLeft = daysRemaining(softCircledAtIso);
  // `null` = unparseable timestamp. Refuse to render rather than guess.
  if (daysLeft === null || daysLeft <= 0) return null;

  // Tone shifts: 4-7 days = warning, ≤3 = urgent
  const urgent = daysLeft <= 3;
  const toneClass = urgent
    ? "border-[hsl(7_61%_43%)]/40 bg-[hsl(7_61%_43%)]/8 text-[hsl(7_61%_43%)]"
    : "border-amber-300/60 bg-amber-50 text-amber-900";

  return (
    <div
      role="alert"
      data-testid="soft-circle-expiry-banner"
      data-days-left={daysLeft}
      className={`flex items-center gap-3 rounded-md border px-4 py-2.5 text-sm ${toneClass}`}
    >
      <AlertTriangle className={`h-4 w-4 shrink-0 ${urgent ? "" : "text-amber-700"}`} />
      <span className="flex-1 font-medium" data-testid="text-expiry-copy">
        {expiryBannerCopyForDays(daysLeft)}
      </span>
      {!readOnly && (
        <div className="flex items-center gap-1.5">
          {onConfirm && (
            <Button
              size="sm"
              className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white h-7"
              onClick={onConfirm}
              data-testid="button-expiry-confirm"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Confirm
            </Button>
          )}
          {onRelease && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={onRelease}
              data-testid="button-expiry-release"
            >
              <X className="h-3.5 w-3.5 mr-1" /> Release
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
