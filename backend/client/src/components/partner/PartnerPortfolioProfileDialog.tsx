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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INDUSTRY_OPTIONS } from "@/lib/profile/data/enums";
import { COUNTRIES } from "@/lib/profile/data/countries";
import { useToast } from "@/hooks/use-toast";
import { describeFailure } from "@/lib/failureMessage";

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

/* Radix SelectItem forbids an empty value, so "cleared" rides a sentinel that
   the change handler maps back to null (industryEnum accepts null, not ""). */
const INDUSTRY_NONE = "__none__";

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 341 (productgaps2) · N18 — THE TWO COUNTRY FIELDS WERE FREE TEXT.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. `Country code (e.g. US)` (step 2) and `Country of
 * incorporation code` (step 3) accepted and STORED anything typed: `usa`,
 * `U.S.`, `Amerika`, a typo. The country of incorporation is read for
 * jurisdiction and for tax/KYC purposes, so a free-text value there is a
 * compliance defect, not a tidiness one.
 *
 * WHICH LIST. `COUNTRIES` (`client/src/lib/profile/data/countries.ts`), the
 * 250-entry ISO-3166 alpha-2 list the platform already uses for exactly this,
 * including on the sibling partner screen `PartnerSettings.tsx:276`. NO NEW
 * LIST IS INVENTED. The SPV wizard's `SPV_TOP_JURISDICTION_COUNTRIES` was
 * measured and REJECTED: it holds 15 country NAMES, these two fields hold
 * CODES, and 15 entries cannot express a company incorporated anywhere else.
 *
 * WHY A BOUND `<datalist>` + A SAVE BLOCK, AND NOT A CLOSED `<Select>`.
 * A closed `<Select>` was built and proved in WAVE 339 and is parked at
 * `build_log/partnerband_vocab/patches/`. It REPLACES the `<Input>`, and a
 * replaced control is externally indistinguishable from a removed one: the
 * silent-drop guard reported 6 disappearances and `drop:restyle` reported 2
 * BARE disappearances. Both gates are behaving correctly. `drop:restyle` has
 * no register for a replacement — its only clearing action is re-cutting its
 * baseline, which is forbidden here and which its own header calls "not
 * evidence of anything". So the control is KEPT and BOUND instead: same
 * element, same `data-testid`, same handler, same placeholder — plus a bound
 * pick-list and a hard stop on save. The user-visible outcome is the one the
 * ruling asked for (you pick a country; a value that is not a country cannot
 * be stored) with nothing removed and no gate baseline touched.
 *
 * NOTHING IS TAKEN OFFLINE. A row that already holds an off-list legacy value
 * still LOADS and still DISPLAYS it; the block is on saving a NEW bad value.
 * A blank field stays legal — these fields are optional. */
const COUNTRY_LIST_ADDRESS = "pf-country-options-address";
const COUNTRY_LIST_LEGAL = "pf-country-options-legal";
const COUNTRY_CODES: ReadonlySet<string> = new Set(COUNTRIES.map((c) => c.code));
const COUNTRY_HELP =
  "Pick a country from the list. It is stored as its two-letter ISO code, in capitals — for example US.";

/** Blank is legal (the field is optional). Anything else must be an ISO code. */
export function isAcceptableCountryCode(v: string): boolean {
  return v.trim() === "" || COUNTRY_CODES.has(v);
}

function CountryOptions({ id }: { id: string }) {
  return (
    <datalist id={id} data-testid={`${id}-datalist`}>
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>{c.name}</option>
      ))}
    </datalist>
  );
}

const TX_STATUS = [
  "not_pursuing", "exploring", "outbound", "inbound", "active_negotiation",
] as const;

/**
 * w-partner F2-b — name the offending field(s). The server now answers a bad
 * patch with { error:"INVALID_PROFILE_PATCH", details:[{path,message}] }; the
 * generic message alone left the user with no idea which field was rejected.
 */
