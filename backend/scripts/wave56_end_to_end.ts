/**
 * scripts/wave56_end_to_end.ts — WAVE 56 · does a NEW tier RESOLVE EVERYWHERE?
 *
 * THIS SCRIPT DELIBERATELY COMMITS, IN A THROWAWAY :memory: DATABASE, THE
 * FAILURE THE WAVE MUST NOT SHIP: it removes ONLY the three blocking slug
 * CHECKs (the "rebuild the table and declare victory" move) and then asks every
 * consumer whether the new tier resolves. Nothing here is applied to the tree.
 *
 * Method note, measured not assumed: the numbered migrations cannot be replayed
 * in isolation (0153 needs founder_collective_applications, 0161 needs contacts,
 * 0185 needs 0153's partner_tier_price). So the DB is the one the tree really
 * uses in dev/test: connection.ts's inline bootstrap + the Wave 5 / Wave 45
 * self-heal installers, which read their DDL from the migration files.
 */
import fs from "node:fs";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.ENABLE_DEMO_SEED = process.env.ENABLE_DEMO_SEED ?? "1";

const NEW = "bridge";
const NOW = "2026-08-16T00:00:00Z";
const lines: string[] = [];
function say(s = "") { lines.push(s); console.log(s); }
function verdict(label: string, fn: () => unknown) {
  try {
    const v = fn();
    say(`  [RESOLVES]  ${label}`);
    say(`              => ${typeof v === "string" ? v : JSON.stringify(v)}`);
    return { ok: true, v };
  } catch (e) {
    say(`  [REFUSES ]  ${label}`);
    say(`              => ${(e as Error).name}: ${(e as Error).message}`.slice(0, 400));
    return { ok: false, v: null };
  }
}

/* ── the CORRECTED rebuild recipe — verified by scripts/wave56_rebuild_recipe.ts ──
 * The recipe in STRATEGY_W56 §5.3 / §11.2.1 is NOT executable on this schema:
 * `ALTER TABLE ... RENAME TO` re-parses every trigger in the schema, and
 * partner_tier_price carries two triggers (0185:96-120) whose WHEN clauses read
 * partner_tier_lifecycle, so the rename throws AFTER the old table has already
 * been dropped. Referencing triggers must be dropped FIRST and recreated after.
 */
function rebuildWithoutSlugCheck(db: any, table: string, slugCol: string): void {
  const orig: string = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table) as any).sql;
  const rebuilt = orig
    .replace(/\n\s*CHECK \(tier_slug IN \('catalyst','builder','amplifier','nexus','founding_member'\)\),/g, ",")
    .replace(/ CHECK \(tier IN \('catalyst','builder','amplifier','nexus','founding_member'\)\)/g, "")
    .replace(new RegExp(`CREATE TABLE ${table}`), `CREATE TABLE ${table}__w56_new`);
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name).join(",");
  const before = (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n;
  const idx = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL`).all(table) as any[]).map((r) => r.sql);
  // EVERY trigger in the schema whose body mentions this table, not just its own.
  const trg = (db.prepare(`SELECT name, sql FROM sqlite_master WHERE type='trigger'`).all() as any[])
    .filter((r) => String(r.sql).includes(table));
  for (const t of trg) db.exec(`DROP TRIGGER IF EXISTS ${t.name}`);
  db.exec(rebuilt);
  db.exec(`INSERT INTO ${table}__w56_new (${cols}) SELECT ${cols} FROM ${table}`);
  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${table}__w56_new RENAME TO ${table}`);
  for (const s2 of idx) db.exec(s2);
  for (const t of trg) { db.exec(`DROP TRIGGER IF EXISTS ${t.name}`); db.exec(t.sql); }
  const after = (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n;
  say(`  rebuilt ${table}: rows ${before} -> ${after}; indexes ${idx.length}; referencing triggers dropped+recreated ${trg.length} (${trg.map((t)=>t.name).join(",")}); STRICT kept=${/\)\s*STRICT/.test(rebuilt)}`);
  void slugCol;
}

