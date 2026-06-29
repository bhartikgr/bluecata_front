/**
 * v25.46 Track 1 — Messaging Policy (single source of truth for DM permission)
 *
 * Per the v25.46 locked spec, ALL message endpoints route through this helper —
 * no inline permission logic anywhere else. `canDM(senderId, recipientId)`
 * returns the LOCKED permission matrix verdict plus the privacy mode that
 * applies to the resulting conversation.
 *
 * Permission Matrix — LOCKED (v25.46 spec):
 *   Founder ↔ Investor (subscribed)            ✅
 *   Founder ↔ Founder (collective member rule) ✅
 *   Investor ↔ Investor                        ✅ (Mode A — alias unless cap-table-share)
 *   Investor ↔ Founder-of-different-company    ✅ (cold outreach)
 *   Investor ↔ Consortium Partner              ✅
 *   Partner ↔ Partner                          ✅ (co-syndication)
 *   Partner ↔ Founder                          ✅
 *   Partner ↔ Investor                         ✅
 *   Guest / anonymous                          ❌ blocked
 *   Self-DM                                    ❌ blocked
 *
 * privacyMode ∈ 'real' | 'alias' | 'unblocked-by-cap-table':
 *   - 'real'                  : both sides see each other's real (legal) names.
 *                               Applies to founder↔founder, founder↔investor,
 *                               partner conversations (known counterparties).
 *   - 'alias'                 : MAE privacy aliasing applies (Investor↔Investor
 *                               Mode A default, and cold founder↔investor where
 *                               no shared context exists). Display name follows
 *                               the resolver per each side's privacy setting.
 *   - 'unblocked-by-cap-table': Investor↔Investor who BOTH hold a position on
 *                               the same cap table — MAE aliasing is dropped for
 *                               that conversation (both see real names + can
 *                               reference shared cap-table data freely).
 *
 * SACRED COMPLIANCE:
 *   - Cap-table co-membership is derived READ-ONLY from the durable
 *     `captable_commits` ledger via `lib/capTableMembership.ts`
 *     (Sacred Tier 3 #30 — no writes to the cap-table ledger ever).
 *   - Fails CLOSED: any DB error, missing identity, or malformed input →
 *     `{ allowed: false, reason: 'unresolved', privacyMode: 'alias' }`.
 *   - 100% DB-driven role resolution (auth_users.role durable source); no
 *     in-memory-only role state.
 */
import { rawDb } from "./db/connection";
import { areCoMembersOnAnyCapTable } from "./lib/capTableMembership";

export type DmPrivacyMode = "real" | "alias" | "unblocked-by-cap-table";

export interface CanDmResult {
  allowed: boolean;
  reason?: string;
  privacyMode: DmPrivacyMode;
}

/** The platform roles relevant to DM permission resolution. */
export type DmRole = "founder" | "investor" | "partner" | "admin" | "unknown";

const isValidId = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/**
 * Resolve a user's primary role from the DURABLE `auth_users.role` column
 * (the source of truth written by the secure redeem/login paths). Falls back
 * to the legacy `users.role` table, then to consortium-partner membership in
 * `contacts`. Fails CLOSED to 'unknown'.
 *
 * Mirrors the role-resolution precedence used by userContext.getDbUserRole
 * (auth_users first for invite-created investors/partners), but is
 * self-contained so messagingPolicy stays the single source of truth.
 */
export function resolveDmRole(userId: string): DmRole {
  if (!isValidId(userId)) return "unknown";
  const uid = userId.trim();
  try {
    const db: any = rawDb();

    // 1. Durable auth_users.role (covers invite-created investors/partners).
    const authRow = db
      .prepare(`SELECT role FROM auth_users WHERE id = ? OR lower(email) = lower(?) LIMIT 1`)
      .get(uid, uid) as { role?: string } | undefined;
    const authRole = normalizeRole(authRow?.role);
    if (authRole !== "unknown") return authRole;

    // 2. Legacy users.role table.
    try {
      const userRow = db
        .prepare(`SELECT role FROM users WHERE id = ? LIMIT 1`)
        .get(uid) as { role?: string } | undefined;
      const legacyRole = normalizeRole(userRow?.role);
      if (legacyRole !== "unknown") return legacyRole;
    } catch {
      /* users table optional / absent — continue */
    }

    // 3. Consortium-partner membership lives in contacts (kind='consortium_partner').
    try {
      const partnerRow = db
        .prepare(
          `SELECT 1 AS hit FROM contacts
            WHERE (id = ? OR lower(email) = lower(?))
              AND kind = 'consortium_partner'
            LIMIT 1`,
        )
        .get(uid, uid) as { hit?: number } | undefined;
      if (partnerRow?.hit) return "partner";
    } catch {
      /* contacts table optional — continue */
    }

    return "unknown";
  } catch {
    // Fail-closed: unresolved identity → unknown role.
    return "unknown";
  }
}

