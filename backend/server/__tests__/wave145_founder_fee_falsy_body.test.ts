/* ════════════════════════════════════════════════════════════════════════════
   WAVE 145 — THE FOUNDER ENDPOINT ANSWERS FALSY WHEN THE FEE IS ABSENT.
   THE ADMIN ENDPOINT KEEPS ITS DIAGNOSTIC SHAPE.        R109 · R108.2 · R95
   ════════════════════════════════════════════════════════════════════════════
   R109, in full force here:

     · FOUNDER  GET /api/collective/application-fee
         absent  -> 200 with a **FALSY** body (`null`). Not an object carrying a
                    null amount — that shape is what made the SACRED
                    client/src/pages/founder/Billing.tsx guard (`{appFeeData ? …
                    : "Not available …"}`) take the priced branch and render
                    "$0.00 USD" through `formatMinor`'s `(Number(minor) || 0)`.
         present -> 200 with the real figure, `source: "db"`, unchanged.
         NEVER a 503 (R108.2 — an unpublished price must not take the
         application funnel down).

     · ADMIN    GET /api/admin/collective/application-fee
         UNCHANGED. It keeps `amountMinor`, `currency`, `source` and provenance,
         because R108.2 requires the OPERATOR to see the condition. R109 item 2
         is explicit that the founder's page not carrying a diagnostic payload
         does not license removing the admin's.

   Real express app, real SQLite rows, real HTTP. Nothing here reads source text.
   The config row is captured and restored around every mutation and the final
   test asserts the table was left exactly as found.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port = 0;

type ConfigRow = {
  amount_minor: number | null;
  currency: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

const CONFIG_SQL = `SELECT amount_minor, currency, updated_at, updated_by
                      FROM collective_application_fee_config WHERE id = 'default'`;

function readConfig(): ConfigRow | undefined {
  return rawDb().prepare(CONFIG_SQL).get() as ConfigRow | undefined;
}
function deleteConfig(): void {
  rawDb().prepare(`DELETE FROM collective_application_fee_config WHERE id = 'default'`).run();
}
function writeConfig(r: ConfigRow): void {
  rawDb()
    .prepare(
      `INSERT INTO collective_application_fee_config (id, amount_minor, currency, updated_at, updated_by)
         VALUES ('default', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         amount_minor = excluded.amount_minor, currency = excluded.currency,
         updated_at   = excluded.updated_at,   updated_by = excluded.updated_by`,
    )
    .run(r.amount_minor, r.currency, r.updated_at ?? "2026-08-25 00:00:00", r.updated_by);
}

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    if (payload) headers["content-length"] = String(Buffer.byteLength(payload));
    const r = http.request({ hostname: "127.0.0.1", port, path: apiPath, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: any = undefined;
        try { body = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body, raw: buf });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let ORIGINAL: ConfigRow;

beforeAll(async () => {
  getDb();
  const found = readConfig();
  expect(found, "the test database must start with a config row").toBeTruthy();
  ORIGINAL = found as ConfigRow;
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
}, 60_000);

afterAll(async () => {
  writeConfig(ORIGINAL);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("WAVE 145 · G — the FOUNDER endpoint, fee ABSENT (R109 item 1)", () => {
  it("G1 THE RULING — the body is FALSY, so the sacred page's refusal branch executes", async () => {
    try {
      deleteConfig();
      const res = await call("GET", "/api/collective/application-fee");
      expect(res.status).toBe(200);
      expect(res.raw.trim()).toBe("null");
      expect(res.body).toBeNull();
      expect(res.body).toBeFalsy();
      /* The pre-R109 body was `{amountMinor:null,currency:null,source:"missing"}`
         — truthy, which is the whole defect. Pin that no object travels at all. */
      expect(res.raw).not.toContain("{");
    } finally {
      writeConfig(ORIGINAL);
    }
  });

  it("G2 it does NOT 503 — R108.2, the application funnel stays up", async () => {
    try {
      deleteConfig();
      const res = await call("GET", "/api/collective/application-fee");
      expect(res.status).toBe(200);
      expect(res.status).not.toBe(503);
      expect(res.status).not.toBe(404);
    } finally {
      writeConfig(ORIGINAL);
    }
  });

  it("G3 no figure and no diagnostic field reaches the founder wire", async () => {
    try {
      deleteConfig();
      const res = await call("GET", "/api/collective/application-fee");
      expect(res.raw).not.toContain("amountMinor");
      expect(res.raw).not.toContain("source");
      expect(res.raw).not.toContain("missing");
      expect(res.raw).not.toContain("30000");
      expect(res.raw).not.toContain("24000");
      expect(res.raw).not.toMatch(/\d/);
    } finally {
      writeConfig(ORIGINAL);
    }
  });

  it("G4 the UNREADABLE state is also falsy — a broken table is not a free fee either", async () => {
    /* `source: "unreadable"` is the other non-db state. It must reach the
       founder as absence, not as an object the guard treats as priced. */
    rawDb().exec(`ALTER TABLE collective_application_fee_config RENAME TO w145_hidden_cfg`);
    try {
      const res = await call("GET", "/api/collective/application-fee");
      expect(res.status).toBe(200);
      expect(res.body).toBeFalsy();
      expect(res.raw.trim()).toBe("null");
    } finally {
      rawDb().exec(`ALTER TABLE w145_hidden_cfg RENAME TO collective_application_fee_config`);
      writeConfig(ORIGINAL);
    }
  });
});

