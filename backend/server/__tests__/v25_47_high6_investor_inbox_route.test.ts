/**
 * v25.47 APD-035 (HIGH-6) — /investor/inbox route exists in the SPA.
 *
 * Source-level assertion (the route is declarative JSX; no server endpoint to
 * exercise). We assert App.tsx declares the /investor/inbox route guarded by
 * RequireAuth with redirectTo="/investor/login", mirroring the sibling
 * /investor/messages route.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const APP_TSX = path.resolve(__dirname, "../../client/src/App.tsx");

describe("APD-035 investor inbox route", () => {
  const src = readFileSync(APP_TSX, "utf8");

  it("declares the /investor/inbox route", () => {
    expect(src).toContain('path="/investor/inbox"');
  });

  it("guards it with RequireAuth redirectTo=/investor/login", () => {
    const idx = src.indexOf('path="/investor/inbox"');
    expect(idx).toBeGreaterThan(-1);
    // The route element (next ~200 chars) wires RequireAuth with the investor
    // login redirect.
    const block = src.slice(idx, idx + 200);
    expect(block).toContain("RequireAuth");
    expect(block).toContain('redirectTo="/investor/login"');
  });
});
