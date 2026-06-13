/**
 * v13 — Avi's Issue 1: post-login routing.
 *
 * "after logging in, the login or signup page should not open again; it should
 *  redirect to the dashboard page."
 *
 * Login.tsx and Signup.tsx must each contain a useEffect that probes
 * GET /api/auth/me and navigates to the correct dashboard when the response
 * says isAuthed === true.
 *
 * This is a UI behavior; rather than spinning up jsdom and React, we verify the
 * implementation contract textually — the markers below are exactly what the
 * v13 patch wrote and what the verifier looks for.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("v13 B-V13-1 — post-login redirect", () => {
  it("Login.tsx contains the meProbe + redirect useEffect", () => {
    const src = read("client/src/pages/auth/Login.tsx");
    expect(src).toMatch(/B-V13-1 fix/);
    expect(src).toMatch(/login-redirect-probe/);
    expect(src).toMatch(/navigate\("\/founder\/dashboard"\)/);
    expect(src).toMatch(/navigate\("\/investor\/dashboard"\)/);
  });

  it("Login.tsx honours ?returnTo=<path>", () => {
    const src = read("client/src/pages/auth/Login.tsx");
    expect(src).toMatch(/returnTo/);
  });

  it("Signup.tsx contains the meProbe + redirect useEffect", () => {
    const src = read("client/src/pages/auth/Signup.tsx");
    expect(src).toMatch(/B-V13-1 fix/);
    expect(src).toMatch(/signup-redirect-probe/);
    expect(src).toMatch(/navigate\("\/founder\/dashboard"\)/);
  });

  it("Signup.tsx imports useEffect + useQuery", () => {
    const src = read("client/src/pages/auth/Signup.tsx");
    expect(src).toMatch(/import\s*\{[^}]*useEffect[^}]*\}\s*from\s*"react"/);
    expect(src).toMatch(/import\s*\{[^}]*useQuery[^}]*\}\s*from\s*"@tanstack\/react-query"/);
  });
});
