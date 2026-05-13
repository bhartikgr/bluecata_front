/**
 * Sprint 15 D7 — Investor State 1 "compelled to invest" nudge.
 *
 * Per design Part 4 §State 1:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  Welcome to Capavate                                         │
 *   │  You haven't invested in any company on Capavate yet.        │
 *   │  Once you fund a round, you unlock full access:              │
 *   │   ✓ Communicate directly with founders                       │
 *   │   ✓ Join the cap-table channel for every company you back    │
 *   │   ✓ Access dataroom and investor reports                     │
 *   │   ✓ Apply to the Capavate Collective                         │
 *   │  ┌─ YOUR PENDING INVITATIONS (3) ─┐                          │
 *   │  │ • NovaPay AI · Seed · view →   │                          │
 *   │  └────────────────────────────────┘                          │
 *   │  [Review my invitations]                                     │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Rendered when investor.state === "INVITED_ONLY" or capTablePositions === 0.
 * SANDBOX-SAFE: no Web Storage APIs.
 */
import { useLocation } from "wouter";
import {
  Sparkles, MessageSquare, Users, FileText, Crown, ArrowRight, Inbox, Mail,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageBody, PageHeader } from "@/components/AppShell";
import type { InvitedRound, UserContext } from "@/lib/entitlement";

export interface InvestorState1NudgeProps {
  ctx: UserContext;
}

const UNLOCKS = [
  { icon: MessageSquare, label: "Communicate directly with founders" },
  { icon: Users,         label: "Join the cap-table channel for every company you back" },
  { icon: FileText,      label: "Access dataroom and investor reports" },
  { icon: Crown,         label: "Apply to the Capavate Collective" },
];

export function InvestorState1Nudge({ ctx }: InvestorState1NudgeProps) {
  const [, navigate] = useLocation();
  const invitations = ctx.investor.invitedRounds;
  const screenName = ctx.identity.screenName ?? ctx.identity.name?.split(" ")[0] ?? "investor";

  return (
    <div data-testid="investor-state1-nudge" data-investor-state={ctx.investor.state}>
      <PageHeader
        title="Welcome to Capavate"
        description={`Hi ${screenName} — your pending invitations are below. Fund a round to unlock the full investor workspace.`}
      />
      <PageBody>
        <div className="max-w-3xl mx-auto">
          {/* Hero card */}
          <Card className="mb-6 overflow-hidden border-primary/30 bg-gradient-to-br from-primary/[0.03] to-transparent">
            <CardContent className="p-7">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-9 w-9 rounded-md bg-primary/10 grid place-items-center text-primary">
                  <Sparkles className="h-4 w-4" />
                </div>
                <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                  Investor onboarding
                </Badge>
              </div>
              <h2 className="text-lg font-semibold mb-1">
                You haven't invested in any company on Capavate yet.
              </h2>
              <p className="text-sm text-muted-foreground mb-5">
                Once you fund a round, you unlock full access to the investor workspace:
              </p>
              <ul className="space-y-2.5">
                {UNLOCKS.map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-start gap-3 text-sm" data-testid={`unlock-${label.toLowerCase().replace(/\s+/g, "-").slice(0, 30)}`}>
                    <span className="mt-0.5 h-5 w-5 rounded-full bg-primary/10 grid place-items-center text-primary shrink-0">
                      <Icon className="h-3 w-3" />
                    </span>
                    <span className="leading-snug">{label}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Pending invitations card */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Inbox className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm tracking-wide uppercase text-muted-foreground">
                    Your pending invitations
                  </h3>
                  <Badge variant="secondary" data-testid="badge-invitation-count">
                    {invitations.length}
                  </Badge>
                </div>
              </div>

              {invitations.length === 0 ? (
                <div className="text-center py-10" data-testid="empty-no-invitations">
                  <Mail className="h-7 w-7 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No invitations yet. When a founder invites you to a round, it'll appear here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y">
                  {invitations.map((inv: InvitedRound) => (
                    <li
                      key={inv.invitationId}
                      className="flex items-center justify-between py-3 group cursor-pointer hover:bg-muted/30 -mx-2 px-2 rounded transition"
                      data-testid={`invitation-row-${inv.invitationId}`}
                      onClick={() => navigate(`/investor/invitations/${inv.invitationId}`)}
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">
                          {inv.companyName}
                          <span className="text-muted-foreground"> · {inv.roundName}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {inv.state === "PENDING" ? "Awaiting your decision" : `State: ${inv.state}`}
                        </div>
                      </div>
                      <span className="inline-flex items-center text-xs text-primary group-hover:translate-x-0.5 transition">
                        View round <ArrowRight className="h-3 w-3 ml-1" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-6">
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => navigate("/investor/invitations")}
                  data-testid="button-review-invitations"
                  disabled={invitations.length === 0}
                >
                  <Inbox className="h-4 w-4 mr-2" />
                  Review my invitations
                </Button>
              </div>
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground text-center mt-6">
            Investors join Capavate by invitation only. Communication, dataroom, and Collective
            access unlock automatically when you fund your first round.
          </p>
        </div>
      </PageBody>
    </div>
  );
}

export default InvestorState1Nudge;
