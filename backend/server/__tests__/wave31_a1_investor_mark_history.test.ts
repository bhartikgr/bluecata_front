/**
 * WAVE 31 · W31-A1 — falsification harness for the investor mark-history wiring.
 *
 * ── WHAT WAS ACTUALLY WRONG, VERIFIED AT SOURCE BEFORE ANY CODE ────────────
 * `server/sprint20Wave2Routes.ts` registered
 * `GET /api/investor/portfolio/:id/marks` with a body that consulted no
 * database at all — `res.json({ holdingId: id, marks: [] })` — under a comment
 * saying "Wave 3 will populate from a real marks table". The `valuation_event`
 * table (migration 0159) had existed since Wave 9 with a full store on top of
 * it. The client chart therefore rendered "No mark history yet" unconditionally
 * and permanently, and no action any user could take would change it.
 *
 * ── THE THREE TRAPS THIS FILE IS WRITTEN AGAINST ───────────────────────────
 *
 * 1. **A DATA test that passes against the OLD STUB.** This is the trap that
 *    matters most here, because the stub returned a well-formed, plausible
 *    object. `expect(res.status).toBe(200)` passes against it. So does
 *    `expect(body).toHaveProperty("marks")`. So does
 *    `expect(Array.isArray(body.marks)).toBe(true)`. A whole suite of those
 *    would have been green on the day the stub shipped and green every day for
 *    twenty-eight waves. Case (7) exists solely to close this: it asserts a
 *    NON-EMPTY series with the exact minor-unit integers that were seeded, which
 *    is the one assertion no constant `[]` can satisfy. Every data case in this
 *    file asserts a value that had to come out of the database.
 *
 * 2. **An authorization predicate with an unreachable pole.** Wave 30's mutant
 *    M14 survived because a correct branch could not be reached by any input,
 *    so no assertion could falsify it. `investorHoldsCompany` is therefore
 *    exported and tested DIRECTLY at both poles — cases (1) and (2) — as well
 *    as through the route. A predicate that returns `true` for everyone and one
 *    that returns `false` for everyone are both catastrophic and both invisible
 *    to a single-pole test.
 *
 * 3. **Probing anonymity when the control is authorization** (Wave 29's find:
 *    its probe harness authenticated as a demo persona, so every route looked
 *    open). The control here is "does THIS investor hold THIS company", so the
 *    adversary in cases (10) and (11) is a REAL, FULLY AUTHENTICATED SECOND
 *    INVESTOR who genuinely holds a different company — not an anonymous
 *    caller. Anonymity is tested separately in case (9) because it is a
 *    different control (401 vs 404).
 *
 * ── 404, NOT 403 ───────────────────────────────────────────────────────────
 * Case (11) does not merely assert "it is a 404". It asserts that the refusal
 * for a company that EXISTS AND HAS MARKS but is not held is BYTE-IDENTICAL to
 * the refusal for a company id that exists nowhere. Asserting the status code
 * alone would still pass if the bodies differed by one word, and one word is
 * all an enumeration oracle needs.
 *
 * ── MONEY (rule 5) ─────────────────────────────────────────────────────────
 * A JPY fixture is present and load-bearing, not decorative. Case (8) seeds
 * ¥900,000 as the integer `900000` (JPY exponent 0 — the minor unit IS the yen)
 * and asserts the value survives to the caller UNCHANGED. Any `/ 100`, any
 * `* 100`, any `Math.round` anywhere on the path turns 900000 into 9000 or
 * 90000000, and the case fails. Case (12) seeds one USD and one JPY mark on the
 * same company and asserts the reader REFUSES with `MARKS_SPAN_CURRENCIES`
 * rather than returning a mixed series — never plot across currencies.
 *
 * ── NULLS, NOT ZEROS ───────────────────────────────────────────────────────
 * Case (6) asserts that a company with no marks yields `currency: null` and
 * `unavailableReason: "NO_MARKS_RECORDED"` — NOT `fairValueMinor: 0` and NOT a
 * bare `[]` that would be indistinguishable from the refusal in case (12).
 *
 * ── ENV ────────────────────────────────────────────────────────────────────
 * This file sets no environment variable, so there is none to restore. That is
 * deliberate: the build has been burned by an unrestored `process.env` write
 * and by a test asserting `DISABLE_DEV_BYPASS=1` without setting it. The way to
 * be safe from both is to have no env dependency to get wrong.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { rawDb } from "../db/connection";
import {
  investorHoldsCompany,
  markHistoryForCompany,
} from "../lib/investorMarkHistory";
import { ensureWave9Schema } from "../wave9ReportingStore";
import { registerSprint20Wave2Routes } from "../sprint20Wave2Routes";

/* Fixtures are namespaced `w31a1_` so they cannot collide with seeded platform
   data and so a failed run leaves obviously-attributable rows behind. */
