/**
 * Wave C-3 — Collective Deal Room Detail
 * Per-company 4-tab view: Overview, M&A Readiness, Cap Table Summary, Activity
 */

import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, ExternalLink, Globe, Linkedin, BookOpen, BarChart3, FileText } from "lucide-react";
import { safeExternalHref } from "@/lib/safeUrl"; /* v25.17 Lane D NC3 — block javascript: URL XSS */
/* WAVE 36 · ROW 4 — the two cap-table-summary money rows below were the last
   live money-exponent-fence violations. Both fields are USD by declaration
   (`lastValuationUsd`; `lastRaiseAmount` is populated from `lastRaiseSizeUsd`)
   and both render a hardcoded `$`, which is why Wave 34 BASELINED them rather
   than fixing them. Wave 36 fixes them instead of re-pinning: `fromMinor`
   supplies the ISO-4217 exponent, so the rendered string is byte-identical for
   USD today and stays correct if the source field is ever re-denominated. */
import { fromMinor } from "@/lib/currency";

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700",
  B: "bg-blue-100 text-blue-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-red-100 text-red-600",
};

const STATUS_COLORS: Record<string, string> = {
  exploring: "bg-amber-100 text-amber-700",
  active: "bg-blue-100 text-blue-700",
  closing: "bg-emerald-100 text-emerald-700",
  not_pursuing: "bg-slate-100 text-slate-500",
};

function ReadinessBar({ label, value, testId }: { label: string; value: number | null; testId: string }) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        {value !== null ? (
          <span className="font-medium" style={{ color: "#cc0001" }}>{value}%</span>
        ) : (
          <span className="text-slate-400">No data</span>
        )}
      </div>
      <Progress
        value={value ?? 0}
        className="h-2"
        data-testid={`${testId}-bar`}
      />
    </div>
  );
}

