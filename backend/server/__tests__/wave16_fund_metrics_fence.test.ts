/**
 * WAVE 16 — XT-C4 proving test for scripts/lint/fundMetricsWinnerFence.ts.
 *
 * A CHECK THAT PASSES MAY BE CHECKING NOTHING. This suite therefore asserts BOTH
 * POLES for every rule the fence claims to have:
 *
 *   POSITIVE  the real tree passes, and the fence really opened a large number of
 *             files while doing so (a fence that scanned 0 files would also
 *             "pass");
 *   NEGATIVE  a purpose-built fixture tree containing each defect FAILS, with the
 *             specific rule id, so the failure is attributable and not incidental;
 *   VACUITY   the fence reports its own blind spots — a declared path that does
 *             not exist, and an allowlisted "canonical" file that has stopped
 *             importing the canonical package;
 *   PRECISION the four real-world shapes that an earlier draft of this fence
 *             flagged wrongly (FMV per share, price per share, a PMF score, and a
 *             delta between two canonical measurements) must NOT fail. A lint
 *             with false alarms gets switched off, and then it protects nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  CANONICAL_COMPUTERS,
  CANONICAL_PACKAGE,
  LOSING_MODULE,
  LOSER_PERMITTED_IMPORTS,
  RESURRECTION_RULES,
  STRUCTURAL_RULES,
  LITERAL_RULES,
  FENCED_METRIC_NAMES,
  REPO_ROOT,
  runFundMetricsFence,
  formatFence,
  type FenceViolation,
} from "../../scripts/lint/fundMetricsWinnerFence";

/* ── fixture plumbing ───────────────────────────────────────────────────── */

let tmpRoot: string;

function fixture(files: Record<string, string>, opts?: { withCanonical?: boolean }): string {
  const root = fs.mkdtempSync(path.join(tmpRoot, "fx-"));
  const write = (rel: string, body: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  };
  /* By default give the fixture a complete, honest set of declared paths so the
   * meta rules stay quiet and each test observes only the rule it is about. */
  if (opts?.withCanonical !== false) {
    for (const rel of CANONICAL_COMPUTERS) {
      write(rel, `import { computeFundMetrics } from "${CANONICAL_PACKAGE}";\nexport const x = computeFundMetrics;\n`);
    }
    write(LOSING_MODULE, `export function registerPortfolioAnalyticsRoutes(): void {}\n`);
  }
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  return root;
}

function ids(violations: FenceViolation[]): string[] {
  return violations.map((v) => v.id);
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "w16-xtc4-"));
});
afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/* ── POSITIVE POLE ──────────────────────────────────────────────────────── */

describe("XT-C4 — positive pole: the real tree", () => {
  it("passes the fence", () => {
    const r = runFundMetricsFence(REPO_ROOT);
    expect(formatFence(r)).toBe("");
    expect(r.ok).toBe(true);
  });

  it("actually scanned the tree — a fence over 0 files would also 'pass'", () => {
    const r = runFundMetricsFence(REPO_ROOT);
    expect(r.filesScanned).toBeGreaterThan(500);
  });

  it("every declared path exists on disk", () => {
    for (const rel of [...CANONICAL_COMPUTERS, LOSING_MODULE]) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `${rel} missing`).toBe(true);
    }
  });

  it("every file allowed to compute metrics really imports the canonical package", () => {
    for (const rel of CANONICAL_COMPUTERS) {
      expect(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")).toContain(CANONICAL_PACKAGE);
    }
  });

  it("the fixture harness itself is clean, so later failures are attributable", () => {
    const r = runFundMetricsFence(fixture({}));
    expect(formatFence(r)).toBe("");
    expect(r.ok).toBe(true);
  });
});

/* ── NEGATIVE POLE: R1 no-resurrection ──────────────────────────────────── */

