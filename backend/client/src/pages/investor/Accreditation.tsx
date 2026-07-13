/**
 * v26.1.x AVI-ACCRED — Investor accreditation self-declaration page.
 *
 * The funding-chain linchpin. The money-core wire-funded gate
 * (captableCommitStore.ts:872) returns 412 ACCREDITATION_REQUIRED with
 * `resolutionUrl: /investor/accreditation?investorId=…` when the investor has
 * no valid accredited-investor self-declaration. That deep-link used to
 * dead-end (no route). This thin page hosts the existing, migration-0103-backed
 * <AccreditationDeclaration/> capture card so the investor can satisfy the gate
 * from the investor side — the money core is NEVER touched.
 *
 * The `?investorId=` query param is DISPLAY / parity ONLY (mirrors the 412
 * resolutionUrl). The actual write is ALWAYS keyed off the authenticated
 * session userId (server-resolved in investorComplianceRoutes.ts) — an investor
 * can never sign for another.
 *
 * Rule #13 — the typed signature captured by the card is the full legal name.
 */
import { useSearch, useLocation } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ArrowLeft } from "lucide-react";
import { AccreditationDeclaration } from "@/components/investor/AccreditationDeclaration";

export default function InvestorAccreditation() {
  const search = useSearch();
  const [, navigate] = useLocation();
  // Display/parity only — the write is keyed off the authed session userId.
  const investorIdParam = new URLSearchParams(search).get("investorId") ?? undefined;

  return (
    <>
      <PageHeader
        title="Accredited-investor self-certification"
        description="Sign or re-confirm your accredited-investor status to unblock funding on your rounds."
      />
      <PageBody>
        <div className="max-w-2xl space-y-4" data-testid="investor-accreditation-page">
          <Button
            variant="ghost"
            onClick={() => navigate("/investor/invitations")}
            data-testid="button-accreditation-back"
          >
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to invitations
          </Button>

          <Card data-testid="card-accreditation-intro">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                Why you're here
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                Marking a round funded requires a current accredited-investor
                self-declaration on file. Complete the certification below, or
                confirm your existing declaration is still accurate.
              </p>
              {investorIdParam ? (
                <p className="text-xs" data-testid="text-accreditation-investor-id">
                  Investor reference: <span className="font-mono">{investorIdParam}</span>
                </p>
              ) : null}
            </CardContent>
          </Card>

          <AccreditationDeclaration
            onSigned={() => {
              /* Stay on the page; the card shows the signed summary + confirm
                 control after invalidating its GET. Nothing else to do here. */
            }}
          />
        </div>
      </PageBody>
    </>
  );
}
