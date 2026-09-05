# Capavate — Gating, Identity & Privacy Addendum (R200.gating v1.0)

**Version:** R200.gating v1.0
**Date:** 2026-05-08
**Status:** Authoritative — extends R200 master spec §2 (Two-Product Architecture) and §9 (Investor Invitation Subsystem)
**Author:** Perplexity Computer for Ozan Isinak (Blueprint Catalyst Limited)

This addendum documents the gating model, identity flow, and privacy posture that supersede earlier drafts. It is the source of truth for §2.4 (eligibility gate), §9 (investor invitation subsystem), and the privacy default for cap-table co-member visibility.

---

## 1. The vetting model — invitation-only investor entry

### Mandate
**No investor self-registration.** The only path onto the Capavate platform for an investor is an invitation from a founder to a specific round. The invitation simultaneously:

1. Grants access to the platform (creates the investor account)
2. Grants visibility to that round's terms, dataroom, and soft-circle book
3. Acts as the platform's vetting mechanism — a founder vouching for an investor by inviting them to their cap table is the filter that keeps the platform investor-grade

### Invitation token model

| Property | Value |
|---|---|
| Form | Cryptographically random 256-bit token, base64url-encoded |
| Single-use | Yes — token is invalidated upon acceptance |
| Expiry | Default 30 days from issuance; founder-configurable per round (per R200.q1 §S2 lifecycle policies) |
| IP-binding | Optional — admin can require token to be redeemed from the same /24 subnet as initial click (off by default) |
| Audit | Every token issuance + click + redemption + expiry written to the hash-chained audit log (R200 §6, R165 §12) |
| Revocation | Founder can revoke an outstanding token; Admin can revoke any token |
| Storage | Token hash (SHA-256) only — raw token never stored server-side after issuance |
| Email delivery | Postmark / SES (R165 §1.1 EmailSenderProvider); DKIM-signed |

### Token lifecycle

```
created → sent → viewed (optional) → accepted → redeemed → archived
                                  ↘
                                    declined → archived
                                  ↘
                                    expired → archived
                                  ↘
                                    revoked → archived
```

### Signup page behavior
- `/investor/signup?token=...` exists ONLY when accessed with a valid, unredeemed, unexpired token
- Without a valid token, the route 404s (no enumeration possible)
- `/investor/login` exists for returning investors who already have an account
- There is NO public discovery of the platform for investors — they cannot browse companies without an invitation
- Founders CAN self-register (the founder-onboarding flow is open) — the platform is open to founders, gated to investors

### Why this matters
- **Founder accountability** — every investor on the platform was vouched for by at least one founder. If an investor behaves badly, that founder owns the introduction.
- **Anti-spam / anti-poaching** — investors can't browse the platform looking for deals; they only see what they were invited to.
- **Quality signal** — over time, the network of "investors invited by Capavate founders" becomes a curated, high-quality set.
- **Data residency** — no investor profile is created until a founder explicitly requests one.

---

## 2. Account creation flow on first invitation

When an investor receives their first invitation:

```
1. Founder creates round on Capavate
2. Founder adds investor to /crm or directly to round invitations (just name + email)
3. System generates a single-use token, stores token-hash, sends invitation email
4. Investor clicks the link → /investor/signup?token=<256-bit-token>
5. Server validates: token exists, not redeemed, not expired, not revoked
6. Investor sees a 3-step inline signup:
   Step 1 — Confirm identity: typed full name, phone, country
   Step 2 — Investor profile: type of investor, accredited status, KYC docs
   Step 3 — Privacy + screen name: opt-in to cap-table-co-member visibility, choose screen name (optional)
7. On submit: account created, token marked redeemed, investor lands on the round invitation
8. Future invitations from any founder land in the investor's inbox at /investor/invitations
```

The KYC + accreditation captured at step 2 follows the R200 §17 jurisdictional rules — the same fields documented in `capavate_investor_deep_audit.md` are captured here, with regional variants per the 9 supported regions.

---

## 3. Capavate ↔ Collective shared identity

Every founder + investor account on Capavate is **the same account** on Capavate Collective. Same Auth0 user. Same identity hash. Same audit chain.

