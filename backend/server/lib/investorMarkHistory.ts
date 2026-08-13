/**
 * WAVE 31 · W31-A1 — the investor mark-history read model.
 *
 * WHAT THIS REPLACES, AND WHY IT IS WIRING RATHER THAN BUILDING.
 *
 * `GET /api/investor/portfolio/:id/marks` (server/sprint20Wave2Routes.ts) was a
 * HARDCODED STUB. Its entire body was:
 *
 *     return res.json({ holdingId: id, marks: [] });
 *
 * No database was consulted. The comment above it said "Wave 3 will populate
 * from a real marks table". Wave 3 came and went; so did twenty-seven more.
 * Meanwhile the client's Mark-history chart
 * (client/src/components/investor/PortfolioCompanyOverview.tsx) renders
 * `marks.length === 0` as "No mark history yet. Historical mark data appears
 * here once recorded by the founder." — a sentence that could never stop being
 * true, because nothing the founder did could change a literal `[]`.
 *
 * THE ENGINE ALREADY EXISTED. `valuation_event` (migration 0159, M-2) is a
 * STRICT, mirrored, self-healed table holding exactly this data — dated
 * fair-value marks in integer minor units with a currency, a method, a source
 * and a supersession column. `valuation_mark_override` (0159 M-2b, hardened by
 * 0174) carries GP overrides. `server/wave9ReportingStore.ts` reads and writes
 * both. Nothing needed to be built; the two ends needed to be joined, and the
 * authorization that the stub never had to be put on the join.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE AUTHORIZATION HOLE THE STUB WAS HIDING (read this before editing).
 *
 * The prefix mount is `app.use("/api/investor/portfolio", gate("investor.hasAnyCapTable"))`
 * (server/routes.ts:1747). That is an ENTITLEMENT gate — "does this caller hold
 * ANY cap-table position at all" — and it is emphatically NOT an authorization
 * gate on the company in the path. Any investor with a single holding anywhere
 * satisfies it.
 *
 * While the handler returned a constant, that gap was invisible and harmless.
 * The moment it returns real marks it becomes a cross-tenant read: investor A,
 * who holds nothing in company X, could read X's fair-value history by putting
 * X's id in the URL. Fair-value marks are among the most commercially sensitive
 * numbers on the platform.
 *
 * So the wiring carries its own per-company predicate, `investorHoldsCompany`,
 * and the refusal is a **404, not a 403** (rule 7): a 403 would confirm that the
 * company id exists and has marks, turning the status code into an enumeration
 * oracle over other investors' portfolios. An unheld company and a nonexistent
 * company must be indistinguishable, and the harness asserts the two responses
 * are byte-identical rather than merely both being 404s.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MONEY (rule 5). `fair_value_minor` is INTEGER minor units and `currency` is
 * NOT NULL beside it, so no conversion happens here at all — the minor integer
 * and its currency travel together to the renderer, which uses `formatMinor`.
 * There is no `/ 100` in this file and no `Math.round` of anything.
 *
 * NEVER SUM ACROSS CURRENCIES — and here that generalises to *never plot across
 * them*. A line chart is an implicit comparison of its points, so a series whose
 * points are 900000 JPY and 900000 USD is a lie told by a y-axis rather than by
 * an addition. When a company's live marks span more than one currency this
 * module returns **no series and an explicit refusal reason**, which the UI
 * renders as text. A mixed-currency chart would look completely normal, which
 * is what makes it dangerous.
 *
 * NULLS, NOT ZEROS. "No marks recorded" and "marks exist but span currencies"
 * are DIFFERENT answers and are returned as different `unavailableReason`
 * values, never as an empty array that both cases would share. A caller must be
 * able to tell "nothing to show" from "we refuse to show this".
 */
import { rawDb } from "../db/connection";
import { listCommitsForUser } from "../captableCommitStore";
import { overrideIsEffective, getMarkThresholds, badgeForAge, type MarkBadge } from "../wave9ReportingStore";

/* ==========================================================================
 * Types
 * ======================================================================== */

