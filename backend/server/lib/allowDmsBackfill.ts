/**
 * W-FIX2 F2 — reversible data-migration: default existing cap-table investors'
 * `visibility.allowDms` to true.
 *
 * The investor profile is stored as a JSON blob in
 * `profilestore_investor_profile.profile_json` (written by the SACRED
 * profileStore), so this is a JSON data-migration, not a schema ALTER. It is:
 *   - ADDITIVE   — only sets `allowDms` when the key is ABSENT; never overwrites
 *                  an investor's explicit choice (true OR false).
 *   - REVERSIBLE — `revertAllowDmsBackfill()` removes exactly the keys this run
 *                  added (tracked by the returned id list), restoring the prior
 *                  (absent) shape.
 *   - LIVE-SAFE  — idempotent; a second up-run is a no-op. Behavioural default
 *                  is already ON (schema `.default(true)` + reader default), so
 *                  this only makes the stored data explicit for auditability.
 *
 * READ/WRITE is scoped to the profile blob only — the sacred cap-table ledger
 * (`captable_commits`) is READ-ONLY here (to find who is a cap-table investor).
 */
import { rawDb } from "../db/connection";
import { log } from "./logger";

export interface AllowDmsBackfillEntry {
  investorId: string;
  before: boolean | undefined;
  after: boolean;
}

export interface AllowDmsBackfillResult {
  changed: AllowDmsBackfillEntry[];
  skipped: number;
}

/** Investor ids that hold a committed position on any cap table. */
function capTableInvestorIds(db: any): string[] {
  try {
    const rows = db
      .prepare(`SELECT DISTINCT investor_id AS id FROM captable_commits`)
      .all() as Array<{ id?: string }>;
    return rows.map((r) => r.id).filter((x): x is string => !!x);
  } catch {
    return [];
  }
}

/** UP — set allowDms=true where absent for cap-table investors. */
export function backfillAllowDms(): AllowDmsBackfillResult {
  const changed: AllowDmsBackfillEntry[] = [];
  let skipped = 0;
  let db: any;
  try {
    db = rawDb();
  } catch {
    return { changed, skipped };
  }
  const ids = capTableInvestorIds(db);
  const now = new Date().toISOString();
  for (const investorId of ids) {
    try {
      const row = db
        .prepare(
          `SELECT profile_json FROM profilestore_investor_profile
            WHERE investor_id = ? AND deleted_at IS NULL LIMIT 1`,
        )
        .get(investorId) as { profile_json?: string } | undefined;
      if (!row?.profile_json) {
        skipped++;
        continue;
      }
      const profile = JSON.parse(row.profile_json);
      const vis = profile.visibility ?? (profile.visibility = {});
      if (typeof vis.allowDms === "boolean") {
        skipped++;
        continue; // respect an explicit prior choice
      }
      vis.allowDms = true;
      db.prepare(
        `UPDATE profilestore_investor_profile
            SET profile_json = ?, updated_at = ?
          WHERE investor_id = ?`,
      ).run(JSON.stringify(profile), now, investorId);
      changed.push({ investorId, before: undefined, after: true });
    } catch (err) {
      log.warn?.("[allowDmsBackfill] up failed for", investorId, (err as Error).message);
      skipped++;
    }
  }
  log.info?.(`[allowDmsBackfill] up: set allowDms=true on ${changed.length} profile(s), skipped ${skipped}`);
  return { changed, skipped };
}

/** DOWN — remove the allowDms key from exactly the ids the up-run added. */
export function revertAllowDmsBackfill(entries: AllowDmsBackfillEntry[]): number {
  let reverted = 0;
  let db: any;
  try {
    db = rawDb();
  } catch {
    return 0;
  }
  const now = new Date().toISOString();
  for (const e of entries) {
    try {
      const row = db
        .prepare(
          `SELECT profile_json FROM profilestore_investor_profile
            WHERE investor_id = ? AND deleted_at IS NULL LIMIT 1`,
        )
        .get(e.investorId) as { profile_json?: string } | undefined;
      if (!row?.profile_json) continue;
      const profile = JSON.parse(row.profile_json);
      if (profile.visibility && "allowDms" in profile.visibility) {
        delete profile.visibility.allowDms;
        db.prepare(
          `UPDATE profilestore_investor_profile
              SET profile_json = ?, updated_at = ?
            WHERE investor_id = ?`,
        ).run(JSON.stringify(profile), now, e.investorId);
        reverted++;
      }
    } catch (err) {
      log.warn?.("[allowDmsBackfill] down failed for", e.investorId, (err as Error).message);
    }
  }
  log.info?.(`[allowDmsBackfill] down: reverted ${reverted} profile(s)`);
  return reverted;
}
