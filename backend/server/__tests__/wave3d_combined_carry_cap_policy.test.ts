/**
 * WAVE 3D / ITEM 3 — the combined-carry cap is DB-driven and FAIL-CLOSED.
 *
 * W3 REVIEW A, MAJOR: `COMBINED_CARRY_CAP_FRACTION = 1` was a business-policy
 * number hardcoded at server/spvEngineStore.ts:72-79, violating the standing
 * all-DB-driven / no-hardcoding rule. Changing the cap needed a deployment, no
 * tenant or SPV policy record was consulted, and there was no audit history.
 *
 * The cap now lives in `spv_carry_cap_policy` (migration 0150) as an EXACT
 * INTEGER on CARRY_FRACTION_SCALE. This suite proves the four things that make
 * that a real fix rather than a relocation:
 *
 *   CAP-1  the constant is GONE from the store
 *   CAP-2  the seeded value reproduces the old behaviour exactly (1e9 == 1.0)
 *   CAP-3  scoping resolves spv -> tenant -> platform, most specific wins,
 *          and inactive rows are ignored
 *   CAP-4  FAIL-CLOSED — a missing policy record REJECTS the distribution. A
 *          missing config must never mean "no cap". This is the assertion that
 *          distinguishes durable configuration from an optional override.
 *   CAP-5  validation rejects corrupt rows (bad scale, out of range, non-integer)
 *   CAP-6  the module's embedded bootstrap SQL is BYTE-IDENTICAL to the
 *          numbered migration file, and both copies of that migration match.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CARRY_CAP_POLICY_SQL,
  ensureCarryCapPolicySchema,
  resolveCombinedCarryCapPolicy,
  resolveCombinedCarryCapScaled,
} from "../lib/combinedCarryCapPolicy";
import { rawDb } from "../db/connection";
import { CARRY_FRACTION_SCALE } from "../lib/money";

const REPO = path.resolve(__dirname, "..", "..");
const MIGRATION = "0150_wave3d_combined_carry_cap.sql";
const PRIMARY = path.join(REPO, "migrations", MIGRATION);
const MIRROR = path.join(REPO, "server", "db", "migrations", MIGRATION);

/** Restore the genesis platform row after tests that delete it. */
function reseedPlatformRow(): void {
  const db = rawDb();
  db.prepare("DELETE FROM spv_carry_cap_policy").run();
  db.prepare(
    `INSERT INTO spv_carry_cap_policy
       (id, scope_kind, scope_id, cap_scaled, scale, active, description, created_at, updated_at, updated_by)
     VALUES ('sccp_platform', 'platform', '*', 1000000000, 1000000000, 1,
             'test reseed', '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', NULL)`,
  ).run();
}

beforeEach(() => {
  ensureCarryCapPolicySchema();
  reseedPlatformRow();
});

