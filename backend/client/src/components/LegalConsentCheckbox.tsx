/**
 * LegalConsentCheckbox — reusable inline consent widget.
 *
 * Renders: "I have read and agree to the [Terms of Service](#), [Privacy Policy](#), ..."
 * Each inline link calls openDrawer(docId) to open the doc in the drawer.
 *
 * Props:
 *   docs     — which document IDs to reference
 *   context  — consent context string for POST /api/legal/consent
 *   required — block form submit if unchecked (default: true)
 *   onConsentRecorded — called after the server confirms all consents
 *
 * Usage via ref:
 *   const ref = useRef<LegalConsentCheckboxRef>(null);
 *   <LegalConsentCheckbox ref={ref} docs={["terms","privacy"]} context="signup" />
 *   await ref.current?.recordConsent(); // call in form submit handler
 *
 * Or self-contained with onConsentRecorded callback.
 */
import { forwardRef, useImperativeHandle, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useLegalDrawer } from "@/lib/legalDrawer";
import type { LegalDocId } from "@/lib/legalDrawer";

const DOC_LABELS: Record<LegalDocId, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
  cookies: "Cookie Policy",
  "acceptable-use": "Acceptable Use Policy",
  disclaimer: "Disclaimer",
};

export interface LegalConsentCheckboxProps {
  docs: LegalDocId[];
  context: string;
  required?: boolean;
  onConsentRecorded?: () => void;
  /** Called whenever the checked state changes. */
  onCheckedChange?: (checked: boolean) => void;
  /** If true, the checkbox is disabled (e.g., already consented). */
  disabled?: boolean;
}

export interface LegalConsentCheckboxRef {
  checked: boolean;
  /** Call this after the main form submission to persist consent server-side. */
  recordConsent: () => Promise<boolean>;
}

export const LegalConsentCheckbox = forwardRef<LegalConsentCheckboxRef, LegalConsentCheckboxProps>(
  ({ docs, context, required = true, onConsentRecorded, onCheckedChange, disabled }, ref) => {
    const [checked, setChecked] = useState(false);
    const [recording, setRecording] = useState(false);
    const { openDrawer } = useLegalDrawer();

    useImperativeHandle(ref, () => ({
      checked,
      recordConsent: async () => {
        if (!checked) return false;
        setRecording(true);
        try {
          await apiRequest("POST", "/api/legal/consent", {
            documentIds: docs,
            context,
          });
          onConsentRecorded?.();
          return true;
        } catch {
          return false;
        } finally {
          setRecording(false);
        }
      },
    }));

    const id = `legal-consent-${docs.join("-")}-${context}`;

    return (
      <div className="flex items-start gap-2.5 py-2" data-testid="legal-consent-checkbox">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(v) => { const c = Boolean(v); setChecked(c); onCheckedChange?.(c); }}
          disabled={disabled || recording}
          required={required}
          /* 23-May Fix 5 (Issue 7 P0 blocker) — guarantees the box is
           * visible in unchecked state on white card backgrounds AND that
           * the checkmark icon is visible in checked state.
           *   - h-5 w-5: larger hit target (was 4×4)
           *   - border-2 border-[hsl(219_45%_35%)]: 2px saturated indigo
           *     border so the unchecked box reads as a tappable control
           *   - bg-white shadow-sm: explicit white fill + subtle shadow
           *   - data-[state=checked]:bg + border: filled indigo when checked
           *   - data-[state=checked]:text-white: makes the Check lucide
           *     icon (which inherits currentColor in the Indicator) render
           *     in white against the indigo fill — the previous
           *     text-primary-foreground was occasionally indistinguishable
           *     from the fill in some shadcn theme overrides.
           *   - focus-visible ring kept (inherited from base Checkbox) so
           *     keyboard users still get the outline.
           */
          className="mt-0.5 h-5 w-5 border-2 border-[hsl(219_45%_35%)] bg-white shadow-sm data-[state=checked]:bg-[hsl(219_45%_35%)] data-[state=checked]:border-[hsl(219_45%_35%)] data-[state=checked]:text-white"
          data-testid="checkbox-legal-consent"
          aria-label="Agree to legal documents"
        />
        {/* v23.4.6 Phase 1 (L-001) — the document-opener buttons are siblings
         * of <Label>, NOT children. Nesting <button> inside <label> is invalid
         * HTML and triggers the parent label's "toggle bound checkbox" click
         * handler on every internal click — including clicks on the Terms /
         * Privacy links — which silently unchecked the consent box and blocked
         * founder signup. The <Label htmlFor={id}> now wraps ONLY the leading
         * "I have read and agree to the" text. Each link is a separate
         * <button type="button"> with stopPropagation + preventDefault to be
         * defensive against any future ancestor toggle handlers.
         */}
        <div className="text-xs text-[hsl(219_30%_35%)] leading-relaxed select-none">
          <Label
            htmlFor={id}
            className="text-xs text-[hsl(219_30%_35%)] leading-relaxed cursor-pointer select-none"
          >
            I have read and agree to the
          </Label>
          {" "}
          {docs.map((docId, i) => {
            const label = DOC_LABELS[docId] ?? docId;
            const isLast = i === docs.length - 1;
            const isSecondToLast = i === docs.length - 2;
            return (
              <span key={docId}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    openDrawer(docId);
                  }}
                  className="text-[hsl(300_60%_35%)] underline underline-offset-2 hover:text-[hsl(300_60%_25%)] font-medium"
                  data-testid={`link-legal-doc-${docId}`}
                >
                  {label}
                </button>
                {!isLast && (isSecondToLast ? ", and " : ", ")}
              </span>
            );
          })}
          .
        </div>
      </div>
    );
  },
);

LegalConsentCheckbox.displayName = "LegalConsentCheckbox";
