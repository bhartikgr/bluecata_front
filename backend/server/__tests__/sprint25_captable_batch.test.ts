/**
 * Sprint 25 — Cap-table batch-commit + precision hardening.
 *
 * ≥ 12 assertions covering:
 *
 *  Direct store API:
 *    1.  enqueueFunded + getFundedQueue
 *    2.  clearFundedQueue
 *
 *  GET /api/founder/captable/funded-queue
 *    3.  Filters by roundId
 *    4.  Returns count
 *
 *  POST /api/founder/captable/commit-funded-batch
 *    5.  Missing companyId → 400 missing_required_fields
 *    6.  Missing roundId → 400 missing_required_fields
 *    7.  No funded entries waiting → 200 with committedCount: 0
 *    8.  Compliance hold blocks the batch → 409 compliance_hold_active
 *    9.  Valid batch commits all entries → 200 with committedCount = N
 *    10. After successful commit the queue is drained for that {companyId, roundId}
 *    11. After successful commit the ledger chain still verifies
 *    12. If one entry has malformed amount the WHOLE batch is rolled back → 409
 *    13. Rolled-back batch leaves ledger unchanged
 *    14. Rolled-back batch leaves funded queue unchanged
 *
 *  Legacy POST /api/founder/captable/commit-funded:
 *    15. Sprint 25 — string `amount` + `shares` are accepted
 *    16. Legacy `amountUsd: number` is coerced to string and rejected only if
 *        the resulting string is invalid (zero / NaN); positive numbers work.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import {
  enqueueFunded,
  getFundedQueue,
  clearFundedQueue,
  clearLedger,
  setComplianceHold,
  getLedger,
  verifyChain,
} from "../captableCommitStore";

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

beforeEach(() => {
  clearLedger();           // also clears funded queue per Sprint 25 patch
  setComplianceHold(false);
});

type CallResponse = { status: number; body: unknown };

function call(method: string, path: string, body?: unknown): Promise<CallResponse> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
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
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: raw });
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/* --------------------------------------------------------------- */
/*  Store API                                                       */
/* --------------------------------------------------------------- */
describe("Sprint 25 — funded queue store API", () => {
  it("1. enqueueFunded + getFundedQueue track entries", () => {
    enqueueFunded({
      invitationId: "in_1", roundId: "rnd_seed", companyId: "co_a", investorId: "u_a",
      amount: "100000", currency: "USD", shares: "5000",
    });
    expect(getFundedQueue().length).toBe(1);
    expect(getFundedQueue()[0].invitationId).toBe("in_1");
  });

  it("2. clearFundedQueue drains the queue", () => {
    enqueueFunded({
      invitationId: "in_1", roundId: "rnd_seed", companyId: "co_a", investorId: "u_a",
      amount: "100000", currency: "USD", shares: "5000",
    });
    clearFundedQueue();
    expect(getFundedQueue().length).toBe(0);
  });
});

/* --------------------------------------------------------------- */
/*  GET /api/founder/captable/funded-queue                          */
/* --------------------------------------------------------------- */
describe("GET /api/founder/captable/funded-queue", () => {
  it("3. filters by roundId", async () => {
    enqueueFunded({ invitationId: "in_1", roundId: "rnd_seed", companyId: "co_a", investorId: "u_a", amount: "100000", currency: "USD", shares: "5000" });
    enqueueFunded({ invitationId: "in_2", roundId: "rnd_series_a", companyId: "co_a", investorId: "u_b", amount: "500000", currency: "USD", shares: "25000" });
    const r = await call("GET", "/api/founder/captable/funded-queue?roundId=rnd_seed");
    const body = r.body as { entries: unknown[]; count: number };
    expect(body.count).toBe(1);
    expect(body.entries.length).toBe(1);
  });

  it("4. returns count field", async () => {
    enqueueFunded({ invitationId: "in_1", roundId: "rnd_seed", companyId: "co_a", investorId: "u_a", amount: "100000", currency: "USD", shares: "5000" });
    const r = await call("GET", "/api/founder/captable/funded-queue");
    expect((r.body as { count: number }).count).toBe(1);
  });
});