describe("XT-C4 R1 — the deleted fabrications cannot come back", () => {
  it("RP-3: a hold-period CAGR named positionIrr fails", () => {
    const r = runFundMetricsFence(
      fixture({
        "client/src/components/investor/Thing.tsx": [
          "type P = { invested: number; currentValue: number; vintageYear: number };",
          "export function positionIrr(p: P): number {",
          "  const years = Math.max(1, new Date().getFullYear() - p.vintageYear);",
          "  return (Math.pow(p.currentValue / p.invested, 1 / years) - 1) * 100;",
          "}",
          "",
        ].join("\n"),
      }),
    );
    expect(r.ok).toBe(false);
    expect(ids(r.violations)).toContain("RP-3-positionIrr");
  });

  it("RP-4: a spark() series generator fails", () => {
    const r = runFundMetricsFence(
      fixture({ "server/x.ts": "export function spark(n: number) { return [n]; }\n" }),
    );
    expect(ids(r.violations)).toContain("RP-4-sparkline");
  });

  it("RP-1: realised proceeds derived from invested capital fails", () => {
    const r = runFundMetricsFence(
      fixture({ "server/x.ts": "const invested = 10;\nconst realised = invested * 0.1;\nexport default realised;\n" }),
    );
    expect(ids(r.violations)).toContain("RP-1-synthetic-realisation");
  });

  it("RP-2: current value pinned to cost fails", () => {
    const r = runFundMetricsFence(
      fixture({
        "server/x.ts": "const safeInvested = 10;\nexport const row = { currentValue: safeInvested };\n",
      }),
    );
    expect(ids(r.violations)).toContain("RP-2-value-pinned-to-cost");
  });

  it("RP-5: hardcoded cohort benchmark literals fail", () => {
    const r = runFundMetricsFence(
      fixture({
        "server/x.ts": "export const cohortBenchmark = { p25: 1.18, p50: 1.42, p75: 1.86 };\n",
      }),
    );
    expect(ids(r.violations)).toContain("RP-5-cohort-literal");
  });

  it("RP-5: hardcoded YoY multipliers fail", () => {
    const r = runFundMetricsFence(
      fixture({ "server/x.ts": "export const yoyFactors = [0.78, 0.65, 0.72];\n" }),
    );
    expect(ids(r.violations)).toContain("RP-5-yoy-literal");
  });

  /* ANTI-VACUITY. The rival file and this wave's own client fix both DESCRIBE the
   * deleted arithmetic in prose, on purpose — that record is why the next builder
   * will not rewrite it. If a comment tripped R1, the honest record would have to
   * be deleted to make CI green, and the incentive would be exactly backwards. */
  it("a comment describing the fabrication does NOT fail", () => {
    const r = runFundMetricsFence(
      fixture({
        "server/x.ts": [
          "/* positionIrr() used to live here: Math.pow(m, 1 / years) - 1, and spark()",
          "   generated 1.18 / 1.42 / 1.86 cohort literals. Both are deleted. */",
          "// const cohortBenchmark = { p25: 1.18 };",
          "export const ok = true;",
          "",
        ].join("\n"),
      }),
    );
    expect(formatFence(r)).toBe("");
    expect(r.ok).toBe(true);
  });
});

/* ── NEGATIVE POLE: R2 no new caller of the loser ───────────────────────── */

