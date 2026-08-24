/**
 * scripts/silent-drop-guard/w121_capture_inventory.ts
 *
 * WAVE 121 · FINDING 1 — the INSTRUMENT VALIDATOR, not a baseline writer.
 *
 * WHY THIS EXISTS. The project's hard rule is that a changed gate must be proved
 * still able to catch a fresh drop. Proving that requires two inventories of the
 * SAME tree — one clean, one mutated — compared by the guard's own diff. The
 * protected `baseline.json` cannot serve as the clean side: it is frozen at the
 * G-0 snapshot (923 routes against 1,222 today), it is deliberately not writable
 * by any tool, and the three investor endpoints at the centre of this finding
 * were never in it. So this script captures the CURRENT tree's inventory to an
 * ARBITRARY PATH GIVEN ON THE COMMAND LINE, for `guard.ts --baseline <that
 * path>` to compare a mutated scratch copy against.
 *
 * WHAT IT REFUSES TO DO. It will not write to `scripts/silent-drop-guard/` —
 * that is where `baseline.json` and `baseline.route-targets.json` live, and a
 * "capture the current state" tool that can reach them is a re-baselining tool
 * wearing a disguise. Attempting it exits 2.
 *
 *   npx tsx scripts/silent-drop-guard/w121_capture_inventory.ts <outPath> [root]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { extractRoutes, extractClientRoutes, extractNav, resetSourceCache } from "./extract-inventory.ts";

/* ESM: this file is loaded as a module, so `__dirname` does not exist. */
const HERE = path.dirname(fileURLToPath(import.meta.url));

function main(): void {
  const out = process.argv[2];
  const root = path.resolve(process.argv[3] ?? path.resolve(HERE, "..", ".."));
  if (!out) {
    console.error("usage: w121_capture_inventory.ts <outPath> [root]");
    process.exit(2);
  }
  const absOut = path.resolve(out);
  const guardDir = path.resolve(HERE);
  if (absOut.startsWith(guardDir + path.sep)) {
    console.error(
      `REFUSED: ${absOut} is inside ${guardDir}.\n` +
        "         The protected baseline and its companion live there and this tool\n" +
        "         must never be a route to rewriting either. Write outside the tree.",
    );
    process.exit(2);
  }

  resetSourceCache();
  const inv = {
    generatedAt: new Date().toISOString(),
    gitHead: `w121-capture:${root}`,
    routes: extractRoutes(root),
    clientRoutes: extractClientRoutes(root),
    nav: extractNav(root),
  };
  resetSourceCache();
  fs.writeFileSync(absOut, `${JSON.stringify(inv, null, 2)}\n`, "utf-8");
  console.log(
    `captured: ${absOut}\n  root=${root}\n  routes=${inv.routes.length} clientRoutes=${inv.clientRoutes.length} nav=${inv.nav.length}`,
  );
}

main();
