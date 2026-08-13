const fs = require("fs");
const rep = JSON.parse(fs.readFileSync("/tmp/w36_suite_now.json", "utf8"));
const want = new Set(process.argv.slice(2));
const norm = (p) => p.replace(/^.*\/work\//, "");
for (const tr of rep.testResults || []) {
  const f = norm(tr.name);
  if (want.size && ![...want].some((w) => f.includes(w))) continue;
  for (const a of tr.assertionResults || []) {
    if (a.status !== "failed") continue;
    console.log(`\n### ${f}\n  TEST: ${a.fullName}`);
    console.log("  MSG: " + (a.failureMessages || []).join("\n").split("\n").slice(0, 12).join("\n  "));
  }
}
