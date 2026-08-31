/**
 * Sprint 11 — Investor membership toggle + strict gating.
 *
 * Per audit: an investor on a Capavate cap table CAN apply to the Capavate
 * Collective. If their membership lapses (renewal not paid), the toggle
 * disappears and they lose Collective access — but they retain access to
 * Capavate communications gated by their cap-table position.
 *
 * The strict-gating model says: an investor NOT on any cap table sees
 * 0 communications, 0 company info, 0 dataroom files, 0 messages. Server
 * guards return 403 on every related endpoint when the requester fails
 * the cap-table check.
 *
 * Routes:
 *   GET  /api/collective/membership-status
 *   GET  /api/founder/access-check?investorId=...&companyId=...
 */
import type { Express, Request, Response } from "express";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { getLedger } from "./captableCommitStore";
import { persistEntry, persistEntryStrict, hydrateEntries } from "./lib/storePersistenceShim";
/* WAVE 183 · ITEM B FIX 1a — the id-namespace bridge (R150.2 class).
   `investor_identity_alias` is written by the "Check for earlier investments"
   claim path and, until this wave, was read by NOTHING on the portfolio read
   path. `resolveInvestorIdSet` returns the caller's canonical id FIRST followed
   by their own ACTIVE aliases, and fails CLOSED to `[canonical]` on any read
   error, so this import can only ever widen a lookup to ids the caller has
   already proved are theirs. `investorIdentityAliasStore` imports only
   `node:crypto`, `./lpIdentity`, `../db/*` and `./logger`, so there is no
   import cycle back into this module. */
import { resolveInvestorIdSet } from "./lib/investorIdentityAliasStore";

const PERSIST_STORE = "membershipStore";

type MembershipStatus = {
  userId: string;
  isCollectiveMember: boolean;
  memberSince: string | null;
  expiresAt: string | null;
  lapsed: boolean;
  reason: string;
  /* WAVE 116 · FINDING 3 (Wave 113 ownership site #8) — `ownershipPct` HERE IS A
     SENTINEL, NOT A MEASUREMENT, AND IT NOW SAYS SO.

     `ownershipPct` cannot be widened to `number | null`: the shape is copied into
     `CapTablePosition` in the SACRED `server/lib/userContext.ts` (`:157`, copied
     at `:417`), which declares it `number`. Editing a sacred file to fix a label
     is not available to this wave, so the fix is ADDITIVE: the number stays, and
     two fields beside it state whether it means anything.

     `ownershipPctKnown: false` + `ownershipBasis: null` is the honest description
     of the ledger-derived rows: the commit ledger records WHICH companies a user
     holds in, never a percentage, so the `0` is "not recorded", not "zero
     percent". Ruling R6 forbids RENDERING never-entered data as `0`, and no
     client renders this field (verified: it is only type-referenced at
     `client/src/components/CapCollectiveToggle.tsx:31` and
     `client/src/collective/widgets/useMe.ts:25`) — the gates read
     presence/absence only. `ownershipPctKnown` is what a future renderer must
     check before printing anything. */
  capTablePositions: Array<{
    companyId: string;
    companyName: string;
    /** Meaningful ONLY when `ownershipPctKnown` is true. See the note above. */
    ownershipPct: number;
    /** `false` = the `0`/`0.01` above is a placeholder, not a measurement. */
    ownershipPctKnown?: boolean;
    /** The denominator `ownershipPct` divides by, or `null` when there is none. */
    ownershipBasis?: string | null;
  }>;
  canApplyToCollective: boolean;
};

// Demo: a small set of mock investor users with diverse states.
// Patch v4: only populated when demo gate is on.
const MOCK_MEMBERSHIP: Record<string, MembershipStatus> = DEMO_SEED_ENABLED ? {
  u_aisha_patel: {
    userId: "u_aisha_patel",
    isCollectiveMember: true,
    memberSince: "2025-03-01",
    expiresAt: "2026-12-31",
    lapsed: false,
    reason: "Active member on cap table for 2 companies.",
    capTablePositions: [
      /* WAVE 116 · FINDING 3 — demo seed figures ARE entered values, so they are
         flagged known, which is what distinguishes them from the ledger-derived
         `0` sentinel below. */
      { companyId: "co_novapay",  companyName: "NovaPay AI",     ownershipPct: 0.041, ownershipPctKnown: true, ownershipBasis: "demo seed (fraction of fully-diluted shares)" },
      { companyId: "co_arboreal", companyName: "Arboreal Health", ownershipPct: 0.012, ownershipPctKnown: true, ownershipBasis: "demo seed (fraction of fully-diluted shares)" },
    ],
    canApplyToCollective: true,
  },
  u_lapsed_lp: {
    userId: "u_lapsed_lp",
    isCollectiveMember: false,
    memberSince: "2024-04-01",
    expiresAt: "2025-12-31",
    lapsed: true,
    reason: "Membership renewal lapsed; Collective access removed but cap-table comms remain.",
    capTablePositions: [
      { companyId: "co_novapay", companyName: "NovaPay AI", ownershipPct: 0.018, ownershipPctKnown: true, ownershipBasis: "demo seed (fraction of fully-diluted shares)" },
    ],
    canApplyToCollective: false,
  },
  u_no_position: {
    userId: "u_no_position",
    isCollectiveMember: false,
    memberSince: null,
    expiresAt: null,
    lapsed: false,
    reason: "No cap-table positions — strict gating denies all Capavate access.",
    capTablePositions: [],
    canApplyToCollective: false,
  },
} : {};

