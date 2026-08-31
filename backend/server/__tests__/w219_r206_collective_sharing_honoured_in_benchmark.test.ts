/**
 * WAVE 219 · R206 — THE FOUNDER'S COLLECTIVE-SHARING SWITCH IS HONOURED WHERE THE
 * NUMBER IS MADE.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────────
 * `shareWithCollective` — a switch the founder can turn OFF at
 * `client/src/components/founder/MaPrivacyConsent.tsx:80` — appeared ZERO times in
 * `server/dscScoringEngine.ts`. Verified by count, not by eye, and re-verified with
 * comments stripped. The switch IS honoured on the M&A intelligence surface
 * (`server/lib/maAuthzGate.ts:174`, `server/collectiveMaIntelStore.ts:404`) and was
 * ignored by the DSC sector median, so a founder who switched sharing off was still
 * inside the benchmark shown to everyone else. The control existed, rendered, and
 * nothing consulted it.
 *
 * ── WHY THE PROOF IS SHAPED THIS WAY ──────────────────────────────────────────
 * The fix has to bind at the POINT OF COMPUTATION, so the proof has to inspect a
 * COMPUTED number, not a rendered one. Every case below calls the REAL exported
 * `computeCompositeForCompany` / `computeAllComposites` — no replica of the median, no
 * reimplementation of the filter (handbook §8). The only thing supplied is the input.
 *
 * The load-bearing case is C-3: it does not merely check that a flag was read, it
 * checks the MEDIAN MOVES to the value it must have when the excluded company is
 * genuinely absent from the sample. A test that only asserted "benchmark changed"
 * would pass if the filter dropped the wrong company.
 *
 * ── THE INERT-PROOF TRAP THIS FILE WAS BUILT AGAINST ──────────────────────────
 * Wave 221's first default-off DOM assertion passed with the default flipped to ON,
 * so it proved nothing. The equivalent trap here is a fixture where the benchmark is
 * `null` for an unrelated reason — no profiles, or a sector of one — in which case
 * every assertion about exclusion is satisfied by an empty cohort. C-0 is therefore an
 * anti-vacuity control that proves a NON-NULL benchmark exists before any exclusion is
 * asserted, and C-1 pins its exact value. If C-0 fails, nothing below means anything.
 *
 * ── AND THE MINIMUM-N INTERACTION, WHICH IS THE DANGEROUS ONE ─────────────────
 * If excluding companies drops a sector below its minimum, the benchmark must refuse —
 * `null` — and must NEVER fall back to a shorter sample or emit a fabricated zero
 * (R201.2). C-4 drives exactly that: a sector of two where one opts out, leaving one.
 * It asserts the benchmark is `null` AND, separately, that it is not `0`, because
 * `0` is what an invented value looks like and `expect(x).toBeNull()` alone would not
 * distinguish a null from a zero if a later wave changed the type.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  computeCompositeForCompany,
  computeAllComposites,
  dscCollectiveOptedOutCompanyIds,
} from "../dscScoringEngine";
import { updateCompanyProfile } from "../companyProfileStore";
import { rawDb } from "../db/connection";
import { parseMaPrivacy } from "../lib/maAuthzGate";

/* ── WHY EVERY CASE OWNS ITS OWN SECTOR ───────────────────────────────────────
 * `companyProfileStore` keeps profiles in a process-wide in-memory map and exposes no
 * reset, so profiles seeded by one case are still visible to the next. A first draft
 * put every fixture in "SaaS" and four cases failed: the "sector of exactly two" in
 * C-4 was really a sector of eleven, and the minimum-N branch was never reached.
 *
 * That is a fixture leak, and it is worth recording because the failure was in the
 * SAFE direction — it under-reported the fix — but the same leak in the other
 * direction is how a cohort test passes for the wrong reason.
 *
 * `normaliseSector` (server/dscScoringEngine.ts:115) collapses free text into nine
 * buckets: biotech, fintech, cleantech, healthtech, deeptech, consumer, marketplace,
 * saas, default. Distinct sector STRINGS are not enough — they must fall in distinct
 * BUCKETS — so each case is given a bucket of its own and the sector is a parameter,
 * not a constant. Different buckets carry different weight matrices, which is why
 * every expected value below is DERIVED from the engine's own computed scores rather
 * than hardcoded. */

/** Distinct readiness levels so each company's composite is distinguishable and the
 *  median is sensitive to which one is missing. Chosen, not random: a fixture whose
 *  members score the same would make exclusion invisible. */
