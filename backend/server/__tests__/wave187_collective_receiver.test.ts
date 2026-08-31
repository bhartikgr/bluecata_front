/**
 * WAVE 187 — the REAL Collective receiver.
 *
 * R159.2 is the owner's decision, verbatim: *"Option A. Fix it now as all of the
 * data on the platform is test."* Option A means a real receiver, not an
 * in-process alias. These tests are the proof that never existed: before this
 * wave the outbound path only ever reached `/api/_mock_collective/inbound`, a
 * test double that remembered idempotency in a RAM `Set` and recorded no outcome.
 *
 * WHAT EACH BLOCK PROVES
 *   A. HMAC       — a valid signature is accepted; a bad one is 401 and writes nothing.
 *   B. Idempotency— a replayed event applies EXACTLY ONCE. 743 events will be
 *                   delivered at go-live and every retry must be safe.
 *   C. Unknown    — an event with no destination is accepted-and-ignored with a
 *                   recorded reason. Never silently discarded.
 *   D. Malformed  — rejected with a stated fact, and the machine code never
 *                   reaches the human `message` field.
 *   E. Round trip — emit through the REAL outbound sender (bridgeRuntime
 *                   deliverOnce, LIVE_MODE) into the REAL receiver over real
 *                   HTTP, and assert Collective state changed AND the delivery
 *                   was recorded on both sides.
 *   F. Queue      — one bad event does not block the queue, and is not silently
 *                   skipped either.
 *   G. Fences     — no event writes `status`, `chapter` or `partner_team_members`,
 *                   so nothing can widen visibility (wave 167/185).
 *   H. Money      — the receiver source contains no Number()/parseInt/parseFloat.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hmacSign, verifyHmac, emitBridgeEvent, getOutbox, _testBridge } from "../bridgeStore";
import type { BridgeEnvelope } from "../bridgeStore";
import {
  registerCollectiveBridgeReceiverRoutes,
  receiveEnvelope,
  lookupReceived,
  assertEnvelope,
  MalformedEnvelopeError,
  COLLECTIVE_RECEIVER_PATH,
  _resetReceiverLatch,
} from "../lib/collectiveBridgeReceiver";
import { rawDb } from "../db/connection";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECEIVER_SRC = path.resolve(HERE, "../lib/collectiveBridgeReceiver.ts");

/* ---------------------------------------------------------------- harness */

function makeApp() {
  const app = express();
  app.use(express.json());
  registerCollectiveBridgeReceiverRoutes(app);
  return app;
}

interface Res {
  status: number;
  body: any;
}

/** Real HTTP, real headers. Nothing here calls the handler directly. */
async function post(app: express.Express, p: string, body: unknown, headers: Record<string, string>): Promise<Res> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = JSON.stringify(body);
      const r = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: p,
          method: "POST",
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers },
        },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            server.close();
            try {
              resolve({ status: res.statusCode || 0, body: buf ? JSON.parse(buf) : null });
            } catch {
              resolve({ status: res.statusCode || 0, body: buf });
            }
          });
        },
      );
      r.on("error", (e) => {
        server.close();
        reject(e);
      });
      r.write(data);
      r.end();
    });
  });
}

let seq = 0;
function envelope(over: Partial<BridgeEnvelope> = {}): BridgeEnvelope {
  seq += 1;
  return {
    eventId: `evt_w187_${Date.now().toString(36)}_${seq}`,
    eventType: "company.profile.updated",
    aggregateId: "cmp_w187",
    aggregateKind: "company",
    occurredAt: new Date().toISOString(),
    tenantId: "tnt_capavate_us",
    actor: { userId: "u_admin", ip: "127.0.0.1" },
    payload: {},
    trace: [],
    auditChain: { priorHash: "0".repeat(64), hash: "0".repeat(64) },
    schemaVersion: 1,
    ...over,
  } as BridgeEnvelope;
}

/** Sign the way bridgeRuntime signs: HMAC-SHA256-hex over JSON.stringify(envelope). */
function signed(env: BridgeEnvelope, secret?: string): Record<string, string> {
  const body = JSON.stringify(env);
  return {
    "x-bridge-signature": secret ? hmacSign(body, secret) : hmacSign(body),
    "idempotency-key": env.eventId,
  };
}

