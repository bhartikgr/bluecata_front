/* ════════════════════════════════════════════════════════════════════════════
 * WAVE 262 — proof that server test files are inside the type check, and that
 * nobody quietly puts them back outside it.
 *
 * The defect this pins: the root `tsconfig.json` excluded `"**\/*.test.ts"`,
 * which removed 796 `server/**\/*.test.ts` files from `npx tsc --noEmit` and
 * made the tsc invariant VACUOUS for every one of them.
 *
 * HOW THE SCOPE IS PROVED. The config is expanded by TypeScript's OWN resolver
 * (`ts.parseJsonConfigFileContent`) against the REAL filesystem, so the file
 * list under test is the list the compiler would actually build. The glob
 * semantics are not reimplemented here — reimplementing them would be a replica,
 * and a replica proves the replica.
 *
 * WHAT IS DELIBERATELY *NOT* PINNED: the headline error count. Pinning 577 in a
 * test would turn every unrelated type fix into a red build and would invite
 * loosening. The count lives in build_log/wave262/W262_BUILD.md, where a human
 * reads it. What is pinned here is the SCOPE — the property that was broken.
 * ══════════════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const CONFIG = path.join(ROOT, "tsconfig.json");

function loadProgramFileNames(): string[] {
  const read = ts.readConfigFile(CONFIG, (p) => fs.readFileSync(p, "utf8"));
  expect(read.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT, undefined, CONFIG);
  expect(parsed.errors.filter((e) => e.category === ts.DiagnosticCategory.Error)).toHaveLength(0);
  return parsed.fileNames.map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
}

const rawConfig = () =>
  JSON.parse(fs.readFileSync(CONFIG, "utf8")) as {
    exclude?: string[];
    compilerOptions?: Record<string, unknown>;
  };

describe("wave 262 — server test files are inside the type check", () => {
  it("the blanket `**/*.test.ts` exclusion is gone", () => {
    const cfg = rawConfig();
    expect(cfg.exclude).toBeDefined();
    expect(cfg.exclude).not.toContain("**/*.test.ts");
    /* and no other glob may re-hide the whole test corpus by another spelling */
    for (const pattern of cfg.exclude ?? []) {
      expect(pattern).not.toMatch(/^\*\*\/\*\.test\.tsx?$/);
      expect(pattern).not.toMatch(/^server\/\*\*\/\*\.test\.ts$/);
      expect(pattern).not.toMatch(/^server\/__tests__/);
      expect(pattern).not.toBe("server");
      expect(pattern).not.toBe("server/**");
    }
  });

  it("TypeScript's own resolver puts a large population of server test files in the program", () => {
    const files = loadProgramFileNames();
    const serverTests = files.filter((f) => /^server\/.*\.test\.ts$/.test(f));
    /* Measured at 798 when this wave built (795 server/__tests__ + 3 server/db/__tests__). Asserted as a floor, not an equality,
     * so that adding a test file is not a red build — but removing the corpus
     * from scope is. */
    expect(serverTests.length).toBeGreaterThanOrEqual(798);
  });

  it("specific, named server test files are in the program — including this one", () => {
    const files = new Set(loadProgramFileNames());
    expect(files.has("server/__tests__/w262_server_tests_in_typecheck.test.ts")).toBe(true);
    expect(files.has("server/__tests__/w261_schema_path_parity.test.ts")).toBe(true);
    /* Two of the files whose hidden TS1378 top-level-await diagnostics forced the
     * `target` change. If either leaves scope, the reasoning in W262_BUILD.md §3
     * has been undone. */
    expect(files.has("server/__tests__/wave15_notification_prefs.test.ts")).toBe(true);
    expect(files.has("server/__tests__/wave32_schema_parity_0178.test.ts")).toBe(true);
  });

  it("every file on disk under server/**/*.test.ts is in the program — none individually excluded", () => {
    const inProgram = new Set(loadProgramFileNames());
    const onDisk: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules") continue;
          walk(p);
        } else if (e.isFile() && e.name.endsWith(".test.ts")) {
          onDisk.push(path.relative(ROOT, p).split(path.sep).join("/"));
        }
      }
    };
    walk(path.join(ROOT, "server"));
    const missing = onDisk.filter((f) => !inProgram.has(f));
    /* The brief forbids excluding a file to make the number work. This is the
     * assertion that would catch it. The message names the offenders. */
    expect(missing, `server test files excluded from the type check: ${missing.join(", ")}`).toEqual([]);
    expect(onDisk.length).toBeGreaterThanOrEqual(798);
  });

  it("`target` is es2022, because es5 made 13 TS1xxx syntax errors appear in files that run fine", () => {
    const cfg = rawConfig();
    expect(String(cfg.compilerOptions?.target).toLowerCase()).toBe("es2022");
  });

  it("`noEmit` is still true — widening scope must not start emitting build output", () => {
    expect(rawConfig().compilerOptions?.noEmit).toBe(true);
  });

  it("a big-heap typecheck script exists, because a cold run OOMs at the default heap", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const cmd = pkg.scripts.typecheck ?? "";
    expect(cmd).toContain("--max-old-space-size=");
    expect(cmd).toContain("--noEmit");
    const mb = Number(/--max-old-space-size=(\d+)/.exec(cmd)?.[1] ?? 0);
    expect(mb).toBeGreaterThanOrEqual(4096);
  });

  it("client and shared test files remain out of scope — this wave did not silently widen past its brief", () => {
    const files = loadProgramFileNames();
    expect(files.filter((f) => /^client\/.*\.test\.ts$/.test(f))).toEqual([]);
    expect(files.filter((f) => /^shared\/.*\.test\.ts$/.test(f))).toEqual([]);
    /* They are still excluded, and that is still an open gap. Named in
     * W262_BUILD.md §7 rather than hidden. */
    const cfg = rawConfig();
    expect(cfg.exclude).toContain("client/**/*.test.ts");
    expect(cfg.exclude).toContain("shared/**/*.test.ts");
  });

  it("the recorded baseline arithmetic is on disk and is internally consistent", () => {
    /* The numbers a future wave diffs against must be checkable, not remembered. */
    const dir = path.join(ROOT, "build_log", "_w259_269_baseline");
    const count = (f: string): number =>
      fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter((l) => / error TS\d+: /.test(l)).length;
    const ts1xxx = (f: string): number =>
      fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter((l) => / error TS1\d{3}: /.test(l)).length;

    const asShipped = count("tsc.txt");                       // A
    const targetOnly = count("tsc_probeC_target_notests.txt"); // B
    const testsOnly = count("tsc_probe_w262.txt");             // C
    const both = count("tsc_w262_final_warm.txt");             // D

    expect(asShipped).toBe(557);
    expect(targetOnly).toBe(400);
    expect(testsOnly).toBe(929);
    expect(both).toBe(577);

    /* The decomposition that stops +20 from being read as "we found 20 problems". */
    expect(asShipped - targetOnly).toBe(157);
    expect(both - targetOnly).toBe(177);
    expect(both - asShipped).toBe(20);
    expect(177 - 157).toBe(both - asShipped);

    expect(ts1xxx("tsc.txt")).toBe(0);
    expect(ts1xxx("tsc_w262_final_warm.txt")).toBe(0);
    /* And the 13 TS1xxx that appear WITHOUT the target change — the reason it shipped. */
    expect(ts1xxx("tsc_probe_w262.txt")).toBe(13);
  });

  it("W262_BUILD.md states the new baseline loudly and in figures", () => {
    const doc = fs.readFileSync(path.join(ROOT, "build_log", "wave262", "W262_BUILD.md"), "utf8");
    expect(doc).toContain("577");
    expect(doc).toContain("NOT 557");
    expect(doc).toContain("TS1xxx REMAINS **0**");
  });
});
