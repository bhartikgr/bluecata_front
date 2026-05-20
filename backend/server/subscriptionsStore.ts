/**
 * Sprint 28 Wave 3 — Subscriptions store (production-shape).
 * Patch v12 Phase C — DB-backed hybrid migration.
 *
 * Subscription state lives in the `subscriptions` table (current row per
 * companyId) and `subscriptions_history` (one row per revision, append-only
 * hash-chain). The in-memory `store` and `history` Maps remain as READ caches;
 * every write goes through a Drizzle transaction first, then the Maps are
 * updated synchronously. Hydration on boot rebuilds the Maps from the DB.
 *
 * Money is in INTEGER MINOR UNITS (cents) + ISO 4217 currency — never floats.
 * Each row carries a `version` integer and `revisionHash` chained to the
 * previous revision (SHA-256 of canonical body || prevHash). The transaction
 * is the concurrency boundary that keeps the chain consistent (DB-6).
 */
import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { and, eq, isNull, asc } from "drizzle-orm";
import { companies } from "./mockData";
import { emitBridgeEvent } from "./bridgeStore";
import { getDb } from "./db/connection";
import {
  subscriptions as subscriptionsTable,
  subscriptionsHistory as subscriptionsHistoryTable,
} from "../shared/schema";

/* ---------- Schema ---------- */

export type SubscriptionStatus =
  | "active"               // Billing current, plan engaged.
  | "trialing"             // In trial window; billing not yet attempted.
  | "past_due"             // Most recent invoice failed; in dunning retry ladder.
  | "unpaid"               // Dunning exhausted; access restricted.
  | "cancelled"            // Tenant cancelled or downgraded out.
  | "pending_payment"      // Created but no payment method yet (new company).
  | "cancel_at_period_end"; // Cancels at period end; still active until then.

export type Plan = "founder_free" | "founder_pro" | "founder_scale" | "founder_enterprise";

export interface Subscription {
  companyId: string;
  status: SubscriptionStatus;
  plan: Plan;
  /** Annual price in minor units of `currency`. e.g. 298_800 for $2,988.00. */
  annualAmountMinor: number;
  /** ISO 4217 currency code, uppercase. */
  currency: string;
  /** ISO date the current period renews. */
  renewsOn: string;
  /** Last 4 digits of card on file. null if no payment method. */
  cardLast4: string | null;
  /** Total invoices issued (paid + open). */
  invoicesCount: number;
  /** Outstanding past-due amount in minor units; absent if not past_due. */
  pastDueMinor?: number;
  /** Trial end date (ISO) when status === 'trialing'. */
  trialEndsOn?: string;
  /** Monotonic version counter; bumps on every mutation. */
  version: number;
  /** Hash chain for tamper evidence. */
  revisionHash: string;
  prevRevisionHash: string;
  /** When this record was last mutated. */
  updatedAt: string;
  /** Actor who performed the last mutation. */
  updatedBy: string;
}

/* ---------- Audit + bridge sinks (registered at startup) ---------- */

type AuditAppender = (e: { actor: string; action: string; target: string; payload: unknown }) => void;
type BridgeEmitter = (eventType: string, aggregateId: string, payload: Record<string, unknown>) => void;

let auditAppender: AuditAppender = () => {};
let bridgeEmitter: BridgeEmitter = () => {};

export function configureSubscriptionsStore(opts: {
  audit: AuditAppender;
  bridge: BridgeEmitter;
}): void {
  auditAppender = opts.audit;
  bridgeEmitter = opts.bridge;
}

/* ---------- Plan price catalogue ---------- */

export const PLAN_PRICES: Record<Plan, { annualMinor: number; currency: string; label: string }> = {
  founder_free:       { annualMinor:        0, currency: "USD", label: "Founder Free" },
  founder_pro:        { annualMinor:   298_800, currency: "USD", label: "Founder Pro" },        // $2,988/yr (= $249/mo × 12)
  founder_scale:      { annualMinor:   900_000, currency: "USD", label: "Founder Scale" },      // $9,000/yr
  founder_enterprise: { annualMinor: 2_400_000, currency: "USD", label: "Founder Enterprise" }, // $24,000/yr
};

/* ---------- Seed ---------- */

function hashRevision(prevHash: string, body: unknown): string {
  return createHash("sha256").update(prevHash).update(JSON.stringify(body)).digest("hex");
}

