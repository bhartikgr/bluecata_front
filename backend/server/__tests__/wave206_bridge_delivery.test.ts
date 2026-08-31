/**
 * WAVE 206 — the database-backed bridge configuration and the staged drain.
 *
 * THE RULING (R182.2), verbatim: *"push to live. I want it working and fully
 * dynamic."* And, from the same message: *"Do not break anything or dramatically
 * make assumptions to change things."*
 *
 * WHAT EACH BLOCK PROVES
 *   A. Precedence   — the database value wins once set; the environment variable
 *                     is retained as the fallback and is used until then.
 *   B. No secret    — nothing in the read report, the write result or the drain
 *                     result contains the signing secret's characters.
 *   C. No burst     — turning delivery ON in the database delivers nothing, does
 *                     not change `maySendOutboundBridge()`, and does not start
 *                     the worker.
 *   D. Dry run      — the default drain delivers nothing.
 *   E. Batch limit  — a confirmed drain never exceeds the limit.
 *   F. Reversible   — turning delivery off stops delivery immediately and the
 *                     queue is intact; nothing is deleted.
 *   G. Fence        — `partner.team_member_added` is still refused by the
 *                     ownership fence, and is never delivered.
 *   H. No destination — an event with no destination is refused with a readable
 *                     reason, not delivered somewhere approximate.
 *   I. Real registry — the destination decisions come from the receiver's OWN
 *                     apply/ignore registries, not a copy.
 *   J. Money        — no Number()/parseInt/parseFloat on anything monetary in
 *                     the new sources.
 *
 * NOTHING HERE IS A REPLICA. The real `inspectBridgeEnv()`, the real
 * `drainOutbox()`, the real `platformConfigWriter`, the real receiver registry
 * and the real Express routes are used throughout.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { emitBridgeEvent, getOutbox, _testBridge } from "../bridgeStore";
import { maySendOutboundBridge } from "../lib/bridgeOutboundGuard";
import { describeDestinationForEventType } from "../lib/collectiveBridgeReceiver";
import {
  describeDeliveryConfig,
  setWave206BridgeConfig,
  ensureWave206BridgeConfigKeys,
  _resetWave206SeedLatch,
  Wave206ConfigRefusal,
  BRIDGE_DELIVERY_ENABLED_KEY,
  BRIDGE_RECEIVER_URL_KEY,
  BRIDGE_DRAIN_BATCH_LIMIT_KEY,
  resolveDeliveryEnabled,
  resolveReceiverUrlField,
  resolveDrainBatchLimit,
  UNSET_SENTINEL,
  UNSET_BATCH_LIMIT,
  discloseReceiverSecret,
  validateCandidateReceiverUrl,
} from "../lib/wave206BridgeDeliveryConfig";
import { censusBacklog, planDrain, runDrain } from "../lib/wave206BridgeBacklog";
import { registerWave206BridgeDeliveryRoutes } from "../wave206BridgeDeliveryRoutes";
import { readConfigRow } from "../lib/platformConfigWriter";
import { rawDb } from "../db/connection";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_SRC = path.resolve(HERE, "../lib/wave206BridgeDeliveryConfig.ts");
const BACKLOG_SRC = path.resolve(HERE, "../lib/wave206BridgeBacklog.ts");
const ROUTES_SRC = path.resolve(HERE, "../wave206BridgeDeliveryRoutes.ts");
const GUARD_SRC = path.resolve(HERE, "../lib/bridgeOutboundGuard.ts");

const ACTOR = { actorUserId: "u_w206_admin", actorLabel: "w206@test", route: "test" };

/** A secret with a distinctive body, so a leak of ANY substring is detectable. */
const TEST_SECRET = "w206SecretMarkerZZZ" + "q".repeat(24);
const RECEIVER_URL = "https://capavate.com/api/bridge/collective-receive";

const ENV_KEYS = [
  "BRIDGE_ENABLED",
  "COLLECTIVE_WEBHOOK_URL",
  "COLLECTIVE_WEBHOOK_SECRET",
  "BRIDGE_OUTBOUND_URL",
  "BRIDGE_OUTBOUND_HMAC_SECRET",
  "BRIDGE_INBOUND_HMAC_SECRET",
  "COLLECTIVE_APP_URL",
] as const;

let savedEnv: Record<string, string | undefined> = {};

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

