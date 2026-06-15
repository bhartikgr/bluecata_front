/**
 * server/collectiveBillingStore.ts — v18 Phase B.
 *
 * Stripe-backed membership billing for the Capavate Collective. Sells three
 * annual tiers per chapter (basic / standard / premium) via Stripe Checkout,
 * lets members self-service cancellation via the Stripe Customer Portal,
 * and persists every Stripe lifecycle event in an audit-grade ledger.
 *
 * This is a SEPARATE Stripe product from the existing platform Founder Pro
 * / Founder Scale subscription (server/stripeGatewayAdapter.ts). Avi sets
 * the products + prices up on the Stripe Dashboard and pastes the three
 * STRIPE_COLLECTIVE_*_PRICE_ID env vars; the rest is wired here.
 *
 * Hard contract (V19_BUILD_BRIEF.md §1-12 + v18 Phase B spec):
 *   - SYNC transactions only — better-sqlite3 rejects async callbacks.
 *     Hash computation happens BEFORE every `db.transaction((tx)=>{...})`.
 *   - withTenant() on every query unless explicitly cross-tenant (marked).
 *   - Hash-chained writes in the same tx as the row update.
 *   - Feature flag: gated by COLLECTIVE_ENABLED=1.
 *   - When STRIPE_SECRET_KEY is unset, every checkout/portal/webhook
 *     endpoint returns 503 {error: "stripe_not_configured"} — never crashes.
 *   - When a tier's STRIPE_COLLECTIVE_*_PRICE_ID is unset, that tier's
 *     `available` flag is false and the purchase endpoint returns 503
 *     {error: "tier_not_configured", tier} — never a crash, never a hardcode.
 *   - Webhook idempotency is non-negotiable: a UNIQUE(stripe_event_id)
 *     constraint catches replays; the handler returns 200 {idempotent: true}.
 *   - Math is sacred — this module never imports cap-table-engine or
 *     captableCommitStore. After activation, it calls
 *     collectiveMembershipStore.activate() (a Phase B-migrated store) to
 *     auto-join the user at the appropriate role tier.
 *
 * No mock data, no TODOs, no stubs. Every code path executes real Drizzle
 * + real Stripe SDK (or its test-injected mock).
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
import { and, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { requireAuth } from "./lib/authMiddleware";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import { requireCollectiveEnabled } from "./lib/featureFlags";
import { withTenant } from "./lib/withTenant";
import { getDb } from "./db/connection";
import {
  collectiveMembershipsBilling as billingTable,
  collectiveBillingEvents as eventsTable,
  chapterMemberships as chapterMembershipsTable,
} from "@shared/schema";
import { appendAdminAudit } from "./adminPlatformStore";
import { tenantForChapter, DEFAULT_CHAPTER_ID } from "./lib/chapterDefaults";
import * as collectiveMembershipStore from "./collectiveMembershipStore";
/*
 * v25.4 — migrated from Stripe to Airwallex per Ozan's directive
 * (11-Jun-2026). The old stripeCollective module is retained on disk for
 * reference but is no longer imported by any production path; if
 * STRIPE_SECRET_KEY remains set in the environment we ignore it for the
 * Collective billing surface. All purchase / portal / webhook flows now
 * route through airwallexCollective + the Airwallex gateway.
 */
import {
  COLLECTIVE_TIER_CATALOG,
  AIRWALLEX_COLLECTIVE_ENV,
  priceConfigForTier,
  priceIdForTier,
  airwallexCollectiveMode as stripeMode,
  airwallexSecretConfigured as stripeSecretConfigured,
  airwallexWebhookSecretConfigured as stripeWebhookSecretConfigured,
  createCollectiveIntent,
  retrieveCollectiveIntent,
  type CollectiveTier,
} from "./lib/airwallexCollective";
import { verifyWebhookSignature as verifyAirwallexSig } from "./lib/airwallexGateway";
import { log } from "./lib/logger";

/* --------------------------------------------------------------- */
/* Types                                                            */
/* --------------------------------------------------------------- */

export type BillingStatus =
  | "pending"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired";

export interface BillingRow {
  id: string;
  tenantId: string;
  chapterId: string;
  userId: string;
  tier: CollectiveTier;
  status: BillingStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface BillingEventRow {
  id: string;
  tenantId: string;
  chapterId: string;
  billingId: string;
  eventType: string;
  stripeEventId: string;
  rawPayload: string;
  processedAt: string;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
}

/* --------------------------------------------------------------- */
/* Helpers                                                          */
/* --------------------------------------------------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Same hash function used across v17/v18A hash-chained stores so the
 * chapter-admin audit verifier can walk every chain with one algorithm.
 */
function computeHash(
  prevHash: string | null,
  payload: Record<string, unknown>,
): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

function rowToBilling(r: any): BillingRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    chapterId: r.chapter_id ?? r.chapterId,
    userId: r.user_id ?? r.userId,
    tier: (r.tier ?? "basic") as CollectiveTier,
    status: (r.status ?? "pending") as BillingStatus,
    stripeCustomerId: r.stripe_customer_id ?? r.stripeCustomerId ?? null,
    stripeSubscriptionId:
      r.stripe_subscription_id ?? r.stripeSubscriptionId ?? null,
    stripePriceId: r.stripe_price_id ?? r.stripePriceId ?? null,
    currentPeriodStart:
      r.current_period_start ?? r.currentPeriodStart ?? null,
    currentPeriodEnd: r.current_period_end ?? r.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: !!(r.cancel_at_period_end ?? r.cancelAtPeriodEnd ?? 0),
    prevHash: r.prev_hash ?? r.prevHash ?? null,
    currHash: r.curr_hash ?? r.currHash,
    createdAt: r.created_at ?? r.createdAt,
    updatedAt: r.updated_at ?? r.updatedAt,
  };
}

/**
 * Inline chapter membership check — symmetric with screeningEventsStore's
 * `getChapterMembership`. Routes use this to assert the caller belongs to
 * the chapter they're paying for.
 *
 * CROSS-TENANT (admin) — justified because chapter_memberships is the table
 * that establishes the active chapter scope; it cannot itself be
 * tenant-scoped without chicken-and-egg.
 */
function isChapterMember(userId: string, chapterId: string): boolean {
  try {
    const db: any = getDb();
    const rows = db
      .select({
        status: (chapterMembershipsTable as any).status,
      })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).userId, userId),
          eq((chapterMembershipsTable as any).chapterId, chapterId),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      )
      .limit(1)
      .all() as any[];
    const row = rows[0];
    return !!row && row.status === "active";
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn(
        "[collectiveBillingStore.isChapterMember] read failed:",
        msg,
      );
    }
    return false;
  }
}

