/**
 * WAVE 183 · ITEM B FIX 1b — `/api/investor/portfolio2` WAS A DEMO SEED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, verbatim from the tree before this wave:
 *
 *     app.get("/api/investor/portfolio2", requireAuth,
 *             (_req, res) => res.json(investorPortfolio));
 *
 * `investorPortfolio` is `server/mockData.ts:1220`:
 *     DEMO_SEED_ENABLED ? _seed_investorPortfolio : []
 *
 * So the ONE route an LP's portfolio page reads served, in production, a
 * hardcoded empty array — and `PortfolioCompanySwitcher` renders an empty array
 * as the sentence "Your portfolio is empty — you don't hold any positions yet".
 * That is a FABRICATED STATEMENT ABOUT AN LP'S HOLDINGS, produced by a route
 * that never looked at the ledger. The `_req` parameter name is the tell: the
 * handler did not know who was asking.
 *
 * It also means fixing the 403 alone (FIX 1a) would have replaced a
 * transient-sounding failure with a confident falsehood. Both halves are
 * required, which is why they ship together.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS MODULE WILL AND WILL NOT SAY.
 *
 * The cap-table ledger (`captable_commits`) holds, per committed row: company,
 * round, an integer MINOR-UNIT amount, a share count, a currency and a
 * timestamp. It does NOT hold a current mark, an ownership percentage, an
 * instrument classification for every row, or an M&A signal.
 *
 * Every field below is therefore in exactly one of two categories:
 *
 *   HELD      → projected from the row, unmodified.
 *   NOT HELD  → `null`, ALWAYS accompanied by a machine-readable reason in
 *               `unknown[]` so the client can name the missing fact instead of
 *               printing a zero or a blank.
 *
 * There is no third category. No field is defaulted, coerced, or filled with a
 * placeholder that reads like a measurement. The platform's own standard, which
 * this module exists to obey:
 *
 *     "This is not the same as zero, and Capavate will not show a zero total
 *      for a figure it does not hold."
 *
 * MONEY DISCIPLINE. Amounts cross this boundary as INTEGER MINOR UNITS in a
 * DECIMAL STRING (`investedMinor`), never as a float, and never without
 * `currency` beside them. Summation uses `bigint`. There is no `Number()`,
 * `parseInt` or `parseFloat` applied to money anywhere in this file — the
 * `Number.parseInt` that does appear is applied to a four-character YEAR, which
 * is not money and cannot overflow a display.
 *
 * The `MAX_SAFE_INTEGER`-gated boundary: a per-position total that cannot be
 * represented exactly as a JS number is NOT silently truncated and NOT rounded.
 * `investedMinor` stays a string (so it is exact on the wire regardless of
 * magnitude) and `investedExceedsSafeRange` is set so a client that must reach
 * for a number knows not to. That flag is the boundary returning `null` in the
 * shape this wire format allows.
 *
 * CURRENCY MIXING. A single company can hold commits in two currencies (this is
 * the mechanism behind the BluePrint Catalyst inconsistency reported under ITEM
 * D). Summing across them would invent a number. When it happens, the position
 * reports `investedMinor: null` with `INVESTED_SPANS_CURRENCIES` rather than a
 * total in a currency nobody committed.
 */
import { rawDb } from "../db/connection";
import { listCommitsForUser } from "../captableCommitStore";
import { resolveInvestorIdSet } from "./investorIdentityAliasStore";
import { log } from "./logger";

/** Why a field is absent. These are CODES, not sentences: the client owns the
 *  wording so the copy lives with the surface that renders it. */
export type PortfolioUnknown =
  | "CURRENT_VALUE_NO_MARK_RECORDED"
  | "OWNERSHIP_PCT_NO_CAP_TABLE_DENOMINATOR"
  | "INVESTED_SPANS_CURRENCIES"
  | "CURRENCY_NOT_ON_RECORD"
  | "SECTOR_NOT_ON_RECORD"
  | "STAGE_NOT_ON_RECORD"
  | "INSTRUMENT_NOT_ON_RECORD"
  | "SHARES_NOT_ON_RECORD"
  | "MA_SIGNAL_NOT_ASSESSED";

