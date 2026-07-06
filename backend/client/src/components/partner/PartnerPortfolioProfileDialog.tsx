/**
 * v25.50.0 Phase 3 (spec 3) — Consortium Partner "Private Portfolio" company
 * profile editor. A compact 4-step wizard adapted from founder/Company.tsx that
 * reuses the SAME CompanyProfile taxonomy (contact / address / legal / ma) but
 * reads & writes the CP-scoped, non-sacred `/api/partner/me/portfolio/:companyId`
 * surface — it never touches the sacred founder profile stores.
 *
 * The server validates every section against companyProfilePatchSchema (the
 * exact schema the founder wizard uses), so all fields are optional/partial and
 * a partner can fill in as much or as little as they like.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type Section = Record<string, unknown>;
interface PortfolioProfile {
  contact?: Section;
  address?: Section;
  legal?: Section;
  ma?: Section;
}
interface PortfolioResponse {
  companyId: string;
  companyName: string | null;
  profile: PortfolioProfile;
  updatedAt: string | null;
}

const STEPS = [
  { key: 1, label: "Contact" },
  { key: 2, label: "Address" },
  { key: 3, label: "Legal" },
  { key: 4, label: "M&A" },
] as const;

const TX_STATUS = [
  "not_pursuing", "exploring", "outbound", "inbound", "active_negotiation",
] as const;

export function PartnerPortfolioProfileDialog({
  companyId,
  companyName,
  canEdit,
  open,
  onOpenChange,
}: {
  companyId: string;
  companyName: string;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [contact, setContact] = useState<Section>({});
  const [address, setAddress] = useState<Section>({});
  const [legal, setLegal] = useState<Section>({});
  const [ma, setMa] = useState<Section>({});

  const profileQ = useQuery<PortfolioResponse>({
    queryKey: ["/api/partner/me/portfolio", companyId],
    enabled: open && !!companyId,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/portfolio/${companyId}`)).json(),
  });

  // Hydrate local form state whenever the fetched profile changes.
  useEffect(() => {
    const p = profileQ.data?.profile;
    if (!p) return;
    setContact(p.contact ?? {});
    setAddress(p.address ?? {});
    setLegal(p.legal ?? {});
    setMa(p.ma ?? {});
  }, [profileQ.data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const patch = { contact, address, legal, ma };
      const res = await apiRequest("PATCH", `/api/partner/me/portfolio/${companyId}`, patch);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Portfolio profile saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/portfolio", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/portfolio"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not save profile", description: e.message }),
  });

  const str = (s: Section, k: string): string => (typeof s[k] === "string" ? (s[k] as string) : "");
  const setField = (
    setter: (fn: (prev: Section) => Section) => void,
    k: string,
  ) => (e: { target: { value: string } }) => setter((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="portfolio-profile-modal">
        <DialogHeader>
          <DialogTitle>Private portfolio profile — {companyName}</DialogTitle>
          <DialogDescription>
            Your private view of this company. Only your workspace can see it; it does not affect the company’s own Capavate profile.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 mb-3" data-testid="portfolio-steps">
          {STEPS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStep(s.key)}
              className={`flex-1 text-xs rounded px-2 py-1 border ${step === s.key ? "bg-[var(--cv-color-primary)] text-white" : "bg-white"}`}
              data-testid={`portfolio-step-${s.key}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {profileQ.isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : (
          <div className="space-y-2" data-testid={`portfolio-step-panel-${step}`}>
            {step === 1 && (
              <>
                <Input disabled={!canEdit} placeholder="Company name" value={str(contact, "companyName")} onChange={setField(setContact, "companyName")} data-testid="pf-contact-name" />
                <Input disabled={!canEdit} placeholder="Company email" value={str(contact, "companyEmail")} onChange={setField(setContact, "companyEmail")} data-testid="pf-contact-email" />
                <Input disabled={!canEdit} placeholder="Industry" value={str(contact, "industry")} onChange={setField(setContact, "industry")} data-testid="pf-contact-industry" />
                <Input disabled={!canEdit} placeholder="Website / URL" value={str(contact, "companyWebsiteUrl")} onChange={setField(setContact, "companyWebsiteUrl")} data-testid="pf-contact-website" />
                <Textarea disabled={!canEdit} placeholder="One-sentence headliner" rows={2} value={str(contact, "oneSentenceHeadliner")} onChange={setField(setContact, "oneSentenceHeadliner")} data-testid="pf-contact-headliner" />
              </>
            )}
            {step === 2 && (
              <>
                <Input disabled={!canEdit} placeholder="Street" value={str(address, "street")} onChange={setField(setAddress, "street")} data-testid="pf-address-street" />
                <Input disabled={!canEdit} placeholder="City" value={str(address, "city")} onChange={setField(setAddress, "city")} data-testid="pf-address-city" />
                <Input disabled={!canEdit} placeholder="State / Province" value={str(address, "stateProvince")} onChange={setField(setAddress, "stateProvince")} data-testid="pf-address-state" />
                <Input disabled={!canEdit} placeholder="Country code (e.g. US)" value={str(address, "countryCode")} onChange={setField(setAddress, "countryCode")} data-testid="pf-address-country" />
                <Input disabled={!canEdit} placeholder="Postal code / Zip" value={str(address, "postalCode")} onChange={setField(setAddress, "postalCode")} data-testid="pf-address-postal" />
              </>
            )}
            {step === 3 && (
              <>
                <Input disabled={!canEdit} placeholder="Legal entity name" value={str(legal, "legalEntityName")} onChange={setField(setLegal, "legalEntityName")} data-testid="pf-legal-name" />
                <Input disabled={!canEdit} placeholder="Country of incorporation code" value={str(legal, "countryOfIncorporationCode")} onChange={setField(setLegal, "countryOfIncorporationCode")} data-testid="pf-legal-country" />
                <Input disabled={!canEdit} placeholder="Type of entity" value={str(legal, "entityType")} onChange={setField(setLegal, "entityType")} data-testid="pf-legal-entity" />
                <Textarea disabled={!canEdit} placeholder="Registered office address" rows={2} value={str(legal, "registeredOfficeAddress")} onChange={setField(setLegal, "registeredOfficeAddress")} data-testid="pf-legal-office" />
              </>
            )}
            {step === 4 && (
              <>
                <label className="text-xs font-medium">M&amp;A transaction status</label>
                <select
                  disabled={!canEdit}
                  className="w-full text-sm border rounded px-2 py-1 bg-white"
                  value={str(ma, "transactionStatus") || "not_pursuing"}
                  onChange={setField(setMa, "transactionStatus")}
                  data-testid="pf-ma-status"
                >
                  {TX_STATUS.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                </select>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canEdit && (
            <Button
              data-testid="portfolio-save"
              disabled={saveMut.isPending || profileQ.isLoading}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? "Saving…" : "Save profile"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
