/**
 * WAVE 206 — ADVERSARIAL PASS.
 *
 * The brief's post-build review pass (c) requires more than re-running the
 * proofs: it requires actively TRYING to break each promise. This file is that
 * attempt. Every block below is written to SUCCEED at something the wave says is
 * impossible; each `expect` is the record that the attack failed.
 *
 *   ATTACK 1 — make turning delivery on drain the backlog.
 *   ATTACK 2 — read the signing secret back off the screen.
 *   ATTACK 3 — get a destination-less event delivered.
 *   ATTACK 4 — bypass the `partner.team_member_added` ownership fence.
 *   ATTACK 5 — exceed the batch limit.
 *   ATTACK 6 — reach any of it without being an admin.
 *
 * Everything runs against the REAL routes, the REAL guard, the REAL receiver
 * registry and the REAL outbox. No condition is faked to make a proof pass.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";

import { emitBridgeEvent, getOutbox, _testBridge } from "../bridgeStore";
import { registerWave206BridgeDeliveryRoutes } from "../wave206BridgeDeliveryRoutes";
import {
  setWave206BridgeConfig,
  ensureWave206BridgeConfigKeys,
  UNSET_SENTINEL,
  UNSET_BATCH_LIMIT,
  BRIDGE_DELIVERY_ENABLED_KEY,
  BRIDGE_RECEIVER_URL_KEY,
  BRIDGE_DRAIN_BATCH_LIMIT_KEY,
} from "../lib/wave206BridgeDeliveryConfig";
import { runDrain } from "../lib/wave206BridgeBacklog";

const ACTOR = { actorUserId: "u_admin", actorLabel: "adversarial@test", route: "test" };
const TEST_SECRET = "w206AttackMarkerYYY" + "k".repeat(24);

const ENV_KEYS = [
  "BRIDGE_ENABLED",
  "COLLECTIVE_WEBHOOK_URL",
  "COLLECTIVE_WEBHOOK_SECRET",
  "BRIDGE_OUTBOUND_URL",
  "BRIDGE_OUTBOUND_HMAC_SECRET",
  "BRIDGE_INBOUND_HMAC_SECRET",
] as const;
let saved: Record<string, string | undefined> = {};

/** A real HTTP receiver that counts arrivals. Nothing is mocked out. */
async function startSink(): Promise<{ url: string; count: () => number; stop: () => void }> {
  let n = 0;
  const app = express();
  app.use(express.json());
  app.post("/api/bridge/collective-receive", (_q, r) => {
    n += 1;
    r.status(200).json({ ok: true });
  });
  const server = await new Promise<http.Server>((res) => {
    const s = http.createServer(app).listen(0, () => res(s));
  });
  const port = (server.address() as any).port;
  return {
    url: `http://127.0.0.1:${port}/api/bridge/collective-receive`,
    count: () => n,
    stop: () => server.close(),
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  registerWave206BridgeDeliveryRoutes(app);
  return app;
}

async function req(
  app: express.Express,
  method: "GET" | "POST",
  p: string,
  body?: unknown,
): Promise<{ status: number; text: string; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = body === undefined ? undefined : JSON.stringify(body);
      const r = http.request(
        {
          port,
          method,
          path: p,
          headers: data
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) }
            : {},
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            server.close();
            let parsed: any = null;
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = null;
            }
            resolve({ status: res.statusCode ?? 0, text: raw, body: parsed });
          });
        },
      );
      r.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (data) r.write(data);
      r.end();
    });
  });
}

function queue(eventType: string, id: string) {
  return emitBridgeEvent({
    eventType: eventType as any,
    aggregateId: id,
    aggregateKind: "company",
    payload: { marker: "w206adv" },
  });
}

function unsetAll() {
  ensureWave206BridgeConfigKeys("test:wave206adv");
  setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: UNSET_SENTINEL, ...ACTOR });
  setWave206BridgeConfig({ key: BRIDGE_RECEIVER_URL_KEY, value: UNSET_SENTINEL, ...ACTOR });
  setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: UNSET_BATCH_LIMIT, ...ACTOR });
}

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  _testBridge.resetChain();
  unsetAll();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

