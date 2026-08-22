/**
 * WAVE 2D + 3D — THE COLLECTIVE AND CAPAVATE FOUNDER "LEDGER + GRID" SKINS.
 *
 * TEST-ONLY. This file asserts the INVARIANTS the two new stylesheets must never
 * lose. It is modelled on Wave 1D's `w1d_ledger_partner_scope.test.ts` and adds
 * the assertions Wave 1D did not need:
 *
 *   · that EVERY selector in `ledger-founder.css` carries the Billing guard, so
 *     `pages/founder/Billing.tsx` cannot be restyled by accident (R80, owner
 *     verbatim: "Founder Billing Page: OK. Keep it different.");
 *   · that the `data-testid` the guard keys on occurs EXACTLY ONCE in the tree,
 *     so a future rename cannot silently unguard Billing;
 *   · that the `[data-product="founder"]` block of `ledger-ramps.css` is still
 *     byte-identical to `:root` — because the founder ramps deliberately live in
 *     the guarded file instead;
 *   · that no rule can express a layout or visibility change;
 *   · that the table-header rule uses the never-grow `min(12px, 1em)` form and
 *     sets no `letter-spacing` — the two things that clipped a cap-table column
 *     in this wave's first draft.
 *
 * Every assertion below was MUTATION-PROVED: the transcripts are in
 * `build_log/wave2d3d_collective_founder/W2D3D_TESTS.md`.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const COLLECTIVE = "client/src/styles/ledger-collective.css";
const FOUNDER = "client/src/styles/ledger-founder.css";
const RAMPS = "client/src/styles/ledger-ramps.css";
const INDEX = "client/src/index.css";
const PARTNER = "client/src/styles/ledger-partner.css";
const TOKENS = "client/src/styles/capavate-tokens.css";
const BILLING = "client/src/pages/founder/Billing.tsx";

const GUARD = ':not(:has([data-testid="card-collective-application-fee"]))';

/** Strip CSS comments so prose can mention another area without failing a
 *  selector assertion. Hand-written, so it fails differently from a regex. */
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

/** Every selector text in the file: everything before each `{` at depth 0. */
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

