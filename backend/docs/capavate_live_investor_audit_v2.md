# Capavate Live Investor Side — Audit v2
**Audit Date:** 2026-05-09
**Auditor:** Audit subagent (avinayquicktech@gmail.com — investor persona)
**Platform URL:** `https://capavate.com/investor/` (live production)
**Previous audit:** `capavate_investor_deep_audit.md` (2026-05-08)
**Focus of v2:** Invitations tab, Portfolio page, Discover Companies tab, Dashboard widgets, CRM presence, broken/stub surfaces.
**Cross-reference sources:** `capavate_investor_deep_audit.md`, `capavate_investor_audit.md`, `collective_communications_audit.md`, `capavate_master_build_spec.md`, `capavate_r165_to_r200_bridge.md`

---

## ARCHITECTURE QUICK REFERENCE

| Portal | URL | Login page | Auth |
|--------|-----|------------|------|
| Company/Founder | `/dashboard` | `/user/login` | Separate JWT session |
| Investor / "Collective" (live) | `/investor/dashboard` | `/investor/login` | Separate JWT session |

**Login page exact text:**
- Title: **"Investors & Shareholders Login"**
- Subtitle: *"You're entering a secure, invitation-only investor portal."*
- Shield icon: *"Capavate's verified network."*
- Bottom banner: **"Verified Investors & Shareholders Portal 🔒 — Access restricted to invited and accredited Capavate members"**

**Stack:** Create React App + Webpack 5 (~1MB bundle) · Node/Express backend · Helmet security · JWT auth · MySQL/Postgres database · nginx hosting

---

## 1. INVITATIONS TAB

**URL:** `/investor/company-invitation-list`  
**Sidebar label:** "Incoming Invitations"  
**Navigation position:** Item 3 in left sidebar

### Invitation List Table

| Column | Content | Sort |
|--------|---------|------|
| Company Name | Text, company name | ▲ sortable |
| City | City, Province, Country | ▲ sortable |
| Sector | Industry sector tag | ▲ sortable |
| Funding Round | Round label (e.g. "N/A" — currently shows N/A for most companies) | ▲ sortable |
| Company Overview | 👁 Eye icon (red) — opens invitation modal | ▲ sortable |
| Actions | Green ✓ accept button + Red 🗑 archive/trash button |  |

**Table meta:**
- Rows per page: 10 (with pagination: "1–10 of N", navigation arrows)
- Search: "Search Here..." field (top right, free text)
- Currently observed: Multiple company invitations visible; Funding Round column shows "N/A" for all entries — this is a **known broken field** (live data not wired to round state machine)

### Invitation Row Action Buttons

| Button | Style | Current Behavior |
|--------|-------|-----------------|
| Green ✓ | Filled green circle with checkmark | Marks investor interest/acceptance; toggles to blue dot indicator after click — **PARTIALLY FUNCTIONAL** (changes state in UI only; no backend round_participants row created) |
| Red 🗑 | Filled red circle with trash icon | Archives the invitation; moves it out of active list — **FUNCTIONAL** |

### 'Review Deal' — Company Invitation Modal

**Trigger:** Click eye icon (👁) in "Company Overview" column  
**Architecture:** Single scrollable modal overlay (NOT a separate page). All 5 tab labels are scroll anchors, NOT true tab switches. **This is the primary UX bug — BROKEN.**

#### Modal Header

| Field | Example Value |
|-------|---------------|
| Modal title | "Company Invitation" |
| Sub-title | "Capital Round Invitation" |
| Company logo | Avatar placeholder circle |
| Company tagline | "This is the one sentence headliner for my company." |
| Location badge | 📍 [City, Country] |
| Sector badge | "Banking & Financial Services" |
| Employee count badge | (empty / not populated for most test companies) |
| Revenue stage badge | (empty / not populated for most test companies) |
| Website link | capavate.com |

#### Modal Tab Navigation (5 scroll anchors — BROKEN TAB SWITCHING)

