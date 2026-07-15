/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * /collective/partner/agreement — versioned click-through partner agreement.
 * Reads the current agreement version + (optional) document URL and the
 * partner's signed status from GET /api/partner/me/subscription (which returns
 * an `agreement` config block). Records acceptance via POST /api/partner/me/agreement,
 * which stamps contacts.partner_agreement_* and writes an audit_log entry
 * server-side. Nothing here is hardcoded; the version/URL come from server config.
 */
import { useState } from "react";
import { useLocation } from "wouter"; /* GROUP E 1d — post-sign redirect */
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, ApiError, queryClient } from "@/lib/queryClient";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { displayAgreementLabel, displayAgreementVersion } from "@/lib/partner/partnerAgreement"; /* GROUP E 1b — display-only label */
import { PartnerShell } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CONSORTIUM_AGREEMENT_TEXT } from "@shared/consortiumAgreement"; /* W2-I — viewable text fallback */
import { renderAgreementHtml } from "@/lib/safeAgreementHtml"; /* W5.1 — sanitized HTML render + DRAFT strip */

/* GROUP E 1d — partner dashboard destination after a successful signature. */
const PARTNER_DASHBOARD_PATH = "/collective/partner/dashboard";

/* W2-I — the page now reads the canonical GET /api/partner/me/agreement, which
   returns the viewable agreement text, the current version/url AND the DURABLE
   signed state (off the contacts column). A partner who signed at application
   sees it already-signed; an unsigned managing partner signs once here (the
   destination the requireSignedAgreement write gate redirects to). */
