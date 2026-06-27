/**
 * v25.42 W8 — Operations console card (admin-only).
 * Client-side conditional render gate on ctx.isAdmin === true (read from
 * /api/auth/me). Defense-in-depth: the linked admin surfaces are themselves
 * server-gated. Renders THREE quick-link tiles to the admin surfaces.
 *
 * Returns null for non-admins (no flash of admin content).
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { ShieldCheck, LayoutDashboard, FileText, ScrollText } from "lucide-react";
import { useMe } from "./useMe";

const TILES = [
  { href: "/admin/dashboard", label: "Admin Dashboard", icon: LayoutDashboard, testid: "ops-tile-dashboard" },
  { href: "/admin/collective/applications", label: "Applications", icon: FileText, testid: "ops-tile-applications" },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText, testid: "ops-tile-audit-log" },
];

export function OperationsConsoleCard() {
  const { data, isLoading } = useMe();

  // While loading, render nothing (avoid a non-admin flash). After load, gate
  // strictly on isAdmin === true.
  if (isLoading) {
    return <Skeleton className="h-28 w-full" data-testid="widget-ops-loading" />;
  }
  if (data?.isAdmin !== true) {
    return null;
  }

  return (
    <Card data-testid="widget-ops-console" className="border-[#cc0001]/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
          <ShieldCheck className="h-4 w-4 text-[#cc0001]" />
          Operations Console
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="widget-ops-tiles">
          {TILES.map((t) => (
            <Link key={t.href} href={t.href}>
              <div
                className="rounded-md border border-slate-200 p-4 hover:border-[#cc0001]/40 transition-colors cursor-pointer flex items-center gap-3"
                data-testid={t.testid}
              >
                <t.icon className="h-5 w-5 text-[#cc0001]" />
                <span className="text-sm font-medium" style={{ color: "#1A1A2E" }}>
                  {t.label}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
