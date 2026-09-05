# Sprint 9 — Communications System (Capavate)

**Status:** Shipped · Deployed · 254 tests passing · 0 console errors  
**Date:** 2026-05-09  
**Authors:** Perplexity Computer for Ozan Isinak (Blueprint Catalyst Limited)

---

## Executive summary

Sprint 9 delivers the **two-surface communications system** (Messages + Posts) on
both the founder and investor dashboards, fully gated by the cap-table /
soft-circle / Collective topology and driven by the production-shape
visibility resolver from R200.gating §6.

This is the surface that operationalises the **M&A intelligence value
proposition**: every conversation, every signal, every co-member interaction
flows through the audit chain and the Collective outbox. The same wire format
will move 1:1 to production Postgres + Drizzle on cutover.

| Metric | Before Sprint 9 | After Sprint 9 |
| ---- | ---- | ---- |
| Test suite | 223 passing | **254 passing** (+31) |
| Communications surfaces | 1 basic Messages page (236 LOC) | Full split-pane + dashboard widgets + per-company / per-round cards |
| Channel kinds modelled | 0 | 5 (`dm`, `cap_table`, `soft_circle`, `company_followers`, `network`) |
| Comms API endpoints | 0 | 19 |
| Comms telemetry events | 0 | 21 new event types · 32 seeded events |
| Visibility resolver coverage | Cap-table list (Sprint 7) | Messages, posts, channels, DMs, channel cards, dashboard widgets |
| Console errors on new surfaces | n/a | **0** (verified across 12 Playwright screenshots) |

---

## Deliverables shipped

### 1 — Communications data model (`client/src/lib/comms/`)

- **`types.ts`** (285 LOC) — Channel, Message, Post, MessageAttachment,
  MessageReaction, PostComment, Visibility + zod schemas for every wire
  payload + deterministic id helpers (`dmChannelId`, `capTableChannelId`,
  `softCircleChannelId`, etc.). Schema version field on every entity for
  forward migration.
- **`visibility.ts`** (191 LOC) — `resolveDisplayIdentity` is THE single
  source of truth for "what name does Viewer V see?". Five rules in
  priority order: **self → founder pass-through → cap-table opt-in →
  Collective opt-in → anonymous fallback**. Returns `{ displayName,
  isAnonymous, canSendDm, reason }`. `canSendDm` is **never true** when
  `isAnonymous=true` — UI guard is double-enforced server-side.
- **`channels.ts`** (194 LOC) — pure-function membership recompute logic
  for cap-table channels (`computeCapTableMembers`,
  `ensureCapTableChannel`, `diffCapTableMembership`) and soft-circle
  channels (`computeSoftCircleMembers`, `ensureSoftCircleChannel`,
  `softCircleTransitionReason`).

### 2 — In-memory production-shape backend (`server/commsStore.ts`, 1,232 LOC)

- 8 demo users with realistic privacy postures (some opted-in, some
  anonymous, some Collective-only) + a `currentInvestor`-shaped accessor.
- 7 pre-seeded channels (cap-table NovaPay, soft-circle for Seed Extension,
  company-followers for NovaPay, two network feeds for Aisha + Maya, plus
  three pre-existing DMs).
- 14 pre-seeded messages (cap-table conversations including Avocado Angels
  showing as `[Anonymous Holder]`, soft-circle round status updates, and
  three DM threads).
- 10 pre-seeded posts (5 NovaPay company-follower posts + 5 network posts
  spanning Maya, Aisha, Hydra, Forge, Bluepoint).
- Hash-chained audit log + Collective-consumable outbox on every mutation.
- **Idempotency-Key support** on POSTs (the production contract for
  retries on flaky networks).
- **Per-request `actorIp` + `userAgent` capture** on every send/edit/star/
  react/post/like/comment — the full provenance the spec demands.

#### Endpoints (19)

| Verb | Path | Purpose |
|------|------|---------|
| GET  | /api/comms/channels | List channels visible to viewer (role-filtered) |
| GET  | /api/comms/channels/:id | Channel + last 50 messages |
| POST | /api/comms/channels/:id/messages | Send (membership-gated, validated) |
| PATCH | /api/comms/messages/:id | Author edit within 15 min |
| DELETE | /api/comms/messages/:id | Author soft-delete |
| POST | /api/comms/messages/:id/star | Star |
| DELETE | /api/comms/messages/:id/star | Unstar |
| POST | /api/comms/messages/:id/reactions | Add reaction `{ emoji }` |
| DELETE | /api/comms/messages/:id/reactions?emoji= | Remove reaction |
| POST | /api/comms/channels/:id/read | Mark all read |
| GET  | /api/comms/posts?scope=&sort= | Feed (`network` / `company_followers` / `all`) |
| POST | /api/comms/posts | Create (visibility-validated) |
| POST | /api/comms/posts/:id/like | Like |
| DELETE | /api/comms/posts/:id/like | Unlike |
| POST | /api/comms/posts/:id/comments | Comment `{ body }` |
| POST | /api/comms/posts/:id/share | Share |
| POST | /api/comms/posts/:id/follow | Follow (company posts only) |
| POST | /api/comms/dm/start | Open DM iff visibility resolves canSendDm=true (else **403**) |
| GET  | /api/comms/cap-table/:companyId | Channel access + last 3 messages |
| GET  | /api/comms/soft-circle/:roundId | Channel access + last 3 messages |
| GET  | /api/comms/users / /me | User registry + viewer self |
| GET  | /api/comms/dev/{outbox,audit} | Telemetry visibility |

