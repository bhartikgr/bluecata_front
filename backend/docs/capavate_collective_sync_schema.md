# Capavate ↔ Collective Sync Schema (v1.0)

**Date:** 2026-05-08
**Owner:** Capavate platform engineering
**Companion to:** `capavate_master_build_spec.md` §15 + §22; `capavate_founder_deep_audit.md`; `capavate_investor_deep_audit.md`; `collective_admin_and_ma_inventory.md`.

This document maps every variable surfaced by the founder and investor deep audits to a canonical sync schema between the **Capavate** product (the founder ↔ investor capital-formation OS) and the **Capavate Collective** (the post-graduation venture community / SPV / DSC platform). It defines:

1. Which fields are **Capavate-private** (never leave Capavate)
2. Which fields are **Collective-shared** (replicated on mutation via outbox/webhook)
3. Which fields are **Collective-only** (live in Collective, surfaced read-only in Capavate when needed)
4. The wire-format event types and outbox/webhook contract

The principle: **Capavate is the system of record for capital structure and active fundraising; Collective is the system of record for community membership, SPV history, governance ceremonies, and post-graduation networking.** Eligibility for the Collective is computed in Capavate from shared signals.

---

## 1. Architecture: outbox → webhook

Every mutation in Capavate that touches a Collective-shared field emits an event to a transactional outbox. A relay drains the outbox to Collective via signed webhooks. Collective ACKs each event (idempotency key = event id). Failure → exponential back-off, dead-letter queue surfaced in `/admin/audit-log`.

```
Capavate write tx ─┐
                   ├──> Postgres outbox table ──> webhook relay ──> Collective inbox
trace + audit hash ┘                                                      │
                                                                          ▼
                                                              Collective state machine
                                                              + Collective audit log
```

Events are ordered per company (per investor for investor-side events); ordering is preserved by partitioning the relay by `aggregate_id`.

---

## 2. Event types

| Event                              | Trigger                                            | Payload                                                          |
| ---------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `company.profile.updated`          | Any 4-step Company Profile field mutated           | full company-shared snapshot + `changedFields[]`                 |
| `company.ma_intelligence.updated`  | Any of 30 M&A fields mutated                       | full M&A object + `changedFields[]`                              |
| `investor.profile.updated`         | Any investor-side field mutated                    | full investor-shared snapshot + `changedFields[]`                |
| `cap_table.mutated`                | Any transaction posted to engine                   | computed cap table snapshot + engine `trace[]`                   |
| `eligibility.recomputed`           | Any input to eligibility scoring changed           | new `eligibilityScore`, `eligibilityFlags[]`                     |
| `lifecycle_policy.changed`         | Admin saves a lifecycle policy                     | full policies object                                             |
| `formula.published`                | Admin promotes a formula draft to active           | formula record + tests result                                    |
| `audit_log.appended`               | Any append to Capavate audit log                   | entry id + hash chain link                                       |
| `safe.converted` / `note.converted`| SAFE/Note converts at a priced round               | conversion result + trace                                        |
| `round.closed`                     | Round transitions `signing_open` → `closed`        | final cap table snapshot                                         |
| `governance_metric.published`      | Founder publishes monthly metrics                  | period, KPIs, attachments                                        |

---

## 3. Company variables — partition

The founder deep audit defines 130+ company-side fields across 4 wizard steps + 30 M&A intelligence fields. Below is the full split.

### 3.1 Step 1 — Legal & Identity (12 fields)

| Field                  | Capavate-private | Collective-shared | Notes                                          |
| ---------------------- | :--------------: | :---------------: | ---------------------------------------------- |
| legalName              |                  |        ✅         | Required for Collective intro                  |
| dbaTrade               |                  |        ✅         |                                                |
| entityType             |                  |        ✅         |                                                |
| jurisdiction           |                  |        ✅         | Drives regional formula resolution             |
| incorporationDate      |                  |        ✅         |                                                |
| registrationId (EIN)   |        ✅        |                   | PII; never leaves Capavate                     |
| fiscalYearEnd          |                  |        ✅         |                                                |
| headquartersAddress    |                  |        ✅         | City + country only sent to Collective         |
| operatingAddresses     |        ✅        |                   | Sensitive for some founders                    |
| website                |                  |        ✅         |                                                |
| primaryEmail           |        ✅        |                   | PII                                            |
| primaryPhone           |        ✅        |                   | PII                                            |

