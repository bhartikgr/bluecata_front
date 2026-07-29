/**
 * v25.48.2 Q9 (Ozan) — client-side Collective member gate.
 *
 * The Collective dashboard fires ~12 members-only API calls on mount (member
 * directory, soft-circles, DSC pipeline, deal room, etc.). For a signed-in user
 * who is NOT an active Collective member every one of those calls 403s, spraying
 * the console with errors and showing a broken page.
 *
 * W2 A5 (v26.2.0-w2) — the gate now resolves the full first-sign-on decision
 * via `GET /api/collective/gate-state` (membership, cap-table exemption, and
 * accreditation status) INSTEAD OF just `/api/me/chapters`, so that an active
 * member whose `accreditationStatus === "none"` is blocked with the
 * `CollectiveAccreditationBlocker` self-declaration surface before any
 * members-only child page mounts. Decision order:
 *   1. loading                          → spinner.
 *   2. gate-state fetch error           → visible retry card, children NOT mounted.
 *   3. !isMember                        → marketing panel + apply CTA (unchanged).
 *   4. requiresAccreditationDeclaration → CollectiveAccreditationBlocker.
 *   5. else                             → {children} (the real dashboard mounts).
 *
 * The surrounding CollectiveShell (sidebar + topbar nav) is untouched — the nav
 * stays so a curious non-member can still explore, they just land on the
 * marketing surface instead of a wall of 403s.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Sparkles, Users, Briefcase, TrendingUp, ArrowRight, AlertTriangle, RotateCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useRole } from "@/lib/role";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CollectiveAccreditationBlocker } from "@/components/collective/CollectiveAccreditationBlocker";
import type { CollectiveLegalCopy } from "@shared/collectiveLegalCopy";

/* W-COLLECTIVE Wave 1 (v4 §1.1 / v5 §C / v6 §2) — the shared denial-reason
   vocabulary. `unknown` is the only reason that renders the retry card; it is
   what the server reports when a signal source could not be READ (as opposed to
   read successfully and found lapsed), so an unreadable billing table can never
   present itself as billing copy or as a pending application. */
export type CollectiveDenialReason =
  | "not_authed"
  | "not_collective_member"
  | "partner_only"
  | "application_pending"
  | "billing_deactivation_pending"
  | "not_on_cap_table"
  | "accreditation_required"
  | "accreditation_unavailable"
  | "unknown";

interface CollectiveGateStateResponse {
  ok: boolean;
  isMember: boolean;
  isPartnerOnly: boolean;
  capTableExempt: boolean;
  accreditationStatus: "none" | "self_certified" | "verified";
  requiresAccreditationDeclaration: boolean;
  declarationEndpoint: string;
  /* Additive Wave 1 fields. Optional so an older/cached server response still
     renders exactly as before rather than falling into a blank state. */
  accessAllowed?: boolean;
  denialReason?: CollectiveDenialReason | null;
  denialMessage?: string | null;
  partnerWorkspaceRedirectTo?: string | null;
  copy?: {
    gateIndemnity?: CollectiveLegalCopy;
    declarationIndemnity?: CollectiveLegalCopy;
  };
}

const GATE_STATE_KEY = ["/api/collective/gate-state"];

// Fail-closed default used whenever the gate-state fetch throws — treated as
// "no active membership" so a broken/unavailable endpoint never silently
// admits a user into members-only pages.
const FAIL_CLOSED_STATE: CollectiveGateStateResponse = {
  ok: false,
  isMember: false,
  isPartnerOnly: false,
  capTableExempt: false,
  accreditationStatus: "none",
  requiresAccreditationDeclaration: false,
  declarationEndpoint: "/api/investor/compliance/accreditation-declaration",
};

function useCollectiveGateState(): {
  loading: boolean;
  state: CollectiveGateStateResponse | null;
  error: Error | null;
  refetch: () => void;
} {
  const q = useQuery<CollectiveGateStateResponse>({
    queryKey: GATE_STATE_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/collective/gate-state")).json(),
    retry: false,
    staleTime: 30_000,
  });
  return {
    loading: q.isLoading,
    state: q.data ?? null,
    error: q.isError ? (q.error as Error) : null,
    refetch: () => void q.refetch(),
  };
}

const HIGHLIGHTS = [
  { icon: Users, title: "Curated member network", body: "Connect with accredited investors, operators, and consortium partners across every chapter." },
  { icon: Briefcase, title: "Live deal room", body: "See soft-circling rounds and syndicate opportunities the moment they open." },
  { icon: TrendingUp, title: "M&A intelligence", body: "DSC pipeline, composite scores, and transaction-prep tooling built for the network." },
];