/**
 * V4 (Patch v8) — Derive cap-table positions from the canonical ledger.
 *
 * Previously, MOCK_MEMBERSHIP was the single source of truth for whether an
 * investor was "on the cap table" of a company. Commits to captableCommitStore
 * were never reflected in entitlement gates. This function reads the ledger
 * for `committed` entries belonging to `userId` and exposes them as
 * `capTablePositions`, with a small in-memory index keyed by
 * (investorId, companyId) keyed off the ledger length to avoid scanning.
 *
 * IMPORTANT: this does NOT touch packages/cap-table-engine* math. It only
 * reads getLedger() and projects committed entries.
 */
let _ledgerIndexLen = -1;
type LedgerPosition = { companyId: string; ownershipPct: number; ownershipPctKnown: boolean; ownershipBasis: string | null; companyName: string };
let _ledgerIndex: Map<string, Map<string, LedgerPosition>> = new Map();

function rebuildLedgerIndexIfStale(): void {
  const ledger = getLedger();
  if (ledger.length === _ledgerIndexLen) return;
  const idx = new Map<string, Map<string, LedgerPosition>>();
  for (const e of ledger) {
    if (e.state !== "committed") continue;
    let perUser = idx.get(e.investorId);
    if (!perUser) { perUser = new Map(); idx.set(e.investorId, perUser); }
    /* WAVE 116 · FINDING 3 — the sentinel is unchanged (it cannot become `null`;
       see the note on `capTablePositions`) but it is now LABELLED as unknown, so
       a consumer that reads it cannot mistake a placeholder for a holding of
       zero percent. Ownership percentages come from the cap-table engine, which
       is the only thing on this platform that owns a denominator. */
    perUser.set(e.companyId, {
      companyId: e.companyId,
      ownershipPct: 0,
      ownershipPctKnown: false,
      ownershipBasis: null,
      companyName: e.companyId,
    });
  }
  _ledgerIndex = idx;
  _ledgerIndexLen = ledger.length;
}

/**
 * WAVE 183 · ITEM B FIX 1a — THE READ COULD NOT SEE WHAT THE WRITE WROTE.
 *
 * THE DEFECT. `_ledgerIndex` is keyed by the RAW `captable_commits.investor_id`.
 * On the inspected database 654 of 1017 committed rows are keyed under a
 * synthetic `ext_<hash>` identifier while this lookup was performed with the
 * canonical `usr_`/`u_` user id ONLY. So an LP whose ledger rows sit in the
 * `ext_` namespace resolved to ZERO positions, `ctx.investor.capTablePositions`
 * came back empty, and `gate("investor.hasAnyCapTable")` returned 403
 * `CAP_TABLE_REQUIRED` on `/api/investor/portfolio2`. The LP was shown
 * "We couldn't load your portfolio positions." — a transient-sounding sentence
 * for a permanent condition.
 *
 * This is the same class as wave 177's `partner_team_members.partner_id` holding
 * a tenant id (R150.2): not a null column, a value in the wrong namespace.
 *
 * WHY THE WRITE PATH APPEARED TO SUCCEED. "Check for earlier investments"
 * (`client/src/pages/investor/ClaimPositions.tsx`) POSTs
 * `/api/me/investor-identity/claim`, which writes an `investor_identity_alias`
 * row binding `ext_<hash>` to the canonical user. It genuinely succeeded. It
 * wrote to a table THIS FUNCTION NEVER READ. Write and read disagreed because
 * they were looking at two different namespaces.
 *
 * THE FIX, AND WHY IT IS SHAPED THIS WAY.
 *   - The union is performed HERE, at READ time, and `_ledgerIndex` keeps its
 *     raw keying. Rewriting the index to canonicalise its keys would have
 *     changed `listMembersForCompany` and every other index consumer, and — the
 *     reason that would have been a silent bug rather than a loud one — the
 *     index is only rebuilt when `ledger.length` CHANGES. An alias claimed after
 *     the index was built moves no ledger row, so a canonicalising index would
 *     have kept serving the pre-claim answer until the next commit anywhere on
 *     the platform. Read-time resolution has no such staleness.
 *   - `resolveInvestorIdSet` puts the canonical id first and appends only the
 *     caller's own ACTIVE aliases; `claimAlias` refuses a cross-user claim with
 *     `ALIAS_ALREADY_CLAIMED`. This can therefore widen the answer only to rows
 *     the caller has already proved are theirs. It cannot leak another
 *     investor's position.
 *   - Dedupe is by `companyId`, and the canonical id is merged FIRST, so a
 *     company held under both namespaces yields ONE position and the canonical
 *     row wins. No count is inflated.
 *   - No figure is invented: the `ownershipPct` sentinel and its
 *     `ownershipPctKnown: false` / `ownershipBasis: null` labels are carried
 *     through unchanged from `rebuildLedgerIndexIfStale`.
 */
