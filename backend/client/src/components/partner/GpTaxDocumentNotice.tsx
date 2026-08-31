/**
 * WAVE 175 · R145.3.3 — THE GP-SIDE HALF OF THE MISLABELLING DEFECT.
 *
 * Wave 174 fixed the LP-facing half: an LP in a Hong Kong vehicle is no longer
 * told to expect a "1099 / K-1". The GP-facing half was left open, and this is
 * it: the K-1 tab lets a general partner generate a statement labelled
 * "Schedule K-1" — a US FEDERAL form — for a vehicle in ANY of the sixteen
 * jurisdictions, with nothing on the surface saying so.
 *
 * WHAT THIS DOES AND DOES NOT DO, DELIBERATELY.
 *
 * The K-1 generation machinery (`server/spvK1Store.ts`, `server/spvK1Routes.ts`,
 * `server/lib/spvK1.ts`) is NOT touched by this wave and reads no jurisdiction,
 * by ruling. This component does not compute, alter or block any figure. It
 * LABELS the surface with the vehicle's own recorded jurisdiction so a US form
 * is never presented as a non-US vehicle's investor tax document.
 *
 * IT LABELS RATHER THAN GATES, AND THAT IS A CONSIDERED CHOICE. Hard-disabling
 * generation for every non-`delaware` vehicle would break a legitimate workflow
 * the research documents: a US-taxable investor in a Cayman or BVI feeder does
 * receive a US Schedule K-1, prepared under US rules, even though the vehicle's
 * own jurisdiction levies no tax and issues no form. Removing the tool from
 * those GPs would replace a labelling defect with a functional one. Stating the
 * truth on the surface closes the defect without destroying a correct use, and
 * it names the document the vehicle's own jurisdiction actually produces.
 *
 * NO JURISDICTION IS HARDCODED HERE. Everything is resolved from the value
 * stored on the vehicle through the shared exhaustive table, and every sentence
 * is authored in `shared/spvEngine.ts`. An unrecognised or missing value
 * resolves to `other`, which yields the explicit "jurisdiction not on record"
 * warning rather than an assumption in either direction — the platform must not
 * claim a vehicle is non-US when it does not know where the vehicle is.
 */
import { useMemo } from "react";
import {
  spvJurisdictionTaxDocument,
  SPV_TAX_DOCUMENT_GP_US_FORM_NOT_THIS_VEHICLE_NOTICE,
  SPV_TAX_DOCUMENT_GP_JURISDICTION_UNKNOWN_NOTICE,
  SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL,
  SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE,
  SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE,
  /* WAVE 189 · ITEM A · R159.5 — the STRONGER disclaimer the owner asked for,
     naming BOTH Capavate and BluePrint Catalyst Limited. Rendered as a STATIC
     SIBLING of the notice above, which is kept byte-verbatim (R143.1). */
  SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER,
  SPV_TAX_DOCUMENT_SOURCES_LABEL,
} from "@shared/spvEngine";
/* WAVE 179 · ITEM B · R151.3 — the OPTIONAL, GP-STATED legal form. */
import { spvLegalFormResolvedTreatment } from "@shared/spvLegalForm";

