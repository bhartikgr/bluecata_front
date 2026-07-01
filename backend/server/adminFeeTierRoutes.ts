/**
 * v25.46.1 — Admin CRUD endpoints for the NEW multi-section fee structures
 * (APD-018, UPDATED Rule 77). One module backs BOTH new recurring tier tables
 * plus the one new flat SPV deployment fee. Each route is SCOPED to a single
 * key family (prefix), so the Collective and Consortium sections can never read
 * or mutate each other's rows (tab-isolation, multi-section-aware).
 *
 * The generic store (server/subscriptionTierStore.ts) owns the validated UPSERT /
 * soft-delete over the recurring `*.subscription.*` rows. The flat SPV fee is
 * owned by server/consortiumFeesStore.ts. This layer owns RBAC, request parsing,
 * and the hash-chained admin audit entry. No amounts are hardcoded here.
 *
 * Endpoints (all admin-only — explicit requireAdmin for defense-in-depth on top
 * of the router-level /api/admin guard in routes.ts):
 *
 *   Collective — Section B (Cap Table Investor Membership Subscription tiers):
 *     GET    /api/admin/collective/member-subscription-tiers
 *     POST   /api/admin/collective/member-subscription-tiers          { slug, amountMinor, currency?, billingPeriod? }
 *     PUT    /api/admin/collective/member-subscription-tiers/:slug     { amountMinor, currency?, billingPeriod? }
 *     DELETE /api/admin/collective/member-subscription-tiers/:slug
 *
 *   Consortium Partners — Section A (Partner Subscription Tiers):
 *     GET    /api/admin/consortium/subscription-tiers
 *     POST   /api/admin/consortium/subscription-tiers                 { slug, amountMinor, currency?, billingPeriod? }
 *     PUT    /api/admin/consortium/subscription-tiers/:slug           { amountMinor, currency?, billingPeriod? }
 *     DELETE /api/admin/consortium/subscription-tiers/:slug
 *
 *   Consortium Partners — Section B (flat SPV Deployment fee):
 *     GET    /api/admin/consortium/spv-deployment-fee
 *     PUT    /api/admin/consortium/spv-deployment-fee                 { amountMinor, currency? }
 *
 * NOTE (Ozan correction #1): the former partner-application-fee routes are GONE
 * (no longer in scope). NOTE (Ozan correction #2): the existing flat Collective
 * Founder Application Fee keeps its ORIGINAL key + routes
 * (GET/PUT /api/admin/collective/application-fee in adminCollectiveFeeRoutes.ts)
 * and is NOT touched here.
 *
 * SEPARATE / PARALLEL to the Capavate founder/investor subscription flow
 * (Sacred Rule 76): nothing here touches capavate_subscriptions, pricing tiers,
 * paymentGatewayAdapter, or canonicalPlanResolver — only platform_fees rows.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import { appendAdminAudit } from "./adminPlatformStore";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  listTiers,
  getTier,
  upsertTier,
  softDeleteTier,
  isValidTierSlug,
  COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX,
  CONSORTIUM_SUBSCRIPTION_PREFIX,
  type TierFamily,
  type SubscriptionTier,
} from "./subscriptionTierStore";
import {
  getSpvDeploymentFee,
  setSpvDeploymentFee,
  CONSORTIUM_SPV_DEPLOYMENT_FEE_KEY,
} from "./consortiumFeesStore";
import {
  listSpvDeployments,
  recordSpvDeployment,
  isValidSpvId,
} from "./spvDeploymentStore";

function actorOf(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "admin");
}

function userIdOf(req: Request): string | null {
  return (
    (req as Request & { userContext?: { userId?: string } }).userContext
      ?.userId ?? null
  );
}

/** amountMinor must be a non-negative safe integer. Returns null on failure. */
function parseAmountMinor(b: { amountMinor?: unknown }): number | null {
  const amountMinor = b?.amountMinor;
  if (
    typeof amountMinor !== "number" ||
    !Number.isFinite(amountMinor) ||
    !Number.isInteger(amountMinor) ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0
  ) {
    return null;
  }
  return amountMinor;
}

function parseCurrency(b: { currency?: unknown }): string | undefined {
  return typeof b?.currency === "string" && b.currency.trim()
    ? b.currency.trim().toUpperCase()
    : undefined;
}

