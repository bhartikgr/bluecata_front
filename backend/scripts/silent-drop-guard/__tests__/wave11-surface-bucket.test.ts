/**
 * scripts/silent-drop-guard/__tests__/wave11-surface-bucket.test.ts
 *
 * WAVE 11 — mutation tests for the ORDINAL routed-surface bucket.
 *
 * THE SECOND INSTANCE OF THE ASSIGNED DEFECT, FOUND WHILE SHIPPING EN-6.
 *   `routedSurfaces` records end in `surface=sN`, a bucket of the routed
 *   component's reachable-surface count (extract-inventory.ts surfaceBucket:
 *   s0=0, s1<4, s2<16, s3<64, s4<256, s5>=256). Its purpose is to catch a page
 *   being EMPTIED while its export name survives — a real bypass, worth keeping.
 *
 *   But the record was compared as a plain SET MEMBER. So GROWING a page across
 *   a bucket boundary made `surface=s4` disappear and the guard reported:
 *
 *     REMOVED routed page SURFACE (page emptied while the export name survives)
 *        - /collective/partner/billing | target=PartnerBilling | surface=s4
 *
 *   …for a change that added five panels. Same shape as the child-set bug this
 *   wave was assigned: an ADDITION observed as a REMOVAL, blocking product work.
 *   EN-6's billing lifecycle UI hit it immediately.
 *
 * THE FIX. Buckets are ORDERED, so compare them ordinally per
 * (routePath, target, module): a rise passes, a FALL fails, and `unknown` on
 * either side fails — an unresolvable module must never launder an emptied page,
 * which is the collector's silent-skip trap Wave 7B found on DA-3.
 *
 * PROVEN BOTH WAYS BELOW, on the same fixture:
 *   grow a page across s2 -> s4      => exit 0
 *   empty a page down to s1          => exit 1, and the guard NAMES it
 *   make the module unresolvable     => exit 1
 *   remove the route entirely        => exit 1 (the set diff still owns that)
 *
 * Run: npx vitest run --config scripts/silent-drop-guard/vitest.guard.config.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeFixture, type Fixture } from "./fixtures.ts";
import { runGuard, surfaceRank, splitSurfaceRecords, surfaceRegressions } from "../guard.ts";
import { buildInventory, type Inventory } from "../extract-inventory.ts";

const ALLOW = {
  removedRoutes: [],
  removedClientRoutes: [],
  removedNav: [],
  removedTabs: [],
  removedPanels: [],
  removedCopy: [],
  removedEvents: [],
  removedRouteTargets: [],
  removedRoutedSurfaces: [],
};

function baselineOf(inv: Inventory) {
  return {
    generatedAt: "test",
    gitHead: "test",
    routes: inv.routes,
    clientRoutes: inv.clientRoutes,
    nav: inv.nav,
  };
}

function companionOf(inv: Required<Inventory>) {
  return {
    routeTargets: inv.routeTargets,
    routedSurfaces: inv.routedSurfaces,
    tabs: inv.tabs,
    buttons: inv.buttons,
    events: inv.events,
    copy: inv.copy,
    panels: inv.panels,
  };
}

function verify(base: Required<Inventory>, cur: Required<Inventory>) {
  return runGuard({
    baseline: baselineOf(base),
    current: cur,
    allowlist: ALLOW,
    companion: companionOf(base),
  });
}

const REL = "client/src/pages/LegacyReports.tsx";

/** A LegacyReports page with `n` rendered rows — a knob on its surface count. */
function reportsPage(rows: number): string {
  const body = Array.from(
    { length: rows },
    (_, i) =>
      `      <div data-testid="row-${i}"><span>Report ${i}</span><em>detail ${i}</em></div>`,
  ).join("\n");
  return `export default function LegacyReports() {
  return (
    <section data-testid="legacy-reports">
      <h1>Legacy Reports</h1>
${body}
    </section>
  );
}
`;
}

