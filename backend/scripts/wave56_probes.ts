/**
 * scripts/wave56_probes.ts — WAVE 56 reproduction probes.
 *
 * IMPORTANT METHOD NOTE (verified, not assumed): the numbered migrations cannot
 * be replayed in isolation onto an empty DB — 0153 needs
 * `founder_collective_applications`, 0161 needs `contacts`, and 0185 needs
 * `partner_tier_price` from 0153. So the probes run against the path the tree
 * ACTUALLY uses in dev/test: connection.ts's inline bootstrap plus the Wave 5 /
 * Wave 45 self-heal installers, which read their DDL from the migration files.
 * That is also the only path a test can reach.
 */
import fs from "node:fs";
import path from "node:path";

process.env.NODE_ENV = process.env.NODE_ENV || "test";

const NEW = "bridge";
const lines: string[] = [];
function say(s: string) { lines.push(s); console.log(s); }

async function main() {
  const { rawDb, getDb } = await import("../server/db/connection");
  const { wave45Db, WAVE45_TABLES, WAVE45_TRIGGERS } = await import("../server/lib/applyWave45PricingSchema");
  getDb();
  const db: any = wave45Db();
  say(`# W56 PROBES — NODE_ENV=${process.env.NODE_ENV}, db driver via connection.ts inline bootstrap`);
  say(`# foreign_keys = ${JSON.stringify(db.prepare("PRAGMA foreign_keys").get?.() ?? "n/a")}`);

  const present = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'partner_tier%' ORDER BY name`).all() as any[]).map((r) => r.name);
  say(`partner_tier* TABLES PRESENT: ${present.join(", ") || "(none)"}`);
  say(`WAVE45_TABLES expected: ${WAVE45_TABLES.join(", ")}`);
  const trg = (db.prepare(`SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' ORDER BY name`).all() as any[]);
  say(`TRIGGERS: ${trg.map((r) => `${r.name}@${r.tbl_name}`).join(", ")}`);
  say(`WAVE45_TRIGGERS expected: ${WAVE45_TRIGGERS.join(", ")}`);

  say("\n== P0 · the CHECK text of each tier table, verbatim (this is what a test DB really has) ==");
  for (const t of ["partner_tier_lifecycle", "partner_tier_capability", "partner_tier_current", "partner_tier_price"]) {
    const sql = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(t) as any)?.sql ?? "(ABSENT)";
    say(`### ${t}\n${sql}\n`);
  }

  const now = "2026-08-16T00:00:00Z";
  function attempt(label: string, fn: () => void) {
    try { fn(); say(`${label}\n    -> SUCCEEDED`); }
    catch (e) { say(`${label}\n    -> REFUSED: ${(e as Error).message}`); }
  }

  say("== P1 · lifecycle CHECK blocks a new tier ==");
  attempt(`P1 INSERT partner_tier_lifecycle('${NEW}')`, () => {
    db.prepare(`INSERT INTO partner_tier_lifecycle
      (tier_slug,state,display_name,state_reason,created_at,updated_at,state_changed_at)
      VALUES (?,?,?,?,?,?,?)`).run(NEW, "active", "Bridge", null, now, now, now);
  });

  say("\n== P2 · capability CHECK blocks a new tier ==");
  attempt(`P2 INSERT partner_tier_capability('${NEW}')`, () => {
    db.prepare(`INSERT INTO partner_tier_capability
      (id,tier_slug,capability_key,value_kind,resolution,int_value,label,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run("ptc_w56_bridge_seat", NEW, "seat_limit", "int_limit", "configured", 7, "Team seat limit", "W56 probe", now, now);
  });

  say("\n== P3 · partner_tier_current CHECK blocks assignment ==");
  attempt(`P3 INSERT partner_tier_current('${NEW}')`, () => {
    db.prepare(`INSERT INTO partner_tier_current (partner_id,tier,source,effective_from,updated_at)
      VALUES (?,?,?,?,?)`).run("p_w56", NEW, "w56_probe", now, now);
  });

  say("\n== P4 · partner_tier_price does NOT block it — the asymmetry ==");
  attempt(`P4 INSERT partner_tier_price('${NEW}','annual',NULL unpriced)`, () => {
    db.prepare(`INSERT INTO partner_tier_price
      (id,tier_slug,cadence,price_minor,currency,derivation,active,created_at,updated_at,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run("ptp_w56_bridge_annual", NEW, "annual", null, "USD", "unpriced", 0, now, now, "W56 probe");
  });

  say("\n== P4b · the 13-vs-5 asymmetry, in data ==");
  const pslugs = (db.prepare(`SELECT DISTINCT tier_slug FROM partner_tier_price ORDER BY tier_slug`).all() as any[]).map((r) => r.tier_slug);
  const lslugs = (db.prepare(`SELECT tier_slug FROM partner_tier_lifecycle ORDER BY tier_slug`).all() as any[]).map((r) => r.tier_slug);
  say(`partner_tier_price distinct tier_slug (${pslugs.length}): ${pslugs.join(", ")}`);
  say(`partner_tier_lifecycle tier_slug (${lslugs.length}): ${lslugs.join(", ")}`);
  const oob = pslugs.filter((s) => !lslugs.includes(s));
  say(`OUT-OF-DOMAIN price slugs (${oob.length}): ${oob.join(", ")}`);

  say("\n== P5 · which DDL does partnerTierResolver actually use on a test DB? ==");
  const res = await import("../server/lib/partnerTierResolver");
  db.exec(`DROP TABLE IF EXISTS partner_tier_current`);
  res.__resetPartnerTierLatchForTest();
  try { res.resolveCanonicalPartnerTier("p_does_not_exist"); } catch (e) { say(`  resolve threw as designed: ${(e as Error).name}`); }
  const recreated = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='partner_tier_current'`).get() as any)?.sql ?? "(ABSENT)";
  say(`  partner_tier_current DDL after resolver self-heal:\n${recreated}`);
  say(`  contains five-slug CHECK? ${recreated.includes("'catalyst','builder','amplifier','nexus','founding_member'") ? "YES — partnerTierResolver.ts:111 IS the live definition in tests" : "no"}`);

  say("\n== P7 · unknown slug fails closed today ==");
  const pt = await import("../server/lib/partnerTiers");
  say(`  resolvePartnerTierSlug("${NEW}") = ${JSON.stringify(pt.resolvePartnerTierSlug(NEW))}`);
  say(`  resolvePartnerTierSlug("not_a_tier") = ${JSON.stringify(pt.resolvePartnerTierSlug("not_a_tier"))}`);
  say(`  isPartnerTier("${NEW}") = ${res.isPartnerTier(NEW)}`);
  say(`  PARTNER_TIER_DOMAIN = ${JSON.stringify(res.PARTNER_TIER_DOMAIN)}`);

  say("\n== P8 · the six aliases resolve today ==");
  for (const a of ["partner_basic", "partner_pro", "partner_enterprise", "basic", "pro", "enterprise", " Partner_Basic ", "partner_basics", "PARTNER-BASIC"]) {
    say(`  resolvePartnerTierSlug(${JSON.stringify(a)}) = ${JSON.stringify(pt.resolvePartnerTierSlug(a))}`);
  }

  say("\n== P10 · PRAGMA foreign_key_check RETURNS ROWS, it does not error ==");
  const fkc = db.prepare(`PRAGMA foreign_key_check`).all();
  say(`  returned ${JSON.stringify(fkc)} — no throw. Confirms it asserts NOTHING inside a .sql migration.`);

  const outDir = "/home/user/workspace/build_log/wave56";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "W56_probes_BEFORE.txt"), lines.join("\n") + "\n");
  console.log(`\nwrote ${outDir}/W56_probes_BEFORE.txt`);
  void rawDb;
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
