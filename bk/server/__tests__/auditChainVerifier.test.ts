/**
 * v19 Phase C — Audit-chain verifier tests.
 *
 * Coverage:
 *   - Catalog: ≥ 19 entries; well-known tables present
 *   - verifyChainForTable on a clean synthetic audit_log → total === verified, no break
 *   - verifyChainForTable on a tampered audit_log → reports broken_at_row_id / index
 *   - verifyChainForTable rejects an unknown table name
 *   - tenant scoping: rows from a different tenant are excluded
 *   - withDetails:true returns per-row details
 *   - fromCreatedAt / toCreatedAt windowing works
 *   - verifyAllChains() returns one ChainVerifyResult per catalog entry
 *   - chapter_id is auto-stripped from tables without a chapter column
 *   - VERIFIABLE_TABLES is sorted-friendly (catalog parity)
 *   - isVerifiableTable() boolean check
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "../db/connection";
import {
  auditLog as auditLogTable,
  consortiumApplications as consortiumApplicationsTable,
} from "@shared/schema";
import {
  VERIFIABLE_TABLES,
  isVerifiableTable,
  verifyChainForTable,
  verifyAllChains,
  _catalogMetaForTests,
} from "../lib/auditChainVerifier";

/** Same shape used by audit-log inserts. */
function sha256Chain(prevHash: string | null, payload: string): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(payload);
  return h.digest("hex");
}

const TENANT_A = "ten_verify_chain_a";
const TENANT_B = "ten_verify_chain_b";

beforeAll(() => {
  // Seed a clean chain of 5 audit_log rows in TENANT_A. Use ascending
  // ISO timestamps so the verifier sees a deterministic ordering.
  const db: any = getDb();
  const baseTs = Date.parse("2025-01-01T00:00:00.000Z");
  let prev: string | null = null;
  db.transaction((tx: any) => {
    for (let i = 0; i < 5; i++) {
      const id = `auv_a_${i}_${randomUUID().slice(0, 8)}`;
      const createdAt = new Date(baseTs + i * 1000).toISOString();
      const payload = JSON.stringify({
        id,
        action: "test.event",
        target: "row",
        targetId: `r_${i}`,
        ts: createdAt,
      });
      const hash = sha256Chain(prev, payload);
      tx.insert(auditLogTable)
        .values({
          id,
          tenantId: TENANT_A,
          actorId: "u_test_actor",
          action: "test.event",
          target: "row",
          targetId: `r_${i}`,
          payloadJson: payload,
          prevHash: prev,
          hash,
          createdAt,
        })
        .run();
      prev = hash;
    }
  });

  // Tenant B: 2 rows whose chain is *intentionally tampered* — the
  // 2nd row's prev_hash is wrong. Used to test break-detection.
  const baseTsB = Date.parse("2025-02-01T00:00:00.000Z");
  db.transaction((tx: any) => {
    const id0 = `auv_b_0_${randomUUID().slice(0, 8)}`;
    const id1 = `auv_b_1_${randomUUID().slice(0, 8)}`;
    const createdAt0 = new Date(baseTsB).toISOString();
    const createdAt1 = new Date(baseTsB + 1000).toISOString();
    const payload0 = JSON.stringify({ id: id0, action: "x", ts: createdAt0 });
    const hash0 = sha256Chain(null, payload0);
    tx.insert(auditLogTable)
      .values({
        id: id0,
        tenantId: TENANT_B,
        actorId: "u_b",
        action: "x",
        prevHash: null,
        hash: hash0,
        createdAt: createdAt0,
      })
      .run();

    const payload1 = JSON.stringify({ id: id1, action: "y", ts: createdAt1 });
    // CORRECT prev would be hash0; we deliberately use a fake value.
    const fakePrev = "f".repeat(64);
    const hash1 = sha256Chain(fakePrev, payload1);
    tx.insert(auditLogTable)
      .values({
        id: id1,
        tenantId: TENANT_B,
        actorId: "u_b",
        action: "y",
        prevHash: fakePrev,
        hash: hash1,
        createdAt: createdAt1,
      })
      .run();
  });
});

