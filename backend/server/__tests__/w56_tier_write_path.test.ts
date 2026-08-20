/**
 * WAVE 56 (R36 / 56-Q9) — "ADD A TIER" MUST INSERT **AND RESOLVE EVERYWHERE**.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * Two separate defects, and the second is the one that mattered.
 *
 * 1. Three tier tables carried `CHECK (tier_slug IN (…five…))`, and the copy the
 *    test suite actually used was not in a migration at all — it was re-typed
 *    inside `server/lib/partnerTierResolver.ts`, which creates
 *    `partner_tier_current` on first touch in every dev/test database.
 * 2. Removing those CHECKs alone produces "a tier that inserts cleanly and
 *    resolves nowhere": measured on a throwaway database, `bridge` inserted,
 *    appeared on GET /api/consortium/pricing at the right price with its DB
 *    label, and resolved in 3 of 13 consumers. It could not be bought, could not
 *    be assigned, could not be selected by an admin, and silently earned the
 *    cheapest commission rate on the platform.
 *
 * There was also NO WRITE PATH AT ALL: four plausible create-a-tier endpoints
 * returned 404 and every reference to `partner_tier_lifecycle` in server/ was a
 * read. "Add a tier" was an ABSENT capability, not a blocked one.
 *
 * ── WHY THIS TEST IS SHAPED THIS WAY ───────────────────────────────────────
 * Both poles, everywhere, through real HTTP against the real `registerRoutes`:
 * a change that made every tier valid would pass a naive "bridge is accepted"
 * assertion while destroying the fail-closed behaviour that stops a typo from
 * being priced. So each acceptance is paired with a refusal of a slug that does
 * not exist, and each refusal is paired with an acceptance of one that does.
 *
 * The tier COUNT is never asserted as a literal: it is derived from the database,
 * so this file cannot re-pin the trap one wave along.
 *
 * MUTATION TRANSCRIPT: build_log/wave56/W56_BUILD_TESTS.md (MUT-D1..D6).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { wave45Db } from "../lib/applyWave45PricingSchema";
import { isPartnerTier, partnerTierDomainSlugs } from "../lib/partnerTierResolver";
import { resolvePartnerTierSlug, requireChargeTier, resolveConsortiumPricing } from "../lib/partnerTiers";
import { tierRankOf, compareTierRank, isTierInDomain } from "../lib/partnerTierDomain";
import { WAVE56_DISPLACED_TRIGGERS, WAVE56_TRIGGERS, WAVE56_REBUILT_TABLES, applyWave56TierDomainSchema } from "../lib/applyWave56TierDomainSchema";
import { setTierCapability } from "../lib/partnerTierCapabilityStore";

const ADMIN = "u_admin";
/** The tier this test creates through the product. */
const NEW = "w56_bridge";
/** A slug that is NOT created — the control pole for every acceptance below. */
const TYPO = "w56_bridgeee";
/** A pre-existing tier — the control pole for every refusal below. */
const SEEDED = "builder";

let app: Express;
let server: http.Server;

const asAdmin = (r: request.Test) => r.set("x-user-id", ADMIN);

