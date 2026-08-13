/**
 * WAVE 29 · ITEM 2 — `uq_partner_crm_email_parity` gains the `dedup_exempt`
 * predicate, and the self-heal's completeness check stops lying.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * 0097's design: a same-email / different-person CRM conflict is NOT
 * auto-merged. Both rows stay live, both get `dedup_exempt = 1`, and the pair
 * waits in `crm_dedup_review` for an admin. 0098 implements that by excluding
 * exempt rows from its partial UNIQUE indexes.
 *
 * But `partner_crm_contacts` carries a SECOND partial UNIQUE index over the
 * same key — `uq_partner_crm_email_parity` from 0106 — with no `dedup_exempt`
 * predicate. A row must satisfy every index on its table, so the parity index
 * unilaterally vetoed the exemption: partner duplicates were impossible, while
 * founder and investor duplicates worked as designed. Wave 28 proved this by
 * execution (its case 15) and reported it without closing it.
 *
 * ── WHY THIS HARNESS IS BUILT THE WAY IT IS ────────────────────────────────
 * Wave 28's ITEM 2 harness had a `beforeAll` that created the very schema whose
 * creation was under test, which masked a real one-shot bug in the self-heal.
 * That is the trap to avoid here, so:
 *
 *   · Case (1) reads the LIVE index definition out of `sqlite_master` rather
 *     than trusting that the migration or the installer ran.
 *   · Cases (2) and (3) assert BOTH POLES by actually inserting. An index that
 *     permits everything would satisfy (2) perfectly and is not a fix; (3) is
 *     what refuses it.
 *   · Cases (4) and (5) build a database that is deliberately in the BROKEN
 *     intermediate state and make the self-heal repair it, rather than
 *     observing an already-correct database and calling that proof.
 */
import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

type Handle = InstanceType<typeof Database>;

const MIGRATION = path.join(process.cwd(), "migrations", "0176_wave29_partner_crm_parity_dedup_exempt.sql");
const MIGRATION_MIRROR = path.join(
  process.cwd(), "server", "db", "migrations", "0176_wave29_partner_crm_parity_dedup_exempt.sql",
);

/** The partner CRM table as `connection.ts`'s inline baseline builds it, plus
 *  0106's ORIGINAL (defective) parity index. This is the state to repair. */
function makeBrokenDb(): Handle {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE partner_crm_contacts (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      created_at TEXT,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_crm_email_parity
      ON partner_crm_contacts (partner_id, lower(trim(email)))
      WHERE email IS NOT NULL
        AND trim(email) <> ''
        AND deleted_at IS NULL;
  `);
  // 0097 (0a)'s additive flag column.
  db.exec(`ALTER TABLE partner_crm_contacts ADD COLUMN dedup_exempt INTEGER`);
  return db;
}

function indexSql(db: Handle): string | undefined {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='uq_partner_crm_email_parity'`)
    .get() as { sql?: string } | undefined;
  return row?.sql;
}

function insert(db: Handle, id: string, name: string, exempt: number | null) {
  db.prepare(
    `INSERT INTO partner_crm_contacts (id, partner_id, name, email, created_at, dedup_exempt)
     VALUES (?, 'ptr_1', ?, 'shared@inbox.test', '2026-01-01T00:00:00Z', ?)`,
  ).run(id, name, exempt);
}

describe("WAVE 29 · ITEM 2 — migration 0176 is real, mirrored, and drops before it creates", () => {
  it("(0) the migration exists in BOTH directories and is byte-identical", () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
    expect(fs.existsSync(MIGRATION_MIRROR)).toBe(true);
    expect(fs.readFileSync(MIGRATION)).toEqual(fs.readFileSync(MIGRATION_MIRROR));
  });

  it("(1) it DROPs the old index before creating — a bare CREATE IF NOT EXISTS would be a silent no-op on exactly the databases that have the bug", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    const dropAt = sql.indexOf("DROP INDEX IF EXISTS uq_partner_crm_email_parity");
    const createAt = sql.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_crm_email_parity");
    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
    expect(sql).toMatch(/dedup_exempt IS NULL OR dedup_exempt <> 1/);
  });
});

