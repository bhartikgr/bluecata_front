/**
 * WAVE 57c · ITEM 6 (R37 approved order #6) — `POST /api/admin/sync/reset-demo`
 * is now dry-run by default, identity-fail-closed, and audited.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * The handler called `resetDemoState()` immediately: `_testBridge.resetChain()`
 * resets the bridge HMAC head `lastChainHash` to 64 zeros and truncates the
 * in-memory outbox/inbox while the durable `bridge_event_history` keeps the OLD
 * hashes — so chain continuity is destroyed irreversibly. There was no audit
 * entry, no confirmation, and no dry-run. Its own doc comment claimed it was
 * "admin-SES gated", which was FALSE: it carries `requireAdmin` only.
 *
 * ── WHAT IS ASSERTED, THROUGH HTTP ─────────────────────────────────────────
 *   LOWER POLE — a plain POST (no `apply`) changes NOTHING: the chain head is
 *                byte-identical afterwards, and the response says `dryRun: true`
 *                and names the head it WOULD discard.
 *   UPPER POLE — `?apply=1` really does reset the chain head to 64 zeros (the
 *                operation is NOT disabled) and writes an audit_log row with a
 *                bound actor recording the head that was discarded.
 *   HONESTY    — neither this handler nor `scripts/reset-demo.ts` still claims
 *                "admin-SES gated" anywhere in the source.
 *   R26        — the handler does not touch `audit_chain_genesis`, so the
 *                audit-chain re-seed sequencing under R26 is undisturbed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { _testBridge, emitBridgeEvent } from "../bridgeStore";

const ADMIN = "u_admin";
const ZEROS = "0".repeat(64);

let app: Express;
let server: http.Server;

beforeAll(async () => {
  await seedDemoData(getDb());
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

/** Advance the bridge chain head off the zero value so "unchanged" is provable. */
function advanceChain(): string {
  emitBridgeEvent({
    eventType: "company.profile.updated",
    aggregateId: "co_novapay",
    aggregateKind: "company",
    payload: { changedFields: ["legalName"], visibleToCollective: true },
  });
  return _testBridge.lastChainHash();
}

describe("W57c item 6 — /api/admin/sync/reset-demo dry-run + audit (over HTTP)", () => {
  it("LOWER POLE: a plain POST is a DRY RUN — the chain head is unchanged and the response names what it would discard", async () => {
    const head = advanceChain();
    expect(head).not.toBe(ZEROS);

    const r = await request(app)
      .post("/api/admin/sync/reset-demo")
      .set("x-user-id", ADMIN)
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.applied).toBe(false);
    expect(r.body.wouldDo.chainHeadBefore).toBe(head);
    expect(r.body.wouldDo.resetChainHeadTo).toBe(ZEROS);

    // THE ASSERTION THAT MATTERS: nothing changed.
    expect(_testBridge.lastChainHash()).toBe(head);
  });

  it("UPPER POLE: ?apply=1 really resets the chain head and writes a bound-actor audit row", async () => {
    const head = advanceChain();
    expect(head).not.toBe(ZEROS);

    const r = await request(app)
      .post("/api/admin/sync/reset-demo?apply=1")
      .set("x-user-id", ADMIN)
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(true);
    expect(r.body.dryRun).toBe(false);
    expect(r.body.chainHeadBefore).toBe(head);

    const rows = rawDb()
      .prepare(
        `SELECT actor_id AS actorId, payload_json AS payloadJson FROM audit_log
           WHERE action = 'bridge.demo_state.reset'
           ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .all() as Array<{ actorId: string | null; payloadJson: string | null }>;
    expect(rows.length).toBe(1);
    expect(rows[0].actorId).toBe(ADMIN);
    const payload = JSON.parse(rows[0].payloadJson ?? "{}");
    expect(payload.chainHeadBefore).toBe(head);
    expect(payload.chainContinuityBroken).toBe(true);
  });

  it("HONESTY: no source file still claims this endpoint is 'admin-SES gated'", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    for (const rel of ["server/bridgeStore.ts", "scripts/reset-demo.ts"]) {
      const src = fs.readFileSync(path.join(root, rel), "utf8");
      /* The correction note may mention the old phrase while explaining that it
         was false; what must not survive is a line ASSERTING the gate. */
      const asserts = src
        .split("\n")
        .filter((l) => /admin-SES[- ]?gated/i.test(l))
        .filter((l) => !/FALSE|was false|used to|previous|no longer|claiming/i.test(l));
      expect(asserts).toEqual([]);
    }
  });

  it("R26: the handler does not touch audit_chain_genesis, so the audit-chain re-seed sequence is undisturbed", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    const src = fs.readFileSync(path.join(root, "server/bridgeStore.ts"), "utf8");
    const start = src.indexOf('app.post("/api/admin/sync/reset-demo"');
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('app.get("/api/admin/bridge/history"', start);
    expect(end).toBeGreaterThan(start);
    const handler = src.slice(start, end);
    expect(handler).not.toMatch(/audit_chain_genesis/);
    expect(handler).not.toMatch(/COLLECTIVE_WEBHOOK/);
  });
});
