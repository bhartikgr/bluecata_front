# Harvest: Capavate Rebuild Proven Patterns
## Reference Document for Sprint 14 Build Subagent
**Version:** 1.0 — Sprint 14 Input  
**Date:** 2026-05-14  
**Sources:** SPRINT-6 through SPRINT-13 summaries, capavate_gating_addendum.md, capavate_collective_sync_schema.md, capavate_master_build_spec.md, commsStore.ts, bridgeRuntime.ts, CRM.tsx (founder + investor), visibility.ts  
**Core thesis:** Capavate's primary value is unlocking cap-table value for founders to identify and scale toward a transaction. CRM and communication channels are the LIFE of the platform.

---

## §1. TRACING PATTERN — Telemetry §9 Envelope

### 1.1 Canonical Outbox Event Payload (from capavate_collective_sync_schema.md §9)

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

### 1.2 TypeScript Interface (trace[] entry)

```typescript
interface FormulaTraceEntry {
  formulaId: string;   // e.g., "ca-default-v1", "us-delaware-v1"
  version: string;     // semver "1.0.0"
  region: string;      // one of: US | CA | UK | EU | SG | HK | CN | IN | JP | AU
  defHash: string;     // SHA-256 of formula definition at publish time
}

interface AuditChain {
  priorHash: string;   // SHA-256 of prior audit_log row canonical body
  hash: string;        // SHA-256 of this row canonical body
}

interface TelemetryEnvelope {
  eventId: string;              // CUID2 — used as Idempotency-Key
  eventType: OutboundEventType; // see §13.2
  aggregateId: string;          // company ID, investor ID, etc.
  aggregateKind: "company" | "investor" | "round" | "spv" | "document";
  occurredAt: string;           // ISO-8601
  tenantId: string;             // e.g., "tnt_capavate_us"
  actor: { userId: string; ip: string };
  payload: Record<string, unknown>;  // event-specific
  trace: FormulaTraceEntry[];        // populated for cap_table events; [] otherwise
  auditChain: AuditChain;
  schemaVersion: "1.0";
}
```

### 1.3 Where Tracing Is Already Wired

| Surface | Wired | Notes |
|---------|-------|-------|
| Cap-table mutations | ✅ | `trace[]` populated with formulaId + defHash per engine call |
| Profile PATCH endpoints | ✅ | `commsStore.ts` + `profileStore.ts` — outbox + audit chain |
| Comms events | ✅ | 21 event types in `packages/telemetry/src/events.ts` |
| Bridge outbound | ✅ | `bridgeStore.ts` — 12 outbound event types |
| Bridge inbound | ✅ | `bridgeInbound.ts` — 4 inbound event types |
| Round decision | ✅ | `yourDecisionStore.ts` — soft-circle + state transitions |
| CRM events | ✅ | `crmStore.ts` — `crm_contact_added`, `crm_note_added`, etc. |
| M&A initiative | ✅ | `maIntelligenceStore.ts` — `ma_initiative_started` |

### 1.4 Where Tracing Needs Extending (Platform-Wide Gaps)

- **Transaction prep channel** (Sprint 14 new channel kind): needs `transaction_prep_channel.created`, `checklist_item.marked_done`
- **Intro request workflow**: needs `crm_intro_requested`, `crm_intro_accepted`, `crm_intro_declined`
- **Cap-table milestone broadcast**: needs `cap_table_broadcast.sent`, `cap_table_broadcast.read`
- **DSC feedback relay to founder**: needs `dsc_feedback.relayed`, `founder_dsc_summary.viewed`
- **Collective member status update in founder CRM**: needs `collective_member_status.synced`

---

## §2. HASH-CHAIN PATTERN

### 2.1 Audit Log Schema (from collective_admin_audit.md §9.1)

```sql
CREATE TABLE audit_log (
  id              TEXT PRIMARY KEY,        -- CUID2
  tenant_id       TEXT NOT NULL,           -- 'platform' for Collective-level
  aggregate_id    TEXT NOT NULL,           -- company or user ID
  aggregate_kind  TEXT NOT NULL,           -- 'company' | 'user' | 'round' | etc.
  event_kind      TEXT NOT NULL,           -- e.g., 'cap_table.mutated'
  actor_id        TEXT NOT NULL,           -- user UUID (pseudonymised on erasure)
  actor_ip        TEXT,
  actor_user_agent TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL,
  payload         JSONB NOT NULL,
  formula_trace   JSONB,                  -- [{formulaId, version, region, defHash}]
  prior_hash      TEXT NOT NULL,           -- SHA-256 of prior row canonical body
  this_row_hash   TEXT NOT NULL            -- SHA-256 of this row content (HMAC-SHA256)
);
-- DB-level append-only enforced:
REVOKE UPDATE, DELETE ON audit_log FROM capavate_app;
```

### 2.2 Chain Construction (SHA-256 of canonical body)

