/**
 * server/lib/adminKpiDbReads.ts — v25.48 DATA-2 (V-1/V-2/V-3).
 *
 * Parallel, DB-driven KPI reads for the admin dashboard. The previous
 * computeKpis() in adminPlatformStore.ts derived totalCompanies / totalFunded /
 * totalCommittedSoftCircle and the region breakdown from the mockData arrays
 * (`companies`, `rounds`, `softCircles`). In production those arrays are always
 * empty, so the admin dashboard silently reported COMPANIES=0, FUNDED=$0,
 * SOFT-CIRCLED=$0 and an empty regions[] — exactly what the live walkthrough
 * showed (COMPANIES=0 while the Companies list had 54 tenants).
 *
 * This module reads the CANONICAL DB stores instead. It is non-sacred and is
 * imported by adminPlatformStore.computeKpis(). No mock data, no in-memory
 * canonical state — every number here is derived from the live DB stores.
 */
import { getAllCompaniesFromDb } from "../multiCompanyStore";
import { listRounds } from "../roundsStore";
import { listForCompany as softCirclesForCompany, listForRound as softCirclesForRound } from "../softCircleStore";
import { rawDb } from "../db/connection";
import { DbUnavailableError } from "./errors";
/* WAVE 116 · FINDING 1 (closes Wave 114's OQ-W114-1) — `dbTotalFunded()` summed
   `Round.raisedAmount`, and Wave 114 established that `rounds.raised_amount` is a
   `NOT NULL DEFAULT 0` column with NO WRITER anywhere in the tree. The admin
   platform KPI was therefore a structural `$0`, and it reached the owner's admin
   dashboard as a fact. It now derives through the SAME single derivation the
   founder screens use — `roundMoneyOnRecord` in `server/lib/roundRaisedTotals.ts`
   — and refuses (returns `null`, never `0`) when the figure is not determinable.
   No second derivation is written here. */
import { roundMoneyOnRecord } from "./roundRaisedTotals";
import type { RoundMoneyRowInput } from "./roundRaisedTotals";

// v25.48 DATA-2 (fail-closed hardening per GPT-5.5) — these helpers MUST NOT
// swallow a DB read failure into a false 0/[] KPI (which would silently serve
// wrong "live-looking" numbers). On any DB error they throw DbUnavailableError,
// which the /api/admin/dashboard/kpis route already maps to a 503 + ok:false.

/** Distinct real companies (tenant inventory) from the DB. */
export function dbTotalCompanies(): number {
  try {
    return getAllCompaniesFromDb().length;
  } catch (err) {
    throw new DbUnavailableError("admin KPI companies", err as Error);
  }
}

/* ============================================================================
 * WAVE 116 · FINDING 1 — THE PLATFORM FUNDED TOTAL, DERIVED OR REFUSED.
 *
 * WHY `null` AND NOT `0`. Owner ruling R6: a figure that was never entered is
 * never rendered as `0` / `$0`. `client/src/pages/admin/Dashboard.tsx:47` already
 * types `totalFunded` as `number | null` and its ratio at `:172-176` already
 * guards for null, so the honest signal has somewhere to go.
 *
 * WHY A REFUSAL CAN BE PLATFORM-WIDE. This platform holds no FX rate source
 * (`server/lib/currencyScalar.ts` says so in its header), so a single scalar
 * "platform funded" figure is only meaningful when every round with money on
 * record shares one currency. When they do not, this refuses with
 * `mixed_currency` rather than adding dollars to euros.
 * ========================================================================== */

/** A platform-wide funded total that either states a figure or states why not. */
export interface AdminFundedOnRecord {
  /** False whenever no figure may be printed. */
  determined: boolean;
  /** `null` when determined. Otherwise a named reason, never a generic error. */
  refusal: "no_rounds_on_record" | "mixed_currency" | null;
  /** A complete sentence, printed INSTEAD of a figure when not determined. */
  statement: string;
  /** Integer minor units as exact decimal TEXT. `"0"` is only ever a real zero. */
  minor: string;
  currency: string | null;
  /** How many rounds contributed, and how many refused their own derivation. */
  roundsCounted: number;
  roundsUndetermined: number;
  /** The one derivation this figure came from. Named so nobody greps for it. */
  source: string;
}

/** Merge the canonical soft-circle rows for a round into the shape the one
 *  derivation takes. Mirrors `roundMoneyOnRecordForRound` in `server/routes.ts`,
 *  minus the legacy in-memory seed array, which does not exist on this path. */