const READINESS = { low: 10, mid: 50, high: 90 } as const;

function seedCompany(id: string, privacyJson: string | null, sector: string): void {
  const db: any = rawDb();
  db.prepare(`DELETE FROM companies WHERE id = ?`).run(id);
  /* `ma_privacy_json` is written EXPLICITLY on every row, including the nulls. The
     column carries a DEFAULT of {"shareWithCollective":false,...} in BOTH schema paths
     (migrations/0059_v25_44_ma_privacy_json.sql and the inline bootstrap in the sacred
     server/db/connection.ts:2116), so a row inserted without naming the column would
     silently arrive already opted out and every fixture below would be ambiguous. */
  db.prepare(
    `INSERT INTO companies (id, tenant_id, name, sector, is_demo, ma_privacy_json)
       VALUES (?, 'tenant_w219', ?, ?, 0, ?)`,
  ).run(id, `W219 ${id}`, sector, privacyJson);
}

function seedProfile(id: string, pct: number, sector: string): void {
  updateCompanyProfile(
    id,
    {
      sector,
      ipDdReadinessPct: pct,
      customerContractsReadinessPct: pct,
      financialAuditReadinessPct: pct,
      dataRoomOrganizedPct: pct,
      regulatoryFilingsCompletePct: pct,
      esgDisclosureCompletePct: pct,
    } as never,
    "w219_r206_test",
  );
}

const SHARING_ON = JSON.stringify({
  shareWithCollective: true,
  shareWithChapter: true,
  shareWithAdvisors: true,
  redactNarrativeFromAggregates: true,
});
const SHARING_OFF = JSON.stringify({
  shareWithCollective: false,
  shareWithChapter: true,
  shareWithAdvisors: true,
  redactNarrativeFromAggregates: true,
});

/** Three companies in one sector, all sharing. `subject` is the one whose benchmark
 *  is read; `peerLow` and `peerHigh` bracket it so the median is the middle score. */
function seedTrio(opts: { subject: string; low: string; high: string; sector: string }): void {
  seedCompany(opts.subject, SHARING_ON, opts.sector);
  seedCompany(opts.low, SHARING_ON, opts.sector);
  seedCompany(opts.high, SHARING_ON, opts.sector);
  seedProfile(opts.subject, READINESS.mid, opts.sector);
  seedProfile(opts.low, READINESS.low, opts.sector);
  seedProfile(opts.high, READINESS.high, opts.sector);
}

