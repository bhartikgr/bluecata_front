/**
 * scripts/lint/percentDenominatorFence.ts
 *
 * WAVE 52b · AC-7 POLE B — the standing guard for the unlabelled-percentage
 * defect class. Rescoped exactly as STRATEGY §11.6.4 requires.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * A percentage without its denominator is not a fact. On the canonical worked
 * example the SAME founder, on IDENTICAL facts, is
 *
 *     40.000%   of fully-diluted post-money shares          (8,000,000 / 20,000,000)
 *     48.485%   of fully-diluted post-money EXCLUDING pool  (8,000,000 / 16,500,000)
 *     51.613%   of issued and outstanding shares            (8,000,000 / 15,500,000)
 *
 * None of those is wrong. Publishing one of them without saying which one is.
 * That ambiguity is what produced the external reviewer's questions, and
 * `spec/strategy/RESPONSE_TO_SHADIE_ROUND_MATH_2026_08_14.md` §10 item 5 —
 * ALREADY SENT TO HER — commits to it in one sentence:
 *
 *     "Every percentage carries its denominator label. A percentage without one
 *      is treated as a defect."
 *
 * Wave 52 made an unlabelled percentage UNCONSTRUCTABLE inside
 * `client/src/lib/roundMath.ts` — the `Pct` type has no constructor that omits
 * `denominator`. That is stronger than a lint for code that uses the module, and
 * it is why Wave 52 argued the fence was less urgent. But it does not stop
 * anybody writing a bare `{x}%` straight into a `.tsx`, which is precisely the
 * shape of every pre-existing site this fence found. AC-7 Pole B asks for the
 * fence; this is it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE
 * ─────────────────────────────────────────────────────────────────────────────
 * P1 — EVERY RENDERED PERCENTAGE CARRIES ITS DENOMINATOR LABEL. In the
 *      W52-owned files (§11.6.4), a site that renders a numeric value
 *      immediately followed by a literal `%` is a violation UNLESS the rendering
 *      neighbourhood names the denominator.
 *
 * A site is COMPLIANT when any of the following is true:
 *
 *   (a) it goes through `formatPct(...)` / `Pct` from `client/src/lib/roundMath.ts`,
 *       which cannot emit a bare number;
 *   (b) a denominator label token appears within `WINDOW` lines — one of the five
 *       `DENOM_LABELS` (`OUTSTANDING`, `FD_PRE`, `FD_PRE_INCL_POOL`, `FD_POST`,
 *       `FD_POST_EX_POOL`), one of their founder-facing / badge texts, or an
 *       explicit "of <denominator>" phrase from `DENOM_PHRASES`;
 *   (c) the percentage is NOT an ownership share of a cap table at all — a
 *       discount rate, an interest rate, a CSS width, a progress bar, an
 *       equity-percentage INPUT the founder is typing rather than a computed
 *       output. These have no denominator to name, and a fence that cried wolf
 *       on them would be switched off within a week. Precision over recall is
 *       the design choice, same as `moneyExponentFence.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BASELINE — MEASURED, COUNTED, AND NOT QUIETLY WIDENED
 * ─────────────────────────────────────────────────────────────────────────────
 * Every workable fence in this tree is a CEILING WITH A BASELINE:
 * `lint:money-exponent-fence` prints "1 baselined category-3 site(s) still
 * accounted for". §11.6.4 requires this fence to take that shape too, because a
 * tree-wide, no-baseline percent fence provably cannot hold — the Aug-9 copy
 * baseline alone holds 50 literal copy ids containing `%`, in Admin / partner
 * files that are W55 inventory rows and W53 surface files, and a single-writer
 * tree cannot absorb a cross-wave edit sweep from inside W52.
 *
 * So: the pre-existing unlabelled ownership-percentage sites in the W52-owned
 * files are pinned in `BASELINE` below, EACH WITH ITS OWN REASON AND ITS OWN
 * OWNING WAVE, and the printed summary states the count out loud. An entry is
 * keyed by `file:line:normalisedText`; if the line moves or its text changes the
 * entry stops matching and the fence goes RED, deliberately — a moved line is a
 * line someone edited, and it should be re-justified rather than inherited.
 *
 * WHAT THIS FENCE MUST NOT BECOME. The baseline is NOT the mechanism for making
 * the fence pass. It is a debt register with a count on the front. Anything NEW
 * is RED, and the sites in the register are the follow-on work, named.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

/** §11.6.4 — the W52-owned surface. Files, plus one whole package. */
export const SCAN_FILES = [
  "client/src/pages/founder/RoundNew.tsx",
  "client/src/pages/founder/RoundDetail.tsx",
  "client/src/pages/founder/Rounds.tsx",
  "client/src/pages/founder/CapTable.tsx",
] as const;
export const SCAN_PACKAGE_DIRS = ["packages/cap-table-engine/src"] as const;

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "__tests__", ".git"]);
const SOURCE_EXT = new Set([".ts", ".tsx"]);

