/**
 * scripts/silent-drop-guard/__tests__/mutation-bypass.test.ts
 *
 * T-1 / T-2 — the four reproduced silent-drop bypasses, as must-fail-then-pass
 * mutation tests.
 *
 *   (a) `{false && (<Route …/>)}`         statically present, dynamically dead
 *   (b) delete a table `<TableHead>` / `<TableCell>`  (the Amount column at
 *       client/src/pages/admin/AdminFeesConsolidated.tsx:1383,1396-1402)
 *   (c) `<Route path="…">{() => null}</Route>` — route kept, page erased
 *       (spec/V6_REVIEW_B_GPT.md §2, "Attack G-1.candidate")
 *   (d) route AND target identifier kept, the target COMPONENT replaced by one
 *       that returns null (spec/V7_REVIEW_B_GPT.md BLOCKER 2)
 *
 * Each case asserts BOTH states in one test:
 *   UNFIXED  — the pre-G-1 extractor (frozen verbatim in
 *              __tests__/legacy/extract-inventory.legacy.ts, copied out of the
 *              read-only G-0 snapshot) reports exit 0. The bypass works.
 *   FIXED    — the G-1 extractor reports exit 1 and names the dropped item.
 *
 * Everything runs against a throwaway fixture tree in os.tmpdir(). The
 * production tree, baseline.json and the G-0 snapshot are never written to;
 * the last test in this file asserts that.
 *
 * Run: npm run guard:test
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { runGuard, type Baseline, type Allowlist } from "../guard.ts";
import { COMPANION_CLASSES, type CompanionClass } from "../extract-inventory.ts";
import { buildInventory, resetSourceCache, type Inventory } from "../extract-inventory.ts";
import { buildInventory as legacyBuildInventory } from "./legacy/extract-inventory.legacy.ts";
import { makeFixture, type Fixture } from "./fixtures.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUARD_DIR = path.resolve(__dirname, "..");
const PROTECTED_BASELINE = path.join(GUARD_DIR, "baseline.json");
const PROTECTED_SHA = "8e8b88569ca95ba8c4262fd6ba59f981985acf2489512a777959c096724a0d68";

const EMPTY_ALLOWLIST: Allowlist = {
  removedRoutes: [],
  removedClientRoutes: [],
  removedNav: [],
};

function protectedShaNow(): string {
  return execFileSync("sha256sum", [PROTECTED_BASELINE], { encoding: "utf-8" })
    .trim()
    .split(/\s+/)[0];
}

function toBaseline(inv: Inventory): Baseline {
  return {
    generatedAt: "fixture",
    gitHead: "fixture",
    routes: inv.routes,
    clientRoutes: inv.clientRoutes,
    nav: inv.nav,
  };
}

/**
 * WAVE 2B / BLOCKER 2 — the companion classes as they existed BEFORE this
 * wave. Used by case (e) to replay the guard that let the bypass through.
 */
const PRE_2B_CLASSES: readonly CompanionClass[] = COMPANION_CLASSES.filter(
  (c) => c !== "routedSurfaces",
);

