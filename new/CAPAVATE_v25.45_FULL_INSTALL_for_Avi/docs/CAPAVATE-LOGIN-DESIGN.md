# Capavate Login + Entitlement Architecture (Sprint 15 design)

**Status**: Design walkthrough for review BEFORE implementation.
**Anchored on**: User-stated rules for Investors (a-e) and Founders (a-b).

---

## Part 1 — Persona model (what each user is)

Every authenticated user has a `userId` and a set of dynamic role flags computed at every request:

```
UserContext {
  userId: string
  identity: { email, name, screenName }

  // FOUNDER role
  founderOf:        Company[]              // empty if not a founder
  activeCompanyId:  string | null          // currently selected company

  // INVESTOR role
  invitedRounds:    InvitedRound[]         // open invitations not yet acted on
  capTablePositions: CapTablePosition[]    // funded positions (can be 0+ companies)
  isInvestorOnAnyCapTable: boolean         // = capTablePositions.length > 0

  // COLLECTIVE role (separate from cap-table)
  collectiveMembership: {
    status: 'none' | 'applied' | 'pending' | 'active' | 'suspended' | 'lapsed'
    role:   'standard' | 'dsc' | 'consortium_partner' | null
    expiresAt: Date | null
  }

  // ADMIN role
  isAdmin: boolean
}
```

Roles are **non-exclusive**. The same user can simultaneously be:
- Founder of 3 companies
- Investor on 5 other cap tables
- Active Collective member

---

## Part 2 — Landing page (first thing every visitor sees)

The landing page collapses to **two clear paths** + an admin link, replacing the current 3-button layout. No "investor signup" anywhere — investors are invitation-only by design (rule a).

```
┌────────────────────────────────────────────────────────────────────┐
│  [Capavate logo]                                  Admin sign-in →  │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│      The capital-formation OS for founders and the investors       │
│      who back them.                                                │
│                                                                    │
│      Run your cap table, structure rounds, communicate with        │
│      every investor on it — and graduate qualified founders        │
│      into the Capavate Collective.                                 │
│                                                                    │
│   ┌──────────────────────────┐    ┌──────────────────────────┐    │
│   │  I'M A FOUNDER           │    │  I'M AN INVESTOR         │    │
│   │  Run your company(ies)   │    │  Sign in to view your    │    │
│   │  → Sign in / Get started │    │     invitation or        │    │
│   │                          │    │     portfolio            │    │
│   └──────────────────────────┘    └──────────────────────────┘    │
│                                                                    │
│   Investors join Capavate by invitation only. If a founder         │
│   has invited you to a round, check your email for the secure      │
│   invitation link.                                                 │
│                                                                    │
│   🛡 SOC 2 Type II    ⊕ Connected to Capavate Collective          │
└────────────────────────────────────────────────────────────────────┘
```

### Founder path
- "Sign in" → email + password (or magic link) → **Multi-company picker** (Part 3) if `founderOf.length > 1`, else direct to that company's dashboard
- "Get started" → company-creation wizard (this is the only public signup on Capavate; investors never appear here)

### Investor path
- "Sign in" → email + password — but **only available to users who already have a token-redeemed account**
- If a visitor lands here without an account, the page shows: "You need an invitation. Ask your founder for the secure invitation link, or paste it here:"
- Token paste box → if valid → completes onboarding → arrives at the **Investor Dashboard (gated)** described in Part 4

### Admin path
- Hidden top-right link, separate auth flow, lands on `/admin/dashboard`

---

## Part 3 — Founder login flow

```
[Email + password] OR [magic link]
         │
         ▼
   POST /api/auth/login → returns UserContext with founderOf[]
         │
         ├─ founderOf.length === 0 → Get started (create your first company)
         ├─ founderOf.length === 1 → /founder/dashboard?co={id}  (auto-select)
         └─ founderOf.length > 1   → /select-company  (Multi-company picker)
```

