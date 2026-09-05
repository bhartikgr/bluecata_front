#!/usr/bin/env node
/**
 * scripts/restyle-drop-detector/wave_floor.mjs — W311
 *
 * THE PROBLEM THIS WRAPPER SOLVES
 * ------------------------------
 * `npm run drop:restyle` is `detect.mjs --verify`, which compares against the
 * COMMITTED `baseline.json` (generatedAt 2026-08-22). Two things follow, and
 * both were measured on the day this file was written:
 *
 *   1. `countDrops` is a PER-FILE FLOOR, not a delta. It fires only when today's
 *      count is BELOW the count recorded on 2026-08-22. 98 of the 384 baselined
 *      files currently sit ABOVE their own floor (aggregate slack 1295 counters),
 *      so those files can lose content without `COUNT-FELL` ever firing.
 *   2. `countDrops` iterates `before.perFile`. A FILE ABSENT FROM `before.perFile`
 *      HAS NO FLOOR AT ALL. 29 files in the current tree are in that position.
 *      They can be emptied without a single `COUNT-FELL`, and every row in them
 *      post-dates the baseline so the set diff cannot see it either.
 *
 * And `before.totals` is never read anywhere in `detect.mjs`, so the `elements`
 * total printed on the summary line participates in no comparison whatsoever.
 *
 * THE FIX IS NOT A CODE CHANGE TO detect.mjs. `detect.mjs` ALREADY CONTAINS A
 * TRUSTWORTHY MODE — `--emit` / `--compare`, a fresh before/after comparison —
 * and `prove_poles.mjs` already proves both of its poles. The defect is that
 * production ships `--verify` while the pole proof exercises `--emit/--compare`.
 * `detect.mjs` is therefore NOT EDITED BY W311 AT ALL, so `drop:restyle:poles`
 * and `drop:restyle:test` keep their exact meaning.
 *
 * This wrapper adds the missing comparison and nothing else.
 *
 * USAGE — two phases, and the order is the whole point
 * ---------------------------------------------------
 *   BEFORE the wave's first edit:
 *     npm run drop:restyle:wave:capture -- /tmp/wave-pre.json
 *
 *   AFTER the wave's last edit:
 *     npm run drop:restyle:wave -- /tmp/wave-pre.json
 *
 * The verify phase runs BOTH comparisons and requires BOTH to pass:
 *   (a) detect.mjs --compare <pre.json>   — the WAVE delta   (new)
 *   (b) detect.mjs --verify               — the BASELINE diff (unchanged)
 * Exit 0 only if both exited 0. Nothing in (b) is weakened, relaxed, or skipped.
 *
 * WHY A WRAPPER AND NOT A SINGLE COMMAND: a pre-change snapshot cannot be
 * manufactured after the change. If the capture was not taken, this tool FAILS.
 * It does not fall back to `--verify` alone and report success, because that is
 * exactly the false green W311 exists to remove.
 *
 * WHAT THIS STILL CANNOT SEE — printed on every run:
 *   · an element added and removed within the same wave. Both ends of the diff
 *     see the same tree. Only a test that reads the rendered page can catch it.
 *   · anything outside `client/src` (the detector's default --scope).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DETECT = path.join(HERE, "detect.mjs");
const BASELINE = path.join(HERE, "baseline.json");
const REPO_ROOT = path.resolve(HERE, "..", "..");

const argv = process.argv.slice(2);
const mode = argv[0];
const flag = (f) => argv.includes(f);
const val = (f, d = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

/* Positional args must EXCLUDE the values consumed by flags. A naive
   `filter(a => !a.startsWith("--"))` reads `verify --root /some/dir` as
   "verify the capture at /some/dir", i.e. it silently answers a different
   question than the one asked. Found by W311's own adversarial pass. */
const FLAGS_WITH_VALUES = ["--root", "--out", "--pre", "--scope"];
const positional = (() => {
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (FLAGS_WITH_VALUES.includes(a) && argv[i + 1] && !argv[i + 1].startsWith("--")) i++;
      continue;
    }
    out.push(a);
  }
  return out;
})();

const ROOT = path.resolve(val("--root", REPO_ROOT));

function usage(msg) {
  if (msg) console.error(`restyle-wave-floor: ${msg}\n`);
  console.error(
    "usage:\n" +
      "  wave_floor.mjs capture <pre.json> [--root <dir>]\n" +
      "      Snapshot the tree BEFORE the wave's edits. Refuses to overwrite\n" +
      "      scripts/restyle-drop-detector/baseline.json.\n" +
      "  wave_floor.mjs verify  <pre.json> [--root <dir>]\n" +
      "      Run BOTH the wave delta (--compare <pre.json>) and the unchanged\n" +
      "      baseline diff (--verify). Exit 0 only if both pass.\n",
  );
  process.exit(2);
}

