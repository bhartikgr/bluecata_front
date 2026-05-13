# Sprint 16 — Communications Architecture Audit + Three-Tier Unlock Design
**Date:** 2026-05-27  
**Version:** 1.0  
**Sources:** `server/commsStore.ts`, `SPRINT-9-COMMUNICATIONS-SUMMARY.md`, `SPRINT-14-FULL-BUILD-SUMMARY.md`, `collective_communications_audit.md`, `harvest_collective_bp.md §5 + §12`, `capavate_collective_sync_field_map.md §67-83 (visibility resolver)`, `server/lib/transactionPrepStore.ts` (Sprint 14 D4), `server/captableCommitStore.ts`

---

## Current State

### 1. Channel Kinds Inventory

From `commsStore.ts` and `client/src/lib/comms/types.ts`:

```typescript
type ChannelKind =
  | "dm"                // 1:1 direct message between two users
  | "cap_table"         // per-company group (founder + visible cap-table holders)
  | "soft_circle"       // per-round group (founder + soft-circlers; lifecycle-bound)
  | "company_followers" // posts from a company to its followers
  | "network"           // user's personal post feed (network connections)
  | "transaction_prep"; // Sprint 14 D4: per-company M&A prep workspace
```

**6 ChannelKinds total** (5 from Sprint 9 + 1 from Sprint 14):

| ChannelKind | Sprint | Description |
|---|---|---|
| `dm` | 9 | 1:1 DM between any two users meeting visibility resolver criteria |
| `cap_table` | 9 | Per-company group: founder + all visible cap-table holders |
| `soft_circle` | 9 | Per-round group: founder + soft-circlers; 14-day expiry |
| `company_followers` | 9 | Posts from a company to followers |
| `network` | 9 | User's personal posts feed to network connections |
| `transaction_prep` | 14 | One per company; founder-created on M&A toggle; auto-members = founder + board-seat investors; 30 M&A checklist anchors |

### 2. Existing 1:1 DM Rules

From `commsStore.ts` `registerCommsRoutes` → `POST /api/comms/dm/start`:

```typescript
// Gating logic in dm/start endpoint:
const shared = sharedContextBetween(me, target);
const r = resolveDisplayIdentity({...});
if (!r.canSendDm) {
  return res.status(403).json({ ok: false, reason: r.reason });
}
```

`resolveDisplayIdentity` (from `client/src/lib/comms/visibility.ts`) resolves:

| Condition | canSendDm | Reason |
|---|---|---|
| Viewer === Author | n/a | same-user shortcut |
| Author is a founder (founderUserId === authorUserId) | `true` | Founders always identifiable in their company context |
| Both on same cap table (sharedCapTables.length > 0) | `true` if author.visibleToCoMembers | Co-investor DM gated on opt-in |
| Shared Collective chapter (sharedCollectiveChapters.length > 0) | `true` if author.visibleToCollectiveNetwork | Chapter-peer DM |
| No shared context | `false` | "no_shared_context" reason |
| Shared context but author opted-out visibility | `false` | "no_visibility" reason |

**Current DM permission matrix:**

| From → To | Allowed? | Gate |
|---|---|---|
| Investor → Founder (same cap table) | ✓ Yes | Founder pass-through (always identifiable in their company) |
| Founder → Investor (cap table) | ✓ Yes | Investor must have visibleToCoMembers=true |
| Cap-table investor → cap-table investor | ✓ Yes | Both must have visibleToCoMembers=true + shared cap table |
| Investor → soft-circler | ✗ No | No shared cap table; no chapter unless both in same chapter |
| Cap-table investor → soft-circler | ✗ No | No shared cap table (soft-circler not yet committed) |
| Any → anonymous holder | ✗ No | visibleToCoMembers=false |
| Chapter member → chapter member | ✓ Yes | Shared chapter + both visibleToCollectiveNetwork=true |

**Peer-to-peer DMs between cap-table investors:** Currently allowed when both opt in (`visibleToCoMembers=true`) and share a cap table. This is implemented but not surfaced prominently — the existing DM seeded data shows Aisha ↔ HydraCap DM (dm2), demonstrating peer-to-peer works.

### 3. Existing Soft-Circle Channel Structure

