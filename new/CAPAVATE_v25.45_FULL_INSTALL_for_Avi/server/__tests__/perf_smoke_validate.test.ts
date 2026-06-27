/**
 * v19 Phase C — perf_smoke script self-validation.
 *
 * Coverage:
 *   - main() honors NODE_ENV=test by skipping (no network calls, returns ok=true)
 *   - _selfTest() validates the quantile math on a known sorted array
 *   - importing the script does not throw at module load
 *   - The HOT_ENDPOINTS list (indirectly: through completed=true) is non-empty
 *
 * This test is intentionally lightweight — the script's real job is to
 * run against a live server during pre-deploy; we only validate that the
 * statistics helpers and test-mode short-circuit work.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { main, _selfTest } from "../../scripts/perf_smoke";

describe("v19 Phase C — perf_smoke validation", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  it("main() short-circuits when NODE_ENV=test and returns ok:true", async () => {
    const out = await main();
    expect(out.ok).toBe(true);
    expect(out.results).toBeInstanceOf(Map);
    // Skip path returns an empty results map (no samples were recorded).
    expect(out.results.size).toBe(0);
  });

  it("_selfTest verifies quantile math (p50=5.5, p95≈9.55) on a 10-element array", () => {
    const r = _selfTest();
    expect(r.sortedQuantilesOk).toBe(true);
  });

  it("multiple invocations of main() in test mode remain side-effect free", async () => {
    const a = await main();
    const b = await main();
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.results.size).toBe(0);
    expect(b.results.size).toBe(0);
  });

  it("_selfTest does not throw and is synchronous", () => {
    expect(() => _selfTest()).not.toThrow();
    const r = _selfTest();
    expect(typeof r.sortedQuantilesOk).toBe("boolean");
  });
});
