/**
 * Foundation Build — Partner workspace page header.
 *
 * After the Final Partner CRM refactor, partner pages live inside the
 * CollectiveShell at /collective/partner/*. This component no longer renders
 * its own sidebar; instead it renders a page header with title + identity
 * badges and the page body. The sidebar nav lives in CollectiveShell.
 */
import { ReactNode } from "react";
import type { PartnerTier, PartnerSubRole } from "@/lib/partner/useRequirePartnerRole";

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
    <span data-testid="partner-subrole-badge" className="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-medium">
      {SUB_ROLE_LABEL[subRole]}
    </span>
  );
}

export function PartnerShell({
  children,
  title,
  tier,
  subRole,
  partnerName,
}: {
  children: ReactNode;
  title: string;
  tier: PartnerTier;
  subRole: PartnerSubRole;
  partnerName: string;
}) {
  // Partner pages now live inside CollectiveShell; this component is reduced
  // to a page header + body wrapper. Sidebar nav is provided by CollectiveShell.
  return (
    <div className="px-6 py-6" data-testid="partner-page">
      <header className="mb-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between" data-testid="partner-page-header">
        <div>
          <h1 className="text-2xl font-bold text-slate-900" data-testid="page-title">{title}</h1>
          <div className="text-sm text-slate-500 mt-1">Partner workspace</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700" data-testid="partner-name">{partnerName}</span>
          <TierBadge tier={tier} />
          <SubRoleBadge subRole={subRole} />
        </div>
      </header>
      {children}
    </div>
  );
}

export function PartnerEmptyState({ title, description, cta }: { title: string; description: string; cta?: ReactNode }) {
  return (
    <div data-testid="partner-empty-state" className="border-2 border-dashed border-slate-200 rounded-xl py-12 px-6 text-center bg-white">
      <div className="text-lg font-semibold text-slate-900">{title}</div>
      <div className="text-sm text-slate-500 mt-2 max-w-md mx-auto">{description}</div>
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}
