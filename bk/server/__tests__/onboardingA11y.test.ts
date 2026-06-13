/**
 * Wave E Fix E1 + E13 — Onboarding (Landing) tile a11y + debug-leak guard.
 *
 * The "I'm a founder" / "I'm an investor" tiles on the Landing page were
 * `<Card onClick>` divs — not keyboard-accessible. They are now real
 * `<button>` elements with focus-visible rings and descriptive aria-labels.
 *
 * Additionally, the dev-only "Sprint 15 · login + entitlement" debug chip
 * was leaking into the production footer; it is now guarded by
 * `import.meta.env.DEV`.
 *
 * Source-level assertions only (no jsdom render) — same approach as other
 * static-file regression guards in this folder.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const LANDING = path.join(
  __dirname,
  "..",
  "..",
  "client",
  "src",
  "pages",
  "Landing.tsx",
);

describe("Wave E E1 — Onboarding tiles are keyboard-accessible", () => {
  const src = fs.readFileSync(LANDING, "utf8");

  it("founder tile is a real <button> with type=button", () => {
    // anchored: testid line must be inside a <button type="button"> block
    const m = src.match(
      /<button[\s\S]{0,400}data-testid="card-founder-path"/,
    );
    expect(m, "founder tile should be a <button>").toBeTruthy();
    expect(m![0]).toMatch(/type="button"/);
  });

  it("investor tile is a real <button> with type=button", () => {
    const m = src.match(
      /<button[\s\S]{0,400}data-testid="card-investor-path"/,
    );
    expect(m, "investor tile should be a <button>").toBeTruthy();
    expect(m![0]).toMatch(/type="button"/);
  });

  it("founder tile has descriptive aria-label", () => {
    const m = src.match(
      /<button[\s\S]{0,400}data-testid="card-founder-path"/,
    );
    expect(m![0]).toMatch(/aria-label="[^"]*founder[^"]*"/i);
  });

  it("investor tile has descriptive aria-label", () => {
    const m = src.match(
      /<button[\s\S]{0,400}data-testid="card-investor-path"/,
    );
    expect(m![0]).toMatch(/aria-label="[^"]*investor[^"]*"/i);
  });

  it("both tiles have focus-visible ring classes", () => {
    const founderBlock = src.match(
      /<button[\s\S]{0,400}data-testid="card-founder-path"/,
    )![0];
    const investorBlock = src.match(
      /<button[\s\S]{0,400}data-testid="card-investor-path"/,
    )![0];
    expect(founderBlock).toMatch(/focus-visible:ring-2/);
    expect(investorBlock).toMatch(/focus-visible:ring-2/);
  });

  it("does NOT use raw <Card onClick> for the tiles (a11y regression guard)", () => {
    // Card may still appear inside the button, but must not be the
    // clickable element itself.
    const founderCard = src.match(
      /<Card[\s\S]{0,200}onClick={goFounder}/,
    );
    const investorCard = src.match(
      /<Card[\s\S]{0,200}onClick={goInvestor}/,
    );
    expect(founderCard).toBeNull();
    expect(investorCard).toBeNull();
  });
});

describe("Wave E E13 — Sprint debug chip is dev-only", () => {
  const src = fs.readFileSync(LANDING, "utf8");

  it("Sprint chip is wrapped in import.meta.env.DEV guard", () => {
    // The chip must NOT appear unconditionally; it must be inside a DEV check.
    const sprintIdx = src.indexOf('data-testid="chip-sprint"');
    expect(sprintIdx).toBeGreaterThan(-1);
    // The 200 chars preceding the chip must contain a DEV guard.
    const preceding = src.slice(Math.max(0, sprintIdx - 200), sprintIdx);
    expect(preceding).toMatch(/import\.meta\.env\.DEV/);
  });
});
