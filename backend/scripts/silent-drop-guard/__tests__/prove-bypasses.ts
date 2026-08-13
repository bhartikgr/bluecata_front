#!/usr/bin/env tsx
/**
 * scripts/silent-drop-guard/__tests__/prove-bypasses.ts
 *
 * Human-readable FAIL-BEFORE / PASS-AFTER proof for the four bypasses.
 * Same fixtures and same mutations as mutation-bypass.test.ts, but it prints
 * each guard's verdict instead of asserting it, so the evidence can be pasted
 * into the wave report.
 *
 *   npx tsx scripts/silent-drop-guard/__tests__/prove-bypasses.ts
 */
import { runGuard, type Baseline, type Allowlist } from "../guard.ts";
import { buildInventory, resetSourceCache, type Inventory } from "../extract-inventory.ts";
import { buildInventory as legacyBuildInventory } from "./legacy/extract-inventory.legacy.ts";
import { makeFixture, type Fixture } from "./fixtures.ts";

const EMPTY: Allowlist = { removedRoutes: [], removedClientRoutes: [], removedNav: [] };
const toBaseline = (i: Inventory): Baseline => ({
  generatedAt: "fixture",
  gitHead: "fixture",
  routes: i.routes,
  clientRoutes: i.clientRoutes,
  nav: i.nav,
});

function proof(name: string, describe: string, mutate: (fx: Fixture) => void): boolean {
  const fx = makeFixture(name);
  resetSourceCache();
  const control = buildInventory(fx.root);
  const legacyControl = legacyBuildInventory(fx.root);
  const companion = {
    routeTargets: control.routeTargets,
    tabs: control.tabs,
    buttons: control.buttons,
    events: control.events,
    copy: control.copy,
    panels: control.panels,
  };

  mutate(fx);

  const before = runGuard({
    baseline: toBaseline(legacyControl),
    current: legacyBuildInventory(fx.root),
    allowlist: EMPTY,
  });
  resetSourceCache();
  const after = runGuard({
    baseline: toBaseline(control),
    current: buildInventory(fx.root),
    allowlist: EMPTY,
    companion,
  });

  const reasons = (after.report.match(/^REMOVED .*/gm) ?? []).map((s) => "        " + s);
  console.log(`\n${"─".repeat(74)}\n${name} — ${describe}`);
  console.log(`  UNFIXED guard (pre-G-1 extractor, frozen from the G-0 snapshot)`);
  console.log(`      exit=${before.code}  dropped=${before.dropped}   ${before.code === 0 ? "BYPASS SUCCEEDS — silent drop NOT detected" : "detected"}`);
  console.log(`  FIXED guard (G-1 control-flow-aware, 8 inventories + routeTargets)`);
  console.log(`      exit=${after.code}  dropped=${after.dropped}   ${after.code === 1 ? "BYPASS BLOCKED" : "MISSED"}`);
  if (reasons.length) console.log(reasons.join("\n"));
  fx.destroy();
  return before.code === 0 && after.code === 1;
}

const results = [
  proof("bypass-a", "{false && (<Route/>)} — statically present, dynamically dead", (fx) => {
    fx.write(
      "client/src/App.tsx",
      fx.read("client/src/App.tsx").replace(
        `      <Route path="/reports/legacy">
        {() => <RequireAuth><LegacyReports /></RequireAuth>}
      </Route>`,
        `      {false && (
        <Route path="/reports/legacy">
          {() => <RequireAuth><LegacyReports /></RequireAuth>}
        </Route>
      )}`,
      ),
    );
  }),
  proof("bypass-b", "delete <TableHead>/<TableCell> (the Amount column)", (fx) => {
    let s = fx.read("client/src/pages/admin/AdminFees.tsx");
    s = s.replace(`          <TableHead className="text-right">Amount</TableHead>\n`, "");
    s = s.replace(
      `            <TableCell className="text-right">
              {c.kind === "percent" ? \`\${c.amount}%\` : \`\${c.amount} days\`}
            </TableCell>\n`,
      "",
    );
    fx.write("client/src/pages/admin/AdminFees.tsx", s);
  }),
  proof("bypass-c", "<Route path>{() => null} — route kept, page erased (V6 §2)", (fx) => {
    fx.write(
      "client/src/App.tsx",
      fx
        .read("client/src/App.tsx")
        .replace(
          `        {() => <RequireAuth><CollectiveShell><PartnerSpvEngine /></CollectiveShell></RequireAuth>}`,
          `        {() => null /* route identifier remains, real page unreachable */}`,
        ),
    );
  }),
  proof("bypass-d", "route + identifier kept, target component returns null (V7 BLOCKER 2)", (fx) => {
    fx.write(
      "client/src/pages/partner/PartnerSpvEngine.tsx",
      `export default function PartnerSpvEngine() {\n  return null;\n}\n`,
    );
  }),
];

const ok = results.every(Boolean);
console.log(`\n${"─".repeat(74)}`);
console.log(`${results.filter(Boolean).length}/4 bypasses reproduce FAIL-BEFORE and PASS-AFTER`);
process.exit(ok ? 0 : 1);
