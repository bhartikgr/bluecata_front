/**
 * Sprint 18 Phase 2 — T12.1 Capavate Collective info page rewrite.
 *
 * Per SPRINT-18-MANDATE.md: header "Capavate Collective", subtitle clarifies
 * Collective is invitation-only for accredited investors; eligibility section;
 * two CTAs (apply-to-present + about membership).
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useActiveCompanyId } from "@/lib/useActiveCompany";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Users, ShieldCheck, ArrowUpRight, Check, Building2 } from "lucide-react";
import { Link } from "wouter";

export default function Collective() {
  const companyId = useActiveCompanyId();
  const nominationsQ = useQuery<Array<{ status: string }>>({
    queryKey: ["/api/founder/collective/nominations", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/collective/nominations?companyId=${companyId}`)).json().catch(() => []),
    retry: false,
  });
  const applicationsQ = useQuery<Array<{ status: string }>>({
    queryKey: ["/api/founder/collective/applications", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/collective/applications?companyId=${companyId}`)).json().catch(() => []),
    retry: false,
  });

  const statusBadge = (() => {
    const apps = applicationsQ.data ?? [];
    const noms = nominationsQ.data ?? [];
    if (apps.some(a => a.status === "invited" || a.status === "accepted") || noms.some(n => n.status === "vouched")) return { label: "Active member", className: "bg-emerald-100 text-emerald-800 border-emerald-300" };
    if (apps.length > 0 || noms.length > 0) return { label: "Pending review", className: "bg-amber-100 text-amber-800 border-amber-300" };
    return { label: "Not applied", className: "bg-secondary text-muted-foreground border-border" };
  })();

  return (
    <>
      <PageHeader
        title="Capavate Collective"
        description="An invitation-only network of accredited investors engaging with global deal flow."
        breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Collective" }]}
      />
      <PageBody>
        <div className="mb-4 flex items-center gap-2" data-testid="collective-status-bar">
          <span className="text-sm font-medium text-muted-foreground">Your status:</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusBadge.className}`} data-testid="badge-collective-status">{statusBadge.label}</span>
        </div>
        <Card className="overflow-hidden mb-6" data-testid="card-collective-hero">
          <div className="bg-gradient-to-br from-[hsl(219_45%_20%)] via-[hsl(219_45%_18%)] to-[hsl(0_100%_40%)] text-white p-8">
            <Badge className="bg-white/20 text-white border-0 mb-3">Collective</Badge>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight max-w-2xl">
              An invitation-only network of accredited investors.
            </h2>
            <p className="text-white/85 mt-3 max-w-2xl leading-relaxed">
              The Capavate Collective is a global community of accredited investors engaging with
              like-minded peers and curated deal flow. Membership is reserved for investors who
              meet accreditation and contribution thresholds. Companies do <strong>not</strong>{" "}
              join the Collective &mdash; they apply to <strong>present</strong> to its members.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-6">
              <Link href="/founder/apply-to-collective">
                <Button
                  className="bg-white text-[hsl(219_45%_20%)] hover:bg-white/90 h-11 px-6"
                  data-testid="button-apply-to-present"
                >
                  Learn about applying to present <ArrowUpRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
              {/* v24.4 BUG 050 — link to the internal membership route instead of
                  an external capavate.com page that can 404 independently of the
                  SPA. /collective/membership exists in App.tsx and navigates
                  within the SPA. */}
              <Link href="/collective/membership" className="inline-flex">
                <Button
                  variant="outline"
                  className="bg-transparent border-white/40 text-white hover:bg-white/10 hover:text-white h-11 px-6"
                  data-testid="button-membership-info"
                >
                  About Collective membership (for investors){" "}
                  <ArrowUpRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </Card>

        {/* Eligibility section */}
        <Card className="mb-6" data-testid="card-eligibility">
          <CardContent className="p-6">
            <div className="flex items-start gap-3 mb-4">
              <ShieldCheck className="h-5 w-5 text-[hsl(0_100%_40%)] mt-0.5" />
              <div>
                <h3 className="font-semibold text-sm">Eligibility</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-3xl leading-relaxed">
                  Membership in the Capavate Collective is open <strong>only</strong> to
                  accredited investors looking to engage with like-minded global investors and
                  deals. Membership applications happen on the <strong>investor side</strong>{" "}
                  &mdash; founders cannot apply for membership; founders apply only to{" "}
                  <em>present</em> to the network.
                </p>
              </div>
            </div>
            <ul className="space-y-2 text-sm mt-4">
              {[
                "Verified accreditation per regional regulation (US Reg D 506(c), CA NI 45-106, UK FCA, SG MAS, AU ASIC)",
                "Active investing track record (\u2265 3 rounds in the last 24 months)",
                "Contribution to chapter meetings and deal reviews",
                "Hash-chain audit-trail consent (R165 \u00a712)",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2 text-muted-foreground">
                  <Check className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* What's inside */}
        <Card className="mb-6">
          <CardContent className="p-6 grid md:grid-cols-3 gap-5">
            {[
              {
                icon: Users,
                title: "Chapters & meetings",
                desc: "Curated investor cohorts in 14 cities with monthly deal reviews.",
              },
              {
                icon: Sparkles,
                title: "DSC screening rooms",
                desc: "Distributed Single-Check vehicles for high-conviction allocations.",
              },
              {
                icon: ShieldCheck,
                title: "Compliance baked in",
                desc: "Hash-chain audit, accreditation re-verification, KYC sweeps.",
              },
            ].map((f, i) => (
              <div key={i} className="flex gap-3">
                <f.icon className="h-5 w-5 text-[hsl(0_100%_40%)] mt-0.5" />
                <div>
                  <div className="font-medium text-sm">{f.title}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{f.desc}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* For founders */}
        <Card data-testid="card-for-founders">
          <CardContent className="p-6">
            <div className="flex items-start gap-3 mb-3">
              <Building2 className="h-5 w-5 text-[hsl(0_100%_40%)] mt-0.5" />
              <div>
                <h3 className="font-semibold text-sm">For founders</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-3xl leading-relaxed">
                  To present to the Collective, apply via <strong>Apply to Collective</strong>.
                  Companies present to members for evaluation; this is not membership. Two paths
                  are available: an existing cap-table investor can vouch for you (<em>Path A</em>
                  ), or you can apply directly with a non-refundable application fee (<em>Path B</em>).
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <Link href="/founder/apply-to-collective">
                <Button
                  className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
                  data-testid="button-go-apply"
                >
                  Apply to present
                </Button>
              </Link>
              <Link href="/founder/dashboard">
                <Button variant="outline" data-testid="button-back-dashboard">
                  Back to workspace
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
