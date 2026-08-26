/**
 * WAVE 152 · BATCH 2 · ITEM G — THE PRICING MODEL, PINNED AT THE PLACE THAT CHARGES.
 *
 * WHY THIS FILE EXISTS, AND WHAT THE PREVIOUS SPECS GOT WRONG.
 *
 * Three earlier attempts at item G proposed setting the SPV launch fee in
 * `partner_tier_price` at cadence `one_time`. A docblock said that was the
 * source. It was not: `partner_tier_price` appears NOWHERE in the live charge
 * path, and no non-test code reads cadence `one_time` at all. The real chain is
 *
 *   spvEngineStore (push-to-live)
 *     → spvEngineDeploymentFeeHook.chargeEngineSpvDeploymentFee (:383)
 *     → spvDeploymentFee.chargeSpvDeploymentFee (:96)
 *     → spvDeploymentFeeSource.resolveSpvDeploymentFee (:247)
 *     → requireAuthoritativeSpvDeploymentFee (:194)
 *     → SELECT * FROM platform_fees WHERE key = 'consortium.spv_deployment_fee'
 *
 * and that row held 500000 ($5,000.00). Had the earlier spec shipped, an
 * administrator would have set $240.00, seen $240.00 confirmed on screen, and
 * every partner would have been charged $5,000.00 — a 20× overcharge, invisible
 * to the person who set the price.
 *
 * SO THE PIN IN §1 IS NOT "a table contains 24000". It is: THE AMOUNT AN ADMIN
 * SETS THROUGH THE ADMIN API IS THE AMOUNT THE PARTNER IS CHARGED, measured by
 * calling the real hook and reading the real ledger row. A table-contents
 * assertion would have passed against the $5,000 defect.
 *
 * §2 pins THE $840 COLLISION (R115.1). $840.00/yr is BOTH the Consortium Partner
 * account fee (`partner_tier_price`, tier `catalyst`, cadence `annual`) AND the
 * Capavate founder annual price (`platform_fees.founder.capavate_annual`). Two
 * products, two tables, two screens, one amount. A test that asserts either one
 * "is 84000" cannot fail when they are swapped, because both are 84000 — so
 * §2 uses DISTINCT SENTINEL AMOUNTS per source and asserts each reader returns
 * ITS OWN source's sentinel. That test fails if the wiring is crossed. §2.3 then
 * proves independence directly: change one, and the other does not move.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { getDb, rawDb } from "../db/connection";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerAdminPlatformFeesRoutes } from "../adminPlatformFeesRoutes";
import { registerWave14MoneyRoutes } from "../lib/wave14MoneyRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { chargeEngineSpvDeploymentFee } from "../lib/spvEngineDeploymentFeeHook";
import {
  AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY,
  resolveAuthoritativeSpvDeploymentFee,
  readAuthoritativeSpvDeploymentFeeRow,
} from "../lib/spvDeploymentFeeSource";
import {
  resolveTierPrice,
  setTierPrice,
  resolveAnnualAmountMinor,
  tierPriceCoverage,
} from "../lib/partnerBillingStore";
import { resolveHistoricalTier } from "../lib/partnerTiers";
import { getFee, listFees, setFee } from "../platformFeesStore";
import { resolvePublicPricingPayload } from "../publicPricingRoutes";
import { resolveCanonicalMemberTier } from "../lib/collectiveMemberSubscriptionResolver";
import { ensureWave50MoneyDefectSchema } from "../lib/applyWave50MoneyDefectSchema";
import { ensureWave45PricingSchema } from "../lib/applyWave45PricingSchema";
import fs from "node:fs";
import path from "node:path";

const MANAGING = "u_avi_managing";
const ADMIN = "u_admin";
const PARTNER = "ac_consortium_partner_test_partner_inc";

/** The Capavate FOUNDER annual price. A DIFFERENT PRODUCT from the partner fee. */
const FOUNDER_ANNUAL_KEY = "founder.capavate_annual";
const ACADEMY_KEY = "founder.academy_one_time";

let app: express.Express;

function db(): any {
  getDb();
  return rawDb() as any;
}

