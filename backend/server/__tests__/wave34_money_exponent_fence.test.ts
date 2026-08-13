/**
 * WAVE 34 · TASK 3 — the standing guard, pinned.
 *
 * The lesson this repo has learned 25+ times is "a check that passed while
 * checking nothing". A fence that only ever runs against a green tree proves
 * nothing at all: it would pass identically if `runMoneyExponentFence()`
 * returned `{ ok: true }` unconditionally.
 *
 * So this file asserts BOTH POLES, twice over:
 *
 *   NEGATIVE POLE — a synthetic source tree containing a hardcoded exponent on
 *     a monetary value must be REPORTED, for each of the three shapes
 *     (`/ 100`, `* 100`, and `ROUND(x * 100` inside an SQL string).
 *   POSITIVE POLE — the same tree with the correct `fromMinor`/`toMinor`
 *     construction must come back clean, as must percentages and progress bars,
 *     which use the identical literal legitimately.
 *
 * Plus a live pin: the REAL repository must be green, and the baseline must
 * still match line-for-line (a moved baseline line is a re-justification
 * event, not an inheritance).
 *
 * Static imports throughout. No `process.env`. The synthetic tree is built by
 * the test itself, so the test establishes its own preconditions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runMoneyExponentFence,
  maskComments,
  isMonetaryLine,
  BASELINE,
} from "../../scripts/lint/moneyExponentFence";

/* ── A synthetic repo, so the fence is exercised on inputs we control ────── */

let TMP = "";

function put(rel: string, body: string): void {
  const abs = path.join(TMP, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "w34-fence-"));
  fs.mkdirSync(path.join(TMP, "server"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "client/src"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "shared"), { recursive: true });
});

afterAll(() => {
  if (TMP) fs.rmSync(TMP, { recursive: true, force: true });
});

function scan() {
  return runMoneyExponentFence(TMP);
}

function clear() {
  for (const r of ["server", "client/src", "shared"]) {
    fs.rmSync(path.join(TMP, r), { recursive: true, force: true });
    fs.mkdirSync(path.join(TMP, r), { recursive: true });
  }
}

/* ── N — THE NEGATIVE POLE: the fence must actually catch things ─────────── */

describe("N — the fence goes RED on a new hardcoded currency exponent", () => {
  it("N1 catches `/ 100` on a minor-unit money value", () => {
    clear();
    put("server/newBillingSurface.ts", `
export function render(amountMinor: number): string {
  return "$" + (amountMinor / 100).toFixed(2);
}
`);
    const r = scan();
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.patternId)).toContain("div100");
    expect(r.violations[0].file).toBe("server/newBillingSurface.ts");
    expect(r.violations[0].line).toBe(3);
  });

  it("N2 catches `Math.round(x * 100)` converting major → minor", () => {
    clear();
    put("server/newIntakeRoute.ts", `
export function toStorage(invoiceMajor: number): number {
  return Math.round(invoiceMajor * 100);
}
`);
    const r = scan();
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.patternId)).toContain("mul100");
  });

  it("N3 catches the exponent buried in an SQL string — the Wave 33 shape", () => {
    clear();
    put("server/newAggregate.ts", `
export const SQL = \`
  SELECT CAST(ROUND(sc.payment_amount * 100) AS INTEGER) AS amount_minor
  FROM some_charges sc
\`;
`);
    const r = scan();
    expect(r.ok).toBe(false);
    const ids = r.violations.map((v) => v.patternId);
    expect(ids.some((id) => id === "sqlRound100" || id === "mul100")).toBe(true);
  });

  it("N4 catches it in client/src and in shared, not only server", () => {
    clear();
    put("client/src/NewPanel.tsx", `export const f = (priceMinor: number) => priceMinor / 100;\n`);
    put("shared/newCalc.ts", `export const g = (feeMinor: number) => feeMinor / 100;\n`);
    const r = scan();
    expect(r.violations.map((v) => v.file).sort()).toEqual([
      "client/src/NewPanel.tsx",
      "shared/newCalc.ts",
    ]);
  });

  it("N5 the failure message names the file, the line, the text and the remedy", () => {
    clear();
    put("server/newBillingSurface.ts", `export const f = (amountMinor: number) => amountMinor / 100;\n`);
    const r = scan();
    const v = r.violations[0];
    expect(v.file).toBe("server/newBillingSurface.ts");
    expect(v.line).toBe(1);
    expect(v.text).toContain("amountMinor / 100");
    expect(v.detail).toMatch(/fromMinor/);
  });
});

/* ── P — THE POSITIVE POLE: it must not cry wolf ─────────────────────────── */

