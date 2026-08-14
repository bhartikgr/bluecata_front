/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * Admin CRUD for partner_fee_schedules (the fee catalogue) plus per-partner
 * overrides on contacts.fee_override_json / commission_override_pct. Every
 * read and write hits SQLite via rawDb(); nothing is cached in process memory.
 * All amounts/currencies/bands are supplied by the admin and stored in the DB
 * — there are NO hardcoded fee amounts here. Mounted under /api/admin (the
 * router-level requireAdmin gate in routes.ts protects every endpoint).
 */
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { rawDb } from "../db/connection";
import { appendAdminAudit } from "../adminPlatformStore";
import { partnerSpvStore } from "../partnerWorkspaceStore"; /* v25.41 Bug-3 — admin-side SPV creation reuses the existing store (no store changes). */
import { spvEngineStore } from "../spvEngineStore"; /* Blocker 1 (4D) — admin SPV create/read shim THROUGH the canonical engine so no SPV is ever created outside it. */
import { resolveSpvJurisdiction } from "../../shared/spvEngine"; /* WAVE 4A follow-up 2 */
import { sanitizeErrorMessage } from "./sanitize"; /* v25.33 — scrub raw err.message from the generic 500 path in prod (backlog item 33 extension). The UNIQUE-constraint 409 message is intentionally surfaced as safe admin feedback. */
/* GROUP C (C6) — fixed per-partner rev-share: query the paid, rev-share-enabled
 * partner-attributed companies and materialise idempotent partner_billing_entries
 * rows (settled via the EXISTING mark-paid endpoint). Auto-trigger deferred. */
import { listRevShareCandidates, materializeRevShareEntries } from "./partnerRevShare";
import { resolveEffectiveSeatLimit, type PartnerTier } from "../adminContactsStore"; /* W-V44 FIX R3 */
/* WAVE 45 (R3) — the tier default is a DB row now, not TIER_SEAT_LIMITS. */
import {
  resolveTierCapability,
  describeCapability,
  CAPABILITY_SEAT_LIMIT,
} from "./partnerTierCapabilityStore";
/* WAVE 16 / CP-BRG-07 — every fee write in THIS file is an input to
 * `buildFeeScheduleAggregate`, so each one publishes the invalidation frame the
 * partner Fee Schedule tab listens for. The frame carries only the revision;
 * prices are never put on the wire. Publishing is best-effort by construction
 * (the publisher swallows its own failures) so it can never fail a repricing. */
import { publishFeeScheduleChanged, publishFeeScheduleChangedForTier } from "./wave15FeeScheduleAggregate";

const FEE_KINDS = new Set([
  "subscription_monthly",
  "subscription_annual",
  "spv_deployment",
  "spv_management_per_lp_quarter",
  "spv_closing_bonus",
]);

function actorOf(req: Request): string {
  const ctx = (req as any).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "admin");
}

function nowIso(): string {
  return new Date().toISOString();
}

