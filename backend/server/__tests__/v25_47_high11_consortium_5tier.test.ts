/**
 * v25.47 APD-030 (HIGH-11) — Consortium Partner 5-tier taxonomy.
 *
 * Coverage:
 *   1. PARTNER_TIERS is the canonical 5-tier order and carries NO amounts.
 *
 * WAVE 45 (R3, 2026-08-13) AMENDED THIS TEST. It previously asserted
 *   expect(byslug.catalyst.fallbackMinor).toBe(49900)   ... and four more.
 * Those assertions PINNED the defect the owner ordered removed: a compiled-in
 * price that `resolveConsortiumPricing()` returned whenever the DB read came
 * back empty, so a database blip quoted $499/mo from a source-code constant.
 * The field no longer exists, so the assertions could not be kept as written.
 *
 * They are replaced by a STRICTER invariant, not a weaker one: the tier
 * definitions must contain no numeric amount of any kind. The old test admitted
 * one specific set of compiled-in prices; the new one admits none at all. The
 * refusal behaviour that replaced the fallback is proven in
 * wave45_pricing_model_v3.test.ts.
 *   2. resolvePartnerTierSlug maps legacy partner_basic/pro/enterprise → canonical.
 *   3. resolvePartnerTierSlug returns null for unknown slugs (fail-closed).
 *   4. resolveConsortiumPricing projects the AUTHORITATIVE DATABASE ROWS —
 *      amount, currency, cadence, derivation and lifecycle state — and refuses
 *      honestly when the row is gone (R6). See the Wave 51 block below.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║ WAVE 51 · ITEM 1 — WHY TEST 4 WAS REWRITTEN. THIS IS A CHANGE OF SUBJECT  ║
 * ║ UNDER R21, EXACTLY AS apd020 WAS. IT IS NOT A RE-PIN.                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * WHAT TEST 4 USED TO ASSERT, verbatim:
 *
 *     for (const t of pricing) {
 *       expect(t.amountMinor).toBe(24000);   // $240.00, flat across all five tiers
 *       expect(t.currency).toBe("USD");
 *       expect(t.billingPeriod).toBe("annual");
 *       ...
 *     }
 *
 * Its own comment described it as reading "DB amounts", and its name said
 * "every amount is DB-backed". It asserted neither. `24000` is a compiled-in
 * literal, and the test would have passed a build that ignored
 * `partner_tier_price` entirely and returned $240.00 from source. Ruling R21 is
 * explicit — "100% dynamic. Nothing static or hard coded… equally not a
 * hardcoded $240" — so, exactly as with apd020, THE EXPECTATION ITSELF WAS
 * OVERRULED, and the fix is not "the number is something else now".
 *
 * WHY THIS IS A CHANGE OF SUBJECT AND NOT A RE-PIN. Re-pinning is editing an
 * expectation until it matches the output, with the property under test
 * unchanged. Here the PROPERTY changes: the old test asserted a VALUE, the new
 * one asserts a RELATIONSHIP — the resolver's output equals what
 * `partner_tier_price` × `partner_tier_lifecycle` hold, whatever they hold —
 * and it proves that by mutating those rows and requiring the resolver to move
 * with them. Not one amount literal appears in the rewritten test.
 *
 * IT IS STRICTLY STRONGER. The old test passed for a build with $240 compiled
 * in. The new one cannot: it changes a row and demands the resolver change,
 * re-denominates a row to JPY (exponent 0) and demands the integer pass through
 * unscaled, and DELETES a row and demands a refusal that quotes no number at
 * all.
 *
 * SCOPE. This authorisation covers THIS test only. No other pinned test was
 * touched on this reasoning.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "../db/connection";
import {
  PARTNER_TIERS,
  resolvePartnerTierSlug,
  resolveConsortiumPricing,
  requireChargeTier,
  purchasableCadences,
  PartnerTierPriceUnresolvedError,
} from "../lib/partnerTiers";
/* WAVE 51 — read and mutate THE SAME rows the resolver reads, so "the surface
 * is a projection of DB state" is measured rather than assumed. */
import { wave45Db } from "../lib/applyWave45PricingSchema";
import { currencyExponent } from "../lib/currency";

beforeAll(() => {
  getDb();
});

/* ───────────────────────── authoritative-row helpers ─────────────────────────
 * Everything below reads `partner_tier_price` and `partner_tier_lifecycle`
 * directly. No expected amount, currency or cadence is written into this file.
 */
interface PriceRow {
  id: string;
  tier_slug: string;
  cadence: string;
  price_minor: number | null;
  currency: string;
  derivation: string;
  active: number;
  created_at: string;
}

