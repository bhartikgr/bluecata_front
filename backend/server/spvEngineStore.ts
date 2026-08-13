/**
 * v25.49 Phase-4 — CANONICAL SPV Engine store (ONE store, many CONTEXTS).
 *
 * Mirrors the Messages/Posts one-store-many-contexts pattern: a single canonical
 * store owns every SPV; Consortium Partner (GP owner) / Collective / Capavate are
 * CONTEXTS (entry points + visibility scopes) layered on top via read filters.
 * An SPV is ALWAYS owned by its sponsoring Consortium Partner as GP. A Fund is an
 * SPV with spvType = "fund".
 *
 * PERSISTENCE: RAM→DB write-through + rehydrate-on-boot (mirrors
 * partnerClientCrmStore / partnerWorkspaceStore v24.4.1). ZERO in-memory
 * canonical state — SQLite is the source of truth; the Maps are a rebuildable
 * projection. Writes fail CLOSED (throw STRICT_PERSIST_FAILED) so a money/identity
 * surface never diverges from the DB.
 *
 * FAIL-CLOSED SCOPING: every read/write is scoped to a partnerId (the GP). The
 * route layer resolves partnerId from the SESSION via requirePartnerAuth (never
 * the URL) and verifies ownership before touching a specific SPV.
 *
 * THIN COORDINATION LAYER: almost every field is an FK into an existing canonical
 * record (company / round / investor / partner). Eligibility is computed by
 * reading canonical stores — the engine never re-collects or duplicates that data.
 *
 * SINGULAR table names (spv, spv_mandate, …) deliberately avoid collision with
 * the pre-existing PLURAL tables owned by spvFundStore (spvs, spv_distributions…).
 */
import { createHash, randomBytes } from "crypto";
import { recordFeeHydration, feeStateUnknown, probeFeeRowCount } from "./lib/spvFeeHydrationState";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
/* WAVE 10 / EN-1 — project distributions into the ILPA cash-flow ledger. */
import { projectDistribution, tryProject } from "./lib/ilpaCashflowLedger";
import { emitBridgeEvent, type OutboundEventType } from "./bridgeStore";
// WAVE 8 ORP-029 — sibling module, so the engine store itself stays thin.
import { chargeEngineSpvDeploymentFee } from "./lib/spvEngineDeploymentFeeHook";
// Wave B v26.4.0-fix (BLOCK-B) — static import replaces the prior lazy
// `require("./spvFundStore")`. Verified: NO circular dependency exists
// (`spvFundStore.ts` does not import from `spvEngineStore` at all, and
// nothing in its import closure does either). The lazy pattern is
// documented as bundle-fragile in CAPAVATE_LIVE_ENVIRONMENT.md §9 Issue-1
// (round-wizard 403) and undefined under `tsx` ESM (npm run dev).
// The Stage-2 adapters delegate here to preserve hash-chain invariants
// through Wave B; Wave B.5 replaces the delegation with direct DB reads.
import {
  spvFundStore,
  type SpvRow,
  type SpvCommitmentRow,
  type SpvCapitalCallRow,
  type SpvDistributionRow,
  type SpvPositionRow,
  type SpvReconciliation,
  type CommitmentStatus,
  type DistributionType,
} from "./spvFundStore";
import { partnerSpvStore, partnerFundsStore } from "./partnerWorkspaceStore";
import { listForCompany as listSubscriptionsForCompany } from "./subscriptionStore";
import { getCompanyProfile } from "./companyProfileStore";
import { hasActiveOrLiveRound, getRoundsForCompany, ACTIVE_LIVE_ROUND_STATES } from "./roundsStore";
import { chargeOrIdempotent } from "./paymentStore";
// WAVE 1A / S-2 — the fee self-mark fix. See server/lib/feeSettlementAuthority.ts.
// WAVE 3E — `withSettlementTransaction` makes the CONSUME atomic with the money
// write. See server/lib/feeSettlementAuthority.ts and migration 0151.
import {
  consumeSettlementAuthorization,
  isFeeSettlementAuthorization,
  withSettlementTransaction,
  type FeeSettlementAuthorization,
} from "./lib/feeSettlementAuthority";
/* WAVE 35 · F5 — `convertMinorUnits` re-scales by BOTH ISO-4217 exponents.
   Static import (never a lazy require — see F4). */
import { allocateDistributionMinor, exactFractionToCarryScaled, convertMinorUnits } from "./lib/money";
/* WAVE 32 / CP-SPV-30 capability 2 — per-LP side-letter carry, applied to the
   canonical waterfall between the allocator and the carry collection. */
import { applySideLetterCarry } from "./lib/spvSideLetterWaterfall";
import { activeCarryOverrides } from "./spvSideLetterStore";
import { resolveCombinedCarryCapScaled } from "./lib/combinedCarryCapPolicy";
import { normaliseSpvTermsHurdle } from "./lib/percentPolicy";
/* WAVE 6 / SC-3 — canonical distribution-type domain + the idempotent
   third-place column bootstrap (server/db/connection.ts is SACRED). */
import {
  ensureSpvDistributionTypeColumn,
  resolveDistributionType,
  distributionTypeFromEvent,
  type SpvDistributionType,
} from "./lib/spvDistributionType";
import {
  computeFundsConfirmation,
  computeCapitalAccounts,
  computeCloseSummary,
  computeDistributionSplit,
  canReopenClose,
  type FundsConfirmation,
  type CapitalAccountRow,
  type CloseSummary,
  type DistributionSplit,
} from "./lib/spvOfflineOps";

/* WAVE 3D / ITEM 3 — THE COMBINED-CARRY CAP IS NO LONGER HARDCODED HERE.
 *
 * WHAT WAS HERE:
 *
 *     export const COMBINED_CARRY_CAP_FRACTION = 1;
 *
 * W3 REVIEW A, "MAJOR — Combined-carry policy is hardcoded instead of
 * DB-driven": that is a business-policy number compiled into the artifact.
 * Changing the cap required a deployment, no tenant/SPV policy record was
 * consulted, and there was no audit history of the change.
 *
 * WHAT IS HERE NOW: `resolveCombinedCarryCapScaled` (server/lib/
 * combinedCarryCapPolicy.ts) reads the cap from `spv_carry_cap_policy`
 * (migration 0150) as an EXACT INTEGER on CARRY_FRACTION_SCALE, scoped
 * spv -> tenant -> platform, most specific wins, and FAILS CLOSED with
 * COMBINED_CARRY_CAP_POLICY_MISSING when no active row applies. A missing
 * config record rejects the distribution; it never means "no cap". The seeded
 * platform row holds 1e9 (== the old 1), so upgrade behaviour is unchanged. */

import {
  SPV_DEFAULT_SCOPE,
  isSpvCarryBasis,
  isSpvJurisdiction,
  resolveSpvJurisdiction, /* WAVE 4A follow-up 2 */
  isSpvType,
  isSpvStatus,
  isSpvDistributionScope,
  isSpvLpVisibility,
  isSpvMandateMode,
  isSpvFeeLayer,
  isSpvFeeType,
  SPV_DEFAULT_LP_VISIBILITY,
  type SpvLpVisibility,
  type SpvMandateMode,
  type SpvDTO,
  type SpvMandateDTO,
  type SpvFeeDTO,
  type SpvSubscriptionDTO,
  type SpvDeploymentDTO,
  type SpvDistributionDTO,
  type SpvDistributionAllocation,
  type SpvFeeObligationDTO,
  type SpvFeeObligationPortion,
  type SpvFeeObligationTiming,
  type SpvDocumentDTO,
  type SpvTransferDTO,
  type InvestorComplianceProfileDTO,
  type SpvFeeBreakdown,
  type SpvStatus,
  type SpvSubscriptionStatus,
  type SpvDistributionScope,
  type MandateRuleTree,
  type MandateLeaf,
  type MandateNode,
} from "../shared/spvEngine";

const GENESIS = "0".repeat(64);
function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}
function nowIso(): string {
  return new Date().toISOString();
}
function requirePid(partnerId: string): void {
  if (!partnerId || typeof partnerId !== "string") throw new Error("PARTNER_ID_REQUIRED");
}

/* ── per-table hash chains (append-log audit anchors) ───────────────────── */
const chainTip: Record<string, string> = {};
function chain(table: string, bodyWithoutHash: Record<string, unknown>): { prev: string; curr: string } {
  const prev = chainTip[table] ?? GENESIS;
  const stable = JSON.stringify(bodyWithoutHash, Object.keys(bodyWithoutHash).sort());
  const curr = sha256Hex(`${prev}|${stable}`);
  chainTip[table] = curr;
  return { prev, curr };
}

/* ── in-memory projections ──────────────────────────────────────────────── */
const spvById = new Map<string, SpvDTO>();
const mandateBySpv = new Map<string, SpvMandateDTO>();
const feesBySpv = new Map<string, SpvFeeDTO[]>();
const subsBySpv = new Map<string, SpvSubscriptionDTO[]>();
const deploymentsBySpv = new Map<string, SpvDeploymentDTO[]>();
const distributionsBySpv = new Map<string, SpvDistributionDTO[]>();
const docsBySpv = new Map<string, SpvDocumentDTO[]>();
const transfersBySpv = new Map<string, SpvTransferDTO[]>();
const complianceByInvestor = new Map<string, InvestorComplianceProfileDTO>();
const feeObligationsBySpv = new Map<string, SpvFeeObligationDTO[]>();

function pushInto<T>(map: Map<string, T[]>, key: string, val: T): void {
  const arr = map.get(key) ?? [];
  arr.push(val);
  map.set(key, arr);
}

/* WAVE 8 ORP-028 (SPV-55) — the parameter was `string` and the emit was
   `eventType as never`; that cast is exactly what let all 21 spv.* events
   compile while being absent from the outbound registry. Both are now typed
   against OutboundEventType, so an unregistered spv.* event is a compile
   error rather than an unreplayable runtime envelope. */
/* WAVE 3F / ITEM 1 — TRANSACTION-SCOPED EVENT BUFFER.
 *
 * `recordDistribution` now runs its carry collection AND its distribution
 * insert inside ONE outer transaction. `chargeFeeObligation` emits
 * `spv.fee_obligation_paid` at the end of its own (now nested) scope. Emitting
 * that envelope while the OUTER transaction can still roll back would announce
 * a settlement that never committed — the audit bridge would carry a fact the
 * database does not hold. While a deferral scope is open every emit is
 * BUFFERED; the buffer is flushed only after the outer COMMIT and DISCARDED on
 * rollback. Nothing else about `emit` changes: it is still best-effort and
 * still never blocks a money write. */
let deferredEvents: Array<{ eventType: OutboundEventType; aggregateId: string; payload: Record<string, unknown> }> | null = null;

function emit(eventType: OutboundEventType, aggregateId: string, payload: Record<string, unknown>): void {
  if (deferredEvents) { deferredEvents.push({ eventType, aggregateId, payload }); return; }
  try {
    emitBridgeEvent({ eventType, aggregateId, aggregateKind: "platform", payload });
  } catch { /* non-fatal: audit bridge is best-effort, never blocks a money write */ }
}

/** Open an event-deferral scope. Returns the flush/discard handle. Re-entrant
 *  safe: a nested open reuses the outermost buffer and its handle is inert. */
function openEventDeferral(): { flush: () => void; discard: () => void } {
  if (deferredEvents) return { flush: () => {}, discard: () => {} };
  const buf: Array<{ eventType: OutboundEventType; aggregateId: string; payload: Record<string, unknown> }> = [];
  deferredEvents = buf;
  return {
    flush: () => {
      deferredEvents = null;
      for (const e of buf) emit(e.eventType, e.aggregateId, e.payload);
    },
    discard: () => { deferredEvents = null; },
  };
}

/* ── write-through helpers (fail-closed) ────────────────────────────────── */
function persist(table: string, sql: string, params: unknown[]): void {
  try {
    rawDb().prepare(sql).run(...(params as never[]));
  } catch (err) {
    log.warn(`[spvEngineStore] ${table} write-through failed:`, (err as Error).message);
    throw new Error(`STRICT_PERSIST_FAILED: ${table}: ${(err as Error).message}`);
  }
}

function persistSpv(s: SpvDTO): void {
  const { prev, curr } = chain("spv", spvChainBody(s));
  s.revisionHash = curr;
  persist(
    "spv",
    `INSERT INTO spv (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
       distribution_scope, target_raise_minor, min_check_minor, cap_minor, currency, carry_basis,
       lp_visibility, target_company_id, close_date, terms_json, migrated_from, created_at, created_by,
       updated_at, updated_by, archived_at, prev_hash, curr_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, spv_type=excluded.spv_type, jurisdiction=excluded.jurisdiction,
       status=excluded.status, distribution_scope=excluded.distribution_scope,
       target_raise_minor=excluded.target_raise_minor, min_check_minor=excluded.min_check_minor,
       cap_minor=excluded.cap_minor, currency=excluded.currency, carry_basis=excluded.carry_basis,
       lp_visibility=excluded.lp_visibility,
       target_company_id=excluded.target_company_id, close_date=excluded.close_date,
       terms_json=excluded.terms_json, updated_at=excluded.updated_at, updated_by=excluded.updated_by,
       archived_at=excluded.archived_at, prev_hash=excluded.prev_hash, curr_hash=excluded.curr_hash`,
    [
      s.id, s.sponsorPartnerId, s.gpUserId, s.name, s.spvType, s.jurisdiction, s.status,
      s.distributionScope, s.targetRaiseMinor, s.minCheckMinor, s.capMinor, s.currency, s.carryBasis,
      s.lpVisibility, s.targetCompanyId, s.closeDate, s.terms ? JSON.stringify(s.terms) : null, s.migratedFrom,
      s.createdAt, s.createdBy, s.updatedAt, s.updatedBy, s.archivedAt, prev, curr,
    ],
  );
}
function spvChainBody(s: SpvDTO): Record<string, unknown> {
  const { revisionHash: _omit, ...rest } = s;
  return rest as unknown as Record<string, unknown>;
}

/* ── eligibility (fail-closed) ──────────────────────────────────────────── */
export interface CompanyEligibilityFacts {
  companyId: string;
  paidSubscriber: boolean;
  hasMaProfile: boolean;
  hasActiveRound: boolean;
  sector: string | null;
  stage: string | null;
}

/** Read canonical stores to build eligibility facts. Any read failure or
 *  missing field yields the fail-closed value (false / null) — a company is
 *  NEVER matched on a null. */
export function resolveCompanyFacts(companyId: string): CompanyEligibilityFacts {
  let paidSubscriber = false;
  let hasMaProfile = false;
  let hasActiveRound = false;
  let sector: string | null = null;
  let stage: string | null = null;
  try {
    paidSubscriber = listSubscriptionsForCompany(companyId).some((s) => s.status === "active");
  } catch { paidSubscriber = false; }
  try {
    const p = getCompanyProfile(companyId);
    sector = (p.sector && String(p.sector).trim()) || null;
    stage = (p.stage && String(p.stage).trim()) || null;
    // Valid M&A-intelligence profile requires the M&A stage + a sector present.
    hasMaProfile = !!(p.ma_stage && String(p.ma_stage).trim()) && !!sector;
  } catch { hasMaProfile = false; }
  try {
    hasActiveRound = hasActiveOrLiveRound(companyId);
  } catch { hasActiveRound = false; }
  return { companyId, paidSubscriber, hasMaProfile, hasActiveRound, sector, stage };
}

function leafMatches(leaf: MandateLeaf, facts: CompanyEligibilityFacts): boolean {
  // FAIL-CLOSED: unknown field or missing source value → no match (never on null).
  switch (leaf.field) {
    case "geography":
      return false; // geography not sourced yet → fail-closed (never match on null)
    case "sector": {
      if (!facts.sector) return false;
      const vals = Array.isArray(leaf.value) ? leaf.value : [String(leaf.value)];
      return vals.map((v) => v.toLowerCase()).includes(facts.sector.toLowerCase());
    }
    case "stage": {
      if (!facts.stage) return false;
      const vals = Array.isArray(leaf.value) ? leaf.value : [String(leaf.value)];
      return vals.map((v) => v.toLowerCase()).includes(facts.stage.toLowerCase());
    }
    case "company_id": {
      const vals = Array.isArray(leaf.value) ? leaf.value : [String(leaf.value)];
      return vals.includes(facts.companyId);
    }
    case "check_size":
      return false; // check_size is an LP-commitment constraint, not a company fact
    default:
      return false;
  }
}
function nodeMatches(node: MandateRuleTree | MandateLeaf, facts: CompanyEligibilityFacts): boolean {
  if ((node as MandateNode).op === "and" || (node as MandateNode).op === "or") {
    const n = node as MandateNode;
    if (!Array.isArray(n.rules) || n.rules.length === 0) return false; // empty tree → fail-closed
    if (n.op === "and") return n.rules.every((r) => nodeMatches(r, facts));
    return n.rules.some((r) => nodeMatches(r, facts));
  }
  return leafMatches(node as MandateLeaf, facts);
}

/* v25.50 REVISE R3 — shared mandate-description guard. The "Description of Mandate"
   (spec 3e) is mandatory in the wizard. When a create/update payload carries the
   terms.mandateDescription KEY it MUST be a non-empty trimmed string ≤1200 chars;
   reject fail-closed otherwise. When the key is ABSENT the field is untouched
   (partial patches and legacy/shim creates that never send it must still work).
   Called from BOTH createSpv and updateSpv so the rule cannot drift. */
function assertValidMandateDescription(terms: unknown): void {
  if (!terms || typeof terms !== "object") return;
  if (!("mandateDescription" in (terms as Record<string, unknown>))) return;
  const md = (terms as Record<string, unknown>).mandateDescription;
  if (typeof md !== "string" || md.trim().length === 0) throw new Error("MANDATE_DESCRIPTION_REQUIRED");
  if (md.trim().length > 1200) throw new Error("MANDATE_DESCRIPTION_TOO_LONG");
}