```typescript
// Canonical body = JSON.stringify of selected fields in deterministic order
function canonicalBody(entry: AuditEntry): string {
  return JSON.stringify({
    id: entry.id,
    tenantId: entry.tenantId,
    aggregateId: entry.aggregateId,
    aggregateKind: entry.aggregateKind,
    eventKind: entry.eventKind,
    actorId: entry.actorId,
    occurredAt: entry.occurredAt,
    payload: entry.payload,
    priorHash: entry.priorHash,
  });
}

function hashRow(canonicalBody: string): string {
  return createHash("sha256").update(canonicalBody).digest("hex");
}
```

**Chain start:** `priorHash = "0".repeat(64)` for the first entry in a chain.

### 2.3 Chain-Verify Endpoint

- **Route:** `GET /admin/audit/verify-chain` (or surfaced in `/admin/audit-log` UI)
- **UI:** Each entry shows "prior hash → current hash" linked visualization
- **Broken link display:** Highlighted in red
- **Cross-system link:** Collective carries both Capavate `auditHash` + Collective-side hash for cross-system reconciliation
- **Export:** `GET /api/audit/{company_id}/export` — JSON with full audit log + verification checksum

### 2.4 Tamper-Evident Dead-Letter Queue

- Failed outbox events surface in `/admin/audit-log` with retry/dismiss UI
- Dead-letter count shown in admin dashboard macro KPIs

---

## §3. DUAL-ENGINE RECONCILE PATTERN

### 3.1 Architecture

Every cap-table commit runs through TWO engines in parallel:
1. `@capavate/cap-table-engine` — primary engine (production)
2. `@capavate/cap-table-engine-ref` — reference engine (mathematical ground truth)

**Reconcile gate:** If the two engines produce different results, the commit is **blocked** and an error is returned. The divergence is logged to the audit chain.

```typescript
// Pseudo-code for the reconcile gate
const primary = capTableEngine.compute(transaction);
const reference = capTableEngineRef.compute(transaction);

if (!deepEqual(primary, reference)) {
  throw new ReconcileError({
    primaryResult: primary,
    referenceResult: reference,
    divergedFields: diff(primary, reference),
  });
}
// Only reach here if both agree
commitToLedger(primary);
emitTelemetry("cap_table.mutated", primary);
```

### 3.2 Math Functions Currently Paired (from SPRINT-12-PROGRESS.md)

53 math-critical tests pass via `scripts/check-math-integrity.sh` across 17 files:
- Golden-master tests
- Property-based tests (fast-check)
- Ledger integrity tests
- Reconcile gate tests
- CaptableCommit pipeline tests

**Where the reconcile display is surfaced for founders:**
- Sprint 11 D12 `CommitPipeline`: "Cap-table-engine vs ref reconciliation display" — shows both engine results side-by-side at the `signed → funded → COMMIT` step

### 3.3 Failure Path

If reconcile fails:
1. Commit is rejected → error surfaced in the commit pipeline UI
2. Compliance hold banner shown
3. `compliance.hold_placed` notification fires to Founder + Admin
4. Admin can review via `/admin/audit-log` — `reconcile.failed` event

---

## §4. GLOBAL INVESTOR-GRADE MATH PRIMITIVES

### 4.1 Share Arithmetic — BigInt

All share counts use `BigInt` to avoid floating-point precision loss:
```typescript
type ShareCount = bigint;
const shares: ShareCount = 1_000_000n;
```

### 4.2 Price/Value Arithmetic — decimal.js (38-digit)

All prices, valuations, and amounts use `decimal.js` for 38-digit precision:
```typescript
import Decimal from "decimal.js";
Decimal.set({ precision: 38 });

const price = new Decimal("0.0001");         // 4 decimal places displayed
const valuation = new Decimal("50000000");
const ownership = shares.div(fullyDiluted);  // exact ratio
```

**Display rule:** Current share price shown to 4 decimal places; all other amounts 2 decimal places.

### 4.3 9-Region Formula Registry

All 9 regions have first-class formula support:
```
US — Delaware C-Corp + CCPC hybrid
CA — CCPC / Canada Business Corporations Act
UK — Companies Act 2006 / EMI options
EU — (general; jurisdiction-specific via MiFID II)
SG — Companies Act (Cap. 50)
HK — Companies Ordinance (Cap. 622)
CN — WFOE / JV structures
IN — Companies Act 2013 / FEMA / DPIIT
JP — Companies Act (KK/GK)
AU — Corporations Act 2001
```

Formula IDs follow the pattern: `{region-lower}-default-v{version}`, e.g., `ca-default-v1`, `us-delaware-v1`, `sg-default-v1`.

### 4.4 Golden Vectors

Golden vectors are hardcoded expected outputs for specific scenarios used in regression testing:
```typescript
// Example golden vector
const goldenVector = {
  input: { shares: 1000000n, price: new Decimal("0.10"), fullyDiluted: 5000000n },
  expected: { ownership: new Decimal("0.20"), valuationUSD: new Decimal("500000") }
};
```