/* --------------------------------------------------------------- */
/*  POST /api/founder/captable/commit-funded-batch                  */
/* --------------------------------------------------------------- */
describe("POST /api/founder/captable/commit-funded-batch", () => {
  it("5. missing companyId → 400 missing_required_fields", async () => {
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", { roundId: "rnd_seed" });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe("missing_required_fields");
  });

  it("6. missing roundId → 400 missing_required_fields", async () => {
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", { companyId: "co_a" });
    expect(r.status).toBe(400);
  });

  it("7. no funded entries waiting → 200 with committedCount: 0", async () => {
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", { companyId: "co_a", roundId: "rnd_seed" });
    expect(r.status).toBe(200);
    expect((r.body as { committedCount: number }).committedCount).toBe(0);
  });

  it("8. compliance hold blocks the batch → 409 compliance_hold_active", async () => {
    enqueueFunded({ invitationId: "in_1", roundId: "rnd_seed", companyId: "co_a", investorId: "u_a", amount: "100000", currency: "USD", shares: "5000" });
    setComplianceHold(true);
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", { companyId: "co_a", roundId: "rnd_seed" });
    expect(r.status).toBe(409);
    expect((r.body as { error: string }).error).toBe("compliance_hold_active");
  });

  it("9. valid batch commits all matching entries → 200 with correct count", async () => {
    enqueueFunded({ invitationId: "in_1", roundId: "rnd_seed", companyId: "co_a", investorId: "u_a", amount: "100000", currency: "USD", shares: "5000" });
    enqueueFunded({ invitationId: "in_2", roundId: "rnd_seed", companyId: "co_a", investorId: "u_b", amount: "200000", currency: "USD", shares: "10000" });
    enqueueFunded({ invitationId: "in_3", roundId: "rnd_other", companyId: "co_a", investorId: "u_c", amount: "300000", currency: "USD", shares: "15000" });
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", { companyId: "co_a", roundId: "rnd_seed" });
    expect(r.status).toBe(200);
    expect((r.body as { committedCount: number }).committedCount).toBe(2);
  });

  it("10. after commit, funded queue is drained for that {companyId, roundId} only", async () => {
    enqueueFunded({ invitationId: "in_1", roundId: "rnd_seed", companyId: "co_a", investorId: "u_a", amount: "100000", currency: "USD", shares: "5000" });
    enqueueFunded({ invitationId: "in_2", roundId: "rnd_other", companyId: "co_a", investorId: "u_b", amount: "200000", currency: "USD", shares: "10000" });
    await call("POST", "/api/founder/captable/commit-funded-batch", { companyId: "co_a", roundId: "rnd_seed" });
    const remaining = getFundedQueue();
    expect(remaining.length).toBe(1);
    expect(remaining[0].invitationId).toBe("in_2");
  });

  it("11. after successful commit the ledger chain still verifies", async () => {
    enqueueFunded({ invitationId: "in_1", roundId: "rnd_seed", companyId: "co_a", investorId: "u_a", amount: "100000", currency: "USD", shares: "5000" });
    enqueueFunded({ invitationId: "in_2", roundId: "rnd_seed", companyId: "co_a", investorId: "u_b", amount: "200000", currency: "USD", shares: "10000" });
    await call("POST", "/api/founder/captable/commit-funded-batch", { companyId: "co_a", roundId: "rnd_seed" });
    expect(verifyChain().ok).toBe(true);
    expect(getLedger().length).toBe(2);
  });

  it("12. malformed amount in middle of batch → rolled back with 409", async () => {
    enqueueFunded({ invitationId: "in_1", roundId: "rnd_seed", companyId: "co_a", investorId: "u_a", amount: "100000", currency: "USD", shares: "5000" });
    enqueueFunded({ invitationId: "in_2", roundId: "rnd_seed", companyId: "co_a", investorId: "u_b", amount: "not-a-number", currency: "USD", shares: "10000" });
    enqueueFunded({ invitationId: "in_3", roundId: "rnd_seed", companyId: "co_a", investorId: "u_c", amount: "300000", currency: "USD", shares: "15000" });
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", { companyId: "co_a", roundId: "rnd_seed" });
    expect(r.status).toBe(409);
    const body = r.body as { error: string; failedAt: string; reason: string };
    expect(body.error).toBe("batch_failed");
    expect(body.failedAt).toBe("in_2");
    expect(body.reason).toBe("invalid_amount");
  });

  it("13. after rollback the ledger is unchanged (empty)", async () => {
    enqueueFunded({ invitationId: "in_1", roundId: "rnd_seed", companyId: "co_a", investorId: "u_a", amount: "100000", currency: "USD", shares: "5000" });
    enqueueFunded({ invitationId: "in_2", roundId: "rnd_seed", companyId: "co_a", investorId: "u_b", amount: "BAD", currency: "USD", shares: "10000" });
    await call("POST", "/api/founder/captable/commit-funded-batch", { companyId: "co_a", roundId: "rnd_seed" });
    expect(getLedger().length).toBe(0);
  });

  it("14. after rollback the funded queue is unchanged (entries still present)", async () => {
    enqueueFunded({ invitationId: "in_1", roundId: "rnd_seed", companyId: "co_a", investorId: "u_a", amount: "100000", currency: "USD", shares: "5000" });
    enqueueFunded({ invitationId: "in_2", roundId: "rnd_seed", companyId: "co_a", investorId: "u_b", amount: "BAD", currency: "USD", shares: "10000" });
    await call("POST", "/api/founder/captable/commit-funded-batch", { companyId: "co_a", roundId: "rnd_seed" });
    // The queue still contains both entries — none was consumed.
    const q = getFundedQueue();
    expect(q.length).toBe(2);
    expect(q.map((e) => e.invitationId).sort()).toEqual(["in_1", "in_2"]);
  });
});

/* --------------------------------------------------------------- */
/*  Legacy single-commit endpoint                                   */
/* --------------------------------------------------------------- */
describe("POST /api/founder/captable/commit-funded (Sprint 25 string-typed)", () => {
  it("15. Sprint 25 — string `amount` + `shares` accepted", async () => {
    const r = await call("POST", "/api/founder/captable/commit-funded", {
      invitationId: "in_1",
      roundId: "rnd_seed",
      companyId: "co_a",
      investorId: "u_a",
      amount: "100000",
      currency: "USD",
      shares: "5000",
      fromState: "funded",
    });
    expect(r.status).toBe(200);
    expect((r.body as { ok: boolean }).ok).toBe(true);
  });

  it("16. legacy `amountUsd: number` is coerced to string and works for positive values", async () => {
    const r = await call("POST", "/api/founder/captable/commit-funded", {
      invitationId: "in_legacy",
      roundId: "rnd_seed",
      companyId: "co_a",
      investorId: "u_a",
      amountUsd: 100000,
      shares: 5000,
      fromState: "funded",
    });
    expect(r.status).toBe(200);
  });
});
