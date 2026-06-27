# Wave F3 — Playwright E2E suite

Browser-driven end-to-end tests that exercise the full Capavate stack (server +
client + router) as a real user would. They complement — they do **not**
replace — the 2 831-test vitest suite. Vitest catches unit/integration
regressions; this suite catches "fix-X-break-Y" regressions that only manifest
once the UI, auth, and tenant isolation are wired together.

## What's covered (25 tests, 5 personas)

| File                              | Tests | Persona       | Focus |
| --------------------------------- | ----- | ------------- | ----- |
| `founder.spec.ts`                 | 5     | Maya          | Signup, company creation, tenant isolation, logout, profile persistence |
| `investor.spec.ts`                | 5     | Aisha         | Login, anon protection, dashboard render, persona-switcher gating, redeem page |
| `admin.spec.ts`                   | 5     | Capavate admin| Login, single $840 tier, audit verify-chain page, 4-persona switcher, AirWallex |
| `partner.spec.ts`                 | 5     | Keiretsu      | Login page, login flow, apply CTA wiring, public apply (no 401), header link |
| `marketing.spec.ts`               | 5     | (anon)        | Pricing copy, ToS visibility, keyboard a11y, footer links, mobile hamburger |

Full test names and what each guards are listed in
`avi_patch_v19/docs/WAVE_F3_E2E_TEST_REPORT.md`.

## Running locally

```bash
# 1. install the browser binaries (one-time)
npm run test:e2e:install

# 2. run all 25 tests
npm run test:e2e

# 3. step through visually
npm run test:e2e:headed

# 4. drop into the inspector
npm run test:e2e:debug

# 5. open the last HTML report
npx playwright show-report
```

The Playwright config starts the dev server itself
(`cross-env ENABLE_DEMO_SEED=1 PORT=3000 NODE_ENV=development tsx server/index.ts`)
when no server is already listening on port 3000.

If you already have a dev server running on a different port, set
`E2E_BASE_URL=http://localhost:5173` before invoking the script.

## Debugging a failing test

1. Run just one file: `npx playwright test tests/e2e/founder.spec.ts`
2. Or one test: `npx playwright test -g "founder.signup-flow"`
3. Add `--headed --debug` to step through.
4. The HTML report under `playwright-report/` includes the trace viewer with
   network, DOM, and console captures for any failed test.

## Adding a new test

1. Pick the right persona file (or create one if you're adding a new role).
2. Use `data-testid` selectors first, then fall back to roles/names. CSS class
   selectors are forbidden — they crumble under refactors.
3. Drive auth via `login(page, "founder")` from
   `tests/e2e/fixtures/helpers.ts`.
4. Generate per-run identifiers with `randomEmail()` so concurrent runs don't
   collide on uniqueness constraints.
5. Wait for `networkidle` before assertions on hash-route pages.
6. Use `expect(locator).toBeVisible()` and `expect(locator).toHaveText()` —
   never raw boolean asserts.

## Math-sacred guarantee

Wave F3 adds **only** test files plus a config and a verifier script. No
production code under `packages/cap-table-engine/*`, `server/captableCommitStore.ts`,
`shared/`, or anything in `server/` reachable from the engine is touched.
The math-sacred SHAs in `MATH_SACRED_BASELINE_WAVE_F.txt` are identical
before/after this wave.

## Known caveats

- Tests are designed to be tolerant of selector variants (`data-testid` plus
  text + role fallbacks) so they keep guarding the invariant even when copy
  changes. If you tighten selectors, add the `data-testid` to production —
  do not weaken the test.
- The suite is single-worker (`workers: 1`) because some flows mutate seeded
  data. If you split into parallel projects, scope each project to its own
  tenant.
- External services (Stripe, AirWallex) are expected to be routed to the local
  mock endpoints by the dev server. If the suite ever tries to call the real
  thing, fix the mock — never weaken the test.
