/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 5 — LP PORTAL FALSIFICATION.
 *
 * This file exists to falsify one claim: **"an LP sees their own vehicle
 * position and nothing else, and the same human's direct cap-table holdings are
 * unaffected."** It is deliberately hostile to that claim.
 *
 * ── WHY IT RUNS THE REAL STACK, NOT A HAND-BUILT EXPRESS APP ────────────────
 * `gate("investor.onCapTableOf")` had NEVER EXECUTED until v26.14.0 because it
 * was mounted BELOW the routes it guarded (`routes.ts:624`). A harness that
 * mounts a handler by itself proves nothing about whether the guard in front of
 * it runs in production. So this file boots `registerRoutes()` — the real
 * middleware stack in the real registration order — and drives it over HTTP
 * with a real signed session cookie. Every scoping claim below is proven BY
 * EXECUTION against that stack.
 *
 * ── WHY THE PROBE IDENTITIES ARE REAL, WRONG, AND NOT DEMO PERSONAS ─────────
 * Wave 29's harness silently authenticated as `u_aisha_patel`, so every route
 * looked open. Every persona here is created BY THIS FILE as a durable
 * `user_credentials` + `auth_users` row with `role='investor'`; none of them is
 * a seeded demo persona, and case (0b) proves the identity channel genuinely
 * DISTINGUISHES them by driving the SAME url as two people and requiring
 * different bodies. If identity ever collapsed to one caller, (0b) fails first
 * and loudly and every privacy assertion after it is therefore known to be
 * meaningful rather than assumed.
 *
 * ── THE FILE ESTABLISHES ITS OWN PRECONDITIONS ──────────────────────────────
 * `DISABLE_DEV_BYPASS` is SET here and restored in `afterAll`, never merely
 * asserted and never read from the ambient environment. Every seed is asserted
 * to have landed. There is no conditional skip anywhere in this file: a test
 * that quietly skips is instance 21 of "a check that passed while checking
 * nothing", and this one guards a privacy boundary.
 *
 * ── THE FIXTURE ─────────────────────────────────────────────────────────────
 *   DUAL       direct cap-table holder of CO_ALPHA  +  LP of SPV_B   <- §5 case
 *   ALPHA_PEER direct cap-table holder of CO_ALPHA (DUAL's legitimate co-member)
 *   LP_OTHER   LP of SPV_B, no direct holding anywhere  (must be INVISIBLE)
 *   WRONG      LP of SPV_C — a real, fully authenticated LP of a DIFFERENT
 *              vehicle. This is the probe identity: it differs from the control
 *              in EXACTLY ONE variable, which person is asking.
 *   CO_BETA    SPV_B's portfolio company. DUAL must have NO cap-table access to
 *              it: the VEHICLE is on that cap table, not the LP.
 *   CO_GAMMA   a NON-SPV company on which DUAL and LP_OTHER are both holders.
 *              This is the control that proves the WAIVER-4 exclusion is doing
 *              work rather than the co-membership query merely being broken.
 *
 * LP subscriptions are written into `captable_commits` with
 * `company_id = spv.id` — that is the ratified storage model
 * (`ENGINE_REGISTRY` C-1, `spvBackedCompanies.ts` header), and seeding it any
 * other way would make the WAIVER-4 assertions vacuous, because the rows whose
 * privacy consequence WAIVER-4 exists to cancel would not be there.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { signSessionValue, LEGACY_SESSION_COOKIE } from "../lib/sessionCookie";
import { getUserContextForId } from "../lib/userContext";
import { areCoMembersOnAnyCapTable } from "../lib/capTableMembership";
import { rawDb } from "../db/connection";
import { ensureNavSchemaForTests } from "../spvNavStore";
import { lpPositionsFor, lpPositionFor, lpVehicleIdsFor, LP_COLLECTIVE_SCOPE } from "../lpPositionsStore";
import { isSpvBackedCompany } from "../lib/spvBackedCompanies";
import { listMembersForCompany } from "../captableCommitStore";

const P = "w32lp_";
const DUAL = `${P}dual`;
const ALPHA_PEER = `${P}alpha_peer`;
const LP_OTHER = `${P}lp_other`;
const WRONG = `${P}wrong`;

const CO_ALPHA = `${P}co_alpha`;
const CO_BETA = `${P}co_beta`;
const CO_GAMMA = `${P}co_gamma`;
const CO_DELTA = `${P}co_delta`; // non-SPV, DUAL is its ONLY holder
const SPV_B = `${P}spv_b`;
const SPV_C = `${P}spv_c`;
const SPV_D = `${P}spv_d`; // FUNDED: confirmations + distributions for BOTH LPs
const SPV_E = `${P}spv_e`; // USD vehicle with a EUR distribution — must refuse
const PARTNER = `${P}partner`;

/** DUAL's own commitment to SPV_B, and LP_OTHER's. Distinct magnitudes so a
 *  leak of one into the other's response is detectable by VALUE, not only by
 *  identifier — a response that echoed the wrong figure under the right name
 *  would still be a disclosure. */
const DUAL_COMMIT_MINOR = 3_000_000;
const OTHER_COMMIT_MINOR = 7_250_000;
const WRONG_COMMIT_MINOR = 1_100_000;
/** JPY vehicle — see the money-discipline block (case M1). */
const SPV_C_CURRENCY = "JPY";
const D_DUAL_COMMIT_MINOR = 2_000_000;
const D_OTHER_COMMIT_MINOR = 6_000_000;
const D_DUAL_CALLED_MINOR = 1_250_000;
const D_OTHER_CALLED_MINOR = 4_100_000;
const D_DUAL_DIST_MINOR = 300_000;
const D_OTHER_DIST_MINOR = 950_000;
const JPY_COMMIT_MINOR = 4_000_000; // ¥4,000,000 — exponent 0, no minor digits.

let app: Express;
let server: http.Server;
const PRIOR_DEV_BYPASS = process.env.DISABLE_DEV_BYPASS;

/**
 * Source of a file with COMMENTS STRIPPED.
 *
 * The first draft of this harness grepped raw source and went red on its own
 * documentation: the files below *explain* in prose that they do not read
 * `process.env` and do not add an `is_lp` column, and the grep matched the
 * explanation. That was a harness bug, and the honest fix is to assert against
 * CODE rather than to soften the pattern until it passes.
 */
function codeOf(file: string): string {
  const fs = require("node:fs") as typeof import("node:fs");
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function rawOf(file: string): string {
  const fs = require("node:fs") as typeof import("node:fs");
  return fs.readFileSync(file, "utf8");
}

function n(sql: string, ...args: unknown[]): number {
  return Number((rawDb().prepare(sql).get(...(args as any[])) as any)?.n ?? 0);
}

function makeInvestor(userId: string, name: string): void {
  const db: any = rawDb();
  const now = "2026-08-11T00:00:00.000Z";
  const email = `${userId}@w32lp.test`;
  db.prepare(
    `INSERT OR IGNORE INTO user_credentials (user_id, email, name, password_hash, created_at, updated_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(userId, email, name, "x-not-a-login-path", now, now);
  db.prepare(
    `INSERT OR IGNORE INTO auth_users (id, email, password_hash, password_algo, role, status, created_at)
     VALUES (?,?,?,'argon2id','investor','active',?)`,
  ).run(userId, email, "x-not-a-login-path", now);
}

let seq = 900000;
function commit(companyId: string, investorId: string, amount: string, shares: string): void {
  const db: any = rawDb();
  const now = "2026-08-11T00:00:00.000Z";
  seq += 1;
  db.prepare(
    `INSERT OR IGNORE INTO captable_commits
       (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
        amount, currency, shares, state, prev_hash, hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'committed','p','h')`,
  ).run(
    `${P}cc_${companyId}_${investorId}`,
    `tenant_co_${companyId}`,
    seq,
    now,
    `${P}inv_${seq}`,
    `${P}rnd_${companyId}`,
    companyId,
    investorId,
    amount,
    "USD",
    shares,
  );
}

beforeAll(async () => {
  /* PRECONDITION ESTABLISHED, NOT CONSULTED. Without this, an identity-less
     request resolves to the demo persona and every "outsider" pole below is
     meaningless. The assertion immediately after is kept so that if the
     mechanism ever stops taking effect the file fails loudly. */
  process.env.DISABLE_DEV_BYPASS = "1";
  expect(process.env.DISABLE_DEV_BYPASS).toBe("1");

  const db: any = rawDb();
  const now = "2026-08-11T00:00:00.000Z";
  ensureNavSchemaForTests();

  for (const [id, nm] of [
    [DUAL, "W32 Dual Position"],
    [ALPHA_PEER, "W32 Alpha Peer"],
    [LP_OTHER, "W32 Other LP"],
    [WRONG, "W32 Wrong Vehicle LP"],
  ] as const) makeInvestor(id, nm);

  db.prepare(
    `INSERT OR IGNORE INTO partner_organizations (id, tenant_id, name, status, created_at, updated_at)
     VALUES (?, 'tenant_platform', ?, 'active', ?, ?)`,
  ).run(PARTNER, "W32 LP Partner", now, now);

  const insSpv = db.prepare(
    `INSERT OR IGNORE INTO spv (id, sponsor_partner_id, name, spv_type, jurisdiction, status,
       distribution_scope, currency, carry_basis, lp_visibility, created_at, updated_at, curr_hash)
     VALUES (?,?,?,'spv','delaware','open','private',?,'whole_spv','own_only',?,?,'h')`,
  );
  insSpv.run(SPV_B, PARTNER, "W32 Vehicle B", "USD", now, now);
  insSpv.run(SPV_C, PARTNER, "W32 Vehicle C (JPY)", SPV_C_CURRENCY, now, now);
  insSpv.run(SPV_D, PARTNER, "W32 Vehicle D (funded)", "USD", now, now);
  insSpv.run(SPV_E, PARTNER, "W32 Vehicle E (mixed ccy)", "USD", now, now);

  const insSub = db.prepare(
    `INSERT OR IGNORE INTO spv_subscription
       (id, spv_id, investor_id, commitment_minor, currency, status, created_at, updated_at, curr_hash)
     VALUES (?,?,?,?,?,'committed',?,?,'h')`,
  );
  insSub.run(`${P}sub_b_dual`, SPV_B, DUAL, DUAL_COMMIT_MINOR, "USD", now, now);
  insSub.run(`${P}sub_b_other`, SPV_B, LP_OTHER, OTHER_COMMIT_MINOR, "USD", now, now);
  insSub.run(`${P}sub_c_wrong`, SPV_C, WRONG, WRONG_COMMIT_MINOR, SPV_C_CURRENCY, now, now);
  insSub.run(`${P}sub_c_dual_jpy`, SPV_C, DUAL, JPY_COMMIT_MINOR, SPV_C_CURRENCY, now, now);
  insSub.run(`${P}sub_d_dual`, SPV_D, DUAL, D_DUAL_COMMIT_MINOR, "USD", now, now);
  insSub.run(`${P}sub_d_other`, SPV_D, LP_OTHER, D_OTHER_COMMIT_MINOR, "USD", now, now);
  insSub.run(`${P}sub_e_dual`, SPV_E, DUAL, 1_000_000, "USD", now, now);

  /* SPV_D — funds confirmations for BOTH LPs, at DIFFERENT amounts, and one
     distribution allocating a DIFFERENT net to each. Every per-LP filter in the
     store is therefore falsifiable: drop the filter and DUAL's numbers change
     to a value this fixture can name. Without both LPs funded, removing a
     `.filter(c => c.investorId === investorId)` would be an unassertable
     mutation and the harness would report a coverage gap as a clean kill. */
  db.prepare(`UPDATE spv SET terms_json = ? WHERE id = ?`).run(
    JSON.stringify({
      _fundsConfirmations: {
        [DUAL]: { receivedMinor: D_DUAL_CALLED_MINOR, confirmedAt: "2026-02-01T00:00:00.000Z" },
        [LP_OTHER]: { receivedMinor: D_OTHER_CALLED_MINOR, confirmedAt: "2026-02-02T00:00:00.000Z" },
      },
    }),
    SPV_D,
  );
  const insDist = db.prepare(
    `INSERT OR IGNORE INTO spv_distribution
       (id, spv_id, event, gross_proceeds_minor, currency, waterfall_json, allocations_json,
        gp_carry_minor, platform_carry_minor, status, created_at, curr_hash)
     VALUES (?,?,'exit',?,?,?,?,0,0,'recorded',?,'h')`,
  );
  insDist.run(
    `${P}dist_d`, SPV_D, 5_000_000, "USD",
    JSON.stringify([{ tier: "carry_base", amountMinor: 1_000_000 }]),
    JSON.stringify([
      { investorId: DUAL, grossMinor: D_DUAL_DIST_MINOR, carryMinor: 0, netMinor: D_DUAL_DIST_MINOR },
      { investorId: LP_OTHER, grossMinor: D_OTHER_DIST_MINOR, carryMinor: 0, netMinor: D_OTHER_DIST_MINOR },
    ]),
    now,
  );

  /* A side letter for LP_OTHER ONLY, on SPV_D. Both poles of `hasSideLetter`
     now exist in one vehicle: without LP_OTHER's letter, a store that reported
     "any letter in this vehicle" would be indistinguishable from one that
     reported "your letter", and the flag would be untestable. */
  db.prepare(
    `INSERT OR IGNORE INTO spv_side_letter (id, tenant_id, spv_id, investor_id,
       carry_fraction_scaled, mgmt_fee_fraction_scaled, hurdle_fraction_scaled,
       min_check_minor, currency, co_investor_visibility, mfn_clause, notes,
       document_ref, effective_date, status, created_by, created_at, updated_at)
     VALUES (?, 'tenant_platform', ?, ?, 100000000, NULL, NULL, NULL, 'USD',
             'own_only', 0, NULL, NULL, '2026-01-01', 'active', 'seed', ?, ?)`,
  ).run(`${P}sl_d_other`, SPV_D, LP_OTHER, now, now);

  /* SPV_E — a USD vehicle with a EUR distribution. Never sum across
     currencies: the position must REFUSE rather than produce a number. */
  insDist.run(
    `${P}dist_e`, SPV_E, 800_000, "EUR",
    JSON.stringify([{ tier: "carry_base", amountMinor: 0 }]),
    JSON.stringify([{ investorId: DUAL, grossMinor: 800_000, carryMinor: 0, netMinor: 800_000 }]),
    now,
  );

  /* SPV_B deploys into CO_BETA. The VEHICLE is CO_BETA's cap-table member —
     the LPs are not, and that separation is the whole enforcement point. */
  db.prepare(
    `INSERT OR IGNORE INTO spv_deployment
       (id, spv_id, company_id, company_round_id, instrument, amount_minor, currency, shares,
        status, created_at, updated_at, curr_hash)
     VALUES (?,?,?,?, 'equity', 9000000, 'USD', '9000', 'deployed', ?, ?, 'h')`,
  ).run(`${P}dep_b`, SPV_B, CO_BETA, `${P}rnd_beta`, now, now);
  commit(CO_BETA, SPV_B, "90000.00", "9000"); // the VEHICLE on the company's cap table

  /* DIRECT cap-table positions — the "full access" pole of the dual case. */
  commit(CO_ALPHA, DUAL, "50000.00", "5000");
  commit(CO_ALPHA, ALPHA_PEER, "25000.00", "2500");

  /* THE LP ROWS THAT MAKE WAIVER-4 LOAD-BEARING. `spvEngineRoutes` writes each
     LP into the sacred ledger with company_id = spv.id, so before WAIVER-4
     these two rows alone made DUAL and LP_OTHER resolve as cap-table
     counterparties. Seeding them is what gives case (A2) something to falsify. */
  commit(SPV_B, DUAL, "30000.00", "0");
  commit(SPV_B, LP_OTHER, "72500.00", "0");

  /* CONTROL PAIR — LP_OTHER and WRONG share exactly ONE company, CO_GAMMA,
     which is NOT a vehicle. They are otherwise unrelated. This is the pole that
     proves the co-membership query CAN return true for a pair like the SPV_B
     pair, so (A2)'s false comes from SPV-hood and not from a broken join.
     DUAL is deliberately NOT here: if DUAL and LP_OTHER shared any non-SPV
     company, (A2) would be true for a legitimate reason and the whole WAIVER-4
     assertion would be untestable. */
  commit(CO_GAMMA, LP_OTHER, "1000.00", "100");
  commit(CO_GAMMA, WRONG, "1000.00", "100");

  /* A REAL company on which DUAL is the ONLY holder. Used by (D5): the empty
     list a vehicle returns must be indistinguishable from the empty list a
     company with no co-investors returns. */
  commit(CO_DELTA, DUAL, "500.00", "50");

  app = express();
  app.use(express.json());
  // Mirrors server/index.ts — the cookie identity channel lives OUTSIDE
  // registerRoutes, so a harness without it has no way to authenticate at all.
  app.use((req, _res, next) => {
    const r = req as typeof req & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const header = req.headers.cookie;
      const out: Record<string, string> = {};
      if (typeof header === "string" && header.length > 0) {
        for (const part of header.split(";")) {
          const eq = part.indexOf("=");
          if (eq === -1) continue;
          const k = part.slice(0, eq).trim();
          if (k) out[k] = part.slice(eq + 1).trim();
        }
      }
      r.cookies = out;
    }
    next();
  });
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  if (PRIOR_DEV_BYPASS === undefined) delete process.env.DISABLE_DEV_BYPASS;
  else process.env.DISABLE_DEV_BYPASS = PRIOR_DEV_BYPASS;
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

function as(userId: string, url: string) {
  return request(app)
    .get(url)
    .set("Cookie", `${LEGACY_SESSION_COOKIE}=${signSessionValue(userId)}`);
}

/* ══════════════════════════════════════════════════════════════════════════
   PART 0 — THE HARNESS PROVES ITSELF FIRST
   Nothing below is trustworthy unless the fixture landed and the identity
   channel really distinguishes people.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W32·C5 · (0) the harness establishes and proves its own preconditions", () => {
  it("(0a) every seed landed — a swallowed INSERT would make every assertion below vacuous", () => {
    expect(n(`SELECT COUNT(*) n FROM spv WHERE id IN (?,?)`, SPV_B, SPV_C)).toBe(2);
    expect(n(`SELECT COUNT(*) n FROM spv_subscription WHERE spv_id = ? AND status='committed'`, SPV_B)).toBe(2);
    expect(n(`SELECT COUNT(*) n FROM captable_commits WHERE company_id = ? AND state='committed'`, CO_ALPHA)).toBe(2);
    expect(n(`SELECT COUNT(*) n FROM captable_commits WHERE company_id = ? AND state='committed'`, SPV_B)).toBe(2);
    expect(n(`SELECT COUNT(*) n FROM captable_commits WHERE company_id = ? AND state='committed'`, CO_GAMMA)).toBe(2);
    expect(n(`SELECT COUNT(*) n FROM spv_deployment WHERE spv_id = ?`, SPV_B)).toBe(1);
  });

  it("(0b) the identity channel DISTINGUISHES people — the same url returns different bodies to two humans", async () => {
    const a = await as(DUAL, "/api/investor/me/lp-positions");
    const b = await as(LP_OTHER, "/api/investor/me/lp-positions");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Wave 28's rate-limit suite passed 14/14 while every request collapsed to
    // ONE anonymous identity. If that were happening here, this fails first.
    expect(JSON.stringify(a.body)).not.toBe(JSON.stringify(b.body));
  }, 60_000);

  it("(0c) an ANONYMOUS caller is refused 401 — distinct from the member refusal, so auth really is mounted", async () => {
    const r = await request(app).get("/api/investor/me/lp-positions");
    expect(r.status).toBe(401);
  }, 60_000);

  it("(0d) the personas are REAL authenticated investors, not demo personas", () => {
    for (const id of [DUAL, ALPHA_PEER, LP_OTHER, WRONG]) {
      const ctx = getUserContextForId(id);
      expect(ctx.isAuthed, `${id} must authenticate`).toBe(true);
      expect(ctx.userId).toBe(id);
    }
    // Rule: never probe with a demo persona. Assert we did not accidentally
    // reuse one — the ids must not be in the seeded demo set.
    expect([DUAL, ALPHA_PEER, LP_OTHER, WRONG]).not.toContain("u_aisha_patel");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PART A — WAIVER-4, PROVEN BY EXECUTION
   `capTableMembership.ts` is SACRED and is read, never edited. It is also the
   single point on which the entire scoped view rests: if it regresses, the
   scoped LP view silently becomes FULL ACCESS. So it is exercised, at both
   poles, against rows that would make it fail without the exclusion.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W32·C5 · (A) WAIVER-4 — the predicate the whole ruling rests on", () => {
  it("(A1) POSITIVE POLE — two genuine cap-table holders of a real company ARE co-members", () => {
    // Without this the file could pass with a predicate that returns false for
    // everyone, which would "protect" LPs by breaking the product.
    expect(areCoMembersOnAnyCapTable(DUAL, ALPHA_PEER)).toBe(true);
    expect(areCoMembersOnAnyCapTable(ALPHA_PEER, DUAL)).toBe(true);
  });

  it("(A2) NEGATIVE POLE — two LPs of the same vehicle are NOT co-members, despite both having ledger rows on it", () => {
    // Both LP rows exist under company_id = SPV_B (asserted in 0a): that is the
    // ratified storage model, and before WAIVER-4 those rows alone made these
    // two people resolve as cap-table counterparties who could discover and
    // message each other.
    expect(n(`SELECT COUNT(*) n FROM captable_commits WHERE company_id = ? AND investor_id = ?`, SPV_B, DUAL)).toBe(1);
    expect(n(`SELECT COUNT(*) n FROM captable_commits WHERE company_id = ? AND investor_id = ?`, SPV_B, LP_OTHER)).toBe(1);
    expect(areCoMembersOnAnyCapTable(DUAL, LP_OTHER)).toBe(false);
    expect(areCoMembersOnAnyCapTable(LP_OTHER, DUAL)).toBe(false);
  });

  it("(A3) CONTROL — the exclusion is doing the work, not a broken query: a pair sharing only a NON-SPV company IS co-members", () => {
    // LP_OTHER and WRONG share exactly one company, CO_GAMMA, which is not a
    // vehicle. (A2) is only meaningful if this same query can say yes.
    expect(n(`SELECT COUNT(*) n FROM spv WHERE id = ?`, CO_GAMMA)).toBe(0);
    expect(areCoMembersOnAnyCapTable(LP_OTHER, WRONG)).toBe(true);

    // And the shape (A2) tests, stated as data: DUAL and LP_OTHER share
    // ledger rows on SPV_B and on NOTHING ELSE. So the only possible source of
    // a `true` would be the vehicle, and the predicate says false.
    const shared = (rawDb()
      .prepare(
        `SELECT DISTINCT ca.company_id AS cid FROM captable_commits ca
           JOIN captable_commits cb ON ca.company_id = cb.company_id
          WHERE ca.investor_id = ? AND cb.investor_id = ?
            AND ca.state='committed' AND cb.state='committed'
            AND ca.deleted_at IS NULL AND cb.deleted_at IS NULL`,
      )
      .all(DUAL, LP_OTHER) as Array<{ cid: string }>).map((r) => r.cid);
    expect(shared).toEqual([SPV_B]);
    expect(areCoMembersOnAnyCapTable(DUAL, LP_OTHER)).toBe(false);
  });

  it("(A4) SPV-hood is asked of the DB, never inferred from an id prefix", () => {
    // A new vehicle is excluded the moment it is inserted, with no code change.
    // Prove it: SPV_C's id shares the same prefix as CO_GAMMA's, so a prefix
    // heuristic would classify them identically. The DB does not.
    expect(n(`SELECT COUNT(*) n FROM spv WHERE id = ?`, SPV_C)).toBe(1);
    expect(n(`SELECT COUNT(*) n FROM spv WHERE id = ?`, CO_GAMMA)).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PART B — THE DUAL-POSITION ACCEPTANCE TEST (both poles in ONE test)
   ══════════════════════════════════════════════════════════════════════════ */
describe("W32·C5 · (B) DUAL POSITION — full access to Company A, vehicle-scoped in SPV B", () => {
  it("(B1) ONE persona, BOTH poles: cap-table + co-member visibility for CO_ALPHA, vehicle-only for SPV_B", async () => {
    /* ── POLE 1: FULL ACCESS TO COMPANY A ──────────────────────────────────
       The partner-introduced-investor ruling. This must NOT be collateral
       damage of the LP scoping. */
    const ctx = getUserContextForId(DUAL);
    expect(ctx.investor.capTablePositions.map((p) => p.companyId)).toContain(CO_ALPHA);

    // gate("investor.onCapTableOf") executes here — mounted at routes.ts:665,
    // ABOVE these handlers. Proven by execution, not by reading the mount.
    const alphaCoMembers = await as(DUAL, `/api/investor/companies/${CO_ALPHA}/co-members`);
    expect(alphaCoMembers.status).toBe(200);
    const alphaBody = JSON.stringify(alphaCoMembers.body);
    // Their legitimate co-member IS visible. Company A behaves normally.
    expect(alphaBody).toContain(ALPHA_PEER);

    /* ── POLE 2: VEHICLE-SCOPED IN SPV B ───────────────────────────────────
       Same human, same session, same request second later. */
    const lp = await as(DUAL, "/api/investor/me/lp-positions");
    expect(lp.status).toBe(200);
    const positions = lp.body.positions as Array<Record<string, unknown>>;
    const spvB = positions.find((p) => p.spvId === SPV_B);
    expect(spvB, "DUAL's own LP position in SPV_B must be present").toBeTruthy();
    expect(spvB!.positionType).toBe("spv_lp_interest"); // never a direct holding
    expect(spvB!.commitmentMinor).toBe(DUAL_COMMIT_MINOR);

    /* ZERO VISIBILITY OF SPV_B's OTHER LPs — whole-body scan, by identifier
       AND by value, so a leak that renamed the field is still caught. */
    const lpBody = JSON.stringify(lp.body);
    expect(lpBody).not.toContain(LP_OTHER);
    expect(lpBody).not.toContain(String(OTHER_COMMIT_MINOR));
    expect(lpBody).not.toContain("72500");
    // ...and the opposite pole, so this cannot pass by returning nothing:
    expect(lpBody).toContain(String(DUAL_COMMIT_MINOR));

    /* NO CAP-TABLE ACCESS TO SPV_B's PORTFOLIO COMPANY. The VEHICLE holds
       CO_BETA's shares; the LP holds a slice of the vehicle. */
    expect(ctx.investor.capTablePositions.map((p) => p.companyId)).not.toContain(CO_BETA);
    const betaCoMembers = await as(DUAL, `/api/investor/companies/${CO_BETA}/co-members`);
    expect(betaCoMembers.status).toBe(403);
    expect(betaCoMembers.body?.code ?? betaCoMembers.body?.error).toBe("NOT_ON_CAP_TABLE");

    /* NO CO-MEMBER ENUMERATION OF THE VEHICLE ITSELF — the second path.
       DUAL does have a ledger row under company_id = SPV_B (that is the
       storage model), so the entitlement gate alone does NOT stop them here.
       This is the route that returns amount/currency/shares PER INVESTOR. */
    const vehicleCoMembers = await as(DUAL, `/api/investor/companies/${SPV_B}/co-members`);
    const vehicleBody = JSON.stringify(vehicleCoMembers.body ?? "");
    expect(vehicleBody).not.toContain(LP_OTHER);
    expect(vehicleBody).not.toContain("72500");
  }, 120_000);

  it("(B2) the dual persona's DIRECT holdings are untouched by capability 5 — no functionality dropped", async () => {
    // The LP surface must not have narrowed anything that already worked.
    const ok = await as(DUAL, `/api/investor/companies/${CO_ALPHA}/co-members`);
    expect(ok.status).toBe(200);
    // And a person with only direct holdings and NO LP interest gets an empty
    // LP block rather than an error — the portfolio page renders unchanged.
    const peer = await as(ALPHA_PEER, "/api/investor/me/lp-positions");
    expect(peer.status).toBe(200);
    expect(peer.body.positions).toEqual([]);
  }, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   PART C — LP A CANNOT READ LP B THROUGH ANY ROUTE THIS WAVE ADDED
   Probed with a REAL-BUT-WRONG identity (WRONG is a fully authenticated LP of
   a different vehicle), never anonymously.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W32·C5 · (C) the negative pole, probed with a real but wrong identity", () => {
  it("(C1) CONTROL — WRONG reads their OWN vehicle and gets it", async () => {
    const r = await as(WRONG, `/api/investor/me/lp-positions/${SPV_C}`);
    expect(r.status).toBe(200);
    expect(r.body.position.spvId).toBe(SPV_C);
    expect(r.body.position.commitmentMinor).toBe(WRONG_COMMIT_MINOR);
  }, 60_000);

  it("(C2) PROBE — WRONG, a real committed LP of another vehicle, reads SPV_B and gets 404", async () => {
    const r = await as(WRONG, `/api/investor/me/lp-positions/${SPV_B}`);
    expect(r.status).toBe(404);
    expect(r.body?.error).toBe("SPV_NOT_FOUND");
  }, 60_000);

  it("(C3) that 404 is BYTE-IDENTICAL to a vehicle that does not exist — no enumeration oracle", async () => {
    const real = await as(WRONG, `/api/investor/me/lp-positions/${SPV_B}`);
    const fake = await as(WRONG, `/api/investor/me/lp-positions/${P}does_not_exist`);
    expect(fake.status).toBe(real.status);
    expect(JSON.stringify(fake.body)).toBe(JSON.stringify(real.body));
    // Cross-tenant refusals are 404, NOT 403.
    expect(real.status).toBe(404);
  }, 60_000);

  it("(C4) the LIST route never returns a vehicle the caller is not committed to", async () => {
    const r = await as(WRONG, "/api/investor/me/lp-positions");
    expect(r.status).toBe(200);
    const ids = (r.body.positions as Array<{ spvId: string }>).map((p) => p.spvId);
    expect(ids).toContain(SPV_C); // the pole that stops this passing by returning []
    expect(ids).not.toContain(SPV_B);
    expect(JSON.stringify(r.body)).not.toContain(LP_OTHER);
    expect(JSON.stringify(r.body)).not.toContain(DUAL);
  }, 60_000);

  it("(C5) there is NO request-supplied investor id to tamper with — ?investorId= is inert", async () => {
    const clean = await as(LP_OTHER, "/api/investor/me/lp-positions");
    const tampered = await as(LP_OTHER, `/api/investor/me/lp-positions?investorId=${DUAL}`);
    expect(tampered.status).toBe(200);
    expect(JSON.stringify(tampered.body)).toBe(JSON.stringify(clean.body));
    expect(JSON.stringify(tampered.body)).not.toContain(String(DUAL_COMMIT_MINOR));
  }, 60_000);

  it("(C6) the STORE itself is scoped, not just the route — the same scoping holds below HTTP", () => {
    // A route filter is a promise about one code path. Assert the sink.
    const mine = lpPositionsFor(DUAL).map((p) => p.spvId);
    expect(mine).toContain(SPV_B);
    expect(lpPositionFor(SPV_B, WRONG)).toBeNull();
    expect(lpPositionFor(SPV_B, LP_OTHER)?.commitmentMinor).toBe(OTHER_COMMIT_MINOR);
    // ...and DUAL's own read of the same vehicle reports DUAL's own figure,
    // so the store is not simply returning the first row it finds.
    expect(lpPositionFor(SPV_B, DUAL)?.commitmentMinor).toBe(DUAL_COMMIT_MINOR);
  });

  it("(C7) a serialised LP position carries NO field that could name another LP", () => {
    const p = lpPositionFor(SPV_B, DUAL)!;
    const keys = Object.keys(p);
    for (const forbidden of ["lpShares", "register", "coInvestors", "lps", "subscriptions"]) {
      expect(keys, `${forbidden} must not be serialised to an LP`).not.toContain(forbidden);
    }
    // Opposite pole: the LP's OWN figures are all there, so C7 cannot pass by
    // the object being empty.
    expect(keys).toContain("commitmentMinor");
    expect(keys).toContain("ownershipFraction");
  });
});

describe("W32·C5 · (C+) scoping gaps closed by mutation testing", () => {
  it("(C6b) GAP CLOSED — the SINGLE-VEHICLE route also ignores a caller-supplied investorId", async () => {
    // The list route was probed for this; the per-vehicle route was not, and a
    // parameter-injection mutant survived on it. Both routes now carry the
    // probe, with a REAL-BUT-WRONG identity rather than an anonymous or demo
    // caller — an unauthenticated probe would have been refused for the wrong
    // reason and told us nothing about identity substitution.
    const substituted = await as(DUAL, `/api/investor/me/lp-positions/${SPV_B}?investorId=${LP_OTHER}`);
    expect(substituted.status).toBe(200);
    expect(substituted.body.position.commitmentMinor).toBe(DUAL_COMMIT_MINOR);
    expect(substituted.body.position.commitmentMinor).not.toBe(OTHER_COMMIT_MINOR);
    expect(JSON.stringify(substituted.body)).not.toContain(LP_OTHER);

    // WRONG is a real, fully authenticated LP — of a DIFFERENT vehicle. Asking
    // for SPV_B as someone else must be a 404, not a borrowed position.
    const borrowed = await as(WRONG, `/api/investor/me/lp-positions/${SPV_B}?investorId=${DUAL}`);
    expect(borrowed.status).toBe(404);
    expect(borrowed.body.error).toBe("SPV_NOT_FOUND");
    expect(JSON.stringify(borrowed.body)).not.toContain(String(DUAL_COMMIT_MINOR));
  }, 60_000);

  it("(C7) GAP CLOSED — the vehicle list is scoped to the caller, proven by what it EXCLUDES", () => {
    // A list assertion that only checks `toContain` passes just as happily when
    // the query returns every vehicle on the platform. WRONG is a real LP of
    // SPV_C and of nothing else; DUAL is an LP of B, C, D and E.
    expect(lpVehicleIdsFor(WRONG)).toEqual([SPV_C]);
    expect(lpVehicleIdsFor(LP_OTHER).sort()).toEqual([SPV_B, SPV_D].sort());
    expect(lpVehicleIdsFor(LP_OTHER)).not.toContain(SPV_C);
    expect(lpVehicleIdsFor(LP_OTHER)).not.toContain(SPV_E);
    // ALPHA_PEER holds a direct cap-table seat and NO vehicle: the scoped view
    // is what remains when you hold no LP interest, which is nothing at all.
    expect(lpVehicleIdsFor(ALPHA_PEER)).toEqual([]);
    // And over the real stack, so the route cannot widen it either.
    const seen = new Set(lpPositionsFor(WRONG).map((x) => x.spvId));
    expect(Array.from(seen.values())).toEqual([SPV_C]);
  });

  it("(C8) GAP CLOSED — hasSideLetter is the CALLER's letter, not 'a letter exists in this vehicle'", () => {
    // LP_OTHER has an active letter on SPV_D. DUAL is an LP of the same vehicle
    // and has none. Both poles, one vehicle, one instant.
    expect(n(`SELECT COUNT(*) n FROM spv_side_letter WHERE spv_id = ? AND status='active'`, SPV_D)).toBe(1);
    expect(lpPositionFor(SPV_D, LP_OTHER)!.hasSideLetter).toBe(true);
    expect(lpPositionFor(SPV_D, DUAL)!.hasSideLetter).toBe(false);
    // The letter's TERMS never cross either — only the boolean does.
    expect(JSON.stringify(lpPositionFor(SPV_D, DUAL))).not.toContain("100000000");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   PART D — THE SECOND PATH: co-member ENUMERATION of the vehicle itself.

   WAIVER-4 closed the BOOLEAN form of the SPV co-membership leak
   (`areCoMembersOnAnyCapTable`) and `commsUserDirectory.ts` closed the LIST
   form of the same self-join. Neither sweep looked at
   `GET /api/investor/companies/:companyId/co-members`, because those two
   handlers do not use the self-join at all — they enumerate
   `listMembersForCompany(companyId)` directly, and one of them returns
   `amount`, `currency` and `shares` PER INVESTOR.

   An LP passes `gate("investor.onCapTableOf")` FOR THEIR OWN VEHICLE, because
   the LP genuinely has a ledger row under `company_id = spv.id`. So the gate is
   not the control here and the route was handing one LP the identity and
   committed amount of every other LP in their vehicle.

   Every case below is proven by EXECUTION over the real stack, and every one
   carries the opposite pole — because the buggy answer and the correct answer
   for a vehicle are both "empty list", and an assertion that cannot tell those
   two apart is checking nothing.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W32·C5 · (D) co-member enumeration of a VEHICLE is refused, of a COMPANY is not", () => {
  it("(D0) the data IS there to leak — the ledger really can enumerate SPV_B's LPs", () => {
    // Without this, (D1)'s empty list would be indistinguishable from an empty
    // vehicle, and (D1) would pass while checking nothing.
    const rows = listMembersForCompany(SPV_B).map((r) => r.investorId);
    expect(rows).toContain(DUAL);
    expect(rows).toContain(LP_OTHER);
  });

  it("(D1) an LP asking for their OWN vehicle gets NO other LP — identity, amount or shares", async () => {
    const r = await as(DUAL, `/api/investor/companies/${SPV_B}/co-members`);
    expect(r.status).toBe(200);
    const body = JSON.stringify(r.body);
    expect(body).not.toContain(LP_OTHER);
    expect(body).not.toContain("72500"); // LP_OTHER's committed amount
    expect(r.body).toEqual([]);
  }, 60_000);

  it("(D2) THE OPPOSITE POLE — the same route, same caller, on a REAL COMPANY still returns their co-investors", async () => {
    // This is what makes (D1) meaningful rather than a route that refuses
    // everyone, and it is also the "never silently drop functionality" check.
    const r = await as(DUAL, `/api/investor/companies/${CO_ALPHA}/co-members`);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain(ALPHA_PEER);
  }, 60_000);

  it("(D3) the predicate is DB-driven and fails in the DENYING direction", () => {
    expect(isSpvBackedCompany(SPV_B)).toBe(true);
    expect(isSpvBackedCompany(SPV_C)).toBe(true);
    expect(isSpvBackedCompany(CO_ALPHA)).toBe(false); // the pole
    expect(isSpvBackedCompany(CO_GAMMA)).toBe(false);
    // Garbage input denies enumeration rather than permitting it.
    expect(isSpvBackedCompany("")).toBe(true);
    expect(isSpvBackedCompany(undefined as unknown as string)).toBe(true);
  });

  it("(D3b) the FAILURE DIRECTION is proven by execution, not by reading the catch block", () => {
    // A `catch { return true }` that no test ever enters is a claim, not a
    // control. The only honest way to assert it is to make the query actually
    // fail, so the `spv` table is renamed away for the duration of one call and
    // restored in a finally. Under the failure, a real portfolio company must
    // still come back as "treat as a vehicle" — the DENYING answer.
    expect(isSpvBackedCompany(CO_ALPHA)).toBe(false); // baseline, table present
    rawDb().exec(`ALTER TABLE spv RENAME TO spv_w32_hidden`);
    try {
      expect(isSpvBackedCompany(CO_ALPHA)).toBe(true);
      expect(isSpvBackedCompany(SPV_B)).toBe(true);
    } finally {
      rawDb().exec(`ALTER TABLE spv_w32_hidden RENAME TO spv`);
    }
    expect(isSpvBackedCompany(CO_ALPHA)).toBe(false); // restored, no leakage
  });

  it("(D4) BOTH handlers of the mirrored pair carry the guard — a fix applied to one gets undone", () => {
    for (const f of ["server/sprint21Routes.ts", "server/collectiveNetworkStore.ts"]) {
      const code = codeOf(f);
      expect(code, `${f} must guard the co-members enumeration`).toMatch(/if\s*\(isSpvBackedCompany\(companyId\)\)\s*return res\.json\(\[\]\)/);
      // ...and the ledger dependency must be STATIC, or the guard sits on a
      // path that cannot execute where it is tested.
      expect(code).toMatch(/import\s*\{\s*listMembersForCompany\s*\}\s*from\s*["']\.\/captableCommitStore["']/);
      expect(code, `${f}: the lazy require must be gone`).not.toMatch(/require\(["']\.\/captableCommitStore["']\)/);
    }
  });

  it("(D5) the vehicle's empty list is byte-identical to a real company with no co-investors — no oracle", async () => {
    // The honest claim, stated precisely. A vehicle answers 200 [] and a real
    // company on which the caller is the only holder answers 200 [] — so the
    // response does not tell an LP whether the id they hold is a vehicle or a
    // quiet company. (The 403 an id the caller is NOT on returns predates this
    // wave and is the entitlement gate, not this guard: it discloses only the
    // caller's own membership, which the caller already knows.)
    const vehicle = await as(DUAL, `/api/investor/companies/${SPV_B}/co-members`);
    const lonely = await as(DUAL, `/api/investor/companies/${CO_DELTA}/co-members`);
    expect(lonely.status).toBe(200);
    expect(isSpvBackedCompany(CO_DELTA)).toBe(false); // it really is a company
    expect(vehicle.status).toBe(lonely.status);
    expect(JSON.stringify(vehicle.body)).toBe(JSON.stringify(lonely.body));
  }, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   PART M — MONEY AND PERCENTAGE DISCIPLINE
   ══════════════════════════════════════════════════════════════════════════ */
describe("W32·C5 · (M) money is integer minor units and percentages are fractions", () => {
  it("(M1) JPY FIXTURE — a zero-decimal vehicle reports the same integer minor units, unscaled", () => {
    const jpy = lpPositionFor(SPV_C, DUAL);
    expect(jpy, "DUAL is also an LP of the JPY vehicle — the dual case is not currency-specific").toBeTruthy();
    expect(jpy!.currency).toBe("JPY");
    // A hidden /100 or a hardcoded exponent 2 shows up here and only here.
    expect(jpy!.commitmentMinor).toBe(JPY_COMMIT_MINOR);
    expect(Number.isInteger(jpy!.commitmentMinor)).toBe(true);
    // The identical minor-unit input in a USD vehicle must be reported
    // identically — the store must not scale by currency at all.
    const usd = lpPositionFor(SPV_B, DUAL)!;
    expect(usd.currency).toBe("USD");
    expect(Number.isInteger(usd.commitmentMinor)).toBe(true);
  });

  it("(M2) ownership is a FRACTION on the wire, never a percent", () => {
    const p = lpPositionFor(SPV_B, DUAL)!;
    // DUAL 3,000,000 of (3,000,000 + 7,250,000) = 0.29268...
    expect(p.ownershipFraction).toBeGreaterThan(0);
    expect(p.ownershipFraction!).toBeLessThanOrEqual(1);
    expect(p.ownershipFraction!).toBeCloseTo(DUAL_COMMIT_MINOR / (DUAL_COMMIT_MINOR + OTHER_COMMIT_MINOR), 12);
    // The two LPs' fractions sum to 1 — an aggregate, not a disclosure.
    const other = lpPositionFor(SPV_B, LP_OTHER)!;
    expect(p.ownershipFraction! + other.ownershipFraction!).toBeCloseTo(1, 12);
  });

  it("(M3) NULLS, NOT ZEROS — an LP with no confirmed wire shows a blank WITH the rendered refusal that explains it", () => {
    // SPV_B has no funds confirmations at all.
    expect(n(`SELECT COUNT(*) n FROM spv WHERE id = ? AND terms_json IS NOT NULL`, SPV_B)).toBe(0);
    const b = lpPositionFor(SPV_B, DUAL)!;
    expect(b.calledCapitalMinor, "unfunded is UNKNOWN, not zero").toBeNull();
    expect(b.capitalAccountMinor).toBeNull();
    // A blank with no explanation is a silent drop. The specific sentence must
    // be present — asserting merely that refusalCopy is truthy passes even when
    // this sentence is deleted, because a NAV refusal can also populate it.
    expect(b.refusalCopy).toContain("No confirmed capital receipt is on record");
    expect(b.refusalCopy).toContain("rather than as zero");
    // THE OPPOSITE POLE: a funded LP gets a number and NOT this sentence.
    const d = lpPositionFor(SPV_D, DUAL)!;
    expect(d.calledCapitalMinor).toBe(D_DUAL_CALLED_MINOR);
    expect(d.refusalCopy ?? "").not.toContain("No confirmed capital receipt is on record");
  });

  it("(M5) called capital is THIS LP's confirmed receipts only — the other LP's wire is not borrowed", () => {
    const d = lpPositionFor(SPV_D, DUAL)!;
    expect(d.calledCapitalMinor).toBe(D_DUAL_CALLED_MINOR);
    // The pole that makes the assertion mean something: the other LP's
    // confirmation IS on the same vehicle, at a different amount, so a store
    // that dropped the per-LP filter would produce a nameable wrong number.
    const o = lpPositionFor(SPV_D, LP_OTHER)!;
    expect(o.calledCapitalMinor).toBe(D_OTHER_CALLED_MINOR);
    expect(d.calledCapitalMinor).not.toBe(D_DUAL_CALLED_MINOR + D_OTHER_CALLED_MINOR);
    // Integer minor units, not a float and not a major-unit string.
    expect(Number.isInteger(d.calledCapitalMinor)).toBe(true);
  });

  it("(M6) distributions are THIS LP's own allocation line, and the capital account subtracts them", () => {
    const d = lpPositionFor(SPV_D, DUAL)!;
    expect(d.distributionsReceivedMinor).toBe(D_DUAL_DIST_MINOR);
    const o = lpPositionFor(SPV_D, LP_OTHER)!;
    expect(o.distributionsReceivedMinor).toBe(D_OTHER_DIST_MINOR);
    // Both poles of the arithmetic: a `+` instead of `-` is a different number.
    expect(d.capitalAccountMinor).toBe(D_DUAL_CALLED_MINOR - D_DUAL_DIST_MINOR);
    expect(d.capitalAccountMinor).not.toBe(D_DUAL_CALLED_MINOR + D_DUAL_DIST_MINOR);
    expect(Number.isInteger(d.capitalAccountMinor!)).toBe(true);
  });

  it("(M7) NEVER SUM ACROSS CURRENCIES — a USD vehicle with a EUR distribution refuses instead of totalling", () => {
    const e = lpPositionFor(SPV_E, DUAL)!;
    expect(e.currency).toBe("USD");
    // The EUR event is really there — otherwise this refusal proves nothing.
    expect(n(`SELECT COUNT(*) n FROM spv_distribution WHERE spv_id = ? AND currency = 'EUR'`, SPV_E)).toBe(1);
    expect(e.capitalAccountMinor, "a combined total across currencies must not be produced").toBeNull();
    expect(e.refusalCopy).toBeTruthy();
    expect(e.refusalCopy!.toLowerCase()).toContain("more than one currency");
    // The refusal is rendered copy, not a code: a human can read it.
    expect(e.refusalCopy!.split(" ").length).toBeGreaterThan(6);
    // And the opposite pole: the single-currency vehicle DOES produce a total.
    expect(lpPositionFor(SPV_D, DUAL)!.capitalAccountMinor).not.toBeNull();
  });

  it("(M4) the forbidden money and iterator idioms appear in no CODE of this capability", () => {
    for (const f of ["server/lpPositionsStore.ts", "server/lpPositionsRoutes.ts", "client/src/components/investor/LpPositions.tsx"]) {
      const src = codeOf(f);
      expect(src, `${f}: the percentage repair n > 1 ? n/100 : n is forbidden`).not.toMatch(/>\s*1\s*\?[^;]*\/\s*100/);
      expect(src, `${f}: Math.round on a per-party share is forbidden`).not.toMatch(/Math\.round/);
      expect(src, `${f}: spread an iterator — use Array.from`).not.toMatch(/\[\s*\.\.\.[A-Za-z_$][\w$.]*\.(values|keys|entries)\(\)/);
      expect(src, `${f}: never divide a minor amount by 100 to render it`).not.toMatch(/Minor\s*\/\s*100/);
    }
    // Pole: the stripper did not simply return an empty string, which would
    // make every assertion above vacuous.
    expect(codeOf("server/lpPositionsStore.ts")).toContain("LP_COLLECTIVE_SCOPE");
    expect(codeOf("server/lpPositionsStore.ts").length).toBeGreaterThan(1500);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PART S — THE SCOPE FLAG (the OPEN owner question, §6)
   ══════════════════════════════════════════════════════════════════════════ */
describe("W32·C5 · (S) the collective-scope flag is a constant, not an environment read", () => {
  it("(S1) the built default is vehicle_only — least privilege — and it is on the wire", async () => {
    expect(LP_COLLECTIVE_SCOPE).toBe("vehicle_only");
    const r = await as(DUAL, "/api/investor/me/lp-positions");
    expect(r.body.collectiveScope).toBe("vehicle_only");
    const one = await as(DUAL, `/api/investor/me/lp-positions/${SPV_B}`);
    expect(one.body.collectiveScope).toBe("vehicle_only");
  }, 60_000);

  it("(S2) the flag is NOT read from process.env — a scope that moves with the ambient environment is unassertable", () => {
    const code = codeOf("server/lpPositionsStore.ts");
    expect(code, "the scope must not be an environment read").not.toMatch(/process\.env/);
    // ...and it is a single named constant with a declared union, so ruling the
    // other way is a configuration change rather than a rewrite.
    expect(code).toMatch(/export const LP_COLLECTIVE_SCOPE: LpCollectiveScope = "vehicle_only";/);
    expect(code).toMatch(/"vehicle_only"\s*\|\s*"collective_access"/);
    // Exactly ONE assignment site, so there is one place to change.
    expect((code.match(/LP_COLLECTIVE_SCOPE\s*[:=]/g) ?? []).length).toBe(1);
  });

  it("(S3) NO per-account LP flag was introduced — the dual-position human stays representable", () => {
    for (const f of [
      "server/lpPositionsStore.ts",
      "server/lpPositionsRoutes.ts",
      "client/src/components/investor/LpPositions.tsx",
    ]) {
      const code = codeOf(f);
      expect(code, `${f} must not introduce an is_lp column`).not.toMatch(/is_lp\b/);
      expect(code, `${f} must not branch on an LP account type`).not.toMatch(/accountType|userType|role\s*===\s*["']lp["']/);
    }
    // No migration in this wave adds such a column either.
    const fs = require("node:fs") as typeof import("node:fs");
    for (const dir of ["migrations"]) {
      for (const f of fs.readdirSync(dir).filter((x: string) => x.startsWith("0178"))) {
        expect(fs.readFileSync(`${dir}/${f}`, "utf8")).not.toMatch(/is_lp\b/);
      }
    }
    // Proven by BEHAVIOUR, not only by grep: the same account is unscoped in
    // one company and scoped in one vehicle at the same instant.
    const ctx = getUserContextForId(DUAL);
    expect(ctx.investor.capTablePositions.map((p) => p.companyId)).toContain(CO_ALPHA);
    expect(lpPositionsFor(DUAL).map((p) => p.spvId)).toContain(SPV_B);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PART U — THE MOUNT. A COMPONENT MOUNTED NOWHERE IS NOT SHIPPED.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W32·C5 · (U) LpPositions is actually mounted in the investor portfolio", () => {
  it("(U1) Portfolio.tsx imports AND renders <LpPositions /> — an import alone is not a mount", () => {
    const src = rawOf("client/src/pages/investor/Portfolio.tsx");
    const code = codeOf("client/src/pages/investor/Portfolio.tsx");
    expect(code).toMatch(/import\s*\{\s*LpPositions\s*\}\s*from\s*["']@\/components\/investor\/LpPositions["']/);
    expect(code).toMatch(/<LpPositions\s*\/>/);
    /* WAVE 37 — THE TEST WAS STALE (over-specified), THE CODE IS CORRECT.
     *
     * This block previously required the text between `<LpPositions />` and
     * `</PageBody>` to be EMPTY — i.e. that LpPositions be the single last
     * child forever. WAVE 33 / CP-SPV-53 then APPENDED `<SpvInvitations />`
     * after it, obeying the very same guard rule this case exists to enforce:
     * append at the END as a sibling, never insert mid-list
     * (`client/src/pages/investor/Portfolio.tsx:155-174`, where both blocks
     * carry that reasoning). So the code did the right thing and the
     * assertion, written as "nothing may ever follow me", could only be
     * satisfied by forbidding all future compliant appends.
     *
     * STRENGTHENED, not loosened. "Nothing after LpPositions" only ever
     * constrained ONE boundary. The replacement pins the FULL ORDERED LIST of
     * components rendered inside PageBody, so an insertion ANYWHERE in the
     * list — not merely after LpPositions — fails, which the old assertion
     * could not detect. LpPositions and SpvInvitations are additionally
     * required to be the final two, in that order, and the sibling/text-node
     * check is kept for both. */
    const PAGEBODY_CHILDREN = [
      "PortfolioCompanySwitcher",
      "PortfolioCompanyOverview",
      "LpPositions",
      "SpvInvitations",
    ];
    const bodyStart = code.indexOf("<PageBody");
    const bodyEnd = code.indexOf("</PageBody>");
    expect(bodyStart).toBeGreaterThan(0);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    const rendered = Array.from(
      code.slice(bodyStart + "<PageBody".length, bodyEnd).matchAll(/<([A-Z][A-Za-z0-9_]*)/g),
      (m) => m[1],
    );
    // Exact sequence — a mid-list insert, a removal, or a reorder all fail.
    expect(rendered).toEqual(PAGEBODY_CHILDREN);
    // ...and the guard-relevant tail: this wave's mount, then Wave 33's.
    expect(rendered.slice(-2)).toEqual(["LpPositions", "SpvInvitations"]);

    // APPENDED, not inserted mid-list: nothing but the later-appended
    // SpvInvitations sibling (and comments/whitespace) may follow LpPositions.
    const render = src.indexOf("<LpPositions />");
    const close = src.indexOf("</PageBody>");
    expect(render).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(render);
    const codeAfter = codeOf("client/src/pages/investor/Portfolio.tsx");
    const cRender = codeAfter.indexOf("<LpPositions />");
    const cClose = codeAfter.indexOf("</PageBody>");
    // `codeOf` blanks comment bodies but leaves the `{ }` JSX-expression
    // wrapper behind; drop those empty wrappers before comparing.
    const between = codeAfter
      .slice(cRender + "<LpPositions />".length, cClose)
      .replace(/\{\s*\}/g, "")
      .trim();
    expect(between).toBe("<SpvInvitations />");

    // Both are SIBLING elements, not text appended inside an existing text
    // node: the character before each, ignoring whitespace and comments,
    // closes a JSX expression or a sibling element.
    for (const tag of ["<LpPositions />", "<SpvInvitations />"]) {
      const before = codeAfter.slice(0, codeAfter.indexOf(tag)).trimEnd();
      expect(before.endsWith("}") || before.endsWith(">")).toBe(true);
    }
  });

  it("(U2) there is NO second portal and no second auth surface — ruling A-23", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    expect(fs.existsSync("client/src/pages/lp")).toBe(false);
    // ...and the route the page calls is an INVESTOR route, not an /api/lp one.
    expect(codeOf("server/lpPositionsRoutes.ts")).not.toMatch(/["']\/api\/lp/);
    expect(codeOf("server/lpPositionsRoutes.ts")).toContain("/api/investor/me/lp-positions");
  });

  it("(U3) the mounted component reads the route this wave added, and can render no other LP", () => {
    const code = codeOf("client/src/components/investor/LpPositions.tsx");
    expect(code).toContain("/api/investor/me/lp-positions");
    // An LP interest must never read as a direct holding.
    expect(rawOf("client/src/components/investor/LpPositions.tsx")).toContain("Vehicle interest (LP)");
    // Nothing in the component can render another LP even if a future server
    // response carried one.
    expect(code).not.toMatch(/coInvestors|lpShares|\bregister\b|otherLps/);
    // Pole: the stripper left real code behind.
    expect(code).toContain("useQuery");
  });

  it("(U4) the routes are registered in the real stack, not merely exported", () => {
    const code = codeOf("server/routes.ts");
    expect(code).toMatch(/registerLpPositionsRoutes\(app\)/);
    // Proven by execution too — (0b) and (C1) drove them over the real stack.
  });
});
