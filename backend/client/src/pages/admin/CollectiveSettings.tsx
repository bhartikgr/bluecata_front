/**
 * v23.5 C-003 — Admin Collective Settings page (placeholder shell).
 *
 * v25.13 NL3 — page is not yet implemented; previously rendered a bare
 * "Coming soon" card under a production route. We now auto-redirect to the
 * working admin Collective dashboard with a one-time toast notice so admins
 * never land on an empty stub.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { Settings2 } from "lucide-react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export default function CollectiveSettings() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  useEffect(() => {
    toast({
      title: "Collective settings",
      description: "Admin settings are not yet available — redirected to the Collective dashboard.",
    });
    navigate("/admin/collective/dashboard");
  }, [navigate, toast]);
  return (
    <>
      <PageHeader
        title="Collective Settings"
        description="Configuration for the Collective subsystem."
        breadcrumbs={[{ href: "/admin/dashboard", label: "Admin" }, { label: "Collective Settings" }]}
      />
      <PageBody>
        <Card data-testid="collective-settings-placeholder">
          <CardContent className="pt-12 pb-12 text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
              <Settings2 className="w-7 h-7 text-slate-400" />
            </div>
            <div className="text-lg font-semibold">Redirecting…</div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Admin settings for the Collective subsystem are not yet available. You will be
              redirected to the Collective dashboard.
            </p>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
