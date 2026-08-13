/**
 * W-COLLECTIVE Wave 2 STAGE D (D3 + D4) — DURABLE re-source for the
 * production-empty `COMMS_USERS` map.
 *
 * ── THE DEFECT THIS REPLACES ────────────────────────────────────────────────
 * `server/commsStore.ts:271` declares
 *
 *     export const COMMS_USERS = DEMO_SEED_ENABLED ? _seed_COMMS_USERS : {};
 *
 * and `DEMO_SEED_ENABLED` is FALSE in production (server/lib/demoGate.ts), so on
 * LIVE the map is `{}`. Thirteen reads of it therefore silently degrade:
 * role badges collapse to "Member", the "Collective member" / "Invited contact"
 * label always picks the latter, author locations are blank, the
 * `authorKind=collective` feed filter returns ZERO posts (fails closed) while
 * the `sort=following` feed filter returns EVERY post (fails OPEN), and
 * `/api/comms/users` — the DM recipient picker's only source — returns `[]`.
 *
 * This module is the durable replacement. Every field is derived from a ROW:
 *
 *   legalName / email  → `users` (name / display_name / email)
 *   visibility         → SACRED `userPrivacyResolver.readUserPrivacy`, which
 *                        reads `profilestore_user_privacy`
 *   capTables          → committed `captable_commits` positions (the SACRED
 *                        ledger, read-only) ∪ companies the user actively
 *                        founds (`company_members`)
 *   collectiveChapters → ACTIVE, non-deleted `chapter_memberships`
 *   roles              → `users.role` + active founder rows in
 *                        `company_members` + a live `soft_circles` row
 *   location           → D4 owner decision, see `durableAuthorLocation`
 *
 * ── NOTHING IS CACHED, DELIBERATELY ─────────────────────────────────────────
 * There is NO module-level memo. Stage D's hard rule is that nothing canonical
 * lives in memory, and several of these fields (chapter membership, follow
 * state, privacy opt-out) change the *content* a viewer sees. A TTL cache would
 * make an opt-out or an unfollow take effect only after it expired, which is
 * exactly the class of bug this stage exists to remove. Reads are single-row,
 * indexed and prepared; the feed loop is bounded by the page it already builds.
 *
 * ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
 * Any DB error, missing table or malformed id yields `undefined` (unknown user)
 * or an empty list — never a fabricated identity and never a wider audience.
 * All SQL is parameterised. This module performs SELECTs only; it never writes.
 */
import { rawDb } from "../db/connection";
import { readUserPrivacy } from "./userPrivacyResolver";
import { notSpvBackedSql } from "./spvBackedCompanies";

export type CommsRole = "founder" | "investor" | "soft_circler" | "admin" | "co_member";

/**
 * Structurally identical to the private `UserRef` interface in
 * `server/commsStore.ts`, so a durable ref can be substituted at every one of
 * the thirteen `COMMS_USERS[...]` read sites without changing their shape.
 */
export interface DurableCommsUserRef {
  id: string;
  legalName: string;
  email: string;
  visibility: {
    screenName?: string;
    visibleToCoMembers: boolean;
    visibleToCollectiveNetwork: boolean;
  };
  capTables: string[];
  collectiveChapters: string[];
  roles: CommsRole[];
  founderOfCompanyId?: string;
  location?: string;
  capavateAngelNetwork?: boolean;
}

const isValidId = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/** Roles on `company_members` that mean "this user IS the company". */
const FOUNDER_ROLES = ["founder", "co_founder"] as const;

type UserRow = {
  id: string;
  email: string | null;
  name: string | null;
  display_name: string | null;
  role: string | null;
  location: string | null;
};

