/**
 * scripts/wave56_rebuild_recipe.ts — WAVE 56 · is the strategy's rebuild recipe
 * actually executable?  MEASURED, not assumed.
 *
 * STRATEGY_W56 §5.3 and §11.2.1 both prescribe, per table:
 *     CREATE TABLE <t>__w56_new (...);  INSERT ... SELECT;  DROP TABLE <t>;
 *     ALTER TABLE <t>__w56_new RENAME TO <t>;  <recreate indexes>; <recreate triggers>
 * This script runs exactly that on partner_tier_lifecycle and records what SQLite does.
 */
import fs from "node:fs";
process.env.NODE_ENV = "test";
process.env.ENABLE_DEMO_SEED = "1";

const lines: string[] = [];
function say(s = "") { lines.push(s); console.log(s); }

function snapshot(db: any) {
  return {
    tables: (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'partner_tier%' ORDER BY name`).all() as any[]).map((r) => r.name),
    triggers: (db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_pt%' ORDER BY name`).all() as any[]).map((r) => r.name),
    lifecycleRows: (() => { try { return (db.prepare(`SELECT COUNT(*) n FROM partner_tier_lifecycle`).get() as any).n; } catch (e) { return `ERR ${(e as Error).message}`; } })(),
  };
}

async function main() {
  const { getDb } = await import("../server/db/connection");
  const { wave45Db } = await import("../server/lib/applyWave45PricingSchema");
  getDb();
  const db: any = wave45Db();

  say("################################################################");
  say("# W56 · REBUILD RECIPE EXECUTABILITY TEST (throwaway :memory: DB)");
  say("################################################################");

  say("\n--- which triggers REFERENCE partner_tier_lifecycle in their bodies? ---");
  for (const r of db.prepare(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger'`).all() as any[]) {
    if (String(r.sql).includes("partner_tier_lifecycle")) {
      say(`  trigger ${r.name} ON ${r.tbl_name}  <-- body references partner_tier_lifecycle`);
    }
  }

  say("\n=== EXPERIMENT A · the recipe EXACTLY as §5.3 / §11.2.1 specifies it ===");
  say(`  BEFORE: ${JSON.stringify(snapshot(db))}`);
  const origSql: string = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='partner_tier_lifecycle'`).get() as any).sql;
  const newSql = origSql
    .replace(/\n\s*CHECK \(tier_slug IN \('catalyst','builder','amplifier','nexus','founding_member'\)\),/, ",")
    .replace("CREATE TABLE partner_tier_lifecycle", "CREATE TABLE partner_tier_lifecycle__w56_new");
  const cols = (db.prepare(`PRAGMA table_info(partner_tier_lifecycle)`).all() as any[]).map((c) => c.name).join(",");
  const steps: Array<[string, string]> = [
    ["CREATE new table (slug CHECK removed)", newSql],
    ["INSERT ... SELECT", `INSERT INTO partner_tier_lifecycle__w56_new (${cols}) SELECT ${cols} FROM partner_tier_lifecycle`],
    ["DROP TABLE old", `DROP TABLE partner_tier_lifecycle`],
    ["ALTER TABLE ... RENAME TO", `ALTER TABLE partner_tier_lifecycle__w56_new RENAME TO partner_tier_lifecycle`],
  ];
  let aborted = false;
  for (const [label, sql] of steps) {
    if (aborted) { say(`  SKIPPED (previous step threw): ${label}`); continue; }
    try { db.exec(sql); say(`  OK     ${label}`); }
    catch (e) { say(`  THREW  ${label}\n         -> ${(e as Error).message}`); aborted = true; }
  }
  say(`  AFTER : ${JSON.stringify(snapshot(db))}`);
  say(`  VERDICT A: ${aborted ? "THE RECIPE AS SPECIFIED IS NOT EXECUTABLE ON THIS SCHEMA." : "recipe executed"}`);
  say(`  Note the state left behind: partner_tier_lifecycle DROPPED, replacement still named __w56_new,`);
  say(`  and trg_ptl_no_delete (R3's 'a tier is NEVER deleted') gone with the table.`);

  say("\n=== EXPERIMENT B · why: what does ALTER TABLE ... RENAME re-parse? ===");
  say(`  legacy_alter_table = ${JSON.stringify(db.prepare("PRAGMA legacy_alter_table").get())}`);
  say("  SQLite >=3.25 with legacy_alter_table=OFF re-parses EVERY trigger and view in the");
  say("  schema during ALTER TABLE ... RENAME. partner_tier_price carries two triggers whose");
  say("  WHEN clauses read partner_tier_lifecycle (0185:96-120), so at the moment of the rename");
  say("  that table does not exist and the statement fails.");
  say("  PRAGMA legacy_alter_table cannot be set from a migration: it is a no-op inside the");
  say("  transaction the runner opens (migrate.ts:478-486), exactly as PRAGMA foreign_keys is.");

  say("\n=== EXPERIMENT C · the CORRECTED recipe: drop referencing triggers FIRST ===");
  // rebuild the world: reinstall 0185 from scratch on a fresh handle
  const { applyWave45PricingSchema } = await import("../server/lib/applyWave45PricingSchema");
  db.exec(`DROP TABLE IF EXISTS partner_tier_lifecycle__w56_new`);
  db.exec(`DROP TRIGGER IF EXISTS trg_ptp_frozen_no_price_update`);
  db.exec(`DROP TRIGGER IF EXISTS trg_ptp_frozen_no_price_insert`);
  db.exec(`DROP TRIGGER IF EXISTS trg_ptl_no_delete`);
  db.exec(`DROP TABLE IF EXISTS partner_tier_capability`);
  applyWave45PricingSchema(db);
  say(`  reinstalled 0185: ${JSON.stringify(snapshot(db))}`);

  const bodies = new Map<string, string>();
  for (const r of db.prepare(`SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_pt%'`).all() as any[]) bodies.set(r.name, r.sql);
  say(`  captured trigger bodies: ${[...bodies.keys()].join(", ")}`);

  const idx = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='partner_tier_lifecycle' AND sql IS NOT NULL`).all() as any[]).map((r) => r.sql);
  const rowsBefore = (db.prepare(`SELECT COUNT(*) n FROM partner_tier_lifecycle`).get() as any).n;
  const corrected: Array<[string, string]> = [
    ["DROP referencing trigger trg_ptp_frozen_no_price_update", `DROP TRIGGER IF EXISTS trg_ptp_frozen_no_price_update`],
    ["DROP referencing trigger trg_ptp_frozen_no_price_insert", `DROP TRIGGER IF EXISTS trg_ptp_frozen_no_price_insert`],
    ["DROP own trigger trg_ptl_no_delete", `DROP TRIGGER IF EXISTS trg_ptl_no_delete`],
    ["CREATE new table (slug CHECK removed)", newSql],
    ["INSERT ... SELECT", `INSERT INTO partner_tier_lifecycle__w56_new (${cols}) SELECT ${cols} FROM partner_tier_lifecycle`],
    ["DROP TABLE old", `DROP TABLE partner_tier_lifecycle`],
    ["ALTER TABLE ... RENAME TO", `ALTER TABLE partner_tier_lifecycle__w56_new RENAME TO partner_tier_lifecycle`],
    ...idx.map((s, i) => [`recreate index #${i + 1}`, s] as [string, string]),
    ...[...bodies.entries()].map(([n, s]) => [`recreate trigger ${n}`, `DROP TRIGGER IF EXISTS ${n}; ${s}`] as [string, string]),
  ];
  let abortedC = false;
  for (const [label, sql] of corrected) {
    if (abortedC) { say(`  SKIPPED: ${label}`); continue; }
    try { db.exec(sql); say(`  OK     ${label}`); }
    catch (e) { say(`  THREW  ${label}\n         -> ${(e as Error).message}`); abortedC = true; }
  }
  const rowsAfter = (() => { try { return (db.prepare(`SELECT COUNT(*) n FROM partner_tier_lifecycle`).get() as any).n; } catch { return "ERR"; } })();
  say(`  AFTER : ${JSON.stringify(snapshot(db))}`);
  say(`  row count ${rowsBefore} -> ${rowsAfter} (equal? ${rowsBefore === rowsAfter})`);
  const finalSql: string = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='partner_tier_lifecycle'`).get() as any)?.sql ?? "";
  say(`  slug CHECK gone?   ${!finalSql.includes("'catalyst','builder','amplifier','nexus','founding_member'")}`);
  say(`  state CHECK kept?  ${finalSql.includes("state IN ('active','frozen','archived')")}`);
  say(`  state_reason CHECK kept? ${finalSql.includes("length(trim(state_reason))")}`);
  say(`  PRIMARY KEY kept?  ${finalSql.includes("PRIMARY KEY")}`);
  say(`  STRICT kept?       ${/\)\s*STRICT/.test(finalSql)}`);
  for (const [n, s] of bodies) {
    const now = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?`).get(n) as any)?.sql ?? "(MISSING)";
    say(`  trigger ${n}: body byte-identical to pre-rebuild? ${now === s}`);
  }
  say(`  VERDICT C: ${abortedC ? "CORRECTED RECIPE ALSO FAILED" : "CORRECTED RECIPE EXECUTES — drop the referencing triggers FIRST"}`);

  say("\n=== EXPERIMENT D · can the new tier now be inserted? ===");
  const NOW = "2026-08-16T00:00:00Z";
  try {
    db.prepare(`INSERT INTO partner_tier_lifecycle (tier_slug,state,display_name,state_reason,state_changed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run("bridge", "active", "Bridge", null, NOW, NOW, NOW);
    say(`  INSERT partner_tier_lifecycle('bridge') -> SUCCEEDED (the DB CHECK is genuinely gone)`);
  } catch (e) { say(`  INSERT partner_tier_lifecycle('bridge') -> REFUSED: ${(e as Error).message}`); }
  try {
    db.prepare(`DELETE FROM partner_tier_lifecycle WHERE tier_slug='bridge'`).run();
    say(`  DELETE bridge -> SUCCEEDED  ** R3's never-delete control is NOT enforcing **`);
  } catch (e) { say(`  DELETE bridge -> REFUSED (R3 control intact): ${(e as Error).message}`); }

  fs.writeFileSync("/home/user/workspace/build_log/wave56/W56_rebuild_recipe.txt", lines.join("\n") + "\n");
  say("\nwrote build_log/wave56/W56_rebuild_recipe.txt");
}
main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  fs.writeFileSync("/home/user/workspace/build_log/wave56/W56_rebuild_recipe.txt", lines.join("\n") + `\n\nABORTED: ${e?.stack}\n`);
  process.exit(1);
});
