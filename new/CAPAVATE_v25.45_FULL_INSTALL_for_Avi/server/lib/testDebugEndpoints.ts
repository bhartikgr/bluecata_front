/**
 * v25.5 — Test-debug endpoints.
 *
 * These routes exist ONLY to allow the v25.5 E2E suite to exercise paths
 * that are otherwise unreachable from the public API surface:
 *
 *   1. Forcing a collective renewal worker tick on demand (instead of
 *      waiting 60s for the natural poll interval).
 *   2. Injecting a synthetic bridge_outbox row to verify the hydrate path
 *      works end-to-end without racing the drain worker.
 *   3. Reading the in-memory bridge outbox snapshot to verify hydration.
 *
 * EVERY endpoint here is gated by BOTH:
 *   - process.env.ENABLE_TEST_DEBUG_ENDPOINTS === "1"
 *   - requireAdmin middleware (caller must be authenticated admin)
 *
 * In production deploys, ENABLE_TEST_DEBUG_ENDPOINTS is unset, so all routes
 * 404. The flag is only set in CI/test environments. No production surface
 * is exposed by this file.
 */

/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response, NextFunction } from "express";
import { tick as collectiveRenewalTick } from "./collectiveRenewalWorker";
import { hydrateBridgeStore } from "../bridgeStore";
import { rawDb } from "../db/connection";
import { log } from "./logger";
import { requireAuth } from "./authMiddleware";

function isEnabled(): boolean {
  return process.env.ENABLE_TEST_DEBUG_ENDPOINTS === "1";
}

function gate(_req: Request, res: Response, next: NextFunction): void {
  if (!isEnabled()) {
    res.status(404).json({ ok: false, error: "not_found" });
    return;
  }
  next();
}

function requireAdminInline(req: Request, res: Response, next: NextFunction): void {
  const ctx = (req as any).userContext;
  if (!ctx?.isAdmin) {
    res.status(403).json({ ok: false, error: "admin_only" });
    return;
  }
  next();
}