describe("WAVE 145 · H — the FOUNDER endpoint, fee PRESENT (the pole R109 must not break)", () => {
  it("H1 a published fee is served truthy, with the real figure in TRUE minor units", async () => {
    writeConfig(ORIGINAL);
    const res = await call("GET", "/api/collective/application-fee");
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(res.body.amountMinor).toBe(ORIGINAL.amount_minor);
    expect(typeof res.body.amountMinor).toBe("number");
    expect(res.body.source).toBe("db");
  });

  it("H2 an admin write flows through to a truthy founder body in ONE request", async () => {
    try {
      const put = await call("PUT", "/api/admin/collective/application-fee", {
        userId: "u_admin",
        body: { amountMinor: 41500 },
      });
      expect(put.status).toBe(200);
      const founder = await call("GET", "/api/collective/application-fee");
      expect(founder.body).toBeTruthy();
      expect(founder.body.amountMinor).toBe(41500);
      expect(founder.body.currency).toBe("USD");
      expect(founder.body.source).toBe("db");
    } finally {
      writeConfig(ORIGINAL);
    }
  });

  it("H3 absence is not cached — deleting then restoring the row flips both ways", async () => {
    try {
      deleteConfig();
      expect((await call("GET", "/api/collective/application-fee")).body).toBeFalsy();
      writeConfig(ORIGINAL);
      const back = await call("GET", "/api/collective/application-fee");
      expect(back.body).toBeTruthy();
      expect(back.body.amountMinor).toBe(ORIGINAL.amount_minor);
    } finally {
      writeConfig(ORIGINAL);
    }
  });
});

describe("WAVE 145 · I — the ADMIN endpoint is UNCHANGED (R109 item 2 / R108.2)", () => {
  it("I1 with the row published the admin still gets amountMinor, source and provenance", async () => {
    writeConfig(ORIGINAL);
    const res = await call("GET", "/api/admin/collective/application-fee", { userId: "u_admin" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toBeTruthy();
    expect(res.body.source).toBe("db");
    expect(res.body.amountMinor).toBe(ORIGINAL.amount_minor);
    expect(res.raw).toContain("source");
  });

  it("I2 with NO row the admin body is STILL AN OBJECT and still names the condition", async () => {
    /* This is the asymmetry R109 ordered: the founder gets falsy, the operator
       gets the diagnosis. If a later wave "tidies" the founder change into the
       resolver, this test goes red and says why. */
    try {
      deleteConfig();
      const res = await call("GET", "/api/admin/collective/application-fee", { userId: "u_admin" });
      expect(res.status).toBe(200);
      expect(res.body).toBeTruthy();
      expect(typeof res.body).toBe("object");
      expect(res.body.source).toBe("missing");
      expect(res.body.amountMinor).toBeNull();
      expect(res.body.currency).toBeNull();
      expect(res.body.updatedBy).toBeNull();
      expect(res.raw).toContain("source");
      expect(res.raw).not.toContain("30000"); /* still no fabricated figure */
    } finally {
      writeConfig(ORIGINAL);
    }
  });

  it("I3 THE TWO SURFACES DISAGREE ON SHAPE, DELIBERATELY, IN THE SAME DB STATE", async () => {
    try {
      deleteConfig();
      const founder = await call("GET", "/api/collective/application-fee");
      const admin = await call("GET", "/api/admin/collective/application-fee", { userId: "u_admin" });
      expect(founder.body).toBeFalsy();
      expect(admin.body).toBeTruthy();
      expect(admin.body.source).toBe("missing");
    } finally {
      writeConfig(ORIGINAL);
    }
  });

  it("I4 this file left the config table exactly as it found it", () => {
    expect(readConfig()).toEqual(ORIGINAL);
  });
});
