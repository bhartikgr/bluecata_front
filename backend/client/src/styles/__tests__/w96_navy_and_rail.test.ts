/**
 * WAVE 96 — THE THREE DESIGN RESIDUALS. TEST-ONLY.
 *
 * This file asserts the invariants of the three things Wave 96 changed, and it
 * is written so that each assertion BITES: every one was proved by deliberately
 * breaking exactly the thing it guards and watching it go red. Transcripts:
 * `build_log/wave96/W96_TESTS.md`.
 *
 *   ITEM 1  `ledger-partner.css`'s table header can only ever get NARROWER.
 *           A bare `font-size: 12px` GREW headers that inherited less, which is
 *           how Wave 2D+3D pushed a cap-table column off the screen. The
 *           never-grow `min(12px, 1em)` form is now asserted here for partner as
 *           `w2d3d_ledger_scope.test.ts` §4.1 asserts it for the other two.
 *
 *   ITEM 2  `CollectiveShell.tsx` carries NO colour literal. It reads tokens,
 *           which each product scope re-points, so one shared component renders
 *           two areas' rails without naming either area. R74 is asserted
 *           positively: the two areas' rail values must be EQUAL, so the two
 *           surfaces still render identically.
 *
 *   ITEM 3  the founder area's 36 legacy-navy sites resolve through the ratified
 *           `--cv-color-navy` / `--cv-color-navy-light` pair from the SACRED
 *           token file, reached by whole-token `[class~=]` selectors only, with
 *           every `hover:` rule carrying a real `:hover` — the form that cannot
 *           paint a hover colour at rest.
 *
 *   R80     every selector in `ledger-founder.css`, INCLUDING the five new ones,
 *           still carries the Billing guard. Wave 96 does not weaken it.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const PARTNER = "client/src/styles/ledger-partner.css";
const FOUNDER = "client/src/styles/ledger-founder.css";
const COLLECTIVE = "client/src/styles/ledger-collective.css";
const TOKENS = "client/src/styles/capavate-tokens.css";
const SHELL = "client/src/components/CollectiveShell.tsx";
const BILLING = "client/src/pages/founder/Billing.tsx";
const MANIFEST = "sacred_baseline/SACRED_SHA256.txt";

const GUARD = ':not(:has([data-testid="card-collective-application-fee"]))';

/** The ratified pair, and the ONLY two colour values Wave 96's founder rules use. */
const NAVY = "--cv-color-navy";
const NAVY_LIGHT = "--cv-color-navy-light";

/** The four legacy-navy class tokens Wave 2D+3D counted as "36 hardcoded sites". */
const LEGACY_TOKENS = [
  'bg-[hsl(219_45%_20%)]',
  'border-[hsl(219_45%_20%)]',
  'hover:bg-[hsl(219_45%_15%)]',
  'hover:border-[hsl(219_45%_15%)]',
];

/** Hand-written comment scanner, so a file's own prose can name anything. */
function stripComments(css: string): string {
  let out = "";
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    out += css[i];
  }
  return out;
}

function selectors(css: string): string[] {
  const body = stripComments(css);
  const out: string[] = [];
  let buf = "";
  for (const ch of body) {
    if (ch === "{") { out.push(buf.trim()); buf = ""; }
    else if (ch === "}") { buf = ""; }
    else buf += ch;
  }
  return out.filter((s) => s.length > 0).flatMap((s) => s.split(",").map((x) => x.trim())).filter(Boolean);
}

/** Declaration blocks as `{selector, body}` pairs, comments stripped. */
function rules(css: string): { sel: string; body: string }[] {
  const body = stripComments(css);
  const out: { sel: string; body: string }[] = [];
  let sel = "", buf = "", inBlock = false;
  for (const ch of body) {
    if (ch === "{") { inBlock = true; continue; }
    if (ch === "}") {
      if (inBlock) for (const s of sel.split(",").map((x) => x.trim()).filter(Boolean)) out.push({ sel: s, body: buf });
      inBlock = false; sel = ""; buf = ""; continue;
    }
    if (inBlock) buf += ch; else sel += ch;
  }
  return out;
}

/** Every `.tsx`/`.ts` file under client/src, for whole-tree counts. */
function clientFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); }
      else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, "client/src"));
  return out;
}

/* ── 1 · ITEM 1 — the partner table header can only ever get NARROWER ──── */

