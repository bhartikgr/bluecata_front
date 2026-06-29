/**
 * v25.45 F8 — Company Management parent landing page.
 *
 * New left-nav item (directly below Company Profile). Hosts a sub-tab strip
 * with Team as the initial active tab (F8c). Team was moved out of the Settings
 * tab strip (F8a); the underlying team endpoints (/api/founder/team/*) are
 * unchanged and reused here. Future sub-tabs (Roles & Permissions, Workspace
 * Archive) slot into this strip in later waves — for now only Team is shown.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { PageHeader, PageBody } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useActiveCompanyId } from "@/lib/useActiveCompany";
import { HelpTipWithGlossary } from "@/components/HelpTip"; /* v25.45.4 C-1 — inline tooltip + Learn more link */

type TeamMember = { id: string; name?: string; email?: string; role: string };
type Invitation = { id: string; invitedEmail: string; role: string; status: string; sentAt?: string | null };

function TeamPanel() {
  const { toast } = useToast();
  const companyId = useActiveCompanyId();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");

  // v25.45.2 Bug G — GET /api/founder/team/members returns the documented
  // `{ members: [...] }` OBJECT shape (see routes.ts Bug L / Settings.tsx),
  // NOT a bare array. The old `useQuery<TeamMember[]>` + `(members.data ?? [])`
  // crashed in production with "(o.data ?? []).map is not a function" because
  // `members.data` was a defined non-array object so the `?? []` fallback
  // never fired. Type it correctly and extract defensively with Array.isArray.
  const members = useQuery<{ members: TeamMember[] }>({
    queryKey: ["/api/founder/team/members"],
    enabled: Boolean(companyId),
  });
  // Safe extraction: tolerate the documented object shape, a legacy bare
  // array, or any malformed payload — never let render hit `.map` on a non-array.
  const memberList: TeamMember[] = Array.isArray(members.data)
    ? (members.data as unknown as TeamMember[])
    : Array.isArray(members.data?.members)
      ? members.data.members
      : [];
  const invites = useQuery<{ invitations: Invitation[] }>({
    queryKey: ["/api/founder/team/invitations", companyId],
    queryFn: () => apiRequest("GET", `/api/founder/team/invitations?companyId=${encodeURIComponent(companyId ?? "")}`).then((r) => r.json()),
    enabled: Boolean(companyId),
  });

  const inviteMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/founder/team/invitations", {
        companyId, email: inviteEmail.trim(), name: inviteName.trim() || undefined,
      });
      return r.json();
    },
    onSuccess: (data) => {
      if (!data?.ok) {
        toast({ title: "Could not send invite", description: data?.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Invitation sent", description: `Invited ${inviteEmail.trim()}.` });
      setInviteEmail(""); setInviteName("");
      queryClient.invalidateQueries({ queryKey: ["/api/founder/team/invitations", companyId] });
    },
    onError: (e: any) => toast({ title: "Could not send invite", description: e?.message ?? "Please try again.", variant: "destructive" }),
  });

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card>
        {/* v25.45.4 C-2 (LIVE-11) — "Team members" is the parent (h2) under the
            page H1; "Invite a teammate" below is rendered as h3. Explicit
            heading levels restore the parent/child hierarchy that was flat
            (both equal weight under H1).
            v25.45.4 C-1 (LIVE-10) — contextual (?) tooltip with a Learn-more
            glossary deep-link replaces the old ambiguous bare glossary link. */}
        <CardHeader>
          <h2 className="text-base font-semibold leading-none tracking-tight flex items-center gap-1.5" data-testid="heading-team-members">
            Team members
            <HelpTipWithGlossary glossarySlug="term-Common-Shares" testid="help-team-members">
              People with access to this workspace and their roles. Owners and
              admins can invite teammates and manage access.
            </HelpTipWithGlossary>
          </h2>
        </CardHeader>
        <CardContent className="space-y-2">
          {memberList.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="team-empty">No team members yet.</p>
          )}
          {memberList.map((m) => (
            <div key={m.id} className="flex items-center justify-between text-sm border-b border-border py-1.5" data-testid={`team-member-${m.id}`}>
              <span>{m.name ?? m.email}</span>
              <span className="text-muted-foreground">{m.role}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h3 className="text-sm font-medium leading-none tracking-tight flex items-center gap-1.5" data-testid="heading-invite-teammate">
            Invite a teammate
            <HelpTipWithGlossary glossarySlug="term-Common-Shares" testid="help-invite-teammate">
              Send an email invitation. The invitee accepts to join this
              workspace with the role you assign.
            </HelpTipWithGlossary>
          </h3>
        </CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Email</Label><Input className="mt-1" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@company.com" data-testid="input-invite-email" /></div>
          <div><Label>Name (optional)</Label><Input className="mt-1" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Full name" data-testid="input-invite-name" /></div>
          <Button onClick={() => inviteMut.mutate()} disabled={inviteMut.isPending || !inviteEmail.trim()} data-testid="button-send-invite">
            {inviteMut.isPending ? "Sending…" : "Send invitation"}
          </Button>
          {/* v25.45.4 L-1 (LIVE-9) — Pending invitations list. Previously this
              rendered a bare status ("pending") for EVERY row even when the
              invite had no usable invitedEmail, producing orphan "pending"
              labels with nothing attached. We now (a) keep only invitations
              that carry a real recipient email, (b) label the section, and
              (c) show an explicit empty-state when there are none — "real
              pending-invite list or nothing" (choice 2b). */}
          {(() => {
            const allInvites = Array.isArray(invites.data?.invitations) ? invites.data!.invitations : [];
            const realInvites = allInvites.filter(
              (i) => typeof i.invitedEmail === "string" && i.invitedEmail.trim() !== "",
            );
            return (
              <div className="pt-2 space-y-1" data-testid="pending-invitations">
                <p className="text-xs font-medium text-foreground">Pending invitations</p>
                {realInvites.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="pending-invitations-empty">
                    No pending invitations.
                  </p>
                ) : (
                  realInvites.map((i) => (
                    <div key={i.id} className="flex items-center justify-between text-xs text-muted-foreground" data-testid={`invite-${i.id}`}>
                      <span>{i.invitedEmail}</span>
                      <span>{i.sentAt ? "sent" : i.status}</span>
                    </div>
                  ))
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}

export default function CompanyManagement() {
  return (
    <>
      <PageHeader
        title="Company Management"
        description="Manage your workspace team, roles, and access. More controls arrive here over time."
        breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Company Management" }]}
      />
      <PageBody>
        <Tabs defaultValue="team" className="w-full">
          <TabsList data-testid="company-management-tabs">
            <TabsTrigger value="team" data-testid="cm-tab-team"><Users className="h-3.5 w-3.5 mr-1" /> Team</TabsTrigger>
          </TabsList>
          <TabsContent value="team" className="mt-4">
            <TeamPanel />
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
