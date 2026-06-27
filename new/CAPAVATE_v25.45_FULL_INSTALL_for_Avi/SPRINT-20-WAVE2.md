# Sprint 20 Wave 2 — Progress Log

**Date:** 2026-05-10  
**Sprint:** 20 (Wave 2)  
**Version:** v0.20.0  
**Math integrity:** 73/73 ✓  
**Tests before:** 906 passing  
**Tests after:** 923 passing (+17 new, 0 regressions)

---

## Summary

Wave 2 completed all investor UX defects from SPRINT-20-AUDIT.md. Work was split across two agent turns due to compaction; this log covers the full Wave 2 scope.

---

## Tasks Completed

### A. AppShell ✅ (Wave 2 carryover from Wave 1)
- Fixed badge field mapping
- Settings routing: `/investor/settings`
- Glossary routing: `/investor/glossary`
- Avatar initials derived from user name
- Version string bumped to v0.20.0

### B. Dashboard ✅
- Guarded all queries with `enabled: !!userId`
- Added empty-state cards for zero-data views
- Wired `useRealtimeSync()` for live SSE subscriptions

### C. Invitations ✅
- Removed `COMPANY_BLURBS` hardcoded constant
- Added tab filter (Pending / Accepted / Declined)
- Fixed skeleton loading width inconsistency
- Pro-rata badge: shows correct ownership threshold

### D. Portfolio ✅
- Pro-rata math corrected: `proRataCheckUsd = (ownershipPct/100) × newRoundM × 1_000_000`
- Removed `Math.sin` walk simulation from ownership chart
- Added `useRealtimeSync()` for live portfolio sync
- Anti-dilution broad-based weighted average formula: `CP_new = CP_old × (CSO + CCP) / (CSO + NCM / CP_old)`
- Tax endpoint stub wired: GET `/api/investor/portfolio/tax` → `{available:false, message:"Tax exports open Q1 2027"}`
- Portfolio marks endpoint: GET `/api/investor/portfolio/:id/marks` → `{holdingId, marks:[]}`

### E. CompanyDetail ✅
- Tab routing via `useSearch()` (hash query string — hash router compatible)
- Co-members: fetched from `/api/investor/companies/:id/co-members` with 404 fallback to `[]`
- DM button: `POST /api/comms/dm/start` with `{recipientId: founderId}` mutation
- Team tab: rendered from `company.data.team[]` with "Team info not available" fallback
- Financials tab: rendered from `company.data.financials/kpi` with "Founder has not published financial KPIs yet" fallback
- Doc view: `window.open(url, "_blank")` handler
- Doc download: anchor tag with `download` attribute
- Entitlement gate: `<RequireEntitlement check={{kind:"investor.onCapTableOf", companyId:id}}>` wraps DM CTA

### F. CompanyDetails (shared) ✅
- Dataroom button: investor → `/investor/companies/:id?tab=dataroom`, founder → `/founder/dataroom`
- Termsheet button: investor → `/investor/companies/:id?tab=your-decision`, founder → `/founder/rounds/:roundId/termsheet`
- Removed hardcoded `coMembers` array

### G. CRM ✅
- Added `useRealtimeSync()` for live SSE sync
- Removed `window.confirm()` (replaced with direct delete mutation)
- Fixed query URL comment (was pointing to wrong path)

### H. Collective ✅
- "Open Collective" CTA: `window.open("https://capavate.com/collective/","_blank")`
- "What's inside" accordion: toggles `insideOpen` state
- Eligibility: derived from `useEntitlement()` live data
- Active deals: fetched from `/api/collective/network` with fallback
- Split into `Collective()` (entitlement shell) + `CollectiveInner()` (content)

### I. ApplyToCollective ✅
- Active member redirect: checks `elig.data?.collectiveStatus === "active"` on mount → navigate to `/investor/collective`
- KYC upload: `FormData` POST to `/api/collective/kyc-upload` (multipart/form-data, `file` field)
- Added AU (Australia), IN (India), JP (Japan) jurisdiction text to `JURISDICTION_TEXT_EXTRA`
- `ACCREDITATION_JURISDICTIONS` in `shared/schema.ts` extended: `["US","CA","UK","EU","SG","HK","AU","IN","JP"]`

### J. Comms ✅
- `MessagesWidget` title: investor → "Messages from founders", founder → "Messages from cap-table members"
- Thread navigation: removed duplicate `?channel=` query param
- "View All Messages": changed target to `?sort=recent`
- `PostsFeed`: removed hardcoded `companyId:"co_novapay"`
- `cap_table` visibility option: visible for investors with cap table positions (`hasCapTable(ctx)`)
- Mute author: `POST /api/comms/posts/:id/mute-author` mutation wired
- Report: `POST /api/comms/posts/:id/report` mutation wired
- `PostCard` accepts `onMuteAuthor`/`onReport` props with `data-testid` attributes

### K. NotificationBell ✅
- "View all notifications" route: investor → `/investor/notifications`, founder → `/founder/notifications`, else → `/notifications`

### L. CollectiveDeepLink + CapCollectiveToggle ✅
- `CollectiveDeepLink`: `useRole` imported; `/api/founder/sync/status` query only `enabled` for founders
- `CapCollectiveToggle` badge: `"CAP + COLLECTIVE"` for `ON_CAP_TABLE_COLLECTIVE_ACTIVE`, `"CAP TABLE"` for `ON_CAP_TABLE`, `"CAPAVATE"` otherwise

### M. NetworkPosts ✅
- Topic filter chips: All / #dealflow / #portfolio / #announcement / #question / #thesis
- Author filter dropdown: all / founders / investors / collective
- Page header added

