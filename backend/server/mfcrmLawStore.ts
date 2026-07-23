/**
 * W-MFCRM persona — Law firm (matters, conflict-of-interest engine, matter-
 * scoped custody, counsel-of-record; sources_capital=false disables the
 * investor spine).
 *
 * ADDITIVE persona layer (design §7). Owns two additive tables: `mf_law_matter`
 * (matters, scoped onto the SAME engagement via its `matter_id` column) and
 * `mf_law_conflict` (conflict-of-interest register). The CoI engine FLAGS, it
 * NEVER blocks (mirrors the engine's crossover-flag philosophy) — a detected
 * conflict is always recorded and the operation proceeds.
 *
 * Investor spine: a law partner is a service firm with `sources_capital=false`,
 * so the engine's GATE 2 already routes any attribution to the counsel/firm-of-
 * record path and NEVER investor first-touch. `assertInvestorSpineDisabled`
 * makes that guarantee explicit + fail-closed for any spine-touching op.
 *
 * FAIL-CLOSED: session-resolved `partnerId` only.
 */
import { randomUUID } from "crypto";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
import { managedFounderStore, GateError } from "./managedFounderStore";

let ensured = false;

export function ensureLawTables(): void {
  if (ensured) return;
  const db: any = rawDb();
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS mf_law_matter (
      id            TEXT PRIMARY KEY NOT NULL,
      partner_id    TEXT NOT NULL,
      company_id    TEXT NOT NULL,
      engagement_id TEXT,
      title         TEXT NOT NULL,
      matter_type   TEXT,
      status        TEXT NOT NULL DEFAULT 'open',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_law_matter_partner ON mf_law_matter(partner_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_law_matter_company ON mf_law_matter(partner_id, company_id);`);
    db.exec(`CREATE TABLE IF NOT EXISTS mf_law_conflict (
      id            TEXT PRIMARY KEY NOT NULL,
      partner_id    TEXT NOT NULL,
      matter_id     TEXT,
      company_id    TEXT NOT NULL,
      conflict_code TEXT NOT NULL,
      counterparty  TEXT,
      detail_json   TEXT,
      status        TEXT NOT NULL DEFAULT 'open',
      created_at    TEXT NOT NULL,
      resolved_at   TEXT
    );`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_law_conflict_partner ON mf_law_conflict(partner_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_law_conflict_company ON mf_law_conflict(partner_id, company_id);`);
    ensured = true;
    log.info?.("[mfcrmLawStore] ensured mf_law_matter + mf_law_conflict");
  } catch (err) {
    log.warn("[mfcrmLawStore] ensureLawTables failed (non-fatal):", (err as Error).message);
    ensured = true;
  }
}

function requirePid(partnerId: string): void {
  if (!partnerId || typeof partnerId !== "string") throw new Error("PARTNER_ID_REQUIRED");
}

/** Explicit, fail-closed guarantee: a law/service firm has NO investor spine. */
export function assertInvestorSpineDisabled(partnerId: string): void {
  const p = managedFounderStore.getCapabilityProfile(partnerId);
  if (p.sourcesCapital) {
    // A law persona must NOT be a capital sourcer; if mis-seeded, fail closed.
    throw new GateError("INVESTOR_SPINE_FORBIDDEN", "Law persona must have sources_capital=false (investor spine disabled).");
  }
}

