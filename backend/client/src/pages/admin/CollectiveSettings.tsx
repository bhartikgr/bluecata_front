/**
 * v23.5 C-003 — Admin Collective Settings page (placeholder shell).
 *
 * For v23.5: empty shell establishing the route.
 * Future: DSC threshold config, presentation cadence, fee schedule, runtime toggle.
 */
import { Settings2 } from "lucide-react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";

export default function CollectiveSettings() {
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
            <div className="text-lg font-semibold">Coming soon</div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              DSC threshold configuration, presentation cadence, fee schedule, and the runtime
              Collective on/off toggle will ship here in v23.6.
            </p>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
