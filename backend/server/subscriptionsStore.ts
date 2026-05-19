/**
 * Sprint 28 Wave 3 — Subscriptions store (production-shape).
 * KL-04 FIX: rawDb use karo, founder routes add karo
 */
import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { companies } from "./mockData";
import { emitBridgeEvent } from "./bridgeStore";
import { rawDb } from "./db/connection";
import { resolvePersonaId } from "./lib/userContext";

/* ---------- Schema ---------- */

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "cancelled"
  | "pending_payment"
  | "cancel_at_period_end";

export type Plan = "founder_free" | "founder_pro" | "founder_scale" | "founder_enterprise";

export interface Subscription {
  companyId: string;
  status: SubscriptionStatus;
  plan: Plan;
  annualAmountMinor: number;
  currency: string;
  renewsOn: string;
  cardLast4: string | null;
  invoicesCount: number;
  pastDueMinor?: number;
  trialEndsOn?: string;
  version: number;
  revisionHash: string;
  prevRevisionHash: string;
  updatedAt: string;
  updatedBy: string;
}

/* ---------- Audit + bridge sinks ---------- */
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
  founder_pro:        { annualMinor:   298_800, currency: "USD", label: "Founder Pro" },
  founder_scale:      { annualMinor:   900_000, currency: "USD", label: "Founder Scale" },
  founder_enterprise: { annualMinor: 2_400_000, currency: "USD", label: "Founder Enterprise" },
};

/* ---------- In-memory store ---------- */
const store = new Map<string, Subscription>();
const history = new Map<string, Subscription[]>();

/* ---------- Hydrate from DB ---------- */
export async function hydrateFromDatabase(): Promise<void> {
  console.log('[subscriptionsStore] Hydrating from SQLite...');
  try {
    const rows = rawDb().prepare(`SELECT payload FROM sync_lifecycle_policy`).all() as Array<{ payload: string }>;
    let loaded = 0;
    for (const row of rows) {
      try {
        const sub: Subscription = JSON.parse(row.payload);
        if (sub.companyId) {
          store.set(sub.companyId, sub);
          loaded++;
        }
      } catch { /* skip */ }
    }
    console.log(`[subscriptionsStore] loaded ${loaded} from DB`);
    if (loaded > 0) return; // skip seed
  } catch (e) {
    console.error('[subscriptionsStore] DB load failed:', e);
  }
  // Seed if empty
  seedFromMockData();
}

/* ---------- Hash ---------- */
function hashRevision(prevHash: string, body: unknown): string {
  return createHash("sha256").update(prevHash).update(JSON.stringify(body)).digest("hex");
}

/* ---------- Seed ---------- */
const SEED_PLAN_OVERRIDES: Record<string, {
  status: SubscriptionStatus; plan: Plan; renewsOn: string;
  cardLast4: string | null; invoicesCount: number;
  pastDueMinor?: number; trialEndsOn?: string;
}> = {
  co_novapay:   { status: "active",   plan: "founder_pro",        renewsOn: "2026-06-15", cardLast4: "4242", invoicesCount: 11 },
  co_arboreal:  { status: "active",   plan: "founder_pro",        renewsOn: "2026-06-22", cardLast4: "4242", invoicesCount: 3 },
  co_kelvin:    { status: "trialing", plan: "founder_pro",        renewsOn: "2026-05-25", cardLast4: null,   invoicesCount: 0, trialEndsOn: "2026-05-25" },
  co_helia:     { status: "active",   plan: "founder_scale",      renewsOn: "2026-10-01", cardLast4: "0011", invoicesCount: 4 },
  co_quanta:    { status: "past_due", plan: "founder_pro",        renewsOn: "2026-04-30", cardLast4: "8801", invoicesCount: 7, pastDueMinor: 24_900 },
  co_lattice:   { status: "active",   plan: "founder_enterprise", renewsOn: "2026-12-01", cardLast4: "9990", invoicesCount: 18 },
};

function seedFromMockData(): void {
  if (store.size > 0) return;
  let prev = "0".repeat(64);
  for (const c of companies) {
    const cid = c.id as string;
    const override = SEED_PLAN_OVERRIDES[cid] ?? {
      status: "trialing" as const,
      plan: "founder_pro" as const,
      renewsOn: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      cardLast4: null,
      invoicesCount: 0,
      trialEndsOn: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    };
    const price = PLAN_PRICES[override.plan];
    const body = {
      companyId: cid, ...override,
      annualAmountMinor: price.annualMinor,
      currency: price.currency,
      version: 1,
      prevRevisionHash: prev,
      updatedAt: new Date().toISOString(),
      updatedBy: "system:seed",
    };
    const rec: Subscription = { ...body, revisionHash: hashRevision(prev, body) };
    store.set(cid, rec);
    history.set(cid, [rec]);
    prev = rec.revisionHash;
  }
  console.log(`[subscriptionsStore] seeded ${store.size} subscriptions`);
}

