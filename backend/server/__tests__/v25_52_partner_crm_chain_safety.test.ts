/**
 * v25.52 Track 3.5 (GPT-5.5 re-review blocker #2) — partner CRM hash-chain safety.
 *
 * partner_crm_contacts is an AUDIT HASH-CHAIN table (auditChainVerifier registers
 * it hasDeletedAt:true, NO chainPartitionByRowId → sequential prev/curr walk over
 * LIVE rows). Migration 0097 must therefore NEVER soft-delete a partner row (that
 * would drop a link and break the chain). Instead it logs + exempts partner dup
 * groups. This test drives the REAL migration SQL (0097 + 0098) through the REAL
 * splitStatements + better-sqlite3 against a seeded 3-row partner chain whose
 * NON-TAIL row is a same-name duplicate, and asserts the chain is untouched.
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { splitStatements } from "../db/migrate";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "data.db");
const M97 = path.join(ROOT, "migrations/0097_v25_52_crm_dedup_backfill.sql");
const M98 = path.join(ROOT, "migrations/0098_v25_52_crm_email_unique_index.sql");

function isIdempotent(m: string): boolean {
  return /duplicate column name/i.test(m) || /table .* already exists/i.test(m) ||
         /index .* already exists/i.test(m) || /UNIQUE constraint failed/i.test(m);
}
function runLikeRunner(db: Database.Database, file: string) {
  for (const s of splitStatements(fs.readFileSync(file, "utf8"))) {
    try { db.exec(s); } catch (e: any) { if (isIdempotent(e.message)) continue; throw e; }
  }
}
const h = (x: string) => crypto.createHash("sha256").update(x).digest("hex");

describe("v25.52 — partner CRM hash chain survives dedup backfill", () => {
  it("never soft-deletes partner rows; chain byte-identical; live walk still valid; dups exempt+logged", () => {
    const tmp = path.join("/tmp", `pc_vitest_${Date.now()}.db`);
    for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + suffix); } catch { /* noop */ } }
    fs.copyFileSync(SRC, tmp);
    const db = new Database(tmp);
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS crm_dedup_review (id TEXT PRIMARY KEY, crm_scope TEXT, scope_id TEXT, email_norm TEXT, contact_ids TEXT, distinct_names TEXT, status TEXT, created_at TEXT, resolved_at TEXT, resolved_by TEXT)`);

      const pid = "ptnr_chain_vitest";
      const payload = (r: any, prev: string) => [r.partner_id, r.contact_user_id, r.email, r.name, r.created_at, prev].join("|");
      const rows = [
        { id: "pcv1", partner_id: pid, contact_user_id: "u1", email: "dup@acme.com", name: "John Smith", created_at: "2026-01-01T00:00:00.000Z" },
        { id: "pcv2", partner_id: pid, contact_user_id: "u2", email: "DUP@acme.com", name: "John Smith", created_at: "2026-01-02T00:00:00.000Z" }, // non-tail same-name dup
        { id: "pcv3", partner_id: pid, contact_user_id: "u3", email: "other@acme.com", name: "Jane Doe", created_at: "2026-01-03T00:00:00.000Z" },
      ];
      const ins = db.prepare(
        `INSERT INTO partner_crm_contacts (id,tenant_id,partner_id,contact_user_id,email,name,created_at,updated_at,prev_hash,curr_hash)
         VALUES (@id,'t',@partner_id,@contact_user_id,@email,@name,@created_at,@created_at,@prev_hash,@curr_hash)`,
      );
      let prev: string | null = null;
      for (const r of rows) { const p = prev === null ? "GENESIS" : prev; const c = h(payload(r, p)); ins.run({ ...r, prev_hash: prev, curr_hash: c }); prev = c; }

      const before = db.prepare("SELECT id,prev_hash,curr_hash FROM partner_crm_contacts WHERE partner_id=? ORDER BY created_at").all(pid) as any[];

      runLikeRunner(db, M97);
      runLikeRunner(db, M98);

      const after = db.prepare("SELECT id,email,prev_hash,curr_hash,deleted_at,dedup_exempt FROM partner_crm_contacts WHERE partner_id=? ORDER BY created_at").all(pid) as any[];

      // 1) NO soft-deletes
      expect(after.filter((r) => r.deleted_at).length).toBe(0);
      // 2) chain byte-identical
      for (let i = 0; i < before.length; i++) {
        expect(after[i].prev_hash).toBe(before[i].prev_hash);
        expect(after[i].curr_hash).toBe(before[i].curr_hash);
      }
      // 3) live-chain verifier walk still valid (prev === prior curr)
      const live = after.filter((r) => !r.deleted_at);
      let priorCurr: string | null = null;
      for (let i = 0; i < live.length; i++) {
        if (i === 0) expect(live[i].prev_hash === null || live[i].prev_hash === "GENESIS").toBe(true);
        else expect(live[i].prev_hash).toBe(priorCurr);
        priorCurr = live[i].curr_hash;
      }
      // 4) dup rows exempt; non-dup not exempt
      expect(after.filter((r) => (r.email || "").toLowerCase() === "dup@acme.com").every((r) => r.dedup_exempt === 1)).toBe(true);
      expect(after.filter((r) => (r.email || "").toLowerCase() === "other@acme.com").every((r) => !r.dedup_exempt)).toBe(true);
      // 5) indexes created (assertion did not false-fail — partner dup is exempt)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uq_%_crm_email_scope'").all().length).toBe(3);
      // 6) dup group logged for chain-aware manual resolution
      expect((db.prepare("SELECT COUNT(*) c FROM crm_dedup_review WHERE crm_scope='partner' AND scope_id=? AND email_norm='dup@acme.com'").get(pid) as any).c).toBe(1);
      // 7) idempotent re-run
      runLikeRunner(db, M97); runLikeRunner(db, M98);
      expect((db.prepare("SELECT COUNT(*) c FROM partner_crm_contacts WHERE partner_id=? AND deleted_at IS NULL").get(pid) as any).c).toBe(3);
    } finally {
      db.close();
      for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmp + suffix); } catch { /* noop */ } }
    }
  });
});
