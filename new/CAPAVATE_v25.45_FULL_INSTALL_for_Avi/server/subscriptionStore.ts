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
 * checkout flow still functions hermetically.
 *
 * v25.32 burndown — item 2 (doc accuracy): the prior sentence here claimed the
 * in-memory cache "is the authority for reads either way." That is no longer
 * true and contradicted the actual read paths. As of the v25.32 deep hardening
 * pass the read APIs (getByPaymentIntent / getByMerchantOrderId / listForCompany)
 * are DB-direct against `capavate_subscriptions` and THROW when no raw driver is
 * available — they never consult the `subscriptions` Map. The Map remains only a
 * write-through cache for downstream emitters/tests and is NEVER the read source.
 * See the "---- Reads ----" section comment below (subscriptionStore.ts:312-319).
 * Documentation-only edit; no logic, no Avi write path, and no SACRED file
 * touched. Source: v25_32_RELEASE_AUDIT_gpt55.md item 2 (subscriptionStore.ts:20-26).
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
  /** v25.32 P1d — explicit subscription validity end set by the payment
   *  webhook success branch (+30d monthly / +365d annual). Mirrors expiresAt
   *  for the founder/collective billing UIs that read `current_period_end`. */
  currentPeriodEnd: string | null;
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

/* ---------- Write-through cache (DB is the read source) ----------
 *
 * v25.32 burndown item 2 — the header used to claim this Map was the
 * "in-memory authority". As of v25.32 the public READ APIs
 * (getByPaymentIntent, getByMerchantOrderId, listForCompany,
 * getSubscription) all hit SQLite via rawDb() and throw when no driver
 * is available; they never consult this Map. The Map is preserved
 * ONLY as a write-through cache so downstream Avi emitters that have
 * historically read it after a write keep working byte-identically.
 * If you are adding a new read path: DO NOT read this Map. Query the
 * capavate_subscriptions table via the existing helpers.
 */
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
    // v25.32 P1d — additive: current_period_end column for the webhook success
    // branch. ADD COLUMN here (guaranteed-exists table) rather than in
    // connection.ts (where this table is created lazily, not at boot). Swallow
    // the duplicate-column error so re-runs are no-ops.
    try {
      driver.exec(`ALTER TABLE capavate_subscriptions ADD COLUMN current_period_end TEXT`);
    } catch (e) {
      if (!/duplicate column/i.test((e as Error).message || "")) {
        log.warn("[subscriptionStore.ensureTable] add current_period_end failed (non-fatal):", (e as Error).message);
      }
    }
    driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_capsub_payment_intent ON capavate_subscriptions(payment_intent_id);`,
    );
    // v25.32 Item 36 — additive indexes for the two non-intent resolver paths.
    // listForCompany() filters by company_id and getByMerchantOrderId() resolves
    // by merchant_order_id; without these, both did full table scans. IF NOT
    // EXISTS keeps re-runs idempotent.
    driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_capsub_company ON capavate_subscriptions(company_id);`,
    );
    driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_capsub_merchant_order ON capavate_subscriptions(merchant_order_id);`,
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
    currentPeriodEnd: r.current_period_end ?? null,
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
  // v25.32 deep Fix 4 — the idempotency dedup READ is DB-direct so a row that
  // exists in the durable table (but not in this process's cache) is honoured.
  // The WRITE path below is unchanged (Avi's write logic preserved).
  const existing = getByPaymentIntent(input.paymentIntentId);
  if (existing) return existing;

  const sub: CapavateSubscription = {
    currentPeriodEnd: null,
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
  /* v25.32 final hardening — FAIL CLOSED on durable write failure.
   *
   * Previously this function caught DB insert errors, logged a warning,
   * and returned a cache-only Subscription. The caller (`/api/billing/plan`)
   * had already minted the Airwallex PaymentIntent before reaching here
   * — so a swallowed DB failure could let the user proceed to hosted
   * checkout and pay against a PaymentIntent for which no durable
   * `capavate_subscriptions` row exists. The success webhook then could
   * not find the local row to flip to active, producing a paid-but-
   * inactive customer with no automated reconciliation.
   *
   * v25.32 final throws on DB write failure (and on missing driver). The
   * caller in routes.ts catches the throw and returns 503 to the client
   * so the customer is never sent to hosted checkout for an intent we
   * cannot reconcile. If the DB recovers, the customer can retry.
   *
   * The in-memory `subscriptions` Map remains as a write-through cache
   * for downstream emitters, but it is only set AFTER the durable INSERT
   * succeeds. */
  const driver = db();
  if (!driver) {
    throw new Error("recordPendingSubscription: DB driver unavailable");
  }
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
  // Refresh the write-through cache only after the durable INSERT lands.
  subscriptions.set(sub.paymentIntentId, sub);
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
  // v25.32 deep Fix 4 — resolve the row DB-direct (Map is hydration cache only).
  const sub = getByPaymentIntent(paymentIntentId);
  if (!sub) return null;
  if (sub.status === "active") return sub;

  const activatedAt = new Date().toISOString();
  sub.status = "active";
  sub.activatedAt = activatedAt;
  if (opts.expiresAt !== undefined) sub.expiresAt = opts.expiresAt;
  subscriptions.set(paymentIntentId, sub); // refresh cache side-effect

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
  // v25.32 deep Fix 4 — resolve the row DB-direct (Map is hydration cache only).
  const sub = getByPaymentIntent(paymentIntentId);
  if (!sub) return null;
  if (sub.status === "active") return sub; // never downgrade a confirmed-active sub
  sub.status = "failed";
  subscriptions.set(paymentIntentId, sub); // refresh cache side-effect
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

/* v25.32 deep hardening pass (Ozan's rule: nothing in memory):
 *
 * The read APIs below are DB-direct. The in-memory `subscriptions` Map is
 * still maintained as a WRITE-THROUGH cache for downstream emitters and
 * Avi's tests, but it is NEVER consulted on reads. If the DB is unreachable
 * we throw a clear error rather than silently serving stale RAM —
 * stale-subscription-status is more dangerous than a 5xx that prompts a
 * retry. */

export function getByPaymentIntent(paymentIntentId: string): CapavateSubscription | null {
  ensureTable();
  const driver = db();
  if (!driver) {
    throw new Error("subscriptionStore.getByPaymentIntent: DB driver unavailable");
  }
  const row = driver
    .prepare(`SELECT * FROM capavate_subscriptions WHERE payment_intent_id = ?`)
    .get(paymentIntentId) as any;
  if (!row) return null;
  const sub = rowToSub(row);
  subscriptions.set(sub.paymentIntentId, sub); // write-through cache refresh; never the read source
  return sub;
}

export function getByMerchantOrderId(merchantOrderId: string): CapavateSubscription | null {
  ensureTable();
  const driver = db();
  if (!driver) {
    throw new Error("subscriptionStore.getByMerchantOrderId: DB driver unavailable");
  }
  const row = driver
    .prepare(`SELECT * FROM capavate_subscriptions WHERE merchant_order_id = ?`)
    .get(merchantOrderId) as any;
  if (!row) return null;
  const sub = rowToSub(row);
  subscriptions.set(sub.paymentIntentId, sub);
  return sub;
}

export function listForCompany(companyId: string): CapavateSubscription[] {
  ensureTable();
  const driver = db();
  if (!driver) {
    throw new Error("subscriptionStore.listForCompany: DB driver unavailable");
  }
  const rows = driver
    .prepare(`SELECT * FROM capavate_subscriptions WHERE company_id = ?`)
    .all(companyId) as any[];
  const subs = rows.map(rowToSub);
  for (const s of subs) subscriptions.set(s.paymentIntentId, s);
  return subs;
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
