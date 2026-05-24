import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Building2, PieChart, Briefcase, Users, FolderOpen, FileText,
  Activity, Settings, Send, Inbox, Target, UserCircle, MessageSquare, FileSignature,
  Sparkles, Bell, Search, Menu, X, ChevronDown, LogOut,
  ShieldCheck, Calculator, History, SlidersHorizontal, Building,
  GitCompareArrows, BarChart3, Mail, Network, DollarSign, RefreshCw, Database,
  Rss, HelpCircle, Globe,
} from "lucide-react";
import { CapavateLogo } from "./CapavateLogo";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { useLegalDrawer } from "@/lib/legalDrawer";
import { useRole, Role } from "@/lib/role";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { CapCollectiveToggle } from "./CapCollectiveToggle";
import { NotificationBell } from "./NotificationBell";
import { useEntitlement } from "@/lib/entitlement";
import { SPRINT_BANNER } from "@/lib/sprint-banner";

/** Role-aware glossary link rendered in the page header. */
function GlossaryLink() {
  const { role } = useRole();
  const href = role === "investor" ? "/investor/glossary" : "/founder/glossary";
  return (
    <Link href={href}>
      <button
        aria-label="Open glossary"
        title="Open glossary"
        className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        data-testid="button-open-glossary"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
    </Link>
  );
}

/** Avatar initials derived from identity.name in entitlement context. */
function AvatarInitials() {
  const { role } = useRole();
  const { data: entCtx } = useEntitlement();
  const name = entCtx?.identity?.name ?? (role === "admin" ? "Admin" : "—");
  const parts = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0]?.[0] ?? "?").toUpperCase();
  return <>{initials}</>;
}

function AdminChip() {
  const { role } = useRole();
  if (role !== "admin") return null;
  return (
    <Badge className="hidden md:inline-flex bg-[hsl(327_77%_30%)] text-white border-0 text-[10px] ml-1" data-testid="badge-admin-mode">
      Admin mode
    </Badge>
  );
}

type NavItem = { href: string; label: string; icon: typeof Inbox; badge?: string | number };
type NavGroup = { title: string; items: NavItem[] };

/** Sprint 19 K — Live badge counts from queries. Returns static nav with live badge overrides. */
function useFounderNav(): NavGroup[] {
  const roundsQ = useQuery<unknown[]>({ queryKey: ["/api/rounds"], retry: false });
  const roundCount = (roundsQ.data?.length ?? 0) || undefined;
  return [
    {
      title: "Workspace",
      items: [
        { href: "/founder/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/founder/company", label: "Company Profile", icon: Building2 },
        { href: "/founder/captable", label: "Cap Table", icon: PieChart },
      ],
    },
    {
      title: "Fundraising",
      items: [
        { href: "/founder/rounds", label: "Rounds", icon: Briefcase, badge: roundCount },
        { href: "/founder/crm", label: "Investor CRM", icon: Users },
        { href: "/founder/dataroom", label: "Dataroom", icon: FolderOpen },
        { href: "/founder/reports", label: "Investor Reports", icon: FileText },
      ],
    },
    {
      title: "Your Network",
      items: [
        { href: "/founder/messages", label: "Messages", icon: MessageSquare },
        { href: "/founder/network-posts", label: "Network Posts", icon: Rss },
      ],
    },
    {
      title: "Account",
      items: [
        { href: "/founder/activity", label: "Activity Log", icon: Activity },
        { href: "/founder/settings", label: "Settings", icon: Settings },
        { href: "/founder/billing", label: "Billing", icon: DollarSign },
        { href: "/founder/collective", label: "Capavate Collective", icon: Sparkles },
        { href: "/founder/apply-to-collective", label: "Apply to Collective", icon: FileSignature },
      ],
    },
  ];
}

function useInvestorNav(): NavGroup[] {
  const invitationsQ = useQuery<unknown[]>({ queryKey: ["/api/investor/invitations"], retry: false });
  const inviteCount = (invitationsQ.data?.filter((i: any) => i.state === "pending").length ?? 0) || undefined;
  return [
    {
      title: "Workspace",
      items: [
        { href: "/investor/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/investor/invitations", label: "Invitations", icon: Inbox, badge: inviteCount },
        { href: "/investor/portfolio", label: "Portfolio", icon: Target },
      ],
    },
    {
      title: "Network",
      items: [
        { href: "/investor/crm", label: "CRM", icon: Users },
        { href: "/investor/profile", label: "Investor Profile", icon: UserCircle },
      ],
    },
    {
      title: "Your Social",
      items: [
        { href: "/investor/messages", label: "Messages", icon: MessageSquare },
        { href: "/investor/network-posts", label: "Network Posts", icon: Rss },
      ],
    },
    {
      title: "Account",
      items: [
        // Sprint 21 Wave G — "Capavate Collective" removed; /investor/collective redirects to apply-to-collective.
        { href: "/investor/apply-to-collective", label: "Apply to Collective", icon: FileSignature },
      ],
    },
  ];
}

