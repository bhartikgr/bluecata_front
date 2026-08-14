/**
 * WAVE 45 — PRICING MODEL v3 (owner ruling R3, 2026-08-13).
 *
 * Everything the ruling requires is PROVEN BY EXECUTION here, not asserted in a
 * report. Each fix asserts BOTH POLES: a pricing change that refused everything
 * would sail through a one-sided test and stop all revenue, so every refusal
 * test is paired with a proof that the paying path still works.
 *
 * COVERAGE
 *   GAP 1  the DB is the only source of a price; empty the table and the system
 *          refuses instead of quoting the old compiled-in $499.
 *   GAP 2  capability is data, and unlimited / zero / unset are three
 *          DISTINGUISHABLE things. Getting this backwards locks partners out of
 *          their own accounts, so it is tested from both directions.
 *   GAP 3  three-state lifecycle. Freeze genuinely blocks a price edit (proven
 *          against the database, not against a flag a write path might ignore),
 *          archived vanishes from the catalogue while history still resolves,
 *          and deleting a tier is REFUSED with an explanation.
 *   CONFIG reverting to monthly/tiered pricing is configuration, not a rewrite.
 *   MONEY  integer minor units, and a JPY fixture (exponent 0) so a stray /100
 *          or *100 on this path would show up as a wrong number.
 *   R16    percent stored AS WRITTEN: 5 means 5%.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getDb, rawDb } from "../db/connection";
import {
  applyWave45PricingSchema,
  readWave45PricingDdl,
  WAVE45_TABLES,
  WAVE45_TRIGGERS,
} from "../lib/applyWave45PricingSchema";
import { readWave5MoneyDdl } from "../lib/applyWave5MoneySchema";
import {
  PARTNER_TIERS,
  resolveConsortiumPricing,
  resolveChargeTier,
  requireChargeTier,
  assertTierPurchasable,
  resolveHistoricalTier,
  readPricingModelConfig,
  purchasableCadences,
  PartnerTierPriceUnresolvedError,
} from "../lib/partnerTiers";
import {
  resolveTierCapability,
  setTierCapability,
  isWithinLimit,
  describeCapability,
  resolveEffectiveSeatCapability,
  listAllCapabilities,
  CapabilityError,
  CAPABILITY_SEAT_LIMIT,
  CAPABILITY_LIVE_SPV_LIMIT,
} from "../lib/partnerTierCapabilityStore";
import { formatMinor } from "../lib/money";
import { resolvePartnerEffectivePlan } from "../lib/partnerEffectivePlan";
import { resolveAnnualAmountMinor } from "../lib/partnerBillingStore";

const NOW = "2026-08-14T00:00:00Z";
/** $240.00 USD. The owner's number, in integer minor units. */
const FLAT_ANNUAL_MINOR = 24000;

function db(): any {
  getDb();
  const h = rawDb() as any;
  applyWave45PricingSchema(h);
  return h;
}

/**
 * Restore the migrations' SHIPPED state between tests.
 *
 * Some tests below deliberately destroy pricing data — the gap-1 proof empties
 * `partner_tier_price` entirely to show the system refuses instead of quoting a
 * compiled-in number. Rebuilding by hand from literals in this file would
 * quietly re-pin the very numbers under test, so instead the ORIGINAL migration
 * DDL is re-executed. 0153 and 0185 are both idempotent (IF NOT EXISTS /
 * INSERT OR IGNORE / ON CONFLICT DO NOTHING), so re-running them restores the
 * shipped rows — including the sixteen taxonomy-B rows — from the same source of
 * truth production uses, not from a copy.
 */
