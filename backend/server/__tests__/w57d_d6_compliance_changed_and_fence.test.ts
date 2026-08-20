/**
 * WAVE 57d · D6 — TWO SMALL CORRECTNESS FIXES FROM THE 57c REVIEWS.
 *
 * ── D6.1 — the legacy GLOBAL compliance-hold path logged an INVERTED `changed` ──
 * The per-tenant sacred handlers answer `{ok, tenantId, held}`. The LEGACY GLOBAL
 * path (`POST /api/admin/compliance-hold` with no `tenantId`) answers
 * `{ok:true, complianceHold, scope:"global"}` — no `held` key at all
 * (server/captableCommitStore.ts:1355-1358, SACRED: read, never edited). Wave 57c's
 * guard read only `held`, so on the global path it recorded `resultHeld: null` and
 * INVERTED `changed`: turning a global hold ON from OFF logged `changed:false`,
 * and re-setting an already-ON hold logged `changed:true`. Review 3 §1.1 found it.
 * Fixed IN THE GUARD (`server/lib/complianceHoldAuditGuard.ts`), never in the
 * sacred file.
 *
 * ── D6.2 — the destructive-store fence was trivially evadable ───────────────
 * Review 1 enumerated twelve ordinary JS/TS forms that walked past the detector.
 * The ones a syntactic check can catch are now caught (asserted below, one test
 * per form). The rest are DOCUMENTED as residual evasions R1-R6 in the fence's own
 * header, and the last test here asserts that documentation is still present —
 * because an undocumented incomplete gate is how "no production file can import
 * or call these" became a claim the code did not support.
 *
 * MUTATION TRANSCRIPT: build_log/wave57d/W57D_TESTS.md (M5, M6).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { scanSource, FENCED } from "../../scripts/lint/destructiveStoreFence";

const ADMIN = "u_admin";

let app: Express;
let server: http.Server;

function latestGlobalHoldAudit() {
  const rows = rawDb()
    .prepare(
      `SELECT actor_id AS actorId, action, payload_json AS payloadJson FROM audit_log
         WHERE target = 'platform:compliance_hold' ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .all() as Array<{ actorId: string | null; action: string; payloadJson: string | null }>;
  return rows[0] ? { ...rows[0], payload: JSON.parse(rows[0].payloadJson ?? "{}") } : undefined;
}

beforeAll(async () => {
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  /* A global hold blocks EVERY tenant's cap-table commits. Always leave it off. */
  try {
    await request(app).post("/api/admin/compliance-hold").set("x-user-id", ADMIN).send({ on: false });
  } catch { /* server may already be closing */ }
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("W57d D6.1 — the legacy GLOBAL compliance-hold audit records the truth", () => {
  it("turning the global hold ON from OFF records resultHeld:true and changed:true (57c logged changed:false here)", async () => {
    // Known starting point: OFF.
    const off = await request(app)
      .post("/api/admin/compliance-hold")
      .set("x-user-id", ADMIN)
      .send({ on: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ ok: true, scope: "global" });
    // The SACRED response really does use `complianceHold`, not `held` — this is
    // the premise of the whole fix, so it is asserted rather than assumed.
    expect(off.body.held).toBeUndefined();
    expect(off.body.complianceHold).toBe(false);

    const on = await request(app)
      .post("/api/admin/compliance-hold")
      .set("x-user-id", ADMIN)
      .send({ on: true, reason: "W57d D6.1 probe" });
    expect(on.status).toBe(200);
    expect(on.body.complianceHold).toBe(true);

    const audit = latestGlobalHoldAudit();
    expect(audit).toBeTruthy();
    expect(audit!.payload).toMatchObject({
      tenantId: null,
      priorHeld: false,
      resultHeld: true,
      changed: true,
    });
    expect(String(audit!.actorId)).toBe(ADMIN);
  });

  it("re-setting an ALREADY-ON global hold records changed:false (57c logged changed:true here)", async () => {
    const again = await request(app)
      .post("/api/admin/compliance-hold")
      .set("x-user-id", ADMIN)
      .send({ on: true, reason: "W57d D6.1 probe repeat" });
    expect(again.status).toBe(200);
    expect(again.body.complianceHold).toBe(true);

    const audit = latestGlobalHoldAudit();
    expect(audit!.payload).toMatchObject({ priorHeld: true, resultHeld: true, changed: false });
  });

  it("turning it back OFF records resultHeld:false and changed:true, and really releases it", async () => {
    const off = await request(app)
      .post("/api/admin/compliance-hold")
      .set("x-user-id", ADMIN)
      .send({ on: false });
    expect(off.status).toBe(200);
    expect(off.body.complianceHold).toBe(false);
    const audit = latestGlobalHoldAudit();
    expect(audit!.payload).toMatchObject({ priorHeld: true, resultHeld: false, changed: true });

    const read = await request(app).get("/api/admin/compliance-hold").set("x-user-id", ADMIN);
    expect(read.status).toBe(200);
    expect(read.body.global).toBe(false);
  });

  it("REGRESSION: the PER-TENANT path still records `held` exactly as 57c did (no behaviour traded away)", async () => {
    const TENANT = "tenant_w57d_d61_probe";
    const set = await request(app)
      .post("/api/admin/compliance-hold")
      .set("x-user-id", ADMIN)
      .send({ tenantId: TENANT, on: true, reason: "W57d D6.1 per-tenant control" });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ ok: true, tenantId: TENANT, held: true });

    const rel = await request(app)
      .delete(`/api/admin/compliance-hold/${TENANT}`)
      .set("x-user-id", ADMIN);
    expect(rel.status).toBe(200);
    expect(rel.body).toMatchObject({ ok: true, held: false });

    const rows = rawDb()
      .prepare(
        `SELECT payload_json AS payloadJson FROM audit_log
           WHERE target = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .all(`tenant:${TENANT}`) as Array<{ payloadJson: string | null }>;
    expect(JSON.parse(rows[0].payloadJson ?? "{}")).toMatchObject({
      tenantId: TENANT,
      priorHeld: true,
      resultHeld: false,
      changed: true,
    });
  });
});

describe("W57d D6.2 — the fence now catches the obfuscated forms Review 1 enumerated", () => {
  const kinds = (src: string) => scanSource("server/someNewRoute.ts", src).map((v) => `${v.kind}:${v.name}`);

  it("CommonJS require + destructuring with an alias is detected", () => {
    expect(kinds(`const { clearLedger: wipe } = require("./captableCommitStore");\nwipe();\n`))
      .toContain("destructure:clearLedger");
  });

  it("dynamic import + destructuring with an alias is detected", () => {
    expect(kinds(`export async function go(p: string) { const { clearFundedQueue: z } = await import(p); z(); }\n`))
      .toContain("destructure:clearFundedQueue");
  });

  it("computed element access by string literal is detected", () => {
    expect(kinds(`import * as store from "./captableCommitStore";\nstore["clearLedger"]();\n`))
      .toContain("string:clearLedger");
  });

  it("a bare property read used for indirection is detected", () => {
    expect(kinds(`import * as store from "./softCircleStore";\nconst wipe = store.deleteSoftCircle;\nwipe("x");\n`))
      .toContain("property:deleteSoftCircle");
  });

  it("an object literal holding the function under another key is detected", () => {
    expect(kinds(`import * as store from "./softCircleStore";\nconst ops = { wipe: store.deleteSoftCircle };\nops.wipe("x");\n`))
      .toContain("property:deleteSoftCircle");
  });

  it("a reflective lookup by name string is detected", () => {
    expect(kinds(`import * as store from "./captableCommitStore";\nReflect.get(store, "clearFundedQueue")();\n`))
      .toContain("string:clearFundedQueue");
  });

  it("the direct forms 57c already caught are still caught (no detector regression)", () => {
    for (const name of Object.keys(FENCED)) {
      expect(kinds(`import { ${name} } from "./x";\n`)).toContain(`import:${name}`);
    }
    expect(kinds(`export { clearLedger } from "./captableCommitStore";\n`)).toContain("import:clearLedger");
    expect(kinds(`import * as s from "./x";\ns.clearLedger();\n`)).toContain("call:clearLedger");
  });

  it("a COMMENT naming a fenced function still does not trip the fence (comments are not code)", () => {
    expect(scanSource("server/someNewRoute.ts", `/* never clearLedger() here; deleteSoftCircle either */\nexport const y = 2;\n`))
      .toEqual([]);
  });

  it("the residual evasions are DOCUMENTED in the fence's own header, honestly and by name", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "scripts", "lint", "destructiveStoreFence.ts"),
      "utf8",
    );
    /* If a future wave closes one of these, delete the line AND this assertion —
       do not leave the header claiming a hole that no longer exists, and never
       delete the assertion while the hole is still open. */
    expect(src).toMatch(/STILL OPEN — RESIDUAL EVASIONS/);
    for (const marker of ["R1.", "R2.", "R3.", "R4.", "R5.", "R6."]) {
      expect(src).toContain(marker);
    }
    expect(src).toMatch(/NOT sufficient protection/);
    /* The only place the old overclaim may appear is inside the sentence that
       attributes it to 57c and corrects it. It must never stand as a claim of
       this file's own coverage. */
    const overclaims = src.split("\n").filter((l) => /no production file can import/i.test(l));
    expect(overclaims).toHaveLength(1);
    expect(overclaims[0]).toMatch(/Wave 57c's report implied/);
  });
});