function normalizeRole(raw: unknown): DmRole {
  if (typeof raw !== "string") return "unknown";
  const r = raw.trim().toLowerCase();
  if (r === "founder") return "founder";
  if (r === "investor") return "investor";
  if (r === "admin") return "admin";
  if (r === "partner" || r === "consortium_partner" || r === "partner_admin") return "partner";
  return "unknown";
}

/**
 * canDM — the LOCKED permission verdict for a DM from `senderId` → `recipientId`.
 *
 * @param senderId    the authenticated sender's user id (must be a valid,
 *                     registered, non-anonymous id).
 * @param recipientId the target user's id.
 * @returns           { allowed, reason?, privacyMode }
 */
export function canDM(
  senderId: string | null | undefined,
  recipientId: string | null | undefined,
): CanDmResult {
  // Guest / anonymous sender or recipient → BLOCK (fail-closed).
  if (!isValidId(senderId) || !isValidId(recipientId)) {
    return { allowed: false, reason: "anonymous", privacyMode: "alias" };
  }

  const sender = (senderId as string).trim();
  const recipient = (recipientId as string).trim();

  // Self-DM → BLOCK.
  if (sender === recipient) {
    return { allowed: false, reason: "self_dm", privacyMode: "alias" };
  }

  const senderRole = resolveDmRole(sender);
  const recipientRole = resolveDmRole(recipient);

  // Either side unresolved → fail-closed (cannot prove an allowed relationship).
  if (senderRole === "unknown" || recipientRole === "unknown") {
    return { allowed: false, reason: "unresolved", privacyMode: "alias" };
  }

  // Admins may always DM (platform operators); treated as a known counterparty.
  if (senderRole === "admin" || recipientRole === "admin") {
    return { allowed: true, privacyMode: "real" };
  }

  // ── Investor ↔ Investor (Mode A) ──────────────────────────────────────────
  // DM is ALWAYS allowed between two registered investors. Privacy mode is
  // 'alias' by default; if BOTH hold a position on the same cap table, MAE
  // aliasing is dropped → 'unblocked-by-cap-table'.
  if (senderRole === "investor" && recipientRole === "investor") {
    const coMembers = areCoMembersOnAnyCapTable(sender, recipient);
    return {
      allowed: true,
      privacyMode: coMembers ? "unblocked-by-cap-table" : "alias",
    };
  }

  // ── Founder ↔ Founder (collective member rule) ────────────────────────────
  if (senderRole === "founder" && recipientRole === "founder") {
    return { allowed: true, privacyMode: "real" };
  }

  // ── Partner pairings (co-syndication / partner↔founder / partner↔investor)──
  // All partner-involving pairs are allowed. Partner↔Investor follows MAE
  // aliasing toward the investor; partner↔founder/partner↔partner use real
  // names (known counterparties).
  if (senderRole === "partner" || recipientRole === "partner") {
    const involvesInvestor = senderRole === "investor" || recipientRole === "investor";
    return { allowed: true, privacyMode: involvesInvestor ? "alias" : "real" };
  }

  // ── Founder ↔ Investor (both directions) ──────────────────────────────────
  // Founder↔Investor (subscribed) and Investor↔Founder-of-different-company
  // (cold outreach) are both allowed. The resolver applies MAE aliasing toward
  // the investor; if they share a cap table the resolver self-promotes to real
  // names, so we report 'alias' here and let the resolver decide display.
  if (
    (senderRole === "founder" && recipientRole === "investor") ||
    (senderRole === "investor" && recipientRole === "founder")
  ) {
    return { allowed: true, privacyMode: "alias" };
  }

  // Any pairing not explicitly allowed above → fail-closed.
  return { allowed: false, reason: "not_permitted", privacyMode: "alias" };
}

export default canDM;
