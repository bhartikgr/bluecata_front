/**
 * Wave C-2 D2 / LOCK 4 — COMPATIBILITY RE-EXPORT SHIM.
 *
 * The apply brief names this path (`server/lib/eventBus_helpers_LOCK4.ts`) for the LOCK 4
 * pillar helpers. The module's own header and `ASSUMPTIONS_D2.md:24` both declare its
 * canonical target path as `server/lib/eventBusPillarHelpers.ts`, and the `eventBus.ts`
 * LOCK 4 branch resolves it by that name (`requireCjs("./eventBusPillarHelpers")`).
 *
 * Rather than duplicate ~290 lines of SQL predicates at two paths — which would guarantee
 * drift the first time a predicate is tuned — the real module is installed ONCE, byte-
 * identically, at the canonical path, and this file is a pure re-export so the brief's
 * stated path also resolves. There is NO logic here. (Assumption A-APPLY-D2-LOC1.)
 */
export {
  parsePartnerRepresentationId,
  hasActivePartnerAttribution,
  hasActivePartnerEngagement,
  isCapavatePortfolioCompany,
  isCollectiveMemberCompany,
  _resetEventBusPillarHelpersForTests,
} from "./eventBusPillarHelpers";
export type { PillarKey, PartnerRepresentationId } from "./eventBusPillarHelpers";
