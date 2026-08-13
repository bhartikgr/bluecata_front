/**
 * WAVE 38 · ROW 4 — THE SCHEMA ITSELF, BUILT FROM CANONICAL MIGRATIONS ALONE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS SEPARATELY FROM THE LINT
 * ─────────────────────────────────────────────────────────────────────────────
 * `wave0_3_ledger_primitives_lint.test.ts` reads SQL TEXT. That is useful and it
 * is not evidence. A text lint cannot tell you whether the statements it read
 * actually EXECUTE, whether the engine accepted `STRICT`, whether a rebuild
 * dropped a trigger on its way past, or whether the money column now refuses
 * 'not-a-number'. Only a database can tell you that.
 *
 * So this file builds a real SQLite database by executing `migrations/*.sql`
 * — the CANONICAL directory, alone, in order, through the SHIPPED splitter
 * from `server/db/migrate.ts` — and then interrogates the result with
 * `PRAGMA table_info`, `sqlite_master`, and live INSERTs.
 *
 * NOTHING HERE TRUSTS AN EXIT CODE. There is no "the migration ran, therefore
 * the schema is right" step anywhere below. Every claim is read back off the
 * built database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH POLES, EVERY TIME
 * ─────────────────────────────────────────────────────────────────────────────
 * Each defect assertion is paired with a CONTROL on a deliberately non-STRICT
 * table built in the same connection. If the control ever stops accepting
 * '12.5' and 'not-a-number', the harness has lost its ability to detect the
 * defect it claims to have fixed, and it says so instead of passing quietly.
 *
 * The suite establishes its own preconditions, reads no `process.env`, uses
 * static imports, and never touches a file in the repository.
 *
 * SACRED: `server/db/migrate.ts` and `server/db/connection.ts` are imported and
 * read. Neither is modified.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { splitStatements } from "../db/migrate";
import {
  applyWave38EventLedgerSchema,
  applyWave38EventLedgerSchemaOnce,
  partitionByTable,
  WAVE38_LEDGER_TABLES,
} from "../lib/applyWave38EventLedgerSchema";

const ROOT = path.resolve(__dirname, "../..");
const CANONICAL_DIR = path.join(ROOT, "migrations");

/** The six tables migration 0183 rebuilds. */
const REBUILT_TABLES = [
  "partner_money_event",
  "valuation_event",
  "partner_subscription_event",
  "esign_event",
  "spv_discovery_event",
  "mf_engagement_event",
] as const;

const CANONICAL_COLUMNS = [
  "actor_id",
  "request_id",
  "idempotency_key",
  "source_event_type",
  "source_event_id",
  "reverses_id",
  "seq",
  "created_at",
  "deleted_at",
] as const;

const NOT_NULL_COLUMNS = ["actor_id", "seq", "created_at"] as const;

interface StatementFailure {
  file: string;
  index: number;
  head: string;
  message: string;
}

interface BuiltDb {
  db: InstanceType<typeof Database>;
  failures: StatementFailure[];
  filesApplied: number;
  statementsExecuted: number;
}

/**
 * Execute every canonical migration in id order against a fresh in-memory
 * database.
 *
 * Statement failures are COLLECTED, not swallowed: the chain has a documented,
 * pre-existing red statement early on (0040), and aborting there would mean
 * this file could never see 0183 at all. Collecting lets the assertions below
 * demand ZERO failures attributable to 0183 while pinning the pre-existing
 * count so a NEW breakage cannot hide inside the old one.
 */
function buildFromCanonicalMigrations(opts: { omit?: string[] } = {}): BuiltDb {
  const omit = new Set(opts.omit ?? []);
  const files = fs
    .readdirSync(CANONICAL_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !omit.has(f))
    .sort((a, b) => {
      const ai = Number(/^(\d{4})_/.exec(a)![1]);
      const bi = Number(/^(\d{4})_/.exec(b)![1]);
      return ai - bi || a.localeCompare(b);
    });

  const db = new Database(":memory:");
  // Matches 0131's own rebuild preamble. Referential integrity is not what this
  // file is testing, and leaving it on would make historical out-of-order
  // inserts fail for reasons unrelated to the event-table shape.
  db.pragma("foreign_keys = OFF");

  const failures: StatementFailure[] = [];
  let statementsExecuted = 0;

  for (const f of files) {
    const sql = fs.readFileSync(path.join(CANONICAL_DIR, f), "utf8");
    const statements = splitStatements(sql);
    statements.forEach((stmt, index) => {
      const trimmed = stmt.trim();
      if (trimmed === "") return;
      statementsExecuted += 1;
      try {
        db.exec(stmt);
      } catch (err) {
        failures.push({
          file: f,
          index,
          head: trimmed.replace(/^(?:--[^\n]*\n|\s)+/, "").slice(0, 120),
          message: (err as Error).message,
        });
      }
    });
  }

  return { db, failures, filesApplied: files.length, statementsExecuted };
}

