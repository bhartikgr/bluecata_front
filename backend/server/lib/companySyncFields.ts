/**
 * Sprint 14 D5 — Company sync allow-list (Conflict 4 fix).
 *
 * Per `capavate_collective_sync_field_map.md`, only an explicit allow-list of
 * fields may cross the bridge for company.profile.updated. The 112-field
 * partition is enumerated here. Any field not in the set is stripped before
 * outbound emit so PII / business-secret fields cannot leak.
 *
 * Sprint 14 NEW fields: lastRoundDate, lastRoundType, lastRoundValuation,
 * roundSize, instrument, terms (from §4 of the round-porting spec).
 */
export const COMPANY_SYNC_FIELDS: ReadonlySet<string> = new Set<string>([
  // -- Identity (5)
  "id", "screenName", "legalName", "tenantId", "schemaVersion",
  // -- Business basics (12)
  "sector", "subsector", "stage", "headquartersRegion", "foundedYear",
  "employeeCount", "websiteUrl", "logoUrl", "tagline", "shortPitch",
  "longPitch", "missionStatement",
  // -- Financials (15)
  "lastRevenueUsd", "lastRevenueAsOf", "arr", "mrr", "burnRateUsd",
  "runwayMonths", "grossMarginPct", "netMarginPct", "ltvCacRatio",
  "paybackPeriodMonths", "ebitdaUsd", "operatingCashFlowUsd",
  "freeCashFlowUsd", "capExUsd", "rdSpendPctRevenue",
  // -- Cap-table aggregates (10)
  "totalSharesOutstanding", "fullyDilutedShares", "esopPoolPct",
  "esopAvailablePct", "lastValuationUsd", "lastValuationAsOf",
  "outstandingSafesUsd", "outstandingNotesUsd", "preferredOutstandingUsd",
  "commonOutstandingUsd",
  // -- Round-specific (Sprint 14 NEW per §4 round porting spec) (6)
  "lastRoundDate", "lastRoundType", "lastRoundValuation",
  "roundSize", "instrument", "terms",
  // -- M&A intelligence (12) — passes raw scores only to DSC member roles;
  // the inbound bridgeInbound applies role-gating on read.
  "maStatus", "autoTier", "ipDdReadinessPct", "customerContractsReadinessPct",
  "financialAuditReadinessPct", "boardSeatPreferenceCount",
  "acquirerProfileSector", "acquirerProfileRegion",
  "regulatoryFilingsComplete", "dataRoomOrganized", "esgDisclosureComplete",
  "transactionPrepStatus",
  // -- Governance (8)
  "boardCompositionDirectors", "boardCompositionIndependent",
  "boardCompositionInvestorAppointed", "shareholderConsentsComplete",
  "rofrWaiversComplete", "vendorContractsCount", "leaseAssignmentsCount",
  "insuranceReviewComplete",
  // -- KYC / AML (5)
  "kycStatus", "kycLastVerifiedAt", "amlScreeningPassed",
  "antiBriberyPolicyOnFile", "regulatoryFilingJurisdiction",
  // -- Region / jurisdiction (4)
  "primaryJurisdiction", "secondaryJurisdiction", "incorporationJurisdiction",
  "taxResidencyJurisdiction",
  // -- Public / social (8)
  "linkedinUrl", "twitterUrl", "crunchbaseUrl", "pitchbookUrl",
  "openingDataRoomUrl", "publicNewsroomUrl", "founderLinkedinUrls",
  "investorLinkedinUrls",
  // -- Collective integration (8)
  "collectiveMembershipStatus", "collectiveMembershipTier",
  "collectiveMembershipExpiresAt", "collectiveAppliedAt",
  "collectiveOnboardingComplete", "collectiveDscReviewedAt",
  "collectiveAutoTier", "collectiveShortlistCount",
  // -- Activity timestamps (8)
  "createdAt", "updatedAt", "lastActiveAt", "lastEditedBy",
  "lastInvestorContactAt", "lastFounderUpdateAt",
  "lastInvestorMessageAt", "lastFounderMessageAt",
  // -- Telemetry counters (5)
  "totalInvestorViews", "totalInvestorMessages",
  "totalCapTableMutations", "totalRoundsCreated", "totalCommitsRecorded",
  // -- Display / preferences (6)
  "preferredCurrency", "preferredTimezone", "preferredLanguage",
  "preferredCommunicationChannel", "preferredMeetingDuration",
  "preferredMeetingTimes",
]);

/** Keys explicitly NOT eligible (PII, internal scoring): used in tests + visibility filters. */
export const COMPANY_SYNC_BLOCKLIST: ReadonlySet<string> = new Set<string>([
  "founderEmail", "founderPhone", "founderHomeAddress", "founderSsn",
  "internalScoringMatrix", "internalAdminNotes", "rawDscMemberVotes",
]);

/**
 * Filter a payload to ONLY allowed fields. Returns a new object — never
 * mutates input. Logs (via callback) any stripped keys for telemetry.
 */
export function filterCompanyPayload<T extends Record<string, unknown>>(
  payload: T,
  onStrip?: (stripped: string[]) => void,
): Partial<T> {
  const out: Partial<T> = {};
  const stripped: string[] = [];
  for (const k of Object.keys(payload)) {
    if (COMPANY_SYNC_FIELDS.has(k)) {
      (out as Record<string, unknown>)[k] = payload[k];
    } else {
      stripped.push(k);
    }
  }
  if (stripped.length && onStrip) onStrip(stripped);
  return out;
}
