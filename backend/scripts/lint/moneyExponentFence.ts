/**
 * scripts/lint/moneyExponentFence.ts
 *
 * WAVE 34 · TASK 3 — the standing guard for the money-exponent defect class.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * A hardcoded `/ 100` or `* 100` on a monetary value encodes an ISO-4217
 * exponent of 2 as if it were a law of arithmetic. It is not: JPY and KRW are
 * exponent 0, and BHD/JOD/KWD are exponent 3. Every such site renders JPY wrong
 * by a factor of 100 — on invoices, on billing screens, on the public pricing
 * page. The defect is INVISIBLE in USD, which is why it survived so long and
 * why every fixture that catches it must be non-USD.
 *
 * Wave 33 fixed six instances. Wave 33C's re-sweep found five more. Wave 34
 * fixed those five and then found FIVE MORE by sweeping to exhaustion. The
 * class does not stop regenerating by being fixed; it stops by being fenced.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE
 * ─────────────────────────────────────────────────────────────────────────────
 * M1 — NO HARDCODED CURRENCY EXPONENT. In `server/`, `client/src/` and
 *      `shared/`, an expression that divides by or multiplies by the literal
 *      100 (including inside an SQL string, e.g.
 *      `CAST(ROUND(sc.amount * 100) AS INTEGER)`, which is where Wave 33 found
 *      one) is a violation WHEN the expression is monetary.
 *
 * "Monetary" is decided by the vocabulary actually present on the line: a money
 * noun (`amountMinor`, `priceMinor`, `cents`, `invoice`, `fee`, `arr`, …). The
 * fence deliberately does NOT flag `(done / total) * 100` or `score / 100` —
 * percentages, scores and progress bars are a different, legitimate use of the
 * same literal, and a fence that cried wolf on 140 of them would be switched
 * off within a week. Precision over recall is the design choice; the
 * exhaustive sweep in WAVE34_REPORT.md is the recall backstop.
 *
 * The correct construction in every case:
 *     server/lib/currency.ts  → currencyExponent · toMinor · fromMinor · formatMinor
 *     client/src/lib/currency.ts → formatMinor · fromMinor
 *     client/src/lib/moneyDisplay.ts → minorToMajorString · formatMinorOrUnavailable
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BASELINE
 * ─────────────────────────────────────────────────────────────────────────────
 * `BASELINE` below pins the money-flavoured sites that WAVE34_REPORT.md
 * classified as category 3 — money, but provably exponent-safe, each with the
 * reason stated inline. The fence starts GREEN against the tree as it stands
 * after Wave 34, and goes RED on anything NEW.
 *
 * A baseline entry is keyed by `file:line:normalisedText`. If the line moves,
 * the entry stops matching and the fence goes red — deliberately: a moved line
 * is a line someone edited, and it should be re-justified rather than inherited.
 * Every entry carries a `why`, so nobody can extend the baseline silently.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

const SCAN_ROOTS = ["server", "client/src", "shared"] as const;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "__tests__", ".git"]);
const SOURCE_EXT = new Set([".ts", ".tsx"]);

/** Money vocabulary. A line must contain one of these to be considered monetary. */
const MONEY_TOKENS = [
  "minor",
  "amountminor", "amount_minor", "priceminor", "price_minor", "pricecents",
  "annualpricecents", "cents", "minorunits", "minor_units", "totalminor",
  "committedminor", "wiredminor", "commitmentminor", "fixedamountminor",
  "pastdueminor", "annualamountminor", "feeminor", "amountcents",
  "invoice", "billing", "subscription", "payout", "payment", "charge",
  "applicationfee", "platformfee", "valuation", "raiseamount", "chequesize",
] as const;

/** Tokens that make a line NOT money even if a money token appears —
 *  a percentage OF an amount is still a percentage. */
const PERCENT_TOKENS = [
  "pct", "percent", "rate", "ratio", "score", "progress", "bps", "basispoint",
  "share", "weight", "opacity", "width:",
] as const;

