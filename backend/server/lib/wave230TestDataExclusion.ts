/**
 * WAVE 230 — TEST-DATA EXCLUSION: THE AUDITED WRITER.
 *
 * R228, owner verbatim, 2026-08-31: "It is time to remove the test data. Go for it."
 *
 * ── WHY THIS IS A MARK AND NOT A DELETE ───────────────────────────────────────
 * R228.1 is binding. Deleting rows breaks the per-tenant hash chain, and because
 * the admin screen derives its green tick from `broken_at_row_id === null`
 * (R224.1), a deletion could leave a GENUINELY BROKEN CHAIN RENDERING GREEN —
 * the most-repeated failure mode of this programme, triggered deliberately.
 * R195.5 forbids deletion as a mechanism, and the owner's standing preference is
 * "I'd rather add than delete". Misclassification is unrecoverable if rows are
 * gone, and a one-click fix if they are merely marked.
 *
 * THERE IS NO `DELETE` STATEMENT IN THIS FILE OR IN THE FLAG LAYER BENEATH IT.
 *
 * ── WHY PER-RECORD AND NEVER PER-TENANT (R230.6) ──────────────────────────────
 * A round named "QA Note Round" sits inside BluePrint Catalyst Limited — the
 * operator's own real company (R229). A tenant-scoped design would either hide
 * the real operating entity or miss that round. So the flag lives on the ROW,
 * and each population is marked independently: marking a company does not mark
 * its rounds, and marking a round does not touch its company.
 *
 * ── THE SCHEMA AND THE READS ARE IN `wave230TestDataFlags.ts` ─────────────────
 * They are separated to keep `server/adminPlatformStore.ts` — which must read the
 * excluded set in order to compute ARR/MRR — out of an import cycle with the
 * audit path. See that file's header for the full reasoning. Everything is
 * re-exported here so callers have one import site.
 */

import { log } from "./logger";
import { appendAdminAudit } from "../adminPlatformStore";
import {
  isWave230Table,
  wave230ColumnsPresent,
  wave230EnsureColumns,
  wave230KeyColumn,
  WAVE230_AT_COLUMN,
  WAVE230_BY_COLUMN,
  WAVE230_REASON_COLUMN,
  type Wave230Table,
} from "./wave230TestDataFlags";
import { rawDb } from "../db/connection";

/* The read + schema API, re-exported so callers need only one import site. */
export {
  WAVE230_AT_COLUMN,
  WAVE230_REASON_COLUMN,
  WAVE230_BY_COLUMN,
  WAVE230_TABLES,
  isWave230Table,
  wave230KeyColumn,
  wave230LabelColumn,
  wave230ReadAlterStatements,
  wave230ColumnsPresent,
  wave230EnsureColumns,
  wave230EnsureAllColumns,
  wave230ExcludedIds,
  wave230IsExcluded,
  wave230ListExcluded,
  wave230Counts,
  wave230AllCounts,
} from "./wave230TestDataFlags";
export type {
  Wave230Table,
  Wave230EnsureOutcome,
  Wave230ExcludedRecord,
  Wave230TableCounts,
} from "./wave230TestDataFlags";

/** The audit event name for a marking change. */
export const WAVE230_AUDIT_EVENT = "wave230.test_data_exclusion.set";

export type Wave230WriteOutcome =
  | { ok: true; excluded: boolean; excludedAt: string | null; reason: string | null }
  | { ok: false; reason: string };

/**
 * Set or unset the exclusion mark on ONE record, and audit the change.
 *
 * `excluded === true`  -> the column is set to the SERVER'S clock, with a reason.
 * `excluded === false` -> the column is set back to NULL. The record returns to
 *                         every surface it was on before. This is what makes a
 *                         misclassification a one-click correction rather than a
 *                         catastrophe, and it is why R228.1 chose this mechanism
 *                         over deletion.
 *
 * The timestamp is SERVER-OBSERVED. A client-supplied instant is never trusted or
 * stored (R187.1). No row is created and NO ROW IS EVER DELETED.
 */
export function wave230SetExcluded(input: {
  table: Wave230Table;
  id: string;
  excluded: boolean;
  reason?: string | null;
  actorId: string;
  tenantId?: string;
}): Wave230WriteOutcome {
  const { table, id, excluded, actorId } = input;
  if (!id) return { ok: false, reason: "MISSING_RECORD_ID" };
  if (!isWave230Table(table)) return { ok: false, reason: `UNKNOWN_TABLE:${table}` };

  const ensured = wave230EnsureColumns(table);
  if (!ensured.ok) return { ok: false, reason: ensured.reason };

  const key = wave230KeyColumn(table);
  const excludedAt = excluded ? new Date().toISOString() : null;
  /* On unset the reason and the actor are cleared too, so a restored record
     carries no stale explanation of a decision that has been reversed. */
  const reason = excluded ? (input.reason ?? null) : null;
  const by = excluded ? actorId : null;

  try {
    const db: any = rawDb();
    const info = db
      .prepare(
        `UPDATE ${table}
            SET ${WAVE230_AT_COLUMN} = ?,
                ${WAVE230_REASON_COLUMN} = ?,
                ${WAVE230_BY_COLUMN} = ?
          WHERE ${key} = ?`,
      )
      .run(excludedAt, reason, by, id);
    /* better-sqlite3 reports how many rows the UPDATE actually touched. Zero
       means the row does not exist, and returning ok:true there would be a write
       that "appears to work then silently reverts" on the next read — the worst
       class of data defect. Compared against 0 directly: there is no Number(),
       parseInt or parseFloat anywhere in this file. */
    const changes = info?.changes;
    if (changes === undefined || changes === null || changes === 0) {
      return { ok: false, reason: `RECORD_NOT_FOUND:${table}:${id}` };
    }
  } catch (err) {
    return { ok: false, reason: `UPDATE_FAILED:${(err as Error).message}` };
  }

  /* Read back through the REAL reader before reporting success.
     "I ran the UPDATE" is not the same claim as "the flag is set", and only the
     second one is worth anything. This is also the check that would catch the
     inert-proof mechanism the brief warns about for this wave specifically — a
     filter keyed to a field the writer never writes. If the writer and the
     reader ever disagreed about the column, this would fail here rather than
     ship a mechanism that silently excludes nothing. */
  const observed = wave230ColumnsPresent(table);
  if (!observed) {
    return { ok: false, reason: `COLUMNS_ABSENT_AFTER_WRITE:${table}` };
  }

  try {
    appendAdminAudit(
      actorId,
      `${table}:${id}`,
      WAVE230_AUDIT_EVENT,
      { table, recordId: id, excluded, excludedAt, reason },
      input.tenantId,
    );
  } catch (err) {
    /* The mark is already durable. A failed audit append is logged, not turned
       into a 500 that leaves an operator unable to correct a misclassification. */
    log.warn("[wave230] audit append failed:", (err as Error).message);
  }

  return { ok: true, excluded, excludedAt, reason };
}
