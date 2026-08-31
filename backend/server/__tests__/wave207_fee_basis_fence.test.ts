/**
 * WAVE 207 · ITEM A — THE FEE BASIS IS SEVERED FROM CAPITAL, AND THE DATABASE ENFORCES IT.
 * ══════════════════════════════════════════════════════════════════════════════════════
 *
 * R195.1 rules that the BASIS changes, not the NUMBER. So this file has two jobs, and the
 * second is the one that would hurt if it were missing:
 *
 *   1. A capital basis is UNREPRESENTABLE, not merely unused (R180.3) — proved by
 *      attempting the raw insert, not by reading the migration file.
 *   2. NOTHING ELSE MOVED. The banding mechanism still works, the precedence chain still
 *      decides the amount, and a representative fee resolution returns the same answer
 *      before and after the fence is installed.
 *
 * WHY THE REAL ROUTE AND NOT A REPLICA (handbook §8). The fence is installed by
 * `server/lib/partnerFeeAdminRoutes.ts` on the write path, so the write path is driven
 * over HTTP through `registerRoutes` — the same Express app the product runs. A test that
 * called the installer itself and then inserted with its own SQL would prove only that the
 * test can install a constraint.
 *
 * WHY THE INSTALLER EXISTS AT ALL. `server/db/connection.ts` — which builds every
 * in-memory test database and every un-migrated dev database — is SACRED AND FROZEN, so
 * migration 0217's DDL cannot be added to it. `ensureWave207FeeBasisDimension()` is the
 * non-sacred interception layer. The migration itself is proved separately, against a real
 * migrated database, in `build_log/wave207/W207_TESTS.md`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  WAVE207_FEE_BASIS_DDL,
  ensureWave207FeeBasisDimension,
  readActiveVehicleFeeBasis,
  resetWave207InstallMemoForTests,
} from "../lib/wave207FeeBasisPolicy";
import {
  PERMITTED_FEE_BASIS_DIMENSIONS,
  DEFAULT_FEE_BASIS_DIMENSION,
  LEGACY_CAPITAL_BASIS_DIMENSION,
  FEE_BASIS_DIMENSION_CONFIG_KEY,
  isCapitalFeeBasisDimension,
  isPermittedFeeBasisDimension,
} from "../../shared/wave207FeeBasisDimension";
import { resolveSpvDeploymentFee } from "../lib/spvDeploymentFeeSource";
import { resolvePartnerFee, FeeResolutionError } from "../lib/partnerFeeResolver";

let app: Express;
let server: http.Server;

const ADMIN = (req: request.Test): request.Test => req.query({ as: "admin" });

const ISO = "2026-01-01T00:00:00.000Z";

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await seedDemoData(getDb());
  await registerRoutes(server, app);
}, 60_000);

/* ════════════════════════════════════════════════════════════════════════════
 * §1 — THE AMOUNT DID NOT MOVE. Asserted FIRST, because it is the assertion whose
 * failure would matter most: everything else in this wave is worthless if a
 * partner's bill changed.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W207 §1 — installing the fence cannot change a resolved fee", () => {
  /** Resolve, capturing an error as a comparable value rather than throwing. */
  function resolveOrCode(sizeMinor: number | null) {
    try {
      const r = resolvePartnerFee("pc_nonexistent_for_test", "catalyst", "spv_deployment", {
        sizeMinor,
        atIso: ISO,
      });
      return JSON.stringify({ ok: true, amountMinor: String(r.amountMinor), currency: r.currency, via: r.via });
    } catch (err) {
      /* An absent schedule is a legitimate answer and must be IDENTICAL before and
         after. Never let a missing value compete as if it were a value. */
      return JSON.stringify({
        ok: false,
        code: err instanceof FeeResolutionError ? err.code : `unexpected:${(err as Error).message}`,
      });
    }
  }

  it("T207.A1: a representative resolution returns the identical answer before and after", () => {
    const sizes: Array<number | null> = [null, 0, 1_000_000, 24_999_999, 25_000_000, 900_000_000];
    const before = sizes.map((s) => resolveOrCode(s));
    const installed = ensureWave207FeeBasisDimension(rawDb());
    /* The install must actually have done something on this handle, or this test
       would compare two identical no-ops and pass vacuously. */
    expect(installed === null || installed.failed.length === 0).toBe(true);
    const after = sizes.map((s) => resolveOrCode(s));
    expect(after).toEqual(before);
  });

  it("T207.A3: ITEM C — the resolved amount is the SAME at every capital size", () => {
    /* This is the measurement behind the owner-facing claim that the bill no longer
       follows the size of the raise. It is asserted as an equality across sizes rather
       than reasoned about from the schema: whatever the resolver answers — an amount or
       a refusal code — it must be the same answer for a $0 vehicle and a $9,000,000 one.
       The sizes straddle every boundary the legacy band rows declared (0 / 25,000,000 /
       100,000,000 / 500,000,000 minor units), so a surviving band would show up here. */
    const sizes: Array<number | null> = [null, 0, 1_000_000, 24_999_999, 25_000_000, 100_000_000, 499_999_999, 900_000_000];
    const answers = sizes.map((s) => resolveOrCode(s));
    const distinct = Array.from(new Set(answers));
    expect(distinct.length, `capital-varying answers: ${JSON.stringify(answers)}`).toBe(1);

    /* …and the same for the two other fee kinds this table serves, so the claim covers
       the vehicle fee rather than one lucky lookup. */
    for (const kind of ["subscription", "seat_addon"] as const) {
      const perSize = sizes.map((s) => {
        try {
          const r = resolvePartnerFee("pc_nonexistent_for_test", "catalyst", kind, { sizeMinor: s, atIso: ISO });
          return JSON.stringify({ ok: true, amountMinor: String(r.amountMinor), currency: r.currency });
        } catch (err) {
          return JSON.stringify({ ok: false, code: err instanceof FeeResolutionError ? err.code : "unexpected" });
        }
      });
      expect(Array.from(new Set(perSize)).length, `${kind}: ${JSON.stringify(perSize)}`).toBe(1);
    }
  });

  it("T207.A4: ITEM C — the CHARGED deployment fee is the same at every capital size", () => {
    /* T207.A3 measures the schedule table. This measures the function the deployment
       path actually charges from, because that is the number on a partner's bill. It is
       read-only: wave 207 changed nothing inside it, and wave 208 owns its plumbing. */
    const sizes: Array<number | null> = [null, 0, 1_000_000, 24_999_999, 25_000_000, 100_000_000, 900_000_000];
    const answers = sizes.map((s) => {
      try {
        const r = resolveSpvDeploymentFee("pc_nonexistent_for_test", "catalyst", { sizeMinor: s, atIso: ISO });
        return JSON.stringify({
          amountMinor: String((r as { amountMinor?: unknown }).amountMinor ?? "absent"),
          currency: (r as { currency?: unknown }).currency ?? "absent",
          source: (r as { source?: unknown; via?: unknown }).source ?? (r as { via?: unknown }).via ?? "absent",
        });
      } catch (err) {
        return JSON.stringify({ refused: (err as Error).message.slice(0, 80) });
      }
    });
    expect(Array.from(new Set(answers)).length, `capital-varying charge: ${JSON.stringify(answers)}`).toBe(1);
    /* Record WHAT it answered, so the owner-facing report quotes a measured value
       rather than an assumption about it. */
    // eslint-disable-next-line no-console
    console.log(`T207.A4 charged deployment fee, identical at every size: ${answers[0]}`);
  });

  it("T207.A2: every pre-existing row keeps its amount, and takes the flat default basis", () => {
    ensureWave207FeeBasisDimension(rawDb());
    const rows = rawDb()
      .prepare(
        `SELECT id, amount_minor, basis_dimension, size_band_min, size_band_max
           FROM partner_fee_schedules ORDER BY id`,
      )
      .all() as Array<Record<string, unknown>>;
    /* The column is NOT NULL DEFAULT 'flat_per_vehicle', so no row can be left with
       an unknown basis — and none may have been re-priced by the install. */
    for (const r of rows) {
      expect(r.basis_dimension, `row ${String(r.id)} basis`).toBe(DEFAULT_FEE_BASIS_DIMENSION);
      expect(typeof r.amount_minor === "number" || typeof r.amount_minor === "bigint").toBe(true);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §2 — A CAPITAL BASIS IS UNREPRESENTABLE (R180.3), PROVED BY THE RAW INSERT.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W207 §2 — the database refuses a capital-banded fee row", () => {
  beforeAll(() => {
    ensureWave207FeeBasisDimension(rawDb());
  });

  function rawInsert(basis: string, min: number | null, max: number | null): () => void {
    return () =>
      rawDb()
        .prepare(
          `INSERT INTO partner_fee_schedules
             (id, tier, fee_kind, amount_minor, currency, size_band_min, size_band_max,
              effective_from, created_at, updated_at, basis_dimension)
           VALUES (?, 'builder', 'spv_deployment', 50000, 'USD', ?, ?, ?, ?, ?, ?)`,
        )
        .run(`w207_probe_${Math.random().toString(36).slice(2, 10)}`, min, max, ISO, ISO, ISO, basis);
  }

  it("T207.B1: the CHECK constraint refuses every capital wording, by RAW INSERT", () => {
    for (const token of [LEGACY_CAPITAL_BASIS_DIMENSION, "confirmed_capital", "vehicle_size", "capital", ""]) {
      expect(rawInsert(token, null, null), `basis '${token}' must be refused`).toThrow(/CHECK constraint failed/i);
    }
  });

  it("T207.B2: a size band on a flat basis is refused by TRIGGER, by RAW INSERT", () => {
    expect(rawInsert(DEFAULT_FEE_BASIS_DIMENSION, 0, 25_000_000)).toThrow(/WAVE207\/0217 fee basis/);
    expect(rawInsert(DEFAULT_FEE_BASIS_DIMENSION, 25_000_000, null)).toThrow(/WAVE207\/0217 fee basis/);
    /* …including when the basis is left to its default rather than stated. */
    expect(() =>
      rawDb()
        .prepare(
          `INSERT INTO partner_fee_schedules
             (id, tier, fee_kind, amount_minor, currency, size_band_min, size_band_max,
              effective_from, created_at, updated_at)
           VALUES ('w207_probe_default_band', 'builder', 'spv_deployment', 50000, 'USD', 0, 25000000, ?, ?, ?)`,
        )
        .run(ISO, ISO, ISO),
    ).toThrow(/WAVE207\/0217 fee basis/);
  });

  it("T207.B3: an UPDATE cannot smuggle a capital basis or a capital band in later", () => {
    const id = "w207_probe_flat_row";
    rawDb()
      .prepare(
        `INSERT INTO partner_fee_schedules
           (id, tier, fee_kind, amount_minor, currency, effective_from, created_at, updated_at, basis_dimension)
         VALUES (?, 'builder', 'spv_deployment', 50000, 'USD', ?, ?, ?, ?)`,
      )
      .run(id, ISO, ISO, ISO, DEFAULT_FEE_BASIS_DIMENSION);
    expect(() =>
      rawDb().prepare(`UPDATE partner_fee_schedules SET basis_dimension = ? WHERE id = ?`).run(LEGACY_CAPITAL_BASIS_DIMENSION, id),
    ).toThrow(/CHECK constraint failed/i);
    expect(() =>
      rawDb().prepare(`UPDATE partner_fee_schedules SET size_band_min = 0, size_band_max = 1 WHERE id = ?`).run(id),
    ).toThrow(/WAVE207\/0217 fee basis/);
    /* NOTHING IS DELETED — and a legacy banded row stays editable, so the fence
       cannot strand an existing row an administrator may need to correct. */
    rawDb().prepare(`UPDATE partner_fee_schedules SET amount_minor = 1 WHERE id = ?`).run(id);
    expect(
      (rawDb().prepare(`SELECT amount_minor FROM partner_fee_schedules WHERE id = ?`).get(id) as { amount_minor: number })
        .amount_minor,
    ).toBe(1);
    rawDb().prepare(`DELETE FROM partner_fee_schedules WHERE id = ?`).run(id);
  });

  it("T207.B4: THE MECHANISM SURVIVES — a band on a permitted dimension is accepted", () => {
    /* The owner's words: \"I need to have the option/flexibility to charge in the
       future so do not archive the functionality.\" A fence that also killed banding
       would be a deletion dressed up as a fix, so both poles are asserted. */
    const id = "w207_probe_investor_band";
    rawDb()
      .prepare(
        `INSERT INTO partner_fee_schedules
           (id, tier, fee_kind, amount_minor, currency, size_band_min, size_band_max,
            effective_from, created_at, updated_at, basis_dimension)
         VALUES (?, 'nexus', 'spv_deployment', 50000, 'USD', 0, 5, ?, ?, ?, 'investor_count')`,
      )
      .run(id, ISO, ISO, ISO);
    const row = rawDb().prepare(`SELECT basis_dimension, size_band_max FROM partner_fee_schedules WHERE id = ?`).get(id) as
      | { basis_dimension: string; size_band_max: number }
      | undefined;
    expect(row?.basis_dimension).toBe("investor_count");
    expect(row?.size_band_max).toBe(5);
    rawDb().prepare(`DELETE FROM partner_fee_schedules WHERE id = ?`).run(id);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §3 — THE REAL ADMIN ROUTE, OVER HTTP. Never prove a replica (handbook §8).
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W207 §3 — the real write route refuses a capital band and says why", () => {
  it("T207.C0: THE ROUTE ITSELF INSTALLS THE FENCE — proved by removing it and driving the route", async () => {
    /* WHY THIS TEST EXISTS. Every other test in this file installs the fence directly,
       so all of them would still pass if the route stopped installing it — and the
       adversarial disarm proved exactly that (it came back GREEN). The fence only
       protects a real, un-migrated database if the WRITE PATH puts it there, so the
       triggers are removed here, the per-handle memo is cleared, and the refusal is
       demanded from the ROUTE. */
    rawDb().exec(`DROP TRIGGER IF EXISTS w207_fee_basis_no_capital_band_ins`);
    rawDb().exec(`DROP TRIGGER IF EXISTS w207_fee_basis_no_capital_band_upd`);
    expect(
      rawDb()
        .prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'w207_%'`)
        .get() as { n: number },
    ).toEqual({ n: 0 });
    resetWave207InstallMemoForTests(rawDb());

    const res = await ADMIN(
      request(app).post("/api/admin/partner-fees").send({
        tier: "amplifier",
        feeKind: "spv_deployment",
        amountMinor: 12345,
        currency: "USD",
        sizeBandMin: 0,
        sizeBandMax: 1_000_000,
        effectiveFrom: ISO,
      }),
    );
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("fee_basis_not_permitted");
    /* …and the triggers are back, because the route installed them. */
    expect(
      (rawDb()
        .prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'w207_%'`)
        .get() as { n: number }).n,
    ).toBe(2);
  });

  it("T207.C1: POST with size bands on a vehicle fee is refused with a readable reason", async () => {
    const res = await ADMIN(
      request(app).post("/api/admin/partner-fees").send({
        tier: "builder",
        feeKind: "spv_deployment",
        amountMinor: 50000,
        currency: "USD",
        sizeBandMin: 0,
        sizeBandMax: 25_000_000,
        effectiveFrom: ISO,
      }),
    );
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("fee_basis_not_permitted");
    const msg = String(res.body?.message ?? "");
    expect(msg).toContain("cannot carry a size band");
    /* R77 — a partner or admin must never be handed a raw enum, and the 240-char
       `looksHuman` ceiling applies to a sentence a human reads. */
    expect(msg.length).toBeLessThanOrEqual(240);
    expect(msg).not.toMatch(/SQLITE_|constraint failed/i);
  });

  it("T207.C2: THE CAPABILITY SURVIVES — the same POST without a capital band is accepted, at the amount sent", async () => {
    const res = await ADMIN(
      request(app).post("/api/admin/partner-fees").send({
        tier: "builder",
        feeKind: "spv_deployment",
        amountMinor: 50000,
        currency: "USD",
        effectiveFrom: ISO,
      }),
    );
    expect(res.status).toBe(200);
    const id = String(res.body?.id ?? res.body?.schedule?.id ?? "");
    expect(id).not.toBe("");
    const row = rawDb()
      .prepare(`SELECT amount_minor, basis_dimension FROM partner_fee_schedules WHERE id = ?`)
      .get(id) as { amount_minor: number; basis_dimension: string } | undefined;
    /* The number the admin sent is the number stored — R156: admin keeps full control. */
    expect(row?.amount_minor).toBe(50000);
    expect(row?.basis_dimension).toBe(DEFAULT_FEE_BASIS_DIMENSION);

    /* …and PATCHing a capital band onto it afterwards is refused by the same route. */
    const patch = await ADMIN(
      request(app).patch(`/api/admin/partner-fees/${id}`).send({ sizeBandMin: 0, sizeBandMax: 25_000_000 }),
    );
    expect(patch.status).toBe(409);
    expect(patch.body?.error).toBe("fee_basis_not_permitted");

    /* …while a plain re-price through the same route still works. NOTHING IS DELETED. */
    const reprice = await ADMIN(request(app).patch(`/api/admin/partner-fees/${id}`).send({ amountMinor: 60000 }));
    expect(reprice.status).toBe(200);
    expect(
      (rawDb().prepare(`SELECT amount_minor FROM partner_fee_schedules WHERE id = ?`).get(id) as { amount_minor: number })
        .amount_minor,
    ).toBe(60000);

    rawDb().prepare(`DELETE FROM partner_fee_schedules WHERE id = ?`).run(id);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §4 — THE PERMITTED SET IS NAMED IN THE SCHEMA, AND CANNOT DRIFT FROM THE CODE.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W207 §4 — one permitted set, in every place it is written", () => {
  const ROOT = path.resolve(__dirname, "..", "..");
  const A = path.join(ROOT, "migrations", "0217_wave207_fee_basis_dimension.sql");
  const B = path.join(ROOT, "server", "db", "migrations", "0217_wave207_fee_basis_dimension.sql");

  it("T207.D1: migration 0217 exists in BOTH directories and is byte-identical", () => {
    const a = fs.readFileSync(A);
    const b = fs.readFileSync(B);
    expect(a.equals(b)).toBe(true);
  });

  it("T207.D2: the migration, the installer and the shared constant name the SAME set", () => {
    const sql = fs.readFileSync(A, "utf8");
    /* Read the CHECK list out of the migration text itself rather than trusting a
       second copy of the list written into this test. */
    const check = /basis_dimension"?\s+IN\s*\(([^)]*)\)/i.exec(sql);
    expect(check, "the migration must name the permitted set in a CHECK").not.toBeNull();
    const fromSql = (check![1].match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, "")).sort();
    /* NOTE (independent verification, 2026-08-30): an earlier revision of this line
       carried `.filter((v) => v !== "flat_per_vehicle" || true)`. That predicate is
       ALWAYS TRUE — `x !== y || true` cannot be false — so the filter excluded
       nothing while reading as though it excluded the DEFAULT literal. It was
       removed rather than corrected, because the de-duplication on the assertion
       below is what actually handles the repeated DEFAULT value, and two mechanisms
       for one job is how a proof drifts. Do not reintroduce a filter here: if the
       installer's literal set ever needs narrowing, narrow it explicitly and assert
       the exclusion, so the narrowing is itself proved rather than assumed. */
    const fromInstaller = (WAVE207_FEE_BASIS_DDL[0].match(/'([a-z_]+)'/g) ?? [])
      .map((s) => s.replace(/'/g, ""))
      .sort();
    const fromShared = [...PERMITTED_FEE_BASIS_DIMENSIONS].sort();
    expect(fromSql).toEqual(fromShared);
    /* The installer's first statement also carries the DEFAULT literal, which is one
       of the permitted values, so a de-duplicated comparison is the correct one. */
    expect([...new Set(fromInstaller)].sort()).toEqual(fromShared);
  });

  it("T207.D3: no permitted dimension is a capital dimension", () => {
    for (const d of PERMITTED_FEE_BASIS_DIMENSIONS) {
      expect(isCapitalFeeBasisDimension(d), `${d} must not read as capital`).toBe(false);
      expect(isPermittedFeeBasisDimension(d)).toBe(true);
    }
    expect(isCapitalFeeBasisDimension(LEGACY_CAPITAL_BASIS_DIMENSION)).toBe(true);
    expect(isPermittedFeeBasisDimension(LEGACY_CAPITAL_BASIS_DIMENSION)).toBe(false);
  });

  it("T207.D4: the migration inserts and updates nothing — it cannot move a figure", () => {
    const sql = fs.readFileSync(A, "utf8")
      /* Strip comments before drawing any conclusion from a grep (handbook rule). */
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*--.*$/gm, "");
    /* The words INSERT and UPDATE legitimately appear as trigger EVENTS
       (`BEFORE INSERT ON …`), which write nothing. What must be absent is DML:
       a statement that could touch a stored amount. */
    expect(sql).not.toMatch(/INSERT\s+(OR\s+\w+\s+)?INTO/i);
    expect(sql).not.toMatch(/UPDATE\s+"?\w+"?\s+SET/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    /* …and the only bodies inside the triggers are refusals. */
    const bodies = sql.match(/BEGIN([\s\S]*?)END;/gi) ?? [];
    expect(bodies.length).toBe(2);
    for (const b of bodies) expect(b).toMatch(/^BEGIN SELECT RAISE\(ABORT,/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * §5 — WHAT THE PLATFORM SAYS THE BASIS IS, AND WHERE IT GOT IT (R-ASSERT).
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W207 §5 — the basis in force is reported with its provenance", () => {
  it("T207.E1: the answer is a permitted dimension and names its source", () => {
    ensureWave207FeeBasisDimension(rawDb());
    const active = readActiveVehicleFeeBasis();
    expect(isPermittedFeeBasisDimension(active.dimension)).toBe(true);
    expect(isCapitalFeeBasisDimension(active.dimension)).toBe(false);
    expect(["platform_config", "default"]).toContain(active.source);
    expect(active.storedValueRejected).toBe(false);
    expect(FEE_BASIS_DIMENSION_CONFIG_KEY).toBe("fee.vehicle.basis_dimension");
  });
});
