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
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { CollectiveLegalCopy, CollectiveLegalCopySlot } from "@shared/collectiveLegalCopy";

/* WAVE 215 — the criterion now carries its jurisdiction and how far the platform
   can stand behind any figure in its label. Both are optional so a criterion
   served under a superseded clause version still renders. */
type ThresholdConfidence = "verified" | "counsel_ratified" | "unverified";

interface AccreditationCriterion {
  id: string;
  region: string;
  label: string;
  jurisdiction?: string;
  confidence?: ThresholdConfidence;
  counselNote?: string;
  source?: string;
}

interface AccreditationJurisdictionDef {
  code: string;
  name: string;
  label: string;
  aliases?: string[];
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
    /* WAVE 215 — served by the route so the surface cannot invent a tenth
       jurisdiction or a criterion the server would refuse. */
    jurisdictions?: AccreditationJurisdictionDef[];
    criteriaByJurisdiction?: Record<string, AccreditationCriterion[]>;
    posture?: string;
    clauseTextSha256?: string | null;
  };
  accredited: boolean;
  signedCurrent: boolean;
  declaration: AccreditationDeclarationRow | null;
  /* WAVE 215 — the wording the stored declaration was actually signed under. */
  signedClause?: {
    version: string;
    text: string | null;
    textSha256: string | null;
    criteria: AccreditationCriterion[];
    supersededByCurrentVersion: boolean;
  } | null;
}

/**
 * WAVE 215 — resolve typed free text to one of the SERVED jurisdiction codes.
 * The candidate list comes from the server payload, never from a list hardcoded
 * here, so this surface cannot offer a jurisdiction the capture route would then
 * refuse. Returns `""` when the text resolves to nothing, which leaves the
 * selection untouched rather than guessing.
 */