/* ── the store ──────────────────────────────────────────────────────────── */
export const spvEngineStore = {
  /* ---- SPV core ---- */
  createSpv(
    partnerId: string,
    data: {
      name: string; jurisdiction: string; carryBasis: string; spvType?: string;
      distributionScope?: string; targetRaiseMinor?: number | null; minCheckMinor?: number | null;
      capMinor?: number | null; currency?: string; targetCompanyId?: string | null;
      closeDate?: string | null; status?: SpvStatus; terms?: Record<string, unknown> | null;
      gpUserId?: string | null; migratedFrom?: string | null; lpVisibility?: string;
    },
    actor: string,
  ): SpvDTO {
    requirePid(partnerId);
    if (!data.name || !data.name.trim()) throw new Error("SPV_NAME_REQUIRED");
    if (!isSpvJurisdiction(data.jurisdiction)) throw new Error("INVALID_JURISDICTION");
    // carry_basis has NO default — GP must choose explicitly.
    if (!isSpvCarryBasis(data.carryBasis)) throw new Error("CARRY_BASIS_REQUIRED");
    const spvType = data.spvType ?? "spv";
    if (!isSpvType(spvType)) throw new Error("INVALID_SPV_TYPE");
    const scope = data.distributionScope ?? SPV_DEFAULT_SCOPE;
    if (!isSpvDistributionScope(scope)) throw new Error("INVALID_DISTRIBUTION_SCOPE");
    // Wave B2 (3b) — an explicit create status must be a valid lifecycle value.
    const createStatus = data.status ?? "draft";
    if (!isSpvStatus(createStatus)) throw new Error("INVALID_SPV_STATUS");
    const lpVisibility = data.lpVisibility ?? SPV_DEFAULT_LP_VISIBILITY;
    if (!isSpvLpVisibility(lpVisibility)) throw new Error("INVALID_LP_VISIBILITY");
    assertValidMandateDescription(data.terms);
    const now = nowIso();
    const s: SpvDTO = {
      id: newId("spv"),
      sponsorPartnerId: partnerId,
      gpUserId: data.gpUserId ?? actor ?? null,
      name: data.name.trim(),
      spvType,
      jurisdiction: data.jurisdiction as SpvDTO["jurisdiction"],
      status: createStatus,
      distributionScope: scope,
      targetRaiseMinor: data.targetRaiseMinor ?? null,
      minCheckMinor: data.minCheckMinor ?? null,
      capMinor: data.capMinor ?? null,
      currency: data.currency ?? "USD",
      carryBasis: data.carryBasis,
      lpVisibility,
      targetCompanyId: data.targetCompanyId ?? null,
      closeDate: data.closeDate ?? null,
      terms: data.terms ?? null,
      migratedFrom: data.migratedFrom ?? null,
      createdAt: now,
      createdBy: actor ?? null,
      updatedAt: now,
      updatedBy: actor ?? null,
      archivedAt: null,
      revisionHash: "",
    };
    persistSpv(s);
    spvById.set(s.id, s);
    // Wave B v26.4.0-fix2 (Opus DEFECT-12 / BLOCK-C real fix) — the previous
    // dual-write in partnerSpvStore.create was on a DEAD path per
    // spvUnifiedCanonical.test.ts:148 ("NO live route calls
    // partnerSpvStore.create"). The LIVE path is this method,
    // reached from partnerRoutes.ts:1630. Shadow-persist to the legacy
    // spvs table + spvsCache HERE, keyed on the engine id via
    // `_overrideId = s.id`, so the 10 legacy adapter routes (which do
    // `spvFundStore.getById(id)` → `spvsCache.get(id)`) can find the
    // SPV a partner just created through the UI.
    // Best-effort with structured logging — engine remains authoritative.
    // Legacy write retires when Wave B.5 replaces spvFundStore RAM reads
    // with direct-DB queries.
    // v26.4.0-fix3 (Opus NEW-1 / GPT NEW-3): use the STRICT variant so
    // duplicate-name creates get their own legacy row keyed by engine id.
    // Also pass the engine's spvType through so funds and syndicates aren't
    // silently mislabelled as 'spv' in the legacy table (Opus NEW-3).
    const persisted = spvFundStore.shadowPersistFromLegacyStrict({
      legacyId: s.id,                        // engine id ≡ legacy id ≡ spvsCache key
      partnerId,
      name: s.name,
      leadCompanyId: s.targetCompanyId,
      gpUserId: s.gpUserId,
      targetMinor: s.targetRaiseMinor ?? 0,
      formedAt: now,
      status: s.status,
      structureType: s.spvType as "spv" | "fund" | "syndicate" | "multi_asset" | "rolling_fund",
    });
    if (!persisted) {
      // Legacy shadow-persist genuinely failed (createSpv threw or the id
      // was somehow non-unique). Engine remains authoritative — log loud so
      // ops can drain manually. No silent drop.
      log.warn?.(
        `[spvEngineStore] createSpv: legacy shadow-persist returned null for spvId=${s.id} partnerId=${partnerId} name=${s.name}. Adapter reads for this SPV will 404 until reconciled.`,
      );
    }
    emit("spv.created", s.id, { partnerId, spvId: s.id, spvType, scope });
    return s;
  },

  getSpv(partnerId: string, spvId: string): SpvDTO | null {
    requirePid(partnerId);
    const s = spvById.get(spvId);
    if (!s || s.sponsorPartnerId !== partnerId) return null; // fail-closed: no cross-partner leak
    return s;
  },

  /** GP context: every SPV this partner sponsors. */
  listByPartner(partnerId: string): SpvDTO[] {
    requirePid(partnerId);
    return Array.from(spvById.values()).filter((s) => s.sponsorPartnerId === partnerId);
  },

  /** Collective / Capavate visibility CONTEXTS: filter the ONE store by scope.
   *  collective_only SPVs are FIRST-CLASS and are EXCLUDED from the capavate
   *  context (they must not appear on core Capavate investor surfaces). */
  listVisibleForContext(context: "collective" | "capavate" | "network"): SpvDTO[] {
    const all = Array.from(spvById.values()).filter((s) => !s.archivedAt && s.status !== "draft");
    return all.filter((s) => {
      const scope: SpvDistributionScope = s.distributionScope;
      // private + invite_only are never broadcast to a discovery context.
      if (scope === "private" || scope === "invite_only") return false;
      // collective_only is FIRST-CLASS: ONLY the collective context, NEVER capavate/network.
      if (scope === "collective_only") return context === "collective";
      // network is visible across all broad contexts (incl. core Capavate).
      if (scope === "network") return true;
      return false;
    });
  },

  updateSpv(partnerId: string, spvId: string, patch: Partial<SpvDTO>, actor: string): SpvDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    // Wave B2 (3b) — status is now client-mutable via the Partner pipeline PATCH;
    // fail-closed on any out-of-enum value so an invalid lifecycle state can
    // never be persisted.
    if (patch.status !== undefined && !isSpvStatus(patch.status)) throw new Error("INVALID_SPV_STATUS");
    if (patch.distributionScope && !isSpvDistributionScope(patch.distributionScope)) throw new Error("INVALID_DISTRIBUTION_SCOPE");
    if (patch.lpVisibility !== undefined && !isSpvLpVisibility(patch.lpVisibility)) throw new Error("INVALID_LP_VISIBILITY");
    /* v25.50 REVISE R3 — same fail-closed guard as createSpv: a patch may not
       replace a valid mandate description with whitespace/empty or >1200 chars. */
    if (patch.terms !== undefined) assertValidMandateDescription(patch.terms);
    if (patch.status) s.status = patch.status;
    const scopeChanged = patch.distributionScope && patch.distributionScope !== s.distributionScope;
    const prevScope = s.distributionScope;
    if (patch.distributionScope) s.distributionScope = patch.distributionScope;
    if (patch.lpVisibility !== undefined) s.lpVisibility = patch.lpVisibility;
    if (patch.name !== undefined) s.name = patch.name;
    if (patch.targetRaiseMinor !== undefined) s.targetRaiseMinor = patch.targetRaiseMinor;
    if (patch.minCheckMinor !== undefined) s.minCheckMinor = patch.minCheckMinor;
    if (patch.capMinor !== undefined) s.capMinor = patch.capMinor;
    if (patch.closeDate !== undefined) s.closeDate = patch.closeDate;
    if (patch.terms !== undefined) s.terms = patch.terms;
    s.updatedAt = nowIso();
    s.updatedBy = actor ?? null;
    persistSpv(s);
    spvById.set(s.id, s);
    emit("spv.updated", s.id, { partnerId, spvId, patch: Object.keys(patch) });
    if (scopeChanged) emit("spv.scope_changed", s.id, { partnerId, spvId, from: prevScope, to: s.distributionScope });
    return s;
  },

  /** Wind-down: archive, never hard-delete (Rule #78 / retention floor). */
  archiveSpv(partnerId: string, spvId: string, actor: string): SpvDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    s.status = "wound_down";
    s.archivedAt = nowIso();
    s.updatedAt = s.archivedAt;
    s.updatedBy = actor ?? null;
    persistSpv(s);
    spvById.set(s.id, s);
    emit("spv.wound_down", s.id, { partnerId, spvId });
    return s;
  },

  /* ---- Mandate + eligibility ---- */
  setMandate(
    partnerId: string,
    spvId: string,
    data: {
      mode?: string; ruleTree: MandateRuleTree; geography?: string[]; sector?: string[];
      companyIds?: string[]; stage?: string[]; checkMinMinor?: number | null; checkMaxMinor?: number | null;
    },
    actor: string,
  ): SpvMandateDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    if (!data.ruleTree || typeof data.ruleTree !== "object") throw new Error("RULE_TREE_REQUIRED");
    /* v25.50 REVISE R2 Blocker 1 — the prior coercion (`deal_specific` else `open`)
       silently dropped the two NEW spec modes (thesis_lp_approval, sector_restricted).
       Fail-closed: reject any provided-but-unrecognized mode; default to `open`
       ONLY when the caller omits mode entirely. Persist the exact valid mode. */
    let mode: SpvMandateMode;
    if (data.mode === undefined || data.mode === null || data.mode === "") {
      mode = "open";
    } else if (isSpvMandateMode(data.mode)) {
      mode = data.mode;
    } else {
      throw new Error("INVALID_MANDATE_MODE");
    }
    /* ── WAVE 25 / FE-1 — CHECK-SIZE RANGE VALIDATION AT THE SINK ───────────
     *
     * THE GAP. `checkMinMinor` and `checkMaxMinor` were collected by the tab,
     * forwarded by PUT /api/partner/me/spv/:spvId/mandate, and written to
     * `spv_mandate` by this function without ANY comparison between them and
     * without any type or range check at all. `min = 100000, max = 100` was a
     * persistable mandate. So was a negative bound, a float, and a NaN.
     *
     * FIX WHERE THE DATA FLOWS. This function is the single sink: every write
     * to `spv_mandate` in the tree goes through the one `persist("spv_mandate",
     * …)` call below. The client-side check added in SpvDetailTabs.tsx is a
     * courtesy that saves a round trip; it is NOT the gate, because the route
     * is a second door that any API client can walk through. */
    const bound = (v: number | null | undefined, code: string): number | null => {
      if (v === undefined || v === null) return null;
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Error(code);
      return v;
    };
    const checkMinMinor = bound(data.checkMinMinor, "INVALID_CHECK_MIN");
    const checkMaxMinor = bound(data.checkMaxMinor, "INVALID_CHECK_MAX");
    if (checkMinMinor !== null && checkMaxMinor !== null && checkMinMinor > checkMaxMinor) {
      throw new Error("INVALID_CHECK_RANGE");
    }
    const now = nowIso();
    const m: SpvMandateDTO = {
      id: newId("spvmnd"),
      spvId,
      mode,
      ruleTree: data.ruleTree,
      geography: data.geography ?? [],
      sector: data.sector ?? [],
      companyIds: data.companyIds ?? [],
      stage: data.stage ?? [],
      checkMinMinor,
      checkMaxMinor,
      updatedAt: now,
      revisionHash: "",
    };
    const { prev, curr } = chain("spv_mandate", { ...m, revisionHash: undefined });
    m.revisionHash = curr;
    persist(
      "spv_mandate",
      `INSERT INTO spv_mandate (id, spv_id, mode, rule_tree_json, geography_json, sector_json,
         company_ids_json, stage_json, check_min_minor, check_max_minor, created_at, updated_at,
         updated_by, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        m.id, spvId, mode, JSON.stringify(m.ruleTree), JSON.stringify(m.geography),
        JSON.stringify(m.sector), JSON.stringify(m.companyIds), JSON.stringify(m.stage),
        m.checkMinMinor, m.checkMaxMinor, now, now, actor ?? null, prev, curr,
      ],
    );
    mandateBySpv.set(spvId, m);
    emit("spv.mandate_set", spvId, { partnerId, spvId, mode });
    return m;
  },

  getMandate(partnerId: string, spvId: string): SpvMandateDTO | null {
    if (!this.getSpv(partnerId, spvId)) return null;
    return mandateBySpv.get(spvId) ?? null;
  },

  /** Fail-closed eligibility: a company is eligible ONLY when it is an active
   *  PAID Capavate subscriber AND has a valid M&A-intelligence profile AND has
   *  an active round AND satisfies the mandate rule tree. Missing any → excluded
   *  (never matched on a null). */
  isCompanyEligible(partnerId: string, spvId: string, companyId: string): { eligible: boolean; reasons: string[] } {
    const s = this.getSpv(partnerId, spvId);
    if (!s) return { eligible: false, reasons: ["SPV_NOT_FOUND"] };
    const mandate = mandateBySpv.get(spvId);
    if (!mandate) return { eligible: false, reasons: ["NO_MANDATE"] };
    const facts = resolveCompanyFacts(companyId);
    const reasons: string[] = [];
    if (!facts.paidSubscriber) reasons.push("NOT_PAID_SUBSCRIBER");
    if (!facts.hasMaProfile) reasons.push("NO_MA_PROFILE");
    if (!facts.hasActiveRound) reasons.push("NO_ACTIVE_ROUND");
    if (mandate.mode === "deal_specific") {
      if (!mandate.companyIds.includes(companyId)) reasons.push("NOT_IN_DEAL_LIST");
    } else if (!nodeMatches(mandate.ruleTree, facts)) {
      reasons.push("MANDATE_NO_MATCH");
    }
    return { eligible: reasons.length === 0, reasons };
  },

  /** Evaluate a set of candidate companies (used by re-evaluate-on-change). */
  evaluateEligibleCompanies(partnerId: string, spvId: string, companyIds: string[]): string[] {
    return companyIds.filter((c) => this.isCompanyEligible(partnerId, spvId, c).eligible);
  },

  /* ---- Fees (two-layer, effective-dated) ---- */
  addFee(
    partnerId: string,
    spvId: string,
    data: { layer: string; feeType: string; fixedAmountMinor?: number | null; carryPct?: number | null; currency?: string; effectiveDate?: string },
    actor: string,
    opts: {
      adminPlatform?: boolean;
      /* WAVE 3F / ITEM 3 (owner ruling A-16) — TEST-ONLY seeding escape for the
       * cross-layer combined-carry block, and for NOTHING else. Every other
       * validation below still runs. A-16 requires PERSIST-5/PERSIST-6 to keep
       * asserting, byte-for-byte, that the DISTRIBUTION SINK rejects 0.6 + 0.6;
       * once the config layer blocks that state it can no longer be reached
       * through the config API, so the test must seed it directly at store
       * level. Hard-refused under NODE_ENV=production (see the check in the
       * cap block) so it can never be a production bypass, and no route ever
       * passes it. */
      __unsafeSeedOverCapForTests?: boolean;
    } = {},
  ): SpvFeeDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    if (!isSpvFeeLayer(data.layer)) throw new Error("INVALID_FEE_LAYER");
    if (!isSpvFeeType(data.feeType)) throw new Error("INVALID_FEE_TYPE");
    // Platform-layer fees are Capavate-admin-only, read-only to the GP.
    if (data.layer === "platform" && !opts.adminPlatform) throw new Error("PLATFORM_FEE_ADMIN_ONLY");
    if (data.feeType !== "carry" && (data.fixedAmountMinor == null || data.fixedAmountMinor < 0)) {
      throw new Error("FIXED_AMOUNT_REQUIRED");
    }
    if (data.feeType !== "fixed" && (data.carryPct == null || data.carryPct < 0 || data.carryPct > 1)) {
      throw new Error("CARRY_PCT_REQUIRED");
    }
    /* ── WAVE 5 / P-8 — CROSS-LAYER COMBINED-CARRY CAP AT THE SET-TIME SINK (DEF-069).
     *
     * THE GAP. The check immediately above validates ONE layer in isolation:
     * management carry <= 1 and platform carry <= 1, each on its own. Nothing
     * here ever looked at the OTHER layer. So a GP could set a 0.9 management
     * carry through POST /api/partner/me/spv/:spvId/fees (spvEngineRoutes.ts:321)
     * and a Capavate admin could set a 0.2 platform carry through the
     * admin-platform route (spvEngineRoutes.ts:902) — both individually legal,
     * combining to 110% carry — and BOTH ROWS PERSISTED. The combined cap was
     * enforced only later, inside recordDistribution (~:1644), by which time the
     * SPV has been launched, marketed and subscribed on terms that are
     * arithmetically impossible to honour. The first anyone learns of it is a
     * COMBINED_CARRY_EXCEEDS_CAP thrown at the moment LPs expect to be paid.
     *
     * THE SINK. This function is the ONLY writer of the `spv_fee` table
     * (verified: the sole `INSERT INTO spv_fee` in the tree is at :637 below,
     * inside this function) and both fee routes funnel through it, so a check
     * placed here cannot be bypassed by the admin route or the partner route.
     *
     * EXACTNESS. Same discipline as the distribution sink: the cap is resolved
     * from `spv_carry_cap_policy` (DB-driven, fail-closed, most-specific scope
     * wins) and the comparison is exact fixed-scale BigInt via
     * `exactFractionToCarryScaled`. It is NOT a float sum, so
     * 0.5000000000000001 + 0.5 REJECTS here exactly as it rejects at
     * distribution time, instead of quietly summing to 1 in binary double.
     *
     * DELIBERATE NON-CHANGE. The item text suggests widening the per-layer carry
     * clamp from [0,1] to [0,100]. That is REFUSED. It contradicts the owner
     * percent ruling (P-0: percentages are stored as FRACTIONS) and would
     * reintroduce exactly the 1%-vs-100% ambiguity that ruling exists to remove
     * — a stored 1 would become unreadable as either. The real defect in P-8 is
     * the MISSING CROSS-LAYER CHECK, which is what is fixed here. Recorded, not
     * dropped: see WAVE5_REPORT.md.
     *
     * FAIL-CLOSED, WITH ONE NARROW EXCEPTION. If no cap policy row applies,
     * resolveCombinedCarryCapScaled throws COMBINED_CARRY_CAP_POLICY_MISSING and
     * the fee is not written. That is intended. The exception is a
     * fee-store-unavailable condition (Postgres backend), which is rethrown
     * unchanged rather than being converted into a false "over cap". */
    let combinedCarryOverCap = false;
    if (data.feeType !== "fixed" && (data.carryPct ?? 0) > 0) {
      try {
        const otherLayer = data.layer === "platform" ? "management" : "platform";
        const other = this.effectiveFee(spvId, otherLayer as "management" | "platform", data.effectiveDate ?? nowIso());
        const otherCarry = other && other.feeType !== "fixed" ? (other.carryPct ?? 0) : 0;
        const capScaled = BigInt(resolveCombinedCarryCapScaled({ tenantId: s.sponsorPartnerId, spvId }));
        const thisScaled = exactFractionToCarryScaled(data.carryPct ?? 0, "carryPct");
        const otherScaled = exactFractionToCarryScaled(otherCarry, `${otherLayer}CarryFraction`);
        combinedCarryOverCap = thisScaled + otherScaled > capScaled;
      } catch (capErr) {
        /* A missing cap policy (COMBINED_CARRY_CAP_POLICY_MISSING) or an
         * unavailable fee store must not turn a legal fee write into a failure
         * HERE — the authoritative fail-closed rejection still happens at the
         * distribution sink, which is where the money actually moves. */
        log.warn("[spvEngineStore] combined-carry pre-check unavailable:", (capErr as Error).message);
      }
      if (combinedCarryOverCap) {
        /* ═══ WAVE 3F / ITEM 3 — OWNER RULING A-16, INTEGRATED. BLOCKING. ═══
         *
         * WHAT THIS USED TO DO. Wave 5 detected the over-cap stack here, wrote
         * a log line ("The fee is written") and let the write through, because
         * blocking regressed pinned test PERSIST-5, which deliberately
         * CONFIGURES 0.6 + 0.6 through the routes so it can prove the
         * DISTRIBUTION writer rejects the combination. Backing out was the
         * right call with the information Wave 5 had.
         *
         * THE RULING (build_log/ASSUMPTIONS_AND_DELTA.md, A-16):
         *   • enforce at CONFIG time — an admin must never be able to SAVE
         *     0.6 + 0.6 (this throw);
         *   • keep enforcement at the DISTRIBUTION SINK, unchanged — the sink
         *     is the layer that protects money, and it is untouched
         *     (recordDistribution still resolves the same DB-driven cap with
         *     the same exact BigInt comparison and still throws
         *     COMBINED_CARRY_EXCEEDS_CAP);
         *   • adapt only the SETUP of the pinned tests, never their assertions.
         *
         * Defence in depth at BOTH layers: this throw is strictly additional.
         * Deleting it does not open the money hole — the sink still refuses —
         * but it does let a GP launch, market and subscribe an SPV on terms
         * that are arithmetically impossible to honour, which is the actual
         * P-8 defect.
         *
         * Same error name as the sink (COMBINED_CARRY_EXCEEDS_CAP), already
         * mapped to 400 in server/spvEngineRoutes.ts, so both fee routes now
         * refuse with a 4xx instead of persisting a stack that can never pay
         * out.
         *
         * THE ONLY WAY PAST IT is `opts.__unsafeSeedOverCapForTests`, which is
         * refused outright under NODE_ENV=production and is passed by no route
         * anywhere in the tree (`grep -rn "__unsafeSeedOverCapForTests"
         * server/*Routes.ts` → no match). It exists solely so PERSIST-5 and
         * PERSIST-6 can seed the illegal state at store level and keep proving
         * the sink, exactly as A-16 requires. */
        if (!opts.__unsafeSeedOverCapForTests) throw new Error("COMBINED_CARRY_EXCEEDS_CAP");
        if (process.env.NODE_ENV === "production") throw new Error("COMBINED_CARRY_EXCEEDS_CAP");
        log.warn(
          `[spvEngineStore] WAVE 3F — over-cap carry SEEDED at store level under ` +
            `__unsafeSeedOverCapForTests (NODE_ENV=${process.env.NODE_ENV ?? "undefined"}): spv=${spvId} ` +
            `layer=${data.layer} carryPct=${data.carryPct}. The distribution sink WILL refuse to pay out ` +
            `on this stack (COMBINED_CARRY_EXCEEDS_CAP). This path is unreachable in production and from every route.`,
        );
      }
    }
    // W2-F — fail-closed guard: a fixed/absolute fee may never exceed the SPV's
    // target raise (the "$33 fee on a $30 raise" bug). Only enforced when a
    // positive target raise is set; skipped for pure-carry fees and when the
    // raise is unknown (null) or zero.
    if (
      data.feeType !== "carry" &&
      typeof s.targetRaiseMinor === "number" &&
      s.targetRaiseMinor > 0 &&
      (data.fixedAmountMinor ?? 0) > s.targetRaiseMinor
    ) {
      throw new Error("FEES_EXCEED_RAISE");
    }
    const now = nowIso();
    const f: SpvFeeDTO = {
      id: newId("spvfee"),
      spvId,
      layer: data.layer,
      feeType: data.feeType,
      fixedAmountMinor: data.fixedAmountMinor ?? null,
      carryPct: data.carryPct ?? null,
      currency: data.currency ?? s.currency,
      effectiveDate: data.effectiveDate ?? now,
      setBy: actor ?? null,
      createdAt: now,
      revisionHash: "",
    };
    const { prev, curr } = chain("spv_fee", { ...f, revisionHash: undefined });
    f.revisionHash = curr;
    persist(
      "spv_fee",
      `INSERT INTO spv_fee (id, spv_id, layer, fee_type, fixed_amount_minor, carry_pct, currency,
         effective_date, set_by, created_at, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [f.id, spvId, f.layer, f.feeType, f.fixedAmountMinor, f.carryPct, f.currency, f.effectiveDate, f.setBy, now, prev, curr],
    );
    pushInto(feesBySpv, spvId, f);
    // P-8 — the cross-layer verdict rides on the existing event so the
    // misconfiguration is observable by every consumer, not just the log.
    emit("spv.fee_set", spvId, { partnerId, spvId, layer: f.layer, feeType: f.feeType, effectiveDate: f.effectiveDate, combinedCarryOverCap });
    return f;
  },

  listFees(partnerId: string, spvId: string): SpvFeeDTO[] {
    if (!this.getSpv(partnerId, spvId)) return [];
    return (feesBySpv.get(spvId) ?? []).slice();
  },

  /** The fee in effect for a layer at `asOf` (latest effective_date ≤ asOf). */
  effectiveFee(spvId: string, layer: "management" | "platform", asOf?: string): SpvFeeDTO | null {
    const at = asOf ?? nowIso();
    const candidates = (feesBySpv.get(spvId) ?? []).filter((f) => f.layer === layer && f.effectiveDate <= at);
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1))[0];
  },

  /* ══ WAVE 26 / S-3 SECOND PATH — ONE predicate for "the fee view cannot be trusted". ══
   *
   * Wave 5 put this reasoning inline inside `hasUnsettledFixedFees` and nowhere
   * else. That closed the FEES_UNPAID gate but left FOUR other functions —
   * `feeBreakdown`, `previewDistributionSplit`, `recordDistribution` and
   * `accrueFundingFeeObligations` — reading the very same `feesBySpv` map with
   * no idea whether it had ever been loaded. On a failed `spv_fee` hydration
   * they do not fail; they succeed with the fees SILENTLY SET TO ZERO.
   *
   * It is extracted rather than copied so the two-part rule (durable verdict,
   * then a DB probe to disambiguate 'never_run') has exactly one implementation.
   * A second copy is how the poles drift apart.
   *
   * The probe half is load-bearing, not defensive: 'never_run' also covers a
   * process that populated `feesBySpv` through `addFee` (row and map in one
   * transaction) and never needed a boot hydration. Treating that as untrusted
   * would wedge every fee surface shut for correctly-configured SPVs — the
   * opposite failure, and still a silent loss of working functionality. */
  feeViewUnreliable(spvId: string): boolean {
    if (!feeStateUnknown()) return false;
    const probe = probeFeeRowCount(spvId);
    if (!probe.ok) return true; // fee table unreadable — the strongest reason to stay shut
    return probe.count > (feesBySpv.get(spvId)?.length ?? 0); // memory is incomplete
  },

  /** Plain-language breakdown shown to an investor (commitment / mgmt / platform / net). */
  feeBreakdown(spvId: string, commitmentMinor: number, currency: string, asOf?: string): SpvFeeBreakdown {
    /* WAVE 26 / S-3 SECOND PATH — this is a MONEY SURFACE and it must not
       invent a zero. With `feesBySpv` empty, `effectiveFee` returns null for
       both layers, `mgmtFixed`/`platFixed` fall to 0 and `netDeployedMinor`
       becomes the WHOLE commitment: an investor is shown a fee-free SPV
       because a database read failed. Withhold the numbers instead. */
    if (this.feeViewUnreliable(spvId)) {
      return {
        commitmentMinor,
        managementFeeMinor: null,
        platformFeeMinor: null,
        netDeployedMinor: null,
        currency,
        managementCarryPct: null,
        platformCarryPct: null,
        feesUnknown: true,
      };
    }
    const mgmt = this.effectiveFee(spvId, "management", asOf);
    const plat = this.effectiveFee(spvId, "platform", asOf);
    const mgmtFixed = mgmt && mgmt.feeType !== "carry" ? (mgmt.fixedAmountMinor ?? 0) : 0;
    const platFixed = plat && plat.feeType !== "carry" ? (plat.fixedAmountMinor ?? 0) : 0;
    return {
      commitmentMinor,
      managementFeeMinor: mgmtFixed,
      platformFeeMinor: platFixed,
      netDeployedMinor: Math.max(0, commitmentMinor - mgmtFixed - platFixed),
      currency,
      managementCarryPct: mgmt && mgmt.feeType !== "fixed" ? mgmt.carryPct : null,
      platformCarryPct: plat && plat.feeType !== "fixed" ? plat.carryPct : null,
      feesUnknown: false,
    };
  },

  /* ---- Fee obligations (money-movement-safe fee timing, Blocker 3) ---- */
  _persistFeeObligation(o: SpvFeeObligationDTO): void {
    const { prev, curr } = chain("spv_fee_obligation", { ...o, revisionHash: undefined });
    o.revisionHash = curr;
    persist(
      "spv_fee_obligation",
      `INSERT INTO spv_fee_obligation (id, spv_id, layer, portion, timing, amount_minor, currency, state,
         payment_ref, distribution_id, waived_by, waived_reason, created_at, updated_at, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         state=excluded.state, payment_ref=excluded.payment_ref, waived_by=excluded.waived_by,
         waived_reason=excluded.waived_reason, updated_at=excluded.updated_at,
         prev_hash=excluded.prev_hash, curr_hash=excluded.curr_hash`,
      [o.id, o.spvId, o.layer, o.portion, o.timing, o.amountMinor, o.currency, o.state,
       o.paymentRef, o.distributionId, o.waivedBy, o.waivedReason, o.createdAt, o.updatedAt, prev, curr],
    );
  },

  /** Accrue the FIXED portions of fixed/hybrid management & platform fees as
   *  money-movement obligations AT FUNDING. Idempotent per (spv, layer): a
   *  second call never creates a duplicate. Returns the funding obligations. */
  accrueFundingFeeObligations(partnerId: string, spvId: string): SpvFeeObligationDTO[] {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    /* WAVE 26 / S-3 SECOND PATH. Accrual walks `effectiveFee` per layer and
       `continue`s on null. With an unloaded fee table that means it accrues
       NOTHING and returns an empty list — indistinguishable, to every caller,
       from "this SPV genuinely owes no funding fees". Refuse instead: an
       accrual run that silently skips every layer is worse than no run. */
    if (this.feeViewUnreliable(spvId)) throw new Error("FEE_STATE_UNKNOWN");
    const existing = feeObligationsBySpv.get(spvId) ?? [];
    const now = nowIso();
    for (const layer of ["management", "platform"] as const) {
      const fee = this.effectiveFee(spvId, layer);
      // Only fixed/hybrid fees have a fixed portion to collect at funding.
      if (!fee || fee.feeType === "carry") continue;
      const amt = fee.fixedAmountMinor ?? 0;
      if (amt <= 0) continue;
      const already = existing.find((o) => o.layer === layer && o.timing === "funding" && o.portion === "fixed");
      if (already) continue; // idempotent — never double-accrue
      const o: SpvFeeObligationDTO = {
        id: newId("spvfeeob"),
        spvId, layer, portion: "fixed", timing: "funding",
        amountMinor: amt, currency: fee.currency, state: "pending",
        paymentRef: null, distributionId: null, waivedBy: null, waivedReason: null,
        createdAt: now, updatedAt: now, revisionHash: "",
      };
      this._persistFeeObligation(o);
      pushInto(feeObligationsBySpv, spvId, o);
      emit("spv.fee_obligation_accrued", spvId, { partnerId, spvId, obligationId: o.id, layer, portion: "fixed", timing: "funding", amountMinor: amt });
    }
    return (feeObligationsBySpv.get(spvId) ?? []).filter((o) => o.timing === "funding");
  },

  listFeeObligations(partnerId: string, spvId: string): SpvFeeObligationDTO[] {
    if (!this.getSpv(partnerId, spvId)) return [];
    return (feeObligationsBySpv.get(spvId) ?? []).slice();
  },

  /** Blocker 3 (4D) — FAIL CLOSED keyed off CONFIG, not mere row existence. A
   *  fixed/hybrid fee CONFIG on a layer IMPLIES a mandatory funding obligation
   *  that must EXIST and be paid OR waived. This is unsettled when:
   *    - the expected obligation row is MISSING (config present, never accrued —
   *      e.g. the fee was configured AFTER the subscription already committed), OR
   *    - an accrued funding-fixed obligation is neither paid NOR waived.
   *  Used to FAIL CLOSED at subscription commit / deployment create+advance /
   *  cap-table ledger commit. */
  hasUnsettledFixedFees(partnerId: string, spvId: string): boolean {
    if (!this.getSpv(partnerId, spvId)) return true; // fail-closed
    /* WAVE 5 / S-3 — FAIL CLOSED ON AN UNKNOWN FEE TABLE.
     * Everything below reasons from `feesBySpv` / `effectiveFee`. If the
     * `spv_fee` hydration never succeeded, that table is EMPTY and every check
     * below vacuously passes — returning false and OPENING the FEES_UNPAID gate
     * at the cap-table commit route. An empty fee table because nothing loaded
     * is not the same as an empty fee table because nothing is owed, and only
     * the durable hydration verdict can tell the two apart. */
    /* WAVE 26 — this reasoning was inline here and ONLY here; it now lives in
     * `feeViewUnreliable` so the four fee-derived money paths share one
     * implementation. Behaviour at this call site is unchanged. */
    if (this.feeViewUnreliable(spvId)) return true;
    const obs = feeObligationsBySpv.get(spvId) ?? [];
    // Any accrued funding-fixed obligation that is not settled → unsettled.
    if (obs.some((o) => o.timing === "funding" && o.portion === "fixed" && o.state !== "paid" && o.state !== "waived")) {
      return true;
    }
    // A fixed/hybrid fee CONFIG with a positive fixed portion but NO settled
    // funding obligation covering it → unsettled (fail-closed, no bypass).
    for (const layer of ["management", "platform"] as const) {
      const fee = this.effectiveFee(spvId, layer);
      if (!fee || fee.feeType === "carry") continue; // carry has no fixed portion
      if ((fee.fixedAmountMinor ?? 0) <= 0) continue;
      const settled = obs.some(
        (o) => o.layer === layer && o.timing === "funding" && o.portion === "fixed" && (o.state === "paid" || o.state === "waived"),
      );
      if (!settled) return true;
    }
    return false;
  },

  /** Collect a fee obligation THROUGH the EXISTING payment ledger (deterministic
   *  intent id → no double charge). FAIL CLOSED: a non-succeeded charge marks
   *  the obligation failed and throws (never a silent pass).
   *
   *  WAVE 1A / S-2 — SINK 3 (was `outcome: "succeeded" | "failed" = "succeeded"`,
   *  a DEFAULT PARAMETER at :721). The outcome is no longer a value any caller
   *  may supply or omit: it is derived from an UNFORGEABLE authorization minted
   *  only by `server/lib/feeSettlementAuthority.ts` (gateway, or Capavate
   *  platform admin). `settlement` is REQUIRED and has NO DEFAULT — omitting it
   *  throws `SETTLEMENT_AUTHORIZATION_REQUIRED`, it does not succeed. */
  chargeFeeObligation(
    partnerId: string,
    spvId: string,
    obligationId: string,
    customerId: string,
    settlement: FeeSettlementAuthorization,
  ): SpvFeeObligationDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    const o = (feeObligationsBySpv.get(spvId) ?? []).find((x) => x.id === obligationId);
    if (!o) throw new Error("FEE_OBLIGATION_NOT_FOUND");
    if (o.state === "paid" || o.state === "waived") return o; // idempotent no-op
    // ── WAVE 3E — ONE TRANSACTION spans the CONSUME and the MONEY WRITE. ──
    //
    // Pre-3E the consume mutated a process-local WeakMap and the money write
    // followed it outside any transaction, so a crash in between could leave an
    // authorization spent with no settlement (or, after a restart, a settlement
    // whose authorization looked unspent). Consumption is now a conditional
    // UPDATE on `fee_settlement_authorization` (migration 0151) and it commits
    // together with the payment-ledger entry and the obligation row, or not at
    // all. `consumeSettlementAuthorization` REFUSES to run outside a transaction
    // (SETTLEMENT_AUTHORIZATION_NOT_TRANSACTIONAL), so this wrapper is not
    // optional and cannot be quietly dropped.
    //
    // The FAILED outcome is a settlement too, so it is written INSIDE the
    // transaction and the FEE_COLLECTION_FAILED throw is raised AFTER the commit
    // — otherwise a genuine recorded failure would roll back with its own error.
    // The in-memory projection must not survive a rolled-back transaction:
    // WAVE 3E rolls the DB back on any throw, so the RAM copy is restored to
    // exactly what it was. "ZERO in-memory canonical state" (file header) means
    // the Maps are a projection of the DB, and a projection may never be ahead
    // of it.
    const priorProjection = { state: o.state, paymentRef: o.paymentRef, updatedAt: o.updatedAt, revisionHash: o.revisionHash };
    let settled: { ok: boolean };
    try {
      settled = withSettlementTransaction((): { ok: boolean } => {
        // WAVE 1A / S-2 — the derivation. Verifies provenance (in-process brand,
        // defence in depth) AND the durable row: purpose, SPV binding, obligation
        // binding, amount binding, expiry, revocation and single use, in ONE
        // conditional UPDATE whose affected-row count must be exactly 1. Throws on
        // anything a partner could have constructed. Nothing below this line can
        // reach `paid` without it.
        const { outcome } = consumeSettlementAuthorization(settlement, {
          purpose: o.portion === "carry" ? "distribution_carry" : "fee_obligation",
          spvId,
          obligationId,
          amountMinor: o.amountMinor,
          currency: o.currency,
        });
        let entryState: string;
        let entryId: string;
        try {
          const result = chargeOrIdempotent({
            intentId: `spvfee_${o.id}`,
            kind: "company_billing",
            amountCents: o.amountMinor,
            currency: o.currency,
            customerId: customerId || s.sponsorPartnerId,
            description: `SPV ${o.layer} ${o.portion} fee (${o.timing})`,
            // WAVE 1A / S-2 — SINK 1b, THE DERIVATION SITE (:738). `outcome` is now a
            // local const produced by `consumeSettlementAuthorization` above; it can
            // no longer be a caller-chosen parameter value.
            forceState: outcome,
          });
          entryState = result.entry.state;
          entryId = result.entry.id;
        } catch {
          o.state = "failed"; o.updatedAt = nowIso();
          this._persistFeeObligation(o);
          return { ok: false };
        }
        // WAVE 1A / S-2 — SINK 4 (was `entryState !== "succeeded" && entryState !==
        // "demo"`). `"demo"` is the paymentStore default (paymentStore.ts:127) written
        // straight to `state` at :214; accepting it meant an unsettled demo entry
        // resolved to `paid`. Only a genuine "succeeded" ledger entry settles now.
        if (entryState !== "succeeded") {
          o.state = "failed"; o.paymentRef = entryId; o.updatedAt = nowIso();
          this._persistFeeObligation(o);
          return { ok: false };
        }
        // WAVE 1A / S-2 — SINK 5: the ONE AND ONLY assignment of `state = "paid"` in
        // this object graph (`grep -rn 'state = "paid"' server/` → this line alone).
        // It is now gated behind `consumeSettlementAuthorization` above, in the same
        // transaction as the consume.
        o.state = "paid"; o.paymentRef = entryId; o.updatedAt = nowIso();
        this._persistFeeObligation(o);
        return { ok: true };
      });
    } catch (e) {
      // The transaction rolled back. Undo the RAM projection so it cannot claim
      // a state the database does not hold, then re-throw unchanged.
      o.state = priorProjection.state;
      o.paymentRef = priorProjection.paymentRef;
      o.updatedAt = priorProjection.updatedAt;
      o.revisionHash = priorProjection.revisionHash;
      throw e;
    }
    if (!settled.ok) throw new Error("FEE_COLLECTION_FAILED");
    emit("spv.fee_obligation_paid", spvId, { partnerId, spvId, obligationId: o.id, paymentRef: o.paymentRef });
    return o;
  },

  /** Admin-only waive (route enforces admin). Clears the fail-closed block. */
  waiveFeeObligation(partnerId: string, spvId: string, obligationId: string, adminUserId: string, reason: string): SpvFeeObligationDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    const o = (feeObligationsBySpv.get(spvId) ?? []).find((x) => x.id === obligationId);
    if (!o) throw new Error("FEE_OBLIGATION_NOT_FOUND");
    o.state = "waived"; o.waivedBy = adminUserId ?? null; o.waivedReason = reason ?? null; o.updatedAt = nowIso();
    this._persistFeeObligation(o);
    emit("spv.fee_obligation_waived", spvId, { partnerId, spvId, obligationId: o.id, waivedBy: o.waivedBy });
    return o;
  },

  /** Accrue + collect a CARRY portion obligation AT DISTRIBUTION with a recorded
   *  payment ref. FAIL CLOSED: a collection failure throws (the distribution
   *  aborts). Returns the paid obligation. Internal to recordDistribution. */
  _collectCarryObligation(
    partnerId: string,
    spvId: string,
    layer: "management" | "platform",
    amountMinor: number,
    currency: string,
    distributionId: string,
    settlement: FeeSettlementAuthorization,
  ): SpvFeeObligationDTO {
    const now = nowIso();
    const o: SpvFeeObligationDTO = {
      id: newId("spvfeeob"),
      spvId, layer, portion: "carry", timing: "distribution",
      amountMinor, currency, state: "pending",
      paymentRef: null, distributionId, waivedBy: null, waivedReason: null,
      createdAt: now, updatedAt: now, revisionHash: "",
    };
    this._persistFeeObligation(o);
    pushInto(feeObligationsBySpv, spvId, o);
    // Collect through the existing payment ledger; fail-closed on failure.
    // WAVE 1A / S-2 — SINK 2: this used to forward a route-supplied `outcome`
    // straight into chargeFeeObligation. It now forwards an authorization that
    // only the settlement authority can mint.
    return this.chargeFeeObligation(partnerId, spvId, o.id, spvId, settlement);
  },

  /* ---- Compliance profile (reusable, investor-level) ---- */
  getComplianceProfile(investorId: string): InvestorComplianceProfileDTO | null {
    if (!investorId) throw new Error("INVESTOR_ID_REQUIRED");
    return complianceByInvestor.get(investorId) ?? null;
  },

  upsertComplianceProfile(
    investorId: string,
    patch: Partial<Pick<InvestorComplianceProfileDTO, "kycStatus" | "kycVerifiedAt" | "kycExpiry" | "accreditationStatus" | "accreditationCertifiedAt" | "jurisdiction">>,
  ): InvestorComplianceProfileDTO {
    if (!investorId) throw new Error("INVESTOR_ID_REQUIRED");
    const now = nowIso();
    const existing = complianceByInvestor.get(investorId);
    const p: InvestorComplianceProfileDTO = {
      investorId,
      kycStatus: patch.kycStatus ?? existing?.kycStatus ?? "none",
      kycVerifiedAt: patch.kycVerifiedAt ?? existing?.kycVerifiedAt ?? null,
      kycExpiry: patch.kycExpiry ?? existing?.kycExpiry ?? null,
      accreditationStatus: patch.accreditationStatus ?? existing?.accreditationStatus ?? "none",
      accreditationCertifiedAt: patch.accreditationCertifiedAt ?? existing?.accreditationCertifiedAt ?? null,
      jurisdiction: patch.jurisdiction ?? existing?.jurisdiction ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const { prev, curr } = chain("investor_compliance_profile", { ...p });
    persist(
      "investor_compliance_profile",
      `INSERT INTO investor_compliance_profile (investor_id, kyc_status, kyc_verified_at, kyc_expiry,
         accreditation_status, accreditation_certified_at, jurisdiction, created_at, updated_at, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(investor_id) DO UPDATE SET
         kyc_status=excluded.kyc_status, kyc_verified_at=excluded.kyc_verified_at,
         kyc_expiry=excluded.kyc_expiry, accreditation_status=excluded.accreditation_status,
         accreditation_certified_at=excluded.accreditation_certified_at, jurisdiction=excluded.jurisdiction,
         updated_at=excluded.updated_at, prev_hash=excluded.prev_hash, curr_hash=excluded.curr_hash`,
      [p.investorId, p.kycStatus, p.kycVerifiedAt, p.kycExpiry, p.accreditationStatus, p.accreditationCertifiedAt, p.jurisdiction, p.createdAt, p.updatedAt, prev, curr],
    );
    complianceByInvestor.set(investorId, p);
    return p;
  },

  /** Gate status shown as "KYC ✓ · Accreditation ✓ · Sign to complete".
   *  Fail-closed-but-forgiving: unverified is flagged for manual review, not
   *  hard-blocked at the profile level (hard gate is enforced at commit). */
  gateStatus(investorId: string): { kyc: boolean; accreditation: boolean; needsReview: boolean } {
    const p = complianceByInvestor.get(investorId);
    const kyc = p?.kycStatus === "verified";
    const accreditation = p?.accreditationStatus === "self_certified" || p?.accreditationStatus === "verified";
    const needsReview = p?.kycStatus === "manual_review" || p?.accreditationStatus === "manual_review" || !p;
    return { kyc, accreditation, needsReview };
  },

  /* ---- Subscriptions (unified investment flow) ---- */
  subscribe(
    partnerId: string,
    spvId: string,
    data: { investorId: string; commitmentMinor: number; currency?: string; investorPersona?: string },
    actor: string,
  ): SpvSubscriptionDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    if (!data.investorId) throw new Error("INVESTOR_ID_REQUIRED");
    if (!Number.isFinite(data.commitmentMinor) || data.commitmentMinor <= 0) throw new Error("INVALID_COMMITMENT");
    if (s.minCheckMinor != null && data.commitmentMinor < s.minCheckMinor) throw new Error("BELOW_MIN_CHECK");
    // Wave C v3 (Opus/GPT-5 IDOR fix) — tenant isolation guard.
    // An investor already bound to a DIFFERENT partner (via an active subscription
    // on that partner's SPV OR an active partner_sourced_investors relationship)
    // cannot be subscribed here. A brand-new investor (no relationship anywhere)
    // or one already bound to THIS partner may proceed. This mirrors the W1 C1/C2
    // IDOR guard on the compliance routes; without it, a partner could bootstrap
    // access to another partner's LP by guessing the investor ID.
    try {
      // Wave C v3.1 (Opus v3 O1 fix): a DENY-side query must not include
      // grant-side narrowing predicates. Dropping `s.archived_at IS NULL`
      // means an investor is STILL considered bound to their partner even
      // after that partner archives the SPV they subscribed to. Otherwise
      // Partner B could archive their SPV and Partner A could then claim B's
      // investor. Only ss.status='withdrawn' is a genuine tenant-release
      // signal, so it remains as the sole exclusion.
      const boundElsewhere = rawDb().prepare(
        `SELECT 1 FROM (
           SELECT s.sponsor_partner_id AS partner_id
             FROM spv_subscription ss
             JOIN spv s ON s.id = ss.spv_id
            WHERE ss.investor_id = ?
              AND COALESCE(ss.status, '') <> 'withdrawn'
           UNION ALL
           SELECT partner_id FROM partner_sourced_investors
            WHERE investor_id = ?
              AND COALESCE(status, 'active') NOT IN ('revoked','deleted','inactive')
         ) rel
         WHERE rel.partner_id IS NOT NULL AND rel.partner_id <> ?
         LIMIT 1`,
      ).get(data.investorId, data.investorId, partnerId);
      if (boundElsewhere) throw new Error("INVESTOR_NOT_IN_PARTNER_TENANT");
    } catch (err) {
      // Only rethrow the explicit tenant error; DB probes that fail (e.g. table
      // missing) should NOT bypass the guard — fail closed by rethrowing.
      if ((err as Error).message === "INVESTOR_NOT_IN_PARTNER_TENANT") throw err;
      // Missing partner_sourced_investors table is possible (lazily created);
      // if the FIRST probe (spv_subscription) also failed the whole query
      // failed. Fail closed — refuse to subscribe rather than admit possibly-
      // cross-tenant investors.
      throw new Error("INVESTOR_TENANT_CHECK_FAILED");
    }
    // Enforce cap across existing committed + this commitment.
    if (s.capMinor != null) {
      const existing = (subsBySpv.get(spvId) ?? []).filter((x) => x.status !== "withdrawn").reduce((a, x) => a + x.commitmentMinor, 0);
      if (existing + data.commitmentMinor > s.capMinor) throw new Error("EXCEEDS_CAP");
    }
    const dup = (subsBySpv.get(spvId) ?? []).find((x) => x.investorId === data.investorId && x.status !== "withdrawn");
    if (dup) throw new Error("ALREADY_SUBSCRIBED");
    const now = nowIso();
    const sub: SpvSubscriptionDTO = {
      id: newId("spvsub"),
      spvId,
      investorId: data.investorId,
      investorPersona: (data.investorPersona as SpvSubscriptionDTO["investorPersona"]) ?? null,
      commitmentMinor: data.commitmentMinor,
      wiredMinor: 0,
      currency: data.currency ?? s.currency,
      status: "review",
      kycRef: null,
      accreditationRef: null,
      subscriptionDocRef: null,
      ownershipPct: null,
      createdAt: now,
      updatedAt: now,
      revisionHash: "",
    };
    this._persistSub(sub);
    pushInto(subsBySpv, spvId, sub);
    // Wave B v26.4.0-fix2 (Opus DEFECT-12 / BLOCK-C real fix, part 2) —
    // shadow-persist to the legacy `spv_commitments` table so the adapter
    // routes' /commitments GET/POST endpoints see this subscription. Legacy
    // shadowCommitmentFromLegacy expects a legacy SPV id; because
    // createSpv shadow-persisted the engine id AS the legacy id (line 350
    // above), we can pass spvId here directly.
    // Best-effort with structured logging — engine remains authoritative.
    // v26.4.0-fix3 (Opus NEW-1): use the STRICT variant so the commitment is
    // ALWAYS attributed to the SPV specified by `spvId`, never to a fallback
    // "most recent SPV for the partner". Parent-missing case is quarantined
    // via _quarantineOrphanSubscription (same pattern as shadowCommitmentToEngine).
    const committed = spvFundStore.shadowCommitmentFromLegacyStrict({
      legacyId: sub.id,
      legacySpvId: spvId,
      partnerId,
      lpUserId: sub.investorId,
      amountMinor: sub.commitmentMinor,
    });
    if (!committed) {
      log.warn?.(
        `[spvEngineStore] subscribe: legacy shadow-commitment returned null for subId=${sub.id} spvId=${spvId} lpUserId=${sub.investorId}. Quarantining for boot-time drain.`,
      );
      // Quarantine so the boot-time drain can retry once the parent legacy
      // row lands (e.g. after an intermediate deploy that didn't complete).
      const quarantined = _quarantineOrphanSubscription({
        legacyPositionId: sub.id,
        legacySpvId: spvId,
        partnerId,
        lpUserId: sub.investorId,
        amountMinor: sub.commitmentMinor,
      });
      if (!quarantined) {
        // Quarantine ALSO failed (Postgres, or DDL/upsert error). Engine
        // remains authoritative — the subscription lives in `spv_subscription`
        // and is visible via the engine's own read paths (KPI, /partner/spvs/
        // list, etc.). Only the legacy adapter surface is degraded until
        // Wave B.5 lands the direct-DB read migration.
        log.error?.({
          route: "spvEngineStore.subscribe",
          code: "LEGACY_MIRROR_FAILED",
          message: `subId=${sub.id} committed in engine but neither legacy mirror nor quarantine could persist. ` +
            `Engine read paths remain correct; legacy adapter reads for this subscription will 404 until manually reconciled.`,
        });
      }
    }
    emit("spv.subscription_created", spvId, { partnerId, spvId, subscriptionId: sub.id, investorId: sub.investorId });
    return sub;
  },

  /** Advance the shared flow: review→soft_circled→founder_confirmed→wire_funded→committed.
   *  Gates 2 & 3 (accreditation + subscription e-sign) are enforced ONLY at the
   *  actual commitment transition (fail-closed at commit). */
  advanceSubscription(
    partnerId: string,
    spvId: string,
    subscriptionId: string,
    to: SpvSubscriptionStatus,
    data: { wiredMinor?: number; kycRef?: string; accreditationRef?: string; subscriptionDocRef?: string } = {},
  ): SpvSubscriptionDTO {
    if (!this.getSpv(partnerId, spvId)) throw new Error("SPV_NOT_FOUND");
    const sub = (subsBySpv.get(spvId) ?? []).find((x) => x.id === subscriptionId);
    if (!sub) throw new Error("SUBSCRIPTION_NOT_FOUND");
    if (data.kycRef !== undefined) sub.kycRef = data.kycRef;
    if (data.accreditationRef !== undefined) sub.accreditationRef = data.accreditationRef;
    if (data.subscriptionDocRef !== undefined) sub.subscriptionDocRef = data.subscriptionDocRef;
    if (data.wiredMinor !== undefined) sub.wiredMinor = data.wiredMinor;
    // Blocker 3 — at FUNDING, accrue the FIXED portions of fixed/hybrid fees as
    // money-movement obligations (idempotent) so they can be collected before
    // the SPV is allowed to commit or deploy.
    if (to === "wire_funded") this.accrueFundingFeeObligations(partnerId, spvId);
    if (to === "committed") {
      // Gate 1 KYC (reusable), Gate 2 accreditation, Gate 3 e-sign — all required.
      const gates = this.gateStatus(sub.investorId);
      if (!gates.kyc) throw new Error("GATE_KYC_REQUIRED");
      if (!gates.accreditation) throw new Error("GATE_ACCREDITATION_REQUIRED");
      if (!sub.subscriptionDocRef) throw new Error("GATE_SUBSCRIPTION_ESIGN_REQUIRED");
      // Blocker 3 — FAIL CLOSED: no commitment while a fixed fee is unpaid AND
      // not admin-waived.
      if (this.hasUnsettledFixedFees(partnerId, spvId)) throw new Error("FEES_UNPAID");
    }
    sub.status = to;
    sub.updatedAt = nowIso();
    this._persistSub(sub);
    emit("spv.subscription_advanced", spvId, { partnerId, spvId, subscriptionId, to });
    return sub;
  },

  /** B3 — PROJECTION of an authoritative LP cap-table commit.
   *
   *  The `commitFunded` ledger line (written at the route layer with
   *  companyId=spv.id) is the SINGLE source of truth for an LP's committed
   *  capital. This method merely projects that fact onto the SPV subscription
   *  roster so the GP surface reflects it: it finds the LP's existing non-
   *  withdrawn subscription (or creates one) and sets it to the terminal
   *  `committed` state. It deliberately does NOT re-run the subscribe() money
   *  gates (KYC / accreditation / e-sign / cap / min-check / dup) — those guard
   *  the on-platform subscription flow, whereas this reflects a commit the
   *  ledger has ALREADY recorded. Idempotent: re-projecting the same LP just
   *  refreshes the existing row (never a duplicate). */
  projectLpCommitted(
    partnerId: string,
    spvId: string,
    data: { investorId: string; commitmentMinor: number; currency?: string; investorPersona?: string },
  ): SpvSubscriptionDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    if (!data.investorId) throw new Error("INVESTOR_ID_REQUIRED");
    const now = nowIso();
    const existing = (subsBySpv.get(spvId) ?? []).find((x) => x.investorId === data.investorId && x.status !== "withdrawn");
    if (existing) {
      if (Number.isFinite(data.commitmentMinor) && data.commitmentMinor > 0) existing.commitmentMinor = data.commitmentMinor;
      existing.status = "committed";
      existing.updatedAt = now;
      this._persistSub(existing);
      emit("spv.lp_committed", spvId, { partnerId, spvId, subscriptionId: existing.id, investorId: existing.investorId, projected: true });
      return existing;
    }
    const sub: SpvSubscriptionDTO = {
      id: newId("spvsub"),
      spvId,
      investorId: data.investorId,
      investorPersona: (data.investorPersona as SpvSubscriptionDTO["investorPersona"]) ?? null,
      commitmentMinor: Number.isFinite(data.commitmentMinor) && data.commitmentMinor > 0 ? data.commitmentMinor : 0,
      wiredMinor: 0,
      currency: data.currency ?? s.currency,
      status: "committed",
      kycRef: null,
      accreditationRef: null,
      subscriptionDocRef: null,
      ownershipPct: null,
      createdAt: now,
      updatedAt: now,
      revisionHash: "",
    };
    this._persistSub(sub);
    pushInto(subsBySpv, spvId, sub);
    emit("spv.lp_committed", spvId, { partnerId, spvId, subscriptionId: sub.id, investorId: sub.investorId, projected: true });
    return sub;
  },

  listSubscriptions(partnerId: string, spvId: string): SpvSubscriptionDTO[] {
    if (!this.getSpv(partnerId, spvId)) return [];
    return (subsBySpv.get(spvId) ?? []).slice();
  },

  /**
   * W1 C1/C2 (v26.2.0) — IDOR guard for the investor-level compliance routes.
   * A partner may read/write an investor's reusable compliance profile ONLY if
   * the investor has a durable relationship to that partner:
   *   (1) a non-withdrawn spv_subscription on an SPV the partner sponsors, OR
   *   (2) an active partner_sourced_investors row for (partner_id, investor_id).
   * Fail CLOSED on any error/missing table. Each DB probe is independently
   * try/caught so that a missing secondary table (partner_sourced_investors is
   * created lazily in partnerConsortiumRoutes) never suppresses the primary
   * SPV-roster check, and an in-memory fallback covers un-hydrated DB rows.
   */
  partnerCanAccessInvestorCompliance(partnerId: string, investorId: string): boolean {
    if (!partnerId || !investorId) return false;
    // (1) Canonical SPV LP roster — investor subscribed to a partner-sponsored SPV.
    try {
      const sub = rawDb().prepare(
        `SELECT 1
           FROM spv_subscription ss
           JOIN spv s ON s.id = ss.spv_id
          WHERE s.sponsor_partner_id = ?
            AND ss.investor_id = ?
            AND COALESCE(ss.status, '') <> 'withdrawn'
            AND s.archived_at IS NULL
          LIMIT 1`,
      ).get(partnerId, investorId);
      if (sub) return true;
    } catch { /* fail closed on this probe; try the next source */ }

    // (2) Explicit partner-sourced investor relationship (table is lazily created).
    try {
      const sourced = rawDb().prepare(
        `SELECT 1
           FROM partner_sourced_investors
          WHERE partner_id = ?
            AND investor_id = ?
            AND COALESCE(status, 'active') NOT IN ('revoked', 'deleted', 'inactive')
          LIMIT 1`,
      ).get(partnerId, investorId);
      if (sourced) return true;
    } catch { /* table may not exist yet; fall through */ }

    // (3) In-memory fallback if DB rows are not hydrated yet; fail closed on error.
    try {
      for (const s of this.listByPartner(partnerId)) {
        if ((this.listSubscriptions(partnerId, s.id) ?? []).some(
          (sub) => sub.investorId === investorId && sub.status !== "withdrawn",
        )) {
          return true;
        }
      }
    } catch { /* fail closed */ }
    return false;
  },

  _persistSub(sub: SpvSubscriptionDTO): void {
    const { prev, curr } = chain("spv_subscription", { ...sub, revisionHash: undefined });
    sub.revisionHash = curr;
    // Wave B v26.4.0-fix (BLOCK-I part 1) — include commitment_minor and
    // currency in the DO UPDATE SET clause so a re-persist with different
    // amount/currency actually updates the row. Prior implementation only
    // updated wired_minor/status/kyc/accreditation/etc., silently leaving
    // commitment_minor and currency stale on any legitimate top-up path.
    persist(
      "spv_subscription",
      `INSERT INTO spv_subscription (id, spv_id, investor_id, investor_persona, commitment_minor,
         wired_minor, currency, status, kyc_ref, accreditation_ref, subscription_doc_ref, ownership_pct,
         created_at, updated_at, updated_by, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         commitment_minor=excluded.commitment_minor, wired_minor=excluded.wired_minor,
         currency=excluded.currency, status=excluded.status, kyc_ref=excluded.kyc_ref,
         accreditation_ref=excluded.accreditation_ref, subscription_doc_ref=excluded.subscription_doc_ref,
         ownership_pct=excluded.ownership_pct, updated_at=excluded.updated_at,
         prev_hash=excluded.prev_hash, curr_hash=excluded.curr_hash`,
      [sub.id, sub.spvId, sub.investorId, sub.investorPersona, sub.commitmentMinor, sub.wiredMinor,
       sub.currency, sub.status, sub.kycRef, sub.accreditationRef, sub.subscriptionDocRef, sub.ownershipPct,
       sub.createdAt, sub.updatedAt, null, prev, curr],
    );
  },

  /** Investor register / beneficial ownership: per-LP position + %. */
  /** ALL-subscriptions view (every non-withdrawn sub, any stage). Used for
   *  display/beneficial-ownership listings — NOT for money gates. */
  investorRegister(partnerId: string, spvId: string): Array<{ investorId: string; commitmentMinor: number; ownershipPct: number }> {
    if (!this.getSpv(partnerId, spvId)) return [];
    const subs = (subsBySpv.get(spvId) ?? []).filter((x) => x.status !== "withdrawn");
    const total = subs.reduce((a, x) => a + x.commitmentMinor, 0);
    return subs.map((x) => ({
      investorId: x.investorId,
      commitmentMinor: x.commitmentMinor,
      ownershipPct: total > 0 ? x.commitmentMinor / total : 0,
    }));
  },

  /** Blocker 4 (4D) — COMMITTED-only LP register. ONLY subscriptions that have
   *  reached the terminal `committed` state count as real capital. Review /
   *  soft-circled / founder-confirmed / wire-funded-but-uncommitted subs are
   *  EXCLUDED. Ownership % is computed over committed capital ONLY. This is the
   *  register used for deployment readiness and distribution allocation, so an
   *  uncommitted subscription can NEVER satisfy a money gate or receive a
   *  distribution (fail-closed on state, not mere row existence). */
  committedRegister(partnerId: string, spvId: string): Array<{ investorId: string; commitmentMinor: number; ownershipPct: number }> {
    if (!this.getSpv(partnerId, spvId)) return [];
    const subs = (subsBySpv.get(spvId) ?? []).filter((x) => x.status === "committed");
    const total = subs.reduce((a, x) => a + x.commitmentMinor, 0);
    return subs.map((x) => ({
      investorId: x.investorId,
      commitmentMinor: x.commitmentMinor,
      ownershipPct: total > 0 ? x.commitmentMinor / total : 0,
    }));
  },

  /**
   * LP-context roster (Phase-4B / decision #5). FAIL-CLOSED SERVER-SIDE:
   *   - the viewer MUST be an LP (a non-withdrawn subscriber) of this SPV;
   *     any non-subscriber (incl. the founder/target) is refused with
   *     NOT_AN_LP — the founder NEVER sees the LP roster in EITHER mode;
   *   - an LP ALWAYS sees their own position;
   *   - co-investors' identities+commitments are included ONLY when
   *     spv.lpVisibility === 'co_investors'. Otherwise they are omitted here
   *     (never sent to the client and hidden there).
   * Lookup is NOT partner-scoped (the LP is not the sponsoring GP) but is
   * gated by subscriber membership, so cross-SPV leakage is impossible.
   */
  lpRosterForViewer(
    spvId: string,
    viewerInvestorId: string,
  ): {
    spvId: string;
    lpVisibility: SpvLpVisibility;
    viewerInvestorId: string;
    entries: Array<{ investorId: string; commitmentMinor: number; ownershipPct: number; isSelf: boolean }>;
  } {
    const s = spvById.get(spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    const subs = (subsBySpv.get(spvId) ?? []).filter((x) => x.status !== "withdrawn");
    const total = subs.reduce((a, x) => a + x.commitmentMinor, 0);
    const own = subs.find((x) => x.investorId === viewerInvestorId);
    if (!own) throw new Error("NOT_AN_LP"); // fail-closed: only actual LPs get a roster
    const visible = s.lpVisibility === "co_investors" ? subs : [own];
    return {
      spvId,
      lpVisibility: s.lpVisibility,
      viewerInvestorId,
      entries: visible.map((x) => ({
        investorId: x.investorId,
        commitmentMinor: x.commitmentMinor,
        ownershipPct: total > 0 ? x.commitmentMinor / total : 0,
        isSelf: x.investorId === viewerInvestorId,
      })),
    };
  },

  /* ---- Deployment (single cap-table ledger line via route layer) ---- */
  /** Blocker 5 — fail-closed readiness before a deployment money path opens.
   *  Returns the instrument SOURCED from the canonical round profile. Throws on
   *  any missing precondition. */
  _assertDeploymentReadiness(partnerId: string, spvId: string, companyId: string, companyRoundId: string, amountMinor: number): string {
    // 1. Mandate + full fail-closed eligibility (paid subscriber + M&A profile +
    //    active round + mandate match). No mandate → NO_MANDATE.
    if (!mandateBySpv.get(spvId)) throw new Error("NO_MANDATE");
    const elig = this.isCompanyEligible(partnerId, spvId, companyId);
    if (!elig.eligible) throw new Error("COMPANY_NOT_ELIGIBLE");
    // 2. An ACTIVE canonical round MATCHING companyRoundId (not just any active
    //    round for the company).
    const round = getRoundsForCompany(companyId).find((r) => r.id === companyRoundId);
    if (!round || !ACTIVE_LIVE_ROUND_STATES.has(String(round.state ?? "").toLowerCase())) {
      throw new Error("NO_ACTIVE_ROUND");
    }
    // 3. COMMITTED LP capital MUST cover the deployment amount. Blocker 4 (4D):
    //    only terminal `committed` subscriptions count — a raw review / soft-
    //    circled / wire-funded-but-uncommitted sub can NEVER satisfy this gate.
    const committedCapital = this.committedRegister(partnerId, spvId).reduce((a, r) => a + r.commitmentMinor, 0);
    if (committedCapital < amountMinor) throw new Error("INSUFFICIENT_COMMITTED_CAPITAL");
    // 4. Instrument SOURCED from the round profile (fail-closed if the round
    //    carries no instrument — we never invent one).
    const instrument = round.instrument ?? null;
    if (!instrument) throw new Error("INSTRUMENT_NOT_IN_ROUND");
    return instrument;
  },

  createDeployment(
    partnerId: string,
    spvId: string,
    data: { companyId: string; companyRoundId: string; instrument?: string | null; amountMinor: number; currency?: string },
  ): SpvDeploymentDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    if (!data.companyId || !data.companyRoundId) throw new Error("COMPANY_AND_ROUND_REQUIRED");
    if (!Number.isFinite(data.amountMinor) || data.amountMinor <= 0) throw new Error("INVALID_AMOUNT");
    // Blocker 5 — verify mandate/round/funding readiness BEFORE opening a money
    // path. Every check is FAIL CLOSED (a missing fact rejects, never matches).
    const instrument = this._assertDeploymentReadiness(partnerId, spvId, data.companyId, data.companyRoundId, data.amountMinor);
    // Blocker 3 (4D) — a fixed/hybrid fee CONFIG must be settled before a
    // deployment money path may open. Accrue idempotently so the obligation row
    // exists to be paid, then FAIL CLOSED if it is not paid/waived.
    this.accrueFundingFeeObligations(partnerId, spvId);
    if (this.hasUnsettledFixedFees(partnerId, spvId)) throw new Error("FEES_UNPAID");
    const now = nowIso();
    const d: SpvDeploymentDTO = {
      id: newId("spvdep"),
      spvId,
      companyId: data.companyId,
      companyRoundId: data.companyRoundId,
      // Instrument is SOURCED from the canonical round profile (never trusted
      // from the client), so the cap-table line matches the round's instrument.
      instrument,
      amountMinor: data.amountMinor,
      currency: data.currency ?? s.currency,
      shares: null,
      capTableLedgerRef: null,
      status: "pending",
      founderConfirmedAt: null,
      wiredAt: null,
      wirePaymentRef: null,
      closingDocRef: null,
      deployedAt: null,
      createdAt: now,
      updatedAt: now,
      revisionHash: "",
    };
    this._persistDeployment(d);
    pushInto(deploymentsBySpv, spvId, d);
    emit("spv.deployment_created", spvId, { partnerId, spvId, deploymentId: d.id, companyId: d.companyId });
    return d;
  },

  /** Route/parallel-layer lifecycle BEFORE the sacred ledger write. */
  advanceDeployment(
    partnerId: string,
    spvId: string,
    deploymentId: string,
    to: "founder_confirmed" | "docs_sent" | "wired",
    data: { wirePaymentRef?: string | null; closingDocRef?: string | null } = {},
  ): SpvDeploymentDTO {
    if (!this.getSpv(partnerId, spvId)) throw new Error("SPV_NOT_FOUND");
    const d = (deploymentsBySpv.get(spvId) ?? []).find((x) => x.id === deploymentId);
    if (!d) throw new Error("DEPLOYMENT_NOT_FOUND");
    // Blocker 5 — readiness must STILL hold when advancing the money path.
    this._assertDeploymentReadiness(partnerId, spvId, d.companyId, d.companyRoundId, d.amountMinor);
    // Blocker 3 (4D) — a fixed/hybrid fee CONFIG must be settled to advance the
    // deployment money path. Accrue idempotently, then FAIL CLOSED if unsettled.
    this.accrueFundingFeeObligations(partnerId, spvId);
    if (this.hasUnsettledFixedFees(partnerId, spvId)) throw new Error("FEES_UNPAID");
    const now = nowIso();
    if (to === "wired") {
      // Fail-closed lifecycle ordering: cannot wire before founder confirmation.
      if (!d.founderConfirmedAt) throw new Error("FOUNDER_NOT_CONFIRMED");
      // Blocker 2 (4D): `wired` asserts money actually moved — a REAL payment ref
      // is MANDATORY and persisted, fail-closed if absent.
      const ref = typeof data.wirePaymentRef === "string" ? data.wirePaymentRef.trim() : "";
      if (!ref) throw new Error("WIRE_PAYMENT_REF_REQUIRED");
      d.wirePaymentRef = ref;
      if (typeof data.closingDocRef === "string" && data.closingDocRef.trim()) d.closingDocRef = data.closingDocRef.trim();
      d.wiredAt = now;
    }
    if (to === "founder_confirmed") d.founderConfirmedAt = now;
    d.status = to;
    d.updatedAt = now;
    this._persistDeployment(d);
    emit("spv.deployment_advanced", spvId, { partnerId, spvId, deploymentId, to });
    return d;
  },

  /** Record the SINGLE cap-table ledger line ref written by the route layer via
   *  the existing sacred commitFunded path (the store NEVER touches the ledger). */
  markDeployed(partnerId: string, spvId: string, deploymentId: string, ledgerRef: string, shares: string | null): SpvDeploymentDTO {
    if (!this.getSpv(partnerId, spvId)) throw new Error("SPV_NOT_FOUND");
    const d = (deploymentsBySpv.get(spvId) ?? []).find((x) => x.id === deploymentId);
    if (!d) throw new Error("DEPLOYMENT_NOT_FOUND");
    d.capTableLedgerRef = ledgerRef;
    d.shares = shares;
    d.status = "deployed";
    d.deployedAt = nowIso();
    d.updatedAt = d.deployedAt;
    this._persistDeployment(d);
    emit("spv.deployed", spvId, { partnerId, spvId, deploymentId, ledgerRef });
    /* WAVE 8 ORP-029 / DEF-029 — CHARGE THE DEPLOYMENT FEE. This is the engine's
       deploy transition and the only path to status "deployed"; the legacy
       trigger (spvFundStore.ts:1204) keys on a status "active" that the
       canonical SPV_STATUSES enum does not contain, so the fee had never once
       been charged for an engine SPV. Idempotent and fail-open by contract:
       see server/lib/spvEngineDeploymentFeeHook.ts. Deliberately AFTER the
       persist + emit so a fee-config gap can never roll back a completed
       cap-table deployment. */
    chargeEngineSpvDeploymentFee(spvId, this.getSpv(partnerId, spvId)?.sponsorPartnerId ?? partnerId);
    return d;
  },

  listDeployments(partnerId: string, spvId: string): SpvDeploymentDTO[] {
    if (!this.getSpv(partnerId, spvId)) return [];
    return (deploymentsBySpv.get(spvId) ?? []).slice();
  },

  _persistDeployment(d: SpvDeploymentDTO): void {
    const { prev, curr } = chain("spv_deployment", { ...d, revisionHash: undefined });
    d.revisionHash = curr;
    persist(
      "spv_deployment",
      `INSERT INTO spv_deployment (id, spv_id, company_id, company_round_id, instrument, amount_minor,
         currency, shares, cap_table_ledger_ref, status, founder_confirmed_at, wired_at, wire_payment_ref,
         closing_doc_ref, deployed_at, created_at, updated_at, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         instrument=excluded.instrument, shares=excluded.shares,
         cap_table_ledger_ref=excluded.cap_table_ledger_ref, status=excluded.status,
         founder_confirmed_at=excluded.founder_confirmed_at, wired_at=excluded.wired_at,
         wire_payment_ref=excluded.wire_payment_ref, closing_doc_ref=excluded.closing_doc_ref,
         deployed_at=excluded.deployed_at, updated_at=excluded.updated_at,
         prev_hash=excluded.prev_hash, curr_hash=excluded.curr_hash`,
      [d.id, d.spvId, d.companyId, d.companyRoundId, d.instrument, d.amountMinor, d.currency, d.shares,
       d.capTableLedgerRef, d.status, d.founderConfirmedAt, d.wiredAt, d.wirePaymentRef, d.closingDocRef,
       d.deployedAt, d.createdAt, d.updatedAt, prev, curr],
    );
  },

  /* ---- Distributions / waterfall ----
   * ── XT-C5 · WATERFALL BOUNDARY (3 of 3) ───────────────────────────────
   * THIS IS THE CANONICAL ONE for moving money to SPV limited partners:
   * 5 tiers, per-LP allocations, carry collected through the payment ledger
   * BEFORE the row persists (fail-closed), hash-chained into `spv_distribution`
   * (singular — see C-2; the plural table is a projection).
   *
   * The other two "waterfalls" in this tree are different capabilities, not
   * rivals, and neither may stand in for this one:
   *   · `spvOfflineOps.computeDistributionSplit` — non-persisting PREVIEW.
   *   · `computeWaterfall` from `@capavate/cap-table-engine`
   *     (`server/track1Routes.ts:215`) — founder-side EXIT modelling by share
   *     class. Answers a different question: what if the COMPANY is sold.
   *
   * The dangerous direction is writing through the legacy plural route
   * instead of this one: it silently drops the waterfall, the per-LP
   * allocations and the carry collection. Money loss, no error (C-2).
   */
  recordDistribution(
    partnerId: string,
    spvId: string,
    data: {
      event: string;
      grossProceedsMinor: number;
      currency?: string;
      costBasisMinor?: number;
      /* WAVE 6 / SC-3 — the GP's tax/accounting classification. Optional on the
         wire; when omitted it is DERIVED from `event` by exactly the same rule
         the 0153 backfill uses, so a legacy caller keeps working and a modern
         caller's explicit choice is never overwritten. An explicit value
         outside the domain THROWS (SPV_DISTRIBUTION_TYPE_INVALID) rather than
         degrading to 'other' — a client typo must not silently mislabel a
         distribution the GP is legally characterising. */
      distributionType?: string;
    },
    actor: string,
    /** WAVE 1A / S-2 — SINK 5. The carry settlement authorization. It is a
     *  SEPARATE ARGUMENT, deliberately NOT a field of `data`, because `data` is
     *  the request body at spvEngineRoutes.ts:397. A body can no longer carry a
     *  settlement outcome into this function under any key name. Omitting it is
     *  legal only for a distribution with ZERO carry. */
    settlement?: FeeSettlementAuthorization,
  ): SpvDistributionDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    /* ══ WAVE 26 / S-3 SECOND PATH — THE MONEY WRITE. ══
     * This is the sink the Wave 5 fix did not reach. `recordDistribution`
     * carries NO fee gate (`hasUnsettledFixedFees` guards advanceSubscription,
     * createDeployment and advanceDeployment — not this), and it derives BOTH
     * carry percentages from `effectiveFee` further down. On an unloaded fee
     * table both resolve to 0, so the waterfall runs with ZERO GP and ZERO
     * platform carry and pays 100% of the proceeds to the LPs — a persisted,
     * hash-chained money movement computed from fees the process never read.
     * Placed FIRST, before every other precondition, so there is no ordering
     * in which any part of this function runs on an untrusted fee view. */
    if (this.feeViewUnreliable(spvId)) throw new Error("FEE_STATE_UNKNOWN");
    if (!data.event) throw new Error("EVENT_REQUIRED");
    /* WAVE 6 / SC-3 — resolve BEFORE any write so an invalid type aborts the
       distribution with nothing persisted, matching the fail-closed shape the
       carry-cap resolver already established (WAVE 3D). */
    const distributionType: SpvDistributionType = resolveDistributionType(data.distributionType, data.event);
    if (!Number.isFinite(data.grossProceedsMinor) || data.grossProceedsMinor < 0) throw new Error("INVALID_GROSS");

    // Blocker 4 — EXPLICIT basis required. We NEVER silently assume cost basis 0
    // (which would treat every dollar of proceeds as profit and over-charge carry).
    if (data.costBasisMinor == null || !Number.isFinite(data.costBasisMinor) || data.costBasisMinor < 0) {
      throw new Error("DISTRIBUTION_BASIS_REQUIRED");
    }
    // FAIL if there are no committed LPs — nobody to allocate to. Blocker 4 (4D):
    // distributions allocate over the COMMITTED-only register, so a non-committed
    // (review / soft-circled / wire-funded-but-uncommitted) sub NEVER appears in
    // the waterfall.
    const register = this.committedRegister(partnerId, spvId);
    if (register.length === 0) throw new Error("NO_COMMITTED_LPS");

    const mgmt = this.effectiveFee(spvId, "management");
    const plat = this.effectiveFee(spvId, "platform");
    const gpCarryPct = mgmt && mgmt.feeType !== "fixed" ? (mgmt.carryPct ?? 0) : 0;
    const platCarryPct = plat && plat.feeType !== "fixed" ? (plat.carryPct ?? 0) : 0;

    const gross = data.grossProceedsMinor;
    const eventCostBasis = data.costBasisMinor;

    // RETURN-OF-CAPITAL FIRST, carry ONLY on realized profit. The carry BASE is
    // where per_deployment and whole_spv genuinely diverge:
    //   per_deployment — deal-by-deal: profit = this event's proceeds − this
    //     deal's cost; winners and losers are NOT netted.
    //   whole_spv      — portfolio-level: carry only on the INCREMENTAL profit
    //     the whole SPV has now realized above total contributed capital, net of
    //     profit already carried in prior events (losses drag the base down).
    let carryBaseMinor: number;
    let returnOfCapitalMinor: number;
    if (s.carryBasis === "per_deployment") {
      carryBaseMinor = Math.max(0, gross - eventCostBasis);
      returnOfCapitalMinor = Math.min(gross, eventCostBasis);
    } else {
      const totalContributedCapital = (deploymentsBySpv.get(spvId) ?? []).reduce((a, d) => a + d.amountMinor, 0);
      const prior = distributionsBySpv.get(spvId) ?? [];
      const priorProceeds = prior.reduce((a, d) => a + d.grossProceedsMinor, 0);
      const cumulativeProfitPrior = Math.max(0, priorProceeds - totalContributedCapital);
      const cumulativeProfitNow = Math.max(0, priorProceeds + gross - totalContributedCapital);
      carryBaseMinor = Math.max(0, cumulativeProfitNow - cumulativeProfitPrior);
      returnOfCapitalMinor = gross - carryBaseMinor;
    }

    /* ══ WAVE 3B / MC-1 + P-5 — THE MONEY SINK. ═════════════════════════
     *
     * WHAT WAS HERE (the defect, both halves of it):
     *
     *     const gpCarryMinor       = Math.round(carryBaseMinor * gpCarryPct);
     *     const platformCarryMinor = Math.round(carryBaseMinor * platCarryPct);
     *     const totalCarryMinor    = gpCarryMinor + platformCarryMinor;
     *     const distributable      = gross - totalCarryMinor;
     *     const allocations = register.map((r) => {
     *       const grossShare = Math.round(gross * r.ownershipPct);
     *       const carryShare = Math.round(totalCarryMinor * r.ownershipPct);
     *       ...
     *     });
     *
     *   1. CENTS WERE NOT CONSERVED. Every LP's gross and carry were rounded
     *      INDEPENDENTLY off a float ownershipPct, so the parts did not sum to
     *      the whole: sum(grossMinor) could differ from `gross` and
     *      sum(carryMinor) from `totalCarryMinor`. Cents appeared or vanished
     *      on a persisted distribution row.
     *   2. COMBINED CARRY COULD EXCEED GROSS. `addFee` (:557 in this file)
     *      validates each carryPct in [0,1] SEPARATELY and never checks the
     *      SUM, so 0.6 GP + 0.6 platform made `distributable` negative and
     *      every LP's `netMinor` with it.
     *
     * WHAT IS HERE NOW: ONE nested integer largest-remainder pass covering
     * gross, GP carry, platform carry and LP net together
     * (`allocateDistributionMinor`, server/lib/money.ts), built on the existing
     * `allocateResidualCents` with the documented, DDL-pinned tie-break
     * (remainder DESC, index ASC). It asserts every component sums EXACTLY to
     * its total and that no LP's net is negative, and it THROWS on violation.
     *
     * THIS IS THE PERSISTED PATH, NOT A PREVIEW. `previewDistributionSplit`
     * (:1626 below) says in its own comment that it "does NOT persist or move
     * money"; a guard there protects nothing. Every statement in this function
     * that writes — `_collectCarryObligation` (a payment-ledger write) and
     * `persist("spv_distribution", ...)` — runs strictly AFTER this call, so a
     * throw here aborts with NOTHING written. Production caller:
     * server/spvEngineRoutes.ts:499 (partner) and :522 (admin).
     *
     * Percentages are FRACTIONS in storage per the owner's ruling (0.2 = 20%).
     * Nothing below multiplies or divides by 100.
     * ═══════════════════════════════════════════════════════════════════ */

    // P-5 — the summed-carry rejection, stated explicitly in the PERSISTED
    // path before any allocation and before any row is written. The allocator
    // re-asserts the same cap, so removing this line does not open the hole;
    // it is here so the rejection is legible at the sink it protects.
    //
    // WAVE 3D / ITEM 3 — the cap comes from DURABLE DB CONFIGURATION
    // (`spv_carry_cap_policy`, migration 0150), scoped spv -> tenant ->
    // platform, most specific wins. This resolve FAILS CLOSED: if no active
    // policy row applies it throws COMBINED_CARRY_CAP_POLICY_MISSING and the
    // distribution aborts with nothing written. A missing record never means
    // "no cap".
    //
    // WAVE 3D / ITEM 4 — the comparison is EXACT FIXED-SCALE INTEGER
    // arithmetic, not a binary-float sum. `0.5000000000000001 + 0.5` used to
    // be accepted here because JavaScript evaluates that sum as exactly 1;
    // `exactFractionToCarryScaled` now converts each rate through its shortest
    // exact decimal and REJECTS precision finer than 1e-9
    // (DISTRIBUTION_ALLOCATION_RATE_PRECISION_UNSUPPORTED) rather than
    // silently rounding it away.
    const combinedCarryCapScaled = resolveCombinedCarryCapScaled({
      tenantId: s.sponsorPartnerId,
      spvId,
    });
    const gpCarryScaled = exactFractionToCarryScaled(gpCarryPct, "gpCarryFraction");
    const platCarryScaled = exactFractionToCarryScaled(platCarryPct, "platformCarryFraction");
    if (gpCarryScaled + platCarryScaled > BigInt(combinedCarryCapScaled)) {
      throw new Error("COMBINED_CARRY_EXCEEDS_CAP");
    }

    const alloc = allocateDistributionMinor({
      grossMinor: gross,
      carryBaseMinor: carryBaseMinor,
      gpCarryFraction: gpCarryPct,
      platformCarryFraction: platCarryPct,
      // Register order is the allocation index order; the tie-break is
      // (remainder DESC, weight DESC, index ASC) over exactly this order
      // (WAVE 3D / ITEM 5, owner ruling 2026-08-10).
      lpWeightsMinor: register.map((r) => r.commitmentMinor),
      combinedCarryCapScaled,
    });

    /* ══ WAVE 32 / CP-SPV-30 CAPABILITY 2 — SIDE-LETTER ECONOMICS. ═════════
     *
     * XT-C5 shipped this waterfall's boundary handling; this EXTENDS it and
     * does not rebuild it. The base allocation above is still the one
     * canonical `allocateDistributionMinor` pass; what follows re-rates the
     * carry for LPs who negotiated their own rate, and returns the base
     * result BY IDENTITY when no active side letter carries an override — so
     * a vehicle without side letters computes exactly what it computed before
     * Wave 32, down to the rounding decisions.
     *
     * PLACED HERE ON PURPOSE. Wave 3B's pinned CALL-GRAPH-1 test asserts the
     * source-text order guard < allocateDistributionMinor( <
     * _collectCarryObligation( < persist("spv_distribution", which is the
     * proof that a throw aborts with nothing written. This call sits strictly
     * between the allocator and the collection: every pinned relative
     * position is preserved, and the re-rating must precede the collection
     * because it changes HOW MUCH carry is collected. Any refusal it raises
     * (cap breach, non-conservation, negative LP net) therefore aborts the
     * distribution with no money moved and no row persisted.
     *
     * The overrides are read from `spv_side_letter` — the DB, per request,
     * never a cached map — so revoking a letter takes effect on the very next
     * distribution. */
    const sideLetterOverrides = activeCarryOverrides(spvId);
    const rerated = applySideLetterCarry({
      perLp: alloc.perLp.map((p, i) => ({
        investorId: register[i].investorId,
        grossMinor: p.grossMinor,
        carryMinor: p.carryMinor,
        netMinor: p.netMinor,
      })),
      lpWeightsMinor: register.map((r) => r.commitmentMinor),
      grossMinor: gross,
      carryBaseMinor,
      gpCarryMinor: alloc.gpCarryMinor,
      platformCarryMinor: alloc.platformCarryMinor,
      fundCombinedCarryScaled: Number(gpCarryScaled + platCarryScaled),
      combinedCarryCapScaled,
      overrides: sideLetterOverrides,
    });

    const gpCarryMinor = rerated.gpCarryMinor;
    const platformCarryMinor = rerated.platformCarryMinor;
    const totalCarryMinor = rerated.totalCarryMinor;
    const distributable = rerated.distributableMinor;

    // Per-LP gross/carry/net — net = gross − carry, non-negative by assertion,
    // and each column sums EXACTLY to its total. When side letters applied,
    // these are the re-rated lines; otherwise they are the base allocation
    // unchanged.
    const allocations: SpvDistributionAllocation[] = register.map((r, i) => ({
      investorId: r.investorId,
      grossMinor: rerated.perLp[i].grossMinor,
      carryMinor: rerated.perLp[i].carryMinor,
      netMinor: rerated.perLp[i].netMinor,
    }));
    const distId = newId("spvdist");

    // Collect carry THROUGH the existing payment ledger BEFORE persisting the
    // distribution — fail-closed: a collection failure aborts (throws) and the
    // distribution is never recorded.
    // WAVE 1A / S-2 — SINK 5 CLOSED. This line used to read
    // `data.collectionOutcome`, i.e. the request body, and hand it to
    // `_collectCarryObligation` → `chargeFeeObligation` → `state = "paid"`.
    // A carry-bearing distribution now REQUIRES a minted authorization; without
    // one it aborts fail-closed and no distribution row is written.
    /* ══════════════════════════════════════════════════════════════════════ *
     *  WAVE 3F / ITEM 1 — ONE OUTER TRANSACTION SPANS THE CHARGE AND THE ROW
     * ══════════════════════════════════════════════════════════════════════ *
     *
     * WHAT WAS WRONG (W10 REVIEW A, CRITICAL). `chargeFeeObligation` opened and
     * COMMITTED its own settlement transaction (WAVE 3E), and the distribution
     * INSERT happened afterwards, outside it. A trigger/constraint/driver/disk
     * failure at the final insert therefore left:
     *     distributionCount: 0, obligation state='paid', payment state='succeeded'
     * Money taken, no distribution recorded. Reproduced by
     * `server/__tests__/w10_atomicity_repro.test.ts`.
     *
     * THE FIX. Authorization consumption, the payment-ledger entry, the fee
     * obligation row AND the `spv_distribution` insert now commit together or
     * not at all. `withSettlementTransaction` nests through better-sqlite3
     * SAVEPOINTs, so WAVE 3E's inner scope inside `chargeFeeObligation` becomes
     * a savepoint of THIS transaction rather than an independent commit. The
     * 3E guarantee is WIDENED, never weakened:
     *   • `consumeSettlementAuthorization` still refuses to run outside a
     *     transaction (SETTLEMENT_AUTHORIZATION_NOT_TRANSACTIONAL) — it is now
     *     inside two nested ones;
     *   • the consume UPDATE is still atomic with the money write;
     *   • nothing about minting, scope, expiry, revocation or single use moved.
     *
     * THE RAM PROJECTION MUST NOT SURVIVE A ROLLBACK. "ZERO in-memory canonical
     * state" (file header): the Maps are a projection and may never be ahead of
     * the DB. On rollback we restore the fee-obligation array, every obligation
     * field WAVE 3E's inner catch may have already restored (idempotent), and
     * the hash-chain tips — and the distribution is pushed into the projection
     * only AFTER the commit returns.
     *
     * BRIDGE EVENTS ARE DEFERRED for the same reason (see `openEventDeferral`).
     *
     * SOURCE-TEXT NOTE — the transaction body below is DELIBERATELY NOT
     * RE-INDENTED. Wave 3B's pinned CALL-GRAPH-1 test asserts the literal text
     * `persist(\n      "spv_distribution"` and the ordering
     * guard < allocator < _collectCarryObligation < persist inside this
     * function's source slice. Re-indenting would silently break that proof, so
     * the statements keep their original column and only the wrapper moves. */
    const feeObSnapshot = (feeObligationsBySpv.get(spvId) ?? []).slice();
    const feeObFields = feeObSnapshot.map((o) => ({
      o, state: o.state, paymentRef: o.paymentRef, updatedAt: o.updatedAt, revisionHash: o.revisionHash,
    }));
    const chainTipSnapshot: Record<string, string> = { ...chainTip };
    const deferral = openEventDeferral();
    let recorded: SpvDistributionDTO;
    try {
      recorded = withSettlementTransaction((): SpvDistributionDTO => {
    let gpCarryRef: string | null = null;
    let platformCarryRef: string | null = null;
    if (gpCarryMinor > 0 || platformCarryMinor > 0) {
      if (!isFeeSettlementAuthorization(settlement)) throw new Error("SETTLEMENT_AUTHORIZATION_REQUIRED");
    }
    if (gpCarryMinor > 0) {
      gpCarryRef = this._collectCarryObligation(partnerId, spvId, "management", gpCarryMinor, data.currency ?? s.currency, distId, settlement!).paymentRef;
    }
    if (platformCarryMinor > 0) {
      platformCarryRef = this._collectCarryObligation(partnerId, spvId, "platform", platformCarryMinor, data.currency ?? s.currency, distId, settlement!).paymentRef;
    }

    const waterfall = [
      { tier: "return_of_capital", basis: s.carryBasis, amountMinor: returnOfCapitalMinor, costBasisMinor: eventCostBasis },
      { tier: "carry_base", basis: s.carryBasis, amountMinor: carryBaseMinor },
      { tier: "gp_carry", pct: gpCarryPct, amountMinor: gpCarryMinor, paymentRef: gpCarryRef },
      { tier: "platform_carry", pct: platCarryPct, amountMinor: platformCarryMinor, paymentRef: platformCarryRef },
      { tier: "pro_rata_lp", amountMinor: distributable },
    ];
    /* WAVE 32 — the side-letter tier is APPENDED AT THE END of the waterfall,
       never spliced between existing tiers: readers (and the guard) treat tier
       position as identity, and renumbering `gp_carry` would read as a removal.
       It is recorded ONLY when it actually did something, so a vehicle without
       side letters keeps a byte-identical five-tier waterfall_json. */
    if (rerated.adjusted) {
      waterfall.push({
        tier: "side_letter_adjustment",
        amountMinor: totalCarryMinor - alloc.totalCarryMinor,
        adjustments: rerated.adjustments,
      } as any);
    }
    const now = nowIso();
    const dist: SpvDistributionDTO = {
      id: distId,
      spvId,
      event: data.event,
      grossProceedsMinor: data.grossProceedsMinor,
      currency: data.currency ?? s.currency,
      waterfall,
      allocations,
      gpCarryMinor,
      platformCarryMinor,
      status: "recorded",
      createdAt: now,
      createdBy: actor ?? null,
      revisionHash: "",
      distributionType,
    };
    const { prev, curr } = chain("spv_distribution", { ...dist, revisionHash: undefined });
    dist.revisionHash = curr;
    /* WAVE 6 / SC-3 — third place. Idempotent, and a no-op once the migration
       runner has applied 0153. Needed for the `:memory:` test database, whose
       schema comes from connection.ts's inline bootstrap (SACRED, unedited)
       and therefore predates this column. */
    const hasTypeColumn = ensureSpvDistributionTypeColumn();
    persist(
      "spv_distribution",
      hasTypeColumn
        ? `INSERT INTO spv_distribution (id, spv_id, event, distribution_type, gross_proceeds_minor, currency, waterfall_json,
             allocations_json, gp_carry_minor, platform_carry_minor, status, created_at, created_by, prev_hash, curr_hash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        : `INSERT INTO spv_distribution (id, spv_id, event, gross_proceeds_minor, currency, waterfall_json,
             allocations_json, gp_carry_minor, platform_carry_minor, status, created_at, created_by, prev_hash, curr_hash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      hasTypeColumn
        ? [dist.id, spvId, dist.event, distributionType, dist.grossProceedsMinor, dist.currency, JSON.stringify(dist.waterfall),
           JSON.stringify(dist.allocations), dist.gpCarryMinor, dist.platformCarryMinor, dist.status, now, actor ?? null, prev, curr]
        : [dist.id, spvId, dist.event, dist.grossProceedsMinor, dist.currency, JSON.stringify(dist.waterfall),
           JSON.stringify(dist.allocations), dist.gpCarryMinor, dist.platformCarryMinor, dist.status, now, actor ?? null, prev, curr],
    );
    // Collect platform carry (audit + bridge; actual charge handled by fee runtime).
    emit("spv.distribution_recorded", spvId, { partnerId, spvId, distributionId: dist.id, gpCarryMinor, platformCarryMinor });
    return dist;
      });
    } catch (e) {
      /* WAVE 3F / ITEM 1 — the transaction rolled back: NOTHING committed, so no
       * charge stands and no distribution exists. Rewind the projection to the
       * pre-call state and re-throw unchanged. */
      deferral.discard();
      feeObligationsBySpv.set(spvId, feeObSnapshot);
      for (const f of feeObFields) {
        f.o.state = f.state; f.o.paymentRef = f.paymentRef; f.o.updatedAt = f.updatedAt; f.o.revisionHash = f.revisionHash;
      }
      for (const k of Object.keys(chainTip)) delete chainTip[k];
      Object.assign(chainTip, chainTipSnapshot);
      throw e;
    }
    /* Committed. Only now may the projection and the audit bridge learn of it. */
    pushInto(distributionsBySpv, spvId, recorded);
    deferral.flush();

    /* ------------------------------------------------------------------
     * WAVE 10 / EN-1 — PROJECT THE DISTRIBUTION INTO THE ILPA CASH-FLOW LEDGER.
     *
     * THE SINK. `INSERT INTO spv_distribution` happens in exactly one place in
     * the tree — the `persist(...)` call ~50 lines above — and this is the
     * post-commit point for it. THE SECOND PATH to the same money is the LEGACY
     * plural table `spv_distributions` (server/spvFundStore.ts:902), whose
     * write API was CLOSED in WAVE 3D / ITEM 1: it now throws rather than
     * inserting, and `server/lib/legacyDistributionLedger.ts` documents the
     * closure. So there is one live writer, and it is this one. If the plural
     * ledger is ever reopened it must project here too, and
     * server/__tests__/waveW10_en1_cashflow_ledger.test.ts asserts the closure
     * still holds so that reopening cannot happen silently.
     *
     * WHY AFTER `deferral.flush()` AND NOT INSIDE THE TRANSACTION. The tx above
     * rewinds `chainTip` and the fee-obligation projection on failure. A
     * cash-flow row appended inside it would be rolled back by SQLite but the
     * ledger's own chain tip is read fresh on every append, so no rewind is
     * needed — and appending post-commit means a projection failure can never
     * be the reason a settled distribution disappears.
     *
     * SIGN. A distribution is money OUT to LPs, so POSITIVE. Gross proceeds are
     * used, not the net-of-carry figure: DPI is a gross-distribution measure and
     * carry is modelled as its own flow when it is called.
     * ---------------------------------------------------------------- */
    tryProject(
      () =>
        projectDistribution({
          tenantId: (recorded as any).tenantId ?? partnerId,
          vehicleKind: "spv",
          vehicleId: spvId,
          distributionId: recorded.id,
          grossAmountMinor: recorded.grossProceedsMinor,
          currency: recorded.currency,
          valueDate: String(recorded.createdAt).slice(0, 10),
          distributionType: (recorded as any).distributionType ?? null,
          createdBy: actor ?? "spvEngineStore.recordDistribution",
        }),
      `distribution ${recorded.id}`,
    );

    return recorded;
  },

  listDistributions(partnerId: string, spvId: string): SpvDistributionDTO[] {
    if (!this.getSpv(partnerId, spvId)) return [];
    return (distributionsBySpv.get(spvId) ?? []).slice();
  },

  /* ================================================================== *
   *  W-FIX1e — SPV offline-first core (SPV-CORE-1/2/3).
   *
   *  These are DB-driven, additive, and NEVER move money or block. The
   *  authoritative money seat for an LP is ALWAYS the sacred commitFunded
   *  ledger line written at the lp-commit route; nothing here duplicates or
   *  bypasses it. Funds-confirmation metadata is persisted DURABLY inside the
   *  SPV `terms` JSON (write-through via persistSpv), not held in RAM.
   * ================================================================== */

  /** SPV-CORE-1 — record an OFFLINE LP wire confirmation. A mismatch (received
   *  ≠ committed) is surfaced as an EDUCATIONAL flag and NEVER blocks: the LP's
   *  authoritative seat remains whatever commitFunded recorded. Returns the
   *  reconciliation so the caller can show the GP the delta. */
  confirmFundsReceived(
    partnerId: string,
    spvId: string,
    investorId: string,
    receivedMinor: number,
    reference: string | null | undefined,
    actor: string,
  ): FundsConfirmation {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    if (!investorId) throw new Error("INVESTOR_ID_REQUIRED");
    const sub = (subsBySpv.get(spvId) ?? []).find((x) => x.investorId === investorId && x.status !== "withdrawn");
    const expectedMinor = sub ? sub.commitmentMinor : 0;
    const conf = computeFundsConfirmation(expectedMinor, receivedMinor, reference ?? undefined);
    // Persist durably in terms._fundsConfirmations (never blocks the money path).
    const terms = { ...(s.terms ?? {}) } as Record<string, unknown>;
    const bag = { ...((terms._fundsConfirmations as Record<string, unknown>) ?? {}) };
    bag[investorId] = {
      receivedMinor: conf.receivedMinor,
      expectedMinor: conf.expectedMinor,
      deltaMinor: conf.deltaMinor,
      status: conf.status,
      reference: conf.reference,
      confirmedAt: nowIso(),
    };
    terms._fundsConfirmations = bag;
    this.updateSpv(partnerId, spvId, { terms }, actor);
    emit("spv.funds_confirmed", spvId, { partnerId, spvId, investorId, status: conf.status, mismatch: conf.mismatch });
    return conf;
  },

  /** SPV-CORE-1 — the durable confirmed-received amounts keyed by investor. */
  confirmedByInvestor(partnerId: string, spvId: string): Record<string, number> {
    const s = this.getSpv(partnerId, spvId);
    if (!s) return {};
    const bag = ((s.terms ?? {}) as Record<string, unknown>)._fundsConfirmations as
      | Record<string, { receivedMinor?: number }>
      | undefined;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(bag ?? {})) out[k] = Number(v?.receivedMinor ?? 0) || 0;
    return out;
  },

  /** SPV-CORE-2 — minimal per-LP capital accounts (D10): committed on the
   *  register, confirmed-received (offline), and net distributed to date. */
  capitalAccounts(partnerId: string, spvId: string): CapitalAccountRow[] {
    if (!this.getSpv(partnerId, spvId)) return [];
    const register = this.committedRegister(partnerId, spvId).map((r) => ({
      investorId: r.investorId,
      commitmentMinor: r.commitmentMinor,
    }));
    return computeCapitalAccounts(register, this.confirmedByInvestor(partnerId, spvId), this.listDistributions(partnerId, spvId));
  },

  /** ═══ WAVE 14 / P-7 — READ THE HURDLE THE OPERATOR ALREADY AGREED TO. ═══
   *
   * THE DEFECT. `terms.hurdleRatePct` is collected by the launch wizard
   * (client/src/pages/partner/PartnerSpvEngine.tsx:684, "Hurdle % (optional)")
   * and normalised to a FRACTION at the route boundary by
   * `normaliseSpvTermsHurdle` (P-4). It is then persisted into the terms blob
   * and READ BY NOBODY: `grep -rn "\.terms\b" server/ client/src` returns
   * jurisdiction, `_fundsConfirmations`, currency and legacy-shim reads, and no
   * hurdle read anywhere. Every consumer of the waterfall takes the hurdle from
   * its OWN caller instead — so the offline preview asked the GP to retype a
   * number the SPV already carried, and any mismatch between the retyped value
   * and the agreed term was silent. That is a write-only money term.
   *
   * WHY A READ AND NOT A DELETION. The value is on the SPV's terms because the
   * LPs subscribed on it. Deleting the field would drop functionality; the
   * correct close is to make the agreed term the DEFAULT and to say so.
   *
   * LEGACY BLOBS. Rows written before P-4 hold percent-as-written (8, not 0.08)
   * and carry no `_hurdleRatePctForm` marker. Those are put through
   * `normaliseSpvTermsHurdle` on READ, which is idempotent (it no-ops on a
   * marked blob) and REJECTS out-of-domain values rather than clamping them. A
   * legacy 8 therefore reads as 0.08 and a nonsense 8000 throws — it does not
   * become a 100% preferred return, which was the P-4 defect.
   *
   * NOT A WRITER. This does not persist the normalised value back. Repairing
   * stored rows is a migration's job, not a read path's, and a read that
   * silently rewrites money terms is worse than the defect. */
  storedHurdleFraction(partnerId: string, spvId: string): { fraction: number | null; source: "spv_terms" | "none"; asWritten: number | null } {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    const terms = (s.terms ?? null) as Record<string, unknown> | null;
    if (!terms || terms.hurdleRatePct === null || terms.hurdleRatePct === undefined || terms.hurdleRatePct === "") {
      return { fraction: null, source: "none", asWritten: null };
    }
    const normalised = normaliseSpvTermsHurdle(terms) as Record<string, unknown>;
    const frac = Number(normalised.hurdleRatePct);
    if (!Number.isFinite(frac)) return { fraction: null, source: "none", asWritten: null };
    return {
      fraction: frac,
      source: "spv_terms",
      asWritten: typeof normalised._hurdleRatePctAsWritten === "number" ? (normalised._hurdleRatePctAsWritten as number) : null,
    };
  },

  /** SPV-CORE-2 — OFFLINE distribution preview (return of capital + carry, with
   *  the OPTIONAL preferred-return / GP-catch-up tiers engaging only when a
   *  hurdle is set). This is a planning affordance; it does NOT persist or move
   *  money — recordDistribution remains the single, unchanged money path. */
  previewDistributionSplit(
    partnerId: string,
    spvId: string,
    input: { grossProceedsMinor: number; hurdleRatePct?: number | null; gpCatchUpPct?: number | null },
  ): DistributionSplit {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    /* WAVE 26 / S-3 SECOND PATH. The preview persists nothing, but a GP reads
       it to decide what to distribute. An unloaded fee table would show a
       carry-free split that the real write would never produce. */
    if (this.feeViewUnreliable(spvId)) throw new Error("FEE_STATE_UNKNOWN");
    const contributedMinor = this.committedRegister(partnerId, spvId).reduce((a, r) => a + r.commitmentMinor, 0);
    const mgmt = this.effectiveFee(spvId, "management");
    const plat = this.effectiveFee(spvId, "platform");
    const gpCarryPct = mgmt && mgmt.feeType !== "fixed" ? (mgmt.carryPct ?? 0) : 0;
    const platCarryPct = plat && plat.feeType !== "fixed" ? (plat.carryPct ?? 0) : 0;
    return computeDistributionSplit({
      grossProceedsMinor: input.grossProceedsMinor,
      contributedMinor,
      carryPct: gpCarryPct + platCarryPct,
      /* P-7 — an EXPLICIT caller value still wins (a GP previewing a
         what-if scenario must be able to override), but a caller who supplies
         nothing now gets the SPV's own agreed hurdle instead of zero. Zero is
         NOT treated as absent: `0` is a real answer ("no preferred return") and
         `?? ` only falls through on null/undefined. */
      hurdleRatePct: input.hurdleRatePct ?? this.storedHurdleFraction(partnerId, spvId).fraction,
      gpCatchUpPct: input.gpCatchUpPct ?? null,
    });
  },

  /** SPV-CORE-3 — close summary. Under-target NEVER blocks; the summary carries
   *  the one-click "set target = raised" suggestion. */
  closeSummary(partnerId: string, spvId: string): CloseSummary {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    const subs = (subsBySpv.get(spvId) ?? []).map((x) => ({ status: x.status, commitmentMinor: x.commitmentMinor }));
    return computeCloseSummary(subs, s.targetRaiseMinor);
  },

  /** SPV-CORE-3 — close to new LPs. Under-target proceeds anyway (never blocks);
   *  when `setTargetToRaised` is set, the target is lowered to the confirmed
   *  amount so the record is honest. Stamps status=closed + closeDate. */
  closeToNewLps(
    partnerId: string,
    spvId: string,
    actor: string,
    opts?: { setTargetToRaised?: boolean; closeDate?: string },
  ): { spv: SpvDTO; summary: CloseSummary } {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    const summary = this.closeSummary(partnerId, spvId);
    const patch: Partial<SpvDTO> = { status: "closed", closeDate: opts?.closeDate ?? nowIso() };
    if (opts?.setTargetToRaised) patch.targetRaiseMinor = summary.suggestedTargetMinor;
    const spv = this.updateSpv(partnerId, spvId, patch, actor);
    emit("spv.closed_to_new_lps", spvId, { partnerId, spvId, underTarget: summary.underTarget, confirmedMinor: summary.confirmedMinor });
    return { spv, summary };
  },

  /** SPV-CORE-3 — reopen a closed SPV for a later (rolling) close, allowed only
   *  within `windowDays` of the recorded close date. Fail-closed once elapsed. */
  reopenForRollingClose(partnerId: string, spvId: string, windowDays: number, actor: string): SpvDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    const gate = canReopenClose(s.status, s.closeDate, windowDays);
    if (!gate.allowed) throw new Error(gate.reason === "not_closed" ? "SPV_NOT_CLOSED" : "ROLLING_CLOSE_WINDOW_ELAPSED");
    const spv = this.updateSpv(partnerId, spvId, { status: "open" }, actor);
    emit("spv.reopened_rolling_close", spvId, { partnerId, spvId, reason: gate.reason });
    return spv;
  },

  /* ---- Documents (fs storage keys, authenticated streaming) ---- */
  addDocument(
    partnerId: string,
    spvId: string,
    data: { docType: string; title?: string; storageKey: string; storageBackend?: string; contentType?: string; sizeBytes?: number; expiry?: string },
    actor: string,
  ): SpvDocumentDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    if (!data.storageKey) throw new Error("STORAGE_KEY_REQUIRED");
    const now = nowIso();
    const doc: SpvDocumentDTO = {
      id: newId("spvdoc"),
      spvId,
      docType: data.docType as SpvDocumentDTO["docType"],
      title: data.title ?? null,
      storageKey: data.storageKey,
      storageBackend: data.storageBackend ?? "fs",
      contentType: data.contentType ?? null,
      sizeBytes: data.sizeBytes ?? null,
      expiry: data.expiry ?? null,
      createdAt: now,
      createdBy: actor ?? null,
    };
    const { prev, curr } = chain("spv_document", { ...doc });
    persist(
      "spv_document",
      `INSERT INTO spv_document (id, spv_id, doc_type, title, storage_key, storage_backend, content_type,
         size_bytes, expiry, created_at, created_by, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [doc.id, spvId, doc.docType, doc.title, doc.storageKey, doc.storageBackend, doc.contentType, doc.sizeBytes, doc.expiry, now, actor ?? null, prev, curr],
    );
    pushInto(docsBySpv, spvId, doc);
    emit("spv.document_added", spvId, { partnerId, spvId, docId: doc.id, docType: doc.docType });
    return doc;
  },

  listDocuments(partnerId: string, spvId: string): SpvDocumentDTO[] {
    if (!this.getSpv(partnerId, spvId)) return [];
    return (docsBySpv.get(spvId) ?? []).slice();
  },

  /* ---- Secondary transfers (MODEL now, phase-2-ready) ---- */
  createTransfer(
    partnerId: string,
    spvId: string,
    data: { fromInvestorId: string; toInvestorId: string; unitsPct?: number; amountMinor?: number; currency?: string },
    actor: string,
  ): SpvTransferDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    if (!data.fromInvestorId || !data.toInvestorId) throw new Error("TRANSFER_PARTIES_REQUIRED");
    /* ── WAVE 25 / FE-4 — THE TRANSFER GUARD, AT THE SINK ──────────────────
     *
     * Before this, the ONLY server-side condition on recording a secondary
     * transfer was "both party ids are non-empty". Three checks the UI made
     * (SpvDetailTabs.tsx `TransferPanel`) had NO server counterpart, so the
     * route was a second door straight past all of them:
     *
     *   1. from === to. The panel refuses it; POST /transfers accepted it and
     *      persisted a self-transfer.
     *   2. neither an amount nor a units percentage. The panel demands one;
     *      the store wrote a transfer conveying nothing, `unitsPct` and
     *      `amountMinor` both NULL.
     *   3. the vehicle is wound down. The wind-down panel tells the GP, in
     *      those words, that after wind-down "no further capital calls,
     *      distributions, or transfers can be recorded" — and nothing in the
     *      engine enforced it for transfers. A UI promise the engine did not
     *      keep is the same defect class as a resolver with no callers.
     *
     * `createTransfer` is the single sink: the one `persist("spv_transfer", …)`
     * in the tree is below, and `grep -rn createTransfer` finds exactly one
     * live caller (spvEngineRoutes.ts POST /transfers). Fixing it here covers
     * the route, the panel and any future caller. */
    if (data.fromInvestorId === data.toInvestorId) throw new Error("TRANSFER_SELF");
    if (s.status === "wound_down") throw new Error("SPV_WOUND_DOWN");
    const hasUnits = data.unitsPct != null;
    const hasAmount = data.amountMinor != null;
    if (!hasUnits && !hasAmount) throw new Error("TRANSFER_CONSIDERATION_REQUIRED");
    /* Money rule: integer minor units, never a float, never negative. Percent
     * rule: `unitsPct` is a FRACTION (0.25 = 25%), never a 0-100 number — the
     * `n > 1 ? n/100 : n` coercion is forbidden project-wide, so a value above
     * 1 is rejected rather than silently reinterpreted. */
    if (hasAmount && (!Number.isSafeInteger(data.amountMinor) || (data.amountMinor as number) < 0)) {
      throw new Error("INVALID_AMOUNT");
    }
    if (hasUnits && (!Number.isFinite(data.unitsPct) || (data.unitsPct as number) <= 0 || (data.unitsPct as number) > 1)) {
      throw new Error("INVALID_UNITS_PCT");
    }
    const now = nowIso();
    const t: SpvTransferDTO = {
      id: newId("spvxfer"),
      spvId,
      fromInvestorId: data.fromInvestorId,
      toInvestorId: data.toInvestorId,
      unitsPct: data.unitsPct ?? null,
      amountMinor: data.amountMinor ?? null,
      currency: data.currency ?? s.currency,
      status: "proposed",
      complianceRecheckRef: null,
      gpApproval: null,
      createdAt: now,
      updatedAt: now,
    };
    const { prev, curr } = chain("spv_transfer", { ...t });
    persist(
      "spv_transfer",
      `INSERT INTO spv_transfer (id, spv_id, from_investor_id, to_investor_id, units_pct, amount_minor,
         currency, status, compliance_recheck_ref, gp_approval, created_at, updated_at, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t.id, spvId, t.fromInvestorId, t.toInvestorId, t.unitsPct, t.amountMinor, t.currency, t.status, null, null, now, now, prev, curr],
    );
    pushInto(transfersBySpv, spvId, t);
    emit("spv.transfer_proposed", spvId, { partnerId, spvId, transferId: t.id });
    return t;
  },

  listTransfers(partnerId: string, spvId: string): SpvTransferDTO[] {
    if (!this.getSpv(partnerId, spvId)) return [];
    return (transfersBySpv.get(spvId) ?? []).slice();
  },

  /* ---- admin governance (cross-partner; admin-gated at the route) ---- */
  adminListAll(): SpvDTO[] {
    return Array.from(spvById.values());
  },

  /* ---- test/admin helpers ---- */
  _resetForTest(): void {
    spvById.clear(); mandateBySpv.clear(); feesBySpv.clear(); subsBySpv.clear();
    deploymentsBySpv.clear(); distributionsBySpv.clear(); docsBySpv.clear();
    transfersBySpv.clear(); complianceByInvestor.clear(); feeObligationsBySpv.clear();
    for (const k of Object.keys(chainTip)) delete chainTip[k];
  },
};

