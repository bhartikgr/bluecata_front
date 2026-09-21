/**
 * slide13b A1. Durable owner-invitation recovery, not an identity resolver.
 * Raw tokens exist only in the creation/reissue call and outbound email.
 * SQLite transaction + guarded expected ID serializes replacement against claim.
 */
import { createHash, randomBytes } from "node:crypto";
import { getDb, rawDb } from "../db/connection";
import { eq } from "drizzle-orm";
import { companies } from "../../shared/schema";
import { crossTenant } from "./withTenant";
import { appendAdminAudit, getAuditLog, isAuditWriteFailure } from "../adminPlatformStore";
import { getConfig, sendMail } from "../emailTransport";
import type { Wave214AuthorityEnvelope } from "./wave214ThirdPartyAuthorityStore";
import { readCompanyOnboardingState } from "./companyOnboardingState";
import { hasFounderInvitationAuthority } from "./founderInviteAuthority";

export type InvitationHandoff = {
  mode: "smtp" | "console" | "dry_run" | "unknown";
  result: "accepted" | "simulated" | "failed" | "unknown";
  error?: "MAIL_HANDOFF_FAILED" | "RATE_LIMITED" | "INVALID_APP_ORIGIN";
  statusRecorded?: boolean;
};
export interface SafeFounderInvitation {
  id: string; email: string; name: string | null; status: string;
  expiresAt: string | null; sentAt: string | null; acceptedAt: string | null;
  handoff: InvitationHandoff;
}
export class FounderInvitationError extends Error {
  constructor(public code: string, public httpStatus = 409) { super(code); }
}
type InviteRow = {
  id: string; company_id: string; invited_email: string; invited_name: string | null;
  status: string; expires_at: string | null; sent_at: string | null;
  accepted_at: string | null; deleted_at: string | null;
};
const SAFE_COLUMNS = `id, company_id, invited_email, invited_name, status,
  expires_at, sent_at, accepted_at, deleted_at`;

export function founderClaimUrl(token: string): string {
  // Configuration only: never Host, Origin, forwarded headers or request body.
  let url: URL;
  try { url = new URL(process.env.APP_URL ?? process.env.INVITATION_BASE_URL ?? "https://capavate.com"); }
  catch { throw new FounderInvitationError("INVALID_APP_ORIGIN", 503); }
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new FounderInvitationError("INVALID_APP_ORIGIN", 503);
  }
  return `${url.origin}/auth/redeem?token=${encodeURIComponent(token)}`;
}
function invitationCompany(companyId: string): { name: string; tenantId: string } {
  // CROSS-TENANT (company resolver) — the route has established the partner
  // relationship. Resolve globally unique company ID to its durable tenant;
  // never guess a tenant prefix or use the acting partner's tenant.
  const company = getDb().select({ name: companies.name, tenantId: companies.tenantId })
    .from(companies).where(crossTenant(eq(companies.id, companyId), companies)).limit(1).all()[0];
  if (!company) throw new FounderInvitationError("PORTFOLIO_COMPANY_NOT_FOUND", 404);
  return company;
}
function persistedHandoff(invitationId: string, tenantId: string): InvitationHandoff {
  const row = rawDb().prepare(`SELECT payload_json FROM audit_log
    WHERE tenant_id = ? AND target = ? AND action = 'founder_invitation.handoff'
    ORDER BY created_at DESC, id DESC LIMIT 1`).get(tenantId, `founder_invitation:${invitationId}`) as { payload_json: string } | undefined;
  if (!row) return { mode: "unknown", result: "unknown" };
  const p = JSON.parse(row.payload_json);
  // Strict allowlist; never spread arbitrary audit JSON into a read response.
  const mode = ["smtp", "console", "dry_run"].includes(p.mode) ? p.mode : "unknown";
  const result = ["accepted", "simulated", "failed"].includes(p.result) ? p.result : "unknown";
  const error = ["MAIL_HANDOFF_FAILED", "RATE_LIMITED", "INVALID_APP_ORIGIN"].includes(p.error) ? p.error : undefined;
  return { mode, result, ...(error ? { error } : {}) };
}
function safeInvite(row: InviteRow, tenantId: string): SafeFounderInvitation {
  return { id: row.id, email: row.invited_email, name: row.invited_name,
    status: row.status, expiresAt: row.expires_at, sentAt: row.sent_at,
    acceptedAt: row.accepted_at, handoff: persistedHandoff(row.id, tenantId) };
}
export function readFounderInvitationStatus(companyId: string) {
  const db = rawDb();
  const company = invitationCompany(companyId);
  const onboarding = readCompanyOnboardingState(companyId);
  const row = db.prepare(`SELECT ${SAFE_COLUMNS} FROM founder_team_invitations
    WHERE company_id = ? AND role = 'owner' AND deleted_at IS NULL
    ORDER BY CASE WHEN status = 'pending' THEN 0 WHEN status = 'accepted' THEN 1 ELSE 2 END,
    created_at DESC, id DESC LIMIT 1`).get(companyId) as InviteRow | undefined;
  return { companyId, companyName: company.name, invitation: row ? safeInvite(row, company.tenantId) : null,
    registrationState: onboarding.state,
    canReissue: onboarding.state === "pending" && !!row && row.status === "pending" && !row.accepted_at };
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]!));

