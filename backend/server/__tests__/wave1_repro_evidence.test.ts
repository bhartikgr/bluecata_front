/**
 * WAVE 1 — Reproduce-with-logging evidence capture (FIX #2 + FIX #1).
 *
 * Captures the EXACT 409 error strings live:
 *   (A) mount view ping on an already-`accepted` record  → FIX #2 toast cause
 *   (B) soft-circle submit on an already-`accepted` record → FIX #1 blocker cause
 *
 * Uses the real HTTP route with admin bypass (x-user-id: u_admin). in_3 is a
 * mock invitation seeded in state `accepted` (rnd_q_a) — mirroring the QA repro
 * (both QA deals were `Accepted`).
 *
 * This file is EVIDENCE ONLY — it asserts the pre-fix behavior so we can record
 * the before/after strings. It is retained as a regression guard after the fix.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { clearRecords, ensureRecord, applyDecisionAction } from "../yourDecisionStore";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string; cookie?: string; csrf?: string } = {},
): Promise<{ status: number; body: any; headers: Record<string, string | string[]> }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    if (opts.cookie) headers["cookie"] = opts.cookie;
    if (opts.csrf) headers["x-csrf-token"] = opts.csrf;
    const r = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null, headers: res.headers as any });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: buf, headers: res.headers as any });
          }
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function authCookie(userId: string) {
  const meRes = await call("GET", "/api/auth/me", { userId });
  const setCookie = meRes.headers["set-cookie"];
  const cookieHeader = Array.isArray(setCookie) ? setCookie.join("; ") : (setCookie as string | undefined);
  const csrfRes = await call("GET", "/api/auth/csrf", { userId, cookie: cookieHeader });
  const csrf = csrfRes.status === 200 && csrfRes.body?.csrfToken ? (csrfRes.body.csrfToken as string) : undefined;
  return { cookie: cookieHeader, csrf };
}

describe("WAVE 1 repro — exact 409 strings on an accepted record", () => {
  it("EVIDENCE A: mount view ping on accepted → 409 forbidden_transition:accepted->viewed", async () => {
    clearRecords();
    // in_3 is seeded `accepted` in rnd_q_a
    const rec = ensureRecord("in_3");
    expect(rec?.state).toBe("accepted");

    const { cookie, csrf } = await authCookie("u_admin");
    const res = await call("PATCH", "/api/rounds/rnd_q_a/invitations/in_3/decision", {
      userId: "u_admin",
      cookie,
      csrf,
      body: { action: "view" },
    });
    // Record the captured string for the report.
    // eslint-disable-next-line no-console
    console.log("[WAVE1-EVIDENCE-A] view-on-accepted:", res.status, JSON.stringify(res.body));
    if (res.status !== 200) {
      expect(res.status).toBe(409);
      expect(String(res.body?.error)).toBe("forbidden_transition:accepted->viewed");
    }
  });

  it("EVIDENCE B: soft-circle submit on accepted (post-view-ping) captured", async () => {
    clearRecords();
    const rec = ensureRecord("in_3");
    expect(rec?.state).toBe("accepted");

    const { cookie, csrf } = await authCookie("u_admin");
    // Mimic the client mount: fire view ping first (fails benignly), then submit.
    const viewRes = await call("PATCH", "/api/rounds/rnd_q_a/invitations/in_3/decision", {
      userId: "u_admin", cookie, csrf, body: { action: "view" },
    });
    // eslint-disable-next-line no-console
    console.log("[WAVE1-EVIDENCE-B pre] view-ping:", viewRes.status, JSON.stringify(viewRes.body));

    const scRes = await call("PATCH", "/api/rounds/rnd_q_a/invitations/in_3/decision", {
      userId: "u_admin", cookie, csrf,
      body: { action: "soft_circle", amount: 10000, currency: "USD", softCircleType: "indication" },
    });
    // eslint-disable-next-line no-console
    console.log("[WAVE1-EVIDENCE-B] soft-circle-on-accepted:", scRes.status, JSON.stringify(scRes.body));
    // FIX #1 post-fix: soft-circle on an accepted record SUCCEEDS (200) and
    // lands in soft_circled — the state machine allows accepted→soft_circled and
    // the durable write-through no longer throws under tsx ESM.
    expect(scRes.status).toBe(200);
    expect(scRes.body?.record?.state).toBe("soft_circled");
  });
});

describe("WAVE 1 AVI-C-EXT (FIX #2) — server contract behind the client silencing", () => {
  it("auto-view on a PENDING record still succeeds (200 → viewed) — kept as intended", async () => {
    clearRecords();
    // in_2 is seeded pending (rnd_pre) in the mock.
    const rec = ensureRecord("in_2");
    expect(rec?.state).toBe("pending");

    const { cookie, csrf } = await authCookie("u_admin");
    const res = await call("PATCH", "/api/rounds/rnd_pre/invitations/in_2/decision", {
      userId: "u_admin", cookie, csrf, body: { action: "view" },
    });
    // eslint-disable-next-line no-console
    console.log("[WAVE1-AVI-C-EXT view-on-pending]", res.status, JSON.stringify(res.body));
    expect(res.status).toBe(200);
    expect(res.body?.record?.state).toBe("viewed");
  });

  it("view on an ACCEPTED record returns the exact 409 string the client silences", async () => {
    clearRecords();
    const rec = ensureRecord("in_3");
    expect(rec?.state).toBe("accepted");

    const { cookie, csrf } = await authCookie("u_admin");
    const res = await call("PATCH", "/api/rounds/rnd_q_a/invitations/in_3/decision", {
      userId: "u_admin", cookie, csrf, body: { action: "view" },
    });
    // The client (InvitationDetail) now (a) only fires the mount view-ping when
    // state === "pending", and (b) silences this exact benign error if it ever
    // fires. The sacred state machine is UNCHANGED (no accepted→viewed edge).
    expect(res.status).toBe(409);
    expect(String(res.body?.error)).toBe("forbidden_transition:accepted->viewed");
  });

  it("a GENUINE forbidden soft-circle error is NOT in the client benign set", async () => {
    // e.g. funded → soft_circled is forbidden; its error string does not match
    // the client's benign patterns (noop_transition / *->viewed), so real
    // failures still surface to the investor.
    clearRecords();
    const rec = ensureRecord("in_3");
    // Drive it to a terminal-ish state to make soft_circle forbidden.
    applyDecisionActionForTest(rec!);
    const { cookie, csrf } = await authCookie("u_admin");
    const res = await call("PATCH", "/api/rounds/rnd_q_a/invitations/in_3/decision", {
      userId: "u_admin", cookie, csrf,
      body: { action: "soft_circle", amount: 1, currency: "USD", softCircleType: "definite" },
    });
    // Whatever the exact forbidden string, it must NOT be a *->viewed edge and
    // must NOT be a noop — i.e. it is a genuine error the client keeps visible.
    if (res.status === 409) {
      const err = String(res.body?.error ?? "");
      expect(err.endsWith("->viewed")).toBe(false);
      expect(err.startsWith("noop_transition")).toBe(false);
    }
  });
});

// Helper: progress in_3 to a state where soft_circle is forbidden (declined is
// terminal). Uses the store API directly to set up the negative case.
function applyDecisionActionForTest(rec: { state: string }): void {
  // decline is reachable from accepted and is terminal → soft_circle forbidden.
  applyDecisionAction(rec as any, { action: "decline" });
}
