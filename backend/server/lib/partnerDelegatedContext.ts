// server/lib/partnerDelegatedContext.ts
//
// WAVE 33 · CP-MSG-01 — "on whose behalf is this partner writing?"
//
// A Consortium Partner team member who is running a managed-founder engagement
// writes into comms as THEMSELVES. Nothing on the record says which client
// company they were acting for, or which engagement authorised it. On a
// partner-mediated deal that is the single most load-bearing fact about the
// message, and it was absent.
//
// This module resolves that context from durable rows only, and stamps it onto
// the channel or message at the moment of the write — never recomputed at read
// time. An engagement that lapses tomorrow must not silently rewrite what a
// message said today; the stamp is a historical fact and the unique index in
// 0181 enforces one stamp per (scope, ref).
//
// FAIL CLOSED, ALWAYS. A missing table, a blank id, a lapsed engagement, a
// removed team member: every one of them yields `null`, i.e. an ordinary
// personal message with no delegation claim attached. Asserting delegated
// authority that cannot be proven from the ledger is far worse than asserting
// none.
//
// ZERO caching: every call re-reads SQLite.
import { randomBytes } from "node:crypto";
import { rawDb } from "../db/connection";
import { applyCommsDelegatedContextSchema } from "./applyCommsDelegatedContextSchema";

const isValidId = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/** Engagement statuses that grant a partner live authority for a company. */
export const LIVE_ENGAGEMENT_STATUSES = ["ACTIVE"] as const;

export interface DelegatedEngagement {
  engagementId: string;
  companyId: string;
  companyName: string | null;
}

export interface PartnerDelegatedContext {
  partnerId: string;
  /** Null when the partner organisation row does not exist — never invented. */
  partnerName: string | null;
  actingUserId: string;
  engagements: DelegatedEngagement[];
}

/** The partner organisation an ACTIVE team member belongs to, or null. */
export function resolvePartnerIdForUser(userId: string): string | null {
  if (!isValidId(userId)) return null;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT partner_id FROM partner_team_members
          WHERE user_id = ? AND status = 'active' AND removed_at IS NULL
          ORDER BY joined_at ASC LIMIT 1`,
      )
      .get(userId.trim()) as { partner_id?: string } | undefined;
    return isValidId(row?.partner_id) ? String(row?.partner_id).trim() : null;
  } catch {
    return null;
  }
}

/**
 * The partner organisation's registered name, or NULL.
 *
 * `partner_organizations` is empty on every database inspected during this wave
 * (see OQ-33-3, item 4) — no server path writes it. So this returns null far
 * more often than it returns a name, and every caller must render a stated
 * fallback rather than a blank or an invented org name.
 */
export function resolvePartnerName(partnerId: string): string | null {
  if (!isValidId(partnerId)) return null;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT name FROM partner_organizations WHERE id = ? LIMIT 1`)
      .get(partnerId.trim()) as { name?: string } | undefined;
    const name = (row?.name ?? "").trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

function companyName(companyId: string): string | null {
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT name FROM companies WHERE id = ? LIMIT 1`)
      .get(companyId) as { name?: string } | undefined;
    const n = (row?.name ?? "").trim();
    return n.length > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Every company this partner currently holds live delegated authority for.
 *
 * A row counts only when status is ACTIVE **and** the founder has not revoked
 * it **and** it is not archived. Those last two are separate columns, and
 * checking status alone would keep a founder-revoked engagement alive — the
 * exact fail-open a delegation claim must not have.
 */
export function liveEngagementsForPartner(partnerId: string): DelegatedEngagement[] {
  if (!isValidId(partnerId)) return [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT id, company_id FROM mf_engagement
          WHERE partner_id = ?
            AND status = 'ACTIVE'
            AND founder_revoked_at IS NULL
            AND archived_at IS NULL
          ORDER BY created_at ASC`,
      )
      .all(partnerId.trim()) as Array<{ id?: string; company_id?: string }>;
    return rows
      .filter((r) => isValidId(r?.id) && isValidId(r?.company_id))
      .map((r) => ({
        engagementId: String(r.id).trim(),
        companyId: String(r.company_id).trim(),
        companyName: companyName(String(r.company_id).trim()),
      }));
  } catch {
    return [];
  }
}

/** The full delegated context for a user, or null when they are not a partner. */
export function resolveDelegatedContext(userId: string): PartnerDelegatedContext | null {
  const partnerId = resolvePartnerIdForUser(userId);
  if (!partnerId) return null;
  return {
    partnerId,
    partnerName: resolvePartnerName(partnerId),
    actingUserId: userId.trim(),
    engagements: liveEngagementsForPartner(partnerId),
  };
}

