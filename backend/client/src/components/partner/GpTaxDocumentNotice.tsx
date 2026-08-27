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
  SPV_TAX_DOCUMENT_SOURCES_LABEL,
} from "@shared/spvEngine";

export function GpTaxDocumentNotice({
  jurisdiction,
  testidPrefix = "spv-k1-jurisdiction",
}: {
  jurisdiction?: string | null;
  testidPrefix?: string;
}) {
  const doc = useMemo(() => spvJurisdictionTaxDocument(jurisdiction), [jurisdiction]);

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
