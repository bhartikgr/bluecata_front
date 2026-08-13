/**
 * server/lib/spvFeeChainRebuild.ts — WAVE 14 / FL-1 (CST-045, OQ-37)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT WAS ACTUALLY MISSING — CHECKED FIRST, AS RULE 3 REQUIRES
 *
 * The item reads as "rebuild the spv_fee chain". Three of the four pieces
 * ALREADY EXISTED and only needed wiring:
 *
 *   1. THE LEDGER TABLE. `spv_fee_chain_rebuild` was created by migration 0153
 *      (server/db/migrations/0153_wave5_money_captable.sql:702), STRICT, with
 *      BEFORE UPDATE and BEFORE DELETE triggers that RAISE(ABORT,
 *      'SPV_FEE_CHAIN_REBUILD_IMMUTABLE'). It is append-only by construction.
 *      It is listed in WAVE5_TABLES (server/lib/applyWave5MoneySchema.ts:115),
 *      so the self-heal installer re-creates it — the A-22 check for this item.
 *      **NO MIGRATION IS ADDED HERE.** Declaring the table again in 0170 would
 *      trip the new shape-collision guard and would be a second declaration of
 *      one fact.
 *   2. THE REMEDY DOMAIN. The table's own CHECK constraint already fixes the
 *      two OQ-37 options: `remedy IN ('rechain_in_place','quarantine_and_rechain')`.
 *      `rechain_in_place` is OQ-37(a) (delete-and-reseed the hashes);
 *      `quarantine_and_rechain` is OQ-37(b) (preserve the superseded hashes in
 *      an append-only record, then re-chain).
 *   3. THE HASH FUNCTION. `chain()` in server/spvEngineStore.ts:164 —
 *      `sha256(prev + "|" + JSON.stringify(body, sortedKeys))` over the
 *      SpvFeeDTO with `revisionHash` omitted.
 *
 * WHAT DID NOT EXIST: any writer to that table (`grep -rn
 * "spv_fee_chain_rebuild"` returned the DDL, its mirror, and the installer's
 * table list — and nothing else), and any way to VERIFY the chain at all. So
 * the fee lock was undetectable and unrepairable. This module is the verifier
 * and the writer.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE OWNER DECISION IS NOT MADE HERE
 *
 * GATE-FL1 is an OPEN OWNER QUESTION (spec/CONSORTIUM_PARTNER_BUILD_v8.md:689,
 * OQ-37) and it is ALSO blocked on OPS-8, a production `spv_fee` row count
 * pending from Avi. Choosing a remedy on the owner's behalf would silently
 * commit them to losing void history (option a) or to a permanently larger
 * table (option b).
 *
 * So: the remedy is a REQUIRED, EXPLICIT ARGUMENT with no default. There is no
 * fallback branch that picks one. `verifySpvFeeChain` — the read — is fully
 * live and unblocked, because detecting the break needs no ruling. The moment
 * OQ-37 is answered the answer is a call argument and an
 * `orphan_surface_disposition`-style decision row, NOT a code change.
 *
 * FAIL-CLOSED POSTURE, stated plainly: with the chain broken and no remedy
 * chosen, this module reports the break and REFUSES to rebuild. That is the
 * correct posture for a hash chain over money terms — an unauthorised rebuild
 * is indistinguishable from tampering, because it produces exactly the same
 * bytes a tamperer would want.
 */

import { rawDb } from "../db/connection"; /* WAVE 14 / FL-1 — `getConnection` does not exist;
   connection.ts exports getDb / rawDb / getDbDriver. Every sibling wave module
   (wave14MoneyRoutes.ts, partnerTierResolver.ts) uses rawDb, so this matches. */
import { log } from "./logger";
import crypto from "crypto";

const GENESIS = "0".repeat(64);

/** Mirrors `sha256Hex` + `chain()` in server/spvEngineStore.ts:148-171. */
function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

export type ChainRemedy = "rechain_in_place" | "quarantine_and_rechain";

export const CHAIN_REMEDIES: readonly ChainRemedy[] = Object.freeze([
  "rechain_in_place",
  "quarantine_and_rechain",
] as const);