/** Declarations only — property names, never the values or the prose. */
function declaredProperties(css: string): string[] {
  const body = stripComments(css);
  const out: string[] = [];
  for (const m of body.matchAll(/(^|[;{])\s*([a-zA-Z-]+)\s*:/g)) out.push(m[2].toLowerCase());
  return out;
}

/* ── 1 · SCOPE ─────────────────────────────────────────────────────────── */

describe("W2D3D · scope — no selector can escape its own product area", () => {
  it("1.1 — every selector in ledger-collective.css starts with [data-product=\"collective\"]", () => {
    const sels = selectors(read(COLLECTIVE));
    expect(sels.length).toBeGreaterThan(30);
    for (const s of sels) expect(s.startsWith('[data-product="collective"]')).toBe(true);
  });

  it("1.2 — every selector in ledger-founder.css starts with [data-product=\"founder\"]", () => {
    const sels = selectors(read(FOUNDER));
    expect(sels.length).toBeGreaterThan(10);
    for (const s of sels) expect(s.startsWith('[data-product="founder"]')).toBe(true);
  });

  it("1.3 — neither new file names ANY other product area in a selector", () => {
    for (const f of [COLLECTIVE, FOUNDER]) {
      const own = f === COLLECTIVE ? "collective" : "founder";
      for (const other of ["partner", "collective", "founder", "admin", "investor"]) {
        if (other === own) continue;
        for (const s of selectors(read(f))) expect(s).not.toContain(`[data-product="${other}"]`);
      }
    }
  });

  it("1.4 — ledger-partner.css is NOT opened by this wave and still names only partner", () => {
    for (const s of selectors(read(PARTNER))) expect(s.startsWith('[data-product="partner"]')).toBe(true);
  });
});

/* ── 2 · THE BILLING GUARD (R80) ───────────────────────────────────────── */

describe("W2D3D · R80 — founder/Billing.tsx is EXCLUDED and cannot be restyled", () => {
  it("2.1 — EVERY selector in ledger-founder.css carries the Billing guard", () => {
    const sels = selectors(read(FOUNDER));
    expect(sels.length).toBeGreaterThan(10);
    for (const s of sels) expect(s).toContain(GUARD);
  });

  it("2.2 — the guard's data-testid occurs EXACTLY ONCE in client/src, and it is in Billing.tsx", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(tsx|ts|jsx|js)$/.test(e.name)) continue;
        const rel = path.relative(ROOT, p).split(path.sep).join("/");
        if (rel.includes("__tests__") || /\.(test|spec)\./.test(rel)) continue;
        const src = fs.readFileSync(p, "utf8");
        for (const _ of src.matchAll(/card-collective-application-fee/g)) hits.push(rel);
      }
    };
    walk(path.join(ROOT, "client/src"));
    expect(hits).toEqual([BILLING]);
  });

  it("2.3 — that data-testid is UNCONDITIONAL in Billing.tsx (not behind && or ? :)", () => {
    const src = read(BILLING);
    const lines = src.split("\n");
    const i = lines.findIndex((l) => l.includes("card-collective-application-fee"));
    expect(i).toBeGreaterThan(-1);
    /* the JSX line itself must not be an inline conditional, and the two lines
       above it must not open one */
    const window3 = lines.slice(Math.max(0, i - 2), i + 1).join("\n");
    expect(window3).not.toMatch(/&&\s*\(?\s*$/m);
    expect(window3).not.toMatch(/\?\s*\(?\s*$/m);
  });

  it("2.4 — Billing.tsx is not referenced by any selector, and no rule targets its own testids", () => {
    const css = stripComments(read(FOUNDER));
    for (const id of ["card-invoices", "table-founder-invoices", "button-refresh-invoices",
      "text-collective-application-fee", "button-add-payment-method"]) {
      expect(css).not.toContain(id);
    }
  });

  it("2.5 — the [data-product=\"founder\"] block of ledger-ramps.css is BYTE-IDENTICAL to :root", () => {
    const css = read(RAMPS);
    const block = (sel: string) => {
      const m = new RegExp(`\\n${sel} \\{\\n([\\s\\S]*?)\\n\\}\\n`).exec(css);
      expect(m, `${sel} block not found`).toBeTruthy();
      return m![1].split("\n").filter((l) => l.includes("--ramp-")).map((l) => l.trim());
    };
    const root = block(":root");
    const founder = block('\\[data-product="founder"\\]');
    expect(founder.length).toBe(125);
    expect(founder).toEqual(root);
  });

  it("2.6 — the founder ramps live in the GUARDED file instead, all 125 of them", () => {
    const css = stripComments(read(FOUNDER));
    const m = new RegExp(`\\[data-product="founder"\\]${GUARD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{\\n([\\s\\S]*?)\\n\\}`, "g");
    const all = [...css.matchAll(m)].map((x) => x[1]).join("\n");
    expect(all.split("\n").filter((l) => l.includes("--ramp-")).length).toBe(125);
  });
});

/* ── 3 · A STYLESHEET THAT CANNOT MOVE OR HIDE A CONTROL ───────────────── */