/* ── legacy data migration (Sacred Rule #78) ────────────────────────────── */
/** Idempotent backfill: migrate every existing partner SPV (pspv_) and Fund
 *  (pfnd_ → spvType='fund') into the canonical `spv` table. Deterministic
 *  migrated id `spv_mig_<sha1(legacyId)>` + INSERT-OR-IGNORE via migrated_from
 *  means re-running is a no-op. Nothing is dropped. */
export function migrateLegacyPartnerSpvAndFunds(): { spvs: number; funds: number } {
  let migratedSpvs = 0;
  let migratedFunds = 0;
  const already = new Set<string>();
  for (const s of Array.from(spvById.values())) {
    if (s.migratedFrom) already.add(s.migratedFrom);
  }
  const migId = (legacyId: string): string => `spv_mig_${sha256Hex(legacyId).slice(0, 24)}`;

  const mapSpvStatus = (st: string): SpvStatus => {
    switch (st) {
      case "planned": return "draft";
      case "open": return "open";
      case "closed": return "closed";
      case "wound_down": return "wound_down";
      default: return "draft";
    }
  };
  const mapFundStatus = (st: string): SpvStatus => {
    switch (st) {
      case "planning": return "draft";
      case "raising": return "open";
      case "investing": return "deployed";
      case "harvesting": return "distributing";
      case "wound_down": return "wound_down";
      default: return "draft";
    }
  };
  /* WAVE 4A / follow-up 2 — no more hard-coded "delaware". Wave 3C widened the
     enum and made resolveSpvJurisdiction() the ONE coercion policy: an enum
     member or a known country/alias resolves to itself, anything unknown
     (including empty) resolves to "other", never to a US state the vehicle
     was never formed in. The UI already used it; the server now agrees. */
  const normJur = (j: string): string => resolveSpvJurisdiction(j);
  /* WAVE 4A / REVIEW-C — PRESERVE THE ORIGINAL FREE TEXT. The coercion above is
     lossy by nature (15 countries in, 16 enum members out), and until now these
     boot-migrated rows kept NO copy of what the GP actually typed. That is what
     made them permanently unrepairable: scripts/backfill_spv_jurisdiction.ts
     classifies a row with no country as `skip-no-country` and leaves it alone
     forever. Stashing the raw text on `terms.legacyJurisdiction` — the SAME key
     the legacy shims at partnerRoutes.ts:1653/:1775 already use, and the SAME
     key the backfill already reads (backfill_spv_jurisdiction.ts:126-127) —
     makes every migrated row repairable with no new column and no migration. */
  const withLegacyJur = (
    base: Record<string, unknown> | null,
    raw: unknown,
  ): Record<string, unknown> | null => {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) return base;
    return { ...(base ?? {}), legacyJurisdiction: text };
  };

  try {
    for (const legacy of partnerSpvStore._listAll()) {
      if (already.has(legacy.id)) continue;
      const id = migId(legacy.id);
      if (spvById.has(id)) continue;
      const now = nowIso();
      const s: SpvDTO = {
        id,
        sponsorPartnerId: legacy.partnerId,
        gpUserId: legacy.recordedBy ?? null,
        name: legacy.spvName,
        spvType: "spv",
        jurisdiction: normJur(legacy.jurisdiction) as SpvDTO["jurisdiction"],
        status: mapSpvStatus(legacy.status),
        distributionScope: "private",
        targetRaiseMinor: legacy.totalCommittedMinor ?? null,
        minCheckMinor: null,
        capMinor: null,
        currency: legacy.currency ?? "USD",
        carryBasis: "whole_spv", // legacy default; GP can amend post-migration
        lpVisibility: SPV_DEFAULT_LP_VISIBILITY,
        targetCompanyId: legacy.targetCompanyId ?? null,
        closeDate: null,
        terms: withLegacyJur(
          legacy.entityStructure ? { entityStructure: legacy.entityStructure } : null,
          legacy.jurisdiction,
        ),
        migratedFrom: legacy.id,
        createdAt: legacy.recordedAt ?? now,
        createdBy: legacy.recordedBy ?? null,
        updatedAt: now,
        updatedBy: "migration:0084",
        archivedAt: null,
        revisionHash: "",
      };
      persistSpv(s);
      spvById.set(s.id, s);
      migratedSpvs++;
    }
    for (const legacy of partnerFundsStore._listAll()) {
      if (already.has(legacy.id)) continue;
      const id = migId(legacy.id);
      if (spvById.has(id)) continue;
      const now = nowIso();
      const s: SpvDTO = {
        id,
        sponsorPartnerId: legacy.partnerId,
        gpUserId: legacy.recordedBy ?? null,
        name: legacy.fundName,
        spvType: "fund",
        jurisdiction: normJur(legacy.jurisdiction) as SpvDTO["jurisdiction"],
        status: mapFundStatus(legacy.status),
        distributionScope: "private",
        targetRaiseMinor: legacy.targetSizeMinor ?? null,
        minCheckMinor: null,
        capMinor: null,
        currency: legacy.currency ?? "USD",
        carryBasis: "whole_spv",
        lpVisibility: SPV_DEFAULT_LP_VISIBILITY,
        targetCompanyId: null,
        closeDate: null,
        terms: withLegacyJur({ fundType: legacy.fundType }, legacy.jurisdiction),
        migratedFrom: legacy.id,
        createdAt: legacy.recordedAt ?? now,
        createdBy: legacy.recordedBy ?? null,
        updatedAt: now,
        updatedBy: "migration:0084",
        archivedAt: null,
        revisionHash: "",
      };
      persistSpv(s);
      spvById.set(s.id, s);
      migratedFunds++;
    }
  } catch (err) {
    log.warn("[spvEngineStore] legacy migration failed (non-fatal):", (err as Error).message);
  }
  if (migratedSpvs || migratedFunds) {
    log.info?.(`[spvEngineStore] migrated ${migratedSpvs} legacy SPV(s), ${migratedFunds} legacy Fund(s) into canonical spv`);
  }
  return { spvs: migratedSpvs, funds: migratedFunds };
}