### 4.5 Property Tests (fast-check)

Property-based tests verify mathematical invariants regardless of input:
- Sum of all ownership percentages = 100% (within rounding tolerance)
- Total issued shares ≤ authorized shares
- SAFE conversion never creates more shares than authorized
- Anti-dilution ratchets are monotonic

---

## §5. MATH INTEGRITY GATE

### 5.1 Script: `scripts/check-math-integrity.sh`

Runs 53 tests across 17 files. This script is the CI gate — build fails if any math test fails.

**Test categories gated by this script:**
1. Cap-table engine core (`@capavate/cap-table-engine` package) — 60 tests
2. Reference engine (`@capavate/cap-table-engine-ref` package) — 15 tests
3. Telemetry (`@capavate/telemetry` package) — 13 tests
4. Gating package (`@capavate/gating` package) — 32 tests
5. Client lib: partners (9-region consortium directory) — 4 tests
6. Client lib: SES e-signatures — 6 tests
7. Client lib: token issuance/redemption — 18 tests
8. Client lib: visibility resolver — 18 tests
9. Client lib: termsheet reconcile — 4 tests
10. Client lib: termsheet templates — 15 tests
11. Server: sprint12 comprehensive — 48 tests
12. Server: sync/fieldMapping — 49 tests
13. Server: sync/conflictResolver — 9 tests
14. Server: sync/bridgeRuntime — 6 tests
15. Server: sync/inboundHandlers — 11 tests
16. Server: sync/migrationRunner — 7 tests
17. Server: sync/driftDetector — 7 tests

**Total Sprint 13 test count:** 498 tests passing across 64 files.

---

## §6. VISIBILITY RESOLVER (Sprint 9)

### 6.1 ResolvedIdentity Interface (from `client/src/lib/comms/visibility.ts`)

```typescript
export interface ResolvedIdentity {
  displayName: string;    // what to render
  isAnonymous: boolean;   // true iff anonymous fallback
  canSendDm: boolean;     // whether DM is allowed
  reason:
    | "self"                 // viewer === author
    | "founder_passthrough"  // author is founder of this company surface
    | "co_member_visible"    // opted-in cap-table co-member
    | "collective_visible"   // opted-in Collective network
    | "anonymous";           // default fallback
}

export const ANONYMOUS_LABEL = "[Anonymous Holder]";
```

### 6.2 Five Resolution Rules (in priority order)

```
Rule 1: viewerUserId === authorUserId → real name (self-view)
Rule 2: author is founderUserId of this company surface → real name (founder pass-through)
Rule 3: author.visibleToCoMembers === true AND viewer + author share ≥1 cap table → screen name + canSendDm
Rule 4: author.visibleToCollectiveNetwork === true AND viewer + author share Collective surface → screen name + canSendDm
Rule 5: Otherwise → "[Anonymous Holder]" + canSendDm = false
```

### 6.3 Three Visibility Toggles (from capavate_gating_addendum.md §6)

```typescript
interface Visibility {
  screenName?: string;                   // 3-30 chars, [A-Za-z0-9_-] only, unique
  visibleToCoMembers: boolean;           // default: false
  visibleToCollectiveNetwork: boolean;   // default: false
}
```

**Privacy rules:**
- ALL three toggles default to false (privacy-by-default)
- `visibleToCoMembers = true` without a `screenName` → STILL ANONYMOUS (consent without identity)
- `canSendDm` is NEVER true when `isAnonymous = true` — enforced both UI (button disabled) and server (403 with `reason: "anonymous"`)
- Past messages do NOT retroactively become anonymous when a holder revokes visibility — consent-at-write-time stands

### 6.4 Edge Cases Proven by Tests

- Self-view always shows real name regardless of toggle settings
- Founder pass-through always shows real name on their own company surface
- Co-member rule has priority over Collective rule
- Opt-in without screen name → still anonymous
- Anonymous fallback → DM disabled at both UI and server layer

### 6.5 Where the Resolver Is Wired

- Cap-table holder list
- Cap-table co-member list on Company Detail
- Message author names
- Post author names
- DM thread headers
- Reaction tooltips
- `commsStore.ts` server-side projection (never leaks legal name on wire if anonymous)

---

## §7. TOKEN-GATED INVESTOR ENTRY (Sprint 7)

### 7.1 Token Properties (from capavate_gating_addendum.md §1 + sprint7_summary)

```typescript
// Token generation (Node crypto — NOT Math.random)
const rawToken = crypto.randomBytes(32).toString("base64url"); // 256-bit, no padding
const tokenHash = createHash("sha256").update(rawToken).digest("hex"); // stored only as hash

// Token record (stored in DB)
interface InvitationToken {
  tokenHash: string;        // SHA-256 of raw token — only thing stored server-side
  roundId: string;
  companyId: string;
  invitedEmail: string;
  issuedAt: string;         // ISO-8601
  expiresAt: string;        // default: issuedAt + 30 days (founder-configurable)
  status: "active" | "redeemed" | "expired" | "revoked";
  redeemedAt?: string;
  redeemedByUserId?: string;
  redeemedIp?: string;
}
```

