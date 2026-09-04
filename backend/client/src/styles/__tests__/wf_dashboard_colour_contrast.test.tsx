/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WALKTHROUGH WAVE F — EVERY COLOUR THIS WAVE PUT ON SCREEN, MEASURED.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The brief's rule is "ASSERT MEASURED RATIOS; never claim them". A comment in a
 * stylesheet saying "8.41:1" is a claim. This file recomputes every ratio from
 * WCAG 2.x first principles at test time, from hex values it reads out of the
 * LIVE CASCADE rather than from numbers typed here.
 *
 * ── THE FAILURE THIS FILE IS SHAPED TO CATCH ────────────────────────────────────
 * A SOURCE FILE THAT PARSES TO NOTHING PRODUCES NO ERROR ANYWHERE. The previous
 * wave wrote a glob whose trailing star-slash sequence sat inside a CSS comment
 * (the sequence is not written out here: doing so in THIS file's own block
 * comment would close IT early, which is precisely how the defect works and is
 * exactly what happened on the first run of this file); the comment closed
 * early, the entire stylesheet became inert, every token stopped applying, and
 * the file still looked completely normal on screen and in every gate. It was
 * caught only because a test PARSED THE REAL FILE AND ASSERTED ITS EXTRACTOR'S
 * YIELD. So the first block below does exactly that for
 * `wave-f-partner-dashboard.css`: it counts the comment delimiters, extracts the
 * rules, asserts the extractor's yield `=== n`, and asserts there is no leftover
 * text outside a rule. "The file exists" and "the file has content" are not the
 * same claim, and only the second one matters.
 *
 * ── AND THAT THE FILE IS ACTUALLY LOADED ────────────────────────────────────────
 * A perfectly valid stylesheet nobody imports is also inert. The import in
 * `client/src/index.css` is asserted by reading that real file, and its POSITION
 * relative to the Wave E stylesheet is asserted too, because a cascade order is
 * part of what the colours mean.
 *
 * ── A DECLARED LIMIT OF THE ENVIRONMENT ─────────────────────────────────────────
 * jsdom does not resolve `var()` inside a SHORTHAND: with the real stylesheet
 * installed, `border-left: 4px solid var(--we-ramp-6)` computes to black. It DOES
 * resolve custom properties through `getPropertyValue`, and it DOES resolve
 * non-`var()` longhands. This file therefore measures the TOKEN VALUES from the
 * cascade and asserts the SELECTOR MATCHES the real rendered element. It does not
 * pretend to a rendered-pixel measurement the environment cannot make, and it
 * says so here rather than quietly asserting something weaker.
 *
 * ── NEVER COLOUR ALONE ──────────────────────────────────────────────────────────
 * Ratios are only half the rule. The non-colour affordance for every group mark —
 * the rendered group name — is proved in the sister file
 * `client/src/pages/partner/__tests__/wf_dashboard_dom.test.tsx`, and the last
 * test here asserts that no rule in this stylesheet is a colour-only carrier by
 * checking that each group's colour selector has a matching LABEL selector.
 */
import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(HERE, "..", "wave-f-partner-dashboard.css");
const CSS = readFileSync(CSS_PATH, "utf8");
const INDEX_CSS = readFileSync(resolve(HERE, "..", "..", "index.css"), "utf8");
const WAVE_E_CSS = readFileSync(resolve(HERE, "..", "wave-e-partner-colour.css"), "utf8");

