/**
 * WAVE 41 — BOTH-POLE PROOF for every reachability rule.
 *
 * "A gate you cannot make fail proves nothing." This script does not assert what
 * the gate CONSULTS; it plants a real violation in the real tree, runs the real
 * gate binary as a subprocess, and requires that:
 *   (a) the exit code is 1 (RED),
 *   (b) the violation NAMED in the output is the one that was planted, and
 *   (c) after reverting byte-for-byte, the gate exits 0 (GREEN).
 *
 * Two failure modes are treated as failures of the PROOF, not passes:
 *   · RED for some other reason. Checking only the exit code would let a
 *     pre-existing, unrelated violation masquerade as the probe's effect, which
 *     is how "an assertion-only counter blind to files that never loaded" got
 *     into this build. So the planted id must appear in the violation list.
 *   · GREEN before planting. If the tree is already RED, a RED afterwards proves
 *     nothing at all, so the baseline is asserted GREEN first.
 *
 * Revert is byte-for-byte from the original buffer captured before the edit, and
 * is run in a `finally`, so an assertion failure cannot leave a probe behind.
 *
 * Run: node scripts/reachability/prove_poles_wave41.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";

const GATE = ["tsx", "scripts/reachability/reachability_gate.ts", "--json"];

function runGate() {
  try {
    const stdout = execFileSync("npx", GATE, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { exit: 0, report: JSON.parse(stdout), stdout };
  } catch (err) {
    if (err.status === undefined || !err.stdout) throw err;
    return { exit: err.status, report: JSON.parse(err.stdout), stdout: err.stdout };
  }
}

function humanGate() {
  /* The human-readable run, captured verbatim for the report so the evidence is
     the tool's own words rather than this script's paraphrase of them. */
  try {
    const out = execFileSync("npx", ["tsx", "scripts/reachability/reachability_gate.ts"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { exit: 0, out };
  } catch (err) {
    return { exit: err.status, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

const log = [];
function say(s) {
  console.log(s);
  log.push(s);
}

/* ── baseline must be GREEN, or nothing below means anything ───────────────── */
{
  const g = runGate();
  if (g.exit !== 0) {
    console.error(
      "ABORT: the tree is already RED before any probe was planted, so a RED " +
        "result would prove nothing about the probe.\n" +
        g.report.violations.map((v) => `  ${v.rule} ${v.id.replace(/\t/g, " -> ")}`).join("\n"),
    );
    process.exit(1);
  }
  const h = humanGate();
  say("### POLE 0 — BASELINE (must be GREEN before each probe)");
  say("$ npx tsx scripts/reachability/reachability_gate.ts");
  say(h.out.trimEnd());
  say(`EXIT=${h.exit}   <- 0 = GREEN`);
  say("");
}

let failures = 0;

/**
 * @param name       rule under test
 * @param expectRule rule string the gate must report
 * @param expectId   violation id the gate must name (tab-separated, as the gate emits)
 * @param plant      () => void   makes the tree violate
 * @param revert     () => void   restores it byte-for-byte
 */
function pole(name, expectRule, expectId, plant, revert) {
  say(`### ${name}`);
  let red;
  try {
    plant();
    red = runGate();
    const human = humanGate();
    say("--- RED POLE: violation planted ---");
    say("$ npx tsx scripts/reachability/reachability_gate.ts");
    say(human.out.trimEnd());
    say(`EXIT=${human.exit}`);

    const hit = red.report.violations.find((v) => v.rule === expectRule && v.id === expectId);
    if (red.exit !== 1) {
      say(`!! PROOF FAILED: expected exit 1, got ${red.exit}`);
      failures++;
    } else if (!hit) {
      say(
        `!! PROOF FAILED: gate went RED but did NOT name the planted violation ` +
          `(${expectRule} ${expectId.replace(/\t/g, " -> ")}). RED for the wrong reason proves nothing.`,
      );
      failures++;
    } else {
      say(`OK RED, and it NAMED the planted violation: ${expectRule} | ${hit.id.replace(/\t/g, " -> ")}`);
      say(`   detail: ${hit.detail}`);
    }
  } finally {
    revert();
  }

  const green = runGate();
  const humanGreen = humanGate();
  say("--- GREEN POLE: probe reverted ---");
  say("$ npx tsx scripts/reachability/reachability_gate.ts");
  say(humanGreen.out.trimEnd());
  say(`EXIT=${humanGreen.exit}`);
  if (green.exit !== 0) {
    say(
      `!! PROOF FAILED: gate did not return to GREEN after revert. Residual violations:\n` +
        green.report.violations.map((v) => `     ${v.rule} ${v.id.replace(/\t/g, " -> ")}`).join("\n"),
    );
    failures++;
  } else {
    say("OK GREEN after revert — the probe, and only the probe, moved the gate.");
  }
  say("");
}

/* ══ R1 — an unmounted component ═══════════════════════════════════════════ */
const R1_FILE = "client/src/components/Wave41PoleR1Probe.tsx";
pole(
  "POLE R1 — a declared component that no root mount reaches",
  "R1",
  `${R1_FILE}\tWave41PoleR1Orphan`,
  () =>
    writeFileSync(
      R1_FILE,
      `/* WAVE 41 POLE PROBE — transient. Written, measured and deleted by
 * scripts/reachability/prove_poles_wave41.mjs. If this file is on disk, that
 * script crashed between plant and revert. It is imported by nothing. */
export function Wave41PoleR1Orphan() {
  return <div data-testid="wave41-pole-r1">unreachable by construction</div>;
}
`,
    ),
  () => {
    if (existsSync(R1_FILE)) rmSync(R1_FILE);
  },
);

/* ══ R2 — a tab panel with no trigger ══════════════════════════════════════ */
const R2_FILE = "client/src/pages/founder/Settings.tsx";
const R2_ORIGINAL = readFileSync(R2_FILE);
const R2_ANCHOR = `        <TabsContent value="delete" className="mt-4">`;
pole(
  "POLE R2 — a TabsContent with no TabsTrigger (dead panel)",
  "R2",
  `${R2_FILE}\tTabsContent\tvalue=wave41PoleR2`,
  () => {
    const s = R2_ORIGINAL.toString();
    if (!s.includes(R2_ANCHOR)) throw new Error(`R2 probe anchor not found in ${R2_FILE}`);
    /* Planted in the file this wave actually mounted panels into, and in the SAME
       <Tabs> element, so the probe reproduces the exact defect class Wave 41 was
       sent to eliminate: a panel that exists in the markup with no way to select
       it. Deliberately given no trigger. */
    writeFileSync(
      R2_FILE,
      s.replace(
        R2_ANCHOR,
        `        <TabsContent value="wave41PoleR2" className="mt-4">\n` +
          `          <div>WAVE 41 POLE PROBE — no trigger selects this panel.</div>\n` +
          `        </TabsContent>\n` +
          R2_ANCHOR,
      ),
    );
  },
  () => writeFileSync(R2_FILE, R2_ORIGINAL),
);

/* ══ R3 — interactive nesting ══════════════════════════════════════════════ */
const R3_FILE = "client/src/pages/founder/Dashboard.tsx";
const R3_ORIGINAL = readFileSync(R3_FILE);
const R3_ANCHOR = `                <Progress value={section.pct} className="h-1.5" />`;
pole(
  "POLE R3 — an interactive control nested inside another interactive element",
  "R3",
  `${R3_FILE}\ta\t>\tButton`,
  () => {
    const s = R3_ORIGINAL.toString();
    if (!s.includes(R3_ANCHOR)) throw new Error(`R3 probe anchor not found in ${R3_FILE}`);
    /* Planted inside a component that IS root-mounted, so the probe tests R3 on
       its own and cannot be confused with an R1 finding about an orphan probe
       file. <Button> inside <a> is the nesting shape R3 names. */
    writeFileSync(
      R3_FILE,
      s.replace(
        R3_ANCHOR,
        `                <a href="/founder/settings">\n` +
          `                  <Button>WAVE 41 POLE PROBE</Button>\n` +
          `                </a>\n` +
          R3_ANCHOR,
      ),
    );
  },
  () => writeFileSync(R3_FILE, R3_ORIGINAL),
);

/* ══ REGRESSION POLE — the laundering hole this wave closed ════════════════ */
const LAUNDER_FILE = "client/src/components/Wave41LaunderProbe.tsx";
const LAUNDER_TEST = "client/src/components/__tests__/wave41_launder_probe.test.tsx";
say("### POLE R1-LAUNDERING — a render inside a TEST must NOT count as a mount");
say(
  "This is the hole Wave 41 closed in the gate itself. Before the fix, the JSX usage\n" +
    "pass walked test files; a render there had no enclosing in-scope declaration, so\n" +
    "the gate treated it as a ROOT MOUNT and the orphan became invisible to R1. That\n" +
    "is why SettingsFinancialsTab was the one orphan of four that R1 never reported.\n" +
    "Probe: an orphan component whose ONLY render is in a test file. It must still be\n" +
    "reported.",
);
try {
  writeFileSync(
    LAUNDER_FILE,
    `/* WAVE 41 POLE PROBE — transient; see prove_poles_wave41.mjs. */
export function Wave41LaunderOrphan() {
  return <div data-testid="wave41-launder">rendered only by a test</div>;
}
`,
  );
  writeFileSync(
    LAUNDER_TEST,
    `/* WAVE 41 POLE PROBE — transient; see prove_poles_wave41.mjs. */
import { describe, it, expect } from "vitest";
import { Wave41LaunderOrphan } from "../Wave41LaunderProbe";

describe("wave41 launder probe", () => {
  it("renders the orphan in JSX, which used to launder it into 'reachable'", () => {
    const el = <Wave41LaunderOrphan />;
    expect(el).toBeTruthy();
  });
});
`,
  );
  const r = runGate();
  const h = humanGate();
  say("$ npx tsx scripts/reachability/reachability_gate.ts");
  say(h.out.trimEnd());
  say(`EXIT=${h.exit}`);
  const hit = r.report.violations.find(
    (v) => v.rule === "R1" && v.id === `${LAUNDER_FILE}\tWave41LaunderOrphan`,
  );
  if (r.exit === 1 && hit) {
    say("OK RED — the test-only render did NOT launder the orphan. Hole is closed.");
  } else {
    say(
      "!! PROOF FAILED: the orphan was rendered only by a test and the gate did not " +
        "report it. The laundering hole is still open.",
    );
    failures++;
  }
} finally {
  for (const f of [LAUNDER_FILE, LAUNDER_TEST]) if (existsSync(f)) rmSync(f);
}
{
  const g = runGate();
  const h = humanGate();
  say("--- GREEN POLE: probes reverted ---");
  say(h.out.trimEnd());
  say(`EXIT=${h.exit}`);
  if (g.exit !== 0) {
    say("!! PROOF FAILED: not GREEN after revert.");
    failures++;
  } else say("OK GREEN after revert.");
}

say("");
say(failures === 0 ? "ALL POLE PROOFS PASSED (both poles, every rule)." : `${failures} POLE PROOF(S) FAILED.`);
writeFileSync("../build_log/wave41/pole_proofs.txt", log.join("\n") + "\n");
process.exit(failures === 0 ? 0 : 1);
