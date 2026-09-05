# CORRECTION LEDGER — COR-001 … COR-050

**Item DOC-1.** *Carry the 50-row correction ledger into the Avi build package
so no corrected fact is re-broken.*

> **GENERATED FILE — do not hand-edit.**
> Produced by `scripts/build_package_docs.py` from `spec/SESSION_TRACEABILITY_REGISTER.md §3`.
> `python3 scripts/build_package_docs.py --verify` fails if this file and
> its source have drifted apart, so an edit here is a gate failure, not a
> silent second source of truth. Change the spec, then regenerate.

## How to use this file

Each row is a claim that was **believed, acted on, and then proven wrong**.
The reason it travels with the code is that a corrected fact re-breaks easily:
the original wrong claim is still written down in older specs, briefs and
review documents, so the next reader can re-derive it in good faith.

**Before you "fix" something in this tree, search this ledger for it.** If it
appears here, the defect was already investigated and the finding reversed —
re-introducing it is a regression, not a fix. 0 of these 50 rows carry an
explicit owner ruling and are not open to re-litigation.

The canonical worked example is **COR-001**: the "SPV tab defect" was not real.
Radix `TabsTrigger` fires on `onMouseDown`, and the audits drove it with
`element.click()`, which never produces that event. The audit tooling was
broken, not the tabs. Every click-dependent finding from that run was then
quarantined as COR-002. A future audit that uses `.click()` on Radix tabs will
manufacture the same phantom defect again.

## The ledger (50 rows)

