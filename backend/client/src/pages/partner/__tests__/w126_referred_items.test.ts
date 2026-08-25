/**
 * WAVE 126 — THE ITEMS REFERRED BY WAVE 127, AND THE TWO PRE-FILL DEFECTS
 * FOUND BY THE WIRE-FORMAT AUDIT THAT WAVE 127'S NOTE PROMPTED.
 *
 * Wave 127's note made one point that turned out to matter more than the items
 * it referred: "check you are not leaving a client sending whole units to an
 * endpoint still expecting minor units — that is exactly the 100x error, just
 * moved." Auditing every field this wave converted found the error had indeed
 * moved, twice, and into the worst possible place — the DEFAULT value of a
 * pre-filled box, which is the value most likely to be submitted unedited.
 *
 * Both are asserted here at source level, together with the two referred items.
 *
 * WHY SOURCE-LEVEL. These live inside `SpvDetailTabs.tsx` and
 * `PartnerSpvEngine.tsx`, components whose full render needs an authenticated
 * partner context, a query client and a populated vehicle. The defects are
 * defects of the WIRING — which converter feeds which state — so the wiring is
 * what is pinned. `minorToWholeUnitsInput` itself is behaviourally tested in
 * `client/src/components/partner/__tests__/w126_partner_money_input.test.ts`.
 *
 * Comments are stripped before every assertion via `liveCode` (the comment trap:
 * a string in a comment is not shipped code), reusing the shared stripper in
 * `w126_live_code.ts`, which the surface test exercises across 29 partner files.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { liveCode } from "./w126_live_code";

const ROOT = path.resolve(__dirname, "../../../../..");
const TABS = path.join(ROOT, "client/src/components/partner/SpvDetailTabs.tsx");
const ENGINE = path.join(ROOT, "client/src/pages/partner/PartnerSpvEngine.tsx");
const MONEY = path.join(ROOT, "client/src/components/partner/partnerMoneyInput.ts");

const tabs = liveCode(fs.readFileSync(TABS, "utf8"));
const engine = liveCode(fs.readFileSync(ENGINE, "utf8"));
const money = liveCode(fs.readFileSync(MONEY, "utf8"));

describe("W126 · the 100x error had MOVED to two pre-filled defaults", () => {
  /* FAILS BEFORE: the initializer read `useState(String(row.commitmentMinor))`,
     seeding a whole-unit box with a raw minor-unit integer. */
  it("W126-R-1 · the confirm-funds box is SEEDED in whole units, not minor units", () => {
    expect(tabs).toContain("useState(minorToWholeUnitsInput(row.commitmentMinor, currency))");
    expect(tabs).not.toContain("useState(String(row.commitmentMinor))");
  });

  /* FAILS BEFORE: `checkMax` kept `String(mandate.checkMaxMinor)` while
     `checkMin` beside it had already been converted — the asymmetry was the bug. */
  it("W126-R-2 · the mandate's maximum cheque is SEEDED in whole units", () => {
    expect(engine).not.toContain("String(mandate.checkMaxMinor)");
    expect(tabs).toContain("useState(minorToWholeUnitsInput(mandate?.checkMaxMinor, currency))");
    expect(tabs).not.toContain("String(mandate.checkMaxMinor)");
  });

  it("W126-R-3 · both cheque-size seeds use the SAME converter (no asymmetry can return)", () => {
    const seeds = tabs.match(/useState\(minorToWholeUnitsInput\(mandate\?\.check(Min|Max)Minor, currency\)\)/g) ?? [];
    expect(seeds).toHaveLength(2);
  });

  /* The wire format is what must NOT have changed. Every converted field still
     posts a *Minor field, and every server handler still validates minor units
     (verified against server/spvEngineStore.ts in W126_TESTS.md §2). */
  it("W126-R-4 · the money module never converts by dividing and never uses float parsers", () => {
    expect(money).not.toMatch(/\bparseFloat\s*\(/);
    expect(money).not.toMatch(/\bparseInt\s*\(/);
    expect(money).not.toMatch(/\bNumber\s*\(/);
    expect(money).not.toMatch(/\/\s*100\b/);
  });
});

describe("W126 · referred item — the wizard no longer hard-defaults to USD", () => {
  it("W126-R-5 · the denomination is derived from the jurisdiction via the existing table", () => {
    expect(engine).toContain("export function spvCurrencyForJurisdictionCountry");
    expect(engine).toContain('REGIONS_ALL.find((r) => r.name === country)');
    expect(engine).toContain('import { REGIONS_ALL } from "@/lib/regions"');
  });

  it("W126-R-6 · picking a jurisdiction re-derives the currency AND the fee currency", () => {
    expect(engine).toContain("currency: spvCurrencyForJurisdictionCountry(country) ?? prev.currency");
    expect(engine).toContain("feeCurrency: spvCurrencyForJurisdictionCountry(country) ?? prev.feeCurrency");
  });

  /* Rule 7 — where the table has no answer the wizard must NOT invent one. The
     `?? prev.currency` fallback is the whole point: it leaves the client's own
     selection alone rather than overwriting it with a guess. */
  it("W126-R-7 · an unmapped jurisdiction falls back to the client's selection, never to a literal", () => {
    const derive = engine.slice(
      engine.indexOf("export function spvCurrencyForJurisdictionCountry"),
      engine.indexOf("const EMPTY_WIZARD"),
    );
    expect(derive).toContain("return hit ? hit.currency : null;");
    expect(derive).not.toContain('"USD"');
  });

  it("W126-R-8 · the client must confirm the denomination before the vehicle can be created", () => {
    expect(engine).toContain('data-testid="spv-w-currency-confirm"');
    expect(engine).toContain("currencyConfirmed: boolean;");
    expect(engine).toContain("currencyConfirmed: false,");
    expect(engine).toContain("!w.currencyConfirmed || create.isPending");
  });

  it("W126-R-9 · the confirmation states the currency and that it is permanent", () => {
    expect(engine).toContain("This vehicle will be denominated in {w.currency}");
    expect(engine).toContain("cannot be changed after the");
  });
});

describe("W126 · referred item — the target figure now says what it is", () => {
  it("W126-R-10 · the target-raise figure carries a caption distinguishing it from money committed", () => {
    expect(engine).toContain("Target raise — not the amount committed");
    expect(engine).toContain("spv-target-raise-caption-");
  });

  /* The value itself must be untouched — wave 127 verified the Dashboard's
     `SPVs committed: $0.00` is CORRECT, so there was no arithmetic to fix. */
  it("W126-R-11 · the rendered value is unchanged (a caption, not a recalculation)", () => {
    expect(engine).toContain("{fmt(s.targetRaiseMinor, s.currency)}");
  });
});

describe("W126 · wave 127's six panels are left alone", () => {
  /* Wave 127 hoisted the e-signature early returns into these two memos so the
     send-for-signature form survives a failed list read. Touching them undoes a
     launch blocker fix, so this test fails if a later edit removes them. */
  it("W126-R-12 · wave 127's e-signature memos are still present and intact", () => {
    expect(tabs).toContain("esignReadFailure");
    expect(tabs).toContain("esignSchemaMissing");
  });
});
