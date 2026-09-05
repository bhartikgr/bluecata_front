# PRIOR TASK HISTORY — cross-session findings (carried into the package)

**Item DOC-3 / closes OPN-015.** The register recorded this file as
**absent**: *"`PRIOR_TASK_HISTORY.md` does not exist. It is named in the
`V4_BRIEF.md` MUST-READ table but is absent from `spec/`; its content survives
only in `turn_0048`'s assistant message."* A previous run reported writing the
path and did not. It has since been reconstructed from the past-context sweep
and now exists at `spec/PRIOR_TASK_HISTORY.md` (86 lines); this copy carries it
into the build package so the MUST-READ is reachable from the code tree.

> **GENERATED FILE — do not hand-edit.**
> Produced by `scripts/build_package_docs.py` from `spec/PRIOR_TASK_HISTORY.md`.
> `python3 scripts/build_package_docs.py --verify` fails if this file and
> its source have drifted apart, so an edit here is a gate failure, not a
> silent second source of truth. Change the spec, then regenerate.

---
# Prior Capavate task history — cross-session findings
**Reconstructed from the past-context sweep returned 2026-08-09.** The original run reported writing this path but did not; the register caught its absence while `V4_BRIEF.md` still listed it as a MUST-READ. Content below is the sweep's returned findings verbatim in substance.

Purpose: prevent re-litigating settled decisions and rebuilding delivered capabilities.

---

## 1. Percentage / discount / fee rates — canonical rule exists

- Session `37ed9547` (2026-08-07→09): owner ruled **"There should still be a discount. Do not drop. 1=1%. 100=100%."** Legacy fractions remain in discount and commission paths. `YC2025=0.3` intentionally left unresolved. (`memory/sessions/2026-08-03_2026-08-09/37ed9547/conversation.md:L351-L367`)
- Earlier analysis found three live conventions: fractions, basis points (`partner_fee_schedules.pct_bps`), percent-as-written for carry. Standardisation requested; **no confirmed shipped migration**. (`.../37ed9547/conversation.md:L1014-L1041`; `memory/sessions/2026-07-27_2026-08-02/174109f0/conversation.md:L935-L937`)
- **ADR-5 concerns integer money / minor-unit representation, NOT percentage semantics.** No prior `pct_micro` implementation and no percentage ADR exist. Hundredths-of-a-percent storage makes `100 = 1%`, contradicting the ruling. (`.../174109f0/conversation.md:L719`)

> Consequence: `pct_micro` is dead. `PERCENT_POLICY_v2.md` supersedes it.

## 2. Consortium Partner silo — "built" ≠ live or used

- `89e66bba` (2026-07-09): v26.0.0 packaged Waves D/B/C/E/F1/F2/F3 — identity, SPV-to-cap-table, dynamic plans/pricing, agreement labelling, CRM parity, styling, reconciliation, banners. **Explicitly deferred:** automatic rev-share trigger (gateway was amount-only), quota enforcement, full SPV lifecycle E2E. (`.../89e66bba/conversation.md:L82-L119`)
- `65e6412e` (2026-08-01→03): Wave C v3.1 shipped — eight UI panels, disabled Deploy, strict parsers, backend errors, IDOR protection. Wave B v26.4.0 packaged but not live. (`.../65e6412e/conversation.md:L824-L836`)
- `e957e607` (2026-08-05→07): C-2 code-complete with 140+ tests; D1a/D1b/D2 and LOCK4/LOCK5 prepared or applied with waivers; installation/migration defects and sign-off outstanding. (`.../e957e607/conversation.md:L230-L247`, `L559-L565`; project wiki `projects/capavate-institutional-spv-program.md:L20-L23,L33,L44-L48`)

## 3. SPV engine — canonical engine exists; institutional layer incomplete

- The "one engine / three contexts" model, LP-as-cap-table-investor, `commitFunded` invite flow, jurisdiction-dependent entities, fail-closed deployment and two-layer fees were implemented in v25.49–v25.50. (`projects/capavate-spv-engine.md:L18-L50`)
- Planned order: Wave A foundation → B storage consolidation → C UI unblock → **D capital calls/reporting** → E NAV/waterfall/K-1/side letters → F admin. Deploy was hard-disabled; only 3 of 11 tabs performed writes. NAV, K-1, investor reports and side letters not confirmed built. (`.../174109f0/conversation.md:L434-L490`)
- **LP storage split (now CLOSED).** Owner first approved the unified cap-table ledger; ADR-7 later proposed `spv_subscription` parity; the live route already writes `captable_commits`. (`.../174109f0/conversation.md:L670-L737`)

> **Resolved 2026-08-09 (Q1 = A):** unified cap-table ledger is canonical. ADR-7 formally withdrawn. Contest C-1 closed.

## 4. Fund / portfolio metrics — groundwork only

- Real position wiring exists; a separate marks service was identified but not built. Marks default `currentValue = invested`, yielding placeholder MOIC 1.00x and IRR 0%. TVPI/DPI/IRR definitions and ILPA/GIPS treatment were an **open owner decision**, not a shipped system. (`.../37ed9547/conversation.md:L210-L212,L1002-L1003`; `projects/capavate-institutional-spv-program.md:L29-L30`)

## 5. Airwallex / payment gateway — incomplete