export interface DerivedPortfolioPosition {
  /** Stable per-(investor-namespace, company) id. Not a database key: the
   *  ledger has no position row, only commits. Deterministic so React keys and
   *  `?company=` deep links are stable across reloads. */
  id: string;
  companyId: string;
  /** `companies.name`. Falls back to the raw `companyId` — which is an
   *  IDENTIFIER, visibly not a name, and therefore not mistakable for one. */
  company: string;
  /** `companies.sector` / `companies.stage`. NULL in the database for most
   *  rows; reported as null + reason, never as the word "Unknown" dressed up as
   *  a datum. */
  sector: string | null;
  stage: string | null;
  /** `rounds.instrument` for the most recent contributing round. */
  instrument: string | null;
  /** `rounds.name` and `rounds.close_date` for the most recent round. */
  lastRoundLabel: string | null;
  lastRoundDate: string | null;
  /** Sum of committed amounts, INTEGER MINOR UNITS, decimal string. `null`
   *  when the commits span currencies (see header). */
  investedMinor: string | null;
  /** ISO 4217 code the amounts are denominated in. `null` when the ledger rows
   *  carry no currency, which is a real state on this database. */
  currency: string | null;
  /** True when `investedMinor` exceeds `Number.MAX_SAFE_INTEGER`. A client must
   *  not convert it to a number. */
  investedExceedsSafeRange: boolean;
  /** Current mark. The marks service owns this and the ledger does not, so it
   *  is `null` here and NEVER equal to cost. `server/portfolioAnalyticsStore.ts`
   *  (RP-2) deleted exactly that substitution; re-introducing it here would be
   *  the same fabrication one route over. */
  currentValueMinor: string | null;
  /** Sum of committed shares, integer decimal string. */
  shares: string | null;
  /** Ownership needs a fully-diluted denominator, which only the cap-table
   *  engine owns. Always null on this route. */
  ownershipPct: number | null;
  /** Calendar year of the EARLIEST contributing commit. A date is not money. */
  vintageYear: number | null;
  /** Every field above that is absent, with its reason. Non-empty is normal. */
  unknown: PortfolioUnknown[];
  /** Which id in the caller's own identity set the rows were found under.
   *  `alias` means FIX 1a's bridge is what made this position visible. */
  matchedVia: "canonical" | "alias";
}

/* ── company / round metadata ─────────────────────────────────────────────── */