export function isChainRemedy(v: unknown): v is ChainRemedy {
  return typeof v === "string" && (CHAIN_REMEDIES as readonly string[]).includes(v);
}

export interface FeeChainBreak {
  id: string;
  spvId: string;
  position: number;
  /** What the row claims its predecessor was. */
  storedPrev: string | null;
  /** What the walk says its predecessor actually is. */
  expectedPrev: string;
  storedCurr: string | null;
  expectedCurr: string;
  kind: "prev_mismatch" | "curr_mismatch" | "both";
}

export interface FeeChainVerdict {
  ok: boolean;
  rows: number;
  breaks: FeeChainBreak[];
  storedTip: string | null;
  expectedTip: string;
  /** True when a rebuild has already been recorded and the fee lock is on. */
  locked: boolean;
  lockedAt: string | null;
  lockedTip: string | null;
  /** Non-null when the verdict itself could not be established. */
  unavailable: string | null;
}

/**
 * The canonical hash body for one `spv_fee` row.
 *
 * THIS MUST MATCH THE WRITER BYTE FOR BYTE or every row reads as broken. The
 * writer (spvEngineStore.ts:781) hashes `{ ...SpvFeeDTO, revisionHash:
 * undefined }` through `JSON.stringify(body, Object.keys(body).sort())`. The
 * key list is therefore the DTO's own keys sorted, `revisionHash` included in
 * the key list but dropped from the output because its value is `undefined`.
 * Reproduced here from the ROW so verification is independent of the in-memory
 * projection — a verifier that trusted `feesBySpv` would agree with a corrupted
 * hydrate and report OK.
 */
export function feeChainBody(row: Record<string, any>): string {
  const body: Record<string, unknown> = {
    id: row.id,
    spvId: row.spv_id,
    layer: row.layer,
    feeType: row.fee_type,
    fixedAmountMinor: row.fixed_amount_minor,
    carryPct: row.carry_pct,
    currency: row.currency,
    effectiveDate: row.effective_date,
    setBy: row.set_by,
    createdAt: row.created_at,
    revisionHash: undefined,
  };
  return JSON.stringify(body, Object.keys(body).sort());
}

function readLock(db: any): { locked: boolean; lockedAt: string | null; lockedTip: string | null } {
  try {
    const r = db
      .prepare(
        `SELECT locked, performed_at, new_tip_hash FROM spv_fee_chain_rebuild
          ORDER BY performed_at DESC LIMIT 1`,
      )
      .get() as any;
    if (!r) return { locked: false, lockedAt: null, lockedTip: null };
    return { locked: Number(r.locked) === 1, lockedAt: r.performed_at ?? null, lockedTip: r.new_tip_hash ?? null };
  } catch {
    /* Table absent (pre-0153 database) reads as "no lock recorded", never as
       "locked" — a missing ledger must not freeze fee configuration. */
    return { locked: false, lockedAt: null, lockedTip: null };
  }
}

/**
 * FL-1 READ — walk the `spv_fee` chain and report every break. Persists nothing.
 *
 * ORDER. The walk uses `ORDER BY created_at ASC, rowid ASC`, which is the order
 * `hydrate()` uses (spvEngineStore.ts:3227) with an explicit tie-break added.
 * Two fees written in the same millisecond would otherwise verify in an order
 * SQLite is not obliged to repeat, and the chain would read as broken on one
 * boot and intact on the next. `rowid` is the insertion order, which is the
 * order `chain()` actually saw.
 */
