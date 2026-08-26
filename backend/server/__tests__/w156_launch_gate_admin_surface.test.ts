/**
 * WAVE 156 — THE SPV LAUNCH CHECK ADMIN SURFACE. R124.4.1, R114.3, R77, R111 Q13.
 *
 * WHAT IS BEING PINNED:
 *
 *  1. THE MODE CAN BE CHANGED FROM ADMIN AT ALL. Before this wave there was no
 *     writer endpoint — only GET /settings — so R114.3's "hard release condition"
 *     could not be exercised. Asserted on a REAL API RESPONSE through the real
 *     Express router with the real `requireAdmin` guard, and then re-read through
 *     `getLaunchGateMode()` so a pass cannot be the endpoint agreeing with itself.
 *  2. A REASON IS REQUIRED (`intent_required`, no placeholder fallback) and an
 *     invalid mode is refused in plain language rather than written.
 *  3. THE CLIENT SCREEN EXISTS AND IS ROUTED. Before this wave, grepping
 *     client/src for the gate returned nothing at all.
 *  4. THE SCREEN NEVER PRESENTS A COMPED MEMBERSHIP AS PAID and never prints a
 *     raw code where a sentence belongs (R77).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "fs";
import { join } from "path";

import { registerAdminSpvLaunchGateRoutes } from "../adminSpvLaunchGateRoutes";
import { getLaunchGateMode, installLaunchGateSettings } from "../lib/spvEligibilityGate";

const ADMIN = "u_admin";
const CLIENT = join(process.cwd(), "client", "src");
/**
 * Comments are STRIPPED before any conclusion is drawn from source text. A
 * docblock is not evidence of behaviour: the first run of this file failed 3e
 * only because the word "Paid" appears in a comment explaining that a comped
 * membership is never CALLED Paid. That trap has produced false gap reports in
 * this project before, so it is closed here rather than worked around.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const PAGE_RAW = readFileSync(join(CLIENT, "pages", "admin", "SpvLaunchGate.tsx"), "utf8");
const APP_RAW = readFileSync(join(CLIENT, "App.tsx"), "utf8");
const PAGE = stripComments(PAGE_RAW);
const APP = stripComments(APP_RAW);

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerAdminSpvLaunchGateRoutes(app);
  try {
    installLaunchGateSettings("u_test_w156");
  } catch {
    /* Seeding is idempotent and the readers default to the shipping values, so a
       seed failure must not be reported as a mode-writer failure. */
  }
});

describe("W156-1 — the owner can change how strict the launch check is", () => {
  it("1a: PUT /settings switches the mode, and the STORED value moves with it", async () => {
    const res = await request(app)
      .put("/api/admin/spv-launch-gate/settings")
      .set("x-user-id", ADMIN)
      .send({ mode: "warn", reason: "Payment path unconfigured; refusing every create is an outage." });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe("warn");
    /* Read through the gate's OWN reader, not the response body. */
    expect(getLaunchGateMode()).toBe("warn");

    const back = await request(app)
      .put("/api/admin/spv-launch-gate/settings")
      .set("x-user-id", ADMIN)
      .send({ mode: "enforced", reason: "Memberships are now on record; restoring strict." });
    expect(back.status).toBe(200);
    expect(back.body.mode).toBe("enforced");
    expect(getLaunchGateMode()).toBe("enforced");
    /* R123.1 must be SAID, not hidden: switching to strict warns about the lockout. */
    expect(back.body.message).toMatch(/membership on record/i);
  });

  it("1b: GET /settings reports the mode the writer left behind", async () => {
    const res = await request(app)
      .get("/api/admin/spv-launch-gate/settings")
      .set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe(getLaunchGateMode());
  });
});

describe("W156-2 — the writer refuses rather than guessing", () => {
  it("2a: no reason is refused with intent_required and NOTHING is written", async () => {
    const before = getLaunchGateMode();
    const res = await request(app)
      .put("/api/admin/spv-launch-gate/settings")
      .set("x-user-id", ADMIN)
      .send({ mode: "warn" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("intent_required");
    expect(res.body.message).toMatch(/State why/i);
    expect(getLaunchGateMode()).toBe(before);
  });

  it("2b: an unrecognised mode is refused in plain language", async () => {
    const before = getLaunchGateMode();
    const res = await request(app)
      .put("/api/admin/spv-launch-gate/settings")
      .set("x-user-id", ADMIN)
      .send({ mode: "off", reason: "trying it on" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Refuse the launch/i);
    expect(getLaunchGateMode()).toBe(before);
  });

  it("2c: a non-admin caller cannot change the mode", async () => {
    const res = await request(app)
      .put("/api/admin/spv-launch-gate/settings")
      .send({ mode: "warn", reason: "no identity attached" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("ADMIN_REQUIRED");
  });
});

describe("W156-3 — the screen exists, is routed, and speaks plainly", () => {
  it("3a: the page drives every wave-154 endpoint the ruling names", () => {
    expect(PAGE).toContain("/api/admin/spv-launch-gate/settings");
    expect(PAGE).toContain("/api/admin/spv-launch-gate/overrides");
    expect(PAGE).toContain("/overrides/${id}/revoke".replace("${id}", "${id}"));
    expect(PAGE).toContain("/api/admin/spv-launch-gate/evaluate/");
  });

  it("3b: /admin/spv-launch-gate is routed behind the admin guard", () => {
    expect(APP).toContain('<Route path="/admin/spv-launch-gate">');
    const idx = APP.indexOf('<Route path="/admin/spv-launch-gate">');
    const block = APP.slice(idx, idx + 400);
    expect(block).toContain('RequireAuth role="admin"');
    expect(block).toContain("AdminSpvLaunchGate");
  });

  it("3c: unreadable state reads 'Not on record' (R111 Q13), never a guess", () => {
    expect(PAGE).toContain('const NOT_ON_RECORD = "Not on record"');
    expect(PAGE_RAW).toContain("R111 Q13");
    /* Every one of the three settings falls back to it rather than to a default. */
    const fallbacks = PAGE.match(/return NOT_ON_RECORD;/g) ?? [];
    expect(fallbacks.length).toBeGreaterThanOrEqual(4);
  });

  it("3d: a reason is required in the UI before either write can be attempted", () => {
    expect(PAGE).toContain("modeReason.trim().length > 0");
    expect(PAGE).toContain("overrideReason.trim().length > 0");
  });

  it("3e: it shows the standing label, so a comped membership is never called Paid", () => {
    expect(PAGE).toContain("standingLabel");
    expect(PAGE).not.toContain('"Paid"');
  });

  it("3f: withdrawing an override says the record is kept, and nothing deletes", () => {
    expect(PAGE).toMatch(/kept for history/i);
    expect(PAGE).not.toMatch(/cannot be undone/i);
    expect(PAGE).not.toMatch(/\bDELETE\b/);
  });
});