describe("P — the fence stays GREEN on correct and on non-money code", () => {
  it("P1 the correct construction passes", () => {
    clear();
    put("server/goodSurface.ts", `
import { fromMinor, toMinor, formatMinor } from "./lib/currency";
export function render(amountMinor: number, currency: string): string {
  return formatMinor(amountMinor, currency, { locale: "en-US" });
}
export function store(major: number, currency: string): number {
  return toMinor(major, currency);
}
export function major(amountMinor: number, currency: string): number {
  return fromMinor(amountMinor, currency);
}
`);
    expect(scan().ok).toBe(true);
  });

  it("P2 percentages, progress bars and scores are NOT money and pass", () => {
    clear();
    put("client/src/Progress.tsx", `
export const pct = (done: number, total: number) => Math.round((done / total) * 100);
export const readiness = (score: number) => score / 100;
export const bar = (v: number) => ({ width: (v * 100) + "%" });
export const bps = (rate: number) => Math.round(rate * 100);
`);
    const r = scan();
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("P3 a percentage OF an amount is still a percentage, not a money exponent", () => {
    clear();
    put("server/feeRate.ts", `
export const feeRatePct = (feeMinor: number, amountMinor: number) =>
  Math.round((feeMinor / amountMinor) * 100);
`);
    expect(scan().ok).toBe(true);
  });

  it("P4 a documented example inside a comment is not a violation", () => {
    clear();
    put("server/documented.ts", `
/* The old code was: Math.round(amountMinor / 100) — see WAVE34_REPORT.md.
 * It is quoted here on purpose so the next reader knows what was wrong. */
// also: return invoice.amountMinor / 100;
export const ok = 1;
`);
    const r = scan();
    expect(r.violations).toEqual([]);
  });

  it("P5 test files are out of scope — a JPY fixture may assert 100x deliberately", () => {
    clear();
    put("server/__tests__/some.test.ts", `expect(invoice.amountMinor / 100).toBe(12000);\n`);
    put("server/other.test.ts", `expect(invoice.amountMinor / 100).toBe(12000);\n`);
    const r = scan();
    expect(r.violations).toEqual([]);
  });
});

/* ── M — THE MASKER, which is where a fence like this usually breaks ─────── */

describe("M — the comment masker parses well enough to be trusted", () => {
  it("M1 strips line and block comments but keeps the code around them", () => {
    const out = maskComments(`const a = 1; // amountMinor / 100\n/* b / 100 */ const c = amountMinor / 100;\n`);
    expect(out).not.toContain("// amountMinor");
    expect(out).toContain("const a = 1;");
    expect(out.split("\n")[1]).toContain("amountMinor / 100");
  });

  it("M2 keeps STRING contents — SQL lives in strings and must still be scanned", () => {
    const out = maskComments('const q = "ROUND(x * 100)";\n');
    expect(out).toContain("ROUND(x * 100)");
  });

  it("M3 a regex literal does not put the masker into a permanent string state", () => {
    /* This is the real bug found while building the fence: a
     * `/[,\n\r"]/` in adminPlatformStore.ts left an unterminated `"` and every
     * comment after it was scanned as live code. */
    const out = maskComments(
      'const NEEDS_QUOTE = /[,\\n\\r"]/;\n/* quoted example: amountMinor / 100 */\nconst z = 1;\n',
    );
    expect(out).not.toContain("amountMinor / 100");
    expect(out).toContain("const z = 1;");
  });

  it("M4 isMonetaryLine separates the two uses of the same literal", () => {
    expect(isMonetaryLine("return amountMinor / 100;")).toBe(true);
    expect(isMonetaryLine("return Math.round((done / total) * 100); // progressPct")).toBe(false);
    expect(isMonetaryLine("return score / 100;")).toBe(false);
  });
});

/* ── L — THE LIVE PIN: the real repository ───────────────────────────────── */

describe("L — the real repository is fenced and the baseline is honest", () => {
  const live = runMoneyExponentFence();

  it("L1 the repository is GREEN", () => {
    const msg = live.violations
      .map((v) => `${v.file}:${v.line} ${v.text}`)
      .concat(live.staleBaseline)
      .join("\n");
    expect(msg).toBe("");
    expect(live.ok).toBe(true);
  });

  it("L2 the fence actually scanned the tree (not an empty file list)", () => {
    expect(live.filesScanned).toBeGreaterThan(500);
  });

  it("L3 every baselined line still exists exactly where it was baselined", () => {
    expect(live.staleBaseline).toEqual([]);
    expect(live.baselineHits).toBe(BASELINE.length);
  });

  it("L4 no baseline entry may exist without a stated reason", () => {
    for (const b of BASELINE) {
      expect(b.why.length).toBeGreaterThan(30);
    }
  });
});
