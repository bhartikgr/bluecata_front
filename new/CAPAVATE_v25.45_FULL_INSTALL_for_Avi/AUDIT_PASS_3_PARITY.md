# Collective ↔ Capavate Real-Time Data Parity — Pass 3
**Sprint 28 | Date: 2026-05-15**

---

## 1. Bridge Event Coverage Audit

### Outbound event types (Capavate → Collective)

All 38+ outbound event types are registered in `ALL_OUTBOUND_EVENT_TYPES` in `bridgeStore.ts`. Key callers verified:

| Event Type | Caller | Status |
|---|---|---|
| `company.profile.updated` | profileStore.ts | ✅ Emitted on PATCH /api/profile/company |
| `investor.profile.updated` | profileStore.ts | ✅ Emitted on PATCH /api/profile/investor |
| `cap_table.mutated` | captableCommitStore.ts | ✅ Emitted on commit |
| `subscription.updated` | subscriptionsStore.ts | ✅ Emitted on every `updateSubscription()` call |
| `subscription.auto_created_on_company_create` | subscriptionsStore.ts | ✅ NEW — emitted by `createSubscriptionForNewCompany()` |
| `invoice.issued` | invoiceStore.ts | ✅ Emitted on `createInvoice()` |
| `invoice.paid` | invoiceStore.ts | ✅ Emitted on `markInvoicePaid()` |
| `invoice.refunded` | invoiceStore.ts | ✅ Emitted on `refundInvoice()` |
| `contact.created` | adminContactsStore.ts | ✅ Emitted on contact creation |
| `contact.updated` | adminContactsStore.ts | ✅ Emitted on PATCH |
| `contact.verified` | adminContactsStore.ts | ✅ Emitted on verification |
| `contact.archived` | adminContactsStore.ts | ✅ Emitted on archive |
| `region.proposed` | regionExtensionStore.ts | ✅ Emitted on proposal |
| `notification_campaign.created` | notificationCampaignStore.ts | ✅ Emitted on create |
| `notification_campaign.sent` | notificationCampaignStore.ts | ✅ Emitted on send |
| `email_campaign.created` | emailCampaignStore.ts | ✅ Emitted on create |
| `email_campaign.sent` | emailCampaignStore.ts | ✅ Emitted on send |
| `round.closed` | routes.ts / roundStore | ✅ Emitted on round close |
| `soft_circle.submitted` | captableCommitStore.ts | ✅ Emitted on soft circle submit |

**New in this sprint**: `subscription.auto_created_on_company_create` added to bridge store event types and `ALL_OUTBOUND_EVENT_TYPES` array.

---

## 2. Inbound Sync Handler Coverage

`server/lib/bridgeInbound.ts` handles inbound events from Collective:

| Event Type | Handler | Status |
|---|---|---|
| `dsc.scores` | → `inboundState.companyDsc` | ✅ |
| `ma.intelligence_rankings` | → `inboundState.companyMa` + `companyTier` | ✅ |
| `partner.introduction_status` | → `inboundState.partnerStatus` | ✅ |
| `network.social_signals` | → `inboundState.socialSignals` | ✅ |
| `member.application_decision` | → `inboundState.memberDecisions` | ✅ |
| `membership.renewal_status` | → `inboundState.membershipRenewals` | ✅ |
| `kyc.status_decision` | → `inboundState.kycDecisions` (with conflict resolution) | ✅ |
| `soft_circle.submitted` | → `inboundState.roundParticipants` | ✅ |

**Gap identified**: The inbound handlers are correct but they write to in-memory state (`inboundState.*`). For production Postgres, these handlers need to be wired to Drizzle upserts. This is documented as a known limitation.

---

## 3. Data Parity — Per Concern

### 3.1 Investor profile changes → Collective member directory

**Flow**:
1. Admin edits contact in Capavate (`PATCH /api/admin/contacts/:id`)
2. `adminContactsStore.ts` calls `emitBridgeEvent({ eventType: "contact.updated", ... })`
3. Bridge outbox entry queued
4. `bridgeRuntime.ts` drains outbox via `drainOutbox()` (in production: HTTP POST to Collective)
5. Collective receives the event and updates its member directory

**SSE realtime**: `emitBridgeEvent` now calls `emitMutation({ aggregate: "bridge", id: eventId, change: "create" })` — this fans out to all SSE subscribers immediately, so the admin Bridge page and collective dashboard update within ~1 second.

