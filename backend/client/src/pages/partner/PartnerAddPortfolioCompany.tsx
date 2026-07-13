/**
 * Wave B1 (v26.1.x Consortium Partner QA, slide 3a) — "Add Portfolio Company".
 *
 * Rendered NATIVELY inside the Consortium Partner shell (no iframe, per Ozan) so
 * it inherits the reskin + session. It creates a GENUINELY NET-NEW, INDEPENDENT
 * Capavate company via the canonical company engine, tags it to this partner,
 * adds it to the partner's Pipeline, and issues a founder OWNER invitation by
 * email. The founder claims the account via the returned link and finishes the
 * FULL company profile in Capavate's own builder — they never touch the partner
 * section.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { AppCard } from "@/components/ui/app-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CreateResult {
  ok: boolean;
  companyId: string;
  attributedPartnerId: string;
  founderInvite: { email: string; claimUrl: string } | null;
}

export default function PartnerAddPortfolioCompany() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [companyName, setCompanyName] = useState("");
  const [founderEmail, setFounderEmail] = useState("");
  const [founderName, setFounderName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [sector, setSector] = useState("");
  const [stage, setStage] = useState("");
  const [hq, setHq] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(founderEmail.trim());

  const create = useMutation({
    mutationFn: async (): Promise<CreateResult> => {
      const res = await apiRequest("POST", "/api/partner/me/portfolio-companies", {
        companyName: companyName.trim(),
        founderEmail: founderEmail.trim(),
        founderName: founderName.trim() || undefined,
        legalName: legalName.trim() || undefined,
        sector: sector.trim() || undefined,
        stage: stage.trim() || undefined,
        hq: hq.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      setCopied(false);
      // Refresh the pipeline so the new company appears in the invited column.
      qc.invalidateQueries({ queryKey: ["/api/partner/me/pipeline"] });
      toast({ title: "Portfolio company created", description: "The founder has been invited to claim it." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not create company", description: e.message }),
  });

  const copyClaim = async () => {
    if (!result?.founderInvite?.claimUrl) return;
    try {
      await navigator.clipboard.writeText(result.founderInvite.claimUrl);
      setCopied(true);
    } catch {
      /* clipboard blocked — the link is selectable in the field */
    }
  };

  const resetForm = () => {
    setCompanyName(""); setFounderEmail(""); setFounderName(""); setLegalName("");
    setSector(""); setStage(""); setHq(""); setResult(null); setCopied(false);
  };

  if (!role.ready || !role.identity) return null;

  return (
    <PartnerShell
      title="Add Portfolio Company"
      tier={role.identity.tier}
      subRole={role.identity.subRole}
      partnerName={role.identity.identity.name}
    >
      <AppCard className="mb-5" data-testid="add-portfolio-intro">
        <h2 className="cv-card-title text-lg mb-1">Establish a client company on Capavate</h2>
        <p className="text-sm text-[var(--cv-color-text-secondary)]">
          Create a genuinely new, independent company on Capavate for a client you are
          leading. The company is created with its own account and is tagged to your firm
          so everyone can see you are leading the raise. The founder is invited by email to
          claim the account and complete their full company profile — they only ever access
          their own company workspace, never your partner workspace.
        </p>
      </AppCard>

      {!result && (
        <AppCard data-testid="add-portfolio-form">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Company name *</Label>
              <Input data-testid="apc-company-name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Robotics" />
              {!companyName.trim() && (
                <div className="text-xs text-rose-600 mt-1" data-testid="apc-company-name-error">A company name is required.</div>
              )}
            </div>
            <div>
              <Label>Legal name (optional)</Label>
              <Input data-testid="apc-legal-name" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Acme Robotics, Inc." />
            </div>
            <div>
              <Label>Founder email *</Label>
              <Input data-testid="apc-founder-email" type="email" value={founderEmail} onChange={(e) => setFounderEmail(e.target.value)} placeholder="founder@acme.com" />
              {!emailValid && founderEmail.length > 0 && (
                <div className="text-xs text-rose-600 mt-1" data-testid="apc-founder-email-error">Enter a valid founder email.</div>
              )}
            </div>
            <div>
              <Label>Founder name (optional)</Label>
              <Input data-testid="apc-founder-name" value={founderName} onChange={(e) => setFounderName(e.target.value)} placeholder="Jane Founder" />
            </div>
            <div>
              <Label>Sector (optional)</Label>
              <Input data-testid="apc-sector" value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Robotics" />
            </div>
            <div>
              <Label>Stage (optional)</Label>
              <Input data-testid="apc-stage" value={stage} onChange={(e) => setStage(e.target.value)} placeholder="Seed" />
            </div>
            <div>
              <Label>HQ (optional)</Label>
              <Input data-testid="apc-hq" value={hq} onChange={(e) => setHq(e.target.value)} placeholder="Toronto, CA" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button
              data-testid="apc-create-btn"
              disabled={!companyName.trim() || !emailValid || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create company & invite founder"}
            </Button>
            <span className="text-xs text-[var(--cv-color-text-muted)]">
              The founder receives an invitation to claim ownership and finish the profile.
            </span>
          </div>
        </AppCard>
      )}

      {result && (
        <AppCard data-testid="add-portfolio-success">
          <h2 className="cv-card-title text-lg mb-1">Company created</h2>
          <p className="text-sm text-[var(--cv-color-text-secondary)] mb-3">
            The company has been created as an independent entity, tagged to your firm, and
            added to your Pipeline (Invited). Send the founder the link below so they can
            claim the account and complete the full company profile.
          </p>
          <div className="text-xs text-[var(--cv-color-text-muted)] mb-2" data-testid="apc-company-id">
            Company id: <span className="font-mono">{result.companyId}</span>
          </div>
          {result.founderInvite ? (
            <div className="rounded-md border p-3" style={{ borderColor: "var(--cv-color-border)" }}>
              <div className="text-sm font-medium mb-1">Founder claim link for {result.founderInvite.email}</div>
              <div className="flex gap-2 items-center">
                <Input
                  readOnly
                  data-testid="apc-claim-link"
                  value={result.founderInvite.claimUrl}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button size="sm" data-testid="apc-claim-copy" onClick={copyClaim}>{copied ? "Copied✓" : "Copy link"}</Button>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="apc-invite-warning">
              The company was created and attributed, but the founder invitation could not be
              issued. You can re-invite the founder from the company's team settings.
            </div>
          )}
          <div className="mt-4 flex gap-3">
            <Button variant="outline" data-testid="apc-add-another" onClick={resetForm}>Add another company</Button>
            <a href="/collective/partner/pipeline"><Button variant="outline" data-testid="apc-view-pipeline">View in Pipeline</Button></a>
          </div>
        </AppCard>
      )}
    </PartnerShell>
  );
}
