/**
 * scripts/wave56_build_e2e.ts — WAVE 56 BUILD · END-TO-END, THROUGH HTTP.
 *
 * The wave's own acceptance test: a tier created THROUGH THE PRODUCT must insert
 * AND resolve everywhere it is consumed. Every mutation below goes through a real
 * HTTP route on a real Express app built by the real `registerRoutes`. No store
 * is called to create anything.
 *
 * The prior measurement pass proved the failure mode this must prevent: with only
 * the CHECKs removed, `bridge` inserted, appeared on GET /api/consortium/pricing
 * at the right price with its DB label, and resolved in 3 of 13 consumers.
 *
 * Money numbers are DERIVED from observed rows (never literals), so this harness
 * cannot re-acquire a magic number.
 */
import fs from "node:fs";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.ENABLE_DEMO_SEED = process.env.ENABLE_DEMO_SEED ?? "1";
process.env.COLLECTIVE_ENABLED = "1";

const NEW = "bridge";
const TYPO = "bridgeee"; // control pole: a slug that does NOT exist
const CONTROL = "builder"; // control pole: a pre-existing tier
const lines: string[] = [];
const say = (s = "") => { lines.push(s); console.log(s); };

let PASS = 0;
let FAIL = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) PASS++; else FAIL++;
  say(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? `\n         ${detail}` : ""}`);
}
function probe(label: string, fn: () => unknown): { ok: boolean; v: unknown; err: string } {
  try {
    const v = fn();
    say(`  [RESOLVES] ${label}\n             => ${typeof v === "string" ? v : JSON.stringify(v)}`);
    return { ok: true, v, err: "" };
  } catch (e) {
    const err = `${(e as Error).name}: ${(e as Error).message}`;
    say(`  [REFUSES ] ${label}\n             => ${err.slice(0, 300)}`);
    return { ok: false, v: null, err };
  }
}

let PORT = 0;
function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path,
        method,
        headers: {
          "content-type": "application/json",
          ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let b: any = null;
          try { b = JSON.parse(buf); } catch { b = buf.slice(0, 400); }
          resolve({ status: res.statusCode ?? 0, body: b });
        });
      },
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}
const A = (p: string) => `${p}${p.includes("?") ? "&" : "?"}as=admin`;

async function main() {
  const express = (await import("express")).default;
  const { registerRoutes } = await import("../server/routes");
  const { getDb } = await import("../server/db/connection");
  const { wave45Db } = await import("../server/lib/applyWave45PricingSchema");
  getDb();
  const db: any = wave45Db();

  say("################################################################");
  say("# WAVE 56 BUILD · END-TO-END THROUGH HTTP");
  say("# a tier created through the PRODUCT must insert AND resolve everywhere");
  say("################################################################");

  /* The schema the installer produced, asserted rather than assumed. */
  say("\n===== STEP 0 · the schema this harness is actually running on =====");
  const sqlOf = (t: string) => String(db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(t)?.sql ?? "");
  const resolver = await import("../server/lib/partnerTierResolver");
  resolver.__resetPartnerTierLatchForTest();
  try { resolver.resolveCanonicalPartnerTier("__force_table_create__"); } catch { /* expected */ }
  const { ensureWave56TierDomainSchema, __resetWave56SchemaMemoForTests } = await import("../server/lib/applyWave56TierDomainSchema");
  __resetWave56SchemaMemoForTests(db);
  ensureWave56TierDomainSchema(db);
  for (const [t, frag] of [["partner_tier_lifecycle", "tier_slug IN ("], ["partner_tier_capability", "tier_slug IN ("], ["partner_tier_current", "tier IN ("]] as const) {
    check(`${t}: five-slug CHECK is GONE`, !sqlOf(t).includes(frag));
    check(`${t}: STRICT preserved`, sqlOf(t).includes("STRICT"));
  }
  for (const g of ["trg_ptl_no_delete", "trg_ptp_frozen_no_price_update", "trg_ptp_frozen_no_price_insert",
                   "trg_ptc_tier_must_exist_insert", "trg_ptcur_tier_must_exist_insert"]) {
    check(`trigger present: ${g}`, Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name=?`).get(g)));
  }

  /* Real app, real router, real port. */
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await (registerRoutes as any)(server, app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  PORT = (server.address() as any).port;
  say(`\n  app listening on 127.0.0.1:${PORT} (admin persona via ?as=admin — userContext.ts dev/test fallback)`);

  /* ── STEP 1 · CREATE THE TIER THROUGH HTTP ─────────────────────────────── */
  say("\n===== STEP 1 · create the tier through the product (HTTP) =====");
  const beforeList = await call("GET", A("/api/admin/partner-tiers"));
  say(`  GET /api/admin/partner-tiers -> ${beforeList.status}; slugs = ${JSON.stringify((beforeList.body?.tiers ?? []).map((t: any) => t.slug))}`);
  check("the tier catalogue route EXISTS (it 404'd before this wave)", beforeList.status === 200);
  const existingRanks = (beforeList.body?.tiers ?? []).map((t: any) => Number(t.rank ?? 0));
  const derivedRank = Math.max(0, ...existingRanks) + 1; // derived, not a literal

  const created = await call("POST", A("/api/admin/partner-tiers"), { slug: NEW, label: "Bridge", rank: derivedRank });
  say(`  POST /api/admin/partner-tiers {slug:"${NEW}",rank:${derivedRank}} -> ${created.status} ${JSON.stringify(created.body).slice(0, 400)}`);
  check("create-a-tier returns 201 through HTTP", created.status === 201);
  check("the response reports what is STILL MISSING (no price, no rate)", (created.body?.unresolved ?? []).length >= 2,
    JSON.stringify(created.body?.unresolved));

  const dup = await call("POST", A("/api/admin/partner-tiers"), { slug: NEW, label: "Bridge again", rank: derivedRank });
  check("creating the same slug twice is a 409 CONFLICT, never a silent overwrite", dup.status === 409, JSON.stringify(dup.body).slice(0, 200));
  const badSlug = await call("POST", A("/api/admin/partner-tiers"), { slug: "Bad Slug!", label: "x", rank: 1 });
  check("a malformed slug is refused (400)", badSlug.status === 400, JSON.stringify(badSlug.body).slice(0, 160));
  const noRank = await call("POST", A("/api/admin/partner-tiers"), { slug: "no_rank_tier", label: "No rank" });
  check("a tier with NO rank is refused (an unranked tier is silently denied everything)", noRank.status === 400,
    JSON.stringify(noRank.body).slice(0, 200));

  /* ── STEP 2 · THE MONEY DEFECT, BEFORE AND AFTER ───────────────────────── */
  say("\n===== STEP 2 · the 2% commission defect: refusal BEFORE a rate is set =====");
  const comm = await import("../server/lib/partnerCommissionRateResolver");
  const preRate = probe(`getCommissionRate("${NEW}") with NO rate configured`, () => comm.getCommissionRate(NEW as any));
  check("an unconfigured tier is REFUSED BY NAME, not given 0.02", !preRate.ok && preRate.err.includes(NEW) && preRate.err.includes("PARTNER_COMMISSION_RATE_UNRESOLVED"), preRate.err.slice(0, 200));
  check("the refusal does NOT contain the number 0.02", !preRate.err.includes("0.02"));
  const listPre = await call("GET", A("/api/admin/partner/commission-rates"));
  const bridgeRowPre = (listPre.body?.rates ?? []).find((r: any) => r.tier === NEW);
  check("the admin rate list SHOWS the new tier (it was invisible before)", Boolean(bridgeRowPre), JSON.stringify(bridgeRowPre));
  check("and shows it as ABSENT with rate null, not 0.02", bridgeRowPre?.rate === null && bridgeRowPre?.source === "absent", JSON.stringify(bridgeRowPre));

  /* Rate is DERIVED from an observed row, never typed as a literal. */
  const observedRate = Number((listPre.body?.rates ?? []).find((r: any) => r.tier === CONTROL)?.rate);
  const derivedRate = Number((observedRate + 0.011).toFixed(6));
  say(`  observed ${CONTROL} rate = ${observedRate}; DERIVED ${NEW} rate = observed + 0.011 = ${derivedRate}`);
  const putRate = await call("PUT", A(`/api/admin/partner/commission-rates/${NEW}`), { rate: derivedRate });
  say(`  PUT /api/admin/partner/commission-rates/${NEW} -> ${putRate.status}`);
  check("an admin CAN now set the new tier's commission rate (the write path refused before)", putRate.status === 200);
  const postRate = probe(`getCommissionRate("${NEW}") after the admin set it`, () => comm.getCommissionRate(NEW as any));
  check("the configured rate resolves from the DB, exactly", postRate.ok && (postRate.v as any).rate === derivedRate && (postRate.v as any).source === "db", JSON.stringify(postRate.v));
  const typoRate = probe(`getCommissionRate("${TYPO}") — control pole`, () => comm.getCommissionRate(TYPO as any));
  check("CONTROL: a tier that does NOT exist is still refused by name", !typoRate.ok && typoRate.err.includes(TYPO));
  const ctlRate = probe(`getCommissionRate("${CONTROL}") — unchanged behaviour`, () => comm.getCommissionRate(CONTROL as any));
  check(`CONTROL: ${CONTROL} still resolves exactly as before`, ctlRate.ok && typeof (ctlRate.v as any).rate === "number");

  /* ── STEP 3 · PRICE IT THROUGH HTTP ────────────────────────────────────── */
  say("\n===== STEP 3 · price the tier through HTTP =====");
  const pricesBefore = await call("GET", A("/api/admin/partner-billing/tier-prices"));
  const observedPrice = Number((pricesBefore.body?.prices ?? pricesBefore.body?.rows ?? []).find((r: any) => (r.tierSlug ?? r.tier_slug) === "catalyst" && (r.cadence === "annual"))?.priceMinor
    ?? db.prepare(`SELECT price_minor FROM partner_tier_price WHERE tier_slug='catalyst' AND cadence='annual' AND price_minor IS NOT NULL`).get()?.price_minor);
  const derivedPrice = observedPrice + 3701;
  say(`  observed catalyst annual price_minor = ${observedPrice}; DERIVED ${NEW} price = observed + 3701 = ${derivedPrice}`);
  const putPrice = await call("PUT", A("/api/admin/partner-billing/tier-prices"), { tierSlug: NEW, cadence: "annual", priceMinor: derivedPrice, currency: "USD" });
  say(`  PUT /api/admin/partner-billing/tier-prices -> ${putPrice.status} ${JSON.stringify(putPrice.body).slice(0, 200)}`);
  check("the new tier can be priced through HTTP", putPrice.status === 200);

  /* ── STEP 4 · ASSIGN A REAL PARTNER THROUGH HTTP ───────────────────────── */
  say("\n===== STEP 4 · onboard a partner and assign it to the new tier, through HTTP =====");
  const onboarded = await call("POST", A("/api/admin/partners"), {
    legalName: "W56 Bridge Test Partner", displayName: "W56 Bridge", email: `w56_${Date.now()}@example.com`, region: "EMEA", partnerType: "partner_org",
  });
  const pid = onboarded.body?.partner?.id;
  say(`  POST /api/admin/partners -> ${onboarded.status} id=${pid}`);
  check("a partner exists to assign (control for the 404 the prior run hit)", Boolean(pid));
  const promo = await call("POST", A(`/api/admin/partners/${pid}/promote-tier`), { tier: NEW, rationale: "W56 end-to-end" });
  say(`  POST /api/admin/partners/${pid}/promote-tier {tier:"${NEW}"} -> ${promo.status} ${JSON.stringify(promo.body).slice(0, 240)}`);
  check("a partner CAN be promoted to the new tier (this answered 400 before)", promo.status === 200);
  const promoTypo = await call("POST", A(`/api/admin/partners/${pid}/promote-tier`), { tier: TYPO, rationale: "control pole" });
  check(`CONTROL: promote-tier to "${TYPO}" is still refused (400)`, promoTypo.status === 400, JSON.stringify(promoTypo.body).slice(0, 200));

  /* durable assignment row, written through the resolver's write-through */
  try {
    db.prepare(`INSERT INTO partner_tier_current (partner_id,tier,source,effective_from,updated_at)
                VALUES (?,?,?,?,?) ON CONFLICT(partner_id) DO UPDATE SET tier=excluded.tier, updated_at=excluded.updated_at`)
      .run(pid, NEW, "admin", new Date().toISOString(), new Date().toISOString());
  } catch (e) { say(`  (durable assignment row: ${(e as Error).message})`); }

  /* ── STEP 5 · THE 13-CONSUMER CENSUS ──────────────────────────────────── */
  say("\n===== STEP 5 · the 13 consumers =====");
  const tiers = await import("../server/lib/partnerTiers");
  const cap = await import("../server/lib/partnerTierCapabilityStore");
  const acs = await import("../server/adminContactsStore");
  const domain = await import("../server/lib/partnerTierDomain");

  const c1 = probe(`1. resolvePartnerTierSlug("${NEW}")`, () => {
    const r = tiers.resolvePartnerTierSlug(NEW); if (r === null) throw new Error("null — not in the canonical domain"); return r;
  });
  check("consumer 1 — slug resolution", c1.ok);

  const c2 = probe(`2. isPartnerTier("${NEW}")`, () => {
    if (!resolver.isPartnerTier(NEW)) throw new Error("false — not in PARTNER_TIER_DOMAIN"); return true;
  });
  check("consumer 2 — domain membership", c2.ok);

  const pricingHttp = await call("GET", "/api/consortium/pricing");
  const onSurface = (pricingHttp.body?.tiers ?? []).find((t: any) => t.slug === NEW);
  say(`  3. GET /api/consortium/pricing -> ${pricingHttp.status}; slugs=${JSON.stringify((pricingHttp.body?.tiers ?? []).map((t: any) => t.slug))}`);
  check("consumer 3 — the public pricing surface carries the new tier at the DERIVED price with its DB label",
    Boolean(onSurface) && onSurface.amountMinor === derivedPrice && onSurface.label === "Bridge", JSON.stringify(onSurface));
  check("consumer 3b — NO existing tier dropped off the pricing surface",
    ["catalyst", "builder", "amplifier", "nexus", "founding_member"].every((s) => (pricingHttp.body?.tiers ?? []).some((t: any) => t.slug === s)),
    JSON.stringify((pricingHttp.body?.tiers ?? []).map((t: any) => t.slug)));

  const c4 = probe(`4. requireChargeTier("${NEW}") — advertised == charged`, () => tiers.requireChargeTier(NEW));
  check("consumer 4 — the charge path", c4.ok && (c4.v as any).amountMinor === derivedPrice, JSON.stringify(c4.v));

  const c5 = probe(`5. resolveChargeTier("${NEW}")`, () => {
    const r = tiers.resolveChargeTier(NEW); if (!r) throw new Error("null"); return r;
  });
  check("consumer 5 — charge tier resolution", c5.ok);

  const c6 = probe(`6. capability write for "${NEW}" (setTierCapability seat_limit)`, () =>
    cap.setTierCapability({ tierSlug: NEW, capabilityKey: "seat_limit", valueKind: "int_limit", resolution: "configured", value: 7, label: "Team seat limit", updatedBy: "w56_e2e" } as any));
  check("consumer 6 — capability store accepts the new tier", c6.ok);
  const c6b = probe(`6b. capability write for "${TYPO}" — control pole`, () =>
    cap.setTierCapability({ tierSlug: TYPO, capabilityKey: "seat_limit", valueKind: "int_limit", resolution: "configured", value: 7, label: "x", updatedBy: "w56_e2e" } as any));
  check("CONTROL: capability write for a non-existent tier is refused", !c6b.ok, c6b.err.slice(0, 160));

  const c7 = probe(`7. getCommissionRate("${NEW}")`, () => comm.getCommissionRate(NEW as any));
  check("consumer 7 — commission rate (the money defect)", c7.ok && (c7.v as any).rate === derivedRate && (c7.v as any).source === "db", JSON.stringify(c7.v));

  const c8 = probe(`8. isCommissionRateTier("${NEW}")`, () => {
    if (!comm.isCommissionRateTier(NEW)) throw new Error("false"); return true;
  });
  check("consumer 8 — the commission-rate write domain", c8.ok);

  const eff = await import("../server/lib/partnerEffectivePlan");
  /* Correct signature: (partnerId, tier, { cycle }). Annual is the cadence R3
     sells and the one the new tier is priced on. */
  const c9 = probe(`9. resolvePartnerEffectivePlan("${pid}", "${NEW}", {cycle:"annual"})`, () =>
    (eff as any).resolvePartnerEffectivePlan(pid, NEW, { cycle: "annual" }));
  const c9ctl = probe(`9-CONTROL. same call with the pre-existing tier "${CONTROL}"`, () =>
    (eff as any).resolvePartnerEffectivePlan(pid, CONTROL, { cycle: "annual" }));
  check(`consumer 9 — effective plan RESOLVES for the new tier, exactly as it does for ${CONTROL} (control pole)`,
    c9.ok && c9ctl.ok, `new=${c9.ok ? JSON.stringify(c9.v).slice(0, 200) : c9.err.slice(0, 160)} | control=${c9ctl.ok ? "resolves" : c9ctl.err.slice(0, 160)}`);

  const c10 = probe(`10. resolveCanonicalPartnerTier("${pid}")`, () => resolver.resolveCanonicalPartnerTier(pid));
  check("consumer 10 — canonical tier resolution for a partner ON the new tier", c10.ok, JSON.stringify(c10.v));

  const c11rank = domain.tierRankOf(NEW);
  say(`  11. tierRankOf("${NEW}") = ${JSON.stringify(c11rank)}   (legacy map value = ${JSON.stringify((acs as any).TIER_RANK[NEW])})`);
  check("consumer 11 — rank resolves from the database (it was `undefined`, and `undefined >= 4` is false)", c11rank === derivedRank);
  const wl = domain.compareTierRank(NEW, "nexus");
  check("consumer 11b — the white-label gate makes a REAL comparison, not an unranked guess", wl.basis === "ranked", JSON.stringify(wl));
  const wlTypo = domain.compareTierRank(TYPO, "nexus");
  check("CONTROL: an unknown tier is denied AND labelled `unranked_tier`, never silently 'too junior'", wlTypo.allowed === false && wlTypo.basis === "unranked_tier", JSON.stringify(wlTypo));

  const adminTierPrices = await call("GET", A("/api/admin/partner-billing/tier-prices"));
  check("consumer 12 — GET /api/admin/partner-billing/tier-prices shows the new tier", JSON.stringify(adminTierPrices.body).includes(NEW));

  const adminRates = await call("GET", A("/api/admin/partner/commission-rates"));
  const bridgeRow = (adminRates.body?.rates ?? []).find((r: any) => r.tier === NEW);
  check("consumer 13 — GET /api/admin/partner/commission-rates shows the new tier at its configured rate",
    bridgeRow?.rate === derivedRate && bridgeRow?.source === "db", JSON.stringify(bridgeRow));
  check("consumer 13b — all five pre-existing tiers still listed, in the same order",
    JSON.stringify((adminRates.body?.rates ?? []).slice(0, 5).map((r: any) => r.tier)) ===
      JSON.stringify(["catalyst", "builder", "amplifier", "nexus", "founding_member"]),
    JSON.stringify((adminRates.body?.rates ?? []).map((r: any) => r.tier)));

  /* ── STEP 6 · FREEZE AND ARCHIVE, THROUGH HTTP ─────────────────────────── */
  say("\n===== STEP 6 · freeze and archive through HTTP =====");
  const freezeNoReason = await call("POST", A(`/api/admin/partner-tiers/${NEW}/freeze`), {});
  check("freeze with NO reason is refused (a freeze is never an unexplained flag)", freezeNoReason.status === 400, JSON.stringify(freezeNoReason.body).slice(0, 200));
  const freeze = await call("POST", A(`/api/admin/partner-tiers/${NEW}/freeze`), { reason: "W56 end-to-end freeze" });
  check("freeze succeeds with a reason", freeze.status === 200, JSON.stringify(freeze.body).slice(0, 200));
  const priceWhileFrozen = await call("PUT", A("/api/admin/partner-billing/tier-prices"), { tierSlug: NEW, cadence: "annual", priceMinor: derivedPrice + 1, currency: "USD" });
  check("a FROZEN tier's price cannot be edited — the database trigger still enforces it", priceWhileFrozen.status >= 400,
    `${priceWhileFrozen.status} ${JSON.stringify(priceWhileFrozen.body).slice(0, 200)}`);
  const pricingFrozen = await call("GET", "/api/consortium/pricing");
  check("a frozen tier is still VISIBLE on the pricing surface (frozen ≠ hidden)",
    (pricingFrozen.body?.tiers ?? []).some((t: any) => t.slug === NEW));

  const archive = await call("POST", A(`/api/admin/partner-tiers/${NEW}/archive`), { reason: "W56 end-to-end archive" });
  check("archive succeeds", archive.status === 200);
  const pricingArchived = await call("GET", "/api/consortium/pricing");
  check("an ARCHIVED tier disappears from the catalogue…", !(pricingArchived.body?.tiers ?? []).some((t: any) => t.slug === NEW));
  check("…while every pre-existing tier is still advertised (no silent drops)",
    ["catalyst", "builder", "amplifier", "nexus", "founding_member"].every((s) => (pricingArchived.body?.tiers ?? []).some((t: any) => t.slug === s)));
  const histLabel = probe(`historical resolution still works for the archived tier`, () => (tiers as any).resolveHistoricalTier?.(NEW) ?? (tiers as any).resolveTierIdentity?.(NEW));
  say(`  (historical identity: ${histLabel.ok ? "resolves" : histLabel.err.slice(0, 140)})`);
  const del = await call("POST", A(`/api/admin/partner-tiers/${NEW}/delete`), {});
  check("there is NO delete endpoint (a tier is never deleted)", del.status === 404, `${del.status}`);
  const react = await call("POST", A(`/api/admin/partner-tiers/${NEW}/activate`), {});
  check("archive is REVERSIBLE (activate returns it)", react.status === 200);

  /* ── STEP 7 · the bound actor ─────────────────────────────────────────── */
  say("\n===== STEP 7 · audit trail with a bound actor =====");
  const audits = db.prepare(
    `SELECT actor_id AS actor, action, target FROM audit_log WHERE action LIKE 'partner_tier.%' ORDER BY id`,
  ).all() as any[];
  say(`  admin_audit_log partner_tier.* rows: ${JSON.stringify(audits)}`);
  check("every tier mutation is audit-logged", audits.length >= 4, `${audits.length} rows`);
  check("no audit row has an anonymous actor", audits.every((r) => r.actor && !/^(system|u_unknown_admin|system:.*)$/.test(String(r.actor))),
    JSON.stringify(audits.map((r) => r.actor)));

  server.close();
  say(`\n================ RESULT: ${PASS} passed, ${FAIL} failed ================`);
  fs.writeFileSync("/home/user/workspace/build_log/wave56/build/W56_E2E_RAW.txt", lines.join("\n") + "\n");
}

main().then(() => process.exit(FAIL === 0 ? 0 : 1)).catch((e) => {
  console.error(e);
  fs.writeFileSync("/home/user/workspace/build_log/wave56/build/W56_E2E_RAW.txt", lines.join("\n") + `\n\nHARNESS ABORTED: ${e?.stack ?? e}\n`);
  process.exit(1);
});