export function registerTestDebugEndpoints(app: Express): void {
  if (!isEnabled()) {
    log.info({ route: "testDebug.init", message: "disabled (set ENABLE_TEST_DEBUG_ENDPOINTS=1 to enable)" });
    return;
  }
  log.warn({ route: "testDebug.init", message: "ENABLED — routes must never be enabled in production" });

  /**
   * v25.6 — POST /api/admin/_test/reset-rate-limits
   * Clears the in-memory auth rate-limit buckets so test suites that need
   * many signups/logins do not hit the 5/hour gate. Production has this
   * unset and the buckets persist normally.
   */
  app.post(
    "/api/admin/_test/reset-rate-limits",
    gate,
    requireAuth,
    requireAdminInline,
    (_req: Request, res: Response) => {
      try {
        const rateLimit = require("./rateLimit");
        if (typeof rateLimit._resetAuthRateLimitsForTests === "function") {
          rateLimit._resetAuthRateLimitsForTests();
        }
        return res.json({ ok: true, reset: true });
      } catch (err) {
        return res
          .status(500)
          .json({ ok: false, error: "reset_failed", message: (err as Error).message });
      }
    },
  );

  /**
   * v25.6 — POST /api/admin/_test/create-investor
   * Body: { email, name }
   * Bypasses the INVESTOR_SIGNUP_DISALLOWED gate so v25.6 tests can create
   * an investor without going through the invitation-redeem flow. Inserts
   * directly into the users table with role='investor'.
   */
  app.post(
    "/api/admin/_test/create-investor",
    gate,
    requireAuth,
    requireAdminInline,
    (req: Request, res: Response) => {
      const { email, name } = req.body ?? {};
      if (!email || !name) {
        return res.status(400).json({ ok: false, error: "email_and_name_required" });
      }
      try {
        const db: any = rawDb();
        const userId = `u_investor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        const password = "InvestorTest25!Strong";
        /* v25.6 — mirror scripts/create_admin.ts: write to BOTH users and
         * user_credentials so the auth path's verifyPassword() succeeds. */
        db.prepare(
          `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
             VALUES (?, 'tenant_admin_capavate', ?, ?, 'investor', 0, NULL)`,
        ).run(userId, email, name);
        /* Use the canonical storeCredential helper so bcrypt rounds + algo
         * match the production path. */
        const { storeCredential } = require("../userCredentialsStore");
        storeCredential({ userId, email, name, password });
        return res.json({ ok: true, userId, email, password });
      } catch (err) {
        return res
          .status(500)
          .json({ ok: false, error: "create_failed", message: (err as Error).message });
      }
    },
  );

  /**
   * v25.6 — POST /api/admin/_test/grant-partner-membership
   * Body: { userId, partnerId, role? }
   * Inserts an active partner_team_members row so the target user passes
   * requirePartnerAuth on /api/partner/me/* endpoints.
   */
  app.post(
    "/api/admin/_test/grant-partner-membership",
    gate,
    requireAuth,
    requireAdminInline,
    (req: Request, res: Response) => {
      const { userId, partnerId, role } = req.body ?? {};
      if (!userId || !partnerId) {
        return res.status(400).json({ ok: false, error: "userId_and_partnerId_required" });
      }
      try {
        const db: any = rawDb();
        const memberId = `ptm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const now = new Date().toISOString();
        const adminId = (req as any).userContext?.userId ?? "u_admin_test";
        /* v25.6 — actual schema is { id, partner_id, user_id, sub_role,
         * status, joined_at, removed_at, created_by, is_seed, updated_at }.
         * No created_at / deleted_at columns. */
        db.prepare(
          `INSERT OR REPLACE INTO partner_team_members (
             id, partner_id, user_id, sub_role, status,
             joined_at, removed_at, created_by, is_seed, updated_at
           ) VALUES (?, ?, ?, ?, 'active', ?, NULL, ?, 0, ?)`,
        ).run(
          memberId,
          partnerId,
          userId,
          role ?? "managing_partner",
          now,
          adminId,
          now,
        );
        return res.json({ ok: true, memberId, partnerId, userId, role: role ?? "managing_partner" });
      } catch (err) {
        return res
          .status(500)
          .json({ ok: false, error: "grant_failed", message: (err as Error).message });
      }
    },
  );

  /**
   * POST /api/admin/_test/collective-renewal-tick
   * Triggers one sweep of the collective renewal worker immediately.
   * Returns the sweep counts.
   */
  app.post(
    "/api/admin/_test/collective-renewal-tick",
    gate,
    requireAuth,
    requireAdminInline,
    async (_req: Request, res: Response) => {
      try {
        const result = await collectiveRenewalTick();
        return res.json({ ok: true, ...result });
      } catch (err) {
        return res
          .status(500)
          .json({ ok: false, error: "tick_failed", message: (err as Error).message });
      }
    },
  );

  /**
   * POST /api/admin/_test/bridge-outbox/inject
   * Body: { eventId, eventType, aggregateId, aggregateKind, payload }
   * Inserts a synthetic envelope directly into bridge_outbox (status=queued).
   * Used to verify hydrate without racing the drain worker.
   */
  app.post(
    "/api/admin/_test/bridge-outbox/inject",
    gate,
    requireAuth,
    requireAdminInline,
    (req: Request, res: Response) => {
      const { eventId, eventType, aggregateId, aggregateKind, payload } = req.body ?? {};
      if (!eventId || !eventType) {
        return res.status(400).json({ ok: false, error: "eventId_and_eventType_required" });
      }
      try {
        const db: any = rawDb();
        const envelope = {
          eventId,
          eventType,
          aggregateId: aggregateId ?? "test_aggregate",
          aggregateKind: aggregateKind ?? "test",
          occurredAt: new Date().toISOString(),
          schemaVersion: "1.0",
          payload: payload ?? {},
          /* v25.5 — synthesize an auditChain so the rehydrated envelope shape
           * matches a production envelope. The verifier skips entries with no
           * chain link to prior; placing a placeholder priorHash keeps the
           * verify-chain endpoint defensive. */
          auditChain: {
            priorHash: "0000000000000000000000000000000000000000000000000000000000000000",
            hash: "test_hash_" + eventId,
          },
        };
        const envelopeJson = JSON.stringify(envelope);
        db.prepare(
          `INSERT OR REPLACE INTO bridge_outbox (
             id, event_type, aggregate_id, aggregate_kind, envelope_json,
             hmac, status, attempts, next_retry_at, enqueued_at, delivered_at, last_error
           ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, NULL, NULL)`,
        ).run(
          eventId,
          eventType,
          aggregateId ?? "test_aggregate",
          aggregateKind ?? "test",
          envelopeJson,
          "test_hmac_placeholder",
          Date.now(),
          new Date().toISOString(),
        );
        return res.json({ ok: true, eventId });
      } catch (err) {
        return res
          .status(500)
          .json({ ok: false, error: "insert_failed", message: (err as Error).message });
      }
    },
  );

  /**
   * POST /api/admin/_test/bridge-outbox/rehydrate
   * Forces hydrateBridgeStore() to run, then returns the count of in-memory entries.
   */
  app.post(
    "/api/admin/_test/bridge-outbox/rehydrate",
    gate,
    requireAuth,
    requireAdminInline,
    (_req: Request, res: Response) => {
      try {
        hydrateBridgeStore();
        return res.json({ ok: true, hydrated: true });
      } catch (err) {
        return res
          .status(500)
          .json({ ok: false, error: "hydrate_failed", message: (err as Error).message });
      }
    },
  );

  /**
   * GET /api/admin/_test/db-row?table=...&id=...
   * Returns one row from any table by id (read-only). Used to verify
   * persistence round-trips for commsTiers tables in particular.
   */
  app.get(
    "/api/admin/_test/db-row",
    gate,
    requireAuth,
    requireAdminInline,
    (req: Request, res: Response) => {
      const table = String(req.query.table ?? "");
      const id = String(req.query.id ?? "");
      // Whitelist tables we allow reading from (defense in depth).
      const allowed = new Set([
        "bridge_outbox",
        "collective_memberships_billing",
        "comms_co_investor_groups",
        "comms_co_investor_group_messages",
        "comms_intro_requests",
        "comms_soft_circle_peer_opt_ins",
        "comms_ioi_pulses",
        "comms_endorsements",
        "comms_cross_cohort_dms",
        "comms_qa_questions",
        "comms_qa_answers",
        "comms_diligence_volunteers",
        "comms_mute_list",
        "comms_high_value_advocates",
      ]);
      if (!allowed.has(table)) {
        return res.status(400).json({ ok: false, error: "table_not_whitelisted" });
      }
      if (!id) {
        return res.status(400).json({ ok: false, error: "id_required" });
      }
      try {
        const db: any = rawDb();
        const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`).get(id);
        return res.json({ ok: true, table, id, row: row ?? null });
      } catch (err) {
        return res
          .status(500)
          .json({ ok: false, error: "read_failed", message: (err as Error).message });
      }
    },
  );

  /**
   * POST /api/admin/_test/billing/advance-period
   * Body: { billingId, newCurrentPeriodEnd (epoch sec) }
   * Sets the current_period_end on a billing row so the renewal worker
   * picks it up on the next tick. Used to fast-forward expiry without
   * waiting an actual year.
   */
  app.post(
    "/api/admin/_test/billing/advance-period",
    gate,
    requireAuth,
    requireAdminInline,
    (req: Request, res: Response) => {
      const { billingId, newCurrentPeriodEnd, cancelAtPeriodEnd } = req.body ?? {};
      if (!billingId || !Number.isFinite(newCurrentPeriodEnd)) {
        return res
          .status(400)
          .json({ ok: false, error: "billingId_and_newCurrentPeriodEnd_required" });
      }
      try {
        const db: any = rawDb();
        const result = db
          .prepare(
            `UPDATE collective_memberships_billing
                SET current_period_end = ?,
                    cancel_at_period_end = COALESCE(?, cancel_at_period_end),
                    updated_at = ?
              WHERE id = ?`,
          )
          .run(
            Number(newCurrentPeriodEnd),
            cancelAtPeriodEnd === true ? 1 : cancelAtPeriodEnd === false ? 0 : null,
            new Date().toISOString(),
            billingId,
          );
        return res.json({ ok: true, changes: result.changes });
      } catch (err) {
        return res
          .status(500)
          .json({ ok: false, error: "update_failed", message: (err as Error).message });
      }
    },
  );

  /**
   * POST /api/admin/_test/airwallex/sign-webhook
   * Body: { body: string|object, timestamp?: string }
   * Returns a valid HMAC signature so tests can call the real webhook
   * endpoint without exposing the secret.
   */
  app.post(
    "/api/admin/_test/airwallex/sign-webhook",
    gate,
    requireAuth,
    requireAdminInline,
    (req: Request, res: Response) => {
      try {
        const { signWebhookBody } = require("./airwallexGateway");
        const body = req.body?.body;
        const raw = typeof body === "string" ? body : JSON.stringify(body ?? {});
        const timestamp = String(req.body?.timestamp ?? Date.now());
        const signature = signWebhookBody(raw, timestamp);
        return res.json({ ok: true, signature, timestamp, rawBody: raw });
      } catch (err) {
        return res
          .status(500)
          .json({ ok: false, error: "sign_failed", message: (err as Error).message });
      }
    },
  );

  /**
   * POST /api/admin/_test/grant-collective-member
   * Body: { userId }
   * Grants the target user active collective membership status so they
   * can hit the collective-billing endpoints. Used to bypass the natural
   * waitlist+approval flow in test scenarios.
   */
  app.post(
    "/api/admin/_test/grant-collective-member",
    gate,
    requireAuth,
    requireAdminInline,
    (req: Request, res: Response) => {
      const { userId } = req.body ?? {};
      if (!userId) {
        return res.status(400).json({ ok: false, error: "userId_required" });
      }
      try {
        const collectiveMembershipStore = require("../collectiveMembershipStore");
        const adminId = (req as any).userContext?.userId ?? "u_admin_test";
        collectiveMembershipStore.activate(userId, adminId, "standard");
        /* v25.5 — also seed a chapter_memberships row so isChapterMember()
         * (used by collective billing routes) returns true. The activate()
         * call above only writes to collective_memberships, which is a
         * separate table. */
        const chapterId = String(req.body?.chapterId ?? "default");
        const tenantId = `tenant_chap_${chapterId}`;
        const now = new Date().toISOString();
        try {
          const db: any = rawDb();
          db.prepare(
            `INSERT OR REPLACE INTO chapter_memberships (
               id, tenant_id, chapter_id, user_id, role, status,
               joined_at, created_at, updated_at, deleted_at
             ) VALUES (?, ?, ?, ?, 'member', 'active', ?, ?, ?, NULL)`,
          ).run(`cm_${userId}_${chapterId}`, tenantId, chapterId, userId, now, now, now);
        } catch (e) {
          log.warn({
            route: "testDebug.grantCollectiveMember",
            message: `chapter_memberships insert failed: ${(e as Error).message}`,
          });
        }
        return res.json({ ok: true, userId, status: "active", chapterId });
      } catch (err) {
        return res
          .status(500)
          .json({ ok: false, error: "activate_failed", message: (err as Error).message });
      }
    },
  );
}
