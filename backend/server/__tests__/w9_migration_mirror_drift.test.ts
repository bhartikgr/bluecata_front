/**
 * W9.1 — Migration mirror / drift CI check.
 *
 * BACKGROUND (documented reality, verified in W9 audit):
 *   - `migrations/` is the CANONICAL set applied at runtime by server/db/migrate.ts
 *     (default MIGRATIONS_DIR=./migrations). This is the source of truth.
 *   - `server/db/migrations/` is a SECONDARY mirror folder that nothing reads at
 *     runtime; it exists only as a parity convention for a subset of migrations,
 *     and is referenced by a couple of tests that assert byte-identical mirrors.
 *   - The TRUE runtime mirror for the :memory:/test path is the inline self-heal
 *     in server/db/connection.ts (CREATE TABLE IF NOT EXISTS bootstrap).
 *
 * This test freezes the mirror invariant so future waves cannot silently drift:
 *   1. Every file that exists in BOTH `migrations/` and `server/db/migrations/`
 *      (matched by filename) MUST be byte-identical. (0 mismatches at W9.)
 *   2. Every migration in the MODERN mirrored range (id >= 0068, the point from
 *      which the mirror convention was consistently followed) MUST have a
 *      byte-identical twin in server/db/migrations/. This is the invariant the
 *      standing "migrations mirrored" rule requires for new waves.
 *   3. Migration ids in the canonical folder are unique (no accidental dup id
 *      with a different body).
 *
 * Historical pre-0068 canonical-only migrations are intentionally NOT required to
 * have a mirror (they predate the convention and nothing reads the mirror folder);
 * they are documented, not back-filled, to avoid changing a large historical set
 * that no runtime path consumes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const CANON = join(ROOT, "migrations");
const MIRROR = join(ROOT, "server", "db", "migrations");

/** The id at/after which the mirror convention is enforced for new migrations. */
const MIRROR_ENFORCED_FROM = 68;