export function verifySpvFeeChain(): FeeChainVerdict {
  const empty = (unavailable: string | null): FeeChainVerdict => ({
    ok: false, rows: 0, breaks: [], storedTip: null, expectedTip: GENESIS,
    locked: false, lockedAt: null, lockedTip: null, unavailable,
  });
  let db: any;
  try {
    db = rawDb();
  } catch (e) {
    return empty(`DB_UNAVAILABLE: ${(e as Error).message}`);
  }
  const lock = readLock(db);
  let rows: any[];
  try {
    rows = db
      .prepare(
        `SELECT id, spv_id, layer, fee_type, fixed_amount_minor, carry_pct, currency,
                effective_date, set_by, created_at, prev_hash, curr_hash
           FROM spv_fee ORDER BY created_at ASC, rowid ASC`,
      )
      .all() as any[];
  } catch (e) {
    /* A read failure is NOT "chain ok". S-3 established the rule for this exact
       table: a fee read that fails degrades to "unknown, stay shut". */
    const v = empty(`SPV_FEE_READ_FAILED: ${(e as Error).message}`);
    return { ...v, ...lock };
  }

  const breaks: FeeChainBreak[] = [];
  let tip = GENESIS;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const expectedPrev = tip;
    const expectedCurr = sha256Hex(`${expectedPrev}|${feeChainBody(r)}`);
    const prevBad = String(r.prev_hash ?? "") !== expectedPrev;
    const currBad = String(r.curr_hash ?? "") !== expectedCurr;
    if (prevBad || currBad) {
      breaks.push({
        id: String(r.id),
        spvId: String(r.spv_id),
        position: i,
        storedPrev: r.prev_hash ?? null,
        expectedPrev,
        storedCurr: r.curr_hash ?? null,
        expectedCurr,
        kind: prevBad && currBad ? "both" : prevBad ? "prev_mismatch" : "curr_mismatch",
      });
    }
    /* THE WALK CONTINUES FROM THE RECOMPUTED HASH, NOT THE STORED ONE. Walking
       from the stored hash would make ONE tampered row hide every later row's
       break; walking from the recomputed hash makes the whole tail visible,
       which is what a rebuild needs to know. */
    tip = expectedCurr;
  }
  return {
    ok: breaks.length === 0,
    rows: rows.length,
    breaks,
    storedTip: rows.length ? (rows[rows.length - 1].curr_hash ?? null) : null,
    expectedTip: tip,
    ...lock,
    unavailable: null,
  };
}

export interface RebuildRequest {
  /** REQUIRED. No default: see the OQ-37 note at the top of this file. */
  remedy: ChainRemedy;
  /** Owner/admin user id of record. Never client-supplied identity. */
  performedBy: string;
  reason: string;
  /**
   * The verdict the operator was looking at when they authorised this. The
   * rebuild REFUSES if the chain has changed since — otherwise an authorisation
   * for one break silently re-chains a different, later one.
   */
  expectedTip: string;
}

export interface RebuildResult {
  ok: boolean;
  error?: string;
  rebuildId?: string;
  remedy?: ChainRemedy;
  rowsRechained?: number;
  oldTip?: string | null;
  newTip?: string | null;
}

/**
 * FL-1 WRITE — rebuild the chain in ONE TRANSACTION, then record the rebuild
 * and engage the fee lock.
 *
 * SINK: `UPDATE spv_fee SET prev_hash=?, curr_hash=?` plus one INSERT into
 * `spv_fee_chain_rebuild`. Both inside a single `BEGIN IMMEDIATE`. A partial
 * rebuild is strictly worse than a broken chain — it is a chain that verifies
 * over a tampered prefix — so there is no non-transactional path here.
 *
 * SECOND PATH TO THE SAME WRITE, checked: the only other writer of
 * `spv_fee.prev_hash` / `curr_hash` is the INSERT in
 * `spvEngineStore.setFee` (:781), which appends and never rewrites an existing
 * row. It reads its tip from the in-memory `chainTip`, which is loaded from the
 * LAST hydrated row — so after a rebuild the process must re-hydrate, or the
 * next appended fee would chain from the pre-rebuild tip and break the chain
 * again immediately. `requiresRehydrate` in the result says so explicitly, and
 * the route reports it.
 */
