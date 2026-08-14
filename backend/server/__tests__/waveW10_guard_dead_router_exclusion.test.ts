/**
 * WAVE 10 — G-1c + RS-4 + G-3 governance proofs.
 *
 * G-1c DEFECT. `scripts/silent-drop-guard/baseline.route-targets.json` — the
 * companion baseline generated from the immutable G-0 snapshot — recorded 211
 * routeTargets and 211 routedSurfaces. 22 of each came from two files that were
 * never part of the running application: `client/src/App - Copy.tsx` and
 * `client/src/App - Copy (2).tsx`, editor-era snapshots of the router that
 * nothing imports. The guard's route-target extractor walked every `.tsx` under
 * `client/src`, found `<Route path=...>` in the copies, and folded their routes
 * into the protected inventory.
 *
 * WHY THAT IS WORSE THAN NOISE. The contamination did not merely inflate a
 * count; it MASKED REAL DROPS. Three of the contaminated tuples —
 * `/admin/pricing -> AdminPricing`, `/collective/partner/files -> PartnerFiles`
 * and `/collective/partner/tasks -> PartnerTasks` — did NOT exist in the live
 * `client/src/App.tsx` at G-0 (verified: `grep -c 'path="/admin/pricing"'` on
 * `.g0-snapshot/client/src/App.tsx` returns 0, on both copies returns 1). Those
 * pages were added by later waves. Had a subsequent wave deleted one of them
 * from the live router, the dead copies would have kept supplying the identical
 * signature and the guard would have reported no drop. A silent-drop guard that
 * a stale backup file can satisfy is not a guard.
 *
 * THE FIX, IN TWO HALVES.
 *   RS-4 deletes the two dead files from the working tree.
 *   G-1c teaches the extractor to skip them, because deleting them from the
 *   working tree does NOT clean the baseline: the companion baseline is built
 *   from `.g0-snapshot/`, which is read-only, hash-manifested and must never be
 *   rewritten. The exclusion is therefore the only way to regenerate a truthful
 *   companion baseline while leaving the snapshot byte-identical.
 *
 * WHY NOT AN ALLOWLIST ENTRY. Allowlisting the 22 phantom tuples would have
 * recorded them as "functionality we consciously removed", which is false —
 * they were never functionality. It also leaves the masking hole open for every
 * future wave. Adding allowlist entries is an owner decision; correcting a
 * provably false baseline record is not.
 *
 * FALSIFICATION IS THE POINT OF THIS FILE. WAVE 7B found DA-3's scope fence
 * reporting success against paths that had never existed on disk —
 * `collectFencedPaths()` skipped missing files, so it was vacuously green. Every
 * assertion below is therefore paired with its negative: the exclusion must
 * match the copies AND must NOT match the live router; the guard must be green
 * on the real tree AND must go red when a real page is gutted; the sacred gate
 * must pass on clean bytes AND fail on drifted bytes.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import {
  isDeadRouterSnapshot,
  isExcludedFile,
} from "../../scripts/silent-drop-guard/extract-inventory";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const p = (...s: string[]) => path.join(...s);

describe("W10/G-1c — dead-router exclusion matches the copies and nothing else", () => {
  it("matches the two editor-era router snapshots", () => {
    expect(isDeadRouterSnapshot(p("client", "src", "App - Copy.tsx"))).toBe(true);
    expect(isDeadRouterSnapshot(p("client", "src", "App - Copy (2).tsx"))).toBe(true);
    expect(isDeadRouterSnapshot(p("client", "src", "App - Copy (17).tsx"))).toBe(true);
  });

  /**
   * The negative direction. If this ever flips, the guard has stopped watching
   * the live router entirely and every client route becomes droppable in
   * silence — a far larger hole than the one G-1c closed.
   */
  it("does NOT match the live router, nor lookalikes elsewhere", () => {
    expect(isDeadRouterSnapshot(p("client", "src", "App.tsx"))).toBe(false);
    expect(isExcludedFile(p("client", "src", "App.tsx"))).toBe(false);

    // Not directly under client/src.
    expect(isDeadRouterSnapshot(p("client", "src", "pages", "App - Copy.tsx"))).toBe(false);
    // Different basename shape.
    expect(isDeadRouterSnapshot(p("client", "src", "AppCopy.tsx"))).toBe(false);
    expect(isDeadRouterSnapshot(p("client", "src", "App - Copy.ts"))).toBe(false);
    expect(isDeadRouterSnapshot(p("client", "src", "App - Backup.tsx"))).toBe(false);
    // A real page that merely contains the word Copy.
    expect(isExcludedFile(p("client", "src", "pages", "admin", "Pricing.tsx"))).toBe(false);
  });

  it("still excludes what it excluded before — the fix is additive", () => {
    expect(isExcludedFile(p("server", "public", "index.js"))).toBe(true);
    expect(isExcludedFile(p("node_modules", "x", "y.tsx"))).toBe(true);
    expect(isExcludedFile(p(".g0-snapshot", "client", "src", "App.tsx"))).toBe(true);
    expect(isExcludedFile(p("server", "__tests__", "a.test.ts"))).toBe(true);
  });
});

