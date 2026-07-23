/**
 * Wave C-3 — Collective Shell
 *
 * Standalone shell with its own sidebar + topbar for the Collective experience.
 * Visual identity: v25.43 R3-2 re-skin — brand red #cc0001 accent, cream #F7F6F2 background, navy text.
 * Light-mode only. No web storage.
 */

import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Briefcase, Users, Building2, Circle, BarChart3,
  TrendingUp, ClipboardList, UserCircle, Activity, Settings, Menu, X,
  ArrowLeftRight, LogOut, Scale, UserPlus, FileText,
  PiggyBank, CalendarDays, Trophy, Receipt,
  /* v25.42 (Bucket B) — icons for the 7 new Collective nav entries. */
  Network, Handshake, ClipboardCheck, Inbox,
  /* v25.33 Consortium Partner Payment Model — icons for the new partner
     self-service nav items (Subscribe / Agreement / Tax Forms). */
  FileSignature, FileCheck,
  /* v25.49 Phase-3B — icons for the new partner NETWORK group (Messages/Posts). */
  MessageSquare, Newspaper,
  /* GROUP F1 — icon for the person-level partner CRM Contacts nav item. */
  Contact,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useLegalDrawer } from "@/lib/legalDrawer";
import { useRole } from "@/lib/role";
import { usePartnerMembership } from "@/lib/partner/usePartnerMembership";
import { useQuery } from "@tanstack/react-query"; /* v16 Fix 6 — read COLLECTIVE_ENABLED */
import { apiRequest, queryClient } from "@/lib/queryClient"; /* v16 Fix 6 */
import { ChapterSelector } from "@/components/ChapterSelector"; /* v17 Phase A — chapter scope dropdown in topbar */
import { MarketTicker } from "@/components/feeds/MarketTicker"; /* v25.43 R3-4 — persistent live ticker strip */
import { CollectiveMemberGate } from "@/components/CollectiveMemberGate"; /* v25.48.2 MF7 (Q9) — member gate on the common shell */
import { CapavateLogo } from "@/components/CapavateLogo"; /* W-LOGO — real Capavate wordmark in the shell brand block */

/* ============================================================
 * v25.41 Bug-1 — Consortium Partner vs Collective separation
 *
 * A partner-only user (active partner membership but NO active Collective
 * chapter membership) must see ONLY the PARTNER WORKSPACE nav, branded
 * "CONSORTIUM". A dual-role user (partner AND active Collective member)
 * keeps the existing combined view. Detection is chapter_id-free: the
 * existing GET /api/me/chapters endpoint already returns ONLY active
 * memberships (server/chaptersStore.ts filters status="active"), so a
 * non-empty list == active Collective member. No server change, no removal
 * of any NAV_GROUPS / PARTNER_WORKSPACE_GROUP array — assembly logic only.
 */
function useCollectiveMembershipActive(): boolean {
  const q = useQuery<{ ok?: boolean; chapters?: Array<{ id: string }> }>({
    queryKey: ["/api/me/chapters"],
    queryFn: async () => {
      try {
        return await (await apiRequest("GET", "/api/me/chapters")).json();
      } catch {
        // Fail closed: when COLLECTIVE_ENABLED=0 the endpoint 503s and
        // apiRequest throws; treat as "no active membership".
        return { ok: false, chapters: [] };
      }
    },
    retry: false,
    staleTime: 30_000,
  });
  return Array.isArray(q.data?.chapters) && (q.data!.chapters!.length > 0);
}

/**
 * v25.41 Bug-1 — resolves the shell "mode" for the current session.
 *   - "partner"    : partner-only (show partner nav only, CONSORTIUM brand)
 *   - "combined"   : partner + active Collective member (existing combined view)
 *   - "collective" : non-partner (existing Collective view)
 */
