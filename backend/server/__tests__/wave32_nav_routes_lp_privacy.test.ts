/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 1 — NAV STORE + ROUTE FALSIFICATION,
 * INCLUDING THE LP-PRIVACY NEGATIVE POLE.
 *
 * WHAT THIS FILE DEFENDS AGAINST, SPECIFICALLY
 * --------------------------------------------
 * 1. THE VACUOUS SCHEMA PASS. `spv_nav_snapshot` is created by migration 0178,
 *    which `NODE_ENV=test` NEVER RUNS — the test database is built from
 *    connection.ts's inline baseline, and connection.ts is SACRED so the table
 *    could not be added there. The self-heal installer is fail-soft BY DESIGN.
 *    If it silently did nothing, every read would return empty and every
 *    "expected 0" assertion would PASS against a table that does not exist.
 *    Case (0) therefore asserts THE SCHEMA ITSELF before anything else runs.
 *
 * 2. THE COLLAPSED IDENTITY. Wave 28's rate-limiter pin passed 14/14 while
 *    every request was one anonymous identity, because the identifying header
 *    was only honoured under the dev bypass. So the identity used here is
 *    injected by a mock that is ALWAYS in force — there is no bypass to be off
 *    — and case (P0) proves the mock genuinely distinguishes identities by
 *    driving the SAME url with two different LPs and requiring DIFFERENT
 *    bodies. If identity ever collapsed, (P0) fails and every privacy
 *    assertion after it is known to be meaningful rather than assumed.
 *
 * 3. RULE 3, THE PROBE MUST MATCH THE CONTROL. The privacy probe is a REAL,
 *    FULLY AUTHENTICATED INVESTOR who is an LP of a DIFFERENT vehicle — not an
 *    anonymous caller. Anonymity proves only that auth is mounted. The control
 *    (LP A reads LP A's vehicle -> 200) and the probe (LP B reads LP A's
 *    vehicle -> 404) differ in EXACTLY ONE variable: which real person is
 *    asking.
 *
 * This file establishes all of its own preconditions — company, priced round,
 * SPV, subscriptions, deployment — and asserts each seed landed. It never reads
 * `process.env` and there is no conditional skip anywhere in it.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";

/* ── identity injection ───────────────────────────────────────────────────
   The session identity is replaced wholesale, so the LP routes see exactly
   the person this test names. `CURRENT` is set per-request by the test. This
   is not a "bypass": it is unconditional, so there is no configuration under
   which these assertions silently degrade to a single anonymous caller.      */
let CURRENT: { userId: string | null } = { userId: null };
vi.mock("../lib/userContext", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    getUserContext: () => ({
      isAuthed: CURRENT.userId !== null,
      userId: CURRENT.userId,
      roles: [],
    }),
  };
});

import { rawDb } from "../db/connection";
import { createRound } from "../roundsStore";
import { registerSpvNavRoutes } from "../spvNavRoutes";
import {
  deriveNav,
  deriveNavWithLpShares,
  lpOwnNavPosition,
  freezeNav,
  listFrozenNavs,
  latestFrozenNav,
  committedRegisterRows,
  ensureNavSchemaForTests,
} from "../spvNavStore";

const SPV_A = "w32nav_spv_a";
const SPV_B = "w32nav_spv_b";
const CO_A = "w32nav_co_a";
const CO_UNMARKED = "w32nav_co_unmarked";
const LP_A = "w32nav_lp_alice";
const LP_B = "w32nav_lp_bob";
const OUTSIDER = "w32nav_outsider";
const PARTNER = "w32nav_partner";

function n(sql: string, ...args: unknown[]): number {
  return Number((rawDb().prepare(sql).get(...(args as any[])) as any)?.n ?? 0);
}

function makeApp() {
  const app = express();
  app.use(express.json());
  registerSpvNavRoutes(app);
  return app;
}