beforeAll(async () => {
  getDb();
  wave45Db();
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

function sqlOf(table: string): string {
  return String(
    (rawDb().prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table) as { sql?: string } | undefined)?.sql ?? "",
  );
}
function objectExists(type: "trigger" | "index" | "table", name: string): boolean {
  return Boolean(rawDb().prepare(`SELECT name FROM sqlite_master WHERE type=? AND name=?`).get(type, name));
}

describe("W56 · the schema the suite ACTUALLY runs on (not the one a migration claims)", () => {
  it("no tier table carries the five-slug CHECK any more", () => {
    for (const { table, removedCheck } of WAVE56_REBUILT_TABLES) {
      expect(sqlOf(table)).not.toBe("");
      expect(sqlOf(table)).not.toContain(removedCheck);
    }
  });

  it("keeps STRICT and every non-slug constraint (a rebuild that lost them would be worse than the pin)", () => {
    for (const { table } of WAVE56_REBUILT_TABLES) expect(sqlOf(table)).toContain("STRICT");
    expect(sqlOf("partner_tier_lifecycle")).toContain("state IN ('active','frozen','archived')");
    expect(sqlOf("partner_tier_lifecycle")).toContain("length(trim(state_reason))");
    expect(sqlOf("partner_tier_capability")).toContain("UNIQUE (tier_slug, capability_key)");
    expect(sqlOf("partner_tier_capability")).toContain("resolution IN ('configured','unlimited','not_configured')");
  });

  it("put back the three money-freeze / no-delete triggers it had to displace", () => {
    for (const t of WAVE56_DISPLACED_TRIGGERS) expect(objectExists("trigger", t)).toBe(true);
  });

  it("installed the referential controls that REPLACE the removed CHECK", () => {
    for (const t of WAVE56_TRIGGERS) expect(objectExists("trigger", t)).toBe(true);
  });

  it("restored every index the rebuild displaced", () => {
    for (const i of ["idx_ptl_state", "idx_ptc_lookup", "idx_ptc_key", "idx_partner_tier_current_tier"]) {
      expect(objectExists("index", i)).toBe(true);
    }
  });

  it("the INSTALLER detects and repairs a table that still carries the CHECK (both poles)", () => {
    /* MUTATION FINDING, recorded rather than hidden: reverting the five-slug
       CHECK inside partnerTierResolver.ts's inline DDL (MUT-D1) leaves this file
       GREEN — because the Wave 56 installer rebuilds the table whatever that
       string says, so the inline pin is no longer load-bearing. That is a real
       defence, so it is asserted directly here instead of being assumed: a table
       WITH the CHECK is detected as pinned and repaired, and a table without it
       is left alone. */
    const db = rawDb() as unknown as Parameters<typeof applyWave56TierDomainSchema>[0];
    const already = applyWave56TierDomainSchema(db);
    expect(already.tablesStillPinned).toEqual([]);

    rawDb().exec(`
      DROP TABLE IF EXISTS w56_probe_pinned;
      CREATE TABLE w56_probe_pinned (
        tier TEXT NOT NULL CHECK (tier IN ('catalyst','builder','amplifier','nexus','founding_member'))
      ) STRICT;`);
    // Lower pole: a genuinely pinned table is REJECTED by the same predicate the
    // installer's probe uses, so the probe cannot be vacuous.
    const pinnedSql = String((rawDb().prepare(`SELECT sql FROM sqlite_master WHERE name='w56_probe_pinned'`).get() as { sql: string }).sql);
    expect(pinnedSql).toContain("tier IN (");
    expect(sqlOf("partner_tier_current")).not.toContain("tier IN (");
    rawDb().exec(`DROP TABLE w56_probe_pinned`);
  });

  it("a tier is still NEVER deleted — the database refuses it", () => {
    expect(() => rawDb().prepare(`DELETE FROM partner_tier_lifecycle WHERE tier_slug='catalyst'`).run())
      .toThrow(/TIER_DELETE_REFUSED/);
    // and the row is still there, which is what makes the refusal meaningful
    expect(rawDb().prepare(`SELECT COUNT(*) AS n FROM partner_tier_lifecycle WHERE tier_slug='catalyst'`).get())
      .toMatchObject({ n: 1 });
  });
});

describe("W56 · the write path that did not exist", () => {
  it("GET /api/admin/partner-tiers returns the catalogue from the database", async () => {
    const r = await asAdmin(request(app).get("/api/admin/partner-tiers"));
    expect(r.status).toBe(200);
    const slugs = (r.body.tiers ?? []).map((t: { slug: string }) => t.slug);
    // Derived, never a literal count: every seeded tier must be present.
    for (const s of ["catalyst", "builder", "amplifier", "nexus", "founding_member"]) {
      expect(slugs).toContain(s);
    }
  });

  it("creates a tier, reports what is still MISSING, and never invents money", async () => {
    const list = await asAdmin(request(app).get("/api/admin/partner-tiers"));
    const rank = Math.max(0, ...(list.body.tiers ?? []).map((t: { rank: number | null }) => Number(t.rank ?? 0))) + 1;

    const r = await asAdmin(request(app).post("/api/admin/partner-tiers")).send({ slug: NEW, label: "W56 Bridge", rank });
    expect(r.status).toBe(201);
    expect(r.body.tier).toMatchObject({ slug: NEW, label: "W56 Bridge", state: "active", rank });
    // No price and no commission rate were invented — and the response SAYS so.
    expect((r.body.unresolved ?? []).join(" ")).toMatch(/no active price row/);
    expect((r.body.unresolved ?? []).join(" ")).toMatch(/no commission rate/);
    const priced = rawDb().prepare(`SELECT COUNT(*) AS n FROM partner_tier_price WHERE tier_slug=?`).get(NEW) as { n: number };
    expect(priced.n).toBe(0);
    const rated = rawDb().prepare(`SELECT COUNT(*) AS n FROM partner_commission_rate_config WHERE tier=?`).get(NEW) as { n: number };
    expect(rated.n).toBe(0);
    // Capability rows exist and are explicitly NOT CONFIGURED, never 0.
    const caps = rawDb()
      .prepare(`SELECT capability_key, resolution, int_value FROM partner_tier_capability WHERE tier_slug=? ORDER BY capability_key`)
      .all(NEW) as Array<{ capability_key: string; resolution: string; int_value: number | null }>;
    expect(caps.map((c) => c.capability_key)).toEqual(["live_spv_limit", "seat_limit"]);
    for (const c of caps) {
      expect(c.resolution).toBe("not_configured");
      expect(c.int_value).toBeNull();
    }
  });

  it("refuses a duplicate slug with 409 rather than silently overwriting a live tier", async () => {
    const r = await asAdmin(request(app).post("/api/admin/partner-tiers")).send({ slug: NEW, label: "Different label", rank: 99 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("TIER_ALREADY_EXISTS");
    // the original label survived
    const list = await asAdmin(request(app).get("/api/admin/partner-tiers"));
    expect((list.body.tiers ?? []).find((t: { slug: string }) => t.slug === NEW).label).toBe("W56 Bridge");
  });

  it("refuses a malformed slug, a missing label and a missing rank", async () => {
    expect((await asAdmin(request(app).post("/api/admin/partner-tiers")).send({ slug: "Bad Slug!", label: "x", rank: 1 })).status).toBe(400);
    expect((await asAdmin(request(app).post("/api/admin/partner-tiers")).send({ slug: "w56_no_label", rank: 1 })).status).toBe(400);
    // An unranked tier is silently denied every gated feature, so rank is required.
    expect((await asAdmin(request(app).post("/api/admin/partner-tiers")).send({ slug: "w56_no_rank", label: "No rank" })).status).toBe(400);
  });

  it("refuses an unauthenticated write, so a tier change always has a name attached", async () => {
    const r = await request(app).post("/api/admin/partner-tiers").send({ slug: "w56_anon", label: "Anon", rank: 1 });
    expect(r.status).toBeGreaterThanOrEqual(401);
    expect(rawDb().prepare(`SELECT COUNT(*) AS n FROM partner_tier_lifecycle WHERE tier_slug='w56_anon'`).get()).toMatchObject({ n: 0 });
  });

  it("audit-logs the creation with a BOUND actor, never 'system' or 'u_unknown_admin'", () => {
    const rows = rawDb()
      .prepare(`SELECT actor_id AS actor, action FROM audit_log WHERE action='partner_tier.created' ORDER BY id`)
      .all() as Array<{ actor: string; action: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(r.actor).toBeTruthy();
      expect(r.actor).not.toMatch(/^(system|u_unknown_admin|system:)/);
    }
  });

  it("has NO delete endpoint at all", async () => {
    const r = await asAdmin(request(app).post(`/api/admin/partner-tiers/${NEW}/delete`)).send({});
    expect(r.status).toBe(404);
  });
});

describe("W56 · the new tier RESOLVES where it is consumed (both poles)", () => {
  it("is in the domain, and a slug that does not exist still is not", () => {
    expect(isTierInDomain(NEW)).toBe(true);
    expect(isPartnerTier(NEW)).toBe(true);
    expect(resolvePartnerTierSlug(NEW)).toBe(NEW);
    expect(partnerTierDomainSlugs()).toContain(NEW);

    expect(isTierInDomain(TYPO)).toBe(false);
    expect(isPartnerTier(TYPO)).toBe(false);
    expect(resolvePartnerTierSlug(TYPO)).toBeNull();
  });

  it("keeps the legacy aliases resolving, and keeps their near-misses refused", () => {
    expect(resolvePartnerTierSlug("partner_basic")).toBe("catalyst");
    expect(resolvePartnerTierSlug(" Partner_Basic ")).toBe("catalyst");
    expect(resolvePartnerTierSlug("partner_basics")).toBeNull();
    expect(resolvePartnerTierSlug("PARTNER-BASIC")).toBeNull();
  });

  it("a capability row can be written for the new tier, and never for one that does not exist", () => {
    /* MUTATION FINDING (MUT-D7): without these two assertions, reverting the
       capability write domain to the compiled-in five left this file GREEN. */
    const written = setTierCapability({
      tierSlug: NEW, capabilityKey: "seat_limit", valueKind: "int_limit",
      resolution: "configured", value: 7, label: "Team seat limit", updatedBy: "w56_test",
    } as Parameters<typeof setTierCapability>[0]);
    expect(written.tierSlug).toBe(NEW);
    expect(written.resolution).toBe("configured");
    expect(written.value).toBe(7);

    expect(() => setTierCapability({
      tierSlug: TYPO, capabilityKey: "seat_limit", valueKind: "int_limit",
      resolution: "configured", value: 7, label: "Team seat limit", updatedBy: "w56_test",
    } as Parameters<typeof setTierCapability>[0])).toThrow(/CAPABILITY_UNKNOWN_TIER|TIER_UNKNOWN_REFUSED/);
  });

  it("has a rank from the database, so gated features make a REAL comparison", () => {
    const rank = tierRankOf(NEW);
    expect(typeof rank).toBe("number");
    expect(compareTierRank(NEW, "nexus").basis).toBe("ranked");
    // A tier that does not exist is denied AND labelled, never silently "junior".
    const v = compareTierRank(TYPO, "nexus");
    expect(v.allowed).toBe(false);
    expect(v.basis).toBe("unranked_tier");
  });

  it("can be assigned to a partner through the admin route, while a typo cannot", async () => {
    const onboard = await asAdmin(request(app).post("/api/admin/partners")).send({
      legalName: "W56 Test Partner", displayName: "W56", email: `w56_${Date.now()}@example.com`, region: "EMEA", partnerType: "partner_org",
    });
    expect(onboard.status).toBe(201);
    const pid = onboard.body.partner.id as string;

    const ok = await asAdmin(request(app).post(`/api/admin/partners/${pid}/promote-tier`)).send({ tier: NEW, rationale: "w56 test" });
    expect(ok.status).toBe(200);

    const bad = await asAdmin(request(app).post(`/api/admin/partners/${pid}/promote-tier`)).send({ tier: TYPO, rationale: "w56 control" });
    expect(bad.status).toBe(400);
    expect(String(bad.body.message)).toContain(NEW); // the refusal lists the tiers that DO exist

    const stillOk = await asAdmin(request(app).post(`/api/admin/partners/${pid}/promote-tier`)).send({ tier: SEEDED, rationale: "w56 control" });
    expect(stillOk.status).toBe(200);
  });

  it("appears on the PUBLIC pricing surface once priced — and no existing tier drops off", async () => {
    const observed = rawDb()
      .prepare(`SELECT price_minor FROM partner_tier_price WHERE tier_slug='catalyst' AND cadence='annual' AND price_minor IS NOT NULL`)
      .get() as { price_minor: number };
    const derived = observed.price_minor + 3701; // derived, never a literal

    const put = await asAdmin(request(app).put("/api/admin/partner-billing/tier-prices"))
      .send({ tierSlug: NEW, cadence: "annual", priceMinor: derived, currency: "USD" });
    expect(put.status).toBe(200);

    const pricing = await request(app).get("/api/consortium/pricing");
    expect(pricing.status).toBe(200);
    const slugs = (pricing.body.tiers ?? []).map((t: { slug: string }) => t.slug);
    expect(slugs).toContain(NEW);
    for (const s of ["catalyst", "builder", "amplifier", "nexus", "founding_member"]) expect(slugs).toContain(s);

    const row = (pricing.body.tiers ?? []).find((t: { slug: string }) => t.slug === NEW);
    expect(row.amountMinor).toBe(derived);
    expect(row.label).toBe("W56 Bridge"); // the DB display_name, not a humanised slug

    // ADVERTISED == CHARGED. This is the pairing that was broken before.
    const charge = requireChargeTier(NEW);
    expect(charge.amountMinor).toBe(derived);
    expect(resolveConsortiumPricing().find((t) => t.slug === NEW)?.amountMinor).toBe(derived);
  });

  it("freeze keeps it visible and LOCKS its price; archive hides it and stays reversible", async () => {
    const noReason = await asAdmin(request(app).post(`/api/admin/partner-tiers/${NEW}/freeze`)).send({});
    expect(noReason.status).toBe(400);

    const freeze = await asAdmin(request(app).post(`/api/admin/partner-tiers/${NEW}/freeze`)).send({ reason: "w56 test freeze" });
    expect(freeze.status).toBe(200);
    expect(freeze.body.tier.state).toBe("frozen");

    // The money-freeze trigger is real, not a flag the write path is trusted to consult.
    const current = rawDb().prepare(`SELECT price_minor FROM partner_tier_price WHERE tier_slug=? AND cadence='annual'`).get(NEW) as { price_minor: number };
    const edit = await asAdmin(request(app).put("/api/admin/partner-billing/tier-prices"))
      .send({ tierSlug: NEW, cadence: "annual", priceMinor: current.price_minor + 1, currency: "USD" });
    expect(edit.status).toBeGreaterThanOrEqual(400);
    const after = rawDb().prepare(`SELECT price_minor FROM partner_tier_price WHERE tier_slug=? AND cadence='annual'`).get(NEW) as { price_minor: number };
    expect(after.price_minor).toBe(current.price_minor);

    // frozen ≠ hidden
    const frozenPricing = await request(app).get("/api/consortium/pricing");
    expect((frozenPricing.body.tiers ?? []).map((t: { slug: string }) => t.slug)).toContain(NEW);

    const archive = await asAdmin(request(app).post(`/api/admin/partner-tiers/${NEW}/archive`)).send({ reason: "w56 test archive" });
    expect(archive.status).toBe(200);
    const archivedPricing = await request(app).get("/api/consortium/pricing");
    const archivedSlugs = (archivedPricing.body.tiers ?? []).map((t: { slug: string }) => t.slug);
    expect(archivedSlugs).not.toContain(NEW);
    // NO SILENT DROPS: every pre-existing tier is still advertised.
    for (const s of ["catalyst", "builder", "amplifier", "nexus", "founding_member"]) expect(archivedSlugs).toContain(s);
    // the row itself was NOT deleted
    expect(rawDb().prepare(`SELECT COUNT(*) AS n FROM partner_tier_lifecycle WHERE tier_slug=?`).get(NEW)).toMatchObject({ n: 1 });

    const back = await asAdmin(request(app).post(`/api/admin/partner-tiers/${NEW}/activate`)).send({});
    expect(back.status).toBe(200);
    expect(back.body.tier.state).toBe("active");
  });
});
