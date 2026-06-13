/**
 * Sprint 24 — Auth flow hardening tests.
 *
 * ≥ 14 assertions covering:
 *
 *  POST /api/auth/login (existing endpoint, exercising new client expectations)
 *    1.  Wrong password → 401
 *    2.  401 body has `message` field (client renders it inline)
 *    3.  Unknown email → 401
 *    4.  Valid email + password → 200 with ctx
 *    5.  200 response Set-Cookie includes cap_uid
 *    6.  Admin login returns ctx.isAdmin = true
 *
 *  POST /api/auth/signup (Sprint 24 hardening)
 *    7.  Investor portal → 403 with INVESTOR_SIGNUP_DISALLOWED
 *    8.  Missing email → 400 INVALID_EMAIL
 *    9.  Invalid email format → 400 INVALID_EMAIL
 *   10.  Short name → 400 INVALID_NAME
 *   11.  Short password → 400 WEAK_PASSWORD
 *   12.  Existing email (maya@novapay.ai) → 409 EMAIL_IN_USE with message
 *   13.  Valid new founder → 200 ok, sets cap_uid cookie
 *   14.  Valid new founder → ctx.founder.companies returned
 *
 *  POST /api/auth/forgot (unchanged but spot-checked)
 *   15.  Missing email → 400
 *   16.  Provided email → 200 with masked message
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";

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

type CallResponse = { status: number; body: unknown; headers: Record<string, string | string[]> };

function call(method: string, path: string, opts: { body?: unknown } = {}): Promise<CallResponse> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw), headers: res.headers as Record<string, string | string[]> });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: raw, headers: {} });
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/* --------------------------------------------------------------- */
/*  POST /api/auth/login                                            */
/* --------------------------------------------------------------- */
describe("POST /api/auth/login (Sprint 24)", () => {
  it("1. wrong password → 401", async () => {
    const r = await call("POST", "/api/auth/login", { body: { email: "maya@novapay.ai", password: "WRONG" } });
    expect(r.status).toBe(401);
  });

  it("2. 401 body includes a `message` field", async () => {
    const r = await call("POST", "/api/auth/login", { body: { email: "maya@novapay.ai", password: "" } });
    const body = r.body as { message?: string };
    expect(typeof body.message).toBe("string");
    expect(body.message!.length).toBeGreaterThan(0);
  });

  it("3. unknown email → 401", async () => {
    const r = await call("POST", "/api/auth/login", { body: { email: "nobody@example.com", password: "password123" } });
    expect(r.status).toBe(401);
  });

  it("4. valid email + password → 200 with ctx", async () => {
    const r = await call("POST", "/api/auth/login", { body: { email: "maya@novapay.ai", password: "password123" } });
    expect(r.status).toBe(200);
    const body = r.body as { ok: boolean; ctx: unknown };
    expect(body.ok).toBe(true);
    expect(body.ctx).toBeDefined();
  });

  it("5. 200 response sets cap_uid cookie", async () => {
    const r = await call("POST", "/api/auth/login", { body: { email: "maya@novapay.ai", password: "password123" } });
    const sc = r.headers["set-cookie"];
    const cookies = Array.isArray(sc) ? sc : sc ? [sc] : [];
    expect(cookies.some((c) => c.includes("cap_uid="))).toBe(true);
  });

  it("6. admin login → ctx.isAdmin true", async () => {
    const r = await call("POST", "/api/auth/login", { body: { email: "admin@capavate.io", password: "adminpass" } });
    expect(r.status).toBe(200);
    const body = r.body as { ctx: { isAdmin: boolean } };
    expect(body.ctx.isAdmin).toBe(true);
  });
});

/* --------------------------------------------------------------- */
/*  POST /api/auth/signup                                           */
/* --------------------------------------------------------------- */
describe("POST /api/auth/signup (Sprint 24)", () => {
  it("7. investor portal → 403 INVESTOR_SIGNUP_DISALLOWED", async () => {
    const r = await call("POST", "/api/auth/signup", {
      body: { portal: "investor", email: "new@example.com", name: "New Investor", password: "password123" },
    });
    expect(r.status).toBe(403);
    const body = r.body as { error: string };
    expect(body.error).toBe("INVESTOR_SIGNUP_DISALLOWED");
  });

  it("8. missing email → 400 INVALID_EMAIL", async () => {
    const r = await call("POST", "/api/auth/signup", {
      body: { portal: "founder", name: "New Founder", password: "password123" },
    });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe("INVALID_EMAIL");
  });

  it("9. invalid email format → 400 INVALID_EMAIL", async () => {
    const r = await call("POST", "/api/auth/signup", {
      body: { portal: "founder", email: "not-an-email", name: "New Founder", password: "password123" },
    });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe("INVALID_EMAIL");
  });

  it("10. short name → 400 INVALID_NAME", async () => {
    const r = await call("POST", "/api/auth/signup", {
      body: { portal: "founder", email: "new@example.com", name: "A", password: "password123" },
    });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe("INVALID_NAME");
  });

  it("11. short password → 400 WEAK_PASSWORD", async () => {
    const r = await call("POST", "/api/auth/signup", {
      body: { portal: "founder", email: "new@example.com", name: "New Founder", password: "short" },
    });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe("WEAK_PASSWORD");
  });

  it("12. existing email → 409 EMAIL_IN_USE with message", async () => {
    const r = await call("POST", "/api/auth/signup", {
      body: { portal: "founder", email: "maya@novapay.ai", name: "Someone Else", password: "password123" },
    });
    expect(r.status).toBe(409);
    const body = r.body as { error: string; message: string };
    expect(body.error).toBe("EMAIL_IN_USE");
    expect(typeof body.message).toBe("string");
  });

  it("13. valid new founder → 200 ok, sets cap_uid cookie", async () => {
    const r = await call("POST", "/api/auth/signup", {
      body: { portal: "founder", email: "fresh-founder@example.com", name: "Fresh Founder", password: "password123" },
    });
    expect(r.status).toBe(200);
    expect((r.body as { ok: boolean }).ok).toBe(true);
    const sc = r.headers["set-cookie"];
    const cookies = Array.isArray(sc) ? sc : sc ? [sc] : [];
    expect(cookies.some((c) => c.includes("cap_uid="))).toBe(true);
  });

  it("14. valid new founder → ctx.founder.companies returned", async () => {
    const r = await call("POST", "/api/auth/signup", {
      body: { portal: "founder", email: "another@example.com", name: "Another Founder", password: "password123" },
    });
    const body = r.body as { ctx: { founder: { companies: unknown[] } } };
    expect(Array.isArray(body.ctx.founder.companies)).toBe(true);
  });
});

/* --------------------------------------------------------------- */
/*  POST /api/auth/forgot                                           */
/* --------------------------------------------------------------- */
describe("POST /api/auth/forgot (Sprint 24 spot check)", () => {
  it("15. missing email → 400", async () => {
    const r = await call("POST", "/api/auth/forgot", { body: {} });
    expect(r.status).toBe(400);
  });

  it("16. provided email → 200 with message", async () => {
    const r = await call("POST", "/api/auth/forgot", { body: { email: "maya@novapay.ai" } });
    expect(r.status).toBe(200);
    expect(typeof (r.body as { message: string }).message).toBe("string");
  });
});
