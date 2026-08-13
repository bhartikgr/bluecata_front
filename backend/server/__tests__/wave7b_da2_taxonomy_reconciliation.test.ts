/**
 * WAVE 7B — DA-2 (taxonomy reconciliation) and DA-3 (scope-fence completeness).
 *
 * OWNER RULING A-20: the taxonomy is **87 sub-sectors across 11 sectors**, not
 * the 78/10 that two spec documents used to claim. Both spec documents have
 * been corrected in place (spec/PARTNER_TYPE_TAXONOMY.md line 145 by A-14, and
 * line 201's build-item row by this wave). DA-2 is therefore a reconciliation
 * against 87/11.
 *
 * Reconciliation means THREE representations must agree, not one:
 *
 *   1. the migration file      — migrations/0149_wave4b_partner_classifications.sql
 *   2. its byte-identical mirror in server/db/migrations/
 *   3. the LIVE DATABASE the app actually reads through partnerClassificationStore
 *
 * Counting only the SQL text would be the classic version of this wave's
 * recurring failure: it proves what was written, not what the app serves. The
 * live-DB assertion below is the one that matters; the file assertions exist so
 * that a mismatch tells you WHICH of the three drifted.
 *
 * A-22 CHECK: does the bootstrap re-create what a repair would fix? For this
 * data the answer is YES-by-design — the sacred bootstrap does NOT inline this
 * schema at all (`partner_subsectors` appears zero times in
 * server/db/connection.ts), so Wave 4B already shipped the self-heal installer
 * server/lib/applyWave4bPartnerClassificationSchema.ts, which reads the very
 * same migration file rather than re-typing the seed. That is the correct
 * shape and it is asserted here so it cannot be replaced by a hand-copied seed
 * that would then be free to drift.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { getTaxonomy } from "../partnerClassificationStore";
import {
  readWave4bClassificationDdl,
} from "../lib/applyWave4bPartnerClassificationSchema";
import {
  FENCED_FILES,
  FENCED_NAMES,
  runScopeFence,
  missingFencedFiles,
} from "../../scripts/lint/partnerClassificationScopeFence";

const ROOT = join(__dirname, "..", "..");
const BASENAME = "0149_wave4b_partner_classifications.sql";
const PRIMARY = join(ROOT, "migrations", BASENAME);
const MIRROR = join(ROOT, "server", "db", "migrations", BASENAME);

const EXPECTED_SECTORS = 11;
const EXPECTED_SUBSECTORS = 87;

/** The 11 sector slugs, in the migration's own sort_order. */
const EXPECTED_SECTOR_SLUGS = [
  "investment_capital",
  "banking_and_financial_services",
  "programs_and_venture_development",
  "academic_and_research",
  "government_and_public_sector",
  "professional_services",
  "fund_and_transaction_infrastructure",
  "corporate_and_strategic",
  "ecosystem_and_community",
  "nonprofit_and_philanthropic",
  "individual_and_fallback",
];

function countInserts(sql: string, table: string): number {
  return (sql.match(new RegExp(`INSERT INTO ${table}\\s*\\(`, "g")) ?? []).length;
}

