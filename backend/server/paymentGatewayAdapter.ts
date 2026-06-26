/**
 * Sprint 28 Billing — Payment Gateway Adapter.
 *
 * Thin wrapper over paymentStore.chargeOrIdempotent + invoiceStore.createInvoice.
 * Exposes:
 *   - chargeSubscription(...)  → payment entry + invoice (status: paid)
 *   - chargeRefund(...)        → refund payment + invoice.refunded event
 *   - getPublicConfig()        → gateway info for admin Payment Gateway tab
 *   - webhook handler (POST /api/webhooks/payment-gateway) — idempotent
 *
 * Key design decisions (Stripe-compatible):
 *   - Intent IDs are derived from {subscriptionId}:{periodStart} so the same
 *     billing period can never be charged twice.
 *   - All money is integer minor units + ISO 4217. Floats are BANNED.
 *   - On success the invoice is automatically marked "paid".
 *   - 3DS flow: if gateway returns requires_3ds the caller gets
 *     { ok: false, requires3ds: true, clientSecret } and must redirect.
 */
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { chargeOrIdempotent, type PaymentEntry } from "./paymentStore";
import { createInvoice, createInvoiceInTransaction, refundInvoice, markInvoicePaid, getInvoice, countInvoicesForCompany, type Invoice } from "./invoiceStore";
import { getSubscription, updateSubscription, createSubscriptionForNewCompany, type Subscription } from "./subscriptionsStore";
import { appendAdminAudit } from "./adminPlatformStore";
// Patch v6 — free-plan activation needs a company + user context.
import { getUserContext } from "./lib/userContext";
import { addCompanyForFounder, getCompaniesForFounder, getActiveCompanyId, setActiveCompanyId, type FounderCompanyMembership } from "./multiCompanyStore";
// v19 Wave A / Change 3 — AirWallex is the new default gateway. The resolver
// picks between AirWallex and Stripe per env (PAYMENT_GATEWAY_DEFAULT). We do
// NOT touch the existing chargeSubscription / chargeRefund signatures — those
// remain stable. We do, however, augment getPublicConfig() to return BOTH
// gateways and add per-gateway webhook handlers below.
import {
  getDefaultGatewayId,
  listPublicGatewayConfig,
  isGatewayReady,
} from "./lib/paymentGatewayResolver";
import { verifyWebhookSignature as verifyAirwallexSig } from "./lib/airwallexGateway";
import { verifyWebhookSignature as verifyStripeSig } from "./lib/stripeGateway";
import { requireAuth } from "./lib/authMiddleware"; /* v25.17 Lane C NC6 */
import { log } from "./lib/logger";
// v24.2 Airwallex wiring — the per-gateway webhook now flips the Capavate
// checkout-subscription record (minted by POST /api/billing/plan) from pending
// to active on a confirmed payment. This is the ONLY place that activates a
// subscription: Airwallex is the source of truth.
import {
  getByPaymentIntent as getCapSubByPaymentIntent,
  getByMerchantOrderId as getCapSubByMerchantOrderId,
  activateByPaymentIntent as activateCapSub,
  failByPaymentIntent as failCapSub,
  listForCompany as listCapSubsForCompany,
  type CapavateSubscription,
} from "./subscriptionStore";
import { emitBillingEvent } from "./lib/billingEvents";
import { getDb, rawDb } from "./db/connection"; // v25.32 deep — webhook claim+finalize transaction (top-level import so the lazy require() is never evaluated INSIDE a better-sqlite3 transaction, which breaks the tsx TS-require hook)
import * as pricingTiers from "./pricingTiersStore"; // v25.32 deep — static import: the plan-label lookup runs INSIDE the webhook transaction, where a first-time lazy require() of a .ts module throws "Unexpected token 'const'" under the createRequire shim. No circular dep (pricingTiersStore -> pricingModelStore only).

/* ---------- Types ---------- */

export interface ChargeSubscriptionInput {
  companyId: string;
  subscriptionId: string;
  pricingModelId: string;
  currency: string;
  region?: string;
  amountMinor: number;
  planLabel: string;
  periodStart: string;
  periodEnd: string;
  paymentMethodToken: string;
  cardLast4?: string;
  couponCode?: string;
}

export interface ChargeSubscriptionResult {
  ok: boolean;
  deduped?: boolean;
  paymentEntry: PaymentEntry;
  invoice: Invoice;
  requires3ds?: boolean;
  clientSecret?: string;
}

export interface ChargeRefundInput {
  paymentEntryId: string;
  invoiceId: string;
  amountMinor: number;
  reason: string;
  actor?: string;
}

export interface GatewayConfig {
  name: string;
  mode: "test" | "live";
  supportedMethods: string[];
  webhookUrl: string;
  version: string;
}

/* ---------- Idempotency ---------- */

/* v25.11 NH3 fix — the prior implementation kept processed-webhook keys in a
 * RAM-only Set, so any server restart within the gateway's retry window
 * (Airwallex: 72h, Stripe: 72h) allowed duplicate processing of the same
 * webhook event — a financial-integrity vulnerability.
 *
 * v25.32 deep — the in-memory `processedWebhookEvents` Set fast-path was NOT
 * cross-process safe and is forbidden by Ozan's standing rule (nothing in
 * memory; all DB-driven). The Set is REMOVED entirely. Idempotency is now
 * DB-only against `processed_webhook_events` (DDL promoted to the boot schema
 * in server/db/connection.ts — no lazy per-process table creation). The
 * `_recordWebhookKey` insert is `INSERT OR IGNORE` so concurrent processes
 * race-safely converge on the single PRIMARY KEY `key` row, and the webhook
 * handlers claim the key INSIDE the finalize transaction (see
 * handleGatewayWebhook). */

function _webhookKeyAlreadyProcessed(key: string): boolean {
  // v25.32 deep — DB-only idempotency check. Fail OPEN on DB error: the
  // PRIMARY KEY on insert (and the transactional claim) is the real guard.
  try {
    const db: any = rawDb();
    const row: any = db.prepare(
      `SELECT 1 FROM processed_webhook_events WHERE key = ? LIMIT 1`,
    ).get(key);
    return !!row;
  } catch (e) {
    log.warn("[webhook] DB idempotency check failed:", (e as Error).message);
    return false;
  }
}

/**
 * v25.32 deep — claim a webhook key. Returns true if THIS call claimed the key
 * (i.e. it was previously unclaimed), false if it was already present. The
 * `INSERT OR IGNORE` makes the claim atomic and race-safe across processes; the
 * `changes` count tells the caller whether they won the claim. Callers run this
 * INSIDE the finalize transaction so a downstream failure rolls the claim back
 * and the next retry can repair. */
function _claimWebhookKey(key: string): boolean {
  /* v25.32 final — FAIL CLOSED. The previous fail-open behavior (returning
   * `true` and letting processing proceed on DB error) violated Ozan's
   * "nothing in memory" rule — it let downstream writes run without a
   * durable idempotency claim. We now throw on DB failure so the outer
   * webhook handler returns 5xx and the provider retries; the next attempt
   * either claims cleanly or hits the same DB error and retries again until
   * the DB is reachable. NEVER process a webhook without a durable claim. */
  const db: any = rawDb();
  const result: any = db.prepare(
    `INSERT OR IGNORE INTO processed_webhook_events (key, processed_at) VALUES (?, ?)`,
  ).run(key, new Date().toISOString());
  return result.changes > 0;
}

function _recordWebhookKey(key: string): void {
  // v25.32 deep — DB-only. INSERT OR IGNORE so concurrent processes don't race
  // on the PRIMARY KEY. Retained for the legacy non-transactional endpoint.
  try {
    const db: any = rawDb();
    db.prepare(
      `INSERT OR IGNORE INTO processed_webhook_events (key, processed_at) VALUES (?, ?)`,
    ).run(key, new Date().toISOString());
  } catch (e) {
    log.warn("[webhook] DB idempotency record failed:", (e as Error).message);
  }
}

function webhookKey(intentId: string, type: string): string {
  return `${intentId}::${type}`;
}

