/**
 * WAVE 174 · R142 / R144.3 — WHICH TAX DOCUMENT THIS LP SHOULD EXPECT.
 * WAVE 175 · R145.1 — NOW ANSWERED FROM RESEARCH, FOR ALL FIFTEEN.
 *
 * Owner, verbatim: "With regard to taxes, remember that this is an
 * international platform. Maybe we can first focus on high level guidance for
 * US, Canadian, and MAYBE Hong Kong and Singapore GP/LPs?"
 *
 * Before wave 174 an LP was told one of two wrong things about tax documents:
 * nothing at all on their vehicle interests, or — on the portfolio-company
 * screen — that their package was a "1099 / K-1", two US federal forms
 * hardcoded for LPs in all sixteen jurisdictions.
 *
 * WAVE 175 renders three DIFFERENT answers, because there are three:
 *   · a named statutory document (five jurisdictions), with its form number or
 *     "Not established" where the research could not establish one;
 *   · "No standard investor tax form" — an ESTABLISHED, SOURCED ABSENCE (ten
 *     jurisdictions) — stated positively, with what the investor gets instead;
 *   · "Not on record" for `other`, where the jurisdiction itself is unrecorded
 *     and the question is therefore unanswerable.
 *
 * And where the answer depends on the vehicle's LEGAL FORM (seven
 * jurisdictions), it renders the CONDITIONAL rather than asserting one
 * treatment. Capavate records `spv.jurisdiction` and does not record legal
 * form; an honest conditional beats a confident wrong answer.
 *
 * THIS COMPONENT CONTAINS NO JURISDICTION. It takes the value stored on the
 * vehicle (`spv.jurisdiction`, served through the LP positions payload) and
 * asks the shared, EXHAUSTIVE `SPV_JURISDICTION_TAX_DOCUMENT` table what to
 * say. There is no branch on a country here and no default: an unrecognised,
 * empty or unmapped value resolves to `other`, which is NOT on record, so this
 * component can never name a US form for a non-US vehicle.
 *
 * WHAT IT DELIBERATELY DOES NOT DO (R142.2.4): no computed tax figures, no
 * amounts of any kind, no filing guidance, no deadlines, no tax advice. It
 * names a document, or says plainly what exists instead. Every string is
 * authored in `shared/spvEngine.ts` and rendered verbatim, so this component
 * cannot dilute or invent the wording.
 */
import { useMemo } from "react";
import {
  spvJurisdictionTaxDocument,
  SPV_TAX_DOCUMENT_NOT_ON_RECORD,
  SPV_TAX_DOCUMENT_NOT_ON_RECORD_NOTICE,
  SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE,
  SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL,
  SPV_TAX_DOCUMENT_NO_STANDARD_FORM_NOTICE,
  SPV_TAX_DOCUMENT_FORM_NUMBER_NOT_ESTABLISHED,
  SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE,
  SPV_TAX_DOCUMENT_SOURCES_LABEL,
} from "@shared/spvEngine";

