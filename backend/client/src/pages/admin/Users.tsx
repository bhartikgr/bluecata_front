/**
 * Sprint 17 D7 — Admin user management.
 *
 * Backed by /api/admin/users with real CRUD + audit + force-logout +
 * password reset. No mock client list — server is source of truth.
 */
import { useState, useMemo } from "react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { CheckCircle2, XCircle, ShieldCheck, MoreVertical, Plus, Download, RefreshCw, Search, KeyRound, LogOut, ShieldAlert, UserCog } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AdminPageIntro } from "@/components/AdminPageIntro";
import { useEntitlement } from "@/lib/entitlement"; /* v25.17 Lane D NC2 — prevent admin self-lockout */

interface AdminUser {
  id: string; email: string; name: string; role: string; tenant: string;
  status: string; mfa: boolean; lastLogin: string;
}

export default function AdminUsers() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  /* v25.17 Lane D NC2 — capture the logged-in admin's identity so we can disable destructive
     actions on their own row (demote, suspend, force logout, password reset). */
  const meQ = useEntitlement();
  const myUserId = meQ.data?.userId ?? null;
  const myEmailLower = (meQ.data?.identity?.email ?? "").toLowerCase();
  const isSelf = (u: AdminUser) => {
    if (!u) return false;
    if (myUserId && u.id === myUserId) return true;
    if (myEmailLower && (u.email ?? "").toLowerCase() === myEmailLower) return true;
    return false;
  };
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("founder");
  const [redeemLink, setRedeemLink] = useState<string | null>(null);

  const usersQ = useQuery<{ users: AdminUser[]; total: number }>({
    queryKey: ["/api/admin/users", q, role, status],
    queryFn: async () => {
      const url = `/api/admin/users?q=${encodeURIComponent(q)}&role=${role}&status=${status}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const inviteMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/users", {
        email: inviteEmail, name: inviteName, role: inviteRole,
      });
      return res.json() as Promise<{ user: AdminUser; redeemToken: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "User invited", description: `Invite token issued for ${data.user.email}` });
      // A2 (v24.0) — invite tokens live in auth_redeem_tokens and are consumed by the set-password flow.
      setRedeemLink(`/set-password?token=${data.redeemToken}`);
      setInviteOpen(false);
      setInviteEmail(""); setInviteName("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<AdminUser> }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}`, patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated" });
    },
  });

  const forceLogoutMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/users/${id}/force-logout`, {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Sessions revoked", description: `${data.sessionsRevoked} active sessions cleared.` });
    },
  });

  const resetPwMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/users/${id}/reset-password`, {});
      return res.json() as Promise<{ redeemToken: string }>;
    },
    onSuccess: (data) => {
      // A2 (v24.0) — reset tokens are consumed by the set-password flow, not the invitation redeem flow.
      setRedeemLink(`/set-password?token=${data.redeemToken}`);
      toast({ title: "Reset link generated", description: "Copy the token from the dialog." });
    },
  });

  const users = useMemo(() => usersQ.data?.users ?? [], [usersQ.data]);

  return (
    <>
      <PageHeader
        title="Users & Auth"
        description="Real user list backed by auth_users. Manage roles, suspend, force-logout, reset password, and audit."
        breadcrumbs={[{ label: "Admin" }, { label: "Users & Auth" }]}
        actions={
          <div className="flex gap-2">
            <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> JWT-backed</Badge>
            <Button size="sm" variant="outline" data-testid="button-export-users" onClick={async () => {
              const res = await apiRequest("GET", "/api/admin/users/export");
              const text = await res.text();
              const blob = new Blob([text], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = `users-${Date.now()}.csv`; a.click();
              URL.revokeObjectURL(url);
            }}>
              <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
            </Button>
            <Button size="sm" data-testid="button-invite-user" onClick={() => setInviteOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Invite user
            </Button>
          </div>
        }
      />
      <PageBody>
        <AdminPageIntro
          guidance={{
            eyebrow: "Identity & access control",
            title: "Users & Auth — every human and service principal who can touch Capavate",
            description:
              "Provision, audit, and revoke access for founders, investors, admins, partner counsel, and ops. Every create, edit, role-change, force-logout, and password-reset is captured in the Audit Log with a tamper-evident hash chain. MFA enrolment and last-login signals help you spot dormant accounts that should be deactivated.",
            warning:
              "Role escalation (founder → admin, investor → founder) is irreversible from the user's session perspective — force-logout is required to apply immediately. Always require MFA on accounts with admin or finance permissions (SOC 2 CC6.1).",
            positive:
              "Invitations are signed one-time-use links with a 21-day default expiry (configurable in Lifecycle Policies). Redemption is rate-limited per IP and the token is invalidated after first use.",
          }}
          stats={[
            { label: "Total users", value: usersQ.data?.total ?? "—", hint: "All roles" },
            { label: "Active", value: (usersQ.data?.users ?? []).filter(u => u.status === "active").length, tone: "positive" },
            { label: "MFA on", value: (usersQ.data?.users ?? []).filter(u => u.mfa).length, hint: "Of total", tone: "positive" },
            { label: "Without MFA", value: (usersQ.data?.users ?? []).filter(u => !u.mfa).length, hint: "Review weekly", tone: (usersQ.data?.users ?? []).some(u => !u.mfa) ? "warning" : "neutral" },
            { label: "Pending invite", value: (usersQ.data?.users ?? []).filter(u => u.status === "pending").length, hint: "Awaiting redemption" },
          ]}
        />
        <Card className="mb-4">
          <CardContent className="p-4 flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, email, tenant"
                className="pl-9"
                value={q}
                onChange={e => setQ(e.target.value)}
                data-testid="input-user-search"
              />
            </div>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-44" data-testid="select-role-filter"><SelectValue placeholder="Role" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="founder">Founder</SelectItem>
                <SelectItem value="investor">Investor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44" data-testid="select-status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={() => usersQ.refetch()} data-testid="button-refresh-users">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="px-0">
            <table className="w-full text-sm" data-testid="table-users">
              <thead>
                <tr className="text-xs uppercase text-muted-foreground border-b border-border">
                  <th className="text-left font-medium px-6 py-2.5">User</th>
                  <th className="text-left font-medium px-3 py-2.5">Role</th>
                  <th className="text-left font-medium px-3 py-2.5">Tenant</th>
                  <th className="text-left font-medium px-3 py-2.5">Status</th>
                  <th className="text-left font-medium px-3 py-2.5">MFA</th>
                  <th className="text-left font-medium px-3 py-2.5">Last login</th>
                  <th className="text-right font-medium px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersQ.isLoading && <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Loading…</td></tr>}
                {!usersQ.isLoading && users.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-muted-foreground py-6">No users match the current filters.</td></tr>
                )}
                {users.map(u => (
                  <tr key={u.id} className="border-b border-border/60 hover:bg-secondary/40" data-testid={`row-user-${u.id}`}>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8"><AvatarFallback className="bg-[hsl(184_98%_22%)]/15 text-[hsl(184_98%_22%)] text-xs font-semibold">{u.name.split(" ").map(s => s[0]).join("").slice(0, 2)}</AvatarFallback></Avatar>
                        <div>
                          <div className="font-medium" data-testid={`text-user-name-${u.id}`}>{u.name}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 capitalize">
                      <Badge className={u.role === "admin" ? "bg-[hsl(327_77%_30%)] text-white border-0" : "bg-secondary"}>{u.role}</Badge>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{u.tenant}</td>
                    <td className="px-3 py-3">
                      <Badge variant={u.status === "active" ? "default" : u.status === "suspended" ? "destructive" : "outline"}>{u.status}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      {u.mfa ? <span className="inline-flex items-center gap-1 text-emerald-600 text-xs"><CheckCircle2 className="h-3.5 w-3.5" /> MFA on</span>
                        : <span className="inline-flex items-center gap-1 text-rose-600 text-xs"><XCircle className="h-3.5 w-3.5" /> MFA off</span>}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{new Date(u.lastLogin).toLocaleString()}</td>
                    <td className="px-3 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" data-testid={`button-actions-${u.id}`}><MoreVertical className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {/* v25.17 Lane D NC2 — destructive actions disabled on the admin's own row */}
                          <DropdownMenuItem
                            disabled={isSelf(u)}
                            onClick={() => { if (isSelf(u)) { toast({ title: "Cannot demote yourself", description: "Ask another admin to change your role.", variant: "destructive" }); return; } updateMut.mutate({ id: u.id, patch: { role: u.role === "admin" ? "founder" : "admin" } }); }}
                          >
                            <UserCog className="h-3.5 w-3.5 mr-2" /> Toggle admin
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={isSelf(u)}
                            onClick={() => { if (isSelf(u)) { toast({ title: "Cannot suspend yourself", description: "Ask another admin to suspend this account.", variant: "destructive" }); return; } updateMut.mutate({ id: u.id, patch: { status: u.status === "active" ? "suspended" : "active" } }); }}
                          >
                            <ShieldAlert className="h-3.5 w-3.5 mr-2" />
                            {u.status === "active" ? "Suspend" : "Reactivate"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={isSelf(u)}
                            onClick={() => { if (isSelf(u)) { toast({ title: "Cannot force-logout yourself", variant: "destructive" }); return; } forceLogoutMut.mutate(u.id); }}
                          >
                            <LogOut className="h-3.5 w-3.5 mr-2" /> Force logout
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => resetPwMut.mutate(u.id)}>
                            <KeyRound className="h-3.5 w-3.5 mr-2" /> Reset password
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Invite dialog */}
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Invite a new user</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="email@example.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} data-testid="input-invite-email" />
              <Input placeholder="Full name" value={inviteName} onChange={e => setInviteName(e.target.value)} data-testid="input-invite-name" />
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger data-testid="select-invite-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="founder">Founder</SelectItem>
                  <SelectItem value="investor">Investor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button onClick={() => inviteMut.mutate()} disabled={inviteMut.isPending || !inviteEmail} data-testid="button-confirm-invite">
                {inviteMut.isPending ? "Sending…" : "Send invite"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Redeem-token reveal dialog */}
        <Dialog open={!!redeemLink} onOpenChange={() => setRedeemLink(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>One-time link</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              Copy this link and send it to the user. It expires automatically.
            </p>
            <div className="rounded border border-border bg-muted/30 p-3 text-xs break-all font-mono" data-testid="text-redeem-link">{redeemLink}</div>
            <DialogFooter>
              <Button onClick={() => { if (redeemLink) navigator.clipboard?.writeText(redeemLink); }}>Copy</Button>
              <Button variant="outline" onClick={() => setRedeemLink(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </>
  );
}
