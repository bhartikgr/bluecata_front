/**
 * Sprint 15 D1 — UserContext + Entitlement computation.
 *
 * Single source of truth for "who is this user, and what are they entitled
 * to do?". Computed on EVERY request — never cached. Reads only from the
 * existing in-memory stores (multiCompanyStore, membershipStore,
 * mockData, profileStore, collectiveAppStore) so we don't introduce a new
 * persistence layer; production migration is a one-line swap to a real
 * users/sessions table.
 *
 * The HTTP shell exposes this via `GET /api/auth/me`. Test harnesses can
 * also call `getUserContext(req)` directly.
 *
 * SANDBOX-SAFE: pure server code. No browser APIs.
 */
import type { Request } from "express";
import { getCompaniesForFounder, getActiveCompanyId, type FounderCompanyMembership } from "../multiCompanyStore";
import { getMembership } from "../membershipStore";
import { incomingInvitations, currentInvestor as DEMO_INVESTOR } from "../mockData";

/* ---------- Public types ---------- */

export type InvestorState =
  | "NONE"
  | "INVITED_ONLY"
  | "ON_CAP_TABLE"
  | "ON_CAP_TABLE_COLLECTIVE_ACTIVE"
  | "ON_CAP_TABLE_COLLECTIVE_LAPSED";

export type CollectiveStatus =
  | "none"
  | "applied"
  | "pending"
  | "active"
  | "suspended"
  | "lapsed";

export type CollectiveRole =
  | "standard"
  | "dsc"
  | "consortium_partner"
  | null;

export interface InvitedRound {
  invitationId: string;
  roundId: string;
  companyId: string;
  companyName: string;
  roundName: string;
  state: string;
  receivedAt: string;
  expiresAt: string;
}

export interface CapTablePosition {
  companyId: string;
  companyName: string;
  ownershipPct: number;
}

export interface FounderCompany {
  companyId: string;
  companyName: string;
  legalName: string;
  role: string;
  stage: string;
  sector: string;
  hq: string;
  lastActiveAt: string;
  capTableHolders: number;
  activeRoundsCount: number;
}

export interface UserContext {
  userId: string;
  identity: { email: string; name: string; screenName?: string };
  founder: { companies: FounderCompany[]; activeCompanyId: string | null };
  investor: {
    invitedRounds: InvitedRound[];
    capTablePositions: CapTablePosition[];
    state: InvestorState;
  };
  collective: {
    status: CollectiveStatus;
    role: CollectiveRole;
    expiresAt: string | null;
  };
  isAdmin: boolean;
  isAuthed: boolean;
}

/* ---------- Persona registry ---------- */

interface PersonaSeed {
  userId: string;
  email: string;
  name: string;
  screenName?: string;
  isFounder: boolean;
  isInvestor: boolean;
  isAdmin: boolean;
  /** Override invitations: defaults to demo set when isInvestor && hasInvitations */
  hasInvitations: boolean;
}

/** Runtime-registered personas (from token redemption). Keyed by userId. */
const RUNTIME_PERSONAS: Record<string, PersonaSeed & { password?: string; invitedRoundIds?: string[] }> = {};
/** Runtime invitation seeds for redeemed users. */
const RUNTIME_INVITATIONS: Record<string, Array<{ invitationId: string; roundId: string; companyId: string }>> = {};
/** Runtime password store for redeemed users. */
const RUNTIME_PASSWORDS: Record<string, string> = {};

const PERSONAS: Record<string, PersonaSeed> = {
  // Founder of 3 companies — also a Collective member through one of them.
  u_maya_chen: {
    userId: "u_maya_chen",
    email: "maya@novapay.ai",
    name: "Maya Chen",
    isFounder: true,
    isInvestor: false,
    isAdmin: false,
    hasInvitations: false,
  },
  // Investor on 2 cap tables + active Collective.
  u_aisha_patel: {
    userId: "u_aisha_patel",
    email: "aisha@greenwood.capital",
    name: "Aisha Patel",
    screenName: "GreenwoodCap",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: true,
  },
  // Investor on 1 cap table, lapsed Collective.
  u_lapsed_lp: {
    userId: "u_lapsed_lp",
    email: "lp@lapsed-fund.example",
    name: "Robin Vasquez",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  },
  // Invited only — State 1 nudge persona.
  u_no_position: {
    userId: "u_no_position",
    email: "newinvestor@example.com",
    name: "Casey Lin",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: true,
  },
  u_admin: {
    userId: "u_admin",
    email: "admin@capavate.io",
    name: "Capavate Admin",
    isFounder: false,
    isInvestor: false,
    isAdmin: true,
    hasInvitations: false,
  },
};

