# Harvest: Collective Proven Best Practices
## Reference Document for Sprint 14 Build Subagent
**Version:** 1.0 — Sprint 14 Input  
**Date:** 2026-05-14  
**Sources:** collective_admin_audit.md, collective_communications_audit.md, collective_founder_audit.md, collective_investor_audit.md, capavate_collective_sync_schema.md, capavate_gating_addendum.md, capavate_master_build_spec.md, SPRINT-9 through SPRINT-13 summaries  
**Core thesis:** Capavate's primary value is unlocking cap-table value for founders to identify and scale toward a transaction (M&A, exit, growth round). Collective is the round-outreach amplifier — rounds created in Capavate port to Collective for member visibility.

---

## §1. PAYMENT FLOWS

### 1.1 Stripe Checkout State Machine

**Trigger:** `/collective/#/register/step-5` — $1,200 USD/year (Standard tier), or tier-adjusted amount.

**Stripe elements used:**
- Card number / Expiry / CVC / Cardholder name / Billing address
- Stripe embedded checkout (not hosted payment page)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID` env vars

**Payment tiers (exact from collective_admin_audit.md §10):**
| Tier | Annual Fee |
|------|-----------|
| Standard (Angel Network) | $1,200 USD/year |
| Plus | $2,400 USD/year |
| Individual | $600 USD/year |
| Consortium partner discount | Variable (applied at checkout) |

**State machine (registration → payment → membership):**
```
step-5 loaded → Stripe elements rendered → cardholder submits
  → Stripe tokenizes → backend: create PaymentIntent → payment_method attached
  → Stripe confirms → webhook POST /webhooks/stripe → payment_intents.succeeded
  → collective_memberships.status: 'accepted' → Welcome email dispatched
  → receipt link surfaced on /collective/#/register/pending
```

**Error handling (exact from collective_founder_audit.md §1 validation):**
- Payment failure: Stripe inline error + "Try another card" CTA
- Duplicate application: toast "You already have an active or pending application."
- Idempotency: Payment intent idempotency-key = `application-{userId}-{submittedAt}` (prevents double-charge on retry)

**Referral / Coupon (`?cp=` pattern):**
- URL: `/collective/#/register/step-2?cp={partner_slug}`
- The `?cp=` query parameter pre-fills the REFERRAL / PARTNER CODE field on Step 2
- Discount applied at Step 5 payment step; shown in fee breakdown: "Annual membership · Selected tier · Any consortium partner discount applied"
- Attribution: first-referral-wins lock-once attribution (`referral_record` table)

**"Pay by invoice" path:**
- Admin-approved only (not self-serve)
- Shown as a link below the Stripe form at Step 5

**Stripe webhooks received at `/webhooks/email-events` (for email) and a Stripe-specific webhook endpoint:**
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `customer.subscription.deleted` (for renewals)
- Bounce/failure: `email_enabled = false` on the recipient's notification preferences on hard bounce or complaint

**Invoice / Receipt:**
- Receipt link surfaced at Step 7 (`/collective/#/register/pending`)
- Text: "Your first month's access starts today." on acceptance

**Renewal grace period:** `nonPaymentGraceDays = 30` (admin-configurable via `/admin/lifecycle-policy`). After 30 days: `collective_memberships.status` → `'suspended'`. Admin can restore manually: `status = 'active'`.

**Lapse-and-restore flow:**
1. `renewal_due` notification fires 30 days before expiry
2. Member ignores → `membership.lapsed` notification fires
3. 30-day grace window → `status = 'suspended'` → sidebar badge "Membership suspended" (red)
4. All Collective features locked (deal room gated, DM blocked, Collective toggle disappears from nav)
5. Admin or member-initiated payment → `status = 'active'` → `collective.eligibility_gained` notification

**Proration:** Not explicitly defined for mid-year tier changes. Stripe prorates automatically if switching between subscription plans.

---

## §2. VISUAL LOOK & FEEL

### 2.1 Color Palette (exact design tokens from collective_admin_audit.md Appendix A)

| Token | Hex | HSL | Role |
|-------|-----|-----|------|
| Navy | `#1C2B4A` | hsl(219, 45%, 20%) | Primary text, headers, navbar |
| Hydra Teal | `#01696F` | hsl(184, 98%, 22%) | Links, CTAs, accents, active states |
| Plum | `#9D174D` | hsl(333, 75%, 35%) | DSC Committee surfaces, note callouts |
| Reject | `#B33A2B` | hsl(7, 61%, 43%) | Destructive states, error alerts, warnings |
| Neutral Light | `#F8F9FA` | — | Page backgrounds |
| Neutral Mid | `#E5E7EB` | — | Borders, dividers |
| Neutral Dark | `#374151` | — | Secondary text |

**Note:** This palette is identical to the Capavate rebuild palette (Sprint 11 light-only palette lock). Cross-reference: `client/src/index.css` has `.dark {}` removed.

### 2.2 Typography

