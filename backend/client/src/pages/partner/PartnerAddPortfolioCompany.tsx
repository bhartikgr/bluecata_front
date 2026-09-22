/**
 * Wave B1 (v26.1.x Consortium Partner QA, slide 3a) — "Add Portfolio Company".
 *
 * Rendered NATIVELY inside the Consortium Partner shell (no iframe, per Ozan) so
 * it inherits the reskin + session. It creates a GENUINELY NET-NEW, INDEPENDENT
 * Capavate company via the canonical company engine, tags it to this partner,
 * adds it to the partner's Pipeline, and issues a founder OWNER invitation by
 * email. The founder claims the account via the returned link and finishes the
 * FULL company profile in Capavate's own builder — they never touch the partner
 * section.
 */
import { useMemo, useRef, useState } from "react";
/* WAVE 115 · FINDING 1 sweep — a row must not be identified by a raw storage key. */
import { partyReferenceLabel } from "@/lib/partnerDisplay";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { PartnerSurfaceGuide } from "@/components/partner/PartnerSurfaceGuide"; /* WAVE C · ITEM 10a */
import { AppCard } from "@/components/ui/app-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FounderInvitationStatus } from "@/components/partner/FounderInvitationStatus";
import {
  capturePortfolioCompany, invitationHandoffCopy, invalidateFounderInvitationQueries,
  type FounderInvitation, type ReviewedPortfolioCompany,
} from "@/lib/portfolioFounderInvitation";
import { describeFailure } from "@/lib/failureMessage";
/* WAVE A2 · ITEMS 5a + 5b — the dropdowns bind to lists that ALREADY EXIST.
   Sector -> the DB-backed company-sector taxonomy (`taxonomy_terms`, migration
   0236, read via `useCompanySectorTaxonomy`; slide13b WAVE D replaced the
   hardcoded `COLLECTIVE_SECTORS_45` read — the constant is now only the seed),
   Stage -> `COLLECTIVE_STAGES` (7 members, shared/schema.ts), HQ country ->
   `COUNTRIES` (250 members, client/src/lib/profile/data/countries.ts). No list is
   created here and none is hardcoded. Each existing free-text `<Input>` is KEPT beside its
   dropdown: it is the entry path for anything the standard list does not cover,
   and `canonicalSelectOptions` guarantees the select can always represent whatever
   is in the box, so nothing is ever coerced to a neighbouring option (R195.5,
   R242). */
import { COLLECTIVE_STAGES } from "@shared/schema";
/* slide13b WAVE D — sectors come from the database, never a static array. On
   fetch failure the select is disabled (current value kept, free text still
   works); there is NO fallback list. */
import {
  COMPANY_TAXONOMY_ERROR_COPY,
  COMPANY_TAXONOMY_LOADING_COPY,
  useCompanySectorTaxonomy,
} from "@/lib/companyTaxonomy";
import { COUNTRIES } from "@/lib/profile/data/countries";
import {
  CANONICAL_FREE_TEXT_HINT,
  CANONICAL_SELECT_CLASS,
  canonicalSelectOptions,
  composeHq,
  hqCityPart,
  hqCountryPart,
} from "@/lib/canonicalFieldOptions";
/* WAVE 214 · surface 1 — the statement below is the SAME literal the server
   hashes (`shared/wave214ThirdPartyAuthorityCopy.ts`). One literal, two
   importers: if the screen owned its own copy, the recorded sha256 would attest
   to the server's text while the user read the screen's, and the two would drift
   silently on the first copy edit (R187.3). */
import {
  WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
  WAVE214_PORTFOLIO_COMPANY_CONSEQUENCE,
  WAVE214_TYPED_NAME_LABEL,
} from "@shared/wave214ThirdPartyAuthorityCopy";

/* WAVE A2 · ITEM 5b — the country NAMES, derived from the same 250-member
   `COUNTRIES` record the profile pickers use. Module scope: one derivation, not
   one per render. */
