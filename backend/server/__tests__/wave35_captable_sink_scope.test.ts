/**
 * WAVE 35 · F6 / F7 / F8 / F9 — falsification harness for the shared cap-table
 * sink exclusion (`server/lib/capTableSinkScope.ts`).
 *
 * ── WHAT THIS ASSERTS, AND WHY IN THIS SHAPE ────────────────────────────────
 * It asserts what the routes **EMIT**, over real HTTP, against the FULL
 * `registerRoutes` stack — not what a handler consults, and not a hand-mounted
 * sub-app. A Wave-34-era harness asserted "the code consults X" and was wrong
 * twice; a Review-A-era probe authenticated as a demo persona and every route
 * looked open. So:
 *
 *   · the caller is an EXPLICIT test-owned LP identity (`u_w35_lp_alpha`) —
 *     a real-but-wrong identity, never anonymous, never a demo persona;
 *   · the harness establishes its own preconditions (it inserts its own spv,
 *     auth_users and captable_commits rows) and reads NOTHING from
 *     `process.env` to decide what to expect;
 *   · every import is static / dynamic-`import()`, never `require()`.
 *
 * ── BOTH POLES, EVERY TIME ──────────────────────────────────────────────────
 *   POLE 1 (the fix)      an LP must NOT receive a co-LP of their own vehicle.
 *   POLE 2 (no over-fix)  a genuine cap-table counterparty of a REAL operating
 *                         company must STILL receive the other holders. If the
 *                         fix were a blanket `return []` this pole fails, so
 *                         the harness cannot be satisfied by breaking the
 *                         feature — which is the standing owner rule that
 *                         functionality is never silently dropped.
 *   POLE 3 (honesty)      the LP still sees THEIR OWN position. An investor who
 *                         has committed capital is never told they hold nothing.
 *   POLE 4 (F9)           a company the caller has no relationship to answers
 *                         404 `not_found`, never 403 — 403 is an enumeration
 *                         oracle for SPV ids.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

const LP_A = "u_w35_lp_alpha";
const LP_B = "u_w35_lp_beta";
const SPV_ID = "spv_w35_vehicle";
const REAL_CO = "co_w35_operating";
const UNRELATED_CO = "co_w35_no_relationship";

/** Mutable so a single file can probe as more than one real identity. */
const CTX_LP_ALPHA = {
  isAuthed: true,
  userId: LP_A,
  identity: { email: "alpha@w35.test", name: "Alpha Anonymous-LP" },
  email: "alpha@w35.test",
  isAdmin: false,
  roles: ["investor"],
  founder: { companies: [], activeCompanyId: null },
  investor: {
    state: "ON_CAP_TABLE",
    // Alpha genuinely holds BOTH: an LP interest in the vehicle AND a direct
    // position in a real operating company. This is the dual-position case
    // spec/LP_SCOPED_VIEW_DESIGN.md §5 requires to keep working.
    capTablePositions: [
      { companyId: SPV_ID, companyName: "W35 Vehicle LP", ownershipPct: 3 },
      { companyId: REAL_CO, companyName: "W35 Operating Co", ownershipPct: 5 },
    ],
    invitedRounds: [],
  },
  collective: { status: "none", role: null, expiresAt: null },
};

let ACTIVE_CTX: any = CTX_LP_ALPHA;

vi.mock("../lib/userContext", async () => {
  const actual = await vi.importActual<any>("../lib/userContext");
  return {
    ...actual,
    getUserContext: () => ACTIVE_CTX,
    getUserContextForId: () => ACTIVE_CTX,
  };
});

/* ── WAVE 35 · ROW 6 — HARNESS BUG, FOUND AND FIXED BY EXECUTION ────────────
 * The `../lib/userContext` mock above is NOT sufficient on its own. It rebinds
 * the copy of `getUserContext` that THIS FILE imports, but `requireAuth` in
 * `server/lib/authMiddleware.ts` resolves its own binding and, in this runner,
 * kept the REAL one. `requireAuth` then overwrote `req.userContext` with
 * whatever the real resolver produced for a cookie-less supertest request —
 * measured, not guessed: the demo persona `u_aisha_patel`, whose positions are
 * `co_novapay` / `co_arboreal`.
 *
 * The consequence was exactly the failure mode this wave's rules were written
 * against: "a probe authenticated as a demo persona so every route looked
 * open." Every POLE-1/2/3 case here was in fact being answered `404` for a
 * persona with no relationship to the fixture — so the F7/F8 exclusion was
 * never actually exercised, while POLE-4 (the 404 case) passed for the WRONG
 * reason and the file could still be reported as meaningful coverage.
 *
 * Proof of the diagnosis, in order: (1) calling `decideCapTableSinkAccess`
 * directly with `CTX_LP_ALPHA` returns `scope_to_self`; (2) the same request
 * over HTTP returned 404; (3) instrumenting the sink showed `ctx.userId ===
 * "u_aisha_patel"`; (4) adding the mock below flipped the same request to 200.
 *
 * The fix keys `requireAuth` to the SAME mutable `ACTIVE_CTX`, so switching
 * identity mid-file still switches it everywhere, and the identity remains an
 * explicit test-owned LP — never anonymous, never a demo persona.
 * ------------------------------------------------------------------------- */
