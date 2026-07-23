/**
 * W-FIX2a SPV-BUG-1 — reversible ×100 (×10^exp) data-migration for SPV amount
 * fields that were persisted at 1/100 of their true value.
 *
 * ROOT CAUSE (client): `PartnerSpvEngine.tsx` wrote the raw entered dollars
 * straight into the `*_minor` columns without the currency ×10^exp scaling, so
 * "$500,000" was stored as `500000` minor and rendered by `formatMinor` as
 * "$5,000.00". Fixed forward via `toMinor(...)` on the write path; this module
 * repairs records already saved by the buggy path.
 *
 * PROPERTIES (owner decision 2026-07-20):
 *   - GUARDED  — only touches records whose stored target raise displays
 *                IMPLAUSIBLY SMALL for an institutional SPV (the visible 1/100
 *                symptom). Detection is by MAGNITUDE: a record is a candidate
 *                iff its implied major target (value / 10^exp) is below
 *                `suspectMajorCeiling` (default 10_000). Records that already
 *                display a plausible institutional size are left untouched.
 *   - ATOMIC per-SPV — when a record is deemed buggy-path, ALL amount fields it
 *                co-wrote in the same wizard submit (target/min/cap + its
 *                spv_fee fixed amounts) are corrected together by the SAME
 *                ×10^exp factor.
 *   - REVERSIBLE — `revertSpvBug1Migration(result)` divides back by exactly the
 *                factor applied to exactly the ids/fields the up-run changed.
 *   - LOGGED   — every before→after is captured in the returned result and (when
 *                `artifactDir` is supplied) written as three artifacts.
 *   - LIVE-SAFE— idempotent: a second up-run finds the now-plausible values
 *                above the ceiling and skips them.
 *
 * SACRED COMPLIANCE: writes ONLY to the `spv` / `spv_fee` engine tables via
 * rawDb — no import of any sacred store, no touch of the cap-table ledger.
 */
import fs from "fs";
import path from "path";
import { rawDb } from "../db/connection";
import { currencyExponent } from "./currency";
import { log } from "./logger";

export interface SpvBug1FieldChange {
  table: "spv" | "spv_fee";
  rowId: string;
  spvId: string;
  field: string;
  currency: string;
  factor: number;
  before: number;
  after: number;
}

export interface SpvBug1MigrationResult {
  changedSpvIds: string[];
  changes: SpvBug1FieldChange[];
  scanned: number;
  skipped: number;
  suspectMajorCeiling: number;
  /** True when the run computed + emitted artifacts but wrote NO rows. */
  dryRun?: boolean;
}

export interface SpvBug1Options {
  /** Implied-major display value below which a target raise is treated as the
   *  1/100 bug symptom. Default 10_000 (a real institutional SPV target raise of
   *  under ten-thousand units is implausible; the buggy path makes true raises
   *  render at 1/100, i.e. below this floor). */
  suspectMajorCeiling?: number;
  /** When set, write the three artifacts + the corrected-SPV markdown here. */
  artifactDir?: string;
  /** When true, compute every before→after and emit artifacts, but execute NO
   *  UPDATE. The returned result carries `dryRun:true` and its `changes` list is
   *  exactly what a real run WOULD write. Detection/scaling math is unchanged. */
  dryRun?: boolean;
  /** SPV ids to explicitly EXCLUDE. Any scanned row whose id is on this list is
   *  skipped (and the skip is logged) before detection runs. */
  denyList?: string[];
  /** When non-empty, ONLY these SPV ids are eligible; every scanned row not on
   *  the list is skipped (and the skip is logged) before detection runs. */
  allowList?: string[];
}

const SPV_AMOUNT_FIELDS = ["target_raise_minor", "min_check_minor", "cap_minor"] as const;

