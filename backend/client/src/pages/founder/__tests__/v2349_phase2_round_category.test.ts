/**
 * v23.4.9 Phase 2 (Avi feedback #3) — Warrants surfaced as a third top-level
 * round category in RoundNew.
 *
 * Avi (30 May 2026): "along with priced round and unpriced round, there should
 * be an option to choose warrants, but here the warrant is working like a radio
 * button."
 *
 * Source-grep style assertions (vitest config in this tree globs `.test.ts`
 * with no jsdom).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUND_NEW = readFileSync(
  resolve(__dirname, "..", "RoundNew.tsx"),
  "utf8",
);

describe("v23.4.9 Phase 2 — three top-level round categories", () => {
  it("declares all three category labels", () => {
    expect(ROUND_NEW).toMatch(/"Priced Round"/);
    expect(ROUND_NEW).toMatch(/"Unpriced Round"/);
    expect(ROUND_NEW).toMatch(/"Warrants & Options"/);
  });

  it("maps warrant + option_pool to the Warrants & Options category", () => {
    expect(ROUND_NEW).toMatch(
      /label:\s*"Warrants & Options",\s*instruments:\s*\["warrant",\s*"option_pool"\]/,
    );
  });

  it("maps SAFE + Convertible Note to the Unpriced Round category", () => {
    expect(ROUND_NEW).toMatch(
      /label:\s*"Unpriced Round",\s*instruments:\s*\["safe_post",\s*"safe_pre",\s*"convertible_note"\]/,
    );
  });

  it("maps preferred + common to the Priced Round category", () => {
    expect(ROUND_NEW).toMatch(
      /label:\s*"Priced Round",\s*instruments:\s*\["preferred",\s*"common"\]/,
    );
  });

  it("renders a segmented control and filters the vehicle grid by category", () => {
    expect(ROUND_NEW).toMatch(/round-category-tabs/);
    expect(ROUND_NEW).toMatch(/visibleInstruments\.map/);
    // The grid must no longer iterate the full unfiltered INSTRUMENTS list.
    expect(ROUND_NEW).not.toMatch(/\{INSTRUMENTS\.map\(inst/);
  });
});