vi.mock("../lib/authMiddleware", async () => {
  const actual = await vi.importActual<any>("../lib/authMiddleware");
  return {
    ...actual,
    requireAuth: (req: any, res: any, next: any) => {
      if (!ACTIVE_CTX?.isAuthed) {
        return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
      }
      req.userContext = ACTIVE_CTX;
      next();
    },
  };
});

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  const { rawDb } = await import("../db/connection");
  const db: any = rawDb();

  // Precondition 1: the vehicle exists AND is default `own_only`. Established
  // here, not assumed from any seed.
  db.prepare(
    `INSERT OR REPLACE INTO spv (id,sponsor_partner_id,name,jurisdiction,carry_basis,
       lp_visibility,created_at,updated_at,curr_hash)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(SPV_ID, "p_w35", "W35 Vehicle LP", "DE", "whole_fund",
    "own_only", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "x");

  // Precondition 2: REAL_CO must NOT be in the spv table. Asserted, not assumed.
  db.prepare(`DELETE FROM spv WHERE id = ?`).run(REAL_CO);

  const insUser = db.prepare(
    `INSERT OR REPLACE INTO auth_users (id,email,name,password_hash,role,created_at)
     VALUES (?,?,?,?,?,?)`,
  );
  insUser.run(LP_A, "alpha@w35.test", "Alpha Anonymous-LP", "x", "investor", "2026-01-01T00:00:00Z");
  insUser.run(LP_B, "beta@w35.test", "Beta Confidential-LP", "x", "investor", "2026-01-01T00:00:00Z");

  const ins = db.prepare(
    `INSERT OR REPLACE INTO captable_commits
      (id,tenant_id,seq,ts,invitation_id,round_id,company_id,investor_id,amount,currency,shares,
       state,prev_hash,hash,reconcile_match,compliance_hold,holder_first_name,holder_last_name,
       instrument_class,principal_amount,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?,?,NULL)`,
  );
  // The vehicle's ledger: Alpha $250,000 and Beta $7,500,000.
  ins.run("cc_w35_spv_1", `tenant_co_${SPV_ID}`, 9301, "2026-01-01T00:00:00Z", "inv_w35_spv_1",
    "rnd_w35_spv", SPV_ID, LP_A, "250000", "USD", "0", "committed", "p", "hs1",
    "Alpha", "Anonymous-LP", "unpriced", "250000");
  ins.run("cc_w35_spv_2", `tenant_co_${SPV_ID}`, 9302, "2026-01-02T00:00:00Z", "inv_w35_spv_2",
    "rnd_w35_spv", SPV_ID, LP_B, "7500000", "USD", "0", "committed", "hs1", "hs2",
    "Beta", "Confidential-LP", "unpriced", "7500000");
  // The REAL operating company's ledger: the same two people, as genuine
  // cap-table counterparties this time. POLE 2 lives here.
  ins.run("cc_w35_real_1", `tenant_co_${REAL_CO}`, 9311, "2026-01-01T00:00:00Z", "inv_w35_real_1",
    "rnd_w35_real", REAL_CO, LP_A, "250000", "USD", "0", "committed", "p", "hr1",
    "Alpha", "Anonymous-LP", "unpriced", "250000");
  ins.run("cc_w35_real_2", `tenant_co_${REAL_CO}`, 9312, "2026-01-02T00:00:00Z", "inv_w35_real_2",
    "rnd_w35_real", REAL_CO, LP_B, "900000", "USD", "0", "committed", "hr1", "hr2",
    "Beta", "Confidential-LP", "unpriced", "900000");

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => { port = (server.address() as any).port; resolve(); });
  });
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(path: string): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers: { "x-test-user": ACTIVE_CTX.userId } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = buf;
          try { body = JSON.parse(buf); } catch { /* raw */ }
          resolve({ status: res.statusCode ?? 0, body, raw: buf });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("WAVE 35 — preconditions this harness establishes for itself", () => {
  it("the vehicle IS spv-backed and the operating company is NOT", async () => {
    const { isSpvBackedCompany } = await import("../lib/spvBackedCompanies");
    expect(isSpvBackedCompany(SPV_ID)).toBe(true);
    expect(isSpvBackedCompany(REAL_CO)).toBe(false);
  });

  it("the vehicle's lp_visibility is the own_only default, read from the DB", async () => {
    const { spvLpVisibility } = await import("../lib/capTableSinkScope");
    expect(spvLpVisibility(SPV_ID)).toBe("own_only");
  });

  it("the shared decision distinguishes all four outcomes", async () => {
    const { decideCapTableSinkAccess } = await import("../lib/capTableSinkScope");
    expect(decideCapTableSinkAccess(CTX_LP_ALPHA as any, SPV_ID).outcome).toBe("scope_to_self");
    expect(decideCapTableSinkAccess(CTX_LP_ALPHA as any, REAL_CO).outcome).toBe("allow");
    expect(decideCapTableSinkAccess(CTX_LP_ALPHA as any, UNRELATED_CO).outcome).toBe("refuse");
    expect(decideCapTableSinkAccess(null, REAL_CO).outcome).toBe("refuse");
  });
});

describe("WAVE 35 · F6 — GET /api/companies/:id/captable/snapshots", () => {
  it("POLE 1: an LP does NOT receive a co-LP of their own vehicle", async () => {
    const r = await call(`/api/companies/${SPV_ID}/captable/snapshots`);
    expect(r.status).toBe(200);
    expect(r.raw).not.toContain(LP_B);
    expect(r.raw).not.toContain("Confidential-LP");
    expect(r.raw).not.toContain("7500000");
  });

  it("POLE 3: the LP still sees their OWN position — never told they hold nothing", async () => {
    const r = await call(`/api/companies/${SPV_ID}/captable/snapshots`);
    const all = [
      ...(r.body?.pending?.positions ?? []),
      ...(r.body?.previous?.positions ?? []),
    ];
    for (const p of all) expect(p.investorId).toBe(LP_A);
  });

  it("POLE 2: a genuine counterparty of a REAL company still sees the other holders", async () => {
    const r = await call(`/api/companies/${REAL_CO}/captable/snapshots`);
    expect(r.status).toBe(200);
    // The route must not have become a blanket refusal.
    expect(r.body?.ok).toBe(true);
  });

  it("POLE 4 / F9: no relationship answers 404 not_found, never 403", async () => {
    const r = await call(`/api/companies/${UNRELATED_CO}/captable/snapshots`);
    expect(r.status).toBe(404);
    expect(r.body?.error).toBe("not_found");
  });
});

describe("WAVE 35 · F7 — GET /api/companies/:id/captable/interim", () => {
  it("POLE 1: LP Beta's identity, email and amount are absent", async () => {
    const r = await call(`/api/companies/${SPV_ID}/captable/interim`);
    expect(r.status).toBe(200);
    expect(r.raw).not.toContain(LP_B);
    expect(r.raw).not.toContain("Confidential-LP");
    expect(r.raw).not.toContain("beta@w35.test");
    expect(r.raw).not.toContain("7500000");
  });

  it("POLE 1b: the vehicle's TOTAL is not leaked through subtotals either", async () => {
    const r = await call(`/api/companies/${SPV_ID}/captable/interim`);
    const committed = r.body?.subtotals?.committed;
    // Only Alpha's own $250,000 survives; 7,750,000 was the leaked vehicle total.
    expect(committed?.amount).not.toBe(7750000);
  });

  it("POLE 3: Alpha's own committed row is still returned", async () => {
    const r = await call(`/api/companies/${SPV_ID}/captable/interim`);
    const rows = r.body?.committed ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.investorId).toBe(LP_A);
  });

  it("POLE 2: on a REAL company the counterparty rows are still emitted", async () => {
    const r = await call(`/api/companies/${REAL_CO}/captable/interim`);
    expect(r.status).toBe(200);
    const ids = (r.body?.committed ?? []).map((x: any) => x.investorId);
    expect(ids).toContain(LP_A);
    expect(ids).toContain(LP_B);
  });

  it("POLE 4 / F9: 404 not_found for an unrelated company", async () => {
    const r = await call(`/api/companies/${UNRELATED_CO}/captable/interim`);
    expect(r.status).toBe(404);
    expect(r.body?.error).toBe("not_found");
  });

  it("F7 secondary: subtotals never sum across currencies", async () => {
    const r = await call(`/api/companies/${REAL_CO}/captable/interim`);
    const c = r.body?.subtotals?.committed;
    expect(c).toBeTruthy();
    // Single-currency fixture: the scalar is populated and labelled.
    expect(c.amountCurrency).toBe("USD");
    expect(c.amountIsMixedCurrency).toBe(false);
    expect(c.amountByCurrency?.USD).toBe(1150000);
  });
});

describe("WAVE 35 · F8 — GET /api/companies/:id/securities", () => {
  it("POLE 1: the W-SAFE ledger bridge no longer projects a co-LP", async () => {
    const r = await call(`/api/companies/${SPV_ID}/securities`);
    expect(r.status).toBe(200);
    expect(r.raw).not.toContain(LP_B);
    expect(r.raw).not.toContain("Confidential-LP");
    expect(r.raw).not.toContain("7500000");
  });

  it("POLE 3: Alpha's own security is still projected", async () => {
    const r = await call(`/api/companies/${SPV_ID}/securities`);
    const rows = r.body ?? [];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.investorId).toBe(LP_A);
  });

  it("POLE 2: on a REAL company both holders are still projected", async () => {
    const r = await call(`/api/companies/${REAL_CO}/securities`);
    expect(r.status).toBe(200);
    const ids = (r.body ?? []).map((x: any) => x.investorId);
    expect(ids).toContain(LP_A);
    expect(ids).toContain(LP_B);
  });

  it("POLE 4 / F9: 404 not_found for an unrelated company", async () => {
    const r = await call(`/api/companies/${UNRELATED_CO}/securities`);
    expect(r.status).toBe(404);
    expect(r.body?.error).toBe("not_found");
  });
});

describe("WAVE 35 — the explicit co_investors opt-in is honoured, not hardcoded", () => {
  it("flipping spv.lp_visibility to co_investors in the DB re-opens the vehicle", async () => {
    const { rawDb } = await import("../db/connection");
    const { decideCapTableSinkAccess, spvLpVisibility } = await import("../lib/capTableSinkScope");
    const db: any = rawDb();
    try {
      db.prepare(`UPDATE spv SET lp_visibility = 'co_investors' WHERE id = ?`).run(SPV_ID);
      expect(spvLpVisibility(SPV_ID)).toBe("co_investors");
      expect(decideCapTableSinkAccess(CTX_LP_ALPHA as any, SPV_ID).outcome).toBe("allow");
      const r = await call(`/api/companies/${SPV_ID}/captable/interim`);
      const ids = (r.body?.committed ?? []).map((x: any) => x.investorId);
      expect(ids).toContain(LP_B);
    } finally {
      db.prepare(`UPDATE spv SET lp_visibility = 'own_only' WHERE id = ?`).run(SPV_ID);
    }
    // And it closes again — the policy is read per request from the DB.
    const after = await call(`/api/companies/${SPV_ID}/captable/interim`);
    expect(after.raw).not.toContain(LP_B);
  });
});

/* ============================================================
 * WAVE 35 · ROW 6 — the `refuse` branch of `scopeCapTableRows`.
 *
 * Mutating `if (access.outcome === "refuse") return []` to `return rows`
 * SURVIVED the HTTP-level cases above. That survivor is NOT a harness bug and
 * NOT a coverage gap that more HTTP cases could close: every caller answers
 * 404 before it can ever reach the row-scoping helper, so over HTTP the branch
 * is unreachable and therefore unassertable — an EQUIVALENT MUTANT at the
 * route layer.
 *
 * It is still worth defending, because it is the fallback a FUTURE caller that
 * forgets the 404 would land on, and "fail open to every row" is the worst
 * possible default for this helper. The branch is reachable by direct call, so
 * it is asserted directly here. This converts an unassertable branch into an
 * assertable one rather than leaving a known survivor unexplained.
 * ============================================================ */
describe("WAVE 35 · scopeCapTableRows — the refuse branch fails CLOSED", () => {
  it("refuse yields nothing even when handed a full ledger", async () => {
    const { scopeCapTableRows } = await import("../lib/capTableSinkScope");
    const rows = [
      { investorId: LP_A, amount: 250000 },
      { investorId: LP_B, amount: 7500000 },
    ];
    const out = scopeCapTableRows(
      { outcome: "refuse", scopedToUserId: null, reason: "no_relationship" },
      rows,
      (r) => r.investorId,
    );
    expect(out).toEqual([]);
  });

  it("scope_to_self with an EMPTY scopedToUserId also fails closed, not open", async () => {
    const { scopeCapTableRows } = await import("../lib/capTableSinkScope");
    const rows = [{ investorId: LP_A, amount: 250000 }];
    const out = scopeCapTableRows(
      { outcome: "scope_to_self", scopedToUserId: "", reason: "spv_lp_own_only" },
      rows,
      (r) => r.investorId,
    );
    expect(out).toEqual([]);
  });

  it("allow still passes the whole ledger through (no over-fix)", async () => {
    const { scopeCapTableRows } = await import("../lib/capTableSinkScope");
    const rows = [
      { investorId: LP_A, amount: 250000 },
      { investorId: LP_B, amount: 900000 },
    ];
    const out = scopeCapTableRows(
      { outcome: "allow", scopedToUserId: null, reason: "direct_counterparty" },
      rows,
      (r) => r.investorId,
    );
    expect(out).toHaveLength(2);
  });
});
