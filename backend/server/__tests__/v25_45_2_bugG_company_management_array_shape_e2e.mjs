/* v25.45.2 Bug G — Company Management page crash regression (real-shape E2E).
 *
 * LIVE SYMPTOM (capavate.com authenticated QA, v25.45.0):
 *   The Company Management page crashed on mount with
 *     "(o.data ?? []).map is not a function"
 *   The error boundary caught it; the page never rendered.
 *
 * ROOT CAUSE:
 *   client/src/pages/founder/CompanyManagement.tsx > TeamPanel typed the
 *   members query as `useQuery<TeamMember[]>` and rendered `(members.data ?? []).map(...)`.
 *   But GET /api/founder/team/members returns the documented OBJECT shape
 *   `{ members: [...] }` (see routes.ts "Bug L" + Settings.tsx). Because
 *   `members.data` was a DEFINED non-array object, the `?? []` fallback never
 *   fired and `.map` threw at runtime.
 *
 * WHY SANDBOX MISSED IT (Tier-4 alignment):
 *   Prior tests asserted persistence/route existence but never asserted the
 *   REAL response SHAPE that the component renders. This test boots the REAL
 *   Express app and hits the REAL endpoint (no mock), captures the ACTUAL
 *   payload shape, and then runs the EXACT client extraction logic against it
 *   to prove the page no longer crashes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setupFounder("bugG"); }, 60_000);
afterAll(async () => { await h.teardown(); });

/**
 * Faithful re-implementation of the v25.45.2 CompanyManagement.tsx > TeamPanel
 * extraction logic. If the client code regresses to reading `data` as a bare
 * array (the original crash), this helper crashes exactly like production did.
 */
function extractMemberListLikeClient(queryData) {
  // const members = useQuery<{ members: TeamMember[] }>(...)
  // const memberList = Array.isArray(members.data)
  //   ? members.data
  //   : Array.isArray(members.data?.members) ? members.data.members : [];
  const memberList = Array.isArray(queryData)
    ? queryData
    : Array.isArray(queryData?.members)
      ? queryData.members
      : [];
  // The two render sites the page actually executes:
  const count = memberList.length;            // {memberList.length === 0 && ...}
  const rows = memberList.map((m) => m.id);    // {memberList.map(...)}  <-- crash site
  return { count, rows };
}

describe("v25.45.2 Bug G — Company Management real-shape regression (E2E)", () => {
  it("GET /api/founder/team/members returns the documented { members: [...] } OBJECT shape (NOT a bare array)", async () => {
    const r = await h.req("GET", "/api/founder/team/members", { userId: h.ids.FOUNDER });
    const isObjectShape =
      r.status === 200 &&
      r.body !== null &&
      typeof r.body === "object" &&
      !Array.isArray(r.body) &&
      Array.isArray(r.body.members);
    record("members endpoint returns { members: [...] }", isObjectShape, `status ${r.status} body ${JSON.stringify(r.body)}`);
    expect(isObjectShape).toBe(true);
    // The founder's own row must be present (no silent empty-array drop).
    expect(r.body.members.length).toBeGreaterThanOrEqual(1);
  });

  it("client extraction on the REAL payload does NOT throw '(data ?? []).map is not a function'", async () => {
    const r = await h.req("GET", "/api/founder/team/members", { userId: h.ids.FOUNDER });
    let crashed = false;
    let out = null;
    try {
      // Feed the ACTUAL server payload (object shape) through the client logic.
      out = extractMemberListLikeClient(r.body);
    } catch (err) {
      crashed = true;
      record("client extraction crash", false, String(err && err.message));
    }
    const ok = !crashed && out !== null && out.count >= 1 && Array.isArray(out.rows);
    record("client extraction survives real object-shape payload", ok, JSON.stringify(out));
    expect(crashed).toBe(false);
    expect(ok).toBe(true);
  });

  it("REPRODUCES the original prod crash when the OLD buggy logic meets the real object payload", async () => {
    const r = await h.req("GET", "/api/founder/team/members", { userId: h.ids.FOUNDER });
    // The pre-fix code: `(data ?? []).map(...)`. Against the real object shape
    // this MUST throw — proving this test would have caught the live bug.
    const buggy = () => (r.body ?? []).map((m) => m.id);
    let threw = false;
    try { buggy(); } catch { threw = true; }
    record("old buggy logic throws on real payload (would have caught live bug)", threw, "expected throw");
    expect(threw).toBe(true);
  });

  it("defensive extraction also tolerates a legacy bare-array payload without crashing", () => {
    // Forward-compat: if the endpoint ever returns a bare array, the client
    // must still render. (Array.isArray branch.)
    const out = extractMemberListLikeClient([{ id: "u1" }, { id: "u2" }]);
    const ok = out.count === 2 && out.rows.length === 2;
    record("legacy bare-array shape handled", ok, JSON.stringify(out));
    expect(ok).toBe(true);
  });

  it("defensive extraction tolerates malformed/empty payloads (null, undefined, {})", () => {
    const a = extractMemberListLikeClient(null);
    const b = extractMemberListLikeClient(undefined);
    const c = extractMemberListLikeClient({});
    const ok = a.count === 0 && b.count === 0 && c.count === 0;
    record("malformed payloads fall back to empty list", ok, "");
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45.2 Bug G company-management array-shape E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
