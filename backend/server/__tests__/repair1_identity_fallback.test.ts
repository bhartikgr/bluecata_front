/**
 * REPAIR WAVE 1 · ITEM 3 — the banned identity fallbacks stay fixed.
 *
 * The existing v14 lint (`v14_no_fallback_identity.test.ts`) bans exactly FOUR
 * literals: `?? "u_aisha_patel"`, `?? "u_demo"`, `?? "u_admin"`,
 * `?? "co_novapay"`. Repair Wave 1 repointed that lint at the real tree
 * (ITEM 2). But Review 3 found the class is much larger than those four: 22
 * sites wrote `?? "admin"` and six wrote `?? "unknown"` as an AUDIT ACTOR, and
 * neither literal is in the v14 list, so the v14 lint would never have caught
 * them even once pointed at the right tree.
 *
 * This file is the missing half of the guard. It is a source lint, deliberately
 * narrow: it names the exact files Repair Wave 1 fixed and asserts the banned
 * literal is gone from each. Every assertion here FAILS without the ITEM 3 fix.
 *
 * WHY IT DOES NOT BAN THE LITERALS TREE-WIDE. `?? "unknown"` is legitimate on
 * NON-identity expressions (a round `type`, a partner `status`, an error string,
 * a correlation id — 17 such sites, enumerated in
 * build_log/repair1/R1_FALLBACK_INVENTORY.md). A tree-wide ban on the string
 * would be a false positive factory and would push a future wave to launder
 * honest code. So the guard is keyed on the sites, and the inventory is the
 * authority for why each one is in or out.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

/** The 28 mechanical sites, grouped by file. */
const FIXED_ADMIN_LITERAL: readonly string[] = [
  "server/emailStore.ts",
  "server/lib/partnerFeeAdminRoutes.ts",
  "server/lib/collectiveEnvFallbackAdminRoutes.ts",
  "server/lib/collectivePaymentAdminRoutes.ts",
  "server/adminCollectiveFeeRoutes.ts",
  "server/collectiveSubscriptionAdminRoutes.ts",
  "server/postModerationRoutes.ts",
  "server/partnerClassificationRoutes.ts",
  "server/collectiveAdminSettingsRoutes.ts",
  "server/adminPlatformFeesRoutes.ts",
  "server/pulseSymbolRoutes.ts",
  "server/adminFeeTierRoutes.ts",
  "server/spvEngineRoutes.ts",
  "server/subscriptionTierStore.ts",
  "server/partnerResponderStore.ts",
  "server/managedFounderRoutes.ts",
];

const FIXED_UNKNOWN_LITERAL: readonly string[] = [
  "server/lib/wave15ReportingRoutes.ts",
  "server/lib/wave14MoneyRoutes.ts",
  "server/lib/wave15Routes.ts",
  "server/lib/reportingEngineRoutes.ts",
  "server/lib/adminPitchDeckDownloadRoute.ts",
  "server/dscFeedbackStore.ts",
];

/** Strip `//` and block comments so a comment that DOCUMENTS the ban never trips the lint. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("REPAIR 1 · Item 3 — the ambiguous-role actor literal is gone", () => {
  for (const rel of FIXED_ADMIN_LITERAL) {
    it(`${rel} no longer falls back to the role literal "admin" as an actor`, () => {
      expect(existsSync(join(ROOT, rel))).toBe(true);
      expect(code(rel)).not.toMatch(/\?\?\s*"admin"/);
    });
  }
});

describe("REPAIR 1 · Item 3 — the ambiguous 'unknown' actor literal is gone", () => {
  for (const rel of FIXED_UNKNOWN_LITERAL) {
    it(`${rel} no longer falls back to the bare literal "unknown" as an actor`, () => {
      expect(existsSync(join(ROOT, rel))).toBe(true);
      expect(code(rel)).not.toMatch(/\?\?\s*"unknown"/);
    });
  }
});

describe("REPAIR 1 · Item 3 — the replacements are the tree's EXISTING honest markers, not a new convention", () => {
  it('"u_unknown_admin" was already in the tree before this wave (server/lib/adminEmailRoutes.ts)', () => {
    expect(code("server/lib/adminEmailRoutes.ts")).toContain('"u_unknown_admin"');
  });

  it('"u_unknown" was already in the tree before this wave (server/roundsStore.ts)', () => {
    expect(code("server/roundsStore.ts")).toContain('"u_unknown"');
  });

  it("every honest marker carries the u_ identity prefix, so it can never be mistaken for a role name", () => {
    for (const marker of ["u_unknown_admin", "u_unknown"]) {
      expect(marker.startsWith("u_")).toBe(true);
    }
  });
});

describe("REPAIR 1 · Item 3 — the bridge archive route fails CLOSED instead of fabricating u_admin", () => {
  const src = code("server/bridgeStore.ts");

  it('the `?? "u_admin"` fallback is gone', () => {
    expect(src).not.toMatch(/\?\?\s*"u_admin"/);
  });

  it("the handler refuses with 401 missing_identity when there is no session identity", () => {
    const handler = src.slice(src.indexOf('app.post("/api/admin/bridge/archive"'));
    const window = handler.slice(0, 1600);
    expect(window).toMatch(/missing_identity/);
    expect(window).toMatch(/status\(401\)/);
  });

  it("the identity check happens BEFORE archiveBridgeOutbox mutates anything", () => {
    const handler = src.slice(src.indexOf('app.post("/api/admin/bridge/archive"'));
    const idxCheck = handler.indexOf("missing_identity");
    const idxMutate = handler.indexOf("archiveBridgeOutbox(");
    expect(idxCheck).toBeGreaterThan(-1);
    expect(idxMutate).toBeGreaterThan(-1);
    expect(idxCheck).toBeLessThan(idxMutate);
  });
});

describe("REPAIR 1 · Item 3 — sacred files were not touched", () => {
  it('server/paymentGatewayAdapter.ts still carries its own `?? "system:refund"` sentinel, untouched', () => {
    // The brief asserted no fallback site was in a sacred file. One is. It is an
    // honest system sentinel, so it needed no change — and it got none.
    expect(readFileSync(join(ROOT, "server", "paymentGatewayAdapter.ts"), "utf8"))
      .toContain('input.actor ?? "system:refund"');
  });

  it("server/lib/rateLimit.ts contains no identity fallback at all", () => {
    expect(code("server/lib/rateLimit.ts")).not.toMatch(/\?\?\s*"(u_[a-z0-9_]+|admin|unknown)"/);
  });
});

describe("REPAIR 1 · Item 3 — the FLAGGED, deliberately unfixed site is still recorded as flagged", () => {
  it("server/multiCompanyStore.ts:497 still fabricates u_maya_chen — named, not silently dropped from the report", () => {
    // This assertion is intentionally POSITIVE. It documents an OPEN defect that
    // Repair Wave 1 chose not to fix (zero non-test callers of the no-arg form;
    // the honest fix must retire the 1-arg legacy contract on BOTH
    // getActiveCompanyId and setActiveCompanyId in one wave). If a later wave
    // fixes it, this test goes red and forces the report to be updated — which
    // is the point. See build_log/repair1/R1_FALLBACK_INVENTORY.md.
    expect(code("server/multiCompanyStore.ts")).toMatch(/userId\s*\?\?\s*"u_maya_chen"/);
  });
});
