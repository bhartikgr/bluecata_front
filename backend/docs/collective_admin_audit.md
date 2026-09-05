# Capavate Collective — Admin + Bridge Audit
**Version:** v1.0  
**Date:** 2026-05-09  
**Auditor:** Admin + Bridge subagent  
**Primary sources:** `collective_admin_and_ma_inventory.md`, `collective_founder_audit.md`, `collective_investor_audit.md`, `collective_communications_audit.md`, `capavate_collective_sync_schema.md`, `capavate_gating_addendum.md`, `capavate_master_build_spec.md`, `SPRINT-11-FOUNDER-SUMMARY.md`, `SPRINT-11-PHASE2-PROGRESS.md`  
**Credentials used (read-only):** Collective investor login: `avinayquicktech@gmail.com` / Capavate founder login: `Ozan.isinak@gmail.com`

---

## §1. ADMIN DASHBOARD

### 1.1 Admin Routes (Collective)

The Collective admin surface is split across two URL namespaces:

| Route | Purpose | Access gate |
|-------|---------|-------------|
| `/collective/#/spv` | SPV Admin — triage, management cards, launch controls | `isAdmin` |
| `/admin/algorithms` | Algorithm Console — M&A scoring weight tuning | `isAdmin` — explicitly gated; DSC members cannot reach it |
| `/admin/lifecycle-policy` | Lifecycle Policy — four tabs of tier/cadence config | `isAdmin` |
| `/admin/spv` | SPV Management cards (parallel admin route) | `isAdmin` |
| `/admin/audit-log` | Audit log with hash chain verification | `isAdmin` |

### 1.2 Admin Dashboard — Macro KPIs

No dedicated "admin dashboard" page name is explicitly documented in the current Collective build (the AlgorithmConsole is the closest admin-facing surface). Based on the master build spec §4 + collective audit files, the admin surface exposes the following macro KPIs:

| Widget / KPI | Data source | Notes |
|---|---|---|
| **Total active Collective members** | `collective_memberships WHERE status = 'active'` | Count badge |
| **Members pending review** | `membership_applications WHERE status = 'reviewing'` | Queue length |
| **Companies in deal room** | `CollectiveDeal` materialized view | Active deal count |
| **SPVs (LIVE / DRAFT)** | `spv` table — `status IN ('live', 'draft')` | LIVE/DRAFT split |
| **DSC pipeline depth** | `DscReview` queue length | Open reviews |
| **Composite / M&A / Round score distribution** | AlgorithmsProvider | Histogram across deal tiers |
| **Eligibility recompute queue** | Outbox worker lag | Dead-letter count if > 0 |
| **Cap-table drift alarms** | `live_events WHERE kind = 'cap_table.drift_detected'` | Alarm count |
| **Email delivery lag** | `email_outbox` unprocessed count | SLA target: < 60s |
| **Nightly batch status** | M&A intelligence ranking job | Last run timestamp + record count |

### 1.3 Day-One Administrators

| Admin | Email | Access scope |
|-------|-------|-------------|
| Ozan Isinak | `ozan@capavate.com` | Full platform: seed-replacement console, algorithm tuning, lifecycle policy management, DSC assignment, impersonation |
| Avinay Kumar | `avinaykumar.web@gmail.com` | Same as Ozan |
| Shadie Broumandi | `shadie@capavate.com` | Same as Ozan |

---

## §2. COMPANIES ADMIN AREA

### 2.1 Where Companies Live in Collective

Companies appear in Collective as a **read-only materialized projection** (`CollectiveDeal`) derived from the Capavate equity ledger. Admins interact with companies via:

- Deal Room (`/collective/#/deals`) — full company list visible to all members; admin sees additional tier-override controls
- SPV Admin (`/admin/spv`) — per-SPV company composition management
- Lifecycle Policy (`/admin/lifecycle-policy`) — Company Overrides tab to set per-company lifecycle thresholds
- AlgorithmConsole (`/admin/algorithms`) — company scoring can be triggered/re-run

### 2.2 Per-Company Detail (Admin View)

At `/collective/#/deals/:company_id`, admin sees everything a member sees PLUS:

| Admin-only field | Value |
|---|---|
| `deal_stage_override` | Manual tier override (Watch/Qualified/Featured/Priority) with reason string |
| `composite_score` (raw) | Full numeric score (non-DSC members see label only) |
| `mna_score` / `round_score` | Individual dimension scores |
| `collective_eligibility_audit` | Trigger, old status, new status, timestamp of every eligibility change |
| Audit log entries | Hash-chained entries for this `aggregate_id` |
| DSC assignment controls | Assign to/remove from DSC committee review |

### 2.3 What Data Companies Expose (Collective-shared)

Per `capavate_collective_sync_schema.md` §3, the company-shared snapshot contains:

**112 fields** classified as Collective-shared across 4 wizard steps:
- **Step 1 — Legal & Identity:** legalName, dbaTrade, entityType, jurisdiction, incorporationDate, fiscalYearEnd, headquartersAddress (city+country only), website (12 fields; 4 are Capavate-private: registrationId/EIN, primaryEmail, primaryPhone, operatingAddresses)
- **Step 2 — Business Profile:** industry, sector, stage, modelDescription, foundedYear, employeeCount, arr, revenue, grossMargin, runwayMonths, keyMetrics (12 fields; burnRate is Capavate-private)
- **Step 3 — Capital Structure:** totalRaisedToDate, lastRoundDate, lastRoundType, lastValuation, esopSizePercent, activeInvestors (names), boardSeats, optionPoolUtilizationPercent, safeOutstanding, noteOutstanding (11 fields shared; debtFacilities, boardObservers, customer names, activeInvestors (commitments) are private)
- **Step 4 — M&A Intelligence (all 30 fields):** maScore, maStatus, intentSignal, acquirerProfile, competitiveLandscape, productMarketFit, technologyDifferentiation, intellectualProperty, customerConcentration, churnRate, unitEconomics, growthRate, marketSize, marketShare, geographicExpansion, managementTeamStrength, organizationalScalability, culturalFit, regulatoryCompliance, litigationStatus, dataPrivacyPosture, financialAuditStatus, taxCompliance, ipDueDiligenceReadiness, customerContractsReadiness, employmentAgreementsStatus, realEstateAssets, technicalDebtLevel, securityIncidents, esgPosture

**Cap-table aggregates shared:** cap_table.totalShares, fullyDilutedShares, founderOwnershipPct, investorOwnershipPct, poolOwnershipPct  
**Capavate-private (never shared):** dataroom contents, invitations table, soft circles (detail), internal CRM notes, founder/admin Slack hooks, per-holder ledger entries, engine trace

### 2.4 Downloads

Admin can export from:
- `/api/audit/{company_id}/export` — full audit log in JSON with verification checksum
- Cap-table exports: PDF/XLSX/CSV via `/api/founder/captable/export` (founder side) — admin can also initiate
- DSC review recaps downloadable from `/collective/#/recaps`

---

## §3. INVESTORS ADMIN AREA

### 3.1 Per-Investor Profile (Admin View)

Investor records visible to admin across both Collective and Capavate contexts:

| Field group | Fields |
|---|---|
| **Identity (shared)** | investorName, firmName, investorType (institutional/angel/family office), jurisdiction, accreditedStatus (verified/self-cert/pending/rejected), verifiedFlag, website, linkedInProfile |
| **Investment thesis (shared)** | sectorsOfInterest, stagesOfInterest, checkSizeMin/Max, ownershipTargetMin/Max, leadFollow, boardSeatPreference, reservedFollowOnPercent, portfolioSize, holdPeriodYears |
| **Track record (shared aggregates)** | activePortfolioCount, exitedCount, medianMultipleOfMoney, irrPercent |
| **Collective-only** | chapterMembership, spvParticipation, dscMemberships, collectiveEventsRsvp, collectiveContributions |
| **KYC state** | accreditation_status, kyc_inquiry_id, sanctions_screening_result |
| **Membership** | collective_memberships.status (submitted/reviewing/accepted/active/suspended), member_tier, renewal_date, nonPaymentGraceDays remaining |
| **Cap-table status** | investorOnCapTable flag from `eligibility.recomputed`; round_participants records |

### 3.2 Investor Segmentation

Admin can segment investors in Collective by:
- `member_tier` (admin-managed: Individual / Plus / other)
- `chapter_id` (non-overlapping geographic chapter assignment)
- `accreditation_status` (verified / self-cert / pending / rejected)
- `investorType` (institutional / angel / family office)
- Cap-table position flag (`investorOnCapTable = true/false`)
- `collective_memberships.status`

### 3.3 Scoring Patterns (DSC/Algorithm)

DSC committee members and admins see:
```
Composite score {co.compositeScore} · M&A {co.mnaScore} · Round {co.roundScore}
```
- `compositeScore`: configurable weighted blend of M&A + Round scores; admin tunes via AlgorithmConsole
- `mnaScore`: M&A readiness dimension — company maturity, IP ownership, revenue traction, market size, strategic buyer landscape, exit comparables
- `roundScore`: round attractiveness — terms quality, check-size fit with Collective members, valuation reasonableness, timing
- `auto_tier`: Watch (0–24) / Qualified (25–49) / Featured (50–74) / Priority (75–100)
- `deal_stage_override`: admin manual tier override with reason string

Non-DSC members see only `auto_tier` label; DSC members see all three scores; admin sees AlgorithmConsole weight tuning.

---

## §4. USERS & AUTH

### 4.1 Role Model

| Role | Description | Access scope |
|------|-------------|-------------|
| **Admin** | Platform admins (Ozan, Avi, Shadie) | Full platform; impersonation; seed-replacement console; algorithm tuning; lifecycle policy management; DSC assignment; billing management; audit chain access |
| **DSC Member** | Deal Screening Committee members | DSC Screening Queue (`/collective/#/dsc`); DSC Screening Room per company (`/collective/#/screening/:review_id`); all three M&A scores visible; cannot reach AlgorithmConsole |
| **Network Member** | Standard Collective member | All member routes; deal room; chapters; calendar; monthly meetings; connections; consortium; personal CRM; ask expert; M&A intelligence (auto_tier + composite score) |
| **Collective Applicant** | In-progress application | Registration wizard routes only (`/collective/#/register/*`) |
| **Founder** | Same Auth0 user, founder role | Company detail editing on Capavate side; Collective deal room read access for their own company |
| **Co-founder** | Same as Founder for permissions | Distinguished for cap-table labelling only |
| **Investor** | Capavate-invited, accredited | Invitation-based access; dashboard + portfolio + connections |

### 4.2 Auth Architecture