```typescript
// Per-round group thread — from commsStore.ts seedAll():
{
  id: SEED_SOFTCIRCLE_SEED,          // softCircleChannelId("rnd_seed")
  kind: "soft_circle",
  companyId: "co_novapay",
  roundId: "rnd_seed",
  participantUserIds: [
    "u_maya_chen",       // founder
    "u_hydra_capital",   // soft-circler
    "u_forge_ventures",  // soft-circler
    "u_bluepoint_angels",// soft-circler
    "u_aisha_patel",     // soft-circler
  ],
  createdAt: "2026-04-19T12:00:00Z",
  metadata: {
    title: "NovaPay Seed Extension — Soft-Circle",
    founderUserId: "u_maya_chen",
    roundName: "NovaPay Seed Extension",
    memberSummary: "4 soft-circlers + founder",
  },
}
```

**Visibility rules (current):**
- Participation gated: must be in `participantUserIds`
- Founder always in; investors added on soft_circled state transition
- Identity: all participants visible to each other (founder + soft-circler; peer visibility within the channel)
- MIM aggregation at `/api/comms/soft-circle/:roundId`: returns visibleMemberCount, totalMemberCount, lastMessages (3)

**Expiry banner (Sprint 14 D6):** `SoftCircleExpiryBanner` with copy: "Your soft-circle expires in {N} day(s) — confirm or release" (urgent styling at ≤3 days). 14-day default from `softCircleExpiryDays = 14` in lifecycle policy.

### 4. Visibility Resolver Rules (Sprint 9 — Binding)

10 rules from `capavate_collective_sync_field_map.md §67-83`:

| Rule | Constraint |
|---|---|
| VIS-1 | PII (primaryEmail, phone, EIN, addresses, taxId, kycDocHashes) never leave Capavate |
| VIS-2 | Investor real name shown to cap-table company only; all Collective social = screenName |
| VIS-3 | `visibleToCoMembers=false` → excluded from co-member directory |
| VIS-4 | DSC scores: DSC committee + admin only; others see autoTier only |
| VIS-5 | Per-holder ledger entries never replicated |
| VIS-6 | Dataroom file bytes never replicated |
| VIS-7 | soft-circle amounts: Capavate-private; only aggregate totals in Collective MIM panel |
| VIS-8 | `burnRate` exact never shared; `runwayMonths` derived only |
| VIS-9 | `boardObservers`, `debtFacilities`, `activeInvestors.commitments`, `customerNames` private |
| VIS-10 | Cap-table connection visibility requires both-party opt-in |

### 5. Sprint 14 Enhancements (Already Built)

From `SPRINT-14-FULL-BUILD-SUMMARY.md`:

| Feature | Implementation |
|---|---|
| `transaction_prep` ChannelKind | One per company; founder-created on M&A toggle; 30 thread anchors auto-created; archives on maStatus='not_pursuing' or close |
| Segmented milestone broadcast | Pulls real cap-table segment data; auto-trigger on round.closed / governance_metric.published / ma_initiative_started; ≤500 chars; `cap_table_broadcast` email template |
| DSC feedback relay | inbound `dsc.scores` → founder notification + read-only DscSummaryCard (tier + top/bottom 3 dimensions; no individual votes) |
| Warm-Intro Request Workflow | Sparkles CTA on cap-table investor cards; `WarmIntroModal` with target picker + ask text (≤500 chars) + optional deck link; hash-chained ledger; telemetry: `crm_intro_requested/accepted/declined/completed` |
| Soft-circle expiry banner | `SoftCircleExpiryBanner` component with verbatim copy |
| Over-subscription guard | Founder warning toast when sum(soft_circles) > round_size |

---

## Tier 1 — Cap-Table Peer Comms

### What's Missing Today

1. **Peer-to-peer DMs** are technically gated in the visibility resolver (both must opt in, shared cap table), but there is no dedicated UI entry point for "DM this co-investor" in the cap-table view. The only DM entry point is the Company Detail "💬 Message" button (founder-facing) and the existing DM list.

2. **Co-investor sub-channels**: No ability for a group of cap-table investors to form their own sub-channel without the founder. E.g., "Hydra + Forge + Aisha side-room."