/** How many lines above/below a percentage site count as its neighbourhood. */
export const WINDOW = 6;

/** The five denominator labels, verbatim from client/src/lib/roundMath.ts. */
export const DENOM_LABELS = [
  "OUTSTANDING",
  "FD_PRE",
  "FD_PRE_INCL_POOL",
  "FD_POST",
  "FD_POST_EX_POOL",
] as const;

/**
 * Founder-facing phrasings that NAME a denominator. Lower-cased substring match.
 * A percentage sitting next to any of these has said what it divided by.
 */
export const DENOM_PHRASES = [
  "fully-diluted",
  "fully diluted",
  "fd post-money",
  "fd pre-money",
  "issued and outstanding",
  "of outstanding",
  "post-money shares",
  "pre-money shares",
  "pricing denominator",
  "denominator",
  "ex-pool",
  "excluding the unallocated",
  "of total shares",
  "of the total",
] as const;

/** Constructions that cannot emit a bare percentage. */
export const SAFE_CONSTRUCTS = [
  "formatpct(",
  "pctfromfraction(",
  "denom_label_short",
  "denom_label_text",
  "p.denominator",
  "denominatorshares",
] as const;

/**
 * Vocabulary that makes a percentage NOT an ownership share of a cap table. A
 * discount, an interest rate, a CSS width and a founder's own typed input have
 * no denominator to name.
 *
 * THIS LIST WAS WRONG ON ITS FIRST DRAFT AND THE CORRECTION IS THE POINT.
 * It originally contained `className`, `class=`, `style=`, `w-[`, `h-[`, `step=`,
 * `min=`, `max=`, `score`, `progress`, `liquidation`, `seniority` and bare
 * `width` / `height`. Run against the real tree that list reported ONE violation
 * and 21 "non-ownership" sites — and `build_log/wave52b/w52b_fence_inventory.mts`
 * showed SEVEN of those 21 were genuine unlabelled OWNERSHIP percentages excused
 * for no better reason than the word `className` appearing somewhere on the same
 * line:
 *
 *     CapTable.tsx:909    {groupPct.toFixed(2)}%
 *     CapTable.tsx:1007   {parseFloat(r.ownershipPercent).toFixed(2)}%
 *     RoundDetail.tsx:1199 {parseFloat(r.ownershipPercent).toFixed(2)}%
 *     RoundDetail.tsx:1337 {row.percent}%
 *     RoundDetail.tsx:1346 ({data.reduce(...)}%)
 *     RoundDetail.tsx:1602 New investor %
 *     RoundDetail.tsx:1603 Founder % after
 *
 * A fence that passes because its own exclusions are too generous is worse than
 * no fence, so the tokens that excused them are GONE. CSS is now recognised by
 * the CSS PROPERTY (`width:`, `height:`, `opacity:` — matched after whitespace is
 * stripped, so `width: ` matches), not by the presence of a `style` attribute,
 * and Tailwind class strings are masked out before matching.
 */
export const NON_OWNERSHIP_TOKENS = [
  /* Rates and ratios — a percentage of money or time, not of a share count. */
  "discount", "interest", "coupon", "irr", "moic", "apr",
  "percentvested", "vesting", "readiness", "churn", "growth", "grossmargin",
  /* CSS — keyed to the PROPERTY, so a bar's width is excused and the number
     printed next to that bar is not. */
  "width:", "height:", "opacity:", "flexbasis:", "translate(", "scale(",
  /* Copy the founder types INTO a field, which is an input and not a claim. */
  "placeholder",
] as const;

