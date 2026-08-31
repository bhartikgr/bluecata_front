/**
 * Sprint 14 D10 — Investor accreditation form, 9 jurisdictions.
 *
 * One component, region switcher controls which sub-form (and which thresholds)
 * are shown. All forms share an identical declaration structure:
 *   - Pathway (income / net-worth / professional / certification / authorised)
 *   - Confirmation checkboxes (per-jurisdiction)
 *   - Free-text supporting evidence reference
 *
 * Jurisdictions:
 *   1. US Reg D 506(c) — accredited investor
 *   2. CA NI 45-106 — accredited investor (CAD thresholds)
 *   3. UK FCA HNW / sophisticated
 *   4. EU MiFID II — professional client (per request)
 *   5. SG SFA §4A — accredited investor
 *   6. HK SFO Sch 1 — professional investor
 *   7. IN AIF — accredited investor
 *   8. JP FIEA — qualified institutional / professional
 *   9. AU Corp Act §708(8)(c) — sophisticated investor
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * WAVE 215 — THIS IS NO LONGER A CAPTURE SURFACE.
 * ────────────────────────────────────────────────────────────────────────────────
 * As found, this component collected a jurisdiction, a pathway, two tick-boxes
 * and an evidence reference, then told the investor their accreditation was
 * "awaiting compliance review" — and persisted NOTHING. Its only mount, in
 * `client/src/pages/investor/Profile.tsx`, passes no `onSubmit`, so the payload
 * was discarded and no declaration was ever recorded from here. A surface that
 * tells an investor their accreditation is with compliance while writing nothing
 * to a database is worse than no surface at all.
 *
 * The single accreditation mechanism is now
 * `client/src/components/investor/AccreditationDeclaration.tsx` +
 * `POST /api/investor/compliance/accreditation-declaration` +
 * the `investor_accreditation_declaration` table. That is the path that produced
 * the live declaration on this platform, and it is the one that survives.
 *
 * This file is KEPT (R195.5): its nine-jurisdiction model was the better one and
 * has been ported into `shared/accreditationClause.ts`, its exports are still
 * imported elsewhere, and its testids are unchanged so nothing that referenced
 * them breaks. What changed is that in `mode="reference"` — which is what its one
 * mount now passes — it stops claiming to submit anything and sends the investor
 * to the real form. Its default stays `"capture"` so no other caller changes
 * behaviour without opting in.
 *
 * Its threshold figures were corrected too. The UK pathway asserted £170K/£430K,
 * which S.I. 2024/301 reduced to £100,000 / £250,000 with effect from 27 March
 * 2024; the superseded pair is retained below, unrendered, rather than deleted.
 * Figures Capavate's own regulatory research does not support are no longer
 * stated as figures at all.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ScrollText, ShieldCheck } from "lucide-react";
import { useCapavateToast } from "./Toast";
import { InlineError } from "./InlineError";

export const ACCREDITATION_JURISDICTIONS = [
  { code: "US",   flag: "\ud83c\uddfa\ud83c\uddf8", label: "US — Reg D 506(c)" },
  { code: "CA",   flag: "\ud83c\udde8\ud83c\udde6", label: "CA — NI 45-106" },
  { code: "UK",   flag: "\ud83c\uddec\ud83c\udde7", label: "UK — FCA HNW / sophisticated" },
  { code: "EU",   flag: "\ud83c\uddea\ud83c\uddfa", label: "EU — MiFID II professional" },
  { code: "SG",   flag: "\ud83c\uddf8\ud83c\uddec", label: "SG — SFA §4A accredited" },
  { code: "HK",   flag: "\ud83c\udded\ud83c\uddf0", label: "HK — SFO Sch 1 professional" },
  { code: "IN",   flag: "\ud83c\uddee\ud83c\uddf3", label: "IN — AIF accredited" },
  { code: "JP",   flag: "\ud83c\uddef\ud83c\uddf5", label: "JP — FIEA qualified" },
  { code: "AU",   flag: "\ud83c\udde6\ud83c\uddfa", label: "AU — Corp Act §708 sophisticated" },
] as const;

export type JurisdictionCode = (typeof ACCREDITATION_JURISDICTIONS)[number]["code"];

interface PathwayDef {
  id: string;
  label: string;
  /** Threshold or qualifier description. */
  detail: string;
}

