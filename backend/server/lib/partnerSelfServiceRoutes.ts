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
/* WAVE 45 */ import { purchasableCadences } from "./partnerTiers";
import { createHash, randomBytes } from "node:crypto";
import { quotePartnerSubscription } from "./partnerBillingStore";
/* WAVE 11 / EN-6 — the single amount producer + the partner-scoped charge path. */
import {
  quotePartnerCheckout,
  startPartnerCheckout,
  getActiveForSubject,
  listForSubject,
  listSubscriptionEvents,
  PartnerCheckoutError,
} from "./partnerSubscriptionStore";
/* WAVE 11 / EN-7 + EN-8 — proration engine and grace/enforcement reporting. */
import {
  previewPlanChange,
  applyPlanChange,
  cancelSubscription,
  listChanges,
  PlanChangeError,
} from "./subscriptionChangeStore";
import { enforcementStatusForSubject } from "./subscriptionEnforcementWorker";
import type { Express, Request, Response } from "express";
import multer from "multer"; /* v25.50 Phase 7 (10) — real tax-form document upload. */
import { requirePartnerAuth, requirePartnerSubrole } from "./requirePartnerAuth";
import { requireSignedAgreement } from "./requireSignedAgreement";
import { rawDb } from "../db/connection";
import { appendAdminAudit } from "../adminPlatformStore";
import { sanitizeErrorMessage } from "./sanitize"; /* v25.33 — scrub raw err.message from client responses in prod (backlog item 33 extension). */
/* GROUP C (C3) — the partner's OWN checkout amount honors an admin-set per-partner
 * price override (incl explicit $0) that supersedes the tier; absent an override it
 * falls back to the advertised tier price via resolvePartnerEffectivePlan (which
 * itself reuses resolveChargeTier — v25.48 CP-2b advertised==charged). The PUBLIC
 * pricing page stays tier-based. Fail-closed. */
import { resolvePartnerEffectivePlan, EffectivePlanError } from "./partnerEffectivePlan";
import { putObject, getObject } from "./objectStorage"; /* v25.50 Phase 7 (10) — store/serve tax-form docs via the sanctioned object-storage layer. */
import { CONSORTIUM_AGREEMENT_VERSION, CONSORTIUM_AGREEMENT_TEXT } from "@shared/consortiumAgreement"; /* W2-I — viewable+configurable agreement text/version. */

/* v25.50 Phase 7 (10) — tax-form document upload constraints. PDF + common
 * image types only; 15MB cap (parity with post attachments). memoryStorage so
 * multer caps the body before it fully buffers. */
const TAX_DOC_MAX_BYTES = 15 * 1024 * 1024;
const TAX_DOC_ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const taxDocUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TAX_DOC_MAX_BYTES } });

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
function currentAgreement(): { version: string; url: string | null; text: string; finalDocUrl: string | null; isDraft: boolean } {
  const version = process.env.PARTNER_AGREEMENT_VERSION ?? CONSORTIUM_AGREEMENT_VERSION;
  return {
    // W2-I — version + viewable text come from the shared config module so
    // counsel's final copy can replace them with NO code surgery. Env can still
    // override the version tag (e.g. to force a re-signature ahead of a code
    // deploy) and supply a hosted document URL.
    version,
    url: process.env.PARTNER_AGREEMENT_URL ?? null,
    text: CONSORTIUM_AGREEMENT_TEXT,
    // W5.1 — FINAL-DOC SLOT. Optional URL of the counsel-executed copy. When set
    // (env PARTNER_AGREEMENT_FINAL_DOC_URL), signed partners get a link to the
    // executed document; until set it is null and the draft copy is shown.
    finalDocUrl: process.env.PARTNER_AGREEMENT_FINAL_DOC_URL ?? null,
    // W5.1 — DRAFT flag. The current copy is a DRAFT while the version tag ends
    // with "-DRAFT" (counsel bumps the tag when the executed copy lands). The
    // client strips the DRAFT watermark on the signed/final view accordingly.
    isDraft: /-draft$/i.test(version),
  };
}