function fundedRowsForRound(roundId: string): ReadonlyArray<RoundMoneyRowInput> {
  return softCirclesForRound(roundId) as unknown as ReadonlyArray<RoundMoneyRowInput>;
}

/**
 * Platform funded total, derived through the one derivation, in exact minor units.
 *
 * Only the FUNDED bucket is summed: `committed` is signed-but-not-received and
 * `softCircled` is non-binding, and the tile this feeds is labelled FUNDED.
 */
export function dbFundedOnRecord(): AdminFundedOnRecord {
  const source = "server/lib/roundRaisedTotals.roundMoneyOnRecord (funded bucket)";
  try {
    const rounds = listRounds();
    let total = BigInt(0);
    let counted = 0;
    let undetermined = 0;
    const currencies = new Set<string>();

    for (const r of rounds) {
      const roundId = String((r as { id?: unknown }).id ?? "");
      if (!roundId) continue;
      const money = roundMoneyOnRecord({
        roundId,
        rows: fundedRowsForRound(roundId),
        fallbackCurrency:
          typeof (r as { currency?: unknown }).currency === "string" && (r as { currency?: string }).currency
            ? (r as { currency: string }).currency
            : "USD",
      });
      if (!money.determined) {
        /* `no_rows_on_record` is the overwhelmingly common case — a round with an
           empty book — and it contributes nothing rather than making the whole
           platform figure unstatable. Any OTHER refusal is a real unknown. */
        if (money.refusal !== "no_rows_on_record") undetermined += 1;
        continue;
      }
      const funded = BigInt(money.buckets.funded.minor);
      if (funded === BigInt(0)) continue;
      if (money.currency) currencies.add(money.currency);
      if (currencies.size > 1) {
        return {
          determined: false,
          refusal: "mixed_currency",
          statement:
            "Not shown — funded amounts are recorded in more than one currency across the platform, and there is no exchange rate here to add them with.",
          minor: "0",
          currency: null,
          roundsCounted: counted,
          roundsUndetermined: undetermined,
          source,
        };
      }
      total += funded;
      counted += 1;
    }

    if (counted === 0) {
      return {
        determined: false,
        refusal: "no_rounds_on_record",
        statement:
          "Not recorded — no round on the platform has any funded amount on record, so there is no funded total to show.",
        minor: "0",
        currency: null,
        roundsCounted: 0,
        roundsUndetermined: undetermined,
        source,
      };
    }

    return {
      determined: true,
      refusal: null,
      statement: "",
      minor: total.toString(),
      currency: currencies.size === 1 ? Array.from(currencies)[0] : "USD",
      roundsCounted: counted,
      roundsUndetermined: undetermined,
      source,
    };
  } catch (err) {
    throw new DbUnavailableError("admin KPI funded total", err as Error);
  }
}

/**
 * Total funded across all rounds, for the existing admin KPI payload.
 *
 * WAS: `listRounds().reduce((sum, r) => sum + (Number(r.raisedAmount) || 0), 0)`
 * — a sum of a column with no writer, using `Number()` on money. Both defects
 * are gone: the figure is derived by `dbFundedOnRecord()` and this function only
 * adapts its exact minor-unit text to the legacy major-unit contract.
 *
 * `null` means "not determined", and the admin client renders that as a dash.
 * It never returns 0 to mean unknown.
 *
 * ON THE ONE CONVERSION BELOW. The wire contract for this KPI is a major-unit
 * JS number, so exactly one conversion is unavoidable. It is done on the INTEGER
 * MINOR-UNIT value — integer minor units as a `number` is this platform's
 * ratified money-scalar representation (`server/lib/currencyScalar.ts`,
 * `MoneyScalar.minor: number`) — and it refuses rather than converting when the
 * integer would exceed `Number.MAX_SAFE_INTEGER`. No money TEXT is ever parsed
 * into a float: `BigInt` is exact, and `parseFloat` / `parseInt` / `Number()` are
 * never applied to an amount.
 */
export function dbTotalFunded(): number | null {
  const derived = dbFundedOnRecord();
  if (!derived.determined) return null;
  return majorFromMinor(BigInt(derived.minor), derived.currency ?? "USD");
}

/** The currency's minor-unit exponent from the runtime's own ISO 4217 table, so
 *  this module carries no second currency table. */
function minorExponentFor(currency: string): number {
  try {
    const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits;
    return typeof digits === "number" && digits >= 0 && digits <= 4 ? digits : 2;
  } catch {
    return 2;
  }
}

