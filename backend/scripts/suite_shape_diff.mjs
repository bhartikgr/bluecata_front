#!/usr/bin/env node
/**
 * SUITE SHAPE DIFF — standing gate, owner-approved 2026-08-14.
 *
 * WHY THIS EXISTS
 * ---------------
 * The failing-test-NAME diff is necessary but NOT sufficient. This project has
 * now hit three variants of the same failure mode, and the name diff missed two
 * of them:
 *
 *   1. Wave 49  — landed 64 passing tests while breaking 4. The aggregate COUNT
 *                 moved 460 -> 464 and absorbed the regression.
 *   2. Repair 1 — an installer made two test FILES stop loading. 12 passing
 *                 assertions vanished (11 of them `isPlatformAdmin fails
 *                 closed`). Same 460 -> 457, same GONE/NEW name sets.
 *   3. Repair 1 — a sacred-path schema gap made `auditChainVerifier.test.ts`
 *                 error during setup, so all 20 of its assertions were reported
 *                 SKIPPED, not FAILED. The name diff was clean.
 *
 * A test that stops RUNNING is not a test that passes. Nothing in a failing-name
 * diff can see a disappearing or skipped assertion, because the name never
 * appears on the failing side.
 *
 * WHAT IT CHECKS, per test FILE (never in aggregate — aggregates are what hid
 * all three):
 *   - reported assertion count dropped        -> ERROR (assertions disappeared)
 *   - skipped/pending count rose              -> ERROR (a test stopped running)
 *   - a file present BEFORE is missing AFTER  -> ERROR (file stopped loading)
 *   - passing count dropped without a matching new failure -> ERROR
 *
 * New files and newly-added assertions are reported but never fail the gate:
 * adding tests is the point of a repair wave.
 *
 * USAGE
 *   node scripts/suite_shape_diff.mjs <before.json> <after.json>
 * Exit 0 = shape intact. Exit 1 = something stopped running. Read the report.
 */
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: suite_shape_diff.mjs <before.json> <after.json>");
  process.exit(2);
}

/** Per-file shape: assertion totals by status, keyed by repo-relative path. */
function shape(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const files = new Map();
  for (const f of raw.testResults ?? []) {
    // Normalise: vitest emits absolute paths that differ between machines.
    const name = (f.name ?? "").split("/work/").pop() ?? f.name ?? "?";
    const rows = f.assertionResults ?? [];
    let passed = 0, failed = 0, skipped = 0;
    for (const a of rows) {
      const s = a.status;
      if (s === "passed") passed++;
      else if (s === "failed") failed++;
      else skipped++; // pending | skipped | todo — all mean "did not run"
    }
    files.set(name, { total: rows.length, passed, failed, skipped });
  }
  return files;
}

const before = shape(beforePath);
const after = shape(afterPath);
const errors = [];
const notes = [];

for (const [file, b] of before) {
  const a = after.get(file);

  if (!a) {
    errors.push(
      `FILE STOPPED REPORTING: ${file}\n` +
      `    had ${b.total} assertions (${b.passed} passing) and reports none now.\n` +
      `    A file that does not load cannot fail by name — this is the Repair 1 near-miss.`,
    );
    continue;
  }

  if (a.total < b.total) {
    errors.push(
      `ASSERTIONS DISAPPEARED: ${file}\n` +
      `    reported ${b.total} before, ${a.total} after (${b.total - a.total} gone).`,
    );
  }

  if (a.skipped > b.skipped) {
    errors.push(
      `TESTS STOPPED RUNNING: ${file}\n` +
      `    skipped/pending ${b.skipped} -> ${a.skipped} (+${a.skipped - b.skipped}).\n` +
      `    Usually a setup/beforeAll error, which vitest reports as skipped, not failed.`,
    );
  }

  // A drop in passing is only acceptable if those tests now FAIL (visible to the
  // name diff). If passing fell further than failing rose, coverage was lost.
  const lostPassing = b.passed - a.passed;
  const gainedFailing = a.failed - b.failed;
  if (lostPassing > 0 && lostPassing > gainedFailing) {
    errors.push(
      `PASSING COVERAGE LOST: ${file}\n` +
      `    passing ${b.passed} -> ${a.passed} (-${lostPassing}) but failing only ` +
      `${b.failed} -> ${a.failed} (+${gainedFailing}).\n` +
      `    ${lostPassing - gainedFailing} assertion(s) neither pass nor fail — they vanished.`,
    );
  }
}

for (const [file, a] of after) {
  if (!before.has(file)) notes.push(`new file: ${file} (+${a.total} assertions, ${a.passed} passing)`);
}

const sum = (m, k) => [...m.values()].reduce((t, v) => t + v[k], 0);
console.log("SUITE SHAPE DIFF");
console.log(`  before: ${before.size} files · ${sum(before, "total")} assertions · ` +
            `${sum(before, "passed")} passed · ${sum(before, "failed")} failed · ${sum(before, "skipped")} skipped`);
console.log(`  after : ${after.size} files · ${sum(after, "total")} assertions · ` +
            `${sum(after, "passed")} passed · ${sum(after, "failed")} failed · ${sum(after, "skipped")} skipped`);

if (notes.length) {
  console.log(`\n  ${notes.length} new file(s) — reported, not a failure:`);
  for (const n of notes.slice(0, 20)) console.log(`    ${n}`);
  if (notes.length > 20) console.log(`    … and ${notes.length - 20} more`);
}

if (errors.length) {
  console.log(`\nSHAPE REGRESSIONS: ${errors.length}\n`);
  for (const e of errors) console.log(`  ${e}\n`);
  console.log("RESULT: FAIL — a test stopped running. The failing-name diff cannot see this.");
  process.exit(1);
}

console.log("\nRESULT: OK — no file lost assertions, gained skips, or stopped reporting.");
