import { eq } from "drizzle-orm";
import { companies as companiesTable, users as usersTable } from "../../shared/schema";
import { getDb, rawDb } from "../db/connection";
import { crossTenant } from "./withTenant";

export type CompanyOnboardingStatus = "registered" | "pending" | "indeterminate" | "error";

export interface SafeOwnerInvitation {
  id: string;
  status: string;
  email?: string;
  invitedName: string | null;
  acceptedAt: string | null;
  sentAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

export interface CompanyOnboardingState {
  companyId: string;
  state: CompanyOnboardingStatus;
  reason: string;
  origin: "partner_portfolio" | "legacy" | "indeterminate";
  company: { id: string; name: string | null; sector: string | null; stage: string | null; hq: string | null };
  ownerInvitation: SafeOwnerInvitation | null;
  registeredFounders: Array<{ userId: string; email: string; name: string | null; role: string }>;
}

export type PartnerCompanyOnboardingState =
  Omit<CompanyOnboardingState, "ownerInvitation" | "registeredFounders"> & {
    canViewFounderInvitation: boolean;
    registeredFounderCount: number;
    ownerInvitation?: SafeOwnerInvitation | null;
    registeredFounders?: CompanyOnboardingState["registeredFounders"];
  };

/** Partner-safe serialization boundary. Weak CRM relationships may use state,
 * count and canonical company fields, but do not receive invitation or founder
 * identifiers. Omitted means restricted; it is never represented as fake empty
 * invitation history. */
export function projectCompanyOnboardingForPartner(
  state: CompanyOnboardingState,
  canViewFounderInvitation: boolean,
): PartnerCompanyOnboardingState {
  const { ownerInvitation, registeredFounders, ...safe } = state;
  const base = {
    ...safe,
    canViewFounderInvitation,
    registeredFounderCount: registeredFounders.length,
  };
  return canViewFounderInvitation
    ? { ...base, ownerInvitation, registeredFounders }
    : base;
}

export class CompanyOnboardingUnavailableError extends Error {
  readonly code = "COMPANY_ONBOARDING_UNAVAILABLE";
  constructor(cause?: unknown) {
    super("Company onboarding state could not be read.");
    this.name = "CompanyOnboardingUnavailableError";
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

const lower = (value: unknown) => String(value ?? "").trim().toLowerCase();
const pendingPlaceholder = (value: unknown) => /^u_pending_founder_/i.test(String(value ?? ""));

function parsePayload(value: unknown): Record<string, unknown> | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function readCompanyOnboardingState(
  companyId: string,
  options: { includeInvitationEmail?: boolean } = {},
): CompanyOnboardingState {
  try {
    const db = rawDb();
    // CROSS-TENANT (system resolver) — company ids are globally unique and this
    // lookup establishes the tenant used by every tenant-scoped join below.
    const company = getDb().select({
      id: companiesTable.id,
      tenantId: companiesTable.tenantId,
      name: companiesTable.name,
      sector: companiesTable.sector,
      stage: companiesTable.stage,
      hq: companiesTable.hq,
    }).from(companiesTable)
      .where(crossTenant(eq(companiesTable.id, companyId), companiesTable))
      .limit(1).all()[0] as any;
    if (!company) throw new CompanyOnboardingUnavailableError();

    const invitations = db.prepare(`
      SELECT id, invited_email, invited_name, status, accepted_at, sent_at, expires_at, created_at, deleted_at
      FROM founder_team_invitations
      WHERE company_id = ? AND lower(role) = 'owner' AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
    `).all(companyId) as any[];
    const membershipRows = db.prepare(`
      SELECT cm.user_id, cm.role, ftm.email AS team_email,
             ftm.role AS team_role, ftm.removed_at
      FROM company_members cm
      LEFT JOIN founder_team_members ftm
        ON ftm.company_id = cm.company_id AND ftm.user_id = cm.user_id AND ftm.removed_at IS NULL
      WHERE cm.company_id = ? AND cm.tenant_id = ? AND cm.is_active = 1 AND cm.deleted_at IS NULL
        AND lower(cm.role) IN ('founder','co_founder')
    `).all(companyId, company.tenantId) as any[];
    const memberships = membershipRows.flatMap((row) => {
      // CROSS-TENANT (identity resolver) — a user invited into a company may
      // originate in another tenant; globally unique user id is the binding.
      const identity = getDb().select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(crossTenant(eq(usersTable.id, String(row.user_id)), usersTable))
        .limit(1).all()[0];
      return identity ? [{ ...row, user_email: identity.email, user_name: identity.name }] : [];
    });
    const hasPlaceholderMembership = !!db.prepare(`
      SELECT 1 FROM company_members
      WHERE company_id = ? AND tenant_id = ? AND is_active = 1 AND deleted_at IS NULL
        AND user_id LIKE 'u_pending_founder_%'
      LIMIT 1
    `).get(companyId, company.tenantId);

    const audits = db.prepare(`
      SELECT target, target_id, payload_json FROM audit_log
      WHERE tenant_id = ? AND action = 'company.created' AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
    `).all(company.tenantId) as any[];
    const auditOrigins = audits
      .filter((row) => {
        const payload = parsePayload(row.payload_json);
        return row.target === `company:${companyId}` || row.target_id === companyId || payload?.companyId === companyId;
      })
      .map((row) => parsePayload(row.payload_json)?.origin);
    const historicalPartnerAttribution = !!db.prepare(`
      SELECT 1 FROM partner_attributions
      WHERE company_id = ? AND attribution_source = 'partner_portfolio'
      LIMIT 1
    `).get(companyId);
    const partnerOrigin = auditOrigins.includes("partner_portfolio") || historicalPartnerAttribution;

    const liveOwnerMemberships = memberships.filter((row) =>
      !pendingPlaceholder(row.user_id) && !!lower(row.user_email),
    );
    const acceptedMatches = liveOwnerMemberships.filter((member) =>
      invitations.some((invite) =>
        lower(invite.status) === "accepted" && invite.accepted_at &&
        // The accepted invitation email is historical identity evidence. The
        // durable founder-team row retains that email while the live canonical
        // user may legitimately change their sign-in email later.
        lower(invite.invited_email) === lower(member.team_email) &&
        lower(member.team_role) === "owner",
      ),
    );
    const founders = (partnerOrigin ? acceptedMatches : liveOwnerMemberships).map((row) => ({
      userId: String(row.user_id),
      email: String(row.user_email),
      name: row.user_name ?? null,
      role: String(row.role),
    }));
    // Primary invitation is semantic, not simply the newest history row:
    // an actionable pending invite wins; otherwise retain the newest accepted
    // identity proof; only then show the newest terminal/historical row.
    // Registration still considers every verified accepted invitation below.
    const invitation =
      invitations.find((row) => lower(row.status) === "pending") ??
      invitations.find((row) => lower(row.status) === "accepted") ??
      invitations[0] ??
      null;
    const safeInvitation: SafeOwnerInvitation | null = invitation ? {
      id: String(invitation.id),
      status: String(invitation.status),
      ...(options.includeInvitationEmail ? { email: String(invitation.invited_email) } : {}),
      invitedName: invitation.invited_name ?? null,
      acceptedAt: invitation.accepted_at ?? null,
      sentAt: invitation.sent_at ?? null,
      expiresAt: invitation.expires_at ?? null,
      createdAt: invitation.created_at ?? null,
    } : null;
    const base = {
      companyId,
      company: {
        id: String(company.id),
        name: company.name ?? null,
        sector: company.sector ?? null,
        stage: company.stage ?? null,
        hq: company.hq ?? null,
      },
      ownerInvitation: safeInvitation,
      registeredFounders: founders,
    };

    if (partnerOrigin) {
      if (founders.length) return { ...base, state: "registered", reason: "accepted_owner_identity_matched", origin: "partner_portfolio" };
      const pending = invitations.some((row) => lower(row.status) === "pending");
      if (pending) return { ...base, state: "pending", reason: "owner_invitation_pending", origin: "partner_portfolio" };
      return { ...base, state: "indeterminate", reason: "owner_identity_not_verified", origin: "partner_portfolio" };
    }

    const ambiguousPlaceholder = hasPlaceholderMembership;
    if (ambiguousPlaceholder) return { ...base, state: "indeterminate", reason: "legacy_origin_ambiguous", origin: "indeterminate" };
    if (founders.length) return { ...base, state: "registered", reason: "legacy_persisted_owner_membership", origin: "legacy" };
    if (invitations.length > 0) return { ...base, state: "indeterminate", reason: "legacy_origin_ambiguous", origin: "indeterminate" };
    return { ...base, state: "indeterminate", reason: "no_verified_owner_identity", origin: "indeterminate" };
  } catch (error) {
    if (error instanceof CompanyOnboardingUnavailableError) throw error;
    throw new CompanyOnboardingUnavailableError(error);
  }
}

export function requireRegisteredCompany(companyId: string): CompanyOnboardingState {
  const state = readCompanyOnboardingState(companyId, { includeInvitationEmail: false });
  if (state.state !== "registered") {
    const error = new Error("The company must complete founder registration before this action.");
    (error as Error & { code?: string; onboardingState?: string }).code = "COMPANY_NOT_REGISTERED";
    (error as Error & { code?: string; onboardingState?: string }).onboardingState = state.state;
    throw error;
  }
  return state;
}