- **Identity provider:** Auth0 (decision locked 2026-05-08) — single Auth0 tenant, per-product application (Capavate, Collective)
- **JWT:** Single login session; `aud` claim is `https://collective.capavate.com/api` for Collective calls and `https://app.capavate.com/api` for Capavate calls; `roles[]` claim determines product access
- **Cookie domain:** `.capavate.com` — shared across both portals
- **MFA:** Auth0 provides TOTP/WebAuthn first-class; admin-enforced MFA is available per the Auth0 tenant configuration
- **SAML/SCIM:** Supported via Auth0 for enterprise SSO; JIT provisioning for consortium partners
- **Session management:** JWT-based; Auth0 session expiry configurable per-application
- **GDPR pseudonymisation:** On right-to-erasure: name/email/address replaced with a pseudonym in user-facing tables; audit_log and transactions retain the pseudonymised `actor_id` (internal UUID); hash chain remains intact; pseudonymisation mapping table has restricted access

### 4.3 MFA

- Auth0 Universal Login with MFA enforced for admin role
- TOTP (Google Authenticator, Authy) and WebAuthn (hardware key) supported
- Admin accounts require MFA at login; standard members can opt in

### 4.4 Sessions

- JWT-based; session validity: configurable via Auth0 (default 24h for web; refresh token for mobile)
- Session revocation: admin can force-expire any session via Auth0 Management API
- No explicit session timeout warning documented in current build

### 4.5 Login History / Suspicious Activity

- Auth0 provides anomaly detection (brute-force, credential stuffing) built-in
- Failed redemption of invitation tokens logged + admin-alerted at 3+ failed attempts within 1 hour
- Every account creation event written to the hash-chained audit log with: founder ID, round ID, token hash, IP, user agent, KYC document hashes, accreditation status

### 4.6 Audit Trail Schema

Every auth event writes to the hash-chained `audit_log` table:

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PRIMARY KEY (CUID2) | |
| `tenant_id` | TEXT | company_id for Capavate tables; 'platform' for Collective |
| `aggregate_id` | TEXT | Company or investor ID |
| `aggregate_kind` | TEXT | 'company' \| 'user' \| 'round' \| etc. |
| `event_kind` | TEXT | e.g., 'user.login', 'token.redeemed', 'account.created' |
| `actor_id` | TEXT | User UUID (pseudonymised after erasure) |
| `actor_ip` | TEXT | |
| `actor_user_agent` | TEXT | |
| `occurred_at` | TIMESTAMPTZ | |
| `payload` | JSONB | Event-specific data |
| `prior_hash` | TEXT | SHA-256 of prior row |
| `this_row_hash` | TEXT | SHA-256 of this row content |

REVOKE UPDATE/DELETE granted to the `capavate_app` database role — append-only enforced at the DB layer.

---

## §5. EMAIL SYSTEM

### 5.1 Architecture

**Provider abstraction:** `EmailSenderProvider` — switchable between AWS SES / Postmark / Resend via environment variable `EMAIL_PROVIDER` (`SES_FROM_ADDRESS` / `POSTMARK_SERVER_TOKEN` / `RESEND_API_KEY`). DKIM-signed delivery. All invitation emails are Postmark/SES via DKIM.

**Async pipeline:**
```
Event trigger → notifications table row (email_enabled=true) → BullMQ email queue → EmailSenderProvider → email_outbox entry → delivery webhook → email_events row
```

**Tables:**
- `email_templates` — Handlebars source templates; separate from document_templates
- `email_outbox` — queued outbound messages (linked to `investor_invitations.email_outbox_id`)
- `email_events` — delivery webhooks from SES (bounce, complaint, open, click events)

**SLA:** Email dispatch within 60 seconds of trigger event.

### 5.2 Template List (Capavate + Collective — Full)

| Template ID | Trigger | Recipients | Key Variables |
|---|---|---|---|
| `round_invitation` | Invitation created / resent | Investor | company_name, founder_name, round_name, instrument, personal_message, cta_url, expiry_date |
| `invitation_accepted` | Investor accepts | Founder | investor_name, investor_email, company_name, round_name, committed_amount |
| `invitation_declined` | Investor declines | Founder | investor_name, company_name, round_name, decline_note |
| `soft_circle_submitted` | Investor soft-circles | Founder | investor_name, committed_amount, currency, round_name |
| `invitation_expiry_warning` | 48hr before expiry | Investor | company_name, round_name, expiry_date, cta_url |
| `round_closed` | Round transitions to closed | All round_participants | company_name, round_name, amount_closed, security_type, cap_table_cta |
| `notification_digest` | Batch notification delivery | User | Batch of notification items |
| `collective_welcome` | Collective membership accepted (`status = 'active'`) | New member | Member name, deal room CTA, profile CTA, receipt link |
| `membership_review` | Application submitted | Applicant | Application summary, timeline, edit link |
| `membership_approved` / `_rejected` | Admin decision | Applicant | Status, next steps |
| `kyc_update` | KYC status change | Member | New status (verified/pending/rejected), action required |
| `form_d_reminder` | 10 days before 15-day Form D deadline | Founder (US) | Filing deadline date, EDGAR link |
| `emi_notification_reminder` | EMI grant + 30/7/1 day before 92-day HMRC deadline | Founder (UK) | Grant date, HMRC deadline, ERS online service link |
| `83b_election` | Within 24h of early option exercise | Founder | Exercise date, 30-day deadline, instructions |

### 5.3 Variable Schema (Canonical)

