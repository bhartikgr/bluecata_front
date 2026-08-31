/**
 * WAVE 192 · ITEM A · R164 — MAKE THE UNKNOWABLE KNOWABLE, AND LEAK NOTHING
 * DOING IT.
 *
 * THE DEFECT CLASS THIS TEST FENCES. Three near-misses in one week shared one
 * shape: a safety-critical state with no surface that states it.
 *   1. The audit ledger had written nothing for three months and nothing said so.
 *   2. The payment gateway was reported unset FOUR times because the reporter
 *      read `bridgeEnvOk` from `/api/healthz`, which contains no Airwallex field
 *      at all.
 *   3. Whether the dev identity bypass is off rests entirely on
 *      `server/lib/userContext.ts:537-539` —
 *        `if (isProd || bypassDisabled) return null;`
 *      where `isProd` is `process.env.NODE_ENV === "production"`. The entire
 *      protection is one environment variable and NOTHING on the platform stated
 *      whether it was set.
 *
 * WHY THIS TEST IS AT THE HTTP LAYER (R137). Every claim here is about a RESPONSE
 * BODY: what it says, and — the assertion this item lives or dies on — what it
 * must never contain. A unit test of `platformTruth()` would not prove what the
 * route serialises, and the serialised body is what leaves the process.
 *
 * ══ THE ASSERTION THIS ITEM LIVES OR DIES ON ══
 * §A-4 sets every credential-bearing variable the truth surface touches to a
 * distinctive sentinel VALUE and asserts that no sentinel appears ANYWHERE in the
 * raw response text of BOTH endpoints — not in a field, not in a length, not as a
 * prefix, not in an error, not in a key. It scans the raw body STRING rather than
 * walking the typed object on purpose, exactly as wave 190's suite does: a future
 * field that leaked a value would be caught by a text scan and missed by a walk of
 * the fields the test happened to know about.
 *
 * NO AUTH BEHAVIOUR IS EXERCISED OR CHANGED. This suite reads a report. It never
 * asserts that a bypass grants or denies access, because Item A did not touch the
 * bypass — it only states whether the bypass is on.
 *
 * ENVIRONMENT DISCIPLINE. Every variable set here is captured and restored, so this
 * file cannot leave `NODE_ENV` or `DISABLE_DEV_BYPASS` altered for another test file
 * in the same run. `NODE_ENV` is restored in `afterEach` as well as `afterAll`.
 *
 * MONEY. This suite asserts no amount, fee, price or currency, and performs no
 * arithmetic. The only numbers it reads are counts and a boolean-derived state.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import http from "node:http";
import { registerRoutes } from "../routes";
import {
  WAVE192_PRESENCE_ONLY_STANDARD,
  WAVE192_BYPASS_ALARM_STATEMENT,
  WAVE192_BYPASS_ACTIVE_DEV_STATEMENT,
  WAVE192_BYPASS_OFF_STATEMENT,
} from "../lib/wave192PlatformTruthSurface";
import { PAYMENT_GATEWAY_INPUTS } from "../lib/wave190PaymentGatewayDisclosure";

const ADMIN = "u_admin";
const FOUNDER = "u_maya_chen";
const TRUTH = "/api/admin/platform-truth";
const HEALTHZ = "/api/healthz";

let app: express.Express;
let server: http.Server;

/* ── environment discipline ──────────────────────────────────────────────── */
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

