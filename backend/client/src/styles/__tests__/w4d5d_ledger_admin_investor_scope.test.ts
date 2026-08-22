/**
 * WAVE 4D + 5D — THE ADMIN AND INVESTOR SKINS. TEST-ONLY.
 *
 * The last two of the five areas. This file asserts the invariants of everything
 * the wave changed, and every assertion was proved to BITE by deliberately
 * breaking exactly the thing it guards and watching it go red. Transcripts:
 * `build_log/wave4d5d_admin_investor/TESTS.md`.
 *
 *   §1  SCOPE — not one unscoped selector in either new file, and neither file
 *       names any OTHER area. Waves 1D, 2D+3D and 96 proved partner, Collective
 *       and founder byte-identical; this keeps them so, from the source side.
 *
 *   §2  NO FUNCTIONAL PROPERTY — neither file declares `display`, `visibility`,
 *       `opacity`, `pointer-events`, `order`, `position`, `content`, `z-index`,
 *       `float`, `transform`, `width`, `height`, `overflow`, `flex-direction`,
 *       `grid-template-columns`, `text-align`, `padding`, `cursor` or
 *       `user-select`. A stylesheet that cannot express one cannot break one.
 *
 *   §3  THE OVERFLOW INVARIANT — the table header rule is the never-grow
 *       `min(12px, 1em)` form in BOTH files and a bare `font-size: 12px` is
 *       FORBIDDEN. A hard 12px pushed the founder cap table's last column and
 *       three ownership subtotals off screen (1141px into a 1134px container)
 *       while the instrument reported "clipped 8→8". Admin is the most
 *       table-dense area on the platform, so this is the wave's highest risk.
 *       `letter-spacing` on the header is forbidden too, for the same reason.
 *
 *   §4  R80 — `founder/Billing.tsx` is untouched, and NEITHER NEW FILE MENTIONS
 *       IT OR THE FOUNDER SCOPE AT ALL. The guard in `ledger-founder.css` is not
 *       weakened, narrowed or re-implemented: that file is unchanged to the byte
 *       and still carries the switch on every one of its selectors.
 *
 *   §5  R74 POSITIVELY, Wave 96's method — the five areas must look like ONE
 *       product. The four ratified values that all five areas share are asserted
 *       EQUAL across the four skin files, so no future wave can quietly split
 *       them into five dialects.
 *
 *   §6  THE RAMPS — `:root` and the partner / collective / founder blocks of
 *       `ledger-ramps.css` are BYTE-IDENTICAL to the pinned pre-wave file, and
 *       the admin / investor blocks each still declare exactly 125 steps in 17
 *       families. No block gained or lost a declaration.
 *
 *   §7  ONE NAVY — the legacy-navy sites resolve through the ratified
 *       `--cv-color-navy` / `--cv-color-navy-light` pair read from the SACRED
 *       token file, reached by WHOLE-TOKEN `[class~=]` selectors only, with every
 *       `hover:` rule carrying a real `:hover`. `[class*=]` is FORBIDDEN: it
 *       would match the `hover:` variant and paint a hover colour at rest, which
 *       is a functional defect, not a styling one.
 *
 *   §8  THE IMPORTS ARE APPENDED, NOT INSERTED. Both new `@import`s come AFTER
 *       every pre-existing one, so no pre-existing rule's cascade position moves.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sha = (p: string) =>
  crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, p))).digest("hex");

const ADMIN = "client/src/styles/ledger-admin.css";
const INVESTOR = "client/src/styles/ledger-investor.css";
const PARTNER = "client/src/styles/ledger-partner.css";
const COLLECTIVE = "client/src/styles/ledger-collective.css";
const FOUNDER = "client/src/styles/ledger-founder.css";
const RAMPS = "client/src/styles/ledger-ramps.css";
const TOKENS = "client/src/styles/capavate-tokens.css";
const INDEX = "client/src/index.css";
const BILLING = "client/src/pages/founder/Billing.tsx";

const NEW_FILES: Array<[string, string]> = [["admin", ADMIN], ["investor", INVESTOR]];

/** strip /* ... *​/ comments so prose can never satisfy or trip an assertion. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** every selector text in a stylesheet, comments removed. */
function selectors(src: string): string[] {
  const out: string[] = [];
  const body = code(src);
  const re = /(^|\})([^{}]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    for (const s of m[2].split(",")) {
      const t = s.trim();
      if (t && !t.startsWith("@")) out.push(t);
    }
  }
  return out;
}