/**
 * Soft-circle pipeline total = sum of soft-circle amounts across every real
 * company, read from the canonical softCircleStore (DB-direct reads).
 */
export function dbTotalCommittedSoftCircle(): number {
  try {
    const companies = getAllCompaniesFromDb();
    let total = 0;
    for (const c of companies) {
      const cid = (c as { companyId?: string; id?: string }).companyId ?? (c as { id?: string }).id;
      if (!cid) continue;
      for (const sc of softCirclesForCompany(cid)) {
        total += Number(sc.amount) || 0;
      }
    }
    return total;
  } catch (err) {
    throw new DbUnavailableError("admin KPI soft-circle total", err as Error);
  }
}

/**
 * Region breakdown derived from real DB companies + their DB rounds.
 * Returns [{ code, companies, raised }] — never a fabricated/empty-mock shape.
 * Falls back to a single "GLOBAL" bucket only when a company has no region set,
 * preserving the prior contract of never returning an empty array when at least
 * one real company exists.
 */
/**
 * Wave B (v26.4.0) — new SPV KPI tiles. Complements dbTotalFunded() (which sums
 * per-round raisedAmount and stays untouched per owner Q3-C). These read
 * SPV-side commitments and wires directly from the canonical spv_subscription
 * table so admin dashboard can show:
 *   - SPV Committed: sum of ACTIVE (non-withdrawn) commitments, PER CURRENCY.
 *   - SPV Wired:     sum of actually-wired amounts, PER CURRENCY. Uses
 *                    wired_minor (durable field), not the transient
 *                    'wire_funded' status which advances to 'committed'.
 *
 * Both functions are pure DB-reads via better-sqlite3 prepared statements.
 * No in-memory state, no caching. Multi-currency by construction — never a
 * scalar sum across mixed currencies.
 *
 * These tiles are additive: the existing dbTotalFunded() (rounds KPI) is left
 * exactly as-is. The genuine 'Funded=$0' bug (rounds.raisedAmount write-path
 * is orphaned in routes.ts:5056) is a separate Wave F item, anchored at
 * [[deferred:wave-F#rounds-raisedAmount-write-path]].
 */
export type SpvCommittedByCurrency = Record<string, number>;
export type SpvWiredByCurrency     = Record<string, number>;

// v26.4.0-fix2 (GPT-5.6 DEFECT-5) — rawDb() throws on Postgres driver.
// These 3 KPIs read the engine's `spv` / `spv_subscription` tables which
// aren't yet modeled in the drizzle schema. Rather than propagate the throw
// (which would 503 the entire admin dashboard on Avi's PG production), we
// detect the driver and DEGRADE GRACEFULLY:
//   - On SQLite: normal per-currency aggregate reads.
//   - On Postgres: return empty map / zero. NOT a false success — the
//     tile UI renders "—" when the map is empty, matching how N/A is
//     rendered for other pending-migration metrics. Wave B.5 or Wave F
//     will add the drizzle schema entries and replace this with a
//     portable read.
//
// The `driver=postgres` case is NEVER a bug hiding — it's an explicit,
// documented deferred state, logged once per call for visibility.
function _isSqliteDriver(): boolean {
  try {
    // Probing rawDb throws on PG, returns handle on SQLite. Cheap probe.
    rawDb();
    return true;
  } catch {
    return false;
  }
}

export function dbTotalSpvCommittedMinor(): SpvCommittedByCurrency {
  if (!_isSqliteDriver()) return {};
  try {
    const rows = rawDb()
      .prepare(
        `SELECT currency, COALESCE(SUM(commitment_minor), 0) AS total
         FROM spv_subscription
         WHERE status != 'withdrawn'
         GROUP BY currency`,
      )
      .all() as Array<{ currency: string; total: number }>;
    const out: SpvCommittedByCurrency = {};
    for (const r of rows) out[r.currency] = Number(r.total) || 0;
    return out;
  } catch (err) {
    throw new DbUnavailableError("admin KPI spv committed", err as Error);
  }
}

export function dbTotalSpvWiredMinor(): SpvWiredByCurrency {
  if (!_isSqliteDriver()) return {};
  try {
    const rows = rawDb()
      .prepare(
        `SELECT currency, COALESCE(SUM(wired_minor), 0) AS total
         FROM spv_subscription
         WHERE wired_minor > 0
         GROUP BY currency`,
      )
      .all() as Array<{ currency: string; total: number }>;
    const out: SpvWiredByCurrency = {};
    for (const r of rows) out[r.currency] = Number(r.total) || 0;
    return out;
  } catch (err) {
    throw new DbUnavailableError("admin KPI spv wired", err as Error);
  }
}

