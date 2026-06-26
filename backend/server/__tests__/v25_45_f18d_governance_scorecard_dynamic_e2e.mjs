/* v25.45 F18d — Full-Page governance scorecard "Formal Board of Directors"
 * derives dynamically from profile.legal.boardComposition (F18c data).
 *
 * Backend: seed boardComposition via the real profile PATCH, then read it back
 * through GET /api/companies/:id (the Full-Page data source) and the durable
 * row, asserting directorsCount / directorsSnapshot round-trip to DB.
 *
 * Frontend: source-assert that CompanyDetails.tsx derives the checkmark from
 * boardComposition (count>0 || snapshot non-empty) rather than the legacy
 * ma.hasFormalBoard boolean alone.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f18d"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F18d governance scorecard dynamic — E2E", () => {
  it("1. PATCH legal.boardComposition (count + snapshot) → 200", async () => {
    const r = await h.patchProfile({ legal: {
      boardComposition: {
        directorsCount: 5,
        directorsSnapshot: [{ name: "Alice Chen", role: "CEO" }, { name: "Bob Smith", role: "Independent" }],
      },
    }});
    const ok = r.status === 200;
    record("boardComposition patch → 200", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });

  it("2. persisted durably to profile_json.legal.boardComposition", () => {
    const d = h.readDurable();
    const bc = d?.legal?.boardComposition;
    const ok = bc?.directorsCount === 5 && bc?.directorsSnapshot?.length === 2
      && bc.directorsSnapshot[0].name === "Alice Chen";
    record("durable boardComposition round-trips", ok, `count ${bc?.directorsCount} snap ${bc?.directorsSnapshot?.length}`);
    expect(ok).toBe(true);
  });

  it("3. GET /api/companies/:id (Full-Page source) exposes boardComposition", async () => {
    const r = await h.req("GET", `/api/companies/${h.ids.COMPANY}?as=founder`, { userId: h.ids.FOUNDER });
    const bc = r.body?.profile?.legal?.boardComposition;
    const ok = r.status === 200 && bc?.directorsCount === 5;
    record("full-page source has boardComposition", ok, `status ${r.status} count ${bc?.directorsCount}`);
    expect(ok).toBe(true);
  });

  it("4. zeroing the board count + empty snapshot persists (checkmark would clear)", async () => {
    const r = await h.patchProfile({ legal: { boardComposition: { directorsCount: 0, directorsSnapshot: [] } } });
    const d = h.readDurable();
    const bc = d?.legal?.boardComposition;
    const ok = r.status === 200 && bc?.directorsCount === 0 && (bc?.directorsSnapshot?.length ?? 0) === 0;
    record("board count → 0 persists", ok, `count ${bc?.directorsCount}`);
    expect(ok).toBe(true);
  });

  it("5. Full-Page source derives checkmark from boardComposition (not legacy bool alone)", () => {
    const src = readFileSync(resolve(__dirname, "../../client/src/pages/CompanyDetails.tsx"), "utf8");
    const ok = /hasFormalBoardDerived/.test(src)
      && /boardComposition/.test(src)
      && /directorsCount/.test(src)
      && /directorsSnapshot/.test(src)
      && /label="Formal Board of Directors" v=\{hasFormalBoardDerived\}/.test(src);
    record("scorecard derives from boardComposition", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F18d E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
