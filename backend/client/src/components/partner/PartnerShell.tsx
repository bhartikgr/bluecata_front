/**
 * Foundation Build — Partner workspace page header.
 *
 * After the Final Partner CRM refactor, partner pages live inside the
 * CollectiveShell at /collective/partner/*. This component no longer renders
 * its own sidebar; instead it renders a page header with title + identity
 * badges and the page body. The sidebar nav lives in CollectiveShell.
 */
import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { resolvePersona, type MfcrmCapability } from "@/lib/partner/mfcrmPersona";
import type { PartnerTier, PartnerSubRole, PartnerStatus } from "@/lib/partner/useRequirePartnerRole";
// v25.46 BLOCKER FIX #4 (Tier 9 #73) — Consortium Partner workspace consumes the
// canonical Capavate primitives (PageHeader + AppCard) instead of ad-hoc chrome.
import { PageHeader } from "@/components/ui/page-header";
import { AppCard } from "@/components/ui/app-card";
import { PortalVersionFooter } from "@/components/PortalVersionFooter"; /* WAVE 90 · ITEM 2 (M-1 / R81) */

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

/**
 * WAVE 20 / FE-15 — the partner's Managed-Founder PERSONA, shown beside tier and
 * sub-role on every partner page header.
 *
 * Tier and sub-role describe the partner's COMMERCIAL standing. Neither says
 * what KIND of firm this is, yet firm type is what decides which of the 17
 * persona routes the partner may call at all
 * (`server/managedFounderPersonaRoutes.ts`). A user moving between the Managed
 * Founders workspace and the persona tools had no persistent indication of
 * which persona the server would resolve for them.
 *
 * DB-driven: the label comes from `GET /api/partner/me/mfcrm/capability`
 * (`server/managedFounderRoutes.ts:70`) through the shared resolver, which is
 * the same function the persona PAGE uses — so the header can never disagree
 * with the surface it introduces.
 *
 * RENDERS NOTHING when there is no persona (loading, error, unclassified, or a
 * firm type with no persona surface). That is deliberate and is NOT the
 * fabricated-empty-state failure rule 3 forbids: this badge is an identity
 * label, not a data surface, and inventing a persona for a firm that has none —
 * or showing a stale one when the profile cannot be read — would be actively
 * misleading. The refusal ITSELF is rendered, in full, on the persona page
 * (`PartnerMfcrmPersonas.tsx`), which is where a partner goes to act.
 */
function PartnerPersonaBadge() {
  const capQ = useQuery<{ capability: MfcrmCapability }>({
    queryKey: ["/api/partner/me/mfcrm/capability"],
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/mfcrm/capability")).json(),
    /* Shares the persona page's cache key, so navigating between them costs no
     * extra request and the two can never show different personas. */
    staleTime: 60_000,
    retry: false,
  });
  const persona = resolvePersona(capQ.data?.capability ?? null);
  if (!persona) return null;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium bg-teal-100 text-teal-900"
      data-testid="partner-persona-badge"
      title={persona.blurb}
    >
      {persona.label}
    </span>
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
              {/* WAVE 20 / FE-15 — persona badge. Added as a SIBLING element in
                  the actions slot, never by appending text inside TierBadge or
                  SubRoleBadge: the silent-drop guard diffs text nodes, so text
                  appended inside an existing node reads as a REMOVAL plus an
                  addition. A new sibling is purely additive. */}
              <PartnerPersonaBadge />
            </>
          }
        />
      </div>
      {status && status !== "active" && <PartnerStatusBanner status={status} />}
      {children}
      {/* ═══════════════════════════════════════════════════════════════════════
          WAVE 90 · ITEM 2 (register PART 11 · M-1, OWNER RULING R81).

          THE PARTNER PORTAL REPORTED NO VERSION AT ALL, on any screen. The admin
          footer said 26.19.0 and the investor footer said a hardcoded 0.23.0, so
          "the live version" was three different answers depending on where you
          looked — and Avi's "26.19.0 installed" confirmation came from the one
          surface that happened to be right.

          R81 (owner, 2026-08-21): "It's all one install … Avi updates the entire
          platform in one go." So one correct surface IS sufficient evidence —
          but ONLY once no portal carries a hardcoded literal. This is the third
          of the three portals, and it closes that condition.

          ── OWNERSHIP, STATED BECAUSE IT MATTERS ────────────────────────────────
          WAVE 1D owns the partner area. Wave 90 owns VERSION REPORTING, and R81
          names the partner version string as a Wave 90 deliverable explicitly.
          This is the minimum possible intersection of the two:
            · PURELY ADDITIVE — appended as the last child. No existing element,
              control, prop, data-testid, class or ordinal is touched, so no
              partner control moves and nothing is removed.
            · NOT A RESTYLE — no colour, spacing, border or type decision is made
              here beyond the muted 10px footer convention already used by
              BuildVersionMarker on the admin dashboard.
            · IT IS IN THE SHELL, NOT PER-PAGE, deliberately: per-page placement
              would make the partner portal report a version on some screens and
              not others, which is the M-1 defect in miniature.
          Guard impact: ONE added copy string, ZERO removals. Wave 1D's redesign
          can restyle this freely; it must not delete it.

          The value is NOT a literal. It is read from GET /api/healthz, which the
          server resolves from the shipped package.json — the SAME source the
          admin footer reads. See build_log/wave90/W90_VERSION_TRUTH.md.
          ═══════════════════════════════════════════════════════════════════════ */}
      <PortalVersionFooter
        productName="Capavate Consortium Partner Platform"
        testId="partner-portal-version"
        className="mt-8 block text-center text-[10px] text-[var(--cv-color-text-muted)] select-text"
      />
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
