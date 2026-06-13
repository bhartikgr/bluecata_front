/**
 * Sprint 7 — Founder view of their company. Mirrors the investor view in
 * shape but always exposes the gated sections (rounds / dataroom /
 * soft-circle book / term sheet).
 */

import { useRoute } from "wouter";
import { CompanyDetailsPage } from "@/pages/CompanyDetails";
import NotFound from "@/pages/not-found";

export default function FounderCompanyDetail() {
  const [, params] = useRoute("/founder/companies/:id");
  const id = params?.id;
  if (!id) return <NotFound />;
  return (
    <CompanyDetailsPage
      companyId={id}
      viewerRole="founder"
      backHref="/founder/dashboard"
      backLabel="Founder workspace"
    />
  );
}
