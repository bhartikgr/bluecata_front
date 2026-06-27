# Cross-Component Bridges — v23.9 Status

Scope note (D2): This document records the **current** state of the
Capavate ↔ Collective and intra-app bridges as of v23.9. Per the v23.9
objective, **no new bridge feature is shipped in this wave** — this is a
documentation/status pass only. Source of truth: `server/bridgeStore.ts`.

## 1. Capavate → Collective (outbound)

Canonical envelope per `collective_admin_audit.md §13.4`
(`{ eventId, eventType, aggregateId, aggregateKind, occurredAt, tenantId,
actor, payload, trace[], auditChain{priorHash,hash}, schemaVersion:"1.0" }`).
Delivery is HMAC-SHA256 signed, `Idempotency-Key=eventId`, with exponential
backoff + dead-letter capture surfaced in `/admin/audit-log`.

| # | eventType | Status |
|---|-----------|--------|
| 1 | `company.profile.updated` | working |
| 2 | `company.ma_intelligence.updated` | working |
| 3 | `investor.profile.updated` | working |
| 4 | `cap_table.mutated` | working |
| 5 | `eligibility.recomputed` | working |
| 6 | `lifecycle_policy.changed` | working |
| 7 | `formula.published` | working |
| 8 | `audit_log.appended` | working |
| 9 | `safe.converted` | working |
| 10 | `note.converted` | working |
| 11 | `round.closed` | working |
| + | `governance_metric.published` | working (bonus) |

Durability: Wave C / FIX C3 added `bridge_outbox` DB write-through
(`persistOutboxInsert` on emit, status/attempt updates on drain). The
in-memory outbox remains the runtime source of truth; a DB outage never
blocks an emit. Boot rehydration helper: `_hydrateOutbox`.

## 2. Collective → Capavate (inbound)

| # | eventType | Status |
|---|-----------|--------|
| 1 | `dsc.scores` | working |
| 2 | `ma.intelligence_rankings` (nightly) | working |
| 3 | `partner.introduction_status` | working |
| 4 | `network.social_signals` | working |

Inbound durable maps run in ephemeral (in-memory) mode under test
(`inbound:companyTier`, `inbound:companyMa`, `inbound:companyDsc`,
`inbound:partnerStatus`, `inbound:socialSignals`, `inbound:memberDecisions`,
`inbound:membershipRenewals`, `inbound:kycDecisions`,
`inbound:roundParticipants`); they persist in production.

## 3. Intra-app bridges touched / verified in v23.9

These are application-level "bridges" (one domain action propagating into
another store) confirmed working this wave:

- **Round invitation → Founder CRM (B9).** Creating a round invitation
  upserts the investor into the founder CRM via
  `upsertCrmContactForInvitation` (`server/roundInvitationsStore.ts` →
  `server/founderCrmStore.ts`). v23.9 enhancement: the auto-created CRM note
  now carries the originating `roundId`. Regression: `v23_9_fixes.test.ts`
  B9.
- **Consortium partner link → Founder CRM (C8 / CP-6).** Linking a company
  to a consortium partner (`POST /api/admin/companies/:id/consortium-partner`)
  surfaces the sponsor in the founder's CRM via
  `upsertInvestorContactFromPartner` (`server/partnerRoutes.ts`). The link is
  also surfaced read-side on `GET /api/admin/companies/:id`
  (`company.consortiumPartnerId` / `company.consortiumPartner`). Regression:
  `v23_9_fixes.test.ts` A4.
- **Collective application approve → membership overlay (B6).** Approving a
  collective application (`POST /api/admin/collective/applications/:id/approve`)
  calls `upsertActiveMembership`, which `buildCollectiveOverlay`
  (`server/lib/userContext.ts`) reads so `GET /api/auth/me` reflects
  `collective.status === "active"`. No code change needed in v23.9; verified
  empirically. Regression: `v23_9_fixes.test.ts` B6.

## 4. Still TODO (explicitly deferred — out of scope for v23.9)

- No new outbound or inbound bridge event types are added in v23.9 (scope
  kept tight per objective).
- Inbound durable-map persistence under the test harness remains ephemeral
  by design; production persistence is unchanged.
- Full end-to-end delivery against a live Collective endpoint is exercised by
  the existing bridge suites, not by the v23.9 HTTP harness.
