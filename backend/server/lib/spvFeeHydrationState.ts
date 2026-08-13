/**
 * server/lib/spvFeeHydrationState.ts — WAVE 5 / S-3.
 *
 * A FAILED FEE HYDRATION MUST NOT LOOK LIKE "ALL FEES SETTLED".
 *
 * THE DEFECT, precisely.
 *   `hydrateSpvEngineStore` (server/spvEngineStore.ts:2928) loads every SPV
 *   table inside ONE try/catch whose handler is
 *       log.warn("[spvEngineStore] hydrate failed (non-fatal):", ...)
 *   and then continues. If the `spv_fee` SELECT throws — a locked database, a
 *   corrupt row, a schema change mid-deploy, a driver hiccup — `feesBySpv` is
 *   left EMPTY. `effectiveFee(spvId, layer)` then returns null for every layer.
 *
 *   Follow that into `hasUnsettledFixedFees` (:788). Its second half loops the
 *   two layers and, for each, does `const fee = this.effectiveFee(...); if
 *   (!fee ...) continue;`. With an empty fee table every layer is skipped and
 *   the function returns FALSE — "nothing unsettled".
 *
 *   That value is the fail-closed gate at the cap-table commit route
 *   (server/spvEngineRoutes.ts, `FEES_UNPAID`) and at subscription commit and
 *   deployment advance. So a transient read failure at BOOT silently OPENS a
 *   money gate that exists specifically to keep unpaid SPVs off the cap table.
 *   The system degrades in the wrong direction: not to "fees unknown, stop",
 *   but to "fees settled, proceed".
 *
 * THE FIX.
 *   Record the hydration VERDICT durably (`spv_fee_hydration_state`, one row,
 *   migration 0153) and make `hasUnsettledFixedFees` consult it. The row is
 *   seeded 'never_run', so a database that has never completed a fee hydration
 *   fails CLOSED rather than open.
 *
 *   Durable, not a module-level boolean, on purpose: the gate is checked by
 *   request handlers that may be served by a DIFFERENT process from the one
 *   that hydrated (and the standing rule is no in-memory state anywhere). A
 *   process-local flag would report "ok" in a worker that never hydrated.
 */
import { rawDb, getDb, getDbDriver } from "../db/connection";
import { log } from "./logger";
import { ensureWave5MoneySchema } from "./applyWave5MoneySchema";

export type FeeHydrationState = "never_run" | "ok" | "failed";

export interface FeeHydrationVerdict {
  state: FeeHydrationState;
  rowsLoaded: number;
  errorMessage: string | null;
  checkedAt: string;
}

function handle(): any | null {
  try {
    if (getDbDriver() === "postgres") return null;
    getDb();
    const h = rawDb() as any;
    ensureWave5MoneySchema(h);
    return h;
  } catch {
    return null;
  }
}

/** Record the outcome of loading `spv_fee`. Never throws. */
export function recordFeeHydration(state: FeeHydrationState, rowsLoaded: number, errorMessage?: string | null): void {
  const h = handle();
  if (!h) return;
  try {
    h.prepare(
      `INSERT INTO spv_fee_hydration_state (id, state, rows_loaded, error_message, checked_at)
       VALUES ('singleton', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state,
         rows_loaded = excluded.rows_loaded,
         error_message = excluded.error_message,
         checked_at = excluded.checked_at`,
    ).run(state, Math.max(0, Math.trunc(rowsLoaded)), errorMessage ?? null, new Date().toISOString());
  } catch (err) {
    log.warn("[spvFeeHydrationState] could not record verdict:", (err as Error).message);
  }
}

export function readFeeHydration(): FeeHydrationVerdict {
  const h = handle();
  if (!h) {
    // Cannot read the verdict => must not claim it is ok.
    return { state: "never_run", rowsLoaded: 0, errorMessage: "verdict_unreadable", checkedAt: new Date().toISOString() };
  }
  try {
    const r = h.prepare(`SELECT * FROM spv_fee_hydration_state WHERE id = 'singleton'`).get();
    if (!r) return { state: "never_run", rowsLoaded: 0, errorMessage: null, checkedAt: new Date().toISOString() };
    return {
      state: r.state,
      rowsLoaded: Number(r.rows_loaded ?? 0),
      errorMessage: r.error_message ?? null,
      checkedAt: String(r.checked_at),
    };
  } catch (err) {
    return { state: "never_run", rowsLoaded: 0, errorMessage: (err as Error).message, checkedAt: new Date().toISOString() };
  }
}

/**
 * TRUE when the fee table is not known to be loaded, and every fee-dependent
 * gate must therefore stay SHUT.
 *
 * Returns TRUE for 'never_run' as well as 'failed'. A database that has never
 * completed a fee hydration knows nothing about fees, and "we know nothing" is
 * not "there is nothing to pay".
 */
export function feeStateUnknown(): boolean {
  return readFeeHydration().state !== "ok";
}

/**
 * A DIRECT, per-SPV probe of the `spv_fee` table.
 *
 * WHY THIS EXISTS. `feeStateUnknown()` alone is too blunt to be the whole gate.
 * A verdict of 'never_run' is genuinely ambiguous between two very different
 * situations:
 *   (a) hydration never ran in this deployment and the in-memory fee table is
 *       empty and WRONG — the dangerous case; and
 *   (b) this process populated `feesBySpv` directly through `addFee` (which
 *       writes the row AND the map in one transaction) and never needed a
 *       boot-time hydration at all — a perfectly consistent state.
 *
 * Returning "unknown, stay shut" for (b) would wedge the FEES_UNPAID gate shut
 * for correctly-configured SPVs, which violates the standing rule against
 * silently dropping working functionality — the opposite failure, but still a
 * failure.
 *
 * So the caller compares the DB's row count for the SPV against what it holds
 * in memory. Fewer rows in memory than on disk means the in-memory view is
 * INCOMPLETE and the gate must stay shut. A probe that THROWS means the fee
 * table cannot be read at all, which is the strongest possible reason to stay
 * shut.
 */
export function probeFeeRowCount(spvId: string): { ok: boolean; count: number } {
  const h = handle();
  if (!h) return { ok: false, count: 0 };
  try {
    const r = h.prepare(`SELECT COUNT(*) AS c FROM spv_fee WHERE spv_id = ?`).get(spvId);
    return { ok: true, count: Number(r?.c ?? 0) };
  } catch (err) {
    log.warn("[spvFeeHydrationState] spv_fee probe failed — fee gates fail closed:", (err as Error).message);
    return { ok: false, count: 0 };
  }
}