function describeSaveError(e: Error): string {
  const payload = (e as { payload?: unknown }).payload;
  const details = (payload as { details?: unknown } | undefined)?.details;
  if (Array.isArray(details) && details.length > 0) {
    return details
      .map((d) => {
        const { path, message } = d as { path?: string; message?: string };
        return path ? `${path}: ${message ?? "invalid"}` : String(message ?? "invalid");
      })
      .join("; ");
  }
  /* WAVE 197 #53 — WRITE. Raw tail only; the field-error branch above is
     authored copy and is untouched. */
  return describeFailure(e, "write");
}

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
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not save profile", description: describeSaveError(e) }),
  });

  const str = (s: Section, k: string): string => (typeof s[k] === "string" ? (s[k] as string) : "");
  const maTransactionStatus =
    str((ma.readiness as Section) ?? {}, "transactionStatus") || "not_pursuing";
  const setField = (
    setter: (fn: (prev: Section) => Section) => void,
    k: string,
  ) => (e: { target: { value: string } }) => setter((prev) => ({ ...prev, [k]: e.target.value }));

  /* WAVE 341 · N18 — a value that is not a country cannot be saved. Evaluated on
     the LIVE form state, not on the loaded row, so an off-list value already on
     the record still loads and still displays; it only blocks the save while it
     is on screen, which is the moment the partner can fix it. */
  const addressCountryOk = isAcceptableCountryCode(str(address, "countryCode"));
  const legalCountryOk = isAcceptableCountryCode(str(legal, "countryOfIncorporationCode"));
  const countryFieldsOk = addressCountryOk && legalCountryOk;

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
          <div className="text-sm text-[var(--cv-color-text-muted)]">Loading…</div>
        ) : (
          <div className="space-y-2" data-testid={`portfolio-step-panel-${step}`}>
            {step === 1 && (
              <>
                <Input disabled={!canEdit} placeholder="Company name" value={str(contact, "companyName")} onChange={setField(setContact, "companyName")} data-testid="pf-contact-name" />
                <Input disabled={!canEdit} placeholder="Company email" value={str(contact, "companyEmail")} onChange={setField(setContact, "companyEmail")} data-testid="pf-contact-email" />
                {/* w-partner F2-b — Industry is the INDUSTRY_OPTIONS enum, not free text.
                    A typed string failed industryEnum and 400'd the ENTIRE patch,
                    silently discarding all four sections. Pattern copied from the
                    unpinned NewCompanyDialog.tsx. Clearing writes null (industryEnum
                    is .nullable() and rejects ""). */}
                <Select
                  value={str(contact, "industry") || INDUSTRY_NONE}
                  onValueChange={(v) =>
                    setContact((prev) => ({ ...prev, industry: v === INDUSTRY_NONE ? null : v }))
                  }
                  disabled={!canEdit}
                >
                  <SelectTrigger data-testid="pf-contact-industry">
                    <SelectValue placeholder="Industry" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={INDUSTRY_NONE}>— No industry —</SelectItem>
                    {INDUSTRY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input disabled={!canEdit} placeholder="Website / URL" value={str(contact, "companyWebsiteUrl")} onChange={setField(setContact, "companyWebsiteUrl")} data-testid="pf-contact-website" />
                <Textarea disabled={!canEdit} placeholder="One-sentence headliner" rows={2} value={str(contact, "oneSentenceHeadliner")} onChange={setField(setContact, "oneSentenceHeadliner")} data-testid="pf-contact-headliner" />
              </>
            )}
            {step === 2 && (
              <>
                <Input disabled={!canEdit} placeholder="Street" value={str(address, "street")} onChange={setField(setAddress, "street")} data-testid="pf-address-street" />
                <Input disabled={!canEdit} placeholder="City" value={str(address, "city")} onChange={setField(setAddress, "city")} data-testid="pf-address-city" />
                <Input disabled={!canEdit} placeholder="State / Province" value={str(address, "stateProvince")} onChange={setField(setAddress, "stateProvince")} data-testid="pf-address-state" />
                <Input list={COUNTRY_LIST_ADDRESS} aria-invalid={!addressCountryOk} disabled={!canEdit} placeholder="Country code (e.g. US)" value={str(address, "countryCode")} onChange={setField(setAddress, "countryCode")} data-testid="pf-address-country" />
                <CountryOptions id={COUNTRY_LIST_ADDRESS} />
                {!addressCountryOk && (
                  <p className="text-xs text-[var(--cv-color-danger)]" role="alert" data-testid="pf-address-country-error">
                    <span aria-hidden="true">⚠ </span>
                    Country: “{str(address, "countryCode")}” is not a country we recognise. {COUNTRY_HELP}
                  </p>
                )}
                <Input disabled={!canEdit} placeholder="Postal code / Zip" value={str(address, "postalCode")} onChange={setField(setAddress, "postalCode")} data-testid="pf-address-postal" />
              </>
            )}
            {step === 3 && (
              <>
                <Input disabled={!canEdit} placeholder="Legal entity name" value={str(legal, "legalEntityName")} onChange={setField(setLegal, "legalEntityName")} data-testid="pf-legal-name" />
                <Input list={COUNTRY_LIST_LEGAL} aria-invalid={!legalCountryOk} disabled={!canEdit} placeholder="Country of incorporation code" value={str(legal, "countryOfIncorporationCode")} onChange={setField(setLegal, "countryOfIncorporationCode")} data-testid="pf-legal-country" />
                <CountryOptions id={COUNTRY_LIST_LEGAL} />
                {!legalCountryOk && (
                  <p className="text-xs text-[var(--cv-color-danger)]" role="alert" data-testid="pf-legal-country-error">
                    <span aria-hidden="true">⚠ </span>
                    Country of incorporation: “{str(legal, "countryOfIncorporationCode")}” is not a country we recognise. {COUNTRY_HELP}
                  </p>
                )}
                <Input disabled={!canEdit} placeholder="Type of entity" value={str(legal, "entityType")} onChange={setField(setLegal, "entityType")} data-testid="pf-legal-entity" />
                <Textarea disabled={!canEdit} placeholder="Registered office address" rows={2} value={str(legal, "registeredOfficeAddress")} onChange={setField(setLegal, "registeredOfficeAddress")} data-testid="pf-legal-office" />
              </>
            )}
            {step === 4 && (
              <>
                <label className="text-xs font-medium">M&amp;A transaction status</label>
                {/* w-partner F2-b — transactionStatus lives at ma.readiness.transactionStatus
                    (companyMaSchema:502). A top-level ma.transactionStatus is an unknown
                    key, which zod STRIPS: the field appeared to save and never persisted. */}
                <select
                  disabled={!canEdit}
                  className="w-full text-sm border rounded px-2 py-1 bg-white"
                  value={maTransactionStatus}
                  onChange={(e) =>
                    setMa((prev) => ({
                      ...prev,
                      readiness: {
                        ...((prev.readiness as Record<string, unknown>) ?? {}),
                        transactionStatus: e.target.value,
                      },
                    }))
                  }
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
              disabled={saveMut.isPending || profileQ.isLoading || !countryFieldsOk}
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
