/* ════════════════════════════════════════════════════════════════════════════
   WAVE 142 (BATCH 1 · ITEM 2, data half) — REAL ROUTES, REAL ROWS.
   R108.2: report absence, AND DO NOT TAKE THE FOUNDER PAGE DOWN.
   ════════════════════════════════════════════════════════════════════════════
   These tests drive the REAL express app over a REAL SQLite database through
   HTTP, and assert the RESPONSE BODIES an admin and a founder actually receive.
   Nothing here reads source text.

   The pre-flight specified a 503 for the missing-row case. R108.2 OVERRULED that:
   a missing price must not hard-fail the founder application funnel. So the
   contract asserted here is: 200, no figure, a named absence state — and
   submission is separately gated in the client on `feeReady`.

   AMENDED BY WAVE 145 UNDER R98 / R109 (see the note above D2). The FOUNDER
   endpoint's absent-state pin moved from `{amountMinor: null, source: "missing"}`
   to a FALSY body, because that truthy object defeated the SACRED founder Billing
   guard and rendered "$0.00 USD". THE ADMIN-SIDE (E-group) ASSERTIONS ARE
   UNCHANGED and still pass unchanged — R108.2 requires the operator to see the
   condition.

   The config row is captured before and restored after every mutation, so this
   file leaves the test database exactly as it found it (asserted in the final
   test).
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port: number;

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
         amount_minor = excluded.amount_minor,
         currency     = excluded.currency,
         updated_at   = excluded.updated_at,
         updated_by   = excluded.updated_by`,
    )
    .run(r.amount_minor, r.currency, r.updated_at, r.updated_by);
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
        let body: any = null;
        try { body = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body, raw: buf });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

/** The row as this file found it — restored after every mutating test. */
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
}, 30_000);