/** Commit has already occurred. SMTP failure must never undo the company/invite. */
export async function dispatchFounderInvitation(args: {
  invitationId: string; companyId: string; token: string; actorId: string;
}): Promise<SafeFounderInvitation & { claimUrl: string | null }> {
  const db = rawDb();
  const row = db.prepare(`SELECT ${SAFE_COLUMNS} FROM founder_team_invitations
    WHERE id = ? AND company_id = ? AND role = 'owner'`).get(args.invitationId, args.companyId) as InviteRow;
  if (!row) throw new FounderInvitationError("INVITATION_NOT_FOUND", 404);
  const company = invitationCompany(args.companyId);
  let claimUrl: string | null = null;
  let handoff: InvitationHandoff = { mode: "unknown", result: "failed", error: "MAIL_HANDOFF_FAILED" };
  try {
    // Only mode leaves this accessor; never log/serialize the credential object.
    const configuredMode = getConfig().mode;
    const mode = configuredMode === "smtp" || configuredMode === "console" || configuredMode === "dry_run"
      ? configuredMode : "unknown";
    handoff.mode = mode;
    claimUrl = founderClaimUrl(args.token);
    if (row.status !== "pending" || row.accepted_at || row.deleted_at) {
      return { ...safeInvite(row, company.tenantId), claimUrl: null };
    }
    const name = row.invited_name || "Founder";
    const result = await sendMail({
      to: row.invited_email,
      subject: "Claim your company on Capavate",
      html: `<p>Hello ${escapeHtml(name)},</p><p>You have been invited to claim ${escapeHtml(company.name)} on Capavate.</p><p><a href="${escapeHtml(claimUrl)}">Review and accept your company invitation</a></p><p>This invitation is for ${escapeHtml(row.invited_email)}. Sign in to that account if you already use Capavate.</p>`,
      text: `Hello ${name},\nYou have been invited to claim ${company.name} on Capavate.\nReview and accept: ${claimUrl}\nThis invitation is for ${row.invited_email}.`,
      idempotencyKey: `portfolio-founder:${row.id}`,
    });
    const effectiveMode = result.messageId?.startsWith("dry_") ? "dry_run"
      : result.messageId?.startsWith("console_") ? "console" : mode;
    handoff = { mode: effectiveMode, result: result.ok ? (effectiveMode === "smtp" ? "accepted"
      : effectiveMode === "unknown" ? "unknown" : "simulated") : "failed",
      ...(!result.ok ? { error: result.error === "rate_limited" ? "RATE_LIMITED" as const : "MAIL_HANDOFF_FAILED" as const } : {}) };
  } catch (error) {
    // Transport error strings may contain credentials/addresses. No raw errors.
    if (error instanceof FounderInvitationError && error.code === "INVALID_APP_ORIGIN") handoff.error = "INVALID_APP_ORIGIN";
  }
  // Result evidence is independent of the old admin outbox. No tokens/message IDs.
  // An outage here must not turn an accepted send into a generic create failure.
  let statusRecorded = false;
  try {
    if (handoff.result === "accepted" || handoff.result === "simulated") {
      const at = new Date().toISOString();
      db.prepare("UPDATE founder_team_invitations SET sent_at = ? WHERE id = ?").run(at, row.id);
      row.sent_at = at;
    }
    statusRecorded = !isAuditWriteFailure(appendAdminAudit(args.actorId, `founder_invitation:${row.id}`,
      "founder_invitation.handoff", { companyId: args.companyId, invitationId: row.id,
        email: row.invited_email, ...handoff }, company.tenantId));
  } catch { /* Report uncertain durable status, never undo invitation. */ }
  return { id: row.id, email: row.invited_email, name: row.invited_name, status: row.status,
    expiresAt: row.expires_at, acceptedAt: row.accepted_at, sentAt: row.sent_at,
    handoff: { ...handoff, statusRecorded }, claimUrl };
}

