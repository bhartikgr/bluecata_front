/**
 * v19 Wave A / Change 4 — PersonaSwitcher dropdown.
 *
 * Replaces the binary CapCollectiveToggle button with a 4-persona dropdown:
 *   • Capavate (founder app)            → /founder/dashboard
 *   • Collective (investor app)         → /collective
 *   • Consortium Partner (partner app)  → /collective/partner/dashboard
 *   • Admin (admin console)             → /admin/dashboard
 *
 * Behavior:
 *   • Visibility uses the same predicate as CapCollectiveToggle
 *     (`shouldShowToggleFromCtx`). When hidden, renders a probe span for tests.
 *   • Selection persists to localStorage (key: `capavate.persona`) when
 *     available — sandbox-safe: falls back to in-memory if Storage throws.
 *   • Shows a "Demo" badge when VITE_ENABLE_DEMO_SEED === "1".
 *   • URL pattern: `?portal={founder|investor|admin|collective|partner}` is
 *     appended on navigation, matching the v19 spec.
 *   • Persona items that the user is NOT entitled to (e.g. non-admin viewing
 *     the Admin option) are rendered as disabled.
 *
 * NOTE: This file does NOT remove the legacy `CapCollectiveToggle` export —
 * the pure-function visibility predicates (`shouldShowToggle`,
 * `shouldShowToggleFromCtx`) are still imported by sprint12 / sprint15 tests.
 * AppShell renders `<CapCollectiveToggle />` which (post-Change-4) delegates
 * to this PersonaSwitcher.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ChevronDown, Sparkles, Building2, ShieldCheck, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEntitlement, type UserContext } from "@/lib/entitlement";
import { shouldShowToggleFromCtx } from "./CapCollectiveToggle";

/**
 * v19 Wave A — Persona identifiers.
 *
 * `capavate` = founder app, `collective` = investor surface, `partner` =
 * consortium partner workspace, `admin` = admin console. The `portal` query
 * param uses these short keys (plus `investor` as a synonym for backward
 * compat with /investor/* routes).
 */
export type Persona = "capavate" | "collective" | "partner" | "admin";

interface PersonaDef {
  id: Persona;
  label: string;
  portalKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

export const PERSONA_OPTIONS: readonly PersonaDef[] = [
  {
    id: "capavate",
    label: "Capavate",
    portalKey: "founder",
    href: "/founder/dashboard",
    icon: Building2,
    description: "Founder workspace — cap table, rounds, dataroom.",
  },
  {
    id: "collective",
    label: "Collective",
    portalKey: "collective",
    href: "/collective",
    icon: Sparkles,
    description: "Investor / Collective member surface.",
  },
  {
    id: "partner",
    label: "Consortium Partner",
    portalKey: "partner",
    href: "/collective/partner/dashboard",
    icon: Briefcase,
    description: "Angel network / consortium partner workspace.",
  },
  {
    id: "admin",
    label: "Admin",
    portalKey: "admin",
    href: "/admin/dashboard",
    icon: ShieldCheck,
    description: "Platform admin console.",
  },
] as const;

const PERSONA_STORAGE_KEY = "capavate.persona";

// In-memory fallback when localStorage is unavailable (sandbox / SSR).
let inMemoryPersona: Persona | null = null;

/** Safe localStorage getter. Falls back to module-scoped variable. */
function readStoredPersona(): Persona | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const v = window.localStorage.getItem(PERSONA_STORAGE_KEY);
      if (v === "capavate" || v === "collective" || v === "partner" || v === "admin") return v;
    }
  } catch {
    /* localStorage may throw in private mode */
  }
  return inMemoryPersona;
}

/** Safe localStorage setter. */
function writeStoredPersona(p: Persona): void {
  inMemoryPersona = p;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(PERSONA_STORAGE_KEY, p);
    }
  } catch {
    /* swallow — in-memory fallback already updated */
  }
}

/**
 * Pure helper — determines which personas a given UserContext can access.
 *
 * Exported for unit-test parity with `shouldShowToggleFromCtx`.
 */
export function entitledPersonas(ctx: UserContext | null | undefined): Set<Persona> {
  const out = new Set<Persona>();
  if (!ctx) return out;
  // Capavate (founder) always available when the user has a founder company.
  if (ctx.founder?.companies?.length) out.add("capavate");
  // Collective: visibility predicate from CapCollectiveToggle.
  if (shouldShowToggleFromCtx(ctx).visible) out.add("collective");
  // Partner: any active partner-team membership is admin-driven; conservative
  // approach is to expose only when admin OR explicit partner role flag.
  if (ctx.isAdmin) out.add("partner");
  // Admin: explicit flag.
  if (ctx.isAdmin) out.add("admin");
  // Always expose capavate to admins (gives them a way back to founder UI).
  if (ctx.isAdmin) out.add("capavate");
  return out;
}

