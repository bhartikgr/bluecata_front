/**
 * scripts/silent-drop-guard/__tests__/w311_wave_floor.test.ts — W311
 *
 * The wave floor is an ADDITIVE check. The stored baseline is never re-cut and
 * never relaxed; the floor answers a different question — "is anything that was
 * here when this wave STARTED gone now?" — and its answer is OR-ed into the
 * exit code.
 *
 * These tests are deliberately written as DISAGREEMENT tests. Each one first
 * demonstrates that the baseline diff is silent, and only then that the floor
 * speaks. A test that only asserted "the floor fails" would not distinguish the
 * fix from a check that fails on everything, and this platform has shipped a
 * fixture that could not distinguish the fix from the defect.
 */
import { describe, expect, it } from "vitest";
import {
  buildWaveFloor,
  compareWaveFloor,
  runGuard,
  FLOOR_CLASSES,
  type WaveFloor,
} from "../guard.ts";

/* ── a minimal synthetic inventory, entirely in memory ─────────────────────── */
type Inv = Record<string, string[]>;

const F = "client/src/pages/Demo.tsx";
const G = "client/src/pages/Other.tsx";

function inv(over: Partial<Inv> = {}): Inv {
  const base: Inv = {
    routes: ["GET /api/demo", "POST /api/demo"],
    clientRoutes: ["/demo", "/other"],
    nav: ["/demo\tDemo"],
    routeTargets: ["/demo\ttarget=Demo\tmodule=" + F + "\trender=jsx\tbody=jsx"],
    routedSurfaces: ["/demo\ttarget=Demo\tmodule=" + F + "\tsurface=s1"],
    tabs: [`${F}\tTabsContent\toverview\tat=Demo:Tabs`, `${G}\tTabsContent\tmain\tat=Other:Tabs`],
    buttons: [`${F}\tButton\tdata-testid=button-a`, `${F}\tButton\tdata-testid=button-b`],
    events: [`${F}\tButton\tonClick\texpr:aaaa`, `${G}\tButton\tonClick\texpr:bbbb`],
    copy: [`${F}\ttext\tHello`, `${F}\ttext\tWorld`, `${G}\ttext\tOther`],
    panels: [`${F}\tCard\tdata-testid=card-a\tchild=CardContent#1`, `${G}\tCard\tdata-testid=card-b\tchild=CardContent#1`],
    childOrder: [],
  };
  return { ...base, ...over } as Inv;
}

const floorOf = (i: Inv): WaveFloor => buildWaveFloor(i as never, "/tmp/w311-fixture");

/** The stored baseline: deliberately a SUBSET, exactly as the real one is. */
const STORED_BASELINE = {
  routes: ["GET /api/demo"],
  clientRoutes: ["/demo"],
  nav: ["/demo\tDemo"],
  generatedAt: "2026-08-10T00:00:00.000Z",
};
const STORED_COMPANION: Record<string, string[]> = {
  routeTargets: [],
  routedSurfaces: [],
  tabs: [`${F}\tTabsContent\toverview\tat=Demo:Tabs`],
  buttons: [`${F}\tButton\tdata-testid=button-a`],
  events: [`${F}\tButton\tonClick\texpr:aaaa`],
  copy: [`${F}\ttext\tHello`],
  panels: [`${F}\tCard\tdata-testid=card-a\tchild=CardContent#1`],
};
const EMPTY_ALLOWLIST = {};
const NO_DEFERRALS = { entries: [] };

const baselineVerdict = (current: Inv) =>
  runGuard({
    baseline: STORED_BASELINE as never,
    current: current as never,
    allowlist: EMPTY_ALLOWLIST as never,
    companion: STORED_COMPANION as never,
    deferrals: NO_DEFERRALS as never,
  });

