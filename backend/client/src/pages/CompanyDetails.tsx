/**
 * Sprint 8 — Shared company-details renderer (full live + Collective parity).
 *
 * Renders all 19 sections per the live Capavate site + Collective. Sections
 * gated by viewer role + invitation status (per R200.gating §5) are hidden
 * entirely when access is false — no "no access" warning.
 *
 * Sources:
 * - capavate_founder_deep_audit.md (every field rendered here)
 * - capavate_collective_sync_schema.md §5 (gated sections)
 * - capavate_gating_addendum.md §5 (Capavate ↔ Collective parity)
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { PageBody, PageHeader } from "@/components/AppShell";
import { CapTableChannelCard, SoftCircleChannelCard } from "@/components/comms/ChannelCards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
 Building2, MapPin, Globe, Briefcase, Users, Target, Shield, FileText, FolderOpen,
 AlertTriangle, ExternalLink, Layers, FileSignature, BookOpen, Newspaper,
 Check, X, MessageCircle, BarChart3, Lock,
} from "lucide-react";
import { fmtUSD } from "@/lib/format";
import {
 STRATEGIC_PRIORITY_OPTIONS, TRANSACTION_INTEREST_OPTIONS, PARTNER_TYPE_OPTIONS,
 DEAL_BREAKER_OPTIONS, OPERATING_GEOGRAPHY_OPTIONS, CUSTOMER_SEGMENT_OPTIONS,
 INDUSTRY_OPTIONS,
} from "@/lib/profile/data/enums";
import type { CompanyProfile } from "@/lib/profile/types";

type CompanyDetail = {
 id: string;
 name: string;
 legalName: string;
 sector: string;
 stage: string;
 hq: string;
 websiteUrl: string;
 description: string;
 founded?: string;
 employees?: number;
 headliner?: string;
 founderBios?: Array<{ name: string; role: string; bio: string; visible: boolean; photoUrl?: string }>;
 problem?: string;
 solution?: string;
 legalEntity?: { name: string; jurisdiction: string; entityType: string; ein: string };
 mailingAddress?: string;
 marketPresence?: { tam: string; sam: string; som: string; geos: string[] };
 strategicPriorities?: string[];
 maIntelligence?: Array<{ field: string; value: string }>;
 competitors?: Array<{ name: string; differentiator: string; stage: string }>;
 concentrationFlags?: Array<{ kind: string; note: string }>;
 pressMentions?: Array<{ outlet: string; title: string; date: string; url: string }>;
 /** Sprint 8 — live profile from the production-shape store. */
 profile: CompanyProfile | null;
 /** Sprint 8 — M&A composite + components from the engine. */
 maScore?: { score: number; components: Array<{ label: string; weight: number; awarded: number }> };
 access: {
 role: string;
 canSeeRound: boolean;
 canSeeDataroom: boolean;
 canSeeSoftCircle: boolean;
 canSeeTermSheet: boolean;
 investorId: string;
 };
 rounds: Array<{ id: string; name: string; type: string; state: string; targetAmount?: number; preMoney?: number; postMoney?: number }> | null;
 dataroom: Array<{ id: string; category: string; name: string; sizeBytes: number }> | null;
 softCircles: Array<{ id: string; investorName: string; amount: number; status: string }> | null;
 termSheet: { available: boolean; lastUpdated: string } | null;
};

type CoMember = {
 id: string;
 legalName: string;
 visibility: { screenName: string | null; visibleToCoMembers: boolean };
 role: "founder" | "investor";
 shares?: number;
};

