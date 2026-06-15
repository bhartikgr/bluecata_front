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
/* v25.25.2 — createRequire shim so lazy require() calls in this file work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist (where `require` is already defined as a global).
   Cheap, minimal, and avoids re-introducing circular-import bugs that
   would arise from converting every lazy require() to a static import. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

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
import { getDb, rawDb } from "../db/connection";
import { hashPassword } from "./auth"; // v23.8 W-10 — auth_users password hash
// Wave C FIX C1 (W-2) — Server-side session revocation: cookies whose userId
// has been added to the revocation set (via /api/auth/logout) must no longer
// authenticate, even if the cookie value itself is otherwise valid.
import { isRevoked } from "./sessionRevocation";
import { extractUserIdFromCookie } from "./sessionCookie";
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
/**
 * v24.4 Bug C — read the durable role written to `auth_users` by the secure
 * redeem path (`server/lib/secureAuthRoutes.ts`). Invite-created investors get
 * `auth_users.role = 'investor'`; this is the durable source of truth for their
 * persona after logout/restart. Matches by id OR (lowercased) email so the
 * lookup works whether we have the userId, the email, or both. Returns null on
 * any error or miss.
 */
function getAuthUsersRole(opts: { userId?: string; email?: string }): string | null {
  try {
    const adb = rawDb();
    const emailLower = (opts.email ?? "").trim().toLowerCase();
    const row = adb
      .prepare(`SELECT role FROM auth_users WHERE lower(email) = ? OR id = ? LIMIT 1`)
      .get(emailLower, opts.userId ?? "") as { role?: string } | undefined;
    const role = row?.role ?? null;
    return typeof role === "string" && role.trim() ? role.trim() : null;
  } catch (err) {
    log.warn({
      route: "userContext.getAuthUsersRole",
      errorType: "db_read_failed",
      message: (err as Error).message,
    });
    return null;
  }
}