/** Why a series is absent. `null` means a series IS present. */
export type MarkUnavailableReason =
  /** The company has no live valuation_event rows at all. */
  | "NO_MARKS_RECORDED"
  /**
   * The company's live marks are denominated in more than one currency, so no
   * single comparable series exists and none is invented. Rule 5.
   */
  | "MARKS_SPAN_CURRENCIES"
  /** The reporting schema is not present in this database. */
  | "MARKS_UNAVAILABLE";

export interface MarkPoint {
  /** valuation_event.id — stable, so the UI can key rows without an index. */
  id: string;
  /** ISO date, YYYY-MM-DD. */
  valuationDate: string;
  /** INTEGER minor units. Never divided, never rounded, never summed. */
  fairValueMinor: number;
  /** ISO-4217 code. Always travels with the amount. */
  currency: string;
  method: string;
  source: string;
  isExternal: boolean;
  /**
   * Set when an EFFECTIVE GP override supersedes this event's own fair value.
   * `fairValueMinor` above is then the override's figure, not the event's, and
   * `originalFairValueMinor` carries what the event itself said.
   */
  overrideId: string | null;
  overrideReason: string | null;
  originalFairValueMinor: number | null;
  /**
   * WAVE 36 · ROW 10 — how old this mark is, in whole days, as of the read.
   *
   * The chart plotted every point with identical visual authority: a mark from
   * four years ago and one from last week were the same colour, the same line,
   * the same tooltip. Age is a fact the reader needs in order to know how much
   * weight to give a number, and it was being withheld.
   */
  ageDays: number;
  /**
   * The staleness verdict for `ageDays`, from `badgeForAge()` — THE canonical
   * decider, reading DB-driven thresholds (`marks.stale_warn_days`,
   * `marks.stale_expired_days`) via `getMarkThresholds()`.
   *
   * Deliberately computed HERE and not in the browser. Hardcoding "180" and
   * "365" in a component would (a) duplicate a rule that already exists, and
   * (b) hardcode a threshold the owner configures in the database — the copy
   * would go silently wrong the day the config changed.
   */
  badge: MarkBadge;
}

export interface MarkHistory {
  companyId: string;
  holdingId: string | null;
  /**
   * The single currency the whole series is denominated in, or `null` when
   * there is no series. NEVER a default: a null currency with a number would
   * be a rendered lie, so both are absent together.
   */
  currency: string | null;
  marks: MarkPoint[];
  unavailableReason: MarkUnavailableReason | null;
  /**
   * WAVE 36 · ROW 10 — the thresholds the badges above were decided by, sent
   * so the UI can SAY what "stale" means rather than asserting it. Null when
   * there is no series to badge.
   */
  markThresholds: { staleWarnDays: number; staleExpiredDays: number } | null;
}

/* ==========================================================================
 * Authorization — exported so BOTH POLES are assertable
 *
 * Wave 30's mutant M14 survived because a correct predicate lived inside a
 * catch block where no input could reach its wrong branch: unreachable, and
 * therefore unfalsifiable. The lesson was to lift the predicate out. This one
 * is exported from the start, so a test can assert that a holder gets `true`
 * AND that a non-holder gets `false` — a predicate that answered `true` for
 * everyone and one that answered `false` for everyone are BOTH wrong, and a
 * single-pole test cannot tell either of them from a correct one.
 * ======================================================================== */

/**
 * The ledger lookup, as a seam.
 *
 * WHY THIS PARAMETER EXISTS — it is not gratuitous indirection.
 *
 * The first version of `investorHoldsCompany` wrapped the ledger read in a
 * `try/catch` that failed closed. Mutation testing then flipped that `catch`
 * to `return true` — a fail-OPEN authorization gate, about the worst defect
 * this file could carry — and the mutant SURVIVED. Not because the harness was
 * lazy: because `listCommitsForUser` catches internally and returns `[]` on
 * error, so no input reachable from a test could make it throw. The catch was
 * UNREACHABLE, and therefore UNFALSIFIABLE.
 *
 * That is exactly Wave 30's mutant M14, and it has the same remedy: make the
 * branch reachable rather than deleting the test or waving the mutant through
 * as "equivalent". Injecting the lookup lets a harness supply one that throws
 * and assert the gate answers `false`. Production passes the real store and is
 * byte-for-byte the same code path.
 */
