/**
 * W-MFCRM persona — Angel network (chapter scoping + per-chapter carry).
 *
 * ADDITIVE persona layer on the SAME engagement model (design §7: personas add
 * columns/tables, NEVER fork the engine). The base `mf_engagement` row already
 * carries a `chapter_id` column; this store owns the additive `mf_angel_chapter`
 * table (per-partner chapters + carry basis-points) and the read/write helpers
 * that scope an engagement to a chapter. It reuses `managedFounderStore` for all
 * engagement mutations — it NEVER writes `mf_engagement` directly.
 *
 * FAIL-CLOSED isolation: every method takes a session-resolved `partnerId`
 * (never a URL/body value). Chapter scoping requires the partner's capability
 * profile to have `chapterScoping=true` (fail-closed otherwise).
 */
import { randomUUID } from "crypto";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
import { managedFounderStore, GateError } from "./managedFounderStore";
import { ensureAngelChapterCarryRecorded } from "./lib/angelChapterCarrySchema";

let ensured = false;

/* ===========================================================================
   WAVE 340 - ITEM 2: THE CARRY DEFAULT IS NULL, NOT ZERO.
   ===========================================================================
   `carry_bps` is declared `INTEGER NOT NULL DEFAULT 0`, and BOTH writers below
   used to turn absent input into 0. A chapter created with the Carry box left
   blank therefore stored 0 and read back as an AGREED zero carry - a definite
   commercial claim that nobody made. A chapter is not a fund; having no carry
   arrangement at all is its normal state.

   Migration 0233 adds the nullable companion `carry_bps_recorded`:
     NULL   no rate is recorded          -> the screen reads "Not set"
     0      exactly 0% was recorded      -> the screen reads 0.00%
     n      n basis points were recorded

   `carry_bps` KEEPS ITS DECLARATION AND ITS VALUE ON EVERY EXISTING ROW. Making
   it nullable would need a SQLite table rebuild (create-copy-drop-rename), which
   is destructive SQL on a live table and is forbidden here. Every write below
   still sets `carry_bps` to `recorded ?? 0`, exactly the value it would have held
   before this wave, so no existing reader of that column changes behaviour.

   NOTHING BACKFILLS THE OLD ROWS. On a row already stored, a deliberate 0% and a
   defaulted 0% are indistinguishable - see the migration's section 3 - so the
   installer COUNTS them (`ambiguousLegacyZeroRows`) and writes nothing.
   =========================================================================== */

/**
 * The carry rate a caller actually supplied, or `null` when it supplied none.
 *
 * `null` NEVER becomes 0 here. That is the whole point of the wave, and it
 * follows `canonicalCommittedMinorForSpv` (which returns null, never 0) and the
 * WAVE 140 ruling that a blank Cap in the SPV wizard persists as NULL.
 *
 * A non-numeric or negative input is treated as ABSENT rather than clamped to 0,
 * because clamping is how the fabricated zero got here: `Math.max(0, ...)` turns
 * "-1", "" and "abc" all into a claim of zero carry. Absent is the truthful
 * reading of an unusable value, and the previous behaviour for those inputs was
 * a stored 0 either way, so nothing that used to be recorded stops being.
 */