const COUNTRY_NAMES: readonly string[] = COUNTRIES.map((c) => c.name);

interface CreateResult {
  ok: boolean;
  companyId: string;
  attributedPartnerId: string;
  founderInvite: FounderInvitation | null;
}

export default function PartnerAddPortfolioCompany() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [companyName, setCompanyName] = useState("");
  /* WAVE 126 / FINDING 5 — has the client interacted with the name field yet?
     Without this the form refuses a field nobody has touched. */
  const [touchedCompanyName, setTouchedCompanyName] = useState(false);
  const [founderEmail, setFounderEmail] = useState("");
  const [founderName, setFounderName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [sector, setSector] = useState("");
  /* slide13b WAVE D — DB-backed sector list. `sectorValues` are the ACTIVE
     stored values in the API's alphabetical order; `canonicalSelectOptions`
     keeps any off-list / retired value already in `sector` representable. */
  const sectorTaxonomy = useCompanySectorTaxonomy();
  const sectorValues = useMemo(() => (sectorTaxonomy.data ?? []).map((t) => t.value), [sectorTaxonomy.data]);
  const sectorLabelFor = useMemo(() => {
    const m = new Map((sectorTaxonomy.data ?? []).map((t) => [t.value, t.label] as const));
    return (v: string) => m.get(v) ?? v;
  }, [sectorTaxonomy.data]);
  const [stage, setStage] = useState("");
  const [hq, setHq] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [reviewed, setReviewed] = useState<ReviewedPortfolioCompany | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [integrityWarning, setIntegrityWarning] = useState("");

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(founderEmail.trim());

  /* WAVE 214 · surface 1 — the typed-name authority confirmation. A typed name
     rather than a tick because this surface creates an ACCOUNT for someone else:
     a tick records that a control was in a state, a typed name records that a
     specific human put their own name to a specific assertion. */
  const [authorityTypedName, setAuthorityTypedName] = useState("");
  const create = useMutation({
    mutationFn: async (snapshot: ReviewedPortfolioCompany): Promise<CreateResult> => {
      // The exact reviewed, frozen DOM snapshot is the mutation argument.
      // Never recapture ambient React state or substitute the acting partner.
      const res = await apiRequest("POST", "/api/partner/me/portfolio-companies", snapshot);
      return res.json();
    },
    onSuccess: (data, snapshot) => {
      setResult(data);
      setCopied(false);
      setReviewed(null);
      void invalidateFounderInvitationQueries(qc, data.companyId);
      if (!data.founderInvite || data.founderInvite.email !== snapshot.founderEmail ||
          (data.founderInvite.name ?? "") !== snapshot.founderName) {
        const warning = `Recipient integrity warning: reviewed ${snapshot.founderEmail} (${snapshot.founderName || "name not provided"}); server returned ${data.founderInvite?.email ?? "no recipient"} (${data.founderInvite?.name || "name not provided"}). Do not share a claim link. Refresh the invitation status and contact support.`;
        setIntegrityWarning(warning);
        toast({ variant: "destructive", title: "Company saved; invitation needs review", description: warning });
        return;
      }
      const failed = data.founderInvite.handoff.result === "failed" || data.founderInvite.handoff.result === "unknown";
      toast({ ...(failed ? { variant: "destructive" as const } : {}),
        title: failed ? "Company saved; invitation needs attention" : "Portfolio company created",
        description: invitationHandoffCopy(data.founderInvite) });
    },
    /* WAVE 197 #43 — WRITE. */
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not create company", description: describeFailure(e, "write") }),
  });

  const synchronizeForm = (snapshot: ReviewedPortfolioCompany) => {
      // Reconcile state to captured DOM before rendering the dialog: otherwise
      // React would restore stale controlled values when the dialog opens.
      setCompanyName(snapshot.companyName); setLegalName(snapshot.legalName);
      setFounderEmail(snapshot.founderEmail); setFounderName(snapshot.founderName);
      setSector(snapshot.sector); setStage(snapshot.stage); setHq(snapshot.hq);
      setAuthorityTypedName(snapshot.authorityTypedName);
  };
  const reviewCurrent = () => {
    if (!formRef.current) return;
    try {
      // Preserve even invalid visible edits when rendering validation feedback.
      synchronizeForm(capturePortfolioCompany(formRef.current, false));
      const snapshot = capturePortfolioCompany(formRef.current);
      setReviewError(""); setReviewed(snapshot);
    } catch (error) {
      setReviewed(null); setReviewError((error as Error).message);
    }
  };
  const confirmReviewed = () => {
    if (!reviewed || !formRef.current) return;
    try {
      // Detect even silent autofill/DOM edits while the dialog is open.
      const current = capturePortfolioCompany(formRef.current, false);
      if (JSON.stringify(current) !== JSON.stringify(reviewed)) {
        synchronizeForm(current);
        throw new Error("Form values changed. Please review again before creating the company.");
      }
      create.mutate(reviewed);
    } catch {
      setReviewed(null);
      setReviewError("Form values changed. Please review again before creating the company.");
    }
  };

  const copyClaim = async () => {
    if (!result?.founderInvite?.claimUrl) return;
    try {
      await navigator.clipboard.writeText(result.founderInvite.claimUrl);
      setCopied(true);
    } catch {
      /* clipboard blocked — the link is selectable in the field */
    }
  };

  const resetForm = () => {
    setCompanyName(""); setFounderEmail(""); setFounderName(""); setLegalName("");
    setSector(""); setStage(""); setHq(""); setResult(null); setCopied(false);
    setReviewed(null); setReviewError(""); setIntegrityWarning("");
    /* WAVE 214 — the confirmation is per-company. "Add another company" must not
       carry the previous company's confirmation forward, or one typed name would
       stand for an unbounded number of third parties. */
    setAuthorityTypedName("");
  };

  if (!role.ready || !role.identity) return null;

  return (
    <PartnerShell
      title="Add Portfolio Company"
      tier={role.identity.tier}
      subRole={role.identity.subRole}
      partnerName={role.identity.identity.name}
    >
      <AppCard className="mb-5" data-testid="add-portfolio-intro">
        <h2 className="cv-card-title text-lg mb-1">Establish a client company on Capavate</h2>
        <p className="text-sm text-[var(--cv-color-text-secondary)]">
          Create a genuinely new, independent company on Capavate for a client you are
          leading. The company is created with its own account and is tagged to your firm
          so everyone can see you are leading the raise. After your review, Capavate attempts to email the founder to
          claim the account and complete their full company profile. The invitation grants
          company access; it does not grant access to your partner workspace.
        </p>
      </AppCard>

      {!result && (
        <AppCard data-testid="add-portfolio-form">
          <form ref={formRef} noValidate onSubmit={e => { e.preventDefault(); reviewCurrent(); }}
            onInput={() => setReviewed(null)} onChange={() => setReviewed(null)}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Company name *</Label>
              <Input name="companyName" autoComplete="section-company organization" data-testid="apc-company-name" value={companyName} onChange={(e) => { setTouchedCompanyName(true); setCompanyName(e.target.value); }} onBlur={() => setTouchedCompanyName(true)} placeholder="Acme Robotics" />
              {/* WAVE 126 / FINDING 5 — this refused the field before the client
                  had touched it. The email field two rows down already had the
                  right gate (`founderEmail.length > 0`); this one now matches it,
                  so the message appears only once there is something to be wrong
                  about — a name typed and then cleared. The required marker in
                  the label is what states the requirement up front. */}
              {touchedCompanyName && !companyName.trim() && (
                <div className="text-xs text-rose-600 mt-1" data-testid="apc-company-name-error">A company name is required.</div>
              )}
            </div>
            <div>
              <Label>Legal name (optional)</Label>
              <Input name="legalName" autoComplete="section-legal organization" data-testid="apc-legal-name" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Acme Robotics, Inc." />
            </div>
            <div>
              <Label>Founder email *</Label>
              <Input name="founderEmail" autoComplete="section-founder email" data-testid="apc-founder-email" type="email" value={founderEmail} onChange={(e) => setFounderEmail(e.target.value)} placeholder="founder@acme.com" />
              {!emailValid && founderEmail.length > 0 && (
                <div className="text-xs text-rose-600 mt-1" data-testid="apc-founder-email-error">Enter a valid founder email.</div>
              )}
            </div>
            <div>
              <Label>Founder name (optional)</Label>
              <Input name="founderName" autoComplete="section-founder name" data-testid="apc-founder-name" value={founderName} onChange={(e) => setFounderName(e.target.value)} placeholder="Jane Founder" />
            </div>
            <div>
              <Label>Sector (optional)</Label>
              {/* WAVE A2 · ITEM 5a → slide13b WAVE D — active sectors from the
                  DB taxonomy (alphabetical, value submitted / label shown). While
                  loading or on error the select is disabled but still renders
                  the current value, so nothing is dropped or coerced. */}
              <select
                data-testid="apc-sector-select"
                name="sectorSelect"
                aria-label="Sector"
                className={CANONICAL_SELECT_CLASS}
                value={sector}
                disabled={sectorTaxonomy.isLoading || sectorTaxonomy.isError}
                aria-busy={sectorTaxonomy.isLoading || undefined}
                aria-invalid={sectorTaxonomy.isError || undefined}
                onChange={(e) => setSector(e.target.value)}
              >
                {canonicalSelectOptions(sector, sectorValues, { labelFor: sectorLabelFor }).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="text-xs text-[var(--cv-color-text-muted)] mt-1" data-testid="apc-sector-hint">
                {CANONICAL_FREE_TEXT_HINT}
              </div>
              {sectorTaxonomy.isLoading && (
                <div className="text-xs text-[var(--cv-color-text-muted)] mt-1" data-testid="apc-sector-taxonomy-loading">
                  {COMPANY_TAXONOMY_LOADING_COPY}
                </div>
              )}
              {sectorTaxonomy.isError && (
                <div className="text-xs text-rose-600 mt-1" role="alert" data-testid="apc-sector-taxonomy-error">
                  {COMPANY_TAXONOMY_ERROR_COPY}
                </div>
              )}
              <Input name="sector" autoComplete="off" data-testid="apc-sector" value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Robotics" />
            </div>
            <div>
              <Label>Stage (optional)</Label>
              {/* WAVE A2 · ITEM 5a — 7 stages from `COLLECTIVE_STAGES`. */}
              <select
                data-testid="apc-stage-select"
                name="stageSelect"
                aria-label="Stage"
                className={CANONICAL_SELECT_CLASS}
                value={stage}
                onChange={(e) => setStage(e.target.value)}
              >
                {canonicalSelectOptions(stage, COLLECTIVE_STAGES).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="text-xs text-[var(--cv-color-text-muted)] mt-1" data-testid="apc-stage-hint">
                {CANONICAL_FREE_TEXT_HINT}
              </div>
              <Input name="stage" autoComplete="off" data-testid="apc-stage" value={stage} onChange={(e) => setStage(e.target.value)} placeholder="Seed" />
            </div>
            <div>
              <Label>HQ (optional)</Label>
              {/* WAVE A2 · ITEM 5b — 250 countries from `COUNTRIES`. This edits only
                  the TRAILING country segment of the single `hq` string and writes
                  the country's FULL NAME; the city text the partner typed is
                  preserved verbatim. See the long note in
                  `client/src/lib/canonicalFieldOptions.ts` for why a full name and
                  not an ISO code. */}
              <select
                data-testid="apc-hq-country-select"
                name="hqCountrySelect"
                aria-label="HQ country"
                className={CANONICAL_SELECT_CLASS}
                value={hqCountryPart(hq, COUNTRY_NAMES)}
                onChange={(e) => setHq(composeHq(hqCityPart(hq, COUNTRY_NAMES), e.target.value))}
              >
                {canonicalSelectOptions(hqCountryPart(hq, COUNTRY_NAMES), COUNTRY_NAMES, {
                  notSpecifiedLabel: "Country not specified",
                }).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="text-xs text-[var(--cv-color-text-muted)] mt-1" data-testid="apc-hq-hint">
                {CANONICAL_FREE_TEXT_HINT}
              </div>
              <Input name="hq" autoComplete="off" data-testid="apc-hq" value={hq} onChange={(e) => setHq(e.target.value)} placeholder="Toronto, CA" />
            </div>
          </div>
          {/* Wave214 statement/consequence remain byte-identical. Recipient
              context and the new review action are outside the statement. */}
          <div className="mt-4 rounded-md border p-3" style={{ borderColor: "var(--cv-color-border)" }} data-testid="apc-authority-block">
            <div className="text-sm" data-testid="apc-authority-statement">
              {WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT}
            </div>
            <div className="text-xs text-[var(--cv-color-text-muted)] mt-2" data-testid="apc-authority-consequence">
              {WAVE214_PORTFOLIO_COMPANY_CONSEQUENCE}
            </div>
            <div className="mt-3">
              <Label>{WAVE214_TYPED_NAME_LABEL}</Label>
              <Input
                data-testid="apc-authority-name"
                name="authorityTypedName"
                autoComplete="off"
                value={authorityTypedName}
                onChange={(e) => setAuthorityTypedName(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button
              data-testid="apc-create-btn"
              type="submit"
              disabled={create.isPending}
            >
              {create.isPending ? "Creating…" : "Review company & founder invitation"}
            </Button>
            <span className="text-xs text-[var(--cv-color-text-muted)]">
              Review the exact recipient before creating the company and attempting email handoff.
            </span>
          </div>
          {reviewError && <p role="alert" className="mt-3 text-sm">{reviewError}</p>}
          </form>
        </AppCard>
      )}

      <Dialog open={!!reviewed} onOpenChange={open => { if (!open && !create.isPending) setReviewed(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Confirm company and founder invitation</DialogTitle>
            <DialogDescription>These reviewed values are the exact submission. Confirm the recipient before creating the company.</DialogDescription></DialogHeader>
          {reviewed && <div className="space-y-3 text-sm">
            <p>Company: <strong>{reviewed.companyName}</strong></p>
            <p>Founder invitation email: <strong data-testid="apc-review-recipient">{reviewed.founderEmail}</strong></p>
            <p>Founder name: {reviewed.founderName || "Not provided"}</p>
            <p>Legal name: {reviewed.legalName || "Default company legal name"}</p>
            <p>Sector: {reviewed.sector || "Not provided"}</p>
            <p>Stage: {reviewed.stage || "Not provided"}</p>
            <p>HQ: {reviewed.hq || "Not provided"}</p>
            <p>Authority confirmed by: {reviewed.authorityTypedName}</p>
            <p>The recipient above is the founder invitation address, not the company contact email. This creates an independent company and attempts an invitation email; inbox delivery is not guaranteed.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" data-testid="apc-confirm-create" disabled={create.isPending} onClick={confirmReviewed}>{create.isPending ? "Creating…" : "Confirm create & invite"}</Button>
              <Button type="button" variant="outline" disabled={create.isPending} onClick={() => setReviewed(null)}>Back to edit</Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>

      {result && (
        <AppCard data-testid="add-portfolio-success">
          <h2 className="cv-card-title text-lg mb-1">Company created</h2>
          <p className="text-sm text-[var(--cv-color-text-secondary)] mb-3">
            The company has been created as an independent entity, tagged to your firm, and
            a Pipeline (Invited) entry has been attempted. Invitation handoff is reported
            separately below. The founder can use the claim link to finish registration.
          </p>
          <div className="text-xs text-[var(--cv-color-text-muted)] mb-2" data-testid="apc-company-id">
            Company id: <span className="font-mono">{partyReferenceLabel(result.companyId)}</span>
          </div>
          {integrityWarning && <p role="alert" className="mb-3">{integrityWarning}</p>}
          {result.founderInvite && !integrityWarning ? (
            <div className="rounded-md border p-3" style={{ borderColor: "var(--cv-color-border)" }}>
              <p className="text-sm mb-3">{invitationHandoffCopy(result.founderInvite)}</p>
              {result.founderInvite.handoff.statusRecorded === false && <p role="alert">The mail outcome could not be saved. Refreshed status may remain unconfirmed.</p>}
              <div className="text-sm font-medium mb-1">Founder claim link for {result.founderInvite.email}</div>
              {result.founderInvite.claimUrl ? (
              <div className="flex gap-2 items-center">
                <Input
                  readOnly
                  data-testid="apc-claim-link"
                  value={result.founderInvite.claimUrl}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button size="sm" data-testid="apc-claim-copy" onClick={copyClaim}>{copied ? "Copied✓" : "Copy link"}</Button>
              </div>
              ) : <p role="alert">The secure claim link is unavailable. Review the invitation status and deployment origin before reissuing.</p>}
            </div>
          ) : (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="apc-invite-warning">
              The company was saved, but the invitation response needs review. Use the
              invitation status and recovery controls; do not create another company.
            </div>
          )}
          <div className="mt-3">
            <FounderInvitationStatus companyId={result.companyId} companyName={companyName}
              canWrite={["managing_partner", "associate", "bd"].includes(role.identity.subRole)} />
          </div>
          <div className="mt-4 flex gap-3">
            <Button variant="outline" data-testid="apc-add-another" onClick={resetForm}>Add another company</Button>
            <a href="/collective/partner/pipeline"><Button variant="outline" data-testid="apc-view-pipeline">View in Pipeline</Button></a>
          </div>
        </AppCard>
      )}

      {/* WAVE C · ITEM 10a — the owner asked what distinguishes this from Clients
          and Portfolio. It is not a third list: it is the ACTION that writes into
          them. That sequence was read out of
          `server/partnerPortfolioCompanyRoutes.ts` and is named here in full, so
          the partner knows what one submit actually does. APPENDED LAST; no test
          pins another element to the end of this file. */}
      <PartnerSurfaceGuide
        testId="apc-surface-guide"
        title="What this page does, and where the company then appears"
        relations={[
          {
            label: "Clients",
            href: "/collective/partner/clients",
            why: "where the attribution this page creates is recorded",
            testId: "apc-guide-to-clients",
          },
          {
            label: "Portfolio",
            href: "/collective/partner/portfolio",
            why: "where the company profile this page creates can be edited",
            testId: "apc-guide-to-portfolio",
          },
          {
            label: "Pipeline",
            href: "/collective/partner/pipeline",
            why: "where the new deal this page creates starts, at the invited stage",
            testId: "apc-guide-to-pipeline",
          },
        ]}
      >
        This page is an action, not a list. Submitting it once creates the company,
        attributes it to you, adds its portfolio profile, opens a deal on your
        pipeline at the invited stage, and attempts to email the founder an invitation. That is
        why the same company then appears under Clients, Portfolio and Pipeline —
        three different records of one act, not three copies of it. Required company,
        attribution and invitation writes must succeed; optional pipeline/profile steps
        and email handoff can fail after the company is saved. A mail failure does not
        undo the company: review the invitation status and reissue if needed. It does not create an SPV: vehicles are always created
        deliberately from the SPVs section.
      </PartnerSurfaceGuide>
    </PartnerShell>
  );
}
