/**
 * W2 A5 — Collective first-sign-on accreditation blocker.
 *
 * Mounted by `CollectiveMemberGate` when `GET /api/collective/gate-state`
 * reports `requiresAccreditationDeclaration:true` (active member,
 * `accreditationStatus === "none"`). This surface is NOT KYC/AML — it only
 * captures the accredited-investor self-declaration required before a
 * member enters Collective. Uploading KYC documents is a separate, optional
 * convenience surfaced on the investor profile (see `OptionalKycUploadCard`)
 * and never gates entry here.
 *
 * On successful declaration (via the existing `AccreditationDeclaration`
 * card, which POSTs `/api/investor/compliance/accreditation-declaration`),
 * we invalidate the gate-state + chapters + declaration query keys so the
 * parent `CollectiveMemberGate` re-resolves membership and mounts children.
 */
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { queryClient } from "@/lib/queryClient";
import { AccreditationDeclaration } from "@/components/investor/AccreditationDeclaration";
import type { CollectiveLegalCopy } from "@shared/collectiveLegalCopy";

function LegalCopySlot({ copy }: { copy?: CollectiveLegalCopy }) {
  if (!copy) return null;
  return (
    <div
      className="mb-4 rounded-md border p-3 text-[12px] leading-relaxed"
      style={{ background: "var(--cv-surface-muted, #f8fafc)", borderColor: "var(--cv-border, #e2e8f0)", color: "var(--cv-text-muted, #475569)" }}
      data-testid={`collective-legal-copy-${copy.slot}`}
    >
      <div className="mb-1.5 flex items-center gap-2">
        {copy.status === "NON_LEGAL_ADVICE" && (
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide" data-testid={`badge-non-legal-advice-${copy.slot}`}>
            NON-LEGAL-ADVICE
          </Badge>
        )}
        {copy.title && <span className="text-xs font-semibold" style={{ color: "var(--cv-heading, #041e41)" }}>{copy.title}</span>}
      </div>
      <p className="whitespace-pre-wrap">{copy.body}</p>
    </div>
  );
}

export function CollectiveAccreditationBlocker({
  onDeclared,
  gateCopy,
  declarationCopy,
}: {
  onDeclared: () => void;
  gateCopy?: CollectiveLegalCopy;
  declarationCopy?: CollectiveLegalCopy;
}) {
  const handleSigned = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/collective/gate-state"] });
    queryClient.invalidateQueries({ queryKey: ["/api/me/chapters"] });
    queryClient.invalidateQueries({ queryKey: ["/api/investor/compliance/accreditation-declaration"] });
    onDeclared();
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-10" data-testid="collective-accreditation-blocker">
      <Card className="mb-4 border-black/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-[#cc0001]" />
            Complete accredited-investor self-declaration
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2" data-testid="collective-accreditation-blocker-body">
          <p>
            Your Collective membership is active, but before you can enter the Collective member
            experience you need to complete a one-time accredited-investor self-declaration below.
          </p>
          <p>
            This declaration is <span className="font-medium">not</span> a KYC/AML identity check. Any
            required KYC/AML verification happens separately, directly between you and the
            company/founder — it is optional and never blocks your Collective access.
          </p>
        </CardContent>
      </Card>

      <LegalCopySlot copy={gateCopy} />

      <AccreditationDeclaration onSigned={handleSigned} legalCopy={declarationCopy} />
    </div>
  );
}

export default CollectiveAccreditationBlocker;