function ensureListing(companyId: string, stage: string, sector: string, status = "listed", chapter = "toronto") {
  const db = rawDb();
  db.exec(`CREATE TABLE IF NOT EXISTS collective_directory_listings (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL UNIQUE, application_id TEXT,
    chapter TEXT, stage TEXT, sector TEXT, listed_at TEXT, status TEXT)`);
  db.prepare(`DELETE FROM collective_directory_listings WHERE company_id = ?`).run(companyId);
  db.prepare(
    `INSERT INTO collective_directory_listings (id, company_id, application_id, chapter, stage, sector, listed_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(`cdl_${companyId}`, companyId, `app_${companyId}`, chapter, stage, sector, new Date().toISOString(), status);
}

function readListing(companyId: string): any {
  return rawDb()
    .prepare(`SELECT company_id, chapter, stage, sector, status, application_id FROM collective_directory_listings WHERE company_id = ?`)
    .get(companyId);
}

beforeEach(() => {
  _resetReceiverLatch();
});

/* ============================================================ A. HMAC */

describe("W187 A — HMAC verification", () => {
  it("accepts an envelope signed with the configured secret", async () => {
    const app = makeApp();
    const env = envelope({ eventType: "spv.created", aggregateId: "spv_a1" });
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, signed(env));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(["applied", "ignored"]).toContain(res.body.outcome);
  });

  it("rejects a bad signature with 401 and writes NOTHING", async () => {
    const app = makeApp();
    const env = envelope({ eventType: "spv.created", aggregateId: "spv_a2" });
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, {
      "x-bridge-signature": "deadbeef".repeat(8),
      "idempotency-key": env.eventId,
    });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    /* No ledger row: an unverified event leaves no trace of having been accepted. */
    expect(lookupReceived(env.eventId)).toBeNull();
  });

  it("rejects an absent signature with 401", async () => {
    const app = makeApp();
    const env = envelope({ eventType: "spv.created", aggregateId: "spv_a3" });
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, {});
    expect(res.status).toBe(401);
    expect(lookupReceived(env.eventId)).toBeNull();
  });

  it("the signature is verified over the exact bytes bridgeRuntime signs", () => {
    const env = envelope();
    const body = JSON.stringify(env);
    expect(verifyHmac(body, hmacSign(body))).toBe(true);
    /* One byte different anywhere and it fails. */
    expect(verifyHmac(body + " ", hmacSign(body))).toBe(false);
  });

  it("refuses an idempotency-key header that disagrees with the envelope eventId", async () => {
    const app = makeApp();
    const env = envelope({ eventType: "spv.created", aggregateId: "spv_a4" });
    const h = signed(env);
    h["idempotency-key"] = "evt_someone_elses_id";
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, h);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("idempotency_key_mismatch");
    expect(lookupReceived(env.eventId)).toBeNull();
  });
});

/* ============================================================ B. Idempotency */

describe("W187 B — idempotency: a replay applies EXACTLY once", () => {
  it("replaying an applied event does not apply it twice", async () => {
    const app = makeApp();
    const companyId = "cmp_w187_idem";
    ensureListing(companyId, "seed", "fintech");
    const env = envelope({ aggregateId: companyId, payload: { stage: "series_a", sector: "healthtech" } });

    const first = await post(app, COLLECTIVE_RECEIVER_PATH, env, signed(env));
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("applied");
    expect(first.body.idempotent).toBe(false);
    expect(readListing(companyId).stage).toBe("series_a");

    /* Someone edits the row between deliveries — a real retry window. */
    rawDb().prepare(`UPDATE collective_directory_listings SET stage = ? WHERE company_id = ?`).run("edited_by_human", companyId);

    const second = await post(app, COLLECTIVE_RECEIVER_PATH, env, signed(env));
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.outcome).toBe("applied");
    /* THE PROOF: the replay did NOT re-apply, so the human edit survives. */
    expect(readListing(companyId).stage).toBe("edited_by_human");
  });

  it("five concurrent-style replays yield exactly one ledger row and one apply", async () => {
    const app = makeApp();
    const companyId = "cmp_w187_idem5";
    ensureListing(companyId, "seed", "fintech");
    const env = envelope({ aggregateId: companyId, payload: { stage: "series_b" } });
    const h = signed(env);
    for (let i = 0; i < 5; i += 1) {
      const r = await post(app, COLLECTIVE_RECEIVER_PATH, env, h);
      expect(r.status).toBe(200);
      expect(r.body.outcome).toBe("applied");
      expect(r.body.idempotent).toBe(i > 0);
    }
    const rows = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM collective_bridge_inbound WHERE id = ?`)
      .get(env.eventId) as { n: number };
    expect(rows.n).toBe(1);
  });

  it("idempotency is a DATABASE constraint, so it survives a process restart", () => {
    /* The mock's idempotency was `const seenIds = new Set<string>()` — a PM2
       restart erases it and every redelivery re-applies. This asserts the real
       receiver's memory is a primary key on disk, not module state. */
    const companyId = "cmp_w187_restart";
    ensureListing(companyId, "seed", "fintech");
    const env = envelope({ aggregateId: companyId, payload: { stage: "growth" } });
    const first = receiveEnvelope(env);
    expect(first.outcome).toBe("applied");
    /* Simulate the restart: every module-level latch is cleared. */
    _resetReceiverLatch();
    const second = receiveEnvelope(env);
    expect(second.idempotent).toBe(true);
    const pk = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM collective_bridge_inbound WHERE id = ?`)
      .get(env.eventId) as { n: number };
    expect(pk.n).toBe(1);
  });

  it("a stale (older) event is not replayed over a newer applied one", async () => {
    const app = makeApp();
    const companyId = "cmp_w187_order";
    ensureListing(companyId, "seed", "fintech");
    const newer = envelope({ aggregateId: companyId, occurredAt: "2026-08-20T00:00:00.000Z", payload: { stage: "series_c" } });
    const older = envelope({ aggregateId: companyId, occurredAt: "2026-08-01T00:00:00.000Z", payload: { stage: "pre_seed" } });
    const a = await post(app, COLLECTIVE_RECEIVER_PATH, newer, signed(newer));
    expect(a.body.outcome).toBe("applied");
    const b = await post(app, COLLECTIVE_RECEIVER_PATH, older, signed(older));
    expect(b.status).toBe(200);
    expect(b.body.outcome).toBe("ignored");
    expect(b.body.reason).toMatch(/newer event/i);
    expect(readListing(companyId).stage).toBe("series_c");
  });
});

/* ============================================================ C. No destination */

describe("W187 C — events with no destination are accepted-and-ignored WITH A REASON", () => {
  /* These five are the types ACTUALLY in bridge_outbox in this tree
     (705 rows locally, 743 on live), not a guessed set. */
  const QUEUED_TYPES = [
    "subscription.auto_created_on_company_create",
    "captable.waterfall.computed",
    "spv.created",
    "partner.team_member_added",
    "payment_charged",
  ];

  for (const t of QUEUED_TYPES) {
    it(`${t} is recorded as ignored with a stated reason`, async () => {
      const app = makeApp();
      const env = envelope({ eventType: t as any, aggregateId: `agg_${t}` });
      const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, signed(env));
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe("ignored");
      expect(res.body.handler).toBeNull();
      /* A reason in words, not a code. */
      expect(typeof res.body.reason).toBe("string");
      expect(res.body.reason.length).toBeGreaterThan(30);
      expect(res.body.reason).not.toMatch(/^[A-Z0-9_]+$/);
      /* And it is DURABLE — recorded, not discarded. */
      const row = lookupReceived(env.eventId);
      expect(row).not.toBeNull();
      expect(row!.outcome).toBe("ignored");
      expect(row!.reason).toBe(res.body.reason);
    });
  }

  it("captable.waterfall.computed — 46% of the real backlog — is handled even though it is absent from ALL_OUTBOUND_EVENT_TYPES", async () => {
    /* The registry is keyed off the receiver's own destinations, NOT off the
       outbound union. This event is emitted through a local wrapper at
       server/track1Routes.ts:3106 that casts past the union, so a
       union-keyed registry would have mishandled 325 of 705 queued rows. */
    const app = makeApp();
    const env = envelope({
      eventType: "captable.waterfall.computed" as any,
      aggregateId: "cmp_wf",
      payload: { companyId: "cmp_wf", exitMinor: "5600000000", lpProceeds: "3257142857.142857" },
    });
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, signed(env));
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("ignored");
    expect(res.body.reason).toMatch(/money/i);
    /* The payload is preserved verbatim, as STRINGS. No coercion happened. */
    const stored = rawDb()
      .prepare(`SELECT envelope_json FROM collective_bridge_inbound WHERE id = ?`)
      .get(env.eventId) as { envelope_json: string };
    const parsed = JSON.parse(stored.envelope_json);
    expect(parsed.payload.exitMinor).toBe("5600000000");
    expect(typeof parsed.payload.lpProceeds).toBe("string");
  });

  it("a wholly unknown event type is accepted-and-ignored with the unknown-type reason", async () => {
    const app = makeApp();
    const env = envelope({ eventType: "something.nobody.defined" as any, aggregateId: "agg_unknown" });
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, signed(env));
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("ignored");
    expect(res.body.reason).toMatch(/no Collective destination is defined/i);
    expect(lookupReceived(env.eventId)!.reason).toBe(res.body.reason);
  });

  it("a company with no directory listing is ignored — a bridge event never creates a listing", async () => {
    const app = makeApp();
    const companyId = "cmp_w187_unlisted";
    rawDb().prepare(`DELETE FROM collective_directory_listings WHERE company_id = ?`).run(companyId);
    const env = envelope({ aggregateId: companyId, payload: { stage: "series_a", sector: "climate" } });
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, signed(env));
    expect(res.body.outcome).toBe("ignored");
    expect(res.body.reason).toMatch(/no Collective directory listing/i);
    expect(readListing(companyId)).toBeUndefined();
  });
});

/* ============================================================ D. Malformed */

describe("W187 D — malformed payloads are refused with a stated fact", () => {
  const CASES: { name: string; body: unknown; code: string }[] = [
    { name: "not an object", body: ["nope"], code: "not_an_object" },
    { name: "missing eventId", body: { eventType: "spv.created", occurredAt: new Date().toISOString(), aggregateId: "a" }, code: "missing_event_id" },
    { name: "missing eventType", body: { eventId: "evt_x1", occurredAt: new Date().toISOString(), aggregateId: "a" }, code: "missing_event_type" },
    { name: "unreadable occurredAt", body: { eventId: "evt_x2", eventType: "spv.created", occurredAt: "not-a-date", aggregateId: "a" }, code: "bad_occurred_at" },
    { name: "missing aggregateId", body: { eventId: "evt_x3", eventType: "spv.created", occurredAt: new Date().toISOString() }, code: "missing_aggregate_id" },
  ];

  for (const c of CASES) {
    it(`${c.name} → 400, machine code in \`code\`, human sentence in \`message\``, async () => {
      const app = makeApp();
      const body = JSON.stringify(c.body);
      const res = await post(app, COLLECTIVE_RECEIVER_PATH, c.body, { "x-bridge-signature": hmacSign(body) });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(c.code);
      /* The screen text is a sentence, never an ALL-CAPS code. */
      expect(res.body.message).toMatch(/^[a-z]/);
      expect(res.body.message).toMatch(/\.$/);
      expect(res.body.message).not.toMatch(/[A-Z]{4,}_[A-Z]{2,}/);
    });
  }

  it("assertEnvelope throws MalformedEnvelopeError carrying both code and sentence", () => {
    try {
      assertEnvelope({ eventType: "spv.created" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedEnvelopeError);
      expect((err as MalformedEnvelopeError).code).toBe("missing_event_id");
      expect((err as MalformedEnvelopeError).message).toMatch(/eventId is missing/);
    }
  });
});

