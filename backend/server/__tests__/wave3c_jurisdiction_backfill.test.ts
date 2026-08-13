/**
 * WAVE 3C / J-2 (OQ-6) — scripts/backfill_spv_jurisdiction.ts.
 *
 * The repair script is exercised END TO END against a throwaway SQLite fixture
 * that mirrors the six live capavate.com vehicles (four of which have an
 * `spv.jurisdiction` enum that contradicts their own
 * `terms.jurisdictionCountry`). Nothing here touches a real database, and the
 * script itself never imports server/db/connection.ts or db/migrate.ts.
 *
 * Locked behaviours: correct plan · idempotent apply · reversible via journal ·
 * refuses to clobber a value it did not write · never guesses a jurisdiction.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const REPO = resolve(__dirname, "../..");
const SCRIPT = join(REPO, "scripts/backfill_spv_jurisdiction.ts");
const TSX = join(REPO, "node_modules/.bin/tsx");

const workdir = mkdtempSync(join(tmpdir(), "wave3c-backfill-"));
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

const DB = join(workdir, "fixture.db");
const JOURNAL = join(workdir, "journal.json");

/** The live inventory, as verified on capavate.com, plus two edge rows. */
const FIXTURE_ROWS: Array<[string, string, string, string | null]> = [
  ["spv_asian_biotech", "Asian Biotech", "delaware", "British Virgin Islands"],
  ["spv_test2", "TEST2", "delaware", "Mauritius"],
  ["spv_nl_syndicate", "netherlands Syndicate", "delaware", "Netherlands"],
  ["spv_quantum", "QUantum", "cayman", "Canada"],
  ["spv_test", "Test SPV", "delaware", "United States"],
  ["spv_no_country", "Legacy no-country SPV", "delaware", null],
  ["spv_freetext", "Freetext SPV", "delaware", "Kingdom of Wakanda"],
];