/** W2-I — read the DURABLE signed state for a partner from contacts (never the
 *  mutable onboarding_state JSON). Returns null when no row/kind mismatch. */
function readAgreementSignedState(pid: string): { signed: boolean; signedAt: string | null; version: string | null } {
  try {
    const row = rawDb()
      .prepare(
        `SELECT partner_agreement_signed_at AS signedAt, partner_agreement_version AS version
           FROM contacts WHERE id = ? AND kind = 'consortium_partner'`,
      )
      .get(pid) as { signedAt: string | null; version: string | null } | undefined;
    const signedAt = row?.signedAt ?? null;
    return { signed: !!signedAt, signedAt, version: row?.version ?? null };
  } catch {
    return { signed: false, signedAt: null, version: null };
  }
}

const ALLOWED_FORM_TYPES = new Set(["W-9", "W-8BEN", "W-8BEN-E", "T4A"]);

/* ============================================================
 * WAVE 11 / EN-6 + EN-7 + EN-8 — the partner subscription lifecycle block.
 *
 * WHY THIS IS A HELPER ON THE EXISTING ROUTE AND NOT A NEW ROUTE.
 * The first draft of this wave registered a SECOND
 * `GET /api/partner/me/subscription`. Express serves the FIRST matching
 * registration, so that handler would never have executed: a route that exists,
 * type-checks, and returns nothing to anybody. That is the "fix where data
 * doesn't flow" trap in its purest form, caught by grepping the tree for the
 * path instead of assuming the path was free.
 *
 * So the lifecycle data is folded into the EXISTING handler, ADDITIVELY: every
 * pre-existing key (`subscription`, `agreement`) is returned unchanged, and the
 * new keys sit alongside them. Nothing that read this endpoint before can break.
 *
 * `capavate_subscriptions` (the sacred store's table, surfaced as
 * `subscription`) and `partner_subscription` (this wave's, surfaced as
 * `partnerSubscription`) are BOTH reported, deliberately: they are joined on the
 * payment-intent id, and showing them side by side is how a divergence becomes
 * visible instead of silent.
 *
 * Fail-soft by design: if the Wave 11 tables are not present yet (a database
 * that has not run 0167 and cannot self-heal), the pre-existing part of the
 * response must still be served. The failure is REPORTED in
 * `lifecycleUnavailable`, never swallowed into a plausible-looking empty state.
 * ============================================================ */