### 7.2 Token Lifecycle

```
created → sent → viewed (optional) → accepted → redeemed → archived
                                   ↘ declined → archived
                                   ↘ expired → archived
                                   ↘ revoked → archived
```

### 7.3 Signup Page Behavior

- `/investor/signup?token=<token>` — exists ONLY with a valid, unredeemed, unexpired token
- Without valid token → **renders 404** (no enumeration, no redirect, no "invalid token" message)
- Rate-limited: 10 req/min per IP on redemption endpoint
- Failed attempts: admin-alerted at 3+ within 1 hour

### 7.4 3-Step Inline Signup

| Step | Fields |
|------|--------|
| Step 1 — Identity | Full name, phone, country |
| Step 2 — Investor profile | Investor type, accreditation status, KYC docs |
| Step 3 — Privacy | Screen name (optional) + 3 visibility toggles (all default OFF) |

**On submit:** Account created, token marked redeemed, investor lands on round invitation.

### 7.5 Backend Endpoints

```
POST /api/rounds/:id/invitations/issue     — generates 256-bit token, stores hash, returns raw token once
GET  /api/invitations/check?token=...      — rate-limited; validates active/expired/revoked/redeemed
POST /api/invitations/redeem               — single-use enforcement; returns round invitation URL
```

---

## §8. TELEMETRY §9 ENVELOPE DETAILS

### 8.1 All Outbound Event Types (12, from SPRINT-12-PROGRESS.md §audit notes)

```typescript
type OutboundEventType =
  | "company.profile.updated"
  | "company.ma_intelligence.updated"
  | "investor.profile.updated"
  | "cap_table.mutated"
  | "eligibility.recomputed"
  | "lifecycle_policy.changed"
  | "formula.published"
  | "audit_log.appended"
  | "safe.converted"
  | "note.converted"
  | "round.closed"
  | "governance_metric.published";
```

### 8.2 All Inbound Event Types (4)

```typescript
type InboundEventType =
  | "dsc.scores"
  | "ma.intelligence_rankings"
  | "partner.introduction_status"
  | "network.social_signals";
```

### 8.3 Storage (in-memory → production path)

- **In-memory (current):** `server/bridgeStore.ts` — outbox is a `Map<string, OutboxEntry[]>` drained by `bridgeRuntime.ts`
- **Production:** Replace Map with Postgres `outbox` table; relay process polls and POSTs to Collective webhook
- **Query patterns:** Admin views via `GET /admin/sync` (added Sprint 13); DLQ accessible at `/admin/audit-log`

### 8.4 Wire Format

```
HMAC-SHA256 signed JSON
→ HTTPS POST to COLLECTIVE_WEBHOOK_URL
Headers:
  content-type: application/json
  x-bridge-signature: hmacSign(body, COLLECTIVE_WEBHOOK_SECRET)
  idempotency-key: eventId
Collective responds:
  2xx → ACK (event consumed)
  409 → Already received (idempotent duplicate)
Failure → exponential backoff → dead-letter queue
```

### 8.5 Admin Sync Dashboard (Sprint 13 addition)

Route: `/admin/sync` — shows:
- Outbox queue depth per event type
- Last delivered event ID + timestamp
- P50/P95/P99 delivery latency (last 50 events)
- Chain status (intact/broken)
- Dead-letter count

---

## §9. SANDBOX-SAFE CODE CONVENTIONS

### 9.1 The Core Rule

**No localStorage, sessionStorage, or indexedDB.** All state lives in:
- Backend: in-memory module variables in `server/*.ts` files
- Frontend: in-memory React state / TanStack Query cache
- Persistent state: backend store Maps (production: Postgres tables)

### 9.2 Examples in Practice

```typescript
// WRONG — breaks in sandbox
localStorage.setItem("activeCompanyId", companyId);

// RIGHT — in-memory module variable (server)
let _activeCompanyId: string | null = null;
export function getActiveCompanyId() { return _activeCompanyId; }

// RIGHT — TanStack Query (client)
const { data: activeCompany } = useQuery({
  queryKey: ["/api/founder/active-company"],
});
```

### 9.3 Session Management

- Auth state: in-memory `?actorId=` header or `x-actor-id` (dev); Auth0 JWT in production
- Company context: `GET /api/founder/active-company` → `POST /api/founder/companies/:id/activate`
- No cookie-based session storage on the client side

### 9.4 Why This Matters for Sprint 14

Sprint 14 CRM/Comms enhancements must follow the same convention. All new state (transaction prep checklist progress, intro request status, broadcast drafts) must live in server-side in-memory stores with the same shape they'll have in Postgres.

---

