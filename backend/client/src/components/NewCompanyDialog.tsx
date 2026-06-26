/**
 * Wave B FIX 1 (F-BUG-002) — Add company dialog.
 *
 * Replaces the "Add company (coming soon)" disabled item with a functional
 * modal that posts to the existing `POST /api/founder/companies/new`
 * endpoint (multiCompanyStore.ts). On success the company list is
 * invalidated and the new company is activated, so the founder lands in a
 * working multi-company state immediately.
 *
 * The endpoint already:
 *   - persists the company under the calling founder's userId
 *   - calls createSubscriptionForNewCompany() inside the post-tx
 *     side-effect (auto-trial after Wave B FIX 4)
 *   - returns { ok, companyId, company }
 *
 * NB: no paywall is applied — founders must be able to CREATE a company
 * without a paid sub. The paywall (when reached) gates *publishing*
 * actions further down the funnel.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
// v25.45 F1a — Sector binds to the SAME Industry enum as Company Profile →
// Step 1 → Industry (single source of truth). No more freeform text.
import { INDUSTRY_OPTIONS } from "@/lib/profile/data/enums";

export type NewCompanyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * v25.43 F13 — optional success callback fired AFTER the company is created
   * and activated. Used by the onboarding (company-first) flow to forward the
   * founder to /founder/subscribe. Existing callers omit it and keep the
   * default close-on-success behaviour unchanged.
   */
  onCreated?: (companyId: string) => void;
};

export function NewCompanyDialog({ open, onOpenChange, onCreated }: NewCompanyDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [sector, setSector] = useState("");
  const [stage, setStage] = useState("");
  const [hq, setHq] = useState("");
  // v25.45 F1b — the Free/Pro/Scale plan picker was removed from this dialog.
  // New companies default to the active pricing model's free/lowest tier,
  // resolved server-side (F1d). The founder picks/upgrades a plan later from
  // Settings → Billing & Subscription.

  const create = useMutation({
    mutationFn: async () => {
      // v23.4.5 BUG 018 / QA#5#6 fix: apiRequest returns a Response object; the
      // previous cast `res as { ok: boolean; companyId: string }` evaluated
      // `data.ok = Response.ok` (truthy for 2xx) but `data.companyId` was
      // undefined, so the success branch fell through to the destructive toast
      // even when the backend created the company successfully. Parse JSON.
      const res = await apiRequest("POST", "/api/founder/companies/new", {
        name: name.trim(),
        legalName: legalName.trim() || `${name.trim()}, Inc.`,
        sector: sector.trim(),
        stage: stage.trim(),
        hq: hq.trim(),
        // v25.45 F1b/F1d — no `plan`: server resolves the default tier from the
        // active pricing model.
      });
      const body = await res.json().catch(() => ({}));
      return body as { ok: boolean; companyId: string; company: unknown; error?: string };
    },
    onSuccess: async (data) => {
      if (!data?.ok || !data.companyId) {
        toast({
          title: "Could not create company",
          description: data?.error ?? "Server returned an unexpected response.",
          variant: "destructive",
        });
        return;
      }
      // Activate the new company immediately.
      try {
        await apiRequest("POST", `/api/founder/companies/${data.companyId}/activate`);
      } catch {
        /* non-fatal */
      }
      // Invalidate everything company-scoped.
      // L-002 fix v23.4.13: also invalidate /api/auth/me so select-company page refreshes company list
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/active-company"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/captable"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/rounds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/subscription"] });
      toast({
        title: "Company created",
        description: `${name.trim()} is now your active company.`,
      });
      // Reset + close.
      setName("");
      setLegalName("");
      setSector("");
      setStage("");
      setHq("");
      onOpenChange(false);
      // v25.43 F13 — notify the onboarding flow so it can forward to subscribe.
      onCreated?.(data.companyId);
    },
    onError: (e: any) =>
      toast({
        title: "Could not create company",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      }),
  });

  const canSubmit = name.trim().length >= 2 && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-new-company">
        <DialogHeader>
          <DialogTitle>Add a new company</DialogTitle>
          <DialogDescription>
            {/* v25.45 F1c — company-creation-focused sub-copy (replaces the
                old plan-centric trial line). */}
            Set up your company profile to start managing your cap table, rounds, and investors.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) create.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="nc-name">Company name *</Label>
            <Input
              id="nc-name"
              data-testid="input-new-company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your company name"
              required
              minLength={2}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nc-legal">Legal name</Label>
            <Input
              id="nc-legal"
              data-testid="input-new-company-legal"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Your company legal name, Inc."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              {/* v25.45 F1a — Sector is the Industry enum dropdown. */}
              <Label htmlFor="nc-sector">Sector</Label>
              <Select value={sector} onValueChange={setSector}>
                <SelectTrigger id="nc-sector" data-testid="select-new-company-sector">
                  <SelectValue placeholder="Select industry…" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {INDUSTRY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nc-stage">Stage</Label>
              <Input
                id="nc-stage"
                data-testid="input-new-company-stage"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                placeholder="Seed"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="nc-hq">Headquarters</Label>
            <Input
              id="nc-hq"
              data-testid="input-new-company-hq"
              value={hq}
              onChange={(e) => setHq(e.target.value)}
              placeholder="San Francisco, USA"
            />
          </div>
          {/* v25.45 F1b — Plan picker (Free / Pro / Scale) removed; default tier resolved server-side. */}
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
              data-testid="button-new-company-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid="button-new-company-submit"
            >
              {create.isPending ? "Creating…" : "Create company"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
