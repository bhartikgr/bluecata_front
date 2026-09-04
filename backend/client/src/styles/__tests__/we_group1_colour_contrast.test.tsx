/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WALKTHROUGH WAVE E · GROUP 1 (items 6a, 6b, 6e, 6f, 4a, 9a)
 * COLOUR THAT ENCODES MEANING — MEASURED, NOT CLAIMED.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS FILE PROVES, AND WHY IT IS BUILT THIS WAY
 * ---------------------------------------------------
 * The brief for this wave is explicit: "ASSERT THE COMPUTED RATIOS IN A TEST —
 * never claim them", and "NEVER COLOUR ALONE. Pair every colour with a label,
 * icon, or text."  Three separate things therefore have to be true, and each is
 * proved by its own assertion rather than inferred from the others:
 *
 *   (1) THE RULE REACHES THE ELEMENT.  Every CSS selector asserted below is
 *       READ OUT OF THE REAL STYLESHEET at test time — not retyped here — and
 *       matched against the REAL RENDERED ELEMENT with `Element.matches()`.
 *       A selector that stopped matching (a renamed attribute, a lost
 *       `data-product` scope, a deleted rule) reddens immediately. The
 *       extractor asserts its own yield (`=== n`) first, so a regex that
 *       matched nothing can never read as "all rules pass".
 *
 *   (2) THE COLOUR IS WHAT WE THINK IT IS.  The hex values are read back out of
 *       the LIVE CASCADE — `getComputedStyle(root).getPropertyValue("--we-…")`
 *       on the rendered partner root, with the real stylesheet file installed
 *       into the document — not from a constant in this file.
 *
 *   (3) THE RATIO IS COMPUTED HERE.  `contrast()` below implements WCAG 2.x
 *       relative luminance from first principles and is itself checked against
 *       two published anchors (black-on-white = 21:1, white-on-white = 1:1)
 *       before any product colour is measured. Every ratio assertion uses the
 *       value that function returns.
 *
 * A DECLARED LIMIT OF THE ENVIRONMENT, STATED RATHER THAN PAPERED OVER.
 * jsdom does NOT resolve `var()` inside a shorthand: with the real stylesheet
 * installed, `getComputedStyle(el).borderBottomColor` returns `rgb(0, 0, 0)`
 * and `borderBottomWidth` returns `medium`, because the declared value is
 * `3px solid var(--we-ramp-6)`. Measured while writing this file. It DOES
 * resolve custom properties via `getPropertyValue`, and it DOES resolve
 * non-`var()` longhands such as `border-right-style: dashed`. This file
 * therefore asserts computed style where jsdom computes honestly, and asserts
 * selector-match plus token value where it does not. It does NOT pretend to a
 * rendered colour measurement the environment cannot make.
 *
 * NON-COLOUR AFFORDANCES ARE ASSERTED AS RENDERED TEXT, in the same tests as
 * the colours they accompany, so a future change that keeps the colour and
 * drops the label cannot pass.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpvDetailTabs } from "@/components/partner/SpvDetailTabs";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async () =>
      ({ ok: true, status: 200, json: async () => ({}), text: async () => "{}" }) as unknown as Response,
  };
});

/* ── THE STYLESHEET UNDER TEST, READ FROM DISK ─────────────────────────────── */
const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(HERE, "..", "wave-e-partner-colour.css");
const CSS = readFileSync(CSS_PATH, "utf8");