### Origination rule
- All companies on Collective originate from Capavate (founder created company on Capavate first, then opted into Collective)
- The only exception is standalone SPVs documented in R170/R171, which originate on Collective itself
- All founders and investors originate from Capavate
- Investor accounts created via the invitation flow are immediately available on Collective if they later become eligible (via cap-table membership)

### Data flow (Capavate → Collective)
| Data | Direction | Trigger |
|---|---|---|
| User profile (name, screen name, KYC status, accreditation) | Capavate → Collective | On profile change |
| Company profile (name, sector, stage, region, M&A intelligence fields) | Capavate → Collective | On profile change |
| Cap table state (holders, ownership %, instrument mix) | Capavate → Collective | On every cap-table mutation |
| Eligibility recompute | Capavate → Collective | On cap-table mutation, founder lifecycle event, or admin trigger |
| Round telemetry (state transitions, durations, valuations) | Capavate → Collective | On round state change |
| Communications (messages between cap-table co-members) | Bidirectional | Real-time |

### Data flow (Collective → Capavate)
| Data | Direction | Trigger |
|---|---|---|
| DSC scores (when a company applies for syndication) | Collective → Capavate | On DSC review |
| M&A intelligence rankings (composite score, sector benchmarks) | Collective → Capavate | Nightly batch |
| Consortium partner introduction status | Collective → Capavate | On status change |
| Network social signals (followers, mentions) | Collective → Capavate | Real-time |

### Sync mechanism
Per `capavate_collective_sync_schema.md` — outbox events emitted from Capavate, consumed by Collective via webhook. Event types defined therein.

---

## 4. Investor dashboard — split view

The investor dashboard (`/investor/dashboard`) is the investor's home. It surfaces both consolidated and per-company information.

