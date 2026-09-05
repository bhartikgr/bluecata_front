# DO NOT BUILD — capabilities that already exist in this tree

**Item DOC-2.** *Carry the 12-item DO-NOT-BUILD list (11–15 engineer-weeks
saved) into the package.*

> **GENERATED FILE — do not hand-edit.**
> Produced by `scripts/build_package_docs.py` from `spec/PRIOR_ART_SWEEP.md §2`.
> `python3 scripts/build_package_docs.py --verify` fails if this file and
> its source have drifted apart, so an edit here is a gate failure, not a
> silent second source of truth. Change the spec, then regenerate.

## Read this before starting any feature

Each of the 12 capabilities below was **already built** in
`/home/user/workspace/work` at the time of the v26.7.3 prior-art sweep, and was
about to be built a second time. Every `file:line` in the table was opened and
read, not inferred. **Total estimated effort saved: roughly 11–15 engineer-weeks.**

Three of the briefing's own claims were wrong in the direction that costs the
most: it asserted there was *no capital-calls route* (there is one, with a client
form), *no fee-configuration UI* (a 2,091-line console), and *no XIRR* (a
Newton-Raphson implementation with a reference cross-check test). The
expensive failure mode on this platform is not missing code, it is **code that
exists, works, and has no route or no caller** — so it is invisible from the UI
and reads as absent.

**The correct action for anything on this list is WIRE or REUSE, never BUILD.**
If you cannot reach a capability from the UI, first prove it does not exist
server-side. An engine with no route is not shipped — but it is also not
missing, and rebuilding it produces two divergent implementations of the same
rule, which is strictly worse than one dormant implementation.

## The list (12 items)

| # | Capability | Where it already lives | Effort saved (est.) |
|---|---|---|---|
| 1 | **Capital calls** (store, routes, hash chain, schema, migrations, tests, *and* client form) | `server/spvFundStore.ts:1477`, `:1491`; `client/src/pages/partner/PartnerSpvDetail.tsx:129-146`, `:238-254` | **2–3 weeks** — the briefing was about to rebuild an entire fund-accounting subsystem |
| 2 | **Fee configuration admin UI** — ~14 configurable fee surfaces with source-of-truth labelling | `client/src/pages/admin/AdminFeesConsolidated.tsx` (2,091 lines), routed `App.tsx:822` | **1.5–2 weeks** |
| 3 | **XIRR / portfolio metrics math** — Newton-Raphson, Decimal.js, reference cross-check test | `packages/math-fns/src/index.ts:197-241`; `packages/math-fns/test/reconcile.test.ts:90-102` | **3–5 days** |
| 4 | **Document storage with real bytes** — S3/fs, sha256, fail-closed, orphan rollback, permissions, download, audit events | `server/dataroomStore.ts:598-693`; `server/lib/objectStorage.ts:158-221` | **1–1.5 weeks** |
| 5 | **Gateway charge primitive + SPV fee charging** — idempotent, prod/demo gated, 3DS, invoicing; SPV fees already on it | `server/paymentGatewayAdapter.ts:212-283`; `server/spvEngineStore.ts:720-756`; `server/spvEngineRoutes.ts:253-259` | **1–2 weeks** |
| 6 | **Annual subscription billing** — cycle field, 365-day period math, annual pricing, founder checkout | `server/subscriptionStore.ts:43-60`; `server/paymentGatewayAdapter.ts:1574`; `server/routes.ts:4552-4600` | **1 week** |
| 7 | **Task tracking with status + due date + assignee** — plus two live CRM task surfaces | `server/partnerWorkspaceStore.ts:2207-2247`; `server/crmStore.ts:545-584`; `server/partnerWorkspaceV19Store.ts:2132-2152` | **4–6 days** |
| 8 | **17 Managed-Founder persona endpoints** + a 4-persona switcher with entitlement gating, persistence, URL params | `server/managedFounderPersonaRoutes.ts:47-197` (registered `server/routes.ts:956`); `client/src/components/PersonaSwitcher.tsx` | **2–3 weeks** (server side wholly done) |
| 9 | **Jurisdiction ontology** — 15 curated countries + per-country legal-entity map + a governed region-extension workflow | `shared/spvEngine.ts:94-137`; `client/src/lib/regions.ts:19-34`; `server/regionExtensionStore.ts` | **1 week** |
| 10 | **SSE infrastructure incl. partner topics** — 19 topics, partner-membership authorization, SPV event publishers, tests | `server/lib/sseHub.ts:32-57`, `:116`, `:174`; `server/collectiveSseRoutes.ts:29-32` | **1–1.5 weeks** |
| 11 | **Percent standardization analysis** — full convention inventory (A–G), five documented collisions, a drafted policy v1 | `spec/OQ4_OQ12_ANSWERS.md:282-560` | **3–4 days of analysis** |
| 12 | **Audit-chain genesis anchoring + verification** — table, fail-closed verifier, boot tick, admin health surface | `migrations/0124_wave_a1_audit_seed_repair.sql:15-46`; `server/adminPlatformStore.ts:600-640` | **4–5 days** |

**Total estimated effort saved: roughly 11–15 engineer-weeks.**

---

**Caveat, carried deliberately.** "Already exists" is not "already shipped".
Several of these are BUILT + ORPHANED: the 17 Managed-Founder persona endpoints
have zero client callers, the partner SSE topics have no subscriber, and the
partner task store is dormant behind an unrouted page. The effort saved is real,
but so is the wiring still owed. Do not read a row here as a completed feature.

**Provenance.** Extracted from `spec/PRIOR_ART_SWEEP.md` §2 ("HEADLINE: DO NOT
BUILD — already exists"). The generator asserts exactly 12 rows numbered 1..12
and refuses to emit a partial list.