function wave11SubscriptionBlock(partnerId: string): Record<string, unknown> {
  try {
    const active = getActiveForSubject("partner", partnerId);
    return {
      partnerSubscription: active,
      partnerSubscriptionHistory: listForSubject("partner", partnerId),
      partnerSubscriptionEvents: active ? listSubscriptionEvents(active.id) : [],
      partnerSubscriptionChanges: active ? listChanges(active.id) : [],
      enforcement: enforcementStatusForSubject("partner", partnerId),
      checkoutPath: "/api/partner/me/checkout",
      checkoutMethod: "POST",
      lifecycleUnavailable: null,
    };
  } catch (err) {
    return {
      partnerSubscription: null,
      partnerSubscriptionHistory: [],
      partnerSubscriptionEvents: [],
      partnerSubscriptionChanges: [],
      enforcement: null,
      checkoutPath: "/api/partner/me/checkout",
      checkoutMethod: "POST",
      lifecycleUnavailable: sanitizeErrorMessage(err),
    };
  }
}

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
          return res.json({
            subscription: null,
            agreement: currentAgreement(),
            ...wave11SubscriptionBlock(pid),
          });
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
        res.json({
          subscription: sub ?? null,
          agreement: currentAgreement(),
          ...wave11SubscriptionBlock(pid),
        });
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
  /* ==========================================================
   * W2-I — GET /api/partner/me/agreement — viewable terms + DURABLE signed
   * state (read off contacts.partner_agreement_signed_at, never onboarding
   * JSON). Open to any authenticated partner role so the sign page + the
   * gate-redirect flow can render the current state. Signing itself remains
   * managing_partner-only (the POST below).
   * ========================================================== */
  app.get(
    "/api/partner/me/agreement",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const agreement = currentAgreement();
      const state = readAgreementSignedState(pid);
      // "signed" for THIS version: a stale signature against an older version
      // does not satisfy the current version (clause 14 re-signature).
      const signedCurrent = state.signed && state.version === agreement.version;
      res.json({
        agreement,
        signed: state.signed,
        signedCurrent,
        signedAt: state.signedAt,
        signedVersion: state.version,
        canSign: req.partnerContext!.partnerSubRole === "managing_partner",
      });
    },
  );

  app.post(
    "/api/partner/me/agreement",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const body = (req.body ?? {}) as { version?: unknown; signatureName?: unknown };
      const agreement = currentAgreement();
      // W5.1 — STALE-VERSION SIGNING REJECT. If the client presents a version it
      // must equal the CURRENT server version; otherwise the partner is signing
      // an outdated agreement (the copy they read is no longer the live one).
      // Reject with 409 so the client re-fetches + re-presents the current copy
      // before signing. When no version is presented we default to current
      // (backward-compatible with older clients that omit it).
      const presentedVersion = isNonEmptyString(body.version) ? body.version.trim() : null;
      if (presentedVersion !== null && presentedVersion !== agreement.version) {
        return res.status(409).json({
          error: "agreement_version_stale",
          message: "The agreement has been updated since you opened it. Please review the current version and sign again.",
          presentedVersion,
          currentVersion: agreement.version,
        });
      }
      const version = presentedVersion ?? agreement.version;
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
    requireSignedAgreement,
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
   * v25.50 Phase 7 (10) — POST /api/partner/me/tax-form/upload.
   * Multipart `file` upload of a tax-form document. Stores the bytes via the
   * sanctioned object-storage layer and returns a documentUrl that points at
   * the authenticated serve route below. The client then submits the normal
   * POST /api/partner/me/tax-form with this documentUrl. Auth: managing_partner.
   * ========================================================== */
  app.post(
    "/api/partner/me/tax-form/upload",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      taxDocUpload.single("file")(req, res, async (uploadErr: unknown) => {
        if (uploadErr) {
          const code = (uploadErr as { code?: string })?.code === "LIMIT_FILE_SIZE" ? "too_large" : "upload_failed";
          return res.status(400).json({ ok: false, error: code, message: sanitizeErrorMessage(uploadErr) });
        }
        const file = (req as Request & { file?: Express.Multer.File }).file;
        if (!file) return res.status(400).json({ ok: false, error: "no_file", message: "Use multipart/form-data with field 'file'." });
        if (!TAX_DOC_ALLOWED_MIME.has(file.mimetype)) {
          return res.status(400).json({ ok: false, error: "unsupported_mime", message: `mime ${file.mimetype} is not allowed` });
        }
        if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
          return res.status(400).json({ ok: false, error: "empty_file", message: "file is empty" });
        }
        try {
          const stored = await putObject({
            prefix: "partner_tax_forms",
            buffer: file.buffer,
            mimeType: file.mimetype,
            originalName: file.originalname || "tax-form",
          });
          const documentUrl = `/api/partner/me/tax-form/document?key=${encodeURIComponent(stored.storageKey)}`;
          res.status(201).json({ ok: true, storageKey: stored.storageKey, documentUrl });
        } catch (err) {
          res.status(500).json({ ok: false, error: "TAX_FORM_UPLOAD_FAILED", message: sanitizeErrorMessage(err) });
        }
      });
    },
  );

  /* ==========================================================
   * v25.50 Phase 7 (10) — GET /api/partner/me/tax-form/document?key=...
   * Serve a previously-uploaded tax-form document. FAIL-CLOSED against both
   * path traversal AND cross-tenant access: the requested key is served ONLY if
   * a partner_tax_forms row FOR THIS PARTNER references it (document_url stores
   * the exact serve URL). A key the partner never uploaded — including any
   * `../` traversal attempt — has no matching row and returns 404.
   * Auth: managing_partner.
   * ========================================================== */
  app.get(
    "/api/partner/me/tax-form/document",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    async (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const key = typeof req.query.key === "string" ? req.query.key : "";
      if (!key) return res.status(400).json({ error: "KEY_REQUIRED" });
      try {
        const expectedUrl = `/api/partner/me/tax-form/document?key=${encodeURIComponent(key)}`;
        const owned = rawDb()
          .prepare(`SELECT id FROM partner_tax_forms WHERE partner_id = ? AND document_url = ? LIMIT 1`)
          .get(pid, expectedUrl) as { id: string } | undefined;
        if (!owned) return res.status(404).json({ error: "DOCUMENT_NOT_FOUND" });
        const buf = await getObject(key);
        if (!buf) return res.status(404).json({ error: "DOCUMENT_NOT_FOUND" });
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", "inline");
        res.send(buf);
      } catch (err) {
        res.status(500).json({ error: "TAX_FORM_DOCUMENT_READ_FAILED", message: sanitizeErrorMessage(err) });
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
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const tier = req.partnerContext!.tier;
      const body = (req.body ?? {}) as { cycle?: unknown; promotionCode?: unknown };
      /* ── WAVE 45 (R3) — THE DEFAULT CYCLE IS CONFIGURATION, NOT "monthly" ──────
       *
       * This line used to read:
       *     const cycle = body.cycle === "annual" ? "annual" : "monthly";
       * so ANY request that omitted `cycle` — which is every client that had not
       * been updated — silently bought a MONTHLY subscription. Under R3 the
       * platform is ANNUAL ONLY, so that default was not merely stale: combined
       * with the x12 annual derivation it was the difference between billing
       * $240.00 and billing $5,988.00.
       *
       * Monthly is RETIRED, NOT DELETED. The monthly branch below still exists
       * and still works; whether it can be reached is decided by
       * partner_pricing_model_config, so re-opening monthly billing is a
       * configuration change rather than a code change. An explicit request for a
       * cadence the platform does not currently sell is REFUSED rather than
       * quietly downgraded to one it does. */
      const allowedCycles = purchasableCadences();
      const requestedCycle = typeof body.cycle === "string" ? body.cycle : null;
      if (requestedCycle && !allowedCycles.includes(requestedCycle)) {
        return res.status(409).json({
          ok: false,
          error: "CYCLE_NOT_PURCHASABLE",
          message:
            `The "${requestedCycle}" billing cycle is not currently offered. ` +
            `Available: ${allowedCycles.join(", ") || "(none configured)"}.`,
          availableCycles: allowedCycles,
        });
      }
      if (allowedCycles.length === 0) {
        // Never fall back to a compiled-in cadence. Refuse and say so.
        return res.status(409).json({
          ok: false,
          error: "NO_PURCHASABLE_CYCLE",
          message:
            "No billing cycle is currently purchasable. An admin must enable one in " +
            "partner_pricing_model_config before a subscription can be created.",
        });
      }
      const cycle = (requestedCycle ?? allowedCycles[0]) as "annual" | "monthly";
      try {
        // GROUP C (C3) — re-connect the per-partner subscription override on the
        // partner's OWN checkout. resolvePartnerEffectivePlan composes:
        //   • effectivePrice = admin-set per-partner override in
        //     contacts.fee_override_json (subscription_monthly/annual), incl. an
        //     explicit $0, when present — this supersedes the tier for THIS
        //     partner only. The PUBLIC /consortium/pricing page (collectiveRoutes)
        //     is untouched and stays tier-based (advertised == charged there).
        //   • otherwise the advertised tier price (resolveChargeTier), preserving
        //     the v25.48 CP-2b advertised==charged fallback: the advertised
        //     monthly price is authoritative and an annual cycle bills 12× it.
        // FAIL-CLOSED: if NEITHER an override NOR an advertised tier resolves the
        // resolver throws and we return 409 (never charge a silent $0). A per-
        // partner explicit $0 override is the ONLY path to a $0 amount.
        /* ── WAVE 11 / EN-6 — ONE AMOUNT PRODUCER ─────────────────────────────
         *
         * This handler used to compose `resolvePartnerEffectivePlan` +
         * `quotePartnerSubscription` itself (see git history at this line). It
         * now calls `quotePartnerCheckout`, which is the SAME function the new
         * charge route `POST /api/partner/me/checkout` calls. That is deliberate
         * and is the answer to the "second path to the same write" trap: with two
         * copies of the composition, the quote a partner is shown and the amount
         * they are charged could drift apart on any future edit to either one.
         * There is now exactly one place that turns (partner, tier, cycle, code)
         * into an amount, and both routes go through it.
         *
         * EVERY RESPONSE FIELD BELOW IS PRESERVED. W-7's `priceDerivation`,
         * XT-4's discount fields and `checkoutPath` are all still returned —
         * `checkoutPath` now points at the partner-scoped charge route instead of
         * the founder route that 403s a partner (server/routes.ts POST
         * /api/billing/plan, `not_owner` on the founder-company ownership check).
         * The old value is still reported as `legacyCheckoutPath` so nothing that
         * read it is silently broken.
         *
         * FAIL-CLOSED behaviour is unchanged: no override and no advertised tier
         * still returns 409 PARTNER_SUBSCRIPTION_NOT_AVAILABLE, and an explicit
         * per-partner $0 override remains the only route to a $0 amount. */
        let quote;
        try {
          quote = quotePartnerCheckout({
            partnerId: pid,
            tierSlug: String(tier),
            cycle,
            promotionCode:
              typeof (req.body as any)?.promotionCode === "string"
                ? (req.body as any).promotionCode
                : null,
          });
        } catch (quoteErr) {
          if (quoteErr instanceof PartnerCheckoutError) {
            return res
              .status(quoteErr.httpStatus)
              .json({ error: quoteErr.code, message: quoteErr.message });
          }
          throw quoteErr;
        }
        const existing = getActiveForSubject("partner", pid);
        res.json({
          ok: true,
          tier,
          cycle,
          amountMinor: quote.amountMinor,
          currency: quote.currency,
          computedVia: quote.computedVia,
          // W-7 — the derivation is now VISIBLE. "legacy_x12" means no admin
          // annual price is authored for this tier yet.
          priceDerivation: quote.priceDerivation,
          listAmountMinor: quote.listAmountMinor,
          // XT-4 — discount surfaced so the partner sees what was applied, and
          // WHY it was not, when a code is rejected.
          discountMinor: quote.discountMinor,
          discountCode: quote.discountCode,
          discountRejectedReason: quote.discountRejectedReason,
          trialExtensionDays: quote.trialExtensionDays,
          // WAVE 11 / EN-6 — a real POST target that a partner can actually
          // reach. The client POSTs here to mint the payment intent.
          checkoutPath: "/api/partner/me/checkout",
          checkoutMethod: "POST",
          // Preserved for any caller that read the old value.
          legacyCheckoutPath: "/api/billing/plan",
          // Reporting only: tells the UI to offer "change plan" rather than
          // "subscribe" when a subscription already exists.
          activeSubscription: existing
            ? {
                id: existing.id,
                tierSlug: existing.tierSlug,
                cycle: existing.cycle,
                status: existing.status,
                currentPeriodEnd: existing.currentPeriodEnd,
              }
            : null,
        });
      } catch (err) {
        res.status(500).json({ error: "PARTNER_SUBSCRIBE_FAILED", message: sanitizeErrorMessage(err) });
      }
    },
  );
  /* ============================================================
   * WAVE 11 / EN-6 — POST /api/partner/me/checkout
   *
   * The route that closes DEF-058 / PRM-008 / PRM-013. The old flow ended at
   * an `<a href="/api/billing/plan">`: a GET navigation to a POST-only founder
   * route which 403s a partner on its founder-company ownership check. This
   * mints the payment intent through the SAME Airwallex adapter and records the
   * money through the SAME sacred `subscriptionStore.recordPendingSubscription`
   * that the founder path uses — neither is modified.
   *
   * Auth: managing_partner + signed agreement, identical to the quote route. A
   * partner can only ever check out for THEIR OWN partnerId, because the id is
   * taken from `req.partnerContext`, never from the body.
   * ========================================================== */
  app.post(
    "/api/partner/me/checkout",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    requireSignedAgreement,
    async (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const tier = req.partnerContext!.tier;
      const body = (req.body ?? {}) as {
        cycle?: unknown;
        promotionCode?: unknown;
        returnPath?: unknown;
      };
      /* ── WAVE 45 (R3) — THE DEFAULT CYCLE IS CONFIGURATION, NOT "monthly" ──────
       *
       * This line used to read:
       *     const cycle = body.cycle === "annual" ? "annual" : "monthly";
       * so ANY request that omitted `cycle` — which is every client that had not
       * been updated — silently bought a MONTHLY subscription. Under R3 the
       * platform is ANNUAL ONLY, so that default was not merely stale: combined
       * with the x12 annual derivation it was the difference between billing
       * $240.00 and billing $5,988.00.
       *
       * Monthly is RETIRED, NOT DELETED. The monthly branch below still exists
       * and still works; whether it can be reached is decided by
       * partner_pricing_model_config, so re-opening monthly billing is a
       * configuration change rather than a code change. An explicit request for a
       * cadence the platform does not currently sell is REFUSED rather than
       * quietly downgraded to one it does. */
      const allowedCycles = purchasableCadences();
      const requestedCycle = typeof body.cycle === "string" ? body.cycle : null;
      if (requestedCycle && !allowedCycles.includes(requestedCycle)) {
        return res.status(409).json({
          ok: false,
          error: "CYCLE_NOT_PURCHASABLE",
          message:
            `The "${requestedCycle}" billing cycle is not currently offered. ` +
            `Available: ${allowedCycles.join(", ") || "(none configured)"}.`,
          availableCycles: allowedCycles,
        });
      }
      if (allowedCycles.length === 0) {
        // Never fall back to a compiled-in cadence. Refuse and say so.
        return res.status(409).json({
          ok: false,
          error: "NO_PURCHASABLE_CYCLE",
          message:
            "No billing cycle is currently purchasable. An admin must enable one in " +
            "partner_pricing_model_config before a subscription can be created.",
        });
      }
      const cycle = (requestedCycle ?? allowedCycles[0]) as "annual" | "monthly";
      const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol ?? "https";
      const host = req.get("host") ?? "localhost";
      try {
        const result = await startPartnerCheckout({
          subjectKind: "partner",
          subjectId: pid,
          tierSlug: String(tier),
          cycle,
          promotionCode: typeof body.promotionCode === "string" ? body.promotionCode : null,
          actorUserId: String((req as any).user?.id ?? (req as any).userId ?? pid),
          appOrigin: `${proto}://${host}`,
          returnPath: typeof body.returnPath === "string" ? body.returnPath : undefined,
        });
        res.json({
          ok: true,
          subscriptionId: result.subscription.id,
          status: result.subscription.status,
          gatewayStatus: result.status,
          amountMinor: result.quote.amountMinor,
          currency: result.quote.currency,
          listAmountMinor: result.quote.listAmountMinor,
          discountMinor: result.quote.discountMinor,
          discountCode: result.quote.discountCode,
          discountRejectedReason: result.quote.discountRejectedReason,
          priceDerivation: result.quote.priceDerivation,
          paymentIntentId: result.paymentIntentId,
          clientSecret: result.clientSecret,
          merchantOrderId: result.merchantOrderId,
          hostedPaymentPageUrl: result.hostedPaymentPageUrl,
          returnUrl: result.returnUrl,
          stubMode: result.stubMode,
          currentPeriodEnd: result.subscription.currentPeriodEnd,
        });
      } catch (err) {
        if (err instanceof PartnerCheckoutError) {
          return res.status(err.httpStatus).json({ error: err.code, message: err.message });
        }
        res
          .status(500)
          .json({ error: "PARTNER_CHECKOUT_FAILED", message: sanitizeErrorMessage(err) });
      }
    },
  );

  /* ============================================================
   * WAVE 11 / EN-7 — POST /api/partner/me/subscription/change/preview
   * Arithmetic only; nothing is charged and nothing moves. The 'previewed' row
   * is written by the APPLY path, not here, so a partner clicking around does
   * not litter the change ledger.
   * ========================================================== */
  app.post(
    "/api/partner/me/subscription/change/preview",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const body = (req.body ?? {}) as { toTier?: unknown; toCycle?: unknown; promotionCode?: unknown };
      try {
        const active = getActiveForSubject("partner", pid);
        if (!active) {
          return res.status(409).json({
            error: "NO_ACTIVE_SUBSCRIPTION",
            message: "There is no active subscription to change. Subscribe first.",
          });
        }
        const preview = previewPlanChange({
          subscriptionId: active.id,
          toTier: typeof body.toTier === "string" ? body.toTier : undefined,
          toCycle: body.toCycle === "annual" ? "annual" : body.toCycle === "monthly" ? "monthly" : undefined,
          promotionCode: typeof body.promotionCode === "string" ? body.promotionCode : null,
        });
        res.json({ ok: true, preview });
      } catch (err) {
        if (err instanceof PlanChangeError) {
          return res.status(err.httpStatus).json({ error: err.code, message: err.message });
        }
        res
          .status(500)
          .json({ error: "PLAN_CHANGE_PREVIEW_FAILED", message: sanitizeErrorMessage(err) });
      }
    },
  );

  /* ============================================================
   * WAVE 11 / EN-7 — POST /api/partner/me/subscription/change
   * Applies the change and records the proration as the first ever producer of
   * paymentStore's `proration` payment kind.
   * ========================================================== */
  app.post(
    "/api/partner/me/subscription/change",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const body = (req.body ?? {}) as { toTier?: unknown; toCycle?: unknown; promotionCode?: unknown };
      try {
        const active = getActiveForSubject("partner", pid);
        if (!active) {
          return res.status(409).json({
            error: "NO_ACTIVE_SUBSCRIPTION",
            message: "There is no active subscription to change. Subscribe first.",
          });
        }
        const out = applyPlanChange({
          subscriptionId: active.id,
          toTier: typeof body.toTier === "string" ? body.toTier : undefined,
          toCycle: body.toCycle === "annual" ? "annual" : body.toCycle === "monthly" ? "monthly" : undefined,
          promotionCode: typeof body.promotionCode === "string" ? body.promotionCode : null,
          actor: String((req as any).user?.id ?? pid),
        });
        res.json({ ok: true, change: out.change, subscription: out.subscription });
      } catch (err) {
        if (err instanceof PlanChangeError) {
          return res.status(err.httpStatus).json({ error: err.code, message: err.message });
        }
        res
          .status(500)
          .json({ error: "PLAN_CHANGE_FAILED", message: sanitizeErrorMessage(err) });
      }
    },
  );

  /* ============================================================
   * WAVE 11 / EN-7 — POST /api/partner/me/subscription/cancel
   * Default is cancel-at-period-end: the partner keeps what they paid for.
   * `immediate: true` ends it now and records the prorated credit.
   * ========================================================== */
  app.post(
    "/api/partner/me/subscription/cancel",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const immediate = (req.body ?? {}).immediate === true;
      try {
        const active = getActiveForSubject("partner", pid);
        if (!active) {
          return res.status(409).json({
            error: "NO_ACTIVE_SUBSCRIPTION",
            message: "There is no active subscription to cancel.",
          });
        }
        const out = cancelSubscription({
          subscriptionId: active.id,
          actor: String((req as any).user?.id ?? pid),
          immediate,
        });
        res.json({
          ok: true,
          subscription: out.subscription,
          creditMinor: out.creditMinor,
          immediate,
        });
      } catch (err) {
        if (err instanceof PlanChangeError) {
          return res.status(err.httpStatus).json({ error: err.code, message: err.message });
        }
        res.status(500).json({ error: "CANCEL_FAILED", message: sanitizeErrorMessage(err) });
      }
    },
  );
}