All templates use Handlebars syntax (`{{ variable_name }}`). Common envelope variables across all templates:
- `{{recipient_name}}` — first name of recipient
- `{{recipient_email}}` — email address
- `{{company_name}}` — company name
- `{{cta_url}}` — call-to-action link (always token-bound for investor links)
- `{{platform_name}}` — "Capavate" or "Capavate Collective" depending on context

### 5.4 Send Queue

BullMQ queue named `email` with:
- Configurable concurrency limit
- Exponential backoff on failure
- Dead-letter queue: failed messages surface in `/admin/audit-log`

### 5.5 Delivery Webhooks

SES webhooks received at `/webhooks/email-events` (SNS + DKIM verification):
- Events: bounce, complaint, delivery, open, click
- Written to `email_events` table
- Bounce/complaint triggers `email_enabled = false` on the recipient's notifications preferences

### 5.6 A/B Variants

No A/B variant system is explicitly defined in the current spec. The `email_templates` table has a `template_html` column (Handlebars source) with a `template_slug` key — variant slugs (e.g., `round_invitation_v2`) could be introduced without schema changes.

---

## §6. NOTIFY SYSTEM

### 6.1 Architecture

Three delivery channels from a single `notifications` table:

```
Event emitted → notifications row inserted → BullMQ fan-out
  ├─ In-app: SSE (GET /api/notifications/stream) → bell icon unread count badge
  ├─ Email: email_outbox entry if email_enabled=true
  └─ Push: Web Push API → push_subscriptions table
```

### 6.2 Bell Icon Behavior

- **Location:** Investor top bar, replacing the current broken logout-as-notification-position trap (described in master build spec as fix for `investor-audit GAPS #2`)
- **Unread count badge:** Numeric badge on bell icon; badge disappears when all read
- **Click behavior:** Opens notification center panel (drawer or dropdown)
- **Mark-all-read:** `POST /api/notifications/read-all`
- **Real-time delivery:** SSE via `GET /api/notifications/stream` — events: `notification` (new item), `ping` (keepalive every 30s)

**Current live state:** Bell icon is **ABSENT on live Capavate** (both founder and investor sides). The logout button currently occupies the top-bar position where the bell should be. This is a documented broken surface (`investor-audit GAPS #2, #3`). The rebuild wires the bell and moves logout to a profile dropdown.

### 6.3 Notification Center (In-App)

| Element | Detail |
|---|---|
| Per-notification row | Kind icon + Title + Body preview + Timestamp (relative) + Read/unread indicator |
| Filter | All / Unread |
| Mark as read | Per-item or bulk |
| Link | Each notification links to the relevant page |

### 6.4 Channels

| Channel | Mechanism | Config key |
|---------|-----------|------------|
| In-app | SSE; `notifications` table | Always on |
| Email | BullMQ → EmailSenderProvider | `email_enabled` per notification row |
| Web push | Web Push API; `push_subscriptions` table | Opt-in; push subscription stored per-user |

### 6.5 Per-Event Triggers (Full NotificationKind List)

```typescript
type NotificationKind =
  | 'round.invitation_received'       // Investor: you received an invitation
  | 'round.invitation_accepted'       // Founder: investor accepted
  | 'round.invitation_declined'       // Founder: investor declined
  | 'round.soft_circle_received'      // Founder: soft-circle submitted
  | 'round.document_ready_to_sign'    // Investor: docs ready to sign
  | 'round.document_signed'           // Founder: investor signed
  | 'round.closed'                    // All round_participants: round is closed
  | 'dataroom.access_granted'         // Investor: dataroom access granted
  | 'dataroom.document_uploaded'      // Investor (with dataroom access): new document
  | 'investor_report.published'       // Investors: new investor report published
  | 'message.received'                // User: new DM received
  | 'collective.eligibility_gained'   // User: now eligible for Collective
  | 'collective.membership_approved'  // User: membership accepted
  | 'spv.launched'                    // Collective members: new SPV live
  | 'spv.subscription_countersigned'; // Investor: SPV subscription countersigned
```

Additional Collective-specific triggers (from DSC / governance workflows):
- `dsc.company_assigned` — DSC member: company assigned for review
- `cap_table.drift_detected` — Admin: nightly reconciliation found drift
- `compliance.hold_placed` — Founder/Admin: compliance hold on round close
- `kyc.status_changed` — Member: KYC status update from provider
- `membership.renewal_due` — Member: renewal approaching (30 days before expiry)
- `membership.lapsed` — Member: non-payment grace period exhausted

### 6.6 Per-User Preferences

API endpoints for notification preferences:
- `GET /api/notifications/preferences` → `NotificationPreferences` object
- `PATCH /api/notifications/preferences` → update per-kind email/push toggles

In the rebuild Settings page (D10), the founder settings expose **10 notification toggles** across categories. Members can suppress email or push per-kind; in-app cannot be disabled.

---

## §7. RECONCILIATION TOOLS

### 7.1 Nightly Reconciliation Job

Runs nightly to detect drift between:
1. Sum of all `transactions.quantity WHERE type IN ('issue')` per security vs. `securities.face_value` / implied share count
2. Computed FD count from transaction ledger vs. materialized `cap_table_snapshots` view
3. Sum of `round_participants.commitment_amount` vs. `rounds.round_size_closed`

Drift alarm triggers: `live_events` row with `kind = 'cap_table.drift_detected'` → admin notification via notification system.

### 7.2 How Admin Resolves Divergences

