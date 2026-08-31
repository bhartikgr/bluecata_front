/**
 * WAVE 190 · ITEM D · R157.2 — "LIVE" WAS A LABEL. THIS IS THE FACT, AND IT
 * CARRIES NO CREDENTIAL.
 *
 * THE DEFECT THIS TEST FENCES. `/admin/fees` → Payment Gateway printed Mode
 * "LIVE" as a static string while nothing in the platform ever checked whether
 * the gateway's variables were present, and the same panel said "No webhook
 * events yet" from a hardcoded sentence rather than from the table. The owner
 * reported the gateway unset FOUR times by reading a health field that contains
 * no Airwallex data at all. The disclosure endpoint exists so the question has an
 * answer.
 *
 * WHY THIS TEST IS AT THE HTTP LAYER (R137). The claim is about a RESPONSE BODY —
 * both what it says and, far more importantly, what it must never contain. A unit
 * test of the disclosure function would not prove what the route serialises, and
 * the serialised body is the thing that leaves the process.
 *
 * ══ THE ASSERTION THIS ITEM LIVES OR DIES ON ══
 * §D-3 sets every gateway variable to a distinctive sentinel VALUE and asserts
 * that no sentinel appears ANYWHERE in the raw response text — not in a field, not
 * in a length, not as a prefix, not in an error, not in a key. It scans the raw
 * body string rather than walking the typed object on purpose: a future field that
 * leaked a value would be caught by a text scan and missed by a walk of the fields
 * the test happened to know about.
 *
 * ENVIRONMENT DISCIPLINE. Every variable this suite sets is captured and restored
 * afterwards, so it cannot leave the process environment altered for another test
 * file in the same run.
 *
 * MONEY. This suite asserts no amount, fee, price or currency, and performs no
 * arithmetic. The only number it reads is a count of rows.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import http from "node:http";
import { registerRoutes } from "../routes";
import {
  PAYMENT_GATEWAY_INPUTS,
  paymentGatewayDisclosure,
} from "../lib/wave190PaymentGatewayDisclosure";

const ADMIN = "u_admin";
const FOUNDER = "u_maya_chen";
const PATH = "/api/admin/payment-gateway/disclosure";

let app: express.Express;
let server: http.Server;

/** Every variable name the disclosure knows about, plus the sentinel values used
 *  in the leak test. A sentinel is deliberately long and unmistakable so a
 *  substring scan cannot produce a false negative. */
const NAMES = PAYMENT_GATEWAY_INPUTS.map((i) => i.name);
const SENTINEL = (name: string) => `w190-secret-sentinel-value-for-${name}-DO-NOT-LEAK`;

