/**
 * W-MFCRM — Managed Founder CRM orchestration engine.
 *
 * This is the engine/orchestration layer (design D-1): it OWNS the additive
 * `mf_*` tables (see server/lib/mfcrmSchema.ts) but DELEGATES CRM-row
 * persistence to the existing non-sacred stores — `partnerClientCrmStore`
 * (Partner / General CRM) and `founderCrmStore` (Founder CRM copy-in on
 * graduation). It NEVER writes the sacred `investorCrmStore`, and ALL money
 * flows through the sacred `commitFunded` ledger — there is no parallel money
 * path here.
 *
 * FAIL-CLOSED isolation: every method takes a session-resolved `partnerId`
 * (never a URL/body value) and calls `requirePid`. The route layer additionally
 * verifies the target `companyId` is attributed to that partner (§ D-7). Reads
 * come from rebuildable RAM projections hydrated at boot by
 * `hydrateManagedFounderStore()`; writes flow through to the durable `mf_*`
 * tables in the same call (the partnerClientCrmStore write-through pattern).
 *
 * SIX capability gates (§5.1) are enforced here as `GateError`-throwing helpers
 * and re-checked at the route layer. Money/authority gates (3/4/5) assert
 * `engagement.status === 'ACTIVE'`; delegated-write-on-behalf ops (gate 3) ALSO
 * assert per-engagement `mode === 'A'` + a present, non-expired
 * `authority_artifact_ref` (D-9) — global capability toggles alone are NOT
 * sufficient authority.
 */
import { randomUUID, createHash } from "crypto";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
import { applyMfcrmSchema } from "./lib/mfcrmSchema";
import { applyWave38EventLedgerSchemaOnce } from "./lib/applyWave38EventLedgerSchema";
import { getById as getContactById } from "./adminContactsStoreShim";
import type { PartnerType } from "./adminContactsStore";
import { commitFunded } from "./captableCommitStore";
import { spvEngineStore } from "./spvEngineStore";
import { upsertInvestorContactFromPartner } from "./founderCrmStore";

/* ---------- Types ---------- */

export type EngagementMode = "A" | "B";
export type EngagementStatus = "ACTIVE" | "LAPSED" | "HANDED_OVER" | "TERMINATED";

export interface CapabilityProfile {
  partnerId: string;
  partnerType: PartnerType | null;
  classified: boolean;
  sourcesCapital: boolean;
  delegatedAgency: boolean;
  spvWriteAuthority: boolean;
  advisoryCoseat: boolean;
  documentCustody: boolean;
  paysOnBehalf: boolean;
  attributionTracking: boolean;
  collectiveFronting: boolean;
  chapterScoping: boolean;
  fundAdmin: boolean;
  updatedAt: string | null;
}

/**
 * WAVE 17 ORP-031 — a hand-over row as the API returns it. Mirrors the columns of
 * `mf_handover` (server/lib/mfcrmSchema.ts:136-150) exactly; no derived or
 * invented fields.
 */
export interface Handover {
  id: string;
  partnerId: string;
  engagementId: string;
  companyId: string;
  direction: "A_TO_B" | "B_TO_A";
  initiatorParty: "partner" | "founder";
  initiatedBy: string | null;
  status: string;
  authorityArtifactRef: string | null;
  authorityExpiresAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

function rowToHandover(r: any): Handover {
  return {
    id: String(r.id),
    partnerId: String(r.partner_id),
    engagementId: String(r.engagement_id),
    companyId: String(r.company_id),
    direction: r.direction === "B_TO_A" ? "B_TO_A" : "A_TO_B",
    initiatorParty: r.initiator_party === "founder" ? "founder" : "partner",
    initiatedBy: r.initiated_by ?? null,
    status: String(r.status),
    authorityArtifactRef: r.authority_artifact_ref ?? null,
    authorityExpiresAt: r.authority_expires_at ?? null,
    createdAt: String(r.created_at),
    confirmedAt: r.confirmed_at ?? null,
    confirmedBy: r.confirmed_by ?? null,
  };
}

export interface Engagement {
  id: string;
  partnerId: string;
  companyId: string;
  mode: EngagementMode;
  status: EngagementStatus;
  authorityArtifactRef: string | null;
  authorityExpiresAt: string | null;
  trialExpiresAt: string | null;
  chapterId: string | null;
  matterId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CapabilityKey =
  | "sourcesCapital" | "delegatedAgency" | "spvWriteAuthority" | "advisoryCoseat"
  | "documentCustody" | "paysOnBehalf" | "attributionTracking" | "collectiveFronting"
  | "chapterScoping" | "fundAdmin";

/** Typed gate failure — routes map `.code` to the right HTTP status. */
export class GateError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "GateError";
  }
}

/* ---------- RAM projections (rebuilt on boot from the DB) ---------- */

const profileByPartner = new Map<string, CapabilityProfile>();
const engagementById = new Map<string, Engagement>();

function requirePid(partnerId: string): void {
  if (!partnerId || typeof partnerId !== "string") throw new Error("PARTNER_ID_REQUIRED");
}

function nowIso(): string {
  return new Date().toISOString();
}

function isExpired(iso: string | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t <= Date.now();
}

/** The fail-closed most-restrictive profile for an unclassified partner. */
function unclassifiedProfile(partnerId: string): CapabilityProfile {
  return {
    partnerId,
    partnerType: null,
    classified: false,
    sourcesCapital: false,
    delegatedAgency: false,
    spvWriteAuthority: false,
    advisoryCoseat: false,
    documentCustody: false,
    paysOnBehalf: false,
    attributionTracking: false,
    collectiveFronting: false,
    chapterScoping: false,
    fundAdmin: false,
    updatedAt: null,
  };
}

/** Seed defaults per partner_type (admin-overridable afterwards, RF-10). */
function seedDefaultsForType(partnerType: PartnerType | null): Partial<CapabilityProfile> {
  switch (partnerType) {
    case "investment_bank":
      return {
        sourcesCapital: true, delegatedAgency: true, spvWriteAuthority: true,
        advisoryCoseat: true, attributionTracking: true, collectiveFronting: true,
      };
    case "angel_network":
      // Capital sourcer; co-seat (Mode-B) default — NO delegated agency by default.
      return {
        sourcesCapital: true, attributionTracking: true, collectiveFronting: true,
        chapterScoping: true, advisoryCoseat: true,
      };
    case "accounting":
      // Service firm: firm-of-record, NOT a capital sourcer (investor spine off).
      return {
        sourcesCapital: false, delegatedAgency: true, documentCustody: true,
        paysOnBehalf: true, fundAdmin: true, attributionTracking: false,
      };
    case "law":
      // Service firm: counsel-of-record, sources_capital=false disables spine.
      return {
        sourcesCapital: false, delegatedAgency: true, documentCustody: true,
        attributionTracking: false,
      };
    case "accelerator":
    case "incubator":
      return { sourcesCapital: true, attributionTracking: true, advisoryCoseat: true };
    case "professional_services":
      return { documentCustody: true, advisoryCoseat: true };
    default:
      return {};
  }
}