function usePartnerOnlyMode(): boolean {
  const partner = usePartnerMembership();
  const collectiveMember = useCollectiveMembershipActive();
  return partner.isPartner && !collectiveMember;
}

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  "data-testid"?: string;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: "HUB",
    items: [
      { href: "/collective/dashboard", label: "Dashboard", icon: LayoutDashboard, "data-testid": "nav-collective-dashboard" },
      { href: "/collective/dealroom", label: "Deal Room", icon: Briefcase, "data-testid": "nav-collective-dealroom" },
    ],
  },
  {
    title: "NETWORK",
    items: [
      { href: "/collective/members", label: "Member Directory", icon: Users, "data-testid": "nav-collective-members" },
      { href: "/collective/companies", label: "Companies", icon: Building2, "data-testid": "nav-collective-companies" },
      { href: "/collective/soft-circles", label: "Soft Circles", icon: Circle, "data-testid": "nav-collective-soft-circles" },
      /* v25.42 R1 + R8 — connections + member-facing partners directory. */
      { href: "/collective/connections", label: "Connections", icon: Network, "data-testid": "nav-collective-connections" },
      { href: "/collective/partners", label: "Partners", icon: Handshake, "data-testid": "nav-collective-partners" },
    ],
  },
  {
    title: "M&A INTELLIGENCE",
    items: [
      { href: "/collective/dsc/pipeline", label: "DSC Pipeline", icon: BarChart3, "data-testid": "nav-collective-dsc-pipeline" },
      { href: "/collective/dsc/scores", label: "Composite Scores", icon: TrendingUp, "data-testid": "nav-collective-dsc-scores" },
      { href: "/collective/dsc/prep", label: "Transaction Prep Tracker", icon: ClipboardList, "data-testid": "nav-collective-dsc-prep" },
    ],
  },
  /* W6 — COMMUNITY group. Surfaces first-class member community routes that
   * previously had NO nav entry (notably Ask-an-Expert, which existed at
   * /collective/ask-expert but was orphaned). No route is dropped; this only
   * adds visibility. Ask-an-Expert also hosts the W6 "connect a partner"
   * responder flow. */
  {
    title: "COMMUNITY",
    items: [
      { href: "/collective/ask-expert", label: "Ask an Expert", icon: MessageSquare, "data-testid": "nav-collective-ask-expert" },
      { href: "/collective/posts", label: "Posts", icon: Newspaper, "data-testid": "nav-collective-posts" },
      { href: "/collective/presentations", label: "Presentations", icon: FileText, "data-testid": "nav-collective-presentations" },
    ],
  },
  /* v19 Phase A — Events Calendar + Leaderboard. Placed in their own
   * group so they get dedicated visibility without disrupting existing
   * nav ordering. */
  {
    title: "CHAPTER LIFE",
    items: [
      { href: "/collective/calendar", label: "Calendar", icon: CalendarDays, "data-testid": "nav-collective-calendar" },
      { href: "/collective/leaderboard", label: "Leaderboard", icon: Trophy, "data-testid": "nav-collective-leaderboard" },
      /* v25.42 R2 + R3 + R4 — recaps, screening recaps, chapters. */
      { href: "/collective/chapters", label: "Chapters", icon: Building2, "data-testid": "nav-collective-chapters" },
      { href: "/collective/recaps", label: "Recaps", icon: FileText, "data-testid": "nav-collective-recaps" },
      { href: "/collective/screening-recaps", label: "Screening Recaps", icon: ClipboardCheck, "data-testid": "nav-collective-screening-recaps" },
    ],
  },
  {
    title: "YOUR ACCOUNT",
    items: [
      { href: "/collective/membership", label: "My Membership", icon: UserCircle, "data-testid": "nav-collective-membership" },
      /* v25.42 R5 — read-only requests portal. */
      { href: "/collective/portal/requests", label: "My Requests", icon: Inbox, "data-testid": "nav-collective-requests" },
      { href: "/collective/activity", label: "Activity", icon: Activity, "data-testid": "nav-collective-activity" },
      { href: "/collective/settings", label: "Settings", icon: Settings, "data-testid": "nav-collective-settings" },
    ],
  },
];

