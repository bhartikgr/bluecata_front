// v25.34 Phase 4 — dedicated vitest config for the live-server-realistic E2E
// scripts. The root vitest.config.ts restricts `include` to *.test.ts, so the
// `.mjs` E2E scripts (per the v25.34 brief) need an explicit include. This
// config inherits the root aliases + require-shim setup so the E2E .mjs files
// resolve `@shared`, `.ts` imports, and the lazy-require cycle-breakers exactly
// as the live server does.
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// Inherit aliases + the require-shim setup from the root config, but HARD-REPLACE
// the `include` so this config runs ONLY the 4 v25.34 E2E .mjs scripts (mergeConfig
// concatenates arrays, so we overwrite test.include after the merge).
const merged = mergeConfig(
  base,
  defineConfig({
    test: {
      testTimeout: 60_000,
      hookTimeout: 60_000,
      pool: "forks",
      poolOptions: { forks: { singleFork: true } },
    },
  }),
);
merged.test = merged.test || {};
// v25.35 — also pick up the v25.35 persistence-integrity E2E suite alongside the
// 4 existing v25.34 scripts (the brief runs both through this same config).
// v25.36 — add the chapter-scoping isolation E2E suite to the same run.
// v25.37 — add the payment-migration completeness + multi-currency exponent
// E2E suites to the same run.
// v25.38 — add the application-fee resolver, partner commission-rate resolver,
// and currency-formatter parity E2E suites to the same run.
// v25.39 — add the admin application-fee + commission-rate write-endpoint E2E
// suites and the ApplyToCollective hard-fail loading-contract suite.
merged.test.include = [
  "server/__tests__/v25_34_*_e2e.mjs",
  "server/__tests__/v25_35_*_e2e.mjs",
  "server/__tests__/v25_36_*_e2e.mjs",
  "server/__tests__/v25_37_*_e2e.mjs",
  "server/__tests__/v25_38_*_e2e.mjs",
  "server/__tests__/v25_39_*_e2e.mjs",
  "server/__tests__/v25_40_*_e2e.mjs",
  "server/__tests__/v25_41_*_e2e.mjs",
  // v25.42 — add the Collective dashboard revival E2E suite (17 surface tests).
  "server/__tests__/v25_42_*_e2e.mjs",
  // v25.43 — add the auth/onboarding/subscribe QA-fix E2E suite (7 tests).
  "server/__tests__/v25_43_*_e2e.mjs",
  // v25.44 — Wave A + M&A Intelligence + Venture Markets E2E suite (13+ tests).
  "server/__tests__/v25_44_*_e2e.mjs",
  // v25.45 — Founder QA wave (F1-F20) E2E suite (25+ tests).
  "server/__tests__/v25_45_*_e2e.mjs",
];

export default merged;