/* ── preconditions: the fixture must be able to show the defect ───────────── */
describe("W311 fixture preconditions", () => {
  it("tracks every class the floor claims to track", () => {
    const f = floorOf(inv());
    expect(FLOOR_CLASSES.length).toBeGreaterThanOrEqual(10);
    for (const c of FLOOR_CLASSES) expect(Object.keys(f.classes)).toContain(c);
  });

  it("the clean fixture PASSES both checks — a gate that fails on everything is not a fix", () => {
    const i = inv();
    expect(baselineVerdict(i).code).toBe(0);
    expect(compareWaveFloor(floorOf(i), i as never).code).toBe(0);
  });

  it("the fixture actually contains ids OUTSIDE the stored baseline, or it proves nothing", () => {
    const i = inv();
    const outside = (i.copy ?? []).filter((x) => !STORED_COMPANION.copy.includes(x));
    expect(outside.length).toBeGreaterThan(0);
  });
});

/* ── ARM A: an id the baseline knows ───────────────────────────────────────── */
describe("W311 ARM A — deleting a baselined id", () => {
  it("baseline diff FAILS and the floor ALSO fails", () => {
    const i = inv({ copy: [`${F}\ttext\tWorld`, `${G}\ttext\tOther`] }); // dropped "Hello"
    expect(baselineVerdict(i).code).toBe(1);
    const r = compareWaveFloor(floorOf(inv()), i as never);
    expect(r.code).toBe(1);
    expect(r.report).toContain("Hello");
  });
});

/* ── ARM B: an id the baseline never knew — THE DEFECT ─────────────────────── */
describe("W311 ARM B — deleting a POST-BASELINE id", () => {
  for (const [cls, mutate, needle] of [
    ["copy", () => inv({ copy: [`${F}\ttext\tHello`, `${G}\ttext\tOther`] }), "World"],
    ["buttons", () => inv({ buttons: [`${F}\tButton\tdata-testid=button-a`] }), "button-b"],
    ["events", () => inv({ events: [`${F}\tButton\tonClick\texpr:aaaa`] }), "bbbb"],
    ["panels", () => inv({ panels: [`${F}\tCard\tdata-testid=card-a\tchild=CardContent#1`] }), "card-b"],
    ["tabs", () => inv({ tabs: [`${F}\tTabsContent\toverview\tat=Demo:Tabs`] }), "Other:Tabs"],
    ["routes", () => inv({ routes: ["GET /api/demo"] }), "POST /api/demo"],
    ["clientRoutes", () => inv({ clientRoutes: ["/demo"] }), "/other"],
  ] as Array<[string, () => Inv, string]>) {
    it(`${cls}: the baseline diff is SILENT (exit 0) — this is the defect`, () => {
      expect(baselineVerdict(mutate()).code).toBe(0);
    });
    it(`${cls}: the WAVE FLOOR fails and NAMES the id — this is the fix`, () => {
      const r = compareWaveFloor(floorOf(inv()), mutate() as never);
      expect(r.code).toBe(1);
      expect(r.report).toContain(needle);
    });
  }
});

/* ── the allowlist must NOT forgive a within-wave removal ──────────────────── */
describe("W311 — the allowlist does not reach the floor", () => {
  it("an ALLOWLISTED id still FAILS the floor comparison", () => {
    const removed = `${F}\ttext\tHello`;
    const allowlisted = {
      removedCopy: [{ id: removed, reason: "test", wave: "W311", ratifiedBy: "test" }],
    };
    const mutated = inv({ copy: [`${F}\ttext\tWorld`, `${G}\ttext\tOther`] });
    /* the baseline diff forgives it … */
    const bd = runGuard({
      baseline: STORED_BASELINE as never,
      current: mutated as never,
      allowlist: allowlisted as never,
      companion: STORED_COMPANION as never,
      deferrals: NO_DEFERRALS as never,
    });
    expect(bd.code).toBe(0);
    /* … and the floor does not. */
    const fr = compareWaveFloor(floorOf(inv()), mutated as never);
    expect(fr.code).toBe(1);
    expect(fr.report).toContain("Hello");
  });
});

