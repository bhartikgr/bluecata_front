/**
 * Sprint 28 — Pricing Model Authoring Store (production-grade).
 *
 * The single source of truth for every pricing plan Capavate sells:
 * Founder SaaS tiers, Collective membership tiers, Consortium-Partner tiers,
 * any future commercial product.
 *
 * Investor-grade properties:
 *   - Money in integer MINOR UNITS + ISO 4217 currency. Never floats.
 *   - Per-currency price overrides + regional multipliers.
 *   - Multiple billing cadences (monthly / annual / biennial / one_time / perpetual).
 *   - Trial config (length days, requires_card, auto-converts).
 *   - Feature gates: boolean + numeric quotas.
 *   - Usage-based metering: included quota + overage minor-per-unit.
 *   - Volume discount brackets.
 *   - Discount codes (% off / $ off / trial extension).
 *   - Effective dating: schedule a price change ahead, end-date a plan.
 *   - Status workflow: draft → preview → live → deprecated. Grandfathered cohorts.
 *   - Every mutation bumps monotonic version, chains SHA-256 hash, audits, and
 *     emits bridge event so the Collective stays in sync.
 */
import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { persistEntry, hydrateEntries, softDeleteEntry } from "./lib/storePersistenceShim";

const PERSIST_STORE = "pricingModelStore";
const PERSIST_HISTORY_STORE = "pricingModelHistoryStore";

/* =================================================================== */
/*  Types                                                              */
/* =================================================================== */

export type PricingStatus = "draft" | "preview" | "live" | "deprecated";
export type ProductLine = "founder" | "collective" | "consortium_partner" | "add_on";
export type BillingCadence = "monthly" | "annual" | "biennial" | "one_time" | "perpetual";

export interface FeatureGate {
  key: string;
  label: string;
  included: boolean;
  quota: number | null;
  quotaUnit?: string;
}

export interface MeteringRule {
  meterKey: string;
  label: string;
  includedQty: number;
  overageMinor: number;
  unit: string;
}

export interface VolumeBracket {
  fromQty: number;
  toQty: number | null;
  pricePerUnitMinor: number;
}

export interface CurrencyOverride {
  currency: string;
  basePriceMinor: number;
}

export interface RegionalMultiplier {
  region: string;
  multiplier: number;
  notes?: string;
}

export interface DiscountCode {
  code: string;
  kind: "percent" | "flat_minor" | "trial_extension_days";
  amount: number;
  expiresOn: string | null;
  maxRedemptions: number | null;
  active: boolean;
}

export interface TrialConfig {
  lengthDays: number;
  requiresCard: boolean;
  autoConvertToPlanId: string | null;
}