/* ── Wave B (v26.4.0) — shadow-persist helpers for legacy write paths ─────
 *
 * These functions replace the retired
 * `spvFundStore.shadowPersistFromLegacy` / `shadowCommitmentFromLegacy` sync
 * paths that used to write to the legacy relational `spvs`/`spv_commitments`
 * tables. They project every new partnerSpvStore create/position onto the
 * canonical engine `spv`/`spv_subscription` tables using the same
 * `spv_mig_<sha256(legacyId)[:24]>` id convention that
 * `migrateLegacyPartnerSpvAndFunds` uses, so a subsequent boot backfill is a
 * no-op (idempotent).
 *
 * They REUSE engine primitives — `persistSpv` and `_persistSub` — which:
 *   • write-through to DB via `persist()` (never RAM-only)
 *   • walk the engine's own hash chain via `chain()`
 *   • use INSERT … ON CONFLICT(id) DO UPDATE so re-shadow is safe
 *
 * Wave B.5 (planned) will eliminate the engine's read-cache Maps; these
 * helpers already do a real DB write on every call.
 * ---------------------------------------------------------------------------- */

function _migId(legacyId: string): string {
  return `spv_mig_${sha256Hex(legacyId).slice(0, 24)}`;
}

function _mapPartnerSpvStatusToEngine(st: string | undefined | null): SpvStatus {
  // Mirrors mapSpvStatus() used by migrateLegacyPartnerSpvAndFunds. Kept
  // identical so a row shadow-persisted here matches a row backfilled at boot.
  switch (st) {
    case "planned":    return "draft";
    case "open":       return "open";
    case "closed":     return "closed";
    case "wound_down": return "wound_down";
    default:           return "draft";
  }
}