/* ── refusals: a floor that would pass anything must be REFUSED ────────────── */
describe("W311 — refusals (a floor must never be able to manufacture a green)", () => {
  it("REFUSES a floor with zero classes", () => {
    const f = floorOf(inv());
    const empty: WaveFloor = { ...f, classes: {}, classCounts: {}, perFile: {}, perFileClasses: [], perFileExcluded: {} };
    const r = compareWaveFloor(empty, inv() as never);
    expect(r.code).toBe(1);
    expect(r.report).toMatch(/REFUSED/);
  });

  it("REFUSES a floor whose classes are all empty", () => {
    const f: WaveFloor = JSON.parse(JSON.stringify(floorOf(inv())));
    for (const k of Object.keys(f.classes)) { f.classes[k] = []; f.classCounts[k] = 0; }
    f.perFile = {};
    const r = compareWaveFloor(f, inv() as never);
    expect(r.code).toBe(1);
    expect(r.report).toMatch(/REFUSED/);
  });

  it("REFUSES a floor with the wrong kind", () => {
    const f: WaveFloor = { ...floorOf(inv()), kind: "not-a-wave-floor" as never };
    const r = compareWaveFloor(f, inv() as never);
    expect(r.code).toBe(1);
    expect(r.report).toMatch(/REFUSED/);
  });
});

/* ── the floor is REACHED: a synthetic id that cannot exist must fail ─────── */
describe("W311 — anti-inert: the comparison is actually reached", () => {
  it("a floor containing an impossible id FAILS on an otherwise-clean tree", () => {
    const f: WaveFloor = JSON.parse(JSON.stringify(floorOf(inv())));
    const probe = "client/src/__w311_probe__.tsx\ttext\tW311 REACHABILITY PROBE";
    f.classes.copy = [...f.classes.copy, probe];
    f.classCounts.copy += 1;
    const r = compareWaveFloor(f, inv() as never);
    expect(r.code).toBe(1);
    expect(r.report).toContain("W311 REACHABILITY PROBE");
  });

  it("per-CLASS count decrease is caught even when no individual id is missing", () => {
    /* replace an id rather than remove it: the set loses one and gains one,
       so a count check and an id check disagree. Both must be present. */
    const f = floorOf(inv());
    const mutated = inv({ copy: [`${F}\ttext\tHello`, `${F}\ttext\tWorld`] }); // 3 -> 2
    const r = compareWaveFloor(f, mutated as never);
    expect(r.code).toBe(1);
    expect(r.report).toMatch(/CLASS-COUNT-FELL|GONE/);
  });

  it("a per-FILE count decrease is caught for file-scoped classes", () => {
    const f = floorOf(inv());
    const mutated = inv({ copy: [`${F}\ttext\tHello`, `${G}\ttext\tOther`] });
    const r = compareWaveFloor(f, mutated as never);
    expect(r.code).toBe(1);
    expect(r.report).toMatch(new RegExp(`FILE-COUNT-FELL|GONE`));
  });

  it("a file disappearing entirely is caught", () => {
    const f = floorOf(inv());
    const mutated = inv({
      copy: [`${G}\ttext\tOther`],
      buttons: [],
      events: [`${G}\tButton\tonClick\texpr:bbbb`],
      panels: [`${G}\tCard\tdata-testid=card-b\tchild=CardContent#1`],
      tabs: [`${G}\tTabsContent\tmain\tat=Other:Tabs`],
    });
    const r = compareWaveFloor(f, mutated as never);
    expect(r.code).toBe(1);
    expect(r.report).toMatch(/FILE-MISSING|GONE|FILE-COUNT-FELL/);
  });
});

/* ── additions must stay additive ─────────────────────────────────────────── */
describe("W311 — the floor does not punish additions", () => {
  it("adding ids to every class still PASSES", () => {
    const f = floorOf(inv());
    const grown = inv();
    for (const c of ["copy", "buttons", "events", "panels", "tabs"]) {
      grown[c] = [...(grown[c] ?? []), `${F}\tNEW\tadded-${c}`];
    }
    grown.routes = [...grown.routes, "PUT /api/new"];
    const r = compareWaveFloor(f, grown as never);
    expect(r.code).toBe(0);
  });
});
