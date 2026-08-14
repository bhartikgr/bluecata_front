#!/usr/bin/env node
/**
 * WAVE 41 — account for EVERY guard count change, item by item.
 *
 * `npm run guard` reports "no silent drops" and prints totals. Between the
 * pre-edit measurement and the post-edit one the totals moved:
 *   tabs   293 -> 306  (+13)
 *   copy  7772 -> 7790 (+18)
 *   panels 17325 -> 17337 (+12)
 * Everything else is unchanged. "No drops" is necessary but not sufficient: the
 * brief requires every count change to be ACCOUNTED FOR, i.e. each new item
 * named and attributed to a deliberate edit. A guard that only checks for
 * removals would happily accept an accidental addition.
 *
 * Method: build the guard's own inventory twice — once against the live tree,
 * once against a temporary copy in which THIS WAVE's additions to Settings.tsx
 * and Dashboard.tsx are removed — and print the exact set difference. The
 * extraction is the guard's own `buildInventory`, not a re-implementation of it.
 *
 * The temporary copy is written under the OS temp dir and never inside the repo,
 * and the live tree is never modified by this script (it only reads).
 */
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

import { buildInventory } from "../silent-drop-guard/extract-inventory";

/* ── the removals that reconstruct the pre-Wave-41 shape of the two files ──── */
const SETTINGS = "client/src/pages/founder/Settings.tsx";
const DASHBOARD = "client/src/pages/founder/Dashboard.tsx";

/** Cut everything between (and including) the two markers. */
function cutBetween(src, startMarker, endMarker, label) {
  const i = src.indexOf(startMarker);
  if (i < 0) throw new Error(`start marker not found for ${label}: ${startMarker}`);
  const j = src.indexOf(endMarker, i);
  if (j < 0) throw new Error(`end marker not found for ${label}: ${endMarker}`);
  return src.slice(0, i) + src.slice(j + endMarker.length);
}

const tmp = mkdtempSync(join(tmpdir(), "w41-guard-delta-"));
try {
  /* Only the directories the extractor walks. Copying node_modules is both
     unnecessary (the extractor parses, it does not typecheck) and ruinous. */
  for (const d of ["client", "server", "shared", "scripts"]) {
    cpSync(join(ROOT, d), join(tmp, d), { recursive: true, dereference: true });
  }

  /* Settings.tsx — remove the nine triggers and the four panels this wave added. */
  const sAbs = join(tmp, SETTINGS);
  let s = readFileSync(sAbs, "utf8");

  const TRIGGER_START = `            {/* ── WAVE 41 · OWNER RULING R9 ──`;
  const TRIGGER_END = `<TabsTrigger value="mna-prep" data-testid="tab-mna-prep"><Activity className="h-3.5 w-3.5 mr-1" /> M&amp;A Prep</TabsTrigger>`;
  s = cutBetween(s, TRIGGER_START, TRIGGER_END, "wave41 triggers");

  const PANEL_START = `          {/* ── WAVE 41 · OWNER RULING R9 — the four previously-unmounted panels.`;
  const PANEL_END = `            <SettingsMnaPrepTab key={companyId} companyId={companyId} />\n          </TabsContent>`;
  s = cutBetween(s, PANEL_START, PANEL_END, "wave41 panels");

  writeFileSync(sAbs, s);

  const before = buildInventory(tmp);
  const after = buildInventory(ROOT);

  const CLASSES = ["tabs", "copy", "panels", "buttons", "events", "routes", "clientRoutes", "nav", "routeTargets"];
  let lines = [];
  const say = (t = "") => {
    console.log(t);
    lines.push(t);
  };

  say("WAVE 41 — GUARD DELTA, ITEM BY ITEM");
  say(`when: ${new Date().toISOString()}`);
  say("");
  say("Comparison: live tree vs a temp copy with this wave's Settings.tsx");
  say("additions (9 TabsTrigger + 4 TabsContent) removed. Extraction is the");
  say("guard's own buildInventory().");
  say("");

  for (const cls of CLASSES) {
    const b = new Set(before[cls] ?? []);
    const a = new Set(after[cls] ?? []);
    const added = [...a].filter((x) => !b.has(x));
    const removed = [...b].filter((x) => !a.has(x));
    say(`── ${cls}: ${b.size} -> ${a.size}  (+${added.length} / -${removed.length})`);
    for (const x of added) say(`   + ${x}`);
    for (const x of removed) say(`   - ${x}`);
    if (removed.length) say(`   !! REMOVALS in ${cls} — investigate before shipping.`);
    say("");
  }

  writeFileSync(resolve(ROOT, "../build_log/wave41/guard_delta_accounting.txt"), lines.join("\n") + "\n");
  say("written: build_log/wave41/guard_delta_accounting.txt");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