export default function CollectiveDealRoomDetail() {
  const { companyId } = useParams<{ companyId: string }>();
  const [, navigate] = useLocation();

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/collective/companies", companyId],
    queryFn: () => apiRequest("GET", `/api/collective/companies/${companyId}`).then((r) => r.json()),
    enabled: !!companyId,
  });

  // DSC-1c — pitch deck
  type PitchDeckOkResponse = { ok: true; pitchDeck: { id: string; originalName: string; mimeType: string }; url: string; expiresAt: string };
  type PitchDeckErrResponse = { ok?: false; error: string };
  const pitchDeckQ = useQuery<PitchDeckOkResponse | PitchDeckErrResponse>({
    queryKey: ["/api/collective/dsc/pitch-deck", companyId],
    queryFn: () => apiRequest("GET", `/api/collective/dsc/pitch-deck/${companyId}`).then((r) => r.json()),
    enabled: !!companyId && !isLoading && !error,
    retry: false,
  });
  const pitchDeckOk = pitchDeckQ.data && "ok" in pitchDeckQ.data && pitchDeckQ.data.ok === true;
  const pitchDeck = pitchDeckOk ? (pitchDeckQ.data as PitchDeckOkResponse).pitchDeck : null;
  const pitchDeckUrl = pitchDeckOk ? (pitchDeckQ.data as PitchDeckOkResponse).url : null;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="error-detail">
          Failed to load company detail. Please go back and try again.
        </div>
      </div>
    );
  }

  const { profile, mnaReadiness, capTableSummary, transactionPrepChannel, recentActivity } = data;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Back */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/collective/dealroom")}
        className="text-slate-500 hover:text-slate-700 -ml-1 gap-1"
        data-testid="button-back-dealroom"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Deal Room
      </Button>

      {/* Hero */}
      <div className="flex items-start gap-4">
        {profile.logoUrl ? (
          <img
            src={profile.logoUrl}
            alt={profile.companyName}
            className="h-14 w-14 rounded-lg object-cover border"
            data-testid="img-company-logo"
          />
        ) : (
          <div
            className="h-14 w-14 rounded-lg flex items-center justify-center text-xl font-bold text-white shrink-0"
            style={{ backgroundColor: "#cc0001" }}
            data-testid="avatar-company-initials"
          >
            {profile.companyName?.[0] ?? "?"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1
              className="text-xl font-semibold"
              style={{ color: "#1A1A2E" }}
              data-testid="heading-company-name"
            >
              {profile.companyName}
            </h1>
            {mnaReadiness.transactionPrepStatus && (
              <Badge
                className={`text-[10px] capitalize ${STATUS_COLORS[mnaReadiness.transactionPrepStatus] ?? "bg-slate-100 text-slate-500"}`}
                data-testid="badge-prep-status"
              >
                {mnaReadiness.transactionPrepStatus.replace("_", " ")}
              </Badge>
            )}
            {mnaReadiness.composite?.autoTier && (
              <Badge
                className={`text-[10px] ${TIER_COLORS[mnaReadiness.composite.autoTier]}`}
                data-testid="badge-auto-tier"
              >
                Tier {mnaReadiness.composite.autoTier}
              </Badge>
            )}
          </div>
          {profile.tagline && (
            <p className="text-sm text-slate-600 mt-1" data-testid="text-tagline">{profile.tagline}</p>
          )}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {profile.sector && (
              <Badge variant="outline" className="text-xs" data-testid="badge-sector">
                {profile.sector}
              </Badge>
            )}
            {profile.stage && (
              <Badge variant="outline" className="text-xs" data-testid="badge-stage">
                {profile.stage}
              </Badge>
            )}
            {/* Wave B1 (3a) — "Led by" the originating Consortium Partner, when the
                company is partner-attributed (from consortium_links). Investors
                and members can see a registered partner is leading the raise. */}
            {profile.attributedPartner?.name && (
              <Badge className="text-xs bg-[var(--cv-color-navy)] text-white" data-testid="badge-led-by-partner">
                Led by {profile.attributedPartner.name}
              </Badge>
            )}
            {/* v25.17 Lane D NC3 — safeExternalHref hides any link whose URL is not http/https */}
            {safeExternalHref(profile.linkedinUrl) && (
              <a href={safeExternalHref(profile.linkedinUrl)!} target="_blank" rel="noopener noreferrer" data-testid="link-linkedin">
                <Linkedin className="h-4 w-4 text-slate-400 hover:text-[#cc0001]" />
              </a>
            )}
            {safeExternalHref(profile.crunchbaseUrl) && (
              <a href={safeExternalHref(profile.crunchbaseUrl)!} target="_blank" rel="noopener noreferrer" data-testid="link-crunchbase">
                <Globe className="h-4 w-4 text-slate-400 hover:text-[#cc0001]" />
              </a>
            )}
            {safeExternalHref(profile.pitchbookUrl) && (
              <a href={safeExternalHref(profile.pitchbookUrl)!} target="_blank" rel="noopener noreferrer" data-testid="link-pitchbook">
                <BookOpen className="h-4 w-4 text-slate-400 hover:text-[#cc0001]" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList data-testid="tabs-company-detail">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="mna" data-testid="tab-mna">M&A Readiness</TabsTrigger>
          <TabsTrigger value="captable" data-testid="tab-captable">Cap Table Summary</TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">Activity</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card data-testid="card-business-basics">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>Business Basics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="HQ" value={profile.hq} />
                <Row label="Employees" value={profile.employees} />
                <Row label="Jurisdiction" value={profile.jurisdiction} />
                <Row label="Sector" value={profile.sector} />
                <Row label="Stage" value={profile.stage} />
              </CardContent>
            </Card>
            <Card data-testid="card-financials">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>Financials</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="ARR" value={profile.arrUsd ? `$${(profile.arrUsd / 100).toLocaleString()}` : null} />
                <Row label="MRR" value={profile.mrrUsd ? `$${(profile.mrrUsd / 100).toLocaleString()}` : null} />
                {/* WAVE 35 - ROW 8: the /100 here was the mirror of the write
                    path's *100. With percent-as-written binding
                    (spec/PERCENT_POLICY_v2.md, owner ruling OR-1), the stored
                    number IS the percentage, so dividing here would render a
                    70% margin as 0.7%. THIRD path for this defect, found by
                    grepping every reader rather than only the two the review
                    named. See the migration note in the wave report: rows
                    written before this row may still hold the x100 form and
                    are NOT silently reinterpreted. */}
                <Row label="Gross Margin" value={profile.grossMarginPct ? `${profile.grossMarginPct.toFixed(1)}%` : null} />
                <Row label="Runway" value={profile.runwayMonths ? `${profile.runwayMonths} months` : null} />
                <Row label="Growth Rate" value={profile.growthRatePct ? `${profile.growthRatePct.toFixed(1)}%` : null} />
                <Row label="Customers" value={profile.customerCount} />
              </CardContent>
            </Card>
          </div>
          {(profile.shortPitch || profile.longPitch || profile.missionStatement) && (
            <Card data-testid="card-pitch">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>About</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-600 space-y-2">
                {profile.shortPitch && <p data-testid="text-short-pitch">{profile.shortPitch}</p>}
                {profile.longPitch && <p className="text-xs" data-testid="text-long-pitch">{profile.longPitch}</p>}
                {profile.missionStatement && (
                  <p className="text-xs italic text-slate-500" data-testid="text-mission">&ldquo;{profile.missionStatement}&rdquo;</p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* M&A Readiness Tab */}
        <TabsContent value="mna" className="mt-4 space-y-4">
          <Card data-testid="card-mna-readiness">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                  M&A Readiness
                </CardTitle>
                {mnaReadiness.composite ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Composite score:</span>
                    <span className="text-lg font-bold" style={{ color: "#cc0001" }} data-testid="text-composite-score">
                      {mnaReadiness.composite.compositeScore}
                    </span>
                    <Badge className={`text-[10px] ${TIER_COLORS[mnaReadiness.composite.autoTier] ?? ""}`} data-testid="badge-composite-tier">
                      Tier {mnaReadiness.composite.autoTier}
                    </Badge>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400" data-testid="text-no-dsc-score">No DSC score yet</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ReadinessBar label="IP Due Diligence" value={mnaReadiness.ipDdReadinessPct} testId="readiness-ip" />
              <ReadinessBar label="Customer Contracts" value={mnaReadiness.customerContractsReadinessPct} testId="readiness-customers" />
              <ReadinessBar label="Financial Audit" value={mnaReadiness.financialAuditReadinessPct} testId="readiness-financial" />
              <ReadinessBar label="Data Room Organisation" value={mnaReadiness.dataRoomOrganizedPct} testId="readiness-dataroom" />
              <ReadinessBar label="Regulatory Filings" value={mnaReadiness.regulatoryFilingsCompletePct} testId="readiness-regulatory" />
              <ReadinessBar label="ESG Disclosure" value={mnaReadiness.esgDisclosureCompletePct} testId="readiness-esg" />
            </CardContent>
          </Card>

          {mnaReadiness.composite?.sectorBenchmark !== null && mnaReadiness.composite?.sectorBenchmark !== undefined && (
            <Card data-testid="card-sector-benchmark">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <BarChart3 className="h-5 w-5 text-[#cc0001]" />
                  <div>
                    <p className="text-xs text-slate-500">Sector benchmark (median)</p>
                    <p className="text-lg font-bold" style={{ color: "#1A1A2E" }} data-testid="text-sector-benchmark">
                      {mnaReadiness.composite.sectorBenchmark}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {mnaReadiness.dscFeedback && (
            <Card data-testid="card-dsc-feedback">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>DSC Committee Feedback</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">DSC Tier:</span>
                  <Badge className="text-[10px] capitalize" data-testid="badge-dsc-tier">
                    {mnaReadiness.dscFeedback.tier}
                  </Badge>
                </div>
                {mnaReadiness.dscFeedback.narrative && (
                  <p className="text-xs text-slate-600" data-testid="text-dsc-narrative">
                    {mnaReadiness.dscFeedback.narrative}
                  </p>
                )}
                <p className="text-[10px] text-slate-400">
                  Last reviewed: {new Date(mnaReadiness.dscFeedback.receivedAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          )}

          {/* DSC-1c — Pitch Deck */}
          <Card data-testid="card-pitch-deck">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>Pitch Deck</CardTitle>
            </CardHeader>
            <CardContent>
              {pitchDeckQ.isLoading && <p className="text-xs text-slate-400">Loading…</p>}
              {!pitchDeckQ.isLoading && pitchDeckOk && pitchDeck && safeExternalHref(pitchDeckUrl) ? (
                <a
                  href={safeExternalHref(pitchDeckUrl)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-[#cc0001] hover:underline"
                  data-testid="dsc-pitch-deck-link"
                >
                  <FileText className="h-4 w-4" />
                  {pitchDeck.originalName}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                !pitchDeckQ.isLoading && <p className="text-xs text-slate-400" data-testid="dsc-pitch-deck-link">No pitch deck uploaded.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cap Table Summary Tab */}
        <TabsContent value="captable" className="mt-4">
          <Card data-testid="card-cap-table-summary">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>Cap Table Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700 mb-3" data-testid="notice-cap-table-readonly">
                Read-only aggregate view. Per-shareholder detail is not disclosed.
              </div>
              <Row label="ESOP Pool %" value={capTableSummary.esopPoolPct ? `${capTableSummary.esopPoolPct}%` : null} testId="captable-esop" />
              <Row label="Last Valuation" value={capTableSummary.lastValuationUsd ? `$${fromMinor(capTableSummary.lastValuationUsd, "USD").toLocaleString()}` : null} testId="captable-valuation" />
              <Row label="Stage" value={capTableSummary.stage} testId="captable-stage" />
              <Row label="Last Raise Date" value={capTableSummary.lastRaiseDate ? new Date(capTableSummary.lastRaiseDate).toLocaleDateString() : null} testId="captable-raise-date" />
              <Row label="Last Raise Amount" value={capTableSummary.lastRaiseAmount ? `$${fromMinor(capTableSummary.lastRaiseAmount, "USD").toLocaleString()}` : null} testId="captable-raise-amount" />
              <p className="text-xs text-slate-400 mt-3">{capTableSummary.note}</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" className="mt-4">
          <Card data-testid="card-activity">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {!recentActivity?.length ? (
                <div className="py-8 text-center text-slate-500 text-sm" data-testid="empty-activity">
                  No activity recorded yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {recentActivity.map((e: { id: string; ts: string; actor: string; eventType: string; entity: string }) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between py-2 px-3 rounded bg-slate-50 text-xs"
                      data-testid={`row-activity-${e.id}`}
                    >
                      <div>
                        <span className="font-medium text-slate-700">{e.eventType}</span>
                        <span className="text-slate-400 ml-2">{e.actor}</span>
                      </div>
                      <span className="text-slate-400">{new Date(e.ts).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({
  label, value, testId,
}: {
  label: string;
  value: string | number | null | undefined;
  testId?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span
        className="text-slate-800 text-right"
        data-testid={testId}
      >
        {value != null && value !== "" ? String(value) : <span className="text-slate-400">—</span>}
      </span>
    </div>
  );
}