function getDbUserRole(userId: string, email?: string): string | null {
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
    if (typeof role === "string" && role.trim()) return role.trim();
    // v24.4 Bug C — fall back to the durable auth_users.role when the legacy
    // `users` table has nothing (e.g. invite-created investors are written to
    // auth_users by the secure redeem path, not to `users`).
    return getAuthUsersRole({ userId, email });
  } catch (err) {
    log.warn({
      route: "userContext.getDbUserRole",
      errorType: "db_read_failed",
      message: (err as Error).message,
    });
    // Best-effort durable fallback even if the drizzle read threw.
    return getAuthUsersRole({ userId, email });
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
  // v23.8 W-13: previously this early-returned `status:"none"` for any
  // non-investor persona, so a founder whose Collective application the admin
  // approved never saw their membership in /api/auth/me. The membership store
  // (written by admin approval via upsertActiveMembership) already holds the
  // correct record for founders AND investors, so read it for all personas.
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
  /* v25.17 Lane C NC1 — cookie body is now HMAC-signed; extractor verifies
     before returning the userId, so a guessed "u_admin" no longer authenticates.
     v25.20 Lane 3 — extractUserIdFromCookie is now a top-level static import
     (see top of file). The prior runtime require("./sessionCookie") could not
     be resolved by Vitest's CJS loader from a .ts module, which threw
     "Cannot find module './sessionCookie'" and surfaced as a 500 on EVERY
     authenticated route under test. Behavior (HMAC-verified cookie identity)
     is identical; only the load mechanism changed. */
  const cookieId = extractUserIdFromCookie(req) ?? undefined;
  // v14 Tier-1 Fix 1 — header identity is a TEST-HARNESS-ONLY convenience.
  const isVitest = process.env.VITEST === "true";
  const bypassDisabled = process.env.DISABLE_DEV_BYPASS === "1";
  const HDR = "x-" + "user-id";
  const headerId = (isVitest && !bypassDisabled)
    ? (req.headers[HDR] as string | undefined) ?? undefined
    : undefined;
  /* v25.17 Lane C NC3 — the legacy ?userId= query-string identity bypass is
     now gated to the same Vitest-only condition as the x-user-id header.
     Production requests with ?userId=u_admin will NOT authenticate. */
  const queryId = (isVitest && !bypassDisabled)
    ? (typeof req.query.userId === "string" ? req.query.userId : undefined)
    : undefined;
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
  // v23.8 W-10 — also write an auth_users row so the admin Users panel
  // (adminUsersRoutes.listAll reads auth_users) shows real signups instead of
  // 0 entries. This does NOT affect login: verifyPassword reads
  // RUNTIME_PASSWORDS + userCredentialsStore, never auth_users. The hash is a
  // scrypt `s2$...` string (password_hash is NOT NULL in the schema).
  try {
    const adb = rawDb();
    adb
      .prepare(
        `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, created_at)
         VALUES (?, ?, ?, 'scrypt', 'founder', 'active', ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(userId, normalizedEmail, hashPassword(args.password), new Date().toISOString());
  } catch (err) {
    // Non-fatal — the admin panel enrichment is best-effort; signup/login must
    // never fail because of an auth_users write hiccup.
    log.warn("[userContext] auth_users INSERT failed (non-fatal):", (err as Error).message);
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
  /* v25.17 Lane C NC8 — the in-process RUNTIME_PASSWORDS path used a non-
     constant-time `stored === password` compare on plaintext. Replace with
     timing-safe compare. Production credentials live in userCredentialsStore
     (bcrypt, Path 2 below); this in-memory map is only the synthetic
     dev/test PERSONAS path. We keep the path for parity but the compare is
     constant-time. */
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cryptoMod = require("node:crypto") as typeof import("node:crypto");
  function safeEq(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    try { return cryptoMod.timingSafeEqual(ab, bb); } catch { return false; }
  }
  for (const p of Object.values({ ...PERSONAS, ...RUNTIME_PERSONAS })) {
    if (p.email.toLowerCase() === normalized) {
      const stored = RUNTIME_PASSWORDS[p.userId];
      if (stored && safeEq(stored, password)) return p.userId;
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
      // v24.4 Bug C — hydrate role from durable sources (users.role, then
      // auth_users.role) BEFORE synthesizing the default founder persona.
      // Invite-created investors are written to auth_users.role='investor' by
      // the secure redeem path; without this, normal login after logout/restart
      // rebuilds them as founder and routes them to the wrong dashboard.
      const dbRole = getDbUserRole(uid, normalized);
      const isAdmin = dbRole === "admin";
      const isInvestorRole = dbRole === "investor";
      if (!PERSONAS[uid] && !RUNTIME_PERSONAS[uid]) {
        RUNTIME_PERSONAS[uid] = {
          userId: uid,
          email: normalized,
          name: cred.name ?? normalized,
          // Admins are neither founders nor investors. Investors (durable
          // auth_users.role='investor') get an investor persona. Everyone else
          // defaults to founder (matches the prior behavior).
          isFounder: !isAdmin && !isInvestorRole,
          isInvestor: isInvestorRole,
          isAdmin,
          hasInvitations: false,
        };
      } else if (RUNTIME_PERSONAS[uid] && isAdmin && !RUNTIME_PERSONAS[uid]!.isAdmin) {
        // Re-login of an existing runtime persona whose DB role was upgraded
        // to admin after first signup. Promote the in-memory persona.
        RUNTIME_PERSONAS[uid] = { ...RUNTIME_PERSONAS[uid]!, isAdmin: true, isFounder: false };
      } else if (
        RUNTIME_PERSONAS[uid] &&
        isInvestorRole &&
        (!RUNTIME_PERSONAS[uid]!.isInvestor || RUNTIME_PERSONAS[uid]!.isFounder)
      ) {
        // Re-login of a runtime persona whose durable role is investor but whose
        // in-memory persona was synthesized as founder. Correct it so the user
        // lands on the investor dashboard.
        RUNTIME_PERSONAS[uid] = { ...RUNTIME_PERSONAS[uid]!, isInvestor: true, isFounder: false };
      }
      /* v25.17 Lane C NC8 — do NOT re-store the plaintext password on every
         successful bcrypt login. The bcrypt-backed credential store is the
         source of truth; persisting plaintext made the verification a timing
         oracle and kept cleartext in process memory. */
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
    // v25.1 Bug 5 fix (Avi prod report 11-Jun):
    // The existingId branch used to only update RUNTIME_PASSWORDS (RAM). On
    // server restart, the investor's password was lost and they couldn't log
    // in. Persist to userCredentialsStore + auth_users + users so re-redeeming
    // an invitation behaves the same way as a first-time redeem. Closes
    // "avinayquicktech+7@gmail.com can't log in after logout" + "investor
    // missing from CRM".
    try {
      storeCredential({
        userId: existingId,
        email: args.email.trim().toLowerCase(),
        name: args.name,
        password: args.password,
      });
    } catch (err) {
      log.warn("[userContext.registerPersona existing] storeCredential failed:", (err as Error).message);
    }
    try {
      const adb = rawDb();
      adb.prepare(
        `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, created_at)
         VALUES (?, ?, ?, 'scrypt', 'investor', 'active', ?)
         ON CONFLICT(id) DO UPDATE SET
           password_hash = excluded.password_hash,
           password_algo = excluded.password_algo,
           email = excluded.email`,
      ).run(existingId, args.email.trim().toLowerCase(), hashPassword(args.password), new Date().toISOString());
    } catch (err) {
      log.warn("[userContext.registerPersona existing] auth_users INSERT failed:", (err as Error).message);
    }
    try {
      const adb = rawDb();
      adb.prepare(
        `INSERT INTO users (id, tenant_id, email, name, role, is_demo)
         VALUES (?, ?, ?, ?, 'investor', 0)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
      ).run(existingId, "tenant_capavate", args.email.trim().toLowerCase(), args.name);
    } catch { /* best-effort */ }
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
  // v25.0 RAM→DB fix: persist invitation-redeemed investor credentials via
  // userCredentialsStore (bcrypt-hashed, survives restart). Without this,
  // investors created via /api/invitations/redeem cannot log in after a
  // server restart (J47/J48 durability tests).
  try {
    storeCredential({
      userId,
      email: args.email.trim().toLowerCase(),
      name: args.name,
      password: args.password,
    });
  } catch (err) {
    log.warn("[userContext.registerPersona] storeCredential failed (non-fatal):", (err as Error).message);
  }
  // Also persist the auth_users row with role='investor' so post-restart
  // verifyPassword() correctly classifies the user as an investor (see
  // getDbUserRole path in verifyPassword above).
  try {
    const adb = rawDb();
    adb
      .prepare(
        `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, created_at)
         VALUES (?, ?, ?, 'scrypt', 'investor', 'active', ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(userId, args.email.trim().toLowerCase(), hashPassword(args.password), new Date().toISOString());
  } catch (err) {
    log.warn("[userContext.registerPersona] auth_users INSERT failed (non-fatal):", (err as Error).message);
  }
  // Also persist a users row so admin user listings and the founder.companies
  // computation from DB still discover the investor record.
  try {
    const adb = rawDb();
    adb
      .prepare(
        `INSERT INTO users (id, tenant_id, email, name, role, is_demo)
         VALUES (?, ?, ?, ?, 'investor', 0)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(userId, "tenant_capavate", args.email.trim().toLowerCase(), args.name);
  } catch {
    /* best-effort */
  }
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