/**
 * Wave B replacement for the retired spvFundStore.shadowPersistFromLegacy.
 * Projects a partnerSpvStore create onto the canonical engine `spv` table.
 *
 * Idempotent: re-invoking with the same legacyId writes the same engine id and
 * uses persistSpv's ON CONFLICT(id) DO UPDATE, so the second call is a safe
 * no-op / non-destructive update.
 *
 * The caller (partnerWorkspaceStore.partnerSpvStore.create) wraps this in a
 * swallow so the workspace path keeps working during the Wave B rollout
 * window; the engine's own boot backfill (migrateLegacyPartnerSpvAndFunds)
 * will reconcile any missed row on the NEXT restart.
 */
export function shadowPersistPartnerSpvToEngine(input: {
  legacyId: string;
  partnerId: string;
  name: string;
  currency?: string | null;
  totalCommittedMinor?: number | null;
  targetCompanyId?: string | null;
  jurisdiction?: string | null;
  recordedBy?: string | null;
  recordedAt?: string | null;
  status?: string | null;
  entityStructure?: string | null;
}): void {
  const id = _migId(input.legacyId);
  const now = nowIso();
  /* WAVE 4A / follow-up 2 — same policy as normJur above. */
  const jur = resolveSpvJurisdiction(input.jurisdiction) as SpvDTO["jurisdiction"];
  /* WAVE 4A / REVIEW-C — preserve the GP's original free text alongside the
     coerced enum (same key + rationale as withLegacyJur in the boot migration
     above), so a shadow-persisted row is never `skip-no-country`. */
  const rawJurText = typeof input.jurisdiction === "string" ? input.jurisdiction.trim() : "";
  const s: SpvDTO = {
    id,
    sponsorPartnerId: input.partnerId,
    gpUserId: input.recordedBy ?? null,
    name: input.name,
    spvType: "spv",
    jurisdiction: jur,
    status: _mapPartnerSpvStatusToEngine(input.status ?? undefined),
    distributionScope: "private",
    targetRaiseMinor: input.totalCommittedMinor ?? null,
    minCheckMinor: null,
    capMinor: null,
    currency: input.currency ?? "USD",
    carryBasis: "whole_spv", // legacy default; GP amends post-migration
    lpVisibility: SPV_DEFAULT_LP_VISIBILITY,
    targetCompanyId: input.targetCompanyId ?? null,
    closeDate: null,
    terms:
      rawJurText || input.entityStructure
        ? {
            ...(input.entityStructure ? { entityStructure: input.entityStructure } : {}),
            ...(rawJurText ? { legacyJurisdiction: rawJurText } : {}),
          }
        : null,
    migratedFrom: input.legacyId,
    createdAt: input.recordedAt ?? now,
    createdBy: input.recordedBy ?? null,
    updatedAt: now,
    updatedBy: "wave_b:shadow_persist",
    archivedAt: null,
    revisionHash: "",
  };
  persistSpv(s);
  spvById.set(s.id, s);
}