function resolveTypedJurisdiction(raw: string, defs: AccreditationJurisdictionDef[]): string {
  const needle = raw.trim().toLowerCase();
  if (!needle) return "";
  for (const j of defs) {
    if (needle === j.code.toLowerCase()) return j.code;
    if (needle === j.name.toLowerCase()) return j.code;
    if ((j.aliases ?? []).some((a) => a.toLowerCase() === needle)) return j.code;
  }
  return "";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const ENDPOINT = "/api/investor/compliance/accreditation-declaration";

/* W2 A7 — optional legal-copy slot props. Callers (e.g. the Collective
   first-sign-on blocker) may pass either `legalCopy` directly (already
   fetched, e.g. from `GET /api/collective/gate-state`) or a `copySlot`
   identifier for future direct-fetch callers. When present we render the
   `accreditation_declaration_indemnity` slot body + NON-LEGAL-ADVICE badge
   above the existing clause text. Neither prop changes any existing
   behavior, testids, or the KYC-is-separate disclosure below. */
export function AccreditationDeclaration({
  onSigned,
  copySlot,
  legalCopy,
}: {
  onSigned?: () => void;
  copySlot?: CollectiveLegalCopySlot;
  legalCopy?: CollectiveLegalCopy;
} = {}) {
  const { toast } = useToast();
  const [accepted, setAccepted] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  /* WAVE 215 — the ONE jurisdiction being declared under. Empty means nothing has
     been chosen, and nothing can be signed while it is empty. */
  const [jurisdictionCode, setJurisdictionCode] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  /* WAVE 215 — quick-find, APPENDED rather than folded into the text box's own
     onChange (see R143.1 note at that input). Typing a country name or code in the
     free-text box selects the matching jurisdiction above; text that matches
     nothing leaves the selection alone rather than guessing. This never becomes
     the declared jurisdiction — only the selector's value is submitted. */
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
        criteria: override?.criteria ?? submittableCriteria,
        /* WAVE 215 — the SELECTED code is what is declared under. The free-text
           box is a quick-find for the selector (below), not a second source of
           truth: two disagreeing jurisdiction fields is how a declaration ends
           up recorded against a country the investor never chose. */
        jurisdiction: (override?.jurisdiction ?? jurisdictionCode).trim() || undefined,
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

  /* WAVE 215 — THE CLOSURE OF THE BLANKET TICK, ON THE SURFACE.
     Only the chosen jurisdiction's criteria are offered. Until a jurisdiction is
     chosen the list is EMPTY, so there is no state of this form in which an
     investor can tick an eligibility box that is not tied to a named regime.
     `clause.criteriaByJurisdiction` is served by the route; the flat
     `clause.criteria` is retained for callers reading the older shape and is used
     only as a filter fallback, never as an unscoped list to render. */
  const jurisdictionDefs = clause?.jurisdictions ?? [];
  const scopedCriteria: AccreditationCriterion[] = jurisdictionCode
    ? (clause?.criteriaByJurisdiction?.[jurisdictionCode] ??
       criteria.filter((c) => c.jurisdiction === jurisdictionCode))
    : [];

  /* Ticks that belong to a jurisdiction other than the current selection are not
     submitted, so switching jurisdiction cannot silently carry a foreign
     criterion into the declaration. */
  const scopedIds = new Set(scopedCriteria.map((c) => c.id));
  const submittableCriteria = selectedCriteria.filter((id) => scopedIds.has(id));

  /* The appended quick-find. Runs only when the free-text box changes and only
     when it resolves to one of the SERVED codes. */
  useEffect(() => {
    const resolved = resolveTypedJurisdiction(jurisdiction, jurisdictionDefs);
    if (resolved) setJurisdictionCode(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jurisdiction, clause?.version]);

  const canSubmit =
    accepted &&
    signatureName.trim().length >= 2 &&
    jurisdictionCode.trim().length > 0 &&
    submittableCriteria.length > 0;

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
          {legalCopy && (
            <div
              className="mb-4 rounded-md border p-3 text-[12px] leading-relaxed"
              style={{ background: "var(--cv-surface-muted, #f8fafc)", borderColor: "var(--cv-border, #e2e8f0)", color: "var(--cv-text-muted, #475569)" }}
              data-testid={`collective-legal-copy-${legalCopy.slot}`}
            >
              <div className="mb-1.5 flex items-center gap-2">
                {legalCopy.status === "NON_LEGAL_ADVICE" && (
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide" data-testid={`badge-non-legal-advice-${legalCopy.slot}`}>
                    NON-LEGAL-ADVICE
                  </Badge>
                )}
                {legalCopy.title && <span className="text-xs font-semibold">{legalCopy.title}</span>}
              </div>
              <p className="whitespace-pre-wrap">{legalCopy.body}</p>
            </div>
          )}
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

          {/* WAVE 215 / ITEM C — the platform's ACTUAL posture, on screen, in the
              same register as the KYC disclosure above rather than a weaker one.
              Capavate records a declaration. It does not check it. Nothing in
              this flow is described as verified, and this panel exists so the
              investor does not have to infer that from an absence. */}
          <div
            data-testid="accreditation-posture-disclosure"
            className="mb-4 rounded-md border p-3 text-[12px] leading-relaxed"
            style={{ background: "var(--cv-warn-bg, #fffbeb)", borderColor: "var(--cv-warn-border, #fde68a)", color: "var(--cv-warn-text, #92400e)" }}
          >
            <p className="font-semibold">This records your declaration. It is not a check of it.</p>
            <p className="mt-1">
              What you sign here is your own statement about your own eligibility.
              Capavate stores it, timestamps it and can produce it later. Capavate
              does not confirm it, does not assess whether it is correct, and does
              not perform any verification on your behalf. Where the law requires
              an issuer to take reasonable steps to confirm an investor's status,
              that obligation sits with the issuer and with you.
            </p>
            <p className="mt-1">
              Some criteria are shown as awaiting confirmation by local counsel.
              Where Capavate cannot support a threshold figure from a primary
              source, the criterion names the test and states no figure, rather
              than showing you a number we cannot stand behind.
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
                {/* WAVE 215 — SIBLING, not a rewrite of the sentence above. That
                    sentence fires on a clause-VERSION difference, which is not the
                    same thing as an expiry: the wording was corrected, the
                    declaration was not cancelled. Saying only "no longer current"
                    reads as "you are no longer accredited", which would be false
                    and would push an eligible investor to think they are blocked. */}
                {!alreadySignedCurrent && (
                  <span data-testid="accreditation-version-not-expiry">
                    {" "}Your declaration remains on file and continues to count for
                    the {clause.validityDays} days from the date you signed it.
                    Re-confirming records the corrected wording; it does not
                    reinstate anything.
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
              {/* WAVE 215 — JURISDICTION FIRST, AND REQUIRED.
                  Eligibility tests are not interchangeable between countries, so
                  the regime is chosen before any criterion is offered. This is
                  also the structural reason no blanket assertion is possible on
                  this surface: the criteria list below renders nothing at all
                  until one of the nine regimes is selected. */}
              <div className="space-y-1.5 max-w-sm">
                <Label className="text-xs">Which jurisdiction are you declaring under? (required)</Label>
                <select
                  value={jurisdictionCode}
                  onChange={(e) => setJurisdictionCode(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  style={{ background: "var(--cv-surface, #ffffff)", borderColor: "var(--cv-border, #e2e8f0)", color: "var(--cv-text, #0f172a)" }}
                  data-testid="select-accred-jurisdiction"
                >
                  <option value="">Select one jurisdiction…</option>
                  {jurisdictionDefs.map((j) => (
                    <option key={j.code} value={j.code}>
                      {j.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] leading-relaxed" data-testid="accreditation-one-jurisdiction-note" style={{ color: "var(--cv-text-muted, #64748b)" }}>
                  You declare under one jurisdiction at a time. There is no single
                  worldwide eligibility statement, because each regulator sets its
                  own test and the tests do not recognise one another.
                </p>
              </div>

              <div className="space-y-1.5 max-w-sm">
                <Label className="text-xs">Jurisdiction (optional)</Label>
                <Input
                  value={jurisdiction}
                  /* R143.1 — HANDLER EXPRESSION RESTORED VERBATIM. An earlier cut
                     of this wave folded the jurisdiction quick-find into this
                     handler, which the silent-drop guard correctly reported as a
                     REMOVED event handler: replacing a handler expression is a
                     drop, exactly as replacing a copy literal is. The quick-find
                     now lives in an appended effect below instead. */
                  onChange={(e) => setJurisdiction(e.target.value)}
                  placeholder="e.g. United States, United Kingdom"
                  data-testid="input-accred-jurisdiction"
                />
                <p className="text-[11px]" data-testid="accreditation-jurisdiction-typeahead-note" style={{ color: "var(--cv-text-muted, #64748b)" }}>
                  Type a country to jump to it in the list above. The list is what
                  gets recorded.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Select every criterion that applies to you</Label>
                {!jurisdictionCode && (
                  <p className="text-sm" data-testid="accreditation-criteria-locked" style={{ color: "var(--cv-text-muted, #64748b)" }}>
                    Choose your jurisdiction above to see the eligibility criteria it
                    sets. Nothing can be signed until you do.
                  </p>
                )}
                {scopedCriteria.map((c) => (
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
                      {/* WAVE 215 — an unconfirmed threshold is LABELLED as one,
                          rather than dressed up as settled law. Capavate's own
                          research marks these [UNVERIFIED]; that marking is
                          carried through to the investor instead of being
                          quietly upgraded. */}
                      {c.confidence === "unverified" && (
                        <span className="mr-1 rounded px-1 text-[10px] font-semibold uppercase" data-testid={`marker-accred-unverified-${c.id}`} style={{ background: "var(--cv-warn-bg, #fffbeb)", color: "var(--cv-warn-text, #92400e)" }}>
                          [UNVERIFIED]
                        </span>
                      )}
                      {c.label}
                      {c.counselNote && (
                        <span className="mt-1 block text-[11px] leading-relaxed" data-testid={`note-accred-counsel-${c.id}`} style={{ color: "var(--cv-warn-text, #92400e)" }}>
                          Awaiting confirmation by local counsel: {c.counselNote}
                        </span>
                      )}
                      {c.source && (
                        <span className="mt-0.5 block text-[11px]" data-testid={`note-accred-source-${c.id}`} style={{ color: "var(--cv-text-muted, #64748b)" }}>
                          Basis: {c.source}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
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