/* ============================================================ E. Round trip */

describe("W187 E — FULL ROUND TRIP through the real outbound sender", () => {
  /* THIS IS THE PROOF THAT NEVER EXISTED. Before wave 187 the outbound path only
     ever reached the in-process mock. Here the real bridgeRuntime.deliverOnce
     signs with COLLECTIVE_WEBHOOK_SECRET and POSTs over real HTTP to the real
     receiver, and we assert Collective state changed AND both sides recorded it.

     LIVE_MODE is computed at bridgeRuntime MODULE LOAD, so the env vars are set
     BEFORE the dynamic import. Nothing here is written to any shipped config. */
  const SECRET = "w187-round-trip-secret";
  let server: http.Server;
  let baseUrl = "";
  const savedUrl = process.env.COLLECTIVE_WEBHOOK_URL;
  const savedSecret = process.env.COLLECTIVE_WEBHOOK_SECRET;

  beforeAll(async () => {
    const app = makeApp();
    await new Promise<void>((resolve) => {
      server = http.createServer(app).listen(0, () => resolve());
    });
    const port = (server.address() as any).port;
    baseUrl = `http://127.0.0.1:${port}${COLLECTIVE_RECEIVER_PATH}`;
    process.env.COLLECTIVE_WEBHOOK_URL = baseUrl;
    process.env.COLLECTIVE_WEBHOOK_SECRET = SECRET;
  });

  afterAll(() => {
    if (savedUrl === undefined) delete process.env.COLLECTIVE_WEBHOOK_URL;
    else process.env.COLLECTIVE_WEBHOOK_URL = savedUrl;
    if (savedSecret === undefined) delete process.env.COLLECTIVE_WEBHOOK_SECRET;
    else process.env.COLLECTIVE_WEBHOOK_SECRET = savedSecret;
    server?.close();
  });

  it("emit → real deliverOnce → real receiver → Collective state changed and delivery recorded", async () => {
    const { deliverOnce, bridgeHealth } = (await import("../lib/bridgeRuntime")) as any;
    /* Confirm we are on the LIVE path, not the mock fallback. Asserted
       UNCONDITIONALLY and by the real export name (`bridgeHealth`, not a guessed
       one) — a guarded assertion that silently skips would let this whole test
       pass while proving nothing, which is the exact failure mode wave 187
       exists to fix. LIVE_MODE is computed at bridgeRuntime module load, so the
       env vars were set in beforeAll, before this dynamic import. */
    expect(bridgeHealth().mode).toBe("live");

    const companyId = "cmp_w187_roundtrip";
    ensureListing(companyId, "seed", "fintech");
    _testBridge.resetChain();

    const entry = emitBridgeEvent({
      eventType: "company.profile.updated" as any,
      aggregateId: companyId,
      aggregateKind: "company",
      payload: { stage: "series_a", sector: "climate" },
    });
    expect(entry.envelope.eventId).toBeTruthy();

    const result = await deliverOnce();
    expect(result.delivered).toBeGreaterThan(0);

    /* 1. Collective state actually changed. */
    const listing = readListing(companyId);
    expect(listing.stage).toBe("series_a");
    expect(listing.sector).toBe("climate");

    /* 2. The RECEIVER recorded the outcome per event. */
    const received = lookupReceived(entry.envelope.eventId);
    expect(received).not.toBeNull();
    expect(received!.outcome).toBe("applied");
    expect(received!.handler).toBe("directory_listing.classification");

    /* 3. The SENDER recorded the delivery. */
    const sent = getOutbox().find((e) => e.envelope.eventId === entry.envelope.eventId);
    expect(sent?.deliveredAt).toBeTruthy();
    expect(sent?.status).toBe("delivered");

    /* 4. The fence held: visibility columns untouched. */
    expect(listing.status).toBe("listed");
    expect(listing.chapter).toBe("toronto");
  });

  it("re-delivering the same event over the wire applies once", async () => {
    const { deliverOnce } = (await import("../lib/bridgeRuntime")) as any;
    const companyId = "cmp_w187_roundtrip2";
    ensureListing(companyId, "seed", "fintech");
    _testBridge.resetChain();
    const entry = emitBridgeEvent({
      eventType: "company.profile.updated" as any,
      aggregateId: companyId,
      aggregateKind: "company",
      payload: { stage: "series_b" },
    });
    await deliverOnce();
    expect(readListing(companyId).stage).toBe("series_b");

    rawDb().prepare(`UPDATE collective_directory_listings SET stage = ? WHERE company_id = ?`).run("human_edit", companyId);
    /* Force the sender to try again with the identical envelope. */
    const again = await post(makeApp(), COLLECTIVE_RECEIVER_PATH, entry.envelope, {
      "x-bridge-signature": hmacSign(JSON.stringify(entry.envelope), SECRET),
      "idempotency-key": entry.envelope.eventId,
    });
    expect(again.status).toBe(200);
    expect(again.body.idempotent).toBe(true);
    expect(readListing(companyId).stage).toBe("human_edit");
  });
});

