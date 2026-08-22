import { ReactNode, useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useActiveCompany } from "@/lib/useActiveCompany";
import {
  LayoutDashboard, Building2, PieChart, Briefcase, Users, FolderOpen, FileText,
  Activity, Settings, Send, Inbox, Target, UserCircle, MessageSquare, FileSignature,
  Sparkles, Bell, Search, Menu, X, ChevronDown, LogOut,
  ShieldCheck, Calculator, History, SlidersHorizontal, Building,
  GitCompareArrows, BarChart3, Mail, Network, DollarSign, RefreshCw, Database, Handshake,
  Rss, HelpCircle, Globe, CreditCard, Plug, Tags,
} from "lucide-react";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
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
import { safeInitials } from "@/lib/investorLabels";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArchivedWorkspaceBanner } from "./ArchivedWorkspaceBanner";
import { AuditChainP0Banner } from "./AuditChainP0Banner";

/** Role-aware glossary link rendered in the page header. */
function GlossaryLink() {
  const { role } = useRole();
  const href = role === "investor" ? "/investor/glossary" : "/founder/glossary";
  return (
    <Link
      href={href}
      aria-label="Open glossary"
      title="Open glossary"
      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      data-testid="button-open-glossary"
    >
      <HelpCircle className="h-4 w-4" />
    </Link>
  );
}

/** Avatar initials derived from identity.name in entitlement context. */
function AvatarInitials() {
  const { role } = useRole();
  const { data: entCtx } = useEntitlement();
  const name = entCtx?.identity?.name ?? (role === "admin" ? "Admin" : "");
  // BUG-02: never derive initials from an email local-part or a placeholder
  // name. When no safe initials exist, fall back to a neutral avatar glyph.
  const initials = safeInitials(name);
  if (!initials) return <UserCircle className="h-4 w-4" />;
  return <>{initials}</>;
}

function AdminChip() {
  const { role } = useRole();
  if (role !== "admin") return null;
  return (
    <Badge className="hidden md:inline-flex bg-[hsl(0_100%_40%)] text-white border-0 text-[10px] ml-1" data-testid="badge-admin-mode">
      Admin mode
    </Badge>
  );
}

type NavItem = { href: string; label: string; icon: typeof Inbox; badge?: string | number; testId?: string };
type NavGroup = { title: string; items: NavItem[] };

/** Sprint 19 K — Live badge counts from queries. Returns static nav with live badge overrides. */
function useFounderNav(): NavGroup[] {
  // BUG 032 fix v23.7 — the Rounds badge used GET /api/rounds, which returns
  // rounds across ALL of a founder's companies, so the count never changed when
  // the active company switched. Use the per-company KPI from the active-company
  // endpoint instead so the badge reflects only the selected company's rounds.
  const activeCompanyQ = useActiveCompany();
  const roundCount = activeCompanyQ.data?.company?.kpi?.activeRoundsCount || undefined;
  return [
    {
      title: "Workspace",
      items: [
        { href: "/founder/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/founder/company", label: "Company Profile", icon: Building2 },
        // v25.45 F8b — new left-nav item directly below Company Profile. Parent
        // landing page hosting the Team sub-tab (Team moved out of Settings).
        { href: "/founder/company-management", label: "Company Management", icon: Users, testId: "nav-company-management" },
        { href: "/founder/captable", label: "Cap Table", icon: PieChart },
        /* WAVE 92 — THE ENTRY POINT FOR THE EXIT WATERFALL (pre-flight `OQ-W-8`).
           `GET /api/founder/captable/waterfall` had ZERO client callers, so the
           corrected exit maths of Waves 88, 91 and 94 was unreachable through the
           product: a founder could type liquidation-preference terms into the round
           wizard, be told those terms feed the exit waterfall, and then find
           nowhere in Capavate to see one.

           APPENDED AT THE END of this group, never inserted at the head — an
           ordinal insertion shifts every following item and is how this project has
           previously tripped the drop detector (R82). It sits directly after Cap
           Table because that is the screen whose share counts are this
           calculation's inputs.

           The nav item was chosen over a link inside `founder/CapTable.tsx`
           deliberately: `CapTable.tsx` is one of the seven files the
           `drop:restyle` detector already flags as owner-hand-edited, and the nav
           item touches one line in a file the owner has not hand-edited. */
        { href: "/founder/captable/waterfall", label: "Exit Waterfall", icon: DollarSign, testId: "nav-exit-waterfall" },
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
        /* WAVE 8 / ORP-027 (DEF-027) — Billing left-nav item RESTORED.
           v25.45 F10c removed it on the belief that Settings → Billing &
           Subscription was "the full Billing surface". Verified against this
           tree: it is not. founder/Billing.tsx is the ONLY caller of
           PATCH /api/founder/subscription/payment-method,
           POST /api/founder/invoices/:invoiceId/email,
           PATCH /api/founder/subscription (cancel_at_period_end) and
           POST /api/founder/subscription/resume — none of which appear anywhere
           in founder/Settings.tsx. Removing the nav item and redirecting the
           route silently dropped change-payment-method, email-invoice, cancel
           and resume from the product. The nav item is the SINK for
           reachability: without it the page has no entry point.
           Placed here (not inside the Settings tab strip) deliberately, so no
           existing tab fingerprint or copy string is disturbed. */
        { href: "/founder/billing", label: "Billing", icon: CreditCard, testId: "nav-founder-billing" },
        { href: "/founder/collective", label: "Capavate Collective", icon: Sparkles },
        { href: "/founder/apply-to-collective", label: "Apply to Collective", icon: FileSignature },
      ],
    },
  ];
}

