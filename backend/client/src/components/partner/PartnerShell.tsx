/**
 * Foundation Build — Partner workspace page header.
 *
 * After the Final Partner CRM refactor, partner pages live inside the
 * CollectiveShell at /collective/partner/*. This component no longer renders
 * its own sidebar; instead it renders a page header with title + identity
 * badges and the page body. The sidebar nav lives in CollectiveShell.
 */
import { ReactNode } from "react";
import type { PartnerTier, PartnerSubRole, PartnerStatus } from "@/lib/partner/useRequirePartnerRole";
// v25.46 BLOCKER FIX #4 (Tier 9 #73) — Consortium Partner workspace consumes the
// canonical Capavate primitives (PageHeader + AppCard) instead of ad-hoc chrome.
import { PageHeader } from "@/components/ui/page-header";
import { AppCard } from "@/components/ui/app-card";

const TIER_COLORS: Record<PartnerTier, string> = {
  catalyst: "bg-gray-200 text-gray-800",
  builder: "bg-blue-200 text-blue-900",
  amplifier: "bg-purple-200 text-purple-900",
  nexus: "bg-amber-200 text-amber-900",
  founding_member: "bg-emerald-200 text-emerald-900",
};

const SUB_ROLE_LABEL: Record<PartnerSubRole, string> = {
  managing_partner: "Managing Partner",
  associate: "Associate",
  bd: "BD",
  analyst: "Analyst",
  viewer: "Viewer",
};

export function TierBadge({ tier }: { tier: PartnerTier }) {
  return (
    <span data-testid="partner-tier-badge" className={`text-xs px-2 py-0.5 rounded font-medium ${TIER_COLORS[tier]}`}>
      {tier.replace("_", " ")}
    </span>
  );
}

export function SubRoleBadge({ subRole }: { subRole: PartnerSubRole }) {
  return (
    <span data-testid="partner-subrole-badge" className="text-xs px-2 py-0.5 rounded bg-[var(--cv-color-surface-2)] text-[var(--cv-color-text)] font-medium">
      {SUB_ROLE_LABEL[subRole]}
    </span>
  );
}

/* GROUP F3 — non-blocking status banner. Rendered ONLY when a `status` is
 * passed AND it is not "active" (i.e. suspended/archived/inactive). Cosmetic
 * DISPLAY only: it does NOT gate any data or writes (the server enforces that
 * on every /api/partner/me/* route except the /me bootstrap). Uses cv-tokens.
 * The `status` prop is OPTIONAL, so existing call sites that omit it are
 * completely unaffected (no banner). */
function PartnerStatusBanner({ status }: { status: PartnerStatus }) {
  return (
    <div
      data-testid="partner-status-banner"
      role="status"
      className="mb-4 rounded-md border border-[var(--cv-color-primary)] bg-[var(--cv-color-surface-2)] px-4 py-3 text-sm text-[var(--cv-color-text)]"
    >
      <span className="font-semibold text-[var(--cv-color-primary)]">
        Your partner account is {status}.
      </span>{" "}
      <span className="text-[var(--cv-color-text-muted)]">
        Access to partner data and actions is paused — contact Capavate to restore your account.
      </span>
    </div>
  );
}

export function PartnerShell({
  children,
  title,
  tier,
  subRole,
  partnerName,
  status,
}: {
  children: ReactNode;
  title: string;
  tier: PartnerTier;
  subRole: PartnerSubRole;
  partnerName: string;
  /* GROUP F3 — optional; a banner shows only when status is non-active. */
  status?: PartnerStatus | null;
}) {
  // Partner pages now live inside CollectiveShell; this component is reduced
  // to a page header + body wrapper. Sidebar nav is provided by CollectiveShell.
  // v25.46 #4: header chrome is now the canonical PageHeader; the identity
  // badges (wrapper-pattern custom components) ride in its `actions` slot. All
  // data-testids preserved (partner-page, partner-page-header, page-title,
  // partner-name, partner-tier-badge, partner-subrole-badge).
  return (
    <div className="px-6 py-6" data-testid="partner-page">
      <div data-testid="partner-page-header">
        <PageHeader
          title={<span data-testid="page-title">{title}</span>}
          subtitle="Partner workspace"
          actions={
            <>
              <span className="text-sm font-medium text-[var(--cv-color-text)]" data-testid="partner-name">{partnerName}</span>
              <TierBadge tier={tier} />
              <SubRoleBadge subRole={subRole} />
            </>
          }
        />
      </div>
      {status && status !== "active" && <PartnerStatusBanner status={status} />}
      {children}
    </div>
  );
}

export function PartnerEmptyState({ title, description, cta }: { title: string; description: string; cta?: ReactNode }) {
  // v25.46 #4: canonical AppCard surface replaces the ad-hoc dashed box.
  return (
    <AppCard data-testid="partner-empty-state" className="py-12 px-6 text-center">
      <div className="text-lg font-semibold text-[var(--cv-color-text)]">{title}</div>
      <div className="text-sm text-[var(--cv-color-text-muted)] mt-2 max-w-md mx-auto">{description}</div>
      {cta && <div className="mt-4">{cta}</div>}
    </AppCard>
  );
}
