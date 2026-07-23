/**
 * W-MFCRM persona — Accounting firm (fund-admin reporting, pays-on-behalf
 * rebill, document custody, firm-of-record attribution).
 *
 * ADDITIVE persona layer (design §7). Owns two additive tables:
 * `mf_acct_rebill` (pays-on-behalf expense → rebill ledger, NOT a money ledger —
 * it records an accounts-receivable intent, never a share/cash commit) and
 * `mf_acct_custody` (document custody register). Firm-of-record attribution is
 * delegated to `managedFounderStore.stampAttribution` (which selects the
 * firm-of-record path when `sources_capital=false`). Fund-admin reporting reads
 * the engine's engagements/attribution.
 *
 * FAIL-CLOSED: session-resolved `partnerId` only; each capability is gated
 * (paysOnBehalf / documentCustody / fundAdmin) against the DB-driven profile.
 * IMPORTANT: `mf_acct_rebill` is a REBILL/AR record, not a money path — real
 * money still flows ONLY through the sacred `commitFunded` ledger.
 */
import { randomUUID } from "crypto";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
import { managedFounderStore, GateError, type CapabilityKey } from "./managedFounderStore";

let ensured = false;

export function ensureAcctTables(): void {
  if (ensured) return;
  const db: any = rawDb();
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS mf_acct_rebill (
      id            TEXT PRIMARY KEY NOT NULL,
      partner_id    TEXT NOT NULL,
      engagement_id TEXT,
      company_id    TEXT NOT NULL,
      description   TEXT NOT NULL,
      amount_minor  INTEGER NOT NULL DEFAULT 0,
      currency      TEXT NOT NULL DEFAULT 'USD',
      status        TEXT NOT NULL DEFAULT 'pending',
      incurred_at   TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_acct_rebill_partner ON mf_acct_rebill(partner_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_acct_rebill_company ON mf_acct_rebill(partner_id, company_id);`);
    db.exec(`CREATE TABLE IF NOT EXISTS mf_acct_custody (
      id            TEXT PRIMARY KEY NOT NULL,
      partner_id    TEXT NOT NULL,
      engagement_id TEXT,
      company_id    TEXT NOT NULL,
      doc_ref       TEXT NOT NULL,
      doc_type      TEXT,
      status        TEXT NOT NULL DEFAULT 'held',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_acct_custody_partner ON mf_acct_custody(partner_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mf_acct_custody_company ON mf_acct_custody(partner_id, company_id);`);
    ensured = true;
    log.info?.("[mfcrmAcctStore] ensured mf_acct_rebill + mf_acct_custody");
  } catch (err) {
    log.warn("[mfcrmAcctStore] ensureAcctTables failed (non-fatal):", (err as Error).message);
    ensured = true;
  }
}

function requirePid(partnerId: string): void {
  if (!partnerId || typeof partnerId !== "string") throw new Error("PARTNER_ID_REQUIRED");
}

const GATE_CODE: Record<CapabilityKey, string> = {
  sourcesCapital: "SOURCES_CAPITAL_REQUIRED",
  delegatedAgency: "DELEGATED_AGENCY_REQUIRED",
  spvWriteAuthority: "SPV_WRITE_AUTHORITY_REQUIRED",
  advisoryCoseat: "ADVISORY_COSEAT_REQUIRED",
  documentCustody: "DOCUMENT_CUSTODY_REQUIRED",
  paysOnBehalf: "PAYS_ON_BEHALF_REQUIRED",
  attributionTracking: "ATTRIBUTION_TRACKING_REQUIRED",
  collectiveFronting: "COLLECTIVE_FRONTING_REQUIRED",
  chapterScoping: "CHAPTER_SCOPING_REQUIRED",
  fundAdmin: "FUND_ADMIN_REQUIRED",
};

function assertCapability(partnerId: string, key: CapabilityKey): void {
  const p = managedFounderStore.getCapabilityProfile(partnerId) as any;
  if (!p[key]) throw new GateError(GATE_CODE[key], `${key}=true is required.`);
}

export const mfcrmAcctStore = {
  /** Firm-of-record stamp — reuses the engine gate (sources_capital=false ⇒
   * firm_of_record, never investor first-touch). */
  stampFirmOfRecord(partnerId: string, data: { companyId: string; engagementId?: string | null }, actor: string): { id: string; attributionType: string } {
    requirePid(partnerId);
    return managedFounderStore.stampAttribution(partnerId, { companyId: data.companyId, engagementId: data.engagementId ?? null, attributionType: "firm_of_record" }, actor);
  },

  /** Record a pays-on-behalf expense to rebill (AR intent — NOT a money commit). */
  recordRebill(partnerId: string, data: { companyId: string; engagementId?: string | null; description: string; amountMinor: number; currency?: string; incurredAt?: string | null }, _actor: string): any {
    requirePid(partnerId);
    assertCapability(partnerId, "paysOnBehalf");
    ensureAcctTables();
    if (!data.companyId) throw new Error("COMPANY_ID_REQUIRED");
    if (!data.description || !data.description.trim()) throw new Error("DESCRIPTION_REQUIRED");
    const now = new Date().toISOString();
    const id = `mfrb_${randomUUID()}`;
    const amt = Number.isFinite(data.amountMinor) ? Math.trunc(data.amountMinor) : 0;
    rawDb().prepare(
      `INSERT INTO mf_acct_rebill (id, partner_id, engagement_id, company_id, description, amount_minor, currency, status, incurred_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(id, partnerId, data.engagementId ?? null, data.companyId, data.description.trim(), amt, data.currency ?? "USD", data.incurredAt ?? now, now, now);
    return this.getRebill(partnerId, id);
  },

  getRebill(partnerId: string, id: string): any | null {
    requirePid(partnerId);
    ensureAcctTables();
    return rawDb().prepare(`SELECT * FROM mf_acct_rebill WHERE id = ? AND partner_id = ?`).get(id, partnerId) ?? null;
  },

  listRebills(partnerId: string, companyId?: string): any[] {
    requirePid(partnerId);
    ensureAcctTables();
    if (companyId) return rawDb().prepare(`SELECT * FROM mf_acct_rebill WHERE partner_id = ? AND company_id = ? ORDER BY created_at DESC`).all(partnerId, companyId) as any[];
    return rawDb().prepare(`SELECT * FROM mf_acct_rebill WHERE partner_id = ? ORDER BY created_at DESC`).all(partnerId) as any[];
  },

  /** Register a document into custody. */
  addCustody(partnerId: string, data: { companyId: string; engagementId?: string | null; docRef: string; docType?: string | null }, _actor: string): any {
    requirePid(partnerId);
    assertCapability(partnerId, "documentCustody");
    ensureAcctTables();
    if (!data.companyId) throw new Error("COMPANY_ID_REQUIRED");
    if (!data.docRef || !data.docRef.trim()) throw new Error("DOC_REF_REQUIRED");
    const now = new Date().toISOString();
    const id = `mfdc_${randomUUID()}`;
    rawDb().prepare(
      `INSERT INTO mf_acct_custody (id, partner_id, engagement_id, company_id, doc_ref, doc_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'held', ?, ?)`,
    ).run(id, partnerId, data.engagementId ?? null, data.companyId, data.docRef.trim(), data.docType ?? null, now, now);
    return rawDb().prepare(`SELECT * FROM mf_acct_custody WHERE id = ? AND partner_id = ?`).get(id, partnerId) ?? null;
  },

  listCustody(partnerId: string, companyId?: string): any[] {
    requirePid(partnerId);
    ensureAcctTables();
    if (companyId) return rawDb().prepare(`SELECT * FROM mf_acct_custody WHERE partner_id = ? AND company_id = ? ORDER BY created_at DESC`).all(partnerId, companyId) as any[];
    return rawDb().prepare(`SELECT * FROM mf_acct_custody WHERE partner_id = ? ORDER BY created_at DESC`).all(partnerId) as any[];
  },

  /** Fund-admin reporting rollup (requires fund_admin capability). */
  fundAdminReport(partnerId: string): Record<string, unknown> {
    requirePid(partnerId);
    assertCapability(partnerId, "fundAdmin");
    ensureAcctTables();
    const engagements = managedFounderStore.listEngagements(partnerId);
    const rebills = this.listRebills(partnerId);
    const pendingMinor = rebills.filter((r: any) => r.status === "pending").reduce((s: number, r: any) => s + (r.amount_minor ?? 0), 0);
    return {
      engagements: engagements.length,
      activeEngagements: engagements.filter((e) => e.status === "ACTIVE").length,
      custodyDocs: this.listCustody(partnerId).length,
      rebills: { total: rebills.length, pendingAmountMinor: pendingMinor },
    };
  },
};

export function hydrateMfcrmAcctStore(): void {
  ensureAcctTables();
}
