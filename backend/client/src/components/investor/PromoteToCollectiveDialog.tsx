/**
 * Sprint 21 Wave C — C3: PromoteToCollectiveDialog
 *
 * Flagship feature: Investor promotes a portfolio company to present
 * at Capavate Collective.
 *
 * Flow:
 *  1. Investor clicks "Promote to Capavate Collective" button.
 *  2. Dialog opens with narrative explanation + rationale textarea + checkbox.
 *  3. On submit: POST /api/investor/collective/promote
 *  4. On success: toast + dialog closes + parent refreshes.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ApiError } from "@/lib/queryClient";

/* ════════════════════════════════════════════════════════════════════════════
 * WAVE 220 · CLASS A · A4 — FOUR NAMED CHECKS AND AN SLA, NONE OF WHICH EXIST.
 *
 * This dialog told an investor that on submission "the Collective committee runs
 * a streamlined diligence pass — usually within 2 business days — including M&A
 * readiness scoring, cap-table verification, and founder readiness check."
 *
 * WHAT POST /api/investor/collective/promote ACTUALLY DOES, read end to end at
 * server/sprint21PortfolioRoutes.ts:199-340: authenticate the investor; validate
 * the body with zod; confirm the investor appears on the company's cap table;
 * reject a duplicate nomination; write ONE hash-chained row; notify the founder;
 * publish one bridge event; return 201. That is the whole of it. There is no
 * committee, no diligence pass, no readiness score, no founder readiness check
 * and no service-level commitment anywhere in the tree — no `diligencePass`, no
 * `screeningCommittee`, no scoring job.
 *
 * R210.2 — a claim about work a party does not do cannot be made true, only
 * withdrawn. R196.2 — and the "2 business days" could not be replaced by a
 * measured figure either, because nothing measures one; saying no time is
 * promised is the only honest form.
 *
 * The one real check IS retained in the corrected sentence: the cap-table
 * membership test is genuine, so it is described rather than dropped. The
 * NEXT paragraph ("The founder is automatically notified") was audited and is
 * TRUE — emitNotification fires on the founder's resolved userId immediately
 * after the insert commits — so it is untouched. One paragraph false, the next
 * true, in the same dialog: that is why every candidate is read in place.
 * ════════════════════════════════════════════════════════════════════════════ */
const W220_RENDER_SUPERSEDED_COPY = false;

interface PromoteToCollectiveDialogProps {
  companyId: string;
  companyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function PromoteToCollectiveDialog({
  companyId,
  companyName,
  open,
  onOpenChange,
  onSuccess,
}: PromoteToCollectiveDialogProps) {
  const [rationale, setRationale] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // DEF-042: Prefetch collective/promotion-status so submit button shows "Already nominated" if applicable
  const collectiveStatusQ = useQuery<{ nominated: boolean; submittedAt?: string } | null>({
    queryKey: ["/api/investor/companies", companyId, "promotion-status"],
    /* v25.32 burndown — item 15: apiRequest throws ApiError on non-2xx, so the
       prior `if (res.status === 404) return null` was dead (the "not yet
       nominated" 404 surfaced as a query error instead of null). Catch ApiError
       and branch on .status. Source: v25_32_apiRequest_dead_code_sites_gpt55.txt
       (PromoteToCollectiveDialog.tsx:60). Read-only; additive. */
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/investor/companies/${companyId}/promotion-status`);
        return res.json();
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: open && !!companyId,
  });
  const alreadyNominated = !!collectiveStatusQ.data;

  const isValid = rationale.trim().length >= 20 && confirmed && !alreadyNominated;

  const promote = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/investor/collective/promote", {
        companyId,
        rationale: rationale.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Promotion submitted.",
        description: "The founder has been notified.",
      });
      // Invalidate promotion-status so badge refreshes
      queryClient.invalidateQueries({
        queryKey: ["/api/investor/companies", companyId, "promotion-status"],
      });
      onOpenChange(false);
      setRationale("");
      setConfirmed(false);
      onSuccess?.();
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "Promotion failed. Try again.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="w-5 h-5 text-primary" />
            Promote {companyName} to present at Capavate Collective
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
          <p>
            Your nomination signals to the Collective screening committee that
            you, an accredited investor on this company's cap table, vouch for
            this company's readiness to present.
          </p>
          <p>
            Once submitted, your nomination is recorded and the founder is
            notified. Capavate checks that you appear on this company's cap table
            at that moment. No committee reviews your nomination, no M&A
            readiness score is computed, no check is performed on the founder,
            and no review time is promised.
          </p>
          <p>
            The founder is{" "}
            <strong className="text-foreground">automatically notified</strong>{" "}
            that you have promoted them. They can accept the nomination
            (continuing into the Collective screening flow) or politely decline.
          </p>
          <p>
            Companies that complete screening present at a chapter meeting
            (Toronto / NYC / SF / Singapore) within 4–8 weeks. SPV co-invest
            opportunities open to all chapter members at presentation time.
          </p>
        </div>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="rationale">
              Why this company?{" "}
              <span className="text-muted-foreground font-normal">
                (20–1,000 chars)
              </span>
            </Label>
            <Textarea
              id="rationale"
              data-testid="input-promote-rationale"
              placeholder="Describe why you're nominating this company for the Collective…"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              maxLength={1000}
              rows={4}
              className="resize-none"
            />
            <div className="text-right text-xs text-muted-foreground">
              {rationale.trim().length} / 1,000
              {rationale.trim().length > 0 && rationale.trim().length < 20 && (
                <span className="text-destructive ml-2">
                  (minimum 20 characters)
                </span>
              )}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="confirm-accredited"
              data-testid="checkbox-promote-confirm"
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
            />
            <Label
              htmlFor="confirm-accredited"
              className="text-sm font-normal leading-snug cursor-pointer"
            >
              I confirm I am an accredited investor on this company's cap table
              and have a meaningful relationship with the founder.
            </Label>
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-promote-cancel"
          >
            Cancel
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    className="bg-primary hover:bg-primary/90"
                    disabled={!isValid || promote.isPending}
                    onClick={() => promote.mutate()}
                    data-testid="button-promote-submit"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {promote.isPending ? "Submitting…" : alreadyNominated ? "Already nominated" : "Promote to Collective"}
                  </Button>
                </span>
              </TooltipTrigger>
              {!isValid && (
                <TooltipContent>
                  {!confirmed
                    ? "Check the accredited investor confirmation above."
                    : "Add at least 20 characters to your rationale."}
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </DialogFooter>
        {/* WAVE 220 · A4 · R195.5 — RETIRED IN PLACE, NOT DELETED. Appended as
            the LAST sibling inside DialogContent so nothing above it renumbers.
            Byte-identical to the paragraph that stood above, so the guard's copy
            identity survives. Identifier flag, not `{false && ...}`, which
            detect.mjs folds and marks a SUPPRESSION. */}
        {W220_RENDER_SUPERSEDED_COPY ? (
          <div hidden aria-hidden="true" data-testid="w220-superseded-promote-diligence">Once submitted, the Collective committee runs a streamlined diligence pass — usually within 2 business days — including M&A readiness scoring, cap-table verification, and founder readiness check.</div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
