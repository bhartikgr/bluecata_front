/* v25.34 Collective Payment Model — DB-driven, no in-memory.
 *
 * Parallel to v25.33's partnerFeeResolver.ts, but for the Collective (chapter
 * members / founders). Single source of truth for resolving a Collective fee.
 *
 * v25.35 Phase 3 #16 — chapter_id precedence restored (v25.34 regression).
 * The schema has always carried a `chapter_id` column on
 * collective_payment_schedules, but the v25.34 resolver ignored it entirely,
 * so a chapter-specific override (e.g. Toronto chapter dues) was silently
 * dropped and the global default served instead. The full precedence is now
 * (highest -> lowest):
 *   1. per-member  + chapter-specific   (scope_kind='member', member_id=<id>, chapter_id=<ch>)
 *   2. per-member  + global             (scope_kind='member', member_id=<id>, chapter_id IS NULL)
 *   3. per-tier    + chapter-specific   (scope_kind='tier', tier=<t>, chapter_id=<ch>)
 *   4. per-tier    + global             (scope_kind='tier', tier=<t>, chapter_id IS NULL)
 *   5. platform    + chapter-specific   (scope_kind='platform', chapter_id=<ch>)
 *   6. platform    + global             (scope_kind='platform', chapter_id IS NULL)
 * Within each scope level the chapter-specific row wins over the global row via
 * an ORDER BY that prefers `chapter_id IS NOT NULL`.
 *
 * All reads hit SQLite via rawDb(); nothing is cached in process memory.
 * Fail-closed: throws CollectivePaymentResolutionError when no schedule row can
 * be found (the seeded $0 platform rows in connection.ts guarantee a row exists
 * on a fresh deploy, so a throw here means a genuine config gap). Currency and
 * amounts ALL come from the DB — there are NO hardcoded fee amounts here.
 *
 * IMPORTANT: this resolver only QUOTES. It does not charge money and does not
 * touch Avi's payment write paths (paymentGatewayAdapter.ts) or the SACRED
 * collectiveBillingStore.ts. It is a parallel, additive system.
 */
import { rawDb } from "../db/connection";

/** fee_kind enum — mirrors collective_payment_schedules.fee_kind semantics. */
export type CollectiveFeeKind =
  | "membership_dues"
  | "event_fee"
  | "sponsorship_fee"
  | "chapter_dues"
  | "late_fee";

/** Collective member tiers (mirror collective_memberships_billing.tier). */
export type CollectiveTier = "basic" | "standard" | "premium";

/** How a resolved value was arrived at — recorded in collective_payment_entries.computed_via. */
export type CollectiveComputedVia = "member_override" | "tier_default" | "platform_default";

/**
 * v25.35 — whether the winning schedule row was chapter-specific or global.
 * Surfaced alongside computedVia for transparency/audit; does not change the
 * legacy computedVia enum values (consumers/tests that key off computedVia are
 * unaffected).
 */
export type CollectiveChapterScope = "chapter_specific" | "global";

export interface ResolvedCollectiveFee {
  amountMinor: number;
  currency: string;
  cadence: string;
  /** The collective_payment_schedules.id that supplied the value. */
  scheduleId: string;
  computedVia: CollectiveComputedVia;
  /** v25.35 — chapter scope of the winning row (additive, optional). */
  chapterScope?: CollectiveChapterScope;
}

export class CollectivePaymentResolutionError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CollectivePaymentResolutionError";
    this.code = code;
    this.details = details;
  }
}

interface ScheduleRow {
  id: string;
  scope_kind: string;
  member_id: string | null;
  tier: string | null;
  chapter_id: string | null;
  fee_kind: string;
  amount_minor: number;
  currency: string;
  cadence: string;
  effective_from: string;
  effective_to: string | null;
}

/** ISO timestamp helper — single point so tests can reason about "now". */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Pull currently-effective schedule rows for a fee_kind at a given scope.
 * "Currently effective" = effective_from <= now AND (effective_to IS NULL OR
 * effective_to > now). Ordered effective_from DESC so the most recent wins.
 * The scope predicate is built from FIXED column fragments (never interpolated
 * user input) and all values are parameter-bound.
 */
function readScheduleRows(
  feeKind: CollectiveFeeKind,
  scope: { scopeKind: "member"; memberId: string } | { scopeKind: "tier"; tier: CollectiveTier } | { scopeKind: "platform" },
  atIso: string,
  chapterId: string | null,
): ScheduleRow[] {
  const db = rawDb();
  let scopePredicate: string;
  const params: unknown[] = [feeKind];
  if (scope.scopeKind === "member") {
    scopePredicate = "scope_kind = 'member' AND member_id = ?";
    params.push(scope.memberId);
  } else if (scope.scopeKind === "tier") {
    scopePredicate = "scope_kind = 'tier' AND tier = ?";
    params.push(scope.tier);
  } else {
    scopePredicate = "scope_kind = 'platform'";
  }
  // v25.35 Phase 3 #16 — chapter_id predicate. When a chapter is supplied we
  // accept BOTH the chapter-specific row AND the global (chapter_id IS NULL)
  // row, then prefer the chapter-specific one via ORDER BY. When no chapter is
  // supplied we only match global rows so a chapter override never leaks across
  // chapters. Column fragment is FIXED; value is parameter-bound.
  let chapterPredicate: string;
  if (chapterId) {
    chapterPredicate = "AND (chapter_id = ? OR chapter_id IS NULL)";
    params.push(chapterId);
  } else {
    chapterPredicate = "AND chapter_id IS NULL";
  }
  params.push(atIso, atIso);
  // v25.34 (CONCERN 5): deterministic tiebreaker. The 3-level precedence
  // (member > tier > platform) is enforced by the caller's level-walk, but when
  // multiple rows within the SAME scope tie on effective_from (possible because
  // SQLite treats NULL scope columns as distinct under UNIQUE, so duplicate
  // platform-default rows can exist), break the tie by:
  //   v25.35: 0. chapter-specific row first (chapter_id IS NOT NULL),
  //   1. most-specific scope first (member_id present > tier present > neither),
  //   2. then created_at DESC (newest config wins).
  const sql = `
    SELECT id, scope_kind, member_id, tier, chapter_id, fee_kind, amount_minor,
           currency, cadence, effective_from, effective_to
    FROM collective_payment_schedules
    WHERE fee_kind = ?
      AND ${scopePredicate}
      ${chapterPredicate}
      AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to > ?)
    ORDER BY (CASE WHEN chapter_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
             effective_from DESC,
             (CASE WHEN member_id IS NOT NULL THEN 2
                   WHEN tier IS NOT NULL THEN 1
                   ELSE 0 END) DESC,
             created_at DESC
  `;
  return db.prepare(sql).all(...params) as ScheduleRow[];
}

