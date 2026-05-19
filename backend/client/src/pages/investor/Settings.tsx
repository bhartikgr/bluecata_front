/**
 * Sprint 22 Wave 2 — Investor Settings page.
 *
 * Wave 2 fixes (DEF-012):
 *   - Profile section Edit → "Edit in profile" Link to /investor/profile
 *   - Timezone → inline editable with Select (IANA list). Save via PATCH /api/auth/me.
 *   - Notifications → inline editable switches. Save via PATCH /api/auth/me.
 *   - Privacy / Billing → disabled with "Coming in Wave 3" badge.
 *   - Accreditation → disabled with "Coming soon" badge.
 *   - All actionable buttons have data-testid.
 *   - SSE invalidation hook on `user` aggregate.
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings, Bell, Shield, User, CreditCard, Globe } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeSync } from "@/lib/realtimeSync";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

/* ------------------------------------------------------------------ */
/* Common IANA timezones list                                           */
/* ------------------------------------------------------------------ */
const TIMEZONES = [
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "America/Toronto",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Kolkata",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Melbourne",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Dublin",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Europe/Stockholm",
  "Europe/Zurich",
  "Pacific/Auckland",
];

/* ------------------------------------------------------------------ */
/* NotificationPrefs type                                              */
/* ------------------------------------------------------------------ */
type NotifPrefs = {
  emailDigest: boolean;
  pushAlerts: boolean;
  inAppToasts: boolean;
};

/* ------------------------------------------------------------------ */
/* Me type (minimal)                                                   */
/* ------------------------------------------------------------------ */
type MeData = {
  id?: string;
  timezone?: string;
  notificationPrefs?: NotifPrefs;
};