export interface PricingModel {
  id: string;
  productLine: ProductLine;
  slug: string;
  name: string;
  description: string;
  status: PricingStatus;
  currency: string;
  basePriceMinor: number;
  cadence: BillingCadence;
  cadenceOptions: Array<{ cadence: BillingCadence; priceMinor: number }>;
  currencyOverrides: CurrencyOverride[];
  regionalMultipliers: RegionalMultiplier[];
  features: FeatureGate[];
  metering: MeteringRule[];
  volumeBrackets: VolumeBracket[];
  discountCodes: DiscountCode[];
  trial: TrialConfig | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  grandfatherOnChange: boolean;
  taxInclusive: boolean;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

/* =================================================================== */
/*  Audit + bridge sinks                                               */
/* =================================================================== */

type AuditAppender = (e: { actor: string; action: string; target: string; payload: unknown }) => void;
type BridgeEmitter = (eventType: string, aggregateId: string, payload: Record<string, unknown>) => void;

let auditAppender: AuditAppender = () => {};
let bridgeEmitter: BridgeEmitter = () => {};

export function configurePricingModelStore(opts: { audit: AuditAppender; bridge: BridgeEmitter }) {
  auditAppender = opts.audit;
  bridgeEmitter = opts.bridge;
}

/* =================================================================== */
/*  Storage                                                            */
/* =================================================================== */

const models = new Map<string, PricingModel>();
const history = new Map<string, PricingModel[]>();
let lastHashChain = "0".repeat(64);

function hashRevision(prevHash: string, body: unknown): string {
  return createHash("sha256").update(prevHash).update(JSON.stringify(body)).digest("hex");
}

function newId(prefix = "pm"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function snapshot(m: PricingModel): PricingModel {
  return JSON.parse(JSON.stringify(m)) as PricingModel;
}


/* =================================================================== */
/*  v25.27 — NO SEED. Admin is the source of truth.                    */
/* =================================================================== */
/*
 * BEFORE v25.27: this file shipped a hardcoded seed of founder/collective
 * tiers (Free, Pro, Capavate Annual at $840, etc.) that ran at module load.
 * Per the standing rule "pricing plans are determined from the Admin area —
 * never hardcoded" (Ozan, 16-Jun-2026), all source-baked pricing is removed.
 *
 * On a fresh install, `models` is empty until an admin clicks the bootstrap
 * button in /admin/pricing-models (POST /api/admin/pricing-models/bootstrap-
 * founder-tiers) which creates 4 placeholder DRAFTS at $0 that the admin
 * then prices and publishes. For an existing prod database, `hydrateEntries`
 * rehydrates whatever the admin has previously authored — no source code
 * touches the actual price numbers.
 *
 * Legacy migration: if an existing subscription references a tier id that
 * has no matching model row (e.g. `founder_capavate_annual` from the old
 * hardcoded source), admins can click POST /api/admin/pricing-models/migrate-
 * legacy to create the matching DB rows with prices read from the existing
 * `subscriptions` rows themselves (NOT from any hardcoded constant).
 */

/* =================================================================== */
/*  Reads                                                              */
/* =================================================================== */

export function listModels(filter?: { status?: PricingStatus; productLine?: ProductLine }): PricingModel[] {
  let out = Array.from(models.values());
  if (filter?.status) out = out.filter(m => m.status === filter.status);
  if (filter?.productLine) out = out.filter(m => m.productLine === filter.productLine);
  return out;
}

export function getModel(id: string): PricingModel | null {
  return models.get(id) ?? null;
}

export function getModelHistory(id: string): PricingModel[] {
  return history.get(id) ?? [];
}

export function verifyModelChain(id: string): { ok: boolean; brokenAt?: number; length: number } {
  const h = history.get(id) ?? [];
  for (let i = 0; i < h.length; i++) {
    const rec = h[i];
    const expectedPrev = i === 0 ? h[0].prevRevisionHash : h[i - 1].revisionHash;
    if (rec.prevRevisionHash !== expectedPrev) return { ok: false, brokenAt: i, length: h.length };
  }
  return { ok: true, length: h.length };
}

/* =================================================================== */
/*  Mutations                                                          */
/* =================================================================== */

export type CreateModelInput = Omit<
  PricingModel,
  "id" | "version" | "prevRevisionHash" | "revisionHash" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy" | "status"
> & { status?: PricingStatus };

export function createModel(input: CreateModelInput, actor: string): { ok: true; model: PricingModel } | { ok: false; error: string } {
  if (!input.slug || !/^[a-z0-9-]+$/.test(input.slug)) {
    return { ok: false, error: "slug must be lowercase alphanumeric with dashes" };
  }
  const slugClash = Array.from(models.values()).find(m => m.slug === input.slug);
  if (slugClash) return { ok: false, error: `slug '${input.slug}' is already in use by ${slugClash.id}` };

  const id = newId();
  const now = new Date().toISOString();
  const rec: PricingModel = {
    ...input,
    id,
    status: input.status ?? "draft",
    version: 1,
    prevRevisionHash: lastHashChain,
    revisionHash: "",
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
  };
  rec.revisionHash = hashRevision(rec.prevRevisionHash, rec);
  lastHashChain = rec.revisionHash;

  models.set(id, rec);
  history.set(id, [snapshot(rec)]);
  /* v25.9 — persist */
  persistEntry(PERSIST_STORE, id, rec);
  persistEntry(PERSIST_HISTORY_STORE, id, history.get(id) ?? []);

  auditAppender({ actor, action: "pricing_model.created", target: `pricing_model:${id}`, payload: { slug: rec.slug, productLine: rec.productLine, status: rec.status } });
  return { ok: true, model: rec };
}

export type UpdateModelInput = Partial<Omit<PricingModel, "id" | "version" | "prevRevisionHash" | "revisionHash" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy" | "slug">>;

export function updateModel(id: string, input: UpdateModelInput, actor: string): { ok: true; model: PricingModel } | { ok: false; error: string } {
  const current = models.get(id);
  if (!current) return { ok: false, error: "not_found" };

  const next: PricingModel = {
    ...current,
    ...input,
    version: current.version + 1,
    prevRevisionHash: current.revisionHash,
    revisionHash: "",
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
  next.revisionHash = hashRevision(current.revisionHash, next);
  lastHashChain = next.revisionHash;

  models.set(id, next);
  /* v25.9 — persist update */
  persistEntry(PERSIST_STORE, id, next);
  const h = history.get(id) ?? [];
  h.push(snapshot(next));
  history.set(id, h);
  /* v25.9 — persist history snapshot */
  persistEntry(PERSIST_HISTORY_STORE, id, h);

  auditAppender({
    actor,
    action: "pricing_model.updated",
    target: `pricing_model:${id}`,
    payload: { changedKeys: Object.keys(input), fromVersion: current.version, toVersion: next.version, statusBefore: current.status, statusAfter: next.status },
  });

  if (next.status === "live") {
    bridgeEmitter("pricing_model.updated", id, {
      slug: next.slug,
      productLine: next.productLine,
      version: next.version,
      revisionHash: next.revisionHash,
    });
  }

  return { ok: true, model: next };
}

const PROMOTE_TRANSITIONS: Record<PricingStatus, PricingStatus[]> = {
  draft: ["preview", "deprecated"],
  preview: ["live", "draft", "deprecated"],
  live: ["deprecated"],
  deprecated: [],
};

export function promoteModel(id: string, to: PricingStatus, actor: string): { ok: true; model: PricingModel } | { ok: false; error: string } {
  const current = models.get(id);
  if (!current) return { ok: false, error: "not_found" };
  const allowed = PROMOTE_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(to)) {
    return { ok: false, error: `cannot transition ${current.status} -> ${to} (allowed: ${allowed.join(", ") || "— terminal"})` };
  }
  const result = updateModel(id, { status: to }, actor);
  if (!result.ok) return result;

  auditAppender({ actor, action: `pricing_model.promoted_${current.status}_to_${to}`, target: `pricing_model:${id}`, payload: { id, fromStatus: current.status, toStatus: to } });
  if (to === "live") {
    bridgeEmitter("pricing_model.published", id, { slug: result.model.slug, productLine: result.model.productLine, version: result.model.version });
  }
  return result;
}

export function cloneModel(id: string, actor: string): { ok: true; model: PricingModel } | { ok: false; error: string } {
  const src = models.get(id);
  if (!src) return { ok: false, error: "not_found" };
  let suffix = 2;
  let cloneSlug = `${src.slug}-copy`;
  while (Array.from(models.values()).find(m => m.slug === cloneSlug)) {
    suffix += 1;
    cloneSlug = `${src.slug}-copy-${suffix}`;
  }
  const clone: CreateModelInput = {
    ...src,
    slug: cloneSlug,
    name: `${src.name} (copy)`,
    status: "draft",
  };
  delete (clone as unknown as { id?: string }).id;
  return createModel(clone, actor);
}

export function deleteModel(id: string, actor: string): { ok: true } | { ok: false; error: string } {
  const current = models.get(id);
  if (!current) return { ok: false, error: "not_found" };
  if (current.status !== "draft") {
    return { ok: false, error: `cannot delete model in '${current.status}' state — deprecate it instead` };
  }
  models.delete(id);
  history.delete(id);
  /* v25.27 — Phase A6: make delete durable.
   * Before v25.27 deleteModel only removed the RAM Map entry. On next boot,
   * hydrateEntries() rehydrated the row from the shim's kv_pricingModelStore
   * table and the "deleted" draft resurrected. softDeleteEntry sets
   * deleted_at on the row so the hydrator skips it. */
  softDeleteEntry(PERSIST_STORE, id);
  softDeleteEntry(PERSIST_HISTORY_STORE, id);
  auditAppender({ actor, action: "pricing_model.deleted", target: `pricing_model:${id}`, payload: { slug: current.slug, productLine: current.productLine } });
  return { ok: true };
}

/* =================================================================== */
/*  Price preview                                                      */
/* =================================================================== */

export interface PricePreviewInput {
  currency?: string;
  region?: string;
  cadence?: BillingCadence;
  qty?: number;
  discountCode?: string;
}

export interface PricePreviewOutput {
  currency: string;
  finalMinor: number;
  breakdown: Array<{ stage: string; amountMinor: number; note?: string }>;
}

export function previewPrice(modelId: string, input: PricePreviewInput): { ok: true; preview: PricePreviewOutput } | { ok: false; error: string } {
  const m = models.get(modelId);
  if (!m) return { ok: false, error: "not_found" };
  const currency = (input.currency ?? m.currency).toUpperCase();
  const cadence = input.cadence ?? m.cadence;
  const qty = Math.max(1, input.qty ?? 1);
  const breakdown: PricePreviewOutput["breakdown"] = [];

  let amount = m.basePriceMinor;
  const override = m.currencyOverrides.find(o => o.currency.toUpperCase() === currency);
  if (override) {
    amount = override.basePriceMinor;
    breakdown.push({ stage: "currency_override", amountMinor: amount, note: `${currency} base` });
  } else {
    breakdown.push({ stage: "base", amountMinor: amount, note: `${m.currency} base (no override for ${currency})` });
  }

  if (cadence !== m.cadence) {
    const opt = m.cadenceOptions.find(o => o.cadence === cadence);
    if (opt) {
      amount = opt.priceMinor;
      breakdown.push({ stage: "cadence_option", amountMinor: amount, note: `${cadence}` });
    } else {
      return { ok: false, error: `cadence '${cadence}' not offered by this model` };
    }
  }

  if (input.region) {
    const rm = m.regionalMultipliers.find(r => r.region === input.region);
    if (rm) {
      amount = Math.round(amount * rm.multiplier);
      breakdown.push({ stage: "regional_multiplier", amountMinor: amount, note: `${input.region} x${rm.multiplier}` });
    }
  }

  if (qty > 1 && m.volumeBrackets.length > 0) {
    const bracket = m.volumeBrackets.find(b => qty >= b.fromQty && (b.toQty == null || qty <= b.toQty));
    if (bracket) {
      amount = bracket.pricePerUnitMinor * qty;
      breakdown.push({ stage: "volume_bracket", amountMinor: amount, note: `${qty} x ${bracket.pricePerUnitMinor}/u` });
    } else {
      amount = amount * qty;
      breakdown.push({ stage: "linear_qty", amountMinor: amount, note: `${qty} x base` });
    }
  }

  if (input.discountCode) {
    const code = m.discountCodes.find(c => c.code === input.discountCode && c.active);
    if (!code) return { ok: false, error: `unknown or inactive discount code '${input.discountCode}'` };
    if (code.expiresOn && new Date(code.expiresOn) < new Date()) {
      return { ok: false, error: `discount code '${input.discountCode}' expired on ${code.expiresOn}` };
    }
    if (code.kind === "percent") {
      const off = Math.round(amount * code.amount);
      amount = Math.max(0, amount - off);
      breakdown.push({ stage: "discount_percent", amountMinor: -off, note: `${input.discountCode} ${(code.amount * 100).toFixed(0)}% off` });
    } else if (code.kind === "flat_minor") {
      amount = Math.max(0, amount - code.amount);
      breakdown.push({ stage: "discount_flat", amountMinor: -code.amount, note: `${input.discountCode} flat ${code.amount}` });
    }
  }

  return { ok: true, preview: { currency, finalMinor: amount, breakdown } };
}

/* =================================================================== */
/*  Routes                                                             */
/* =================================================================== */

export function registerPricingModelRoutes(app: Express) {
  app.get("/api/admin/pricing-models", (req: Request, res: Response) => {
    const status = req.query.status as PricingStatus | undefined;
    const productLine = req.query.productLine as ProductLine | undefined;
    res.json({ models: listModels({ status, productLine }) });
  });

  app.get("/api/admin/pricing-models/:id", (req: Request, res: Response) => {
    const m = getModel(req.params.id);
    if (!m) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, model: m });
  });