/**
 * WAVE 215 / R143.1 — RETAINED, NOT DELETED.
 *
 * Every threshold string this wave stopped rendering is kept here so the file
 * still carries what it used to say and a reader can see exactly what changed
 * and why. None of these is rendered to an investor.
 *
 * The UK pair is superseded law, not a typo: the annual-income condition fell
 * from £170,000 to £100,000 and the net-assets condition from £430,000 to
 * £250,000 with effect from 27 March 2024, and the transitional alternative
 * ceased to have any effect after 30 January 2025. A UK statement signed on the
 * old figures is void.
 *   https://www.legislation.gov.uk/uksi/2024/301/made
 */
export const SUPERSEDED_UK_PATHWAY_DETAIL_PS22_10 = "\u00a3170K income or \u00a3430K net assets (PS22/10)";

/**
 * Figures withdrawn because `build_log/legal/REGULATORY_PERIMETER_RESEARCH.md`
 * does not support them. R-ASSERT applies to a legal threshold exactly as it
 * applies to a money amount: an unsupported number is not shown as a number.
 * India and Japan are absent from that research entirely, so nothing there had
 * a source at all. Full reasoning per figure lives in
 * `UNSUPPORTED_THRESHOLD_FIGURES_REMOVED_W215` in `shared/accreditationClause.ts`.
 */
export const UNSUPPORTED_PATHWAY_DETAILS_WITHDRAWN_W215 = [
  "C$200K individual / C$300K combined for last 2 yrs",
  "Net financial assets > C$1M before tax",
  "Two of: \u20ac500K portfolio, 10 trades/qtr, 1 yr finance role",
  "Net financial assets > S$1M",
  "Net worth \u2265 \u20b97.5cr; investment \u2265 \u20b975L",
  "Net worth \u2265 \u20b950cr",
  "Securities \u2265 \u00a51bn",
  "Net assets \u2265 \u00a5300M; financial assets \u2265 \u00a5300M; 1 yr account",
  "A$2.5M net assets or A$250K gross income for last 2 yrs (s708(8)(c))",
] as const;

/** Shown in place of a withdrawn figure, so the gap is visible rather than silent. */
const AWAITING_COUNSEL = "Threshold awaiting confirmation by local counsel — no figure stated";

const PATHWAYS: Record<JurisdictionCode, PathwayDef[]> = {
  US: [
    { id: "income",        label: "Income test",         detail: "$200K individual / $300K joint for last 2 yrs, expectation continues" },
    { id: "net_worth",     label: "Net-worth test",      detail: "Net worth > $1M excluding primary residence" },
    { id: "professional",  label: "Professional",        detail: "Series 7, 65, or 82 in good standing" },
    { id: "entity",        label: "Entity",              detail: ">$5M assets or all owners accredited" },
  ],
  CA: [
    { id: "income",        label: "Income test",         detail: AWAITING_COUNSEL },
    { id: "net_worth",     label: "Net-worth test",      detail: AWAITING_COUNSEL },
    { id: "permitted",     label: "Permitted client",    detail: "NI 31-103 permitted client" },
  ],
  UK: [
    { id: "hnw_individual", label: "HNW individual",     detail: "\u00a3100,000 income or \u00a3250,000 net assets (S.I. 2024/301, in force 27 Mar 2024)" },
    { id: "sophisticated", label: "Sophisticated",       detail: "Self-certified sophisticated investor" },
    { id: "professional",  label: "Professional client", detail: "FCA professional client (per se / elective)" },
  ],
  EU: [
    { id: "professional_per_se", label: "Per-se professional", detail: "Credit institution / regulated firm / large undertaking" },
    { id: "professional_elective", label: "Elective professional", detail: AWAITING_COUNSEL },
  ],
  SG: [
    { id: "income",        label: "Income test",         detail: "S$300K personal income last 12 months" },
    { id: "net_worth",     label: "Net-worth test",      detail: "Net personal assets > S$2M (max S$1M residence)" },
    { id: "financial",     label: "Financial assets",    detail: AWAITING_COUNSEL },
  ],
  HK: [
    { id: "individual",    label: "Individual PI",       detail: "Portfolio \u2265 HK$8M" },
    { id: "corporate",     label: "Corporate PI",        detail: "Total assets \u2265 HK$40M / portfolio \u2265 HK$8M" },
  ],
  IN: [
    { id: "individual",    label: "Individual",          detail: AWAITING_COUNSEL },
    { id: "body_corp",     label: "Body corporate",       detail: AWAITING_COUNSEL },
  ],
  JP: [
    { id: "qii",           label: "Qualified Institutional", detail: AWAITING_COUNSEL },
    { id: "professional",  label: "Professional investor", detail: AWAITING_COUNSEL },
  ],
  AU: [
    { id: "sophisticated", label: "Sophisticated",       detail: "Qualified-accountant certificate dated within 6 months of the offer (s708(8)(c)); regulation figures awaiting confirmation by local counsel" },
    { id: "professional",  label: "Professional",        detail: "Holder of AFSL / >A$10M assets" },
  ],
};

