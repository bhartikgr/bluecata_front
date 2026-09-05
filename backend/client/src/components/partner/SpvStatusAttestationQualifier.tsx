/**
 * NUMBERS BAND · WAVE C · W324 — THE STATUS WORD IS A LIFECYCLE STAGE, NOT A
 * CERTIFICATE OF GOOD ORDER.
 *
 * THE DEFECT, AS READ ON LIVE. "QUantum SPV" renders the status badge
 * "Deployed" and, immediately beneath it, the wave 189 panel reading that the
 * vehicle "has no signed launch attestation on record. It is an unattested
 * draft." BOTH SENTENCES ARE TRUE of the stored row — `status` is `"deployed"`
 * and `GET /api/partner/me/spv/:id/signoffs` returns `{"signoffs":[]}` — and both
 * were verified against an attested control vehicle whose same endpoint returns a
 * row. The word "Deployed" is what misleads: a reader takes it to mean the
 * vehicle is live and in good order, and it does not mean that.
 *
 * WHAT THIS CHANGES AND WHAT IT DOES NOT. Only what is DISPLAYED. `status` is
 * not written, not read differently, and not reinterpreted; `SPV_STATUS_LABELS`
 * and `spvStatusLabel()` in `client/src/lib/partnerDisplay.ts` are untouched, so
 * the status `<option>` list on `PartnerSpvs.tsx` renders the same four words it
 * always has — "Planned", "Open", "Closed", "Wound-down", which come from that
 * file's own local `SPV_STATUS_WIRE_VALUES` array, not from the six-key label map,
 * and one of which ("Planned") is not even a key of that map and reaches the
 * screen through the humanising fallback. NO NEW LIFECYCLE STATE IS INVENTED. The two facts that
 * already exist — the lifecycle stage, and whether a launch attestation is on
 * record — are simply shown next to each other instead of contradicting each
 * other in silence.
 *
 * TWO CHILDREN, AND WHY.
 *
 *  1. THE RULE (`-rule`), ALWAYS RENDERED. It states the relationship between
 *     the two facts and makes no claim about THIS vehicle, so it is true in every
 *     branch — loading, empty, error, attested, unattested, unknown shape. It
 *     names no count and no number, per the owner's instruction to state a rule
 *     rather than a figure.
 *
 *  2. THE VERDICT (`-verdict`), ALWAYS RENDERED, THREE MUTUALLY EXCLUSIVE
 *     BRANCHES. Unattested; attested; or "could not be read". The third branch
 *     is the point of this component existing at all: the wave 189 panel is
 *     fail-quiet and renders NOTHING when the query is loading, errors, or comes
 *     back in a shape it does not recognise — which is byte-identical, to a
 *     reader, to the silence it renders for a vehicle in good order. An absence
 *     that reads as reassurance is worse than a fabrication (R224.1). This
 *     component therefore never goes silent: it either answers, or it says it
 *     could not.
 *
 * NO NEW ROUTE, NO NEW DTO FIELD, NO SERVER CHANGE. It reads the same query key
 * as `SpvAttestationStatusNotice` — `["/api/partner/me/spv", spvId, "signoffs"]` —
 * so where both are mounted react-query serves one cached response to both and
 * the network cost of this wave is zero additional requests. Measured on live:
 * neither `GET /api/partner/me/spvs` (the list payload) nor
 * `GET /api/partner/me/spv/:id` (the detail payload) carries any attestation
 * field, which is why this component fetches rather than reading a prop, and why
 * the collapsed rows of the SPV engine list get the RULE only and no per-row
 * verdict: a verdict there would mean one HTTP request per row.
 *
 * COPY DISCIPLINE. Every string here is new copy in a new file. No existing text
 * node anywhere is replaced, reworded, moved or hoisted. The label
 * "Unattested draft" is imported from `@shared/spvUnattestedDraft` so this
 * surface and a server refusal use the same words.
 */
import { useQuery } from "@tanstack/react-query";
import { SPV_UNATTESTED_DRAFT_LABEL } from "@shared/spvUnattestedDraft";

interface SignoffRow {
  id?: string;
  signerLegalName?: string | null;
  signedAt?: string | null;
}

/* THE RULE. Exported so a test can assert the rendered words are these words and
   not a paraphrase, and so the same sentence can never drift between the two
   surfaces that mount this component. */
export const SPV_STATUS_IS_LIFECYCLE_ONLY =
  "The status word above is a lifecycle stage only. It does not mean a launch attestation has been signed: a vehicle may not take an LP, a commitment or a fee until its attestation is on record, whatever stage it is at.";

/* THE THREE VERDICTS. Each is a complete sentence about THIS vehicle. The
   unknown branch contains neither of the other two verdicts' claims, so a reader
   can never mistake a failed read for either an attested or an unattested
   answer. */
export const SPV_ATTESTATION_VERDICT_SIGNED =
  "A signed launch attestation is on record for this vehicle.";
export const SPV_ATTESTATION_VERDICT_UNSIGNED =
  `No signed launch attestation is on record for this vehicle, so it is an ${SPV_UNATTESTED_DRAFT_LABEL.toLowerCase()} regardless of the stage shown above.`;
export const SPV_ATTESTATION_VERDICT_UNKNOWN =
  "The launch attestation record for this vehicle could not be read just now, so this surface is not stating whether one is signed. Treat it as unanswered, not as either answer.";

export default function SpvStatusAttestationQualifier({
  spvId,
  testid,
}: {
  spvId: string;
  testid: string;
}) {
  const q = useQuery<{ signoffs?: SignoffRow[] }>({
    queryKey: ["/api/partner/me/spv", spvId, "signoffs"],
    enabled: Boolean(spvId),
  });

  /* Order matters and is deliberate. A missing spvId, a loading query, an
     errored query and an unrecognised payload shape all land on the SAME
     honest "unanswered" sentence, because none of them is evidence about the
     vehicle. Only an actual array decides between signed and unsigned. */
  let verdict = SPV_ATTESTATION_VERDICT_UNKNOWN;
  if (spvId && !q.isLoading && !q.isError) {
    const signoffs = Array.isArray(q.data?.signoffs) ? q.data!.signoffs! : null;
    if (signoffs !== null) {
      verdict =
        signoffs.length > 0
          ? SPV_ATTESTATION_VERDICT_SIGNED
          : SPV_ATTESTATION_VERDICT_UNSIGNED;
    }
  }

  return (
    <>
      <div className="text-[10px] text-[var(--cv-color-text-muted)] mt-1" data-testid={`${testid}-rule`}>
        {SPV_STATUS_IS_LIFECYCLE_ONLY}
      </div>
      <div className="text-[10px] text-[var(--cv-color-text-muted)]" data-testid={`${testid}-verdict`}>
        {verdict}
      </div>
    </>
  );
}
