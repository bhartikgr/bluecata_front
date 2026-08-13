/**
 * WAVE 33 · CP-SPV-31 — DEPLOY CAPITAL INTO A ROUND.
 *
 * THE HIGHEST-RISK ITEM OF THE WAVE: this path moves real money into a real
 * company round and writes it into the SACRED, append-only cap-table ledger.
 *
 * WHAT THIS FILE DEFENDS AGAINST, SPECIFICALLY
 * --------------------------------------------
 * 1. THE 100x PAIR. `spvEngineRoutes.ts` held the SAME defect twice, in
 *    opposite directions, in the same file:
 *      · sink 1 `Math.round(Number(amount) * 100)` INFLATED the LP roster;
 *      · sink 4 `minorToDecimal` DEFLATED the sacred ledger.
 *    Both hardcoded exponent 2, and no test anywhere used a currency whose
 *    exponent is not 2 — so both were invisible while being live. Every money
 *    case here carries a JPY (exponent 0) fixture ALONGSIDE a USD one, and
 *    asserts the two differ. A test that only used USD would pass against both
 *    the defect and the fix, which is the definition of checking nothing.
 *
 * 2. THE OBLIGATION COMMITTED BEFORE THE ROW THAT SATISFIES IT. Sink 1's
 *    conversion ran AFTER the ledger write and coerced failure to `0`, so an
 *    unrepresentable amount produced a committed ledger entry paired with a
 *    zero roster commitment — money charged with nothing recording it. Case
 *    group (O) drives that exact ordering.
 *
 * 3. THE UNCHECKED SHARE COUNT. The commit route validated the GP's typed
 *    shares with `/^-?\d+$/` and nothing else before writing them permanently
 *    to a company's cap table. Group (V) pins the derivation and, critically,
 *    pins that it REFUSES rather than inventing a figure.
 *
 * 4. THE UNREACHABLE RUNG. The store accepts three transitions; the UI exposed
 *    two. Case (L) asserts the server-published ladder contains all three, so
 *    the client cannot silently fall behind the store again.
 *
 * Establishes all its own preconditions. Never reads `process.env`. No
 * conditional skip anywhere.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";

/* Every source assertion in this file reads STRIPPED source.
   S3 and O2 originally FAILED because the files under test QUOTE the defective
   code in their own doc comments — deliberately, so a future reader can see
   what was wrong. A raw scan therefore matched the prose describing the defect
   rather than the defect, which is this wave's own lesson ("a check that
   passed while checking nothing") turned inside out: a check that FAILED while
   checking nothing. `readCode` removes comments; `assertStripWorks` below pins
   that it has not simply deleted everything. */