function restoreShippedState(): void {
  const h = db();
  // Lifecycle first: a frozen tier left over from a previous test would make the
  // price triggers reject the restore itself.
  h.prepare(`UPDATE partner_tier_lifecycle SET state='active', state_reason=NULL`).run();
  h.prepare(`DELETE FROM partner_tier_price`).run();
  h.prepare(`DELETE FROM partner_tier_capability WHERE capability_key LIKE 'probe_%'`).run();

  const wave5 = readWave5MoneyDdl();
  const wave45 = readWave45PricingDdl();
  // If either DDL cannot be read, fail loudly. Silently continuing would leave
  // every assertion below measuring an empty database.
  if (!wave5 || !wave45) {
    throw new Error(
      "WAVE45 TEST FIXTURE: could not read migration 0153 and/or 0185 DDL; " +
        "the suite would otherwise pass vacuously against missing rows.",
    );
  }
  h.exec(wave5);
  h.exec(wave45);
  // Capability rows are re-seeded by 0185's INSERT OR IGNORE only when absent;
  // an edited row must be put back explicitly.
  for (const [slug, value] of [["catalyst", 2], ["builder", 10], ["amplifier", 25]] as const) {
    h.prepare(
      `UPDATE partner_tier_capability SET resolution='configured', int_value=?, updated_at=?
        WHERE tier_slug=? AND capability_key='seat_limit'`,
    ).run(value, NOW, slug);
  }
  for (const slug of ["nexus", "founding_member"]) {
    h.prepare(
      `UPDATE partner_tier_capability SET resolution='unlimited', int_value=NULL, updated_at=?
        WHERE tier_slug=? AND capability_key='seat_limit'`,
    ).run(NOW, slug);
  }
  h.prepare(
    `UPDATE partner_pricing_model_config
        SET model='flat_annual', monthly_purchasable=0, annual_purchasable=1,
            forbid_x12_derivation=1, updated_at=?
      WHERE id='singleton'`,
  ).run(NOW);
}

beforeAll(() => {
  db();
});
beforeEach(() => {
  restoreShippedState();
});

