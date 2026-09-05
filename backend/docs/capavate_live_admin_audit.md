# Capavate Live Admin Audit (Founder-Side)
**Version:** v1.0  
**Date:** 2026-05-09  
**Auditor:** Admin + Bridge subagent  
**Primary sources:** `capavate_live_founder_audit_v2.md`, `capavate_founder_deep_audit.md`, `capavate_master_build_spec.md`, `SPRINT-11-FOUNDER-SUMMARY.md`, `SPRINT-11-PROGRESS.md`, `SPRINT-11-PHASE2-PROGRESS.md`, `capavate_gating_addendum.md`, `capavate_collective_sync_schema.md`  
**Account:** Ozan Isinak / NovaPay AI  
**Entry URL:** `https://capavate.com/user/login` → `https://capavate.com/dashboard`  
**Note:** "Admin" on the live Capavate is not a distinct UI surface — admin routes (`/admin`, `/settings`) return 404. The rebuild (Sprint 11) has 10 admin routes as an internal Vite app. This audit documents BOTH live state and rebuild state for each area.

---

## §1. ALL ADMIN ROUTES

### 1.1 Live Platform — Admin Routes

**Status: NONE.** The live `capavate.com` has no admin routes:

| Route | Expected purpose | Live status |
|-------|-----------------|-------------|
| `/admin` | Admin dashboard | **404 — Page not found** |
| `/settings` | Settings | **404 — Page not found** |
| `/lifecycle` | Lifecycle policy | **404 — Page not found** |
| `/admin/lifecycle-policy` | Lifecycle policy management | **404 — Page not found** |
| `/admin/audit-log` | Audit log | **404 — Page not found** |
| `/admin/algorithms` | Algorithm Console | **404 — Page not found** |
| `/admin/spv` | SPV management | **404 — Page not found** |

Admin functionality on the live platform is entirely absent from the UI. Admin operations (account management, pricing, lifecycle) would require direct database access or a separate back-office tool.

### 1.2 Rebuild (Sprint 11) — Admin Routes (10 total)

Sprint 11 summary: "**Routes**: 15 founder (was 14, +1 apply-to-collective) · 9 investor · **10 admin**"

| Route | Page | State |
|-------|------|-------|
| `/admin/dashboard` | Admin Dashboard | RENDERED — walked with 0 console errors |
| `/admin/pricing` | Admin Pricing Management | RENDERED — `GET /api/admin/pricing-tiers` wired |
| `/admin/lifecycle-policy` | Lifecycle Policy (Platform Defaults / Group Rules / Company Overrides / Audit Log) | Built per spec |
| `/admin/algorithms` | Algorithm Console — M&A scoring weight tuning | Built; `isAdmin` gate |
| `/admin/audit-log` | Audit log with hash chain | Built per `capavate_master_build_spec.md` §12 |
| `/admin/spv` | SPV Management cards | Built (R171/R172 dev notes) |
| `/admin/companies` | Companies admin area | Inferred from spec §4 |
| `/admin/investors` | Investors admin area | Inferred from spec |
| `/admin/users` | User management | Inferred from spec |
| `/admin/reconciliation` | Reconciliation / drift alarms | Built (nightly job surfaced here) |

The rebuild deploys as a new service (`app.capavate.com`) federated with the live site via SSO. The admin routes are part of the rebuild SPA, not part of the live `capavate.com`.

### 1.3 Admin Pricing Store (`server/adminPricingStore.ts`)

Built in Sprint 11 Phase 1. Exports `PRICING_TIERS`:

| Tier | Monthly price | Notes |
|------|--------------|-------|
| `founder_free` | $0 | Free tier |
| `founder_pro` | $249/month | Pro tier |
| `founder_scale` | $749/month | Scale tier |

Endpoint: `GET /api/admin/pricing-tiers` — read by founder Settings D10 ("Plan & Pricing" tab reads live tier list from this endpoint).

---

## §2. ADMIN DASHBOARD

### 2.1 Live Platform

**No admin dashboard exists.** The live `/dashboard` is the founder company dashboard — a single-company workspace. Admin-level visibility is absent.

Live `/dashboard` shows (NovaPay AI account):
- Company name: NovaPay AI
- Sector field: shows **"YES"** — DATA BUG (should be "Fintech & Digital Payments")
- All metrics: 0 (no rounds, no investors, no cap table entries)
- CRM Conversion Summary: shows **"Investment Conversion Ratio: 20%"** — HARDCODED PLACEHOLDER BUG
- Logout button: in top navigation bar — non-standard position

### 2.2 Rebuild Admin Dashboard (`/admin/dashboard`)

Per Sprint 11 QA walk: `"/admin/dashboard"` rendered with 0 console errors. Macro platform overview (inferred from spec and build evidence):

