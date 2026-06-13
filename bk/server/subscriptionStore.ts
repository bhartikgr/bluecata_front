/**
 * v24.2 Airwallex wiring — Capavate checkout-subscription store.
 *
 * Tracks the lifecycle of a subscription purchase made through the Airwallex
 * hosted-payment flow:
 *
 *   pending  → a PaymentIntent has been minted; awaiting the customer paying on
 *              the Airwallex hosted page and the `payment_intent.succeeded`
 *              webhook landing.
 *   active   → the webhook confirmed payment; the subscription is live.
 *   failed   → the webhook reported a terminal failure / cancellation.
 *
 * IMPORTANT — Avi's bug: previously the founder's card data was saved locally
 * with NO upstream Airwallex call, so a "record" existed in Capavate even
 * though no money moved. This store ONLY records a *pending* row at the moment
 * a real PaymentIntent is minted, and only flips to *active* when Airwallex
 * confirms via signed webhook. The local row is therefore a faithful shadow of
 * the gateway's truth, never a substitute for it.
 *
 * Persistence: a dedicated `capavate_subscriptions` table created lazily via
 * CREATE TABLE IF NOT EXISTS using the better-sqlite3 raw driver (rawDb()),
 * mirroring the founderCrmStore / captableCommitStore pattern. The sacred
 * `shared/schema.ts` is NOT modified. On the Postgres backend (where rawDb()
 * throws) and in no-DB sandboxes the store degrades to an in-memory map so the
 * checkout flow still functions hermetically; the in-memory cache is the
 * authority for reads either way.
 */
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

export type CapavateSubscriptionStatus = "pending" | "active" | "failed";

export interface CapavateSubscription {
  id: string;
  companyId: string;
  tierId: string;
  userId: string;
  status: CapavateSubscriptionStatus;
  paymentIntentId: string;
  amountMinor: number;
  currency: string;
  billingCycle: string;
  merchantOrderId: string | null;
  createdAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
}

export interface RecordPendingInput {
  companyId: string;
  tierId: string;
  userId: string;
  billingCycle: string;
  paymentIntentId: string;
  amountMinor: number;
  currency: string;
  merchantOrderId?: string | null;
}

/* ---------- In-memory authority (also the cache over the DB) ---------- */
const subscriptions = new Map<string, CapavateSubscription>(); // keyed by paymentIntentId

let tableReady = false;

function db(): { exec: (s: string) => void; prepare: (s: string) => any } | null {
  try {
    return rawDb();
  } catch {
    // Postgres backend (rawDb throws) or no-DB sandbox — in-memory only.
    return null;
  }
}

function ensureTable(): void {
  if (tableReady) return;
  const driver = db();
  if (!driver) {
    // No raw SQLite driver; in-memory store is authoritative.
    tableReady = true;
    return;
  }
  try {
    driver.exec(`CREATE TABLE IF NOT EXISTS capavate_subscriptions (
      id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT NOT NULL,
      tier_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      payment_intent_id TEXT NOT NULL UNIQUE,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      billing_cycle TEXT NOT NULL,
      merchant_order_id TEXT,
      created_at TEXT NOT NULL,
      activated_at TEXT,
      expires_at TEXT
    );`);
    driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_capsub_payment_intent ON capavate_subscriptions(payment_intent_id);`,
    );
    tableReady = true;
  } catch (err) {
    log.warn("[subscriptionStore.ensureTable] CREATE TABLE failed (non-fatal):", (err as Error).message);
    tableReady = true; // fall back to in-memory; don't retry every call
  }
}

function rowToSub(r: any): CapavateSubscription {
  return {
    id: r.id,
    companyId: r.company_id,
    tierId: r.tier_id,
    userId: r.user_id,
    status: r.status as CapavateSubscriptionStatus,
    paymentIntentId: r.payment_intent_id,
    amountMinor: typeof r.amount_minor === "number" ? r.amount_minor : Number(r.amount_minor),
    currency: r.currency,
    billingCycle: r.billing_cycle,
    merchantOrderId: r.merchant_order_id ?? null,
    createdAt: r.created_at,
    activatedAt: r.activated_at ?? null,
    expiresAt: r.expires_at ?? null,
  };
}

/* ---------- Hydration (rebuild cache from DB on boot/restart) ---------- */
export function hydrateSubscriptionStore(): void {
  ensureTable();
  const driver = db();
  if (!driver) return;
  try {
    const rows = driver
      .prepare(`SELECT * FROM capavate_subscriptions`)
      .all() as any[];
    subscriptions.clear();
    for (const r of rows) {
      const sub = rowToSub(r);
      subscriptions.set(sub.paymentIntentId, sub);
    }
  } catch (err) {
    log.warn("[subscriptionStore.hydrate] load failed (non-fatal):", (err as Error).message);
  }
}

/* ---------- Writes ---------- */

/**
 * Record a PENDING subscription the moment a real Airwallex PaymentIntent is
 * minted. Idempotent on paymentIntentId — re-recording the same intent returns
 * the existing row rather than duplicating.
 */
export function recordPendingSubscription(input: RecordPendingInput): CapavateSubscription {
  ensureTable();
  const existing = subscriptions.get(input.paymentIntentId);
  if (existing) return existing;

  const sub: CapavateSubscription = {
    id: `capsub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    companyId: input.companyId,
    tierId: input.tierId,
    userId: input.userId,
    status: "pending",
    paymentIntentId: input.paymentIntentId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    billingCycle: input.billingCycle,
    merchantOrderId: input.merchantOrderId ?? null,
    createdAt: new Date().toISOString(),
    activatedAt: null,
    expiresAt: null,
  };
  subscriptions.set(sub.paymentIntentId, sub);

  const driver = db();
  if (driver) {
    try {
      driver
        .prepare(
          `INSERT INTO capavate_subscriptions
             (id, company_id, tier_id, user_id, status, payment_intent_id, amount_minor, currency, billing_cycle, merchant_order_id, created_at, activated_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(payment_intent_id) DO NOTHING`,
        )
        .run(
          sub.id,
          sub.companyId,
          sub.tierId,
          sub.userId,
          sub.status,
          sub.paymentIntentId,
          sub.amountMinor,
          sub.currency,
          sub.billingCycle,
          sub.merchantOrderId,
          sub.createdAt,
          sub.activatedAt,
          sub.expiresAt,
        );
    } catch (err) {
      log.warn("[subscriptionStore.recordPending] DB write failed (cache retained):", (err as Error).message);
    }
  }
  return sub;
}