/* ============================================================ F. Queue */

describe("W187 F — one bad event cannot block the queue, and is not skipped silently", () => {
  it("a rejected event is recorded with a reason and stays retryable", () => {
    /* Force a handler failure by making the target table unreadable mid-apply:
       an aggregateId that exists but a table that has been renamed away. */
    const db = rawDb();
    const companyId = "cmp_w187_boom";
    ensureListing(companyId, "seed", "fintech");
    db.exec(`ALTER TABLE collective_directory_listings RENAME TO collective_directory_listings_w187_tmp`);
    let res;
    try {
      res = receiveEnvelope(envelope({ aggregateId: companyId, payload: { stage: "series_a" } }));
    } finally {
      db.exec(`ALTER TABLE collective_directory_listings_w187_tmp RENAME TO collective_directory_listings`);
    }
    expect(res!.outcome).toBe("rejected");
    /* Recorded, in words, not swallowed. */
    expect(res!.reason).toMatch(/^rejected: applying this event failed and nothing was written\./);
  });

  it("a rejected event does NOT short-circuit its own retry", () => {
    const db = rawDb();
    const companyId = "cmp_w187_retry";
    ensureListing(companyId, "seed", "fintech");
    const env = envelope({ aggregateId: companyId, payload: { stage: "series_a" } });
    db.exec(`ALTER TABLE collective_directory_listings RENAME TO collective_directory_listings_w187_tmp2`);
    let first;
    try {
      first = receiveEnvelope(env);
    } finally {
      db.exec(`ALTER TABLE collective_directory_listings_w187_tmp2 RENAME TO collective_directory_listings`);
    }
    expect(first!.outcome).toBe("rejected");
    /* THE POINT: a transient failure must not be frozen into a permanent skip. */
    const second = receiveEnvelope(env);
    expect(second.outcome).toBe("applied");
    expect(second.idempotent).toBe(false);
    expect(readListing(companyId).stage).toBe("series_a");
  });

  it("a bad event between two good ones does not stop the good ones", async () => {
    const app = makeApp();
    ensureListing("cmp_w187_q1", "seed", "fintech");
    ensureListing("cmp_w187_q2", "seed", "fintech");
    const good1 = envelope({ aggregateId: "cmp_w187_q1", payload: { stage: "series_a" } });
    const bad = { eventId: "evt_w187_bad", eventType: "company.profile.updated" };
    const good2 = envelope({ aggregateId: "cmp_w187_q2", payload: { stage: "series_a" } });

    const r1 = await post(app, COLLECTIVE_RECEIVER_PATH, good1, signed(good1));
    const rb = await post(app, COLLECTIVE_RECEIVER_PATH, bad, { "x-bridge-signature": hmacSign(JSON.stringify(bad)) });
    const r2 = await post(app, COLLECTIVE_RECEIVER_PATH, good2, signed(good2));

    expect(r1.body.outcome).toBe("applied");
    expect(rb.status).toBe(400);
    expect(r2.body.outcome).toBe("applied");
    expect(readListing("cmp_w187_q1").stage).toBe("series_a");
    expect(readListing("cmp_w187_q2").stage).toBe("series_a");
  });
});