/** Percentage-rendering shapes. `text` is the normalised source line. */
const PATTERNS: Array<{ id: string; re: RegExp; detail: string }> = [
  {
    id: "jsxExprPct",
    /* {value}% — the commonest shape, and the one the guard's copy class cannot
       even see, because `<expr:` values are skipped at extract-inventory.ts:1253. */
    re: /\{[^{}]*\}\s*%/,
    detail: "renders a JSX expression immediately followed by '%' with no denominator named",
  },
  {
    id: "templatePct",
    /* `${value}%` inside a template literal. */
    re: /\$\{[^}]*\}\s*%/,
    detail: "interpolates a value immediately followed by '%' with no denominator named",
  },
  {
    id: "toFixedPct",
    /* .toFixed(n)}% / .toFixed(n) + "%" — a formatted number turned into a
       percentage by string concatenation. */
    re: /toFixed\s*\([^)]*\)\s*(\}|\s*\+\s*["'`])\s*%?/,
    detail: "formats a number and appends '%' by concatenation, with no denominator named",
  },
];

export interface Violation {
  rule: "P1";
  patternId: string;
  file: string;
  line: number;
  text: string;
  detail: string;
}

export interface FenceResult {
  ok: boolean;
  filesScanned: number;
  sitesConsidered: number;
  compliantSites: number;
  violations: Violation[];
  baselineHits: number;
  staleBaseline: string[];
}

/* ── BASELINE — pre-existing unlabelled ownership-percentage sites ────────── */

interface BaselineEntry {
  file: string;
  line: number;
  /** Normalised (whitespace-collapsed) source text, so a reformat is caught. */
  text: string;
  /** The wave that owns fixing it. Never "unknown". */
  owner: string;
  why: string;
}

/*
 * MEASURED IN THIS TREE BY THIS FENCE, at v26.17.0 after Wave 52.
 *
 * These are ownership-percentage renders in W52-owned files that do NOT name
 * their denominator and that WAVE 52b DID NOT FIX. They are listed rather than
 * silenced, with a count printed on every run, because the alternative — quietly
 * widening `NON_OWNERSHIP_TOKENS` until the fence went green — would make the
 * fence pass by not catching what it exists to catch.
 *
 * Why they are not fixed HERE: every one of them is a READ surface owned by a
 * different wave's inventory (RoundDetail and CapTable are W53 surface files),
 * and correcting a displayed denominator label is not a cosmetic edit — it is a
 * claim about which set of securities was divided by, which has to be verified
 * against the actual projection that produced the number. Doing that from inside
 * W52b would be exactly the cross-wave edit sweep §11.6.4 says a single-writer
 * tree cannot absorb.
 */
