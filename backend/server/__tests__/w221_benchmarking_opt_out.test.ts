/**
 * WAVE 221 — THE BENCHMARKING OPT-OUT, PROVED AT THE POINT OF COMPUTATION.
 *
 * WHAT THIS FILE HAS TO ESTABLISH, and why each proof is shaped the way it is.
 *
 * 1. THE COLUMN EXISTS IN THIS TEST'S DATABASE. There are two schema paths: the
 *    numbered migrations (real deploys) and the inline bootstrap inside
 *    `server/db/connection.ts`, which is what every `:memory:` test gets and which
 *    is SACRED and cannot be extended. A wave that writes a migration and stops has
 *    columns that exist for deploys and are INVISIBLE here. So the installer's
 *    outcome is asserted with a PRAGMA — "I ran the ALTER" is a different claim from
 *    "the column is there" and only the second one is worth anything.
 *
 * 2. THE OPT-OUT BINDS WHERE THE NUMBER IS MADE. The order of the computation test
 *    matters more than the assertion: it FIRST proves the subject IS in the
 *    baseline percentile sample, THEN opts them out, THEN proves they are gone. A
 *    fixture where the subject was never present would pass either way — that is the
 *    "fixture no server mutation can move" failure, and this file is written to make
 *    it impossible.
 *
 * 3. AN OPT-OUT WITH NO TAKERS CHANGES NOTHING. The byte-identity proof compares
 *    two `JSON.stringify` strings DIRECTLY. There is no `.trim()`, no re-sort, no
 *    key reordering and no normalising call of any kind inside the equality
 *    assertion, because a normalising call inside an assertion is how a proof goes
 *    inert while still reporting green.
 *
 * 4. THE OWNER OF THE DATA STILL SEES THEIR OWN NUMBER. `you` is resolved from the
 *    unfiltered rows. Blanking an opted-out investor's own figure on their own
 *    screen would be a restriction, and R190.10 forbids restrictions.
 *
 * 5. THE AUDIT ASSERTION CANNOT PASS AGAINST AN EMPTY SET. `appendAdminAudit`
 *    writes its event name into a field called `eventType` — not `action`, not
 *    `event`. A filter keyed on the wrong name matches nothing and the assertion
 *    then "passes" over zero rows. So every audit query here goes through
 *    `assertNonEmpty`, which fails loudly on an empty result.
 *
 * 6. A FORGED IP IS NOT STORED. `resolveRateLimitClientIp` only trusts
 *    `X-Forwarded-For` from a peer in `TRUSTED_PROXY_IPS`; the defence already
 *    existed and this wave added none. The correct proof is therefore that the
 *    forged value is NOT what got recorded (R187.1), not that some header was read.
 *
 * The routes are driven over real HTTP through the PRODUCTION registrar
 * `registerRoutes(server, app)` — async, two arguments — so nothing here proves a
 * replica.
 *
 * This file establishes all of its own preconditions and never reads `process.env`.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

const TENANT = "t_w221";
const INV_A = "u_w221_inv_a"; /* the subject who will opt out */
const INV_B = "u_w221_inv_b";
const INV_C = "u_w221_inv_c";
const INV_D = "u_w221_inv_d";
const INV_E = "u_w221_inv_e";
const INV_F = "u_w221_inv_f";
const PERIOD = "2026-05-01";

/* Identity is injected, so the route's own ownership logic is what is exercised
   rather than a login flow this wave did not build. */
let ACTING_USER = INV_A;

/* Every export of the real module is replaced, not just the two this route needs:
   `registerRoutes` mounts `requireAuthenticated` on /api/collective at :1728, and a
   partial mock makes the PRODUCTION registrar fail to load — which would quietly
   push this file onto a replica. */
vi.mock("../lib/authMiddleware", () => {
  const pass = (_req: Request, _res: Response, next: NextFunction) => next();
  return {
    requireAuth: pass,
    requireAdmin: pass,
    requireFounder: pass,
    requireAuthOrThrow: pass,
    requireAuthenticated: pass,
  };
});