function columnsOf(db: InstanceType<typeof Database>, table: string): Array<{ name: string; type: string; notnull: number }> {
  return db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string; notnull: number }>;
}

function ddlOf(db: InstanceType<typeof Database>, table: string): string {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { sql: string } | undefined;
  return row?.sql ?? "";
}

describe("WAVE 38 ROW 4 — event-table ledger primitives, asserted against a database built from canonical migrations alone", () => {
  let built: BuiltDb;

  beforeAll(() => {
    built = buildFromCanonicalMigrations();
  });

  it("anti-vacuity: the build actually executed a substantial canonical corpus", () => {
    // If the directory scan silently matched nothing, every assertion below
    // would pass against an empty database. Pin the floor.
    expect(built.filesApplied).toBeGreaterThan(150);
    expect(built.statementsExecuted).toBeGreaterThan(1000);
    const tableCount = (
      built.db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number }
    ).n;
    expect(tableCount).toBeGreaterThan(100);
  });

  it("migration 0183 executed with ZERO statement failures", () => {
    const from0183 = built.failures.filter((f) => f.file.startsWith("0183_"));
    expect(
      from0183,
      `Migration 0183 did not apply cleanly. A rebuild that half-ran is worse than one that never ran.\n${JSON.stringify(from0183, null, 2)}`,
    ).toEqual([]);
  });

  it("no NEW statement failure was introduced anywhere in the chain", () => {
    // A canonical-migrations-ONLY build is deliberately harsher than a real
    // boot: it runs without the application self-heal in `connection.ts` that
    // supplies columns and tables some migrations assume are already present.
    // 95 statements across 21 files therefore fail here today, and every one of
    // them predates WAVE 38.
    //
    // This assertion does not bless them — it PINS them, per file and per
    // count, so a failure introduced by this wave cannot hide inside the
    // existing noise. A bare total would let one new failure cancel out one
    // accidentally-fixed old one; the per-file map will not.
    const EXPECTED_PRE_EXISTING_FAILURES: Record<string, number> = {
      "0002_slow_medusa.sql": 1,
      "0002_v12_tenants_softdelete.sql": 17,
      "0006_dataroom_extensions.sql": 6,
      "0020_chapters.sql": 4,
      "0030_v17c_offers_state_machine.sql": 6,
      "0040_perf_indexes.sql": 2,
      "0042_partner_crm_hash_columns.sql": 2,
      "0043_partner_deal_pipeline_legacy_id.sql": 1,
      "0047_promotion_moderation.sql": 4,
      "0048_gdpr_data_logs.sql": 4,
      "0049_founder_tier_billing_cycle.sql": 2,
      "0050_users_title_displayname.sql": 2,
      "0096_v25_52_collective_member_access_backfill.sql": 1,
      "0099_v25_53_round_invite_active_unique_index.sql": 2,
      "0117_comms_channel_anchors.sql": 4,
      "0123_wave0_platform_config.sql": 1,
      "0130_wave_c2_authority_artifacts.sql": 3,
      "0131_wave_c2_mf_engagement_columns.sql": 16,
      "0136_wave_c2_partner_company_relationship_spine.sql": 7,
      "0169_wave13_partner_subscription_shape_reconcile.sql": 9,
      "0172_wave19_partner_invitation_seat_integrity.sql": 1,
    };
    const actual: Record<string, number> = {};
    for (const f of built.failures) actual[f.file] = (actual[f.file] ?? 0) + 1;
    expect(
      actual,
      `Canonical-chain statement failures changed. Full detail:\n${JSON.stringify(built.failures, null, 2)}`,
    ).toEqual(EXPECTED_PRE_EXISTING_FAILURES);
  });

  describe.each(REBUILT_TABLES)("%s", (table) => {
    it("exists and is declared STRICT in the built database", () => {
      const ddl = ddlOf(built.db, table);
      expect(ddl, `${table} is absent from the built database`).not.toBe("");
      expect(/\)\s*STRICT\s*$/i.test(ddl.trim()), `${table} DDL as built:\n${ddl}`).toBe(true);
    });

    it("carries every canonical event column", () => {
      const names = new Set(columnsOf(built.db, table).map((c) => c.name));
      const missing = CANONICAL_COLUMNS.filter((c) => !names.has(c));
      expect(missing, `${table} is missing canonical columns`).toEqual([]);
    });

    it("declares actor_id / seq / created_at NOT NULL", () => {
      const cols = columnsOf(built.db, table);
      const nullable = NOT_NULL_COLUMNS.filter((n) => {
        const col = cols.find((c) => c.name === n);
        return !col || col.notnull !== 1;
      });
      expect(nullable, `${table} has nullable mandatory columns`).toEqual([]);
    });

    it("has the partial unique index on idempotency_key", () => {
      const idx = built.db
        .prepare(
          `SELECT name, sql FROM sqlite_master
            WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`,
        )
        .all(table) as Array<{ name: string; sql: string }>;
      const idem = idx.filter(
        (i) => /unique/i.test(i.sql) && /idempotency_key/i.test(i.sql) && /where/i.test(i.sql),
      );
      expect(
        idem.length,
        `${table} has no partial UNIQUE index on idempotency_key. Indexes present:\n${JSON.stringify(idx, null, 2)}`,
      ).toBe(1);
    });

    it("the scratch rebuild table was not left behind", () => {
      const leftover = built.db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(`${table}__w38`);
      expect(leftover, `${table}__w38 survived the rebuild`).toBeUndefined();
    });
  });

  describe("THE DEFECT ITSELF — the money column refuses what it used to swallow", () => {
    const MONEY_TABLE = "partner_subscription_event";

    function insertAmount(value: unknown): { ok: boolean; error: string } {
      const id = `pse_probe_${Math.random().toString(36).slice(2)}`;
      try {
        built.db
          .prepare(
            `INSERT INTO ${MONEY_TABLE}
               (id, subscription_id, event_kind, amount_minor, currency, actor_id, seq, created_at)
             VALUES (?, 'sub_w38_probe', 'probe', ?, ?, 'system',
                     (SELECT COALESCE(MAX(seq), 0) + 1 FROM ${MONEY_TABLE} WHERE subscription_id = 'sub_w38_probe'),
                     '2026-08-12T00:00:00.000Z')`,
          )
          .run(id, value as never, "JPY");
        return { ok: true, error: "" };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    it("NEGATIVE POLE (control): a NON-STRICT twin still swallows both bad values", () => {
      // Without this control, a green result above could mean "STRICT works" or
      // it could mean "our INSERT was malformed and never reached the type
      // check". The control proves the probe is capable of storing junk when
      // the floor is absent.
      built.db.exec(`CREATE TABLE w38_control_non_strict (id TEXT PRIMARY KEY, amount_minor INTEGER)`);
      const ins = built.db.prepare(`INSERT INTO w38_control_non_strict (id, amount_minor) VALUES (?, ?)`);
      ins.run("c1", "12.5");
      ins.run("c2", "not-a-number");
      const rows = built.db
        .prepare(`SELECT id, amount_minor AS v, typeof(amount_minor) AS t FROM w38_control_non_strict ORDER BY id`)
        .all() as Array<{ id: string; v: unknown; t: string }>;
      expect(rows).toEqual([
        { id: "c1", v: 12.5, t: "real" },
        { id: "c2", v: "not-a-number", t: "text" },
      ]);
    });

    it("POSITIVE POLE: the rebuilt table REFUSES '12.5'", () => {
      const r = insertAmount("12.5");
      expect(r.ok, "'12.5' was accepted into a money column").toBe(false);
      // STRICT first coerces the losslessly-numeric TEXT '12.5' to REAL, then
      // refuses REAL -> INTEGER as lossy. Either wording is the same refusal;
      // what must not weaken is that the engine names THIS column.
      expect(r.error).toMatch(
        new RegExp(`cannot store (TEXT|REAL) value in INTEGER column ${MONEY_TABLE}\\.amount_minor`, "i"),
      );
    });

    it("POSITIVE POLE: the rebuilt table REFUSES 'not-a-number'", () => {
      const r = insertAmount("not-a-number");
      expect(r.ok, "'not-a-number' was accepted into a money column").toBe(false);
      expect(r.error).toMatch(/cannot store TEXT value in INTEGER column/i);
    });

    it("POSITIVE POLE: the rebuilt table REFUSES a fractional REAL", () => {
      const r = insertAmount(12.5);
      expect(r.ok, "12.5 was accepted into an integer minor-unit column").toBe(false);
    });

    it("a legitimate JPY amount (exponent 0) is still accepted and read back exactly", () => {
      // JPY has exponent 0: 1250 minor units IS \u00a51250, so a rounding or
      // decimal-shifting defect in the rebuild would be visible here and
      // nowhere else. The value is read back with `typeof` so a silent
      // affinity conversion cannot pass as success.
      const r = insertAmount(1250);
      expect(r.ok, `a valid JPY integer amount was refused: ${r.error}`).toBe(true);
      const row = built.db
        .prepare(
          `SELECT amount_minor AS v, typeof(amount_minor) AS t, currency
             FROM ${MONEY_TABLE} WHERE subscription_id = 'sub_w38_probe' AND amount_minor IS NOT NULL`,
        )
        .get() as { v: number; t: string; currency: string };
      expect(row).toEqual({ v: 1250, t: "integer", currency: "JPY" });
    });

    it("NULL is still permitted \u2014 an unknown amount is a null, never a zero", () => {
      expect(insertAmount(null).ok).toBe(true);
      const zeros = (
        built.db
          .prepare(`SELECT COUNT(*) AS n FROM ${MONEY_TABLE} WHERE subscription_id = 'sub_w38_probe' AND amount_minor = 0`)
          .get() as { n: number }
      ).n;
      expect(zeros, "a refused or absent amount was materialised as 0").toBe(0);
    });
  });

  describe("the rebuild preserved what 0167/0168 established", () => {
    it("partner_subscription_event is still append-only (UPDATE and DELETE both abort)", () => {
      built.db
        .prepare(
          `INSERT INTO partner_subscription_event
             (id, subscription_id, event_kind, actor_id, seq, created_at)
           VALUES ('pse_immutable', 'sub_w38_immutable', 'created', 'system', 1, '2026-08-12T00:00:00.000Z')`,
        )
        .run();
      expect(() =>
        built.db.prepare(`UPDATE partner_subscription_event SET event_kind = 'tampered' WHERE id = 'pse_immutable'`).run(),
      ).toThrow(/append-only/i);
      expect(() =>
        built.db.prepare(`DELETE FROM partner_subscription_event WHERE id = 'pse_immutable'`).run(),
      ).toThrow(/append-only/i);
      // And the row is genuinely still there and unmodified.
      const row = built.db
        .prepare(`SELECT event_kind FROM partner_subscription_event WHERE id = 'pse_immutable'`)
        .get() as { event_kind: string };
      expect(row).toEqual({ event_kind: "created" });
    });

    it("esign_event's foreign key to esign_envelope survived the rebuild", () => {
      // Not incidental: 0131 leaves `PRAGMA foreign_keys = ON` at the end of the
      // chain, so the built database enforces keys. An orphan event must be
      // refused BEFORE the append-only test below is allowed to seed one.
      expect(() =>
        built.db
          .prepare(
            `INSERT INTO esign_event (id, envelope_id, event_kind, actor_id, seq, created_at)
             VALUES ('ese_orphan', 'env_does_not_exist', 'sent', 'system', 1, '2026-08-12T00:00:00.000Z')`,
          )
          .run(),
      ).toThrow(/FOREIGN KEY constraint failed/i);
    });

    it("esign_event is still append-only (ESIGN_EVENT_IMMUTABLE)", () => {
      // This test establishes its own precondition: the parent envelope.
      built.db
        .prepare(
          `INSERT INTO esign_envelope
             (id, subject_kind, subject_id, document_kind, document_ref, document_title,
              provider, status, created_at)
           VALUES ('env_w38', 'partner', 'po_w38', 'lpa', 'doc_w38', 'W38 Probe LPA',
                   'internal', 'sent', '2026-08-12T00:00:00.000Z')`,
        )
        .run();
      built.db
        .prepare(
          `INSERT INTO esign_event (id, envelope_id, event_kind, actor_id, seq, created_at)
           VALUES ('ese_immutable', 'env_w38', 'sent', 'system', 1, '2026-08-12T00:00:00.000Z')`,
        )
        .run();
      expect(() =>
        built.db.prepare(`UPDATE esign_event SET event_kind = 'tampered' WHERE id = 'ese_immutable'`).run(),
      ).toThrow(/ESIGN_EVENT_IMMUTABLE/);
      expect(() => built.db.prepare(`DELETE FROM esign_event WHERE id = 'ese_immutable'`).run()).toThrow(
        /ESIGN_EVENT_IMMUTABLE/,
      );
    });

    it("the historical indexes survived the rebuild", () => {
      const expected: Array<[string, string]> = [
        ["partner_money_event", "idx_pme_subject"],
        ["partner_money_event", "idx_pme_partner"],
        ["valuation_event", "idx_w9_val_vehicle"],
        ["valuation_event", "idx_w9_val_holding"],
        ["valuation_event", "idx_w9_val_live"],
        ["partner_subscription_event", "idx_partner_subscription_event_sub"],
        ["esign_event", "idx_w11_esign_event_env"],
        ["spv_discovery_event", "idx_spv_discovery_event_spv"],
        ["spv_discovery_event", "idx_spv_discovery_event_viewer"],
        ["mf_engagement_event", "idx_mf_engagement_event_partner"],
        ["mf_engagement_event", "idx_mf_engagement_event_eng"],
      ];
      const present = new Set(
        (built.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as Array<{ name: string }>).map(
          (r) => r.name,
        ),
      );
      const missing = expected.filter(([, idx]) => !present.has(idx));
      expect(missing, "a rebuild silently dropped an index").toEqual([]);
    });

    it("mf_engagement_event kept 0131's relaxed nullability and scope CHECK", () => {
      const cols = columnsOf(built.db, "mf_engagement_event");
      expect(cols.find((c) => c.name === "engagement_id")?.notnull).toBe(0);
      expect(cols.find((c) => c.name === "company_id")?.notnull).toBe(0);
      expect(cols.find((c) => c.name === "partner_id")?.notnull).toBe(1);
      // The scope CHECK must still refuse a row that belongs to neither an
      // engagement nor an attribution.
      expect(() =>
        built.db
          .prepare(
            `INSERT INTO mf_engagement_event (id, partner_id, event_type, actor_id, seq, created_at)
             VALUES ('mfev_scopeless', 'p_w38', 'probe', 'system', 1, '2026-08-12T00:00:00.000Z')`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/i);
    });
  });

  describe("the idempotency floor actually holds", () => {
    it("a duplicate idempotency_key is REFUSED, and NULLs are exempt", () => {
      const ins = built.db.prepare(
        `INSERT INTO spv_discovery_event
           (id, spv_id, viewer_user_id, context, scope_at_time, via_invitation, actor_id, idempotency_key, seq, created_at)
         VALUES (?, 'spv_w38', 'u_w38', 'collective', 'public', 0, 'u_w38', ?, ?, '2026-08-12T00:00:00.000Z')`,
      );
      ins.run("sd1", "idem-w38", 1);
      expect(() => ins.run("sd2", "idem-w38", 2)).toThrow(/UNIQUE constraint failed/i);
      // Two NULL keys must both be accepted: history has no keys, and a partial
      // index that treated NULLs as equal would make the backfill impossible.
      ins.run("sd3", null, 3);
      ins.run("sd4", null, 4);
      const n = (
        built.db.prepare(`SELECT COUNT(*) AS n FROM spv_discovery_event WHERE spv_id = 'spv_w38'`).get() as { n: number }
      ).n;
      expect(n).toBe(3);
    });

    it("seq must be positive \u2014 the CHECK is real, not decorative", () => {
      expect(() =>
        built.db
          .prepare(
            `INSERT INTO spv_discovery_event
               (id, spv_id, viewer_user_id, context, scope_at_time, via_invitation, actor_id, seq, created_at)
             VALUES ('sd_zero', 'spv_w38b', 'u_w38', 'collective', 'public', 0, 'u_w38', 0, '2026-08-12T00:00:00.000Z')`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/i);
    });

    it("actor_id is genuinely NOT NULL at the engine level", () => {
      expect(() =>
        built.db
          .prepare(
            `INSERT INTO valuation_event
               (id, tenant_id, vehicle_kind, vehicle_id, valuation_date, fair_value_minor,
                currency, method, source, preparer, is_external, created_by, actor_id, seq, created_at)
             VALUES ('val_null_actor', 't1', 'spv', 'v1', '2026-01-01', 100, 'JPY',
                     'cost', 'admin_import', 'p', 0, 'u1', NULL, 1, '2026-08-12T00:00:00.000Z')`,
          )
          .run(),
      ).toThrow(/NOT NULL constraint failed/i);
    });
  });
});


/* ═══════════════════════════════════════════════════════════════════════════
 * THE BOOTSTRAP PATH — the heal that carries 0183 to databases the migration
 * runner never touches.
 *
 * `server/db/connection.ts` (SACRED) builds test and fresh-`:memory:` databases
 * from DDL inlined in that file, not from the numbered migrations. Everything
 * asserted above would therefore be true of production and FALSE of the path
 * the test suite itself runs on — the exact shape of "a check that passed while
 * checking nothing". `server/lib/applyWave38EventLedgerSchema.ts` closes that,
 * and this block proves it closes it, from both poles.
 *
 * The "pre-0183" fixture is not fabricated DDL. It is the SAME canonical chain
 * built above with 0183 OMITTED, so the before-state is the real historical
 * schema rather than something this test invented to be easy to fix.
 * ═══════════════════════════════════════════════════════════════════════════ */
const MIGRATION_0183 = "0183_wave38_event_table_ledger_primitives.sql";

describe("WAVE 38 ROW 4 — the bootstrap heal (applyWave38EventLedgerSchema)", () => {
  let pre: BuiltDb;

  beforeAll(() => {
    pre = buildFromCanonicalMigrations({ omit: [MIGRATION_0183] });
  });

  it("anti-vacuity: omitting 0183 really does omit it", () => {
    // If the omit filter silently matched nothing, the NEGATIVE POLE below
    // would be asserting against an already-healed database and would fail —
    // but it would fail for a confusing reason. Say it plainly here instead.
    expect(fs.existsSync(path.join(CANONICAL_DIR, MIGRATION_0183))).toBe(true);
    expect(pre.filesApplied).toBe(
      fs.readdirSync(CANONICAL_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).length - 1,
    );
  });

  it("NEGATIVE POLE: without 0183 the six tables have NO ledger primitives", () => {
    for (const t of WAVE38_LEDGER_TABLES) {
      if (t === "mf_engagement_event") continue; // absent entirely without 0183
      const cols = new Set(columnsOf(pre.db, t).map((c) => c.name));
      expect(cols.has("actor_id"), `${t} already had actor_id before the heal`).toBe(false);
      expect(cols.has("seq"), `${t} already had seq before the heal`).toBe(false);
    }
  });

  it("NEGATIVE POLE: without 0183 the money column silently floats '12.5'", () => {
    pre.db
      .prepare(
        `INSERT INTO partner_subscription_event (id, subscription_id, event_kind, amount_minor, currency, created_at)
         VALUES ('pse_pre', 'sub_pre', 'created', '12.5', 'JPY', '2026-08-12T00:00:00.000Z')`,
      )
      .run();
    const row = pre.db
      .prepare(`SELECT amount_minor AS v, typeof(amount_minor) AS t FROM partner_subscription_event WHERE id = 'pse_pre'`)
      .get() as { v: unknown; t: string };
    // This is the defect, on the real historical schema, in this process — and
    // it is worse than "stored as text": the pre-0183 column has INTEGER
    // AFFINITY without STRICT, so '12.5' is silently coerced to the binary
    // FLOAT 12.5 and a money value is now held in a type that cannot represent
    // every minor unit exactly. Nothing warned.
    expect(row).toEqual({ v: 12.5, t: "real" });
  });

  it("POSITIVE POLE: the heal installs the primitives and the refusal", () => {
    const result = applyWave38EventLedgerSchema(pre.db as any);
    expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([]);
    // Five tables rebuilt plus mf_engagement_event, which the heal creates.
    expect([...result.applied].sort()).toEqual([...WAVE38_LEDGER_TABLES].sort());
    expect(result.absent).toEqual([]);

    for (const t of WAVE38_LEDGER_TABLES) {
      const cols = new Set(columnsOf(pre.db, t).map((c) => c.name));
      for (const c of CANONICAL_COLUMNS) {
        expect(cols.has(c), `${t} is missing ${c} after the heal`).toBe(true);
      }
      expect(ddlOf(pre.db, t)).toMatch(/\)\s*STRICT\s*;?\s*$/);
    }

    // And the defect is gone on the very same connection that just exhibited it.
    expect(() =>
      pre.db
        .prepare(
          `INSERT INTO partner_subscription_event
             (id, subscription_id, event_kind, amount_minor, currency, actor_id, seq, created_at)
           VALUES ('pse_post', 'sub_pre', 'created', '12.5', 'JPY', 'system', 99, '2026-08-12T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/cannot store (TEXT|REAL) value in INTEGER column/i);
  });

  it("the heal MOVED the pre-existing row rather than dropping it", () => {
    // A rebuild that quietly loses history would otherwise pass every shape
    // assertion above. '12.5' was un-typeable, so it must land as NULL — a null,
    // never a zero — and the row itself must still be there.
    const row = pre.db
      .prepare(
        `SELECT amount_minor AS v, typeof(amount_minor) AS t, currency, actor_id, seq
           FROM partner_subscription_event WHERE id = 'pse_pre'`,
      )
      .get() as { v: unknown; t: string; currency: string; actor_id: string; seq: number };
    expect(row.t).toBe("null");
    expect(row.v).toBeNull();
    expect(row.currency).toBe("JPY");
    expect(row.seq).toBeGreaterThan(0);
    const zeros = (
      pre.db.prepare(`SELECT COUNT(*) AS n FROM partner_subscription_event WHERE amount_minor = 0`).get() as { n: number }
    ).n;
    expect(zeros, "an un-typeable amount was materialised as 0").toBe(0);
  });

  it("is idempotent: a second call rebuilds nothing and loses nothing", () => {
    const again = applyWave38EventLedgerSchema(pre.db as any);
    expect(again.applied).toEqual([]);
    expect([...again.alreadyCanonical].sort()).toEqual([...WAVE38_LEDGER_TABLES].sort());
    expect(again.failures).toEqual([]);
    const still = pre.db
      .prepare(`SELECT COUNT(*) AS n FROM partner_subscription_event WHERE id = 'pse_pre'`)
      .get() as { n: number };
    expect(still.n).toBe(1);
  });

  it("the once-wrapper caches per HANDLE, not per module", () => {
    // First call on this handle already happened through the un-wrapped entry
    // point, so the wrapper still has work to observe; after it returns a
    // fully-canonical verdict it must short-circuit.
    expect(applyWave38EventLedgerSchemaOnce(pre.db as any)).not.toBeNull();
    expect(applyWave38EventLedgerSchemaOnce(pre.db as any)).toBeNull();
    // A DIFFERENT handle must NOT inherit that verdict.
    const other = new Database(":memory:");
    const verdict = applyWave38EventLedgerSchemaOnce(other as any);
    expect(verdict, "a fresh database inherited another database's heal").not.toBeNull();
    other.close();
  });

  it("partitionByTable attributes every executable statement in 0183", () => {
    const sql = fs.readFileSync(path.join(CANONICAL_DIR, MIGRATION_0183), "utf8");
    const blocks = partitionByTable(sql);
    for (const t of WAVE38_LEDGER_TABLES) {
      expect(blocks.get(t)!.length, `${t} got no statements`).toBeGreaterThan(5);
    }
    const attributed = [...blocks.values()].reduce((n, a) => n + a.length, 0);
    const executable = splitStatements(sql).filter(
      (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trim() !== "",
    ).length;
    expect(attributed, "statements were dropped on the floor during partitioning").toBe(executable);
  });
});
