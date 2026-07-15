/**
 * server/collectiveSubscriptionConfigStore.ts — WAVE 4.
 *
 * DB-backed, admin-authored Collective subscription-package catalog. Mirrors the
 * Capavate founder pricing authoring lifecycle (draft/preview/live/deprecated +
 * revision hash-chain + history) WITHOUT reusing the founder pricing table, and
 * WITHOUT touching any payment/Airwallex charge code (rule #14).
 *
 * The member front end reads live packages via GET /api/collective/membership/tiers
 * (admin-first, env/static fallback). Checkout resolves a package -> its existing
 * Airwallex tier + synthetic price ref, then calls the UNCHANGED createCollectiveIntent.
 *
 * Rule #14 boundary: this store only READS the existing exported Airwallex helpers
 * (priceConfigForTier / priceIdForTier / COLLECTIVE_TIER_CATALOG / AIRWALLEX_COLLECTIVE_ENV).
 * It never creates/edits provider-side products or prices, and publishing is BLOCKED
 * when a package's display price does not match the selected tier's env config.
 *
 * ESM-only; reuses the existing createRequire shim pattern (none added). Sync
 * better-sqlite3 access via rawDb().
 */

import { createHash, randomBytes } from "node:crypto";
import { rawDb } from "./db/connection";
import {
  COLLECTIVE_TIER_CATALOG,
  AIRWALLEX_COLLECTIVE_ENV,
  priceConfigForTier,
  priceIdForTier,
  type CollectiveTier,
} from "./lib/airwallexCollective";
import { log } from "./lib/logger";

/* ------------------------------------------------------------------ types */

export type CollectiveSubscriptionStatus = "draft" | "preview" | "live" | "deprecated";
export type CollectiveSubscriptionInterval = "monthly" | "quarterly" | "annual" | "one_time";
export type CollectiveAirwallexTier = CollectiveTier; // "basic" | "standard" | "premium"
export type CollectiveMembershipRole = "member" | "dsc_member" | "chapter_admin";

export type CollectiveSubscriptionPackage = {
  id: string;
  slug: string;
  label: string;
  description: string;
  entitlements: string[];
  amountMinor: number;
  currency: string;
  interval: CollectiveSubscriptionInterval;
  airwallexTier: CollectiveAirwallexTier;
  airwallexPriceId: string;
  membershipRole: CollectiveMembershipRole;
  status: CollectiveSubscriptionStatus;
  sortOrder: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  deletedAt?: string | null;
};

export type CollectiveSubscriptionPackageHistory = {
  historyId: string;
  configId: string;
  version: number;
  snapshot: CollectiveSubscriptionPackage;
  prevRevisionHash: string;
  revisionHash: string;
  changedAt: string;
  changedBy?: string | null;
  changeKind: string;
};

export type CollectiveAirwallexPriceRef = {
  tier: CollectiveAirwallexTier;
  priceId: string | null;
  amountMinor: number | null;
  currency: string | null;
  interval: string | null; // "annual" | "monthly" (mapped from env year/month)
  available: boolean;
  envVars: { amountMinor: string; currency: string; interval: string };
};

export type CreateCollectiveSubscriptionPackageInput = {
  slug: string;
  label: string;
  description?: string;
  entitlements?: string[];
  amountMinor: number;
  currency?: string;
  interval?: CollectiveSubscriptionInterval;
  airwallexTier: CollectiveAirwallexTier;
  airwallexPriceId: string;
  membershipRole?: CollectiveMembershipRole;
  status?: "draft" | "preview";
  sortOrder?: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  metadata?: Record<string, unknown>;
};

export type UpdateCollectiveSubscriptionPackageInput = Partial<{
  slug: string;
  label: string;
  description: string;
  entitlements: string[];
  amountMinor: number;
  currency: string;
  interval: CollectiveSubscriptionInterval;
  airwallexTier: CollectiveAirwallexTier;
  airwallexPriceId: string;
  membershipRole: CollectiveMembershipRole;
  sortOrder: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  metadata: Record<string, unknown>;
}>;