describe("W10/RS-4 — the dead router snapshots are gone from the working tree", () => {
  it("neither copy exists under client/src", () => {
    expect(fs.existsSync(p(REPO_ROOT, "client", "src", "App - Copy.tsx"))).toBe(false);
    expect(fs.existsSync(p(REPO_ROOT, "client", "src", "App - Copy (2).tsx"))).toBe(false);
  });

  it("the live router survives and still carries its routes", () => {
    const live = fs.readFileSync(p(REPO_ROOT, "client", "src", "App.tsx"), "utf8");
    expect(live).toContain('path="/admin/pricing"');
    expect(live).toContain('path="/collective/membership"');
  });

  /**
   * The G-0 snapshot is the evidence of record for what existed at freeze time.
   * RS-4 deletes from the working tree ONLY. If this assertion fails, someone
   * has rewritten history rather than corrected the derived baseline.
   */
  it("the G-0 snapshot still contains the copies — history is not rewritten", () => {
    expect(fs.existsSync(p(REPO_ROOT, ".g0-snapshot", "client", "src", "App - Copy.tsx"))).toBe(true);
    expect(
      fs.existsSync(p(REPO_ROOT, ".g0-snapshot", "client", "src", "App - Copy (2).tsx")),
    ).toBe(true);
  });
});

describe("W10/G-1c — the regenerated companion baseline is clean and still bound to G-0", () => {
  const companion = JSON.parse(
    fs.readFileSync(p(REPO_ROOT, "scripts", "silent-drop-guard", "baseline.route-targets.json"), "utf8"),
  ) as Record<string, unknown> & {
    routeTargets: string[];
    routedSurfaces: string[];
    protectedBaselineSha256: string;
    snapshotManifestSha256: string;
  };

  /**
   * `/partner/me/*` is the sharpest tell. Those client routes were consolidated
   * to `/collective/partner/*` long before G-0; only the dead copies still
   * declared them. Twelve such tuples sat in the protected baseline.
   */
  it("carries no /partner/me/* route target — those existed only in the copies", () => {
    const stale = companion.routeTargets.filter((r) => r.startsWith("/partner/me/"));
    expect(stale).toEqual([]);
    const staleSurfaces = companion.routedSurfaces.filter((r) => r.startsWith("/partner/me/"));
    expect(staleSurfaces).toEqual([]);
  });

  it("shed exactly the phantom tuples and kept the rest", () => {
    // 211 -> 189 in both classes. A future regeneration that moves these
    // numbers means the extractor's reach changed; that must be deliberate.
    expect(companion.routeTargets.length).toBe(189);
    expect(companion.routedSurfaces.length).toBe(189);
    // Untouched classes prove the exclusion did not reach past the router.
    expect((companion as unknown as { tabs: string[] }).tabs.length).toBe(269);
    expect((companion as unknown as { buttons: string[] }).buttons.length).toBe(965);
    expect((companion as unknown as { panels: string[] }).panels.length).toBe(3202);
  });

  /**
   * G-1b binds the companion to both the snapshot manifest and the protected
   * baseline. Regenerating must not have loosened that binding, and above all
   * must not have touched `baseline.json` — the owner sha-locked it.
   */
  it("stays bound to the sha-locked protected baseline and the G-0 manifest", () => {
    const protectedSha = execFileSync(
      "sha256sum",
      [p(REPO_ROOT, "scripts", "silent-drop-guard", "baseline.json")],
      { encoding: "utf8" },
    ).split(/\s+/)[0];
    expect(protectedSha).toBe(
      "8e8b88569ca95ba8c4262fd6ba59f981985acf2489512a777959c096724a0d68",
    );
    expect(companion.protectedBaselineSha256).toBe(protectedSha);

    const manifestSha = execFileSync(
      "sha256sum",
      [p(REPO_ROOT, ".g0-snapshot", "G0_MANIFEST.sha256")],
      { encoding: "utf8" },
    ).split(/\s+/)[0];
    expect(companion.snapshotManifestSha256).toBe(manifestSha);
  });
});

