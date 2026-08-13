/**
 * WAVE 16 — CP-BRG-07 completion.
 *
 * EVERY FENCE IN THIS FILE IS ASSERTED IN BOTH DIRECTIONS. A check that only
 * ever sees good input is indistinguishable from `return true`, and six real
 * instances of exactly that have been paid for in this codebase already.
 *
 * The negative poles are built as FIXTURE TREES on disk rather than by mocking,
 * because the specific past failure being guarded against ("a scope fence
 * validating files that never existed") was invisible to mocks: the fence was
 * happy precisely because nothing was there.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import {
  FEE_INPUT_WRITE_SITES,
  FEE_AGGREGATE_CONSUMER,
  FEE_AGGREGATE_ROUTE,
  FEE_AGGREGATE_SSE_PATH,
  FEE_AGGREGATE_SSE_TOPIC,
  auditFeeAggregatePublishers,
  auditFeeAggregateConsumer,
} from "../lib/wave16FeeAggregateWiring";
import { PARTNER_TIER_TABLE } from "../lib/partnerTierResolver";

/** The repo root: this file lives at <root>/server/__tests__/. */
const ROOT = join(__dirname, "..", "..");

function fixtureTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "w16-fee-fence-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, "utf8");
  }
  return dir;
}

/* ════════════════════════════════════════════════════════════════════════════
 * The PUBLISHER half — every fee-input write site must publish.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("CP-BRG-07 — fee-input write sites publish an invalidation frame", () => {
  it("POLE 1 — the real tree passes, and the declarations are not stale", () => {
    const audit = auditFeeAggregatePublishers(ROOT);
    expect(audit.findings).toEqual([]);
    expect(audit.ok).toBe(true);
    // The fence must be checking a non-trivial number of sites. A fence that
    // iterates an empty list also returns ok.
    expect(audit.checked).toBeGreaterThanOrEqual(3);
  });

  it("declares the commission rate as a SEPARATE FILE from the fee schedules", () => {
    // This is the SECOND PATH the item required be hunted. If a future edit
    // collapses the list to one file, the second path stops being covered and
    // this assertion is what says so.
    const files = new Set(FEE_INPUT_WRITE_SITES.map((s) => s.file));
    expect(files.size).toBeGreaterThanOrEqual(2);
    const commission = FEE_INPUT_WRITE_SITES.find((s) => s.leg === "commission_rate");
    expect(commission).toBeDefined();
    expect(commission!.file).not.toBe(
      FEE_INPUT_WRITE_SITES.find((s) => s.leg === "fee_schedule")!.file,
    );
  });

  it("POLE 2 — REPORTS a declared write site whose file does not exist", () => {
    // The exact past failure: a fence that validated files that were not there.
    const empty = fixtureTree({ "placeholder.txt": "x" });
    const audit = auditFeeAggregatePublishers(empty);
    expect(audit.ok).toBe(false);
    expect(audit.findings.every((f) => f.problem === "file_missing")).toBe(true);
    expect(audit.findings.length).toBe(FEE_INPUT_WRITE_SITES.length);
  });

  it("POLE 2 — REPORTS a write site that mutates a fee input WITHOUT publishing", () => {
    const dir = fixtureTree({
      "server/lib/partnerFeeAdminRoutes.ts":
        "rawDb().prepare(`UPDATE partner_fee_schedules SET amount_minor = ?`).run(1);\n" +
        "rawDb().prepare(`UPDATE contacts SET fee_override_json = ? WHERE id = ?`).run(null, 'p');\n",
      "server/adminCollectiveFeeRoutes.ts": "updateCommissionRate(tier, rate, actor);\n",
    });
    const audit = auditFeeAggregatePublishers(dir);
    expect(audit.ok).toBe(false);
    const kinds = audit.findings.map((f) => f.problem);
    expect(kinds).toContain("publish_call_absent");
    expect(kinds).not.toContain("file_missing");
    // Every leg is named, so a partial regression cannot hide behind one finding.
    expect(audit.findings.filter((f) => f.problem === "publish_call_absent").length).toBe(3);
  });

  it("POLE 2 — a COMMENT or IMPORT naming the publisher does NOT satisfy the fence", () => {
    // This is the inverse of the `codeOnly()` failure: last time comment-blanking
    // destroyed evidence of a REAL call. Here the risk runs the other way — prose
    // about publishing must not be mistaken FOR publishing. Requiring a
    // call-shaped token is what separates the two, and this is the proof.
    const dir = fixtureTree({
      "server/lib/partnerFeeAdminRoutes.ts":
        "/* This route publishFeeScheduleChanged eventually, honest. */\n" +
        "import { publishFeeScheduleChanged } from './wave15FeeScheduleAggregate';\n" +
        "rawDb().prepare(`UPDATE partner_fee_schedules SET amount_minor = ?`).run(1);\n" +
        "rawDb().prepare(`UPDATE contacts SET fee_override_json = ? WHERE id = ?`).run(null, 'p');\n",
      "server/adminCollectiveFeeRoutes.ts":
        "// publishFeeScheduleChangedForTier is imported below\n" +
        "updateCommissionRate(tier, rate, actor);\n",
    });
    const audit = auditFeeAggregatePublishers(dir);
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.problem === "publish_call_absent")).toBe(true);
  });

  it("POLE 2 — REPORTS a STALE declaration whose mutation no longer exists", () => {
    // A fence must fail loudly when its own premise rots, not pass because the
    // thing it was watching moved somewhere it cannot see.
    const dir = fixtureTree({
      "server/lib/partnerFeeAdminRoutes.ts": "publishFeeScheduleChanged('p', 'x');\n",
      "server/adminCollectiveFeeRoutes.ts": "publishFeeScheduleChangedForTier('builder', 'x');\n",
    });
    const audit = auditFeeAggregatePublishers(dir);
    expect(audit.ok).toBe(false);
    expect(audit.findings.every((f) => f.problem === "mutation_evidence_absent")).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * The CONSUMER half — the route must actually be read by a partner surface.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("CP-BRG-07 — the aggregate has a real client consumer", () => {
  it("POLE 1 — the partner billing surface reads the route over /api/stream", () => {
    const audit = auditFeeAggregateConsumer(ROOT);
    expect(audit.findings).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it("POLE 2 — REPORTS a consumer that renders the fee lines but never subscribes", () => {
    const dir = fixtureTree({
      [FEE_AGGREGATE_CONSUMER]:
        `const q = useQuery({ queryKey: ["${FEE_AGGREGATE_ROUTE}"] });\n` +
        "formatFractionAsPercent(agg.commission.rateFraction);\n",
    });
    const audit = auditFeeAggregateConsumer(dir);
    expect(audit.ok).toBe(false);
    const kinds = audit.findings.map((f) => f.problem);
    expect(kinds).toContain("sse_topic_absent");
    expect(kinds).toContain("sse_path_absent");
  });

  it("POLE 2 — REPORTS the FORBIDDEN `n > 1 ? n/100 : n` percent normaliser", () => {
    const dir = fixtureTree({
      [FEE_AGGREGATE_CONSUMER]:
        `"${FEE_AGGREGATE_ROUTE}" "${FEE_AGGREGATE_SSE_TOPIC}" "${FEE_AGGREGATE_SSE_PATH}"\n` +
        "formatFractionAsPercent(x);\n" +
        "const pct = rate > 1 ? rate / 100 : rate;\n",
    });
    const audit = auditFeeAggregateConsumer(dir);
    expect(audit.ok).toBe(false);
    expect(audit.findings.map((f) => f.problem)).toContain("forbidden_percent_normaliser");
  });

  it("POLE 2 — REPORTS a rate rendered without the percentDisplay helper", () => {
    const dir = fixtureTree({
      [FEE_AGGREGATE_CONSUMER]:
        `"${FEE_AGGREGATE_ROUTE}" "${FEE_AGGREGATE_SSE_TOPIC}" "${FEE_AGGREGATE_SSE_PATH}"\n` +
        "<span>{agg.commission.rateFraction}</span>\n",
    });
    const audit = auditFeeAggregateConsumer(dir);
    expect(audit.ok).toBe(false);
    expect(audit.findings.map((f) => f.problem)).toContain("percent_helper_absent");
  });

  it("POLE 2 — REPORTS an absent consumer entirely (the Wave 15 state)", () => {
    const dir = fixtureTree({ "placeholder.txt": "x" });
    const audit = auditFeeAggregateConsumer(dir);
    expect(audit.ok).toBe(false);
    expect(audit.findings[0].problem).toBe("file_missing");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * The TIER FANOUT reads its affected set from the SAME table that prices.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("CP-BRG-07 — tier fanout is bound to the canonical tier table", () => {
  it("shares the table constant with the tier resolver rather than re-spelling it", () => {
    // If the fanout queried a different table from the one the resolver reads,
    // it would notify the wrong partners — or none — and nothing would say so.
    expect(PARTNER_TIER_TABLE).toBe("partner_tier_current");
    const src = require("fs").readFileSync(
      join(ROOT, "server", "lib", "wave15FeeScheduleAggregate.ts"),
      "utf8",
    ) as string;
    // The fanout must interpolate the IMPORTED constant, never a literal.
    expect(src).toMatch(/FROM \$\{PARTNER_TIER_TABLE\}/);
    expect(src).not.toMatch(/FROM partner_tier_current/);
  });
});