export function recordedCarryBpsFromInput(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/** Idempotent lazy DDL for the additive angel table (kycDocumentStore pattern). */
export function ensureAngelTables(): void {
  if (ensured) return;
  const db: any = rawDb();
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS mf_angel_chapter (
      id          TEXT PRIMARY KEY NOT NULL,
      partner_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      region      TEXT,
      carry_bps   INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_angel_chapter_partner ON mf_angel_chapter(partner_id);`);
    /* WAVE 340 - ITEM 2: migration 0233's nullable `carry_bps_recorded`. Installed
       here because server/db/connection.ts is SACRED-FROZEN and cannot be widened,
       so the sandbox database and every `:memory:` test database would otherwise
       never get the column. The installer REPORTS what it did; failures are logged
       with their counts rather than swallowed. */
    const carry = ensureAngelChapterCarryRecorded(db);
    if (carry.failures.length > 0) {
      log.warn("[mfcrmAngelStore] carry_bps_recorded install FAILED:", carry.failures.join(" | "));
    } else {
      log.info?.(
        `[mfcrmAngelStore] carry_bps_recorded ready (added=${carry.columnAdded} present=${carry.columnAlreadyPresent} rows=${carry.totalRows} recorded=${carry.recordedRows} legacyNonZero=${carry.legacyNonZeroRows} ambiguousLegacyZero=${carry.ambiguousLegacyZeroRows})`,
      );
    }
    ensured = true;
    log.info?.("[mfcrmAngelStore] ensured mf_angel_chapter");
  } catch (err) {
    log.warn("[mfcrmAngelStore] ensureAngelTables failed (non-fatal):", (err as Error).message);
    ensured = true;
  }
}

function requirePid(partnerId: string): void {
  if (!partnerId || typeof partnerId !== "string") throw new Error("PARTNER_ID_REQUIRED");
}

function assertChapterScoping(partnerId: string): void {
  const p = managedFounderStore.getCapabilityProfile(partnerId);
  if (!p.chapterScoping) throw new GateError("CHAPTER_SCOPING_REQUIRED", "chapter_scoping=true is required for angel chapters.");
}

export const mfcrmAngelStore = {
  createChapter(partnerId: string, data: { name: string; region?: string | null; carryBps?: number | null }, _actor: string): any {
    requirePid(partnerId);
    assertChapterScoping(partnerId);
    ensureAngelTables();
    if (!data.name || !data.name.trim()) throw new Error("CHAPTER_NAME_REQUIRED");
    const now = new Date().toISOString();
    const id = `mfch_${randomUUID()}`;
    /* WAVE 340 - ITEM 2: a blank Carry box now persists as NULL, not 0. */
    const recorded = recordedCarryBpsFromInput(data.carryBps);
    rawDb().prepare(
      `INSERT INTO mf_angel_chapter (id, partner_id, name, region, carry_bps, carry_bps_recorded, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(id, partnerId, data.name.trim(), data.region ?? null, recorded ?? 0, recorded, now, now);
    return this.getChapter(partnerId, id);
  },

  getChapter(partnerId: string, chapterId: string): any | null {
    requirePid(partnerId);
    ensureAngelTables();
    return rawDb().prepare(`SELECT * FROM mf_angel_chapter WHERE id = ? AND partner_id = ?`).get(chapterId, partnerId) ?? null;
  },

  listChapters(partnerId: string): any[] {
    requirePid(partnerId);
    ensureAngelTables();
    return rawDb().prepare(`SELECT * FROM mf_angel_chapter WHERE partner_id = ? ORDER BY created_at DESC`).all(partnerId) as any[];
  },

  /**
   * Record a carry rate, or CLEAR it.
   *
   * WAVE 340 - ITEM 2: passing `null`/`undefined`/`""` no longer means "0%"; it
   * means "there is no agreed rate", and it stores NULL. That is a deliberate act
   * by a user looking at that one chapter, not a backfill: no other row is
   * touched and no pre-existing 0 is reinterpreted anywhere.
   */
  setChapterCarry(partnerId: string, chapterId: string, carryBps: number | null | undefined): any {
    requirePid(partnerId);
    assertChapterScoping(partnerId);
    ensureAngelTables();
    const c = this.getChapter(partnerId, chapterId);
    if (!c) throw new GateError("CHAPTER_NOT_FOUND");
    const recorded = recordedCarryBpsFromInput(carryBps);
    rawDb().prepare(
      `UPDATE mf_angel_chapter SET carry_bps = ?, carry_bps_recorded = ?, updated_at = ? WHERE id = ? AND partner_id = ?`,
    ).run(recorded ?? 0, recorded, new Date().toISOString(), chapterId, partnerId);
    return this.getChapter(partnerId, chapterId);
  },

  /** Scope an ACTIVE engagement to a chapter (additive on the SAME model). */
  assignEngagementToChapter(partnerId: string, engagementId: string, chapterId: string, actor: string): any {
    requirePid(partnerId);
    assertChapterScoping(partnerId);
    ensureAngelTables();
    const eng = managedFounderStore.getEngagement(partnerId, engagementId);
    if (!eng) throw new GateError("ENGAGEMENT_NOT_FOUND");
    const c = this.getChapter(partnerId, chapterId);
    if (!c) throw new GateError("CHAPTER_NOT_FOUND");
    // Scope through the ENGINE's additive setter — never write mf_engagement here.
    return managedFounderStore.setEngagementScope(partnerId, engagementId, { chapterId }, "chapter_assigned", { chapterId }, actor);
  },

  /** Per-chapter carry rollup: engagements grouped by chapter with carry_bps. */
  chapterCarryReport(partnerId: string): any[] {
    requirePid(partnerId);
    ensureAngelTables();
    const chapters = this.listChapters(partnerId);
    const engagements = managedFounderStore.listEngagements(partnerId);
    return chapters.map((c: any) => {
      const scoped = engagements.filter((e) => e.chapterId === c.id);
      return {
        chapterId: c.id,
        name: c.name,
        region: c.region ?? null,
        carryBps: c.carry_bps,
        /* WAVE 340 - ITEM 2: the honest field. NULL means no rate is recorded; 0
           means a rate of exactly 0% was recorded. `carryBps` above is left
           EXACTLY as it was, so no existing consumer of it changes. */
        carryBpsRecorded: c.carry_bps_recorded ?? null,
        engagementCount: scoped.length,
        activeCount: scoped.filter((e) => e.status === "ACTIVE").length,
      };
    });
  },
};

export function hydrateMfcrmAngelStore(): void {
  ensureAngelTables();
}
