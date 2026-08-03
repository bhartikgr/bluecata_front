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
    // Pin will advance further as Wave 0 completes.
    expect(maxId).toBe(124);
  });
});