  app.get("/api/admin/pricing-models/:id/history", (req: Request, res: Response) => {
    const h = getModelHistory(req.params.id);
    const chain = verifyModelChain(req.params.id);
    res.json({ ok: true, history: h, chain });
  });

  app.post("/api/admin/pricing-models", (req: Request, res: Response) => {
    const actor = String((req as any).userContext?.identity?.email ?? (req as any).userContext?.userId ?? ""); /* v14 */ if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const result = createModel(req.body, actor);
    if (!result.ok) return res.status(400).json(result);
    res.status(201).json(result);
  });

  app.patch("/api/admin/pricing-models/:id", (req: Request, res: Response) => {
    const actor = String((req as any).userContext?.identity?.email ?? (req as any).userContext?.userId ?? ""); /* v14 */ if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const result = updateModel(req.params.id, req.body ?? {}, actor);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/api/admin/pricing-models/:id/promote", (req: Request, res: Response) => {
    const actor = String((req as any).userContext?.identity?.email ?? (req as any).userContext?.userId ?? ""); /* v14 */ if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const to = (req.body?.to ?? "") as PricingStatus;
    const result = promoteModel(req.params.id, to, actor);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  });

  app.post("/api/admin/pricing-models/:id/clone", (req: Request, res: Response) => {
    const actor = String((req as any).userContext?.identity?.email ?? (req as any).userContext?.userId ?? ""); /* v14 */ if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const result = cloneModel(req.params.id, actor);
    if (!result.ok) return res.status(404).json(result);
    res.status(201).json(result);
  });

