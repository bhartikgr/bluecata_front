/**
 * WAVE 202 · ITEM A · R178.1 — THE REAL RESOLVER AND THE REAL WRITER.
 * ════════════════════════════════════════════════════════════════════════════════
 * Every assertion below calls the PRODUCTION function against a REAL SQLite schema
 * created by the REAL migration file. Nothing is stubbed, no condition is faked, and
 * no replica of the logic is asserted against (handbook §8).
 *
 * WHAT IS PROVED
 *   S-1   the migration inserts NOTHING — zero rows is the load-bearing safety
 *         property, because a seeded row would be a price the owner never chose
 *   S-2   an unrecorded scope resolves to the PLATFORM DEFAULT, i.e. exactly wave
 *         199's answer, in both of its directions
 *   S-3   a recorded scope resolves to the OWNER'S choice and overrides the default
 *   S-4   a choice recorded for one price never leaks onto another
 *   S-5   annual offered with no annual amount stays UNSET — never 0, never derived
 *   S-6   the writer refuses an amount with no currency, a non-integer, a negative,
 *         an over-boundary value, an unattributed actor and an unknown scope; and
 *         every refusal fits the 240-character `looksHuman` gate
 *   S-7   `annual_derivation` CANNOT hold a derived value — 'derived_x12' is
 *         rejected by the schema itself, so ×12 is unrepresentable, not merely
 *         unimplemented
 *   S-8   no ×12 or ÷12 appears in the source of either wave-202 server module
 *   S-9   wave 199's DTO fields are all still present and unrenamed
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  ensurePricePeriodOfferSchema,
  resolvePricePeriodOffer,
  listPricePeriodOffers,
  writePricePeriodOffer,
  platformFeeScopeKey,
  partnerTierScopeKey,
  isKnownScopeKey,
  PRICE_PERIOD_OFFER_TABLE,
} from "../lib/pricePeriodOffer";
import { wave45Db } from "../lib/applyWave45PricingSchema";
import { readPriceDisplayPolicy } from "../lib/priceDisplayPolicyRoutes";
import { LOOKS_HUMAN_MAX_LENGTH } from "../../shared/refusalHeadlineGate";

const ROOT = resolve(__dirname, "..", "..");
const SCOPE_A = platformFeeScopeKey("collective.member_subscription.standard");
const SCOPE_B = platformFeeScopeKey("founder.capavate_annual");

beforeAll(() => {
  ensurePricePeriodOfferSchema();
});

/* ============================================================================ */

