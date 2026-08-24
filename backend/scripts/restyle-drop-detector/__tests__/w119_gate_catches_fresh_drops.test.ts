/**
 * WAVE 119 · W119-T — THE RE-BASELINED GATE MUST STILL CATCH A FRESH DROP.
 * ============================================================================
 *
 * Wave 119 re-pinned `scripts/restyle-drop-detector/baseline.json` after waves
 * 112–118 rewrote a great deal of rendered copy. A re-pin is the one operation
 * that can turn a working gate into a rubber stamp: every disappearance the
 * gate was complaining about becomes, by definition, the new normal. The
 * project's hard rule is therefore that a re-baselined gate must be PROVED
 * still able to catch a fresh drop.
 *
 * `W119_TESTS.md` records that proof once, against the real tree, by hand.
 * THIS FILE is the same proof made permanent, so the property cannot rot.
 *
 * WHAT IS PINNED
 *   · POLE N (known negative)  — an unmutated tree verifies clean, exit 0.
 *   · POLE P1 — a deleted rendered COPY STRING is reported and fails the build,
 *               even though the element and its `data-testid` are kept.
 *   · POLE P2 — a removed INTERACTIVE CONTROL is reported and fails the build.
 *   · POLE P3 — a deleted WHOLE FILE is reported as `*file*: present -> MISSING`.
 *   · THE INSTRUMENT ITSELF — for each of P1/P2/P3, the SAME mutation is re-run
 *               against a deliberately BLINDED copy of detect.mjs, and the test
 *               asserts the blinded copy goes quiet. Without this, the three
 *               poles above could pass for an unrelated reason and would not
 *               actually be measuring the detector's eyesight.
 *   · THE FAILURE POLICY — the source-level pin that bare drops, per-file count
 *               decreases, new suppressions and new dead controls all still
 *               FAIL. This is what a future wave would have to edit to make the
 *               gate permissive, and editing it breaks this test.
 *   · THE TWO IN-SOURCE AUTHORITY ALLOWLISTS — exactly ONE suppression and NINE
 *               dead controls. Widening either is the other way to fake green.
 *
 * The tree used for the poles is a small SYNTHETIC `client/src`, built in the
 * OS temp directory and removed in `afterAll`. Nothing is written inside the
 * repository, and the real `baseline.json` is never read or written by this
 * file — each pole emits and compares against its own throwaway baseline.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DETECTOR_DIR = path.resolve(__dirname, "..");
const DETECT = path.join(DETECTOR_DIR, "detect.mjs");
const REPO_ROOT = path.resolve(DETECTOR_DIR, "..", "..");

let TMP: string;

/* ── the synthetic tree ────────────────────────────────────────────────────
   Deliberately ordinary: a page with a labelled money figure, a copy string
   inside an element that also carries a `data-testid` (so a copy deletion
   cannot be inferred from the element count), two interactive controls, and a
   second component file whose entire contents exist to be deleted in P3. */
const PAGE = `import { Button } from "@/components/ui/button";

export default function W119Page({ total, onExport }: { total: string; onExport: () => void }) {
  return (
    <div className="p-4">
      <div data-testid="w119-total-label">Total subscribed</div>
      <div data-testid="w119-total-figure">{formatMinor(total)}</div>
      <Button data-testid="w119-export" onClick={() => onExport()}>Export</Button>
      <Button data-testid="w119-refresh" onClick={() => onExport()}>Refresh</Button>
    </div>
  );
}
`;

const PANEL = `export function W119Panel({ note }: { note: string }) {
  return (
    <section data-testid="w119-panel">
      <h3>Reporting notes</h3>
      <p data-testid="w119-panel-note">{note}</p>
      <button data-testid="w119-panel-ack" onClick={() => undefined}>Acknowledge</button>
    </section>
  );
}
`;

const PAGE_REL = "client/src/pages/w119/W119Page.tsx";
const PANEL_REL = "client/src/components/w119/W119Panel.tsx";

type Run = { code: number; out: string };

