/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WAVE 99 — SMALL-CAPITAL TABLE HEADERS, AND STATUS COLOURS THAT MEAN WHAT THEY
 *           SAY.  The wave that closes the design programme.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * §1  THE OVERFLOW REMEDY, IN ALL FIVE AREAS.  `text-transform: uppercase` on a
 *     table header is a WIDENING vector that `font-size: min(12px, 1em)` cannot
 *     bound: capitals are wider glyphs than lower case at the same size, so the
 *     shrink Wave 96 shipped removed ~14% while the transform added ~15-20%.  Net
 *     WIDER.  MEASURED on the real tree at 1440, the twelve-column founder cap
 *     table came to **1141px inside a 1134px container** with its last header —
 *     `% ON VIEW / of fully-diluted` — outside the host box.  With
 *     `font-variant-caps: all-small-caps` it comes to **1134px in 1134px**, over 0,
 *     every header back inside.
 *
 *     `all-small-caps` MUST BE PRESENT IN ALL FIVE AREAS, not just the one that
 *     overflowed.  Wave 4D+5D found this remedy, measured it, and DELIBERATELY
 *     DID NOT SHIP IT, because applying it in one area would make two of five
 *     diverge — and R74 is one product, one treatment.  These tests exist so that
 *     a later wave cannot quietly reintroduce the divergence.
 *
 * §2  `text-transform: uppercase` IS KEPT ALONGSIDE IT, ON PURPOSE.  This is not
 *     an oversight and it is not a redundancy:
 *       · `all-small-caps` enables BOTH `smcp` and `c2sc`, so it small-caps text
 *         that is already capitalised.  MEASURED: keeping the transform and
 *         dropping it give byte-identical geometry (1134/1134 at 1440, 1130 at
 *         1280 on the cap table) — the rendering does not care.
 *       · `innerText` DOES care.  With the transform kept it still reports
 *         `ACTIONS`; drop it and every table header in the product changes its
 *         reported text at once, on a programme whose bar is R82 zero silent
 *         drops.  Keeping it changes nothing anywhere.
 *       · dropping the transform WITHOUT small caps was measured and is NOT a fix:
 *         1136px in 1134px, still outside the host.
 *
 * §3  THE R80 BILLING EXCLUSION IS IN THE SELECTOR, AND MUST STAY THERE.  The
 *     founder rule is scoped
 *       `[data-product="founder"]:not(:has([data-testid=
 *        "card-collective-application-fee"])) table thead th`
 *     so a platform-wide header rule written inside it CANNOT reach
 *     `client/src/pages/founder/Billing.tsx`.  Proved live as well as statically:
 *     after this wave's edit, `/founder/billing`'s `thead th` still computes
 *     `font-variant-caps: normal`, `text-transform: none`, `font-size: 14px`.
 *
 * §4  STATUS SEMANTICS.  In the admin area `--primary` is not shadowed and
 *     resolves to `0 100% 40%` = **#CC0001**, the LOGO RED, which this programme
 *     ratified as the NEGATIVE anchor (Wave 2D+3D `STATUS_COLOURS.md` §4).
 *     `variant="default"` paints `bg-primary`.  So every
 *     `variant={x === <healthy> ? "default" : ...}` in admin painted a good state
 *     in the colour that means failure — `active` in the same red as `suspended`
 *     one branch below.  An operator learns the wrong meaning, which is worse than
 *     a dull colour.  These tests forbid the pattern coming back.
 *
 * §5  THE POSITIVE FILL IS #2C7346, NOT #379056.  #379056 is the positive FAMILY;
 *     MEASURED, white on it is **3.97:1**, below the 4.5:1 minimum this programme
 *     enforces.  The family's ratified ANCHOR is step 700 = **#2C7346**, white on
 *     which is **5.76:1**.  `bg-emerald-700` resolves to exactly that, because
 *     Wave 1D's ramp mechanism re-points Tailwind's `emerald-*` scale onto the
 *     positive role in every product area.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const STYLES = path.resolve(__dirname, "..");
const CLIENT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(p, "utf8");

/** strip comments so a rule cannot be "satisfied" by prose about it */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

const AREAS: Array<[string, string, string]> = [
  ["admin", "ledger-admin.css", '[data-product="admin"] table thead th'],
  ["investor", "ledger-investor.css", '[data-product="investor"] table thead th'],
  ["partner", "ledger-partner.css", '[data-product="partner"] table thead th'],
  ["collective", "ledger-collective.css", '[data-product="collective"] table thead th'],
  [
    "founder",
    "ledger-founder.css",
    '[data-product="founder"]:not(:has([data-testid="card-collective-application-fee"])) table thead th',
  ],
];