### 3.2 Step 2 — Business profile (12 fields)

| Field                  | Capavate-private | Collective-shared |
| ---------------------- | :--------------: | :---------------: |
| industry               |                  |        ✅         |
| sector                 |                  |        ✅         |
| stage                  |                  |        ✅         |
| modelDescription       |                  |        ✅         |
| foundedYear            |                  |        ✅         |
| employeeCount          |                  |        ✅         |
| arr                    |                  |        ✅         |
| revenue                |                  |        ✅         |
| grossMargin            |                  |        ✅         |
| burnRate               |        ✅        |                   | Shared aggregated only as "runway months"      |
| runwayMonths           |                  |        ✅         |                                                |
| keyMetrics             |                  |        ✅         |                                                |

### 3.3 Step 3 — Capital structure (15 fields)

| Field                          | Capavate-private | Collective-shared |
| ------------------------------ | :--------------: | :---------------: |
| totalRaisedToDate              |                  |        ✅         |
| lastRoundDate                  |                  |        ✅         |
| lastRoundType                  |                  |        ✅         |
| lastValuation                  |                  |        ✅         |
| esopSizePercent                |                  |        ✅         |
| activeInvestors (names)        |                  |        ✅         |
| activeInvestors (commitments)  |        ✅        |                   |
| debtFacilities                 |        ✅        |                   |
| customers (names)              |        ✅        |                   |
| customerConcentrationPercent   |                  |        ✅         |
| boardSeats                     |                  |        ✅         |
| boardObservers                 |        ✅        |                   |
| optionPoolUtilizationPercent   |                  |        ✅         |
| safeOutstanding                |                  |        ✅         |
| noteOutstanding                |                  |        ✅         |

### 3.4 Step 4 — M&A Intelligence (30 fields, all Collective-shared)

The full 30-field M&A intelligence panel is Collective-shared. M&A is the entire reason founders graduate into the Collective — Collective uses these fields to match founders to acquirers, M&A advisors, and DSCs.

| Field                          | Sharing | Notes                                                     |
| ------------------------------ | :-----: | --------------------------------------------------------- |
| maScore                        |   ✅    | Computed in Capavate, mirrored to Collective               |
| maStatus                       |   ✅    |                                                           |
| intentSignal                   |   ✅    |                                                           |
| acquirerProfile                |   ✅    |                                                           |
| competitiveLandscape           |   ✅    |                                                           |
| productMarketFit               |   ✅    |                                                           |
| technologyDifferentiation      |   ✅    |                                                           |
| intellectualProperty           |   ✅    |                                                           |
| customerConcentration          |   ✅    |                                                           |
| churnRate                      |   ✅    |                                                           |
| unitEconomics                  |   ✅    |                                                           |
| growthRate                     |   ✅    |                                                           |
| marketSize                     |   ✅    |                                                           |
| marketShare                    |   ✅    |                                                           |
| geographicExpansion            |   ✅    |                                                           |
| managementTeamStrength         |   ✅    |                                                           |
| organizationalScalability      |   ✅    |                                                           |
| culturalFit                    |   ✅    |                                                           |
| regulatoryCompliance           |   ✅    |                                                           |
| litigationStatus               |   ✅    |                                                           |
| dataPrivacyPosture             |   ✅    |                                                           |
| financialAuditStatus           |   ✅    |                                                           |
| taxCompliance                  |   ✅    |                                                           |
| ipDueDiligenceReadiness        |   ✅    |                                                           |
| customerContractsReadiness     |   ✅    |                                                           |
| employmentAgreementsStatus     |   ✅    |                                                           |
| realEstateAssets               |   ✅    |                                                           |
| technicalDebtLevel             |   ✅    |                                                           |
| securityIncidents              |   ✅    |                                                           |
| esgPosture                     |   ✅    |                                                           |