function parseBillingPeriod(b: { billingPeriod?: unknown }): string | undefined {
  const bp = b?.billingPeriod;
  if (typeof bp !== "string" || !bp.trim()) return undefined;
  const v = bp.trim().toLowerCase();
  // Allow the common recurring cadences; default handled in the store.
  return ["monthly", "quarterly", "annual", "yearly", "one_time"].includes(v)
    ? v
    : undefined;
}

/**
 * Register the full CRUD surface for ONE recurring tier family under a given
 * base path. Audit object scope is `platform_fee:<key>`; the action verb is
 * parameterized so the Collective and Consortium families produce distinct,
 * greppable audit verbs.
 */
function registerTierFamily(
  app: Express,
  opts: {
    basePath: string; // e.g. "/api/admin/consortium/subscription-tiers"
    prefix: TierFamily;
    auditScopePrefix: string; // e.g. "consortium.subscription"
    auditVerbPrefix: string; // e.g. "consortium_subscription_tier"
    responseKey: string; // e.g. "tiers"
    tag: string; // log tag
  },
): void {
  const { basePath, prefix, auditScopePrefix, auditVerbPrefix, responseKey, tag } =
    opts;

  const wrap = (rows: SubscriptionTier[] | SubscriptionTier) => ({
    ok: true,
    [responseKey]: rows,
  });

  // LIST
  app.get(basePath, requireAdmin, (_req: Request, res: Response) => {
    try {
      return res.json(wrap(listTiers(prefix)));
    } catch (err) {
      log.error(`[${tag}.list] read failed:`, (err as Error).message);
      return res.status(500).json({
        ok: false,
        error: "read_failed",
        message: sanitizeErrorMessage(err),
      });
    }
  });

  // CREATE
  app.post(basePath, requireAdmin, (req: Request, res: Response) => {
    const b = req.body as {
      slug?: unknown;
      amountMinor?: unknown;
      currency?: unknown;
      billingPeriod?: unknown;
    };
    const slug = b?.slug;
    if (!isValidTierSlug(slug)) {
      return res.status(400).json({
        ok: false,
        error: "slug must be lowercase alphanumeric/underscore (1..64 chars)",
      });
    }
    if (getTier(prefix, slug)) {
      return res
        .status(409)
        .json({ ok: false, error: "tier_already_exists", slug });
    }
    const amountMinor = parseAmountMinor(b);
    if (amountMinor === null) {
      return res.status(400).json({
        ok: false,
        error: "amountMinor must be a non-negative integer (minor units)",
      });
    }
    let created: SubscriptionTier;
    try {
      created = upsertTier({
        prefix,
        slug,
        amountMinor,
        currency: parseCurrency(b),
        billingPeriod: parseBillingPeriod(b),
        updatedByUserId: userIdOf(req),
      });
    } catch (err) {
      log.error(`[${tag}.create] upsert failed:`, (err as Error).message);
      return res.status(500).json({
        ok: false,
        error: "create_failed",
        message: sanitizeErrorMessage(err),
      });
    }
    try {
      appendAdminAudit(
        actorOf(req),
        `platform_fee:${auditScopePrefix}.${slug}`,
        `${auditVerbPrefix}_created`,
        {
          key: created.key,
          after: {
            amountMinor: created.amountMinor,
            currency: created.currency,
            billingPeriod: created.billingPeriod,
          },
        },
      );
    } catch (auditErr) {
      log.warn(
        `[${tag}.create] audit append failed (non-fatal):`,
        (auditErr as Error).message,
      );
    }
    return res.status(201).json(wrap(created));
  });

  // UPDATE
  app.put(`${basePath}/:slug`, requireAdmin, (req: Request, res: Response) => {
    const slug = req.params.slug;
    if (!isValidTierSlug(slug)) {
      return res.status(400).json({ ok: false, error: "invalid_tier_slug" });
    }
    const prev = getTier(prefix, slug);
    if (!prev) {
      return res.status(404).json({ ok: false, error: "tier_not_found", slug });
    }
    const b = req.body as {
      amountMinor?: unknown;
      currency?: unknown;
      billingPeriod?: unknown;
    };
    const amountMinor = parseAmountMinor(b);
    if (amountMinor === null) {
      return res.status(400).json({
        ok: false,
        error: "amountMinor must be a non-negative integer (minor units)",
      });
    }
    let updated: SubscriptionTier;
    try {
      updated = upsertTier({
        prefix,
        slug,
        amountMinor,
        currency: parseCurrency(b) ?? prev.currency,
        billingPeriod: parseBillingPeriod(b) ?? prev.billingPeriod,
        updatedByUserId: userIdOf(req),
      });
    } catch (err) {
      log.error(`[${tag}.update] upsert failed:`, (err as Error).message);
      return res.status(500).json({
        ok: false,
        error: "update_failed",
        message: sanitizeErrorMessage(err),
      });
    }
    try {
      appendAdminAudit(
        actorOf(req),
        `platform_fee:${auditScopePrefix}.${slug}`,
        `${auditVerbPrefix}_updated`,
        {
          key: updated.key,
          before: {
            amountMinor: prev.amountMinor,
            currency: prev.currency,
            billingPeriod: prev.billingPeriod,
          },
          after: {
            amountMinor: updated.amountMinor,
            currency: updated.currency,
            billingPeriod: updated.billingPeriod,
          },
        },
      );
    } catch (auditErr) {
      log.warn(
        `[${tag}.update] audit append failed (non-fatal):`,
        (auditErr as Error).message,
      );
    }
    return res.json(wrap(updated));
  });

  // DELETE (soft-delete; reversible, no silent physical drop)
  app.delete(
    `${basePath}/:slug`,
    requireAdmin,
    (req: Request, res: Response) => {
      const slug = req.params.slug;
      if (!isValidTierSlug(slug)) {
        return res.status(400).json({ ok: false, error: "invalid_tier_slug" });
      }
      const prev = getTier(prefix, slug);
      if (!prev) {
        return res
          .status(404)
          .json({ ok: false, error: "tier_not_found", slug });
      }
      let removed = false;
      try {
        removed = softDeleteTier(prefix, slug);
      } catch (err) {
        log.error(`[${tag}.delete] soft-delete failed:`, (err as Error).message);
        return res.status(500).json({
          ok: false,
          error: "delete_failed",
          message: sanitizeErrorMessage(err),
        });
      }
      try {
        appendAdminAudit(
          actorOf(req),
          `platform_fee:${auditScopePrefix}.${slug}`,
          `${auditVerbPrefix}_deleted`,
          {
            key: prev.key,
            before: {
              amountMinor: prev.amountMinor,
              currency: prev.currency,
              billingPeriod: prev.billingPeriod,
            },
          },
        );
      } catch (auditErr) {
        log.warn(
          `[${tag}.delete] audit append failed (non-fatal):`,
          (auditErr as Error).message,
        );
      }
      return res.json({ ok: true, deleted: removed, slug });
    },
  );
}

