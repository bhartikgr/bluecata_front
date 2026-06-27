/**
 * Sprint 18 Phase 2 — T2 DSC review feedback box.
 *
 * Renders only when the company has NOT been DSC reviewed (i.e. dscState is
 * neither `in_review` nor `reviewed`). Two CTAs:
 *   1. Apply to Collective → /founder/apply-to-collective
 *   2. Have a cap-table member promote you → /founder/crm with intro-broker context
 */
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Megaphone, ShieldCheck, Users } from "lucide-react";

type Props = { companyDscState?: string | null };

export function DscFeedbackBox({ companyDscState }: Props) {
  const hidden = companyDscState === "in_review" || companyDscState === "reviewed";
  if (hidden) return null;
  return (
    <Card className="border-amber-200/70 bg-amber-50/40 mb-6" data-testid="box-dsc-feedback">
      <CardContent className="p-5 flex flex-col md:flex-row md:items-center gap-4">
        <div className="h-10 w-10 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
          <Megaphone className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Get a Capavate DSC review</div>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-3xl">
            A DSC (Deal Sourcing Committee) review surfaces your company in the Collective member feed. Two paths:
            apply directly, or have a cap-table investor nominate you (faster).
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/founder/apply-to-collective">
            <Button size="sm" variant="outline" data-testid="button-dsc-apply">
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Apply to Collective
            </Button>
          </Link>
          <Link href="/founder/crm?context=intro-broker">
            <Button size="sm" className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid="button-dsc-promote">
              <Users className="h-3.5 w-3.5 mr-1.5" /> Have a cap-table member promote you
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
