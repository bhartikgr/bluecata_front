import type { QueryClient } from "@tanstack/react-query";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT } from "@shared/wave214ThirdPartyAuthorityCopy";

export interface FounderInvitation {
  id: string; email: string; name: string | null; status: string;
  sentAt: string | null; acceptedAt: string | null; expiresAt: string | null;
  claimUrl?: string | null;
  handoff: {
    mode: "smtp" | "console" | "dry_run" | "unknown";
    result: "accepted" | "simulated" | "failed" | "unknown";
    error?: string; statusRecorded?: boolean;
  };
}
export function invitationHandoffCopy(invite: FounderInvitation): string {
  const h = invite.handoff;
  if (h.result === "failed") return "Mail handoff failed. The company and invitation remain saved. Review and reissue the invitation, or share the one-time claim link securely.";
  if (h.result === "simulated") return "Simulated send only (console/dry-run). No email was sent. Share the one-time claim link securely or reissue when SMTP is enabled.";
  if (h.result === "accepted" && h.mode === "smtp") return "Accepted by mail service. Inbox delivery is not confirmed.";
  return "Mail handoff is unconfirmed. A stored send timestamp alone does not prove SMTP acceptance or inbox delivery.";
}
/** Actual mounted query keys, shared by creation and recovery. Prefixes include
 * portfolio detail; no orphan eligibility key (eligibility reads portfolio). */
export function invalidateFounderInvitationQueries(qc: QueryClient, companyId: string) {
  return Promise.all([
    "/api/partner/me/pipeline", "/api/partner/me/portfolio", "/api/partner/me/clients",
    "/api/partner/me/client-crm-index", "/api/partner/me/relationships",
    "/api/partner/me/mfcrm/dashboard", "/api/partner/me/mfcrm/engagements",
    "/api/admin/companies/full",
  ].map(key => qc.invalidateQueries({ queryKey: [key] })).concat([
    qc.invalidateQueries({ queryKey: [`/api/partner/me/portfolio-companies/${companyId}/founder-invitation`] }),
    qc.invalidateQueries({ queryKey: ["/api/admin/companies", companyId, "onboarding"] }),
  ]));
}
export type ReviewedPortfolioCompany = Readonly<{
  companyName: string; founderEmail: string; founderName: string; legalName: string;
  sector: string; stage: string; hq: string; authorityTypedName: string;
  authorityStatementShown: string;
}>;
/** Capture visible native controls, not stale controlled React state. */
export function capturePortfolioCompany(form: HTMLFormElement, validate = true): ReviewedPortfolioCompany {
  const data = new FormData(form);
  const value = (name: string) => {
    const control = form.elements.namedItem(name);
    // FormData intentionally omits disabled fields. Their visible current
    // values must still survive review (e.g. a taxonomy fetch error/loading).
    // Select helpers have distinct names; the canonical text input is unique.
    const visible = control instanceof HTMLInputElement ? control.value : "";
    return String(data.get(name) ?? visible).trim();
  };
  const snapshot = {
    companyName: value("companyName"), founderEmail: value("founderEmail").toLowerCase(),
    founderName: value("founderName"), legalName: value("legalName"),
    sector: value("sector"), stage: value("stage"), hq: value("hq"),
    authorityTypedName: value("authorityTypedName"),
    authorityStatementShown: WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
  };
  if (validate) {
    if (!snapshot.companyName) throw new Error("Enter a company name before reviewing.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.founderEmail)) throw new Error("Enter a valid founder email before reviewing.");
    if (!snapshot.authorityTypedName) throw new Error("Enter your name to confirm your authority before reviewing.");
  }
  return Object.freeze(snapshot);
}
