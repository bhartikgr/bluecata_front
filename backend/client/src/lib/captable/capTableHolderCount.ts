/* ═══════════════════════════════════════════════════════════════════════════════
   WAVE 125 · FINDING 2 — THE EIGHTH REGISTER THAT NOTHING WRITES.
   ═══════════════════════════════════════════════════════════════════════════════
   `FounderCompanyKpi.capTableHolders` had NO WRITER anywhere in live code. A
   comment-stripped enumeration (`build_log/wave125/enum_captable_holders.py`)
   classified all 29 live sites: 7 type declarations, 16 integer literals, 2
   passthroughs, 6 render sites — and 0 computations. Three of the literals are a
   demo `14 / 6 / 9`; the rest are `0`.

   So five user-facing surfaces printed a number nobody had ever computed:
     · `client/src/pages/founder/Dashboard.tsx:557`  (bento tile)
     · `client/src/pages/founder/Dashboard.tsx:683`  (`stat-holders`)
     · `client/src/components/CompanySwitcher.tsx:194` ("0 holders")
     · `client/src/pages/SelectCompany.tsx:146`       ("0 investors")
     · `client/src/pages/founder/Reports.tsx:235`     (report snapshot)
   while, on the SAME dashboard page, `CapitalizationJourney.tsx` derived the same
   quantity correctly from the engine and rendered `1`. The page contradicted
   itself.

   A count of holders is not money, so a DERIVED zero is meaningful and is
   published. What must never be published is a zero that means "nobody computed
   this" — hence `number | null` end to end, and a plain-English statement where
   the count is not derivable.

   THIS FILE IS THE ONE DEFINITION (R46: two numbers for one quantity is what
   created the defect). It is the definition `CapitalizationJourney.tsx:553-555`
   already used, lifted verbatim so the journey's rendered figure does not move,
   and it is imported by BOTH the journey and the server producer
   (`server/lib/founderOwnershipEngine.ts::computeCapTableHolderCount`). A server
   module importing a client library is established practice in this tree —
   `server/commsStore.ts:56` imports `../client/src/lib/comms/types`.
   ══════════════════════════════════════════════════════════════════════════════ */

/** The only shape this module needs from an engine row. */
export type CapTableHolderRow = { holderType: string; holderName: string };

/** Which holder types are counted. Founders, investors and the option pool are
 *  the three bands the cap table publishes; the journey's KPI hint has named them
 *  as "founders + investors + pool" since Wave 116 and that stays true. */
const COUNTED_HOLDER_TYPES = new Set(["investor", "founder", "pool"]);

/** The em dash the platform renders for a figure it does not have (R47). Used in
 *  place of a count, never beside one. */
export const CAP_TABLE_HOLDERS_UNDERIVED = "—";

/** Plain English for the surfaces that cannot derive the count. */
export const CAP_TABLE_HOLDERS_NOT_DERIVED_STATEMENT =
  "Not counted — the cap-table holder count has not been derived for this company yet.";

/**
 * Distinct cap-table holders on record, counted by holder NAME so that a holder
 * with several securities counts once.
 *
 * A `0` returned here is a DERIVED zero: the rows were read and none of them was
 * a counted holder. Callers that have no rows to read must return `null` rather
 * than calling this with an empty list and publishing its `0`.
 */
export function countCapTableHolders(rows: readonly CapTableHolderRow[]): number {
  return new Set(
    rows.filter((r) => COUNTED_HOLDER_TYPES.has(r.holderType)).map((r) => r.holderName),
  ).size;
}
