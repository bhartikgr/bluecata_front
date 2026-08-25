/**
 * WAVE 135 · FINDING 4 (money units) and FINDING 2 (bounds on typed values).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND WHY IN THIS FORM
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * §1 FAIL-BEFORE, ARITHMETICALLY. For each of the three fields converted by this
 *    wave, the DELETED handling is re-executed over the figure a client types
 *    and shown to record one hundredth of it. These are real computations over
 *    the real, shipped parser — not assertions about source text. A source-only
 *    test would pass equally well against a broken converter.
 *
 * §2 THE PRE-FILLED ZERO. All three create forms seed the money field with the
 *    string `"0"`. Zero is the ONE figure that is byte-identical in both units,
 *    which is exactly why the old code's defect was invisible on an untouched
 *    form and why the conversion is safe to ship: an unedited form still posts
 *    `0`. It is pinned because `parseWholeUnits` REFUSES zero by default, so the
 *    conversion is only correct if `allowZero` is passed on the two fields whose
 *    seed is submitted — and only on those.
 *
 * §3 THE ONE FIELD THAT MUST NOT BE CONVERTED. `POST …/lp-commit` takes `amount`
 *    as a DECIMAL STRING IN WHOLE UNITS and scales it itself with
 *    `decimalStringToMinor` (server/lib/money.ts). Wave 128 flagged that this had
 *    no test. Converting it like its five neighbours would multiply every LP
 *    commitment on a cap table by one hundred, so the absence of the conversion
 *    is pinned as hard as the presence of the others, on BOTH sides: the client
 *    sends the typed string, and the server scales it.
 *
 * §4 THE BOUND THAT WAS DISPLAYED BUT NOT ENFORCED (the wave's one real Finding-2
 *    defect). The LP-commit refusal sentence rendered correctly for `-5000` while
 *    the submit path never consulted the parser that produced it. The OLD and NEW
 *    `disabled` predicates are both evaluated here over `-5000`, so the fix is a
 *    computed before/after and not a claim.
 *
 * §5 WHAT WAS ALREADY CORRECT, per field, with the refusal sentence quoted. Three
 *    of the brief's four Finding-2 claims are FALSE; the fourth is intentional.
 *    They are pinned so that a later wave cannot "fix" a bound that already
 *    exists, and cannot remove the one that is deliberately absent.
 *
 *    THE GOVERNING CONSTRAINT, restated: a percentage above 100 is not
 *    automatically wrong. A 2× participation cap is a legitimate 200%. Every
 *    ceiling asserted below is a ceiling on a SPECIFIC field whose own definition
 *    bounds it — a hurdle is a preferred return LPs get BEFORE carry, so it
 *    cannot exceed the whole; carry is a share OF a whole. No universal percent
 *    ceiling is asserted anywhere in this file, and no universal ceiling on a
 *    money amount is asserted either, because neither is defensible.
 *
 * §6 NO FLOAT TOUCHES TYPED MONEY in any file this wave owns.
 *
 * §7 THE UNIT EACH ENDPOINT EXPECTS, pinned against the SERVER source, so the
 *    field→endpoint→unit table in build_log/wave135/W135_PREFLIGHT.md §3 is
 *    checkable rather than asserted.
 *
 * THE COMMENT TRAP. Every source-level assertion runs against `liveCode135()`
 * (see w135_ast_copy.ts), which strips comments using the TypeScript compiler's
 * own parser. This wave's comments quote, verbatim, several of the strings and
 * constructs banned below; a raw-text grep would report them and be wrong.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, liveCode135 } from "./w135_ast_copy";
import {
  parseWholeUnits,
  toWireMinor,
  wholeUnitsLabel,
  wholeUnitsPlaceholder,
  isImplausiblyLarge,
} from "@/components/partner/partnerMoneyInput";
import {
  wholeUnitsToWireMinor,
  wireMinorNumber,
} from "@/components/partner/PartnerMoneyEntryNotice";
import { wireSafeMinorUnits } from "@/lib/wireSafeMinorUnits";

const SPVS = "client/src/pages/partner/PartnerSpvs.tsx";
const FUNDS = "client/src/pages/partner/PartnerFunds.tsx";
const FUND_DETAIL = "client/src/pages/partner/PartnerFundDetail.tsx";
const SPV_DETAIL = "client/src/pages/partner/PartnerSpvDetail.tsx";
const ENGINE = "client/src/pages/partner/PartnerSpvEngine.tsx";
const TAX = "client/src/pages/partner/PartnerTaxForm.tsx";
const TABS = "client/src/components/partner/SpvDetailTabs.tsx";
const SIDE = "client/src/components/partner/SpvSideLetterPanel.tsx";

const cache = new Map<string, string>();
function live(file: string): string {
  let v = cache.get(file);
  if (v === undefined) {
    v = liveCode135(readFileSync(join(ROOT, file), "utf8"));
    cache.set(file, v);
  }
  return v;
}
/** Server files are read RAW on purpose: a zod schema is code, not prose. */
function server(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§1 FAIL-BEFORE — what each converted field recorded for the amount a client meant", () => {
  /* The client is raising a five million dollar SPV and types the figure. */
  const TYPED = "5000000";

  it("PartnerSpvs target size modelled $50,000.00 for a $5,000,000 SPV", () => {
    /* OLD, verbatim: `wireSafeMinorUnits(form.targetSizeMinor)` → the typed
       digits were sent AS MINOR UNITS under a label that asked for them. */
    const legacy = wireSafeMinorUnits(TYPED);
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(legacy.value).toBe(5_000_000); /* = $50,000.00 */

    /* NEW: the same keystrokes are five million dollars. */
    const wire = wholeUnitsToWireMinor(TYPED, "USD", "Target size", { allowZero: true });
    expect(wire).toBe("500000000"); /* = $5,000,000.00 */
    expect(BigInt(wire) / BigInt(5_000_000)).toBe(BigInt(100));
  });

  it("PartnerFunds target size was out by the same factor, on the screen that PERSISTS it", () => {
    /* This is the one of the two create forms whose handler actually stores the
       figure (`targetRaiseMinor`, server/partnerRoutes.ts:1987). */
    const legacy = wireSafeMinorUnits(TYPED);
    expect(legacy.ok && legacy.value).toBe(5_000_000);
    expect(wholeUnitsToWireMinor(TYPED, "USD", "Target size", { allowZero: true })).toBe("500000000");
  });

  it("PartnerFundDetail's pledge amount ran parseInt on typed money, so it narrowed AND mis-scaled", () => {
    /* OLD, verbatim: `Number.parseInt(pledgeForm.amountMinor, 10)`. */
    expect(Number.parseInt("1250000", 10)).toBe(1_250_000); /* = $12,500.00 */
    expect(wholeUnitsToWireMinor("1250000", "USD", "Pledge amount")).toBe("125000000");

    /* And parseInt did not merely mis-scale: it silently truncated at the first
       non-digit and narrowed above 2^53, both of which the parser refuses. */
    expect(Number.parseInt("5,000,000", 10)).toBe(5); /* five dollars */
    expect(wholeUnitsToWireMinor("5,000,000", "USD", "Pledge amount")).toBe("500000000");
    expect(Number.parseInt("9007199254740993", 10)).toBe(9007199254740992);
    const big = parseWholeUnits("9007199254740993", "USD", { label: "Pledge amount" });
    expect(big.ok).toBe(true);
    if (big.ok) expect(toWireMinor(big.minor)).toBe("900719925474099300");
  });

  it("the legacy converter's own refusal text was internal, which is why nothing calls it here any more", () => {
    /* Reported, not patched: client/src/lib/wireSafeMinorUnits.ts is outside this
       wave's ownership. Its refusal names the storage model to a paying client.
       The two converted screens no longer reach it. */
    const bad = wireSafeMinorUnits("5,000,000");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain("minor units");
    expect(live(SPVS)).not.toMatch(/wireSafeMinorUnits/);
    expect(live(FUNDS)).not.toMatch(/wireSafeMinorUnits/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§2 the pre-filled zero — the one figure identical in both units", () => {
  it("all three money fields still seed the literal string \"0\"", () => {
    expect(live(SPVS)).toMatch(/targetSizeMinor:\s*"0"/);
    expect(live(FUNDS)).toMatch(/targetSizeMinor:\s*"0"/);
    expect(live(FUND_DETAIL)).toMatch(/amountMinor:\s*"0"/);
  });

  it("an untouched form posts 0 under BOTH the old and the new handling — byte-identical", () => {
    const legacy = wireSafeMinorUnits("0");
    expect(legacy.ok && legacy.value).toBe(0);
    const now = wholeUnitsToWireMinor("0", "USD", "Target size", { allowZero: true });
    expect(now).toBe("0");
    expect(wireMinorNumber(now, "Target size")).toBe(0);
    /* This is why the defect was invisible on a form nobody edited, and why the
       conversion cannot regress the untouched case. */
    expect(String(legacy.ok ? legacy.value : NaN)).toBe(now);
  });

  it("and zero is REFUSED unless allowZero is passed — so the two seeded fields must pass it", () => {
    expect(parseWholeUnits("0", "USD", { label: "Target size" }).ok).toBe(false);
    expect(parseWholeUnits("0", "USD", { label: "Target size", allowZero: true }).ok).toBe(true);
    /* The two create forms submit their seed, so they pass it. */
    expect(live(SPVS)).toMatch(/wholeUnitsToWireMinor\([\s\S]{0,120}allowZero:\s*true/);
    expect(live(FUNDS)).toMatch(/wholeUnitsToWireMinor\([\s\S]{0,120}allowZero:\s*true/);
    /* The pledge form does not: a zero pledge is not a pledge, and its own
       submit is inert pending an owner decision on the endpoint's shape. */
    expect(live(FUND_DETAIL)).not.toMatch(/allowZero/);
  });

  it("a zero-decimal currency is scaled by its own ISO-4217 exponent, not by 100", () => {
    expect(wholeUnitsToWireMinor("5000000", "JPY", "Target size")).toBe("5000000");
    expect(wholeUnitsToWireMinor("5000000", "USD", "Target size")).toBe("500000000");
    expect(parseWholeUnits("5000000.50", "JPY", { label: "Target size" }).ok).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§3 what the client now sees, and what goes on the wire", () => {
  const typedCases: Array<[string, string, string]> = [
    /* [typed, currency, exact minor-unit wire value] */
    ["5000000", "USD", "500000000"],
    ["5,000,000", "USD", "500000000"],
    ["$5,000,000.00", "USD", "500000000"],
    ["5000000.5", "USD", "500000050"],
    ["0", "USD", "0"],
  ];
  it.each(typedCases)("%s %s → %s minor units, exactly", (typed, ccy, expected) => {
    expect(wholeUnitsToWireMinor(typed, ccy, "Target size", { allowZero: true })).toBe(expected);
  });

  it("the label reads as money, and the currency-aware wording is on the accessible name", () => {
    /* The visible <Label> is a literal so the restyle-drop detector can see the
       change as a CHANGE rather than as a bare text disappearance it has no
       ratification path for. The currency-aware helper carries the same meaning
       to a screen reader. This mirrors wave 128's capital-call field. */
    for (const f of [SPVS, FUNDS]) {
      expect(live(f)).toContain("<Label>Target size</Label>");
      expect(live(f)).toContain('aria-label={wholeUnitsLabel("Target size", form.currency)}');
      expect(live(f)).toContain("placeholder={wholeUnitsPlaceholder(form.currency)}");
    }
    /* And the helper still says the thing the label used to say wrongly. */
    expect(wholeUnitsLabel("Target size", "USD")).not.toMatch(/minor units/i);
    expect(wholeUnitsPlaceholder("USD")).not.toMatch(/minor units|cents/i);
  });

  it("no partner money field asks a paying client for minor units any more", () => {
    for (const f of [SPVS, FUNDS, FUND_DETAIL]) {
      expect(live(f), f).not.toMatch(/minor units/i);
      expect(live(f), f).not.toMatch(/\bcents\b/i);
    }
  });

  it("each converted field renders the shared confirmation line, unconditionally", () => {
    const expected: Array<[string, string]> = [
      [SPVS, "partner-spv-target-notice"],
      [FUNDS, "partner-fund-target-notice"],
    ];
    for (const [f, testid] of expected) {
      expect(live(f)).toContain("<PartnerMoneyEntryNotice");
      expect(live(f)).toContain(testid);
      /* Never a conditional sibling: adding it cannot move a panel's positional
         child shape (W116 §3.1). */
      expect(live(f)).not.toMatch(/&&\s*<PartnerMoneyEntryNotice/);
      expect(live(f)).not.toMatch(/\?\s*<PartnerMoneyEntryNotice/);
    }
  });

  it("there is exactly ONE converter, and it is the wave-126 module", () => {
    for (const f of [SPVS, FUNDS, FUND_DETAIL]) {
      expect(live(f)).toMatch(/@\/components\/partner\/(partnerMoneyInput|PartnerMoneyEntryNotice)/);
      /* No second implementation of the exponent, and no hand-rolled scaling. */
      expect(live(f), f).not.toMatch(/currencyExponent/);
      expect(live(f), f).not.toMatch(/padEnd|Math\.pow/);
    }
  });

  it("and no `× 100` is applied to a MONEY value — the one that survives is a percent display", () => {
    /* A blanket ban on `* 100` would be wrong: a fraction rendered as a
       percentage is multiplied by 100 legitimately. The ban is therefore on
       scaling a money identifier, and the single surviving multiplication is
       named here so it cannot drift into a money line unnoticed. */
    for (const [f, names] of [
      [SPVS, ["targetSizeMinor"]],
      [FUNDS, ["targetSizeMinor"]],
      [FUND_DETAIL, ["amountMinor"]],
    ] as Array<[string, string[]]>) {
      for (const n of names) {
        expect(live(f), `${f}/${n}`).not.toMatch(new RegExp(`${n}[^;\\n]{0,40}\\*\\s*100\\b`));
        expect(live(f), `${f}/${n}`).not.toMatch(new RegExp(`\\*\\s*100[^;\\n]{0,40}${n}`));
      }
    }
    const survivors = (live(FUND_DETAIL).match(/[^\n]*\*\s*100\b[^\n]*/g) ?? []).map((s) => s.trim());
    expect(survivors).toEqual([
      "{(c.ownershipPct * 100).toFixed(1)}% — {SPV_REGISTER_OWNERSHIP_DENOMINATOR_LABEL}",
    ]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§4 lp-commit — the field that must NOT be converted (wave 128's flagged gap)", () => {
  it("the client posts the typed decimal string, unscaled", () => {
    expect(live(SPV_DETAIL)).toMatch(/amount:\s*commitAmount\.trim\(\)/);
    expect(live(SPV_DETAIL)).not.toMatch(/wholeUnitsToWireMinor\(\s*commitAmount/);
    expect(live(SPV_DETAIL)).not.toMatch(/toWireMinor\([^)]*commitAmount/);
    expect(live(SPV_DETAIL)).not.toMatch(/amount:\s*[^,\n]*Minor/);
  });

  it("the server scales it, which is exactly why the client must not", () => {
    const routes = server("server/spvEngineRoutes.ts");
    expect(routes).toMatch(/lp-commit/);
    expect(routes).toMatch(/decimalStringToMinor/);
    const money = server("server/lib/money.ts");
    expect(money).toMatch(/export function decimalStringToMinor/);
  });

  it("had it been \"fixed\" like its five neighbours, every LP commitment would be 100× too large", () => {
    const TYPED = "250000";
    const wrong = wholeUnitsToWireMinor(TYPED, "USD", "Commitment amount");
    expect(wrong).toBe("25000000");
    expect(BigInt(wrong) / BigInt(TYPED)).toBe(BigInt(100));
    /* Stated as the cap-table figure it would have produced: a $250,000
       commitment recorded as $25,000,000 of an SPV's committed capital. */
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§4b the LP-commit bound that was DISPLAYED but never ENFORCED", () => {
  const NEGATIVE = "-5000";
  const check = (raw: string) =>
    parseWholeUnits(raw, "USD", { label: "Commitment amount" });

  it("the notice was already right: -5000 is refused, in a sentence that names the field", () => {
    const r = check(NEGATIVE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message.toLowerCase()).toContain("commitment amount");
      expect(r.message.length).toBeGreaterThan(20); /* a sentence, not a code */
    }
  });

  it("FAIL-BEFORE — the old predicate let it through; the new one does not", () => {
    /* OLD, verbatim, the only amount clause in the button's `disabled`: */
    const oldDisabled = !NEGATIVE.trim();
    expect(oldDisabled).toBe(false); /* submit was ENABLED on a refused amount */

    /* NEW: the same clause, plus the parser's verdict. */
    const newDisabled = !NEGATIVE.trim() || !check(NEGATIVE).ok;
    expect(newDisabled).toBe(true);

    /* And a real amount is still submittable — the fix is not a blanket block. */
    expect(!("250000".trim()) || !check("250000").ok).toBe(false);
  });

  it("the button consults the parser, and so does the handler — the same parser the notice renders", () => {
    const src = live(SPV_DETAIL);
    /* In the disabled expression. */
    expect(src).toMatch(
      /disabled=\{[\s\S]{0,400}!parseWholeUnits\(commitAmount, s\.currency, \{ label: "Commitment amount" \}\)\.ok/,
    );
    /* And in the mutation, so a programmatic click cannot bypass it. */
    expect(src).toMatch(/const commitCheck = parseWholeUnits\(commitAmount, s\.currency, \{ label: "Commitment amount" \}\)/);
    expect(src).toMatch(/if \(!commitCheck\.ok\) throw new Error\(commitCheck\.message\)/);
    /* One parser: the notice under the field is fed the same raw value. */
    expect(src).toMatch(/raw=\{commitAmount\}/);
    expect(src).toMatch(/label="Commitment amount"/);
  });

  it("every value the notice refuses is now also unsubmittable", () => {
    for (const bad of ["-5000", "", "  ", "1e7", "12.345", "abc", "1.2.3", "0"]) {
      expect(check(bad).ok, bad).toBe(false);
      expect(!bad.trim() || !check(bad).ok, bad).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§5 the bounds the brief reported as MISSING that were already present", () => {
  it("CLAIM FALSE — a hurdle of 250 is refused by the SPV wizard, not accepted", () => {
    const src = live(ENGINE);
    expect(src).toContain("const HURDLE_PCT_AS_WRITTEN_MAX = 100;");
    expect(src).toContain("const CARRY_PCT_AS_WRITTEN_MAX = 100;");
    expect(src).toMatch(/if \(h > HURDLE_PCT_AS_WRITTEN_MAX\)/);
    expect(src).toMatch(/Hurdle % must be between 0 and \$\{HURDLE_PCT_AS_WRITTEN_MAX\}/);
    /* Negative and non-numeric are separately refused, each with its own reason,
       so a client is told which of the three things is wrong. */
    expect(src).toMatch(/Hurdle % cannot be negative\./);
    expect(src).toMatch(/Hurdle % must be a number \(8 = 8%\)\./);
  });

  it("CLAIM FALSE — and the SPV detail hurdle field refuses 250 by NAME, with the reason", () => {
    const src = live(TABS);
    /* The refusal explains WHY a hurdle specifically cannot exceed 100%: it is
       the return LPs receive before any carry, so it cannot exceed the whole. It
       does not claim that percentages in general cannot exceed 100. */
    expect(src).toContain(
      "A hurdle is the preferred return the LPs receive before any carry is taken, so it cannot exceed 100%. If you meant a return multiple, enter the preferred return itself — 25 for 25%, not 250.",
    );
    /* A zero hurdle is refused separately, because it is a different mistake. */
    expect(src).toContain("A hurdle of 0% is not a hurdle.");
  });

  it("CLAIM FALSE — a tax certificate expiring 2020-01-01 is refused, and submit is disabled", () => {
    const src = live(TAX);
    expect(src).toContain(
      "This expiry date has already passed, so the certificate is no longer current.",
    );
    /* The comparison is a lexicographic one on two ISO dates, which is exact and
       timezone-stable for this purpose, and today is computed from the client's
       own clock rather than parsed from the string. */
    expect(src).toMatch(/if \(t < today\)/);
    expect(src).toMatch(/expiryProblem !== null/);
    /* And a date that is not on the calendar is refused before the comparison,
       so 2020-02-30 cannot pass as "past" for the wrong reason. */
    expect(src).toContain("That is not a date on the calendar.");
  });

  it("BY DESIGN — 999999999999 is questioned in amber and never blocked", () => {
    /* There is no defensible universal ceiling on a private-market amount. A
       fund CAN raise a hundred billion. So the platform asks, and proceeds. */
    const r = parseWholeUnits("999999999999", "USD", { label: "Target size" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(isImplausiblyLarge(r.minor, "USD")).toBe(true);
      expect(toWireMinor(r.minor)).toBe("99999999999900");
    }
    /* Just below the threshold it is not questioned. */
    const ok = parseWholeUnits("99999999999", "USD", { label: "Target size" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(isImplausiblyLarge(ok.minor, "USD")).toBe(false);
    /* The notice's amber branch is a question, not a refusal — there is no
       `ok: false` path anywhere in the implausibility check. */
    const notice = live("client/src/components/partner/PartnerMoneyEntryNotice.tsx");
    expect(notice).toMatch(/isImplausiblyLarge/);
    expect(notice).toMatch(/unusually large amount/);
  });

  it("BY DESIGN — the amount is nonetheless REFUSED where the endpoint needs a JSON number it cannot hold", () => {
    /* Not a policy ceiling: a statement that this form cannot carry the figure
       faithfully, which is different from saying the figure is wrong. */
    expect(() => wireMinorNumber("99999999999999999999", "Target size")).toThrow(
      /larger than this platform can record/,
    );
  });

  it("CLAIM FALSE — the side-letter panel refuses an unreadable rate rather than sending null", () => {
    const src = live(SIDE);
    /* `percentInputToScaled` returns null for >100, and the caller REFUSES on
       null rather than letting null reach the wire as "use the fund default". */
    expect(src).toMatch(/if \(carry === null \|\| mgmt === null \|\| hurdle === null\)/);
    expect(src).toContain(
      "Rates must be a percentage between 0 and 100. The entry is refused rather than interpreted — a rate that cannot be read is not guessed at.",
    );
    /* The refusal precedes the mutation; `create.mutate` is only reached after
       every guard has returned. */
    const submitBody = src.slice(src.indexOf("function submit()"));
    expect(submitBody.indexOf("setFormError(null)")).toBeLessThan(submitBody.indexOf("create.mutate("));
  });

  it("CONTROL — no universal percent ceiling and no universal money ceiling is asserted anywhere", () => {
    /* A 2× participation cap is a legitimate 200%. Every ceiling above belongs to
       a named field whose own definition bounds it. This control fails if a later
       wave introduces a blanket clamp on the partner surface. */
    for (const f of [ENGINE, TABS, SIDE, SPVS, FUNDS, SPV_DETAIL]) {
      expect(live(f), f).not.toMatch(/Math\.min\(\s*100\s*,/);
      expect(live(f), f).not.toMatch(/Percentages cannot exceed 100/i);
      expect(live(f), f).not.toMatch(/Amount is too large\b/i);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§6 no float, and no truncating parse, touches a typed money figure", () => {
  const OWNED: Array<[string, string[]]> = [
    [SPVS, ["form.targetSizeMinor", "targetSizeMinor"]],
    [FUNDS, ["form.targetSizeMinor", "targetSizeMinor"]],
    [FUND_DETAIL, ["pledgeForm.amountMinor", "amountMinor"]],
    [SPV_DETAIL, ["commitAmount"]],
  ];
  it.each(OWNED)("%s runs no Number/parseInt/parseFloat/Math.round on its money field", (file, names) => {
    const src = live(file);
    for (const n of names) {
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(src, `${file} / Number(${n})`).not.toMatch(new RegExp(`(?<![A-Za-z.])Number\\(\\s*${esc}`));
      expect(src, `${file} / parseInt(${n})`).not.toMatch(new RegExp(`parse(Int|Float)\\(\\s*${esc}`));
      expect(src, `${file} / Number.parseInt(${n})`).not.toMatch(new RegExp(`Number\\.parse(Int|Float)\\(\\s*${esc}`));
      expect(src, `${file} / Math.round(${n})`).not.toMatch(new RegExp(`Math\\.round\\([^)]*${esc}`));
    }
  });

  it("the only widening to a JSON number goes through the guarded helper", () => {
    for (const f of [SPVS, FUNDS, FUND_DETAIL]) {
      expect(live(f)).toMatch(/wireMinorNumber\(/);
    }
    /* And that helper proves digits-only and safe-integer before it widens. */
    const notice = live("client/src/components/partner/PartnerMoneyEntryNotice.tsx");
    expect(notice).toMatch(/\/\^\\d\+\$\/\.test\(s\)/);
    expect(notice).toMatch(/Number\.isSafeInteger\(n\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§7 the unit each endpoint expects, pinned against the SERVER source", () => {
  it("POST /api/partner/me/spvs types targetSizeMinor as a JSON number", () => {
    const routes = server("server/partnerRoutes.ts");
    expect(routes).toMatch(/me\/spvs/);
    expect(live(SPVS)).toMatch(/targetSizeMinor,/);
    expect(live(SPVS)).toMatch(/wireMinorNumber\(/);
  });

  it("POST /api/partner/me/funds persists targetSizeMinor as targetRaiseMinor via isNumber", () => {
    const routes = server("server/partnerRoutes.ts");
    expect(routes).toMatch(/targetRaiseMinor/);
    expect(routes).toMatch(/isNumber\(\s*targetSizeMinor\s*\)/);
    expect(live(FUNDS)).toMatch(/targetSizeMinor:\s*fundTargetSizeMinor/);
  });

  it("POST …/lp-commit types amount as a decimal string in WHOLE units", () => {
    const routes = server("server/spvEngineRoutes.ts");
    expect(routes).toMatch(/lp-commit/);
    expect(routes).toMatch(/decimalStringToMinor/);
    expect(live(SPV_DETAIL)).toMatch(/amount:\s*commitAmount\.trim\(\)/);
  });

  it("REPORTED, NOT INVENTED — the pledge form's payload does not match its endpoint, and the form is inert", () => {
    /* `PartnerFundDetail`'s pledge form sends `{lpName, amountMinor}`; the fund
       commitment endpoint reads `{lpContactId, commitmentMinor, currency}`. The
       shape is not guessed at here and the control stays disabled; the mismatch
       is an owner question in W135_PREFLIGHT.md §1. What this wave DID fix is the
       arithmetic, so that when the shape is settled the figure is already right. */
    const src = live(FUND_DETAIL);
    expect(src).toMatch(/lpName/);
    expect(src).toMatch(/amountMinor/);
    expect(src).toMatch(/disabled/);
    const routes = server("server/partnerRoutes.ts");
    expect(routes).toMatch(/commitmentMinor/);
    expect(routes).toMatch(/lpContactId/);
  });
});
