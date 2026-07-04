/**
 * server/lib/teamInviteRedeem.ts — v25.48.3 (Q-J1)
 *
 * Unifies TEAM invitations onto the working `/auth/redeem?token=…` flow (the
 * same ingress round/investor invitations already use), and tags the redeeming
 * user as a team MEMBER of the company they were invited to.
 *
 * ---------------------------------------------------------------------------
 * WHY A PARALLEL MODULE
 * ---------------------------------------------------------------------------
 * The canonical redeem endpoints live in `server/lib/authRoutes.ts`, which is
 * SACRED-ADJACENT (must be edited only at the route/parallel layer). Rather
 * than touch it, this module registers its OWN `/api/auth/redeem/preview` and
 * `/api/auth/redeem` handlers and is mounted BEFORE `registerAuthShellRoutes`.
 * Express dispatches in registration order, so:
 *   - a TEAM token is recognised here and fully handled, then returns; while
 *   - any NON-team token falls through via `next()` to the existing sacred-
 *     adjacent investor/round redeem handler, byte-for-byte unchanged.
 *
 * The team-invite rows are created by `server/lib/founderTeamStore.ts` (also
 * non-sacred). Tokens are stored as a SHA-256 hash (`token_hash`); the raw
 * token travels only in the emailed URL. We therefore hash the incoming raw
 * token and match on the hash — never storing or logging the raw token.
 *
 * "Tag as team member" (Ozan Q-J1): on a successful team redeem we insert a
 * row into `founder_team_members` (idempotent on the store's
 * uq_ftm_company_user index) and flip the invitation to status='accepted'.
 * Cap-table math and all sacred stores are untouched.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { createHash, randomBytes } from "node:crypto";
import { rawDb } from "../db/connection";
import { log } from "./logger";
import { registerFounderUser, getUserContextForId } from "./userContext";
import { setSessionCookie } from "./sessionCookie";
import {
  getCompanyNameById,
  writeCompanyMembershipRowRaw,
  mirrorExistingCompanyMembershipToCache,
} from "../multiCompanyStore";

/** SHA-256 hex of a raw token — must match founderTeamStore's tokenHash. */
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

interface TeamInvitationRow {
  id: string;
  company_id: string;
  invited_by_user_id: string;
  invited_email: string;
  invited_name: string | null;
  role: string;
  status: string;
  token_hash: string;
  expires_at: string | null;
  created_at: string;
  accepted_at: string | null;
  deleted_at: string | null;
}

/** Result of a team-token lookup, distinguishing the three cases so the caller
 * can fail-CLOSED on a real DB error (GPT-5.5 blocker #3) rather than silently
 * falling through to the investor redeem path (which would mask an outage). */
type TeamLookup =
  | { kind: "found"; row: TeamInvitationRow }
  | { kind: "not_team" }        // token is genuinely not a team token → next()
  | { kind: "error"; message: string }; // real DB/schema error → 5xx, do NOT next()

/** Whether the founder_team_invitations table exists yet (fresh-DB bootstrap).
 * Used to treat a truly-absent table as "not a team token" (next()) WITHOUT
 * masking a real query error on an existing table. */