### 3 — Founder + investor dashboard widgets

- `client/src/components/comms/MessagesWidget.tsx` — left-column messages
  panel matching live capavate.com:
  - Header: "Messages from Shareholders" + refresh icon + total-unread badge
  - Filter tabs: All / ★ Starred (count) / ↓ Newest
  - Avatar (or 🔒 lock for anonymous) · resolved name · channel-kind badge ·
    star indicator · unread badge · timestamp · last-message preview
  - "View all messages" CTA → `/founder/messages` or `/investor/messages`
- `client/src/components/comms/PostsFeed.tsx` — center-column feed mirroring
  the live site:
  - "Start a post" textarea + visibility selector (Network / My company
    followers / Both)
  - Sort tabs: Newest / Featured / Following + refresh icon
  - Post card: avatar · resolved name · **Capavate Angel Network gold
    badge** when applicable · role badge · location · timestamp · body ·
    like / comment / share counts · Following toggle on company posts ·
    "⋯" context menu

Both widgets are wired into `client/src/pages/founder/Dashboard.tsx` and
`client/src/pages/investor/Dashboard.tsx` in a 1+2 column grid below the
KPIs and above the existing Active raise / Activity / KPI table sections.

### 4 — Full Messages page (`/founder/messages`, `/investor/messages`)