const post = (path: string, user: string, body: unknown) =>
  request(app).post(path).set("x-user-id", user).send(body);
const put = (path: string, user: string, body: unknown) =>
  request(app).put(path).set("x-user-id", user).send(body);
const get = (path: string, user: string) => request(app).get(path).set("x-user-id", user);

/** Create a real SPV through the real partner route, returning its id. */
async function createSpv(name: string): Promise<string> {
  const created = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "per_deployment",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.spv.id as string;
}

/** The ledger row the partner is actually billed from. */
function billedMinor(spvId: string): { commission_minor: number; computed_via: string | null } | undefined {
  return db()
    .prepare(
      `SELECT commission_minor, computed_via
         FROM partner_billing_entries
        WHERE spv_fund_id = ? AND entry_kind = 'spv_deployment_fee'`,
    )
    .get(spvId);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerAdminPlatformFeesRoutes(app);
  registerWave14MoneyRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();

  /* R117.3(1) — the eight `partner_fee_schedules` rows are all tier NULL /
     amount 0, and a banded row with a NON-NULL tier silently outranks the
     authoritative fee at spvDeploymentFeeSource.ts:265-273. This test must
     measure the AUTHORITATIVE path, so any tiered band left behind by another
     test file in this database is removed first. Seeding one would re-create the
     exact override defect item G exists to fix. */
  db().prepare(`DELETE FROM partner_fee_schedules WHERE tier IS NOT NULL`).run();

  /* The money-column installers this repo already uses to keep a fresh test
     database in step with migrations 0185 and 0187. Without them
     `partner_tier_price` has no `free_attested` column and every attestation
     assertion below fails for a schema reason rather than a behaviour one. */
  ensureWave45PricingSchema(db());
  ensureWave50MoneyDefectSchema(db());

  /* FIXTURE, NOT PRODUCT. The live database carries both founder rows
     (`founder.capavate_annual` = 84000, `founder.academy_one_time` = 150000);
     a fresh test database carries neither. Seeding them here keeps §2 measuring
     the WIRING rather than the absence of a row, and does not invent a price on
     any real deployment, where both rows already exist. */
  for (const [key, minor, period] of [
    [FOUNDER_ANNUAL_KEY, 84_000, "annual"],
    [ACADEMY_KEY, 150_000, "one_time"],
  ] as [string, number, string][]) {
    db()
      .prepare(
        `INSERT INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period)
         VALUES (?, ?, 'USD', ?, 'wave152_test_fixture', ?)
         ON CONFLICT(key) DO UPDATE SET amount_minor = excluded.amount_minor, deleted_at = NULL`,
      )
      .run(key, minor, new Date().toISOString(), period);
  }
});

