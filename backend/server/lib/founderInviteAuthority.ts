/**
 * Ownership-invitation authority is stronger than CRM tracking visibility.
 * Ordinary partner endpoints cannot mint this creation provenance; the generic
 * audit append endpoint is admin-only. This is not a claim against trusted admin
 * or database compromise. Never infer authority from self-asserted CRM rows.
 */
import { eq } from "drizzle-orm";
import { companies } from "../../shared/schema";
import { getDb, rawDb } from "../db/connection";
import { crossTenant } from "./withTenant";

export class FounderInviteAuthorityUnavailableError extends Error {
  readonly code = "FOUNDER_INVITE_AUTHORITY_UNAVAILABLE";
  constructor() {
    super("Founder invitation authority could not be verified.");
    this.name = "FounderInviteAuthorityUnavailableError";
  }
}

export function readFounderInvitationCompanyTenant(companyId: string): string | null {
  // CROSS-TENANT (company authority resolver) — resolve globally unique ID to
  // its actual live tenant before the narrowly scoped provenance read.
  const company = getDb().select({ tenantId: companies.tenantId }).from(companies)
    .where(crossTenant(eq(companies.id, companyId), companies)).limit(1).all()[0];
  return company?.tenantId ?? null;
}

/** Denied/missing provenance -> false; infrastructure failures propagate. */
export function hasFounderInvitationAuthority(partnerId: string, companyId: string): boolean {
  try { return readAuthority(partnerId, companyId); }
  catch { throw new FounderInviteAuthorityUnavailableError(); }
}

function readAuthority(partnerId: string, companyId: string): boolean {
  if (!partnerId || !companyId) return false;
  const tenantId = readFounderInvitationCompanyTenant(companyId);
  if (!tenantId) return false;
  const tenants = [tenantId];
  // Known historical creator/resolver mismatch, not an arbitrary alias search.
  // Only the server-minted ID and canonical creator tenant contract qualify.
  if (/^co_[0-9a-f]{12}$/.test(companyId) && tenantId === `tenant_co_${companyId}`) {
    tenants.push(`tenant_co_${companyId.slice(3)}`);
  }
  const db = rawDb();
  const rows = db.prepare(`SELECT target_id, payload_json, hash, deleted_at
    FROM audit_log WHERE tenant_id IN (${tenants.map(() => "?").join(",")})
    AND action = 'company.created' AND target = ?`).all(...tenants, `company:${companyId}`) as Array<{
      target_id: string | null; payload_json: string; hash: string; deleted_at: string | null;
    }>;
  // Do not select a later convenient matching row or ignore conflicting history.
  if (rows.length !== 1) return false;
  const row = rows[0];
  if (row.deleted_at || typeof row.hash !== "string" || !row.hash.trim() ||
      (row.target_id !== null && row.target_id !== companyId)) return false;
  let payload: Record<string, unknown>;
  try {
    const value = JSON.parse(row.payload_json);
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    payload = value;
  } catch { return false; }
  if (payload.companyId !== companyId || payload.origin !== "partner_portfolio" ||
      payload.createdByPartnerId !== partnerId) return false;
  // Canonical attribution has no deleted_at column; revocation is its removal
  // mechanism. This live originating row is a revocation guard, never sole proof.
  return !!db.prepare(`SELECT 1 FROM partner_attributions
    WHERE partner_id = ? AND company_id = ? AND attribution_source = 'partner_portfolio'
    AND revoked_at IS NULL LIMIT 1`).get(partnerId, companyId);
}