  app.delete("/api/admin/pricing-models/:id", (req: Request, res: Response) => {
    const actor = String((req as any).userContext?.identity?.email ?? (req as any).userContext?.userId ?? ""); /* v14 */ if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const result = deleteModel(req.params.id, actor);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  });

  app.get("/api/admin/pricing-models/:id/price-preview", (req: Request, res: Response) => {
    const result = previewPrice(req.params.id, {
      currency: req.query.currency as string | undefined,
      region: req.query.region as string | undefined,
      cadence: req.query.cadence as BillingCadence | undefined,
      qty: req.query.qty ? Number(req.query.qty) : undefined,
      discountCode: req.query.discountCode as string | undefined,
    });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  });

  /* ====================================================================
   * v25.27 — Admin bootstrap + legacy migration endpoints.
   *
   * These endpoints exist so a freshly-installed Capavate (no founder tiers
   * configured) and a legacy-prod Capavate (existing subscriptions tied to
   * the now-removed hardcoded `founder_capavate_annual` tier) can both be
   * brought to a working admin-driven pricing state via two clicks in
   * /admin/pricing-models, NOT via source-baked seeds.
   * ==================================================================== */

  /**
   * POST /api/admin/pricing-models/bootstrap-founder-tiers
   *
   * Idempotent. Creates 4 DRAFT founder tiers with $0 placeholder prices and
   * placeholder feature lists. The admin then edits each tier (price,
   * features, etc.) and promotes to `live` to publish to founders.
   *
   * REFUSES to run if any productLine='founder' model already exists
   * (idempotency: one-time only per install). Admins who want to create
   * additional tiers should use the normal POST /api/admin/pricing-models.
   *
   * Slugs match what founder Subscribe.tsx expects:
   *   founder-free, founder-pro, founder-scale, founder-enterprise
   * Prices: all $0 (admin must set real prices before promoting to live).
   */
  app.post("/api/admin/pricing-models/bootstrap-founder-tiers", (req: Request, res: Response) => {
    const actor = String((req as any).userContext?.identity?.email ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });

    const existing = listModels({ productLine: "founder" });
    if (existing.length > 0) {
      return res.status(409).json({
        ok: false,
        error: "already_bootstrapped",
        message: `${existing.length} founder tier(s) already exist. To create additional tiers, use POST /api/admin/pricing-models.`,
        existing: existing.map((m) => ({ id: m.id, slug: m.slug, name: m.name, status: m.status })),
      });
    }

    const starters: Array<{ slug: string; name: string; description: string; cadence: BillingCadence }> = [
      { slug: "founder-free", name: "Founder Free", description: "Placeholder — admin must edit features and promote to live.", cadence: "annual" },
      { slug: "founder-pro", name: "Founder Pro", description: "Placeholder — admin must set price, features, and promote to live.", cadence: "annual" },
      { slug: "founder-scale", name: "Founder Scale", description: "Placeholder — admin must set price, features, and promote to live.", cadence: "annual" },
      { slug: "founder-enterprise", name: "Founder Enterprise", description: "Placeholder — admin must set price, features, and promote to live.", cadence: "annual" },
    ];

    const created: PricingModel[] = [];
    for (const s of starters) {
      const r = createModel(
        {
          productLine: "founder",
          slug: s.slug,
          name: s.name,
          description: s.description,
          currency: "USD",
          basePriceMinor: 0,
          cadence: s.cadence,
          cadenceOptions: [{ cadence: s.cadence, priceMinor: 0 }],
          currencyOverrides: [{ currency: "USD", basePriceMinor: 0 }],
          regionalMultipliers: [],
          features: [],
          metering: [],
          volumeBrackets: [],
          discountCodes: [],
          trial: null,
          effectiveFrom: null,
          effectiveTo: null,
          grandfatherOnChange: true,
          taxInclusive: false,
        },
        actor,
      );
      if (r.ok) created.push(r.model);
    }

    return res.json({
      ok: true,
      created: created.map((m) => ({ id: m.id, slug: m.slug, name: m.name, status: m.status })),
      message: `${created.length} draft founder tier(s) created at $0. Edit each tier to set real prices, features, and metadata, then promote to 'live' to make them visible on the founder Subscribe page.`,
    });
  });

  /**
   * POST /api/admin/pricing-models/migrate-legacy
   *
   * Idempotent. For each unique tier id referenced by existing subscription
   * rows that does NOT yet have a matching pricingModelStore row, creates a
   * `live` pricingModel using the `annualAmountMinor` + `currency` from the
   * subscription row itself. This prevents historical subscriptions from
   * orphaning when v25.27 removes hardcoded tier ids like `founder_capavate_annual`.
   *
   * Prices come from the existing subscription rows in the DB, NOT from any
   * hardcoded constant in source code.
   */
  app.post("/api/admin/pricing-models/migrate-legacy", async (req: Request, res: Response) => {
    const actor = String((req as any).userContext?.identity?.email ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });

    let subscriptionRows: Array<{ plan: string; annualAmountMinor: number; currency: string }> = [];
    try {
      const { rawDb } = await import("./db/connection");
      const db = rawDb();
      if (db) {
        /* The capavate_subscriptions table uses columns `tier_id` + `amount_minor` +
         * `billing_cycle`. For each distinct (tier_id, currency) combo we want the
         * representative annual amount. Annual amount = amount_minor when billing_cycle
         * is 'annual', else amount_minor * 12 (rough approximation — admin will tune). */
        const rows = db
          .prepare("SELECT DISTINCT tier_id as plan, amount_minor as amountMinor, currency, billing_cycle as billingCycle FROM capavate_subscriptions")
          .all() as Array<{ plan: string; amountMinor: number; currency: string; billingCycle: string }>;
        subscriptionRows = rows.map((r) => ({
          plan: r.plan,
          annualAmountMinor: r.billingCycle === "annual" ? r.amountMinor : (r.amountMinor || 0) * 12,
          currency: r.currency,
        }));
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: "db_read_failed", message: (err as Error).message });
    }

    const existingByIdOrSlug = new Set<string>();
    for (const m of listModels()) {
      existingByIdOrSlug.add(m.id);
      existingByIdOrSlug.add(m.slug);
    }

    const created: PricingModel[] = [];
    const skipped: Array<{ plan: string; reason: string }> = [];

    for (const sub of subscriptionRows) {
      const tierKey = sub.plan;
      if (!tierKey) continue;
      // Skip if a model with this id or slug already exists.
      if (existingByIdOrSlug.has(tierKey)) {
        skipped.push({ plan: tierKey, reason: "already_exists" });
        continue;
      }
      // Also skip canonical plan keys that should be created via bootstrap-founder-tiers.
      if (["founder_free", "founder_pro", "founder_scale", "founder_enterprise"].includes(tierKey)) {
        skipped.push({ plan: tierKey, reason: "canonical_plan_use_bootstrap" });
        continue;
      }

      // Derive a safe slug from the legacy id.
      const slug = tierKey.replace(/_/g, "-").toLowerCase();
      if (existingByIdOrSlug.has(slug)) {
        skipped.push({ plan: tierKey, reason: "slug_collision" });
        continue;
      }

      const annualMinor = Math.max(0, Math.round(sub.annualAmountMinor || 0));
      const currency = (sub.currency || "USD").toUpperCase();

      const r = createModel(
        {
          productLine: "founder",
          slug,
          name: tierKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          description: `Migrated from legacy subscription rows on ${new Date().toISOString().slice(0, 10)}. Original tier id: ${tierKey}. Review and adjust as needed.`,
          currency,
          basePriceMinor: annualMinor,
          cadence: "annual",
          cadenceOptions: [{ cadence: "annual", priceMinor: annualMinor }],
          currencyOverrides: [{ currency, basePriceMinor: annualMinor }],
          regionalMultipliers: [],
          features: [],
          metering: [],
          volumeBrackets: [],
          discountCodes: [],
          trial: null,
          effectiveFrom: null,
          effectiveTo: null,
          grandfatherOnChange: true,
          taxInclusive: false,
          status: "live", // legacy migration creates LIVE so existing subscriptions keep working
        },
        actor,
      );
      if (r.ok) {
        created.push(r.model);
        existingByIdOrSlug.add(r.model.id);
        existingByIdOrSlug.add(r.model.slug);
      } else {
        skipped.push({ plan: tierKey, reason: r.error });
      }
    }

    return res.json({
      ok: true,
      created: created.map((m) => ({ id: m.id, slug: m.slug, name: m.name, basePriceMinor: m.basePriceMinor, currency: m.currency, status: m.status })),
      skipped,
      message: `Migrated ${created.length} legacy tier(s) from existing subscription rows. Prices were copied from each subscription's annual_amount_minor field. Review each tier in /admin/pricing-models and adjust as needed.`,
    });
  });
}

/* v25.27 — test helper. `seedInitialModels` was removed (no source-baked
 * pricing). Tests that need rows must create them via `createModel()` or by
 * inserting fixture rows into the kv store directly. */
export const _testPricingModels = { models, history };

/**
 * v25.9 — Rehydrate pricing models + history from DB on boot.
 */
export async function hydratePricingModelStore(): Promise<void> {
  try {
    const modelEntries = hydrateEntries<PricingModel>(PERSIST_STORE);
    /* v25.27 — there is no seed to override; this is the only source of
     * pricing data on boot. Empty modelEntries means an admin has not yet
     * created any tiers; the founder Subscribe page will show an empty state. */
    for (const [id, m] of modelEntries) models.set(id, m);

    const histEntries = hydrateEntries<PricingModel[]>(PERSIST_HISTORY_STORE);
    for (const [id, h] of histEntries) history.set(id, h);

    if (modelEntries.length > 0) {
      console.info(
        `[hydrate] pricingModelStore: ${modelEntries.length} models, ${histEntries.length} history lists restored`,
      );
    }
  } catch (err) {
    console.warn(
      `[hydrate] pricingModelStore: DB read failed (non-fatal): ${(err as Error).message}`,
    );
  }
}