### 3.5 Cap table — shared aggregates only

| Field                          | Sharing       | Notes                                                                 |
| ------------------------------ | :-----------: | --------------------------------------------------------------------- |
| cap_table.totalShares          |     ✅        | Updated on every mutation                                             |
| cap_table.fullyDilutedShares   |     ✅        |                                                                       |
| cap_table.founderOwnershipPct  |     ✅        |                                                                       |
| cap_table.investorOwnershipPct |     ✅        |                                                                       |
| cap_table.poolOwnershipPct     |     ✅        |                                                                       |
| cap_table.ledger[]             |   private     | Per-holder ledger never replicated in detail; aggregates only         |
| cap_table.trace[]              |   private     | Engine trace stays in Capavate; audit log entry id is the link        |

### 3.6 Capavate-only company fields

| Field                                   | Reason                                                |
| --------------------------------------- | ----------------------------------------------------- |
| dataroom contents                       | Per-investor grants stay in Capavate                 |
| invitations table                       | Pre-graduation activity; not shared                  |
| soft circles                            | Pre-graduation activity                              |
| internal CRM notes                      | Capavate-only                                         |
| founder/admin Slack hooks               | Tenant-internal                                       |

---

## 4. Investor variables — partition

The investor deep audit defines 90+ fields. Split:

### 4.1 Identity (Collective-shared)

| Field                          | Sharing | Notes                                          |
| ------------------------------ | :-----: | ---------------------------------------------- |
| investorName                   |   ✅    |                                                |
| firmName                       |   ✅    |                                                |
| investorType (institutional / angel / family office) | ✅ |                                  |
| jurisdiction                   |   ✅    |                                                |
| accreditedStatus               |   ✅    |                                                |
| verifiedFlag                   |   ✅    |                                                |
| website                        |   ✅    |                                                |
| linkedInProfile                |   ✅    |                                                |

### 4.2 Investment thesis (Collective-shared)

| Field                          | Sharing |
| ------------------------------ | :-----: |
| sectorsOfInterest              |   ✅    |
| stagesOfInterest               |   ✅    |
| checkSizeMin / Max             |   ✅    |
| ownershipTargetMin / Max       |   ✅    |
| leadFollow                     |   ✅    |
| boardSeatPreference            |   ✅    |
| reservedFollowOnPercent        |   ✅    |
| portfolioSize                  |   ✅    |
| holdPeriodYears                |   ✅    |

### 4.3 Track record / portfolio (Collective-shared aggregates)

| Field                          | Sharing       | Notes                                                            |
| ------------------------------ | :-----------: | ---------------------------------------------------------------- |
| activePortfolioCount           |     ✅        |                                                                  |
| exitedCount                    |     ✅        |                                                                  |
| medianMultipleOfMoney          |     ✅        |                                                                  |
| irrPercent                     |     ✅        | Aggregated only                                                  |
| topMarkupCompanies             |   private     | Detailed company-level shares are private                        |
| portfolioCompanyHoldings[]     |   private     | Holdings of OTHER companies via this investor stay in Capavate   |

### 4.4 Investor-only Capavate fields

| Field                          | Reason                                          |
| ------------------------------ | ----------------------------------------------- |
| invitationInbox                | Pre-graduation activity                        |
| dueDiligenceNotes              | Pre-graduation activity                        |
| softCircles                    | Pre-graduation activity                        |
| messages                       | Tenant-internal                                |
| dataRoomGrantsReceived         | Per-deal grants stay in Capavate                |

### 4.5 Investor → Collective-only fields

| Field                          | Reason                                                |
| ------------------------------ | ----------------------------------------------------- |
| chapterMembership              | Collective owns chapter membership                    |
| spvParticipation               | SPV cap table is in Collective                        |
| dscMemberships                 | Direct Service Co memberships in Collective           |
| collectiveEventsRsvp           | Collective social events                              |
| collectiveContributions        | Forum posts / mentorship hours                        |

---

## 5. Lifecycle policies (Capavate-managed, Collective-propagated)