## §10. BRIDGE HMAC + IDEMPOTENCY (Sprint 12-13)

### 10.1 HMAC-SHA256 Envelope (from bridgeStore.ts + bridgeRuntime.ts)

```typescript
function hmacSign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function verifyHmac(body: string, signature: string, secret: string): boolean {
  const expected = hmacSign(body, secret);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

**Signature header:** `x-bridge-signature: {hex-hmac}`  
**Secret env var:** `COLLECTIVE_WEBHOOK_SECRET`  
**Verified using:** `timingSafeEqual` to prevent timing attacks

### 10.2 Idempotency Pattern

**Idempotency-Key = eventId** (CUID2, already globally unique)

On Collective inbound:
```typescript
const inboundSeen = new Set<string>();

if (inboundSeen.has(envelope.eventId)) {
  return res.status(409).json({ ok: false, reason: "already_received" });
}
inboundSeen.add(envelope.eventId);
```

Production: `inboundSeen` Set → Postgres `bridge_received_events` table with unique constraint on `event_id`.

### 10.3 Retry + Backoff + DLQ

```typescript
// In bridgeRuntime.ts drainOutbox logic
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 100;

async function deliverWithRetry(entry: OutboxEntry): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = await tryDeliver(entry);
    if (result.ok) return;
    await sleep(BASE_DELAY_MS * Math.pow(2, attempt)); // exponential backoff
  }
  // Dead-letter after MAX_ATTEMPTS
  markDeadLettered(entry);
}
```

**Dead-letter:** Surfaced in `/admin/audit-log` with retry/dismiss controls.

### 10.4 Hash Chain in Bridge

Each outbound event carries `auditChain: { priorHash, hash }` — these are the Capavate-side audit hashes. Collective stores them alongside its own audit log for end-to-end cross-system reconciliation.

### 10.5 Mock vs Live Mode

```typescript
const LIVE_MODE = !!process.env.COLLECTIVE_WEBHOOK_URL;

// In sandbox: LIVE_MODE = false → events drain to in-memory mock receiver
// In production: LIVE_MODE = true → events POST to COLLECTIVE_WEBHOOK_URL
```

---

## §11. VISUAL IDENTITY BUILT SO FAR

### 11.1 Light-Only Palette (Sprint 11 lock)

**206 `dark:` Tailwind classes stripped across 35 files in Sprint 11. Platform is LIGHT-ONLY.**

| Token | Hex | HSL | Tailwind equivalent |
|-------|-----|-----|---------------------|
| Navy | `#1C2B4A` | hsl(219, 45%, 20%) | `text-navy` or custom |
| Hydra | `#01696F` | hsl(184, 98%, 22%) | `text-[hsl(184_98%_22%)]` or custom |
| Plum | `#9D174D` | hsl(333, 75%, 35%) | `text-[hsl(333_75%_35%)]` |
| Reject | `#B33A2B` | hsl(7, 61%, 43%) | `text-[hsl(7_61%_43%)]` |

**Current Tailwind usage pattern in CRM.tsx (Sprint 11):**
```typescript
// From CRM.tsx stage colors — uses HSL inline values
{ key: "longterm", tone: "bg-[hsl(184_98%_22%)]/10 text-[hsl(184_98%_22%)]" }
```

### 11.2 shadcn/ui Base

- All UI components: shadcn/ui primitives (`Card`, `Button`, `Badge`, `Dialog`, `Select`, `Input`, `Label`, `Tabs`, `Avatar`, `Textarea`)
- shadcn/ui components live at `client/src/components/ui/`
- Custom components: `PageBody`, `PageHeader` in `AppShell.tsx`

### 11.3 Typography in Practice

- Page headers: `<PageHeader>` component
- Card titles: `<CardTitle>` (16px, font-semibold)
- Timestamps: `timeAgo()` from `client/src/lib/format.ts`
- Currency: `fmtUSD()` from `client/src/lib/format.ts`
- Percentage: `fmtPct()` from `client/src/lib/format.ts`

### 11.4 Logo

- Official Capavate wordmark: `/client/public/capavate-logo.png` (navy wordmark + red bar-chart square)
- Used at h-6 (AppShell header), h-5 (mobile sidebar), h-7 (auth shell), h-10 (landing hero)
- **No geometric SVG logo** — replaced in Sprint 7
- Favicon: points to `/capavate-logo.png`

---

## §12. MULTI-COMPANY ISOLATION (Sprint 11)

### 12.1 Architecture

A single Auth0 user (`user.sub`) can be associated with multiple companies as `companyOwner`, `founderOf`, or `signatoryOf`.

**Company switcher:** Topbar dropdown in `AppShell` — swap company without re-login.

**Per-company isolation:** Each company has a completely separate:
- Cap table (separate `round_participants`, `transactions`, `securities` records)
- Dataroom (separate `dataroom_grants`, `documents`)
- Billing (separate `billing_records`, `subscription` records)
- Settings (separate notification preferences, team permissions)
- Collective application status