/**
 * Return all three settings to "not set here".
 *
 * `platform_config` rows are UNDELETABLE by trigger — `trg_pc_no_delete`
 * (server/db/connection.ts) aborts any DELETE — so a test cannot wipe them, and
 * must not try. Instead each key is set back to its explicit `"unset"` sentinel
 * through the REAL writer. That is the same action the owner has on screen
 * ("use the host environment instead"), so this reset exercises the product
 * rather than working around it.
 */
function resetToUnset() {
  ensureWave206BridgeConfigKeys("test:wave206");
  setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: UNSET_SENTINEL, ...ACTOR });
  setWave206BridgeConfig({ key: BRIDGE_RECEIVER_URL_KEY, value: UNSET_SENTINEL, ...ACTOR });
  setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: UNSET_BATCH_LIMIT, ...ACTOR });
}

/**
 * The REAL registrar and the REAL `requireAdmin`. No middleware is stubbed and
 * no context is injected: every request below carries `?as=admin`, which is the
 * sandbox persona selector `getUserContext()` already honours, so the genuine
 * admin boundary is exercised.
 */
function makeApp() {
  const app = express();
  app.use(express.json());
  registerWave206BridgeDeliveryRoutes(app);
  return app;
}

/** Every test request is an authenticated admin, through the real guard. */
function asAdmin(p: string): string {
  return p.includes("?") ? `${p}&as=admin` : `${p}?as=admin`;
}

async function call(
  app: express.Express,
  method: "GET" | "POST",
  p: string,
  body?: unknown,
): Promise<{ status: number; text: string; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          port,
          method,
          path: asAdmin(p),
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
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (data) req.write(data);
      req.end();
    });
  });
}