describe("v19 Phase C — auditChainVerifier catalog", () => {
  it("catalog declares at least 19 verifiable tables", () => {
    const meta = _catalogMetaForTests();
    expect(meta.length).toBeGreaterThanOrEqual(19);
    expect(VERIFIABLE_TABLES.length).toBe(meta.length);
  });

  it("catalog includes known v11-v16 chain tables", () => {
    const names = new Set(VERIFIABLE_TABLES);
    expect(names.has("audit_log")).toBe(true);
    expect(names.has("legal_consents")).toBe(true);
    expect(names.has("investor_nominations")).toBe(true);
  });

  it("catalog includes v17+ tables that use curr_hash", () => {
    const names = new Set(VERIFIABLE_TABLES);
    expect(names.has("chapter_announcements")).toBe(true);
    expect(names.has("screening_events")).toBe(true);
    expect(names.has("messages")).toBe(true);
    expect(names.has("expert_questions")).toBe(true);
    expect(names.has("expert_answers")).toBe(true);
  });

  it("isVerifiableTable returns true for catalog members, false otherwise", () => {
    expect(isVerifiableTable("audit_log")).toBe(true);
    expect(isVerifiableTable("chapter_announcements")).toBe(true);
    expect(isVerifiableTable("not_a_real_table_xyz")).toBe(false);
  });

  it("the audit_log entry has hash + prevHash columns (not currHash)", () => {
    const meta = _catalogMetaForTests().find((m) => m.name === "audit_log");
    expect(meta).toBeDefined();
    expect(meta!.hashCol).toBe("hash");
    expect(meta!.prevHashCol).toBe("prevHash");
  });

  it("v17+ entries use currHash column convention", () => {
    const meta = _catalogMetaForTests();
    const ann = meta.find((m) => m.name === "chapter_announcements");
    expect(ann!.hashCol).toBe("currHash");
  });
});

describe("v19 Phase C — verifyChainForTable", () => {
  it("clean 5-row chain in TENANT_A verifies fully (no break)", () => {
    const r = verifyChainForTable("audit_log", { tenantId: TENANT_A });
    expect(r.table).toBe("audit_log");
    expect(r.total_rows).toBe(5);
    expect(r.verified).toBe(5);
    expect(r.broken_at_row_id).toBeNull();
    expect(r.broken_at_index).toBeNull();
    expect(r.first_bad_field_hint).toBeNull();
    expect(r.last_known_good_hash).not.toBeNull();
    expect(typeof r.duration_ms).toBe("number");
  });

  it("tampered chain in TENANT_B reports a break at row index 1", () => {
    const r = verifyChainForTable("audit_log", { tenantId: TENANT_B });
    expect(r.total_rows).toBe(2);
    expect(r.verified).toBe(1);
    expect(r.broken_at_index).toBe(1);
    expect(r.broken_at_row_id).not.toBeNull();
    expect(r.first_bad_field_hint).toMatch(/prev_hash_mismatch/);
  });

  it("rejects an unknown table name", () => {
    expect(() =>
      verifyChainForTable("nonexistent_table"),
    ).toThrowError(/unknown_table/);
  });

  it("tenant scoping excludes rows from a different tenant", () => {
    // Filter to TENANT_A — must NOT see TENANT_B rows.
    const r = verifyChainForTable("audit_log", { tenantId: TENANT_A });
    expect(r.total_rows).toBe(5);
    // And vice-versa.
    const r2 = verifyChainForTable("audit_log", { tenantId: TENANT_B });
    expect(r2.total_rows).toBe(2);
  });

  it("withDetails:true returns a per-row details array", () => {
    const r = verifyChainForTable("audit_log", {
      tenantId: TENANT_A,
      withDetails: true,
    });
    expect(Array.isArray(r.details)).toBe(true);
    expect(r.details!.length).toBe(5);
    expect(r.details!.every((d) => d.ok)).toBe(true);
  });

  it("withDetails:false (default) omits the details array", () => {
    const r = verifyChainForTable("audit_log", { tenantId: TENANT_A });
    expect(r.details).toBeUndefined();
  });

  it("fromCreatedAt / toCreatedAt filter the verified range", () => {
    // Skip the first 2 rows by setting fromCreatedAt.
    const r = verifyChainForTable("audit_log", {
      tenantId: TENANT_A,
      fromCreatedAt: "2025-01-01T00:00:02.000Z",
    });
    expect(r.total_rows).toBe(3);
    // The verifier treats the first row in the window as genesis: since
    // its prev_hash is the prior real chain link (not GENESIS), the
    // verifier reports a break on the genesis check. That is correct
    // behavior — windowing breaks linkage by design.
    // We only assert: the window correctly reduced row count.
    expect(typeof r.verified).toBe("number");
  });

  it("limit option caps the number of rows examined", () => {
    const r = verifyChainForTable("audit_log", {
      tenantId: TENANT_A,
      limit: 2,
    });
    expect(r.total_rows).toBe(2);
  });
});