/** The single engagement authorising this partner to act for `companyId`, or null. */
export function engagementFor(userId: string, companyId: string): DelegatedEngagement | null {
  if (!isValidId(companyId)) return null;
  const ctx = resolveDelegatedContext(userId);
  if (!ctx) return null;
  return ctx.engagements.find((e) => e.companyId === companyId.trim()) ?? null;
}

/* ============================================================
 *  Audience candidates — evaluated ONLY when the owner has
 *  enabled the corresponding rule (see commsAudienceRules.ts).
 * ============================================================ */

/** Active members of every company this partner holds a live engagement for. */
export function delegatedCompanyPeopleIds(userId: string): string[] {
  const ctx = resolveDelegatedContext(userId);
  if (!ctx || ctx.engagements.length === 0) return [];
  const out = new Set<string>();
  try {
    const db: any = rawDb();
    for (const e of ctx.engagements) {
      const rows = db
        .prepare(
          `SELECT user_id FROM company_members
            WHERE company_id = ? AND is_active = 1`,
        )
        .all(e.companyId) as Array<{ user_id?: string }>;
      for (const r of rows) if (isValidId(r?.user_id)) out.add(String(r.user_id).trim());
    }
  } catch {
    return [];
  }
  out.delete(userId.trim());
  return Array.from(out.values());
}

/** The other ACTIVE members of the viewer's own partner organisation. */
export function partnerTeamPeerIds(userId: string): string[] {
  const partnerId = resolvePartnerIdForUser(userId);
  if (!partnerId) return [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT user_id FROM partner_team_members
          WHERE partner_id = ? AND status = 'active' AND removed_at IS NULL
            AND user_id <> ?`,
      )
      .all(partnerId, userId.trim()) as Array<{ user_id?: string }>;
    return Array.from(
      new Set(rows.map((r) => r?.user_id).filter(isValidId).map((s) => s.trim())).values(),
    );
  } catch {
    return [];
  }
}

/* ============================================================
 *  The stamp
 * ============================================================ */

export interface DelegatedStamp {
  scope: "channel" | "message";
  refId: string;
  actingUserId: string;
  partnerId: string;
  partnerName: string | null;
  companyId: string;
  companyName: string | null;
  engagementId: string;
  createdAt: string;
}

/**
 * Record that `userId` wrote `refId` on behalf of `companyId`.
 *
 * Returns the stamp, or null when the authority cannot be proven — in which
 * case NOTHING is written. `INSERT OR IGNORE` on the unique (scope, ref) index
 * makes a re-send idempotent and keeps the FIRST stamp, which is the one that
 * was true when the message was sent.
 */
export function stampDelegatedContext(
  scope: "channel" | "message",
  refId: string,
  userId: string,
  companyId: string,
): DelegatedStamp | null {
  if (!isValidId(refId) || !isValidId(userId) || !isValidId(companyId)) return null;
  const partnerId = resolvePartnerIdForUser(userId);
  if (!partnerId) return null;
  const engagement = engagementFor(userId, companyId);
  if (!engagement) return null;
  try {
    const db: any = rawDb();
    applyCommsDelegatedContextSchema(db);
    db.prepare(
      `INSERT OR IGNORE INTO comms_delegated_context
         (id, scope, ref_id, acting_user_id, partner_id, company_id, engagement_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      `dctx_${randomBytes(8).toString("hex")}`,
      scope,
      refId.trim(),
      userId.trim(),
      partnerId,
      engagement.companyId,
      engagement.engagementId,
    );
    return readDelegatedContext(scope, refId);
  } catch {
    return null;
  }
}

/** The stamp on a channel or message, or null. Never throws. */
export function readDelegatedContext(
  scope: "channel" | "message",
  refId: string,
): DelegatedStamp | null {
  if (!isValidId(refId)) return null;
  try {
    const db: any = rawDb();
    applyCommsDelegatedContextSchema(db);
    const row = db
      .prepare(
        `SELECT scope, ref_id, acting_user_id, partner_id, company_id, engagement_id, created_at
           FROM comms_delegated_context
          WHERE scope = ? AND ref_id = ? LIMIT 1`,
      )
      .get(scope, refId.trim()) as Record<string, string> | undefined;
    if (!row?.ref_id) return null;
    return {
      scope: row.scope === "channel" ? "channel" : "message",
      refId: row.ref_id,
      actingUserId: row.acting_user_id,
      partnerId: row.partner_id,
      partnerName: resolvePartnerName(row.partner_id),
      companyId: row.company_id,
      companyName: companyName(row.company_id),
      engagementId: row.engagement_id,
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}
