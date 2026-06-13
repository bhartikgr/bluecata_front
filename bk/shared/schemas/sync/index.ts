/**
 * Sprint 13 — Sync schemas registry.
 *
 * 24 entity canonical schemas with toCollectivePayload, fromCollectivePayload,
 * mergeWithConflicts, applyVisibilityFilter exports each. Re-exported here
 * so callers can `import { Registry } from "@shared/schemas/sync"`.
 */
export * from "./_common";

import * as Company from "./company";
import * as Investor from "./investor";
import * as CapTablePosition from "./capTablePosition";
import * as SoftCircle from "./softCircle";
import * as Round from "./round";
import * as MaIntelligence from "./maIntelligence";
import * as EligibilitySnapshot from "./eligibilitySnapshot";
import * as LifecyclePolicy from "./lifecyclePolicy";
import * as AuditEntry from "./auditEntry";
import * as KycRecord from "./kycRecord";
import * as Accreditation from "./accreditation";
import * as MemberTier from "./memberTier";
import * as ConsortiumPartner from "./consortiumPartner";
import * as TermSheet from "./termSheet";
import * as DataroomPermission from "./dataroomPermission";
import * as DataroomFileMeta from "./dataroomFileMeta";
import * as NotificationPrefs from "./notificationPrefs";
import * as PricingTier from "./pricingTier";
import * as CommsThread from "./commsThread";
import * as PcrmContact from "./pcrmContact";
import * as Post from "./post";
import * as Report from "./report";
import * as SpvScore from "./spvScore";
import * as SocialSignal from "./socialSignal";

export type EntityKey =
  | "company" | "investor" | "capTablePosition" | "softCircle" | "round"
  | "maIntelligence" | "eligibilitySnapshot" | "lifecyclePolicy" | "auditEntry"
  | "kycRecord" | "accreditation" | "memberTier" | "consortiumPartner"
  | "termSheet" | "dataroomPermission" | "dataroomFileMeta" | "notificationPrefs"
  | "pricingTier" | "commsThread" | "pcrmContact" | "post" | "report"
  | "spvScore" | "socialSignal";

export const ALL_ENTITY_KEYS: EntityKey[] = [
  "company", "investor", "capTablePosition", "softCircle", "round",
  "maIntelligence", "eligibilitySnapshot", "lifecyclePolicy", "auditEntry",
  "kycRecord", "accreditation", "memberTier", "consortiumPartner",
  "termSheet", "dataroomPermission", "dataroomFileMeta", "notificationPrefs",
  "pricingTier", "commsThread", "pcrmContact", "post", "report",
  "spvScore", "socialSignal",
];

export const Registry = {
  company: Company,
  investor: Investor,
  capTablePosition: CapTablePosition,
  softCircle: SoftCircle,
  round: Round,
  maIntelligence: MaIntelligence,
  eligibilitySnapshot: EligibilitySnapshot,
  lifecyclePolicy: LifecyclePolicy,
  auditEntry: AuditEntry,
  kycRecord: KycRecord,
  accreditation: Accreditation,
  memberTier: MemberTier,
  consortiumPartner: ConsortiumPartner,
  termSheet: TermSheet,
  dataroomPermission: DataroomPermission,
  dataroomFileMeta: DataroomFileMeta,
  notificationPrefs: NotificationPrefs,
  pricingTier: PricingTier,
  commsThread: CommsThread,
  pcrmContact: PcrmContact,
  post: Post,
  report: Report,
  spvScore: SpvScore,
  socialSignal: SocialSignal,
} as const;

