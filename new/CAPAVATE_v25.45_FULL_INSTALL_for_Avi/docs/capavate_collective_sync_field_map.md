# Capavate ↔ Collective Sync Field Map — Sprint 13 Source of Truth

**Version:** 1.0  
**Date:** 2026-05-09  
**Owner:** Capavate platform engineering  
**Status:** Binding — Sprint 13 bridge implementation reference  
**Sources:** `capavate_collective_sync_schema.md` §9 (envelope), `collective_admin_audit.md`, `collective_investor_audit.md`, `collective_founder_audit.md`, `collective_communications_audit.md`, `capavate_founder_deep_audit.md`, `capavate_investor_deep_audit.md`, `capavate_gating_addendum.md`, `SPRINT-12-PROGRESS.md`, `SPRINT-12-ADMIN-SUMMARY.md`, `server/bridgeStore.ts`

---

## Architecture recap

```
Capavate write tx ─┐
                   ├──> Postgres outbox table ──> webhook relay ──> Collective inbox
trace + audit hash ┘                                                     │
                                                         Collective state machine
                                                         + Collective audit log
```

**Canonical envelope shape (§9 binding):**

```json
{
  "eventId": "evt_01HV8E3K4XR7YXZ8X5G",
  "eventType": "<type>",
  "aggregateId": "<id>",
  "aggregateKind": "company|investor|round|platform",
  "occurredAt": "2026-05-09T00:00:00Z",
  "tenantId": "tnt_capavate_us",
  "actor": { "userId": "u_xxx", "ip": "0.0.0.0" },
  "payload": {},
  "trace": [{ "formulaId": "…", "version": "…", "region": "…", "defHash": "…" }],
  "auditChain": { "priorHash": "…", "hash": "…" },
  "schemaVersion": "1.0"
}
```

Wire format: HMAC-SHA256 signed JSON over HTTPS POST · `Idempotency-Key: eventId` · Collective 2xx ACK or 409 (already received) · Exponential backoff (1 s → 2 → 4 → 8 → 16, max 5 attempts) → dead-letter → `/admin/audit-log`.

---

## Trigger event catalogue

| Event | Direction | Cadence |
|---|---|---|
| `company.profile.updated` | Capavate → Collective | Real-time on mutation |
| `company.ma_intelligence.updated` | Capavate → Collective | Real-time on mutation |
| `investor.profile.updated` | Capavate → Collective | Real-time on mutation |
| `cap_table.mutated` | Capavate → Collective | Real-time on mutation |
| `eligibility.recomputed` | Capavate → Collective | Real-time on cap-table or policy change |
| `lifecycle_policy.changed` | Capavate → Collective | On admin save |
| `formula.published` | Capavate → Collective | On admin promotion |
| `audit_log.appended` | Capavate → Collective | Real-time on each log write |
| `safe.converted` | Capavate → Collective | On conversion event |
| `note.converted` | Capavate → Collective | On conversion event |
| `round.closed` | Capavate → Collective | On state transition `signing_open → closed` |
| `governance_metric.published` | Capavate → Collective | On founder publish |
| `dsc.scores` | Collective → Capavate | On DSC review completion |
| `ma.intelligence_rankings` | Collective → Capavate | Nightly batch |
| `partner.introduction_status` | Collective → Capavate | On status change |
| `network.social_signals` | Collective → Capavate | Real-time |
| Communications (messages, posts, reactions, follows) | Bidirectional | Real-time |

---

## Privacy / visibility resolver (Sprint 9 rules — binding)

Every sync payload is filtered by the **visibility resolver** before leaving the outbox:

| Rule ID | Rule | Fields affected |
|---|---|---|
| VIS-1 | PII fields never leave Capavate | `primaryEmail`, `primaryPhone`, `registrationId`/EIN, `operatingAddresses`, `taxIdNationalId`, `kycDocumentHashes` |
| VIS-2 | Investor real name shown to cap-table portfolio company only | `firstName`, `lastName` — replaced with `screenName` in all Collective social surfaces |
| VIS-3 | `visible_to_co_members=false` → investor excluded from co-member directory | `screenName` omitted from cap-table shareholder lists |
| VIS-4 | DSC scores visible to DSC committee + admin only | `compositeScore`, `mnaScore`, `roundScore` — non-DSC members see `autoTier` label only |
| VIS-5 | Per-holder ledger entries never replicated | `capTable.ledger[]`, `capTable.trace[]` — aggregates only |
| VIS-6 | Dataroom file bytes never replicated | File bytes stay in object store; only metadata syncs |
| VIS-7 | Soft-circle amounts are founder-private | `softCircle.amount` — aggregate totals only in Collective MIM panel |
| VIS-8 | `burnRate` (exact) never shared | Derived `runwayMonths` shared instead |
| VIS-9 | `boardObservers`, `debtFacilities`, `activeInvestors.commitments`, `customerNames` private | Collective sees names only for `activeInvestors`, no commitment amounts |
| VIS-10 | Cap-table connection visibility requires both-party opt-in | `visible_to_co_members` toggle on both users |

---

## Entity 1 — Company Profile

**Trigger events:** `company.profile.updated`, `company.ma_intelligence.updated`  
**Direction:** Outbound (Capavate → Collective)  
**Sync cadence:** Real-time on any field mutation  
**Aggregate kind:** `company`

### 1.1 Canonical schema

| # | Field | Type | Req | Validation | Privacy rule |
|---|---|---|---|---|---|
| 1 | `legalName` | string | ✓ | non-empty, max 200 | — |
| 2 | `dbaTrade` | string | — | max 200 | — |
| 3 | `entityType` | enum | ✓ | Corporation\|LLC\|Pvt Ltd\|Partnership\|Other | — |
| 4 | `jurisdiction` | string | ✓ | ISO country + region | Drives formula resolution |
| 5 | `incorporationDate` | date (ISO 8601) | ✓ | past date | — |
| 6 | `registrationId` | string | — | EIN / BN | VIS-1: Capavate-private |
| 7 | `fiscalYearEnd` | string | — | MM-DD | — |
| 8 | `headquartersCity` | string | — | — | Only city+country to Collective (VIS-1) |
| 9 | `headquartersCountry` | string | — | ISO alpha-2 | — |
| 10 | `operatingAddresses` | string[] | — | — | VIS-1: Capavate-private |
| 11 | `website` | string(url) | ✓ | https URL | — |
| 12 | `primaryEmail` | string(email) | ✓ | — | VIS-1: Capavate-private |
| 13 | `primaryPhone` | string | — | E.164 | VIS-1: Capavate-private |
| 14 | `industry` | string | ✓ | 50-option enum | — |
| 15 | `sector` | string | — | freeform label | — |
| 16 | `stage` | enum | ✓ | Pre-Seed\|Seed\|Series A\|Series B\|Series C+\|Growth\|Late | — |
| 17 | `modelDescription` | string | — | max 400 | — |
| 18 | `foundedYear` | int | — | 1900–current | — |
| 19 | `employeeCount` | enum | — | 1-10\|11-50\|51-200\|201-500\|501-1000\|1000+ | — |
| 20 | `arr` | decimal(18,2) | — | ≥ 0 | — |
| 21 | `revenue` | decimal(18,2) | — | ≥ 0 | — |
| 22 | `grossMargin` | decimal(5,2) | — | 0–100 % | — |
| 23 | `burnRate` | decimal(18,2) | — | ≥ 0 | VIS-8: Capavate-private |
| 24 | `runwayMonths` | int | — | 0–999 | Derived: burnRate / cashBalance |
| 25 | `keyMetrics` | jsonb | — | max 5 KPIs | — |
| 26 | `totalRaisedToDate` | decimal(18,2) | — | ≥ 0 | — |
| 27 | `lastRoundDate` | date | — | past date | — |
| 28 | `lastRoundType` | enum | — | SAFE\|Note\|Seed\|Series A\|…\|IPO | — |
| 29 | `lastValuation` | decimal(18,2) | — | ≥ 0 | — |
| 30 | `esopSizePercent` | decimal(5,2) | — | 0–100 | — |
| 31 | `activeInvestorNames` | string[] | — | screen names | VIS-9: names only, no commitments |
| 32 | `activeInvestorCommitments` | decimal[] | — | — | VIS-9: Capavate-private |
| 33 | `debtFacilities` | jsonb | — | — | VIS-9: Capavate-private |
| 34 | `customerNames` | string[] | — | — | VIS-9: Capavate-private |
| 35 | `customerConcentrationPercent` | decimal(5,2) | — | 0–100 | — |
| 36 | `boardSeats` | int | — | ≥ 0 | — |
| 37 | `boardObservers` | int | — | ≥ 0 | VIS-9: Capavate-private |
| 38 | `optionPoolUtilizationPercent` | decimal(5,2) | — | 0–100 | — |
| 39 | `safeOutstanding` | decimal(18,2) | — | ≥ 0 | — |
| 40 | `noteOutstanding` | decimal(18,2) | — | ≥ 0 | — |
| 41 | `oneSentenceHeadliner` | string | — | max 400 chars | — |
| 42 | `problemStatement` | string | — | max 600 chars | — |
| 43 | `solutionStatement` | string | — | max 600 chars | — |
| 44 | `brandColor` | string | — | hex #rrggbb | Drives deal card header color |

### 1.2 Capavate field paths

| Field | Capavate path |
|---|---|
| legalName | `companyProfileStore.profiles[id].step3.legalEntityName` |
| dbaTrade | `companyProfileStore.profiles[id].step1.companyName` |
| entityType | `companyProfileStore.profiles[id].step3.typeOfEntity` |
| jurisdiction | `companyProfileStore.profiles[id].step3.countryOfIncorporation` |
| incorporationDate | `companyProfileStore.profiles[id].step1.dateOfIncorporation` |
| registrationId | `companyProfileStore.profiles[id].step3.businessNumber` |
| fiscalYearEnd | `companyProfileStore.profiles[id].step3.fiscalYearEnd` |
| headquartersCity | `companyProfileStore.profiles[id].step2.city` |
| headquartersCountry | `companyProfileStore.profiles[id].step2.country` |
| operatingAddresses | `companyProfileStore.profiles[id].step2.*` (full address) |
| website | `companyProfileStore.profiles[id].step1.companyWebsiteUrl` |
| primaryEmail | `companyProfileStore.profiles[id].step1.companyEmail` |
| primaryPhone | `companyProfileStore.profiles[id].step1.phoneNumber` |
| industry | `companyProfileStore.profiles[id].step1.industry` |
| stage | `companyProfileStore.profiles[id].step2.stage` |
| modelDescription | `companyProfileStore.profiles[id].step1.oneSentenceHeadliner` |
| employeeCount | `companyProfileStore.profiles[id].step1.numberOfEmployees` |
| arr | `companyProfileStore.profiles[id].step2.arr` |
| burnRate | `companyProfileStore.profiles[id].step2.burnRate` |
| runwayMonths | `companyProfileStore.profiles[id].step2.runwayMonths` (computed) |
| oneSentenceHeadliner | `companyProfileStore.profiles[id].step1.oneSentenceHeadliner` |
| problemStatement | `companyProfileStore.profiles[id].step1.problemStatement` |
| solutionStatement | `companyProfileStore.profiles[id].step1.solutionStatement` |

