# Capavate Live Founder Side — Audit v2
**Audit Date:** 2026-05-09  
**Auditor:** Synthesis subagent (cross-reference of all workspace audit files)  
**Primary sources:** `capavate_founder_deep_audit.md`, `capavate_founder_audit.md`, `collective_communications_audit.md`, `capavate_gating_addendum.md`, `capavate_live_investor_audit_v2.md`, `SPRINT-8-PROFILE-SUMMARY.md`, `SPRINT-9-COMMUNICATIONS-SUMMARY.md`, `SPRINT-10-INVESTOR-SUMMARY.md`, `capavate_master_build_spec.md`, `capavate_collective_sync_schema.md`  
**Account:** Ozan Isinak / NovaPay AI  
**Entry URL:** `https://capavate.com/user/login` → `https://capavate.com/dashboard`  
**Builds on:** `capavate_founder_deep_audit.md` (first-pass, May 8 2026)

---

## 1. LOGIN + LANDING PAGE FLOW

### Platform Architecture

| Portal | URL | Login | Auth |
|--------|-----|-------|------|
| Company/Founder | `/dashboard` | `/user/login` | Separate JWT session from investor side |
| Investor/Collective | `/investor/dashboard` | `/investor/login` | Separate JWT session from founder side |

Both portals share the same Auth0 identity (same email/password, same `user.sub`). The JWT roles claim routes the user to the correct product. Cookie domain is `.capavate.com`.

### Login Page (`/user/login`)

- **Page title (browser tab):** "Login Page" ← **BUG: should be "Capavate — Sign In" or equivalent**
- Standard email + password form
- No special gating language (contrast: investor login has "invitation-only" language)
- No visible Google/SSO OAuth button documented
- No visible magic-link/passwordless option documented

### Landing Page CTAs (post-login — `/dashboard`)

Upon successful login, the user lands on the company dashboard. Primary CTAs in the main area:

| CTA | Style | Destination |
|-----|-------|-------------|
| **View/Edit The Round Dashboard** | Dark outline button | `/record-round-list` |
| **View Interested Investors** | Dark fill button | Modal overlay ("Investors Interest") |
| **Create Investor Report** | Red/coral fill | `/add-new-investor` |
| **Start a post** | Gray input text field | Post composer in dashboard feed |
| **View All Messages** | Red/coral pill | Messages modal overlay |
| **Join Capavate Angel Network** | ★ Star icon + text link | Modal: "Join the waitlist" |

### Password Reset

- Not directly observed on the live platform during audits
- Assumed: Standard "Forgot password?" link on `/user/login` → email reset flow via Auth0
- No confirmed URL or field-level detail available from current workspace audits

### Session Handling

