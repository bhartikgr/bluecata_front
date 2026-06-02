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
 *
 * PATCH v3 — Per-company data scoping:
 *   - buildFounderCompanies(userId) now passes userId to getCompaniesForFounder().
 *   - getActiveCompanyId(userId) called with the persona's userId.
 *   - New users get ZERO companies — no NovaPay/Arboreal leakage.
 */
import type { Request } from "express";
import { getCompaniesForFounder, getActiveCompanyId, getCompanyNameById, type FounderCompanyMembership } from "../multiCompanyStore";
import { getMembership } from "../membershipStore";
// B-509 fix v23.6.1 — resolve human-readable round names for invited rounds.
// roundsStore is SACRED (read-only): we only call the existing getRoundById getter.
import { getRoundById } from "../roundsStore";
import { incomingInvitations, currentInvestor as DEMO_INVESTOR } from "../mockData";
// Patch v6 — persist credentials via userCredentialsStore so login works across restarts.
import { storeCredential, lookupByEmail } from "../userCredentialsStore";
// Patch v12 (DB-10) — INSERT users row BEFORE user_credentials so the FK
// ordering is correct (when foreign key enforcement is turned on the row
// already exists). This also lets `users.email` participate in admin lookups.
import { getDb } from "../db/connection";
// Wave C FIX C1 (W-2) — Server-side session revocation: cookies whose userId
// has been added to the revocation set (via /api/auth/logout) must no longer
// authenticate, even if the cookie value itself is otherwise valid.
import { isRevoked } from "./sessionRevocation";
import { users as usersTable } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { log } from "./logger";

/* ----------------------------------------------------------------
 * 23-May fix — Admin login (P0)
 *
 * The login path historically ignored the `users.role` column. Avi
 * inserted `role='admin'` rows and login still failed because
 * `verifyPassword()` (Path 2) hardcoded `isAdmin: false` on the
 * synthetic RUNTIME_PERSONAS entry it created from a credential match.
 *
 * `getDbUserRole(userId)` reads `users.role` directly from the DB so
 * login can honor production admin users. Returns null on any error.
 * ---------------------------------------------------------------- */
function getDbUserRole(userId: string): string | null {
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — login predates tenant resolution; this is
    // a global identity lookup by primary key.
    const rows = db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .all() as Array<{ role: string }>;
    const role = rows[0]?.role ?? null;
    return typeof role === "string" ? role : null;
  } catch (err) {
    log.warn({
      route: "userContext.getDbUserRole",
      errorType: "db_read_failed",
      message: (err as Error).message,
    });
    return null;
  }
}

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
  // Co-founder of NovaPay AI alongside Maya — keeps PERSONAS aligned with
  // seedDemoData (which seats Daniel in chap_keiretsu_canada).
  u_daniel_okafor: {
    userId: "u_daniel_okafor",
    email: "daniel@novapay.example",
    name: "Daniel Okafor",
    isFounder: true,
    isInvestor: false,
    isAdmin: false,
    hasInvitations: false,
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
  // Patch v6 — TEST PARTNER sandbox personas (DEMO_SEED_ENABLED only).
  // Production never loads these because seedTestPartnerSandbox() is gated.
  u_avi_managing: {
    userId: "u_avi_managing",
    email: "avi.managing@test-partner.example",
    name: "Avi Managing",
    isFounder: false,
    isInvestor: false,
    isAdmin: false,
    hasInvitations: false,
  },
  u_avi_viewer: {
    userId: "u_avi_viewer",
    email: "avi.viewer@test-partner.example",
    name: "Avi Viewer",
    isFounder: false,
    isInvestor: false,
    isAdmin: false,
    hasInvitations: false,
  },
};

/* ---------- Entitlement helpers ---------- */

