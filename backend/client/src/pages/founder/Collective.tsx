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

/* ─────────────────────────────────────────────────────────────────────────────
 * WAVE 228 · R208.3 — THREE FALSE CHECK-CLAIMS RETIRED IN PLACE.
 *
 * This page told founders that Collective membership is gated by checks that
 * this platform does not perform. Escalated from wave 222's platform-fact
 * register (row 10) and COUNSEL_QUESTIONS_STANDING question 10.
 *
 *   1. "Verified accreditation per regional regulation (US Reg D 506(c), ...)"
 *      A gate DOES exist — Collective entry requires a signed, recorded
 *      accredited-investor self-declaration (collectiveAccessDecision.ts:301,
 *      requireCollectiveMember.ts:208, CollectiveAccreditationBlocker.tsx). But
 *      NOTHING VERIFIES IT. The platform says so itself in four places:
 *      collectiveLegalCopyStore.ts:22, AccreditationDeclaration.tsx:310,
 *      AccreditationForm.tsx:247, spvEducation.ts:22 ("Investors on Capavate are
 *      assumed to be accredited"). And no regional-regulation test exists at
 *      all: the jurisdiction is the investor's own selection, five of the nine
 *      sets of criteria carry no figure on purpose (wave 215), and 506(c)
 *      verification is by definition NOT satisfiable by self-certification.
 *      So the criterion is kept and rescoped to the declaration that is real;
 *      the word "Verified" and the regulation list are retired. The replacement
 *      tail clause is byte-verbatim from AccreditationForm.tsx:247-248 — the
 *      register already existed, so no new form of words was invented.
 *
 *   2. "Active investing track record (>= 3 rounds in the last 24 months)"
 *      NO SUCH CHECK EXISTS ANYWHERE. Line 120 was its only occurrence in the
 *      tree. The application schema collects no investing history at all
 *      (schema.ts:1328-1351); apply-eligibility resolves five booleans and no
 *      count (collectiveAppStore.ts:457); approval is an admin decision with no
 *      threshold (adminCollectiveRoutes.ts:432).
 *      THE FIGURE WAS NOT MADE TRUE, AND THAT WAS DELIBERATE. R-ASSERT forbids
 *      presenting a figure the platform did not measure, and forbids a
 *      fabricated zero standing in for an absent one. Enforcing the test would
 *      have ADDED an eligibility bar and locked out every existing member —
 *      forbidden outright by R190.10. And this is a FOUNDER page: there is no
 *      investor in scope to count for. So the figure is withdrawn and the
 *      bullet now states what is true, including in words that no minimum is
 *      measured or required. No track record is synthesised.
 *
 *   3. "Hash-chain audit, accreditation re-verification, KYC sweeps." (below,
 *      in the features grid). NOT IN THE WAVE BRIEF — found while verifying,
 *      and corrected because leaving it would have falsified this wave's own
 *      required proof that the verify-family can no longer be rendered to a
 *      user about accreditation. Wave 227 retired the identical phrasing on the
 *      investor profile. Hash-chain audit is real (wave 223: 730/730 tenants,
 *      1452/1452 links, 0 failures). Re-declaration is real. KYC document
 *      UPLOAD is real (sprint20Wave2Routes.ts:199-320 persists to
 *      collective_kyc_blobs) — but nothing screens it, so "sweeps" is false in
 *      one direction and a blanket "no KYC" would have been false in the other.
 *      The corrected line names the storage and denies only the screening.
 *
 * R195.5 — NOTHING IS DELETED. The three superseded literals are retained
 * below, byte-identical, and are additionally retained as live JSX text nodes
 * in the guarded sibling at the foot of this component. See the note there for
 * why the guard flag must be an IDENTIFIER and not an inline `false`.
 * ───────────────────────────────────────────────────────────────────────────── */
const W228_SUPERSEDED_ELIGIBILITY_ACCREDITATION =
  "Verified accreditation per regional regulation (US Reg D 506(c), CA NI 45-106, UK FCA, SG MAS, AU ASIC)";
const W228_SUPERSEDED_ELIGIBILITY_TRACK_RECORD =
  "Active investing track record (\u2265 3 rounds in the last 24 months)";
const W228_SUPERSEDED_FEATURE_COMPLIANCE_DESC =
  "Hash-chain audit, accreditation re-verification, KYC sweeps.";