### N. New Routes ✅
- `/investor/settings` → `InvestorSettings` — 5-section settings page (Profile, Notifications, Privacy, Billing, Accreditation)
- `/investor/glossary` → `InvestorGlossary` — Investor-specific glossary (Cap Table, Rounds, Valuation, Legal, M&A, Governance categories), reuses `ENTRIES` from `@/components/Glossary`
- `/investor/notifications` → `InvestorNotifications` — Full notifications page: kind filter chips, unread badge, mark-all-read, fetches from `/api/notifications`
- All 3 routes wired in `App.tsx` Switch block

### O. Server — New Stores & Endpoints ✅

#### `server/investorCrmStore.ts` (NEW)
- `GET /api/investor/crm/contacts` — list contacts (filtered by x-user-id)
- `POST /api/investor/crm/contacts` — create contact (returns 201)
- `PATCH /api/investor/crm/contacts/:id` — update fields (404 for unknown)
- `DELETE /api/investor/crm/contacts/:id` — remove contact
- `POST /api/investor/crm/contacts/:id/notes` — append note entry
- `POST /api/investor/crm/contacts/:id/tasks` — add task
- `PATCH /api/investor/crm/contacts/:id/tasks/:taskId` — update task status

#### `server/collectiveNetworkStore.ts` (NEW)
- `GET /api/collective/network` → `{activeDeals:[], eligibilityChecks:[]}`
- `GET /api/investor/companies/:id/co-members` → `[]`
- Seeded with 3 sample active deals and 4 eligibility criteria

#### `server/sprint20Wave2Routes.ts` (NEW)
- Orchestrates all new stores via `registerSprint20Wave2Routes(app)`
- `GET /api/investor/portfolio/:id/marks` → `{holdingId, marks:[]}`
- `GET /api/investor/portfolio/tax` → `{available:false, message:"Tax exports open Q1 2027"}`
- `POST /api/collective/kyc-upload` — multer multipart; accepts PDF/JPG/PNG ≤20 MB → `{ok:true, url:"/uploads/<hash>.ext"}`; 400 if no file
- `POST /api/comms/dm/start` — deterministic channelId from sorted user IDs → idempotent
- `POST /api/comms/posts/:id/mute-author` — in-memory mute store
- `POST /api/comms/posts/:id/report` — in-memory report store

### P. Tests ✅

**`server/__tests__/sprint20_ux.test.ts`** — 17 new tests

| Suite | Tests |
|---|---|
| Investor CRM CRUD | 5 |
| Collective network | 2 |
| Portfolio stubs | 2 |
| KYC upload | 1 |
| DM start | 3 |
| Mute author | 2 |
| Report post | 2 |

All 17 pass. No regressions in the existing 906-test suite.

### Q. Sprint Banner ✅
- Updated to v0.20.0 / Sprint 20 Wave 2 (completed in Wave 2 session 1)

### R. Progress Log ✅
- This file

---

## Files Modified (Wave 2)

### Client
| File | Change |
|---|---|
| `client/src/App.tsx` | Added imports + Route entries for Settings, Glossary, Notifications |
| `client/src/pages/investor/CompanyDetail.tsx` | Full rewrite — co-members API, DM mutation, team/financials tabs, doc handlers, entitlement gate |
| `client/src/pages/CompanyDetails.tsx` | Role-based dataroom/termsheet routing, removed hardcoded co-members |
| `client/src/pages/investor/CRM.tsx` | SSE sync, removed confirm() |
| `client/src/pages/investor/Collective.tsx` | Full rewrite — real URL CTA, accordion, live data |
| `client/src/pages/investor/ApplyToCollective.tsx` | Active member redirect, KYC upload, AU/IN/JP jurisdictions |
| `client/src/components/comms/MessagesWidget.tsx` | Role title, thread param, sort=recent |
| `client/src/components/comms/PostsFeed.tsx` | Removed hardcoded companyId, mute/report wired |
| `client/src/components/NotificationBell.tsx` | Role-based route |
| `client/src/components/CollectiveDeepLink.tsx` | Skip founder query for non-founders |
| `client/src/components/CapCollectiveToggle.tsx` | Distinct badge values |
| `client/src/pages/investor/NetworkPosts.tsx` | Topic + author filters |
| `shared/schema.ts` | Added AU, IN, JP to ACCREDITATION_JURISDICTIONS |

### Client (New Files)
| File | Purpose |
|---|---|
| `client/src/pages/investor/Settings.tsx` | Investor settings stub (5 sections) |
| `client/src/pages/investor/Glossary.tsx` | Investor glossary (investor-relevant categories) |
| `client/src/pages/investor/Notifications.tsx` | Notifications page with kind filter + mark-all-read |

### Server (New Files)
| File | Purpose |
|---|---|
| `server/investorCrmStore.ts` | Investor CRM CRUD endpoints |
| `server/collectiveNetworkStore.ts` | Collective network + co-members endpoints |
| `server/sprint20Wave2Routes.ts` | Portfolio marks, tax, KYC upload, DM start, mute, report |
| `server/__tests__/sprint20_ux.test.ts` | 17 new endpoint tests |

---

## Constraints Respected

- ✅ Wave 1 boundary files untouched (routes.ts, authRoutes.ts, userContext.ts, etc.)
- ✅ No `window.prompt/alert/confirm` — confirm() in CRM replaced with direct mutate
- ✅ No `localStorage/sessionStorage` outside JSDoc
- ✅ All client→server calls via `apiRequest()`
- ✅ Math integrity 73/73 maintained
- ✅ Build passing (TypeScript + Vite)
- ✅ 906 existing tests unbroken
- ✅ `ACCREDITATION_JURISDICTIONS` now has 9 entries (US, CA, UK, EU, SG, HK, AU, IN, JP)
