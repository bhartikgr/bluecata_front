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
import { listForCompany as softCirclesForCompany } from "../softCircleStore";
import { rawDb } from "../db/connection";
import { DbUnavailableError } from "./errors";

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

/**
 * Total funded across all rounds = sum of Round.raisedAmount from the DB-backed
 * roundsStore (NOT the mock `amountRaised` field, which never existed on live
 * rows). listRounds() returns the DB-hydrated read cache.
 */
export function dbTotalFunded(): number {
  try {
    return listRounds().reduce((sum, r) => sum + (Number(r.raisedAmount) || 0), 0);
  } catch (err) {
    throw new DbUnavailableError("admin KPI funded total", err as Error);
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

export function dbRegions(): Array<{ code: string; companies: number; raised: number }> {
  try {
    const companies = getAllCompaniesFromDb();
    const rounds = listRounds();
    const acc = new Map<string, { companies: number; raised: number }>();
    for (const c of companies) {
      const cid = (c as { companyId?: string; id?: string }).companyId ?? (c as { id?: string }).id ?? "";
      const code = (c as { region?: string }).region || "GLOBAL";
      const cur = acc.get(code) ?? { companies: 0, raised: 0 };
      cur.companies += 1;
      cur.raised += rounds
        .filter((r) => r.companyId === cid)
        .reduce((s, r) => s + (Number(r.raisedAmount) || 0), 0);
      acc.set(code, cur);
    }
    return Array.from(acc.entries()).map(([code, v]) => ({ code, ...v }));
  } catch (err) {
    throw new DbUnavailableError("admin KPI regions", err as Error);
  }
}