/** The cadence the resolver itself will read — from config, not from a literal. */
function activeCadence(): string {
  return purchasableCadences()[0] ?? "annual";
}

function readPriceRows(cadence = activeCadence()): PriceRow[] {
  return wave45Db()
    .prepare(
      `SELECT id, tier_slug, cadence, price_minor, currency, derivation, active, created_at
         FROM partner_tier_price WHERE cadence = ? ORDER BY tier_slug`,
    )
    .all(cadence) as PriceRow[];
}

/** Lifecycle state as stored; "" when the slug has no lifecycle row at all. */
function lifecycleState(slug: string): string {
  const row = wave45Db()
    .prepare(`SELECT state FROM partner_tier_lifecycle WHERE tier_slug = ?`)
    .get(slug) as { state?: string } | undefined;
  return row?.state ?? "";
}

/**
 * The rows the resolver's OWN stated contract says are advertisable: priced,
 * active, and carrying a KNOWN non-archived lifecycle row. Derived from the DB,
 * so an admin adding or archiving a tier changes this set with no code change.
 */
function advertisableRows(cadence = activeCadence()): PriceRow[] {
  return readPriceRows(cadence).filter((r) => {
    if (r.price_minor === null || r.active !== 1) return false;
    const st = lifecycleState(r.tier_slug);
    return st !== "" && st !== "archived";
  });
}