3. **Investor-led intros to other cap-table peers**: The warm-intro workflow (Sprint 14) is founder-initiated. There is no mechanism for one investor to intro another investor to a third party.

4. **Co-investor relationship view**: The Sprint 14 "5-lane Connections graph" shows shared context but there's no "mutual investments" panel showing "You and HydraCap are both on NovaPay and ArborealHealth."

### Design Proposals

**1a. Cap-table investor DM entry point:**
- On the `Cap Table Connections` tab in `/investor/contact-connections`, add a "💬 Message" CTA to every opted-in co-investor card.
- Backend: `POST /api/comms/dm/start` already handles this — just needs the UI wire.
- Visibility: only shown if target.visibleToCoMembers=true AND sharedCapTables.length > 0.

**1b. Co-investor sub-channel (new ChannelKind: `co_investor_group`):**
```typescript
type ChannelKind = ... | "co_investor_group";
// Per-cap-table, investor-created group of opted-in peers (no founder unless invited)
// ID: coInvestorGroupChannelId(companyId, groupHash)
```
- Created by any cap-table investor; members must share the same cap table
- Founder not auto-added; can be invited by group
- Max 20 members per group; max 3 active groups per cap table (prevent fragmentation)
- Visibility: participants only; screenName shown (VIS-2 / VIS-10 applies)
- New endpoint: `POST /api/comms/co-investor-groups` with `{companyId, memberUserIds[]}`

**1c. Investor-led peer intro:**
- On any `dm` channel or `cap_table` channel, cap-table investor can click "Introduce to co-investor" — opens `WarmIntroModal` adapted for investor-to-investor flow
- Backend: extend `introRequestStore.ts` with `fromRole: "investor"` and `toRole: "co_investor"` (currently only `fromRole: "founder"`)

**1d. Co-investor relationship view panel:**
- New panel "Shared portfolio" on co-investor contact card: lists every shared Capavate company with amount indicators redacted (screenName + company name only — VIS-10)

### Visibility Resolver Implications

- Peer DM gating: existing `resolveDisplayIdentity` already handles this correctly — no change needed to resolver logic
- New `co_investor_group` channel: participants are pre-screened at creation time (all must pass visibility resolver); channel itself does not re-check per message (checked once at join)
- Intro flow: the `WarmIntroModal` must apply VIS-2 (show screenName, not legal name) in investor-to-investor context

### Telemetry Events Needed

```typescript
"co_investor.dm.opened"           // Investor opens DM with co-investor
"co_investor.group.created"       // New co-investor sub-channel created
"co_investor.group.message.sent"  // Message in co-investor group
"co_investor.intro.requested"     // Investor-led intro requested
"co_investor.intro.accepted"      // Target investor accepts intro
"co_investor.intro.declined"      // Target declines
```

### Abuse Guards (Tier 1)

| Guard | Value | Rationale |
|---|---|---|
| DM rate limit | 20 messages/hour per sender per channel | Prevent flooding |
| Group creation | 3 groups per cap table per company | Prevent channel fragmentation |
| Mute | Per-user mute on any DM or group | Self-service abuse protection |
| Block | Per-user block; blocked user cannot start DM | Hard block |
| Admin override | Admin can dissolve any co_investor_group | Compliance tool |

---

## Tier 2 — Soft-Circle Peer Comms

### What's Missing Today

1. **MIM peer view (anonymous chips)**: The MIM section in "Your Decision" tab shows "N members have soft-circled" + aggregate "$M total indicated" + anonymized screen-name chips — but there is no separate sub-thread for soft-circlers to talk to each other. Investors can only see the aggregate; they cannot communicate with other soft-circlers.

2. **"Discuss with other soft-circlers" sub-thread**: No mechanism for soft-circlers to have a peer discussion parallel to the founder-led soft-circle channel.

3. **Indication-of-interest pulse** ("Leaning yes / Need diligence / Pass"): The existing `SOFT-CIRCLE TYPE` on the decision form ("Definite commitment / Indication of interest / Conditional on due diligence") captures this at submission, but there's no live pulse visible to other soft-circlers.

