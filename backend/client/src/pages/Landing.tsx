import { asArray } from "@/lib/safeArray";
/**
 * Sprint 15 D4 — Landing page rebuild.
 *
 * Layout per CAPAVATE-LOGIN-DESIGN.md Part 2:
 *   - Top: Capavate logo (left) + Admin sign-in (top-right)
 *   - Hero: "The capital-formation OS for founders and the investors who back them. ..."
 *   - Two big CTA cards: "I'M A FOUNDER" + "I'M AN INVESTOR"
 *   - Investor disclaimer below
 *   - Footer chips: SOC 2 Type II + Connected to Capavate Collective
 *
 * NO third button (no role-chip system). Investors NEVER self-sign-up.
 *
 * SANDBOX-SAFE: no Web Storage APIs.
 */
import { Link, useLocation } from "wouter";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ShieldCheck, Sparkles, Briefcase, Wallet, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CapavateLogo } from "@/components/CapavateLogo";
import { useRole } from "@/lib/role";
import { useToast } from "@/hooks/use-toast";

type DemoToken = {
  id: string;
  rawToken: string;
  companyName: string;
  inviteeName: string;
  inviteeEmail: string;
  signupUrl: string;
  redeemed: boolean;
};

export default function Landing() {
  const [, navigate] = useLocation();
  const { setRole } = useRole();
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showTokens, setShowTokens] = useState(false);

  const demoTokens = useQuery<DemoToken[]>({
    queryKey: ["/api/dev/demo-tokens"],
    enabled: showTokens,
  });

  const goFounder = () => {
    setRole("founder");
    navigate("/auth/login?portal=founder");
  };
  const goInvestor = () => {
    setRole("investor");
    navigate("/auth/login?portal=investor");
  };
  const goAdmin = () => {
    setRole("admin");
    navigate("/auth/login?portal=admin");
  };

  function copyTokenLink(t: DemoToken) {
    void navigator.clipboard?.writeText(`/auth/redeem?token=${t.rawToken}`).catch(() => undefined);
    setCopiedId(t.id);
    toast({ title: "Copied redemption URL", description: "Paste into a new tab to walk through token redemption." });
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="min-h-screen bg-[hsl(40_30%_98%)] text-[hsl(219_45%_14%)] flex flex-col">
      {/* Header — logo left, admin link right */}
      <header className="h-16 px-6 md:px-10 flex items-center border-b border-black/5">
        <Link href="/" data-testid="link-home">
          <span className="inline-flex items-center gap-2 cursor-pointer">
            <CapavateLogo className="h-7 w-auto" />
          </span>
        </Link>
        <div className="flex-1" />
        <button
          onClick={goAdmin}
          className="text-xs text-[hsl(219_45%_30%)] hover:text-[hsl(219_45%_14%)] underline underline-offset-4"
          data-testid="link-admin-signin"
        >
          Admin sign-in →
        </button>
      </header>

      {/* Hero */}
      <main className="flex-1 px-6 md:px-10 py-16 md:py-24 max-w-5xl mx-auto w-full">
        <h1 className="text-3xl md:text-[40px] leading-[1.1] font-semibold tracking-tight max-w-3xl text-balance">
          The capital-formation OS for founders and the investors who back them.
        </h1>
        <p className="mt-6 text-base md:text-lg text-[hsl(219_25%_30%)] max-w-2xl leading-relaxed">
          Run your cap table, structure rounds, communicate with every investor on it — and
          graduate qualified founders into the Capavate Collective.
        </p>

        {/* Two-path CTA grid */}
        <div className="mt-12 grid md:grid-cols-2 gap-5">
          <button
            type="button"
            onClick={goFounder}
            aria-label="Continue as founder — sign in or get started"
            className="text-left rounded-lg group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[hsl(184_98%_22%)]"
            data-testid="card-founder-path"
          >
            <Card className="border-[hsl(219_45%_14%)]/15 group-hover:border-[hsl(219_45%_14%)]/40 group-hover:shadow-md transition-all">
              <CardContent className="p-7 md:p-8">
                <div className="flex items-center justify-between mb-5">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[hsl(219_45%_14%)] text-white">
                    <Briefcase className="h-5 w-5" />
                  </span>
                  <span className="text-[10px] tracking-widest font-semibold text-[hsl(219_45%_30%)]/70">
                    FOUNDER
                  </span>
                </div>
                <h2 className="text-xl font-semibold tracking-tight">I'm a founder</h2>
                <p className="mt-2 text-sm text-[hsl(219_25%_30%)] leading-relaxed">
                  Run your company(ies). Cap table, rounds, dataroom, and investor comms — all in one place.
                </p>
                <div className="mt-6 inline-flex items-center text-sm font-medium text-[hsl(184_98%_22%)] group-hover:translate-x-1 transition-transform">
                  Sign in / Get started <ArrowRight className="ml-1.5 h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          </button>

          <button
            type="button"
            onClick={goInvestor}
            aria-label="Continue as investor — sign in to view your invitation or portfolio"
            className="text-left rounded-lg group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[hsl(184_98%_22%)]"
            data-testid="card-investor-path"
          >
            <Card className="border-[hsl(219_45%_14%)]/15 group-hover:border-[hsl(219_45%_14%)]/40 group-hover:shadow-md transition-all">
              <CardContent className="p-7 md:p-8">
                <div className="flex items-center justify-between mb-5">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[hsl(327_77%_30%)] text-white">
                    <Wallet className="h-5 w-5" />
                  </span>
                  <span className="text-[10px] tracking-widest font-semibold text-[hsl(327_77%_30%)]">
                    INVESTOR
                  </span>
                </div>
                <h2 className="text-xl font-semibold tracking-tight">I'm an investor</h2>
                <p className="mt-2 text-sm text-[hsl(219_25%_30%)] leading-relaxed">
                  Sign in to view your invitation or portfolio.
                </p>
                <div className="mt-6 inline-flex items-center text-sm font-medium text-[hsl(184_98%_22%)] group-hover:translate-x-1 transition-transform">
                  Sign in <ArrowRight className="ml-1.5 h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          </button>
        </div>

        {/* Investor disclaimer */}
        <p
          className="mt-8 text-sm text-[hsl(219_25%_30%)] max-w-2xl leading-relaxed"
          data-testid="text-investor-disclaimer"
        >
          Investors join Capavate by invitation only. If a founder has invited you to a round,
          check your email for the secure invitation link.
        </p>

        {/* Demo-only: token tray (preview tooling, hidden by default) */}
        <div className="mt-12 border-t border-black/5 pt-6">
          <button
            onClick={() => setShowTokens((s) => !s)}
            className="text-xs text-[hsl(219_45%_30%)]/70 hover:text-[hsl(219_45%_14%)]"
            data-testid="button-toggle-demo-tokens"
          >
            {showTokens ? "Hide" : "Show"} preview redemption tokens
          </button>
          {showTokens && (
            <div className="mt-4 grid md:grid-cols-3 gap-3" data-testid="demo-token-tray">
              {asArray(demoTokens.data).map((t) => (
                <div key={t.id} className="border border-black/10 rounded-md p-3 bg-white text-xs">
                  <div className="font-medium">{t.companyName}</div>
                  <div className="text-[hsl(219_25%_30%)] mt-0.5">{t.inviteeName}</div>
                  <div className="text-[hsl(219_25%_30%)]">{t.inviteeEmail}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyTokenLink(t)}
                      className="h-7 text-[11px]"
                      data-testid={`button-copy-token-${t.id}`}
                    >
                      {copiedId === t.id ? <><Check className="h-3 w-3 mr-1" /> Copied</> : <><Copy className="h-3 w-3 mr-1" /> Copy URL</>}
                    </Button>
                    <Link
                      href={`/auth/redeem?token=${t.rawToken}`}
                      className="text-[11px] text-[hsl(184_98%_22%)] underline underline-offset-2"
                      data-testid={`link-token-${t.id}`}
                    >
                      Open
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Footer chips */}
      <footer className="px-6 md:px-10 py-6 border-t border-black/5 flex items-center gap-6 text-xs text-[hsl(219_25%_30%)]">
        <span className="inline-flex items-center gap-1.5" data-testid="chip-soc2">
          <ShieldCheck className="h-3.5 w-3.5" /> SOC 2 Type II
        </span>
        <span className="inline-flex items-center gap-1.5" data-testid="chip-collective">
          <Sparkles className="h-3.5 w-3.5" /> Connected to Capavate Collective
        </span>
        <div className="flex-1" />
        {import.meta.env.DEV && (
          <span className="text-[10px] text-[hsl(219_25%_30%)]/60" data-testid="chip-sprint">Sprint 15 · login + entitlement</span>
        )}
      </footer>
    </div>
  );
}