const INV_A = "w31a1_investor_a";
const INV_B = "w31a1_investor_b";
const CO_HELD = "w31a1_co_held"; // held by A, has USD marks
const CO_JPY = "w31a1_co_jpy"; // held by A, has a JPY mark
const CO_MIXED = "w31a1_co_mixed"; // held by A, has USD *and* JPY marks
const CO_EMPTY = "w31a1_co_empty"; // held by A, has NO marks
const CO_OTHER = "w31a1_co_other"; // held by B only, HAS marks — the oracle bait
const CO_NOWHERE = "w31a1_co_does_not_exist"; // held by nobody, no rows anywhere
const TENANT = "w31a1_tenant";

let db: any;

function insertCommit(id: string, investorId: string, companyId: string) {
  db.prepare(
    `INSERT OR REPLACE INTO captable_commits
       (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
        amount, currency, shares, state, prev_hash, hash, reconcile_match,
        compliance_hold, instrument_class, deleted_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, '1000.00', 'USD', '100', 'committed',
             'w31a1_prev', ?, 1, 0, 'priced', NULL)`,
  ).run(id, TENANT, new Date().toISOString(), `${id}_inv`, `${id}_round`, companyId, investorId, `${id}_hash`);
}

function insertMark(args: {
  id: string;
  companyId: string;
  date: string;
  minor: number;
  currency: string;
  holdingId?: string | null;
  superseded?: boolean;
}) {
  db.prepare(
    `INSERT OR REPLACE INTO valuation_event
       (id, tenant_id, vehicle_kind, vehicle_id, holding_id, valuation_date,
        fair_value_minor, currency, method, source, source_ref, preparer,
        is_external, created_by, actor_id, seq, created_at, superseded_at)
     -- WAVE 38 ROW 4 — migration 0183 gave valuation_event its ledger
     -- primitives: actor_id NOT NULL and seq NOT NULL CHECK (seq > 0). The
     -- production writer (wave9ReportingStore.insertValuationEvent) supplies
     -- both; this fixture did not, so it began failing at COLLECT time and
     -- skipped all 20 tests. It now writes the same shape the shipped path
     -- writes — actor_id = created_by (a real preparer, nothing invented) and
     -- a real per-parent seq derived in-statement, not a constant.
     VALUES (?, ?, 'company', ?, ?, ?, ?, ?, 'last_priced_round', 'derived_priced_round', NULL,
             'w31a1_preparer', 0, 'w31a1_seed', 'w31a1_seed',
             (SELECT COALESCE(MAX(seq), 0) + 1 FROM valuation_event
               WHERE vehicle_kind = 'company' AND vehicle_id = ?),
             ?, ?)`,
  ).run(
    args.id,
    TENANT,
    args.companyId,
    args.holdingId ?? null,
    args.date,
    args.minor,
    args.currency,
    args.companyId,
    new Date().toISOString(),
    args.superseded ? new Date().toISOString() : null,
  );
}

function insertOverride(args: {
  id: string;
  eventId: string;
  companyId: string;
  minor: number;
  priorMinor: number;
  currency: string;
  state: "pending" | "approved" | "rejected";
  at: string;
}) {
  db.prepare(
    `INSERT OR REPLACE INTO valuation_mark_override
       (id, tenant_id, valuation_event_id, vehicle_kind, vehicle_id, holding_id,
        prior_fair_value_minor, fair_value_minor, currency, reason,
        overridden_by, overridden_at, approval_state, approved_by, approved_at,
        approval_note, grandfathered_effective)
     VALUES (?, ?, ?, 'company', ?, NULL, ?, ?, ?, 'w31a1 reason',
             'w31a1_gp', ?, ?, NULL, NULL, NULL, 0)`,
  ).run(
    args.id,
    TENANT,
    args.eventId,
    args.companyId,
    args.priorMinor,
    args.minor,
    args.currency,
    args.at,
    args.state,
  );
}