function queue(eventType: string, aggregateId: string) {
  return emitBridgeEvent({
    eventType: eventType as any,
    aggregateId,
    aggregateKind: "company",
    payload: { marker: "w206" },
  });
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  clearEnv();
  _testBridge.resetChain();
  resetToUnset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   A — PRECEDENCE: database wins once set, environment retained as fallback
   ══════════════════════════════════════════════════════════════════════════ */
describe("W206 · A — precedence is explicit and the environment fallback is retained", () => {
  it("A1 — untouched in the database, the host environment governs", () => {
    process.env.BRIDGE_ENABLED = "1";
    const f = resolveDeliveryEnabled();
    expect(f.value).toBe(true);
    expect(f.source).toBe("environment");
    expect(f.precedence).toContain("host environment");
    /* The fallback variable is NAMED so the owner knows where to look. */
    expect(f.envVarNames).toContain("BRIDGE_ENABLED");
  });

  it("A2 — once set here, the database value wins over the environment", () => {
    process.env.BRIDGE_ENABLED = "1";
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: false, ...ACTOR });
    const f = resolveDeliveryEnabled();
    expect(f.value).toBe(false);
    expect(f.source).toBe("database");
    /* And the environment variable is STILL there — never removed. */
    expect(process.env.BRIDGE_ENABLED).toBe("1");
  });

  it("A3 — the receiver address falls back to the environment until one is set here", () => {
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    expect(resolveReceiverUrlField().source).toBe("environment");
    setWave206BridgeConfig({ key: BRIDGE_RECEIVER_URL_KEY, value: RECEIVER_URL, ...ACTOR });
    const after = resolveReceiverUrlField();
    expect(after.source).toBe("database");
    expect(after.value).toBe(RECEIVER_URL);
    expect(process.env.COLLECTIVE_WEBHOOK_URL).toBe(RECEIVER_URL);
  });

  it("A4 — absence is an explicit named value, never inferred from a missing one (R176.1)", () => {
    /* "unset" is a real stored value the owner can read and can choose. */
    expect(readConfigRow(BRIDGE_RECEIVER_URL_KEY)?.valueJson).toBe(JSON.stringify(UNSET_SENTINEL));
    expect(resolveReceiverUrlField().source).not.toBe("database");

    /* And it is reversible in BOTH directions, which is the property a version
       number could never give: once a version has moved it can never move back. */
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    setWave206BridgeConfig({ key: BRIDGE_RECEIVER_URL_KEY, value: RECEIVER_URL, ...ACTOR });
    expect(resolveReceiverUrlField().source).toBe("database");
    setWave206BridgeConfig({ key: BRIDGE_RECEIVER_URL_KEY, value: UNSET_SENTINEL, ...ACTOR });
    expect(resolveReceiverUrlField().source).toBe("environment");

    /* Same for the other two settings. */
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: false, ...ACTOR });
    expect(resolveDeliveryEnabled().source).toBe("database");
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: UNSET_SENTINEL, ...ACTOR });
    expect(resolveDeliveryEnabled().source).not.toBe("database");
    setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: 8, ...ACTOR });
    expect(resolveDrainBatchLimit().value).toBe(8);
    setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: UNSET_BATCH_LIMIT, ...ACTOR });
    expect(resolveDrainBatchLimit().source).toBe("default");
  });

  it("A4b — every reset above left history behind: nothing about a config change is erasable", () => {
    const n: any = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM platform_config_history WHERE config_key = ?`)
      .get(BRIDGE_RECEIVER_URL_KEY);
    expect(Number(n.n)).toBeGreaterThan(0);
  });

  it("A5 — a bad address is refused with a readable reason, using the real receiver rules", () => {
    expect(validateCandidateReceiverUrl("https://capavate.com/api/bridge/inbound").ok).toBe(false);
    expect(validateCandidateReceiverUrl("https://collective.capavate.com/api/bridge/collective-receive").ok).toBe(false);
    expect(validateCandidateReceiverUrl("not a url").ok).toBe(false);
    expect(validateCandidateReceiverUrl(RECEIVER_URL).ok).toBe(true);
    expect(() =>
      setWave206BridgeConfig({ key: BRIDGE_RECEIVER_URL_KEY, value: "https://capavate.com/wrong", ...ACTOR }),
    ).toThrow(Wave206ConfigRefusal);
  });

  it("A6 — delivery cannot be turned on while there is nowhere to send", () => {
    expect(() =>
      setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR }),
    ).toThrow(/no address to deliver to/i);
  });

  it("A7 — the batch limit is range-checked in both directions", () => {
    expect(() => setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: -1, ...ACTOR })).toThrow();
    expect(() => setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: 5000, ...ACTOR })).toThrow();
    /* Zero is not out of range: it is the named "not set here" sentinel. */
    expect(setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: 0, ...ACTOR }).storedValue).toBe(0);
    const ok = setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: 7, ...ACTOR });
    expect(ok.storedValue).toBe(7);
  });

  it("A8 — every change is recorded through the existing admin-audit writer", () => {
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    const before: any = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'bridge_delivery_config_changed'`)
      .get();
    setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: 9, ...ACTOR });
    const after: any = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'bridge_delivery_config_changed'`)
      .get();
    expect(Number(after.n)).toBe(Number(before.n) + 1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B — NO SECRET IS EVER DISPLAYED
   ══════════════════════════════════════════════════════════════════════════ */
describe("W206 · B — the signing secret never reaches the screen", () => {
  beforeEach(() => {
    process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    process.env.BRIDGE_ENABLED = "1";
  });

  it("B1 — the disclosure reports presence only: no value, no prefix, no length", () => {
    const d = discloseReceiverSecret();
    expect(d.configured).toBe(true);
    const serialised = JSON.stringify(d);
    expect(serialised).not.toContain(TEST_SECRET);
    expect(serialised).not.toContain("w206SecretMarker");
    /* The length is not disclosed either — a length narrows a brute force. */
    expect(serialised).not.toContain(String(TEST_SECRET.length));
  });

  it("B2 — the whole configuration report is free of the secret", () => {
    const serialised = JSON.stringify(describeDeliveryConfig());
    expect(serialised).not.toContain(TEST_SECRET);
    expect(serialised).not.toContain("w206SecretMarker");
  });

  it("B3 — the READ endpoint's raw response body is free of the secret", async () => {
    const app = makeApp();
    const res = await call(app, "GET", "/api/admin/bridge/delivery-config");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(TEST_SECRET);
    expect(res.text).not.toContain("w206SecretMarker");
    /* Presence IS reported, so the owner is not left guessing. */
    expect(res.body.config.secret.configured).toBe(true);
  });

  it("B4 — the WRITE endpoint's raw response body is free of the secret", async () => {
    const app = makeApp();
    const res = await call(app, "POST", "/api/admin/bridge/delivery-config", {
      key: BRIDGE_DRAIN_BATCH_LIMIT_KEY,
      value: 5,
    });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(TEST_SECRET);
    expect(res.text).not.toContain("w206SecretMarker");
  });

  it("B5 — the DRAIN endpoint's raw response body is free of the secret", async () => {
    queue("partner.team_member_added", "co_w206_b5");
    const app = makeApp();
    const res = await call(app, "POST", "/api/admin/bridge/backlog-drain", {});
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(TEST_SECRET);
    expect(res.text).not.toContain("w206SecretMarker");
  });

  it("B6 — the audit payload for a configuration change carries no secret", () => {
    setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: 11, ...ACTOR });
    const row: any = rawDb()
      .prepare(
        `SELECT payload_json FROM audit_log WHERE action = 'bridge_delivery_config_changed' ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get();
    expect(String(row?.payload_json ?? "")).not.toContain("w206SecretMarker");
  });

  it("B7 — no source file in this wave reads a secret into a response field", () => {
    for (const src of [CONFIG_SRC, BACKLOG_SRC, ROUTES_SRC]) {
      const text = fs.readFileSync(src, "utf8");
      /* The only call to the secret resolver in the whole wave is the presence
         check and the signing call. It is never spread into an object literal. */
      const spread = /\.\.\.\s*(secret|resolveReceiverSecret\(\))/.test(text);
      expect(spread).toBe(false);
      expect(/secret\s*:\s*secret\b/.test(text)).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C — ENABLING DOES NOT DRAIN THE BACKLOG
   ══════════════════════════════════════════════════════════════════════════ */
describe("W206 · C — turning delivery on sends nothing by itself", () => {
  it("C1 — the database flag does not change `maySendOutboundBridge()`", () => {
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
    delete process.env.BRIDGE_ENABLED;
    const before = maySendOutboundBridge();
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });
    expect(maySendOutboundBridge()).toBe(before);
  });

  it("C2 — the database flag cannot reach the worker's own permission predicate", () => {
    /* The structural guarantee behind C1: `maySendOutboundBridge()` is what the
       background worker gates on, at start AND on every tick. If any database
       value could reach it, a flag flip would become a burst of hundreds of
       deliveries. So the guard must know nothing about this wave's storage. */
    const guard = fs.readFileSync(GUARD_SRC, "utf8");
    for (const forbidden of ["wave206", "platform_config", "readConfigRow", "resolveDeliveryEnabled"]) {
      expect(guard).not.toContain(forbidden);
    }
    /* ...and the worker itself is untouched by this wave. */
    const worker = fs.readFileSync(path.resolve(HERE, "../bridgeWorker.ts"), "utf8");
    expect(worker).not.toContain("wave206");
    /* The configuration module never even imports the predicate, so it cannot
       widen it by accident. */
    expect(fs.readFileSync(CONFIG_SRC, "utf8")).not.toContain("maySendOutboundBridge");
  });

  it("C3 — turning delivery on delivers zero events", async () => {
    for (let i = 0; i < 30; i += 1) queue("captable.waterfall.computed", `co_w206_c3_${i}`);
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
    const queuedBefore = getOutbox().filter((e) => e.status === "queued").length;
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });
    /* No drain has been asked for. Nothing may have moved. */
    const after = getOutbox();
    expect(after.filter((e) => e.status === "queued").length).toBe(queuedBefore);
    expect(after.filter((e) => e.status === "delivered").length).toBe(0);
    expect(after.filter((e) => e.status === "dead_letter").length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D — DRY RUN DELIVERS NOTHING
   ══════════════════════════════════════════════════════════════════════════ */
describe("W206 · D — the dry run is the default and it sends nothing", () => {
  beforeEach(() => {
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
    process.env.BRIDGE_ENABLED = "1";
    for (let i = 0; i < 12; i += 1) queue("company.profile.updated", `co_w206_d_${i}`);
  });

  it("D1 — `runDrain` without a confirmation reports a dry run and moves nothing", async () => {
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });
    const before = getOutbox().map((e) => ({ id: e.envelope.eventId, s: e.status, a: e.attempts }));
    const out = await runDrain({ requestedLimit: null, confirm: false, ...ACTOR });
    expect(out.dryRun).toBe(true);
    expect(out.delivered).toBe(0);
    expect(out.attempted).toBe(0);
    const after = getOutbox().map((e) => ({ id: e.envelope.eventId, s: e.status, a: e.attempts }));
    expect(after).toEqual(before);
  });

  it("D2 — the dry run still says exactly what it WOULD send, and where", async () => {
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });
    const out = await runDrain({ requestedLimit: null, confirm: false, ...ACTOR });
    expect(out.plan.selectedDeliverable).toBeGreaterThan(0);
    expect(out.plan.targetHost).toBe("capavate.com");
    expect(out.plan.targetPath).toBe("/api/bridge/collective-receive");
    expect(out.statement).toMatch(/dry run/i);
  });

  it("D3 — a truthy-but-not-true confirmation is still a dry run", async () => {
    const app = makeApp();
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });
    for (const value of ["true", 1, "yes", {}]) {
      const res = await call(app, "POST", "/api/admin/bridge/backlog-drain", { confirm: value });
      expect(res.body.dryRun).toBe(true);
      expect(res.body.delivered).toBe(0);
    }
  });

  it("D4 — the plan-only GET cannot deliver", async () => {
    const app = makeApp();
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });
    const before = getOutbox().map((e) => e.status).join(",");
    const res = await call(app, "GET", "/api/admin/bridge/backlog-plan?limit=5");
    expect(res.body.dryRun).toBe(true);
    expect(res.body.plan.limit).toBe(5);
    expect(getOutbox().map((e) => e.status).join(",")).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   E — THE BATCH LIMIT HOLDS
   ══════════════════════════════════════════════════════════════════════════ */