| Tab Label | Intended Content | Actual Current State |
|-----------|-----------------|---------------------|
| **Overview** | Company profile, legal entity, problem/solution | PARTIALLY LIVE — shows legal entity + stats cards + Problem & Solution. Null fields present (Business Number, Jurisdiction, Entity Type blank for most companies) |
| **Cap Table** | Fully-diluted cap table snapshot | BROKEN → same content as Overview summary cards (Total Shares Outstanding: 0.00, "0 Founders" — no shareholder rows) |
| **Investment Terms** | Instrument type, valuation, round size, discount/cap | BROKEN → no separate Investment Terms section renders; content merges into Overview Legal & Governance section |
| **Data Room** | Investor-gated documents | BROKEN → no documents rendered for any test company (empty state: section does not appear) |
| **Your Decision** | Soft-circle form, accept/decline | BROKEN → shows "Investment Soft Circle" table with columns (#, Investment Amount, Invest Date, Request Confirm, View) but NO form fields. Table is empty ("No records found"). No Accept/Decline radio. No submit action. |

#### Tab 1: Overview — What Actually Renders

**Summary Cards (top row):**

| Card | Fields |
|------|--------|
| LEGAL ENTITY | Entity name (Capavate Inc. for test company) · Entity type + Country (Corporation — Canada) |
| TOTAL SHARES OUTSTANDING | Number (0.00) · Sub-label: "0 Founders" |
| CURRENT SHARE PRICE | Price (0.000) |
| BUSINESS MODEL | Model type (undefined) · Sub-label: Recurring Revenue |

**Section: Problem & Solution**
- PROBLEM: free text
- SOLUTION: free text

**Section: Legal & Governance**

| Field | Example Value |
|-------|---------------|
| Legal Entity | Capavate Inc. |
| Entity Type | Not specified |
| Business Number | Not specified |
| Jurisdiction | Not specified |
| Law Firm | Foglers Rubinoff |
| Regulatory Compliance | Compliant |
| Formal Board | (blank) |
| IP Holdings | (blank) |
| Financials Audited | (blank) |

**Section: Market Presence**

| Field | Example Value |
|-------|---------------|
| Active Geographies | (blank) |
| Customer Segments | "No specified" |
| Revenue Concentration Risk (>30%) | Yes |
| Exclusivity Clauses | Yes |

**Section: Strategic Priorities (Next 24 Months)**

| Field | Example Value |
|-------|---------------|
| Strategic priorities text | "No strategic priorities specified" |
| Types of Partners Sought | "No Partners specified" |
| Interested In | "No specified" |
| Would Not Consider | "Sale of Control" |

**Section: Competitive Landscape Table**

| Column | Notes |
|--------|-------|
| # | Row number |
| COMPETITOR | Name |
| WEBSITE | URL |
| NOTES | Text |

(Empty for most test companies)

#### Tab 5: Your Decision — BROKEN STATE (Detailed)

**What renders:**

```
Section: "Investment Soft Circle"

Table columns:
  # | INVESTMENT AMOUNT | INVEST DATE | REQUEST CONFIRM | VIEW

Table body: "No records to display" (empty)
```

**What is MISSING that should be there:**
- ❌ Accept / Decline radio buttons
- ❌ Investment amount input field
- ❌ Soft-circle type selector (Definite / Indication / Conditional)
- ❌ Personal note to founder textarea
- ❌ "Submit Soft-Circle" primary CTA
- ❌ "Decline" button
- ❌ "Request More Information" secondary action
- ❌ Invitation status banner (pending / viewed / accepted / soft_circled / etc.)
- ❌ Round terms summary card
- ❌ Term sheet preview

**Gap reference:** `capavate_master_build_spec.md §9` — "BROKEN → wire to `/api/rounds/{id}/invitations/{id}/decision`"

#### Modal - Company Overview from Discover page

When the eye icon is clicked from `/investor/discover-companies` (not the invitation list), the company detail modal shows:

6 tabs: 🏢 Overview · 📋 Contact · 🛡️ Legal · 📊 Business · 🎯 Strategic · ⚖️ Governance

This is a different modal structure from the invitation modal (which uses Overview / Cap Table / Investment Terms / Data Room / Your Decision).

---

## 2. PORTFOLIO PAGE

**URL:** `/investor/company/watch-list`  
**Sidebar label:** "My Portfolio & Watchlist"  
**Page title (actual):** "Investor Round List" ← **LABEL BUG: sidebar says "Portfolio & Watchlist" but page is titled "Investor Round List"**

### Current State

| Element | State |
|---------|-------|
| Table | Empty — "There are no records to display" |
| Search | "Search Here..." input (functional UI, no data) |
| Pagination | No records to paginate |

### What's Missing

- ❌ No portfolio summary header (total invested, portfolio companies count, total ownership %)
- ❌ No investment cards with company name, sector, amount, round, status
- ❌ No "Active" / "Exited" / "Pending" filter tabs
- ❌ No ownership chart
- ❌ No IRR or return computation
- ❌ No sorting by date, amount, or company
- ❌ No CSV/PDF export
- ❌ No link to cap table position detail

**Disconnect with Dashboard:** The right-panel widget on `/investor/dashboard` shows "Total Portfolio Companies: 3" — but the Portfolio page shows zero records. This is a **data reconciliation gap**. The dashboard stat is derived from the social "Angel Profile" portfolio list (companies the investor follows), while the "Investor Round List" is meant to show confirmed round_participants records. These two data sources are not reconciled.

**Gap reference:** `capavate_master_build_spec.md §4.3` — "Reconcile 'Investor Round List' vs. social portfolio count [investor-audit GAP #5]"

---

## 3. DISCOVER COMPANIES TAB

**URL:** `/investor/discover-companies`  
**Sidebar label:** "Discover Companies"  
**Status:** LIVE (but being removed per build plan — documented here for reference only)

### Filter Controls

| Control | Type | Current State |
|---------|------|---------------|
| All [27] | Tab filter | 27 total companies in network |
| ❤️ Interested [0] | Tab filter | 0 companies marked interested |
| Not Interested [27] | Tab filter | All 27 in not-interested state |
| Search Here... | Text search | Free text (functional) |

### Table Columns

| Column | Content | Sortable |
|--------|---------|----------|
| Company Name | Text only (NOT clickable to detail) | Yes ▲ |
| Location | City, Province, Country, Postal Code | Yes |
| Date of Incorporation | "Mar 14th, 2023" format | Yes |
| Company Overview | 👁 Eye icon (red) — opens company overview modal | Yes (header) |
| Actions | "❤️ Mark Interested" outline button per row | No |

**Table meta:**
- 10 rows per page; pagination: "1–10 of 27"
- Company name is NOT a clickable link — only the eye icon navigates to detail

### Mark Interested / Not Interested

| Action | UI | Behavior |
|--------|-----|---------|
| "❤️ Mark Interested" | Gray outline button | Moves company to "Interested" tab |
| Company in "Interested" tab | — | Button changes to reflect interested state |

### What's Missing

- ❌ No sector / stage filter chips
- ❌ No M&A score or tier indicator on list rows
- ❌ No round status (active fundraising badge)
- ❌ No investment amount requested column
- ❌ No valuation column

**Replacement plan:** This page will be replaced by `/app/investor/discover` in the rebuild, which differentiates open/all companies (investor discovery) vs. Collective deal room (vetted/scored only). Per master build spec §4.3.

---

## 4. DASHBOARD WIDGETS

**URL:** `/investor/dashboard`

### Full Layout (Three-Column)

| Column | Width | Content |
|--------|-------|---------|
| Left | ~23% | Identity panel + navigation sidebar |
| Center | ~55% | Messages panel (left ~35%) + Posts feed (right ~65%) |
| Right | ~22% | Investor Reports widget + Ownership widget + Portfolio Stats widget |

### Left Sidebar — Full Navigation

| # | Label | URL | Status |
|---|-------|-----|--------|
| 1 | Edit Profile | `/investor/profile` | LIVE |
| 2 | My Portfolio & Watchlist | `/investor/company/watch-list` | LIVE (empty) |
| 3 | Incoming Invitations | `/investor/company-invitation-list` | LIVE |
| 4 | Archived Page | `/investor/company-list/archive` | LIVE (empty) |
| 5 | My Contacts & Connections | `/investor/contact-connections` | LIVE (empty) |
| 6 | Discover Companies | `/investor/discover-companies` | LIVE (being removed) |
| 7 | Knowledge Hub | `/investor/knowledge-hub` | LIVE |
| 8 | Angel Profile | Eye icon visibility toggle | LIVE |
| 9 | Dashboard HOME | Top bar button | LIVE |

### Identity Panel Fields

| Element | Value (live example) |
|---------|---------------------|
| Avatar | 48px circle, initials or photo |
| Screen name | "MyScreenName!" |
| Role badge | "Accredited Investor" |
| Network badge | "Member of Capavate Angel Network" (green pill, star icon) |
| Status indicator | "Investor: NOT on a cap table" (red tag) |
| Location | Dellach im Drautal, Carinthia, Austria |
| Investment type | "Private equity/growth equity fund (late-stage or special situations)" |

### Center — Messages from Shareholders Panel

| Element | Details |
|---------|---------|
| Section header | "Messages from Shareholders" + 💬 icon |
| Sub-header | 🔄 Refresh icon + "💬 View All Messages" (red/coral pill) |
| Filter tabs | All · ★ Starred (1) · ↓ Newest |
| Conversation row | Avatar 40px + Name + Type badge (Company/Investor) + Date + ★ Star icon + Green dot (online) + Preview text |

**Live conversations observed:**

| # | Name | Type | Date | Preview |
|---|------|------|------|---------|
| 1 | MMM | Company | Apr 19 | 🤩😎🤘🏻🤙 (starred 🔴) |
| 2 | corpw | Company | Apr 30 | (no preview) |
| 3 | vg | Company | Apr 23 | "Start a conversation" |
| 4 | Unknown | Investor | Apr 20 | "Start a conversation" |
| 5 | A K | Investor | Apr 20 | "Start a conversation" |

### Center — Posts Feed

| Element | Details |
|---------|---------|
| Post composer | Avatar + "Start a post" input + 🔄 Refresh |
| Filter tabs | All · ★ Starred (1) · ↓ Newest |

**Live posts observed:**

| User | Badge | Location | Content | Likes | Comments |
|------|-------|----------|---------|-------|----------|
| corpw | Capavate Angel Network | Canillo, Andorra | "Gg" | 0 | 0 |
| corpw | Capavate Angel Network | Canillo, Andorra | "Capavate" | 0 | 0 |
| Ozan Isinak | Investor | Dellach im Drautal, Austria | "s" | 2 | 0 |
| Warrantcheck | Social Network Member | Mir Bachah Köt, Afghanistan | [stock photo] | 1 | 3 |

### Right Column — Investor Reports Widget

| Metric | Current Value |
|--------|--------------|
| Total Portfolio Companies | 3 |
| Total Investor Reports Reviewed | 0 |
| Number of Participating Rounds | 1 |

### Right Column — My Ownership Distribution Widget

| State | Details |
|-------|---------|
| Current | Empty / placeholder — no chart rendered |
| Expected | Pie/donut chart of % ownership by company |
| Trigger for data | Requires confirmed round_participants record (cap table position) |

### Right Column — Portfolio Statistics And Status Widget

| State | Details |
|-------|---------|
| Current | Empty / placeholder panel |
| Expected | Total invested, total confirmed, active positions, avg check size |
| Trigger for data | Requires confirmed round_participants record |

### Dashboard Analytics GAPS vs. Investor-Grade Expectations

| Gap # | Gap Description | Impact |
|-------|-----------------|--------|
| GAP #1 | Logout button is in the top bar in a confusing position — not in a profile dropdown | UX trap; accidental logout |
| GAP #2 | No notification bell / unread count badge | Investor cannot see pending decisions, new reports, round status changes |
| GAP #3 | No notification system (in-app / email / push) | Investor misses critical round events |
| GAP #4 | Dashboard stats ("Total Portfolio Companies: 3") derived from social follows, NOT from confirmed cap table positions | Misleading metric |
| GAP #5 | "My Ownership Distribution" widget always empty — never renders for any account without confirmed cap table position | Dead widget |
| GAP #6 | "Portfolio Statistics And Status" widget always empty | Dead widget |
| GAP #7 | No analytics on round participation (invited → viewed → soft-circled → confirmed funnel) | Investor has no deal pipeline visibility |
| GAP #8 | No IRR or return computation anywhere | Investor cannot assess portfolio performance |
| GAP #9 | No "Recent Activity" feed (new invitations, reports published, round milestones) | Dashboard is passive, not proactive |

---

## 5. CRM — DOES LIVE CAPAVATE HAVE ONE?

### Investor-Side CRM: ABSENT

The live investor side (`/investor/*`) does **NOT** have a CRM.

**What exists:** `/investor/contact-connections` — a contacts page with 4 tabs:

| Tab | Count (observed) | Description |
|-----|-----------------|-------------|
| All Contacts | 0 | Aggregate of all types |
| Cap Table Connections | 0 | Co-investors on shared cap tables |
| Social Media Connections | 0 | Social follow connections |
| Capavate Angel Network Connections | 0 | Angel network members |

All tabs show empty state: "There are no records to display"

**What's MISSING vs. a CRM:**
- ❌ No contact profiles with notes
- ❌ No touch-point log (calls, emails, meetings)
- ❌ No task tracking
- ❌ No deal association per contact
- ❌ No pipeline stage tracking
- ❌ No tag/label system
- ❌ No "Add contact" button visible (all tabs empty)
- ❌ No search results (empty state only)

### Founder-Side CRM: EXISTS (MINIMAL)

On the company side (`/dashboard`), the "Contact (CRM contacts)" sidebar item links to a minimal CRM:
- Contact directory
- Pipeline stages
- Communication log
- **Known gap:** No CSV bulk import [founder-audit GAP #6]

**The Collective Personal CRM** (`/collective/#/crm`) is the future solution — full private rolodex with notes, tasks, and deal links per contact. This is entirely absent from the live investor side.

---

## 6. BROKEN / STUB / PROMISE-NOT-DELIVERED SURFACES

### Complete Inventory of Dead Links, Empty States, and Broken Features

| Surface | URL | Status | Details |
|---------|-----|--------|---------|
| **Portfolio & Watchlist** | `/investor/company/watch-list` | EMPTY / STUB | "Investor Round List" — zero records; title mismatch with sidebar label; no data even though dashboard shows "3 Portfolio Companies" |
| **Your Decision tab** | Invitation modal (5th tab anchor) | BROKEN | Shows empty "Investment Soft Circle" table; missing: Accept/Decline radio, soft-circle form, personal note, submit CTA, status banner |
| **Cap Table tab** | Invitation modal (2nd tab anchor) | BROKEN | Renders same content as Overview summary cards (0.00 shares, 0 founders) — no cap table shareholder rows |
| **Investment Terms tab** | Invitation modal (3rd tab anchor) | BROKEN | No distinct Investment Terms section renders; merges into Overview; no instrument type / valuation / round size fields shown |
| **Data Room tab** | Invitation modal (4th tab anchor) | BROKEN | No documents render; no empty-state message visible (section absent) |
| **Modal tab navigation** | Invitation modal — all 5 tabs | BROKEN | Tabs are scroll anchors, NOT separate content views. Clicking a tab scrolls the page but does not load distinct content for Cap Table / Investment Terms / Data Room / Your Decision |
| **My Ownership Distribution widget** | `/investor/dashboard` (right panel) | EMPTY STUB | Pie/donut chart placeholder always empty; no data even for investor with "3 Portfolio Companies" |
| **Portfolio Statistics And Status widget** | `/investor/dashboard` (right panel) | EMPTY STUB | Panel always empty; no total invested, no active positions shown |
| **Funding Round column** | `/investor/company-invitation-list` | BROKEN | Shows "N/A" for every invitation; round state machine not wired to invitation list |
| **Angel Profile page** | Linked from sidebar visibility toggle | BROKEN (404) | The "Angel Profile" link in sidebar may 404; profile exists as a modal/section expansion, not a standalone page at `/investor/angel-profile` |
| **Report links** | Any investor report card | BROKEN (404) | Report links that should navigate to `/investor/report/{id}` instead link to `/report/` causing 404s |
| **Notification system** | Dashboard (no bell icon) | ABSENT | No notification bell, no unread badge, no notification center |
| **Logout button positioning** | Dashboard top bar | UX TRAP | Logout appears as a top-bar item in an unexpected location; moving to profile dropdown is a planned fix |
| **Accreditation status contradiction** | Profile Step 2 sidebar vs form | BUG | Sidebar shows "Accredited Investor" (from old type-of-investor select) while Step 2 form can independently show "No – Non-Accredited"; two different data sources |
| **"Investor: NOT on a cap table" badge** | Dashboard top header | ALWAYS SHOWING | Red badge always visible to test account; correct for this account but no indication of what to do to resolve it |
| **KYC status** | Profile | ABSENT | No KYC verification status display anywhere in profile Steps 1–3 |
| **LinkedIn URL validation** | Profile Step 2 | ABSENT | No URL validation on LinkedIn field — any text accepted |
| **Contacts tabs** | `/investor/contact-connections` | ALL EMPTY | All 4 tabs show 0 records and "There are no records to display" |
| **Archived invitations** | `/investor/company-list/archive` | EMPTY STUB | Page exists but empty; no clear empty-state messaging |
| **DSC / Screening rooms** | Not present on investor side | ABSENT | Deal Screening Committee is entirely absent from live investor portal |
| **SPV / Syndicate** | Not present on investor side | ABSENT | No SPV subscription surface on live investor portal |
| **M&A Intelligence** | Not present on investor side | ABSENT | No M&A score / tier / intelligence surface |
| **Personal CRM** | Not present on investor side | ABSENT | No private rolodex / notes / tasks |
| **Monthly Meetings** | Not present on investor side | ABSENT | No monthly investor meeting with Zoom links / agenda / recording |
| **Chapter directory** | Not present on investor side | ABSENT | No regional chapters |
| **Ask Expert** | Not present on investor side | ABSENT | No threaded expert consultation |
| **Consortium Partners** | Not present on investor side | ABSENT | No partner directory / vouching |
| **Screening Recaps** | Not present on investor side | ABSENT | No DSC screening recap library |

---

## 7. KNOWN ISSUES FROM PRIOR AUDITS (CONFIRMED STILL PRESENT)

These gaps were documented in `capavate_investor_deep_audit.md` (2026-05-08) and are confirmed unfixed on the live platform:

| Issue # | Description | Severity |
|---------|-------------|----------|
| GAP #1 | Accreditation contradiction: sidebar "Accredited Investor" vs. form "No – Non-Accredited" | HIGH |
| GAP #2 | Logout button in wrong position (top bar instead of profile dropdown) | MEDIUM |
| GAP #3 | No notification system (no bell icon, no email triggers for round events) | HIGH |
| GAP #4 | Portfolio page title mismatch ("Investor Round List" vs sidebar "My Portfolio & Watchlist") | LOW |
| GAP #5 | Dashboard "Total Portfolio Companies: 3" from social follows, NOT cap table — zero in actual portfolio page | HIGH |
| GAP #12 | No URL validation on LinkedIn field in profile Step 2 | LOW |
| GAP #14 | Page title shows "Login Page" in browser tab (should be "Dashboard") | LOW |
| GAP #15 | Modal tabs (Cap Table / Investment Terms / Data Room / Your Decision) are scroll anchors not true tabs — no distinct content loads | CRITICAL |
| GAP #17 | Flash of "Name not available" in dashboard on load | MEDIUM |
| GAP #20 | No KYC verification status display in investor profile | MEDIUM |
| GAP #22 | Invitation list "Funding Round" column shows N/A for every entry | MEDIUM |

---

## 8. WHAT WORKS (CONFIRMED FUNCTIONAL)

| Feature | URL | Status |
|---------|-----|--------|
| Login page and authentication | `/investor/login` | WORKING |
| Profile Wizard Steps 1–3 | `/investor/profile` | WORKING (data saves) |
| Knowledge Hub (660+ articles, 17 categories) | `/investor/knowledge-hub` | WORKING |
| Direct Messaging (modal overlay) | Via "View All Messages" | WORKING |
| Post composer and feed | Dashboard center panel | WORKING |
| Follow / Unfollow toggle on posts | Feed post cards | WORKING |
| Star/favorite conversations | Messages panel | WORKING |
| Discover Companies list (27 companies) | `/investor/discover-companies` | WORKING |
| Mark Interested / Not Interested | Discover Companies actions | WORKING |
| Invitation archive action (red trash button) | `/investor/company-invitation-list` | WORKING |
| Angel Profile visibility toggle (eye icon) | Dashboard sidebar | WORKING |
| Company Overview modal (from Discover) | Eye icon → 6-tab modal | WORKING (read-only) |
| Invitation Overview tab (partial) | Invitation modal — Tab 1 | PARTIALLY WORKING (null fields) |

---

## APPENDIX A: COMPLETE FIELD INVENTORY (INVESTOR PROFILE WIZARD)

### Step 1 — Contact Info

**Section: Your Current Role/Work** *(Used for cap table management)*

| Field | Input | Required | Placeholder |
|-------|-------|---------|-------------|
| SCREEN NAME | text | No | `@JohnSmith` |
| CURRENT COMPANY NAME | text | No | `Acme Ventures` |
| COMPANY COUNTRY | select | No | `— Select Country —` (145 countries) |
| CURRENT JOB TITLE | text | No | `Managing Partner` |
| COMPANY WEBSITE | url | No | `https://acmeventures.com` |

**Section: Contact Information** *(Used for cap table management)*

| Field | Input | Required | Placeholder |
|-------|-------|---------|-------------|
| FIRST NAME | text | **Yes (*)** | `John` |
| LAST NAME | text | **Yes (*)** | `Smith` |
| CONTACT (EMAIL) | email | No (disabled) | Pre-filled, read-only |
| COUNTRY | select | No | `— Select Country —` (240+ countries) |
| STATE | select | No | Dynamic by country |
| CITY | select | No | Dynamic by state |
| CONTACT (MOBILE) | tel | No | Country code select + `Enter phone number` |

**Navigation:** Step 1 of 3 · ← Previous (disabled) · Next →

### Step 2 — Investor Profile

| Field | Input | Required | All Options |
|-------|-------|---------|-------------|
| TYPE OF INVESTOR | select | No | 19 options (see below) |
| ACCREDITED STATUS | select | No | Yes – Accredited · No – Non-Accredited · Not Sure |
| NETWORK BIO | textarea | No | Max 500 chars |
| LINKEDIN OR PROFESSIONAL PROFILE | text | No | URL (no validation) |
| DO YOU INVEST THROUGH A COMPANY? | radio | No | Yes / No |
| COUNTRY OF TAX RESIDENCY | select | No | 145 countries |
| TAX ID OR NATIONAL ID | text | No | `XXX-XXX-XXX` |
| KYC / AML DOCUMENTATION | file (multiple) | No | PDF/image upload |
| PROFILE PICTURE | file (single) | No | Image upload |

**TYPE OF INVESTOR — All 19 Options:**
1. — Select — · 2. Accelerator · 3. Advisor (consultant to companies) · 4. Angel investor (Individual) · 5. Angel network or angel club · 6. Bank / Financial institution · 7. Corporate venture capital / strategic corporate investor · 8. Crowdfunding platform/crowd investor vehicle · 9. Employee (via ESOP) · 10. Family office (direct investing) · 11. Fund-of-funds or investment company · 12. Government (grant) or quasi-government fund · 13. Hedge fund · 14. Impact or ESG-focused investment fund · 15. Incubator · 16. Micro VC / emerging fund manager (pre-seed/seed specialist) · 17. Private equity/growth equity fund (late-stage or special situations) · 18. Representative of an accredited individual (advisor, family office CIO, etc.) · 19. Syndicate lead or SPV manager (investing on behalf of a pooled vehicle) · 20. Venture capital fund (institutional VC)

**Navigation:** Step 2 of 3 · ← Previous · Next →

### Step 3 — Network Profile

*Title: "Capavate Angel Investor Network Profile — Visible to founders on the platform"*

**Section A: Core Investment Preferences**

| Field | Input | Options |
|-------|-------|---------|
| INDUSTRY EXPERTISE | multi-select | 45 industry options |
| TYPICAL CHEQUE SIZE | multi-checkbox | Less than $25k · $25k–$50k · $50k–$100k · $100k–$250k · $250k–$500k · $500k–$1M · $1M–$5M · $5M+ |
| GEOGRAPHY FOCUS | multi-checkbox | Home Market Only · Home Country · Open to Global / Cross-Border |
| PREFERRED STAGE | multi-checkbox | Pre-Seed · Seed · Series A · Series B · Series C+ · Growth · Late Stage |
| HANDS-ON VS HANDS-OFF | multi-checkbox | Mentoring · Board Roles · Intros / Deal Flow · Portfolio Support · Passive |
| M&A INTERESTS | multi-checkbox | M&A Advisory · Buyouts · Mergers · Strategic Partnerships · PE Roll-ups · Distressed Assets · Cross-border M&A |

**Section B: Capavate Angel Network Interests**

| Field | Input | Options |
|-------|-------|---------|
| INVESTMENT INTERESTS | multi-checkbox | Full Sale Exits · Recapitalizations · IPOs/Listings · Secondaries · Structured Exits · Buybacks/Redemptions · MBOs/Sponsor Deals · Partial Liquidity · Distress Assets · Cross-border Distribution · Joint Ventures / Strategic Partnerships |

*When an interest is selected, an inline text field appears for each selected interest (e.g., "Exploring partnerships for scale.")*

**Navigation:** Step 3 of 3 · ← Previous · Save/Submit

---

## APPENDIX B: DESIGN PATTERNS CONFIRMED LIVE

| Pattern | Status |
|---------|--------|
| Three-column dashboard layout | CONFIRMED |
| Two-box communication center (Messages + Posts) | CONFIRMED |
| Messages as modal overlay (split list/thread) | CONFIRMED |
| Red/coral sender bubbles + white recipient bubbles | CONFIRMED |
| Double-checkmark ✓✓ read receipts | CONFIRMED |
| Screen name pseudonym system | CONFIRMED |
| "Investor: NOT on a cap table" persistent header badge | CONFIRMED |
| Eye icon (👁) on company list → opens company detail | CONFIRMED |
| Gold/orange network badge pills | CONFIRMED |
| Green role badge pills | CONFIRMED |
| ★ Star/pin conversations and posts | CONFIRMED |
| Follow / Following toggle on post cards | CONFIRMED |
| Angel Profile sidebar visibility toggle (eye icon) | CONFIRMED |

---

## APPENDIX C: ROUTE INVENTORY (ALL CONFIRMED LIVE ROUTES)

| Route | Page | Notes |
|-------|------|-------|
| `/investor/login` | Login page | Live |
| `/investor/dashboard` | Main dashboard | Live |
| `/investor/profile` | Profile wizard Steps 1–3 | Live |
| `/investor/company-invitation-list` | Incoming invitations | Live |
| `/investor/company/watch-list` | Portfolio & Watchlist (empty) | Live |
| `/investor/company-list/archive` | Archived invitations | Live |
| `/investor/contact-connections` | Contacts & Connections (4 tabs) | Live |
| `/investor/discover-companies` | Discover Companies (27 companies) | Live (being removed) |
| `/investor/knowledge-hub` | Knowledge Hub | Live |
| `/investor/company-discover-view/:id` | Company detail from Discover | Live (6-tab: Overview / Contact / Legal / Business / Strategic / Governance) |

**ROUTES THAT 404 OR FAIL:**
- `/investor/angel-profile` — 404; angel profile is not a standalone page route
- Any `/report/{id}` link from investor report cards — 404 (links should point to `/investor/report/{id}` or similar)