/** Returns true if VITE_ENABLE_DEMO_SEED === "1" (matches existing lib/entitlement.tsx). */
function isDemoMode(): boolean {
  try {
    const env = (import.meta as { env?: { MODE?: string; VITE_ENABLE_DEMO_SEED?: string } }).env;
    return env?.VITE_ENABLE_DEMO_SEED === "1";
  } catch {
    return false;
  }
}

/** Detects current persona from the URL path (best-effort). */
function detectCurrentPersona(pathname: string): Persona {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/collective/partner")) return "partner";
  if (pathname.startsWith("/collective")) return "collective";
  if (pathname.startsWith("/investor")) return "collective";
  return "capavate";
}

/** Appends `?portal=<key>` to a path, preserving any existing query string. */
function withPortalParam(href: string, portalKey: string): string {
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}portal=${portalKey}`;
}

export interface PersonaSwitcherProps {
  /** Optional override for the entitlement context — used in tests. */
  ctxOverride?: UserContext | null;
  /** Suppress the demo badge regardless of env. Default false. */
  hideDemoBadge?: boolean;
}

export function PersonaSwitcher({ ctxOverride, hideDemoBadge }: PersonaSwitcherProps = {}) {
  const [location, navigate] = useLocation();
  const { data: liveCtx } = useEntitlement();
  const ctx = ctxOverride !== undefined ? ctxOverride : (liveCtx ?? null);

  const { visible, reason } = useMemo(
    () => shouldShowToggleFromCtx(ctx ?? null),
    [ctx]
  );

  const entitled = useMemo(() => entitledPersonas(ctx), [ctx]);
  const currentPersona = detectCurrentPersona(location);

  // Initialize selected persona from URL or stored value.
  const [selected, setSelected] = useState<Persona>(() => readStoredPersona() ?? currentPersona);

  // Keep selection in sync with URL changes (so URL is the source of truth).
  useEffect(() => {
    setSelected(currentPersona);
    writeStoredPersona(currentPersona);
  }, [currentPersona]);

  const demo = !hideDemoBadge && isDemoMode();

  if (!visible) {
    // Keep parity with legacy `toggle-hidden-marker` so existing tests/snapshots stay green.
    return (
      <span
        data-testid="persona-switcher-hidden-marker toggle-hidden-marker"
        data-toggle-visible="false"
        data-toggle-reason={reason}
        className="hidden"
      />
    );
  }

  const onSelect = (p: PersonaDef) => {
    setSelected(p.id);
    writeStoredPersona(p.id);
    navigate(withPortalParam(p.href, p.portalKey));
  };

  const currentDef = PERSONA_OPTIONS.find((p) => p.id === selected) ?? PERSONA_OPTIONS[0]!;
  const CurrentIcon = currentDef.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          data-testid="button-persona-switcher"
          data-persona-current={selected}
          data-toggle-visible="true"
          data-toggle-reason={reason}
          className="hidden md:inline-flex h-8 gap-2 text-white/90 hover:text-white hover:bg-white/10 border border-white/10"
        >
          <CurrentIcon className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium">{currentDef.label}</span>
          {demo && (
            <Badge
              className="bg-amber-400/30 border-0 text-amber-50 text-[9px] uppercase"
              data-testid="persona-demo-badge"
            >
              Demo
            </Badge>
          )}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" data-testid="persona-switcher-menu">
        <DropdownMenuLabel className="text-xs">
          Switch persona
          {demo && (
            <span className="ml-2 text-amber-600 font-normal" data-testid="persona-demo-label">
              · Demo seed
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* ----- Wave B FIX 9 (I-BUG-009) -----
         * QA flagged that the dropdown listed Capavate/Collective/Partner/Admin
         * for every user, with the ineligible items shown disabled. Investors
         * with no founder membership saw a greyed-out "Capavate" entry that
         * looked like a bug, and partner/admin entries leaked the existence of
         * admin surfaces to non-admins. The fix is to filter to only the
         * personas the caller is entitled to (per `entitledPersonas`). The
         * `data-testid="persona-option-<id>"` markers therefore only appear
         * for personas the user can actually switch into. */}
        {PERSONA_OPTIONS.filter((p) => entitled.has(p.id)).map((p) => {
          const Icon = p.icon;
          const allowed = true; // post-filter, every item is allowed
          const isCurrent = p.id === selected;
          return (
            <DropdownMenuItem
              key={p.id}
              onSelect={(e) => {
                if (!allowed) {
                  e.preventDefault();
                  return;
                }
                onSelect(p);
              }}
              data-testid={`persona-option-${p.id}`}
              data-persona-allowed={allowed ? "true" : "false"}
              data-persona-current={isCurrent ? "true" : "false"}
              className="flex items-start gap-2 text-xs"
            >
              <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-medium flex items-center gap-1.5">
                  {p.label}
                  {isCurrent && (
                    <Badge className="text-[9px] h-4 px-1.5" data-testid={`persona-current-badge-${p.id}`}>
                      Current
                    </Badge>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">{p.description}</div>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default PersonaSwitcher;