function derivedPositionsFor(userId: string): Array<{ companyId: string; companyName: string; ownershipPct: number; ownershipPctKnown: boolean; ownershipBasis: string | null }> {
  rebuildLedgerIndexIfStale();
  const ids = resolveInvestorIdSet(userId);
  const per = new Map<string, LedgerPosition>();
  for (const id of ids.length > 0 ? ids : [userId]) {
    const forId = _ledgerIndex.get(id);
    if (!forId) continue;
    /* `forEach` rather than `for...of` deliberately: this project's `tsc` target
       is below ES2015 for iteration purposes and a `for...of` over a Map raises
       TS2802 (`--downlevelIteration`). The pre-existing TS2802 at
       `listMembersForCompany` is exactly that error and is NOT this wave's to
       fix; adding a second one would have raised the error count. */
    forId.forEach((pos, companyId) => {
      if (!per.has(companyId)) per.set(companyId, pos);
    });
  }
  if (per.size === 0) return [];
  return Array.from(per.values()).map((p) => ({
    companyId: p.companyId,
    companyName: p.companyName,
    ownershipPct: p.ownershipPct,
    /* WAVE 116 · FINDING 3 — the "is this a real figure?" flag travels with the
       figure. Dropping it here would have re-anonymised the sentinel one hop
       later, which is exactly how the platform ended up with eight of these. */
    ownershipPctKnown: p.ownershipPctKnown,
    ownershipBasis: p.ownershipBasis,
  }));
}

/**
 * Merge MOCK_MEMBERSHIP seed (for tests/dev) with ledger-derived positions
 * (for runtime cap-table commits). Ledger wins on companyId conflict.
 */
function mergedMembership(userId: string): MembershipStatus | null {
  const seed = MOCK_MEMBERSHIP[userId] ?? null;
  const derived = derivedPositionsFor(userId);
  if (!seed && derived.length === 0) return null;
  const base: MembershipStatus = seed ?? {
    userId,
    isCollectiveMember: false,
    memberSince: null,
    expiresAt: null,
    lapsed: false,
    reason: derived.length > 0 ? `Active member on cap table for ${derived.length} compan${derived.length === 1 ? "y" : "ies"}.` : "No cap-table positions.",
    capTablePositions: [],
    canApplyToCollective: derived.length > 0,
  };
  if (derived.length === 0) return base;
  const seen = new Set(base.capTablePositions.map((p) => p.companyId));
  const merged = base.capTablePositions.slice();
  for (const p of derived) {
    if (!seen.has(p.companyId)) {
      merged.push(p);
      seen.add(p.companyId);
    }
  }
  return { ...base, capTablePositions: merged, canApplyToCollective: base.canApplyToCollective || merged.length > 0 };
}

/**
 * v16 F-coll-X3 — dual-write helper for admin approval.
 *
 * `collectiveMembershipStore` (admin approval target) and this module's
 * `MOCK_MEMBERSHIP` overlay (the source `buildCollectiveOverlay` /
 * `gate("collective.active")` reads) used to diverge: admin approval wrote
 * to ONE map, the entitlement gate read the OTHER. v16 unifies by having
 * the admin approval call BOTH stores.
 *
 * This helper upserts a minimal active record so `getMembership(userId)`
 * returns `isCollectiveMember: true`. It does NOT fabricate cap-table
 * positions — those still flow from the ledger via `mergedMembership`.
 */