/** every `prop: value;` declaration, comments removed. */
function declarations(src: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of code(src).matchAll(/([-a-zA-Z]+)\s*:\s*([^;{}]+);/g)) {
    out.push([m[1].trim().toLowerCase(), m[2].trim()]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("W4D5D §1 · scope — every selector is scoped, and only to its own area", () => {
  for (const [area, file] of NEW_FILES) {
    it(`${area}: every selector begins with [data-product="${area}"]`, () => {
      const sels = selectors(read(file));
      expect(sels.length).toBeGreaterThan(8);
      const bad = sels.filter((s) => !s.startsWith(`[data-product="${area}"]`));
      expect(bad).toEqual([]);
    });

    it(`${area}: names no OTHER product area in any RULE`, () => {
      // deliberately checked against the CODE, not the prose. Both files DISCUSS
      // the other areas at length — that is how a reader learns why the R80
      // Billing guard is unnecessary here and why partner's letter-spacing is
      // not copied. What must be absent is a SELECTOR naming another area.
      const c = code(read(file));
      for (const other of ["partner", "collective", "founder", area === "admin" ? "investor" : "admin"]) {
        expect(c).not.toContain(`[data-product="${other}"]`);
      }
    });

    it(`${area}: declares no @media, @supports or @layer that could change the cascade`, () => {
      expect(code(read(file))).not.toMatch(/@(media|supports|layer)/);
    });
  }

  it("neither new file contains a single `!important`", () => {
    // the areas have no inline competitor to beat: index.css's two scoped
    // blocks name only collective and partner. So nothing needs escalating.
    for (const [, f] of NEW_FILES) expect(code(read(f))).not.toContain("!important");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W4D5D §2 · no functional property is expressible from either file", () => {
  const FORBIDDEN = [
    "display", "visibility", "opacity", "pointer-events", "order", "position",
    "content", "z-index", "float", "transform", "width", "height", "overflow",
    "overflow-x", "overflow-y", "flex-direction", "grid-template-columns",
    "text-align", "padding", "padding-left", "padding-right", "padding-top",
    "padding-bottom", "cursor", "user-select", "margin", "gap", "inset",
    "top", "left", "right", "bottom", "grid-template-rows", "flex", "grid",
  ];
  for (const [area, file] of NEW_FILES) {
    it(`${area}: declares none of the ${FORBIDDEN.length} layout/visibility properties`, () => {
      const props = declarations(read(file)).map(([p]) => p);
      const hits = props.filter((p) => FORBIDDEN.includes(p));
      expect(hits).toEqual([]);
    });
  }
  it("neither file declares any `::before`, `::after` or `content`", () => {
    for (const [, f] of NEW_FILES) {
      const c = code(read(f));
      expect(c).not.toMatch(/::?(before|after)\b/);
      expect(c).not.toMatch(/\bcontent\s*:/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W4D5D §3 · the OVERFLOW invariant — a table header can only shrink", () => {
  for (const [area, file] of NEW_FILES) {
    it(`${area}: the thead th rule uses the never-grow min(12px, 1em) form`, () => {
      const c = code(read(file));
      const m = c.match(
        new RegExp(`\\[data-product="${area}"\\] table thead th \\{([^}]*)\\}`)
      );
      expect(m, "the table thead th rule must exist").not.toBeNull();
      expect(m![1]).toContain("font-size: min(12px, 1em)");
    });

    it(`${area}: a BARE font-size: 12px on a table header is FORBIDDEN`, () => {
      // this is the exact form that pushed the founder cap table's last column
      // and three ownership subtotals off screen, at 1141px into 1134px.
      const c = code(read(file));
      expect(c).not.toMatch(/table thead th\s*\{[^}]*font-size:\s*12px\s*;/);
      expect(c).not.toMatch(/font-size:\s*12px\s*;/);
    });

    it(`${area}: declares no letter-spacing on a table header`, () => {
      // at 10px, 0.04em is ~0.4px per character; a nine-column admin header is
      // ~90 characters, i.e. ~36px of pure tracking against 50px of headroom on
      // the two tables whose wrapper is overflow-x: hidden.
      const c = code(read(file));
      const m = c.match(
        new RegExp(`\\[data-product="${area}"\\] table thead th \\{([^}]*)\\}`)
      );
      expect(m![1]).not.toContain("letter-spacing");
    });

    it(`${area}: declares no width, min-width or padding on any table cell`, () => {
      const c = code(read(file));
      for (const m of c.matchAll(/table[^{]*\{([^}]*)\}/g)) {
        expect(m[1]).not.toMatch(/\b(min-)?width\s*:/);
        expect(m[1]).not.toMatch(/\bpadding\b\s*:/);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W4D5D §4 · R80 — founder Billing is untouched and unreachable from here", () => {
  it("founder/Billing.tsx is byte-identical to the value Wave 96 published", () => {
    expect(sha(BILLING)).toBe(
      "bad47bfdb6a30c4fafefaeb046caff4951af0266db19a17573b1bc5c2e7c3dd7"
    );
  });

  it("ledger-founder.css is byte-identical to the value Wave 96 published", () => {
    // this wave did not open it, so its guard cannot have been weakened.
    expect(sha(FOUNDER)).toBe(
      /* RE-PINNED 2026-08-21 by the lead developer, Wave 99. WAS the Wave 96
         value `eac4f3ab...3f234fa55f`. Wave 4D+5D wrote this pin to prove IT had
         not opened the founder scope - a correct use. Wave 99 was then instructed
         to add `font-variant-caps: all-small-caps` to ALL FIVE ledger files,
         because an admin table's ACTIONS column (with its Edit/Expire buttons)
         was cut off at 1280, and applying the remedy to one area only would have
         made two of five areas diverge (R74). So this pin is stale BY
         INSTRUCTION, not broken by a defect. Wave 99 correctly refused to re-pin
         another wave's test and escalated instead.

         NOTE FOR WHOEVER READS THIS NEXT: a sha256 pin on a stylesheet the design
         programme legitimately edits goes stale on every authorised wave - the
         same failure mode as R82, where a gate re-baselined every wave stops
         being evidence of anything. The assertion that actually encodes R80
         (founder Billing keeps a different look) is the every-selector-carries-
         the-Billing-guard test below. That one is a PROPERTY and stayed GREEN
         throughout. Prefer that shape. Update this hash ONLY from an authorised
         design wave, and cite the authority here. */
      "fe28ef8a0d9d7e16f23ac0587efc1eae25db8207e1167f8d53fee9a998db10ca"
    );
  });

  it("EVERY selector in ledger-founder.css still carries the Billing guard", () => {
    const GUARD = ':not(:has([data-testid="card-collective-application-fee"]))';
    const sels = selectors(read(FOUNDER));
    expect(sels.length).toBeGreaterThan(15);
    expect(sels.filter((s) => !s.includes(GUARD))).toEqual([]);
  });

  it("neither new file can REACH Billing, the founder scope, or the guard", () => {
    // checked against the CODE. Both files explain in prose WHY they carry no
    // guard — that `[data-product="admin"|"investor"]` is not an ancestor of a
    // founder route — and that explanation is the point, not a violation. What
    // must be absent is any RULE that names the founder scope or its guard, and
    // any `:has()` at all.
    for (const [area, f] of NEW_FILES) {
      const c = code(read(f));
      expect(c, area).not.toContain("card-collective-application-fee");
      expect(c, area).not.toContain('[data-product="founder"]');
      expect(c, area).not.toContain(":has(");
    }
  });

  it("ledger-partner.css and ledger-collective.css are byte-identical too", () => {
    expect(sha(PARTNER)).toBe(
      /* RE-PINNED 2026-08-21, Wave 99, same authority as the founder pin above.
         WAS `b7b31cd9...0c4282b3`. */
      "c5e78c11195e163d5ae99a00fdcd69fdc3b42e98f478956f0edc61532768d1b9"
    );
    expect(sha(COLLECTIVE)).toBe(
      /* RE-PINNED 2026-08-21, Wave 99, same authority. WAS `d7e4811c...69db2172`. */
      "b810ac12e52ae31701465db820c4791879d3aa9cf05971da85ec63d07946b6cb"
    );
  });

  it("capavate-tokens.css is SACRED and unopened — it is read, never edited", () => {
    expect(sha(TOKENS)).toBe(
      "b4346f5a81be40fbd2791e43c8b671f6ab713265f024459d0be278766a88c766"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W4D5D §5 · R74 positively — the five areas must look like ONE product", () => {
  // Wave 96's method: assert EQUALITY, so a future wave cannot quietly split the
  // platform into five dialects. Each value is read out of each area's own file.
  const SKINS: Array<[string, string, string]> = [
    ["partner", PARTNER, "partner"],
    ["collective", COLLECTIVE, "collective"],
    ["founder", FOUNDER, "founder"],
    ["admin", ADMIN, "admin"],
    ["investor", INVESTOR, "investor"],
  ];

  it("all five areas set the SAME 14px base and the SAME tabular numerals", () => {
    for (const [name, file] of SKINS) {
      const c = code(read(file));
      expect(c, `${name} must set the 14px base`).toMatch(/font-size:\s*14px/);
      expect(c, `${name} must set tabular numerals`).toContain("tabular-nums lining-nums");
    }
  });

  it("all five areas paint the SAME table-header ink #5B6B7F", () => {
    for (const [name, file] of SKINS) {
      const m = code(read(file)).match(/table thead th[^{]*\{([^}]*)\}/);
      expect(m, `${name} must style table thead th`).not.toBeNull();
      expect(m![1].toUpperCase(), name).toContain("#5B6B7F");
    }
  });

  it("all five areas use the SAME Grid rule #D9DCE1 under the header", () => {
    for (const [name, file] of SKINS) {
      const m = code(read(file)).match(/table thead th[^{]*\{([^}]*)\}/);
      expect(m![1].toUpperCase(), name).toContain("#D9DCE1");
    }
  });

  it("all five areas use the SAME hairline #E5EAF0 between table rows", () => {
    for (const [name, file] of SKINS) {
      const m = code(read(file)).match(/table tbody tr \+ tr[^{]*\{([^}]*)\}/);
      expect(m, `${name} must rule between rows`).not.toBeNull();
      expect(m![1].toUpperCase(), name).toContain("#E5EAF0");
    }
  });

  it("all five areas paint the page title the SAME ratified navy #041E41", () => {
    for (const [name, file] of SKINS) {
      const c = code(read(file));
      expect(c.toUpperCase(), name).toMatch(/#041E41|--CV-COLOR-NAVY/);
    }
  });

  it("all five areas keep the pill for status ONLY — none of them sets a radius on it", () => {
    for (const [name, file] of SKINS) {
      const m = code(read(file)).match(/span\.rounded-full\[class\*="border-"\][\s\S]*?\{([^}]*)\}/);
      expect(m, `${name} must style the status pill`).not.toBeNull();
      expect(m![1], name).not.toMatch(/border-radius/);
      expect(m![1], name).toContain("font-weight: 600");
    }
  });

  it("the two NEW areas agree with each other on every value they both set", () => {
    // R78/OQ-1 added investor late; this is the check that it did not become a
    // sixth dialect. Compare the declaration sets of the two files with the
    // area name normalised away.
    const norm = (s: string) =>
      declarations(read(s))
        .filter(([p]) => !p.startsWith("--shadow"))
        .map(([p, v]) => `${p}: ${v}`)
        .sort();
    const a = new Set(norm(ADMIN));
    const i = new Set(norm(INVESTOR));
    // every declaration the investor file makes must also be made by admin,
    // except the one investor-only ink rule that admin has no call site for.
    const investorOnly = [...i].filter((x) => !a.has(x));
    expect(investorOnly).toEqual(["color: var(--cv-color-navy)"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W4D5D §6 · the ramps — only two of the six blocks moved", () => {
  const src = read(RAMPS);
  const block = (area: string): string => {
    const m = src.match(new RegExp(`\\n\\[data-product="${area}"\\] \\{\\n([\\s\\S]*?)\\n\\}\\n`));
    expect(m, `${area} ramp block must exist exactly once`).not.toBeNull();
    return m![1];
  };
  const root = (): string => src.match(/\n:root \{\n([\s\S]*?)\n\}\n/)![1];

  it("there are exactly SIX ramp scopes, and no seventh was added", () => {
    const scopes = [...src.matchAll(/\n(\[data-product="[a-z]+"\]|:root) \{/g)].map((m) => m[1]);
    expect(scopes.sort()).toEqual([
      ':root',
      '[data-product="admin"]',
      '[data-product="collective"]',
      '[data-product="founder"]',
      '[data-product="investor"]',
      '[data-product="partner"]',
    ]);
  });

  it("every one of the six blocks declares exactly 125 steps in 17 families", () => {
    for (const b of [root(), block("partner"), block("collective"), block("founder"),
                     block("admin"), block("investor")]) {
      const steps = [...b.matchAll(/--ramp-([a-z]+)-(\d+):/g)];
      expect(steps.length).toBe(125);
      expect(new Set(steps.map((m) => m[1])).size).toBe(17);
    }
  });

  it(":root is still the STOCK Tailwind palette — Wave 0's no-op is intact", () => {
    // three spot values from three families, which is enough to catch a rewrite.
    expect(root()).toContain("--ramp-slate-200: 226 232 240;");
    expect(root()).toContain("--ramp-emerald-600: 5 150 105;");
    expect(root()).toContain("--ramp-red-600: 220 38 38;");
  });

  it("the ADMIN and INVESTOR blocks are now the ratified ramps, not stock", () => {
    for (const b of [block("admin"), block("investor")]) {
      expect(b).not.toContain("--ramp-slate-200: 226 232 240;");
      expect(b).toContain("--ramp-slate-200: 229 234 240;");   // #E5EAF0 hairline
      expect(b).toContain("--ramp-red-600: 204 0 1;");         // #CC0001 logo red
    }
  });

  it("the admin and investor ramp blocks are IDENTICAL to each other", () => {
    // R74: one platform dialect. The two blocks are generated from the same
    // ratified anchors, so any difference is a bug.
    expect(block("admin")).toBe(block("investor"));
  });

  it("the PARTNER, COLLECTIVE and FOUNDER ramp slots did not move", () => {
    // partner is Wave 1D's ratified block; collective is Wave 2D's; the founder
    // slot is still Wave 0's stock no-op, because Wave 2D+3D put the founder
    // ramps under the R80 Billing guard in ledger-founder.css instead.
    expect(block("partner")).toContain("--ramp-slate-200: 229 234 240;");
    expect(block("collective")).toContain("--ramp-slate-200: 229 234 240;");
    expect(block("founder")).toContain("--ramp-slate-200: 226 232 240;");
    expect(block("founder").trim()).toBe(root().trim());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W4D5D §7 · one navy — whole-token selectors, and no hex is declared", () => {
  it("both files reach the legacy navy ONLY through [class~=], never [class*=]", () => {
    for (const [area, file] of NEW_FILES) {
      const sels = selectors(read(file));
      const navy = sels.filter((s) => s.includes("hsl(219_45%") || s.includes("bg-sidebar"));
      expect(navy.length, `${area} must carry the navy rules`).toBeGreaterThanOrEqual(5);
      for (const s of navy) {
        expect(s, `${area}: ${s}`).toContain("[class~=");
        // [class*=] on a navy class would also match `hover:bg-[hsl(219_45%_15%)]`
        // and paint a hover colour at rest. That is a functional defect.
        expect(s.includes('[class*="bg-') || s.includes('[class*="border-[') ||
               s.includes('[class*="hover:')).toBe(false);
      }
    }
  });

  it("every rule that targets a `hover:` class carries a real :hover", () => {
    for (const [area, file] of NEW_FILES) {
      const sels = selectors(read(file)).filter((s) => s.includes("hover:"));
      expect(sels.length, `${area}`).toBeGreaterThanOrEqual(2);
      for (const s of sels) expect(s, `${area}: ${s}`).toMatch(/\]:hover$/);
    }
  });

  it("neither file declares a navy HEX — both read the SACRED tokens", () => {
    for (const [area, file] of NEW_FILES) {
      const navyRules = code(read(file)).match(/\[class~=[^{]*\{[^}]*\}/g) || [];
      expect(navyRules.length, area).toBeGreaterThanOrEqual(5);
      for (const r of navyRules) {
        expect(r, `${area}: ${r}`).toMatch(/var\(--cv-color-navy(-light)?\)/);
        expect(r, `${area}: ${r}`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      }
    }
  });

  it("both navy tokens really exist in the SACRED token file, on :root", () => {
    const t = read(TOKENS);
    expect(t).toContain("--cv-color-navy: #041e41;");
    expect(t).toContain("--cv-color-navy-light: #0c2d55;");
    // and the token file itself already pairs them for exactly this control, so
    // the rest/hover relationship is the platform's, not this wave's invention.
    expect(t).toContain("background: var(--cv-color-navy)");
    expect(t).toContain("background: var(--cv-color-navy-light)");
  });

  it("the rail's own dividers are NOT collapsed onto the rail colour", () => {
    // a divider that matches its surface is not a divider. --sidebar-border and
    // --sidebar-accent must not appear in either file.
    for (const [area, file] of NEW_FILES) {
      const c = code(read(file));
      expect(c, area).not.toContain("--sidebar-border");
      expect(c, area).not.toContain("--sidebar-accent");
      expect(c, area).not.toMatch(/--sidebar\s*:/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W4D5D §8 · the imports are APPENDED, never inserted at the head", () => {
  const idx = read(INDEX);

  it("both new @imports exist exactly once", () => {
    expect((idx.match(/@import "\.\/styles\/ledger-admin\.css";/g) || []).length).toBe(1);
    expect((idx.match(/@import "\.\/styles\/ledger-investor\.css";/g) || []).length).toBe(1);
  });

  it("both come AFTER every pre-existing @import", () => {
    const order = [...idx.matchAll(/@import\s+(?:url\()?["']([^"')]+)["']\)?;/g)].map((m) => m[1]);
    const iA = order.indexOf("./styles/ledger-admin.css");
    const iI = order.indexOf("./styles/ledger-investor.css");
    expect(iA).toBeGreaterThan(-1);
    expect(iI).toBe(iA + 1);
    // every other import must come before them, so no pre-existing rule moved.
    for (let k = 0; k < order.length; k++) {
      if (k !== iA && k !== iI) expect(k).toBeLessThan(iA);
    }
  });

  it("the pre-existing import order is unchanged", () => {
    const order = [...idx.matchAll(/@import\s+(?:url\()?["']([^"')]+)["']\)?;/g)].map((m) => m[1]);
    expect(order.slice(0, 8)).toEqual([
      "https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Instrument+Serif:ital@0;1&display=swap",
      "./styles/capavate-tokens.css",
      "./styles/collective-theme.css",
      "./styles/partner-theme.css",
      "./styles/ledger-tokens.css",
      "./styles/ledger-ramps.css",
      "./styles/ledger-partner.css",
      "./styles/ledger-collective.css",
    ]);
    expect(order[8]).toBe("./styles/ledger-founder.css");
  });

  it("index.css's own inline scoped blocks still name ONLY collective and partner", () => {
    // the third token layer. It sits after the @import list and beats every
    // imported stylesheet — so it matters that it cannot reach the two new areas.
    const inline = idx.slice(idx.indexOf("@tailwind utilities;"));
    const scopes = new Set([...inline.matchAll(/\[data-product="([a-z]+)"\]/g)].map((m) => m[1]));
    expect([...scopes].sort()).toEqual(["collective", "partner"]);
  });
});