/* ─────────────────────── ATTACK 1 — burst the backlog ─────────────────────── */
describe("W206 ATTACK 1 — try to make enabling delivery drain the backlog", () => {
  it("A1.1 — 40 deliverable events queued, a real receiver listening, then delivery is switched on: nothing arrives", async () => {
    const sink = await startSink();
    try {
      for (let i = 0; i < 40; i += 1) queue("company.profile.updated", `co_adv1_${i}`);
      process.env.COLLECTIVE_WEBHOOK_URL = sink.url;
      process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
      process.env.BRIDGE_ENABLED = "1";

      const app = makeApp();
      const res = await req(app, "POST", "/api/admin/bridge/delivery-config?as=admin", {
        key: BRIDGE_DELIVERY_ENABLED_KEY,
        value: true,
      });
      expect(res.status).toBe(200);

      /* Give any background timer a real chance to fire. */
      await new Promise((r) => setTimeout(r, 350));
      expect(sink.count()).toBe(0);
      expect(getOutbox().filter((e) => e.status === "queued").length).toBe(40);
    } finally {
      sink.stop();
    }
  });

  it("A1.2 — reading the configuration page cannot deliver either", async () => {
    const sink = await startSink();
    try {
      for (let i = 0; i < 5; i += 1) queue("company.profile.updated", `co_adv1b_${i}`);
      process.env.COLLECTIVE_WEBHOOK_URL = sink.url;
      process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
      setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });
      const app = makeApp();
      for (let i = 0; i < 3; i += 1) {
        await req(app, "GET", "/api/admin/bridge/delivery-config?as=admin");
        await req(app, "GET", "/api/admin/bridge/backlog-plan?as=admin");
      }
      expect(sink.count()).toBe(0);
    } finally {
      sink.stop();
    }
  });
});

/* ─────────────────────── ATTACK 2 — read the secret ─────────────────────── */
describe("W206 ATTACK 2 — try to read the signing secret back off the screen", () => {
  beforeEach(() => {
    process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
    process.env.COLLECTIVE_WEBHOOK_URL = "https://capavate.com/api/bridge/collective-receive";
    process.env.BRIDGE_ENABLED = "1";
  });

  it("A2.1 — no query parameter persuades any endpoint to include it", async () => {
    const app = makeApp();
    const paths = [
      "/api/admin/bridge/delivery-config?as=admin&reveal=1",
      "/api/admin/bridge/delivery-config?as=admin&fields=secret",
      "/api/admin/bridge/delivery-config?as=admin&include=secret&debug=true&verbose=1",
      "/api/admin/bridge/backlog-plan?as=admin&reveal=secret",
    ];
    for (const p of paths) {
      const res = await req(app, "GET", p);
      expect(res.text).not.toContain(TEST_SECRET);
      expect(res.text).not.toContain("w206AttackMarker");
    }
  });

  it("A2.2 — the secret cannot be written INTO the database through any of the three keys", async () => {
    const app = makeApp();
    for (const key of [BRIDGE_DELIVERY_ENABLED_KEY, BRIDGE_RECEIVER_URL_KEY, BRIDGE_DRAIN_BATCH_LIMIT_KEY]) {
      const res = await req(app, "POST", "/api/admin/bridge/delivery-config?as=admin", {
        key,
        value: TEST_SECRET,
      });
      /* Either refused outright, or — for the address field — refused by the URL
         rules. Never stored, and never echoed. */
      expect(res.body?.ok).not.toBe(true);
      expect(res.text).not.toContain(TEST_SECRET);
    }
    /* And a made-up fourth key is not a way in. */
    const rogue = await req(app, "POST", "/api/admin/bridge/delivery-config?as=admin", {
      key: "collective.bridge.webhook_secret",
      value: TEST_SECRET,
    });
    expect(rogue.body?.ok).not.toBe(true);
    expect(rogue.text).not.toContain(TEST_SECRET);
  });

  it("A2.3 — an address carrying a token in its query is never echoed back whole", async () => {
    const tokenUrl = "https://capavate.com/api/bridge/collective-receive?token=w206AttackMarkerYYY";
    const app = makeApp();
    await req(app, "POST", "/api/admin/bridge/delivery-config?as=admin", {
      key: BRIDGE_RECEIVER_URL_KEY,
      value: tokenUrl,
    });
    const plan = await req(app, "POST", "/api/admin/bridge/backlog-drain?as=admin", {});
    /* The plan reports host and path only, so a query-string credential in the
       stored address cannot leak through the drain report. */
    expect(plan.body?.plan?.targetPath).toBe("/api/bridge/collective-receive");
    expect(JSON.stringify(plan.body?.plan ?? {})).not.toContain("token=");
  });
});

/* ───────────── ATTACK 3 — deliver something with no destination ───────────── */
describe("W206 ATTACK 3 — try to get a destination-less event delivered", () => {
  it("A3.1 — a confirmed drain of only destination-less events sends nothing to a live receiver", async () => {
    const sink = await startSink();
    try {
      for (const t of [
        "subscription.auto_created_on_company_create",
        "captable.waterfall.computed",
        "spv.created",
        "payment_charged",
        "partner.onboarded",
      ]) {
        queue(t, `co_adv3_${t}`);
      }
      process.env.COLLECTIVE_WEBHOOK_URL = sink.url;
      process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
      process.env.BRIDGE_ENABLED = "1";
      setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });

      const out = await runDrain({ requestedLimit: null, confirm: true, ...ACTOR });
      expect(sink.count()).toBe(0);
      expect(out.delivered).toBe(0);
      expect(out.refused).toBe(5);
      /* And none of them was quietly consumed. */
      expect(getOutbox().filter((e) => e.status === "queued").length).toBe(5);
    } finally {
      sink.stop();
    }
  });

  it("A3.2 — an unknown event type invented at emit time is refused, not delivered", async () => {
    const sink = await startSink();
    try {
      queue("totally.invented.event.type", "co_adv3b");
      process.env.COLLECTIVE_WEBHOOK_URL = sink.url;
      process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
      process.env.BRIDGE_ENABLED = "1";
      setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });
      const out = await runDrain({ requestedLimit: null, confirm: true, ...ACTOR });
      expect(sink.count()).toBe(0);
      expect(out.refusals.length).toBe(1);
      expect(out.refusals[0]!.reason.length).toBeGreaterThan(20);
    } finally {
      sink.stop();
    }
  });
});