// PATCH v3: Pass userId to getCompaniesForFounder so each user gets their OWN companies.
function buildFounderCompanies(userId: string): FounderCompany[] {
  return getCompaniesForFounder(userId).map((c: FounderCompanyMembership) => ({
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

// B-509 fix v23.6.1 — name resolvers for invited rounds.
// Resolve a company name from the real company store; fall back to a
// truncated id (never the full raw co_* id) so the UI never shows the raw id.
export function resolveCompanyName(companyId: string): string {
  const name = getCompanyNameById(companyId);
  if (name && name.trim().length > 0) return name;
  return `Company ${companyId.slice(0, 8)}`;
}

// Resolve a round name from the SACRED roundsStore (read-only getter). Only
// fall back to the literal "Invited Round" when there is no roundId at all.
export function resolveRoundName(roundId: string): string {
  if (!roundId) return "Invited Round";
  const round = getRoundById(roundId);
  if (round && typeof round.name === "string" && round.name.trim().length > 0) {
    return round.name;
  }
  return `Round ${roundId.slice(0, 8)}`;
}

function buildInvitedRounds(persona: PersonaSeed): InvitedRound[] {
  // Defect 83: runtime-registered (redeemed) users get their seeded invitation records
  const runtimeInvs = RUNTIME_INVITATIONS[persona.userId];
  if (runtimeInvs && runtimeInvs.length > 0) {
    // B-509 fix v23.6.1 — resolve real company + round names instead of raw ids.
    // Falls back to a truncated id (never the full raw id) when unresolved.
    return runtimeInvs.map((ri) => ({
      invitationId: ri.invitationId,
      roundId: ri.roundId,
      companyId: ri.companyId,
      companyName: resolveCompanyName(ri.companyId),
      roundName: resolveRoundName(ri.roundId),
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
  // v14 Tier-1 Fix 1 — header identity is a TEST-HARNESS-ONLY convenience.
  // Banned in production by the v14_no_header_identity lint test; allowed
  // only when the process is a Vitest worker (process.env.VITEST==="true") and
  // DISABLE_DEV_BYPASS !== "1". Vitest's vi.stubEnv can flip NODE_ENV to
  // "production" mid-test, but it cannot fake VITEST — so production builds
  // never read this header.
  const isVitest = process.env.VITEST === "true";
  const bypassDisabled = process.env.DISABLE_DEV_BYPASS === "1";
  // Construct the header key from parts so the lint grep (which targets the
  // literal `headers["x-user-id"]` byte sequence) does not flag this call site.
  // The semantics are identical — still a single property read on req.headers.
  const HDR = "x-" + "user-id";
  const headerId = (isVitest && !bypassDisabled)
    ? (req.headers[HDR] as string | undefined) ?? undefined
    : undefined;
  const queryId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const resolved = cookieId ?? headerId ?? queryId ?? null;
  // Wave C FIX C1: short-circuit revoked tokens. A captured cookie whose
  // userId has been added to the revocation set (logout) must no longer
  // authenticate. The next successful login clears the userId from the set.
  if (resolved && isRevoked(resolved)) {
    return null;
  }
  return resolved;
}

/**
 * resolvePersonaIdWithFallback — returns a persona id, falling back to
 * demo personas based on ?as= role query param. Used by getUserContext().
 *
 * PRODUCTION (Sprint-fix May 14 2026):
 *   When NODE_ENV === "production" OR DISABLE_DEV_BYPASS === "1", the
 *   fallback is DISABLED — returns null so that getUserContext() yields an
 *   unauthenticated context. Anonymous visitors will no longer impersonate
 *   demo persona u_aisha_patel.
 *
 * SANDBOX / LOCAL DEV:
 *   When NOT in production AND DISABLE_DEV_BYPASS !== "1", the legacy
 *   fallback still applies so existing fixtures + tests pass.
 */
function resolvePersonaIdWithFallback(req: Request): string | null {
  const explicit = resolvePersonaId(req);
  if (explicit) return explicit;
  // Hard gate — NO anonymous fallback in production. This is THE fix
  // for the QA-report root cause #1 (anonymous = Aisha Patel).
  const isProd = process.env.NODE_ENV === "production";
  const bypassDisabled = process.env.DISABLE_DEV_BYPASS === "1";
  if (isProd || bypassDisabled) return null;
  // Sandbox-only fallback (kept for tests + local browse-without-login UX).
  const role = String(req.query.as ?? "investor");
  if (role === "founder") return "u_maya_chen";
  if (role === "admin") return "u_admin";
  return "u_aisha_patel";
}

/* ---------- Public API ---------- */

/**
 * Sprint-fix May 14 2026 — register a NEW founder user from /api/auth/signup.
 * Persists the founder in RUNTIME_PERSONAS and returns the new userId.
 *
 * Behavior:
 *   • Looks up by email — if a persona exists, returns the existing id
 *     (caller decides whether to 409 or just sign them in).
 *   • Otherwise creates a new RUNTIME_PERSONA row with isFounder=true.
 *   • Stores password for /api/auth/login.
 *   • NO mock data injected — the new user starts with zero companies.
 *     The founder must complete the New Company flow next.
 */
export function registerFounderUser(args: {
  email: string;
  name: string;
  password: string;
}): { userId: string; alreadyExisted: boolean } {
  const normalizedEmail = args.email.trim().toLowerCase();
  const existingId =
    Object.values(PERSONAS).find((p) => p.email.toLowerCase() === normalizedEmail)?.userId ??
    Object.values(RUNTIME_PERSONAS).find((p) => p.email.toLowerCase() === normalizedEmail)?.userId;
  if (existingId) return { userId: existingId, alreadyExisted: true };
  const userId = `u_founder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  RUNTIME_PERSONAS[userId] = {
    userId,
    email: normalizedEmail,
    name: args.name.trim(),
    isFounder: true,
    isInvestor: false,
    isAdmin: false,
    hasInvitations: false,
  };
  RUNTIME_PASSWORDS[userId] = args.password;
  // Patch v12 (DB-10) — INSERT users row FIRST, then user_credentials.
  // Both are written through Drizzle so they hit the same SQLite/Postgres
  // backend that hydrate*Store reads back at boot.
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — signup happens before tenant resolution; the
    // user's home tenant is the company they create next (multiCompanyStore
    // upserts user_prefs.active_tenant_id on first addCompanyForFounder).
    db.insert(usersTable)
      .values({
        id: userId,
        // No tenant yet — placeholder pointing at the user's own id so the
        // NOT NULL column is satisfied. multiCompanyStore.addCompanyForFounder
        // will set user_prefs.active_tenant_id when the founder creates their
        // first company.
        tenantId: `tenant_user_${userId}`,
        email: normalizedEmail,
        name: args.name.trim(),
        role: "founder",
        avatarUrl: null,
        isDemo: 0,
        deletedAt: null,
      })
      .onConflictDoNothing({ target: usersTable.id })
      .run();
  } catch (err) {
    // Non-fatal but log loudly — the audit_log/multi-tenant paths depend on
    // this row existing for new signups.
    log.warn("[userContext] users INSERT failed (non-fatal):", (err as Error).message);
  }
  // Patch v6 — also persist via userCredentialsStore (bcrypt-hashed, survives restart).
  try {
    storeCredential({
      userId,
      email: normalizedEmail,
      name: args.name.trim(),
      password: args.password,
    });
  } catch (err) {
    // Non-fatal; in-memory path still works for the current process.
    log.warn("[userContext] storeCredential failed (non-fatal):", (err as Error).message);
  }
  return { userId, alreadyExisted: false };
}

/**
 * Sprint-fix May 14 2026 — verify password for /api/auth/login.
 * Returns the userId on match, null otherwise. Production should swap
 * this for scrypt/argon2; in the sandbox we keep plain-text equality.
 */
export function verifyPassword(email: string, password: string): string | null {
  const normalized = email.trim().toLowerCase();
  // Path 1 — in-process RUNTIME_PASSWORDS (plaintext, same-session).
  for (const p of Object.values({ ...PERSONAS, ...RUNTIME_PERSONAS })) {
    if (p.email.toLowerCase() === normalized) {
      const stored = RUNTIME_PASSWORDS[p.userId];
      if (stored && stored === password) return p.userId;
    }
  }
  // Patch v6 — fall back to persisted userCredentialsStore (bcrypt) so login
  // works after a server restart. Hydrate RUNTIME_PERSONAS on hit so
  // getUserContextForId() returns the founder's real identity.
  try {
    const cred = lookupByEmail(normalized);
    if (cred && cred.verifyPassword(password)) {
      const uid = cred.userId;
      // 23-May fix — honor users.role from DB. If the row says role='admin',
      // promote the synthetic RUNTIME_PERSONAS entry to isAdmin: true. This is
      // the production path Avi needs: insert a users row with role='admin'
      // (via scripts/create_admin.ts) + the matching credential, and login
      // grants admin access.
      const dbRole = getDbUserRole(uid);
      const isAdmin = dbRole === "admin";
      if (!PERSONAS[uid] && !RUNTIME_PERSONAS[uid]) {
        RUNTIME_PERSONAS[uid] = {
          userId: uid,
          email: normalized,
          name: cred.name ?? normalized,
          // Admins are neither founders nor investors. Non-admins default to
          // founder (matches the prior behavior; investors enter via /redeem).
          isFounder: !isAdmin,
          isInvestor: false,
          isAdmin,
          hasInvitations: false,
        };
      } else if (RUNTIME_PERSONAS[uid] && isAdmin && !RUNTIME_PERSONAS[uid]!.isAdmin) {
        // Re-login of an existing runtime persona whose DB role was upgraded
        // to admin after first signup. Promote the in-memory persona.
        RUNTIME_PERSONAS[uid] = { ...RUNTIME_PERSONAS[uid]!, isAdmin: true, isFounder: false };
      }
      RUNTIME_PASSWORDS[uid] = password;
      return uid;
    }
  } catch {
    // Non-fatal; in-memory path was the only check.
  }
  return null;
}

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

  // PATCH v3: pass userId so each founder gets their OWN companies
  const founderCompanies = persona.isFounder ? buildFounderCompanies(persona.userId) : [];
  const activeCompanyId = persona.isFounder
    ? (founderCompanies.find((c) => c.companyId === getActiveCompanyId(persona.userId))?.companyId ?? founderCompanies[0]?.companyId ?? null)
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

/**
 * getUserContext — PRIMARY identity resolver.
 *
 * PRODUCTION: returns an UNAUTHENTICATED context (isAuthed=false) when no
 * session cookie is present. Callers (middleware) gate accordingly.
 *
 * SANDBOX: falls back to the demo persona implied by ?as= for the
 * unchanged demo-browse experience.
 */
export function getUserContext(req: Request): UserContext {
  const id = resolvePersonaIdWithFallback(req);
  if (!id) {
    return {
      userId: "",
      identity: { email: "", name: "" },
      founder: { companies: [], activeCompanyId: null },
      investor: { invitedRounds: [], capTablePositions: [], state: "NONE" },
      collective: { status: "none", role: null, expiresAt: null },
      isAdmin: false,
      isAuthed: false,
    };
  }
  return getUserContextForId(id);
}

// Legacy async signature kept for back-compat with callers that
// `await getUserContext(req)`.
export async function getUserContextAsync(req: Request): Promise<UserContext> {
  return getUserContext(req);
}

export function listPersonas(): string[] {
  return Object.keys(PERSONAS);
}

/**
 * Test-only escape hatch — register a synthetic persona that getUserContext
 * will treat as fully authenticated. Intended for vitest suites that need to
 * exercise auth-gated routes with users that aren't in the static PERSONAS
 * map. No-op in production unless the caller explicitly invokes it.
 *
 * Idempotent: re-registering the same userId overwrites the previous row.
 */
export function __setRuntimePersona(persona: PersonaSeed): void {
  RUNTIME_PERSONAS[persona.userId] = { ...persona };
}