export function registerAdminFeeTierRoutes(app: Express): void {
  // Collective — Section B: Cap Table Investor Membership Subscription tiers.
  registerTierFamily(app, {
    basePath: "/api/admin/collective/member-subscription-tiers",
    prefix: COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX,
    auditScopePrefix: "collective.member_subscription",
    auditVerbPrefix: "collective_member_subscription_tier",
    responseKey: "tiers",
    tag: "adminFeeTierRoutes.collective",
  });

  // Consortium Partners — Section A: Partner Subscription Tiers.
  registerTierFamily(app, {
    basePath: "/api/admin/consortium/subscription-tiers",
    prefix: CONSORTIUM_SUBSCRIPTION_PREFIX,
    auditScopePrefix: "consortium.subscription",
    auditVerbPrefix: "consortium_subscription_tier",
    responseKey: "tiers",
    tag: "adminFeeTierRoutes.consortium",
  });

  /* -----------------------------------------------------------------
   * Consortium Partners — Section B: flat SPV Deployment fee.
   *   GET /api/admin/consortium/spv-deployment-fee
   *   PUT /api/admin/consortium/spv-deployment-fee  { amountMinor, currency? }
   * ----------------------------------------------------------------- */
  app.get(
    "/api/admin/consortium/spv-deployment-fee",
    requireAdmin,
    (_req: Request, res: Response) => {
      try {
        return res.json({ ok: true, spvDeploymentFee: getSpvDeploymentFee() });
      } catch (err) {
        log.error(
          "[adminFeeTierRoutes.spv-deployment.read] failed:",
          (err as Error).message,
        );
        return res.status(500).json({
          ok: false,
          error: "read_failed",
          message: sanitizeErrorMessage(err),
        });
      }
    },
  );

  app.put(
    "/api/admin/consortium/spv-deployment-fee",
    requireAdmin,
    (req: Request, res: Response) => {
      const amountMinor = parseAmountMinor(req.body as { amountMinor?: unknown });
      if (amountMinor === null) {
        return res.status(400).json({
          ok: false,
          error: "amountMinor must be a non-negative integer (minor units)",
        });
      }
      const currency = parseCurrency(req.body as { currency?: unknown });
      const prev = getSpvDeploymentFee();
      let updated;
      try {
        updated = setSpvDeploymentFee({
          amountMinor,
          currency,
          updatedByUserId: userIdOf(req),
        });
      } catch (err) {
        log.error(
          "[adminFeeTierRoutes.spv-deployment.update] failed:",
          (err as Error).message,
        );
        return res.status(500).json({
          ok: false,
          error: "update_failed",
          message: sanitizeErrorMessage(err),
        });
      }
      try {
        appendAdminAudit(
          actorOf(req),
          `platform_fee:${CONSORTIUM_SPV_DEPLOYMENT_FEE_KEY}`,
          "consortium_spv_deployment_fee_updated",
          {
            key: CONSORTIUM_SPV_DEPLOYMENT_FEE_KEY,
            before: { amountMinor: prev.amountMinor, currency: prev.currency },
            after: { amountMinor: updated.amountMinor, currency: updated.currency },
          },
        );
      } catch (auditErr) {
        log.warn(
          "[adminFeeTierRoutes.spv-deployment.update] audit append failed (non-fatal):",
          (auditErr as Error).message,
        );
      }
      return res.json({ ok: true, spvDeploymentFee: updated });
    },
  );

  /* -----------------------------------------------------------------
   * v25.47 APD-021 — Consortium SPV deployment ledger.
   *   GET  /api/admin/consortium/spv-deployments
   *   POST /api/admin/consortium/spv-deployments  { spvId, note? }
   *
   * POST is idempotent on spvId (200 with created:false on repeat). The fee is
   * DB-resolved from consortium.spv_deployment_fee at record time.
   * ----------------------------------------------------------------- */
  app.get(
    "/api/admin/consortium/spv-deployments",
    requireAdmin,
    (_req: Request, res: Response) => {
      try {
        return res.json({ ok: true, deployments: listSpvDeployments() });
      } catch (err) {
        log.error(
          "[adminFeeTierRoutes.spv-deployments.list] failed:",
          (err as Error).message,
        );
        return res.status(500).json({
          ok: false,
          error: "read_failed",
          message: sanitizeErrorMessage(err),
        });
      }
    },
  );

  app.post(
    "/api/admin/consortium/spv-deployments",
    requireAdmin,
    (req: Request, res: Response) => {
      const b = req.body as { spvId?: unknown; note?: unknown };
      if (!isValidSpvId(b?.spvId)) {
        return res.status(400).json({
          ok: false,
          error: "spvId must be alphanumeric/dash/underscore (1..128 chars)",
        });
      }
      const note = typeof b?.note === "string" ? b.note : null;
      let result;
      try {
        result = recordSpvDeployment({
          spvId: b.spvId,
          recordedByUserId: userIdOf(req),
          note,
        });
      } catch (err) {
        log.error(
          "[adminFeeTierRoutes.spv-deployments.record] failed:",
          (err as Error).message,
        );
        return res.status(500).json({
          ok: false,
          error: "record_failed",
          message: sanitizeErrorMessage(err),
        });
      }
      if (result.created) {
        try {
          appendAdminAudit(
            actorOf(req),
            `spv_deployment:${result.deployment.spvId}`,
            "consortium_spv_deployment_recorded",
            {
              id: result.deployment.id,
              after: {
                spvId: result.deployment.spvId,
                feeMinor: result.deployment.feeMinor,
                currency: result.deployment.currency,
              },
            },
          );
        } catch (auditErr) {
          log.warn(
            "[adminFeeTierRoutes.spv-deployments.record] audit append failed (non-fatal):",
            (auditErr as Error).message,
          );
        }
      }
      return res
        .status(result.created ? 201 : 200)
        .json({ ok: true, created: result.created, deployment: result.deployment });
    },
  );
}