function readCode(f: string): string {
  return fs
    .readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

import {
  deriveShares,
  describeShareDivergence,
  type ShareDerivation,
} from "../lib/spvShareDerivation";
import { decimalStringToMinor } from "../lib/money";
import { currencyExponent } from "../lib/currency";

/* ── (C) THE CURRENCY FIXTURES THEMSELVES ─────────────────────────────────── */

describe("C — the fixtures this file's conclusions rest on", () => {
  it("C0 readCode strips comments but keeps code", () => {
    // Without this, every `not.toContain` below would pass against a stripper
    // that returned "".
    const src = readCode("server/spvEngineRoutes.ts");
    expect(src).toContain("function minorToDecimal");
    expect(src).not.toContain("WAVE 33 / CP-SPV-31 · SINK 4");
    expect(src.length).toBeGreaterThan(10000);
  });

  it("C1 JPY really is exponent 0 and USD really is exponent 2", () => {
    // If this ever stopped being true, every "the two differ" assertion below
    // would still pass while measuring nothing.
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
  });
});

/* ── (M) SINK 1 — MAJOR DECIMAL STRING -> MINOR UNITS ─────────────────────── */

describe("M — sink 1, the roster projection conversion", () => {
  it("M1 the same numeral converts DIFFERENTLY in JPY and USD", () => {
    /* This is the assertion the original code could not have survived and no
       existing test made. `Math.round(Number("250000") * 100)` returns
       25_000_000 for BOTH currencies. */
    const jpy = decimalStringToMinor("250000", "JPY", "amount");
    const usd = decimalStringToMinor("250000", "USD", "amount");
    expect(jpy).toBe(BigInt(250000));
    expect(usd).toBe(BigInt(25000000));
    expect(jpy).not.toBe(usd);
  });

  it("M2 the OLD expression is reproduced here and shown to be wrong for JPY", () => {
    // Reproducing the defect in the test is deliberate: it proves the fix
    // changes the answer rather than merely being differently spelled.
    const old = Math.round(Number("250000") * 100);
    const fixed = Number(decimalStringToMinor("250000", "JPY", "amount"));
    expect(old).toBe(25000000);
    expect(fixed).toBe(250000);
    expect(old / fixed).toBe(100); // exactly the 100x inflation
  });

  it("M3 a sub-unit amount is REFUSED, never rounded", () => {
    // ¥0.5 does not exist. The old path would have produced 50 minor units.
    expect(() => decimalStringToMinor("0.5", "JPY", "amount")).toThrow(
      /MONEY_DECIMAL_PRECISION_UNSUPPORTED/,
    );
    // The pole: the same fractional value IS representable in USD.
    expect(decimalStringToMinor("0.50", "USD", "amount")).toBe(BigInt(50));
  });

  it("M4 half a cent is refused in USD too — the rule is not JPY-specific", () => {
    expect(() => decimalStringToMinor("0.005", "USD", "amount")).toThrow();
  });

  it("M5 KWD (exponent 3) is handled — the fix is exponent-driven, not a JPY special case", () => {
    expect(currencyExponent("KWD")).toBe(3);
    expect(decimalStringToMinor("1", "KWD", "amount")).toBe(BigInt(1000));
  });
});

/* ── (S) SINK 4 — MINOR UNITS -> THE DECIMAL STRING THE LEDGER STORES ─────── */

/* `minorToDecimal` is module-private in spvEngineRoutes (it has exactly one
   caller). Its behaviour is pinned here against an independent reimplementation
   of the SAME contract, and separately by a source assertion that the shipped
   function is exponent-driven rather than hardcoded — so this group cannot pass
   against a reverted implementation. */
function expectedMinorToDecimal(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const neg = minor < 0;
  const abs = BigInt(Math.abs(Math.trunc(minor)));
  if (exp <= 0) return `${neg ? "-" : ""}${abs.toString()}`;
  let divisor = BigInt(1);
  for (let i = 0; i < exp; i += 1) divisor *= BigInt(10);
  return `${neg ? "-" : ""}${(abs / divisor).toString()}.${(abs % divisor).toString().padStart(exp, "0")}`;
}

describe("S — sink 4, the value written into the sacred ledger", () => {
  it("S1 a JPY deployment is NOT divided by 100", () => {
    // ¥1,000,000 held as 1_000_000 minor units. The old code wrote "10000.00" —
    // a 100x understatement of capital deployed into a real round.
    expect(expectedMinorToDecimal(1000000, "JPY")).toBe("1000000");
    expect(expectedMinorToDecimal(1000000, "JPY")).not.toBe("10000.00");
  });

  it("S2 the pole — USD still renders 2dp", () => {
    expect(expectedMinorToDecimal(1000000, "USD")).toBe("10000.00");
  });

  it("S3 the shipped function is exponent-driven — asserted against the SOURCE", () => {
    /* Without this, group S would pass against the reverted hardcoded version,
       because it would only be testing the local reimplementation. */
    const src = readCode("server/spvEngineRoutes.ts");
    const fn = src.slice(src.indexOf("function minorToDecimal("));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("currencyExponent(currency)");
    expect(body).not.toMatch(/abs\s*\/\s*100/);
    expect(body).not.toMatch(/abs\s*%\s*100/);
    // …and it takes a currency at all, which the old two-arg-less version did not.
    expect(src).toContain("function minorToDecimal(minor: number, currency: string)");
  });

  it("S4 its single caller passes the DEPLOYMENT's currency, not a constant", () => {
    const src = readCode("server/spvEngineRoutes.ts");
    expect(src).toContain("minorToDecimal(dep.amountMinor, dep.currency)");
    // No caller may fall back to a literal.
    expect(src).not.toMatch(/minorToDecimal\([^)]*,\s*["']USD["']\s*\)/);
  });

  it("S5 round-trip — minor -> decimal -> minor is lossless in both currencies", () => {
    for (const [minor, cur] of [[1000000, "JPY"], [1000000, "USD"], [1, "JPY"], [1, "USD"], [1000, "KWD"]] as const) {
      const back = decimalStringToMinor(expectedMinorToDecimal(minor, cur), cur, "rt");
      expect(Number(back)).toBe(minor);
    }
  });
});

/* ── (O) ORDERING — NEVER COMMIT BEFORE THE ROW THAT RECORDS IT ───────────── */

describe("O — the conversion happens BEFORE the ledger write", () => {
  const src = readCode("server/spvEngineRoutes.ts");

  it("O1 the amount conversion precedes commitFunded in the subscription handler", () => {
    const convIdx = src.indexOf("amountMinorExact = decimalStringToMinor(amount, currency");
    expect(convIdx).toBeGreaterThan(-1);
    // the commitFunded call that follows it in this handler
    const commitIdx = src.indexOf("const result = commitFunded({", convIdx);
    expect(commitIdx).toBeGreaterThan(convIdx);
  });

  it("O2 the zero-coercion fallback is GONE", () => {
    /* `Number.isFinite(amountMinor) ? amountMinor : 0` turned an
       unrepresentable amount into a committed ledger entry with a ZERO roster
       commitment — money charged with nothing recording it. */
    expect(src).not.toContain("Number.isFinite(amountMinor) ? amountMinor : 0");
    expect(src).not.toContain("Math.round(Number(amount) * 100)");
  });

  it("O3 the refusal copy says nothing was committed", () => {
    // The GP must be told the state of the world, not just handed an error code.
    expect(src).toContain("Nothing has been committed");
  });

  it("O4 an unrepresentable amount is refused with a 400 before any ledger call", () => {
    const convIdx = src.indexOf("amountMinorExact = decimalStringToMinor(amount, currency");
    const commitIdx = src.indexOf("const result = commitFunded({", convIdx);
    const between = src.slice(convIdx, commitIdx);
    // The refusal returns out of the handler between the two points.
    expect(between).toContain('res.status(400).json({');
    expect(between).toContain("INVALID_AMOUNT");
  });

  it("O5 sanity pole — this source scan can detect a string that is genuinely absent", () => {
    expect(src).not.toContain("Math.round(Number(amount) * 1000)");
  });
});

/* ── (V) SHARE DERIVATION ─────────────────────────────────────────────────── */

function d(amountMinor: number, currency: string, pricePerShare: number | null): ShareDerivation {
  return deriveShares({ amountMinor, currency, pricePerShare });
}

describe("V — share derivation", () => {
  it("V1 an exact division reports the share count and no residual", () => {
    // $10,000.00 at $2.50/share = 4,000 shares exactly.
    const r = d(1000000, "USD", 2.5);
    expect(r.refusal).toBeNull();
    expect(r.wholeShares).toBe("4000");
    expect(r.residualMinor).toBe(0);
    expect(r.exact).toBe(true);
  });

  it("V2 an inexact division reports whole shares AND the exact residual — never rounds", () => {
    /* $10,000.00 (1_000_000 minor) at $3.00/share (300 minor):
         1_000_000 = 3_333 x 300 + 100
       so 3,333 whole shares and $1.00 — one hundred minor units — left over.
       An earlier revision of this case asserted a residual of 1, which is the
       kind of arithmetic slip that makes a money test agree with a defect. The
       identity below is asserted explicitly so the numbers cannot drift. */
    const r = d(1000000, "USD", 3);
    expect(r.wholeShares).toBe("3333");
    expect(r.residualMinor).toBe(100);
    expect(Number(r.wholeShares) * 300 + r.residualMinor!).toBe(1000000);
    expect(r.exact).toBe(false);
    // The residual is SAID, not swallowed.
    expect(r.copy.toLowerCase()).toContain("residual");
  });

  it("V3 rounding is never applied — whole shares are floor, not nearest", () => {
    // $10.00 at $3.00 = 3.33 shares. A `Math.round` would say 3 here too, so
    // use a case where floor and round differ: $11.00 at $3.00 = 3.67.
    const r = d(1100, "USD", 3);
    expect(r.wholeShares).toBe("3");
    expect(Math.round(1100 / 300)).toBe(4); // what the forbidden approach yields
  });

  it("V4 JPY (exponent 0) derives correctly — the same numerals, a different answer", () => {
    // ¥1,000,000 at ¥250/share = 4,000 shares.
    const jpy = d(1000000, "JPY", 250);
    expect(jpy.wholeShares).toBe("4000");
    // The identical minor amount and price in USD is a DIFFERENT share count,
    // which is the whole point of carrying the exponent.
    const usd = d(1000000, "USD", 250);
    expect(usd.wholeShares).toBe("40");
    expect(jpy.wholeShares).not.toBe(usd.wholeShares);
  });

  it("V5 a NULL price refuses — it does not derive 0 shares", () => {
    const r = d(1000000, "USD", null);
    expect(r.refusal).toBe("NO_PRICE_PER_SHARE");
    expect(r.wholeShares).toBeNull();
    expect(r.residualMinor).toBeNull();
    // Zero would be a claim that the money bought nothing.
    expect(r.wholeShares).not.toBe("0");
    expect(r.copy.length).toBeGreaterThan(60);
  });

  it("V6 a zero or negative price refuses rather than dividing by zero", () => {
    expect(d(1000000, "USD", 0).refusal).toBe("PRICE_NOT_POSITIVE");
    expect(d(1000000, "USD", -5).refusal).toBe("PRICE_NOT_POSITIVE");
  });

  it("V7 a price finer than the currency can represent refuses rather than flattening", () => {
    // $0.001 in USD. Rounding down gives $0.00 (division by zero); rounding up
    // to $0.01 understates the share count tenfold. Neither is acceptable.
    const r = d(1000000, "USD", 0.001);
    expect(r.refusal).toBe("PRICE_NOT_REPRESENTABLE");
    expect(r.wholeShares).toBeNull();
    // The pole: a price the currency CAN represent is not refused.
    expect(d(1000000, "USD", 0.01).refusal).toBeNull();
  });

  it("V11 a price too tiny for the round-trip check to notice still refuses (kills M7)", () => {
    /* Found by mutation. The round-trip guard compares against
       `EPSILON * max(1, |price|)`, so a price of 1e-300 passes it — the
       difference from "0.00" is smaller than the tolerance. The value then
       converts to ZERO minor units, and the only thing standing between that
       and a BigInt division by zero is the explicit `priceMinor <= 0` check.
       Relaxing that check to `=== null` survived the suite until this case
       existed. */
    const r = d(1000000, "USD", 1e-300);
    expect(r.refusal).toBe("PRICE_NOT_REPRESENTABLE");
    expect(r.wholeShares).toBeNull();
  });

  it("V12 a price with more precision than the currency allows refuses (kills M12)", () => {
    /* Found by mutation. $2.505 is not a USD price. Dropping the round-trip
       guard does NOT produce zero here — it produces 250 minor units, i.e. it
       silently prices the deal at $2.50 and derives a share count that is
       wrong by 0.2%. V7's 0.001 case could not catch this because 0.001
       collapses to zero and is caught by the separate non-positive guard. */
    const r = d(1000000, "USD", 2.505);
    expect(r.refusal).toBe("PRICE_NOT_REPRESENTABLE");
    expect(r.wholeShares).toBeNull();
    // The pole: the neighbouring representable prices are both fine, and give
    // materially different answers — which is why guessing between them is not
    // acceptable.
    expect(d(1000000, "USD", 2.5).wholeShares).toBe("4000");
    expect(d(1000000, "USD", 2.51).wholeShares).toBe("3984");
  });

  it("V13 a JPY price with any fraction refuses — exponent 0 admits no decimals", () => {
    expect(d(1000000, "JPY", 250.5).refusal).toBe("PRICE_NOT_REPRESENTABLE");
    expect(d(1000000, "JPY", 250).refusal).toBeNull();
  });

  it("V8 a non-positive amount refuses", () => {
    expect(d(0, "USD", 2.5).refusal).toBe("AMOUNT_NOT_POSITIVE");
    expect(d(-100, "USD", 2.5).refusal).toBe("AMOUNT_NOT_POSITIVE");
  });

  it("V9 every refusal carries distinct, non-empty, non-tokenish copy", () => {
    const seen = new Set<string>();
    for (const r of [
      d(1000000, "USD", null),
      d(1000000, "USD", 0),
      d(1000000, "USD", 0.001),
      d(0, "USD", 2.5),
    ]) {
      expect(r.copy.length).toBeGreaterThan(60);
      expect(r.copy).not.toContain("_"); // no enum token leaking into prose
      seen.add(r.copy);
    }
    expect(seen.size).toBe(4); // four distinct sentences, not one generic one
  });

  it("V10 a very large amount stays exact — no float precision loss", () => {
    // Past 2^53 when multiplied out; BigInt arithmetic must hold.
    const r = d(9007199254740992, "JPY", 2);
    expect(r.wholeShares).toBe("4503599627370496");
    expect(r.exact).toBe(true);
  });
});

/* ── (W) THE DIVERGENCE WARNING ───────────────────────────────────────────── */

describe("W — divergence between what the GP typed and what the rows imply", () => {
  it("W1 a divergent figure produces a warning naming BOTH numbers", () => {
    const der = d(1000000, "USD", 2.5); // 4000
    const msg = describeShareDivergence("4500", der);
    expect(msg).toBeTruthy();
    expect(msg!).toContain("4500");
    expect(msg!).toContain("4000");
  });

  it("W2 an agreeing figure produces NO warning — so the warning means something", () => {
    const der = d(1000000, "USD", 2.5);
    expect(describeShareDivergence("4000", der)).toBeNull();
  });

  it("W3 leading zeros and whitespace are not treated as divergence", () => {
    const der = d(1000000, "USD", 2.5);
    expect(describeShareDivergence("  04000 ", der)).toBeNull();
  });

  it("W4 no warning is invented when there is no derivation to compare against", () => {
    // Claiming a divergence from a figure that does not exist would be worse
    // than silence.
    expect(describeShareDivergence("4000", d(1000000, "USD", null))).toBeNull();
  });

  it("W5 the warning states the commit is permanent", () => {
    const msg = describeShareDivergence("1", d(1000000, "USD", 2.5))!;
    expect(msg.toLowerCase()).toContain("permanent");
  });

  it("W6 it is a WARNING, not a gate — the commit route still accepts the typed figure", () => {
    /* Deliberate design, recorded so a future reader does not "fix" it: the
       derived figure is offered, never substituted. Substituting silently
       would swap one unchecked number for another, and share counts can
       legitimately differ from a naive division (side letters, agreed
       rounding, anti-dilution). */
    const src = readCode("server/spvEngineRoutes.ts");
    const commitHandler = src.slice(src.indexOf("/deployments/:depId/commit"));
    expect(commitHandler.slice(0, 3000)).not.toContain("deriveShares");
  });
});

/* ── (L) THE LADDER — THE RUNG THE UI COULD NOT REACH ─────────────────────── */

describe("L — the deployment ladder is published by the server, not guessed by the client", () => {
  const routeSrc = readCode("server/spvShareDerivationRoutes.ts");
  const storeSrc = readCode("server/spvEngineStore.ts");

  it("L1 the published ladder contains ALL THREE rungs the store accepts", () => {
    for (const rung of ["founder_confirmed", "docs_sent", "wired"]) {
      expect(routeSrc).toContain(`to: "${rung}"`);
    }
  });

  it("L2 the store really does accept exactly those three", () => {
    expect(storeSrc).toContain('to: "founder_confirmed" | "docs_sent" | "wired"');
  });

  it("L3 `docs_sent` is now reachable from the client", () => {
    const ui = readCode("client/src/components/partner/SpvOperationsPanels.tsx");
    expect(ui).toContain('to: "docs_sent"');
    expect(ui).toContain("spv-deployment-docs-sent-");
  });

  it("L4 `closingDocRef` is now settable from the client — it never was", () => {
    const ui = readCode("client/src/components/partner/SpvOperationsPanels.tsx");
    expect(ui).toContain("closingDocRef");
    expect(ui).toContain("spv-deployment-docref-");
  });

  it("L5 every rung carries a real hint SENTENCE, not just a label (M18)", () => {
    /* HARNESS BUG found by mutation: this case used to count occurrences of
       `hint: "`, which an EMPTY hint satisfies perfectly. It asserted that the
       key was present, not that anything was said — a check that passed while
       checking nothing. It now measures the content. */
    const hints = Array.from(routeSrc.matchAll(/hint:\s*"([^"]*)"/g)).map((m) => m[1]);
    expect(hints.length).toBe(3);
    for (const h of hints) {
      expect(h.trim().length).toBeGreaterThan(30);
    }
    expect(new Set(hints).size).toBe(3); // three distinct explanations
  });

  it("L9 the redundant ownership check is safe to rely on (M16, equivalent)", () => {
    /* EQUIVALENT MUTANT, recorded rather than papered over. Removing the
       route's `getSpv` guard changes no observable behaviour, because
       `listDeployments` performs the identical partner check itself and
       returns [] — so the request still 404s with the same body. The guard is
       kept as defence in depth on a money route; this case pins the inner
       check that makes it merely redundant rather than load-bearing, so a
       future edit that removes the INNER one cannot pass silently. */
    expect(storeSrc).toContain("listDeployments(partnerId: string, spvId: string)");
    const fn = storeSrc.slice(storeSrc.indexOf("listDeployments(partnerId: string"));
    expect(fn.slice(0, 220)).toContain("if (!this.getSpv(partnerId, spvId)) return [];");
  });

  it("L6 the derivation route is READ-ONLY — it never advances or commits", () => {
    expect(routeSrc).not.toContain("advanceDeployment");
    expect(routeSrc).not.toContain("markDeployed");
    expect(routeSrc).not.toContain("commitFunded");
    expect(routeSrc).not.toMatch(/app\.(post|patch|put|delete)\(/);
  });

  it("L7 the route is partner-scoped from the SESSION, never from the URL", () => {
    expect(routeSrc).toContain("req.partnerContext?.partnerId");
    expect(routeSrc).not.toMatch(/req\.(query|body|params)\.partnerId/);
  });

  it("L8 not-yours and not-there are the SAME refusal object", () => {
    // Two `res.status(404).json(NOT_FOUND)` returns, one shared constant, so
    // the bodies cannot drift apart and leak existence.
    const hits = routeSrc.match(/res\.status\(404\)\.json\(NOT_FOUND\)/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(routeSrc).not.toContain("res.status(403)");
  });
});

/* ── (X) STRUCTURAL ───────────────────────────────────────────────────────── */

describe("X — structural defences", () => {
  const files = [
    "server/lib/spvShareDerivation.ts",
    "server/spvShareDerivationRoutes.ts",
  ];

  it("X1 no lazy require() in any file this item added", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const f of files) {
      expect(strip(fs.readFileSync(f, "utf8"))).not.toMatch(/\brequire\s*\(/);
    }
    expect(strip('const x = require("y");')).toMatch(/\brequire\s*\(/); // sanity pole
  });

  it("X2 no forbidden percentage coercion anywhere in the added code", () => {
    for (const f of files) {
      expect(fs.readFileSync(f, "utf8")).not.toMatch(/>\s*1\s*\?\s*\w+\s*\/\s*100/);
    }
  });

  it("X3 no Math.round on a per-party share in the derivation engine", () => {
    const src = fs.readFileSync("server/lib/spvShareDerivation.ts", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toContain("Math.round");
  });

  it("X4 the derivation engine is pure — no db, no request, no clock", () => {
    const src = fs.readFileSync("server/lib/spvShareDerivation.ts", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toContain("Date.now");
    expect(code).not.toContain("new Date");
    expect(code).not.toMatch(/\bdb\(\)/);
  });

  it("X5 no iterator spread", () => {
    for (const f of files) {
      expect(fs.readFileSync(f, "utf8")).not.toMatch(/\[\.\.\.[A-Za-z_$][\w$]*\.(values|keys|entries)\(\)\]/);
    }
  });

  it("X7 the UI never renders an absent derivation as 0 shares (kills M22)", () => {
    /* Coverage gap found by mutation. `${d.wholeShares ?? 0}` would print
       "Derived shares: 0" when the round has no price — a rendered claim that
       the money bought nothing, on the screen where a GP decides what to write
       to a cap table. Nulls are refusals, never zeros. */
    const ui = readCode("client/src/components/partner/SpvOperationsPanels.tsx");
    const block = ui.slice(ui.indexOf("spv-deployment-derived-shares-"));
    expect(block.slice(0, 400)).toContain("not available");
    expect(ui).not.toMatch(/wholeShares\s*\?\?\s*0/);
    expect(ui).not.toMatch(/wholeShares\s*\|\|\s*0/);
  });

  it("X6 the sacred ledger store is not imported by anything this item added", () => {
    for (const f of files) {
      expect(fs.readFileSync(f, "utf8")).not.toContain("captableCommitStore");
    }
  });
});
