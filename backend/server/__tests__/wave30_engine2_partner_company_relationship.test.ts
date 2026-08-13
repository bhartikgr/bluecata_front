/**
 * WAVE 30 · ENGINE 2 — falsification harness for the `partner_company_relationship`
 * spine, its `pcr_surface_presence` join table, and the §3.3 forward-write helper
 * that migration 0136 specified and never got.
 *
 * ── THE DEFECT THIS ENGINE FIXES, AND HOW IT IS PROVEN ────────────────────
 * 0136 backfilled the spine ONCE. Every surface row created after that migration
 * ran was invisible to it, forever, because no forward-write helper existed.
 * Proving "the spine is now maintained" is not a matter of calling the new store
 * and checking it wrote — that only proves the new store works in isolation.
 *
 * **Case (10) is the one that matters**: it calls `partnerAttributionStore.create`
 * — a PRE-EXISTING store this wave did not author, through its ordinary public
 * API — and then asserts the spine updated. That is the "fix where the data
 * flows" proof: the hook is on the real sink (`writeTypedAttribution`), reached
 * by a real caller, not by the test calling the new helper directly. Case (11)
 * does the same for revoke. Mutant M4 removes the hook and both die.
 *
 * ── THE SECOND PATH ───────────────────────────────────────────────────────
 * Rule 2 says name the sink, prove it by execution, then hunt a SECOND path.
 * Attribution has exactly one DB sink (`writeTypedAttribution`, called by both
 * `create` and `revoke` — grep-verified), which is why one hook covers both
 * transitions. But the other THREE surfaces (`mf_engagement`,
 * `partner_deal_pipeline`, `partner_portfolio_company`) have their own writers
 * that this wave did NOT hook. That is a deliberate, declared limit, not an
 * oversight, and `reconcilePartner` is the covering mechanism — case (13) proves
 * reconcile picks up a pipeline row written with no hook at all. Case (14) is
 * the HONEST NEGATIVE: it asserts that an unhooked surface write does NOT
 * self-maintain the spine, so the gap is pinned by a passing test rather than
 * described in a comment that could quietly become false.
 *
 * ── PRECONDITIONS ARE ESTABLISHED, NEVER ASSUMED ──────────────────────────
 * Every fixture is seeded here and the seed is asserted. `foreign_keys` is ON and
 * the spine references `partner_organizations(id)` and `companies(id)`, so those
 * parents are seeded too — otherwise the FK, not the engine, would be under test.
 * No env var is touched, so there is nothing to restore.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { rawDb } from "../db/connection";
import {
  ensurePcr,
  pcrIdFor,
  recordSurfacePresence,
  recordSurfaceRemoval,
  listRelationshipsForPartner,
  getRelationship,
  getRelationshipByCompany,
  surfaceBreakdown,
  reconcilePartner,
  PcrNotFoundError,
  PcrValidationError,
  PCR_SURFACES,
} from "../partnerCompanyRelationshipStore";
import { partnerAttributionStore } from "../partnerWorkspaceStore";

const P_A = "w30e2_partner_a";
const P_B = "w30e2_partner_b";
const U_A = "w30e2_user_a";
const CO_1 = "w30e2_company_1";
const CO_2 = "w30e2_company_2";
const CO_3 = "w30e2_company_3"; // used only by the forward-write cases
const CO_PIPE = "w30e2_company_pipeline"; // used only by the reconcile cases
const CO_B_ONLY = "w30e2_company_b_only"; // ONLY ever in partner B's pipeline
const CO_ORPHAN = "w30e2_company_that_does_not_exist";
const ABSENT_PCR = "pcr_w30e2_nobody|w30e2_nothing";

function count(sql: string, ...args: unknown[]): number {
  return Number((rawDb().prepare(sql).get(...args) as { n: number }).n);
}

beforeAll(() => {
  const db: any = rawDb();
  /* Parents first — `foreign_keys` is ON (connection.ts:125). Without these the
     spine INSERT would fail on the FK and every case would be testing SQLite. */
  /* No try/catch around the seed. A swallowed seed failure is the exact
     false-green shape this build has been burned by: the fixture would be empty
     and every later case would pass vacuously. If the column set ever changes,
     this must fail loudly. */
  const now = "2026-08-11T00:00:00.000Z";
  const insPartner = db.prepare(
    `INSERT OR IGNORE INTO partner_organizations (id, tenant_id, name, status, created_at, updated_at)
     VALUES (?, 'tenant_platform', ?, 'active', ?, ?)`,
  );
  insPartner.run(P_A, "W30E2 Partner A", now, now);
  insPartner.run(P_B, "W30E2 Partner B", now, now);

  const insCompany = db.prepare(
    `INSERT OR IGNORE INTO companies (id, tenant_id, name) VALUES (?, 'tenant_platform', ?)`,
  );
  for (const [id, name] of [
    [CO_1, "W30E2 Co One"],
    [CO_2, "W30E2 Co Two"],
    [CO_3, "W30E2 Co Three"],
    [CO_PIPE, "W30E2 Co Pipeline"],
    [CO_B_ONLY, "W30E2 Co B-Only"],
  ]) {
    insCompany.run(id, name);
  }

  db.prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, 'tenant_platform', 'a@w30e2.test', 'W30E2 Operator', 'partner', 0)`,
  ).run(U_A);

  /* ASSERT the seed. A silently-empty fixture makes every later case vacuous. */
  expect(count(`SELECT COUNT(*) n FROM partner_organizations WHERE id IN (?, ?)`, P_A, P_B)).toBe(2);
  expect(
    count(
      `SELECT COUNT(*) n FROM companies WHERE id IN (?, ?, ?, ?, ?)`,
      CO_1, CO_2, CO_3, CO_PIPE, CO_B_ONLY,
    ),
  ).toBe(5);
  /* And assert the company we intend to be an ORPHAN really is absent — the
     orphan cases below are meaningless if it happens to exist. */
  expect(count(`SELECT COUNT(*) n FROM companies WHERE id = ?`, CO_ORPHAN)).toBe(0);
});

describe("WAVE 30 ENGINE 2 — CONTROL: schema present, and the id derivation matches migration 0136", () => {
  it("(0) both tables and the CHECK constraint exist at RUNTIME", () => {
    const db = rawDb();
    const spine = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='partner_company_relationship'`)
      .get() as { sql?: string } | undefined;
    expect(spine?.sql).toBeTruthy();
    expect(String(spine!.sql).replace(/\s+/g, " ")).toMatch(/UNIQUE \(partner_id, company_id\)/i);

    const presence = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='pcr_surface_presence'`)
      .get() as { sql?: string } | undefined;
    expect(presence?.sql).toBeTruthy();
    const norm = String(presence!.sql).replace(/\s+/g, " ");
    // The four surfaces the store hard-codes must be EXACTLY the four the DDL
    // allows. If a later migration widened the CHECK, the store would start
    // silently rejecting a surface the DB accepts — this catches that drift.
    for (const s of PCR_SURFACES) expect(norm).toContain(`'${s}'`);
    expect(norm).toMatch(/UNIQUE \(pcr_id, surface, row_id\)/i);
  });

  it("(1) the spine id derivation is byte-identical to migration 0136's template", () => {
    // 0136 seeds `'pcr_' || partner_id || '|' || company_id`. If the store used a
    // different template it would mint a SECOND row for an already-backfilled
    // relationship, and UNIQUE(partner_id, company_id) would then reject it —
    // turning every post-0136 attribution write into a hard failure.
    expect(pcrIdFor(P_A, CO_1)).toBe(`pcr_${P_A}|${CO_1}`);
  });

  it("(2) the '|' separator is enforced, not merely assumed — injectivity has a guard", () => {
    // ('p_1','2') and ('p','1_2') both collapse to 'pcr_p_1_2' under an
    // underscore separator. 0136 fixed that by switching to '|', on the
    // assumption that no id contains a pipe. The store CHECKS that assumption.
    expect(() => ensurePcr("bad|partner", CO_1)).toThrow(PcrValidationError);
    expect(() => ensurePcr(P_A, "bad|company")).toThrow(PcrValidationError);
    // and the two historically-colliding pairs stay distinct
    expect(pcrIdFor("p_1", "2")).not.toBe(pcrIdFor("p", "1_2"));
  });
});

describe("WAVE 30 ENGINE 2 — ensurePcr and presence, both poles", () => {
  it("(3) THE POSITIVE POLE — a spine row is created, and it is really in the table", () => {
    const id = ensurePcr(P_A, CO_1);
    expect(id).toBe(pcrIdFor(P_A, CO_1));
    expect(count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE id = ?`, id!)).toBe(1);
  });

  it("(4) idempotent — a second ensurePcr returns the same id and creates no duplicate", () => {
    const id = ensurePcr(P_A, CO_1);
    expect(id).toBe(pcrIdFor(P_A, CO_1));
    expect(
      count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ? AND company_id = ?`, P_A, CO_1),
    ).toBe(1);
  });

  it("(5) FAIL-SOFT on an unresolvable parent — returns null, writes a skip-log row, does NOT throw", () => {
    // This is the property that keeps the spine from being able to break a real
    // attribution write. `foreign_keys` is ON, so without the pre-flight this
    // would raise FOREIGN KEY constraint failed and roll back the caller's work.
    const before = count(`SELECT COUNT(*) n FROM c2_backfill_skip_log`);
    let result: string | null = "not-called";
    expect(() => {
      result = ensurePcr(P_A, CO_ORPHAN);
    }).not.toThrow();
    expect(result).toBeNull();
    // The skip was LOGGED, not swallowed — a fail-soft path that leaves no trace
    // is indistinguishable from one that never ran.
    expect(count(`SELECT COUNT(*) n FROM c2_backfill_skip_log`)).toBe(before + 1);
    expect(
      count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE company_id = ?`, CO_ORPHAN),
    ).toBe(0);
  });

  it("(6) presence is recorded, and an UNKNOWN surface is rejected rather than written", () => {
    const id = recordSurfacePresence(P_A, CO_1, "pipeline", "row_pipe_1");
    expect(id).toBeTruthy();
    expect(
      count(`SELECT COUNT(*) n FROM pcr_surface_presence WHERE pcr_id = ? AND surface = 'pipeline'`, pcrIdFor(P_A, CO_1)),
    ).toBe(1);
    // The DDL's CHECK would also reject this, but the store must refuse BEFORE
    // reaching the DB so the caller gets a typed error, not a SQLite message.
    expect(() =>
      recordSurfacePresence(P_A, CO_1, "not_a_surface" as never, "row_x"),
    ).toThrow(PcrValidationError);
  });

  it("(7) APPEND-ONLY — removal sets removed_at and DELETES NOTHING", () => {
    const pcrId = pcrIdFor(P_A, CO_1);
    const rowsBefore = count(`SELECT COUNT(*) n FROM pcr_surface_presence WHERE pcr_id = ?`, pcrId);
    expect(recordSurfaceRemoval(P_A, CO_1, "pipeline", "row_pipe_1")).toBe(true);
    // Same number of rows — this is the append-only guarantee, and a DELETE-based
    // implementation would fail exactly here.
    expect(count(`SELECT COUNT(*) n FROM pcr_surface_presence WHERE pcr_id = ?`, pcrId)).toBe(rowsBefore);
    expect(
      count(`SELECT COUNT(*) n FROM pcr_surface_presence WHERE pcr_id = ? AND removed_at IS NOT NULL`, pcrId),
    ).toBe(1);
    // The other pole: removing again reports false, so callers can distinguish
    // "ended it" from "there was nothing live to end".
    expect(recordSurfaceRemoval(P_A, CO_1, "pipeline", "row_pipe_1")).toBe(false);
  });

  it("(8) re-adding a removed presence REVIVES the row rather than duplicating it", () => {
    const pcrId = pcrIdFor(P_A, CO_1);
    const before = count(`SELECT COUNT(*) n FROM pcr_surface_presence WHERE pcr_id = ?`, pcrId);
    recordSurfacePresence(P_A, CO_1, "pipeline", "row_pipe_1");
    expect(count(`SELECT COUNT(*) n FROM pcr_surface_presence WHERE pcr_id = ?`, pcrId)).toBe(before);
    expect(
      count(`SELECT COUNT(*) n FROM pcr_surface_presence WHERE pcr_id = ? AND surface='pipeline' AND removed_at IS NULL`, pcrId),
    ).toBe(1);
    // and the read model now reports it active rather than past
    const rel = getRelationshipByCompany(P_A, CO_1);
    expect(rel.activeSurfaces).toContain("pipeline");
    expect(rel.pastSurfaces).not.toContain("pipeline");
  });
});