### Multi-company picker (`/select-company`)

```
┌───────────────────────────────────────────────────┐
│  Welcome back, Ozan                               │
│  Which company do you want to work on today?      │
├───────────────────────────────────────────────────┤
│  ╭────────────────╮  ╭────────────────╮  ╭────╮  │
│  │ NovaPay AI     │  │ Arboreal Health│  │ +  │  │
│  │ Seed · 12 inv  │  │ Pre-Seed · 5   │  │New │  │
│  │ Last edit 2d   │  │ Last edit 1w   │  │co  │  │
│  ╰────────────────╯  ╰────────────────╯  ╰────╯  │
└───────────────────────────────────────────────────┘
```

- Each tile: company name, current stage, investor count, last-active timestamp
- Click → sets `activeCompanyId` (server session) → routes to `/founder/dashboard`
- Top-bar **CompanySwitcher** (already shipped Sprint 11) lets founder swap any time
- **Per-company isolation** (rule a): cap table, dataroom, billing, pricing, settings, invoices, Collective application status are ALL scoped to `activeCompanyId`. Roll-up only on the founder-account profile screen.

### Founder + Collective member (rule b)
- If `collectiveMembership.status === 'active'`, the **Capavate↔Collective toggle** appears in the header
- Founder can switch surfaces freely — Collective shows their company in the deal room (assuming round is ported), Capavate shows the operational view

---

## Part 4 — Investor login flow (the critical part)

```
[Email + password] OR [magic link]
         │
         ▼
   POST /api/auth/login → returns UserContext
         │
         ├─ NO account on file → "You need an invitation" screen + token paste box
         │
         └─ Account exists → compute entitlement state, route accordingly
```

### Entitlement state machine

```
Compute on login + on every page render:

  invitedRounds  = open invitations not yet acted on
  capTablePositions = funded round_participants
  hasAnyCapTable  = capTablePositions.length > 0

State 1 — INVITED_ONLY (has invitations, no funded positions)
   → /investor/invitations            (DEFAULT LANDING)
   → /investor/dashboard              VISIBLE BUT EMPTY (rule d nudge state)
   → All other investor routes        BLOCKED with helpful redirect

State 2 — ON_CAP_TABLE (has at least 1 funded position) — rule b
   → /investor/dashboard              FULL ACCESS
   → /investor/companies/:id          (only companies they're on the cap table of)
   → /investor/portfolio              FULL ACCESS
   → /investor/crm                    FULL ACCESS
   → /investor/messages               FULL ACCESS (cap-table-gated channels)
   → /investor/apply-to-collective    AVAILABLE (rule e)
   → Capavate↔Collective toggle       hidden until membership.status === 'active'

State 3 — ON_CAP_TABLE + ACTIVE COLLECTIVE — rule e
   = State 2 + Collective toggle visible + /collective/* routes accessible

State 4 — LAPSED (was active Collective, didn't renew)
   = State 2 (toggle disappears, Collective routes blocked, prompt to renew)

State 5 — INVITED_ONLY but lapsed cap-table (e.g. exited investment)
   = State 1 (degrade gracefully)
```

### State 1 — "Compelled to invest" Dashboard (the rule d UX)

Empty-state dashboard when investor has invitations but no cap table yet:

```
┌──────────────────────────────────────────────────────────────┐
│  Welcome to Capavate                                         │
│                                                              │
│  You haven't invested in any company on Capavate yet.        │
│  Once you fund a round, you unlock full access:              │
│                                                              │
│   ✓ Communicate directly with founders                       │
│   ✓ Join the cap-table channel for every company you back    │
│   ✓ Access dataroom and investor reports                     │
│   ✓ Apply to the Capavate Collective                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  YOUR PENDING INVITATIONS  (3)                       │   │
│  │  • NovaPay AI · Seed · view round →                  │   │
│  │  • Arboreal Health · Pre-Seed · view round →         │   │
│  │  • Quanta Robotics · Series A · view round →         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  [Review my invitations]                                     │
└──────────────────────────────────────────────────────────────┘
```