// Partner-workspace nav, added dynamically in CollectiveSidebar when the
// session has an active partner membership.
//
// v25.48.3 Phase-2B — the previously-flat "PARTNER WORKSPACE" group is now
// split into labeled sections (OVERVIEW / DEALS & SPVs / WORKSPACE / ACCOUNT)
// per the approved nav reorder. ALL 14 hrefs/labels/icons/data-testids are
// preserved byte-for-byte — this is a regrouping only, nothing dropped
// (Sacred Rule #78). The NETWORK group (Messages/Posts) is intentionally
// omitted while empty; Phase 3 adds it. Reuses the existing NavGroup pattern.
const PARTNER_WORKSPACE_GROUPS: NavGroup[] = [
  {
    title: "OVERVIEW",
    items: [
      { href: "/collective/partner/dashboard", label: "Dashboard", icon: LayoutDashboard, "data-testid": "nav-partner-dashboard" },
      /* W-MFCRM — Managed Founders engine (engagements + 3 CRM-layer drill-down).
         Additive entry; nothing existing was renamed/moved/removed. */
      { href: "/collective/partner/managed-founders", label: "Managed Founders", icon: Handshake, "data-testid": "nav-partner-managed-founders" },
    ],
  },
  {
    title: "DEALS & SPVs",
    items: [
      { href: "/collective/partner/pipeline", label: "Pipeline", icon: Briefcase, "data-testid": "nav-partner-pipeline" },
      /* Wave B1 (3a) — create a net-new, independent company (founder-owned,
         tagged to this partner) directly below Pipeline. */
      { href: "/collective/partner/add-portfolio-company", label: "Add Portfolio Company", icon: Building2, "data-testid": "nav-partner-add-portfolio-company" },
      /* Ozan decision #4 — ONE canonical, user-facing SPVs engine + ONE nav entry.
         The duplicate "SPV Engine" and separate "Funds" entries were collapsed
         into this single "SPVs" link pointing at the canonical PartnerSpvEngine
         page. The legacy /spvs and /funds routes stay reachable (they redirect to
         the canonical surface) so no bookmark/link breaks — Sacred Rule #78. */
      { href: "/collective/partner/spv-engine", label: "SPVs", icon: Building2, "data-testid": "nav-partner-spvs" },
      /* W2-A — "Clients" nav item restored. (The prior "(page deleted)" comment
         was inaccurate: PartnerClients.tsx / PartnerClientDetail.tsx were never
         deleted — only their routes/nav were trimmed in v25.50.0, and the read
         endpoints were re-added in W2-A.) */
      { href: "/collective/partner/clients", label: "Clients", icon: Users, "data-testid": "nav-partner-clients" },
      /* GROUP F1 — person-level CRM (partner_crm_contacts) now has a UI. */
      { href: "/collective/partner/contacts", label: "Contacts (CRM)", icon: Contact, "data-testid": "nav-partner-contacts" },
      /* W2-D — "Portfolio" nav item added; the /api/partner/me/portfolio API
         already existed but had no client route/nav to reach it. */
      { href: "/collective/partner/portfolio", label: "Portfolio", icon: PiggyBank, "data-testid": "nav-partner-portfolio" },
    ],
  },
  {
    // v25.49 Phase-3B — NETWORK group added now that it has items (Phase-2B
    // left room for it). Reuses the shared comms Messages + Posts surfaces.
    title: "NETWORK",
    items: [
      { href: "/collective/partner/messages", label: "Messages", icon: MessageSquare, "data-testid": "nav-partner-messages" },
      { href: "/collective/partner/posts", label: "Posts", icon: Newspaper, "data-testid": "nav-partner-posts" },
    ],
  },
  {
    title: "WORKSPACE",
    items: [
      { href: "/collective/partner/team", label: "Team", icon: UserPlus, "data-testid": "nav-partner-team" },
      { href: "/collective/partner/notes", label: "Notes", icon: FileText, "data-testid": "nav-partner-notes" },
      /* v25.50.0 Phase 6 (spec 5a/6a) — "Tasks" and "Files" nav items removed (pages deleted). */
    ],
  },
  {
    title: "ACCOUNT",
    items: [
      /* v25.32 A3 — consortium partner commission ledger (not subscription billing). */
      { href: "/collective/partner/billing", label: "Billing", icon: Receipt, "data-testid": "nav-partner-billing" },
      /* v25.50.0 Phase 6 (spec 9a) — "Subscribe" nav item removed; the subscribe
         flow is merged into the Billing → Subscription tab (Phase 7). */
      { href: "/collective/partner/agreement", label: "Agreement", icon: FileSignature, "data-testid": "nav-partner-agreement" },
      { href: "/collective/partner/tax-form", label: "Tax Forms", icon: FileCheck, "data-testid": "nav-partner-tax-form" },
      { href: "/collective/partner/settings", label: "Settings", icon: Settings, "data-testid": "nav-partner-settings" },
    ],
  },
];

/* ============================================================
 * Sidebar nav item
 * ============================================================ */

