/**
 * v25.48.2 Q9 (Ozan) — client-side Collective member gate.
 *
 * The Collective dashboard fires ~12 members-only API calls on mount (member
 * directory, soft-circles, DSC pipeline, deal room, etc.). For a signed-in user
 * who is NOT an active Collective member every one of those calls 403s, spraying
 * the console with errors and showing a broken page.
 *
 * This gate resolves active membership ONCE (via GET /api/me/chapters — the same
 * source the shell uses for the chapter selector) and:
 *   - while resolving → a lightweight spinner,
 *   - active member    → renders {children} (the real dashboard mounts and its
 *                          member-only queries fire, exactly as before),
 *   - non-member       → renders a marketing panel + an apply CTA and NEVER
 *                          mounts {children}, so none of the members-only calls
 *                          are issued.
 *
 * The surrounding CollectiveShell (sidebar + topbar nav) is untouched — the nav
 * stays so a curious non-member can still explore, they just land on the
 * marketing surface instead of a wall of 403s.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Sparkles, Users, Briefcase, TrendingUp, ArrowRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useRole } from "@/lib/role";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ChaptersResp = { ok?: boolean; chapters?: Array<{ id: string }> };

function useCollectiveMembership(): { loading: boolean; isMember: boolean } {
  const q = useQuery<ChaptersResp>({
    queryKey: ["/api/me/chapters"],
    queryFn: async () => {
      try {
        return await (await apiRequest("GET", "/api/me/chapters")).json();
      } catch {
        // COLLECTIVE_ENABLED=0 → the endpoint 503s and apiRequest throws.
        // Fail closed: treat as "no active membership".
        return { ok: false, chapters: [] };
      }
    },
    retry: false,
    staleTime: 30_000,
  });
  const isMember = Array.isArray(q.data?.chapters) && q.data!.chapters!.length > 0;
  return { loading: q.isLoading, isMember };
}

const HIGHLIGHTS = [
  { icon: Users, title: "Curated member network", body: "Connect with accredited investors, operators, and consortium partners across every chapter." },
  { icon: Briefcase, title: "Live deal room", body: "See soft-circling rounds and syndicate opportunities the moment they open." },
  { icon: TrendingUp, title: "M&A intelligence", body: "DSC pipeline, composite scores, and transaction-prep tooling built for the network." },
];

function CollectiveMarketing() {
  const { role } = useRole();
  // Founders apply through the founder surface; everyone else (investor / admin
  // / partner exploring) applies through the investor surface.
  const applyHref = role === "founder" ? "/founder/apply-to-collective" : "/investor/apply-to-collective";

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
        <Link href={applyHref}>
          <Button
            className="bg-[#cc0001] hover:bg-[#a30001] text-white gap-2"
            data-testid="button-collective-apply"
          >
            Apply to the Collective <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <p className="text-xs text-muted-foreground">
          Already applied? Your access unlocks automatically once your membership is approved.
        </p>
      </div>
    </div>
  );
}

export function CollectiveMemberGate({ children }: { children: React.ReactNode }) {
  const { loading, isMember } = useCollectiveMembership();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="collective-member-gate-loading">
        <div className="h-8 w-8 rounded-full border-2 border-[#cc0001]/30 border-t-[#cc0001] animate-spin" />
      </div>
    );
  }

  if (!isMember) return <CollectiveMarketing />;

  return <>{children}</>;
}

export default CollectiveMemberGate;