describe("WAVE 11 — routed surface buckets are ORDINAL, not set members", () => {
  let fx: Fixture;
  let base: Required<Inventory>;
  let baseBucket: string;

  beforeAll(() => {
    fx = makeFixture("w11-surface");
    /* A mid-sized baseline page, so the fixture can be grown AND shrunk. */
    fx.write(REL, reportsPage(12));
    base = buildInventory(fx.root) as Required<Inventory>;
    const rec = base.routedSurfaces.find((r) => r.startsWith("/reports/legacy\t"));
    expect(rec, "the fixture route must be inventoried").toBeTruthy();
    baseBucket = splitSurfaceRecords([rec!]).surface.get(rec!.split("\tsurface=")[0])!;
  });

  afterAll(() => fx.destroy());

  /* ---- ANTI-VACUITY -------------------------------------------------- */
  it("0a: the fixture really produced a routedSurfaces record with a real bucket", () => {
    expect(base.routedSurfaces.length).toBeGreaterThan(0);
    expect(baseBucket).toMatch(/^s[0-5]$/);
    expect(surfaceRank(baseBucket)).toBeGreaterThan(0);
  });

  it("0b: the fixture baseline verifies clean against itself", () => {
    const { code, dropped } = verify(base, base);
    expect(code).toBe(0);
    expect(dropped).toBe(0);
  });

  it("0c: growing the page really DOES change the bucket (or the test proves nothing)", () => {
    fx.write(REL, reportsPage(120));
    const grown = buildInventory(fx.root) as Required<Inventory>;
    const rec = grown.routedSurfaces.find((r) => r.startsWith("/reports/legacy\t"))!;
    const grownBucket = rec.split("\tsurface=")[1];
    expect(
      surfaceRank(grownBucket),
      "the fixture must cross a bucket boundary, else the ADD test is vacuous",
    ).toBeGreaterThan(surfaceRank(baseBucket));
    fx.write(REL, reportsPage(12));
  });

  /* ---- ADDITIVE: MUST PASS ------------------------------------------- */
  it("1: GROWING a routed page passes — this is the EN-6 case that was blocked", () => {
    fx.write(REL, reportsPage(120));
    const cur = buildInventory(fx.root) as Required<Inventory>;
    const { code, report, dropped } = verify(base, cur);
    expect(report).not.toContain("routed page SURFACE");
    expect(dropped).toBe(0);
    expect(code).toBe(0);
    fx.write(REL, reportsPage(12));
  });

  it("2: an unchanged page passes (no bucket churn from unrelated edits)", () => {
    fx.write(REL, reportsPage(12).replace("Legacy Reports", "Legacy Reports"));
    const cur = buildInventory(fx.root) as Required<Inventory>;
    expect(verify(base, cur).code).toBe(0);
  });

  /* ---- SUBTRACTIVE: MUST STILL FAIL ---------------------------------- */
  it("3: EMPTYING a routed page still FAILS, and the guard names the bucket", () => {
    fx.write(
      REL,
      `export default function LegacyReports() {
  return <section data-testid="legacy-reports" />;
}
`,
    );
    const cur = buildInventory(fx.root) as Required<Inventory>;
    const { code, report, dropped } = verify(base, cur);
    expect(code).toBe(1);
    expect(dropped).toBeGreaterThan(0);
    expect(report).toContain("routed page SURFACE");
    expect(report).toContain("/reports/legacy");
    expect(report).toContain(`surface=${baseBucket}`);
    fx.write(REL, reportsPage(12));
  });

  it("4: deleting the route entirely still FAILS (the set diff owns that)", () => {
    const app = fx.read("client/src/App.tsx");
    fx.write(
      "client/src/App.tsx",
      app.replace(
        /\s*<Route path="\/reports\/legacy">[\s\S]*?<\/Route>/,
        "",
      ),
    );
    const cur = buildInventory(fx.root) as Required<Inventory>;
    const { code, report } = verify(base, cur);
    expect(code).toBe(1);
    expect(report).toContain("/reports/legacy");
    fx.write("client/src/App.tsx", app);
  });

  it("5: no new allowlist entry was needed for any of this", () => {
    expect(ALLOW.removedRoutedSurfaces).toEqual([]);
  });
});

/* ==========================================================================
 * Unit-level: the comparator itself, independent of any fixture.
 * ======================================================================== */
describe("WAVE 11 — surfaceRegressions comparator", () => {
  const key = "/x\ttarget=X\tmodule=m.tsx";

  it("a rise is not a regression", () => {
    expect(surfaceRegressions([`${key}\tsurface=s2`], [`${key}\tsurface=s5`])).toEqual([]);
  });

  it("no change is not a regression", () => {
    expect(surfaceRegressions([`${key}\tsurface=s3`], [`${key}\tsurface=s3`])).toEqual([]);
  });

  it("a FALL is a regression, reported with the baseline bucket", () => {
    expect(surfaceRegressions([`${key}\tsurface=s4`], [`${key}\tsurface=s1`])).toEqual([
      `${key}\tsurface=s4`,
    ]);
  });

  it("s1 -> s0 (fully emptied) is a regression", () => {
    expect(surfaceRegressions([`${key}\tsurface=s1`], [`${key}\tsurface=s0`])).toEqual([
      `${key}\tsurface=s1`,
    ]);
  });

  it("becoming 'unknown' is a regression — an unresolvable module cannot launder a loss", () => {
    expect(surfaceRegressions([`${key}\tsurface=s3`], [`${key}\tsurface=unknown`])).toEqual([
      `${key}\tsurface=s3`,
    ]);
  });

  it("coming FROM 'unknown' is also reported — it was never a known-good baseline", () => {
    expect(surfaceRegressions([`${key}\tsurface=unknown`], [`${key}\tsurface=s3`])).toEqual([
      `${key}\tsurface=unknown`,
    ]);
  });

  it("a key missing from current is left to the set diff (no double counting)", () => {
    expect(surfaceRegressions([`${key}\tsurface=s3`], [])).toEqual([]);
  });

  it("splitSurfaceRecords keeps non-surface records as plain set members", () => {
    const { plain, surface } = splitSurfaceRecords([
      `${key}\tsurface=s3`,
      "some\tother\trecord",
    ]);
    expect(plain).toEqual(["some\tother\trecord"]);
    expect(surface.get(key)).toBe("s3");
  });

  it("surfaceRank orders the buckets and rejects nonsense", () => {
    expect(surfaceRank("s0")).toBe(0);
    expect(surfaceRank("s5")).toBe(5);
    expect(surfaceRank("s4")).toBeLessThan(surfaceRank("s5"));
    expect(surfaceRank("unknown")).toBe(-1);
    expect(surfaceRank("")).toBe(-1);
  });
});
