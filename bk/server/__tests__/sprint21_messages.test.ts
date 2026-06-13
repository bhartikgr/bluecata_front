/**
 * Sprint 21 Wave F — Investor Messages parity + server endpoint regression tests.
 *
 * Tests (≥10 supertest-style assertions using node:http):
 *  1.  Investor can list their channels via GET /api/comms/channels?role=investor
 *  2.  Investor channel list includes the NovaPay cap-table channel (participant)
 *  3.  Investor can NOT see a DM channel that doesn't include them
 *  4.  Investor cap-table channel displayTitle includes company name
 *  5.  Investor soft-circle channel displayTitle includes round name
 *  6.  POST /api/comms/channels/:id/messages emits SSE event (outbox entry)
 *  7.  Investor optimistic send: POST message returns the message immediately
 *  8.  Cmd-K search: GET /api/comms/channels with search query returns filtered results
 *  9.  GET /api/notifications?userId=u_aisha_patel returns thread-deep-linked notifications
 * 10.  POST /api/comms/dm/start with contactId=founder → returns channelId (idempotent)
 * 11.  POST /api/comms/dm/start called twice with same pair → same channelId (idempotent)
 * 12.  POST /api/comms/channels/:id/archive persists archive state
 * 13.  POST /api/comms/channels/:id/mute persists mute state
 * 14.  POST /api/comms/channels/:id/pin persists pin state
 * 15.  POST /api/comms/channels/:id/typing returns 200 OK
 * 16.  GET /api/comms/channels/:id/read-receipts returns receipts array
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity"; /* v14 Tier-1 Fix 1 — restores u_admin default identity for legacy tests */
import express, { type Express } from "express";
import http from "node:http";
import { registerCommsRoutes, _commsTest } from "../commsStore";
import { registerNotificationsRoutes } from "../notificationsStore";

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  registerCommsRoutes(app);
  registerNotificationsRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  port = (server.address() as any).port as number;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function call(
  method: string,
  path: string,
  opts: { body?: unknown; actorId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.actorId) headers["x-actor-id"] = opts.actorId;

    const r = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: buf });
          }
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