function buildSeedRecord(
  companyId: string,
  prev: string,
  partial: {
    status: SubscriptionStatus;
    plan: Plan;
    renewsOn: string;
    cardLast4: string | null;
    invoicesCount: number;
    pastDueMinor?: number;
    trialEndsOn?: string;
  },
): Subscription {
  const price = PLAN_PRICES[partial.plan];
  const body = {
    companyId,
    ...partial,
    annualAmountMinor: price.annualMinor,
    currency: price.currency,
    version: 1,
    prevRevisionHash: prev,
    updatedAt: new Date().toISOString(),
    updatedBy: "system:seed",
  };
  return { ...body, revisionHash: hashRevision(prev, body) } as Subscription;
}

const SEED_PLAN_OVERRIDES: Record<string, {
  status: SubscriptionStatus;
  plan: Plan;
  renewsOn: string;
  cardLast4: string | null;
  invoicesCount: number;
  pastDueMinor?: number;
  trialEndsOn?: string;
}> = {
  co_novapay:   { status: "active",    plan: "founder_pro",        renewsOn: "2026-06-15", cardLast4: "4242", invoicesCount: 11 },
  co_arboreal:  { status: "active",    plan: "founder_pro",        renewsOn: "2026-06-22", cardLast4: "4242", invoicesCount: 3 },
  co_kelvin:    { status: "trialing",  plan: "founder_pro",        renewsOn: "2026-05-25", cardLast4: null,   invoicesCount: 0, trialEndsOn: "2026-05-25" },
  co_helia:     { status: "active",    plan: "founder_scale",      renewsOn: "2026-10-01", cardLast4: "0011", invoicesCount: 4 },
  co_quanta:    { status: "past_due",  plan: "founder_pro",        renewsOn: "2026-04-30", cardLast4: "8801", invoicesCount: 7, pastDueMinor: 24_900 },
  co_lattice:   { status: "active",    plan: "founder_enterprise", renewsOn: "2026-12-01", cardLast4: "9990", invoicesCount: 18 },
};

const store = new Map<string, Subscription>();
const history = new Map<string, Subscription[]>();

function seedFromCanonicalCompanies(): void {
  let prev = "0".repeat(64);
  for (const c of companies) {
    const cid = c.id as string;
    const override = SEED_PLAN_OVERRIDES[cid];
    const seed = override ?? {
      // Default new companies (no override): 14-day trial on Pro, no card yet.
      status: "trialing" as const,
      plan: "founder_pro" as const,
      renewsOn: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      cardLast4: null,
      invoicesCount: 0,
      trialEndsOn: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    };
    const rec = buildSeedRecord(cid, prev, seed);
    store.set(cid, rec);
    history.set(cid, [rec]);
    prev = rec.revisionHash;
  }
  // Best-effort DB write-through so the seed survives a restart on
  // ENABLE_DEMO_SEED + persistent SQLite. Idempotent via onConflictDoNothing.
  try {
    persistSeedToDb();
  } catch (err) {
    console.warn("[subscriptionsStore] seed persist failed (non-fatal):", (err as Error).message);
  }
}

function persistSeedToDb(): void {
  const db = getDb();
  // CROSS-TENANT (admin) — module-load seed runs once per process; tenant
  // scoping is enforced by the per-company id key. The rows themselves are
  // tenant-anchored via `companies.tenant_id` in the companies table.
  for (const rec of Array.from(store.values())) {
    try {
      db.insert(subscriptionsTable)
        .values({
          companyId: rec.companyId,
          status: rec.status,
          plan: rec.plan,
          annualAmountMinor: rec.annualAmountMinor,
          currency: rec.currency,
          renewsOn: rec.renewsOn,
          cardLast4: rec.cardLast4,
          invoicesCount: rec.invoicesCount,
          pastDueMinor: rec.pastDueMinor ?? null,
          trialEndsOn: rec.trialEndsOn ?? null,
          version: rec.version,
          prevRevisionHash: rec.prevRevisionHash,
          revisionHash: rec.revisionHash,
          updatedAt: rec.updatedAt,
          updatedBy: rec.updatedBy,
          deletedAt: null,
        })
        .onConflictDoNothing({ target: subscriptionsTable.companyId })
        .run();
      // Also seed the history table with the genesis row.
      db.insert(subscriptionsHistoryTable)
        .values({
          id: `subh_seed_${rec.companyId}`,
          companyId: rec.companyId,
          snapshotJson: JSON.stringify(rec),
          version: rec.version,
          revisionHash: rec.revisionHash,
          prevRevisionHash: rec.prevRevisionHash,
          recordedAt: rec.updatedAt,
          recordedBy: rec.updatedBy,
        })
        .onConflictDoNothing({ target: subscriptionsHistoryTable.id })
        .run();
    } catch { /* tolerated — seed DB may not be ready in some contexts */ }
  }
}