beforeAll(() => {
  const db: any = rawDb();
  const now = "2026-08-11T00:00:00.000Z";
  ensureNavSchemaForTests();

  db.prepare(
    `INSERT OR IGNORE INTO partner_organizations (id, tenant_id, name, status, created_at, updated_at)
     VALUES (?, 'tenant_platform', ?, 'active', ?, ?)`,
  ).run(PARTNER, "W32 NAV Partner", now, now);

  const insSpv = db.prepare(
    `INSERT OR IGNORE INTO spv (id, sponsor_partner_id, name, spv_type, jurisdiction, status,
       distribution_scope, currency, carry_basis, lp_visibility, created_at, updated_at, curr_hash)
     VALUES (?,?,?,'spv','delaware','open','private','USD','whole_spv','own_only',?,?,'h')`,
  );
  insSpv.run(SPV_A, PARTNER, "W32 NAV Vehicle A", now, now);
  insSpv.run(SPV_B, PARTNER, "W32 NAV Vehicle B", now, now);

  // LP_A is committed to SPV_A only; LP_B to SPV_B only. Both are REAL,
  // fully-authenticated LPs — which is what makes LP_B a valid probe identity
  // for SPV_A rather than a mere unauthenticated caller.
  const insSub = db.prepare(
    `INSERT OR IGNORE INTO spv_subscription
       (id, spv_id, investor_id, commitment_minor, currency, status, created_at, updated_at, curr_hash)
     VALUES (?,?,?,?,?,?,?,?,'h')`,
  );
  insSub.run("w32nav_sub_a1", SPV_A, LP_A, 6000000, "USD", "committed", now, now);
  insSub.run("w32nav_sub_a2", SPV_A, "w32nav_lp_carol", 4000000, "USD", "committed", now, now);
  insSub.run("w32nav_sub_b1", SPV_B, LP_B, 5000000, "USD", "committed", now, now);

  // A priced round gives CO_A a derivable mark. CO_UNMARKED deliberately gets
  // NONE, so the "refuse rather than fabricate" path is exercised against a
  // real absence rather than a mocked one.
  try {
    createRound({
      companyId: CO_A, name: `W32 NAV Series A ${Math.random().toString(36).slice(2, 8)}`,
      type: "priced", state: "closed", pricePerShare: 2.5, closeDate: "2026-07-01",
    });
  } catch { /* a duplicate name from a prior run is harmless; asserted below */ }

  db.prepare(
    `INSERT OR IGNORE INTO spv_deployment
       (id, spv_id, company_id, company_round_id, instrument, amount_minor, currency, shares,
        status, created_at, updated_at, curr_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'h')`,
  ).run("w32nav_dep_1", SPV_A, CO_A, "rnd_x", "equity", 1000000, "USD", "1000", "deployed", now, now);

  /* SEEDS ASSERTED. A swallowed seed failure leaves an empty fixture and makes
     every case below vacuous — the exact defect class this file exists to
     catch, so these are assertions and not logging. */
  expect(n(`SELECT COUNT(*) n FROM spv WHERE id IN (?,?)`, SPV_A, SPV_B)).toBe(2);
  expect(n(`SELECT COUNT(*) n FROM spv_subscription WHERE spv_id = ? AND status='committed'`, SPV_A)).toBe(2);
  expect(n(`SELECT COUNT(*) n FROM spv_subscription WHERE spv_id = ? AND status='committed'`, SPV_B)).toBe(1);
  expect(n(`SELECT COUNT(*) n FROM spv_deployment WHERE spv_id = ?`, SPV_A)).toBe(1);
  expect(n(`SELECT COUNT(*) n FROM rounds WHERE company_id = ? AND price_per_share > 0`, CO_A)).toBeGreaterThan(0);
});

/* ==========================================================================
 * (0) THE SCHEMA ITSELF — before any read can pass vacuously.
 * ======================================================================== */
