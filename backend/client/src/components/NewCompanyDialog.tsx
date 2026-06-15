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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type NewCompanyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NewCompanyDialog({ open, onOpenChange }: NewCompanyDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [sector, setSector] = useState("");
  const [stage, setStage] = useState("");
  const [hq, setHq] = useState("");
  // v23.4.7 Phase 3 (BUG 031): plan-picker. Default 'founder_free' so a
  // brand-new company is NOT auto-labeled "PRO". Whitelisted by the server
  // route to founder_free | founder_pro | founder_scale.
  type PlanPick = "founder_free" | "founder_pro" | "founder_scale";
  const [plan, setPlan] = useState<PlanPick>("founder_free");

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
        plan, // v23.4.7 Phase 3 (BUG 031): explicit plan selection
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
      setPlan("founder_free");
      onOpenChange(false);
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
            Spin up another company under your account. You start with a 14-day trial — no card required.
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
              <Label htmlFor="nc-sector">Sector</Label>
              <Input
                id="nc-sector"
                data-testid="input-new-company-sector"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder="Robotics"
              />
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
          {/*
           * v23.4.10 Phase 5 (J-001): plan picker. Default = Free.
           * Replaced the v23.4.7 radio-card layout with a tighter
           * ToggleGroup (type="single") segmented control (same pattern as
           * v23.4.9 Phase 2 "Warrants & Options"). The old radio cards had
           * oversized click targets (title + descriptive sub-text wrapped in
           * a label with htmlFor), so stray clicks anywhere in the modal
           * flipped Free->Pro. The segmented control keeps a tight click area.
           * onValueChange is guarded against the empty string Radix emits when
           * a user deselects the active item, so the plan can never become "".
           */}
          <div className="space-y-2 pt-1">
            <Label className="text-sm font-medium">Plan</Label>
            <ToggleGroup
              type="single"
              value={plan}
              onValueChange={(v) => { if (v) setPlan(v as PlanPick); }}
              data-testid="toggle-group-new-company-plan"
              className="grid grid-cols-3 gap-2"
            >
              <ToggleGroupItem
                value="founder_free"
                data-testid="toggle-plan-free"
                className="h-auto py-2 flex flex-col gap-0.5"
              >
                <span className="font-medium text-sm">Free</span>
                <span className="text-xs text-muted-foreground">Default — recommended</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="founder_pro"
                data-testid="toggle-plan-pro"
                className="h-auto py-2 flex flex-col gap-0.5"
              >
                <span className="font-medium text-sm">Pro</span>
                <span className="text-xs text-muted-foreground">14-day trial, no card</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="founder_scale"
                data-testid="toggle-plan-scale"
                className="h-auto py-2 flex flex-col gap-0.5"
              >
                <span className="font-medium text-sm">Scale</span>
                <span className="text-xs text-muted-foreground">Talk to sales</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
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
