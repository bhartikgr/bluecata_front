# Capavate Collective — Investor Experience Audit
**Audit Date:** 2026-05-09
**Auditor:** Audit subagent (avinayquicktech@gmail.com — investor persona)
**Platform URL:** `https://capavate.com/collective/`
**Audit method:** Direct in-platform observation (browser sessions), cross-referenced against master build spec, R148 member inventory, R149 DSC inventory, R171/R172 dev notes, collective_communications_audit.md, collective_admin_and_ma_inventory.md, and capavate_collective_sync_schema.md.
**Deployment status:** Collective deploys at `capavate.com/collective/` as a strictly additive routing rule. The Wix marketing site at `capavate.com` is never touched. React base path is `/collective/`; cookie domain is `.capavate.com`. Auth is shared with Capavate via a single Auth0/JWT tenant.

---

## 1. INVESTOR DASHBOARD / HOME

**URL:** `/collective/#/`  
**Route alias:** `/collective/` → hash-routing entry point

### Layout Architecture

The Collective dashboard uses a **three-column layout**, matching the Capavate investor dashboard structure:

| Column | Width (approx) | Content |
|--------|---------------|---------|
| Left sidebar | ~23% | Identity panel + full navigation tree |
| Center | ~55% | Two-panel communication center (Messages left / Posts right) |
| Right | ~22% | Investor analytics widgets |

### Left Sidebar — Identity Panel

| Element | Details |
|---------|---------|
| Avatar | Profile photo circle (~48px), initials fallback |
| Screen name | Public pseudonym (e.g. "MyScreenName!") — NOT real name |
| Role badge | "Accredited Investor" (or member tier label) |
| Network badge | "Member of Capavate Angel Network" — green pill, star icon |
| Status indicator (top header) | "Investor: NOT on a cap table" (red badge) OR "Investor: on cap table" |
| KYC badge | KYC verification status chip (pending / verified / rejected) — NEW vs. live Capavate |
| Location | City, Province, Country (📍 icon) |
| Investment type | Investor type from profile (💼 icon) |
| Chapter | Regional chapter assignment pill (e.g. "APAC Chapter") |
| Notification bell | 🔔 Bell icon with unread count badge — NEW vs. live Capavate |

### Left Sidebar — Navigation Tree (Full Sitemap)

```
DASHBOARD
├── Dashboard Home                  /collective/#/
├── Deals (Deal Room)               /collective/#/deals
│   └── Company Deal Detail         /collective/#/deals/:id
│   └── SPV Deal Detail             /collective/#/deals/:spv_id
├── Members                         /collective/#/members
├── Chapters                        /collective/#/chapters
├── Calendar / Events               /collective/#/calendar
├── Monthly Investor Meetings       /collective/#/meetings
├── Investments (My Positions)      /collective/#/investments
├── Connections                     /collective/#/connections
├── Consortium Partners             /collective/#/consortium
├── Profile                         /collective/#/profile
├── Personal CRM                    /collective/#/crm
├── Ask Expert                      /collective/#/ask
│   └── Outcome Log                 /collective/#/outcome-log
├── M&A Intelligence                /collective/#/ma-intelligence
├── Knowledge Hub                   /collective/#/knowledge-hub
├── Screening Recaps                /collective/#/recaps
├── Legal                           /collective/#/legal
└── Apply to Collective             /collective/#/register/* OR /collective/apply
```

**DSC Committee Members** additionally see:
```
├── DSC Committee / Screening Queue /collective/#/dsc
└── DSC Screening Room (per co.)    /collective/#/screening/:review_id
```

**Admin users** additionally see:
```
├── SPV Admin                        /collective/#/spv (admin only)
├── Algorithm Console                /admin/algorithms (admin only)
└── Lifecycle Policy                 /admin/lifecycle-policy (admin only)
```

### Center Column — Dashboard Communication Center

**Left box: "Messages from Shareholders"**

| Element | Details |
|---------|---------|
| Section header | "Messages from Shareholders" + 💬 icon |
| Refresh button | 🔄 circular arrows icon |
| "View All Messages" CTA | Red/coral pill button, 💬 icon |
| Filter tabs | All / ★ Starred (N) / ↓ Newest |
| Conversation row | Avatar (40px, initials/photo, colored) + Screen name + Type badge (Company/Investor) + Date (e.g. "Apr 19") + ★ Star icon (hollow or filled-orange) + green online dot + preview text |
| Empty state | Speech bubble illustration + "No conversations yet" |

**Right box: Post Composer + Feed**

