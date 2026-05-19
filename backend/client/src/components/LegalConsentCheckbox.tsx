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
          className="mt-0.5 border-[hsl(219_30%_65%)] data-[state=checked]:bg-[hsl(219_45%_35%)] data-[state=checked]:border-[hsl(219_45%_35%)]"
          data-testid="checkbox-legal-consent"
          aria-label="Agree to legal documents"
        />
        <Label
          htmlFor={id}
          className="text-xs text-[hsl(219_30%_35%)] leading-relaxed cursor-pointer select-none"
        >
          I have read and agree to the{" "}
          {docs.map((docId, i) => {
            const label = DOC_LABELS[docId] ?? docId;
            const isLast = i === docs.length - 1;
            const isSecondToLast = i === docs.length - 2;
            return (
              <span key={docId}>
                <button
                  type="button"
                  onClick={(e) => {
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
        </Label>
      </div>
    );
  },
);

LegalConsentCheckbox.displayName = "LegalConsentCheckbox";
