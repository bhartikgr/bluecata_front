/**
 * Wave G Track 2 — G5: Micro-interactions library tests.
 *
 * Asserts the canonical exports + reduced-motion handling are present in
 * `client/src/lib/microInteractions.ts`. Pure read-only file inspection
 * keeps the test fast and avoids React/JSDOM bootstrap cost.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");
const FILE = path.join(ROOT, "client", "src", "lib", "microInteractions.ts");

const src = fs.readFileSync(FILE, "utf8");

describe("Wave G Track 2 G5 — micro-interactions library", () => {
  it("exports all canonical class-string constants", () => {
    const expected = [
      "HOVER_LIFT",
      "BUTTON_PRESS",
      "CARD_HOVER",
      "FOCUS_RING",
      "MODAL_ENTRY",
      "MODAL_EXIT",
      "TOAST_SLIDE_IN",
      "TOAST_SLIDE_OUT",
      "FIELD_SUCCESS",
      "FIELD_ERROR",
      "PULSE_BADGE",
      "SHIMMER_PLACEHOLDER",
    ];
    for (const name of expected) {
      expect(src).toMatch(new RegExp(`export\\s+const\\s+${name}\\b`));
    }
  });

  it("exports React hooks: useReducedMotion, useShimmer, usePulse, useTilt", () => {
    expect(src).toMatch(/export\s+function\s+useReducedMotion\b/);
    expect(src).toMatch(/export\s+function\s+useShimmer\b/);
    expect(src).toMatch(/export\s+function\s+usePulse\b/);
    expect(src).toMatch(/export\s+function\s+useTilt\b/);
  });

  it("HOVER_LIFT honors prefers-reduced-motion via motion-reduce: utilities", () => {
    expect(src).toMatch(/HOVER_LIFT[\s\S]*motion-reduce:/);
  });

  it("BUTTON_PRESS honors prefers-reduced-motion", () => {
    expect(src).toMatch(/BUTTON_PRESS[\s\S]*motion-reduce:/);
  });

  it("CARD_HOVER honors prefers-reduced-motion", () => {
    expect(src).toMatch(/CARD_HOVER[\s\S]*motion-reduce:/);
  });

  it("FOCUS_RING uses focus-visible (a11y) and cap-primary brand token", () => {
    expect(src).toMatch(/FOCUS_RING[\s\S]*focus-visible:/);
    expect(src).toMatch(/FOCUS_RING[\s\S]*cap-primary/);
  });

  it("modal + toast animations gate animation on motion-reduce", () => {
    expect(src).toMatch(/MODAL_ENTRY[\s\S]*motion-reduce:animate-none/);
    expect(src).toMatch(/MODAL_EXIT[\s\S]*motion-reduce:animate-none/);
    expect(src).toMatch(/TOAST_SLIDE_IN[\s\S]*motion-reduce:animate-none/);
    expect(src).toMatch(/TOAST_SLIDE_OUT[\s\S]*motion-reduce:animate-none/);
  });

  it("useReducedMotion subscribes to prefers-reduced-motion media query", () => {
    expect(src).toMatch(/matchMedia\(["']\(prefers-reduced-motion: reduce\)["']\)/);
  });

  it("useTilt accepts a strength parameter with a sensible default", () => {
    expect(src).toMatch(/useTilt\(strength:\s*number\s*=\s*5\)/);
  });

  it("MICRO_INTERACTIONS_CATALOG enumerates all class-strings + hooks", () => {
    expect(src).toMatch(/MICRO_INTERACTIONS_CATALOG/);
    // each class-string name appears in the catalog block
    const catalogMatch = src.match(/MICRO_INTERACTIONS_CATALOG[\s\S]*?\}\s+as\s+const;/);
    expect(catalogMatch).not.toBeNull();
    const block = catalogMatch![0];
    for (const k of ["HOVER_LIFT", "BUTTON_PRESS", "CARD_HOVER", "FOCUS_RING"]) {
      expect(block).toContain(k);
    }
    for (const h of ["useReducedMotion", "useShimmer", "usePulse", "useTilt"]) {
      expect(block).toContain(h);
    }
  });

  it("button.tsx wires BUTTON_PRESS into the base button classes", () => {
    const btn = fs.readFileSync(
      path.join(ROOT, "client", "src", "components", "ui", "button.tsx"),
      "utf8"
    );
    expect(btn).toMatch(/from\s+["']@\/lib\/microInteractions["']/);
    expect(btn).toMatch(/BUTTON_PRESS/);
  });

  it("card.tsx wires CARD_HOVER via the `interactive` prop", () => {
    const card = fs.readFileSync(
      path.join(ROOT, "client", "src", "components", "ui", "card.tsx"),
      "utf8"
    );
    expect(card).toMatch(/from\s+["']@\/lib\/microInteractions["']/);
    expect(card).toMatch(/CARD_HOVER/);
    expect(card).toMatch(/interactive\??:\s*boolean/);
  });
});