/** Where the real accreditation declaration is captured and persisted. */
export const REAL_ACCREDITATION_ROUTE = "/investor/accreditation";

export interface AccreditationFormProps {
  initialJurisdiction?: JurisdictionCode;
  /**
   * WAVE 215 — `"capture"` keeps the historical behaviour for any caller that
   * passes an `onSubmit` and means it. `"reference"` says out loud what this
   * surface actually is: a jurisdiction reference that records nothing, with the
   * investor sent to the real declaration form to sign. Defaults to `"capture"`
   * so no existing caller changes behaviour by accident.
   */
  mode?: "capture" | "reference";
  onSubmit?: (payload: {
    jurisdiction: JurisdictionCode;
    pathway: string;
    declarations: string[];
    evidenceRef: string;
  }) => void;
}

export function AccreditationForm({ initialJurisdiction = "US", onSubmit, mode = "capture" }: AccreditationFormProps) {
  const toast = useCapavateToast();
  const [jurisdiction, setJurisdiction] = useState<JurisdictionCode>(initialJurisdiction);
  const [pathway, setPathway] = useState<string>(PATHWAYS[initialJurisdiction][0].id);
  const [declarations, setDeclarations] = useState<Record<string, boolean>>({});
  const [evidenceRef, setEvidenceRef] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pathways = PATHWAYS[jurisdiction];
  const currentJur = ACCREDITATION_JURISDICTIONS.find(j => j.code === jurisdiction)!;

  /* R143.1 — the button below still reads `onClick={submit}`; the handler
     expression is untouched. What changed is INSIDE this function: in reference
     mode it no longer reports a submission that never happened, and instead
     sends the investor to the surface that actually records one. */
  const submit = () => {
    setError(null);
    /* WAVE 215 — reference mode records nothing and must not pretend otherwise.
       There is no `onSubmit` on this component's only mount, so in that
       configuration the old code path discarded the payload and then displayed
       "awaiting compliance review" to the investor. Refusing to say that is the
       correction; navigating to the real form is what the investor needs next. */
    if (mode === "reference" && !onSubmit) {
      toast.success({
        title: "Nothing was submitted from this panel",
        description: `${currentJur.label} \u00b7 this is a reference view. Sign your declaration on the accreditation page to have it recorded.`,
      });
      if (typeof window !== "undefined") window.location.assign(REAL_ACCREDITATION_ROUTE);
      return;
    }
    const decKeys = Object.keys(declarations).filter(k => declarations[k]);
    if (decKeys.length < 2) {
      setError("Please confirm both declarations before submitting.");
      return;
    }
    onSubmit?.({ jurisdiction, pathway, declarations: decKeys, evidenceRef });
    toast.success({ title: "Accreditation submitted", description: `${currentJur.label} \u00b7 awaiting compliance review.` });
  };

  return (
    <Card data-testid="card-accreditation-form">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ScrollText className="h-4 w-4" /> Investor accreditation
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          9 jurisdictions supported. Select the regime that applies to your tax residency.
        </p>
        {/* WAVE 215 / ITEM C — appended sibling. The investor is told, before
            touching anything, that this panel is a reference and that a
            declaration is only recorded on the real form. */}
        {mode === "reference" && (
          <p className="text-xs mt-1.5 rounded-md border p-2 leading-relaxed" data-testid="accreditation-form-reference-notice" style={{ background: "var(--cv-warn-bg, #fffbeb)", borderColor: "var(--cv-warn-border, #fde68a)", color: "var(--cv-warn-text, #92400e)" }}>
            Reference only — nothing on this panel is recorded. To make a
            declaration Capavate can produce later, sign it on the{" "}
            <a href={REAL_ACCREDITATION_ROUTE} className="underline" data-testid="link-real-accreditation-form">
              accreditation declaration page
            </a>
            . Capavate records your declaration; it does not check it, and it does
            not perform any verification on your behalf. Thresholds shown as
            awaiting confirmation by local counsel state no figure on purpose.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs">Jurisdiction</Label>
          <Select
            value={jurisdiction}
            onValueChange={(v) => {
              const code = v as JurisdictionCode;
              setJurisdiction(code);
              setPathway(PATHWAYS[code][0].id);
              setDeclarations({});
            }}
          >
            <SelectTrigger data-testid="select-jurisdiction"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACCREDITATION_JURISDICTIONS.map(j => (
                <SelectItem key={j.code} value={j.code}>{j.flag} {j.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">Eligibility pathway</Label>
          <div className="grid gap-2 mt-1.5" data-testid="list-pathways">
            {pathways.map(p => (
              <label
                key={p.id}
                className={`flex items-start gap-2 rounded-md border p-2.5 cursor-pointer hover-elevate ${pathway === p.id ? "border-[hsl(0_100%_40%)] ring-1 ring-[hsl(0_100%_40%)]" : "border-border"}`}
                data-testid={`pathway-${p.id}`}
              >
                <input
                  type="radio"
                  name="pathway"
                  className="mt-1 h-3.5 w-3.5"
                  checked={pathway === p.id}
                  onChange={() => setPathway(p.id)}
                  data-testid={`radio-pathway-${p.id}`}
                />
                <div>
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.detail}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-start gap-2">
            <Checkbox
              checked={declarations["truthful"] ?? false}
              onCheckedChange={(v) => setDeclarations(d => ({ ...d, truthful: !!v }))}
              data-testid="checkbox-truthful"
            />
            <span className="text-xs leading-relaxed">
              I declare the above is true and accurate. I understand that misrepresentation may be a criminal offence under the {currentJur.label.split("—")[0].trim()} regime.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <Checkbox
              checked={declarations["risk"] ?? false}
              onCheckedChange={(v) => setDeclarations(d => ({ ...d, risk: !!v }))}
              data-testid="checkbox-risk"
            />
            <span className="text-xs leading-relaxed">
              I acknowledge that private securities are illiquid and may result in total loss; investor protections available to retail clients do not apply.
            </span>
          </label>
        </div>

        <div>
          <Label className="text-xs" htmlFor="evidence-ref">Supporting evidence reference (optional)</Label>
          <Textarea
            id="evidence-ref"
            rows={2}
            value={evidenceRef}
            onChange={(e) => setEvidenceRef(e.target.value)}
            placeholder="Vault doc ID, accountant letter date, or third-party verification reference."
            data-testid="textarea-evidence"
          />
        </div>

        {error && <InlineError message={error} />}

        <Button
          onClick={submit}
          className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
          data-testid="button-submit-accreditation"
        >
          <ShieldCheck className="h-4 w-4 mr-2" /> Submit declaration
        </Button>
      </CardContent>
    </Card>
  );
}
