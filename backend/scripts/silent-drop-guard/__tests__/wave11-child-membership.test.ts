/**
 * scripts/silent-drop-guard/__tests__/wave11-child-membership.test.ts
 *
 * WAVE 11 — mutation tests for the child-set fingerprint.
 *
 * The guard used to fingerprint a container by the CONCATENATED text of its
 * children (identity) and by an opaque digest of the joined child sequence
 * (body). Under that scheme "a child was added" and "the container was removed"
 * produce the same observation, and the guard reported the second. It cost two
 * waves of product work:
 *
 *   - WAVE 4B could not add a column to the partner roster table: the <table>
 *     was keyed on `text=<every cell's text>`, so ADDING a column reported the
 *     whole table as REMOVED.
 *   - WAVE 10 could not add a twelfth tab to SpvDetailTabs.tsx: the TabsList
 *     was keyed on the concatenated labels of its TabsTrigger children, so
 *     appending one produced `SILENT DROP DETECTED — REMOVED tabs (1)` with
 *     nothing removed. That wave reverted and routed around the guard.
 *
 * These tests prove the fix BOTH WAYS on the same fixture, because a guard
 * nobody has falsified is not evidence (WAVE 7B found DA-3's scope fence
 * passing against files that had never existed on disk):
 *
 *   ADD a column / ADD a tab       -> exit 0, reported as an addition
 *   REMOVE a column / REMOVE a tab -> exit 1, and the guard NAMES it
 *   REORDER children               -> exit 1 (order detection is retained)
 *
 * Run: npx vitest run --config scripts/silent-drop-guard/vitest.guard.config.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import { makeFixture, type Fixture } from "./fixtures.ts";
import { runGuard, isSubsequence, splitOrderRecords } from "../guard.ts";
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

/** The eleven-tab surface WAVE 10 tried to extend. */
const TABS_REL = "client/src/pages/partner/SpvDetailTabs.tsx";
const TAB_IDS = [
  "overview",
  "captable",
  "commitments",
  "calls",
  "distributions",
  "waterfall",
  "fees",
  "documents",
  "investors",
  "compliance",
  "audit",
];

function tabsFile(ids: readonly string[]): string {
  const triggers = ids
    .map((id) => `        <TabsTrigger value="${id}">${id}</TabsTrigger>`)
    .join("\n");
  const panels = ids
    .map((id) => `      <TabsContent value="${id}"><section>${id} body</section></TabsContent>`)
    .join("\n");
  return `import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function SpvDetailTabs() {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
${triggers}
      </TabsList>
${panels}
    </Tabs>
  );
}
`;
}

const ROSTER_REL = "client/src/pages/admin/AdminFees.tsx";

/** The roster table, parameterised on its column list. */
function rosterFile(cols: readonly string[]): string {
  const heads = cols.map((c) => `          <TableHead>${c}</TableHead>`).join("\n");
  const cells = cols
    .map((c) => `            <TableCell>{c.${c.toLowerCase()}}</TableCell>`)
    .join("\n");
  return `import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export default function AdminFees({ codes }: { codes: any[] }) {
  return (
    <Table data-testid="table-partner-roster">
      <TableHeader>
        <TableRow data-testid="row-roster-head">
${heads}
        </TableRow>
      </TableHeader>
      <TableBody>
        {codes.map((c) => (
          <TableRow key={c.code} data-testid={\`row-partner-\${c.code}\`}>
${cells}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
`;
}

const COLS = ["Code", "Kind", "Amount", "Expires"];

