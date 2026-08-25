/* ═══════════════════════════════════════════════════════════════════════════════
   WAVE 125 · FINDING 3 — A RAW SPV IDENTIFIER PRINTED AS A COMPANY NAME TO AN
   INVESTOR, ON THE SCREEN HE READS BEFORE DECIDING TO WIRE MONEY.
   ═══════════════════════════════════════════════════════════════════════════════
   On the live investor invitations list one invitation's company read

       spv_e08dcbdd2921a89c

   The independent code verification established this is a CODE FALLBACK, not
   mistyped test data: `server/routes.ts:4228` (list) and `:4391` (detail) both
   ended their resolution chain with `?? resolvedCompanyId`, and
   `getCompanyNameById` (`server/multiCompanyStore.ts:386-395`) searches FOUNDER
   COMPANY MEMBERSHIPS only — so an `spv_…` id can never resolve there and the id
   itself was emitted as the company's name.

   Wave 124 measured this class at 456 sites across 145 files and fixed 8 screens.
   The investor invitation screens were not among them.

   WHAT THIS DOES, IN ORDER, AND WHY EACH STEP EXISTS:
     1. the demo/seed company list the caller already holds;
     2. `getCompanyNameById` — the real founder-company register;
     3. `engineGetLegacySpvById(id).name` — THE MISSING STEP. An `spv_…` id names a
        row in the `spv` table which HAS a `name` column. The name was there all
        along; nothing looked for it.
     4. `partyReferenceLabel()` from `client/src/lib/partnerDisplay.ts` — the
        Wave 115 floor. It strips the known prefix and returns e.g.
        `Reference E08DCBDD2921A89C`: plainly a reference, not a name, and NOT the
        raw identifier. Wave 115 blessed this as "the floor, not the preference".
     5. an empty id → `humanizeMachineKey("", "Company not recorded")`, i.e. the
        words, because there is nothing to reference.

   IT NEVER FABRICATES A NAME AND NEVER RETURNS THE RAW ID. It always returns a
   non-empty `string`, because `client/src/pages/investor/Invitations.tsx:60` types
   `company.name` as a REQUIRED `string` and `:382` calls
   `.split(" ").map(s => s[0])` on it to build initials — that page is owned by
   another wave and must not be handed a `null`.
   ══════════════════════════════════════════════════════════════════════════════ */
import { getCompanyNameById } from "../multiCompanyStore";
import { engineGetLegacySpvById } from "../spvEngineStore";
/* The platform's existing identifier-labelling helpers, reused rather than
   reimplemented, exactly as the wave brief requires. Server → client-library
   imports are established in this tree (`server/commsStore.ts:56`). */
import { partyReferenceLabel, humanizeMachineKey } from "../../client/src/lib/partnerDisplay";

/** The words used when there is no identifier to reference at all. */
export const COMPANY_NAME_NOT_RECORDED = "Company not recorded";

function nonEmpty(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : null;
}

/**
 * Resolve the company name for an investor-facing invitation payload.
 *
 * @param companyId  the resolved company id, possibly `""`, possibly an `spv_…`.
 * @param seedName   a name the caller already resolved (the demo company list).
 */
export function invitationCompanyName(companyId: unknown, seedName?: unknown): string {
  const id = typeof companyId === "string" ? companyId.trim() : "";
  const fromSeed = nonEmpty(seedName);
  if (fromSeed) return fromSeed;
  if (!id) return COMPANY_NAME_NOT_RECORDED;

  const fromRegister = nonEmpty(getCompanyNameById(id));
  if (fromRegister) return fromRegister;

  /* THE STEP THAT WAS MISSING. A throwing or un-hydrated SPV store is not a
     reason to print an identifier, so this is guarded and falls through. */
  try {
    const fromSpv = nonEmpty(engineGetLegacySpvById(id)?.name);
    if (fromSpv) return fromSpv;
  } catch {
    /* fall through to the reference label */
  }

  /* The floor: a reference the investor can quote to support, never a name we
     invented and never the raw key. */
  const reference = nonEmpty(partyReferenceLabel(id));
  if (reference) return reference;
  return humanizeMachineKey(id, COMPANY_NAME_NOT_RECORDED);
}