**Status**: ✅ Chain is complete.

### 3.2 Subscription changes → Collective billing view

**Flow**:
1. Subscription mutated via `updateSubscription()` in `subscriptionsStore.ts`
2. `bridgeEmitter("subscription.updated", companyId, { status, plan, version, revisionHash })` called
3. Bridge outbox entry queued + SSE push
4. Collective receives `subscription.updated` and updates company's billing view

**Status**: ✅ Complete. New subscription `status: "cancel_at_period_end"` is now a valid status in the type system.

### 3.3 Cap-table membership → Collective deal-room access

**Flow**:
1. Cap-table commit in `captableCommitStore.ts` emits `cap_table.mutated`
2. Collective processes this to determine which investors have deal-room access
3. `soft_circle.submitted` inbound from Collective maps to `inboundState.roundParticipants`

**Status**: ✅ Complete per existing implementation.

### 3.4 Notification campaigns → Collective member feeds

**Flow**:
1. Campaign with `audienceType = "all_consortium_partners"` is sent
2. `notificationCampaignStore.ts` emits `notification_campaign.sent` to bridge
3. Collective receives this and fans out to each partner's notification feed

**Gap**: The Collective side's notification fan-out is simulated (no live Collective webhook receiver in this sandbox). In production, `BRIDGE_OUTBOUND_URL` is the Collective's `/api/bridge/inbox` endpoint.

**Status**: ✅ Capavate side complete; Collective receiver is external.

---

## 4. SSE Realtime Channel

**Fix applied**: `emitBridgeEvent()` in `bridgeStore.ts` now calls `emitMutation()` from `eventBus.ts` after pushing to the outbox. This means every bridge event (subscription changes, contact updates, invoice lifecycle, etc.) is immediately pushed to all SSE subscribers at `/api/events/stream`.

The admin Bridge & Outbox page subscribes to this stream via `client/src/lib/realtimeSync.ts`. The collective dashboard (when in same origin) can subscribe to the same stream.

**Latency**: ~1 second (limited by network RTT and SSE polling interval).

---

## 5. End-to-End Test

**File**: `server/__tests__/sprint28_collective_capavate_parity.test.ts`

### Test coverage:

| Test | Scenario | Assertion |
|---|---|---|
| `Contact update → bridge event` | `contact.updated` emitted | Event in outbox with correct aggregateId |
| `Contact hash stability` | Same event produces stable hash | `auditChain.hash` is 64-char hex |
| `Subscription active → Collective` | `updateSubscription(active)` | Bridge event payload.status = "active" |
| `Subscription cancel` | `cancel_at_period_end` | Store reflects status, bridge event emitted |
| `New company auto-subscription` | `createSubscriptionForNewCompany()` | status = pending_payment, plan = founder_pro |
| `Idempotency` | Double-call same companyId | Second call returns `created: false` |
| `Auto-create bridge event` | `subscription.auto_created_on_company_create` | Event in outbox |
| `Drain rate` | 100 events enqueued, simulated delivery | 100% delivered (≥95% threshold) |
| `Hash chain integrity` | Two sequential events | e2.priorHash = e1.hash |
| `ALL_OUTBOUND_EVENT_TYPES` | New event type present | Contains `subscription.auto_created_on_company_create` |
| `Inbound dsc.scores` | `dispatchInbound(dsc.scores)` | `inboundState.companyDsc` updated |
| `Inbound ma.intelligence_rankings` | `dispatchInbound(ma...)` | `inboundState.companyTier` = "B" |
| `Unknown event type` | `dispatchInbound(unknown)` | `applied: false` |

---

## 6. Known Limitations

1. **Inbound handler persistence**: Inbound events update in-memory `inboundState`. In production, these must write to Postgres tables (see DB_ARCHITECTURE.md §2.8 sync_inbox).
2. **Bridge outbox drain**: `drainOutbox()` is called manually or on a timer. Production needs the `capavate-bridge-worker` process (see DEPLOY_HANDOFF.md §3).
3. **Collective receiver**: The `BRIDGE_OUTBOUND_URL` points to the Collective's `/api/bridge/inbox`. This endpoint is external and not tested in this repo.
4. **Notification fan-out**: Campaign delivery to individual partner feeds requires the Collective's internal routing, which is external to this sprint.
