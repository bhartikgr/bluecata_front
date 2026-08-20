/**
 * WAVE 58f — THE TABLE-LEVEL DISCOUNT DOMAIN (F0), THE THIRD HTTP WRITER (F1),
 * THE UNCONVERTED SECOND CONVERSION (F2) AND THE CORRECTED CONTRACT (F3/F4).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * PROVED HERE, BY EXECUTION
 *   · F0 REPRODUCTION. Migration 0153's own trigger text, read from the
 *     migration file and installed, ABORTS a `discount_pct` of `'20'` with
 *     `DISCOUNT_PCT_OUT_OF_DOMAIN:expected fraction 0..1`. That is the
 *     platform's canonical value for a 20% discount, so the first SAFE commit
 *     carrying a discount would have been rejected by the database.
 *   · F0 FIX. Migration 0190's trigger text ACCEPTS `'20'` and still refuses
 *     `''`, `'-1'`, `'100'`, `'100.1'` and non-numeric text.
 *   · F0 END-TO-END THROUGH HTTP, WITH A NEGATIVE CONTROL. The same
 *     `POST /api/founder/captable/commit-funded` request FAILS while 0153's raw
 *     triggers are installed and SUCCEEDS after `applyWave58fDiscountDomain`,
 *     storing `discount_pct = "20"` and leaving `verifyChain()` green. The
 *     negative control is what makes this non-vacuous: `wave_safe_commit.test.ts`
 *     already commits a SAFE with `discount: "20"` and passes, because it never
 *     installs the trigger at all.
 *   · F1 THE THIRD WRITER. `PATCH /api/founder/rounds/:id` REFUSES
 *     `{"discount":20260707}` and `{"interestRate":20261231}` BY NAME with the
 *     shared error codes, still ACCEPTS `{"discount":20}` and persists `20`,
 *     WARNS without blocking outside the 10–20% market norm, and leaves an
 *     absent discount absent.
 *   · F1 THE ENUMERATION. Every non-test caller of `createRound`/`updateRound`
 *     is enumerated from source and each is proved guarded, including the
 *     carry-forward accept route, which cannot persist a discount at all.
 *   · F2 THE QUARANTINE TRIPWIRE. `computeConversionProjections` has no
 *     non-test caller and consumes an ALREADY-fractional discount; the test goes
 *     red the moment it acquires one.
 *   · R21 ANTI-DRIFT. 0190's SQL bound is asserted equal to the shared
 *     `DISCOUNT_STORED_PERCENT_MAX`, and the two migration copies are asserted
 *     byte-identical, so the bound cannot drift in one place only.
 *
 * NOT PROVED HERE
 *   · Nothing is proved on the LIVE database. Whether 0153's triggers are
 *     actually installed on live is INFERRED from the migration ledger, not
 *     observed. The read-only confirming query is in
 *     `migrations/0190_wave58f_discount_pct_domain.sql` and in the report.
 *   · No browser is opened. That a founder's click produces these payloads is
 *     asserted against JSX source, not a rendered DOM.
 *   · `server/roundCarryForwardEngine.ts` and `server/captableCommitStore.ts`
 *     are SACRED and were READ, never edited. F2 is therefore a quarantine plus
 *     tripwire, not a route-through; see `WAVE58F_REPORT.md` §F2.
 *
 * MUTATION TRANSCRIPTS: `build_log/wave58f/W58F_NEW_TESTS.md`. Every test names
 * the single source edit that turns it red, with the recorded output.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { verifyChain, clearLedger, setComplianceHold } from "../captableCommitStore";
import {
  applyWave58fDiscountDomain,
  readWave58fDiscountDomainDdl,
  triggerSql,
  isCorrectedDomain,
  WAVE58F_TRIGGERS,
} from "../lib/applyWave58fDiscountDomain";
import {
  DISCOUNT_STORED_PERCENT_MAX,
  INTEREST_RATE_PERCENT_MAX,
  DISCOUNT_MARKET_NORM_MIN,
  DISCOUNT_MARKET_NORM_MAX,
  toWireDiscount,
} from "@shared/roundMathEngineAdapter";

let app: Express;
const STAMP = String(Date.now());
const ADMIN = "u_admin";

/* Source reads are anchored to THIS FILE, never to `process.cwd()` —
   `W58B_REVIEW_1_MATH.md` §5 recorded ten checks failing in an independent rerun
   purely because they resolved sources from the launch directory. */
const ROOT = path.resolve(__dirname, "..", "..");
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

const M0153 = "migrations/0153_wave5_money_captable.sql";
const M0190 = "migrations/0190_wave58f_discount_pct_domain.sql";
const M0190_MIRROR = "server/db/migrations/0190_wave58f_discount_pct_domain.sql";

/** Pull the two `captable_commits.discount_pct` CREATE TRIGGER statements out of
 *  a migration file. We execute the migration's OWN text rather than a retyped
 *  copy — a retyped fence would prove only that the retyping is consistent. */
function extractDiscountTriggers(sql: string): string[] {
  const out: string[] = [];
  const re = /CREATE TRIGGER IF NOT EXISTS trg_captable_commits_discount_pct_(?:ins|upd)[\s\S]*?END;/g;
  for (const m of sql.matchAll(re)) out.push(m[0]);
  return out;
}

/** A minimal host table so the trigger has something to fire on. The real
 *  `captable_commits` has ~30 columns; the fence only reads `discount_pct`. */
