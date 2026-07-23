/**
 * W-FIX3 Bug#4 — reversible/guarded/idempotent company_id backfill migration.
 *
 * Covers:
 *  (1) a null-companyId invitation whose round HAS a companyId is backfilled;
 *  (2) a null-companyId invitation whose round is MISSING is SKIPPED (never guessed);
 *  (3) an already-non-null invitation is NEVER touched;
 *  (4) the down-migration restores NULL for exactly the rows the up-run changed;
 *  (5) idempotency — a second up-run backfills nothing new;
 *  (6) the three artifacts are emitted into the artifact dir.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb, rawDb } from "../db/connection";
import { createRound } from "../roundsStore";
import {
  backfillWfix3CompanyId,
  revertWfix3CompanyIdBackfill,
} from "../lib/wfix3CompanyIdBackfill";

const STAMP = Date.now();
let artifactDir: string;

function seedInvitation(id: string, roundId: string, companyId: string | null) {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO round_invitations
         (id, round_id, investor_email, investor_name, state, expires_at, sent_at,
          tenant_id, company_id, token_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      roundId,
      `mig+${id}@example.com`,
      "Mig Investor",
      "sent",
      new Date(Date.now() + 14 * 86400000).toISOString(),
      now,
      `tenant_${STAMP}`,
      companyId,
      `hash_${id}`,
      now,
      now,
    );
}

function companyIdOf(id: string): string | null {
  const r = rawDb()
    .prepare(`SELECT company_id AS c FROM round_invitations WHERE id = ?`)
    .get(id) as { c: string | null } | undefined;
  return r ? r.c : null;
}

beforeAll(() => {
  getDb();
  artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfix3-companyid-"));
});
afterAll(() => {
  try { fs.rmSync(artifactDir, { recursive: true, force: true }); } catch { /* noop */ }
});

describe("W-FIX3 company_id backfill — reversible / guarded / idempotent", () => {
  it("backfills a null-companyId invitation from its round; skips round-less rows; ignores non-null rows", () => {
    const companyId = `co_mig_${STAMP}`;
    const round = createRound({
      companyId,
      name: `Mig Round ${STAMP}`,
      type: "seed",
      instrument: "priced_equity",
      pricePerShare: 1,
      targetAmount: 1_000_000,
    } as any);

    const nullRowId = `rinv_mig_null_${STAMP}`;
    const orphanRowId = `rinv_mig_orphan_${STAMP}`;
    const nonNullRowId = `rinv_mig_nonnull_${STAMP}`;
    const existingCompanyId = `co_existing_${STAMP}`;

    seedInvitation(nullRowId, round.id, null);
    seedInvitation(orphanRowId, `rnd_missing_${STAMP}`, null);
    seedInvitation(nonNullRowId, round.id, existingCompanyId);

    const res = backfillWfix3CompanyId({ artifactDir });

    // (1) null row with a resolvable round → backfilled
    expect(res.changedInvitationIds).toContain(nullRowId);
    expect(companyIdOf(nullRowId)).toBe(companyId);

    // (2) round-less null row → skipped, still null
    expect(res.changedInvitationIds).not.toContain(orphanRowId);
    expect(companyIdOf(orphanRowId)).toBeNull();

    // (3) non-null row → untouched (never overwritten)
    expect(res.changedInvitationIds).not.toContain(nonNullRowId);
    expect(companyIdOf(nonNullRowId)).toBe(existingCompanyId);
  });

  it("down-migration restores NULL for exactly the rows the up-run changed", () => {
    const companyId = `co_mig_down_${STAMP}`;
    const round = createRound({
      companyId,
      name: `Mig Down Round ${STAMP}`,
      type: "seed",
      instrument: "priced_equity",
      pricePerShare: 1,
      targetAmount: 1_000_000,
    } as any);
    const rowId = `rinv_mig_down_${STAMP}`;
    seedInvitation(rowId, round.id, null);

    const up = backfillWfix3CompanyId();
    expect(up.changedInvitationIds).toContain(rowId);
    expect(companyIdOf(rowId)).toBe(companyId);

    const reverted = revertWfix3CompanyIdBackfill(up);
    expect(reverted).toBeGreaterThanOrEqual(1);
    expect(companyIdOf(rowId)).toBeNull();
  });

  it("is idempotent — a second up-run backfills nothing new", () => {
    const companyId = `co_mig_idem_${STAMP}`;
    const round = createRound({
      companyId,
      name: `Mig Idem Round ${STAMP}`,
      type: "seed",
      instrument: "priced_equity",
      pricePerShare: 1,
      targetAmount: 1_000_000,
    } as any);
    const rowId = `rinv_mig_idem_${STAMP}`;
    seedInvitation(rowId, round.id, null);

    const first = backfillWfix3CompanyId();
    expect(first.changedInvitationIds).toContain(rowId);

    const second = backfillWfix3CompanyId();
    expect(second.changedInvitationIds).not.toContain(rowId);
    expect(companyIdOf(rowId)).toBe(companyId);
  });

  it("emits the three artifacts", () => {
    backfillWfix3CompanyId({ artifactDir });
    expect(fs.existsSync(path.join(artifactDir, "wfix3_companyid_backfill_up.json"))).toBe(true);
    expect(fs.existsSync(path.join(artifactDir, "wfix3_companyid_backfill_down.json"))).toBe(true);
    const md = fs.readFileSync(path.join(artifactDir, "wfix3_companyid_corrected.md"), "utf8");
    expect(md).toContain("W-FIX3");
  });
});
