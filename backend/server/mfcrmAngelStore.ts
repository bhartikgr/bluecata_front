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

let ensured = false;

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
  createChapter(partnerId: string, data: { name: string; region?: string | null; carryBps?: number }, _actor: string): any {
    requirePid(partnerId);
    assertChapterScoping(partnerId);
    ensureAngelTables();
    if (!data.name || !data.name.trim()) throw new Error("CHAPTER_NAME_REQUIRED");
    const now = new Date().toISOString();
    const id = `mfch_${randomUUID()}`;
    const carryBps = Number.isFinite(data.carryBps) ? Math.max(0, Math.trunc(data.carryBps as number)) : 0;
    rawDb().prepare(
      `INSERT INTO mf_angel_chapter (id, partner_id, name, region, carry_bps, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(id, partnerId, data.name.trim(), data.region ?? null, carryBps, now, now);
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

  setChapterCarry(partnerId: string, chapterId: string, carryBps: number): any {
    requirePid(partnerId);
    assertChapterScoping(partnerId);
    ensureAngelTables();
    const c = this.getChapter(partnerId, chapterId);
    if (!c) throw new GateError("CHAPTER_NOT_FOUND");
    const bps = Number.isFinite(carryBps) ? Math.max(0, Math.trunc(carryBps)) : 0;
    rawDb().prepare(`UPDATE mf_angel_chapter SET carry_bps = ?, updated_at = ? WHERE id = ? AND partner_id = ?`)
      .run(bps, new Date().toISOString(), chapterId, partnerId);
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
        engagementCount: scoped.length,
        activeCount: scoped.filter((e) => e.status === "ACTIVE").length,
      };
    });
  },
};

export function hydrateMfcrmAngelStore(): void {
  ensureAngelTables();
}