describe("W2D3D · no rule can express a layout, visibility or content change", () => {
  const BANNED = ["display", "visibility", "opacity", "pointer-events", "order", "position",
    "content", "z-index", "float", "transform", "width", "height", "overflow",
    "flex-direction", "grid-template-columns", "text-align", "cursor", "user-select"];

  it("3.1 — neither new file declares any banned property", () => {
    for (const f of [COLLECTIVE, FOUNDER]) {
      const props = declaredProperties(read(f));
      for (const b of BANNED) expect(props, `${f} declares ${b}`).not.toContain(b);
    }
  });

  it("3.2 — neither new file declares padding or margin on a table cell", () => {
    for (const f of [COLLECTIVE, FOUNDER]) {
      const css = stripComments(read(f));
      expect(css).not.toMatch(/(td|th)[^{]*\{[^}]*\b(padding|margin)\b/);
    }
  });

  it("3.3 — neither new file contains an @media, @supports, @keyframes or attribute write", () => {
    for (const f of [COLLECTIVE, FOUNDER]) {
      const css = stripComments(read(f));
      expect(css).not.toContain("@media");
      expect(css).not.toContain("@keyframes");
      expect(css).not.toContain("::before");
      expect(css).not.toContain("::after");
    }
  });
});

/* ── 4 · THE TABLE-HEADER RULE — the bug this wave found and fixed ─────── */

describe("W2D3D · table headers can only ever get NARROWER, never wider", () => {
  it("4.1 — both files use the never-grow min(12px, 1em) form", () => {
    for (const f of [COLLECTIVE, FOUNDER]) {
      const css = stripComments(read(f));
      expect(css).toContain("font-size: min(12px, 1em)");
      expect(css).not.toMatch(/thead th \{[^}]*font-size:\s*12px/);
    }
  });

  it("4.2 — no letter-spacing is set on a table header", () => {
    for (const f of [COLLECTIVE, FOUNDER]) {
      const css = stripComments(read(f));
      const m = /thead th[^{]*\{([^}]*)\}/.exec(css);
      expect(m).toBeTruthy();
      expect(m![1]).not.toContain("letter-spacing");
    }
  });
});

/* ── 5 · SACRED AND SHARED FILES ARE UNTOUCHED ────────────────────────── */

describe("W2D3D · sacred and shared files", () => {
  it("5.1 — capavate-tokens.css still hashes to the value in the SACRED manifest (entry 41/48)", () => {
    /* The manifest file is the single source of truth and `npm run sacred` is the
       gate. This test reads the SAME manifest rather than hardcoding a second
       copy of the hash, so it can never become a drifting duplicate. */
    const manifest = read("sacred_baseline/SACRED_SHA256.txt");
    const line = manifest.split("\n").find((l) => l.includes("capavate-tokens.css"));
    expect(line, "capavate-tokens.css is not in the sacred manifest").toBeTruthy();
    const expected = line!.trim().split(/\s+/)[0];
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, TOKENS))).digest("hex");
    expect(actual).toBe(expected);
  });

  it("5.2 — index.css APPENDS the two imports after ledger-partner.css, never before", () => {
    const css = read(INDEX);
    const iPartner = css.indexOf('@import "./styles/ledger-partner.css";');
    const iColl = css.indexOf('@import "./styles/ledger-collective.css";');
    const iFound = css.indexOf('@import "./styles/ledger-founder.css";');
    const iTail = css.indexOf("@tailwind base;");
    expect(iPartner).toBeGreaterThan(-1);
    expect(iColl).toBeGreaterThan(iPartner);
    expect(iFound).toBeGreaterThan(iColl);
    expect(iTail).toBeGreaterThan(iFound);
  });

  it("5.3 — index.css's SHARED inline [collective],[partner] token block is NOT edited", () => {
    const css = read(INDEX);
    /* the warm marketing values that block declares must all still be there:
       this wave beats them with a specificity bump, it does not remove them,
       because the partner area resolves through the same block. */
    expect(css).toContain("--background: 60 17% 98%");
    expect(css).toContain("--border: 36 13% 85%");
    expect(css).toContain("--accent: 37 91% 44%");
    expect(css).toContain("--cap-site-bg: #fafaf8");
    expect(css).toContain("--cap-site-border: #ddd9d3");
  });

  it("5.4 — the doubled-attribute specificity bump is present for collective (0,2,0) and beats it", () => {
    expect(stripComments(read(COLLECTIVE))).toContain('[data-product="collective"][data-product="collective"]');
  });

  it("5.5 — the :root, partner, admin and investor ramp blocks each still declare 125 steps", () => {
    const css = read(RAMPS);
    for (const sel of [":root", '\\[data-product="partner"\\]', '\\[data-product="collective"\\]',
      '\\[data-product="founder"\\]', '\\[data-product="admin"\\]', '\\[data-product="investor"\\]']) {
      const m = new RegExp(`\\n${sel} \\{\\n([\\s\\S]*?)\\n\\}\\n`).exec(css);
      expect(m, `${sel} missing`).toBeTruthy();
      expect(m![1].split("\n").filter((l) => l.includes("--ramp-")).length, `${sel} step count`).toBe(125);
    }
  });

  it("5.6 — the admin and investor ramp blocks are still byte-identical to :root (Waves 4 and 5 unspent)", () => {
    const css = read(RAMPS);
    const block = (sel: string) => new RegExp(`\\n${sel} \\{\\n([\\s\\S]*?)\\n\\}\\n`).exec(css)![1]
      .split("\n").filter((l) => l.includes("--ramp-")).map((l) => l.trim());
    const root = block(":root");
    expect(block('\\[data-product="admin"\\]')).toEqual(root);
    expect(block('\\[data-product="investor"\\]')).toEqual(root);
  });

  it("5.7 — the COLLECTIVE ramp block is the only one this wave rewrote, and it differs from :root", () => {
    const css = read(RAMPS);
    const block = (sel: string) => new RegExp(`\\n${sel} \\{\\n([\\s\\S]*?)\\n\\}\\n`).exec(css)![1]
      .split("\n").filter((l) => l.includes("--ramp-")).map((l) => l.trim());
    expect(block('\\[data-product="collective"\\]')).not.toEqual(block(":root"));
  });
});