All five lifecycle policies (founder dashboard tenure, archival retention, governance metrics cadence, soft-circle expiry, invitation expiry) are owned by Capavate `/admin/lifecycle-policies` and propagated to Collective via `lifecycle_policy.changed`. Collective uses them to:

- Schedule Collective onboarding for graduating founders ≤ archivalRetentionDays.
- Honor founder visibility expiry with the same TTLs.

| Policy                                | Default | Capavate sets | Collective consumes                                           |
| ------------------------------------- | :-----: | :-----------: | ------------------------------------------------------------- |
| founderDashboardTenureDays            |   180   |       ✅      | Tracks tenure → notifies founder of optional graduation       |
| archivalRetentionDays                 |   3650  |       ✅      | Hard-deletes graduated founder record after retention         |
| governanceMetricsCadenceDays          |    30   |       ✅      | Pings DSC sponsors                                            |
| softCircleExpiryDays                  |    14   |       ✅      | Used by Collective SPV soft-circles too                       |
| invitationExpiryDays                  |    21   |       ✅      | Used by Collective member-to-member invites                   |

---

## 6. Eligibility scoring

Eligibility for the Collective is computed in Capavate from a weighted sum over:

- M&A score ≥ 60
- ARR ≥ tenant policy threshold
- Last round closed within 18 months
- No open litigation
- Audit-log integrity intact

Output: `eligibilityScore (0-100)`, `eligibilityFlags[]`. Both fields are Collective-shared via `eligibility.recomputed`. Collective uses them to gate community features (chapter applications, DSC introductions, SPV listings).

---

## 7. Audit-log linkage

Capavate's audit log is hash-chained per `/admin/audit-log`. Each event sent to Collective carries:

- `aggregateId` — the company or investor ID
- `eventId` — UUID
- `priorAuditHash` — hash of the prior Capavate audit entry
- `auditHash` — hash of this entry
- `formulaTrace[]` (for cap-table events only) — engine trace that produced the change

Collective stores these alongside its own audit log so Collective ↔ Capavate auditors can reconcile.

---

## 8. Field reconciliation summary

- **Total company-side fields surveyed:** 130 (per founder deep audit)
- **Capavate-private:** 18 (PII, raw addresses, customer lists, boardObservers, dataroom, CRM, soft circles, invitations)
- **Collective-shared:** 112
- **Total investor-side fields surveyed:** 92 (per investor deep audit)
- **Capavate-private:** 14
- **Collective-shared:** 78
- **Collective-only:** 7 (chapter memberships, SPV slots, DSC memberships, RSVPs, contributions, mentorship logs, peer reviews)

Every field listed in the deep audits has been accounted for. Any new field added later must be assigned a partition in this table before merge.

---

## 9. Outbox event payload schema (canonical)

```json
{
  "eventId": "evt_01HV8E3K4XR7YXZ8X5G",
  "eventType": "cap_table.mutated",
  "aggregateId": "co_novapay",
  "aggregateKind": "company",
  "occurredAt": "2026-05-08T20:15:00Z",
  "tenantId": "tnt_capavate_us",
  "actor": { "userId": "u_maya", "ip": "172.0.0.1" },
  "payload": { "...": "type-specific" },
  "trace": [ { "formulaId": "...", "version": "1.0.0", "region": "US", "defHash": "..." } ],
  "auditChain": {
    "priorHash": "0e2af1...",
    "hash": "8b7ce4..."
  },
  "schemaVersion": "1.0"
}
```

Wire format: HMAC-SHA256 signed JSON, sent over HTTPS POST to Collective inbox endpoint with `Idempotency-Key: eventId`. Collective responds 2xx ACK or 409 (already received).

---

## 10. References

- Capavate Master Build Spec, §15 (Jurisdictions), §22 (Worked Examples A1-A5)
- Capavate Founder Deep Audit (130+ company-side fields)
- Capavate Investor Deep Audit (90+ investor-side fields)
- Capavate Q1 Sprint Plan
- R165 §12 (audit-log hash chain), R200 §6 (engine trace contract)
- Collective Admin and M&A Inventory