/** Run detect.mjs and return { status, stdout, stderr }. Never swallows a code. */
function detect(args) {
  const r = spawnSync(process.execPath, [DETECT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) {
    console.error(`restyle-wave-floor: FATAL — could not run detect.mjs: ${r.error.message}`);
    process.exit(2);
  }
  /* A signal death has status === null. Treating that as 0 would be the
     "runner printing passed while exiting nonzero" failure. */
  if (typeof r.status !== "number") {
    console.error(
      `restyle-wave-floor: FATAL — detect.mjs did not exit normally (signal=${r.signal}). ` +
        "Refusing to interpret this as a pass.",
    );
    process.exit(2);
  }
  return r;
}

function limitations() {
  console.log("");
  console.log("WHAT THE WAVE DELTA STILL CANNOT SEE (W311 does not close these):");
  console.log("  · an element ADDED AND REMOVED within this same wave — both ends of the");
  console.log("    diff see the same tree. Only a test that reads the rendered page can.");
  console.log("  · anything outside the detector's --scope (default: client/src).");
  console.log("  · a rendered value that changes rather than disappears; this instrument");
  console.log("    counts and identifies nodes, it does not check what they say.");
}

/* ── capture ─────────────────────────────────────────────────────────────── */
if (mode === "capture") {
  const dest = positional[0] ?? val("--out");
  if (!dest) usage("capture needs an output path");
  const resolved = path.resolve(dest);
  if (resolved === path.resolve(BASELINE) || path.basename(resolved) === "baseline.json") {
    console.error(
      "REFUSED: a wave capture must not be written to baseline.json.\n" +
        `         ${resolved}\n` +
        "         Overwriting the committed baseline silently forgives every drop that\n" +
        "         occurred since 2026-08-22. Pick a wave-scoped path, e.g. /tmp/wave-pre.json",
    );
    process.exit(2);
  }
  const r = detect(["--root", ROOT, "--emit", resolved]);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`restyle-wave-floor: capture FAILED — detect.mjs --emit exited ${r.status}.`);
    process.exit(r.status);
  }
  /* PRECONDITION, not decoration: a capture with zero files scanned would let
     every later --compare pass vacuously. Refuse to hand back such a file. */
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (e) {
    console.error(`restyle-wave-floor: capture FAILED — wrote an unreadable file: ${e.message}`);
    process.exit(2);
  }
  const files = snap.totals?.filesScanned ?? 0;
  const els = snap.totals?.elements ?? 0;
  const perFile = Object.keys(snap.perFile ?? {}).length;
  if (files < 1 || els < 1 || perFile < 1) {
    console.error(
      "restyle-wave-floor: capture REFUSED — the snapshot is empty " +
        `(filesScanned=${files} elements=${els} perFile=${perFile}). ` +
        "An empty capture would make every later comparison pass vacuously.",
    );
    fs.rmSync(resolved, { force: true });
    process.exit(2);
  }
  console.log("");
  console.log(`restyle-wave-floor: WAVE CAPTURE OK -> ${resolved}`);
  console.log(`  root=${ROOT}  filesScanned=${files}  perFile entries=${perFile}  elements=${els}`);
  console.log(`  every one of those ${perFile} files now has a floor for THIS wave, including`);
  console.log(`  the files that have no entry in the committed 2026-08-22 baseline at all.`);
  console.log(`  Verify after editing:  npm run drop:restyle:wave -- ${resolved}`);
  process.exit(0);
}