function buildFixture(): void {
  const Database = _require("better-sqlite3");
  if (existsSync(DB)) rmSync(DB, { force: true });
  const db = new Database(DB);
  db.exec(`CREATE TABLE spv (
    id TEXT PRIMARY KEY NOT NULL, sponsor_partner_id TEXT NOT NULL, gp_user_id TEXT,
    name TEXT NOT NULL, spv_type TEXT NOT NULL DEFAULT 'spv', jurisdiction TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', distribution_scope TEXT NOT NULL DEFAULT 'private',
    target_raise_minor INTEGER, min_check_minor INTEGER, cap_minor INTEGER,
    currency TEXT NOT NULL DEFAULT 'USD', carry_basis TEXT NOT NULL,
    lp_visibility TEXT NOT NULL DEFAULT 'own_only', target_company_id TEXT, close_date TEXT,
    terms_json TEXT, migrated_from TEXT, created_at TEXT NOT NULL, created_by TEXT,
    updated_at TEXT NOT NULL, updated_by TEXT, archived_at TEXT,
    prev_hash TEXT NOT NULL DEFAULT '0', curr_hash TEXT NOT NULL DEFAULT 'h0')`);
  const ins = db.prepare(
    `INSERT INTO spv (id,sponsor_partner_id,name,jurisdiction,carry_basis,terms_json,created_at,updated_at)
     VALUES (?,?,?,?,'whole_spv',?,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
  );
  for (const [id, name, jur, country] of FIXTURE_ROWS) {
    ins.run(id, "p_test", name, jur, country ? JSON.stringify({ jurisdictionCountry: country }) : null);
  }
  db.close();
}

function readState(): Record<string, { jurisdiction: string; curr_hash: string }> {
  const Database = _require("better-sqlite3");
  const db = new Database(DB, { readonly: true });
  const rows = db.prepare("SELECT id, jurisdiction, curr_hash FROM spv").all() as Array<{ id: string; jurisdiction: string; curr_hash: string }>;
  db.close();
  return Object.fromEntries(rows.map((r) => [r.id, { jurisdiction: r.jurisdiction, curr_hash: r.curr_hash }]));
}

/** A refused revert exits 1 BY DESIGN, so stdout is read off the error too. */
function run(args: string[]): any {
  try {
    return JSON.parse(execFileSync(TSX, [SCRIPT, "--db", DB, "--json", ...args], { cwd: REPO, encoding: "utf8" }));
  } catch (e) {
    const stdout = (e as { stdout?: string }).stdout;
    if (typeof stdout === "string" && stdout.trim().startsWith("{")) return JSON.parse(stdout);
    throw e;
  }
}

beforeEach(() => buildFixture());

describe("J-2 — dry-run plan", () => {
  it("defaults to a dry run and writes nothing", () => {
    const before = readState();
    const r = run([]);
    expect(r.mode).toBe("dry-run");
    expect(r.totals.wouldChange).toBe(4);
    expect(r.totals.changed).toBe(0);
    expect(readState()).toEqual(before);
  });

  it("names exactly the four contradicting live vehicles and their target values", () => {
    const changes: Record<string, string> = Object.fromEntries(
      run([]).rows.filter((p: any) => p.action === "change").map((p: any) => [p.id, `${p.before}->${p.after}`]),
    );
    expect(changes).toEqual({
      spv_asian_biotech: "delaware->bvi",
      spv_test2: "delaware->mauritius",
      spv_nl_syndicate: "delaware->netherlands",
      spv_quantum: "cayman->canadian_lp",
    });
  });

  it("leaves the already-consistent vehicle alone and SKIPS rather than guesses", () => {
    const byId: Record<string, string> = Object.fromEntries(run([]).rows.map((p: any) => [p.id, p.action]));
    expect(byId.spv_test).toBe("already-correct");
    expect(byId.spv_no_country).toBe("skip-no-country");
    expect(byId.spv_freetext).toBe("skip-unmappable");
  });
});

describe("J-2 — apply, idempotency, reversibility", () => {
  it("writes the four rows and nothing else", () => {
    const r = run(["--apply", "--journal", JOURNAL]);
    expect(r.mode).toBe("apply");
    const state = readState();
    expect(state.spv_asian_biotech.jurisdiction).toBe("bvi");
    expect(state.spv_test2.jurisdiction).toBe("mauritius");
    expect(state.spv_nl_syndicate.jurisdiction).toBe("netherlands");
    expect(state.spv_quantum.jurisdiction).toBe("canadian_lp");
    expect(state.spv_test.jurisdiction).toBe("delaware");
    expect(state.spv_no_country.jurisdiction).toBe("delaware");
    expect(state.spv_freetext.jurisdiction).toBe("delaware");
  });

  it("is idempotent — a second apply changes nothing", () => {
    run(["--apply", "--journal", JOURNAL]);
    const afterFirst = readState();
    const second = run(["--apply", "--journal", join(workdir, "journal2.json")]);
    expect(second.totals.wouldChange).toBe(0);
    expect(second.totals.alreadyCorrect).toBe(5);
    expect(readState()).toEqual(afterFirst);
  });

  it("restores every prior value from the journal", () => {
    const before = readState();
    run(["--apply", "--journal", JOURNAL]);
    const rev = run(["--revert", JOURNAL]);
    expect(rev.restored.sort()).toEqual(["spv_asian_biotech", "spv_nl_syndicate", "spv_quantum", "spv_test2"]);
    expect(rev.refused).toEqual([]);
    expect(readState()).toEqual(before);
  });

  it("refuses to revert a row that no longer holds the value it wrote", () => {
    run(["--apply", "--journal", JOURNAL]);
    run(["--revert", JOURNAL]);
    // Second revert: the rows are back at their originals, so the journal's
    // after-values no longer match — every row must be refused, not clobbered.
    const before = readState();
    const again = run(["--revert", JOURNAL]);
    expect(again.restored).toEqual([]);
    expect(again.refused.map((r: any) => r.id).sort())
      .toEqual(["spv_asian_biotech", "spv_nl_syndicate", "spv_quantum", "spv_test2"]);
    expect(again.refused).toHaveLength(4);
    expect(readState()).toEqual(before);
  });

  it("leaves the hash-chain columns untouched (documented: journal is the audit record)", () => {
    const before = readState();
    run(["--apply", "--journal", JOURNAL]);
    const after = readState();
    for (const id of Object.keys(before)) expect(after[id].curr_hash).toBe(before[id].curr_hash);
  });
});