/* ============================================================ G. Fences */

describe("W187 G — no event can widen visibility", () => {
  it("applying company.profile.updated does not touch status, chapter or application_id", async () => {
    const app = makeApp();
    const companyId = "cmp_w187_fence";
    ensureListing(companyId, "seed", "fintech", "pending", "vancouver");
    const before = readListing(companyId);
    const env = envelope({
      aggregateId: companyId,
      /* An attacker-shaped payload that TRIES to list the company. */
      payload: { stage: "series_a", sector: "climate", status: "listed", chapter: "toronto", application_id: "app_evil" },
    });
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, signed(env));
    expect(res.body.outcome).toBe("applied");
    const after = readListing(companyId);
    expect(after.stage).toBe("series_a");
    expect(after.sector).toBe("climate");
    /* THE FENCE. Every visibility-bearing column is byte-identical. */
    expect(after.status).toBe(before.status);
    expect(after.status).toBe("pending");
    expect(after.chapter).toBe(before.chapter);
    expect(after.chapter).toBe("vancouver");
    expect(after.application_id).toBe(before.application_id);
  });

  it("the receiver source never writes status, chapter or partner_team_members", () => {
    const src = stripComments(fs.readFileSync(RECEIVER_SRC, "utf8"));
    /* The reachability binding behind R148.1 and the wave 167/185 fences. */
    expect(src).not.toMatch(/partner_team_members/);
    expect(src).not.toMatch(/collective_memberships/);
    /* No write to the two visibility columns anywhere in the file. */
    expect(src).not.toMatch(/SET[^;]*\bstatus\s*=/i);
    expect(src).not.toMatch(/SET[^;]*\bchapter\s*=/i);
    /* And it never inserts a directory listing. */
    expect(src).not.toMatch(/INSERT\s+INTO\s+collective_directory_listings/i);
  });

  it("partner.team_member_added is refused by the fence, with that stated", async () => {
    const app = makeApp();
    const env = envelope({
      eventType: "partner.team_member_added" as any,
      aggregateId: "ptr_w187",
      payload: { partnerId: "ptr_w187", userId: "usr_new", subRole: "analyst" },
    });
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, signed(env));
    expect(res.body.outcome).toBe("ignored");
    expect(res.body.reason).toMatch(/refused by fence/i);
    expect(res.body.reason).toMatch(/reach/i);
  });
});