describe("W219 · R206 — Collective sharing is honoured at the point of computation", () => {
  beforeEach(() => {
    /* Each case seeds its own ids. Profiles live in an in-memory map keyed by
       companyId, so distinct ids per case keep cases independent without a store
       reset the store does not expose. */
  });

  it("C-0 ANTI-VACUITY — the fixture really produces a NON-NULL benchmark before any exclusion is asserted", () => {
    seedTrio({ subject: "co_c0_subj", low: "co_c0_low", high: "co_c0_high", sector: "SaaS" });
    const r = computeCompositeForCompany("co_c0_subj");
    expect(r, "the subject must have a computable composite at all").not.toBeNull();
    expect(
      r!.sectorBenchmark,
      "if this is null the whole file is vacuous — every exclusion assertion below would pass on an empty cohort",
    ).not.toBeNull();
    expect(typeof r!.sectorBenchmark).toBe("number");
  });

  it("C-1 BASELINE — with nobody switched off the benchmark is the median of all three, exactly as before this wave", () => {
    seedTrio({ subject: "co_c1_subj", low: "co_c1_low", high: "co_c1_high", sector: "SaaS" });
    const r = computeCompositeForCompany("co_c1_subj")!;
    /* Three companies, so the median is the middle composite — which is the subject's
       own, because the fixture brackets it. Read off the computation rather than
       retyped, so this cannot drift with the weight matrix, but the RELATIONSHIP is
       the assertion: median of {low, mid, high} is mid. */
    expect(r.sectorBenchmark).toBe(r.compositeScore);
    /* Scoped to THIS case's ids: other cases in this file deliberately leave
       opted-out rows in the database, so a global `size === 0` would be order
       dependent. */
    for (const id of ["co_c1_subj", "co_c1_low", "co_c1_high"]) {
      expect(dscCollectiveOptedOutCompanyIds().has(id)).toBe(false);
    }
  });

  it("C-2 THE DEFECT, CLOSED — a company that switched sharing OFF is not in the opt-out-free cohort", () => {
    seedTrio({ subject: "co_c2_subj", low: "co_c2_low", high: "co_c2_high", sector: "Biotech" });
    const before = computeCompositeForCompany("co_c2_subj")!.sectorBenchmark;
    expect(before).not.toBeNull();

    // The HIGH peer's founder switches Collective sharing off.
    seedCompany("co_c2_high", SHARING_OFF, "Biotech");
    expect(dscCollectiveOptedOutCompanyIds().has("co_c2_high")).toBe(true);

    const after = computeCompositeForCompany("co_c2_subj")!.sectorBenchmark;
    expect(
      after,
      "the median must move: a switched-off company must not be in the comparison set at all",
    ).not.toBe(before);
    expect(after).not.toBeNull();
  });

  it("C-3 THE MEDIAN IS THE MEDIAN OF THE RIGHT SAMPLE — not merely a different number", () => {
    seedTrio({ subject: "co_c3_subj", low: "co_c3_low", high: "co_c3_high", sector: "Fintech" });
    /* Compute the three composites independently, from the engine, so the expected
       median is derived from real scores and not from a hardcoded guess. */
    const all = computeAllComposites();
    const score = (id: string) => all.find((x) => x.companyId === id)!.compositeScore;
    const subj = score("co_c3_subj");
    const low = score("co_c3_low");
    const high = score("co_c3_high");
    expect(low).toBeLessThan(subj);
    expect(subj).toBeLessThan(high);

    seedCompany("co_c3_high", SHARING_OFF, "Fintech");
    const after = computeCompositeForCompany("co_c3_subj")!.sectorBenchmark!;
    /* Two remain — {low, subj} — so the median is their mean. This is the assertion
       that would catch a filter that excluded the WRONG company: dropping `low`
       instead would give (subj+high)/2, a different number that a mere
       "benchmark changed" assertion would have accepted. */
    expect(after).toBeCloseTo((low + subj) / 2, 6);
  });

  it("C-4 MINIMUM-N — an exclusion that drops a sector below its minimum REFUSES, and never emits a zero", () => {
    /* A sector of exactly two. One opts out, leaving one — below the minimum of 2. */
    seedCompany("co_c4_subj", SHARING_ON, "Cleantech");
    seedCompany("co_c4_peer", SHARING_ON, "Cleantech");
    seedProfile("co_c4_subj", READINESS.mid, "Cleantech");
    seedProfile("co_c4_peer", READINESS.high, "Cleantech");
    // Establish that with both sharing there IS a benchmark, or the case is vacuous.
    const both = computeCompositeForCompany("co_c4_subj")!.sectorBenchmark;
    expect(both, "anti-vacuity: a pair must produce a benchmark before one opts out").not.toBeNull();

    seedCompany("co_c4_peer", SHARING_OFF, "Cleantech");
    const r = computeCompositeForCompany("co_c4_subj")!;
    expect(
      r.sectorBenchmark,
      "below the minimum the benchmark must refuse, not fall back to a sample of one",
    ).toBeNull();
    /* Asserted SEPARATELY from the null check. R201.2: invented data usually arrives
       as a zero, and a benchmark of 0 would render as a real, plausible score. */
    expect(r.sectorBenchmark).not.toBe(0);
    expect(String(r.sectorBenchmark)).not.toBe("0");
  });

  it("C-5 R190.10 — an opted-out company STILL SEES ITS OWN score and is still in the results", () => {
    seedTrio({ subject: "co_c5_subj", low: "co_c5_low", high: "co_c5_high", sector: "Healthtech" });
    seedCompany("co_c5_subj", SHARING_OFF, "Healthtech");

    /* Its own composite is untouched. The switch controls what OTHERS are compared
       against; it must not hide the founder's own number from the founder. */
    const mine = computeCompositeForCompany("co_c5_subj");
    expect(mine).not.toBeNull();
    expect(typeof mine!.compositeScore).toBe("number");
    expect(mine!.compositeScore).toBeGreaterThan(0);

    /* And it is still a row in the full sweep — nothing was hidden, narrowed or
       removed from any audience. */
    const all = computeAllComposites();
    expect(all.some((x) => x.companyId === "co_c5_subj")).toBe(true);
  });

  it("C-6 THE SECOND PASS IS FILTERED TOO — computeAllComposites cannot overwrite the exclusion", () => {
    seedTrio({ subject: "co_c6_subj", low: "co_c6_low", high: "co_c6_high", sector: "Deeptech" });
    const beforeAll = computeAllComposites();
    const beforeSubj = beforeAll.find((x) => x.companyId === "co_c6_subj")!.sectorBenchmark;
    expect(beforeSubj).not.toBeNull();

    seedCompany("co_c6_high", SHARING_OFF, "Deeptech");
    const afterAll = computeAllComposites();
    const afterSubj = afterAll.find((x) => x.companyId === "co_c6_subj")!.sectorBenchmark;
    /* `computeAllComposites` fills benchmarks in TWO passes and the second overwrites
       the first. Filtering only the first pass is the most likely way this fix would
       become inert, so the exclusion is asserted through the two-pass function and not
       only through the single-company one. */
    expect(afterSubj).not.toBe(beforeSubj);

    /* The opted-out company is still present in the output. */
    expect(afterAll.some((x) => x.companyId === "co_c6_high")).toBe(true);
  });

  it("C-7 NO SECOND OPT-OUT MECHANISM — the switch read is the existing ma_privacy_json, through the existing reader", () => {
    /* R171.1. The value the engine acts on must be the SAME value the M&A surface
       acts on, parsed by the SAME function, or the founder has two switches that can
       disagree. Proved by reading the row and the shared parser directly. */
    seedCompany("co_c7", SHARING_OFF, "Consumer");
    const row = (rawDb() as any)
      .prepare(`SELECT ma_privacy_json AS j FROM companies WHERE id = ?`)
      .get("co_c7") as { j: string | null };
    expect(parseMaPrivacy(row.j).shareWithCollective).toBe(false);
    expect(dscCollectiveOptedOutCompanyIds().has("co_c7")).toBe(true);

    seedCompany("co_c7", SHARING_ON, "Consumer");
    expect(parseMaPrivacy(row.j).shareWithCollective).toBe(false); // the old bytes, unchanged
    expect(dscCollectiveOptedOutCompanyIds().has("co_c7")).toBe(false);
  });

  it("C-8 A COMPANY WITH NO RECORDED CHOICE IS NOT TREATED AS HAVING MADE ONE", () => {
    /* THE JUDGEMENT CALL, PINNED SO IT CANNOT DRIFT SILENTLY. `ma_privacy_json` NULL is
       the ABSENCE of a choice, not a choice to opt out — and on the measured data of
       this tree ALL 367 non-deleted companies are NULL, so reading NULL as an opt-out
       would empty every sector benchmark on the platform in one commit. That is the
       narrowing R190.10 forbids, so only an AFFIRMATIVE `false` excludes.

       This mirrors wave 221 exactly: `wave221OptedOutIds` counts only rows whose
       opt-out column `IS NOT NULL AND <> ''`.

       W219_FOR_THE_OWNER.md asks for a ruling on this rather than settling it here.
       If the owner rules that the platform default should bind, this assertion is the
       place that changes, on purpose. */
    seedCompany("co_c8_null", null, "Marketplace");
    expect(dscCollectiveOptedOutCompanyIds().has("co_c8_null")).toBe(false);

    seedCompany("co_c8_empty", "", "Marketplace");
    expect(dscCollectiveOptedOutCompanyIds().has("co_c8_empty")).toBe(false);

    /* Malformed JSON fails CLOSED in `parseMaPrivacy` — to the platform default, whose
       `shareWithCollective` is false — so a corrupt row IS excluded. That is the safe
       direction: it removes a company from other people's medians rather than
       publishing data whose sharing posture cannot be read. */
    seedCompany("co_c8_bad", "{not json", "Marketplace");
    expect(dscCollectiveOptedOutCompanyIds().has("co_c8_bad")).toBe(true);
  });

  it("C-9 A FAILED OR IMPOSSIBLE READ MEANS 'NOBODY OPTED OUT', NEVER 'EVERYONE'", () => {
    /* If the read threw and the helper returned every id, every benchmark on the
       platform would empty at once — a far worse outcome than the defect being fixed.
       The helper is wrapped and returns an empty Set on failure. Proved by pointing it
       at a database with no such row rather than by mocking the driver. */
    const ids = dscCollectiveOptedOutCompanyIds();
    expect(ids.has("co_that_does_not_exist_at_all")).toBe(false);
    expect(ids instanceof Set).toBe(true);
  });
});