function getTruth(userId?: string) {
  const r = request(app).get(TRUTH);
  return userId ? r.set("x-user-id", userId) : r;
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

/* ══ A-1 — THE SURFACE EXISTS AND IS ADMIN-ONLY ══════════════════════════════ */
describe("W192 A-1 — the truth surface answers, and only to an admin", () => {
  it("an admin gets a 200 carrying every state the wave was asked to report", async () => {
    const r = await getTruth(ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const t = r.body.truth;
    expect(t, "the response must carry a `truth` object").toBeTruthy();
    /* All four states R164 named, each present as a state and not as a value. */
    expect(typeof t.devIdentityBypass.active).toBe("boolean");
    expect(typeof t.devIdentityBypass.disableDevBypassSet).toBe("boolean");
    expect(typeof t.devIdentityBypass.alarm).toBe("boolean");
    expect("auditLedger" in t, "audit-write health must be reported").toBe(true);
    expect("paymentGateway" in t, "payment-gateway presence must be reported").toBe(true);
    expect(typeof t.generatedAt).toBe("string");
  });

  it("a non-admin cannot read it", async () => {
    const r = await getTruth(FOUNDER);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it("carries the presence-only standard verbatim, byte for byte", async () => {
    const r = await getTruth(ADMIN);
    expect(r.body.truth.presenceOnlyStandard).toBe(WAVE192_PRESENCE_ONLY_STANDARD);
    /* The standard the platform already uses, asserted as a literal here so a
       reworded constant cannot silently pass. */
    expect(WAVE192_PRESENCE_ONLY_STANDARD).toBe(
      "Presence only — credential values are never returned by the API or rendered here.",
    );
  });
});

/* ══ A-2 — THE BYPASS FIELD IS CORRECT FOR BOTH VALUES OF NODE_ENV ═══════════
   The owner asked specifically for this: "a test asserts the bypass field is
   present and correct when NODE_ENV is and is not 'production'". Each case is
   asserted against the real condition in `userContext.ts`, restated here so the
   test would fail if the reported state stopped tracking the code:
     bypass is REACHABLE  ⟺  NODE_ENV !== "production" AND DISABLE_DEV_BYPASS !== "1"
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W192 A-2 — the bypass state tracks NODE_ENV and DISABLE_DEV_BYPASS", () => {
  it("NODE_ENV=production, DISABLE_DEV_BYPASS unset → bypass OFF, no alarm", async () => {
    setEnv("NODE_ENV", "production");
    setEnv("DISABLE_DEV_BYPASS", undefined);
    const t = (await getTruth(ADMIN)).body.truth;
    expect(t.nodeEnvState).toBe("production");
    expect(t.devIdentityBypass.nodeEnvIsProduction).toBe(true);
    expect(t.devIdentityBypass.active).toBe(false);
    expect(t.devIdentityBypass.disableDevBypassSet).toBe(false);
    expect(t.devIdentityBypass.alarm).toBe(false);
    expect(t.devIdentityBypass.statement).toBe(WAVE192_BYPASS_OFF_STATEMENT);
  });

  /* ── WHY THE `DISABLE_DEV_BYPASS=1` CASES ARE ASSERTED ON `/api/healthz` ──────
     Setting `DISABLE_DEV_BYPASS=1` turns OFF the very bypass that resolves this
     suite's `x-user-id: u_admin` header to an admin identity, so the admin-only
     truth endpoint correctly stops answering — a 4xx, not a body. That is not a
     gap in the surface; it is INDEPENDENT CONFIRMATION of exactly the fact Item A
     exists to state: with the bypass off, an unauthenticated request resolves to
     no identity. The state is therefore asserted on the PUBLIC endpoint, which is
     also the endpoint the owner actually reads. */
  it("NODE_ENV=production AND DISABLE_DEV_BYPASS=1 → both reported, bypass OFF", async () => {
    setEnv("NODE_ENV", "production");
    setEnv("DISABLE_DEV_BYPASS", "1");
    const r = await request(app).get(HEALTHZ);
    expect(r.body.devIdentityBypassActive).toBe(false);
    /* Reported SEPARATELY from `active`. The owner's whole complaint is that one
       environment variable carried the entire protection and nothing said whether
       it was set — so whether it is set must be its own field, not folded into a
       single derived boolean. */
    expect(r.body.disableDevBypassSet).toBe(true);
    expect(r.body.devIdentityBypassAlarm).toBe(false);
    /* And the admin surface refuses, because the bypass it reports on is off. */
    const denied = await getTruth(ADMIN);
    expect(denied.status).toBeGreaterThanOrEqual(400);
  });

  it("NODE_ENV=development, DISABLE_DEV_BYPASS unset → bypass ACTIVE, no alarm", async () => {
    setEnv("NODE_ENV", "development");
    setEnv("DISABLE_DEV_BYPASS", undefined);
    const t = (await getTruth(ADMIN)).body.truth;
    expect(t.nodeEnvState).toBe("development");
    expect(t.devIdentityBypass.nodeEnvIsProduction).toBe(false);
    expect(t.devIdentityBypass.active).toBe(true);
    expect(t.devIdentityBypass.disableDevBypassSet).toBe(false);
    /* Active in development is the DESIGNED state, so it is not an alarm — but it
       is still stated, loudly enough to read. */
    expect(t.devIdentityBypass.alarm).toBe(false);
    expect(t.devIdentityBypass.statement).toBe(WAVE192_BYPASS_ACTIVE_DEV_STATEMENT);
  });

  /* Same reason as above: with the bypass off, the admin route has no identity to
     authorise, so the public endpoint is where this state is read. */
  it("NODE_ENV=development AND DISABLE_DEV_BYPASS=1 → bypass OFF", async () => {
    setEnv("NODE_ENV", "development");
    setEnv("DISABLE_DEV_BYPASS", "1");
    const r = await request(app).get(HEALTHZ);
    expect(r.body.devIdentityBypassActive).toBe(false);
    expect(r.body.disableDevBypassSet).toBe(true);
    expect(r.body.devIdentityBypassAlarm).toBe(false);
  });
});

/* ══ A-3 — THE ALARM CONDITION ══════════════════════════════════════════════
   The owner: "If the dev bypass is active, that must be loud — treat 'bypass
   active in a non-development environment' as an alarm condition, not a neutral
   field." An unset or unrecognised NODE_ENV is exactly that case: the bypass is
   reachable and nobody declared this a development box.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W192 A-3 — bypass active outside development is an ALARM", () => {
  it("NODE_ENV unset → bypass active, alarm TRUE, and the statement says so", async () => {
    setEnv("NODE_ENV", undefined);
    setEnv("DISABLE_DEV_BYPASS", undefined);
    const t = (await getTruth(ADMIN)).body.truth;
    expect(t.nodeEnvState).toBe("other_or_unset");
    expect(t.devIdentityBypass.active).toBe(true);
    expect(t.devIdentityBypass.alarm).toBe(true);
    expect(t.devIdentityBypass.statement).toBe(WAVE192_BYPASS_ALARM_STATEMENT);
    expect(t.anyAlarm).toBe(true);
  });

  it("NODE_ENV=staging → bypass active, alarm TRUE", async () => {
    setEnv("NODE_ENV", "staging");
    setEnv("DISABLE_DEV_BYPASS", undefined);
    const t = (await getTruth(ADMIN)).body.truth;
    expect(t.nodeEnvState).toBe("other_or_unset");
    expect(t.devIdentityBypass.active).toBe(true);
    expect(t.devIdentityBypass.alarm).toBe(true);
  });

  it("the alarm statement is a sentence a human reads, not a code", () => {
    /* R159.6 item 4 / the wave's standing rule: never an ALL-CAPS underscore code
       on a screen. Also short enough to survive the 240-character `looksHuman`
       gate in `client/src/lib/queryClient.ts`, and it must contain lowercase. */
    for (const s of [
      WAVE192_BYPASS_ALARM_STATEMENT,
      WAVE192_BYPASS_ACTIVE_DEV_STATEMENT,
      WAVE192_BYPASS_OFF_STATEMENT,
    ]) {
      expect(s.length).toBeGreaterThan(0);
      expect(/[a-z]/.test(s), `must read as prose: ${s}`).toBe(true);
      /* The two environment-variable NAMES are the exception and are stripped
         before the scan: naming the variable an operator must set is the whole
         point of the sentence. What is forbidden is a machine REFUSAL CODE
         standing in place of an explanation. */
      const prose = s.replace(/DISABLE_DEV_BYPASS/g, "x").replace(/NODE_ENV/g, "y");
      expect(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/.test(prose), `code-like token in: ${s}`)
        .toBe(false);
    }
  });
});