| ID | Category | Item | Source (file:line or turn) | Owner-ruled? | Status |
|---|---|---|---|---|---|
| COR-001 | CORRECTION | SPV tab defect NOT REAL — a testing artifact; Radix `TabsTrigger` fires on `onMouseDown` and the audits used `element.click()`. **B-05 deleted** — not deferred, not renamed | `V4_BRIEF.md:89`; `CONSORTIUM_PARTNER_BUILD_v3.md:19-34` | N | REVERSED |
| COR-002 | CORRECTION | Q-1..Q-10 quarantine of every click-dependent v1 finding: Q-1..Q-7 and Q-10 DISPROVEN, Q-8 RE-TEST REQUIRED (B-QA-1), Q-9 FALSE in v26.7.3 | `CONSORTIUM_PARTNER_BUILD_v3.md:48-59` | N | REVERSED |
| COR-003 | CORRECTION | Four commitments recovered from the false defect and reclassified ALREADY DELIVERED end-to-end: SPV-38, SPV-39, SPV-40, SPV-41 | `CONSORTIUM_PARTNER_BUILD_v3.md:69-72` | N | REVERSED |
| COR-004 | CORRECTION | `NOT_PAID_SUBSCRIBER` refers to the **target founder company**, not the partner | `V4_BRIEF.md:90` | N | REVERSED |
| COR-005 | CORRECTION | Negative-shares regex change WITHDRAWN — `commitFunded` already gates `BigInt > 0`, and `/^[1-9]\d*$/` would reject `"0"` and break SAFE/convertible deployments | `V4_BRIEF.md:91`; `BUILD_REMEDIATION_v2.md` R-4 | N | REVERSED |
| COR-006 | CORRECTION | B-04 ladder is FIVE rungs (`review → soft_circled → founder_confirmed → wire_funded → committed`), and the server does NOT enforce order (`spvEngineStore.ts:1008`) — sequencing is a client responsibility | `V4_BRIEF.md:92` | N | REVERSED |
| COR-007 | CORRECTION | `PartnerFunds` "no route" claim FALSE — `App.tsx:1202-1204` is a deliberate redirect; this converts B-17 from a wiring task to a product reversal (→ OQ-3) | `V4_BRIEF.md:93`; `CONSORTIUM_PARTNER_BUILD_v3.md:113` | N | REVERSED |
| COR-008 | CORRECTION | The 10 orphaned `spvFundStore` routes were a FALSE ALARM — `routes.ts:1141` re-registers all 10 via `spvLegacyAdapters.ts` with a parity test | `V4_BRIEF.md:94`; `OQ23_REMOVED_SURFACES_DELTA.md` §3 | N | REVERSED |
| COR-009 | CORRECTION | Capital calls are BUILT AND WIRED — `spvFundStore.ts:1477`/`:1491`, SSE `:1511`, client form `PartnerSpvDetail.tsx:129-146`; only the navigation link is missing | `V4_BRIEF.md:95`; `PRIOR_ART_SWEEP.md` §4.1 | N | REVERSED |
| COR-010 | CORRECTION | LP invites are BUILT and reuse the shared `createInvitation()` (`spvEngineRoutes.ts:556` → `roundInvitationsStore`); the client caller exists at `PartnerSpvDetail.tsx:95` and the page IS routed at `App.tsx:1193` — the fix is a link, not a client build | `V4_BRIEF.md:96`; `PRIOR_ART_SWEEP.md` §4.2 | N | REVERSED |
| COR-011 | CORRECTION | The anti-drop guard ALREADY EXISTS at `scripts/silent-drop-guard/` with `baseline.json`, `allowlist.json` and `npm run guard` (`package.json:10,12`) — extend it, never build a rival | `V4_BRIEF.md:97`; `BUILD_REMEDIATION_v2.md` R-7 | N | REVERSED |
| COR-012 | CORRECTION | `pct_micro` INVERTS the owner ruling and is dead | `V4_BRIEF.md:98`; turn_0048 | Y (OR-1) | REVERSED |
| COR-013 | CORRECTION | ADR-5 governs money **minor units**, not percentages — it must never be cited for a percent decision | `V4_BRIEF.md:98`; turn_0048 | N | REVERSED |
| COR-014 | CORRECTION | The "only two correct write clamps" claim was wrong — **three** exist; the third is `partnerFeeAdminRoutes.ts:181-184` (previously counted: `partnerCommissionRateResolver.ts:112-114`, `spvEngineStore.ts:557-559`) | `V4_BRIEF.md:99`; `OQ4_OQ12_ANSWERS.md` §2.2 | N | REVERSED |
| COR-015 | CORRECTION | Discount application EXISTS at `paymentStore.ts:160-175`; the error was claiming it was missing — `partnerSelfServiceRoutes.ts` simply never calls it | `V4_BRIEF.md:100` | N | REVERSED |
| COR-016 | CORRECTION | `RequireAuth.tsx`, `dataroomStore.ts` and `spvEngineStore.ts` are NOT in the 40-entry sacred baseline — no waiver is needed for them | `V4_BRIEF.md:101` | N | REVERSED |
| COR-017 | CORRECTION | A global 100 clamp is WRONG — `traction_growth_pct` legitimately exceeds 100 | `V4_BRIEF.md:102`; `PERCENT_POLICY_v2.md` P.5 | N | REVERSED |
| COR-018 | CORRECTION | B-06 must NOT be wired — v1 asserted in three places that the charge routes through the real payment ledger; it routes through the payment **ledger table**, not a payment **gateway** (corrected in B-06, `PARTNER_GAP_LOCATION.md` §3 row 31 / SPV-22, and §7.1 SPV-22) | `CONSORTIUM_PARTNER_BUILD_v3.md:79-96`; `BUILD_REMEDIATION_v2.md` R-2 | N | REVERSED |
| COR-019 | CORRECTION | v1 "32 build items" → actually **33** headings | `CONSORTIUM_PARTNER_BUILD_v3.md:104` | N | REVERSED |
| COR-020 | CORRECTION | v1 item efforts "sum to 36.0 d" → actually **35.0 d** | `CONSORTIUM_PARTNER_BUILD_v3.md:105` | N | REVERSED |
| COR-021 | CORRECTION | v1 "total 63.5 d" → actually **62.5 d** (Wave 1 is 14.5, not 15.5) | `CONSORTIUM_PARTNER_BUILD_v3.md:106` | N | REVERSED |
| COR-022 | CORRECTION | v1 "critical path 6.5 d" was only the money-chain branch; v1's own S1+S9 = 13.0 d | `CONSORTIUM_PARTNER_BUILD_v3.md:107` | N | REVERSED |
| COR-023 | CORRECTION | Decision-sheet tally A=14/B=8/C=15 → actually **A=15 / B=7 / C=16** across 37 IDs and 38 rows | `CONSORTIUM_PARTNER_BUILD_v3.md:108`; `PARTNER_UI_PROMISES_DECISION_SHEET.md:63` | N | REVERSED |
| COR-024 | CORRECTION | `server/db/hydrateStores.ts:700` does not exist — the real path is `server/lib/hydrateStores.ts:700` | `CONSORTIUM_PARTNER_BUILD_v3.md:109` | N | REVERSED |
| COR-025 | CORRECTION | B-22 CRM notes+tasks routes are in `partnerWorkspaceV19Store.ts:2116/:2133/:2156`, not `partnerWorkspaceStore.ts` | `CONSORTIUM_PARTNER_BUILD_v3.md:110` | N | REVERSED |
| COR-026 | CORRECTION | B-23 `partnerWorkspaceStore.ts:987` is not an "activity write" — it is `bd: 3`, a sub-role rank in a precedence map | `CONSORTIUM_PARTNER_BUILD_v3.md:111` | N | REVERSED |
| COR-027 | CORRECTION | `connection.ts` table creation was cited reversed — `:5106` creates `partner_tasks` and `:5115` creates `partner_files` | `CONSORTIUM_PARTNER_BUILD_v3.md:112` | N | REVERSED |
| COR-028 | CORRECTION | B-24 "13 routes" → 14 cited | `CONSORTIUM_PARTNER_BUILD_v3.md:114` | N | REVERSED |
| COR-029 | CORRECTION | B-15 targets `/admin/partners/:id`, a path **already owned** by `AdminPartnerDetail` (`App.tsx:151` import, `:828` route) — a route collision, contradicting v1 B-30 | `CONSORTIUM_PARTNER_BUILD_v3.md:115`; `BUILD_REMEDIATION_v2.md` R-6 | N | REVERSED |
| COR-030 | CORRECTION | SPV-21 helper strings are NOT runtime-composed — they are real literals at `shared/spvEngine.ts:446-450`, consumed at `PartnerSpvEngine.tsx:533` | `CONSORTIUM_PARTNER_BUILD_v3.md:116` | N | REVERSED |
| COR-031 | CORRECTION | The comment at `applyRouteGuards.ts:107` says "20 pre-existing entries" but `PUBLIC_API_PREFIXES` (`:40`) has **18** — recorded, not fixed | `CONSORTIUM_PARTNER_BUILD_v3.md:117` | N | RECORDED |
| COR-032 | CORRECTION | The v2 anti-drop counts were wrong; corrected to NAV 16, TABS 16, BUTTONS 106, EVENTS 232 | `BUILD_REMEDIATION_v2.md` R-7 | N | REVERSED |
| COR-033 | CORRECTION | v2 citation error rate was self-reported 0.0% and measured by review at 8.3%; a later re-measure put it at 14.0% and TS baseline at 599 | `BUILD_REMEDIATION_v2.md` R-12; `CONSORTIUM_PARTNER_BUILD_v3.md:119` | N | REVERSED |
| COR-034 | CORRECTION | 20 commitments vanished between inventories — SEAT-03, SPV-47, BRG-04, BRG-05 missing outright plus 16 BE-INCOMPLETE rows dropped; restored to reach the 196 reconciliation | `BUILD_REMEDIATION_v2.md` R-8; `CONSORTIUM_PARTNER_BUILD_v3.md:1338` §6 | N | REVERSED |
| COR-035 | CORRECTION | v2's own §7 was self-contradictory about whether OQ-1 blocks the build; corrected — OQ-1 constrains B-06R only and blocks nothing | `CONSORTIUM_PARTNER_BUILD_v3.md:1423` | N | REVERSED |
| COR-036 | CORRECTION | "Item A line numbers" corrected — the CAGR formula is on `:143`, the function spans `:140-144`; the sparkline lines `:161-162` were right | `PRIOR_ART_SWEEP.md` §4.3 | N | REVERSED |
| COR-037 | CORRECTION | Item A is **worse** than briefed — fabricated proceeds `:129-131`, pinned `currentValue` `:100`, hardcoded cohorts `:207-212`, literal year `:141` all in addition to CAGR-as-IRR and sparklines | `PRIOR_ART_SWEEP.md` §4.4 | N | EXPANDED |
| COR-038 | CORRECTION | Item E — the prior percent work produced a **document, not code**; `pct_micro` appears nowhere in the tree and no percent helper file exists | `PRIOR_ART_SWEEP.md` §4.5 | N | REVERSED |
| COR-039 | CORRECTION | Item J premise understated prior art — a 15-country list with a per-country legal-entity map already exists at `shared/spvEngine.ts:94-137`; the collapse is a documented consequence of not changing the enum, not an oversight | `PRIOR_ART_SWEEP.md` §4.6 | N | REVERSED |
| COR-040 | CORRECTION | Item F — the SPV fee path already reuses the shared charge ledger (`spvEngineStore.ts:54`, `:720-756`); the gap is a missing client caller, not a missing server path | `PRIOR_ART_SWEEP.md` §4.7 | N | REVERSED |
| COR-041 | CORRECTION | OQ-7 "already built" was stated too strongly — 8 price rows are real, but the billing machinery is absent | turn_0048; `V4_BRIEF.md:44` | N | 🔴 CONVERSATION-ONLY · REVERSED |
| COR-042 | CORRECTION | `PARTNER_UI_PROMISES_DECISION_SHEET.md` carries its own 🔴 RE-TEST REQUIRED banner — a methodology failure affected the sheet, and rows derived from it must be re-verified before use | `PARTNER_UI_PROMISES_DECISION_SHEET.md:38` | N | RE-TEST REQUIRED |
| COR-043 | CORRECTION | v1's `PartnerSpvs` / `PartnerFunds` "surfaces removed" narrative corrected into a four-way delta: SUPERSEDED (1, 2), LOST (1b, 2b, 3, 4), NOT LOST (the 10 spvFundStore routes) | `OQ23_REMOVED_SURFACES_DELTA.md` §1-§3 | N | REVERSED |
| COR-044 | CORRECTION | `PartnerFiles` was near-zero value and its removal was **deliberate** — recorded as LOST-BY-DESIGN rather than as an accidental drop | `OQ23_REMOVED_SURFACES_DELTA.md:26` | N | RECLASSIFIED |
| COR-045 | CORRECTION | Incident correction — a spec file (`13_WAVE_D_spv.md`) was truncated to 0 bytes by `open(p,"w")`; unrecoverable; rebuilt to 1,256 lines against an original 1,343 | `INCIDENT_WAVE_D_FILE_LOSS.md` | N | REPAIRED (87 lines unrecovered) |
| COR-046 | CORRECTION | The `spv.*` unregistered-event count is cited as **21** in one place and **36** in another; the discrepancy is flagged and unresolved | `PROPAGATION_CHECKLIST_v4_2026_08_09.md` §3 | N | FLAGGED (see OPN-009) |
| COR-047 | CORRECTION | Sacred-manifest correction — the sacred file count moved from 40 to **47** in v3's gate section, with 38 OK / 2 FAILED reported against the manifest | `CONSORTIUM_PARTNER_BUILD_v3.md:1560-1616` | N | UPDATED |
| COR-048 | CORRECTION | `Login.tsx` real path corrected to `client/src/pages/auth/Login.tsx`, sha256 `c24bc4c20b59fa318212026a88d5e07df392596aafd37f0790f65930bb1eaa4c` | `CONSORTIUM_PARTNER_BUILD_v3.md` §8; `00_SHARED_STANDARDS.md:59` | N | CORRECTED |
| COR-049 | CORRECTION | v1's own count of "33 items" was restructured to **34** in v3 after 7 deletions and 6 additions plus the B-32→B-00 rename | `CONSORTIUM_PARTNER_BUILD_v3.md` §12 | N | RESTRUCTURED |
| COR-050 | CORRECTION | v2 classified 24 of 33 items as not executable as written | `BUILD_REMEDIATION_v2.md` R-12 | N | REVERSED IN v3 |

---

**Provenance.** Extracted from the CORRECTION section of
`spec/SESSION_TRACEABILITY_REGISTER.md`, which states: *"None of these may be
re-introduced in v4."* Row count and id contiguity (COR-001..COR-050) are
asserted by the generator; a short or gapped extraction is a hard failure
rather than a shorter document.