### 1.3 Collective field paths

| Field | Collective path |
|---|---|
| legalName | `CollectiveDeal.legal_entity_name` |
| entityType | `CollectiveDeal.entity_type` |
| jurisdiction | `CollectiveDeal.jurisdiction` |
| industry | `CollectiveDeal.industry` |
| stage | `CollectiveDeal.stage` |
| arr | `CollectiveDeal.arr` |
| runwayMonths | `CollectiveDeal.runway_months` |
| oneSentenceHeadliner | `CollectiveDeal.tagline` |
| problemStatement | `CollectiveDeal.problem` |
| solutionStatement | `CollectiveDeal.solution` |
| brandColor | `CollectiveDeal.brand_color` |
| autoTier | `CollectiveDeal.auto_tier` (computed by Collective algorithms) |

### 1.4 Source of truth

| Field | SOT | Rationale |
|---|---|---|
| All profile fields | **Capavate-wins** | Founder edits only on Capavate; Collective is read-only projection |
| `autoTier`, `compositeScore`, `mnaScore`, `roundScore` | **Collective-wins** | Computed by Collective AlgorithmsProvider; inbound via `ma.intelligence_rankings` |
| `deal_stage_override` | **Collective-wins** | Admin-only manual override lives in Collective |

### 1.5 Transformation rules

| Field | Transformation |
|---|---|
| `entityType` | Live free-text → canonical enum: map "Corporation" → `corporation`, "Pvt Ltd" → `pvt_ltd`, etc. |
| `incorporationDate` | DD-Month-YYYY (live Capavate display) → ISO 8601 `YYYY-MM-DD` in envelope |
| `industry` | 50-option enum; pass through as-is (Collective displays verbatim) |
| `employeeCount` | "11-50 employees" → `"11-50"` (strip " employees" suffix) |
| `headquartersAddress` | Send only `city` + `country`; strip street, postal code, unit (VIS-1) |
| `burnRate` → `runwayMonths` | `floor(cashBalance / burnRate)` in Capavate; send only `runwayMonths` |
| `activeInvestorNames` | Map investor `userId` → `screenName` (VIS-2); never send real name |
| camelCase ↔ snake_case | Envelope payload uses camelCase; Collective DB stores snake_case; adapter on Collective ingest |

### 1.6 Conflict examples + resolution

| Scenario | Conflict | Resolution |
|---|---|---|
| Founder updates `sector` in Capavate; Collective has cached `sector` for 24h | Stale Collective value | `company.profile.updated` event immediately invalidates Collective cache; **Capavate-wins** |
| Admin sets `deal_stage_override = "Priority"` in Collective; simultaneously `eligibility.recomputed` resets tier to "Qualified" | Two competing tier values | `deal_stage_override` is a separate column from `auto_tier`; override always surfaces over `auto_tier` in display; no true conflict |

---

## Entity 2 — Investor Profile

**Trigger events:** `investor.profile.updated`, `eligibility.recomputed`  
**Direction:** Outbound (Capavate → Collective)  
**Sync cadence:** Real-time on mutation  
**Aggregate kind:** `investor`

### 2.1 Canonical schema

| # | Field | Type | Req | Validation | Privacy rule |
|---|---|---|---|---|---|
| 1 | `investorId` | string (CUID2) | ✓ | — | — |
| 2 | `screenName` | string | — | max 100 | Public pseudonym everywhere in Collective |
| 3 | `firstName` | string | ✓ | — | VIS-2: shown to cap-table company only |
| 4 | `lastName` | string | ✓ | — | VIS-2 |
| 5 | `contactEmail` | string(email) | ✓ (system) | — | VIS-1: Capavate-private |
| 6 | `contactMobile` | string | — | E.164 | VIS-1: Capavate-private |
| 7 | `profilePicture` | string(url) | — | — | — |
| 8 | `firmName` | string | — | max 200 | — |
| 9 | `investorType` | enum | — | 19-option enum | — |
| 10 | `jurisdiction` | string | — | ISO country | — |
| 11 | `accreditedStatus` | enum | ✓ | verified\|self-cert\|pending\|rejected | — |
| 12 | `verifiedFlag` | bool | — | — | — |
| 13 | `website` | string(url) | — | — | — |
| 14 | `linkedInProfile` | string(url) | — | — | — |
| 15 | `networkBio` | string | — | max 500 chars | — |
| 16 | `sectorsOfInterest` | string[] | — | 45-option enum[] | — |
| 17 | `stagesOfInterest` | enum[] | — | Pre-Seed\|Seed\|Series A\|… | — |
| 18 | `checkSizeMin` | decimal(18,2) | — | ≥ 5000 USD | — |
| 19 | `checkSizeMax` | decimal(18,2) | — | ≥ checkSizeMin | — |
| 20 | `geographyFocus` | enum[] | — | Home Market Only\|Home Country\|Open to Global\|Cross-Border | — |
| 21 | `handsonPreference` | enum[] | — | Mentoring\|Board Roles\|Intros/Deal Flow\|Portfolio Support\|Passive | — |
| 22 | `maInterests` | enum[] | — | M&A Advisory\|Buyouts\|… | — |
| 23 | `investmentInterests` | enum[] | — | Full Sale Exits\|Recapitalizations\|… | — |
| 24 | `investmentInterestDescriptions` | map<enum,string> | — | max 500 chars each | — |
| 25 | `activePortfolioCount` | int | — | ≥ 0 | Collective-shared aggregate |
| 26 | `exitedCount` | int | — | ≥ 0 | — |
| 27 | `medianMultipleOfMoney` | decimal(6,2) | — | ≥ 0 | — |
| 28 | `irrPercent` | decimal(6,2) | — | — | Aggregate only |
| 29 | `topMarkupCompanies` | string[] | — | — | VIS-5: private |
| 30 | `portfolioCompanyHoldings` | jsonb[] | — | — | VIS-5: private |
| 31 | `countryOfTaxResidency` | string | — | ISO alpha-2 | VIS-1: Capavate-private |
| 32 | `taxIdNationalId` | string | — | — | VIS-1: Capavate-private |
| 33 | `kycDocuments` | url[] | — | — | VIS-1: Capavate-private |
| 34 | `angelProfileVisibility` | bool | — | — | Controls Collective network discoverability |
| 35 | `visibleToCoMembers` | bool | — | — | VIS-10 |
| 36 | `visibleToCollectiveNetwork` | bool | — | — | VIS-10 |
| 37 | `screenNameSet` | bool | — | — | VIS-10 |
| 38 | `investThroughCompany` | bool | — | — | — |
| 39 | `currentCompanyName` | string | — | max 200 | — |
| 40 | `currentJobTitle` | string | — | max 200 | — |
| 41 | `companyWebsite` | string(url) | — | — | — |

### 2.2 Capavate field paths

| Field | Capavate path |
|---|---|
| screenName | `investorProfileStore.profiles[id].step1.screenName` |
| firstName | `investorProfileStore.profiles[id].step1.firstName` |
| lastName | `investorProfileStore.profiles[id].step1.lastName` |
| contactEmail | `auth.users[id].email` (Auth0 — read-only) |
| profilePicture | `investorProfileStore.profiles[id].step2.profilePicture` |
| investorType | `investorProfileStore.profiles[id].step2.investorType` |
| accreditedStatus | `kycAccreditationStore[id].accreditationStatus` |
| sectorsOfInterest | `investorProfileStore.profiles[id].step3.industryExpertise` |
| checkSizeMin/Max | `investorProfileStore.profiles[id].step3.typicalChequeSize` (range enum → parse min/max) |
| handsonPreference | `investorProfileStore.profiles[id].step3.handsOnPreference` |
| maInterests | `investorProfileStore.profiles[id].step3.maInterests` |
| investmentInterests | `investorProfileStore.profiles[id].step3.investmentInterests` |
| visibleToCoMembers | `investorProfileStore.profiles[id].privacy.visibleToCoMembers` |
| countryOfTaxResidency | `investorProfileStore.profiles[id].step2.countryOfTaxResidency` |
| taxIdNationalId | `investorProfileStore.profiles[id].step2.taxIdNationalId` |

### 2.3 Collective field paths

| Field | Collective path |
|---|---|
| screenName | `collective_members.screen_name` |
| investorType | `collective_members.investor_type` |
| accreditedStatus | `kyc_accreditation.accreditation_status` |
| sectorsOfInterest | `collective_members.sectors_of_interest[]` |
| chapterMembership | `chapter_members.chapter_id` (Collective-only) |
| spvParticipation | `spv_subscriptions[]` (Collective-only) |
| dscMemberships | `dsc_assignments[]` (Collective-only) |
| memberTier | `collective_memberships.member_tier` (Collective-only) |

### 2.4 Source of truth

| Field | SOT |
|---|---|
| All profile fields | **Capavate-wins** |
| `chapterMembership`, `spvParticipation`, `dscMemberships`, `collectiveEventsRsvp`, `collectiveContributions` | **Collective-wins** (these fields originate and live only in Collective) |
| `memberTier` | **Collective-wins** (admin-managed in Collective lifecycle policy) |
| `accreditedStatus` | **latest-wins** (updated on KYC re-verification on either side) |

### 2.5 Transformation rules