/* ══ A-4 — NO CREDENTIAL VALUE, ANYWHERE, ON EITHER ENDPOINT ════════════════
   THE ASSERTION THIS ITEM LIVES OR DIES ON. Raw-text scan, not a field walk.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W192 A-4 — not one credential value appears in either response body", () => {
  const SENTINEL = (name: string) => `w192-secret-sentinel-value-for-${name}-DO-NOT-LEAK`;
  /* Every credential-bearing variable the truth surface can touch: wave 190's
     gateway inputs plus the two environment variables Item A reports on. */
  const NAMES = [
    ...PAYMENT_GATEWAY_INPUTS.map((i) => i.name),
    "DISABLE_DEV_BYPASS",
    /* NODE_ENV is not a credential, but it IS an arbitrary caller-supplied string
       that the truth surface reads, and post-build review pass (a) asked the
       narrower question: can ANY raw environment string reach a response body?
       `nodeEnvState()` maps it onto a closed four-value enum and returns
       "other_or_unset" for anything unrecognised, so a sentinel here must vanish.
       Included so that a future edit which "helpfully" echoes the real value to
       make the unrecognised case precise fails this test instead of shipping. */
    "NODE_ENV",
  ];

  it("no sentinel appears in the platform-truth body", async () => {
    for (const name of NAMES) setEnv(name, SENTINEL(name));
    const r = await getTruth(ADMIN);
    expect(r.status).toBe(200);
    const raw = r.text ?? JSON.stringify(r.body);
    expect(raw.length).toBeGreaterThan(0);
    for (const name of NAMES) {
      expect(raw.includes(SENTINEL(name)), `LEAKED the value of ${name}`).toBe(false);
    }
    /* And no fragment of one either: a truncated or prefixed leak is still a leak. */
    expect(raw.includes("w192-secret-sentinel"), "LEAKED a sentinel fragment").toBe(false);
    expect(raw.includes("DO-NOT-LEAK"), "LEAKED a sentinel fragment").toBe(false);
  });

  it("no sentinel appears in the /api/healthz body either", async () => {
    for (const name of NAMES) setEnv(name, SENTINEL(name));
    const r = await request(app).get(HEALTHZ);
    const raw = r.text ?? JSON.stringify(r.body);
    expect(raw.length).toBeGreaterThan(0);
    for (const name of NAMES) {
      expect(raw.includes(SENTINEL(name)), `healthz LEAKED the value of ${name}`).toBe(false);
    }
    expect(raw.includes("w192-secret-sentinel")).toBe(false);
  });

  it("every reported field is a boolean, a state name, a count or a timestamp", async () => {
    for (const name of NAMES) setEnv(name, SENTINEL(name));
    const t = (await getTruth(ADMIN)).body.truth;
    /* The gateway inputs are the highest-risk shape, because each one is NAMED
       after a credential. Assert the shape has `present` and NOTHING value-like. */
    for (const i of t.paymentGateway?.inputs ?? []) {
      expect(typeof i.present).toBe("boolean");
      expect(typeof i.required).toBe("boolean");
      expect(Object.keys(i).sort()).toEqual(["name", "present", "required"]);
    }
    /* `missingRequired` is a list of NAMES. A name is not a value; assert none of
       the entries is a sentinel. */
    for (const n of t.paymentGateway?.missingRequired ?? []) {
      expect(n.includes("sentinel")).toBe(false);
    }
  });
});