describe("XT-C4 R2 — no new caller of the losing implementation", () => {
  it("importing the rival's derivation function fails", () => {
    const r = runFundMetricsFence(
      fixture({
        "server/newCaller.ts":
          'import { computePortfolioAnalyticsFor } from "./portfolioAnalyticsStore";\nexport const f = computePortfolioAnalyticsFor;\n',
      }),
    );
    expect(r.ok).toBe(false);
    expect(ids(r.violations)).toContain("loser-import:computePortfolioAnalyticsFor");
  });

  it("a namespace import of the rival fails, because it exposes everything", () => {
    const r = runFundMetricsFence(
      fixture({
        "server/newCaller.ts": 'import * as rival from "./portfolioAnalyticsStore";\nexport const f = rival;\n',
      }),
    );
    expect(ids(r.violations)).toContain("loser-wildcard-import");
  });

  it("the permitted route-registration and type imports do NOT fail", () => {
    const r = runFundMetricsFence(
      fixture({
        "server/ok.ts": 'import { registerPortfolioAnalyticsRoutes } from "./portfolioAnalyticsStore";\nexport const f = registerPortfolioAnalyticsRoutes;\n',
        "client/src/pages/investor/Dash.tsx":
          'import type { PortfolioAnalytics, ReportedMetric } from "../../../../server/portfolioAnalyticsStore";\nexport type X = PortfolioAnalytics | ReportedMetric;\n',
      }),
    );
    expect(formatFence(r)).toBe("");
    expect(r.ok).toBe(true);
  });

  it("the permitted list is exactly the route registration plus payload types", () => {
    expect([...LOSER_PERMITTED_IMPORTS].sort()).toEqual([
      "PortfolioAnalytics",
      "PortfolioSeries",
      "RealPosition",
      "ReportedMetric",
      "registerPortfolioAnalyticsRoutes",
    ]);
  });
});

/* ── NEGATIVE POLE: R3 no second implementation ─────────────────────────── */