/* ============================================================ J. Adversarial */

describe("W187 J — adversarial", () => {
  it("a signature valid for a DIFFERENT envelope does not authorise this one", async () => {
    const app = makeApp();
    const companyId = "cmp_w187_adv_tamper";
    ensureListing(companyId, "seed", "fintech");
    const original = envelope({ aggregateId: companyId, payload: { stage: "seed" } });
    const tampered = { ...original, payload: { stage: "series_a", sector: "defence" } };
    /* Sign the ORIGINAL, send the TAMPERED. */
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, tampered, {
      "x-bridge-signature": hmacSign(JSON.stringify(original)),
      "idempotency-key": original.eventId,
    });
    expect(res.status).toBe(401);
    expect(readListing(companyId).stage).toBe("seed");
  });

  it("a SQL-shaped aggregateId is bound as a parameter, not concatenated", async () => {
    const app = makeApp();
    const evil = `x'; DROP TABLE collective_directory_listings; --`;
    const env = envelope({ aggregateId: evil, payload: { stage: "series_a" } });
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, signed(env));
    expect(res.status).toBe(200);
    /* No listing for that id, so ignored — and the table still exists. */
    expect(res.body.outcome).toBe("ignored");
    const still = rawDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='collective_directory_listings'`)
      .get();
    expect(still).toBeTruthy();
    /* The evil string was stored verbatim as data, proving it was bound. */
    const row = rawDb()
      .prepare(`SELECT aggregate_id FROM collective_bridge_inbound WHERE id = ?`)
      .get(env.eventId) as { aggregate_id: string };
    expect(row.aggregate_id).toBe(evil);
  });

  it("an envelope whose payload is not an object is ignored, not crashed on", async () => {
    const app = makeApp();
    const companyId = "cmp_w187_adv_payload";
    ensureListing(companyId, "seed", "fintech");
    const env = envelope({ aggregateId: companyId, payload: "a string" as any });
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, signed(env));
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("ignored");
    expect(res.body.reason).toMatch(/neither a stage nor a sector/i);
    expect(readListing(companyId).stage).toBe("seed");
  });

  it("numeric-looking stage/sector values are refused, not coerced", async () => {
    const app = makeApp();
    const companyId = "cmp_w187_adv_numeric";
    ensureListing(companyId, "seed", "fintech");
    /* Numbers are not strings, so neither field is accepted — no coercion path
       exists for an event to smuggle a figure into the Collective. */
    const env = envelope({ aggregateId: companyId, payload: { stage: 19900, sector: 4.5 } as any });
    const res = await post(app, COLLECTIVE_RECEIVER_PATH, env, signed(env));
    expect(res.body.outcome).toBe("ignored");
    const after = readListing(companyId);
    expect(after.stage).toBe("seed");
    expect(after.sector).toBe("fintech");
  });
});

/* ============================================================ I. envAssert */

describe("W187 I — bridgeEnvAssert describes the REAL receiver", () => {
  async function inspect(env: Record<string, string | undefined>) {
    const { inspectBridgeEnv } = await import("../lib/bridgeEnvAssert");
    return inspectBridgeEnv(env as NodeJS.ProcessEnv);
  }
  const codes = (r: any, sev?: string) =>
    r.findings.filter((f: any) => (sev ? f.severity === sev : true)).map((f: any) => f.code);

  it("the correct go-live URL produces no receiver error", async () => {
    const r = await inspect({
      BRIDGE_ENABLED: "1",
      COLLECTIVE_WEBHOOK_URL: "https://capavate.com/api/bridge/collective-receive",
      COLLECTIVE_WEBHOOK_SECRET: "s",
      BRIDGE_INBOUND_HMAC_SECRET: "s",
    });
    expect(codes(r, "error")).not.toContain("receiver_path_unknown");
    expect(codes(r, "error")).not.toContain("receiver_is_the_mock");
    expect(codes(r)).not.toContain("receiver_host_unexpected");
  });

  it("pointing production at the _mock route is a HARD ERROR — the R148.2 mistake, now a machine check", async () => {
    const r = await inspect({
      BRIDGE_ENABLED: "1",
      COLLECTIVE_WEBHOOK_URL: "https://capavate.com/api/_mock_collective/inbound",
      COLLECTIVE_WEBHOOK_SECRET: "s",
    });
    expect(codes(r, "error")).toContain("receiver_is_the_mock");
    const f = r.findings.find((x: any) => x.code === "receiver_is_the_mock")!;
    expect(f.message).toMatch(/TEST DOUBLE/);
    expect(f.message).toMatch(/collective-receive/);
  });

  it("any other path is a hard error naming the real receiver", async () => {
    const r = await inspect({
      BRIDGE_ENABLED: "1",
      COLLECTIVE_WEBHOOK_URL: "https://capavate.com/api/bridge/inbox",
      COLLECTIVE_WEBHOOK_SECRET: "s",
    });
    expect(codes(r, "error")).toContain("receiver_path_unknown");
  });

  it("DEAD_HOST stays a hard error and also trips the host check", async () => {
    const r = await inspect({
      BRIDGE_ENABLED: "1",
      COLLECTIVE_WEBHOOK_URL: "https://collective.capavate.com/api/bridge/collective-receive",
      COLLECTIVE_WEBHOOK_SECRET: "s",
    });
    expect(codes(r, "error").some((c: string) => /dead_host|unresolvable|dns/i.test(c))).toBe(true);
    expect(codes(r, "warn")).toContain("receiver_host_unexpected");
  });

  it("a secret mismatch is now a WARN, not an error, with the reason stated", async () => {
    const r = await inspect({
      BRIDGE_ENABLED: "1",
      COLLECTIVE_WEBHOOK_URL: "https://capavate.com/api/bridge/collective-receive",
      COLLECTIVE_WEBHOOK_SECRET: "a",
      BRIDGE_INBOUND_HMAC_SECRET: "b",
    });
    expect(codes(r, "error")).not.toContain("secret_mismatch");
    expect(codes(r, "warn")).toContain("secret_mismatch");
    const f = r.findings.find((x: any) => x.code === "secret_mismatch")!;
    expect(f.message).toMatch(/no longer fatal/i);
    expect(f.message).toMatch(/verifies against both secrets/i);
  });

  it("with nothing configured it reports the receiver exists AND that the bridge is off", async () => {
    const r = await inspect({});
    expect(codes(r)).toContain("receiver_ready");
    expect(codes(r)).toContain("bridge_disabled");
    const f = r.findings.find((x: any) => x.code === "receiver_ready")!;
    /* It must not imply the bridge is live. */
    expect(f.message).toMatch(/does NOT switch the bridge on/);
    expect(f.message).toMatch(/owner action/);
  });
});

/* ============================================================ H. Money */

/** Strip block and line comments so a grep conclusion is about CODE. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("W187 H — money discipline", () => {
  it("the comment stripper actually strips (self-check)", () => {
    const raw = fs.readFileSync(RECEIVER_SRC, "utf8");
    expect(raw).toMatch(/THE REAL COLLECTIVE RECEIVER/);
    expect(stripComments(raw)).not.toMatch(/THE REAL COLLECTIVE RECEIVER/);
  });

  it("the receiver contains no Number(), parseInt() or parseFloat()", () => {
    const src = stripComments(fs.readFileSync(RECEIVER_SRC, "utf8"));
    expect(src).not.toMatch(/\bNumber\s*\(/);
    expect(src).not.toMatch(/\bparseInt\s*\(/);
    expect(src).not.toMatch(/\bparseFloat\s*\(/);
    expect(src).not.toMatch(/\bNumber\s*\.\s*parse/);
  });

  it("the receiver writes no money column and invents no figure", () => {
    const src = stripComments(fs.readFileSync(RECEIVER_SRC, "utf8"));
    /* Wave 184 made fees database-driven; R156.2 says no fee may be hardcoded. */
    for (const forbidden of [/amount_minor/i, /amount_cents/i, /\bfee_/i, /price_minor/i, /capital_minor/i, /_bps\b/i]) {
      expect(src).not.toMatch(forbidden);
    }
    /* Only two business columns are ever written. */
    const updates = src.match(/UPDATE\s+collective_directory_listings\s+SET[^`]*/gi) ?? [];
    expect(updates.length).toBe(1);
    expect(updates[0]).toMatch(/SET stage = \?, sector = \? WHERE company_id = \?/);
  });
});