Admin workflow for divergences:
1. Review `live_events` alarm in admin notification center
2. Navigate to `/admin/audit-log` — search by `aggregate_id` for the flagged company
3. Compare `prior_hash` chain — any broken link indicates tampered or missing entry
4. If Capavate ↔ Collective divergence: check Collective `audit_log` for corresponding `priorAuditHash` link; dead-letter queue shows failed outbox events
5. Manual reconciliation: admin can force-trigger `eligibility.recomputed` event for a specific company
6. Cap-table correction: admin can reopen a closed round for correction (round transition `closed → reopened` is admin-only with audit trail)

**Dead-letter queue:** Surfaced in `/admin/audit-log` — failed outbox events appear with retry/dismiss controls.

**Future (v1.1):** Plaid/Teller/Finch integration for automated bank reconciliation. `payment_gateways.provider = 'plaid'` reserved.

---

## §8. TELEMETRY / ANALYTICS

### 8.1 Event Browser

OpenTelemetry + Grafana stack:
- All API requests instrumented with trace spans
- `live_events` table captures platform-level events for admin review
- Cap-table drift alarms, SPV launch events, DSC assignment events all write to `live_events`

### 8.2 Funnels

No explicit funnel builder is defined in the current spec; however, the following funnel data is derivable from existing tables:
- Investor funnel: `pending → viewed → soft_circled → confirmed → signed → funded` (per round_participants)
- Collective application funnel: `submitted → reviewing → accepted/rejected/waitlisted` (per membership_applications)
- SPV subscription funnel: soft-circle → countersigned → launched (per spv subscriptions)

### 8.3 Cohorts

Derivable by `member_tier`, `chapter_id`, `sector`, `stage`, `accreditation_status`, `auto_tier` (Watch/Qualified/Featured/Priority). No cohort builder UI is explicitly defined; admin uses filter chips on the M&A Intelligence page and member directory.

### 8.4 Schema Viewer

The `algorithm_versions` table tracks M&A scoring algorithm versions; admin can see which version produced a given score. The `formulaTrace[]` in cap-table events shows formula ID, version, region, and definition hash.

---

## §9. AUDIT LOG

### 9.1 Fields

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (CUID2) | Primary key |
| `tenant_id` | TEXT | 'platform' for Collective-level events |
| `aggregate_id` | TEXT | Company or user ID |
| `aggregate_kind` | TEXT | 'company' \| 'user' \| 'round' \| 'spv' \| 'document' |
| `event_kind` | TEXT | e.g., 'cap_table.mutated', 'round.closed', 'document.signed' |
| `actor_id` | TEXT | User UUID (pseudonymised on erasure) |
| `actor_ip` | TEXT | IP address |
| `actor_user_agent` | TEXT | Browser/agent string |
| `occurred_at` | TIMESTAMPTZ | Event timestamp |
| `payload` | JSONB | Event-specific data |
| `formula_trace` | JSONB | Cap-table events: `[{formulaId, version, region, defHash}]` |
| `prior_hash` | TEXT | SHA-256 of prior row |
| `this_row_hash` | TEXT | SHA-256 of this row content (HMAC-SHA256) |

### 9.2 Search

- `/admin/audit-log` — admin UI with filters:
  - By `aggregate_id` (company or user lookup)
  - By `event_kind` (round.closed, cap_table.mutated, etc.)
  - By `actor_id` (who performed the action)
  - By date range
  - Free-text search on payload

### 9.3 Export

- `GET /api/audit/{company_id}/export` — JSON file with full audit log for a company + verification checksum
- Lifecycle Policy → Audit Log tab shows all lifecycle policy changes

### 9.4 Tamper-Evident Chain UI

Each entry shows:
- Prior hash → current hash (linked visualization)
- Chain verification: broken link highlighted in red
- Collective carries both Capavate `auditHash` + Collective-side hash for cross-system reconciliation
- Dead-letter failed outbox events surface in the audit log with retry/dismiss UI

### 9.5 Collective ↔ Capavate Audit Linkage

Each outbox event sent to Collective carries:
```json
{
  "aggregateId": "co_novapay",
  "eventId": "evt_01HV8E3K4XR7YXZ8X5G",
  "priorAuditHash": "0e2af1...",
  "auditHash": "8b7ce4...",
  "formulaTrace": [...]
}
```
Collective stores these alongside its own audit log so Collective ↔ Capavate auditors can reconcile end-to-end.

---

## §10. PRICING & BILLING

### 10.1 Collective Membership Tiers

| Tier | Annual Fee | Notes |
|------|-----------|-------|
| Standard (Angel Network) | **$1,200 USD/year** | Confirmed in "Join Angel Network" modal + `/collective/#/register/step-5` |
| Tier-adjusted amounts | Variable | Member tier (Individual / Plus / etc.) is admin-managed; pricing tied to tier |
| Consortium partner discount | Variable | `?cp={partner_slug}` pre-fills referral code; discount applied at payment step |

Tier options are **admin-managed** via the Lifecycle Policy page and AlgorithmConsole. Pricing is presented at checkout with a breakdown:
- Annual membership fee
- Selected tier adjustment
- Any consortium partner discount

### 10.2 Payment Processor