/**
 * An express app carrying THE PRODUCTION REGISTRAR, with an injectable identity.
 *
 * ── THIS WAS A HARNESS BUG, CAUGHT BY MUTATION AND FIXED HERE ──────────────
 * The first version of this helper re-declared the handler inline, "mirroring
 * the production handler exactly". Mutation testing then removed the
 * authorization check from the REAL route file (M17), swapped its 404 for a 403
 * (M18), and deleted its authentication check (M19) — and all three mutants
 * SURVIVED, because the suite was exercising the copy and production was never
 * loaded. A harness that tests a reproduction of the code is the purest form of
 * the defect this build keeps hitting: it passes while checking nothing that
 * ships.
 *
 * It now calls `registerSprint20Wave2Routes(app)` — the exact function
 * `server/routes.ts` calls. Any edit to the shipped handler is felt here.
 *
 * It deliberately does NOT mount `gate("investor.hasAnyCapTable")`. That gate
 * is the ENTITLEMENT layer and it is not what this file is testing — including
 * it would mean a pass could come from the prefix gate rather than from the
 * handler's own per-company check, which is Wave 29's "the probe authenticated
 * as a demo persona, so every route looked open" in reverse. Stripping the
 * outer layer is what makes the handler's own refusal falsifiable.
 */
function appAs(identity: { isAuthed: boolean; userId?: string }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userContext = identity;
    next();
  });
  registerSprint20Wave2Routes(app);
  return app;
}

beforeAll(() => {
  ensureWave9Schema();
  db = rawDb();

  // ── Holdings ────────────────────────────────────────────────────────────
  insertCommit("w31a1_c1", INV_A, CO_HELD);
  insertCommit("w31a1_c2", INV_A, CO_JPY);
  insertCommit("w31a1_c3", INV_A, CO_MIXED);
  insertCommit("w31a1_c4", INV_A, CO_EMPTY);
  insertCommit("w31a1_c5", INV_B, CO_OTHER);

  // ── Marks ───────────────────────────────────────────────────────────────
  // Inserted OUT of date order on purpose: the reader must sort, and a test
  // that seeds in order cannot tell a sorted reader from an unsorted one.
  insertMark({ id: "w31a1_m2", companyId: CO_HELD, date: "2026-04-01", minor: 275000_00, currency: "USD" });
  insertMark({ id: "w31a1_m1", companyId: CO_HELD, date: "2026-01-01", minor: 150000_00, currency: "USD" });
  insertMark({ id: "w31a1_m3", companyId: CO_HELD, date: "2026-07-01", minor: 310000_00, currency: "USD" });
  // Superseded — a revision of m3 that must NOT appear as a second point.
  insertMark({
    id: "w31a1_m3_old",
    companyId: CO_HELD,
    date: "2026-07-01",
    minor: 999999_00,
    currency: "USD",
    superseded: true,
  });
  // Holding-scoped mark, used by case (13).
  insertMark({
    id: "w31a1_m_lot",
    companyId: CO_HELD,
    date: "2026-05-01",
    minor: 200000_00,
    currency: "USD",
    holdingId: "w31a1_lot_x",
  });

  // JPY: exponent 0. ¥900,000 IS 900000 minor units, not 90,000,000.
  //
  // The third figure is NOT round, and that is the point. Mutation testing
  // planted `Math.round(x / 100) * 100` (M9) and it SURVIVED, because every
  // fixture here was a whole dollar or a round yen amount and therefore already
  // a multiple of 100 — the mutation was a no-op ON THIS DATA. A coverage gap,
  // not an equivalent mutant, and closed by seeding a value that a hundredths
  // round-trip would visibly damage. Real marks are not round numbers.
  insertMark({ id: "w31a1_jpy1", companyId: CO_JPY, date: "2026-02-01", minor: 900000, currency: "JPY" });
  insertMark({ id: "w31a1_jpy2", companyId: CO_JPY, date: "2026-06-01", minor: 1250000, currency: "JPY" });
  insertMark({ id: "w31a1_jpy3", companyId: CO_JPY, date: "2026-09-01", minor: 1234567, currency: "JPY" });

  // Mixed denomination on ONE company.
  insertMark({ id: "w31a1_mx1", companyId: CO_MIXED, date: "2026-01-01", minor: 100000_00, currency: "USD" });
  insertMark({ id: "w31a1_mx2", companyId: CO_MIXED, date: "2026-02-01", minor: 5000000, currency: "JPY" });

  // The oracle bait: a company with REAL marks that investor A does not hold.
  insertMark({ id: "w31a1_o1", companyId: CO_OTHER, date: "2026-03-01", minor: 440000_00, currency: "USD" });
});

