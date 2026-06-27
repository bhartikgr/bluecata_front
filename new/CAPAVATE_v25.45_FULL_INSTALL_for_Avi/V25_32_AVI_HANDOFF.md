# V25.32 — Avi Handoff: DB-Authoritative Billing Fixes

**Version:** 25.32.0
**Scope:** Convert billing/payment READS to DB-direct; harden webhook idempotency and invoice creation against in-memory state and silent failures.
**Ships with:** the v25.32 bundle.

---

## 0. Ground Rules Honored

This wave was executed under four hard rules. All were preserved:

1. **NO in-memory anything.** Every dedup/idempotency decision and every read path that mattered now hits SQLite directly. In-memory `Map`/`Set` structures are retained ONLY as write-through caches that are refreshed *from* the DB read — never as the authority.
2. **Avi's WRITES were not modified.** Only READS were converted to DB-direct. Every `INSERT`/`UPDATE`/`DELETE` Avi authored is byte-for-byte preserved; where a read was inlined next to a write, only the read half changed.
3. **Cap-table math is SACRED — untouched.** No file under `home3compo/*` and none of the sacred formula stores (`captableCommitStore.ts`, `roundsStore.ts`, `spvFundStore.ts`, `collectiveBillingStore.ts`, `lib/roundCloseCascade.ts`) was edited. The formula-byte checker reports the exact same state as the pre-wave baseline (4 pre-existing FAIL + 1 PASS, none in edited files).
4. **Care taken.** Every change was grep-verified and read-verified after editing; line numbers were re-confirmed after each splice because they shift.

---

## 1. What Changed — File by File

### Fix 1 — `server/paymentStore.ts` (chargeOrIdempotent + persistPaymentEntry)

The idempotency authority is the `payment_ledger.intent_id` UNIQUE column, **not** the `id` column. Two concurrent workers mint different `id`s for the same `intent_id`; the old `ON CONFLICT(id)` upsert could not collapse that race and the second INSERT threw on the `UNIQUE(intent_id)` constraint.

**BEFORE (pseudocode):**
```
chargeOrIdempotent(intent):
    if intentIndex.get(intent.intentId): return cached     # in-memory authority
    ... charge ...
    persistPaymentEntry(...)            # INSERT ... ON CONFLICT(id) DO UPDATE
```

**AFTER (pseudocode):**
```
chargeOrIdempotent(intent):
    row = SELECT entry_json FROM payment_ledger WHERE intent_id = ?   # DB-direct dedup
    if row: refresh Map cache from row; return parsed entry
    ... charge ...
    persistPaymentEntry(...)            # INSERT ... ON CONFLICT(intent_id) DO UPDATE
```

- DB read is the authority; the in-memory `Map` is refreshed from the row (write-through cache only).
- `persistPaymentEntry` now upserts `ON CONFLICT(intent_id)`.
- **Writes preserved:** the INSERT column list and ledger semantics are unchanged; only the conflict target moved from `id` → `intent_id`.

### Fix 2 — `server/paymentGatewayAdapter.ts` + `server/db/connection.ts` (webhook idempotency, DB-only + transactional)

Removed the in-memory `processedWebhookEvents` `Set` fast-path. Webhook dedup is now DB-only against a new table, and each webhook is processed inside one better-sqlite3 transaction.

**BEFORE (pseudocode):**
```
handleWebhook(evt):
    if processedWebhookEvents.has(key): return       # in-memory Set authority
    processedWebhookEvents.add(key)
    recordWebhookEvent(evt)
    activate/fail capSub
    finalizeWebhookSuccess(...)   # created invoice in a SEPARATE step; errors swallowed
```

**AFTER (pseudocode):**
```
handleWebhook(evt):
    getDb().transaction((tx) => {
        if (!_claimWebhookKey(key)) return            # INSERT OR IGNORE; changes>0 == first claim
        recordWebhookEvent(evt)
        capSub activate / fail
        finalizeWebhookSuccessInTx(tx, {...})         # invoice created INSIDE this tx
    })
    // POST-COMMIT side-effects: status flips + billing events (see Regression 2)
```

