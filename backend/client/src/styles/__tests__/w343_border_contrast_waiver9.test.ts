/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WAVE 343 · ITEM 1 — THE BORDER CONTRAST FIX, AND ITS WAIVER, MEASURED.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The owner was shown that the platform's UI-boundary colour failed the 3:1
 * non-text contrast requirement and answered, verbatim, "Fix it. Be very
 * careful!" (2026-09-06). That instruction is the entire authority for editing
 * a SACRED file, and it is the TENTH sacred waiver. This file is the standing
 * proof that the fix is real and that the waiver was registered honestly, so a
 * later change cannot quietly undo either.
 *
 * WHAT IS PROVED, EACH BY ITS OWN ASSERTION
 * -----------------------------------------
 *   (1) THE RATIO IS COMPUTED, NEVER CLAIMED. `contrast()` implements WCAG 2.1
 *       relative luminance from first principles and is CHECKED AGAINST TWO
 *       PUBLISHED ANCHORS (black-on-white = 21:1, white-on-white = 1:1) BEFORE
 *       any product colour is measured. If the maths is wrong, this file goes
 *       red on its own control before it can bless anything.
 *   (2) THE HEXES ARE READ OUT OF THE SHIPPED STYLESHEET at test time, not
 *       retyped here. A silent revert of the token reddens (2).
 *   (3) THE EXTRACTOR ASSERTS ITS OWN YIELD. It requires exactly one
 *       `--cv-color-border` declaration in capavate-tokens.css and a non-empty
 *       surface set FIRST, so a regex that matched nothing can never read as
 *       "every surface passes".
 *   (4) THE CONSUMER CENSUS IS ASSERTED `=== n`. A shared token means raising
 *       contrast in one place can wreck it in another, so the count of
 *       consumptions, the count of files, AND the count of consumptions that
 *       use the token as a BACKGROUND, TEXT or FILL colour (which must be zero,
 *       because those are the ones a DARKER value would hurt) are all pinned.
 *   (5) THE WAIVER IS REGISTERED, AND FOR THIS FILE. Ten KNOWN_DRIFT rows,
 *       WAIVER-9 present, ratification state RATIFIED, and the frozen hash on
 *       the row equal to the file's ACTUAL hash on disk.
 *   (6) WHAT WAS NOT FIXED IS PINNED AS STILL BROKEN. The two NON-SACRED
 *       overrides in ledger-partner.css and ledger-collective.css were outside
 *       the one-declaration grant and STILL FAIL 3:1. That is asserted here so
 *       the debt cannot be forgotten, and so nobody can later claim this wave
 *       fixed the whole platform. If someone fixes them, THIS ASSERTION GOES
 *       RED ON PURPOSE and must be updated with a stated reason — it is a
 *       ledger of outstanding work, not a requirement that they stay broken.
 *
 * A LIMIT, STATED. This file measures the DECLARED token values and the
 * cascade's declared surfaces. It does not render a component: jsdom does not
 * resolve `var()` inside the `border` shorthand these tokens are consumed
 * through (measured in we_group1_colour_contrast.test.tsx, which says so too),
 * so a rendered-pixel measurement is not available in this environment. What is
 * available — the declared value, the declaration's uniqueness, the consumer
 * census, and the waiver registration — is asserted, and nothing beyond it is
 * implied.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../.."); // client/src/styles/__tests__ -> repo root
const TOKENS = "client/src/styles/capavate-tokens.css";
const REQUIRED = 3.0; // WCAG 2.1 SC 1.4.11 Non-text Contrast

/* ---------- (1) the maths, from first principles, with its own control ---- */
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.replace("#", "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(h)) throw new Error(`not a 6-digit hex: ${hex}`);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- (2)(3) read the shipped stylesheet, assert the yield ---------- */
function readTokenDecls(relPath: string, token: string): string[] {
  const src = readFileSync(join(ROOT, relPath), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const re = new RegExp(`^\\s*${token}\\s*:\\s*(#[0-9A-Fa-f]{6})\\s*;`, "gm");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1].toLowerCase());
  return out;
}

const SURFACE_TOKENS = [
  "--cv-color-surface",
  "--cv-color-bg",
  "--cv-color-surface-warm",
  "--cv-color-surface-cool",
  "--cv-color-surface-cream",
  "--cv-color-surface-2",
  "--cv-color-surface-offset",
] as const;

