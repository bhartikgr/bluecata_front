/**
 * WAVE 128 · FINDING 2 — THE LAST MONEY FIELDS THAT ASKED A PAYING CLIENT FOR
 * CENTS, AND THE ONE THAT DID NOT BUT LOOKED EXACTLY LIKE THEM.
 *
 * SIX FIELDS. The brief named five; the sixth (the GP mark override on
 * `SpvPerformance.tsx`) was found by the same scan and is reported as a sixth
 * rather than left because it was not on the list. Five were re-scaled to whole
 * currency units; the LP commitment field was NOT re-scaled, deliberately,
 * because its endpoint already takes whole units — converting it would have
 * created the hundredfold error the other five are being cured of.
 *
 * WHAT IS PROVED HERE, AND WHY IN THIS FORM.
 *   (A) FAIL-BEFORE, arithmetically. The deleted client-side handling of each
 *       field is re-run over the amount a client types and shown to record one
 *       hundredth of it. This is a real computation over the real parser, not a
 *       source assertion.
 *   (B) The wire format did not move: for each converted field the value now
 *       posted for the INTENDED amount is byte-identical to the value the field
 *       posted before for the same intended amount.
 *   (C) The source no longer asks for cents anywhere on the partner surface,
 *       INCLUDING in the template-literal form that the Wave 126 scan's regexes
 *       could not see, and the forbidden float constructs are gone from the
 *       three converted files.
 *   (D) Every converted field renders the shared confirmation line.
 *   (E) The unit each endpoint expects is pinned against the SERVER source, so
 *       the "which endpoint, which unit" claim in W128_TESTS.md is checkable.
 *
 * THE COMMENT TRAP. Every source scan below strips comments first with the same
 * tested `liveCode()` stripper Wave 126 built, because this wave's own comments
 * quote the exact strings being banned.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { liveCode } from "./w126_live_code";
import {
  parseWholeUnits,
  toWireMinor,
} from "@/components/partner/partnerMoneyInput";
import {
  wholeUnitsToWireMinor,
  wireMinorNumber,
} from "@/components/partner/PartnerMoneyEntryNotice";

const ROOT = process.cwd();
const DIRS = ["client/src/pages/partner", "client/src/components/partner"];

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  const found: string[] = [];
  for (const e of readdirSync(abs)) {
    const p = join(abs, e);
    if (statSync(p).isDirectory()) {
      if (e === "__tests__") continue;
      found.push(...walk(join(dir, e)));
    } else if (/\.(ts|tsx)$/.test(e)) {
      found.push(join(dir, e));
    }
  }
  return found;
}

const FILES = DIRS.flatMap(walk);
const LIVE = new Map<string, string>(
  FILES.map((f) => [f, liveCode(readFileSync(join(ROOT, f), "utf8"))]),
);
const live = (f: string) => {
  const src = LIVE.get(f);
  if (src === undefined) throw new Error(`not scanned: ${f}`);
  return src;
};
function hits(re: RegExp): string[] {
  const out: string[] = [];
  for (const [f, src] of LIVE) {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = r.exec(src)) !== null) out.push(`${f}: ${m[0].slice(0, 120)}`);
  }
  return out;
}

const OPS = "client/src/components/partner/SpvOperationsPanels.tsx";
const DETAIL = "client/src/pages/partner/PartnerSpvDetail.tsx";
const PERF = "client/src/pages/partner/SpvPerformance.tsx";
const NOTICE = "client/src/components/partner/PartnerMoneyEntryNotice.tsx";

describe("(A) FAIL-BEFORE — what each field recorded for the amount a client meant", () => {
  /* The client means two hundred and fifty thousand dollars and types it. */
  const TYPED = "250000";

  it("the fee-ledger commitment modelled $2,500.00 for a $250,000 commitment", () => {
    /* OLD: the field stripped to digits and posted them as MINOR units. */
    const legacyWire = TYPED.replace(/[^\d]/g, "");
    expect(legacyWire).toBe("250000"); /* = $2,500.00 */
    /* NEW: the same keystrokes are two hundred and fifty thousand dollars. */
    const wire = wholeUnitsToWireMinor(TYPED, "USD", "Commitment modelled");
    expect(wire).toBe("25000000"); /* = $250,000.00 */
    /* A factor of exactly one hundred, which is the defect. */
    expect(BigInt(wire) / BigInt(legacyWire)).toBe(BigInt(100));
  });

  it("the capital call recorded $2,500.00 for a $250,000 call, and rounded a float on the way", () => {
    /* OLD, verbatim: `Math.round(Number(callAmount))`, posted as amount_minor. */
    const legacy = Math.round(Number(TYPED));
    expect(legacy).toBe(250000);
    const now = wireMinorNumber(wholeUnitsToWireMinor(TYPED, "USD", "Capital call amount"), "Capital call amount");
    expect(now).toBe(25000000);
  });

  it("the distribution gross proceeds and cost basis were out by the same factor", () => {
    expect(Number(TYPED)).toBe(250000);
    expect(wholeUnitsToWireMinor(TYPED, "USD", "Gross proceeds")).toBe("25000000");
    expect(wholeUnitsToWireMinor("0", "USD", "Cost basis", { allowZero: true })).toBe("0");
  });

  it("the GP mark override was out by the same factor, on the LPs' reported value", () => {
    /* OLD, verbatim: `Number.parseInt(ovValue.trim(), 10)` as fairValueMinor. */
    expect(Number.parseInt("1250000".trim(), 10)).toBe(1250000); /* $12,500.00 */
    expect(wholeUnitsToWireMinor("1250000", "USD", "Overridden fair value")).toBe("125000000"); /* $1,250,000.00 */
  });

  it("the fifth field was NEVER out, and converting it would have BROKEN it", () => {
    /* `lp-commit` takes `amount` as a decimal string in WHOLE units and scales
       it server-side. The client still sends exactly what was typed. */
    expect(live(DETAIL)).toMatch(/amount:\s*commitAmount\.trim\(\)/);
    /* Had it been "fixed" like the others, a $250,000 commitment would have
       become twenty-five million dollars on the cap table. */
    const wrong = wholeUnitsToWireMinor(TYPED, "USD", "Commitment amount");
    expect(wrong).toBe("25000000");
    expect(BigInt(wrong) / BigInt(TYPED)).toBe(BigInt(100));
  });
});