/**
 * Wave B v26.4.0-fix replacement for the retired
 * spvFundStore.shadowCommitmentFromLegacy. Projects a partnerSpvStore
 * position onto the canonical engine `spv_subscription` table.
 *
 * Contract (v26.4.0-fix):
 *  BLOCK-I: 1:1 (spv_id, investor_id) is enforced via the
 *    `uq_spv_subscription_spv_investor` UNIQUE constraint. Pre-check
 *    for existing (spv_id, investor_id) BEFORE persist — matches the
 *    platform's canonical `engine.subscribe()` pattern at line 852
 *    (`ALREADY_SUBSCRIBED`). If found, update the existing row's
 *    commitment_minor (idempotent re-shadow of the same position). No
 *    duplicate rows are created; no swallowed constraint violations.
 *  BLOCK-E: fail-CLOSED on orphan (parent SPV not in engine cache).
 *    Writes to `wave_b_orphan_subscriptions` quarantine table with
 *    full context so a subsequent boot can retry. Structured log
 *    emitted — no more silent drops.
 *  BLOCK-H: caller (partnerWorkspaceStore.addPosition) passes
 *    `normalizedMinor` (FX-normalized), not raw amount, so the value
 *    labeled with the parent's currency is arithmetically consistent.
 *  BLOCK-J: the `wave_b_orphan_subscriptions` quarantine is drained on
 *    every boot by `migrateLegacyPartnerSpvAndFunds` — an orphan whose
 *    parent lands later gets promoted to a real subscription then.
 *
 * Idempotency: repeat-call with same (spvId, investorId) is a safe
 * update; repeat-call with different amount promotes to a top-up on
 * the same subscription row (no duplicates).
 */