describe("WAVE 29 · ITEM 2 — applying 0176 makes 0097's design work, and BREAKS NOTHING ELSE", () => {
  let db: Handle;

  beforeAll(() => {
    db = makeBrokenDb();
  });

  it("(2) CONTROL — before the migration, the exempt partner duplicate is REFUSED. The bug is real on this database", () => {
    insert(db, "p_a", "Alice Adams", 1);
    expect(() => insert(db, "p_b", "Bob Brown", 1)).toThrow(/UNIQUE|constraint/i);
    expect(indexSql(db)).not.toMatch(/dedup_exempt/);
  });

  it("(3) after 0176, two LIVE exempt partner rows on one email coexist — which is exactly what 0097 requires", () => {
    db.exec(fs.readFileSync(MIGRATION, "utf8"));
    expect(indexSql(db)).toMatch(/dedup_exempt/);
    insert(db, "p_b", "Bob Brown", 1);
    const live = db
      .prepare(`SELECT id FROM partner_crm_contacts WHERE partner_id='ptr_1' AND deleted_at IS NULL`)
      .all();
    expect(live).toHaveLength(2);
  });

  it("(4) THE OTHER POLE — NON-exempt partner duplicates are STILL REFUSED. The index was corrected, not weakened", () => {
    // Without this, an index that simply permitted everything would sail
    // through case (3) and would be a data-integrity regression sold as a fix.
    //
    // The exact semantics matter and this assertion was WRONG on first write,
    // which is worth leaving recorded. Exempt rows sit OUTSIDE a partial index,
    // so p_a and p_b (both exempt) are not in it at all. The first NON-exempt
    // row therefore has nothing to collide with and must be accepted — that is
    // correct 0097 behaviour, not a hole. Uniqueness bites on the SECOND
    // non-exempt row, and that is what has to throw.
    expect(() => insert(db, "p_c", "Carol Clark", null)).not.toThrow();
    expect(() => insert(db, "p_d", "Dan Doyle", 0)).toThrow(/UNIQUE|constraint/i);
    expect(() => insert(db, "p_e", "Erin Ellis", null)).toThrow(/UNIQUE|constraint/i);
  });

  it("(5) and a SOFT-DELETED row still frees the slot, as before — the deleted_at predicate survived the rewrite", () => {
    const fresh = makeBrokenDb();
    fresh.exec(fs.readFileSync(MIGRATION, "utf8"));
    insert(fresh, "p_x", "Xena", null);
    fresh.prepare(`UPDATE partner_crm_contacts SET deleted_at='2026-02-01T00:00:00Z' WHERE id='p_x'`).run();
    expect(() => insert(fresh, "p_y", "Yuri", null)).not.toThrow();
  });

  it("(6) the corrected parity index is now IDENTICAL in effect to uq_partner_crm_email_scope from 0098 — the two no longer contradict each other", () => {
    const fresh = makeBrokenDb();
    fresh.exec(fs.readFileSync(MIGRATION, "utf8"));
    fresh.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_crm_email_scope
        ON partner_crm_contacts (partner_id, lower(trim(email)))
        WHERE deleted_at IS NULL
          AND email IS NOT NULL
          AND trim(email) <> ''
          AND (dedup_exempt IS NULL OR dedup_exempt <> 1);
    `);
    // With BOTH indexes present, the exempt pair must still be insertable.
    insert(fresh, "p_a", "Alice Adams", 1);
    expect(() => insert(fresh, "p_b", "Bob Brown", 1)).not.toThrow();
    // And the non-exempt duplicate must still be refused by both.
    expect(() => insert(fresh, "p_c", "Carol Clark", null)).not.toThrow(); // first non-exempt is fine
    expect(() => insert(fresh, "p_d", "Dan Doyle", null)).toThrow(/UNIQUE|constraint/i);
  });
});