describe("W96 · ITEM 1 — ledger-partner.css table headers cannot grow", () => {
  it("1.1 — the header rule uses the never-grow min(12px, 1em) form", () => {
    const css = stripComments(read(PARTNER));
    expect(css).toContain("font-size: min(12px, 1em)");
  });

  it("1.2 — no rule in the file forces a bare 12px font-size on a table header", () => {
    for (const r of rules(read(PARTNER))) {
      if (!/thead|\bth\b/.test(r.sel)) continue;
      expect(r.body, `selector ${r.sel} forces a bare font-size`).not.toMatch(/font-size:\s*12px\s*;/);
    }
  });

  it("1.3 — the fix did not widen the file's reach: every selector is still partner-scoped", () => {
    const sels = selectors(read(PARTNER));
    expect(sels.length).toBeGreaterThan(30);
    for (const s of sels) expect(s.startsWith('[data-product="partner"]')).toBe(true);
  });

  it("1.4 — and it still declares no layout, visibility or geometry property", () => {
    const BANNED = ["display", "visibility", "opacity", "pointer-events", "order", "position",
      "content", "z-index", "float", "transform", "width", "height", "overflow",
      "flex-direction", "grid-template-columns", "text-align", "cursor", "user-select"];
    const props = [...stripComments(read(PARTNER)).matchAll(/(^|[;{])\s*([a-zA-Z-]+)\s*:/g)].map((m) => m[2].toLowerCase());
    for (const b of BANNED) expect(props, `ledger-partner.css declares ${b}`).not.toContain(b);
  });
});

/* ── 2 · ITEM 2 — the shared rail reads tokens, not literals ───────────── */

describe("W96 · ITEM 2 — CollectiveShell.tsx carries no colour literal", () => {
  const shellNoComments = () => {
    /* strip both // and /* *​/ comments so the file's own prose may quote a hex */
    let s = read(SHELL).replace(/\/\*[\s\S]*?\*\//g, "");
    s = s.split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
    return s;
  };

  it("2.1 — no hex, rgb() or hsl() literal appears in any style= attribute", () => {
    const s = shellNoComments();
    for (const m of s.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
      expect(m[1], `inline style carries a literal colour: ${m[1].trim().slice(0, 80)}`)
        .not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
  });

  it("2.2 — the rail reads the four tokens instead", () => {
    const s = shellNoComments();
    for (const t of ["--cv-color-surface-cream", "--cv-color-divider", "--cv-color-surface", NAVY]) {
      expect(s, `the shell no longer reads ${t}`).toContain(`var(${t})`);
    }
  });

  it("2.3 — all four tokens are declared in the SACRED :root token file, so they can never be dead", () => {
    const t = read(TOKENS);
    for (const tok of ["--cv-color-surface-cream", "--cv-color-divider", "--cv-color-surface", NAVY]) {
      expect(t, `${tok} is not declared in capavate-tokens.css`).toMatch(new RegExp(`${tok}\\s*:`));
    }
  });

  it("2.4 — and BOTH product scopes re-point the two that carry the rail's colour", () => {
    for (const [file, scope] of [[COLLECTIVE, "collective"], [PARTNER, "partner"]] as const) {
      const css = stripComments(read(file));
      for (const tok of ["--cv-color-surface-cream", "--cv-color-divider"]) {
        expect(css, `${scope} does not re-point ${tok}`).toMatch(new RegExp(`${tok}\\s*:`));
      }
      expect(css).toContain(`[data-product="${scope}"]`);
    }
  });

  it("2.5 — R74: the two areas' rail values are EQUAL, so the two rails still render identically", () => {
    const valueOf = (file: string, tok: string) => {
      const m = stripComments(read(file)).match(new RegExp(`${tok}\\s*:\\s*([^;]+);`));
      return m ? m[1].trim().toLowerCase() : null;
    };
    for (const tok of ["--cv-color-surface-cream", "--cv-color-divider"]) {
      const c = valueOf(COLLECTIVE, tok);
      const p = valueOf(PARTNER, tok);
      expect(c, `${tok} missing in collective`).toBeTruthy();
      expect(p, `${tok} missing in partner`).toBeTruthy();
      expect(c, `R74: the two rails would differ on ${tok}`).toBe(p);
    }
  });

  it("2.6 — the shell still sets data-product and still emits BOTH values", () => {
    const s = read(SHELL);
    expect(s).toContain("data-product={product}");
    expect(s).toMatch(/"partner"\s*\|\s*"collective"/);
  });

  it("2.7 — no colour decision in the shell branches on the product area", () => {
    /* A ternary picking a colour by area would be a hardcoded two-area fork —
     * exactly what the token layer exists to avoid. The ONE pre-existing
     * `partnerOnly ? navy : primary` pair is a BRAND ink choice that predates
     * this wave and is left alone; assert its count has not grown. */
    const s = shellNoComments();
    const forks = [...s.matchAll(/product\s*===\s*"(partner|collective)"\s*\?/g)].length;
    expect(forks, "a colour fork on data-product was added to the shell").toBe(0);
    expect([...s.matchAll(/partnerOnly\s*\?\s*"var\(/g)].length).toBe(2);
  });

  it("2.8 — the shell's CONTROL surface is unchanged: pinned counts", () => {
    /* Counted as the EXACT attribute and object-key forms, not as a bare
     * substring. A bare `data-testid` count is defeated by renaming the
     * attribute to `data-testid-x`, which is how a control disappears while a
     * count stays still — mutation-proved (M11). */
    const s = read(SHELL);
    const n = (re: RegExp) => [...s.matchAll(re)].length;
    expect(n(/data-testid="/g), "a rendered testid was added or removed").toBe(9);
    expect(n(/"data-testid":/g), "a nav-item testid was added or removed").toBe(45);
    expect(n(/onClick=\{/g), "a handler was added or removed").toBe(6);
    expect(n(/href[=:]/g), "a link target was added or removed").toBe(47);
    expect(n(/label:/g), "a nav label was added or removed").toBe(46);
    expect(n(/<button/g), "a button element was added or removed").toBe(3);
    expect(n(/style=\{\{/g), "an inline style was added or removed").toBe(8);
  });
});

/* ── 3 · ITEM 3 — one navy, reached safely ─────────────────────────────── */

describe("W96 · ITEM 3 — the founder navy resolves through the ratified token", () => {
  const founderRules = () => rules(read(FOUNDER)).filter((r) => r.sel.includes("[class~="));

  it("3.1 — all five Wave 96 rules exist, founder-scoped and R80-guarded", () => {
    const sels = founderRules().map((r) => r.sel);
    expect(sels.length).toBe(5);
    for (const s of sels) {
      expect(s.startsWith('[data-product="founder"]'), `not founder-scoped: ${s}`).toBe(true);
      expect(s, `missing the R80 Billing guard: ${s}`).toContain(GUARD);
    }
    for (const t of ["bg-sidebar", ...LEGACY_TOKENS]) {
      expect(sels.some((s) => s.includes(`[class~="${t}"]`)), `no rule reaches ${t}`).toBe(true);
    }
  });

  it("3.2 — every NAVY class hook is a WHOLE-TOKEN [class~=], never a substring form", () => {
    /* Scoped to the navy hooks on purpose. `ledger-founder.css` already carried
     * two PRE-EXISTING substring selectors from Wave 2D+3D — `[class*="border-"]`
     * and `[class*="text-xs"]` — which are CATEGORY matches on a status pill, not
     * value matches, and are not this wave's to change. What must never appear is
     * a substring match on a COLOUR, because that is the form that also catches a
     * `hover:` variant of the same utility and paints it at rest. */
    for (const s of selectors(read(FOUNDER))) {
      if (!/hsl\(219|bg-sidebar/.test(s)) continue;
      expect(s, `a colour hook uses a substring match: ${s}`).toContain("[class~=");
      expect(s, `a colour hook uses a substring match: ${s}`).not.toMatch(/\[class[*^$|]=/);
    }
  });

  it("3.3 — every rule that targets a hover: class carries a real :hover, so it cannot paint at rest", () => {
    for (const r of founderRules()) {
      if (!r.sel.includes('[class~="hover:')) continue;
      expect(r.sel.endsWith(":hover"), `a hover: class is reached without :hover — it would paint at rest: ${r.sel}`).toBe(true);
    }
    /* and the converse: no REST rule may target a hover: class */
    for (const r of founderRules()) {
      if (r.sel.endsWith(":hover")) continue;
      expect(r.sel, `a rest-state rule reaches a hover: class: ${r.sel}`).not.toContain('[class~="hover:');
    }
  });

  it("3.4 — those rules declare NO hex: only the two ratified navy tokens", () => {
    for (const r of founderRules()) {
      expect(r.body, `a hex was hardcoded in ${r.sel}`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(r.body, `${r.sel} does not read a ratified navy token`).toMatch(/var\(--cv-color-navy(-light)?\)/);
    }
    const hovers = founderRules().filter((r) => r.sel.endsWith(":hover"));
    expect(hovers.length).toBe(2);
    for (const r of hovers) expect(r.body).toContain(`var(${NAVY_LIGHT})`);
  });

  it("3.5 — both navy tokens come from the SACRED token file and are NEVER shadowed (Tier-9 rule 74)", () => {
    const t = read(TOKENS);
    expect(t).toMatch(new RegExp(`${NAVY}\\s*:\\s*#041e41`, "i"));
    expect(t).toMatch(new RegExp(`${NAVY_LIGHT}\\s*:\\s*#0c2d55`, "i"));
    /* the token file's own ratified rest/hover pairing, which is why these two
     * values are not a design decision this wave made */
    expect(stripComments(t)).toMatch(/\.cv-btn--secondary\s*\{[^}]*var\(--cv-color-navy\)/);
    expect(stripComments(t)).toMatch(/\.cv-btn--secondary:hover\s*\{[^}]*var\(--cv-color-navy-light\)/);
    for (const f of [FOUNDER, COLLECTIVE, PARTNER]) {
      const css = stripComments(read(f));
      expect(css, `${f} redeclares the LOCKED ${NAVY}`).not.toMatch(new RegExp(`${NAVY}\\s*:`));
      expect(css, `${f} redeclares the LOCKED ${NAVY_LIGHT}`).not.toMatch(new RegExp(`${NAVY_LIGHT}\\s*:`));
    }
  });

  it("3.6 — the site count is PINNED at 36, so a 37th legacy-navy site cannot be added silently", () => {
    const counts: Record<string, number> = Object.fromEntries(LEGACY_TOKENS.map((t) => [t, 0]));
    for (const p of clientFiles()) {
      const rel = path.relative(ROOT, p);
      /* the founder-rendered surface: the founder pages plus the shell that
       * draws their header. Other areas keep the legacy navy until their own
       * design waves run, and this wave's rules cannot reach them. */
      if (!(rel.includes("pages/founder/") || rel.endsWith("components/AppShell.tsx"))) continue;
      const src = fs.readFileSync(p, "utf8");
      for (const t of LEGACY_TOKENS) {
        /* whole-token match: `hover:bg-…` must not be counted as `bg-…` */
        for (const m of src.matchAll(/[^\s"'`{}]+/g)) if (m[0] === t) counts[t]++;
      }
    }
    expect(counts).toEqual({
      'bg-[hsl(219_45%_20%)]': 14,          /* AppShell:631 header + 13 button fills */
      'border-[hsl(219_45%_20%)]': 7,
      'hover:bg-[hsl(219_45%_15%)]': 8,
      'hover:border-[hsl(219_45%_15%)]': 7,
    });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(36);
  });

  it("3.7 — the DELIBERATELY-LEFT shades are still present and no rule targets them", () => {
    /* Do not flatten a deliberate distinction. Each of these is a distinct role:
     * a categorical holder-group tone, a gradient stop, a text-hierarchy ink. */
    const LEFT = [
      'bg-[hsl(219_45%_30%)]',     /* cap-table Founders group tone — CATEGORICAL */
      'from-[hsl(219_45%_20%)]',   /* /founder/collective hero gradient, stop 1 */
      'via-[hsl(219_45%_18%)]',    /* the same gradient, stop 2 — must differ from stop 1 */
      'text-[hsl(219_45%_12%)]',   /* a deliberately darker doc-title ink */
      'text-[hsl(219_45%_35%)]',   /* a deliberately lighter icon tint */
    ];
    const founderSrc = clientFiles()
      .filter((p) => path.relative(ROOT, p).includes("pages/founder/"))
      .map((p) => fs.readFileSync(p, "utf8")).join("\n");
    const css = stripComments(read(FOUNDER));
    for (const t of LEFT) {
      expect(founderSrc, `${t} vanished from the founder source`).toContain(t);
      expect(css, `a Wave 96 rule reaches the deliberately-left ${t}`).not.toContain(`[class~="${t}"]`);
    }
  });
});

/* ── 4 · R80 — the Billing guard is not weakened ───────────────────────── */

describe("W96 · R80 — founder/Billing.tsx stays excluded", () => {
  it("4.1 — EVERY selector in ledger-founder.css carries the guard, new ones included", () => {
    const sels = selectors(read(FOUNDER));
    expect(sels.length).toBeGreaterThan(15);
    for (const s of sels) expect(s, `unguarded selector: ${s}`).toContain(GUARD);
  });

  it("4.2 — the guard's data-testid still occurs EXACTLY ONCE, and in Billing.tsx", () => {
    const hits = clientFiles()
      .filter((p) => !p.includes("__tests__"))   /* the guard's own tests must name it */
      .filter((p) => fs.readFileSync(p, "utf8").includes("card-collective-application-fee"));
    expect(hits.map((p) => path.relative(ROOT, p))).toEqual([BILLING]);
    const src = read(BILLING);
    expect((src.match(/card-collective-application-fee/g) || []).length).toBe(1);
  });

  it("4.3 — no Wave 96 rule names any Billing testid", () => {
    const billingTestIds = [...read(BILLING).matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
    const css = stripComments(read(FOUNDER)) + stripComments(read(PARTNER));
    for (const id of billingTestIds) {
      if (id === "card-collective-application-fee") continue;   /* that IS the guard */
      expect(css, `a rule targets Billing's ${id}`).not.toContain(id);
    }
  });

  it("4.4 — capavate-tokens.css still hashes to the value in the SACRED manifest", () => {
    const want = read(MANIFEST).split("\n")
      .map((l) => l.trim().split(/\s+/))
      .find((p) => p[1] === "client/src/styles/capavate-tokens.css");
    expect(want, "capavate-tokens.css is not in the sacred manifest").toBeTruthy();
    const got = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, TOKENS))).digest("hex");
    expect(got).toBe(want![0]);
  });
});
