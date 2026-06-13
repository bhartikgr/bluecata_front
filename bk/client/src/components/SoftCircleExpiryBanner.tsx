/**
 * Sprint 14 D6 — Soft-circle expiry countdown banner.
 *
 * Displays a 14-day countdown for an investor's pending soft-circle. Copy is
 * locked to the verbatim string from `softCircleExpiryRunner.ts`:
 *     "Your soft-circle expires in {N} day(s) — confirm or release"
 *
 * Renders nothing if the soft-circle is missing or already past expiry —
 * the soft-circle expiry runner handles those server-side.
 */
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const SOFT_CIRCLE_EXPIRY_DAYS = 14;

export interface SoftCircleExpiryBannerProps {
  /** ISO timestamp of when the soft-circle was submitted. */
  submittedAtIso: string;
  onConfirm?: () => void;
  onRelease?: () => void;
  /** When true, hides the action buttons (read-only). */
  readOnly?: boolean;
}

export function daysRemaining(submittedAtIso: string, nowMs: number = Date.now()): number {
  const submittedMs = new Date(submittedAtIso).getTime();
  const elapsedMs = nowMs - submittedMs;
  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  return Math.max(0, SOFT_CIRCLE_EXPIRY_DAYS - elapsedDays);
}

export function expiryBannerCopy(daysLeft: number): string {
  return `Your soft-circle expires in ${daysLeft} day(s) — confirm or release`;
}

export function SoftCircleExpiryBanner({ submittedAtIso, onConfirm, onRelease, readOnly = false }: SoftCircleExpiryBannerProps) {
  const daysLeft = daysRemaining(submittedAtIso);
  if (daysLeft <= 0) return null;

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
        {expiryBannerCopy(daysLeft)}
      </span>
      {!readOnly && (
        <div className="flex items-center gap-1.5">
          {onConfirm && (
            <Button
              size="sm"
              className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white h-7"
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
