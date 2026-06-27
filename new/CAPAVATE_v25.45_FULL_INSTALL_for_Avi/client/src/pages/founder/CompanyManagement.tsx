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
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PageHeader, PageBody } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useActiveCompanyId } from "@/lib/useActiveCompany";

type TeamMember = { id: string; name?: string; email?: string; role: string };
type Invitation = { id: string; invitedEmail: string; role: string; status: string; sentAt?: string | null };

function TeamPanel() {
  const { toast } = useToast();
  const companyId = useActiveCompanyId();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");

  const members = useQuery<TeamMember[]>({
    queryKey: ["/api/founder/team/members"],
    enabled: Boolean(companyId),
  });
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
        <CardHeader><CardTitle className="text-base">Team members</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(members.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="team-empty">No team members yet.</p>
          )}
          {(members.data ?? []).map((m) => (
            <div key={m.id} className="flex items-center justify-between text-sm border-b border-border py-1.5" data-testid={`team-member-${m.id}`}>
              <span>{m.name ?? m.email}</span>
              <span className="text-muted-foreground">{m.role}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Invite a teammate</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Email</Label><Input className="mt-1" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@company.com" data-testid="input-invite-email" /></div>
          <div><Label>Name (optional)</Label><Input className="mt-1" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Full name" data-testid="input-invite-name" /></div>
          <Button onClick={() => inviteMut.mutate()} disabled={inviteMut.isPending || !inviteEmail.trim()} data-testid="button-send-invite">
            {inviteMut.isPending ? "Sending…" : "Send invitation"}
          </Button>
          <div className="pt-2 space-y-1">
            {(invites.data?.invitations ?? []).map((i) => (
              <div key={i.id} className="flex items-center justify-between text-xs text-muted-foreground" data-testid={`invite-${i.id}`}>
                <span>{i.invitedEmail}</span>
                <span>{i.sentAt ? "sent" : i.status}</span>
              </div>
            ))}
          </div>
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
