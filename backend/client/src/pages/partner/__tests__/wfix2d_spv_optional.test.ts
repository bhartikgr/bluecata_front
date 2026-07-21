/**
 * W-FIX2d WAVE D — SPV optional enhancements (all optional, never block, DB-driven).
 *
 *   S1 — carry BASIS (per-deployment vs whole-SPV) is co-located on the Fees
 *        step beside carry %, and remains REQUIRED (moved, not dropped).
 *   D2 — optional mandate refinements (geography / stage / check-size) + an
 *        OPTIONAL target-company link that carries NO allocation amount, plus a
 *        Deploy affordance surfaced on the Deployments tab of the detail view.
 *   D3 — optional hurdle % + GP-commit inputs (blank default) feeding the
 *        optional waterfall, and platform-fee % shown READ-ONLY from the real
 *        admin-set value (DB-driven — pulled from feeSummary, never hardcoded).
 *
 * Repo convention: component behaviour is asserted against static source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const wizard = readFileSync(resolve(__dirname, "..", "PartnerSpvEngine.tsx"), "utf8");
const tabs = readFileSync(
  resolve(__dirname, "..", "..", "..", "components", "partner", "SpvDetailTabs.tsx"),
  "utf8",
);
const routes = readFileSync(
  resolve(__dirname, "..", "..", "..", "..", "..", "server", "spvEngineRoutes.ts"),
  "utf8",
);

describe("W-FIX2d S1 — carry basis co-located on the Fees step, still required", () => {
  it("renders the carry-basis radios in the Fees step (step 2) next to carry %", () => {
    const fees = wizard.slice(
      wizard.indexOf('data-testid="spv-w-carrypct"'),
      wizard.indexOf('data-testid="spv-w-platform-fee-note"'),
    );
    expect(fees).toContain('data-testid={`spv-w-carrybasis-${cb}`}');
    expect(fees).toContain("setW({ ...w, carryBasis: cb })");
  });
  it("keeps carry basis REQUIRED — step 2 canAdvance and launch both gate on it", () => {
    expect(wizard).toContain("if (step === 2) return !!w.mgmtFeeType && !!w.carryBasis;");
    expect(wizard).toMatch(/disabled=\{!w\.carryBasis \|\|/);
  });
});

describe("W-FIX2d D2 — optional mandate fields + no-allocation target link + Deploy", () => {
  it("wizard exposes optional geography / stage / check-size inputs", () => {
    for (const id of ["spv-w-geography", "spv-w-stage", "spv-w-checkmin", "spv-w-checkmax"]) {
      expect(wizard).toContain(`data-testid="${id}"`);
    }
  });
  it("wizard exposes an OPTIONAL target-company link that carries no allocation", () => {
    expect(wizard).toContain('data-testid="spv-w-target-company"');
    expect(wizard).toContain("targetCompanyId: w.targetCompanyId.trim() || null");
  });
  it("mandate PUT sends the optional refinements (additive, blank => null/[])", () => {
    const put = wizard.slice(wizard.indexOf("/mandate`"), wizard.indexOf("/mandate`") + 500);
    expect(put).toContain("geography: splitList(w.geography)");
    expect(put).toContain("stage: splitList(w.stage)");
    expect(put).toContain("checkMinMinor:");
    expect(put).toContain("checkMaxMinor:");
  });
  it("detail Deployments tab surfaces the linked target company + a Deploy affordance", () => {
    expect(tabs).toContain('data-testid="spv-detail-target-company"');
    expect(tabs).toContain('data-testid="spv-deploy-affordance"');
    expect(tabs).toContain('data-testid="spv-deploy-action"');
    // the link is reference-only: copy must state no money moves on linking.
    expect(tabs).toContain("does not move any money");
  });
});

describe("W-FIX2d D3 — hurdle % + GP-commit optional inputs, platform fee read-only", () => {
  it("wizard exposes blank-default hurdle % + GP-commit inputs feeding the waterfall", () => {
    expect(wizard).toContain('data-testid="spv-w-waterfall"');
    expect(wizard).toContain('data-testid="spv-w-hurdle"');
    expect(wizard).toContain('data-testid="spv-w-gpcommit"');
    expect(wizard).toContain("hurdleRatePct: w.hurdleRatePct.trim() ? Number(w.hurdleRatePct) : null");
    expect(wizard).toContain("gpCommitMinor: w.gpCommitMajor.trim() ?");
  });
  it("platform carry % is DB-driven — read from feeSummary, not hardcoded", () => {
    expect(tabs).toContain("detail.feeSummary?.platformCarryPct");
    expect(tabs).toContain('data-testid="spv-detail-platform-carry"');
    // server feeds it from the real admin-set fee config.
    expect(routes).toContain("feeSummary: spvEngineStore.feeBreakdown(spv.id, 0, spv.currency)");
  });
});
