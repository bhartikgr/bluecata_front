/**
 * WAVE 179 · ITEM B · R151.3 — READ AND WRITE `spv.legal_form`, AND NOTHING ELSE.
 *
 * ══ WHY THIS IS A SEPARATE STORE AND NOT A FIELD ON `persistSpv` ════════════
 * Two independent reasons, both about not breaking things that work.
 *
 * 1 · `server/db/connection.ts` is SACRED and cannot gain the column, so a
 *     freshly-created database — which is every test database — has `spv` WITHOUT
 *     `legal_form` regardless of migration 0214. `ensureSpvLegalFormColumn()`
 *     below is the house answer to exactly that, copied from
 *     `ensureSpvLpInviteOriginColumn` (`server/spvLpInviteStore.ts:85`, migration
 *     0209).
 *
 * 2 · If the column were listed in `persistSpv`'s INSERT, then on any database
 *     that had not yet converged EVERY SPV WRITE WOULD FAIL — creation, status
 *     change, terms merge, the lot — to support an optional annotation. Keeping it
 *     off the hot path means the worst case for an unconverged database is that
 *     this one optional field cannot be set, which is precisely the state the
 *     platform was in before this wave and is survivable. An optional field must
 *     not be able to take down the vehicle table.
 *
 * ══ NO INFERENCE LIVES HERE EITHER ══════════════════════════════════════════
 * `setSpvLegalForm` writes what `resolveSpvLegalForm` (shared/spvLegalForm.ts)
 * approved for the vehicle's OWN recorded jurisdiction, or NULL. `getSpvLegalForm`
 * validates on the way out too, so a value that is in the column but not valid for
 * the vehicle's jurisdiction reads back as "not stated" rather than as a tax
 * position — the fail-closed direction. There is no code path in this file that
 * produces a legal form from a jurisdiction, a vehicle name, a vehicle type, a
 * terms blob or another vehicle.
 *
 * ══ THE `terms` BLOB IS NOT TOUCHED ════════════════════════════════════════
 * Deliberately. The one-level-deep merge contract at
 * `server/spvEngineStore.ts:2440-2451`/`2520-2523` protects `_fundsConfirmations`,
 * and putting an unrelated annotation inside `terms` would put every future write
 * of this field inside that hazard. A column is cheaper and cannot destroy a K-1.
 */
import { rawDb } from "./db/connection";
import { resolveSpvLegalForm, type SpvLegalForm } from "../shared/spvLegalForm";

const _legalFormColumnEnsured = new WeakSet<object>();

/**
 * Idempotently make sure `spv.legal_form` exists (migration 0214).
 *
 * Marked BEFORE the attempt so a persistent DDL failure cannot make every read
 * retry it; the reads below tolerate a missing column honestly by reporting
 * "not stated", which is the same answer every vehicle gives until a GP states one.
 */
export function ensureSpvLegalFormColumn(): void {
  let db: any;
  try { db = rawDb(); } catch { return; }
  if (!db) return;
  if (_legalFormColumnEnsured.has(db as object)) return;
  _legalFormColumnEnsured.add(db as object);
  try {
    db.exec(`ALTER TABLE spv ADD COLUMN legal_form TEXT`);
  } catch {
    /* Column already present (the normal case), or the table does not exist yet —
       both are fine and neither is an error worth logging on every read. */
  }
}

/**
 * The RAW stored string, before validation. Exists only so tests can prove what is
 * physically in the column (and prove that no row was backfilled); no surface
 * renders this.
 */
export function readRawSpvLegalForm(spvId: string): string | null {
  ensureSpvLegalFormColumn();
  try {
    const row = rawDb()
      .prepare(`SELECT legal_form FROM spv WHERE id = ?`)
      .get(spvId) as { legal_form: string | null } | undefined;
    return row?.legal_form ?? null;
  } catch {
    return null;
  }
}

/**
 * The vehicle's stated legal form, validated against the vehicle's OWN recorded
 * jurisdiction. `null` means NOT STATED, and every surface treats that as
 * "render wave 175's wording exactly as it renders today".
 */
export function getSpvLegalForm(spvId: string): SpvLegalForm | null {
  ensureSpvLegalFormColumn();
  let row: { legal_form: string | null; jurisdiction: string | null } | undefined;
  try {
    row = rawDb()
      .prepare(`SELECT legal_form, jurisdiction FROM spv WHERE id = ?`)
      .get(spvId) as { legal_form: string | null; jurisdiction: string | null } | undefined;
  } catch {
    return null;
  }
  if (!row) return null;
  return resolveSpvLegalForm(row.jurisdiction, row.legal_form);
}

/**
 * State, change or CLEAR a vehicle's legal form.
 *
 * Returns the value now in force. Passing `null` (or anything that does not
 * validate for this vehicle's jurisdiction) clears the field back to NOT STATED —
 * a GP who stated the wrong form must be able to un-state it, and un-stating must
 * return the surface to the hedged wording rather than to a different assertion.
 *
 * `updated_at`/`updated_by` are NOT stamped here and the row's `curr_hash` is NOT
 * recomputed. That is a considered choice: those columns and that hash chain belong
 * to the canonical engine's own write path (`persistSpv`), and rewriting them from
 * outside it would put a second author on the vehicle's audit anchor. The
 * annotation is recorded; the vehicle's engine-owned provenance is left to the
 * engine. Wave 181 owns audit-logging paths this wave does not touch.
 */
export function setSpvLegalForm(
  spvId: string,
  jurisdiction: string | null | undefined,
  value: unknown,
): SpvLegalForm | null {
  ensureSpvLegalFormColumn();
  const resolved = resolveSpvLegalForm(jurisdiction, value);
  try {
    rawDb().prepare(`UPDATE spv SET legal_form = ? WHERE id = ?`).run(resolved, spvId);
  } catch {
    /* An unconverged database cannot store the annotation. Reported by returning
       what a subsequent read would actually say, rather than by claiming success. */
    return getSpvLegalForm(spvId);
  }
  return resolved;
}