4. **Founder visibility model** (aggregate only): Currently the founder can see individual soft-circle identities (because they are participants in the soft_circle channel). The new design should add an option for founder to see only aggregate sentiment (protecting soft-circler deliberation privacy).

### Design Proposals

**2a. Soft-circler sub-thread (new ChannelKind: `soft_circle_peer`):**
```typescript
type ChannelKind = ... | "soft_circle_peer";
// Per-round, among opted-in soft-circlers only (no founder)
// ID: softCirclePeerChannelId(roundId)
// Members: all soft-circlers who have opted in to peer visibility
// Privacy: opt-in only — default opt-OUT
```
- Created automatically when ≥2 soft-circlers have opted into peer visibility
- Founder explicitly excluded (cannot join or view)
- Lifecycle: dissolves when soft-circle channel expires (14 days) or round closes
- New endpoint: `GET/POST /api/comms/soft-circle/:roundId/peer`

**2b. Indication-of-interest pulse:**
```typescript
type IOIPulse = "leaning_yes" | "need_diligence" | "pass";
// Per-soft-circler, per-round
// Visible to: other opted-in soft-circlers (aggregate only to founder)
// API: PATCH /api/rounds/:roundId/ioi-pulse { pulse: IOIPulse, optInPeerVisibility: boolean }
```
- Shown in MIM section as aggregate: "3 Leaning Yes · 1 Need Diligence · 0 Pass" (no per-investor attribution in founder view)
- In soft_circle_peer channel: per-member chips with screenName + pulse badge (opted-in members only)

**2c. Privacy defaults:**
- `optInPeerVisibility`: **default opt-OUT** — investor must explicitly check "Allow other soft-circlers to see my screen name in the peer discussion" when submitting soft-circle
- Founder visibility: aggregate IOI pulse counts (no per-investor sentiment in founder view)
- Admin can see all (audit context)

### Integration with 14-Day Expiry Banner

The `SoftCircleExpiryBanner` must also appear in the `soft_circle_peer` channel when ≤3 days remain:
```
"This peer discussion closes in {N} day(s) when the soft-circle expires."
```
On expiry: `soft_circle_peer` channel archives; no new messages can be posted; existing messages remain readable for 30 days then purge.

### Telemetry Events Needed

```typescript
"soft_circle.peer.opted_in"           // Investor opts in to peer discussion
"soft_circle.peer.message.sent"       // Message in soft_circle_peer channel
"soft_circle.ioi_pulse.submitted"     // Investor submits IOI pulse
"soft_circle.ioi_pulse.changed"       // Investor updates pulse
"soft_circle.peer.channel.dissolved"  // Channel dissolves on round close/expiry
```

---

## Tier 3 — Cap-Table Investor → Soft-Circler Comms

This is the NEW tier designed to enable **community endorsement to help close rounds**.

### Problem Statement

A soft-circler on the fence benefits most from hearing directly from **existing investors already committed to the round** — not just the founder. Today there is no mechanism for a cap-table investor to:
- Publicly endorse the round to soft-circlers
- Reach out to individual soft-circlers (even with their consent)
- Answer soft-circler questions in an open Q&A format
- Volunteer to facilitate a diligence call for a hesitant soft-circler

### Design Proposals

**3a. "Endorse this round" public post (new post variant):**
```typescript
// New authorKind: "cap_table_endorser"
// Post appears in the soft_circle channel's embedded feed (visible to all soft-circlers in this round)
// Post content: free text up to 300 chars + optional 5 pre-set endorsement reasons (checkboxes)
// Endorsement reasons: [
//   "Co-invested with this founder before",
//   "Validated the technology stack",
//   "Know the market well",
//   "Conducted reference checks",
//   "Personal commitment: I'm leading / co-leading"
// ]
// Visibility: all soft-circlers for this round; founder sees aggregate count (not content)
// Attribution: screenName (VIS-2) if visibleToCoMembers=true; otherwise anonymous
```

New endpoint: `POST /api/rounds/:roundId/endorsements`  
Response: `{ endorsementId, authorScreenName, reasons[], text, createdAt }`

