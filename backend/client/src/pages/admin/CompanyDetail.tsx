/**
 * Sprint 29 KL-01 — Admin Company Detail (live profile data)
 *
 * Replaces hardcoded FOUNDER_PROFILE_FIELDS + MA_FIELDS with live data
 * from GET /api/admin/companies/:id/profile.
 *
 * Per-section "Edit" buttons open a Sheet drawer with inline field editing.
 * Save requires x-confirm: true (handled via custom fetch).
 * All fields are optional — empty values shown as "—".
 */

import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Pencil, CheckCircle2 } from "lucide-react";

/* ============================================================
 * Types
 * ============================================================ */
interface CompanyFullRow {
  id: string;
  name: string;
  region: string;
  sector: string;
  stage: string;
}

interface CompanyProfile {
  companyId: string;
  founderName?: string;
  founderEmail?: string;
  founderPhone?: string;
  hqAddress?: string;
  jurisdiction?: string;
  incorporationDate?: string;
  sector?: string;
  stage?: string;
  employees?: number;
  runwayMonths?: number;
  lastRaiseDate?: string;
  lastRaiseAmount?: number;
  valuationMinor?: number;
  equityIssuedPct?: number;
  dilutionPct?: number;
  advisorBoardSize?: number;
  esopPoolPct?: number;
  dataroomReadiness?: string;
  kycStatus?: string;
  kybStatus?: string;
  complianceScore?: number;
  healthScore?: number;
  regulatoryRegion?: string;
  board_size?: number;
  ma_active_flag?: boolean;
  ma_advisor_name?: string;
  ma_target_close_date?: string;
  ma_stage?: string;
  ma_buyer_pool_size?: number;
  ma_notes?: string;
  customFields?: Record<string, string>;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

/* ============================================================
 * Field config
 * ============================================================ */
const PROFILE_SECTION: Array<{ key: keyof CompanyProfile; label: string; type?: string }> = [
  { key: "founderName", label: "Founder name" },
  { key: "founderEmail", label: "Founder email", type: "email" },
  { key: "founderPhone", label: "Founder phone", type: "tel" },
  { key: "hqAddress", label: "HQ address" },
  { key: "jurisdiction", label: "Jurisdiction" },
  { key: "incorporationDate", label: "Incorporation date", type: "date" },
  { key: "sector", label: "Sector" },
  { key: "stage", label: "Stage" },
  { key: "employees", label: "Employees", type: "number" },
  { key: "runwayMonths", label: "Runway (months)", type: "number" },
  { key: "lastRaiseDate", label: "Last raise date", type: "date" },
  { key: "lastRaiseAmount", label: "Last raise (minor units)", type: "number" },
  { key: "valuationMinor", label: "Valuation (minor units)", type: "number" },
  { key: "equityIssuedPct", label: "Equity issued (%)", type: "number" },
  { key: "dilutionPct", label: "Dilution (%)", type: "number" },
  { key: "advisorBoardSize", label: "Advisor board size", type: "number" },
  { key: "esopPoolPct", label: "ESOP pool (%)", type: "number" },
  { key: "dataroomReadiness", label: "Dataroom readiness" },
  { key: "kycStatus", label: "KYC status" },
  { key: "kybStatus", label: "KYB status" },
  { key: "complianceScore", label: "Compliance score", type: "number" },
  { key: "healthScore", label: "Health score", type: "number" },
  { key: "regulatoryRegion", label: "Regulatory region" },
  { key: "board_size", label: "Board size", type: "number" },
];

const MA_SECTION: Array<{ key: keyof CompanyProfile; label: string; type?: string }> = [
  { key: "ma_active_flag", label: "M&A active", type: "text" },
  { key: "ma_advisor_name", label: "Advisor name" },
  { key: "ma_target_close_date", label: "Target close date", type: "date" },
  { key: "ma_stage", label: "M&A stage" },
  { key: "ma_buyer_pool_size", label: "Buyer pool size", type: "number" },
  { key: "ma_notes", label: "M&A notes", type: "textarea" },
];

/* ============================================================
 * EditDrawer
 * ============================================================ */
interface EditDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  fields: Array<{ key: keyof CompanyProfile; label: string; type?: string }>;
  profile: CompanyProfile;
  companyId: string;
}

