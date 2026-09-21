/**
 * Reviewer-owned narrow D-scope control (finding D-1): the taxonomy audit
 * entity string is `taxonomy_term:<ns>:<value>`, and `value` is admin-free text
 * (shared/companyTaxonomy.ts rejects only control chars / length, no charset).
 * `resolveTenantId` (server/adminPlatformStore.ts:534-543) matches /co_([a-z0-9_]+)/i
 * anywhere in the entity, so a term value containing `co_` mis-routes the
 * forensic row out of `tenant_platform` into a fabricated company tenant.
 *
 * Admin-gated, so this is a forensic-filing defect, not privilege escalation.
 * OBSERVATION ONLY — no product source edited.
 *
 * Run:
 *   NODE_ENV=test npx vitest run \
 *     server/__tests__/preflight_slide13b_d_taxonomy_audit_tenant_review.test.ts \
 *     --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1
 */
import { describe, it, expect, beforeAll } from "vitest";
import { rawDb } from "../db/connection";
import { createTaxonomyTerm, ensureCompanyTaxonomySchema } from "../companyTaxonomyStore";

const NS = "company_sector";
const ACTOR = "reviewer@preflight.test";

beforeAll(() => {
  expect(process.env.NODE_ENV).toBe("test");
  ensureCompanyTaxonomySchema();
});

function tenantOf(value: string): string {
  const row: any = rawDb()
    .prepare(
      `SELECT tenant_id FROM audit_log
        WHERE target = ? AND action = 'company_taxonomy.term.create'
        ORDER BY rowid DESC LIMIT 1`,
    )
    .get(`taxonomy_term:${NS}:${value}`);
  return String(row?.tenant_id ?? "");
}

describe("D-1 · taxonomy audit tenant routing", () => {
  it("an ordinary value files to the platform tenant (control, unchanged by the fix)", () => {
    const value = `reviewer_control_${Date.now()}`;
    createTaxonomyTerm(NS, { value, label: "Reviewer Control" }, { actor: ACTOR });
    expect(tenantOf(value)).toBe("tenant_platform");
  });

  it("CONVERTED (D-1 fixed): a value containing `co_` still files to the platform tenant, no company alias", () => {
    // Fail-before behaviour, observed on the pre-fix tree:
    //   [D-1] value=co_op_1789880118089 audit tenant_id=tenant_co_op_1789880118089
    // Fix landed at server/companyTaxonomyStore.ts:244 (explicit "tenant_platform").
    const value = `co_op_${Date.now()}`;
    createTaxonomyTerm(NS, { value, label: "Co-operative" }, { actor: ACTOR });
    const observed = tenantOf(value);
    // eslint-disable-next-line no-console
    console.log(`[D-1 converted] value=${value} audit tenant_id=${observed}`);
    expect(observed).toBe("tenant_platform");
    expect(observed.startsWith("tenant_co_")).toBe(false);
  });

  it("no taxonomy audit row anywhere sits in a derived company tenant", () => {
    for (const value of [`co_alpha_${Date.now()}`, `nested_co_beta_${Date.now()}`, `CO_UPPER_${Date.now()}`]) {
      createTaxonomyTerm(NS, { value, label: `Label ${value}` }, { actor: ACTOR });
      expect(tenantOf(value), value).toBe("tenant_platform");
    }
    const strays: any[] = rawDb()
      .prepare(`SELECT tenant_id FROM audit_log WHERE action LIKE 'company_taxonomy.%' AND tenant_id <> 'tenant_platform'`)
      .all();
    expect(strays).toHaveLength(0);
  });

  it("the term itself is still correct in the DB — only the audit tenant is misfiled", () => {
    const value = `co_review_${Date.now()}`;
    const dto = createTaxonomyTerm(NS, { value, label: "Co Review" }, { actor: ACTOR });
    expect(dto.value).toBe(value);
    expect(dto.active).toBe(true);
    const row: any = rawDb()
      .prepare(`SELECT namespace, value, active FROM taxonomy_terms WHERE namespace = ? AND value = ?`)
      .get(NS, value);
    expect(row).toBeTruthy();
    expect(row.active).toBe(1);
  });
});