| Widget | Data source |
|--------|------------|
| Active founders count | `company_members WHERE role IN ('founder', 'co-founder')` |
| Active investors count | `round_participants WHERE status IN ('confirmed', 'signed', 'funded')` |
| Total rounds open | `rounds WHERE status IN ('soft_circle_open', 'signing_open')` |
| Cap-table drift alarms | `live_events WHERE kind = 'cap_table.drift_detected'` |
| Email delivery SLA | `email_outbox` unprocessed count + avg dispatch lag |
| Member pending review | `membership_applications WHERE status = 'reviewing'` |
| Pricing tier distribution | From `adminPricingStore.ts` PRICING_TIERS + `billing` data |
| Company switcher | `CompanySwitcher` topbar: 3-company seed (NovaPay AI / Arboreal Health / Quanta Robotics) |

**Gaps vs. macro platform overview:**
- No per-region breakdown visible (9 regions are locked in constants but not surfaced in admin dashboard)
- No revenue dashboard or Stripe revenue summary (wired to Stripe Connect in Q3 per roadmap)
- No funnel analytics (invited→funded conversion rates by company or sector)

---

## §3. BELL ICON — BROKEN STATE

### 3.1 Live Platform — Confirmed Broken

**Status: ABSENT on live Capavate (both founder and investor sides).**

Per `capavate_master_build_spec.md` §9.5 (explicitly documented as `investor-audit GAPS #2, #3`):
> "A bell icon with unread count badge is added to the investor top bar (replaces the current logout-as-notification-position trap [investor-audit GAPS #2])"

What exists instead:
- **Logout button** occupies the top-bar position where the notification bell should appear
- This creates a "UX trap" — the logout button is styled/positioned to look like a notification indicator
- No bell icon, no unread count badge, no notification center anywhere on the live platform (founder or investor side)

### 3.2 Where the Wire is Missing

The notification pipeline requires:
1. `notifications` table — missing from live MySQL schema
2. BullMQ queue for notification fan-out — not configured
3. SSE endpoint `GET /api/notifications/stream` — does not exist on live
4. Bell icon component in `AppShell.tsx` — not present in live codebase
5. `NotificationPreferences` API routes — not present

### 3.3 What the Rebuild Wires

In Sprint 11 rebuild (`AppShell.tsx`):
- Theme toggle **removed** (no dark mode)
- Version badge updated to `v0.11.0`
- `CompanySwitcher` slot added
- Logout moved to profile dropdown (not confirmed as shipped in Sprint 11 Phase 1, deferred to Phase 2 D10 Settings)

Per master build spec §9.5:
- Bell icon with unread count in investor top bar
- Logout moves to profile dropdown under user avatar
- SSE: `GET /api/notifications/stream` — `text/event-stream`, events: `notification` + `ping` (keepalive every 30s)
- Mark-all-read: `POST /api/notifications/read-all`
- Preferences: `GET/PATCH /api/notifications/preferences`

**Current rebuild state (Sprint 11):** Bell icon is referenced in spec but not confirmed as a shipped Phase 2 UI component. The `membershipStore.ts` and strict gating are wired; the notification bell UI is among the D10 Settings items that shipped in Sprint 11 Phase 2 (`10 notification toggles` in Settings D10).

---

## §4. PRICING PAGE

### 4.1 Live Platform (`/subscription`)

**Status: STUB — completely empty and non-functional.**

| Element | State |
|---------|-------|
| Active plans count | **0** |
| Empty state message | "No subscriptions yet — You don't have any active subscriptions at the moment." |
| "Browse Plans" / "Upgrade" button | **ABSENT** |
| Current plan details | **ABSENT** |
| Renewal date | **ABSENT** |
| Billing history | **ABSENT** |
| Payment method management | **ABSENT** |
| Invoice download | **ABSENT** |

The only pricing entry point on the live founder side is the **"Join Capavate Angel Network"** modal (sidebar star icon), which is a waitlist form for the $1,200/year Collective membership — it does NOT create a subscription record on the `/subscription` page.

**Critical gap:** The `/subscription` page is a dead end. No pathway from it to any plan, upgrade, or billing management.

### 4.2 Rebuild Admin Lifecycle-Policy (Pricing)

Route: `/admin/lifecycle-policy`  
Tabs: **Platform Defaults · Group Rules · Company Overrides · Audit Log**

Three-layer precedence: Company Override > Group Rule > Platform Default  
Group rule scopes: `cohort / chapter / sector / stage / tier / ad-hoc`

Policy fields tunable by admin (10 fields):

| Field | Default |
|-------|---------|
| `founderTenureDays` | 180 |
| `archiveRetentionDays` | 3650 |
| `nonPaymentGraceDays` | 30 |
| `requiredForVotes` | admin-tunable |
| `majorityThresholdPct` | admin-tunable |
| `vintageCutoffMonths` | admin-tunable |
| `defaultCheckSizeMinUsd` | $5,000 |
| `defaultCheckSizeMaxUsd` | $25,000 |
| `monthlyMeetingMinutes` | admin-tunable |
| `rsvpCutoffHours` | admin-tunable |