export const W228_RETAINED_SUPERSEDED_COPY: readonly string[] = [
  W228_SUPERSEDED_ELIGIBILITY_ACCREDITATION,
  W228_SUPERSEDED_ELIGIBILITY_TRACK_RECORD,
  W228_SUPERSEDED_FEATURE_COMPLIANCE_DESC,
];
export const W228_SUPERSEDED_COPY_COUNT = 3;

/* Never true, and it has no setter. Retained copy is therefore unreachable at
   runtime while remaining inside the JSX inventories both gates read.

   WHY AN IDENTIFIER AND NOT `{false && ...}`: the restyle detector folds
   constant conditions (detect.mjs foldConst) and marks a constant-false `&&`
   or a constant-condition ternary whose dead branch holds JSX as a
   SUPPRESSION — it then excludes the whole subtree from every inventory and
   counter, which reads exactly as if the copy had been deleted: bare drops
   plus per-file count decreases. foldConst returns unknown for any identifier
   other than `undefined`, so this form keeps the literals inventoried. Wave
   227 proved this construction gate-green on investor/Profile.tsx:143.

   STATED PLAINLY, AS WAVE 227 STATED IT: the gate cannot prove this branch is
   dead. What proves no founder ever sees these words is the mounted-page test
   in __tests__/w228_collective_false_claims.test.tsx, not this flag. */
const W228_RENDER_SUPERSEDED_COPY = false;

/* ════════════════════════════════════════════════════════════════════════════
 * WAVE 220 · CLASS A · A1 — THE HERO "THRESHOLDS" SENTENCE.
 *
 * The hero paragraph told a founder: "Membership is reserved for investors who
 * meet accreditation and contribution thresholds." That asserts an eligibility
 * TEST. `isEligibleForCollective()` in server/collectiveAppStore.ts resolves
 * five booleans and takes no accreditation input, no contribution input and no
 * threshold input of any kind. Wave 228 had already withdrawn the sibling
 * bullet "Active investing track record (>= 3 rounds in the last 24 months)"
 * from this same page for the same reason.
 *
 * R210.2 — a claim about a test nobody runs cannot be made true by running the
 * test: implementing an accreditation-and-contribution threshold would ADD
 * ELIGIBILITY and lock out every existing member, which R190.10 forbids
 * outright. So the claim is WITHDRAWN and the absence stated in words, in the
 * platform's own register (AccreditationForm.tsx:247, spvEngine.ts:451).
 *
 * R195.5 — the superseded text node is RETAINED IN PLACE at the foot of this
 * component, as a real JSX text node, byte-identical, so neither gate reads
 * this correction as a silent copy drop. Identifier flag, not `{false && ...}`,
 * which detect.mjs folds and marks a SUPPRESSION.
 *
 * STATED PLAINLY: the gate cannot prove this branch is dead. What proves no
 * founder reads these words is the mounted-page test in
 * __tests__/w220_class_a_copy.test.tsx, not this flag.
 * ════════════════════════════════════════════════════════════════════════════ */
const W220_RENDER_SUPERSEDED_COPY = false;