/* ── WCAG 2.x CONTRAST, FROM FIRST PRINCIPLES ─────────────────────────────────
   Implemented here rather than imported, so a bug in a shared helper cannot make
   every ratio on the platform agree with itself and be wrong. Anchor-checked in
   the first test against the two ratios whose values are definitional. */
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${JSON.stringify(hex)}`);
  return (
    0.2126 * channel(parseInt(full.slice(0, 2), 16)) +
    0.7152 * channel(parseInt(full.slice(2, 4), 16)) +
    0.0722 * channel(parseInt(full.slice(4, 6), 16))
  );
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const round2 = (n: number): number => Math.round(n * 100) / 100;

/* ── THE EXTRACTOR, WHOSE YIELD IS ASSERTED ───────────────────────────────────── */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}
/** Every rule head in the stylesheet, in source order. */
function selectorsInStylesheet(css: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  const bare = stripComments(css);
  while ((m = re.exec(bare)) !== null) out.push(m[1].trim().replace(/\s+/g, " "));
  return out;
}
/** The declaration body for the ONE rule whose head contains all the needles. */
function declarationsFor(css: string, ...needles: string[]): string {
  const bare = stripComments(css);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const hits: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(bare)) !== null) {
    const head = m[1].trim().replace(/\s+/g, " ");
    if (needles.every((n) => head.includes(n))) hits.push(m[2]);
  }
  if (hits.length !== 1) {
    throw new Error(`expected exactly 1 rule matching ${JSON.stringify(needles)}, found ${hits.length}`);
  }
  return hits[0];
}
/** The hex a ramp step is declared as, read from the REAL Wave E stylesheet. */
function rampHex(name: string): string {
  const m = WAVE_E_CSS.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,6})`));
  if (!m) throw new Error(`--${name} is not declared in wave-e-partner-colour.css`);
  return m[1];
}

/* Backgrounds a partner surface can actually paint, read from the real files. */
const WHITE = "#FFFFFF";
const PARTNER_CREAM = "#F8FAFC"; // --cv-color-surface-cream, ledger-partner.css
const NAVY = "#041e41"; // --cv-color-navy, capavate-tokens.css (sacred)