| Field | Transformation |
|---|---|
| `investorType` (19-option enum) | camelCase in Capavate → snake_case in Collective: `"Angel investor (Individual)"` → `angel_individual` |
| `typicalChequeSize` (range enum) | Parse range: `"$25k–$50k"` → `checkSizeMin: 25000, checkSizeMax: 50000` USD (apply currency conversion from account's `contactCountry`) |
| `accreditedStatus` | Capavate `"Yes – Accredited"` → `"verified"` · `"No – Non-Accredited"` → `"self-cert"` · `"Not Sure"` → `"pending"` |

### 2.6 Privacy-gated fields list

PII never replicated: `contactEmail`, `contactMobile`, `countryOfTaxResidency`, `taxIdNationalId`, `kycDocuments`  
Portfolio-private: `topMarkupCompanies`, `portfolioCompanyHoldings[]`  
Real name shown to portfolio company only: `firstName`, `lastName` (replaced by `screenName` in all Collective surfaces)

---

## Entity 3 — Cap-Table Position (per-holder, per-instrument)

**Trigger events:** `cap_table.mutated`, `safe.converted`, `note.converted`, `round.closed`  
**Direction:** Outbound (Capavate → Collective) — aggregates only  
**Sync cadence:** Real-time on any transaction  
**Aggregate kind:** `company`

### 3.1 Canonical schema — shared aggregates

| # | Field | Type | Req | Validation | Privacy rule |
|---|---|---|---|---|---|
| 1 | `companyId` | string | ✓ | — | — |
| 2 | `totalShares` | decimal(28,0) | ✓ | > 0 | — |
| 3 | `fullyDilutedShares` | decimal(28,0) | ✓ | ≥ totalShares | — |
| 4 | `founderOwnershipPct` | decimal(7,4) | ✓ | 0–100 | — |
| 5 | `investorOwnershipPct` | decimal(7,4) | ✓ | 0–100 | — |
| 6 | `poolOwnershipPct` | decimal(7,4) | ✓ | 0–100 | — |
| 7 | `ownershipSumCheck` | bool | ✓ | founderPct+investorPct+poolPct = 100 (±0.0001) | — |
| 8 | `instrumentMix` | jsonb | ✓ | {common, preferred, safe, note, warrant, option} counts + FD value | — |
| 9 | `roundId` | string | — | — | — |
| 10 | `txCount` | int | — | ≥ 1 | — |
| 11 | `snapshotAt` | timestamp | ✓ | — | — |

### 3.2 Capavate-private (never replicated in detail)

| Field | Reason |
|---|---|
| `capTable.ledger[]` (per-holder entries) | VIS-5: per-investor holdings are private |
| `capTable.trace[]` (engine trace) | Stays in Capavate; audit log entry ID is the link |
| Per-investor share count, ownership %, $ invested | VIS-5 |
| Investor real names on ledger | VIS-2 |

### 3.3 Source of truth

All shared cap-table aggregate fields: **Capavate-wins** (Capavate is the financial system of record).

### 3.4 Transformation rules

| Field | Transformation |
|---|---|
| `totalShares` | Decimal(28,0) → JSON string in envelope (BigInt safety) |
| `fullyDilutedShares` | Same |
| Ownership percentages | 4 decimal places; sum verified ≤ 100.0001 before emit |
| `formulaTrace[]` | Always included for cap-table events: `[{formulaId, version, region, defHash}]` |

### 3.5 Conflict example

| Scenario | Resolution |
|---|---|
| Nightly batch in Collective shows `founderOwnershipPct` differs from Capavate by 0.003% (float rounding) | Capavate-wins; `cap_table.drift_detected` alarm fires; admin reconciles via `/admin/audit-log`; Capavate re-emits `cap_table.mutated` to push corrected snapshot |

---

## Entity 4 — Soft-Circle (per-investor × per-round)

**Trigger events:** `cap_table.mutated` (on confirmation), `eligibility.recomputed`  
**Direction:** Outbound only (Capavate → Collective) — aggregate totals  
**Sync cadence:** Real-time  
**Aggregate kind:** `company` (bundled in round snapshot)

### 4.1 Canonical schema

| # | Field | Type | Req | Validation | Privacy rule |
|---|---|---|---|---|---|
| 1 | `roundId` | string | ✓ | — | — |
| 2 | `companyId` | string | ✓ | — | — |
| 3 | `investorId` | string | ✓ | — | — |
| 4 | `softCircleType` | enum | ✓ | definite\|indication\|conditional | — |
| 5 | `amount` | decimal(18,2) | ✓ | ≥ 0 | VIS-7: amount Capavate-private; aggregate total shared |
| 6 | `currency` | enum | ✓ | USD\|CAD\|GBP\|EUR\|SGD\|HKD\|AUD | — |
| 7 | `personalNote` | string | — | max 500 chars | VIS-7: Capavate-private |
| 8 | `status` | enum | ✓ | pending\|viewed\|accepted\|declined\|soft_circled\|confirmed\|signed\|funded\|expired\|revoked | — |
| 9 | `investDate` | date | — | future date | — |
| 10 | `submittedAt` | timestamp | ✓ | — | — |
| 11 | `expiresAt` | timestamp | — | Default: `softCircleExpiryDays` from submit | — |
| 12 | `aggregateSoftCircleTotal` | decimal(18,2) | — | Sum of all confirmed amounts | Collective MIM panel shows this |
| 13 | `softCircleParticipantCount` | int | — | Count of members soft-circled | Collective MIM shows this |

### 4.2 Source of truth

Soft-circle data: **Capavate-wins** (pre-graduation activity).  
MIM aggregate panel in Collective shows `aggregateSoftCircleTotal` + `softCircleParticipantCount` (anonymized).

### 4.3 Privacy rules

`amount` per investor is private (VIS-7). Only aggregate totals visible in Collective MIM section. Individual `personalNote` never leaves Capavate.

### 4.4 Conflict example

| Scenario | Resolution |
|---|---|
| Investor submits soft-circle in Collective; founder confirms in Capavate; status in both surfaces | `confirmed` status propagated by `cap_table.mutated` event from Capavate; Collective reads from event; **Capavate-wins** on status |

---

## Entity 5 — Round (terms, lifecycle states, region, instrument)

**Trigger events:** `round.closed`, `cap_table.mutated`, `safe.converted`, `note.converted`  
**Direction:** Outbound (Capavate → Collective)  
**Sync cadence:** Real-time on state transition  
**Aggregate kind:** `round`

### 5.1 Canonical schema

| # | Field | Type | Req | Validation |
|---|---|---|---|---|
| 1 | `roundId` | string (CUID2) | ✓ | — |
| 2 | `companyId` | string | ✓ | — |
| 3 | `roundName` | string | ✓ | max 30 chars |
| 4 | `instrumentType` | enum | ✓ | SAFE\|Convertible Note\|Preferred Equity\|Common Equity |
| 5 | `stage` | enum | ✓ | Pre-Seed\|Seed\|Series A\|Series B\|Series C+\|Growth\|Late |
| 6 | `currency` | string | ✓ | ISO 4217 |
| 7 | `pricePerShareAtIncorporation` | decimal(18,4) | — | ≥ 0 (par value) |
| 8 | `preMoneyValuation` | decimal(18,2) | — | > 0 |
| 9 | `roundSizeTarget` | decimal(18,2) | — | > 0 |
| 10 | `roundSizeClosed` | decimal(18,2) | — | ≥ 0 (running soft-circle total) |
| 11 | `discountRate` | decimal(5,2) | — | 0–100 (SAFE/Note) |
| 12 | `valuationCap` | decimal(18,2) | — | > 0 (SAFE/Note) |
| 13 | `investorRights` | jsonb | — | {proRata, rofr, coSale, boardSeat, observer} booleans |
| 14 | `leadInvestorName` | string | — | screen name or firm name |
| 15 | `coInvestors` | string[] | — | screen names |
| 16 | `status` | enum | ✓ | draft\|open\|signing_open\|closed\|reopened |
| 17 | `region` | enum | ✓ | US\|CA\|UK\|EU\|SG\|HK\|AU\|IN\|Other (9 regions) |
| 18 | `expiryDate` | date | — | Invitation expiry |
| 19 | `closedAt` | timestamp | — | Populated on `round.closed` |
| 20 | `formulaTrace` | jsonb[] | — | `[{formulaId, version, region, defHash}]` |
| 21 | `shareTypes` | jsonb | — | {shareClass, shareType, votingRights} per founder block |

### 5.2 Source of truth

All round fields: **Capavate-wins** (Capavate owns the equity ledger).

### 5.3 Direction detail

Round terms are sent in `round.closed` payload as the final snapshot. During an open round, `cap_table.mutated` includes running `roundSizeClosed`. Collective renders round terms in Deal Detail Tab 5.

### 5.4 Conflict example

| Scenario | Resolution |
|---|---|
| Capavate closes round at $4M; Collective admin shows $3.8M (stale) | `round.closed` event replaces; **Capavate-wins**; Collective invalidates cache |

---

## Entity 6 — M&A Intelligence Rankings (Collective → Capavate inbound)

**Trigger events:** `ma.intelligence_rankings` (inbound), `company.ma_intelligence.updated` (outbound initial push)  
**Direction:** Outbound (initial 30 fields) then Inbound (computed rankings nightly)  
**Sync cadence:** Nightly batch (Collective → Capavate) + real-time on M&A field mutation (Capavate → Collective)  
**Aggregate kind:** `company`

### 6.1 Canonical schema — 30 M&A intelligence fields (Capavate → Collective)

| # | Field | Type | Req | Input type in Capavate | Collective use |
|---|---|---|---|---|---|
| 1 | `strategicPriorities` | string[] | — | multi-select (12 options) | M&A readiness signal |
| 2 | `transactionInterest` | string[] | — | multi-select (JV/minority/majority/full exit/acquisition) | Match to acquirers |
| 3 | `partnerTypesSought` | string[] | — | multi-select (9 options) | Partner matching |
| 4 | `dealBreakers` | string[] | — | multi-select (4 options) | Exclusion filter |
| 5 | `competitor1Name` | string | — | text | Competitive landscape table |
| 6 | `competitor1Url` | string(url) | — | text | — |
| 7 | `competitor1Notes` | string | — | textarea (max 400) | — |
| 8 | `competitor2Name` | string | — | text | — |
| 9 | `competitor2Url` | string(url) | — | text | — |
| 10 | `competitor2Notes` | string | — | textarea (max 400) | — |
| 11 | `competitor3Name` | string | — | text | — |
| 12 | `competitor3Url` | string(url) | — | text | — |
| 13 | `competitor3Notes` | string | — | textarea (max 400) | — |
| 14 | `hasFormalBoard` | bool | — | radio Y/N | Governance signal |
| 15 | `hasOpenLitigation` | bool | — | radio Y/N | Eligibility gate input |
| 16 | `isRegulatoryCompliant` | bool | — | radio Y/N | — |
| 17 | `hasLegalCounsel` | bool | — | radio Y/N | — |
| 18 | `wantsLegalReferral` | bool | — | radio Y/N | Admin action item |
| 19 | `hasCompletedLegalReview` | bool | — | radio Y/N | — |
| 20 | `hasAccountingFirm` | bool | — | radio Y/N | — |
| 21 | `accountingFirmName` | string | — | text | — |
| 22 | `hasAuditedFinancials` | bool | — | radio Y/N | — |
| 23 | `isSaasOrRecurring` | bool | — | radio Y/N | Business model signal |
| 24 | `holdsIP` | bool | — | radio Y/N | IP signal |
| 25 | `activeGeographies` | string[] | — | multi-select (15 regions) | Geographic expansion signal |
| 26 | `customerSegments` | string[] | — | multi-select (5 types) | — |
| 27 | `hasExclusivityClauses` | bool | — | radio Y/N | — |
| 28 | `hasRevConcentrationRisk` | bool | — | radio Y/N | VIS-9 shared (aggregated flag) |
| 29 | `hasChangeOfControlContracts` | bool | — | radio Y/N | — |
| 30 | `maReadinessNarrative` | string | — | textarea | — |
| 31 | `valuePropVsCompetitors` | string | — | textarea (max 800) | — |

### 6.2 Canonical schema — rankings (Collective → Capavate inbound)

| # | Field | Type | SOT | Notes |
|---|---|---|---|---|
| 1 | `compositeScore` | decimal(5,2) | Collective-wins | 0–100 weighted blend |
| 2 | `mnaScore` | decimal(5,2) | Collective-wins | M&A dimension |
| 3 | `roundScore` | decimal(5,2) | Collective-wins | Round attractiveness |
| 4 | `autoTier` | enum | Collective-wins | Watch\|Qualified\|Featured\|Priority |
| 5 | `sectorBenchmark` | decimal(5,2) | Collective-wins | Sector peer median |
| 6 | `algorithmVersion` | string | Collective-wins | `algorithm_versions` table ref |

### 6.3 Source of truth

30 M&A input fields: **Capavate-wins**  
Computed scores: **Collective-wins**

### 6.4 Transformation rules

| Field | Transformation |
|---|---|
| `activeGeographies` (15-region Capavate enum) | Map to canonical 9-region codes: "North America" → `US`+`CA`; "Western Europe" → `EU`; "United Kingdom" → `UK`; etc. |
| `autoTier` (Collective enum `A/B/C/D`) | Map to display labels: A → Priority, B → Featured, C → Qualified, D → Watch |

---

## Entity 7 — Eligibility Snapshot (per-user)

**Trigger events:** `eligibility.recomputed`  
**Direction:** Outbound (Capavate → Collective)  
**Sync cadence:** Real-time on cap-table mutation, lifecycle event, admin trigger  
**Aggregate kind:** `investor`

### 7.1 Canonical schema

| # | Field | Type | Req | Validation |
|---|---|---|---|---|
| 1 | `userId` | string | ✓ | — |
| 2 | `eligibilityScore` | int | ✓ | 0–100 |
| 3 | `eligibilityFlags` | jsonb | ✓ | see below |
| 4 | `computedAt` | timestamp | ✓ | — |
| 5 | `inputs.mnaScoreGte60` | bool | ✓ | maScore ≥ 60 |
| 6 | `inputs.arrAboveThreshold` | bool | ✓ | arr ≥ tenant policy |
| 7 | `inputs.lastRoundWithin18Mo` | bool | ✓ | lastRoundDate within 18 months |
| 8 | `inputs.noOpenLitigation` | bool | ✓ | hasOpenLitigation = false |
| 9 | `inputs.auditIntegrityIntact` | bool | ✓ | no broken hash chain |
| 10 | `eligibilityFlags.investorOnCapTable` | bool | ✓ | ≥1 round_participant confirmed/signed/funded |
| 11 | `eligibilityFlags.isFounder` | bool | ✓ | — |
| 12 | `eligibilityFlags.isSignatory` | bool | ✓ | — |
| 13 | `eligibilityFlags.partnerVouchWeight` | int | — | 0–5; ≥1 passes gate |
| 14 | `eligibilityFlags.overallEligible` | bool | ✓ | Any of A/B/C/D conditions met |

### 7.2 Source of truth

All eligibility fields: **Capavate-wins** (eligibility is computed in Capavate from its own ledger).

### 7.3 Collective consumption

On receipt of `eligibility.recomputed`:
1. Collective writes to `collective_eligibility_audit` (trigger, old status, new status, timestamp)
2. Mutates `collective_memberships.status` if threshold crossed
3. Inserts `notifications` row: `kind = 'collective.eligibility_gained'`
4. Updates sidebar badge: resolves `"Investor: NOT on a cap table"` → neutral

---

## Entity 8 — Lifecycle Policy (admin-managed)

**Trigger events:** `lifecycle_policy.changed`  
**Direction:** Outbound (Capavate → Collective)  
**Sync cadence:** On admin save at `/admin/lifecycle-policy`  
**Aggregate kind:** `platform`

### 8.1 Canonical schema

| # | Field | Type | Default | Validation |
|---|---|---|---|---|
| 1 | `founderDashboardTenureDays` | int | 180 | > 0 |
| 2 | `archivalRetentionDays` | int | 3650 | > 0 |
| 3 | `governanceMetricsCadenceDays` | int | 30 | > 0 |
| 4 | `softCircleExpiryDays` | int | 14 | > 0 |
| 5 | `invitationExpiryDays` | int | 21 | > 0 |
| 6 | `nonPaymentGraceDays` | int | 30 | > 0 |
| 7 | `requiredForVotes` | int | null | ≥ 1 |
| 8 | `majorityThresholdPct` | decimal(5,2) | null | 0–100 |
| 9 | `vintageCutoffMonths` | int | null | > 0 |
| 10 | `defaultCheckSizeMinUsd` | decimal(18,2) | 5000 | ≥ 0 |
| 11 | `defaultCheckSizeMaxUsd` | decimal(18,2) | 25000 | ≥ min |
| 12 | `monthlyMeetingMinutes` | int | null | > 0 |
| 13 | `rsvpCutoffHours` | int | null | > 0 |
| 14 | `groupRules` | jsonb[] | [] | {scope, field, value, expiresAt?} |
| 15 | `companyOverrides` | jsonb[] | [] | {companyId, field, value, expiresAt?} |
| 16 | `precedence` | string | canonical | Company Override > Group Rule > Platform Default |

### 8.2 Source of truth

All lifecycle policy fields: **Capavate-wins** (Capavate admin sets all policies; Collective only consumes).

### 8.3 Collective consumption

- `softCircleExpiryDays` → used for Collective SPV soft-circle TTL
- `invitationExpiryDays` → used for Collective member-to-member invite TTL
- `founderDashboardTenureDays` → triggers graduation notification
- `archivalRetentionDays` → controls hard-delete of graduated founder records
- `governanceMetricsCadenceDays` → pings DSC sponsors

---

## Entity 9 — Audit Log Entry (append-only, hash-chained)

**Trigger events:** `audit_log.appended`  
**Direction:** Outbound only (Capavate → Collective) — one-way, append-only  
**Sync cadence:** Real-time on each log write  
**Aggregate kind:** `company` / `investor` / `round` / `platform`

### 9.1 Canonical schema

| # | Field | Type | Req | Validation |
|---|---|---|---|---|
| 1 | `id` | string (CUID2) | ✓ | Primary key |
| 2 | `tenantId` | string | ✓ | `platform` for Collective-level events |
| 3 | `aggregateId` | string | ✓ | Company or user ID |
| 4 | `aggregateKind` | enum | ✓ | company\|user\|round\|spv\|document |
| 5 | `eventKind` | string | ✓ | e.g. `cap_table.mutated`, `round.closed` |
| 6 | `actorId` | string | ✓ | User UUID (pseudonymised on erasure) |
| 7 | `actorIp` | string | ✓ | IP address |
| 8 | `actorUserAgent` | string | — | Browser/agent |
| 9 | `occurredAt` | timestamp | ✓ | — |
| 10 | `payload` | jsonb | — | Event-specific data |
| 11 | `formulaTrace` | jsonb[] | — | `[{formulaId, version, region, defHash}]` for cap-table events |
| 12 | `priorHash` | string | ✓ | SHA-256 of prior row |
| 13 | `thisRowHash` | string | ✓ | SHA-256 of this row content (HMAC-SHA256) |

### 9.2 Source of truth

Audit log: **Capavate-wins** (append-only). Collective stores the cross-system link (`priorAuditHash`, `auditHash`) alongside its own audit log for reconciliation.

### 9.3 Immutability constraint

`REVOKE UPDATE/DELETE` on `capavate_app` database role. Entries are append-only at the DB layer. Collective stores the entry ID + both hashes; never stores the full payload (that stays in Capavate).

---

## Entity 10 — KYC Record + Accreditation Status (jurisdiction-aware)

**Trigger events:** `investor.profile.updated` (on status change)  
**Direction:** Outbound (Capavate → Collective) — status only  
**Sync cadence:** Real-time on status change  
**Aggregate kind:** `investor`

### 10.1 Canonical schema

| # | Field | Type | Req | Validation | Privacy rule |
|---|---|---|---|---|---|
| 1 | `userId` | string | ✓ | — | — |
| 2 | `kycInquiryId` | string | — | Provider-issued | VIS-1: Capavate-private |
| 3 | `kycProvider` | enum | — | Persona\|Sumsub\|Onfido\|Veriff | VIS-1: Capavate-private |
| 4 | `sanctionsScreeningResult` | enum | ✓ | clear\|flagged\|pending | — |
| 5 | `accreditationStatus` | enum | ✓ | verified\|self-cert\|pending\|rejected | Shared to Collective |
| 6 | `jurisdiction` | enum | ✓ | US\|CA\|UK\|EU\|SG\|HK\|AU\|IN\|Other | Drives which form was used |
| 7 | `documentHashes` | string[] | — | SHA-256 of uploaded docs | VIS-1: Capavate-private |
| 8 | `verifiedAt` | timestamp | — | — | — |
| 9 | `expiresAt` | timestamp | — | — | — |
| 10 | `accreditationMethod` | enum | — | income_threshold\|net_worth\|self_cert\|third_party_letter\|professional_client | — |

### 10.2 Source of truth

KYC records: **Capavate-wins** (KYC processing happens on Capavate; Collective only receives final `accreditationStatus`).

### 10.3 Jurisdiction-specific transformation

| Jurisdiction | Capavate form | `accreditationStatus` outcome |
|---|---|---|
| US | Annual income >$200k or net worth >$1M | `verified` if threshold met; `self-cert` if self-declared; `pending` if third-party letter uploaded |
| CA | Net income >$200k CAD or net assets >$1M CAD (NI 45-106) | Same mapping |
| UK | HNW (income >£100k or assets >£250k) or Sophisticated Investor self-cert | `verified` (HNW) / `self-cert` (SI) |
| EU (MiFID II) | Professional client declaration | `verified` |
| SG (SFA §4A) | AI declaration | `verified` |
| HK (SFO s.1 Part 1 Sch 1) | PI declaration | `verified` |
| Other | Generic self-declaration | `self-cert` |

---

## Entity 11 — Member Tier + Collective Membership

**Trigger events:** `lifecycle_policy.changed` (tier definition), `eligibility.recomputed` (membership gate)  
**Direction:** Bidirectional (Collective-wins for membership status; Capavate-wins for eligibility gate)  
**Sync cadence:** Real-time on status change  
**Aggregate kind:** `investor` / `platform`

### 11.1 Canonical schema

| # | Field | Type | Req | Validation |
|---|---|---|---|---|
| 1 | `userId` | string | ✓ | — |
| 2 | `memberTier` | enum | — | Individual\|Standard\|Plus (admin-managed) |
| 3 | `memberTierUsdAnnual` | decimal(10,2) | — | Individual: $600 · Standard: $1,200 · Plus: $2,400 |
| 4 | `membershipStatus` | enum | ✓ | submitted\|reviewing\|accepted\|active\|suspended |
| 5 | `applicationSubmittedAt` | timestamp | — | — |
| 6 | `acceptedAt` | timestamp | — | — |
| 7 | `renewalDate` | date | — | — |
| 8 | `nonPaymentGraceDaysRemaining` | int | — | 0–30 |
| 9 | `chapterId` | string | — | Non-overlapping geographic chapter |
| 10 | `investmentThesis` | string | — | max 1000 chars |
| 11 | `referralPartnerCode` | string | — | `cp_` prefix |
| 12 | `consortiumPartnerDiscount` | decimal(5,2) | — | 0–100 % |
| 13 | `paymentMethod` | enum | — | stripe_card\|invoice |
| 14 | `stripeCustomerId` | string | — | VIS-1: Capavate-private |
| 15 | `stripeSubscriptionId` | string | — | VIS-1: Capavate-private |

### 11.2 Source of truth

| Field | SOT |
|---|---|
| `memberTier` definition, `memberTierUsdAnnual` | **Capavate-wins** (admin sets in `/admin/pricing`) |
| `membershipStatus`, `chapterId`, `renewalDate` | **Collective-wins** (membership lifecycle managed in Collective) |
| Eligibility gate inputs | **Capavate-wins** |

### 11.3 Pricing sync

Tier definitions propagated via `lifecycle_policy.changed` event payload including `{memberTier: {Individual: 600, Standard: 1200, Plus: 2400}}`. Collective updates checkout amounts on receipt.

---

## Entity 12 — Consortium Partner Directory Entry

**Trigger events:** `partner.introduction_status` (inbound), `lifecycle_policy.changed` (partner terms)  
**Direction:** Collective → Capavate (introduction status inbound); Capavate → Collective (partner directory push outbound)  
**Sync cadence:** On status change (inbound) · Manual/nightly (outbound directory)  
**Aggregate kind:** `platform`

### 12.1 Canonical schema

| # | Field | Type | Req | Validation |
|---|---|---|---|---|
| 1 | `partnerId` | string | ✓ | `p_` prefix |
| 2 | `partnerName` | string | ✓ | — |
| 3 | `partnerSlug` | string | ✓ | URL-safe, `cp_` prefix for referral |
| 4 | `partnerCategory` | string | — | Law firm\|Accounting\|VC\|Accelerator\|Other |
| 5 | `logoUrl` | string(url) | — | — |
| 6 | `websiteUrl` | string(url) | — | — |
| 7 | `introductionStatus` | enum | — | pending\|warm_intro_made\|accepted\|declined |
| 8 | `vouchWeight` | int | — | 0–5; ≥1 passes eligibility gate |
| 9 | `referralAttributionLock` | bool | — | First-referral-wins, lock-once |
| 10 | `commissionRate` | decimal(5,2) | — | VIS-1: private to admin |
| 11 | `commissionRecordId` | string | — | Links to `commission_records` table |
| 12 | `partnerVouchWeight` | int | — | 1–5 scale |

### 12.2 Source of truth

Directory definition: **Collective-wins** (partner catalog managed in Collective).  
Introduction status events: **Collective-wins** (Collective manages partner introductions).  
Commission rates: **Capavate-wins** (admin-set in Capavate `/admin/pricing`).

---

## Entity 13 — Term Sheet Draft + Signatures (SES)

**Trigger events:** `round.closed` (with term sheet snapshot)  
**Direction:** Outbound (Capavate → Collective — term sheet metadata only)  
**Sync cadence:** On round close or document signing event  
**Aggregate kind:** `round`

### 13.1 Canonical schema

| # | Field | Type | Req | Validation | Privacy rule |
|---|---|---|---|---|---|
| 1 | `termSheetId` | string | ✓ | — | — |
| 2 | `roundId` | string | ✓ | — | — |
| 3 | `companyId` | string | ✓ | — | — |
| 4 | `instrumentType` | enum | ✓ | SAFE\|Convertible Note\|Preferred Equity\|Common Equity | — |
| 5 | `amount` | decimal(18,2) | ✓ | — | — |
| 6 | `valuationCap` | decimal(18,2) | — | — | — |
| 7 | `discountRate` | decimal(5,2) | — | 0–100 | — |
| 8 | `closingConditions` | string | — | — | — |
| 9 | `governingLaw` | string | — | — | — |
| 10 | `documentUrl` | string(url) | — | Signed PDF URL in object store | Gated per investor |
| 11 | `signatoryStatus` | jsonb | — | `{investorId, signedAt, counterSignedAt}[]` | — |
| 12 | `sesEnvelopeId` | string | — | DocuSign / AWS SES envelope | VIS-1: private |
| 13 | `generatedAt` | timestamp | — | — | — |
| 14 | `signedAt` | timestamp | — | — | — |
| 15 | `counterSignedAt` | timestamp | — | — | — |

### 13.2 Source of truth

Term sheet: **Capavate-wins** (generated and signed in Capavate). Collective receives metadata only (status, dates, instrument summary). File bytes stay in Capavate object store; investor accesses via Capavate dataroom, not Collective.

### 13.3 Privacy rule

`documentUrl` visible only to invited investor with confirmed status. `sesEnvelopeId` never leaves Capavate.

---

## Entity 14 — Dataroom Permission Grant (per-investor × per-folder)

**Trigger events:** `company.profile.updated` (grant added/removed notification bundled)  
**Direction:** Outbound only (Capavate → Collective) — metadata only  
**Sync cadence:** Real-time on grant creation or revocation  
**Aggregate kind:** `company`

### 14.1 Canonical schema

| # | Field | Type | Req | Notes |
|---|---|---|---|---|
| 1 | `grantId` | string | ✓ | — |
| 2 | `companyId` | string | ✓ | — |
| 3 | `investorId` | string | ✓ | — |
| 4 | `folderId` | string | ✓ | — |
| 5 | `grantedAt` | timestamp | ✓ | — |
| 6 | `revokedAt` | timestamp | — | null if still active |
| 7 | `grantedByUserId` | string | ✓ | Founder who granted |
| 8 | `accessLevel` | enum | ✓ | read\|download |

### 14.2 Source of truth

**Capavate-wins** — all grants are created and revoked in Capavate. Collective displays grant status in Deal Detail Tab 6 (Documents) as "Access granted by [Company Name]".

---

## Entity 15 — Dataroom File Metadata (NOT file bytes)

**Trigger events:** Bundled in `company.profile.updated` or standalone `dataroom.file.uploaded` event  
**Direction:** Outbound (Capavate → Collective) — metadata only  
**Sync cadence:** Real-time on file upload/delete  
**Aggregate kind:** `company`

### 15.1 Canonical schema

| # | Field | Type | Req | Notes |
|---|---|---|---|---|
| 1 | `fileId` | string | ✓ | — |
| 2 | `companyId` | string | ✓ | — |
| 3 | `folderId` | string | ✓ | One of 11 categories (42 slots) |
| 4 | `folderName` | string | ✓ | e.g. "Management Team", "Financial" |
| 5 | `documentSlot` | string | ✓ | e.g. "Audit Reports" |
| 6 | `fileName` | string | ✓ | — |
| 7 | `fileType` | enum | ✓ | PDF\|JPG\|PNG\|XLSX\|DOCX\|Other |
| 8 | `fileSizeBytes` | int | — | — |
| 9 | `uploadedAt` | timestamp | ✓ | — |
| 10 | `uploadedByUserId` | string | ✓ | — |
| 11 | `objectStoreKey` | string | ✓ | **Never replicated** — stays in Capavate |
| 12 | `accessibleToInvestorId` | string | — | Resolved from grant table; null = no access |

### 15.2 Source of truth

**Capavate-wins**. File bytes (`objectStoreKey`) never leave Capavate. Collective receives only the metadata list. Investors access files via Capavate-served URLs with time-limited signed tokens.

---

## Entity 16 — Notification + Email Preferences (per-user)

**Trigger events:** Propagated on profile update  
**Direction:** Bidirectional (user sets on either surface)  
**Sync cadence:** Real-time on preference change  
**Aggregate kind:** `investor` / `company`

### 16.1 Canonical schema

| # | Field | Type | Req | Notes |
|---|---|---|---|---|
| 1 | `userId` | string | ✓ | — |
| 2 | `emailEnabled` | bool | ✓ | Global email toggle |
| 3 | `pushEnabled` | bool | — | Web Push opt-in |
| 4 | `perKindPreferences` | jsonb | — | `{notificationKind: {email: bool, push: bool}}` for each of 21 kinds |
| 5 | `bounced` | bool | — | Set by SES webhook; disables email |
| 6 | `pushSubscription` | jsonb | — | Web Push API subscription object |

**21 notification kinds:**  
`round.invitation_received`, `round.invitation_accepted`, `round.invitation_declined`, `round.soft_circle_received`, `round.document_ready_to_sign`, `round.document_signed`, `round.closed`, `dataroom.access_granted`, `dataroom.document_uploaded`, `investor_report.published`, `message.received`, `collective.eligibility_gained`, `collective.membership_approved`, `spv.launched`, `spv.subscription_countersigned`, `dsc.company_assigned`, `cap_table.drift_detected`, `compliance.hold_placed`, `kyc.status_changed`, `membership.renewal_due`, `membership.lapsed`

### 16.2 Source of truth

**latest-wins** — whichever surface the user last updated. In-app channel cannot be disabled by user (always-on).

---

## Entity 17 — Pricing Tier Definition (admin → both surfaces)

**Trigger events:** `lifecycle_policy.changed` (includes pricing)  
**Direction:** Outbound (Capavate → Collective)  
**Sync cadence:** On admin save at `/admin/pricing`  
**Aggregate kind:** `platform`

### 17.1 Canonical schema

| # | Field | Type | Req | Validation |
|---|---|---|---|---|
| 1 | `collectiveTiers` | jsonb | ✓ | `[{tierName, usdAnnual, perks[]}]` |
| 2 | `founderTiers` | jsonb | ✓ | `[{tierName, usdMonthly, features[]}]` |
| 3 | `regionMatrix` | jsonb | ✓ | `{region: {tierName: price}}` for 9 regions |
| 4 | `consortiumDiscounts` | jsonb | — | `{partnerSlug: discountPct}` |
| 5 | `perCustomerOverrides` | jsonb | — | `{userId: {field: value, expiresAt?}}` |
| 6 | `coupons` | jsonb | — | `{code: {discountPct, validUntil}}` |
| 7 | `stripeProductIds` | jsonb | — | Stripe product/price IDs per tier |

**Live tier values:**  
Collective: Individual $600/yr · Standard $1,200/yr · Plus $2,400/yr  
Founder: Free $0 · Pro $249/mo · Scale $749/mo

### 17.2 Source of truth

**Capavate-wins** (admin defines all pricing; Collective checkout reads from the pushed snapshot).

---

## Entity 18 — Communications: Thread + Message + Reaction + Follow

**Trigger events:** Real-time WebSocket / SSE events (bidirectional)  
**Direction:** Bidirectional  
**Sync cadence:** Real-time  
**Aggregate kind:** `investor` / `company`

### 18.1 Canonical schema — Thread

| # | Field | Type | Req |
|---|---|---|---|
| 1 | `threadId` | string | ✓ |
| 2 | `participantIds` | string[] | ✓ |
| 3 | `participantScreenNames` | string[] | ✓ |
| 4 | `participantTypes` | enum[] | ✓ | Company\|Investor |
| 5 | `createdAt` | timestamp | ✓ |
| 6 | `lastMessageAt` | timestamp | — |
| 7 | `starred` | bool | — | Per-user; not synced cross-system |
| 8 | `onlineStatus` | enum | — | online\|offline (real-time) |

### 18.2 Canonical schema — Message

| # | Field | Type | Req |
|---|---|---|---|
| 1 | `messageId` | string | ✓ |
| 2 | `threadId` | string | ✓ |
| 3 | `senderId` | string | ✓ |
| 4 | `senderScreenName` | string | ✓ |
| 5 | `content` | string | ✓ | Text or emoji |
| 6 | `sentAt` | timestamp | ✓ |
| 7 | `readAt` | timestamp | — | Double-checkmark read receipt |
| 8 | `deliveredAt` | timestamp | — | |

### 18.3 Canonical schema — Post

| # | Field | Type | Req |
|---|---|---|---|
| 1 | `postId` | string | ✓ |
| 2 | `authorId` | string | ✓ |
| 3 | `authorScreenName` | string | ✓ |
| 4 | `authorNetworkBadge` | string | — | e.g. "Capavate Angel Network" |
| 5 | `authorRoleBadge` | string | — | e.g. "Investor" |
| 6 | `authorLocation` | string | — | City, Country (no street) |
| 7 | `content` | string | ✓ | max 5000 chars |
| 8 | `mediaUrl` | string(url) | — | Attached image/video |
| 9 | `postedAt` | timestamp | ✓ |
| 10 | `likeCount` | int | — | — |
| 11 | `commentCount` | int | — | — |

### 18.4 Canonical schema — Reaction

| # | Field | Type | Req |
|---|---|---|---|
| 1 | `reactionId` | string | ✓ |
| 2 | `postId` | string | ✓ |
| 3 | `userId` | string | ✓ |
| 4 | `type` | enum | ✓ | like (👍) |
| 5 | `reactedAt` | timestamp | ✓ |

### 18.5 Canonical schema — Follow

| # | Field | Type | Req |
|---|---|---|---|
| 1 | `followId` | string | ✓ |
| 2 | `followerId` | string | ✓ |
| 3 | `followeeId` | string | ✓ |
| 4 | `followedAt` | timestamp | ✓ |

### 18.6 Source of truth

**latest-wins** (bidirectional real-time sync; last writer wins for message content; append-only for reactions and follows).

### 18.7 Privacy rules

- Sender and recipient identified only by `screenName` in Collective social surfaces (VIS-2)
- Real names visible only to portfolio companies where investor holds confirmed position (VIS-2)
- DM threads between cap-table co-members require both-party `visible_to_co_members=true` (VIS-10)
- Message history not synced to Collective audit log (communications are transient; only notification events are audit-logged)

### 18.8 Communication eligibility gate

A message thread is allowed only when both conditions are met:
1. User A and User B share ≥1 Capavate cap table OR same DSC committee OR same Collective chapter
2. Both users have `visible_to_co_members=true` OR `visible_to_collective_network=true` (for Collective-only paths)

---

## Entity 19 — CRM Contact + Note + Task (Sprint 10 pcrm_*)

**Trigger events:** No cross-system sync — CRM is local to each surface  
**Direction:** None (no sync)  
**Sync cadence:** N/A  
**Notes:** Capavate has founder-side CRM (`/crm/investor-directory`); Collective has Personal CRM (`/collective/#/crm`). These are separate rolodexes. No field-level sync is defined or desired (Sprint 10 spec).

### 19.1 Capavate CRM schema

| # | Field | Type | Notes |
|---|---|---|---|
| 1 | `contactId` | string | — |
| 2 | `firstName` | string | — |
| 3 | `lastName` | string | — |
| 4 | `contactEmail` | string(email) | — |
| 5 | `addedAt` | timestamp | — |
| 6 | `roundAssociation` | string | Round ID |

### 19.2 Collective Personal CRM (pcrm_*) schema

| # | Field | Type | Notes |
|---|---|---|---|
| 1 | `pcrm_contactId` | string | — |
| 2 | `contactName` | string | — |
| 3 | `contactFirm` | string | — |
| 4 | `pcrm_notes` | jsonb[] | Timestamped note log |
| 5 | `pcrm_tasks` | jsonb[] | Task list with due date |
| 6 | `category` | string | Member-defined |

**SOT:** Each surface owns its own CRM data. No sync required or implemented.

---

## Entity 20 — Posts (Company Posts Feed)

See Entity 18 for the canonical Post schema.

**Capavate field path:** `commsStore.posts[companyId][]`  
**Collective field path:** `collective_posts[]` (shared network feed)  
**Direction:** Bidirectional (posts visible on both dashboards)  
**SOT:** **latest-wins** (last write wins; both surfaces write to same backing store)

**Visibility:** Posts appear in "Messages from Shareholders" feed on company dashboard and in the Collective posts feed. Screen names used everywhere (VIS-2).

---

## Entity 21 — Reports (Investor Reports + Read Receipts)

**Trigger events:** `governance_metric.published`  
**Direction:** Outbound (Capavate → Collective) — metadata + read receipt status  
**Sync cadence:** Real-time on publish  
**Aggregate kind:** `company`

### 21.1 Canonical schema

| # | Field | Type | Req |
|---|---|---|---|
| 1 | `reportId` | string | ✓ |
| 2 | `companyId` | string | ✓ |
| 3 | `reportName` | string | ✓ |
| 4 | `period` | string | ✓ | e.g. "Q1 2026" |
| 5 | `publishedAt` | timestamp | ✓ |
| 6 | `sections` | jsonb | ✓ | {financialPerformance, operationalUpdates, marketLandscape, customerProductInsights, fundraisingStrategy, futureOutlook} |
| 7 | `attachmentUrls` | string(url)[] | — | In object store; gated per investor |
| 8 | `readReceipts` | jsonb[] | — | `{investorId, readAt}[]` |
| 9 | `totalReviewed` | int | — | Count of read receipts |

### 21.2 Source of truth

**Capavate-wins** (founder publishes reports in Capavate; Collective displays them in deal detail).

### 21.3 Read receipts

Read receipts (`readAt` per investor) are written to Collective when an investor opens the report in Collective. Synced back to Capavate via `governance_metric.published` ACK.

---

## Entity 22 — SPV / DSC Scoring (Collective → Capavate inbound)

**Trigger events:** `dsc.scores` (inbound)  
**Direction:** Inbound only (Collective → Capavate)  
**Sync cadence:** On DSC review completion  
**Aggregate kind:** `company`

### 22.1 Canonical schema

| # | Field | Type | Req |
|---|---|---|---|
| 1 | `reviewId` | string | ✓ |
| 2 | `companyId` | string | ✓ |
| 3 | `dscScore` | decimal(4,1) | ✓ | 0–5 |
| 4 | `dscRecommendation` | enum | ✓ | advance\|neutral\|pass |
| 5 | `reviewerIds` | string[] | ✓ | DSC member user IDs |
| 6 | `dimension1Score` | decimal(4,1) | — | Market opportunity |
| 7 | `dimension2Score` | decimal(4,1) | — | Team strength |
| 8 | `dimension3Score` | decimal(4,1) | — | Traction |
| 9 | `dimension4Score` | decimal(4,1) | — | Deal terms |
| 10 | `dimension5Score` | decimal(4,1) | — | Exit potential |
| 11 | `reviewedAt` | timestamp | ✓ | — |

### 22.2 Source of truth

**Collective-wins** (DSC scoring happens exclusively in Collective).

### 22.3 Capavate consumption

Inbound `dsc.scores` event writes to Capavate's `inbox[]` (bridgeStore). Admin can view in `/admin/bridge`. Used to update company's eligibility signals in conjunction with `ma.intelligence_rankings`.

---

## Entity 23 — Network Social Signals (Collective → Capavate inbound)

**Trigger events:** `network.social_signals` (inbound)  
**Direction:** Inbound only (Collective → Capavate)  
**Sync cadence:** Real-time  
**Aggregate kind:** `company`

### 23.1 Canonical schema

| # | Field | Type | Req |
|---|---|---|---|
| 1 | `companyId` | string | ✓ | — |
| 2 | `followerCount` | int | — | — |
| 3 | `mentionCount` | int | — | — |
| 4 | `networkActivity` | enum | — | trending\|stable\|declining |
| 5 | `signalAt` | timestamp | ✓ | — |

### 23.2 Capavate consumption

Social signals surfaced on admin dashboard "Macro KPIs" and optionally as an eligibility scoring input.

---

## Entity 24 — Partner Introduction Status (Collective → Capavate inbound)

**Trigger events:** `partner.introduction_status` (inbound)  
**Direction:** Inbound only (Collective → Capavate)  
**Sync cadence:** On status change  
**Aggregate kind:** `company`

### 24.1 Canonical schema

| # | Field | Type | Req |
|---|---|---|---|
| 1 | `companyId` | string | ✓ | — |
| 2 | `partnerId` | string | ✓ | — |
| 3 | `introductionStatus` | enum | ✓ | pending\|warm_intro_made\|accepted\|declined |
| 4 | `vouchWeight` | int | — | 1–5 |
| 5 | `statusAt` | timestamp | ✓ | — |

### 24.2 Capavate consumption

`vouchWeight ≥ 1` contributes to condition D of `isEligibleForCollective()` eligibility gate.

---

## Migration Mapping — Live Capavate.com → New Capavate Rebuild

### Live Capavate tables / collections

| Live table / route | Canonical entity (rebuild) | Migration action | New fields needed | Deprecated fields |
|---|---|---|---|---|
| `/company-profile` — Step 1 (company_name, company_email, industry, phone, website, number_of_employees, date_of_incorporation, one_sentence_headliner, problem_statement, solution_statement) | Entity 1 — Company Profile | Direct field map; rename to camelCase | `brandColor`, `oneSentenceHeadliner` (rename from one_sentence_headliner), `foundedYear` (derive from date_of_incorporation year) | None |
| `/company-profile` — Step 2 (street, country, unit, state, city, postal_code) | Entity 1 `operatingAddresses` | Map full address; extract `headquartersCity` + `headquartersCountry` for Collective-shared subset | — | `operatingAddresses` full detail is private (VIS-1) |
| `/company-profile` — Step 3 (articles upload, legal_entity_name, business_number, country_of_incorporation, type_of_entity, traded_on_exchange, registered_office_address) | Entity 1 — `legalName`, `entityType`, `jurisdiction`, `registrationId` | `type_of_entity` free-text → `entityType` enum (normalize) | `fiscalYearEnd` (new, default null) | `traded_on_exchange` (use Stage field instead; flag for data audit) |
| `/company-profile` — Step 4 M&A (all 30+ fields) | Entity 6 — M&A Intelligence | Direct map; rename to camelCase; booleans stay booleans | `maReadinessNarrative`, `valuePropVsCompetitors` (new in rebuild) | None |
| `/record-round-list` — Round wizard (round_name, founder blocks, currency, price_per_share, share_type, share_class, voting_rights) | Entity 5 — Round | Direct map; add `instrumentType`, `preMoneyValuation`, `roundSizeTarget` | `instrumentType`, `discountRate`, `valuationCap`, `investorRights` (all new for SAFE/Note/Preferred rounds) | None |
| `/crm/addnew-investor` (first_name, last_name, email) | Entity 19 — CRM Contact | Direct map | `addedAt`, `roundAssociation` (new defaults) | None |
| `/crm/investment` — Round participants (status field) | Entity 4 — Soft-Circle + Entity 5 — Round | Map `status` to 10-state enum: live uses 2-state (interested/confirmed) → rebuild uses `pending|viewed|accepted|declined|soft_circled|confirmed|signed|funded|expired|revoked` | 8 new status states | Old 2-state `interested/confirmed` |
| `/investorlist` → `/add-new-investor` — Reports (6 sections, all textarea) | Entity 21 — Reports | Map each section to `sections.{sectionKey}` jsonb | `reportId`, `period`, `publishedAt`, `readReceipts[]` (all new) | — |
| `/investor/profile` — Step 1 (screen_name, current_company, job_title, website, first_name, last_name, email, country, state, city, mobile) | Entity 2 — Investor Profile | Direct map; add `visibleToCoMembers`, `screenNameSet` privacy toggles | Privacy toggles (new in rebuild) | None |
| `/investor/profile` — Step 2 (investor_type, accredited_status, network_bio, linkedin, invest_through_company, tax_residency, tax_id, kyc_docs, profile_picture) | Entity 2 + Entity 10 — KYC | Direct map; `accredited_status` 3-option enum → 4-option `verified|self-cert|pending|rejected` | `kycProvider`, `kycInquiryId`, `sanctionsScreeningResult`, `verifiedAt`, `accreditationMethod` (new for KYC record) | `accredited_status: "Not Sure"` → `pending` |
| `/investor/profile` — Step 3 (industry_expertise, cheque_size, geography_focus, preferred_stage, hands_on, ma_interests, investment_interests) | Entity 2 — Investor Profile | Direct map; parse cheque_size range enum → `checkSizeMin`/`checkSizeMax` decimal | `checkSizeMin`, `checkSizeMax` as separate decimals (new vs. live range enum) | Range enum string |
| `/investor/company-invitation-list` — Invitation modal (soft circle table: investment_amount, invest_date, request_confirm) | Entity 4 — Soft-Circle | Map 3 fields + add `softCircleType`, `personalNote`, `currency` | 5 new fields | None |
| `/dataroom-Duediligence` — 42 document slots across 11 categories | Entity 15 — Dataroom File Metadata | Each slot becomes a `documentSlot` + `folderId`; add per-file metadata | `fileId`, `fileType`, `fileSizeBytes`, `uploadedAt`, `objectStoreKey`, `accessibleToInvestorId` (all new) | None |
| `/activity-logs` table (module, action, entity, ip, date) | Entity 9 — Audit Log | Map to `audit_log` schema; add `aggregateKind`, `priorHash`, `thisRowHash` | Hash chain fields (new) | None |
| `/subscription` page (no data — empty state on live) | Entity 17 — Pricing Tier | Bootstrap from Stripe subscription records; link to `collectiveMemberships` | All fields new (page was empty) | — |
| Live Capavate investor status badge ("Investor: NOT on a cap table") | Entity 11 — Member Tier + `eligibilityFlags.investorOnCapTable` | Derive from `round_participants.status` across all companies | `eligibilityScore`, `eligibilityFlags.*` (all new computed fields) | Old boolean flag |
| Messages/posts (live comms — thread, messages, stars, online status) | Entity 18 — Communications | Direct map; add `postId`, `reactionId`, `followId` schemas | Reaction schema, follow schema (new) | None |
| "Social Media" sidebar widget (Followers, Following counts) | Entity 23 — Network Social Signals | Map `followerCount`, `followingCount` | `mentionCount`, `networkActivity` (new inbound from Collective) | — |

### New fields in rebuild with defaults for import

| Field | Entity | Default on import |
|---|---|---|
| `brandColor` | Company Profile | `#1C2B4A` (Navy — design token) |
| `fiscalYearEnd` | Company Profile | `null` |
| `foundedYear` | Company Profile | Derived from `incorporationDate` year |
| `eligibilityScore` | Eligibility Snapshot | Computed on first import run |
| `eligibilityFlags.*` | Eligibility Snapshot | Computed |
| `accreditationStatus` (4-option) | KYC Record | Map from live 3-option: `"Yes – Accredited"→"verified"`, `"No – Non-Accredited"→"self-cert"`, `"Not Sure"→"pending"` |
| `visibleToCoMembers` | Investor Profile | `false` (privacy by default) |
| `visible_to_collective_network` | Investor Profile | `false` |
| `screenNameSet` | Investor Profile | `true` if `screen_name` non-empty |
| `priorHash` / `thisRowHash` | Audit Log | Bootstrap chain from genesis block on first import |
| `memberTier` | Collective Membership | `standard` (default) |
| `softCircleExpiryDays` | Lifecycle Policy | `14` |
| `invitationExpiryDays` | Lifecycle Policy | `21` |
| `roundSizeClosed` | Round | `0` (recalculate from `round_participants` on import) |

### Deprecated / legacy fields flagged

| Live field | Status | Reason |
|---|---|---|
| `sector = "YES"` (sidebar bug) | **Bug — data fix required** | Boolean stored as sector field; replace with proper `industry` value from Step 1 |
| `traded_on_exchange` (Step 3 radio) | **Deprecated** | Not in rebuild entity model; archive to `legacy_flags` jsonb |
| Soft-circle 2-state `interested/confirmed` | **Extended** | Map to 10-state enum; old `interested` → `soft_circled`; old `confirmed` → `confirmed` |
| `accredited_status: "Not Sure"` | **Remapped** | → `pending` in rebuild |
| Round wizard Tabs 2–5 (inferred, locked during audit) | **Verify on import** | Field names for Description, Round Summary, Rights & Preferences, Notes need field-by-field mapping when unlocked |
| Live `/subscription` page (empty state) | **New** | No data to migrate; bootstrap from Stripe |
| `phone_country` + `phone_number` separate fields | **Merged** | → `primaryPhone` E.164 format (`+{countryCode}{number}`) |

### Region code transformation

| Live Capavate region label | Canonical 9-region code |
|---|---|
| "Local only (single city/metro area)" | Mapped to founder's `jurisdiction` country |
| "National only (within one country)" | Mapped to founder's `jurisdiction` country |
| "North America" | `US` + `CA` |
| "Latin America" + "South America" | `Other` (no dedicated region code) |
| "Western Europe" | `EU` |
| "Eastern Europe" | `EU` |
| "Middle East" | `Other` |
| "Africa" | `Other` |
| "Central Asia" + "South Asia" | `IN` (or `Other`) |
| "Southeast Asia" | `SG` |
| "East Asia (excluding China/HK)" | `Other` |
| "China / Hong Kong" | `HK` |
| "Oceania (Australia, NZ, Pacific Islands)" | `AU` |

---

## Summary Statistics

### Field count by entity

| Entity | Total fields | Capavate-private | Collective-shared | Collective-only |
|---|---|---|---|---|
| 1. Company Profile | 44 | 8 | 36 | 0 |
| 2. Investor Profile | 41 | 7 | 29 | 5 |
| 3. Cap-Table Position | 11 | 4 | 7 | 0 |
| 4. Soft-Circle | 13 | 3 | 10 | 0 |
| 5. Round | 21 | 0 | 21 | 0 |
| 6. M&A Intelligence | 37 | 0 | 31 | 6 |
| 7. Eligibility Snapshot | 14 | 0 | 14 | 0 |
| 8. Lifecycle Policy | 16 | 0 | 16 | 0 |
| 9. Audit Log Entry | 13 | 0 | 13 | 0 |
| 10. KYC Record | 10 | 5 | 5 | 0 |
| 11. Member Tier + Membership | 15 | 2 | 5 | 8 |
| 12. Consortium Partner | 12 | 1 | 8 | 3 |
| 13. Term Sheet + Signatures | 15 | 2 | 13 | 0 |
| 14. Dataroom Permission Grant | 8 | 0 | 8 | 0 |
| 15. Dataroom File Metadata | 12 | 1 | 11 | 0 |
| 16. Notification + Email Preferences | 6 | 0 | 6 | 0 |
| 17. Pricing Tier Definition | 7 | 0 | 7 | 0 |
| 18. Communications (Thread+Message+Post+Reaction+Follow) | 30 | 0 | 30 | 0 |
| 19. CRM Contact + Note + Task | 11 | 0 | 0 | 11 |
| 20. Posts | 11 | 0 | 11 | 0 |
| 21. Reports + Read Receipts | 9 | 0 | 9 | 0 |
| 22. SPV / DSC Scoring | 11 | 0 | 0 | 11 |
| 23. Network Social Signals | 5 | 0 | 0 | 5 |
| 24. Partner Introduction Status | 5 | 0 | 0 | 5 |
| **TOTAL** | **396** | **33** | **300** | **54** |

### Direction summary

| Direction | Field count | % |
|---|---|---|
| Outbound only (Capavate → Collective) | 274 | 69% |
| Inbound only (Collective → Capavate) | 22 | 6% |
| Bidirectional | 66 | 17% |
| No sync (local only) | 34 | 8% |

### Source-of-truth distribution

| SOT rule | Field count |
|---|---|
| Capavate-wins | 248 |
| Collective-wins | 82 |
| latest-wins (bidirectional) | 42 |
| merge / computed | 24 |

---

## Fields requiring special handling

### Privacy-gated (VIS-1 through VIS-10)

| Field | Rule | Handling |
|---|---|---|
| `primaryEmail`, `primaryPhone`, `registrationId`, `operatingAddresses` | VIS-1 | Strip before outbox emit |
| `contactEmail`, `contactMobile`, `countryOfTaxResidency`, `taxIdNationalId`, `kycDocuments` | VIS-1 | Never included in envelope payload |
| `firstName`, `lastName` | VIS-2 | Replace with `screenName` in all Collective payloads |
| `visible_to_co_members = false` investors | VIS-10 | Omit from cap-table shareholder lists in Collective |
| `compositeScore`, `mnaScore`, `roundScore` | VIS-4 | Omit from member-facing payloads; include only in DSC/admin payloads |
| `capTable.ledger[]`, `capTable.trace[]` | VIS-5 | Never in envelope; aggregates only |
| Dataroom `objectStoreKey` | VIS-6 | Never in envelope; metadata only |
| Soft-circle `amount` per-investor | VIS-7 | Aggregate totals only in MIM panel |
| `burnRate` (exact) | VIS-8 | Strip; send `runwayMonths` instead |
| `boardObservers`, `debtFacilities`, `activeInvestors.commitments`, `customerNames` | VIS-9 | Strip; aggregate counts only |

### Derived / computed fields

| Field | Computation | Triggered by |
|---|---|---|
| `runwayMonths` | `floor(cashBalance / burnRate)` | `burnRate` or `cashBalance` mutation |
| `founderOwnershipPct` / `investorOwnershipPct` / `poolOwnershipPct` | From cap-table engine | Every `cap_table.mutated` |
| `eligibilityScore` | Weighted sum of 5 eligibility inputs | `eligibility.recomputed` |
| `autoTier` | `compositeScore` → Watch(0-24) / Qualified(25-49) / Featured(50-74) / Priority(75-100) | `ma.intelligence_rankings` inbound |
| `aggregateSoftCircleTotal` | Sum of confirmed soft-circles | `cap_table.mutated` |
| `investorOnCapTable` flag | `round_participants.status IN ('confirmed','signed','funded')` | `cap_table.mutated` |
| `auditChain.hash` | `SHA-256(priorHash|eventId|eventType|aggregateId|occurredAt)` | Every outbound event |
| `ownershipSumCheck` | `founderPct + investorPct + poolPct = 100 ± 0.0001` | Validation before emit |

### Migration-specific special handling

| Field | Migration action |
|---|---|
| `sector = "YES"` (live data bug) | Data fix pass: join `company_profile.step1.industry` and overwrite `sector` |
| Legacy region strings (15 options) | Transform to 9-region codes per region-code transformation table above |
| `accredited_status: "Not Sure"` | → `pending` |
| Soft-circle 2-state → 10-state | `interested` → `soft_circled`; `confirmed` → `confirmed`; all other states default to `pending` |
| `phone_country` + `phone_number` → E.164 | Concatenate dial code + number; strip non-digits; prepend `+` |
| `date_of_incorporation` (DD-Month-YYYY) | Parse → ISO 8601 `YYYY-MM-DD`; extract `foundedYear` |
| `type_of_entity` free text → `entityType` enum | Normalize: "Corporation" / "Corp" → `corporation`; "Pvt Ltd" / "Private Limited" → `pvt_ltd`; "LLC" → `llc`; else → `other` |

---

## Top 10 Conflict Scenarios

| # | Scenario | Conflicting values | Resolution rule |
|---|---|---|---|
| 1 | **Founder updates `sector` in Capavate mid-DSC review; Collective cached value 6h stale** | Capavate: "Fintech & Digital Payments"; Collective: "Banking & Financial Services" | `company.profile.updated` event immediately invalidates Collective cache. **Capavate-wins**. Collective re-renders deal card on ACK. |
| 2 | **Admin sets `deal_stage_override = "Priority"` in Collective; simultaneously `eligibility.recomputed` fires and sets `auto_tier = "Qualified"`** | `auto_tier = Qualified`; `deal_stage_override = Priority` | Two separate columns — no conflict. Display logic: `if deal_stage_override then show override else show auto_tier`. Override always surfaces in UI. |
| 3 | **Investor updates `accreditedStatus` on Capavate profile Step 2 to "Accredited"; Collective KYC process simultaneously upgrades to "verified"** | Capavate: `self-cert`; Collective: `verified` (post-verification) | `accreditedStatus` SOT is **latest-wins**. Collective pushes `kyc.status_changed` notification; Capavate `investor.profile.updated` event fires on Capavate change. Higher trust level wins: `verified > self-cert > pending`. |
| 4 | **`founderOwnershipPct` drifts 0.003% between nightly reconciliation run and live Capavate cap-table** | Capavate: 62.4583%; Collective: 62.4553% | `cap_table.drift_detected` alarm fires. Admin reviews at `/admin/audit-log`. Capavate re-emits `cap_table.mutated`. **Capavate-wins**. |
| 5 | **Founder sends `round.closed` event; network timeout means Collective misses the event; Collective shows round still "open"** | Capavate: `status = closed`; Collective: `status = signing_open` | Exponential backoff retry (up to 5 attempts). Dead-letter if all fail. Admin sees in `/admin/audit-log`. Admin force-drains via `/api/admin/bridge/drain`. |
| 6 | **Investor submits soft-circle in Collective app for $50k; founder confirms $30k (partial) in Capavate** | Soft-circle amount: $50k vs. $30k confirmed | `cap_table.mutated` event from Capavate with `status = confirmed` and actual amount overrides. **Capavate-wins** on all financial amounts. |
| 7 | **Notification preferences: investor disables `round.closed` email on Collective; Capavate sends `round.closed` email anyway** | `perKindPreferences.round.closed.email = false` on Collective; Capavate still has `email_enabled = true` | Preferences are **latest-wins**. Notification preference update must propagate via `investor.profile.updated` envelope. If propagation lag exists, Collective-side preference takes precedence (Collective sends the email after checking its own preference store). |
| 8 | **`eligibilityScore` computed in Capavate at 74 (below Priority threshold); simultaneously DSC scores the company 4.8/5 in Collective** | Capavate eligibility: 74; Collective DSC: 4.8 | These are independent signals. `eligibilityScore` gates Collective membership; `dscScore` contributes to `compositeScore` for deal tier. No conflict — different fields in different schemas. |
| 9 | **Lifecycle policy `softCircleExpiryDays` updated from 14 to 30 in Capavate; in-flight soft-circles already set to expire in 7 days** | New policy: 30 days; existing records: 7 days remaining | `lifecycle_policy.changed` event propagated. Collective applies new TTL to future soft-circles only. Existing records retain their `expiresAt`. Admin can manually extend via override. |
| 10 | **Two Collective admins simultaneously approve and reject the same membership application** | `membershipStatus = accepted` (Admin A) vs. `membershipStatus = rejected` (Admin B) | Last-write-wins at DB level with optimistic locking (`version` field on `collective_memberships`). Second write fails with 409; admin sees conflict message. Audit log records both actions; senior admin resolves. |

---

*End of `capavate_collective_sync_field_map.md` — Sprint 13 source of truth*  
*Total entities: 24 · Total fields mapped: 396 · Total outbound events: 12 · Total inbound events: 4*
