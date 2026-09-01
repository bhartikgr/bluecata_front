/* ════════════════════════════════════════════════════════════════════════════
 * WAVE 261 — proof that the two-schema-paths check is not inert.
 *
 * Every assertion here drives THE REAL SCRIPT over THE REAL TREE
 * (`node scripts/lint/schema-path-parity.mjs`, spawned as a child process,
 * exactly as `npm run lint:schema-path-parity` runs it). No replica of the
 * scanner is built, no fixture tree is constructed, and no function is imported
 * and called in isolation — because a fence whose installation is unproved is
 * one of the named inert-proof mechanisms.
 *
 * THE EXIT CODE IS READ, never the summary line.
 * ══════════════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "lint", "schema-path-parity.mjs");
const BASELINE = path.join(ROOT, "scripts", "lint", "schema_path_parity_baseline.json");
const DEPLOY_DIR = path.join(ROOT, "migrations");
const MIRROR_DIR = path.join(ROOT, "server", "db", "migrations");

function run(args: string[] = []): { code: number; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("wave 261 — schema-path parity check", () => {
  it("the script exists, is registered, and is wired into preflight", () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["lint:schema-path-parity"]).toBe("node scripts/lint/schema-path-parity.mjs");
    expect(pkg.scripts["lint:schema-path-parity:selftest"]).toBe(
      "node scripts/lint/schema-path-parity.mjs --selftest",
    );
    expect(pkg.scripts.preflight).toContain("npm run lint:schema-path-parity");
  });

  it("its own comment strippers are self-tested and the selftest exits 0", () => {
    const r = run(["--selftest"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("SELFTEST OK");
  });

  it("GREEN today: exit code 0 against the tree as shipped", () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain("OK — no new schema-path divergence");
  });

  it("it reports the divergence population rather than hiding it", () => {
    const r = run();
    expect(r.code).toBe(0);
    /* The headline of this wave: there ARE divergences, they are counted, and
     * the ones with no self-heal installer are counted separately. A check that
     * reported zero here would be the fence that stopped fencing. */
    const m = /divergences present in total: (\d+)\s+·\s+of those, covered by a self-heal installer: (\d+)\s+·\s+baselined without one: (\d+)/.exec(
      r.out,
    );
    expect(m).not.toBeNull();
    const total = Number(m?.[1] ?? 0);
    const healed = Number(m?.[2] ?? 0);
    const baselined = Number(m?.[3] ?? 0);
    expect(total).toBeGreaterThan(0);
    expect(healed).toBeGreaterThan(0);
    expect(baselined).toBeGreaterThan(0);
    expect(healed + baselined).toBe(total);
  });

  it("names server/db/connection.ts and migrations/ as the two paths, so the reader knows what diverged", () => {
    const r = run();
    expect(r.out).toContain("server/db/connection.ts");
    expect(r.out).toContain("migrations/");
  });

  it("RED when a migration adds a column the bootstrap does not have and no installer reads it", () => {
    const probe = path.join(DEPLOY_DIR, "9999_w261_scratch_parity_probe.sql");
    expect(fs.existsSync(probe)).toBe(false);
    try {
      fs.writeFileSync(
        probe,
        "-- wave 261 scratch probe. Idempotent and harmless if ever applied.\n" +
          "CREATE TABLE IF NOT EXISTS w261_scratch_probe_table (x TEXT);\n" +
          "ALTER TABLE w261_scratch_probe_table ADD COLUMN w261_scratch_probe_column TEXT;\n",
      );
      const r = run();
      expect(r.code).toBe(1);
      expect(r.out).toContain("FAIL — NEW SCHEMA-PATH DIVERGENCE");
      expect(r.out).toContain("column:w261_scratch_probe_table.w261_scratch_probe_column");
      expect(r.out).toContain("table:w261_scratch_probe_table");
    } finally {
      if (fs.existsSync(probe)) fs.unlinkSync(probe);
    }
    /* And the removal restores green, so the RED above was caused by the probe
     * and by nothing else in the session. */
    const after = run();
    expect(after.code).toBe(0);
  });

  it("a commented-out ALTER in a migration is NOT counted — the stripper is load-bearing", () => {
    const probe = path.join(DEPLOY_DIR, "9998_w261_scratch_comment_probe.sql");
    expect(fs.existsSync(probe)).toBe(false);
    try {
      fs.writeFileSync(
        probe,
        "-- ALTER TABLE w261_comment_only_table ADD COLUMN w261_comment_only_column TEXT;\n" +
          "/* CREATE TABLE w261_comment_only_table (y TEXT); */\n",
      );
      const r = run();
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("w261_comment_only_column");
    } finally {
      if (fs.existsSync(probe)) fs.unlinkSync(probe);
    }
  });

  it("RED when the two mirror copies of one migration stop being byte-identical", () => {
    const name = "0228_wave221_benchmarking_opt_out.sql";
    const a = path.join(DEPLOY_DIR, name);
    const b = path.join(MIRROR_DIR, name);
    const original = fs.readFileSync(b);
    try {
      fs.writeFileSync(b, Buffer.concat([original, Buffer.from("\n-- w261 divergence probe\n")]));
      expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(false);
      const r = run();
      expect(r.code).toBe(1);
      expect(r.out).toContain("FAIL — MIRRORED MIGRATION IS NOT BYTE-IDENTICAL");
      expect(r.out).toContain(name);
    } finally {
      fs.writeFileSync(b, original);
    }
    expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(true);
    const after = run();
    expect(after.code).toBe(0);
  });

  it("RED when a migration exists only under server/db/migrations/, where deploys never look", () => {
    const probe = path.join(MIRROR_DIR, "9997_w261_scratch_mirror_only.sql");
    expect(fs.existsSync(probe)).toBe(false);
    try {
      fs.writeFileSync(probe, "CREATE TABLE IF NOT EXISTS w261_mirror_only_probe (x TEXT);\n");
      const r = run();
      expect(r.code).toBe(1);
      expect(r.out).toContain("FAIL — MIGRATION PRESENT ONLY IN THE MIRROR DIRECTORY");
      expect(r.out).toContain("9997_w261_scratch_mirror_only.sql");
    } finally {
      if (fs.existsSync(probe)) fs.unlinkSync(probe);
    }
    expect(run().code).toBe(0);
  });

  it("RED when a baseline entry goes stale, so the baseline cannot become a permanent amnesty", () => {
    const original = fs.readFileSync(BASELINE, "utf8");
    try {
      const parsed = JSON.parse(original) as {
        knownDivergences: Array<{ key: string; reason: string }>;
        knownMirrorGaps: Array<{ key: string; reason: string }>;
      };
      parsed.knownDivergences.push({
        key: "0000_never_existed.sql::column:w261_no_such_table.w261_no_such_column",
        reason: "stale-entry probe",
      });
      fs.writeFileSync(BASELINE, `${JSON.stringify(parsed, null, 2)}\n`);
      const r = run();
      expect(r.code).toBe(1);
      expect(r.out).toContain("FAIL — BASELINE IS STALE");
      expect(r.out).toContain("w261_no_such_column");
    } finally {
      fs.writeFileSync(BASELINE, original);
    }
    expect(run().code).toBe(0);
  });

  it("the baseline enumerates the known gap with a reason on every entry — no bare amnesty", () => {
    const parsed = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as {
      knownDivergences: Array<{ key: string; reason: string }>;
      knownMirrorGaps: Array<{ key: string; reason: string }>;
    };
    expect(parsed.knownDivergences.length).toBeGreaterThan(0);
    for (const d of parsed.knownDivergences) {
      expect(typeof d.key).toBe("string");
      expect(d.reason.length).toBeGreaterThan(40);
    }
    for (const d of parsed.knownMirrorGaps) {
      expect(d.reason).toContain("deploy");
    }
  });

  it("the five deploy-invisible migrations are named, not summarised away", () => {
    const parsed = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as {
      knownMirrorGaps: Array<{ key: string }>;
    };
    const keys = parsed.knownMirrorGaps.map((g) => g.key);
    expect(keys).toContain("deploy-invisible::0092_v25_51_founder_crm_first_last_company.sql");
    expect(keys).toContain("deploy-invisible::0093_v25_51_name_split_phase1.sql");
    expect(keys).toContain("deploy-invisible::0095_v25_51_name_split_phase4.sql");
    expect(keys).toContain("deploy-invisible::0001_sprint17_sync_and_auth.sql");
    expect(keys).toContain("deploy-invisible::0002_sprint18_phase2.sql");
  });

  it("wave 217's self-heal installer is recognised, and 0222 is therefore not reported as an uncovered gap", () => {
    const r = run();
    expect(r.out).toContain("0222_wave217_partner_compliance_attestation.sql  ←  server/consortiumApplyStore.ts");
    const parsed = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as {
      knownDivergences: Array<{ key: string }>;
    };
    expect(parsed.knownDivergences.some((d) => d.key.startsWith("0222_"))).toBe(false);
  });
});