/* ---------- Entitlement helpers ---------- */

function buildFounderCompanies(): FounderCompany[] {
  return getCompaniesForFounder().map((c: FounderCompanyMembership) => ({
    companyId: c.companyId,
    companyName: c.companyName,
    legalName: c.legalName,
    role: c.role,
    stage: c.stage,
    sector: c.sector,
    hq: c.hq,
    lastActiveAt: c.lastActiveAt,
    capTableHolders: c.kpi.capTableHolders,
    activeRoundsCount: c.kpi.activeRoundsCount,
  }));
}

function buildInvitedRounds(persona: PersonaSeed): InvitedRound[] {
  // Defect 83: runtime-registered (redeemed) users get their seeded invitation records
  const runtimeInvs = RUNTIME_INVITATIONS[persona.userId];
  if (runtimeInvs && runtimeInvs.length > 0) {
    return runtimeInvs.map((ri) => ({
      invitationId: ri.invitationId,
      roundId: ri.roundId,
      companyId: ri.companyId,
      companyName: ri.companyId, // simplified — no company name store yet
      roundName: "Invited Round",
      state: "pending",
      receivedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }));
  }
  if (!persona.hasInvitations) return [];
  return incomingInvitations.map((i) => ({
    invitationId: i.id,
    roundId: i.round.id,
    companyId: i.company.id,
    companyName: i.company.name,
    roundName: i.round.name,
    state: i.state,
    receivedAt: i.receivedAt,
    expiresAt: i.expiresAt,
  }));
}

function buildCapTablePositions(persona: PersonaSeed): CapTablePosition[] {
  if (!persona.isInvestor) return [];
  const m = getMembership(persona.userId);
  if (!m) return [];
  return m.capTablePositions.map((p) => ({
    companyId: p.companyId,
    companyName: p.companyName,
    ownershipPct: p.ownershipPct,
  }));
}

function buildCollectiveOverlay(persona: PersonaSeed): UserContext["collective"] {
  if (!persona.isInvestor) {
    // Founders use multiCompanyStore.collective per-company; the user-level
    // collective overlay is for investor-side logic only here.
    return { status: "none", role: null, expiresAt: null };
  }
  const m = getMembership(persona.userId);
  if (!m) return { status: "none", role: null, expiresAt: null };
  let status: CollectiveStatus = "none";
  if (m.lapsed) status = "lapsed";
  else if (m.isCollectiveMember) status = "active";
  return {
    status,
    role: m.isCollectiveMember || m.lapsed ? "standard" : null,
    expiresAt: m.expiresAt,
  };
}

export function computeInvestorState(args: {
  isInvestor: boolean;
  invitedRounds: InvitedRound[];
  capTablePositions: CapTablePosition[];
  collectiveStatus: CollectiveStatus;
}): InvestorState {
  if (!args.isInvestor) return "NONE";
  const hasCapTable = args.capTablePositions.length > 0;
  const hasInvites = args.invitedRounds.length > 0;
  if (!hasCapTable && !hasInvites) return "NONE";
  if (!hasCapTable) return "INVITED_ONLY";
  if (args.collectiveStatus === "active") return "ON_CAP_TABLE_COLLECTIVE_ACTIVE";
  if (args.collectiveStatus === "lapsed") return "ON_CAP_TABLE_COLLECTIVE_LAPSED";
  return "ON_CAP_TABLE";
}

/* ---------- Persona resolution from request ---------- */

/**
 * Sprint 22 Wave 1 (DEF-026 fix): resolvePersonaId returns null when no explicit
 * identity is available. Callers decide whether to 401 or use a demo persona.
 *
 * Resolution order:
 *   1. cap_uid session cookie (set by login/redeem endpoints)
 *   2. x-user-id header (test harness / legacy)
 *   3. userId query param (legacy dev tool)
 *   4. null — no identity found
 */