// Seed on module load
seedFromMockData();

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

/* ---------- Auto-provision for new company ---------- */
export function createSubscriptionForNewCompany(
  companyId: string,
  options: { plan?: Plan; actor?: string } = {},
): { ok: true; subscription: Subscription; created: boolean } {
  const actor = options.actor ?? "system:new_company";
  const plan = options.plan ?? "founder_pro";
  const existing = store.get(companyId);
  if (existing) return { ok: true, subscription: existing, created: false };

  const price = PLAN_PRICES[plan];
  const renewsOn = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const prev = "0".repeat(64);
  const body = {
    companyId,
    status: "trialing" as SubscriptionStatus,
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
    trialEndsOn: renewsOn,
  };
  const record: Subscription = { ...body, revisionHash: hashRevision(prev, body) };
  store.set(companyId, record);
  history.set(companyId, [record]);
  return { ok: true, subscription: record, created: true };
}

/* ---------- Update ---------- */
export type UpdateSubscriptionInput = Partial<Pick<Subscription,
  "status" | "plan" | "renewsOn" | "cardLast4" | "invoicesCount" | "pastDueMinor" | "trialEndsOn"
>>;

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
    ...current, ...changes,
    annualAmountMinor: planPrice.annualMinor,
    currency: planPrice.currency,
    version: current.version + 1,
    prevRevisionHash: current.revisionHash,
    revisionHash: "",
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
  next.revisionHash = hashRevision(current.revisionHash, next);
  store.set(companyId, next);
  const h = history.get(companyId) ?? [];
  h.push(next);
  history.set(companyId, h);

  auditAppender({ actor, action: "subscription.updated", target: `subscription:${companyId}`, payload: changes });
  bridgeEmitter("subscription.updated", companyId, { status: next.status, plan: next.plan, version: next.version });
  return { ok: true, subscription: next };
}

/* ---------- Chain verification ---------- */
export function verifyChain(companyId: string): { ok: boolean; brokenAt?: number; length: number } {
  const h = history.get(companyId) ?? [];
  for (let i = 0; i < h.length; i++) {
    const expectedPrev = i === 0 ? "0".repeat(64) : h[i - 1].revisionHash;
    if (h[i].prevRevisionHash !== expectedPrev) return { ok: false, brokenAt: i, length: h.length };
  }
  return { ok: true, length: h.length };
}

/* ---------- Routes ---------- */
export function registerSubscriptionRoutes(app: Express): void {

  // ── Admin routes ───────────────────────────────────────────
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

  // ── Founder routes ─────────────────────────────────────────
  // GET /api/founder/subscription — active company ka subscription
  app.get("/api/founder/subscription", (req: Request, res: Response) => {
    const userId = resolvePersonaId(req);
    const companyId = String(req.query.companyId ?? req.headers["x-company-id"] ?? "");
    
    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId required" });
    }

    let s = getSubscription(companyId);
    
    // Agar subscription nahi hai toh auto-create karo (new user)
    if (!s) {
      const result = createSubscriptionForNewCompany(companyId, { actor: userId ?? "system" });
      s = result.subscription;
    }

    res.json({ ok: true, subscription: s });
  });

  // POST /api/founder/subscription/charge — sandbox charge
  app.post("/api/founder/subscription/charge", (req: Request, res: Response) => {
    const { companyId, planId } = req.body ?? {};
    const userId = resolvePersonaId(req) ?? "unknown";

    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId required" });
    }

    let s = getSubscription(companyId);
    if (!s) {
      const result = createSubscriptionForNewCompany(companyId, { actor: userId });
      s = result.subscription;
    }

    // Sandbox charge — always succeeds
    const plan = (planId as Plan) ?? s.plan;
    const result = updateSubscription(companyId, {
      status: "active",
      plan,
      cardLast4: "4242",
      renewsOn: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
    }, userId);

    if (!result.ok) return res.status(404).json(result);

    res.json({
      ok: true,
      subscription: result.subscription,
      paymentIntent: { status: "succeeded", sandbox: true },
    });
  });
}

/* ---------- Testing exports ---------- */
export const _testSubscriptions = { store, history, seedFromMockData, hashRevision };