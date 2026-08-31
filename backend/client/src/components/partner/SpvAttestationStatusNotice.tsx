/**
 * WAVE 189 · ITEM C · R159.6 — LABEL AN UNATTESTED DRAFT UNMISTAKABLY.
 *
 * Owner: drafts allowed, **clearly labelled unattested**, and no LP, no commitment
 * and no fee may attach until the attestation is signed.
 *
 * WHAT THIS IS, AND WHAT IT IS EMPHATICALLY NOT. This is a STATEMENT, not an
 * enforcement. Wave 182's lesson — quoted by the owner in this wave's brief — is
 * that a disabled button is not enforcement: a closed vehicle still accepted
 * capital because the check was missing where the write happens. The refusal that
 * actually holds is `assertSpvAttestedForNewCapital`, called at four store sinks
 * and at the lp-commit route boundary. This component exists so that a general
 * partner is never SURPRISED by that refusal: the vehicle says what it is before
 * anything is typed into it.
 *
 * WHERE THE FACT COMES FROM. `GET /api/partner/me/spv/:spvId/signoffs`, which
 * already existed and is already partner-scoped. No new route, no new DTO field,
 * and no change to `spvLaunchSignoffStore.ts`.
 *
 * FAIL-QUIET, DELIBERATELY. While the query is loading, or if it errors, this
 * renders NOTHING rather than guessing. Claiming "unattested" about a vehicle
 * whose sign-off record simply could not be fetched would be a false statement on
 * an investor-grade surface, and the enforcement layer does not depend on this
 * component being right.
 *
 * COPY DISCIPLINE (R143.1). Every string rendered here is NEW copy in a NEW file.
 * No existing text node is replaced, reworded or removed anywhere by this
 * component, and the label and sentence are imported from
 * `@shared/spvUnattestedDraft` so the words on this surface and the words in a
 * server refusal are the same words.
 */
import { useQuery } from "@tanstack/react-query";
import {
  SPV_UNATTESTED_DRAFT_LABEL,
  spvUnattestedDraftNotice,
} from "@shared/spvUnattestedDraft";

interface SignoffRow {
  id?: string;
  signerLegalName?: string | null;
  signedAt?: string | null;
}

export default function SpvAttestationStatusNotice({
  spvId,
  spvName,
  testid = "spv-attestation-status",
}: {
  spvId: string;
  spvName?: string | null;
  testid?: string;
}) {
  const q = useQuery<{ signoffs?: SignoffRow[] }>({
    queryKey: ["/api/partner/me/spv", spvId, "signoffs"],
    enabled: Boolean(spvId),
  });

  if (q.isLoading || q.isError) return null;
  const signoffs = Array.isArray(q.data?.signoffs) ? q.data!.signoffs! : null;
  /* A response with no `signoffs` array is not evidence of an unsigned vehicle —
     it is evidence of a shape this component does not understand. Say nothing. */
  if (signoffs === null) return null;
  /* ATTESTED. Nothing to warn about, and no reason to add noise to the surface of
     a vehicle that is in good order. */
  if (signoffs.length > 0) return null;

  return (
    <div
      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
      data-testid={testid}
    >
      <div className="text-xs font-semibold uppercase tracking-wide" data-testid={`${testid}-label`}>
        {SPV_UNATTESTED_DRAFT_LABEL}
      </div>
      <div className="mt-1 text-xs" data-testid={`${testid}-notice`}>
        {spvUnattestedDraftNotice(spvName)}
      </div>
    </div>
  );
}