const adminNav: NavGroup[] = [
  {
    title: "Operations",
    items: [
      { href: "/admin/dashboard", label: "Admin Dashboard", icon: LayoutDashboard },
      { href: "/admin/companies", label: "Companies", icon: Building },
      { href: "/admin/investors", label: "Investors", icon: Users },
      { href: "/admin/users", label: "Users & Auth", icon: ShieldCheck },
    ],
  },
  {
    title: "Engine",
    items: [
      { href: "/admin/formulas", label: "Formula Registry", icon: Calculator },
      { href: "/admin/regions", label: "Regions", icon: Globe },
      { href: "/admin/lifecycle-policies", label: "Lifecycle Policies", icon: SlidersHorizontal },
      { href: "/admin/reconciliation", label: "Reconciliation", icon: GitCompareArrows },
      { href: "/admin/telemetry", label: "Telemetry", icon: BarChart3 },
      { href: "/admin/audit-log", label: "Audit Log", icon: History },
      /* 23-May Fix 1 — surface v19 Phase C audit-chain verifier in sidebar. */
      { href: "/admin/audit-chain-verify", label: "Audit Chain Verify", icon: ShieldCheck },
      /* 23-May Fix 1 — surface CP-B consortium-application review queue. */
      { href: "/admin/consortium-applications", label: "Consortium Applications", icon: FileSignature },
    ],
  },
  {
    title: "Bridge & Comms",
    items: [
      { href: "/admin/bridge", label: "Bridge & Outbox", icon: Network },
      { href: "/admin/sync", label: "Sync Status", icon: RefreshCw },
      { href: "/admin/migration", label: "Migration", icon: Database },
      { href: "/admin/email", label: "Email System", icon: Mail },
      { href: "/admin/notifications", label: "Notifications", icon: Bell },
      { href: "/admin/pricing", label: "Pricing & Billing", icon: DollarSign },
    ],
  },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const { role } = useRole();
  const founderNav = useFounderNav();
  const investorNav = useInvestorNav();
  const groups = role === "admin" ? adminNav : role === "founder" ? founderNav : investorNav;
  const { openDrawer } = useLegalDrawer();
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 flex flex-col" data-testid="sidebar-nav">
      <div className="flex-1 space-y-6">
      {groups.map(g => (
        <div key={g.title}>
          <div className="px-2 mb-2 text-[11px] uppercase tracking-wider font-semibold text-sidebar-foreground/60">
            {g.title}
          </div>
          <ul className="space-y-1">
            {g.items.map(item => {
              const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    data-testid={`link-nav-${item.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm"
                        : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.badge && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        active ? "bg-white/25 text-white" : "bg-sidebar-accent text-sidebar-accent-foreground"
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      </div>
      {/* Legal & Privacy link at bottom of all sidebars */}
      <div className="pt-2 border-t border-sidebar-border/50 shrink-0">
        <button
          type="button"
          onClick={() => { openDrawer(); if (onNavigate) onNavigate(); }}
          data-testid="button-legal-privacy"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm w-full transition-colors text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span>Legal &amp; Privacy</span>
        </button>
      </div>
    </nav>
  );
}

function RoleSwitch() {
  const { role, setRole } = useRole();
  const [, navigate] = useLocation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid="button-role-switch"
          className="text-white/90 hover:text-white hover:bg-white/10 gap-2 h-8"
        >
          <span className="text-[11px] uppercase tracking-wider opacity-70">Role</span>
          <span className="font-medium capitalize">{role}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Switch persona (demo)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(["founder", "investor"] as Role[]).map(r => (
          <DropdownMenuItem
            key={r}
            data-testid={`menuitem-role-${r}`}
            onSelect={() => {
              setRole(r);
              navigate(`/${r}/dashboard`);
            }}
            data-role={r}
            className={role === r ? "font-semibold" : ""}
          >
            <span className="capitalize">{r}</span>
            {role === r && <Badge variant="secondary" className="ml-auto text-[10px]">Active</Badge>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** User menu label — derives name and email from entitlement context. */
function UserMenuLabel() {
  const { data: entCtx } = useEntitlement();
  const { role } = useRole();
  const name = entCtx?.identity?.name ?? (role === "admin" ? "Admin" : "—");
  const email = entCtx?.identity?.email ?? (role === "admin" ? "admin@capavate.com" : "");
  return (
    <DropdownMenuLabel>
      <div className="text-sm font-medium" data-testid="text-user-name">{name}</div>
      <div className="text-xs text-muted-foreground">{email || "—"}</div>
    </DropdownMenuLabel>
  );
}

/** Sprint 11 — only render the company switcher when user is in founder role. */
function FounderCompanySwitcherSlot() {
  const { role } = useRole();
  if (role !== "founder") return null;
  return <CompanySwitcher />;
}

function Header({ onMobileMenu }: { onMobileMenu: () => void }) {
  // Sprint 11: light-only — theme toggle removed.
  const [, navigate] = useLocation();
  const { role } = useRole();

  return (
    <header className="sticky top-0 z-40 h-14 bg-[hsl(219_45%_20%)] border-b border-[hsl(219_40%_28%)] flex items-center px-4 gap-3" data-testid="header-app">
      <button onClick={onMobileMenu} className="md:hidden p-2 -ml-2 rounded text-white/90 hover:bg-white/10" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      <Link href="/" className="flex items-center gap-2 text-white" data-testid="link-home">
        <span className="flex items-center bg-white rounded-md px-2 py-1 shadow-sm">
          <CapavateLogo className="h-6 w-auto" />
        </span>
        {import.meta.env.DEV && (
    <Badge className="hidden md:inline-flex bg-white/15 text-white/90 border-0 text-[10px] ml-1" data-testid="badge-sprint">{SPRINT_BANNER}</Badge>
  )}
        <AdminChip />
      </Link>

      <div className="flex-1" />

      <div className="hidden md:flex items-center gap-2 text-white/80 text-xs px-3 py-1.5 rounded-md bg-white/5 border border-white/10 max-w-xs flex-1">
        <Search className="h-3.5 w-3.5" />
        <input
          placeholder="Search rounds, investors, files…"
          className="bg-transparent outline-none flex-1 placeholder:text-white/40 text-white"
          data-testid="input-search"
        />
        <span className="text-[10px] opacity-50 px-1 rounded border border-white/15">⌘K</span>
      </div>

      <FounderCompanySwitcherSlot />
      <CapCollectiveToggle />
      <RoleSwitch />

      <NotificationBell />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button data-testid="button-user-menu" className="rounded-full hover:ring-2 hover:ring-white/20">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-[hsl(184_98%_22%)] text-white text-xs font-semibold" data-testid="avatar-user-initials">
              <AvatarInitials />
            </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <UserMenuLabel />
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate(role === "investor" ? "/investor/settings" : "/founder/settings")}>
            <Settings className="h-4 w-4 mr-2" /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate("/login")}>
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();
  const { role, setRole } = useRole();
  // Auto-sync role from URL prefix when user navigates directly to a /founder or /investor route
  useEffect(() => {
    if (location.startsWith("/founder") && role !== "founder") setRole("founder");
    else if (location.startsWith("/investor") && role !== "investor") setRole("investor");
    else if (location.startsWith("/admin") && role !== "admin") setRole("admin");
  }, [location, role, setRole]);
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header onMobileMenu={() => setMobileOpen(true)} />
      <div className="flex flex-1 min-h-0">
        <aside className="hidden md:flex w-64 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex-col">
          <SidebarContent />
          <div className="px-3 pb-4 pt-2 border-t border-sidebar-border text-[10px] text-sidebar-foreground/50">
            v0.27.0 — Capavate (admin separation)
          </div>
        </aside>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="bg-sidebar text-sidebar-foreground p-0 w-72 border-sidebar-border">
            <div className="h-14 flex items-center px-4 gap-2 border-b border-sidebar-border">
              <span className="flex items-center bg-white rounded-md px-2 py-1 shadow-sm">
                <CapavateLogo className="h-5 w-auto" />
              </span>
              <button onClick={() => setMobileOpen(false)} className="ml-auto p-1.5 text-white/80 hover:bg-white/10 rounded">
                <X className="h-4 w-4" />
              </button>
            </div>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <main className="flex-1 min-w-0 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Page header used inside <main> for consistent page titles */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  size = "default",
  sticky = false,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: { href?: string; label: string }[];
  size?: "default" | "large";
  sticky?: boolean;
}) {
  return (
    <div className={`border-b border-border bg-card/50 ${sticky ? "sticky top-0 z-30 backdrop-blur-sm bg-card/95" : ""}`}>
      <div className="px-6 py-5 max-w-[1400px] mx-auto">
        {breadcrumbs && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {b.href ? (
                  <Link href={b.href} className="hover:text-foreground">{b.label}</Link>
                ) : (
                  <span>{b.label}</span>
                )}
                {i < breadcrumbs.length - 1 && <span className="text-muted-foreground/50">/</span>}
              </span>
            ))}
          </div>
        )}
        {/* Title row spans full width — description never gets squeezed by the actions column. */}
        <div className="min-w-0">
          <h1
            className={`${size === "large" ? "text-2xl md:text-3xl" : "text-xl"} font-semibold tracking-tight leading-tight`}
            data-testid="text-page-title"
          >
            {title}
          </h1>
          {description && <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>}
        </div>
        {/* Actions row — below the title block, full width, wraps freely. */}
        {(actions || true) && (
          <div className="flex items-center gap-2 flex-wrap mt-3">
            {actions}
            <GlossaryLink />
          </div>
        )}
      </div>
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="px-6 py-6 max-w-[1400px] mx-auto">{children}</div>;
}