export function registerPartnerFeeAdminRoutes(app: Express): void {
  /* ---- List the full fee catalogue (optionally filtered) ---- */
  app.get("/api/admin/partner-fees", (req: Request, res: Response) => {
    const feeKind = String(req.query.feeKind || "");
    const tier = req.query.tier === undefined ? undefined : String(req.query.tier);
    const includeExpired = String(req.query.includeExpired || "") === "true";
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (feeKind) { clauses.push("fee_kind = ?"); params.push(feeKind); }
    if (tier !== undefined) {
      if (tier === "" || tier === "null") clauses.push("tier IS NULL");
      else { clauses.push("tier = ?"); params.push(tier); }
    }
    if (!includeExpired) clauses.push("(effective_to IS NULL OR effective_to > ?)"), params.push(nowIso());
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = rawDb()
      .prepare(`SELECT * FROM partner_fee_schedules ${where} ORDER BY fee_kind, tier, size_band_min, effective_from DESC`)
      .all(...params);
    res.json({ ok: true, schedules: rows, total: rows.length });
  });

  /* ---- Create a new fee schedule row ---- */
  app.post("/api/admin/partner-fees", (req: Request, res: Response) => {
    const b = req.body as {
      tier?: string | null; feeKind?: string; amountMinor?: number; currency?: string;
      sizeBandMin?: number | null; sizeBandMax?: number | null;
      effectiveFrom?: string; effectiveTo?: string | null;
    };
    if (!b?.feeKind || !FEE_KINDS.has(b.feeKind)) return res.status(400).json({ ok: false, error: "bad_fee_kind" });
    if (typeof b.amountMinor !== "number" || !Number.isInteger(b.amountMinor) || b.amountMinor < 0) {
      return res.status(400).json({ ok: false, error: "amountMinor must be a non-negative integer (minor units)" });
    }
    const id = `pfs_${crypto.randomBytes(6).toString("hex")}`;
    const now = nowIso();
    const tier = b.tier === undefined || b.tier === "" ? null : b.tier;
    const currency = (b.currency && typeof b.currency === "string") ? b.currency : "USD";
    const sizeMin = (typeof b.sizeBandMin === "number") ? b.sizeBandMin : null;
    const sizeMax = (typeof b.sizeBandMax === "number") ? b.sizeBandMax : null;
    const effFrom = b.effectiveFrom && typeof b.effectiveFrom === "string" ? b.effectiveFrom : now;
    const effTo = b.effectiveTo && typeof b.effectiveTo === "string" ? b.effectiveTo : null;
    try {
      rawDb().prepare(
        `INSERT INTO partner_fee_schedules
          (id, tier, fee_kind, amount_minor, currency, size_band_min, size_band_max, effective_from, effective_to, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, tier, b.feeKind, b.amountMinor, currency, sizeMin, sizeMax, effFrom, effTo, now, now, actorOf(req));
    } catch (err) {
      const msg = (err as Error).message || "";
      if (/UNIQUE/i.test(msg)) return res.status(409).json({ ok: false, error: "duplicate_schedule", message: "A fee schedule for this tier/fee-kind/band already exists." });
      return res.status(500).json({ ok: false, error: "insert_failed", message: sanitizeErrorMessage(err) });
    }
    appendAdminAudit(actorOf(req), `partner_fee_schedule:${id}`, "partner_fee_schedule.created", { id, ...b });
    /* CP-BRG-07 — tier_default / platform_default leg changed. */
    publishFeeScheduleChangedForTier(tier, "partner_fee_schedule.created");
    res.json({ ok: true, id });
  });

  /* ---- Update an existing fee schedule row (amount/currency/bands/window) ---- */
  app.patch("/api/admin/partner-fees/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    const existing = rawDb().prepare(`SELECT * FROM partner_fee_schedules WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });
    const b = req.body as {
      amountMinor?: number; currency?: string; sizeBandMin?: number | null;
      sizeBandMax?: number | null; effectiveFrom?: string; effectiveTo?: string | null;
    };
    if (b.amountMinor !== undefined && (!Number.isInteger(b.amountMinor) || b.amountMinor < 0)) {
      return res.status(400).json({ ok: false, error: "amountMinor must be a non-negative integer (minor units)" });
    }
    const next = {
      amount_minor: b.amountMinor !== undefined ? b.amountMinor : existing.amount_minor,
      currency: b.currency !== undefined ? b.currency : existing.currency,
      size_band_min: b.sizeBandMin !== undefined ? b.sizeBandMin : existing.size_band_min,
      size_band_max: b.sizeBandMax !== undefined ? b.sizeBandMax : existing.size_band_max,
      effective_from: b.effectiveFrom !== undefined ? b.effectiveFrom : existing.effective_from,
      effective_to: b.effectiveTo !== undefined ? b.effectiveTo : existing.effective_to,
    };
    rawDb().prepare(
      `UPDATE partner_fee_schedules
         SET amount_minor = ?, currency = ?, size_band_min = ?, size_band_max = ?, effective_from = ?, effective_to = ?, updated_at = ?
       WHERE id = ?`
    ).run(next.amount_minor, next.currency, next.size_band_min, next.size_band_max, next.effective_from, next.effective_to, nowIso(), id);
    appendAdminAudit(actorOf(req), `partner_fee_schedule:${id}`, "partner_fee_schedule.updated", { id, ...b });
    /* CP-BRG-07 — the tier is read off the EXISTING row, not the request body:
     * this route cannot move a row between tiers, so `existing.tier` is the
     * affected scope. `null` means the platform-default row. */
    publishFeeScheduleChangedForTier(
      existing.tier === null || existing.tier === undefined ? null : String(existing.tier),
      "partner_fee_schedule.updated",
    );
    res.json({ ok: true });
  });

  /* ---- Expire (soft-delete) a fee schedule by setting effective_to = now ---- */
  app.delete("/api/admin/partner-fees/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    /* CP-BRG-07 — `tier` is now selected as well as `id` because expiring a row
     * changes the effective price for that tier and the fanout needs the scope.
     * Read BEFORE the write, since after it the row is expired. */
    const existing = rawDb().prepare(`SELECT id, tier FROM partner_fee_schedules WHERE id = ?`).get(id) as
      | { id: string; tier: string | null }
      | undefined;
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });
    rawDb().prepare(`UPDATE partner_fee_schedules SET effective_to = ?, updated_at = ? WHERE id = ?`).run(nowIso(), nowIso(), id);
    appendAdminAudit(actorOf(req), `partner_fee_schedule:${id}`, "partner_fee_schedule.expired", { id });
    publishFeeScheduleChangedForTier(
      existing.tier === null || existing.tier === undefined ? null : String(existing.tier),
      "partner_fee_schedule.expired",
    );
    res.json({ ok: true });
  });

  /* ---- Set / clear a per-partner fee override (contacts.fee_override_json) ---- */
  app.put("/api/admin/partners/:partnerId/fee-override", (req: Request, res: Response) => {
    const partnerId = req.params.partnerId;
    const partner = rawDb()
      .prepare(`SELECT id FROM contacts WHERE id = ? AND kind = 'consortium_partner' AND deleted_at IS NULL`)
      .get(partnerId);
    if (!partner) return res.status(404).json({ ok: false, error: "partner_not_found" });
    const b = req.body as {
      feeOverrideJson?: Record<string, unknown> | null;
      commissionOverridePct?: number | null;
      /* GROUP C (C4) — the consolidated Arrangement editor writes the per-partner
       * arrangement (subscription model, report-only quota, fixed rev-share) here.
       * The per-partner PRICE still travels in feeOverrideJson.subscription_* — it
       * is NOT stored in arrangementJson (no price duplication). null clears it. */
      arrangementJson?: Record<string, unknown> | null;
    };
    // feeOverrideJson: object keyed by fee_kind -> { amountMinor, currency }, or null to clear.
    let feeJson: string | null = null;
    if (b.feeOverrideJson !== undefined && b.feeOverrideJson !== null) {
      try { feeJson = JSON.stringify(b.feeOverrideJson); }
      catch { return res.status(400).json({ ok: false, error: "bad_fee_override_json" }); }
    }
    let arrangementJson: string | null = null;
    if (b.arrangementJson !== undefined && b.arrangementJson !== null) {
      if (typeof b.arrangementJson !== "object" || Array.isArray(b.arrangementJson)) {
        return res.status(400).json({ ok: false, error: "bad_arrangement_json" });
      }
      // Validate the rev-share amount is a non-negative integer (minor units)
      // when rev-share is enabled — money must never be a fractional/negative.
      const rev = (b.arrangementJson as { revShare?: { enabled?: unknown; fixedAmountMinor?: unknown } }).revShare;
      if (rev && rev.enabled === true) {
        if (!Number.isInteger(rev.fixedAmountMinor) || (rev.fixedAmountMinor as number) < 0) {
          return res.status(400).json({ ok: false, error: "revShare.fixedAmountMinor must be a non-negative integer (minor units)" });
        }
      }
      // W-V44 FIX R3 — optional per-partner seat-limit override lives in the
      // arrangement blob (seats are an arrangement concern, not a price). When
      // present it must be a non-negative integer. Absent/null = use tier default.
      const seatRaw = (b.arrangementJson as { seatLimit?: unknown }).seatLimit;
      if (seatRaw !== undefined && seatRaw !== null) {
        if (!Number.isInteger(seatRaw) || (seatRaw as number) < 0) {
          return res.status(400).json({ ok: false, error: "seatLimit must be a non-negative integer (or null to use the tier default)" });
        }
      }
      try { arrangementJson = JSON.stringify(b.arrangementJson); }
      catch { return res.status(400).json({ ok: false, error: "bad_arrangement_json" }); }
    }
    const commissionPct = b.commissionOverridePct === undefined ? undefined : b.commissionOverridePct;
    if (commissionPct !== undefined && commissionPct !== null && (typeof commissionPct !== "number" || commissionPct < 0 || commissionPct > 1)) {
      return res.status(400).json({ ok: false, error: "commissionOverridePct must be a fraction between 0 and 1" });
    }
    // Build a dynamic UPDATE touching only supplied fields.
    const sets: string[] = [];
    const params: unknown[] = [];
    if (b.feeOverrideJson !== undefined) { sets.push("fee_override_json = ?"); params.push(feeJson); }
    if (commissionPct !== undefined) { sets.push("commission_override_pct = ?"); params.push(commissionPct); }
    if (b.arrangementJson !== undefined) { sets.push("arrangement_json = ?"); params.push(arrangementJson); }
    if (sets.length === 0) return res.status(400).json({ ok: false, error: "no_fields" });
    sets.push("updated_at = ?"); params.push(nowIso());
    params.push(partnerId);
    rawDb().prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    appendAdminAudit(actorOf(req), `contact:${partnerId}`, "partner_fee_override.set", { partnerId, ...b });
    /* CP-BRG-07 — partner_override leg changed for exactly this one partner. */
    publishFeeScheduleChanged(String(partnerId), "partner_fee_override.set");
    res.json({ ok: true });
  });

  /* ---- List all consortium partners (DB-direct from contacts) ---- */
  app.get("/api/admin/partners", (req: Request, res: Response) => {
    const status = String(req.query.status || "");
    const q = String(req.query.q || "").toLowerCase();
    const clauses = ["kind = 'consortium_partner'", "deleted_at IS NULL"];
    const params: unknown[] = [];
    if (status && status !== "all") { clauses.push("status = ?"); params.push(status); }
    const rows = rawDb()
      .prepare(`SELECT id, legal_name, display_name, email, status, metadata_json, subscription_id,
                       tax_form_collected_at, partner_agreement_version, partner_agreement_signed_at,
                       commission_override_pct, created_at
                FROM contacts WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`)
      .all(...params) as any[];
    const partners = rows
      .map((r) => {
        let tier: string | null = null;
        try { tier = (JSON.parse(r.metadata_json || "{}") as { tier?: string }).tier ?? null; } catch { /* ignore */ }
        return {
          id: r.id,
          name: r.display_name || r.legal_name,
          email: r.email,
          status: r.status,
          tier,
          subscriptionId: r.subscription_id,
          taxFormCollectedAt: r.tax_form_collected_at,
          agreementVersion: r.partner_agreement_version,
          agreementSignedAt: r.partner_agreement_signed_at,
          commissionOverridePct: r.commission_override_pct,
          createdAt: r.created_at,
        };
      })
      .filter((p) => !q || p.name?.toLowerCase().includes(q) || (p.email || "").toLowerCase().includes(q));
    res.json({ ok: true, partners, total: partners.length });
  });

  /* ---- Partner P&L: aggregate partner_billing_entries by partner + kind ---- */
  app.get("/api/admin/partner-pl", (req: Request, res: Response) => {
    const partnerId = String(req.query.partnerId || "");
    const status = String(req.query.status || "");
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (partnerId) { clauses.push("pbe.partner_id = ?"); params.push(partnerId); }
    if (status && status !== "all") { clauses.push("pbe.status = ?"); params.push(status); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const entries = rawDb()
      .prepare(`SELECT pbe.id, pbe.partner_id AS partnerId, pbe.deal_ref AS dealRef,
                       pbe.entry_kind AS entryKind, pbe.amount_funded_minor AS amountFundedMinor,
                       pbe.commission_pct AS commissionPct, pbe.commission_minor AS commissionMinor,
                       pbe.status, pbe.paid_at AS paidAt, pbe.created_at AS createdAt,
                       pbe.spv_fund_id AS spvFundId, pbe.computed_via AS computedVia,
                       c.display_name AS partnerName
                FROM partner_billing_entries pbe
                LEFT JOIN contacts c ON c.id = pbe.partner_id
                ${where}
                ORDER BY pbe.created_at DESC`)
      .all(...params) as any[];
    // Totals by status (commission_minor is the billable amount for every kind).
    const totals = { pending: 0, paid: 0, all: 0 };
    for (const e of entries) {
      totals.all += e.commissionMinor || 0;
      if (e.status === "paid") totals.paid += e.commissionMinor || 0;
      else if (e.status === "pending") totals.pending += e.commissionMinor || 0;
    }
    res.json({ ok: true, entries, totals, total: entries.length });
  });

  /* ---- Mark a partner billing entry as paid (manual reconciliation) ---- */
  app.post("/api/admin/partner-pl/:entryId/mark-paid", (req: Request, res: Response) => {
    const entryId = req.params.entryId;
    const existing = rawDb().prepare(`SELECT id, status FROM partner_billing_entries WHERE id = ?`).get(entryId) as { id: string; status: string } | undefined;
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });
    if (existing.status === "paid") return res.json({ ok: true, alreadyPaid: true });
    rawDb().prepare(`UPDATE partner_billing_entries SET status = 'paid', paid_at = ? WHERE id = ?`).run(nowIso(), entryId);
    appendAdminAudit(actorOf(req), `partner_billing_entry:${entryId}`, "partner_billing_entry.marked_paid", { entryId });
    res.json({ ok: true });
  });

  /* ---- GROUP C (C6): rev-share query + materialise ----
   *
   * The "validate by query" path for fixed per-partner rev-share. Because the
   * paid signal lives in the untouchable Airwallex webhook (auto-trigger is
   * DEFERRED — rule #14), an admin drives entry creation here instead:
   *
   *   GET  /api/admin/partner-revshare[?partnerId=]  — preview the eligible
   *        (paid + rev-share-enabled) partner-attributed companies and whether a
   *        rev-share billing entry already exists. Read-only.
   *   POST /api/admin/partner-revshare/record[ {partnerId?} ] — idempotently
   *        materialise a partner_billing_entries row (entry_kind 'revshare') for
   *        each eligible company. Re-running only creates missing rows. The rows
   *        start 'pending' and are settled via the existing mark-paid endpoint.
   *
   * Both are under the router-level requireAdmin gate (routes.ts). No payment /
   * Airwallex code is touched; the subscription 'active' state is read-only. */
  app.get("/api/admin/partner-revshare", (req: Request, res: Response) => {
    const partnerId = req.query.partnerId === undefined ? undefined : String(req.query.partnerId);
    try {
      const candidates = listRevShareCandidates(partnerId);
      const pendingCount = candidates.filter((c) => !c.alreadyRecorded).length;
      res.json({ ok: true, candidates, total: candidates.length, pendingCount });
    } catch (err) {
      res.status(500).json({ ok: false, error: "revshare_query_failed", message: sanitizeErrorMessage(err) });
    }
  });

  app.post("/api/admin/partner-revshare/record", (req: Request, res: Response) => {
    const b = (req.body ?? {}) as { partnerId?: string };
    const partnerId = b.partnerId ? String(b.partnerId) : undefined;
    try {
      const result = materializeRevShareEntries(partnerId);
      appendAdminAudit(actorOf(req), `partner_revshare:${partnerId ?? "all"}`, "partner_revshare.materialized", {
        partnerId: partnerId ?? null,
        eligible: result.eligible,
        created: result.created,
        alreadyRecorded: result.alreadyRecorded,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: "revshare_record_failed", message: sanitizeErrorMessage(err) });
    }
  });

  /* ---- v25.41 Bug-3 — Admin SPV creation for a partner ----
   *
   * Admin parity for the partner self-service POST /api/partner/me/spvs path.
   * Mounted under the router-level requireAdmin gate (routes.ts), audit-logged
   * via appendAdminAudit, and delegates to the EXISTING partnerSpvStore.create
   * (no store changes; the partner-side endpoint is untouched). Same request
   * body shape and same status validation as the partner-side route. */
  const VALID_SPV_STATUS = new Set(["planned", "open", "closed", "wound_down"]);
  // Blocker 1 (4D): legacy admin status strings normalise onto canonical SPV enums.
  const ADMIN_LEGACY_TO_CANONICAL_SPV_STATUS: Record<string, "draft" | "open" | "closed" | "wound_down"> = {
    planned: "draft", open: "open", closed: "closed", wound_down: "wound_down",
  };

  app.get("/api/admin/partners/:partnerId/spvs", (req: Request, res: Response) => {
    const partnerId = String(req.params.partnerId);
    const partner = rawDb()
      .prepare(`SELECT id FROM contacts WHERE id = ? AND kind = 'consortium_partner' AND deleted_at IS NULL`)
      .get(partnerId);
    if (!partner) return res.status(404).json({ ok: false, error: "partner_not_found" });
    try {
      // Read THROUGH the canonical engine (the ONE SPV store), not the legacy table.
      const spvs = spvEngineStore.listByPartner(partnerId);
      res.json({ ok: true, spvs, total: spvs.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: "list_failed", message: sanitizeErrorMessage(err) });
    }
  });

  app.post("/api/admin/partners/:partnerId/spvs", (req: Request, res: Response) => {
    const partnerId = String(req.params.partnerId);
    const partner = rawDb()
      .prepare(`SELECT id FROM contacts WHERE id = ? AND kind = 'consortium_partner' AND deleted_at IS NULL`)
      .get(partnerId);
    if (!partner) return res.status(404).json({ ok: false, error: "partner_not_found" });
    const b = req.body as {
      spvName?: string; jurisdiction?: string; vintage?: number; currency?: string; status?: string;
      targetCompanyId?: string | null; entityStructure?: string | null;
      externalAdminProvider?: string | null; externalAdminRef?: string | null; notes?: string | null;
    };
    if (
      typeof b?.spvName !== "string" || !b.spvName.trim() ||
      typeof b?.jurisdiction !== "string" || !b.jurisdiction.trim() ||
      typeof b?.vintage !== "number" || !Number.isInteger(b.vintage) ||
      typeof b?.currency !== "string" || !/^[A-Z]{3}$/.test(b.currency) ||
      typeof b?.status !== "string"
    ) {
      return res.status(400).json({ ok: false, error: "spvName, jurisdiction, vintage, ISO 4217 currency, status required" });
    }
    if (!VALID_SPV_STATUS.has(b.status)) {
      return res.status(400).json({ ok: false, error: "status must be one of planned|open|closed|wound_down" });
    }
    try {
      const actor = actorOf(req);
      // Blocker 1 (4D): create THROUGH the canonical engine (spvType:"spv") so an
      // admin-created SPV lands in the ONE canonical `spv` table and can never be
      // a non-canonical row. Free-text jurisdiction normalises to a valid enum;
      // legacy-only fields are preserved in `terms` provenance (nothing lost).
      /* WAVE 4A / follow-up 2 — resolveSpvJurisdiction() (Wave 3C) replaces the
         hard-coded "delaware" fallback: unknown input becomes "other". */
      const canonicalJurisdiction = resolveSpvJurisdiction(b.jurisdiction);
      const spv = spvEngineStore.createSpv(
        partnerId,
        {
          name: b.spvName,
          jurisdiction: canonicalJurisdiction,
          carryBasis: "whole_spv",
          currency: b.currency,
          status: ADMIN_LEGACY_TO_CANONICAL_SPV_STATUS[b.status as string] ?? "draft",
          targetCompanyId: b.targetCompanyId ?? null,
          terms: {
            legacyShim: true,
            vintage: b.vintage,
            entityStructure: b.entityStructure ?? null,
            externalAdminProvider: b.externalAdminProvider ?? null,
            externalAdminRef: b.externalAdminRef ?? null,
            notes: b.notes ?? null,
            legacyJurisdiction: b.jurisdiction,
          },
        },
        actor,
      );
      appendAdminAudit(actor, `partner_spv:${spv.id}`, "partner_spv.created", { partnerId, spvId: spv.id, spvName: spv.name, status: spv.status });
      res.status(201).json({ ok: true, spv });
    } catch (err) {
      res.status(500).json({ ok: false, error: "create_failed", message: sanitizeErrorMessage(err) });
    }
  });

  /* ---- Read a partner's current override + the effective resolved fees ---- */
  app.get("/api/admin/partners/:partnerId/fee-override", (req: Request, res: Response) => {
    const partnerId = req.params.partnerId;
    const row = rawDb()
      .prepare(`SELECT fee_override_json, commission_override_pct, arrangement_json, metadata_json FROM contacts WHERE id = ? AND kind = 'consortium_partner' AND deleted_at IS NULL`)
      .get(partnerId) as { fee_override_json: string | null; commission_override_pct: number | null; arrangement_json: string | null; metadata_json: string | null } | undefined;
    if (!row) return res.status(404).json({ ok: false, error: "partner_not_found" });
    let feeOverride: unknown = null;
    if (row.fee_override_json) { try { feeOverride = JSON.parse(row.fee_override_json); } catch { feeOverride = null; } }
    // GROUP C (C4) — surface the per-partner arrangement for the consolidated editor.
    let arrangement: unknown = null;
    if (row.arrangement_json) { try { arrangement = JSON.parse(row.arrangement_json); } catch { arrangement = null; } }
    // W-V44 FIX R3 — surface the effective seat limit so the admin can see the
    // tier default, any per-partner override, and which one is in effect.
    let tier: PartnerTier = "catalyst";
    try { tier = ((JSON.parse(row.metadata_json || "{}") as { tier?: PartnerTier }).tier) ?? "catalyst"; } catch { /* default */ }
    const seat = resolveEffectiveSeatLimit(tier, row.arrangement_json);
    /* WAVE 45 — the tier default is read from partner_tier_capability so the
       console shows what an admin can actually edit. `*Display` carries the
       human form ("Unlimited" / "Not configured") so the UI never renders a
       null as 0, and `*Resolution` carries the machine form. */
    const tierCap = resolveTierCapability(tier, CAPABILITY_SEAT_LIMIT);
    const seats = {
      tier,
      tierDefault: tierCap.resolution === "configured" ? tierCap.value : null,
      tierDefaultResolution: tierCap.resolution,
      tierDefaultDisplay: describeCapability(tierCap),
      tierDefaultEditable: tierCap.editable,
      effective: seat.seatLimit,
      effectiveResolution: seat.resolution,
      effectiveDisplay: describeCapability(seat.capability),
      source: seat.source,
    };
    res.json({ ok: true, feeOverride, commissionOverridePct: row.commission_override_pct, arrangement, seats });
  });
}