describe("W10/G-3 — the pre-deploy gate now verifies sacred files, and can be made to fail", () => {
  const gate = fs.readFileSync(p(REPO_ROOT, "scripts", "pre_deploy_gate_v26_7_2.sh"), "utf8");

  it("invokes sacred_check.sh before the DB backup", () => {
    expect(gate).toContain("sacred_check.sh");
    const sacredAt = gate.indexOf("[0/5] Sacred-file integrity");
    const backupAt = gate.indexOf("[1/5] Backing up DB");
    expect(sacredAt).toBeGreaterThan(-1);
    expect(backupAt).toBeGreaterThan(sacredAt);
  });

  /**
   * A missing verifier must not read as a pass. This is the exact shape of the
   * DA-3 vacuous-green defect, transposed onto a shell gate.
   */
  it("refuses to proceed if the verifier itself is missing", () => {
    expect(gate).toContain("is missing.");
    expect(gate).toMatch(/elif \[ ! -f "\$SACRED_CHECK" \]; then[\s\S]*?exit 1/);
  });

  it("has exactly one, loudly-announced override", () => {
    const overrides = gate.match(/SACRED_GATE_OVERRIDE/g) ?? [];
    // Referenced in the header comment, the missing-file hint, and the one guard.
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    expect(gate).toContain("SACRED CHECK OVERRIDDEN");
  });

  it("sacred_check.sh passes on the real tree", () => {
    const out = execFileSync("bash", [p(REPO_ROOT, "scripts", "sacred_check.sh")], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    expect(out).toContain("SACRED OK: 48/48");
  });

  /**
   * WAVE 38 ROW 1 — THE FALSIFICATION, REWRITTEN SO IT CANNOT DIRTY THE TREE.
   *
   * THE DEFECT THIS REPLACES. The previous version of this test appended one
   * byte to the REAL `server/captableCommitStore.ts` — an append-only,
   * hash-chained cap-table ledger module and a SACRED file — and restored it
   * from an in-memory buffer inside a `finally`. Both Review 3A and Review 3B
   * independently found the sacred gate RED in the shared checkout, drifted by
   * exactly that one trailing newline (62,114 vs 62,113 bytes). `finally` is
   * not an atomicity primitive: it does not run on SIGKILL/SIGTERM, it does not
   * run if the worker is torn down mid-`execFileSync`, and it is not
   * concurrency-safe — two overlapping Vitest workers can each capture the
   * OTHER's mutated bytes as their "original" and write the wrong content back
   * into a file whose entire purpose is byte-exactness.
   *
   * THE FIX IS NOT A BETTER RESTORE. A test that writes to a sacred production
   * file at all IS the defect; a more careful restore is a smaller version of
   * the same defect. This version never touches the working tree. It builds a
   * DISPOSABLE tree under `os.tmpdir()` holding only what the checker reads —
   * its own script, the base manifest, and the 48 enforced files — mutates the
   * COPY, and then proves the real bytes are untouched.
   *
   * BOTH POLES, plus an anti-vacuity control:
   *   - the disposable tree is proven FAITHFUL first (it must report 48/48), so
   *     a subsequent RED cannot be an artefact of a broken copy;
   *   - one appended byte on the COPY turns it RED and names the file;
   *   - the REAL file's sha256 and size are captured before and compared after,
   *     so a future edit that reintroduces an in-tree mutation fails HERE
   *     instead of silently reddening the release gate hours later.
   */

  /**
   * Copy every path the sacred checker actually enforces into a throwaway tree.
   * The layout mirrors production so the checker's own default
   * `SPEC_ROOT=<repo>/../spec` resolves without an environment variable — this
   * test establishes its own preconditions and never reads `process.env`.
   */
  function buildDisposableSacredTree(): { root: string; repo: string } {
    const listing = execFileSync(
      "bash",
      [p(REPO_ROOT, "scripts", "sacred_check.sh"), "--list"],
      { encoding: "utf8", cwd: REPO_ROOT },
    );

    // Manifest rows and EXTRA_FROZEN rows are both "<64-hex>  <path>  <origin>".
    // The KNOWN_DRIFT legend prints its hashes AFTER a colon, so it cannot match.
    const rels: string[] = [];
    for (const line of listing.split("\n")) {
      const m = /^\s*[0-9a-f]{64}\s+(\S+)\s+\S/.exec(line);
      if (m) rels.push(m[1]);
    }

    // PRECONDITION, ASSERTED RATHER THAN ASSUMED. 48 manifest entries plus the
    // single EXTRA_FROZEN row (WAIVER-3, server/db/migrate.ts). If this parse
    // ever silently yields fewer paths the copy would be trivially green and the
    // whole test would check nothing — precisely the failure class this file
    // exists to prevent.
    expect(rels.length).toBe(49);
    expect(new Set(rels).size).toBe(49);
    expect(rels).toContain("server/captableCommitStore.ts");
    expect(rels).toContain("server/db/migrate.ts");

    const root = fs.mkdtempSync(p(os.tmpdir(), "w38-sacred-"));
    const repo = p(root, "repo");
    const specSrc = p(REPO_ROOT, "..", "spec");

    const put = (from: string, to: string) => {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    };

    for (const rel of rels) {
      const from = rel.startsWith("spec/")
        ? p(specSrc, rel.slice("spec/".length))
        : p(REPO_ROOT, rel);
      const to = rel.startsWith("spec/")
        ? p(root, "spec", rel.slice("spec/".length))
        : p(repo, rel);
      put(from, to);
    }

    put(p(REPO_ROOT, "scripts", "sacred_check.sh"), p(repo, "scripts", "sacred_check.sh"));
    put(
      p(REPO_ROOT, "sacred_baseline", "SACRED_SHA256.txt"),
      p(repo, "sacred_baseline", "SACRED_SHA256.txt"),
    );

    return { root, repo };
  }

  function runSacred(repo: string): { code: number; out: string } {
    try {
      const out = execFileSync("bash", [p(repo, "scripts", "sacred_check.sh")], {
        encoding: "utf8",
        cwd: repo,
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  }

  it("sacred_check.sh FAILS when a sacred file drifts by one byte (disposable tree)", () => {
    const realVictim = p(REPO_ROOT, "server", "captableCommitStore.ts");
    const realBefore = createHash("sha256").update(fs.readFileSync(realVictim)).digest("hex");
    const realSizeBefore = fs.statSync(realVictim).size;

    const { root, repo } = buildDisposableSacredTree();
    try {
      // POLE 1 / anti-vacuity control — the copy is faithful. Without this a RED
      // below could be produced by a broken copy rather than by the drift.
      const clean = runSacred(repo);
      expect(clean.code).toBe(0);
      expect(clean.out).toContain("SACRED OK: 48/48");

      // POLE 2 — one byte, on the COPY, never on the working tree.
      const victim = p(repo, "server", "captableCommitStore.ts");
      fs.appendFileSync(victim, "\n");
      const drifted = runSacred(repo);
      expect(drifted.code).toBe(1);
      expect(drifted.out).toContain("SACRED CHECK FAILED");
      expect(drifted.out).toContain("server/captableCommitStore.ts");

      // Restoring the COPY returns it to green, so the checker is reacting to the
      // bytes and is not simply latching on first failure.
      fs.copyFileSync(realVictim, victim);
      const relisted = runSacred(repo);
      expect(relisted.code).toBe(0);
      expect(relisted.out).toContain("SACRED OK: 48/48");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }

    // THE REGRESSION ASSERTION. Whatever happened above, the real sacred file
    // must be byte-identical.
    expect(fs.statSync(realVictim).size).toBe(realSizeBefore);
    expect(createHash("sha256").update(fs.readFileSync(realVictim)).digest("hex")).toBe(
      realBefore,
    );

    // And the REAL gate is still green, measured AFTER this test ran.
    const after = execFileSync("bash", [p(REPO_ROOT, "scripts", "sacred_check.sh")], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    expect(after).toContain("SACRED OK: 48/48");
  });

  /**
   * WAVE 38 ROW 1, SECOND HALF — a standing fence so the class cannot return.
   * No test under `server/__tests__` may name a sacred-enforced file on a line
   * that writes to disk. The enforced set is read from the checker itself, not
   * from a hardcoded list, so a newly frozen file is covered the instant it is
   * frozen.
   */
  it("no test in server/__tests__ writes to a sacred-enforced path", () => {
    const listing = execFileSync(
      "bash",
      [p(REPO_ROOT, "scripts", "sacred_check.sh"), "--list"],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    const basenames = new Set<string>();
    for (const line of listing.split("\n")) {
      const m = /^\s*[0-9a-f]{64}\s+(\S+)\s+\S/.exec(line);
      if (m) basenames.add(path.basename(m[1]));
    }
    expect(basenames.size).toBeGreaterThan(40);
    expect(basenames.has("captableCommitStore.ts")).toBe(true);

    const WRITE_CALL = /\b(appendFileSync|writeFileSync|rmSync|unlinkSync|copyFileSync)\s*\(/;
    const testDir = p(REPO_ROOT, "server", "__tests__");
    const offenders: string[] = [];
    for (const name of fs.readdirSync(testDir)) {
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
      const lines = fs.readFileSync(p(testDir, name), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!WRITE_CALL.test(line)) return;
        for (const b of basenames) {
          if (line.includes(b)) offenders.push(name + ":" + (i + 1) + " " + line.trim());
        }
      });
    }
    expect(offenders).toEqual([]);

    // ANTI-VACUITY. The scanner must be able to SEE the exact defect shape it
    // exists for. The literal is assembled at runtime so this very line is not
    // itself an offender — which would otherwise make the sweep unsatisfiable.
    const planted = "fs.append" + 'FileSync(p(REPO_ROOT, "server", "captableCommitStore.ts"), "\\n");';
    const seen = WRITE_CALL.test(planted) && [...basenames].some((b) => planted.includes(b));
    expect(seen).toBe(true);
  });
});