export function resolvePersonaId(req: Request): string | null {
  // Sprint 27 — accept both the prefixed __Host- cookie (required in production
  // sandbox) and the legacy cap_uid name (HTTP dev fallback).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cookies = (req as any).cookies ?? {};
  const cookieId = (cookies["__Host-cap_uid"] ?? cookies["cap_uid"]) as string | undefined;
  const headerId = (req.headers["x-user-id"] as string | undefined) ?? undefined;
  const queryId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  return cookieId ?? headerId ?? queryId ?? null;
}

/**
 * resolvePersonaIdWithFallback — returns a persona id, falling back to
 * demo personas based on ?as= role query param. Used by getUserContext().
 */
function resolvePersonaIdWithFallback(req: Request): string {
  const explicit = resolvePersonaId(req);
  if (explicit) return explicit;
  const role = String(req.query.as ?? "investor");
  if (role === "founder") return "u_maya_chen";
  if (role === "admin") return "u_admin";
  return "u_aisha_patel";
}

/* ---------- Public API ---------- */

/**
 * Register a new persona from token redemption (Defects 12, 15, 83).
 * Looks up by email first to avoid duplicates, then creates a new entry.
 * Returns the userId (existing or newly created).
 */
export function registerPersona(args: {
  email: string;
  name: string;
  password: string;
  invitationId: string;
  roundId: string;
  companyId: string;
}): string {
  // Check if this email is already a known persona
  const existingId = Object.values(PERSONAS).find(p => p.email === args.email)?.userId
    ?? Object.values(RUNTIME_PERSONAS).find(p => p.email === args.email)?.userId;
  if (existingId) {
    // Already exists — just add invitation seed if not present
    if (!RUNTIME_INVITATIONS[existingId]) RUNTIME_INVITATIONS[existingId] = [];
    const already = RUNTIME_INVITATIONS[existingId].some(i => i.invitationId === args.invitationId);
    if (!already) RUNTIME_INVITATIONS[existingId].push({ invitationId: args.invitationId, roundId: args.roundId, companyId: args.companyId });
    RUNTIME_PASSWORDS[existingId] = args.password;
    return existingId;
  }
  // Create new
  const userId = `u_redeemed_${Date.now()}`;
  RUNTIME_PERSONAS[userId] = {
    userId,
    email: args.email,
    name: args.name,
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: true,
  };
  RUNTIME_INVITATIONS[userId] = [{ invitationId: args.invitationId, roundId: args.roundId, companyId: args.companyId }];
  RUNTIME_PASSWORDS[userId] = args.password;
  return userId;
}

export function getUserContextForId(userId: string): UserContext {
  const persona = PERSONAS[userId] ?? RUNTIME_PERSONAS[userId];
  if (!persona) {
    return {
      userId,
      identity: { email: "", name: "" },
      founder: { companies: [], activeCompanyId: null },
      investor: { invitedRounds: [], capTablePositions: [], state: "NONE" },
      collective: { status: "none", role: null, expiresAt: null },
      isAdmin: false,
      isAuthed: false,
    };
  }

  const founderCompanies = persona.isFounder ? buildFounderCompanies() : [];
  const activeCompanyId = persona.isFounder
    ? (founderCompanies.find((c) => c.companyId === getActiveCompanyId())?.companyId ?? founderCompanies[0]?.companyId ?? null)
    : null;

  const invitedRounds = buildInvitedRounds(persona);
  const capTablePositions = buildCapTablePositions(persona);
  const collective = buildCollectiveOverlay(persona);
  const investorState = computeInvestorState({
    isInvestor: persona.isInvestor,
    invitedRounds,
    capTablePositions,
    collectiveStatus: collective.status,
  });

  // Use demo investor identity overlay for u_aisha_patel where we have richer mock fields.
  const identity = persona.userId === DEMO_INVESTOR.id
    ? { email: DEMO_INVESTOR.email, name: DEMO_INVESTOR.legalName, screenName: DEMO_INVESTOR.visibility.screenName }
    : { email: persona.email, name: persona.name, screenName: persona.screenName };

  return {
    userId: persona.userId,
    identity,
    founder: { companies: founderCompanies, activeCompanyId },
    investor: { invitedRounds, capTablePositions, state: investorState },
    collective,
    isAdmin: persona.isAdmin,
    isAuthed: true,
  };
}

export async function getUserContext(req: Request): Promise<UserContext> {
  const id = resolvePersonaIdWithFallback(req);
  return getUserContextForId(id);
}

export function listPersonas(): string[] {
  return Object.keys(PERSONAS);
}
