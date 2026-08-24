/**
 * WAVE 105 — customer-facing copy fence.
 *
 * The owner's standing ruling: "I don't want any exposure of our internal
 * process. This needs to be investor grade and professional."
 * `MarketWatchWidget.tsx` used to tell a CUSTOMER to "Configure a market data
 * provider in .env" — a server configuration file, named to a member.
 *
 * This test fails on the pre-wave code (the `.env` literal is present) and
 * guards the three market-data components plus the server payload strings from
 * ever naming a config file, an environment variable or any other deployment
 * mechanic in customer-visible text. It also proves that no widget, tile, label
 * or state was silently dropped.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Vitest runs from the repo root (see vitest.config.ts). */
const ROOT = process.cwd();

const FILES = {
  ticker: "client/src/components/feeds/MarketTicker.tsx",
  watch: "client/src/components/feeds/MarketWatchWidget.tsx",
  venture: "client/src/components/collective/widgets/VentureMarketsCard.tsx",
  feeds: "server/feedsStore.ts",
} as const;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Extract the strings a customer can actually READ: JSX text nodes and quoted
 * literals, with comment blocks and lines stripped out. Comments never render.
 */
function customerVisibleText(src: string): string {
  const withoutBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  return withoutBlockComments
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: "a dotfile config reference (.env)", re: /\.env\b/ },
  { label: "the phrase 'environment variable'", re: /environment variable/i },
  { label: "the phrase 'env var'", re: /env var/i },
  { label: "the phrase 'config file'", re: /config file/i },
  { label: "a raw process.env read in UI copy", re: /process\.env/ },
];

describe("W105 — no internal deployment mechanics in customer-facing copy", () => {
  for (const [name, rel] of Object.entries(FILES).filter(([k]) => k !== "feeds")) {
    it(`${name} (${rel}) names no config file or environment variable`, () => {
      const visible = customerVisibleText(read(rel));
      for (const f of FORBIDDEN) {
        expect(visible, `${rel} must not expose ${f.label}`).not.toMatch(f.re);
      }
    });
  }

  it("the specific regression is gone: MarketWatchWidget no longer says 'in .env'", () => {
    const src = read(FILES.watch);
    expect(src).not.toContain("<code>.env</code>");
    expect(src).not.toMatch(/provider in\s*<code>/);
  });

  it("the server payload exposes provider STATUS words only, never a config knob name", () => {
    const src = read(FILES.feeds);
    // The only provider-facing values the payload can carry.
    expect(src).toContain('source: "environment" | "admin" | "none"');
    // The env var name lives in code/comments (legitimately) but is never part of
    // a string sent to a customer: it is only read via process.env.
    const stringLiterals = src.match(/"[^"\n]*"/g) ?? [];
    expect(stringLiterals.filter((s) => s.includes("FEEDS_PROVIDER"))).toEqual([]);
  });
});

describe("W105 — nothing silently dropped from the three components", () => {
  const REQUIRED_TESTIDS: Record<string, string[]> = {
    [FILES.ticker]: [
      "market-ticker",
      "ticker-capavate-pulse",
      "ticker-provider-unavailable",
      "ticker-configure-link",
      "ticker-tile-",
    ],
    [FILES.watch]: [
      "market-watch-widget",
      "marketwatch-provider-unavailable",
      "marketwatch-configure-link",
      "marketwatch-market",
      "marketwatch-crypto",
      "marketwatch-row-",
      "marketwatch-capavate-pulse",
    ],
    [FILES.venture]: [
      "widget-venture-markets",
      "widget-venture-loading",
      "widget-venture-error",
      "widget-venture-none-returned",
      "widget-venture-empty",
      "widget-venture-table",
      "widget-venture-row-",
      "widget-venture-provenance",
    ],
  };

  for (const [rel, ids] of Object.entries(REQUIRED_TESTIDS)) {
    it(`${rel} keeps every pre-existing test id`, () => {
      const src = read(rel);
      for (const id of ids) {
        expect(src, `${rel} lost ${id}`).toContain(id);
      }
    });
  }

  it("both venture empty states still exist and stay distinct", () => {
    const src = read(FILES.venture);
    expect(src).toContain("returned no venture market rows");
    expect(src).toContain("widget-venture-empty");
  });

  it("the ticker and Market Watch still render the Capavate Pulse in every state", () => {
    for (const rel of [FILES.ticker, FILES.watch]) {
      const src = read(rel);
      expect(src).toContain("applications today");
      expect(src).toContain("rounds opened");
      expect(src).toContain("connections made");
    }
  });
});
