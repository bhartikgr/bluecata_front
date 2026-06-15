/**
 * Wave C-3 — Collective Shell
 *
 * Standalone shell with its own sidebar + topbar for the Collective experience.
 * Visual identity: plum #8E2A4E accent, cream #F7F6F2 background, navy text.
 * Light-mode only. No web storage.
 */

import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Briefcase, Users, Building2, Circle, BarChart3,
  TrendingUp, ClipboardList, UserCircle, Activity, Settings, Menu, X,
  ArrowLeftRight, LogOut, Scale, UserPlus, FileText, ListTodo, FolderOpen,
  PiggyBank, CalendarDays, Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useLegalDrawer } from "@/lib/legalDrawer";
import { useRole } from "@/lib/role";
import { usePartnerMembership } from "@/lib/partner/usePartnerMembership";
import { useQuery } from "@tanstack/react-query"; /* v16 Fix 6 — read COLLECTIVE_ENABLED */
import { apiRequest } from "@/lib/queryClient"; /* v16 Fix 6 */
import { ChapterSelector } from "@/components/ChapterSelector"; /* v17 Phase A — chapter scope dropdown in topbar */

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
  /* v19 Phase A — Events Calendar + Leaderboard. Placed in their own
   * group so they get dedicated visibility without disrupting existing
   * nav ordering. */
  {
    title: "CHAPTER LIFE",
    items: [
      { href: "/collective/calendar", label: "Calendar", icon: CalendarDays, "data-testid": "nav-collective-calendar" },
      { href: "/collective/leaderboard", label: "Leaderboard", icon: Trophy, "data-testid": "nav-collective-leaderboard" },
    ],
  },
  {
    title: "YOUR ACCOUNT",
    items: [
      { href: "/collective/membership", label: "My Membership", icon: UserCircle, "data-testid": "nav-collective-membership" },
      { href: "/collective/activity", label: "Activity", icon: Activity, "data-testid": "nav-collective-activity" },
      { href: "/collective/settings", label: "Settings", icon: Settings, "data-testid": "nav-collective-settings" },
    ],
  },
];

// Partner-only nav group, added dynamically in CollectiveSidebar when the
// session has an active partner membership.
const PARTNER_WORKSPACE_GROUP: NavGroup = {
  title: "PARTNER WORKSPACE",
  items: [
    { href: "/collective/partner/dashboard", label: "Dashboard", icon: LayoutDashboard, "data-testid": "nav-partner-dashboard" },
    { href: "/collective/partner/clients", label: "Clients", icon: Users, "data-testid": "nav-partner-clients" },
    { href: "/collective/partner/pipeline", label: "Pipeline", icon: Briefcase, "data-testid": "nav-partner-pipeline" },
    { href: "/collective/partner/team", label: "Team", icon: UserPlus, "data-testid": "nav-partner-team" },
    { href: "/collective/partner/notes", label: "Notes", icon: FileText, "data-testid": "nav-partner-notes" },
    { href: "/collective/partner/tasks", label: "Tasks", icon: ListTodo, "data-testid": "nav-partner-tasks" },
    { href: "/collective/partner/files", label: "Files", icon: FolderOpen, "data-testid": "nav-partner-files" },
    { href: "/collective/partner/spvs", label: "SPVs", icon: Building2, "data-testid": "nav-partner-spvs" },
    { href: "/collective/partner/funds", label: "Funds", icon: PiggyBank, "data-testid": "nav-partner-funds" },
    { href: "/collective/partner/settings", label: "Settings", icon: Settings, "data-testid": "nav-partner-settings" },
  ],
};

/* ============================================================
 * Sidebar nav item
 * ============================================================ */

function NavLink({ item }: { item: NavItem }) {
  const [location] = useLocation();
  const isActive =
    location === item.href ||
    (item.href !== "/collective/dashboard" && location.startsWith(item.href));

  return (
    <Link href={item.href}>
      <button
        data-testid={item["data-testid"]}
        className={[
          "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
          isActive
            ? "bg-[#8E2A4E]/15 text-[#8E2A4E]"
            : "text-slate-700 hover:bg-[#8E2A4E]/08 hover:text-[#8E2A4E]",
        ].join(" ")}
        style={{ textDecoration: "none" }}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span>{item.label}</span>
      </button>
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
  const groups: NavGroup[] = partner.isPartner
    ? [...baseGroups, PARTNER_WORKSPACE_GROUP]
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
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: "#8E2A4E" }}
          >
            C
          </div>
          <div>
            <span className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
              Capavate
            </span>
            <span
              className="text-xs font-medium ml-1 px-1.5 py-0.5 rounded"
              style={{ backgroundColor: "#8E2A4E", color: "#fff", fontSize: "9px" }}
            >
              COLLECTIVE
            </span>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden p-1 rounded hover:bg-black/05"
            data-testid="button-close-sidebar"
          >
            <X className="h-4 w-4 text-slate-600" />
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
                style={{ color: "#8E2A4E", opacity: 0.7 }}
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
          className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700 transition-colors w-full"
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
          className="md:hidden p-2 rounded hover:bg-slate-100"
          data-testid="button-mobile-menu"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5 text-slate-700" />
        </button>

        <div
          className="text-sm font-medium hidden md:block"
          style={{ color: "#1A1A2E" }}
        >
          Capavate Collective
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* v17 Phase A — chapter selector. Renders null when COLLECTIVE_ENABLED!=1
            or when the user has zero chapter memberships, so the topbar layout
            matches the v16 Friday baseline by default. */}
        <ChapterSelector data-testid="topbar-chapter-selector" />
        <Button
          variant="outline"
          size="sm"
          onClick={switchToCapavate}
          data-testid="button-switch-to-capavate"
          className="gap-2 text-xs border-[#8E2A4E]/30 text-[#8E2A4E] hover:bg-[#8E2A4E]/05"
        >
          <ArrowLeftRight className="h-3 w-3" />
          Switch to Capavate
        </Button>
      </div>
    </header>
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

  return (
    <div className="flex h-screen overflow-hidden bg-white">
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
        <main className="flex-1 overflow-auto bg-[#FAFAF8]">
          {children}
        </main>
      </div>
    </div>
  );
}

export default CollectiveShell;