export function shadowCommitmentToEngine(input: {
  legacyPositionId: string;
  legacySpvId: string;
  partnerId: string;
  lpUserId: string;
  amountMinor: number;
}): { ok: true } | { ok: false; reason: "orphan_quarantined" | "orphan_lost" } {
  // v26.4.0-fix3 (GPT round-4 BLOCK-1): return the outcome so callers can
  // gate completion markers. Prior signature returned `void`, hiding the
  // difference between (a) commitment applied, (b) parent missing but
  // quarantined durably, and (c) parent missing AND quarantine also failed
  // — the third case is data loss unless the caller aborts / retries.
  const engineSpvId = _migId(input.legacySpvId);

  // Parent SPV MUST exist in engine before subscription (FK-by-convention).
  // v26.4.0-fix (BLOCK-E): quarantine orphans instead of silently dropping.
  const parent = spvById.get(engineSpvId);
  if (!parent) {
    const quarantined = _quarantineOrphanSubscription(input);
    return quarantined
      ? { ok: false, reason: "orphan_quarantined" }
      : { ok: false, reason: "orphan_lost" };
  }

  // v26.4.0-fix (BLOCK-I): 1:1 (spv, investor) — pre-check for an existing
  // subscription and reuse its id if present (matches engine.subscribe()
  // ALREADY_SUBSCRIBED semantics; shadow-persist is idempotent by design).
  const existing = (subsBySpv.get(engineSpvId) ?? []).find(
    (s) => s.investorId === input.lpUserId,
  );
  const now = nowIso();
  const engineSubId = existing
    ? existing.id
    : `spvsub_mig_${sha256Hex(input.legacyPositionId).slice(0, 22)}`;

  const sub: SpvSubscriptionDTO = {
    id: engineSubId,
    spvId: engineSpvId,
    investorId: input.lpUserId,
    investorPersona: "partner",
    // v26.4.0-fix4 (Opus F4-2 fix): if a subscription already exists for this
    // (spv, investor), the engine is authoritative for `commitmentMinor` —
    // it may have been amended via engine.subscribe() top-ups or downward
    // adjustments. NEVER overwrite it with the legacy amount on a re-run.
    // On first-time shadow-persist (no existing sub), take the legacy amount
    // as-is. This closes the retry-loop reassertion regression Opus flagged.
    commitmentMinor: existing?.commitmentMinor ?? input.amountMinor,
    wiredMinor: existing?.wiredMinor ?? 0,
    // v4 Opus O3-3 fix: subscription currency inherits from parent SPV.
    currency: parent.currency,
    status: existing?.status ?? "review",
    kycRef: existing?.kycRef ?? null,
    accreditationRef: existing?.accreditationRef ?? null,
    subscriptionDocRef: existing?.subscriptionDocRef ?? null,
    ownershipPct: existing?.ownershipPct ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revisionHash: "",
  };
  spvEngineStore._persistSub(sub);

  // Update the RAM cache in place (v26.4.0-fix GPT-5.6 BLOCK-I2: don't
  // blindly append — either replace by id or push new).
  const list = subsBySpv.get(engineSpvId) ?? [];
  const idx = list.findIndex((s) => s.id === sub.id);
  if (idx >= 0) {
    list[idx] = sub;
  } else {
    list.push(sub);
    subsBySpv.set(engineSpvId, list);
  }
  return { ok: true };
}

/**
 * Wave B v26.4.0-fix (BLOCK-E) — orphan quarantine.
 *
 * Writes a would-be subscription to `wave_b_orphan_subscriptions` when the
 * parent SPV isn't present in the engine yet. Drained by
 * `_drainOrphanSubscriptions()` on every boot after
 * `migrateLegacyPartnerSpvAndFunds()` has run — so an orphan whose parent
 * lands via a later shadow-persist or migration is promoted to a real
 * subscription automatically.
 *
 * The quarantine table is created lazily via IF NOT EXISTS. UNIQUE constraint
 * on (legacy_spv_id, lp_user_id) makes re-quarantine a no-op update.
 */
function _quarantineOrphanSubscription(input: {
  legacyPositionId: string;
  legacySpvId: string;
  partnerId: string;
  lpUserId: string;
  amountMinor: number;
}): boolean {
  // v26.4.0-fix3 (Gemini G-4): returns TRUE on successful quarantine, FALSE
  // on failure. Callers MUST check the return value and escalate (throw or
  // 5xx) when they can — a silent-drop here becomes irrecoverable data loss.
  // The DDL+upsert exceptions are no longer swallowed as void; the failure
  // signal propagates.
  //
  // On Postgres: rawDb() throws "not supported", so this function will always
  // return FALSE and log.error — the correct behaviour, because the legacy
  // spv/spv_subscription tables are not yet mirrored to PG. The caller in the
  // live subscribe path (spvEngineStore.subscribe) treats a false return as
  // "engine remains authoritative, adapter surface deferred" — no user-facing
  // failure, but a loud ops signal.
  try {
    const db = rawDb();
    db.exec(`CREATE TABLE IF NOT EXISTS wave_b_orphan_subscriptions (
      id TEXT PRIMARY KEY NOT NULL,
      legacy_spv_id TEXT NOT NULL,
      legacy_position_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      lp_user_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      quarantined_at TEXT NOT NULL,
      drained_at TEXT,
      UNIQUE (legacy_spv_id, lp_user_id)
    );`);
    const id = `orphan_${sha256Hex(input.legacyPositionId).slice(0, 24)}`;
    db.prepare(
      `INSERT INTO wave_b_orphan_subscriptions
        (id, legacy_spv_id, legacy_position_id, partner_id, lp_user_id, amount_minor, quarantined_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (legacy_spv_id, lp_user_id) DO UPDATE SET
         legacy_position_id = excluded.legacy_position_id,
         amount_minor = excluded.amount_minor,
         quarantined_at = excluded.quarantined_at,
         drained_at = NULL`,
    ).run(id, input.legacySpvId, input.legacyPositionId, input.partnerId,
          input.lpUserId, input.amountMinor, nowIso());
    log.warn?.(
      `[spvEngineStore] orphan quarantine: parent SPV missing for legacySpvId=${input.legacySpvId}; ` +
      `quarantined to wave_b_orphan_subscriptions (id=${id}). Will be drained on next boot.`,
    );
    return true;
  } catch (err) {
    // No silent drop: log.error escalates to whatever alerting tier the
    // logger is wired to (email, pagerduty, Sentry). Return false so the
    // caller can distinguish "quarantined successfully" from "data loss risk".
    log.error?.({
      route: "spvEngineStore._quarantineOrphanSubscription",
      code: "ORPHAN_QUARANTINE_FAILED",
      message: `orphan quarantine write failed: ${(err as Error).message}. ` +
        `Data loss risk: subscription (${input.legacySpvId}, ${input.lpUserId}, ${input.amountMinor}) not persisted to legacy or quarantine table.`,
      legacySpvId: input.legacySpvId,
      legacyPositionId: input.legacyPositionId,
      partnerId: input.partnerId,
      lpUserId: input.lpUserId,
      amountMinor: input.amountMinor,
    });
    return false;
  }
}

/**
 * Wave B v26.4.0-fix (BLOCK-E + BLOCK-J) — drain the orphan quarantine on
 * boot. For every orphan whose parent has now landed in the engine (either
 * via migrateLegacyPartnerSpvAndFunds or via shadow-persist), promote it
 * to a real spv_subscription row and mark the orphan row drained.
 *
 * Called from hydrateSpvEngineStore after the legacy backfill completes.
 */
export function drainOrphanSubscriptions(): { promoted: number; stillOrphaned: number } {
  let promoted = 0;
  let stillOrphaned = 0;
  try {
    const db = rawDb();
    // Table may not exist yet on installs that never triggered an orphan.
    db.exec(`CREATE TABLE IF NOT EXISTS wave_b_orphan_subscriptions (
      id TEXT PRIMARY KEY NOT NULL,
      legacy_spv_id TEXT NOT NULL,
      legacy_position_id TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      lp_user_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      quarantined_at TEXT NOT NULL,
      drained_at TEXT,
      UNIQUE (legacy_spv_id, lp_user_id)
    );`);
    const rows = db
      .prepare(
        `SELECT id, legacy_spv_id, legacy_position_id, partner_id, lp_user_id, amount_minor
           FROM wave_b_orphan_subscriptions
          WHERE drained_at IS NULL`,
      )
      .all() as Array<{
        id: string;
        legacy_spv_id: string;
        legacy_position_id: string;
        partner_id: string;
        lp_user_id: string;
        amount_minor: number;
      }>;

    for (const r of rows) {
      const engineSpvId = _migId(r.legacy_spv_id);
      const parent = spvById.get(engineSpvId);
      if (!parent) {
        stillOrphaned++;
        continue;
      }
      // Promote via shadowCommitmentToEngine (idempotent path).
      // v26.4.0-fix3 (GPT round-4 BLOCK-1): consume the outcome. Only mark
      // the orphan drained if promotion actually succeeded — if the caller
      // returns `orphan_*` for any reason (race, restart), leave the row so
      // the next boot retries.
      const result = shadowCommitmentToEngine({
        legacyPositionId: r.legacy_position_id,
        legacySpvId: r.legacy_spv_id,
        partnerId: r.partner_id,
        lpUserId: r.lp_user_id,
        amountMinor: r.amount_minor,
      });
      if (result.ok) {
        db.prepare(
          `UPDATE wave_b_orphan_subscriptions SET drained_at = ? WHERE id = ?`,
        ).run(nowIso(), r.id);
        promoted++;
      } else {
        stillOrphaned++;
      }
    }
    if (promoted || stillOrphaned) {
      log.info?.(
        `[spvEngineStore] drainOrphanSubscriptions: promoted=${promoted}, still_orphaned=${stillOrphaned}`,
      );
    }
  } catch (err) {
    log.warn?.(`[spvEngineStore] drainOrphanSubscriptions non-fatal error: ${(err as Error).message}`);
  }
  return { promoted, stillOrphaned };
}

/**
 * Wave B v26.4.0-fix (BLOCK-J) — backfill legacy child records
 * (`kv_partnerSpvPositions`, `kv_partnerFundCommitments`) into the canonical
 * `spv_subscription` table. Called from hydrateSpvEngineStore AFTER
 * migrateLegacyPartnerSpvAndFunds and drainOrphanSubscriptions.
 *
 * The prior implementation of `migrateLegacyPartnerSpvAndFunds` migrated ONLY
 * parent SPV/Fund headers, silently leaving every pre-Wave-B child money
 * record unmigrated (so `dbTotalSpvCommittedMinor` KPI would understate by
 * exactly the pre-migration total). This backfill closes GPT-5.6 T4-1.
 *
 * Idempotent via `_migrations_applied('wave_b_child_backfill_v1')`.
 */
export function backfillLegacyChildCommitments(): { positions: number; fundCommits: number; quarantined: number; lost: number } {
  let positions = 0;
  let fundCommits = 0;
  // v26.4.0-fix3 (GPT round-4 BLOCK-1): track quarantine outcomes so we can
  // refuse the completion marker if any row silently dropped. `quarantined`
  // = parent missing but row is durably persisted for later drain; `lost`
  // = parent missing AND quarantine write failed (data loss risk).
  let quarantined = 0;
  let lost = 0;
  const db = rawDb();
  try {
    // Idempotency gate.
    const already = db
      .prepare("SELECT 1 AS one FROM _migrations_applied WHERE key = 'wave_b_child_backfill_v1'")
      .get();
    // v26.4.0-fix4 (GPT round-5 BLOCK): return the full 4-field shape to
    // match the declared signature; TypeScript enforces this now.
    if (already) return { positions: 0, fundCommits: 0, quarantined: 0, lost: 0 };

    // Legacy kv_partnerSpvPositions rows are JSON payloads.
    // Authoritative DTO in partnerWorkspaceStore.ts (PartnerSpvPosition):
    //   { id, partnerSpvId, lpContactId, positionAmountMinor, currency,
    //     fxRateToSpvBase, fxLockedAt, positionStatus, ... }
    // Note the field is `positionStatus`, not `status` — possible values
    // include 'pledged'/'committed'/'wired'/'cancelled'. Skip cancelled.
    try {
      const rows = db
        .prepare("SELECT id, payload_json FROM kv_partnerSpvPositions WHERE deleted_at IS NULL")
        .all() as Array<{ id: string; payload_json: string }>;
      for (const r of rows) {
        try {
          const p = JSON.parse(r.payload_json) as {
            id?: string;
            partnerSpvId?: string;
            lpContactId?: string;
            positionAmountMinor?: number;
            currency?: string;
            fxRateToSpvBase?: string | null;
            positionStatus?: string;
          };
          if (!p.partnerSpvId || !p.lpContactId || typeof p.positionAmountMinor !== "number") continue;
          // Skip cancelled positions — they must not be recreated as active
          // `review` subscriptions.
          if (p.positionStatus === "cancelled" || p.positionStatus === "withdrawn") continue;
          /* BLOCK-H: apply FX normalization if the position carries a rate.
           * WAVE 35 · F5 (backfill site 3 of 4) — was
           * `Math.round(p.positionAmountMinor * rateNum)`, which omits the
           * 10^(expTo-expFrom) re-scale and is therefore off by exactly 100×
           * for JPY→USD. Same-exponent pairs (EUR→USD) were unaffected, which
           * is why it hid. The SPV's base currency comes from the parent engine
           * record; a position that cannot be converted is QUARANTINED, never
           * raw-summed into a total denominated in another currency. */
          const spvBaseCurrency =
            spvById.get(`spv_mig_${sha256Hex(p.partnerSpvId).slice(0, 24)}`)?.currency ?? null;
          /* If a rate is present we MUST know both currencies to pick the
           * exponent scale. A legacy row carrying a rate but no `currency` is
           * unconvertible — quarantine it (durable, drainable, logged) rather
           * than guessing. Guessing is what produced the 100× error. */
          if (p.fxRateToSpvBase && (!p.currency || !spvBaseCurrency)) {
            log.warn?.(
              `[spvEngineStore] backfill: position ${r.id} carries an FX rate but ` +
              `currency=${String(p.currency)} / spvBase=${String(spvBaseCurrency)} — ` +
              `cannot determine the ISO-4217 exponent scale; quarantining.`,
            );
            quarantined++;
            continue;
          }
          const conv = convertMinorUnits(
            p.positionAmountMinor,
            p.currency ?? spvBaseCurrency,
            spvBaseCurrency ?? p.currency,
            p.fxRateToSpvBase,
          );
          if (!conv.ok) {
            log.warn?.(
              `[spvEngineStore] backfill: position ${r.id} refused — ${conv.message}`,
            );
            quarantined++;
            continue;
          }
          const normalizedMinor = conv.minor;
          // v26.4.0-fix2 (Opus DEFECT-17): resolve partnerId from the engine
          // parent first (authoritative post-migration); fall back to the
          // legacy spvs row only if the engine hasn't been populated yet.
          const migId = `spv_mig_${sha256Hex(p.partnerSpvId).slice(0, 24)}`;
          const engineParent = spvById.get(migId);
          const partnerId = engineParent?.sponsorPartnerId
            ?? (db.prepare("SELECT partner_id FROM spvs WHERE id = ? LIMIT 1")
                  .get(p.partnerSpvId) as { partner_id?: string } | undefined)?.partner_id
            ?? null;
          if (!partnerId) {
            log.warn?.(`[spvEngineStore] backfill: position ${r.id} has no resolvable partnerId; quarantining`);
          }
          const result = shadowCommitmentToEngine({
            legacyPositionId: p.id ?? r.id,
            legacySpvId: p.partnerSpvId,
            partnerId: partnerId ?? "",
            lpUserId: p.lpContactId,
            amountMinor: normalizedMinor,
          });
          if (result.ok) positions++;
          else if (result.reason === "orphan_quarantined") quarantined++;
          else lost++;
        } catch (parseErr) {
          log.warn?.(`[spvEngineStore] backfill: kv_partnerSpvPositions row ${r.id} skipped: ${(parseErr as Error).message}`);
        }
      }
    } catch (err) {
      // kv_partnerSpvPositions may not exist — non-fatal.
      log.info?.(`[spvEngineStore] backfill: kv_partnerSpvPositions absent (${(err as Error).message})`);
    }

    // kv_partnerFundCommitments — authoritative DTO in
    // partnerWorkspaceStore.ts:378-393 is PartnerFundCommitment. Fields:
    //   { id, partnerFundId, lpContactId, commitmentMinor, currency,
    //     fxRateToFundBase, fxLockedAt, status, pledgedAt, ... }
    // v26.4.0-fix2 (GPT-5.6 DEFECT-2) — the prior implementation read
    // `commitmentAmountMinor` (does not exist), causing every fund commitment
    // to be silently skipped. Also `fxRateToFundBase` (not fxRateToSpvBase),
    // and status filtering to skip cancelled/withdrawn rows.
    try {
      const rows = db
        .prepare("SELECT id, payload_json FROM kv_partnerFundCommitments WHERE deleted_at IS NULL")
        .all() as Array<{ id: string; payload_json: string }>;
      for (const r of rows) {
        try {
          const c = JSON.parse(r.payload_json) as {
            id?: string;
            partnerFundId?: string;
            lpContactId?: string;
            commitmentMinor?: number;
            currency?: string;
            fxRateToFundBase?: string | null;
            status?: string;
          };
          if (!c.partnerFundId || !c.lpContactId || typeof c.commitmentMinor !== "number") continue;
          // Skip cancelled / withdrawn commitments — they must not be recreated
          // as active `review` subscriptions.
          if (c.status === "cancelled" || c.status === "withdrawn") continue;
          /* WAVE 35 · F5 (backfill site 4 of 4) — identical defect to the
           * position backfill above: the exponent re-scale was missing, so a
           * JPY commitment landed in a USD fund 100× too small. A commitment
           * that cannot be converted is quarantined, never raw-summed. */
          const fundBaseCurrency =
            spvById.get(`spv_mig_${sha256Hex(c.partnerFundId).slice(0, 24)}`)?.currency ?? null;
          /* Same rule as the position backfill above: a rate with an unknown
           * currency pair is unconvertible, so quarantine rather than guess. */
          if (c.fxRateToFundBase && (!c.currency || !fundBaseCurrency)) {
            log.warn?.(
              `[spvEngineStore] backfill: fund commitment ${r.id} carries an FX rate ` +
              `but currency=${String(c.currency)} / fundBase=${String(fundBaseCurrency)} — ` +
              `cannot determine the ISO-4217 exponent scale; quarantining.`,
            );
            quarantined++;
            continue;
          }
          const conv = convertMinorUnits(
            c.commitmentMinor,
            c.currency ?? fundBaseCurrency,
            fundBaseCurrency ?? c.currency,
            c.fxRateToFundBase,
          );
          if (!conv.ok) {
            log.warn?.(
              `[spvEngineStore] backfill: fund commitment ${r.id} refused — ${conv.message}`,
            );
            quarantined++;
            continue;
          }
          const normalizedMinor = conv.minor;
          // Resolve partnerId from the parent fund. Funds share the `spvs`
          // table (funds are spv_type='fund' in the engine, but the workspace
          // layer stores them separately). Try the parent engine record
          // first — that's the authoritative post-migration source.
          const migId = `spv_mig_${sha256Hex(c.partnerFundId).slice(0, 24)}`;
          const engineParent = spvById.get(migId);
          const partnerId = engineParent?.sponsorPartnerId
            ?? (db.prepare("SELECT partner_id FROM spvs WHERE id = ? LIMIT 1")
                  .get(c.partnerFundId) as { partner_id?: string } | undefined)?.partner_id
            ?? null;
          if (!partnerId) {
            log.warn?.(`[spvEngineStore] backfill: fund commitment ${r.id} has no resolvable partnerId; quarantining`);
            // Fall through with an empty partnerId sentinel so the quarantine
            // still records the row and log emits.
          }
          const result = shadowCommitmentToEngine({
            legacyPositionId: c.id ?? r.id,
            legacySpvId: c.partnerFundId,
            partnerId: partnerId ?? "",
            lpUserId: c.lpContactId,
            amountMinor: normalizedMinor,
          });
          if (result.ok) fundCommits++;
          else if (result.reason === "orphan_quarantined") quarantined++;
          else lost++;
        } catch (parseErr) {
          log.warn?.(`[spvEngineStore] backfill: kv_partnerFundCommitments row ${r.id} skipped: ${(parseErr as Error).message}`);
        }
      }
    } catch (err) {
      log.info?.(`[spvEngineStore] backfill: kv_partnerFundCommitments absent (${(err as Error).message})`);
    }

    // v26.4.0-fix3 (GPT round-4 BLOCK-1): only write the completion marker
    // when EVERY child row was either promoted or durably quarantined. If
    // any row was `orphan_lost` (parent missing AND quarantine failed),
    // refuse the marker so the next boot retries the backfill. Data loss
    // is preferred to be re-attempted rather than papered over.
    if (lost > 0) {
      log.error?.({
        route: "spvEngineStore.backfillLegacyChildCommitments",
        code: "BACKFILL_INCOMPLETE_DATA_LOSS_RISK",
        message:
          `Refusing to mark backfill complete: ${lost} child row(s) were orphaned AND quarantine write failed. ` +
          `Positions=${positions}, fundCommits=${fundCommits}, quarantined=${quarantined}, lost=${lost}. ` +
          `Next boot will retry the backfill.`,
      });
    } else {
      db.prepare(
        `INSERT INTO _migrations_applied (key, applied_at, details)
           VALUES ('wave_b_child_backfill_v1', ?,
                   'Wave B v26.4.0-fix legacy child backfill applied.')
           ON CONFLICT (key) DO NOTHING`,
      ).run(nowIso());
    }
    log.info?.(
      `[spvEngineStore] backfillLegacyChildCommitments: positions=${positions}, fundCommits=${fundCommits}, quarantined=${quarantined}, lost=${lost}`,
    );
  } catch (err) {
    log.error?.({
      route: "spvEngineStore.backfillLegacyChildCommitments",
      message: `backfill failed: ${(err as Error).message}`,
    });
    // On top-level failure, do not falsely report success.
    return { positions, fundCommits, quarantined, lost };
  }
  return { positions, fundCommits, quarantined, lost };
}