/** The exponent-2 shapes, including the SQL form. */
const PATTERNS: Array<{ id: string; re: RegExp; detail: string }> = [
  {
    id: "div100",
    re: /\/\s*100\b(?!\s*[._\d])/,
    detail: "divides by the literal 100 — use fromMinor(minor, currency) / formatMinor(...)",
  },
  {
    id: "mul100",
    /* `(a / b) * 100` is a RATIO expressed as a percentage — a quotient of two
     * money figures is not money, it is a rate, and ×100 is the right and only
     * way to render it. Excluded by the negative lookbehind-style guard in
     * `isPercentOfQuotient` rather than by vocabulary, because the identifier
     * that names it (`feeRatePct`) is often on the line above. */
    re: /\*\s*100\s*\)/,
    detail: "multiplies by the literal 100 — use toMinor(major, currency)",
  },
  {
    id: "sqlRound100",
    re: /ROUND\s*\([^)]*\*\s*100/i,
    detail:
      "converts to minor units INSIDE an SQL string, where the ISO-4217 exponent cannot be " +
      "applied — select the raw value and convert in JS with toMinor(...)",
  },
];

export interface Violation {
  rule: "M1";
  patternId: string;
  file: string;
  line: number;
  text: string;
  detail: string;
}

export interface FenceResult {
  ok: boolean;
  filesScanned: number;
  violations: Violation[];
  baselineHits: number;
  staleBaseline: string[];
}

/* ── BASELINE — category-3 sites (money, provably exponent-safe) ─────────── */

interface BaselineEntry {
  file: string;
  line: number;
  /** Normalised (whitespace-collapsed) source text, so a reformat is caught. */
  text: string;
  why: string;
}

/*
 * WAVE 36 · ROW 4 — THE BASELINE WAS RED, AND IT WAS NOT DRIFT ALONE.
 *
 * Nine entries stopped matching. The cause splits in two, and the split is the
 * whole finding:
 *
 *  (a) SIX entries pinned lines that Waves 34/35 subsequently FIXED. The sites
 *      no longer divide by a literal 100 at all — `adminPricingStore.ts:59/60/
 *      151/163` and `adminPlatformStore.ts:1208/2266` now call
 *      `fromMinor(...)` / `toMinor(...)` and return `null` for a non-USD tier.
 *      A baseline entry for a site that no longer exists is dead weight that
 *      makes the fence red for a reason no reader can act on. DELETED.
 *
 *  (b) THREE entries pinned live code that had merely MOVED
 *      (`CollectiveDealRoomDetail.tsx` 361→370 and 364→373,
 *      `multiCompanyStore.ts` 1426→1449; the text was byte-identical).
 *      Re-pinning was the cheap option. Wave 36 FIXED THE VIOLATION INSTEAD:
 *      all three now go through `fromMinor(value, "USD")`, which is
 *      byte-identical output for USD and exponent-correct by construction.
 *      A baselined "provably safe" site is still a site that teaches the next
 *      reader that `/ 100` is acceptable. DELETED because FIXED.
 *
 * The fence itself was NOT weakened: no pattern removed, no vocabulary token
 * removed, no directory excluded, nothing allowlisted. The baseline SHRANK from
 * nine entries to one. The single survivor is not code.
 */