/* v25.32 burndown — item 40: processed_webhook_events retention. The
   idempotency claim table is append-only and would otherwise grow unbounded.
   Payment gateways never retry a webhook beyond a few days, so claims older
   than the retention window can never cause a replay and are safe to reap.
   This runs BEST-EFFORT and OUTSIDE the finalize transaction (called at the
   top of handleGatewayWebhook, before getDb().transaction), so it can never
   roll back or interfere with the transactional claim. It is sampled (≈ 1 in
   20 calls) so it does not add a DELETE to every webhook — no module-scope
   state is introduced (sampling is stateless; missing a run is harmless).
   Source: server/db/connection.ts processed_webhook_events DDL. */
const WEBHOOK_EVENT_RETENTION_DAYS = 90;
function _reapProcessedWebhookEvents(): void {
  // Sample so we don't pay the DELETE cost on every webhook. Stateless.
  if (Math.random() >= 0.05) return;
  try {
    rawDb()
      .prepare(
        `DELETE FROM processed_webhook_events WHERE processed_at < datetime('now', ?)`,
      )
      .run(`-${WEBHOOK_EVENT_RETENTION_DAYS} days`);
  } catch (e) {
    // Best-effort: a failed reap never affects webhook processing.
    log.warn("[webhook] processed_webhook_events retention reap failed (non-fatal):", (e as Error).message);
  }
}

/* ---------- Core operations ---------- */

/**
 * Charge a subscription billing cycle. Idempotent on (subscriptionId, periodStart).
 */
export function chargeSubscription(input: ChargeSubscriptionInput): ChargeSubscriptionResult {
  // Derive a stable intent ID from the billing period
  const intentId = createHash("sha256")
    .update(`${input.subscriptionId}:${input.periodStart}`)
    .digest("hex")
    .slice(0, 24);

  // Charge via paymentStore (idempotent)
  const { entry, deduped } = chargeOrIdempotent({
    intentId,
    kind: "company_billing",
    amountCents: input.amountMinor,
    currency: input.currency,
    customerId: input.companyId,
    description: `${input.planLabel} — ${input.periodStart} to ${input.periodEnd}`,
    couponCode: input.couponCode,
    /* v25.17 Lane C NC4 — do not silently force "succeeded" in production.
       In production with no real gateway wired, the only legitimate path is to
       gate on PAYMENT_GATEWAY_LIVE=1 (set when the org has wired Stripe/etc).
       Otherwise, default to "demo" so the call is observable and the invoice
       is clearly marked demo. */
    forceState:
      process.env.NODE_ENV === "production"
        ? (process.env.PAYMENT_GATEWAY_LIVE === "1" ? "succeeded" : "demo")
        : "demo",
  });

  // Check for 3DS
  if (entry.state === "requires_3ds") {
    return {
      ok: false,
      requires3ds: true,
      clientSecret: `3ds_${randomBytes(8).toString("hex")}`,
      paymentEntry: entry,
      invoice: {} as Invoice, // not yet created — pending 3DS completion
    };
  }

  // Create or retrieve invoice
  // If deduped, find the existing invoice for this payment
  let invoice: Invoice;
  if (deduped && entry.invoiceId) {
    const existing = getInvoice(entry.invoiceId);
    if (existing) {
      return { ok: true, deduped: true, paymentEntry: entry, invoice: existing };
    }
  }

  invoice = createInvoice({
    companyId: input.companyId,
    subscriptionId: input.subscriptionId,
    planLabel: input.planLabel,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    amountMinor: entry.amountCents, // net after any coupon
    currency: input.currency,
    taxMinor: 0,
    paymentEntryId: entry.id,
    cardLast4: input.cardLast4,
    actor: "gateway:subscription_charge",
  });

  // Bump invoiceCount on subscription
  const sub = getSubscription(input.companyId);
  if (sub) {
    updateSubscription(
      input.companyId,
      { invoicesCount: sub.invoicesCount + 1, status: "active" },
      "system:payment_gateway",
    );
  }

  return { ok: true, deduped: false, paymentEntry: entry, invoice };
}

/**
 * Refund a payment. Creates a negative-amount invoice linked to the original.
 */
export function chargeRefund(input: ChargeRefundInput): { ok: boolean; refundEntry: PaymentEntry; refundInvoice: Invoice } {
  const actor = input.actor ?? "system:refund";

  // Issue a refund payment entry
  const intentId = `refund_${input.paymentEntryId}_${createHash("sha256").update(input.reason).digest("hex").slice(0, 8)}`;
  const { entry: refundEntry } = chargeOrIdempotent({
    intentId,
    kind: "refund",
    amountCents: -Math.abs(input.amountMinor),
    currency: "USD", // will be overridden by invoice currency
    customerId: "system",
    description: `Refund: ${input.reason}`,
    forceState: "succeeded",
  });

  // Create negative invoice
  const refInv = refundInvoice(input.invoiceId, input.amountMinor, input.reason, actor);

  return { ok: true, refundEntry, refundInvoice: refInv };
}

/**
 * Public gateway configuration returned to the admin Payment Gateway tab.
 *
 * v19 Wave A / Change 3: now reports the v19 default gateway (AirWallex)
 * alongside Stripe. The legacy single-gateway shape is preserved for
 * back-compat — callers that want the per-gateway list should hit
 * `getPublicGatewayList()`.
 */
export function getPublicConfig(): GatewayConfig & { defaultGateway?: string; defaultWebhookUrl?: string } {
  const def = getDefaultGatewayId();
  return {
    name: def === "airwallex" ? "AirWallex" : "Stripe",
    mode: process.env.NODE_ENV === "production" ? "live" : "test",
    supportedMethods: def === "airwallex"
      ? ["card", "wechat_pay", "alipay", "bank_transfer"]
      : ["card", "sepa", "ach"],
    // Legacy generic webhook path — PRESERVED for back-compat with sprint28 tests
    // and existing integrations. The v19 per-gateway path is exposed in
    // `defaultWebhookUrl` below.
    webhookUrl: "/api/webhooks/payment-gateway",
    version: "2.0",
    defaultGateway: def,
    defaultWebhookUrl: `/api/webhooks/payment-gateway/${def}`,
  };
}

/**
 * v19 Wave A / Change 3 — per-gateway public config (admin Payment Gateway tab).
 */
export function getPublicGatewayList() {
  return listPublicGatewayConfig();
}

/* ---------- Routes ---------- */

/**
 * v23.4.5 BUG 018 — per-user auto-provision lock.
 *
 * Serializes concurrent calls to /api/founder/subscription/charge for the
 * same userId so we don't mint duplicate companies on a parallel double-tap.
 *
 * v25.32 final — the in-memory `AUTO_PROVISION_LOCKS` Map<string, Promise>
 * is REPLACED by a DB-backed lock against `provisioning_locks` (Ozan's rule:
 * "nothing in memory"). The atomic acquire is `INSERT OR IGNORE` against the
 * UNIQUE lock_key; the loser callers either back off and retry once or
 * (cleaner) wait until the lock_key expires. Locks are short-lived (10s
 * default) and we opportunistically clean expired rows on every acquire.
 * This is also cross-process safe (the previous Map was only single-process).
 */