### Top section: Consolidated KPI strip
- **Total invested** across all positions (denominated in investor's preferred currency)
- **Current paper value** at latest valuation
- **Weighted average ownership** across all positions
- **Number of companies** on cap table
- **Vintage distribution** (count by year of first investment)
- **Instrument mix** (count + value by Common / Preferred / SAFE / Note / Warrant / Option)

### Middle section: Per-company list
Sortable table:
- Company logo + name
- Lead investor's role (founder / observer / advisor / signatory)
- Position summary (instrument, shares, ownership %, $ invested)
- Latest round status (e.g., "Series A closed Mar 2026")
- M&A intelligence flag (if Collective surfaces a deal-readiness signal)
- Click → company drill-in view

### Bottom section: Recent activity feed
Cross-portfolio activity:
- "[Company] closed their Series A — your ownership now 4.2%"
- "[Company] uploaded Q1 2026 investor update"
- "[Cap-table co-member screen-name] sent you a message"
- "[Company] opened a new round (you're invited as a participant)"
- Filter by company / event type

### Privacy default
- Investor cannot see what OTHER investors hold in a company they're on the cap table of, unless those investors have opted into a screen name + visibility (see §6 below)
- The investor's own portfolio is private to them; nothing on the dashboard is shared back to founders or other investors

---

## 5. Company details page — Capavate ↔ Collective parity

The Capavate company details page and the Collective company details page are **identical in shape**, with one exception: rounds + soft-circles are gated by invitation status on Capavate.

### Shared sections (identical on both platforms)
- Company header (logo, name, sector, stage, region, headliner)
- Founder bios (with privacy controls)
- Problem / solution narratives (from Company Profile wizard)
- Legal entity info
- Mailing address
- Market presence
- Strategic priorities (next 24 months)
- M&A intelligence panel (30 fields per `capavate_founder_deep_audit.md` §B.4)
- Competitive landscape table
- Customer / revenue concentration flags
- Press + PR section

### Capavate-only section (gated)
- **Round detail** — visible to invited investors only, blank to non-invited viewers
- **Dataroom** — visible to invited investors with active access grant
- **Soft-circle book** — visible to founder only; per-investor entries visible to that investor only
- **Term sheet** — visible to invited investors only

### Collective-only section
- **DSC review status** — visible to DSC committee members + admins
- **Syndication SPV status** — visible to syndication participants
- **Network mentions / social signals** — visible to network members

### Implementation note
The Capavate frontend consumes the SAME `/api/companies/:id` payload as Collective. The `rounds`, `dataroom`, `softCircles`, and `termSheet` fields are present in the response only if the requesting user has invitation status for that company. Otherwise those fields are `null` and the corresponding UI sections are hidden.

---

## 6. Privacy-by-default for cap-table co-member visibility

### Mandate
**An investor cannot see who else is on a cap table** until each co-member explicitly opts into visibility via a screen name on their profile.

### Profile visibility model
Each user has three independent toggles:
- `screen_name_set` — has the user chosen a public screen name? (default: false)
- `visible_to_co_members` — is this user discoverable to other cap-table co-members on companies they share? (default: false)
- `visible_to_collective_network` — is this user discoverable to the broader Capavate Collective network? (default: false)

Visibility is **opt-in at every level**. A user can be:
- Invisible everywhere (default)
- Visible only to direct cap-table co-members (e.g., for founder communication)
- Visible to direct co-members AND Collective network members (full social mode)

### Communication eligibility
A message thread between User A and User B is allowed only if:
1. User A and User B share at least one Capavate cap table, OR
2. User A and User B are in the same Collective DSC committee, OR
3. User A and User B are in the same Collective chapter
**AND**
- Both users have `visible_to_co_members=true` (or `visible_to_collective_network=true` for Collective-only paths)

### Why this matters
- **Anti-poaching** — co-investors can't reach out to a founder's other investors to compete for follow-on rounds without the other investors opting in
- **GDPR compliance** — explicit consent for discoverability satisfies the lawful-basis requirement for processing personal data for matchmaking
- **Investor preference** — many institutional investors prefer to remain pseudonymous on cap tables; the screen-name model lets them participate without exposing the firm's identity until they choose to

---

## 7. Security guardrails

### Token security
- 256-bit cryptographically random tokens via `crypto.randomBytes(32)` (Node crypto)
- Tokens never logged, never appear in URLs server-side beyond the redemption endpoint
- Tokens stored as SHA-256 hashes; raw token visible only at issuance time (one-shot to email)
- Token redemption endpoint rate-limited per IP (10 req/min)
- Failed redemption attempts logged + admin-alerted at 3+ within 1 hour

### Account creation safeguards
- Email verification: invitation email contains the token; verification of email = redemption
- KYC documents uploaded at signup are scanned + hashed; raw uploads encrypted at rest with KMS-per-tenant
- New accounts are flagged `unvetted=true` until the inviting founder confirms the round invitation acceptance — this protects against social-engineering attacks where the investor accepts but the founder later realizes they sent the invitation in error
- Inviting founder receives a notification: "[Investor] has accepted your invitation. They are now on the Capavate platform with access to [Round]." and a confirm/dispute action

### Audit chain
- Every token issuance, click, redemption, expiry, and revocation written to the hash-chained audit log
- Every account creation event written to the chain with: founder ID, round ID, token hash, IP, user agent, KYC document hashes, accreditation status
- Chain verifiable end-to-end at /admin/audit-log

---

## 8. Migration impact (current preview → new model)

The preview today has `/investor/signup` as a public route. This addendum requires:

1. **Remove** the role-chooser "I'm an investor → sign up" path on the landing page (founders can still self-register)
2. **Replace** with a "Founders sign up here" CTA + an explanation of the invitation model: "Investors join Capavate by invitation only. If you're a founder, your investors will be able to access their round invitations via email."
3. **Add** `/investor/signup?token=<token>` flow with the 3-step inline signup
4. **Add** `/investor/login` for returning investors (Auth0 magic link or email/password)
5. **Restructure** `/investor/dashboard` per §4 (split view)
6. **Restructure** `/founder/companies/:id` and `/investor/companies/:id` to mirror per §5
7. **Add** privacy toggles to `/investor/profile` and `/founder/profile` per §6
8. **Token model** in backend: `POST /api/rounds/:id/invitations` issues tokens; `GET /api/invitations/redeem?token=...` redeems

---

## 9. What this does NOT change

- The cap-table engine and math — unchanged
- The 9-region formula registry — unchanged
- The dual-engine reconciliation gate — unchanged
- The telemetry hash chain — unchanged
- The term-sheet generator + SES e-signature — unchanged
- The /admin surface — unchanged
- The 114 passing tests — unchanged

This is purely an identity, gating, and privacy-model rewrite. The entire financial-grade math system stays as-is.

---

`--- END OF GATING ADDENDUM (R200.gating v1.0) ---`