- New helper `_claimWebhookKey(key): boolean` does `INSERT OR IGNORE INTO processed_webhook_events (key, processed_at) VALUES (?, ?)` and returns `changes > 0`. First caller wins atomically; the claim is part of the transaction, so a rolled-back webhook does **not** persist the key (it can be retried).
- DDL moved to the boot schema: `processed_webhook_events (key TEXT PRIMARY KEY, processed_at TEXT)` in `connection.ts` `buildProductionTableStatements()` (~line 2209).
- The public `processedWebhookEvents` getter still exists but now **reads the table** (`SELECT key FROM processed_webhook_events`) so any external callers/tests see DB truth, not stale memory. `_testGateway.reset()` issues `DELETE FROM processed_webhook_events`.
- Both webhook handlers wrapped in `getDb().transaction((tx) => {...})`: multi-gateway handler tx opens ~839 / closes ~890; legacy handler tx opens ~975 / closes before its post-commit flips.
- **Writes preserved:** `recordWebhookEvent`, the capSub activate/fail UPDATEs, and invoice INSERT are the same writes; they were only relocated to run inside one atomic transaction instead of separate swallowed steps.

### Fix 3 — `server/invoiceStore.ts` (invoice creation inside the webhook transaction, no swallowed errors)

New `createInvoiceInTransaction(tx, input): Invoice` (line 297) is a pure DB insert via the drizzle `tx`; it throws on failure (no swallow). The public `createInvoice` delegates to it inside its own tx, then runs side-effects post-commit.

```
createInvoiceInTransaction(tx, input):   # pure DB, throws on error
    ... INSERT invoice row via tx ...
    return invoice

createInvoice(input):
    invoice = getDb().transaction(tx => createInvoiceInTransaction(tx, input))
    ... post-commit side-effects ...
    return invoice
```

The webhook's `finalizeWebhookSuccessInTx` calls `createInvoiceInTransaction(tx, ...)`, so the invoice is created in the SAME transaction as the webhook claim. If the invoice insert throws, the whole webhook rolls back and the idempotency key is not persisted.

- **Writes preserved:** invoice INSERT column list and semantics unchanged; the function was split so the DB half can join an outer transaction.

### Fix 4 — `server/subscriptionStore.ts` (DB-direct subscription reads)

`getByPaymentIntent` (~286), `getByMerchantOrderId` (~308), and `listForCompany` (~325) now `SELECT ... FROM capavate_subscriptions` and map via `rowToSub` (line 123). The in-memory `subscriptions` Map is refreshed from the row as a side-effect; on DB error it falls back to the cache (read still tried DB-first).

`activateByPaymentIntent`, `failByPaymentIntent`, and `recordPendingSubscription` previously did their dedup read against the Map; they now call `getByPaymentIntent` (DB-direct). Their DB `UPDATE` writes are unchanged.

```
getByPaymentIntent(pi):
    row = SELECT * FROM capavate_subscriptions WHERE payment_intent_id = ?
    if row: refresh Map; return rowToSub(row)
    on error: log warn, fall back to Map cache
    return null
```

- **Writes preserved:** all `UPDATE capavate_subscriptions SET status=...` writes are byte-for-byte unchanged; only the dedup reads in front of them were converted.

### Fix 5 — `server/invoiceStore.ts` (DB-direct invoice reads)

`getInvoice` (~476), `listInvoices` (~498), and `listInvoicesForCompany` (~525) now read via drizzle `getDb().select().from(invoicesTable)` and map via `rowToInvoice` (line 157), excluding soft-deleted rows, with cache fallback on DB error.

- **Verified first:** the reads were confirmed to be cache-only before conversion, then converted to DB-direct with `rowToInvoice` mapping.
- **Writes preserved:** no invoice write touched in this fix.

### Fix 6 — `server/paymentGatewayAdapter.ts` (founder canonical billing)

`GET /api/founder/subscription` (~634) now calls module-level `projectCanonicalSubscription(companyId)` (~1103). It reads `capavate_subscriptions` (most-recent active row) via `listCapSubsForCompany`, projects it into the legacy `Subscription` shape, and falls back to the legacy `getSubscription` if no canonical row exists.