afterAll(async () => {
  writeConfig(ORIGINAL);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("WAVE 142 · C — the founder endpoint with the fee ON RECORD (the pole)", () => {
  it("C1 a published fee is still served unchanged, in true minor units, source 'db'", async () => {
    writeConfig(ORIGINAL);
    const res = await call("GET", "/api/collective/application-fee");
    expect(res.status).toBe(200);
    expect(res.body.amountMinor).toBe(ORIGINAL.amount_minor);
    expect(res.body.source).toBe("db");
    expect(typeof res.body.amountMinor).toBe("number");
  });
});

describe("WAVE 142 · D — the founder endpoint with NO ROW", () => {
  it("D1 THE RULING — it answers 200, not 503, so the application page still renders", async () => {
    try {
      deleteConfig();
      const res = await call("GET", "/api/collective/application-fee");
      expect(res.status).toBe(200);
      expect(res.status).not.toBe(503);
    } finally {
      writeConfig(ORIGINAL);
    }
  });

  /* ═══ UPDATED BY WAVE 145 UNDER **R98** — THIS PIN WAS STALE, AND DANGEROUS ═══
     As written for wave 142 this case pinned `{amountMinor: null, source:
     "missing"}` on the FOUNDER endpoint. **RULING R109 deliberately removed that
     shape from this surface.** The object was TRUTHY, so the SACRED
     `client/src/pages/founder/Billing.tsx` guard (`{appFeeData ? … : "Not
     available …"}`) took the priced branch and `formatMinor`'s `(Number(minor) ||
     0)` rendered **"$0.00 USD"** — the founder was told their application fee was
     zero. R109 makes the founder-facing body FALSY (`null`) so that file's
     already-correct refusal branch runs; the ADMIN endpoint keeps the diagnostic
     shape (R108.2), and the E-group assertions below are UNCHANGED.

     Per R98 the pin is updated to the new correct behaviour rather than the code
     reverted, the ruling is named here, and the assertion count is NOT reduced:
     8 → 11. The absence-is-named assertions moved to the admin side, where R108.2
     actually requires them and where E2 already pins them. */
  it("D2 THE REPRODUCTION (R109) — the founder body is FALSY and carries NO figure at all", async () => {
    try {
      deleteConfig();
      const res = await call("GET", "/api/collective/application-fee");
      expect(res.status).toBe(200);
      expect(res.body).toBeFalsy();
      expect(res.body).toBeNull();
      expect(res.raw.trim()).toBe("null");
      /* Not an object at all — an object is what defeated the sacred guard. */
      expect(res.raw).not.toContain("{");
      expect(res.raw).not.toContain("amountMinor");
      expect(res.raw).not.toContain("source");
      /* Before wave 142 the same request returned 30000 with source "default" —
         a price that was on record NOWHERE. Assert on the wire text so no nested
         field can smuggle a figure back in. */
      expect(res.raw).not.toContain("30000");
      expect(res.raw).not.toContain("24000");
      expect(res.raw).not.toContain("default");
      expect(res.raw).not.toMatch(/\d/);
    } finally {
      writeConfig(ORIGINAL);
    }
  });

  it("D3 restoring the row restores the price in ONE request — nothing caches the absence", async () => {
    try {
      deleteConfig();
      const gone = await call("GET", "/api/collective/application-fee");
      /* WAVE 145 · R109 — was `gone.body.source === "missing"`; the founder body
         is now falsy. The named absence state is still pinned, on the ADMIN
         endpoint, by E2 below (unchanged). */
      expect(gone.body).toBeFalsy();
      expect(gone.raw.trim()).toBe("null");
      writeConfig(ORIGINAL);
      const back = await call("GET", "/api/collective/application-fee");
      expect(back.body.source).toBe("db");
      expect(back.body.amountMinor).toBe(ORIGINAL.amount_minor);
    } finally {
      writeConfig(ORIGINAL);
    }
  });
});

describe("WAVE 142 · E — the ADMIN sees `source` (R108.2 item 1)", () => {
  it("E1 the admin read carries source 'db' and the row's provenance when published", async () => {
    writeConfig(ORIGINAL);
    const res = await call("GET", "/api/admin/collective/application-fee", { userId: "u_admin" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe("db");
    expect(res.body.amountMinor).toBe(ORIGINAL.amount_minor);
  });

  it("E2 with no row, the admin read says 'missing' and states no amount", async () => {
    try {
      deleteConfig();
      const res = await call("GET", "/api/admin/collective/application-fee", { userId: "u_admin" });
      expect(res.status).toBe(200);
      expect(res.body.source).toBe("missing");
      expect(res.body.amountMinor).toBeNull();
      expect(res.body.updatedBy).toBeNull();
      expect(res.raw).not.toContain("30000");
    } finally {
      writeConfig(ORIGINAL);
    }
  });

  it("E3 the admin PUT still works when there is NO prior row (the null-currency path)", async () => {
    /* `prev.currency` is NULL in the absent state; before this wave it was always
       a string. The first write after an absence must not crash or write a null
       denomination. */
    try {
      deleteConfig();
      const put = await call("PUT", "/api/admin/collective/application-fee", {
        userId: "u_admin",
        body: { amountMinor: 41500 },
      });
      expect(put.status).toBe(200);
      expect(put.body.amountMinor).toBe(41500);
      expect(put.body.currency).toBe("USD");
      const founder = await call("GET", "/api/collective/application-fee");
      expect(founder.body.amountMinor).toBe(41500);
      expect(founder.body.source).toBe("db");
    } finally {
      writeConfig(ORIGINAL);
    }
  });
});

describe("WAVE 142 · F — what this wave deliberately did NOT change", () => {
  it("F1 the platform-fees mirror is STILL WIRED — R108.3 deferred retiring either table", async () => {
    /* wave131_one_pricing_console.test.ts byte-pins the updateApplicationFee call
       and v25_47_blocker4 covers this path. If a later wave deletes the mirror
       without repointing the resolver, this test fails and says why. */
    try {
      const put = await call("PUT", "/api/admin/platform-fees/collective_application_fee", {
        userId: "u_admin",
        body: { amountMinor: 41500 },
      });
      expect(put.status).toBe(200);
      /* The mirror carried the SAME integer into the config table (unscaled — a
         ÷100 here would write 415 and quote a founder $4.15). */
      expect(readConfig()?.amount_minor).toBe(41500);
      /* And the founder-facing read moves within ONE request. */
      const founder = await call("GET", "/api/collective/application-fee");
      expect(founder.body.amountMinor).toBe(41500);
    } finally {
      writeConfig(ORIGINAL);
    }
  });

  it("F2 this file left the database exactly as it found it", () => {
    expect(readConfig()).toEqual(ORIGINAL);
  });
});