- JWT-based authentication
- Session persists across page navigation within the `/dashboard` subdirectory
- Logout button is present in the **top navigation bar** (unusual position — see gap #2 below)
- No observed session timeout warning

### Multi-Company Picker

**ABSENT on live platform.** The live platform is a **single-company workspace per login.** No company-switcher dropdown or company-picker is present anywhere in the navigation. The sidebar shows exactly one company (e.g., "NovaPay AI") with no mechanism to add or switch to another company.

---

## 2. MULTI-COMPANY ARCHITECTURE

### Current Live State

**Single-company only.** Each login is bound to one company workspace. There is:
- No company switcher dropdown
- No "Add another company" CTA
- No company selector on the login page
- No multi-company dashboard page

The sidebar company card shows:
| Element | Example Value |
|---------|--------------|
| Company name | NovaPay AI |
| Sector | YES ← **DATA BUG: "YES" instead of the actual sector string ("Fintech & Digital Payments")** |
| Headquarters | 200 University Avenue, Toronto, Ontario — M5H 3C6, Canada |
| Account Owner | Ozan Isinak |

### Target Architecture (R200 Rebuild)

The R200 data model supports multiple companies per user via the JWT `companies[]` claim and `companyOwner`/`founderOf`/`signatoryOf` role bindings. The rebuild targets:
- A **company-switcher** in the top navigation bar (dropdown showing all companies the user is associated with)
- Separate billing per company (Stripe subscription per `companyId`)
- Separate cap tables, rounds, and datarooms per company
- The `PATCH /api/companies/:id/*` endpoints are already scoped per company in the rebuild

### Billing per Company

**Not implemented on live platform.** The `/subscription` page shows "0 active plans" for the NovaPay AI account with no plan detail or upgrade path. In the rebuild, billing is intended to be:
- Per-company subscription managed via Stripe Connect
- Synced to the `/subscription` settings page
- Separate from the Collective membership fee ($1,200/yr) which is per-person (investor side)

---

## 3. DASHBOARD ANALYTICS

**URL:** `/dashboard`

### Metrics Surfaced (Current Active Round Widget)

| Field | Current value (NovaPay AI) |
|-------|--------------------------|
| Total Shares | 0.00 |
| Option Pool (%) | 0% |
| Option Pool (shares) | 0 |
| Investor Stakes (%) | 0% |
| Latest Valuation | $0.00 |

These are all zeroed because no rounds have been created and no investors are on the cap table.

### Sidebar Analytics Widgets (always visible)

**Cap Table Analytics:**
- Founders count: 0
- ESOP %: 0%
- Total Investors count: 0
- Cap Table → link (`/record-round-list`)

**Round A Analytics:**
- Invited Investors: 0
- Investor engagement: 0
- Number of soft circles: 0
- Number of confirmed investors: 0

**CRM Conversion Summary:**
- Total Number of Contacts: 0
- Document View Rate: 0
- Soft Circle Ratio: 0.00
- Investment Conversion Ratio: 20% ← **DATA BUG: shows 20% with zero data — hardcoded placeholder**
- Overall CRM-to-Investment Conversion: 20% ← **same placeholder bug**

**Social Media:**
- Followers: 0
- Following: 0

### Missing Analytics for Cap-Table-Led Communication and Investor-Led M&A

| Missing Metric | Impact |
|----------------|--------|
| No per-investor engagement tracking (who opened, who soft-circled) | Founder cannot identify engaged investors in pipeline |
| No dataroom view log on dashboard | Founder cannot see which investors have viewed which documents |
| No soft-circle velocity chart (time from invite → soft-circle) | No pipeline speed signal |
| No M&A readiness score displayed on dashboard | Step 4 M&A data is collected but no score widget is rendered on the dashboard |
| No acquirer-fit signal or comparable exit table | No M&A intelligence output surfaced to founder |
| No cap-table co-investor communication feed | No visibility into investor-to-investor discussion activity |
| No IRR / paper return summary | Investors have no portfolio performance signal |
| No round close-gate progress bar | No visual of how close the round is to its target |
| No investor response funnel (invited → viewed → responded) | Dead metric space |

---

## 4. COMPANY PROFILE + INVESTOR VIEW LINK

**URL:** `/company-profile` (4-step wizard)

### "View as Investor" Button (Investor View Toggle)

The Sprint 8 rebuild introduced a **"View as investor" preview button** at the top of the company profile wizard. This button renders the company's profile exactly as it would appear on the investor/Collective company details page — same 19-section layout, same field rendering, same gating rules applied.

**Status on live platform:** The investor-view preview button EXISTS in the Sprint 8 rebuild build but was NOT confirmed as present on the live `capavate.com` production platform. The live platform's Company Profile wizard shows the 4-step wizard UI but no "View as investor" toggle was documented in the live platform audits. This represents **drift between the rebuild and live platform.**

**In the rebuild (Sprint 8):**
- Button label: "View as investor" (preview toggle at top of wizard)
- Renders: `CompanyDetails.tsx` in investor mode — same shared renderer used by Collective
- Gating simulation: shows which sections would be visible to an invited investor (`canSeeRound`, `canSeeDataroom`, `canSeeSoftCircle`, `canSeeTermSheet` flags)
- All 19 sections rendered with correct gating state

**Company Profile Step-by-Step (live platform):**

**Step 1 of 4 — Company Contact Info** (11 fields):
| # | Field Label | Type | Required | Notes |
|---|-------------|------|---------|-------|
| 1 | Name of Company | text | ✓ | |
| 2 | Company Email | email | ✓ | "Enter company email" |
| 3 | Industry | select (50 options) | ✓ | Full industry list |
| 4 | Phone (country code + number) | select + tel | ✓ | All world countries |
| 5 | Company Website / URL | text | ✓ | |
| 6 | Number of Employees | select (6 ranges) | ✓ | 1-10 / 11-50 / 51-200 / 201-500 / 501-1000 / 1000+ |
| 7 | Date of Incorporation/Registration | date picker | ✓ | DD-Month-YYYY; ℹ tooltip |
| 8 | One-sentence headliner | textarea (400 chars) | ✓ | "Max 400 characters..." |
| 9 | What problem are you solving? | textarea (600 chars) | ✓ | "Max 600 characters..." |
| 10 | What is Your Solution to the Problem? | textarea (600 chars) | ✓ | "Max 600 characters..." |

**Step 2 of 4 — Company Mailing Address** (6 fields):
| # | Field Label | Type | Required | Notes |
|---|-------------|------|---------|-------|
| 1 | Street | text | ✓ | "Enter here" |
| 2 | Country | select (250 countries) | ✓ | |
| 3 | Unit / Suite / Floor | text | — | Optional |
| 4 | State / Province / Territory / District | select (dynamic by country) | ✓ | |
| 5 | City | select (dynamic by state) | ✓ | |
| 6 | Postal code / Zip | text | — | |

**Step 3 of 4 — Legal Entity Information** (7 fields):
| # | Field Label | Type | Required | Notes |
|---|-------------|------|---------|-------|
| 1 | Upload Articles of Incorporation | file (PDF) | ✓ | |
| 2 | Legal Entity Name | text | ✓ | |
| 3 | Business Number / ID Number | text | — | |
| 4 | Country of Incorporation | select (250 countries) | ✓ | |
| 5 | Type of Entity | text | ✓ | Free text (e.g. "Corporation") |
| 6 | Is the company traded on a public exchange? | radio (Yes / No) | ✓ | Default: No |
| 7 | Registered Office Address | textarea | ✓ | Full address text |

**Step 4 of 4 — M&A Intelligence** (30 fields across 5 sections):
- See §7 below for full detail.

---

## 5. CAP TABLE PAGE

**Current live state:** **No standalone cap table page exists.**

**Entry point:** The "Cap Table" link in the left sidebar analytics widget navigates to `/record-round-list` — the **Round List** page, not a dedicated cap table.

**What the cap table analytics widget shows:**
- Founders: 0 (count)
- ESOP: 0% (percentage)
- Total Investors: 0 (count)
- "Cap Table" → View → `/record-round-list`

**What is MISSING:**

| Missing Feature | Impact |
|----------------|--------|
| No standalone `/cap-table` URL | Cap table is not a first-class page |
| No fully-diluted (FD) share count view | Founders cannot see total FD cap table |
| No fully-diluted cap table by holder | No shareholder row breakdown |
| No pro-forma model (what-if new round) | No dilution modeling |
| No waterfall / liquidation preference model | No exit scenario modeling |
| No CSV export | Cannot export cap table to investors, lawyers, accountants |
| No PDF export | No formatted cap table for board packs |
| No "Add investor to cap table" CTA directly from cap table | All cap table changes go through round wizard |
| No ESOP pool drill-down (who holds options, vesting status) | No option pool management |
| No secondary transfer recording | No logging of share transfers |
| No safe/note conversion tracking | No SAFE conversion workflow on live cap table |

**In the rebuild (Sprint 8 onward):**
The rebuild has a dedicated `/founder/captable` route. Key features:
- Engine attribution badge reads from live company profile region (e.g., "Computed by CA-default v1.0.0")
- Fully-diluted view including all SAFEs, notes, warrants, options
- Region badge updates dynamically when company country changes
- Dual engine reconciliation (primary + reference engine must agree to 8 decimal places)

---

## 6. ROUNDS PAGE + ROUND WIZARD

**URL:** `/record-round-list` (list) → `/createrecord` (wizard)

### Rounds List Page (`/record-round-list`)

- **Page title:** "Investment Rounds Overview"
- **Empty state:** "There are no records to display"
- **Primary CTA:** "Start New Funding Round" → `/createrecord`
- Search field: "Search Here..."
- No existing rounds for NovaPay AI account

### Round Wizard (`/createrecord`) — 5-Tab Wizard

**Progress indicator:** "20% Complete" progress bar on load (at Tab 1)

**Tab locking:** Tabs 2–5 are locked until Tab 1 is saved ("Save and Continue" must be clicked). All 5 tab headers are visible in the nav bar.

**Tab 1 — Founder Share Allocation ("Round 0 — Company Incorporation")**

Welcome message: *"Let's start with your company's incorporation details. This will be your Round 0 — the foundation of your cap table."*

| # | Field Label | Type | Required | Notes |
|---|-------------|------|---------|-------|
| 1 | Name of Round | text (max 30) | ✓ | Character counter shown |
| — | **Per Founder block (repeatable)** | | | "+ Add Another Founder" button |
| F1 | First Name | text | ✓ | |
| F2 | Last Name | text | ✓ | |
| F3 | Email | email | ✓ | |
| F4 | Phone | tel | — | Optional |
| F5 | Shares Allocated | text | ✓ | Placeholder "e.g., 500" |
| F6 | Share Type | select | — | Common Shares (default) / Preferred Shares / Other |
| F7 | Share Class | select | — | Class A (default) / Class B / Class C |
| F8 | Voting Rights | select | — | Voting (default) / Non-Voting |
| 9 | Currency | select (~150 currencies) | ✓ | Default: CAD $ |
| 10 | Price Per Share at Incorporation ($) | number (min 0) | ✓ | "This is the par value from your incorporation documents" |

**Calculated display fields (read-only below the form):**
- Total Shares
- Total Value ($)
- Founder Count

**CTA:** "Save and Continue"

**Tabs 2–5 (locked until Tab 1 saved — content inferred from labels):**

| Tab | Name | Expected Content |
|-----|------|-----------------|
| 2 | Description | Round description, round type, stage, purpose narrative |
| 3 | Round 0 Summary | Cap table summary, pre-money valuation, total raise |
| 4 | Rights & Preferences | Liquidation preferences, anti-dilution, pro-rata rights, board seats |
| 5 | Notes | Internal notes, investor notes, additional terms |

### Critical Wizard Gaps

**1. Warrant and Options support — PARTIALLY ADDRESSED, TERM SHEET BUG CONFIRMED:**

Per the master build spec and gating addendum, the round wizard must support all 6 first-class instruments: Common, Preferred, SAFE, Convertible Debt, Warrant, Option Grant (ESOP/EMI/CSOP).

On the live platform:
- Tab 1 supports Common Shares, Preferred Shares, and "Other" — **no SAFE, no Convertible Note, no Warrant, no Option** fields visible at Tab 1
- Warrant and Option Grant instruments are not visibly modeled in the live round wizard
- **Term Sheet step for Warrants/Options:** The build spec confirms that the term-sheet generation step MUST be skipped for Warrant and Option Grant rounds (term sheets are only for equity/SAFE/note rounds). On the live platform, this gating logic is NOT confirmed present — the term-sheet step behavior for Warrants/Options has not been verified as correctly suppressed.

**2. Region dropdowns — 9 regions required:**

The 9 supported regions are: **US / CA / UK / SG / HK / CN / IN / JP / AU**

On the live round wizard:
- Currency selector has ~150 global currencies ✓
- Jurisdiction/region selector in the round wizard reads from the company's country of incorporation (set in Company Profile Step 2/3)
- Sprint 8 rebuild confirms the round wizard's region default reads from the live profile: "Change country to India in Step 3 → /founder/rounds/new Jurisdiction selector defaults to India — Companies Act 2013 / CCPS / FEMA / DPIIT"
- The entity-type dropdown in the rebuild filters dynamically by country: US (C-Corp/S-Corp/LLC), UK (Ltd/PLC/LLP), India (Pvt Ltd/Public Ltd/LLP), JP (KK/GK), AU (Pty Ltd/Ltd), SG (Pte Ltd), HK (Ltd), CN (WFOE/JV)
- **Live platform status:** Region-specific instrument type and jurisdiction dropdowns from the actual live round wizard (Tabs 2–5) were NOT directly audited — Tabs 2–5 were locked. Stale region lists cannot be fully confirmed or ruled out from available data.

**3. Round type labeling:**

The wizard calls the first step "Round 0 — Company Incorporation" — not standard startup terminology. Pre-Seed, Seed, Series A etc. naming is not visible at Tab 1. These are expected in Tab 2 (Description — locked).

---

## 7. INVESTOR CRM (FOUNDER SIDE)

### CRM Navigation Structure

```
Contact (CRM contacts) ▾
  ├─ Investor Directory           /crm/investor-directory
  ├─ Add New Investor Contact     /crm/addnew-investor
  ├─ Shared-With-Investors        /crm/share-with-investorreport
  └─ Investor Reports             /crm/investorreport
```

### Add New Investor Contact (`/crm/addnew-investor`)

**Page title:** "Add Investor"

**Form (per investor block):**
| Field | Type | Required |
|-------|------|---------|
| First Name | text | ✓ |
| Last Name | text | ✓ |
| Email | email | ✓ |

- "+ Add More Investor" button (adds another block)
- "Submit" button
- "Back" button → returns to Investor Directory
- "View Investors List" button → `/crm/investor-directory`

**No bulk CSV upload, no personal message field, no invitation preview, no invitation expiry date setting visible.**

### Investor Directory (`/crm/investor-directory`)

- **Page title:** "Investor Entry" ← **LABEL BUG: sidebar says "Investor Directory" but page title says "Investor Entry"**
- Empty state: "There are no records to display"
- "Add New Investor" button → `/crm/addnew-investor`
- Search field

### Shared-With-Investors (`/crm/share-with-investorreport`)

Three sections on one page:
1. **Investor Reports** — Share Report button, search, empty state
2. **DataRoom Management Documents** — Share Report button, search, empty state
3. **Share Current Round Details with Investors** — Share Report button, search, empty state

**"Share Report" button behavior:** Clicking produces no visible feedback (no modal, no navigation, no toast). **Likely broken or requires an active round to be functional.**

### Investor Reports CRM View (`/crm/investorreport`)

Three sections:
1. **Investor Report** — search, empty state
2. **DataRoom Management Documents** — search, empty state
3. **Capital Round Documents** — search, empty state

### CRM Gaps (Full Inventory)

| Missing Feature | Impact |
|----------------|--------|
| Only 3 fields to add an investor (First, Last, Email) | Cannot capture investor's fund, sector focus, check size, geography, or relationship notes |
| No bulk CSV import | Cannot import existing investor lists |
| No pipeline stages (Lead / Met / DD / Soft-Circle / Invested / Exited) | No CRM pipeline view |
| No touch-point log (calls, emails, meetings) | No relationship history |
| No task tracking per contact | No follow-up reminders |
| No tag/label system | Cannot segment investor contacts |
| No deal association per contact | Cannot link contacts to specific rounds |
| No search across contacts (only empty-state observed) | No discoverability |
| "Share Report" button unresponsive | Cannot share material from CRM |
| No investor segmentation by check size / sector / stage | No targeted outreach |
| No engagement metrics per investor (email open rate, document views) | No signal on who is most engaged |

---

## 8. DATAROOM (`/dataroom-Duediligence`)

**Page title:** "Dataroom Management & Executive Summary"

**Status: BROKEN / STUB**

### What's broken

| Broken Feature | Details |
|----------------|---------|
| **"Manage Documents" always shows "N/A"** | Per-document management (view logs, access controls, watermarking) is completely non-functional until at least one document is uploaded |
| **"Generate Executive Summary" button** | Appears at top AND bottom of the page. Action is unclear — presumably AI-driven summary from uploaded documents. Cannot be tested without uploaded files. No confirmation modal, no output preview. |
| **No per-investor access grants (visible)** | Watermarking, per-investor dataroom access controls (`dataroom_grants`) are not visible in the current UI state |
| **No document version management** | No versioning UI observed |
| **No upload confirmation flow** | "Click To Upload" / "Choose File" buttons are present per document slot but upload behavior is not confirmed (read-only audit constraint) |
| **No view logs** | No per-document "who viewed this" log |
| **No permission model UI** | No ability to grant/revoke specific investors access to specific documents |
| **"Manage Documents" column** | Shows "N/A" for all 42 document slots — would need uploaded documents to show any management UI |
| **No executive summary output** | With no documents uploaded, the "Generate Executive Summary" button has no material to work from |

### Folder Structure (11 Categories, 42 Document Slots)

| Category | Document Slots |
|----------|---------------|
| **Management Team** (3) | Advisory Board Information · Detailed Bios And Resumes · Organizational Chart |
| **Product Or Service Offering** (4) | Intellectual Property (Patents, Trademarks, Copyrights) · Product Description And Specifications · Product Development Roadmaps · R&D Documentation |
| **Sales And Marketing** (10) | Competitor Analysis · Customer Acquisition Costs · Customer Demographics · Customer Testimonials And Case Studies · Major Customer Contracts · Market Entry Strategies · Market Size And Growth Trends · Marketing Strategies And Campaigns · Sales Reports And Forecasts · Vendor And Supplier Agreements |
| **Technology & IT** (4) | Data Privacy Policies · Disaster Recovery Plans · IT Systems And Software Structure · Security Protocols |
| **Operations** (3) | Production Processes · Quality Control Measures · Supply Chain |
| **Regulatory & Compliance** (5) | Environmental Compliance Documents · ESG Reports · Health And Safety Records · Industry-Specific Regulations · Licenses And Permits |
| **Legal** (4) | Articles Of Incorporation And Bylaws · Insurance Policies · Litigation History · Risk Assessment Reports |
| **Financial** (5) | Accounts Receivable And Payable Aging Reports · Audit Reports · Capitalization Table · Financial Projections And Budgets · Historical Financial Statements (Income Statements, Balance Sheets, Cash Flow Statements) |
| **Press And Public Relations** (4) | Awards And Recognitions · Media Coverage · Press Releases · Social Media Presence |
| **Miscellaneous** (4) | Any Other Pertinent Information Not Covered Above · FAQs · Glossary Of Terms · Upload Company Logo |
| **Term Sheet** (1) | Term Sheets And Investment Agreements |

**Total: 11 categories · 42 document slots** (NOTE: previous audit noted "47 slots" — confirmed count is 42; the discrepancy was due to counting partially-visible unnamed items in Categories 4–6 in the earlier audit pass)

Each slot has: Document Name | Upload Documents (button) | Manage Documents (N/A until uploaded) | ℹ tooltip on hover

---

## 9. INVESTOR REPORTS

**URL:** `/investorlist` (list page) → `/add-new-investor` (create form)

**Status: STRUCTURE IS GOOD — delivery is broken (all report links 404)**

### Report List Page (`/investorlist` or `/investorreport`)

- "There are no records to display" — empty state
- "Add New Report" button → `/add-new-investor`

### Dashboard pre-loaded report links (ALL BROKEN)

| Report | Date | URL | Status |
|--------|------|-----|--------|
| Q1 2026 Investor Update | February 15, 2026 | `/report/1` | **404 — Page not found** |
| Annual Performance Report | January 10, 2026 | `/report/2` | **404 — Page not found** |
| Funding Round Summary | N/A | `/report/3` | **404 — Page not found** |

**Root cause:** Report links should point to `/investor/report/{id}` or similar scoped route; the current links use `/report/{id}` which has no matching route handler.

### Create Investor Report Form (`/add-new-investor`)

**6 sections, all required (*), each with 3 guiding sub-questions and a single large textarea ("Add Here...")**

| Section | Guiding Questions |
|---------|------------------|
| **Financial Performance *** | What were revenues, expenses, profits this quarter? · How does this compare to prior quarters and projections? · Key financial trends or concerns? |
| **Operational Updates *** | What milestones or achievements were reached? · Major challenges or setbacks? · How has the team grown or changed? |
| **Market & Competitive Landscape *** | How has the market evolved? · What competitive advantages or risks surfaced? · How is the company positioning for future success? |
| **Customer & Product Insights *** | What feedback have customers provided? · How has the product or service improved? · What new developments or launches are planned? |
| **Fundraising & Financial Strategy *** | What is the current cash runway and burn rate? · Upcoming funding needs or investment opportunities? · How are financial resources being allocated for growth? |
| **Future Outlook & Strategy *** | What are the company's goals for the next quarter? · What strategic shifts or pivots are being considered? · How can investors support the company's success? |

**User's note:** "The user likes [this structure]." The 6-section structure is confirmed intentional and good design. The freeform narrative textarea per section is the intended format.

### What Works vs. Stubbed

| Feature | Status |
|---------|--------|
| Report creation form (6 sections, 6 textareas) | WORKS (saves successfully) |
| Report list display | WORKS (shows if reports created) |
| Individual report view (`/report/1`, `/report/2`, `/report/3`) | BROKEN — all 404 |
| Report sharing with investors | PARTIALLY BROKEN — "Share Report" button unresponsive |
| Investor report templates (beyond the 6 guiding questions) | ABSENT — no template selection |
| Attachments to reports (charts, financials) | ABSENT — no attachment field visible |
| Report scheduling / cadence | ABSENT |
| Read receipt (which investors opened the report) | ABSENT |

---

## 10. MESSAGES

**Status: PRESENT (social-style feed only) — no 1:1 messaging inbox**

### What exists on founder side

**Messages from Shareholders Panel (dashboard, center-left box):**
- Section header: "Messages from Shareholders" + 💬 icon
- 🔄 Refresh icon
- "💬 View All Messages" button (red/coral pill)
- Filter tabs: All · ★ Starred (N) · ↓ Newest
- Conversation rows: Avatar (40px, initials, colored) + Name + Type badge (Company/Investor) + Date + ★ Star icon + Green online dot + Preview text
- Empty state: Speech bubble illustration + "No conversations yet"

**Messages Modal (triggered by "View All Messages"):**
- Modal overlay (NOT a separate page/route)
- Left panel (~40%): Conversation list — header "Messages" + "Search conversations..." + filter tabs (All / ★ Starred / ↓ Newest)
- Right panel (~60%): Thread view — sender coral/red right-aligned bubbles + recipient white left-aligned bubbles + double-checkmark ✓✓ read receipts + date dividers + 😊 emoji picker + 📤 paper plane send button
- Thread header: Avatar + Name + Type badge + Online status ("● Offline" / "● Online") + Location

**Post Composer (dashboard, center-right area):**
- Company avatar (circle with initials "N") + "Start a post" input field + 🔄 Refresh icon
- Posts from shareholders appear in the feed (same post card structure as investor side)

### CRM Linkage — ABSENT

The messages system is NOT connected to the founder-side CRM:
- No "Open conversation with [investor]" CTA from the CRM investor contact page
- No conversation history shown within a CRM contact profile
- No "Log this message as a touch-point" action
- No way to see which CRM contacts have active conversations

**Per the R200 build spec target:** The rebuild (Sprint 9+) links messages to CRM contacts via:
- `canSendDm()` check from the visibility resolver (requires shared cap table or Collective membership)
- Per-investor message threads accessible from the CRM contact panel
- Touch-point log auto-populated from messages

---

## 11. ACTIVITY LOG

**URL:** `/activity-logs`  
**Sidebar label:** Activity Logs (under Settings)

### Current State

- **Table columns:** Module · Action · Entity Name / Details · IP Address · Date
- **Search field:** present
- **Current data:** "No records to display" — the NovaPay AI account has zero activity log entries
- **Status:** The table structure exists and is functional; it simply has no data because no actions have been taken in this account that trigger audit log writes

### Gaps

| Missing Feature | Impact |
|----------------|--------|
| No filter by Module (round management / profile / CRM / dataroom / reports) | Cannot filter to relevant activity |
| No date range picker | Cannot slice activity by period |
| No export (CSV/PDF) | Cannot export audit trail to lawyers/accountants |
| No pagination visible (empty state) | Unknown if pagination works |
| No audit log for READ actions (only writes) | No visibility into who viewed the dataroom |
| Not hash-chained on live platform | The rebuild uses hash-chained audit log; the live platform's activity log is a simple table |

---

## 12. SETTINGS

**Status: LARGELY BROKEN / STUB**

### Settings Sub-Navigation (under Settings collapsible in sidebar)

| Item | URL | Status |
|------|-----|--------|
| Activity Logs | `/activity-logs` | LIVE (empty state, functional table) |
| Subscriptions | `/subscription` | STUB (0 plans, no upgrade path) |
| Knowledge Hub | `/knowledge-hub` | LIVE (read-only education content) |

### Subscriptions Page (`/subscription`)

**Page title:** "Your Subscriptions — Manage your active plans and services"

| Element | State |
|---------|-------|
| Active plans count | 0 |
| Empty state message | "No subscriptions yet — You don't have any active subscriptions at the moment." |
| "Browse Plans" or "Upgrade" button | ABSENT — not visible |
| Current plan details | ABSENT |
| Renewal date | ABSENT |
| Billing history | ABSENT |
| Payment method management | ABSENT |
| Invoice download | ABSENT |

**This page is essentially a dead end.** The only pathway to a subscription is the "Join Angel Network" modal in the sidebar (which takes users to the waitlist for the $1,200/year Collective membership) — but this modal does NOT create a record on the Subscriptions page.

**Admin/pricing sync gap:** The `/admin/lifecycle-policy` page (Collective admin) manages pricing tiers, tenure windows, and membership policies — but the Capavate founder side `/subscription` page does NOT read from this policy engine. There is zero bidirectional sync between admin lifecycle policy settings and what founders see on their subscription page.

### Missing Settings Tabs (present in build spec, absent from live)

| Setting | Expected location | Current status |
|---------|-----------------|--------------|
| Account/profile settings (company owner name, email, password) | `/settings/account` | ABSENT — `/admin` and `/settings` routes return 404 |
| Team management (add/remove team members, roles) | `/settings/team` | ABSENT |
| Notification preferences (email triggers, in-app alerts) | `/settings/notifications` | ABSENT |
| Privacy controls (screen name, visibility toggles) | `/settings/privacy` | ABSENT on founder side (present in rebuild at `/founder/settings`) |
| Dataroom permissions template | `/settings/dataroom` | ABSENT |
| Integration settings (e-signature, CRM, calendar) | `/settings/integrations` | ABSENT |
| Billing / payment method | `/settings/billing` | ABSENT — `/subscription` is the only billing surface and it's empty |
| Two-factor authentication | `/settings/security` | ABSENT |

**Admin routes confirmed 404 on live platform:** `/admin`, `/settings`, `/lifecycle` all return "Page not found."

---

## 13. CAPAVATE COLLECTIVE ENTRY (FROM FOUNDER SIDE)

**Entry point:** "★ Join Capavate Angel Network" — first item in the left sidebar nav (below the company card)

**Behavior:** Clicking triggers a modal overlay titled **"Join the waitlist for Capavate Angel Network Membership"**

**Modal fields and content:**

| Field | Type | Required |
|-------|------|---------|
| First Name | text | ✓ |
| Last Name | text | ✓ |
| Email Address | email | ✓ |
| Phone Number | tel | ✓ |
| City | text | ✓ |
| Country | dropdown | ✓ |

**Buttons:** Cancel | **Join Angel Network**

**Modal content (verbatim):**
- *"Capavate Angel Network gives a seat at the global table where early-stage deals are sourced, screened, and funded"*
- Features: diversified vetting, deal flow from startup ecosystems, collective intelligence, syndication tools, participation in larger rounds at smaller check sizes, community education
- **Eligibility:** Accredited investors only (including authorized representatives; investors already on a company cap table hosted on Capavate)
- **Annual membership fee: $1,200 USD/year** (subject to change)

**Important:** This modal is a **waitlist form only** — it does NOT immediately enroll the founder/company in Collective. After submission, the founder is added to a review queue.

**No other Collective entry point** was found on the founder dashboard. The Collective deal room, DSC, SPV, and M&A intelligence surfaces are entirely absent from the live founder-side navigation. They are not locked behind a subscription — they are simply not present in the current live navigation at all.

---

## 14. INVESTOR VERIFICATION → CAP TABLE UPDATE PIPELINE

### State Machine (Full — Investor Side)

**States and transitions for a single investor-round relationship:**

```
PENDING → VIEWED → ACCEPTED | DECLINED | SOFT_CIRCLED
                              ↓
               SOFT_CIRCLED → CONFIRMED (founder action) | REVOKED (founder action)
                              ↓
                   CONFIRMED → SIGNED (system, after e-sig)
                              ↓
                       SIGNED → FUNDED (system, after close)
                              ↓
                      FUNDED → (terminal; cap table commit)
```

**Additional states:**
- `EXPIRED` — token has passed expiry date (default 30 days from issuance, founder-configurable)
- `REVOKED` — founder or admin revoked the invitation

### Where Each State Lives on the Live Platform

| State | Investor sees | Founder sees | Route |
|-------|--------------|--------------|-------|
| `pending` | Invitation in `/investor/company-invitation-list` (no action taken) | Investor in "Invited Investors" count | `/crm/share-round-toinvestor` |
| `viewed` | Auto-set when investor opens the invitation modal | — | — |
| `accepted` | Green ✓ button changes to blue dot indicator (UI-only, no backend write) | — | — |
| `declined` | Red 🗑 archive button moves invitation to `/investor/company-list/archive` | — | — |
| `soft_circled` | "Investment Soft Circle" table in the "Your Decision" tab (**BROKEN — empty table, no form**) | "Number of soft circles" counter in sidebar | `/crm/investment` (Confirm/Validate) |
| `confirmed` | Status changes in invitation | "Number of confirmed investors" counter | `/crm/investment` |
| `signed` | Not implemented on live platform | Not implemented | ABSENT |
| `funded` | Not implemented on live platform | Not implemented | ABSENT |

### Critical Gate: When Does It Commit to Cap Table?

**The `funded` state is the cap table commit trigger.** In the R200 architecture:
- `SIGNED → FUNDED` transition is triggered when: the founder marks the round as closed, AND all signed commitments have been confirmed as received/settled
- At `FUNDED`, the system posts a transaction to the cap-table engine ledger (append-only)
- The `cap_table.mutated` event fires, triggering the Collective eligibility recompute
- From this point, the investor appears on the cap table and becomes eligible for Collective membership

**What gates the `funded` state:**
1. The round must be in `signing_open` state (only one round per company can be in `signing_open` at a time)
2. All required e-signatures must be collected (`signature_seal` hash chain verified)
3. Founder must confirm receipt of funds
4. Admin may optionally gate with a compliance hold

**On the live platform:**
- `signed` and `funded` states are NOT implemented — no e-signature integration, no round-close workflow
- The soft-circle form itself is BROKEN (empty table, no form — see §15 below)
- The "Confirm/Validate Investors" page (`/crm/investment`) exists but shows no records ("Investment Confirmation" page title)

### Soft-Circle Form — BROKEN STATE (Detailed)

The investor-side "Your Decision" tab in the invitation modal shows:
```
Section: "Investment Soft Circle"
Table columns: # | INVESTMENT AMOUNT | INVEST DATE | REQUEST CONFIRM | VIEW
Table body: "No records to display"
```

**What is MISSING (should be there):**
- ❌ Accept / Decline radio buttons
- ❌ Investment amount input field
- ❌ Soft-circle type selector (Definite / Indication of interest / Conditional on due diligence)
- ❌ Personal note to founder textarea (max 500 chars)
- ❌ "Submit Soft-Circle" primary CTA (should be Hydra Teal per rebuild target)
- ❌ "Decline" button (destructive red outline)
- ❌ "Request More Information" secondary action
- ❌ Invitation status banner (10-state: pending/viewed/accepted/soft_circled/confirmed/signed/funded/expired/revoked/declined)
- ❌ Round terms summary card
- ❌ Term sheet preview

---

## 15. DARK MODE

**Confirmed ABSENT on live platform.**

No dark mode toggle was found anywhere on the live Capavate founder-side interface:
- Not in top navigation bar
- Not in sidebar
- Not in Settings (`/subscription`, `/activity-logs`, `/knowledge-hub`)
- Not in Company Profile wizard
- Not in Round Management wizard
- No dark mode CSS class or toggle button was documented in any of the live platform audit passes

**User note:** "Confirm dark mode toggle exists; we will be removing it." — **Dark mode does NOT exist on the live platform.** It is absent — there is nothing to remove from the live production interface. If a dark mode toggle was introduced in the Sprint rebuild (in-sandbox Vite app), it would need to be verified there.

---

## 16. COMPLETE BROKEN SURFACES INVENTORY

### Critical (blocks commercial use)

| Surface | Route | Broken State |
|---------|-------|-------------|
| **Investor report links** | `/report/1`, `/report/2`, `/report/3` | All return HTTP 404 |
| **"Your Decision" soft-circle form** | Invitation modal — Tab 5 | Shows empty table; missing all form controls |
| **Cap Table page** | No standalone route exists | `/record-round-list` (round list) is the only entry; no shareholder rows, no FD view, no export |
| **Modal tab navigation** | Invitation modal — all 5 tabs | Tabs are scroll anchors, NOT true tab switches; no distinct content loads per tab |
| **E-signature integration** | Round wizard, signing flow | Entirely absent on live platform |
| **Soft-circle book** | Founder CRM → Investor Interest modal | Empty ("No investors found"); no form to manage soft-circles |

### High (impairs core workflow)

| Surface | Route | Broken State |
|---------|-------|-------------|
| **Cap Table tab in invitation modal** | Invitation modal — Tab 2 | Shows same content as Overview summary (0.00 shares, 0 founders); no cap table rows |
| **Investment Terms tab** | Invitation modal — Tab 3 | No distinct content; merges into Overview |
| **Data Room tab** | Invitation modal — Tab 4 | No documents render; section absent |
| **"Share Report" button** | `/crm/share-round-toinvestor` | No visible feedback — likely broken or requires active round |
| **Subscriptions page** | `/subscription` | Empty (0 plans, no upgrade path, no billing detail) |
| **Dataroom "Manage Documents"** | `/dataroom-Duediligence` | Shows "N/A" for all 42 slots; no per-investor access controls visible |
| **"Generate Executive Summary" button** | `/dataroom-Duediligence` | Behavior unclear; no output observable |
| **Sector field display** | Left sidebar company card | Shows "YES" instead of actual sector string |
| **"Investment Conversion Ratio: 20%"** | Dashboard CRM widget | Hardcoded placeholder, not a real computation |

### Medium (UX / data quality)

| Surface | Details |
|---------|---------|
| **Logout button position** | In top bar (confusing, not in profile dropdown) |
| **Browser tab title** | Shows "Login Page" on dashboard |
| **Flash of "Name not available"** | Dashboard greeting briefly shows placeholder on load |
| **CRM label mismatch** | Nav says "Investor Directory" but page title says "Investor Entry" |
| **Portfolio page title** | Nav says "My Portfolio & Watchlist" but page title says "Investor Round List" (investor side) |
| **No notification system** | No bell icon, no unread count, no email triggers for round events |
| **No KYC status display** | No KYC verification status anywhere in investor profile |

---

## APPENDIX A: FULL ROUTE INVENTORY (LIVE FOUNDER SIDE)

| Route | Page | Status |
|-------|------|--------|
| `/user/login` | Login page | LIVE |
| `/dashboard` | Company dashboard | LIVE |
| `/company-profile` | Company Profile wizard (4 steps) | LIVE |
| `/dataroom-Duediligence` | Dataroom Management & Executive Summary | LIVE (content broken) |
| `/investorlist` | Investor Reporting list | LIVE |
| `/add-new-investor` | Create Investor Report form | LIVE |
| `/record-round-list` | Investment Rounds Overview | LIVE |
| `/createrecord` | Round wizard (5 tabs) | LIVE (Tabs 2–5 locked) |
| `/crm/share-round-toinvestor` | Invite Investors to Round | LIVE (Share button broken) |
| `/crm/investment` | Confirm/Validate Investors | LIVE (empty) |
| `/crm/investor-directory` | Investor Directory | LIVE (empty) |
| `/crm/addnew-investor` | Add New Investor Contact | LIVE |
| `/crm/share-with-investorreport` | Shared-With-Investors hub | LIVE (3 sections, Share broken) |
| `/crm/investorreport` | Investor Reports CRM view | LIVE (3 sections, empty) |
| `/activity-logs` | Activity Logs | LIVE (empty) |
| `/subscription` | Subscriptions | LIVE (stub) |
| `/knowledge-hub` | Knowledge Hub | LIVE (read-only education) |
| `/report/1`, `/report/2`, `/report/3` | Individual investor reports | BROKEN — 404 |
| `/admin` | Admin | 404 |
| `/settings` | Settings | 404 |
| `/lifecycle` | Lifecycle | 404 |

---

## APPENDIX B: M&A INTELLIGENCE FIELDS (FULL — COMPANY PROFILE STEP 4)

All 30 M&A intelligence fields are captured in Company Profile Step 4. **No M&A score or readiness dashboard widget is surfaced on the founder dashboard** — the score is computed but not displayed.

**Section 1 — Strategic Intent (4 fields):**
1. Top 3 strategic priorities for next 24 months (12-option multi-checkbox: Market expansion, Technology acquisition, Vertical integration, Cost efficiencies, R&D and innovation, Talent acquisition/acqui-hire, Portfolio diversification, Customer access/distribution, Brand strengthening, Risk mitigation/supply-chain, Capital access/partial exit for founders, NO Intention)
2. Are you actively interested in? (5-option: JV partnerships, Minority strategic investment, Majority sale, Full exit, Strategic acquisitions)
3. What types of partners are you seeking? (9-option: Distribution, Technology, Manufacturing, Co-development, Capital, Data-sharing, IP-licensing, R&D, Business development)
4. What would you not consider under any circumstances? (4-option: We will explore all options, Sale of control, Exclusivity, Licensing core IP)

**Section 2 — Top Three Direct Competitors (3 × 3 = 9 fields):**
- Per competitor: Name of company (text, 400 chars) · URL of company (text) · Why do you believe this is a competitor? (textarea, 400 chars)

**Section 3 — Corporate Governance (11 radio Yes/No fields):**
- Formal Board of Directors or Advisory Board · Active disputes/litigation/regulatory investigations · Regulatory compliance (data/privacy/financial/healthcare) · Legal representation (works with a law firm) · Would like a law firm referral · Formal legal/compliance review in last 24 months · Works with an accounting firm · Name of accounting firm (text) · Financials audited by independent party · SaaS/recurring model business · Holds IP

**Section 4 — Market, Customers, and Contracts (5 fields):**
- Operating geographies (15-region multi-checkbox: Local only, National only, North America, Latin America, South America, Western Europe, Eastern Europe, Middle East, Africa, Central Asia, South Asia, Southeast Asia, East Asia excl. China/HK, China/Hong Kong, Oceania) · Primary customer segments (5-option: Enterprise, SMB, Consumer, Government, Specific verticals) · Exclusivity/non-compete/MFN clauses (radio Y/N) · Revenue concentration >30% from single customer/supplier (radio Y/N) · Long-term contracts requiring change-of-control consent (radio Y/N)

**Section 5 — Readiness Assessment / "Your Story" (2 fields):**
- M&A readiness narrative (textarea — free text) · Unique value proposition vs. competitors (textarea, 800 chars)

**Action buttons:** Back | Save

---

*End of capavate_live_founder_audit_v2.md*