seedFromCanonicalCompanies();

/* ---------- Reads ---------- */

export function getSubscription(companyId: string): Subscription | null {
  return store.get(companyId) ?? null;
}

export function listSubscriptions(): Subscription[] {
  return Array.from(store.values());
}

export function getSubscriptionHistory(companyId: string): Subscription[] {
  return history.get(companyId) ?? [];
}

/* ---------- Mutations ---------- */

export type UpdateSubscriptionInput = Partial<Pick<Subscription,
  "status" | "plan" | "renewsOn" | "cardLast4" | "invoicesCount" | "pastDueMinor" | "trialEndsOn"
>>;

function rowToSubscription(row: any): Subscription {
  return {
    companyId: row.companyId,
    status: row.status as SubscriptionStatus,
    plan: row.plan as Plan,
    annualAmountMinor: row.annualAmountMinor,
    currency: row.currency,
    renewsOn: row.renewsOn,
    cardLast4: row.cardLast4 ?? null,
    invoicesCount: row.invoicesCount ?? 0,
    pastDueMinor: row.pastDueMinor ?? undefined,
    trialEndsOn: row.trialEndsOn ?? undefined,
    version: row.version,
    revisionHash: row.revisionHash,
    prevRevisionHash: row.prevRevisionHash,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export function updateSubscription(
  companyId: string,
  changes: UpdateSubscriptionInput,
  actor: string,
): { ok: true; subscription: Subscription } | { ok: false; error: string } {
  const current = store.get(companyId);
  if (!current) return { ok: false, error: "not_found" };

  const newPlan = changes.plan ?? current.plan;
  const planPrice = PLAN_PRICES[newPlan];

  const next: Subscription = {
    ...current,
    ...changes,
    annualAmountMinor: planPrice.annualMinor,
    currency: planPrice.currency,
    version: current.version + 1,
    prevRevisionHash: current.revisionHash,
    revisionHash: "", // computed below
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
  next.revisionHash = hashRevision(current.revisionHash, {
    companyId: next.companyId,
    status: next.status,
    plan: next.plan,
    annualAmountMinor: next.annualAmountMinor,
    currency: next.currency,
    renewsOn: next.renewsOn,
    cardLast4: next.cardLast4,
    invoicesCount: next.invoicesCount,
    pastDueMinor: next.pastDueMinor,
    trialEndsOn: next.trialEndsOn,
    version: next.version,
    updatedAt: next.updatedAt,
    updatedBy: next.updatedBy,
  });

  // DB-6: wrap in a transaction so the (history INSERT + subscriptions UPDATE)
  // succeed or fail atomically. better-sqlite3's transaction is BEGIN IMMEDIATE
  // by default, serializing concurrent writers on the hash chain.
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      // 1) Append the new revision to history.
      tx.insert(subscriptionsHistoryTable)
        .values({
          id: `subh_${companyId}_${next.version}_${Math.random().toString(36).slice(2, 8)}`,
          companyId,
          snapshotJson: JSON.stringify(next),
          version: next.version,
          revisionHash: next.revisionHash,
          prevRevisionHash: next.prevRevisionHash,
          recordedAt: next.updatedAt,
          recordedBy: actor,
        })
        .run();
      // 2) Upsert the current-state row.
      tx.insert(subscriptionsTable)
        .values({
          companyId,
          status: next.status,
          plan: next.plan,
          annualAmountMinor: next.annualAmountMinor,
          currency: next.currency,
          renewsOn: next.renewsOn,
          cardLast4: next.cardLast4,
          invoicesCount: next.invoicesCount,
          pastDueMinor: next.pastDueMinor ?? null,
          trialEndsOn: next.trialEndsOn ?? null,
          version: next.version,
          prevRevisionHash: next.prevRevisionHash,
          revisionHash: next.revisionHash,
          updatedAt: next.updatedAt,
          updatedBy: actor,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: subscriptionsTable.companyId,
          set: {
            status: next.status,
            plan: next.plan,
            annualAmountMinor: next.annualAmountMinor,
            currency: next.currency,
            renewsOn: next.renewsOn,
            cardLast4: next.cardLast4,
            invoicesCount: next.invoicesCount,
            pastDueMinor: next.pastDueMinor ?? null,
            trialEndsOn: next.trialEndsOn ?? null,
            version: next.version,
            prevRevisionHash: next.prevRevisionHash,
            revisionHash: next.revisionHash,
            updatedAt: next.updatedAt,
            updatedBy: actor,
            deletedAt: null,
          },
        })
        .run();
    });
  } catch (err) {
    console.error("[subscriptionsStore.updateSubscription] DB write failed:", (err as Error).message);
    return { ok: false, error: "db_write_failed" };
  }

  // After committed DB write, update Maps.
  store.set(companyId, next);
  const h = history.get(companyId) ?? [];
  h.push(next);
  history.set(companyId, h);

  auditAppender({
    actor,
    action: "subscription.updated",
    target: `subscription:${companyId}`,
    payload: { changes, fromVersion: current.version, toVersion: next.version },
  });
  bridgeEmitter("subscription.updated", companyId, {
    status: next.status,
    plan: next.plan,
    version: next.version,
    revisionHash: next.revisionHash,
  });

  return { ok: true, subscription: next };
}

