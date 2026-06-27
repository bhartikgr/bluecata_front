# Capavate — Developer Handoff

**Last updated**: May 9, 2026 (after Sprint 13)
**Status**: Production-ready preview. Cutover-ready to replace live capavate.com paired with the existing Collective platform.

## Project structure

```
capavate-app/
├── client/              # Vite + React 18 + wouter v3 + TanStack Query v5 + Tailwind + shadcn/ui
│   └── src/
│       ├── pages/       # 42 routes: founder/, investor/, admin/, auth/, plus Notifications + CollectivePreview
│       ├── components/  # CompanySwitcher, NotificationBell, CapCollectiveToggle, CollectiveDeepLink, etc.
│       ├── lib/         # regions.ts (REGIONS_ALL — 9 regions), theme.tsx (light-locked), glossary, etc.
│       └── App.tsx      # Route registration
├── server/              # Express runtime (Fastify migration flagged for Sprint 14)
│   ├── routes.ts        # All API endpoints
│   ├── lib/             # bridgeRuntime, bridgeOutbound, bridgeInbound, syncConflictResolver,
│   │                    # driftDetector, migrationRunner, syncDashboard, emailStore, notifyStore,
│   │                    # adminPricingStore, captableCommitStore, dataroomStore, etc.
│   └── __tests__/       # 64 test files, 498 tests
├── shared/
│   └── schemas/sync/    # 24 canonical entity schemas with toCollectivePayload/fromCollectivePayload/
│                        # mergeWithConflicts/applyVisibilityFilter
├── packages/
│   ├── cap-table-engine/      # Primary engine (BigInt shares, decimal.js prices)
│   ├── cap-table-engine-ref/  # Independent reference engine for reconciliation
│   └── glossary/              # 56 financial terms
└── scripts/
    └── check-math-integrity.sh  # CI gate — 53 math-critical tests must pass
```

## Quick start

```bash
npm install
npm run dev      # Backend on port 5000 + Vite frontend
npm test         # Run all 498 tests
npm run build    # Production build → dist/public + dist/index.cjs
bash scripts/check-math-integrity.sh   # Math regression gate
```

## Key environment variables

- `COLLECTIVE_WEBHOOK_URL` — set to flip bridge to live mode (default: mock)
- `COLLECTIVE_WEBHOOK_SECRET` — HMAC secret for outbound + inbound verification
- `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE` — Auth0 config (Auth0 locked but mock auth in preview)
- `STRIPE_SECRET_KEY` — flagged for Sprint 14 production hardening

## Architecture references (in /home/user/workspace/, included in source zip as docs/)

- `capavate_master_build_spec.md` (5,154 lines) — R200 v1.0 master spec
- `capavate_collective_sync_field_map.md` (1,352 lines) — 24 entities, 396 fields, source-of-truth rules
- `capavate_collective_sync_schema.md` — telemetry §9 envelope shape
- `capavate_gating_addendum.md` — token + privacy + visibility model
- `SPRINT-{6,7,8,9,10,11,12,13}-*.md` — sprint deliverables
- `collective_*_audit.md`, `capavate_live_*_audit*.md` — live audit findings

## Critical invariants (DO NOT REGRESS)

1. **Cap-table math integrity** — `bash scripts/check-math-integrity.sh` must show 53/53 OK.
   Property tests cover: ownership-sums-100% across 9 regions × 7 instruments, share conservation, anti-dilution monotonic, ESOP refresh, warrant intrinsic value, IRR/MOIC/TVPI/DPI, dual-engine reconcile.

2. **Sandbox-safe client code** — NEVER use `localStorage`, `sessionStorage`, `indexedDB`, Pointer Lock, or Fullscreen APIs. Use in-memory module variables or backend session/store. Run:
   ```bash
   grep -rn "localStorage\|sessionStorage\|indexedDB" client/src/ --include="*.ts" --include="*.tsx"
   ```
   Only JSDoc comment matches are acceptable.

3. **Light-mode only** — `tailwind.config.ts` must keep dark mode disabled. Theme provider locks light at mount in `client/src/lib/theme.tsx`.

4. **9-region constant** — every region dropdown reads from `client/src/lib/regions.ts` `REGIONS_ALL`. Never hardcode region lists elsewhere.

5. **Bridge HMAC + hash chain** — every outbound event signed, idempotency key set, hash-chained. `auditChain.priorHash → hash` must verify clean.

6. **Token-gated investor entry** — investors NEVER self-signup. Only token-gated invitation entry. Verify `Sprint 7` gating still enforced.

## Production cutover plan (live capavate.com → this build)

1. Provision Postgres + RLS, real Auth0 tenant, real DocuSign tenant, real Stripe Connect (Sprint 14 work)
2. Set `COLLECTIVE_WEBHOOK_URL` + `COLLECTIVE_WEBHOOK_SECRET` to flip bridge to live mode
3. Run migration dry-run at `/admin/migration` against live capavate.com export → review diff
4. Commit migration → bridge syncs all 24 entities to Collective
5. Cutover DNS
6. Drift detector at `/admin/sync` watches for drift; DLQ catches any failed events with admin replay (SES sign-off gated)

## Test inventory (498/498 passing)

| Category | Count |
|---|---|
| cap-table-engine + ref + reconcile + ledger | ~75 |
| Region packs (9 regions × instruments) | ~88 |
| Telemetry + cohort | 13 |
| Sprint 9 communications | 25 |
| Sprint 10 investor surface | 32 |
| Sprint 11 founder + multi-co + region + light | 46 |
| Sprint 12 admin + bridge + notify + email | 48 |
| Sprint 13 sync (7 files) | 118 |
| Property tests (math integrity gate) | 53 |
| Other client + integration | ~118 |

## Known deferred items for Sprint 14

- Postgres + Row-Level Security migration from in-memory stores
- Real Auth0 tenant config (currently mock auth in preview)
- Real DocuSign integration (SES module exists, real API not wired)
- Real Stripe Connect (placeholders with explicit demo banners)
- Fastify migration per R200 §25.1
- Real SSE in deployed env (currently 30s polling fallback)
- Live Collective webhook secret rotation
- Bundle code-splitting (currently 1.88MB raw, 505KB gzipped)
- TypeScript BigInt-literal warnings in legacy cap-table-engine-ref code

## Contact

This is Ozan Isinak's project at Capavate / Blueprint Catalyst Limited. The platform replaces the live Capavate at capavate.com paired with the existing Collective angel-investor network.