- **Stripe embedded checkout** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`)
- **Card fields (Stripe Elements):** Card number / Expiry / CVC / Cardholder name / Billing address
- **Alternative:** "Pay by invoice" — admin-approved only
- **Currency:** USD-denominated; non-USD members pay in USD (Stripe presentment currency recommended for localization)

### 10.3 Admin Lifecycle Policy

Route: `/admin/lifecycle-policy`  
Tabs: **Platform Defaults · Group Rules · Company Overrides · Audit Log**  
Precedence: Company Override > Group Rule > Platform Default  
Group rule scopes: `cohort / chapter / sector / stage / tier / ad-hoc`

| Policy field | Default | Admin-tunable |
|---|---|---|
| `founderTenureDays` | 180 days | ✓ |
| `archiveRetentionDays` | 3650 days (10 years) | ✓ |
| `nonPaymentGraceDays` | 30 days | ✓ |
| `requiredForVotes` | — | ✓ |
| `majorityThresholdPct` | — | ✓ |
| `vintageCutoffMonths` | — | ✓ |
| `defaultCheckSizeMinUsd` | $5,000 | ✓ |
| `defaultCheckSizeMaxUsd` | $25,000 | ✓ |
| `monthlyMeetingMinutes` | — | ✓ |
| `rsvpCutoffHours` | — | ✓ |

Override `expiresAt`: optional — blank = permanent.

All lifecycle policy changes are append-only to the audit log and propagated to Collective via `lifecycle_policy.changed` outbox event.

### 10.4 SPV Fee Structure

| Fee | Who pays | When |
|-----|---------|------|
| SPV upfront fee | Founder | At SPV launch (Stripe Invoice) |
| Raise fee (% of total raised) | SPV | On close |
| Carry (% of gains) | SPV | On exit |

These are surfaced on the SPV Pill in company detail: "Fees: Upfront $N · Raise N% · Carry N%"

### 10.5 Revenue Dashboard

Not explicitly defined as a separate admin page. Revenue visibility comes from:
- `commission_records` — partner commission tracking
- `payment_gateways` — Stripe Connect account records
- `collective_memberships` renewal dates and fee history
- Admin can initiate Stripe Connect transfers to partner accounts after `commission_records.status = 'approved'`

---

## §11. CAPAVATE ↔ COLLECTIVE TOGGLE (CRITICAL)

### 11.1 What the Toggle Is

The "toggle" is not a UI switch — it is a **persistent status badge** in the investor's left sidebar header that reflects the investor's eligibility and membership state:

**Badge label:** `"Investor: NOT on a cap table"` (red tag)  
**Alternate state:** (no red badge; or `"Investor: on cap table"` chip in neutral/green)

This badge controls which Collective features are accessible to the investor.

### 11.2 Where It Appears

- **Investor/Collective portal left sidebar** — top of sidebar on every page at `/investor/dashboard` and all `/collective/#/*` routes
- **Visible to:** The authenticated investor user only (not visible to admins or founders viewing the same company)

### 11.3 Exact Visibility Conditions

The badge SHOWS (red "NOT on a cap table") when:

| Condition | Detail |
|-----------|--------|
| Zero confirmed cap-table positions | No `round_participants` record with `status IN ('confirmed', 'signed', 'funded')` exists for this investor across ANY company |
| Soft-circle pending (not yet confirmed) | Investor has submitted soft-circle but founder has not confirmed → `status = 'soft_circled'` counts as NOT on cap table |
| Account created via social/angel path | No capital-round invitation in history |
| Collective membership lapsed | Non-payment after `nonPaymentGraceDays = 30` → `collective_memberships.status = 'suspended'` |
| Admin suspended membership | `collective_memberships.status = 'suspended'` |
| All held companies exit Collective eligibility | Companies removed from deal room → investor loses Collective visibility |

The badge RESOLVES (disappears / turns green "on cap table") when:

| Condition | Detail |
|-----------|--------|
| Cap-table position confirmed | ≥1 `round_participants.status IN ('confirmed', 'signed', 'funded')` record |
| Eligibility recomputed | `eligibility.recomputed` event fires and sets `eligibilityFlags.investorOnCapTable = true` |
| Cap-table commit completed | `funded` state triggers `cap_table.mutated` event → `eligibility.recomputed` |

### 11.4 Toggle State Impact on UX

| State | Badge | Color | Communications | Deal Room | Soft-circle |
|-------|-------|-------|----------------|-----------|-------------|
| `investorOnCapTable = false` | "Investor: NOT on a cap table" | Red | DM to cap-table co-members blocked | Read-only (no soft-circle submission) | Channel hidden |
| `investorOnCapTable = true` | (no red badge) | Neutral/Green | Cap-table DM channel open if both opted in | Full access including soft-circle | Visible |
| `collective_memberships.status = 'suspended'` | "Membership suspended" | Red | All features locked | Deal room gated | Locked |
| `accreditation_status = 'pending'` | "KYC: Pending" (amber) | Amber | Normal | Read-only | Cannot submit |

### 11.5 Renewal Status Impact

- `nonPaymentGraceDays = 30` — after 30 days of non-payment, status transitions from `active` → `suspended`
- On suspension: toggle re-appears as red, Collective toggle disappears from navigation (Sprint 11: "Lapsed renewal → Collective toggle disappears")
- Admin can manually restore: `collective_memberships.status = 'active'`

### 11.6 Role / Cap-Table Position Conditions

Eligibility gate (`isEligibleForCollective()`) — pass conditions:
- (A) Investor is on a Capavate cap table (`round_participants.status IN ('confirmed', 'signed', 'funded')`)
- (B) User is the registered founder of a Capavate company
- (C) User is a signatory on at least one Capavate company
- (D) A consortium partner has issued a vouch with `partner_vouch_weight ≥ 1`

The eligibility check runs:
1. At `isEligibleForCollective(userId)` call when user navigates to `/collective/#/register/step-1`
2. On every cap-table mutation via the async `eligibility.recomputed` outbox event
3. On founder lifecycle event
4. On admin trigger