export const BASELINE: BaselineEntry[] = [
  {
    file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
    /* WAVE 44 re-pin: 1501 → 1505. The site did not change; four lines of
       comment were added ABOVE it when the broken "Payment ledger entries"
       counter was fixed in the same file. Text byte-identical, justification
       unchanged, no pattern/vocabulary/directory relaxed, baseline still ONE
       entry, and that entry is still prose rather than code.

       WAVE 46 re-pin: 1505 → 1549. Same site, byte-identical text (verified),
       moved DOWN by 44 lines because R21/R22 appended two disclosure paragraphs
       to the SPV-deployment-fee card ABOVE it (the "no fee configured" refusal
       and the override-divergence notice). WAVE 46 did NOT enter, extend or
       touch the lossy legacy mirror this prose DESCRIBES
       (server/adminPlatformFeesRoutes.ts) — the prose is the only reason the
       fence sees a `/ 100` here at all. The fence is UNCHANGED: no pattern
       removed, no vocabulary token removed, no directory excluded, nothing
       newly allowlisted, and the baseline is still exactly ONE entry that is
       still prose rather than code. The fence's own BASELINE-STALE branch
       demands this re-pin-with-justification rather than silence.

       WAVE 56 re-pin: 1549 → 1551. Same site, byte-identical text (verified by
       the fence's own `text` match, which is what made it report BASELINE-STALE
       rather than pass). It moved DOWN by exactly TWO lines because Wave 56
       added ONE import plus ONE comment line at the top of this file for the
       new tier-catalogue admin panel (R36 / 56-Q9). WAVE 56 did not touch the
       prose, the legacy mirror it describes, or any money conversion anywhere in
       this file. The fence is UNCHANGED: no pattern removed, no vocabulary token
       removed, no directory excluded, nothing newly allowlisted, and the
       baseline is still exactly ONE entry that is still prose rather than code.

       WAVE 80 re-pin: 1551 -> 1550. Same site, byte-identical text (verified by
       the fence's own `text` match, which is what made it report BASELINE-STALE
       rather than pass). It moved UP by exactly ONE line because WAVE 80 ITEM 1
       removed the source-file name `server/adminPlatformFeesRoutes.ts` from the
       rendered prose two lines ABOVE it under owner ruling Q25 ("no exposure of
       our internal process"), and the replacement sentence is one line shorter.
       WAVE 80 did not touch the prose this entry pins, the legacy mirror it
       describes, or any money conversion anywhere in this file — the `/ 100`
       inside the <code> element is the same documentation of the same lossy
       legacy write. The fence is UNCHANGED: no pattern removed, no vocabulary
       token removed, no directory excluded, nothing newly allowlisted, and the
       baseline is still exactly ONE entry that is still prose rather than code.

       WAVE 83 re-pin: 1550 -> 1567. Same site, byte-identical text (again proved
       by the fence's own `text` match, which is why it reported BASELINE-STALE
       instead of a new violation). It moved DOWN by exactly SEVENTEEN lines
       because WAVE 83 ITEM 1 added the `UNIT_IN_PLAIN_ENGLISH` mapping and its
       comment ABOVE the SourceOfTruth component in this file, so that the Units
       row reads "Whole cents (integer)" instead of the column type
       `currency_minor (cents)` under owner ruling Q25. WAVE 83 did not touch the
       prose this entry pins, the legacy mirror it describes, or any money
       conversion anywhere in this file — the `/ 100` inside the <code> element is
       the same documentation of the same lossy legacy write. The fence is
       UNCHANGED: no pattern removed, no vocabulary token removed, no directory
       excluded, nothing newly allowlisted, and the baseline is still exactly ONE
       entry that is still prose rather than code. */
    line: 1567,
    text: "<code>Math.round(amountMinor / 100)</code> because that legacy table stores",
    why: "Not code — JSX documentation prose inside a <code> element, describing the legacy mirror write that WAVE 34 fixed at adminPlatformFeesRoutes.ts.",
  },
];

/* ── Scan ────────────────────────────────────────────────────────────────── */

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

/** Mask `//` and block comments so a documented example is not a violation.
 *  Runs over the WHOLE file so block comments spanning lines are handled.
 *
 *  REGEX LITERALS ARE HANDLED DELIBERATELY. The first draft of this masker did
 *  not, and `const NEEDS_QUOTE = /[,\n\r"]/;` at adminPlatformStore.ts:2086 put
 *  the scanner into a permanent string state — every comment for the remaining
 *  200 lines of that file was then scanned as code, and a `/ 100` quoted inside
 *  a WAVE 34 explanatory comment was reported as a live violation. A masker
 *  that mis-parses is a fence that reports the wrong thing; caught by execution,
 *  not by reading. */
export function maskComments(src: string): string {
  let out = "";
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let quote: string | null = null;
  /** Last significant code char, to tell division from a regex literal. */
  let prev = "";
  const regexPos = () => prev === "" || "(,=:[!&|?{};+-*%~^<>".includes(prev) || /\breturn$/.test(out);
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inLine) {
      if (c === "\n") { inLine = false; out += c; } else { out += " "; }
      i++; continue;
    }
    if (inBlock) {
      if (c === "*" && n === "/") { inBlock = false; out += "  "; i += 2; continue; }
      out += c === "\n" ? "\n" : " ";
      i++; continue;
    }
    if (quote) {
      // Keep string contents — SQL lives in strings and MUST still be scanned.
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === quote) quote = null;
      out += c;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; prev = c; i++; continue; }
    if (c === "/" && n === "/") { inLine = true; out += "  "; i += 2; continue; }
    if (c === "/" && n === "*") { inBlock = true; out += "  "; i += 2; continue; }
    if (c === "/" && regexPos()) {
      // Regex literal: consume to the unescaped closing slash, honouring [...].
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        const d = src[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;            // not a regex after all; bail out
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) { j++; break; }
        j++;
      }
      out += " ".repeat(j - i);
      prev = "x";
      i = j;
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/** `(a / b) * 100` — a percentage of a quotient, not a minor-unit conversion. */
export function isPercentOfQuotient(text: string): boolean {
  return /\([^()]*\/[^()]*\)\s*\*\s*100/.test(text);
}