describe("WAVE 30 ENGINE 2 — the forward-write hook, reached through a PRE-EXISTING caller", () => {
  it("(9) CONTROL — CO_3 has no spine row before the attribution is created", () => {
    // Without this the next case could pass against a row seeded earlier.
    expect(
      count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ? AND company_id = ?`, P_A, CO_3),
    ).toBe(0);
  });

  it("(10) THE REAL PROOF — calling partnerAttributionStore.create maintains the spine", () => {
    // This wave did not author partnerAttributionStore. The test calls its
    // ordinary public API and asserts a side effect in a table that store has
    // never heard of. That is the sink being proven BY EXECUTION.
    const attr = partnerAttributionStore.create(P_A, CO_3, U_A, "admin_manual", null);
    expect(attr.id).toBeTruthy();
    expect(
      count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ? AND company_id = ?`, P_A, CO_3),
    ).toBe(1);
    const rel = getRelationshipByCompany(P_A, CO_3);
    expect(rel.activeSurfaces).toContain("clients");
    // presence points at the attribution row itself, not at the company
    expect(rel.presence.some((p) => p.surface === "clients" && p.rowId === attr.id)).toBe(true);
  });

  it("(11) and REVOKE ends the presence — the other transition through the same sink", () => {
    partnerAttributionStore.revoke(P_A, CO_3, U_A);
    const rel = getRelationshipByCompany(P_A, CO_3);
    expect(rel.activeSurfaces).not.toContain("clients");
    // Append-only: it moved to `past`, it did not vanish. A relationship's history
    // is the point of the spine, so a revoke that erased it would be a silent drop.
    expect(rel.pastSurfaces).toContain("clients");
    expect(rel.presence.length).toBeGreaterThan(0);
    // and the spine row itself survives the revoke
    expect(
      count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ? AND company_id = ?`, P_A, CO_3),
    ).toBe(1);
  });
});

describe("WAVE 30 ENGINE 2 — reconcile, and the honest limit of the hook", () => {
  beforeAll(() => {
    /* A pipeline row written the ordinary way — through no hook at all, since
       this wave hooked only the attribution sink. */
    rawDb()
      .prepare(
        `INSERT OR IGNORE INTO partner_deal_pipeline
           (id, tenant_id, partner_id, company_id, stage, curr_hash, created_at, updated_at)
         VALUES ('w30e2_pipe_row', 'tenant_platform', ?, ?, 'sourced', '', ?, ?)`,
      )
      .run(P_A, CO_PIPE, "2026-08-11T00:00:00.000Z", "2026-08-11T00:00:00.000Z");

    /* And a pipeline row belonging to partner B ONLY. Case (16b) needs a row
       that A's reconcile could wrongly sweep up; without it, a reconcile query
       missing its `partner_id = ?` predicate would still look correct because
       every pipeline row in the fixture happened to be A's. */
    rawDb()
      .prepare(
        `INSERT OR IGNORE INTO partner_deal_pipeline
           (id, tenant_id, partner_id, company_id, stage, curr_hash, created_at, updated_at)
         VALUES ('w30e2_pipe_row_b', 'tenant_platform', ?, ?, 'sourced', '', ?, ?)`,
      )
      .run(P_B, CO_B_ONLY, "2026-08-11T00:00:00.000Z", "2026-08-11T00:00:00.000Z");
  });

  it("(12) CONTROL — the pipeline row exists, and it is NOT in the spine", () => {
    // Both halves matter. If the row did not exist, case (13) would prove nothing.
    expect(count(`SELECT COUNT(*) n FROM partner_deal_pipeline WHERE id = 'w30e2_pipe_row'`)).toBe(1);
    expect(
      count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ? AND company_id = ?`, P_A, CO_PIPE),
    ).toBe(0);
  });

  it("(13) reconcile picks up the unhooked surface row", () => {
    const result = reconcilePartner(P_A);
    expect(result.scanned).toBeGreaterThan(0);
    expect(
      count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ? AND company_id = ?`, P_A, CO_PIPE),
    ).toBe(1);
    expect(getRelationshipByCompany(P_A, CO_PIPE).activeSurfaces).toContain("pipeline");
  });

  it("(14) THE HONEST NEGATIVE — an unhooked surface write still does not self-maintain the spine", () => {
    /* This wave hooked ONE of the four surfaces (attributions, at
       writeTypedAttribution). The other three are covered by reconcile, not by a
       forward-write. That limit is pinned HERE by a passing assertion rather than
       left in a comment: if a later wave hooks the pipeline writer, this case
       fails and forces the limit to be re-stated honestly. */
    rawDb()
      .prepare(
        `INSERT OR IGNORE INTO partner_deal_pipeline
           (id, tenant_id, partner_id, company_id, stage, curr_hash, created_at, updated_at)
         VALUES ('w30e2_pipe_row_2', 'tenant_platform', ?, ?, 'sourced', '', ?, ?)`,
      )
      .run(P_A, CO_2, "2026-08-11T00:00:00.000Z", "2026-08-11T00:00:00.000Z");
    // No hook ran, so the spine does not know about CO_2's pipeline presence yet.
    const rel = listRelationshipsForPartner(P_A).find((r) => r.companyId === CO_2);
    expect(rel?.activeSurfaces ?? []).not.toContain("pipeline");
    // …and reconcile is the covering mechanism, which is why the gap is tolerable.
    reconcilePartner(P_A);
    expect(getRelationshipByCompany(P_A, CO_2).activeSurfaces).toContain("pipeline");
  });

  it("(15) reconcile is idempotent — a second run adds no relationships and no duplicate presence", () => {
    const relsBefore = count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ?`, P_A);
    const presBefore = count(
      `SELECT COUNT(*) n FROM pcr_surface_presence p JOIN partner_company_relationship r ON r.id = p.pcr_id WHERE r.partner_id = ?`,
      P_A,
    );
    const result = reconcilePartner(P_A);
    expect(result.relationshipsCreated).toBe(0);
    expect(count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ?`, P_A)).toBe(relsBefore);
    expect(
      count(
        `SELECT COUNT(*) n FROM pcr_surface_presence p JOIN partner_company_relationship r ON r.id = p.pcr_id WHERE r.partner_id = ?`,
        P_A,
      ),
    ).toBe(presBefore);
  });

  it("(16) reconcile is scoped to ONE partner — it never touches another firm's spine", () => {
    const bBefore = count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ?`, P_B);
    reconcilePartner(P_A);
    expect(count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ?`, P_B)).toBe(bBefore);
  });

  it("(16b) …and it does not ABSORB another firm's rows into ITS OWN spine", () => {
    /* ADDED AFTER MUTATION TESTING. Mutant M10 (drop `partner_id = ?` from
     * reconcile's pipeline query) SURVIVED case (16), because that case only
     * checks that B's spine is untouched. The unscoped query does not write to
     * B's spine — it writes B's COMPANIES into A's, under A's partner id, which
     * is strictly worse: partner A's relationship map would silently gain
     * companies A has never engaged. Case (16) was blind to it. This is not.
     *
     * CONTROL first: the row is really B's, and A has no relationship with it. */
    expect(
      count(`SELECT COUNT(*) n FROM partner_deal_pipeline WHERE id = 'w30e2_pipe_row_b' AND partner_id = ?`, P_B),
    ).toBe(1);
    reconcilePartner(P_A);
    expect(
      count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ? AND company_id = ?`, P_A, CO_B_ONLY),
    ).toBe(0);
    expect(listRelationshipsForPartner(P_A).some((r) => r.companyId === CO_B_ONLY)).toBe(false);
  });
});

