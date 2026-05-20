/**
 * Patch v12 Day 2 Wave 2 — termSheetStore persistence test.
 *
 * Verifies the audit §3.14 contract:
 *   - Each saveTermSheet INSERTs to `term_sheet_revisions` atomically
 *   - Per-round chain extends correctly across "simulated restart"
 *   - getRevisions/getLatestRevision read from DB
 *   - Two rounds keep independent chains
 *   - Signed-lock check survives restart
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  saveTermSheet,
  getRevisions,
  getLatestRevision,
  verifyChain,
  clearTermSheetStore,
  hydrateTermSheetStore,
  type SaveTermSheetPayload,
} from "../termSheetStore";
import { getDb } from "../db/connection";
import { termSheetRevisions } from "../../shared/schema";

function makePayload(overrides: Partial<SaveTermSheetPayload> = {}): SaveTermSheetPayload {
  return {
    roundId: overrides.roundId ?? "rnd_v12",
    companyId: overrides.companyId ?? "co_v12",
    source: "generated",
    region: "us-de",
    instrument: "safe",
    templateId: "tpl_yc_safe",
    templateName: "YC SAFE",
    sections: [{ id: "sec_1", heading: "Valuation Cap", body: "$10,000,000", edited: false }],
    citations: [],
    status: "draft",
    ...overrides,
  };
}

describe("v12 termSheetStore — DB persistence (audit §3.14)", () => {
  beforeEach(() => {
    clearTermSheetStore();
  });

  it("each save INSERTs a row with monotonic revision per round", () => {
    saveTermSheet({ payload: makePayload(), savedBy: "u_a" });
    saveTermSheet({ payload: makePayload(), savedBy: "u_a" });
    saveTermSheet({ payload: makePayload(), savedBy: "u_a" });

    const db = getDb();
    const rows = db.select().from(termSheetRevisions).all() as any[];
    expect(rows.length).toBe(3);
    const revs = rows.map((r) => r.revision).sort();
    expect(revs).toEqual([1, 2, 3]);

    // tenant tagging
    for (const r of rows) expect(r.tenantId).toBe("tenant_co_co_v12");

    // chain verifies
    expect(verifyChain("rnd_v12")).toEqual({ ok: true });
  });

  it("two rounds keep independent chains", () => {
    saveTermSheet({ payload: makePayload({ roundId: "rnd_a" }), savedBy: "u_a" });
    saveTermSheet({ payload: makePayload({ roundId: "rnd_a" }), savedBy: "u_a" });
    saveTermSheet({ payload: makePayload({ roundId: "rnd_b" }), savedBy: "u_a" });

    expect(getRevisions("rnd_a").length).toBe(2);
    expect(getRevisions("rnd_b").length).toBe(1);
    expect(getLatestRevision("rnd_a")?.revision).toBe(2);
    expect(getLatestRevision("rnd_b")?.revision).toBe(1);
    // rnd_b chain restarts from GENESIS, not rnd_a's tip.
    expect(getRevisions("rnd_b")[0].prevRevisionHash).toBe("GENESIS");
    expect(verifyChain("rnd_a").ok).toBe(true);
    expect(verifyChain("rnd_b").ok).toBe(true);
  });

  it("signed-lock survives simulated restart (state read from DB)", async () => {
    saveTermSheet({ payload: makePayload({ status: "signed" }), savedBy: "u_a" });

    // simulate restart
    await hydrateTermSheetStore();

    const r = saveTermSheet({ payload: makePayload(), savedBy: "u_a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("termsheet_locked");
  });

  it("hydrator reports row count + read-side reads from DB after restart", async () => {
    saveTermSheet({ payload: makePayload(), savedBy: "u_a" });
    saveTermSheet({ payload: makePayload(), savedBy: "u_a" });

    await hydrateTermSheetStore();

    const revs = getRevisions("rnd_v12");
    expect(revs.length).toBe(2);
    expect(revs[0].revision).toBe(1);
    expect(revs[1].revision).toBe(2);
    expect(revs[1].prevRevisionHash).toBe(revs[0].revisionHash);
  });
});