/* ── Wave B (v26.4.0) Stage 2 — Legacy SPV Adapter Methods ─────────────
 *
 * These 8 methods expose the legacy `spvFundStore` write/read surface
 * (spv_commitments, spv_capital_calls, spv_distributions, spv_positions,
 * plus reconcile) through the canonical `spvEngineStore` namespace.
 *
 * IMPORTANT: Wave B Stage 2 does NOT re-implement the hash-chain SQL. Each
 * adapter method DELEGATES to the corresponding `spvFundStore` method
 * (same file still resident under server/spvFundStore.ts). This preserves:
 *
 *   • all BigInt reconciliation math (SpvReconciliation formulas)
 *   • hash-chain integrity (prev_hash / curr_hash on 4 legacy tables)
 *   • tenant_id partitioning and rowid tiebreak
 *   • I-1 (capital-call monotonic sequence_no) and I-2 (distribution ≤
 *     commitment) financial invariants
 *   • denorm updates on `spvs.committed_minor` / `called_minor` /
 *     `distributed_minor`
 *
 * Wave B.5 (planned) fully inlines this SQL into the engine and drops
 * spvFundStore.ts entirely. Stage 2's contract-preserving delegation
 * keeps every legacy DTO shape byte-identical for the 10 wire routes.
 *
 * Call convention: partnerId first, actor last (engine convention).
 * Return types: legacy DTO shapes (SpvCommitmentRow, SpvCapitalCallRow, etc.)
 * so the adapter routes serialize the same JSON they always did.
 * ---------------------------------------------------------------------------- */

/** Wave B Stage 2 — addCommitment adapter. Delegates to spvFundStore.
 *  BLOCK-D fix: caller (route handler) validated `spv.partnerId === ctx.partnerId`,
 *  and spvFundStore.addCommitment loads the SPV by spvId and throws
 *  SPV_NOT_FOUND on missing/deleted, so ownership is enforced end-to-end. */
export function engineAddCommitment(args: {
  partnerId: string;
  spvId: string;
  lpUserId: string;
  amountMinor: number;
  commitmentDocUrl?: string | null;
}): SpvCommitmentRow {
  return spvFundStore.addCommitment({
    spvId: args.spvId,
    lpUserId: args.lpUserId,
    amountMinor: args.amountMinor,
    commitmentDocUrl: args.commitmentDocUrl ?? null,
  });
}

/** Wave B Stage 2 — transitionCommitment adapter.
 *  BLOCK-D fix: enforces `commitment.spvId === args.spvId` scoping BEFORE
 *  delegating, so an authenticated partner cannot mutate a commitment that
 *  belongs to a different SPV even if they know the commitmentId. */
export function engineTransitionCommitment(args: {
  partnerId: string;
  spvId: string;
  commitmentId: string;
  status: CommitmentStatus;
}): SpvCommitmentRow {
  // Cross-tenant guard — verify the commitment belongs to the URL-scoped SPV.
  const commitments = spvFundStore.listCommitments(args.spvId);
  const owned = commitments.find((c) => c.id === args.commitmentId);
  if (!owned) {
    // Preserve the legacy contract's 404 mapping. The route re-maps this to
    // 404 NOT_FOUND (see spvLegacyAdapters).
    throw new Error("COMMITMENT_NOT_FOUND");
  }
  return spvFundStore.transitionCommitment({
    commitmentId: args.commitmentId,
    status: args.status,
  });
}

/** Wave B Stage 2 — recordCapitalCall adapter (spv_capital_calls). */
export function engineRecordCapitalCall(args: {
  partnerId: string;
  spvId: string;
  amountMinor: number;
  calledAt?: string;
  dueAt?: string | null;
}): SpvCapitalCallRow {
  return spvFundStore.recordCapitalCall({
    spvId: args.spvId,
    amountMinor: args.amountMinor,
    calledAt: args.calledAt,
    dueAt: args.dueAt ?? null,
  });
}

/** Wave B Stage 2 — recordDistribution adapter (spv_distributions).
 *
 *  WAVE 3D / ITEM 1 — THIS ADAPTER IS NOW FAIL-CLOSED, at the writer.
 *
 *  W3 REVIEW A, CRITICAL: this exported function was the reachable head of a
 *  SECOND distribution write path. It delegated to the old
 *  `spvFundStore.recordDistribution`, which inserted straight into the legacy
 *  plural `spv_distributions` with NO allocator, NO COMBINED_CARRY_EXCEEDS_CAP,
 *  NO per-LP allocation and NO settlement authorization. The HTTP route was
 *  closed at spvLegacyAdapters.ts:393-403, but the API stayed callable from
 *  code — which is exactly the class of hole this wave exists to remove.
 *
 *  The delegation target is unchanged in SHAPE and now throws
 *  `LEGACY_DISTRIBUTION_LEDGER_DISABLED` unconditionally, so this adapter fails
 *  closed too. It is intentionally NOT deleted: it stays an exported function
 *  (server/__tests__/waveB_retirement_guard.test.ts:217 pins that export) and a
 *  loud throw here is strictly safer than a caller silently binding to
 *  `undefined` or a later wave re-adding its own INSERT.
 *
 *  MIGRATE TO: `spvEngineStore.recordDistribution` — the one authoritative
 *  guarded transaction, which resolves the DB-driven combined-carry cap, runs
 *  the nested integer allocator, requires a settlement authorization for any
 *  carry leg, and writes the canonical singular `spv_distribution`.
 *
 *  Tests that need a legacy plural fixture row use
 *  `spvFundStore.__unsafeSeedLegacyDistributionRowForTests` (NODE_ENV-guarded),
 *  which still enforces I-2 and throws
 *  INVARIANT_DISTRIBUTION_EXCEEDS_COMMITMENTS. */
export function engineRecordDistribution(args: {
  partnerId: string;
  spvId: string;
  distributionType?: DistributionType;
  totalMinor: number;
  distributedAt?: string;
}): SpvDistributionRow {
  return spvFundStore.recordDistribution({
    spvId: args.spvId,
    distributionType: args.distributionType,
    totalMinor: args.totalMinor,
    distributedAt: args.distributedAt,
  });
}

/** Wave B Stage 2 — recordPosition adapter (spv_positions). */
export function engineRecordLegacyPosition(args: {
  partnerId: string;
  spvId: string;
  securityId: string;
  shares: string;
  basisMinor: number;
  acquiredAt?: string | null;
}): SpvPositionRow {
  return spvFundStore.recordPosition({
    spvId: args.spvId,
    securityId: args.securityId,
    shares: args.shares,
    basisMinor: args.basisMinor,
    acquiredAt: args.acquiredAt ?? null,
  });
}

/** Wave B Stage 2 — listCommitments adapter (RAM-cache read for now). */
export function engineListLegacyCommitments(spvId: string): SpvCommitmentRow[] {
  return spvFundStore.listCommitments(spvId);
}

/** Wave B Stage 2 — listCapitalCalls adapter. */
export function engineListCapitalCalls(spvId: string): SpvCapitalCallRow[] {
  return spvFundStore.listCapitalCalls(spvId);
}

/** Wave B Stage 2 — listDistributions (LEGACY plural table) adapter.
 *
 *  NOTE: this is DISTINCT from the engine's own `spvEngineStore.listDistributions`
 *  which reads the singular `spv_distribution` table. Stage 2 preserves the
 *  legacy plural read path used by the /distributions route.
 */
export function engineListLegacyDistributions(spvId: string): SpvDistributionRow[] {
  return spvFundStore.listDistributions(spvId);
}

/** Wave B Stage 2 — listPositions adapter (LEGACY spv_positions table). */
export function engineListLegacyPositions(spvId: string): SpvPositionRow[] {
  return spvFundStore.listPositions(spvId);
}

/** Wave B Stage 2 — reconcile adapter. Returns BigInt SpvReconciliation. */
export function engineReconcileLegacySpv(spvId: string): SpvReconciliation {
  return spvFundStore.reconcile(spvId);
}

/** Wave B Stage 2 — getLegacySpvById adapter (RAM-cache header read).
 *  Used by the adapter routes for the initial ownership check
 *  (spv.partnerId === ctx.partnerId).
 */
export function engineGetLegacySpvById(spvId: string): SpvRow | null {
  return spvFundStore.getById(spvId);
}

/* ── hydrate-on-boot ────────────────────────────────────────────────────── */
export async function hydrateSpvEngineStore(): Promise<void> {
  const db = rawDb();
  try {
    spvById.clear(); mandateBySpv.clear(); feesBySpv.clear(); subsBySpv.clear();
    deploymentsBySpv.clear(); distributionsBySpv.clear(); docsBySpv.clear();
    transfersBySpv.clear(); complianceByInvestor.clear(); feeObligationsBySpv.clear();
    for (const k of Object.keys(chainTip)) delete chainTip[k];

    for (const r of db.prepare(`SELECT * FROM spv ORDER BY created_at ASC`).all() as any[]) {
      spvById.set(r.id, rowToSpv(r));
      chainTip["spv"] = r.curr_hash;
    }
    for (const r of db.prepare(`SELECT * FROM spv_mandate ORDER BY created_at ASC`).all() as any[]) {
      mandateBySpv.set(r.spv_id, rowToMandate(r));
      chainTip["spv_mandate"] = r.curr_hash;
    }
    /* WAVE 5 / S-3 — the fee load gets its OWN try/catch and records a durable
     * verdict. Previously it sat inside the one big try whose handler just
     * log.warn'd and continued, leaving `feesBySpv` EMPTY; `effectiveFee` then
     * returned null for every layer, `hasUnsettledFixedFees` skipped every
     * layer and returned FALSE, and the FEES_UNPAID gate at the cap-table
     * commit route silently OPENED. A read failure must degrade to "fees
     * unknown, stay shut", never to "all settled". */
    try {
      let feeRows = 0;
      for (const r of db.prepare(`SELECT * FROM spv_fee ORDER BY created_at ASC`).all() as any[]) {
        pushInto(feesBySpv, r.spv_id, rowToFee(r));
        chainTip["spv_fee"] = r.curr_hash;
        feeRows++;
      }
      recordFeeHydration("ok", feeRows, null);
    } catch (feeErr) {
      recordFeeHydration("failed", 0, (feeErr as Error).message);
      log.warn("[spvEngineStore] spv_fee hydration FAILED — fee gates fail closed:", (feeErr as Error).message);
      throw feeErr;
    }
    for (const r of db.prepare(`SELECT * FROM spv_subscription ORDER BY created_at ASC`).all() as any[]) {
      pushInto(subsBySpv, r.spv_id, rowToSub(r));
      chainTip["spv_subscription"] = r.curr_hash;
    }
    for (const r of db.prepare(`SELECT * FROM spv_deployment ORDER BY created_at ASC`).all() as any[]) {
      pushInto(deploymentsBySpv, r.spv_id, rowToDeployment(r));
      chainTip["spv_deployment"] = r.curr_hash;
    }
    for (const r of db.prepare(`SELECT * FROM spv_distribution ORDER BY created_at ASC`).all() as any[]) {
      pushInto(distributionsBySpv, r.spv_id, rowToDistribution(r));
      chainTip["spv_distribution"] = r.curr_hash;
    }
    for (const r of db.prepare(`SELECT * FROM spv_document ORDER BY created_at ASC`).all() as any[]) {
      pushInto(docsBySpv, r.spv_id, rowToDoc(r));
      chainTip["spv_document"] = r.curr_hash;
    }
    for (const r of db.prepare(`SELECT * FROM spv_transfer ORDER BY created_at ASC`).all() as any[]) {
      pushInto(transfersBySpv, r.spv_id, rowToTransfer(r));
      chainTip["spv_transfer"] = r.curr_hash;
    }
    for (const r of db.prepare(`SELECT * FROM investor_compliance_profile ORDER BY created_at ASC`).all() as any[]) {
      complianceByInvestor.set(r.investor_id, rowToCompliance(r));
      chainTip["investor_compliance_profile"] = r.curr_hash;
    }
    try {
      for (const r of db.prepare(`SELECT * FROM spv_fee_obligation ORDER BY created_at ASC`).all() as any[]) {
        pushInto(feeObligationsBySpv, r.spv_id, rowToFeeObligation(r));
        chainTip["spv_fee_obligation"] = r.curr_hash;
      }
    } catch { /* table may not exist pre-migration on an old DB — non-fatal */ }
    log.info?.(`[spvEngineStore] hydrated ${spvById.size} SPV(s)`);
  } catch (err) {
    log.warn("[spvEngineStore] hydrate failed (non-fatal):", (err as Error).message);
  }
  // One-time idempotent legacy backfill AFTER hydrate (so we don't re-migrate).
  try {
    migrateLegacyPartnerSpvAndFunds();
  } catch (err) {
    log.warn("[spvEngineStore] legacy backfill skipped:", (err as Error).message);
  }

  // Wave B v26.4.0-fix (BLOCK-E) — drain orphaned subscriptions whose parent
  // SPVs have now landed. Runs after the parent header backfill so pending
  // orphans get promoted to real subscriptions in the same boot.
  try {
    drainOrphanSubscriptions();
  } catch (err) {
    log.warn("[spvEngineStore] orphan drain skipped:", (err as Error).message);
  }

  // Wave B v26.4.0-fix (BLOCK-J) — one-time backfill of legacy child records
  // (kv_partnerSpvPositions, kv_partnerFundCommitments) into spv_subscription.
  // Gated by `wave_b_child_backfill_v1` marker; subsequent boots no-op.
  try {
    backfillLegacyChildCommitments();
  } catch (err) {
    log.warn("[spvEngineStore] legacy child backfill skipped:", (err as Error).message);
  }
}

/* ── row → DTO mappers ──────────────────────────────────────────────────── */
function jparse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
function rowToSpv(r: any): SpvDTO {
  return {
    id: r.id, sponsorPartnerId: r.sponsor_partner_id, gpUserId: r.gp_user_id, name: r.name,
    spvType: r.spv_type, jurisdiction: r.jurisdiction, status: r.status, distributionScope: r.distribution_scope,
    targetRaiseMinor: r.target_raise_minor, minCheckMinor: r.min_check_minor, capMinor: r.cap_minor,
    currency: r.currency, carryBasis: r.carry_basis, lpVisibility: r.lp_visibility ?? SPV_DEFAULT_LP_VISIBILITY,
    targetCompanyId: r.target_company_id, closeDate: r.close_date,
    terms: jparse(r.terms_json, null), migratedFrom: r.migrated_from, createdAt: r.created_at, createdBy: r.created_by,
    updatedAt: r.updated_at, updatedBy: r.updated_by, archivedAt: r.archived_at, revisionHash: r.curr_hash,
  };
}
function rowToMandate(r: any): SpvMandateDTO {
  return {
    id: r.id, spvId: r.spv_id, mode: r.mode, ruleTree: jparse(r.rule_tree_json, { op: "and", rules: [] }),
    geography: jparse(r.geography_json, []), sector: jparse(r.sector_json, []),
    companyIds: jparse(r.company_ids_json, []), stage: jparse(r.stage_json, []),
    checkMinMinor: r.check_min_minor, checkMaxMinor: r.check_max_minor, updatedAt: r.updated_at, revisionHash: r.curr_hash,
  };
}
function rowToFee(r: any): SpvFeeDTO {
  return {
    id: r.id, spvId: r.spv_id, layer: r.layer, feeType: r.fee_type, fixedAmountMinor: r.fixed_amount_minor,
    carryPct: r.carry_pct, currency: r.currency, effectiveDate: r.effective_date, setBy: r.set_by,
    createdAt: r.created_at, revisionHash: r.curr_hash,
  };
}
function rowToSub(r: any): SpvSubscriptionDTO {
  return {
    id: r.id, spvId: r.spv_id, investorId: r.investor_id, investorPersona: r.investor_persona,
    commitmentMinor: r.commitment_minor, wiredMinor: r.wired_minor, currency: r.currency, status: r.status,
    kycRef: r.kyc_ref, accreditationRef: r.accreditation_ref, subscriptionDocRef: r.subscription_doc_ref,
    ownershipPct: r.ownership_pct, createdAt: r.created_at, updatedAt: r.updated_at, revisionHash: r.curr_hash,
  };
}
function rowToDeployment(r: any): SpvDeploymentDTO {
  return {
    id: r.id, spvId: r.spv_id, companyId: r.company_id, companyRoundId: r.company_round_id, instrument: r.instrument,
    amountMinor: r.amount_minor, currency: r.currency, shares: r.shares, capTableLedgerRef: r.cap_table_ledger_ref,
    status: r.status, founderConfirmedAt: r.founder_confirmed_at, wiredAt: r.wired_at,
    wirePaymentRef: r.wire_payment_ref ?? null, closingDocRef: r.closing_doc_ref ?? null, deployedAt: r.deployed_at,
    createdAt: r.created_at, updatedAt: r.updated_at, revisionHash: r.curr_hash,
  };
}
function rowToDistribution(r: any): SpvDistributionDTO {
  return {
    id: r.id, spvId: r.spv_id, event: r.event, grossProceedsMinor: r.gross_proceeds_minor, currency: r.currency,
    /* WAVE 6 / SC-3 — read back the classification. A row written before 0153
       has no column at all; deriving from `event` here matches exactly what the
       migration's backfill will write, so the UI never differs before/after. */
    distributionType: r.distribution_type ?? distributionTypeFromEvent(r.event),
    waterfall: jparse(r.waterfall_json, []), allocations: jparse(r.allocations_json, []),
    gpCarryMinor: r.gp_carry_minor, platformCarryMinor: r.platform_carry_minor, status: r.status,
    createdAt: r.created_at, createdBy: r.created_by, revisionHash: r.curr_hash,
  };
}
function rowToDoc(r: any): SpvDocumentDTO {
  return {
    id: r.id, spvId: r.spv_id, docType: r.doc_type, title: r.title, storageKey: r.storage_key,
    storageBackend: r.storage_backend, contentType: r.content_type, sizeBytes: r.size_bytes, expiry: r.expiry,
    createdAt: r.created_at, createdBy: r.created_by,
  };
}
function rowToTransfer(r: any): SpvTransferDTO {
  return {
    id: r.id, spvId: r.spv_id, fromInvestorId: r.from_investor_id, toInvestorId: r.to_investor_id,
    unitsPct: r.units_pct, amountMinor: r.amount_minor, currency: r.currency, status: r.status,
    complianceRecheckRef: r.compliance_recheck_ref, gpApproval: r.gp_approval, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function rowToFeeObligation(r: any): SpvFeeObligationDTO {
  return {
    id: r.id, spvId: r.spv_id, layer: r.layer, portion: r.portion as SpvFeeObligationPortion,
    timing: r.timing as SpvFeeObligationTiming, amountMinor: r.amount_minor, currency: r.currency,
    state: r.state, paymentRef: r.payment_ref, distributionId: r.distribution_id,
    waivedBy: r.waived_by, waivedReason: r.waived_reason, createdAt: r.created_at,
    updatedAt: r.updated_at, revisionHash: r.curr_hash,
  };
}
function rowToCompliance(r: any): InvestorComplianceProfileDTO {
  return {
    investorId: r.investor_id, kycStatus: r.kyc_status, kycVerifiedAt: r.kyc_verified_at, kycExpiry: r.kyc_expiry,
    accreditationStatus: r.accreditation_status, accreditationCertifiedAt: r.accreditation_certified_at,
    jurisdiction: r.jurisdiction, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
