/* v25.44 S13 — M&A Intelligence VIEW SHAPES E2E (ROUND 2 strengthened).
 *
 * STRICT runtime schema validation (Zod `.strict()`) of all 4 documented view
 * shapes — replaces the loose Array.isArray / typeof checks. Specifically:
 *   - maReadinessNarrative is NEVER a field in any aggregate response object.
 *   - pipeline / comps / benchmarks responses carry NO unexpected fields.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { setup, recorder } from "./v25_42_helpers.mjs";
import { seedCompany, OPT_IN } from "./v25_44_ma_seed.mjs";

let h; const { results, record } = recorder();
const STAMP = Date.now();
const SECTOR = `ShpSect_${STAMP}`;

beforeAll(async () => {
  h = await setup("s13shape");
  for (let i = 0; i < 6; i++) seedCompany({ id: `co_shape_${STAMP}_${i}`, name: `Shape ${i}`, sector: SECTOR, privacy: OPT_IN });
}, 60_000);
afterAll(async () => { await h.teardown(); });

/* ---- strict schemas matching the documented response shapes ---- */

const scoreBucket = z.enum(["red", "amber", "gray"]);

const dashboardCardSchema = z.object({
  asOfDate: z.string(),
  totalCompaniesInScope: z.number(),
  activeNegotiations: z.number(),
  topThree: z.array(z.object({
    companyId: z.string(),
    companyName: z.string(),
    sector: z.string(),
    maScore: z.number(),
    leadBuyer: z.string().nullable(),
  }).strict()),
  status: z.enum(["OK", "INSUFFICIENT_DATA"]),
}).strict();

const pipelineRowSchema = z.object({
  companyId: z.string(),
  companyName: z.string(),
  sector: z.string().nullable(),
  region: z.string().nullable(),
  maScore: z.number(),
  acquirerFitScore: z.number(),
  topBuyer: z.object({ name: z.string(), rationale: z.string() }).strict().nullable(),
  growthRate: z.number(),
  revenueMultipleRange: z.object({ low: z.number(), high: z.number() }).strict(),
  asOf: z.string(),
  scoreBucket,
}).strict();

const pipelineSchema = z.object({
  asOfDate: z.string(),
  buckets: z.object({
    active_negotiation: z.array(pipelineRowSchema),
    outbound: z.array(pipelineRowSchema),
    inbound: z.array(pipelineRowSchema),
    none: z.object({ count: z.number() }).strict(),
  }).strict(),
}).strict();

const compsSchema = z.object({
  asOfDate: z.string(),
  totalRecords: z.number(),
  exits: z.array(z.object({
    target: z.string(),
    acquirer: z.string(),
    date: z.string(),
    valuationUsd: z.number(),
    revenueMultiple: z.number().nullable(),
    sector: z.string(),
    region: z.string(),
    sourceAttribution: z.string(),
  }).strict()),
}).strict();

const benchmarkMediansSchema = z.object({
  maScore: z.number(),
  acquirerFitScore: z.number(),
  productMarketFit: z.number(),
  technologyDifferentiation: z.number(),
  customerConcentration: z.number(),
  growthRate: z.number(),
  marketShare: z.number(),
  managementTeamStrength: z.number(),
  revenueMultipleLow: z.number(),
  revenueMultipleHigh: z.number(),
}).strict();

const benchmarksSchema = z.object({
  asOfDate: z.string(),
  sectors: z.array(z.object({
    sector: z.string(),
    n: z.number(),
    status: z.enum(["OK", "INSUFFICIENT_DATA"]),
    medians: benchmarkMediansSchema.nullable(),
  }).strict()),
}).strict();

function assertNoNarrative(body) {
  return !/maReadinessNarrative|readinessNarrative|"narrative"/i.test(JSON.stringify(body));
}

describe("v25.44 S13 view shapes — E2E (round 2 strict)", () => {
  it("dashboard_card matches strict schema (no extra fields)", async () => {
    const r = await h.req("GET", "/api/collective/ma-intel?view=dashboard_card", { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const parsed = dashboardCardSchema.safeParse(r.body);
    record("dashboard_card strict schema", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    expect(parsed.success).toBe(true);
  });

  it("pipeline matches strict schema (no extra fields)", async () => {
    const r = await h.req("GET", "/api/collective/ma-intel?view=pipeline", { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const parsed = pipelineSchema.safeParse(r.body);
    record("pipeline strict schema", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    expect(parsed.success).toBe(true);
  });

  it("comps matches strict schema (no extra fields)", async () => {
    const r = await h.req("GET", "/api/collective/ma-intel?view=comps", { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const parsed = compsSchema.safeParse(r.body);
    record("comps strict schema", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    expect(parsed.success).toBe(true);
  });

  it("benchmarks matches strict schema (no extra fields)", async () => {
    const r = await h.req("GET", "/api/collective/ma-intel?view=benchmarks", { userId: h.ids.MEMBER });
    expect(r.status).toBe(200);
    const parsed = benchmarksSchema.safeParse(r.body);
    record("benchmarks strict schema", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    expect(parsed.success).toBe(true);
  });

  it("maReadinessNarrative is NEVER a field in any aggregate response", async () => {
    let clean = true;
    for (const view of ["dashboard_card", "pipeline", "comps", "benchmarks"]) {
      const r = await h.req("GET", `/api/collective/ma-intel?view=${view}`, { userId: h.ids.MEMBER });
      if (!assertNoNarrative(r.body)) clean = false;
    }
    record("no narrative field in any aggregate", clean);
    expect(clean).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.44 S13 view shapes E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