/**
 * Flip a pending subscription to active when the gateway confirms payment.
 * Idempotent: re-confirming an already-active subscription is a no-op that
 * returns the active row. Returns null if no such subscription exists.
 */
export function activateByPaymentIntent(
  paymentIntentId: string,
  opts: { expiresAt?: string | null } = {},
): CapavateSubscription | null {
  ensureTable();
  const sub = subscriptions.get(paymentIntentId);
  if (!sub) return null;
  if (sub.status === "active") return sub;

  const activatedAt = new Date().toISOString();
  sub.status = "active";
  sub.activatedAt = activatedAt;
  if (opts.expiresAt !== undefined) sub.expiresAt = opts.expiresAt;
  subscriptions.set(paymentIntentId, sub);

  const driver = db();
  if (driver) {
    try {
      driver
        .prepare(
          `UPDATE capavate_subscriptions SET status = 'active', activated_at = ?, expires_at = COALESCE(?, expires_at) WHERE payment_intent_id = ?`,
        )
        .run(activatedAt, opts.expiresAt ?? null, paymentIntentId);
    } catch (err) {
      log.warn("[subscriptionStore.activate] DB write failed (cache updated):", (err as Error).message);
    }
  }
  return sub;
}

/** Mark a subscription failed (terminal). Returns null if unknown. */
export function failByPaymentIntent(paymentIntentId: string): CapavateSubscription | null {
  ensureTable();
  const sub = subscriptions.get(paymentIntentId);
  if (!sub) return null;
  if (sub.status === "active") return sub; // never downgrade a confirmed-active sub
  sub.status = "failed";
  subscriptions.set(paymentIntentId, sub);
  const driver = db();
  if (driver) {
    try {
      driver
        .prepare(`UPDATE capavate_subscriptions SET status = 'failed' WHERE payment_intent_id = ?`)
        .run(paymentIntentId);
    } catch (err) {
      log.warn("[subscriptionStore.fail] DB write failed (cache updated):", (err as Error).message);
    }
  }
  return sub;
}

/* ---------- Reads ---------- */

export function getByPaymentIntent(paymentIntentId: string): CapavateSubscription | null {
  ensureTable();
  return subscriptions.get(paymentIntentId) ?? null;
}

export function getByMerchantOrderId(merchantOrderId: string): CapavateSubscription | null {
  ensureTable();
  return Array.from(subscriptions.values()).find((s) => s.merchantOrderId === merchantOrderId) ?? null;
}

export function listForCompany(companyId: string): CapavateSubscription[] {
  ensureTable();
  return Array.from(subscriptions.values()).filter((s) => s.companyId === companyId);
}

/* ---------- Test helpers ---------- */
export const _testSubscriptionStore = {
  reset(): void {
    subscriptions.clear();
    const driver = db();
    if (driver) {
      try {
        driver.exec(`DELETE FROM capavate_subscriptions`);
      } catch {
        /* table may not exist yet */
      }
    }
  },
  all(): CapavateSubscription[] {
    return Array.from(subscriptions.values());
  },
};
