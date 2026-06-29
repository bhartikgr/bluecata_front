/**
 * v25.44 Surface 9 — /syndicate/apply.
 * POST /api/collective/applications with applicationType=syndicate. Reuses the
 * existing collective_apps table (no new table).
 */
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AppCard } from "@/components/ui/app-card";
import { PageHeader } from "@/components/ui/page-header";
import { Layers } from "lucide-react";

/* v25.46 Track 6 — LookFeel-Parity. Normalized to canonical Capavate chrome:
 * left-aligned PageHeader + AppCard wrapper (was an ad-hoc h1 + shadcn Card).
 * Brand literals are kept via the locked --cv-* tokens (red #cc0001 / navy
 * #041e41 — Tier 9 rule 74). All form state + submit behavior + data-testids
 * preserved (wrapper pattern). */

export default function SyndicateApplyPage() {
  const [syndicateName, setSyndicateName] = useState("");
  const [thesis, setThesis] = useState("");
  const [targetCheck, setTargetCheck] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");

  async function submit() {
    setStatus("saving");
    try {
      const res = await apiRequest("POST", "/api/collective/syndicate/apply", {
        applicationType: "syndicate",
        payload: { syndicateName, thesis, targetCheck },
      });
      setStatus(res.ok ? "ok" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto" data-testid="page-syndicate-apply">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Layers className="h-6 w-6" style={{ color: "var(--cv-color-primary)" }} />
            Apply to Form a Syndicate
          </span>
        }
        subtitle="Syndicate application"
      />
      <AppCard>
        <div className="space-y-4">
          <div className="cv-field-controls">
            <Label htmlFor="syn-name">Syndicate name</Label>
            <Input id="syn-name" value={syndicateName} onChange={(e) => setSyndicateName(e.target.value)} data-testid="syndicate-name" />
          </div>
          <div className="cv-field-controls">
            <Label htmlFor="syn-thesis">Investment thesis</Label>
            <Textarea id="syn-thesis" value={thesis} onChange={(e) => setThesis(e.target.value)} data-testid="syndicate-thesis" />
          </div>
          <div className="cv-field-controls">
            <Label htmlFor="syn-check">Target check size (USD)</Label>
            <Input id="syn-check" value={targetCheck} onChange={(e) => setTargetCheck(e.target.value)} data-testid="syndicate-check" />
          </div>
          <Button onClick={submit} disabled={status === "saving"} data-testid="syndicate-submit">
            {status === "saving" ? "Submitting…" : "Submit application"}
          </Button>
          {status === "ok" && <p className="text-sm text-green-700" data-testid="syndicate-ok">Application submitted.</p>}
          {status === "error" && <p className="text-sm text-red-700" data-testid="syndicate-error">Couldn't submit your application.</p>}
        </div>
      </AppCard>
    </div>
  );
}