### 12.2 Endpoints

```
GET  /api/founder/companies                    — list all companies for this user
POST /api/founder/companies/:id/activate       — set active company context
GET  /api/founder/active-company               — current active company
```

### 12.3 TanStack Query Invalidation

```typescript
// On company switch: invalidate all company-scoped queries
const companyId = useActiveCompanyId();

const contactsQ = useQuery({
  queryKey: ["/api/founder/investor-crm", companyId],  // companyId in key!
  queryFn: async () => (await apiRequest("GET", `/api/founder/investor-crm?companyId=${companyId}`)).json(),
});
```

**Rule:** Every query that is company-scoped must include `companyId` in the query key. Cross-company query invalidation fires on `POST /api/founder/companies/:id/activate`.

### 12.4 Seed (3 Companies)

Sprint 11 seeds 3 companies:
- NovaPay AI (fintech)
- Arboreal Health (health tech)
- Quanta Robotics (robotics)

### 12.5 Multi-Company in Collective Context

| Scenario | Collective behavior |
|----------|-------------------|
| Founder of 1 company | 1 deal card in deal room |
| Founder of 2+ companies | Separate deal cards per company; founder edits each on Capavate side |
| Founder who is also a cap-table investor | Same account holds both roles; Collective shows investor-side view |

---

## §13. CRM/COMMS THESIS DEEP-DIVE — TRANSACTION SCALING

### 13.1 What Capavate Has Built (Sprint 10-12 CRM + Comms)

#### A. Founder InvestorCRM (`/founder/crm`, Sprint 11 D5)

**File:** `client/src/pages/founder/CRM.tsx`

**Pipeline stages:**
```typescript
type Stage = "lead" | "engaged" | "soft_circle" | "invested" | "longterm";
```

**Stage colors:**
```typescript
const STAGES: Array<{ key: Stage; label: string; tone: string }> = [
  { key: "lead",        label: "Lead",             tone: "bg-zinc-100 text-zinc-700" },
  { key: "engaged",     label: "Engaged",          tone: "bg-amber-100 text-amber-700" },
  { key: "soft_circle", label: "Soft-Circle",      tone: "bg-cyan-100 text-cyan-700" },
  { key: "invested",    label: "Invested",         tone: "bg-emerald-100 text-emerald-700" },
  { key: "longterm",    label: "Long-term Partner",tone: "bg-[hsl(184_98%_22%)]/10 text-[hsl(184_98%_22%)]" },
];
```

**CrmContact type:**
```typescript
type CrmContact = {
  id: string;
  companyId: string;
  investorId: string;
  name: string;
  firmName: string;
  email: string;
  region: string;
  stage: Stage;
  ownership: { sharesUsd: number; pct: number };
  softCircleHistory: Array<{ ts: string; amountUsd: number; type: string }>;
  maSignals: number;         // count of M&A signals from this investor
  threadIds: string[];       // comms thread IDs
  notes: string;
  notesUpdatedAt: string;
  tasks: Array<{ id: string; text: string; due: string; status: "open" | "done" }>;
  series: string;
};
```

**Broadcast capability (in CRM.tsx):**
- `bcOpen` state: boolean for broadcast dialog
- `bcStage` filter: Stage | "all"
- `bcRegion` filter: string
- `bcSeries` filter: string
- `bcMsg` field: free-text broadcast message

**Bulk + segmented broadcast:** "Bulk message + segmented broadcast (stage / region / series)" — implemented in Sprint 11.

**API:** `GET /api/founder/investor-crm?companyId=...`

#### B. Investor Personal CRM (`/investor/crm`, Sprint 10 D3)

**File:** `client/src/pages/investor/CRM.tsx`

**Pipeline stages:**
```typescript
type PcrmPipelineStage = "lead" | "met" | "diligence" | "soft_circle" | "invested" | "exited";
```

**Contact kinds:**
```typescript
type PcrmContactKind = "founder" | "co_investor" | "ecosystem";
```

**Lanes:**
```typescript
type PcrmLane = "cap_table" | "round" | "dsc" | "angel_network" | "social";
```

**Telemetry events emitted:**
- `crm_contact_added`
- `crm_pipeline_moved`
- `crm_note_added`
- `crm_task_completed`

#### C. M&A Intelligence Panel (Sprint 10 D1)

The investor dashboard includes per-portfolio company M&A Intelligence:
- Acquirer-fit score 0-100
- Top-3 strategic-buyer shortlist
- Comparable exits 24mo
- Revenue multiple range

Two CTAs per row:
- "Initiate M&A discussion" → opens cap-table channel
- "Lead M&A initiative" → creates investor-led thread + `ma_initiative_started` telemetry

**API:** `GET /api/investor/ma/intelligence/:companyId` (from `maIntelligenceStore.ts`)  
**POST:** `POST /api/investor/ma/initiative` → `ma_initiative_started` event with `companyId + buyerShortlist`