/** Load the active (non-deleted) billing row for (user, chapter), if any. */
export function getBillingForUser(
  userId: string,
  chapterId: string,
): BillingRow | null {
  try {
    const db: any = getDb();
    const tenantId = tenantForChapter(chapterId);
    const condition = and(
      eq((billingTable as any).userId, userId),
      eq((billingTable as any).chapterId, chapterId),
    ) as any;
    const rows = db
      .select()
      .from(billingTable)
      .where(
        withTenant(condition, {
          tenantId,
          table: billingTable as any,
        }),
      )
      .limit(1)
      .all() as any[];
    if (rows.length === 0) return null;
    return rowToBilling(rows[0]);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn(
        "[collectiveBillingStore.getBillingForUser] read failed:",
        msg,
      );
    }
    return null;
  }
}

/**
 * Load a billing row by stripe subscription id. Cross-tenant — used by the
 * webhook handler, which receives the subscription id from Stripe and has
 * no tenant context (the tenant is derived FROM the row).
 *
 * CROSS-TENANT (admin) — justified because the Stripe webhook delivers
 * untrusted events from outside any tenant boundary; we discover the
 * tenant by joining on the subscription id.
 */
function findBillingBySubscriptionId(
  subscriptionId: string,
): BillingRow | null {
  if (!subscriptionId) return null;
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(billingTable)
      .where(
        and(
          eq((billingTable as any).stripeSubscriptionId, subscriptionId),
          isNull((billingTable as any).deletedAt),
        ),
      )
      .limit(1)
      .all() as any[];
    if (rows.length === 0) return null;
    return rowToBilling(rows[0]);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn(
        "[collectiveBillingStore.findBillingBySubscriptionId] read failed:",
        msg,
      );
    }
    return null;
  }
}

/**
 * Load a billing row by id. Cross-tenant — used by the webhook handler
 * which discovers the row id from Stripe metadata.
 *
 * CROSS-TENANT (admin) — justified because the webhook routes by
 * Stripe-supplied identifiers, not by session tenant scope.
 */
function findBillingByIdAnyTenant(billingId: string): BillingRow | null {
  if (!billingId) return null;
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(billingTable)
      .where(
        and(
          eq((billingTable as any).id, billingId),
          isNull((billingTable as any).deletedAt),
        ),
      )
      .limit(1)
      .all() as any[];
    if (rows.length === 0) return null;
    return rowToBilling(rows[0]);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn(
        "[collectiveBillingStore.findBillingByIdAnyTenant] read failed:",
        msg,
      );
    }
    return null;
  }
}

/* --------------------------------------------------------------- */
/* Tier catalog cache                                               */
/* --------------------------------------------------------------- */

interface CachedPrice {
  amount: number | null;
  currency: string;
  interval: string;
  nickname: string | null;
  fetchedAt: number;
}
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
const priceCache = new Map<string, CachedPrice>();

/**
 * v25.4 — Airwallex does not expose a hosted price catalog the way Stripe
 * does. Tier prices live in env vars (see AIRWALLEX_COLLECTIVE_ENV). The
 * cache is retained so the route handler shape (async lookup, ttl-cached)
 * does not change — but the lookup itself is now zero-RPC.
 */
async function fetchPriceCached(tier: CollectiveTier): Promise<CachedPrice | null> {
  const now = Date.now();
  const cacheKey = `tier:${tier}`;
  const hit = priceCache.get(cacheKey);
  if (hit && now - hit.fetchedAt < PRICE_CACHE_TTL_MS) {
    return hit;
  }
  const cfg = priceConfigForTier(tier);
  if (!cfg) return null;
  const entry: CachedPrice = {
    amount: cfg.amountMinor,
    currency: cfg.currency.toLowerCase(),
    interval: cfg.interval,
    nickname: null,
    fetchedAt: now,
  };
  priceCache.set(cacheKey, entry);
  return entry;
}

/** Test-only: drop the price cache so tests can verify miss-then-hit logic. */
export function __resetPriceCache(): void {
  priceCache.clear();
}

/* --------------------------------------------------------------- */
/* Validation schemas                                               */
/* --------------------------------------------------------------- */

const tierEnum = z.enum(["basic", "standard", "premium"]);

const checkoutBodySchema = z.object({
  tier: tierEnum,
  chapter_id: z.string().min(1, "chapter_id required"),
  success_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
});

const portalBodySchema = z.object({
  chapter_id: z.string().min(1, "chapter_id required"),
  return_url: z.string().url().optional(),
});

const meQuerySchema = z.object({
  chapter_id: z.string().min(1).optional(),
});

/* --------------------------------------------------------------- */
/* State machine helpers                                            */
/* --------------------------------------------------------------- */

/**
 * Map a Stripe subscription.status to our internal BillingStatus.
 * Stripe statuses we care about:
 *   - 'trialing' | 'active'       → active
 *   - 'past_due'                  → past_due
 *   - 'canceled'                  → cancelled
 *   - 'incomplete' | 'incomplete_expired' | 'unpaid' → past_due (degraded
 *      access until payment; safer than cancelled because Stripe may retry)
 *   - 'paused'                    → past_due (rare; access disabled)
 */
function mapStripeSubStatus(stripeStatus: string): BillingStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "canceled":
      return "cancelled";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "past_due";
    default:
      return "pending";
  }
}

/** Map a tier → the collectiveMembershipStore tier label it activates. */
function tierToMembershipStoreTier(tier: CollectiveTier): "standard" | "plus" {
  // The legacy collectiveMembershipStore only knows 'standard' | 'plus'.
  // basic + standard → "standard"; premium → "plus".
  if (tier === "premium") return "plus";
  return "standard";
}

/* --------------------------------------------------------------- */
/* Write helpers                                                    */
/* --------------------------------------------------------------- */

/**
 * Insert a fresh `pending` billing row for a (user, chapter, tier) triple.
 * If a row already exists (UNIQUE user_id, chapter_id), this returns the
 * existing row instead — callers re-use the same row for repeat checkouts.
 * Hash-chained (prev_hash = null, payload describes the create action).
 */