/* ── verify ──────────────────────────────────────────────────────────────── */
if (mode === "verify") {
  const pre = positional[0] ?? val("--pre");
  if (!pre) usage("verify needs the path of the pre-wave capture");
  const preResolved = path.resolve(pre);
  if (!fs.existsSync(preResolved)) {
    console.error(
      `restyle-wave-floor: FAILED — no pre-wave capture at ${preResolved}.\n` +
        "  A pre-change snapshot cannot be manufactured after the change. Capture it at\n" +
        "  the START of the wave:  npm run drop:restyle:wave:capture -- <file>\n" +
        "  This tool will NOT fall back to `--verify` alone and report success: a\n" +
        "  baseline diff cannot answer the per-wave question, which is the whole of W311.",
    );
    process.exit(2);
  }
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(preResolved, "utf8"));
  } catch (e) {
    console.error(`restyle-wave-floor: FAILED — unreadable capture ${preResolved}: ${e.message}`);
    process.exit(2);
  }
  /* The capture must be a capture of THIS detector, and of THIS tree.
     A capture taken from a different root would compare two unrelated trees
     and could pass or fail for reasons that have nothing to do with the wave.
     Refusing is the only honest answer; there is no safe default. */
  const REQUIRED = ["generatedAt", "root", "totals", "inventory", "perFile"];
  const missing = REQUIRED.filter((k) => snap[k] === undefined);
  if (missing.length) {
    console.error(
      `restyle-wave-floor: FAILED — ${preResolved} is not a detect.mjs --emit snapshot ` +
        `(missing: ${missing.join(", ")}). Refusing to compare against it.`,
    );
    process.exit(2);
  }
  if (path.resolve(snap.root) !== ROOT) {
    console.error(
      "restyle-wave-floor: FAILED — the capture is of a DIFFERENT TREE.\n" +
        `    capture root    : ${path.resolve(snap.root)}\n` +
        `    tree under test : ${ROOT}\n` +
        "  Comparing two different trees produces a verdict about neither. This is\n" +
        "  the same class of defect W311 was opened to fix: a verdict derived from\n" +
        "  one tree while the counters describe another.",
    );
    process.exit(2);
  }

  const preFiles = snap.totals?.filesScanned ?? 0;
  const prePerFile = Object.keys(snap.perFile ?? {}).length;
  const preEls = snap.totals?.elements ?? 0;
  if (preFiles < 1 || preEls < 1 || prePerFile < 1) {
    console.error(
      "restyle-wave-floor: FAILED — the pre-wave capture is empty " +
        `(filesScanned=${preFiles} elements=${preEls} perFile=${prePerFile}). ` +
        "Comparing against it would pass vacuously. Re-capture from a real tree.",
    );
    process.exit(2);
  }

  console.log("=".repeat(72));
  console.log("restyle-wave-floor (W311) — TWO comparisons, both must pass");
  console.log("=".repeat(72));
  console.log(`  pre-wave capture : ${preResolved}`);
  console.log(`     generatedAt   : ${snap.generatedAt ?? "unknown"}`);
  console.log(`     captured root : ${snap.root ?? "unknown"}`);
  console.log(`     floors        : ${prePerFile} file(s), elements=${preEls}, filesScanned=${preFiles}`);
  console.log(`  tree under test  : ${ROOT}`);
  console.log("");

  /* (a) THE WAVE DELTA — the comparison production never ran. */
  console.log("-".repeat(72));
  console.log("(a) WAVE DELTA   detect.mjs --compare <pre-wave capture>");
  console.log("-".repeat(72));
  const a = detect(["--root", ROOT, "--compare", preResolved]);
  process.stdout.write(a.stdout);
  process.stderr.write(a.stderr);
  console.log(`(a) exit=${a.status}`);

  /* (b) THE BASELINE DIFF — unchanged, unweakened, against the committed
         baseline. Always run, whatever (a) said. */
  console.log("");
  console.log("-".repeat(72));
  console.log("(b) BASELINE DIFF   detect.mjs --verify   (unchanged by W311)");
  console.log("-".repeat(72));
  /* `--root` is passed here too. Without it, (b) would silently measure the
     repo root while (a) measured `--root`, so the two halves of the verdict
     would describe DIFFERENT TREES — which is the exact shape of the defect
     W311 exists to remove (a verdict from one tree, counters from another). */
  const b = detect(["--root", ROOT, "--verify"]);
  process.stdout.write(b.stdout);
  process.stderr.write(b.stderr);
  console.log(`(b) exit=${b.status}`);

  const failed = a.status !== 0 || b.status !== 0;
  console.log("");
  console.log("=".repeat(72));
  console.log(
    `restyle-wave-floor: (a) wave delta exit=${a.status} · (b) baseline diff exit=${b.status} · ` +
      `VERDICT ${failed ? "FAIL" : "OK"}`,
  );
  if (failed) {
    console.log("  A wave-delta failure means content that existed when this wave STARTED is");
    console.log("  gone now. It is not forgiven by the committed baseline and must not be");
    console.log("  made to pass by re-capturing the pre-wave snapshot — that is the same act");
    console.log("  as re-baselining.");
  } else {
    console.log("  Nothing that existed at the start of this wave is gone, AND nothing that");
    console.log("  existed in the 2026-08-22 baseline is gone unforgiven.");
  }
  console.log("=".repeat(72));
  limitations();
  /* The exit code is the verdict. The printed word must never disagree with it. */
  process.exit(failed ? 1 : 0);
}

usage(mode ? `unknown mode '${mode}'` : "no mode given");
