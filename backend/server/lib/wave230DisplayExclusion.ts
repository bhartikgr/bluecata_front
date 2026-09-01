/**
 * WAVE 230D — THE DISPLAY-SURFACE EXCLUSION, IN ONE PLACE.
 *
 * Wave 230 filtered exactly one computation (`computeKpis`'s revenue). Five
 * surfaces still rendered every marked record: the admin company list, the
 * dashboard company count, the region counts, the admin subscriptions table and
 * the partner portfolio. This module is the single predicate all of them now
 * share, so they cannot drift apart into five slightly different definitions of
 * "excluded".
 *
 * THE SAFETY PROPERTIES, AND WHY EACH SURVIVES HERE:
 *
 * • **NULL = KEPT.** `wave230ExcludedIds` selects only rows whose mark column is
 *   NOT NULL and non-empty, so an unmarked row is never in the set.
 *
 * • **A READ FAILURE DEGRADES TO "NOTHING EXCLUDED".** `wave230ExcludedIds`
 *   catches and returns an EMPTY set. An empty set makes every predicate below
 *   return `true` for every row, which is byte-identical to today's behaviour.
 *   The opposite failure mode — everything excluded — would blank every list on
 *   the platform at once, so it must never be possible, and structurally it is
 *   not: nothing here can ADD an id to the set.
 *
 * • **PER-RECORD, NEVER PER-TENANT (R230.6).** Nothing in this file reads
 *   `tenant_id`. A company is hidden only because that company row carries its
 *   own mark. "QA Note Round" inside BluePrint Catalyst Limited is reachable as
 *   a `rounds` row without the operator's real company ever being touched.
 *
 * • **A SUBSCRIPTION IS HIDDEN BY ITS OWN MARK OR BY ITS COMPANY'S.** That is
 *   the same union `computeKpis` already applies, imported in shape rather than
 *   re-derived, so the reported revenue and the rendered table cannot disagree.
 *
 * • **NOTHING IS DELETED AND NOTHING IS UNREACHABLE.** These are display
 *   filters. Every hidden record is listed, with when/why/by whom, at
 *   `GET /api/admin/test-data/excluded`, and one click restores it.
 *
 * • **NO MONEY ARITHMETIC HAPPENS HERE.** This module decides visibility only.
 *   No `Number()`, no `parseInt`, no `parseFloat`, no currency handling.
 */
import { wave230ExcludedIds } from "./wave230TestDataFlags";

/**
 * The set of company ids that display surfaces must not render.
 *
 * Computed once per request by the caller and reused across the rows of that
 * request — never once per row, which would be a query per row.
 */
export function wave230HiddenCompanyIds(): Set<string> {
  return wave230ExcludedIds("companies");
}

/**
 * A predicate over company id. `true` means RENDER IT.
 *
 * Written as "keep unless proved excluded" rather than "hide unless proved
 * kept", because the first fails safe when the read fails and the second does
 * not.
 */
export function wave230CompanyVisible(hidden: Set<string>, companyId: unknown): boolean {
  const id = typeof companyId === "string" ? companyId : "";
  if (id === "") return true;
  return !hidden.has(id);
}

/**
 * Subscriptions are keyed by `company_id` — the table has no `id` column — so
 * the subscription's own mark and its company's mark are both membership tests
 * on the same string. Both are applied, as a union, exactly as `computeKpis`
 * does.
 */
export function wave230HiddenSubscriptionCompanyIds(): Set<string> {
  const out = new Set<string>();
  for (const id of wave230ExcludedIds("subscriptions")) out.add(id);
  for (const id of wave230ExcludedIds("companies")) out.add(id);
  return out;
}

/** A predicate over a subscription's `companyId`. `true` means RENDER IT. */
export function wave230SubscriptionVisible(hidden: Set<string>, companyId: unknown): boolean {
  return wave230CompanyVisible(hidden, companyId);
}
