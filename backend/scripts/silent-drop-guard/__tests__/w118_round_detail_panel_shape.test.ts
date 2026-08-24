/**
 * scripts/silent-drop-guard/__tests__/w118_round_detail_panel_shape.test.ts
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 118 · FINDING 2 — THE ROUND-SUMMARY PANEL HAS ITS BASELINE CHILDREN BACK.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Three of the five reported panel drops were one cause:
 *
 *   REMOVED panel bodies
 *      - founder/RoundDetail.tsx  CardContent  at=RoundDetail:PageBody>Card#1  child=div#3
 *      - founder/RoundDetail.tsx  CardContent  at=RoundDetail:PageBody>Card#1  child=div#4
 *      - founder/RoundDetail.tsx  CardContent  at=RoundDetail:PageBody>Card#1  childorder=div|{expr}|div|div|div
 *
 * Wave 114 replaced three static sibling `div`s with one in-JSX ternary. Nothing
 * vanished from the screen, but the gate identifies a panel's children
 * POSITIONALLY, so `div#3` and `div#4` genuinely stopped existing as ids and the
 * recorded child ORDER stopped containing the baseline sequence. Wave 116 solved
 * the identical problem the right way round (W116_TESTS.md §3.1): hoist the
 * derivation into a `useMemo` above the JSX and keep the original static child
 * shape, making the determined/refused choice INSIDE each child. Wave 118 applied
 * that same remedy here.
 *
 * This test asserts the property that matters, against the guard's own extractor
 * rather than against a hand-copied list: EVERY panel record the baseline holds
 * for `client/src/pages/founder/RoundDetail.tsx` is produced by the current tree
 * unless it is ratified in allowlist.json. It fails on the pre-Wave-118 file with
 * exactly the three ids above.
 *
 * It reads the committed baseline and allowlist and writes nothing.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { buildInventory, resetSourceCache } from "../extract-inventory.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUARD_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(GUARD_DIR, "..", "..");
const FILE = "client/src/pages/founder/RoundDetail.tsx";
const CONTAINER = "at=RoundDetail:PageBody>Card#1";

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(GUARD_DIR, rel), "utf-8"));
}

resetSourceCache();
const inventory = buildInventory(REPO_ROOT);
resetSourceCache();
const companion = readJson("baseline.route-targets.json");
const allowlist = readJson("allowlist.json");

const basePanels = (companion.panels as string[]).filter((id) => id.startsWith(FILE));
const nowPanels = new Set((inventory.panels as string[]).filter((id) => id.startsWith(FILE)));
const ratified = new Set(
  ((allowlist.removedPanels as Array<{ id: string }>) ?? []).map((e) => e.id),
);

describe("W118 · FINDING 2 — RoundDetail's panel bodies against the committed baseline", () => {
  it("W118-F2-01 · every baselined RoundDetail panel record is still produced, or is ratified", () => {
    const missing = basePanels.filter((id) => !nowPanels.has(id) && !ratified.has(id));
    /* `childorder=` records are compared by the guard as a SUBSEQUENCE, not by
       identity, so they are excluded here to avoid asserting something stricter
       than the gate itself enforces — the order property is asserted separately
       below on the one container this wave restored. */
    expect(missing.filter((id) => !id.includes("\tchildorder="))).toEqual([]);
  });

  it("W118-F2-02 · the round-summary CardContent has its four `div` children and its expression child back", () => {
    const mine = [...nowPanels].filter((id) => id.includes(`CardContent\t${CONTAINER}\t`));
    for (const want of ["child=div#1", "child=div#2", "child=div#3", "child=div#4", "child={expr}#1"]) {
      expect(mine.some((id) => id.endsWith(`\t${want}`))).toBe(true);
    }
  });

  it("W118-F2-03 · the baseline child ORDER is a subsequence of the current child order, the way the gate checks it", () => {
    const key = `${FILE}\tCardContent\t${CONTAINER}\tchildorder=`;
    const baseOrder = basePanels.find((id) => id.startsWith(key));
    const nowOrder = [...nowPanels].find((id) => id.startsWith(key));
    expect(baseOrder).toBeTruthy();
    expect(nowOrder).toBeTruthy();
    const seq = (id: string) => id.slice(key.length).split("|");
    const want = seq(baseOrder as string);
    const have = seq(nowOrder as string);
    expect(want).toEqual(["div", "{expr}", "div", "div", "div"]);
    let i = 0;
    for (const tag of have) if (i < want.length && tag === want[i]) i += 1;
    expect(i).toBe(want.length);
  });

  it("W118-F2-04 · the restoration added no NEW panel record that the baseline lacks for this container", () => {
    /* A shape change that quietly grows the tree is how a later wave inherits a
       panel it never approved. `div` is not a PANEL_TAG, so restoring the divs
       must move only this container's own child/inner records. */
      const baseSet = new Set(basePanels);
    const newHere = [...nowPanels].filter(
      (id) => id.includes(`CardContent\t${CONTAINER}\t`) && !baseSet.has(id) && !id.includes("\tchildorder="),
    );
    expect(newHere).toEqual([]);
  });
});