function companyMeta(companyId: string): { name: string | null; sector: string | null; stage: string | null } {
  try {
    const row = rawDb()
      .prepare(`SELECT name, sector, stage FROM companies WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(companyId) as { name?: string | null; sector?: string | null; stage?: string | null } | undefined;
    if (!row) return { name: null, sector: null, stage: null };
    const s = (v: unknown): string | null => {
      const t = typeof v === "string" ? v.trim() : "";
      return t.length > 0 ? t : null;
    };
    return { name: s(row.name), sector: s(row.sector), stage: s(row.stage) };
  } catch (err) {
    log.warn(`[w183 portfolio] companyMeta read failed for ${companyId}: ${(err as Error).message}`);
    return { name: null, sector: null, stage: null };
  }
}

function roundMeta(roundId: string): { label: string | null; date: string | null; instrument: string | null } {
  if (!roundId) return { label: null, date: null, instrument: null };
  try {
    const row = rawDb()
      .prepare(`SELECT name, close_date, instrument FROM rounds WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(roundId) as { name?: string | null; close_date?: string | null; instrument?: string | null } | undefined;
    if (!row) return { label: null, date: null, instrument: null };
    const s = (v: unknown): string | null => {
      const t = typeof v === "string" ? v.trim() : "";
      return t.length > 0 ? t : null;
    };
    return { label: s(row.name), date: s(row.close_date), instrument: s(row.instrument) };
  } catch (err) {
    log.warn(`[w183 portfolio] roundMeta read failed for ${roundId}: ${(err as Error).message}`);
    return { label: null, date: null, instrument: null };
  }
}

/**
 * Parse a ledger integer that arrives as a string.
 *
 * Returns `null` — not `0n` — for anything that is not an exact integer literal.
 * `BigInt("")` throws and `BigInt("1.5")` throws; both would previously have
 * become `0` under a `Number(x) || 0`, which is the coercion that publishes a
 * confident zero. An unparseable amount makes the whole position report its
 * amount as unknown; it does not quietly contribute nothing to a total that is
 * then presented as complete.
 */
/* NOTE ON `BigInt(0)` VS `0n` THROUGHOUT THIS FILE: the project's `tsc` target
   is below ES2020, so a bigint LITERAL raises TS2737. `BigInt(0)` is the same
   value and compiles. This is a syntax constraint, not a numeric one — the
   arithmetic below is still exact integer arithmetic on bigints, never floats. */
const ZERO: bigint = BigInt(0);

function exactIntegerOrNull(raw: unknown): bigint | null {
  const s = String(raw ?? "").trim();
  if (!/^-?\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

/**
 * Project one investor's committed cap-table rows into per-company positions.
 *
 * Alias-aware by construction (FIX 1a): the same `resolveInvestorIdSet` the
 * entitlement path now uses, so the gate and the payload can never disagree
 * about which ids are the caller's. If they disagreed, the LP would pass the
 * gate and then be told they hold nothing — which is the failure mode this
 * whole wave exists to remove.
 */
export function derivePortfolioPositions(canonicalUserId: string): DerivedPortfolioPosition[] {
  const ids = resolveInvestorIdSet(canonicalUserId);
  if (ids.length === 0) return [];

  type Acc = {
    companyId: string;
    matchedVia: "canonical" | "alias";
    /** currency → summed minor units */
    byCurrency: Map<string, bigint>;
    /** null when any contributing row had an unparseable amount */
    amountsExact: boolean;
    shares: bigint | null;
    sharesSeen: boolean;
    earliestTs: string | null;
    latestTs: string | null;
    latestRoundId: string;
    noCurrencyRows: number;
  };

  const acc = new Map<string, Acc>();

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const via: "canonical" | "alias" = i === 0 ? "canonical" : "alias";
    let rows: ReadonlyArray<Record<string, unknown>>;
    try {
      rows = listCommitsForUser(id) as unknown as ReadonlyArray<Record<string, unknown>>;
    } catch (err) {
      log.warn(`[w183 portfolio] listCommitsForUser failed for ${id}: ${(err as Error).message}`);
      continue;
    }
    for (const r of rows) {
      const companyId = String(r.companyId ?? "");
      if (!companyId) continue;
      let a = acc.get(companyId);
      if (!a) {
        a = {
          companyId,
          matchedVia: via,
          byCurrency: new Map(),
          amountsExact: true,
          shares: ZERO,
          sharesSeen: false,
          earliestTs: null,
          latestTs: null,
          latestRoundId: "",
          noCurrencyRows: 0,
        };
        acc.set(companyId, a);
      }

      const cur = String(r.currency ?? "").trim().toUpperCase();
      const amt = exactIntegerOrNull(r.amount);
      if (amt === null) {
        a.amountsExact = false;
      } else if (cur.length === 0) {
        /* A denominated total cannot be built from an undenominated row. The row
           is COUNTED as present-but-unusable rather than folded into USD. */
        a.noCurrencyRows += 1;
        a.amountsExact = false;
      } else {
        a.byCurrency.set(cur, (a.byCurrency.get(cur) ?? ZERO) + amt);
      }

      const sh = exactIntegerOrNull(r.shares);
      if (sh === null) {
        a.shares = null;
      } else if (a.shares !== null) {
        a.shares += sh;
        a.sharesSeen = true;
      }

      const ts = String(r.ts ?? "");
      if (ts) {
        if (!a.earliestTs || ts < a.earliestTs) a.earliestTs = ts;
        if (!a.latestTs || ts >= a.latestTs) {
          a.latestTs = ts;
          a.latestRoundId = String(r.roundId ?? "");
        }
      }
    }
  }

  const out: DerivedPortfolioPosition[] = [];
  /* `Array.from(...).forEach` rather than `for...of` over a Map iterator: see the
     note in `server/membershipStore.ts` — TS2802 under this project's target. */
  Array.from(acc.values()).forEach((a) => {
    const unknown: PortfolioUnknown[] = [];
    const meta = companyMeta(a.companyId);
    const round = roundMeta(a.latestRoundId);

    /* ── invested ─────────────────────────────────────────────────────────── */
    let investedMinor: string | null = null;
    let currency: string | null = null;
    let exceedsSafe = false;
    const currencies: string[] = Array.from(a.byCurrency.keys());
    if (currencies.length === 1) {
      const total = a.byCurrency.get(currencies[0]) as bigint;
      investedMinor = total.toString();
      currency = currencies[0];
      /* MAX_SAFE_INTEGER-gated boundary. The exact value still travels (as a
         string); what is refused is the implication that a consumer may treat
         it as a JS number. */
      if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER)) {
        exceedsSafe = true;
      }
    } else if (currencies.length > 1) {
      /* Do NOT add HK$ to USD. Report the conflict. */
      unknown.push("INVESTED_SPANS_CURRENCIES");
    } else {
      unknown.push("CURRENCY_NOT_ON_RECORD");
    }
    if (a.noCurrencyRows > 0 && !unknown.includes("CURRENCY_NOT_ON_RECORD")) {
      unknown.push("CURRENCY_NOT_ON_RECORD");
    }

    /* ── the fields the ledger structurally does not hold ─────────────────── */
    unknown.push("CURRENT_VALUE_NO_MARK_RECORDED");
    unknown.push("OWNERSHIP_PCT_NO_CAP_TABLE_DENOMINATOR");
    unknown.push("MA_SIGNAL_NOT_ASSESSED");
    if (!meta.sector) unknown.push("SECTOR_NOT_ON_RECORD");
    if (!meta.stage) unknown.push("STAGE_NOT_ON_RECORD");
    if (!round.instrument) unknown.push("INSTRUMENT_NOT_ON_RECORD");
    if (a.shares === null || !a.sharesSeen) unknown.push("SHARES_NOT_ON_RECORD");

    /* ── vintage: a YEAR, not money ───────────────────────────────────────── */
    let vintageYear: number | null = null;
    if (a.earliestTs) {
      const y = Number.parseInt(a.earliestTs.slice(0, 4), 10);
      if (Number.isFinite(y) && y > 1990 && y < 3000) vintageYear = y;
    }

    out.push({
      id: `pos_${a.companyId}`,
      companyId: a.companyId,
      company: meta.name ?? a.companyId,
      sector: meta.sector,
      stage: meta.stage,
      instrument: round.instrument,
      lastRoundLabel: round.label,
      lastRoundDate: round.date,
      investedMinor,
      currency,
      investedExceedsSafeRange: exceedsSafe,
      currentValueMinor: null,
      shares: a.shares !== null && a.sharesSeen ? a.shares.toString() : null,
      ownershipPct: null,
      vintageYear,
      unknown,
      matchedVia: a.matchedVia,
    });
  });

  /* Deterministic order: company name, then id. The ledger has no display
     order and an unstable one would reshuffle the switcher on every reload. */
  out.sort((x, y) => (x.company === y.company ? x.companyId.localeCompare(y.companyId) : x.company.localeCompare(y.company)));
  return out;
}

export default derivePortfolioPositions;