| Element | Details |
|---------|---------|
| Post composer row | Current user avatar (~40px) + "Start a post" placeholder input + 🔄 Refresh icon |
| Feed filter tabs | All / ★ Starred (N) / ↓ Newest |
| Post card structure | Avatar (48px) + Bold screen name + Timestamp (relative: "14d ago") + ••• more options + Network badge pill (gold: "🏅 Capavate Angel Network") + Role badge pill (green: "💼 Investor") + 📍 Location + Post body text/image + 👍 N / 💬 N / ↗ Share + "Follow [Name]" OR "Following" toggle button |

### Right Column — Analytics Widgets

| Widget | Fields | Current Live State |
|--------|--------|--------------------|
| **Investor Reports** | Total Portfolio Companies (3) · Total Investor Reports Reviewed (0) · Number of Participating Rounds (1) | Populated with seed counts |
| **My Ownership Distribution** | Pie/donut chart of ownership % by company | Empty state (no chart data for test account) |
| **Portfolio Statistics and Status** | Investment count, total committed, total confirmed | Empty state for test account |

---

## 2. COMPANY DETAIL PAGE (COLLECTIVE VERSION)

**URL pattern:** `/collective/#/deals/:company_id`  
**Also:** `/collective/#/deals/:spv_id` for SPV standalone deals

### Company Header Banner