function NavLink({ item }: { item: NavItem }) {
  const [location] = useLocation();
  const isActive =
    location === item.href ||
    (item.href !== "/collective/dashboard" && location.startsWith(item.href));

  return (
    <Link
      href={item.href}
      data-testid={item["data-testid"]}
      className={[
        "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
        /* v25.43 R3-2 — sidebar active/hover re-skinned from the old plum
           (#8E2A4E) to the capavate.com brand red (#cc0001) at a soft 8%
           tint, matching the live site's nav treatment. */
        isActive
          ? "bg-[rgba(204,0,1,0.08)] text-[var(--cv-color-primary)]"
          : "text-[var(--cv-color-text-secondary)] hover:bg-[rgba(204,0,1,0.08)] hover:text-[var(--cv-color-primary)]",
      ].join(" ")}
      style={{ textDecoration: "none" }}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
}

/* ============================================================
 * Sidebar
 * ============================================================ */

function CollectiveSidebar({ onClose }: { onClose?: () => void }) {
  const { openDrawer } = useLegalDrawer();
  const partner = usePartnerMembership();
  // v16 Fix 6 — honest invite-only beta: when COLLECTIVE_ENABLED is false,
  // the full Collective nav is hidden and a single "Join the Waitlist" link
  // is shown instead. The partner-workspace group still flows through its
  // own gate.
  const flagsQ = useQuery<{ COLLECTIVE_ENABLED?: boolean }>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => (await apiRequest("GET", "/api/feature-flags")).json(),
  });
  const collectiveOn = flagsQ.data?.COLLECTIVE_ENABLED === true;
  const BETA_WAITLIST_GROUP: NavGroup = {
    title: "BETA — INVITE-ONLY",
    items: [
      // v25.13 NH1 — /collective/waitlist is not a registered route; the
      // existing public-style apply page is /investor/apply-to-collective
      // (or /founder/apply-to-collective for founders). Sending users to
      // the investor flow gives them a working surface instead of 404.
      { href: "/investor/apply-to-collective", label: "Join the Waitlist", icon: UserPlus, "data-testid": "nav-collective-waitlist" },
    ],
  };
  const baseGroups: NavGroup[] = collectiveOn ? NAV_GROUPS : [BETA_WAITLIST_GROUP];
  // v25.41 Bug-1 — partner-only users (partner role, NO active Collective
  // membership) see ONLY the partner workspace nav; the Collective base nav
  // is suppressed for them. Dual-role users (partner + active member) keep
  // the combined view exactly as before. Pure-Collective users are unchanged.
  // React #310 FIX — useCollectiveMembershipActive() MUST be called
  // unconditionally. Inlining it after `partner.isPartner &&` short-circuited
  // the hook whenever isPartner was false, so the hook count changed between
  // the pending render (isPartner=false, hook skipped) and the resolved render
  // (isPartner=true, hook run), crashing the whole partner shell with a
  // hooks-order violation on every page.
  const collectiveMemberActive = useCollectiveMembershipActive();
  const partnerOnly = partner.isPartner && !collectiveMemberActive;
  const groups: NavGroup[] = partnerOnly
    ? [...PARTNER_WORKSPACE_GROUPS]
    : partner.isPartner
      ? [...baseGroups, ...PARTNER_WORKSPACE_GROUPS]
      : baseGroups;

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: "#F7F6F2", borderRight: "1px solid #E8E4E0" }}
    >
      {/* Brand header */}
      <div
        className="flex items-center justify-between px-4 py-4"
        style={{ borderBottom: "1px solid #E8E4E0" }}
      >
        {/* W-LOGO (Ozan) — use the REAL Capavate logo with the product name
            written UNDERNEATH it, replacing the old "C" tile + inline
            CONSORTIUM/COLLECTIVE badge. Partner-only sessions read
            "Consortium Partner"; Collective/combined sessions read "Collective".
            The logo asset already contains the Capavate wordmark. */}
        <div className="flex flex-col items-start gap-0.5" data-testid="brand-block">
          <CapavateLogo className="h-6 w-auto" />
          <span
            className="text-[11px] font-semibold tracking-wide"
            style={{ color: partnerOnly ? "var(--cv-color-navy)" : "var(--cv-color-primary)" }}
            data-testid="brand-product-label"
          >
            {partnerOnly ? "Consortium Partner" : "Collective"}
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden p-1 rounded hover:bg-black/05"
            data-testid="button-close-sidebar"
          >
            <X className="h-4 w-4 text-[var(--cv-color-text-secondary)]" />
          </button>
        )}
      </div>

      {/* Nav groups */}
      <ScrollArea className="flex-1 px-2 py-3">
        <nav>
          {groups.map((group) => (
            <div key={group.title} className="mb-4">
              <p
                className="px-3 mb-1 text-[10px] font-semibold tracking-wider uppercase"
                /* v25.43 R3-2 — group labels re-skinned plum → brand red.
                   v25.48.3 Phase-2B — partner-only sessions use the muted
                   capavate.com navy (#041e41) for the new grouped section
                   headers; Collective/combined sessions keep brand red. */
                style={{ color: partnerOnly ? "var(--cv-color-navy)" : "var(--cv-color-primary)", opacity: 0.7 }}
              >
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Bottom: Legal & Privacy */}
      <div className="px-4 py-3" style={{ borderTop: "1px solid #E8E4E0" }}>
        <button
          onClick={() => openDrawer()}
          data-testid="button-legal-privacy"
          className="flex items-center gap-2 text-xs text-[var(--cv-color-text-muted)] hover:text-[var(--cv-color-text-secondary)] transition-colors w-full"
        >
          <Scale className="h-3 w-3" />
          Legal &amp; Privacy
        </button>
      </div>
    </div>
  );
}

