/** WAVE 186 — EXPLORATORY PROBE (scratch). Drives the REAL routes the owner used
 *  on live and prints which of them produce an audit_log row. Not a deliverable
 *  assertion suite; the deliverable is w186_audit_write_gap_e2e.test.ts. */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import http from "node:http";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_ID } from "../partnerWorkspaceStore";
import { storeCredential } from "../userCredentialsStore";

const MANAGING = "u_avi_managing";
let app: express.Express;
let server: http.Server;

function rows(sinceId: number) {
  return rawDb()
    .prepare("SELECT id, tenant_id, actor_id, action, target, created_at FROM audit_log ORDER BY rowid")
    .all()
    .slice(sinceId) as Array<Record<string, string>>;
}
function count(): number {
  return (rawDb().prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  seedTestPartnerSandbox({ force: true });
  storeCredential({ userId: MANAGING, email: "w186.managing@test-partner.example", name: "Ada Managing Partner", password: "test-password-w186" });
}, 120_000);

describe("W186 probe", () => {
  it("prints audit rows produced by each real route", async () => {
    const trace: string[] = [];
    const mark = async (label: string, fn: () => Promise<{ status: number; body: any }>) => {
      const before = count();
      const r = await fn();
      const after = count();
      trace.push(`${label}: status=${r.status} auditRowsAdded=${after - before} ${after > before ? JSON.stringify(rows(before).map((x) => x.action)) : ""} ${r.status >= 400 ? JSON.stringify(r.body).slice(0, 300) : ""}`);
      return r;
    };

    // 1. Portfolio company (the co_<12hex> shape the owner created on live)
    const co = await mark("portfolio-company.create", async () =>
      request(app).post("/api/partner/me/portfolio-companies").set("x-user-id", MANAGING).send({
        companyName: "W186 Kestrel Probe", founderEmail: "w186.founder@example.com", founderName: "Fred Founder",
      }),
    );

    // 2. SPV create
    const spv = await mark("spv.create", async () =>
      request(app).post("/api/partner/me/spvs").set("x-user-id", MANAGING).send({
        spvName: "W186 Probe SPV", jurisdiction: "Delaware", vintage: 2026, currency: "USD", status: "open",
        targetSizeMinor: 100000000, signoffLegalName: "Ada Managing Partner", signoffAccepted: true,
      }),
    );
    const spvId = spv.body?.spv?.id;
    trace.push(`spvId=${spvId}`);

    if (spvId) {
      // 3. LP commit
      const c = await mark("lp-commit", async () =>
        request(app).post(`/api/partner/me/spv/${spvId}/lp-commit`).set("x-user-id", MANAGING).send({
          investorEmail: "w186.lp@example.com", holderFirstName: "Lena", holderLastName: "Pea",
          amount: "250000.00", currency: "USD",
        }),
      );
      trace.push(`lp-commit body=${JSON.stringify(c.body).slice(0, 500)}`);

      // 4. confirm funds
      await mark("confirm-funds", async () =>
        request(app).post(`/api/partner/me/spv/${spvId}/subscriptions/w186.lp@example.com/confirm-funds`).set("x-user-id", MANAGING).send({ receivedMinor: 25000000, reference: "W186REF" }),
      );
      // 5. close
      await mark("close", async () =>
        request(app).post(`/api/partner/me/spv/${spvId}/close`).set("x-user-id", MANAGING).send({ closeDate: "2026-08-28" }),
      );
      // 6. reopen
      await mark("reopen", async () =>
        request(app).post(`/api/partner/me/spv/${spvId}/reopen`).set("x-user-id", MANAGING).send({ rollingCloseWindowDays: 30 }),
      );
      // 7. lp-invites
      await mark("lp-invites", async () =>
        request(app).post(`/api/partner/me/spv/${spvId}/lp-invites`).set("x-user-id", MANAGING).send({ investorEmail: "w186.invitee@example.com" }),
      );
    }
    // eslint-disable-next-line no-console
    console.log("\n=== W186 PROBE TRACE ===\n" + trace.join("\n") + "\n=== END ===\n");
    expect(true).toBe(true);
  }, 180_000);
});
