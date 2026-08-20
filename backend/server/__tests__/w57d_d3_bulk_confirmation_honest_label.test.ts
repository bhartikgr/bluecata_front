/**
 * WAVE 57d · D3 — `POST /api/admin/users/bulk` IS A TYPO GUARD, NOT TWO-PHASE.
 *
 * Wave 57c's report and code comments called the `confirmCount` echo a "two-phase
 * confirmation". Independent Review 1 found that false. This file REPRODUCES the
 * refutation over HTTP so the honest label cannot quietly drift back:
 *
 *   - a caller may satisfy the confirmation in its FIRST AND ONLY request, so
 *     there is no server-issued token, challenge, digest, nonce or server-side
 *     state binding the confirmation to a previously previewed set of ids;
 *   - the 409 refusal now SAYS SO on the wire
 *     (`confirmationModel: "count_echo_typo_guard"`), so the response, the code
 *     comment and the docs all agree.
 *
 * NOTHING IS DISABLED BY THIS WAVE'S RELABEL: the 409-then-confirm flow, the
 * `proposedChange` body, the 100 cap, the dedupe and the typed-id check all behave
 * exactly as they did in 57c. Only the description changed — plus the two new
 * response fields. Real two-phase (server-issued, payload-bound, single-use token)
 * is a design decision for the owner and is recorded as a recommendation, not
 * built here.
 *
 * MUTATION TRANSCRIPT: build_log/wave57d/W57D_TESTS.md (M3).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";

const ADMIN = "u_admin";
const TARGET = "u_w57d_d3_probe";

let app: Express;
let server: http.Server;

beforeAll(async () => {
  await seedDemoData(getDb());
  /* A disposable probe user, seeded the same way the 57c bulk test does, so the
     assertions act on a row this file owns rather than on demo data. */
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO auth_users (id, email, password_hash, role, status, created_at)
       VALUES (?, ?, 'x_not_a_real_hash', 'founder', 'active', ?)`,
    )
    .run(TARGET, `${TARGET}@probe.example`, new Date().toISOString());
  await hydrateMultiCompanyStore();
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  // Leave the fixture user active whatever the tests did.
  try {
    rawDb().prepare(`UPDATE auth_users SET status = 'active' WHERE id = ?`).run(TARGET);
  } catch { /* table may be absent in a degraded sandbox */ }
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("W57d D3 — the bulk confirmation is labelled honestly", () => {
  it("the 409 refusal names the confirmation model on the wire, not just in a comment", async () => {
    const r = await request(app)
      .post("/api/admin/users/bulk")
      .set("x-user-id", ADMIN)
      .send({ action: "suspend", ids: [TARGET] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("confirmation_required");
    expect(r.body.confirmationModel).toBe("count_echo_typo_guard");
    expect(String(r.body.confirmationModelNote)).toMatch(/not two-phase/i);
    // The 57c behaviour it describes is unchanged: the refusal still names the rows.
    expect(r.body.proposedChange).toMatchObject({ action: "suspend", count: 1 });
    expect(r.body.proposedChange.ids).toEqual([TARGET]);
    expect(String(r.body.message)).toContain('"confirmCount": 1');
  });

  it("REFUTATION: a matching confirmCount in the FIRST AND ONLY request applies — so this is not two-phase", async () => {
    rawDb().prepare(`UPDATE auth_users SET status = 'active' WHERE id = ?`).run(TARGET);
    /* One request. No prior 409, no preview, no token of any kind. If this
       returned 409 the control really would be two-phase; it returns 200. */
    const only = await request(app)
      .post("/api/admin/users/bulk")
      .set("x-user-id", ADMIN)
      .send({ action: "suspend", ids: [TARGET], confirmCount: 1 });
    expect(only.status).toBe(200);
    expect(only.body).toMatchObject({ ok: true, action: "suspend", count: 1, applied: 1 });
    const row = rawDb().prepare(`SELECT status FROM auth_users WHERE id = ?`).get(TARGET) as { status: string };
    expect(row.status).toBe("suspended");

    // Put it back, again in one request — the same refutation in the other direction.
    const back = await request(app)
      .post("/api/admin/users/bulk")
      .set("x-user-id", ADMIN)
      .send({ action: "unsuspend", ids: [TARGET], confirmCount: 1 });
    expect(back.status).toBe(200);
    expect((rawDb().prepare(`SELECT status FROM auth_users WHERE id = ?`).get(TARGET) as { status: string }).status)
      .toBe("active");
  });

  it("NOT DISABLED: a MISMATCHED count is still refused, and the typo guard still guards typos", async () => {
    const r = await request(app)
      .post("/api/admin/users/bulk")
      .set("x-user-id", ADMIN)
      .send({ action: "suspend", ids: [TARGET], confirmCount: 7 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("confirmation_required");
    expect(r.body.confirmationModel).toBe("count_echo_typo_guard");
    expect((rawDb().prepare(`SELECT status FROM auth_users WHERE id = ?`).get(TARGET) as { status: string }).status)
      .toBe("active");
  });

  it("the source of truth agrees with the wire: the handler no longer describes itself as two-phase", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "adminPlatformStore.ts"),
      "utf8",
    ) as string;
    const bulkBlock = src.slice(src.indexOf("WAVE 57c · ITEM 4"), src.indexOf('app.post("/api/admin/users/bulk"'));
    expect(bulkBlock).toMatch(/TYPO GUARD/);
    expect(bulkBlock).toMatch(/It is NOT\./);
    /* The only surviving mention of the old label must be the correction itself,
       which quotes it. A bare claim of two-phase confirmation must not return. */
    expect(bulkBlock).not.toMatch(/reusing the two-phase shape/);
  });
});