describe("XT-C4 R3 — cash-flow metrics may only be derived by the winner", () => {
  it("deriving TVPI outside the canonical engine fails", () => {
    const r = runFundMetricsFence(
      fixture({
        "server/rogueReport.ts":
          "const distributed = 5, contributed = 4, nav = 3;\nexport const tvpi = (distributed + nav) / contributed;\n",
      }),
    );
    expect(r.ok).toBe(false);
    expect(ids(r.violations)).toContain("second-implementation:tvpi");
  });

  it("deriving IRR on the client fails", () => {
    const r = runFundMetricsFence(
      fixture({
        "client/src/pages/investor/Rogue.tsx":
          "const v = 2, c = 1, years = 3;\nexport const row = { irr: Math.pow(v / c, 1 / years) - 1 };\n",
      }),
    );
    expect(ids(r.violations)).toContain("second-implementation:irr");
  });

  it("assigning DPI by arithmetic to an existing object fails", () => {
    const r = runFundMetricsFence(
      fixture({
        "server/rogue2.ts": "const o: { dpi: number } = { dpi: 0 };\no.dpi = 7 / 2;\nexport default o;\n",
      }),
    );
    expect(ids(r.violations)).toContain("second-implementation:dpi");
  });

  it("the canonical engine and its declared bindings are NOT flagged", () => {
    const root = fixture({});
    fs.writeFileSync(
      path.join(root, "server/wave9ReportingStore.ts"),
      `import { computeFundMetrics } from "${CANONICAL_PACKAGE}";\nexport const tvpi = 5 / 4;\nexport const c = computeFundMetrics;\n`,
      "utf8",
    );
    fs.mkdirSync(path.join(root, "packages/math-fns/src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "packages/math-fns/src/index.ts"),
      "export const tvpi = 5 / 4;\nexport const netIrr = 1 / 3;\n",
      "utf8",
    );
    const r = runFundMetricsFence(root);
    expect(formatFence(r)).toBe("");
    expect(r.ok).toBe(true);
  });

  it("MOIC is deliberately out of R3 scope — see the header's scope decision (b)", () => {
    expect(FENCED_METRIC_NAMES).not.toContain("moic");
    expect(FENCED_METRIC_NAMES).toContain("tvpi");
    expect(FENCED_METRIC_NAMES).toContain("irr");
  });
});

/* ── PRECISION: the shapes an earlier draft got wrong ───────────────────── */

describe("XT-C4 — precision, so the fence does not get switched off", () => {
  it("an FMV, a price per share, an ownership percent and a PMF score all pass", () => {
    const r = runFundMetricsFence(
      fixture({
        "server/seed.ts": [
          "export const grant = { expiry: \"2035-02-01\", fmv: 1.42 };",
          "export const round = { postMoney: 22_000_000, pricePerShare: 1.42, minTicket: 50_000 };",
          "export const holding = { shares: 0, ownershipPct: 1.42, invested: 100_000 };",
          "export const scores = { pmf: 0.78, tech: 0.85, lowChurn: 0.92 };",
          "export const retention = [1.0, 0.78, 0.62, 0.51];",
          "",
        ].join("\n"),
      }),
    );
    expect(formatFence(r)).toBe("");
    expect(r.ok).toBe(true);
  });

  it("a DELTA between two canonical measurements passes — it measures change", () => {
    const r = runFundMetricsFence(
      fixture({
        "server/delta.ts": [
          "declare const m: { tvpi: number; netIrr: number };",
          "declare const prior: { tvpi: number; netIrr: number };",
          "export const yoyDelta = { tvpi: m.tvpi - prior.tvpi, netIrr: m.netIrr - prior.netIrr };",
          "",
        ].join("\n"),
      }),
    );
    expect(formatFence(r)).toBe("");
    expect(r.ok).toBe(true);
  });

  it("reading, storing, comparing and formatting metrics all pass", () => {
    const r = runFundMetricsFence(
      fixture({
        "server/read.ts": [
          "declare const row: { tvpi: number | null; net_irr: number | null };",
          "export const tvpi = row.tvpi;",
          "export const net_irr = row.net_irr;",
          "export const label = tvpi === null ? \"—\" : `${tvpi.toFixed(2)}x`;",
          "export const good = (tvpi ?? 0) > 1;",
          "",
        ].join("\n"),
      }),
    );
    expect(formatFence(r)).toBe("");
    expect(r.ok).toBe(true);
  });
});

/* ── VACUITY GUARDS ─────────────────────────────────────────────────────── */

describe("XT-C4 — the fence reports its own blind spots", () => {
  it("a declared path that does not exist is reported, not silently skipped", () => {
    const r = runFundMetricsFence(fixture({}, { withCanonical: false }));
    expect(r.ok).toBe(false);
    const missing = r.violations.filter((v) => v.id === "declared_path_missing").map((v) => v.file);
    for (const rel of [...CANONICAL_COMPUTERS, LOSING_MODULE]) expect(missing).toContain(rel);
  });

  it("an allowlisted computer that stops importing the winner is reported", () => {
    const root = fixture({});
    fs.writeFileSync(
      path.join(root, CANONICAL_COMPUTERS[0]),
      "export const tvpi = 5 / 4; // no canonical import any more\n",
      "utf8",
    );
    const r = runFundMetricsFence(root);
    expect(r.ok).toBe(false);
    const v = r.violations.find((x) => x.id === "canonical_not_canonical");
    expect(v?.file).toBe(CANONICAL_COMPUTERS[0]);
  });

  it("every rule carries an explanation, so a failure says WHY", () => {
    for (const rule of [...RESURRECTION_RULES, ...STRUCTURAL_RULES, ...LITERAL_RULES]) {
      expect(rule.why.length, rule.id).toBeGreaterThan(40);
    }
  });
});

/* ── THE DEFECT THIS FENCE FOUND ────────────────────────────────────────── */

describe("XT-C4 — the live RP-3 resurrection it caught", () => {
  const target = "client/src/components/investor/PortfolioCompanyOverview.tsx";

  it("no longer contains the CAGR-as-IRR helper in code", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, target), "utf8");
    /* Deliberately allowed to remain in the file's prose record, so this asserts
     * on the CODE shapes: a function declaration and a call. */
    expect(src).not.toMatch(/function\s+positionIrr\s*\(/);
    expect(src).not.toMatch(/=\s*positionIrr\s*\(/);
  });

  it("still renders an IRR card, and now explains the suppression", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, target), "utf8");
    expect(src).toContain('label="IRR"');
    expect(src).toContain('testid="kpi-co-irr"');
    expect(src).toContain('data-testid="note-co-irr-suppressed"');
  });
});