describe("W202 S — the per-price billing-period store", () => {
  it("S-1 the table exists and the migration seeds NO rows", () => {
    const db = wave45Db();
    const t = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(PRICE_PERIOD_OFFER_TABLE) as { name?: string } | undefined;
    expect(t?.name).toBe(PRICE_PERIOD_OFFER_TABLE);
    /* ZERO ROWS. A seeded default would be a period the owner never chose, which is
       the exact failure R178.1 is a correction of. */
    expect(listPricePeriodOffers()).toEqual([]);
  });

  it("S-2 an unrecorded scope falls back to the platform-wide answer (wave 199's answer)", () => {
    const platform = readPriceDisplayPolicy();
    const resolved = resolvePricePeriodOffer(SCOPE_A);
    expect(resolved.source).toBe("platform_default");
    /* IDENTICAL, not merely similar. This is what makes moving a surface onto the
       per-price hook behaviour-neutral on the day it lands. */
    expect(resolved.monthlyOffered).toBe(platform.monthlyOffered);
    expect(resolved.annualOffered).toBe(platform.annualOffered);
    /* And it carries no amount, because a default is not a price. */
    expect(resolved.annualAmountMinor).toBeNull();
    expect(resolved.annualDerivation).toBe("unset");
  });

  it("S-3 a recorded choice overrides the platform default", () => {
    const w = writePricePeriodOffer({
      scopeKey: SCOPE_A,
      annualOffered: true,
      monthlyOffered: true,
      annualAmountMinor: null,
      annualCurrency: null,
      updatedBy: "u_owner_test",
    });
    expect(w.ok).toBe(true);
    const resolved = resolvePricePeriodOffer(SCOPE_A);
    expect(resolved.source).toBe("per_price");
    expect(resolved.monthlyOffered).toBe(true);
    expect(resolved.annualOffered).toBe(true);
    expect(resolved.updatedBy).toBe("u_owner_test");

    /* And the other direction: the owner turns monthly back off. */
    expect(
      writePricePeriodOffer({
        scopeKey: SCOPE_A,
        annualOffered: true,
        monthlyOffered: false,
        annualAmountMinor: null,
        annualCurrency: null,
        updatedBy: "u_owner_test",
      }).ok,
    ).toBe(true);
    expect(resolvePricePeriodOffer(SCOPE_A).monthlyOffered).toBe(false);
  });

  it("S-4 a choice for one price does not leak onto another", () => {
    writePricePeriodOffer({
      scopeKey: SCOPE_A,
      annualOffered: true,
      monthlyOffered: true,
      annualAmountMinor: null,
      annualCurrency: null,
      updatedBy: "u_owner_test",
    });
    expect(resolvePricePeriodOffer(SCOPE_A).source).toBe("per_price");
    expect(resolvePricePeriodOffer(SCOPE_B).source).toBe("platform_default");
    expect(resolvePricePeriodOffer(partnerTierScope_unknown()).source).toBe(
      "platform_default",
    );
  });

  it("S-5 R143.4 — annual offered with no amount stays UNSET, never zero", () => {
    writePricePeriodOffer({
      scopeKey: SCOPE_B,
      annualOffered: true,
      monthlyOffered: false,
      annualAmountMinor: null,
      annualCurrency: null,
      updatedBy: "u_owner_test",
    });
    const r = resolvePricePeriodOffer(SCOPE_B);
    expect(r.annualOffered).toBe(true);
    expect(r.annualAmountMinor).toBeNull();
    expect(r.annualAmountMinor).not.toBe(0);
    expect(r.annualCurrency).toBeNull();
    expect(r.annualDerivation).toBe("unset");
  });

  it("S-5b an amount the owner DOES set is stored verbatim and tagged admin_set", () => {
    const w = writePricePeriodOffer({
      scopeKey: SCOPE_B,
      annualOffered: true,
      monthlyOffered: false,
      annualAmountMinor: 240000,
      annualCurrency: "usd",
      updatedBy: "u_owner_test",
    });
    expect(w.ok).toBe(true);
    const r = resolvePricePeriodOffer(SCOPE_B);
    expect(r.annualAmountMinor).toBe(240000); /* verbatim — not rounded, not scaled */
    expect(r.annualCurrency).toBe("USD");
    expect(r.annualDerivation).toBe("admin_set");
    expect(r.forbidX12Derivation).toBe(true);
  });

  it("S-6 the writer refuses every malformed money input, and every refusal is human", () => {
    const base = {
      scopeKey: SCOPE_A,
      annualOffered: true,
      monthlyOffered: false,
      updatedBy: "u_owner_test",
    };
    const refusals: string[] = [];
    const collect = (r: ReturnType<typeof writePricePeriodOffer>): void => {
      expect(r.ok).toBe(false);
      if (!r.ok) refusals.push(r.refusal);
    };

    /* amount with no currency — no currency is ever assumed (R156.2) */
    collect(writePricePeriodOffer({ ...base, annualAmountMinor: 240000, annualCurrency: null }));
    /* non-integer minor units */
    collect(writePricePeriodOffer({ ...base, annualAmountMinor: 1.5, annualCurrency: "USD" }));
    /* negative */
    collect(writePricePeriodOffer({ ...base, annualAmountMinor: -1, annualCurrency: "USD" }));
    /* past the exact-integer boundary */
    collect(
      writePricePeriodOffer({
        ...base,
        annualAmountMinor: Number.MAX_SAFE_INTEGER + 2,
        annualCurrency: "USD",
      }),
    );
    /* unattributed actor */
    collect(
      writePricePeriodOffer({
        ...base,
        updatedBy: "   ",
        annualAmountMinor: null,
        annualCurrency: null,
      }),
    );
    /* unknown scope namespace */
    collect(
      writePricePeriodOffer({
        ...base,
        scopeKey: "not_a_namespace:whatever",
        annualAmountMinor: null,
        annualCurrency: null,
      }),
    );

    expect(refusals.length).toBe(6);
    for (const r of refusals) {
      /* THE 240-CHARACTER GATE. A refusal longer than this is swallowed by
         client/src/lib/queryClient.ts and the user sees a generic error instead. */
      expect(r.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
      expect(r).toMatch(/[a-z]/);
      /* And it must say that nothing changed, so a failed save is never mistaken
         for a partial one. */
      expect(r.toLowerCase()).toContain("nothing was changed");
    }
  });

  it("S-6b a refused write leaves the stored value exactly as it was", () => {
    writePricePeriodOffer({
      scopeKey: SCOPE_A,
      annualOffered: true,
      monthlyOffered: true,
      annualAmountMinor: null,
      annualCurrency: null,
      updatedBy: "u_owner_test",
    });
    const before = resolvePricePeriodOffer(SCOPE_A);
    writePricePeriodOffer({
      scopeKey: SCOPE_A,
      annualOffered: false,
      monthlyOffered: false,
      annualAmountMinor: 999,
      annualCurrency: null /* → refusal */,
      updatedBy: "u_owner_test",
    });
    const after = resolvePricePeriodOffer(SCOPE_A);
    expect(after.monthlyOffered).toBe(before.monthlyOffered);
    expect(after.annualOffered).toBe(before.annualOffered);
    expect(after.annualAmountMinor).toBe(before.annualAmountMinor);
  });

  it("S-7 ×12 is UNREPRESENTABLE: the schema itself rejects a derived provenance", () => {
    const db = wave45Db();
    /* Not a policy, not a code branch — a CHECK constraint. Even a future author
       with direct SQL access cannot record a multiplied annual figure here. */
    expect(() =>
      db
        .prepare(
          `INSERT INTO ${PRICE_PERIOD_OFFER_TABLE}
             (scope_key, annual_offered, monthly_offered, annual_amount_minor,
              annual_currency, annual_derivation, updated_at, updated_by)
           VALUES (?, 1, 1, 298800, 'USD', 'derived_x12', ?, ?)`,
        )
        .run("platform_fee:x12_attempt", new Date().toISOString(), "attacker"),
    ).toThrow();
  });

  it("S-8 neither wave-202 server module contains a ×12 or ÷12 on money", () => {
    for (const rel of ["server/lib/pricePeriodOffer.ts", "server/lib/priceClarity.ts"]) {
      /* Comments and string literals are stripped before concluding anything from a
         grep, because both files DISCUSS ×12 at length in prose. */
      const src = stripCommentsAndStrings(readFileSync(resolve(ROOT, rel), "utf8"));
      expect(src).not.toContain("* 12");
      expect(src).not.toContain("/ 12");
      expect(src).not.toContain("*12");
      expect(src).not.toContain("/12");
      /* Verify the stripper actually stripped: the prose is gone. */
      expect(src).not.toContain("forbid_x12_derivation = 1");
    }
  });

  it("S-9 wave 199's policy DTO fields all survive, unrenamed", () => {
    const p = readPriceDisplayPolicy();
    for (const field of [
      "monthlyDisplayAllowed",
      "annualOffered",
      "monthlyOffered",
      "forbidX12Derivation",
      "model",
      "updatedAt",
      "unavailableReason",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(p, field)).toBe(true);
    }
    /* And wave 202's addition is present and additive. */
    expect(Array.isArray((p as { scopes?: unknown }).scopes)).toBe(true);
  });

  it("S-10 the migration is mirrored byte-identically into both directories", () => {
    const a = resolve(ROOT, "migrations/0216_wave202_price_period_offer.sql");
    const b = resolve(ROOT, "server/db/migrations/0216_wave202_price_period_offer.sql");
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);
    expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
    /* And it inserts nothing. */
    const sql = readFileSync(a, "utf8").toUpperCase();
    expect(sql).not.toContain("INSERT INTO");
  });

  it("S-11 scope-key namespaces are validated, not trusted", () => {
    expect(isKnownScopeKey(SCOPE_A)).toBe(true);
    expect(isKnownScopeKey(partnerTierScopeKey("catalyst"))).toBe(true);
    expect(isKnownScopeKey("")).toBe(false);
    expect(isKnownScopeKey("platform_fee:")).toBe(false);
    expect(isKnownScopeKey("made_up:thing")).toBe(false);
  });
});

/* --- helpers ---------------------------------------------------------------- */

function partnerTierScope_unknown(): string {
  return partnerTierScopeKey("a_tier_no_one_has_configured");
}

/**
 * Removes block comments, line comments and every string/template literal, so a
 * grep conclusion cannot be fooled by prose that discusses the thing it forbids.
 */
function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (two === "//") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? n : end;
      continue;
    }
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i += 1;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === c) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
