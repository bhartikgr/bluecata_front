/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * partnerSelfServiceRoutes — NEW partner-facing endpoints that back the four
 * PartnerBilling tabs beyond the existing referral-commission ledger. These are
 * ADDITIVE and live in a separate file so Avi's GET /api/partner/me/billing
 * (server/partnerConsortiumRoutes.ts) is never touched.
 *
 * Endpoints (all gated requirePartnerAuth; financial reads = managing_partner):
 *   GET  /api/partner/me/subscription   — partner's subscription (contacts.subscription_id
 *                                          → capavate_subscriptions), DB-direct.
 *   GET  /api/partner/me/spv-fees       — partner_billing_entries WHERE entry_kind IN
 *                                          (spv_deployment_fee, spv_management_fee,
 *                                          spv_closing_bonus), LEFT JOIN spvs for name.
 *   GET  /api/partner/me/tax-forms      — partner_tax_forms WHERE partner_id = ?.
 *   POST /api/partner/me/agreement      — records click-through agreement: stamps
 *                                          contacts.partner_agreement_* + audit_log.
 *   POST /api/partner/me/tax-form       — inserts a partner_tax_forms row + stamps
 *                                          contacts.tax_form_collected_at.
 *   POST /api/partner/me/subscribe      — initiates a partner subscription checkout by
 *                                          delegating to the existing billing plan flow;
 *                                          no bespoke payment logic is invented here.
 *
 * Every value comes from the DB (rawDb()) or env; nothing is hardcoded. Money is
 * integer minor units. Reads are side-effect-free.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { requirePartnerAuth, requirePartnerSubrole } from "./requirePartnerAuth";