const PROVISION_LOCK_TTL_MS = 10_000;
async function acquireAutoProvisionLock(
  userId: string,
  task: () => Promise<string | null>,
): Promise<string | null> {
  const db: any = rawDb();
  const lockKey = `autoprovision::${userId}`;
  const holder = `${process.pid}::${randomBytes(4).toString("hex")}`;
  const now = Date.now();
  const acquiredAt = new Date(now).toISOString();
  const expiresAt = new Date(now + PROVISION_LOCK_TTL_MS).toISOString();

  // Opportunistic cleanup of expired locks (best-effort; safe to fail).
  try {
    db.prepare(`DELETE FROM provisioning_locks WHERE expires_at < ?`).run(acquiredAt);
  } catch { /* non-fatal */ }

  // Try to acquire. If we lose, briefly retry waiting for the holder to
  // release (mirrors the prior await-pending semantics).
  let acquired = false;
  for (let i = 0; i < 20; i++) { // ~2s max wait at 100ms
    try {
      const result: any = db.prepare(
        `INSERT OR IGNORE INTO provisioning_locks (lock_key, holder, acquired_at, expires_at) VALUES (?, ?, ?, ?)`,
      ).run(lockKey, holder, acquiredAt, expiresAt);
      if (result.changes > 0) { acquired = true; break; }
    } catch {
      // DB error — fall through to retry; if persistent we'll exhaust the loop.
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  /* v25.32 final — FAIL CLOSED if the lock was not acquired. The previous
   * fall-through behavior (run the task anyway) defeated the lock's
   * correctness guarantee under contention or DB failure — a duplicate
   * company could be minted. Now we throw a retryable error so the caller
   * surfaces 5xx and the client/founder can retry. */
  if (!acquired) {
    throw new Error(
      `provisioning_lock_unavailable: could not acquire ${lockKey} after retry window; refusing to run protected task`,
    );
  }
  try {
    return await task();
  } finally {
    try {
      db.prepare(
        `DELETE FROM provisioning_locks WHERE lock_key = ? AND holder = ?`,
      ).run(lockKey, holder);
    } catch { /* non-fatal: TTL cleanup will reap it */ }
  }
}

export function registerPaymentGatewayRoutes(app: Express): void {
  /**
   * GET /api/admin/payment-gateway/config
   * Returns gateway config for the admin UI tab.
   */
  app.get("/api/admin/payment-gateway/config", (_req: Request, res: Response) => {
    res.json({ ok: true, gateway: getPublicConfig() });
  });

  /**
   * GET /api/admin/payment-gateway/webhook-events
   * Returns recent webhook event log.
   */
  app.get("/api/admin/payment-gateway/webhook-events", (_req: Request, res: Response) => {
    res.json({ ok: true, events: listRecentWebhookEvents(100) });
  });

  /**
   * POST /api/founder/subscription/activate-free  — Patch v6
   * Brand-new authenticated founder activates the Founder Free plan.
   * - If the founder has no company, auto-creates a personal sandbox company.
   * - If a subscription does not exist for that company, creates one (plan=founder_free).
   * - Updates the subscription status to 'active' (free tier requires no payment).
   * Idempotent: a subsequent call returns the same active subscription.
   */
  app.post("/api/founder/subscription/activate-free", async (req: Request, res: Response) => {
    const ctx = await getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    // V3 (Patch v8): respect body `companyId` so multi-company founders can
    // activate a specific company. Falls back to active company when absent.
    // Also enforces ownership: the founder must own the requested companyId.
    const bodyCompanyId = typeof (req.body as { companyId?: unknown })?.companyId === "string"
      ? (req.body as { companyId: string }).companyId
      : null;

    // 1) Ensure the founder has a company.
    let companies = getCompaniesForFounder(ctx.userId);
    let companyId: string | null = bodyCompanyId
      ? (companies.some((c) => c.companyId === bodyCompanyId) ? bodyCompanyId : null)
      : getActiveCompanyId(ctx.userId);
    if (bodyCompanyId && companyId === null) {
      return res.status(403).json({ ok: false, error: "not_founder_of_company", companyId: bodyCompanyId });
    }
    if (!companies.length || !companyId) {
      const newId = `co_${randomBytes(6).toString("hex")}`;
      const founderName = (ctx.identity?.name ?? "My Company").trim() || "My Company";
      const newCompany: FounderCompanyMembership = {
        companyId: newId,
        companyName: `${founderName}'s Workspace`,
        legalName: `${founderName}'s Workspace, Inc.`,
        logoUrl: null,
        role: "founder",
        lastActiveAt: new Date().toISOString(),
        kpi: {
          capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0,
          dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 1.0,
        },
        collective: { status: "none" },
        billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
        sector: "",
        stage: "",
        hq: "",
      };
      addCompanyForFounder(ctx.userId, newCompany);
      setActiveCompanyId(ctx.userId, newId);
      companyId = newId;
    }

    if (!companyId) {
      return res.status(500).json({ ok: false, error: "failed_to_provision_company" });
    }

    // 2) Ensure a subscription exists for this company.
    let sub = getSubscription(companyId);
    if (!sub) {
      const created = createSubscriptionForNewCompany(companyId, {
        plan: "founder_free",
        actor: `founder:${ctx.userId}`,
      });
      sub = created.subscription;
    }

    // 3) Activate (free tier doesn't require payment).
    const upd = updateSubscription(
      companyId,
      { status: "active", plan: "founder_free" },
      `founder:${ctx.userId}`,
    );
    if (!upd.ok) {
      return res.status(500).json({ ok: false, error: upd.error });
    }

    return res.json({ ok: true, companyId, subscription: upd.subscription });
  });

  /**
   * POST /api/founder/subscription/charge
   * Founder triggers a subscription charge. Body: { pricingModelId, paymentMethod: { tokenized, cardLast4 } }
   *
   * v23.4.3 BUG-001 FIX — Founders paying on a fresh account previously had to
   * "choose a payment plan all over again" on every re-login. Root cause:
   * the paid-plan charge endpoint required an existing companyId, but the
   * fresh-founder UX has no company yet at this step. After paying, the
   * subscription row was created against an empty companyId and the
   * founder.activeCompanyId stayed null — so RequireActiveSubscription
   * (client/src/App.tsx:190) kept redirecting them to /founder/subscribe.
   *
   * Fix: mirror the activate-free pattern — if the founder has no company
   * yet, auto-provision a placeholder workspace before charging. The
   * subscription then anchors to that real companyId, user_prefs.active_tenant_id
   * gets set, and subsequent logins resolve activeCompanyId correctly,
   * landing the founder on /founder/dashboard instead of /founder/subscribe.
   * Founders can rename / edit the workspace at /founder/company afterward.
   *
   * Subscription is PER-COMPANY (each company a founder owns is independent),
   * so this auto-create runs ONLY when the founder has zero companies. If
   * they already own one or more, this endpoint requires an explicit
   * companyId (existing behavior preserved).
   */
  app.post("/api/founder/subscription/charge", requireAuth, async (req: Request, res: Response) => {
    /* v25.18 Lane C NC3 (hard close):
         v25.17 added `requireAuth` but did NOT verify that the authenticated
         founder actually owns the `companyId` in the body. Any logged-in user
         could pass another founder's companyId and trigger a charge against
         their subscription. We now resolve the founder's owned companies and
         reject (403) any body.companyId that isn't theirs (admins exempt). */
    let companyId = String(req.body?.companyId ?? (req as any).userContext?.founder?.activeCompanyId ?? ""); /* v14 */
    {
      const ctxOwn = await getUserContext(req);
      const isAdmin = !!ctxOwn?.isAdmin;
      if (!isAdmin && companyId) {
        const owned = getCompaniesForFounder(ctxOwn?.userId ?? "");
        const ownsIt = owned.some((c) => c.companyId === companyId);
        if (!ownsIt) {
          return res.status(403).json({ ok: false, error: "NOT_COMPANY_OWNER", message: "You do not own this company." });
        }
      }
    }
    const { pricingModelId, paymentMethod, plan: planRaw } = req.body ?? {};

    // v23.4.11 Phase 2 (B-202) — the founder's SELECTED plan must be persisted.
    // Root cause of B-202: the charge handler processed payment (chargeSubscription
    // sets status:"active" + bumps invoicesCount) but NEVER wrote the chosen plan
    // onto the subscription row. So a Free founder who paid for Pro saw the
    // "Subscribed!" toast + status active, yet companies.plan stayed founder_free
    // — badge showed FREE and /founder/rounds/new kept bouncing. We whitelist the
    // requested plan against the Plan union (NEVER trust the body blindly) and
    // apply it after a successful, non-3DS charge below.
    const ALLOWED_PAID_PLANS = ["founder_pro", "founder_scale", "founder_enterprise"] as const;
    type AllowedPaidPlan = (typeof ALLOWED_PAID_PLANS)[number];
    const requestedPlan: AllowedPaidPlan | null =
      typeof planRaw === "string" && (ALLOWED_PAID_PLANS as readonly string[]).includes(planRaw)
        ? (planRaw as AllowedPaidPlan)
        : null;

    // v23.4.3 BUG-001: if no companyId resolved AND founder has zero
    // companies, auto-provision a placeholder workspace so the paid
    // subscription has somewhere to anchor.
    //
    // v23.4.5 BUG 018 fix: idempotency guard against duplicate auto-provision.
    // Symptom: when the Subscribe call is retried (double-click, webhook
    // retry, network re-issue) two concurrent requests each see
    // `companies.length === 0`, each mint a fresh `co_<rand>` id, and both
    // succeed — the founder ends up with 2–3 phantom "X's Workspace" rows.
    // Fix: serialize per-user via an in-flight Promise; re-check the founder
    // companies count after acquiring the lock and re-fetching context.
    if (!companyId) {
      try {
        const ctx = await getUserContext(req);
        if (ctx.isAuthed) {
          companyId = await acquireAutoProvisionLock(ctx.userId, async () => {
            // Re-check inside the lock: a concurrent request may have already
            // provisioned the workspace and updated USER_COMPANIES.
            const existing = getCompaniesForFounder(ctx.userId);
            if (existing.length > 0) {
              // Pick the first owned company — honour active selection if set.
              const activeId = getActiveCompanyId(ctx.userId);
              return activeId || existing[0].companyId;
            }
            const newId = `co_${randomBytes(6).toString("hex")}`;
            const founderName = (ctx.identity?.name ?? "My Company").trim() || "My Company";
            const placeholder: FounderCompanyMembership = {
              companyId: newId,
              companyName: `${founderName}'s Workspace`,
              legalName: `${founderName}'s Workspace, Inc.`,
              logoUrl: null,
              role: "founder",
              lastActiveAt: new Date().toISOString(),
              kpi: {
                capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0,
                dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 1.0,
              },
              collective: { status: "none" },
              billing: { plan: "Founder Pro", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
              sector: "",
              stage: "",
              hq: "",
            };
            addCompanyForFounder(ctx.userId, placeholder);
            setActiveCompanyId(ctx.userId, newId);
            // Anchor a pending_payment subscription to the new company so the
            // charge below has a row to update.
            createSubscriptionForNewCompany(newId, {
              plan: "founder_pro",
              actor: `founder:${ctx.userId}`,
            });
            appendAdminAudit(
              `founder:${ctx.userId}`,
              `company:${newId}`,
              "company.auto_provisioned_on_charge",
              { reason: "bug001_paid_plan_fresh_founder" },
            );
            return newId;
          }) || companyId;
        }
      } catch (err) {
        // Non-fatal: if auto-provision fails, the charge endpoint returns
        // 404 below with the original error, which preserves prior behavior.
        log.warn("[paymentGatewayAdapter.charge] auto-provision failed (non-fatal):", (err as Error).message);
      }
    }

    let sub = getSubscription(companyId);
    if (!sub) return res.status(404).json({ ok: false, error: "subscription_not_found" });

    // v23.4.11 Phase 2 (B-202) — persist the SELECTED plan BEFORE we compute the
    // charge so the amount, plan label and renewal all reflect the plan the
    // founder actually bought (updateSubscription recomputes annualAmountMinor +
    // currency from PLAN_PRICES). This is the fix for the "Subscribed! but still
    // FREE" symptom. It is idempotent: re-charging with the same plan re-sets the
    // same value (no duplicate rows — updateSubscription upserts the current row
    // and the payment intent below is itself idempotent on subscriptionId+period).
    // Skipped when no valid paid plan was supplied (legacy callers / renewals),
    // which preserves prior behavior.
    if (requestedPlan && sub.plan !== requestedPlan) {
      const planUpd = updateSubscription(
        companyId,
        { plan: requestedPlan },
        `founder:charge:${companyId}`,
      );
      if (planUpd.ok) sub = planUpd.subscription;
    }

    // Derive period dates (annual billing)
    const now = new Date();
    const periodStart = now.toISOString().slice(0, 10);
    const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    try {
      const result = chargeSubscription({
        companyId,
        subscriptionId: `sub_${companyId}`,
        pricingModelId: pricingModelId ?? "pm_founder_pro_v1",
        currency: sub.currency,
        amountMinor: sub.annualAmountMinor,
        planLabel: sub.plan.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        periodStart,
        periodEnd,
        paymentMethodToken: paymentMethod?.tokenized ?? "tok_demo",
        cardLast4: paymentMethod?.cardLast4 ?? "4242",
      });

      if (!result.ok && result.requires3ds) {
        return res.json({ ok: false, requires3ds: true, clientSecret: result.clientSecret });
      }

      // v23.4.11 Phase 2 (B-202) — persist the card-on-file last4 so the billing
      // surfaces (and the company switcher badge via mergeBillingFromSubscription)
      // reflect the real payment method. chargeSubscription already flipped
      // status to "active"; this only records the card. Non-fatal on failure.
      const last4 = paymentMethod?.cardLast4 ?? null;
      if (last4) {
        updateSubscription(companyId, { cardLast4: last4 }, `founder:charge:${companyId}`);
      }

      res.json({ ok: true, subscription: getSubscription(companyId), invoice: result.invoice });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  /**
   * GET /api/founder/subscription
   * Returns the subscription for the founder's active company.
   */
  app.get("/api/founder/subscription", requireAuth, async (req: Request, res: Response) => {
    const companyId = String(req.query.companyId ?? (req as any).userContext?.founder?.activeCompanyId ?? ""); /* v14 */
    /* v25.19 Lane 1 NC1 (hard close): v25.18 NC3 added ownership to the WRITERS
       (PATCH/resume/payment-method/charge) but the READER stayed open. Any
       authenticated user could pass ?companyId=co_victim and read another
       company's plan, cardLast4, status. Now ownership-gated. */
    if (!(await assertSubscriptionOwnership(req, res, companyId))) return;

    /* v25.32 deep Fix 6 — canonical billing source. The real hosted-checkout
       state lives in capavate_subscriptions (written by the payment webhook /
       founder charge). Read that FIRST so the founder UI reflects the actual
       paid plan/amount. Fall back to the legacy subscriptionsStore for
       companies that predate the hosted-checkout model. */
    const canonical = projectCanonicalSubscription(companyId);
    if (canonical) {
      return res.json({ ok: true, subscription: canonical });
    }
    const sub = getSubscription(companyId);
    if (!sub) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, subscription: sub });
  });

  /**
   * PATCH /api/founder/subscription
   * Founder can cancel their own subscription: set status to cancel_at_period_end.
   * Allowed changes: status (cancel_at_period_end only from this endpoint).
   */
  /* v25.18 Lane C NC3 helper — assert authenticated caller owns the companyId. */
  async function assertSubscriptionOwnership(req: Request, res: Response, companyId: string): Promise<boolean> {
    const ctxOwn = await getUserContext(req);
    if (!ctxOwn?.isAuthed) {
      res.status(401).json({ ok: false, error: "unauthenticated" });
      return false;
    }
    if (ctxOwn.isAdmin) return true;
    if (!companyId) {
      res.status(400).json({ ok: false, error: "missing_company_id" });
      return false;
    }
    const owned = getCompaniesForFounder(ctxOwn.userId);
    if (!owned.some((c) => c.companyId === companyId)) {
      res.status(403).json({ ok: false, error: "NOT_COMPANY_OWNER" });
      return false;
    }
    return true;
  }

  app.patch("/api/founder/subscription", requireAuth, async (req: Request, res: Response) => {
    const companyId = String(req.body?.companyId ?? (req as any).userContext?.founder?.activeCompanyId ?? ""); /* v14 */
    if (!(await assertSubscriptionOwnership(req, res, companyId))) return; /* v25.18 Lane C NC3 */
    const { status } = req.body ?? {};

    // From founder side only cancel_at_period_end is allowed via this endpoint
    const allowed: string[] = ["cancel_at_period_end"];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ ok: false, error: "invalid_status_transition", allowed });
    }

    const result = updateSubscription(
      companyId,
      { status: status as any },
      `founder:${companyId}`,
    );
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  /**
   * POST /api/founder/subscription/resume
   * Resumes a cancel_at_period_end subscription back to active.
   * Double-confirm: requires x-confirm: true header.
   */
  app.post("/api/founder/subscription/resume", requireAuth, async (req: Request, res: Response) => {
    const companyId = String(req.body?.companyId ?? (req as any).userContext?.founder?.activeCompanyId ?? ""); /* v14 */
    if (!(await assertSubscriptionOwnership(req, res, companyId))) return; /* v25.18 Lane C NC3 */
    const sub = getSubscription(companyId);
    if (!sub) return res.status(404).json({ ok: false, error: "subscription_not_found" });
    if (sub.status !== "cancel_at_period_end") {
      return res.status(400).json({ ok: false, error: "subscription_not_cancelling", current_status: sub.status });
    }

    const result = updateSubscription(companyId, { status: "active" }, `founder:${companyId}`);
    if (!result.ok) return res.status(404).json(result);

    appendAdminAudit(`founder:${companyId}`, `subscription:${companyId}`, "subscription.resumed", { from: "cancel_at_period_end", to: "active" });
    res.json({ ok: true, subscription: result.subscription });
  });

  /**
   * PATCH /api/founder/subscription/payment-method
   * Updates the card on file. Requires Luhn-valid card.
   */
  app.patch("/api/founder/subscription/payment-method", requireAuth, async (req: Request, res: Response) => {
    const companyId = String(req.body?.companyId ?? (req as any).userContext?.founder?.activeCompanyId ?? ""); /* v14 */
    if (!(await assertSubscriptionOwnership(req, res, companyId))) return; /* v25.18 Lane C NC3 */
    const { cardLast4, cardExpiry, cardholderName, tokenized } = req.body ?? {};
    if (!cardLast4 || cardLast4.length !== 4 || !/^\d{4}$/.test(cardLast4)) {
      return res.status(400).json({ ok: false, error: "invalid_card_last4" });
    }
    if (!tokenized) {
      return res.status(400).json({ ok: false, error: "missing_payment_token" });
    }
    // K-201 fix v23.4.13: store cardExpiry so display shows correct expiry
    const expiryToStore: string | null = typeof cardExpiry === "string" && /^\d{2}\/\d{2}$/.test(cardExpiry) ? cardExpiry : null;
    const result = updateSubscription(companyId, { cardLast4, cardExpiry: expiryToStore }, `founder:${companyId}`);
    if (!result.ok) return res.status(404).json(result);
    appendAdminAudit(`founder:${companyId}`, `subscription:${companyId}`, "payment_method.changed", { cardLast4, cardholderName });
    res.json({ ok: true, subscription: result.subscription });
  });

  /**
   * v19 Wave A / Change 3 — per-gateway webhook handlers.
   *
   * `/api/webhooks/payment-gateway/airwallex`
   * `/api/webhooks/payment-gateway/stripe`
   *
   * Both verify the inbound HMAC signature against the gateway-specific
   * secret. Verification is REQUIRED in production (NODE_ENV === "production")
   * but advisory in dev/test (where shared secrets are typically unset).
   *
   * Payloads are normalised to the existing `{ type, intentId, status,
   * companyId }` shape and forwarded through the same dispatch logic used by
   * the legacy `/api/webhooks/payment-gateway` endpoint.
   */
  function handleGatewayWebhook(gateway: "airwallex" | "stripe", req: Request, res: Response) {
    // v25.32 burndown — item 40: opportunistic, best-effort retention reap of
    // the idempotency claim table. Runs before the finalize transaction so it
    // never participates in (and cannot roll back) the transactional claim.
    _reapProcessedWebhookEvents();
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    const isProd = process.env.NODE_ENV === "production";
    const sigOk = gateway === "airwallex"
      ? verifyAirwallexSig(req.headers as Record<string, string | string[] | undefined>, rawBody)
      : verifyStripeSig(req.headers as Record<string, string | string[] | undefined>, rawBody);

    /* v25.18 Lane C NC4 (hard close) — the pre-v25.18 check was
         `isProd && isGatewayReady(gateway) && !sigOk` which fails OPEN when
         the gateway secret is not configured (isGatewayReady=false). An
         attacker could blast unsigned events at /api/webhooks/payment-gateway/*
         in production and force subscription activations. We now fail CLOSED:
         in production any gateway-specific webhook must verify cleanly. If the
         gateway is not configured, return 503 — unsigned events are never
         processed. */
    if (isProd) {
      if (!isGatewayReady(gateway)) {
        return res.status(503).json({ ok: false, error: "gateway_not_configured", gateway });
      }
      if (!sigOk) {
        return res.status(401).json({ ok: false, error: "invalid_webhook_signature", gateway });
      }
    }

    const body = typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : {};
    // Normalise AirWallex (`event_type`, `data.id`) / Stripe (`type`, `data.object.id`) shapes.
    let type: string | undefined;
    let intentId: string | undefined;
    let status: string | undefined;
    let companyId: string | undefined;
    if (gateway === "airwallex") {
      type = (body.name as string | undefined) ?? (body.type as string | undefined);
      const data = body.data as { object?: { id?: string; status?: string; merchant_order_id?: string } } | undefined;
      intentId = data?.object?.id ?? (body.intentId as string | undefined);
      status = data?.object?.status ?? (body.status as string | undefined);
      companyId = data?.object?.merchant_order_id ?? (body.companyId as string | undefined);
    } else {
      type = body.type as string | undefined;
      const data = body.data as { object?: { id?: string; status?: string; metadata?: { companyId?: string } } } | undefined;
      intentId = data?.object?.id ?? (body.intentId as string | undefined);
      status = data?.object?.status ?? (body.status as string | undefined);
      companyId = data?.object?.metadata?.companyId ?? (body.companyId as string | undefined);
    }

    if (!type || !intentId) {
      return res.status(400).json({ ok: false, error: "missing_fields", gateway });
    }

    const key = webhookKey(intentId, type);

    // Normalise type into the legacy dispatch verbs.
    //
    // v24.4 Bug A — Airwallex MUST NOT reuse the broad Stripe-style event-type
    // matching for success. Airwallex intermediate states such as
    // REQUIRES_PAYMENT_METHOD / REQUIRES_CONFIRMATION can carry success-looking
    // event-type strings, which would otherwise activate paid subscriptions on
    // an incomplete payment. For Airwallex we activate ONLY when the normalized
    // payment-intent status is EXACTLY "SUCCEEDED".
    const normalizedStatus = (status ?? "").trim().toUpperCase();
    let isSuccess: boolean;
    let isFailure: boolean;
    if (gateway === "airwallex") {
      isSuccess = normalizedStatus === "SUCCEEDED";
      isFailure = normalizedStatus === "FAILED" || normalizedStatus === "CANCELLED";
    } else {
      isSuccess = /succeed|paid|captured|completed/i.test(type) || /SUCCEEDED|succeeded/.test(status ?? "");
      isFailure = /fail|declined|errored|cancelled/i.test(type) || /FAILED|failed/.test(status ?? "");
    }

    /* v25.32 deep Fix 2 — the WHOLE webhook flow is now atomic and DB-only.
     * Order (per brief): begin transaction → claim the idempotency key →
     * if already claimed return idempotent success → record event →
     * activate/fail subscription + finalize billing (invoice IN-TRANSACTION) →
     * commit. If anything throws, the transaction rolls back and the key stays
     * unclaimed so the next gateway retry repairs cleanly. The old in-memory
     * Set fast-path is gone. Billing events are collected and emitted AFTER the
     * commit (emitting inside the txn would fire side-effects a rollback cannot
     * undo). */
    let alreadyProcessed = false;
    const pendingBillingEvents: Array<Record<string, unknown>> = [];
    try {
      getDb().transaction((tx: any) => {
        // Claim the key atomically. If 0 rows changed it was already processed.
        if (!_claimWebhookKey(key)) {
          alreadyProcessed = true;
          return;
        }

        recordWebhookEvent({
          type,
          intentId,
          status: status ?? "received",
          companyId: companyId ?? null,
          gateway,
          payload: req.body,
        });

        // Flip the Capavate checkout subscription (resolved by intentId, then
        // merchant_order_id which the normaliser maps into `companyId`).
        let capSub = getCapSubByPaymentIntent(intentId);
        if (!capSub && companyId) capSub = getCapSubByMerchantOrderId(companyId);
        if (capSub) {
          if (isSuccess) {
            const activated = activateCapSub(capSub.paymentIntentId);
            if (activated) {
              pendingBillingEvents.push({
                kind: "subscription.activated",
                paymentIntentId: activated.paymentIntentId,
                companyId: activated.companyId,
                tierId: activated.tierId,
                userId: activated.userId,
                gateway,
              });
            }
            // Finalize billing atomically: period_end, payment_ledger
            // (idempotent on intent_id) and the invoice — all inside `tx`.
            finalizeWebhookSuccessInTx(tx, { intentId, companyId: companyId ?? null, gateway });
          } else if (isFailure) {
            const failed = failCapSub(capSub.paymentIntentId);
            if (failed && failed.status === "failed") {
              pendingBillingEvents.push({
                kind: "subscription.failed",
                paymentIntentId: failed.paymentIntentId,
                companyId: failed.companyId,
                tierId: failed.tierId,
                userId: failed.userId,
                gateway,
              });
            }
          }
        }

      });
    } catch (txErr) {
      // The transaction rolled back; the key was NOT persisted (claim is part
      // of the same txn) so the gateway's retry can re-process. Surface a 500
      // so the gateway knows to retry rather than treating this as final.
      log.warn(`[webhook] ${gateway} finalize transaction rolled back:`, (txErr as Error).message);
      return res.status(500).json({ ok: false, error: "webhook_finalize_failed", gateway });
    }

    if (alreadyProcessed) {
      return res.json({ ok: true, idempotent: true, gateway });
    }

    /* v25.32 deep — the legacy past_due<->active flip uses subscriptionsStore
     * .updateSubscription, which opens its OWN better-sqlite3 transaction.
     * better-sqlite3 forbids nested transactions, so this MUST run AFTER the
     * finalize transaction commits (not inside it). The idempotency key is
     * already claimed; this flip is naturally idempotent. */
    if (isSuccess && companyId) {
      const sub = getSubscription(companyId);
      if (sub?.status === "past_due") {
        updateSubscription(companyId, { status: "active" }, `system:webhook:${gateway}`);
      }
    } else if (isFailure && companyId) {
      const sub = getSubscription(companyId);
      if (sub?.status === "active") {
        updateSubscription(companyId, { status: "past_due" }, `system:webhook:${gateway}`);
      }
    }

    // Emit collected billing events AFTER commit (post-transaction side-effects).
    for (const evt of pendingBillingEvents) {
      try { emitBillingEvent(evt as any); } catch (e) { log.warn("[webhook] emitBillingEvent failed:", (e as Error).message); }
    }

    return res.json({ ok: true, gateway });
  }

  app.post("/api/webhooks/payment-gateway/airwallex", (req: Request, res: Response) => {
    handleGatewayWebhook("airwallex", req, res);
  });
  app.post("/api/webhooks/payment-gateway/stripe", (req: Request, res: Response) => {
    handleGatewayWebhook("stripe", req, res);
  });

  /**
   * v25.45 Bug A - CLIENT-RETURN RECONCILIATION (webhook-independent unlock).
   *
   * POST /api/founder/subscription/reconcile  { paymentIntentId }
   *
   * Root cause of "card charged but platform not unlocked": activation was
   * SOLELY driven by the asynchronous Airwallex payment_intent.succeeded
   * webhook (see handleGatewayWebhook). When that webhook lags or fails
   * (signature mismatch, endpoint unreachable, transient network, or just
   * arrives after the client poll window), the local capavate_subscriptions
   * row stays pending forever and RequireActiveSubscription keeps the founder
   * on the paywall even though Airwallex captured the payment.
   *
   * This endpoint gives the client return-URL path (BillingReturn.tsx) an
   * authoritative way to finalize WITHOUT waiting on the webhook:
   *   1. Resolve the pending row by paymentIntentId (DB-direct, ownership-checked).
   *   2. Ask Airwallex for the AUTHORITATIVE intent status via
   *      retrievePaymentIntent(id) (lib/airwallexGateway.ts).
   *   3. If SUCCEEDED, run the SAME atomic finalize the webhook uses
   *      (getDb().transaction + finalizeWebhookSuccessInTx): activate the row,
   *      set current_period_end, insert the idempotent payment_ledger row, and
   *      create the invoice. Idempotent on the intent_id, so a later webhook
   *      (or a second reconcile) is a safe no-op.
   *
   * This NEVER modifies the webhook (which already works) and writes to the DB
   * only - no in-memory shortcuts. It does not touch any AVI Tier-2 file.
   */
  app.post("/api/founder/subscription/reconcile", requireAuth, async (req: Request, res: Response) => {
    try {
      const ctx = await getUserContext(req);
      if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "unauthenticated" });

      const paymentIntentId = String(req.body?.paymentIntentId ?? "").trim();
      if (!paymentIntentId) {
        return res.status(400).json({ ok: false, error: "missing_paymentIntentId" });
      }

      // Resolve the local pending/active row (DB-direct via subscriptionStore).
      const capSub = getCapSubByPaymentIntent(paymentIntentId);
      if (!capSub) return res.status(404).json({ ok: false, error: "not_found" });

      // Tenant isolation: only the owning founder (or an admin) may reconcile.
      if (!ctx.isAdmin && capSub.userId !== ctx.userId) {
        return res.status(403).json({ ok: false, error: "not_owner" });
      }

      // Already finalized by the webhook (or a prior reconcile) - idempotent OK.
      if (capSub.status === "active") {
        return res.json({ ok: true, status: "active", companyId: capSub.companyId, reconciled: false });
      }

      // Ask Airwallex for the AUTHORITATIVE intent status. In stub mode this
      // deterministically returns SUCCEEDED; in test/live it hits the real API.
      const { retrievePaymentIntent } = await import("./lib/airwallexGateway");
      let intentStatus: string;
      try {
        const intent = await retrievePaymentIntent(paymentIntentId);
        intentStatus = String(intent?.status ?? "").trim().toUpperCase();
      } catch (e) {
        log.warn("[reconcile] retrievePaymentIntent failed:", (e as Error).message);
        return res.status(502).json({ ok: false, error: "gateway_unreachable", message: "Could not verify payment status with Airwallex. Please retry." });
      }

      if (intentStatus !== "SUCCEEDED") {
        // Not paid (yet). Report the current local status so the client keeps
        // polling; do NOT activate on anything but an authoritative SUCCEEDED.
        return res.json({ ok: true, status: capSub.status, companyId: capSub.companyId, reconciled: false, gatewayStatus: intentStatus });
      }

      // Authoritative SUCCEEDED - run the SAME atomic finalize the webhook uses.
      // Claim a reconcile-scoped idempotency key inside the transaction so a
      // concurrent webhook for the same intent cannot double-finalize; both the
      // ledger insert (ON CONFLICT intent_id DO NOTHING) and the claim make this
      // safe and repeatable.
      const merchantOrderId = capSub.merchantOrderId ?? null;
      const reconcileKey = webhookKey(paymentIntentId, "reconcile.succeeded");
      const pendingBillingEvents: Array<Record<string, unknown>> = [];
      let didFinalize = false;
      try {
        getDb().transaction((tx: any) => {
          // If a webhook already finalized this intent, the activation will be a
          // no-op (status already active); the claim just prevents duplicate
          // billing events from THIS path.
          const claimed = _claimWebhookKey(reconcileKey);
          if (!claimed) return; // another reconcile already ran

          const activated = activateCapSub(paymentIntentId);
          if (activated) {
            pendingBillingEvents.push({
              kind: "subscription.activated",
              paymentIntentId: activated.paymentIntentId,
              companyId: activated.companyId,
              tierId: activated.tierId,
              userId: activated.userId,
              gateway: "airwallex",
            });
          }
          finalizeWebhookSuccessInTx(tx, { intentId: paymentIntentId, companyId: merchantOrderId, gateway: "airwallex" });
          didFinalize = true;
        });
      } catch (txErr) {
        log.warn("[reconcile] finalize transaction rolled back:", (txErr as Error).message);
        return res.status(500).json({ ok: false, error: "reconcile_finalize_failed" });
      }

      // Emit billing events AFTER commit (post-transaction side-effects).
      for (const evt of pendingBillingEvents) {
        try { emitBillingEvent(evt as any); } catch (e) { log.warn("[reconcile] emitBillingEvent failed:", (e as Error).message); }
      }

      // Re-read the now-finalized row DB-direct for the response.
      const finalRow = getCapSubByPaymentIntent(paymentIntentId);
      return res.json({
        ok: true,
        status: finalRow?.status ?? "active",
        companyId: finalRow?.companyId ?? capSub.companyId,
        currentPeriodEnd: finalRow?.currentPeriodEnd ?? null,
        reconciled: didFinalize,
      });
    } catch (err) {
      log.error("[reconcile] unexpected error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  /**
   * POST /api/webhooks/payment-gateway
   * Idempotent on (intentId, type). Routes events to stores.
   */
  app.post("/api/webhooks/payment-gateway", (req: Request, res: Response) => {
    /* v25.17 Lane C NC5 — legacy webhook endpoint was unsigned. In production,
       require a signature header `x-payment-gateway-signature` whose HMAC-SHA256
       (key = PAYMENT_WEBHOOK_SECRET) matches the raw body. Without the secret,
       the endpoint is disabled in production. Demo / non-production calls still
       work (this preserves test flows). */
    if (process.env.NODE_ENV === "production") {
      const secret = process.env.PAYMENT_WEBHOOK_SECRET;
      if (!secret) {
        return res.status(503).json({ ok: false, error: "webhook_disabled", hint: "set PAYMENT_WEBHOOK_SECRET to enable" });
      }
      const provided = String(req.headers["x-payment-gateway-signature"] ?? "");
      if (!provided || !/^[0-9a-fA-F]+$/.test(provided)) {
        return res.status(401).json({ ok: false, error: "missing_signature" });
      }
      try {
        const { createHmac, timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
        const expected = createHmac("sha256", secret).update(JSON.stringify(req.body ?? {})).digest("hex");
        if (expected.length !== provided.length) return res.status(401).json({ ok: false, error: "bad_signature" });
        if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"))) {
          return res.status(401).json({ ok: false, error: "bad_signature" });
        }
      } catch {
        return res.status(401).json({ ok: false, error: "bad_signature" });
      }
    }
    const { type, intentId, status, companyId } = req.body ?? {};

    if (!type || !intentId) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // Idempotency + finalize, transactional & DB-only (v25.32 deep Fix 2/3).
    const key = webhookKey(intentId, type);
    let alreadyProcessed = false;
    try {
      getDb().transaction((tx: any) => {
        // Atomically claim the idempotency key. 0 rows changed => already done.
        if (!_claimWebhookKey(key)) {
          alreadyProcessed = true;
          return;
        }

        // Record event for the admin UI (DB-backed).
        recordWebhookEvent({
          type,
          intentId,
          status: status ?? "received",
          companyId: companyId ?? null,
          gateway: "legacy",
          payload: req.body,
        });

        // Finalize Capavate subscription billing atomically — period_end,
        // payment_ledger (idempotent on intent_id) and the invoice, all in `tx`.
        // The legacy past_due<->active flip is intentionally NOT done here: it
        // uses subscriptionsStore.updateSubscription, which opens its own
        // better-sqlite3 transaction (nested transactions are forbidden), so it
        // runs AFTER this transaction commits (see below).
        if (type === "payment.succeeded" && companyId) {
          finalizeWebhookSuccessInTx(tx, { intentId, companyId: companyId ?? null, gateway: "legacy" });
        }
      });
    } catch (txErr) {
      // Rolled back; key was not persisted so the gateway retry can re-process.
      log.warn("[webhook] legacy finalize transaction rolled back:", (txErr as Error).message);
      return res.status(500).json({ ok: false, error: "webhook_finalize_failed" });
    }

    if (alreadyProcessed) {
      return res.json({ ok: true, idempotent: true });
    }

    // v25.32 deep — post-commit legacy status flip (own transaction).
    if (type === "payment.succeeded" && companyId) {
      const sub = getSubscription(companyId);
      if (sub?.status === "past_due") {
        updateSubscription(companyId, { status: "active" }, "system:webhook");
      }
    } else if (type === "payment.failed" && companyId) {
      const sub = getSubscription(companyId);
      if (sub?.status === "active") {
        updateSubscription(companyId, { status: "past_due" }, "system:webhook");
      }
    }

    res.json({ ok: true });
  });
}

/* ---------- Webhook event log (v25.32 P1c — DB-backed) ---------- */

interface WebhookEvent {
  id: string;
  type: string;
  intentId: string;
  status: string;
  companyId: string | null;
  receivedAt: string;
}

/* v25.32 P1c — the in-memory `recentWebhookEvents` array was mutable
 * module-scope runtime state (a standing-rule violation: nothing in memory;
 * all DB-driven). It is REPLACED by the durable `payment_webhook_events`
 * table (schema in server/db/connection.ts). Writes INSERT a row; the admin
 * webhook-events view SELECTs the most recent rows. No array remains. */
function recordWebhookEvent(evt: {
  type: string;
  intentId: string;
  status: string;
  companyId: string | null;
  gateway?: string;
  payload?: unknown;
}): void {
  try {
    const db: any = rawDb();
    db.prepare(
      `INSERT INTO payment_webhook_events
         (id, type, intent_id, status, company_id, gateway, payload_json, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `wh_${randomBytes(4).toString("hex")}`,
      evt.type,
      evt.intentId,
      evt.status,
      evt.companyId,
      evt.gateway ?? null,
      evt.payload !== undefined ? JSON.stringify(evt.payload) : null,
      new Date().toISOString(),
    );
  } catch (err) {
    // v25.32 Item 29 — webhook-event logging is part of transaction integrity.
    // Both call sites run INSIDE the webhook claim+finalize transaction
    // (getDb().transaction at lines ~877 and ~1013), so THROWING here rolls the
    // whole finalize back — including the idempotency claim — and the gateway
    // retries. Swallowing previously allowed a webhook to update
    // subscription/ledger/invoice WITHOUT a durable audit row. Fail closed.
    log.warn("[paymentGatewayAdapter] recordWebhookEvent INSERT failed — failing closed:", (err as Error).message);
    throw err;
  }
}

function listRecentWebhookEvents(limit = 100): WebhookEvent[] {
  try {
    const db: any = rawDb();
    const rows: any[] = db
      .prepare(
        `SELECT id, type, intent_id, status, company_id, received_at
           FROM payment_webhook_events
          ORDER BY received_at DESC
          LIMIT ?`,
      )
      .all(limit);
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      intentId: r.intent_id,
      status: r.status,
      companyId: r.company_id ?? null,
      receivedAt: r.received_at,
    }));
  } catch (err) {
    log.warn("[paymentGatewayAdapter] listRecentWebhookEvents SELECT failed:", (err as Error).message);
    return [];
  }
}

/* ---------- v25.32 deep Fix 6 — canonical founder billing projection ---------- */

/**
 * Project the canonical hosted-checkout subscription (capavate_subscriptions)
 * into the legacy `Subscription` shape the founder UI consumes. Returns null
 * when the company has no canonical row (the caller then falls back to the
 * legacy subscriptionsStore). Read-only — never persists; the hash-chain /
 * version fields are presentational placeholders for this projection.
 */
function projectCanonicalSubscription(companyId: string): Subscription | null {
  if (!companyId) return null;
  let rows: CapavateSubscription[];
  try {
    rows = listCapSubsForCompany(companyId); // DB-direct (Fix 4)
  } catch (err) {
    log.warn("[founder/subscription] canonical read failed:", (err as Error).message);
    return null;
  }
  if (!rows.length) return null;

  // Most recent ACTIVE row wins; otherwise the most recently created row.
  const byNewest = (a: CapavateSubscription, b: CapavateSubscription) =>
    (b.activatedAt ?? b.createdAt).localeCompare(a.activatedAt ?? a.createdAt);
  const active = rows.filter((r) => r.status === "active").sort(byNewest);
  const chosen = active[0] ?? [...rows].sort(byNewest)[0];
  if (!chosen) return null;

  // Map tierId -> human plan label / annual amount via the configured tier.
  let plan: Subscription["plan"] = "founder_pro";
  try {
    const tier = pricingTiers.getById(chosen.tierId);
    const slug = (tier?.id ?? chosen.tierId ?? "").toLowerCase();
    if (slug.includes("free")) plan = "founder_free";
    else if (slug.includes("scale")) plan = "founder_scale";
    else if (slug.includes("enter")) plan = "founder_enterprise";
    else plan = "founder_pro";
  } catch { /* default plan */ }

  // Map canonical status -> legacy SubscriptionStatus.
  const status: Subscription["status"] =
    chosen.status === "active" ? "active"
    : chosen.status === "failed" ? "past_due"
    : "pending_payment";

  // Annualize the canonical (per-cycle) amount for the UI's annual field.
  const cycle = (chosen.billingCycle ?? "monthly").toLowerCase();
  const annualAmountMinor =
    cycle === "annual" || cycle === "yearly"
      ? chosen.amountMinor
      : chosen.amountMinor * 12;

  let invoicesCount = 0;
  /* v25.32 burndown — item 46: COUNT(*) in SQL instead of hydrating every
     invoice row just to take .length. countInvoicesForCompany is DB-direct over
     the same scoped predicate. Source: invoiceStore.ts:561. */
  try { invoicesCount = countInvoicesForCompany(companyId); } catch { /* best-effort */ }

  const renewsOn = chosen.currentPeriodEnd ?? chosen.expiresAt ?? chosen.createdAt;

  /* v25.32 final A1 — DB-direct read from payment_ledger; never reads from any
     in-memory state. Surfaces the most recent SUCCESSFUL payment timestamp for
     this subscription's payment intent so the founder Billing card can show the
     actual payment date (Avi field 3). When no ledger row exists yet (free /
     legacy subscription, or webhook not landed), paymentDate is left undefined
     and the client renders an em dash. */
  let paymentDate: string | undefined;
  try {
    const ledgerRow: any = rawDb()
      .prepare(
        `SELECT ts FROM payment_ledger
          WHERE intent_id = ? AND state = 'succeeded'
          ORDER BY ts DESC LIMIT 1`,
      )
      .get(chosen.paymentIntentId);
    if (ledgerRow?.ts) paymentDate = String(ledgerRow.ts);
  } catch (err) {
    log.warn("[founder/subscription] payment_ledger date read failed:", (err as Error).message);
  }

  return {
    companyId,
    status,
    plan,
    annualAmountMinor,
    currency: chosen.currency,
    renewsOn,
    ...(paymentDate ? { paymentDate } : {}),
    cardLast4: null,
    cardExpiry: null,
    invoicesCount,
    version: 0,
    revisionHash: "",
    prevRevisionHash: "",
    updatedAt: chosen.activatedAt ?? chosen.createdAt,
    updatedBy: "system:canonical-projection",
  };
}

/* ---------- v25.32 P1d — webhook success finalization (atomic) ---------- */

/**
 * v25.32 deep Fix 2+3 — On a confirmed `payment.succeeded` webhook, finalize the
 * local Capavate subscription billing state ATOMICALLY, inside a CALLER-SUPPLIED
 * drizzle transaction `tx` (the webhook handler's claim+finalize transaction):
 *   1. Resolve capavate_subscriptions by payment_intent_id (or merchant_order_id).
 *   2. Compute current_period_end (+30d monthly / +365d annual from billing_cycle).
 *   3. UPDATE capavate_subscriptions SET status='active', current_period_end, activated_at.
 *   4. INSERT a payment_ledger row (state='succeeded') ON CONFLICT(intent_id)
 *      DO NOTHING for webhook-retry idempotency.
 *   5. If the ledger row is NEW, create the legacy `invoices` row IN-TRANSACTION
 *      via createInvoiceInTransaction(tx, ...).
 *
 * Because every write here uses the same underlying better-sqlite3 connection
 * that `tx` holds open, the subscription update, ledger row AND invoice commit
 * or roll back together with the idempotency-key claim. Errors are NOT swallowed
 * — they propagate so the surrounding transaction rolls back and the next
 * gateway retry can repair (the unclaimed key is then free to re-process).
 */
function finalizeWebhookSuccessInTx(
  tx: any,
  args: { intentId: string; companyId: string | null; gateway: string },
): void {
  const db: any = rawDb();

  // Resolve the local subscription row (DB-direct via subscriptionStore reads).
  let capSub = getCapSubByPaymentIntent(args.intentId);
  if (!capSub && args.companyId) capSub = getCapSubByMerchantOrderId(args.companyId);
  if (!capSub) return; // Nothing local to finalize (e.g. collective webhook).

  const nowIso = new Date().toISOString();
  const cycle = (capSub.billingCycle ?? "monthly").toLowerCase();
  const days = cycle === "annual" || cycle === "yearly" ? 365 : 30;
  const periodEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  // Resolve a human plan label from the configured tier (DB-driven).
  let planLabel = capSub.tierId;
  try {
    const tier = pricingTiers.getById(capSub.tierId);
    if (tier?.name) planLabel = tier.name;
  } catch { /* fall back to tierId */ }

  const ledgerEntryId = `pe_${randomBytes(8).toString("hex")}`;

  // 1+2+3. Activate subscription + set period end (raw stmt runs inside `tx`).
  db.prepare(
    `UPDATE capavate_subscriptions
        SET status = 'active', current_period_end = ?, activated_at = ?
      WHERE payment_intent_id = ?`,
  ).run(periodEnd, nowIso, capSub.paymentIntentId);

  // 4. Idempotent ledger insert keyed on the UNIQUE intent_id.
  const entry = {
    id: ledgerEntryId,
    intentId: capSub.paymentIntentId,
    kind: "subscription_charge",
    amountCents: capSub.amountMinor,
    currency: capSub.currency,
    customerId: capSub.companyId,
    state: "succeeded",
    ts: nowIso,
    plan: planLabel,
    periodEnd,
    status: "active",
    gateway: args.gateway,
  };
  const result = db
    .prepare(
      `INSERT INTO payment_ledger (id, intent_id, customer_id, state, entry_json, ts)
         VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(intent_id) DO NOTHING`,
    )
    .run(
      ledgerEntryId,
      capSub.paymentIntentId,
      capSub.companyId,
      "succeeded",
      JSON.stringify(entry),
      nowIso,
    );
  const ledgerInserted = result.changes > 0;

  // 5. Create the invoice IN-TRANSACTION only if this was a NEW ledger entry.
  //    No swallowing — a throw rolls back the whole webhook finalization
  //    (v25.32 deep Fix 3).
  if (ledgerInserted) {
    createInvoiceInTransaction(tx, {
      companyId: capSub.companyId,
      subscriptionId: capSub.id,
      planLabel,
      periodStart: nowIso,
      periodEnd,
      amountMinor: capSub.amountMinor,
      currency: capSub.currency,
      taxMinor: 0,
      paymentEntryId: ledgerEntryId,
      actor: `system:webhook:${args.gateway}`,
    });
  }
}

/* ---------- Testing exports ---------- */
export const _testGateway = {
  /** v25.32 deep — the in-memory `processedWebhookEvents` Set was REMOVED
   *  (Ozan's no-in-memory rule). Idempotency keys now live ONLY in the durable
   *  `processed_webhook_events` table. This accessor reads that table so any
   *  test that previously inspected the Set keeps working DB-direct. */
  get processedWebhookEvents(): Set<string> {
    try {
      const rows: any[] = rawDb()
        .prepare(`SELECT key FROM processed_webhook_events`)
        .all();
      return new Set<string>(rows.map((r) => r.key));
    } catch {
      return new Set<string>();
    }
  },
  /** v25.32 P1c — webhook events are now in `payment_webhook_events`. This
   *  accessor reads the table so existing tests that inspected the old array
   *  keep working without an in-memory array. */
  get recentWebhookEvents(): WebhookEvent[] {
    return listRecentWebhookEvents(200);
  },
  reset(): void {
    // v25.32 deep — DB-only reset: clear both durable webhook tables.
    try {
      rawDb().prepare(`DELETE FROM payment_webhook_events`).run();
      rawDb().prepare(`DELETE FROM processed_webhook_events`).run();
    } catch { /* table may not exist in some test contexts */ }
  },
};
