/**
 * v25.44 Surface 13 — M&A privacy gate consent (Company Profile → Step 4).
 *
 * Self-contained, additive: reads/writes ONLY the new companies.ma_privacy_json
 * column via /api/collective/companies/:id/ma-privacy. Does NOT touch the
 * existing 30 M&A fields. Default is opt-OUT of Collective-wide aggregation.
 *
 * Copy (per brief): "Share my M&A profile across the Collective for benchmarking
 * and matchmaking? (default: chapter-only)".
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";
import { useActiveCompanyId } from "@/lib/useActiveCompany";

interface MaPrivacy {
  shareWithCollective: boolean;
  shareWithChapter: boolean;
  shareWithAdvisors: boolean;
  redactNarrativeFromAggregates: boolean;
}
interface PrivacyResponse {
  companyId: string;
  maPrivacy: MaPrivacy;
}

const DEFAULTS: MaPrivacy = {
  shareWithCollective: false,
  shareWithChapter: true,
  shareWithAdvisors: true,
  redactNarrativeFromAggregates: true,
};

export function MaPrivacyConsent() {
  const companyId = useActiveCompanyId();
  const [local, setLocal] = useState<MaPrivacy | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "ok" | "error">("idle");

  const q = useQuery<PrivacyResponse>({
    queryKey: ["/api/collective/companies", companyId, "ma-privacy"],
    queryFn: async () =>
      (await apiRequest("GET", `/api/collective/companies/${encodeURIComponent(companyId)}/ma-privacy`)).json(),
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });

  const value = local ?? q.data?.maPrivacy ?? DEFAULTS;

  async function update(patch: Partial<MaPrivacy>) {
    const next = { ...value, ...patch };
    setLocal(next);
    setSaveState("saving");
    try {
      const res = await apiRequest("PUT", `/api/collective/companies/${encodeURIComponent(companyId)}/ma-privacy`, next);
      setSaveState(res.ok ? "ok" : "error");
    } catch {
      setSaveState("error");
    }
  }

  if (!companyId) return null;

  return (
    <Card data-testid="card-ma-privacy">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> M&amp;A sharing &amp; privacy
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs">
            Share my M&amp;A profile across the Collective for benchmarking and matchmaking? (default: chapter-only)
          </Label>
          <Switch
            checked={value.shareWithCollective}
            onCheckedChange={(v) => update({ shareWithCollective: v })}
            data-testid="switch-share-collective"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs">Share with my chapter peers</Label>
          <Switch
            checked={value.shareWithChapter}
            onCheckedChange={(v) => update({ shareWithChapter: v })}
            data-testid="switch-share-chapter"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs">Share with my advisors</Label>
          <Switch
            checked={value.shareWithAdvisors}
            onCheckedChange={(v) => update({ shareWithAdvisors: v })}
            data-testid="switch-share-advisors"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs">Redact my readiness narrative from aggregate views</Label>
          <Switch
            checked={value.redactNarrativeFromAggregates}
            onCheckedChange={(v) => update({ redactNarrativeFromAggregates: v })}
            data-testid="switch-redact-narrative"
          />
        </div>
        {saveState === "ok" && <p className="text-[11px] text-green-700" data-testid="ma-privacy-saved">Saved.</p>}
        {saveState === "error" && <p className="text-[11px] text-red-700" data-testid="ma-privacy-error">Couldn't save.</p>}
      </CardContent>
    </Card>
  );
}

export default MaPrivacyConsent;
