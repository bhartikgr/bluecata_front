/**
 * v25.49 Phase-4 — CANONICAL SPV Engine shared DTOs + enums.
 *
 * One engine, many CONTEXTS. An SPV is ALWAYS owned by the sponsoring
 * Consortium Partner as GP; Collective / Capavate / Partner are entry points
 * and visibility scopes over the SAME store (mirrors the Messages/Posts
 * one-store-many-contexts pattern). A Fund is simply an SPV with
 * spvType = "fund".
 *
 * These types live in shared/ so client wizard + server store + tests all
 * speak the same vocabulary with zero client↔server runtime imports. Money is
 * always integer minor units + an ISO-4217 currency string — never floats.
 */

/* ── enums ─────────────────────────────────────────────────────────────── */

/* v25.50.0 Phase 4 (spec 3c) — extended ADDITIVELY. The wizard surfaces five
 * GP-facing choices; the first three enum values pre-date this wave and are
 * left untouched so existing rows/tests keep validating. */
export const SPV_TYPES = ["spv", "fund", "syndicate", "multi_asset", "rolling_fund"] as const;
export type SpvType = (typeof SPV_TYPES)[number];

/** GP-facing labels + one-line help for the SPV Type dropdown (spec 3c). */
export const SPV_TYPE_LABELS: Record<SpvType, string> = {
  spv: "SPV: Single Deal",
  multi_asset: "SPV: Multi-Asset / Deal-by-Deal",
  syndicate: "Syndicate",
  fund: "Fund",
  rolling_fund: "Rolling Fund",
};
export const SPV_TYPE_HELP: Record<SpvType, string> = {
  spv: "One vehicle, one company. The classic single-asset SPV.",
  multi_asset: "One vehicle that invests in several companies, deal-by-deal, as opportunities arise.",
  syndicate: "A lead + backers co-investing per deal, typically with carry to the lead.",
  fund: "A committed-capital fund deploying across a portfolio under a single mandate.",
  rolling_fund: "A subscription-style fund that raises and deploys in recurring quarterly cycles.",
};

export const SPV_JURISDICTIONS = ["delaware", "cayman", "bvi", "canadian_lp"] as const;
export type SpvJurisdiction = (typeof SPV_JURISDICTIONS)[number];

export const SPV_STATUSES = [
  "draft", "open", "closed", "deployed", "distributing", "wound_down",
] as const;
export type SpvStatus = (typeof SPV_STATUSES)[number];

/** Distribution scope controls discovery/subscribe, INDEPENDENT of the mandate.
 *  `collective_only` is FIRST-CLASS: such SPVs must NOT appear on core Capavate
 *  investor surfaces. */
export const SPV_DISTRIBUTION_SCOPES = [
  "private", "collective_only", "network", "invite_only",
] as const;
export type SpvDistributionScope = (typeof SPV_DISTRIBUTION_SCOPES)[number];
export const SPV_DEFAULT_SCOPE: SpvDistributionScope = "private";

/** Carry basis — GP MUST choose explicitly at creation (no default). */
export const SPV_CARRY_BASES = ["per_deployment", "whole_spv"] as const;
export type SpvCarryBasis = (typeof SPV_CARRY_BASES)[number];

/**
 * LP co-investor visibility (Phase-4B / Ozan decision #5) — a per-SPV toggle
 * the GP chooses. own_only (default): each LP sees ONLY their own position.
 * co_investors: LPs can see co-investors' identities + commitments (a
 * transparent club-deal model). The founder/target NEVER sees the LP roster
 * in either mode (Private Investor contract, enforced server-side).
 */
export const SPV_LP_VISIBILITIES = ["own_only", "co_investors"] as const;
export type SpvLpVisibility = (typeof SPV_LP_VISIBILITIES)[number];
export const SPV_DEFAULT_LP_VISIBILITY: SpvLpVisibility = "own_only";

/* v25.50.0 Phase 4 (spec 3d) — extended ADDITIVELY (open/deal_specific pre-date
 * this wave). */
export const SPV_MANDATE_MODES = ["deal_specific", "open", "thesis_lp_approval", "sector_restricted"] as const;
export type SpvMandateMode = (typeof SPV_MANDATE_MODES)[number];