/**
 * WAVE 7B DA-1 — the capability seed types that actually carry defaults.
 *
 * Derived from the switch in seedDefaultsForType above rather than re-declared
 * loosely: anything outside this set lands on `default: return {}`, which seeds
 * an all-false profile. Before this wave that happened SILENTLY. Validating
 * against the set turns it into an explicit error, so an admin cannot seed a
 * partner into a fail-closed profile by typo.
 */
/* Declared as an ARRAY, not a Set. This tsconfig targets below es2015 and does
   not set downlevelIteration, so spreading a Set is a compile error — the
   constraint on this wave is zero net-new tsc errors, and the first draft of
   this constant cost exactly one. indexOf over seven strings is not a hot
   path. */
/* WAVE 17 ORP-031 — now EXPORTED so the admin capability surface renders the
   seedable types from this one declaration instead of re-hardcoding the list in
   the client (`GET /api/admin/mfcrm/capability/:partnerId` returns it). The set
   itself is unchanged. */
export const SEEDABLE_PARTNER_TYPES: readonly string[] = [
  "investment_bank",
  "angel_network",
  "accounting",
  "law",
  "accelerator",
  "incubator",
  "professional_services",
];

/* ---------- DB persistence (strict, fail-closed) ---------- */

function profileToRow(p: CapabilityProfile): any[] {
  const b = (v: boolean) => (v ? 1 : 0);
  return [
    p.partnerId, p.partnerType ?? null, b(p.classified), b(p.sourcesCapital), b(p.delegatedAgency),
    b(p.spvWriteAuthority), b(p.advisoryCoseat), b(p.documentCustody), b(p.paysOnBehalf),
    b(p.attributionTracking), b(p.collectiveFronting), b(p.chapterScoping), b(p.fundAdmin),
  ];
}

