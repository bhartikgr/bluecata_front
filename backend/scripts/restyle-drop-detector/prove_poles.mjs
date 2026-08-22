#!/usr/bin/env node
/**
 * scripts/restyle-drop-detector/prove_poles.mjs — BOTH POLES, RE-PROVED ON DEMAND.
 *
 * A gate is only worth its runtime if it can go RED. This script proves both
 * poles of `detect.mjs` from scratch, every time it is run, on scratch copies
 * under the OS temp directory. THE PRODUCT TREE IS NEVER MODIFIED — it is read,
 * copied out, and the copies are mutated.
 *
 *   POLE 1 (must be GREEN)  identical trees -> 0 disappearances, exit 0.
 *   POLE 2 (must be RED)    five planted restyle mutations, each the kind of
 *                           edit a restyle actually invites:
 *
 *     M1  delete a toast() confirmation           -> toastCopy        (hole H2)
 *     M2  change a status pill's palette classes  -> statusPill       (DROPPED+ADDED pair)
 *     M3  EMPTY A MONEY FIGURE, KEEP ITS data-testid
 *                                                 -> moneyOrPercent + exprChild
 *     M4  delete a <TabsTrigger>, keep its panel  -> tabPanelReach reachable=NO
 *     M5  delete a whole <Button>                 -> interactiveSite + count decrease
 *
 *   M3 IS THE ONE THAT MATTERS. The test-id stays. A test-id count check, the
 *   silent-drop guard, the reachability gate, `tsc` and the entire vitest suite
 *   would ALL stay green while a money figure vanished from a billing screen.
 *   Only the rendered-figure inventory sees it. Each mutation is asserted
 *   INDIVIDUALLY, so "the run went red" can never be credited to the wrong one.
 *
 *   POLE 3 (must be RED)    WAVE 102. NINE planted SUPPRESSION mutations, each
 *                           on its own fresh copy so attribution is exact.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY POLE 3 EXISTS — this harness certified a gate that had a hole in it
 * ═══════════════════════════════════════════════════════════════════════════
 * M1-M5 ARE ALL DELETIONS. That is the whole reason Reviewer C's seven
 * suppression bypasses survived ruling R82's verification: "BOTH POLES PROVED,
 * all five planted mutations still caught" was true, and it tested only the axis
 * the policy had narrowed — not the axis where the hole was. ONE suppression
 * mutation here would have surfaced it in Wave 90.
 *
 * R82's own postscript is the lesson and it lands on this file: "the harness
 * asserted a MESSAGE rather than a BEHAVIOUR." A pole proof that plants only one
 * KIND of loss proves only that one kind of loss is caught.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Usage: node scripts/restyle-drop-detector/prove_poles.mjs [--keep]
 * Exit 0 = all three poles proved. Exit 1 = a pole failed (the detector is broken).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const DETECT = path.join(HERE, "detect.mjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rdd-poles-"));
const A = path.join(TMP, "clean");
const B = path.join(TMP, "mutated");

function copyScope() {
  for (const d of [A, B]) {
    fs.mkdirSync(path.join(d, "client"), { recursive: true });
    fs.cpSync(path.join(REPO, "client", "src"), path.join(d, "client", "src"), { recursive: true });
  }
}

function run(args) {
  try {
    const out = execFileSync(process.execPath, [DETECT, ...args], { cwd: REPO, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 99, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

/* ── mutation helpers ─────────────────────────────────────────────────────── */
const log = [];
function edit(rel, fn, label) {
  const p = path.join(B, rel);
  const before = fs.readFileSync(p, "utf8");
  const after = fn(before);
  if (after === before) {
    console.error(`FATAL — mutation ${label} did not change ${rel}. The anchor moved; fix this script.`);
    process.exit(1);
  }
  fs.writeFileSync(p, after);
  log.push(`${label}  ${rel}`);
}

/** first file under client/src (non-test) that satisfies `pred(src)` */
function findFile(pred) {
  const stack = [path.join(REPO, "client", "src")];
  const hits = [];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "__tests__" && !e.name.startsWith(".")) stack.push(p); continue; }
      if (!/\.tsx$/.test(e.name) || /\.(test|spec)\.tsx$/.test(e.name)) continue;
      const src = fs.readFileSync(p, "utf8");
      if (pred(src, p)) hits.push(path.relative(REPO, p).replace(/\\/g, "/"));
    }
  }
  hits.sort();
  return hits[0];
}