/** GP-facing labels + help for the Mandate mode dropdown (spec 3d). */
export const SPV_MANDATE_MODE_LABELS: Record<SpvMandateMode, string> = {
  deal_specific: "Deal-Specific (Single Asset)",
  open: "Open / Thesis-Driven (Blind Pool)",
  thesis_lp_approval: "Thesis with LP Approval",
  sector_restricted: "Sector / Stage-Restricted",
};
export const SPV_MANDATE_MODE_HELP: Record<SpvMandateMode, string> = {
  deal_specific: "The vehicle targets one specific, pre-identified company. LPs know exactly what they're funding.",
  open: "A blind pool: LPs back your thesis and you deploy at your discretion within the stated scope.",
  thesis_lp_approval: "You source under a thesis, but each deployment is put to LPs for approval before it closes.",
  sector_restricted: "A blind pool constrained to specific sectors and/or stages defined in the mandate rules.",
};

/** Spec 3b — curated TOP 10 global SPV jurisdictions (proper names, no
 * abbreviations). A country jurisdiction, DISTINCT from the legal-entity
 * `SPV_JURISDICTIONS` enum the engine still uses. Free-text "Other" is handled
 * separately by the wizard. */
export const SPV_TOP_JURISDICTION_COUNTRIES: readonly string[] = [
  "United States",
  "Cayman Islands",
  "British Virgin Islands",
  "United Kingdom",
  "Singapore",
  "Luxembourg",
  "Ireland",
  "Canada",
  "Hong Kong",
  "United Arab Emirates",
] as const;

/** Spec 3j — GP-facing distribution-scope labels (relabelled EXACTLY as the
 * spec requires) mapped to the existing SPV_DISTRIBUTION_SCOPES values. These
 * three are the only choices the wizard offers; enforcement is server-side
 * (Phase 5). */
export const SPV_DISTRIBUTION_SCOPE_WIZARD_OPTIONS: ReadonlyArray<{ value: SpvDistributionScope; label: string; help: string }> = [
  { value: "network", label: "Network (Collective)", help: "Discoverable across the Capavate Collective network of members." },
  { value: "invite_only", label: "Network (Invite Only)", help: "Visible only to investors you explicitly invite." },
  { value: "private", label: "Private", help: "Not discoverable anywhere — you manage the LP list entirely off-platform." },
];

export const SPV_FEE_LAYERS = ["management", "platform"] as const;
export type SpvFeeLayer = (typeof SPV_FEE_LAYERS)[number];

export const SPV_FEE_TYPES = ["fixed", "carry", "hybrid"] as const;
export type SpvFeeType = (typeof SPV_FEE_TYPES)[number];

/** Unified investment flow shared across all 3 LP personas. */
export const SPV_SUBSCRIPTION_STATUSES = [
  "review", "soft_circled", "founder_confirmed", "wire_funded", "committed", "withdrawn",
] as const;
export type SpvSubscriptionStatus = (typeof SPV_SUBSCRIPTION_STATUSES)[number];

export const SPV_INVESTOR_PERSONAS = ["collective", "capavate", "partner"] as const;
export type SpvInvestorPersona = (typeof SPV_INVESTOR_PERSONAS)[number];

export const SPV_DEPLOYMENT_STATUSES = [
  "pending", "founder_confirmed", "docs_sent", "wired", "deployed",
] as const;
export type SpvDeploymentStatus = (typeof SPV_DEPLOYMENT_STATUSES)[number];

export const SPV_DOC_TYPES = [
  "formation", "operating_agreement", "subscription", "formd", "blue_sky", "kyc", "tax",
] as const;
export type SpvDocType = (typeof SPV_DOC_TYPES)[number];

export const SPV_TRANSFER_STATUSES = [
  "proposed", "compliance_recheck", "gp_approved", "settled", "rejected",
] as const;
export type SpvTransferStatus = (typeof SPV_TRANSFER_STATUSES)[number];

/* Compliance gate vocab (reusable, investor-level). */
export const KYC_STATUSES = ["none", "pending", "verified", "expired", "manual_review"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];
export const ACCREDITATION_STATUSES = ["none", "self_certified", "verified", "manual_review"] as const;
export type AccreditationStatus = (typeof ACCREDITATION_STATUSES)[number];

/* ── mandate rule tree (composable AND/OR) ─────────────────────────────── */