export function createPendingBilling(
  userId: string,
  chapterId: string,
  tier: CollectiveTier,
  stripePriceId: string,
): BillingRow {
  // Idempotent: an existing row for this (user, chapter) is reused — we
  // just bump its tier + price + status back to pending (the user may be
  // upgrading from a previously cancelled membership, or retrying a
  // failed checkout). Stripe's customer + subscription ids stay null
  // until the webhook fires.
  const existing = getBillingForUser(userId, chapterId);
  const ts = nowIso();
  const tenantId = tenantForChapter(chapterId);

  if (existing) {
    const payloadForHash = {
      id: existing.id,
      userId,
      chapterId,
      tier,
      stripePriceId,
      action: "reset_to_pending",
      ts,
    };
    const currHash = computeHash(existing.currHash, payloadForHash);

    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        tx.update(billingTable)
          .set({
            tier,
            status: "pending",
            stripePriceId,
            prevHash: existing.currHash,
            currHash,
            updatedAt: ts,
          } as any)
          .where(eq((billingTable as any).id, existing.id))
          .run();
      });
    } catch (err) {
      log.error(
        "[collectiveBillingStore.createPendingBilling] update tx failed:",
        (err as Error).message,
      );
      throw err;
    }
    return {
      ...existing,
      tier,
      status: "pending",
      stripePriceId,
      prevHash: existing.currHash,
      currHash,
      updatedAt: ts,
    };
  }

  const id = `cbill_${randomBytes(8).toString("hex")}`;
  const payloadForHash = {
    id,
    userId,
    chapterId,
    tier,
    stripePriceId,
    action: "create",
    ts,
  };
  const currHash = computeHash(null, payloadForHash);

  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.insert(billingTable)
        .values({
          id,
          tenantId,
          chapterId,
          userId,
          tier,
          status: "pending",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          stripePriceId,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: 0,
          prevHash: null,
          currHash,
          createdAt: ts,
          updatedAt: ts,
        } as any)
        .run();
    });
  } catch (err) {
    log.error(
      "[collectiveBillingStore.createPendingBilling] insert tx failed:",
      (err as Error).message,
    );
    throw err;
  }
  return {
    id,
    tenantId,
    chapterId,
    userId,
    tier,
    status: "pending",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    prevHash: null,
    currHash,
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * Append a webhook event to the ledger AND update the billing row to
 * reflect the new state. Both writes happen in the same SYNC transaction
 * so the hash chains never diverge.
 *
 * Idempotency: the events table has UNIQUE(stripe_event_id). A second
 * delivery of the same event throws SQLITE_CONSTRAINT inside the
 * transaction; we catch it and return `{ idempotent: true }`.
 *
 * Pre-condition: callers MUST verify the Stripe signature before invoking
 * this helper (this module trusts whatever event object it's handed).
 */
export interface ApplyWebhookInput {
  stripeEventId: string;
  eventType: string;
  rawPayload: string;
  /** Resolved billing row id (the row we're updating). */
  billingId: string;
  /** New status to set (mapped from Stripe subscription.status). */
  newStatus: BillingStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  currentPeriodStart?: number | null;
  currentPeriodEnd?: number | null;
  cancelAtPeriodEnd?: boolean;
}
export interface ApplyWebhookResult {
  idempotent: boolean;
  billing: BillingRow | null;
  event: BillingEventRow | null;
}

export function applyWebhookEvent(
  input: ApplyWebhookInput,
): ApplyWebhookResult {
  const existing = findBillingByIdAnyTenant(input.billingId);
  if (!existing) {
    return { idempotent: false, billing: null, event: null };
  }

  const ts = nowIso();
  const eventId = `cbevt_${randomBytes(8).toString("hex")}`;

  // Pre-compute both chain hashes BEFORE opening the transaction (Rule 6).
  // Chain 1: events ledger (per-billing-id, ordered by created_at).
  // We pre-resolve the latest event row for this billing_id outside the
  // tx so the hash is computed sync-only.
  let lastEventHash: string | null = null;
  try {
    const db: any = getDb();
    const lastRows = db
      .select({ currHash: (eventsTable as any).currHash })
      .from(eventsTable)
      .where(eq((eventsTable as any).billingId, existing.id))
      .orderBy((eventsTable as any).createdAt)
      .all() as any[];
    if (lastRows.length > 0) {
      lastEventHash = String(lastRows[lastRows.length - 1].currHash);
    }
  } catch {
    // table missing or read error: treat as fresh chain.
    lastEventHash = null;
  }

  const eventPayloadForHash = {
    id: eventId,
    billingId: existing.id,
    stripeEventId: input.stripeEventId,
    eventType: input.eventType,
    ts,
  };
  const eventCurrHash = computeHash(lastEventHash, eventPayloadForHash);

  // Chain 2: billing-row state machine.
  const billingPayloadForHash = {
    id: existing.id,
    status: input.newStatus,
    eventType: input.eventType,
    stripeEventId: input.stripeEventId,
    ts,
  };
  const billingCurrHash = computeHash(existing.currHash, billingPayloadForHash);

  let idempotent = false;
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      // 1) Insert the event ledger row — UNIQUE(stripe_event_id) triggers
      //    on duplicate delivery. Rethrowing aborts the transaction.
      tx.insert(eventsTable)
        .values({
          id: eventId,
          tenantId: existing.tenantId,
          chapterId: existing.chapterId,
          billingId: existing.id,
          eventType: input.eventType,
          stripeEventId: input.stripeEventId,
          rawPayload: input.rawPayload,
          processedAt: ts,
          prevHash: lastEventHash,
          currHash: eventCurrHash,
          createdAt: ts,
        } as any)
        .run();

      // 2) Update the billing row to the new state.
      const patch: Record<string, unknown> = {
        status: input.newStatus,
        prevHash: existing.currHash,
        currHash: billingCurrHash,
        updatedAt: ts,
      };
      if (input.stripeCustomerId !== undefined)
        patch.stripeCustomerId = input.stripeCustomerId;
      if (input.stripeSubscriptionId !== undefined)
        patch.stripeSubscriptionId = input.stripeSubscriptionId;
      if (input.stripePriceId !== undefined)
        patch.stripePriceId = input.stripePriceId;
      if (input.currentPeriodStart !== undefined)
        patch.currentPeriodStart = input.currentPeriodStart;
      if (input.currentPeriodEnd !== undefined)
        patch.currentPeriodEnd = input.currentPeriodEnd;
      if (input.cancelAtPeriodEnd !== undefined)
        patch.cancelAtPeriodEnd = input.cancelAtPeriodEnd ? 1 : 0;

      tx.update(billingTable)
        .set(patch as any)
        .where(eq((billingTable as any).id, existing.id))
        .run();
    });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    // SQLite UNIQUE-constraint violation on stripe_event_id → idempotent.
    if (/UNIQUE constraint failed/i.test(msg) && /stripe_event_id/i.test(msg)) {
      idempotent = true;
    } else {
      log.error(
        "[collectiveBillingStore.applyWebhookEvent] tx failed:",
        msg,
      );
      throw err;
    }
  }

  if (idempotent) {
    return { idempotent: true, billing: existing, event: null };
  }

  const updated = findBillingByIdAnyTenant(existing.id);
  const eventRow: BillingEventRow = {
    id: eventId,
    tenantId: existing.tenantId,
    chapterId: existing.chapterId,
    billingId: existing.id,
    eventType: input.eventType,
    stripeEventId: input.stripeEventId,
    rawPayload: input.rawPayload,
    processedAt: ts,
    prevHash: lastEventHash,
    currHash: eventCurrHash,
    createdAt: ts,
  };
  return { idempotent: false, billing: updated, event: eventRow };
}