function call(method: string, path: string, body?: any, headers: Record<string, string> = {}, port = 0): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request({ host: "127.0.0.1", port, path, method, headers: { "content-type": "application/json", ...headers, ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}) } }, (res) => {
      let buf = ""; res.on("data", (c) => (buf += c));
      res.on("end", () => { let b: any = null; try { b = JSON.parse(buf); } catch { b = buf.slice(0, 300); } resolve({ status: res.statusCode ?? 0, body: b }); });
    });
    r.on("error", reject); if (payload) r.write(payload); r.end();
  });
}

async function main() {
  const express = (await import("express")).default;
  const { registerRoutes } = await import("../server/routes");
  const { getDb } = await import("../server/db/connection");
  const { wave45Db } = await import("../server/lib/applyWave45PricingSchema");
  getDb();
  const db: any = wave45Db();

  say("################################################################");
  say("# W56 END-TO-END · does a NEW tier resolve everywhere it is consumed?");
  say("# throwaway :memory: DB (NODE_ENV=test). Nothing written to the tree.");
  say("################################################################");

  /* ── STEP 1 · the naive fix: remove the three blocking slug CHECKs ───────── */
  say("\n===== STEP 1 · remove ONLY the three blocking slug CHECKs (the naive fix) =====");
  const resolver = await import("../server/lib/partnerTierResolver");
  resolver.__resetPartnerTierLatchForTest();
  try { resolver.resolveCanonicalPartnerTier("__force_table_create__"); } catch { /* expected */ }
  const trgBefore = (db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`).all() as any[]).map((r) => r.name);
  say(`  triggers BEFORE rebuild: ${trgBefore.join(", ")}`);
  for (const [t, c] of [["partner_tier_lifecycle", "tier_slug"], ["partner_tier_capability", "tier_slug"], ["partner_tier_current", "tier"]] as const) {
    try { rebuildWithoutSlugCheck(db, t, c); } catch (e) { say(`  !! rebuild ${t} FAILED: ${(e as Error).message}`); }
  }
  const trgAfter = (db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`).all() as any[]).map((r) => r.name);
  say(`  triggers AFTER  rebuild: ${trgAfter.join(", ")}`);
  say(`  triggers LOST: ${trgBefore.filter((n) => !trgAfter.includes(n)).join(", ") || "(none)"}`);

  /* ── STEP 2 · insert the new tier, fully: lifecycle + capability + PRICE ─── */
  say("\n===== STEP 2 · insert tier 'bridge' fully (lifecycle + capabilities + priced annual row) =====");
  verdict("INSERT partner_tier_lifecycle('bridge','active','Bridge')", () => {
    db.prepare(`INSERT INTO partner_tier_lifecycle (tier_slug,state,display_name,state_reason,state_changed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(NEW, "active", "Bridge", null, NOW, NOW, NOW); return "inserted";
  });
  verdict("INSERT partner_tier_capability('bridge','seat_limit',7)", () => {
    db.prepare(`INSERT INTO partner_tier_capability (id,tier_slug,capability_key,value_kind,resolution,int_value,label,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run("ptc_w56_bridge_seat", NEW, "seat_limit", "int_limit", "configured", 7, "Team seat limit", NOW, NOW); return "inserted";
  });
  verdict("INSERT partner_tier_capability('bridge','live_spv_limit',not_configured)", () => {
    db.prepare(`INSERT INTO partner_tier_capability (id,tier_slug,capability_key,value_kind,resolution,label,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run("ptc_w56_bridge_spv", NEW, "live_spv_limit", "int_limit", "not_configured", "Live SPV limit", NOW, NOW); return "inserted";
  });
  /* The price is DERIVED from an observed row (+3701 minor), never a literal, so
   * this script cannot re-acquire a magic number (Wave 51 technique). */
  const observed = (db.prepare(`SELECT price_minor FROM partner_tier_price WHERE tier_slug='catalyst' AND cadence='annual' AND price_minor IS NOT NULL`).get() as any)?.price_minor;
  const derived = Number(observed) + 3701;
  say(`  observed catalyst annual price_minor = ${observed}; DERIVED bridge price_minor = observed + 3701 = ${derived}`);
  verdict(`INSERT partner_tier_price('bridge','annual',${derived}) admin_set active`, () => {
    db.prepare(`INSERT INTO partner_tier_price (id,tier_slug,cadence,price_minor,currency,derivation,active,effective_from,created_at,updated_at,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run("ptp_w56_bridge_annual", NEW, "annual", derived, "USD", "admin_set", 1, NOW, NOW, NOW, "W56 e2e fixture"); return "inserted";
  });
  verdict("INSERT partner_tier_current(partner p_w56 -> bridge)", () => {
    db.prepare(`INSERT INTO partner_tier_current (partner_id,tier,source,effective_from,updated_at) VALUES (?,?,?,?,?)`)
      .run("p_w56", NEW, "w56_e2e", NOW, NOW); return "inserted";
  });

  /* ── STEP 3 · does it RESOLVE? one row per consumer ──────────────────────── */
  say("\n===== STEP 3 · every consumer, asked directly =====");
  const tiers = await import("../server/lib/partnerTiers");
  say("\n-- 3.1 slug resolution / domain membership --");
  verdict(`resolvePartnerTierSlug("${NEW}")  [partnerTiers.ts CANONICAL_SLUGS]`, () => {
    const r = tiers.resolvePartnerTierSlug(NEW); if (r === null) throw new Error("returned null — slug is NOT in the code domain"); return r;
  });
  verdict(`isPartnerTier("${NEW}")  [partnerTierResolver.ts PARTNER_TIER_DOMAIN]`, () => {
    const r = resolver.isPartnerTier(NEW); if (!r) throw new Error("false — slug is NOT in PARTNER_TIER_DOMAIN"); return r;
  });

  say("\n-- 3.2 pricing projection (the public /consortium/pricing source) --");
  const proj = verdict("resolveConsortiumPricing() includes 'bridge'", () => {
    const all = tiers.resolveConsortiumPricing();
    const hit = all.find((t: any) => t.slug === NEW);
    if (!hit) throw new Error(`absent. surface slugs = ${all.map((t: any) => t.slug).join(",")}`);
    return hit;
  });

  say("\n-- 3.3 the charge path (advertised == charged?) --");
  verdict(`requireChargeTier("${NEW}")`, () => tiers.requireChargeTier(NEW));
  verdict(`resolveChargeTier("${NEW}")`, () => {
    const r = tiers.resolveChargeTier(NEW); if (!r) throw new Error("null — charge path fails closed on the new tier"); return r;
  });

  say("\n-- 3.4 capability store --");
  const cap = await import("../server/lib/partnerTierCapabilityStore");
  say(`  CAPABILITY_TIER_SLUGS (compiled-in) = ${JSON.stringify(cap.CAPABILITY_TIER_SLUGS)}`);
  for (const fn of Object.keys(cap).filter((k) => /^(resolveCapability|listCapabilit|getCapabilit)/.test(k))) {
    verdict(`partnerTierCapabilityStore.${fn}("${NEW}", "seat_limit")`, () => (cap as any)[fn](NEW, "seat_limit"));
  }

  say("\n-- 3.5 commission rate --");
  const comm = await import("../server/lib/partnerCommissionRateResolver");
  verdict(`getCommissionRate("${NEW}")`, () => {
    const r = comm.getCommissionRate(NEW as any);
    if (r.source !== "db") throw new Error(`source=${r.source} rate=${r.rate} — the new tier gets the DEFAULT_RATE floor, not a configured rate`);
    return r;
  });
  verdict(`isCommissionRateTier("${NEW}")`, () => {
    if (!comm.isCommissionRateTier(NEW)) throw new Error("false — the admin commission-rate write path refuses the new tier");
    return true;
  });

  say("\n-- 3.6 effective plan for a partner ON the new tier --");
  const eff = await import("../server/lib/partnerEffectivePlan");
  verdict(`resolvePartnerEffectivePlan("p_w56")`, () => (eff as any).resolvePartnerEffectivePlan("p_w56"));

  say("\n-- 3.7 canonical tier resolution for a partner ON the new tier --");
  verdict(`resolveCanonicalPartnerTier("p_w56")`, () => resolver.resolveCanonicalPartnerTier("p_w56"));

  say("\n-- 3.8 display label / rank maps --");
  const acs = await import("../server/adminContactsStore");
  verdict(`adminContactsStore.TIER_RANK["${NEW}"]`, () => {
    const r = (acs as any).TIER_RANK[NEW]; if (r === undefined) throw new Error("undefined — rank map has no entry, so every tierAtLeast() comparison is NaN/false"); return r;
  });

  /* ── STEP 4 · through real HTTP routes ──────────────────────────────────── */
  say("\n===== STEP 4 · through REAL HTTP routes (no store called directly) =====");
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await (registerRoutes as any)(server, app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as any).port;
  say(`  app listening on 127.0.0.1:${port}`);

  const pricing = await call("GET", "/api/consortium/pricing", undefined, {}, port);
  say(`  GET /api/consortium/pricing -> ${pricing.status}`);
  const surfaceSlugs = (pricing.body?.tiers ?? []).map((t: any) => t.slug);
  say(`  surface slugs = ${JSON.stringify(surfaceSlugs)}`);
  const bridgeOnSurface = (pricing.body?.tiers ?? []).find((t: any) => t.slug === NEW);
  say(bridgeOnSurface
    ? `  [RESOLVES]  'bridge' IS on the public pricing surface: ${JSON.stringify(bridgeOnSurface)}`
    : `  [REFUSES ]  'bridge' is ABSENT from the public pricing surface`);
  if (bridgeOnSurface) {
    say(`  amountMinor === derived(${derived})? ${bridgeOnSurface.amountMinor === derived}`);
    say(`  label from lifecycle display_name? ${JSON.stringify(bridgeOnSurface.label)}`);
  }

  /* ADMIN surfaces. `?as=admin` is the dev/test persona fallback
   * (userContext.ts:527-529), so these are real authenticated admin requests
   * through the real router, not store calls. */
  say("\n  -- authenticated ADMIN surfaces (?as=admin) --");
  for (const p of [
    "/api/admin/partner-billing/tier-prices",
    "/api/admin/consortium/subscription-tiers",
    "/api/admin/partner/commission-rates",
    "/api/admin/pricing-models",
    "/api/admin/partner-fees",
  ]) {
    const r = await call("GET", `${p}?as=admin`, undefined, {}, port);
    const txt = JSON.stringify(r.body);
    say(`  GET ${p} -> ${r.status}`);
    if (r.status === 200) {
      say(`      mentions 'bridge'? ${txt.includes(NEW)}   len=${txt.length}`);
      say(`      body head: ${txt.slice(0, 300)}`);
    } else {
      say(`      body: ${txt.slice(0, 200)}`);
    }
  }

  const promote = await call("POST", "/api/admin/partners/p_w56/promote-tier?as=admin", { tier: NEW, rationale: "W56 e2e" }, {}, port);
  say(`  POST /api/admin/partners/:id/promote-tier {tier:"bridge"} -> ${promote.status} ${JSON.stringify(promote.body).slice(0, 300)}`);
  const promoteCanon = await call("POST", "/api/admin/partners/p_w56/promote-tier?as=admin", { tier: "builder", rationale: "W56 control pole" }, {}, port);
  say(`  CONTROL POLE: same route with tier:"builder" -> ${promoteCanon.status} ${JSON.stringify(promoteCanon.body).slice(0, 200)}`);
  say(`  (if 'builder' is accepted/404-on-partner and 'bridge' is 400, the refusal is the TIER, not auth)`);

  say("\n  -- is there ANY admin route that CREATES a tier? --");
  for (const p of ["/api/admin/partner-tiers", "/api/admin/partner/tier-lifecycle", "/api/admin/partner-billing/tiers", "/api/admin/pricing/partner-tiers"]) {
    const r = await call("POST", `${p}?as=admin`, { tierSlug: NEW, displayName: "Bridge" }, {}, port);
    say(`  POST ${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  }

  server.close();

  fs.writeFileSync("/home/user/workspace/build_log/wave56/W56_END_TO_END_RAW.txt", lines.join("\n") + "\n");
  say(`\nwrote build_log/wave56/W56_END_TO_END_RAW.txt`);
  void proj;
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  fs.writeFileSync("/home/user/workspace/build_log/wave56/W56_END_TO_END_RAW.txt", lines.join("\n") + `\n\nHARNESS ABORTED: ${e?.stack ?? e}\n`);
  process.exit(1);
});