function CollectiveMarketing({
  denialReason,
  denialMessage,
  partnerWorkspaceRedirectTo,
}: {
  denialReason?: CollectiveDenialReason | null;
  denialMessage?: string | null;
  partnerWorkspaceRedirectTo?: string | null;
}) {
  const { role } = useRole();
  // Founders apply through the founder surface; everyone else (investor / admin
  // / partner exploring) applies through the investor surface.
  const applyHref = role === "founder" ? "/founder/apply-to-collective" : "/investor/apply-to-collective";
  /* v4 §1.1 — `isPartnerOnly` previously had no consumer anywhere in the client,
     so a repaired value would have changed nothing on screen. A partner-only
     session now gets a route into the workspace it actually owns instead of an
     apply CTA it cannot use. */
  const partnerOnly = denialReason === "partner_only" && !!partnerWorkspaceRedirectTo;
  /* An application already in review must not be told to apply again. */
  const applicationPending = denialReason === "application_pending";

  return (
    <div className="max-w-4xl mx-auto px-6 py-10" data-testid="collective-member-gate-marketing">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 text-[#cc0001] text-xs font-semibold uppercase tracking-wider mb-3">
          <Sparkles className="h-4 w-4" /> Invitation-only network
        </div>
        <h1 className="text-3xl font-semibold text-[#1A1A2E]">Capavate Collective</h1>
        <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">
          The Collective is a private, invitation-only network of accredited investors and
          high-signal companies. You are signed in, but your account is not yet an active
          member of a Collective chapter — apply to unlock the member experience.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        {HIGHLIGHTS.map((h) => (
          <Card key={h.title} className="border-black/5">
            <CardContent className="p-5">
              <h.icon className="h-6 w-6 text-[#cc0001] mb-3" />
              <h3 className="font-semibold text-sm mb-1">{h.title}</h3>
              <p className="text-xs text-muted-foreground">{h.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col items-center gap-3">
        {partnerOnly ? (
          <Button
            className="bg-[#cc0001] hover:bg-[#a30001] text-white gap-2"
            data-testid="button-collective-partner-workspace"
            asChild
          >
            <Link href={partnerWorkspaceRedirectTo!}>
              You have a Consortium Partner workspace <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <Button
            className="bg-[#cc0001] hover:bg-[#a30001] text-white gap-2"
            data-testid="button-collective-apply"
            asChild
          >
            <Link href={applyHref}>
              Apply to the Collective <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
        <p className="text-xs text-muted-foreground" data-testid="text-collective-gate-reason">
          {denialMessage ??
            (applicationPending
              ? "Your Collective application is with our review team."
              : "Already applied? Your access unlocks automatically once your membership is approved.")}
        </p>
      </div>
    </div>
  );
}

function CollectiveGateRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="max-w-lg mx-auto px-6 py-16" data-testid="collective-member-gate-error">
      <Card className="border-black/5">
        <CardContent className="p-6 flex flex-col items-center text-center gap-3">
          <AlertTriangle className="h-8 w-8 text-[#cc0001]" />
          <p className="text-sm text-muted-foreground">
            We could not verify your Collective access. Refresh or contact support.
          </p>
          <Button
            variant="outline"
            className="gap-2"
            onClick={onRetry}
            data-testid="button-collective-gate-retry"
          >
            <RotateCw className="h-4 w-4" /> Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function CollectiveMemberGate({ children }: { children: React.ReactNode }) {
  const { loading, state, error, refetch } = useCollectiveGateState();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="collective-member-gate-loading">
        <div className="h-8 w-8 rounded-full border-2 border-[#cc0001]/30 border-t-[#cc0001] animate-spin" />
      </div>
    );
  }

  if (error) {
    return <CollectiveGateRetry onRetry={refetch} />;
  }

  // Fail-closed on a missing/malformed response — never mount children.
  const resolved = state ?? FAIL_CLOSED_STATE;

  /* W-COLLECTIVE Wave 1 (v5 §C) — `unknown` means a signal source could not be
     read. That is NOT a membership verdict, so it renders the retry card rather
     than the marketing panel or billing copy. Children are still not mounted. */
  if (resolved.denialReason === "unknown") {
    return <CollectiveGateRetry onRetry={refetch} />;
  }

  if (!resolved.isMember) {
    return (
      <CollectiveMarketing
        denialReason={resolved.denialReason}
        denialMessage={resolved.denialMessage}
        partnerWorkspaceRedirectTo={resolved.partnerWorkspaceRedirectTo}
      />
    );
  }

  if (resolved.requiresAccreditationDeclaration) {
    return (
      <CollectiveAccreditationBlocker
        onDeclared={refetch}
        gateCopy={resolved.copy?.gateIndemnity}
        declarationCopy={resolved.copy?.declarationIndemnity}
      />
    );
  }

  return <>{children}</>;
}

export default CollectiveMemberGate;
