/**
 * v23.4.6 Phase 3 (L-002) regression guard.
 *
 * Avi reported logout was broken (founder/admin logout redirected back to the
 * dashboard). Our v23.4.5 implementation correctly:
 *   1. Revokes the session userId server-side (sessionRevocation.revokeSession)
 *   2. Clears BOTH cookie variants (__Host-cap_uid + legacy cap_uid + cap_jwt)
 *   3. Returns 200 { ok: true }
 *
 * The remaining failure mode was client-side: the AppShell logout handler
 * calls queryClient.resetQueries() AND does a full-page navigation. The
 * investor/Settings.tsx logout was missing the resetQueries() call \u2014 added
 * in v23.4.6 Phase 3. This test pins both behaviours so they cannot regress.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..", "..");
const APP_SHELL = readFileSync(
  path.join(REPO, "client/src/components/AppShell.tsx"),
  "utf8",
);
const INVESTOR_SETTINGS = readFileSync(
  path.join(REPO, "client/src/pages/investor/Settings.tsx"),
  "utf8",
);
const SERVER_ROUTES = readFileSync(
  path.join(REPO, "server/routes.ts"),
  "utf8",
);
const SESSION_COOKIE_LIB = readFileSync(
  path.join(REPO, "server/lib/sessionCookie.ts"),
  "utf8",
);

describe("v23.4.6 Phase 3 (L-002) \u2014 Logout regression guard", () => {
  it("server logout route POSTs to /api/auth/logout and clears the session cookie", () => {
    expect(SERVER_ROUTES).toMatch(/app\.post\(["']\/api\/auth\/logout["']/);
    // Must call revokeSession AND clearSessionCookie within the handler.
    const handlerBlock = SERVER_ROUTES.match(
      /app\.post\(["']\/api\/auth\/logout["'][\s\S]{0,1200}?\}\);/,
    );
    expect(handlerBlock).not.toBeNull();
    expect(handlerBlock![0]).toMatch(/revokeSession/);
    expect(handlerBlock![0]).toMatch(/clearSessionCookie/);
  });

  it("clearSessionCookie clears BOTH the prefixed and legacy cookie names", () => {
    expect(SESSION_COOKIE_LIB).toMatch(/clearCookie\(SESSION_COOKIE/);
    expect(SESSION_COOKIE_LIB).toMatch(/clearCookie\(LEGACY_SESSION_COOKIE/);
  });

  it("AppShell sign-out handler calls /api/auth/logout, resets TanStack Query cache, AND does a full-page navigation", () => {
    expect(APP_SHELL).toMatch(/\/api\/auth\/logout/);
    expect(APP_SHELL).toMatch(/queryClient\.resetQueries\(\)/);
    expect(APP_SHELL).toMatch(/window\.location\.href\s*=\s*["']\/login["']/);
  });

  it("Investor Settings sign-out handler calls /api/auth/logout, resets TanStack Query cache, AND does a full-page navigation (v23.4.6 added the resetQueries call)", () => {
    expect(INVESTOR_SETTINGS).toMatch(/\/api\/auth\/logout/);
    expect(INVESTOR_SETTINGS).toMatch(/queryClient\.resetQueries\(\)/);
    expect(INVESTOR_SETTINGS).toMatch(
      /window\.location\.href\s*=\s*["']\/login["']/,
    );
  });
});