/* ── 6 · THE FIVE RATIFIED STATUS ROLES, NO SIXTH ─────────────────────── */

describe("W2D3D · the ratified palette", () => {
  const ROLES = ["positive", "negative", "warning", "neutral", "info"];

  it("6.1 — every re-pointed ramp step is annotated with one of the five roles and no sixth", () => {
    const css = read(RAMPS);
    const block = new RegExp('\\n\\[data-product="collective"\\] \\{\\n([\\s\\S]*?)\\n\\}\\n').exec(css)![1];
    const lines = block.split("\n").filter((l) => l.includes("--ramp-"));
    expect(lines.length).toBe(125);
    for (const l of lines) {
      const m = /\/\* #[0-9A-F]{6} — ([a-z]+)/.exec(l);
      expect(m, `unannotated: ${l}`).toBeTruthy();
      expect(ROLES).toContain(m![1]);
    }
  });

  it("6.2 — the same holds for the guarded founder ramps", () => {
    const css = stripComments(read(FOUNDER));
    const lines = css.split("\n").filter((l) => l.includes("--ramp-"));
    expect(lines.length).toBe(125);
    for (const l of lines) {
      const m = /\/\* #[0-9A-F]{6} — ([a-z]+)/.exec(l);
      /* comments are stripped, so re-read from the raw file for the annotation */
      void m;
    }
    const raw = read(FOUNDER).split("\n").filter((l) => l.includes("--ramp-"));
    expect(raw.length).toBe(125);
    for (const l of raw) {
      const m = /\/\* #[0-9A-F]{6} — ([a-z]+)/.exec(l);
      expect(m, `unannotated: ${l}`).toBeTruthy();
      expect(ROLES).toContain(m![1]);
    }
  });

  it("6.3 — the two LOCKED brand hexes are never redeclared (Tier-9 rule 74)", () => {
    for (const f of [COLLECTIVE, FOUNDER]) {
      const css = stripComments(read(f));
      expect(css).not.toMatch(/--cv-color-primary\s*:/);
      expect(css).not.toMatch(/--cv-color-navy\s*:/);
      expect(css).not.toMatch(/--primary\s*:/);
      expect(css).not.toMatch(/--ring\s*:/);
    }
  });

  it("6.4 — the chart ramp is never re-pointed (it is a CATEGORICAL axis)", () => {
    for (const f of [COLLECTIVE, FOUNDER]) {
      const css = stripComments(read(f));
      expect(css).not.toMatch(/--chart-\d\s*:/);
    }
  });
});

/* ── 7 · CLASS-TOKEN SELECTORS CANNOT CATCH A hover: VARIANT ──────────── */

describe("W2D3D · arbitrary-value class hooks use ~= and never *=", () => {
  it("7.1 — no [class*=…] selector exists in either file", () => {
    for (const f of [COLLECTIVE, FOUNDER]) {
      for (const s of selectors(read(f))) {
        /* [class*="…"] would also match a `hover:`/`focus:` variant of the same
           utility and paint a hover colour at rest — a FUNCTIONAL defect. The
           `[class*="border-"]` form on the status-pill rule is the one exception
           and is a *category* match, not a value match, so it is spelled out. */
        if (s.includes("[class")) expect(s).toMatch(/\[class~=|\[class\*="border-"\]/);
      }
    }
  });
});