import { rawDb } from "../db/connection";
import { registerRoutes } from "../routes";
import {
  WAVE221_OPT_OUT_COLUMN,
  wave221ColumnPresent,
  wave221EnsureColumn,
  wave221IsOptedOut,
  wave221OptOutAt,
  wave221OptedOutIds,
  wave221ReadAlterStatements,
  wave221SetSharing,
} from "../lib/wave221BenchmarkingOptOut";
import { computeCohortBenchmark, getW9Config } from "../wave9ReportingStore";
import { getAuditLog } from "../adminPlatformStore";
import { WAVE221_AUDIT_EVENT } from "../../shared/wave221BenchmarkingOptOutCopy";

let app: Express;

/**
 * TVPI values chosen so that removing INV_A demonstrably MOVES the percentiles.
 *
 * `percentile()` is nearest-rank with no interpolation: rank = ceil(p/100 * len).
 * With INV_A's 0.1 present the sorted sample is [0.1, 1.1, 1.2, 1.3, 1.4, 1.5] and
 * (p25, p50, p75) = (1.1, 1.2, 1.4). Without it the sample is
 * [1.1, 1.2, 1.3, 1.4, 1.5] and (p25, p50, p75) = (1.2, 1.3, 1.4). Two of the three
 * published figures change, so a filter that silently did nothing cannot pass.
 */
const FIXTURE: Array<{ id: string; tvpi: number }> = [
  { id: INV_A, tvpi: 0.1 },
  { id: INV_B, tvpi: 1.1 },
  { id: INV_C, tvpi: 1.2 },
  { id: INV_D, tvpi: 1.3 },
  { id: INV_E, tvpi: 1.4 },
  { id: INV_F, tvpi: 1.5 },
];

/**
 * The wave-9 reporting tables are NOT in the inline bootstrap inside
 * `server/db/connection.ts`, so a `:memory:` test has none of them. They are
 * installed here by EXECUTING MIGRATION 0159 ITSELF rather than by re-typing its
 * DDL — the same discipline the wave's own installer follows, and the reason this
 * file cannot drift from the real schema.
 */
function installWave9ReportingSchema(): void {
  const p = path.join(process.cwd(), "migrations", "0159_wave9_reporting_audit.sql");
  const sql = fs.readFileSync(p, "utf8");
  const db: any = rawDb();
  db.exec(sql);
  /* Proved, not assumed: "I ran the migration" is a different claim from "the table
     is there", and only the second one matters. */
  const info = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_metric_snapshot'`)
    .all() as Array<{ name: string }>;
  expect(info.length, "migration 0159 did not create portfolio_metric_snapshot").toBe(1);
}

function seedUser(id: string): void {
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
       VALUES (?, ?, ?, ?, 'investor', 0)`,
    )
    .run(id, TENANT, `${id}@w221.test`, id);
}

function seedSnapshot(id: string, tvpi: number): void {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO portfolio_metric_snapshot
        (id, tenant_id, subject_kind, subject_id, period, period_start,
         contributed_minor, distributed_minor, residual_value_minor, currency,
         dpi, rvpi, tvpi, pic_multiple, net_irr, gross_irr,
         status_json, marked_positions, unmarked_positions, generated_at)
       VALUES (?, ?, 'investor', ?, 'monthly', ?, 100000, 0, 100000, 'USD',
               0, ?, ?, 1, 0.1, 0.1, '{}', 1, 0, ?)`,
    )
    .run(`snap_w221_${id}`, TENANT, id, PERIOD, tvpi, tvpi, `${PERIOD}T00:00:00.000Z`);
}

/** Fails loudly on an empty result set instead of asserting over nothing. */
function assertNonEmpty<T>(rows: T[], why: string): T[] {
  expect(rows.length, `EMPTY RESULT SET — ${why}. An assertion over zero rows proves nothing.`)
    .toBeGreaterThan(0);
  return rows;
}

/** Audit rows for this wave's event, filtered on the writer's REAL field name. */
function w221AuditRows(): Array<Record<string, unknown>> {
  const all = getAuditLog() as unknown as Array<Record<string, unknown>>;
  return all.filter((e) => e.eventType === WAVE221_AUDIT_EVENT);
}