export default function InvestorSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Subscribe to user aggregate SSE events
  useRealtimeSync();

  const me = useQuery<MeData>({ queryKey: ["/api/auth/me"] });

  /* -------- Timezone edit state -------- */
  const [tzEditing, setTzEditing] = useState(false);
  const [tzValue, setTzValue] = useState<string>(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London"
  );

  useEffect(() => {
    if (me.data?.timezone) setTzValue(me.data.timezone);
  }, [me.data?.timezone]);

  /* -------- Notification prefs edit state -------- */
  const [notifEditing, setNotifEditing] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>({
    emailDigest: true,
    pushAlerts: false,
    inAppToasts: true,
  });

  useEffect(() => {
    if (me.data?.notificationPrefs) setNotifPrefs(me.data.notificationPrefs);
  }, [me.data?.notificationPrefs]);

  /* -------- Dialog open state -------- */
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  const [accredDialogOpen, setAccredDialogOpen] = useState(false);

  /* -------- Save mutation -------- */
  const saveMut = useMutation({
    mutationFn: async (patch: Partial<{ timezone: string; notificationPrefs: NotifPrefs }>) => {
      const r = await apiRequest("PATCH", "/api/auth/me", patch);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "save_failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Settings saved" });
      qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setTzEditing(false);
      setNotifEditing(false);
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your Capavate investor account."
        breadcrumbs={[
          { href: "/investor/dashboard", label: "Workspace" },
          { label: "Settings" },
        ]}
      />
      <PageBody data-testid="page-investor-settings">
        <div className="max-w-2xl mx-auto space-y-4">

          {/* ---- Profile ---- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground flex items-center justify-between gap-4">
              <p>Your name, email, avatar and bio visible to founders.</p>
              <Link href="/investor/profile">
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  data-testid="button-edit-displayName"
                >
                  Edit in profile
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* ---- Timezone ---- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                Timezone
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {tzEditing ? (
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium mb-1 block">Your timezone</Label>
                    <Select value={tzValue} onValueChange={setTzValue}>
                      <SelectTrigger className="w-full max-w-xs" data-testid="select-timezone">
                        <SelectValue placeholder="Select timezone" />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz} value={tz} data-testid={`option-tz-${tz}`}>
                            {tz}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
                      onClick={() => saveMut.mutate({ timezone: tzValue })}
                      disabled={saveMut.isPending}
                      data-testid="button-save-settings"
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setTzEditing(false)}
                      data-testid="button-cancel-timezone"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <p>
                    {me.data?.timezone ?? tzValue}
                    <span className="ml-2 text-xs text-muted-foreground">
                      (Used for deadline countdowns and scheduled digest emails.)
                    </span>
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setTzEditing(true)}
                    data-testid="button-edit-timezone"
                  >
                    Edit
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---- Notifications ---- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bell className="h-4 w-4 text-muted-foreground" />
                Notifications
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {notifEditing ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {(
                      [
                        ["emailDigest", "Email digest"],
                        ["pushAlerts", "Push alerts"],
                        ["inAppToasts", "In-app toasts"],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between">
                        <Label className="text-sm font-normal">{label}</Label>
                        <Switch
                          checked={notifPrefs[key]}
                          onCheckedChange={(v) =>
                            setNotifPrefs((p) => ({ ...p, [key]: v }))
                          }
                          data-testid={`switch-notif-${key}`}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
                      onClick={() => saveMut.mutate({ notificationPrefs: notifPrefs })}
                      disabled={saveMut.isPending}
                      data-testid="button-save-notif-settings"
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setNotifEditing(false)}
                      data-testid="button-cancel-notif"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <p>Email and in-app notification preferences for invitations, round updates, and messages.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setNotifEditing(true)}
                    data-testid="button-edit-notifications"
                  >
                    Edit
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---- Privacy ---- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                Privacy &amp; visibility
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground flex items-center justify-between gap-4">
              <p>Control your screen name and co-member visibility on cap tables.</p>
              {/* DEF-015: link to profile page where privacy is merged */}
              <Link href="/investor/profile?step=1">
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  data-testid="button-edit-privacy"
                >
                  Open in profile
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* ---- Billing ---- */}
          {/* DEF-016: replace disabled button with informational dialog */}
          <Dialog open={billingDialogOpen} onOpenChange={setBillingDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Billing &amp; membership</DialogTitle>
                <DialogDescription>
                  Billing is managed through your Collective tier. Contact
                  billing@capavate.com for questions about your subscription.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <a href="mailto:billing@capavate.com">
                  <Button variant="outline">Email billing@capavate.com</Button>
                </a>
                <Button onClick={() => setBillingDialogOpen(false)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                Billing &amp; membership
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground flex items-center justify-between gap-4">
              <p>Manage your Collective membership tier, renewal dates, and invoices.</p>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setBillingDialogOpen(true)}
                data-testid="button-edit-billing"
              >
                Edit
              </Button>
            </CardContent>
          </Card>

          {/* ---- Accreditation ---- */}
          {/* DEF-017: replace disabled button with informational dialog */}
          <Dialog open={accredDialogOpen} onOpenChange={setAccredDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Accreditation</DialogTitle>
                <DialogDescription>
                  Accreditation status is currently managed through your Collective membership
                  profile. Visit your Collective profile or contact compliance@capavate.com
                  for updates.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <a href="mailto:compliance@capavate.com">
                  <Button variant="outline">Email compliance@capavate.com</Button>
                </a>
                <Button onClick={() => setAccredDialogOpen(false)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                Accreditation
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground flex items-center justify-between gap-4">
              <p>View and update your jurisdiction, KYC documents, and accreditation declaration.</p>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setAccredDialogOpen(true)}
                data-testid="button-edit-accreditation"
              >
                Edit
              </Button>
            </CardContent>
          </Card>

          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Settings className="h-3.5 w-3.5" />
                Capavate Investor Platform · v0.23.0
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive text-xs"
                data-testid="button-sign-out"
                onClick={async () => {
                  // DEF-014: call logout endpoint and redirect to login.
                  await apiRequest("POST", "/api/auth/logout").catch(() => {});
                  window.location.href = "/login";
                }}
              >
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </PageBody>
    </>
  );
}
