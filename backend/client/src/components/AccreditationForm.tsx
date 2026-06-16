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

const PATHWAYS: Record<JurisdictionCode, PathwayDef[]> = {
  US: [
    { id: "income",        label: "Income test",         detail: "$200K individual / $300K joint for last 2 yrs, expectation continues" },
    { id: "net_worth",     label: "Net-worth test",      detail: "Net worth > $1M excluding primary residence" },
    { id: "professional",  label: "Professional",        detail: "Series 7, 65, or 82 in good standing" },
    { id: "entity",        label: "Entity",              detail: ">$5M assets or all owners accredited" },
  ],
  CA: [
    { id: "income",        label: "Income test",         detail: "C$200K individual / C$300K combined for last 2 yrs" },
    { id: "net_worth",     label: "Net-worth test",      detail: "Net financial assets > C$1M before tax" },
    { id: "permitted",     label: "Permitted client",    detail: "NI 31-103 permitted client" },
  ],
  UK: [
    { id: "hnw_individual", label: "HNW individual",     detail: "\u00a3170K income or \u00a3430K net assets (PS22/10)" },
    { id: "sophisticated", label: "Sophisticated",       detail: "Self-certified sophisticated investor" },
    { id: "professional",  label: "Professional client", detail: "FCA professional client (per se / elective)" },
  ],
  EU: [
    { id: "professional_per_se", label: "Per-se professional", detail: "Credit institution / regulated firm / large undertaking" },
    { id: "professional_elective", label: "Elective professional", detail: "Two of: \u20ac500K portfolio, 10 trades/qtr, 1 yr finance role" },
  ],
  SG: [
    { id: "income",        label: "Income test",         detail: "S$300K personal income last 12 months" },
    { id: "net_worth",     label: "Net-worth test",      detail: "Net personal assets > S$2M (max S$1M residence)" },
    { id: "financial",     label: "Financial assets",    detail: "Net financial assets > S$1M" },
  ],
  HK: [
    { id: "individual",    label: "Individual PI",       detail: "Portfolio \u2265 HK$8M" },
    { id: "corporate",     label: "Corporate PI",        detail: "Total assets \u2265 HK$40M / portfolio \u2265 HK$8M" },
  ],
  IN: [
    { id: "individual",    label: "Individual",          detail: "Net worth \u2265 \u20b97.5cr; investment \u2265 \u20b975L" },
    { id: "body_corp",     label: "Body corporate",       detail: "Net worth \u2265 \u20b950cr" },
  ],
  JP: [
    { id: "qii",           label: "Qualified Institutional", detail: "Securities \u2265 \u00a51bn" },
    { id: "professional",  label: "Professional investor", detail: "Net assets \u2265 \u00a5300M; financial assets \u2265 \u00a5300M; 1 yr account" },
  ],
  AU: [
    { id: "sophisticated", label: "Sophisticated",       detail: "A$2.5M net assets or A$250K gross income for last 2 yrs (s708(8)(c))" },
    { id: "professional",  label: "Professional",        detail: "Holder of AFSL / >A$10M assets" },
  ],
};

export interface AccreditationFormProps {
  initialJurisdiction?: JurisdictionCode;
  onSubmit?: (payload: {
    jurisdiction: JurisdictionCode;
    pathway: string;
    declarations: string[];
    evidenceRef: string;
  }) => void;
}

export function AccreditationForm({ initialJurisdiction = "US", onSubmit }: AccreditationFormProps) {
  const toast = useCapavateToast();
  const [jurisdiction, setJurisdiction] = useState<JurisdictionCode>(initialJurisdiction);
  const [pathway, setPathway] = useState<string>(PATHWAYS[initialJurisdiction][0].id);
  const [declarations, setDeclarations] = useState<Record<string, boolean>>({});
  const [evidenceRef, setEvidenceRef] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pathways = PATHWAYS[jurisdiction];
  const currentJur = ACCREDITATION_JURISDICTIONS.find(j => j.code === jurisdiction)!;

  const submit = () => {
    setError(null);
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
                className={`flex items-start gap-2 rounded-md border p-2.5 cursor-pointer hover-elevate ${pathway === p.id ? "border-[hsl(184_98%_22%)] ring-1 ring-[hsl(184_98%_22%)]" : "border-border"}`}
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
          className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
          data-testid="button-submit-accreditation"
        >
          <ShieldCheck className="h-4 w-4 mr-2" /> Submit declaration
        </Button>
      </CardContent>
    </Card>
  );
}