### 4.3 Rebuild Founder Settings — Plan & Pricing Tab (D10)

Route: `/founder/settings` → "Plan" tab  
Evidence: `live tier list from /api/admin/pricing-tiers` — reads PRICING_TIERS from `adminPricingStore.ts`:

| Tier ID | Monthly price |
|---------|--------------|
| `founder_free` | $0 |
| `founder_pro` | $249 |
| `founder_scale` | $749 |

**Admin pricing sync gap documented:** The live `/subscription` page does NOT read from the policy engine. There is zero bidirectional sync between admin lifecycle policy settings and what founders see on their subscription page. This is the definitive "settings/pricing/admin sync gap."

### 4.4 Collective Membership Pricing

| Tier | Annual Fee |
|------|-----------|
| Standard (Angel Network) | $1,200 USD/year |
| Tier-adjusted | Variable (admin-managed) |
| Partner discount | Via `?cp={partner_slug}` referral code |

Payment: Stripe embedded checkout. Cards: Stripe Elements (Card number / Expiry / CVC / Cardholder name / Billing address). Alternative: "Pay by invoice" (admin-approved only).

---

## §5. RECONCILIATION PAGE

### 5.1 Live Platform

**No reconciliation page exists** on the live `capavate.com`. The Activity Logs page (`/activity-logs`) shows a table with columns (Module / Action / Entity Name/Details / IP Address / Date) but has zero records for the NovaPay AI account and does not surface reconciliation-specific data.

### 5.2 Rebuild State

Per `capavate_master_build_spec.md` §10.8 — Reconciliation Job:

A **nightly scheduled job** detects drift between:
1. Sum of `transactions.quantity WHERE type IN ('issue')` per security vs. `securities.face_value` / implied share count
2. Computed FD count from transaction ledger vs. materialized `cap_table_snapshots` view
3. Sum of `round_participants.commitment_amount` vs. `rounds.round_size_closed`

Drift alarm: `live_events` row with `kind = 'cap_table.drift_detected'` → admin notification.

The **Cap-table Commit Pipeline** (D12, route `/founder/rounds/:id`) surfaces reconciliation within the round:
- `card-commit-pipeline` with 6 stages: `stage-invited → stage-viewed → stage-soft_circle → stage-signed → stage-funded → stage-committed`
- `button-commit-funded` — founder commits funded investors to cap table
- **Reconciliation badge** — shows cap-table-engine vs. reference engine comparison
- **Compliance-hold banner** — surfaced when admin places a hold