describe("WAVE 3D / ITEM 3 — DB-driven combined-carry cap", () => {
  it("CAP-1 — the hardcoded constant no longer exists in the store", () => {
    const src = fs.readFileSync(path.join(REPO, "server", "spvEngineStore.ts"), "utf8");
    // Comments deliberately QUOTE the removed declaration so the history is
    // legible; strip them before asserting that no live declaration remains.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(code).not.toContain("COMBINED_CARRY_CAP_FRACTION");
    // The guard itself must still be at the sink.
    expect(code).toContain("COMBINED_CARRY_EXCEEDS_CAP");
    expect(code).toContain("resolveCombinedCarryCapScaled(");
  });

  it("CAP-2 — the seeded platform policy reproduces the old cap of 1.0 exactly", () => {
    const p = resolveCombinedCarryCapPolicy({});
    expect(p.capScaled).toBe(CARRY_FRACTION_SCALE); // 1e9 == a cap of 1.0
    expect(p.scopeKind).toBe("platform");
    expect(p.scopeId).toBe("*");
    expect(resolveCombinedCarryCapScaled({})).toBe(1_000_000_000);
  });

  it("CAP-3 — scoping is most-specific-wins (spv > tenant > platform), inactive ignored", () => {
    const db = rawDb();
    const ins = (id: string, kind: string, scope: string, cap: number, active = 1) =>
      db
        .prepare(
          `INSERT INTO spv_carry_cap_policy
             (id, scope_kind, scope_id, cap_scaled, scale, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1000000000, ?, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z')`,
        )
        .run(id, kind, scope, cap, active);

    // Platform only.
    expect(resolveCombinedCarryCapScaled({ tenantId: "t1", spvId: "s1" })).toBe(1_000_000_000);

    // Tenant overrides platform.
    ins("p_t1", "tenant", "t1", 800_000_000);
    expect(resolveCombinedCarryCapScaled({ tenantId: "t1", spvId: "s1" })).toBe(800_000_000);
    // ...but only for that tenant.
    expect(resolveCombinedCarryCapScaled({ tenantId: "t2", spvId: "s1" })).toBe(1_000_000_000);

    // SPV overrides tenant.
    ins("p_s1", "spv", "s1", 250_000_000);
    expect(resolveCombinedCarryCapScaled({ tenantId: "t1", spvId: "s1" })).toBe(250_000_000);

    // An INACTIVE row is not a policy — resolution falls back past it.
    db.prepare("UPDATE spv_carry_cap_policy SET active = 0 WHERE id = 'p_s1'").run();
    expect(resolveCombinedCarryCapScaled({ tenantId: "t1", spvId: "s1" })).toBe(800_000_000);
    db.prepare("UPDATE spv_carry_cap_policy SET active = 0 WHERE id = 'p_t1'").run();
    expect(resolveCombinedCarryCapScaled({ tenantId: "t1", spvId: "s1" })).toBe(1_000_000_000);
  });

  it("CAP-4 — FAIL-CLOSED: no applicable policy REJECTS, it does not mean 'no cap'", () => {
    /* THE LOAD-BEARING TEST OF THIS ITEM. The obvious wrong implementation of
     * "move the constant to the database" is `cap = row?.capScaled ?? Infinity`,
     * which turns a deleted or un-migrated row into UNLIMITED CARRY. Deleting
     * every policy row must make the resolver throw. */
    rawDb().prepare("DELETE FROM spv_carry_cap_policy").run();
    expect(() => resolveCombinedCarryCapPolicy({ tenantId: "t1", spvId: "s1" }))
      .toThrow("COMBINED_CARRY_CAP_POLICY_MISSING");
    expect(() => resolveCombinedCarryCapScaled({}))
      .toThrow("COMBINED_CARRY_CAP_POLICY_MISSING");

    // Deactivating (rather than deleting) the last row is equally fail-closed.
    reseedPlatformRow();
    rawDb().prepare("UPDATE spv_carry_cap_policy SET active = 0").run();
    expect(() => resolveCombinedCarryCapScaled({}))
      .toThrow("COMBINED_CARRY_CAP_POLICY_MISSING");
  });

  it("CAP-5 — corrupt policy rows are rejected, not coerced", () => {
    const db = rawDb();

    // Out-of-range and non-integer caps are refused by the DDL CHECK itself,
    // so a bad value cannot even be stored. That is the first line of defence.
    expect(() =>
      db
        .prepare(
          `INSERT INTO spv_carry_cap_policy
             (id, scope_kind, scope_id, cap_scaled, scale, active, created_at, updated_at)
           VALUES ('p_bad_hi', 'tenant', 'tbad', 1000000001, 1000000000, 1,
                   '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z')`,
        )
        .run(),
    ).toThrow();

    expect(() =>
      db
        .prepare(
          `INSERT INTO spv_carry_cap_policy
             (id, scope_kind, scope_id, cap_scaled, scale, active, created_at, updated_at)
           VALUES ('p_bad_neg', 'tenant', 'tbad', -1, 1000000000, 1,
                   '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z')`,
        )
        .run(),
    ).toThrow();

    // A wrong SCALE is refused too — the scale is pinned so a future rescale
    // cannot silently reinterpret stored caps by a factor of a thousand.
    expect(() =>
      db
        .prepare(
          `INSERT INTO spv_carry_cap_policy
             (id, scope_kind, scope_id, cap_scaled, scale, active, created_at, updated_at)
           VALUES ('p_bad_scale', 'tenant', 'tbad', 500000, 1000000, 1,
                   '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z')`,
        )
        .run(),
    ).toThrow();

    // An unknown scope kind is refused.
    expect(() =>
      db
        .prepare(
          `INSERT INTO spv_carry_cap_policy
             (id, scope_kind, scope_id, cap_scaled, scale, active, created_at, updated_at)
           VALUES ('p_bad_kind', 'galaxy', 'tbad', 1000, 1000000000, 1,
                   '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z')`,
        )
        .run(),
    ).toThrow();
  });

  it("CAP-6 — the module's bootstrap SQL is byte-identical to migration 0150 (both copies)", () => {
    /* server/db/connection.ts is SACRED, so this module carries its own
     * bootstrap. That is only safe if the bootstrap and the numbered migration
     * cannot drift apart — a schema that differs between fresh-install and
     * upgrade is exactly how a cap silently stops being enforced on one of
     * them. Byte equality, asserted here, is what makes the duplication safe. */
    const primary = fs.readFileSync(PRIMARY, "utf8");
    const mirror = fs.readFileSync(MIRROR, "utf8");
    expect(mirror).toBe(primary);
    expect(CARRY_CAP_POLICY_SQL).toBe(primary);
  });

  it("CAP-7 — re-running the bootstrap never re-seeds a deleted policy row", () => {
    /* If `ensureCarryCapPolicySchema()` re-inserted the genesis row every call,
     * CAP-4's fail-closed behaviour would be silently undone at the next
     * request. The bootstrap must be schema-only once the table exists. */
    rawDb().prepare("DELETE FROM spv_carry_cap_policy").run();
    ensureCarryCapPolicySchema();
    ensureCarryCapPolicySchema();
    const n = rawDb()
      .prepare("SELECT COUNT(*) AS c FROM spv_carry_cap_policy")
      .get() as { c: number };
    expect(n.c).toBe(0);
    expect(() => resolveCombinedCarryCapScaled({})).toThrow("COMBINED_CARRY_CAP_POLICY_MISSING");
  });
});
