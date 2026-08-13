/**
 * WAVE 29 · ITEM 2 (second half) — the SELF-HEAL path.
 *
 * Migration 0176 fixes databases that run migrations. It does nothing for a
 * database built from `server/db/connection.ts`'s inline baseline, which is
 * SACRED, still emits the OLD parity-index definition at :2161, and creates
 * neither `crm_dedup_review` nor the `dedup_exempt` columns. That path is the
 * installer's job — the same split Wave 24 used for the mark-override default.
 *
 * This file asserts the installer on the REAL application database, because a
 * repair that only works on a hand-built in-memory fixture is not a repair.
 */
import { describe, it, expect } from "vitest";
import { ensureCrmDedupReviewSchema } from "../crmDedupReviewStore";
import { rawDb } from "../db/connection";

function parityIndexSql(): string | undefined {
  const row = (rawDb() as any)
    .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='uq_partner_crm_email_parity'`)
    .get() as { sql?: string } | undefined;
  return row?.sql;
}

function cols(table: string): string[] {
  return ((rawDb() as any).prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((c) => c.name);
}

describe("WAVE 29 · ITEM 2 — the self-heal repairs the parity index on the REAL database", () => {
  it("(1) after ensureCrmDedupReviewSchema(), the live parity index carries the dedup_exempt predicate", () => {
    ensureCrmDedupReviewSchema(true);
    const sql = parityIndexSql();
    // If the index is absent entirely there is nothing to prove and the case
    // would be vacuous — so require it to exist before asserting about it.
    expect(sql, "uq_partner_crm_email_parity is missing; this case would be vacuous").toBeTruthy();
    expect(sql).toMatch(/dedup_exempt/);
  });

  it("(2) the dedup_exempt columns exist on all three CRM tables", () => {
    ensureCrmDedupReviewSchema(true);
    for (const t of ["founder_crm_contacts", "investor_crm_contacts", "partner_crm_contacts"]) {
      expect(cols(t), `${t} is missing dedup_exempt`).toContain("dedup_exempt");
    }
  });

  it("(3) crm_dedup_review exists with 0175's resolution columns", () => {
    ensureCrmDedupReviewSchema(true);
    const c = cols("crm_dedup_review");
    for (const want of ["resolution", "survivor_id", "resolution_note"]) expect(c).toContain(want);
  });

  it("(4) THE ONE-SHOT TRAP — break the index AFTER a successful ensure, then call the ensure again with force=false. It must still repair", () => {
    // This is the exact shape of the bug Wave 28's harness masked: a cached
    // `schemaEnsured` flag that outlives the schema it describes, so the second
    // call returns "already done" while the artifact is gone. Wave 28 closed it
    // for the TABLE only; the columns and this index were still uncovered,
    // which is what Wave 29 widened `crmDedupSchemaComplete` to catch.
    ensureCrmDedupReviewSchema(true); // flag is now set
    (rawDb() as any).exec(`DROP INDEX IF EXISTS uq_partner_crm_email_parity`);
    (rawDb() as any).exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_crm_email_parity
         ON partner_crm_contacts (partner_id, lower(trim(email)))
         WHERE email IS NOT NULL AND trim(email) <> '' AND deleted_at IS NULL`,
    );
    expect(parityIndexSql()).not.toMatch(/dedup_exempt/); // control: really broken

    ensureCrmDedupReviewSchema(); // force = FALSE — the cached-flag path
    expect(parityIndexSql()).toMatch(/dedup_exempt/);
  });

  it("(5) THE OTHER POLE — the repair is IDEMPOTENT and does not drop an already-correct index on every call", () => {
    ensureCrmDedupReviewSchema(true);
    const before = parityIndexSql();
    for (let i = 0; i < 5; i++) ensureCrmDedupReviewSchema();
    expect(parityIndexSql()).toBe(before);
  });

  it("(6) and the repaired index actually CHANGES BEHAVIOUR on the real DB — exempt duplicates insertable, non-exempt duplicates still refused", () => {
    ensureCrmDedupReviewSchema(true);
    const db = rawDb() as any;
    const P = "ptr_w29_probe";
    const E = "w29probe@inbox.test";
    db.prepare(`DELETE FROM partner_crm_contacts WHERE partner_id = ?`).run(P);

    const ins = (id: string, exempt: number | null) =>
      db
        .prepare(
          `INSERT INTO partner_crm_contacts (id, tenant_id, partner_id, name, email, created_at, updated_at, dedup_exempt)
           VALUES (?, 'w29_tenant', ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?)`,
        )
        .run(id, P, `N${id}`, E, exempt);

    try {
      ins("w29_a", 1);
      expect(() => ins("w29_b", 1)).not.toThrow(); // 0097's design, now honoured
      expect(() => ins("w29_c", null)).not.toThrow(); // first non-exempt: nothing to collide with
      expect(() => ins("w29_d", null)).toThrow(/UNIQUE|constraint/i); // still constrained
    } finally {
      db.prepare(`DELETE FROM partner_crm_contacts WHERE partner_id = ?`).run(P);
    }
  });
});
