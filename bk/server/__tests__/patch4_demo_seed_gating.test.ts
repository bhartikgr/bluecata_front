/**
 * Patch v4 — Demo-seed gating contract test.
 *
 * Asserts that when DEMO_SEED_ENABLED is FALSE every server-side mock-data
 * collection is empty / neutral. When TRUE the seed collections are
 * populated (sanity check that the test env opted in).
 *
 * Run via `npm test` (which sets ENABLE_DEMO_SEED=1 NODE_ENV=test) — under
 * that combination DEMO_SEED_ENABLED must be true. To exercise the
 * disabled path we re-import the modules inside an isolated child vm with
 * the env stripped (see the second describe block).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

describe("Patch v4 — demo-seed gate (current env)", () => {
  it("DEMO_SEED_ENABLED is true under the test env (ENABLE_DEMO_SEED=1 NODE_ENV=test)", async () => {
    const { DEMO_SEED_ENABLED } = await import("../lib/demoGate");
    expect(DEMO_SEED_ENABLED).toBe(true);
  });

  it("mockData arrays are populated when seed is enabled", async () => {
    const m = await import("../mockData");
    expect(m.companies.length).toBeGreaterThan(0);
    expect(m.rounds.length).toBeGreaterThan(0);
    expect(m.crmInvestors.length).toBeGreaterThan(0);
    expect(m.currentInvestor.id).not.toBe("");
  });
});

describe("Patch v4 — demo-seed gate (disabled child process)", () => {
  // Run a tiny node script in a child process with ENABLE_DEMO_SEED unset so
  // we hit the disabled branch without polluting this process's module cache.
  let report: {
    DEMO_SEED_ENABLED: boolean;
    companiesLen: number;
    securitiesLen: number;
    roundsLen: number;
    roundInvitationsLen: number;
    softCirclesLen: number;
    crmInvestorsLen: number;
    incomingInvitationsLen: number;
    investorSoftCirclesLen: number;
    portfolioLen: number;
    watchlistLen: number;
    discoverLen: number;
    dataroomFilesLen: number;
    reportsLen: number;
    activityLen: number;
    notificationsLen: number;
    demoInvitationTokensLen: number;
    investorPortfolioLen: number;
    investorActivityLen: number;
    companyDetailsExtraKeys: number;
    currentInvestorId: string;
    currentInvestorEmail: string;
    currentInvestorLegalName: string;
  };

  beforeAll(() => {
    const script = `
process.env.NODE_ENV = "development";
delete process.env.ENABLE_DEMO_SEED;
(async () => {
  const gate = await import("${REPO_ROOT}/server/lib/demoGate.ts");
  const m = await import("${REPO_ROOT}/server/mockData.ts");
  const out = {
    DEMO_SEED_ENABLED: gate.DEMO_SEED_ENABLED,
    companiesLen: m.companies.length,
    securitiesLen: m.securities.length,
    roundsLen: m.rounds.length,
    roundInvitationsLen: m.roundInvitations.length,
    softCirclesLen: m.softCircles.length,
    crmInvestorsLen: m.crmInvestors.length,
    incomingInvitationsLen: m.incomingInvitations.length,
    investorSoftCirclesLen: m.investorSoftCircles.length,
    portfolioLen: m.portfolio.length,
    watchlistLen: m.watchlist.length,
    discoverLen: m.discover.length,
    dataroomFilesLen: m.dataroomFiles.length,
    reportsLen: m.reports.length,
    activityLen: m.activity.length,
    notificationsLen: m.notifications.length,
    demoInvitationTokensLen: m.demoInvitationTokens.length,
    investorPortfolioLen: m.investorPortfolio.length,
    investorActivityLen: m.investorActivity.length,
    companyDetailsExtraKeys: Object.keys(m.companyDetailsExtra).length,
    currentInvestorId: m.currentInvestor.id,
    currentInvestorEmail: m.currentInvestor.email,
    currentInvestorLegalName: m.currentInvestor.legalName,
  };
  process.stdout.write("REPORT_BEGIN" + JSON.stringify(out) + "REPORT_END");
})().catch(e => { console.error(e); process.exit(1); });
`;
    const tmpFile = path.join(os.tmpdir(), `patch4_seed_gate_probe_${Date.now()}.mts`);
    fs.writeFileSync(tmpFile, script);
    try {
      const out = execSync(
        `npx --yes tsx ${tmpFile}`,
        { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, ENABLE_DEMO_SEED: "", NODE_ENV: "development" } },
      );
      const begin = out.indexOf("REPORT_BEGIN");
      const end = out.indexOf("REPORT_END");
      if (begin === -1 || end === -1) throw new Error(`probe output missing markers: ${out.slice(0, 500)}`);
      report = JSON.parse(out.slice(begin + "REPORT_BEGIN".length, end));
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }, 60_000);

  it("gate evaluates to false when ENABLE_DEMO_SEED is unset", () => {
    expect(report.DEMO_SEED_ENABLED).toBe(false);
  });

  it("every seeded array is empty when gate is closed", () => {
    expect(report.companiesLen).toBe(0);
    expect(report.securitiesLen).toBe(0);
    expect(report.roundsLen).toBe(0);
    expect(report.roundInvitationsLen).toBe(0);
    expect(report.softCirclesLen).toBe(0);
    expect(report.crmInvestorsLen).toBe(0);
    expect(report.incomingInvitationsLen).toBe(0);
    expect(report.investorSoftCirclesLen).toBe(0);
    expect(report.portfolioLen).toBe(0);
    expect(report.watchlistLen).toBe(0);
    expect(report.discoverLen).toBe(0);
    expect(report.dataroomFilesLen).toBe(0);
    expect(report.reportsLen).toBe(0);
    expect(report.activityLen).toBe(0);
    expect(report.notificationsLen).toBe(0);
    expect(report.demoInvitationTokensLen).toBe(0);
    expect(report.investorPortfolioLen).toBe(0);
    expect(report.investorActivityLen).toBe(0);
    expect(report.companyDetailsExtraKeys).toBe(0);
  });

  it("currentInvestor is neutralised (no demo persona leak)", () => {
    expect(report.currentInvestorId).toBe("");
    expect(report.currentInvestorEmail).toBe("");
    expect(report.currentInvestorLegalName).toBe("");
  });
});