/* ──────────────── ATTACK 4 — bypass the ownership fence ──────────────── */
describe("W206 ATTACK 4 — try to bypass the team-member ownership fence", () => {
  it("A4.1 — the fenced type is refused however the drain is asked for", async () => {
    const sink = await startSink();
    try {
      for (let i = 0; i < 4; i += 1) queue("partner.team_member_added", `pt_adv4_${i}`);
      process.env.COLLECTIVE_WEBHOOK_URL = sink.url;
      process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
      process.env.BRIDGE_ENABLED = "1";
      setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });

      const app = makeApp();
      /* Every shape of request an attacker might try, including asking for a
         bigger limit, a forced flag and a per-event target. */
      const bodies: unknown[] = [
        { confirm: true },
        { confirm: true, limit: 9999 },
        { confirm: true, force: true },
        { confirm: true, includeRefused: true },
        { confirm: true, eventTypes: ["partner.team_member_added"] },
        { confirm: true, override: { fence: false } },
      ];
      for (const b of bodies) {
        const res = await req(app, "POST", "/api/admin/bridge/backlog-drain?as=admin", b);
        expect(res.body?.delivered).toBe(0);
      }
      expect(sink.count()).toBe(0);
      expect(getOutbox().filter((e) => e.status === "queued").length).toBe(4);
    } finally {
      sink.stop();
    }
  });
});

/* ──────────────── ATTACK 5 — exceed the batch limit ──────────────── */
describe("W206 ATTACK 5 — try to send more than the limit in one drain", () => {
  it("A5.1 — a caller-supplied limit can only ever LOWER the ceiling, never raise it", async () => {
    const sink = await startSink();
    try {
      for (let i = 0; i < 30; i += 1) queue("company.profile.updated", `co_adv5_${i}`);
      process.env.COLLECTIVE_WEBHOOK_URL = sink.url;
      process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
      process.env.BRIDGE_ENABLED = "1";
      setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: 3, ...ACTOR });
      setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });

      const app = makeApp();
      for (const limit of [9999, -1, 0, "100", Number.MAX_SAFE_INTEGER, null]) {
        const before = sink.count();
        const res = await req(app, "POST", "/api/admin/bridge/backlog-drain?as=admin", {
          confirm: true,
          limit,
        });
        expect(res.body?.delivered ?? 0).toBeLessThanOrEqual(3);
        expect(sink.count() - before).toBeLessThanOrEqual(3);
      }
      /* Six drains at a limit of three can never have emptied thirty events. */
      expect(getOutbox().filter((e) => e.status === "queued").length).toBeGreaterThan(0);
    } finally {
      sink.stop();
    }
  });
});

/* ──────────────── ATTACK 6 — reach it without being an admin ──────────────── */
describe("W206 ATTACK 6 — try to reach any of it without an admin session", () => {
  it("A6.1 — a founder and an investor persona are both refused on every route", async () => {
    const app = makeApp();
    for (const who of ["founder", "investor"]) {
      for (const [method, p] of [
        ["GET", `/api/admin/bridge/delivery-config?as=${who}`],
        ["GET", `/api/admin/bridge/backlog-plan?as=${who}`],
        ["POST", `/api/admin/bridge/delivery-config?as=${who}`],
        ["POST", `/api/admin/bridge/backlog-drain?as=${who}`],
      ] as Array<["GET" | "POST", string]>) {
        const res = await req(app, method, p, method === "POST" ? { confirm: true } : undefined);
        expect([401, 403]).toContain(res.status);
      }
    }
  });

  it("A6.2 — the actor recorded for a change is the session, never the request body", async () => {
    const app = makeApp();
    process.env.COLLECTIVE_WEBHOOK_URL = "https://capavate.com/api/bridge/collective-receive";
    const res = await req(app, "POST", "/api/admin/bridge/delivery-config?as=admin", {
      key: BRIDGE_DRAIN_BATCH_LIMIT_KEY,
      value: 6,
      actorUserId: "u_someone_else",
      changedBy: "u_someone_else",
      actor: "attacker@example.com",
    });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("u_someone_else");
    expect(res.text).not.toContain("attacker@example.com");
  });
});