/* ── WCAG 2.x CONTRAST, COMPUTED FROM FIRST PRINCIPLES ─────────────────────── */
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${JSON.stringify(hex)}`);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The three backgrounds a partner surface can actually paint behind these
 *  colours, read from `ledger-partner.css`'s partner scope. */
const BACKGROUNDS: Record<string, string> = {
  "card white (--cv-color-surface)": "#FFFFFF",
  "table/panel (--cv-color-surface-2)": "#F1F4F8",
  "page (--cv-color-bg)": "#F8FAFC",
};

/* ── SELECTOR EXTRACTION FROM THE REAL FILE ────────────────────────────────── */
/** Every selector in the stylesheet, comments stripped, one per rule head. */
function selectorsInStylesheet(css: string): string[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  const re = /([^{}]+)\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments)) !== null) {
    for (const s of m[1].split(",")) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}
const SELECTORS = selectorsInStylesheet(CSS);

/** Pick the single selector that contains every one of `needles`. */
function selectorContaining(...needles: string[]): string {
  const hits = SELECTORS.filter((s) => needles.every((n) => s.includes(n)));
  expect(
    hits.length,
    `expected exactly ONE selector in wave-e-partner-colour.css containing ${JSON.stringify(needles)}, found ${hits.length}: ${JSON.stringify(hits)}`,
  ).toBe(1);
  return hits[0];
}

/* ── STYLESHEET INSTALLATION AND THE PARTNER SCOPE ─────────────────────────── */
let sheet: HTMLStyleElement;
beforeAll(() => {
  sheet = document.createElement("style");
  sheet.setAttribute("data-we-group1", "1");
  /* The REAL file, verbatim. Nothing is rewritten, resolved or simplified on
     the way in — editing the stylesheet on its way into the instrument is
     exactly the kind of flattering that this wave's rules forbid. */
  sheet.textContent = CSS;
  document.head.appendChild(sheet);
});
afterAll(() => sheet.remove());

function partnerRoot(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-product", "partner");
  document.body.appendChild(el);
  return el;
}

/** Read one `--we-*` token out of the LIVE cascade on a real partner root. */
function tokenFromCascade(root: HTMLElement, name: string): string {
  const v = window.getComputedStyle(root).getPropertyValue(name).trim();
  expect(v, `token ${name} did not resolve on [data-product="partner"]`).toMatch(/^#[0-9A-Fa-f]{6}$/);
  return v;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("WE Group 1 · the contrast instrument itself", () => {
  it("reproduces two published WCAG anchors before it is used on any product colour", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 6);
    /* A known-failing pair, so the function is proved able to say NO. */
    expect(contrast("#E5EAF0", "#FFFFFF")).toBeLessThan(3);
  });

  it("the stylesheet parsed to a non-empty selector set (the extractor asserts its own yield)", () => {
    expect(SELECTORS.length).toBeGreaterThan(20);
    expect(SELECTORS.every((s) => s.includes('[data-product="partner"]'))).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ITEMS 6a / 6b / 6e / 6f — THE SPV TAB STRIP
   ═══════════════════════════════════════════════════════════════════════════ */
/* eslint-disable @typescript-eslint/no-explicit-any */
const spvDetail: any = {
  spv: {
    status: "open", jurisdiction: "delaware", lpVisibility: "own_only", closeDate: null,
    targetRaiseMinor: 200_000_000, terms: { vintage: 2026 }, revisionHash: null, updatedAt: null,
  },
  mandate: { mode: "deal_specific", sector: ["Fintech"], geography: ["United States"], stage: ["seed"] },
  fees: [], subscriptions: [], register: [], deployments: [], distributions: [],
  documents: [], transfers: [], capitalAccounts: [], closeSummary: undefined,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const EXPECTED_TAB_ORDER = [
  "overview", "mandate", "fees", "lps", "deployments", "distributions", "documents",
  "transfers", "close", "winddown", "compliance", "esignature", "nav", "k1",
  "sideletters", "reach",
];
const EXPECTED_GROUP: Record<string, string> = {
  overview: "vehicle", mandate: "vehicle", fees: "vehicle", compliance: "vehicle",
  lps: "money", deployments: "money", distributions: "money", transfers: "money",
  documents: "paperwork", esignature: "paperwork", sideletters: "paperwork", k1: "paperwork",
  close: "lifecycle", winddown: "lifecycle", nav: "lifecycle", reach: "lifecycle",
};
/** The group ramp step each group is painted with, and WHAT IT MEANS. */
const GROUP_TOKEN: Record<string, string> = {
  vehicle: "--we-ramp-6",
  money: "--we-ramp-3",
  paperwork: "--we-ramp-2",
  lifecycle: "--we-ramp-1",
};

function mountSpvTabs() {
  const root = partnerRoot();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <SpvDetailTabs spvId="spv_we_g1" detail={spvDetail} currency="USD" canWrite onChanged={() => {}} />
    </QueryClientProvider>,
    { container: root },
  );
  return { root, ...r };
}

describe("WE 6a/6b/6e/6f · the 16-tab SPV strip is grouped, and the grouping is not colour alone", () => {
  it("PREMISE RE-VERIFIED: all 16 triggers still render, in the original order, with the original labels", () => {
    const { root } = mountSpvTabs();
    const triggers = Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(triggers.length).toBe(16);
    expect(triggers.map((t) => t.getAttribute("data-testid"))).toEqual(
      EXPECTED_TAB_ORDER.map((k) => `spv-tab-${k}`),
    );
    /* The visible words the partner reads. If a "colour pass" had silently
       rewritten a label, R143.1 would have scored it as removed copy — this
       asserts the text directly rather than trusting the counter. */
    expect(triggers.map((t) => t.textContent)).toEqual([
      "Overview", "Mandate", "Fees", "LPs", "Deployments", "Distributions", "Documents",
      "Transfers", "Close", "Wind-down", "Compliance", "E-signature", "NAV", "K-1",
      "Side letters", "Reach",
    ]);
  });

  it("every trigger carries its group, exactly four groups exist, and each has exactly four members", () => {
    const { root } = mountSpvTabs();
    const counts: Record<string, number> = {};
    for (const key of EXPECTED_TAB_ORDER) {
      const el = root.querySelector<HTMLElement>(`[data-testid="spv-tab-${key}"]`);
      expect(el, `trigger ${key}`).toBeTruthy();
      const g = el!.getAttribute("data-spv-tab-group");
      expect(g, `group of ${key}`).toBe(EXPECTED_GROUP[key]);
      counts[g!] = (counts[g!] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(["lifecycle", "money", "paperwork", "vehicle"]);
    expect(Object.values(counts)).toEqual([4, 4, 4, 4]);
  });

  it("the four group RULES from the real stylesheet actually match the four real triggers they colour", () => {
    const { root } = mountSpvTabs();
    let matched = 0;
    for (const [group, token] of Object.entries(GROUP_TOKEN)) {
      const sel = selectorContaining('[data-testid^="spv-tabs-"]', `[data-spv-tab-group="${group}"]`);
      /* The rule must actually name this group's ramp token. */
      const body = CSS.split(sel)[1] ?? "";
      expect(body.slice(0, 120), `rule body for ${group}`).toContain(`var(${token})`);
      for (const key of EXPECTED_TAB_ORDER.filter((k) => EXPECTED_GROUP[k] === group)) {
        const el = root.querySelector<HTMLElement>(`[data-testid="spv-tab-${key}"]`)!;
        expect(el.matches(sel), `${key} should match ${sel}`).toBe(true);
        matched += 1;
      }
    }
    expect(matched).toBe(16);
  });

  it("MEASURED CONTRAST: every group ramp step clears 3:1 as a non-text boundary on all three partner backgrounds", () => {
    const { root } = mountSpvTabs();
    const measured: string[] = [];
    for (const [group, token] of Object.entries(GROUP_TOKEN)) {
      const hex = tokenFromCascade(root, token);
      for (const [bgName, bg] of Object.entries(BACKGROUNDS)) {
        const ratio = contrast(hex, bg);
        measured.push(`${group} ${token}=${hex} on ${bgName} ${ratio.toFixed(2)}:1`);
        expect(ratio, `${group} (${hex}) on ${bgName} (${bg}) — non-text 3:1`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(measured.length).toBe(12);
  });

  it("MEASURED CONTRAST: the group boundary rule and the legend caption clear their own requirements", () => {
    const { root } = mountSpvTabs();
    const rule = tokenFromCascade(root, "--we-rule");
    const caption = tokenFromCascade(root, "--we-caption");
    for (const [bgName, bg] of Object.entries(BACKGROUNDS)) {
      expect(contrast(rule, bg), `divider ${rule} on ${bgName} — non-text 3:1`).toBeGreaterThanOrEqual(3);
      expect(contrast(caption, bg), `legend caption ${caption} on ${bgName} — body text 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("THE NON-COLOUR AFFORDANCE (1): a text legend names all four groups, and it is not a tab", () => {
    const { root } = mountSpvTabs();
    const legend = root.querySelector<HTMLElement>('[data-testid="spv-tab-group-legend"]');
    expect(legend, "the group legend must be rendered").toBeTruthy();
    /* RENDERED TEXT, not a variable name. */
    expect(legend!.textContent).toBe("The vehicleThe moneyThe paperworkLifecycle");
    for (const [group, label] of Object.entries({
      vehicle: "The vehicle", money: "The money", paperwork: "The paperwork", lifecycle: "Lifecycle",
    })) {
      const swatch = legend!.querySelector<HTMLElement>(`[data-we-legend-key="${group}"]`);
      expect(swatch, `legend entry for ${group}`).toBeTruthy();
      expect(swatch!.textContent).toBe(label);
      /* Every coloured swatch is a NAMED label, never a bare colour chip. */
      expect(swatch!.textContent!.trim().length).toBeGreaterThan(0);
    }
    /* It must not have become a seventeenth tab. */
    expect(legend!.getAttribute("role")).toBe("presentation");
    expect(root.querySelectorAll('[role="tab"]').length).toBe(16);
  });

  it("THE NON-COLOUR AFFORDANCE (2): every group boundary is also drawn as a visible divider, not only a hue", () => {
    const { root } = mountSpvTabs();
    const sel = selectorContaining('[data-spv-tab-group-start="true"]');
    const starts = Array.from(root.querySelectorAll<HTMLElement>('[data-spv-tab-group-start="true"]'));
    expect(starts.map((e) => e.getAttribute("data-testid"))).toEqual([
      "spv-tab-overview", "spv-tab-lps", "spv-tab-documents", "spv-tab-close",
    ]);
    for (const el of starts) expect(el.matches(sel)).toBe(true);
    /* The boundary is a border, i.e. it survives with colour perception removed. */
    const body = CSS.split(sel)[1] ?? "";
    expect(body.slice(0, 160)).toContain("border-left");
    expect(body.slice(0, 160)).toContain("margin-left");
  });

  it("THE NON-COLOUR AFFORDANCE (3): the active tab is marked by weight and underline as well as colour", () => {
    const { root } = mountSpvTabs();
    const sel = selectorContaining('[data-spv-tab-group][data-state="active"]');
    const active = root.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    expect(active, "one tab must be active on mount").toBeTruthy();
    expect(active!.getAttribute("data-testid")).toBe("spv-tab-overview");
    expect(active!.matches(sel)).toBe(true);
    /* Radix's own non-visual affordance. */
    expect(active!.getAttribute("aria-selected")).toBe("true");
    const body = CSS.split(sel)[1] ?? "";
    expect(body.slice(0, 200)).toContain("font-weight: 700");
    expect(body.slice(0, 200)).toContain("border-bottom-width: 4px");
    /* And the accent it uses is legible as TEXT, not just as a rule. */
    const hex = tokenFromCascade(root, "--we-ramp-6");
    for (const [bgName, bg] of Object.entries(BACKGROUNDS)) {
      expect(contrast(hex, bg), `active tab text ${hex} on ${bgName} — 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE PALETTE AS A WHOLE — RESTRAINT, AND NO RED/GREEN
   ═══════════════════════════════════════════════════════════════════════════ */
describe("WE Group 1 · restraint and colour-vision safety, asserted on the stylesheet", () => {
  it("the whole file introduces ONE accent hue plus neutrals — eight colours, no more", () => {
    const hexes = Array.from(new Set((CSS.replace(/\/\*[\s\S]*?\*\//g, "").match(/#[0-9A-Fa-f]{6}/g) ?? []).map((h) => h.toUpperCase())));
    expect(hexes.sort()).toEqual(
      ["#041E41", "#0C2D55", "#1F4E79", "#274C77", "#3E6491", "#5B6B7F", "#6C7A8E", "#6E8CB4"].sort(),
    );
  });

  it("no red/green distinction is introduced: every colour is on the same blue hue arc", () => {
    /* 8% of men have a red-green deficiency, so a red/green pair must never be
       the only distinction. This asserts the stronger property: there is no red
       and no green in the file at all. Every colour has blue as its dominant
       channel and red as its weakest — a single hue family at different
       lightnesses, which is fully separable in greyscale. */
    const hexes = Array.from(new Set((CSS.replace(/\/\*[\s\S]*?\*\//g, "").match(/#[0-9A-Fa-f]{6}/g) ?? [])));
    expect(hexes.length).toBe(8);
    for (const h of hexes) {
      const r = parseInt(h.slice(1, 3), 16);
      const g = parseInt(h.slice(3, 5), 16);
      const b = parseInt(h.slice(5, 7), 16);
      expect(b, `${h} must be blue-dominant`).toBeGreaterThan(g);
      expect(g, `${h} must not be red-dominant`).toBeGreaterThan(r);
    }
  });

  it("the failing inherited border token is NOT redefined here — it is left as a declared open item", () => {
    const live = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    /* R274.3 / W321: --cv-color-border (#E5EAF0) measures 1.10:1–1.21:1 against
       a 3:1 requirement. It is platform-wide and the owner has scheduled it as
       its own wave. Half-changing a shared design token inside a colour wave is
       exactly what the brief forbids, so this asserts the restraint. */
    expect(live).not.toContain("--cv-color-border");
    expect(live).not.toContain("--border:");
    expect(live).not.toContain("#E5EAF0");
    /* And the reason, in numbers, is reproduced here so the decision is not a
       claim either. */
    expect(contrast("#E5EAF0", "#F1F4F8")).toBeLessThan(3);
    expect(contrast("#E5EAF0", "#F8FAFC")).toBeLessThan(3);
    expect(contrast("#E5EAF0", "#FFFFFF")).toBeLessThan(3);
  });

  it("every selector is scoped to the partner product, so no other area's colour can have moved", () => {
    expect(SELECTORS.length).toBeGreaterThan(20);
    const unscoped = SELECTORS.filter((s) => !s.startsWith('[data-product="partner"]'));
    expect(unscoped).toEqual([]);
  });
});