console.log(`restyle-drop-detector · BOTH-POLES PROOF`);
console.log(`scratch: ${TMP}`);
copyScope();

/* ── POLE 1 — identical trees must be GREEN ──────────────────────────────── */
const snapA = path.join(TMP, "A.json");
run(["--root", A, "--emit", snapA]);
const p1 = run(["--root", B, "--compare", snapA]);
/* The success line was reworded from "nothing disappeared" to "nothing was
   removed" when the failure policy was revised (R82): paired expression changes
   are now reported without failing, so "nothing disappeared" would have been
   inaccurate. Both spellings are accepted so this harness works either side of
   that change. */
const pole1 = p1.code === 0 && /0 disappearance\(s\)/.test(p1.out) && /OK — nothing (disappeared|was removed)/.test(p1.out);
console.log(`\nPOLE 1 — identical trees: ${pole1 ? "GREEN as required" : "*** BROKEN ***"}`);
console.log(p1.out.trim().split("\n").slice(-3).join("\n"));

/* ── POLE 2 — five planted mutations must each be caught ─────────────────── */
/* M1 · delete a toast() confirmation. */
const m1file = findFile((s) => /toast\(\{[^}]*title:\s*"[^"]{6,}"/.test(s));
edit(m1file, (s) => s.replace(/toast\(\{[\s\S]{0,400}?\}\);?/, "/* M1: notification 'tidied up' by a restyle */"), "M1 toast deleted");

/* M2 · change a status pill's palette classes (colour meaning lost). */
const m2file = findFile((s) => /className="[^"]*bg-amber-(?:50|100)[^"]*"/.test(s));
edit(m2file, (s) => s.replace(/bg-amber-(?:50|100)/, "bg-muted"), "M2 pill palette replaced");

/* M3 · THE ONE THAT MATTERS — empty a money figure, KEEP the data-testid. */
const m3file = findFile((s) => /data-testid="[^"]*"[^>]*>\s*\{\s*format(?:Minor|Money|Currency)\(/.test(s));
edit(m3file, (s) => s.replace(/(data-testid="[^"]*"[^>]*>)\s*\{\s*format(?:Minor|Money|Currency)\([^}]*\}/,
  "$1"), "M3 money figure emptied, data-testid kept");

/* M4 · delete a TabsTrigger, keep its TabsContent panel. */
const m4file = findFile((s) => (s.match(/<TabsTrigger\s+value="/g) ?? []).length >= 2 && /<TabsContent\s+value="/.test(s));
edit(m4file, (s) => s.replace(/<TabsTrigger[\s\S]{0,300}?<\/TabsTrigger>/, "{/* M4: trigger removed in a restyle */}"), "M4 tab trigger deleted");

/* M5 · delete a whole <Button>. */
const m5file = findFile((s) => (s.match(/<Button[\s>]/g) ?? []).length >= 3);
edit(m5file, (s) => s.replace(/<Button[\s\S]{0,500}?<\/Button>/, "{/* M5: button removed in a restyle */}"), "M5 button deleted");

const p2 = run(["--root", B, "--compare", snapA, "--json", path.join(TMP, "diff.json")]);
const diff = JSON.parse(fs.readFileSync(path.join(TMP, "diff.json"), "utf8"));

const has = (cls, file) => diff.drops.some((d) => d.class === cls && d.row.startsWith(file));
const checks = [
  ["M1  toastCopy drop",                     has("toastCopy", m1file)],
  ["M2  statusPill drop",                    has("statusPill", m2file)],
  ["M3  moneyOrPercent drop (money figure)", has("moneyOrPercent", m3file)],
  ["M3  exprChild drop (rendered figure)",   has("exprChild", m3file)],
  ["M4  tabPanelReach became unreachable",   diff.unreachableNow > diff.unreachableBefore],
  ["M5  interactiveSite drop",               has("interactiveSite", m5file)],
  ["M5  per-file count decrease",            diff.countDrops.some((c) => c.file === m5file)],
  ["exit code is 1",                         p2.code === 1],
];
console.log(`\nPOLE 2 — five planted restyle mutations:`);
for (const l of log) console.log(`   planted: ${l}`);
console.log("");
let pole2 = true;
for (const [name, ok] of checks) {
  console.log(`   ${ok ? "CAUGHT " : "MISSED "}  ${name}`);
  if (!ok) pole2 = false;
}
console.log(`\n   ${diff.drops.length} disappearance(s), ${diff.countDrops.length} count decrease(s), exit ${p2.code}`);
console.log(`POLE 2: ${pole2 ? "RED as required" : "*** BROKEN — a mutation slipped through ***"}`);

/* ══ POLE 3 · WAVE 102 — SUPPRESSION MUTATIONS ═══════════════════════════════
   Each mutation gets its OWN fresh copy, because they all target overlapping
   regions of the same investor money panel and a shared copy would let one
   mutation take credit for another's failure. */
let pole3 = true;
const pole3rows = [];
let seq = 0;

function plantSuppression(label, files, expect) {
  seq++;
  const C = path.join(TMP, `sup${seq}`);
  fs.mkdirSync(path.join(C, "client"), { recursive: true });
  fs.cpSync(path.join(REPO, "client", "src"), path.join(C, "client", "src"), { recursive: true });
  for (const [rel, fn] of Object.entries(files)) {
    const p = path.join(C, rel);
    const before = fs.readFileSync(p, "utf8");
    const after = fn(before);
    if (after === before) {
      console.error(`FATAL — suppression mutation ${label} did not change ${rel}. ` +
                    `The anchor moved; fix this script rather than lowering the assertion.`);
      process.exit(1);
    }
    fs.writeFileSync(p, after);
  }
  const jsonPath = path.join(TMP, `sup${seq}.json`);
  const r = run(["--root", C, "--compare", snapA, "--json", jsonPath]);
  const d = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const ok = expect(d, r);
  pole3rows.push([label, ok, r.code, d]);
  if (!ok) pole3 = false;
  fs.rmSync(C, { recursive: true, force: true });
}

const SILO = "client/src/components/investor/InvestorSiloPanel.tsx";
const DASH = "client/src/pages/investor/Dashboard.tsx";
const ACCR = "client/src/pages/investor/Accreditation.tsx";
const TABS = "client/src/components/comms/CommsTiersTabs.tsx";
const sup = (d) => d.suppressions.filter((s) => !s.allowlisted);
const deadc = (d) => d.deadControls.filter((x) => !x.allowlisted);
const bareOf = (d) => d.drops.filter((x) => !x.pairedAddition);

/* S1 · THE DECISIVE ONE. A whole investor money panel suppressed at its call
   site with one added token. Reviewer C's D1: previously exit 0. */
plantSuppression("S1  {false && <Panel />} at the call site — a whole money panel",
  { [DASH]: (s) => s.replace("<InvestorSiloPanel />", "{false && <InvestorSiloPanel />}") },
  (d, r) => r.code === 1 && sup(d).some((x) => x.rel === DASH) &&
            bareOf(d).length >= 1 && d.countDrops.length >= 1);

/* S2 · a single money figure emptied by a constant-false guard. Reviewer C's B1:
   previously reported "6 paired, 0 bare" and exited 0. */
plantSuppression("S2  {false && formatMinor(…)} — one money figure",
  { [SILO]: (s) => s.replace("{t.currency}: {formatMinor(t.minor, t.currency)}",
                             "{t.currency}: {false && formatMinor(t.minor, t.currency)}") },
  (d, r) => r.code === 1 && sup(d).some((x) => x.rel === SILO) &&
            bareOf(d).some((x) => x.class === "moneyOrPercent"));

/* S3 · the call still runs; the render is the empty string. Reviewer C's B3. */
plantSuppression('S3  {formatMinor(…) && ""} — the render is empty',
  { [SILO]: (s) => s.replace("{t.currency}: {formatMinor(t.minor, t.currency)}",
                             '{t.currency}: {formatMinor(t.minor, t.currency) && ""}') },
  (d, r) => r.code === 1 && sup(d).some((x) => x.rel === SILO));

/* S4 · the whole component's return suppressed. Reviewer C's B6. */
plantSuppression("S4  return null && (…) — the whole panel renders nothing",
  { [SILO]: (s) => s.replace('return (\n    <div className="mb-6 space-y-6" data-testid="investor-silo">',
                             'return null && (\n    <div className="mb-6 space-y-6" data-testid="investor-silo">') },
  (d, r) => r.code === 1 && sup(d).some((x) => x.rel === SILO) &&
            bareOf(d).length >= 5 && d.countDrops.length >= 1);

/* S5 · {void 0 && …}. NOT one of Reviewer C's seven — planted so the fold is
   proved on a shape nobody attacked, rather than fitted to the seven. */
plantSuppression("S5  {void 0 && <Panel />} — the void-operator variant",
  { [DASH]: (s) => s.replace("<InvestorSiloPanel />", "{void 0 && <InvestorSiloPanel />}") },
  (d, r) => r.code === 1 && sup(d).some((x) => x.rel === DASH));

/* S6 · a ternary with a constant condition. Also not in Reviewer C's seven. */
plantSuppression("S6  {true ? null : <Panel />} — constant-condition ternary",
  { [DASH]: (s) => s.replace("<InvestorSiloPanel />", "{true ? null : <InvestorSiloPanel />}") },
  (d, r) => r.code === 1 && sup(d).some((x) => x.rel === DASH));

/* S7 · A LAUNDERING ATTEMPT. Hide the constant behind a nested logical chain so
   the outer `&&` sees a BinaryExpression instead of a literal. This is the shape
   that escaped the FIRST implementation of the fold, which is exactly why it is
   planted here permanently. */
plantSuppression("S7  {false && cond && <Panel />} — nested-chain laundering",
  { [DASH]: (s) => s.replace("<InvestorSiloPanel />",
                             "{false && Boolean(1) && <InvestorSiloPanel />}") },
  (d, r) => r.code === 1 && sup(d).some((x) => x.rel === DASH));

/* S8 · a control left on screen with a provably dead handler. Reviewer C's B4:
   previously 0 disappearances of any kind. */
plantSuppression("S8  control kept, onClick renamed dead + disabled — a dead control",
  { [ACCR]: (s) => {
      const m = s.match(/<Button([\s\S]*?)data-testid="button-accreditation-back"([\s\S]*?)>/);
      if (!m) return s;
      return s.replace(m[0], m[0].replace("onClick", "data-dead-onClick").replace(/>$/, " disabled>"));
    } },
  (d, r) => r.code === 1 && deadc(d).some((x) => x.rel === ACCR));

/* S9 · the only trigger reaching a panel given a CONSTANT `disabled`. Reviewer
   C's B5. This was a documented limit; Wave 102 closed the CONSTANT case and
   deliberately left runtime-expression `disabled` to the reachability gate. */
plantSuppression("S9  <TabsTrigger disabled> — the only trigger to a panel",
  { [TABS]: (s) => s.replace(/<TabsTrigger value="/, '<TabsTrigger disabled value="') },
  (d, r) => r.code === 1 && d.unreachableNow > d.unreachableBefore);

console.log(`\nPOLE 3 — nine planted SUPPRESSION mutations (WAVE 102), each on its own copy:`);
for (const [label, ok, code, d] of pole3rows) {
  const s = d.suppressions.filter((x) => !x.allowlisted).length;
  const dc = d.deadControls.filter((x) => !x.allowlisted).length;
  const b = d.drops.filter((x) => !x.pairedAddition).length;
  console.log(`   ${ok ? "CAUGHT " : "MISSED "}  ${label}`);
  console.log(`             exit ${code} · ${s} suppression(s) · ${dc} dead control(s) · ` +
              `${b} bare drop(s) · ${d.countDrops.length} count decrease(s)`);
}
console.log(`POLE 3: ${pole3 ? "RED as required" : "*** BROKEN — a suppression slipped through ***"}`);

if (!process.argv.includes("--keep")) fs.rmSync(TMP, { recursive: true, force: true });
else console.log(`\nscratch kept at ${TMP}`);

const allPoles = pole1 && pole2 && pole3;
console.log(`\nALL THREE POLES: ${allPoles ? "PROVED" : "FAILED"}`);
console.log(`  POLE 1 identical trees GREEN · POLE 2 five DELETIONS red · POLE 3 nine SUPPRESSIONS red`);
console.log(`BOTH POLES: ${allPoles ? "PROVED" : "FAILED"}`);
process.exit(allPoles ? 0 : 1);