function useInvestorNav(): NavGroup[] {
  const invitationsQ = useQuery<unknown[]>({ queryKey: ["/api/investor/invitations"], retry: false });
  const inviteCount = (invitationsQ.data?.filter((i: any) => i.state === "pending").length ?? 0) || undefined;
  // v25.49.1 — grouped, categorized reorder. Every existing route + the
  // Invitations badge preserved (Rule #78). Three shipped-but-unlinked pages
  // (Settings, Notifications, Glossary) added to ACCOUNT so they're discoverable
  // in the left nav; their existing top-bar entry points (user menu / bell /
  // PageHeader HelpCircle) remain intact. Investor Profile moved to ACCOUNT
  // (identity, not Network); Apply to Collective moved to DEALS (a deal action);
  // Messages/Posts/CRM clustered as NETWORK.
  return [
    {
      title: "Overview",
      items: [
        { href: "/investor/dashboard", label: "Dashboard", icon: LayoutDashboard },
      ],
    },
    {
      title: "Deals",
      items: [
        { href: "/investor/invitations", label: "Invitations", icon: Inbox, badge: inviteCount },
        { href: "/investor/portfolio", label: "Portfolio", icon: Target },
        /* WAVE 22 · ITEM 3 (REVIEW B F-1) — `/investor/earlier-investments`
         * (ClaimPositions, Wave 10 EN-3) was a ROUTED ORPHAN: zero inbound
         * links anywhere in the client tree, while its own route comment in
         * App.tsx claimed it was linked. By this project's rule
         * (WAVE7_REPORT.md:130) a page no user can reach is NOT shipped. It
         * belongs in DEALS next to Portfolio: the LP who needs it is the one
         * staring at an empty portfolio. A second inbound link is in the
         * portfolio empty state (PortfolioCompanySwitcher). */
        { href: "/investor/earlier-investments", label: "Earlier Investments", icon: History },
        // Sprint 21 Wave G — "Capavate Collective" removed; /investor/collective redirects to apply-to-collective.
        { href: "/investor/apply-to-collective", label: "Apply to Collective", icon: FileSignature },
      ],
    },
    {
      title: "Network",
      items: [
        { href: "/investor/messages", label: "Messages", icon: MessageSquare },
        { href: "/investor/network-posts", label: "Network Posts", icon: Rss },
        { href: "/investor/crm", label: "CRM", icon: Users },
      ],
    },
    {
      title: "Account",
      items: [
        { href: "/investor/profile", label: "Investor Profile", icon: UserCircle },
        { href: "/investor/settings", label: "Settings", icon: Settings },
        { href: "/investor/notifications", label: "Notifications", icon: Bell },
        { href: "/investor/glossary", label: "Glossary", icon: HelpCircle },
      ],
    },
  ];
}

