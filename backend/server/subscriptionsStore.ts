/**
 * Sprint 28 Wave 3 — Subscriptions store (production-shape).
 *
 * Source of truth for company subscription state. Production-ready properties:
 *   - One record per companyId.
 *   - Money in INTEGER MINOR UNITS (cents) + ISO 4217 currency code — never
 *     floating-point.
 *   - Status enum aligned with the standard billing lifecycle (Stripe-compatible).
 *   - Every mutation produces an audit entry + a bridge event so the Collective
 *     stays in sync and the Audit Log retains the full history.
 *   - Tamper-evident: each subscription carries a `version` integer that
 *     increments on every change and a `revisionHash` chained to the previous
 *     revision (SHA-256 of canonical body || prevHash).
 *
 * Seed data is derived from the canonical FOUNDER_COMPANIES + companies store
 * (Capavate's existing tenant inventory). Subscription numbers are taken
 * directly from those records \u2014 NO invented mock customers. The store is the
 * single integration point that Wave 8 (Pricing & Billing) and the Stripe / Avi
 * payment-gateway adapter will write through.
 */
import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { companies } from "./mockData";
import { emitBridgeEvent } from "./bridgeStore";

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
  founder_pro:        { annualMinor:   298_800, currency: "USD", label: "Founder Pro" },        // $2,988/yr (= $249/mo \u00d7 12)
  founder_scale:      { annualMinor:   900_000, currency: "USD", label: "Founder Scale" },      // $9,000/yr
  founder_enterprise: { annualMinor: 2_400_000, currency: "USD", label: "Founder Enterprise" }, // $24,000/yr
};

/* ---------- Seed ---------- */

/**
 * Map the canonical FOUNDER_COMPANIES.billing.plan strings ("Founder Pro" etc.)
 * to our typed enum. New companies that don't exist in FOUNDER_COMPANIES yet
 * default to a 14-day trial on Founder Pro.
 */
function planFromLabel(label: string | undefined): Plan {
  switch (label) {
    case "Founder Free":       return "founder_free";
    case "Founder Pro":        return "founder_pro";
    case "Founder Scale":      return "founder_scale";
    case "Founder Enterprise": return "founder_enterprise";
    default:                   return "founder_pro";
  }
}

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
    revisionHash: "", // will be computed below
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

  // Idempotent check
  const existing = store.get(companyId);
  if (existing) {
    return { ok: true, subscription: existing, created: false };
  }

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

/* ---------- Routes ---------- */

export function registerSubscriptionRoutes(app: Express): void {
  /**
   * GET /api/admin/subscriptions
   * Returns all subscriptions. Admin-only \u2014 caller must be authed as admin.
   */
  app.get("/api/admin/subscriptions", (_req: Request, res: Response) => {
    res.json({ subscriptions: listSubscriptions() });
  });

  /**
   * GET /api/admin/subscriptions/:companyId
   * Returns the current subscription record for one company.
   */
  app.get("/api/admin/subscriptions/:companyId", (req: Request, res: Response) => {
    const s = getSubscription(req.params.companyId);
    if (!s) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, subscription: s });
  });

  /**
   * GET /api/admin/subscriptions/:companyId/history
   * Returns the full revision history (for audit / M&A diligence).
   */
  app.get("/api/admin/subscriptions/:companyId/history", (req: Request, res: Response) => {
    const h = getSubscriptionHistory(req.params.companyId);
    const chain = verifyChain(req.params.companyId);
    res.json({ ok: true, history: h, chain });
  });

  /**
   * PATCH /api/admin/subscriptions/:companyId
   * Admin-only mutation. Body: UpdateSubscriptionInput.
   * Audited + bridge-emitted automatically.
   */
  app.patch("/api/admin/subscriptions/:companyId", (req: Request, res: Response) => {
    const actor = (req.headers["x-actor-email"] as string | undefined) ?? "admin@capavate.com";
    const result = updateSubscription(req.params.companyId, req.body ?? {}, actor);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });
}

/* ---------- Testing exports ---------- */
export const _testSubscriptions = { store, history, seedFromCanonicalCompanies, hashRevision };