/** The durable `users` row, or undefined. Soft-deleted users do not exist. */
function userRow(userId: string): UserRow | undefined {
  try {
    const db: any = rawDb();
    return db
      .prepare(
        `SELECT id, email, name, display_name, role, location
           FROM users
          WHERE id = ?
            AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(userId) as UserRow | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Companies the user ACTIVELY founds (`company_members`, founder/co_founder,
 * is_active, not deleted). Ordered by `company_id` so the derived
 * `founderOfCompanyId` and the derived HQ location are deterministic across
 * processes and across a restart.
 */
export function durableFoundedCompanyIds(userId: string): string[] {
  if (!isValidId(userId)) return [];
  try {
    const db: any = rawDb();
    const marks = FOUNDER_ROLES.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT DISTINCT company_id
           FROM company_members
          WHERE user_id = ?
            AND role IN (${marks})
            AND is_active = 1
            AND deleted_at IS NULL
            AND company_id IS NOT NULL
          ORDER BY company_id ASC`,
      )
      .all(userId.trim(), ...FOUNDER_ROLES) as Array<{ company_id?: string | null }>;
    return rows.map((r) => r?.company_id).filter(isValidId).map((s) => s.trim());
  } catch {
    return [];
  }
}

/**
 * Companies whose cap table the user is on. Two durable sources, matching the
 * plain reading of the seed field this replaces (whose values were a founder's
 * own company AND an investor's holdings):
 *   (a) committed positions in the SACRED `captable_commits` ledger (READ only);
 *   (b) companies the user actively founds.
 * NOTE: this is used for shared-context / feed FILTERING, never as an
 * authorisation decision — authorisation still runs through the sacred
 * `areCoMembersOnAnyCapTable`.
 */
export function durableCapTableCompanyIds(userId: string): string[] {
  if (!isValidId(userId)) return [];
  const out = new Set<string>(durableFoundedCompanyIds(userId));
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT company_id
           FROM captable_commits
          WHERE investor_id = ?
            AND state = 'committed'
            AND deleted_at IS NULL`,
      )
      .all(userId.trim()) as Array<{ company_id?: string | null }>;
    for (const r of rows) if (isValidId(r?.company_id)) out.add(r.company_id.trim());
  } catch {
    /* ledger unavailable — contributes nothing (fail closed). */
  }
  return Array.from(out).sort();
}

/**
 * ACTIVE, non-deleted chapter memberships. `status` is
 * `'active' | 'pending' | 'revoked'` (migration 0020) — only `'active'` counts,
 * exactly as `networkPostAudience.ts` row 5 requires on both sides.
 */
export function durableActiveChapterIds(userId: string): string[] {
  if (!isValidId(userId)) return [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT chapter_id
           FROM chapter_memberships
          WHERE user_id = ?
            AND status = 'active'
            AND deleted_at IS NULL`,
      )
      .all(userId.trim()) as Array<{ chapter_id?: string | null }>;
    return rows.map((r) => r?.chapter_id).filter(isValidId).map((s) => s.trim()).sort();
  } catch {
    return [];
  }
}

/** TRUE iff the user has at least one live soft-circle row (any non-declined). */
function hasLiveSoftCircle(userId: string): boolean {
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT 1 AS hit
           FROM soft_circles
          WHERE investor_user_id = ?
            AND status <> 'declined'
            AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(userId.trim()) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    return false;
  }
}

/** `companies.hq` for a company id, or "" when absent/blank. */
export function durableCompanyHq(companyId: string): string {
  if (!isValidId(companyId)) return "";
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT hq FROM companies WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(companyId.trim()) as { hq?: string | null } | undefined;
    const hq = (row?.hq ?? "").trim();
    return hq;
  } catch {
    return "";
  }
}