export function upsertActiveMembership(
  userId: string,
  opts?: { memberSince?: string; expiresAt?: string; strict?: boolean },
): MembershipStatus {
  const now = new Date().toISOString();
  const existing = MOCK_MEMBERSHIP[userId];
  const next: MembershipStatus = existing
    ? {
        ...existing,
        isCollectiveMember: true,
        memberSince: existing.memberSince ?? opts?.memberSince ?? now,
        expiresAt: opts?.expiresAt ?? existing.expiresAt ?? null,
        lapsed: false,
        reason: "Activated by admin approval (v16 unified write).",
        canApplyToCollective: true,
      }
    : {
        userId,
        isCollectiveMember: true,
        memberSince: opts?.memberSince ?? now,
        expiresAt: opts?.expiresAt ?? null,
        lapsed: false,
        reason: "Activated by admin approval (v16 unified write).",
        capTablePositions: [],
        canApplyToCollective: true,
      };
  /* v25.9 — persist so admin approval survives restart.
   * Avi: "Most of the records are being saved in memory instead of the DB."
   *
   * v25.52 Track 3.0 (GPT-5.5 review, MAJOR): the collective overlay read by
   * /api/auth/me (buildCollectiveOverlay → getMembership → MOCK_MEMBERSHIP) and
   * requireEntitlement('collective.active') depends on THIS overlay. The default
   * best-effort persistEntry swallows DB-write failure, so the overlay could be
   * RAM-only and vanish on restart even though the authoritative
   * collectiveMembershipStore row persisted. When strict=true we persist FIRST
   * via persistEntryStrict (throws on failure) and only mutate the RAM overlay
   * AFTER a durable write, so RAM never diverges from the DB and the caller can
   * fail-closed (500). Non-strict callers keep the prior best-effort behavior. */
  if (opts?.strict) {
    persistEntryStrict(PERSIST_STORE, userId, next); // throws on failure BEFORE RAM mutation
    MOCK_MEMBERSHIP[userId] = next;
  } else {
    MOCK_MEMBERSHIP[userId] = next;
    persistEntry(PERSIST_STORE, userId, next);
  }
  return next;
}

/**
 * v16 F-coll-X3 — companion deactivation helper for symmetric admin flows.
 * Marks the membership as not-collective without dropping cap-table positions.
 */
export function deactivateMembership(userId: string): MembershipStatus | null {
  const existing = MOCK_MEMBERSHIP[userId];
  if (!existing) return null;
  const next: MembershipStatus = {
    ...existing,
    isCollectiveMember: false,
    lapsed: true,
    reason: "Deactivated by admin (v16 unified write).",
  };
  MOCK_MEMBERSHIP[userId] = next;
  /* v25.9 — persist deactivation */
  persistEntry(PERSIST_STORE, userId, next);
  return next;
}

/**
 * W3-C test seam — seed a MOCK_MEMBERSHIP cap-table position for a user so the
 * C-5 individual-membership gate's cap-table sub-check (isOnCapTable) admits
 * them. Follows the existing `*ForTests` convention; DEMO_SEED_ENABLED-gated so
 * it is inert in production. Additive: does NOT flip isCollectiveMember (that is
 * upsertActiveMembership's job) — only puts a position on the cap table, exactly
 * as a real captable_commit / ledger entry would for entitlement purposes.
 */
export function upsertCapTablePositionForTests(
  userId: string,
  companyId = "co_test",
  opts?: { companyName?: string; ownershipPct?: number },
): MembershipStatus {
  const existing = MOCK_MEMBERSHIP[userId];
  /* WAVE 116 · FINDING 3 — the `?? 0.01` default is a made-up 1% holding. It is
     LEFT IN PLACE because this is a demo/test seeding helper whose callers'
     expectations are not this wave's to change, but it is now flagged as not
     known, so nothing downstream can quote it as a measured figure. Recorded as
     a found-not-fixed item in `build_log/wave116/W116_TESTS.md`. */
  const pos = {
    companyId,
    companyName: opts?.companyName ?? companyId,
    ownershipPct: opts?.ownershipPct ?? 0.01,
    ownershipPctKnown: opts?.ownershipPct != null,
    ownershipBasis: null,
  };
  const next: MembershipStatus = existing
    ? {
        ...existing,
        capTablePositions: existing.capTablePositions.some((p) => p.companyId === companyId)
          ? existing.capTablePositions
          : [...existing.capTablePositions, pos],
        canApplyToCollective: true,
      }
    : {
        userId,
        isCollectiveMember: false,
        memberSince: null,
        expiresAt: null,
        lapsed: false,
        reason: "Seeded cap-table position (test seam).",
        capTablePositions: [pos],
        canApplyToCollective: true,
      };
  MOCK_MEMBERSHIP[userId] = next;
  return next;
}