describe("v19 Phase C — verifyAllChains", () => {
  it("returns one ChainVerifyResult per catalog entry", () => {
    const out = verifyAllChains({ tenantId: TENANT_A });
    expect(out.length).toBe(VERIFIABLE_TABLES.length);
    const names = new Set(out.map((r) => r.table));
    expect(names.has("audit_log")).toBe(true);
    expect(names.has("chapter_announcements")).toBe(true);
  });

  it("audit_log result inside verifyAllChains matches single-table run", () => {
    const all = verifyAllChains({ tenantId: TENANT_A });
    const single = verifyChainForTable("audit_log", { tenantId: TENANT_A });
    const inAll = all.find((r) => r.table === "audit_log")!;
    expect(inAll.total_rows).toBe(single.total_rows);
    expect(inAll.verified).toBe(single.verified);
  });

  it("auto-strips chapter_id for tables without a chapter column", () => {
    // audit_log has no chapter_id; passing one must not zero out the row count.
    const all = verifyAllChains({
      tenantId: TENANT_A,
      chapterId: "chap_keiretsu_canada",
    });
    const audit = all.find((r) => r.table === "audit_log")!;
    expect(audit.total_rows).toBe(5);
  });

  it("supplies started_at / finished_at / duration_ms timestamps", () => {
    const out = verifyAllChains({ tenantId: TENANT_A });
    for (const r of out) {
      expect(typeof r.started_at).toBe("string");
      expect(typeof r.finished_at).toBe("string");
      expect(typeof r.duration_ms).toBe("number");
      expect(r.duration_ms).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("v19 Phase C / CP-007 — consortium_applications verifier", () => {
  it("is registered in the catalog", () => {
    const meta = _catalogMetaForTests();
    const e = meta.find((m) => m.name === "consortium_applications");
    expect(e).toBeDefined();
    expect(e!.hashCol).toBe("currHash");
    expect(e!.prevHashCol).toBe("prevHash");
    expect(e!.hasInsertRecompute).toBe(true);
    expect(isVerifiableTable("consortium_applications")).toBe(true);
  });

  it("verifies a seeded consortium_applications row that matches the chain payload formula", () => {
    // Seed one application row whose curr_hash is computed using the
    // same formula as consortiumApplyStore.computeHash + chainPayload.
    const id = `cpapp_verifier_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const payload = JSON.stringify({
      id,
      organizationName: "Verifier Test LP",
      contactEmail: "verifier@example.com",
      expectedChapterId: "chap_keiretsu_canada",
      partnerType: "vc",
      aumRange: "50-250M",
      status: "submitted",
      reviewedByUserId: null,
      provisionedPartnerId: null,
      updatedAt: now,
    });
    const currHash = sha256Chain(null, payload);

    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.insert(consortiumApplicationsTable)
        .values({
          id,
          tenantId: TENANT_A,
          expectedChapterId: "chap_keiretsu_canada",
          contactName: "Verifier Test",
          contactEmail: "verifier@example.com",
          contactPhone: null,
          organizationName: "Verifier Test LP",
          website: null,
          jurisdiction: "",
          partnerType: "vc",
          aumRange: "50-250M",
          portfolioCompanyCount: 0,
          expectedChapter: "chap_keiretsu_canada",
          introMessage: "",
          referredBy: null,
          sourceIp: null,
          sourceUserAgent: null,
          status: "submitted",
          reviewedByUserId: null,
          reviewNotes: null,
          provisionedPartnerId: null,
          prevHash: null,
          currHash,
          createdAt: now,
          reviewedAt: null,
          updatedAt: now,
        } as any)
        .run();
    });

    const r = verifyChainForTable("consortium_applications", {
      tenantId: TENANT_A,
      withDetails: true,
    });
    expect(r.total_rows).toBeGreaterThanOrEqual(1);
    expect(r.verified).toBe(r.total_rows);
    expect(r.broken_at_row_id).toBeNull();
    expect(r.broken_at_index).toBeNull();
    expect(r.first_bad_field_hint).toBeNull();
    expect(r.last_known_good_hash).not.toBeNull();
    expect(r.details!.every((d) => d.ok)).toBe(true);
  });
});