import { rawDb } from "../db/connection";
import { appendAdminAudit } from "../adminPlatformStore";
import { sanitizeErrorMessage } from "./sanitize"; /* v25.33 — scrub raw err.message from client responses in prod (backlog item 33 extension). */
import { resolvePartnerFee } from "./partnerFeeResolver"; /* v25.41 round-2 (per GPT-5.5): static ESM import replaces the prior lazy `require("./partnerFeeResolver")` so the route is safe under both tsx production loader AND vitest ESM .mjs test harness. No behavior change. */

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}
function nowIso(): string {
  return new Date().toISOString();
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/* The current click-through agreement version + URL are configuration, not code.
 * Sourced from env with documented defaults (mirrors adminEmailRoutes.ts env use).
 * If a future admin surface manages these in the DB, swap these reads for a DB
 * lookup — callers below already treat them as opaque config. */
function currentAgreement(): { version: string; url: string | null } {
  return {
    version: process.env.PARTNER_AGREEMENT_VERSION ?? "v1",
    url: process.env.PARTNER_AGREEMENT_URL ?? null,
  };
}

const ALLOWED_FORM_TYPES = new Set(["W-9", "W-8BEN", "W-8BEN-E", "T4A"]);

export function registerPartnerSelfServiceRoutes(app: Express): void {
  /* ==========================================================
   * GET /api/partner/me/subscription — Subscription tab.
   * Reads contacts.subscription_id, then the matching capavate_subscriptions
   * row. Returns null subscription when the partner has none (Path-1 partners
   * are not billed a subscription). Auth: managing_partner (financial).
   * ========================================================== */
  app.get(
    "/api/partner/me/subscription",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      try {
        const db = rawDb();
        const contact = db
          .prepare(`SELECT subscription_id FROM contacts WHERE id = ?`)
          .get(pid) as { subscription_id: string | null } | undefined;
        const subId = contact?.subscription_id ?? null;
        if (!subId) {
          return res.json({ subscription: null, agreement: currentAgreement() });
        }
        const sub = db
          .prepare(
            `SELECT id, tier_id AS tierId, status, amount_minor AS amountMinor,
                    currency, billing_cycle AS billingCycle, created_at AS createdAt,
                    activated_at AS activatedAt, expires_at AS expiresAt,
                    current_period_end AS currentPeriodEnd
             FROM capavate_subscriptions WHERE id = ?`,
          )
          .get(subId) as Record<string, unknown> | undefined;
        res.json({ subscription: sub ?? null, agreement: currentAgreement() });
      } catch (err) {
        res.status(500).json({ error: "PARTNER_SUBSCRIPTION_QUERY_FAILED", message: sanitizeErrorMessage(err) });
      }
    },
  );

  /* ==========================================================
   * GET /api/partner/me/spv-fees — SPV Fees tab.
   * partner_billing_entries for SPV-related fee kinds, LEFT JOIN spvs (the real
   * SPV/fund table) for a human name. Side-effect-free. Auth: managing_partner.
   * ========================================================== */
  app.get(
    "/api/partner/me/spv-fees",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      try {
        const db = rawDb();
        const entries = db
          .prepare(
            `SELECT pbe.id,
                    pbe.entry_kind         AS entryKind,
                    pbe.spv_fund_id        AS spvFundId,
                    pbe.deal_ref           AS dealRef,
                    pbe.amount_funded_minor AS amountFundedMinor,
                    pbe.commission_minor    AS feeMinor,
                    pbe.computed_via        AS computedVia,
                    pbe.status,
                    pbe.paid_at            AS paidAt,
                    pbe.created_at         AS createdAt,
                    s.name                 AS spvName,
                    COALESCE(s.deployment_fee_currency, 'USD') AS currency
             FROM partner_billing_entries pbe
             LEFT JOIN spvs s ON s.id = pbe.spv_fund_id
             WHERE pbe.partner_id = ?
               AND pbe.entry_kind IN ('spv_deployment_fee', 'spv_management_fee', 'spv_closing_bonus')
             ORDER BY pbe.created_at DESC`,
          )
          .all(pid) as Array<{ status: string; feeMinor: number; currency: string }>;

        // Per-currency totals by status (multi-currency aware).
        const totals: Record<string, { pending: number; paid: number }> = {};
        for (const e of entries) {
          const ccy = e.currency || "USD";
          if (!totals[ccy]) totals[ccy] = { pending: 0, paid: 0 };
          if (e.status === "paid") totals[ccy].paid += e.feeMinor || 0;
          else totals[ccy].pending += e.feeMinor || 0;
        }
        res.json({ entries, totalsByCurrency: totals });
      } catch (err) {
        res.status(500).json({ error: "PARTNER_SPV_FEES_QUERY_FAILED", message: sanitizeErrorMessage(err) });
      }
    },
  );

  /* ==========================================================
   * GET /api/partner/me/tax-forms — Tax Forms tab.
   * partner_tax_forms rows for this partner. tax_id_hash is NEVER returned
   * (it is a one-way hash and irrelevant to the UI). Auth: managing_partner.
   * ========================================================== */
  app.get(
    "/api/partner/me/tax-forms",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      try {
        const db = rawDb();
        const forms = db
          .prepare(
            `SELECT id, form_type AS formType, jurisdiction,
                    collected_at AS collectedAt, expires_at AS expiresAt,
                    document_url AS documentUrl, created_at AS createdAt
             FROM partner_tax_forms WHERE partner_id = ?
             ORDER BY collected_at DESC`,
          )
          .all(pid) as unknown[];
        res.json({ forms });
      } catch (err) {
        res.status(500).json({ error: "PARTNER_TAX_FORMS_QUERY_FAILED", message: sanitizeErrorMessage(err) });
      }
    },
  );

  /* ==========================================================
   * POST /api/partner/me/agreement — record click-through agreement.
   * Body: { version?, signatureName }. Stamps contacts.partner_agreement_version
   * / _signed_at / _signature_hash (a hash of name+version+timestamp, never the
   * raw signature) and writes an audit_log entry. Auth: managing_partner.
   * ========================================================== */
  app.post(
    "/api/partner/me/agreement",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const body = (req.body ?? {}) as { version?: unknown; signatureName?: unknown };
      const agreement = currentAgreement();
      const version = isNonEmptyString(body.version) ? body.version.trim() : agreement.version;
      const signatureName = isNonEmptyString(body.signatureName) ? body.signatureName.trim() : null;
      if (!signatureName) {
        return res.status(400).json({ error: "SIGNATURE_NAME_REQUIRED" });
      }
      try {
        const db = rawDb();
        const signedAt = nowIso();
        const sigHash = createHash("sha256")
          .update(`${pid}|${version}|${signatureName}|${signedAt}`)
          .digest("hex");
        const result = db
          .prepare(
            `UPDATE contacts
             SET partner_agreement_version = ?,
                 partner_agreement_signed_at = ?,
                 partner_agreement_signature_hash = ?
             WHERE id = ? AND kind = 'consortium_partner'`,
          )
          .run(version, signedAt, sigHash, pid);
        if (result.changes === 0) {
          return res.status(404).json({ error: "PARTNER_NOT_FOUND" });
        }
        appendAdminAudit(
          `partner:${pid}`,
          `contact:${pid}`,
          "partner_agreement.signed",
          { partnerId: pid, version, signedAt, signatureHash: sigHash },
        );
        res.json({ ok: true, version, signedAt });
      } catch (err) {
        res.status(500).json({ error: "PARTNER_AGREEMENT_WRITE_FAILED", message: sanitizeErrorMessage(err) });
      }
    },
  );

  /* ==========================================================
   * POST /api/partner/me/tax-form — record a collected tax form.
   * Body: { formType, jurisdiction, taxId, documentUrl?, expiresAt? }.
   * The raw taxId is hashed (sha256) before storage — never persisted in clear.
   * Inserts a partner_tax_forms row and stamps contacts.tax_form_collected_at.
   * Auth: managing_partner.
   * ========================================================== */
  app.post(
    "/api/partner/me/tax-form",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const body = (req.body ?? {}) as {
        formType?: unknown; jurisdiction?: unknown; taxId?: unknown;
        documentUrl?: unknown; expiresAt?: unknown;
      };
      const formType = isNonEmptyString(body.formType) ? body.formType.trim() : null;
      const jurisdiction = isNonEmptyString(body.jurisdiction) ? body.jurisdiction.trim() : null;
      const taxId = isNonEmptyString(body.taxId) ? body.taxId.trim() : null;
      const documentUrl = isNonEmptyString(body.documentUrl) ? body.documentUrl.trim() : null;
      const expiresAt = isNonEmptyString(body.expiresAt) ? body.expiresAt.trim() : null;

      if (!formType || !ALLOWED_FORM_TYPES.has(formType)) {
        return res.status(400).json({ error: "INVALID_FORM_TYPE", allowed: Array.from(ALLOWED_FORM_TYPES) });
      }
      if (!jurisdiction) return res.status(400).json({ error: "JURISDICTION_REQUIRED" });
      if (!taxId) return res.status(400).json({ error: "TAX_ID_REQUIRED" });

      try {
        const db = rawDb();
        const id = newId("ptf");
        const collectedAt = nowIso();
        const taxIdHash = createHash("sha256").update(taxId).digest("hex");
        const tx = db.transaction(() => {
          db.prepare(
            `INSERT INTO partner_tax_forms
               (id, partner_id, form_type, jurisdiction, tax_id_hash, collected_at, expires_at, document_url, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(id, pid, formType, jurisdiction, taxIdHash, collectedAt, expiresAt, documentUrl, collectedAt);
          db.prepare(
            `UPDATE contacts SET tax_form_collected_at = ? WHERE id = ? AND kind = 'consortium_partner'`,
          ).run(collectedAt, pid);
        });
        tx();
        appendAdminAudit(
          `partner:${pid}`,
          `contact:${pid}`,
          "partner_tax_form.collected",
          { partnerId: pid, taxFormId: id, formType, jurisdiction },
        );
        res.json({ ok: true, id, formType, collectedAt });
      } catch (err) {
        res.status(500).json({ error: "PARTNER_TAX_FORM_WRITE_FAILED", message: sanitizeErrorMessage(err) });
      }
    },
  );

  /* ==========================================================
   * POST /api/partner/me/subscribe — initiate partner subscription checkout.
   * No bespoke payment flow is invented here. This endpoint resolves the
   * partner-subscription fee from the DB-driven fee catalogue and returns the
   * resolved amount/currency plus the canonical checkout path the client should
   * POST to (the existing /api/billing/plan flow). The actual charge + the
   * capavate_subscriptions row are still minted by Avi's billing path on the
   * webhook — we only surface the resolved price. Auth: managing_partner.
   * ========================================================== */
  app.post(
    "/api/partner/me/subscribe",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const tier = req.partnerContext!.tier;
      const body = (req.body ?? {}) as { cycle?: unknown };
      const cycle = body.cycle === "annual" ? "annual" : "monthly";
      try {
        // Resolve the partner-subscription fee from the DB catalogue (no hardcode).
        // resolvePartnerFee is fail-closed; if no schedule exists it throws, which
        // we translate into a clear "not available" response rather than a 500.
        // v25.41 round-2 (per GPT-5.5): import is now static at the top of the file.
        const feeKind = cycle === "annual" ? "subscription_annual" : "subscription_monthly";
        let resolved: { amountMinor: number; currency: string; computedVia: string };
        try {
          resolved = resolvePartnerFee(pid, tier, feeKind, {});
        } catch {
          return res.status(409).json({
            error: "PARTNER_SUBSCRIPTION_NOT_AVAILABLE",
            message: "No partner subscription fee schedule is configured for this tier.",
          });
        }
        res.json({
          ok: true,
          tier,
          cycle,
          amountMinor: resolved.amountMinor,
          currency: resolved.currency,
          computedVia: resolved.computedVia,
          // The client completes checkout via the existing billing plan flow.
          checkoutPath: "/api/billing/plan",
        });
      } catch (err) {
        res.status(500).json({ error: "PARTNER_SUBSCRIBE_FAILED", message: sanitizeErrorMessage(err) });
      }
    },
  );
}