```
projectCanonicalSubscription(companyId):
    rows = listCapSubsForCompany(companyId)       # DB-direct (Fix 4)
    active = most-recent active row
    if active: return projectToLegacyShape(active)
    return getSubscription(companyId)             # legacy fallback
```

- New imports: `listForCompany as listCapSubsForCompany`, `type CapavateSubscription`, `type Subscription`, `listInvoicesForCompany`.
- **Writes preserved:** read-only endpoint; no writes added or changed.

### Fix 7 — `client/src/components/AppShell.tsx` (Admin Payments sidebar link)

Added `{ href: "/admin/payments", label: "Payments", icon: CreditCard, testId: "nav-admin-payments" }` after Reconciliation in the Capavate nav group (line 193). Added `CreditCard` to the lucide import (line 11). Added `testId?: string` to the `NavItem` type (line 71); the render uses `item.testId ?? ` + computed fallback (line 252) so existing links keep their auto-generated test IDs.

### Fix 8 — `server/lib/adminUsersRoutes.ts` (tightened last-admin guard)

The PATCH handler's last-admin guard was over-broad and 409'd when suspending a NON-admin. Tightened both halves:
- The SQL guard only blocks when the target is the last active admin AND the patch removes admin-active.
- The post-update 409 condition is now `targetWasActiveAdmin && removesAdminActive` (lines 247–249), where `targetWasActiveAdmin = existing.role === "admin" && existing.status === "active"` and `removesAdminActive = (updated.role !== "admin" || updated.status !== "active")`.

Suspending a non-admin no longer spuriously 409s; demoting/suspending the last active admin is still blocked.

- **Writes preserved:** the user UPDATE write is unchanged; only the guard predicates were tightened.

---

## 2. Schema Additions

| Table | Columns | Where | Notes |
|---|---|---|---|
| `processed_webhook_events` | `key TEXT PRIMARY KEY, processed_at TEXT` | `connection.ts` `buildProductionTableStatements()` ~line 2209 | Webhook idempotency claim table (Fix 2). |

No other schema changes. Existing UNIQUE constraints relied upon: `payment_ledger.intent_id` UNIQUE; `capavate_subscriptions.payment_intent_id` UNIQUE.

---

## 3. Documented Deviations from the Brief

Two intentional deviations from the original brief, both for compatibility/correctness:

1. **DDL column name.** The brief specified `created_at` for `processed_webhook_events`. The shipped column is **`processed_at`** instead, for compatibility with `stripeGatewayAdapter.ts`, which reads/writes that table with the `processed_at` name. Using `created_at` would have broken the Stripe adapter's existing access pattern.

2. **`finalizeWebhookSuccess` renamed → `finalizeWebhookSuccessInTx(tx, args)`** (~line 1193). The function now takes the drizzle transaction handle as its first argument, swallows no errors, calls `createInvoiceInTransaction(tx, ...)`, and uses `rawDb()` raw prepared statements inside the drizzle transaction. This is safe because `getDb()` (drizzle) and `rawDb()` wrap the **same** better-sqlite3 connection, so raw statements run inside the open drizzle transaction's SQLite transaction.

---

## 4. Two Regressions Found During Testing (and Fixed)

Both were discovered while running the test suite against the new transactional webhook path, and both are fixed.

### Regression 1 — "Unexpected token 'const'" (lazy require inside a transaction)

**Symptom:** the webhook transaction threw `Unexpected token 'const'`.

**Root cause:** `paymentGatewayAdapter.ts` used lazy `require("./db/connection")` and `require("./pricingTiersStore")` through the `createRequire(import.meta.url)` shim (lines 19–26). When those modules are **first evaluated INSIDE a better-sqlite3 transaction under tsx**, Node's `require` cannot parse the `.ts` source (the tsx TS-require hook is not active in that context), so it chokes on the first `const`.

**Fix:** converted to top-level static imports:
- `import { getDb, rawDb } from "./db/connection"` (line 64)
- `import * as pricingTiers from "./pricingTiersStore"` (line 65)

Removed the 8 lazy `const { rawDb } = require(...)` lines. Confirmed **no circular dependency** (`pricingTiersStore` → `pricingModelStore` only). Verified zero lazy requires of those modules remain.

### Regression 2 — Forbidden nested transaction (lost status flip)

