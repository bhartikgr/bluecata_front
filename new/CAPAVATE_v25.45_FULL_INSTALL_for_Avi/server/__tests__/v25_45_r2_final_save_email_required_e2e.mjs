/* v25.45 ROUND 2 (BLOCKER 5) — final-save company email gate (server-side).
 *
 * The partial patch schema accepts an empty companyEmail so per-keystroke
 * in-progress autosaves never throw. But a FINAL save (final=true) must reject
 * an empty or malformed companyEmail with 400 — a client that bypasses the UI
 * gate must still not be able to durably finalize without a valid email.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder } from "./v25_45_helpers.mjs";

let h;
beforeAll(async () => { h = await setupFounder("r2finalemail"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 R2 — final-save requires a valid company email", () => {
  it("in-progress PATCH (no final flag) with empty email → 200 (autosave still works)", async () => {
    const r = await h.req("PATCH", `/api/companies/${h.ids.COMPANY}/profile`, {
      userId: h.ids.FOUNDER,
      body: { contact: { companyEmail: "" } },
    });
    expect(r.status).toBe(200);
  });

  it("final=true PATCH with EMPTY companyEmail → 400", async () => {
    const r = await h.req("PATCH", `/api/companies/${h.ids.COMPANY}/profile`, {
      userId: h.ids.FOUNDER,
      body: { final: true, contact: { companyEmail: "" } },
    });
    expect(r.status).toBe(400);
    expect(r.body?.errors?.["contact.companyEmail"]).toBeTruthy();
  });

  it("final=true PATCH with MALFORMED companyEmail → 400", async () => {
    const r = await h.req("PATCH", `/api/companies/${h.ids.COMPANY}/profile`, {
      userId: h.ids.FOUNDER,
      body: { final: true, contact: { companyEmail: "not-an-email" } },
    });
    // Malformed non-empty email is rejected by the schema (.email()) OR the
    // final gate — either way it must NOT durably finalize.
    expect(r.status).toBe(400);
  });

  it("final=true PATCH with VALID companyEmail → 200", async () => {
    const r = await h.req("PATCH", `/api/companies/${h.ids.COMPANY}/profile`, {
      userId: h.ids.FOUNDER,
      body: { final: true, contact: { companyEmail: "founder@example.com" } },
    });
    expect(r.status).toBe(200);
    // Persisted durably.
    const durable = h.readDurable();
    expect(durable?.contact?.companyEmail).toBe("founder@example.com");
  });
});