export const BASELINE: BaselineEntry[] = [
  /* ── WAVE 52c · B6 — THE REGISTER SHRANK FROM 9 TO 2 ───────────────────────
     Wave 52b baselined NINE unlabelled percentage sites and Review 1 confirmed
     that OWNERSHIP sites were among them, while §10 item 5 of the document
     already sent to the external reviewer commits that "every percentage carries
     its denominator label. A percentage without one is treated as a defect."

     SEVEN of the nine are now LABELLED ON SCREEN and their entries are DELETED,
     not silenced — CapTable.tsx :658 (ownership-bar tooltip), :909 (group
     subtotal), :1007 (per-holder figure, the one a founder screenshots) and its
     column header; RoundDetail.tsx :1188/:1199 (pro-forma projection column),
     :1337 (share-of-raise), :1602 ("New investor %") and :1603 ("Founder %
     after" — THE canonical ambiguous figure, the one that is legitimately
     40.000% / 48.485% / 51.613% on identical facts).

     The fence was NOT widened to achieve that: `NON_OWNERSHIP_TOKENS`,
     `DENOM_PHRASES`, `DENOM_LABELS`, `SAFE_CONSTRUCTS` and `WINDOW` are all
     byte-identical to Wave 52b. The count went down because labels were added to
     the screens, which is the only legitimate way for it to go down.

     WAVE 58 · R27 — LINE NUMBERS ONLY. Both entries below moved from 1394 and
     1425 to 1455 and 1486 because Wave 58 appended an option-pool disclosure
     panel ABOVE them in the same file (`disclosure-w58-option-pool`, in the
     Projection card). The `text`, the `owner` and the `why` of each entry are
     BYTE-IDENTICAL, both sites are untouched, and the baseline COUNT HOLDS AT
     TWO — it is not widened, and no third entry is added. The fence's own
     BASELINE-STALE check is what caught the shift, which is the check working.

     WAVE 58b — LINE NUMBERS ONLY, AGAIN, AND FOR THE SAME REASON. Both entries
     moved from 1455 and 1486 to 1547 and 1578 because Wave 58b appended TWO more
     things ABOVE them in the same file: the fully-diluted base disclosure
     (`disclosure-w58b-fd-base`, a sibling at the end of the Projection card) and
     the dynamic ESOP row plus edit-surface sentence on the Terms tab. The `text`,
     the `owner` and the `why` of each entry are again BYTE-IDENTICAL, both sites
     are untouched by this wave, and the baseline COUNT HOLDS AT TWO. No third
     entry is added and no exclusion vocabulary is widened — the two follow-on
     repairs each entry names (total-the-unrounded-values for :1547, a
     NON_OWNERSHIP classification with its own falsification test for :1578) are
     still owed and still owned by W53. The fence's BASELINE-STALE check caught the
     shift a second time, which is the check working a second time.

     WAVE 58e · D3.7 — LINE NUMBERS ONLY, A THIRD TIME, SAME REASON. Both entries
     moved from 1547 and 1578 to 1578 and 1609 because 58e inserted the
     `Discount (% off the round price)` row ABOVE them on the same Terms tab: the
     live audit found that tab showing NO discount at all on SAFE/Note rounds
     (R31), so the value governing every SAFE conversion was absent from the
     round's own terms panel. The `text`, the `owner` and the `why` of each entry
     are again BYTE-IDENTICAL, neither site is touched by this wave, and the
     baseline COUNT HOLDS AT TWO — nothing is widened, no third entry is added, and
     no new site is excused. The new discount copy names its own denominator in
     prose ("% off the round price", "% of the round price") and is not a
     `{expr}%` site at all. BASELINE-STALE caught the shift a third time.

     WAVE 71 · D18 — LINE NUMBERS ONLY, A FOURTH TIME, SAME REASON. Both entries
     moved from 1578 and 1609 to 1601 and 1632 because Wave 71 inserted the
     `ownershipCellText` helper and its block comment ABOVE them in the same file:
     the engine's `ownershipPercent` became `string | null` (0 / 0 is undefined, not
     zero — R47), and `SideTable` had to stop calling `parseFloat` on it. The
     `text`, the `owner` and the `why` of each entry are again BYTE-IDENTICAL,
     NEITHER SITE IS TOUCHED by this wave, and the baseline COUNT HOLDS AT TWO —
     nothing is widened, no third entry is added, and no new site is excused.
     BASELINE-STALE caught the shift a fourth time, which is the check working a
     fourth time.

     WAVE 72 · DEFECT 1 / R58 — LINE NUMBERS ONLY, A FIFTH TIME, SAME REASON. Both
     entries moved from 1601 and 1632 to 1654 and 1685 because Wave 72 inserted THREE
     things ABOVE them in the same file: the `try`/`catch` around `projectPostClose`
     (so a named projection refusal is RENDERED instead of unmounting the page into
     the app-level ErrorBoundary — R58's dead-promise rule) and the
     `projection-refused` branch that displays it, and the `export` (plus its
     comment) on `ProjectionPanel` so an R58 render test can MOUNT it. The `text`,
     the `owner` and the
     `why` of each entry are again BYTE-IDENTICAL, NEITHER SITE IS TOUCHED by this
     wave, and the baseline COUNT HOLDS AT TWO — nothing is widened, no third entry
     is added, and no new site is excused. The refusal panel this wave adds renders
     NO percentage at all, so it is not a `{expr}%` site. BASELINE-STALE caught the
     shift a fifth time, which is the check working a fifth time.

     WAVE 73 · ITEM 7 — LINE NUMBERS ONLY, A SIXTH TIME, SAME REASON. Both entries
     moved from 1654 and 1685 to 1673 and 1704 because Wave 73 moved ONE STATEMENT
     and its comment ABOVE them in the same file: `ProjectionPanel`'s second
     `useQuery` (the Wave 52c pricing-order read) was declared BELOW two early
     returns, so a cold-cache mount ran one hook on the first render and two on the
     next, React raised "Rendered more hooks than during the previous render", and
     the Round Detail projection tab unmounted into the ErrorBoundary. Hoisting the
     hook above the early returns is the whole fix (Wave 72 F-1 / OQ-1). The `text`,
     the `owner` and the `why` of each entry are again BYTE-IDENTICAL, NEITHER SITE
     IS TOUCHED by this wave, and the baseline COUNT HOLDS AT TWO — nothing is
     widened, no third entry is added, and no new site is excused.

     AND A NOTE THE NEXT AGENT NEEDS, because it is the opposite mistake: this wave
     also removed a `?? 0` ownership fabrication from `founder/Dashboard.tsx`
     (Item 8, R47/R48). **`founder/Dashboard.tsx` IS NOT AND WAS NEVER IN THIS
     FENCE'S SCOPE** (see the file list above — R43, which would have added it, was
     RETRACTED), so that fix must NOT change this baseline count. If a future wave
     finds the count at anything other than TWO and reaches for Item 8 as the
     explanation, it is looking at the wrong change.

     TWO REMAIN, each with its reason and its owning wave printed on every run. */
  {
    /* WAVE 80 re-pin: 1673 -> 1735. SAME SITE, byte-identical text (which is what
       made the fence report BASELINE-STALE rather than pass). It moved DOWN because
       WAVE 80 ITEM 2 + ITEM 4.3 rewrote the `UseOfProceeds` card ABOVE it: the card
       now renders the founder's FREE-TEXT use-of-proceeds narrative as well as the
       structured rows, and the "Add use of proceeds" button no longer emits a
       success toast for a stubbed editor. NEITHER CHANGE TOUCHES THIS FIGURE OR ITS
       ARITHMETIC. The narrative branch renders NO percentage at all — deliberately,
       because deriving per-bucket percentages from a sentence would be inventing
       figures the founder never entered — so it adds no percent site for this fence
       to see. The unlabelled total this entry pins is byte-for-byte the same
       expression, computed the same (still-wrong, still-owned) way. The fence is
       UNCHANGED: no pattern removed, no vocabulary token removed, no directory
       excluded, nothing newly allowlisted, and the baseline is still exactly TWO. */
    file: "client/src/pages/founder/RoundDetail.tsx",
    line: 1735,
    text: "<span className=\"font-mono tabular-nums\">{sym}{total.toLocaleString()} ({data.reduce((s, r) => s + r.percent, 0)}%)</span>",
    owner: "W53 (round surface) — arithmetic, not labelling",
    why:
      "This is the TOTAL of the :1337 column and it is a SUM OF THE ALREADY-ROUNDED COLUMN, which invariant I-4 forbids. WAVE 52c deliberately did NOT label it: putting a denominator label on a figure computed the wrong way would make a wrong number look authoritative. The repair is to total the unrounded values and then round once \u2014 an arithmetic change with its own test, owned by the wave that fixes I-4 on this surface.",
  },
  {
    /* WAVE 80 re-pin: 1704 -> 1819. SAME SITE, byte-identical text (which is what
       made the fence report BASELINE-STALE rather than pass). It moved DOWN because
       WAVE 80 ITEM 2 + ITEM 4.3 rewrote the `UseOfProceeds` card ABOVE it: the card
       now renders the founder's FREE-TEXT use-of-proceeds narrative as well as the
       structured rows, and the "Add use of proceeds" button no longer emits a
       success toast for a stubbed editor. NEITHER CHANGE TOUCHES THIS FIGURE OR ITS
       ARITHMETIC. The narrative branch renders NO percentage at all — deliberately,
       because deriving per-bucket percentages from a sentence would be inventing
       figures the founder never entered — so it adds no percent site for this fence
       to see. The unlabelled total this entry pins is byte-for-byte the same
       expression, computed the same (still-wrong, still-owned) way. The fence is
       UNCHANGED: no pattern removed, no vocabulary token removed, no directory
       excluded, nothing newly allowlisted, and the baseline is still exactly TWO.
       FOR THIS SECOND ENTRY specifically, the shift is larger because WAVE 80 also
       APPENDED two panels — `RoundNarrative` and `TranchePlan`, the readers for the
       round narrative and tranche plan the wizard used to discard — between the
       use-of-proceeds card and the closing checklist. Appended at the END of their
       container, never inserted at its head, because a head insertion in an ordered
       container reads to the silent-drop guard as a mass removal. Neither panel
       renders a percentage: both render only text the founder typed. */
    file: "client/src/pages/founder/RoundDetail.tsx",
    line: 1819,
    text: "<span className=\"font-mono text-xs\">{pct.toFixed(0)}%</span>",
    owner: "W53 (round surface) — fence classification, not a screen edit",
    why:
      "ESTABLISHED BY READING THE CODE IN WAVE 52c, where Wave 52b recorded it as unknown: this is the CLOSING CHECKLIST progress figure (`done` of `items.length`, rendered beside a <Progress> bar), NOT an ownership share of a cap table. It therefore has no cap-table denominator to name, and the correct repair is a NON_OWNERSHIP classification in this fence. WAVE 52c did not make it, because widening the fence's exclusion vocabulary is exactly how a fence stops catching what it exists to catch, and that change should land with its own falsification test rather than as a side effect of a labelling pass.",
  },
];