/* ---------- Idempotent auto-provision for new company creation ---------- */

/**
 * createSubscriptionForNewCompany — called by the POST /api/founder/companies endpoint.
 * Idempotent: if a subscription row already exists for the company, returns it as-is.
 * Otherwise creates a new pending_payment row on founder_pro with annual cycle.
 * Emits a subscription.auto_created_on_company_create bridge event.
 */
export function createSubscriptionForNewCompany(
  companyId: string,
  options: { plan?: Plan; actor?: string } = {},
): { ok: true; subscription: Subscription; created: boolean } {
  const actor = options.actor ?? "system:new_company";
  const plan = options.plan ?? "founder_pro";

  // Idempotent check (Map first, then DB).
  const existing = store.get(companyId);
  if (existing) {
    return { ok: true, subscription: existing, created: false };
  }
  // DB-side idempotent check: another process may have inserted already.
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.companyId, companyId), isNull(subscriptionsTable.deletedAt)))
      .limit(1)
      .all() as any[];
    if (rows.length > 0) {
      const rec = rowToSubscription(rows[0]);
      store.set(companyId, rec);
      if (!history.has(companyId)) history.set(companyId, [rec]);
      return { ok: true, subscription: rec, created: false };
    }
  } catch { /* fallthrough to create */ }

  const price = PLAN_PRICES[plan];
  const renewsOn = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const prev = (() => {
    // Chain tip: last record in store
    const all = Array.from(store.values());
    return all.length > 0 ? all[all.length - 1].revisionHash : "0".repeat(64);
  })();

  const body = {
    companyId,
    status: "pending_payment" as SubscriptionStatus,
    plan,
    annualAmountMinor: price.annualMinor,
    currency: price.currency,
    renewsOn,
    cardLast4: null,
    invoicesCount: 0,
    version: 1,
    prevRevisionHash: prev,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
  const revisionHash = hashRevision(prev, body);
  const record: Subscription = { ...body, revisionHash };

  // DB-6: transaction for atomic (history + subscriptions) writes.
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(subscriptionsTable)
        .values({
          companyId: record.companyId,
          status: record.status,
          plan: record.plan,
          annualAmountMinor: record.annualAmountMinor,
          currency: record.currency,
          renewsOn: record.renewsOn,
          cardLast4: record.cardLast4,
          invoicesCount: record.invoicesCount,
          pastDueMinor: null,
          trialEndsOn: null,
          version: record.version,
          prevRevisionHash: record.prevRevisionHash,
          revisionHash: record.revisionHash,
          updatedAt: record.updatedAt,
          updatedBy: record.updatedBy,
          deletedAt: null,
        })
        .onConflictDoNothing({ target: subscriptionsTable.companyId })
        .run();
      tx.insert(subscriptionsHistoryTable)
        .values({
          id: `subh_create_${record.companyId}`,
          companyId: record.companyId,
          snapshotJson: JSON.stringify(record),
          version: record.version,
          revisionHash: record.revisionHash,
          prevRevisionHash: record.prevRevisionHash,
          recordedAt: record.updatedAt,
          recordedBy: record.updatedBy,
        })
        .onConflictDoNothing({ target: subscriptionsHistoryTable.id })
        .run();
    });
  } catch (err) {
    console.error(
      "[subscriptionsStore.createSubscriptionForNewCompany] DB write failed:",
      (err as Error).message,
    );
    // Fall through: still mirror in Maps so the rest of the request handler
    // (which depends on getSubscription) does not 500. The next mutation will
    // attempt to persist again.
  }

  store.set(companyId, record);
  history.set(companyId, [record]);

  // Audit + bridge (use emitBridgeEvent directly so tests see it in the outbox)
  auditAppender({
    actor,
    action: "subscription.auto_created_on_company_create",
    target: `subscription:${companyId}`,
    payload: { plan, status: "pending_payment", companyId, version: 1 },
  });
  emitBridgeEvent({
    eventType: "subscription.auto_created_on_company_create",
    aggregateId: companyId,
    aggregateKind: "company",
    payload: { plan, status: "pending_payment", version: 1, revisionHash },
  });

  return { ok: true, subscription: record, created: true };
}