export function isMonetaryLine(text: string): boolean {
  const low = text.toLowerCase();
  if (!MONEY_TOKENS.some((t) => low.includes(t))) return false;
  if (PERCENT_TOKENS.some((t) => low.includes(t))) return false;
  return true;
}

function isSourceFile(name: string): boolean {
  if (name.endsWith(".d.ts")) return false;
  if (/\.test\.tsx?$/.test(name)) return false;
  return SOURCE_EXT.has(path.extname(name));
}

function walk(absDir: string, out: string[], root: string): void {
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(absDir, entry.name), out, root);
    } else if (isSourceFile(entry.name)) {
      out.push(path.relative(root, path.join(absDir, entry.name)));
    }
  }
}

export function collectScanFiles(root: string = REPO_ROOT): string[] {
  const out: string[] = [];
  for (const rel of SCAN_ROOTS) walk(path.join(root, rel), out, root);
  return out.sort();
}

export function runMoneyExponentFence(root: string = REPO_ROOT): FenceResult {
  const files = collectScanFiles(root);
  const violations: Violation[] = [];
  const baselineSeen = new Set<string>();

  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    const masked = maskComments(src).split("\n");
    const raw = src.split("\n");

    for (let i = 0; i < masked.length; i++) {
      const code = masked[i];
      if (!code.includes("100")) continue;
      // Belt and braces: a continuation line of a block comment, in case the
      // masker is ever defeated again by some construct not yet seen.
      if (/^\s*(\*|\/\/)/.test(raw[i])) continue;
      if (!isMonetaryLine(code)) continue;

      for (const p of PATTERNS) {
        if (!p.re.test(code)) continue;
        if (p.id === "mul100" && isPercentOfQuotient(code)) break;
        const lineNo = i + 1;
        const text = norm(raw[i]);
        const key = `${rel}:${lineNo}:${text}`;
        const base = BASELINE.find(
          (b) => b.file === rel && b.line === lineNo && norm(b.text) === text,
        );
        if (base) { baselineSeen.add(key); break; }
        violations.push({ rule: "M1", patternId: p.id, file: rel, line: lineNo, text, detail: p.detail });
        break;
      }
    }
  }

  /* The baseline pins real repository lines, so it is only meaningful when the
   * real repository is what was scanned. Tests scan a synthetic tree to prove
   * both poles of the RULE; they must not inherit the repo's baseline. */
  const stale =
    path.resolve(root) === path.resolve(REPO_ROOT)
      ? BASELINE
          .filter((b) => !baselineSeen.has(`${b.file}:${b.line}:${norm(b.text)}`))
          .map((b) => `${b.file}:${b.line} — ${norm(b.text)}`)
      : [];

  return {
    ok: violations.length === 0 && stale.length === 0,
    filesScanned: files.length,
    violations,
    baselineHits: baselineSeen.size,
    staleBaseline: stale,
  };
}

export function formatFence(result: FenceResult): string {
  const parts: string[] = [];
  for (const v of result.violations) {
    parts.push(
      `  [${v.rule}/${v.patternId}] ${v.file}:${v.line}\n` +
        `      ${v.text}\n` +
        `      ${v.detail}`,
    );
  }
  if (result.staleBaseline.length > 0) {
    parts.push(
      `  [BASELINE-STALE] these baselined lines no longer match. Re-justify them\n` +
        `  (or delete the entry if the site is gone):\n` +
        result.staleBaseline.map((s) => `      ${s}`).join("\n"),
    );
  }
  return parts.join("\n");
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]).includes("moneyExponentFence");

if (invokedDirectly) {
  const result = runMoneyExponentFence();
  if (result.ok) {
    console.log(
      `[money-exponent-fence] OK — no new hardcoded currency exponent across ` +
        `${result.filesScanned} source file(s); ${result.baselineHits} baselined ` +
        `category-3 site(s) still accounted for. (WAVE 34 TASK 3)`,
    );
    process.exit(0);
  }
  console.error(
    `[money-exponent-fence] FAIL — a monetary value is being converted with a hardcoded\n` +
      `exponent of 2. JPY/KRW are exponent 0 and BHD/JOD/KWD are exponent 3, so this\n` +
      `misstates money by 100x / 10x. Use server/lib/currency.ts (currencyExponent,\n` +
      `toMinor, fromMinor, formatMinor) or client/src/lib/currency.ts.\n` +
      formatFence(result),
  );
  process.exit(1);
}