export type HoldingLookup = (userId: string, companyId: string) => { length: number };

/**
 * Does this investor actually hold a position in this company?
 *
 * Reads the canonical unified ledger (`captable_commits`, Q1/ADR-7) through the
 * store's own public API rather than issuing SQL here, so the definition of a
 * live holding — `state='committed'`, `deleted_at IS NULL` — stays in one
 * place. A second copy of that predicate is a second place for it to be wrong.
 *
 * Fails CLOSED. Any error reading the ledger yields `false`, because the safe
 * answer to "may this caller see another company's fair value" when we cannot
 * tell is no.
 */
export function investorHoldsCompany(
  userId: string,
  companyId: string,
  lookup: HoldingLookup = listCommitsForUser,
): boolean {
  if (!userId || !companyId) return false;
  try {
    return lookup(userId, companyId).length > 0;
  } catch {
    return false;
  }
}

/* ==========================================================================
 * Read model
 * ======================================================================== */

function tableExists(db: any, name: string): boolean {
  try {
    const r = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name);
    return !!r;
  } catch {
    return false;
  }
}

/**
 * The live mark history for a company, oldest first.
 *
 * `superseded_at IS NULL` is the live-row grain: a superseded valuation is
 * history-of-the-history, not a point on the chart, and including it would make
 * a revised mark appear twice at the same date.
 *
 * An EFFECTIVE override replaces the point's value in place rather than adding
 * a point, because an override is a restatement of that same valuation, not a
 * new valuation on a new date. Effectiveness is decided by
 * `overrideIsEffective()` and nowhere else — Wave 23 · ITEM 5 found a call site
 * that re-implemented the test as `state !== 'rejected'` and thereby walked
 * straight past the approval gate, so this module asks the single decider.
 */