function persistProfile(p: CapabilityProfile, actor: string | null): void {
  const now = nowIso();
  p.updatedAt = now;
  try {
    rawDb().prepare(
      `INSERT INTO mf_capability_profile (
         partner_id, partner_type, classified, sources_capital, delegated_agency,
         spv_write_authority, advisory_coseat, document_custody, pays_on_behalf,
         attribution_tracking, collective_fronting, chapter_scoping, fund_admin,
         created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(partner_id) DO UPDATE SET
         partner_type=excluded.partner_type, classified=excluded.classified,
         sources_capital=excluded.sources_capital, delegated_agency=excluded.delegated_agency,
         spv_write_authority=excluded.spv_write_authority, advisory_coseat=excluded.advisory_coseat,
         document_custody=excluded.document_custody, pays_on_behalf=excluded.pays_on_behalf,
         attribution_tracking=excluded.attribution_tracking, collective_fronting=excluded.collective_fronting,
         chapter_scoping=excluded.chapter_scoping, fund_admin=excluded.fund_admin,
         updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
    ).run(...profileToRow(p), now, now, actor ?? null);
  } catch (err) {
    log.warn("[managedFounderStore] profile write-through failed:", (err as Error).message);
    throw new Error(`STRICT_PERSIST_FAILED: mf_capability_profile.${p.partnerId}: ${(err as Error).message}`);
  }
}

function persistEngagement(e: Engagement): void {
  try {
    rawDb().prepare(
      `INSERT INTO mf_engagement (
         id, partner_id, company_id, mode, status, authority_artifact_ref,
         authority_expires_at, trial_expires_at, chapter_id, matter_id,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         mode=excluded.mode, status=excluded.status,
         authority_artifact_ref=excluded.authority_artifact_ref,
         authority_expires_at=excluded.authority_expires_at,
         trial_expires_at=excluded.trial_expires_at,
         chapter_id=excluded.chapter_id, matter_id=excluded.matter_id,
         updated_at=excluded.updated_at`,
    ).run(
      e.id, e.partnerId, e.companyId, e.mode, e.status, e.authorityArtifactRef ?? null,
      e.authorityExpiresAt ?? null, e.trialExpiresAt ?? null, e.chapterId ?? null, e.matterId ?? null,
      e.createdBy ?? null, e.createdAt, e.updatedAt,
    );
  } catch (err) {
    log.warn("[managedFounderStore] engagement write-through failed:", (err as Error).message);
    throw new Error(`STRICT_PERSIST_FAILED: mf_engagement.${e.id}: ${(err as Error).message}`);
  }
}

function recordEvent(partnerId: string, engagementId: string, companyId: string, eventType: string, detail: Record<string, unknown> | null, actor: string | null): void {
  try {
    rawDb().prepare(
      // WAVE 38 ROW 4 — canonical event columns (migration 0183). `actor_id` is
      // NOT NULL; 'system' names a machine-originated transition honestly
      // rather than inventing a user. `seq` is per-parent over
      // (partner_id, engagement_id) and is derived in-statement.
      `INSERT INTO mf_engagement_event
         (id, partner_id, engagement_id, company_id, event_type, detail_json, actor,
          actor_id, seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?,
               (SELECT COALESCE(MAX(seq), 0) + 1 FROM mf_engagement_event
                 WHERE partner_id = ? AND engagement_id IS ?),
               ?)`,
    ).run(
      `mfev_${randomUUID()}`, partnerId, engagementId, companyId, eventType,
      detail ? JSON.stringify(detail) : null, actor ?? null,
      (actor ?? "").trim() === "" ? "system" : (actor as string).trim(),
      partnerId, engagementId,
      nowIso(),
    );
  } catch (err) {
    log.warn("[managedFounderStore] event write-through failed:", (err as Error).message);
    throw new Error(`STRICT_PERSIST_FAILED: mf_engagement_event.${engagementId}: ${(err as Error).message}`);
  }
}

function recordAudit(partnerId: string, action: string, opts: { engagementId?: string | null; companyId?: string | null; agentUserId?: string | null; principalRef?: string | null; disclosure?: Record<string, unknown> | null }): void {
  try {
    rawDb().prepare(
      `INSERT INTO mf_audit (id, partner_id, engagement_id, company_id, action, agent_user_id, principal_ref, disclosure_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `mfaud_${randomUUID()}`, partnerId, opts.engagementId ?? null, opts.companyId ?? null, action,
      opts.agentUserId ?? null, opts.principalRef ?? null, opts.disclosure ? JSON.stringify(opts.disclosure) : null, nowIso(),
    );
  } catch (err) {
    log.warn("[managedFounderStore] audit write-through failed:", (err as Error).message);
    throw new Error(`STRICT_PERSIST_FAILED: mf_audit.${partnerId}: ${(err as Error).message}`);
  }
}

/* ---------- The store ---------- */

export const managedFounderStore = {
  /* ===== Capability profile ===== */

  /** Fail-closed read: an unseeded partner is UNCLASSIFIED (most restrictive). */
  getCapabilityProfile(partnerId: string): CapabilityProfile {
    requirePid(partnerId);
    return profileByPartner.get(partnerId) ?? unclassifiedProfile(partnerId);
  },

  /**
   * Seed a classified profile from the partner's `partner_type` (admin op).
   *
   * WAVE 7B DA-1 — SIGNATURE CORRECTION.
   *
   * The third parameter is new and OPTIONAL, so every existing call site keeps
   * its current behaviour verbatim.
   *
   * THE DEFECT. `contacts.partner_type` is the legacy 7-value capability union
   * (server/adminContactsStore.ts:278). Partner taxonomy has since moved to
   * `partner_classifications` (the 87/11 set, migration 0149), and
   * `partner_type` is retained READ-ONLY — nothing writes it going forward, as
   * a grep for an UPDATE/INSERT against that column confirms. So for any
   * partner classified after Wave 4B this read returns null, seedDefaultsForType
   * falls to its `default: return {}` branch, `classified` is set false, and
   * the admin gets a silently UNCLASSIFIED profile — which GATE 1
   * (`assertClassified`) then uses to refuse engagement creation. The admin's
   * only recourse was to flip capability booleans one at a time through
   * setCapabilityProfile, with no way to say "seed this partner AS an angel
   * network".
   *
   * WHY THIS DOES NOT READ THE TAXONOMY. The obvious fix — resolve the seed
   * type from `partner_classifications` — is FORBIDDEN. Owner ruling A-20/PT-5
   * fences classification to "REPORTING AND FILTERING ONLY — never let it touch
   * permissions, nav or access", and this profile is pure access control: it is
   * the input to GATE 1 and to every assert* gate below it. Letting a
   * sub-sector slug decide a capability bit would make classification an access
   * mechanism, which is exactly what the fence exists to prevent. That half of
   * DA-1 is therefore reported BLOCKED pending an owner ruling rather than
   * silently implemented; see build_log/WAVE7B_REPORT.md.
   *
   * What the explicit parameter does instead is give the admin a DELIBERATE,
   * audited way to state the capability class, independent of the taxonomy and
   * independent of the stale column. It is validated against the same union
   * seedDefaultsForType switches on, so an unknown string cannot quietly seed
   * an empty profile.
   */
  seedCapabilityProfile(partnerId: string, actor: string, explicitType?: PartnerType | null): CapabilityProfile {
    requirePid(partnerId);
    if (explicitType != null && SEEDABLE_PARTNER_TYPES.indexOf(explicitType) === -1) {
      throw new GateError(
        "INVALID_CAPABILITY_SEED_TYPE",
        `Unknown capability seed type "${String(explicitType)}". Expected one of: ${SEEDABLE_PARTNER_TYPES.join(", ")}.`,
      );
    }
    const contact = getContactById(partnerId);
    /* An explicit admin choice wins over the stale read-only column; the column
       remains the fallback so nothing that worked before changes. */
    const partnerType =
      explicitType ?? ((contact?.partnerType ?? null) as PartnerType | null);
    const base = unclassifiedProfile(partnerId);
    const defaults = seedDefaultsForType(partnerType);
    const profile: CapabilityProfile = {
      ...base,
      ...defaults,
      partnerType,
      // A partner is only "classified" once seeded from a KNOWN partner_type.
      classified: partnerType != null,
      updatedAt: null,
    };
    persistProfile(profile, actor);
    profileByPartner.set(partnerId, profile);
    return profile;
  },

  /** Admin override of individual capability toggles / classification (RF-10). */
  setCapabilityProfile(partnerId: string, patch: Partial<Record<CapabilityKey | "classified", boolean>>, actor: string): CapabilityProfile {
    requirePid(partnerId);
    const current = profileByPartner.get(partnerId) ?? unclassifiedProfile(partnerId);
    const next: CapabilityProfile = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === "boolean" && k in next) (next as any)[k] = v;
    }
    persistProfile(next, actor);
    profileByPartner.set(partnerId, next);
    return next;
  },

  /* ===== Capability gates (§5.1) — fail-closed ===== */

  /** GATE 1 — engagement create requires a classified profile. */
  assertClassified(partnerId: string): CapabilityProfile {
    const p = this.getCapabilityProfile(partnerId);
    if (!p.classified) throw new GateError("CAPABILITY_UNCLASSIFIED", "Partner capability profile is unclassified (fail-closed).");
    return p;
  },

  /** GATE 6 — Mode-A entry (create-in-A / B→A / handover-confirm-into-A). */
  assertModeAEntry(partnerId: string, authorityArtifactRef: string | null | undefined, authorityExpiresAt: string | null | undefined): void {
    const p = this.getCapabilityProfile(partnerId);
    if (!p.delegatedAgency) throw new GateError("DELEGATED_AGENCY_REQUIRED", "Mode A requires delegated_agency=true.");
    if (!authorityArtifactRef || !String(authorityArtifactRef).trim()) throw new GateError("AUTHORITY_ARTIFACT_REQUIRED", "Mode A requires a valid authority_artifact_ref.");
    if (isExpired(authorityExpiresAt ?? null)) throw new GateError("AUTHORITY_ARTIFACT_EXPIRED", "The authority artifact is expired.");
  },

  /** GATE 2 — attribution stamp requires sources_capital=true. */
  assertSourcesCapital(partnerId: string): CapabilityProfile {
    const p = this.getCapabilityProfile(partnerId);
    if (!p.sourcesCapital) throw new GateError("SOURCES_CAPITAL_REQUIRED", "First-touch attribution requires sources_capital=true (else firm-of-record path).");
    return p;
  },

  /** GATE 3 — delegated-write-on-behalf (incl. SPV-on-behalf). ACTIVE + Mode-A +
   * valid non-expired artifact + delegated_agency + spv_write_authority (D-9). */
  assertDelegatedWriteAuthority(partnerId: string, engagement: Engagement, opts: { requireSpvWrite?: boolean } = {}): CapabilityProfile {
    const p = this.getCapabilityProfile(partnerId);
    if (!p.delegatedAgency) throw new GateError("DELEGATED_AGENCY_REQUIRED", "delegated_agency=true is required.");
    if (opts.requireSpvWrite && !p.spvWriteAuthority) throw new GateError("SPV_WRITE_AUTHORITY_REQUIRED", "spv_write_authority=true is required for SPV-on-behalf.");
    if (engagement.status !== "ACTIVE") throw new GateError("ENGAGEMENT_NOT_ACTIVE", "Engagement is not ACTIVE.");
    if (engagement.mode !== "A") throw new GateError("ENGAGEMENT_MODE_NOT_A", "This company engagement is not Mode A (per-engagement delegated authority absent).");
    if (!engagement.authorityArtifactRef || !engagement.authorityArtifactRef.trim()) throw new GateError("AUTHORITY_ARTIFACT_REQUIRED", "Engagement is missing a valid authority_artifact_ref.");
    if (isExpired(engagement.authorityExpiresAt)) throw new GateError("AUTHORITY_ARTIFACT_EXPIRED", "The engagement authority artifact is expired.");
    return p;
  },

  /** GATE 4 — Collective push requires collective_fronting AND ACTIVE. */
  assertCollectivePush(partnerId: string, engagement: Engagement): CapabilityProfile {
    const p = this.getCapabilityProfile(partnerId);
    if (!p.collectiveFronting) throw new GateError("COLLECTIVE_FRONTING_REQUIRED", "collective_fronting=true is required.");
    if (engagement.status !== "ACTIVE") throw new GateError("ENGAGEMENT_NOT_ACTIVE", "Engagement is not ACTIVE.");
    return p;
  },

  /** GATE 5 — soft-circle graduation: ACTIVE AND (sources_capital OR delegated_agency). */
  assertGraduation(partnerId: string, engagement: Engagement): CapabilityProfile {
    const p = this.getCapabilityProfile(partnerId);
    if (engagement.status !== "ACTIVE") throw new GateError("ENGAGEMENT_NOT_ACTIVE", "Engagement is not ACTIVE.");
    if (!p.sourcesCapital && !p.delegatedAgency) throw new GateError("GRADUATION_CAPABILITY_REQUIRED", "Graduation requires sources_capital OR delegated_agency.");
    return p;
  },

  /* ===== Engagement lifecycle ===== */

  createEngagement(
    partnerId: string,
    data: { companyId: string; mode?: EngagementMode; authorityArtifactRef?: string | null; authorityExpiresAt?: string | null; chapterId?: string | null; matterId?: string | null; trialDays?: number },
    actor: string,
  ): Engagement {
    requirePid(partnerId);
    if (!data.companyId) throw new Error("COMPANY_ID_REQUIRED");
    const profile = this.assertClassified(partnerId); // GATE 1
    const mode: EngagementMode = data.mode === "A" ? "A" : "B";
    if (mode === "A") {
      this.assertModeAEntry(partnerId, data.authorityArtifactRef, data.authorityExpiresAt); // GATE 6
    }
    const existing = this.getEngagementByCompany(partnerId, data.companyId);
    if (existing) throw new Error("ENGAGEMENT_ALREADY_EXISTS");
    const now = nowIso();
    // Mode-A engagements get a 90-day trial (RF-5, admin-overridable).
    const trialExpiresAt = mode === "A"
      ? new Date(Date.now() + (data.trialDays ?? 90) * 86400000).toISOString()
      : null;
    const e: Engagement = {
      id: `mfeng_${randomUUID()}`,
      partnerId,
      companyId: data.companyId,
      mode,
      status: "ACTIVE",
      authorityArtifactRef: mode === "A" ? (data.authorityArtifactRef ?? null) : null,
      authorityExpiresAt: mode === "A" ? (data.authorityExpiresAt ?? null) : null,
      trialExpiresAt,
      chapterId: data.chapterId ?? null,
      matterId: data.matterId ?? null,
      createdBy: actor ?? null,
      createdAt: now,
      updatedAt: now,
    };
    persistEngagement(e);
    engagementById.set(e.id, e);
    recordEvent(partnerId, e.id, e.companyId, "engagement_created", { mode, hasArtifact: !!e.authorityArtifactRef }, actor);
    if (mode === "A" && trialExpiresAt) {
      this.startTrial(partnerId, e.id, e.companyId, trialExpiresAt);
    }
    // Seed a Partner-CRM layer membership for the company as this partner's contact.
    this.setLayerMembership(partnerId, e.companyId, `company:${e.companyId}`, "partner", e.id);
    // Attribution intent is recorded per the partner's sourcing capability.
    recordAudit(partnerId, "engagement.created", { engagementId: e.id, companyId: e.companyId, agentUserId: actor, disclosure: { mode, sourcesCapital: profile.sourcesCapital } });
    return e;
  },

  getEngagement(partnerId: string, engagementId: string): Engagement | null {
    requirePid(partnerId);
    const e = engagementById.get(engagementId);
    if (!e || e.partnerId !== partnerId) return null; // fail-closed: no cross-partner leak
    return e;
  },

  getEngagementByCompany(partnerId: string, companyId: string): Engagement | null {
    requirePid(partnerId);
    for (const e of Array.from(engagementById.values())) {
      if (e.partnerId === partnerId && e.companyId === companyId) return e;
    }
    return null;
  },

  listEngagements(partnerId: string): Engagement[] {
    requirePid(partnerId);
    return Array.from(engagementById.values()).filter((e) => e.partnerId === partnerId);
  },

  listEvents(partnerId: string, engagementId: string): Array<{ id: string; eventType: string; detail: Record<string, unknown> | null; actor: string | null; createdAt: string }> {
    requirePid(partnerId);
    const e = this.getEngagement(partnerId, engagementId);
    if (!e) return [];
    const rows = rawDb().prepare(
      `SELECT id, event_type, detail_json, actor, created_at FROM mf_engagement_event
        WHERE partner_id = ? AND engagement_id = ? ORDER BY created_at DESC`,
    ).all(partnerId, engagementId) as any[];
    return rows.map((r) => ({
      id: r.id, eventType: r.event_type,
      detail: r.detail_json ? (() => { try { return JSON.parse(r.detail_json); } catch { return null; } })() : null,
      actor: r.actor ?? null, createdAt: r.created_at,
    }));
  },

  /** Mode change. A→B is free; B→A requires a fresh Mode-A authority grant (GATE 6). */
  setMode(partnerId: string, engagementId: string, newMode: EngagementMode, opts: { authorityArtifactRef?: string | null; authorityExpiresAt?: string | null } = {}, actor: string): Engagement {
    requirePid(partnerId);
    const e = this.getEngagement(partnerId, engagementId);
    if (!e) throw new GateError("ENGAGEMENT_NOT_FOUND");
    if (e.status !== "ACTIVE") throw new GateError("ENGAGEMENT_NOT_ACTIVE");
    if (newMode === e.mode) return e;
    if (newMode === "A") {
      this.assertModeAEntry(partnerId, opts.authorityArtifactRef, opts.authorityExpiresAt); // GATE 6
      e.mode = "A";
      e.authorityArtifactRef = opts.authorityArtifactRef ?? null;
      e.authorityExpiresAt = opts.authorityExpiresAt ?? null;
    } else {
      // A→B is free and clears the delegated authority artifact.
      e.mode = "B";
      e.authorityArtifactRef = null;
      e.authorityExpiresAt = null;
    }
    e.updatedAt = nowIso();
    persistEngagement(e);
    engagementById.set(e.id, e);
    recordEvent(partnerId, e.id, e.companyId, "mode_changed", { to: newMode }, actor);
    return e;
  },

  /** Additive persona scoping setter (angel chapter_id / law matter_id). Persona
   * modules call THIS instead of writing mf_engagement directly (design §7: add
   * on the same model, never fork). Records a lifecycle event. */
  setEngagementScope(
    partnerId: string,
    engagementId: string,
    patch: { chapterId?: string | null; matterId?: string | null },
    eventType: string,
    detail: Record<string, unknown> | null,
    actor: string,
  ): Engagement {
    requirePid(partnerId);
    const e = this.getEngagement(partnerId, engagementId);
    if (!e) throw new GateError("ENGAGEMENT_NOT_FOUND");
    if ("chapterId" in patch) e.chapterId = patch.chapterId ?? null;
    if ("matterId" in patch) e.matterId = patch.matterId ?? null;
    e.updatedAt = nowIso();
    persistEngagement(e);
    engagementById.set(e.id, e);
    recordEvent(partnerId, e.id, e.companyId, eventType, detail, actor);
    return e;
  },

  /* ===== Hand-over lifecycle ===== */

  handoverInitiate(partnerId: string, engagementId: string, data: { direction: "A_TO_B" | "B_TO_A"; initiatorParty: "partner" | "founder"; authorityArtifactRef?: string | null; authorityExpiresAt?: string | null }, actor: string): { id: string; status: string } {
    requirePid(partnerId);
    const e = this.getEngagement(partnerId, engagementId);
    if (!e) throw new GateError("ENGAGEMENT_NOT_FOUND");
    if (e.status !== "ACTIVE") throw new GateError("ENGAGEMENT_NOT_ACTIVE");
    const id = `mfho_${randomUUID()}`;
    rawDb().prepare(
      `INSERT INTO mf_handover (id, partner_id, engagement_id, company_id, direction, initiator_party, initiated_by, status, authority_artifact_ref, authority_expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'initiated', ?, ?, ?)`,
    ).run(id, partnerId, engagementId, e.companyId, data.direction, data.initiatorParty, actor ?? null, data.authorityArtifactRef ?? null, data.authorityExpiresAt ?? null, nowIso());
    recordEvent(partnerId, engagementId, e.companyId, "handover_initiated", { direction: data.direction, by: data.initiatorParty }, actor);
    return { id, status: "initiated" };
  },

  /**
   * WAVE 17 ORP-031 — LIST hand-overs. This was the missing half of the hand-over
   * lifecycle: `handoverInitiate` returned an id, `handoverConfirm` and the admin
   * override (`POST /api/admin/mfcrm/handovers/:partnerId/:handoverId/override`,
   * server/managedFounderRoutes.ts:449) both REQUIRE that id, and nothing could
   * read it back. Verified at source before adding: no `SELECT` against
   * `mf_handover` existed anywhere except the single-row lookup inside
   * `handoverConfirm` (`:572`). So a hand-over initiated in one session — or by the
   * founder side — was durably recorded and permanently unreachable, and the
   * client's only route to the id was React state that a page refresh destroyed.
   *
   * Reads the table directly (the row is the record of truth; nothing is cached
   * in memory), partner-scoped in the WHERE clause so a partner can never read
   * another firm's hand-overs.
   */
  listHandovers(
    partnerId: string,
    filter: { engagementId?: string | null; status?: string | null } = {},
  ): Handover[] {
    requirePid(partnerId);
    const where: string[] = ["partner_id = ?"];
    const args: unknown[] = [partnerId];
    if (filter.engagementId) { where.push("engagement_id = ?"); args.push(filter.engagementId); }
    if (filter.status) { where.push("status = ?"); args.push(filter.status); }
    const rows = rawDb()
      .prepare(
        `SELECT * FROM mf_handover WHERE ${where.join(" AND ")} ORDER BY created_at DESC`,
      )
      .all(...(args as [])) as any[];
    return rows.map(rowToHandover);
  },

  /** Confirm a hand-over. Confirming INTO Mode A re-runs GATE 6 (fail-closed). */
  handoverConfirm(partnerId: string, handoverId: string, actor: string, opts: { adminOverride?: boolean } = {}): Engagement {
    requirePid(partnerId);
    const ho = rawDb().prepare(`SELECT * FROM mf_handover WHERE id = ? AND partner_id = ?`).get(handoverId, partnerId) as any;
    if (!ho) throw new GateError("HANDOVER_NOT_FOUND");
    if (ho.status !== "initiated") throw new GateError("HANDOVER_NOT_PENDING");
    const e = this.getEngagement(partnerId, ho.engagement_id);
    if (!e) throw new GateError("ENGAGEMENT_NOT_FOUND");
    const targetMode: EngagementMode = ho.direction === "B_TO_A" ? "A" : "B";
    if (targetMode === "A") {
      // B→A confirmation MUST satisfy the Mode-A entry gate (privilege-escalation guard).
      this.assertModeAEntry(partnerId, ho.authority_artifact_ref, ho.authority_expires_at); // GATE 6
      e.mode = "A";
      e.authorityArtifactRef = ho.authority_artifact_ref ?? null;
      e.authorityExpiresAt = ho.authority_expires_at ?? null;
    } else {
      e.mode = "B";
      e.authorityArtifactRef = null;
      e.authorityExpiresAt = null;
    }
    e.updatedAt = nowIso();
    persistEngagement(e);
    engagementById.set(e.id, e);
    const now = nowIso();
    rawDb().prepare(`UPDATE mf_handover SET status = ?, confirmed_at = ?, confirmed_by = ? WHERE id = ?`)
      .run(opts.adminOverride ? "overridden" : "confirmed", now, actor ?? null, handoverId);
    recordEvent(partnerId, e.id, e.companyId, opts.adminOverride ? "handover_admin_override" : "handover_confirmed", { to: targetMode }, actor);
    return e;
  },

  /* ===== Trial / pricing (RF-5, 90d Mode-A expiry) ===== */

  startTrial(partnerId: string, engagementId: string, companyId: string, trialExpiresAt: string, plan: string | null = null): void {
    const now = nowIso();
    try {
      rawDb().prepare(
        `INSERT INTO mf_pricing_trial (id, partner_id, engagement_id, company_id, plan, trial_start, trial_expires_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      ).run(`mftr_${randomUUID()}`, partnerId, engagementId, companyId, plan, now, trialExpiresAt, now, now);
    } catch (err) {
      log.warn("[managedFounderStore] trial write-through failed:", (err as Error).message);
      throw new Error(`STRICT_PERSIST_FAILED: mf_pricing_trial.${engagementId}: ${(err as Error).message}`);
    }
  },

  getTrial(partnerId: string, engagementId: string): any | null {
    requirePid(partnerId);
    return rawDb().prepare(`SELECT * FROM mf_pricing_trial WHERE partner_id = ? AND engagement_id = ? ORDER BY created_at DESC LIMIT 1`).get(partnerId, engagementId) ?? null;
  },

  /** Admin: extend/override a Mode-A trial (reversible). */
  overrideTrial(partnerId: string, engagementId: string, newExpiry: string, actor: string): void {
    requirePid(partnerId);
    rawDb().prepare(`UPDATE mf_pricing_trial SET trial_expires_at = ?, status = 'active', updated_at = ? WHERE partner_id = ? AND engagement_id = ?`)
      .run(newExpiry, nowIso(), partnerId, engagementId);
    const e = this.getEngagement(partnerId, engagementId);
    if (e) {
      e.trialExpiresAt = newExpiry;
      if (e.status === "LAPSED") e.status = "ACTIVE";
      e.updatedAt = nowIso();
      persistEngagement(e);
      engagementById.set(e.id, e);
    }
    recordEvent(partnerId, engagementId, e?.companyId ?? "", "trial_override", { newExpiry }, actor);
  },

  /** Lapse Mode-A engagements whose 90-day trial has expired (RF-5). */
  expireStaleTrials(partnerId: string): number {
    requirePid(partnerId);
    let lapsed = 0;
    for (const e of this.listEngagements(partnerId)) {
      if (e.mode === "A" && e.status === "ACTIVE" && isExpired(e.trialExpiresAt)) {
        e.status = "LAPSED";
        e.updatedAt = nowIso();
        persistEngagement(e);
        engagementById.set(e.id, e);
        recordEvent(partnerId, e.id, e.companyId, "engagement_lapsed", { reason: "trial_expired" }, "system");
        lapsed++;
      }
    }
    return lapsed;
  },

  /* ===== Attribution + crossover ===== */

  /** Stamp attribution. sources_capital → first-touch + 12-month tail; else the
   * firm-of-record path (GATE 2 selects). */
  stampAttribution(partnerId: string, data: { companyId: string; engagementId?: string | null; dealId?: string | null; attributionType?: string }, actor: string): { id: string; attributionType: string } {
    requirePid(partnerId);
    if (!data.companyId) throw new Error("COMPANY_ID_REQUIRED");
    const profile = this.getCapabilityProfile(partnerId);
    const now = nowIso();
    let attributionType: string;
    if (profile.sourcesCapital) {
      attributionType = "first_touch";
    } else {
      // Non-capital partners can NEVER stamp investor first-touch (GATE 2).
      attributionType = data.attributionType && ["firm_of_record", "matter_of_record", "counsel_of_record"].includes(data.attributionType)
        ? data.attributionType
        : "firm_of_record";
    }
    const id = `mfat_${randomUUID()}`;
    rawDb().prepare(
      `INSERT INTO mf_attribution (id, partner_id, company_id, engagement_id, attribution_type, sources_capital, first_touch_at, actor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, partnerId, data.companyId, data.engagementId ?? null, attributionType, profile.sourcesCapital ? 1 : 0, profile.sourcesCapital ? now : null, actor ?? null, now, now);
    if (profile.sourcesCapital) {
      const tailEnd = new Date(Date.now() + 365 * 86400000).toISOString();
      rawDb().prepare(
        `INSERT INTO mf_attribution_tail (id, partner_id, company_id, attribution_id, deal_id, tail_start, tail_end, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(`mftl_${randomUUID()}`, partnerId, data.companyId, id, data.dealId ?? null, now, tailEnd, now);
    }
    recordAudit(partnerId, "attribution.stamped", { engagementId: data.engagementId, companyId: data.companyId, agentUserId: actor, disclosure: { attributionType } });
    return { id, attributionType };
  },

  readAttribution(partnerId: string, companyId: string): { attributions: any[]; tail: any[] } {
    requirePid(partnerId);
    const attributions = rawDb().prepare(`SELECT * FROM mf_attribution WHERE partner_id = ? AND company_id = ? ORDER BY created_at DESC`).all(partnerId, companyId) as any[];
    const tail = rawDb().prepare(`SELECT * FROM mf_attribution_tail WHERE partner_id = ? AND company_id = ? ORDER BY created_at DESC`).all(partnerId, companyId) as any[];
    return { attributions, tail };
  },

  /** Create a crossover flag (C1–C7). This ALWAYS records — it flags, never blocks. */
  createCrossoverFlag(partnerId: string, data: { companyId: string; flagCode: string; detail?: Record<string, unknown> | null }, actor: string): { id: string } {
    requirePid(partnerId);
    if (!data.companyId) throw new Error("COMPANY_ID_REQUIRED");
    const id = `mfxf_${randomUUID()}`;
    rawDb().prepare(
      `INSERT INTO mf_crossover_flag (id, partner_id, company_id, flag_code, detail_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    ).run(id, partnerId, data.companyId, data.flagCode, data.detail ? JSON.stringify(data.detail) : null, nowIso());
    recordAudit(partnerId, "crossover.flagged", { companyId: data.companyId, agentUserId: actor, disclosure: { flagCode: data.flagCode } });
    return { id };
  },

  listCrossoverFlags(partnerId: string, companyId?: string): any[] {
    requirePid(partnerId);
    if (companyId) return rawDb().prepare(`SELECT * FROM mf_crossover_flag WHERE partner_id = ? AND company_id = ? ORDER BY created_at DESC`).all(partnerId, companyId) as any[];
    return rawDb().prepare(`SELECT * FROM mf_crossover_flag WHERE partner_id = ? ORDER BY created_at DESC`).all(partnerId) as any[];
  },

  /* ===== Layer membership ===== */

  setLayerMembership(partnerId: string, companyId: string, contactRef: string, layer: "partner" | "general" | "founder", engagementId: string | null): void {
    requirePid(partnerId);
    const now = nowIso();
    try {
      rawDb().prepare(
        `INSERT INTO mf_layer_membership (id, partner_id, company_id, contact_ref, layer, engagement_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(partner_id, company_id, contact_ref) DO UPDATE SET
           layer=excluded.layer, engagement_id=excluded.engagement_id, updated_at=excluded.updated_at`,
      ).run(`mflm_${randomUUID()}`, partnerId, companyId, contactRef, layer, engagementId ?? null, now, now);
    } catch (err) {
      log.warn("[managedFounderStore] layer write-through failed:", (err as Error).message);
      throw new Error(`STRICT_PERSIST_FAILED: mf_layer_membership.${companyId}: ${(err as Error).message}`);
    }
  },

  listLayerMembership(partnerId: string, companyId: string): any[] {
    requirePid(partnerId);
    return rawDb().prepare(`SELECT * FROM mf_layer_membership WHERE partner_id = ? AND company_id = ? ORDER BY created_at DESC`).all(partnerId, companyId) as any[];
  },

  /* ===== Money path 1: soft-circle graduation (via sacred commitFunded) ===== */

  /**
   * Soft-circle graduation. Routes the money event through the SACRED
   * `commitFunded` ledger (single ledger, no parallel path) after GATE 5, then
   * copies the investor into the Founder CRM (`founderCrmStore` — NOT the sacred
   * `investorCrmStore`) and records a 'founder'-layer membership + disclosure.
   */
  softCircleGraduate(
    partnerId: string,
    data: {
      companyId: string; engagementId: string; invitationId: string; roundId: string;
      investorId: string; amount: string; shares: string; currency?: string;
      investorName?: string; investorEmail?: string; region?: string | null;
    },
    actor: string,
  ): { ok: true; ledgerSeq: number } | { ok: false; error: string } {
    requirePid(partnerId);
    const e = this.getEngagement(partnerId, data.engagementId);
    if (!e || e.companyId !== data.companyId) throw new GateError("ENGAGEMENT_NOT_FOUND");
    this.assertGraduation(partnerId, e); // GATE 5

    // SACRED single ledger — the ONLY money entry point.
    const result = commitFunded({
      invitationId: data.invitationId,
      roundId: data.roundId,
      companyId: data.companyId,
      investorId: data.investorId,
      amount: data.amount,
      currency: data.currency ?? "USD",
      shares: data.shares,
    });
    if (!result.ok) return { ok: false, error: result.error };

    // Copy the investor into the Founder CRM (host store) — never investorCrmStore.
    try {
      upsertInvestorContactFromPartner(data.companyId, {
        partnerId: data.investorId,
        name: data.investorName ?? data.investorId,
        email: data.investorEmail ?? "",
        region: data.region ?? null,
      });
    } catch (err) {
      // Copy-in is a best-effort projection; the sacred money commit already
      // succeeded and must not be rolled back by a CRM projection hiccup.
      log.warn("[managedFounderStore] founder CRM copy-in failed (non-fatal):", (err as Error).message);
    }
    this.setLayerMembership(partnerId, data.companyId, `investor:${data.investorId}`, "founder", e.id);
    recordEvent(partnerId, e.id, e.companyId, "soft_circle_graduated", { investorId: data.investorId, roundId: data.roundId }, actor);
    recordAudit(partnerId, "soft_circle.graduated", { engagementId: e.id, companyId: e.companyId, agentUserId: actor, principalRef: `company:${e.companyId}`, disclosure: { investorId: data.investorId, ledgerSeq: result.entry.seq } });
    return { ok: true, ledgerSeq: result.entry.seq };
  },

  /* ===== Money path 2: SPV-on-behalf (transactional, §3.3) ===== */

  /**
   * Create an SPV on a company's behalf. GATE 3 (ACTIVE + Mode-A + valid artifact
   * + delegated_agency + spv_write_authority) is asserted first. The SPV row is
   * created durably via spvEngineStore.createSpv; then a SYNC db.transaction
   * reads the on-behalf chain tip, computes the hash, and writes the
   * mf_spv_on_behalf audit row + queues the mf_collective_push row ATOMICALLY.
   * The async Collective push runs OUTSIDE the tx (see processCollectivePush) so
   * a failed push never orphans the SPV or half-commits money state.
   */
  createSpvOnBehalf(
    partnerId: string,
    data: {
      companyId: string; engagementId: string; name: string; jurisdiction: string;
      carryBasis: string; roundId?: string | null; spvType?: string; targetRaiseMinor?: number | null;
      currency?: string; terms?: Record<string, unknown> | null;
    },
    actor: string,
  ): { spvId: string; onBehalfId: string; pushId: string } {
    requirePid(partnerId);
    const e = this.getEngagement(partnerId, data.engagementId);
    if (!e || e.companyId !== data.companyId) throw new GateError("ENGAGEMENT_NOT_FOUND");
    this.assertDelegatedWriteAuthority(partnerId, e, { requireSpvWrite: true }); // GATE 3 (D-9)

    // 1) Durable SPV create (its own atomic INSERT inside spvEngineStore).
    const spv = spvEngineStore.createSpv(
      partnerId,
      {
        name: data.name,
        jurisdiction: data.jurisdiction,
        carryBasis: data.carryBasis,
        spvType: data.spvType,
        targetRaiseMinor: data.targetRaiseMinor ?? null,
        currency: data.currency ?? "USD",
        targetCompanyId: data.companyId,
        terms: data.terms ?? null,
      },
      actor,
    );

    const onBehalfId = `mfsob_${randomUUID()}`;
    const pushId = `mfcp_${randomUUID()}`;
    const now = nowIso();
    const db: any = rawDb();

    // 2) SYNC tx: chain-tip read + hash + INSERT (audit row) + queue push row —
    //    ALL inside the sync transaction (no async/network here; §3.3).
    db.transaction(() => {
      const tip = db.prepare(
        `SELECT curr_hash FROM mf_spv_on_behalf WHERE partner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      ).get(partnerId) as { curr_hash: string } | undefined;
      const prevHash = tip?.curr_hash ?? "GENESIS";
      const payload = {
        onBehalfId, partnerId, engagementId: e.id, companyId: data.companyId,
        spvId: spv.id, roundId: data.roundId ?? null, agent: actor, ts: now,
      };
      const currHash = createHash("sha256").update(`${prevHash}|${JSON.stringify(payload)}`).digest("hex").slice(0, 24);
      db.prepare(
        `INSERT INTO mf_spv_on_behalf (id, partner_id, engagement_id, company_id, spv_id, round_id, acting_on_behalf_of, agent_user_id, authority_artifact_ref, prev_hash, curr_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(onBehalfId, partnerId, e.id, data.companyId, spv.id, data.roundId ?? null, `company:${data.companyId}`, actor ?? null, e.authorityArtifactRef ?? null, prevHash, currHash, now);
      db.prepare(
        `INSERT INTO mf_collective_push (id, partner_id, engagement_id, company_id, spv_id, round_id, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
      ).run(pushId, partnerId, e.id, data.companyId, spv.id, data.roundId ?? null, now, now);
    })();

    // 3) Outside the tx: disclosure audit (agent, not principal) — RF-4.
    recordEvent(partnerId, e.id, e.companyId, "spv_on_behalf_created", { spvId: spv.id, roundId: data.roundId ?? null }, actor);
    recordAudit(partnerId, "spv_on_behalf.created", { engagementId: e.id, companyId: e.companyId, agentUserId: actor, principalRef: `company:${data.companyId}`, disclosure: { spvId: spv.id, onBehalfId } });
    return { spvId: spv.id, onBehalfId, pushId };
  },

  listSpvOnBehalf(partnerId: string, companyId?: string): any[] {
    requirePid(partnerId);
    if (companyId) return rawDb().prepare(`SELECT * FROM mf_spv_on_behalf WHERE partner_id = ? AND company_id = ? ORDER BY created_at DESC`).all(partnerId, companyId) as any[];
    return rawDb().prepare(`SELECT * FROM mf_spv_on_behalf WHERE partner_id = ? ORDER BY created_at DESC`).all(partnerId) as any[];
  },

  /* ===== Collective push queue (GATE 4) ===== */

  listCollectivePush(partnerId: string): any[] {
    requirePid(partnerId);
    return rawDb().prepare(`SELECT * FROM mf_collective_push WHERE partner_id = ? ORDER BY created_at DESC`).all(partnerId) as any[];
  },

  /**
   * Mark a queued push as pushed (or record a retryable failure). GATE 4 is
   * asserted by the caller/route. This is the OUTSIDE-the-tx async-emission
   * boundary — it never rolls back the durable SPV/money state (§3.3).
   */
  markCollectivePush(partnerId: string, pushId: string, outcome: { ok: boolean; error?: string }): any {
    requirePid(partnerId);
    const row = rawDb().prepare(`SELECT * FROM mf_collective_push WHERE id = ? AND partner_id = ?`).get(pushId, partnerId) as any;
    if (!row) throw new GateError("PUSH_NOT_FOUND");
    const now = nowIso();
    if (outcome.ok) {
      rawDb().prepare(`UPDATE mf_collective_push SET status = 'pushed', attempts = attempts + 1, pushed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, pushId);
    } else {
      rawDb().prepare(`UPDATE mf_collective_push SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?`).run(outcome.error ?? "push_failed", now, pushId);
    }
    return rawDb().prepare(`SELECT * FROM mf_collective_push WHERE id = ?`).get(pushId);
  },

  /* ===== Audit + dashboard ===== */

  listAudit(partnerId: string, companyId?: string): any[] {
    requirePid(partnerId);
    if (companyId) return rawDb().prepare(`SELECT * FROM mf_audit WHERE partner_id = ? AND company_id = ? ORDER BY created_at DESC`).all(partnerId, companyId) as any[];
    return rawDb().prepare(`SELECT * FROM mf_audit WHERE partner_id = ? ORDER BY created_at DESC`).all(partnerId) as any[];
  },

  dashboard(partnerId: string): Record<string, unknown> {
    requirePid(partnerId);
    const engagements = this.listEngagements(partnerId);
    const profile = this.getCapabilityProfile(partnerId);
    return {
      classified: profile.classified,
      partnerType: profile.partnerType,
      engagements: {
        total: engagements.length,
        active: engagements.filter((e) => e.status === "ACTIVE").length,
        modeA: engagements.filter((e) => e.mode === "A").length,
        modeB: engagements.filter((e) => e.mode === "B").length,
        lapsed: engagements.filter((e) => e.status === "LAPSED").length,
      },
      openCrossoverFlags: this.listCrossoverFlags(partnerId).filter((f) => f.status === "open").length,
      queuedPushes: this.listCollectivePush(partnerId).filter((p) => p.status === "queued").length,
      capability: profile,
    };
  },
};

/* ---------- Hydration ---------- */

/** Rebuild the RAM projections from the durable mf_* tables on boot (applies
 * the schema first so a cold DB is safe). */
export async function hydrateManagedFounderStore(): Promise<void> {
  applyMfcrmSchema();
  const db: any = rawDb();
  // WAVE 38 ROW 4 — `mf_engagement_event` is born in application code, so 0183
  // is the only place its canonical ledger shape is declared and the bootstrap
  // path never runs it. Ordered AFTER applyMfcrmSchema() so the table exists.
  applyWave38EventLedgerSchemaOnce(db);
  try {
    profileByPartner.clear();
    const pRows = db.prepare(`SELECT * FROM mf_capability_profile`).all() as any[];
    for (const r of pRows) {
      profileByPartner.set(r.partner_id, {
        partnerId: r.partner_id,
        partnerType: (r.partner_type ?? null) as PartnerType | null,
        classified: r.classified === 1,
        sourcesCapital: r.sources_capital === 1,
        delegatedAgency: r.delegated_agency === 1,
        spvWriteAuthority: r.spv_write_authority === 1,
        advisoryCoseat: r.advisory_coseat === 1,
        documentCustody: r.document_custody === 1,
        paysOnBehalf: r.pays_on_behalf === 1,
        attributionTracking: r.attribution_tracking === 1,
        collectiveFronting: r.collective_fronting === 1,
        chapterScoping: r.chapter_scoping === 1,
        fundAdmin: r.fund_admin === 1,
        updatedAt: r.updated_at ?? null,
      });
    }

    engagementById.clear();
    const eRows = db.prepare(`SELECT * FROM mf_engagement`).all() as any[];
    for (const r of eRows) {
      engagementById.set(r.id, {
        id: r.id,
        partnerId: r.partner_id,
        companyId: r.company_id,
        mode: (r.mode === "A" ? "A" : "B") as EngagementMode,
        status: r.status as EngagementStatus,
        authorityArtifactRef: r.authority_artifact_ref ?? null,
        authorityExpiresAt: r.authority_expires_at ?? null,
        trialExpiresAt: r.trial_expires_at ?? null,
        chapterId: r.chapter_id ?? null,
        matterId: r.matter_id ?? null,
        createdBy: r.created_by ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }
    log.info?.(`[managedFounderStore] hydrated ${profileByPartner.size} profile(s), ${engagementById.size} engagement(s)`);
  } catch (err) {
    log.warn("[managedFounderStore] hydrate failed (non-fatal):", (err as Error).message);
  }
}

/** Test-only: clear RAM projections between suites. */
export function _resetManagedFounderStoreForTests(): void {
  profileByPartner.clear();
  engagementById.clear();
}