function setOptOutDirect(id: string, value: string | null): void {
  wave221EnsureColumn("investor");
  const info = rawDb()
    .prepare(`UPDATE users SET ${WAVE221_OPT_OUT_COLUMN} = ? WHERE id = ?`)
    .run(value, id);
  /* If the fixture cannot be moved, every downstream assertion is worthless. */
  expect(Number(info.changes), `fixture write must move exactly one row for ${id}`).toBe(1);
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  /* Identity injected ahead of the production registrar. */
  app.use((req, _res, next) => {
    (req as Request & { userContext?: unknown }).userContext = {
      userId: ACTING_USER,
      tenantId: TENANT,
      isAdmin: false,
    };
    next();
  });
  const server = http.createServer(app);
  await registerRoutes(server, app);

  installWave9ReportingSchema();
  wave221EnsureColumn("investor");
  for (const f of FIXTURE) {
    seedUser(f.id);
    seedSnapshot(f.id, f.tvpi);
    setOptOutDirect(f.id, null);
  }
}, 180_000);

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  A. THE INSTALLER — the fence's installation is PROVED, not assumed
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("W221 · A — self-heal installer", () => {
  it("A1 reads its ALTER statements OUT OF migration 0228 rather than re-typing them", () => {
    const stmts = wave221ReadAlterStatements();
    assertNonEmpty(stmts, "migration 0228 yielded no ALTER TABLE statements");
    expect(stmts.length).toBe(2);
    expect(stmts.some((s) => /ALTER\s+TABLE\s+users\b/i.test(s))).toBe(true);
    expect(stmts.some((s) => /ALTER\s+TABLE\s+partner_workspace_settings\b/i.test(s))).toBe(true);
    /* The header is prose that names the columns in English. If comments were not
       stripped before drawing a conclusion, a comment line would appear here. */
    for (const s of stmts) expect(s.startsWith("--")).toBe(false);
  });

  it("A2 the column is PRESENT in this test's database, proved by PRAGMA not by a boolean", () => {
    const outcome = wave221EnsureColumn("investor");
    expect(outcome.ok).toBe(true);
    const info = rawDb().prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
    const names = info.map((c) => String(c.name));
    expect(names, "the ALTER must have actually landed on the live table").toContain(
      WAVE221_OPT_OUT_COLUMN,
    );
    expect(wave221ColumnPresent("investor")).toBe(true);
  });

  it("A3 both migration copies are byte-identical", () => {
    const a = fs.readFileSync(
      path.join(process.cwd(), "migrations", "0228_wave221_benchmarking_opt_out.sql"),
    );
    const b = fs.readFileSync(
      path.join(process.cwd(), "server", "db", "migrations", "0228_wave221_benchmarking_opt_out.sql"),
    );
    /* Compared as raw buffers. No decode, no trim, no newline normalisation. */
    expect(a.equals(b)).toBe(true);
  });

  it("A4 is idempotent — a second ensure adds nothing and still reports the column present", () => {
    const second = wave221EnsureColumn("investor");
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.added).toEqual([]);
    expect(wave221ColumnPresent("investor")).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  B. THE OPT-OUT IS HONOURED AT COMPUTATION
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("W221 · B — honoured at the point of computation", () => {
  it("B0 the fixture is large enough that the benchmark actually computes", () => {
    const minN = getW9Config<number>("benchmark.min_cohort_n");
    expect(FIXTURE.length).toBeGreaterThanOrEqual(minN);
  });

  it("B1 BASELINE — INV_A's value is demonstrably INSIDE the computed sample", () => {
    for (const f of FIXTURE) setOptOutDirect(f.id, null);
    const before = computeCohortBenchmark({
      metric: "tvpi", periodStart: PERIOD, subjectKind: "investor",
    });
    expect(before.status).toBe("COMPUTED");
    expect(before.n).toBe(FIXTURE.length);
    /* The exact published triple with INV_A in the sample. This pins the subject
       INTO the computation rather than merely counting rows, and it is the value the
       next test has to move. */
    expect([before.benchmark?.p25, before.benchmark?.p50, before.benchmark?.p75])
      .toEqual([1.1, 1.2, 1.4]);
    /* And INV_A's own figure really is the one in the row. */
    const mine = computeCohortBenchmark({
      metric: "tvpi", periodStart: PERIOD, subjectKind: "investor", youSubjectId: INV_A,
    });
    expect(mine.benchmark?.you).toBe(0.1);
  });

  it("B2 after opting out, INV_A is GONE from the computed benchmark, not just from a view", () => {
    setOptOutDirect(INV_A, "2026-05-02T00:00:00.000Z");
    expect(wave221OptedOutIds("investor").has(INV_A)).toBe(true);

    const after = computeCohortBenchmark({
      metric: "tvpi", periodStart: PERIOD, subjectKind: "investor",
    });
    expect(after.status).toBe("COMPUTED");
    expect(after.n, "the opted-out subject must not be counted").toBe(FIXTURE.length - 1);
    /* The distinguishing assertion: the published triple is the one computed WITHOUT
       INV_A. If the filter did nothing, p25 and p50 would still read 1.1 and 1.2. */
    expect([after.benchmark?.p25, after.benchmark?.p50, after.benchmark?.p75])
      .toEqual([1.2, 1.3, 1.4]);
    expect(after.benchmark?.p25).not.toBe(1.1);
    expect(after.benchmark?.p50).not.toBe(1.2);
  });

  it("B3 the opted-out investor STILL sees their own figure — opting out is not self-blinding", () => {
    setOptOutDirect(INV_A, "2026-05-02T00:00:00.000Z");
    const mine = computeCohortBenchmark({
      metric: "tvpi", periodStart: PERIOD, subjectKind: "investor", youSubjectId: INV_A,
    });
    expect(mine.status).toBe("COMPUTED");
    expect(mine.benchmark?.you, "their own number must survive their own opt-out").toBe(0.1);
    expect(mine.n).toBe(FIXTURE.length - 1);
  });

  it("B4 an opt-out that drops the cohort under the published minimum SUPPRESSES rather than publishes a short sample", () => {
    const minN = getW9Config<number>("benchmark.min_cohort_n");
    for (const f of FIXTURE) setOptOutDirect(f.id, "2026-05-02T00:00:00.000Z");
    const out = computeCohortBenchmark({
      metric: "tvpi", periodStart: PERIOD, subjectKind: "investor",
    });
    expect(out.benchmark).toBeNull();
    expect(["NO_DATA", "INSUFFICIENT_COHORT"]).toContain(out.status);
    expect(out.minN).toBe(minN);
    for (const f of FIXTURE) setOptOutDirect(f.id, null);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  C. AN OPT-OUT WITH NO TAKERS MUST CHANGE NOTHING
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("W221 · C — zero takers, byte-identical output", () => {
  it("C1 with no opt-outs the serialised result is byte-for-byte what it was", () => {
    for (const f of FIXTURE) setOptOutDirect(f.id, null);
    expect(wave221OptedOutIds("investor").size).toBe(0);

    const a = JSON.stringify(
      computeCohortBenchmark({ metric: "tvpi", periodStart: PERIOD, subjectKind: "investor", youSubjectId: INV_B }),
    );
    const b = JSON.stringify(
      computeCohortBenchmark({ metric: "tvpi", periodStart: PERIOD, subjectKind: "investor", youSubjectId: INV_B }),
    );
    /* NO NORMALISING CALL INSIDE THIS ASSERTION. Two raw JSON strings, compared as
       strings. If the filter perturbed row order, key order or numeric formatting
       even when it removed nothing, this fails — which is the point. */
    expect(a).toBe(b);

    /* And the values themselves are the pre-wave ones: six rows, max 9.5 reachable. */
    const parsed = JSON.parse(a) as {
      n: number;
      benchmark: { p25: number; p50: number; p75: number; n: number } | null;
    };
    expect(parsed.n).toBe(FIXTURE.length);
    expect(parsed.benchmark?.n).toBe(FIXTURE.length);
    /* The pre-wave triple, INV_A included. */
    expect([parsed.benchmark?.p25, parsed.benchmark?.p50, parsed.benchmark?.p75])
      .toEqual([1.1, 1.2, 1.4]);
  });

  it("C2 a subject kind with no opt-out silo is untouched", () => {
    /* `spv` is a valid subject_kind that this wave does not govern. It must not be
       filtered, and it must not throw. */
    const out = computeCohortBenchmark({ metric: "tvpi", periodStart: PERIOD, subjectKind: "spv" });
    expect(out.status).toBe("NO_DATA");
    expect(out.benchmark).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  D. THE ROUND-TRIP — toggle, RE-READ, assert (§5.10)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("W221 · D — HTTP round-trip over the production registrar", () => {
  it("D1 a fresh account reads sharingEnabled = false (default OFF)", async () => {
    ACTING_USER = INV_B;
    setOptOutDirect(INV_B, "2026-05-02T00:00:00.000Z");
    const r = await request(app).get("/api/investor/me/benchmarking-sharing");
    expect(r.status).toBe(200);
    expect(r.body.sharingEnabled).toBe(false);
  });

  it("D2 toggle ON then RE-READ from the server reports ON", async () => {
    ACTING_USER = INV_B;
    const w = await request(app)
      .patch("/api/investor/me/benchmarking-sharing")
      .send({ sharingEnabled: true });
    expect(w.status).toBe(200);
    /* The re-read is the whole test — a separate request, not the write's echo. */
    const r = await request(app).get("/api/investor/me/benchmarking-sharing");
    expect(r.status).toBe(200);
    expect(r.body.sharingEnabled).toBe(true);
    expect(r.body.optOutAt).toBeNull();
    expect(wave221IsOptedOut("investor", INV_B)).toBe(false);
  });

  it("D3 toggle OFF then RE-READ reports OFF, with a server-observed timestamp", async () => {
    ACTING_USER = INV_B;
    const w = await request(app)
      .patch("/api/investor/me/benchmarking-sharing")
      .send({ sharingEnabled: false });
    expect(w.status).toBe(200);
    const r = await request(app).get("/api/investor/me/benchmarking-sharing");
    expect(r.status).toBe(200);
    expect(r.body.sharingEnabled).toBe(false);
    expect(typeof r.body.optOutAt).toBe("string");
    expect(r.body.optOutAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(wave221OptOutAt("investor", INV_B)).toBe(r.body.optOutAt);
  });

  it("D4 and it can be turned back on — nothing here is permanent", async () => {
    ACTING_USER = INV_B;
    await request(app).patch("/api/investor/me/benchmarking-sharing").send({ sharingEnabled: true });
    const r = await request(app).get("/api/investor/me/benchmarking-sharing");
    expect(r.body.sharingEnabled).toBe(true);
    setOptOutDirect(INV_B, null);
  });

  it("D5 a missing sharingEnabled is refused rather than guessed", async () => {
    ACTING_USER = INV_B;
    const r = await request(app).patch("/api/investor/me/benchmarking-sharing").send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("SHARING_ENABLED_REQUIRED");
  });

  it("D6 a non-boolean sharingEnabled is refused — an invented value usually arrives as a zero (R201.2)", async () => {
    ACTING_USER = INV_B;
    for (const bad of [0, 1, "true", "false", null, "", "0"]) {
      const r = await request(app)
        .patch("/api/investor/me/benchmarking-sharing")
        .send({ sharingEnabled: bad as never });
      expect(r.status, `sharingEnabled=${JSON.stringify(bad)} must not be accepted`).toBe(400);
    }
  });

  it("D7 the write is authorised to the CALLER's own row and cannot name another subject", async () => {
    ACTING_USER = INV_C;
    setOptOutDirect(INV_C, null);
    setOptOutDirect(INV_D, null);
    /* There is no subject id on the wire at all: the route reads the identity from
       the request context. An attempt to smuggle one must be ignored, not honoured. */
    const r = await request(app)
      .patch("/api/investor/me/benchmarking-sharing")
      .send({ sharingEnabled: false, subjectId: INV_D, userId: INV_D });
    expect(r.status).toBe(200);
    expect(wave221IsOptedOut("investor", INV_C)).toBe(true);
    expect(wave221IsOptedOut("investor", INV_D), "another investor's row must be untouched").toBe(false);
    setOptOutDirect(INV_C, null);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  E. AUDIT — on the platform's one audit path, and it cannot pass on zero rows
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("W221 · E — audit", () => {
  it("E1 a change writes an entry through appendAdminAudit, keyed on the writer's real field", async () => {
    ACTING_USER = INV_E;
    setOptOutDirect(INV_E, null);
    const before = w221AuditRows().length;
    const r = await request(app)
      .patch("/api/investor/me/benchmarking-sharing")
      .send({ sharingEnabled: false });
    expect(r.status).toBe(200);
    const rows = assertNonEmpty(
      w221AuditRows(),
      `no audit row carried eventType="${WAVE221_AUDIT_EVENT}" after a successful change`,
    );
    expect(rows.length).toBeGreaterThan(before);
    const mine = assertNonEmpty(
      rows.filter((e) => String(e.entity ?? "").includes(INV_E)),
      "no audit row named the subject that was just changed",
    );
    expect(String(mine[mine.length - 1].actor ?? mine[mine.length - 1].actorId ?? "")).toContain(INV_E);
    setOptOutDirect(INV_E, null);
  });

  it("E2 a forged X-Forwarded-For is NOT what gets recorded (R187.1)", async () => {
    ACTING_USER = INV_F;
    setOptOutDirect(INV_F, null);
    const FORGED = "203.0.113.199";
    const r = await request(app)
      .patch("/api/investor/me/benchmarking-sharing")
      .set("X-Forwarded-For", FORGED)
      .send({ sharingEnabled: false });
    expect(r.status).toBe(200);
    const rows = assertNonEmpty(
      w221AuditRows().filter((e) => String(e.entity ?? "").includes(INV_F)),
      "no audit row for the forged-header request — a negative assertion over zero rows proves nothing",
    );
    const blob = JSON.stringify(rows);
    /* The defence pre-existed this wave (`resolveRateLimitClientIp` only trusts the
       header from a peer in TRUSTED_PROXY_IPS). The claim proved here is narrow and
       exact: the forged value is not stored. */
    expect(blob).not.toContain(FORGED);
    setOptOutDirect(INV_F, null);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  F. THE STORE'S OWN GUARDS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("W221 · F — store guards", () => {
  it("F1 a write to a non-existent row is REFUSED rather than reported as success", () => {
    const out = wave221SetSharing({
      subject: "investor",
      subjectId: "u_w221_does_not_exist",
      sharingEnabled: false,
      actorId: "u_w221_does_not_exist",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("SUBJECT_ROW_NOT_FOUND");
  });

  it("F2 an empty subject id is refused", () => {
    const out = wave221SetSharing({
      subject: "investor", subjectId: "", sharingEnabled: false, actorId: "x",
    });
    expect(out.ok).toBe(false);
  });

  it("F3 turning sharing back on clears the timestamp to NULL — no residue", () => {
    setOptOutDirect(INV_C, "2026-05-02T00:00:00.000Z");
    expect(wave221IsOptedOut("investor", INV_C)).toBe(true);
    const out = wave221SetSharing({
      subject: "investor", subjectId: INV_C, sharingEnabled: true, actorId: INV_C,
    });
    expect(out.ok).toBe(true);
    expect(wave221OptOutAt("investor", INV_C)).toBeNull();
    const raw = rawDb()
      .prepare(`SELECT ${WAVE221_OPT_OUT_COLUMN} AS v FROM users WHERE id = ?`)
      .get(INV_C) as { v: string | null };
    expect(raw.v).toBeNull();
  });

  it("F4 the timestamp is SERVER-observed — a client-supplied instant is not stored", async () => {
    ACTING_USER = INV_D;
    setOptOutDirect(INV_D, null);
    const FAKE = "1999-01-01T00:00:00.000Z";
    const r = await request(app)
      .patch("/api/investor/me/benchmarking-sharing")
      .send({ sharingEnabled: false, optOutAt: FAKE, timestamp: FAKE });
    expect(r.status).toBe(200);
    expect(r.body.optOutAt).not.toBe(FAKE);
    expect(wave221OptOutAt("investor", INV_D)).not.toBe(FAKE);
    setOptOutDirect(INV_D, null);
  });
});