export function rebuildSpvFeeChain(req: RebuildRequest): RebuildResult & { requiresRehydrate?: boolean } {
  if (!isChainRemedy(req.remedy)) {
    return { ok: false, error: "CHAIN_REMEDY_REQUIRED" };
  }
  const performedBy = String(req.performedBy ?? "").trim();
  if (!performedBy) return { ok: false, error: "PERFORMED_BY_REQUIRED" };
  const reason = String(req.reason ?? "").trim();
  /* An unexplained rebuild of a money hash chain is indistinguishable from
     tampering after the fact, so a substantive reason is mandatory. */
  if (reason.length < 20) return { ok: false, error: "REBUILD_REASON_TOO_SHORT" };

  const before = verifySpvFeeChain();
  if (before.unavailable) return { ok: false, error: before.unavailable };
  if (before.locked) return { ok: false, error: "SPV_FEE_CHAIN_ALREADY_LOCKED" };
  if (before.ok) return { ok: false, error: "SPV_FEE_CHAIN_INTACT_NOTHING_TO_REBUILD" };
  if (String(req.expectedTip ?? "") !== before.expectedTip) {
    return { ok: false, error: "SPV_FEE_CHAIN_MOVED_SINCE_AUTHORISATION" };
  }

  const db = rawDb();
  const nowIso = new Date().toISOString();
  const rebuildId = `sfcr_${crypto.randomBytes(8).toString("hex")}`;
  const oldTip = before.storedTip;

  const rows = db
    .prepare(
      `SELECT id, spv_id, layer, fee_type, fixed_amount_minor, carry_pct, currency,
              effective_date, set_by, created_at, prev_hash, curr_hash
         FROM spv_fee ORDER BY created_at ASC, rowid ASC`,
    )
    .all() as any[];

  const txn = db.transaction(() => {
    let tip = GENESIS;
    let rechained = 0;
    for (const r of rows) {
      const prev = tip;
      const curr = sha256Hex(`${prev}|${feeChainBody(r)}`);
      if (String(r.prev_hash ?? "") !== prev || String(r.curr_hash ?? "") !== curr) {
        if (req.remedy === "quarantine_and_rechain") {
          /* OQ-37(b) — preserve the superseded hashes before overwriting them.
             The quarantine record lives in the SAME append-only ledger rather
             than in a new table, because a second table for the same fact is
             exactly the duplication the shape-collision guard exists to catch.
             The superseded pair is carried in `reason`, which is NOT NULL and
             free-text, so the void history survives verbatim. */
          db.prepare(
            `INSERT INTO spv_fee_chain_rebuild
               (id, remedy, rows_rechained, old_tip_hash, new_tip_hash, locked, reason, performed_at, performed_by)
             VALUES (?,?,?,?,?,0,?,?,?)`,
          ).run(
            `${rebuildId}_q${rechained}`,
            "quarantine_and_rechain",
            0,
            String(r.prev_hash ?? ""),
            String(r.curr_hash ?? ""),
            `QUARANTINE spv_fee=${r.id} superseded prev=${r.prev_hash ?? "null"} curr=${r.curr_hash ?? "null"}`,
            nowIso,
            performedBy,
          );
        }
        db.prepare(`UPDATE spv_fee SET prev_hash=?, curr_hash=? WHERE id=?`).run(prev, curr, r.id);
        rechained++;
      }
      tip = curr;
    }
    db.prepare(
      `INSERT INTO spv_fee_chain_rebuild
         (id, remedy, rows_rechained, old_tip_hash, new_tip_hash, locked, reason, performed_at, performed_by)
       VALUES (?,?,?,?,?,1,?,?,?)`,
    ).run(rebuildId, req.remedy, rechained, oldTip, tip, reason, nowIso, performedBy);
    return { rechained, newTip: tip };
  });

  try {
    const out = txn();
    log.warn(
      `[spvFeeChainRebuild] FL-1 rebuild committed: remedy=${req.remedy} rows=${out.rechained} ` +
        `oldTip=${oldTip ?? "null"} newTip=${out.newTip} by=${performedBy}. ` +
        `The fee lock is now ENGAGED; the process must re-hydrate before the next fee write.`,
    );
    return {
      ok: true,
      rebuildId,
      remedy: req.remedy,
      rowsRechained: out.rechained,
      oldTip,
      newTip: out.newTip,
      requiresRehydrate: true,
    };
  } catch (e) {
    /* The transaction rolled back in full — including the quarantine rows, which
       is why they are inside it rather than written ahead of it. */
    return { ok: false, error: `SPV_FEE_CHAIN_REBUILD_FAILED: ${(e as Error).message}` };
  }
}