### 13.2 Transaction-Scaling Gaps (What Needs Sprint 14 Work)

#### Gap 1: No Founder-Side M&A Buyer Shortlist from Collective

The `ma.intelligence_rankings` inbound event carries DSC-derived scores and sector benchmarks. The founder's M&A Intelligence panel (`/founder/company` Step 4 MA panel) does NOT currently surface the Collective-derived acquirer shortlist. **Fix:** When `ma.intelligence_rankings` arrives inbound, write `acquirerProfile.collectiveShortlist[]` into the company's M&A fields and surface it in the founder's Step 4 view.

#### Gap 2: No "Request Intro" Workflow

The CRM has no structured mechanism for a founder to request a warm introduction from a cap-table investor to a target acquirer. The CRM contact has `threadIds[]` (links to comms threads), but there's no intro-request state machine. **Fix:** Add `PcrmContact.introRequests: IntroRequest[]` and a workflow in the founder CRM.

#### Gap 3: No Transaction-Prep Checklist Channel

The 30 M&A intelligence fields are a checklist, but there's no comms channel where the founder + cap-table advisors work through them together. **Fix:** New channel kind `transaction_prep` — one per company, creator is founder, invitees are cap-table investors with `boardSeatPreference = true`.

#### Gap 4: No Cap-Table Milestone Broadcast

When a major milestone fires (`round.closed`, `governance_metric.published`), there's no founder-side CTA to broadcast a message to all cap-table holders. The `round.closed` notification is system-generated, but the founder can't add a personal message. **Fix:** Add a "Send milestone message to cap table" flow triggered on round close or governance metric publish.

#### Gap 5: No DSC Feedback Loop to Founder

The `dsc.scores` inbound event arrives at the bridge but is not surfaced to the founder. The founder should see: "Your company was reviewed by the DSC — here's a summary." **Fix:** When `dsc.scores` fires, create a founder notification and a read-only summary card in the M&A Intelligence panel.

### 13.3 Communication Channel Ideas (Sprint 14 Additions)

**New channel kind:** `transaction_prep`

```typescript
type ChannelKind =
  | "dm"
  | "cap_table"
  | "soft_circle"
  | "company_followers"
  | "network"
  | "transaction_prep";  // NEW — Sprint 14
```

**Transaction-prep channel spec:**
- One per company (created by founder when entering M&A mode)
- Members: founder + all cap-table investors with `boardSeatPreference = true`
- Checklist items anchored to M&A Intelligence fields
- Thread per checklist item: "IP due diligence readiness — needs action"
- Channel archives when transaction closes (exits) or company changes `maStatus = 'not_pursuing'`

**"Request Intro" workflow spec:**

```typescript
interface IntroRequest {
  id: string;
  fromUserId: string;     // founder
  toUserId: string;       // cap-table investor being asked
  targetDescription: string;  // "Please introduce me to [Acquirer/Fund]"
  status: "pending" | "accepted" | "declined" | "completed";
  introMessage?: string;  // auto-populated intro template
  createdAt: string;
  resolvedAt?: string;
}
```

Telemetry events:
- `crm_intro_requested` — founder sends request
- `crm_intro_accepted` — investor accepts
- `crm_intro_declined` — investor declines
- `crm_intro_completed` — intro confirmed sent

**Cap-table milestone broadcast spec:**
- Triggered at: `round.closed`, `governance_metric.published`, `ma_initiative_started`
- Founder writes a message (max 500 chars) to attach to the system notification
- Delivered as: in-app notification + email to all `round_participants` with `status = 'funded'`
- Template: `cap_table_broadcast` (new template ID)

### 13.4 Round Porting Flow (Capavate → Collective → Interest → CRM)

**Full flow (canonical reference for Sprint 14 build):**