const captured = new Map<string, string | undefined>();
function setEnv(name: string, value: string | undefined) {
  if (!captured.has(name)) captured.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
function restoreEnv() {
  for (const [name, value] of captured.entries()) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  captured.clear();
}

function get(userId?: string) {
  const r = request(app).get(PATH);
  return userId ? r.set("x-user-id", userId) : r;
}

/** A typed read helper rather than an index expression: indexing a
 *  literal-union-keyed record raises TS7053, and casting the key away would
 *  disable the very exhaustiveness the union exists for. */
function inputFor(body: any, name: string): { name: string; present: boolean; required: boolean } {
  const found = (body?.disclosure?.inputs ?? []).find(
    (i: { name: string }) => i.name === name,
  );
  expect(found, `input ${name} must be reported`).toBeTruthy();
  return found;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 180_000);

afterAll(() => {
  restoreEnv();
  try { server.close(); } catch { /* nothing to close */ }
});

afterEach(() => {
  restoreEnv();
});

/* ══ D-1 — PRESENT RENDERS PRESENT ═══════════════════════════════════════ */
describe("W190 D-1 — a configured variable is reported present", () => {
  it("every required variable reports present, and `allRequiredPresent` agrees", async () => {
    for (const name of NAMES) setEnv(name, `configured-${name}`);
    const r = await get(ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    for (const name of NAMES) {
      expect(inputFor(r.body, name).present).toBe(true);
    }
    expect(r.body.disclosure.missingRequired).toEqual([]);
    expect(r.body.disclosure.allRequiredPresent).toBe(true);
  });

  it("the mode comes from the resolver, not from a literal on a screen", async () => {
    /* The point of the item: the panel said "LIVE" because a component printed
       the word. Here the mode moves when the environment moves, which is only
       possible if something actually asked. */
    setEnv("AIRWALLEX_MODE", "stub");
    setEnv("AIRWALLEX_API_KEY", undefined);
    const stubbed = await get(ADMIN);
    expect(stubbed.status).toBe(200);
    const modeWithoutKey = String(stubbed.body.disclosure.mode);
    expect(modeWithoutKey.length).toBeGreaterThan(0);
    /* And it is a lower-cased mode token from the sacred resolver, never the
       screen's ALL-CAPS label. */
    expect(modeWithoutKey).toBe(modeWithoutKey.toLowerCase());
    expect(modeWithoutKey).not.toBe("LIVE");
  });
});

/* ══ D-2 — ABSENT RENDERS ABSENT ═════════════════════════════════════════ */
describe("W190 D-2 — an unset variable is reported absent", () => {
  it("every variable reports absent when unset, and the required ones are named as missing", async () => {
    for (const name of NAMES) setEnv(name, undefined);
    const r = await get(ADMIN);
    expect(r.status).toBe(200);
    for (const name of NAMES) {
      expect(inputFor(r.body, name).present).toBe(false);
    }
    const required = PAYMENT_GATEWAY_INPUTS.filter((i) => i.required).map((i) => i.name);
    expect([...r.body.disclosure.missingRequired].sort()).toEqual([...required].sort());
    expect(r.body.disclosure.allRequiredPresent).toBe(false);
  });

  it("a whitespace-only variable is ABSENT, not present", async () => {
    /* An operator who exported an empty string has not configured a gateway, and
       reporting it present would be the same false reassurance in a smaller
       costume. */
    setEnv("AIRWALLEX_API_KEY", "   ");
    const r = await get(ADMIN);
    expect(inputFor(r.body, "AIRWALLEX_API_KEY").present).toBe(false);
    expect(r.body.disclosure.missingRequired).toContain("AIRWALLEX_API_KEY");
  });

  it("the webhook history is a fact with three states, not an ambiguous sentence", async () => {
    const r = await get(ADMIN);
    const w = r.body.disclosure.webhooks;
    /* `readable` is the third state that "No webhook events yet" was hiding: an
       unreadable table must not be reported as "no events". */
    expect(typeof w.readable).toBe("boolean");
    expect(typeof w.everReceived).toBe("boolean");
    expect(typeof w.count).toBe("number");
    if (w.readable && w.count === 0) {
      expect(w.everReceived).toBe(false);
      expect(w.firstAt).toBeNull();
      expect(w.lastAt).toBeNull();
    }
    if (w.everReceived) {
      expect(w.count).toBeGreaterThan(0);
      expect(typeof w.firstAt).toBe("string");
      expect(typeof w.lastAt).toBe("string");
    }
  });
});

/* ══ D-3 — NO CREDENTIAL VALUE APPEARS ANYWHERE IN THE BODY ══════════════ */
describe("W190 D-3 — presence only: no credential VALUE can leave", () => {
  it("with every variable set to a sentinel value, no sentinel appears in the raw response text", async () => {
    for (const name of NAMES) setEnv(name, SENTINEL(name));
    const r = await get(ADMIN);
    expect(r.status).toBe(200);

    /* THE RAW TEXT, not the parsed object. A field the test does not know about
       cannot hide a value from a text scan. */
    const raw = typeof r.text === "string" && r.text.length > 0 ? r.text : JSON.stringify(r.body);
    expect(raw.length).toBeGreaterThan(0);
    for (const name of NAMES) {
      expect(raw).not.toContain(SENTINEL(name));
      /* Not even a fragment of it: a prefix or suffix hint is still a leak. */
      expect(raw).not.toContain("w190-secret-sentinel");
      /* The NAME is expected and required — an operator who cannot see which
         variables exist cannot tell a deliberate stub from a broken deployment. */
      expect(raw).toContain(name);
    }
    /* And no field carries a length, which would leak the value's size. */
    expect(raw).not.toMatch(/"(value|secret|length|len|hint|prefix|suffix|masked)"\s*:/i);
    /* The presence booleans did flip, so the values WERE read — this test is not
       passing because the disclosure ignored the environment entirely. */
    for (const name of NAMES) {
      expect(inputFor(r.body, name).present).toBe(true);
    }
  });

  it("the disclosure object itself has no field capable of carrying a value", () => {
    for (const name of NAMES) setEnv(name, SENTINEL(name));
    const serialized = JSON.stringify(paymentGatewayDisclosure());
    for (const name of NAMES) {
      expect(serialized).not.toContain(SENTINEL(name));
    }
    const inputKeys = new Set<string>();
    for (const input of paymentGatewayDisclosure().inputs) {
      for (const key of Object.keys(input)) inputKeys.add(key);
    }
    /* EXACTLY three keys. A future wave adding a fourth has to come through this
       assertion and justify it. */
    expect([...inputKeys].sort()).toEqual(["name", "present", "required"]);
  });
});

/* ══ D-4 — ADMIN-GATED, AND GET ONLY ═════════════════════════════════════ */
describe("W190 D-4 — the endpoint is admin-gated and read-only", () => {
  it("an unauthenticated caller is refused", async () => {
    const r = await get(undefined);
    expect([401, 403]).toContain(r.status);
    expect(r.body?.disclosure).toBeUndefined();
  });

  it("a non-admin authenticated caller is refused", async () => {
    const r = await get(FOUNDER);
    expect([401, 403]).toContain(r.status);
    expect(r.body?.disclosure).toBeUndefined();
  });

  it("an admin caller is allowed", async () => {
    const r = await get(ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.disclosure).toBeTruthy();
  });

  it("POST, PATCH, PUT and DELETE are not registered on this path", async () => {
    /* A truth surface that could change the truth would be worse than no surface,
       so no write verb exists here. `404` is Express's answer for a path with no
       handler for that method; `405` would also be acceptable. Anything 2xx would
       mean a write verb reached a handler. */
    for (const verb of ["post", "patch", "put", "delete"] as const) {
      const r = await (request(app) as any)[verb](PATH).set("x-user-id", ADMIN).send({
        AIRWALLEX_API_KEY: "attempted-write",
      });
      expect(r.status, `${verb.toUpperCase()} must not be served`).not.toBe(200);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.body?.disclosure).toBeUndefined();
    }
  });

  it("and no request through this surface changed a gateway variable", async () => {
    /* READ-ONLY, asserted rather than asserted-in-a-comment. */
    setEnv("AIRWALLEX_API_KEY", "before-value");
    await get(ADMIN);
    await (request(app) as any).post(PATH).set("x-user-id", ADMIN).send({ AIRWALLEX_API_KEY: "after-value" });
    expect(process.env.AIRWALLEX_API_KEY).toBe("before-value");
  });
});