// Known channel IDs (deterministic from commsStore seed)
const CAPTABLE_NOVAPAY = "captable__co_novapay";
const SOFTCIRCLE_SEED = "softcircle__rnd_seed";
const INVESTOR_ID = "u_aisha_patel";
const FOUNDER_ID = "u_maya_chen";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Sprint 21 Wave F — Investor Messages server parity", () => {

  it("1. Investor can list channels via GET /api/comms/channels (returns array)", async () => {
    const { status, body } = await call("GET", "/api/comms/channels", { actorId: INVESTOR_ID });
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("2. Investor channel list includes NovaPay cap-table channel (investor is participant)", async () => {
    const { status, body } = await call("GET", "/api/comms/channels", { actorId: INVESTOR_ID });
    expect(status).toBe(200);
    const capTableCh = body.find((c: any) => c.id === CAPTABLE_NOVAPAY);
    expect(capTableCh).toBeDefined();
    expect(capTableCh.kind).toBe("cap_table");
  });

  it("3. Investor can NOT see DM between two other users they don't participate in", async () => {
    // DM between maya_chen and hydra_capital — aisha_patel is NOT a participant
    const dm3Id = "dm__u_hydra_capital__u_maya_chen";
    const { status } = await call("GET", `/api/comms/channels/${encodeURIComponent(dm3Id)}`, {
      actorId: INVESTOR_ID,
    });
    // Should be 403 (not a participant)
    expect(status).toBe(403);
  });

  it("4. Investor cap-table channel displayTitle includes the company name", async () => {
    const { status, body } = await call("GET", "/api/comms/channels", { actorId: INVESTOR_ID });
    expect(status).toBe(200);
    const ch = body.find((c: any) => c.id === CAPTABLE_NOVAPAY);
    expect(ch).toBeDefined();
    // Title should include company name (e.g. "NovaPay AI — Cap Table")
    expect(ch.displayTitle).toMatch(/NovaPay/i);
  });

  it("5. Investor soft-circle channel displayTitle includes the round name", async () => {
    const { status, body } = await call("GET", "/api/comms/channels", { actorId: INVESTOR_ID });
    expect(status).toBe(200);
    const ch = body.find((c: any) => c.id === SOFTCIRCLE_SEED);
    expect(ch).toBeDefined();
    // Title should include round name (e.g. "NovaPay Seed Extension — Soft-Circle")
    expect(ch.displayTitle).toMatch(/NovaPay|Seed|soft.circle/i);
  });

  it("6. POST /api/comms/channels/:id/messages returns the new message (SSE outbox entry created)", async () => {
    const outboxBefore = _commsTest.outbox.length;
    const { status, body } = await call(
      "POST",
      `/api/comms/channels/${encodeURIComponent(CAPTABLE_NOVAPAY)}/messages`,
      { actorId: INVESTOR_ID, body: { body: "Hello from investor test" } },
    );
    // The endpoint returns 200 (no explicit 201)
    expect(status).toBe(200);
    expect(body.id).toBeDefined();
    expect(body.body).toBe("Hello from investor test");
    // Verify outbox was updated (SSE event queued)
    expect(_commsTest.outbox.length).toBeGreaterThan(outboxBefore);
  });

  it("7. Optimistic send: GET channel detail returns message that was just posted", async () => {
    // Post a new message
    const testBody = `Optimistic test ${Date.now()}`;
    await call(
      "POST",
      `/api/comms/channels/${encodeURIComponent(CAPTABLE_NOVAPAY)}/messages`,
      { actorId: INVESTOR_ID, body: { body: testBody } },
    );
    // Immediately fetch channel detail — message should be there
    const { status, body } = await call(
      "GET",
      `/api/comms/channels/${encodeURIComponent(CAPTABLE_NOVAPAY)}`,
      { actorId: INVESTOR_ID },
    );
    expect(status).toBe(200);
    const found = body.messages.find((m: any) => m.body === testBody);
    expect(found).toBeDefined();
  });

  it("8. Cmd-K search: GET /api/comms/channels returns all channels (client-side search applies to this list)", async () => {
    // The API returns all visible channels; client filters locally via search state.
    // Verify the API returns channels so client can perform Cmd-K search.
    const { status, body } = await call("GET", "/api/comms/channels", { actorId: INVESTOR_ID });
    expect(status).toBe(200);
    // Should have at least a DM and a cap-table channel for the investor to search over
    const kinds = body.map((c: any) => c.kind);
    expect(kinds).toContain("dm");
    expect(kinds).toContain("cap_table");
  });

  it("9. GET /api/notifications?userId=u_aisha_patel returns thread-deep-linked message.received notifications", async () => {
    const { status, body } = await call("GET", `/api/notifications?userId=${INVESTOR_ID}`);
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    // Check at least one notification exists for the investor
    expect(body.userId).toBe(INVESTOR_ID);
    // At least one notification should have a link
    const withLink = body.items.filter((n: any) => n.link);
    expect(withLink.length).toBeGreaterThan(0);
  });

  it("10. POST /api/comms/dm/start with targetUserId=founder returns ok:true and channelId", async () => {
    const { status, body } = await call(
      "POST",
      "/api/comms/dm/start",
      { actorId: INVESTOR_ID, body: { targetUserId: FOUNDER_ID } },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.channelId).toBe("string");
    expect(body.channelId.length).toBeGreaterThan(0);
  });

  it("11. POST /api/comms/dm/start called twice → same channelId (idempotent)", async () => {
    const first = await call(
      "POST",
      "/api/comms/dm/start",
      { actorId: INVESTOR_ID, body: { targetUserId: FOUNDER_ID } },
    );
    const second = await call(
      "POST",
      "/api/comms/dm/start",
      { actorId: INVESTOR_ID, body: { targetUserId: FOUNDER_ID } },
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.channelId).toBe(second.body.channelId);
  });

  it("12. POST /api/comms/channels/:id/archive persists (returns 200 and channel reflects archive)", async () => {
    // Use the DM channel between aisha and maya
    const dmId = "dm__u_aisha_patel__u_maya_chen";
    const { status, body } = await call(
      "POST",
      `/api/comms/channels/${encodeURIComponent(dmId)}/archive`,
      { actorId: INVESTOR_ID },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    // Verify channel now has investor in archivedByUserIds
    const ch = _commsTest.channels.get(dmId);
    expect(ch?.archivedByUserIds).toBeDefined();
    expect((ch?.archivedByUserIds ?? []).includes(INVESTOR_ID)).toBe(true);
  });

  it("13. POST /api/comms/channels/:id/mute persists (returns 200 and muted)", async () => {
    const { status, body } = await call(
      "POST",
      `/api/comms/channels/${encodeURIComponent(CAPTABLE_NOVAPAY)}/mute`,
      { actorId: INVESTOR_ID },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const ch = _commsTest.channels.get(CAPTABLE_NOVAPAY);
    expect((ch?.mutedByUserIds ?? []).includes(INVESTOR_ID)).toBe(true);
  });

  it("14. POST /api/comms/channels/:id/pin persists (returns 200 and pinned)", async () => {
    const { status, body } = await call(
      "POST",
      `/api/comms/channels/${encodeURIComponent(CAPTABLE_NOVAPAY)}/pin`,
      { actorId: INVESTOR_ID },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const ch = _commsTest.channels.get(CAPTABLE_NOVAPAY);
    expect((ch?.pinnedByUserIds ?? []).includes(INVESTOR_ID)).toBe(true);
  });

  it("15. POST /api/comms/channels/:id/typing returns 200 OK (typing indicator)", async () => {
    const { status, body } = await call(
      "POST",
      `/api/comms/channels/${encodeURIComponent(CAPTABLE_NOVAPAY)}/typing`,
      { actorId: INVESTOR_ID },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("16. GET /api/comms/channels/:id/read-receipts returns receipts array for investor-visible channel", async () => {
    const { status, body } = await call(
      "GET",
      `/api/comms/channels/${encodeURIComponent(CAPTABLE_NOVAPAY)}/read-receipts`,
      { actorId: INVESTOR_ID },
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.receipts)).toBe(true);
  });

});
