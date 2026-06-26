/* v25.45 F4 — Investor View modal renders the real InvestorCompanyDetail
 * component inline (Option A), not a placeholder.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const companySrc = readFileSync(resolve(ROOT, "client/src/pages/founder/Company.tsx"), "utf8");
const detailSrc = readFileSync(resolve(ROOT, "client/src/pages/investor/CompanyDetail.tsx"), "utf8");

describe("v25.45 F4 investor view modal — source", () => {
  it("modal embeds the real InvestorCompanyDetail in preview mode", () => {
    expect(companySrc).toContain('import InvestorCompanyDetail from "@/pages/investor/CompanyDetail"');
    expect(companySrc).toMatch(/<InvestorCompanyDetail companyIdOverride=\{profile\.id\} mode="preview"\s*\/>/);
  });
  it("placeholder text removed", () => {
    expect(companySrc).not.toContain("Investor preview — opens full-page at");
    expect(companySrc).toContain('data-testid="investor-preview-embed"');
  });
  it("InvestorCompanyDetail accepts companyIdOverride + preview mode props", () => {
    expect(detailSrc).toMatch(/companyIdOverride\?: string;\s*mode\?: "preview"/);
    expect(detailSrc).toContain("const id = companyIdOverride ?? params?.id;");
    expect(detailSrc).toContain('const isPreview = mode === "preview";');
  });
  it("preview mode suppresses navigate-away side effect (DM)", () => {
    expect(detailSrc).toContain("if (!isPreview) navigate(");
  });
});