**3b. "Reach out to soft-circler" DM (opt-in gated, rate-limited):**
```typescript
// Gate: soft-circler must have opted into "Allow cap-table investors to contact me" (per-round toggle)
// Default: opt-OUT (must explicitly enable)
// Rate limit: max 3 unsolicited DMs per round per soft-circler from cap-table investors
//   ("unsolicited" = DM initiated by cap-table investor; soft-circler replies don't count against limit)
// Initiated via: new CTA on soft-circler's MIM chip "💬 Reach out" (visible to cap-table investors only)
// API: POST /api/comms/cross-cohort/dm/start {targetUserId, roundId, senderIsCapTableFor: companyId}
```

Special channel kind for cross-cohort DMs:
```typescript
type ChannelKind = ... | "cross_cohort_dm";
// Different from regular "dm" — tagged with roundId + crossCohort=true
// Enables per-round rate limiting and audit
// Soft-circler can block the cap-table investor independently of other DMs
```

**3c. Open Q&A thread (new channel surface):**
```typescript
type ChannelKind = ... | "round_qa";
// Per-round Q&A: soft-circlers can post questions; cap-table investors can answer
// Founder can see all Q&A (read-only; cannot answer in this channel)
// Questions: anonymous to other investors but attributed to soft-circler in admin audit
// Answers: attributed to cap-table investor screenName
// Moderation: founder can close/archive any thread
// API: GET/POST /api/rounds/:roundId/qa
//       POST /api/rounds/:roundId/qa/:questionId/answers
```

**3d. "Broker diligence call" volunteer:**
```typescript
// Cap-table investor can post a "volunteer" card in round_qa:
// "I'm available for a 30-minute diligence call for anyone in the soft-circle who wants to discuss."
// Card includes: available slots (max 3, manually set by investor) + Calendly/similar link
// Soft-circler requests a slot → both parties get notification
// API: POST /api/rounds/:roundId/diligence-volunteers { availableSlots: 3, calLink: string }
```

**3e. Founder dashboard signal (yes/no endorsement happened, NOT content):**
```typescript
// Founder sees on Round Detail page:
// "🏅 2 cap-table investors have publicly endorsed this round"
// "💬 3 cross-cohort reach-outs initiated (3 of 15 soft-circlers opted in)"
// "❓ 5 Q&A threads open — 12 answers posted"
// Founder does NOT see:
//   - Content of endorsement posts
//   - Content of cross-cohort DMs
//   - Which specific soft-circlers were contacted or posted questions
// New endpoint: GET /api/rounds/:roundId/community-signals
//   → { endorsementCount, crossCohortDmCount, qaThreadCount, qaAnswerCount, diligenceVolunteers }
```

### New ChannelKinds Summary

```typescript
type ChannelKind =
  | "dm"
  | "cap_table"
  | "soft_circle"
  | "company_followers"
  | "network"
  | "transaction_prep"           // Sprint 14
  | "co_investor_group"          // Tier 1 NEW
  | "soft_circle_peer"           // Tier 2 NEW
  | "cross_cohort_dm"            // Tier 3 NEW
  | "round_qa";                  // Tier 3 NEW
```

### Abuse Guards (Tier 3)

| Guard | Value | Rationale |
|---|---|---|
| Cross-cohort DM rate limit | Max 3 unsolicited DMs per round per soft-circler from cap-table investors | Prevents coordinated pressure on fence-sitters |
| Global cap-table investor DM rate limit | Max 10 cross-cohort DMs per round per cap-table investor | Prevents one investor spam-reaching the whole soft-circle book |
| Endorsement rate limit | 1 endorsement per cap-table investor per round | Prevents endorsement flooding |
| Mute | Soft-circler can mute any cap-table investor's reach-outs for this round | Self-service |
| Block | Soft-circler can block a specific cap-table investor globally | Hard block |
| Founder moderation | Founder can flag/remove any endorsement post from the round (not content visibility — just prevents the post from appearing in soft-circle feed) | Protect founder's deal process |
| Q&A moderation | Founder can close any Q&A thread; admin can delete | Quality control |
| Audit trail | Every cross-cohort DM, endorsement, and Q&A answer logged in bridge outbox with `auditChain` | Compliance |
| Opt-in default | Soft-circler must explicitly opt in to cross-cohort contact; default opt-out | GDPR / PIPEDA consent alignment |

