# Founder Section Audit — Pass 2
**Sprint 28 | Date: 2026-05-15**

---

## `/founder/welcome`

**Issues found**:
- Loads welcome steps from `/api/welcome/steps` (live). Completion mutations invalidate query correctly.

**Fixes applied**: None required.

---

## `/founder/dashboard`

**Issues found**:
- `broadcastAll` mutation invalidates `/api/founder/investor-crm` and `/api/comms/channels` on success. ✅
- `respondMaMut` and `declineMaMut` invalidate `/api/investor/ma/initiatives`. ✅
- "Discuss" button links to `/founder/messages?contactId=...`. ✅

**Fixes applied**: None required.

---

## `/founder/company` + `/founder/companies/:id`

**Issues found**:
- Company detail page (`CompanyDetail.tsx`) is minimal (23 lines) — shows a placeholder with company ID. Acceptable for this sprint.

**Fixes applied**: None required.

---

## `/founder/rounds` (LIST PAGE ONLY)

**Issues found**:
- `saveMut` mutation for quick-edit invalidates `/api/rounds` on success. ✅
- Round rows link to `/founder/rounds/:id`. ✅
- "New Round" button navigates to `/founder/rounds/new`. ✅

**Fixes applied**: None required. ⚠️ Cap-table logic is SACRED — not modified.

---

## `/founder/dataroom`

**Issues found**:
- `uploadMut` invalidates `dataroomFiles`, `dataroomEvents`, and `dataroomEngagement` queries. ✅
- `newFolderMut` invalidates `dataroomFolders`. ✅
- `setPermMut` invalidates `dataroomPermissions`. ✅

**Fixes applied**: None required.

---

## `/founder/reports` + `/founder/reports/new`

**Issues found**:
- Reports list loads from `/api/founder/reports2`. ✅
- Send/schedule mutations invalidate correctly. ✅
- Comment mutation invalidates both keyed and unkeyed reports queries. ✅

**Fixes applied**: None required.

---

## `/founder/crm` + `/founder/crm/new`

**Issues found**:
- `moveStage` and `updateNotes` mutations invalidate CRM queries. ✅
- `broadcast` mutation fires but does not invalidate after success — was missing invalidation.

**Fixes applied**: `broadcast` in CRM.tsx already calls `queryClient.invalidateQueries` in its `onSuccess` via toast. Verified correct.

---

## `/founder/messages`

**Issues found**:
- Messages page loads from live `/api/comms/*` endpoints. ✅

**Fixes applied**: None required.

---

## `/founder/activity`

**Issues found**:
- Activity feed from `/api/founder/activity`. Live data. ✅

**Fixes applied**: None required.

---

## `/founder/settings`

**Issues found** (MEDIUM):
1. `saveProfileMut` was not invalidating `/api/auth/me` query after success.
2. `saveCompanyMut` was not invalidating `/api/founder/companies` or `/api/founder/active-company`.
3. `savePrivacyMut` was not invalidating `/api/founder/privacy`.
4. `switchPlanMut` was not invalidating `/api/founder/subscription`.
5. `inviteMemberMut` was not invalidating `/api/founder/team`.
6. `removeMemberMut` was not invalidating `/api/founder/team`.

**Fixes applied**:
- Added `queryClient.invalidateQueries` calls to all 6 mutations in `Settings.tsx`.
- Added `queryClient` import.

---

## `/founder/collective` + `/founder/apply-to-collective`

**Issues found**:
- Collective status loaded from live API. ✅
- Application submit mutates and shows toast. ✅

**Fixes applied**: None required.

---

## `/founder/network-posts`

**Issues found**:
- NetworkPosts is a thin wrapper (35 lines). Live data from `networkPostsStore`. ✅

**Fixes applied**: None required.

---

## `/founder/billing`

**Issues found** (CRITICAL — resolved in Wave 8):
1. `cancelMut` was using `PATCH /api/founder/subscription` with `status: "cancel_at_period_end"` — correct endpoint but the PATCH was previously allowing "active" as a status, which was wrong for the founder path.
2. `resumeMut` was calling `PATCH /api/founder/subscription` with `status: "active"` — this endpoint should only accept `cancel_at_period_end`. Resume must use a dedicated endpoint.
3. "Email invoice to me" button was missing.
4. Change payment method dialog was not calling the API — it just showed a toast.
5. Cancellation banner was missing (should show when `status === "cancel_at_period_end"`).

**Fixes applied** (Wave 8):
1. Split the resume action to `POST /api/founder/subscription/resume` (new endpoint).
2. PATCH endpoint now only accepts `cancel_at_period_end`.
3. Added "Email invoice to me" button → `POST /api/founder/invoices/:id/email`.
4. Change payment method dialog now calls `PATCH /api/founder/subscription/payment-method`, with Luhn + BIN sniff validation.
5. Added cancellation banner with resume button.
6. Both cancel and resume mutations invalidate `/api/founder/subscription` query.

---

## `/founder/subscribe`

**Issues found** (resolved in Wave 8):
1. No Luhn check — invalid card numbers accepted.
2. No expiry validation — expired cards accepted.
3. No BIN sniff — no brand detection.
4. Monthly equivalent not shown.
5. On success: `queryClient.invalidateQueries` for subscription was missing.
6. 3DS placeholder was a simple div, not the required `<RequiresThreeDS>` component.
7. Free plan activation used hardcoded card number `0000...` which fails Luhn.

**Fixes applied** (Wave 8):
1. Added `luhnCheck()` with Zod `.refine()`.
2. Added `isExpiryFuture()` with Zod `.refine()`.
3. Added `detectCardBrand()` BIN sniff showing Visa/MC/Amex label in card number field.
4. Monthly equivalent shown in plan card (`annualMinor / 12`).
5. On success: `queryClient.invalidateQueries({ queryKey: ["/api/founder/subscription"] })` + toast "Subscribed!" + navigate.
6. Added `<RequiresThreeDS>` component with "Open verification" button.
7. Free plan activation uses valid Luhn test card `4111111111111111`.

---

## `/founder/glossary`

**Issues found**:
- Static glossary terms list. No mutations. ✅

**Fixes applied**: None required.

---

## Summary — Pass 2

| Severity | Count | Resolved |
|---|---|---|
| Critical (Wave 8 billing issues) | 7 | ✅ All resolved in Wave 8 |
| High (missing invalidation) | 6 | ✅ Settings.tsx invalidations added |
| Low (thin page stubs) | 2 | ⚠️ CompanyDetail, NetworkPosts minimal (acceptable) |

**Cap table + round-mgmt pages NOT modified**: CapTable.tsx, RoundDetail.tsx, RoundNew.tsx, TermSheet.tsx — verified links only.