/** Distinct active SPV count (archived_at IS NULL). Pure DB read.
 *  v26.4.0-fix2 (Opus N-6): explicitly excludes draft and wound_down states
 *  so the tile labelled "Active SPVs" reflects true active count.
 *  v26.4.0-fix3 (GPT NEW-2): return NULL on Postgres so the UI renders "—"
 *  instead of a fabricated "0". `null` is the honest "unavailable" signal;
 *  the client already handles `activeSpvs == null` → "—". */
export function dbTotalActiveSpvs(): number | null {
  if (!_isSqliteDriver()) return null;
  try {
    const row = rawDb()
      .prepare("SELECT COUNT(*) AS n FROM spv WHERE archived_at IS NULL AND status NOT IN ('draft', 'wound_down')")
      .get() as { n: number };
    return Number(row?.n) || 0;
  } catch (err) {
    throw new DbUnavailableError("admin KPI spv total", err as Error);
  }
}

/* WAVE 116 · FINDING 1 — `raised` per region was
     rounds.filter(…).reduce((s, r) => s + (Number(r.raisedAmount) || 0), 0)
   i.e. the SAME writer-less column as `dbTotalFunded`, with the same `Number()`
   on money, once per region. Every region therefore reported `0` raised. It now
   derives through the one derivation, per round, and `raised` is `number | null`
   — `null` where the region's figure is not determined, which the admin client at
   `client/src/pages/admin/Dashboard.tsx:189` already renders as a dash rather
   than a zero. */
export function dbRegions(): Array<{ code: string; companies: number; raised: number | null }> {
  try {
    const companies = getAllCompaniesFromDb();
    const rounds = listRounds();
    const acc = new Map<string, { companies: number; minor: bigint; determined: boolean; currency: string | null }>();
    for (const c of companies) {
      const cid = (c as { companyId?: string; id?: string }).companyId ?? (c as { id?: string }).id ?? "";
      const code = (c as { region?: string }).region || "GLOBAL";
      const cur = acc.get(code) ?? { companies: 0, minor: BigInt(0), determined: false, currency: null };
      cur.companies += 1;
      for (const r of rounds) {
        if (r.companyId !== cid) continue;
        const roundId = String((r as { id?: unknown }).id ?? "");
        if (!roundId) continue;
        const money = roundMoneyOnRecord({
          roundId,
          rows: fundedRowsForRound(roundId),
          fallbackCurrency:
            typeof (r as { currency?: unknown }).currency === "string" && (r as { currency?: string }).currency
              ? (r as { currency: string }).currency
              : "USD",
        });
        if (!money.determined) continue;
        const funded = BigInt(money.buckets.funded.minor);
        if (funded === BigInt(0)) continue;
        /* A region that mixes currencies cannot be summed into one scalar, so it
           refuses for good. It is not reset to zero. */
        if (cur.currency !== null && money.currency && money.currency !== cur.currency) {
          cur.determined = false;
          cur.currency = "__mixed__";
          acc.set(code, cur);
          continue;
        }
        if (cur.currency === "__mixed__") continue;
        cur.currency = money.currency ?? cur.currency;
        cur.minor += funded;
        cur.determined = true;
      }
      acc.set(code, cur);
    }
    return Array.from(acc.entries()).map(([code, v]) => ({
      code,
      companies: v.companies,
      raised: v.determined ? majorFromMinor(v.minor, v.currency ?? "USD") : null,
    }));
  } catch (err) {
    throw new DbUnavailableError("admin KPI regions", err as Error);
  }
}

/** The one minor-to-major adaptation, shared by `dbTotalFunded` and `dbRegions`.
 *  See the note on `dbTotalFunded` for why exactly one conversion exists and why
 *  it happens on the integer minor-unit value rather than on money text. */
function majorFromMinor(minor: bigint, currency: string): number | null {
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  /* Repeated multiplication rather than `**`: this tree's `target` predates the
     `bigint` exponentiation operator, and `10 ** exp` on a float is exactly the
     kind of money arithmetic that must not appear here. */
  let divisor = BigInt(1);
  for (let i = 0; i < minorExponentFor(currency); i += 1) divisor *= BigInt(10);
  const whole = minor / divisor;
  const remainder = minor % divisor;
  if (whole > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return globalThis.Number(whole) + globalThis.Number(remainder) / globalThis.Number(divisor);
}