/* ══ A-5 — HEALTHZ NOW STATES THE BYPASS, FOR BOTH VALUES OF NODE_ENV ═══════
   `/api/healthz` is where the owner looked four times and found no answer. The
   bypass booleans are added THERE as well as on the admin surface, because the
   place someone already looks is the place a fact has to be.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W192 A-5 — /api/healthz reports the bypass state", () => {
  it("reports bypass OFF when NODE_ENV is production", async () => {
    setEnv("NODE_ENV", "production");
    setEnv("DISABLE_DEV_BYPASS", undefined);
    const r = await request(app).get(HEALTHZ);
    expect(r.status).toBeLessThan(500);
    expect(r.body.devIdentityBypassActive).toBe(false);
    expect(r.body.disableDevBypassSet).toBe(false);
    expect(r.body.devIdentityBypassAlarm).toBe(false);
  });

  it("reports bypass ACTIVE when NODE_ENV is not production", async () => {
    setEnv("NODE_ENV", "development");
    setEnv("DISABLE_DEV_BYPASS", undefined);
    const r = await request(app).get(HEALTHZ);
    expect(r.body.devIdentityBypassActive).toBe(true);
    expect(r.body.disableDevBypassSet).toBe(false);
  });

  it("reports the alarm when the bypass is reachable outside development", async () => {
    setEnv("NODE_ENV", "staging");
    setEnv("DISABLE_DEV_BYPASS", undefined);
    const r = await request(app).get(HEALTHZ);
    expect(r.body.devIdentityBypassActive).toBe(true);
    expect(r.body.devIdentityBypassAlarm).toBe(true);
  });

  it("reports DISABLE_DEV_BYPASS as SET when it is set, as presence not value", async () => {
    setEnv("NODE_ENV", "development");
    setEnv("DISABLE_DEV_BYPASS", "1");
    const r = await request(app).get(HEALTHZ);
    expect(r.body.disableDevBypassSet).toBe(true);
    expect(r.body.devIdentityBypassActive).toBe(false);
    /* The VALUE "1" must not be echoed as the field. */
    expect(r.body.disableDevBypassSet).not.toBe("1");
  });
});

