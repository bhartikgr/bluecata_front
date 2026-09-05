# Sprint 16 — Demo Data State + Sync Pipeline Audit
**Date:** 2026-05-27  
**Version:** 1.0  
**Sources:** `server/commsStore.ts`, `server/bridgeStore.ts`, `server/mockData.ts`, `server/captableCommitStore.ts`, `server/lib/bridgeRuntime.ts` (SPRINT-13 summary), `capavate_collective_sync_field_map.md`, `SPRINT-13-SYNC-SUMMARY.md`, `SPRINT-14-FULL-BUILD-SUMMARY.md`, `SPRINT-15-PROGRESS.md`

---

## 1. Capavate Demo Seed Inventory

### 1.1 Companies

| ID | Name | Legal Name | Stage | Sector | HQ | Founded | Employees |
|---|---|---|---|---|---|---|---|
| `co_novapay` | NovaPay AI | NovaPay AI, Inc. | Seed | Fintech / AI Payments | San Francisco, CA | 2023 | 14 |
| `co_arboreal` | Arboreal Health | Arboreal Health Sciences Ltd. | Pre-Seed | Digital Health | Boston, MA | 2024 | 6 |
| `co_kelvin` | Kelvin Energy | *(implied — Sprint 15 mentions Maya Chen as founder of co_novapay, co_arboreal, co_kelvin)* | Unknown | Energy | Unknown | — | — |
| `co_quanta` | Quanta Robotics | *(referenced via Aisha Patel's capTables in commsStore.ts)* | Unknown | Robotics | Unknown | — | — |

**Notes:** `co_kelvin` and `co_quanta` are referenced in identity data (`commsStore.ts` COMMS_USERS, Sprint 15 identity model) but their company profile records are **not in `mockData.ts`** — only NovaPay and Arboreal have full profile objects. These are **ghost companies** — referenced but unseeded.

### 1.2 Founders

| User ID | Name | Email | Company | Role |
|---|---|---|---|---|
| `u_maya_chen` | Maya Chen | maya@novapay.ai | NovaPay AI (`co_novapay`) | Founder |
| `u_daniel_okafor` | Daniel Okafor | daniel@novapay.ai | NovaPay AI (`co_novapay`) | Co-Founder |
| *(unnamed)* | — | — | co_arboreal | — (not seeded in commsStore) |
| *(unnamed)* | — | — | co_kelvin | — (not seeded) |

### 1.3 Investors

| User ID | Legal Name | Screen Name | Email | Cap Tables | Role | Collective |
|---|---|---|---|---|---|---|
| `u_aisha_patel` | Aisha Patel | GreenwoodCap | aisha@greenwood.capital | co_novapay, co_arboreal, co_quanta | investor, co_member | Active member, chap_toronto |
| `u_hydra_capital` | Aisha Rahman (Hydra Capital) | HydraCap | partner@hydracapital.com | co_novapay | investor, co_member | Active member, chap_sf + chap_toronto |
| `u_forge_ventures` | Tom Bauer (Forge Ventures) | ForgeVC | deal@forgeventures.vc | co_novapay | investor, co_member | Active member, chap_nyc |
| `u_avocado_angels` | Ramesh Iyer (Avocado Angels) | *(none — visibleToCoMembers: false)* | ramesh@avocado.angel | co_novapay | investor, co_member | NOT opted-in; [Anonymous Holder] |
| `u_northstar_angels` | Helena Park (Northstar Angels) | *(none — visibleToCoMembers: false)* | ramesh@northstar.angel | co_novapay | investor, co_member | NOT opted-in; [Anonymous Holder] |
| `u_bluepoint_angels` | Helena Park (Bluepoint Angels) | BluepointSyndicate | helena@bluepoint.club | *(none — soft-circler only)* | investor, soft_circler | Active member, chap_sf + chap_toronto |
| `u_lapsed_lp` | *(Sprint 15 persona)* | — | — | co_novapay | investor | Lapsed Collective member |
| `u_no_position` | *(Sprint 15 persona)* | — | — | *(none)* | invited only | State 1 nudge persona |

### 1.4 Securities (NovaPay AI — co_novapay)

| ID | Holder | Type | Instrument | Shares | Amount | Round | Certificate |
|---|---|---|---|---|---|---|---|
| `sec_1` | Maya Chen | founder | Common | 4,000,000 | $400 | rnd_novapay_foundation | CS-1 |
| `sec_2` | Daniel Okafor | founder | Common | 4,000,000 | $400 | rnd_novapay_foundation | CS-2 |
| `sec_3` | ESOP Pool | pool | Option | 2,000,000 | $0 | rnd_novapay_foundation | OPT-POOL-1 |
| `sec_4` | Forge Ventures | investor | SAFE (Post-Money) | 0 | $500,000 | rnd_novapay_preseed | SAFE-1 |
| `sec_5` | Hydra Capital | investor | *(referenced, not shown in excerpt)* | — | — | — | — |

**Additional securities implied** (from commsStore.ts context): Aisha Patel (Greenwood Capital), Avocado Angels, Northstar Angels are all on `co_novapay` cap table per COMMS_USERS.capTables. Their securities records are **not fully enumerated in mockData.ts** — gap.

### 1.5 Rounds

| Round ID | Company | Type | Status | Details from seed data |
|---|---|---|---|---|
| `rnd_novapay_foundation` | co_novapay | Foundation / Common | Closed | Founder + ESOP issuance |
| `rnd_novapay_preseed` | co_novapay | SAFE Pre-Seed | Closed | Forge Ventures $500k; cap $8M; 20% discount |
| `rnd_seed` / `rnd_novapay_seed` | co_novapay | Seed Extension | Open/Active | $4M target, $18M pre; $2.65M committed; closes ~July 15 |

Round `rnd_seed` is referenced as `rnd_novapay_seed` in bridgeStore seed events and `rnd_seed` in commsStore — **naming inconsistency** (see §3 Drift Inventory).

### 1.6 Soft-Circles (rnd_seed — NovaPay Seed Extension)

| User | Amount | Type | Status | From |
|---|---|---|---|---|
| Hydra Capital (u_hydra_capital) | $1,500,000 | Lead | soft_circled / confirmed | msg_sc_2 |
| Forge Ventures (u_forge_ventures) | $750,000 | Returning investor | soft_circled | msg_sc_3 |
| Bluepoint Angels (u_bluepoint_angels) | $400,000 | Syndicate | soft_circled | msg_sc_4 |
| Aisha Patel / Greenwood (u_aisha_patel) | $750,000 | Implied from DM | soft_circled | msg_dm2_2 |

Total soft-circled: **$3,400,000** of $4,000,000 target. $600k gap to close.

### 1.7 Cap-Table Positions (committed)

From `captableCommitStore.ts` CommitState machine: positions can be in states `invited → viewed → soft_circled → confirmed → signed → funded → committed`. Only `committed` positions are final cap-table entries.

Demo committed positions in `rnd_novapay_seed` (inferred from seed messages):
- Hydra Capital: $1.5M confirmed as lead (msg_sc_2)
- Forge Ventures: $750k (msg_sc_3 — soft-circled, confirmed status unclear)
- Bluepoint Angels: $400k intent (msg_sc_4 — not yet firm)
- Aisha Patel: $750k (msg_dm2_2 — intent to wire)

**Ledger:** `captableCommitStore.ts` `ledger[]` starts empty and is populated by API calls; no pre-seeded committed entries exist.

---

## 2. Collective Mock Receiver State

### 2.1 Events Logged Since Sprint 13

From `bridgeStore.ts` `seedDemoEvents()` (fires once on startup):

**Outbound (Capavate → Collective) — seeded:**

| # | Event type | aggregateId | Payload highlights |
|---|---|---|---|
| 1 | `company.profile.updated` | co_novapay | changedFields: [legalName, stage], stage: seed_extension |
| 2 | `cap_table.mutated` | co_novapay | roundId: rnd_novapay_seed, txCount: 3, totalIssued: 12,500,000 |
| 3 | `eligibility.recomputed` | u_aisha_patel | eligibilityScore: 78, investorOnCapTable: true |
| 4 | `lifecycle_policy.changed` | platform | founderTenureDays: 180, archiveRetentionDays: 3650, nonPaymentGraceDays: 30 |
| 5 | `audit_log.appended` | co_novapay | entryId: al_001 |
| 6 | `round.closed` | rnd_novapay_seed | amountClosed: 4,000,000, currency: USD |
| 7 | `safe.converted` | co_novapay | safeId: safe_007, priceUsed: 12.50, sharesIssued: 32,000 |
| 8 | `note.converted` | co_novapay | noteId: note_002, priceUsed: 11.875, sharesIssued: 21,000 |
| 9 | `investor.profile.updated` | u_aisha_patel | accreditationStatus: verified |
| 10 | `company.ma_intelligence.updated` | co_novapay | compositeScore: 82, mnaScore: 76, roundScore: 88 |
| 11 | `formula.published` | ca-default-v2 | version: 2.0.0, testsPassed: 332 |

**Inbound (Collective → Capavate) — seeded:**

| # | Event type | aggregateId | Payload highlights |
|---|---|---|---|
| 1 | `ma.intelligence_rankings` | co_novapay | compositeScore: 82, sectorBenchmark: 71, autoTier: "A" |
| 2 | `dsc.scores` | co_novapay | dscScore: 4.2, dscRecommendation: "advance", reviewerIds: [u_r1, u_r2] |
| 3 | `partner.introduction_status` | co_novapay | partnerId: p_y_combinator, introductionStatus: "warm_intro_made", vouchWeight: 1 |
| 4 | `network.social_signals` | co_novapay | followerCount: 12,400, mentionCount: 81, networkActivity: "trending" |

### 2.2 What Collective "Knows About"

Based on the seeded bridge events received at `/api/_mock_collective/inbound`:

| Entity | Collective state |
|---|---|
| NovaPay AI company profile | stage=seed_extension; composite=82; auto_tier="A" (Priority) |
| NovaPay round | round.closed received (amountClosed=$4M) — INCONSISTENCY: round appears open in soft-circle state but closed in bridge event |
| Aisha Patel investor | accreditation=verified; eligibilityScore=78; investorOnCapTable=true |
| SAFE conversion (safe_007) | Received; Collective knows shares issued |
| Note conversion (note_002) | Received |
| DSC score | dscScore=4.2, recommendation=advance |
| M&A rankings | compositeScore=82; autoTier=A |
| Partner intro | Y Combinator warm intro made |
| Social signals | 12,400 followers, trending |
| co_arboreal, co_quanta, co_kelvin | **NOT in bridge — Collective knows nothing about these companies** |

---

## 3. Drift Inventory

### 3.1 Entity Presence Drift

| Entity | Capavate seed | Collective mock receiver | Status |
|---|---|---|---|
| co_novapay | ✓ Full profile | ✓ Via bridge events | **In sync** |
| co_arboreal | ✓ Profile in mockData.ts | ✗ Never bridged | **DRIFT: Capavate-only** |
| co_kelvin | ✗ Referenced but not seeded | ✗ Not bridged | **DRIFT: Ghost on both sides** |
| co_quanta | ✗ Referenced in COMMS_USERS only | ✗ Not bridged | **DRIFT: Ghost on both sides** |
| u_aisha_patel (investor) | ✓ In COMMS_USERS, securities, bridge events | ✓ eligibility.recomputed received | **In sync** |
| u_hydra_capital | ✓ In COMMS_USERS + soft-circle | ✗ No bridge event for this investor | **DRIFT: Capavate-only** |
| u_forge_ventures | ✓ In COMMS_USERS + soft-circle | ✗ No bridge event | **DRIFT: Capavate-only** |
| u_bluepoint_angels | ✓ In COMMS_USERS + soft-circle | ✗ No bridge event | **DRIFT: Capavate-only** |
| u_avocado_angels | ✓ In COMMS_USERS | ✗ Not bridged | **DRIFT: Capavate-only** |
| u_northstar_angels | ✓ In COMMS_USERS | ✗ Not bridged | **DRIFT: Capavate-only** |
| rnd_novapay_seed | ✓ Active in commsStore | bridge event says CLOSED | **CONFLICT: State mismatch** |
| rnd_novapay_preseed | ✓ In mockData.ts | ✗ No bridge event | **DRIFT: Capavate-only** |
| rnd_novapay_foundation | ✓ In mockData.ts | ✗ No bridge event | **DRIFT: Capavate-only** |
| SAFE safe_007 | ✓ Seeded in bridge | ✓ Bridged | **In sync (bridge only; no Capavate UI record)** |
| Note note_002 | ✓ Seeded in bridge | ✓ Bridged | **In sync (bridge only)** |
| DSC score | ✓ Inbound received | — | **Capavate has received; not surfaced in founder UI yet** |
| M&A rankings | ✓ Inbound received | — | **Capavate has received** |
| Partner intro | ✓ Inbound received | — | **Capavate has received** |
| Social signals | ✓ Inbound received | — | **Capavate has received** |

### 3.2 Round ID Naming Inconsistency

- `bridgeStore.ts` seed: uses `rnd_novapay_seed` as aggregateId
- `commsStore.ts` seed: softCircle channel uses `rnd_seed` as roundId
- This means `softCircleChannelId("rnd_seed")` ≠ bridge events referencing `rnd_novapay_seed`. The bridge and the comms store reference different IDs for the same round. **Fix needed.**

---

## 4. Round Porting Flow — End-to-End Trace (NovaPay Seed Extension)

### 4.1 Step-by-Step Trace (current state)

```
Step 1: Founder creates round in Capavate (/founder/rounds/new)
  → round record created (rnd_novapay_seed / rnd_seed — ID mismatch exists)
  → participantUserIds seeded in commsStore
  STATUS: ✓ Done (seed data present)

Step 2: company.profile.updated emitted
  → payload includes lastRoundDate, lastRoundType, lastValuation, roundSize, instrument, terms
  → Collective deal card at /collective/#/deals/co_novapay updates
  STATUS: ✓ Event seeded; bridgeStore event #1 confirms

Step 3: company.ma_intelligence.updated emitted
  → compositeScore: 82, mnaScore: 76, roundScore: 88
  → auto_tier badge: Priority (score 82 > 75 threshold inferred)
  STATUS: ✓ Event seeded; bridgeStore event #10 confirms

Step 4: Collective members browse deal room
  → All active members see co_novapay deal card with Priority badge
  → DSC members see full scores; regular members see auto_tier only (Conflict 3 per Sprint 14)
  STATUS: ✓ Implemented; VIS-4 enforced via companySyncFields.ts COMPANY_SYNC_FIELDS

Step 5: Member expresses interest via "Your Decision" tab
  → soft_circle form submitted
  → PATCH /api/rounds/rnd_seed/invitations/:iid/decision
  → Event: soft_circle.submitted → bridge outbound (GAP: soft_circle.submitted is NOT in
    ALL_OUTBOUND_EVENT_TYPES in bridgeStore.ts — only round.closed is)
  STATUS: ⚠ GAP — soft_circle.submitted outbound event NOT IMPLEMENTED
    The soft-circle state machine in captableCommitStore.ts manages invited→soft_circled
    but does NOT emit a bridge event on soft_circled transition.

Step 6: Capavate receives soft-circle via bridge
  → round_participants record created/updated
  → round.soft_circle_received notification → founder notified
  → MIM aggregation updates
  STATUS: ⚠ GAP — no bridge inbound handler for soft_circle.submitted
    The bridgeInbound.ts handles: dsc.scores, ma.intelligence_rankings,
    partner.introduction_status, network.social_signals, member.application_decision,
    membership.renewal_status, kyc.status_decision
    But NOT soft_circle.submitted or round.invitation_submitted

Step 7: Founder CRM updates
  → investor appears in Soft-Circle stage of Founder InvestorCRM
  → soft-circle thread opens (commsStore.ts soft_circle channel)
  STATUS: ✓ commsStore.ts SEED_SOFTCIRCLE_SEED channel exists for rnd_seed

Step 8: round.closed event fired
  → cap_table.mutated + eligibility.recomputed fire
  → investor now "on cap table" → Collective badge resolves
  STATUS: ✓ bridge events #2 (cap_table.mutated) + #3 (eligibility.recomputed) seeded
    BUT round is seeded as CLOSED in bridge while active in commsStore — state conflict
```

### 4.2 Gaps in Round Port Flow

| Gap # | Description | Location | Fix |
|---|---|---|---|
| G1 | `soft_circle.submitted` is not an outbound bridge event type | bridgeStore.ts `ALL_OUTBOUND_EVENT_TYPES` | Add `"soft_circle.submitted"` and `"soft_circle.confirmed"` to outbound types; emit from captableCommitStore on state transition |
| G2 | No inbound handler for `soft_circle.submitted` | bridgeInbound.ts | Add handler: creates/updates round_participants; fires founder notification |
| G3 | Round ID mismatch `rnd_seed` vs `rnd_novapay_seed` | commsStore.ts + bridgeStore.ts | Standardize to `rnd_novapay_seed` across all stores |
| G4 | round.closed bridge event fires for active round | bridgeStore.ts seedDemoEvents() | Reset seed: remove premature round.closed event; only emit on actual close |
| G5 | co_arboreal, co_quanta, co_kelvin not bridged | mockData.ts + bridgeStore.ts | Add `company.profile.updated` events for all demo companies; seed full profiles for co_kelvin and co_quanta |
| G6 | Only u_aisha_patel has eligibility.recomputed — other investors never bridged | bridgeStore.ts | Add investor.profile.updated + eligibility.recomputed for Hydra, Forge, Bluepoint |
| G7 | Round Terms fields (lastRoundDate, lastRoundType, lastValuation, roundSize, instrument, terms) present in allow-list but not in bridge payload for company.profile.updated seed event | bridgeStore.ts seedDemoEvents() | Enrich company.profile.updated payload with 6 round fields (Sprint 14 D5 added to allow-list) |

---

## 5. Member Sync Flow — Investor Profile to Collective Member Shell

### 5.1 Current Flow (as implemented Sprint 13–15)

```
1. Investor on cap table (status = 'funded' in captableCommitStore)
   → cap_table.mutated event fires (bridgeOutbound.ts)
   → payload: {roundId, txCount, totalIssued}

2. eligibility.recomputed event fires per investor
   → payload: {eligibilityScore, eligibilityFlags: {investorOnCapTable: true}}
   → Collective eligibility worker sets member shell eligible flag

3. Investor applies to Collective (/investor/apply-to-collective — 7-step wizard)
   → Sprint 14 AccreditationForm (9-jurisdiction KYC)
   → collective_memberships.status = 'submitted'

4. Sprint 13 inbound: member.application_decision inbound handler
   → flips Collective toggle in Capavate (userContext.isCollectiveMember)

5. Sprint 13 inbound: membership.renewal_status inbound handler
   → flips lapsed flag → hides CapCollectiveToggle

6. Sprint 13 inbound: kyc.status_decision inbound handler
   → updates accreditationStatus

7. On acceptance: collective_welcome email, active status, sprint 14 warm-intro eligibility
```

### 5.2 Current State: Demo Users

| Investor | Cap table | eligibility.recomputed | Collective status |
|---|---|---|---|
| u_aisha_patel | co_novapay ✓ | Seeded (score: 78, investorOnCapTable: true) | Active co_member |
| u_hydra_capital | co_novapay ✓ | **NOT seeded** | Active co_member (set in COMMS_USERS directly, not via bridge) |
| u_forge_ventures | co_novapay ✓ | **NOT seeded** | Active co_member (COMMS_USERS direct) |
| u_bluepoint_angels | *(no cap table)* | **NOT seeded** | Active co_member (soft-circler, not yet on cap table) |
| u_avocado_angels | co_novapay ✓ | **NOT seeded** | NOT opted-in (anonymous) |
| u_lapsed_lp | co_novapay ✓ | **NOT seeded** | Lapsed (Sprint 15 persona) |

**Gap:** Only Aisha Patel has a seeded eligibility.recomputed event. The other 5 investors on the NovaPay cap table do not have this event in the bridge. In production, every cap_table.mutated event should fire a per-investor eligibility.recomputed. Sprint 16 should seed this for all investors.

---

## 6. Consortium Partner Directory

### 6.1 Current State in Capavate

Partners are defined in `client/src/lib/partners.ts` — 27 partners across 9 regions (all type="law"). No incubator, accelerator, or accounting firms are seeded.

The directory is used for:
- Introduction routing (Ask Expert / warm-intro flow)
- Round Consortium Cards (`partner.introduction_status` inbound event populates)
- KYC provider references (Persona/Sumsub/Onfido/Veriff — not in partners.ts, inline in AccreditationForm)

There is **no UI module that renders the full consortium partner directory publicly** — partners are used as data objects for intro routing and displayed in per-round context.

### 6.2 Sprint 16 Gating Rule

> *Partner visible in Consortium Directory only if at least one of `partner.portfolioCompanies` is in `Capavate.companies`.*

**Current problem:** `ConsortiumPartner` schema in partners.ts does NOT include a `portfolioCompanies` field. The gating rule requires this field to be added.

Proposed schema addition:
```typescript
export interface ConsortiumPartner {
  id: string;
  region: Region;
  firmName: string;
  type: PartnerType;
  description: string;
  regionalSpecialty: string;
  url: string;
  slaBusinessDays: number;
  portfolioCompanies?: string[];  // NEW: array of Capavate companyIds this partner is linked to
}
```

### 6.3 Partner-by-Partner Gating Decision

Demo companies in Capavate: `[co_novapay, co_arboreal]` (seeded) + `[co_kelvin, co_quanta]` (ghost — not fully seeded).

**Rule:** If any partner has a Capavate company in their `portfolioCompanies`, they show. Since no partner currently has `portfolioCompanies` populated, applying the rule as-is would **hide all 27 partners**.

For demo purposes, Sprint 16 must assign portfolio companies to at least some partners. Proposed demo assignments:

| Partner ID | Firm | Proposed portfolioCompanies | Verdict |
|---|---|---|---|
| us-cooley | Cooley LLP | [co_novapay] | **SHOW** — NovaPay uses Cooley (DE C-Corp, NVCA docs) |
| us-wsgr | Wilson Sonsini | [] | **HIDE** — no demo company |
| us-latham | Latham & Watkins | [] | **HIDE** |
| ca-stikeman | Stikeman Elliott | [] | **HIDE** |
| ca-bennett | Bennett Jones | [] | **HIDE** |
| ca-osler | Osler | [] | **HIDE** |
| uk-bird | Bird & Bird | [co_arboreal] | **SHOW** — Arboreal (digital health, EU design partners) |
| uk-tw | Taylor Wessing | [] | **HIDE** |
| uk-mishcon | Mishcon de Reya | [] | **HIDE** |
| sg-drew | Drew & Napier | [] | **HIDE** |
| sg-allen | Allen & Gledhill | [] | **HIDE** |
| sg-rajah | Rajah & Tann | [] | **HIDE** |
| hk-mb | Mayer Brown HK | [] | **HIDE** |
| hk-ke | Kirkland & Ellis HK | [] | **HIDE** |
| hk-skadden | Skadden HK | [] | **HIDE** |
| cn-kwm | King & Wood Mallesons | [] | **HIDE** |
| cn-junhe | Junhe LLP | [] | **HIDE** |
| cn-hankun | Han Kun Law Offices | [] | **HIDE** |
| in-khaitan | Khaitan & Co | [] | **HIDE** |
| in-azb | AZB & Partners | [] | **HIDE** |
| in-cyril | Cyril Amarchand Mangaldas | [] | **HIDE** |
| jp-amt | Anderson Mōri & Tomotsune | [] | **HIDE** |
| jp-na | Nishimura & Asahi | [] | **HIDE** |
| jp-mhm | Mori Hamada & Matsumoto | [] | **HIDE** |
| au-allens | Allens | [] | **HIDE** |
| au-hsf | Herbert Smith Freehills | [] | **HIDE** |
| au-gtlaw | Gilbert + Tobin | [] | **HIDE** |

**Demo result: 2 partners show (us-cooley, uk-bird), 25 hide.**

For a richer demo, add `co_quanta` (robotics → Kirkland/HK PE focus) and `co_kelvin` (energy → US/AU firms) with full profiles, which would unlock 3–4 more partners.

---

## 7. Conflict Resolver — Canonical Split Verification (24 Sync Entities)

From `capavate_collective_sync_field_map.md` and `SPRINT-13-SYNC-SUMMARY.md` (syncConflictResolver.ts: Capavate-wins 248 fields · Collective-wins 82 fields · latest-wins 42 fields · merge/computed 24 fields).

**Source of Truth Summary:**

| Category | SOT | Entities |
|---|---|---|
| Deals / rounds | **Capavate-canonical** | Round terms, instrument, valuation, round size, cap, discount, investor rights, expiry, lead investor |
| Cap-table positions | **Capavate-canonical** | Share counts, certificate numbers, share ranges, vesting, conversion prices, commitment amounts |
| Investor profiles (identity + KYC) | **Capavate-canonical** | Legal name, email, address, accreditation status, KYC documents, jurisdiction |
| Member shell (Collective membership) | **Collective-canonical** | `collective_memberships.status`, tier (Standard/Plus/Individual), `memberRole` (DSC vs non-DSC) |
| DSC scores | **Collective-canonical** | compositeScore, mnaScore, roundScore, autoTier, DSC votes |
| M&A rankings | **Collective-canonical** | acquirer-fit score, top-3 strategic buyer shortlist, comparable exits, revenue multiple range |
| Intro + social signals | **Collective-canonical** | `partner.introduction_status`, `network.social_signals` (followerCount, mentionCount, networkActivity) |
| Visibility / screen name | **Capavate-canonical** (investor choice) | screenName, visibleToCoMembers, visibleToCollectiveNetwork |
| PII (email, phone, address, EIN, KYC docs) | **Capavate-private** | VIS-1 through VIS-10 in sync_field_map.md |

### 7.1 Canonical Split Violations to Flag

| Entity | Violation | Note |
|---|---|---|
| `collective_memberships.status` | Collective-canonical in theory; but Sprint 13 inbound `member.application_decision` writes this to Capavate store — the Capavate copy should be a read-only replica, not a source of truth. Verify `syncConflictResolver.ts` applies `collective-wins` rule for this field. | Medium risk |
| `autoTier` badge | Collective-canonical (derived from DSC scores). Sprint 14 D5 hard-codes `M&A score gating per memberRole` on the Capavate side — this is a display rule (correct) not a SOT violation. | OK |
| `burnRate` | Capavate-private (VIS-8). Only `runwayMonths` (derived) should sync. Verify that `burnRate` is in the PII blocklist in `companySyncFields.ts`. | Verify |
| `softCircle.amount` | Capavate-private (VIS-7). Only aggregate totals should sync. Current bridge events send `amountClosed` in `round.closed` — this is the confirmed total (OK). Soft-circle individual amounts must NOT appear in any outbound payload. | Verify |
| `activeInvestorCommitments` | Capavate-private (VIS-9). Must not appear in `company.profile.updated` payload. Verify `COMPANY_SYNC_FIELDS` blocklist. | Verify |
| `dsc.scores` inbound | Collective-canonical. Sprint 14 D4 wires `dsc.scores` → `acquirerProfile.collectiveShortlist[]` + notification. The DSC vote content should never appear in founder view (only tier + top/bottom 3 dimensions). Verify DscSummaryCard renders aggregate only. | Per Sprint 14 D4 design — verify implementation |

---

## 8. Demo Seed Reset Plan

### 8.1 Data to Preserve

| Data | Reason |
|---|---|
| commsStore messages (cap-table + soft-circle channels) | They demonstrate the rich communications state; resetting would lose the NovaPay narrative |
| Network posts (post_n_1 through post_n_10, post_f_1 through post_f_5) | Demonstrate the social feed; preserve for Sprint 16 demo |
| Sprint 15 personas (u_maya_chen, u_aisha_patel, u_lapsed_lp, u_no_position, u_admin) | Auth demo requires these 5 |
| Collective member chapters for demo investors | Chapter data in COMMS_USERS |

### 8.2 Data to Reset

| Data | Reason |
|---|---|
| `bridgeStore.ts` outbox — remove premature `round.closed` event | Round rnd_novapay_seed is still active; closing it in the bridge seed creates confusing state |
| `captableCommitStore.ts` ledger | Reset to empty; replay through API in demo walkthrough |
| `bridgeStore.ts` inbox — partner.introduction_status for `p_y_combinator` | Replace with a real demo partner (us-cooley or uk-bird per §6 gating rule) |

### 8.3 Data to Re-Seed

| Data | Action |
|---|---|
| co_arboreal bridge events | Add `company.profile.updated` outbound event for Arboreal |
| co_quanta, co_kelvin full profiles | Create full profile objects in mockData.ts; seed bridge events |
| Investor eligibility for Hydra, Forge, Bluepoint | Add `investor.profile.updated` + `eligibility.recomputed` bridge events for each |
| Round ID standardization | Change all references from `rnd_seed` → `rnd_novapay_seed` in commsStore.ts |
| Partner portfolioCompanies | Add `portfolioCompanies: ["co_novapay"]` to us-cooley, `["co_arboreal"]` to uk-bird |
| `soft_circle.submitted` events | Add outbound bridge event type; seed 4 events (one per soft-circler) for rnd_novapay_seed |

### 8.4 Events to Replay Through Bridge

After reset, replay in this order:
1. `company.profile.updated` for co_novapay (with full round fields)
2. `company.profile.updated` for co_arboreal
3. `investor.profile.updated` + `eligibility.recomputed` for all 5 investors
4. `cap_table.mutated` for co_novapay (foundation + preseed rounds)
5. `soft_circle.submitted` × 4 (Hydra, Forge, Bluepoint, Aisha)
6. `company.ma_intelligence.updated` for co_novapay
7. Inbound: `dsc.scores`, `ma.intelligence_rankings`, `partner.introduction_status` (updated partnerId), `network.social_signals`
