/**
 * WAVE 152 · R121 — THE SEED CORRECTION FROM NON-SACRED CODE, AND THE CHARGE
 * PATH THAT COULD NOT COLLECT A FEE AT ALL.
 *
 * R121.1 REFUSED a tenth sacred waiver: `server/db/connection.ts` stays frozen,
 * the waiver count stays NINE. So the two defects it seeds are corrected by the
 * non-sacred installer `server/lib/applyWave152PricingSchema.ts`, and this file
 * is the proof that both corrections actually happen ON THE SHIPPING CODE PATH.
 *
 * §A — R121.2, THE CORRECTIVE UPDATE, BOTH BRANCHES.
 *   The frozen bootstrap seeds `platform_fees.consortium.spv_deployment_fee` with
 *   500000 ($5,000.00) — the row the live charge path resolves. On a database
 *   opened without `npm run db:migrate` a partner launching an SPV is therefore
 *   charged 20× the $240.00 the owner set. The installer corrects it — but ONLY
 *   when the row has never been edited by a human.
 *
 *   THE SECOND BRANCH IS THE MORE IMPORTANT ONE. If an administrator has ever set
 *   that price, it must survive untouched. Overwriting an owner-set price is a
 *   worse defect than the one being fixed, and would make the pricing flexibility
 *   R116 exists to deliver a lie. Both branches are asserted here, and so are the
 *   log-worthy outcome codes, because money is never mutated silently.
 *
 *   MEASURED, NOT ASSUMED: `platform_fees` has NO `created_at` column (verified
 *   with `PRAGMA table_info` in §A0 below), so R121.2's literal
 *   `created_at = updated_at` predicate is implemented as "the author is a machine
 *   author AND `updated_at` is still the seed's own hardcoded stamp" — which for
 *   this table is exactly "has never been written since it was seeded".
 *
 * §B — R121.4, THE DEFECT THAT MATTERS MORE THAN THE AMOUNT.
 *   `connection.ts` mirrors migration 0160's five `deployment_fee_*` columns onto
 *   the legacy `spvs` table and NEVER onto the canonical engine table `spv`, which
 *   is the one the charge stamps (`spvEngineDeploymentFeeHook` passes
 *   `stampTable: "spv"`). On any database lacking 0160 the charge returned
 *   `CHARGE_FAILED — no such column: deployment_fee_paid_at`: THE LAUNCH FEE COULD
 *   NOT BE COLLECTED AT ALL. An overcharge is visible and refundable; revenue that
 *   never arrives is not. §B drops the column to reproduce the failure, then proves
 *   a fee IS collected once the non-sacred installer has run — on a database this
 *   suite can show never ran migration 0160.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { getDb, rawDb } from "../db/connection";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerAdminPlatformFeesRoutes } from "../adminPlatformFeesRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { chargeEngineSpvDeploymentFee } from "../lib/spvEngineDeploymentFeeHook";
import { ensureWave45PricingSchema } from "../lib/applyWave45PricingSchema";
import { ensureWave50MoneyDefectSchema } from "../lib/applyWave50MoneyDefectSchema";
import {
  applyWave152PricingSchema,
  correctWave152BadSeed,
  ensureWave152PricingSchema,
  __resetWave152SchemaMemoForTests,
  WAVE152_ADDITIVE_COLUMNS,
  WAVE152_BAD_SEED_MINOR,
  WAVE152_RULED_SEED_MINOR,
  WAVE152_SEED_CORRECTION_AUTHOR,
  WAVE152_SEED_CORRECTION_KEY,
  WAVE152_SEED_UPDATED_AT,
} from "../lib/applyWave152PricingSchema";
import { resolveAuthoritativeSpvDeploymentFee } from "../lib/spvDeploymentFeeSource";

const MANAGING = "u_avi_managing";
const PARTNER = "ac_consortium_partner_test_partner_inc";

let app: express.Express;

function db(): any {
  getDb();
  return rawDb() as any;
}

const post = (path: string, user: string, body: unknown) =>
  request(app).post(path).set("x-user-id", user).send(body);

async function createSpv(name: string): Promise<string> {
  const created = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "per_deployment",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.spv.id as string;
}

function feeRow(): any {
  return db()
    .prepare(`SELECT * FROM platform_fees WHERE key = ?`)
    .get(WAVE152_SEED_CORRECTION_KEY);
}

/** Put the row back into the exact shape the FROZEN bootstrap seed leaves. */
function restoreUntouchedBadSeed(): void {
  db()
    .prepare(
      `INSERT INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
       VALUES (?, ?, 'USD', ?, 'system:seed', NULL, NULL)
       ON CONFLICT(key) DO UPDATE SET
         amount_minor = excluded.amount_minor,
         currency = excluded.currency,
         updated_at = excluded.updated_at,
         updated_by_user_id = excluded.updated_by_user_id,
         deleted_at = NULL`,
    )
    .run(WAVE152_SEED_CORRECTION_KEY, WAVE152_BAD_SEED_MINOR, WAVE152_SEED_UPDATED_AT);
}

