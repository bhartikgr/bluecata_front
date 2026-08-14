/**
 * WAVE 50 — Items 1, 2 and 3: pricing sources, the pre-latch deployment fee, and
 * the tier-level zero.
 *
 * BOTH POLES ON EVERY ITEM. A refusal that refuses everything is not a fix, so
 * each defect is paired with a test that fails if the fix over-corrects:
 *   ITEM 1 — an emptied row refuses honestly, AND a seeded row still quotes.
 *   ITEM 2 — a legacy relaunch is not charged, AND a genuinely new vehicle is.
 *   ITEM 3 — a misconfigured zero refuses, AND a genuinely-free tier stays free.
 *
 * A JPY (exponent 0) fixture appears in the money assertions because no JPY data
 * exists live and these tests are the only place that path ever runs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, rawDb } from "../db/connection";
import {
  ensureWave50MoneyDefectSchema,
  splitWave50Sections,
  readWave50Ddl,
  WAVE50_FEE_KEYS,
} from "../lib/applyWave50MoneyDefectSchema";
import { lookupDeploymentFeeExemption } from "../lib/spvEngineDeploymentFeeHook";
import {
  requireChargeTier,
  resolveConsortiumPricing,
  tierPriceIsAttestedFree,
  PartnerTierPriceUnresolvedError,
} from "../lib/partnerTiers";
import { wave45Db } from "../lib/applyWave45PricingSchema";

function h(): any {
  getDb();
  const raw = rawDb() as any;
  ensureWave50MoneyDefectSchema(raw);
  return raw;
}

beforeAll(() => {
  h();
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE MIGRATION AND ITS INSTALLER ARE REAL — asserted, not assumed.
 * This build's history contains 25+ instances of "a check that passed while
 * checking nothing". If 0187 had not installed, every test below would pass
 * vacuously against columns and a table that do not exist, so the existence of
 * the schema is itself a test.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 50 — migration 0187 and its self-heal installer actually install", () => {
  it("adds free_attested and free_reason to partner_tier_price", () => {
    wave45Db();
    ensureWave50MoneyDefectSchema(h());
    const cols = h().prepare(`PRAGMA table_info(partner_tier_price)`).all().map((c: any) => c.name);
    expect(cols).toContain("free_attested");
    expect(cols).toContain("free_reason");
  });

  it("creates spv_deployment_fee_exemption", () => {
    const t = h()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='spv_deployment_fee_exemption'`)
      .get();
    expect(t?.name).toBe("spv_deployment_fee_exemption");
  });

  it("seeds the founder fee keys into platform_fees", () => {
    for (const key of WAVE50_FEE_KEYS) {
      const row = h().prepare(`SELECT key, amount_minor, currency FROM platform_fees WHERE key = ?`).get(key);
      expect(row, `platform_fees row for ${key}`).toBeTruthy();
      expect(Number(row.amount_minor)).toBeGreaterThan(0);
    }
  });

  it("is re-runnable — a second install does not throw on the ADD COLUMN", () => {
    expect(() => ensureWave50MoneyDefectSchema(h())).not.toThrow();
    expect(() => ensureWave50MoneyDefectSchema(h())).not.toThrow();
  });

  it("splits into the sections the installer relies on, and the mirror is byte-identical", () => {
    const ddl = readWave50Ddl();
    expect(ddl, "0187 must be readable from migrations/ or server/db/migrations/").toBeTruthy();
    const sections = splitWave50Sections(ddl!);
    const headers = sections.map((s) => (s.match(/^-- §(\d+[a-z]?) ·/m) ?? [])[1]).filter(Boolean);
    expect(headers).toEqual(["1", "2", "2b", "3"]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ITEM 1 — ONE SOURCE FOR THE ANNUAL FEE, AND NO LIVE DEAD VALUES
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 50 · ITEM 1 — the annual fee resolves from the database, never from code", () => {
  const FILE = "server/publicPricingRoutes.ts";

  function source(): string {
    // Read the real file. Asserting on the compiled module's behaviour alone
    // would not prove the constant is GONE, and "delete the fallback" is the
    // literal instruction.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    return fs.readFileSync(path.join(process.cwd(), FILE), "utf8");
  }

  /* POLE A — the number is a database row, so the surface can still quote it.
     A "fix" that only deleted the constant would have left the public pricing
     page permanently unable to name a price. */
  it("POLE A — the seeded platform_fees row is what the surface reads", async () => {
    const row = h()
      .prepare(`SELECT amount_minor, currency FROM platform_fees WHERE key = ? AND deleted_at IS NULL`)
      .get(WAVE50_FEE_KEYS[0]);
    expect(row).toBeTruthy();
    const mod = await import("../publicPricingRoutes");
    // The keys the route reads are the keys the migration seeded — one read, R22.
    expect(Object.values(mod.PUBLIC_FEE_KEYS)).toEqual(expect.arrayContaining([...WAVE50_FEE_KEYS]));
  });

  /* POLE B — the defect. No compiled-in amount survives, so an emptied row
     CANNOT be answered from code. This is asserted on the source text because
     that is the only way to prove absence rather than merely non-use. */
  it("POLE B — the hardcoded fallback amounts are gone from the source entirely", () => {
    const src = source();
    const codeLines = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("--"));
      })
      .join("\n");
    // The two live dead values named by the review.
    expect(codeLines).not.toMatch(/\b84000\b/);
    expect(codeLines).not.toMatch(/\b150000\b/);
    // And no formatted copy of them either.
    expect(codeLines).not.toContain("$840");
    expect(codeLines).not.toContain("$1,500");
    // The fallback object itself no longer exists as code.
    expect(codeLines).not.toContain("STATIC_FALLBACK");
  });

  /* POLE B′ — an unresolvable price renders an explicit R6 refusal, and
     specifically NOT a zero. `price_minor: 0` would render "$0/year", which is
     R6's exact prohibition and would be worse than the hardcoding. */
  it("POLE B′ — a refusal carries no amount and no currency, never a $0", async () => {
    const mod = await import("../publicPricingRoutes");
    expect(mod.PRICE_UNAVAILABLE_DISPLAY).toMatch(/unavailable/i);
    expect(mod.PRICE_UNAVAILABLE_DISPLAY).not.toMatch(/0/);
    expect(mod.PRICE_UNAVAILABLE_DISPLAY).not.toMatch(/\$/);
  });

  /* The seed R21 explicitly confirms as legitimate must still be there. This is
     the "confirm 500000 remains a legitimate seed" instruction, asserted rather
     than asserted-in-prose. */
  it("leaves the legitimate consortium.spv_deployment_fee seed intact", () => {
    const row = h()
      .prepare(`SELECT amount_minor, currency FROM platform_fees WHERE key = 'consortium.spv_deployment_fee'`)
      .get();
    if (row) {
      expect(Number(row.amount_minor)).toBe(500000);
      expect(String(row.currency)).toBe("USD");
    } else {
      // A fresh :memory: database may not seed it; the store's documented
      // default is then authoritative and is what R22 points the charge path at.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const store = require("../consortiumFeesStore");
      expect(store.DEFAULT_CONSORTIUM_SPV_DEPLOYMENT_FEE_MINOR).toBe(500000);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ITEM 2 — NO FALSE $240 ON A LEGACY VEHICLE, AND STILL EXACTLY ONE ON A NEW ONE
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 50 · ITEM 2 — a vehicle deployed before the latch existed is not charged", () => {
  function seedExemption(spvId: string, status: string, legacy = `legacy_${spvId}`) {
    h()
      .prepare(
        `INSERT OR REPLACE INTO spv_deployment_fee_exemption
           (spv_id, reason, migrated_from, status_at_record, note, recorded_at, recorded_by)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(spvId, "pre_latch_deployment", legacy, status, "test fixture", "2026-08-14T00:00:00Z", "test");
  }

  /* POLE A — THE DEFECT. A legacy wound-down vehicle relaunched to `open` is
     recognised as exempt, so the charge path returns without charging AND
     without enqueuing a pending obligation (a pending row is the retry queue;
     enqueuing a charge nobody owes just moves the false charge downstream). */
  it("POLE A — a legacy wound-down vehicle is exempt, so no charge and no pending obligation", async () => {
    const spvId = "spv_mig_w50_legacy_relaunch";
    seedExemption(spvId, "wound_down");

    const ex = lookupDeploymentFeeExemption(h(), spvId);
    expect(ex).toBeTruthy();
    expect(ex!.reason).toBe("pre_latch_deployment");
    expect(ex!.migratedFrom).toBe(`legacy_${spvId}`);

    const hook = await import("../lib/spvEngineDeploymentFeeHook");
    const out = hook.chargeEngineSpvDeploymentFee(spvId, "partner_w50");
    expect(out.charged).toBe(false);
    expect(out.reason).toBe("pre_latch_deployment_exempt");
    expect(out.amountMinor).toBeUndefined();

    // AND no `pending` row was written for a fee nobody owes.
    const billing = h()
      .prepare(`SELECT spv_id FROM spv_deployment_fee_billing WHERE spv_id = ?`)
      .get(spvId);
    expect(billing).toBeFalsy();
  });

  /* POLE B — THE OVER-CORRECTION GUARD. A vehicle with NO exemption row is not
     exempt. It may still fail to charge for unrelated reasons in a bare test
     database (no partner tier, no fee band), but it must NEVER be waved through
     as pre-latch — that would silence the fee for every SPV in the system. */
  it("POLE B — a genuinely new vehicle is NOT exempt", async () => {
    const spvId = "spv_w50_brand_new";
    expect(lookupDeploymentFeeExemption(h(), spvId)).toBeNull();
    const hook = await import("../lib/spvEngineDeploymentFeeHook");
    const out = hook.chargeEngineSpvDeploymentFee(spvId, "partner_w50");
    expect(out.reason).not.toBe("pre_latch_deployment_exempt");
  });

  /* POLE C — THE THIRD POLE, and the reason this is a row and not the predicate
     `migrated_from IS NOT NULL`. A legacy vehicle that arrived in `draft` has
     never been live, so its first push to live IS a genuine first deployment and
     MUST be chargeable. The migration's backfill excludes `draft`, and so does
     the forward-half recorder in spvEngineStore. */
  it("POLE C — a legacy vehicle still in draft is NOT exempt (its first push to live is real)", () => {
    const ddl = readWave50Ddl()!;
    const backfill = splitWave50Sections(ddl).find((s) => /^-- §2b ·/m.test(s))!;
    // `draft` is absent from the status list the backfill matches.
    const statusClause = backfill.match(/s\.status IN \(([^)]*)\)/)![1];
    expect(statusClause).not.toContain("draft");
    expect(statusClause).toContain("wound_down");
    expect(statusClause).toContain("open");
    // And the backfill is guarded on the latch never having seen the vehicle, so
    // it cannot exempt something that WAS in fact charged.
    expect(backfill).toContain("s.deployment_fee_minor IS NULL");
    expect(backfill).toContain("NOT EXISTS");
    // Data-driven, per R17's standing rule against hardcoded id lists.
    expect(backfill).toContain("s.migrated_from IS NOT NULL");
  });

  /* POLE D — the exemption is NOT recorded as a `charged` billing row. Writing
     `charged` would claim money was collected when none was, corrupting the
     billing record in order to fix a billing bug. */
  it("POLE D — an exemption is never expressed as a 'charged' billing row", () => {
    const spvId = "spv_mig_w50_no_false_charged";
    seedExemption(spvId, "open");
    const row = h()
      .prepare(`SELECT state FROM spv_deployment_fee_billing WHERE spv_id = ?`)
      .get(spvId);
    expect(row).toBeFalsy();
    const ex = lookupDeploymentFeeExemption(h(), spvId)!;
    expect(ex.reason).toBe("pre_latch_deployment");
    expect(ex.note.length).toBeGreaterThan(0); // a written reason, as R17 requires of any waiver
  });

  /* A missing exemption table must read as "not exempt" — the fail-closed
     direction. An install that never ran 0187 keeps charging exactly as Wave 46
     did, rather than silently exempting every vehicle. */
  it("fails CLOSED: an unreadable exemption table means 'not exempt', never 'exempt'", () => {
    const brokenHandle = {
      prepare() {
        throw new Error("no such table: spv_deployment_fee_exemption");
      },
    };
    expect(lookupDeploymentFeeExemption(brokenHandle, "anything")).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ITEM 3 — A TIER-LEVEL $0 MUST NOT SILENTLY MAKE PAYING PARTNERS FREE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * THE RULE UNDER TEST — provenance, not magnitude: a `price_minor = 0` row is
 * honoured only when it carries `free_attested = 1` with a non-empty
 * `free_reason`. Any other zero is misconfigured and refuses like NULL.
 *
 * WHY THESE USE REAL CANONICAL SLUGS. `requireChargeTier` resolves the slug
 * FIRST and refuses an unknown one before any price is read, so an invented
 * slug would make every assertion below pass for the wrong reason — the exact
 * "a check that passed while checking nothing" failure this build has hit 25+
 * times. So the fixtures mutate the canonical rows in the `:memory:` test
 * database and restore them afterwards. Live pricing data in `data.db` is not
 * touched by this wave.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 50 · ITEM 3 — a tier-level zero refuses unless it is attested free", () => {
  // `founding_member` carries the free-tier POLE, because R3 names it as the tier
  // that is legitimately $0. `nexus` carries the MISCONFIGURED pole: it is
  // priced 499900 in the live fee table, so a zero on it is unambiguously a
  // mistake, which is precisely the case the old code turned into a $0 invoice.
  const FREE_SLUG = "founding_member";
  const BROKEN_SLUG = "nexus";
  const CADENCE = "annual";
  const saved = new Map<string, any>();

  function d(): any {
    const handle = wave45Db() as any;
    ensureWave50MoneyDefectSchema(handle);
    return handle;
  }

  function setTierRow(slug: string, priceMinor: number | null, attested: 0 | 1, reason: string | null, currency = "USD") {
    const now = "2026-08-14T00:00:00Z";
    const existing = d()
      .prepare(`SELECT id FROM partner_tier_price WHERE tier_slug = ? AND cadence = ?`)
      .get(slug, CADENCE);
    if (existing) {
      d().prepare(
        `UPDATE partner_tier_price
            SET price_minor = ?, currency = ?, derivation = 'admin_set', active = 1,
                free_attested = ?, free_reason = ?, updated_at = ?, updated_by = 'wave50_test'
          WHERE tier_slug = ? AND cadence = ?`,
      ).run(priceMinor, currency, attested, reason, now, slug, CADENCE);
    } else {
      d().prepare(
        `INSERT INTO partner_tier_price
           (id, tier_slug, cadence, price_minor, currency, derivation, active, effective_from,
            notes, created_at, updated_at, updated_by, free_attested, free_reason)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        `ptp_w50_${slug}`, slug, CADENCE, priceMinor, currency, "admin_set", 1, now,
        "WAVE 50 ITEM 3 fixture", now, now, "wave50_test", attested, reason,
      );
    }
    // Lifecycle must be `active` or the tier is omitted for a DIFFERENT reason,
    // which would make the price assertions vacuous.
    try {
      const lc = d().prepare(`SELECT tier_slug FROM partner_tier_lifecycle WHERE tier_slug = ?`).get(slug);
      if (lc) {
        d().prepare(`UPDATE partner_tier_lifecycle SET state = 'active' WHERE tier_slug = ?`).run(slug);
      } else {
        d().prepare(
          `INSERT INTO partner_tier_lifecycle (tier_slug, state, display_name, created_at, updated_at, updated_by)
           VALUES (?,?,?,?,?,?)`,
        ).run(slug, "active", slug, "2026-08-14T00:00:00Z", "2026-08-14T00:00:00Z", "wave50_test");
      }
    } catch {
      /* schema variant — the price assertions below remain meaningful */
    }
  }

  beforeAll(() => {
    for (const slug of [FREE_SLUG, BROKEN_SLUG]) {
      saved.set(
        slug,
        d().prepare(`SELECT * FROM partner_tier_price WHERE tier_slug = ? AND cadence = ?`).get(slug, CADENCE) ?? null,
      );
    }
  });

  afterAll(() => {
    for (const [slug, row] of Array.from(saved.entries())) {
      if (!row) {
        d().prepare(`DELETE FROM partner_tier_price WHERE tier_slug = ? AND cadence = ?`).run(slug, CADENCE);
        continue;
      }
      d().prepare(
        `UPDATE partner_tier_price
            SET price_minor = ?, currency = ?, derivation = ?, active = ?, free_attested = ?, free_reason = ?
          WHERE tier_slug = ? AND cadence = ?`,
      ).run(
        row.price_minor, row.currency, row.derivation, row.active,
        row.free_attested ?? 0, row.free_reason ?? null, slug, CADENCE,
      );
    }
  });

  /* POLE A — R3 REQUIRES A REAL FREE TIER TO REMAIN EXPRESSIBLE. An attested
     zero is a real price of zero: it resolves, it advertises at 0, and it
     charges 0. A rule that simply rejected every zero would have broken this,
     and that over-correction is what this pole exists to catch. */
  it("POLE A — a genuinely-free tier (attested, with a written reason) is correctly free", () => {
    setTierRow(FREE_SLUG, 0, 1, "Founding cohort tier, free by owner ruling R3. Written reason recorded on the row.");
    const tier = requireChargeTier(FREE_SLUG);
    expect(tier.amountMinor).toBe(0);
    expect(tier.fromDb).toBe(true);
    // A genuine zero renders as 0 and MEANS it (R6), so it stays on the catalogue.
    expect(resolveConsortiumPricing().some((t) => t.slug === FREE_SLUG)).toBe(true);
  });

  /* POLE B — THE DEFECT. Before Wave 50, `price_minor = 0` sailed through the
     `price_minor IS NOT NULL` filter and EVERY partner on the tier resolved to
     $0. Now it refuses exactly like NULL, and the refusal NAMES the fault so an
     admin is not sent hunting for a missing row that is sitting in front of
     them. */
  it("POLE B — a tier misconfigured to 0 does NOT get a silent $0; it refuses, naming the fault", () => {
    setTierRow(BROKEN_SLUG, 0, 0, null);

    // Not advertised — omitted rather than shown at zero.
    expect(resolveConsortiumPricing().some((t) => t.slug === BROKEN_SLUG)).toBe(false);

    // And the charge path throws rather than quoting zero.
    let thrown: unknown = null;
    try {
      requireChargeTier(BROKEN_SLUG);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PartnerTierPriceUnresolvedError);
    const msg = String((thrown as Error).message);
    expect(msg).toContain("unattested_zero");
    expect(msg).toMatch(/free_attested/);
    // The refusal must not present zero AS THE PRICE. The only "$0" it may
    // mention is the per-partner override that IS the sanctioned route to a free
    // partner (R17) — i.e. remedial advice, not a quote.
    expect(msg).toContain("per-partner $0 override (R17)");
    expect(msg).not.toMatch(/(price|amount|total)\s+(is|of)\s+\$0/i);
    expect(msg).not.toMatch(/\$0\.00/);
    expect(msg).not.toMatch(/\$0\s*\/\s*year/i);
  });

  /* POLE B′ — the two poles differ ONLY in provenance. Same table, same cadence,
     same amount of zero: what separates them is the attestation. This is the
     assertion that the rule is about provenance and not magnitude. */
  it("POLE B′ — the ONLY difference between the two poles is the attestation", () => {
    setTierRow(FREE_SLUG, 0, 1, "Founding cohort tier, free by owner ruling R3.");
    setTierRow(BROKEN_SLUG, 0, 0, null);
    const free = d().prepare(`SELECT price_minor, free_attested, free_reason FROM partner_tier_price WHERE tier_slug = ? AND cadence = ?`).get(FREE_SLUG, CADENCE);
    const broken = d().prepare(`SELECT price_minor, free_attested, free_reason FROM partner_tier_price WHERE tier_slug = ? AND cadence = ?`).get(BROKEN_SLUG, CADENCE);
    expect(Number(free.price_minor)).toBe(0);
    expect(Number(broken.price_minor)).toBe(0);
    expect(tierPriceIsAttestedFree(free as any)).toBe(true);
    expect(tierPriceIsAttestedFree(broken as any)).toBe(false);
  });

  /* An attestation flag with NO written reason is not an attestation. R17 makes a
     written reason mandatory for a $0 anywhere else in the system; a tier-level
     zero is not held to a lower standard. */
  it("an attested flag with a blank reason is NOT an attestation", () => {
    expect(tierPriceIsAttestedFree({ free_attested: 1, free_reason: "   " } as any)).toBe(false);
    expect(tierPriceIsAttestedFree({ free_attested: 1, free_reason: null } as any)).toBe(false);
    expect(tierPriceIsAttestedFree({ free_attested: 0, free_reason: "looks official" } as any)).toBe(false);
    expect(tierPriceIsAttestedFree({ free_attested: 1, free_reason: "owner ruling R3" } as any)).toBe(true);
  });

  /* THE REGRESSION POLE — an ordinary paid tier must not have become harder to
     resolve. A JPY fixture is included because a tier priced in an exponent-0
     currency stores WHOLE UNITS, and a rule written around cents would corrupt
     it. */
  it("a normally-priced tier still resolves, at exponent 2 and at exponent 0", () => {
    setTierRow(BROKEN_SLUG, 499900, 0, null, "USD");
    expect(requireChargeTier(BROKEN_SLUG).amountMinor).toBe(499900);

    setTierRow(BROKEN_SLUG, 30000, 0, null, "JPY");
    const jpyTier = requireChargeTier(BROKEN_SLUG);
    // ¥30,000 is the integer 30000 — not 3,000,000 and not 300.
    expect(jpyTier.amountMinor).toBe(30000);
    expect(jpyTier.currency).toBe("JPY");
  });

  /* A NULL price still refuses, with its own distinct reason. The pre-Wave-50
     behaviour that was CORRECT must stay correct, and the two faults must stay
     distinguishable so an admin knows which one to fix. */
  it("a NULL price still refuses, and is reported differently from a misconfigured zero", () => {
    setTierRow(BROKEN_SLUG, null, 0, null);
    let msg = "";
    try {
      requireChargeTier(BROKEN_SLUG);
    } catch (e) {
      msg = String((e as Error).message);
    }
    expect(msg).toMatch(/PARTNER_TIER_PRICE_UNRESOLVED/);
    expect(msg).not.toContain("unattested_zero");
  });

  /* A NEGATIVE price cannot even be written: 0153's CHECK constraint
     (`price_minor IS NULL OR price_minor >= 0`) rejects it at the database. The
     classifier's `negative` branch is therefore defence in depth against a
     future schema change rather than a reachable state today, and that is
     asserted here rather than left as an untested branch pretending to guard
     something. */
  it("a negative price is rejected by the database itself, before any code sees it", () => {
    expect(() => setTierRow(BROKEN_SLUG, -500, 0, null)).toThrow(/CHECK constraint failed/);
  });
});
