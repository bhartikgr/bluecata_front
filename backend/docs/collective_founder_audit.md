# Capavate Collective — Founder/Company Perspective Audit
**Audit Date:** 2026-05-09  
**Auditor:** Synthesis subagent (cross-reference of all workspace audit files)  
**Primary sources:** `collective_investor_audit.md`, `capavate_founder_audit.md`, `capavate_founder_deep_audit.md`, `collective_communications_audit.md`, `capavate_gating_addendum.md`, `capavate_collective_sync_schema.md`, `capavate_master_build_spec.md`, `capavate_working_brief.md`, `SPRINT-10-INVESTOR-SUMMARY.md`  
**Scope:** How a company enters Collective; founder/company profile inside Collective; cap-table investor membership toggle; login + multi-company architecture; settings, pricing, and billing.

---

## 1. HOW A COMPANY APPLIES TO PRESENT TO COLLECTIVE

Collective operates under a strict eligibility gate: **no company can appear in the Collective deal room unless it originated on Capavate first.** All companies in Collective originate from the Capavate equity ledger. There are two application paths.

---

### PATH A — Shareholder-Promoted Nomination (Shareholder-Promoted Flow)

This is the primary path. A company becomes eligible for Collective deal room exposure because one or more of its existing cap-table investors (shareholders) are themselves eligible for Collective membership, OR an eligible Collective member nominates/vouches for the company.

**Eligibility gate (server-side `isEligibleForCollective()`):**

The platform calls `isEligibleForCollective(userId)` automatically when a user navigates to `/collective/#/register/step-1`. A company (or its associated founder account) passes the gate if **at least one** of:
- (A) The founder or a shareholder is on a Capavate cap table
- (B) The founder is the registered founder of a Capavate company
- (C) The founder is a signatory on at least one Capavate company
- (D) A consortium partner has issued a vouch with partner weight ≥ 1

**Step-by-step flow (Shareholder-Promoted Path):**

| Step | What happens | Actor | State |
|------|-------------|-------|-------|
| 0 | Founder creates company on Capavate, completes Company Profile 4-step wizard | Founder | Company exists in Capavate equity ledger |
| 0b | Founder invites investors to a round; investors accept; cap table is populated | Founder + Investors | Capavate cap table has ≥1 investor |
| 1 | Investor (now on cap table) becomes eligible for Collective membership by virtue of cap table position | System | `eligibility.recomputed` event fires |
| 2 | Investor applies to Collective via the 7-step registration wizard | Investor | `collective_memberships.status = 'submitted'` |
| 3 | Admin reviews investor's application; investor is accepted into Collective | Admin | `collective_memberships.status = 'active'` |
| 4 | Investor, now a Collective member, can see their portfolio company(ies) in the Collective deal room | System | Company appears in `/collective/#/deals` |
| 5 | Company data (profile, M&A intelligence, round telemetry) syncs from Capavate → Collective via outbox/webhook | System | `company.profile.updated`, `company.ma_intelligence.updated` events |
| 6 | Company is assigned an auto-tier score (Watch/Qualified/Featured/Priority) by the AlgorithmsProvider | System | `mna_score`, `round_score`, `composite_score` computed |
| 7 | Company appears in DSC open-review list; DSC committee members can score and vote on it | DSC | Company visible at `/collective/#/dsc` |