type StoreResult<T> = { ok: true } & T | { ok: false; error: string; details?: unknown };

type AuditAppender = (evt: { actor: string; entity: string; kind: string; text: string; meta?: unknown }) => void;
type BridgeEmitter = (evt: { type: string; payload: Record<string, unknown> }) => void;

/* --------------------------------------------------------------- config */

let _audit: AuditAppender | null = null;
let _bridge: BridgeEmitter | null = null;

export function configureCollectiveSubscriptionConfigStore(opts: {
  audit?: AuditAppender;
  bridge?: BridgeEmitter;
}): void {
  if (opts.audit) _audit = opts.audit;
  if (opts.bridge) _bridge = opts.bridge;
}

/* --------------------------------------------------------- helpers */

const ZERO_HASH = "0".repeat(64);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const CCY_RE = /^[A-Z]{3}$/;
const VALID_INTERVALS: CollectiveSubscriptionInterval[] = ["monthly", "quarterly", "annual", "one_time"];
const VALID_TIERS: CollectiveAirwallexTier[] = ["basic", "standard", "premium"];
const VALID_ROLES: CollectiveMembershipRole[] = ["member", "dsc_member", "chapter_admin"];
const VALID_STATUS: CollectiveSubscriptionStatus[] = ["draft", "preview", "live", "deprecated"];

function nowIso(): string { return new Date().toISOString(); }
function newId(): string { return `csc_${randomBytes(9).toString("hex")}`; }

/** Map the Airwallex env interval ("year"|"month") to the package interval enum. */
function mapEnvInterval(i: string | null | undefined): CollectiveSubscriptionInterval {
  if (i === "month") return "monthly";
  return "annual"; // env "year" (or unset default) -> annual
}

/** Env var name lookup (envVarsForTier is not exported from airwallexCollective). */
function envVarNamesForTier(tier: CollectiveAirwallexTier): { amountMinor: string; currency: string; interval: string } {
  const E = AIRWALLEX_COLLECTIVE_ENV;
  switch (tier) {
    case "basic": return { amountMinor: E.BASIC_AMOUNT_MINOR, currency: E.BASIC_CURRENCY, interval: E.BASIC_INTERVAL };
    case "standard": return { amountMinor: E.STANDARD_AMOUNT_MINOR, currency: E.STANDARD_CURRENCY, interval: E.STANDARD_INTERVAL };
    case "premium": return { amountMinor: E.PREMIUM_AMOUNT_MINOR, currency: E.PREMIUM_CURRENCY, interval: E.PREMIUM_INTERVAL };
  }
}

/** Canonical serialization for the revision hash (excludes volatile hash fields). */
function canonicalForHash(p: CollectiveSubscriptionPackage): string {
  return JSON.stringify({
    slug: p.slug, label: p.label, description: p.description, entitlements: p.entitlements,
    amountMinor: p.amountMinor, currency: p.currency, interval: p.interval,
    airwallexTier: p.airwallexTier, airwallexPriceId: p.airwallexPriceId,
    membershipRole: p.membershipRole, status: p.status, sortOrder: p.sortOrder,
    effectiveFrom: p.effectiveFrom ?? null, effectiveTo: p.effectiveTo ?? null,
    version: p.version, metadata: p.metadata,
  });
}
function computeRevisionHash(p: CollectiveSubscriptionPackage): string {
  return createHash("sha256").update(`${p.prevRevisionHash}|${canonicalForHash(p)}`).digest("hex");
}

