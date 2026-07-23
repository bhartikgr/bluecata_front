/**
 * W-MFCRM — Managed Founder CRM additive schema (12 tables).
 *
 * DESIGN (rev3, CAPAVATE_ITEM5_MFCRM_BUILD_DOC §4): the Managed Founder CRM is
 * a lineage-merge engine layered ON TOP of the existing CRM stores. It owns ONLY
 * the genuinely-new `mf_*` tables below; CRM-row persistence is delegated to the
 * non-sacred `partnerClientCrmStore` (Partner/General CRM) and `founderCrmStore`
 * (Founder CRM on graduation). No existing table is altered. All money still
 * flows through the sacred `commitFunded` ledger — none of these tables is a
 * parallel money ledger.
 *
 * Every partner-scoped table carries `partner_id` (the isolation spine — always
 * resolved from the signed session, never the URL) and `company_id` where a
 * company is in scope, with an index on both. `applyMfcrmSchema()` is idempotent
 * (CREATE TABLE / INDEX IF NOT EXISTS) and safe to call at every boot, mirroring
 * the connection.ts DDL block and the kycDocumentStore ensureTable() convention.
 */
import { rawDb } from "../db/connection";
import { log } from "./logger";

let applied = false;

/**
 * Create the 12 additive MFCRM tables (idempotent). Called at boot before the
 * MFCRM RAM projections hydrate, and defensively re-callable at any time.
 */