/** `companies.name` for a company id, or "" when absent/blank. */
export function durableCompanyName(companyId: string): string {
  if (!isValidId(companyId)) return "";
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT name FROM companies WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(companyId.trim()) as { name?: string | null } | undefined;
    return (row?.name ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * D4 — AUTHOR LOCATION, owner decision P2.
 *
 * FOUNDERS show their company HQ, DERIVED from `companies.hq` (never
 * duplicated onto the user — migration 0120's header records that decision).
 * INVESTORS show their optional self-entered `users.location`.
 * Empty is a VALID answer and must render nothing: both render sites
 * (client/src/components/comms/PostsFeed.tsx:622-624 and
 * client/src/pages/PostDetail.tsx:233-235) already guard on
 * `post.authorLocation &&`, so "" renders no chip and no placeholder.
 *
 * A founder whose company has a blank `hq` falls through to their own
 * `users.location` rather than rendering nothing — that is additive (a founder
 * who typed a location still sees it) and never overrides a real HQ.
 */
export function durableAuthorLocation(userId: string): string {
  if (!isValidId(userId)) return "";
  const founded = durableFoundedCompanyIds(userId);
  for (const cid of founded) {
    const hq = durableCompanyHq(cid);
    if (hq) return hq;
  }
  const row = userRow(userId.trim());
  return (row?.location ?? "").trim();
}

/**
 * The durable comms identity for `userId`, or `undefined` when the user has NO
 * durable `users` row. `undefined` is the exact analogue of a `COMMS_USERS`
 * miss, so the "Collective member" vs "Invited contact" label and the
 * `if (!author)` branches keep their existing meaning — now answered from data
 * instead of from an empty object.
 */
export function durableCommsUserRef(userId: string): DurableCommsUserRef | undefined {
  if (!isValidId(userId)) return undefined;
  const uid = userId.trim();
  const row = userRow(uid);
  if (!row) return undefined;

  const founded = durableFoundedCompanyIds(uid);
  const prefs = readUserPrivacy(uid);
  const capTables = durableCapTableCompanyIds(uid);
  const chapters = durableActiveChapterIds(uid);

  const roles: CommsRole[] = [];
  const declaredRole = (row.role ?? "").trim().toLowerCase();
  if (founded.length > 0 || declaredRole === "founder") roles.push("founder");
  if (declaredRole === "investor" || capTables.length > 0) {
    if (!roles.includes("investor")) roles.push("investor");
  }
  if (declaredRole === "admin" && !roles.includes("admin")) roles.push("admin");
  if (capTables.length > 0 && !roles.includes("co_member")) roles.push("co_member");
  if (hasLiveSoftCircle(uid) && !roles.includes("soft_circler")) roles.push("soft_circler");

  /* legalName is the RAW stored name. It is an INTERNAL value: every caller
     that renders it must route it through the sacred privacy resolver first
     (commsStore.resolveIdentity does, and /api/comms/users does as of D3).
     `display_name` wins when set because that is the user's own choice of how
     their name is written. */
  const legalName =
    (row.display_name ?? "").trim() || (row.name ?? "").trim() || uid;

  return {
    id: uid,
    legalName,
    email: (row.email ?? "").trim(),
    visibility: {
      screenName: prefs.screenName || undefined,
      visibleToCoMembers: prefs.visibleToCoMembers,
      visibleToCollectiveNetwork: prefs.visibleInCollectiveDirectory,
    },
    capTables,
    collectiveChapters: chapters,
    roles,
    founderOfCompanyId: founded[0],
    location: durableAuthorLocation(uid),
  };
}

/**
 * TRUE iff the user has a durable `users` row. Used by the two "Collective
 * member" vs "Invited contact" label sites, which previously asked
 * `COMMS_USERS[id] ? …` and therefore always answered "Invited contact" on
 * LIVE — including for fully onboarded members.
 */
export function durableCommsUserExists(userId: string): boolean {
  return durableCommsUserRef(userId) !== undefined;
}

/**
 * Candidate ids for the DM recipient picker, capped. Ordered so the list is
 * stable across processes. Authorisation and privacy resolution happen in the
 * `/api/comms/users` handler — this is only the candidate pool.
 */
export function listDurableCommsUserIds(limit = 500): string[] {
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT id FROM users
          WHERE deleted_at IS NULL
            AND (anonymized_at IS NULL)
          ORDER BY id ASC
          LIMIT ?`,
      )
      .all(limit) as Array<{ id?: string | null }>;
    return rows.map((r) => r?.id).filter(isValidId).map((s) => s.trim());
  } catch {
    return [];
  }
}

/**
 * Users who share at least one ACTIVE chapter with `userId`. Durable analogue
 * of the seed `collectiveChapters` intersection, used to populate the DM picker
 * for a Collective member who has no cap-table relationship yet.
 */
export function durableChapterPeerIds(userId: string): string[] {
  if (!isValidId(userId)) return [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT b.user_id AS user_id
           FROM chapter_memberships a
           JOIN chapter_memberships b ON b.chapter_id = a.chapter_id
          WHERE a.user_id = ?
            AND a.status = 'active'
            AND a.deleted_at IS NULL
            AND b.status = 'active'
            AND b.deleted_at IS NULL
            AND b.user_id <> a.user_id`,
      )
      .all(userId.trim()) as Array<{ user_id?: string | null }>;
    return rows.map((r) => r?.user_id).filter(isValidId).map((s) => s.trim());
  } catch {
    return [];
  }
}

/**
 * Users who are committed holders on at least one cap table `userId` is also a
 * committed holder on. Mirrors the SACRED `areCoMembersOnAnyCapTable` predicate
 * in list form; that function stays the authorisation gate and is unmodified.
 */
export function durableCapTablePeerIds(userId: string): string[] {
  if (!isValidId(userId)) return [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT cb.investor_id AS user_id
           FROM captable_commits ca
           JOIN captable_commits cb ON cb.company_id = ca.company_id
          WHERE ca.investor_id = ?
            AND ca.state = 'committed'
            AND cb.state = 'committed'
            AND ca.deleted_at IS NULL
            AND cb.deleted_at IS NULL
            AND cb.investor_id <> ca.investor_id
            -- X-C1 / P1-8 — SECOND PATH. This mirrors the boolean gate in
            -- capTableMembership.ts, and in LIST form it is the more dangerous
            -- of the two: it enumerates peer user ids rather than answering
            -- yes/no. Same exclusion, same single definition, so the mirror
            -- cannot drift away from the gate it mirrors.
            AND ${notSpvBackedSql("ca")}`,
      )
      .all(userId.trim()) as Array<{ user_id?: string | null }>;
    return rows.map((r) => r?.user_id).filter(isValidId).map((s) => s.trim());
  } catch {
    return [];
  }
}

/**
 * Founders of companies `userId` follows, plus the followers of companies
 * `userId` founds. Both directions of the D1 follow relation, so a follower can
 * DM the founder they chose to follow and a founder can DM their followers.
 */
export function durableFollowPeerIds(userId: string): string[] {
  if (!isValidId(userId)) return [];
  const uid = userId.trim();
  const out = new Set<string>();
  try {
    const db: any = rawDb();
    const marks = FOUNDER_ROLES.map(() => "?").join(",");
    // Founders of the companies this user follows.
    const founders = db
      .prepare(
        `SELECT DISTINCT cm.user_id AS user_id
           FROM company_followers f
           JOIN company_members cm ON cm.company_id = f.company_id
          WHERE f.user_id = ?
            AND f.deleted_at IS NULL
            AND cm.role IN (${marks})
            AND cm.is_active = 1
            AND cm.deleted_at IS NULL`,
      )
      .all(uid, ...FOUNDER_ROLES) as Array<{ user_id?: string | null }>;
    for (const r of founders) if (isValidId(r?.user_id)) out.add(r.user_id.trim());
    // Followers of the companies this user founds.
    const founded = durableFoundedCompanyIds(uid);
    if (founded.length > 0) {
      const cMarks = founded.map(() => "?").join(",");
      const followers = db
        .prepare(
          `SELECT DISTINCT user_id
             FROM company_followers
            WHERE company_id IN (${cMarks})
              AND deleted_at IS NULL`,
        )
        .all(...founded) as Array<{ user_id?: string | null }>;
      for (const r of followers) if (isValidId(r?.user_id)) out.add(r.user_id.trim());
    }
  } catch {
    /* fail closed — contributes no peers. */
  }
  out.delete(uid);
  return Array.from(out);
}