Admin-level reconciliation:
- `/admin/reconciliation` — built in rebuild (admin route #10); surfaces drift alarms from `live_events`
- Dead-letter queue: failed outbox events from Collective sync appear in `/admin/audit-log`
- Manual trigger: admin can force `eligibility.recomputed` event for a specific company

**Future (v1.1):** Plaid/Teller/Finch integration for automated bank reconciliation. `payment_gateways.provider = 'plaid'` reserved.

---

## §6. TELEMETRY PAGE

### 6.1 Live Platform

**No telemetry page exists** on live `capavate.com`. No analytics or event browser is accessible to the founder or admin on the live platform.

### 6.2 Rebuild State

Per spec — OpenTelemetry + Grafana stack:
- All API requests instrumented with trace spans
- `live_events` table captures platform-level events (cap-table drift, SPV launch, DSC assignment)
- `formulaTrace[]` in cap-table events: `[{formulaId, version, region, defHash}]` — engine attribution chain

The Activity Log page (D9, route `/founder/activity`) in the rebuild provides:
- Audit-grade timeline from telemetry events
- Filterable by: date / type / actor / entity
- Searchable
- CSV export button
- Hash-chained badge (shows audit chain status)
- `data-testid`: 37 testids confirmed in Sprint 11 QA walk

The admin-level telemetry (Grafana / OpenTelemetry) is infrastructure-level — not surfaced as a user-facing page in the rebuild; it is a DevOps / SRE tool.

---

## §7. AUDIT LOG PAGE

### 7.1 Live Platform (`/activity-logs`)

**Status: STRUCTURE EXISTS — no data.**

| Element | State |
|---------|-------|
| Table columns | Module · Action · Entity Name/Details · IP Address · Date |
| Search field | Present |
| Data | Zero records (NovaPay AI account has taken no audit-logged actions) |
| Filter by Module | **ABSENT** |
| Date range picker | **ABSENT** |
| Export (CSV/PDF) | **ABSENT** |
| Hash-chain visualization | **ABSENT** — live audit log is a simple table, NOT hash-chained |

**Critical gap:** The live `/activity-logs` is not the hash-chained audit log described in R165 §12. It is a simple append table with no cryptographic integrity. No READ actions are logged (only writes). No tamper-evident UI.

### 7.2 Rebuild State (D9 / Admin)

**Rebuild Activity Log** (`/founder/activity`):
- Audit-grade timeline: hash-chained badge visible
- Filters: date / type / actor / entity
- Searchable
- CSV export (`data-testid: button-export-csv` confirmed)
- Hash-chained integrity badge

**Admin Audit Log** (`/admin/audit-log`):
- Full hash-chain view with `prior_hash` → `this_row_hash` visualization
- Broken link highlighted in red
- Dead-letter queue for failed Collective sync events
- Export: `GET /api/audit/{company_id}/export` → JSON file with verification checksum
- REVOKE UPDATE/DELETE from `capavate_app` DB role — append-only enforced at DB layer
- Lifecycle policy changes visible under Lifecycle Policy → Audit Log tab

**Hash-chain fields (per entry):**
```sql
INSERT INTO audit_log (..., this_row_hash = hmac(prev_hash || event_data));
```

---

## §8. INVESTOR ADMIN AREA

### 8.1 Live Platform — CONFIRMED WEAK

Per `capavate_master_build_spec.md` §1.1: "Investor admin area — confirmed weak per user."

Current state of investor-related admin surfaces on live:

| Surface | Route | State |
|---------|-------|-------|
| Investor Directory | `/crm/investor-directory` | LIVE — **label bug**: nav says "Investor Directory" but page title says "Investor Entry"; empty state |
| Add New Investor Contact | `/crm/addnew-investor` | LIVE — only 3 fields: First Name, Last Name, Email |
| Confirm/Validate Investors | `/crm/investment` | LIVE — page title "Investment Confirmation"; empty state |
| Investor Interest Modal | Triggered from dashboard | LIVE — modal shows "No investors found" |
| Shared-With-Investors | `/crm/share-with-investorreport` | LIVE — "Share Report" button unresponsive (likely broken or requires active round) |
| Investor Reports CRM | `/crm/investorreport` | LIVE — 3 sections, all empty |

**Critical gaps in investor admin:**

| Missing Feature | Impact |
|----------------|--------|
| Only 3 fields to add an investor (First, Last, Email) | Cannot capture fund, sector focus, check size, geography, relationship notes |
| No bulk CSV import | Cannot import existing investor lists |
| No pipeline stages (Lead/Met/DD/Soft-Circle/Invested/Exited) | No CRM pipeline view |
| No touch-point log | No relationship history |
| No task tracking per contact | No follow-up reminders |
| No tag/label system | Cannot segment investor contacts |
| No deal association per contact | Cannot link contacts to rounds |
| No engagement metrics per investor | No email open rate, document view signal |
| "Share Report" button unresponsive | Cannot share material from CRM |
| No per-investor access controls on dataroom | `dataroom_grants` not exposed in UI |
| No KYC/accreditation status display | Cannot see investor KYC state from admin |
| No invitation state visibility (pending/viewed/expired) | Cannot see which investors have opened invitations |

### 8.2 Rebuild State (D5 — Investor CRM)

Route: `/founder/crm`  
Page title: "Investor CRM"

**5-stage kanban pipeline:** Lead → Engaged → Soft-Circle → Invested → Long-term  
Per-investor card includes: holdings + soft-circle history + M&A signals + threads + notes + tasks  
Bulk + segmented broadcast from CRM  
62 testids confirmed in Sprint 11 QA walk.

**Rebuild also adds:**
- `server/founderCrmStore.ts` — 5 contacts, 5-stage pipeline (lead/engaged/soft_circle/invested/longterm), segmented broadcast
- `GET /api/founder/crm/contacts` — contact list
- Investor card with full profile: investment thesis, check size, sector focus, geography, portfolio track record
- `canMessage()` check from visibility resolver (requires shared cap table or Collective membership)
- Per-investor message threads accessible from CRM contact panel

---

## §9. USER MANAGEMENT

### 9.1 Live Platform — ABSENT

No user management surface exists on live `capavate.com`:
- No admin user list
- No role assignment UI
- No MFA enforcement controls
- No session management (force-logout)
- No account suspension
- No impersonation

Team management is referenced as a missing settings tab: `/settings/team` — ABSENT on live.

### 9.2 Rebuild State

**Founder Settings D10 — Team & Permissions tab** (`/founder/settings` → Team tab):
- Add/remove team members
- Role assignment (founder / co-founder / operator / advisor)
- Multi-company architecture: `multiCompanyStore.ts` seeds co_novapay (founder), co_arboreal (co-founder), co_kelvin (advisor)
- Each company has separate cap table, dataroom, billing, pricing, settings, Collective application

**Admin-level user management** (rebuild):
- Auth0 tenant-level: admin can force-expire sessions via Auth0 Management API
- SCIM provisioning for enterprise SSO tenants
- Impersonation: admin can impersonate any company (per master build spec §4)
- Suspension: `collective_memberships.status = 'suspended'` — admin can set

**Role model (rebuild):**

| Role | JWT roles[] value | Capabilities |
|------|------------------|--------------|
| Admin | `'admin'` | Full platform; impersonation; billing; audit chain; algorithm tuning |
| Founder | `'founder'` | Own company: profile, cap table, rounds, CRM, dataroom, reports |
| Co-founder | `'co-founder'` | Same as Founder for permissions |
| Investor | `'investor'` | Invitation-based; dashboard + portfolio + connections |
| DSC Member | `'dsc_member'` | Investor + DSC Screening Queue + Screening Rooms |
| Network Member | `'network_member'` | All Collective member routes |

---

## §10. CAPAVATE ↔ COLLECTIVE TOGGLE (LIVE CAPAVATE SIDE)

### 10.1 Does It Exist on Live?

The toggle (as a named UI element) does NOT exist on the live `capavate.com` founder side. There is no visible "Enter Collective" button, "Go to Collective" link, or toggle anywhere in the founder dashboard navigation except:

**"★ Join Capavate Angel Network"** — first item in the left sidebar nav (star icon):
- Triggers a modal overlay titled "Join the waitlist for Capavate Angel Network Membership"
- This is a **waitlist form only** — does NOT toggle between Capavate and Collective
- After submission, founder is added to a review queue (no immediate access)
- The modal does NOT create a subscription record on `/subscription`
- No other Collective entry point exists on the founder dashboard

**Collective deal room, DSC, SPV, and M&A intelligence surfaces are entirely absent from the live founder navigation** — not locked behind a subscription, simply not present.

### 10.2 On the Investor Side (Live)

The Collective toggle manifests as the **cap-table status badge** in the investor sidebar:
- `"Investor: NOT on a cap table"` (red tag) — gating is applied; Collective features blocked
- Badge shown at: `https://capavate.com/investor/dashboard` — confirmed live observation

### 10.3 Rebuild — Toggle Conditions

Per Sprint 11: *"Lapsed renewal → Collective toggle disappears"*

The Collective toggle (sidebar navigation item "Apply to Collective" / "Enter Collective") is controlled by:

| Condition | Toggle state |
|-----------|-------------|
| User has ≥1 confirmed cap-table position (`round_participants.status IN ('confirmed', 'signed', 'funded')`) | Toggle APPEARS (eligible) |
| User is founder of a Capavate company | Toggle APPEARS (eligible as founder) |
| User is signatory on ≥1 Capavate company | Toggle APPEARS |
| Consortium partner vouch weight ≥ 1 | Toggle APPEARS |
| Zero confirmed cap-table positions + no founder/signatory role | Toggle ABSENT or shows waitlist CTA |
| `collective_memberships.status = 'active'` | Full Collective access (all routes accessible) |
| `collective_memberships.status = 'suspended'` (lapsed) | Toggle DISAPPEARS |
| `collective_memberships.status = 'reviewing'` | Toggle shows "Application under review" state |

**Origination rule:** All companies on Collective originate from Capavate. The only exception is standalone SPVs (R170/R171), which originate on Collective itself.

---

## §11. LOGIN FLOWS

### 11.1 All Login Surfaces (Live Platform)

| # | Surface | URL | Title | Gating language |
|---|---------|-----|-------|----------------|
| 1 | **Founder/Company** | `/user/login` | "Login Page" ← **BUG: should be "Capavate — Sign In"** | Standard email/password; no gating language |
| 2 | **Investor/Collective** | `/investor/login` | "Investors & Shareholders Login" | *"You're entering a secure, invitation-only investor portal."* · Shield: *"Capavate's verified network."* · Banner: **"Verified Investors & Shareholders Portal 🔒 — Access restricted to invited and accredited Capavate members"** |
| 3 | **Investor Signup (token)** | `/investor/signup?token=<token>` | 3-step inline signup | Exists ONLY with valid unexpired token; 404s without valid token |
| 4 | **Admin** | No separate URL | Same as founder + `roles[]` claim | No visible admin-specific login page |

**No unified login surface** exists on the live platform — founder and investor logins are separate pages with separate session handling.

### 11.2 Which Are Unified, Which Are Separate

| Surface | Same Auth0 `user.sub`? | Same JWT session? | Cross-portal access? |
|---------|----------------------|-------------------|---------------------|
| Founder `/user/login` → `/dashboard` | ✓ | Separate session cookie | No auto-routing to investor dashboard |
| Investor `/investor/login` → `/investor/dashboard` | ✓ | Separate session cookie | No auto-routing to founder dashboard |
| Admin | ✓ (same account as founder) | Same JWT, role gates | Admin UI absent on live; routes 404 |
| Collective (rebuild) | ✓ | Unified — single Auth0 session | Single JWT grants access to both |

**Rebuild architecture:** Single Auth0 tenant, single JWT, `aud` claim determines product (`capavate.com` vs. `collective.capavate.com`). `roles[]` claim routes post-auth. "No second account, no second login, no second cap-table sync." — master build spec §25.

### 11.3 Routing After Login (Rebuild)

```
Login complete
  ├─ roles includes 'admin' → /admin/dashboard
  ├─ roles includes 'founder' → /founder/dashboard
  │     └─ CompanySwitcher available for multi-company users
  ├─ roles includes 'investor' → /investor/dashboard
  │     ├─ isEligibleForCollective = true → /collective/#/ accessible from nav
  │     └─ isEligibleForCollective = false → /collective/ shows waitlist modal
  └─ roles includes 'dsc_member' → same as investor + /collective/#/dsc accessible
```

### 11.4 Password Reset

- Not directly observed on live platform during audits
- Assumed: standard "Forgot password?" link on `/user/login` → Auth0 email reset flow
- No confirmed URL or field-level detail from audited files

### 11.5 Known Login Bugs (Live)

| Bug | Details |
|-----|---------|
| Browser tab title shows "Login Page" | Should be "Capavate — Sign In" or equivalent |
| Flash of "Name not available" | Dashboard greeting briefly shows placeholder on load before auth resolves |
| Logout button in top bar | Non-standard; should be in profile dropdown (documented as `investor-audit GAPS #2`) |
| No Google/SSO OAuth button | Auth0 supports Google federation but not configured/visible on live |
| No magic-link/passwordless option | Not observed on live |

---

## §12. REAL-TIME SYNC VERIFICATION (CAPAVATE → INVESTOR VIEW)

### 12.1 Does an Edit on Founder Side Update Investor View Live?

**Sprint 8 deliverable — Investor View Sync (D2):**
- Route: `/founder/company` → `CompanyProfile.tsx` with `"View as investor"` modal
- Button label: **"View as investor"** — preview toggle at top of company profile wizard
- Renders: `CompanyDetails.tsx` in investor mode — same shared renderer used by Collective
- **TanStack Query invalidation on PATCH** — when founder saves company profile (`PATCH /api/companies/:id`), all investor-facing queries for that company are invalidated
- Live preview chip: `badge-live-preview` — real-time sync indicator

**Sprint 11 Phase 2 evidence (D2):**
> "\"Investor View\" modal renders exact mirror of `investor/CompanyDetail.tsx` with shared data hook · TanStack Query invalidation on PATCH · Live preview chip"

**Status on live `capavate.com`:** The "View as investor" button was NOT confirmed present on the live production platform. It exists in the Sprint 8+ rebuild build. This represents drift between rebuild and live platform.

### 12.2 What Prevents Real-Time Sync on Live

| Gap | Detail |
|-----|--------|
| No TanStack Query / React Query on live | Live platform uses legacy state management without reactive invalidation |
| No shared renderer | Founder and investor company views are separate UI templates on live |
| No SSE for real-time updates | Server-Sent Events endpoint absent on live |
| No outbox/webhook relay | The Capavate → Collective sync pipeline is not running on live |
| No `cap_table.mutated` event | Cap table engine not wired on live |

### 12.3 Rebuild Real-Time Sync Architecture

Per Sprint 7–11 deliverables:

1. **Founder edits company profile** → `PATCH /api/companies/:id` → TanStack Query invalidates all queries keyed to `companyId`
2. **Investor dashboard** auto-refetches via TanStack Query stale-while-revalidate → investor sees updated profile within one network roundtrip
3. **Cap table mutation** → `captableCommitStore.ts` → hash-chained ledger → `cap_table.mutated` outbox event → Collective eligibility recompute
4. **Collective sync** → `eligibility.recomputed` event → `collective_eligibility_audit` → `collective_memberships.status` update → bell notification
5. **"View as investor" preview** → iframe rendering `#/investor/companies/:id` with `badge-live-preview` indicator

### 12.4 Sprint 7–11 Deliverables Summary

| Sprint | Deliverable | Sync relevance |
|--------|------------|----------------|
| Sprint 7 | Gating addendum — invitation-only investor entry, token model | Defines when investor can access investor view |
| Sprint 8 | Company profile + investor view modal, "View as investor" button | First real-time sync UX: founder edits → investor preview updates |
| Sprint 9 | Communications system — DM messages, posts feed | Bidirectional real-time communications wired |
| Sprint 10 | Investor experience — soft-circle, KYC, accreditation, portfolio | Investor-side state machine wired; `eligibility.recomputed` pipeline |
| Sprint 11 | Multi-company auth, strict gating, cap-table commit pipeline | `membershipStore` + `strictGatingGuard`; `captableCommitStore` hash chain; Lapsed renewal → Collective toggle disappears |

---

## §13. FULL ROUTE INVENTORY (LIVE FOUNDER SIDE)

| Route | Page | Status |
|-------|------|--------|
| `/user/login` | Login page | LIVE |
| `/dashboard` | Company dashboard | LIVE — data bugs, broken widgets |
| `/company-profile` | Company Profile wizard (4 steps) | LIVE |
| `/dataroom-Duediligence` | Dataroom Management & Executive Summary | LIVE — content broken (all 42 slots show "N/A") |
| `/investorlist` | Investor Reporting list | LIVE |
| `/add-new-investor` | Create Investor Report form (6 sections) | LIVE |
| `/record-round-list` | Investment Rounds Overview | LIVE |
| `/createrecord` | Round wizard (5 tabs) | LIVE — Tabs 2–5 locked |
| `/crm/share-round-toinvestor` | Invite Investors to Round | LIVE — Share button broken |
| `/crm/investment` | Confirm/Validate Investors | LIVE — empty |
| `/crm/investor-directory` | Investor Directory | LIVE — label bug; empty |
| `/crm/addnew-investor` | Add New Investor Contact (3 fields) | LIVE |
| `/crm/share-with-investorreport` | Shared-With-Investors hub | LIVE — 3 sections; Share button broken |
| `/crm/investorreport` | Investor Reports CRM view | LIVE — 3 sections; empty |
| `/activity-logs` | Activity Logs | LIVE — empty; not hash-chained |
| `/subscription` | Subscriptions | LIVE — STUB (0 plans) |
| `/knowledge-hub` | Knowledge Hub | LIVE — read-only education |
| `/report/1`, `/report/2`, `/report/3` | Individual investor reports | **BROKEN — 404** |
| `/admin` | Admin | **404** |
| `/settings` | Settings | **404** |
| `/lifecycle` | Lifecycle | **404** |

---

## §14. REBUILD ROUTE INVENTORY (SPRINT 11)

### Founder Routes (15 total)

| Route | Page | Sprint 11 status |
|-------|------|-----------------|
| `/founder/dashboard` | Dashboard v2 | SHIPPED — 147 testids, 0 errors |
| `/founder/company` | Company Profile + Investor View | SHIPPED — 48 testids |
| `/founder/captable` | Cap Table enhancements | SHIPPED — 72 testids |
| `/founder/rounds/new` | Round Wizard (warrants, ESOP, regions) | SHIPPED — 42 testids |
| `/founder/crm` | Investor CRM 5-stage pipeline | SHIPPED — 62 testids |
| `/founder/dataroom` | Dataroom 4-tab rebuild | SHIPPED — 51 testids |
| `/founder/reports` | Investor Reports (templates, schedule, receipts) | SHIPPED — 30 testids |
| `/founder/messages` | Messages unified linking | SHIPPED — 72 testids |
| `/founder/activity` | Activity Log audit-grade | SHIPPED — 37 testids |
| `/founder/settings` | Settings 7-tab rebuild | SHIPPED — 41 testids |
| `/founder/apply-to-collective` | Apply to Capavate Collective (Path A + B) | SHIPPED — 29 testids |
| `/founder/rounds/:id` | Round Detail + Cap-table Commit Pipeline | SHIPPED — 58 testids |
| `/founder/rounds/:id/commit` | Commit pipeline CTA | Part of `/founder/rounds/:id` |
| `/investor/signup?token=...` | Investor signup (gated) | Spec-defined; not a founder route |
| `/investor/login` | Investor login | LIVE (separate) |

### Investor Routes (9 total, Sprint 11)

| Route | Sprint 11 status |
|-------|-----------------|
| `/investor/dashboard` | SHIPPED — 0 errors |
| `/investor/companies` | SHIPPED — 0 errors |
| `/investor/companies/:id` | Walked with `?tab=` param — 0 errors |
| `/investor/portfolio` | SHIPPED |
| `/investor/crm` | SHIPPED |
| `/investor/apply-to-collective` | SHIPPED |
| `/investor/invitations` | SHIPPED |
| `/investor/company-invitation-list` | Part of invitations |
| `/investor/profile` | Existing |

### Admin Routes (10 total, Sprint 11)

| Route | Sprint 11 status |
|-------|-----------------|
| `/admin/dashboard` | RENDERED — 0 errors |
| `/admin/pricing` | RENDERED — `GET /api/admin/pricing-tiers` wired |
| `/admin/lifecycle-policy` | Built per spec |
| `/admin/algorithms` | Built; `isAdmin` gate |
| `/admin/audit-log` | Built |
| `/admin/spv` | Built |
| `/admin/companies` | Inferred |
| `/admin/investors` | Inferred |
| `/admin/users` | Inferred |
| `/admin/reconciliation` | Built |

---

## §15. BROKEN / WEAK SURFACES — FULL INVENTORY

### Critical (blocks commercial use)

| Surface | Route | State |
|---------|-------|-------|
| **Investor report links** | `/report/1`, `/report/2`, `/report/3` | All return HTTP 404 |
| **Soft-circle form** | Invitation modal — "Your Decision" tab | Shows empty table; missing all form controls (no Accept/Decline radio, no amount field, no submit CTA) |
| **Cap Table page** | No standalone route | `/record-round-list` is the only entry; no shareholder rows, no FD view, no export |
| **Modal tab navigation** | Invitation modal — all 5 tabs | Tabs are scroll anchors, NOT true tab switches |
| **E-signature integration** | Round wizard, signing flow | Entirely absent on live platform |
| **Soft-circle book** | Founder CRM → Investor Interest modal | "No investors found" — completely empty |
| **Admin routes** | `/admin`, `/settings`, `/lifecycle` | All 404 |
| **Bell icon / notifications** | Top bar | ABSENT — logout button in its place |

### High (impairs core workflow)

| Surface | Route | State |
|---------|-------|-------|
| **Subscriptions page** | `/subscription` | Stub — 0 plans, no upgrade path |
| **Dataroom "Manage Documents"** | `/dataroom-Duediligence` | "N/A" for all 42 slots; no per-investor controls |
| **"Share Report" button** | `/crm/share-round-toinvestor` | No visible feedback — broken |
| **Sector field display** | Left sidebar company card | Shows "YES" instead of sector string |
| **Investment Conversion Ratio** | Dashboard CRM widget | Hardcoded "20%" — not a real computation |
| **Investor admin area** | `/crm/investor-directory` | Label bug: "Investor Entry" vs. "Investor Directory"; 3-field form only |
| **No real-time sync** | Founder edits → investor view | No TanStack Query invalidation on live |
| **No company switcher** | Dashboard | Single-company only; no multi-company support |

### Medium (UX / data quality)

| Surface | Details |
|---------|---------|
| Logout button position | In top bar; should be profile dropdown |
| Browser tab title | "Login Page" on login; generic titles throughout |
| Flash "Name not available" | Dashboard greeting placeholder on load |
| CRM label mismatch | Nav: "Investor Directory"; page title: "Investor Entry" |
| Dark mode toggle | ABSENT on live (confirmed; rebuild stripped dark mode in Sprint 11) |
| No multi-language support | Not addressed in any sprint |
| No Google/SSO login | Auth0 supports it; not configured on live |

---

## APPENDIX A: SPRINT 11 ADMIN PRICING TIERS

From `server/adminPricingStore.ts` (5 tests, all passing):

| Tier ID | Label | Monthly Price (USD) |
|---------|-------|---------------------|
| `founder_free` | Founder Free | $0 |
| `founder_pro` | Founder Pro | $249 |
| `founder_scale` | Founder Scale | $749 |

Endpoint: `GET /api/admin/pricing-tiers` — consumed by founder Settings D10 "Plan & Pricing" tab and by Collective admin lifecycle policy.

---

## APPENDIX B: CAP-TABLE COMMIT STORE (HASH-CHAIN SCHEMA)

From `server/captableCommitStore.ts` (12 tests, all passing):

```typescript
// Hash-chained ledger entry fields (stable shape for verifyChain()):
{
  seq: number;
  ts: string;              // ISO 8601
  invitationId: string;
  roundId: string;
  companyId: string;
  investorId: string;
  amountUsd: number;
  shares: bigint;
  state: string;           // 'funded' → 'committed'
}
```

`verifyChain()` reconstructs SHA-256 over this exact field set to validate each entry against `priorHash`. Bug fix in Sprint 11: `fromState` field removed from both write and verify paths to ensure hash consistency.

---

## APPENDIX C: KNOWN DISCREPANCIES BETWEEN LIVE AND REBUILD

| Feature | Live `capavate.com` | Rebuild (Sprint 11) |
|---------|-------------------|---------------------|
| Admin routes | All 404 | 10 admin routes rendered |
| Bell icon | ABSENT | Spec-wired; D10 notification toggles shipped |
| Cap table page | No standalone page | `/founder/captable` with FD view, vesting Gantt, exports |
| Pricing page | Empty stub | 3 tiers from admin API; 7-tab Settings |
| Soft-circle form | Empty table; no form | Full Accept/Decline radio, amount, type, note, state machine |
| Notification system | None | 15 notification kinds, SSE, bell, preferences |
| Multi-company | Single-company only | CompanySwitcher, 3-company seed, per-company billing |
| Dark mode | ABSENT (confirmed) | Stripped (206 `dark:` classes removed in Sprint 11 Phase 1) |
| Collective toggle | Waitlist modal only | Full eligibility gate; lapsed renewal hides toggle |
| "View as investor" | Not observed on live | Sprint 8 D2 — iframe preview with live sync |
| E-signature | Absent | Not yet shipped; planned for Sprint 12 |
| Real-time sync | None | TanStack Query invalidation on PATCH |

*End of capavate_live_admin_audit.md*
