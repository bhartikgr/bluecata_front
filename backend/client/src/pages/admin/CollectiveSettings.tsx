/**
 * v25.47 APD-031 (HIGH-3) — Admin Collective Settings (real DB-driven form).
 *
 * Reads GET /api/admin/collective-settings and merge-patches via PUT on save.
 * Nothing is hardcoded — the form hydrates from the persisted settings row and
 * writes back through the canonical admin route. Mounted at both
 * /admin/collective/settings and /admin/collective-settings.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CollectiveSettings {
  applicationsOpen: boolean;
  membershipHeadline: string;
  membershipBlurb: string;
  supportEmail: string;
  internalNote: string;
}

interface SettingsResponse {
  ok: boolean;
  settings: CollectiveSettings;
}

export default function CollectiveSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<SettingsResponse>({
    queryKey: ["/api/admin/collective-settings"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/collective-settings")).json(),
    retry: false,
  });

  const [form, setForm] = useState<CollectiveSettings | null>(null);
  useEffect(() => {
    if (data?.settings) setForm(data.settings);
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async (patch: CollectiveSettings): Promise<SettingsResponse> => {
      const resp = await apiRequest("PUT", "/api/admin/collective-settings", patch);
      return resp.json();
    },
    onSuccess: (resp) => {
      qc.setQueryData(["/api/admin/collective-settings"], resp);
      toast({ title: "Saved", description: "Collective settings updated." });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Save failed", description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Collective Settings"
        description="Admin-tunable configuration for the Collective surface. Saved to the database and reflected on the public membership page."
        breadcrumbs={[{ href: "/admin/dashboard", label: "Admin" }, { label: "Collective Settings" }]}
      />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-[#041e41]" /> Collective settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !form ? (
              <p className="text-sm text-muted-foreground" data-testid="collective-settings-loading">
                Loading settings…
              </p>
            ) : error ? (
              <p className="text-sm text-rose-600" data-testid="collective-settings-error">
                Could not load settings. Please retry.
              </p>
            ) : (
              <form
                data-testid="collective-settings-form"
                className="space-y-6 max-w-xl"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  saveMut.mutate(form);
                }}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="applicationsOpen">Applications open</Label>
                    <p className="text-xs text-muted-foreground">
                      Whether the Collective is accepting new founder applications.
                    </p>
                  </div>
                  <Switch
                    id="applicationsOpen"
                    checked={form.applicationsOpen}
                    onCheckedChange={(v) => setForm({ ...form, applicationsOpen: v })}
                    data-testid="input-applications-open"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="membershipHeadline">Membership headline</Label>
                  <Input
                    id="membershipHeadline"
                    value={form.membershipHeadline}
                    onChange={(ev) => setForm({ ...form, membershipHeadline: ev.target.value })}
                    data-testid="input-membership-headline"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="membershipBlurb">Membership blurb</Label>
                  <Textarea
                    id="membershipBlurb"
                    value={form.membershipBlurb}
                    onChange={(ev) => setForm({ ...form, membershipBlurb: ev.target.value })}
                    data-testid="input-membership-blurb"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="supportEmail">Support email</Label>
                  <Input
                    id="supportEmail"
                    type="email"
                    value={form.supportEmail}
                    onChange={(ev) => setForm({ ...form, supportEmail: ev.target.value })}
                    data-testid="input-support-email"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="internalNote">Internal note (never shown publicly)</Label>
                  <Textarea
                    id="internalNote"
                    value={form.internalNote}
                    onChange={(ev) => setForm({ ...form, internalNote: ev.target.value })}
                    data-testid="input-internal-note"
                  />
                </div>

                <Button type="submit" disabled={saveMut.isPending} data-testid="save-collective-settings-btn">
                  {saveMut.isPending ? "Saving…" : "Save settings"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