export type MandateLeafField = "geography" | "sector" | "company_id" | "stage" | "check_size";
export type MandateLeafOp = "in" | "eq" | "gte" | "lte";

export interface MandateLeaf {
  field: MandateLeafField;
  op: MandateLeafOp;
  value: string | number | string[];
}
export interface MandateNode {
  op: "and" | "or";
  rules: Array<MandateLeaf | MandateNode>;
}
export type MandateRuleTree = MandateNode;

/* ── DTOs ──────────────────────────────────────────────────────────────── */

export interface SpvDTO {
  id: string;
  sponsorPartnerId: string;
  gpUserId: string | null;
  name: string;
  spvType: SpvType;
  jurisdiction: SpvJurisdiction;
  status: SpvStatus;
  distributionScope: SpvDistributionScope;
  targetRaiseMinor: number | null;
  minCheckMinor: number | null;
  capMinor: number | null;
  currency: string;
  carryBasis: SpvCarryBasis;
  lpVisibility: SpvLpVisibility;
  targetCompanyId: string | null;
  closeDate: string | null;
  terms: Record<string, unknown> | null;
  migratedFrom: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  archivedAt: string | null;
  revisionHash: string;
}

export interface SpvMandateDTO {
  id: string;
  spvId: string;
  mode: SpvMandateMode;
  ruleTree: MandateRuleTree;
  geography: string[];
  sector: string[];
  companyIds: string[];
  stage: string[];
  checkMinMinor: number | null;
  checkMaxMinor: number | null;
  updatedAt: string;
  revisionHash: string;
}

export interface SpvFeeDTO {
  id: string;
  spvId: string;
  layer: SpvFeeLayer;
  feeType: SpvFeeType;
  fixedAmountMinor: number | null;
  carryPct: number | null;
  currency: string;
  effectiveDate: string;
  setBy: string | null;
  createdAt: string;
  revisionHash: string;
}

export interface SpvSubscriptionDTO {
  id: string;
  spvId: string;
  investorId: string;
  investorPersona: SpvInvestorPersona | null;
  commitmentMinor: number;
  wiredMinor: number;
  currency: string;
  status: SpvSubscriptionStatus;
  kycRef: string | null;
  accreditationRef: string | null;
  subscriptionDocRef: string | null;
  ownershipPct: number | null;
  createdAt: string;
  updatedAt: string;
  revisionHash: string;
}

export interface SpvDeploymentDTO {
  id: string;
  spvId: string;
  companyId: string;
  companyRoundId: string;
  instrument: string | null;
  amountMinor: number;
  currency: string;
  shares: string | null;
  capTableLedgerRef: string | null;
  status: SpvDeploymentStatus;
  founderConfirmedAt: string | null;
  wiredAt: string | null;
  // Blocker 2 (4D): REAL funding proof. `wirePaymentRef` MUST be supplied on the
  // `wired` transition and re-validated before the cap-table ledger commit; a
  // closing-doc ref is captured alongside as typed provenance. `wired` is not a
  // mere status flip — it asserts money actually moved.
  wirePaymentRef: string | null;
  closingDocRef: string | null;
  deployedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revisionHash: string;
}

export interface SpvDistributionAllocation {
  investorId: string;
  grossMinor: number;
  carryMinor: number;
  netMinor: number;
}
export interface SpvDistributionDTO {
  id: string;
  spvId: string;
  event: string;
  grossProceedsMinor: number;
  currency: string;
  waterfall: Array<Record<string, unknown>>;
  allocations: SpvDistributionAllocation[];
  gpCarryMinor: number;
  platformCarryMinor: number;
  status: string;
  createdAt: string;
  createdBy: string | null;
  revisionHash: string;
}