export function isCollectiveMember(userId: string, asOf: Date = new Date()): boolean {
  const m = MOCK_MEMBERSHIP[userId];
  if (!m) return false;
  if (!m.isCollectiveMember) return false;
  if (m.expiresAt && new Date(m.expiresAt) < asOf) return false;
  return true;
}

export function getMembership(userId: string): MembershipStatus | null {
  return mergedMembership(userId);
}

export function isOnCapTable(userId: string, companyId?: string): boolean {
  const m = mergedMembership(userId);
  if (!m) return false;
  if (!companyId) return m.capTablePositions.length > 0;
  return m.capTablePositions.some((p) => p.companyId === companyId);
}

/**
 * V4 — Public API used by routes/entitlement gates. Returns all
 * users currently on a company's cap table (derived from the ledger
 * plus the seed map).
 */
export function listMembersForCompany(companyId: string): Array<{ userId: string; companyId: string; ownershipPct: number }> {
  const out: Array<{ userId: string; companyId: string; ownershipPct: number }> = [];
  // Seed fixtures
  for (const [uid, m] of Object.entries(MOCK_MEMBERSHIP)) {
    const pos = m.capTablePositions.find((p) => p.companyId === companyId);
    if (pos) out.push({ userId: uid, companyId, ownershipPct: pos.ownershipPct });
  }
  // Ledger commits
  rebuildLedgerIndexIfStale();
  for (const [uid, per] of _ledgerIndex.entries()) {
    if (out.some((r) => r.userId === uid)) continue;
    const pos = per.get(companyId);
    if (pos) out.push({ userId: uid, companyId, ownershipPct: pos.ownershipPct });
  }
  return out;
}

/**
 * Strict-gating middleware.
 * Returns 403 when the requester is an investor with zero cap-table positions.
 * Founders/admins always pass. Pass `?as=founder|admin` to simulate that role.
 */
export function strictGatingGuard(req: Request, res: Response, next: () => void): void {
  const role = String(req.query.as ?? "investor");
  if (role === "founder" || role === "admin") return next();
  // v14 Fix 2: identity comes from session (loadUserContext); query override
  // only honored in non-prod environments for demo/QA harnesses.
  const sessionUserId = (req as any).userContext?.userId as string | undefined;
  const isProd = String(process.env.NODE_ENV ?? "").toLowerCase() === "production";
  const userId = String(
    sessionUserId ?? (isProd ? "" : (req.query.investorId ?? "")),
  );
  if (!userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isOnCapTable(userId)) {
    res.status(403).json({
      error: "strict_gating_denied",
      message: "Investor must be on at least one Capavate cap table to access communications, company info, or dataroom.",
      userId,
    });
    return;
  }
  next();
}

export function registerMembershipRoutes(app: Express): void {
  app.get("/api/collective/membership-status", (req: Request, res: Response) => {
    // v14 — default to caller's identity, never the demo investor persona.
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const queryUserId = typeof req.query.userId === "string" ? req.query.userId : null;
    const userId = queryUserId ?? ctx?.userId ?? null;
    if (!userId) return res.status(401).json({ error: "missing_identity" });
    const m = getMembership(userId);
    if (!m) return res.status(404).json({ error: "user_not_found" });
    res.json(m);
  });

  app.get("/api/founder/access-check", (req: Request, res: Response) => {
    // v14 — require explicit params; no demo persona/company fallback.
    const userId = typeof req.query.investorId === "string" ? req.query.investorId : "";
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : "";
    if (!userId || !companyId) {
      return res.status(400).json({ error: "investorId_and_companyId_required" });
    }
    const onTable = isOnCapTable(userId, companyId);
    res.json({
      userId,
      companyId,
      isOnCapTable: onTable,
      canSeeCompany: onTable,
      canSeeCommunications: onTable,
      canSeeDataroom: onTable,
      enforcedAt: new Date().toISOString(),
    });
  });
}

/**
 * v25.9 — Rehydrate memberships from DB on boot.
 */
export async function hydrateMembershipStore(): Promise<void> {
  try {
    const entries = hydrateEntries<MembershipStatus>(PERSIST_STORE);
    for (const [userId, m] of entries) MOCK_MEMBERSHIP[userId] = m;
    if (entries.length > 0) {
      console.info(`[hydrate] membershipStore: ${entries.length} memberships restored`);
    }
  } catch (err) {
    console.warn(`[hydrate] membershipStore: DB read failed (non-fatal): ${(err as Error).message}`);
  }
}