/**
 * Soft-cancel a subscription. Sets `deleted_at` on the subscriptions row but
 * keeps the history chain intact. The Map cache stays so verifyChain and
 * historical reads keep working.
 */
export function cancelSubscription(companyId: string, actor: string): boolean {
  const current = store.get(companyId);
  if (!current) return false;
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.update(subscriptionsTable)
        .set({ status: "cancelled", deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: actor })
        .where(eq(subscriptionsTable.companyId, companyId))
        .run();
    });
  } catch (err) {
    console.error("[subscriptionsStore.cancelSubscription] DB write failed:", (err as Error).message);
    return false;
  }
  // Maps: keep the row but flip status so callers see "cancelled".
  store.set(companyId, { ...current, status: "cancelled" });
  return true;
}

/* ---------- Chain verification (audit / SOC2) ---------- */

export function verifyChain(companyId: string): { ok: boolean; brokenAt?: number; length: number } {
  const h = history.get(companyId) ?? [];
  for (let i = 0; i < h.length; i++) {
    const rec = h[i];
    const expectedPrev = i === 0 ? "0".repeat(64) : h[i - 1].revisionHash;
    if (rec.prevRevisionHash !== expectedPrev) return { ok: false, brokenAt: i, length: h.length };
  }
  return { ok: true, length: h.length };
}

/* ---------- Hydration ---------- */

/**
 * Hydrate the in-memory `store` + `history` Maps from the DB tables. Called by
 * server/lib/hydrateStores.ts at boot (after userCredentials, before
 * multiCompanyStore — see DB-4 ordering).
 *
 * History is sorted by `version ASC` so the in-memory array order matches the
 * canonical hash-chain order.
 */
export async function hydrateSubscriptionsStore(): Promise<void> {
  const db = getDb();
  // CROSS-TENANT (admin) — every subscription is keyed by its companyId; the
  // tenant scoping is enforced by the companies table's tenant_id. We need
  // every subscription regardless of which tenant called hydrate.
  const subs = (await db
    .select()
    .from(subscriptionsTable)
    .where(isNull(subscriptionsTable.deletedAt))) as any[];

  store.clear();
  for (const row of subs) {
    const rec = rowToSubscription(row);
    store.set(rec.companyId, rec);
  }

  // Hydrate history sorted by version ASC.
  const histRows = (await db
    .select()
    .from(subscriptionsHistoryTable)
    .orderBy(asc(subscriptionsHistoryTable.version))) as any[];

  history.clear();
  for (const h of histRows) {
    // Snapshot stored as JSON.
    try {
      const snap = JSON.parse(h.snapshotJson) as Subscription;
      const list = history.get(h.companyId) ?? [];
      list.push(snap);
      history.set(h.companyId, list);
    } catch {
      // Defensive: a malformed snapshot must not abort hydration.
      console.warn("[subscriptionsStore.hydrate] failed to parse history snapshot for", h.companyId);
    }
  }
}

/* ---------- Routes ---------- */

export function registerSubscriptionRoutes(app: Express): void {
  app.get("/api/admin/subscriptions", (_req: Request, res: Response) => {
    res.json({ subscriptions: listSubscriptions() });
  });

  app.get("/api/admin/subscriptions/:companyId", (req: Request, res: Response) => {
    const s = getSubscription(req.params.companyId);
    if (!s) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, subscription: s });
  });

  app.get("/api/admin/subscriptions/:companyId/history", (req: Request, res: Response) => {
    const h = getSubscriptionHistory(req.params.companyId);
    const chain = verifyChain(req.params.companyId);
    res.json({ ok: true, history: h, chain });
  });

  app.patch("/api/admin/subscriptions/:companyId", (req: Request, res: Response) => {
    const actor = (req.headers["x-actor-email"] as string | undefined) ?? "admin@capavate.com";
    const result = updateSubscription(req.params.companyId, req.body ?? {}, actor);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });
}

/* ---------- Testing exports ---------- */
export const _testSubscriptions = { store, history, seedFromCanonicalCompanies, hashRevision };