export function CompanyDetailsPage({
 companyId,
 viewerRole,
 backHref,
 backLabel,
}: {
 companyId: string;
 viewerRole: "founder" | "investor" | "admin";
 backHref: string;
 backLabel: string;
}) {
 const url = `/api/companies/${companyId}?as=${viewerRole}`;
 const { data, isLoading, isError } = useQuery<CompanyDetail>({ queryKey: [url] });

 if (isLoading) {
 return (
 <>
 <PageHeader title="Loading company…" />
 <PageBody><div className="text-sm text-muted-foreground">Fetching company details…</div></PageBody>
 </>
 );
 }

 if (isError || !data) {
 return (
 <>
 <PageHeader title="Company not found" />
 <PageBody><div className="text-sm text-muted-foreground">We couldn&apos;t find that company.</div></PageBody>
 </>
 );
 }

 // Pull canonical profile if present; otherwise keep legacy paths.
 const profile = data.profile;

 return <CompanyDetailsView data={data} profile={profile} viewerRole={viewerRole} backHref={backHref} backLabel={backLabel} />;
}

function CompanyDetailsView({
 data, profile, viewerRole, backHref, backLabel,
}: {
 data: CompanyDetail;
 profile: CompanyProfile | null;
 viewerRole: "founder" | "investor" | "admin";
 backHref: string;
 backLabel: string;
}) {
 const { toast } = useToast();
 const [, navigate] = useLocation();

 // Resolve sector label from canonical industry value when available.
 const sectorLabel = profile?.contact.industry
 ? (INDUSTRY_OPTIONS.find(i => i.value === profile.contact.industry)?.label ?? data.sector)
 : data.sector;

 // Region badge — live from the legal section of the profile.
 const region = profile?.legal.region ?? "—";
 const engineAttribution = profile?.legal.engineAttribution;

 const headliner = profile?.contact.oneSentenceHeadliner ?? data.headliner ?? data.description;
 const problem = profile?.contact.problemStatement ?? data.problem;
 const solution = profile?.contact.solutionStatement ?? data.solution;
 const founders = data.founderBios?.filter(b => b.visible) ?? [];

 // Sprint 20 Wave 2 — co-members from API; hardcoded list removed (defect 88)
 // Co-member list is fetched in the investor-specific CompanyDetail page.
 // In this shared shell, show Coming Soon placeholder.
 const coMembers: CoMember[] = []; // Coming soon — fetched per-role in the role-specific view

 const dealBreakerLabel = (v: string) => DEAL_BREAKER_OPTIONS.find(o => o.value === v)?.label ?? v;
 const txInterestLabel = (v: string) => TRANSACTION_INTEREST_OPTIONS.find(o => o.value === v)?.label ?? v;
 const partnerLabel = (v: string) => PARTNER_TYPE_OPTIONS.find(o => o.value === v)?.label ?? v;
 const priorityLabel = (v: string) => STRATEGIC_PRIORITY_OPTIONS.find(o => o.value === v)?.label ?? v;
 const geoLabel = (v: string) => OPERATING_GEOGRAPHY_OPTIONS.find(o => o.value === v)?.label ?? v;
 const segmentLabel = (v: string) => CUSTOMER_SEGMENT_OPTIONS.find(o => o.value === v)?.label ?? v;

 return (
 <>
 <PageHeader
 title={profile?.contact.companyName ?? data.name}
 description={headliner}
 breadcrumbs={[{ href: backHref, label: backLabel }, { label: profile?.contact.companyName ?? data.name }]}
 actions={
 <div className="flex items-center gap-2">
 <Badge variant="outline" data-testid="badge-viewer-role" className="capitalize">{viewerRole} view</Badge>
 {region && region !== "—" && <Badge variant="outline" data-testid="badge-region">Region: {region}</Badge>}
 {(profile?.contact.companyWebsiteUrl ?? data.websiteUrl) && (
 <a href={profile?.contact.companyWebsiteUrl ?? data.websiteUrl} target="_blank" rel="noreferrer">
 <Button variant="outline" size="sm" data-testid="button-website">
 <Globe className="h-3.5 w-3.5 mr-1.5" /> Visit site
 </Button>
 </a>
 )}
 </div>
 }
 />
 <PageBody>
 {/* 1. Hero header */}
 <Card className="mb-5" data-testid="section-header">
 <CardContent className="p-5 flex items-start gap-4">
 <div className="h-16 w-16 rounded-md bg-[hsl(219_45%_20%)] text-white flex items-center justify-center shrink-0 overflow-hidden">
 {profile?.contact.logoDataUrl
 ? <img src={profile.contact.logoDataUrl} alt="" className="h-16 w-16 object-cover" />
 : <Building2 className="h-7 w-7" />}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex flex-wrap items-center gap-2">
 <span className="text-lg font-semibold">{profile?.contact.companyName ?? data.name}</span>
 {sectorLabel && <Badge variant="outline">{sectorLabel}</Badge>}
 {data.stage && <Badge variant="outline" className="capitalize">{data.stage}</Badge>}
 {region !== "—" && <Badge variant="outline" data-testid="badge-hero-region">Region: {region}</Badge>}
 </div>
 <div className="text-xs text-muted-foreground mt-1.5 flex items-center gap-3 flex-wrap">
 {(profile?.address.city || data.hq) && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {profile?.address.city ? `${profile.address.city}, ${profile.address.stateProvince}` : data.hq}</span>}
 {(profile?.contact.dateOfIncorporation || data.founded) && <span>Founded {profile?.contact.dateOfIncorporation?.slice(0, 4) ?? data.founded}</span>}
 {(profile?.contact.numberOfEmployees || data.employees != null) && <span>{profile?.contact.numberOfEmployees ?? `${data.employees} employees`}</span>}
 </div>
 {headliner && <p className="text-sm mt-3 leading-relaxed">{headliner}</p>}
 </div>
 </CardContent>
 </Card>

 <div className="grid lg:grid-cols-3 gap-5">
 <div className="lg:col-span-2 space-y-5">
 {/* 2. Founder bios */}
 {founders.length > 0 && (
 <SectionCard icon={Users} title="Founders">
 <div className="grid sm:grid-cols-2 gap-3">
 {founders.map(b => (
 <div key={b.name} className="border border-border rounded-md p-3 flex gap-3" data-testid={`founder-${b.name}`}>
 <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center shrink-0 overflow-hidden">
 {b.photoUrl ? <img src={b.photoUrl} alt="" className="h-12 w-12 object-cover" /> : <Users className="h-5 w-5 text-muted-foreground" />}
 </div>
 <div className="min-w-0">
 <div className="text-sm font-semibold truncate">{b.name}</div>
 <div className="text-xs text-muted-foreground">{b.role}</div>
 <p className="text-xs mt-1.5 leading-relaxed text-muted-foreground">{b.bio}</p>
 </div>
 </div>
 ))}
 </div>
 </SectionCard>
 )}

 {/* 3. Problem & solution */}
 {(problem || solution) && (
 <SectionCard icon={Target} title="Problem & solution">
 <div className="grid sm:grid-cols-2 gap-4">
 {problem && (
 <div data-testid="text-problem">
 <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Problem</div>
 <p className="text-sm leading-relaxed">{problem}</p>
 </div>
 )}
 {solution && (
 <div data-testid="text-solution">
 <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Solution</div>
 <p className="text-sm leading-relaxed">{solution}</p>
 </div>
 )}
 </div>
 </SectionCard>
 )}

 {/* 6. Strategic priorities */}
 {profile && profile.ma.strategicPriorities.length > 0 && (
 <SectionCard icon={Target} title="Strategic priorities (next 24 months)">
 <ol className="space-y-1.5" data-testid="section-strategic-priorities">
 {profile.ma.strategicPriorities.map((p, i) => (
 <li key={p} className="flex items-start gap-2 text-sm" data-testid={`priority-${p}`}>
 <span className="h-5 w-5 rounded-full bg-secondary text-foreground/70 text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
 <span>{priorityLabel(p)}</span>
 </li>
 ))}
 </ol>
 </SectionCard>
 )}

 {/* 7. Strategic intent panel */}
 {profile && (
 <SectionCard icon={Briefcase} title="Strategic intent">
 <div className="grid sm:grid-cols-3 gap-4">
 <div>
 <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Transaction interest</div>
 <div className="flex flex-wrap gap-1.5">
 {profile.ma.transactionInterests.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
 {profile.ma.transactionInterests.map(v => (
 <Badge key={v} variant="outline" className="text-[10px]" data-testid={`tx-interest-${v}`}>{txInterestLabel(v)}</Badge>
 ))}
 </div>
 </div>
 <div>
 <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Partner types sought</div>
 <div className="flex flex-wrap gap-1.5">
 {profile.ma.partnerTypesSought.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
 {profile.ma.partnerTypesSought.map(v => (
 <Badge key={v} variant="outline" className="text-[10px]" data-testid={`partner-${v}`}>{partnerLabel(v)}</Badge>
 ))}
 </div>
 </div>
 <div>
 <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Deal breakers</div>
 <div className="flex flex-wrap gap-1.5">
 {profile.ma.dealBreakers.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
 {profile.ma.dealBreakers.map(v => (
 <Badge key={v} className="text-[10px] bg-rose-500/15 text-rose-700 border border-rose-300/40" data-testid={`deal-breaker-${v}`}>{dealBreakerLabel(v)}</Badge>
 ))}
 </div>
 </div>
 </div>
 </SectionCard>
 )}

 {/* 8. Competitive landscape */}
 {profile && (profile.ma.competitor1Name || profile.ma.competitor2Name || profile.ma.competitor3Name) && (
 <SectionCard icon={Layers} title="Competitive landscape">
 <table className="w-full text-sm">
 <thead>
 <tr className="text-xs uppercase text-muted-foreground border-b border-border">
 <th className="text-left py-2 pr-2">#</th>
 <th className="text-left py-2 pr-2">Competitor</th>
 <th className="text-left py-2 pr-2">Website</th>
 <th className="text-left py-2">Differentiator</th>
 </tr>
 </thead>
 <tbody data-testid="section-competitors">
 {[
 { i: 1, n: profile.ma.competitor1Name, u: profile.ma.competitor1WebsiteUrl, d: profile.ma.competitor1Differentiator },
 { i: 2, n: profile.ma.competitor2Name, u: profile.ma.competitor2WebsiteUrl, d: profile.ma.competitor2Differentiator },
 { i: 3, n: profile.ma.competitor3Name, u: profile.ma.competitor3WebsiteUrl, d: profile.ma.competitor3Differentiator },
 ].filter(c => c.n).map(c => (
 <tr key={c.i} className="border-b border-border/60 last:border-b-0" data-testid={`competitor-${c.i}`}>
 <td className="py-2 pr-2 text-muted-foreground tabular-nums">{c.i}</td>
 <td className="py-2 pr-2 font-medium">{c.n}</td>
 <td className="py-2 pr-2 text-xs">
 {c.u ? <a href={c.u} target="_blank" rel="noreferrer" className="hover:underline text-muted-foreground inline-flex items-center gap-1">{c.u} <ExternalLink className="h-3 w-3" /></a> : <span className="text-muted-foreground">—</span>}
 </td>
 <td className="py-2 text-xs text-muted-foreground">{c.d}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </SectionCard>
 )}

 {/* 9. Customer concentration & contracts */}
 {profile && (
 <SectionCard icon={AlertTriangle} title="Customer concentration & contracts">
 <ul className="space-y-2" data-testid="section-concentration">
 <ConcentrationRow label="Revenue concentration > 30% with any single customer" yes={profile.ma.hasRevenueConcentration30Pct} />
 <ConcentrationRow label="Material exclusivity / non-compete / MFN clauses" yes={profile.ma.hasMfnExclusivity} />
 <ConcentrationRow label="Change-of-control clauses in major contracts" yes={profile.ma.hasChangeOfControlClauses} />
 </ul>
 </SectionCard>
 )}

 {/* 10. Corporate governance scorecard */}
 {profile && (
 <SectionCard icon={Shield} title="Corporate governance scorecard">
 <div className="grid sm:grid-cols-2 gap-2" data-testid="section-governance">
 <GovRow label="Formal Board of Directors" v={profile.ma.hasFormalBoard} positive />
 <GovRow label="No pending litigation" v={!profile.ma.hasPendingLitigation} positive />
 <GovRow label="Regulatory compliant" v={profile.ma.isRegulatoryCompliant} positive />
 <GovRow label="External legal counsel" v={profile.ma.hasExternalLegalCounsel} positive />
 <GovRow label="Financials independently audited" v={profile.ma.isFinanciallyAudited} positive />
 <GovRow label="SaaS / recurring model" v={profile.ma.isSaasRecurring} neutral />
 <GovRow label="Material IP holdings" v={profile.ma.holdsMaterialIp} positive />
 <GovRow label="ESG framework adopted" v={profile.ma.hasEsgFramework} positive />
 <GovRow label="DEI policy in place" v={profile.ma.hasDeiPolicy} positive />
 <GovRow label="Cybersecurity certification (SOC 2 / ISO 27001)" v={profile.ma.hasCybersecurityCertification} positive />
 {profile.ma.accountingFirmName && (
 <div className="col-span-full text-xs text-muted-foreground mt-2">Accounting firm: <span className="font-medium text-foreground">{profile.ma.accountingFirmName}</span></div>
 )}
 </div>
 </SectionCard>
 )}

 {/* 11. M&A readiness narrative */}
 {profile?.ma.maReadinessNarrative && (
 <SectionCard icon={FileText} title="M&A readiness narrative">
 <p className="text-sm leading-relaxed whitespace-pre-wrap" data-testid="text-ma-narrative">{profile.ma.maReadinessNarrative}</p>
 </SectionCard>
 )}

 {/* 12. Unique value proposition */}
 {profile?.ma.uniqueValueProposition && (
 <SectionCard icon={Target} title="Unique value proposition">
 <p className="text-sm leading-relaxed whitespace-pre-wrap" data-testid="text-uvp">{profile.ma.uniqueValueProposition}</p>
 </SectionCard>
 )}

 {/* 13. M&A intelligence panel — composite score */}
 {data.maScore && (
 <SectionCard icon={BarChart3} title="M&A intelligence — composite score">
 <div className="flex items-end gap-4 mb-3">
 <div className="text-4xl font-semibold tabular-nums" data-testid="text-ma-composite-score">{data.maScore.score}</div>
 <div className="text-xs text-muted-foreground mb-1">/ 100 · cohort benchmark</div>
 </div>
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
 {data.maScore.components.map((c) => (
 <div key={c.label} className="text-[11px] flex justify-between border border-border rounded px-2 py-1">
 <span className="text-muted-foreground">{c.label}</span>
 <span className="font-mono">{Math.min(c.weight, c.awarded).toFixed(0)} / {c.weight}</span>
 </div>
 ))}
 </div>
 </SectionCard>
 )}

 {/* 14. Press / PR */}
 {data.pressMentions && data.pressMentions.length > 0 && (
 <SectionCard icon={Newspaper} title="Press & PR">
 <ul className="space-y-2">
 {data.pressMentions.map((p, i) => (
 <li key={i} className="text-sm" data-testid={`press-${i}`}>
 <a href={p.url} target="_blank" rel="noreferrer" className="font-medium hover:underline inline-flex items-center gap-1">
 {p.title} <ExternalLink className="h-3 w-3" />
 </a>
 <div className="text-xs text-muted-foreground">{p.outlet} · {p.date}</div>
 </li>
 ))}
 </ul>
 </SectionCard>
 )}
 </div>

 {/* RIGHT col */}
 <div className="space-y-5">
 {/* 4. Legal & governance summary */}
 {profile && (
 <SectionCard icon={FileText} title="Legal & governance">
 <dl className="text-xs space-y-1.5" data-testid="section-legal">
 <KV k="Legal entity" v={profile.legal.legalEntityName || "—"} />
 <KV k="Jurisdiction" v={profile.legal.countryOfIncorporationCode || "—"} />
 <KV k="Entity type" v={profile.legal.entityType ?? "—"} />
 <KV k="Business number" v={profile.legal.businessNumber || "—"} />
 <KV k="Public exchange" v={profile.legal.isPubliclyTraded ? "Yes" : "No"} />
 <KV k="Formal board" v={profile.ma.hasFormalBoard ? "Yes" : "No"} />
 <KV k="Regulatory compliant" v={profile.ma.isRegulatoryCompliant ? "Yes" : "No"} />
 <KV k="IP holdings" v={profile.ma.holdsMaterialIp ? "Yes" : "No"} />
 <KV k="Financials audited" v={profile.ma.isFinanciallyAudited ? "Yes" : "No"} />
 {profile.ma.accountingFirmName && <KV k="Accounting firm" v={profile.ma.accountingFirmName} />}
 {engineAttribution && <KV k="Engine" v={engineAttribution} />}
 </dl>
 </SectionCard>
 )}

 {/* 5. Mailing address */}
 {(profile?.address.street || data.mailingAddress) && (
 <SectionCard icon={MapPin} title="Mailing address">
 <p className="text-sm text-muted-foreground" data-testid="text-mailing">
 {profile
 ? [profile.address.street, profile.address.unitSuite, profile.address.city, profile.address.stateProvince, profile.address.postalCode, profile.address.countryCode].filter(Boolean).join(", ")
 : data.mailingAddress}
 </p>
 </SectionCard>
 )}

 {/* 5b. Market presence */}
 {profile && (profile.ma.operatingGeographies.length > 0 || profile.ma.customerSegments.length > 0) && (
 <SectionCard icon={Globe} title="Market presence">
 {data.marketPresence && (
 <div className="text-xs space-y-1.5 mb-3">
 <KV k="TAM" v={data.marketPresence.tam} />
 <KV k="SAM" v={data.marketPresence.sam} />
 <KV k="SOM" v={data.marketPresence.som} />
 </div>
 )}
 <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-2 mb-1.5">Operating geographies</div>
 <div className="flex flex-wrap gap-1.5 mb-3">
 {profile.ma.operatingGeographies.map(v => (
 <Badge key={v} variant="outline" className="text-[10px]" data-testid={`market-geo-${v}`}>{geoLabel(v)}</Badge>
 ))}
 </div>
 <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Customer segments</div>
 <div className="flex flex-wrap gap-1.5">
 {profile.ma.customerSegments.map(v => (
 <Badge key={v} variant="outline" className="text-[10px]" data-testid={`market-segment-${v}`}>{segmentLabel(v)}</Badge>
 ))}
 </div>
 </SectionCard>
 )}

 {/* 15. Cap-table co-member visibility list */}
 <SectionCard icon={Users} title="Cap-table co-members">
 <div className="text-[11px] text-muted-foreground mb-2">
 Visible only when both you and the holder have opted in to co-member visibility (R200.gating §6).
 </div>
 <ul className="space-y-2" data-testid="section-co-members">
 {coMembers.map(m => {
 const visible = m.visibility.visibleToCoMembers && !!m.visibility.screenName;
 return (
 <li key={m.id} className="flex items-center gap-2 text-xs border border-border rounded-md px-2.5 py-2" data-testid={`co-member-${m.id}`}>
 <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
 {visible ? <Users className="h-3.5 w-3.5 text-muted-foreground" /> : <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
 </div>
 <div className="flex-1 min-w-0">
 <div className={`truncate ${visible ? "font-medium" : "italic text-muted-foreground"}`}>
 {visible ? m.visibility.screenName : "[Anonymous Holder]"}
 </div>
 {m.shares != null && <div className="font-mono text-[10px] text-muted-foreground">{m.shares.toLocaleString()} shares</div>}
 </div>
 {visible && (
 <Button
 variant="outline" size="sm" className="h-7 text-[11px]"
 disabled={!m.userId}
 onClick={async () => {
 if (!m.userId) return;
 try {
 const res = await apiRequest("POST", "/api/comms/dm/start", { targetUserId: m.userId });
 const result = await res.json();
 navigate(`/investor/messages?thread=${result.channelId}`);
 } catch {
 toast({ title: "Could not open message thread", description: "Please try again.", variant: "destructive" });
 }
 }}
 data-testid={`button-message-${m.id}`}
 >
 <MessageCircle className="h-3 w-3 mr-1" /> Send message
 </Button>
 )}
 </li>
 );
 })}
 </ul>
 </SectionCard>

 {/* 16. Round detail — gated */}
 {data.access.canSeeRound && data.rounds && data.rounds.length > 0 && (
 <SectionCard icon={Briefcase} title="Active rounds" gated>
 <ul className="space-y-2" data-testid="section-rounds">
 {data.rounds.map(r => (
 <li key={r.id} className="border border-border rounded-md p-3 text-xs">
 <div className="flex items-center justify-between gap-2 mb-1">
 <span className="font-medium">{r.name}</span>
 <Badge variant="outline" className="text-[10px] capitalize">{r.state.replace(/_/g, " ")}</Badge>
 </div>
 <div className="text-muted-foreground capitalize">{r.type.replace(/_/g, " ")}</div>
 {r.targetAmount && <div className="font-mono text-muted-foreground">target {fmtUSD(r.targetAmount, { compact: true })}</div>}
 {engineAttribution && <div className="text-[10px] text-muted-foreground mt-1.5 italic">{engineAttribution}</div>}
 </li>
 ))}
 </ul>
 </SectionCard>
 )}

 {/* 17. Dataroom — gated */}
 {data.access.canSeeDataroom && data.dataroom && (
 <SectionCard icon={FolderOpen} title="Dataroom" gated>
 <div className="text-xs text-muted-foreground mb-2" data-testid="text-dataroom-count">
 {data.dataroom.length} files across {new Set(data.dataroom.map(f => f.category)).size} categories
 </div>
 {/* Sprint 20 Wave 2 — role-based dataroom routing (defect 55) */}
 <Link href={viewerRole === "investor" ? `/investor/companies/${data.id}?tab=dataroom` : "/founder/dataroom"}>
 <Button variant="outline" size="sm" className="text-xs" data-testid="button-open-dataroom">Open dataroom</Button>
 </Link>
 </SectionCard>
 )}

 {/* 18. Soft-circle book — gated */}
 {data.access.canSeeSoftCircle && data.softCircles && (
 <SectionCard icon={BookOpen} title={viewerRole === "founder" ? "Soft-circle book" : "Your soft-circle entry"} gated>
 {data.softCircles.length === 0 ? (
 <div className="text-xs text-muted-foreground" data-testid="text-no-softcircle">No soft-circle entry on this round.</div>
 ) : (
 <ul className="space-y-1.5 text-xs" data-testid="section-soft-circles">
 {data.softCircles.map(s => (
 <li key={s.id} className="flex justify-between items-center gap-3">
 <span className="truncate">{s.investorName}</span>
 <span className="font-mono">{fmtUSD(s.amount, { compact: true })}</span>
 <Badge variant="outline" className="text-[10px] capitalize shrink-0">{s.status}</Badge>
 </li>
 ))}
 </ul>
 )}
 </SectionCard>
 )}

 {/* 19. Term sheet — gated */}
 {data.access.canSeeTermSheet && data.termSheet && (
 <SectionCard icon={FileSignature} title="Term sheet" gated>
 <div className="text-xs text-muted-foreground mb-2" data-testid="text-termsheet-info">Available · last updated {data.termSheet.lastUpdated}</div>
 {engineAttribution && <div className="text-[10px] text-muted-foreground mb-2 italic">Generated using {engineAttribution.replace("Computed by ", "")} template.</div>}
 {/* Sprint 20 Wave 2 — role-based termsheet routing (defect 56) */}
 <Link href={viewerRole === "investor"
 ? `/investor/companies/${data.id}?tab=your-decision`
 : (data.rounds && data.rounds[0] ? `/founder/rounds/${data.rounds[0].id}/termsheet` : "#")
 }>
 <Button variant="outline" size="sm" className="text-xs" data-testid="button-open-termsheet">Open term sheet</Button>
 </Link>
 </SectionCard>
 )}

 {!data.access.canSeeRound && !data.access.canSeeDataroom && !data.access.canSeeTermSheet && (
 <Card className="border-dashed" data-testid="section-no-gated">
 <CardContent className="p-4 text-xs text-muted-foreground flex items-start gap-2">
 <Shield className="h-4 w-4 shrink-0 mt-0.5" />
 <span>Round details, dataroom, and term sheet appear here once you&apos;re invited to a round on this company.</span>
 </CardContent>
 </Card>
 )}

 {/* Sprint 9 — Cap-Table + Soft-Circle channel access cards. */}
 <CapTableChannelCard companyId={data.id} basePath={viewerRole === "founder" ? "/founder/messages" : "/investor/messages"} />
 {(data.rounds ?? []).map((r: { id: string; name: string }) => (
 <SoftCircleChannelCard key={r.id} roundId={r.id} roundName={r.name} basePath={viewerRole === "founder" ? "/founder/messages" : "/investor/messages"} />
 ))}
 </div>
 </div>
 </PageBody>
 </>
 );
}

function SectionCard({
 icon: Icon, title, children, gated,
}: { icon: typeof Briefcase; title: string; children: React.ReactNode; gated?: boolean }) {
 return (
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2">
 <Icon className="h-4 w-4 text-muted-foreground" />
 {title}
 {gated && <Badge variant="outline" className="text-[9px] uppercase tracking-wider ml-auto">Gated</Badge>}
 </CardTitle>
 </CardHeader>
 <CardContent>{children}</CardContent>
 </Card>
 );
}

function KV({ k, v }: { k: string; v: string }) {
 return (
 <div className="flex justify-between gap-3">
 <dt className="text-muted-foreground">{k}</dt>
 <dd className="font-medium text-right truncate">{v}</dd>
 </div>
 );
}

function ConcentrationRow({ label, yes }: { label: string; yes: boolean }) {
 return (
 <li className="flex items-center justify-between gap-3 text-sm">
 <span className="text-muted-foreground">{label}</span>
 {yes
 ? <Badge className="bg-rose-500/15 text-rose-700 border border-rose-300/40">Yes</Badge>
 : <Badge variant="outline">No</Badge>}
 </li>
 );
}

function GovRow({ label, v, positive, neutral }: { label: string; v: boolean; positive?: boolean; neutral?: boolean }) {
 const good = neutral ? false : (positive ? v : !v);
 return (
 <div className="flex items-center gap-2 text-xs">
 <div className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${
 neutral ? "bg-secondary text-muted-foreground"
 : good ? "bg-emerald-500/15 text-emerald-700 "
 : "bg-rose-500/15 text-rose-700 "
 }`}>
 {neutral ? null : good ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
 </div>
 <span className="truncate">{label}</span>
 <span className={`ml-auto text-[10px] ${neutral ? "text-muted-foreground" : "font-medium"}`}>
 {v ? "Yes" : "No"}
 </span>
 </div>
 );
}