describe("W32/NAV (0) the self-heal installer really ran", () => {
  it("0a spv_nav_snapshot / spv_side_letter / spv_k1_statement exist", () => {
    deriveNav(SPV_A); // force the memoised ensureSchema() through a real read
    for (const t of ["spv_nav_snapshot", "spv_side_letter", "spv_k1_statement"]) {
      expect(n(`SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?`, t)).toBe(1);
    }
  });

  it("0b total_nav_minor is NULLABLE at the table, so 'unknown' is storable", () => {
    const sql = String((rawDb()
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='spv_nav_snapshot'`)
      .get() as any)?.sql ?? "");
    // If this column were NOT NULL, an unknown NAV could only be stored as 0 —
    // which is the fabrication the whole capability exists to prevent.
    expect(sql).not.toMatch(/total_nav_minor\s+INTEGER\s+NOT\s+NULL/i);
    expect(sql).toMatch(/status\s+TEXT\s+NOT\s+NULL\s+CHECK/i);
  });
});

/* ==========================================================================
 * (1) DERIVATION OVER REAL ROWS.
 * ======================================================================== */
describe("W32/NAV (1) derivation reads real deployments and real marks", () => {
  it("1a a marked, single-currency vehicle produces a real number", () => {
    const nav = deriveNav(SPV_A);
    // 1,000 shares × $2.50 = $2,500.00 = 250000 cents. Computed from the seeded
    // round, not from a fixture constant — if the marks engine stopped being
    // consulted this would collapse to a refusal and fail.
    expect(nav.status).toBe("complete");
    expect(nav.totalNavMinor).toBe(250000);
    expect(nav.currency).toBe("USD");
    expect(nav.markedHoldings).toBe(1);
    expect(nav.holdings[0].markBadge).toBeTruthy();
  });

  it("1b an UNMARKED holding turns the total into a refusal, not a smaller number", () => {
    const db: any = rawDb();
    const now = "2026-08-11T00:00:00.000Z";
    db.prepare(
      `INSERT OR IGNORE INTO spv_deployment
         (id, spv_id, company_id, company_round_id, instrument, amount_minor, currency, shares,
          status, created_at, updated_at, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'h')`,
    ).run("w32nav_dep_2", SPV_A, CO_UNMARKED, "rnd_y", "equity", 900000, "USD", "500", "deployed", now, now);
    const nav = deriveNav(SPV_A);
    expect(nav.status).toBe("partial_unmarked");
    expect(nav.totalNavMinor).toBeNull();
    expect(nav.unmarkedHoldings).toBe(1);
    // The marked holding is STILL valued — refusing the total must not drop the
    // per-line data (never silently drop functionality).
    expect(nav.holdings.find((h) => h.companyId === CO_A)!.fairValueMinor).toBe(250000);
    // Clean up so later cases see the single-holding vehicle again.
    db.prepare(`DELETE FROM spv_deployment WHERE id = ?`).run("w32nav_dep_2");
    expect(deriveNav(SPV_A).status).toBe("complete");
  });

  it("1c per-LP shares are allocated over the committed register and conserve cents", () => {
    const { nav, lpShares } = deriveNavWithLpShares(SPV_A);
    expect(nav.totalNavMinor).toBe(250000);
    expect(lpShares).toHaveLength(2);
    // 60/40 of 250000 = 150000 / 100000, exactly.
    const byId = new Map(lpShares.map((s) => [s.investorId, s.navShareMinor]));
    expect(byId.get(LP_A)).toBe(150000);
    expect(byId.get("w32nav_lp_carol")).toBe(100000);
    expect(lpShares.reduce((a, s) => a + (s.navShareMinor ?? 0), 0)).toBe(250000);
  });

  it("1d reading a NAV WRITES NOTHING — a derived NAV is not a governance artifact", () => {
    const before = n(`SELECT COUNT(*) n FROM spv_nav_snapshot WHERE spv_id = ?`, SPV_A);
    deriveNav(SPV_A); deriveNavWithLpShares(SPV_A); lpOwnNavPosition(SPV_A, LP_A);
    expect(n(`SELECT COUNT(*) n FROM spv_nav_snapshot WHERE spv_id = ?`, SPV_A)).toBe(before);
  });
});

/* ==========================================================================
 * (2) FREEZING.
 * ======================================================================== */
describe("W32/NAV (2) freezing is explicit, attributed and supersedes", () => {
  it("2a a freeze persists the number, the badge and the policy in force", () => {
    const snap = freezeNav({ spvId: SPV_A, asOfDate: "2026-08-01", frozenBy: "u_gp_1" });
    expect(snap.totalNavMinor).toBe(250000);
    expect(snap.status).toBe("complete");
    expect(snap.frozenBy).toBe("u_gp_1");
    // The thresholds are copied onto the row so a NAV read six months later is
    // legible against the policy that produced it, not against today's.
    expect(snap.staleWarnDays).toBeGreaterThan(0);
    expect(snap.staleExpiredDays).toBeGreaterThan(snap.staleWarnDays);
    expect(latestFrozenNav(SPV_A)!.id).toBe(snap.id);
  });

  it("2b re-freezing the same as-of date SUPERSEDES rather than overwrites", () => {
    const first = latestFrozenNav(SPV_A)!;
    const second = freezeNav({ spvId: SPV_A, asOfDate: "2026-08-01", frozenBy: "u_gp_2" });
    expect(second.id).not.toBe(first.id);
    const all = listFrozenNavs(SPV_A).filter((s) => s.asOfDate === "2026-08-01");
    expect(all.length).toBeGreaterThanOrEqual(2);
    // The prior figure survives, stamped — restating a NAV is a normal
    // fund-admin event and the earlier number must remain auditable.
    const reread = all.find((s) => s.id === first.id)!;
    expect(reread.supersededAt).not.toBeNull();
    expect(all.filter((s) => s.supersededAt === null)).toHaveLength(1);
  });

  it("2c a REFUSAL is frozen too, as NULL — the series must not silently gap", () => {
    const snap = freezeNav({ spvId: SPV_B, asOfDate: "2026-08-01", frozenBy: "u_gp_1" });
    expect(snap.status).toBe("no_holdings");
    expect(snap.totalNavMinor).toBeNull();
    expect(snap.totalNavMinor).not.toBe(0);
    // And it really is NULL in the column, not the string "null" or a 0.
    const raw = rawDb()
      .prepare(`SELECT total_nav_minor FROM spv_nav_snapshot WHERE id = ?`)
      .get(snap.id) as any;
    expect(raw.total_nav_minor).toBeNull();
  });
});

/* ==========================================================================
 * (P) LP PRIVACY — the negative pole, over the real routes.
 * ======================================================================== */
describe("W32/NAV (P) LP A cannot read LP B, by execution", () => {
  const app = makeApp();

  it("P0 the identity injection genuinely distinguishes people (guards every case below)", async () => {
    // Wave 28's failure was a suite that asserted per-identity behaviour while
    // every request collapsed to ONE identity. If that happened here, these two
    // responses would be identical and every later privacy assertion would be
    // meaningless. This case fails first and loudly if it ever does.
    CURRENT = { userId: LP_A };
    const asA = await request(app).get(`/api/investor/me/spv/${SPV_A}/nav`);
    CURRENT = { userId: LP_B };
    const asB = await request(app).get(`/api/investor/me/spv/${SPV_A}/nav`);
    expect(asA.status).not.toBe(asB.status);
  });

  it("P1 CONTROL — LP A reads LP A's own vehicle and gets their own position", async () => {
    CURRENT = { userId: LP_A };
    const res = await request(app).get(`/api/investor/me/spv/${SPV_A}/nav`);
    expect(res.status).toBe(200);
    expect(res.body.own.investorId).toBe(LP_A);
    expect(res.body.own.navShareMinor).toBe(150000);
    expect(res.body.totalNavMinor).toBe(250000);
  });

  it("P2 PROBE — a REAL, AUTHENTICATED LP OF ANOTHER VEHICLE gets 404, not 403", async () => {
    // Rule 3: the probe is a real-but-wrong identity, not anonymity. LP_B is a
    // fully authenticated LP — just not of THIS vehicle.
    CURRENT = { userId: LP_B };
    const res = await request(app).get(`/api/investor/me/spv/${SPV_A}/nav`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "SPV_NOT_FOUND" });
  });

  it("P3 the refusal is BYTE-IDENTICAL to a nonexistent vehicle — no enumeration oracle", async () => {
    // Rule 6. If a real-but-forbidden id refused differently from a fictional
    // one, the endpoint would confirm which vehicles exist.
    CURRENT = { userId: LP_B };
    const real = await request(app).get(`/api/investor/me/spv/${SPV_A}/nav`);
    const fake = await request(app).get(`/api/investor/me/spv/w32nav_does_not_exist/nav`);
    expect(real.status).toBe(fake.status);
    expect(JSON.stringify(real.body)).toBe(JSON.stringify(fake.body));
  });

  it("P4 no other LP's identity or figures appear ANYWHERE in LP A's response body", async () => {
    CURRENT = { userId: LP_A };
    const res = await request(app).get(`/api/investor/me/spv/${SPV_A}/nav`);
    const body = JSON.stringify(res.body);
    // Carol is a co-investor in the SAME vehicle with lp_visibility='own_only'.
    // A whole-body scan catches a leak through a field nobody thought to check —
    // the register slipping in under some future key name, for instance.
    expect(body).not.toContain("w32nav_lp_carol");
    expect(body).not.toContain("100000"); // Carol's NAV share
    expect(body).not.toContain("4000000"); // Carol's commitment
    expect(res.body.lpShares).toBeUndefined();
    // BOTH POLES: the caller's OWN figures ARE present, so P4 cannot pass by
    // the route returning nothing at all.
    expect(body).toContain(LP_A);
    expect(res.body.own.commitmentMinor).toBe(6000000);
  });

  it("P5 there is NO request-supplied investor id to tamper with", async () => {
    // A query parameter naming another investor must not be honoured — the
    // identity comes from the session and nowhere else.
    CURRENT = { userId: LP_A };
    const res = await request(app)
      .get(`/api/investor/me/spv/${SPV_A}/nav?investorId=w32nav_lp_carol&userId=w32nav_lp_carol`);
    expect(res.status).toBe(200);
    expect(res.body.own.investorId).toBe(LP_A);
    expect(JSON.stringify(res.body)).not.toContain("w32nav_lp_carol");
  });

  it("P6 an outsider who is an LP of NOTHING is refused identically", async () => {
    CURRENT = { userId: OUTSIDER };
    const res = await request(app).get(`/api/investor/me/spv/${SPV_A}/nav`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "SPV_NOT_FOUND" });
  });

  it("P7 anonymity is 401 — distinct from the identity refusal, so auth is proven mounted", async () => {
    CURRENT = { userId: null };
    const res = await request(app).get(`/api/investor/me/spv/${SPV_A}/nav`);
    expect(res.status).toBe(401);
  });

  it("P8 the membership predicate matches the register the NAV is allocated over", () => {
    // If these two ever diverged, someone could be shown a share of a register
    // they are not in, or denied a share of one they are.
    const register = committedRegisterRows(SPV_A).map((r) => r.investorId).sort();
    expect(register).toEqual([LP_A, "w32nav_lp_carol"].sort());
    expect(register).not.toContain(LP_B);
    expect(lpOwnNavPosition(SPV_A, LP_B).own).toBeNull();
    expect(lpOwnNavPosition(SPV_A, LP_A).own).not.toBeNull();
  });
});