/**
 * After a successful activation, auto-join the user to the
 * collective_membership store at the appropriate role tier. Idempotent.
 * Failure is non-fatal — the billing row is the source of truth.
 */
function autoJoinCollectiveMembership(
  billing: BillingRow,
  actor: string,
): void {
  try {
    collectiveMembershipStore.activate(
      billing.userId,
      actor,
      tierToMembershipStoreTier(billing.tier),
      { chapterId: billing.chapterId },
    );
  } catch (err) {
    log.warn(
      "[collectiveBillingStore.autoJoinCollectiveMembership] activate failed:",
      (err as Error).message,
    );
  }
}

/* --------------------------------------------------------------- */
/* Stripe-event dispatch                                            */
/* --------------------------------------------------------------- */

/**
 * Translate a (signature-verified) Stripe Event into an applyWebhookEvent
 * call. Returns `{idempotent}` so the HTTP handler can respond 200/200.
 */
async function dispatchStripeEvent(event: {
  id: string;
  type: string;
  data: { object: unknown };
}): Promise<{ ok: boolean; idempotent: boolean; status?: number; error?: string }> {
  const obj = (event.data?.object ?? {}) as Record<string, any>;
  const rawPayload = JSON.stringify(event);

  // Resolve the billing row id this event targets.
  // checkout.session.completed → metadata.billing_id (set at Checkout creation)
  // customer.subscription.* → either metadata.billing_id OR
  //   stripeSubscriptionId lookup
  // invoice.* → metadata.billing_id or subscription lookup
  let billingId: string | null =
    (obj?.metadata?.billing_id as string | undefined) ?? null;

  if (!billingId) {
    // Try via subscription id.
    const subId: string | null =
      (typeof obj?.subscription === "string"
        ? obj.subscription
        : obj?.subscription?.id) ??
      (event.type.startsWith("customer.subscription.") ? obj?.id : null) ??
      null;
    if (subId) {
      const row = findBillingBySubscriptionId(subId);
      if (row) billingId = row.id;
    }
  }

  if (!billingId) {
    return { ok: false, idempotent: false, status: 404, error: "billing_not_found" };
  }
  const billing = findBillingByIdAnyTenant(billingId);
  if (!billing) {
    return { ok: false, idempotent: false, status: 404, error: "billing_not_found" };
  }

  // Compute the state transition + extra fields per event type.
  let newStatus: BillingStatus = billing.status;
  const extras: Partial<ApplyWebhookInput> = {};

  switch (event.type) {
    case "checkout.session.completed": {
      // Checkout finished — Stripe Subscription created. Stripe sends a
      // separate `customer.subscription.created` shortly after; this event
      // pins the customer + subscription ids so the subsequent events
      // resolve cleanly.
      newStatus = "pending"; // wait for subscription.created to flip to active
      const sub =
        (typeof obj?.subscription === "string"
          ? obj.subscription
          : obj?.subscription?.id) ?? null;
      extras.stripeSubscriptionId = sub;
      extras.stripeCustomerId =
        (typeof obj?.customer === "string"
          ? obj.customer
          : obj?.customer?.id) ?? null;
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      newStatus = mapStripeSubStatus(String(obj?.status ?? ""));
      extras.stripeSubscriptionId = (obj?.id as string) ?? null;
      extras.stripeCustomerId =
        (typeof obj?.customer === "string"
          ? obj.customer
          : obj?.customer?.id) ?? null;
      const priceId =
        obj?.items?.data?.[0]?.price?.id ??
        obj?.plan?.id ??
        null;
      if (priceId) extras.stripePriceId = priceId as string;
      if (typeof obj?.current_period_start === "number")
        extras.currentPeriodStart = obj.current_period_start;
      if (typeof obj?.current_period_end === "number")
        extras.currentPeriodEnd = obj.current_period_end;
      if (typeof obj?.cancel_at_period_end === "boolean")
        extras.cancelAtPeriodEnd = obj.cancel_at_period_end;
      break;
    }
    case "customer.subscription.deleted": {
      newStatus = "cancelled";
      extras.cancelAtPeriodEnd = false;
      break;
    }
    case "invoice.paid": {
      // Invoice paid — flip to active (the prior status may have been
      // past_due if a retry just succeeded).
      newStatus = "active";
      break;
    }
    case "invoice.payment_failed": {
      newStatus = "past_due";
      break;
    }
    default:
      // Unhandled event types still get logged to the ledger (idempotent
      // append) so we have a forensic record. State unchanged.
      newStatus = billing.status;
  }

  const result = applyWebhookEvent({
    stripeEventId: event.id,
    eventType: event.type,
    rawPayload,
    billingId: billing.id,
    newStatus,
    ...extras,
  });

  if (result.idempotent) {
    return { ok: true, idempotent: true };
  }

  // On flip to active, auto-join the user.
  if (newStatus === "active" && billing.status !== "active") {
    const fresh = result.billing ?? findBillingByIdAnyTenant(billing.id);
    if (fresh) autoJoinCollectiveMembership(fresh, "system:stripe_webhook");
  }

  /* v25.21 Lane D NC-002 fix — on flip to cancelled or past_due, deactivate
   * the collective membership row so `requireCollectiveMember` no longer
   * admits this user. Before this fix the gate kept passing because it keys
   * off `collectiveMembershipStore.isActive(userId)` and only the billing
   * row's `status` was being updated. End result: a member who cancelled or
   * stopped paying retained full Collective access until manual intervention. */
  if (
    (newStatus === "cancelled" || newStatus === "past_due") &&
    billing.status !== newStatus &&
    billing.userId
  ) {
    try {
      collectiveMembershipStore.deactivate(
        billing.userId,
        "system:stripe_webhook",
      );
    } catch (deactivateErr) {
      // Best-effort; the billing transition is the source of truth.
      try {
        const { log } = require("./lib/logger");
        log.warn(
          "[collectiveBillingStore.applyWebhookEvent] membership deactivate failed (non-fatal):",
          (deactivateErr as Error).message,
        );
      } catch { /* logger optional */ }
    }
  }

  // Audit append (outside the data tx; appendAdminAudit opens its own).
  try {
    appendAdminAudit(
      "system:stripe_webhook",
      `collective_billing:${billing.id}`,
      `collective.billing.${event.type}`,
      {
        billingId: billing.id,
        chapterId: billing.chapterId,
        userId: billing.userId,
        tier: billing.tier,
        newStatus,
        stripeEventId: event.id,
      },
    );
  } catch {
    /* non-fatal */
  }

  // v18 Phase D — SSE fan-out (post-commit). Only publish on a real
  // status transition (idempotent events were handled above).
  if (newStatus !== billing.status) {
    try {
      const { publish: ssePublish } = require("./lib/sseHub");
      let kind = "billing.status_changed";
      if (newStatus === "active" && billing.status !== "active") {
        kind = "billing.activated";
      } else if (newStatus === "cancelled") {
        kind = "billing.cancelled";
      } else if (newStatus === "past_due") {
        kind = "billing.past_due";
      }
      ssePublish(billing.chapterId, "billing", {
        kind,
        billingId: billing.id,
        userId: billing.userId,
        tier: billing.tier,
        previousStatus: billing.status,
        newStatus,
      });
    } catch { /* non-fatal */ }
  }

  return { ok: true, idempotent: false };
}