export function applyMfcrmSchema(): void {
  if (applied) return;
  const db: any = rawDb();
  const stmts: string[] = [
    /* 1) mf_capability_profile — per-partner capability toggles (DB-driven SoT,
       RF-10). `classified=0` = the fail-closed most-restrictive default. */
    `CREATE TABLE IF NOT EXISTS mf_capability_profile (
      partner_id           TEXT PRIMARY KEY NOT NULL,
      partner_type         TEXT,
      classified           INTEGER NOT NULL DEFAULT 0,
      sources_capital      INTEGER NOT NULL DEFAULT 0,
      delegated_agency     INTEGER NOT NULL DEFAULT 0,
      spv_write_authority  INTEGER NOT NULL DEFAULT 0,
      advisory_coseat      INTEGER NOT NULL DEFAULT 0,
      document_custody     INTEGER NOT NULL DEFAULT 0,
      pays_on_behalf       INTEGER NOT NULL DEFAULT 0,
      attribution_tracking INTEGER NOT NULL DEFAULT 0,
      collective_fronting  INTEGER NOT NULL DEFAULT 0,
      chapter_scoping      INTEGER NOT NULL DEFAULT 0,
      fund_admin           INTEGER NOT NULL DEFAULT 0,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL,
      updated_by           TEXT
    );`,

    /* 2) mf_engagement — one row per managed founder/company engagement. `mode`
       is the PER-ENGAGEMENT authority grant ('A' delegated / 'B' co-seat).
       Persona-specific scoping columns (chapter_id, matter_id) are additive on
       the SAME model so downstream waves never fork the engagement table. */
    `CREATE TABLE IF NOT EXISTS mf_engagement (
      id                     TEXT PRIMARY KEY NOT NULL,
      partner_id             TEXT NOT NULL,
      company_id             TEXT NOT NULL,
      mode                   TEXT NOT NULL DEFAULT 'B',
      status                 TEXT NOT NULL DEFAULT 'ACTIVE',
      authority_artifact_ref TEXT,
      authority_expires_at   TEXT,
      trial_expires_at       TEXT,
      chapter_id             TEXT,
      matter_id              TEXT,
      sources_capital_at_create INTEGER,
      created_by             TEXT,
      created_at             TEXT NOT NULL,
      updated_at             TEXT NOT NULL,
      UNIQUE (partner_id, company_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_engagement_partner ON mf_engagement(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_engagement_company ON mf_engagement(partner_id, company_id);`,

    /* 3) mf_engagement_event — engagement lifecycle audit. */
    `CREATE TABLE IF NOT EXISTS mf_engagement_event (
      id            TEXT PRIMARY KEY NOT NULL,
      partner_id    TEXT NOT NULL,
      engagement_id TEXT NOT NULL,
      company_id    TEXT NOT NULL,
      event_type    TEXT NOT NULL,
      detail_json   TEXT,
      actor         TEXT,
      created_at    TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_engagement_event_partner ON mf_engagement_event(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_engagement_event_eng ON mf_engagement_event(engagement_id);`,

    /* 4) mf_attribution — first-touch (capital) / firm-of-record (service). */
    `CREATE TABLE IF NOT EXISTS mf_attribution (
      id               TEXT PRIMARY KEY NOT NULL,
      partner_id       TEXT NOT NULL,
      company_id       TEXT NOT NULL,
      engagement_id    TEXT,
      attribution_type TEXT NOT NULL,
      sources_capital  INTEGER NOT NULL DEFAULT 0,
      first_touch_at   TEXT,
      actor            TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_attribution_partner ON mf_attribution(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_attribution_company ON mf_attribution(partner_id, company_id);`,

    /* 5) mf_attribution_tail — renewing 12-month tail windows per deal. */
    `CREATE TABLE IF NOT EXISTS mf_attribution_tail (
      id             TEXT PRIMARY KEY NOT NULL,
      partner_id     TEXT NOT NULL,
      company_id     TEXT NOT NULL,
      attribution_id TEXT NOT NULL,
      deal_id        TEXT,
      tail_start     TEXT NOT NULL,
      tail_end       TEXT NOT NULL,
      renewed_at     TEXT,
      created_at     TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_attribution_tail_partner ON mf_attribution_tail(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_attribution_tail_company ON mf_attribution_tail(partner_id, company_id);`,

    /* 6) mf_crossover_flag — C1–C7 crossover events (flag, NEVER block). */
    `CREATE TABLE IF NOT EXISTS mf_crossover_flag (
      id          TEXT PRIMARY KEY NOT NULL,
      partner_id  TEXT NOT NULL,
      company_id  TEXT NOT NULL,
      flag_code   TEXT NOT NULL,
      detail_json TEXT,
      status      TEXT NOT NULL DEFAULT 'open',
      created_at  TEXT NOT NULL,
      resolved_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_crossover_partner ON mf_crossover_flag(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_crossover_company ON mf_crossover_flag(partner_id, company_id);`,

    /* 7) mf_handover — hand-over lifecycle (initiate → confirm; admin override). */
    `CREATE TABLE IF NOT EXISTS mf_handover (
      id                     TEXT PRIMARY KEY NOT NULL,
      partner_id             TEXT NOT NULL,
      engagement_id          TEXT NOT NULL,
      company_id             TEXT NOT NULL,
      direction              TEXT NOT NULL,
      initiator_party        TEXT NOT NULL,
      initiated_by           TEXT,
      status                 TEXT NOT NULL DEFAULT 'initiated',
      authority_artifact_ref TEXT,
      authority_expires_at   TEXT,
      created_at             TEXT NOT NULL,
      confirmed_at           TEXT,
      confirmed_by           TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_handover_partner ON mf_handover(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_handover_eng ON mf_handover(engagement_id);`,

    /* 8) mf_pricing_trial — Mode-A trial/expiry (90d default, RF-5). */
    `CREATE TABLE IF NOT EXISTS mf_pricing_trial (
      id               TEXT PRIMARY KEY NOT NULL,
      partner_id       TEXT NOT NULL,
      engagement_id    TEXT NOT NULL,
      company_id       TEXT NOT NULL,
      plan             TEXT,
      trial_start      TEXT NOT NULL,
      trial_expires_at TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'active',
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_pricing_trial_partner ON mf_pricing_trial(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_pricing_trial_eng ON mf_pricing_trial(engagement_id);`,

    /* 9) mf_spv_on_behalf — links an SPV to its acting-on-behalf engagement +
       agent record. prev_hash/curr_hash anchor the on-behalf audit chain
       (computed + written INSIDE the sync tx; §3.3). */
    `CREATE TABLE IF NOT EXISTS mf_spv_on_behalf (
      id                     TEXT PRIMARY KEY NOT NULL,
      partner_id             TEXT NOT NULL,
      engagement_id          TEXT NOT NULL,
      company_id             TEXT NOT NULL,
      spv_id                 TEXT NOT NULL,
      round_id               TEXT,
      acting_on_behalf_of    TEXT NOT NULL,
      agent_user_id          TEXT,
      authority_artifact_ref TEXT,
      prev_hash              TEXT,
      curr_hash              TEXT,
      created_at             TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_spv_on_behalf_partner ON mf_spv_on_behalf(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_spv_on_behalf_company ON mf_spv_on_behalf(partner_id, company_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_spv_on_behalf_spv ON mf_spv_on_behalf(spv_id);`,

    /* 10) mf_collective_push — bulk/queued Collective application state. The
       async push runs AFTER the sync tx commits; failures leave a durable
       'queued'/'failed' row that is retried (never a half-committed money state). */
    `CREATE TABLE IF NOT EXISTS mf_collective_push (
      id            TEXT PRIMARY KEY NOT NULL,
      partner_id    TEXT NOT NULL,
      engagement_id TEXT NOT NULL,
      company_id    TEXT NOT NULL,
      spv_id        TEXT,
      round_id      TEXT,
      status        TEXT NOT NULL DEFAULT 'queued',
      attempts      INTEGER NOT NULL DEFAULT 0,
      last_error    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      pushed_at     TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_collective_push_partner ON mf_collective_push(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_collective_push_status ON mf_collective_push(status);`,

    /* 11) mf_layer_membership — which CRM layer a contact currently occupies. */
    `CREATE TABLE IF NOT EXISTS mf_layer_membership (
      id            TEXT PRIMARY KEY NOT NULL,
      partner_id    TEXT NOT NULL,
      company_id    TEXT NOT NULL,
      contact_ref   TEXT NOT NULL,
      layer         TEXT NOT NULL,
      engagement_id TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      UNIQUE (partner_id, company_id, contact_ref)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_layer_membership_partner ON mf_layer_membership(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_layer_membership_company ON mf_layer_membership(partner_id, company_id);`,

    /* 12) mf_audit — acting-on-behalf agent/principal audit trail (RF-4). */
    `CREATE TABLE IF NOT EXISTS mf_audit (
      id              TEXT PRIMARY KEY NOT NULL,
      partner_id      TEXT NOT NULL,
      engagement_id   TEXT,
      company_id      TEXT,
      action          TEXT NOT NULL,
      agent_user_id   TEXT,
      principal_ref   TEXT,
      disclosure_json TEXT,
      created_at      TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_mf_audit_partner ON mf_audit(partner_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mf_audit_company ON mf_audit(partner_id, company_id);`,
  ];

  try {
    for (const sql of stmts) db.exec(sql);
    applied = true;
    log.info?.("[mfcrmSchema] applied 12 MFCRM tables (idempotent)");
  } catch (err) {
    // Match the fail-soft DDL convention (kycDocumentStore): a table that
    // already exists / a benign race must never crash boot. A genuine write
    // failure surfaces later fail-closed at the store's strict-persist layer.
    log.warn("[mfcrmSchema] applyMfcrmSchema failed (non-fatal):", (err as Error).message);
    applied = true;
  }
}

/** Test-only: allow a fresh apply (e.g. after an in-memory DB reset). */
export function _resetMfcrmSchemaGuardForTests(): void {
  applied = false;
}