export interface ResolveCollectiveOpts {
  /** Override "now" for time-windowed resolution (tests). */
  atIso?: string;
  /**
   * v25.35 Phase 3 #16 — the caller's chapter. When supplied, chapter-specific
   * schedule rows take precedence over global rows at each scope level. When
   * omitted (undefined/null) the resolver matches GLOBAL rows only — exactly
   * the v25.34 behaviour — so existing callers/tests are unaffected.
   */
  chapterId?: string | null;
}

/**
 * Resolve a single Collective fee for a member. Walks the 3-level precedence
 * and returns the first hit. Throws (fail-closed) if nothing resolves.
 *
 * @param memberId  Collective member id (collective_memberships_billing.user_id or contacts.id)
 * @param tier      The member's tier (basic|standard|premium)
 * @param feeKind   Which fee to resolve
 */
export function resolveCollectiveFee(
  memberId: string,
  tier: CollectiveTier,
  feeKind: CollectiveFeeKind,
  opts: ResolveCollectiveOpts = {},
): ResolvedCollectiveFee {
  const atIso = opts.atIso ?? nowIso();
  // v25.35 — normalise chapter; undefined -> null (global-only match).
  const chapterId = opts.chapterId ?? null;
  const scopeOf = (r: ScheduleRow): CollectiveChapterScope =>
    r.chapter_id ? "chapter_specific" : "global";

  // ---- Level 1: per-member override (highest precedence) ----
  const memberRows = readScheduleRows(feeKind, { scopeKind: "member", memberId }, atIso, chapterId);
  if (memberRows.length > 0) {
    const r = memberRows[0];
    return {
      amountMinor: r.amount_minor,
      currency: r.currency,
      cadence: r.cadence,
      scheduleId: r.id,
      computedVia: "member_override",
      chapterScope: scopeOf(r),
    };
  }

  // ---- Level 2: per-tier default ----
  const tierRows = readScheduleRows(feeKind, { scopeKind: "tier", tier }, atIso, chapterId);
  if (tierRows.length > 0) {
    const r = tierRows[0];
    return {
      amountMinor: r.amount_minor,
      currency: r.currency,
      cadence: r.cadence,
      scheduleId: r.id,
      computedVia: "tier_default",
      chapterScope: scopeOf(r),
    };
  }

  // ---- Level 3: platform default ----
  const platformRows = readScheduleRows(feeKind, { scopeKind: "platform" }, atIso, chapterId);
  if (platformRows.length > 0) {
    const r = platformRows[0];
    return {
      amountMinor: r.amount_minor,
      currency: r.currency,
      cadence: r.cadence,
      scheduleId: r.id,
      computedVia: "platform_default",
      chapterScope: scopeOf(r),
    };
  }

  // ---- Fail-closed ----
  throw new CollectivePaymentResolutionError(
    "no_schedule_configured",
    `No collective payment schedule found for fee_kind='${feeKind}' ` +
      `(member='${memberId}', tier='${tier}'). A seeded $0 platform default ` +
      `should always exist — this indicates a missing migration.`,
    { feeKind, memberId, tier, atIso },
  );
}

/**
 * Quote ALL fee kinds for a member at once (used by the member self-service
 * quote endpoint and the admin P&L preview). Returns one resolved fee per
 * kind; skips kinds that fail to resolve (so a partial config still quotes
 * what it can) but records the failure code for transparency.
 */
export interface CollectiveQuoteLine {
  feeKind: CollectiveFeeKind;
  resolved: ResolvedCollectiveFee | null;
  error: string | null;
}

export function quoteAllCollectiveFees(
  memberId: string,
  tier: CollectiveTier,
  opts: ResolveCollectiveOpts = {},
): CollectiveQuoteLine[] {
  const kinds: CollectiveFeeKind[] = [
    "membership_dues",
    "event_fee",
    "sponsorship_fee",
    "chapter_dues",
    "late_fee",
  ];
  return kinds.map((feeKind) => {
    try {
      return { feeKind, resolved: resolveCollectiveFee(memberId, tier, feeKind, opts), error: null };
    } catch (err) {
      const code = err instanceof CollectivePaymentResolutionError ? err.code : "resolve_failed";
      return { feeKind, resolved: null, error: code };
    }
  });
}