type AgreementResponse = {
  agreement: { version: string; url: string | null; text?: string | null; finalDocUrl?: string | null; isDraft?: boolean };
  signed: boolean;
  signedCurrent: boolean;
  signedAt: string | null;
  signedVersion: string | null;
  canSign: boolean;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function PartnerAgreementSign() {
  const role = useRequirePartnerRole();
  const { toast } = useToast();
  const [, navigate] = useLocation(); /* GROUP E 1d */
  const [accepted, setAccepted] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [signedAt, setSignedAt] = useState<string | null>(null);

  // Canonical agreement endpoint: viewable text + durable signed state.
  const { data, isLoading, isError, error } = useQuery<AgreementResponse>({
    queryKey: ["/api/partner/me/agreement"],
    enabled: role.ready && !!role.identity,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/agreement")).json(),
  });

  const signMut = useMutation({
    mutationFn: async () => {
      const body = { version: data?.agreement?.version, signatureName: signatureName.trim() };
      try {
        const j = await (await apiRequest("POST", "/api/partner/me/agreement", body)).json();
        if (!j.ok) throw new Error(j.error || "sign_failed");
        return j as { signedAt: string };
      } catch (e: any) {
        // W5.1 — STALE-VERSION guard. apiRequest throws an ApiError on non-2xx, so
        // the server's 409 agreement_version_stale surfaces here. Re-fetch the
        // current copy and ask the partner to review + sign again instead of
        // signing an outdated agreement.
        const isStale =
          (e instanceof ApiError && (e.status === 409 || (e as any).code === "agreement_version_stale")) ||
          /agreement_version_stale/i.test(String(e?.message ?? ""));
        if (isStale) {
          await queryClient.invalidateQueries({ queryKey: ["/api/partner/me/agreement"] });
          setAccepted(false);
          throw new Error("The agreement was updated. Please review the current version and sign again.");
        }
        throw e;
      }
    },
    onSuccess: (j) => {
      // onSuccess only runs when the server returned ok:true (mutationFn throws
      // otherwise), so this redirect never fires on a failed signature.
      setSignedAt(j.signedAt);
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/agreement"] });
      toast({ title: "Agreement signed" });
      navigate(PARTNER_DASHBOARD_PATH); /* GROUP E 1d — land on the partner dashboard after signing */
    },
    onError: (e: any) => toast({ title: "Could not record signature", description: e?.message, variant: "destructive" }),
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const isForbidden = isError && error instanceof ApiError && error.status === 403;
  const version = data?.agreement?.version ?? "—";
  const url = data?.agreement?.url ?? null;
  const finalDocUrl = data?.agreement?.finalDocUrl ?? null;
  const agreementText = data?.agreement?.text ?? CONSORTIUM_AGREEMENT_TEXT;
  // Already signed (current version) on the durable record, or just now.
  const alreadySigned = !!data?.signedCurrent;
  const effectiveSignedAt = signedAt ?? (alreadySigned ? data?.signedAt ?? null : null);
  const canSign = data?.canSign !== false;
  // W5.1 — render the agreement body as SANITIZED HTML (not raw pre-wrap text).
  // On the signed/final view the DRAFT watermark is stripped (final:true).
  const agreementHtml = renderAgreementHtml(agreementText, { final: !!effectiveSignedAt });

  return (
    <PartnerShell title="Partner Agreement" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      {isForbidden && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="partner-agreement-forbidden">
          The partner agreement is signed by your managing partner.
        </div>
      )}

      {!isForbidden && (
        <Card className="p-6 max-w-2xl" data-testid="partner-agreement-card">
          {/* GROUP E 1c/1b — professional document header. `version` (the raw
              server id) is still what the POST body sends; only the label shown
              here is cosmetic via displayAgreementLabel(). */}
          <div
            className="mb-5 border-b pb-4"
            style={{ borderColor: "var(--cv-color-divider)" }}
          >
            <div
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--cv-color-text-muted)" }}
            >
              Agreement
            </div>
            <div
              className="font-semibold"
              style={{
                fontFamily: "var(--cv-font-display)",
                fontSize: "var(--cv-text-xl)",
                color: "var(--cv-color-navy)",
              }}
              data-testid="partner-agreement-version"
            >
              {displayAgreementLabel(version)}
            </div>
          </div>

          {isLoading && (
            <div
              className="text-sm"
              style={{ color: "var(--cv-color-text-muted)" }}
              data-testid="partner-agreement-loading"
            >
              Loading…
            </div>
          )}

          {!isLoading && (
            <>
              <p
                className="text-sm mb-3"
                style={{ color: "var(--cv-color-text-secondary)" }}
              >
                By signing below you accept the Capavate Consortium Partner
                Agreement, which governs commission economics, SPV fees, payout
                terms, and tax compliance.
              </p>

              {/* GROUP E 1a/1c/E5 — full agreement body rendered as a styled,
                  professional legal document. The text is VERBATIM from the
                  canonical CONSORTIUM_AGREEMENT_TEXT (server-provided when
                  available); it is never rewritten here. */}
              <article
                data-testid="partner-agreement-text"
                className="mb-3 max-h-80 overflow-y-auto agreement-body"
                style={{
                  fontFamily: "var(--cv-font-body)",
                  fontSize: "var(--cv-text-sm)",
                  lineHeight: 1.7,
                  color: "var(--cv-color-text)",
                  background: "var(--cv-color-surface-cream)",
                  border: "1px solid var(--cv-color-border)",
                  borderRadius: "var(--cv-radius-lg)",
                  padding: "var(--cv-space-6)",
                  boxShadow: "var(--cv-shadow-sm)",
                }}
                /* W5.1 — sanitized HTML (escape-first + allow-list; see safeAgreementHtml.ts). */
                dangerouslySetInnerHTML={{ __html: agreementHtml }}
              />

              {/* GROUP E E5 — "View full agreement document" link. */}
              <div className="mb-3">
                <a
                  href={url ?? "#partner-agreement-text"}
                  {...(url ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="text-sm underline"
                  style={{ color: "var(--cv-color-primary)" }}
                  data-testid="link-agreement-document"
                >
                  View full agreement document
                </a>
              </div>

              {/* GROUP E 1c — counsel footnote. This is a draft for review by
                  counsel; it must NOT be misrepresented as an executed contract. */}
              <p
                className="mb-4 text-xs italic"
                style={{ color: "var(--cv-color-text-muted)" }}
                data-testid="partner-agreement-counsel-note"
              >
                This document is provided for review by counsel and does not
                constitute legal advice.
              </p>

              {effectiveSignedAt ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" data-testid="partner-agreement-signed">
                  Agreement <span className="font-medium">{displayAgreementVersion(data?.signedVersion ?? version)}</span> signed on {formatDate(effectiveSignedAt)}.
                  {/* W5.1 — FINAL-DOC SLOT: link to the counsel-executed copy when available. */}
                  {finalDocUrl && (
                    <div className="mt-2">
                      <a
                        href={finalDocUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                        style={{ color: "var(--cv-color-primary)" }}
                        data-testid="link-agreement-final-doc"
                      >
                        View executed agreement document
                      </a>
                    </div>
                  )}
                </div>
              ) : !canSign ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="partner-agreement-cannot-sign">
                  Only your managing partner can sign the Consortium Partner Agreement.
                </div>
              ) : (
                <div className="space-y-4">
                  <label className="flex items-start gap-2 text-sm text-[var(--cv-color-text-secondary)]">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                      className="mt-0.5"
                      data-testid="checkbox-agreement-accept"
                    />
                    <span>I have read and agree to the terms of the Consortium Partner Agreement ({displayAgreementVersion(version)}).</span>
                  </label>
                  <div className="space-y-1.5 max-w-sm">
                    <Label className="text-xs">Type your full name to sign</Label>
                    <Input
                      value={signatureName}
                      onChange={(e) => setSignatureName(e.target.value)}
                      placeholder="Full legal name"
                      data-testid="input-agreement-signature"
                    />
                  </div>
                  <Button
                    onClick={() => signMut.mutate()}
                    disabled={signMut.isPending || !accepted || !signatureName.trim()}
                    data-testid="button-sign-agreement"
                  >
                    Sign agreement
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </PartnerShell>
  );
}