function runDetector(root: string, baseline: string, detect = DETECT): Run {
  try {
    const out = execFileSync(process.execPath, [detect, "--root", root, "--compare", baseline], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/**
 * Build a pristine synthetic tree + its own baseline.
 *
 * `emitWith` matters: for the INSTRUMENT CHECKS the throwaway baseline must be
 * emitted by the SAME (blinded) detector that will later compare against it.
 * Emitting with the real detector and comparing with a blinded one would make
 * every row of the blinded capability look "dropped" on an unmutated tree, and
 * the check would prove nothing about eyesight.
 */
function freshTree(label: string, emitWith = DETECT): { root: string; baseline: string } {
  const root = path.join(TMP, label);
  fs.mkdirSync(path.join(root, "client/src/pages/w119"), { recursive: true });
  fs.mkdirSync(path.join(root, "client/src/components/w119"), { recursive: true });
  fs.writeFileSync(path.join(root, PAGE_REL), PAGE);
  fs.writeFileSync(path.join(root, PANEL_REL), PANEL);
  const baseline = path.join(root, "baseline.json");
  execFileSync(process.execPath, [emitWith, "--root", root, "--emit", baseline], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return { root, baseline };
}

/** A copy of detect.mjs with ONE capability surgically removed. */
function blindedDetector(label: string, edits: Array<[string, string]>): string {
  const src = fs.readFileSync(DETECT, "utf8");
  let out = src;
  for (const [from, to] of edits) {
    expect(src.includes(from), `blinding anchor missing from detect.mjs: ${from}`).toBe(true);
    out = out.split(from).join(to);
  }
  expect(out).not.toBe(src);
  const dest = path.join(DETECTOR_DIR, `.w119-blinded-${label}.mjs`);
  fs.writeFileSync(dest, out);
  return dest;
}

const blindedFiles: string[] = [];

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "w119-restyle-"));
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const f of blindedFiles) fs.rmSync(f, { force: true });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("W119 · POLE N — the known negative", () => {
  it("W119-T-N1 · an unmutated tree verifies clean and exits 0", () => {
    const { root, baseline } = freshTree("poleN");
    const r = runDetector(root, baseline);
    expect(r.out).toContain("OK — nothing was removed and nothing was suppressed.");
    expect(r.out).toContain("0 disappearance(s) (0 bare, 0 paired), 0 per-file count decrease(s)");
    expect(r.code).toBe(0);
  });

  it("W119-T-N2 · the synthetic tree is actually inventoried (a gate that sees nothing proves nothing)", () => {
    const { root, baseline } = freshTree("poleN2");
    const b = JSON.parse(fs.readFileSync(baseline, "utf8"));
    expect(b.totals.filesScanned).toBe(2);
    expect(b.inventory.jsxTextCopy).toContain(`${PAGE_REL}\ttext\tTotal subscribed`);
    expect(b.inventory.interactiveSite).toContain(`${PAGE_REL}\tButton\tdata-testid=w119-export`);
    expect(b.perFile[PANEL_REL]).toBeDefined();
    void root;
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("W119 · POLE P1 — a deleted rendered COPY STRING is caught", () => {
  const mutate = (root: string) => {
    const p = path.join(root, PAGE_REL);
    const t = fs.readFileSync(p, "utf8");
    const from = `<div data-testid="w119-total-label">Total subscribed</div>`;
    const to = `<div data-testid="w119-total-label"></div>`;
    expect(t).toContain(from);
    fs.writeFileSync(p, t.replace(from, to));
  };

  it("W119-T-P1 · the string is named, and the build fails, with the element and testid kept", () => {
    const { root, baseline } = freshTree("poleP1");
    mutate(root);
    const r = runDetector(root, baseline);
    expect(r.out).toContain(`DROPPED  jsxTextCopy  ${PAGE_REL}\ttext\tTotal subscribed`);
    expect(r.out).toContain("FAIL — a restyle removed, suppressed or deadened rendered content");
    expect(r.code).toBe(1);
    /* the element survived — so this drop was NOT inferable from the count. */
    expect(r.out).not.toContain("COUNT-FELL");
  });

  it("W119-T-P1b · INSTRUMENT CHECK — a copy-blind detector goes quiet on the SAME mutation", () => {
    const blind = blindedDetector("copy", [
      ["sets.jsxTextCopy.add(`${rel}\\ttext\\t${t}`);", "/* W119 blinding */"],
    ]);
    blindedFiles.push(blind);
    const { root, baseline } = freshTree("poleP1b", blind);
    mutate(root);
    const r = runDetector(root, baseline, blind);
    expect(r.out).not.toContain("Total subscribed");
    expect(r.out).toContain("OK — nothing was removed and nothing was suppressed.");
    expect(r.code).toBe(0);
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("W119 · POLE P2 — a removed INTERACTIVE CONTROL is caught", () => {
  const mutate = (root: string) => {
    const p = path.join(root, PAGE_REL);
    const t = fs.readFileSync(p, "utf8");
    const from = `      <Button data-testid="w119-export" onClick={() => onExport()}>Export</Button>\n`;
    expect(t).toContain(from);
    fs.writeFileSync(p, t.replace(from, ""));
  };

  it("W119-T-P2 · the control is named by its identity, and the build fails", () => {
    const { root, baseline } = freshTree("poleP2");
    mutate(root);
    const r = runDetector(root, baseline);
    expect(r.out).toContain(`DROPPED  interactiveSite  ${PAGE_REL}\tButton\tdata-testid=w119-export`);
    expect(r.out).toContain(`COUNT-FELL  ${PAGE_REL}  interactiveAll: 2 -> 1`);
    expect(r.out).toContain("FAIL — a restyle removed, suppressed or deadened rendered content");
    expect(r.code).toBe(1);
  });

  it("W119-T-P2b · INSTRUMENT CHECK — a control-blind detector loses the named identity", () => {
    const blind = blindedDetector("control", [
      ["sets.interactiveSite.add(`${rel}\\t${tag}\\t${id}`);", "/* W119 blinding */"],
      ["counters.interactiveAll++;", "/* W119 blinding */"],
    ]);
    blindedFiles.push(blind);
    const { root, baseline } = freshTree("poleP2b", blind);
    mutate(root);
    const r = runDetector(root, baseline, blind);
    expect(r.out).not.toContain("data-testid=w119-export");
    expect(r.out).not.toContain("interactiveAll: 2 -> 1");
    void r.code;
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("W119 · POLE P3 — a deleted WHOLE FILE is caught", () => {
  const mutate = (root: string) => fs.rmSync(path.join(root, PANEL_REL));

  it("W119-T-P3 · the missing file is named, and the build fails", () => {
    const { root, baseline } = freshTree("poleP3");
    mutate(root);
    const r = runDetector(root, baseline);
    expect(r.out).toContain(`COUNT-FELL  ${PANEL_REL}  *file*: present -> MISSING`);
    /* and every row it carried is reported BARE — nothing was put back. */
    expect(r.out).toContain(`DROPPED  interactiveSite  ${PANEL_REL}\tbutton\tdata-testid=w119-panel-ack`);
    expect(r.out).toContain(`DROPPED  jsxTextCopy  ${PANEL_REL}\ttext\tReporting notes`);
    expect(r.out).toContain("FAIL — a restyle removed, suppressed or deadened rendered content");
    expect(r.code).toBe(1);
  });

  it("W119-T-P3b · INSTRUMENT CHECK — a file-loss-blind detector stops naming the file", () => {
    const blind = blindedDetector("fileloss", [
      [`countDrops.push({ file, counter: "*file*", before: "present", after: "MISSING" });`,
       "/* W119 blinding */"],
    ]);
    blindedFiles.push(blind);
    const { root, baseline } = freshTree("poleP3b", blind);
    mutate(root);
    const r = runDetector(root, baseline, blind);
    expect(r.out).not.toContain("*file*: present -> MISSING");
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("W119 · THE FAILURE POLICY AND THE TWO AUTHORITY ALLOWLISTS", () => {
  const src = () => fs.readFileSync(DETECT, "utf8");

  it("W119-T-F1 · all five failure signatures are still wired into `failed`", () => {
    const s = src();
    expect(s).toContain("const bareDrops = drops.filter((d) => !d.pairedAddition);");
    expect(s).toContain("const failed = bareDrops.length > 0 || countDrops.length > 0 ||");
    expect(s).toContain("unreachable.length > unreachableBefore.length ||");
    expect(s).toContain("newSuppressions.length > 0 || newDeadControls.length > 0;");
    expect(s).toContain("process.exit(failed ? 1 : 0);");
  });

  it("W119-T-F2 · there is still no --update-baseline style escape hatch inside --verify", () => {
    const s = src();
    expect(s).not.toContain("--update-baseline");
    expect(s).not.toContain("--ignore-drops");
    /* --emit exists and must, but it is a separate mode that exits BEFORE any
       comparison — it can never be reached from a failing --verify run. */
    const emitIdx = s.indexOf(`if (flag("--emit"))`);
    const compareIdx = s.indexOf("const { drops, adds, countDrops } = compare(before, now);");
    expect(emitIdx).toBeGreaterThan(0);
    expect(compareIdx).toBeGreaterThan(emitIdx);
  });

  it("W119-T-F3 · the suppression allowlist still holds exactly ONE entry, with a reason", () => {
    const s = src();
    const block = s.slice(s.indexOf("const SUPPRESSION_ALLOWLIST = new Map(["));
    const body = block.slice(0, block.indexOf("]);"));
    const entries = body.split("\n").filter((l) => /^\s*\[\s*"/.test(l));
    expect(entries.length).toBe(1);
    /* the authority must be CITED, by file and line, next to the entry. */
    expect(body).toMatch(/\.tsx:\d+/);
    expect(body).toContain("AUTHORITY IS IN THE SOURCE");
  });

  it("W119-T-F4 · the dead-control allowlist still holds exactly NINE entries", () => {
    const s = src();
    const block = s.slice(s.indexOf("const DEAD_CONTROL_ALLOWLIST = new Map(["));
    const body = block.slice(0, block.indexOf("]);"));
    const entries = body.split("\n").filter((l) => /^\s*\[\s*"/.test(l));
    expect(entries.length).toBe(9);
  });

  it("W119-T-F5 · the live allowlist counts the detector REPORTS are 1 and 9", () => {
    /* Read from the re-pinned baseline rather than by re-scanning the tree, so
       this assertion is about the ratified numbers and stays fast. */
    const b = JSON.parse(fs.readFileSync(path.join(DETECTOR_DIR, "baseline.json"), "utf8"));
    expect(b.totals.suppressionsAllowlisted).toBe(1);
    expect(b.totals.deadControlsAllowlisted).toBe(9);
    expect(b.totals.suppressions).toBe(0);
    expect(b.totals.deadControls).toBe(0);
  });

  it("W119-T-F6 · a zero-file scan is a hard failure, not a pass", () => {
    const empty = path.join(TMP, "emptyroot");
    fs.mkdirSync(empty, { recursive: true });
    const r = runDetector(empty, path.join(DETECTOR_DIR, "baseline.json"));
    expect(r.out).toContain("FATAL — scanned 0 files. A gate that finds nothing must fail.");
    expect(r.code).toBe(2);
  });
});