- Cancellation was local DB state only; no Airwallex API call. The SPV fee endpoint had no real gateway charge. (`.../174109f0/conversation.md:L147-L152`; `.../37ed9547/conversation.md:L849-L903`)
- Owner decided **Option A first, then Option B** with repeated testing — a decision, not a shipment. Founder Billing UI exists but redirects into a dead/circular route. (`.../37ed9547/conversation.md:L979-L1041,L1049`, `L387-L398`)

## 6. Subscriptions / annual fees — policy decided, partner implementation missing

- Pricing must be admin/DB-driven. Founder billing is annual; cancellation stops renewal while preserving access; refunds are not automatic. Partner annual pricing must be dynamic and discountable. (`memory/notes/projects/capavate/pricing/admin_source_of_truth.md:L5`; `.../174109f0/conversation.md:L313-L339`; `.../37ed9547/conversation.md:L199-L208`)
- **Partner subscription storage, annual cycle, discount application and checkout were NOT built**; annual pricing was hardcoded as monthly × 12. (`projects/capavate-collective.md:L44-L47`)

> Nuance confirmed 2026-08-09: the eight consortium price rows DO exist in `platform_fees`. The catalogue exists; the billing machinery does not. Discount application also exists (`paymentStore.ts:160-175`) but `partnerSelfServiceRoutes.ts` never calls it.

## 7. Audit chains / sync — repair shipped, bridge broken

- Wave A-1 v2.3 shipped ADR-3 hash-chain repair, dangling/tampered-anchor detection, bounded verification, migration 0124. (`.../65e6412e/conversation.md:L824-L836`)
- The bridge has no consumer, `BRIDGE_ENABLED=0`, archived/backlogged queue; latest audit reports 629 queued events and CHAIN BROKEN. Outbox persistence improved, but this is not working outbound sync. (`.../174109f0/conversation.md:L369,L590-L596`; `.../37ed9547/conversation.md:L375`; `projects/capavate-collective.md:L35-L39`)

## 8. Sacred files / LOCK4 / LOCK5 / silent-drop guard

- The anti-silent-drop guard was built in **v26.1.0 by the task build agent, not Avi**: hard-fail inventory comparison, explicit allowlist, baseline, README, tests, build hook, 9 passing tests. Owner chose **hard-fail + allowlist** for approved removals. (`memory/sessions/2026-07-06_2026-07-12/89e66bba/ai_outputs/CHANGELOG_v26.1.0_FULL.md:L18-L24`; `.../89e66bba/conversation.md:L273-L275`)
- LOCK4 covers four-pillar sync/SSE. LOCK5 covers delegated invitation/representation refactoring. Early work was diff-only requiring human application; C-2.j/D2 later applied narrow waivers, 140+ tests passing. (`.../e957e607/conversation.md:L119-L122,L266-L280,L559-L565`)

## 9. Managed Founder CRM — server built, UI absent

- `5023081c` (2026-07-16→20): W-MFCRM, W-ANGEL, W-ACCT, W-LAW unanimously marked shipped/dark-shipped — one model, capability gates, **12 tables, 40 endpoints**, angel/accounting/law personas, attribution, handover, pricing/trial, SPV-on-behalf. (`.../5023081c/conversation.md:L102-L150,L260-L274`)
- Latest audit: all 17 persona routes exist server-side, **zero client implementation**. Managed Founders has zero buttons/mutations and three working endpoints. Owner: **"Functionality that exists should be all reflected in the UI"** and **"Make it all work in the front end."** (`.../37ed9547/conversation.md:L535-L620,L642-L643`)

## 10. Standing architectural rules — authoritative

- **"No hard coding. No in-memory ANYWHERE. All dynamically DB driven."**
- **"RESTORE!!! What were dropped. NEVER silent drop anything."** (`.../37ed9547/conversation.md:L351-L353`)
- **"Always ask questions… Never silent drop any functionality/widgets… Always independently triple test."** (`.../37ed9547/conversation.md:L27-L35`)
- Unified ledger, frozen canonical stores, **extend rather than replace**, one `commitFunded` engine, **no fork**. (`.../89e66bba/ai_outputs/CHANGELOG_v26.1.0_FULL.md:L7-L14`; `.../5023081c/conversation.md:L92-L96`)

---

## ALREADY DECIDED — do not re-ask

1. Percentage semantics: **1=1%, 100=100%**. Do not silently remove discounts.
2. Pricing and fees are dynamic, admin-set, DB-driven. No hardcoded values, no in-memory source of truth.
3. Airwallex: **Option A first, then Option B**, repeated testing. Do not claim gateway completion.
4. Annual founder billing; cancellation stops renewal without automatic refund; partner annual pricing dynamic and discountable.
5. One canonical SPV engine and ledger. Reconcile existing stores before replacing anything.
6. Never silently drop functionality. Use the guard and allowlist; document deferrals and descopes explicitly.

## ALREADY BUILT — do not rebuild

1. Wave A-1 audit-chain repair and bounded verification.
2. The anti-silent-drop guard with baseline, allowlist and test suite.
3. Canonical SPV engine foundations: LP invite / `commitFunded`, cap-table investor representation, jurisdiction and entity selection, fail-closed deployment, two-layer fee model.
4. Wave C v3.1 UI/backend foundation; packaged Consortium Partner Waves D/B/C/E/F1/F2/F3.
5. Managed Founder CRM server engine and the angel/accountant/lawyer persona routes. Remaining work is activation, DB seeding and UI wiring.
6. Partner commission-rate endpoint and admin per-tier rates. Do not recreate rate storage before standardising semantics.