export function markHistoryForCompany(
  companyId: string,
  opts: { holdingId?: string | null } = {},
): MarkHistory {
  const holdingId = opts.holdingId ?? null;
  const empty = (reason: MarkUnavailableReason): MarkHistory => ({
    companyId,
    holdingId,
    currency: null,
    marks: [],
    unavailableReason: reason,
    markThresholds: null,
  });

  let db: any;
  try {
    db = rawDb();
  } catch {
    return empty("MARKS_UNAVAILABLE");
  }
  if (!tableExists(db, "valuation_event")) return empty("MARKS_UNAVAILABLE");

  let rows: any[] = [];
  try {
    rows = db
      .prepare(
        `SELECT id, valuation_date, fair_value_minor, currency, method, source,
                is_external
           FROM valuation_event
          WHERE vehicle_kind = 'company'
            AND vehicle_id = ?
            AND superseded_at IS NULL
            AND (? IS NULL OR holding_id = ?)
          ORDER BY valuation_date ASC, created_at ASC`,
      )
      .all(companyId, holdingId, holdingId) as any[];
  } catch {
    return empty("MARKS_UNAVAILABLE");
  }

  if (rows.length === 0) return empty("NO_MARKS_RECORDED");

  // Rule 5 — never sum across currencies, and never plot across them either.
  // Checked BEFORE any override is applied: an override carries its own
  // currency column and could itself introduce a second denomination.
  const overridesByEvent = loadEffectiveOverrides(db, companyId);

  const currencies = new Set<string>();
  for (const r of rows) {
    const ov = overridesByEvent.get(String(r.id));
    currencies.add(String(ov ? ov.currency : r.currency).toUpperCase());
  }
  if (currencies.size > 1) return empty("MARKS_SPAN_CURRENCIES");

  // `Array.from`, not `[...set]`: this project's tsconfig targets a level
  // without `downlevelIteration`, so spreading a Set is a TS2802 error rather
  // than a style choice.
  const currency = Array.from(currencies)[0];

  /* WAVE 36 · ROW 10 — read the DB-driven thresholds ONCE for the whole series
     so every point in one response is badged against the same rule. Reading
     them per point would let a config change mid-loop badge two marks of the
     same age differently. A config read that throws must not take the series
     down with it: the marks are still true, so the badges degrade to null
     thresholds and "unmarked" rather than the chart refusing to draw. */
  let thresholds: { staleWarnDays: number; staleExpiredDays: number } | null = null;
  try {
    const t = getMarkThresholds();
    thresholds = { staleWarnDays: t.staleWarnDays, staleExpiredDays: t.staleExpiredDays };
  } catch {
    thresholds = null;
  }
  const todayEpochDay = Math.floor(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) / 86_400_000);

  const marks: MarkPoint[] = rows.map((r) => {
    const ov = overridesByEvent.get(String(r.id));
    const valuationDate = String(r.valuation_date).slice(0, 10);
    const ageDays = Math.max(
      0,
      todayEpochDay - Math.floor(Date.parse(`${valuationDate}T00:00:00Z`) / 86_400_000),
    );
    return {
      id: String(r.id),
      valuationDate: String(r.valuation_date).slice(0, 10),
      fairValueMinor: Number(ov ? ov.fair_value_minor : r.fair_value_minor),
      currency,
      method: ov ? "gp_override" : String(r.method),
      source: ov ? "gp_override" : String(r.source),
      isExternal: !!r.is_external,
      overrideId: ov ? String(ov.id) : null,
      overrideReason: ov ? String(ov.reason) : null,
      originalFairValueMinor: ov ? Number(r.fair_value_minor) : null,
      ageDays,
      /* An override is a RESTATEMENT of this valuation, not a fresh one, so it
         does not reset the clock: the point keeps its staleness verdict and
         the override is signalled separately by `overrideId`. Badging an
         override "fresh" would let a GP make a four-year-old mark look current
         by restating it. */
      badge: thresholds ? badgeForAge(ageDays, { ...thresholds, autoDerive: false }) : ("unmarked" as MarkBadge),
    };
  });

  return { companyId, holdingId, currency, marks, unavailableReason: null, markThresholds: thresholds };
}

/**
 * The newest EFFECTIVE override per valuation event, keyed by event id.
 *
 * Effectiveness is NOT decided by SQL here. The rows are filtered in SQL only
 * for the company; every row is then passed to `overrideIsEffective()`, which
 * consults the DB-driven `marks.override_admin_approval_mode` config and the
 * 0174 grandfathering column. Encoding "approved or grandfathered" as a WHERE
 * clause would hardcode today's mode and silently ignore the config switch —
 * the exact defect Wave 23 · ITEM 5 fixed elsewhere.
 */
function loadEffectiveOverrides(db: any, companyId: string): Map<string, any> {
  const out = new Map<string, any>();
  if (!tableExists(db, "valuation_mark_override")) return out;
  let rows: any[] = [];
  try {
    rows = db
      .prepare(
        `SELECT * FROM valuation_mark_override
          WHERE vehicle_kind = 'company' AND vehicle_id = ?
          ORDER BY overridden_at ASC`,
      )
      .all(companyId) as any[];
  } catch {
    return out;
  }
  for (const r of rows) {
    const effective = overrideIsEffective({
      approvalState: r.approval_state,
      grandfatheredEffective: !!(r.grandfathered_effective ?? 0),
    });
    // Later rows overwrite earlier ones (ORDER BY overridden_at ASC), so the
    // map ends up holding the NEWEST effective override per event. An
    // ineffective one must not merely be skipped — it must REMOVE an earlier
    // effective override for the same event, because a subsequent rejected
    // restatement means the GP has withdrawn the figure.
    if (effective) out.set(String(r.valuation_event_id), r);
    else out.delete(String(r.valuation_event_id));
  }
  return out;
}