function teamInvitesTableExists(db: any): boolean {
  try {
    const r = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='founder_team_invitations' LIMIT 1`)
      .get() as { name?: string } | undefined;
    return !!r?.name;
  } catch {
    return false;
  }
}

/** Look up a team invitation by RAW token (hash-matched). */
function lookupTeamInvitationByRawToken(rawToken: string): TeamLookup {
  if (!rawToken) return { kind: "not_team" };
  const db: any = rawDb();
  // Absent table on a brand-new DB → genuinely not a team token (bootstrap).
  if (!teamInvitesTableExists(db)) return { kind: "not_team" };
  try {
    const row = db
      .prepare(
        `SELECT * FROM founder_team_invitations
           WHERE token_hash = ? AND deleted_at IS NULL
           LIMIT 1`,
      )
      .get(hashToken(rawToken)) as TeamInvitationRow | undefined;
    return row ? { kind: "found", row } : { kind: "not_team" };
  } catch (err) {
    // The table EXISTS but the query failed → real error. Fail closed.
    log.error("[teamInviteRedeem.lookup] query failed on existing table:", (err as Error).message);
    return { kind: "error", message: (err as Error).message };
  }
}

type TeamPreviewReason = "expired" | "already_redeemed" | "revoked";

/** Evaluate a team invitation's redeemability. */
function evaluateTeamInvitation(
  row: TeamInvitationRow,
): { ok: true } | { ok: false; reason: TeamPreviewReason } {
  if (row.status === "accepted" || row.accepted_at) return { ok: false, reason: "already_redeemed" };
  if (row.status === "revoked") return { ok: false, reason: "revoked" };
  if (row.expires_at && Date.now() > new Date(row.expires_at).getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

function teamPreviewPayload(row: TeamInvitationRow) {
  const companyName = getCompanyNameById(row.company_id) ?? "your company";
  return {
    kind: "team" as const,
    companyId: row.company_id,
    companyName,
    inviteeEmail: row.invited_email,
    inviteeName: row.invited_name ?? "",
    role: row.role,
    expiresAt: row.expires_at ?? "",
  };
}

/**
 * Register the team-aware redeem interceptors. MUST be called BEFORE
 * `registerAuthShellRoutes(app, …)` so team tokens are handled first and all
 * other tokens fall through unchanged.
 */
export function registerTeamInviteRedeemRoutes(app: Express): void {
  // ---------- GET /api/auth/redeem/preview (team-aware interceptor) ----------
  app.get("/api/auth/redeem/preview", (req: Request, res: Response, next: NextFunction) => {
    const token = String(req.query.token ?? "");
    const lk = lookupTeamInvitationByRawToken(token);
    if (lk.kind === "error") {
      // GPT-5.5 #3 — real lookup failure fails CLOSED (never next()).
      return res.status(503).json({ ok: false, error: "TEAM_INVITE_LOOKUP_FAILED" });
    }
    if (lk.kind === "not_team") return next(); // fall through to investor preview

    const evald = evaluateTeamInvitation(lk.row);
    if (!evald.ok) {
      const httpCode = evald.reason === "expired" ? 410 : evald.reason === "already_redeemed" ? 409 : 404;
      return res.status(httpCode).json({ ok: false, error: evald.reason });
    }
    // Shape mirrors the investor preview envelope ({ ok, invitation }) plus a
    // `kind:"team"` discriminator the client can branch on.
    return res.json({ ok: true, invitation: teamPreviewPayload(lk.row) });
  });

  // ---------- POST /api/auth/redeem (team-aware interceptor) ----------
  app.post("/api/auth/redeem", (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body ?? {}) as { token?: string; password?: string; agreedToTerms?: boolean };
    const token = String(body.token ?? "");
    const lk = lookupTeamInvitationByRawToken(token);
    if (lk.kind === "error") {
      // GPT-5.5 #3 — real lookup failure fails CLOSED (never next()).
      return res.status(503).json({ ok: false, error: "TEAM_INVITE_LOOKUP_FAILED" });
    }
    if (lk.kind === "not_team") return next(); // fall through to investor redeem
    const row = lk.row;

    if (!body.password || body.password.length < 8)
      return res.status(400).json({ ok: false, error: "WEAK_PASSWORD", message: "Choose a password of at least 8 characters." });
    if (!body.agreedToTerms)
      return res.status(400).json({ ok: false, error: "TERMS_NOT_ACCEPTED" });

    const evald = evaluateTeamInvitation(row);
    if (!evald.ok) {
      const httpCode = evald.reason === "expired" ? 410 : evald.reason === "already_redeemed" ? 409 : 404;
      return res.status(httpCode).json({ ok: false, error: evald.reason });
    }

    const email = row.invited_email.trim().toLowerCase();
    const name = row.invited_name ?? email.split("@")[0];
    const teamRole = (["owner", "admin", "member", "viewer"].includes(row.role) ? row.role : "member") as "owner" | "admin" | "member" | "viewer";

    // GPT-5.5 #1 / Opus #1 — register the invitee as a FOUNDER-capable persona
    // (NOT an investor). registerFounderUser (userContext, SACRED export — we
    // CALL it) durably persists persona + users.role='founder' + auth_users +
    // bcrypt credential. Without this the team member would be misclassified as
    // an investor and land on an empty founder workspace.
    let personaId: string;
    try {
      personaId = registerFounderUser({ email, name, password: body.password }).userId;
    } catch (err) {
      log.error("[teamInviteRedeem] registerFounderUser failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "PERSONA_FAILED" });
    }

    // GPT-5.5 r3 — FULLY ATOMIC REDEEM (single transaction).
    //
    // Round 2 fixed "invite accepted but no company access". Round-2's fix
    // (grant access first, then claim) introduced the INVERSE race: a concurrent
    // revoke/delete/expire could fail the guarded claim AFTER company access had
    // already been granted, leaving an orphaned company_members row (and a
    // login-capable founder account) for an invite that was never accepted.
    //
    // The definitive fix: claim the invite, tag founder_team_members, AND write
    // the durable company_members grant (with post-write verification) as ONE raw
    // better-sqlite3 transaction. If ANY step fails — guarded UPDATE matches 0
    // rows (concurrent revoke/accept/expire), tag insert throws, or the
    // membership verify fails — the entire transaction ROLLS BACK and no durable
    // effect survives. There is therefore no window where the invite is consumed
    // without access, and none where access exists without an accepted invite.
    //
    // NOTE on the persona: registerFounderUser (above) writes auth credentials
    // outside this tx. That is acceptable and intentional — an unclaimed invite
    // leaves NO company access and NO team tag, so the account is an inert,
    // company-less founder shell (same as any fresh signup that abandoned
    // onboarding). It grants zero access to the inviting company's data.
    // Read the target company row up front (must exist) so the atomic tx has the
    // tenant/name it needs and we can fail-closed (404) before consuming anything.
    const rdb: any = rawDb();
    const coRow = rdb
      .prepare(`SELECT id, tenant_id, name, legal_name FROM companies WHERE id = ? AND deleted_at IS NULL`)
      .get(row.company_id) as { id?: string; tenant_id?: string; name?: string; legal_name?: string } | undefined;
    if (!coRow?.id) {
      log.error("[teamInviteRedeem] invited company not found:", row.company_id);
      return res.status(404).json({ ok: false, error: "COMPANY_NOT_FOUND" });
    }
    // First-company iff the user has no live company_members row yet (drives the
    // user_prefs active-tenant default). Read-only; the write happens in the tx.
    const existingMembership = rdb
      .prepare(
        `SELECT 1 FROM company_members
           WHERE user_id = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1`,
      )
      .get(personaId) as unknown;
    const isFirstCompany = !existingMembership;

    const now = new Date().toISOString();
    const memberId = `ftm_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const tenantId = coRow.tenant_id ?? `tenant_co_${row.company_id}`;
    const dbRole =
      teamRole === "owner" ? "co_founder"
      : teamRole === "admin" ? "admin"
      : teamRole === "viewer" ? "viewer"
      : "editor"; // "member" → editor
    // FounderCompanyMembership role vocabulary for the cache mirror (post-commit).
    const cacheRole =
      teamRole === "owner" ? "co-founder"
      : teamRole === "admin" ? "admin"
      : teamRole === "viewer" ? "viewer"
      : "editor";

    let claimed = false;
    try {
      const db: any = rawDb();
      claimed = db.transaction(() => {
        // (a) Guarded claim: pending → accepted, exactly one row.
        const upd = db
          .prepare(
            `UPDATE founder_team_invitations
               SET status = 'accepted', accepted_at = ?
             WHERE id = ?
               AND status = 'pending'
               AND accepted_at IS NULL
               AND deleted_at IS NULL
               AND (expires_at IS NULL OR expires_at > ?)`,
          )
          .run(now, row.id, now);
        if (!upd || upd.changes !== 1) {
          // Concurrent claim/revoke/expire between preview and now → roll back
          // (nothing written yet) and surface 409. No access is granted.
          return false;
        }
        // (b) Tag as team member (idempotent on uq_ftm_company_user).
        db.prepare(
          `INSERT INTO founder_team_members (id, company_id, user_id, email, role, joined_at)
             VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(company_id, user_id) DO UPDATE SET
             removed_at = NULL, role = excluded.role, email = excluded.email`,
        ).run(memberId, row.company_id, personaId, email, teamRole, now);
        // (c) Durable company_members grant + post-write verify on the SAME
        // connection/tx. Throws (rolls back a, b, c) if verification fails.
        writeCompanyMembershipRowRaw(db, {
          userId: personaId,
          companyId: row.company_id,
          tenantId,
          dbRole,
          now,
          isFirstCompany,
        });
        return true;
      })();
    } catch (err) {
      log.error("[teamInviteRedeem] atomic redeem failed:", (err as Error).message);
      // Whole tx rolled back — invite still pending, no tag, no access. Retry-safe.
      return res.status(500).json({ ok: false, error: "REDEEM_PERSIST_FAILED" });
    }
    if (!claimed) {
      return res.status(409).json({ ok: false, error: "already_redeemed" });
    }

    // Mirror the now-committed membership into the in-memory read cache so the
    // fresh session resolves founder.companies immediately (post-commit only).
    mirrorExistingCompanyMembershipToCache({
      userId: personaId,
      companyId: row.company_id,
      companyName: coRow.name ?? getCompanyNameById(row.company_id) ?? "your company",
      legalName: coRow.legal_name ?? coRow.name ?? "your company",
      role: cacheRole,
      now,
      isFirstCompany,
    });

    // Session ONLY after all durable writes committed.
    setSessionCookie(res, personaId);
    const ctx = getUserContextForId(personaId);
    return res.json({
      ok: true,
      kind: "team",
      invitationId: row.id,
      companyId: row.company_id,
      role: teamRole,
      redirectTo: "/founder/dashboard",
      ctx,
    });
  });
}