describe("W31-A1 · investor mark history — the stub is gone and the engine is on the wire", () => {
  /* (0) The PRODUCTION registration, not a local fiction.
     The route body is reproduced in `appAs` above so identity can be injected
     without booting the whole server. That reproduction is only trustworthy if
     the real file registers the real handler, so this case reads the shipped
     source and asserts the stub's literal is GONE and the wiring is present.
     Without it, every case below could pass while production still served
     `{ marks: [] }`. */
  it("(0) the shipped route file no longer contains the hardcoded empty-marks literal", async () => {
    const fs = await import("node:fs");
    const raw = fs.readFileSync(
      new URL("../sprint20Wave2Routes.ts", import.meta.url),
      "utf8",
    );
    /* COMMENTS ARE STRIPPED FIRST, and this is not a detail.
       The first version of this case asserted `not.toContain("marks: [] }")`
       against the raw file and FAILED — because the replacement's own doc
       comment QUOTES the literal it removed, as the record of what was there.
       A source-text assertion that cannot tell code from prose is exactly the
       "check that passes while checking nothing" class in its mirror image:
       here it failed on correct code, but the same blindness would let a stub
       hide inside a comment-shaped string. So: strip block and line comments,
       then assert against EXECUTABLE text only. */
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Self-check on the stripper: if it ever removed everything, every
    // `not.toContain` below would pass vacuously.
    expect(src).toContain("registerSprint20Wave2Routes");
    expect(src.length).toBeGreaterThan(1000);

    expect(src).not.toContain("marks: [] }");
    expect(src).not.toContain("Stub");
    expect(src).toContain("markHistoryForCompany");
    expect(src).toContain("investorHoldsCompany");
  });

  /* (1)/(2) BOTH POLES of the authorization predicate, directly.
     A predicate stuck at `true` and one stuck at `false` are both wrong; only
     asserting both poles distinguishes either from a correct one. */
  it("(1) investorHoldsCompany is TRUE for an investor with a committed position", () => {
    expect(investorHoldsCompany(INV_A, CO_HELD)).toBe(true);
  });

  it("(2) investorHoldsCompany is FALSE for a real investor without a position in that company", () => {
    // INV_B is a real investor with a real holding — just not in CO_HELD.
    expect(investorHoldsCompany(INV_B, CO_HELD)).toBe(false);
    expect(investorHoldsCompany(INV_A, CO_OTHER)).toBe(false);
  });

  it("(3) investorHoldsCompany fails CLOSED on empty inputs", () => {
    expect(investorHoldsCompany("", CO_HELD)).toBe(false);
    expect(investorHoldsCompany(INV_A, "")).toBe(false);
  });

  /* (3b) THE UNREACHABLE BRANCH, MADE REACHABLE.
     Mutation testing flipped the ledger-read `catch` to `return true` — a
     fail-OPEN authorization gate — and the mutant survived, because
     `listCommitsForUser` catches internally and cannot be made to throw from
     outside. Unreachable is not the same as untested, and only mutation
     separates them. The lookup is now an injectable seam, so the catch has a
     reachable pole and an assertion can sit on it. Both poles, as always: a
     throwing lookup must refuse, and a working one must still admit. */
  it("(3b) a throwing ledger lookup fails CLOSED, and a working one still admits", () => {
    const throwing = () => {
      throw new Error("w31a1: simulated ledger failure");
    };
    expect(investorHoldsCompany(INV_A, CO_HELD, throwing as any)).toBe(false);
    // Control on the same seam — without it, a gate hardwired to `false` would
    // pass the line above.
    expect(investorHoldsCompany(INV_A, CO_HELD, (() => ({ length: 1 })) as any)).toBe(true);
  });

  /* (4) A soft-deleted / uncommitted row must not confer access. The store's
     definition of a live holding is `state='committed' AND deleted_at IS NULL`;
     if the predicate read the raw table instead, this would pass anyway. */
  it("(4) a soft-deleted commit does not confer access", () => {
    const CO_DEL = "w31a1_co_deleted";
    insertCommit("w31a1_cdel", INV_A, CO_DEL);
    expect(investorHoldsCompany(INV_A, CO_DEL)).toBe(true); // control
    db.prepare(`UPDATE captable_commits SET deleted_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      "w31a1_cdel",
    );
    expect(investorHoldsCompany(INV_A, CO_DEL)).toBe(false); // the pole that matters
  });

  it("(5) a non-committed commit does not confer access", () => {
    const CO_PEND = "w31a1_co_pending";
    insertCommit("w31a1_cpend", INV_A, CO_PEND);
    expect(investorHoldsCompany(INV_A, CO_PEND)).toBe(true); // control
    db.prepare(`UPDATE captable_commits SET state = 'pending' WHERE id = ?`).run("w31a1_cpend");
    expect(investorHoldsCompany(INV_A, CO_PEND)).toBe(false);
  });

  /* (6) NULLS, NOT ZEROS — and a reason, not a bare empty array. */
  it("(6) a company with no marks returns NO_MARKS_RECORDED with a NULL currency, not a zero", () => {
    const h = markHistoryForCompany(CO_EMPTY);
    expect(h.marks).toEqual([]);
    expect(h.currency).toBeNull();
    expect(h.unavailableReason).toBe("NO_MARKS_RECORDED");
    // The refusal must be DISTINGUISHABLE from the mixed-currency refusal,
    // which also has zero marks. If both said only `[]`, the UI could not tell
    // "nothing yet" from "we will not show you this".
    expect(h.unavailableReason).not.toBe("MARKS_SPAN_CURRENCIES");
  });

  /* (7) THE CASE THE OLD STUB CANNOT PASS.
     Exact minor-unit integers, in date order, with the superseded revision
     excluded. No constant can satisfy this. */
  it("(7) returns the real dated series in minor units, oldest first, excluding superseded rows", () => {
    const h = markHistoryForCompany(CO_HELD);
    expect(h.unavailableReason).toBeNull();
    expect(h.currency).toBe("USD");
    expect(h.marks.map((m) => m.valuationDate)).toEqual([
      "2026-01-01",
      "2026-04-01",
      "2026-05-01",
      "2026-07-01",
    ]);
    expect(h.marks.map((m) => m.fairValueMinor)).toEqual([
      15000000, 27500000, 20000000, 31000000,
    ]);
    // The superseded ¥/$999,999 revision must be absent — asserted by value,
    // not just by count, so a reader that dropped a DIFFERENT row still fails.
    expect(h.marks.map((m) => m.id)).not.toContain("w31a1_m3_old");
    expect(h.marks.every((m) => m.currency === "USD")).toBe(true);
  });

  /* (8) JPY FIXTURE — the exponent-0 trap. */
  it("(8) JPY marks survive the read unscaled: ¥900,000 stays 900000 minor units", () => {
    const h = markHistoryForCompany(CO_JPY);
    expect(h.currency).toBe("JPY");
    expect(h.marks.map((m) => m.fairValueMinor)).toEqual([900000, 1250000, 1234567]);
    // Explicit anti-assertions for the two ways this goes wrong.
    expect(h.marks[0].fairValueMinor).not.toBe(9000); //  ÷100
    expect(h.marks[0].fairValueMinor).not.toBe(90000000); // ×100
    expect(Number.isInteger(h.marks[0].fairValueMinor)).toBe(true);
    // ¥1,234,567 is not a multiple of 100, so any hundredths round-trip
    // (`Math.round(x / 100) * 100`) lands on 1234600 and this fails. Every
    // other fixture in this file is round enough to survive that mutation
    // silently — which is precisely why this one exists.
    expect(h.marks[2].fairValueMinor).toBe(1234567);
    expect(h.marks[2].fairValueMinor % 100).not.toBe(0);
  });

  /* (9) Anonymity — a DIFFERENT control from authorization, tested separately. */
  it("(9) an unauthenticated caller is refused 401", async () => {
    const res = await request(appAs({ isAuthed: false })).get(
      `/api/investor/portfolio/${CO_HELD}/marks`,
    );
    expect(res.status).toBe(401);
  });

  /* (10) THE PROBE MATCHES THE CONTROL (rule 3): a real, authenticated,
     entitled second investor — not an anonymous one. */
  it("(10) a real authenticated investor who does not hold the company is refused 404", async () => {
    const res = await request(appAs({ isAuthed: true, userId: INV_B })).get(
      `/api/investor/portfolio/${CO_HELD}/marks`,
    );
    expect(res.status).toBe(404);
    // Control, same probe, same run: B CAN read the company B holds. Without
    // this pole a handler that refused everyone would pass the line above.
    const ok = await request(appAs({ isAuthed: true, userId: INV_B })).get(
      `/api/investor/portfolio/${CO_OTHER}/marks`,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.marks).toHaveLength(1);
    expect(ok.body.marks[0].fairValueMinor).toBe(44000000);
  });

  /* (11) NO ENUMERATION ORACLE — identity of the two refusals, not just status. */
  it("(11) the refusal for an unheld real company is BYTE-IDENTICAL to that for a nonexistent one", async () => {
    const agent = request(appAs({ isAuthed: true, userId: INV_A }));
    const unheld = await agent.get(`/api/investor/portfolio/${CO_OTHER}/marks`);
    const nowhere = await request(appAs({ isAuthed: true, userId: INV_A })).get(
      `/api/investor/portfolio/${CO_NOWHERE}/marks`,
    );
    expect(unheld.status).toBe(404);
    expect(nowhere.status).toBe(404);
    // CO_OTHER genuinely has marks; CO_NOWHERE has no row of any kind. If the
    // handler leaked that difference in any way, these strings would differ.
    expect(JSON.stringify(unheld.body)).toBe(JSON.stringify(nowhere.body));
    expect(unheld.text).toBe(nowhere.text);
  });

  /* (12) NEVER PLOT ACROSS CURRENCIES. */
  it("(12) a company whose marks span currencies yields a REFUSAL, not a mixed series", () => {
    const h = markHistoryForCompany(CO_MIXED);
    expect(h.unavailableReason).toBe("MARKS_SPAN_CURRENCIES");
    expect(h.marks).toEqual([]);
    expect(h.currency).toBeNull();
    // Control: the same reader DOES return a series when the currency is
    // single. Without this, a reader that refused everything would pass.
    expect(markHistoryForCompany(CO_HELD).unavailableReason).toBeNull();
  });

  /* (13) The `?holdingId=` narrowing, both poles. */
  it("(13) holdingId narrows the series to that lot, and its absence returns all lots", () => {
    const all = markHistoryForCompany(CO_HELD);
    const lot = markHistoryForCompany(CO_HELD, { holdingId: "w31a1_lot_x" });
    expect(all.marks.length).toBe(4);
    expect(lot.marks.map((m) => m.id)).toEqual(["w31a1_m_lot"]);
    expect(lot.holdingId).toBe("w31a1_lot_x");
    // A holding that exists nowhere yields the empty REASON, not all rows —
    // a filter built with a falsy-collapsing `||` would return everything here.
    expect(markHistoryForCompany(CO_HELD, { holdingId: "w31a1_lot_none" }).unavailableReason).toBe(
      "NO_MARKS_RECORDED",
    );
  });

  /* (14)/(15) GP OVERRIDES — effectiveness decided by the single decider.
     Default approval mode is "required" (migration 0174), so a PENDING,
     non-grandfathered override must NOT take effect. A reader that filtered
     with `approval_state <> 'rejected'` in SQL would apply it and fail (15). */
  it("(14) an APPROVED override replaces the event's value in place, keeping the original", () => {
    const CO_OV = "w31a1_co_override";
    insertCommit("w31a1_cov", INV_A, CO_OV);
    insertMark({ id: "w31a1_ov_e1", companyId: CO_OV, date: "2026-03-01", minor: 100000_00, currency: "USD" });
    // Control BEFORE the override exists.
    expect(markHistoryForCompany(CO_OV).marks[0].fairValueMinor).toBe(10000000);

    insertOverride({
      id: "w31a1_ov1",
      eventId: "w31a1_ov_e1",
      companyId: CO_OV,
      minor: 125000_00,
      priorMinor: 100000_00,
      currency: "USD",
      state: "approved",
      at: "2026-03-02T00:00:00.000Z",
    });
    const h = markHistoryForCompany(CO_OV);
    expect(h.marks).toHaveLength(1); // replaced IN PLACE, not appended
    expect(h.marks[0].fairValueMinor).toBe(12500000);
    expect(h.marks[0].originalFairValueMinor).toBe(10000000);
    expect(h.marks[0].overrideId).toBe("w31a1_ov1");
  });

  it("(15) a PENDING override does NOT take effect under the default 'required' mode", () => {
    const CO_OV2 = "w31a1_co_override_pending";
    insertCommit("w31a1_cov2", INV_A, CO_OV2);
    insertMark({ id: "w31a1_ov_e2", companyId: CO_OV2, date: "2026-03-01", minor: 100000_00, currency: "USD" });
    insertOverride({
      id: "w31a1_ov2",
      eventId: "w31a1_ov_e2",
      companyId: CO_OV2,
      minor: 900000_00,
      priorMinor: 100000_00,
      currency: "USD",
      state: "pending",
      at: "2026-03-02T00:00:00.000Z",
    });
    const h = markHistoryForCompany(CO_OV2);
    expect(h.marks[0].fairValueMinor).toBe(10000000); // the EVENT's own figure
    expect(h.marks[0].overrideId).toBeNull();
  });

  /* (16) A later REJECTED override withdraws an earlier effective one.
     Skipping an ineffective row instead of deleting the map entry would leave
     the withdrawn figure on the chart. */
  it("(16) a later REJECTED override withdraws an earlier APPROVED one", () => {
    const CO_OV3 = "w31a1_co_override_withdrawn";
    insertCommit("w31a1_cov3", INV_A, CO_OV3);
    insertMark({ id: "w31a1_ov_e3", companyId: CO_OV3, date: "2026-03-01", minor: 100000_00, currency: "USD" });
    insertOverride({
      id: "w31a1_ov3a",
      eventId: "w31a1_ov_e3",
      companyId: CO_OV3,
      minor: 500000_00,
      priorMinor: 100000_00,
      currency: "USD",
      state: "approved",
      at: "2026-03-02T00:00:00.000Z",
    });
    expect(markHistoryForCompany(CO_OV3).marks[0].fairValueMinor).toBe(50000000); // control
    insertOverride({
      id: "w31a1_ov3b",
      eventId: "w31a1_ov_e3",
      companyId: CO_OV3,
      minor: 500000_00,
      priorMinor: 100000_00,
      currency: "USD",
      state: "rejected",
      at: "2026-03-03T00:00:00.000Z",
    });
    const h = markHistoryForCompany(CO_OV3);
    expect(h.marks[0].fairValueMinor).toBe(10000000);
    expect(h.marks[0].overrideId).toBeNull();
  });

  /* (17) An override in a DIFFERENT currency must trip the span check.
     The currency scan runs AFTER overrides are resolved for exactly this
     reason; scanning the events alone would miss it. */
  it("(17) an effective override in another currency trips MARKS_SPAN_CURRENCIES", () => {
    const CO_OV4 = "w31a1_co_override_currency";
    insertCommit("w31a1_cov4", INV_A, CO_OV4);
    insertMark({ id: "w31a1_ov_e4a", companyId: CO_OV4, date: "2026-03-01", minor: 100000_00, currency: "USD" });
    insertMark({ id: "w31a1_ov_e4b", companyId: CO_OV4, date: "2026-04-01", minor: 110000_00, currency: "USD" });
    expect(markHistoryForCompany(CO_OV4).unavailableReason).toBeNull(); // control
    insertOverride({
      id: "w31a1_ov4",
      eventId: "w31a1_ov_e4b",
      companyId: CO_OV4,
      minor: 1500000,
      priorMinor: 110000_00,
      currency: "JPY",
      state: "approved",
      at: "2026-04-02T00:00:00.000Z",
    });
    expect(markHistoryForCompany(CO_OV4).unavailableReason).toBe("MARKS_SPAN_CURRENCIES");
  });

  /* (18) End to end through the route for the rightful holder — the positive
     pole of cases (10)/(11), proving the refusals above are not simply what the
     handler does to everybody. */
  it("(18) the rightful holder receives the real series over HTTP", async () => {
    const res = await request(appAs({ isAuthed: true, userId: INV_A })).get(
      `/api/investor/portfolio/${CO_HELD}/marks`,
    );
    expect(res.status).toBe(200);
    expect(res.body.companyId).toBe(CO_HELD);
    expect(res.body.currency).toBe("USD");
    expect(res.body.unavailableReason).toBeNull();
    expect(res.body.marks.map((m: any) => m.fairValueMinor)).toEqual([
      15000000, 27500000, 20000000, 31000000,
    ]);
  });
});