export function reissueFounderInvitation(args: {
  companyId: string; partnerId: string; actorId: string; expectedInvitationId: string;
  founderEmail: string; founderName: string; authority: Wave214AuthorityEnvelope;
}): { invitationId: string; token: string } {
  const db = rawDb();
  const token = randomBytes(32).toString("hex");
  const id = `fti_${Date.now()}_${randomBytes(8).toString("hex")}`;
  let auditId: string | undefined;
  try {
    db.transaction(() => {
      // Recheck the stronger resource authority under the same write lock.
      // A CRM relationship alone must never grant ownership-token control.
      if (!hasFounderInvitationAuthority(args.partnerId, args.companyId)) {
        throw new FounderInvitationError("PORTFOLIO_COMPANY_NOT_FOUND", 404);
      }
      const tenantId = invitationCompany(args.companyId).tenantId;
      // Recovery is for unclaimed companies, not an ownership-transfer API.
      // Reuse BC's durable read model so a legitimate legacy owner cannot be
      // reassigned merely because an additional pending owner row exists.
      const onboarding = readCompanyOnboardingState(args.companyId);
      if (onboarding.state === "registered") throw new FounderInvitationError("COMPANY_ALREADY_CLAIMED");
      if (onboarding.state !== "pending") throw new FounderInvitationError("INVITATION_STATUS_UNAVAILABLE", 503);
      const old = db.prepare(`SELECT ${SAFE_COLUMNS} FROM founder_team_invitations
        WHERE id = ? AND company_id = ? AND role = 'owner'`).get(args.expectedInvitationId, args.companyId) as InviteRow | undefined;
      if (!old || old.status !== "pending" || old.accepted_at || old.deleted_at) {
        throw new FounderInvitationError("INVITATION_NOT_PENDING");
      }
      const current = db.prepare(`SELECT id FROM founder_team_invitations
        WHERE company_id = ? AND role = 'owner' AND status = 'pending'
        AND accepted_at IS NULL AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC LIMIT 1`).get(args.companyId) as { id: string } | undefined;
      if (current?.id !== old.id) throw new FounderInvitationError("INVITATION_CHANGED");
      // Another accepted owner means company already claimed, even if an old
      // unrelated pending owner row remains. No recovery may reassign it.
      if (db.prepare(`SELECT 1 FROM founder_team_invitations WHERE company_id = ?
        AND role = 'owner' AND (status = 'accepted' OR accepted_at IS NOT NULL) AND deleted_at IS NULL`).get(args.companyId)) {
        throw new FounderInvitationError("COMPANY_ALREADY_CLAIMED");
      }
      const revoked = db.prepare(`UPDATE founder_team_invitations SET status = 'revoked'
        WHERE id = ? AND company_id = ? AND role = 'owner' AND status = 'pending'
        AND accepted_at IS NULL AND deleted_at IS NULL`).run(old.id, args.companyId);
      if (revoked.changes !== 1) throw new FounderInvitationError("INVITATION_CHANGED");
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO founder_team_invitations
        (id, company_id, invited_by_user_id, invited_email, invited_name, role,
         status, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'owner', 'pending', ?, ?, ?)`).run(
          id, args.companyId, args.actorId, args.founderEmail, args.founderName || null,
          createHash("sha256").update(token).digest("hex"),
          new Date(Date.now() + 14 * 86400000).toISOString(), now);
      // LAST operation in transaction. Same SQLite handle/savepoint as Drizzle.
      // No original row/email/audit rewrite. Empty hash is a hard refusal here.
      const audit = appendAdminAudit(args.actorId, `company:${args.companyId}`, "founder_invitation.reissued", {
        companyId: args.companyId, partnerId: args.partnerId,
        oldInvitationId: old.id, newInvitationId: id,
        oldEmail: old.invited_email, newEmail: args.founderEmail,
        oldName: old.invited_name, newName: args.founderName || null,
        authority: args.authority,
      }, tenantId);
      auditId = audit.id;
      if (isAuditWriteFailure(audit)) throw new FounderInvitationError("INVITATION_AUDIT_UNAVAILABLE", 503);
    }).immediate();
  } catch (error) {
    // appendAdminAudit mirrors successful inner savepoints before outer COMMIT.
    // Remove ONLY this rolled-back entry on outer failure, including COMMIT
    // failure; never present a mirror entry as durable success.
    if (auditId) {
      const mirror = getAuditLog();
      const index = mirror.findIndex(entry => entry.id === auditId);
      if (index >= 0) mirror.splice(index, 1);
    }
    throw error;
  }
  return { invitationId: id, token };
}