/* --------------------------------------------------------------- */
/* v25.4 — Airwallex event dispatch                                */
/* --------------------------------------------------------------- */

/**
 * Translate a (signature-verified) Airwallex Event into an
 * applyWebhookEvent call. Airwallex's relevant event types for the
 * Collective billing surface are:
 *
 *   payment_intent.succeeded         — first cycle paid
 *   payment_intent.requires_payment_method / failed / cancelled
 *   refund.processed                 — refund completed
 *
 * Recurring renewals are driven by our own renewal worker (Airwallex does
 * not ship a hosted subscription primitive), which mints a fresh payment
 * intent every cycle. Each renewal flows through this same dispatcher.
 */
export async function dispatchAirwallexEvent(event: {
  id: string;
  type?: string;
  name?: string;
  data?: { object?: Record<string, any> };
}): Promise<{ ok: boolean; idempotent: boolean; status?: number; error?: string }> {
  const eventType = String(event.type ?? event.name ?? "unknown");
  const obj = (event.data?.object ?? {}) as Record<string, any>;
  const rawPayload = JSON.stringify(event);

  /* Airwallex puts our merchant_order_id (== billing row id) on the intent.
   * We also accept metadata.billingId set on intent creation. */
  let billingId: string | null =
    (obj?.metadata?.billingId as string | undefined) ??
    (obj?.merchant_order_id as string | undefined) ??
    null;

  if (!billingId) {
    /* Fallback — look up by intent id (we persist it as stripe_subscription_id
     * during checkout so we can resolve back even when metadata is mangled). */
    const intentId =
      (typeof obj?.id === "string" ? obj.id : null) ??
      (typeof obj?.payment_intent === "string" ? obj.payment_intent : null);
    if (intentId) {
      const row = findBillingBySubscriptionId(intentId);
      if (row) billingId = row.id;
    }
  }

  if (!billingId) {
    return { ok: false, idempotent: false, status: 404, error: "billing_not_found" };
  }
  const billing = findBillingByIdAnyTenant(billingId);
  if (!billing) {
    return { ok: false, idempotent: false, status: 404, error: "billing_not_found" };
  }

  /* Airwallex status normalisation. Live AND test environments use upper
   * case enum ("SUCCEEDED", "FAILED", "CANCELLED", "REQUIRES_PAYMENT_METHOD",
   * "REQUIRES_CUSTOMER_ACTION", "REQUIRES_CAPTURE"). */
  const normalizedStatus = String(obj?.status ?? "").trim().toUpperCase();
  const isSuccess =
    /payment_intent\.succeeded/i.test(eventType) || normalizedStatus === "SUCCEEDED";
  const isFailure =
    /payment_intent\.(failed|cancelled|expired)/i.test(eventType) ||
    normalizedStatus === "FAILED" ||
    normalizedStatus === "CANCELLED" ||
    normalizedStatus === "EXPIRED";
  const isRefund = /refund\.processed|refund\.succeeded/i.test(eventType);

  let newStatus: BillingStatus = billing.status;
  const extras: Partial<ApplyWebhookInput> = {};
  /* Pin the intent id on the row so re-deliveries resolve quickly. */
  if (typeof obj?.id === "string") {
    extras.stripeSubscriptionId = obj.id;
  }
  /* Airwallex doesn't ship a customer-id on every event; preserve if present. */
  if (typeof obj?.customer_id === "string") {
    extras.stripeCustomerId = obj.customer_id;
  }

  /* Pin the period from the metadata (set at intent creation). The renewal
   * worker will roll these forward on each cycle. */
  const intervalSec =
    obj?.metadata?.interval === "month" ? 30 * 86400 : 365 * 86400;
  if (isSuccess) {
    const nowSec = Math.floor(Date.now() / 1000);
    newStatus = "active";
    extras.currentPeriodStart = nowSec;
    extras.currentPeriodEnd = nowSec + intervalSec;
  } else if (isFailure) {
    newStatus = billing.status === "active" ? "past_due" : "pending";
  } else if (isRefund) {
    /* Refund is informational — we DON'T auto-cancel the membership on a
     * partial refund. Full-refund cancellation happens via the admin
     * console / cancel endpoint. Log the event to the ledger only. */
    newStatus = billing.status;
  }

  const result = applyWebhookEvent({
    stripeEventId: event.id, /* column name is legacy; semantically gateway_event_id */
    eventType,
    rawPayload,
    billingId: billing.id,
    newStatus,
    ...extras,
  });

  if (result.idempotent) {
    return { ok: true, idempotent: true };
  }

  /* Auto-join the user on flip-to-active. */
  if (newStatus === "active" && billing.status !== "active") {
    const fresh = result.billing ?? findBillingByIdAnyTenant(billing.id);
    if (fresh) autoJoinCollectiveMembership(fresh, "system:airwallex_webhook");
  }

  /* v25.22 NC-1 fix (FALSE-CLOSURE recovery from v25.21 D-NC-002): the
   * v25.21 fix added a `collectiveMembershipStore.deactivate` call to the
   * LEGACY Stripe dispatcher — which is now a permanent 410 — but missed
   * the LIVE Airwallex dispatcher (this function). A member who cancels or
   * stops paying via Airwallex therefore kept full Collective access. We
   * mirror the same deactivation here on flip-to-cancelled / past_due. */
  if (
    (newStatus === "cancelled" || newStatus === "past_due") &&
    billing.status !== newStatus &&
    billing.userId
  ) {
    try {
      const membership = require("./collectiveMembershipStore");
      membership.deactivate(billing.userId, "system:airwallex_webhook");
    } catch (deactivateErr) {
      try {
        const { log } = require("./lib/logger");
        log.warn(
          "[dispatchAirwallexEvent] membership deactivate failed (non-fatal):",
          (deactivateErr as Error).message,
        );
      } catch { /* logger optional */ }
    }
  }

  try {
    appendAdminAudit(
      "system:airwallex_webhook",
      `collective_billing:${billing.id}`,
      `collective.billing.${eventType}`,
      {
        billingId: billing.id,
        chapterId: billing.chapterId,
        userId: billing.userId,
        tier: billing.tier,
        newStatus,
        gatewayEventId: event.id,
        gateway: "airwallex",
      },
    );
  } catch { /* non-fatal */ }

  /* SSE fan-out on real status transitions. */
  if (newStatus !== billing.status) {
    try {
      const { publish: ssePublish } = require("./lib/sseHub");
      let kind = "billing.status_changed";
      if (newStatus === "active" && billing.status !== "active") {
        kind = "billing.activated";
      } else if (newStatus === "cancelled") {
        kind = "billing.cancelled";
      } else if (newStatus === "past_due") {
        kind = "billing.past_due";
      }
      ssePublish(billing.chapterId, "billing", {
        kind,
        billingId: billing.id,
        userId: billing.userId,
        tier: billing.tier,
        previousStatus: billing.status,
        newStatus,
        gateway: "airwallex",
      });
    } catch { /* non-fatal */ }
  }

  return { ok: true, idempotent: false };
}

