/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * /collective/partner/agreement — versioned click-through partner agreement.
 * Reads the current agreement version + (optional) document URL and the
 * partner's signed status from GET /api/partner/me/subscription (which returns
 * an `agreement` config block). Records acceptance via POST /api/partner/me/agreement,
 * which stamps contacts.partner_agreement_* and writes an audit_log entry
 * server-side. Nothing here is hardcoded; the version/URL come from server config.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, ApiError, queryClient } from "@/lib/queryClient";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CONSORTIUM_AGREEMENT_TEXT } from "@shared/consortiumAgreement"; /* W2-I — viewable text fallback */

/* W2-I — the page now reads the canonical GET /api/partner/me/agreement, which
   returns the viewable agreement text, the current version/url AND the DURABLE
   signed state (off the contacts column). A partner who signed at application
   sees it already-signed; an unsigned managing partner signs once here (the
   destination the requireSignedAgreement write gate redirects to). */
type AgreementResponse = {
  agreement: { version: string; url: string | null; text?: string | null };
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
      const j = await (await apiRequest("POST", "/api/partner/me/agreement", body)).json();
      if (!j.ok) throw new Error(j.error || "sign_failed");
      return j as { signedAt: string };
    },
    onSuccess: (j) => {
      setSignedAt(j.signedAt);
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/agreement"] });
      toast({ title: "Agreement signed" });
    },
    onError: (e: any) => toast({ title: "Could not record signature", description: e?.message, variant: "destructive" }),
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const isForbidden = isError && error instanceof ApiError && error.status === 403;
  const version = data?.agreement?.version ?? "—";
  const url = data?.agreement?.url ?? null;
  const agreementText = data?.agreement?.text ?? CONSORTIUM_AGREEMENT_TEXT;
  // Already signed (current version) on the durable record, or just now.
  const alreadySigned = !!data?.signedCurrent;
  const effectiveSignedAt = signedAt ?? (alreadySigned ? data?.signedAt ?? null : null);
  const canSign = data?.canSign !== false;

  return (
    <PartnerShell title="Partner Agreement" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      {isForbidden && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="partner-agreement-forbidden">
          The partner agreement is signed by your managing partner.
        </div>
      )}

      {!isForbidden && (
        <Card className="p-6 max-w-2xl" data-testid="partner-agreement-card">
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Current version</div>
            <div className="text-lg font-semibold text-[#041e41]" data-testid="partner-agreement-version">{version}</div>
          </div>

          {isLoading && <div className="text-sm text-slate-500" data-testid="partner-agreement-loading">Loading…</div>}

          {!isLoading && (
            <>
              <p className="text-sm text-slate-700 mb-3">
                By signing below you accept the Capavate Consortium Partner Agreement
                {url ? <> (full text also <a href={url} target="_blank" rel="noreferrer" className="text-[#cc0001] hover:underline">available here</a>)</> : null},
                which governs commission economics, SPV fees, payout terms, and tax compliance.
              </p>

              {/* W2-I — full viewable agreement body (read-only). */}
              <div
                data-testid="partner-agreement-text"
                className="mb-4 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-800"
              >
                {agreementText}
              </div>

              {effectiveSignedAt ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" data-testid="partner-agreement-signed">
                  Agreement <span className="font-medium">{data?.signedVersion ?? version}</span> signed on {formatDate(effectiveSignedAt)}.
                </div>
              ) : !canSign ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="partner-agreement-cannot-sign">
                  Only your managing partner can sign the Consortium Partner Agreement.
                </div>
              ) : (
                <div className="space-y-4">
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                      className="mt-0.5"
                      data-testid="checkbox-agreement-accept"
                    />
                    <span>I have read and agree to the terms of the Consortium Partner Agreement ({version}).</span>
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