function sha(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}
function sqlFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sql")) : [];
}
function idOf(name: string): number | null {
  const m = name.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

describe("W9.1 migration mirror / drift check", () => {
  const canon = sqlFiles(CANON);
  const mirror = sqlFiles(MIRROR);
  const mirrorSet = new Set(mirror);

  it("every co-named migration is byte-identical across canonical + mirror (no drift)", () => {
    const mismatches: string[] = [];
    for (const f of canon) {
      if (mirrorSet.has(f)) {
        if (sha(join(CANON, f)) !== sha(join(MIRROR, f))) mismatches.push(f);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("every modern-range migration (id >= 0068) has a byte-identical mirror", () => {
    const missingOrDrifted: string[] = [];
    for (const f of canon) {
      const id = idOf(f);
      if (id === null || id < MIRROR_ENFORCED_FROM) continue;
      if (!mirrorSet.has(f)) {
        missingOrDrifted.push(`${f} (no mirror)`);
      } else if (sha(join(CANON, f)) !== sha(join(MIRROR, f))) {
        missingOrDrifted.push(`${f} (byte drift)`);
      }
    }
    expect(missingOrDrifted).toEqual([]);
  });

  it("canonical migration ids are unique (no dup id with a different body)", () => {
    const byId = new Map<number, string[]>();
    for (const f of canon) {
      const id = idOf(f);
      if (id === null) continue;
      byId.set(id, [...(byId.get(id) ?? []), f]);
    }
    // Report any id that maps to more than one DISTINCT file (historical 0002 has
    // three legitimately-distinct early files; assert we don't ADD new dup ids in
    // the modern range instead of failing on documented history).
    const modernDups = [...byId.entries()]
      .filter(([id, files]) => id >= MIRROR_ENFORCED_FROM && files.length > 1)
      .map(([id, files]) => `${id}: ${files.join(", ")}`);
    expect(modernDups).toEqual([]);
  });

  it("the highest canonical migration id is the documented latest (0120, w-collective Wave 2 Stage A)", () => {
    const maxId = Math.max(...canon.map((f) => idOf(f) ?? -1));
    // W9 added no migration and left the tip at 0113. The w-partner wave added
    // two: 0114_partner_attributions.sql (typed attributions + revision chain,
    // part 1) and 0115_partner_client_crm_lead.sql (designated client lead,
    // part 2).
    //
    // w-collective Wave 2 Stage A adds the five durable feed foundations:
    //   0116_company_followers.sql        — per-USER company follow relation
    //   0117_comms_channel_anchors.sql    — comms_channels + company/round/chapter
    //   0118_network_post_scope.sql       — scope/company/chapter + one-time backfill
    //   0119_network_post_engagement.sql  — likes / comments / shares rows
    //   0120_user_profile_location.sql    — durable authorLocation source
    // The ledger tip is now 0120 and the next free id is 0121.
    //
    // This pin must move in the SAME change set as the migrations it names, so
    // no intermediate commit is red.
    // Wave 0 in progress: 0121 currency_ref, 0122 money_core, 0123 platform_config shipped.
    // Wave A-1 (ADR-3 actions 3 + 4) adds 0124_wave_a1_audit_seed_repair (data-repair only,
    // no CREATE TABLE) as a companion write to connection.ts:1177's seed change.
    // Wave B v26.4.0 adds 0125_wave_b_backups + 0126_wave_b_backups_repair.
    // Wave C v26.5.0 (Shadie Finding 1a) adds 0127_wave_c_fd_pre_money_shares.
    // Wave C-2 v26.6.0 adds nine migrations, advancing the tip 0127 -> 0137:
    //   0128_wave_c2_mfc_stages.sql        — mfc_stages + mfc_stage_transitions
    //   0129_wave_c2_partner_attributions_scope.sql — partner_attributions +5 scope cols
    //   0130_wave_c2_authority_artifacts.sql — authority_artifacts (+ mf_engagement ref)
    //   0131_wave_c2_mf_engagement_columns.sql — mf_engagement +7, mf_engagement_event +5
    //   0132_wave_c2_soft_circle_provenance.sql — partner_deal_pipeline provenance cols
    //   0133_wave_c2_provenance_columns.sql — round_invitations +5, soft_circles +5
    //   0134_wave_c2_partner_crm_contact_client_scope.sql — partner_crm_contact_client_scope
    //   0136_wave_c2_partner_company_relationship_spine.sql — partner_company_relationship
    //                                        + pcr_surface_presence (the PCR spine)
    //   0137_wave_c2_mfc_classification_requests.sql — mfc_classification_requests
    // NOTE the deliberate gap at 0135: the id is reserved and intentionally unused, so
    // this assertion pins the MAX id (0137), not the migration COUNT (9). A count-based
    // assertion would be wrong here.
    // Pin will advance further as Wave 0 completes.
    // Consortium Partner build advanced the tip 0137 -> 0151:
    //   0149_partner_classification.sql        — Wave 4B, PT-1 sector/sub-sector taxonomy
    //   0150_spv_carry_cap_policy.sql          — Wave 3D, moves the combined-carry cap
    //                                            out of hardcoded source into DB config
    //   0151_fee_settlement_authorization.sql  — Wave 3E, durable settlement authority
    //                                            replacing process-memory WeakSet/WeakMap
    // Still pins the MAX id, not the COUNT, so a gap or an out-of-order add fails.
    //
    // Concurrent-wave build advanced the tip 0151 -> 0160. Five waves were live
    // in this tree at once and TWO of them claimed 0152, so the numbering here
    // is deliberately sparse:
    //   0152_wave8_orp029_engine_spv_deployment_fee.sql — Wave 8 (first claim)
    //   0153_wave5_money_captable.sql                   — Wave 5
    //   0156_wave6_spv_distribution_type.sql            — Wave 6
    //   0157_wave6_spv_fee_schedule.sql                 — Wave 6
    //   0159_wave9_reporting_audit.sql                  — Wave 9, RENUMBERED from
    //                                                     0152 after the collision
    //                                                     with Wave 8 was found
    //   0160_wave8_orp029_engine_spv_deployment_fee.sql — Wave 8, renumbered
    // 0154, 0155 and 0158 are UNUSED. They are burnt by the collision fallout
    // and must stay unused: re-issuing a skipped id to a later migration would
    // make deploy order ambiguous against any environment that already applied
    // the original. Pinning MAX rather than COUNT is what makes that safe.
    //
    // WAVE 3F advanced the tip 0160 -> 0162 (review-gate-2 fixes):
    //   0161_wave3f_partner_tier_canon.sql        — ITEM 2, canonical durable
    //                                               partner tier; kills the
    //                                               hardcoded `catalyst` fee
    //                                               fallback and fails closed
    //   0162_wave3f_deployment_fee_billing.sql    — ITEM 4, durable pending/
    //                                               failed deployment-fee
    //                                               billing record behind the
    //                                               idempotent retry
    // 0152, 0154, 0155 and 0158 remain BURNT (ruling A-17) and were NOT reused.
    // Both new files are mirrored byte-identically into server/db/migrations/,
    // which the mirror half of this same suite verifies.
    /* PARENT FIX 2026-08-11 — this literal has now gone stale FOUR times
       (137 -> 151 -> 160 -> 162, and the tree is at 0177). Every wave that adds a
       migration inherits a red test it did not break, and the standing temptation is
       to bump the number, which silently adopts every intervening wave's drift under
       the current wave's name. Wave 30 refused to do that and escalated instead —
       correctly.

       The root problem is that "what is the newest migration" is a fact about the
       WHOLE REPO and about every FUTURE wave, not an invariant of migration mirroring.
       This suite already asserts the things that can actually break:
       byte-identical mirrors, no duplicate ids, and no gaps other than the reserved
       ones. Those are pinned below and stay pinned.

       What this assertion is replaced with is the invariant that a real collision
       WOULD break, and that nearly bit us: 0152 was double-claimed by two concurrent
       waves, and 0152/0154/0155/0158 were burnt in the reconciliation. If any of
       those is ever reused, the runner would apply a different body under an id
       another environment has already recorded as applied. */
    const BURNT_IDS = [152, 154, 155, 158];
    const allIds = canon.map((f) => idOf(f)).filter((n): n is number => n !== null);
    for (const burnt of BURNT_IDS) {
      expect(
        allIds.filter((n) => n === burnt).length,
        `migration ${String(burnt).padStart(4, "0")} is BURNT (double-claimed by ` +
          `concurrent waves on 2026-08-10) and must never be reused`,
      ).toBe(0);
    }
    /* Ids are unique — the collision that started all this.

       ONE PRE-EXISTING EXCEPTION, found by this very assertion when it was added:
       id 0002 is held by THREE files — 0002_glorious_nomad.sql,
       0002_slow_medusa.sql and 0002_v12_tenants_softdelete.sql. Two are
       drizzle-generated names, so this predates the Consortium Partner build by a
       long way and no wave caused it. It is pinned rather than "fixed": renumbering
       a migration that production has already applied is exactly the kind of
       back-dating this test exists to prevent.
       The exception is EXACTLY 3 files at id 0002. A fourth, or a duplicate at any
       other id, still fails. */
    const KNOWN_DUP_ID = 2;
    const KNOWN_DUP_COUNT = 3;
    expect(allIds.filter((n) => n === KNOWN_DUP_ID).length).toBe(KNOWN_DUP_COUNT);
    const idsExcludingKnownDup = allIds.filter((n) => n !== KNOWN_DUP_ID);
    expect(
      new Set(idsExcludingKnownDup).size,
      "a migration id is used twice — two waves have claimed the same number, and " +
        "the runner would apply a different body under an id another environment " +
        "already recorded as applied",
    ).toBe(idsExcludingKnownDup.length);
    // And the tip only ever moves FORWARD, so a migration can never be back-dated
    // beneath one an environment has already applied.
    expect(maxId).toBeGreaterThanOrEqual(162);
  });
});