function toCompanion(inv: Required<Inventory>) {
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

/** The guard as it behaved BEFORE G-1: three classes, no control-flow pruning. */
function unfixedGuard(root: string, base: Baseline) {
  const current = legacyBuildInventory(root);
  return runGuard({ baseline: base, current, allowlist: EMPTY_ALLOWLIST });
}

/** The guard AFTER G-1: eight occurrence classes + route-target signatures. */
function fixedGuard(root: string, base: Baseline, companion: ReturnType<typeof toCompanion>) {
  resetSourceCache();
  const current = buildInventory(root);
  return runGuard({ baseline: base, current, allowlist: EMPTY_ALLOWLIST, companion });
}

/** Snapshot the fixture in its pristine state, as both baselines. */
function baselines(fx: Fixture) {
  resetSourceCache();
  const controlNew = buildInventory(fx.root);
  const controlLegacy = legacyBuildInventory(fx.root);
  return {
    legacyBase: toBaseline(controlLegacy),
    fixedBase: toBaseline(controlNew),
    companion: toCompanion(controlNew),
  };
}

let fixture: Fixture | undefined;
afterEach(() => {
  fixture?.destroy();
  fixture = undefined;
  resetSourceCache();
});

describe("T-1/T-2 — silent-drop bypass mutation tests", () => {
  it("(a) `{false && (<Route/>)}` — statically present, dynamically dead", () => {
    const fx = (fixture = makeFixture("bypass-a"));
    const { legacyBase, fixedBase, companion } = baselines(fx);

    const app = fx.read("client/src/App.tsx");
    const mutated = app.replace(
      `      <Route path="/reports/legacy">
        {() => <RequireAuth><LegacyReports /></RequireAuth>}
      </Route>`,
      `      {false && (
        <Route path="/reports/legacy">
          {() => <RequireAuth><LegacyReports /></RequireAuth>}
        </Route>
      )}`,
    );
    expect(mutated).not.toBe(app); // the mutation actually applied
    fx.write("client/src/App.tsx", mutated);

    const before = unfixedGuard(fx.root, legacyBase);
    expect(before.code).toBe(0); // BYPASS SUCCEEDS against the unfixed guard
    expect(before.report).toMatch(/no silent drops/);

    const after = fixedGuard(fx.root, fixedBase, companion);
    expect(after.code).toBe(1); // control-flow-aware extraction catches it
    expect(after.report).toContain("SILENT DROP DETECTED");
    expect(after.report).toContain("/reports/legacy");
  });

  it("(b) deleting a table <TableHead>/<TableCell> (the Amount column)", () => {
    const fx = (fixture = makeFixture("bypass-b"));
    const { legacyBase, fixedBase, companion } = baselines(fx);

    let src = fx.read("client/src/pages/admin/AdminFees.tsx");
    src = src.replace(`          <TableHead className="text-right">Amount</TableHead>\n`, "");
    src = src.replace(
      `            <TableCell className="text-right">
              {c.kind === "percent" ? \`\${c.amount}%\` : \`\${c.amount} days\`}
            </TableCell>\n`,
      "",
    );
    expect(src).not.toContain("Amount");
    fx.write("client/src/pages/admin/AdminFees.tsx", src);

    const before = unfixedGuard(fx.root, legacyBase);
    expect(before.code).toBe(0); // BYPASS SUCCEEDS: no route/nav/page changed

    const after = fixedGuard(fx.root, fixedBase, companion);
    expect(after.code).toBe(1);
    expect(after.report).toContain("REMOVED copy strings");
    expect(after.report).toContain("Amount");
    expect(after.report).toContain("REMOVED panel bodies");
  });

  it("(c) `<Route path>{() => null}` — route kept, page erased (V6 §2)", () => {
    const fx = (fixture = makeFixture("bypass-c"));
    const { legacyBase, fixedBase, companion } = baselines(fx);

    const app = fx.read("client/src/App.tsx");
    const mutated = app.replace(
      `        {() => <RequireAuth><CollectiveShell><PartnerSpvEngine /></CollectiveShell></RequireAuth>}`,
      `        {() => null /* route identifier remains, real page is unreachable */}`,
    );
    expect(mutated).not.toBe(app);
    fx.write("client/src/App.tsx", mutated);

    const before = unfixedGuard(fx.root, legacyBase);
    expect(before.code).toBe(0); // BYPASS SUCCEEDS: the route path is still there

    const after = fixedGuard(fx.root, fixedBase, companion);
    expect(after.code).toBe(1);
    expect(after.report).toContain("REMOVED route TARGET signatures");
    expect(after.report).toContain("/collective/partner/spv-engine");
    expect(after.report).toContain("target=PartnerSpvEngine");
  });

  it("(d) route + target identifier kept, target COMPONENT returns null (V7 BLOCKER 2)", () => {
    const fx = (fixture = makeFixture("bypass-d"));
    const { legacyBase, fixedBase, companion } = baselines(fx);

    // App.tsx is untouched: path, import and <PartnerSpvEngine /> all remain.
    const appBefore = fx.read("client/src/App.tsx");
    fx.write(
      "client/src/pages/partner/PartnerSpvEngine.tsx",
      `export default function PartnerSpvEngine() {
  return null;
}
`,
    );
    expect(fx.read("client/src/App.tsx")).toBe(appBefore);
    expect(fx.read("client/src/App.tsx")).toContain("<PartnerSpvEngine />");

    const before = unfixedGuard(fx.root, legacyBase);
    expect(before.code).toBe(0); // BYPASS SUCCEEDS: byte-identical guard output

    const after = fixedGuard(fx.root, fixedBase, companion);
    expect(after.code).toBe(1);
    expect(after.report).toContain("REMOVED route TARGET signatures");
    expect(after.report).toContain("body=jsx");
    // and the page's own button/copy/panel occurrences are gone too
    expect(after.report).toContain("REMOVED buttons");
  });

  it("(e) export name kept, real page hidden in a never-called function (REVIEW B BLOCKER 2)", () => {
    /**
     * The reproduction from build_log/WAVES_012_REVIEW_B.md, BLOCKER 2
     * (probe: /home/user/workspace/guard_bypass_probe.ts, recorded output:
     * build_log/review_b_guard_bypass.txt). The whole real page is PRESERVED
     * in the file under a new name that nothing calls, and the routed export
     * is replaced by a blank div. Nothing is deleted, so every pre-WAVE-2B
     * class is byte-identical:
     *   clientRoutes  — Route untouched
     *   routeTargets  — target/module/render identical, body=jsx still true
     *   buttons/copy/panels — extracted per FILE; the dead code is in the file
     */
    const fx = (fixture = makeFixture("bypass-e"));
    const { fixedBase, companion } = baselines(fx);

    const appBefore = fx.read("client/src/App.tsx");
    const original = fx.read("client/src/pages/partner/PartnerSpvEngine.tsx");
    const deadBody = original.replace(
      "export default function PartnerSpvEngine()",
      "function PreservedButNeverCalled()",
    );
    expect(deadBody).not.toBe(original); // the mutation actually applied
    fx.write(
      "client/src/pages/partner/PartnerSpvEngine.tsx",
      `${deadBody}\nexport default function PartnerSpvEngine(){ return <div />; }\n`,
    );
    // App.tsx untouched, and the real page's markup is still present in the file.
    expect(fx.read("client/src/App.tsx")).toBe(appBefore);
    expect(fx.read("client/src/pages/partner/PartnerSpvEngine.tsx")).toContain(
      "PreservedButNeverCalled",
    );

    resetSourceCache();
    const mutated = buildInventory(fx.root);

    // UNFIXED — the pre-WAVE-2B guard (same extractor, minus routedSurfaces).
    const before = runGuard({
      baseline: fixedBase,
      current: mutated,
      allowlist: EMPTY_ALLOWLIST,
      companion,
      classes: PRE_2B_CLASSES,
    });
    expect(before.code).toBe(0); // BYPASS SUCCEEDS
    expect(before.report).toMatch(/no silent drops/);
    // and specifically: the per-file occurrences never noticed.
    expect(mutated.buttons.some((b) => b.includes("PartnerSpvEngine.tsx"))).toBe(true);
    expect(
      mutated.routeTargets.find((t) => t.startsWith("/collective/partner/spv-engine\t")),
    ).toBe(
      companion.routeTargets.find((t) => t.startsWith("/collective/partner/spv-engine\t")),
    );

    // FIXED — routedSurfaces sees that nothing reachable renders any more.
    const after = runGuard({
      baseline: fixedBase,
      current: mutated,
      allowlist: EMPTY_ALLOWLIST,
      companion,
    });
    expect(after.code).toBe(1);
    expect(after.report).toContain("SILENT DROP DETECTED");
    expect(after.report).toContain("REMOVED routed page SURFACE");
    expect(after.report).toContain("/collective/partner/spv-engine");
    expect(after.report).toContain("target=PartnerSpvEngine");
  });

  it("(e2) a companion baseline without routedSurfaces is refused, not ignored", () => {
    const fx = (fixture = makeFixture("bypass-e2"));
    const { fixedBase, companion } = baselines(fx);
    const stale = { ...companion } as Record<string, unknown>;
    delete stale.routedSurfaces;
    resetSourceCache();
    const res = runGuard({
      baseline: fixedBase,
      current: buildInventory(fx.root),
      allowlist: EMPTY_ALLOWLIST,
      companion: stale as ReturnType<typeof toCompanion>,
    });
    expect(res.code).toBe(1);
    expect(res.report).toContain("STALE COMPANION BASELINE");
  });

  it("(e3) routedSurfaces does not fire on an ordinary edit", () => {
    // Guard rail against the opposite failure: buckets are order-of-magnitude,
    // so renaming a label or adding one field must NOT be reported as a drop.
    const fx = (fixture = makeFixture("surface-stable"));
    const { fixedBase, companion } = baselines(fx);
    const src = fx.read("client/src/pages/partner/PartnerSpvEngine.tsx");
    fx.write(
      "client/src/pages/partner/PartnerSpvEngine.tsx",
      src.replace("</div>", "<span>one more line</span></div>"),
    );
    resetSourceCache();
    const inv = buildInventory(fx.root);
    const key = "/collective/partner/spv-engine\t";
    expect(inv.routedSurfaces.find((s) => s.startsWith(key))).toBe(
      companion.routedSurfaces.find((s) => s.startsWith(key)),
    );
  });

  it("mutation tests never touch the production tree or the protected baseline", () => {
    expect(protectedShaNow()).toBe(PROTECTED_SHA);
    // No fixture ever lives inside the repo.
    const repoRoot = path.resolve(GUARD_DIR, "..", "..");
    const fx = (fixture = makeFixture("isolation"));
    expect(fx.root.startsWith(repoRoot)).toBe(false);
    expect(fs.existsSync(path.join(fx.root, "client/src/App.tsx"))).toBe(true);
  });
});

describe("WAVE 2B / BLOCKER 3 — the deferral register gates, it does not forgive", () => {
  /** A synthetic three-class scenario: one drop, deferred or not. */
  const base: Baseline = {
    generatedAt: "t",
    gitHead: "t",
    routes: [],
    clientRoutes: ["/admin/partner-fees", "/admin/fees"],
    nav: [],
  };
  const current = { routes: [], clientRoutes: ["/admin/fees"], nav: [] };
  const reg = {
    version: 1 as const,
    deferrals: [
      {
        id: "/admin/partner-fees",
        class: "clientRoutes" as const,
        ticket: "RS-2",
        reason: "consolidation kept the read, dropped the writes",
        owner: "Ozan",
        openedOn: "2026-08-09",
        reviewBy: "2026-09-09",
      },
    ],
  };

  it("an undeferred drop is still a hard failure", () => {
    const r = runGuard({ baseline: base, current, allowlist: EMPTY_ALLOWLIST });
    expect(r.code).toBe(1);
    expect(r.report).toContain("SILENT DROP DETECTED");
  });

  it("a deferred drop passes the gate but is REPORTED, never silent", () => {
    const r = runGuard({ baseline: base, current, allowlist: EMPTY_ALLOWLIST, deferrals: reg });
    expect(r.code).toBe(0);
    expect(r.deferred).toBe(1);
    expect(r.report).toContain("UNRESOLVED REGRESSION");
    expect(r.report).toContain("RS-2");
    expect(r.report).toContain("/admin/partner-fees");
    expect(r.report).toContain("owner=Ozan");
    // and it is NOT reported as forgiven
    expect(r.report).not.toContain("SILENT DROP DETECTED");
  });

  it("--strict fails on a deferred drop (the mode the restoring wave must reach)", () => {
    const r = runGuard({
      baseline: base,
      current,
      allowlist: EMPTY_ALLOWLIST,
      deferrals: reg,
      strict: true,
    });
    expect(r.code).toBe(1);
    expect(r.report).toContain("UNRESOLVED REGRESSION");
  });

  it("a deferral does NOT cover a different, new drop", () => {
    const r = runGuard({
      baseline: { ...base, clientRoutes: [...base.clientRoutes, "/admin/something-new"] },
      current,
      allowlist: EMPTY_ALLOWLIST,
      deferrals: reg,
    });
    expect(r.code).toBe(1);
    expect(r.report).toContain("SILENT DROP DETECTED");
    expect(r.report).toContain("/admin/something-new");
    // the deferred one is not double-counted as a new drop
    expect(r.report).toMatch(/1 primary-functionality item/);
  });

  it("a deferral whose loss was RESTORED fails, so the register cannot rot", () => {
    const r = runGuard({
      baseline: base,
      current: { ...current, clientRoutes: base.clientRoutes },
      allowlist: EMPTY_ALLOWLIST,
      deferrals: reg,
    });
    expect(r.code).toBe(1);
    expect(r.report).toContain("STALE DEFERRAL REGISTER");
    expect(r.report).toContain("RS-2");
  });

  /* WAVE 4A — the register is now EMPTY. RS-1 and RS-2 were RESTORED (the
   * Collective and partner fee-schedule writes live in the "Fee Schedules" tab
   * of AdminFeesConsolidated; the two legacy URLs are aliased onto it), so the
   * guard's own anti-rot rule required their entries to be DELETED rather than
   * left to go stale. The previous version of this test pinned the four
   * deferred ids; it was the register's contents at the time, not a behaviour.
   * What must not change is that a deferral is never a substitute for a fix and
   * never an allowlist entry — that is what the remaining assertions hold. */
  it("the shipped register is empty — RS-1/RS-2 were resolved, not deferred forever", () => {
    const shipped = JSON.parse(
      fs.readFileSync(path.join(GUARD_DIR, "deferrals.json"), "utf-8"),
    ) as {
      deferrals: Array<{ id: string; ticket: string; owner: string; reason: string }>;
      closed?: Array<{ ticket: string; resolution: string }>;
    };
    expect(shipped.deferrals).toEqual([]);
    // the closure is recorded, so the register still tells the story
    expect(new Set((shipped.closed ?? []).map((c) => c.ticket))).toEqual(new Set(["RS-1", "RS-2"]));
    for (const c of shipped.closed ?? []) {
      expect(c.resolution).toContain("RESOLVED, NOT FORGIVEN");
    }
  });

  it("every entry that IS in the register carries reason + owner + ticket", () => {
    const shipped = JSON.parse(
      fs.readFileSync(path.join(GUARD_DIR, "deferrals.json"), "utf-8"),
    ) as { deferrals: Array<{ id: string; ticket: string; owner: string; reason: string }> };
    for (const d of shipped.deferrals) {
      expect(d.id).toBeTruthy();
      expect(d.ticket).toBeTruthy();
      expect(d.owner).toBeTruthy();
      expect(d.reason).toContain("REAL LOSS");
    }
  });

  it("the RS-1/RS-2 ids are NOT in allowlist.json", () => {
    const al = fs.readFileSync(path.join(GUARD_DIR, "allowlist.json"), "utf-8");
    expect(al).not.toContain('"/admin/partner-fees"');
    expect(al).not.toContain('"/admin/collective-payment-schedules"');
    expect(al).not.toContain("Collective Payment Schedules");
    expect(al).not.toContain("Partner Fees");
  });
});

describe("G-1 control-flow pruning — decidability guard rails", () => {
  it("does NOT prune a dynamic condition (no false negatives)", () => {
    const fx = (fixture = makeFixture("dynamic"));
    const { fixedBase, companion } = baselines(fx);
    const app = fx.read("client/src/App.tsx");
    fx.write(
      "client/src/App.tsx",
      app.replace(
        `      <Route path="/reports/legacy">`,
        `      {featureFlag && <Route path="/reports/legacy" />}\n      <Route path="/reports/legacy">`,
      ),
    );
    const after = fixedGuard(fx.root, fixedBase, companion);
    // A dynamic flag is NOT statically dead — nothing may disappear.
    expect(after.code).toBe(0);
  });

  it("prunes 0 && / \"\" && / true ? dead : live as well as false &&", () => {
    const fx = (fixture = makeFixture("falsy"));
    const { fixedBase, companion } = baselines(fx);
    const app = fx.read("client/src/App.tsx");
    fx.write(
      "client/src/App.tsx",
      app.replace(
        `      <Route path="/admin/fees">`,
        `      {0 && <Route path="/zero-dead" />}\n      {"" && <Route path="/empty-dead" />}\n      {true ? null : <Route path="/ternary-dead" />}\n      <Route path="/admin/fees">`,
      ),
    );
    resetSourceCache();
    const inv = buildInventory(fx.root);
    expect(inv.clientRoutes).not.toContain("/zero-dead");
    expect(inv.clientRoutes).not.toContain("/empty-dead");
    expect(inv.clientRoutes).not.toContain("/ternary-dead");
    // …and adding dead code drops nothing that was live.
    expect(fixedGuard(fx.root, fixedBase, companion).code).toBe(0);
  });
});