/** the declaration block of a rule, given its exact selector text */
function block(css: string, selector: string): string {
  const i = css.indexOf(selector + " {");
  expect(i, `the rule \`${selector}\` must exist verbatim`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("}", i));
}

// ─────────────────────────────────────────────────────────────────────────────
describe("W99 §1 · the small-capital remedy is present in ALL FIVE areas", () => {
  for (const [area, file, sel] of AREAS) {
    it(`${area}: the thead th rule declares font-variant-caps: all-small-caps`, () => {
      const b = block(code(read(path.join(STYLES, file))), sel);
      expect(b).toContain("font-variant-caps: all-small-caps");
    });

    it(`${area}: it declares no OTHER font-variant-caps value`, () => {
      const b = block(code(read(path.join(STYLES, file))), sel);
      const hits = [...b.matchAll(/font-variant-caps:\s*([^;]+);/g)].map((m) => m[1].trim());
      expect(hits).toEqual(["all-small-caps"]);
    });

    it(`${area}: Wave 96's never-grow font-size: min(12px, 1em) SURVIVES the change`, () => {
      // the brief is explicit: keep min(12px, 1em), never a hard 12px.  A wave
      // that "simplified" this back to 12px would re-break the founder cap table.
      const b = block(code(read(path.join(STYLES, file))), sel);
      expect(b).toContain("font-size: min(12px, 1em)");
      expect(code(read(path.join(STYLES, file)))).not.toMatch(/font-size:\s*12px\s*;/);
    });

    it(`${area}: text-transform: uppercase is KEPT, so header innerText is unchanged`, () => {
      // see §2 — dropping it is measured-equivalent visually and NOT equivalent
      // for the text census, so it stays.
      const b = block(code(read(path.join(STYLES, file))), sel);
      expect(b).toContain("text-transform: uppercase");
    });
  }

  it("font-variant-caps is declared on TABLE HEADERS ONLY, in every ledger file", () => {
    // scope guard: the property must not leak onto body copy, chips or labels.
    for (const [, file] of AREAS) {
      const c = code(read(path.join(STYLES, file)));
      for (const m of c.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (/font-variant-caps/.test(m[2])) {
          expect(m[1].trim(), `font-variant-caps escaped onto: ${m[1].trim()}`).toMatch(
            /table thead th$/
          );
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W99 §3 · the R80 founder-Billing exclusion is intact", () => {
  it("the founder thead th rule still carries the :not(:has(...)) Billing guard", () => {
    const c = code(read(path.join(STYLES, "ledger-founder.css")));
    expect(c).toContain(
      '[data-product="founder"]:not(:has([data-testid="card-collective-application-fee"])) table thead th'
    );
  });

  it("no ledger file styles a table header from an UNGUARDED founder scope", () => {
    // a rule such as `[data-product="founder"] table thead th` would reach
    // Billing and defeat the guard, so its absence is asserted directly.
    const c = code(read(path.join(STYLES, "ledger-founder.css")));
    expect(c).not.toMatch(/\[data-product="founder"\]\s+table\s+thead\s+th/);
  });

  it("no ledger file styles a table header from a product-agnostic scope", () => {
    for (const [, file] of AREAS) {
      const c = code(read(path.join(STYLES, file)));
      for (const m of c.matchAll(/([^{}]+)\{[^}]*\}/g)) {
        const sel = m[1].trim();
        if (/table\s+thead\s+th/.test(sel)) {
          expect(sel, `unscoped header rule would reach Billing: ${sel}`).toContain(
            "[data-product="
          );
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W99 §4 · the Badge `positive` variant, and its contrast", () => {
  const badge = () => read(path.join(CLIENT, "components/ui/badge.tsx"));

  it("Badge exposes a `positive` variant filled with the ratified positive ramp", () => {
    const c = code(badge());
    expect(c).toMatch(/positive:\s*\n?\s*"[^"]*bg-emerald-700[^"]*"/);
  });

  it("the positive chip pairs the fill with WHITE text, which is 5.76:1 on #2C7346", () => {
    const c = code(badge());
    const m = c.match(/positive:\s*\n?\s*"([^"]*)"/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("text-white");
  });

  it("the positive chip is NOT filled with #379056, which is only 3.97:1 on white", () => {
    // the brief names the positive FAMILY; the family's ratified ANCHOR is used
    // because the family value itself fails the 4.5:1 minimum as a fill.
    expect(code(badge())).not.toMatch(/#379056/i);
  });

  it("the four pre-existing variants are untouched, so no existing badge moves", () => {
    const c = code(badge());
    expect(c).toContain("border-transparent bg-primary text-primary-foreground shadow-xs");
    expect(c).toContain("border-transparent bg-secondary text-secondary-foreground");
    expect(c).toContain(
      "border-transparent bg-destructive text-destructive-foreground shadow-xs"
    );
    expect(c).toMatch(/outline:\s*\n?\s*"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W99 §5 · no admin surface paints a HEALTHY state in the negative red", () => {
  const ADMIN = path.join(CLIENT, "pages/admin");
  const files = fs
    .readdirSync(ADMIN)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => path.join(ADMIN, f));

  /** states this programme treats as POSITIVE wherever they appear as a status */
  const POSITIVE = ["active", "paid", "delivered", "resolved", "succeeded", "completed"];

  for (const state of POSITIVE) {
    it(`no admin page maps \`${state}\` to the "default" (logo-red) badge variant`, () => {
      const offenders: string[] = [];
      for (const f of files) {
        const c = code(read(f));
        // `=== "active" ? "default"` — the ternary form
        if (new RegExp(`===\\s*"${state}"\\s*\\?\\s*"default"`).test(c)) {
          offenders.push(`${path.basename(f)} (ternary)`);
        }
        // `if (s === "active") return "default"` — the helper form
        if (new RegExp(`"${state}"[^\\n]*\\)\\s*return\\s*"default"`).test(c)) {
          offenders.push(`${path.basename(f)} (helper return)`);
        }
      }
      expect(offenders, `logo red on the healthy state \`${state}\``).toEqual([]);
    });
  }

  it("the two helpers that decide a status colour return `positive`, not `default`", () => {
    const bh = code(read(path.join(ADMIN, "BridgeHistory.tsx")));
    expect(bh).toContain('if (s === "delivered" || s === "resolved") return "positive";');
    const pd = code(read(path.join(ADMIN, "PartnerDetail.tsx")));
    expect(pd).toContain('if (s === "active") return "positive" as const;');
  });

  it("`destructive` still marks the genuinely bad states, so red keeps its meaning", () => {
    // the fix must not have drained red of meaning: the failure branches are
    // asserted to be UNCHANGED.
    const bh = code(read(path.join(ADMIN, "BridgeHistory.tsx")));
    expect(bh).toContain('if (s === "dead_letter" || s === "failed") return "destructive";');
    const users = code(read(path.join(ADMIN, "Users.tsx")));
    expect(users).toContain('"suspended" ? "destructive"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W99 §6 · the admin Users role badge is legible", () => {
  const users = () => read(path.join(CLIENT, "pages/admin/Users.tsx"));

  it("the non-admin role chip pairs bg-secondary with text-secondary-foreground", () => {
    // a variant-less <Badge> inherits `text-primary-foreground` = WHITE from the
    // default variant.  Overriding only the BACKGROUND to `bg-secondary` left
    // white on #F1F4F8 = 1.10:1.  The paired token is #16233B = 14.23:1.
    const c = code(users());
    expect(c).toContain('"bg-secondary text-secondary-foreground"');
    expect(c).not.toMatch(/\?\s*"bg-\[hsl\(0_100%_40%\)\] text-white border-0"\s*:\s*"bg-secondary"/);
  });

  it("the role chip still distinguishes admin from everyone else", () => {
    // COLOUR ONLY: the predicate and BOTH branches of the role chip must survive
    // this wave intact.  Asserted as the WHOLE expression, not just the predicate
    // substring: mutation M22 deleted the predicate on THIS line and an earlier
    // draft of this test still passed, because `u.role === "admin"` also appears
    // in the unrelated demote handler further down the file.  A substring that
    // occurs twice cannot pin the one occurrence you care about.
    expect(code(users())).toContain(
      '<Badge className={u.role === "admin" ? "bg-[hsl(0_100%_40%)] text-white border-0" : "bg-secondary text-secondary-foreground"}>{u.role}</Badge>'
    );
  });

  it("the account status chip uses the positive variant for `active`", () => {
    expect(code(users())).toContain('u.status === "active" ? "positive"');
  });
});
