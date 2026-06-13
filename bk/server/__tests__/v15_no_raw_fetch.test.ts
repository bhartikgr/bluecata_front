/**
 * v15 P0-13 — RoundDetail.tsx (the file flagged by the flow audit) must
 * use `apiRequest` instead of raw `fetch(...)` for /api/* calls.
 *
 * Raw `fetch()` bypasses the `apiRequest` helper in `client/src/lib/queryClient.ts`,
 * which means:
 *   1. The session cookie (cap_uid) does not travel with the call.
 *   2. The `__PORT_5000__` proxy prefix rewrite is not applied.
 *
 * The new credentialed cap-table HTTP surface (P0-1..P0-3) REQUIRES the
 * session cookie, so any raw fetch on these surfaces would silently break
 * in production.
 *
 * Audit P0-13 specifically called out `RoundDetail.tsx`. Other founder pages
 * (Dataroom, ProfileWizard, RoundNew, Settings, TermSheet) still contain
 * raw fetches and are tracked as v15-followup hardening items.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROUND_DETAIL = path.resolve(__dirname, "../../client/src/pages/founder/RoundDetail.tsx");

describe("v15 P0-13: RoundDetail.tsx uses apiRequest (no raw fetch on /api/*)", () => {
  it("RoundDetail.tsx contains no raw fetch(\"/api/...\") call", () => {
    const src = readFileSync(ROUND_DETAIL, "utf-8");
    // Strip comments to avoid false positives on lines like:
    //   // Raw fetch() omits credentials...
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const rawApiFetches = stripped.match(/\bfetch\(\s*[`"'][^`"'\)]*\/api\//g);
    expect(rawApiFetches, `unexpected raw fetch in RoundDetail.tsx: ${rawApiFetches}`).toBeNull();
  });

  it("RoundDetail.tsx imports apiRequest from queryClient", () => {
    const src = readFileSync(ROUND_DETAIL, "utf-8");
    expect(src).toMatch(/apiRequest/);
    expect(src).toMatch(/queryClient/);
  });
});