describe("WAVE 343 · ITEM 1 — the contrast maths controls itself first", () => {
  it("published anchors: black on white === 21:1 and white on white === 1:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 10);
    /* AND A MANUFACTURED GREEN MUST FAIL: a value that plainly cannot pass 3:1
       must not pass, or this file's verdict is worthless. */
    expect(contrast("#fefefe", "#ffffff")).toBeLessThan(REQUIRED);
    /* The old value is the specific green we refuse to manufacture. */
    expect(contrast("#ddd9d3", "#ffffff")).toBeLessThan(REQUIRED);
  });
});

describe("WAVE 343 · ITEM 1 — --cv-color-border clears 3:1 on every :root surface", () => {
  it("there is EXACTLY ONE --cv-color-border declaration in the sacred token file", () => {
    const decls = readTokenDecls(TOKENS, "--cv-color-border");
    /* The grant was for ONE declaration. If this file ever holds two, the
       waiver's scope statement has become false. */
    expect(decls.length, "declarations of --cv-color-border in capavate-tokens.css").toBe(1);
  });

  it("every :root surface it can be painted on clears 3:1 — computed, not claimed", () => {
    const border = readTokenDecls(TOKENS, "--cv-color-border")[0];
    expect(border, "the border token value read from the shipped file").toBeTruthy();

    const surfaces = SURFACE_TOKENS.map((t) => {
      const v = readTokenDecls(TOKENS, t);
      expect(v.length, `declarations of ${t}`).toBeGreaterThan(0);
      return [t, v[0]] as const;
    });
    /* (3) THE EXTRACTOR ASSERTS ITS OWN YIELD before any verdict. */
    expect(surfaces.length, "surface tokens measured").toBe(7);

    const measured = surfaces.map(([t, bg]) => [t, bg, contrast(border, bg)] as const);
    for (const [t, bg, r] of measured) {
      expect(r, `${border} on ${t} ${bg} against ${REQUIRED}:1`).toBeGreaterThanOrEqual(REQUIRED);
    }
    /* The WORST case is asserted separately and explicitly, because "all of
       them pass" over an empty or shortened list is the failure mode this
       programme keeps hitting. */
    const worst = Math.min(...measured.map(([, , r]) => r));
    expect(worst, "worst-case ratio across all 7 surfaces").toBeGreaterThanOrEqual(REQUIRED);
    /* And it is pinned as a NUMBER, so a change that keeps it above 3 but
       degrades it materially is still visible in a diff. */
    expect(worst).toBeCloseTo(3.1291, 3);
  });
});