/* ══ A-6 — WAVES 186 AND 190 ARE REUSED, NOT REBUILT ════════════════════════
   The owner: "Reuse waves 186 and 190's existing functions rather than
   duplicating their logic." Proven by AGREEMENT: the truth surface and each
   original endpoint must report the same facts in the same process.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W192 A-6 — the truth surface agrees with waves 186 and 190", () => {
  it("payment-gateway presence matches wave 190's own disclosure endpoint", async () => {
    const truth = (await getTruth(ADMIN)).body.truth;
    const w190 = await request(app)
      .get("/api/admin/payment-gateway/disclosure")
      .set("x-user-id", ADMIN);
    expect(w190.status).toBe(200);
    expect(truth.paymentGateway).toBeTruthy();
    expect(truth.paymentGateway.gateway).toBe(w190.body.disclosure.gateway);
    expect(truth.paymentGateway.mode).toBe(w190.body.disclosure.mode);
    expect(truth.paymentGateway.allRequiredPresent).toBe(w190.body.disclosure.allRequiredPresent);
    expect(truth.paymentGateway.missingRequired).toEqual(w190.body.disclosure.missingRequired);
  });

  it("audit-write health matches wave 186's own endpoint", async () => {
    const truth = (await getTruth(ADMIN)).body.truth;
    const w186 = await request(app)
      .get("/api/admin/audit-write-health")
      .set("x-user-id", ADMIN);
    expect(w186.status).toBe(200);
    expect(truth.auditLedger).toBeTruthy();
    /* Compare the fields that are not time-derived; `newestRowAgeSeconds` advances
       between the two requests by design and comparing it would be a flake. */
    expect(truth.auditLedger.status).toBe(w186.body.health?.status ?? w186.body.status);
    expect(truth.auditLedger.newestRowAt).toBe(
      w186.body.health?.newestRowAt ?? w186.body.newestRowAt,
    );
  });
});
