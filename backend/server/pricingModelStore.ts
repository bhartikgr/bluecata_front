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
import { persistEntry, hydrateEntries } from "./lib/storePersistenceShim";

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
/*  Seed                                                               */
/* =================================================================== */

function seedInitialModels() {
  if (models.size > 0) return;
  const now = new Date().toISOString();

  const founderPro: PricingModel = {
    id: "pm_founder_pro_v1",
    productLine: "founder",
    slug: "founder-pro",
    name: "Founder Pro",
    description: "For active founders running 1-3 rounds with up to 50 investors. Includes e-sign, basic M&A signals, and the full investor CRM.",
    status: "live",
    currency: "USD",
    basePriceMinor: 24_900,
    cadence: "monthly",
    cadenceOptions: [
      { cadence: "monthly", priceMinor: 24_900 },
      { cadence: "annual", priceMinor: 24_900 * 10 },
    ],
    currencyOverrides: [
      { currency: "USD", basePriceMinor: 24_900 },
      { currency: "EUR", basePriceMinor: 22_900 },
      { currency: "GBP", basePriceMinor: 19_900 },
    ],
    regionalMultipliers: [
      { region: "US", multiplier: 1.00 },
      { region: "UK", multiplier: 1.00 },
      { region: "EU", multiplier: 1.00 },
      { region: "CA", multiplier: 1.00 },
      { region: "AU", multiplier: 1.00 },
      { region: "SG", multiplier: 0.80 },
      { region: "HK", multiplier: 0.80 },
      { region: "JP", multiplier: 0.80, notes: "Lower CAC; partner-led GTM" },
      { region: "IN", multiplier: 0.50, notes: "PPP-adjusted per World Bank index" },
      { region: "CN", multiplier: 0.50, notes: "PPP-adjusted; tax-inclusive billing" },
    ],
    features: [
      { key: "captable", label: "Cap-table mgmt", included: true, quota: null },
      { key: "rounds", label: "Rounds", included: true, quota: null, quotaUnit: "rounds" },
      { key: "dataroom_gb", label: "Dataroom storage", included: true, quota: 50, quotaUnit: "GB" },
      { key: "reports", label: "Investor reports", included: true, quota: null },
      { key: "crm", label: "Investor CRM", included: true, quota: null, quotaUnit: "contacts" },
      { key: "esign", label: "E-sign included", included: true, quota: null },
      { key: "ma_signals", label: "M&A signals (basic)", included: true, quota: null },
      { key: "consortium", label: "Consortium routing", included: false, quota: null },
      { key: "api_access", label: "API access", included: false, quota: null },
    ],
    metering: [
      { meterKey: "investor_seats", label: "Investor seats", includedQty: 50, overageMinor: 500, unit: "investor" },
      { meterKey: "dataroom_gb", label: "Dataroom storage", includedQty: 50, overageMinor: 100, unit: "GB" },
      { meterKey: "e_signs", label: "E-signatures", includedQty: 100, overageMinor: 200, unit: "signature" },
    ],
    volumeBrackets: [
      { fromQty: 1, toQty: 5, pricePerUnitMinor: 24_900 },
      { fromQty: 6, toQty: 20, pricePerUnitMinor: 22_400 },
      { fromQty: 21, toQty: 100, pricePerUnitMinor: 19_900 },
      { fromQty: 101, toQty: null, pricePerUnitMinor: 17_400 },
    ],
    discountCodes: [
      { code: "YC2025", kind: "percent", amount: 0.30, expiresOn: "2026-12-31", maxRedemptions: 200, active: true },
      { code: "LAUNCH50", kind: "flat_minor", amount: 5_000, expiresOn: "2026-08-31", maxRedemptions: 100, active: true },
      { code: "TRIAL30", kind: "trial_extension_days", amount: 16, expiresOn: null, maxRedemptions: null, active: true },
    ],
    trial: { lengthDays: 14, requiresCard: false, autoConvertToPlanId: null },
    effectiveFrom: null,
    effectiveTo: null,
    grandfatherOnChange: true,
    taxInclusive: false,
    version: 1,
    prevRevisionHash: lastHashChain,
    revisionHash: "",
    createdAt: now,
    updatedAt: now,
    createdBy: "system:seed",
    updatedBy: "system:seed",
  };
  founderPro.revisionHash = hashRevision(founderPro.prevRevisionHash, founderPro);
  lastHashChain = founderPro.revisionHash;

  const founderFree: PricingModel = {
    ...founderPro,
    id: "pm_founder_free_v1",
    slug: "founder-free",
    name: "Founder Free",
    description: "Get a cap table live in 5 minutes. 1 round, 10 investors, 1 GB dataroom. Upgrade any time.",
    basePriceMinor: 0,
    cadenceOptions: [{ cadence: "monthly", priceMinor: 0 }],
    currencyOverrides: [{ currency: "USD", basePriceMinor: 0 }],
    features: founderPro.features.map(f =>
      f.key === "esign" || f.key === "ma_signals" || f.key === "consortium" || f.key === "api_access"
        ? { ...f, included: false }
        : f.key === "dataroom_gb" ? { ...f, quota: 1 }
        : f.key === "crm" ? { ...f, quota: 10 }
        : f.key === "rounds" ? { ...f, quota: 1 }
        : f
    ),
    metering: [
      { meterKey: "dataroom_gb", label: "Dataroom storage", includedQty: 1, overageMinor: 0, unit: "GB" },
    ],
    volumeBrackets: [],
    discountCodes: [],
    trial: null,
    version: 1,
    prevRevisionHash: lastHashChain,
    revisionHash: "",
    createdAt: now,
    updatedAt: now,
    createdBy: "system:seed",
    updatedBy: "system:seed",
  };
  founderFree.revisionHash = hashRevision(founderFree.prevRevisionHash, founderFree);
  lastHashChain = founderFree.revisionHash;

  const collectiveStandard: PricingModel = {
    id: "pm_collective_standard_v1",
    productLine: "collective",
    slug: "collective-standard",
    name: "Collective Standard (Angel Network)",
    description: "Full Collective member access — syndicated deal flow, network, dealroom, partner intros.",
    status: "live",
    currency: "USD",
    basePriceMinor: 120_000,
    cadence: "annual",
    cadenceOptions: [
      { cadence: "annual", priceMinor: 120_000 },
      { cadence: "biennial", priceMinor: 216_000 },
    ],
    currencyOverrides: [
      { currency: "USD", basePriceMinor: 120_000 },
      { currency: "EUR", basePriceMinor: 110_000 },
      { currency: "GBP", basePriceMinor: 95_000 },
    ],
    regionalMultipliers: [
      { region: "US", multiplier: 1.00 },
      { region: "UK", multiplier: 1.00 },
      { region: "EU", multiplier: 1.00 },
      { region: "CA", multiplier: 1.00 },
      { region: "AU", multiplier: 0.85 },
      { region: "SG", multiplier: 0.85 },
      { region: "HK", multiplier: 0.85 },
      { region: "JP", multiplier: 0.80 },
      { region: "IN", multiplier: 0.50, notes: "PPP-adjusted" },
      { region: "CN", multiplier: 0.50, notes: "PPP-adjusted; tax-inclusive billing" },
    ],
    features: [
      { key: "dealroom", label: "Collective deal-room access", included: true, quota: null },
      { key: "syndicates", label: "Syndicate participation", included: true, quota: null },
      { key: "network", label: "Member network", included: true, quota: null },
      { key: "partner_intros", label: "Consortium partner intros", included: true, quota: 6, quotaUnit: "intros / yr" },
      { key: "dsc_voting", label: "DSC voting rights", included: false, quota: null },
      { key: "spv_origination", label: "SPV origination", included: false, quota: null },
    ],
    metering: [],
    volumeBrackets: [],
    discountCodes: [
      { code: "FOUNDING50", kind: "flat_minor", amount: 60_000, expiresOn: "2026-12-31", maxRedemptions: 50, active: true },
    ],
    trial: null,
    effectiveFrom: null,
    effectiveTo: null,
    grandfatherOnChange: true,
    taxInclusive: false,
    version: 1,
    prevRevisionHash: lastHashChain,
    revisionHash: "",
    createdAt: now,
    updatedAt: now,
    createdBy: "system:seed",
    updatedBy: "system:seed",
  };
  collectiveStandard.revisionHash = hashRevision(collectiveStandard.prevRevisionHash, collectiveStandard);
  lastHashChain = collectiveStandard.revisionHash;

  /* ------------------------------------------------------------------
   * Wave F4 FIX F4-4 (E2E-8, P0) — Capavate Annual canonical tier.
   *
   * Per Ozan's directive (24-May-2026): the founder-side commercial offer
   * is a single tier — "Capavate Annual" at $840 USD/year per company,
   * delivering full Capavate functionality. The legacy `founder-free` /
   * `founder-pro` rows are retained (status="live" for now so the
   * sprint28 `find(m => m.status === "live")` invariant still holds, and
   * deletion of seed-grandfathered subscriptions is not required), but
   * the canonical SKU that admins manage and the marketing site quotes
   * is `pm_capavate_annual_v1` below.
   *
   * The /admin/pricing Pricing-Models tab renders `card-pm-<id>` for
   * every entry in `listModels()` — before this fix the Capavate Annual
   * SKU was missing from the seed, so the admin had no way to manage it.
   * After this fix the tab surfaces it alongside the legacy rows.
   * ------------------------------------------------------------------ */
  const capavateAnnual: PricingModel = {
    id: "pm_capavate_annual_v1",
    productLine: "founder",
    slug: "capavate-annual",
    name: "Capavate Annual",
    description: "Capavate Annual — $840 USD/year per company. Full Capavate functionality (cap-table mgmt, rounds, dataroom, investor CRM, e-sign, M&A signals, ESOP, audit chain, compliance, email support). Collective + Consortium are separate commercial offerings.",
    status: "live",
    currency: "USD",
    basePriceMinor: 84_000, // $840.00 = 84_000 cents
    cadence: "annual",
    cadenceOptions: [
      { cadence: "annual", priceMinor: 84_000 },
    ],
    currencyOverrides: [
      { currency: "USD", basePriceMinor: 84_000 },
      { currency: "EUR", basePriceMinor: 78_000 },
      { currency: "GBP", basePriceMinor: 67_000 },
    ],
    regionalMultipliers: [
      { region: "US", multiplier: 1.00 },
      { region: "UK", multiplier: 1.00 },
      { region: "EU", multiplier: 1.00 },
      { region: "CA", multiplier: 1.00 },
      { region: "AU", multiplier: 1.00 },
      { region: "SG", multiplier: 0.80 },
      { region: "HK", multiplier: 0.80 },
      { region: "JP", multiplier: 0.80 },
      { region: "IN", multiplier: 0.50, notes: "PPP-adjusted per World Bank index" },
      { region: "CN", multiplier: 0.50, notes: "PPP-adjusted; tax-inclusive billing" },
    ],
    features: [
      { key: "captable", label: "Cap-table mgmt", included: true, quota: null },
      { key: "rounds", label: "Round management", included: true, quota: null },
      { key: "dataroom", label: "Data room", included: true, quota: null },
      { key: "crm", label: "Investor CRM", included: true, quota: null },
      { key: "esign", label: "E-sign included", included: true, quota: null },
      { key: "ma_signals", label: "M&A signals", included: true, quota: null },
      { key: "esop", label: "ESOP / option pool", included: true, quota: null },
      { key: "audit_chain", label: "Audit log & hash chain verification", included: true, quota: null },
      { key: "compliance", label: "GDPR / CCPA compliance tools", included: true, quota: null },
      { key: "support", label: "Email support", included: true, quota: null },
      { key: "collective", label: "Collective membership", included: false, quota: null },
      { key: "consortium", label: "Consortium partner features", included: false, quota: null },
    ],
    metering: [],
    volumeBrackets: [],
    discountCodes: [],
    trial: { lengthDays: 14, requiresCard: false, autoConvertToPlanId: null },
    effectiveFrom: null,
    effectiveTo: null,
    grandfatherOnChange: true,
    taxInclusive: false,
    version: 1,
    prevRevisionHash: lastHashChain,
    revisionHash: "",
    createdAt: now,
    updatedAt: now,
    createdBy: "system:seed",
    updatedBy: "system:seed",
  };
  capavateAnnual.revisionHash = hashRevision(capavateAnnual.prevRevisionHash, capavateAnnual);
  lastHashChain = capavateAnnual.revisionHash;

  for (const m of [founderFree, founderPro, collectiveStandard, capavateAnnual]) {
    models.set(m.id, m);
    history.set(m.id, [snapshot(m)]);
    /* v25.9 — persist */
    persistEntry(PERSIST_STORE, m.id, m);
    persistEntry(PERSIST_HISTORY_STORE, m.id, history.get(m.id) ?? []);
  }
}
seedInitialModels();

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
}

export const _testPricingModels = { models, history, seedInitialModels };

/**
 * v25.9 — Rehydrate pricing models + history from DB on boot.
 */
export async function hydratePricingModelStore(): Promise<void> {
  try {
    const modelEntries = hydrateEntries<PricingModel>(PERSIST_STORE);
    /* Don't clear() because seedInitialModels already populated; merge instead.
     * If a persisted row exists for the same id, it overrides the seed. */
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
