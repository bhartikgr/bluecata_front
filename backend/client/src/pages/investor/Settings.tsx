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
import { useState, useEffect, useMemo } from "react";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeSync } from "@/lib/realtimeSync";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { AccreditationDeclaration } from "@/components/investor/AccreditationDeclaration"; /* W3-B C-5 */
import { PortalVersionFooter } from "@/components/PortalVersionFooter"; /* WAVE 90 · ITEM 2 (M-1) */

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
  /* AVI-TZ (Wave 3) — the PERSISTED value is the source of truth. The old code
     seeded `tzValue` from the browser (Intl) and only *maybe* overwrote it via
     an effect once the `me` query resolved, so the Select could display the
     browser default instead of the saved me.timezone. Now:
       - browserTz is only a FALLBACK computed once;
       - the displayed/persisted tz derives from me.data?.timezone ?? browserTz;
       - the edit buffer (tzValue) is seeded/reset FROM the persisted value
         whenever the query resolves or changes, so entering edit / cancel /
         save all read the saved value (never the stale browser default).
     Backend unchanged (save still PATCH /api/auth/me). */
  const browserTz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London",
    []
  );
  // The effective persisted timezone: saved value wins; browser only when unset.
  const savedTz = me.data?.timezone ?? browserTz;

  const [tzEditing, setTzEditing] = useState(false);
  // Local edit buffer, seeded from the persisted value (browser fallback only
  // when nothing is saved).
  const [tzValue, setTzValue] = useState<string>(savedTz);

  // Keep the edit buffer in sync with the persisted value whenever the me query
  // resolves/refetches. Only reseed while NOT actively editing so an in-progress
  // edit isn't clobbered by a background refetch.
  useEffect(() => {
    if (!tzEditing) setTzValue(savedTz);
  }, [savedTz, tzEditing]);

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
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                data-testid="button-edit-displayName"
                asChild
              >
                <Link href="/investor/profile">
                  Edit in profile
                </Link>
              </Button>
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
                      className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
                      onClick={() => saveMut.mutate({ timezone: tzValue })}
                      disabled={saveMut.isPending}
                      data-testid="button-save-settings"
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setTzValue(savedTz); setTzEditing(false); }}
                      data-testid="button-cancel-timezone"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <p>
                    {savedTz}
                    <span className="ml-2 text-xs text-muted-foreground">
                      (Used for deadline countdowns and scheduled digest emails.)
                    </span>
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => { setTzValue(savedTz); setTzEditing(true); }}
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
                      className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
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
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                data-testid="button-edit-privacy"
                asChild
              >
                <Link href="/investor/profile?step=1">
                  Open in profile
                </Link>
              </Button>
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
          {/* W3-B C-5 — live accredited-investor self-certification capture,
              replacing the prior DEF-017 informational placeholder. */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                Accreditation
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <p>Complete or re-certify your accredited-investor self-certification below.</p>
              <AccreditationDeclaration />
            </CardContent>
          </Card>

          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              {/* ═══════════════════════════════════════════════════════════════
                  WAVE 90 · ITEM 2 (M-1) — THIS LINE WAS THE `v0.23.0`.

                  It was a hardcoded JSX text node. Not a build, not a second
                  package.json, not a stale constant read from anywhere — a
                  literal, in this file, that no process could ever update. The
                  repo's one package.json says 26.19.0.

                  It is replaced by `PortalVersionFooter`, which reads the version
                  the running server resolved from the shipped package.json and
                  serves on /api/healthz — the SAME source the admin footer reads.

                  THE REMOVED TEXT IS ACCOUNTED FOR, not allowlisted. The silent-
                  drop guard will report the copy string
                  `Capavate Investor Platform · v0.23.0` as removed. That is
                  correct and it is the point: the string was false. The product
                  name survives verbatim as the `productName` prop; only the false
                  number is gone, and it is gone because it cannot be true.
                  Itemised in build_log/wave90/W90_VERSION_TRUTH.md.
                  ═══════════════════════════════════════════════════════════════ */}
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Settings className="h-3.5 w-3.5" />
                <PortalVersionFooter
                  productName="Capavate Investor Platform"
                  testId="investor-portal-version"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive text-xs"
                data-testid="button-sign-out"
                onClick={async () => {
                  // DEF-014 + v23.4.6 Phase 3 (L-002): call logout endpoint,
                  // invalidate the TanStack Query cache (so a stale
                  // ["/api/auth/me"] entry can't keep the user appearing logged
                  // in), then redirect to login via a full-page navigation so
                  // the new request picks up the cleared Set-Cookie.
                  await apiRequest("POST", "/api/auth/logout").catch(() => {});
                  // W-CAP LW-2 (2026-07-17) — fully clear client auth/identity
                  // cache on logout so the login page cannot silently re-auth
                  // from a stale /api/auth/me entry.
                  await queryClient.cancelQueries();
                  queryClient.clear();
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