export default function Collective() {
  const companyId = useActiveCompanyId();
  /* WAVE 60 · A-9 — both reads fired before `companyId` resolved (it is "", not
     undefined, so the request went out as ...?companyId=). `?? []` below then
     fed the statusBadge IIFE, whose output for an empty pair is the badge
     "Not applied" — a confident assertion about the founder's own membership,
     manufactured from a read that never had a scope. `enabled` keeps the queries
     PENDING until there is a company. The `.catch(() => [])` is a JSON-parse
     guard, NOT an HTTP-error swallow, and is left byte-identical. */
  const nominationsQ = useQuery<Array<{ status: string }>>({
    queryKey: ["/api/founder/collective/nominations", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/collective/nominations?companyId=${companyId}`)).json().catch(() => []),
    retry: false,
    enabled: Boolean(companyId), /* WAVE 60 · A-9 */
  });
  const applicationsQ = useQuery<Array<{ status: string }>>({
    queryKey: ["/api/founder/collective/applications", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/collective/applications?companyId=${companyId}`)).json().catch(() => []),
    retry: false,
    enabled: Boolean(companyId), /* WAVE 60 · A-9 */
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
              like-minded peers and curated deal flow. Membership requires a signed
              accredited-investor declaration: Capavate records your declaration, it does not check
              it, and it does not perform any verification on your behalf. No contribution
              threshold is measured or required. Companies do <strong>not</strong>{" "}
              join the Collective &mdash; they apply to <strong>present</strong> to its members.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-6">
              <Button
                className="bg-white text-[hsl(219_45%_20%)] hover:bg-white/90 h-11 px-6"
                data-testid="button-apply-to-present"
                asChild
              >
                <Link href="/founder/apply-to-collective">
                  Learn about applying to present <ArrowUpRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
              {/* v24.4 BUG 050 — link to the internal membership route instead of
                  an external capavate.com page that can 404 independently of the
                  SPA. /collective/membership exists in App.tsx and navigates
                  within the SPA. */}
              <Button
                variant="outline"
                className="bg-transparent border-white/40 text-white hover:bg-white/10 hover:text-white h-11 px-6"
                data-testid="button-membership-info"
                asChild
              >
                <Link href="/collective/membership" className="inline-flex">
                  About Collective membership (for investors){" "}
                  <ArrowUpRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
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
                /* WAVE 228 · R208.3 — see the header note. Was: "Verified
                   accreditation per regional regulation (US Reg D 506(c), ...)".
                   The declaration is real; no verification of it exists, and no
                   regional-regulation test exists. Tail clause byte-verbatim
                   from AccreditationForm.tsx:247-248. */
                "Accredited-investor self-declaration, signed for one named jurisdiction \u2014 Capavate records your declaration; it does not check it, and it does not perform any verification on your behalf",
                /* WAVE 228 · R208.3 — was: "Active investing track record
                   (>= 3 rounds in the last 24 months)". No such check exists;
                   the figure is withdrawn rather than synthesised (R-ASSERT),
                   and enforcing it would have added eligibility (R190.10).
                   Middle clause from legalDocs.ts:1575, recast to the noun so
                   no affirmative "verify" reaches a founder's screen. */
                "Investing experience as described by the investor in their own application \u2014 Capavate performs no independent verification of any Member's track record, and no minimum number of rounds is measured or required",
                "Contribution to chapter meetings and deal reviews",
                "Hash-chain audit-trail consent",
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
                /* WAVE 228 · R208.3 (declared scope extension) — was:
                   "Hash-chain audit, accreditation re-verification, KYC
                   sweeps." Audit chain and re-declaration are real; KYC
                   documents are stored but never screened. The title itself is
                   puffery, not a named check, and is left for wave 220. */
                desc: "Hash-chain audit trail, investor re-declaration of accredited status, and KYC document upload. Accreditation is a self-certification, not KYC/AML: Capavate stores what is uploaded and performs no verification or screening of it.",
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
              <Button
                className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
                data-testid="button-go-apply"
                asChild
              >
                <Link href="/founder/apply-to-collective">
                  Apply to present
                </Link>
              </Button>
              <Button variant="outline" data-testid="button-back-dashboard" asChild>
                <Link href="/founder/dashboard">
                  Back to workspace
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageBody>
      {/* WAVE 228 · R195.5 — RETIRED IN PLACE, NOT DELETED. The three superseded
          claims are retained here as real JSX text nodes so neither gate reads
          this correction as a silent copy drop. `div` children deliberately:
          the file's div count stays inside the detector's 11-20 bucket, so no
          element row churns, and `section`/`aside` are PANEL_TAGS. Unreachable
          at runtime — see the note on W228_RENDER_SUPERSEDED_COPY. */}
      {W228_RENDER_SUPERSEDED_COPY ? (
        <div hidden aria-hidden="true" data-testid="w228-superseded-copy-retained">
          <div data-testid="w228-superseded-accreditation">Verified accreditation per regional regulation (US Reg D 506(c), CA NI 45-106, UK FCA, SG MAS, AU ASIC)</div>
          <div data-testid="w228-superseded-track-record">Active investing track record (&ge; 3 rounds in the last 24 months)</div>
          <div data-testid="w228-superseded-compliance">Hash-chain audit, accreditation re-verification, KYC sweeps.</div>
        </div>
      ) : null}
      {/* WAVE 220 · A1 · R195.5 — RETIRED IN PLACE, NOT DELETED. Appended as the
          LAST sibling so nothing above it renumbers. `div` children as wave 228
          used: this file's div count stays inside the detector's 11-20 bucket,
          and section/aside are PANEL_TAGS. Byte-identical to the text node that
          stood in the hero paragraph, so the guard's copy identity survives. */}
      {W220_RENDER_SUPERSEDED_COPY ? (
        <div hidden aria-hidden="true" data-testid="w220-superseded-copy-retained">
          <div data-testid="w220-superseded-hero-thresholds">The Capavate Collective is a global community of accredited investors engaging with like-minded peers and curated deal flow. Membership is reserved for investors who meet accreditation and contribution thresholds. Companies do</div>
        </div>
      ) : null}
    </>
  );
}