export const mfcrmLawStore = {
  createMatter(partnerId: string, data: { companyId: string; engagementId?: string | null; title: string; matterType?: string | null }, actor: string): any {
    requirePid(partnerId);
    ensureLawTables();
    if (!data.companyId) throw new Error("COMPANY_ID_REQUIRED");
    if (!data.title || !data.title.trim()) throw new Error("MATTER_TITLE_REQUIRED");
    const now = new Date().toISOString();
    const id = `mfmt_${randomUUID()}`;
    rawDb().prepare(
      `INSERT INTO mf_law_matter (id, partner_id, company_id, engagement_id, title, matter_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    ).run(id, partnerId, data.companyId, data.engagementId ?? null, data.title.trim(), data.matterType ?? null, now, now);
    // Scope the engagement to this matter through the ENGINE's additive setter.
    if (data.engagementId) {
      managedFounderStore.setEngagementScope(partnerId, data.engagementId, { matterId: id }, "matter_created", { matterId: id }, actor);
    }
    return this.getMatter(partnerId, id);
  },

  getMatter(partnerId: string, matterId: string): any | null {
    requirePid(partnerId);
    ensureLawTables();
    return rawDb().prepare(`SELECT * FROM mf_law_matter WHERE id = ? AND partner_id = ?`).get(matterId, partnerId) ?? null;
  },

  listMatters(partnerId: string, companyId?: string): any[] {
    requirePid(partnerId);
    ensureLawTables();
    if (companyId) return rawDb().prepare(`SELECT * FROM mf_law_matter WHERE partner_id = ? AND company_id = ? ORDER BY created_at DESC`).all(partnerId, companyId) as any[];
    return rawDb().prepare(`SELECT * FROM mf_law_matter WHERE partner_id = ? ORDER BY created_at DESC`).all(partnerId) as any[];
  },

  /** Counsel-of-record stamp (service firm attribution — never investor spine). */
  stampCounselOfRecord(partnerId: string, data: { companyId: string; engagementId?: string | null }, actor: string): { id: string; attributionType: string } {
    requirePid(partnerId);
    assertInvestorSpineDisabled(partnerId);
    return managedFounderStore.stampAttribution(partnerId, { companyId: data.companyId, engagementId: data.engagementId ?? null, attributionType: "counsel_of_record" }, actor);
  },

  /**
   * Record a conflict of interest. FLAGS, NEVER BLOCKS — always inserts an
   * 'open' row and returns it; the caller/operation is never denied on the
   * basis of a conflict (design: conflict engine flags, humans resolve).
   */
  flagConflict(partnerId: string, data: { companyId: string; matterId?: string | null; conflictCode: string; counterparty?: string | null; detail?: Record<string, unknown> | null }, _actor: string): { id: string; blocked: false } {
    requirePid(partnerId);
    ensureLawTables();
    if (!data.companyId) throw new Error("COMPANY_ID_REQUIRED");
    if (!data.conflictCode || !data.conflictCode.trim()) throw new Error("CONFLICT_CODE_REQUIRED");
    const now = new Date().toISOString();
    const id = `mfco_${randomUUID()}`;
    rawDb().prepare(
      `INSERT INTO mf_law_conflict (id, partner_id, matter_id, company_id, conflict_code, counterparty, detail_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    ).run(id, partnerId, data.matterId ?? null, data.companyId, data.conflictCode.trim(), data.counterparty ?? null, data.detail ? JSON.stringify(data.detail) : null, now);
    return { id, blocked: false };
  },

  listConflicts(partnerId: string, companyId?: string): any[] {
    requirePid(partnerId);
    ensureLawTables();
    if (companyId) return rawDb().prepare(`SELECT * FROM mf_law_conflict WHERE partner_id = ? AND company_id = ? ORDER BY created_at DESC`).all(partnerId, companyId) as any[];
    return rawDb().prepare(`SELECT * FROM mf_law_conflict WHERE partner_id = ? ORDER BY created_at DESC`).all(partnerId) as any[];
  },

  resolveConflict(partnerId: string, conflictId: string): any {
    requirePid(partnerId);
    ensureLawTables();
    const row = rawDb().prepare(`SELECT * FROM mf_law_conflict WHERE id = ? AND partner_id = ?`).get(conflictId, partnerId) as any;
    if (!row) throw new GateError("CONFLICT_NOT_FOUND");
    rawDb().prepare(`UPDATE mf_law_conflict SET status = 'resolved', resolved_at = ? WHERE id = ? AND partner_id = ?`)
      .run(new Date().toISOString(), conflictId, partnerId);
    return rawDb().prepare(`SELECT * FROM mf_law_conflict WHERE id = ?`).get(conflictId);
  },
};

export function hydrateMfcrmLawStore(): void {
  ensureLawTables();
}