### Telemetry Events Needed (Tier 3)

```typescript
"round.endorsement.created"          // Cap-table investor posts public endorsement
"round.endorsement.removed"          // Founder removes endorsement post
"cross_cohort.dm.opt_in"             // Soft-circler opts in to contact
"cross_cohort.dm.opt_out"            // Soft-circler opts out
"cross_cohort.dm.started"            // Cap-table investor initiates DM
"cross_cohort.dm.rate_limit_hit"     // Rate limit reached
"round.qa.question.posted"           // Soft-circler posts Q&A question
"round.qa.answer.posted"             // Cap-table investor answers
"round.qa.thread.closed"             // Founder closes thread
"diligence.volunteer.created"        // Investor volunteers for call
"diligence.volunteer.slot.requested" // Soft-circler requests slot
"founder.community_signals.viewed"   // Founder views community signal panel
```

### CRM Enrichment

Every Tier 3 interaction feeds the founder's InvestorCRM:

| Interaction | CRM update |
|---|---|
| Cap-table investor posts endorsement | Contact record: new `activity` entry `{type: "endorsement", roundId, ts}` |
| Cap-table investor initiates cross-cohort DM | Contact record: new flag `high_value_advocate: true`; activity entry `{type: "cross_cohort_outreach", ts}` |
| Cap-table investor answers Q&A | Contact record: activity entry `{type: "qa_answer", questionCount, ts}` |
| Cap-table investor volunteers for diligence call | Contact record: new flag `high_value_advocate: true`; activity entry `{type: "diligence_volunteer", ts}` |

New investor stage indicator (founder CRM pipeline):
```
Lead → Engaged → Soft-Circle → Committed → Signing → Invested → Longterm
                                              ↑
                        NEW badge: "Engaged via co-investor endorsement"
                        Applied when investor enters Soft-Circle stage AND
                        any cap-table investor has posted an endorsement for this round
```

New investor flag (founder CRM contact record):
```typescript
high_value_advocate: boolean;
// Set to true when:
//   - Cap-table investor has posted ≥1 endorsement in any round, OR
//   - Cap-table investor has sent ≥1 cross-cohort DM for any round, OR
//   - Cap-table investor has volunteered for ≥1 diligence call
// Shown as: "🏅 High-Value Advocate" badge on InvestorCRM contact card
// Filter available in CRM: "Filter by: High-Value Advocates"
```

---

## Three-Tab Messages Reorganization

### Current Structure

Single "Messages from Shareholders" panel on investor dashboard (left of three-column grid) with flat list of all channels sorted by last message timestamp.

Single "View All Messages" modal with filter tabs: All / ★ Starred / ↓ Newest.

### Proposed Three-Tab Structure

Replace the single flat list with three tabs in the Messages modal (and on the dashboard mini-panel):

**Tab 1: Cap-Table Community**
- Content: `cap_table` channels + `co_investor_group` channels + `transaction_prep` channel (if user is cap-table member of the company)
- Grouped by company (one section per company the viewer has a cap-table position in)
- Per-tab search: "Search cap-table conversations..."
- Filter: All companies | [company selector chip row]
- Unread badge: aggregate unread count for this tab

**Tab 2: Soft-Circle Community**
- Content: `soft_circle` channels + `soft_circle_peer` channels + `round_qa` channels
- Grouped by round name
- Expiry banner surfaced per-round-group if ≤3 days remaining
- IOI pulse chips: "3 Leaning Yes · 1 Need Diligence · 0 Pass" (aggregate) shown in round header
- Per-tab search: "Search round conversations..."
- Filter: Active rounds | Archived rounds

**Tab 3: Cross-Cohort**
- Content: `cross_cohort_dm` channels + `dm` channels (peer DMs where both parties met through round context rather than cap table)
- Shows endorsement posts (read-only feed, not a channel per se)
- Shows cross-cohort DM history
- Filter: By round | By investor
- Opt-in toggle: "Allow cap-table investors to contact me in this tab" (per-round)
- Empty state (if opt-out): "You have not opted in to cross-cohort contact for any round. Endorsements from cap-table investors are still visible below."

### Implementation Notes