afterAll(() => {
  /* Leave the fee at the ruled amount rather than at whatever the last test
     wrote, so a later file in the same database is not handed a sentinel. */
  try {
    setFee({ key: AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY, amountMinor: 24_000, currency: "USD", updatedByUserId: "wave152_test_cleanup" });
  } catch {
    /* the store reports failure by return value; nothing to do here */
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * §0 — MIGRATION 0200 ITSELF: VALID SQL, TWICE-RUNNABLE, AND THE RULED AMOUNTS
 *
 * `npm run db:migrate` records applied ids in `__drizzle_migrations_applied`, so
 * re-running the RUNNER is a no-op by bookkeeping. That proves the runner, not
 * the migration. Executing the file's own SQL twice against this database proves
 * the STATEMENTS are idempotent on their own terms — which is what matters if
 * anyone ever replays it, or runs it against a database whose bookkeeping table
 * was rebuilt.
 * ══════════════════════════════════════════════════════════════════════════ */
const MIGRATION_0200 = "0200_batch2_g_r110_charge_path_prices_and_zero_flags.sql";

describe("WAVE 152 §0 — migration 0200 applies, re-applies, and sets the ruled prices", () => {
  it("G-T1: the migration exists in both directories, byte-identical", () => {
    const a = fs.readFileSync(path.join(process.cwd(), "migrations", MIGRATION_0200));
    const b = fs.readFileSync(path.join(process.cwd(), "server", "db", "migrations", MIGRATION_0200));
    expect(a.equals(b), "id >= 0068 must be byte-mirrored into server/db/migrations").toBe(true);
  });

  it("G-T2: every DATA statement in it is re-runnable, and a second pass changes nothing", () => {
    /* SQLite has no `ADD COLUMN IF NOT EXISTS`, so a migration's ALTERs can only
       ever run once; the repo relies on the runner's `__drizzle_migrations_applied`
       ledger for that, and this test does not pretend otherwise. What IS asserted
       is the part that would corrupt money if it were not idempotent: every
       UPSERT and UPDATE in the file must produce the same rows on a second pass.
       A migration that, say, ADDED $240 rather than SETTING it would fail here. */
    const raw = fs.readFileSync(path.join(process.cwd(), "migrations", MIGRATION_0200), "utf8");
    /* Comments are stripped BEFORE splitting: this migration's comments explain
       the $5,000 defect in prose, and prose contains semicolons. Splitting first
       would hand SQLite half a sentence. */
    const stripped = raw
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
    const statements = stripped
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.length > 0 && !/^--/.test(x))
      .filter((x) => !/ADD\s+COLUMN/i.test(x));
    expect(statements.length, "migration 0200 must carry data statements, not only DDL").toBeGreaterThan(0);
    const sql = statements.join(";\n") + ";";
    const snapshot = () =>
      JSON.stringify({
        fees: db().prepare(`SELECT key, amount_minor, intentional_zero FROM platform_fees ORDER BY key`).all(),
        tiers: db()
          .prepare(`SELECT tier_slug, cadence, price_minor, active FROM partner_tier_price ORDER BY tier_slug, cadence`)
          .all(),
      });

    db().exec(sql);
    const first = snapshot();
    db().exec(sql);
    const second = snapshot();
    expect(second, "the second application of migration 0200 must be a no-op").toBe(first);
  });

  it("G-T3: after the migration, the ruled amounts are on the rows that are read", () => {
    /* R110 — $240.00 on the charge path, $840.00/yr for a partner account. */
    expect(readAuthoritativeSpvDeploymentFeeRow()?.amount_minor).toBe(24_000);
    expect(resolveTierPrice("catalyst", "annual")?.priceMinor).toBe(84_000);
    /* R110.3 — `founder_free` is retired from the PARTNER ladder: it is a
       Capavate founder concept and had no business being read as a partner price. */
    const ff = db()
      .prepare(`SELECT active FROM partner_tier_price WHERE tier_slug = 'founder_free'`)
      .all() as { active: number }[];
    for (const r of ff) expect(Number(r.active)).toBe(0);
    /* No non-test code reads cadence `one_time`; the rows are deactivated so a
       future reader cannot pick up a stale SPV-launch figure from the wrong table. */
    const oneTime = db()
      .prepare(`SELECT active FROM partner_tier_price WHERE cadence = 'one_time'`)
      .all() as { active: number }[];
    for (const r of oneTime) expect(Number(r.active)).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §1 — G-T4, THE MANDATORY PIN: CHARGED == SET, THROUGH THE REAL HOOK
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 152 §1 — the amount an admin SETS is the amount a partner is CHARGED", () => {
  it("G-T4a: charges exactly the ruled $240.00 (24000) after an admin sets it through the admin API", async () => {
    const set = await put(`/api/admin/platform-fees/${AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY}`, ADMIN, {
      amountMinor: 24_000,
      currency: "USD",
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    const spvId = await createSpv("W152 charged equals set 240");
    const result = chargeEngineSpvDeploymentFee(spvId, PARTNER);
    const billed = billedMinor(spvId);
    expect(billed, `a spv_deployment_fee ledger row must exist; hook said ${JSON.stringify(result)}`).toBeTruthy();
    /* THE ASSERTION THAT WOULD HAVE CAUGHT THE $5,000 DEFECT. */
    expect(billed!.commission_minor).toBe(24_000);
    /* And it says WHERE it came from, so a future banded override is visible in
       the ledger rather than silent. */
    expect(String(billed!.computed_via ?? "")).toBe("platform_fee_authoritative");
  });

  it("G-T4b: FOLLOWS the admin to a different amount — the pin is the wiring, not the number", async () => {
    /* A single-value test cannot distinguish "reads the row the admin wrote"
       from "happens to hold 24000 for some other reason". Setting a value no
       seed, migration or default anywhere in this tree carries makes the link
       between the write and the charge the only explanation. */
    const SENTINEL = 31_337;
    const set = await put(`/api/admin/platform-fees/${AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY}`, ADMIN, {
      amountMinor: SENTINEL,
      currency: "USD",
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    const spvId = await createSpv("W152 charged equals set sentinel");
    chargeEngineSpvDeploymentFee(spvId, PARTNER);
    const billed = billedMinor(spvId);
    expect(billed, "a spv_deployment_fee ledger row must exist").toBeTruthy();
    expect(billed!.commission_minor).toBe(SENTINEL);

    /* restore the ruled amount for the rest of the file */
    await put(`/api/admin/platform-fees/${AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY}`, ADMIN, {
      amountMinor: 24_000,
      currency: "USD",
    });
  });

  it("G-T4c: the authoritative key is the one the resolver reads, and it is NOT partner_tier_price", () => {
    expect(AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY).toBe("consortium.spv_deployment_fee");
    const row = readAuthoritativeSpvDeploymentFeeRow();
    expect(row, "the authoritative platform_fees row must exist").toBeTruthy();
    const resolved = resolveAuthoritativeSpvDeploymentFee();
    expect(resolved?.amountMinor).toBe(24_000);
    /* And the table three earlier specs believed was the source is NOT consulted:
       cadence `one_time` is retired from reads by migration 0200. */
    expect(resolveTierPrice("catalyst", "one_time")).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §2 — THE $840 COLLISION (R115.1). READ BY KEY, NEVER BY AMOUNT.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 152 §2 — two products share $840.00 and must never be confused", () => {
  it("G-T5a: SWAP TEST — distinct sentinels per source, each reader returns its own", () => {
    /* THE POINT OF THE SENTINELS.
     *
     * Live, both prices are 84000. So `expect(founderPrice).toBe(84000)` and
     * `expect(partnerPrice).toBe(84000)` BOTH PASS EVEN IF THE TWO READS ARE
     * WIRED TO EACH OTHER'S SOURCE. A value-equality assertion is not a pin
     * here; it is a test that cannot fail, which R115.1 forbids as the sole
     * protection.
     *
     * Giving each source a different amount makes a crossed wire observable:
     * if the founder read ever resolves from `partner_tier_price`, or the
     * partner read from `platform_fees.founder.capavate_annual`, the sentinels
     * come back the wrong way round and this test fails. */
    const FOUNDER_SENTINEL = 71_100; // platform_fees.founder.capavate_annual
    const PARTNER_SENTINEL = 82_200; // partner_tier_price catalyst/annual

    setFee({ key: FOUNDER_ANNUAL_KEY, amountMinor: FOUNDER_SENTINEL, currency: "USD", updatedByUserId: "wave152_test" });
    setTierPrice("catalyst", "annual", PARTNER_SENTINEL, { updatedBy: "wave152_test" });

    /* The FOUNDER price, read by its purpose key. */
    const founder = getFee(FOUNDER_ANNUAL_KEY);
    expect(founder.amountMinor).toBe(FOUNDER_SENTINEL);
    expect(founder.amountMinor).not.toBe(PARTNER_SENTINEL);

    /* The PARTNER account fee, read from its own table by tier + cadence. */
    const partnerAnnual = resolveAnnualAmountMinor("catalyst", 1_000, "USD");
    expect(partnerAnnual.amountMinor).toBe(PARTNER_SENTINEL);
    expect(partnerAnnual.derivation).toBe("tier_price_row");
    expect(partnerAnnual.amountMinor).not.toBe(FOUNDER_SENTINEL);

    /* And the PUBLIC marketing read of the founder price resolves from the
       founder key, not from the partner ladder. */
    const publicPayload = resolvePublicPricingPayload();
    expect(publicPayload.capavate_annual.price_minor).toBe(FOUNDER_SENTINEL);
    expect(publicPayload.capavate_annual.price_minor).not.toBe(PARTNER_SENTINEL);
  });

  it("G-T5b: INDEPENDENCE — moving one price does not move the other, with both at $840.00", () => {
    /* Both back to the colliding live amount, which is the dangerous state. */
    setFee({ key: FOUNDER_ANNUAL_KEY, amountMinor: 84_000, currency: "USD", updatedByUserId: "wave152_test" });
    setTierPrice("catalyst", "annual", 84_000, { updatedBy: "wave152_test" });
    expect(getFee(FOUNDER_ANNUAL_KEY).amountMinor).toBe(84_000);
    expect(resolveAnnualAmountMinor("catalyst", 1_000, "USD").amountMinor).toBe(84_000);

    /* Move ONLY the founder price. */
    setFee({ key: FOUNDER_ANNUAL_KEY, amountMinor: 90_000, currency: "USD", updatedByUserId: "wave152_test" });
    expect(getFee(FOUNDER_ANNUAL_KEY).amountMinor).toBe(90_000);
    expect(
      resolveAnnualAmountMinor("catalyst", 1_000, "USD").amountMinor,
      "changing the CAPAVATE FOUNDER price must not change the CONSORTIUM PARTNER account fee",
    ).toBe(84_000);

    /* Move ONLY the partner fee. */
    setTierPrice("catalyst", "annual", 96_000, { updatedBy: "wave152_test" });
    expect(resolveAnnualAmountMinor("catalyst", 1_000, "USD").amountMinor).toBe(96_000);
    expect(
      getFee(FOUNDER_ANNUAL_KEY).amountMinor,
      "changing the CONSORTIUM PARTNER account fee must not change the CAPAVATE FOUNDER price",
    ).toBe(90_000);

    /* Restore the ruled amounts. */
    setFee({ key: FOUNDER_ANNUAL_KEY, amountMinor: 84_000, currency: "USD", updatedByUserId: "wave152_test" });
    setTierPrice("catalyst", "annual", 84_000, { updatedBy: "wave152_test" });
    expect(getFee(FOUNDER_ANNUAL_KEY).amountMinor).toBe(84_000);
    expect(resolveAnnualAmountMinor("catalyst", 1_000, "USD").amountMinor).toBe(84_000);
  });

  it("G-T5c: the partner account fee is $840.00/yr on the row the annual checkout charges from", () => {
    const row = resolveTierPrice("catalyst", "annual");
    expect(row, "catalyst/annual must be priced").toBeTruthy();
    expect(row!.priceMinor).toBe(84_000);
    expect(row!.currency).toBe("USD");
    /* R110.3 — the ladder is RETAINED and the other tiers stay unpriced rather
       than inheriting a figure nobody set. */
    for (const slug of ["builder", "amplifier", "nexus", "founding_member"]) {
      const r = resolveTierPrice(slug, "annual");
      expect(r === null || r.priceMinor === null, `${slug}/annual must not carry an invented price`).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §3 — G-C6/G-C8/G-C10: NO PRICE COMPILED INTO THE BUILD, AND ZERO ≠ ABSENT
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 152 §3 — absence is reported, never substituted", () => {
  it("G-T6: an UNATTESTED zero does not resolve as a partner price, in all three readers", () => {
    /* `founder_free` is a Capavate FOUNDER slug sitting in the PARTNER price
       table at price_minor = 0 with no attestation. Before this wave the
       catalogue reader rejected it and the BILLING reader returned it. */
    db()
      .prepare(
        `UPDATE partner_tier_price
            SET price_minor = 0, free_attested = 0, free_reason = NULL, active = 1
          WHERE tier_slug = 'founder_free' AND cadence = 'annual'`,
      )
      .run();
    expect(resolveTierPrice("founder_free", "annual")).toBeNull();
    expect(resolveHistoricalTier("founder_free", "annual")?.amountMinor ?? null).toBeNull();
  });

  it("G-T7: an ATTESTED zero IS a real free price and still resolves", () => {
    setTierPrice("founder_free", "annual", 0, {
      updatedBy: "wave152_test",
      freeAttested: true,
      freeReason: "Deliberately free: attested by the wave 152 test fixture.",
    });
    const row = resolveTierPrice("founder_free", "annual");
    expect(row, "an attested zero must resolve").toBeTruthy();
    expect(row!.priceMinor).toBe(0);
  });

  it("G-T8: setTierPrice REFUSES a zero with no attestation, in a plain sentence", () => {
    let err: Error | null = null;
    try {
      setTierPrice("builder", "monthly", 0, { updatedBy: "wave152_test" });
    } catch (e) {
      err = e as Error;
    }
    expect(err, "an unattested zero must be refused at the writer").toBeTruthy();
    expect(err!.message).toContain("ZERO_PRICE_NEEDS_ATTESTATION");
    /* R77 — a refusal is a sentence, not a bare code. */
    expect(err!.message).toMatch(/has to be declared deliberately/);
  });

  it("G-T9: platformFeesStore honours deleted_at — a retired price is not servable", () => {
    const KEY = "consortium.subscription.partner_basic";
    db()
      .prepare(
        `INSERT INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
         VALUES (?, 49900, 'USD', '2026-08-10T00:00:00.000Z', 'wave152_test', 'monthly', '2026-08-10T00:00:00.000Z')
         ON CONFLICT(key) DO UPDATE SET deleted_at = '2026-08-10T00:00:00.000Z'`,
      )
      .run(KEY);
    const fee = getFee(KEY);
    expect(fee.amountMinor, "a soft-deleted price must not be served as an amount").toBeNull();
    expect(fee.source).toBe("missing");
    expect(listFees().some((f) => f.key === KEY)).toBe(false);
  });

  it("G-T10: the Collective member price reports ABSENCE rather than a compiled-in $249.00", () => {
    const KEY = "collective.member_subscription.standard";
    const before = db().prepare(`SELECT * FROM platform_fees WHERE key = ?`).get(KEY);
    db().prepare(`DELETE FROM platform_fees WHERE key = ?`).run(KEY);
    try {
      const tier = resolveCanonicalMemberTier();
      /* The deleted `CANONICAL_MEMBER_FALLBACK_MINOR = 24900` would have made
         this a confident $249.00 with `fromDb: false`. */
      expect(tier === null || tier.amountMinor === null, "no row means no price").toBe(true);
    } finally {
      if (before) {
        db()
          .prepare(
            `INSERT INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
             VALUES (?,?,?,?,?,?,?)`,
          )
          .run(
            before.key,
            before.amount_minor,
            before.currency,
            before.updated_at,
            before.updated_by_user_id,
            before.billing_period,
            before.deleted_at,
          );
      }
    }
  });

  it("G-T11: an unconfigured zero is NOT $0.00 — it refuses; a DECLARED zero answers", () => {
    const KEY = AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY;
    const before = readAuthoritativeSpvDeploymentFeeRow();
    try {
      /* A zero that nobody declared. The old heuristic looked at
         `updated_by_user_id IS NULL`; a seed stamping 'system:seed' defeated it. */
      db()
        .prepare(
          `UPDATE platform_fees SET amount_minor = 0, updated_by_user_id = 'system:seed', intentional_zero = 0 WHERE key = ?`,
        )
        .run(KEY);
      expect(
        resolveAuthoritativeSpvDeploymentFee(),
        "a zero with no intentional_zero declaration is an absence, not a free fee",
      ).toBeNull();

      /* The same zero, DECLARED. */
      db()
        .prepare(
          `UPDATE platform_fees
              SET intentional_zero = 1,
                  intentional_zero_reason = 'wave152 test: deliberate free launch'
            WHERE key = ?`,
        )
        .run(KEY);
      const declared = resolveAuthoritativeSpvDeploymentFee();
      expect(declared, "a declared zero is a real free price and must answer").toBeTruthy();
      expect(declared!.amountMinor).toBe(0);
    } finally {
      db()
        .prepare(
          `UPDATE platform_fees
              SET amount_minor = 24000, intentional_zero = 0, intentional_zero_reason = NULL,
                  updated_by_user_id = ?
            WHERE key = ?`,
        )
        .run(before?.updated_by_user_id ?? "wave152_test", KEY);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §4 — G-C3 / G-C1 FLEXIBILITY, AND R117.3(1) STAYING FORBIDDEN
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 152 §4 — coverage reporting, the write path, and the band that must not exist", () => {
  it("G-T12: tierPriceCoverage keeps its three original fields and ADDS notOnLadder", () => {
    const c = tierPriceCoverage();
    /* Additive only — every existing consumer keeps working. */
    expect(typeof c.total).toBe("number");
    expect(typeof c.priced).toBe("number");
    expect(typeof c.unpriced).toBe("number");
    expect(Array.isArray(c.unpricedPairs)).toBe(true);
    /* The new third bucket. */
    expect(Array.isArray(c.notOnLadder)).toBe(true);
    expect(Array.isArray(c.notOnLadderTiers)).toBe(true);
    expect(c.notOnLadderNote).toMatch(/not on the ladder/i);
  });

  it("G-T13: the admin API offers every priceable tier, including ones with no row", async () => {
    const res = await get("/api/admin/partner-billing/tier-prices", ADMIN);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body.knownTiers), "knownTiers drives the add/edit form").toBe(true);
    for (const slug of ["catalyst", "builder", "amplifier", "nexus", "founding_member"]) {
      expect(res.body.knownTiers).toContain(slug);
    }
    expect(res.body.notOnLadderNote).toBeTruthy();
  });

  it("G-T14: the write route refuses a zero with no attestation, and accepts one with", async () => {
    const refused = await put("/api/admin/partner-billing/tier-prices", ADMIN, {
      tierSlug: "builder",
      cadence: "monthly",
      priceMinor: 0,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("ZERO_PRICE_NEEDS_ATTESTATION");
    expect(refused.body.message).toMatch(/declared deliberately/);

    const accepted = await put("/api/admin/partner-billing/tier-prices", ADMIN, {
      tierSlug: "builder",
      cadence: "monthly",
      priceMinor: 0,
      freeAttested: true,
      freeReason: "wave152 test: deliberate free monthly tier",
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.price.priceMinor).toBe(0);

    /* leave the row unpriced rather than free, so no later file inherits a free tier */
    await put("/api/admin/partner-billing/tier-prices", ADMIN, {
      tierSlug: "builder",
      cadence: "monthly",
      priceMinor: null,
    });
  });

  it("G-T15: R117.3(1) — no partner_fee_schedules row carries a tier, so no band can outrank the fee", () => {
    /* A banded row with a NON-NULL tier is returned at
       spvDeploymentFeeSource.ts:265-273 BEFORE the authoritative row is read.
       All 8 live rows are tier NULL / amount 0, and seeding a band would
       re-create the silent override this wave exists to remove. */
    const tiered = db()
      .prepare(`SELECT id, tier, fee_kind, amount_minor FROM partner_fee_schedules WHERE tier IS NOT NULL`)
      .all();
    expect(tiered, `a tiered band silently outranks the authoritative fee: ${JSON.stringify(tiered)}`).toEqual([]);
  });

  it("G-T16: both founder prices are read BY KEY, and an absent one reports absence", () => {
    /* R116.4 — the two Capavate founder prices now have admin editors, and both
       resolve through their own purpose key. */
    expect(getFee(ACADEMY_KEY).amountMinor).toBe(150_000);
    expect(getFee(FOUNDER_ANNUAL_KEY).amountMinor).toBe(84_000);
    /* Two DIFFERENT products, two DIFFERENT keys, two DIFFERENT amounts — and
       the Academy price is a one-time charge, not an annual one. */
    expect(getFee(ACADEMY_KEY).amountMinor).not.toBe(getFee(FOUNDER_ANNUAL_KEY).amountMinor);

    /* And a key nobody has configured reports absence rather than 0. A card
       reading `fees[key]?.amountMinor ?? 0` would render "$0.00" here, which is
       a price the platform would then be held to. */
    const absent = getFee("founder.a_price_nobody_has_set");
    expect(absent.amountMinor).toBeNull();
    expect(absent.source).toBe("missing");
  });
});
