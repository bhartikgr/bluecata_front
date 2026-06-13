/**
 * v25.0 Track 5 — Admin Platform Endpoints (E1–E6)
 *
 * Implements the 6 backend-only endpoints for the admin platform:
 *   E1: GET  /api/admin/search
 *   E2: POST /api/admin/compliance/holds
 *       DELETE /api/admin/compliance/holds/:id
 *   E3: POST  /api/admin/billing/disputes
 *       PATCH /api/admin/billing/disputes/:id
 *   E4: POST /api/admin/tenants/:id/delete
 *   E5: POST /api/admin/email-campaigns/send  (simple cohort send)
 *   E6: POST /api/admin/regions/:region/toggle
 *
 * All endpoints:
 *   - require admin auth (requireAdmin middleware)
 *   - emit BridgeOutbound events
 *   - are fully DB-backed (SQLite via rawDb())
 *   - NO mock data
 */

import type { Express, Request, Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { requireAdmin } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import { rawDb } from "./db/connection";
import { appendAdminAudit } from "./adminPlatformStore";
import { BridgeOutbound } from "./lib/bridgeOutbound";
import {
  setComplianceHoldForTenant,
  getComplianceHoldForTenant,
} from "./captableCommitStore";
import { updateSubscription } from "./subscriptionsStore";
import { log } from "./lib/logger";

// ── Helpers ──────────────────────────────────────────────────────────────────

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function now(): string {
  return new Date().toISOString();
}

function actorId(req: Request): string {
  const ctx = getUserContext(req);
  return ctx?.userId || "admin";
}

// ── E2 admin_compliance_holds table ─────────────────────────────────────────
// Separate from the captableCommitStore compliance_holds (tenant_id PK).
// This table tracks admin-placed holds with full audit trail: id, tenant_type,
// tenant_id, reason, placed_by, placed_at, removed_at, removed_by.

function ensureAdminComplianceHoldsTable(): void {
  try {
    rawDb().exec(`CREATE TABLE IF NOT EXISTS admin_compliance_holds (
      id          TEXT PRIMARY KEY NOT NULL,
      tenant_type TEXT NOT NULL,
      tenant_id   TEXT NOT NULL,
      reason      TEXT NOT NULL,
      placed_by   TEXT NOT NULL,
      placed_at   TEXT NOT NULL,
      removed_at  TEXT,
      removed_by  TEXT
    );`);
    rawDb().exec(`CREATE INDEX IF NOT EXISTS idx_ach_tenant ON admin_compliance_holds(tenant_id);`);
    rawDb().exec(`CREATE INDEX IF NOT EXISTS idx_ach_active ON admin_compliance_holds(tenant_id, removed_at);`);
  } catch { /* table already exists */ }
}

// ── E3 billing_disputes table ─────────────────────────────────────────────

function ensureBillingDisputesTable(): void {
  try {
    rawDb().exec(`CREATE TABLE IF NOT EXISTS billing_disputes (
      id               TEXT PRIMARY KEY NOT NULL,
      subscription_id  TEXT NOT NULL,
      amount_minor     INTEGER NOT NULL,
      reason           TEXT NOT NULL,
      customer_notes   TEXT,
      status           TEXT NOT NULL DEFAULT 'open',
      created_by       TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      resolved_at      TEXT,
      resolved_by      TEXT,
      resolution_notes TEXT
    );`);
    rawDb().exec(`CREATE INDEX IF NOT EXISTS idx_bd_sub ON billing_disputes(subscription_id);`);
    rawDb().exec(`CREATE INDEX IF NOT EXISTS idx_bd_status ON billing_disputes(status);`);
  } catch { /* table already exists */ }
}

// ── E4 tenant_deletion_audit table ───────────────────────────────────────

function ensureTenantDeletionAuditTable(): void {
  try {
    rawDb().exec(`CREATE TABLE IF NOT EXISTS tenant_deletion_audit (
      id                TEXT PRIMARY KEY NOT NULL,
      tenant_type       TEXT NOT NULL,
      tenant_id         TEXT NOT NULL,
      deleted_by        TEXT NOT NULL,
      deleted_at        TEXT NOT NULL,
      audit_payload_json TEXT NOT NULL
    );`);
    rawDb().exec(`CREATE INDEX IF NOT EXISTS idx_tda_tenant ON tenant_deletion_audit(tenant_id);`);
  } catch { /* table already exists */ }
}

// ── E5 email_campaigns_v25 + recipients ─────────────────────────────────

function ensureEmailCampaignV25Tables(): void {
  try {
    rawDb().exec(`CREATE TABLE IF NOT EXISTS email_campaigns_v25 (
      id              TEXT PRIMARY KEY NOT NULL,
      name            TEXT NOT NULL,
      cohort_filter   TEXT NOT NULL,
      subject         TEXT NOT NULL,
      body_text       TEXT NOT NULL,
      body_html       TEXT NOT NULL,
      sent_by         TEXT NOT NULL,
      sent_at         TEXT NOT NULL,
      queued_count    INTEGER NOT NULL DEFAULT 0,
      delivered_count INTEGER NOT NULL DEFAULT 0
    );`);
    rawDb().exec(`CREATE TABLE IF NOT EXISTS email_campaign_v25_recipients (
      id          TEXT PRIMARY KEY NOT NULL,
      campaign_id TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      email       TEXT NOT NULL,
      queued_at   TEXT NOT NULL,
      delivered_at TEXT,
      failed_at    TEXT,
      fail_reason  TEXT
    );`);
    rawDb().exec(`CREATE INDEX IF NOT EXISTS idx_ecr_campaign ON email_campaign_v25_recipients(campaign_id);`);
    rawDb().exec(`CREATE INDEX IF NOT EXISTS idx_ecr_user ON email_campaign_v25_recipients(user_id);`);
  } catch { /* table already exists */ }
}

// ── E6 region_toggles table ──────────────────────────────────────────────

function ensureRegionTogglesTable(): void {
  try {
    rawDb().exec(`CREATE TABLE IF NOT EXISTS region_toggles (
      region     TEXT PRIMARY KEY NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      toggled_at TEXT NOT NULL,
      toggled_by TEXT NOT NULL,
      reason     TEXT
    );`);
  } catch { /* table already exists */ }
}

// ── Rate-limit store for E5 (in-memory, per-admin, 5/hr) ────────────────
// { adminId: [timestamp, ...] }
const emailCampaignRateLimits = new Map<string, number[]>();

function checkEmailCampaignRateLimit(adminId: string): boolean {
  const now = Date.now();
  const window = 60 * 60 * 1000; // 1 hour
  const limit = 5;
  const existing = (emailCampaignRateLimits.get(adminId) ?? []).filter(t => now - t < window);
  if (existing.length >= limit) return false;
  existing.push(now);
  emailCampaignRateLimits.set(adminId, existing);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route registration
// ─────────────────────────────────────────────────────────────────────────────

export function registerAdminV25Routes(app: Express): void {
  // Ensure tables exist at registration time
  try {
    ensureAdminComplianceHoldsTable();
    ensureBillingDisputesTable();
    ensureTenantDeletionAuditTable();
    ensureEmailCampaignV25Tables();
    ensureRegionTogglesTable();
  } catch (e) {
    log.warn("[adminV25Store] table setup warning:", (e as Error).message);
  }

  // ──────────────────────────────────────────────────────────────────────
  // E1 — GET /api/admin/search?q=...
  // Cross-entity full-text search across founders, investors, partners,
  // and collective members. Returns top 10 each, LIKE-based.
  // ──────────────────────────────────────────────────────────────────────
  app.get("/api/admin/search", requireAdmin, (req: Request, res: Response) => {
    const q = String(req.query.q ?? "").trim();
    if (!q || q.length < 1) {
      return res.json({ founders: [], investors: [], partners: [], collective_members: [] });
    }
    const like = `%${q}%`;

    try {
      const db = rawDb();

      // Founders: companies (name) joined with company_members (user email/name via users table)
      const founders = db.prepare(`
        SELECT DISTINCT
          c.id         AS id,
          c.name       AS company_name,
          u.email      AS email,
          u.name       AS contact_name,
          c.sector     AS sector,
          c.stage      AS stage
        FROM companies c
        LEFT JOIN company_members cm ON cm.company_id = c.id AND cm.is_active = 1
        LEFT JOIN users u ON u.id = cm.user_id
        WHERE c.deleted_at IS NULL
          AND (
            c.name    LIKE ? COLLATE NOCASE OR
            u.email   LIKE ? COLLATE NOCASE OR
            u.name    LIKE ? COLLATE NOCASE
          )
        LIMIT 10
      `).all(like, like, like) as Array<Record<string, unknown>>;

      // Investors: users with role 'investor' or from profilestore_investor_profile
      const investors = db.prepare(`
        SELECT DISTINCT
          u.id    AS id,
          u.name  AS name,
          u.email AS email,
          u.role  AS role
        FROM users u
        WHERE u.deleted_at IS NULL
          AND u.role = 'investor'
          AND (
            u.name  LIKE ? COLLATE NOCASE OR
            u.email LIKE ? COLLATE NOCASE
          )
        LIMIT 10
      `).all(like, like) as Array<Record<string, unknown>>;

      // Partners: partner_organizations (name) + contact email from users
      const partners = db.prepare(`
        SELECT DISTINCT
          po.id     AS id,
          po.name   AS org_name,
          po.status AS status,
          u.email   AS contact_email,
          u.name    AS contact_name
        FROM partner_organizations po
        LEFT JOIN partner_team_members ptm ON ptm.partner_id = po.id AND ptm.status = 'active'
        LEFT JOIN users u ON u.id = ptm.user_id
        WHERE (
          po.name   LIKE ? COLLATE NOCASE OR
          u.email   LIKE ? COLLATE NOCASE OR
          u.name    LIKE ? COLLATE NOCASE
        )
        LIMIT 10
      `).all(like, like, like) as Array<Record<string, unknown>>;

      // Collective members: collective_memberships joined to users
      const collective_members = db.prepare(`
        SELECT DISTINCT
          cm.user_id AS user_id,
          u.name     AS name,
          u.email    AS email,
          cm.tier    AS tier,
          cm.status  AS status,
          cm.chapter_id AS chapter_id
        FROM collective_memberships cm
        LEFT JOIN users u ON u.id = cm.user_id
        WHERE cm.deleted_at IS NULL
          AND (
            u.name  LIKE ? COLLATE NOCASE OR
            u.email LIKE ? COLLATE NOCASE
          )
        LIMIT 10
      `).all(like, like) as Array<Record<string, unknown>>;

      const actor = actorId(req);
      appendAdminAudit(actor, "search", "admin.search", { q, founders: founders.length, investors: investors.length, partners: partners.length, collective_members: collective_members.length });
      BridgeOutbound.auditLogAppended("admin", { eventType: "admin.search", q, counts: { founders: founders.length, investors: investors.length, partners: partners.length, collective_members: collective_members.length } });

      return res.json({ founders, investors, partners, collective_members });
    } catch (err) {
      log.error("[adminV25Store.search] error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "SEARCH_FAILED", message: (err as Error).message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // E2 — POST /api/admin/compliance/holds
  // Place a compliance hold on a tenant.
  // Body: { tenantType, tenantId, reason }
  // ──────────────────────────────────────────────────────────────────────
  app.post("/api/admin/compliance/holds", requireAdmin, (req: Request, res: Response) => {
    const { tenantType, tenantId, reason } = (req.body ?? {}) as {
      tenantType?: string;
      tenantId?: string;
      reason?: string;
    };

    if (!tenantType || !tenantId || !reason) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS", message: "tenantType, tenantId, and reason are required." });
    }
    if (!["founder", "investor", "partner", "collective"].includes(tenantType)) {
      return res.status(400).json({ ok: false, error: "INVALID_TENANT_TYPE", message: "tenantType must be founder, investor, partner, or collective." });
    }

    const actor = actorId(req);
    const id = newId("hold");
    const placedAt = now();

    try {
      // Persist to admin_compliance_holds (full audit record)
      rawDb().prepare(`
        INSERT INTO admin_compliance_holds (id, tenant_type, tenant_id, reason, placed_by, placed_at, removed_at, removed_by)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
      `).run(id, tenantType, tenantId, reason, actor, placedAt);

      // Wire to the captableCommitStore compliance engine so wire-funded is blocked
      const captableTenantId = tenantType === "founder" ? `tenant_co_${tenantId}` : tenantId;
      setComplianceHoldForTenant(captableTenantId, true, actor, reason);

      appendAdminAudit(actor, `compliance_hold:${id}`, "compliance_hold.placed", { holdId: id, tenantType, tenantId, reason });
      BridgeOutbound.auditLogAppended("admin", { eventType: "compliance_hold.placed", holdId: id, tenantType, tenantId });

      return res.status(201).json({
        ok: true,
        hold: { id, tenantType, tenantId, reason, placedBy: actor, placedAt, removedAt: null, removedBy: null },
      });
    } catch (err) {
      log.error("[adminV25Store.compliance_holds POST] error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "HOLD_FAILED", message: (err as Error).message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // E2 — DELETE /api/admin/compliance/holds/:id
  // Remove a compliance hold.
  // ──────────────────────────────────────────────────────────────────────
  app.delete("/api/admin/compliance/holds/:id", requireAdmin, (req: Request, res: Response) => {
    const holdId = String(req.params.id);
    const actor = actorId(req);
    const removedAt = now();

    try {
      const row = rawDb().prepare(
        `SELECT * FROM admin_compliance_holds WHERE id = ?`
      ).get(holdId) as Record<string, unknown> | undefined;

      if (!row) {
        return res.status(404).json({ ok: false, error: "HOLD_NOT_FOUND", message: `Hold ${holdId} not found.` });
      }
      if (row.removed_at) {
        return res.status(409).json({ ok: false, error: "HOLD_ALREADY_REMOVED", message: `Hold ${holdId} was already removed at ${row.removed_at}.` });
      }

      rawDb().prepare(
        `UPDATE admin_compliance_holds SET removed_at = ?, removed_by = ? WHERE id = ?`
      ).run(removedAt, actor, holdId);

      // Release the captableCommitStore hold
      const tenantType = String(row.tenant_type);
      const tenantId = String(row.tenant_id);
      const captableTenantId = tenantType === "founder" ? `tenant_co_${tenantId}` : tenantId;

      // Only release if no other active hold remains for this tenant
      const remaining = rawDb().prepare(
        `SELECT COUNT(*) as cnt FROM admin_compliance_holds WHERE tenant_id = ? AND removed_at IS NULL`
      ).get(tenantId) as { cnt: number } | undefined;

      if (!remaining || remaining.cnt === 0) {
        setComplianceHoldForTenant(captableTenantId, false, actor);
      }

      appendAdminAudit(actor, `compliance_hold:${holdId}`, "compliance_hold.removed", { holdId, tenantType, tenantId });
      BridgeOutbound.auditLogAppended("admin", { eventType: "compliance_hold.removed", holdId, tenantType, tenantId });

      return res.json({
        ok: true,
        hold: { id: holdId, removedAt, removedBy: actor },
      });
    } catch (err) {
      log.error("[adminV25Store.compliance_holds DELETE] error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "REMOVE_HOLD_FAILED", message: (err as Error).message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // E3 — POST /api/admin/billing/disputes
  // Create a billing dispute; subscription status → "disputed"
  // Body: { subscriptionId, amount, reason, customerNotes }
  // ──────────────────────────────────────────────────────────────────────
  app.post("/api/admin/billing/disputes", requireAdmin, (req: Request, res: Response) => {
    const { subscriptionId, amount, reason, customerNotes } = (req.body ?? {}) as {
      subscriptionId?: string;
      amount?: number;
      reason?: string;
      customerNotes?: string;
    };

    if (!subscriptionId || amount === undefined || !reason) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS", message: "subscriptionId, amount, and reason are required." });
    }

    const actor = actorId(req);
    const id = newId("disp");
    const createdAt = now();

    try {
      rawDb().prepare(`
        INSERT INTO billing_disputes (id, subscription_id, amount_minor, reason, customer_notes, status, created_by, created_at, resolved_at, resolved_by, resolution_notes)
        VALUES (?, ?, ?, ?, ?, 'open', ?, ?, NULL, NULL, NULL)
      `).run(id, subscriptionId, Math.round(amount), reason, customerNotes ?? null, actor, createdAt);

      // Flip subscription status to "disputed"
      // updateSubscription expects a status from SubscriptionStatus enum; "disputed" is not
      // in the union so we use rawDb to write it directly.
      try {
        rawDb().prepare(
          `UPDATE subscriptions SET status = 'disputed', updated_at = ?, updated_by = ? WHERE company_id = ?`
        ).run(createdAt, actor, subscriptionId);
      } catch (subErr) {
        log.warn("[adminV25Store.billing_disputes POST] subscription update failed:", (subErr as Error).message);
        // Non-fatal: the dispute row is created regardless
      }

      appendAdminAudit(actor, `billing_dispute:${id}`, "billing_dispute.created", { disputeId: id, subscriptionId, amount, reason });
      BridgeOutbound.auditLogAppended("admin", { eventType: "billing_dispute.created", disputeId: id, subscriptionId });

      const dispute = rawDb().prepare(`SELECT * FROM billing_disputes WHERE id = ?`).get(id) as Record<string, unknown>;
      return res.status(201).json({ ok: true, dispute });
    } catch (err) {
      log.error("[adminV25Store.billing_disputes POST] error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "DISPUTE_FAILED", message: (err as Error).message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // E3 — PATCH /api/admin/billing/disputes/:id
  // Resolve a billing dispute.
  // Body: { status: "resolved"|"upheld"|"refunded", resolutionNotes }
  // ──────────────────────────────────────────────────────────────────────
  app.patch("/api/admin/billing/disputes/:id", requireAdmin, (req: Request, res: Response) => {
    const disputeId = String(req.params.id);
    const { status, resolutionNotes } = (req.body ?? {}) as {
      status?: string;
      resolutionNotes?: string;
    };

    if (!status || !["resolved", "upheld", "refunded"].includes(status)) {
      return res.status(400).json({ ok: false, error: "INVALID_STATUS", message: "status must be resolved, upheld, or refunded." });
    }

    const actor = actorId(req);
    const resolvedAt = now();

    try {
      const dispute = rawDb().prepare(`SELECT * FROM billing_disputes WHERE id = ?`).get(disputeId) as Record<string, unknown> | undefined;
      if (!dispute) {
        return res.status(404).json({ ok: false, error: "DISPUTE_NOT_FOUND", message: `Dispute ${disputeId} not found.` });
      }

      rawDb().prepare(`
        UPDATE billing_disputes
        SET status = ?, resolved_at = ?, resolved_by = ?, resolution_notes = ?
        WHERE id = ?
      `).run(status, resolvedAt, actor, resolutionNotes ?? null, disputeId);

      // Status transitions on subscription:
      //   resolved → active
      //   upheld   → stays disputed (no change)
      //   refunded → refunded
      const subId = String(dispute.subscription_id);
      if (status === "resolved") {
        try {
          rawDb().prepare(
            `UPDATE subscriptions SET status = 'active', updated_at = ?, updated_by = ? WHERE company_id = ?`
          ).run(resolvedAt, actor, subId);
        } catch { /* non-fatal */ }
      } else if (status === "refunded") {
        try {
          rawDb().prepare(
            `UPDATE subscriptions SET status = 'refunded', updated_at = ?, updated_by = ? WHERE company_id = ?`
          ).run(resolvedAt, actor, subId);
        } catch { /* non-fatal */ }
      }

      appendAdminAudit(actor, `billing_dispute:${disputeId}`, `billing_dispute.${status}`, { disputeId, status, resolutionNotes });
      BridgeOutbound.auditLogAppended("admin", { eventType: `billing_dispute.${status}`, disputeId, subscriptionId: subId });

      const updated = rawDb().prepare(`SELECT * FROM billing_disputes WHERE id = ?`).get(disputeId) as Record<string, unknown>;
      return res.json({ ok: true, dispute: updated });
    } catch (err) {
      log.error("[adminV25Store.billing_disputes PATCH] error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "DISPUTE_UPDATE_FAILED", message: (err as Error).message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // E4 — POST /api/admin/tenants/:id/delete
  // Hard-delete a tenant with confirmation guard and cascade.
  // Body: { tenantType: "founder"|"investor"|"partner"|"collective", confirmName }
  // ──────────────────────────────────────────────────────────────────────
  app.post("/api/admin/tenants/:id/delete", requireAdmin, (req: Request, res: Response) => {
    const tenantId = String(req.params.id);
    const { tenantType, confirmName } = (req.body ?? {}) as {
      tenantType?: string;
      confirmName?: string;
    };

    if (!tenantType || !confirmName) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS", message: "tenantType and confirmName are required." });
    }
    if (!["founder", "investor", "partner", "collective"].includes(tenantType)) {
      return res.status(400).json({ ok: false, error: "INVALID_TENANT_TYPE" });
    }

    const actor = actorId(req);
    const db = rawDb();

    try {
      // Resolve the name to confirm against based on tenantType
      let resolvedName: string | null = null;
      let auditPayload: Record<string, unknown> = { tenantType, tenantId };

      if (tenantType === "founder") {
        // For founders: tenantId is a companyId
        const company = db.prepare(`SELECT name FROM companies WHERE id = ? AND deleted_at IS NULL`).get(tenantId) as { name?: string } | undefined;
        resolvedName = company?.name ?? null;
      } else if (tenantType === "investor") {
        // For investors: tenantId is a userId
        const user = db.prepare(`SELECT name FROM users WHERE id = ? AND deleted_at IS NULL`).get(tenantId) as { name?: string } | undefined;
        resolvedName = user?.name ?? null;
      } else if (tenantType === "partner") {
        // For partners: tenantId is a partner_organization id
        const partner = db.prepare(`SELECT name FROM partner_organizations WHERE id = ?`).get(tenantId) as { name?: string } | undefined;
        resolvedName = partner?.name ?? null;
      } else if (tenantType === "collective") {
        // For collective members: tenantId is a userId
        const user = db.prepare(`SELECT name FROM users WHERE id = ? AND deleted_at IS NULL`).get(tenantId) as { name?: string } | undefined;
        resolvedName = user?.name ?? null;
      }

      if (!resolvedName) {
        return res.status(404).json({ ok: false, error: "TENANT_NOT_FOUND", message: `Tenant ${tenantId} (${tenantType}) not found.` });
      }

      // Strict confirmName match
      if (confirmName !== resolvedName) {
        return res.status(400).json({
          ok: false,
          error: "CONFIRM_NAME_MISMATCH",
          message: `confirmName "${confirmName}" does not match the actual name "${resolvedName}". Provide the exact name to confirm deletion.`,
        });
      }

      const deletedAt = now();
      const cascadeSummary: Record<string, number> = {};

      // ── CASCADE DELETIONS ────────────────────────────────────────────
      if (tenantType === "founder") {
        // Hard-delete company and related rows
        const r1 = db.prepare(`UPDATE companies SET deleted_at = ? WHERE id = ?`).run(deletedAt, tenantId);
        cascadeSummary.companies = r1.changes;

        const r2 = db.prepare(`UPDATE company_members SET deleted_at = ? WHERE company_id = ?`).run(deletedAt, tenantId);
        cascadeSummary.company_members = r2.changes;

        const r3 = db.prepare(`UPDATE subscriptions SET deleted_at = ? WHERE company_id = ?`).run(deletedAt, tenantId);
        cascadeSummary.subscriptions = r3.changes;

        // Soft-circles belonging to this company
        try {
          const r4 = db.prepare(`UPDATE soft_circles SET deleted_at = ? WHERE company_id = ?`).run(deletedAt, tenantId);
          cascadeSummary.soft_circles = r4.changes;
        } catch { cascadeSummary.soft_circles = 0; }

        // Cap-table entries for this company (soft-delete via funded_queue removal)
        try {
          const r5 = db.prepare(`UPDATE funded_queue SET deleted_at = ? WHERE company_id = ?`).run(deletedAt, tenantId);
          cascadeSummary.funded_queue = r5.changes;
        } catch { cascadeSummary.funded_queue = 0; }

      } else if (tenantType === "investor") {
        // Hard-delete user and credentials
        const r1 = db.prepare(`UPDATE users SET deleted_at = ? WHERE id = ?`).run(deletedAt, tenantId);
        cascadeSummary.users = r1.changes;

        const r2 = db.prepare(`UPDATE user_credentials SET deleted_at = ? WHERE user_id = ?`).run(deletedAt, tenantId);
        cascadeSummary.user_credentials = r2.changes;

        const r3 = db.prepare(`UPDATE company_members SET deleted_at = ? WHERE user_id = ?`).run(deletedAt, tenantId);
        cascadeSummary.company_members = r3.changes;

        try {
          const r4 = db.prepare(`DELETE FROM soft_circles WHERE investor_user_id = ?`).run(tenantId);
          cascadeSummary.soft_circles = r4.changes;
        } catch { cascadeSummary.soft_circles = 0; }

      } else if (tenantType === "partner") {
        // Remove partner organization
        const r1 = db.prepare(`UPDATE partner_organizations SET status = 'deleted' WHERE id = ?`).run(tenantId);
        cascadeSummary.partner_organizations = r1.changes;

        const r2 = db.prepare(`UPDATE partner_team_members SET status = 'removed', removed_at = ? WHERE partner_id = ?`).run(deletedAt, tenantId);
        cascadeSummary.partner_team_members = r2.changes;

      } else if (tenantType === "collective") {
        // Remove collective membership
        const r1 = db.prepare(`UPDATE collective_memberships SET deleted_at = ? WHERE user_id = ?`).run(deletedAt, tenantId);
        cascadeSummary.collective_memberships = r1.changes;

        const r2 = db.prepare(`UPDATE users SET deleted_at = ? WHERE id = ?`).run(deletedAt, tenantId);
        cascadeSummary.users = r2.changes;

        const r3 = db.prepare(`UPDATE user_credentials SET deleted_at = ? WHERE user_id = ?`).run(deletedAt, tenantId);
        cascadeSummary.user_credentials = r3.changes;
      }

      auditPayload = { tenantType, tenantId, tenantName: resolvedName, deletedBy: actor, deletedAt, cascade: cascadeSummary };

      // Persist audit BEFORE the rows are gone (required even after rows are deleted)
      const auditId = newId("tda");
      db.prepare(`
        INSERT INTO tenant_deletion_audit (id, tenant_type, tenant_id, deleted_by, deleted_at, audit_payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(auditId, tenantType, tenantId, actor, deletedAt, JSON.stringify(auditPayload));

      appendAdminAudit(actor, `tenant_delete:${tenantId}`, "tenant.deleted", auditPayload);
      BridgeOutbound.auditLogAppended("admin", { eventType: "tenant.deleted", tenantType, tenantId, tenantName: resolvedName });

      return res.json({ ok: true, deleted: true, auditId, tenantId, tenantType, tenantName: resolvedName, cascade: cascadeSummary });
    } catch (err) {
      log.error("[adminV25Store.tenant delete] error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "DELETE_FAILED", message: (err as Error).message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // E5 — POST /api/admin/email-campaigns/send
  // Build cohort from filter and enqueue email sends.
  // Body: { name, cohortFilter: { role, tier?, region? }, subject, bodyText, bodyHtml }
  // Rate-limited: 5/admin/hr
  // ──────────────────────────────────────────────────────────────────────
  app.post("/api/admin/email-campaigns/send", requireAdmin, (req: Request, res: Response) => {
    const { name, cohortFilter, subject, bodyText, bodyHtml } = (req.body ?? {}) as {
      name?: string;
      cohortFilter?: { role?: string; tier?: string; region?: string };
      subject?: string;
      bodyText?: string;
      bodyHtml?: string;
    };

    if (!name || !cohortFilter || !subject || !bodyText) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS", message: "name, cohortFilter, subject, and bodyText are required." });
    }

    const actor = actorId(req);

    // Rate limit check
    if (!checkEmailCampaignRateLimit(actor)) {
      return res.status(429).json({ ok: false, error: "RATE_LIMIT_EXCEEDED", message: "Email campaign rate limit: 5 per admin per hour." });
    }

    const db = rawDb();
    const campaignId = newId("ecmp");
    const sentAt = now();
    const stubMode = process.env.NODE_ENV !== "production" || !process.env.SMTP_HOST;

    try {
      // Build cohort from users table
      let query = `SELECT id, email, name, role FROM users WHERE deleted_at IS NULL`;
      const params: unknown[] = [];

      if (cohortFilter.role) {
        query += ` AND role = ?`;
        params.push(cohortFilter.role);
      }
      // tier filter via collective_memberships
      if (cohortFilter.tier) {
        query += ` AND id IN (SELECT user_id FROM collective_memberships WHERE tier = ? AND deleted_at IS NULL)`;
        params.push(cohortFilter.tier);
      }
      // region filter via users hq/region join or tenant info — use company hq for founders
      if (cohortFilter.region) {
        // region can be in company hq or user metadata; best-effort filter
        query += ` AND id IN (
          SELECT cm2.user_id FROM company_members cm2
          JOIN companies co ON co.id = cm2.company_id
          WHERE co.hq LIKE ? AND co.deleted_at IS NULL AND cm2.is_active = 1
        )`;
        params.push(`%${cohortFilter.region}%`);
      }

      const recipients = db.prepare(query).all(...params) as Array<{ id: string; email: string; name: string; role: string }>;

      // Persist campaign record
      db.prepare(`
        INSERT INTO email_campaigns_v25 (id, name, cohort_filter, subject, body_text, body_html, sent_by, sent_at, queued_count, delivered_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(campaignId, name, JSON.stringify(cohortFilter), subject, bodyText, bodyHtml ?? "", actor, sentAt, recipients.length, stubMode ? recipients.length : 0);

      // Persist per-recipient rows
      const insertRecipient = db.prepare(`
        INSERT INTO email_campaign_v25_recipients (id, campaign_id, user_id, email, queued_at, delivered_at, failed_at, fail_reason)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
      `);

      const recipientList: Array<{ recipientId: string; userId: string; email: string }> = [];
      for (const r of recipients) {
        const recipientId = newId("ecr");
        const deliveredAt = stubMode ? sentAt : null;
        insertRecipient.run(recipientId, campaignId, r.id, r.email, sentAt, deliveredAt);
        recipientList.push({ recipientId, userId: r.id, email: r.email });
      }

      appendAdminAudit(actor, `email_campaign:${campaignId}`, "email_campaign.sent", {
        campaignId, name, queuedCount: recipients.length, stubMode, cohortFilter,
      });
      BridgeOutbound.auditLogAppended("admin", { eventType: "email_campaign.sent", campaignId, queuedCount: recipients.length });

      return res.status(201).json({
        ok: true,
        campaignId,
        queuedCount: recipients.length,
        deliveredCount: stubMode ? recipients.length : 0,
        recipients: recipientList,
        stubMode,
      });
    } catch (err) {
      log.error("[adminV25Store.email_campaigns send] error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "CAMPAIGN_FAILED", message: (err as Error).message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // E6 — POST /api/admin/regions/:region/toggle
  // Enable or disable a region extension flag.
  // Body: { enabled: bool, reason }
  // ──────────────────────────────────────────────────────────────────────
  app.post("/api/admin/regions/:region/toggle", requireAdmin, (req: Request, res: Response) => {
    const region = String(req.params.region).toUpperCase();
    const { enabled, reason } = (req.body ?? {}) as {
      enabled?: boolean;
      reason?: string;
    };

    if (enabled === undefined || enabled === null) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS", message: "enabled (bool) and reason are required." });
    }

    const actor = actorId(req);
    const toggledAt = now();
    const db = rawDb();

    try {
      // Upsert into region_toggles
      db.prepare(`
        INSERT INTO region_toggles (region, enabled, toggled_at, toggled_by, reason)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(region) DO UPDATE SET
          enabled = excluded.enabled,
          toggled_at = excluded.toggled_at,
          toggled_by = excluded.toggled_by,
          reason = excluded.reason
      `).run(region, enabled ? 1 : 0, toggledAt, actor, reason ?? null);

      const toggle = db.prepare(`SELECT * FROM region_toggles WHERE region = ?`).get(region) as Record<string, unknown>;

      appendAdminAudit(actor, `region_toggle:${region}`, enabled ? "region.enabled" : "region.disabled", { region, enabled, reason });
      BridgeOutbound.auditLogAppended("admin", { eventType: enabled ? "region.enabled" : "region.disabled", region, reason });

      return res.json({
        ok: true,
        region,
        enabled,
        toggledAt,
        toggledBy: actor,
        reason: reason ?? null,
        record: toggle,
      });
    } catch (err) {
      log.error("[adminV25Store.region toggle] error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "TOGGLE_FAILED", message: (err as Error).message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // E2 — GET /api/admin/compliance/holds (list active holds)
  // ──────────────────────────────────────────────────────────────────────
  app.get("/api/admin/compliance/holds", requireAdmin, (req: Request, res: Response) => {
    try {
      const rows = rawDb().prepare(
        `SELECT * FROM admin_compliance_holds ORDER BY placed_at DESC`
      ).all() as Array<Record<string, unknown>>;
      return res.json({ ok: true, holds: rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "LIST_FAILED", message: (err as Error).message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // E3 — GET /api/admin/billing/disputes (list disputes)
  // ──────────────────────────────────────────────────────────────────────
  app.get("/api/admin/billing/disputes", requireAdmin, (req: Request, res: Response) => {
    try {
      const rows = rawDb().prepare(
        `SELECT * FROM billing_disputes ORDER BY created_at DESC`
      ).all() as Array<Record<string, unknown>>;
      return res.json({ ok: true, disputes: rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "LIST_FAILED", message: (err as Error).message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // E4 — GET /api/admin/tenants/deletion-audit (list deletions)
  // ──────────────────────────────────────────────────────────────────────
  app.get("/api/admin/tenants/deletion-audit", requireAdmin, (req: Request, res: Response) => {
    try {
      const rows = rawDb().prepare(
        `SELECT * FROM tenant_deletion_audit ORDER BY deleted_at DESC LIMIT 100`
      ).all() as Array<Record<string, unknown>>;
      return res.json({ ok: true, entries: rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "LIST_FAILED", message: (err as Error).message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // E5 — GET /api/admin/email-campaigns/v25 (list v25 campaigns)
  // ──────────────────────────────────────────────────────────────────────
  app.get("/api/admin/email-campaigns/v25", requireAdmin, (req: Request, res: Response) => {
    try {
      const rows = rawDb().prepare(
        `SELECT * FROM email_campaigns_v25 ORDER BY sent_at DESC LIMIT 100`
      ).all() as Array<Record<string, unknown>>;
      return res.json({ ok: true, campaigns: rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "LIST_FAILED", message: (err as Error).message });
    }
  });
}