export function GpTaxDocumentNotice({
  jurisdiction,
  testidPrefix = "spv-k1-jurisdiction",
  legalForm = null,
}: {
  jurisdiction?: string | null;
  testidPrefix?: string;
  /* ══ WAVE 179 · ITEM B · R151.3 — OPTIONAL, DEFAULTS TO NOT STATED ════════
     The default is `null` and every existing call site that does not pass it keeps
     rendering EXACTLY what it renders today — which is the guarantee R151.3
     demands and what the byte-identity test pins.

     THE PLATFORM NEVER INFERS THIS. The prop is threaded from the vehicle's own
     persisted `legal_form` column, which is only ever written from an explicit
     user selection. There is deliberately no fallback that derives it from
     `jurisdiction`, from the vehicle's name, or from its type. */
  legalForm?: string | null;
}) {
  const doc = useMemo(() => spvJurisdictionTaxDocument(jurisdiction), [jurisdiction]);
  /* Non-null ONLY when a legal form was explicitly stated AND it genuinely belongs
     to this vehicle's jurisdiction AND wave 175 recorded a single treatment for it.
     `null` in every other case, including a stale form left over from a different
     jurisdiction — which then reads as not stated, i.e. as today. */
  const resolvedTreatment = useMemo(
    () => spvLegalFormResolvedTreatment(doc.code, legalForm),
    [doc.code, legalForm],
  );

  /* `delaware` is the one jurisdiction for which a Schedule K-1 IS the
     vehicle's own investor document, so nothing needs correcting there. */
  const isUsFederalVehicle = doc.code === "delaware";
  /* `other` means the jurisdiction is unrecorded. The platform must not assert
     "this is not a US vehicle" when it does not know. */
  const jurisdictionUnknown = doc.recordStatus === "not_on_record";

  if (isUsFederalVehicle) {
    return (
      <div className="mb-2 text-[11px] leading-relaxed text-muted-foreground" data-testid={`${testidPrefix}-us`}>
        Vehicle jurisdiction: {doc.jurisdictionLabel}. A Schedule K-1 is this vehicle's investor tax
        document.
        {/* ── WAVE 176 · ITEM C · R147.3(4) — THE PANEL MAKING THE STRONGEST CLAIM
            WAS THE ONLY ONE WITHOUT A SOURCE.

            This early-return branch used to end at the sentence above, so a
            Delaware vehicle — the one jurisdiction where the platform asserts
            outright that a Schedule K-1 IS the investor tax document — rendered
            NEITHER the citation NOR the not-tax-advice sentence, while every
            non-US jurisdiction fell through to the card below and rendered both.
            The owner found exactly that on live 26.29.0.

            THE DATA WAS NEVER THE PROBLEM. `SPV_JURISDICTION_TAX_DOCUMENT.delaware`
            has carried its three IRS citations since wave 175 (shared/spvEngine.ts),
            including the Partner's Instructions for Schedule K-1 (Form 1065) at
            https://www.irs.gov/instructions/i1065sk1. This branch simply returned
            before reaching them. Nothing is invented here and no authority is
            added to any jurisdiction: both blocks below render only what the
            jurisdiction's own row holds, which is why Cayman and BVI still name no
            authority.

            R143.1 — the two sentences above are UNTOUCHED, byte-verbatim, in the
            same element with the same `data-testid`. These are STATIC SIBLING
            nodes appended after them, so no copy string is replaced. The blocks
            are deliberate duplicates of the ones in the card below rather than a
            shared sub-component: extracting them would move the existing
            elements into a new component and change their inventory paths, which
            is the drop the guard exists to catch. The two branches are mutually
            exclusive, so the shared testids are never both in the DOM. */}
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
        {/* WAVE 189 · ITEM A · R159.5 — THE STRONG, UNAMBIGUOUS DISCLAIMER.

            A STATIC SIBLING, not a replacement. The literal above is unchanged to the
            byte: under R143.1 a replaced text node scores as a REMOVED copy string in
            the silent-drop inventory, so strengthening the wording in place would have
            registered as deleting a shipped sentence. Both sentences now render.

            Owner: *"We need to have a strong and unambiguous disclaimer here."* The
            sentence names BOTH entities the owner named — Capavate AND BluePrint Catalyst
            Limited — and states explicitly that the reader must consult their own
            accounting firm or tax lawyer. */}
        <div className="text-[11px] mt-1 leading-relaxed font-medium" style={{ color: "#8a5a06" }} data-testid={`${testidPrefix}-no-advice`}>
          {SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER}
        </div>
      </div>
    );
  }

  return (
    <div
      className="mb-3 rounded-md p-2"
      style={{ border: "1px solid rgba(138,90,6,0.35)", background: "rgba(138,90,6,0.06)" }}
      data-testid={`${testidPrefix}-warning`}
    >
      <div className="text-[11px] uppercase tracking-wide" style={{ color: "#8a5a06" }} data-testid={`${testidPrefix}-heading`}>
        Check the tax document for this jurisdiction
      </div>

      <div className="text-[11px] mt-0.5 text-muted-foreground" data-testid={`${testidPrefix}-label`}>
        Vehicle jurisdiction: {doc.jurisdictionLabel}
      </div>

      {jurisdictionUnknown ? (
        <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "#8a5a06" }} data-testid={`${testidPrefix}-unknown`}>
          {SPV_TAX_DOCUMENT_GP_JURISDICTION_UNKNOWN_NOTICE}
        </div>
      ) : (
        <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "#8a5a06" }} data-testid={`${testidPrefix}-not-this-vehicle`}>
          {SPV_TAX_DOCUMENT_GP_US_FORM_NOT_THIS_VEHICLE_NOTICE}
        </div>
      )}

      {!jurisdictionUnknown && (
        <div className="text-[11px] mt-1 leading-relaxed text-muted-foreground" data-testid={`${testidPrefix}-expected`}>
          {doc.onRecord && doc.documentName
            ? `This vehicle's partners expect: ${doc.documentName}.`
            : `${SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL} in this jurisdiction.${
                doc.investorReceivesInstead ? ` Partners receive instead: ${doc.investorReceivesInstead}` : ""
              }`}
        </div>
      )}

      {/* ══ WAVE 179 · ITEM B · R151.3 — HEDGE, OR RESOLVE ══════════════════
          The two nodes below are wave 175's UNCHANGED hedge: the conditional wording
          that states BOTH branches, and the sentence telling the GP that which one
          applies depends on the vehicle's legal form. Both literals are byte-verbatim
          and both testids are unchanged (R143.1). The ONLY change is the added
          `&& !resolvedTreatment` — they stop rendering once the GP has answered the
          very question they ask, because continuing to ask it would be the defect
          this item exists to close.

          When nothing is stated, `resolvedTreatment` is null, both conditions are
          exactly as before, and this card is byte-identical to today. */}
      {doc.vehicleFormDependent && doc.vehicleFormConditional && !resolvedTreatment && (
        <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "#8a5a06" }} data-testid={`${testidPrefix}-vehicle-form`}>
          {doc.vehicleFormConditional}
        </div>
      )}

      {doc.vehicleFormDependent && !resolvedTreatment && (
        <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "#8a5a06" }} data-testid={`${testidPrefix}-vehicle-form-notice`}>
          {SPV_TAX_DOCUMENT_VEHICLE_FORM_NOTICE}
        </div>
      )}

      {/* NEW STATIC SIBLING, appended — never a replacement of the text above.
          The sentence is authored once in `shared/spvLegalForm.ts` from the wave-175
          research and is not composed here. The jurisdiction's own sources still
          render below it, and the not-tax-advice sentence still closes the card:
          resolving the branch narrows what we state, it does not upgrade it into
          tax advice. */}
      {resolvedTreatment && (
        <div
          className="text-[11px] mt-1 leading-relaxed"
          style={{ color: "#8a5a06" }}
          data-testid={`${testidPrefix}-legal-form-resolved`}
        >
          {resolvedTreatment}
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
      {/* WAVE 189 · ITEM A · R159.5 — THE STRONG, UNAMBIGUOUS DISCLAIMER.

          A STATIC SIBLING, not a replacement. The literal above is unchanged to the
          byte: under R143.1 a replaced text node scores as a REMOVED copy string in
          the silent-drop inventory, so strengthening the wording in place would have
          registered as deleting a shipped sentence. Both sentences now render.

          Owner: *"We need to have a strong and unambiguous disclaimer here."* The
          sentence names BOTH entities the owner named — Capavate AND BluePrint Catalyst
          Limited — and states explicitly that the reader must consult their own
          accounting firm or tax lawyer. */}
      <div className="text-[11px] mt-1 leading-relaxed font-medium" style={{ color: "#8a5a06" }} data-testid={`${testidPrefix}-no-advice`}>
        {SPV_TAX_DOCUMENT_NO_ADVICE_DISCLAIMER}
      </div>
    </div>
  );
}