/** Restore a snapshot exactly, so no later test inherits a mutation. */
function restorePriceRows(rows: PriceRow[]): void {
  const db = wave45Db();
  const now = new Date().toISOString();
  for (const r of rows) {
    db.prepare(
      `INSERT INTO partner_tier_price
         (id, tier_slug, cadence, price_minor, currency, derivation, active, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tier_slug = excluded.tier_slug, cadence = excluded.cadence,
         price_minor = excluded.price_minor, currency = excluded.currency,
         derivation = excluded.derivation, active = excluded.active,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).run(
      r.id, r.tier_slug, r.cadence, r.price_minor, r.currency,
      r.derivation, r.active, r.created_at, now, "wave51:item1-restore",
    );
  }
}

describe("APD-030 consortium 5-tier taxonomy", () => {
  it("exposes the canonical 5-tier order with seed amounts", () => {
    expect(PARTNER_TIERS.map((t) => t.slug)).toEqual([
      "catalyst",
      "builder",
      "amplifier",
      "nexus",
      "founding_member",
    ]);
    // WAVE 45 — NO tier definition may carry a price. Asserted structurally over
    // every value of every def, so adding a new numeric field in future (a
    // "fallbackMinor" under another name) fails this test rather than sneaking in.
    for (const def of PARTNER_TIERS) {
      for (const [key, value] of Object.entries(def)) {
        expect(
          typeof value,
          `PARTNER_TIERS.${def.slug}.${key} must not be numeric — prices come from ` +
            `partner_tier_price, never from a compiled-in constant (R3).`,
        ).not.toBe("number");
      }
    }
    // Identity metadata IS still owned here, and must be.
    const byslug = Object.fromEntries(PARTNER_TIERS.map((t) => [t.slug, t]));
    expect(byslug.founding_member.inviteOnly).toBe(true);
    expect(byslug.catalyst.inviteOnly).toBe(false);
    expect(byslug.catalyst.label).toBe("Catalyst");
  });

  it("maps legacy partner_* slugs onto canonical tiers", () => {
    expect(resolvePartnerTierSlug("partner_basic")).toBe("catalyst");
    expect(resolvePartnerTierSlug("partner_pro")).toBe("builder");
    expect(resolvePartnerTierSlug("partner_enterprise")).toBe("amplifier");
    expect(resolvePartnerTierSlug("catalyst")).toBe("catalyst");
    expect(resolvePartnerTierSlug("nexus")).toBe("nexus");
  });

  it("returns null for unknown slugs (fail-closed)", () => {
    expect(resolvePartnerTierSlug("platinum")).toBeNull();
    expect(resolvePartnerTierSlug("")).toBeNull();
    expect(resolvePartnerTierSlug(undefined)).toBeNull();
    expect(resolvePartnerTierSlug(42 as unknown)).toBeNull();
  });

  /* ═══════════════════════════════════════════════════════════════════════════
   * WAVE 51 · ITEM 1 — every field is compared against the AUTHORITATIVE ROW.
   * Not one amount, currency or cadence literal below. See the file header for
   * why the literal-pinning version was overruled rather than "fixed".
   * ═══════════════════════════════════════════════════════════════════════════ */
  it("resolveConsortiumPricing projects the authoritative price and lifecycle rows — no literal anywhere", () => {
    const cadence = activeCadence();
    const rows = advertisableRows(cadence);
    /* POSITIVE POLE FIRST. A resolver that advertised nothing at all would
     * satisfy every "no hardcoding" assertion below while stopping all revenue,
     * so the happy path is required explicitly. */
    expect(rows.length, "at least one tier must be advertisable").toBeGreaterThan(0);

    const pricing = resolveConsortiumPricing();
    const bySlug = new Map(pricing.map((t) => [t.slug, t]));

    // Set equality both ways: nothing invented, nothing silently dropped.
    expect(Array.from(bySlug.keys()).sort()).toEqual(rows.map((r) => r.tier_slug).sort());

    for (const r of rows) {
      const t = bySlug.get(r.tier_slug);
      expect(t, `tier ${r.tier_slug} is advertisable in the DB but missing from the resolver`).toBeTruthy();
      // THE AMOUNT IS THE ROW'S AMOUNT — read from the DB, never asserted as a literal.
      expect(t!.amountMinor).toBe(r.price_minor);
      expect(t!.currency).toBe(r.currency);
      expect(t!.billingPeriod).toBe(r.cadence);
      expect(t!.derivation).toBe(r.derivation);
      expect(t!.fromDb).toBe(true);
      // LIFECYCLE STATE is part of the authoritative answer, per the brief.
      expect(t!.lifecycleState).toBe(lifecycleState(r.tier_slug));
      // Integer minor units end to end — no float, no /100 in between.
      expect(Number.isInteger(t!.amountMinor)).toBe(true);
    }

    // Canonical tiers keep canonical ORDER (identity is code under R3, price is data).
    const canonicalAdvertised = PARTNER_TIERS.map((d) => d.slug).filter((s) => bySlug.has(s));
    expect(pricing.map((t) => t.slug).slice(0, canonicalAdvertised.length)).toEqual(canonicalAdvertised);

    // IDENTITY metadata is still asserted, and must not be inferred from an amount.
    const fm = bySlug.get("founding_member");
    if (fm) expect(fm.inviteOnly).toBe(true);
    const cat = bySlug.get("catalyst");
    if (cat) expect(cat.inviteOnly).toBe(false);
  });

  /* POLE A — CHANGE A PRICE ROW → the assertion still passes and reflects the
   * NEW value. A build with $240 compiled in fails this. */
  it("POLE A: change a price row → the resolver reflects the new value, and nothing else moves", () => {
    const before = readPriceRows();
    const target = advertisableRows()[0];
    expect(target, "need one advertisable row to mutate").toBeTruthy();
    const original = target.price_minor as number;
    /* The probe is DERIVED from the stored value, so this test carries no price
     * of its own and cannot be satisfied by any compiled-in number. */
    const probe = original + 3_701;
    expect(probe).not.toBe(original);
    try {
      wave45Db()
        .prepare(
          `UPDATE partner_tier_price SET price_minor = ?, updated_at = ?, updated_by = ?
            WHERE id = ?`,
        )
        .run(probe, new Date().toISOString(), "wave51:item1", target.id);

      const after = resolveConsortiumPricing();
      const moved = after.find((t) => t.slug === target.tier_slug)!;
      expect(moved, `${target.tier_slug} must still be advertised at its new price`).toBeTruthy();
      expect(moved.amountMinor).toBe(probe);
      expect(moved.amountMinor).not.toBe(original);
      // The whole-surface assertion from the test above still holds at the NEW value.
      for (const r of advertisableRows()) {
        const t = after.find((x) => x.slug === r.tier_slug)!;
        expect(t.amountMinor).toBe(r.price_minor);
      }
    } finally {
      restorePriceRows(before);
    }
    const restored = resolveConsortiumPricing().find((t) => t.slug === target.tier_slug)!;
    expect(restored.amountMinor).toBe(original);
  });

  /* POLE A (money fixture) — JPY has exponent 0. A resolver that scaled by 100
   * anywhere would corrupt this; the integer must pass through untouched. */
  it("POLE A/MONEY: a JPY row (exponent 0) passes through as integer minor units, unscaled", () => {
    expect(currencyExponent("JPY")).toBe(0); // fixture premise, from the registry
    const before = readPriceRows();
    const target = advertisableRows()[0];
    expect(target).toBeTruthy();
    const original = target.price_minor as number;
    /* An exponent-0 amount derived from the stored one: ¥ has no sub-unit, so
     * the minor value IS the major value. Any /100 or *100 on the read path
     * changes this number and fails the assertion. */
    const jpyMinor = original + 7;
    try {
      wave45Db()
        .prepare(
          `UPDATE partner_tier_price SET price_minor = ?, currency = 'JPY', updated_at = ?, updated_by = ?
            WHERE id = ?`,
        )
        .run(jpyMinor, new Date().toISOString(), "wave51:item1-jpy", target.id);

      const t = resolveConsortiumPricing().find((x) => x.slug === target.tier_slug)!;
      expect(t).toBeTruthy();
      expect(t.currency).toBe("JPY");
      // Exact integer identity with the row — no scaling, no rounding, no float.
      expect(t.amountMinor).toBe(jpyMinor);
      expect(Number.isInteger(t.amountMinor)).toBe(true);
      // And the row is still the authority, read back independently.
      const rowNow = readPriceRows().find((r) => r.id === target.id)!;
      expect(t.amountMinor).toBe(rowNow.price_minor);
      expect(t.currency).toBe(rowNow.currency);
    } finally {
      restorePriceRows(before);
    }
    const restored = resolveConsortiumPricing().find((t) => t.slug === target.tier_slug)!;
    expect(restored.amountMinor).toBe(original);
    expect(restored.currency).toBe(target.currency);
  });

  /* POLE B — REMOVE THE ROW → the surface REFUSES HONESTLY (R6) rather than
   * quoting a number. Deletion, not an UPDATE to NULL: the brief's pole. */
  it("POLE B: delete the price row → the tier is omitted and the charge path refuses, quoting no number (R6)", () => {
    const before = readPriceRows();
    const target = advertisableRows()[0];
    expect(target).toBeTruthy();
    const slug = target.tier_slug;
    const original = target.price_minor as number;
    /* Every amount currently in the DB, as text — the refusal must contain NONE
     * of them. This is the anti-fallback assertion: a compiled-in default of ANY
     * value, including the retired ladder and the retired flat $240, fails it. */
    const forbiddenAmounts = Array.from(
      new Set(before.filter((r) => r.price_minor !== null).map((r) => String(r.price_minor))),
    );
    try {
      wave45Db().prepare(`DELETE FROM partner_tier_price WHERE id = ?`).run(target.id);
      // Premise: the row really is gone.
      expect(readPriceRows().find((r) => r.id === target.id)).toBeUndefined();

      // 1) The browse surface OMITS it — it does not invent a price.
      const pricing = resolveConsortiumPricing();
      expect(pricing.find((t) => t.slug === slug), `${slug} must not be advertised with no price row`).toBeUndefined();
      // …and the rest of the ladder is untouched: one missing row is not an outage.
      expect(pricing.length).toBeGreaterThan(0);

      // 2) The CHARGE path refuses EXPLICITLY, naming the tier and cadence.
      let err: unknown = null;
      try {
        requireChargeTier(slug);
      } catch (e) {
        err = e;
      }
      expect(err, "requireChargeTier must THROW, not return a number").toBeInstanceOf(
        PartnerTierPriceUnresolvedError,
      );
      const message = (err as Error).message;
      expect(message).toContain(slug);
      expect(message).toContain(activeCadence());
      // 3) The refusal QUOTES NO PRICE — not the deleted one, not any other.
      for (const amount of forbiddenAmounts) {
        expect(message, `refusal must not quote the amount ${amount}`).not.toContain(amount);
      }
      for (const retired of ["49900", "99900", "149900", "499900", "24000"]) {
        expect(message, `refusal must not quote the retired literal ${retired}`).not.toContain(retired);
      }
      /* The deleted tier is ABSENT ENTIRELY — not present at a fallback amount,
       * not present at 0, not present with a null price. (Note the assertion is
       * on the SLUG, not on the number: the surviving tiers legitimately share
       * the same amount as the deleted one, so "the response contains no 24000"
       * would be a false accusation against rows that still exist. What must be
       * impossible is this tier reappearing with any price at all.) */
      expect(pricing.map((t) => t.slug)).not.toContain(slug);
      for (const t of pricing) {
        // Everything still advertised is still backed by a live row.
        expect(readPriceRows().find((r) => r.tier_slug === t.slug && r.price_minor === t.amountMinor)).toBeTruthy();
      }
    } finally {
      restorePriceRows(before);
    }
    // Restored: the positive pole again, so this test cannot leave the surface dark.
    const restored = resolveConsortiumPricing().find((t) => t.slug === slug)!;
    expect(restored, "the tier must return once its row is restored").toBeTruthy();
    expect(restored.amountMinor).toBe(original);
  });
});
