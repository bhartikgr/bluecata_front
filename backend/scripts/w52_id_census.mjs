#!/usr/bin/env node
/**
 * W52 / AC-15 — per-file, per-class guard identity census.
 *
 * The aggregate guard line ("17427 panels") cannot see a renumbering event:
 * a mid-list sibling insertion in RoundDetail.tsx can invalidate 46 child
 * identities and produce 62 phantom drops while the aggregate moves by +1.
 * Review 3 R9 measured W52's exposure at ~1,640 identities across three files,
 * the largest in the plan. This census is the per-file/per-class evidence
 * AC-15 requires.
 *
 * Usage: node scripts/w52_id_census.mjs <out.json>
 */
import { buildInventory, COMPANION_CLASSES } from "./silent-drop-guard/extract-inventory.ts";
import { writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const inv = buildInventory(repoRoot);

/** Identity strings begin with the repo-relative file path, then a TAB. */
function fileOf(id) {
  const s = String(id);
  const i = s.indexOf("\t");
  return (i < 0 ? s : s.slice(0, i)).trim();
}

const perFile = {};
const perClassTotal = {};
for (const cls of COMPANION_CLASSES) {
  const list = inv[cls] ?? [];
  perClassTotal[cls] = list.length;
  for (const id of list) {
    const f = fileOf(id);
    perFile[f] ??= {};
    perFile[f][cls] = (perFile[f][cls] ?? 0) + 1;
  }
}

const W52_FILES = [
  "client/src/pages/founder/RoundNew.tsx",
  "client/src/pages/founder/RoundDetail.tsx",
  "client/src/pages/founder/Rounds.tsx",
  "client/src/pages/founder/CapTable.tsx",
];

const out = {
  classes: COMPANION_CLASSES,
  perClassTotal,
  w52: Object.fromEntries(
    W52_FILES.map((f) => {
      const row = perFile[f] ?? {};
      const total = Object.values(row).reduce((a, b) => a + b, 0);
      return [f, { ...row, total }];
    }),
  ),
  /** Full identity lists for the W52 files, so DISAPPEARED ids can be named. */
  ids: Object.fromEntries(
    COMPANION_CLASSES.map((cls) => [
      cls,
      (inv[cls] ?? []).filter((id) => W52_FILES.includes(fileOf(id))).sort(),
    ]),
  ),
};

const dest = process.argv[2];
if (dest) writeFileSync(dest, JSON.stringify(out, null, 2));
console.log("W52 ID CENSUS — per class totals (whole tree):");
for (const c of COMPANION_CLASSES) console.log(`  ${c}: ${perClassTotal[c]}`);
console.log("\nW52-owned files:");
for (const [f, row] of Object.entries(out.w52)) {
  const parts = COMPANION_CLASSES.filter((c) => row[c]).map((c) => `${c}=${row[c]}`);
  console.log(`  ${f}: ${parts.join(" ")} | TOTAL=${row.total}`);
}
const w52Total = Object.values(out.w52).reduce((a, r) => a + r.total, 0);
console.log(`\nW52 TOTAL identities: ${w52Total}`);