/** Sample/seed canonical document per entity — used for round-trip tests + drift detector. */
export function buildSample(key: EntityKey): Record<string, unknown> {
  const now = new Date().toISOString();
  switch (key) {
    case "company": return {
      id: "co_novapay", legalName: "NovaPay Inc", entityType: "Corporation",
      jurisdiction: "US/DE", primaryEmail: "ops@novapay.test", stage: "seed_extension",
      preMoneyValuation: "12000000", postMoneyValuation: "16000000",
      compositeScore: 82, autoTier: "A", visibleToCollective: true, updatedAt: now,
    };
    case "investor": return {
      id: "u_aisha_patel", firstName: "Aisha", lastName: "Patel", screenName: "aisha.p",
      email: "aisha@example.test", investorType: "individual",
      accreditationStatus: "verified", kycStatus: "verified",
      visibleToCoMembers: true, eligibilityScore: 78, updatedAt: now,
    };
    case "capTablePosition": return {
      id: "pos_001", companyId: "co_novapay", holderUserId: "u_aisha_patel",
      holderName: "Aisha Patel", instrumentType: "preferred", shares: "32000",
      pricePerShare: "12.50", ownershipPct: 1.8, visibleToCoMembers: true, updatedAt: now,
    };
    case "softCircle": return {
      id: "sc_001", roundId: "rnd_novapay_seed", companyId: "co_novapay",
      investorId: "u_aisha_patel", amountUsd: "250000", status: "recorded",
      recordedAt: now, visibility: "founder_only", updatedAt: now,
    };
    case "round": return {
      id: "rnd_novapay_seed", companyId: "co_novapay", name: "Seed Extension",
      region: "US", instrumentType: "safe_postmoney", status: "signing_open",
      targetUsd: "4000000", preMoneyUsd: "12000000", updatedAt: now,
    };
    case "maIntelligence": return {
      companyId: "co_novapay", compositeScore: 82, mnaScore: 76, roundScore: 88,
      sectorBenchmark: 71, autoTier: "A", rankInSector: 12, totalInSector: 318,
      computedAt: now, modelVersion: "ma-v3.1",
    };
    case "eligibilitySnapshot": return {
      userId: "u_aisha_patel", eligibilityScore: 78,
      flags: { investorOnCapTable: true, founderOfCompany: false, signatoryOnCompany: false, vouchedByPartner: true },
      reasons: ["on_cap_table", "vouched"], computedAt: now, policyVersion: "lp-2026-05-09",
    };
    case "lifecyclePolicy": return {
      policyVersion: "lp-2026-05-09", founderTenureDays: 180, archiveRetentionDays: 3650,
      nonPaymentGraceDays: 30, invitationExpiryDays: 14, softCircleTtlDays: 60,
      effectiveAt: now, publishedBy: "u_admin",
    };
    case "auditEntry": return {
      id: "al_001", ts: now, actorUserId: "u_admin", action: "company.profile.updated",
      aggregateKind: "company", aggregateId: "co_novapay",
      changedFields: ["legalName"], priorHash: "0000", hash: "abcd",
    };
    case "kycRecord": return {
      userId: "u_aisha_patel", kycVariant: "us_individual", kycStatus: "verified",
      kycVerifiedAt: now, kycProvider: "stub", jurisdiction: "US", riskScore: 12, updatedAt: now,
    };
    case "accreditation": return {
      userId: "u_aisha_patel", status: "verified", method: "third_party",
      verifiedAt: now, jurisdiction: "US",
    };
    case "memberTier": return {
      userId: "u_aisha_patel", memberTier: "standard", applicationStatus: "approved",
      applicationId: "app_001", decisionAt: now, membershipStartDate: now,
      lapsed: false, renewalStatus: "active", amountPaidUsd: "1200", updatedAt: now,
    };
    case "consortiumPartner": return {
      id: "p_y_combinator", name: "Y Combinator", partnerType: "accelerator",
      websiteUrl: "https://ycombinator.test", vouchWeight: 1, active: true,
      introCount: 14, successCount: 5, updatedAt: now,
    };
    case "termSheet": return {
      id: "ts_001", roundId: "rnd_novapay_seed", companyId: "co_novapay",
      templateId: "yc_safe_postmoney", region: "US", status: "signed",
      documentHash: "deadbeef", signedAt: now, updatedAt: now,
    };
    case "dataroomPermission": return {
      id: "dp_001", companyId: "co_novapay", folderId: "fdr_financials",
      granteeUserId: "u_aisha_patel", permission: "view", grantedAt: now, grantedBy: "u_founder",
    };
    case "dataroomFileMeta": return {
      id: "f_001", companyId: "co_novapay", folderId: "fdr_financials",
      fileName: "model_v3.xlsx", mimeType: "application/vnd.ms-excel",
      sizeBytes: 184220, sha256: "cafebabe", uploadedAt: now, uploadedBy: "u_founder", version: 3,
    };
    case "notificationPrefs": return {
      userId: "u_aisha_patel", emailEnabled: true, pushEnabled: false,
      digestFrequency: "daily", channels: { round_invitations: true, soft_circle: true }, updatedAt: now,
    };
    case "pricingTier": return {
      id: "tier_collective_standard", surface: "collective", tierName: "Standard",
      region: "US", usdAnnual: 1200, active: true, effectiveAt: now,
    };
    case "commsThread": return {
      id: "th_001", channelId: "ch_softcircle_001", channelType: "soft_circle",
      participants: ["u_founder", "u_aisha_patel"], visibility: "private",
      lastMessageAt: now, messageCount: 3, updatedAt: now,
    };
    case "pcrmContact": return {
      id: "pcrm_001", ownerUserId: "u_aisha_patel", name: "Founder Bob",
      organization: "Acme", role: "CEO", stage: "diligence", updatedAt: now,
    };
    case "post": return {
      id: "post_001", authorUserId: "u_founder", companyId: "co_novapay",
      body: "Closed seed extension", visibility: "co_members",
      reactionCount: 12, commentCount: 3, pinned: false, createdAt: now, updatedAt: now,
    };
    case "report": return {
      id: "rep_001", companyId: "co_novapay", title: "Q2 Investor Letter",
      period: "2026-Q2", publishedAt: now, recipients: ["u_aisha_patel"], readBy: [],
      attachmentCount: 1, documentHash: "feedface", updatedAt: now,
    };
    case "spvScore": return {
      companyId: "co_novapay", dscScore: 4.2, dscRecommendation: "advance",
      reviewerIds: ["u_r1", "u_r2"], reviewSessionId: "sess_001", decidedAt: now, modelVersion: "dsc-1.4",
    };
    case "socialSignal": return {
      subjectId: "co_novapay", subjectKind: "company", followerCount: 12400,
      mentionCount: 81, networkActivity: "trending", followGraph: ["u_a","u_b"], computedAt: now,
    };
  }
}