export interface SpvDocumentDTO {
  id: string;
  spvId: string;
  docType: SpvDocType;
  title: string | null;
  storageKey: string;
  storageBackend: string;
  contentType: string | null;
  sizeBytes: number | null;
  expiry: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface SpvTransferDTO {
  id: string;
  spvId: string;
  fromInvestorId: string;
  toInvestorId: string;
  unitsPct: number | null;
  amountMinor: number | null;
  currency: string;
  status: SpvTransferStatus;
  complianceRecheckRef: string | null;
  gpApproval: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvestorComplianceProfileDTO {
  investorId: string;
  kycStatus: KycStatus;
  kycVerifiedAt: string | null;
  kycExpiry: string | null;
  accreditationStatus: AccreditationStatus;
  accreditationCertifiedAt: string | null;
  jurisdiction: string | null;
  createdAt: string;
  updatedAt: string;
}

/* Plain-language fee breakdown shown to an investor at subscription time. */
export interface SpvFeeBreakdown {
  commitmentMinor: number;
  managementFeeMinor: number;
  platformFeeMinor: number;
  netDeployedMinor: number;
  currency: string;
  managementCarryPct: number | null;
  platformCarryPct: number | null;
}

/* ── fee obligations (money-movement-safe fee timing, Phase-4C / Blocker 3) ──
 * A fee OBLIGATION is a concrete money-movement row (distinct from the SpvFeeDTO
 * fee CONFIG). FIXED portions of fixed/hybrid fees are accrued AT FUNDING and
 * MUST be paid (or admin-waived) before commitment/deployment. CARRY portions of
 * carry/hybrid fees are accrued AT DISTRIBUTION and collected with a recorded
 * payment ref (fail-closed on collection failure). */
export const SPV_FEE_OBLIGATION_PORTIONS = ["fixed", "carry"] as const;
export type SpvFeeObligationPortion = (typeof SPV_FEE_OBLIGATION_PORTIONS)[number];
export const SPV_FEE_OBLIGATION_TIMINGS = ["funding", "distribution"] as const;
export type SpvFeeObligationTiming = (typeof SPV_FEE_OBLIGATION_TIMINGS)[number];
export const SPV_FEE_OBLIGATION_STATES = ["pending", "paid", "waived", "failed"] as const;
export type SpvFeeObligationState = (typeof SPV_FEE_OBLIGATION_STATES)[number];

export interface SpvFeeObligationDTO {
  id: string;
  spvId: string;
  layer: SpvFeeLayer;
  portion: SpvFeeObligationPortion;
  timing: SpvFeeObligationTiming;
  amountMinor: number;
  currency: string;
  state: SpvFeeObligationState;
  paymentRef: string | null;
  distributionId: string | null;
  waivedBy: string | null;
  waivedReason: string | null;
  createdAt: string;
  updatedAt: string;
  revisionHash: string;
}

export function isSpvFeeObligationState(v: unknown): v is SpvFeeObligationState {
  return typeof v === "string" && (SPV_FEE_OBLIGATION_STATES as readonly string[]).includes(v);
}

/* ── type guards ───────────────────────────────────────────────────────── */

export function isSpvJurisdiction(v: unknown): v is SpvJurisdiction {
  return typeof v === "string" && (SPV_JURISDICTIONS as readonly string[]).includes(v);
}
export function isSpvCarryBasis(v: unknown): v is SpvCarryBasis {
  return typeof v === "string" && (SPV_CARRY_BASES as readonly string[]).includes(v);
}
export function isSpvDistributionScope(v: unknown): v is SpvDistributionScope {
  return typeof v === "string" && (SPV_DISTRIBUTION_SCOPES as readonly string[]).includes(v);
}
export function isSpvLpVisibility(v: unknown): v is SpvLpVisibility {
  return typeof v === "string" && (SPV_LP_VISIBILITIES as readonly string[]).includes(v);
}
export function isSpvType(v: unknown): v is SpvType {
  return typeof v === "string" && (SPV_TYPES as readonly string[]).includes(v);
}
export function isSpvMandateMode(v: unknown): v is SpvMandateMode {
  return typeof v === "string" && (SPV_MANDATE_MODES as readonly string[]).includes(v);
}
export function isSpvFeeLayer(v: unknown): v is SpvFeeLayer {
  return typeof v === "string" && (SPV_FEE_LAYERS as readonly string[]).includes(v);
}
export function isSpvFeeType(v: unknown): v is SpvFeeType {
  return typeof v === "string" && (SPV_FEE_TYPES as readonly string[]).includes(v);
}

/** Plain-language one-liners for the dead-simple carry-basis wizard step. */
export const SPV_CARRY_BASIS_HELP: Record<SpvCarryBasis, string> = {
  per_deployment:
    "Carry is calculated separately on each company you invest in — gains and losses are not netted across deals.",
  whole_spv:
    "Carry is calculated once on the SPV's total return — winners and losers are netted together before carry.",
};