/* v25.30 — Admin sidebar reorganized into 5 sections per Ozan's request.
 *
 *   1. General Settings   — platform-wide governance: Dashboard, Users & Auth,
 *                            Lifecycle Policies, Audit Log, Audit Chain Verify
 *   2. Capavate           — Capavate product surfaces: Companies, Investors,
 *                            Formula Registry, Regions, Reconciliation,
 *                            Telemetry, Pricing & Billing
 *   3. Collective         — Collective product surfaces: Applications, Waitlist,
 *                            Members, Settings
 *   4. Consortium Partners— Consortium Applications (review queue + partner
 *                            promotions). Standalone group per Ozan.
 *   5. Bridge & Comms     — Bridge & Outbox, Sync Status, Migration, Email,
 *                            Notifications
 *
 * Pure regrouping — every existing route still points at the same page and
 * keeps the same href/icon. No new routes, no removed routes. Verified by
 * GPT-5.5 against the current adminNav (22 entries; 22 here).
 */
const adminNav: NavGroup[] = [
  {
    title: "General Settings",
    items: [
      { href: "/admin/dashboard", label: "Admin Dashboard", icon: LayoutDashboard },
      { href: "/admin/users", label: "Users & Auth", icon: ShieldCheck },
      { href: "/admin/lifecycle-policies", label: "Lifecycle Policies", icon: SlidersHorizontal },
      { href: "/admin/audit-log", label: "Audit Log", icon: History },
      { href: "/admin/audit-chain-verify", label: "Audit Chain Verify", icon: ShieldCheck },
      /* WAVE 28 / CP-CRM-04 — CRM duplicate-contact review queue. */
      { href: "/admin/crm-dedup-review", label: "CRM Duplicate Review", icon: Users },
      /* W-V44 FIX K — market-data provider Integrations (DB-driven, admin-config). */
      { href: "/admin/integrations", label: "Integrations", icon: Plug },
    ],
  },
  {
    title: "Capavate",
    items: [
      /* D2.5 SLICE 1 — ONE fee entry point for the whole platform.
         Replaces 13 sidebar entries + 3 W-V44 hubs (see D25_ADMIN_FEE_AUDIT.md
         root cause 2: the hub consolidation was additive, so 12 entry points
         became 15). Every fee, every product line, every ledger lives behind
         this single link now, one tab per concern, with a source-of-truth
         panel next to every editable field. */
      { href: "/admin/fees", label: "Fees & Billing", icon: DollarSign, testId: "nav-admin-fees" },
      /* WAVE 7 R-1 — pricing-model administration RESTORED.
         /admin/fees does manage pricing models, but only for ONE product line
         (CAPAVATE_ANNUAL_PRODUCT_LINE, AdminFeesConsolidated.tsx:405) and only
         create/patch/promote. Clone, migrate-legacy, bootstrap-founder-tiers,
         price-preview, version history and the pricing-tier editor have had NO
         client caller anywhere since D2.5 — computed over the whole client
         tree, see build_log/wave7_r1_disposition.json. Those are capabilities,
         not URLs, so they are restored as pages rather than aliases.
         This does NOT reopen the "one fee entry point" ruling: fees still live
         only behind /admin/fees. Pricing MODELS are a different object. */
      { href: "/admin/pricing", label: "Pricing & Subscriptions", icon: DollarSign, testId: "nav-admin-pricing" },
      { href: "/admin/pricing-models", label: "Pricing Models", icon: DollarSign, testId: "nav-admin-pricing-models" },
      { href: "/admin/companies", label: "Companies", icon: Building },
      { href: "/admin/investors", label: "Investors", icon: Users },
      { href: "/admin/formulas", label: "Formula Registry", icon: Calculator },
      { href: "/admin/regions", label: "Regions", icon: Globe },
      { href: "/admin/reconciliation", label: "Reconciliation", icon: GitCompareArrows },
      { href: "/admin/telemetry", label: "Telemetry", icon: BarChart3 },
      /* D2.5 SLICE 1 — DELETED: /admin/payments and /admin/pricing.
         Both are tabs of /admin/fees now. */
    ],
  },
  {
    title: "Collective",
    items: [
      /* D2.5 SLICE 1 — DELETED: /admin/collective-fees hub. Collective fees
         are the "Collective Tiers" + "Application Fee" tabs of /admin/fees. */
      { href: "/admin/collective/applications", label: "Collective Applications", icon: Inbox },
      { href: "/admin/collective/waitlist", label: "Collective Waitlist", icon: History },
      { href: "/admin/collective/members", label: "Collective Members", icon: Users },
      { href: "/admin/collective/settings", label: "Collective Settings", icon: Settings },
      /* D2.5 SLICE 1 — DELETED: /admin/application-fee, /admin/platform-fees,
         /admin/collective-payment-pl, /admin/collective-subscriptions. All four
         are tabs/sections of /admin/fees. The duplicate application-fee editor
         is gone entirely: there is now exactly ONE editor for that fee, writing
         platform_fees['collective_application_fee'] in TRUE minor units.

         WAVE 4A (RS-1) — /admin/collective-payment-schedules is RESTORED as a
         DEEP LINK, not as a second page. The D2.5 fold dropped the standalone
         page without rebuilding its CRUD anywhere, so admins lost the ability
         to create/edit/expire a Collective fee schedule entirely. The
         capability now lives in the "Fee Schedules" tab of /admin/fees and this
         entry routes there (App.tsx aliases the URL onto that tab). One
         implementation, one page — the consolidation is finished, not undone. */
      { href: "/admin/collective-payment-schedules", label: "Collective Payment Schedules", icon: DollarSign, testId: "nav-admin-collective-payment-schedules" },
      /* WAVE 7 R-1 — /admin/collective-subscriptions is RESTORED as a real
         page, not a deep link. Unlike RS-1's fee schedules, the capability it
         carries is absent from /admin/fees entirely: promote, clone,
         bootstrap-from-env and the Airwallex price-ref editor are called from
         NO other file in client/src (computed — see
         build_log/wave7_r1_disposition.json). There is no tab to deep-link to.

         The /admin/application-fee and /admin/platform-fees entries stay
         DELETED: their editor was removed deliberately for unit-correctness,
         and the "exactly ONE editor" statement above still holds. */
      { href: "/admin/collective-subscriptions", label: "Collective Subscriptions", icon: DollarSign, testId: "nav-admin-collective-subscriptions" },
    ],
  },
  {
    title: "Consortium Partners",
    items: [
      /* D2.5 SLICE 1 — DELETED: /admin/partner-fees-hub. Partner fees are the
         "Consortium Partner Promotions" tab of /admin/fees. */
      { href: "/admin/consortium-applications", label: "Consortium Applications", icon: FileSignature },
      /* v25.33 Consortium Partner Payment Model — admin surfaces for partner roster,
         fee catalogue, and partner P&L (all DB-driven via /api/admin/*). */
      { href: "/admin/partners", label: "Partners", icon: Users },
      /* WAVE 4B (PT-2) — admin CRUD for the `Sector // Sub-sector` lookup
         tables, so a type can be added or retired without a migration.
         This entry is IDENTICAL for every admin; the classification a
         partner holds never adds, removes or reorders a nav item. */
      { href: "/admin/partner-taxonomy", label: "Partner Taxonomy", icon: Tags, testId: "nav-admin-partner-taxonomy" },
      /* WAVE 7 R-1 — /admin/commission-rates RESTORED. /admin/fees READS the
         commission rates but its own copy (AdminFeesConsolidated.tsx:1140)
         says the editor "lands with the partner-override component" — i.e. the
         PUT was never rebuilt there. PUT /api/admin/partner/commission-rates/
         :tier has had no client caller since D2.5, so partner commission rates
         have been UNEDITABLE. This page is that editor and is unchanged. */
      { href: "/admin/commission-rates", label: "Partner Commission Rates", icon: DollarSign, testId: "nav-admin-commission-rates" },
      /* D2.5 SLICE 1 — DELETED: /admin/partner-pl. It is a section of the
         /admin/fees "Ledger & Invoices" tab, and WAVE 7 R-1 re-confirmed that
         computationally: every endpoint PartnerPL.tsx calls is reachable from a
         still-routed page.

         (This note used to name /admin/commission-rates too. WAVE 7 R-1
         restored that one — see the entry directly above — because the fold
         kept its READ and dropped its WRITE. The claim that it is "a section
         of" the Promotions tab was true of the table, not of the editor.)

         WAVE 4A (RS-2) — /admin/partner-fees is RESTORED as a DEEP LINK. The
         fold kept the READ (the schedule-row count on the Promotions tab) and
         dropped the WRITES; POST/PATCH/DELETE /api/admin/partner-fees had no
         caller in any routed page. The writes now live in the "Fee Schedules"
         tab of /admin/fees and this entry routes there. */
      { href: "/admin/partner-fees", label: "Partner Fees", icon: DollarSign, testId: "nav-admin-partner-fees" },
      /* W6 — Ask-an-Expert partner-responder registry. */
      { href: "/admin/partner-responders", label: "Partner Responders", icon: Handshake },
      /* WAVE 14 — /admin/partner-billing-ops. NOT a duplicate of /admin/fees:
         that page reads the partner PROMOTIONS table and the commission rates,
         and has no surface at all for `partner_tier_price`,
         `partner_promotion` moderation, the roster reconciliation, or the
         build's open pricing decisions. Verified by grep before adding this
         entry — every endpoint this page calls was registered in Wave 14 and has
         no other client caller, so nothing here shadows an existing screen. */
      { href: "/admin/partner-billing-ops", label: "Partner Billing Ops", icon: DollarSign, testId: "nav-admin-partner-billing-ops" },
    ],
  },
  {
    title: "Bridge & Comms",
    items: [
      { href: "/admin/bridge", label: "Bridge & Outbox", icon: Network },
      /* v25.31 Wave A #13 — surface the v25.0 Track 5 E8 Bridge History page
         which was registered at /admin/bridge-history but never linked. */
      { href: "/admin/bridge-history", label: "Bridge History", icon: History },
      { href: "/admin/sync", label: "Sync Status", icon: RefreshCw },
      /* WAVE 15 — the live route inventory, the DDL column rulings, the audit
         incident record and the bridge-mode disclosure. Linked, not merely
         registered: a page reachable only by typing its URL is not in the UI. */
      { href: "/admin/platform-surfaces", label: "Platform Surfaces", icon: ShieldCheck, testId: "nav-admin-platform-surfaces" },
      { href: "/admin/migration", label: "Migration", icon: Database },
      { href: "/admin/email", label: "Email System", icon: Mail },
      { href: "/admin/notifications", label: "Notifications", icon: Bell },
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
                    data-testid={item.testId ?? `link-nav-${item.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
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
  // BUG-002 fix: Only show roles the user actually has membership in.
  // Read from /api/auth/me to determine available roles.
  const { data: entCtx } = useEntitlement();

  // Derive which roles this user actually has.
  const availableRoles = useCallback((): Role[] => {
    if (!entCtx) return [role]; // fallback to current role while loading
    const roles: Role[] = [];
    if (entCtx.isAdmin) roles.push("admin");
    if ((entCtx.founder?.companies?.length ?? 0) > 0) roles.push("founder");
    if (entCtx.investor?.state && entCtx.investor.state !== "NONE") roles.push("investor");
    // Always include the current role so the switcher is never empty
    if (roles.length === 0) roles.push(role);
    return roles;
  }, [entCtx, role]);

  const roles = availableRoles();
  // Only render if user has more than one role (otherwise no switching needed)
  if (roles.length <= 1 && !entCtx?.isAdmin) return null;

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
        <DropdownMenuLabel>Switch role</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {roles.map(r => (
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

/**
 * v25.45.4 H-2 — Global search. Replaces the previously DEAD header input (no
 * state, no onSubmit) with a controlled box wired to GET /api/founder/search.
 * Founder-scoped (the endpoint scopes to owned companies); shows a results
 * dropdown with rounds / contacts / files, an empty-state when nothing matches,
 * and navigates to the hit's href on click. Debounced; min 2 chars.
 *
 * W-AVI65 FIX 3 — role-aware endpoint. /api/founder/search scopes to
 * getCompaniesForFounder(userId), which is EMPTY for an admin, so an admin
 * searching any real company label always got "No matches". Admins now hit
 * /api/admin/search (requireAdmin, platform-wide union of companies + invited
 * investors + partners + collective members). isAdmin comes from
 * useEntitlement() → /api/auth/me (authoritative), NOT useRole(), which is
 * local UI state that defaults to "founder". Both endpoints return the same
 * results[] { kind, id, title, subtitle, href } shape, so the render is shared.
 */
function GlobalSearch() {
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const { data: entCtx } = useEntitlement();
  const isAdmin = entCtx?.isAdmin === true;
  const searchPath = isAdmin ? "/api/admin/search" : "/api/founder/search";

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const enabled = debounced.length >= 2;
  const searchQ = useQuery<{ ok: boolean; results: Array<{ kind: string; id: string; title: string; subtitle: string; href: string }> }>({
    queryKey: [searchPath, debounced],
    queryFn: async () => (await apiRequest("GET", `${searchPath}?q=${encodeURIComponent(debounced)}`)).json(),
    enabled,
  });
  const results = enabled ? (searchQ.data?.results ?? []) : [];

  return (
    <div className="relative hidden md:flex max-w-xs flex-1" data-testid="global-search">
      <div className="flex items-center gap-2 text-white/80 text-xs px-3 py-1.5 rounded-md bg-white/5 border border-white/10 w-full">
        <Search className="h-3.5 w-3.5" />
        <input
          placeholder="Search rounds, investors, files…"
          className="bg-transparent outline-none flex-1 placeholder:text-white/40 text-white"
          data-testid="input-search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results.length > 0) {
              navigate(results[0].href);
              setOpen(false);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <span className="text-[10px] opacity-50 px-1 rounded border border-white/15">⌘K</span>
      </div>
      {open && enabled && (
        <div
          className="absolute top-full left-0 mt-1 w-80 max-h-96 overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg z-50"
          data-testid="search-results"
        >
          {searchQ.isPending ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground" data-testid="search-empty">
              No matches for “{debounced}”.
            </div>
          ) : (
            <ul className="py-1">
              {results.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-muted flex flex-col"
                    data-testid={`search-hit-${r.kind}-${r.id}`}
                    onMouseDown={(e) => { e.preventDefault(); navigate(r.href); setOpen(false); }}
                  >
                    <span className="text-sm font-medium truncate">{r.title}</span>
                    <span className="text-xs text-muted-foreground truncate">{r.kind} · {r.subtitle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Header({ onMobileMenu }: { onMobileMenu: () => void }) {
  // Sprint 11: light-only — theme toggle removed.
  const [, navigate] = useLocation();
  const { role } = useRole();

  // W-FIX2 F6 — hardened Sign out. Previously the logout ran inside the Radix
  // DropdownMenuItem `onSelect` async callback; Radix closes the menu (and can
  // unmount the handler) mid-await, so the final `window.location.href` redirect
  // sometimes never landed → the user stayed authenticated. We now run the whole
  // sequence in a stable, component-level handler so it completes regardless of
  // the menu-close lifecycle: POST /logout → cancel+clear the query cache →
  // hard redirect to /login (cookie cleared server-side, cache cleared client-side).
  const handleSignOut = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {
      /* non-fatal — the server also clears the cookie on the next auth probe */
    }
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
    } catch {
      /* cache clear best-effort */
    }
    window.location.href = "/login";
  }, []);

  return (
    <header className="sticky top-0 z-40 h-14 bg-[hsl(219_45%_20%)] border-b border-[hsl(219_40%_28%)] flex items-center px-4 gap-3" data-testid="header-app">
      <button onClick={onMobileMenu} className="md:hidden p-2 -ml-2 rounded text-white/90 hover:bg-white/10" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      <Link href="/" className="flex items-center gap-2 text-white" data-testid="link-home">
        <span className="flex items-center bg-white rounded-md px-2 py-1 shadow-sm">
          <CapavateLogo className="h-6 w-auto" />
        </span>
        {/* v25.43 R3-7 — removed the internal-dev sprint/admin-separation debug
            badge entirely. It was internal metadata that should never have
            shipped to the production header. */}
        <AdminChip />
      </Link>

      <div className="flex-1" />

      {/* v25.45.4 H-2 — wired global search (was a dead input) */}
      <GlobalSearch />

      {/* W-FIX2 F6 — workspace/role switcher group: kept as its OWN clearly
          separated control cluster (owner decision: two distinct header controls). */}
      <div className="flex items-center gap-2" data-testid="header-switcher-group">
        <FounderCompanySwitcherSlot />
        <CapCollectiveToggle />
        <RoleSwitch />
      </div>

      <NotificationBell />

      {/* W-FIX2 F6 — account/avatar menu: de-collided from the switcher group
          with a left divider, extra spacing, and a raised z-index so the avatar
          always opens THIS account menu (not the adjacent workspace-switcher).
          Distinct, non-overlapping hit target. */}
      <div className="relative z-50 ml-1 pl-2 border-l border-white/15" data-testid="header-account-group">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button data-testid="button-user-menu" aria-label="Account menu" className="rounded-full p-0.5 hover:ring-2 hover:ring-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-[hsl(0_100%_40%)] text-white text-xs font-semibold" data-testid="avatar-user-initials">
              <AvatarInitials />
            </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 z-50">
          <UserMenuLabel />
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate(role === "investor" ? "/investor/settings" : "/founder/settings")}>
            <Settings className="h-4 w-4 mr-2" /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="menuitem-sign-out"
            onSelect={(e) => {
              // W-FIX2 F6 — prevent Radix's default close-on-select so the async
              // logout is not interrupted by the menu unmounting; run the stable
              // component-level handler instead (see handleSignOut).
              e.preventDefault();
              void handleSignOut();
            }}
          >
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
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
  /* WAVE 0 · 0.2 — `data-product` on the shell.
   *
   * WHY. `CollectiveShell` already sets `data-product="collective" | "partner"`,
   * which is how `collective-theme.css` and `partner-theme.css` re-theme those
   * two areas from ONE stylesheet with zero component edits. `AppShell` set no
   * such attribute, so founder, investor and admin all shared the unscoped
   * `:root` and could not be themed independently — a `:root` change would hit
   * all three at once. This attribute is the scope hook that lets Waves 3, 4
   * and 5 be sequenced separately. R78/OQ-1: there are FIVE customer-facing
   * areas, not four; `investor` is one of them and is included here.
   *
   * HOW IT IS DERIVED — from real routing, then real context, never a guess.
   * The URL prefix is the authority because it is correct on the FIRST render;
   * `role` is synced from the URL by the effect above, so on a direct load of
   * /admin the role is still the default `"founder"` for one render and reading
   * it alone would emit the wrong scope for that frame. Outside the three
   * prefixes (there is no such route today — every AppShell route is under
   * /founder, /investor or /admin) we fall back to the role from context, and
   * only if that is somehow not one of the three do we fall back to `"founder"`,
   * which is `RoleProvider`'s own initial value. There is therefore NO code path
   * on which AppShell renders without a `data-product`.
   *
   * NO FUNCTIONAL CHANGE. One extra HTML attribute on an element that already
   * exists. No control, route, query, permission or handler is touched, and no
   * stylesheet consumes `[data-product="founder" | "investor" | "admin"]` yet,
   * so nothing looks different until an area's wave opts in.
   */
  const product: "founder" | "investor" | "admin" = location.startsWith("/admin")
    ? "admin"
    : location.startsWith("/investor")
      ? "investor"
      : location.startsWith("/founder")
        ? "founder"
        : role === "admin" || role === "investor"
          ? role
          : "founder";
  return (
    <div data-product={product} className="min-h-screen bg-background text-foreground flex flex-col">
      <Header onMobileMenu={() => setMobileOpen(true)} />
      <div className="flex flex-1 min-h-0">
        <aside className="hidden md:flex w-64 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex-col">
          <SidebarContent />
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
          {/* v25.45 F20c — archived-workspace banner on every founder page. */}
          {location.startsWith("/founder") && <ArchivedWorkspaceBanner />}
          {/* v25.47 APD-029 — audit-chain P0 banner on admin pages (renders only on incident). */}
          {location.startsWith("/admin") && <AuditChainP0Banner />}
          {children}
          {/* WAVE 8 / ORP-047 — the routed Terms/Privacy pages had no link
              anywhere in the tree. This is their entry point. */}
          <LegalFooterLinks />
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