```typescript
// New ChannelListView partition function
function partitionChannelsIntoTabs(channels: ChannelView[], viewer: UserRef): {
  capTableCommunity: ChannelView[];
  softCircleCommunity: ChannelView[];
  crossCohort: ChannelView[];
} {
  const capTableKinds: ChannelKind[] = ["cap_table", "co_investor_group", "transaction_prep"];
  const softCircleKinds: ChannelKind[] = ["soft_circle", "soft_circle_peer", "round_qa"];
  const crossCohortKinds: ChannelKind[] = ["cross_cohort_dm", "dm"]; // dm filtered to cross-context only
  return {
    capTableCommunity: channels.filter(c => capTableKinds.includes(c.kind)),
    softCircleCommunity: channels.filter(c => softCircleKinds.includes(c.kind)),
    crossCohort: channels.filter(c => crossCohortKinds.includes(c.kind)),
  };
}
```

New endpoint: `GET /api/comms/channels?view=tabbed` → returns `{ capTableCommunity[], softCircleCommunity[], crossCohort[] }` instead of flat array.

---

## CRM Enrichment Design — Full Spec

### Pipeline of Enrichment Events

```
Any peer DM (co_investor_group or cross_cohort_dm)
→ emitOutbox("co_investor.dm.opened" | "cross_cohort.dm.started")
→ founderCrmStore: findOrCreate contact for target investor
→ append pcrm_notes entry: { type: "message", subType: channelKind, body: "[Auto] Peer DM initiated", ts }
→ update pcrm_contacts.lastTouchpointAt

Endorsement (round.endorsement.created)
→ founderCrmStore: findOrCreate contact for endorsing investor
→ append pcrm_notes entry: { type: "other", subType: "endorsement", body: "[Auto] Endorsed this round", ts }
→ set contact.high_value_advocate = true
→ update pcrm_contacts.pipelineStage to "engaged" if currently "lead"

Q&A answer (round.qa.answer.posted)
→ founderCrmStore: update contact.lastTouchpointAt
→ append pcrm_notes entry: { type: "other", subType: "qa_answer", ts }

Diligence volunteer (diligence.volunteer.created)
→ founderCrmStore: set contact.high_value_advocate = true
→ append pcrm_notes: { type: "call", subType: "diligence_volunteer", ts }
→ send notification to founder: "HydraCap has volunteered for a diligence call — view round Q&A"
```

### New Stage Indicator

```typescript
// In founder InvestorCRM pipeline view, stage badge:
// Appears on contact card in "Soft-Circle" and "Committed" stages when:
//   - round.endorsement.created event exists for this round AND
//   - this investor's pipelineStage was at or below "soft_circle" when endorsement posted
const STAGE_BADGE_ENGAGED_VIA_ENDORSEMENT = "Engaged via co-investor endorsement";
// Badge color: hsl(210 92% 42%) [--info / Qualified tier color]
// Badge icon: 🏅
```

### New Investor Flag

```typescript
// On InvestorCRM contact card:
const HIGH_VALUE_ADVOCATE_FLAG = "🏅 High-Value Advocate";
// Criteria (any one):
//   - Posted ≥1 round endorsement for any company
//   - Initiated ≥1 cross-cohort DM for any round
//   - Volunteered for ≥1 diligence call for any round
// Shown: small badge on contact avatar in CRM list + full badge on contact detail panel
// New CRM filter: "High-Value Advocates" filter chip in CRM left panel
```

---

## Appendix: New Endpoints Needed

### Tier 1 (Cap-table peer comms)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/comms/co-investor-groups` | Create co-investor sub-channel |
| `GET` | `/api/comms/co-investor-groups/:companyId` | List groups for this company (participant view) |
| `POST` | `/api/comms/co-investor-groups/:id/messages` | Send message to group |
| `POST` | `/api/founder/crm/intro-requests?fromRole=investor` | Extend intro flow for investor-to-investor |

### Tier 2 (Soft-circle peer comms)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/comms/soft-circle/:roundId/peer` | Get or create peer channel for round |
| `POST` | `/api/comms/soft-circle/:roundId/peer/messages` | Send message to peer channel |
| `PATCH` | `/api/rounds/:roundId/ioi-pulse` | Submit/update IOI pulse |
| `GET` | `/api/rounds/:roundId/ioi-pulse/aggregate` | Aggregate IOI stats (for founder + MIM section) |

