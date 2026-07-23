/**
 * W-MFCRM — persona behaviors (store-level, deterministic).
 *
 * The three service/network personas add tables + helpers on the SAME
 * engagement model (design §7 — never fork the engine). Coverage:
 *   - ANGEL: chapter scoping writes engagement.chapterId via the engine's
 *     additive setter; fail-closed when chapter_scoping=false.
 *   - ACCOUNTING: firm-of-record attribution (sources_capital=false ⇒ NEVER
 *     investor first-touch); pays-on-behalf rebill + custody are capability-gated.
 *   - LAW: the conflict engine FLAGS but NEVER blocks; sources_capital=false
 *     disables the investor spine (counsel-of-record only, fail-closed otherwise).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { applyMfcrmSchema } from "../lib/mfcrmSchema";
import { managedFounderStore } from "../managedFounderStore";
import { mfcrmAngelStore } from "../mfcrmAngelStore";
import { mfcrmAcctStore } from "../mfcrmAcctStore";
import { mfcrmLawStore } from "../mfcrmLawStore";

const ACTOR = "u_test_actor";

beforeAll(() => applyMfcrmSchema());

describe("PERSONA — Angel network (chapter scoping)", () => {
  it("POSITIVE: an ACTIVE engagement is scoped to a chapter (engine setter writes chapterId)", () => {
    const pid = "p_angel_ok";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: true, chapterScoping: true }, ACTOR);
    const chapter = mfcrmAngelStore.createChapter(pid, { name: "SF Chapter", region: "US", carryBps: 1500 }, ACTOR);
    expect(chapter.id).toBeTruthy();
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_angel" }, ACTOR);
    const scoped = mfcrmAngelStore.assignEngagementToChapter(pid, e.id, chapter.id, ACTOR);
    expect(scoped.chapterId).toBe(chapter.id);
    // The per-chapter carry rollup sees exactly one scoped engagement.
    const report = mfcrmAngelStore.chapterCarryReport(pid).find((r: any) => r.chapterId === chapter.id);
    expect(report.engagementCount).toBe(1);
    expect(report.carryBps).toBe(1500);
  });

  it("NEGATIVE: chapter_scoping=false is fail-closed (CHAPTER_SCOPING_REQUIRED)", () => {
    const pid = "p_angel_no";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, chapterScoping: false }, ACTOR);
    expect(() => mfcrmAngelStore.createChapter(pid, { name: "Denied Chapter" }, ACTOR))
      .toThrowError(/CHAPTER_SCOPING_REQUIRED/);
  });
});

describe("PERSONA — Accounting firm (firm-of-record + gated rebill/custody)", () => {
  it("POSITIVE: firm-of-record stamps firm_of_record (NEVER investor first-touch)", () => {
    const pid = "p_acct_ok";
    managedFounderStore.setCapabilityProfile(pid, {
      classified: true, sourcesCapital: false, documentCustody: true, paysOnBehalf: true, fundAdmin: true,
    }, ACTOR);
    const out = mfcrmAcctStore.stampFirmOfRecord(pid, { companyId: "co_acct" }, ACTOR);
    expect(out.attributionType).toBe("firm_of_record");

    const rebill = mfcrmAcctStore.recordRebill(pid, { companyId: "co_acct", description: "Filing fees", amountMinor: 50000 }, ACTOR);
    expect(rebill.amount_minor).toBe(50000);
    expect(rebill.status).toBe("pending"); // AR intent, NOT a money commit

    const custody = mfcrmAcctStore.addCustody(pid, { companyId: "co_acct", docRef: "doc://cap-table.pdf" }, ACTOR);
    expect(custody.status).toBe("held");

    const report = mfcrmAcctStore.fundAdminReport(pid);
    expect((report.rebills as any).total).toBe(1);
    expect((report.rebills as any).pendingAmountMinor).toBe(50000);
  });

  it("NEGATIVE: pays_on_behalf=false denies rebill (PAYS_ON_BEHALF_REQUIRED)", () => {
    const pid = "p_acct_norebill";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: false, paysOnBehalf: false }, ACTOR);
    expect(() => mfcrmAcctStore.recordRebill(pid, { companyId: "co_acct2", description: "x", amountMinor: 100 }, ACTOR))
      .toThrowError(/PAYS_ON_BEHALF_REQUIRED/);
  });

  it("NEGATIVE: document_custody=false denies custody (DOCUMENT_CUSTODY_REQUIRED)", () => {
    const pid = "p_acct_nocustody";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: false, documentCustody: false }, ACTOR);
    expect(() => mfcrmAcctStore.addCustody(pid, { companyId: "co_acct3", docRef: "doc://x" }, ACTOR))
      .toThrowError(/DOCUMENT_CUSTODY_REQUIRED/);
  });
});

describe("PERSONA — Law firm (conflict FLAGS never block; investor spine disabled)", () => {
  it("POSITIVE: conflict engine FLAGS but NEVER blocks (records + returns blocked:false)", () => {
    const pid = "p_law_ok";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: false, documentCustody: true }, ACTOR);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_law" }, ACTOR);
    const matter = mfcrmLawStore.createMatter(pid, { companyId: "co_law", engagementId: e.id, title: "Series A financing" }, ACTOR);
    expect(matter.id).toBeTruthy();
    // The matter scoped the engagement (engine additive setter).
    expect(managedFounderStore.getEngagement(pid, e.id)!.matterId).toBe(matter.id);

    const flag = mfcrmLawStore.flagConflict(pid, { companyId: "co_law", matterId: matter.id, conflictCode: "C3_ADVERSE_PARTY", counterparty: "co_rival" }, ACTOR);
    expect(flag.blocked).toBe(false); // NEVER blocks
    const conflicts = mfcrmLawStore.listConflicts(pid, "co_law");
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].status).toBe("open");
  });

  it("counsel-of-record stamps counsel_of_record when investor spine is disabled", () => {
    const pid = "p_law_counsel";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: false }, ACTOR);
    const out = mfcrmLawStore.stampCounselOfRecord(pid, { companyId: "co_law2" }, ACTOR);
    expect(out.attributionType).toBe("counsel_of_record");
  });

  it("NEGATIVE: sources_capital=true is fail-closed for a law persona (INVESTOR_SPINE_FORBIDDEN)", () => {
    const pid = "p_law_misseeded";
    // A mis-seeded law partner that somehow has sources_capital=true must NOT be
    // allowed to touch the investor spine.
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: true }, ACTOR);
    expect(() => mfcrmLawStore.stampCounselOfRecord(pid, { companyId: "co_law3" }, ACTOR))
      .toThrowError(/INVESTOR_SPINE_FORBIDDEN/);
  });
});