describe("WAVE 45 · migration 0185 installs its tables AND its triggers", () => {
  it("creates every table and every trigger — the triggers ARE the enforcement", () => {
    const h = db();
    for (const t of WAVE45_TABLES) {
      const row = h.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
      expect(row?.name, `table ${t} missing — every Wave 45 assertion below would be vacuous`).toBe(t);
    }
    // A trigger silently lost to a statement splitter would turn "freeze blocks
    // a price edit" into a decorative flag, so presence is asserted, not assumed.
    for (const t of WAVE45_TRIGGERS) {
      const row = h.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name=?`).get(t);
      expect(row?.name, `trigger ${t} missing — a real control would be decorative`).toBe(t);
    }
  });

  it("leaves all sixteen taxonomy-B rows untouched (no mapping was guessed)", () => {
    // The eight orphan slugs from migration 0153 are an OPEN owner question
    // (OQ-W45-1). Merging them by guesswork would corrupt billing, so this wave
    // must be able to prove it changed none of them.
    const h = db();
    const row = h
      .prepare(
        `SELECT count(*) AS n, sum(price_minor IS NULL) AS unpriced
           FROM partner_tier_price
          WHERE tier_slug IN ('accelerator','boutique','enterprise','founder_free',
                              'growth','professional','starter','syndicate')`,
      )
      .get() as { n: number; unpriced: number };
    expect(row.n).toBe(16);
    expect(row.unpriced).toBe(14); // only founder_free monthly+annual are priced, at 0
  });

  it("refuses to key a capability on a taxonomy-B slug", () => {
    expect(() =>
      setTierCapability({
        tierSlug: "growth",
        capabilityKey: "seat_limit",
        valueKind: "int_limit",
        resolution: "configured",
        value: 5,
        label: "Team seat limit",
        updatedBy: "test",
      }),
    ).toThrow(/CAPABILITY_UNKNOWN_TIER/);
  });
});

describe("WAVE 45 · GAP 1 — the DB is the ONLY source of a price", () => {
  it("POSITIVE POLE: a new partner is quoted exactly $240.00/yr from a DB row", () => {
    const pricing = resolveConsortiumPricing();
    expect(pricing.length).toBe(5);
    for (const t of pricing) {
      expect(t.amountMinor).toBe(FLAT_ANNUAL_MINOR);
      expect(formatMinor(t.amountMinor, t.currency)).toBe("$240.00");
      expect(t.billingPeriod).toBe("annual");
      // Never a 12x derivation — an annual price the owner set must be admin_set.
      expect(t.derivation).toBe("admin_set");
      expect(t.fromDb).toBe(true);
    }
    expect(requireChargeTier("catalyst").amountMinor).toBe(FLAT_ANNUAL_MINOR);
    // Advertised == charged, through the same function.
    expect(resolveChargeTier("catalyst")!.amountMinor).toBe(
      resolveConsortiumPricing().find((t) => t.slug === "catalyst")!.amountMinor,
    );
  });

  it("legacy partner_* aliases still resolve to a canonical priced tier", () => {
    // The positive pole for back-compat: retiring the old ladder must not break
    // an existing alias.
    expect(requireChargeTier("partner_basic").slug).toBe("catalyst");
    expect(requireChargeTier("partner_enterprise").slug).toBe("amplifier");
    expect(requireChargeTier("partner_basic").amountMinor).toBe(FLAT_ANNUAL_MINOR);
  });

  it("NEGATIVE POLE: empty the price table and the system REFUSES — it does not quote $499", () => {
    const h = db();
    h.prepare(`DELETE FROM partner_tier_price`).run();
    expect(h.prepare(`SELECT count(*) AS n FROM partner_tier_price`).get().n).toBe(0);

    // The catalogue is empty rather than populated from constants.
    expect(resolveConsortiumPricing()).toEqual([]);
    expect(resolveChargeTier("nexus")).toBeNull();

    // And a path that MUST produce a price throws, naming what to fix.
    let caught: unknown;
    try {
      requireChargeTier("nexus");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PartnerTierPriceUnresolvedError);
    expect((caught as PartnerTierPriceUnresolvedError).code).toBe("PARTNER_TIER_PRICE_UNRESOLVED");
    expect((caught as Error).message).toMatch(/no compiled-in price/);

    // THE POINT: the pre-Wave-45 code returned nexus fallbackMinor = 499900 here.
    // Nothing in the build can produce that number from an empty table any more.
    expect(String((caught as Error).message)).not.toMatch(/499900|4,999|499\.00/);
  });

  it("NO compiled-in amount can satisfy a price read: the tier defs carry no numbers", () => {
    for (const def of PARTNER_TIERS) {
      for (const [key, value] of Object.entries(def)) {
        expect(typeof value, `PARTNER_TIERS.${def.slug}.${key} is numeric`).not.toBe("number");
      }
    }
  });

  it("MONEY · JPY fixture (exponent 0): the integer is never divided or multiplied", () => {
    const h = db();
    h.prepare(`DELETE FROM partner_tier_price WHERE tier_slug='catalyst' AND cadence='annual'`).run();
    h.prepare(
      `INSERT INTO partner_tier_price (id,tier_slug,cadence,price_minor,currency,derivation,active,created_at,updated_at)
       VALUES ('ptp_jpy','catalyst','annual',24000,'JPY','admin_set',1,?,?)`,
    ).run(NOW, NOW);
    const t = requireChargeTier("catalyst");
    // 24000 JPY minor units is 24,000 yen because JPY has exponent 0. If anything
    // on this path did a /100 it would read 240 and this assertion would fail.
    expect(t.amountMinor).toBe(24000);
    expect(t.currency).toBe("JPY");
    expect(formatMinor(t.amountMinor, "JPY")).toBe("¥24,000");
    // Same integer, different currency, different human value — proof the number
    // is carried, not converted.
    expect(formatMinor(24000, "USD")).toBe("$240.00");
  });
});

describe("WAVE 45 · GAP 2 — capability is data, and unlimited/zero/unset are distinguishable", () => {
  it("seat limits come from the DB, not the deleted TIER_SEAT_LIMITS literal", () => {
    // The literal's values are preserved for the three finite tiers so no live
    // partner's cap changes on the day this ships.
    expect(resolveTierCapability("catalyst", CAPABILITY_SEAT_LIMIT).value).toBe(2);
    expect(resolveTierCapability("builder", CAPABILITY_SEAT_LIMIT).value).toBe(10);
    expect(resolveTierCapability("amplifier", CAPABILITY_SEAT_LIMIT).value).toBe(25);
    // ...and the 9999 sentinel becomes genuinely unlimited.
    const nexus = resolveTierCapability("nexus", CAPABILITY_SEAT_LIMIT);
    expect(nexus.resolution).toBe("unlimited");
    expect(nexus.value).toBeNull();
    expect(describeCapability(nexus)).toBe("Unlimited");
  });

  it("THE THREE-WAY DISTINCTION: 0 means zero, unlimited means no cap, unset means unknown", () => {
    // ZERO — a real, enforced limit of zero.
    const zero = setTierCapability({
      tierSlug: "catalyst",
      capabilityKey: "probe_zero",
      valueKind: "int_limit",
      resolution: "configured",
      value: 0,
      label: "Probe",
      updatedBy: "test",
    });
    expect(zero.resolution).toBe("configured");
    expect(zero.value).toBe(0);
    expect(describeCapability(zero)).toBe("0");
    expect(isWithinLimit(zero, 0).within).toBe(false); // zero forbids everything
    expect(isWithinLimit(zero, 0).reason).toMatch(/CAPABILITY_LIMIT_ZERO/);

    // UNLIMITED — no cap at all, at any usage level.
    const unl = setTierCapability({
      tierSlug: "catalyst",
      capabilityKey: "probe_unlimited",
      valueKind: "int_limit",
      resolution: "unlimited",
      label: "Probe",
      updatedBy: "test",
    });
    expect(unl.value).toBeNull();
    expect(isWithinLimit(unl, 0).within).toBe(true);
    expect(isWithinLimit(unl, 1_000_000).within).toBe(true);

    // NOT CONFIGURED — unknown. R6: never silently rendered or treated as 0.
    const unset = resolveTierCapability("catalyst", CAPABILITY_LIVE_SPV_LIMIT);
    expect(unset.resolution).toBe("not_configured");
    expect(unset.value).toBeNull();
    expect(describeCapability(unset)).toBe("Not configured");
    expect(isWithinLimit(unset, 0).within).toBe(false);
    expect(isWithinLimit(unset, 0).reason).toMatch(/CAPABILITY_NOT_CONFIGURED/);

    // The three are mutually distinguishable — the whole requirement.
    const kinds = new Set([zero.resolution, unl.resolution, unset.resolution]);
    expect(kinds.size).toBe(3);
    // And "zero" is never confusable with "unlimited" in either direction.
    expect(isWithinLimit(zero, 5).within).toBe(false);
    expect(isWithinLimit(unl, 5).within).toBe(true);
  });

  it("refuses to store a value that contradicts its own resolution", () => {
    // A leftover number on an unlimited row is exactly how "unlimited" silently
    // becomes a ceiling, so the store refuses before the DB CHECK does.
    expect(() =>
      setTierCapability({
        tierSlug: "catalyst",
        capabilityKey: "probe_bad1",
        valueKind: "int_limit",
        resolution: "unlimited",
        value: 5,
        label: "Probe",
        updatedBy: "test",
      }),
    ).toThrow(/CAPABILITY_VALUE_FORBIDDEN/);

    expect(() =>
      setTierCapability({
        tierSlug: "catalyst",
        capabilityKey: "probe_bad2",
        valueKind: "int_limit",
        resolution: "configured",
        value: null,
        label: "Probe",
        updatedBy: "test",
      }),
    ).toThrow(/CAPABILITY_VALUE_REQUIRED/);

    // And the DB enforces the same invariant underneath the store.
    const h = db();
    expect(() =>
      h
        .prepare(
          `INSERT INTO partner_tier_capability (id,tier_slug,capability_key,value_kind,resolution,int_value,label,created_at,updated_at)
           VALUES ('raw1','catalyst','probe_raw','int_limit','unlimited',5,'Probe',?,?)`,
        )
        .run(NOW, NOW),
    ).toThrow(/CHECK constraint failed/);
  });

  it("is admin-editable, and an edit is visible on the next read", () => {
    const before = resolveTierCapability("catalyst", CAPABILITY_SEAT_LIMIT);
    expect(before.value).toBe(2);
    expect(before.editable).toBe(true);
    setTierCapability({
      tierSlug: "catalyst",
      capabilityKey: CAPABILITY_SEAT_LIMIT,
      valueKind: "int_limit",
      resolution: "configured",
      value: 7,
      label: "Team seat limit",
      updatedBy: "admin:test",
    });
    expect(resolveTierCapability("catalyst", CAPABILITY_SEAT_LIMIT).value).toBe(7);
    // Restore so later tests see the shipped value.
    setTierCapability({
      tierSlug: "catalyst",
      capabilityKey: CAPABILITY_SEAT_LIMIT,
      valueKind: "int_limit",
      resolution: "configured",
      value: 2,
      label: "Team seat limit",
      updatedBy: "admin:test",
    });
  });

  it("a per-partner override wins over the tier row, and an override of 0 means zero", () => {
    const tierOnly = resolveEffectiveSeatCapability("catalyst", null);
    expect(tierOnly.value).toBe(2);
    expect(tierOnly.source).toBe("tier");

    const overridden = resolveEffectiveSeatCapability("catalyst", JSON.stringify({ seatLimit: 40 }));
    expect(overridden.value).toBe(40);
    expect(overridden.source).toBe("partner_override");

    // An override of 0 is a real decision and must not fall through to the tier.
    const zeroed = resolveEffectiveSeatCapability("catalyst", JSON.stringify({ seatLimit: 0 }));
    expect(zeroed.value).toBe(0);
    expect(zeroed.source).toBe("partner_override");
    expect(isWithinLimit(zeroed, 0).within).toBe(false);

    // Malformed json must never break seat resolution (it gates partner login).
    expect(resolveEffectiveSeatCapability("catalyst", "{not json").value).toBe(2);
    expect(resolveEffectiveSeatCapability("catalyst", JSON.stringify({ seatLimit: -1 })).value).toBe(2);
  });

  it("R16 · percent is stored AS WRITTEN — 5 means 5%, with no conversion", () => {
    const cap = setTierCapability({
      tierSlug: "nexus",
      capabilityKey: "probe_commission",
      valueKind: "percent_as_written",
      resolution: "configured",
      percentValue: 5,
      label: "Commission rate",
      updatedBy: "test",
    });
    expect(cap.percentValue).toBe(5); // not 0.05, and not 500
    expect(describeCapability(cap)).toBe("5%");
    // A fraction-style input is out of range for percent-as-written only at the
    // top end; 0.05 is accepted as 0.05% and must NOT be silently read as 5%.
    const frac = setTierCapability({
      tierSlug: "nexus",
      capabilityKey: "probe_commission_frac",
      valueKind: "percent_as_written",
      resolution: "configured",
      percentValue: 0.05,
      label: "Commission rate",
      updatedBy: "test",
    });
    expect(frac.percentValue).toBe(0.05);
    expect(describeCapability(frac)).toBe("0.05%");
    expect(() =>
      setTierCapability({
        tierSlug: "nexus",
        capabilityKey: "probe_commission_bad",
        valueKind: "percent_as_written",
        resolution: "configured",
        percentValue: 101,
        label: "Commission rate",
        updatedBy: "test",
      }),
    ).toThrow(/CAPABILITY_VALUE_REQUIRED/);
  });

  it("every one of the five tiers has a capability matrix an admin can enumerate", () => {
    const all = listAllCapabilities();
    const bySlug = new Set(all.map((c) => c.tierSlug));
    for (const slug of ["catalyst", "builder", "amplifier", "nexus", "founding_member"]) {
      expect(bySlug.has(slug)).toBe(true);
    }
    expect(all.some((c) => c.capabilityKey === CAPABILITY_SEAT_LIMIT)).toBe(true);
    expect(all.some((c) => c.capabilityKey === CAPABILITY_LIVE_SPV_LIMIT)).toBe(true);
  });
});

describe("WAVE 45 · GAP 3 — three-state lifecycle; freeze and archive are different things", () => {
  function setState(slug: string, state: string, reason: string | null): void {
    db()
      .prepare(
        `UPDATE partner_tier_lifecycle
            SET state=?, state_reason=?, state_changed_at=?, updated_at=? WHERE tier_slug=?`,
      )
      .run(state, reason, NOW, NOW, slug);
  }
  function editPrice(slug: string, minor: number): void {
    db()
      .prepare(`UPDATE partner_tier_price SET price_minor=?, updated_at=? WHERE tier_slug=? AND cadence='annual'`)
      .run(minor, NOW, slug);
  }

  it("POSITIVE POLE: an ACTIVE tier is purchasable AND its price is editable", () => {
    expect(assertTierPurchasable("catalyst").amountMinor).toBe(FLAT_ANNUAL_MINOR);
    expect(() => editPrice("catalyst", 30000)).not.toThrow();
    expect(requireChargeTier("catalyst").amountMinor).toBe(30000);
  });

  it("FROZEN: cannot be purchased AND its price cannot be edited — both refused", () => {
    setState("catalyst", "frozen", "wave45 test freeze");

    // (a) purchase refused
    expect(() => assertTierPurchasable("catalyst")).toThrow(/TIER_NOT_PURCHASABLE/);

    // (b) price edit refused — by the DATABASE, so no write path can forget to
    //     check. This is the difference between a control and a flag.
    expect(() => editPrice("catalyst", 99999)).toThrow(/TIER_FROZEN_PRICE_IMMUTABLE/);
    // Inserting a fresh price row for a frozen tier is refused too, so freeze
    // cannot be sidestepped by writing a new row instead of updating one.
    expect(() =>
      db()
        .prepare(
          `INSERT INTO partner_tier_price (id,tier_slug,cadence,price_minor,currency,derivation,active,created_at,updated_at)
           VALUES ('ptp_sneak','catalyst','quarterly',12345,'USD','admin_set',1,?,?)`,
        )
        .run(NOW, NOW),
    ).toThrow(/TIER_FROZEN_PRICE_IMMUTABLE/);

    // The price is UNCHANGED by the refused attempts, and still readable for the
    // existing subscribers a freeze is designed to protect.
    expect(resolveHistoricalTier("catalyst")!.amountMinor).toBe(FLAT_ANNUAL_MINOR);

    // Returning it to active restores both capabilities — freeze is reversible.
    setState("catalyst", "active", null);
    expect(() => editPrice("catalyst", FLAT_ANNUAL_MINOR)).not.toThrow();
    expect(assertTierPurchasable("catalyst").amountMinor).toBe(FLAT_ANNUAL_MINOR);
  });

  it("ARCHIVED: vanishes from the front end, but historical invoices still resolve name AND price", () => {
    setState("builder", "archived", "wave45 test archive");

    // Gone from every advertised surface.
    expect(resolveConsortiumPricing().map((t) => t.slug)).not.toContain("builder");
    expect(resolveChargeTier("builder")).toBeNull();
    expect(() => assertTierPurchasable("builder")).toThrow();

    // But an invoice issued last year must still render. Both name and price.
    const hist = resolveHistoricalTier("builder");
    expect(hist).not.toBeNull();
    expect(hist!.label).toBe("Builder");
    expect(hist!.amountMinor).toBe(FLAT_ANNUAL_MINOR);
    expect(formatMinor(hist!.amountMinor as number, hist!.currency)).toBe("$240.00");
    expect(hist!.lifecycleState).toBe("archived");
  });

  it("DELETING a referenced tier is REFUSED with an explanation — never silently ignored", () => {
    let msg = "";
    try {
      db().prepare(`DELETE FROM partner_tier_lifecycle WHERE tier_slug='catalyst'`).run();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/TIER_DELETE_REFUSED/);
    // The explanation must actually explain, and point at the alternative.
    expect(msg).toMatch(/historical invoices/i);
    expect(msg).toMatch(/[Aa]rchive/);
    // And the tier is still there — the refusal was real, not cosmetic.
    expect(
      db().prepare(`SELECT count(*) AS n FROM partner_tier_lifecycle WHERE tier_slug='catalyst'`).get().n,
    ).toBe(1);
  });

  it("a non-active state REQUIRES a written reason", () => {
    // An unexplained freeze is indistinguishable from a bug.
    expect(() => setState("nexus", "frozen", null)).toThrow(/CHECK constraint failed/);
    expect(() => setState("nexus", "frozen", "explained")).not.toThrow();
  });
});

describe("WAVE 45 · reverting to tiered / monthly pricing is CONFIGURATION, not a rewrite", () => {
  it("ships annual-only, and monthly is retired but NOT deleted", () => {
    const cfg = readPricingModelConfig();
    expect(cfg.model).toBe("flat_annual");
    expect(cfg.annualPurchasable).toBe(true);
    expect(cfg.monthlyPurchasable).toBe(false);
    expect(cfg.forbidX12Derivation).toBe(true);
    expect(purchasableCadences()).toEqual(["annual"]);

    // The monthly ROWS still exist for all five tiers — retired, not deleted.
    const n = db()
      .prepare(
        `SELECT count(*) AS n FROM partner_tier_price
          WHERE cadence='monthly'
            AND tier_slug IN ('catalyst','builder','amplifier','nexus','founding_member')`,
      )
      .get().n;
    expect(n).toBe(5);
  });

  it("enable a monthly price -> the purchase path works; disable it -> it stops. No code change.", () => {
    const h = db();
    // 1. Enable monthly purchase and price it. Two data writes, zero edits.
    h.prepare(`UPDATE partner_pricing_model_config SET monthly_purchasable=1, annual_purchasable=0, model='tiered', updated_at=? WHERE id='singleton'`).run(NOW);
    h.prepare(
      `UPDATE partner_tier_price SET price_minor=2000, derivation='admin_set', active=1, updated_at=?
        WHERE tier_slug='catalyst' AND cadence='monthly'`,
    ).run(NOW);

    expect(purchasableCadences()).toEqual(["monthly"]);
    const monthly = requireChargeTier("catalyst");
    expect(monthly.billingPeriod).toBe("monthly");
    expect(monthly.amountMinor).toBe(2000);
    expect(formatMinor(monthly.amountMinor, "USD")).toBe("$20.00");
    // A genuinely TIERED ladder is expressible again: different tiers, different
    // prices, which is the thing R3 retired rather than removed.
    h.prepare(`UPDATE partner_tier_price SET price_minor=5000, derivation='admin_set', active=1 WHERE tier_slug='nexus' AND cadence='monthly'`).run();
    expect(requireChargeTier("nexus").amountMinor).toBe(5000);
    expect(requireChargeTier("catalyst").amountMinor).toBe(2000);

    // 2. Disable it again — back to annual-only.
    h.prepare(`UPDATE partner_pricing_model_config SET monthly_purchasable=0, annual_purchasable=1, model='flat_annual', updated_at=? WHERE id='singleton'`).run(NOW);
    expect(purchasableCadences()).toEqual(["annual"]);
    expect(requireChargeTier("catalyst").amountMinor).toBe(FLAT_ANNUAL_MINOR);
    expect(requireChargeTier("catalyst").billingPeriod).toBe("annual");
  });

  it("the one-time SPV fee row exists at $240.00 with cadence 'one_time'", () => {
    const rows = db()
      .prepare(
        `SELECT tier_slug, price_minor, currency, derivation FROM partner_tier_price
          WHERE cadence='one_time'
            AND tier_slug IN ('catalyst','builder','amplifier','nexus','founding_member')`,
      )
      .all() as { price_minor: number; currency: string; derivation: string }[];
    expect(rows.length).toBe(5);
    for (const r of rows) {
      expect(r.price_minor).toBe(FLAT_ANNUAL_MINOR); // the same $240.00
      expect(formatMinor(r.price_minor, r.currency)).toBe("$240.00");
      expect(r.derivation).toBe("admin_set");
    }
  });
});

describe("WAVE 45 · CP-SUB-19 is closed by R3", () => {
  it("the open annual-pricing-model decision is recorded as owner_closed, citing R3", () => {
    const row = db()
      .prepare(`SELECT ruling_status, notes, decided_by FROM percent_policy_record WHERE id='ppr_annual_pricing_model'`)
      .get() as { ruling_status: string; notes: string; decided_by: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.ruling_status).toBe("owner_closed");
    expect(row!.decided_by).toMatch(/R3/);
    // The original question text is preserved next to its answer rather than
    // overwritten, so the history of the decision stays readable.
    expect(row!.notes).toMatch(/CP-SUB-19/);
    expect(row!.notes).toMatch(/RESOLVED BY R3/);
  });
});

describe("WAVE 45 · the capability store never throws where it would break login", () => {
  it("an unknown capability key resolves to not_configured rather than throwing", () => {
    // A capability read happens on every seat check; an exception there would
    // take down partner login, so absence is data, not an error.
    const cap = resolveTierCapability("catalyst", "no_such_capability");
    expect(cap.resolution).toBe("not_configured");
    expect(cap.missingRow).toBe(true);
    expect(describeCapability(cap)).toBe("Not configured");
  });

  it("but an unknown TIER on the WRITE path is a loud error", () => {
    // Writing is admin-initiated and rare; failing loudly there is correct.
    expect(
      () =>
        setTierCapability({
          tierSlug: "not_a_tier",
          capabilityKey: "seat_limit",
          valueKind: "int_limit",
          resolution: "configured",
          value: 1,
          label: "x",
          updatedBy: "test",
        }),
    ).toThrow(CapabilityError);
  });
});

describe("WAVE 45 · GRANDFATHERING is data, not a hardcoded list of partner ids", () => {
  /**
   * The owner's founding partners pay $0 permanently. The mechanism is the
   * ALREADY-FAIL-CLOSED override path in partnerEffectivePlan.ts, which documents
   * that "an explicit $0 override is the ONLY way effectivePrice becomes 0".
   *
   * Two things are deliberately NOT done here:
   *   • no live partner id is grandfathered. The roster has TWELVE partners, most
   *     of them test accounts, and which of them are founding partners is an OPEN
   *     owner question. The mechanism is proven on a FIXTURE partner instead, and
   *     applying it stays a deliberate admin action.
   *   • no code branch and no id list. A reader looking for "why is this partner
   *     free" finds a row with a written reason, not an `if`.
   */
  const FIXTURE_FREE = "ct_w45_fixture_grandfathered";
  const FIXTURE_PAYING = "ct_w45_fixture_paying";
  const REASON = "founding partner, grandfathered 2026-08-13 by owner ruling";

  function seedFixturePartners(): void {
    const h = db();
    for (const [id, override] of [
      [FIXTURE_FREE, JSON.stringify({ subscription_annual: { amountMinor: 0, currency: "USD" } })],
      [FIXTURE_PAYING, null],
    ] as const) {
      h.prepare(
        `INSERT INTO contacts
           (id, kind, legal_name, fee_override_json, created_at, updated_at,
            created_by, updated_by, prev_revision_hash, revision_hash)
         VALUES (?, 'consortium_partner', ?, ?, ?, ?, 'wave45_test', 'wave45_test', '', ?)
         ON CONFLICT (id) DO UPDATE SET fee_override_json = excluded.fee_override_json, deleted_at = NULL`,
      ).run(id, id, override, NOW, NOW, `rh_${id}`);
    }
    h.prepare(
      `INSERT INTO partner_grandfather_grant
         (id, partner_id, reason, ruling_ref, granted_by, granted_at, created_at, updated_at)
       VALUES (?, ?, ?, 'OWNER_RULINGS_2026_08_13#R3', 'owner_ruling_R3', ?, ?, ?)
       ON CONFLICT (partner_id) WHERE revoked_at IS NULL
         DO UPDATE SET reason = excluded.reason`,
    ).run(`pgg_${FIXTURE_FREE}`, FIXTURE_FREE, REASON, NOW, NOW, NOW);
  }

  it("BOTH POLES: the grandfathered fixture is charged $0; an ordinary partner is charged $240.00", () => {
    seedFixturePartners();

    // NEGATIVE-COST POLE — free, and only because of an explicit $0 override.
    const free = resolvePartnerEffectivePlan(FIXTURE_FREE, "catalyst" as any, { cycle: "annual" });
    expect(free.effectivePrice.amountMinor).toBe(0);
    expect(free.effectivePrice.source).toBe("partner_override");
    expect(formatMinor(free.effectivePrice.amountMinor, free.effectivePrice.currency)).toBe("$0.00");

    // POSITIVE POLE — the revenue path is intact. This is the assertion that
    // stops "everything is free" from passing as a success.
    const paying = resolvePartnerEffectivePlan(FIXTURE_PAYING, "catalyst" as any, { cycle: "annual" });
    expect(paying.effectivePrice.amountMinor).toBe(FLAT_ANNUAL_MINOR);
    expect(paying.effectivePrice.source).toBe("tier_advertised");
    expect(formatMinor(paying.effectivePrice.amountMinor, paying.effectivePrice.currency)).toBe("$240.00");
  });

  it("the REASON is recorded and readable — a free partner is never unexplained", () => {
    seedFixturePartners();
    const grant = db()
      .prepare(`SELECT partner_id, reason, granted_by FROM partner_grandfather_grant WHERE partner_id = ?`)
      .get(FIXTURE_FREE) as { reason: string; granted_by: string };
    expect(grant.reason).toBe(REASON);
    expect(grant.granted_by).toBe("owner_ruling_R3");
    // The table cannot hold an unexplained grant.
    expect(() =>
      db()
        .prepare(
          `INSERT INTO partner_grandfather_grant
             (id,partner_id,reason,ruling_ref,granted_by,granted_at,created_at,updated_at)
           VALUES ('pgg_blank','ct_blank','','R3','x',?,?,?)`,
        )
        .run(NOW, NOW, NOW),
    ).toThrow(/CHECK constraint failed/);
  });

  it("NO live partner id is grandfathered by this migration", () => {
    // A migration that picked partners for the owner would be the wrong kind of
    // decision to encode. Only fixtures created by tests may appear here.
    const rows = db()
      .prepare(`SELECT partner_id FROM partner_grandfather_grant WHERE partner_id NOT LIKE 'ct_w45_fixture%'`)
      .all() as { partner_id: string }[];
    expect(rows).toEqual([]);
  });
});

describe("WAVE 45 · the x12 annual derivation can no longer fire for a real tier", () => {
  it("every canonical tier resolves annual from an admin_set ROW, never from 12x monthly", () => {
    // The contradiction: annual used to be computed as 12x the monthly price, so
    // catalyst would have billed $5,988.00 instead of $240.00. 0185 gives all five
    // tiers a directly-set annual row, which takes precedence, so the derivation
    // is unreachable for anything a partner can actually buy.
    for (const slug of ["catalyst", "builder", "amplifier", "nexus", "founding_member"]) {
      const r = resolveAnnualAmountMinor(slug, 49900 /* the old monthly, deliberately hostile */);
      expect(r.amountMinor, `${slug} annual`).toBe(FLAT_ANNUAL_MINOR);
      expect(r.derivation).toBe("tier_price_row");
      expect(r.usedLegacyFallback).toBe(false);
      // Explicitly NOT 12x anything.
      expect(r.amountMinor).not.toBe(49900 * 12);
      expect(formatMinor(r.amountMinor, r.currency)).toBe("$240.00");
    }
  });

  it("and the config records that a x12 derivation is forbidden", () => {
    expect(readPricingModelConfig().forbidX12Derivation).toBe(true);
  });
});