describe("WAVE 343 · ITEM 1 — the shared token's consumers, counted === n", () => {
  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, acc);
      else if (/\.(css|ts|tsx|js|jsx)$/.test(name)) acc.push(p);
    }
    return acc;
  }

  /* ── WAVE 345 · COUNT UPDATED 93 → 95, WITH THE REASON STATED ────────────
     Wave 343 counted 93 product consumptions in 24 files. Wave 345 added the
     partner-facing "deployment fees raised but not yet invoiced" panel to
     `client/src/pages/partner/PartnerBilling.tsx` (Item 1), and that panel draws
     TWO bordered containers: the honest empty-state box and each outstanding-fee
     list item. Both use the token in the `border-[...]` position — the safe one
     this test exists to police — and NEITHER uses it as a background, as text or
     as a fill, so the dangerous-usage assertion below is unchanged and still
     bites. The FILE count is unchanged at 24, because PartnerBilling.tsx was
     already a consumer.

     THE NUMBER IS RAISED, NOT REMOVED, AND NOT LOOSENED TO `toBeGreaterThan`.
     An exact count is the only version of this assertion that catches a future
     accidental consumption, which is the whole point of it. 93 is recorded here
     so the delta is auditable rather than invisible. ───────────────────────── */
  it("95 product consumptions in 24 files, and NOT ONE of them is a background, text or fill", () => {
    const TOKEN = "--cv-color-border";
    const prodUses: { file: string; line: string }[] = [];
    const testUses: { file: string; line: string }[] = [];
    const selfUses: { file: string; line: string }[] = [];
    const SELF = "client/src/styles/__tests__/w343_border_contrast_waiver9.test.ts";
    const decls: string[] = [];

    for (const abs of walk(join(ROOT, "client/src"))) {
      const rel = abs.slice(ROOT.length + 1);
      let src = readFileSync(abs, "utf8");
      if (!src.includes(TOKEN)) continue;
      src = src.replace(/\/\*[\s\S]*?\*\//g, "");
      if (!rel.endsWith(".css")) src = src.replace(/(?<![:'"/])\/\/[^\n]*/g, "");
      for (const line of src.split("\n")) {
        if (!line.includes(TOKEN)) continue;
        let n = (line.match(new RegExp(TOKEN, "g")) || []).length;
        if (new RegExp(`^\\s*${TOKEN}\\s*:`).test(line)) {
          decls.push(rel);
          n -= 1;
        }
        for (let i = 0; i < n; i++) {
          /* THIS FILE talks about the token constantly (that is its job), so it
             is counted as a THIRD bucket. Folding it into the test bucket made
             the count 16 and the assertion red on the first run — recorded here
             rather than fixed by loosening the number. */
          const bucket = rel === SELF ? selfUses : rel.includes("__tests__") ? testUses : prodUses;
          bucket.push({ file: rel, line: line.trim() });
        }
      }
    }

    /* THE EXTRACTOR ASSERTS ITS OWN YIELD FIRST — a walk that found nothing
       must not read as "no dangerous consumption exists". */
    expect(prodUses.length, "product consumptions found by the walk").toBeGreaterThan(0);

    /* THREE declarations platform-wide: the sacred one, plus the two
       NON-SACRED partner/collective overrides that this wave did NOT touch. */
    expect(decls.length, "declarations of --cv-color-border across client/src").toBe(3);

    const prodFiles = Array.from(new Set(prodUses.map((u) => u.file))).sort();
    const testFiles = Array.from(new Set(testUses.map((u) => u.file))).sort();

    /* 93 at wave 343; +2 from wave 345's Item 1 panel (see the note above). */
    expect(prodUses.length, "product consumptions === 95").toBe(95);
    expect(prodFiles.length, "product consumer files === 24").toBe(24);
    /* Test files that assert the token's ABSENCE elsewhere are NOT consumers.
       They are counted separately so the partition is visible and total, rather
       than the difference being absorbed silently into one number. */
    expect(testUses.length, "test-only references === 5").toBe(5);
    expect(testFiles.length, "test-only reference files === 4").toBe(4);
    expect(selfUses.length, "this file's own references, counted apart").toBeGreaterThan(0);
    /* WAVE 345: 93 → 95 on the product side only (Item 1's two bordered
       containers). The 5 test-only references are unchanged. */
    expect(prodUses.length + testUses.length + selfUses.length, "the partition is total").toBe(
      95 + 5 + selfUses.length,
    );

    /* THE ACTUAL REGRESSION CHECK. Darkening a shared token RAISES contrast
       where it is a border on a light surface, and LOWERS it where it is a
       background or a text colour. So the count that matters is this one. */
    /* Classified per DECLARATION FRAGMENT, not per line. A first, per-line
       version of this check reported TWO dangerous consumptions and both were
       FALSE POSITIVES — recorded here rather than quietly narrowed:
         · PartnerSpvSwitcher.tsx uses Tailwind's arbitrary-value syntax
           `border-[color:var(--cv-color-border)]`, where the literal text
           "color:" is part of a BORDER utility, not a colour property; and
         · Rounds.tsx writes `{ color: "var(--cv-color-text-muted)",
           borderColor: "var(--cv-color-border)" }`, where a per-line regex
           reached across the comma from `color:` to the wrong token.
       Both are borders. So the line is split into fragments first, a property
       name immediately preceded by "[" is not a property (it is a Tailwind
       arbitrary value), and `borderColor` is not `color`. */
    /* The lookbehind excludes BOTH "[" (Tailwind arbitrary value) and "-" /
       word characters, because `border-color:` contains the literal text
       "color:" and a bare `\bcolor` matched it — five real border declarations
       were flagged on the second pass for exactly that reason. Recorded, not
       silently narrowed. */
    const DANGER = /(?<![[\w-])(background|background-color|backgroundColor|color|fill|stroke)\s*:\s*[^:]*--cv-color-border/;
    const dangerous = prodUses.filter((u) =>
      u.line
        .split(/[;,]/)
        .filter((frag) => frag.includes("--cv-color-border"))
        .some((frag) => DANGER.test(frag)),
    );
    /* THE CLASSIFIER MUST BE PROVED ABLE TO FIRE. A classifier that can never
       return a hit would make the assertion below vacuous — this programme has
       shipped exactly that mistake before. */
    const CONTROL = [
      { file: "control", line: 'style={{ background: "var(--cv-color-border)" }}' },
      { file: "control", line: "  color: var(--cv-color-border);" },
      { file: "control", line: "  fill: var(--cv-color-border);" },
    ];
    for (const c of CONTROL) {
      expect(
        c.line
          .split(/[;,]/)
          .filter((frag) => frag.includes("--cv-color-border"))
          .some((frag) => DANGER.test(frag)),
        `the classifier MUST flag a manufactured dangerous consumption: ${c.line}`,
      ).toBe(true);
    }
    /* And it must NOT flag the two real border uses that fooled the first pass. */
    for (const ok of [
      'className="rounded-md border border-[color:var(--cv-color-border)] bg-[color:var(--cv-color-surface-2)] p-3"',
      'style={{ color: "var(--cv-color-text-muted)", borderColor: "var(--cv-color-border)" }}',
      "  border: 1px solid var(--cv-color-border);",
      "  border-color: var(--cv-color-border) !important;",
      "  border-bottom-color: var(--cv-color-border);",
    ]) {
      expect(
        ok
          .split(/[;,]/)
          .filter((frag) => frag.includes("--cv-color-border"))
          .some((frag) => DANGER.test(frag)),
        `the classifier must NOT flag a border use: ${ok}`,
      ).toBe(false);
    }
    expect(
      dangerous.map((d) => `${d.file}: ${d.line}`),
      "consumptions using --cv-color-border as a background, text or fill colour",
    ).toEqual([]);
  });
});

describe("WAVE 343 · ITEM 1 — the tenth waiver is registered, and registered honestly", () => {
  const script = () => readFileSync(join(ROOT, "scripts/sacred_check.sh"), "utf8");
  const rows = () =>
    Array.from(script().matchAll(/^"([^"|]+)\|([0-9a-f]{64})\|([0-9a-f]{64})\|(WAIVER-\d+)\|([A-Z-]+)"$/gm))
      .map((m) => ({ path: m[1], from: m[2], to: m[3], waiver: m[4], state: m[5] }));

  it("there are TEN KNOWN_DRIFT rows and the ids are a closed contiguous 1..9", () => {
    const r = rows();
    expect(r.length, "KNOWN_DRIFT rows").toBe(10);
    const ids = Array.from(new Set(r.map((x) => Number(x.waiver.split("-")[1])))).sort((a, b) => a - b);
    /* NINE DISTINCT IDS FOR TEN ROWS, because WAIVER-1 covers two files. This
       is exactly why the tenth GRANT had to be registered as WAIVER-9: the
       gate's own contiguity check aborts with exit 3 on a WAIVER-10 label.
       Both facts are asserted so neither can be smoothed away later. */
    expect(ids, "distinct waiver ids must be contiguous 1..9").toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.filter((x) => x.waiver === "WAIVER-1").length, "WAIVER-1 covers two files").toBe(2);
  });

  it("WAIVER-9 covers capavate-tokens.css, is RATIFIED, and pins the file's REAL hash", () => {
    const nine = rows().filter((x) => x.waiver === "WAIVER-9");
    expect(nine.length, "WAIVER-9 rows").toBe(1);
    expect(nine[0].path).toBe(TOKENS);
    expect(nine[0].state, "ratification state").toBe("RATIFIED");
    /* NOT A RE-BASELINE: the row still carries the PRE-waiver hash in field 2,
       so nothing was erased, and field 3 must equal the file as shipped. */
    const actual = createHash("sha256").update(readFileSync(join(ROOT, TOKENS))).digest("hex");
    expect(nine[0].to, "frozen hash === the file's actual hash").toBe(actual);
    expect(nine[0].from, "the pre-waiver hash is retained, not overwritten").toBe(
      "b4346f5a81be40fbd2791e43c8b671f6ab713265f024459d0be278766a88c766",
    );
    expect(nine[0].from).not.toBe(nine[0].to);
  });

  it("the waiver records the OWNER'S OWN instruction and impersonates no signature", () => {
    const s = script();
    const block = s.slice(s.indexOf("# WAIVER-9 — THE TENTH WAIVER ROW"), s.indexOf(`"${TOKENS}|`));
    expect(block.length, "the WAIVER-9 documentation block was located").toBeGreaterThan(500);
    expect(block).toContain("Fix it. Be very careful!");
    expect(block).toContain("2026-09-06");
    expect(block).toContain("NO SIGNATURE IS CLAIMED");
    /* It must NOT read as a routine engineering decision. */
    expect(block).toContain("NOT an engineering decision");
    /* The prohibited token must be NAMED, not slipped through. */
    expect(block).toContain("THE PROHIBITED TOKEN IS THE FAILING DECLARATION");
    /* And it must say how to decline, so the grant is reversible on paper. */
    expect(block).toContain("TO DECLINE THIS WAIVER");
  });
});

describe("WAVE 343 · ITEM 1 — WHAT WAS NOT FIXED, pinned as outstanding", () => {
  /* ══════════════════════════════════════════════════════════════════════════
   * WAVE 345 · ITEM 3 — THIS ASSERTION WAS INVERTED, WITH A STATED REASON. IT
   * WAS NOT DELETED, AND THE OLD NUMBER IS STILL RECORDED BELOW.
   * ══════════════════════════════════════════════════════════════════════════
   * Wave 343 pinned the two NON-SACRED overrides as STILL FAILING, and said in
   * these words: *"If a later wave gets its own authority and fixes them, this
   * assertion reddens ON PURPOSE and must be updated with a stated reason rather
   * than deleted."* It reddened, on purpose, and this is the stated reason.
   *
   * THE RULING THAT AUTHORISED THE CHANGE. Wave 343 could not touch these two
   * because its grant covered ONE declaration and the sacred file consumed it.
   * These two declarations are **NON-SACRED** (`sacred_check.sh` does not carry
   * either file), so they never needed a waiver at all — only an owner decision
   * to spend a change there, which the wave-345 brief gives: *"BOTH ARE
   * NON-SACRED. They were pinned by a failing test and left."* **NO ELEVENTH
   * WAIVER WAS TAKEN AND NONE WAS NEEDED**; `sacred` is rc=0 with the waiver
   * table byte-unchanged at ten rows.
   *
   * WHAT THE NUMBERS WERE AND ARE, measured both times by the same formula that
   * checks itself against 21:1 and 1:1 first:
   *   BEFORE  #E5EAF0 on #F1F4F8 = 1.0966:1  FAIL
   *   AFTER   #838C97 on #F1F4F8 = 3.0887:1  PASS   (worst surface in scope)
   *           #838C97 on #FFFFFF = 3.4073:1  PASS   (best surface in scope)
   * 1.0966 IS STILL ASSERTED — as the historical value the brief quoted — so the
   * debt ledger keeps its record instead of losing it to the repair.
   * ══════════════════════════════════════════════════════════════════════════ */
  const W345_BEFORE_BORDER = "#E5EAF0";
  const W345_BEFORE_RATIO = 1.0966;

  it("the two NON-SACRED partner/collective overrides NOW PASS 3:1 — repaired in wave 345", () => {
    for (const f of ["client/src/styles/ledger-partner.css", "client/src/styles/ledger-collective.css"]) {
      const border = readTokenDecls(f, "--cv-color-border");
      const surface2 = readTokenDecls(f, "--cv-color-surface-2");
      expect(border.length, `${f} declares --cv-color-border`).toBe(1);
      expect(surface2.length, `${f} declares --cv-color-surface-2`).toBe(1);
      const r = contrast(border[0], surface2[0]);
      expect(r, `${f} border ${border[0]} on ${surface2[0]} — must now clear ${REQUIRED}:1`).toBeGreaterThanOrEqual(
        REQUIRED,
      );
      /* Pinned as a number so a later "tidy-up" back to a paler hairline cannot
         pass silently. 3.0887 is the WORST pairing in this scope. */
      expect(r).toBeCloseTo(3.0887, 3);
      /* And the old value must be GONE from the declaration, not merely
         out-measured by a second declaration added below it. */
      expect(border[0].toUpperCase()).not.toBe(W345_BEFORE_BORDER);
    }
  });

  it("the HISTORICAL failing number is still recorded, so the debt ledger keeps its record", () => {
    /* The brief's "1.10:1" lives here and nowhere else — NOT in
       capavate-tokens.css. Recomputed from the old hexes rather than quoted. */
    expect(contrast(W345_BEFORE_BORDER, "#F1F4F8")).toBeCloseTo(W345_BEFORE_RATIO, 3);
    expect(contrast(W345_BEFORE_BORDER, "#F1F4F8")).toBeLessThan(REQUIRED);
  });
});