function rowToPackage(r: any): CollectiveSubscriptionPackage {
  return {
    id: r.id, slug: r.slug, label: r.label, description: r.description ?? "",
    entitlements: safeJsonArr(r.entitlements_json),
    amountMinor: Number(r.amount_minor), currency: r.currency ?? "USD",
    interval: (r.interval ?? "annual") as CollectiveSubscriptionInterval,
    airwallexTier: (r.airwallex_tier ?? "standard") as CollectiveAirwallexTier,
    airwallexPriceId: r.airwallex_price_id ?? "",
    membershipRole: (r.membership_role ?? "member") as CollectiveMembershipRole,
    status: (r.status ?? "draft") as CollectiveSubscriptionStatus,
    sortOrder: Number(r.sort_order ?? 0),
    effectiveFrom: r.effective_from ?? null, effectiveTo: r.effective_to ?? null,
    version: Number(r.version ?? 1),
    prevRevisionHash: r.prev_revision_hash ?? ZERO_HASH,
    revisionHash: r.revision_hash ?? "",
    metadata: safeJsonObj(r.metadata_json),
    createdAt: r.created_at, updatedAt: r.updated_at,
    createdBy: r.created_by ?? null, updatedBy: r.updated_by ?? null,
    deletedAt: r.deleted_at ?? null,
  };
}
function safeJsonArr(s: unknown): string[] {
  try { const v = JSON.parse(String(s ?? "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}
function safeJsonObj(s: unknown): Record<string, unknown> {
  try { const v = JSON.parse(String(s ?? "{}")); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/* --------------------------------------------------------- price refs */

export function listAvailableAirwallexPriceRefs(): CollectiveAirwallexPriceRef[] {
  return VALID_TIERS.map((tier) => {
    const cfg = priceConfigForTier(tier);
    const priceId = priceIdForTier(tier);
    const envVars = envVarNamesForTier(tier);
    return {
      tier,
      priceId: priceId ?? null,
      amountMinor: cfg?.amountMinor ?? null,
      currency: cfg?.currency ?? null,
      interval: cfg ? mapEnvInterval(cfg.interval) : null,
      available: cfg !== null && priceId !== null,
      envVars,
    };
  });
}

function priceRefForTier(tier: CollectiveAirwallexTier): CollectiveAirwallexPriceRef {
  return listAvailableAirwallexPriceRefs().find((r) => r.tier === tier)!;
}

/* --------------------------------------------------------- validation */

function validateCommon(p: {
  slug: string; label: string; description: string; entitlements: string[];
  amountMinor: number; currency: string; interval: string; airwallexTier: string;
  airwallexPriceId: string; membershipRole: string; effectiveFrom?: string | null; effectiveTo?: string | null;
}): string | null {
  if (!SLUG_RE.test(p.slug)) return "invalid_slug";
  if (!p.label || p.label.length > 120) return "invalid_label";
  if ((p.description ?? "").length > 2000) return "invalid_description";
  if (!Array.isArray(p.entitlements) || p.entitlements.length > 100) return "invalid_entitlements";
  for (const e of p.entitlements) { if (typeof e !== "string" || e.length === 0 || e.length > 240) return "invalid_entitlements"; }
  if (!Number.isInteger(p.amountMinor) || p.amountMinor < 0) return "invalid_amount";
  if (!CCY_RE.test(p.currency)) return "invalid_currency";
  if (!VALID_INTERVALS.includes(p.interval as CollectiveSubscriptionInterval)) return "invalid_interval";
  if (!VALID_TIERS.includes(p.airwallexTier as CollectiveAirwallexTier)) return "invalid_airwallex_tier";
  if (!VALID_ROLES.includes(p.membershipRole as CollectiveMembershipRole)) return "invalid_membership_role";
  // airwallexPriceId must match one CURRENT configured ref (existing refs only).
  const refs = listAvailableAirwallexPriceRefs();
  const known = refs.some((r) => r.priceId === p.airwallexPriceId);
  if (!known) return "unknown_airwallex_price_id";
  if (p.effectiveFrom && p.effectiveTo) {
    if (new Date(p.effectiveTo).getTime() <= new Date(p.effectiveFrom).getTime()) return "invalid_effective_window";
  }
  return null;
}

/** Publish-time (or checkout-time) price-match check against the selected tier's env ref. */
function priceMismatch(p: CollectiveSubscriptionPackage): boolean {
  const ref = priceRefForTier(p.airwallexTier);
  if (!ref.available || ref.priceId === null) return true; // env not configured -> cannot publish
  if (p.airwallexPriceId !== ref.priceId) return true;
  if (ref.amountMinor !== p.amountMinor) return true;
  if ((ref.currency ?? "") !== p.currency) return true;
  // interval compatibility: env maps to annual|monthly; package interval must equal it.
  if ((ref.interval ?? "") !== p.interval) return true;
  return false;
}

/* --------------------------------------------------------- DB read */

function slugExists(slug: string, excludeId?: string): boolean {
  const row = rawDb()
    .prepare(`SELECT id FROM collective_subscription_configs WHERE slug = ? AND deleted_at IS NULL`)
    .get(slug) as { id: string } | undefined;
  return !!row && row.id !== excludeId;
}

export function listPackages(filter?: {
  status?: CollectiveSubscriptionStatus; includeDeleted?: boolean; includeExpired?: boolean;
}): CollectiveSubscriptionPackage[] {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (!filter?.includeDeleted) clauses.push("deleted_at IS NULL");
  if (filter?.status) { clauses.push("status = ?"); args.push(filter.status); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = rawDb()
    .prepare(`SELECT * FROM collective_subscription_configs ${where} ORDER BY sort_order ASC, label ASC`)
    .all(...args) as any[];
  let pkgs = rows.map(rowToPackage);
  if (!filter?.includeExpired) {
    const now = Date.now();
    pkgs = pkgs.filter((p) => !p.effectiveTo || new Date(p.effectiveTo).getTime() > now);
  }
  return pkgs;
}

export function listPublishedPackages(opts?: { now?: Date }): CollectiveSubscriptionPackage[] {
  const now = (opts?.now ?? new Date()).getTime();
  return listPackages({ status: "live", includeExpired: true }).filter((p) => {
    if (p.effectiveFrom && new Date(p.effectiveFrom).getTime() > now) return false;
    if (p.effectiveTo && new Date(p.effectiveTo).getTime() <= now) return false;
    return true;
  });
}

export function getPackage(id: string, opts?: { includeDeleted?: boolean }): CollectiveSubscriptionPackage | null {
  const row = rawDb().prepare(`SELECT * FROM collective_subscription_configs WHERE id = ?`).get(id) as any;
  if (!row) return null;
  if (row.deleted_at && !opts?.includeDeleted) return null;
  return rowToPackage(row);
}

export function getPackageBySlug(slug: string, opts?: { includeDraft?: boolean; includeDeleted?: boolean }): CollectiveSubscriptionPackage | null {
  const row = rawDb().prepare(`SELECT * FROM collective_subscription_configs WHERE slug = ?`).get(slug) as any;
  if (!row) return null;
  if (row.deleted_at && !opts?.includeDeleted) return null;
  const p = rowToPackage(row);
  if (p.status === "draft" && !opts?.includeDraft) return null;
  return p;
}

export function getPackageHistory(id: string): CollectiveSubscriptionPackageHistory[] {
  const rows = rawDb()
    .prepare(`SELECT * FROM collective_subscription_config_history WHERE config_id = ? ORDER BY version ASC`)
    .all(id) as any[];
  return rows.map((r) => ({
    historyId: r.history_id, configId: r.config_id, version: Number(r.version),
    snapshot: JSON.parse(r.snapshot_json), prevRevisionHash: r.prev_revision_hash,
    revisionHash: r.revision_hash, changedAt: r.changed_at, changedBy: r.changed_by ?? null,
    changeKind: r.change_kind,
  }));
}

export function verifyPackageChain(id: string): { ok: boolean; brokenAt?: number; length: number } {
  const hist = getPackageHistory(id);
  let prev = ZERO_HASH;
  for (let i = 0; i < hist.length; i++) {
    const h = hist[i];
    if (h.prevRevisionHash !== prev) return { ok: false, brokenAt: i, length: hist.length };
    const expected = createHash("sha256").update(`${h.prevRevisionHash}|${canonicalForHash(h.snapshot)}`).digest("hex");
    if (expected !== h.revisionHash) return { ok: false, brokenAt: i, length: hist.length };
    prev = h.revisionHash;
  }
  return { ok: true, length: hist.length };
}

/* --------------------------------------------------------- DB write */

function writeHistory(p: CollectiveSubscriptionPackage, changeKind: string, actor: string): void {
  rawDb().prepare(
    `INSERT INTO collective_subscription_config_history
      (history_id, config_id, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, changed_by, change_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`csch_${randomBytes(9).toString("hex")}`, p.id, p.version, JSON.stringify(p),
    p.prevRevisionHash, p.revisionHash, p.updatedAt, actor, changeKind);
}

function emit(kind: string, actor: string, p: CollectiveSubscriptionPackage, text: string): void {
  try { _audit?.({ actor, entity: "collective_subscription", kind, text, meta: { id: p.id, slug: p.slug, status: p.status } }); } catch { /* non-fatal */ }
  try { _bridge?.({ type: "collective.subscription_config.updated", payload: { id: p.id, slug: p.slug, status: p.status, kind } }); } catch { /* non-fatal */ }
}

export function createPackage(input: CreateCollectiveSubscriptionPackageInput, actor: string): StoreResult<{ package: CollectiveSubscriptionPackage }> {
  const slug = String(input.slug ?? "").trim().toLowerCase();
  const draft: CollectiveSubscriptionPackage = {
    id: newId(), slug, label: input.label, description: input.description ?? "",
    entitlements: input.entitlements ?? [],
    amountMinor: input.amountMinor, currency: (input.currency ?? "USD").toUpperCase(),
    interval: input.interval ?? "annual",
    airwallexTier: input.airwallexTier, airwallexPriceId: input.airwallexPriceId,
    membershipRole: input.membershipRole ?? "member",
    status: input.status ?? "draft",
    sortOrder: input.sortOrder ?? 0,
    effectiveFrom: input.effectiveFrom ?? null, effectiveTo: input.effectiveTo ?? null,
    version: 1, prevRevisionHash: ZERO_HASH, revisionHash: "",
    metadata: input.metadata ?? {},
    createdAt: nowIso(), updatedAt: nowIso(), createdBy: actor, updatedBy: actor, deletedAt: null,
  };
  if (draft.status === "live" || draft.status === "deprecated") return { ok: false, error: "create_status_must_be_draft_or_preview" };
  const err = validateCommon(draft);
  if (err) return { ok: false, error: err };
  if (slugExists(slug)) return { ok: false, error: "slug_taken" };
  draft.revisionHash = computeRevisionHash(draft);
  rawDb().prepare(
    `INSERT INTO collective_subscription_configs
      (id, slug, label, description, entitlements_json, amount_minor, currency, interval,
       airwallex_tier, airwallex_price_id, membership_role, status, sort_order,
       effective_from, effective_to, version, prev_revision_hash, revision_hash,
       metadata_json, created_at, updated_at, created_by, updated_by, deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`
  ).run(draft.id, draft.slug, draft.label, draft.description, JSON.stringify(draft.entitlements),
    draft.amountMinor, draft.currency, draft.interval, draft.airwallexTier, draft.airwallexPriceId,
    draft.membershipRole, draft.status, draft.sortOrder, draft.effectiveFrom, draft.effectiveTo,
    draft.version, draft.prevRevisionHash, draft.revisionHash, JSON.stringify(draft.metadata),
    draft.createdAt, draft.updatedAt, draft.createdBy, draft.updatedBy);
  writeHistory(draft, "create", actor);
  emit("create", actor, draft, `Created Collective package ${draft.slug}`);
  return { ok: true, package: draft };
}

export function updatePackage(id: string, input: UpdateCollectiveSubscriptionPackageInput, actor: string): StoreResult<{ package: CollectiveSubscriptionPackage }> {
  const cur = getPackage(id);
  if (!cur) return { ok: false, error: "not_found" };
  const next: CollectiveSubscriptionPackage = {
    ...cur,
    ...(input.slug !== undefined ? { slug: String(input.slug).trim().toLowerCase() } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.entitlements !== undefined ? { entitlements: input.entitlements } : {}),
    ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
    ...(input.currency !== undefined ? { currency: input.currency.toUpperCase() } : {}),
    ...(input.interval !== undefined ? { interval: input.interval } : {}),
    ...(input.airwallexTier !== undefined ? { airwallexTier: input.airwallexTier } : {}),
    ...(input.airwallexPriceId !== undefined ? { airwallexPriceId: input.airwallexPriceId } : {}),
    ...(input.membershipRole !== undefined ? { membershipRole: input.membershipRole } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.effectiveFrom !== undefined ? { effectiveFrom: input.effectiveFrom } : {}),
    ...(input.effectiveTo !== undefined ? { effectiveTo: input.effectiveTo } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    version: cur.version + 1,
    prevRevisionHash: cur.revisionHash,
    updatedAt: nowIso(), updatedBy: actor,
  };
  const err = validateCommon(next);
  if (err) return { ok: false, error: err };
  if (next.slug !== cur.slug && slugExists(next.slug, id)) return { ok: false, error: "slug_taken" };
  next.revisionHash = computeRevisionHash(next);
  rawDb().prepare(
    `UPDATE collective_subscription_configs SET
      slug=?, label=?, description=?, entitlements_json=?, amount_minor=?, currency=?, interval=?,
      airwallex_tier=?, airwallex_price_id=?, membership_role=?, sort_order=?, effective_from=?, effective_to=?,
      version=?, prev_revision_hash=?, revision_hash=?, metadata_json=?, updated_at=?, updated_by=?
     WHERE id=?`
  ).run(next.slug, next.label, next.description, JSON.stringify(next.entitlements), next.amountMinor,
    next.currency, next.interval, next.airwallexTier, next.airwallexPriceId, next.membershipRole,
    next.sortOrder, next.effectiveFrom, next.effectiveTo, next.version, next.prevRevisionHash,
    next.revisionHash, JSON.stringify(next.metadata), next.updatedAt, next.updatedBy, id);
  writeHistory(next, "update", actor);
  emit("update", actor, next, `Updated Collective package ${next.slug}`);
  return { ok: true, package: next };
}

export function promotePackage(id: string, to: CollectiveSubscriptionStatus, actor: string): StoreResult<{ package: CollectiveSubscriptionPackage }> {
  const cur = getPackage(id);
  if (!cur) return { ok: false, error: "not_found" };
  if (!VALID_STATUS.includes(to)) return { ok: false, error: "invalid_status" };
  // Publish validation (rule #14): a package can only go live when its display price
  // matches the selected existing Airwallex tier env config, else we'd charge wrong.
  if (to === "live") {
    if (priceMismatch(cur)) {
      return {
        ok: false, error: "airwallex_price_mismatch",
        details: { message: "Existing Airwallex Collective checkout computes amount from env tier config. Publishing a package with a different display price (or an unconfigured tier ref) would charge the wrong amount." },
      };
    }
    if (slugExists(cur.slug, id)) return { ok: false, error: "slug_taken" };
  }
  const next: CollectiveSubscriptionPackage = {
    ...cur, status: to, version: cur.version + 1, prevRevisionHash: cur.revisionHash,
    updatedAt: nowIso(), updatedBy: actor,
  };
  next.revisionHash = computeRevisionHash(next);
  rawDb().prepare(
    `UPDATE collective_subscription_configs SET status=?, version=?, prev_revision_hash=?, revision_hash=?, updated_at=?, updated_by=? WHERE id=?`
  ).run(next.status, next.version, next.prevRevisionHash, next.revisionHash, next.updatedAt, next.updatedBy, id);
  writeHistory(next, `promote:${to}`, actor);
  emit("promote", actor, next, `Promoted Collective package ${next.slug} -> ${to}`);
  return { ok: true, package: next };
}

export function clonePackage(id: string, actor: string): StoreResult<{ package: CollectiveSubscriptionPackage }> {
  const cur = getPackage(id);
  if (!cur) return { ok: false, error: "not_found" };
  let cloneSlug = `${cur.slug}-copy`;
  let n = 2;
  while (slugExists(cloneSlug)) { cloneSlug = `${cur.slug}-copy-${n++}`; if (n > 50) break; }
  return createPackage({
    slug: cloneSlug, label: `${cur.label} (copy)`, description: cur.description,
    entitlements: [...cur.entitlements], amountMinor: cur.amountMinor, currency: cur.currency,
    interval: cur.interval, airwallexTier: cur.airwallexTier, airwallexPriceId: cur.airwallexPriceId,
    membershipRole: cur.membershipRole, status: "draft", sortOrder: cur.sortOrder,
    effectiveFrom: null, effectiveTo: null, metadata: { ...cur.metadata, clonedFrom: cur.id },
  }, actor);
}

export function deletePackage(id: string, actor: string): StoreResult<{}> {
  const cur = getPackage(id);
  if (!cur) return { ok: false, error: "not_found" };
  if (cur.status === "live") return { ok: false, error: "cannot_delete_live_deprecate_instead" };
  rawDb().prepare(`UPDATE collective_subscription_configs SET deleted_at=?, updated_at=?, updated_by=? WHERE id=?`)
    .run(nowIso(), nowIso(), actor, id);
  emit("delete", actor, cur, `Deleted Collective package ${cur.slug}`);
  return { ok: true };
}

/* --------------------------------------------------------- checkout resolver */

export function resolvePublishedPackageForCheckout(input: { packageId?: string; packageSlug?: string }):
  { ok: true; package: CollectiveSubscriptionPackage; priceRef: CollectiveAirwallexPriceRef } | { ok: false; error: string } {
  let pkg: CollectiveSubscriptionPackage | null = null;
  if (input.packageId) pkg = getPackage(input.packageId);
  else if (input.packageSlug) pkg = getPackageBySlug(input.packageSlug);
  if (!pkg) return { ok: false, error: "package_not_found" };
  if (pkg.status !== "live") return { ok: false, error: "package_not_live" };
  const now = Date.now();
  if (pkg.effectiveFrom && new Date(pkg.effectiveFrom).getTime() > now) return { ok: false, error: "package_not_effective" };
  if (pkg.effectiveTo && new Date(pkg.effectiveTo).getTime() <= now) return { ok: false, error: "package_expired" };
  if (priceMismatch(pkg)) return { ok: false, error: "airwallex_price_mismatch" };
  return { ok: true, package: pkg, priceRef: priceRefForTier(pkg.airwallexTier) };
}

/* --------------------------------------------------------- bootstrap */

export function bootstrapPackagesFromEnv(actor: string): StoreResult<{ packages: CollectiveSubscriptionPackage[] }> {
  const existing = listPackages({ includeDeleted: false, includeExpired: true });
  if (existing.length > 0) return { ok: false, error: "packages_already_exist" };
  const created: CollectiveSubscriptionPackage[] = [];
  for (const desc of COLLECTIVE_TIER_CATALOG) {
    const ref = priceRefForTier(desc.tier);
    if (!ref.available || ref.priceId === null || ref.amountMinor === null || ref.currency === null) continue;
    const res = createPackage({
      slug: desc.tier, label: desc.label, description: desc.blurb, entitlements: desc.entitlements,
      amountMinor: ref.amountMinor, currency: ref.currency,
      interval: (ref.interval as CollectiveSubscriptionInterval) ?? "annual",
      airwallexTier: desc.tier, airwallexPriceId: ref.priceId, membershipRole: desc.membershipRole,
      status: "draft", sortOrder: VALID_TIERS.indexOf(desc.tier),
    }, actor);
    if (res.ok) created.push(res.package);
  }
  if (created.length === 0) return { ok: false, error: "no_configured_tiers_to_bootstrap" };
  return { ok: true, packages: created };
}

/** Lightweight hydrator — schema reachability check (DB-backed; no in-memory state). */
export function hydrateCollectiveSubscriptionConfigStore(): void {
  try {
    const n = (rawDb().prepare(`SELECT COUNT(*) AS n FROM collective_subscription_configs`).get() as { n: number }).n;
    log.info(`[collectiveSubscriptionConfigStore.hydrate] packages=${n}`);
  } catch (err) {
    log.warn("[collectiveSubscriptionConfigStore.hydrate] DB read failed:", (err as Error).message);
  }
}