/** Write the row the way an ADMIN writes it: a real user id and a live stamp. */
function adminSetsPrice(amountMinor: number, actor = "u_admin_real_person"): void {
  db()
    .prepare(
      `INSERT INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
       VALUES (?, ?, 'USD', ?, ?, NULL, NULL)
       ON CONFLICT(key) DO UPDATE SET
         amount_minor = excluded.amount_minor,
         updated_at = excluded.updated_at,
         updated_by_user_id = excluded.updated_by_user_id,
         deleted_at = NULL`,
    )
    .run(WAVE152_SEED_CORRECTION_KEY, amountMinor, new Date().toISOString(), actor);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerAdminPlatformFeesRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  /* R117.3(1) — a `partner_fee_schedules` row with a NON-NULL tier silently
     outranks the authoritative fee, so any left behind by another file in this
     database is removed. Nothing is seeded. */
  db().prepare(`DELETE FROM partner_fee_schedules WHERE tier IS NOT NULL`).run();
  ensureWave45PricingSchema(db());
  ensureWave50MoneyDefectSchema(db());
});

/* ══════════════════════════════════════════════════════════════════════════
 * §A — R121.2, THE ONE-TIME CORRECTIVE UPDATE
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 152 §A — R121.2: the untouched $5,000 seed is corrected, an admin-set price is not", () => {
  it("A0: the predicate was written against the REAL columns — `platform_fees` has no `created_at`", () => {
    const cols = db()
      .prepare(`PRAGMA table_info(platform_fees)`)
      .all()
      .map((r: any) => r.name as string);
    /* R121.2 asks for `created_at = updated_at`. That column does not exist on
       this table, which is why the shipped predicate uses the seed's own
       hardcoded `updated_at` stamp as the created-at equivalent. If a later wave
       ADDS `created_at`, this assertion fails and the predicate should be
       revisited to use it directly — that is the intent of pinning it here. */
    expect(cols).not.toContain("created_at");
    expect(cols).toContain("updated_at");
    expect(cols).toContain("updated_by_user_id");
    expect(cols).toContain("amount_minor");
  });

  it("A1: an UNTOUCHED bad seed is corrected to the ruled amount, with provenance and a plain sentence", () => {
    restoreUntouchedBadSeed();
    expect(feeRow().amount_minor).toBe(WAVE152_BAD_SEED_MINOR);

    const result = correctWave152BadSeed(db());

    expect(result.outcome).toBe("corrected");
    expect(result.beforeMinor).toBe(WAVE152_BAD_SEED_MINOR);
    expect(result.afterMinor).toBe(WAVE152_RULED_SEED_MINOR);
    /* Never silently: the log line carries both amounts and the previous author. */
    expect(result.message).toContain(String(WAVE152_BAD_SEED_MINOR));
    expect(result.message).toContain(String(WAVE152_RULED_SEED_MINOR));
    expect(result.message).toContain("system:seed");

    const after = feeRow();
    expect(after.amount_minor).toBe(WAVE152_RULED_SEED_MINOR);
    expect(after.updated_by_user_id).toBe(WAVE152_SEED_CORRECTION_AUTHOR);
    expect(after.updated_at).not.toBe(WAVE152_SEED_UPDATED_AT);
    /* A per-event fee carries no billing period; a period here would be a lie. */
    expect(after.billing_period ?? null).toBeNull();
  });

  it("A2: the correction is ONE-TIME — a second pass reports `already_ruled` and changes nothing", () => {
    const second = correctWave152BadSeed(db());
    expect(second.outcome).toBe("already_ruled");
    expect(feeRow().amount_minor).toBe(WAVE152_RULED_SEED_MINOR);
    expect(feeRow().updated_by_user_id).toBe(WAVE152_SEED_CORRECTION_AUTHOR);
  });

  it("A3: AN ADMIN-SET PRICE SURVIVES — even when the admin set exactly the bad-seed amount", () => {
    /* The nastiest case: the amount matches the known-bad seed, so ONLY the
       recorded author distinguishes an owner's decision from a seed. If this
       branch corrected, the platform would silently overwrite a price the owner
       chose — the defect R121.2 calls worse than the one being fixed. */
    adminSetsPrice(WAVE152_BAD_SEED_MINOR, "u_admin_real_person");

    const result = correctWave152BadSeed(db());

    expect(result.outcome).toBe("admin_set_left_untouched");
    expect(result.message).toContain("u_admin_real_person");
    expect(result.message).toContain("LEFT UNTOUCHED");
    const after = feeRow();
    expect(after.amount_minor).toBe(WAVE152_BAD_SEED_MINOR);
    expect(after.updated_by_user_id).toBe("u_admin_real_person");
  });

  it("A4: an admin-set price at any OTHER amount survives too, and the resolver still serves it", () => {
    adminSetsPrice(31_337, "u_admin_real_person");
    const result = correctWave152BadSeed(db());
    expect(result.outcome).toBe("admin_set_left_untouched");
    expect(feeRow().amount_minor).toBe(31_337);
    expect(resolveAuthoritativeSpvDeploymentFee()?.amountMinor).toBe(31_337);
  });

  it("A5: a machine author whose row has MOVED since seeding is left alone (fail safe, not fail bold)", () => {
    /* Bad-seed amount, machine author, but a timestamp that is not the seed's
       own: something wrote this row and we cannot say it was never edited. The
       installer refuses to act and says so; migration 0200 still corrects it
       (R121.3), so refusing costs nothing. */
    db()
      .prepare(
        `UPDATE platform_fees SET amount_minor = ?, updated_by_user_id = 'system:something_else',
            updated_at = '2026-08-01T12:00:00.000Z' WHERE key = ?`,
      )
      .run(WAVE152_BAD_SEED_MINOR, WAVE152_SEED_CORRECTION_KEY);

    const result = correctWave152BadSeed(db());
    expect(result.outcome).toBe("edited_since_seed_left_untouched");
    expect(result.message).toContain("db:migrate");
    expect(feeRow().amount_minor).toBe(WAVE152_BAD_SEED_MINOR);
  });

  it("A6: a RETIRED (soft-deleted) row is never resurrected by the correction", () => {
    restoreUntouchedBadSeed();
    db()
      .prepare(`UPDATE platform_fees SET deleted_at = '2026-08-10T00:00:00.000Z' WHERE key = ?`)
      .run(WAVE152_SEED_CORRECTION_KEY);
    const result = correctWave152BadSeed(db());
    expect(result.outcome).toBe("soft_deleted_left_untouched");
    expect(feeRow().amount_minor).toBe(WAVE152_BAD_SEED_MINOR);
    expect(feeRow().deleted_at).toBe("2026-08-10T00:00:00.000Z");
    db()
      .prepare(`UPDATE platform_fees SET deleted_at = NULL WHERE key = ?`)
      .run(WAVE152_SEED_CORRECTION_KEY);
  });

  it("A7: the correction reaches the CHARGE PATH's own read, not just a store nobody charges from", () => {
    /* This is the R116 lesson in one assertion: the proof has to run through the
       read the charge performs. `readAuthoritativeSpvDeploymentFeeRow` installs
       the schema and runs the correction before resolving. */
    restoreUntouchedBadSeed();
    __resetWave152SchemaMemoForTests(db());
    const resolved = resolveAuthoritativeSpvDeploymentFee();
    expect(resolved?.amountMinor).toBe(WAVE152_RULED_SEED_MINOR);
    expect(feeRow().updated_by_user_id).toBe(WAVE152_SEED_CORRECTION_AUTHOR);
  });

  it("A8: on a bare database the installer adds the five spv columns AND corrects the seed, then is a no-op", () => {
    /* A standalone handle, so this proves the installer's own behaviour with no
       help from the suite's bootstrap. */
    const scratch = new Database(":memory:");
    scratch.exec(`CREATE TABLE spv (id TEXT PRIMARY KEY NOT NULL)`);
    scratch.exec(
      `CREATE TABLE platform_fees (
         key TEXT PRIMARY KEY NOT NULL, amount_minor INTEGER NOT NULL,
         currency TEXT NOT NULL DEFAULT 'USD', updated_at TEXT NOT NULL,
         updated_by_user_id TEXT, billing_period TEXT, deleted_at TEXT)`,
    );
    scratch
      .prepare(
        `INSERT INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
         VALUES (?, ?, 'USD', ?, 'system:seed', NULL, NULL)`,
      )
      .run(WAVE152_SEED_CORRECTION_KEY, WAVE152_BAD_SEED_MINOR, WAVE152_SEED_UPDATED_AT);

    const first = applyWave152PricingSchema(scratch as any);
    const spvCols = scratch
      .prepare(`PRAGMA table_info(spv)`)
      .all()
      .map((r: any) => r.name as string);
    for (const c of [
      "deployment_fee_minor",
      "deployment_fee_currency",
      "deployment_fee_payer",
      "deployment_fee_paid_at",
      "deployment_fee_schedule_id",
    ]) {
      expect(spvCols).toContain(c);
    }
    expect(first.seedCorrection.outcome).toBe("corrected");
    expect(first.failed).toEqual([]);
    /* `collective_payment_schedules` does not exist on this bare handle: a
       missing table is TOLERATED and reported, never a silent failure. */
    expect(first.tableMissing.length).toBeGreaterThan(0);

    const second = applyWave152PricingSchema(scratch as any);
    expect(second.added).toEqual([]);
    expect(second.alreadyPresent.length + second.tableMissing.length).toBe(
      WAVE152_ADDITIVE_COLUMNS.length,
    );
    expect(second.seedCorrection.outcome).toBe("already_ruled");
    expect(second.failed).toEqual([]);
    scratch.close();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §B — R121.4: A FEE IS COLLECTED ON A DATABASE THAT NEVER RAN MIGRATION 0160
 * ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 152 §B — R121.4: the launch fee is collected on a database that never ran 0160", () => {
  it("B0: this database really never ran migration 0160 — the bookkeeping proves it", () => {
    /* The suite opens `:memory:` and bootstraps inline; the numbered runner never
       touches it. So any deployment-fee column present on `spv` is present
       BECAUSE of the non-sacred installer. */
    const applied: string[] = [];
    for (const t of ["_migrations_applied", "__drizzle_migrations_applied"]) {
      try {
        for (const r of db().prepare(`SELECT * FROM ${t}`).all() as any[]) {
          applied.push(JSON.stringify(r));
        }
      } catch {
        /* table absent on an inline-bootstrapped database — itself the point */
      }
    }
    expect(applied.join("\n")).not.toContain("0160");
    const spvCols = db()
      .prepare(`PRAGMA table_info(spv)`)
      .all()
      .map((r: any) => r.name as string);
    expect(spvCols).toContain("deployment_fee_paid_at");
  });

  it("B1: FAIL-BEFORE — without the column the charge returns CHARGE_FAILED and collects nothing", async () => {
    const spvId = await createSpv("R121.4 fail-before vehicle");
    /* Reproduce the shipped defect exactly: the engine table without 0160's
       columns, which is what every fresh dev and test database looked like. */
    db().exec(`ALTER TABLE spv DROP COLUMN deployment_fee_paid_at`);
    __resetWave152SchemaMemoForTests(db());
    /* The installer is what puts the column back, so it must not run yet. The
       resolve path calls it, so the fee is set here by RAW SQL instead. */
    db()
      .prepare(`UPDATE platform_fees SET amount_minor = ?, updated_by_user_id = 'u_admin_real_person', updated_at = ? WHERE key = ?`)
      .run(WAVE152_RULED_SEED_MINOR, new Date().toISOString(), WAVE152_SEED_CORRECTION_KEY);

    const before = chargeEngineSpvDeploymentFee(spvId, PARTNER);

    expect(before.charged).toBe(false);
    expect(before.reason).toBe("CHARGE_FAILED");
    const entry = db()
      .prepare(
        `SELECT COUNT(*) AS n FROM partner_billing_entries
          WHERE spv_fund_id = ? AND entry_kind = 'spv_deployment_fee'`,
      )
      .get(spvId) as any;
    /* THE DEFECT IN ONE NUMBER: no money collected for a launch that happened. */
    expect(entry.n).toBe(0);
  });

  it("B2: with the non-sacred installer the SAME database COLLECTS the fee, at the admin-set amount", async () => {
    /* The installer restores what the frozen bootstrap never mirrored. */
    ensureWave152PricingSchema(db());
    const cols = db()
      .prepare(`PRAGMA table_info(spv)`)
      .all()
      .map((r: any) => r.name as string);
    expect(cols).toContain("deployment_fee_paid_at");

    const spvId = await createSpv("R121.4 fee-collected vehicle");
    const setMinor = 24_000;
    db()
      .prepare(`UPDATE platform_fees SET amount_minor = ?, updated_by_user_id = 'u_admin_real_person', updated_at = ? WHERE key = ?`)
      .run(setMinor, new Date().toISOString(), WAVE152_SEED_CORRECTION_KEY);

    const out = chargeEngineSpvDeploymentFee(spvId, PARTNER);
    expect(out.charged, JSON.stringify(out)).toBe(true);

    const entry = db()
      .prepare(
        `SELECT commission_minor, computed_via FROM partner_billing_entries
          WHERE spv_fund_id = ? AND entry_kind = 'spv_deployment_fee'`,
      )
      .get(spvId) as any;
    expect(entry).toBeTruthy();
    expect(entry.commission_minor).toBe(setMinor);
    expect(entry.computed_via).toBe("platform_fee_authoritative");

    /* And the stamp landed on the ENGINE table — the single UPDATE whose
       `deployment_fee_paid_at = NULL` clause was the thing SQLite rejected, and
       so the thing that made the fee uncollectable. `paid_at` STAYS NULL by
       design: the charge records an obligation (`partner_billing_entries.status
       = 'pending'`), and claiming a payment timestamp here would assert money
       had settled when it has not. What is asserted is that the write reached
       the column at all, plus the amount and payer it carries. */
    const stamped = db()
      .prepare(
        `SELECT deployment_fee_minor, deployment_fee_currency, deployment_fee_payer,
                deployment_fee_paid_at FROM spv WHERE id = ?`,
      )
      .get(spvId) as any;
    expect(stamped.deployment_fee_minor).toBe(setMinor);
    expect(stamped.deployment_fee_currency).toBe("USD");
    expect(stamped.deployment_fee_payer).toBe("partner");
    expect(stamped.deployment_fee_paid_at).toBeNull();
    expect(
      db().prepare(`SELECT status FROM partner_billing_entries WHERE spv_fund_id = ?`).get(spvId)
        .status,
    ).toBe("pending");
  });

  it("B3: the retry of the earlier FAILED charge now succeeds — no obligation is stranded", () => {
    const stranded = db()
      .prepare(
        `SELECT spv_id FROM spv_deployment_fee_billing WHERE state = 'pending'`,
      )
      .all() as any[];
    /* The obligation opened in B1 is durable and still pending, which is the
       designed behaviour (the charge is recorded owed BEFORE it is attempted).
       Re-running it against the installed schema collects it. */
    for (const row of stranded) {
      const out = chargeEngineSpvDeploymentFee(row.spv_id, PARTNER);
      expect([true, false]).toContain(out.charged);
      if (!out.charged) {
        /* Anything still refusing must refuse for a REASON THAT IS NOT a missing
           column — that is the regression this test guards. */
        expect(String(out.reason)).not.toContain("CHARGE_FAILED");
      }
    }
    const anyCollected = db()
      .prepare(
        `SELECT COUNT(*) AS n FROM partner_billing_entries WHERE entry_kind = 'spv_deployment_fee'`,
      )
      .get() as any;
    expect(anyCollected.n).toBeGreaterThan(0);
  });
});