### Tier 3 (Cap-table → soft-circler)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/rounds/:roundId/endorsements` | Create public endorsement |
| `DELETE` | `/api/rounds/:roundId/endorsements/:id` | Founder removes endorsement |
| `GET` | `/api/rounds/:roundId/endorsements` | List endorsements (by soft-circlers and cap-table investors) |
| `PATCH` | `/api/rounds/:roundId/cross-cohort-opt-in` | Soft-circler opt-in/out of cross-cohort contact |
| `POST` | `/api/comms/cross-cohort/dm/start` | Cap-table investor initiates cross-cohort DM |
| `GET` | `/api/rounds/:roundId/qa` | List Q&A threads |
| `POST` | `/api/rounds/:roundId/qa` | Post question (soft-circler) |
| `POST` | `/api/rounds/:roundId/qa/:qid/answers` | Post answer (cap-table investor) |
| `POST` | `/api/rounds/:roundId/diligence-volunteers` | Cap-table investor volunteers |
| `GET` | `/api/rounds/:roundId/community-signals` | Founder aggregate signal view |

### Messages Tab Reorganization

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/comms/channels?view=tabbed` | Returns tabbed channel partition |

---

## Top 5 Abuse / Privacy Concerns in Tier 3

### 1. Coordinated Pressure on Fence-Sitters
**Risk:** A lead investor (Hydra Capital) and several other cap-table investors coordinate to flood a specific soft-circler's cross-cohort DM inbox, creating social pressure to commit.  
**Guard:** Per-soft-circler limit of 3 unsolicited DMs per round across ALL cap-table investors. Once 3 DMs have been received from different investors for this round, the soft-circler's inbox for this round is locked. Founder dashboard shows "Max DMs reached for [screenName]" as a signal, not as a compliance action.

### 2. Endorsement Authenticity / False Endorsement
**Risk:** A cap-table investor posts an endorsement with misleading claims ("I've done full technical due diligence" when they haven't), inflating a soft-circler's confidence.  
**Guard:** Pre-set reason chips are soft-checkbox only (investor chooses from a fixed list, no free-form technical claims). Free text is capped at 300 chars. Disclaimer added under each endorsement: "This endorsement reflects the investor's personal opinion. Capavate does not verify endorsement claims." Founder can remove any endorsement that misrepresents the company.

### 3. Soft-Circler Identity Exposure via Cross-Cohort DM
**Risk:** When a cap-table investor initiates a cross-cohort DM, the soft-circler's screen name is revealed to the cap-table investor — this breaks VIS-3 / VIS-10 which require explicit opt-in before co-member visibility.  
**Guard:** Cross-cohort DM opt-in explicitly grants screen-name visibility from soft-circler to cap-table investors in this round context. The opt-in wording must state this explicitly: "By opting in, cap-table investors for this round will be able to see your screen name and contact you." Default: opt-out.

### 4. Q&A as a Vector for Competitor Intelligence
**Risk:** A soft-circler (who may be a competitor or competitor's agent) posts Q&A questions designed to elicit sensitive company information from cap-table investors who might over-share.  
**Guard:** Q&A questions appear in a moderated queue; founder can close/archive threads before answers are posted. Cap-table investors should be reminded in the Q&A UI: "Only share information consistent with the dataroom access you've been granted." The Q&A is not a substitute for formal due diligence materials — include a disclaimer. Admin can flag/audit any thread.

### 5. Founder Dashboard Signal as a Source of Investor Profiling
**Risk:** The founder's community signals view (endorsement count, DM count, Q&A activity) effectively ranks investors by advocacy intensity. A founder might discriminate against investors who don't endorse or don't participate in peer comms, using this signal in future round invitation decisions.  
**Guard:** The community signals view is explicitly labeled "For informational purposes only — engagement signals are not cap-table position information." The `high_value_advocate` flag enriches CRM but is NOT surfaced in cap-table engine output. It cannot be used as a criterion in SAFE/priced round allocation logic. Admin audit log captures all community signal views for potential investigation.