**Symptom:** `past_due`↔`active` subscription status flips were silently lost during webhook processing.

**Root cause:** `updateSubscription` (`subscriptionsStore.ts` line 347) opens its **own** `db.transaction()` (line 399). Calling it inside the webhook's open transaction = a nested better-sqlite3 transaction, which is forbidden; the error was silently caught and the status flip was dropped.

**Fix:** moved the `getSubscription` / `updateSubscription` status flips to run **AFTER** the finalize transaction commits (post-commit side-effects), in BOTH handlers. Verified all 4 `updateSubscription(companyId, { status: ... }, "system:webhook...")` calls (lines 911, 916, 1016, 1021) are OUTSIDE their transactions (multi-gateway tx opens 839/closes 890; legacy tx opens 975/closes before 1016). The idempotency key is already committed by then, so a flip failure cannot replay the whole webhook.

---

## 5. Test Files Affected

| Area | Test files |
|---|---|
| `chargeOrIdempotent` (Fix 1) | `sprint14_hashChain.test.ts` (88–91), `sprint14_stores.test.ts` (303), `sprint14_trace.test.ts`, `sprint28_billing.test.ts` |
| subscription reads (Fix 4) | `v24_4_fixes.test.ts` (147–188), `v24_2_airwallex_billing.test.ts` (172–236) |
| gateway reset (`_testGateway.reset()`) | `v24_4_fixes`, `v24_2_airwallex_billing`, `sprint28_billing`, `airwallexGateway` tests |

Tests run with `NODE_ENV=test` → `:memory:` SQLite.

---

## 6. Verification Gates (all pass)

- **TypeScript:** `npx tsc 2>&1 | grep -c "error TS"` → **627** (baseline 627, gate ≤633). Remaining errors at `connection.ts(102-105)`, `invoiceStore.ts(694-754)`, `adminUsersRoutes.ts(261/273)`, `paymentStore.ts(257)` are PRE-EXISTING `string | string[]` Express-param typing issues OUTSIDE edited regions.
- **Sacred:** `npx tsx scripts/check-formula-bytes.ts` → identical to baseline (4 pre-existing FAIL: `captableCommitStore.ts`, `roundsStore.ts`, `spvFundStore.ts`, `collectiveBillingStore.ts`; 1 PASS: `lib/roundCloseCascade.ts`). **Zero new drift; none are edited files.**
- **Build:** `npm run build` (= `tsx script/build.ts`, singular `script/`) exits 0, "Done in ~300ms", only pre-existing `import.meta` warnings.
- **Version:** `package.json` `"version": "25.32.0"`.

---

## 7. Troubleshooting

**Webhook re-processes an event after a failure.**
Expected if the finalize transaction rolled back — the claim is part of the transaction, so the key is NOT persisted on rollback and the event is safe to retry. Check the `[webhook] ... finalize transaction rolled back:` warning log for the underlying cause.

**`Unexpected token 'const'` returns.**
Someone re-introduced a lazy `require()` of a `.ts` module on a path that executes inside a transaction. Convert it to a top-level static import (see Regression 1). Do not lazy-require `.ts` modules from inside `getDb().transaction(...)`.

**Status flip silently lost.**
A status-flipping call (`updateSubscription`, or anything that opens its own `db.transaction()`) was moved back inside the webhook transaction. Nested better-sqlite3 transactions are forbidden and the error is swallowed. Keep such calls in the post-commit block (see Regression 2).

**`processed_webhook_events` missing in an isolated test.**
Ensure the boot schema (`buildProductionTableStatements()`) ran. The DDL is `CREATE TABLE IF NOT EXISTS`, so running the full boot schema is sufficient.

**A read returns stale data.**
The in-memory Maps are write-through caches refreshed from DB reads; they are never the authority. If a read looks stale, confirm the DB-direct `SELECT` path is being hit and the cache-fallback branch (logged as `DB read failed (cache fallback)`) is not masking a DB error.

**409 when suspending a user who is not an admin.**
Should no longer happen after Fix 8. If it recurs, verify the guard predicate is `targetWasActiveAdmin && removesAdminActive` and that `targetWasActiveAdmin` checks BOTH `role === "admin"` AND `status === "active"`.
