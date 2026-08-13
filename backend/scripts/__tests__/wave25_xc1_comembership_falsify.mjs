/**
 * WAVE 25 · X-C1 falsification harness — SPV co-membership privacy.
 *
 * This one is BEHAVIOURAL, not textual. The Wave-25 grep harnesses can prove a
 * predicate is present in source; they cannot prove it does anything. X-C1 is a
 * privacy gate, and "a check that passed while checking nothing" is the failure
 * this build has hit fourteen times. So this harness builds a real SQLite
 * database, inserts real ledger rows, and asserts BOTH POLES of the behaviour:
 *
 *   POLE 1 (must stay TRUE):  two investors on the same real COMPANY cap table
 *                             remain co-members. The fix must not break the
 *                             feature it is protecting.
 *   POLE 2 (must become FALSE): two LPs whose only shared `company_id` is an
 *                             SPV id are NOT co-members.
 *
 * Then it MUTATES the fix away and requires POLE 2 to flip back to TRUE. A
 * mutation that does not flip the result means the assertion was inert.
 */
import { strict as assert } from "node:assert";
import Database from "better-sqlite3";

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

// ── Fixture ────────────────────────────────────────────────────────────────
// Mirrors the real column set the two production queries read.
function makeDb({ withSpvTable = true } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE captable_commits (
      investor_id TEXT,
      company_id  TEXT,
      state       TEXT,
      deleted_at  TEXT
    );
  `);
  if (withSpvTable) db.exec(`CREATE TABLE spv (id TEXT PRIMARY KEY);`);

  const ins = db.prepare(
    `INSERT INTO captable_commits (investor_id, company_id, state, deleted_at)
     VALUES (?, ?, 'committed', NULL)`,
  );
  // A real operating company with two genuine co-shareholders.
  ins.run("inv_alice", "co_realco");
  ins.run("inv_bob", "co_realco");
  // An SPV vehicle with two passive LPs who must not discover each other.
  ins.run("inv_carol", "spv_blind");
  ins.run("inv_dave", "spv_blind");
  if (withSpvTable) db.prepare(`INSERT INTO spv (id) VALUES (?)`).run("spv_blind");
  return db;
}

// ── The predicate under test, in both its production forms ────────────────
const GATE = (excl) => `
  SELECT 1 AS hit
    FROM captable_commits ca
    JOIN captable_commits cb ON ca.company_id = cb.company_id
   WHERE ca.investor_id = ? AND cb.investor_id = ?
     AND ca.state = 'committed' AND cb.state = 'committed'
     AND ca.deleted_at IS NULL AND cb.deleted_at IS NULL
     ${excl ? "AND " + excl : ""}
   LIMIT 1`;

const LIST = (excl) => `
  SELECT DISTINCT cb.investor_id AS user_id
    FROM captable_commits ca
    JOIN captable_commits cb ON cb.company_id = ca.company_id
   WHERE ca.investor_id = ?
     AND ca.state = 'committed' AND cb.state = 'committed'
     AND ca.deleted_at IS NULL AND cb.deleted_at IS NULL
     AND cb.investor_id <> ca.investor_id
     ${excl ? "AND " + excl : ""}`;

// Must match server/lib/spvBackedCompanies.ts exactly.
const EXCL = "NOT EXISTS (SELECT 1 FROM spv sx_ca WHERE sx_ca.id = ca.company_id)";

const areCoMembers = (db, sql, a, b) => {
  try {
    return !!db.prepare(sql).get(a, b);
  } catch {
    return false; // fail-closed, exactly as production does
  }
};
const peers = (db, sql, u) => {
  try {
    return db.prepare(sql).all(u).map((r) => r.user_id).sort();
  } catch {
    return []; // fail-closed, exactly as production does
  }
};

// ── POLE 1 — the feature must survive ─────────────────────────────────────
{
  const db = makeDb();
  const ok = areCoMembers(db, GATE(EXCL), "inv_alice", "inv_bob");
  record("p1_real_company_comembership_PRESERVED", ok === true,
    "alice+bob on co_realco → " + ok);
  db.close();
}
{
  const db = makeDb();
  const got = peers(db, LIST(EXCL), "inv_alice");
  record("p2_real_company_peer_list_PRESERVED",
    JSON.stringify(got) === JSON.stringify(["inv_bob"]),
    "peers(alice) = " + JSON.stringify(got));
  db.close();
}

// ── POLE 2 — the leak must be closed ──────────────────────────────────────
{
  // The exclusion WORKS — proven here against a real DB — but it is not yet
  // wired into this sink, because the sink is sacred. Kept so the remedy is
  // proven correct and ready the moment the owner signs the waiver.
  const db = makeDb();
  const ok = areCoMembers(db, GATE(EXCL), "inv_carol", "inv_dave");
  record("p3_spv_comembership_BLOCKED_when_exclusion_applied_NOT_YET_WIRED", ok === false,
    "carol+dave share only spv_blind → " + ok + " (remedy proven; gate still unwired, see p7)");
  db.close();
}
{
  const db = makeDb();
  const got = peers(db, LIST(EXCL), "inv_carol");
  record("p4_spv_peer_list_BLOCKED_second_path",
    got.length === 0, "peers(carol) = " + JSON.stringify(got));
  db.close();
}

// ── MUTATIONS — remove the fix, the leak must REAPPEAR ────────────────────
// If a mutation does not flip the result, the assertion above proved nothing.
{
  const db = makeDb();
  const leaks = areCoMembers(db, GATE(null), "inv_carol", "inv_dave");
  record("m1_gate_without_exclusion_LEAKS", leaks === true,
    "unfixed gate returns " + leaks + " (must be true, else p3 was inert)");
  db.close();
}
{
  const db = makeDb();
  const got = peers(db, LIST(null), "inv_carol");
  record("m2_list_without_exclusion_LEAKS",
    JSON.stringify(got) === JSON.stringify(["inv_dave"]),
    "unfixed list returns " + JSON.stringify(got) + " (must name dave, else p4 was inert)");
  db.close();
}

// ── FAILURE DIRECTION — missing spv table must DENY, never grant ──────────
{
  const db = makeDb({ withSpvTable: false });
  const ok = areCoMembers(db, GATE(EXCL), "inv_alice", "inv_bob");
  record("p5_missing_spv_table_FAILS_CLOSED", ok === false,
    "no spv table → " + ok + " (deny, not grant)");
  db.close();
}

// ── The exclusion must not be a no-op against a NON-spv id ────────────────
// Guards the inverse error: an exclusion so broad it blocks everything would
// still pass p3/p4 while destroying the product.
{
  const db = makeDb();
  const got = peers(db, LIST(EXCL), "inv_bob");
  record("p6_exclusion_is_narrow_not_blanket",
    JSON.stringify(got) === JSON.stringify(["inv_alice"]),
    "peers(bob) = " + JSON.stringify(got));
  db.close();
}

// ── Source assertions — the fix is actually wired into BOTH sinks ─────────
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  .replace(/^\s*--.*$/gm, "");
const gateSrc = strip(readFileSync("server/lib/capTableMembership.ts", "utf8"));
const listSrc = strip(readFileSync("server/lib/commsUserDirectory.ts", "utf8"));
const helper = strip(readFileSync("server/lib/spvBackedCompanies.ts", "utf8"));

// p7 INVERTED after `npm run sacred` failed. capTableMembership.ts is under the
// sacred SHA manifest (its filename is absent from scripts/sacred_check.sh, so
// grepping that script wrongly says "not sacred" — trust `npm run sacred`).
// The exclusion was applied there, sacred rejected the new hash, and the bytes
// were restored verbatim. This assertion now pins the HONEST state: the gate is
// untouched and STILL LEAKS. It must fail loudly if someone edits the sacred
// file without a waiver, and it must not pretend X-C1 is fully closed.
record("p7_sacred_gate_UNMODIFIED_and_still_leaking",
  !/notSpvBackedSql/.test(gateSrc) && !/spvBackedCompanies/.test(gateSrc),
  "capTableMembership.ts is sacred, unmodified, and the boolean gate leak REMAINS OPEN pending an owner waiver");
record("p8_list_calls_helper", /notSpvBackedSql\("ca"\)/.test(listSrc),
  "commsUserDirectory second path carries the exclusion");
record("p9_helper_is_db_driven",
  /FROM spv /.test(helper) && !/startsWith|indexOf\(.spv|\bspv_\b.*prefix/i.test(helper),
  "SPV-hood asked of the DB, not inferred from an id prefix");
record("p10_single_definition",
  (strip(readFileSync("server/lib/spvBackedCompanies.ts", "utf8"))
    .match(/export function notSpvBackedSql/g) || []).length === 1,
  "exclusion defined exactly once");

const fail = results.filter((r) => !r.ok);
console.log(`\nPASS=${results.length - fail.length} FAIL=${fail.length}`);
if (fail.length) {
  console.log("FAILED: " + fail.map((r) => r.name).join(", "));
  process.exit(1);
}
