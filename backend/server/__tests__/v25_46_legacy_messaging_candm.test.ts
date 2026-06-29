/**
 * v25.46 BLOCKER FIX #2 (GPT-5.5 DO-NOT-SHIP) — Tier-6 supertest coverage for
 * the LEGACY /api/messages write endpoints.
 *
 * GPT-5.5 proved with supertest that the legacy direct-send routes registered by
 * the SACRED `server/messagingStore.ts` bypassed `canDM()` and returned 201 for:
 *   - POST /api/messages          with a self-recipient
 *   - POST /api/messages          with a guest/unresolved recipient
 *   - POST /api/messages/threads  with a self-participant
 *
 * The fix mounts `registerLegacyMessagingCanDmGuard(app)` BEFORE
 * `registerMessagingRoutes(app)` in `server/routes.ts`, enforcing the LOCKED
 * `server/messagingPolicy.ts` `canDM()` verdict on direct sends. These tests hit
 * the LEGACY write endpoints via the REAL `registerRoutes()` Express app (Sacred
 * Tier 6 #46 — real Express route via supertest, NO React Query mock fixtures).
 *
 * Personas (seedDemoData):
 *   - u_maya_chen   founder
 *   - u_aisha_patel investor   → founder↔investor is a LOCKED-permitted pair
 *   - u_daniel_okafor founder  → founder↔founder is a LOCKED-permitted pair
 *
 * canDM is NEVER weakened to pass these tests — the routes are aligned to canDM.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { canDM } from "../messagingPolicy";

let app: Express;
let server: http.Server;

const FOUNDER = "u_maya_chen";
const INVESTOR = "u_aisha_patel";
const FOUNDER2 = "u_daniel_okafor";
const GUEST = "guest_not_registered_2546"; // never seeded → resolveDmRole → unknown

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await seedDemoData(getDb());
  await registerRoutes(server, app);
}, 60_000);

function as(req: request.Test, userId: string): request.Test {
  return req.set("x-user-id", userId);
}

/* Pick a permitted pair that canDM() actually allows for the seeded DB, so the
 * positive test asserts a TRUE 201 (not a false pass). founder↔investor and
 * founder↔founder are both LOCKED-permitted; we use whichever canDM confirms. */
function permittedRecipientFor(sender: string): string {
  if (canDM(sender, INVESTOR).allowed && sender !== INVESTOR) return INVESTOR;
  if (canDM(sender, FOUNDER2).allowed && sender !== FOUNDER2) return FOUNDER2;
  return INVESTOR;
}

/* ───────────────── POST /api/messages (legacy direct send) ───────────────── */
describe("v25.46 Blocker — POST /api/messages enforces canDM", () => {
  it("self-recipient → 403 (was 201 before the fix)", async () => {
    const r = await as(
      request(app).post("/api/messages").send({
        recipients: [INVESTOR],
        body: "self DM attempt",
        channel_type: "direct",
      }),
      INVESTOR,
    );
    expect(r.status).toBe(403);
    expect(r.body.reason).toBe("self_dm");
  });

  it("guest / unresolved recipient → 403 (was 201 before the fix)", async () => {
    const r = await as(
      request(app).post("/api/messages").send({
        recipients: [GUEST],
        body: "guest DM attempt",
        channel_type: "direct",
      }),
      INVESTOR,
    );
    expect(r.status).toBe(403);
    expect(["unresolved", "anonymous", "not_permitted"]).toContain(r.body.reason);
  });

  it("valid permitted pair → 201 (canDM allows it; not weakened)", async () => {
    const recipient = permittedRecipientFor(FOUNDER);
    // Sanity: the pair really is allowed by the LOCKED policy.
    expect(canDM(FOUNDER, recipient).allowed).toBe(true);
    const r = await as(
      request(app).post("/api/messages").send({
        recipients: [recipient],
        subject: "Permitted DM",
        body: "hello from the permitted pair",
        channel_type: "direct",
      }),
      FOUNDER,
    );
    expect(r.status).toBe(201);
  });
});

/* ─────────────── POST /api/messages/threads (legacy thread create) ────────── */
describe("v25.46 Blocker — POST /api/messages/threads enforces canDM", () => {
  it("self-participant → 403 (was 201 before the fix)", async () => {
    const r = await as(
      request(app).post("/api/messages/threads").send({
        participants: [INVESTOR],
        initial_body: "self thread attempt",
      }),
      INVESTOR,
    );
    expect(r.status).toBe(403);
    expect(r.body.reason).toBe("self_dm");
  });

  it("guest / unresolved participant → 403 (was 201 before the fix)", async () => {
    const r = await as(
      request(app).post("/api/messages/threads").send({
        participants: [GUEST],
        initial_body: "guest thread attempt",
      }),
      INVESTOR,
    );
    expect(r.status).toBe(403);
    expect(["unresolved", "anonymous", "not_permitted"]).toContain(r.body.reason);
  });

  it("valid permitted pair → 201 (canDM allows it; not weakened)", async () => {
    const participant = permittedRecipientFor(FOUNDER);
    expect(canDM(FOUNDER, participant).allowed).toBe(true);
    const r = await as(
      request(app).post("/api/messages/threads").send({
        participants: [participant],
        title: "Permitted thread",
        initial_subject: "Hi",
        initial_body: "hello from the permitted pair",
      }),
      FOUNDER,
    );
    expect(r.status).toBe(201);
  });
});