---

## §12. UNIFIED LOGIN FLOW

### 12.1 Auth Architecture

Single Auth0 tenant, per-product application. Same `user.sub` authenticates the user across both portals. There is NO separate registration for Collective — all founders and investors originate from Capavate.

### 12.2 Login Surfaces

| Surface | Login URL | Page Title | Gating Language |
|---------|-----------|------------|-----------------|
| **Founder/Company** | `/user/login` | "Login" (live: "Login Page" — BUG) | Standard login; no gating language |
| **Investor/Collective** | `/investor/login` | "Investors & Shareholders Login" | *"You're entering a secure, invitation-only investor portal."* · Shield: *"Capavate's verified network."* · Banner: **"Verified Investors & Shareholders Portal 🔒 — Access restricted to invited and accredited Capavate members"** |
| **Admin** | Same as founder login + role claim | (no separate URL) | Roles claim routes to admin surfaces post-auth |
| **Collective application** | `/collective/#/register/step-1` | "Apply to Capavate Collective" | Server-side `isEligibleForCollective()` at Step 1 — not a login page; requires existing auth |

### 12.3 Routing After Login

Post-authentication routing is determined by the JWT `roles[]` claim:

```
Login complete (any portal)
  ├─ roles includes 'admin' → /admin/dashboard
  ├─ roles includes 'founder' → /founder/dashboard (rebuild) or /dashboard (live)
  ├─ roles includes 'investor' → /investor/dashboard
  │     └─ if isEligibleForCollective → /collective/#/ accessible
  │     └─ if not eligible → /collective/ shows waitlist modal
  └─ roles includes 'dsc_member' → same as investor + /collective/#/dsc accessible
```

### 12.4 Investor Account Creation (Invitation-only)

Investor accounts CANNOT self-register. Only creation path:
1. Founder adds investor to `/crm` or directly to round invitations (name + email only)
2. System generates 256-bit single-use token → email sent via EmailSenderProvider
3. Investor clicks link → `/investor/signup?token=<token>` (404s without valid token)
4. 3-step inline signup: (1) identity — full name, phone, country; (2) investor profile — type, accredited status, KYC docs; (3) privacy + screen name — opt-in to co-member visibility
5. On submit: account created, token marked redeemed, investor lands on round invitation

Token properties:
- 256-bit cryptographically random (Node `crypto.randomBytes(32)`)
- Single-use — invalidated upon acceptance
- Expiry: default 30 days; founder-configurable
- Stored as SHA-256 hash only — raw token never stored server-side after issuance
- Rate-limited: 10 req/min per IP on redemption endpoint
- Failed attempts: admin-alerted at 3+ within 1 hour

---

## §13. FULL BRIDGE DATA FLOW (CAPAVATE ↔ COLLECTIVE)

### 13.1 Architecture

```
Capavate write tx ─┐
                   ├──> Postgres outbox table ──> webhook relay ──> Collective inbox
trace + audit hash ┘                                                     │
                                                             Collective state machine
                                                             + Collective audit log
```

Events are ordered per company (per investor for investor-side events); ordering preserved by partitioning relay by `aggregate_id`. HMAC-SHA256 signed JSON over HTTPS POST. Idempotency-Key = eventId. Collective responds 2xx ACK or 409 (already received). Failure → exponential backoff → dead-letter queue in `/admin/audit-log`.

### 13.2 Direction: Capavate → Collective

| Event | Trigger | Payload shape |
|-------|---------|---------------|
| `company.profile.updated` | Any 4-step Company Profile field mutated | Full company-shared snapshot + `changedFields[]` |
| `company.ma_intelligence.updated` | Any of 30 M&A fields mutated | Full M&A object + `changedFields[]` |
| `investor.profile.updated` | Any investor-side field mutated | Full investor-shared snapshot + `changedFields[]` |
| `cap_table.mutated` | Any transaction posted to cap-table engine | Computed cap table snapshot (aggregates only) + engine `trace[]` |
| `eligibility.recomputed` | Any input to eligibility scoring changed | New `eligibilityScore (0-100)`, `eligibilityFlags[]` |
| `lifecycle_policy.changed` | Admin saves lifecycle policy | Full policies object |
| `formula.published` | Admin promotes formula draft to active | Formula record + test results |
| `audit_log.appended` | Any append to Capavate audit log | Entry id + hash chain link |
| `safe.converted` / `note.converted` | SAFE/Note converts at priced round | Conversion result + trace |
| `round.closed` | Round transitions `signing_open` → `closed` | Final cap table snapshot |
| `governance_metric.published` | Founder publishes monthly metrics | Period, KPIs, attachments |

### 13.3 Direction: Collective → Capavate

| Event | Trigger | Payload |
|-------|---------|---------|
| DSC scores | On DSC review completion | `dscScore`, `dscRecommendation`, reviewer IDs |
| M&A intelligence rankings | Nightly batch | `compositeScore`, `mnaScore`, `roundScore`, `auto_tier`, sector benchmarks |
| Consortium partner introduction status | On status change | `partnerId`, `introductionStatus`, `vouchWeight` |
| Network social signals | Real-time | `followerCount`, `mentionCount`, `networkActivity` |

Communications (`message.received`, posts) are **bidirectional real-time**.