- **Primary font:** Not explicitly named in audit; shadcn/ui default (Geist or Inter assumed from R200 spec)
- **Header hierarchy:** H1 (company name on deal banner), H2 (section titles), H3 (card titles)
- **Nav items:** Regular weight, 14px size
- **Badge/pill text:** 12px, font-medium
- **Timestamps:** 12px, gray (#374151 Neutral Dark), relative format ("14d ago", "Apr 19")
- **Message body:** 14px, #374151

### 2.3 Spacing System

- **Page gutter:** 24px (standard Tailwind p-6)
- **Card border-radius:** 8px (rounded-lg in shadcn/ui)
- **Avatar sizes:** 40px (message lists), 48px (post cards), 64px (company header banner)
- **Badge/pill:** pill shape (rounded-full), horizontal padding 8px
- **Three-column dashboard grid:** ~23% / ~55% / ~22%

### 2.4 Button Hierarchy (exact labels from collective_communications_audit.md)

| Tier | Style | Examples |
|------|-------|---------|
| Primary CTA | Hydra Teal filled, pill | "Submit Soft-Circle", "Submit", "Join Angel Network" |
| Destructive | Reject red outline | "Decline", destructive actions |
| Secondary | Gray outline pill | "Follow [Name]", "Request More Information" |
| Comms action | Red/coral filled pill | "💬 View All Messages" |
| Navigation | Dark outline | "← Previous", "Next →" |
| Company CTA | White outline (on banner) | "💬 Message" |

**Button color note:** The "View All Messages" and "Create Investor Report" use red/coral (#E94040 approx) — this is the Reject token applied to action buttons where the action is urgent/prominent. NOT a destructive action; this is a UX pattern to draw attention.

### 2.5 Micro-animations

Not explicitly specified; standard shadcn/ui transition durations apply (150ms ease-in-out for hover, 200ms for modal open).

### 2.6 Card Patterns

**Post card (exact structure from collective_communications_audit.md):**
```
┌─────────────────────────────────────────────────────────┐
│ [Avatar 48px] [Name — bold]    [Timestamp]    [•••]     │
│               [Network badge pill — gold]                │
│               [Role badge pill — green]                  │
│               [📍 Location]                              │
│                                                          │
│  [Post content text / image]                            │
│                                                          │
│  👍 [count]  💬 [count]  ↗ [share]   [Follow Name]btn  │
│                                    OR [Following] btn    │
└─────────────────────────────────────────────────────────┘
```

**Company deal card (deal room):**
- Full-width dark banner (brand_color from company profile)
- Auto-tier badge: Watch / Qualified / Featured / Priority
- Company logo circle (~64px) + name H1 + tagline + tags row

**Empty state pattern:** Illustration (speech bubble emoji) + text ("No conversations yet") — icon + prose, no just-text empty states.

**Loading skeleton:** Not explicitly documented; inferred from shadcn/ui patterns — use gray pulse skeleton blocks matching card dimensions.

### 2.7 Network Badge Variants (exact from collective_communications_audit.md §7)

| Badge text | Color | Context |
|-----------|-------|---------|
| "🏅 Capavate Angel Network" | Gold/orange | Angel network member on posts |
| "🏅 Capavate Angel Network - california" | Gold/orange | Regional variant |
| "💼 Investor" | Green | Investor role on posts/DMs |
| "💼 Social Network Member" | Green | Social-only member |
| "Member of Capavate Angel Network" | Green pill, star icon | Sidebar identity panel |
| "Investor: NOT on a cap table" | Red badge | Sidebar status — no cap-table position |
| "Accredited Investor" | Subtitle | Role subtitle in sidebar |
| "KYC: Pending" | Amber | KYC state badge |
| "Membership suspended" | Red | Lapsed membership |

### 2.8 Icon Inventory (from collective_communications_audit.md §8)

| Icon | Meaning |
|------|---------|
| 💬 | Messaging, communication |
| ★ (hollow) | Star/pin a conversation |
| 🔴 tack | Pinned/starred item |
| 🔄 | Refresh feed |
| 👁 (red) | View company detail |
| 👁 + slash | Profile visibility off |
| ✓✓ | Read receipt (double-checkmark) |
| 😊 | Emoji picker |
| 📤 | Send message |
| ❤️ | Mark Interested / express interest |
| 🔒 | Secure/restricted access |

---

## §3. SOFT-CIRCLE PROCESS & LOGIC

### 3.1 10-State Machine (from collective_investor_audit.md §TAB 7)

```
pending → viewed → accepted | declined | soft_circled
accepted → soft_circled | revoked (founder)
soft_circled → confirmed (founder) | revoked (founder)
confirmed → signed (system, after e-sig)
signed → funded (system, after close)
funded → [terminal — "Funded. This round is closed."]
expired → [terminal — red banner]
revoked → [terminal — red banner]
```

**State banners (exact copy from collective_investor_audit.md):**
| Status | Banner text |
|--------|-------------|
| `pending` | "You have not yet viewed this deal" (info) |
| `viewed` | "You have reviewed this deal. Make your decision below." |
| `accepted` | "You have indicated acceptance. Complete your soft-circle below." |
| `declined` | "You declined this invitation. Contact the founder to re-open." |
| `soft_circled` | "Your soft-circle is submitted. Waiting for founder confirmation." (green) |
| `confirmed` | "The founder has confirmed your participation. Documents will follow." |
| `signed` | "You have signed. Awaiting funding confirmation." |
| `funded` | "Funded. This round is closed." |
| `expired` | "This invitation has expired." (red) |
| `revoked` | "This invitation has been revoked." (red) |

**Auto-transition:** `pending → viewed` fires automatically when the investor opens the "Your Decision" tab.

### 3.2 Soft-Circle Form Fields (exact)

| Field | Type | Notes |
|-------|------|-------|
| INVESTMENT AMOUNT | numeric + currency selector | Currency: USD/CAD/GBP/EUR/SGD/HKD/AUD (7 options) |
| SOFT-CIRCLE TYPE | radio group | "Definite commitment" / "Indication of interest" / "Conditional on due diligence" |
| PERSONAL NOTE TO FOUNDER | textarea | Max 500 chars; placeholder: "Share your conviction, questions, or any conditions..." |

**Submit CTA:** "Submit Soft-Circle" — Hydra Teal primary  
**Decline CTA:** "Decline" — Destructive red outline  
**API:** `PATCH /api/rounds/{round_id}/invitations/{invitation_id}/decision`

### 3.3 MIM (Members Interested in this Deal) Aggregation

Located below the personal decision section in "Your Decision" tab:
- Header: "Members interested in this deal"
- Count: "N members have soft-circled"
- Member chips: anonymized screen names (or real names if cap-table rules allow)
- Total: "$N total indicated"

**Partial confirmation handling:** If investor indicates $50k but founder confirms $30k, the `commitment_amount` in `round_participants` reflects the confirmed ($30k), not the indicated ($50k). The `soft_circle_amount` field retains the original indicated amount for audit/history.

**Over-subscription:** When `sum(soft_circle_amount) > round_size`, the founder can selectively confirm investors. Unconfirmed soft-circles stay in `soft_circled` state; `round_size_closed` tracks the confirmed total.

### 3.4 Expiry Rules

- Default: 14 days for soft-circle expiry (`softCircleExpiryDays = 14`)
- Configurable via `/admin/lifecycle-policy` → Platform Defaults
- Invitation expiry default: 30 days (founder can configure per round)
- Warning email: 48hr before expiry (`invitation_expiry_warning` template)

### 3.5 Multi-Currency Display

- Amounts stored in originating currency
- USD-denominated preferred for Collective display (Stripe presentment currency)
- 7 currencies shown in soft-circle form: USD/CAD/GBP/EUR/SGD/HKD/AUD
- `round_participants.commitment_amount` + `round_participants.currency` stored together

---

## §4. CRM PATTERNS

### 4.1 Personal CRM Schema (`/collective/#/crm`)

Tables: `pcrm_contacts`, `pcrm_notes`, `pcrm_tasks`

**Contact model:**
```typescript
interface PcrmContact {
  id: string;
  userId: string;           // owner (the Collective member)
  name: string;
  role: "founder" | "investor" | "co_investor" | "ecosystem" | "partner" | "other";
  company: string;
  email: string;
  linkedIn: string;
  tags: string[];           // free-text multi-tag chips
  dealLinks: string[];      // deal IDs this contact is associated with
  pipelineStage: PcrmPipelineStage;
  lastTouchpointAt: string; // ISO-8601
  createdAt: string;
}

interface PcrmNote {
  id: string;
  contactId: string;
  body: string;             // free text, no max observed
  type: "call" | "email" | "meeting" | "message" | "other";
  timestamp: string;        // auto-set to now
}

interface PcrmTask {
  id: string;
  contactId: string;
  title: string;
  dueDate: string;          // ISO date
  priority: "low" | "medium" | "high";
  status: "todo" | "in_progress" | "done";
}
```

**Contact list (left panel):**
- Search: "Search by name, firm, or tag..."
- Filter tabs: All / Founders / Investors / Co-investors / Partners
- Contact row: Avatar + Full name + Company/Firm + Last touchpoint date + Tag chips
- "Add Contact" CTA: "+ Add contact" (inline form or modal)

### 4.2 Pipeline Kanban Stages (Investor CRM)

Investor side (`/collective/#/crm`):
```
Lead → Met → Diligence → Soft-Circle → Invested → Exited
```

Founder side (`/founder/crm`):
```
Lead → Engaged → Soft-Circle → Invested → Long-term Partner
```

### 4.3 Connections Lane Structure (`/collective/#/connections`)

| Lane | Content |
|------|---------|
| **Cap Table Connections** | Co-investors on the same cap table(s) |
| **Round Connections** | Co-participants in the same active round |
| **DSC Connections** | Fellow DSC committee members |
| **Angel Network Connections** | General Capavate Angel Network connections |
| **Social Connections** | Follows / followers in the social feed |

**Contact card in connections:**
- Avatar (48px circle) + Screen name + Type badge ("Investor" / "Founder" / "DSC Member" / "Partner")
- Chapter badge (regional chapter)
- Shared context: "Co-invested in [Company]" / "Same round: [Round]"
- "Message" CTA → opens DM thread
- "Add to CRM" CTA → adds to PersonalCrm

### 4.4 Activity Log per Contact

Auto-pulled from messages, soft-circles, term-sheets, and posts into the per-contact activity log. This is the `pcrm_notes`-adjacent derived timeline, not the manually logged notes.

### 4.5 Deal Association Rules

- A CRM contact can link to multiple deals (dealLinks[] array)
- When a Collective member is on the same round as a CRM contact, the round link auto-populates
- "Open thread" CTA → opens DM or cap-table channel for that contact

---

## §5. COMMUNICATION PATTERNS

### 5.1 Channel Topology (5 channel kinds from commsStore.ts)

```
dm                 — 1:1 DM between two users
cap_table          — per-company group (founder + visible cap-table holders)
soft_circle        — per-round group (founder + soft-circlers; lifecycle-bound)
company_followers  — posts from a company to its followers
network            — user's personal post feed (network connections)
```

### 5.2 DSC Screening Rooms (`/collective/#/screening/:review_id`)

- Per-company gated rooms for DSC committee members only
- Show composite/mna/round scores (the three scores visible to DSC)
- Dsc vote: `Recommend / Neutral / Pass` + 5-dimension scoring
- Recap downloadable after review from `/collective/#/recaps`

### 5.3 MIM Section (Members Interested in this Deal)

Documented in §3.3 above. Lives in "Your Decision" tab below the personal soft-circle form. Aggregated read-only view: shows how many Collective members have soft-circled, total indicated amount, and anonymized member chips.

### 5.4 Soft-Circle Threads

When investor submits a soft-circle, a chronological thread between investor and founder opens in the "Your Decision" tab. This is distinct from the general DM thread. Founder can respond to the soft-circle note directly in this thread.

### 5.5 Broadcast Composer (Dashboard)

- Post composer: "Start a post" placeholder input + current user avatar + 🔄 refresh icon
- Visibility selector (in rebuild): Network / My company followers / Both
- Feed filter tabs: All / ★ Starred / ↓ Newest
- On submit: fires `post.created` telemetry event

### 5.6 Per-Deal Communication Channels

The "💬 Message" button in the company deal banner opens a DM thread between the investor and the founder. This is separate from:
- Cap-table channel (all visible cap-table members)
- Soft-circle thread (per-round, lifecycle-bound)
- DSC channel (DSC members only)

### 5.7 Monthly Meeting Communications (`/collective/#/meetings`)

| Element | Details |
|---------|---------|
| Meeting card | Date · Zoom join URL · Agenda items · Recording link (post-meeting) |
| RSVP controls | "Attending" / "Not attending" radio |
| RSVP cutoff | `rsvpCutoffHours` before meeting (admin-configurable) |
| Recording library | Post-meeting recording archive |

### 5.8 Ask Expert (`/collective/#/ask`)

| Element | Details |
|---------|---------|
| Question composer | "What would you like to ask?" textarea + category select (Legal / Tax / Accounting / M&A / Other) |
| Expert routing | Routed to consortium partner experts by category |
| Answer attribution | Expert name + firm name (NOT tier in member view) |
| Outcome log | "/collective/#/outcome-log" — past answers archive |

---

## §6. KYC / ACCREDITATION — JURISDICTION-ADAPTIVE

### 6.1 Registration Step 4 — Jurisdiction Variants (exact from collective_investor_audit.md §step-4)

| Jurisdiction | Fields |
|-------------|--------|
| **United States** | Annual income > $200k individual / > $300k joint (3-year average) OR net worth > $1M excl. primary residence OR third-party CPA/attorney letter upload |
| **Canada** | Net income > $200k CAD (individual) OR net assets > $1M CAD [NI 45-106] |
| **United Kingdom** | HNW: income > £100k OR assets > £250k · OR Sophisticated Investor self-cert checkbox |
| **EU (MiFID II)** | Professional client declaration checkboxes per MiFID II criteria |
| **Singapore** | Accredited Investor declaration per SFA §4A — income or asset threshold checkboxes |
| **Hong Kong** | Professional Investor declaration per SFO s.1 Part 1 Sch 1 |
| **Other jurisdictions** | Generic accreditation self-declaration checkbox + note field |

**Note:** India (IN) and Japan (JP) + Australia (AU) use "Other jurisdictions" generic form in the Collective registration (full 9-region accreditation variants are in Capavate's investor profile, not Collective's registration).

**Stored as:** `accreditation_status` — `verified` / `self-cert` / `pending` / `rejected`

### 6.2 KYC Document Upload (Step 3)

| Field | Notes |
|-------|-------|
| PASSPORT (or Gov ID) | PDF/JPG/PNG, max 10MB |
| PROOF OF ADDRESS | Bank statement/utility bill/gov letter, issued within 90 days |
| ADDITIONAL DOCS | Optional multiple upload |

**KYC Provider banner copy:**
> "Your documents are processed securely via [Persona / Sumsub / Onfido / Veriff]. Capavate and our KYC provider are both bound by data processing agreements under GDPR, PIPEDA, and applicable local law."

**Sanctions check notice:**
> "We conduct PEP and sanctions screening against OFAC, UK HMT, EU consolidated, UN, MAS, and HKMA lists. Screening is automatic on document submission."

---

## §7. MEMBER TIER HANDLING

### 7.1 Tier Model

| State | `collective_memberships.status` | Effect |
|-------|--------------------------------|--------|
| Applied | `submitted` | Registration wizard visible; no Collective access |
| Under review | `reviewing` | Status badge "Under Review" (amber); no Collective access |
| Accepted | `accepted` | Welcome email dispatched |
| Active | `active` | Full Collective access; `nonPaymentGraceDays` timer starts |
| Suspended | `suspended` | All features locked; sidebar badge "Membership suspended" (red); Collective toggle disappears from nav |

### 7.2 Tier Transitions

- `submitted → reviewing`: admin opens the application
- `reviewing → accepted`: admin approves + Stripe payment confirmed
- `reviewing → rejected`: admin rejects → applicant notified
- `reviewing → waitlisted`: deferred
- `active → suspended`: after `nonPaymentGraceDays = 30` of non-payment
- `suspended → active`: admin manual restore OR member completes payment
- `accepted → active`: auto-transition on payment confirmation

**Member tier (pricing tier):** `Individual / Plus / Standard` — admin-managed via Lifecycle Policy. Tier determines annual fee amount.

### 7.3 Renewal Grace Period (exact values from collective_admin_audit.md §10.3)

- `nonPaymentGraceDays = 30` (admin-tunable)
- Warning email: `membership.renewal_due` — 30 days before expiry date
- `membership.lapsed` notification fires when grace period begins
- After 30 days: `status = 'suspended'`

### 7.4 Eligibility Re-Check on Membership Events

- On suspension: `investorOnCapTable` badge re-appears (red "NOT on a cap table")
- On restoration: `eligibility.recomputed` event fires → badge resolves

---

## §8. EMAIL TEMPLATE TONE & STRUCTURE

### 8.1 Template List (exact from collective_admin_audit.md §5.2)

| Template ID | Trigger | Key Variables |
|-------------|---------|--------------|
| `round_invitation` | Invitation created/resent | company_name, founder_name, round_name, instrument, personal_message, cta_url, expiry_date |
| `invitation_accepted` | Investor accepts | investor_name, investor_email, company_name, round_name, committed_amount |
| `invitation_declined` | Investor declines | investor_name, company_name, round_name, decline_note |
| `soft_circle_submitted` | Investor soft-circles | investor_name, committed_amount, currency, round_name |
| `invitation_expiry_warning` | 48hr before expiry | company_name, round_name, expiry_date, cta_url |
| `round_closed` | Round transitions to closed | company_name, round_name, amount_closed, security_type, cap_table_cta |
| `notification_digest` | Batch notification delivery | Batch of notification items |
| `collective_welcome` | `status = 'active'` | Member name, deal room CTA, profile CTA, receipt link |
| `membership_review` | Application submitted | Application summary, timeline, edit link |
| `membership_approved` / `_rejected` | Admin decision | Status, next steps |
| `kyc_update` | KYC status change | New status, action required |
| `form_d_reminder` | 10 days before 15-day deadline (US) | Filing deadline date, EDGAR link |
| `emi_notification_reminder` | EMI grant + 30/7/1 day (UK) | Grant date, HMRC deadline, ERS link |
| `83b_election` | Within 24h of early exercise | Exercise date, 30-day deadline, instructions |

### 8.2 Envelope Variables (Handlebars)

```handlebars
{{recipient_name}}      — first name of recipient
{{recipient_email}}     — email address
{{company_name}}        — company name
{{cta_url}}             — CTA link (always token-bound for investor links)
{{platform_name}}       — "Capavate" or "Capavate Collective"
```

### 8.3 Email Architecture (async pipeline)

```
Event trigger
→ notifications table row (email_enabled=true)
→ BullMQ email queue
→ EmailSenderProvider (AWS SES / Postmark / Resend — switchable via EMAIL_PROVIDER env)
→ email_outbox entry
→ delivery webhook
→ email_events row
```

**SLA:** Email dispatch within 60 seconds of trigger event.  
**Bounce handling:** Hard bounce or complaint → `email_enabled = false` on recipient preferences.

### 8.4 Subject Line Patterns (inferred from template names)

- Transaction trigger: "[Company] has invited you to their [Round]" — personal, company-first
- Status update: "Your Capavate Collective application is under review"
- Urgency: "Your invitation to [Company] expires in 48 hours"
- Welcome: "Welcome to Capavate Collective — your membership is now active"

---

## §9. NOTIFICATION CADENCE

### 9.1 Notification Architecture (3 delivery channels)

```
Event emitted
→ notifications row inserted
→ BullMQ fan-out:
    ├─ In-app: SSE (GET /api/notifications/stream) → bell icon unread count
    ├─ Email: email_outbox entry (if email_enabled=true)
    └─ Web push: Web Push API → push_subscriptions table (opt-in)
```

**Bell icon:** 🔔 with numeric unread count badge. SSE stream pushes `notification` events (new item) and `ping` (keepalive every 30s).

### 9.2 Full NotificationKind List (from collective_admin_audit.md §6.5)

```typescript
type NotificationKind =
  | 'round.invitation_received'       // Investor: you received an invitation
  | 'round.invitation_accepted'       // Founder: investor accepted
  | 'round.invitation_declined'       // Founder: investor declined
  | 'round.soft_circle_received'      // Founder: soft-circle submitted
  | 'round.document_ready_to_sign'    // Investor: docs ready to sign
  | 'round.document_signed'           // Founder: investor signed
  | 'round.closed'                    // All round_participants: round closed
  | 'dataroom.access_granted'         // Investor: dataroom access granted
  | 'dataroom.document_uploaded'      // Investor: new document
  | 'investor_report.published'       // Investors: new report published
  | 'message.received'                // User: new DM received
  | 'collective.eligibility_gained'   // User: now eligible for Collective
  | 'collective.membership_approved'  // User: membership accepted
  | 'spv.launched'                    // Collective members: new SPV live
  | 'spv.subscription_countersigned'  // Investor: SPV subscription countersigned
  | 'dsc.company_assigned'            // DSC member: company assigned for review
  | 'cap_table.drift_detected'        // Admin: nightly reconciliation found drift
  | 'compliance.hold_placed'          // Founder/Admin: compliance hold
  | 'kyc.status_changed'              // Member: KYC status update
  | 'membership.renewal_due'          // Member: renewal in 30 days
  | 'membership.lapsed';              // Member: grace period started
```

**21 notification kinds total (15 core + 6 Collective-specific).**

### 9.3 Per-User Preferences

- `GET /api/notifications/preferences` → NotificationPreferences object
- `PATCH /api/notifications/preferences` → update per-kind email/push toggles
- In-app channel CANNOT be disabled (always on)
- Email and Push can be toggled per-kind
- Settings page (D10): 10 notification toggles across categories

### 9.4 Digest Batching

- `notification_digest` template handles batched notifications
- Quiet hours: not explicitly documented; no frequency-cap system defined
- Critical bypass: `cap_table.drift_detected`, `compliance.hold_placed` — these should bypass any future quiet-hours or batching system

---

## §10. ACCESSIBILITY PATTERNS

### 10.1 Focus Rings

- shadcn/ui default focus rings; Tailwind `focus-visible:ring-2 focus-visible:ring-offset-2` convention
- Hydra Teal ring on focusable elements (matches brand accent)

### 10.2 ARIA Conventions

- Role badges: `aria-label="Member type: Accredited Investor"` pattern
- Modal dialogs: `role="dialog"` + `aria-labelledby` (shadcn/ui Dialog provides this)
- Notification bell: `aria-label="Notifications, N unread"` with dynamic count

### 10.3 Keyboard Shortcuts

- Message send: Cmd+Enter shortcut (from `MessagesPage.tsx` Sprint 9 implementation)
- Modal close: Escape key (shadcn/ui Dialog default)

### 10.4 Skip Links

- shadcn/ui based; standard skip-to-main-content link in `AppShell.tsx`

### 10.5 Screen Name Privacy Note (verbatim from collective_communications_audit.md §Surface 8)

> "NOTE: Your screen name will be visible to all shareholders on the same cap table and across all social media sections of Capavate.com. Your portfolio companies, where you are a shareholder, will have access to your real name."

---

## §11. ROUND → COLLECTIVE PORTING

### 11.1 Which Fields Appear in Collective Deal Room

When a founder creates a round in Capavate, the following fields are ported to the Collective deal room via the `company.profile.updated` and related outbox events:

**Tab 5: Round Terms (from collective_investor_audit.md §TAB 5)**

| Field | Notes |
|-------|-------|
| Instrument Type | SAFE / Convertible Note / Preferred Equity / Common Equity |
| Round Name | Pre-Seed / Seed / Series A / etc. |
| Pre-Money Valuation | Currency |
| Round Size (target) | Currency |
| Round Size Closed | Running soft-circle total |
| Discount Rate | % (for SAFEs/notes) |
| Valuation Cap | Currency (for SAFEs/notes) |
| Investor Rights | Pro-rata / ROFR / Co-Sale / Board Seat / Observer |
| Expiry Date | Invitation expiry |
| Lead Investor | Name + designation |
| Co-investors | Array of names |

**Fields that are Capavate-private (NOT ported):**
- `soft circles` (detail; only aggregate `round_size_closed` shows)
- `invitations table` (pre-graduation activity)
- `dataroom contents` (per-investor grants)
- `internal CRM notes`
- `commitment amounts per investor`

### 11.2 Who in Collective Sees a Round

**Visibility gating (from collective_admin_audit.md §11):**
- All Collective members can see the deal in the deal room (`/collective/#/deals`)
- `auto_tier` badge (Watch/Qualified/Featured/Priority) visible to all members
- Full composite/mna/round scores visible to DSC members and admins only
- Round Terms tab: visible to all Collective members who have access to the deal card
- Documents tab: gated per investor via `dataroom_grants`

**Member tier filter:**
- No tier-based filtering of which deals are visible in v1.0
- All `active` Collective members see all deals; the auto_tier badge guides priority
- Admin can set `deal_stage_override` to manually promote/demote a deal's tier

### 11.3 How Members Express Interest

Collective members express interest in a round via the "Your Decision" tab (`/collective/#/deals/:company_id` → Tab 7). The full 10-state soft-circle flow applies (see §3.1).

Additionally, from the Deal Room list, members can click "❤️ Mark Interested" — this adds the company to their watchlist and may signal intent without formally entering the soft-circle flow.

### 11.4 How Interest Flows Back to Founder CRM

**Interest-to-CRM pipeline:**

1. Collective member submits soft-circle in "Your Decision" tab
2. `soft_circle.submitted` event emitted → Capavate receives via bridge inbound
3. Capavate creates/updates `round_participants` record for this investor
4. `soft_circle_submitted` notification fires to founder: `round.soft_circle_received`
5. Founder's CRM (`/founder/crm`) shows the investor in "Soft-Circle" pipeline stage
6. MIM section on the deal card updates: "+1 member, $N total indicated"
7. Founder Investor CRM shows: soft-circle history, M&A signals count, thread link
8. Soft-circle channel (`soft_circle` ChannelKind) opens for this investor ↔ founder pair

**Capavate endpoint wired:** `PATCH /api/rounds/:rid/invitations/:iid/decision` triggers all of the above.

---

## §12. CRM/COMMS THESIS DEEP-DIVE — TRANSACTION SCALING

### 12.1 What Collective Does That Capavate Could Port

#### A. Warm-Intro Graph (via Connections + Consortium)

Collective's connections surface (`/collective/#/connections`) provides a 5-lane co-investor/network map. The **Cap Table Connections** lane shows every investor who is on the same cap table as the requesting member. This is inherently a warm-intro graph: "investor A and investor B are both on NovaPay's cap table — they have a pre-existing relationship context."

**Port opportunity:** Expose this warm-intro graph to the founder-side CRM. When a founder wants an intro to an acquirer or a specific fund, the founder's CRM should show: "Your investor [GreenwoodCap] is connected to [Target Fund] via the Cap Table Connections graph."

#### B. Co-Investor Network Mapping

From the Connections lanes (Round Connections, Angel Network Connections), Collective members see their co-investors across ALL their deals — not just within one company. This cross-portfolio co-investor graph is powerful for transaction scaling: a strategically connected investor in the founder's cap table may have relationships with acquirers or M&A advisors.

**Port opportunity:** In the founder InvestorCRM (`/founder/crm`), add a "Network Reach" panel per investor contact showing: how many Collective deals this investor is active in, which sectors, which co-investors they share.

#### C. M&A Buyer Shortlist (from AlgorithmsProvider → mnaScore)

Collective's AlgorithmsProvider computes `mnaScore` using "strategic buyer landscape" and "exit comparables" as inputs. The investor-side M&A Intelligence panel (`/collective/#/ma-intelligence`) shows per-portfolio company: acquirer-fit score 0-100, top-3 strategic-buyer shortlist, comparable exits 24mo, revenue multiple range.

**Already in Capavate:** Sprint 10 wired `maIntelligenceStore.ts` with `GET /api/investor/ma/intelligence/:companyId` returning acquirer-fit scores, buyer shortlist, and comps.

**Gap for transaction scaling:** The founder does NOT currently see the Collective-derived M&A buyer shortlist for their own company. Port path: `Collective → Capavate` inbound event `ma.intelligence_rankings` (already in bridgeStore as an inbound event type) should write the acquirer shortlist into the founder's M&A Intelligence panel.

#### D. Expert Advisor Connections (Ask Expert)

The "Ask Expert" surface routes founder/investor questions to consortium partner experts by category (Legal / Tax / Accounting / M&A / Other). For a founder scaling toward a transaction, this is a direct connection to M&A advisors.

**Port opportunity:** Expose a "Request M&A consultation" CTA in the founder CRM → routes to the Ask Expert surface pre-populated with "M&A" category and the company's `acquirerProfile` field as context.

#### E. DSC Score → Founder Feedback

DSC committee members score companies on 5 dimensions. Currently: `Collective → Capavate` via `dsc.scores` inbound event. Founders should see a sanitized summary: "Your company scored Qualified tier — top areas: IP defensibility, team execution." This closes the feedback loop between screening and transaction preparation.

### 12.2 What Capavate Already Has (vs. Gaps)

**Already built (Sprint 10-12):**
- Investor CRM (`/investor/crm`): `pcrm_contacts`, `pcrm_notes`, `pcrm_tasks`, 6-stage pipeline
- Founder InvestorCRM (`/founder/crm`): 5-stage pipeline, per-investor M&A signals count, bulk broadcast
- M&A Intelligence panel: acquirer-fit score, top-3 buyer shortlist, comp exits
- Bridge inbound: `dsc.scores`, `ma.intelligence_rankings`, `partner.introduction_status`

**Gaps for transaction scaling:**
1. **Founder cannot see Collective-derived DSC feedback** — it's received via bridge but not surfaced in founder UI
2. **No "request warm intro" workflow** in founder CRM — founder cannot ask a cap-table investor to make a specific introduction to a target acquirer
3. **No transaction-prep checklist thread** — no structured comms surface where the founder and cap-table investors work through a transaction checklist together
4. **No segmented broadcast to cap-table cohort** — founder can broadcast to individual investors via bulk message, but there's no "broadcast to all investors in a specific region or series" with a transaction-milestone trigger
5. **No "cap-table milestone" broadcast** — when a founder closes a new round, there's no automated broadcast to the cap table: "NovaPay closed Series A — your ownership is now 4.2%"

### 12.3 Communication Channel Ideas for Sprint 14

1. **Cap-table milestone broadcast:** Founder triggers a broadcast to all cap-table members when a major milestone hits (round closed, acquirer NDA signed, M&A process launched). Template: `round.closed` notification already fires; extend to include a free-text milestone message from the founder.

2. **Segmented cap-table broadcast:** Founder selects a cohort of cap-table investors (by region, series, or role) and sends a targeted message. Already partially in Founder InvestorCRM (`bcOpen` state in `CRM.tsx`); needs to be extended to use cap-table segment data from the engine.

3. **"Request intro" workflow:** Founder selects a cap-table investor in their CRM and sends: "Can you introduce me to [Target]?" This opens a structured thread with: Founder message → Investor can accept/decline → If accepted, intro message template auto-populates. Emits `crm_intro_requested` telemetry event.

4. **Transaction-prep checklist thread:** A dedicated comms channel type `transaction_prep` that the founder creates when they enter M&A mode. Checklist items (from M&A Intelligence fields) become thread anchors: "IP due diligence readiness", "Customer contracts readiness", etc. Cap-table investors with `boardSeatPreference = true` are auto-added as members.

5. **Collective DSC feedback relay:** When `dsc.scores` inbound event fires, create a notification for the founder: "Your company received a DSC review — view summary." The summary shows the tier and top/bottom dimensions without revealing individual DSC member votes.

### 12.4 Round Porting Flow (Capavate → Collective → Interest → CRM)

**Step-by-step (canonical flow):**

```
Step 1: Founder creates round in Capavate (/founder/rounds/new)
        → round record created in Capavate
        → round_participants table initialized

Step 2: Round data syncs to Collective via outbox
        → Event: company.profile.updated (includes lastRoundDate, lastRoundType, lastValuation)
        → Collective deal card at /collective/#/deals/:company_id updates
        → "Round Terms" tab (Tab 5) populated with instrument, valuation, size, terms

Step 3: AlgorithmsProvider recomputes scores
        → composite_score / mna_score / round_score updated
        → auto_tier badge updates on deal card (Watch/Qualified/Featured/Priority)

Step 4: Collective members browse deal room
        → All active members see the company deal card
        → DSC members see full scores; regular members see auto_tier label
        → "❤️ Mark Interested" adds to watchlist (no formal commitment)

Step 5: Member expresses formal interest via "Your Decision" tab
        → soft_circle form submitted → state: soft_circled
        → API: PATCH /api/rounds/:rid/invitations/:iid/decision
        → Event: soft_circle.submitted → bridge outbound to Capavate

Step 6: Capavate receives interest via bridge inbound
        → round_participants record created/updated
        → round.soft_circle_received notification → founder notified
        → MIM section on Collective deal card updates: +1 member, +$N

Step 7: Founder CRM updates
        → investor appears in Soft-Circle stage of Founder InvestorCRM
        → soft-circle thread opens between founder and investor
        → Founder confirms or declines: PATCH /api/rounds/:rid/invitations/:iid/decision
        → state: confirmed → investor notified

Step 8: Deal progresses
        → signing_open → investor signs → funded
        → cap_table.mutated event → eligibility.recomputed fires
        → investor now "on cap table" → Collective badge resolves
        → cap-table channel opens for this investor + founder
```

### 12.5 Capavate↔Collective Member-Status Integration

**When cap-table investor becomes a Collective member:**

1. Investor accepts round invitation on Capavate (`round_participants.status = 'funded'`)
2. `cap_table.mutated` event fires → `eligibility.recomputed` event
3. Collective eligibility worker sets `eligibilityFlags.investorOnCapTable = true`
4. `collective.eligibility_gained` notification fires to investor
5. Investor applies to Collective via `/investor/apply-to-collective` (7-step wizard)
6. Admin approves → `collective_memberships.status = 'active'`
7. `collective_welcome` email dispatched

**What updates in the Founder CRM when this happens:**
- The investor's contact record in the Founder CRM (`pcrm_contacts` or `founder/investor-crm`) gains a "Collective Member" badge
- The investor's CRM stage can now show "Invested + Collective Member" combined status
- Cap-table channel membership is confirmed (the investor is now visible in the cap-table channel with their screen name, if opted in)
- Founder sees in the CRM: "This investor is also a Capavate Collective member — their Collective connections are available for warm introductions"

**What updates in the Investor CRM when a Collective member becomes a cap-table investor:**
- The portfolio company in the investor's Capavate side (`/investor/companies`) is now linked to the Collective deal card
- `My Investments` (`/collective/#/investments`) shows the confirmed position
- Cap-table channel opens (if both founder and investor have screen names + co-member visibility opted in)
- The investor's `pcrm_contacts` can auto-suggest: "Add [Founder name] as a CRM contact based on shared cap table"

---

*End of harvest_collective_bp.md*