Full-width dark banner (brand color from company's brand_color field):

| Element | Details |
|---------|---------|
| Company logo | Circle with initials, ~64px |
| Company name | Large, bold H1 |
| Tagline | One-sentence headliner (from company profile) |
| Tags row | 📍 Location pill · 👥 Employee count pill · 🏛 Visibility status pill (public/private) · 🌐 Website link |
| Auto-tier badge | **Watch** / **Qualified** / **Featured** / **Priority** — driven by composite M&A+Round score |
| Composite score display | "Composite score {N} · M&A {N} · Round {N}" — visible to DSC members; non-DSC see only `auto_tier` |
| "💬 Message" CTA | White outline button, top-right of banner |

### Stats Row (below banner)

| Icon | Label | Value Example |
|------|-------|---------------|
| 🏭 | Industry | Fintech & Digital Payments |
| 📅 | Incorporated | Mar 14th, 2023 |
| 👥 | Employees | 11–50 |
| 🔢 | Business No. | 765432109 |
| 📈 | Stage | Seed / Series A |

### Tab Navigation Bar

The Company Detail page uses **true tab switching** (not scroll anchors — unlike the current broken live Capavate modal). Each tab loads distinct content:

1. **Overview** — Company profile, legal entity, problem/solution, competitive landscape
2. **Team** — Founder and team member cards
3. **Traction** — Revenue, growth metrics, KPIs
4. **Financials** — ARR, burn rate, runway, gross margin
5. **Round Terms** — Instrument type, valuation, round size, discount/cap, investor rights
6. **Documents** — Gated dataroom documents (per `dataroom_grants`)
7. **Your Decision** — Soft-circle form, accept/decline, request-info *(see detailed section below)*

---

### TAB 1: Overview

**Section A — Summary Cards (top row)**

| Card | Fields |
|------|--------|
| LEGAL ENTITY | Entity name · Entity type + Country (e.g. "Corporation — Canada") |
| TOTAL SHARES OUTSTANDING | Share count · "N Founders" sub-label |
| CURRENT SHARE PRICE | Price (4 decimal places) |
| BUSINESS MODEL | Business model type · Revenue type (e.g. "Recurring Revenue") |

**Section B — Problem & Solution**

| Sub-section | Content |
|-------------|---------|
| PROBLEM | Free text description of the problem the company solves |
| SOLUTION | Free text description of the company's solution |

**Section C — Legal & Governance**

| Field | Example Value |
|-------|---------------|
| Legal Entity | Capavate Inc. |
| Entity Type | Corporation |
| Business Number | 765432109 |
| Jurisdiction | Canada (Ontario) |
| Law Firm | Foglers Rubinoff |
| Regulatory Compliance | Compliant |
| Formal Board | Yes / No |
| IP Holdings | Yes / No |
| Financials Audited | Yes / No |

**Section D — Market Presence**

| Field | Value |
|-------|-------|
| Active Geographies | Multi-select tags |
| Customer Segments | Text |
| Revenue Concentration Risk (>30%) | Yes / No |
| Exclusivity Clauses | Yes / No |

**Section E — Strategic Priorities (Next 24 Months)**

| Field | Value |
|-------|-------|
| Strategic Priorities | Narrative text |
| Types of Partners Sought | Tags |
| Interested In | Structured exit interest tags |
| Would Not Consider | Exclusion tags (e.g. "Sale of Control") |

**Section F — Competitive Landscape Table**

| Column | Notes |
|--------|-------|
| # | Row number |
| COMPETITOR | Competitor name |
| WEBSITE | URL |
| NOTES | Free text |

**Section G — SPV/Soft-Circle Pill (conditional)**

When the company has an active SPV attached, an `SpvPill` component renders below the competitive landscape. For basket SPVs (multi-company), the pill shows:
- SPV name + LIVE/DRAFT status badge
- "MULTI-DEAL SPV · N COMPANIES" vehicle badge
- "THIS DEAL IS 1 OF N COMPANIES IN THIS SPV'S BASKET" headline
- Constituent company chips: current company rendered first with Hydra Teal background + white checkmark + "· this deal" suffix; other companies in pill format
- SPV stats: target raise, min/max check, fees (Upfront $N · Raise N% · Carry N%)

---

### TAB 2: Team

| Element | Details |
|---------|---------|
| Founder card(s) | Photo/avatar + Name + Title + LinkedIn link |
| Team member cards | Photo/avatar + Name + Title |
| Advisor cards (if any) | Photo/avatar + Name + Title + Area of expertise |

---

### TAB 3: Traction

| Field | Notes |
|-------|-------|
| ARR / MRR | Revenue metric with currency |
| Revenue Growth (MoM / YoY) | Percentage |
| Key KPIs | Company-defined metrics (up to 5) |
| Customer count | Number |
| NPS / Churn | If provided |

---

### TAB 4: Financials

| Field | Notes |
|-------|-------|
| Annual Recurring Revenue | Currency |
| Gross Margin | % |
| Burn Rate | Monthly burn |
| Runway Months | Computed from burn + cash balance |
| Total Raised to Date | Currency |
| Last Round Date | Date |
| Last Round Type | SAFE / Note / Seed / Series A etc. |
| Last Valuation | Pre-money + post-money |

---

### TAB 5: Round Terms

| Field | Notes |
|-------|-------|
| Instrument Type | SAFE / Convertible Note / Preferred Equity / Common Equity |
| Round Name | Pre-Seed / Seed / Series A / etc. |
| Pre-Money Valuation | Currency |
| Round Size (target) | Currency |
| Round Size Closed (soft-circle running total) | Currency |
| Discount Rate | % (for SAFEs/notes) |
| Valuation Cap | Currency (for SAFEs/notes) |
| Investor Rights | Pro-rata / ROFR / Co-Sale / Board Seat / Observer |
| Expiry Date | Invitation expiry |
| Lead Investor | Name + designation |
| Co-investors | Array of names |

---

### TAB 6: Documents

| Element | Notes |
|---------|-------|
| Document list | Gated per investor; shows documents granted via `dataroom_grants` |
| Document row | Document name + type + upload date + download button |
| Empty state | "No documents available for this investor" |
| Access note | "Access granted by [Company Name]" |

---

### TAB 7: YOUR DECISION (Critical — Full Detail)

**URL anchor:** `/collective/#/deals/:id` → "Your Decision" tab

This is the primary investor action surface. It replaces the broken soft-circle table in the live Capavate modal.

#### Status Banner (conditional, top of tab)

| Status | Banner text |
|--------|-------------|
| `pending` | "You have not yet viewed this deal" (info) |
| `viewed` | "You have reviewed this deal. Make your decision below." |
| `accepted` | "You have indicated acceptance. Complete your soft-circle below." |
| `declined` | "You declined this invitation. Contact the founder to re-open." |
| `soft_circled` | "Your soft-circle is submitted. Waiting for founder confirmation." (green) |
| `confirmed` | "The founder has confirmed your participation. Documents will follow." |
| `signed` | "You have signed. Awaiting funding confirmation." |
| `funded` | "Funded. This round is closed." |
| `expired` | "This invitation has expired." (red) |
| `revoked` | "This invitation has been revoked." (red) |

#### Decision Controls

**Step 1 — Accept / Decline radio**

| Control | Type | Label |
|---------|------|-------|
| Accept | radio | "Accept this investment opportunity" |
| Decline | radio | "Decline — not the right fit" |

**Step 2 (conditional on Accept) — Soft-Circle Form**

| Field | Input Type | Required | Notes |
|-------|-----------|---------|-------|
| INVESTMENT AMOUNT | numeric + currency selector | Yes | Currency options: USD / CAD / GBP / EUR / SGD / HKD / AUD |
| SOFT-CIRCLE TYPE | radio group | Yes | Options: "Definite commitment" / "Indication of interest" / "Conditional on due diligence" |
| PERSONAL NOTE TO FOUNDER | textarea | No | Max 500 chars · placeholder: "Share your conviction, questions, or any conditions..." |

**Step 3 (conditional on Accept) — Request Info Button**

| Control | Type | Behavior |
|---------|------|---------|
| "Request More Information" | secondary button | Opens a text input to send a specific question to the founder without committing |

**Submit CTA**

| Button | Style | Action |
|--------|-------|--------|
| "Submit Soft-Circle" | Primary, Hydra Teal | `PATCH /api/rounds/{round_id}/invitations/{invitation_id}/decision` |
| "Decline" | Destructive red outline | Same endpoint, `status: 'declined'` |

**State transitions (investor-actionable):**

```
pending → viewed (auto on tab open)
viewed → accepted | declined | soft_circled
accepted → soft_circled | revoked (founder)
soft_circled → confirmed (founder) | revoked (founder)
confirmed → signed (system, after e-sig)
signed → funded (system, after close)
```

**Signature Surface**  
When the round reaches `signing_open`, the "Your Decision" tab surfaces:
- Document preview (PDF viewer or download link)
- Signature block with typed/drawn signature input
- "Sign Document" submit CTA
- "Download unsigned copy" link
- Counter-signature status: "Awaiting founder counter-signature"

**Term Sheet Preview**  
Above the signature block when docs are generated:
- Summary card with: Instrument type, Amount, Valuation cap/discount, Closing conditions, Governing law
- "View full term sheet" expandable section

#### MIM Section (Members Interested in this Deal)

Below the personal decision section, a read-only panel shows:
| Element | Notes |
|---------|-------|
| Header | "Members interested in this deal" |
| Member count | "N members have soft-circled" |
| Member chips | Anonymized screen names (or real names if cap-table rules allow) |
| Total soft-circle amount | "$N total indicated" |

---

## 3. 'APPLY TO CAPAVATE COLLECTIVE' — Registration Form

**URL:** `/collective/#/register/step-{N}` (7-step wizard)  
**Entry point:** "Apply to Capavate Collective" link/button visible from Capavate investor dashboard notification or from collective landing

### Step 1 — Eligibility Verification (Auto)

**No form fields.** Server-side automatic check:
- Route: `/collective/#/register/step-1`
- The platform calls `isEligibleForCollective(userId)` server-side
- **Pass condition:** At least one of: (A) investor on a Capavate cap table, (B) founder of a Capavate company, (C) signatory on at least one Capavate company, (D) vouched by a consortium partner with weight ≥ 1

**If not eligible:**
- Waitlist modal displayed (current live behavior from `capavate.com/collective/` public page)
- Text: "You need a verifiable position on a Capavate cap table or a partner vouch to access the Collective."
- "Join waitlist" CTA

**If eligible:**
- Auto-advance to Step 2
- Banner: "Eligibility verified — welcome to the application"

---

### Step 2 — Membership Application Form

**Route:** `/collective/#/register/step-2`

| Field Label | Input Type | Required | Notes |
|-------------|-----------|---------|-------|
| INVESTMENT THESIS (ONE PARAGRAPH) | textarea | Yes | Max 1000 chars · "Describe your investment focus, sectors, and what you bring to portfolio companies" |
| MINIMUM CHECK SIZE | numeric + currency select | Yes | Min $5,000; defaults to $25,000 |
| MAXIMUM CHECK SIZE | numeric + currency select | Yes | Must be ≥ min check size |
| SECTORS OF FOCUS | multi-select chips | Yes | Same 45-industry list as investor profile Step 3 |
| PREFERRED STAGES | multi-checkbox | Yes | Pre-Seed / Seed / Series A / Series B / Series C+ / Growth / Late Stage |
| GEOGRAPHIC FOCUS | multi-checkbox | Yes | Home Market Only / Home Country / Open to Global / Cross-Border |
| MEMBER TIER | select/radio | Yes | Tier options managed by Capavate admins; pricing tied to tier |
| REFERRAL / PARTNER CODE | text | No | Consortium partner co-branded registration: `?cp={partner_slug}` pre-fills this field |

**Pricing note (below tier selector):**  
*"Pricing is tied to your selected Member Tier. Capavate sets tier dues, perks, and discounts; pick the tier that best fits your structure."* (R148-corrected copy — no longer says "managed by Capavate admins")

**Navigation:** ← Previous (Step 1) | Next → (Step 3)

---

### Step 3 — KYC Document Upload

**Route:** `/collective/#/register/step-3`

| Field Label | Input Type | Required | Notes |
|-------------|-----------|---------|-------|
| PASSPORT (or Government-issued ID) | file upload | Yes | PDF/JPG/PNG · max 10MB |
| PROOF OF ADDRESS | file upload | Yes | Bank statement, utility bill, government letter · issued within 90 days |
| ADDITIONAL DOCUMENTATION | file upload (multiple) | No | "Upload any additional KYC/AML documentation" |

**KYC Provider banner:**  
*"Your documents are processed securely via [Persona / Sumsub / Onfido / Veriff]. Capavate and our KYC provider are both bound by data processing agreements under GDPR, PIPEDA, and applicable local law."*

**Sanctions check notice:**  
*"We conduct PEP and sanctions screening against OFAC, UK HMT, EU consolidated, UN, MAS, and HKMA lists. Screening is automatic on document submission."*

**Navigation:** ← Previous | Next →

---

### Step 4 — Accreditation Verification

**Route:** `/collective/#/register/step-4`

Fields adapt by `contact_country`:

| Jurisdiction | Fields |
|-------------|-------|
| **United States** | Annual income (>$200k individual / >$300k joint, 3-year average) OR net worth (>$1M excluding primary residence) OR third-party letter (upload CPA/attorney letter) |
| **Canada** | Net income >$200k CAD (individual) OR net assets >$1M CAD [NI 45-106] |
| **United Kingdom** | HNW: income >£100k OR assets >£250k · OR Sophisticated Investor self-cert checkbox |
| **EU (MiFID II)** | Professional client declaration checkboxes per MiFID II criteria |
| **Singapore** | Accredited Investor declaration per SFA §4A — income or asset threshold checkboxes |
| **Hong Kong** | Professional Investor declaration per SFO s.1 Part 1 Sch 1 |
| **Other jurisdictions** | Generic accreditation self-declaration checkbox + note field |

**Stored as:** `accreditation_status`: `verified` / `self-cert` / `pending` / `rejected`

**Key principle:** This single `kyc_accreditation` table row becomes the source of truth for both the investor profile sidebar AND the profile Step 2 form — eliminating the contradiction observed in the current live Capavate platform where sidebar says "Accredited Investor" but form shows "No – Non-Accredited."

**Navigation:** ← Previous | Next →

---

### Step 5 — Payment

**Route:** `/collective/#/register/step-5`

| Element | Details |
|---------|---------|
| Membership fee | $1,200 USD/year (annual; or tier-adjusted amount) |
| Payment processor | Stripe embedded checkout |
| Card fields | Standard Stripe Elements: Card number / Expiry / CVC / Cardholder name / Billing address |
| Alternative | "Pay by invoice" link (admin-approved only) |
| Fee breakdown | Annual membership · Selected tier · Any consortium partner discount applied |

**Navigation:** ← Previous | Submit (Stripe payment capture)

---

### Step 6 — Admin Review Queue

**Route:** `/collective/#/register/step-6`

**No form fields.** Application is in review status.

**States:**
- `submitted` → `reviewing` → `accepted` | `rejected` | `waitlisted`

**Display:**
| Element | Details |
|---------|---------|
| Status badge | "Under Review" (amber) |
| Timeline | Submitted [date] · Under Review [date] · Decision expected within N business days |
| Summary card | Application summary (thesis excerpt, check size, sectors, tier) — read-only |
| "Edit application" link | Allowed while in `submitted` or `reviewing` status |

---

### Step 7 / Confirmation — `/collective/#/register/pending`

| Element | Details |
|---------|---------|
| Status | "Application submitted" OR "Application accepted — welcome to the Collective" |
| Welcome message (on acceptance) | "Your membership is now active. Your first month's access starts today." |
| Welcome email | Dispatched via EmailSenderProvider on `status = 'active'` |
| Next steps CTA | "Explore the Deal Room →" / "Set up your profile →" |
| Annual fee confirmation | Receipt link |

---

### Registration Validation Rules

| Rule | Behavior |
|------|---------|
| Required fields | Red asterisk (*); inline error on blur |
| Check size: min ≤ max | Inline error: "Maximum check size must be greater than minimum" |
| KYC document max size | Toast error: "File exceeds 10MB limit. Please compress or use PDF." |
| File type | Toast error: "Only PDF, JPG, PNG accepted." |
| Payment failure | Stripe error message inline; "Try another card" CTA |
| Duplicate application | Toast: "You already have an active or pending application." |
| Eligibility re-check | Server re-validates eligibility at Step 2 submit (prevents race conditions) |

---

## 4. CRM-STYLE FEATURES (COLLECTIVE)

### 4A. Personal CRM (`/collective/#/crm`)

The Collective includes a **per-member private rolodex** (`pcrm_contacts`, `pcrm_notes`, `pcrm_tasks` tables), distinct from the founder-side Capavate CRM.

**Page layout:** Three-panel CRM view

**Contact list (left panel):**

| Element | Details |
|---------|---------|
| Search | "Search by name, firm, or tag..." |
| Filter tabs | All / Founders / Investors / Co-investors / Partners |
| Contact row | Avatar + Full name + Company/Firm + Last touchpoint date + Tag chips |
| "Add Contact" CTA | "+ Add contact" button (opens inline form or modal) |
| Empty state | "No contacts yet. Log your first touchpoint above." |

**Contact card (center panel):**

| Field | Details |
|-------|---------|
| Name | Full name |
| Role | Founder / Investor / Co-investor / Partner / Other |
| Company | Company name |
| Email | Contact email |
| LinkedIn | URL |
| Tags | Free-text multi-tag chips |
| Notes section | Timestamped notes log (append-only) |
| Tasks section | Task list with due date + status |
| Deal links | Links to deal(s) this contact is associated with |

**Note log fields:**

| Field | Details |
|-------|---------|
| Note text | Free text (no max observed) |
| Timestamp | Auto-set to now |
| Type tag | Call / Email / Meeting / Message / Other |
| "Log note" button | Appends to log |

**Task fields:**

| Field | Details |
|-------|---------|
| Task title | Text |
| Due date | Date picker |
| Priority | Low / Medium / High |
| Status | To-do / In Progress / Done |

### 4B. Connections (`/collective/#/connections`)

**Lane-based co-investor/network tracking:**

| Lane | Content |
|------|---------|
| **Cap Table Connections** | Co-investors on the same cap table(s) |
| **Round Connections** | Co-participants in the same active round |
| **DSC Connections** | Fellow DSC committee members (DSC-only) |
| **Angel Network Connections** | General Capavate Angel Network connections |
| **Social Connections** | Follows / followers in the social feed |

**Contact card in connections:**

| Element | Details |
|---------|---------|
| Avatar (48px circle) | Screen name initials or photo |
| Screen name | Public pseudonym |
| Type badge | "Investor" / "Founder" / "DSC Member" / "Partner" |
| Chapter badge | Regional chapter if applicable |
| Shared context | "Co-invested in [Company]" / "Same round: [Round]" |
| "Message" CTA | Opens DM thread |
| "Add to CRM" CTA | Adds to PersonalCrm |

---

## 5. PORTFOLIO / HOLDINGS VIEWS

### 5A. Investments Page (`/collective/#/investments`)

**Page title:** "My Investments"

| Element | Details |
|---------|---------|
| Summary stats bar | Total invested · Total portfolio companies · Active rounds · IRR (if computable) |
| Table / card toggle | Toggle between card grid and table view |
| Card view fields | Company logo + name + sector chip + stage chip + amount invested + round name + status badge (active/exited/pending) |
| Table columns | Company · Sector · Round · Instrument · Amount · Status · Date · Actions |
| Filter tabs | All / Active / Exited / Pending |
| Search | Free-text search by company name |
| Empty state | "You have no investments tracked here yet. Investments appear when confirmed by the company." |

### 5B. Portfolio Analytics (Dashboard Widgets)

| Widget | Fields |
|--------|--------|
| **My Ownership Distribution** | Pie/donut chart: % ownership per company (relative to capital deployed) |
| **Portfolio Statistics and Status** | Total portfolio companies · Active positions · Total committed · Total confirmed · Avg check size |
| **Participating Rounds** | Count of rounds with active participation |

### 5C. Watch-list / Discover Integration

Deals marked as "Interested" in the deal room appear in the investor's personal watchlist, accessible from the dashboard sidebar. Field parity with deal room cards.

---

## 6. M&A INTELLIGENCE SURFACES

### 6A. M&A Intelligence Page (`/collective/#/ma-intelligence`)

**Purpose:** Read-only investor view of the platform's M&A readiness ranking for companies in the deal room.

**Page layout:**

| Element | Details |
|---------|---------|
| Sort controls | Sort by: Composite Score ↓ / M&A Score ↓ / Round Score ↓ / Company Name A-Z |
| Filter chips | By sector · By stage · By chapter · By tier (Watch/Qualified/Featured/Priority) |
| Company row | Company name + sector chip + auto_tier badge + "Composite score {N} · M&A {N} · Round {N}" |
| Tier filter | Watch (0–24) / Qualified (25–49) / Featured (50–74) / Priority (75–100) |

**Score interpretation (member-visible):**

| Score | What it represents |
|-------|-------------------|
| **Composite** | Weighted blend of M&A + Round scores; drives `auto_tier` |
| **M&A** | M&A readiness: company maturity, IP ownership, revenue traction, market size, strategic buyer landscape, exit comparables |
| **Round** | Round attractiveness: terms quality, check-size fit with Collective members, valuation reasonableness, timing |

**Access control:**
- Regular members: see `auto_tier` + composite score only
- DSC members: see `composite_score`, `mna_score`, `round_score` individually
- Admin: sees full AlgorithmConsole including weight tuning

### 6B. M&A Intelligence on Deal Cards (Deal Room)

Each deal card in `/collective/#/deals` includes:
- Auto-tier badge: **Watch** / **Qualified** / **Featured** / **Priority**
- Composite score (number) if DSC member; tier label if regular member
- "M&A readiness" label on card hover/expand

### 6C. M&A Intelligence in DSC Screening Room

Per the R149 inventory, each company in the DSC open-review list shows:
```
Composite score {co.compositeScore} · M&A {co.mnaScore} · Round {co.roundScore}
```
These three scores are computed by the `AlgorithmsProvider` and are legitimately visible to DSC committee members.

### 6D. Acquirer Fit / Comparable Exits

The M&A intelligence surface currently shows:
- `mna_score` inputs include "strategic buyer landscape" and "exit comparables" as factors
- The 15-question strategic screening framework (separate qualitative layer from scoring) covers: governance, financial hygiene, business model, IP defensibility, team execution, market position, regulatory compliance, operational maturity
- **Current limitation:** Specific acquirer-company matching and comparable exit tables are NOT directly exposed to members in v1.0; they feed into the `mna_score` algorithm but are not broken out into a named "Acquirer Fit" section

---

## 7. COMMUNICATIONS

### 7A. Direct Messaging (Shared with Capavate)

Fully documented in `collective_communications_audit.md`. Summary:
- **Messages modal overlay** (not a separate page route)
- Split left-list / right-thread layout
- Sender: coral/red right-aligned bubbles; Recipient: white left-aligned bubbles
- Double-checkmark ✓✓ read receipts
- Date dividers ("April 10, 2026")
- 😊 Emoji picker + 📤 Send button
- Thread gating: `canCommunicate()` requires shared cap table, shared round participation, OR same DSC committee

### 7B. Posts / Social Feed (Shared with Capavate)

- Same post card structure as Capavate investor dashboard
- Post composer: "Start a post" + avatar + refresh
- Feed filters: All / Starred / Newest
- Post card: avatar + screen name + Network badge + Role badge + location + content + 👍 / 💬 / ↗ + Follow toggle

### 7C. Soft-Circle Threads

When an investor submits a soft-circle, the "Your Decision" tab surfaces:
- A chronological message thread between the investor and founder specific to the round
- The founder can respond to the soft-circle note
- This is separate from the general DM thread

### 7D. Monthly Meeting Communications

Via `/collective/#/meetings`:
| Element | Details |
|---------|---------|
| Meeting card | Date · Zoom join URL · Agenda items · Recording link (post-meeting) |
| RSVP controls | "Attending" / "Not attending" radio |
| RSVP cutoff | `rsvpCutoffHours` before meeting (admin-configurable) |
| Recording library | Post-meeting recording archive |

### 7E. Ask Expert (`/collective/#/ask`)

Threaded expert Q&A surface:
| Element | Details |
|---------|---------|
| Question composer | "What would you like to ask?" text area + category select (Legal / Tax / Accounting / M&A / Other) |
| Expert routing | Questions routed to consortium partner experts by category |
| Answer thread | Expert name + firm (NOT tier in member view) + answer text |
| Outcome log link | "View past answers from this expert" |

---

## 8. NAVIGATION MAP (FULL SITEMAP)

### Collective Member Routes

| Route | Page | Persona |
|-------|------|---------|
| `/collective/` or `/collective/#/` | Dashboard | All members |
| `/collective/#/deals` | Deal Room | All members |
| `/collective/#/deals/:id` | Company Deal Detail | All members |
| `/collective/#/deals/:spv_id` | SPV Deal Detail | All members |
| `/collective/#/members` | Member Directory | All members |
| `/collective/#/chapters` | Chapter Directory | All members |
| `/collective/#/calendar` | Events Calendar | All members |
| `/collective/#/meetings` | Monthly Investor Meetings | All members |
| `/collective/#/investments` | My Investments | All members |
| `/collective/#/connections` | Network Connections | All members |
| `/collective/#/consortium` | Consortium Partners | All members |
| `/collective/#/profile` | Member Profile (3 steps) | All members |
| `/collective/#/crm` | Personal CRM | All members |
| `/collective/#/ask` | Ask Expert | All members |
| `/collective/#/outcome-log` | Ask Expert Outcome Log | All members |
| `/collective/#/ma-intelligence` | M&A Intelligence | All members |
| `/collective/#/knowledge-hub` | Knowledge Hub (660+ articles) | All members |
| `/collective/#/recaps` | Screening Recaps | All members |
| `/collective/#/legal` | Legal Resources | All members |
| `/collective/#/register/step-1` | Registration — Eligibility Check | Applicants |
| `/collective/#/register/step-2` | Registration — Application Form | Applicants |
| `/collective/#/register/step-3` | Registration — KYC Upload | Applicants |
| `/collective/#/register/step-4` | Registration — Accreditation | Applicants |
| `/collective/#/register/step-5` | Registration — Payment ($1,200/yr) | Applicants |
| `/collective/#/register/step-6` | Registration — Review Queue | Applicants |
| `/collective/#/register/pending` | Registration — Confirmation | Applicants |
| `/collective/#/syndicates` | Syndicate Applications | All members |

### DSC Committee Members (Additional Routes)

| Route | Page |
|-------|------|
| `/collective/#/dsc` | DSC Screening Queue |
| `/collective/#/screening/:review_id` | DSC Screening Room per company |

### Admin Routes (Collective)

| Route | Page |
|-------|------|
| `/collective/#/spv` | SPV Admin (R171) |
| `/admin/algorithms` | Algorithm Console (gated `isAdmin`) |
| `/admin/lifecycle-policy` | Lifecycle Policy — Platform Defaults / Group Rules / Company Overrides / Audit Log |
| `/admin/spv` | SPV Management cards |
| `/admin/audit-log` | Audit log with hash chain |

### Design Tokens

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

## 9. STRUCTURAL GAPS AND KNOWN LIMITATIONS

### In-Platform vs. Build Spec Status

| Feature | Collective Build Status | Notes |
|---------|------------------------|-------|
| Deal Room with tier cards | LIVE (sandbox/in-sandbox) | 79+ routes built; backend wiring pending for production |
| DSC Scoring rooms | LIVE (in-sandbox) | Audited in R149; admin-only algorithm tuning |
| SPV Admin | LIVE (admin-only, R171/R172) | Real-name founder picker; enriched metadata strip |
| Personal CRM | BUILT (in-sandbox) | pcrm_contacts / pcrm_notes / pcrm_tasks tables |
| Monthly Meetings (Zoom) | BUILT | Recording library, RSVP cutoff |
| Chapter Directory | BUILT | Lead member, member count, capital deployed YTD |
| Registration Wizard | BUILT | 7-step flow with KYC provider integration |
| Payment (Stripe) | WIRED | $1,200/year annual fee |
| M&A Intelligence page | BUILT | composite/mna/round scores visible to DSC |
| Ask Expert | BUILT | Partner routing by category |
| Consortium Partners | BUILT | Vouching weight, co-branded landing, commission plans |
| Production backend wiring | PENDING (Q1 milestone) | All 51 Providers to Postgres; E8 epic in sprint plan |
| Auth0 SSO federation | DECIDED (locked 2026-05-08) | Single tenant, per-product application |
| Live Collective at capavate.com/collective/ | PENDING | Currently shows waitlist modal for non-eligible users |

---

## APPENDIX: KEY VARIABLE INVENTORY (COLLECTIVE-ONLY FIELDS)

| Variable | Domain | Source | Notes |
|----------|--------|--------|-------|
| `composite_score` | M&A Intelligence | AlgorithmsProvider | Weighted blend; drives auto_tier |
| `mna_score` | M&A Intelligence | AlgorithmsProvider | M&A readiness dimension |
| `round_score` | M&A Intelligence | AlgorithmsProvider | Round attractiveness dimension |
| `auto_tier` | Deal Sourcing | Computed | Watch/Qualified/Featured/Priority |
| `deal_stage_override` | Deal Sourcing | Admin | Manual tier override with reason |
| `member_tier` | Membership | Admin | Individual / Plus / etc. |
| `chapter_id` | Chapters | Admin | Non-overlapping geographic assignment |
| `pcrm_contacts` | Personal CRM | Member | Private rolodex |
| `pcrm_notes` | Personal CRM | Member | Timestamped note log |
| `pcrm_tasks` | Personal CRM | Member | Task list with due date |
| `dsc_vote` | DSC | DSC member | Recommend/Neutral/Pass + 5-dimension scoring |
| `spv_subscription` | SPV | Member | Soft-circle subscription amount + seal |
| `signature_seal` | SPV | System | Client-side SHA-256 chain with 5-min replay window |
| `monthly_meeting_id` | Meetings | Admin | Zoom meeting ID + join URL |
| `screening_rsvp` | DSC / Meetings | Member | RSVP status + cutoff |
| `accreditation_status` | KYC | System/KYC provider | verified / self-cert / pending / rejected |
| `collective_eligibility_audit` | Eligibility | System | Trigger, old/new status, timestamp |
| `partner_vouch_weight` | Consortium | Admin | 1–5 scale; higher = more authority |
| `referral_record` | Consortium | System | First-referral-wins lock-once attribution |
| `collective_memberships.status` | Membership | System | submitted / reviewing / accepted / active / suspended |
| `ask_thread` | Ask Expert | Member | Thread routed to partner by category |
| `ask_outcome` | Ask Expert | Partner | Answer with attribution chip (firm name, NOT tier) |