/* ============================================================
 * Topbar
 * ============================================================ */

function CollectiveTopbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { role } = useRole();
  const [, navigate] = useLocation();
  // v25.41 Bug-1 — partner-only sessions retitle the topbar and hide the
  // chapter selector (a pure partner has no Collective chapter scope).
  const partnerOnly = usePartnerOnlyMode();

  function switchToCapavate() {
    // v25.13 NH2 — was only admin vs founder; investor users would land
    // on /founder/dashboard and trip 403s against /api/founder/*. Branch
    // for investor (and any other non-admin/non-founder role) properly.
    const dest =
      role === "admin" ? "/admin/dashboard" :
      role === "investor" ? "/investor/dashboard" :
      "/founder/dashboard";
    navigate(dest);
  }

  const [loggingOut, setLoggingOut] = useState(false);
  /* W2-B — partner logout. The LogOut icon was imported but never wired. This
     calls the existing server session-revoke route, clears the React Query
     cache so no stale authed data survives, and hard-navigates to the partner
     login (window.location so all in-memory app state is dropped). */
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {
      /* fail-safe: even if the revoke call fails we still clear the client
         and redirect so the user is not left in a half-authed state. */
    } finally {
      try {
        await queryClient.resetQueries();
      } catch { /* non-fatal */ }
      window.location.href = "/partner/login";
    }
  }

  return (
    <header
      className="h-14 flex items-center justify-between px-4 gap-3"
      style={{
        backgroundColor: "#fff",
        borderBottom: "1px solid #E8E4E0",
      }}
    >
      <div className="flex items-center gap-3">
        {/* Mobile menu button */}
        <button
          onClick={onMenuClick}
          className="md:hidden p-2 rounded hover:bg-[var(--cv-color-surface-2)]"
          data-testid="button-mobile-menu"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5 text-[var(--cv-color-text-secondary)]" />
        </button>

        <div
          className="text-sm font-medium hidden md:block"
          style={{ color: "#1A1A2E" }}
          data-testid="topbar-title"
        >
          {/* v25.41 Bug-1 — partner-only sessions show the Consortium title. */}
          {partnerOnly ? "Capavate Consortium Partner" : "Capavate Collective"}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* v17 Phase A — chapter selector. Renders null when COLLECTIVE_ENABLED!=1
            or when the user has zero chapter memberships, so the topbar layout
            matches the v16 Friday baseline by default. */}
        <ChapterSelector data-testid="topbar-chapter-selector" />
        {/* v25.41 Bug-1/Bug-2 — the "Switch to Capavate" affordance routes to the
            legacy company portal (founder/investor/admin dashboards). A pure
            consortium partner has no such home and would land on a 403; hide
            it for partner-only sessions. Dual-role and pure-Collective users
            keep the button exactly as before. */}
        {!partnerOnly && (
          <Button
            variant="outline"
            size="sm"
            onClick={switchToCapavate}
            data-testid="button-switch-to-capavate"
            className="gap-2 text-xs border-[var(--cv-color-primary)]/30 text-[var(--cv-color-primary)] hover:bg-[rgba(204,0,1,0.05)]"
          >
            <ArrowLeftRight className="h-3 w-3" />
            Switch to Capavate
          </Button>
        )}
        {/* W2-B — logout. Shown for partner-only sessions (whose only home is
            the partner workspace); dual-role/Collective users retain their
            existing Capavate portal logout via AppShell. */}
        {partnerOnly && (
          <Button
            variant="outline"
            size="sm"
            onClick={logout}
            disabled={loggingOut}
            data-testid="button-partner-logout"
            className="gap-2 text-xs border-[var(--cv-color-navy)]/30 text-[var(--cv-color-navy)] hover:bg-[rgba(4,30,65,0.05)]"
          >
            <LogOut className="h-3 w-3" />
            {loggingOut ? "Signing out…" : "Log out"}
          </Button>
        )}
      </div>
    </header>
  );
}

