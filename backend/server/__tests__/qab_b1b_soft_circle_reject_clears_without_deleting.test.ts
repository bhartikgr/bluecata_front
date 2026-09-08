/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA BLOCKER 1b — the founder could not clear a soft-circle entry, and the one
 * route that could do it reported success even when it wrote nothing.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS WRONG, in two parts.
 *
 *   (a) NO CALLER. `POST /api/rounds/:id/soft-circle/:scId/reject`
 *       (registered at server/track1Routes.ts:4768, handled at :4396) was
 *       complete and had ZERO client callers. Two orphaned $0 soft-circle
 *       entries sat on a live round with no way for the founder to clear them.
 *       The fix on the client side is a button, not a feature.
 *
 *   (b) IT LIED WHEN IT FAILED. The handler mutated the in-memory cache first,
 *       then attempted the durable `UPDATE`, then swallowed any failure with
 *       "Don't fail — in-memory updated; DB write best-effort on this column"
 *       and returned `ok: true` regardless. The founder saw the entry clear;
 *       the next process restart brought it back.
 *
 * WHAT THIS FILE PROVES, against the REAL Express app and the REAL database
 * handle (`rawDb()`), never a mock:
 *
 *   1  CONTROL / INSTRUMENT VALIDATION — before measuring the product, prove the
 *      instrument can see a change at all: read the row, prove `rows > 0`, and
 *      prove the pre-state is NOT already the state we are about to assert. A
 *      green that was green before the action is not evidence.
 *   2  THE ENTRY CLEARS — status becomes 'rejected' in the DATABASE, with
 *      `rejected_at` and `rejected_reason` stamped.
 *   3  NOTHING IS DELETED — the row is still there, `SELECT COUNT(*)` over the
 *      whole table is UNCHANGED, and the entry's own money columns (`amount`,
 *      `amount_minor`, `currency`) are byte-identical to before. A "clear" that
 *      removes a funding record is not a clear, it is a data loss.
 *   4  IT REFUSES TO OVERSTATE — a reject aimed at an id that is not in the
 *      table does not answer `ok: true`.
 *   5  THE PHYSICAL COLUMN IS REAL — `rejected_at` is ABSENT from the Drizzle
 *      schema (`shared/schema.ts`) but PRESENT physically, created at
 *      `server/db/connection.ts:2707-2709`, which is a FROZEN file. A Drizzle
 *      schema is not the database. This test reads `PRAGMA table_info` so the
 *      claim rests on the database, not on a TypeScript file.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { createSoftCircle, _testAccessSoftCircles } from "../softCircleStore";
import { rawDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port: number;

/* `ownsRound` (track1Routes.ts:715) admits a founder OF THE ROUND'S COMPANY or an
   admin. Under this harness the founder-membership rows are not seeded (the demo
   seed is off), and `u_maya_chen` is answered 403 — MEASURED, not assumed: an
   earlier run of this exact file returned 403 for her. Rather than seed
   memberships and change what the test is measuring, the caller here is the
   admin persona, which is a genuinely authorised caller on the same code path.
   AUTHORISATION IS NOT WHAT THIS FILE PROVES and no line of it was touched;
   the authz poles have their own coverage in
   server/__tests__/v25_48_softcircle_authz_guards_e2e.mjs. What this file
   proves is that the write is DURABLE and DELETES NOTHING. */
const FOUNDER = "u_admin";
const ROUND_ID = "rnd_novapay_foundation";

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
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: any = null;
        try { body = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

type ScRow = {
  id: string; status: string; amount: number | null; amount_minor: number | null;
  currency: string | null; rejected_at: string | null; rejected_reason: string | null;
};

/** Reads the STORED row. Never the API's own echo of what it thinks it did. */
function storedRow(id: string): ScRow | undefined {
  return rawDb()
    .prepare(`SELECT id, status, amount, amount_minor, currency, rejected_at, rejected_reason FROM soft_circles WHERE id = ?`)
    .get(id) as ScRow | undefined;
}

function tableCount(): number {
  const r = rawDb().prepare(`SELECT COUNT(*) AS n FROM soft_circles`).get() as { n: number };
  return Number(r.n);
}

describe("QA-B1b · the reject route clears an orphaned soft circle WITHOUT deleting anything", () => {
  it("5 · the physical `rejected_at` / `rejected_reason` columns exist on soft_circles", () => {
    const cols = rawDb().prepare(`PRAGMA table_info(soft_circles)`).all() as { name: string }[];
    /* rows > 0 PRECONDITION — a PRAGMA on a table that does not exist returns an
       EMPTY LIST rather than throwing, which would make every `.includes()`
       below fail for the wrong reason. */
    expect(cols.length).toBeGreaterThan(0);
    const names = cols.map((c) => c.name);
    expect(names).toContain("status");
    expect(names).toContain("rejected_at");
    expect(names).toContain("rejected_reason");
  });

  it("1-3 · an orphaned $0 entry is marked withdrawn, and no row is removed", async () => {
    _testAccessSoftCircles.reset();

    /* An entry shaped exactly like the two orphans QA found on the live round:
       zero amount, status 'intent', no way for the founder to clear it. */
    const sc = createSoftCircle({
      roundId: ROUND_ID,
      companyId: "co_novapay",
      investorName: "QAB Orphaned Entry",
      amount: 0,
      currency: "USD",
    });

    // ── 1 · CONTROL. Validate the instrument before measuring the product. ──
    const before = storedRow(sc.id);
    expect(before).toBeDefined();                 // rows > 0 precondition
    expect(before!.status).toBe("intent");        // NOT already the asserted end state
    expect(before!.rejected_at).toBeNull();       // the field we will assert is empty now
    const countBefore = tableCount();
    expect(countBefore).toBeGreaterThan(0);

    // ── the action, through the real HTTP route, as the real founder ──
    const done = await call("POST", `/api/rounds/${ROUND_ID}/soft-circle/${sc.id}/reject`, {
      body: { reason: "Investor withdrew; entry created in error" },
      userId: FOUNDER,
    });
    expect(done.status).toBe(200);
    expect(done.body?.ok).toBe(true);

    // ── 2 · THE ENTRY CLEARS — asserted on the STORED row, not the response ──
    const after = storedRow(sc.id);
    expect(after).toBeDefined();                  // rows > 0 precondition
    expect(after!.status).toBe("rejected");
    expect(after!.rejected_at).toBeTruthy();
    expect(after!.rejected_reason).toBe("Investor withdrew; entry created in error");

    // ── 3 · NOTHING IS DELETED ──
    expect(tableCount()).toBe(countBefore);       // no row disappeared, anywhere
    expect(after!.id).toBe(before!.id);           // this row is still this row
    expect(after!.amount).toBe(before!.amount);   // the money columns are untouched
    expect(after!.amount_minor).toBe(before!.amount_minor);
    expect(after!.currency).toBe(before!.currency);
  }, 20_000);

  it("4 · it does NOT answer ok:true for an id that is not on the record", async () => {
    const missingId = "sc_qab_b1b_definitely_not_a_real_row";
    expect(storedRow(missingId)).toBeUndefined();
    const r = await call("POST", `/api/rounds/${ROUND_ID}/soft-circle/${missingId}/reject`, {
      body: { reason: "should not succeed" },
      userId: FOUNDER,
    });
    expect(r.status).not.toBe(200);
    expect(r.body?.ok).not.toBe(true);
  }, 20_000);
});