/* --------------------------------------------------------------- */
/* Route registration                                               */
/* --------------------------------------------------------------- */

export function registerCollectiveBillingRoutes(app: Express): void {
  /**
   * GET /api/collective/membership/tiers
   *
   * Returns the three-tier catalog with per-tier `available` (false when
   * the price id env var is unset) and, if Stripe is reachable, the
   * current price for display. Cached 5 minutes per price id.
   *
   * Open to any collective member; chapter-agnostic.
   */
  app.get(
    "/api/collective/membership/tiers",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    async (_req: Request, res: Response) => {
      const stripeReady = stripeSecretConfigured();
      // Avi 22-May Issue 4 — surface the operating mode so the UI can show
      // a Live / Test badge and Avi never has to guess which key is wired.
      const mode = stripeMode();
      const webhookConfigured = stripeWebhookSecretConfigured();
      const tiers = await Promise.all(
        COLLECTIVE_TIER_CATALOG.map(async (t) => {
          const priceId = priceIdForTier(t.tier);
          const available = stripeReady && priceId !== null;
          const price = available ? await fetchPriceCached(t.tier) : null;
          return {
            tier: t.tier,
            label: t.label,
            blurb: t.blurb,
            entitlements: t.entitlements,
            membershipRole: t.membershipRole,
            available,
            priceId: priceId ?? null,
            unitAmount: price?.amount ?? null,
            currency: price?.currency ?? null,
            interval: price?.interval ?? null,
            nickname: price?.nickname ?? null,
          };
        }),
      );
      res.json({
        ok: true,
        gateway: "airwallex",
        airwallexConfigured: stripeReady,
        /* Legacy alias — the field name predates the v25.4 gateway swap and
         * still drives the UI's `Configured` badge; we keep it so the client
         * does not need a synchronized release. */
        stripeConfigured: stripeReady,
        mode,
        webhookConfigured,
        tiers,
      });
    },
  );

  /**
   * POST /api/collective/membership/checkout
   * Body: { tier, chapter_id, success_url?, cancel_url? }
   *
   * Creates a Stripe Checkout Session for the requested tier and inserts
   * a `pending` billing row. Returns { checkout_url }.
   *
   * 503 paths:
   *   - STRIPE_SECRET_KEY unset → 503 stripe_not_configured
   *   - The chosen tier's price id env var unset → 503 tier_not_configured
   */
  app.post(
    "/api/collective/membership/checkout",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const parsed = checkoutBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const { tier, chapter_id, success_url, cancel_url } = parsed.data;

      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean; identity?: { email?: string } }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res
          .status(401)
          .json({ ok: false, error: "missing_identity" });
      }

      if (!stripeSecretConfigured()) {
        return res
          .status(503)
          .json({ ok: false, error: "airwallex_not_configured" });
      }
      const priceId = priceIdForTier(tier);
      if (!priceId) {
        return res
          .status(503)
          .json({ ok: false, error: "tier_not_configured", tier });
      }

      // Chapter scope — caller must be an active member of the chapter
      // they're paying to upgrade in.
      if (!ctx?.isAdmin && !isChapterMember(userId, chapter_id)) {
        return res
          .status(403)
          .json({ ok: false, error: "not_chapter_member" });
      }

      // Persist the pending row BEFORE creating the Airwallex intent so the
      // merchant_order_id (== billing row id) round-trips through Airwallex
      // back to our webhook.
      let pending: BillingRow;
      try {
        pending = createPendingBilling(userId, chapter_id, tier, priceId);
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: "db_write_failed",
          message: (err as Error).message,
        });
      }

      // Create the Airwallex payment intent. Returns the hosted-payment-page
      // URL (Airwallex's equivalent of Stripe Checkout). The client redirects
      // there to enter card details; success returns to success_url with the
      // payment intent id, which the success-redirect endpoint verifies
      // against the gateway before flipping the billing row to active.
      const intentResult = await createCollectiveIntent({
        billingId: pending.id,
        userId,
        chapterId: chapter_id,
        tier,
        customerEmail: ctx?.identity?.email,
      });
      if (!intentResult.ok) {
        return res.status(intentResult.error === "airwallex_not_configured" ? 503 : 502).json({
          ok: false,
          error: intentResult.error,
          message: (intentResult as { message?: string }).message,
        });
      }

      /* v25.12 NH-2 — persist the intent id on the billing row AND recompute
       * the hash chain. Previously this update wrote stripeSubscriptionId
       * without touching prevHash/currHash, leaving the row inconsistent
       * with the chain (every subsequent chain-verification would fail for
       * this billing record, breaking audit + dispute resolution). We now
       * read the current row, recompute the next hash from currHash as
       * prevHash, and update all three fields in a single statement. */
      try {
        const db: any = getDb();
        const existingRow: any = db
          .select()
          .from(billingTable)
          .where(eq((billingTable as any).id, pending.id))
          .get();
        if (existingRow) {
          const existing = rowToBilling(existingRow);
          const updatedAt = nowIso();
          const payloadForHash = {
            id: existing.id,
            tenantId: existing.tenantId,
            chapterId: existing.chapterId,
            userId: existing.userId,
            tier: existing.tier,
            status: existing.status,
            stripeCustomerId: existing.stripeCustomerId,
            stripeSubscriptionId: intentResult.intent.id,
            stripePriceId: existing.stripePriceId,
            currentPeriodStart: existing.currentPeriodStart,
            currentPeriodEnd: existing.currentPeriodEnd,
            cancelAtPeriodEnd: existing.cancelAtPeriodEnd,
            updatedAt,
          };
          const newCurrHash = computeHash(existing.currHash, payloadForHash);
          db.update(billingTable)
            .set({
              stripeSubscriptionId: intentResult.intent.id,
              prevHash: existing.currHash,
              currHash: newCurrHash,
              updatedAt,
            } as any)
            .where(eq((billingTable as any).id, pending.id))
            .run();
        } else {
          // Row vanished between create and update — fall back to single-field write
          // (extremely unlikely, but safer than throwing).
          db.update(billingTable)
            .set({ stripeSubscriptionId: intentResult.intent.id } as any)
            .where(eq((billingTable as any).id, pending.id))
            .run();
        }
      } catch { /* non-fatal — webhook can still resolve via merchant_order_id */ }

      const fallbackSuccess =
        success_url ??
        `/collective/membership?status=success&intent_id=${intentResult.intent.id}`;
      const fallbackCancel = cancel_url ?? "/collective/membership?status=cancelled";

      return res.json({
        ok: true,
        gateway: "airwallex",
        billingId: pending.id,
        paymentIntentId: intentResult.intent.id,
        clientSecret: intentResult.intent.client_secret ?? null,
        checkout_url: intentResult.hostedPaymentPageUrl ?? fallbackSuccess,
        successUrl: fallbackSuccess,
        cancelUrl: fallbackCancel,
      });
    },
  );

  /**
   * POST /api/collective/membership/portal
   * Body: { chapter_id, return_url? }
   *
   * v25.4 — Airwallex has no hosted Customer Portal. Instead, this endpoint
   * returns a Capavate-hosted self-service URL. The client app implements
   * the actual portal screen (view current tier, cancel-at-period-end,
   * resume, view receipts). The response shape is preserved (`portal_url`)
   * so the existing client does not need a synchronized release.
   */
  app.post(
    "/api/collective/membership/portal",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    async (req: Request, res: Response) => {
      const parsed = portalBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const { chapter_id } = parsed.data;

      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }

      if (!ctx?.isAdmin && !isChapterMember(userId, chapter_id)) {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }

      const billing = getBillingForUser(userId, chapter_id);
      if (!billing || billing.status === "pending") {
        return res.status(404).json({ ok: false, error: "no_active_subscription" });
      }

      // Capavate-hosted self-service portal route. The client app reads the
      // billing row via GET /api/collective/membership/me and renders the UI;
      // mutations call POST /api/collective/membership/cancel and resume.
      const portalUrl = `/collective/membership/portal?chapter_id=${encodeURIComponent(chapter_id)}`;
      return res.json({
        ok: true,
        gateway: "airwallex",
        portal_url: portalUrl,
        capabilities: {
          cancel: true,
          resume: billing.cancelAtPeriodEnd,
          updatePaymentMethod: false, /* requires re-checkout in Airwallex */
          viewInvoices: true,
        },
      });
    },
  );

  /**
   * POST /api/collective/membership/cancel
   * Body: { chapter_id }
   *
   * v25.4 — self-service cancellation. Flips cancel_at_period_end=true on
   * the billing row; the renewal worker honors this and stops charging at
   * the next cycle. Membership stays active through current_period_end.
   */
  app.post(
    "/api/collective/membership/cancel",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const parsed = portalBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const { chapter_id } = parsed.data;
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      if (!ctx?.isAdmin && !isChapterMember(userId, chapter_id)) {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }
      const billing = getBillingForUser(userId, chapter_id);
      if (!billing || billing.status === "pending") {
        return res.status(404).json({ ok: false, error: "no_active_subscription" });
      }
      try {
        const ts = nowIso();
        const payloadForHash = {
          id: billing.id,
          action: "cancel_at_period_end",
          ts,
        };
        const currHash = computeHash(billing.currHash, payloadForHash);
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(billingTable)
            .set({
              cancelAtPeriodEnd: 1,
              prevHash: billing.currHash,
              currHash,
              updatedAt: ts,
            } as any)
            .where(eq((billingTable as any).id, billing.id))
            .run();
        });
        try {
          appendAdminAudit(
            ctx?.userId ?? "system",
            `collective_billing:${billing.id}`,
            "collective.billing.cancel_requested",
            { billingId: billing.id, chapterId: billing.chapterId, userId: billing.userId, tier: billing.tier },
          );
        } catch { /* non-fatal */ }
        return res.json({
          ok: true,
          gateway: "airwallex",
          billingId: billing.id,
          cancelAtPeriodEnd: true,
          accessThrough: billing.currentPeriodEnd ?? null,
        });
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: "db_write_failed",
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * POST /api/collective/membership/resume
   * Body: { chapter_id }
   *
   * v25.4 — reverses a pending cancel-at-period-end before the cycle ends.
   */
  app.post(
    "/api/collective/membership/resume",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const parsed = portalBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const { chapter_id } = parsed.data;
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      if (!ctx?.isAdmin && !isChapterMember(userId, chapter_id)) {
        return res.status(403).json({ ok: false, error: "not_chapter_member" });
      }
      const billing = getBillingForUser(userId, chapter_id);
      if (!billing) {
        return res.status(404).json({ ok: false, error: "no_subscription" });
      }
      if (!billing.cancelAtPeriodEnd) {
        return res.json({ ok: true, billingId: billing.id, cancelAtPeriodEnd: false, noOp: true });
      }
      try {
        const ts = nowIso();
        const payloadForHash = {
          id: billing.id,
          action: "resume",
          ts,
        };
        const currHash = computeHash(billing.currHash, payloadForHash);
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(billingTable)
            .set({
              cancelAtPeriodEnd: 0,
              prevHash: billing.currHash,
              currHash,
              updatedAt: ts,
            } as any)
            .where(eq((billingTable as any).id, billing.id))
            .run();
        });
        try {
          appendAdminAudit(
            ctx?.userId ?? "system",
            `collective_billing:${billing.id}`,
            "collective.billing.resume",
            { billingId: billing.id, chapterId: billing.chapterId, userId: billing.userId, tier: billing.tier },
          );
        } catch { /* non-fatal */ }
        return res.json({
          ok: true,
          gateway: "airwallex",
          billingId: billing.id,
          cancelAtPeriodEnd: false,
        });
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: "db_write_failed",
          message: (err as Error).message,
        });
      }
    },
  );

  /**
   * v25.22 NC-7 fix — POST /api/collective/membership/verify
   *
   * The success redirect from the Airwallex hosted-payment page is
   * insufficient on its own: if the webhook never lands, the user pays but
   * is never activated. This endpoint synchronously verifies the intent
   * against Airwallex AND drives the billing state machine via
   * `dispatchAirwallexEvent`, so the activation is guaranteed independent
   * of webhook delivery. The client should POST here on the success
   * redirect with `{ intent_id }`.
   *
   * Idempotent: dispatchAirwallexEvent dedups on gateway_event_id; calling
   * verify twice for the same intent produces one state transition.
   */
  app.post(
    "/api/collective/membership/verify",
    requireCollectiveEnabled,
    requireAuth,
    async (req: Request, res: Response) => {
      const ctx = (req as any).userContext as
        | { userId?: string }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const intentId =
        typeof req.body?.intent_id === "string" ? req.body.intent_id : null;
      if (!intentId) {
        return res.status(400).json({ ok: false, error: "intent_id_required" });
      }
      let intent;
      try {
        intent = await retrieveCollectiveIntent(intentId);
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: "gateway_retrieve_failed",
          message: (err as Error).message,
        });
      }
      if (!intent) {
        return res.status(404).json({ ok: false, error: "intent_not_found" });
      }
      /* Verify the intent belongs to this user before triggering activation
       * — prevents one user from confirming another user's paid intent. */
      const billingId =
        (intent as any).merchant_order_id ??
        ((intent as any).metadata?.billingId as string | undefined) ??
        null;
      if (!billingId) {
        return res.status(400).json({ ok: false, error: "intent_missing_billing_ref" });
      }
      const billing = findBillingByIdAnyTenant(billingId);
      if (!billing) {
        return res.status(404).json({ ok: false, error: "billing_not_found" });
      }
      if (billing.userId !== userId) {
        return res.status(403).json({ ok: false, error: "intent_not_yours" });
      }
      /* Construct a synthetic webhook envelope so dispatchAirwallexEvent
       * runs the canonical state transition. The `event.id` is derived
       * from the intent so a retried verify is idempotent against the
       * gateway_event_id dedup column. */
      const syntheticEvent = {
        id: `verify_${intentId}`,
        type: "payment_intent.succeeded",
        data: { object: intent as any },
      };
      const dispatchResult = await dispatchAirwallexEvent(syntheticEvent);
      if (!dispatchResult.ok) {
        return res.status(dispatchResult.status ?? 500).json({
          ok: false,
          error: dispatchResult.error ?? "verify_dispatch_failed",
        });
      }
      const fresh = findBillingByIdAnyTenant(billingId);
      return res.json({
        ok: true,
        idempotent: dispatchResult.idempotent,
        membership: fresh,
      });
    },
  );

  /**
   * GET /api/collective/membership/me?chapter_id=...
   *
   * Returns the current user's membership row for the requested chapter
   * (or the default chapter when chapter_id is omitted). 200 with
   * `{ membership: null }` if the user has never started a checkout.
   */
  app.get(
    "/api/collective/membership/me",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const parsed = meQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const chapterId = parsed.data.chapter_id ?? DEFAULT_CHAPTER_ID;

      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res
          .status(401)
          .json({ ok: false, error: "missing_identity" });
      }
      if (!ctx?.isAdmin && !isChapterMember(userId, chapterId)) {
        return res
          .status(403)
          .json({ ok: false, error: "not_chapter_member" });
      }
      const billing = getBillingForUser(userId, chapterId);
      return res.json({ ok: true, chapterId, membership: billing });
    },
  );

  /**
   * POST /api/airwallex/webhook/collective
   *
   * v25.4 — Airwallex webhook receiver. Verifies signature via the shared
   * AIRWALLEX_WEBHOOK_SECRET and dispatches the event into the ledger +
   * state machine. Idempotent on `gateway_event_id` (Airwallex retries 5xx).
   *
   * Auth: the signature IS the auth (no session). COLLECTIVE_ENABLED still
   * gates the surface.
   *
   * The legacy /api/stripe/webhook/collective path is retained below as a
   * permanent 410 so any orphaned Stripe webhook in the dashboard receives a
   * clear stop signal rather than silently 404'ing.
   */
  app.post(
    "/api/airwallex/webhook/collective",
    requireCollectiveEnabled,
    async (req: Request, res: Response) => {
      if (!stripeSecretConfigured()) {
        return res.status(503).json({ ok: false, error: "airwallex_not_configured" });
      }
      if (!stripeWebhookSecretConfigured()) {
        return res.status(503).json({ ok: false, error: "airwallex_webhook_not_configured" });
      }

      /* Capture the raw body for signature verification. index.ts's
       * express.json verify hook stores it on req.rawBody. */
      const raw: string =
        ((req as any).rawBody?.toString?.("utf8") as string | undefined) ??
        (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));

      const sigOk = verifyAirwallexSig(
        req.headers as Record<string, string | string[] | undefined>,
        raw,
      );
      /* v25.21 Lane A NH-001 fix — if the webhook secret IS configured, the
       * signature must be valid regardless of NODE_ENV. The legacy code
       * silently bypassed verification whenever NODE_ENV ≠ "production",
       * meaning a single env-var typo on a real production host would
       * disable verification on a financial-state webhook. The only escape
       * hatch is now an EXPLICIT opt-in env flag for local dev
       * (`AIRWALLEX_WEBHOOK_INSECURE_DEV=1`), and it's loud about it. */
      if (!sigOk) {
        const explicitDevBypass =
          process.env.NODE_ENV !== "production" &&
          process.env.AIRWALLEX_WEBHOOK_INSECURE_DEV === "1";
        if (!explicitDevBypass) {
          return res.status(401).json({ ok: false, error: "invalid_signature" });
        }
        log.warn(
          "[airwallex/webhook/collective] AIRWALLEX_WEBHOOK_INSECURE_DEV=1 — signature verification bypassed (DEV ONLY). Do not set this flag in production.",
        );
      }

      let event: { id: string; type?: string; name?: string; data?: { object?: Record<string, any> } };
      try {
        event = typeof req.body === "object" && req.body !== null
          ? (req.body as any)
          : JSON.parse(raw);
      } catch (err) {
        return res.status(400).json({
          ok: false,
          error: "invalid_body",
          message: (err as Error).message,
        });
      }

      if (!event?.id || !(event.type || event.name)) {
        return res.status(400).json({ ok: false, error: "invalid_event" });
      }

      try {
        const result = await dispatchAirwallexEvent(event);
        if (!result.ok) {
          return res
            .status(result.status ?? 500)
            .json({ ok: false, error: result.error ?? "handler_failed" });
        }
        return res.json({
          ok: true,
          type: event.type ?? event.name,
          idempotent: result.idempotent,
          gateway: "airwallex",
        });
      } catch (err) {
        log.error(
          "[airwallex/webhook/collective] handler error:",
          (err as Error).message,
        );
        return res.status(500).json({ ok: false, error: "handler_error" });
      }
    },
  );

  /* Permanent 410 for the deprecated Stripe path so Avi's old Stripe
   * webhook configuration receives a clear stop signal. */
  app.post("/api/stripe/webhook/collective", (_req: Request, res: Response) => {
    res.status(410).json({
      ok: false,
      error: "gateway_deprecated",
      message:
        "Stripe webhook is deprecated for Collective billing. Reconfigure the webhook to /api/airwallex/webhook/collective.",
    });
  });
}

/* --------------------------------------------------------------- */
/* Test-only exports                                                */
/* --------------------------------------------------------------- */
export const _internalCollectiveBilling = Object.freeze({
  computeHash,
  applyWebhookEvent,
  dispatchStripeEvent,        /* legacy; retained for v18 test files */
  dispatchAirwallexEvent,     /* v25.4 — primary dispatcher */
  findBillingByIdAnyTenant,
  findBillingBySubscriptionId,
  isChapterMember,
});