This is the **nudge state** the user asked for: dashboard is visible (compelling), but every action route is blocked with "fund a round to unlock". Shows pending invitations as the call-to-action.

### State 2 — Full investor dashboard (already built Sprint 10)

KPI strip + M&A intelligence + portfolio analytics + cohort benchmarks + Messages + Posts. Cap-table-gated communication is fully unlocked.

### Multi-cap-table investor (rule c)

The investor sees ALL companies they're on the cap table of in:
- Portfolio page (filterable)
- Messages (per-company cap-table channels)
- CRM (each company's founder + co-investors)
- Dashboard KPIs aggregated across all positions

No company picker is needed for investors — they see everything they're entitled to in unified views.

### Collective application (rule e)

Available only when `hasAnyCapTable === true`:
- `/investor/apply-to-collective` — 7-step wizard already built Sprint 10
- On membership.status='active' → Capavate↔Collective toggle appears
- On lapse (membership.status='lapsed') → toggle disappears, gentle renewal banner

---

## Part 5 — Server-side gating (the enforcement layer)

Every API endpoint declares its required entitlement; middleware enforces it.

```
GET /api/investor/companies/:id
  requires: investor + on cap table of :id
  on fail: 403 + { error: 'NOT_ON_CAP_TABLE', message: '...' }

GET /api/investor/portfolio
  requires: investor + hasAnyCapTable
  on fail: 403 redirect to /investor/dashboard (State 1)

POST /api/investor/messages/...
  requires: investor + on cap table of target company
  on fail: 403 + 'COMMUNICATION_BLOCKED'

GET /api/investor/dashboard
  requires: investor (always allowed — used for State 1 nudge)

POST /api/collective/applications
  requires: investor + hasAnyCapTable
  on fail: 403 'CAP_TABLE_REQUIRED'
```

Client-side `RequireEntitlement` component wraps every gated route and renders the appropriate empty/redirect state. No silent failures.

---

## Part 6 — Auth shell components

```
/auth/login        — unified login (founder OR investor branch detected by account state)
/auth/signup       — founder signup ONLY (no investor signup)
/auth/forgot       — password reset (both)
/auth/redeem       — investor invitation token redemption (paste token → set password)
/select-company    — founder multi-co picker
/select-surface    — only shown when both founder + investor + collective roles overlap (rare power-user case)
```

Token redemption page (rule a — investor onboarding):

```
┌────────────────────────────────────────────────────┐
│  You've been invited to view a round on Capavate   │
│                                                    │
│  Company:    NovaPay AI                            │
│  Round:      Seed · $2.5M target                   │
│  Invited by: Maya Chen, Founder                    │
│  Expires:    in 28 days                            │
│                                                    │
│  Set your password to view the round:              │
│  [   email (locked)              ]                 │
│  [   choose password             ]                 │
│  [   confirm password            ]                 │
│  ☐ I agree to terms                                │
│                                                    │
│  [ View this round ]                               │
└────────────────────────────────────────────────────┘
```

After redemption: lands on the round's deal page + their `Your Decision` tab. From that point they're in State 1 (invited, no cap-table yet).

---

## Part 7 — What the user sees in each scenario (concrete flows)

| Scenario | What happens |
|----------|--------------|
| New founder signs up | `/auth/signup` → company-creation wizard → `/founder/dashboard` for the new company |
| Founder with 1 company logs in | Goes straight to `/founder/dashboard` |
| Founder with 3 companies logs in | `/select-company` picker, then `/founder/dashboard` for chosen one. Switcher in topbar to swap. |
| Founder who is also Collective member | All of above + Capavate↔Collective toggle in header |
| Investor is invited (first time) | Email link → `/auth/redeem?token=...` → set password → lands on the inviting round's deal page |
| Investor logs in, has invitations only | `/investor/dashboard` shows nudge state + invitations list |
| Investor invests, becomes cap-table holder | Dashboard upgrades to full access; communication unlocks; can apply to Collective |
| Investor on 5 cap tables | Sees aggregated KPIs; per-company drill-down; cap-table channels for each |
| Investor applies to Collective, accepted | Toggle appears; can switch surfaces |
| Investor's Collective membership lapses | Toggle disappears; cap-table access on Capavate unaffected; gentle renewal banner |
| Investor exits all positions (e.g. acquired) | Falls back to State 1; communication on those companies is closed; old reports archived |
| Visitor with no account, no token | Landing page → if they click investor sign-in: token paste box; can't proceed without one |
| Admin login | Separate flow → `/admin/dashboard` → can impersonate (with audit) |

---

## Part 8 — What changes vs current build

**Currently** (Sprint 12 unified login):
- One `/login` page with role chips for admin/founder/investor
- `KNOWN_USERS` map routes by email
- No multi-company picker enforced (just CompanySwitcher in topbar)
- No "compelled" empty state for investors without cap-table positions
- Token redemption exists from Sprint 7 but not unified into the new auth shell

**After Sprint 15** (this design):
- Landing → two clear path buttons (Founder, Investor) + Admin link
- Founder path: `/auth/login` → `/select-company` (if multi-co) → dashboard
- Investor path: `/auth/login` (if account exists) OR `/auth/redeem` (if token) → State 1/2/3 dashboard
- All entitlement states enforced server-side with explicit error codes
- Capavate↔Collective toggle visibility wired to live `collective_memberships.status` per audit
- Sprint 7 token gating preserved (just relocated into the new auth shell)
- Sprint 11 multi-company isolation preserved
- Sprint 12-13 bridge sync preserved (eligibility recomputes propagate correctly on every state change)

---

## Part 9 — Edge cases (all handled)

1. **Founder of company A + investor on company B** — sees both surfaces, single login, role badges in header indicate active context
2. **Investor invited to a round + already has accepted invitation elsewhere** — invitation appears in pending list; existing access unaffected
3. **Investor declines round, no cap-table positions remain** — falls back to State 1 nudge state
4. **Founder of company A whose round on B they invested in closes (they fund)** — they stay founder of A AND now hold a cap-table position on B
5. **Collective member's primary cap-table company exits Capavate** — eligibility recomputes; if no other qualifying positions, membership status flips → toggle hides
6. **Magic link expires** — graceful "request a new link" flow
7. **User exists but tries to log in via investor branch with no invitation history** — bounces to Founder side or shows "your account is configured for the founder portal — sign in there"
8. **Token redemption replay** — single-use, second attempt shows "this invitation has already been redeemed"
9. **User on lapsed Collective membership tries to access /collective routes directly** — server returns 403 with renewal CTA

---

## Part 10 — Implementation order (Sprint 15 plan if approved)

1. New auth route shell: `/auth/login`, `/auth/signup`, `/auth/redeem`, `/select-company`
2. Server: `getUserContext(req)` with full entitlement computation
3. Server: `RequireEntitlement` middleware applied to every investor + founder + admin endpoint
4. Client: `RequireEntitlement` HOC + `useEntitlement()` hook
5. Landing page rebuild with two-path layout
6. Investor State 1 nudge dashboard
7. Investor State 2 dashboard transition (already exists Sprint 10 — wire entitlement)
8. Founder multi-company picker page (uses Sprint 11 store)
9. Capavate↔Collective toggle visibility wired to live `collective_memberships`
10. Token redemption flow integrated into auth shell
11. Tests: entitlement matrix (5 states × 8 routes = 40 cases), state transitions, gate enforcement
12. QA walk: every persona × every route, prove zero unauthorized access + zero false-block
13. Deploy

---

**Awaiting your approval. Anything you want changed before I build?**