/* ============================================================
 * v25.48.2 MF7 (Q9) — member gate on the COMMON shell
 *
 * Previously ONLY /collective/dashboard was wrapped in <CollectiveMemberGate>
 * in App.tsx; every other member-only collective route (dealroom, members,
 * companies, soft-circles, DSC pages, recaps, calendar, ma-intel, …) mounted
 * its page and fired its member-only queries for a signed-in NON-member,
 * spraying 403s. Gating on the shared shell means membership resolves BEFORE
 * any member-only page mounts, for ALL of them, in one place.
 *
 * EXEMPT (intentionally reachable by a signed-in non-member):
 *   - /collective/partner/*        — the consortium PARTNER workspace. A
 *                                    partner-only user is NOT a collective
 *                                    member; gating these would wrongly wall
 *                                    them off from their own workspace.
 *   - /collective/membership*      — the apply/checkout + membership summary
 *                                    surface (how a non-member joins).
 *   - /syndicate/apply,
 *     /collective/syndicate/apply  — public apply surface.
 *
 * v25.48.2 MF-C — /collective/profile/:userId is NO LONGER exempt. The public
 * profile page (PublicProfile.tsx) resolves the member from the member-only
 * directory endpoint GET /api/collective/members (requireCollectiveMember), so
 * exempting it let a non-member mount the page and fire that member-only call —
 * the exact Q9 behavior the gate exists to prevent. There is no public,
 * non-member-safe profile endpoint, so the profile is treated as member-only:
 * a non-member now gets the marketing/apply gate instead.
 * ============================================================ */
function isMemberGateExempt(path: string): boolean {
  return (
    path.startsWith("/collective/partner") ||
    path.startsWith("/collective/membership") ||
    path === "/syndicate/apply" ||
    path.startsWith("/collective/syndicate/apply")
  );
}

/* ============================================================
 * CollectiveShell — main layout
 * ============================================================ */

interface CollectiveShellProps {
  children: ReactNode;
}

export function CollectiveShell({ children }: CollectiveShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  /* v25.31 Wave B — set data-product="collective" or "partner" on the shell
     so capavate.com design tokens defined in index.css can be applied via
     scoped selectors WITHOUT touching any existing inline color or className.
     This is purely additive presentation — zero functionality change, zero
     route change, zero auth-wrapper change. Capavate routes never receive
     this attribute (they go through AppShell, not CollectiveShell). */
  const [location] = useLocation();
  const product: "partner" | "collective" = location.startsWith("/collective/partner")
    ? "partner"
    : "collective";

  return (
    <div data-product={product} className="flex h-screen overflow-hidden bg-white">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col h-full">
        <CollectiveSidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 w-56 h-full">
            <CollectiveSidebar onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
        <CollectiveTopbar onMenuClick={() => setMobileOpen(true)} />
        {/* v25.43 R3-4 — persistent live ticker strip, always visible across the
            Collective + Consortium Partner shells, immediately under the top
            app header. */}
        <MarketTicker />
        <main className="flex-1 overflow-auto bg-[var(--cv-color-bg)]">
          {isMemberGateExempt(location)
            ? children
            : <CollectiveMemberGate>{children}</CollectiveMemberGate>}
        </main>
      </div>
    </div>
  );
}

export default CollectiveShell;
