/* v25.45 F6b — Settings → Profile tab persists to DB AND the Privacy &
 * Visibility sub-section has been removed from the Profile tab.
 *
 * Backend: PATCH /api/auth/me writes through to the `users` SQL table
 * (name/email/title columns, migration 0050). We assert the row updates.
 *
 * Frontend: source-assert the Profile TabsContent no longer renders a
 * Privacy & Visibility card or a Save-privacy-preferences button (those moved
 * to the Privacy tab per F6b/F13).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
import { rawDb } from "../db/connection.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f6"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F6 Profile tab DB + Privacy removed — E2E", () => {
  it("1. PATCH /api/auth/me persists name + title to users table", async () => {
    const r = await h.req("PATCH", "/api/auth/me", {
      userId: h.ids.FOUNDER, body: { name: "F6 Founder Name", title: "F6 Chief", email: h.ids.EMAIL },
    });
    const row = rawDb().prepare("SELECT name, title FROM users WHERE id = ?").get(h.ids.FOUNDER);
    const ok = r.status === 200 && row?.name === "F6 Founder Name" && row?.title === "F6 Chief";
    record("profile fields persist to users table", ok, `status ${r.status} name ${row?.name} title ${row?.title}`);
    expect(ok).toBe(true);
  });

  it("2. updated values survive a re-read (DB source of truth)", () => {
    const row = rawDb().prepare("SELECT name, title FROM users WHERE id = ?").get(h.ids.FOUNDER);
    const ok = row?.name === "F6 Founder Name" && row?.title === "F6 Chief";
    record("DB re-read confirms persistence", ok);
    expect(ok).toBe(true);
  });

  it("3. Profile tab no longer renders Privacy & Visibility card", () => {
    const src = readFileSync(resolve(__dirname, "../../client/src/pages/founder/Settings.tsx"), "utf8");
    // Isolate the Profile TabsContent block.
    const start = src.indexOf('<TabsContent value="profile"');
    const end = src.indexOf("</TabsContent>", start);
    // Strip JSX comments so the F6b explanatory note (which mentions the
    // removed card by name) does not produce a false positive.
    const profileBlock = src.slice(start, end).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const ok = start !== -1
      && !/PrivacyControls/.test(profileBlock)
      && !/section-privacy/.test(profileBlock)
      && !/button-save-privacy/.test(profileBlock)
      && !/<CardTitle[^>]*>[^<]*Privacy/i.test(profileBlock);
    record("Privacy section absent from Profile tab", ok);
    expect(ok).toBe(true);
  });

  it("4. Privacy controls still live on the dedicated Privacy tab (not lost)", () => {
    const src = readFileSync(resolve(__dirname, "../../client/src/pages/founder/Settings.tsx"), "utf8");
    const start = src.indexOf('<TabsContent value="privacy"');
    const end = src.indexOf("</TabsContent>", start);
    const privacyBlock = src.slice(start, end);
    const ok = /PrivacyControls/.test(privacyBlock);
    record("Privacy controls present on Privacy tab", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F6 Profile E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
