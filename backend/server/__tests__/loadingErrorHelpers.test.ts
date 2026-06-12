/**
 * Wave E Fix E10 + E16 — Reusable loading/error helpers + first page adoption.
 *
 * The audit flagged 76 pages flashing empty content. Wave E ships the
 * reusable helpers and demonstrates first adoption on Welcome. Remaining
 * pages are tracked in the report as DEFERRED_POLISH (helpers now available).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");

describe("Wave E E16 — PageSkeleton + ErrorState helpers exist", () => {
  it("PageSkeleton component is present", () => {
    const file = path.join(ROOT, "client", "src", "components", "ui", "PageSkeleton.tsx");
    expect(fs.existsSync(file)).toBe(true);
    const src = fs.readFileSync(file, "utf8");
    expect(src).toMatch(/export\s+(function|const)\s+PageSkeleton/);
    expect(src).toMatch(/role="status"/);
    expect(src).toMatch(/aria-live="polite"/);
  });

  it("ErrorState component is present", () => {
    const file = path.join(ROOT, "client", "src", "components", "ui", "ErrorState.tsx");
    expect(fs.existsSync(file)).toBe(true);
    const src = fs.readFileSync(file, "utf8");
    expect(src).toMatch(/export\s+(function|const)\s+ErrorState/);
    expect(src).toMatch(/role="alert"/);
    expect(src).toMatch(/onRetry/);
  });
});

describe("Wave E E10 — Welcome page adopts PageSkeleton/ErrorState", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "client", "src", "pages", "founder", "Welcome.tsx"),
    "utf8",
  );

  it("imports PageSkeleton", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/PageSkeleton["']/);
  });

  it("imports ErrorState", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/ErrorState["']/);
  });

  it("renders PageSkeleton when the primary query is loading", () => {
    expect(src).toMatch(/<PageSkeleton[\s\S]*data-testid="page-welcome-loading"/);
  });

  it("renders ErrorState with retry when the primary query errored", () => {
    expect(src).toMatch(/<ErrorState[\s\S]*onRetry/);
    expect(src).toMatch(/data-testid="page-welcome-error"/);
  });
});
