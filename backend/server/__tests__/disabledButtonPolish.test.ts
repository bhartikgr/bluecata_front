/**
 * Wave E Fix E3 — Disabled buttons get clear visual + a11y feedback.
 *
 * Sub-3 audit flagged three raw <button disabled> sites whose disabled state
 * had no visual change (or only an inline opacity). They now either use the
 * design-system <Button> (which has disabled:opacity-50 disabled:cursor-not-allowed)
 * or explicitly add those Tailwind classes plus a `title` tooltip explaining why.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");

describe("Wave E E3 — disabled buttons polished", () => {
  it("ConsortiumApplyPage submit uses design-system <Button>", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "client", "src", "pages", "public", "ConsortiumApplyPage.tsx"),
      "utf8",
    );
    expect(src).toMatch(/from\s+["']@\/components\/ui\/button["']/);
    expect(src).toMatch(/<Button[\s\S]{0,800}data-testid="button-consortium-apply-submit"/);
    // The raw inline-styled <button disabled> with `padding: "12px 18px"` must be gone.
    expect(src).not.toMatch(/<button\s+type="submit"[\s\S]{0,400}padding:\s*"12px 18px"/);
  });

  it("founder Glossary letter buttons have disabled:opacity + cursor and a title hint", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "client", "src", "pages", "founder", "Glossary.tsx"),
      "utf8",
    );
    expect(src).toMatch(/disabled:opacity-50/);
    expect(src).toMatch(/disabled:cursor-not-allowed/);
    expect(src).toMatch(/title=\{has\s*\?\s*undefined\s*:/);
  });

  it("investor Glossary letter buttons have disabled:opacity + cursor and a title hint", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "client", "src", "pages", "investor", "Glossary.tsx"),
      "utf8",
    );
    expect(src).toMatch(/disabled:opacity-50/);
    expect(src).toMatch(/disabled:cursor-not-allowed/);
    expect(src).toMatch(/title=\{has\s*\?\s*undefined\s*:/);
  });
});