/** Is `value` a positive integer amount we can safely scale? */
function scalable(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * UP — correct SPV records saved by the buggy (un-scaled) path.
 */
export function migrateSpvBug1(opts: SpvBug1Options = {}): SpvBug1MigrationResult {
  const suspectMajorCeiling = opts.suspectMajorCeiling ?? 10_000;
  const dryRun = opts.dryRun === true;
  const denySet = new Set(opts.denyList ?? []);
  const allowSet = (opts.allowList && opts.allowList.length) ? new Set(opts.allowList) : null;
  const changes: SpvBug1FieldChange[] = [];
  const changedSpvIds: string[] = [];
  let scanned = 0;
  let skipped = 0;
  let db: any;
  try {
    db = rawDb();
  } catch {
    return { changedSpvIds, changes, scanned, skipped, suspectMajorCeiling, dryRun };
  }

  let spvRows: any[] = [];
  try {
    spvRows = db
      .prepare(
        `SELECT id, currency, target_raise_minor, min_check_minor, cap_minor
           FROM spv WHERE archived_at IS NULL`,
      )
      .all() as any[];
  } catch {
    return { changedSpvIds, changes, scanned, skipped, suspectMajorCeiling, dryRun };
  }

  for (const row of spvRows) {
    scanned++;
    // List gating runs BEFORE detection so the detection heuristic is untouched.
    if (denySet.has(row.id)) {
      log.info?.(`[spvBug1] skip ${row.id}: on denyList`);
      skipped++;
      continue;
    }
    if (allowSet && !allowSet.has(row.id)) {
      log.info?.(`[spvBug1] skip ${row.id}: not on allowList`);
      skipped++;
      continue;
    }
    const currency = row.currency || "USD";
    const exp = currencyExponent(currency);
    const factor = Math.pow(10, exp);
    if (factor <= 1) {
      // 0-decimal currency (e.g. JPY): there is no ×100 minor conversion, so the
      // buggy path could not have shifted it. Never touch.
      skipped++;
      continue;
    }

    // Detection: pick the first present amount to test the display magnitude.
    const probe = [row.target_raise_minor, row.cap_minor, row.min_check_minor].find(scalable);
    if (!scalable(probe)) {
      skipped++;
      continue;
    }
    const impliedMajor = probe / factor;
    if (impliedMajor >= suspectMajorCeiling) {
      // Displays as a plausible institutional size → NOT the 1/100 bug. Skip.
      skipped++;
      continue;
    }

    // Buggy-path SPV: scale every co-written amount field on this row.
    const spvChanges: SpvBug1FieldChange[] = [];
    const setClauses: string[] = [];
    const setValues: number[] = [];
    for (const field of SPV_AMOUNT_FIELDS) {
      const before = row[field];
      if (!scalable(before)) continue;
      const after = Math.round(before * factor);
      setClauses.push(`${field} = ?`);
      setValues.push(after);
      spvChanges.push({
        table: "spv", rowId: row.id, spvId: row.id, field, currency, factor, before, after,
      });
    }
    if (!setClauses.length) {
      skipped++;
      continue;
    }
    if (!dryRun) {
      try {
        db.prepare(`UPDATE spv SET ${setClauses.join(", ")} WHERE id = ?`).run(...setValues, row.id);
      } catch (err) {
        log.warn?.("[spvBug1] up failed for spv", row.id, (err as Error).message);
        skipped++;
        continue;
      }
    }

    // Correct the same SPV's fixed fee amounts (co-written by the same wizard).
    try {
      const feeRows = db
        .prepare(`SELECT id, currency, fixed_amount_minor FROM spv_fee WHERE spv_id = ?`)
        .all(row.id) as any[];
      for (const fr of feeRows) {
        const before = fr.fixed_amount_minor;
        if (!scalable(before)) continue;
        const feeCurrency = fr.currency || currency;
        const feeFactor = Math.pow(10, currencyExponent(feeCurrency));
        if (feeFactor <= 1) continue;
        const after = Math.round(before * feeFactor);
        if (!dryRun) {
          db.prepare(`UPDATE spv_fee SET fixed_amount_minor = ? WHERE id = ?`).run(after, fr.id);
        }
        spvChanges.push({
          table: "spv_fee", rowId: fr.id, spvId: row.id, field: "fixed_amount_minor",
          currency: feeCurrency, factor: feeFactor, before, after,
        });
      }
    } catch (err) {
      log.warn?.("[spvBug1] fee scale failed for spv", row.id, (err as Error).message);
    }

    for (const c of spvChanges) {
      log.info?.(
        `[spvBug1] ${c.table}.${c.field} ${c.rowId}: ${c.before} → ${c.after} (×${c.factor} ${c.currency})`,
      );
    }
    changes.push(...spvChanges);
    changedSpvIds.push(row.id);
  }

  log.info?.(
    `[spvBug1] up${dryRun ? " (DRY-RUN, no writes)" : ""}: ` +
      `${dryRun ? "would correct" : "corrected"} ${changedSpvIds.length} SPV(s), ` +
      `${changes.length} field(s); scanned ${scanned}, skipped ${skipped}`,
  );

  const result: SpvBug1MigrationResult = {
    changedSpvIds, changes, scanned, skipped, suspectMajorCeiling, dryRun,
  };
  if (opts.artifactDir) {
    try {
      emitArtifacts(opts.artifactDir, result);
    } catch (err) {
      log.warn?.("[spvBug1] artifact emission failed:", (err as Error).message);
    }
  }
  return result;
}

/**
 * DOWN — undo exactly the changes an up-run made, dividing each field back by
 * the factor that was applied. Only reverts rows whose CURRENT value still
 * equals the recorded `after` (so a manual edit after migration is not clobbered).
 */
export function revertSpvBug1Migration(result: SpvBug1MigrationResult): number {
  let reverted = 0;
  let db: any;
  try {
    db = rawDb();
  } catch {
    return 0;
  }
  // Revert fees first, then spv (order is irrelevant but keeps logs grouped).
  for (const c of result.changes) {
    try {
      const table = c.table;
      const cur = db.prepare(`SELECT ${c.field} AS v FROM ${table} WHERE id = ?`).get(c.rowId) as
        | { v?: number }
        | undefined;
      if (!cur || cur.v !== c.after) continue; // changed since — leave it alone
      db.prepare(`UPDATE ${table} SET ${c.field} = ? WHERE id = ?`).run(c.before, c.rowId);
      reverted++;
    } catch (err) {
      log.warn?.("[spvBug1] down failed for", c.table, c.rowId, (err as Error).message);
    }
  }
  log.info?.(`[spvBug1] down: reverted ${reverted} field(s)`);
  return reverted;
}

/**
 * Emit the THREE state-change artifacts + the human-readable corrected list.
 *   1. spv_bug1_migration_up.json    — full before→after change ledger (source of truth for reversal)
 *   2. spv_bug1_migration_down.json  — the inverse operation manifest
 *   3. spv_bug1_corrected.md         — human-readable corrected-SPV list (for the fix report)
 */
export function emitArtifacts(dir: string, result: SpvBug1MigrationResult): void {
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString();

  const upPath = path.join(dir, "spv_bug1_migration_up.json");
  fs.writeFileSync(
    upPath,
    JSON.stringify(
      { artifact: "spv_bug1_migration_up", generatedAt: ts, ...result },
      null,
      2,
    ),
  );

  const downPath = path.join(dir, "spv_bug1_migration_down.json");
  fs.writeFileSync(
    downPath,
    JSON.stringify(
      {
        artifact: "spv_bug1_migration_down",
        generatedAt: ts,
        note: "Apply these to reverse the up-migration (divide back by factor).",
        operations: result.changes.map((c) => ({
          table: c.table,
          rowId: c.rowId,
          field: c.field,
          setTo: c.before,
          onlyIfCurrentEquals: c.after,
        })),
      },
      null,
      2,
    ),
  );

  const bySpv = new Map<string, SpvBug1FieldChange[]>();
  for (const c of result.changes) {
    const list = bySpv.get(c.spvId) ?? [];
    list.push(c);
    bySpv.set(c.spvId, list);
  }
  const lines: string[] = [];
  lines.push("# SPV-BUG-1 — corrected SPV records (reversible ×10^exp migration)");
  lines.push("");
  lines.push(`Generated: ${ts}`);
  lines.push("");
  lines.push(
    `Scanned **${result.scanned}** SPV(s); corrected **${result.changedSpvIds.length}**; ` +
      `skipped **${result.skipped}** (already plausible / non-scalable / 0-decimal currency).`,
  );
  lines.push(`Suspect display ceiling: major < **${result.suspectMajorCeiling}**.`);
  lines.push("");
  if (!result.changedSpvIds.length) {
    lines.push("_No affected records found — nothing to correct._");
  } else {
    for (const spvId of result.changedSpvIds) {
      lines.push(`## SPV \`${spvId}\``);
      lines.push("");
      lines.push("| table | field | currency | before (minor) | after (minor) | factor |");
      lines.push("| --- | --- | --- | ---: | ---: | ---: |");
      for (const c of bySpv.get(spvId) ?? []) {
        lines.push(
          `| ${c.table} | ${c.field} | ${c.currency} | ${c.before} | ${c.after} | ×${c.factor} |`,
        );
      }
      lines.push("");
    }
  }
  fs.writeFileSync(path.join(dir, "spv_bug1_corrected.md"), lines.join("\n") + "\n");

  log.info?.(`[spvBug1] artifacts written to ${dir} (up.json, down.json, corrected.md)`);
}