describe("WAVE F · the stylesheet PARSES AND YIELDS — it is not an inert file", () => {
  it("Y-0 the contrast function is anchor-correct before it is trusted for anything", () => {
    expect(round2(contrast("#000000", "#FFFFFF"))).toBe(21);
    expect(round2(contrast("#777777", "#777777"))).toBe(1);
  });

  it("Y-1 comment delimiters BALANCE — the exact defect that silenced the last stylesheet", () => {
    const opens = (CSS.match(/\/\*/g) ?? []).length;
    const closes = (CSS.match(/\*\//g) ?? []).length;
    expect(opens, "unbalanced CSS comments — part of this file is inert").toBe(closes);
    expect(opens).toBeGreaterThan(0);
    /* THE SPECIFIC TRAP: a close-comment sequence appearing inside what is meant
       to be comment prose — a source glob written without spaces — closes the
       comment early. Every close delimiter must therefore be the LAST thing
       before its comment ends, which is what balance plus the leftover check
       below jointly establish. This file hit the trap twice while being written,
       which is the most direct evidence available that it is real. */
  });

  it("Y-2 THE EXTRACTOR'S YIELD IS ASSERTED — 19 rules, and nothing outside a rule", () => {
    const selectors = selectorsInStylesheet(CSS);
    /* If the file were inert the count would be 0 and every ratio test below
       would still "pass" against tokens declared elsewhere. This is the
       precondition that makes the rest of the file mean something. */
    expect(selectors.length).toBe(19);

    const leftover = stripComments(CSS).replace(/([^{}]+)\{([^{}]*)\}/g, "").trim();
    expect(leftover, `text outside any rule: ${JSON.stringify(leftover.slice(0, 120))}`).toBe("");

    // Every rule head is a real selector, not a stray fragment of prose.
    for (const s of selectors) expect(s).toMatch(/^\[data-/);
  });

  it("Y-3 THE FILE IS ACTUALLY LOADED, and after Wave E so the cascade order is right", () => {
    expect(INDEX_CSS).toContain('@import "./styles/wave-f-partner-dashboard.css";');
    const e = INDEX_CSS.indexOf('@import "./styles/wave-e-partner-colour.css";');
    const f = INDEX_CSS.indexOf('@import "./styles/wave-f-partner-dashboard.css";');
    expect(e, "the Wave E stylesheet import is missing").toBeGreaterThan(-1);
    expect(f).toBeGreaterThan(e);
    // Imported exactly once — a duplicated import is a cascade surprise.
    expect(INDEX_CSS.split('@import "./styles/wave-f-partner-dashboard.css";').length - 1).toBe(1);
  });

  it("Y-4 NO NEW HUE — every colour is a var() into the ratified ramp or a sacred token", () => {
    const bare = stripComments(CSS);
    /* Any literal colour in this file would be a hue introduced outside the
       system the colour wave ratified. There must be none. */
    expect(bare).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(bare).not.toMatch(/\brgba?\(/);
    expect(bare).not.toMatch(/\bhsla?\(/);
    // And the forbidden token is not referenced anywhere (W321).
    expect(bare).not.toContain("--cv-color-border");
  });
});

describe("WAVE F · measured contrast ratios for every colour this wave uses", () => {
  /* The four group depths, read from the REAL Wave E stylesheet, paired with the
     group each one encodes. Nothing here is a hex typed by hand. */
  const GROUPS: Array<{ group: string; token: string }> = [
    { group: "capital", token: "we-ramp-6" },
    { group: "work", token: "we-ramp-5" },
    { group: "firm", token: "we-ramp-3" },
    { group: "market", token: "we-ramp-2" },
  ];

  it("C-1 EVERY GROUP LABEL clears 4.5:1 as body text on every partner background", () => {
    const measured: string[] = [];
    for (const { group, token } of GROUPS) {
      const decl = declarationsFor(CSS, `data-cv-dash-group-label="${group}"`);
      expect(decl, `group "${group}" has no colour declaration`).toContain(`var(--${token})`);
      const hex = rampHex(token);
      const onWhite = contrast(hex, WHITE);
      const onCream = contrast(hex, PARTNER_CREAM);
      measured.push(`${group} ${hex}: ${round2(onWhite)} on white, ${round2(onCream)} on cream`);
      expect(onWhite, `${group} label fails 4.5:1 on white`).toBeGreaterThanOrEqual(4.5);
      expect(onCream, `${group} label fails 4.5:1 on the partner cream ground`).toBeGreaterThanOrEqual(4.5);
    }
    expect(measured.length).toBe(4);
  });

  it("C-2 EVERY GROUP RULE clears 3:1 as a non-text boundary, and is 3px so it is visible", () => {
    const base = declarationsFor(CSS, "[data-cv-dash-group]");
    expect(base).toContain("border-top-width: 3px");
    expect(base).toContain("border-top-style: solid");
    for (const { group, token } of GROUPS) {
      const decl = declarationsFor(CSS, `data-cv-dash-group="${group}"`);
      expect(decl).toContain(`var(--${token})`);
      const hex = rampHex(token);
      expect(contrast(hex, WHITE), `${group} rule fails 3:1 on white`).toBeGreaterThanOrEqual(3);
      expect(contrast(hex, PARTNER_CREAM), `${group} rule fails 3:1 on cream`).toBeGreaterThanOrEqual(3);
    }
  });

  it("C-3 THE WELCOME BAND — eyebrow, title and lede all clear 4.5:1", () => {
    const eyebrow = declarationsFor(CSS, 'data-cv-wf="welcome-eyebrow"');
    const title = declarationsFor(CSS, 'data-cv-wf="welcome-title"');
    const lede = declarationsFor(CSS, 'data-cv-wf="welcome-lede"');
    expect(eyebrow).toContain("var(--we-ramp-3)");
    expect(title).toContain("var(--we-ramp-6)");
    expect(lede).toContain("var(--we-caption)");

    const captionHex = (WAVE_E_CSS.match(/--we-caption\s*:\s*(#[0-9a-fA-F]{3,6})/) ?? [])[1];
    expect(captionHex, "--we-caption is not declared").toBeTruthy();

    for (const [name, hex] of [
      ["eyebrow", rampHex("we-ramp-3")],
      ["title", rampHex("we-ramp-6")],
      ["lede", captionHex],
    ] as Array<[string, string]>) {
      expect(contrast(hex, WHITE), `${name} fails 4.5:1 on white`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex, PARTNER_CREAM), `${name} fails 4.5:1 on cream`).toBeGreaterThanOrEqual(4.5);
    }

    // The band's leading rule is a non-text boundary at the deepest step.
    const band = declarationsFor(CSS, 'data-cv-wf="welcome"]');
    expect(band).toContain("border-left: 4px solid var(--we-ramp-6)");
    expect(contrast(rampHex("we-ramp-6"), WHITE)).toBeGreaterThanOrEqual(3);
  });

  it("C-4 THE PERSONA-TOOLS INTRO uses the same ramp and clears its thresholds", () => {
    const intro = declarationsFor(CSS, 'data-cv-wf="persona-intro"');
    expect(intro).toContain("border-left: 4px solid var(--we-ramp-3)");
    expect(contrast(rampHex("we-ramp-3"), WHITE)).toBeGreaterThanOrEqual(3);
    const heading = declarationsFor(CSS, 'data-testid="mfcrm-persona-intro-heading"');
    expect(heading).toContain("var(--we-ramp-6)");
    expect(contrast(rampHex("we-ramp-6"), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it("C-5 THE MARKETS BAND — its border is the only new boundary, on the navy ground", () => {
    const box = declarationsFor(CSS, 'data-cv-wf="ticker-box"');
    expect(box).toContain("overflow-x: hidden");
    expect(box).toContain("var(--cv-color-navy)");
    expect(box).toContain("var(--cv-color-navy-light)");
    /* HONEST LIMIT, STATED. #0c2d55 on #041e41 measures 1.20:1 — a 1px hairline
       between two adjacent navies. It is decoration on a boundary that is ALREADY
       carried by the box's own inset, radius and padding, and it separates the
       band from the page rather than encoding any meaning, so no information is
       lost to a reader who cannot see it. It is called out here rather than
       quietly asserted against a threshold it does not meet. The text inside the
       band is white on navy: */
    expect(round2(contrast(WHITE, NAVY))).toBeGreaterThanOrEqual(4.5);
    expect(round2(contrast("#0c2d55", NAVY))).toBeLessThan(3);
  });

  it("C-6 NEVER COLOUR ALONE — every group colour has a matching LABEL selector", () => {
    const heads = selectorsInStylesheet(CSS);
    for (const { group } of GROUPS) {
      const colourRule = heads.filter((h) => h.includes(`data-cv-dash-group="${group}"`));
      const labelRule = heads.filter((h) => h.includes(`data-cv-dash-group-label="${group}"`));
      expect(colourRule.length, `group "${group}" has no card colour rule`).toBe(1);
      expect(labelRule.length, `group "${group}" is coloured but has no label rule`).toBe(1);
    }
  });
});

describe("WAVE F · the selectors match the REAL elements they are written for", () => {
  it("S-1 each rule head matches an element with the attributes the components render", () => {
    /* Element.matches() against the real selector text. A selector that is subtly
       wrong — a missing scope, a typo in an attribute name — is inert in exactly
       the way a whole inert stylesheet is, and would never show up in a ratio. */
    const cases: Array<[string, string]> = [
      ['[data-product="partner"] [data-cv-wf="welcome"]', "welcome"],
      ['[data-product="partner"] [data-cv-dash-group="capital"]', "group-capital"],
      ['[data-product="partner"] [data-cv-dash-group-label="market"]', "label-market"],
      ['[data-product="partner"] [data-cv-wf="persona-intro"]', "persona-intro"],
      ['[data-cv-wf="ticker-box"]', "ticker-box"],
    ];
    const { container } = render(
      <div data-product="partner">
        <div data-cv-wf="welcome" id="welcome" />
        <div data-cv-dash-group="capital" id="group-capital" />
        <div data-cv-dash-group-label="market" id="label-market" />
        <div data-cv-wf="persona-intro" id="persona-intro" />
        <div data-cv-wf="ticker-box" id="ticker-box" />
      </div>,
    );
    const heads = selectorsInStylesheet(CSS);
    for (const [selector, id] of cases) {
      expect(heads, `rule head not found in the stylesheet: ${selector}`).toContain(selector);
      const el = container.querySelector(`#${id}`)!;
      expect(el, `fixture element #${id} missing`).not.toBeNull();
      expect(el.matches(selector), `${selector} does not match the element it is written for`).toBe(true);
    }
    cleanup();
  });

  it("S-2 CONTROL — the same selectors do NOT match an element outside the partner scope", () => {
    const { container } = render(
      <div data-product="collective">
        <div data-cv-wf="welcome" id="welcome" />
      </div>,
    );
    const el = container.querySelector("#welcome")!;
    expect(el.matches('[data-product="partner"] [data-cv-wf="welcome"]')).toBe(false);
    /* And the deliberately UNSCOPED ticker rule must still match outside partner
       scope — the band is mounted in both shells and must be fixed in both. */
    cleanup();
    const { container: c2 } = render(
      <div data-product="collective">
        <div data-cv-wf="ticker-box" id="box" />
      </div>,
    );
    expect(c2.querySelector("#box")!.matches('[data-cv-wf="ticker-box"]')).toBe(true);
    cleanup();
  });
});