describe("WAVE 11 — container child-set fingerprint", () => {
  let fx: Fixture;
  let base: Required<Inventory>;

  beforeAll(() => {
    fx = makeFixture("w11-membership");
    fx.write(TABS_REL, tabsFile(TAB_IDS));
    fx.write(ROSTER_REL, rosterFile(COLS));
    base = buildInventory(fx.root);
  });

  afterAll(() => fx.destroy());

  // -----------------------------------------------------------------------
  // ANTI-VACUITY. WAVE 7B found DA-3's scope fence passing against paths that
  // had never existed, because the collector skipped missing files in silence.
  // Every assertion below is worthless unless the fixture is really on disk
  // and really collected, so prove that first.
  // -----------------------------------------------------------------------
  it("(0a) the fixture files exist on disk", () => {
    expect(fs.existsSync(fx.file(TABS_REL))).toBe(true);
    expect(fs.existsSync(fx.file(ROSTER_REL))).toBe(true);
    expect(fs.readFileSync(fx.file(TABS_REL), "utf-8")).toContain("TabsList");
  });

  it("(0b) the baseline actually collected the tabs and the table", () => {
    expect(base.tabs.filter((t) => t.startsWith(TABS_REL)).length).toBe(
      TAB_IDS.length * 2 + 1, // one trigger + one content per id, + the TabsList
    );
    for (const id of TAB_IDS) {
      expect(base.tabs).toContain(`${TABS_REL}\tTabsTrigger\t${id}\t${id}`);
    }
    const roster = base.panels.filter((p) => p.includes("table-partner-roster"));
    expect(roster.length).toBeGreaterThan(0);
    const head = base.panels.filter((p) => p.includes("row-roster-head"));
    expect(head).toContain(
      `${ROSTER_REL}\tTableRow\tdata-testid=row-roster-head\tchild=TableHead#4`,
    );
  });

  it("(0c) identical tree → exit 0 (the control)", () => {
    const { code, report } = verify(base, base);
    expect(code).toBe(0);
    expect(report).toMatch(/no silent drops/);
  });

  // -----------------------------------------------------------------------
  // REGRESSION REPRODUCTION — the exact strings that used to move.
  // -----------------------------------------------------------------------
  it("(1) the TabsList key is unchanged by a twelfth tab (WAVE 10's blocker)", () => {
    fx.write(TABS_REL, tabsFile([...TAB_IDS, "esign"]));
    const after = buildInventory(fx.root);
    const keyOf = (inv: Inventory) =>
      inv.tabs!.filter((t) => t.startsWith(`${TABS_REL}\tTabsList\t`));
    expect(keyOf(base)).toHaveLength(1);
    // Byte-identical: the container key does NOT encode its children's labels.
    expect(keyOf(after)).toEqual(keyOf(base));
    expect(keyOf(base)[0]).not.toContain("overview captable");
    fx.write(TABS_REL, tabsFile(TAB_IDS));
  });

  it("(2) no record fingerprints a container by concatenated child text", () => {
    // Both defect shapes: the `children=N:digest` body and a container label
    // built by joining sibling text.
    expect(base.panels.filter((p) => /\tchildren=\d+:/.test(p))).toEqual([]);
    expect(base.tabs.filter((t) => t.includes("overview captable"))).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // ADDING must PASS.
  // -----------------------------------------------------------------------
  it("(3) ADDING a twelfth tab → exit 0, reported as an addition", () => {
    fx.write(TABS_REL, tabsFile([...TAB_IDS, "esign"]));
    const after = buildInventory(fx.root);
    const { code, report } = verify(base, after);
    expect(code).toBe(0);
    expect(report).not.toContain("SILENT DROP");
    expect(report).toContain("new item(s) added since baseline");
    expect(report).toContain("esign");
    fx.write(TABS_REL, tabsFile(TAB_IDS));
  });

  it("(4) ADDING a column to the roster table → exit 0 (WAVE 4B's blocker)", () => {
    fx.write(ROSTER_REL, rosterFile([...COLS, "Status"]));
    const after = buildInventory(fx.root);
    const { code, report } = verify(base, after);
    expect(code).toBe(0);
    expect(report).not.toContain("SILENT DROP");
    expect(after.panels).toContain(
      `${ROSTER_REL}\tTableRow\tdata-testid=row-roster-head\tchild=TableHead#5`,
    );
    fx.write(ROSTER_REL, rosterFile(COLS));
  });

  it("(5) ADDING a column in the MIDDLE → exit 0 (insertion, not just append)", () => {
    fx.write(ROSTER_REL, rosterFile(["Code", "Kind", "Status", "Amount", "Expires"]));
    const { code } = verify(base, buildInventory(fx.root));
    expect(code).toBe(0);
    fx.write(ROSTER_REL, rosterFile(COLS));
  });

  it("(6) ADDING a field inside a MAPPED row → exit 0", () => {
    // The old `{Tag,Tag,…}` child token was a concatenated descendant
    // fingerprint, i.e. the same defect one level down.
    fx.write(
      ROSTER_REL,
      rosterFile(COLS).replace(
        "<TableCell>{c.code}</TableCell>",
        "<TableCell>{c.code}<Badge>{c.tier}</Badge></TableCell>",
      ),
    );
    const { code, report } = verify(base, buildInventory(fx.root));
    expect(code).toBe(0);
    expect(report).not.toContain("SILENT DROP");
    fx.write(ROSTER_REL, rosterFile(COLS));
  });

  // -----------------------------------------------------------------------
  // REMOVING must still FAIL. This is the half that makes the guard a guard.
  // -----------------------------------------------------------------------
  it("(7) REMOVING a tab → exit 1 and the guard names it", () => {
    fx.write(TABS_REL, tabsFile(TAB_IDS.filter((t) => t !== "waterfall")));
    const { code, report } = verify(base, buildInventory(fx.root));
    expect(code).toBe(1);
    expect(report).toContain("SILENT DROP DETECTED");
    expect(report).toContain("waterfall");
    fx.write(TABS_REL, tabsFile(TAB_IDS));
  });

  it("(8) REMOVING a column → exit 1 and names the lost cell", () => {
    fx.write(ROSTER_REL, rosterFile(["Code", "Kind", "Expires"]));
    const { code, report } = verify(base, buildInventory(fx.root));
    expect(code).toBe(1);
    expect(report).toContain("SILENT DROP DETECTED");
    expect(report).toContain("child=TableHead#4");
    fx.write(ROSTER_REL, rosterFile(COLS));
  });

  it("(9) REMOVING one cell from a mapped row → exit 1", () => {
    fx.write(
      ROSTER_REL,
      rosterFile(COLS).replace("            <TableCell>{c.amount}</TableCell>\n", ""),
    );
    const { code, report } = verify(base, buildInventory(fx.root));
    expect(code).toBe(1);
    expect(report).toContain("SILENT DROP DETECTED");
    expect(report).toContain("inner=TableCell#4");
    fx.write(ROSTER_REL, rosterFile(COLS));
  });

  it("(10) ADD and REMOVE in the same edit → still exit 1 (no netting off)", () => {
    fx.write(ROSTER_REL, rosterFile(["Code", "Kind", "Amount", "Status"]));
    const { code, report } = verify(base, buildInventory(fx.root));
    expect(code).toBe(1);
    expect(report).toContain("SILENT DROP DETECTED");
    fx.write(ROSTER_REL, rosterFile(COLS));
  });

  it("(11) REORDERING distinct children → exit 1 (order is still enforced)", () => {
    // Moving to set membership would have thrown order away; the `childorder=`
    // subsequence record keeps it. Swap the header and body of the table.
    const src = rosterFile(COLS);
    const header = src.slice(src.indexOf("      <TableHeader>"), src.indexOf("      <TableBody>"));
    const body = src.slice(src.indexOf("      <TableBody>"), src.indexOf("    </Table>"));
    fx.write(ROSTER_REL, src.replace(header + body, body + header));
    const { code, report } = verify(base, buildInventory(fx.root));
    expect(code).toBe(1);
    expect(report).toContain("SILENT DROP DETECTED");
    expect(report).toContain("childorder=");
    fx.write(ROSTER_REL, rosterFile(COLS));
  });

  it("(11b) KNOWN LIMIT: permuting same-tag siblings is invisible — and was before", () => {
    // Four <TableHead> swapped among themselves: the child multiset, the
    // order token sequence (TableHead|TableHead|…) and the `copy` set are all
    // identical, so no class can see it. The pre-WAVE-11 digest was
    // digest("TableHead|TableHead|TableHead|TableHead") and could not see it
    // either, so this is not a weakening — and a permutation drops nothing.
    // Asserted explicitly so that if it ever becomes detectable, someone must
    // come here and say so.
    fx.write(ROSTER_REL, rosterFile(["Kind", "Code", "Amount", "Expires"]));
    const { code } = verify(base, buildInventory(fx.root));
    expect(code).toBe(0);
    // The column LABELS are still individually tracked by the copy class, so
    // deleting one is caught even though moving it is not.
    const after = buildInventory(fx.root);
    expect(after.copy).toContain(`${ROSTER_REL}\ttext\tKind`);
    fx.write(ROSTER_REL, rosterFile(COLS));
  });

  it("(12) emptying a panel entirely → exit 1", () => {
    fx.write(
      ROSTER_REL,
      `import { Table } from "@/components/ui/table";
export default function AdminFees() {
  return <Table data-testid="table-partner-roster"></Table>;
}
`,
    );
    const { code, report } = verify(base, buildInventory(fx.root));
    expect(code).toBe(1);
    expect(report).toContain("SILENT DROP DETECTED");
    fx.write(ROSTER_REL, rosterFile(COLS));
  });

  it("(13) the fixture is restored, so the suite is order-independent", () => {
    expect(verify(base, buildInventory(fx.root)).code).toBe(0);
  });
});

describe("WAVE 11 — childorder is a subsequence check, not a set member", () => {
  it("isSubsequence tolerates insertion and rejects removal/reorder", () => {
    expect(isSubsequence(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
    expect(isSubsequence(["a", "b", "c"], ["a", "x", "b", "c"])).toBe(true);
    expect(isSubsequence(["a", "b", "c"], ["x", "a", "b", "c", "y"])).toBe(true);
    expect(isSubsequence(["a", "b", "c"], ["a", "c"])).toBe(false);
    expect(isSubsequence(["a", "b", "c"], ["a", "c", "b"])).toBe(false);
    expect(isSubsequence(["a", "a"], ["a"])).toBe(false);
    expect(isSubsequence([], ["a"])).toBe(true);
  });

  it("order records are separated from set members", () => {
    const { plain, order } = splitOrderRecords([
      "f\tCard\tid=x\tchild=div#1",
      "f\tCard\tid=x\tchildorder=div|span",
    ]);
    expect(plain).toEqual(["f\tCard\tid=x\tchild=div#1"]);
    expect(order.get("f\tCard\tid=x")).toEqual(["div", "span"]);
  });

  it("an order record is never diffed as a plain string", () => {
    // Diffed as a set member, `childorder=a|b` vs `childorder=a|x|b` reads as a
    // removal — which is precisely the bug. Prove runGuard does not do that.
    const inv = (panels: string[]): Required<Inventory> =>
      ({
        routes: [],
        clientRoutes: [],
        nav: [],
        routeTargets: [],
        routedSurfaces: [],
        tabs: [],
        buttons: [],
        events: [],
        copy: [],
        panels,
      }) as Required<Inventory>;
    const before = inv(["f\tCard\tid=x\tchild=div#1", "f\tCard\tid=x\tchildorder=div"]);
    const after = inv([
      "f\tCard\tid=x\tchild=div#1",
      "f\tCard\tid=x\tchild=span#1",
      "f\tCard\tid=x\tchildorder=div|span",
    ]);
    expect(verify(before, after).code).toBe(0);
    expect(verify(after, before).code).toBe(1);
  });
});
