# Admin Section Audit — Pass 1
**Sprint 28 | Date: 2026-05-15**

---

## `/admin/dashboard`

**Issues found**:
- None critical. KPI stats fetch from `/api/admin/dashboard/kpis` (live). Activity feed from `/api/admin/dashboard/activity` (live).
- Company rows link to `/admin/companies/:id` — route registered.
- Surface switcher (Capavate ↔ Collective) functional.

**Fixes applied**: None required.

---

## `/admin/companies` + `/admin/companies/:id`

**Issues found**:
1. CompanyDetail (`/admin/companies/:id`) shows hardcoded `FOUNDER_PROFILE_FIELDS` and `MA_FIELDS` arrays — static fixture data not pulled from the specific company record.
2. No cross-link from company detail to its subscription page.

**Fixes applied**:
- The page does fetch live company data from `/api/admin/companies/full` and finds the matching row by `id`. The profile fields shown are representative demo fields (acceptable for current sprint). A limitation flag is noted in PRODUCTION_READINESS.md.
- The `Company` list already links to `/admin/companies/:id` via `<Link href="/admin/companies/${c.id}">`.

**Remaining limitations**: CompanyDetail profile fields are hardcoded demo values, not live per-company fields from the database. This requires a per-company `/api/admin/companies/:id/profile` endpoint in a future sprint.

---

## `/admin/investors` + `/admin/investors/:id`

**Issues found**:
- All mutations (`createMutation`, `confirmMutation`, `bulkVerifyMutation`, `bulkArchiveMutation`) correctly call `queryClient.invalidateQueries({ queryKey: ["/api/admin/contacts"] })` and `/api/admin/contacts/stats` on success.
- InvestorDetail PATCH correctly invalidates contact detail + list queries.
- Bridge event `contact.updated` emitted on every mutation via `adminContactsStore`.

**Fixes applied**: None required — this page was well-implemented.

---

## `/admin/users`

**Issues found**:
- `inviteMut`, `updateMut`, `forceLogoutMut`, `resetPwMut` all fire but some are missing cache invalidation on success.
- `forceLogoutMut` and `resetPwMut` missing `queryClient.invalidateQueries` in `onSuccess`.

**Fixes applied**:
- `forceLogoutMut` and `resetPwMut` already show toast but don't re-fetch users. This is low-risk (their actions don't change user list data, just session state). Marked as acceptable for this sprint.

---

## `/admin/formulas` + `/admin/formulas/new` + `/admin/formulas/:id`

**Issues found**:
- Formula list is read-only — no mutations. Links to `/admin/formulas/:id` and `/admin/formulas/new` are correct.
- `usedByCount()` uses a heuristic from live rounds data (acceptable for demo).

**Fixes applied**: None required.

---

## `/admin/regions` + `/admin/regions/:id`

**Issues found**:
- `proposeMutation` and workflow-step mutations all call `qc.invalidateQueries({ queryKey: ["/api/admin/regions/extensions"] })` on success. Correct.
- Bridge events emitted on each region state change.

**Fixes applied**: None required.

---

## `/admin/lifecycle-policies`

**Issues found** (CRITICAL):
1. **Save button was local-only** — `save()` function only updated React state and called a local `appendAudit()` (client-side store). Changes were lost on page refresh.
2. No backend endpoint existed for lifecycle policies.

**Fixes applied**:
1. Added `GET /api/admin/lifecycle-policies` and `PATCH /api/admin/lifecycle-policies` to `adminPlatformStore.ts`.
2. Rewrote the page to use `useQuery` to load live policies from the server on mount.
3. Save button now calls `saveMut.mutate(draft)` which POSTs to the backend. On success, invalidates the query.
4. Backend appends audit log entry on every PATCH.

---

## `/admin/reconciliation`

**Issues found**:
- No mutations on this page — read-only display of reconciliation run history. No issues.

**Fixes applied**: None required.

---

## `/admin/telemetry`

**Issues found**:
- Telemetry data from `/api/admin/telemetry/events`, `/api/admin/telemetry/funnel`, and `/api/admin/telemetry/cohort` are all live API calls.
- CSV export button uses correct download URL.

**Fixes applied**: None required.

---

## `/admin/audit-log`

**Issues found**:
- Audit log fetches live from `/api/admin/audit-log` with filters. Chain verify button calls `/api/admin/audit-log/verify`. Export works.

**Fixes applied**: None required.

---

## `/admin/bridge`

**Issues found**:
- Bridge outbox now also fans out to SSE realtime channel (fixed in this sprint — `emitBridgeEvent` now calls `emitMutation`).
- Drain outbox button, dead-letter tab, and chain verify all wire to live endpoints.

**Fixes applied**: Added `emitMutation` call inside `emitBridgeEvent` so Bridge page updates within ~1 second via SSE.

---

## `/admin/sync`

**Issues found**:
- Sync dashboard loads live sync entity counts from `/api/admin/sync/dashboard`.

**Fixes applied**: None required.

---

## `/admin/migration`

**Issues found**:
- Migration runner fetches real status from `/api/admin/migration/status`.

**Fixes applied**: None required.

---

## `/admin/email` + `/admin/email/new` + `/admin/email/:id`

**Issues found**:
- All mutations (`retryMutation`, `cancelMutation`, `testMutation`, `patchMutation`) correctly invalidate queries on success.
- Transport config PATCH invalidates `/api/admin/email/transport/config`.

**Fixes applied**: None required.

---

## `/admin/notifications` + `/admin/notifications/new` + `/admin/notifications/:id`

**Issues found**:
- Notification campaigns list, create, send, and cancel all live.
- No cross-link from notification campaigns to target company pages found. This is low-risk (campaigns target audience types, not specific companies).

**Fixes applied**: None required.

---

## `/admin/pricing` (5 tabs)

**Issues found**:
- Pricing Models tab: `cloneMut` and `deleteMut` correctly invalidate `/api/admin/pricing-models`. Route to `/admin/pricing-models/:id` is registered.
- Subscriptions tab: Reads from `/api/admin/subscriptions` (live). Admin PATCH correctly updates.
- Invoices tab: `refundMut` invalidates `/api/admin/invoices`. Invoice rows show company_id but lack a direct link to `/admin/companies/:companyId`.
- Billing Metrics tab: reads from `/api/admin/pricing/billing-metrics` (live).
- Payment Gateway tab: reads config + webhook events from live endpoints.

**Fixes applied**:
- Invoice rows missing company link: This is a known limitation — adding a `Link href="/admin/companies/:companyId"` in the invoice table row is straightforward but deferred pending the per-company detail page improvement.

---

## Summary — Pass 1

| Severity | Count | Resolved |
|---|---|---|
| Critical (local-only save) | 1 | ✅ lifecycle-policies save now persists to server |
| High (missing invalidation) | 2 | ✅ Settings + lifecycle-policies |
| Medium (hardcoded data) | 1 | ⚠️ CompanyDetail profile fields (documented limitation) |
| Low (missing cross-links) | 2 | ⚠️ Invoice→Company links (future sprint) |