describe("WAVE 30 ENGINE 2 — the tenant boundary on reads, both poles", () => {
  beforeAll(() => {
    // Give B a real relationship so the refusal cases cannot pass merely because
    // B has nothing at all.
    recordSurfacePresence(P_B, CO_2, "portfolio", "w30e2_b_portfolio_row");
  });

  it("(17) THE POSITIVE POLE — each partner sees its own map, and only its own", () => {
    const a = listRelationshipsForPartner(P_A);
    const b = listRelationshipsForPartner(P_B);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.every((r) => r.partnerId === P_A)).toBe(true);
    expect(b.every((r) => r.partnerId === P_B)).toBe(true);
    // Both firms have a relationship with CO_2. They are DIFFERENT spine rows and
    // neither can see the other's — the single sharpest case in this file.
    expect(a.some((r) => r.companyId === CO_2)).toBe(true);
    expect(b.some((r) => r.companyId === CO_2)).toBe(true);
    expect(a.find((r) => r.companyId === CO_2)!.id).not.toBe(b.find((r) => r.companyId === CO_2)!.id);
  });

  it("(18) B cannot read A's relationship by spine id, and the refusal matches an absent id EXACTLY", () => {
    // Spine ids are DERIVED, so a distinguishable refusal would let a caller test
    // `pcr_<partner>|<company>` guesses and map which firms work with which
    // companies. Sameness is the property; "it is a 404" is not enough.
    const aPcr = pcrIdFor(P_A, CO_1);
    expect(count(`SELECT COUNT(*) n FROM partner_company_relationship WHERE id = ?`, aPcr)).toBe(1);
    let cross = "";
    let absent = "";
    try { getRelationship(P_B, aPcr); } catch (e) { cross = (e as Error).message; }
    try { getRelationship(P_B, ABSENT_PCR); } catch (e) { absent = (e as Error).message; }
    expect(cross).toBe(absent);
    expect(cross).toBeTruthy();
    expect(() => getRelationship(P_B, aPcr)).toThrow(PcrNotFoundError);
    // and the positive pole for the same call shape
    expect(getRelationship(P_A, aPcr).companyId).toBe(CO_1);
  });

  it("(19) the surface breakdown is per-partner, and reports an explicit 0 rather than a gap", () => {
    const a = surfaceBreakdown(P_A);
    const b = surfaceBreakdown(P_B);
    // Every surface key present in both — the UI must render "0", not a blank
    // that reads as "unknown".
    for (const s of PCR_SURFACES) {
      expect(typeof a[s]).toBe("number");
      expect(typeof b[s]).toBe("number");
    }
    expect(b.portfolio).toBe(1);

    /* ADDED AFTER MUTATION TESTING. Mutant M9 (drop `p.removed_at IS NULL` from
     * the breakdown query) SURVIVED the original case, because no surface in the
     * fixture had a presence that was removed AND NOT re-added — every removal
     * was revived by a later case, so live and total counts coincided. A summary
     * strip that counts ended relationships as current is exactly the kind of
     * quietly-wrong number an operator would act on. */
    const beforeMfc = surfaceBreakdown(P_B).mfc;
    recordSurfacePresence(P_B, CO_2, "mfc", "w30e2_b_mfc_row");
    expect(surfaceBreakdown(P_B).mfc).toBe(beforeMfc + 1); // lower pole: it counts
    expect(recordSurfaceRemoval(P_B, CO_2, "mfc", "w30e2_b_mfc_row")).toBe(true);
    // upper pole: once ended it STOPS counting, even though the row still exists
    expect(surfaceBreakdown(P_B).mfc).toBe(beforeMfc);
    expect(
      count(`SELECT COUNT(*) n FROM pcr_surface_presence WHERE row_id = 'w30e2_b_mfc_row'`),
    ).toBe(1);
    // B has no pipeline presence at all; A does. If the query aggregated across
    // firms these would be equal.
    expect(b.pipeline).toBe(0);
    expect(a.pipeline).toBeGreaterThan(0);
  });

  it("(20) an empty partner id is refused outright, never treated as a wildcard", () => {
    // A predicate built by string interpolation could turn "" into "match all",
    // which is the worst possible failure mode for a tenant boundary.
    expect(() => listRelationshipsForPartner("")).toThrow(PcrValidationError);
    expect(() => surfaceBreakdown("")).toThrow(PcrValidationError);
    expect(() => getRelationship("", pcrIdFor(P_A, CO_1))).toThrow(PcrValidationError);
  });
});