function EditDrawer({ open, onClose, title, fields, profile, companyId }: EditDrawerProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});

  function setValue(key: string, val: string) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  function getVal(key: string): string {
    if (draft[key] !== undefined) return draft[key];
    const v = (profile as any)[key];
    if (v === undefined || v === null) return "";
    return String(v);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Convert numeric fields back to numbers
      const patch: Record<string, unknown> = {};
      for (const f of fields) {
        if (draft[f.key] !== undefined) {
          const raw = draft[f.key];
          if (f.type === "number") {
            const n = raw === "" ? undefined : Number(raw);
            patch[f.key] = isNaN(n as number) ? undefined : n;
          } else {
            patch[f.key] = raw === "" ? undefined : raw;
          }
        }
      }
      const res = await fetch(`/api/admin/companies/${companyId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-confirm": "true" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies", companyId, "profile"] });
      toast({ title: "Profile saved", description: "Changes saved and audited." });
      setDraft({});
      onClose();
    },
    onError: (e) => {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[460px] sm:max-w-[460px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">{title}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {fields.map((f) => (
            <div key={String(f.key)} className="space-y-1">
              <Label htmlFor={`field-${String(f.key)}`} className="text-xs">
                {f.label}
              </Label>
              {f.type === "textarea" ? (
                <Textarea
                  id={`field-${String(f.key)}`}
                  value={getVal(String(f.key))}
                  onChange={(e) => setValue(String(f.key), e.target.value)}
                  className="text-sm"
                  rows={3}
                  data-testid={`input-${String(f.key)}`}
                />
              ) : (
                <Input
                  id={`field-${String(f.key)}`}
                  type={f.type ?? "text"}
                  value={getVal(String(f.key))}
                  onChange={(e) => setValue(String(f.key), e.target.value)}
                  className="text-sm h-8"
                  data-testid={`input-${String(f.key)}`}
                />
              )}
            </div>
          ))}
        </div>

        <SheetFooter className="mt-6 flex gap-2">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || Object.keys(draft).length === 0}
            className="gap-1.5"
            data-testid="btn-save-profile"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {saveMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
          <SheetClose asChild>
            <Button variant="outline" data-testid="btn-cancel-edit">Cancel</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ============================================================
 * Main component
 * ============================================================ */
export default function AdminCompanyDetail() {
  const [, params] = useRoute<{ id: string }>("/admin/companies/:id");
  const [editSection, setEditSection] = useState<"profile" | "ma" | null>(null);

  const { data: companiesData, isLoading: loadingCompany } = useQuery<{ rows: CompanyFullRow[] }>({
    queryKey: ["/api/admin/companies/full"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/companies/full")).json(),
  });

  const { data: profileData, isLoading: loadingProfile } = useQuery<{ ok: boolean; profile: CompanyProfile }>({
    queryKey: ["/api/admin/companies", params?.id, "profile"],
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/companies/${params?.id}/profile`)).json(),
    enabled: Boolean(params?.id),
  });

  const c = companiesData?.rows.find((x) => x.id === params?.id);
  const profile = profileData?.profile;

  if ((loadingCompany || loadingProfile) && !c) {
    return (
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </PageBody>
    );
  }

  if (!c) {
    return (
      <PageBody>
        <div className="text-center py-20 text-muted-foreground" data-testid="text-not-found">Company not found.</div>
      </PageBody>
    );
  }

  function displayVal(val: unknown): string {
    if (val === undefined || val === null || val === "") return "—";
    return String(val);
  }

  return (
    <>
      <PageHeader
        title={c.name}
        description={`Company profile · region ${c.region} · stage ${c.stage}`}
        breadcrumbs={[
          { label: "Admin" },
          { href: "/admin/companies", label: "Companies" },
          { label: c.name },
        ]}
        actions={
          <div className="flex gap-2 items-center">
            {profile && (
              <span className="text-xs text-muted-foreground" data-testid="text-profile-version">
                v{profile.version}
              </span>
            )}
            <Badge className="bg-[hsl(0_100%_40%)] text-white border-0" data-testid="badge-audited">
              Audited
            </Badge>
          </div>
        }
      />

      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Founder Profile Section ─────────────────── */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Company profile · {PROFILE_SECTION.length} fields</CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => setEditSection("profile")}
                data-testid="btn-edit-profile"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            </CardHeader>
            <CardContent className="px-0">
              {loadingProfile ? (
                <div className="px-6 space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
                </div>
              ) : (
                <table className="w-full text-sm" data-testid="table-profile">
                  <tbody>
                    {PROFILE_SECTION.map((f) => (
                      <tr key={String(f.key)} className="border-b border-border/40 last:border-0">
                        <td className="px-6 py-2 text-xs text-muted-foreground font-mono w-1/2">{f.label}</td>
                        <td className="px-3 py-2 font-medium text-xs" data-testid={`field-${String(f.key)}`}>
                          {displayVal(profile?.[f.key])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* ── M&A Intelligence Section ────────────────── */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">M&amp;A Intelligence · {MA_SECTION.length} fields</CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => setEditSection("ma")}
                data-testid="btn-edit-ma"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            </CardHeader>
            <CardContent className="px-0">
              {loadingProfile ? (
                <div className="px-6 space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
                </div>
              ) : (
                <table className="w-full text-sm" data-testid="table-ma">
                  <tbody>
                    {MA_SECTION.map((f) => (
                      <tr key={String(f.key)} className="border-b border-border/40 last:border-0">
                        <td className="px-6 py-2 text-xs text-muted-foreground font-mono w-1/2">{f.label}</td>
                        <td className="px-3 py-2 font-medium text-xs" data-testid={`field-${String(f.key)}`}>
                          {displayVal(profile?.[f.key])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* ── Custom fields ───────────────────────────── */}
          {profile?.customFields && Object.keys(profile.customFields).length > 0 && (
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Custom fields</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <table className="w-full text-sm" data-testid="table-custom">
                  <tbody>
                    {Object.entries(profile.customFields).map(([k, v]) => (
                      <tr key={k} className="border-b border-border/40 last:border-0">
                        <td className="px-6 py-2 text-xs text-muted-foreground font-mono w-1/2">{k}</td>
                        <td className="px-3 py-2 font-medium text-xs">{v || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Edit Drawers ────────────────────────────── */}
        {profile && (
          <>
            <EditDrawer
              open={editSection === "profile"}
              onClose={() => setEditSection(null)}
              title="Edit company profile"
              fields={PROFILE_SECTION}
              profile={profile}
              companyId={c.id}
            />
            <EditDrawer
              open={editSection === "ma"}
              onClose={() => setEditSection(null)}
              title="Edit M&A intelligence"
              fields={MA_SECTION}
              profile={profile}
              companyId={c.id}
            />
          </>
        )}
      </PageBody>
    </>
  );
}