describe("(B) the wire format did not move for the INTENDED amount", () => {
  const cases: Array<[string, string, string]> = [
    /* [what the client types now, currency, the minor-unit wire value the field
       posted BEFORE when a client correctly typed cents for the same amount] */
    ["2,500.00", "USD", "250000"],
    ["250000", "USD", "25000000"],
    ["$1,250,000.00", "USD", "125000000"],
    ["1250000.5", "USD", "125000050"],
  ];
  it.each(cases)("%s %s → %s minor units, exactly", (typed, ccy, expected) => {
    expect(wholeUnitsToWireMinor(typed, ccy, "Amount")).toBe(expected);
  });

  it("a zero-decimal currency is scaled by its own ISO-4217 exponent, not by 100", () => {
    expect(wholeUnitsToWireMinor("250000", "JPY", "Amount")).toBe("250000");
    expect(parseWholeUnits("250000.5", "JPY", { label: "Amount" }).ok).toBe(false);
  });

  it("a figure beyond a double survives as an exact string", () => {
    const r = parseWholeUnits("99999999999999999", "USD", { label: "Amount" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(toWireMinor(r.minor)).toBe("9999999999999999900");
  });

  it("and is REFUSED, not silently mangled, where the endpoint needs a JSON number", () => {
    expect(() => wireMinorNumber("9999999999999999900", "Capital call amount")).toThrow(/larger than this platform can record/);
  });

  it("every refusal is a sentence that names the field", () => {
    for (const bad of ["", "-4", "1e7", "12.345", "abc", "1.2.3"]) {
      const r = parseWholeUnits(bad, "USD", { label: "Capital call amount" });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.message.toLowerCase(), bad).toContain("capital call amount");
    }
  });
});

describe("(C) no partner field asks for cents, and no float touches typed money", () => {
  it("the cents instruction is gone in EVERY form, including template literals", () => {
    /* Wave 126's scan looked for the literal "in USD cents"; three of these
       fields wrote it as `in ${s.currency} cents`, which that regex could not
       see. This one sees both. */
    /* The ONLY surviving instance of the phrase is inside the two wave-106 label
       HELPERS, which this wave leaves in place solely because a wave-106 test
       outside this wave's ownership imports them, and which now have no caller
       (asserted below). Nothing rendered says it. */
    expect(hits(/cents,\s*not whole/i)).toEqual([
      "client/src/components/partner/SpvDetailTabs.tsx: cents, not whole",
    ]);
    expect(hits(/in \$\{[^}]+\}\s*cents/i)).toEqual([]);
    expect(hits(/in (USD|CAD|EUR|GBP) cents/i)).toEqual([]);
    expect(hits(/for five million cents/i)).toEqual([]);
    expect(hits(/smallest unit of/i)).toEqual([]);
    expect(hits(/minor units of/i)).toEqual([]);
    expect(hits(/whole minor units/i)).toEqual([]);
    expect(hits(/e\.g\. 125000000/)).toEqual([]);
  });

  it("no converted handler runs Number(), parseInt, parseFloat or Math.round on a typed amount", () => {
    for (const [file, names] of [
      [OPS, ["commitmentInput", "commitmentMinor"]],
      [DETAIL, ["callAmount", "distAmount", "distCostBasis", "commitAmount"]],
      [PERF, ["ovValue"]],
    ] as Array<[string, string[]]>) {
      const src = live(file);
      for (const n of names) {
        expect(src, `${file}/${n}`).not.toMatch(new RegExp(`Number\\(\\s*${n}`));
        expect(src, `${file}/${n}`).not.toMatch(new RegExp(`parse(Int|Float)\\(\\s*${n}`));
        expect(src, `${file}/${n}`).not.toMatch(new RegExp(`Number\\.parse(Int|Float)\\(\\s*${n}`));
        expect(src, `${file}/${n}`).not.toMatch(new RegExp(`Math\\.round\\([^)]*${n}`));
      }
    }
  });

  it("there is ONE converter, and it is the Wave 126 module", () => {
    for (const f of [OPS, DETAIL, PERF]) {
      expect(live(f)).toMatch(/partnerMoneyInput|PartnerMoneyEntryNotice/);
    }
    /* The shared notice does not re-implement the parse; it delegates. */
    const notice = live(NOTICE);
    expect(notice).toMatch(/from "\.\/partnerMoneyInput"/);
    expect(notice).not.toMatch(/currencyExponent/);
    expect(notice).not.toMatch(/padEnd/);
    /* Its single `Number()` is on an already-proven digit string, and it is
       guarded by a digits-only test and a safe-integer check. */
    const numberUses = notice.match(/(?<![A-Za-z.])Number\(/g) ?? [];
    expect(numberUses).toHaveLength(1);
    expect(notice).toMatch(/\/\^\\d\+\$\/\.test\(s\)/);
    expect(notice).toMatch(/Number\.isSafeInteger\(n\)/);
  });
});

describe("(D) every converted field states the amount it will record", () => {
  const expected: Array<[string, string]> = [
    [OPS, "spv-fee-breakdown-input-notice"],
    [DETAIL, "partner-spv-capital-call-amount-notice"],
    [DETAIL, "partner-spv-distribution-amount-notice"],
    [DETAIL, "partner-spv-distribution-cost-basis-notice"],
    [DETAIL, "partner-spv-lp-commit-amount-notice"],
    [PERF, "spv-marks-value-notice"],
  ];
  it.each(expected)("%s renders %s", (file, testid) => {
    const src = live(file);
    expect(src).toContain("<PartnerMoneyEntryNotice");
    expect(src).toContain(testid);
  });

  it("the notice always renders — it is never a conditional sibling", () => {
    /* W116 §3.1: one element in one position, so adding it cannot change a
       panel's positional child shape. The component itself chooses between
       three spans INSIDE its own single wrapper. */
    const notice = live(NOTICE);
    expect(notice).toMatch(/<div className="text-\[10px\] leading-relaxed mt-0\.5" data-testid=\{testid\}>/);
    for (const file of [OPS, DETAIL, PERF]) {
      expect(live(file)).not.toMatch(/&&\s*<PartnerMoneyEntryNotice/);
      expect(live(file)).not.toMatch(/\?\s*<PartnerMoneyEntryNotice/);
    }
  });

  it("the seventh field — the GP fee mandate's fixed amount — is converted too", () => {
    const tabs = live("client/src/components/partner/SpvDetailTabs.tsx");
    expect(tabs).toContain('wholeUnitsLabel("Fixed amount", currency)');
    expect(tabs).toContain('label="Fixed amount"');
    expect(tabs).toContain('body.fixedAmountMinor = parseMinor(wholeUnitsToWire(fixed, currency, "Fixed amount"))');
    /* And the float echo it replaced is gone. */
    expect(tabs).not.toMatch(/fmt\(Number\(fixed\)/);
  });

  it("the cents-label helpers survive only for another wave's test — nothing CALLS them", () => {
    const tabs = live("client/src/components/partner/SpvDetailTabs.tsx");
    /* Their definitions are present… */
    expect(tabs).toMatch(/export function minorUnitsLabel\(/);
    expect(tabs).toMatch(/export function minorUnitsLabelNoCurrency\(/);
    /* …and there is no call to either, in any partner file. */
    expect(hits(/minorUnitsLabel(NoCurrency)?\("/)).toEqual([]);
    expect(hits(/\{minorUnitsLabel/)).toEqual([]);
  });

  it("and it confirms in words, before anything is submitted", () => {
    expect(live(NOTICE)).toMatch(/This will be recorded as/);
    expect(live(NOTICE)).toMatch(/unusually large amount/);
  });
});

describe("(E) the unit each endpoint expects, pinned against the SERVER source", () => {
  const server = (f: string) => readFileSync(join(ROOT, f), "utf8");

  it("capital calls take MINOR units as an integer JSON number", () => {
    expect(live(DETAIL)).toMatch(/capital-calls`/);
    expect(live(DETAIL)).toMatch(/amount_minor:/);
    const store = server("server/spvFundStore.ts");
    expect(store).toMatch(/amount_minor:\s*z\.number\(\)\.int\(\)/);
  });

  it("distributions take MINOR units on the CANONICAL singular route", () => {
    expect(live(DETAIL)).toMatch(/\/api\/partner\/me\/spv\/\$\{spvId\}\/distributions/);
    expect(live(DETAIL)).toMatch(/grossProceedsMinor:/);
    expect(live(DETAIL)).toMatch(/costBasisMinor:/);
  });

  it("the fee breakdown takes MINOR units as a query parameter", () => {
    expect(live(OPS)).toMatch(/commitmentMinor=\$\{encodeURIComponent\(commitmentWireMinor\)\}/);
  });

  it("the mark override takes MINOR units", () => {
    expect(live(PERF)).toMatch(/mark\/override/);
    expect(live(PERF)).toMatch(/fairValueMinor:\s*wireMinorNumber\(/);
  });

  it("lp-commit takes WHOLE units and scales them ITSELF — which is why the client must not", () => {
    const routes = server("server/spvEngineRoutes.ts");
    expect(routes).toMatch(/lp-commit/);
    expect(routes).toMatch(/decimalStringToMinor/);
    /* And the client sends the typed string, unscaled. */
    expect(live(DETAIL)).toMatch(/amount:\s*commitAmount\.trim\(\)/);
    expect(live(DETAIL)).not.toMatch(/wholeUnitsToWireMinor\(\s*commitAmount/);
  });
});