```
[Capavate Founder Action]
1. Founder creates round: POST /api/rounds/new
   → round record in rounds table
   → round_participants initialized (empty)

[Outbox Sync]
2. round data in company.profile.updated outbox event fires
   → payload includes: lastRoundDate, lastRoundType, lastValuation, roundSize, instrument, terms
   → bridgeOutbound.ts drains outbox → POST to COLLECTIVE_WEBHOOK_URL
   → Collective updates deal card /collective/#/deals/:company_id

[Collective Scoring]
3. AlgorithmsProvider recomputes scores → composite_score / mna_score / round_score updated
   → auto_tier badge updates on deal card

[Member Discovery]
4. All active Collective members see deal card in /collective/#/deals
   → Round Terms tab (Tab 5) populated with instrument, valuation, size
   → DSC members see full scores; others see auto_tier label

[Member Interest]
5. Member clicks "Your Decision" tab → state: pending → viewed (auto)
   → Member submits soft-circle form
   → PATCH /api/rounds/:rid/invitations/:iid/decision
   → Event: soft_circle.submitted → outbox event → bridge outbound

[Capavate Inbound]
6. Capavate bridge inbound handler receives soft_circle.submitted (or round_participants update)
   → round_participants record created/updated: status = 'soft_circled'
   → Notification: round.soft_circle_received → founder notified

[CRM Update]
7. Founder InvestorCRM (/founder/crm) shows investor in "Soft-Circle" stage
   → per-investor card shows: soft-circle history, amount, currency, type
   → Soft-circle thread opens (soft_circle ChannelKind channel)
   → MIM section on Collective deal card: "+1 member, +$N indicated"

[Founder Decision]
8. Founder confirms: PATCH /api/rounds/:rid/invitations/:iid/decision {status: 'confirmed'}
   → round_participants.status = 'confirmed'
   → Investor notification: round.document_ready_to_sign
   → E-signature flow → signed → funded

[Cap-Table Mutation]
9. funded → cap_table.mutated event → eligibility.recomputed event
   → investorOnCapTable = true → sidebar badge resolves
   → cap_table channel opens if both opted in with screen names
   → Collective member status: investor now "on cap table"

[Founder CRM Enrichment]
10. Investor's CRM contact gains "Collective Member" indicator (if they are active)
    → "Network Reach" available for warm-intro requests
    → Transaction-prep channel can now include this investor
```

### 13.5 Capavate↔Collective Member-Status Integration

**When a cap-table investor becomes an active Collective member — what updates in each CRM:**

| CRM Surface | What Updates | How |
|-------------|-------------|-----|
| Founder InvestorCRM | Investor contact gains "Collective Member" badge | `collective_memberships.status = 'active'` event → CRM contact enrichment |
| Founder InvestorCRM | "Network Reach" panel shows investor's Collective connections | `investor.profile.updated` from Collective with chapterMembership, spvParticipation |
| Founder InvestorCRM | Intro-request CTA becomes available for this investor | Gated on `isCollectiveMember = true` |
| Investor PCRM | Founder auto-suggested as contact | "Add [Founder name] as CRM contact based on shared cap table" |
| Investor PCRM | Company appears in /collective/#/investments (My Investments) | `round_participants.status = 'funded'` event |
| Cap-table channel | Investor now visible (if opted in) | `eligibility.recomputed` → `cap_table_channel.member_added` |
| Collective deal card | Investor's soft-circle participation (historical) visible | In the deal's round_participants aggregate |

---

## §14. 9-REGION CONSTANTS (Sprint 11 Lock)

### 14.1 Region Definitions (from `client/src/lib/regions.ts`)

```typescript
export const REGION_CODES = ["US", "CA", "UK", "EU", "SG", "HK", "CN", "IN", "JP", "AU"] as const;
export type Region9 = typeof REGION_CODES[number];
export const REGIONS_ALL: Region9[] = [...REGION_CODES];

export function isRegion9(value: string): value is Region9 {
  return REGION_CODES.includes(value as Region9);
}

export const REGION_NAME: Record<Region9, string> = {
  US: "United States",
  CA: "Canada",
  UK: "United Kingdom",
  EU: "European Union",
  SG: "Singapore",
  HK: "Hong Kong",
  CN: "China",
  IN: "India",
  JP: "Japan",
  AU: "Australia",
};
```

### 14.2 Where the 9-Region Constant Must Be Used

- All region dropdowns in the UI
- Formula registry lookups
- KYC variant derivation
- Accreditation form variant selection
- `trace[].region` field in telemetry envelope
- Round wizard jurisdiction selector default
- Cap-table engine formula selection
- Consortium partner directory (9-region, 27 firms)

---

## §15. CROSS-REFERENCE: PATTERNS NEEDING PLATFORM-WIDE EXTENSION

The following patterns are currently applied inconsistently and need to be extended platform-wide in Sprint 14:

| Pattern | Current State | Extension Needed |
|---------|--------------|-----------------|
| Telemetry §9 envelope | Cap-table + profile + comms + bridge | Also needed on: intro-request workflow, transaction-prep channel, DSC feedback relay, milestone broadcast |
| Hash chain | audit_log table + comms outbox | Extend to new Sprint 14 stores (intro request, transaction-prep) |
| Visibility resolver | Cap-table + comms channels | Extend to transaction-prep channel members (should show screen names, not legal names) |
| Region 9 constant | Round wizard, cap-table, formula registry | Also needed in: intro request geo-context, milestone broadcast segmentation |
| Sandbox-safe conventions | All Sprint 6-13 stores | New Sprint 14 in-memory stores must follow same no-localStorage rule |
| HMAC + idempotency | Bridge outbound/inbound | Extend to new inbound events (DSC feedback relay, milestone from Collective) |
| Dual-engine reconcile | Cap-table mutations only | Consider extending to: intro-request amount validation, round-porting amount reconcile |
| Multi-company isolation | Company switcher + per-company stores | Extend to: transaction-prep channel (per-company), milestone broadcast (per-company) |

---

*End of harvest_capavate_bp.md*
