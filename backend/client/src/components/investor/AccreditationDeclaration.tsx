/* W3-B / C-5 — Accredited-investor SELF-CERTIFICATION capture surface.
 *
 * Reusable, self-contained capture card. Reads the served clause (version,
 * text, criteria, validity) + this investor's current declaration status from
 * GET /api/investor/compliance/accreditation-declaration, and records a signed
 * attestation via POST to the same route. The clause version and criterion ids
 * are ALWAYS server-authoritative — this component never sends a text blob.
 *
 * Rule #13 — the full legal name (typed signature) is MANDATORY: submit stays
 * disabled unless the acknowledgment is ticked, the signature is ≥2 chars, AND
 * at least one eligibility criterion is checked.
 *
 * Wired into the investor Collective-application flow and investor settings so
 * an individual can self-certify at apply time or re-certify later.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface AccreditationCriterion {
  id: string;
  region: string;
  label: string;
}

interface AccreditationDeclarationRow {
  id: string;
  clauseVersion: string;
  criteria: string[];
  signatureName: string;
  signedAt: string;
  jurisdiction: string | null;
}

interface AccreditationStatusResponse {
  ok: boolean;
  clause: {
    version: string;
    text: string;
    ack: string;
    criteria: AccreditationCriterion[];
    validityDays: number;
  };
  accredited: boolean;
  signedCurrent: boolean;
  declaration: AccreditationDeclarationRow | null;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const ENDPOINT = "/api/investor/compliance/accreditation-declaration";

export function AccreditationDeclaration({ onSigned }: { onSigned?: () => void } = {}) {
  const { toast } = useToast();
  const [accepted, setAccepted] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const { data, isLoading, isError } = useQuery<AccreditationStatusResponse>({
    queryKey: [ENDPOINT],
    retry: false,
    queryFn: async () => (await apiRequest("GET", ENDPOINT)).json(),
  });

  const selectedCriteria = Object.keys(checked).filter((id) => checked[id]);

  /* v26.1.x AVI-ACCRED — the sign mutation now serves BOTH the first-time
     full-form path AND the "confirm you are still accredited" re-declaration.
     When re-declaring, we reuse the criteria + signature already on the prior
     declaration (server is authoritative on criterion ids) so the confirm
     button re-POSTs the existing endpoint without forcing a full re-entry. */
  const signMut = useMutation({
    mutationFn: async (override?: { criteria?: string[]; signatureName?: string; jurisdiction?: string }) => {
      const body = {
        signatureName: (override?.signatureName ?? signatureName).trim(),
        criteria: override?.criteria ?? selectedCriteria,
        jurisdiction: (override?.jurisdiction ?? jurisdiction).trim() || undefined,
      };
      const j = await (await apiRequest("POST", ENDPOINT, body)).json();
      if (!j.ok) throw new Error(j.message || j.error || "sign_failed");
      return j as { declaration: AccreditationDeclarationRow };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ENDPOINT] });
      setAccepted(false);
      toast({ title: "Accreditation self-certification recorded" });
      onSigned?.();
    },
    onError: (e: any) =>
      toast({ title: "Could not record certification", description: e?.message, variant: "destructive" }),
  });

  const clause = data?.clause;
  const version = clause?.version ?? "—";
  const criteria = clause?.criteria ?? [];
  const alreadySignedCurrent = !!data?.signedCurrent;
  const canSubmit = accepted && signatureName.trim().length >= 2 && selectedCriteria.length > 0;

  return (
    <Card
      className="p-6"
      style={{
        background: "var(--cv-surface, #ffffff)",
        borderColor: "var(--cv-border, #e2e8f0)",
        color: "var(--cv-text, #0f172a)",
      }}
      data-testid="accreditation-card"
    >
      <div className="mb-4">
        <div className="text-xs uppercase tracking-wide" style={{ color: "var(--cv-text-muted, #64748b)" }}>
          Accredited-investor self-certification
        </div>
        <div className="text-lg font-semibold" data-testid="accreditation-version" style={{ color: "var(--cv-heading, #041e41)" }}>
          {version}
        </div>
      </div>

      {isLoading && (
        <div className="text-sm" data-testid="accreditation-loading" style={{ color: "var(--cv-text-muted, #64748b)" }}>
          Loading…
        </div>
      )}

      {isError && (
        <div
          className="rounded-md border p-4 text-sm"
          data-testid="accreditation-error"
          style={{ background: "var(--cv-warn-bg, #fffbeb)", borderColor: "var(--cv-warn-border, #fde68a)", color: "var(--cv-warn-text, #92400e)" }}
        >
          Unable to load the certification right now. Please refresh.
        </div>
      )}

      {!isLoading && !isError && clause && (
        <>
          <div
            data-testid="accreditation-text"
            className="mb-4 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border p-3 text-[13px] leading-relaxed"
            style={{ background: "var(--cv-surface-muted, #f8fafc)", borderColor: "var(--cv-border, #e2e8f0)", color: "var(--cv-text, #1e293b)" }}
          >
            {clause.text}
          </div>

          {/* v25.56 Avi item 5 — investor-grade disclosure: self-certification
              does NOT substitute for KYC/AML, which is between the investor and
              the company/founder. Plus an OPTIONAL (non-blocking) convenience
              link to the KYC document upload on the investor profile. */}
          <div
            data-testid="accreditation-kyc-disclosure"
            className="mb-4 rounded-md border p-3 text-[12px] leading-relaxed"
            style={{ background: "var(--cv-surface-muted, #f8fafc)", borderColor: "var(--cv-border, #e2e8f0)", color: "var(--cv-text-muted, #475569)" }}
          >
            <p>
              Any required KYC/AML identity verification should be completed directly
              between you and the company/founder. This self-declaration does not
              substitute for that verification, and Capavate does not perform it on
              your behalf.
            </p>
            <p className="mt-2">
              <a
                href="/investor/profile"
                className="underline"
                data-testid="link-optional-kyc-upload"
                style={{ color: "var(--cv-link, #2563eb)" }}
              >
                Optional: upload KYC documents (not required)
              </a>
            </p>
          </div>

          {/* v26.1.x AVI-ACCRED — confirm-vs-first-time. Branch on the presence
              of a declaration (valid OR lapsed), NOT only signedCurrent: an
              investor whose declaration exists always sees the signed summary
              plus a working "Confirm you are still accredited" re-declaration
              (append-only re-POST via the existing endpoint). Only a truly
              first-time investor (declaration == null) gets the full form. */}
          {data?.declaration ? (
            <div className="space-y-3">
              <div
                className="rounded-md border p-4 text-sm"
                data-testid="accreditation-signed"
                style={{ background: "var(--cv-ok-bg, #ecfdf5)", borderColor: "var(--cv-ok-border, #a7f3d0)", color: "var(--cv-ok-text, #065f46)" }}
              >
                Self-certification <span className="font-medium">{data.declaration.clauseVersion}</span> signed on{" "}
                {formatDate(data.declaration.signedAt)} by{" "}
                <span className="font-medium">{data.declaration.signatureName}</span>. Valid for {clause.validityDays} days.
                {!alreadySignedCurrent && (
                  <span data-testid="accreditation-reconfirm-needed">
                    {" "}This declaration is no longer current — please re-confirm below.
                  </span>
                )}
              </div>
              <div
                className="rounded-md border p-4 text-sm"
                data-testid="accreditation-reconfirm"
                style={{ background: "var(--cv-surface-muted, #f8fafc)", borderColor: "var(--cv-border, #e2e8f0)", color: "var(--cv-text, #334155)" }}
              >
                <p className="mb-3">
                  If your accredited-investor status is unchanged, confirm your
                  declaration is still accurate. This records a new dated
                  self-certification on your profile.
                </p>
                <Button
                  onClick={() =>
                    signMut.mutate({
                      criteria: data.declaration!.criteria,
                      signatureName: data.declaration!.signatureName,
                      jurisdiction: data.declaration!.jurisdiction ?? undefined,
                    })
                  }
                  disabled={signMut.isPending}
                  data-testid="button-confirm-accreditation"
                >
                  Confirm you are still accredited
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Select every criterion that applies to you</Label>
                {criteria.map((c) => (
                  <label key={c.id} className="flex items-start gap-2 text-sm" style={{ color: "var(--cv-text, #334155)" }}>
                    <input
                      type="checkbox"
                      checked={!!checked[c.id]}
                      onChange={(e) => setChecked((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                      className="mt-0.5"
                      data-testid={`checkbox-accred-${c.id}`}
                    />
                    <span>
                      <span className="mr-1 rounded px-1 text-[10px] font-medium uppercase" style={{ background: "var(--cv-chip-bg, #eef2ff)", color: "var(--cv-chip-text, #3730a3)" }}>
                        {c.region}
                      </span>
                      {c.label}
                    </span>
                  </label>
                ))}
              </div>

              <div className="space-y-1.5 max-w-sm">
                <Label className="text-xs">Jurisdiction (optional)</Label>
                <Input
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value)}
                  placeholder="e.g. United States, United Kingdom"
                  data-testid="input-accred-jurisdiction"
                />
              </div>

              <label className="flex items-start gap-2 text-sm" style={{ color: "var(--cv-text, #334155)" }}>
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="mt-0.5"
                  data-testid="checkbox-accred-accept"
                />
                <span>{clause.ack}</span>
              </label>

              <div className="space-y-1.5 max-w-sm">
                <Label className="text-xs">Type your full legal name to sign</Label>
                <Input
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder="Full legal name"
                  data-testid="input-accred-signature"
                />
              </div>

              <Button
                onClick={() => signMut.mutate(undefined)}
                disabled={signMut.isPending || !canSubmit}
                data-testid="button-sign-accreditation"
              >
                Sign self-certification
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default AccreditationDeclaration;