/* ── Scan ────────────────────────────────────────────────────────────────── */

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

/** Reuse the money fence's proven comment/regex masker semantics. */
export function maskComments(src: string): string {
  let out = "";
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let quote: string | null = null;
  let prev = "";
  const regexPos = () =>
    prev === "" || "(,=:[!&|?{};+-*%~^<>".includes(prev) || /\breturn$/.test(out);
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
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === quote) quote = null;
      out += c;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; prev = c; i++; continue; }
    if (c === "/" && n === "/") { inLine = true; out += "  "; i += 2; continue; }
    if (c === "/" && n === "*") { inBlock = true; out += "  "; i += 2; continue; }
    if (c === "/" && regexPos()) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        const d = src[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;
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

/**
 * Tailwind class strings and `data-testid` values are neither rendered numbers
 * nor labels; a `70%` inside `w-[70%]` must not excuse the figure beside it, and
 * a testid must not supply a denominator it does not display. Masked before any
 * matching so neither can influence the verdict.
 */
export function maskClassAndTestIds(line: string): string {
  return line
    .replace(/className\s*=\s*"[^"]*"/g, 'className=""')
    .replace(/className\s*=\s*\{`[^`]*`\}/g, "className={``}")
    .replace(/class\s*=\s*"[^"]*"/g, 'class=""')
    .replace(/data-testid\s*=\s*"[^"]*"/g, 'data-testid=""')
    .replace(/data-testid\s*=\s*\{`[^`]*`\}/g, "data-testid={``}");
}

/** (c) — a percentage with no denominator to name. */
export function isNonOwnershipPercent(line: string): boolean {
  const masked = maskClassAndTestIds(line);
  const low = masked.toLowerCase();
  /* Whitespace-stripped copy so `width: ` matches the `width:` token. */
  const tight = low.replace(/\s+/g, "");
  return NON_OWNERSHIP_TOKENS.some((t) => low.includes(t) || tight.includes(t));
}

/** (a) and (b) — the neighbourhood names the denominator. */
export function neighbourhoodNamesDenominator(lines: string[], idx: number): boolean {
  const from = Math.max(0, idx - WINDOW);
  const to = Math.min(lines.length - 1, idx + WINDOW);
  const window = lines.slice(from, to + 1).map(maskClassAndTestIds).join("\n");
  const low = window.toLowerCase();
  if (SAFE_CONSTRUCTS.some((s) => low.includes(s))) return true;
  if (DENOM_LABELS.some((l) => window.includes(l))) return true;
  if (DENOM_PHRASES.some((p) => low.includes(p))) return true;
  return false;
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
  for (const rel of SCAN_FILES) {
    if (fs.existsSync(path.join(root, rel))) out.push(rel);
  }
  for (const rel of SCAN_PACKAGE_DIRS) walk(path.join(root, rel), out, root);
  /* A synthetic test tree names its own files; fall back to walking it whole so
     both poles of the RULE can be proved without the repo's file list. */
  if (out.length === 0) walk(root, out, root);
  return out.sort();
}

export function runPercentDenominatorFence(root: string = REPO_ROOT): FenceResult {
  const files = collectScanFiles(root);
  const violations: Violation[] = [];
  const baselineSeen = new Set<string>();
  let sitesConsidered = 0;
  let compliantSites = 0;

  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    const masked = maskComments(src).split("\n");
    const raw = src.split("\n");

    for (let i = 0; i < masked.length; i++) {
      const code = masked[i];
      if (!code.includes("%")) continue;
      /* Belt and braces, same as the money fence: a block-comment continuation
         line in case the masker is ever defeated by a construct not yet seen. */
      if (/^\s*(\*|\/\/)/.test(raw[i])) continue;

      for (const p of PATTERNS) {
        if (!p.re.test(code)) continue;
        sitesConsidered += 1;
        if (isNonOwnershipPercent(code)) { compliantSites += 1; break; }
        if (neighbourhoodNamesDenominator(masked, i)) { compliantSites += 1; break; }

        const lineNo = i + 1;
        const text = norm(raw[i]);
        const key = `${rel}:${lineNo}:${text}`;
        const base = BASELINE.find(
          (b) => b.file === rel && b.line === lineNo && norm(b.text) === text,
        );
        if (base) { baselineSeen.add(key); break; }
        violations.push({
          rule: "P1",
          patternId: p.id,
          file: rel,
          line: lineNo,
          text,
          detail: p.detail,
        });
        break;
      }
    }
  }

  /* The baseline pins real repository lines, so it is only meaningful when the
     real repository is what was scanned. Tests scan a synthetic tree to prove
     both poles of the RULE; they must not inherit the repo's baseline. */
  const stale =
    path.resolve(root) === path.resolve(REPO_ROOT)
      ? BASELINE
          .filter((b) => !baselineSeen.has(`${b.file}:${b.line}:${norm(b.text)}`))
          .map((b) => `${b.file}:${b.line} [${b.owner}] — ${norm(b.text)}`)
      : [];

  return {
    ok: violations.length === 0 && stale.length === 0,
    filesScanned: files.length,
    sitesConsidered,
    compliantSites,
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
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).includes("percentDenominatorFence");

if (invokedDirectly) {
  const result = runPercentDenominatorFence();
  if (result.ok) {
    console.log(
      `[percent-denominator-fence] OK — every rendered percentage in the ` +
        `${result.filesScanned} W52-owned source file(s) names its denominator: ` +
        `${result.sitesConsidered} percentage site(s) considered, ` +
        `${result.compliantSites} labelled or non-ownership, ` +
        `${result.baselineHits} baselined unlabelled site(s) still accounted for. ` +
        `(WAVE 52b AC-7 POLE B)`,
    );
    process.exit(0);
  }
  console.error(
    `[percent-denominator-fence] FAIL — a percentage is rendered without naming the\n` +
      `denominator it was divided by. On the canonical example the same founder is\n` +
      `40.000% (FD_POST), 48.485% (FD_POST_EX_POOL) and 51.613% (OUTSTANDING) on\n` +
      `identical facts, so an unlabelled figure is not a fact. Route it through\n` +
      `formatPct() from client/src/lib/roundMath.ts, or name the denominator on screen.\n` +
      formatFence(result),
  );
  process.exit(1);
}