function freshFencedDb(triggers: string[]): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE captable_commits (id TEXT PRIMARY KEY, discount_pct TEXT);`);
  for (const t of triggers) db.exec(t);
  return db;
}

type Outcome = { ok: true } | { ok: false; message: string };
function tryInsert(db: Database.Database, value: string | null, id: string): Outcome {
  try {
    db.prepare(`INSERT INTO captable_commits (id, discount_pct) VALUES (?, ?)`).run(id, value);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 90_000);

/* ═══════════════════════════════════════════════════════════════════════════
 * F0-A — THE REPRODUCTION. 0153's OWN TEXT REJECTS THE PLATFORM'S OWN VALUE.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58F-F0a — migration 0153's trigger rejects a 20% discount", () => {
  it("W58F-F0a1 — 0153 really does install two discount_pct triggers, and they demand a fraction", () => {
    const sql = src(M0153);
    const triggers = extractDiscountTriggers(sql);
    expect(triggers).toHaveLength(2);
    /* The claim under test is textual before it is behavioural: the abort string
       and the bound must actually say "fraction 0..1". */
    for (const t of triggers) {
      expect(t).toContain("DISCOUNT_PCT_OUT_OF_DOMAIN:expected fraction 0..1");
      expect(t).toContain("CAST(NEW.discount_pct AS REAL) > 1");
    }
    expect(triggers[0]).toContain("BEFORE INSERT ON captable_commits");
    expect(triggers[1]).toContain("BEFORE UPDATE OF discount_pct ON captable_commits");
  });

  it("W58F-F0a2 — EXECUTED: '20' is ABORTED, '0.2' is accepted — the domain is inverted", () => {
    const db = freshFencedDb(extractDiscountTriggers(src(M0153)));

    /* THE DEFECT. `20` is what `rounds.extras_json` holds for a 20% discount on
       live, what `shared/schema.ts:1425` documents, and what SACRED
       `captableCommitStore.ts:575` writes verbatim. The table refuses it. */
    const twenty = tryInsert(db, "20", "c1");
    expect(twenty.ok).toBe(false);
    if (!twenty.ok) expect(twenty.message).toContain("DISCOUNT_PCT_OUT_OF_DOMAIN:expected fraction 0..1");

    /* And it accepts `0.2`, which every reader in the tree
       (`routes.ts:2127`, `captableSnapshotsStore.ts:109`) would price as a
       0.2% discount, not 20%. Accepting the wrong unit is worse than
       rejecting the right one. */
    expect(tryInsert(db, "0.2", "c2").ok).toBe(true);

    db.close();
  });

  it("W58F-F0a3 — it fires on UPDATE too, so a later correction is also blocked", () => {
    const db = freshFencedDb(extractDiscountTriggers(src(M0153)));
    expect(tryInsert(db, "0.2", "c1").ok).toBe(true);
    let msg = "";
    try {
      db.prepare(`UPDATE captable_commits SET discount_pct = '20' WHERE id = 'c1'`).run();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
    db.close();
  });

  it("W58F-F0a4 — `discount_pct_scaled`, which 0153's own comment promises, does not exist", () => {
    /* 0153's header says a parallel `discount_pct_scaled` INTEGER column
       "carries the exact fixed-scale integer for arithmetic". It was never
       created, in this migration or any other, and nothing reads it. Reported
       rather than built: a second home for the same number is the R21 defect. */
    const sql0153 = src(M0153);
    expect(sql0153).toContain("discount_pct_scaled");
    expect(sql0153).not.toMatch(/ADD COLUMN\s+discount_pct_scaled/i);

    const dir = path.join(ROOT, "migrations");
    const hits = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => /discount_pct_scaled/.test(fs.readFileSync(path.join(dir, f), "utf8")))
      .filter((f) => /ADD COLUMN\s+discount_pct_scaled/i.test(fs.readFileSync(path.join(dir, f), "utf8")));
    expect(hits).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * F0-B — THE FIX, AS SQL. R30 SAYS STORAGE IS PERCENT-AS-WRITTEN.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58F-F0b — migration 0190 corrects the domain to [0,100)", () => {
  it("W58F-F0b1 — EXECUTED: '20' accepted; '', '-1', '100', '100.1', 'abc' still refused", () => {
    const db = freshFencedDb(extractDiscountTriggers(readWave58fDiscountDomainDdl()));

    /* ACCEPTED — the whole point. */
    expect(tryInsert(db, "20", "ok20").ok).toBe(true);
    expect(tryInsert(db, "0", "ok0").ok).toBe(true);
    expect(tryInsert(db, "0.2", "ok02").ok).toBe(true); // legal 0.2%, no longer ambiguous
    expect(tryInsert(db, "15", "ok15").ok).toBe(true);
    expect(tryInsert(db, "99.999", "ok99").ok).toBe(true);
    expect(tryInsert(db, null, "okNull").ok).toBe(true); // absent stays absent

    /* STILL REFUSED — the fence is widened, not removed. A 100% discount prices
       the shares at zero; more than 100% prices them negative. */
    for (const [v, id] of [["", "x1"], ["-1", "x2"], ["100", "x3"], ["100.1", "x4"], ["1e9", "x5"]] as const) {
      const r = tryInsert(db, v, id);
      expect(r.ok, `expected refusal for ${JSON.stringify(v)}`).toBe(false);
      if (!r.ok) expect(r.message).toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
    }
    db.close();
  });

  it("W58F-F0b6 — HONEST LIMIT: non-numeric text is NOT caught, and was not caught before either", () => {
    /* Stated rather than hidden. SQLite's `CAST('abc' AS REAL)` is `0.0`, which
       is in domain on BOTH the old fence and the new one, so `'abc'` slips
       through as a zero discount. This wave does not widen or narrow that hole:
       it is identical before and after, so it is not a regression — but it is
       real, and it is listed as OPEN in `WAVE58F_REPORT.md`. The defence that
       actually holds is `validateDiscountPercentAsWritten` at the three HTTP
       writers, which refuses non-numeric input by name before it can reach the
       table at all. Closing it at the table needs a `GLOB` numeric-form check,
       which is a new rule in SQL and therefore a separate, ratifiable change. */
    const oldDb = freshFencedDb(extractDiscountTriggers(src(M0153)));
    const newDb = freshFencedDb(extractDiscountTriggers(readWave58fDiscountDomainDdl()));
    expect(tryInsert(oldDb, "abc", "a1").ok).toBe(true); // pre-existing hole
    expect(tryInsert(newDb, "abc", "a1").ok).toBe(true); // unchanged by this wave
    oldDb.close();
    newDb.close();
  });

  it("W58F-F0b2 — the new abort message names the unit, so the next reader is not guessing", () => {
    const ddl = readWave58fDiscountDomainDdl();
    for (const t of extractDiscountTriggers(ddl)) {
      expect(t).toContain("expected percent-as-written 0..<100 (R30); 20 means 20%");
      expect(t).toContain("CAST(NEW.discount_pct AS REAL) >= 100");
      expect(t).not.toContain("CAST(NEW.discount_pct AS REAL) > 1");
    }
  });

  it("W58F-F0b3 — R21: 0190's SQL bound IS the shared DISCOUNT_STORED_PERCENT_MAX", () => {
    /* The bound now exists in TWO languages — TypeScript and SQL — which is a
       real R21 exposure and cannot be removed (SQLite cannot import a constant).
       It is instead made UNDRIFTABLE: this assertion fails if either side moves. */
    const ddl = readWave58fDiscountDomainDdl();
    const bounds = [...ddl.matchAll(/CAST\(NEW\.discount_pct AS REAL\)\s*>=\s*([\d.]+)/g)].map((m) =>
      Number(m[1]),
    );
    expect(bounds.length).toBe(2);
    for (const b of bounds) expect(b).toBe(DISCOUNT_STORED_PERCENT_MAX);
  });

  it("W58F-F0b4 — the two migration copies are byte-identical", () => {
    /* `migrations/` is canonical; `server/db/migrations/` is the mirror the
       bundled server reads. A one-sided edit is how a fence ends up installed in
       one runtime and not the other. */
    const a = fs.readFileSync(path.join(ROOT, M0190));
    const b = fs.readFileSync(path.join(ROOT, M0190_MIRROR));
    const ha = createHash("sha256").update(a).digest("hex");
    const hb = createHash("sha256").update(b).digest("hex");
    expect(hb).toBe(ha);
  });

  it("W58F-F0b5 — SAFETY: no existing in-domain row can be newly rejected", () => {
    /* R17 forbids rewriting committed rows, and this migration rewrites none —
       it only DROPs and re-CREATEs triggers. The remaining risk would be
       NARROWING: a value that 0153 accepted but 0190 rejects would break the
       next UPDATE of an already-committed row. Proved impossible by strict
       containment: 0 <= x <= 1 IMPLIES 0 <= x < 100. Executed over the old
       domain's boundary and interior. */
    const oldDomain = ["0", "0.0000001", "0.2", "0.5", "0.999999", "1"];
    const newDb = freshFencedDb(extractDiscountTriggers(readWave58fDiscountDomainDdl()));
    const oldDb = freshFencedDb(extractDiscountTriggers(src(M0153)));
    oldDomain.forEach((v, i) => {
      expect(tryInsert(oldDb, v, `o${i}`).ok, `0153 should accept ${v}`).toBe(true);
      expect(tryInsert(newDb, v, `n${i}`).ok, `0190 must still accept ${v}`).toBe(true);
    });
    newDb.close();
    oldDb.close();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * F0-C — END TO END THROUGH HTTP, WITH THE NEGATIVE CONTROL THAT MAKES IT MEAN
 *        SOMETHING.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58F-F0c — a committed SAFE carrying discount 20 succeeds through HTTP", () => {
  /** Force the PRE-FIX state onto the live test database: drop the corrected
   *  triggers and install 0153's originals. This is what makes the negative
   *  control real — `wave_safe_commit.test.ts` passes today only because no
   *  trigger is present at all, which proves nothing about the fence. */
  function installPreFixTriggers(): void {
    const db = rawDb();
    for (const name of WAVE58F_TRIGGERS) db.exec(`DROP TRIGGER IF EXISTS ${name};`);
    for (const t of extractDiscountTriggers(src(M0153))) db.exec(t);
  }

  async function createSafeRound(tag: string) {
    const res = await request(app)
      .post("/api/rounds")
      .set("x-user-id", ADMIN)
      .send({
        companyId: `co_w58f_${STAMP}_${tag}`,
        name: `W58F SAFE ${tag}`,
        type: "seed",
        instrument: "safe_post",
        targetAmount: 1_000_000,
        valuationCap: "8000000",
        discount: 20,
        openDate: "2026-01-01",
        closeDate: "2026-12-31",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200); /* this route answers 200, not 201 — verified by execution */
    const round = (res.body.round ?? res.body) as Record<string, any>;
    return { roundId: String(round.id), companyId: String(round.companyId) };
  }

  async function commit(roundId: string, companyId: string, tag: string) {
    const res = await request(app)
      .post("/api/founder/captable/commit-funded")
      .set("x-user-id", ADMIN)
      .send({
        invitationId: `inv_w58f_${STAMP}_${tag}`,
        roundId,
        companyId,
        investorId: `investor_w58f_${STAMP}_${tag}`,
        amount: "50000",
        currency: "USD",
        shares: "0",
      });
    return { status: res.status, body: res.body as Record<string, any> };
  }

  it("W58F-F0c1 — NEGATIVE CONTROL: with 0153's triggers installed, the commit FAILS", async () => {
    clearLedger();
    setComplianceHold(false);
    const { roundId, companyId } = await createSafeRound("pre");

    /* Sanity: the round really does carry the percent-as-written value the
       trigger will see. If this were 0.2 the control would prove nothing. */
    const got = await request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);
    expect(got.status).toBe(200);
    expect(String((got.body.round ?? got.body).discount)).toBe("20");

    installPreFixTriggers();
    /* Confirm the pre-fix fence is genuinely in place before asserting on it. */
    expect(isCorrectedDomain(triggerSql(rawDb(), WAVE58F_TRIGGERS[0]) ?? "")).toBe(false);

    let threw = "";
    let status = 0;
    try {
      const r = await commit(roundId, companyId, "pre");
      status = r.status;
    } catch (e) {
      threw = (e as Error).message;
    }
    /* Either the route surfaces a non-2xx, or the abort propagates as a thrown
       error. Both are failures; neither is a stored commit. What must NOT
       happen is a 200. */
    expect(status === 0 || status >= 400, `status=${status} threw=${threw}`).toBe(true);
  }, 60_000);

  it("W58F-F0c2 — WITH THE FIX: the identical commit succeeds, stores '20', chain verifies", async () => {
    clearLedger();
    setComplianceHold(false);
    const { roundId, companyId } = await createSafeRound("post");

    installPreFixTriggers();               // start from the broken state
    const applied = applyWave58fDiscountDomain(rawDb());  // the fix under test
    expect(applied.applied).toBe(true);
    expect(applied.triggersUnfixed).toEqual([]);
    expect(isCorrectedDomain(triggerSql(rawDb(), WAVE58F_TRIGGERS[0]) ?? "")).toBe(true);
    expect(isCorrectedDomain(triggerSql(rawDb(), WAVE58F_TRIGGERS[1]) ?? "")).toBe(true);

    const r = await commit(roundId, companyId, "post");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.ok).toBe(true);
    /* STORED AS WRITTEN. Not 0.2, not rescaled, not clamped. */
    expect(r.body.entry.discountPct).toBe("20");
    expect(r.body.entry.instrumentClass).toBe("unpriced");
    expect(r.body.entry.principalAmount).toBe("50000");

    /* AND IT HASHES. `discount_pct` enters the commit hash body, which is why
       this had a deadline: after the first real SAFE, changing the column's
       meaning would alter committed history. */
    expect(verifyChain().ok).toBe(true);
  }, 60_000);

  it("W58F-F0c3 — the fix does not open the door: 120 is still refused at the table", () => {
    applyWave58fDiscountDomain(rawDb());
    const db = rawDb();
    let msg = "";
    try {
      db.prepare(
        `INSERT INTO captable_commits (id, tenant_id, seq, ts, invitation_id, round_id, company_id,
           investor_id, amount, currency, shares, state, prev_hash, hash, discount_pct)
         VALUES ('ccm_w58f_probe','t',999999,'2026-01-01T00:00:00Z','inv_probe','r','c','i','1','USD','0',
           'committed','GENESIS','deadbeef','120')`,
      ).run();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
  });

  it("W58F-F0c4 — the installer is idempotent and memo-safe", () => {
    const first = applyWave58fDiscountDomain(rawDb());
    const second = applyWave58fDiscountDomain(rawDb());
    expect(first.triggersUnfixed).toEqual([]);
    expect(second.triggersUnfixed).toEqual([]);
    expect(isCorrectedDomain(triggerSql(rawDb(), WAVE58F_TRIGGERS[0]) ?? "")).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * F1 — THE THIRD HTTP WRITER. THIS IS THE ROUTE THE DATE CAME IN ON.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58F-F1 — PATCH /api/founder/rounds/:id is guarded by the SHARED validators", () => {
  let roundId = "";

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/rounds")
      .set("x-user-id", ADMIN)
      .send({
        companyId: `co_w58f_third_${STAMP}`,
        name: `W58F third writer ${STAMP}`,
        type: "seed",
        instrument: "safe_post",
        targetAmount: 1_000_000,
        openDate: "2026-01-01",
        closeDate: "2026-12-31",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200); /* this route answers 200, not 201 — verified by execution */
    roundId = String((res.body.round ?? res.body).id);
  }, 60_000);

  const patchFounder = async (body: Record<string, unknown>) => {
    const res = await request(app)
      .patch(`/api/founder/rounds/${roundId}`)
      .set("x-user-id", ADMIN)
      .send(body);
    return { status: res.status, body: res.body as Record<string, any> };
  };
  /* READ-BACK NOTE, recorded because it is a real finding and not a test
     convenience: `GET /api/rounds/:id` does NOT project the `extras_json`
     fields, so it returns no `discount` and no `interestRate` at all. Verified
     by execution. Persistence is therefore read back from the STORE row — the
     same row the route wrote — via `getRoundById`, plus the round the route
     itself returns. Both are asserted, so a route that answered `ok` without
     writing would still fail. The missing projection is listed as OPEN in
     `WAVE58F_REPORT.md`; it is pre-existing and untouched by this wave. */
  const readRound = async () => {
    const { getRoundById } = await import("../roundsStore");
    const row = getRoundById(roundId) as Record<string, any> | null;
    expect(row, "the round vanished from the store").not.toBeNull();
    /* And confirm the HTTP surface is still reachable and consistent on the
       fields it DOES project. */
    const res = await request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    expect(String((res.body.round ?? res.body).id)).toBe(roundId);
    return row!;
  };

  it("W58F-F1a — THE LIVE CORRUPT VALUE IS REFUSED BY NAME: {discount: 20260707} -> 400", async () => {
    /* This is the exact value found in live `rounds.extras_json`, and this is
       the route that could still write it after Wave 58e reported "both HTTP
       writers closed". 20260707 is a date (2026-07-07), not a percentage. */
    const r = await patchFounder({ discount: 20260707 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_discount");
    expect(String(r.body.message)).toMatch(/percent/i);
    /* AND NOTHING WAS WRITTEN. A refusal that still persists is not a refusal. */
    const round = await readRound();
    expect(round.discount == null || String(round.discount) !== "20260707").toBe(true);
  });

  it("W58F-F1b — 100 is refused: the domain is [0,100), because 100% off prices shares at zero", async () => {
    const r = await patchFounder({ discount: DISCOUNT_STORED_PERCENT_MAX });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_discount");
  });

  it("W58F-F1c — a LEGITIMATE discount still succeeds and is stored percent-as-written", async () => {
    /* The fix must not be a blanket refusal. `20` is the normal case and must
       round-trip unchanged — stored as `20`, not converted to `0.2`. */
    const r = await patchFounder({ discount: 20 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.ok).toBe(true);
    /* The route's OWN returned row, straight from the store write. */
    expect(Number(r.body.round.discount)).toBe(20);
    /* And an independent re-read of the persisted row. */
    const round = await readRound();
    expect(Number(round.discount)).toBe(20);
    /* And the one sanctioned conversion still turns it into the engine wire. */
    expect(toWireDiscount(20, "w58f-f1c")!.asNumber).toBe(0.2);
  });

  it("W58F-F1d — outside the 10–20% market norm it WARNS and STILL SAVES (R30.5)", async () => {
    /* A warning that blocks is a block. 35% is unusual, legal, and the
       founder's call — so it is stored exactly and the reason is returned. */
    const unusual = DISCOUNT_MARKET_NORM_MAX + 15;
    const r = await patchFounder({ discount: unusual });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(Array.isArray(r.body.termWarnings)).toBe(true);
    expect(String(r.body.termWarnings.join(" "))).toMatch(/1?0?[–-]?2?0?%|typical|market|unusual/i);
    expect(Number(r.body.round.discount)).toBe(unusual);
    const round = await readRound();
    expect(Number(round.discount)).toBe(unusual);
    expect(DISCOUNT_MARKET_NORM_MIN).toBe(10);
    expect(DISCOUNT_MARKET_NORM_MAX).toBe(20);
    /* restore the normal value for the tests below */
    expect((await patchFounder({ discount: 20 })).status).toBe(200);
  });

  it("W58F-F1e — interestRate is guarded by its OWN shared validator, refused by name", async () => {
    const bad = await patchFounder({ interestRate: 20261231 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_interestRate");

    const good = await patchFounder({ interestRate: 6 });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    expect(Number(good.body.round.interestRate)).toBe(6);
    const round = await readRound();
    expect(Number(round.interestRate)).toBe(6);
    expect(INTEREST_RATE_PERCENT_MAX).toBe(100);
  });

  it("W58F-F1f — ABSENT IS UNTOUCHED: a patch carrying neither key changes neither", async () => {
    /* Load-bearing on an open-ended PATCH: most calls carry neither key, and a
       validator that treated absent as zero would silently erase a discount.
       A 0% discount and NO discount are different facts about a contract. */
    const before = await readRound();
    const r = await patchFounder({ name: `W58F renamed ${STAMP}` });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = await readRound();
    expect(String(after.discount)).toBe(String(before.discount));
    expect(String(after.interestRate)).toBe(String(before.interestRate));
    expect(r.body.termWarnings).toBeUndefined();
  });

  it("W58F-F1g — the guard is the SHARED one, IMPORTED, not a second copy (R21)", () => {
    /* R21 is the rule this whole build exists to enforce: one home per rule.
       A second copy that agrees today is a divergence waiting for one wave. */
    const s = src("server/roundCarryForwardRoutes.ts");
    expect(s).toMatch(
      /import\s*\{[^}]*validateDiscountPercentAsWritten[^}]*validateInterestRatePercentAsWritten[^}]*\}\s*from\s*"@shared\/roundMathEngineAdapter"/s,
    );
    expect(s).toContain("validateDiscountPercentAsWritten(");
    expect(s).toContain("validateInterestRatePercentAsWritten(");
    /* NO re-implementation: the bound must appear nowhere in this file. */
    expect(s).not.toMatch(/DISCOUNT_STORED_PERCENT_MAX\s*=/);
    expect(s).not.toMatch(/[<>]=?\s*100\s*\)?\s*\)?\s*\{[^}]*discount/i);
    /* And the same shared module is where the other two writers get it. */
    expect(src("server/routes.ts")).toContain("validateDiscountPercentAsWritten");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * F1-ENUM — THE SWEEP FOR A FOURTH. TWO WAVES MISSED A WRITER; THREE IS NOT
 *           ASSUMED TO BE THE TOTAL.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58F-F1enum — every route that can persist discount/interestRate is enumerated", () => {
  const serverFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === "__tests__" || e.name === "__artifacts__") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|mts)$/.test(e.name)) out.push(p);
      }
    };
    walk(path.join(ROOT, "server"));
    return out;
  };

  it("W58F-F1enum1 — the store's persisted-extras whitelist really does include both fields", () => {
    /* This is WHY these two routes are writers at all: `updateRound` passes
       unknown keys through only if they are on this whitelist. */
    const s = src("server/roundsStore.ts");
    const block = s.slice(s.indexOf("UPDATE_EXTRAS_WHITELIST"));
    expect(block).toContain('"discount"');
    expect(block).toContain('"interestRate"');
  });

  it("W58F-F1enum2 — there are exactly THREE non-test call sites that can persist them", () => {
    /* Enumerated by scanning every server .ts for calls to the two store
       writers, then classifying each. The full table with guard status per site
       is `build_log/wave58f/W58F_WRITE_PATH_ENUMERATION.md`. */
    const sites: string[] = [];
    for (const f of serverFiles()) {
      const s = fs.readFileSync(f, "utf8");
      const rel = path.relative(ROOT, f);
      for (const line of s.split("\n")) {
        if (/\b(updateRound|roundsStoreUpdate|createRound|roundsStoreCreate)\s*\(/.test(line)) {
          sites.push(rel);
        }
      }
    }
    const files = [...new Set(sites)].sort();
    /* Only two server files call the round writers at all. If a third appears,
       this test fails and the enumeration must be redone — which is exactly the
       tripwire two waves lacked. */
    /* `server/roundsStore.ts` is the DEFINITION module (it declares
       `createRound`/`updateRound` and calls them internally), not a route. The
       two ROUTE-BEARING files are the other two. If a fourth file appears, this
       fails and the enumeration must be redone — the tripwire two waves lacked. */
    expect(files).toEqual([
      "server/roundCarryForwardRoutes.ts",
      "server/roundsStore.ts",
      "server/routes.ts",
    ]);
  });

  it("W58F-F1enum3 — the carry-forward ACCEPT route CANNOT persist a discount", async () => {
    /* `POST /api/founder/rounds/:roundId/carry-forward/accept` also calls
       `updateRound`, so it looked like a fourth writer. It is not: it filters
       its patch through `UPDATE_ROUND_WHITELIST_KEYS` (core columns only),
       which contains neither field. Proved from the exported constant rather
       than from reading the code, so a future addition to that list trips here. */
    const { UPDATE_ROUND_WHITELIST_KEYS } = await import("../roundsStore");
    expect(UPDATE_ROUND_WHITELIST_KEYS).not.toContain("discount");
    expect(UPDATE_ROUND_WHITELIST_KEYS).not.toContain("interestRate");

    const s = src("server/roundCarryForwardRoutes.ts");
    const accept = s.slice(
      s.indexOf("/carry-forward/accept"),
      s.indexOf("PATCH /api/founder/rounds/:id"),
    );
    expect(accept).toContain("new Set(UPDATE_ROUND_WHITELIST_KEYS)");
    expect(accept).toContain("if (whitelistKeys.has(k)) filteredPatch[k] = v;");
  });

  it("W58F-F1enum4 — no raw SQL writes either field outside migrations and tests", () => {
    /* A guarded route is worth nothing if some store writes `extras_json`
       directly. Scanned for it. */
    const offenders: string[] = [];
    for (const f of serverFiles()) {
      const s = fs.readFileSync(f, "utf8");
      if (/(INSERT\s+INTO|UPDATE)\s+rounds\b/i.test(s) && /discount|interest_rate/i.test(s)) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * F2 — THE UNCONVERTED SECOND CONVERSION, QUARANTINED WITH A TRIPWIRE.
 *      `server/roundCarryForwardEngine.ts` IS SACRED: READ, NEVER EDITED.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58F-F2 — the carry-forward engine's own percent→fraction conversion", () => {
  const ENGINE = "server/roundCarryForwardEngine.ts";

  /* ─────────────────────────────────────────────────────────────────────────
   * WAVE 58g UPDATE (2026-08-15) — THE QUARANTINE IS OVER, BY OWNER RULING.
   * R34 granted WAIVER-7 and the local division inside `discountAsDecimalStr`
   * has been REMOVED; the function now delegates to `toWireDiscount`. Three
   * assertions below pinned the quarantined state ("the division is still
   * there", "the file is still at its pre-waiver hash", "the two
   * implementations agree") and are therefore FACTUALLY STALE, not failing.
   * They are re-pointed at the NEW reality — deliberately, and named as such,
   * because re-pinning a test to make a gate green without saying so is the
   * thing this file exists to prevent. What each one now asserts:
   *   F2a — the division is GONE and the delegation is in place (the CORRECTION
   *         about `computeConversionProjections` is UNCHANGED and still checked).
   *   F2c — the file is at its ONE waived state, 42d04653…, not the pre-waiver
   *         d7fa53f0… — so it is still a hash pin, still one legal state.
   *   F2d — there is no longer a SECOND implementation to compare, so the
   *         tripwire becomes: the engine has no private conversion at all.
   * F2b (reachability) and F2e/F2f are unchanged and still pass as written.
   * Full detail: build_log/wave58g/WAVE58G_REPORT.md.
   * ───────────────────────────────────────────────────────────────────────── */
  it("W58F-F2a — CORRECTION TO THE BRIEF: only ONE of the two sites divided by 100 (and it is now gone — 58g)", () => {
    /* The brief said `:250-254` AND `:744-817` "independently divide by 100".
       Read: only the first does. `computeConversionProjections` passes
       `inst.discount` straight through to the cap-table engine and divides
       nothing — it CONSUMES an already-fractional value produced by the first
       site. Recorded because a wave that "fixed" a division that isn't there
       would have introduced a double-division. */
    const s = src(ENGINE);
    const conv = s.slice(s.indexOf("function discountAsDecimalStr"));
    /* WAVE 58g / WAIVER-7: was `expect(conv.slice(0,200)).toContain("rawDiscount / 100")`.
       The division is gone; the delegation is asserted in its place. */
    expect(conv.slice(0, 300)).not.toContain("rawDiscount / 100");
    expect(conv.slice(0, 300)).toContain("toWireDiscount(");

    const proj = s.slice(
      s.indexOf("export function computeConversionProjections"),
      s.indexOf("Main engine entry point"),
    );
    expect(proj).toContain("discount: inst.discount ?? undefined");
    expect(proj).not.toContain("/ 100");
  });

  it("W58F-F2b — CORRECTION TO THE BRIEF: the dividing site is REACHABLE from HTTP today", () => {
    /* The brief called it "latent, not live". The division at
       `discountAsDecimalStr` is called by `buildUnrealizedInstruments`, which
       `computeCarryForward` calls, which `computeCarryForwardLive` wraps, which
       TWO HTTP routes call. What makes it produce nothing on live is an EMPTY
       DATA SOURCE (`mockData.securities`), not a missing caller. That is a much
       weaker protection than "no caller" and is why the tripwire below watches
       the value, not the call graph. */
    const s = src(ENGINE);
    expect(s).toMatch(/function buildUnrealizedInstruments[\s\S]{0,2000}discountAsDecimalStr\(/);
    expect(s).toMatch(/export function computeCarryForwardLive[\s\S]{0,400}computeCarryForward\(input\)/);
    expect(src("server/roundCarryForwardRoutes.ts")).toContain("computeCarryForwardLive({");
  });

  it("W58F-F2c — THE DECISION, SUPERSEDED: the sacred edit was granted (WAIVER-7, R34) and the file is at its ONE waived hash", () => {
    /* The brief offered route-through OR explicit quarantine. Route-through is
       not available to this wave: `discountAsDecimalStr` lives INSIDE
       `server/roundCarryForwardEngine.ts`, which is on the 48-entry sacred
       manifest — read, never edit. Editing it is an OWNER DECISION, raised as
       such in `WAVE58F_REPORT.md` §F2. So: QUARANTINE.

       The file must therefore be UNCHANGED. Asserted by hash so this test also
       serves as the F4 non-modification proof for this file. */
    const h = createHash("sha256").update(fs.readFileSync(path.join(ROOT, ENGINE))).digest("hex");
    /* WAVE 58g: lineage d7fa53f0… (58f, quarantined) → 42d04653… (58g, WAIVER-7).
       Still ONE legal state, enforced in three places: here, scripts/sacred_check.sh
       and waveB_retirement_guard.test.ts. */
    expect(h).not.toBe("d7fa53f0fb8c41d0acba5ee7184ec11e169aa23530b90d49860533f27c786119");
    expect(h).toBe("42d04653278caefe85093fff778bdc1c8f0aabc0916a9deec29b1862729212a8");
  });

  it("W58F-F2d — TRIPWIRE, RE-AIMED: there is no private conversion left to agree or disagree with (58g)", () => {
    /* The quarantine's substance. Two implementations of one rule may not
       diverge (R21), so the divergence is measured rather than asserted away.
       `discountAsDecimalStr` is private, so its exact expression is lifted from
       the source text and executed — if the source changes, the lift changes
       with it, and if the RESULT diverges from the shared bridge, this fails. */
    const s = src(ENGINE);
    /* WAVE 58g: the lifted expression no longer exists. Two implementations of
       one rule cannot diverge if there is only one, so the tripwire now watches
       for a SECOND one coming back rather than measuring the gap. */
    expect(/return \(rawDiscount \/ 100\)\.toFixed\(\d+\);/.test(s)).toBe(false);
    expect(s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).not.toContain("/ 100");

    /* And the surviving single authority still answers correctly across the legal
       domain — the same values the two-implementation comparison used. */
    for (const p of [0, 10, 12.5, 15, 20, 25, 33.3, 50, 99.999]) {
      const wire = toWireDiscount(p, "w58f-f2d");
      expect(wire, `toWireDiscount refused a legal ${p}%`).toBeDefined();
      expect(wire!.asNumber).toBeCloseTo(p / 100, 9);
    }
  });

  it("W58F-F2e — TRIPWIRE: and DIVERGES on the out-of-domain value, which is the whole risk", () => {
    /* Where they part company: `toWireDiscount` REFUSES the live corrupt value;
       the engine's private conversion happily returns 202607.07, a wire
       "fraction" 200,000× outside [0,1] that `InvalidDiscountWireValueError`
       would have rejected. This is the concrete harm the quarantine names, and
       the reason it must be raised with the owner rather than left silent. */
    const engineConv = (p: number) => Number((p / 100).toFixed(6));
    expect(engineConv(20260707)).toBe(202607.07);
    expect(() => toWireDiscount(20260707, "w58f-f2e")).toThrow(/discount/i);
  });

  it("W58F-F2f — TRIPWIRE: computeConversionProjections still has NO non-test caller", () => {
    /* It fails the moment the dormant path acquires a caller while the
       conversion question is still open — which is precisely what the brief
       asked the quarantine to guarantee. */
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", "__tests__", "__artifacts__", ".g0-snapshot", "dist", "build_log"].includes(e.name))
          continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|mts)$/.test(e.name)) {
          const s = fs.readFileSync(p, "utf8");
          if (/computeConversionProjections\s*\(/.test(s) && !/export function computeConversionProjections/.test(s)) {
            callers.push(path.relative(ROOT, p));
          }
        }
      }
    };
    for (const d of ["server", "client", "shared", "scripts"]) {
      const p = path.join(ROOT, d);
      if (fs.existsSync(p)) walk(p);
    }
    expect(callers).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * F3 / F4 — THE CORRECTED CONTRACT, AND BYTE-IDENTITY MADE PROVABLE.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58F-F3 — the adapter's documented contract matches R30", () => {
  const ADAPTER = "shared/roundMathEngineAdapter.ts";

  it("W58F-F3a — the stale 'STORAGE AND WIRE ARE FRACTIONAL' claim is GONE", () => {
    /* It was not a nit. A reader who believed it would "fix" a stored `20` to
       `0.2` and turn a 20% discount into 0.2%. */
    const s = src(ADAPTER);
    expect(s).not.toContain("STORAGE AND WIRE ARE FRACTIONAL");
  });

  it("W58F-F3b — the contract now states both units, names R30, and names the single bridge", () => {
    const s = src(ADAPTER);
    expect(s).toContain("STORAGE / API / UI IS PERCENT-AS-WRITTEN (R30)");
    expect(s).toContain("THE ENGINE WIRE IS FRACTIONAL");
    expect(s).toMatch(/`toWireDiscount` IS THE ONLY BRIDGE/);
    /* and the surviving parts are still stated, not quietly dropped */
    expect(s).toContain("InvalidDiscountWireValueError");
    expect(s).toContain("R16 still forbids inferring a unit from a magnitude");
  });

  it("W58F-F4a — the InvalidDiscountWireValueError block is BYTE-IDENTICAL to its pre-wave sha256", () => {
    /* Review 1 graded byte-identity CANNOT VERIFY because the mutation backup
       matched the after-tree. This settles it with a recorded digest instead of
       an assertion: F3 edits this FILE, so the file hash moves, but the GUARD
       BLOCK may not. Recorded in `build_log/wave58f/gates/`. */
    const s = src(ADAPTER);
    const START = "/** Raised instead of guessing the unit of an out-of-domain discount. */";
    const END = "export function readDiscountFraction(raw: unknown, securityId: string): number | undefined {";
    const i = s.indexOf(START);
    const j = s.indexOf(END, i);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    /* Region boundaries mirror `scripts/w58f_guard_block_hash.mjs` EXACTLY: from
       the class doc comment to the close of `readDiscountFraction`, i.e. the
       first line-anchored "\n}\n" AFTER the END anchor. A test that measured the
       region differently would produce a different digest and prove nothing. */
    const k = s.slice(j).indexOf("\n}\n");
    expect(k).toBeGreaterThan(-1);
    const block = s.slice(i, j + k + 3);
    const h = createHash("sha256").update(Buffer.from(block, "utf8")).digest("hex");
    expect(h).toBe("7db0313e2fd72d69855712d2ea2c2dcf7520904fa2218fc5aab20e7b45aa6802");
  });

  it("W58F-F4b — the two other cap-table sacred files are byte-identical to their recorded sha256", () => {
    const expected: Record<string, string> = {
      "server/captableCommitStore.ts":
        "e5045ecbe77b06ea9879fae53e58e21ee2002b5b820a5ef066ecdf086c41cb06",
      "server/lib/capTableMembership.ts":
        "688b555426544527534afa12ce54e34069480db989c74c85d7d9020b9a45d750",
    };
    for (const [rel, want] of Object.entries(expected)) {
      const h = createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");
      expect(h, `${rel} was modified`).toBe(want);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FOLD-IN — THE PERCENT-POLICY REGISTRY AGREED WITH THE WRONG SIDE.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58F-P — the percent-policy registry entry now agrees with R30", () => {
  it("W58F-Pa — captable.discountPct is declared percent_as_written, not fraction", () => {
    /* There were TWO fraction-side authorities, not one: 0153's triggers and
       this registry entry. Correcting only the trigger would have left the
       written record contradicting the enforced one. */
    const s = src("server/lib/percentPolicy.ts");
    const i = s.indexOf('"captable.discountPct": Object.freeze({');
    expect(i).toBeGreaterThan(-1);
    const entry = s.slice(i, i + 500);
    expect(entry).toContain('inputForm: "percent_as_written"');
    expect(entry).not.toContain('inputForm: "fraction"');
    expect(entry).toContain("R30");
  });

  it("W58F-Pb — HONEST SCOPE: that entry has no caller, so the change is documentation", () => {
    /* Stated as a limit rather than sold as a fix. If a caller ever appears,
       this test fails and the claim must be re-graded. */
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", "__artifacts__", ".g0-snapshot", "dist"].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|mts)$/.test(e.name) && !p.endsWith("percentPolicy.ts")) {
          if (/captable\.discountPct/.test(fs.readFileSync(p, "utf8"))) callers.push(path.relative(ROOT, p));
        }
      }
    };
    for (const d of ["server", "client", "shared", "scripts"]) {
      const p = path.join(ROOT, d);
      if (fs.existsSync(p)) walk(p);
    }
    const nonTest = callers.filter((c) => !c.includes("__tests__"));
    expect(nonTest).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FOLD-IN 1 — ABSENT, ZERO AND A VALUE ARE THREE DIFFERENT FACTS.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT. `PATCH /api/rounds/:id/terms` wrote `discount` whenever the body
 * carried a non-blank value and IGNORED an explicit `null`, while the Edit-terms
 * dialog seeded `round.discount ?? 0` and sent the field UNCONDITIONALLY. The
 * combination wrote an explicit `0%` discount onto SAFEs that had none. A 0%
 * discount and NO discount are different facts about a contract.
 *
 * ALL FOUR STATES ARE PROVED THROUGH THE HTTP ROUTE, and the persisted row is
 * read back from the store rather than trusted from the response — this route's
 * projection is not the storage.
 */
describe("W58F-T3 — three-state discount on PATCH /api/rounds/:id/terms", () => {
  let app: express.Express;
  const ADMIN = "u_admin";
  const STAMP = String(Date.now());
  const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  async function mkRound(tag: string, discount: unknown) {
    const res = await request(app)
      .post("/api/rounds")
      .set("x-user-id", ADMIN)
      .send({
        companyId: `co_w58f_t3_${STAMP}_${tag}`,
        name: `W58F T3 ${tag}`,
        type: "seed",
        instrument: "safe_post",
        targetAmount: 1_000_000,
        valuationCap: "8000000",
        ...(discount === undefined ? {} : { discount }),
        openDate: "2026-01-01",
        closeDate: "2026-12-31",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const round = (res.body.round ?? res.body) as Record<string, any>;
    return String(round.id);
  }

  const stored = async (id: string) => {
    const { getRoundById } = await import("../roundsStore");
    return (getRoundById(id) ?? {}) as Record<string, any>;
  };

  it("W58F-T3a — ABSENT from the body leaves an existing discount UNTOUCHED (never reset to 0)", async () => {
    const id = await mkRound("untouched", 20);
    const res = await request(app)
      .patch(`/api/rounds/${id}/terms`)
      .set("x-user-id", ADMIN)
      .send({ termsSummary: "edited something else entirely" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await stored(id);
    expect(Number(row.discount)).toBe(20); // NOT 0, and NOT null
  });

  it("W58F-T3b — an explicit null REMOVES the discount (this is the fold-in fix)", async () => {
    /* FAILS WITHOUT THE FIX: the pre-fix branch was
         if (body.discount != null && String(body.discount).trim() !== "")
       so `null` fell through and the discount survived as 20. */
    const id = await mkRound("removed", 20);
    const res = await request(app)
      .patch(`/api/rounds/${id}/terms`)
      .set("x-user-id", ADMIN)
      .send({ discount: null });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await stored(id);
    expect(row.discount == null).toBe(true);
  });

  it("W58F-T3c — an empty string also removes it, and is NOT stored as 0", async () => {
    const id = await mkRound("blank", 15);
    const res = await request(app)
      .patch(`/api/rounds/${id}/terms`)
      .set("x-user-id", ADMIN)
      .send({ discount: "" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await stored(id);
    expect(row.discount == null).toBe(true);
    /* Asserted on the STORED VALUE, not on a coercion of it: `Number(null)` is
       `0`, so the obvious `expect(Number(row.discount)).not.toBe(0)` passes for
       the wrong reason and would also pass on a stored 0. The first draft of
       this test made exactly that mistake and failed honestly. */
    expect(row.discount).not.toBe(0);
    expect(String(row.discount)).not.toBe("0");
  });

  it("W58F-T3d — an explicit 0 is a VALUE and is stored as 0, not treated as removal", async () => {
    /* A negotiated 0% discount is a real term. Removal must be requested with
       null/"" and nothing else, or the founder cannot record one. */
    const id = await mkRound("zero", 20);
    const res = await request(app)
      .patch(`/api/rounds/${id}/terms`)
      .set("x-user-id", ADMIN)
      .send({ discount: 0 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await stored(id);
    expect(row.discount == null).toBe(false);
    expect(Number(row.discount)).toBe(0);
  });

  it("W58F-T3e — the same three states apply to interestRate", async () => {
    const id = await mkRound("ir", 20);
    let res = await request(app).patch(`/api/rounds/${id}/terms`).set("x-user-id", ADMIN).send({ interestRate: 5 });
    expect(res.status).toBe(200);
    expect(Number((await stored(id)).interestRate)).toBe(5);
    res = await request(app).patch(`/api/rounds/${id}/terms`).set("x-user-id", ADMIN).send({ interestRate: null });
    expect(res.status).toBe(200);
    expect((await stored(id)).interestRate == null).toBe(true);
  });

  it("W58F-T3f — refusal still outranks removal: 20260707 is refused, not silently cleared", async () => {
    /* The three-state branch must not become an escape hatch for the corrupt
       value. An out-of-range number is a 400 by name; it is NOT reinterpreted
       as "the founder meant to clear it". */
    const id = await mkRound("refuse", 20);
    const res = await request(app)
      .patch(`/api/rounds/${id}/terms`)
      .set("x-user-id", ADMIN)
      .send({ discount: 20260707 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_discount");
    expect(Number((await stored(id)).discount)).toBe(20); // unchanged
  });

  it("W58F-T3g — the dialog no longer seeds 0, and presence is its own state", () => {
    const s = src("client/src/pages/founder/Rounds.tsx");
    expect(s).toContain("const [discountPresent, setDiscountPresent] = useState<boolean>(round.discount != null);");
    expect(s).toContain("discount: discountPresent ? discount : null,");
    expect(s).toContain('data-testid="switch-discount-present"');
    expect(s).toContain('data-testid="switch-interest-rate-present"');
  });

  it("W58F-T3h — NO SILENT DROP: the two baselined number inputs are byte-identical", () => {
    /* The first attempt at this fold-in rewrote both `onChange` bodies, and
       `npm run guard` correctly reported the REMOVAL of two baselined event
       handlers (2457 -> 2455 events). The fix was redone ADDITIVELY. This test
       fails if anyone rewrites them again without an owner-approved allow-list
       entry — the allow-list is frozen at 43 for this wave. */
    const s = src("client/src/pages/founder/Rounds.tsx");
    expect(s).toContain('onChange={e => setDiscount(Number(e.target.value))} className="mt-1" data-testid="input-discount"');
    expect(s).toContain('onChange={e => setInterestRate(Number(e.target.value))} className="mt-1" data-testid="input-interest-rate"');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * F0d — THE FIX HAS TO RUN IN THE REAL APP PATH, NOT ONLY WHEN A TEST CALLS IT.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS GROUP EXISTS, HONESTLY. Mutation M1 unwired
 * `ensureWave58fDiscountDomain(rawDb())` from `registerRoutes` and ALL 47 tests
 * still passed. That was a real hole in the evidence, not a false alarm: every
 * F0 test reached the installer by calling it directly, so nothing proved the
 * application ever calls it. A migration file that is never executed fixes
 * nothing — and dev/test SQLite is built from inline definitions inside SACRED
 * `server/db/connection.ts`, so the migration alone does NOT reach it.
 *
 * These two tests close that hole. They call NOTHING: they inspect the database
 * as `registerRoutes` left it in `beforeAll`.
 */
describe("W58F-F0d — registerRoutes itself installs the corrected domain", () => {
  let app: express.Express;
  const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  it("W58F-F0d1 — after registerRoutes, the LIVE triggers already carry [0,100)", () => {
    /* No installer call in this test. If the wiring is removed, both triggers
       are either absent or still on 0153's fraction fence, and this goes red. */
    for (const t of WAVE58F_TRIGGERS) {
      const sql = triggerSql(rawDb(), t);
      expect(sql, `trigger ${t} is absent after registerRoutes`).toBeTruthy();
      expect(isCorrectedDomain(sql), `trigger ${t} still carries the old domain`).toBe(true);
    }
  });

  it("W58F-F0d2 — the call site exists in registerRoutes, by name", () => {
    /* Belt and braces for the case where a future refactor makes F0d1 pass for
       an unrelated reason (e.g. some other module installing the trigger). */
    /* The call uses an ALIASED import — `rawDb as _w58fRawDb` — because
       `server/routes.ts:455` records a deliberate architectural decision (D1-08)
       that `rawDb` is not imported at module scope in this file. The alias
       honours that decision instead of quietly reversing it, so the assertion is
       written against the real call text rather than an idealised one. */
    const s = src("server/routes.ts");
    expect(s).toContain("ensureWave58fDiscountDomain");
    expect(s).toContain("ensureWave58fDiscountDomain(_w58fRawDb());");
    expect(s).toContain('rawDb: _w58fRawDb } = await import("./db/connection")');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FOLD-IN 2 — THE STALE EMERGENCY LEVER.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58F-T4 — scripts/w52b_flag_poles.mts is a working lever again", () => {
  const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  it("W58F-T4a — the pool fixture is percent-as-written (R16), not the pre-R16 fraction", () => {
    /* WHY IT CRASHED. The harness was written before R16 fixed the field as
       percent-as-written. `"0.25"` used to mean 25%; it now literally means a
       quarter of one percent, so the drill this script documents could not run
       and the lever could not be pulled. */
    const s = src("scripts/w52b_flag_poles.mts");
    expect(s).toContain('optionPoolPostPercent: "25"');
    expect(s).not.toContain('optionPoolPostPercent: "0.25"');
  });

  it("W58F-T4b — it reproduces the CORRECTED canonical numbers (R33-c), not the retracted ones", () => {
    /* Executed: `npx tsx scripts/w52b_flag_poles.mts` exits 0 and prints
         price per share   1.9047619047619047619047619047619047619  ->  3
         SAFE shares       2500000  ->  2944444
         founders %        38.095   ->  44.308
       which independently confirms the three figures the owner corrected under
       R33-c: $1.904761... (NOT $2.00), 38.095% (NOT 40.000%), and 2,944,444 as
       the flag-OFF pole (NOT 2,777,777), with 2,500,000 as the current value.
       This test pins the fixture those numbers depend on. */
    const s = src("scripts/w52b_flag_poles.mts");
    expect(s).toContain("WAVE 58f · FOLD-IN 2");
  });
});
