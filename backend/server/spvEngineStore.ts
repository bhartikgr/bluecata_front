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
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
import { emitBridgeEvent } from "./bridgeStore";
import { partnerSpvStore, partnerFundsStore } from "./partnerWorkspaceStore";
import { listForCompany as listSubscriptionsForCompany } from "./subscriptionStore";
import { getCompanyProfile } from "./companyProfileStore";
import { hasActiveOrLiveRound, getRoundsForCompany, ACTIVE_LIVE_ROUND_STATES } from "./roundsStore";
import { chargeOrIdempotent } from "./paymentStore";
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
import {
  SPV_DEFAULT_SCOPE,
  isSpvCarryBasis,
  isSpvJurisdiction,
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

function emit(eventType: string, aggregateId: string, payload: Record<string, unknown>): void {
  try {
    emitBridgeEvent({ eventType: eventType as never, aggregateId, aggregateKind: "platform", payload });
  } catch { /* non-fatal: audit bridge is best-effort, never blocks a money write */ }
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
      checkMinMinor: data.checkMinMinor ?? null,
      checkMaxMinor: data.checkMaxMinor ?? null,
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
    opts: { adminPlatform?: boolean } = {},
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
    emit("spv.fee_set", spvId, { partnerId, spvId, layer: f.layer, feeType: f.feeType, effectiveDate: f.effectiveDate });
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

  /** Plain-language breakdown shown to an investor (commitment / mgmt / platform / net). */
  feeBreakdown(spvId: string, commitmentMinor: number, currency: string, asOf?: string): SpvFeeBreakdown {
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
   *  the obligation failed and throws (never a silent pass). `outcome` mirrors
   *  the platform-wide demo-gateway seam (paymentChargeSchema.forceState). */
  chargeFeeObligation(
    partnerId: string,
    spvId: string,
    obligationId: string,
    customerId: string,
    outcome: "succeeded" | "failed" = "succeeded",
  ): SpvFeeObligationDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    const o = (feeObligationsBySpv.get(spvId) ?? []).find((x) => x.id === obligationId);
    if (!o) throw new Error("FEE_OBLIGATION_NOT_FOUND");
    if (o.state === "paid" || o.state === "waived") return o; // idempotent no-op
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
        forceState: outcome,
      });
      entryState = result.entry.state;
      entryId = result.entry.id;
    } catch {
      o.state = "failed"; o.updatedAt = nowIso();
      this._persistFeeObligation(o);
      throw new Error("FEE_COLLECTION_FAILED");
    }
    if (entryState !== "succeeded" && entryState !== "demo") {
      o.state = "failed"; o.paymentRef = entryId; o.updatedAt = nowIso();
      this._persistFeeObligation(o);
      throw new Error("FEE_COLLECTION_FAILED");
    }
    o.state = "paid"; o.paymentRef = entryId; o.updatedAt = nowIso();
    this._persistFeeObligation(o);
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
    outcome: "succeeded" | "failed",
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
    return this.chargeFeeObligation(partnerId, spvId, o.id, spvId, outcome);
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
    persist(
      "spv_subscription",
      `INSERT INTO spv_subscription (id, spv_id, investor_id, investor_persona, commitment_minor,
         wired_minor, currency, status, kyc_ref, accreditation_ref, subscription_doc_ref, ownership_pct,
         created_at, updated_at, updated_by, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         wired_minor=excluded.wired_minor, status=excluded.status, kyc_ref=excluded.kyc_ref,
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

  /* ---- Distributions / waterfall ---- */
  recordDistribution(
    partnerId: string,
    spvId: string,
    data: {
      event: string;
      grossProceedsMinor: number;
      currency?: string;
      costBasisMinor?: number;
      collectionOutcome?: "succeeded" | "failed";
    },
    actor: string,
  ): SpvDistributionDTO {
    const s = this.getSpv(partnerId, spvId);
    if (!s) throw new Error("SPV_NOT_FOUND");
    if (!data.event) throw new Error("EVENT_REQUIRED");
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

    const gpCarryMinor = Math.round(carryBaseMinor * gpCarryPct);
    const platformCarryMinor = Math.round(carryBaseMinor * platCarryPct);
    const totalCarryMinor = gpCarryMinor + platformCarryMinor;
    const distributable = gross - totalCarryMinor;

    // Per-LP gross/carry/net — net = gross − carry (NEVER 0 when carry applies).
    const allocations: SpvDistributionAllocation[] = register.map((r) => {
      const grossShare = Math.round(gross * r.ownershipPct);
      const carryShare = Math.round(totalCarryMinor * r.ownershipPct);
      return { investorId: r.investorId, grossMinor: grossShare, carryMinor: carryShare, netMinor: grossShare - carryShare };
    });
    const distId = newId("spvdist");

    // Collect carry THROUGH the existing payment ledger BEFORE persisting the
    // distribution — fail-closed: a collection failure aborts (throws) and the
    // distribution is never recorded.
    const outcome = data.collectionOutcome === "failed" ? "failed" : "succeeded";
    let gpCarryRef: string | null = null;
    let platformCarryRef: string | null = null;
    if (gpCarryMinor > 0) {
      gpCarryRef = this._collectCarryObligation(partnerId, spvId, "management", gpCarryMinor, data.currency ?? s.currency, distId, outcome).paymentRef;
    }
    if (platformCarryMinor > 0) {
      platformCarryRef = this._collectCarryObligation(partnerId, spvId, "platform", platformCarryMinor, data.currency ?? s.currency, distId, outcome).paymentRef;
    }

    const waterfall = [
      { tier: "return_of_capital", basis: s.carryBasis, amountMinor: returnOfCapitalMinor, costBasisMinor: eventCostBasis },
      { tier: "carry_base", basis: s.carryBasis, amountMinor: carryBaseMinor },
      { tier: "gp_carry", pct: gpCarryPct, amountMinor: gpCarryMinor, paymentRef: gpCarryRef },
      { tier: "platform_carry", pct: platCarryPct, amountMinor: platformCarryMinor, paymentRef: platformCarryRef },
      { tier: "pro_rata_lp", amountMinor: distributable },
    ];
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
    };
    const { prev, curr } = chain("spv_distribution", { ...dist, revisionHash: undefined });
    dist.revisionHash = curr;
    persist(
      "spv_distribution",
      `INSERT INTO spv_distribution (id, spv_id, event, gross_proceeds_minor, currency, waterfall_json,
         allocations_json, gp_carry_minor, platform_carry_minor, status, created_at, created_by, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [dist.id, spvId, dist.event, dist.grossProceedsMinor, dist.currency, JSON.stringify(dist.waterfall),
       JSON.stringify(dist.allocations), dist.gpCarryMinor, dist.platformCarryMinor, dist.status, now, actor ?? null, prev, curr],
    );
    pushInto(distributionsBySpv, spvId, dist);
    // Collect platform carry (audit + bridge; actual charge handled by fee runtime).
    emit("spv.distribution_recorded", spvId, { partnerId, spvId, distributionId: dist.id, gpCarryMinor, platformCarryMinor });
    return dist;
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
    const contributedMinor = this.committedRegister(partnerId, spvId).reduce((a, r) => a + r.commitmentMinor, 0);
    const mgmt = this.effectiveFee(spvId, "management");
    const plat = this.effectiveFee(spvId, "platform");
    const gpCarryPct = mgmt && mgmt.feeType !== "fixed" ? (mgmt.carryPct ?? 0) : 0;
    const platCarryPct = plat && plat.feeType !== "fixed" ? (plat.carryPct ?? 0) : 0;
    return computeDistributionSplit({
      grossProceedsMinor: input.grossProceedsMinor,
      contributedMinor,
      carryPct: gpCarryPct + platCarryPct,
      hurdleRatePct: input.hurdleRatePct ?? null,
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
  const normJur = (j: string): string => (isSpvJurisdiction(j) ? j : "delaware");

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
        terms: legacy.entityStructure ? { entityStructure: legacy.entityStructure } : null,
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
        terms: { fundType: legacy.fundType },
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
    for (const r of db.prepare(`SELECT * FROM spv_fee ORDER BY created_at ASC`).all() as any[]) {
      pushInto(feesBySpv, r.spv_id, rowToFee(r));
      chainTip["spv_fee"] = r.curr_hash;
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