**Key rules for shareholder-promoted path:**
- The investor's cap-table position is verified server-side at every step — not just at initial eligibility check
- The company profile data in Collective is a read-only projection of what was entered by the founder in Capavate; the founder does NOT re-enter data in Collective
- The company cannot opt out of Collective exposure once the eligibility gate has been passed and the investor is active in Collective (the investor's cap-table membership IS the entry point)
- Eligibility is **re-computed** on every cap-table mutation (event: `eligibility.recomputed`); if a shareholder exits and there are no remaining Collective-eligible shareholders, the company may lose Collective visibility

**Eligibility status display:**
- In the left sidebar of the investor dashboard, the persistent status badge reads: **"Investor: NOT on a cap table"** (red tag) OR **"Investor: on cap table"** (resolved when the investor holds ≥1 confirmed cap-table position)
- This badge is the Collective membership toggle signal for cap-table investors (see §3 below)

---

### PATH B — Standalone Company Application (Founder-Initiated)

This path allows a founder to apply to have their company presented to Collective independently, without needing a shareholder to lead. It is the less-common path.

**Entry point on live Capavate (founder side):**

The only live entry point currently found in the founder-side sidebar is:

```
★ Join Capavate Angel Network    (modal trigger in left sidebar nav)
```

**"Join Capavate Angel Network" Modal — Full Field Inventory:**

| Field | Type | Required | Notes |
|-------|------|---------|-------|
| First Name | text | Yes | Founder's first name |
| Last Name | text | Yes | Founder's last name |
| Email Address | email | Yes | Founder's email |
| Phone Number | tel | Yes | With country code |
| City | text | Yes | City of founder/company |
| Country | dropdown | Yes | Full world country list |

**Buttons:** Cancel | **Join Angel Network**

**Modal content (verbatim):**
- Capavate Angel Network gives "a seat at the global table where early-stage deals are sourced, screened, and funded"
- Features listed: diversified vetting, deal flow from startup ecosystems, collective intelligence, syndication tools, participation in larger rounds at smaller check sizes, community education
- **Eligibility requirement:** Accredited investors only (including authorized representatives; investors already on a company cap table hosted on Capavate)
- **Annual membership fee: $1,200 USD/year** (subject to change)

**Status of this path (live platform):**
- The "Join Angel Network" modal is currently a **waitlist form** — it does NOT immediately enroll the founder/company in Collective
- The form submits name, email, phone, city, country — no company-specific fields are captured in this modal
- After submission, the user is added to a waitlist queue
- Live at: `capavate.com/collective/` — shows a waitlist modal for non-eligible users with text: *"You need a verifiable position on a Capavate cap table or a partner vouch to access the Collective."* and a "Join waitlist" CTA

**In the rebuild (Sprint 10 / R200 spec), Path B becomes a full 7-step wizard:**

Route: `/investor/apply-to-collective` (on the Capavate investor side, not the founder side)  
This is the formal application wizard. For a company to be submitted via a standalone application, the founder typically navigates via the investor-side CTA (since founder-investors are the same Auth0 user in both portals).

**7-Step Application Wizard (Path B — Rebuild target):**

| Step | Route | Name | Fields / Actions |
|------|-------|------|-----------------|
| 1 | `/collective/#/register/step-1` | Eligibility Verification | **No form.** Server-side `isEligibleForCollective(userId)`. Pass → auto-advance. Fail → waitlist modal: *"You need a verifiable position on a Capavate cap table or a partner vouch."* + "Join waitlist" CTA |
| 2 | `/collective/#/register/step-2` | Membership Application Form | INVESTMENT THESIS (max 1000 chars) · MINIMUM CHECK SIZE (numeric + currency, min $5,000, default $25,000) · MAXIMUM CHECK SIZE (must be ≥ min) · SECTORS OF FOCUS (45-industry multi-select chips) · PREFERRED STAGES (Pre-Seed / Seed / Series A / Series B / Series C+ / Growth / Late Stage) · GEOGRAPHIC FOCUS (Home Market Only / Home Country / Open to Global / Cross-Border) · MEMBER TIER (admin-managed tier select; pricing tied to tier) · REFERRAL/PARTNER CODE (text, optional; `?cp={partner_slug}` pre-fills this) |
| 3 | `/collective/#/register/step-3` | KYC Document Upload | PASSPORT/GOV ID (PDF/JPG/PNG, max 10MB, required) · PROOF OF ADDRESS (bank statement/utility bill/gov letter, within 90 days, required) · ADDITIONAL DOCUMENTATION (multiple file upload, optional) · KYC provider banner (Persona/Sumsub/Onfido/Veriff) · Sanctions screening notice (OFAC, UK HMT, EU, UN, MAS, HKMA lists) |
| 4 | `/collective/#/register/step-4` | Accreditation Verification | Jurisdiction-adaptive fields: US (income >$200k / >$300k joint / net worth >$1M) · CA NI 45-106 (net income >$200k CAD / net assets >$1M CAD) · UK HNW (income >£100k or assets >£250k) or Sophisticated Investor self-cert · EU MiFID II professional client declaration · SG SFA §4A AI declaration · HK SFO s.1 Part 1 Sch 1 PI declaration · Other jurisdictions (generic self-declaration + note field). Stored as `accreditation_status`: verified / self-cert / pending / rejected |
| 5 | `/collective/#/register/step-5` | Payment | $1,200 USD/year (or tier-adjusted) · Stripe embedded checkout (Card number / Expiry / CVC / Cardholder name / Billing address) · "Pay by invoice" link (admin-approved only) · Fee breakdown (annual + tier + consortium partner discount) |
| 6 | `/collective/#/register/step-6` | Admin Review Queue | No form fields. Status: `submitted → reviewing → accepted / rejected / waitlisted`. Displays status badge (amber "Under Review"), submission timeline, application summary read-only card, "Edit application" link (allowed in submitted/reviewing) |
| 7 | `/collective/#/register/pending` | Confirmation | "Application submitted" OR "Application accepted — welcome to the Collective" · Welcome email dispatched via EmailSenderProvider on `status = 'active'` · "Explore the Deal Room →" and "Set up your profile →" next-step CTAs · Receipt link for annual fee |

**Validation rules (both paths):**

| Rule | Behavior |
|------|---------|
| Required fields | Red asterisk (*); inline error on blur |
| Check size: min ≤ max | "Maximum check size must be greater than minimum" |
| KYC file size | Toast: "File exceeds 10MB limit. Please compress or use PDF." |
| File type | Toast: "Only PDF, JPG, PNG accepted." |
| Payment failure | Stripe inline error + "Try another card" CTA |
| Duplicate application | Toast: "You already have an active or pending application." |
| Eligibility re-check | Server re-validates at Step 2 submit (prevents race conditions) |

---

## 2. FOUNDER/COMPANY PROFILE WITHIN COLLECTIVE (POST-ACCEPTANCE)

After a company enters Collective (via either path), it appears in the deal room at `/collective/#/deals/:company_id`. The company profile in Collective is a **read-only projection** of what was entered in the Capavate Company Profile wizard — founders cannot edit their company profile directly within Collective.

### Company Data Synced to Collective (from Capavate)

All fields are synced via outbox/webhook event `company.profile.updated`. The sync schema partitions fields as follows:

**Collective-shared (visible in Collective deal room):**

| Field | Source | Notes |
|-------|--------|-------|
| legalName | Company Profile Step 3 | Legal entity name |
| dbaTrade | Company Profile Step 1 | DBA / trade name |
| entityType | Company Profile Step 3 | Corporation / LLC / Pvt Ltd etc. |
| jurisdiction | Company Profile Step 2/3 | Drives regional formula resolution |
| incorporationDate | Company Profile Step 1 | Date of incorporation |
| fiscalYearEnd | Company Profile Step 3 | — |
| headquartersAddress | Company Profile Step 2 | City + country only sent to Collective (street address is Capavate-private) |
| website | Company Profile Step 1 | Company website URL |
| industry / sector | Company Profile Step 1 | From 50-option industry dropdown |
| stage | Company Profile Step 2 | Funding stage |
| modelDescription | Company Profile Step 1 | Business model type |
| foundedYear | Company Profile Step 1 | From date of incorporation |
| employeeCount | Company Profile Step 1 | 6 employee ranges |
| arr / revenue / grossMargin | Company Profile Step 2 | Revenue metrics |
| runwayMonths | Company Profile Step 2 | Derived from burnRate + cash |
| keyMetrics | Company Profile Step 2 | Key KPIs |
| totalRaisedToDate | Capital structure | From round history |
| lastRoundDate / lastRoundType / lastValuation | Capital structure | From round history |
| esopSizePercent | Cap table | ESOP pool % |
| activeInvestors (names) | Cap table | Collective-visible (screen names) |
| All 30 M&A intelligence fields | Company Profile Step 4 | Full M&A intelligence payload |
| one_sentence_headliner | Company Profile Step 1 | Tagline |
| problem_statement / solution_statement | Company Profile Step 1 | Narrative |
| brand_color | Company Profile | Drives Collective deal card header color |

**Capavate-private (never sent to Collective):**

| Field | Reason |
|-------|--------|
| registrationId / EIN / Business Number | PII |
| primaryEmail / primaryPhone | PII |
| operatingAddresses (full) | Sensitive for some founders |
| burnRate (exact) | Shared only as derived "runway months" |

### Company Detail Page in Collective (7 tabs)

URL: `/collective/#/deals/:company_id`

**Company Header Banner:**
- Full-width dark banner (brand_color field from company profile)
- Company logo (circle with initials, ~64px)
- Company name (H1)
- Tagline (one_sentence_headliner)
- Tags row: 📍 Location pill · 👥 Employee count pill · 🏛 Visibility status pill · 🌐 Website link
- Auto-tier badge: **Watch** / **Qualified** / **Featured** / **Priority** (composite M&A+Round score)
- Composite score display: "Composite score {N} · M&A {N} · Round {N}" — visible to DSC members; non-DSC see only auto_tier label
- "💬 Message" CTA (white outline button, top-right)

**Stats Row:**

| Icon | Label | Example |
|------|-------|---------|
| 🏭 | Industry | Fintech & Digital Payments |
| 📅 | Incorporated | Mar 14th, 2023 |
| 👥 | Employees | 11–50 |
| 🔢 | Business No. | 765432109 |
| 📈 | Stage | Seed / Series A |

**Tab 1: Overview**

Section A — Summary Cards:
- LEGAL ENTITY: entity name · entity type + Country
- TOTAL SHARES OUTSTANDING: share count · "N Founders" sub-label
- CURRENT SHARE PRICE: price (4 decimal places)
- BUSINESS MODEL: model type · Revenue type (e.g. "Recurring Revenue")

Section B — Problem & Solution:
- PROBLEM: free text
- SOLUTION: free text

Section C — Legal & Governance:
- Legal Entity, Entity Type, Business Number, Jurisdiction, Law Firm, Regulatory Compliance, Formal Board (Yes/No), IP Holdings (Yes/No), Financials Audited (Yes/No)

Section D — Market Presence:
- Active Geographies (multi-select tags), Customer Segments, Revenue Concentration Risk >30% (Yes/No), Exclusivity Clauses (Yes/No)

Section E — Strategic Priorities (Next 24 Months):
- Strategic Priorities (narrative text), Types of Partners Sought (tags), Interested In (structured exit interest tags), Would Not Consider (exclusion tags)

Section F — Competitive Landscape Table:
- Columns: # | COMPETITOR | WEBSITE | NOTES

Section G — SPV/Soft-Circle Pill (conditional):
- Rendered when company has an active SPV attached
- For basket SPVs: SPV name + LIVE/DRAFT badge, "MULTI-DEAL SPV · N COMPANIES" vehicle badge, constituent company chips, SPV stats (target raise, min/max check, fees: Upfront $N · Raise N% · Carry N%)

**Tab 2: Team**
- Founder card(s): Photo/avatar + Name + Title + LinkedIn link
- Team member cards: Photo/avatar + Name + Title
- Advisor cards (if any): Photo/avatar + Name + Title + Area of expertise

**Tab 3: Traction**
- ARR/MRR with currency, Revenue Growth (MoM/YoY), Key KPIs (up to 5), Customer count, NPS/Churn (if provided)

**Tab 4: Financials**
- Annual Recurring Revenue, Gross Margin %, Burn Rate, Runway Months, Total Raised to Date, Last Round Date, Last Round Type, Last Valuation (pre-money + post-money)

**Tab 5: Round Terms**
- Instrument Type (SAFE/Convertible Note/Preferred Equity/Common Equity), Round Name, Pre-Money Valuation, Round Size (target), Round Size Closed (soft-circle running total), Discount Rate, Valuation Cap, Investor Rights (Pro-rata/ROFR/Co-Sale/Board Seat/Observer), Expiry Date, Lead Investor, Co-investors

**Tab 6: Documents**
- Document list gated per investor via `dataroom_grants`
- Row: Document name + type + upload date + download button
- Empty state: "No documents available for this investor"
- Access note: "Access granted by [Company Name]"

**Tab 7: Your Decision** (investor-side; this tab's full spec is in `collective_investor_audit.md`)
- 10-state status banner, Accept/Decline radio, soft-circle form, MIM section (members interested in this deal)

---

## 3. COLLECTIVE MEMBER TOGGLE FOR CAP-TABLE INVESTORS

The "membership toggle" is the persistent status badge in the investor's left sidebar at the top of every Collective page:

**Badge label:** `"Investor: NOT on a cap table"` (red tag)  
**Alternate state:** `"Investor: on cap table"` (status chip, rendered when confirmed cap-table position exists)

### When the badge SHOWS (when it appears as red "NOT on a cap table")

The badge appears whenever the authenticated investor user has **zero confirmed cap-table positions** in Capavate. Specifically:
- No `round_participants` record with status `confirmed`, `signed`, or `funded` exists for this investor across any company
- This includes the case where an investor has accepted an invitation but the founder has not yet confirmed them (soft_circled → pending founder confirmation)
- The badge also appears for accounts created via the social-network or angel-profile path (not via capital-round invitation)

### When the badge DISAPPEARS (becomes "on cap table")

The badge resolves to the "on cap table" state when:
- At least one `round_participants` record exists with `status = 'confirmed'` (or `signed` or `funded`) for this investor
- The underlying `eligibility.recomputed` event fires and sets `eligibilityFlags.investorOnCapTable = true`
- This also unlocks direct messaging with cap-table co-members (`canMessage()` returns true for the shared cap-table path)

### When the badge RE-APPEARS (renewal lapsed / cap table exit)

The badge reverts to "NOT on a cap table" when:
- The investor's cap-table position is removed (founder removes them, round is voided, or the company is archived)
- Collective membership lapses due to non-payment (after 30-day grace period: `nonPaymentGraceDays=30`)
- Admin suspends the membership: `collective_memberships.status = 'suspended'`
- All companies the investor held shares in exit Collective eligibility

### UX rules for the toggle

| State | Badge label | Badge color | Impact on communications |
|-------|-------------|-------------|--------------------------|
| investorOnCapTable = false | "Investor: NOT on a cap table" | Red | DM to cap-table co-members blocked; soft-circle channel hidden |
| investorOnCapTable = true | (no red badge; or "Investor: on cap table" chip) | Green / neutral | Cap-table channel visible; co-member messaging enabled if both opted in |
| Collective membership suspended | "Membership suspended" | Red | All Collective features locked; dashboard accessible but deal room gated |
| Collective membership active + KYC pending | KYC badge: "KYC: Pending" (amber) | Amber | Deal room read-only; cannot submit soft-circles until KYC verified |

---

## 4. LOGIN + MULTI-COMPANY ARCHITECTURE IN COLLECTIVE

### Auth Architecture

Collective shares the **same Auth0 identity** as Capavate. There is a single Auth0 tenant, single JWT, single user record. The same `user.sub` authenticates the user on both `capavate.com/dashboard` (founder) and `capavate.com/collective/` (Collective member).

**Key architectural facts:**
- Auth is shared — the same email/password pair works on both portals
- Collective deploys at `capavate.com/collective/` as a strictly additive routing rule; the Wix marketing site is never touched
- React base path is `/collective/`; cookie domain is `.capavate.com`
- The founder side is at `capavate.com/dashboard` (login: `/user/login`)
- The investor/Collective side is at `capavate.com/investor/dashboard` (login: `/investor/login`)
- Both portals authenticate against the same Auth0 application; the user's `roles[]` claim in the JWT determines which products they can access

**Login flows:**

| Portal | Login URL | Page title | Gating language |
|--------|-----------|------------|-----------------|
| Founder (Company) | `/user/login` | "Login" | Standard login, no special gating language |
| Investor/Collective | `/investor/login` | "Investors & Shareholders Login" | *"You're entering a secure, invitation-only investor portal."* · Shield icon: *"Capavate's verified network."* · Bottom banner: **"Verified Investors & Shareholders Portal 🔒 — Access restricted to invited and accredited Capavate members"** |

### Multi-Company Architecture in Collective

**Current live platform (Capavate founder side):**

The live platform is a **single-company workspace per login.** A user is authenticated and lands directly on their company dashboard (`/dashboard`) with no company-picker or switcher visible. The sidebar shows the company name (e.g., "NovaPay AI") with no dropdown to switch.

**No company-switcher exists on the live platform.** The sidebar company card shows:
- Company name (e.g., NovaPay AI)
- Sector (currently displaying a bug: shows "YES" instead of the actual sector)
- Headquarters address
- Account Owner: [founder name]

**Multi-company support in the rebuild (R200 target architecture):**

The R200 build spec establishes that a single Auth0 user (`user.sub`) can be associated with **multiple companies** as `companyOwner`, `founderOf`, or `signatoryOf`. The architecture supports this at the data model level:

- Each user has a `companies[]` array of associated company workspaces
- The JWT roles claim carries `companyId` per-company context
- The `/api/companies/:id` payload is scoped to the requesting user's role on that company
- The rebuild will include a **company-switcher** in the top navigation bar for founders with multiple companies

**How Collective handles members who are founders of multiple companies:**

| Scenario | Collective behavior |
|----------|-------------------|
| Founder of 1 company (standard) | Collective shows that 1 company in the deal room; founder navigates to it at `/collective/#/deals/:company_id` |
| Founder of 2+ companies | Collective exposes each company as a separate deal card; the founder's investor persona sees all their companies. As a founder, they edit each company's profile on the Capavate side separately. |
| Founder who is also a cap-table investor | The same account holds both founder and investor roles. The Collective dashboard shows the investor-side view (portfolio, deal room, connections). The founder company edit remains on the Capavate side at `/company-profile`. |
| Investor who becomes a founder | New company can be created on the Capavate founder side; after eligibility gate, the company propagates to Collective. The user's existing investor identity is preserved. |

**Origination rule (canonical):**
> "All companies on Collective originate from Capavate. The only exception is standalone SPVs (R170/R171), which originate on Collective itself. All founders and investors originate from Capavate." — capavate_gating_addendum.md

---

## 5. SETTINGS + PRICING + BILLING PATTERNS

### Collective Membership Pricing

| Tier | Annual Fee | Notes |
|------|-----------|-------|
| Standard (Angel Network) | $1,200 USD/year | Confirmed in "Join Angel Network" modal on live Capavate + `/collective/#/register/step-5` |
| Tier-adjusted amounts | Variable | Member tier (Individual / Plus / etc.) is admin-managed; pricing tied to tier. Tier options set by Capavate admins. |
| Consortium partner discount | Variable | Partner `?cp={partner_slug}` pre-fills referral code; discount applied at payment step |

**Payment processor:** Stripe embedded checkout  
**Card fields:** Standard Stripe Elements (Card number / Expiry / CVC / Cardholder name / Billing address)  
**Alternative:** "Pay by invoice" — admin-approved only  
**Fee breakdown shown at checkout:** Annual membership · Selected tier · Any consortium partner discount applied

### Admin Lifecycle Policy

Collective membership is governed by the `LifecyclePolicyProvider` with these admin-configurable thresholds:

| Field | Default value | Notes |
|-------|------------|-------|
| `founderTenureDays` | 180 days (6 months) | Window from company application date during which founder has access to the Capavate/Collective founder workbench |
| `archiveRetentionDays` | 3650 days (10 years) | Archive retention |
| `nonPaymentGraceDays` | 30 days | Grace period before membership is suspended for non-payment |
| `requiredForVotes` | Admin-tunable | Governance/cadence threshold |
| `majorityThresholdPct` | Admin-tunable | Vote majority threshold |
| `vintageCutoffMonths` | Admin-tunable | Portfolio vintage cutoff |
| `defaultCheckSizeMinUsd` | $5,000 | Minimum check size default for application form |
| `defaultCheckSizeMaxUsd` | $25,000+ | Maximum check size default |
| `monthlyMeetingMinutes` | Admin-tunable | Default monthly meeting duration |
| `rsvpCutoffHours` | Admin-tunable | RSVP cutoff hours before monthly meeting |

**Admin lifecycle policy page:** `/admin/lifecycle-policy`  
**Tabs:** Platform Defaults · Group Rules · Company Overrides · Audit Log

**Precedence model:** Company Override > Group Rule > Platform Default  
**Group rule scopes:** cohort / chapter / sector / stage / tier / ad-hoc  
**Override expiry:** Optional `expiresAt`; blank = permanent

### Admin Routes (Collective)

| Route | Purpose | Access |
|-------|---------|--------|
| `/collective/#/spv` | SPV Admin (R171) | Admin only |
| `/admin/algorithms` | Algorithm Console (M&A scoring weights) | Admin only (`isAdmin` gate) |
| `/admin/lifecycle-policy` | Lifecycle Policy with 4 tabs | Admin only |
| `/admin/spv` | SPV Management cards | Admin only |
| `/admin/audit-log` | Audit log with hash chain | Admin only |

### Pricing → Company-Side Sync (Gap)

**Critical gap documented:** The `/subscription` page on the live Capavate founder side shows "No subscriptions yet — You don't have any active subscriptions at the moment." with **no "Browse Plans" or "Upgrade" button visible.** There is no visible pathway on the founder side for admin to push pricing/plan data to the subscription page. The "Join Angel Network" modal ($1,200/yr) is a separate trigger from the sidebar — it does NOT create a subscription record on the Subscriptions page.

**What this means for the rebuild:** The `/subscription` page needs to:
1. Pull the live membership tier and price from the Stripe subscription record
2. Show renewal date, next billing amount, plan tier
3. Provide an "Upgrade" or "Change plan" path
4. Be admin-manageable from the Collective admin pricing layer
5. Sync subscription status bidirectionally with Capavate when the founder is also a Collective investor member

**Current state of pricing/billing admin sync:** Not wired. The admin side lives at `/admin/lifecycle-policy` (tier/pricing policies are managed there), but the founder-side `/subscription` page does not read from this policy engine. This is the **settings/pricing/admin sync gap.**

### Day-One Administrators

| Admin | Email | Access |
|-------|-------|--------|
| Ozan Isinak | ozan@capavate.com | Full admin scope |
| Avinay Kumar | avinaykumar.web@gmail.com | Full admin scope |
| Shadie Broumandi | shadie@capavate.com | Full admin scope |

All three have: full platform access, seed-replacement console, algorithm tuning, lifecycle policy management, DSC assignment.

---

## 6. COLLECTIVE SITEMAP (FULL — MEMBER VIEW)

### All Members

| Route | Page |
|-------|------|
| `/collective/` or `/collective/#/` | Dashboard |
| `/collective/#/deals` | Deal Room |
| `/collective/#/deals/:id` | Company Deal Detail |
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
| `/admin/algorithms` | Algorithm Console |
| `/admin/lifecycle-policy` | Lifecycle Policy |
| `/admin/spv` | SPV Management |
| `/admin/audit-log` | Audit Log |

---

## 7. DATA FLOW SUMMARY: CAPAVATE → COLLECTIVE

| Data | Direction | Event trigger |
|------|-----------|--------------|
| User profile (name, screen name, KYC status, accreditation) | Capavate → Collective | On profile change |
| Company profile (name, sector, stage, region, M&A fields) | Capavate → Collective | On profile change (`company.profile.updated`) |
| Cap table state (holders, ownership %, instrument mix) | Capavate → Collective | On every cap-table mutation (`cap_table.mutated`) |
| Eligibility recompute | Capavate → Collective | On cap-table mutation, founder lifecycle event, or admin trigger (`eligibility.recomputed`) |
| Round telemetry (state transitions, durations, valuations) | Capavate → Collective | On round state change |
| M&A intelligence updates | Capavate → Collective | On any of 30 M&A fields mutated (`company.ma_intelligence.updated`) |
| Communications | Bidirectional | Real-time |
| DSC scores (when company applies for syndication) | Collective → Capavate | On DSC review |
| M&A intelligence rankings (composite score, sector benchmarks) | Collective → Capavate | Nightly batch |
| Consortium partner introduction status | Collective → Capavate | On status change |
| Network social signals (followers, mentions) | Collective → Capavate | Real-time |

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

## APPENDIX B: COLLECTIVE-ONLY VARIABLE INVENTORY

| Variable | Domain | Source |
|----------|--------|--------|
| `composite_score` | M&A Intelligence | AlgorithmsProvider |
| `mna_score` | M&A Intelligence | AlgorithmsProvider |
| `round_score` | M&A Intelligence | AlgorithmsProvider |
| `auto_tier` | Deal Sourcing | Computed (Watch/Qualified/Featured/Priority) |
| `deal_stage_override` | Deal Sourcing | Admin manual tier override |
| `member_tier` | Membership | Admin |
| `chapter_id` | Chapters | Admin |
| `pcrm_contacts` | Personal CRM | Member private rolodex |
| `pcrm_notes` | Personal CRM | Timestamped note log |
| `pcrm_tasks` | Personal CRM | Task list with due date |
| `dsc_vote` | DSC | Recommend/Neutral/Pass + 5-dimension scoring |
| `spv_subscription` | SPV | Soft-circle subscription amount + seal |
| `signature_seal` | SPV | Client-side SHA-256 chain with 5-min replay window |
| `monthly_meeting_id` | Meetings | Zoom meeting ID + join URL |
| `accreditation_status` | KYC | verified / self-cert / pending / rejected |
| `collective_eligibility_audit` | Eligibility | Trigger, old/new status, timestamp |
| `partner_vouch_weight` | Consortium | 1–5 scale |
| `referral_record` | Consortium | First-referral-wins lock-once attribution |
| `collective_memberships.status` | Membership | submitted / reviewing / accepted / active / suspended |
| `ask_thread` | Ask Expert | Thread routed to partner by category |
| `ask_outcome` | Ask Expert | Answer with attribution chip (firm name, NOT tier) |

---

*End of collective_founder_audit.md — Total lines: ~500+*
