/**
 * Sprint 12 A1 — Capavate ↔ Collective surface toggle.
 *
 * Visibility rules (from collective_admin_audit.md §11):
 *
 *  - Investor:  visible iff eligibilityFlags.investorOnCapTable === true
 *               AND collective_memberships.status === 'active'
 *               (i.e. on a cap table, member, not lapsed).
 *  - Founder:   visible iff active Collective company (membership.isCollectiveMember).
 *  - Admin:     always visible.
 *  - Suspended (lapsed renewal): toggle disappears.
 *
 * Switches between /investor/* (Capavate) and /collective preview wrapper.
 * Persists last-active surface in an in-memory module variable
 * (sandbox-safe: no localStorage / sessionStorage).
 */
import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { ArrowLeftRight, Sparkles, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRole } from "@/lib/role";
import { useEntitlement, type UserContext } from "@/lib/entitlement";
// v19 Wave A / Change 4 — default render path = new PersonaSwitcher dropdown.
import { PersonaSwitcher } from "./PersonaSwitcher";

type MembershipStatus = {
  userId: string;
  isCollectiveMember: boolean;
  lapsed: boolean;
  capTablePositions: { companyId: string; companyName: string; ownershipPct: number }[];
  reason?: string;
};

// In-memory last-surface tracker (sandbox-safe — no Web Storage APIs).
let lastSurface: "capavate" | "collective" = "capavate";

/**
 * Sprint 15 D8 — entitlement-driven visibility predicate.
 *
 * Reads UserContext directly (single source of truth). Hides the toggle for
 * `none | applied | pending | lapsed | suspended` Collective statuses, even
 * when the viewer is on a cap table. Admins always see it.
 */
export function shouldShowToggleFromCtx(ctx: UserContext | null | undefined): { visible: boolean; reason: string } {
  if (!ctx) return { visible: false, reason: "no user context" };
  if (ctx.isAdmin) return { visible: true, reason: "admin: always visible" };
  const status = ctx.collective.status;
  if (status === "lapsed")    return { visible: false, reason: "lapsed renewal — toggle hidden" };
  if (status === "suspended") return { visible: false, reason: "membership suspended — toggle hidden" };
  if (status === "pending")   return { visible: false, reason: "membership pending — toggle hidden" };
  if (status === "applied")   return { visible: false, reason: "application not yet accepted" };
  if (status === "none")      return { visible: false, reason: "no Collective membership" };
  // status === 'active' below.
  if (ctx.founder.companies.length > 0) return { visible: true, reason: "founder of active Collective company" };
  if (ctx.investor.capTablePositions.length > 0) return { visible: true, reason: "investor on cap-table + active member" };
  return { visible: false, reason: "active membership but no cap-table or company" };
}

export function shouldShowToggle(args: {
  role: "founder" | "investor" | "admin";
  membership: MembershipStatus | null;
}): { visible: boolean; reason: string } {
  const { role, membership } = args;
  if (role === "admin") return { visible: true, reason: "admin: always visible" };
  if (!membership) return { visible: false, reason: "no membership status" };
  if (membership.lapsed) return { visible: false, reason: "lapsed renewal — toggle hidden" };
  if (role === "investor") {
    const onCapTable = membership.capTablePositions.length > 0;
    if (!onCapTable) return { visible: false, reason: "investor not on any cap table" };
    if (!membership.isCollectiveMember) return { visible: false, reason: "no active Collective membership" };
    return { visible: true, reason: "investor on cap-table + active member" };
  }
  if (role === "founder") {
    if (!membership.isCollectiveMember) return { visible: false, reason: "no active Collective company" };
    return { visible: true, reason: "founder of active Collective company" };
  }
  return { visible: false, reason: "unknown role" };
}

/**
 * v19 Wave A / Change 4 — CapCollectiveToggle now delegates to the new
 * PersonaSwitcher dropdown (4 personas: Capavate, Collective, Consortium
 * Partner, Admin). The pure-function predicates above are preserved for
 * existing Sprint 12 / Sprint 15 tests that import them directly.
 *
 * We keep the binary-toggle implementation behind an opt-in env flag
 * (`VITE_USE_LEGACY_CAP_COLLECTIVE_TOGGLE === "1"`) so any consumer that
 * still relies on the original button can fall back without code changes.
 */
export function CapCollectiveToggle() {
  const { role } = useRole();
  const [location, navigate] = useLocation();
  const { data: ctx } = useEntitlement();

  const { visible, reason } = useMemo(
    () => shouldShowToggleFromCtx(ctx ?? null),
    [ctx]
  );

  const onCollective = location.startsWith("/collective");

  useEffect(() => {
    lastSurface = onCollective ? "collective" : "capavate";
  }, [onCollective]);

  // v19 Wave A / Change 4 — default = new persona dropdown.
  const useLegacy = (() => {
    try {
      const env = (import.meta as { env?: { VITE_USE_LEGACY_CAP_COLLECTIVE_TOGGLE?: string } }).env;
      return env?.VITE_USE_LEGACY_CAP_COLLECTIVE_TOGGLE === "1";
    } catch {
      return false;
    }
  })();

  if (!useLegacy) {
    // Forward to the new PersonaSwitcher (4-persona dropdown).
    return <PersonaSwitcher />;
  }

  /* ---------------- Legacy binary-toggle path (opt-in fallback) ---------------- */
  const targetSurface: "capavate" | "collective" = onCollective ? "capavate" : "collective";

  if (!visible) {
    return (
      <span
        data-testid="toggle-hidden-marker"
        data-toggle-visible="false"
        data-toggle-reason={reason}
        className="hidden"
      />
    );
  }

  const switchTo = () => {
    if (targetSurface === "collective") {
      navigate("/collective");
    } else {
      const home =
        role === "founder" ? "/founder/dashboard" :
        role === "admin"   ? "/admin/dashboard"   :
                             "/investor/dashboard";
      navigate(home);
    }
  };

  return (
    <Button
      onClick={switchTo}
      size="sm"
      variant="ghost"
      data-testid="button-cap-collective-toggle"
      data-toggle-visible="true"
      data-toggle-target={targetSurface}
      data-toggle-reason={reason}
      className="hidden md:inline-flex h-8 gap-2 text-white/90 hover:text-white hover:bg-white/10 border border-white/10"
    >
      {onCollective ? (
        <>
          <Building2 className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium">Switch to Capavate</span>
        </>
      ) : (
        <>
          <Sparkles className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium">Switch to Collective</span>
        </>
      )}
      <ArrowLeftRight className="h-3 w-3 opacity-70" />
      <Badge className="bg-white/15 border-0 text-white/90 text-[9px]" data-testid="badge-toggle-state">
        {role === "admin" ? "ADMIN" :
         onCollective ? "COLLECTIVE" :
         ctx?.investor.state === "ON_CAP_TABLE_COLLECTIVE_ACTIVE" ? "CAP + COLLECTIVE" :
         ctx?.investor.state === "ON_CAP_TABLE" ? "CAP TABLE" :
         "CAPAVATE"}
      </Badge>
    </Button>
  );
}

export default CapCollectiveToggle;