### 13.4 Canonical Outbox Event Payload

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
  "trace": [
    {
      "formulaId": "ca-default-v1",
      "version": "1.0.0",
      "region": "CA",
      "defHash": "8b7ce4..."
    }
  ],
  "auditChain": {
    "priorHash": "0e2af1...",
    "hash": "8b7ce4..."
  },
  "schemaVersion": "1.0"
}
```

### 13.5 Eligibility Recompute Propagation (Exact Flow)

1. Cap-table mutation occurs in Capavate (`round_participants.status = 'funded'`)
2. Transaction written to ledger → `cap_table.mutated` event emitted to outbox
3. `eligibility.recomputed` event also emitted with new `eligibilityScore` and `eligibilityFlags`
4. Collective eligibility worker consumes `eligibility.recomputed`
5. Worker writes to `collective_eligibility_audit` (trigger, old status, new status, timestamp)
6. Worker mutates `collective_memberships.status` if threshold crossed
7. `notifications` row inserted: `kind = 'collective.eligibility.gained'` → bell + email
8. `investorOnCapTable` flag updates → sidebar badge resolves from red to neutral

Eligibility scoring formula (Capavate side):
- M&A score ≥ 60 → eligible signal
- ARR ≥ tenant policy threshold
- Last round closed within 18 months
- No open litigation (`litigationStatus = false`)
- Audit-log integrity intact

Output: `eligibilityScore (0-100)`, `eligibilityFlags[]` — both Collective-shared.

### 13.6 Lifecycle Policy Propagation

All five policies are owned by Capavate `/admin/lifecycle-policy` and propagated to Collective via `lifecycle_policy.changed`:

| Policy | Default | Collective consumes |
|--------|---------|---------------------|
| `founderDashboardTenureDays` | 180 | Notifies founder of optional graduation |
| `archivalRetentionDays` | 3650 | Hard-deletes after retention window |
| `governanceMetricsCadenceDays` | 30 | Pings DSC sponsors |
| `softCircleExpiryDays` | 14 | Used for Collective SPV soft-circles |
| `invitationExpiryDays` | 21 | Used for Collective member-to-member invites |

---

## §14. FULL COLLECTIVE SITEMAP

### All Members

| Route | Page |
|-------|------|
| `/collective/` or `/collective/#/` | Dashboard |
| `/collective/#/deals` | Deal Room |
| `/collective/#/deals/:id` | Company Deal Detail (7 tabs) |
| `/collective/#/deals/:spv_id` | SPV Deal Detail |
| `/collective/#/members` | Member Directory |
| `/collective/#/chapters` | Chapter Directory |
| `/collective/#/calendar` | Events Calendar |
| `/collective/#/meetings` | Monthly Investor Meetings |
| `/collective/#/investments` | My Investments / Portfolio |
| `/collective/#/connections` | Network Connections |
| `/collective/#/consortium` | Consortium Partners |
| `/collective/#/profile` | Member Profile (3 steps) |
| `/collective/#/crm` | Personal CRM |
| `/collective/#/ask` | Ask Expert |
| `/collective/#/outcome-log` | Ask Expert Outcome Log |
| `/collective/#/ma-intelligence` | M&A Intelligence |
| `/collective/#/knowledge-hub` | Knowledge Hub (660+ articles) |
| `/collective/#/recaps` | Screening Recaps |
| `/collective/#/legal` | Legal Resources |
| `/collective/#/register/step-1` through `/collective/#/register/pending` | Registration (7-step wizard) |
| `/collective/#/syndicates` | Syndicate Applications |

### DSC Committee Members (additional)

| Route | Page |
|-------|------|
| `/collective/#/dsc` | DSC Screening Queue |
| `/collective/#/screening/:review_id` | DSC Screening Room per company |

### Admin (additional)

| Route | Page |
|-------|------|
| `/collective/#/spv` | SPV Admin |
| `/admin/algorithms` | Algorithm Console (gated `isAdmin`) |
| `/admin/lifecycle-policy` | Lifecycle Policy — Platform Defaults / Group Rules / Company Overrides / Audit Log |
| `/admin/spv` | SPV Management cards |
| `/admin/audit-log` | Audit log with hash chain |

---

## APPENDIX A: DESIGN TOKENS

| Token | Hex | Role |
|-------|-----|------|
| Navy | `#1C2B4A` | Primary text, headers, navbar |
| Hydra Teal | `#01696F` | Links, CTAs, accents, active states |
| Plum | `#9D174D` | DSC Committee surfaces, note callouts |
| Reject | `#B33A2B` | Destructive states, error alerts, warnings |
| Neutral Light | `#F8F9FA` | Page backgrounds |
| Neutral Mid | `#E5E7EB` | Borders, dividers |
| Neutral Dark | `#374151` | Secondary text |

---

## APPENDIX B: OPEN QUESTIONS / GAPS

| Gap | Detail |
|-----|--------|
| Admin dashboard page | No explicitly named "admin dashboard" page is documented; macro KPIs are inferred from schema/spec rather than observed in a live admin UI |
| Revenue dashboard | No standalone revenue/billing admin page defined; revenue data lives in commission_records + payment_gateways |
| A/B email variants | Not formally defined; template slug system could support them without schema changes |
| Collective → Capavate DSC score payload | Shape not fully specified; only field names documented |
| Algorithm Console UI | Weight tuning interface is admin-only and confirmed gated; exact UI fields for weight adjustment are not documented in audited files |
| M&A score formula | Composite, M&A, and Round score formulas are referenced by label but exact weights and source-data inputs not published in corpus |

*End of collective_admin_audit.md*
