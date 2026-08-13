/* WAVE 36 · ROW 3 — attribute every failure delta against the recorded baseline.
   Reads the vitest JSON report and scripts/test_baseline.json, and reports
   BOTH failure counts AND tests-RUN counts, per the row's instruction. */
const fs = require("fs");
const rep = JSON.parse(fs.readFileSync("/tmp/w36_suite_now.json", "utf8"));
const base = JSON.parse(fs.readFileSync("scripts/test_baseline.json", "utf8"));

const norm = (p) => p.replace(/^.*\/work\//, "").replace(/^\.\//, "");
const now = {};      // file -> failed count
const ran = {};      // file -> tests run
let totalTests = 0, totalFailed = 0, totalPassed = 0;

for (const tr of rep.testResults || []) {
  const f = norm(tr.name);
  const results = tr.assertionResults || [];
  ran[f] = (ran[f] || 0) + results.length;
  const fails = results.filter((a) => a.status === "failed").length;
  if (fails) now[f] = (now[f] || 0) + fails;
  totalTests += results.length;
  totalFailed += fails;
  totalPassed += results.filter((a) => a.status === "passed").length;
}

const nowFiles = Object.keys(now).length;
console.log("=== TOTALS ===");
console.log(`tests RUN     now=${totalTests}   baseline=${base.totalTests}   delta=${totalTests - base.totalTests}`);
console.log(`tests PASSED  now=${totalPassed}  baseline=${base.passed}       delta=${totalPassed - base.passed}`);
console.log(`tests FAILED  now=${totalFailed}  baseline=${base.failed}       delta=${totalFailed - base.failed}`);
console.log(`FAILING FILES now=${nowFiles}      baseline=${base.failedFiles}  delta=${nowFiles - base.failedFiles}`);

const all = new Set([...Object.keys(now), ...Object.keys(base.perFile)]);
const worse = [], better = [], newf = [], gone = [];
for (const f of all) {
  const b = base.perFile[f] || 0, n = now[f] || 0;
  if (n === b) continue;
  if (b === 0) newf.push([f, n, ran[f] || 0]);
  else if (n === 0) gone.push([f, b]);
  else if (n > b) worse.push([f, b, n]);
  else better.push([f, b, n]);
}
const num = (a, b) => (b[2] - b[1]) - (a[2] - a[1]);
console.log("\n=== NEWLY FAILING FILES (were 0 in baseline) ===");
newf.sort((a, b) => b[1] - a[1]).forEach(([f, n, r]) => console.log(`  +${n} (of ${r} run)  ${f}`));
console.log("\n=== WORSENED ===");
worse.sort(num).forEach(([f, b, n]) => console.log(`  ${b} -> ${n}  ${f}`));
console.log("\n=== IMPROVED ===");
better.sort((a, b) => (a[2] - a[1]) - (b[2] - b[1])).forEach(([f, b, n]) => console.log(`  ${b} -> ${n}  ${f}`));
console.log("\n=== FIXED ENTIRELY (baseline>0, now 0) ===");
gone.sort((a, b) => b[1] - a[1]).forEach(([f, b]) => console.log(`  ${b} -> 0  ${f}`));