describe("W206 · E — a confirmed drain never exceeds its limit", () => {
  it("E1 — the plan selects no more than the limit, however many are waiting", () => {
    for (let i = 0; i < 60; i += 1) queue("company.profile.updated", `co_w206_e1_${i}`);
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
    setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: 4, ...ACTOR });
    const plan = planDrain(null);
    expect(plan.eligibleQueued).toBe(60);
    expect(plan.limit).toBe(4);
    expect(plan.selected.length).toBe(4);
    expect(plan.heldBackByLimit).toBe(56);
  });

  it("E2 — a caller asking for MORE than the stored limit gets the stored limit", () => {
    for (let i = 0; i < 30; i += 1) queue("company.profile.updated", `co_w206_e2_${i}`);
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
    setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: 3, ...ACTOR });
    expect(planDrain(999).limit).toBe(3);
    expect(planDrain(999).selected.length).toBe(3);
  });

  it("E3 — a confirmed drain against a REAL receiver delivers exactly the limit and no more", async () => {
    for (let i = 0; i < 20; i += 1) queue("company.profile.updated", `co_w206_e3_${i}`);

    /* A real HTTP endpoint that counts what actually arrives. Nothing is faked:
       the drain performs a real signed POST over a real socket. */
    let received = 0;
    const sink = express();
    sink.use(express.json());
    sink.post("/api/bridge/collective-receive", (_req, res) => {
      received += 1;
      res.status(200).json({ ok: true });
    });
    const server = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(sink).listen(0, () => resolve(s));
    });
    const port = (server.address() as any).port;
    const url = `http://127.0.0.1:${port}/api/bridge/collective-receive`;

    try {
      process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
      process.env.COLLECTIVE_WEBHOOK_URL = url;
      process.env.BRIDGE_ENABLED = "1";
      setWave206BridgeConfig({ key: BRIDGE_DRAIN_BATCH_LIMIT_KEY, value: 5, ...ACTOR });
      setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });

      const out = await runDrain({ requestedLimit: null, confirm: true, ...ACTOR });
      expect(out.dryRun).toBe(false);
      expect(received).toBe(5);
      expect(out.delivered).toBe(5);
      expect(getOutbox().filter((e) => e.status === "delivered").length).toBe(5);
      /* The other 15 are STILL QUEUED and their retry schedule was restored. */
      const stillQueued = getOutbox().filter((e) => e.status === "queued");
      expect(stillQueued.length).toBe(15);
      const now = Date.now();
      for (const e of stillQueued) expect(e.nextRetryAt).toBeLessThanOrEqual(now);

      /* AND THEY WERE NEVER EVEN ATTEMPTED. This is the assertion the first
         version of this test was missing: without the out-of-batch deferral the
         real engine still walks the whole queue, and although the callback
         refuses everything outside the batch, each refusal costs the entry an
         attempt and a backoff — so a repeated drain would eventually
         dead-letter events that were never in any batch. Found by the disarm
         harness (W206_DISARM.py, disarm D4 came back GREEN). */
      for (const e of stillQueued) {
        expect(e.attempts).toBe(0);
        expect(e.lastError ?? null).toBeNull();
      }
    } finally {
      server.close();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   F — REVERSIBLE, AND NOTHING IS LOST
   ══════════════════════════════════════════════════════════════════════════ */
describe("W206 · F — turning it off stops delivery and loses nothing", () => {
  it("F1 — with delivery off, a CONFIRMED drain still delivers nothing and the queue is intact", async () => {
    for (let i = 0; i < 8; i += 1) queue("company.profile.updated", `co_w206_f1_${i}`);
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
    process.env.BRIDGE_ENABLED = "1";
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: false, ...ACTOR });

    const before = getOutbox().map((e) => ({ id: e.envelope.eventId, s: e.status, a: e.attempts }));
    const out = await runDrain({ requestedLimit: null, confirm: true, ...ACTOR });
    expect(out.delivered).toBe(0);
    expect(out.attempted).toBe(0);
    expect(getOutbox().map((e) => ({ id: e.envelope.eventId, s: e.status, a: e.attempts }))).toEqual(before);
    expect(out.statement).toMatch(/nothing was sent/i);
  });

  it("F2 — no new source in this wave deletes, archives or truncates anything", () => {
    for (const src of [CONFIG_SRC, BACKLOG_SRC, ROUTES_SRC]) {
      const text = fs.readFileSync(src, "utf8");
      expect(/\bDELETE\s+FROM\b/i.test(text)).toBe(false);
      expect(/\bDROP\s+TABLE\b/i.test(text)).toBe(false);
      expect(/status\s*=\s*"archived"/.test(text)).toBe(false);
      expect(/\.length\s*=\s*0/.test(text)).toBe(false);
      expect(/\bsplice\(/.test(text)).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   G — THE OWNERSHIP FENCE STILL REFUSES
   ══════════════════════════════════════════════════════════════════════════ */
describe("W206 · G — the ownership fence keeps refusing", () => {
  it("G1 — `partner.team_member_added` is refused by the fence, in the receiver's own words", () => {
    const d = describeDestinationForEventType("partner.team_member_added");
    expect(d.hasDestination).toBe(false);
    expect(d.fenced).toBe(true);
    expect(d.kind).toBe("refused");
    expect(d.reason).toMatch(/refused by fence/i);
    expect(d.reason).toMatch(/reachable/i);
  });

  it("G2 — a fenced event is never selected for delivery, even in a confirmed drain", async () => {
    for (let i = 0; i < 6; i += 1) queue("partner.team_member_added", `pt_w206_g2_${i}`);
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
    process.env.BRIDGE_ENABLED = "1";
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });

    const out = await runDrain({ requestedLimit: null, confirm: true, ...ACTOR });
    expect(out.attempted).toBe(0);
    expect(out.delivered).toBe(0);
    expect(out.refused).toBe(6);
    for (const r of out.refusals) {
      expect(r.fenced).toBe(true);
      expect(r.reason).toMatch(/refused by fence/i);
    }
    /* All six are still queued — refused is not lost. */
    expect(getOutbox().filter((e) => e.status === "queued").length).toBe(6);
  });

  it("G3 — the census counts the fenced events separately", () => {
    for (let i = 0; i < 3; i += 1) queue("partner.team_member_added", `pt_w206_g3_${i}`);
    const c = censusBacklog();
    expect(c.queuedRefusedByFence).toBe(3);
    expect(c.queuedWithDestination).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   H — A DESTINATION-LESS EVENT IS REFUSED WITH A READABLE REASON
   ══════════════════════════════════════════════════════════════════════════ */
describe("W206 · H — no event is delivered somewhere approximate", () => {
  it("H1 — every queued type without an apply handler is refused with a stated reason", async () => {
    const types = [
      "subscription.auto_created_on_company_create",
      "captable.waterfall.computed",
      "spv.created",
      "payment_charged",
      "partner.onboarded",
    ];
    for (const t of types) queue(t, `co_w206_h1_${t}`);
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
    process.env.BRIDGE_ENABLED = "1";
    setWave206BridgeConfig({ key: BRIDGE_DELIVERY_ENABLED_KEY, value: true, ...ACTOR });

    const out = await runDrain({ requestedLimit: null, confirm: true, ...ACTOR });
    expect(out.attempted).toBe(0);
    expect(out.refused).toBe(types.length);
    for (const r of out.refusals) {
      expect(r.reason.length).toBeGreaterThan(30);
      /* A reason a person can read, not a code. */
      expect(r.reason).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it("H2 — `partner.onboarded`, which the receiver does not name, still gets a reason", () => {
    const d = describeDestinationForEventType("partner.onboarded");
    expect(d.unknownType).toBe(true);
    expect(d.hasDestination).toBe(false);
    expect(d.reason).toMatch(/recorded here in full so nothing is lost/i);
  });

  it("H3 — money-bearing payloads are counted but never transcribed", () => {
    queue("captable.waterfall.computed", "co_w206_h3");
    const c = censusBacklog();
    const row = c.byType.find((r) => r.eventType === "captable.waterfall.computed");
    expect(row?.hasDestination).toBe(false);
    expect(row?.reason).toMatch(/does not transcribe money/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   I — THE DESTINATION DECISIONS COME FROM THE REAL REGISTRY
   ══════════════════════════════════════════════════════════════════════════ */
describe("W206 · I — no replica of the receiver's registry", () => {
  it("I1 — the one type the receiver APPLIES is reported as having a destination", () => {
    const d = describeDestinationForEventType("company.profile.updated");
    expect(d.hasDestination).toBe(true);
    expect(d.handler).toBe("directory_listing.classification");
  });

  it("I2 — the new modules hold no second table of destinations or reasons", () => {
    for (const src of [CONFIG_SRC, BACKLOG_SRC, ROUTES_SRC]) {
      const text = fs.readFileSync(src, "utf8");
      expect(text).not.toContain("IGNORE_REASONS");
      expect(text).not.toContain("APPLY_HANDLERS");
      expect(text).not.toContain("refused by fence:");
    }
  });

  it("I3 — the receiver path is taken from the receiver's exported constant, never re-typed", () => {
    const backlog = fs.readFileSync(BACKLOG_SRC, "utf8");
    const config = fs.readFileSync(CONFIG_SRC, "utf8");
    expect(backlog).not.toContain("/api/bridge/collective-receive");
    expect(config).not.toContain("/api/bridge/collective-receive");
    expect(config).not.toContain("collective.capavate.com");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   J — MONEY AND HARDCODING DISCIPLINE
   ══════════════════════════════════════════════════════════════════════════ */
describe("W206 · J — money and hardcoding discipline", () => {
  it("J1 — no monetary parse in any new source", () => {
    for (const src of [CONFIG_SRC, BACKLOG_SRC, ROUTES_SRC]) {
      const text = fs.readFileSync(src, "utf8");
      expect(text).not.toContain("parseFloat");
      expect(text).not.toContain("parseInt");
    }
  });

  it("J2 — no currency, price or fee is named anywhere in the new sources", () => {
    for (const src of [CONFIG_SRC, BACKLOG_SRC, ROUTES_SRC]) {
      const text = fs.readFileSync(src, "utf8");
      expect(/\b(USD|EUR|GBP|CAD)\b/.test(text)).toBe(false);
      /* A currency symbol against a number. `${...}` interpolation is not one. */
      expect(/\$\s*[0-9]/.test(text)).toBe(false);
      expect(/\b(price|fee|amount_cents)\b/i.test(text)).toBe(false);
    }
  });

  it("J3 — every human string fits the 240-character readability gate", () => {
    process.env.COLLECTIVE_WEBHOOK_URL = RECEIVER_URL;
    process.env.COLLECTIVE_WEBHOOK_SECRET = TEST_SECRET;
    const report = describeDeliveryConfig();
    const strings = [
      report.deliveryEnabled.precedence,
      report.receiverUrl.precedence,
      report.drainBatchLimit.precedence,
      report.secret.statement,
      report.mayDeliverReason,
      report.workerNote,
      censusBacklog().statement,
    ];
    for (const s of strings) expect(s.length).toBeLessThan(240);
  });
});