export function LpTaxDocumentNote({
  jurisdiction,
  testidPrefix = "investor-lp-tax-document",
}: {
  jurisdiction: string | null | undefined;
  testidPrefix?: string;
}) {
  /* Hoisted: the resolution is pure and depends only on the stored value. */
  const doc = useMemo(() => spvJurisdictionTaxDocument(jurisdiction), [jurisdiction]);

  return (
    <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(4,30,65,0.10)" }} data-testid={testidPrefix}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Tax document to expect
      </div>

      {doc.onRecord ? (
        <div className="text-sm font-semibold" data-testid={`${testidPrefix}-name`}>
          {doc.documentName}
        </div>
      ) : doc.recordStatus === "no_standard_form" ? (
        <div className="text-sm font-semibold" data-testid={`${testidPrefix}-no-standard-form`}>
          {SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL}
        </div>
      ) : (
        <div className="text-sm font-semibold" style={{ color: "#8a5a06" }} data-testid={`${testidPrefix}-not-on-record`}>
          {SPV_TAX_DOCUMENT_NOT_ON_RECORD}
        </div>
      )}

      <div className="text-[11px] mt-0.5 text-muted-foreground" data-testid={`${testidPrefix}-jurisdiction`}>
        Vehicle jurisdiction: {doc.jurisdictionLabel}
      </div>

      {doc.onRecord && doc.documentLongName && (
        <div className="text-[11px] mt-1 leading-relaxed text-muted-foreground" data-testid={`${testidPrefix}-long-name`}>
          {doc.documentLongName}
        </div>
      )}

      {doc.onRecord && (
        <div className="text-[11px] mt-0.5 text-muted-foreground" data-testid={`${testidPrefix}-form-number`}>
          Form number: {doc.formNumber ?? SPV_TAX_DOCUMENT_FORM_NUMBER_NOT_ESTABLISHED}
        </div>
      )}

      {doc.onRecord && doc.authority && (
        <div className="text-[11px] mt-0.5 text-muted-foreground" data-testid={`${testidPrefix}-authority`}>
          Issued for {doc.authority}.
        </div>
      )}

      {!doc.onRecord && doc.taxAuthority && (
        <div className="text-[11px] mt-0.5 text-muted-foreground" data-testid={`${testidPrefix}-tax-authority`}>
          Tax authority: {doc.taxAuthority}
        </div>
      )}

      <div className="text-[11px] mt-1 leading-relaxed text-muted-foreground" data-testid={`${testidPrefix}-entity-treatment`}>
        {doc.entityTreatment}
      </div>

      {doc.vehicleFormDependent && doc.vehicleFormConditional && (
        <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "#8a5a06" }} data-testid={`${testidPrefix}-vehicle-form`}>
          {doc.vehicleFormConditional}
        </div>
      )}

      {doc.vehicleFormDependent && (
        <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "#8a5a06" }} data-testid={`${testidPrefix}-vehicle-form-notice`}>
          {SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE}
        </div>
      )}

      {doc.recordStatus === "no_standard_form" && doc.investorReceivesInstead && (
        <div className="text-[11px] mt-1 leading-relaxed text-muted-foreground" data-testid={`${testidPrefix}-receives-instead`}>
          What you receive instead: {doc.investorReceivesInstead}
        </div>
      )}

      {doc.recordStatus === "no_standard_form" && doc.noStandardFormExplanation && (
        <div className="text-[11px] mt-1 leading-relaxed text-muted-foreground" data-testid={`${testidPrefix}-no-standard-form-note`}>
          {doc.noStandardFormExplanation}
        </div>
      )}

      {doc.recordStatus === "no_standard_form" && (
        <div className="text-[11px] mt-0.5 leading-relaxed text-muted-foreground" data-testid={`${testidPrefix}-no-standard-form-notice`}>
          {SPV_TAX_DOCUMENT_NO_STANDARD_FORM_NOTICE}
        </div>
      )}

      {doc.additionalDocuments.length > 0 && (
        <ul className="text-[11px] mt-1 leading-relaxed list-disc pl-4 text-muted-foreground" data-testid={`${testidPrefix}-additional`}>
          {doc.additionalDocuments.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}

      {!doc.onRecord && doc.recordStatus === "not_on_record" && (
        <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "#8a5a06" }} data-testid={`${testidPrefix}-not-on-record-note`}>
          {SPV_TAX_DOCUMENT_NOT_ON_RECORD_NOTICE}
        </div>
      )}

      {doc.sources.length > 0 && (
        <div className="text-[11px] mt-1 leading-relaxed text-muted-foreground" data-testid={`${testidPrefix}-sources`}>
          {SPV_TAX_DOCUMENT_SOURCES_LABEL}:{" "}
          {doc.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 ? " · " : ""}
              <a href={s.url} target="_blank" rel="noreferrer noopener" className="underline">
                {s.label}
              </a>
            </span>
          ))}
        </div>
      )}

      <div className="text-[11px] mt-1 leading-relaxed text-muted-foreground" data-testid={`${testidPrefix}-informational`}>
        {SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE}
      </div>
    </div>
  );
}