- `client/src/components/comms/MessagesPage.tsx` (480 LOC) — a single
  shared component used by both routes. Layout exactly per spec:
  - **Left pane (320 px)**: search · filter tabs (All / Starred / Newest /
    DMs / Cap Table / Soft-Circle) · channel rows with avatar + resolved
    name + channel-kind badge + star + unread.
  - **Right pane**: header (avatar + name + online status pill) ·
    **channel-kind context banner** ("Cap Table Channel for [Company] —
    visible to founder + N visible holders. Holders without a screen name
    appear as [Anonymous Holder] and cannot post." or for soft-circle
    "You're in this channel because you soft-circled the [Round]. Once
    you sign or withdraw, your access updates accordingly.") ·
    date-grouped message bubbles · per-message reactions · reply-to
    indicator · ✓✓ read receipts · composer with emoji + attachment +
    send (Cmd-Enter shortcut).
- `client/src/pages/founder/Messages.tsx` and
  `client/src/pages/investor/Messages.tsx` are 10-LOC role-shells over the
  shared component.
- Empty state on the left pane shows the spec'd CTA per role.

### 5 — Cap-Table Channel + Soft-Circle Channel cards

- `client/src/components/comms/ChannelCards.tsx` exposes
  `<CapTableChannelCard />` and `<SoftCircleChannelCard />`.
- Both render only when the viewer is a member of the corresponding
  channel; otherwise they self-suppress (no leak of channel existence).
- Each card has the spec'd privacy banner, last 3 message previews, and
  an "Open channel" button that deep-links into the relevant Messages
  surface with `?channel=<id>`.
- Wired into `client/src/pages/CompanyDetails.tsx` (used by both founder
  and investor company detail pages) and into the soft-circle book tab on
  `client/src/pages/founder/RoundDetail.tsx`.

### 6 — Visibility resolver wired everywhere

The new surfaces consume the resolver server-side (in `commsStore.ts` —
every projected channel / message / post is shaped through
`resolveDisplayIdentity`) so the wire payload to the client never leaks
the legal name of an anonymous holder. The cap-table page from Sprint 7
continues to use `resolveCoMemberLabel` (which is the same model in a
thinner wrapper).

Edge cases the resolver handles correctly (proven by 16 unit tests):
- **Self-view always shows real name** regardless of visibility settings
- **Founder pass-through** — author shows real name on their own company
  surfaces because founder identity is inherently public to stakeholders
- **Co-member rule has priority** over Collective rule
- **Opt-in WITHOUT a screen name** → still anonymous (consent without
  identity)
- **Anonymous fallback NEVER allows DM** — UI button disables, server
  returns 403 with `reason: "anonymous"`

### 7 — Telemetry events (`packages/telemetry/src/events.ts`)

21 new strongly-typed event variants added to the discriminated union:
`message.sent`, `.edited`, `.deleted`, `.starred`, `.unstarred`,
`.reaction.added`, `.reaction.removed`, `post.created`, `.liked`,
`.unliked`, `.commented`, `.shared`, `.followed`, `dm.channel.opened`,
`dm.channel.blocked`, `cap_table_channel.member_added`, `.member_removed`,
`soft_circle_channel.created`, `.member_added`, `.graduated`, `.archived`,
`visibility.unmasked_message`. Six new categories registered in
`EventCategory`.

`client/src/lib/sprint3Seed.ts` was extended to pre-seed **32
communications events** at app boot so `/admin/telemetry` shows real
data the moment the page loads.

### 8 — Tests added

| File | New tests |
| ---- | ---- |
| `client/src/lib/comms/__tests__/visibility.test.ts` | **16** (every rule + every edge case + batch + curried resolver) |
| `client/src/lib/comms/__tests__/channelMembership.test.ts` | **9** (cap-table recompute + diff on issuance / transfer / multiple instruments) |
| `client/src/lib/comms/__tests__/softCircleChannel.test.ts` | **6** (lifecycle: intent → committed → signed → withdrawn / round-closed archival) |

Total: **31 new tests**. All 223 prior tests continue to pass.

```
 Test Files  43 passed (43)
      Tests  254 passed (254)
   Duration  9.23s
```

---

## Playwright verification — 12 / 12 passing

| # | Verification | Screenshot |
|---|--------------|------------|
| 1 | Founder dashboard renders Messages widget + Posts feed alongside existing Active raise card. | `sprint9_01_founder_dashboard.png` |
| 2 | Investor dashboard mirrors the same dual-surface model above the per-company table. | `sprint9_02_investor_dashboard.png` |
| 3 | `/investor/messages` split-pane: 4 channels (Cap Table, Soft-Circle, two DMs) with kind badges + last-message previews. | `sprint9_03_investor_messages_default.png` |
| 4 | Cap-table channel: banner reads "Cap Table Channel for NovaPay AI — visible to founder + 5 visible holders. Holders without a screen name appear as [Anonymous Holder] and cannot post." Avocado Angels' message renders as `[Anonymous Holder]` italic + lock avatar; Maya Chen / HydraCap / Aisha Patel render with real / screen / self names; reactions + reply-threads render. | `sprint9_04_cap_table_channel.png` |
| 5 | Soft-circle channel: banner explains lifecycle gating ("Once you sign or withdraw, your access updates accordingly."); shows Maya + Hydra + Forge + Bluepoint conversations. | `sprint9_05_soft_circle_channel.png` |
| 6 | Company detail (investor view) bottom: Cap-Table Channel card + Soft-Circle Channel card, each with privacy banner, last-3 messages, and Open-channel button. Anonymous holder previews show with lock avatars + italic name. | `sprint9_06_company_detail_channel_cards.png` |
| 7 | Investor profile renders all visibility toggles. | `sprint9_07_investor_profile_visibility.png` |
| 8 | Sent a message in the Aisha ↔ Maya DM thread; UI immediately shows the new message + telemetry event was emitted on the chain. | `sprint9_08_send_message_test.png` |
| 9 | Liked + shared posts in the dashboard feed; counts update; telemetry events fire. | `sprint9_09_post_interactions.png` |
| 10 | `/founder/messages` renders the same split-pane (founder side). | `sprint9_10_founder_messages.png` |
| 11 | Admin telemetry page now lists `cap_table_channel.member_added`, `soft_circle_channel.created`, `dm.channel.opened`, `message.sent`, `post.created`, etc. in the chain. | `sprint9_11_admin_telemetry_comms.png` |
| 12 | Founder dashboard with Posts feed sorted by Featured. | `sprint9_12_founder_dashboard_featured_feed.png` |

### DM gating — programmatic verification

```
POST /api/comms/dm/start { targetUserId: "u_avocado_angels" }
  → 403 { ok: false, reason: "anonymous" }                 ✓ (anonymous holder)

POST /api/comms/dm/start { targetUserId: "u_forge_ventures" }
  → 200 { ok: true, channelId: "dm__u_aisha_patel__u_forge_ventures",
          channel.displayTitle: "ForgeVC" }                ✓ (visible co-member)
```

### Console errors

- **0 errors on every surface** (founder dashboard, investor dashboard,
  messages, cap-table channel, soft-circle channel, company detail,
  investor profile, founder messages, admin telemetry).
- One expected 403 emerged from the **intentional** anonymous-DM probe in
  the Playwright run — that is the spec working as designed.

---

## Files changed

### New files (10)
```
client/src/lib/comms/types.ts
client/src/lib/comms/visibility.ts
client/src/lib/comms/channels.ts
client/src/lib/comms/__tests__/visibility.test.ts
client/src/lib/comms/__tests__/channelMembership.test.ts
client/src/lib/comms/__tests__/softCircleChannel.test.ts
client/src/components/comms/MessagesWidget.tsx
client/src/components/comms/PostsFeed.tsx
client/src/components/comms/MessagesPage.tsx
client/src/components/comms/ChannelCards.tsx
client/src/pages/founder/Messages.tsx
server/commsStore.ts
```

### Edited files (8)
```
packages/telemetry/src/events.ts        (+72 lines: 21 new event types)
client/src/lib/sprint3Seed.ts           (+62 lines: 32 seeded comms events)
server/routes.ts                        (+5 lines: registerCommsRoutes hook)
client/src/App.tsx                      (+2 lines: founder messages route)
client/src/components/AppShell.tsx      (+1 line: founder Messages nav item)
client/src/pages/founder/Dashboard.tsx  (+8 lines: dashboard widgets)
client/src/pages/investor/Dashboard.tsx (+8 lines: dashboard widgets)
client/src/pages/investor/Messages.tsx  (replaced 236 → 10 LOC delegated)
client/src/pages/CompanyDetails.tsx     (+8 lines: channel cards)
client/src/pages/founder/RoundDetail.tsx (+5 lines: soft-circle card)
```

---

## Production migration path

The build is intentionally drop-in shape-compatible with production
Postgres. Migration is two steps:

### 1. Replace `Map<string, Channel>` with Drizzle tables

```ts
// shared/schema.ts (already templated for Sprint 8)
export const channels = pgTable("channels", {
  id: text("id").primaryKey(),
  kind: text("kind").$type<ChannelKind>().notNull(),
  companyId: text("company_id"),
  roundId: text("round_id"),
  participantUserIds: text("participant_user_ids").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id),
  authorUserId: text("author_user_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  starredByUserIds: text("starred_by_user_ids").array().notNull().default([]),
  reactions: jsonb("reactions").$type<Reaction[]>().notNull().default([]),
  replyToMessageId: text("reply_to_message_id"),
  attachments: jsonb("attachments").$type<Attachment[]>(),
  readByUserIds: text("read_by_user_ids").array().notNull().default([]),
});

export const posts = pgTable("posts", { /* same shape */ });
```

The existing zod schemas in `client/src/lib/comms/types.ts` work
unchanged at runtime; `drizzle-zod` will generate insert/select schemas
from the table definitions that match the existing wire shape.

### 2. Replace the in-memory outbox with the existing Sprint 6/7 outbox

The audit chain helpers in `commsStore.ts` already produce the same
hash-chain shape as `packages/telemetry`. On migration, swap the local
`outbox` array for `defaultTelemetryStore.recordEvent` calls — the wire
shape of every event already matches `TelemetryEvent`.

### 3. Auth0 wiring

`actorOf(req)` currently reads `?actorId=` or `x-actor-id` header. In
production, replace with `req.user.sub` from the Auth0 middleware. No
schema changes required.

---

## Risk + privacy posture

- **Privacy by default** — all three visibility toggles default to false
  (R200.gating §6). The resolver returns `[Anonymous Holder]` until both
  a screen name AND an opt-in toggle exist AND a shared-context surface
  exists.
- **Consent at write-time stands** — when a holder revokes visibility,
  their past messages do NOT retroactively become anonymous.
  `visibility.unmasked_message` records the inverse direction (becoming
  visible mid-thread); the audit chain captures both transitions.
- **Anti-poaching** — DMs are gated server-side (403 Forbidden, not
  client-side disabling alone) so a malicious client cannot bypass the
  block.
- **GDPR lawful basis** — explicit consent via the visibility toggles
  satisfies the lawful-basis requirement for processing personal data
  for matchmaking.
- **Author IP + UA capture** — every send/edit/post operation captures
  `req.ip` and `user-agent` into the outbox payload for forensic audit.

---

## Quality gate — final

| Check | Result |
| ---- | ---- |
| 223 prior tests still passing | ✓ |
| 22+ new tests added | ✓ (31 new) |
| 0 console errors on new surfaces | ✓ |
| Visibility resolver: anonymous → DM disabled (UI + server 403) | ✓ |
| Opt-in unmasks future messages but not past | ✓ (consent-at-write-time, captured by `visibility.unmasked_message`) |
| Soft-circle channel updates on sign / withdraw / close | ✓ (proved by 6 unit tests) |
| Cap-table channel updates on cap-table mutations | ✓ (proved by 9 unit tests) |
| Telemetry events fire on every comms action | ✓ (21 event types, 32 seeded events visible at /admin/telemetry) |
| Production migration path documented | ✓ (this file) |

---

## Deployed URL

The site is deployed and rendering live. See the `dea0e0a3-…` asset in
the deploy log for the canonical URL.