describe("WAVE 7B DA-2 — taxonomy reconciles to 87/11 (A-20)", () => {
  it("the migration file seeds exactly 11 sectors and 87 sub-sectors", () => {
    const sql = readFileSync(PRIMARY, "utf8");
    expect(countInserts(sql, "partner_sectors")).toBe(EXPECTED_SECTORS);
    expect(countInserts(sql, "partner_subsectors")).toBe(EXPECTED_SUBSECTORS);
  });

  it("the mirror in server/db/migrations is byte-identical — one seed, not two", () => {
    expect(existsSync(MIRROR)).toBe(true);
    const a = createHash("md5").update(readFileSync(PRIMARY)).digest("hex");
    const b = createHash("md5").update(readFileSync(MIRROR)).digest("hex");
    expect(b).toBe(a);
  });

  it("every seeded sub-sector names a sector that is actually seeded — no orphan rows", () => {
    const sql = readFileSync(PRIMARY, "utf8");
    const sectorSlugs = new Set(
      [...sql.matchAll(/INSERT INTO partner_sectors[^V]*VALUES \('([a-z_]+)'/g)].map((m) => m[1]),
    );
    const subSectorParents = [
      ...sql.matchAll(/INSERT INTO partner_subsectors[^V]*VALUES \('[a-z_0-9]+',\s*'([a-z_]+)'/g),
    ].map((m) => m[1]);
    expect(subSectorParents.length).toBe(EXPECTED_SUBSECTORS);
    const orphans = [...new Set(subSectorParents.filter((s) => !sectorSlugs.has(s)))];
    expect(orphans).toEqual([]);
    expect([...sectorSlugs].sort()).toEqual([...EXPECTED_SECTOR_SLUGS].sort());
  });

  it("sub-sector slugs are unique — a duplicate would silently reduce the live count below 87", () => {
    const sql = readFileSync(PRIMARY, "utf8");
    const slugs = [
      ...sql.matchAll(/INSERT INTO partner_subsectors[^V]*VALUES \('([a-z_0-9]+)'/g),
    ].map((m) => m[1]);
    expect(slugs.length).toBe(EXPECTED_SUBSECTORS);
    expect(new Set(slugs).size).toBe(EXPECTED_SUBSECTORS);
  });

  it("THE ONE THAT MATTERS — the LIVE database the app reads serves 11/87", async () => {
    // getTaxonomy() is the single accessor behind every classification read
    // path (the admin selector, the partner card, the filters). If the file
    // says 87 and this says 78, the app is serving 78.
    const live = await getTaxonomy({ includeInactive: true });
    expect(live.sectors.length).toBe(EXPECTED_SECTORS);
    expect(live.subsectors.length).toBe(EXPECTED_SUBSECTORS);
    expect(live.sectors.map((s) => s.slug)).toEqual(EXPECTED_SECTOR_SLUGS);
  });

  it("every live sub-sector resolves to a live sector", async () => {
    const live = await getTaxonomy({ includeInactive: true });
    const sectors = new Set(live.sectors.map((s) => s.slug));
    const dangling = live.subsectors.filter((s) => !sectors.has(s.sectorSlug)).map((s) => s.slug);
    expect(dangling).toEqual([]);
  });

  it("A-22 — the seed is healed from the migration FILE, never re-typed", () => {
    // If someone ever replaces the file-read with an inline copy of the 87
    // INSERTs, the installer and the migration become two seeds free to drift,
    // and this reconciliation stops meaning anything.
    const installer = readFileSync(
      join(ROOT, "server", "lib", "applyWave4bPartnerClassificationSchema.ts"),
      "utf8",
    );
    expect(installer).toContain(BASENAME);
    expect(countInserts(installer, "partner_subsectors")).toBe(0);
    const ddl = readWave4bClassificationDdl();
    expect(ddl).not.toBeNull();
    expect(countInserts(ddl!, "partner_subsectors")).toBe(EXPECTED_SUBSECTORS);
  });

  it("A-22 — the sacred bootstrap does NOT re-seed a competing taxonomy", () => {
    const bootstrap = readFileSync(join(ROOT, "server", "db", "connection.ts"), "utf8");
    expect(bootstrap).not.toContain("partner_subsectors");
  });
});

describe("WAVE 7B DA-3 — classification scope fence is complete", () => {
  it("the lint rule exists and passes on the current tree", () => {
    const { violations } = runScopeFence();
    expect(violations).toEqual([]);
  });

  it("THE DA-3 DEFECT — no fenced path is a silent no-op", () => {
    // collectFencedPaths() skips entries that are not on disk. Two of the
    // three client entries pointed at paths that never existed
    // (client/src/components/role.tsx and .../useRequirePartnerRole.ts), so
    // the fence reported success while checking nothing for the client role
    // layer. An empty list here is the whole point of the assertion.
    expect(missingFencedFiles()).toEqual([]);
  });

  it("the fence actually reaches the client role layer and the nav producer", () => {
    const { checked } = runScopeFence();
    expect(checked).toContain("client/src/lib/role.tsx");
    expect(checked).toContain("client/src/lib/partner/useRequirePartnerRole.ts");
    expect(checked).toContain("client/src/components/CollectiveShell.tsx");
    // Regression bound: the pre-DA-3 fence resolved to 13 files.
    expect(checked.length).toBeGreaterThanOrEqual(17);
  });

  it("the fence watches the classification column names, not just the table", () => {
    expect(FENCED_NAMES.join(" ")).toMatch(/sector_slug/);
    expect(FENCED_NAMES.join(" ")).toMatch(/subsector_slug/);
    expect(FENCED_NAMES.join(" ")).toMatch(/partner_classifications/);
  });

  it("the fenced set covers the three surfaces the ruling names — permissions, nav and access", () => {
    const fenced = FENCED_FILES.join(" ");
    // ACCESS / permissions: the auth middleware and the partner auth gate.
    expect(fenced).toContain("server/lib/authMiddleware.ts");
    expect(fenced).toContain("server/lib/requirePartnerAuth.ts");
    // ROUTE GUARDS.
    expect(fenced).toContain("server/lib/applyRouteGuards.ts");
    expect(fenced).toContain("client/src/components/RequireAuth.tsx");
    // NAV — added by DA-3; the sole producer of the partner sidebar.
    expect(fenced).toContain("client/src/components/CollectiveShell.tsx");
  });

  it("the identical-payload test — the runtime half of the fence — still exists", () => {
    // The lint is static; only this proves that two differently-classified
    // partners actually receive byte-identical nav and permission payloads.
    const t = readFileSync(join(ROOT, "server", "__tests__", "wave4b_classification_scope_fence.test.ts"), "utf8");
    expect(t).toMatch(/IDENTICAL PAYLOADS/);
    expect(t).toMatch(/SET_A/);
    expect(t).toMatch(/SET_B/);
  });
});
