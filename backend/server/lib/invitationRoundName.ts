/* ══════════════════════════════════════════════════════════════════════════════
   RESIDUALS · ITEM 4 — "Round spvlp_spv_e08dcbdd2921a89c" WAS A STORAGE KEY.
   ══════════════════════════════════════════════════════════════════════════════
   THE DEFECT, verbatim from the tree before this change (`server/routes.ts:4728`
   and `:4894`, the two investor-facing invitation projections):

       name: round?.name ?? `Round ${inv.roundId}`,

   The word "Round" followed by the raw identifier. The investor's Invitations
   list — and the same payload re-rendered on the "Your Decision" tab — showed
   `Round spvlp_spv_e08dcbdd2921a89c` where a round's name belongs.

   WHY THE LOOKUP MISSES, MEASURED RATHER THAN ASSUMED. It is not a broken read.
   An SPV's LP invitation is minted against a SYNTHETIC round id,
   `spvlp_${spv.id}`, declared as such at `server/spvEngineRoutes.ts:2691`
   ("synthetic, price-less → no reconcile price coupling") and at `:2342`. NO ROW
   IS EVER WRITTEN TO `rounds` FOR IT. So `getRoundById` will always miss, and
   the fallback was always going to fire for every SPV LP invitation ever sent.
   There is no name to find in `rounds`, and inventing one is not an option.

   BUT A REAL NAME DOES EXIST. A `spvlp_<spvId>` id carries the vehicle's own id
   inside it, and `spvs.name` holds that vehicle's stored name. The invitation IS
   an invitation into that vehicle, so naming it after the vehicle is a restated
   stored fact, not a fabrication. That is the same missing step
   `server/lib/invitationCompanyName.ts` found for the COMPANY field of this very
   payload — the round field beside it was simply missed.

   THE LADDER, IN ORDER:
     1. the real `rounds` row, if there is one (unchanged behaviour);
     2. the SPV register, for a `spvlp_<spvId>` synthetic id — the vehicle's
        STORED name, prefixed with the words that say what the reader is
        looking at;
     3. `partyReferenceLabel` — the Wave 115 floor. `Reference E08DCBDD2921A89C`:
        plainly a reference, unique, and NOT the raw id;
     4. an empty id → the words, because there is nothing to reference.

   IT NEVER FABRICATES A NAME AND NEVER RETURNS THE RAW ID. It always returns a
   non-empty string, because the investor-facing types treat `round.name` as a
   required `string`.
   ══════════════════════════════════════════════════════════════════════════════ */
import { engineGetLegacySpvById } from "../spvEngineStore";
/* The platform's existing identifier-labelling helpers, reused rather than
   reimplemented. Server → client-library imports are established in this tree
   (`server/lib/invitationCompanyName.ts:43`, `server/commsStore.ts:56`). */
import { partyReferenceLabel, humanizeMachineKey } from "../../client/src/lib/partnerDisplay";

/** The words used when there is no identifier to reference at all. */
export const ROUND_NAME_NOT_RECORDED = "Round not recorded";

/** The prefix `server/spvEngineRoutes.ts` mints synthetic SPV LP round ids with. */
export const SPV_LP_ROUND_ID_PREFIX = "spvlp_";

function nonEmpty(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : null;
}

/**
 * Resolve the round name for an investor-facing invitation payload.
 *
 * @param roundId   the invitation's round id, possibly `""`, possibly synthetic.
 * @param storedName a name the caller already resolved from the `rounds` table.
 */
export function invitationRoundName(roundId: unknown, storedName?: unknown): string {
  const fromRound = nonEmpty(storedName);
  if (fromRound) return fromRound;

  const id = typeof roundId === "string" ? roundId.trim() : "";
  if (!id) return ROUND_NAME_NOT_RECORDED;

  if (id.startsWith(SPV_LP_ROUND_ID_PREFIX)) {
    const spvId = id.slice(SPV_LP_ROUND_ID_PREFIX.length);
    if (spvId) {
      /* A throwing or un-hydrated SPV store is not a reason to print an
         identifier, so this is guarded and falls through to the reference
         label. The catch is NOT allowed to become the answer. */
      try {
        const vehicle = nonEmpty(engineGetLegacySpvById(spvId)?.name);
        if (vehicle) return `LP subscription — ${vehicle}`;
      } catch {
        /* fall through to the reference label */
      }
    }
  }

  /* The floor: a reference the investor can quote to support, never a name we
     invented and never the raw key. */
  const reference = nonEmpty(partyReferenceLabel(id));
  if (reference) return reference;
  return humanizeMachineKey(id, ROUND_NAME_NOT_RECORDED);
}
