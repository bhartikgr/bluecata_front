#!/usr/bin/env node
/**
 * WAVE 41 — BOTH POLES FOR THE NEW TESTS THEMSELVES.
 *
 * "A gate you cannot make fail proves nothing" applies to test files exactly as
 * it applies to the reachability gate. 25+ instances of "a check that passed
 * while checking nothing" have already been found in this tree, so a green run
 * of wave41_settings_panel_mounts.test.tsx and
 * wave41_founder_panel_round_trip.test.ts is, on its own, worth nothing.
 *
 * This script plants a MUTATION in the production source that each claim depends
 * on, requires the corresponding test to go RED **naming that test**, then
 * restores the file byte-for-byte and requires GREEN again. A mutation that
 * leaves the suite green means the assertion was decorative and is reported as a
 * failure of this script.
 *
 * Every restore happens in a `finally`, and every restore is verified by
 * comparing the file's bytes against the snapshot taken before the mutation.
 * This repo is NOT a git checkout — there is no `git checkout --` safety net, so
 * the snapshot IS the safety net.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const OUT = [];

const say = (s = "") => {
  console.log(s);
  OUT.push(s);
};

function runVitest(file) {
  try {
    const stdout = execFileSync("npx", ["vitest", "run", file], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, out: stdout };
  } catch (err) {
    if (err.status === undefined) throw err;
    return { code: err.status, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** The summary lines only — vitest prints thousands of lines of app logging. */
function summary(out) {
  return out
    .split("\n")
    .filter((l) => /Test Files|^ *Tests |×|→ /.test(l))
    .slice(0, 24)
    .join("\n");
}

/**
 * @param name        what is being proved
 * @param file        production file to mutate
 * @param from        exact substring to replace (must appear EXACTLY once)
 * @param to          replacement
 * @param testFile    test that must go red
 * @param mustName    substring that must appear in the RED output (the specific
 *                    assertion, so a red for an unrelated reason does not count)
 */
function proveMutationIsCaught({ name, file, from, to, testFile, mustName }) {
  const abs = resolve(ROOT, file);
  const original = readFileSync(abs, "utf8");
  const occurrences = original.split(from).length - 1;

  say("");
  say("=".repeat(78));
  say(`### MUTATION: ${name}`);
  say(`file:    ${file}`);
  say(`test:    ${testFile}`);
  say(`replace: ${JSON.stringify(from)}`);
  say(`with:    ${JSON.stringify(to)}`);
  say(`anchor occurrences in file: ${occurrences}`);
  if (occurrences !== 1) {
    throw new Error(
      `anchor must appear exactly once in ${file}; found ${occurrences}. ` +
        `Refusing to mutate — an ambiguous anchor could corrupt the file.`,
    );
  }

  let ok = false;
  try {
    writeFileSync(abs, original.split(from).join(to));
    const red = runVitest(testFile);
    say("--- RED POLE: mutation planted ---");
    say(summary(red.out));
    say(`EXIT=${red.code}`);
    if (red.code === 0) {
      say(`FAIL — the suite stayed GREEN with the mutation in place. The assertion proves nothing.`);
      return false;
    }
    if (!red.out.includes(mustName)) {
      say(`FAIL — RED, but it did not name the expected assertion: ${JSON.stringify(mustName)}`);
      return false;
    }
    say(`OK RED, and it named the assertion: ${JSON.stringify(mustName)}`);
    ok = true;
  } finally {
    writeFileSync(abs, original);
    const restored = readFileSync(abs, "utf8");
    if (restored !== original) {
      throw new Error(`RESTORE FAILED for ${file} — file no longer byte-identical. STOP.`);
    }
    say(`restored ${file} — byte-identical to snapshot`);
  }

  const green = runVitest(testFile);
  say("--- GREEN POLE: mutation reverted ---");
  say(summary(green.out));
  say(`EXIT=${green.code}`);
  if (green.code !== 0) {
    say("FAIL — not green after revert. Something other than the mutation is broken.");
    return false;
  }
  say("OK GREEN after revert — the mutation, and only the mutation, moved the test.");
  return ok;
}

const SETTINGS = "client/src/pages/founder/Settings.tsx";
const STORE = "server/companyProfileStore.ts";
const CLIENT_TEST = "client/src/pages/founder/__tests__/wave41_settings_panel_mounts.test.tsx";
const SERVER_TEST = "server/__tests__/wave41_founder_panel_round_trip.test.ts";

const CASES = [
  {
    name: "R9 — un-mount the M&A panel's trigger (the exact Wave 40 defect state)",
    file: SETTINGS,
    from: `<TabsTrigger value="mna-prep" data-testid="tab-mna-prep">`,
    to: `<TabsTrigger value="mna-prep-UNREACHABLE" data-testid="tab-mna-prep-UNREACHABLE">`,
    testFile: CLIENT_TEST,
    mustName: "tab-mna-prep",
  },
  {
    name: "R6 — restore the old hydration that collapsed 'not entered' into 0",
    file: SETTINGS,
    from: `          ? null
          : Number(stored);`,
    to: `          ? 0
          : Number(stored);`,
    testFile: CLIENT_TEST,
    mustName: "never 0%",
  },
  {
    name: "R6 — restore the old save that spread the whole map and fabricated six scores",
    file: SETTINGS,
    from: `        if (v === null || v === undefined) continue;`,
    to: `        if (v === undefined) continue;`,
    testFile: CLIENT_TEST,
    mustName: "the other five stay unwritten",
  },
  {
    name: "the Dashboard percentage proof is measuring the SERVER, not a formula in the test",
    file: STORE,
    from: `    if (isPresent(profile[field])) {
      s.complete += weight;`,
    to: `    if (false && isPresent(profile[field])) {
      s.complete += weight;`,
    testFile: SERVER_TEST,
    mustName: "MOVES after a real PATCH",
  },
];

say("WAVE 41 — MUTATION PROOFS FOR THE NEW TESTS");
say(`root: ${ROOT}`);
say(`when: ${new Date().toISOString()}`);
say("");
say("Baseline: both new test files must be GREEN before anything is mutated,");
say("otherwise a RED below could be pre-existing rather than caused.");
for (const f of [CLIENT_TEST, SERVER_TEST]) {
  const r = runVitest(f);
  say(`baseline ${f} -> EXIT=${r.code}`);
  say(summary(r.out));
  if (r.code !== 0) {
    say("ABORT — baseline is not green.");
    writeFileSync(resolve(ROOT, "../build_log/wave41/test_pole_proofs.txt"), OUT.join("\n"));
    process.exit(2);
  }
}

let allOk = true;
try {
  for (const c of CASES) {
    if (!proveMutationIsCaught(c)) allOk = false;
  }
} finally {
  writeFileSync(resolve(ROOT, "../build_log/wave41/test_pole_proofs.txt"), OUT.join("\n") + "\n");
}

say("");
say(allOk ? "ALL MUTATIONS CAUGHT — every new assertion can fail." : "SOME MUTATIONS SURVIVED — see above.");
writeFileSync(resolve(ROOT, "../build_log/wave41/test_pole_proofs.txt"), OUT.join("\n") + "\n");
process.exit(allOk ? 0 : 1);
