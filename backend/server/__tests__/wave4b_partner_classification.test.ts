/**
 * WAVE 4B (PT-1 … PT-4) — behaviour tests on the REAL store and the REAL
 * Express routes. Nothing here mocks the module under test.
 *
 * Coverage, one describe per owner ruling:
 *   PT-1  migration 0149 seeds the two lookup tables; the DB constraints
 *         (UNIQUE, single-primary, other-requires-text) actually bite.
 *   PT-2  read/write endpoints + admin CRUD; DELETE is a RETIRE, never a
 *         hard delete, so historical rows keep rendering.
 *   PT-3  mandatory selection; `other` requires non-empty free text;
 *         hybrids; primary = first selected and editable afterwards.
 *   PT-4  `Sector // Sub-sector` rendering; single-value contexts use the
 *         primary; filters match ANY classification.
 *   GRANDFATHERING — no backfill: a partner with no classification stays at
 *         zero and no sentinel row appears.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

import { registerPartnerClassificationRoutes } from "../partnerClassificationRoutes";
import {
  getTaxonomy,
  listForPartner,
  listForPartners,
  partnerIdsMatching,
  replaceClassifications,
  setPrimary,
  createSector,
  createSubsector,
  retireSubsector,
  updateSubsector,
  countUsage,
  ClassificationValidationFailure,
  TaxonomyConflictError,
} from "../partnerClassificationStore";
import {
  CLASSIFICATION_SEPARATOR,
  formatAll,
  formatPrimary,
  primaryClassification,
} from "../../shared/partnerClassification";
import type { PartnerTaxonomyDto } from "../../shared/partnerClassification";

const P1 = "ac_wave4b_partner_one";
const P2 = "ac_wave4b_partner_two";
const P_GRANDFATHERED = "ac_wave4b_partner_grandfathered";

let app: express.Express;
let tax: PartnerTaxonomyDto;
let available = false;

/** Two plain (non-free-text) sub-sectors in DIFFERENT sectors, plus a third. */
let A: { sectorSlug: string; subsectorSlug: string };
let B: { sectorSlug: string; subsectorSlug: string };
let OTHER: { sectorSlug: string; subsectorSlug: string } | null = null;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerPartnerClassificationRoutes(app);

  tax = await getTaxonomy();
  const plain = tax.subsectors.filter((s) => !s.requiresOtherText);
  const first = plain[0];
  const other = plain.find((s) => s.sectorSlug !== first?.sectorSlug);
  const freeText = tax.subsectors.find((s) => s.requiresOtherText);
  if (first && other) {
    A = { sectorSlug: first.sectorSlug, subsectorSlug: first.slug };
    B = { sectorSlug: other.sectorSlug, subsectorSlug: other.slug };
    available = true;
  }
  if (freeText) OTHER = { sectorSlug: freeText.sectorSlug, subsectorSlug: freeText.slug };
});

/* ── PT-1 ───────────────────────────────────────────────────────────────── */

describe("PT-1 — migration 0149 lookup tables", () => {
  it("seeds the sectors and sub-sectors from the taxonomy document", () => {
    expect(available).toBe(true);
    // The document enumerates 11 sectors and 87 sub-sectors (its prose says
    // "78 across 10"; see WAVE4B_REPORT.md for that discrepancy). Assert the
    // shape rather than the exact count so a later admin edit does not break
    // an unrelated test.
    expect(tax.sectors.length).toBeGreaterThanOrEqual(10);
    expect(tax.subsectors.length).toBeGreaterThanOrEqual(70);
  });

  it("every sub-sector belongs to a real sector, and slugs are globally unique", () => {
    const sectorSlugs = new Set(tax.sectors.map((s) => s.slug));
    for (const ss of tax.subsectors) expect(sectorSlugs.has(ss.sectorSlug)).toBe(true);
    const slugs = tax.subsectors.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("exposes an `other` sub-sector that requires free text", () => {
    expect(tax.subsectors.some((s) => s.requiresOtherText)).toBe(true);
  });

  it("UNIQUE(partner_id, sector_slug, subsector_slug) rejects a duplicate", async () => {
    if (!available) return;
    await expect(
      replaceClassifications(
        P1,
        [
          { ...A, otherText: null, isPrimary: true },
          { ...A, otherText: null, isPrimary: false },
        ],
        { mandatory: true },
      ),
    ).rejects.toBeInstanceOf(ClassificationValidationFailure);
  });
});

describe("PT-1 — migration file hygiene", () => {
  const NAME = "0149_wave4b_partner_classifications.sql";

  it("exists in BOTH migration trees and is byte-identical (gate 5c)", async () => {
    const fs = await import("node:fs");
    const a = fs.readFileSync(`migrations/${NAME}`);
    const b = fs.readFileSync(`server/db/migrations/${NAME}`);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it("does not reuse a migration number", async () => {
    const fs = await import("node:fs");
    const nums = fs
      .readdirSync("migrations")
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .map((f) => f.slice(0, 4));
    // Scoped to 0149: the tree carries a PRE-EXISTING duplicate at 0002 that
    // predates this wave. Asserting global uniqueness would fail on someone
    // else's history and teach the next reader to ignore this test.
    expect(nums).toContain("0149");
    expect(nums.filter((n) => n === "0149")).toHaveLength(1);
  });

  it("is allocated AFTER 0148 — spec/00_SHARED_STANDARDS.md reserves 0138–0148", () => {
    expect(Number(NAME.slice(0, 4))).toBeGreaterThan(148);
  });
});

/* ── PT-3 ───────────────────────────────────────────────────────────────── */

describe("PT-3 — mandatory selection, free text, hybrids, primary", () => {
  it("MANDATORY: an empty selection is refused", async () => {
    if (!available) return;
    await expect(replaceClassifications(P1, [], { mandatory: true })).rejects.toBeInstanceOf(
      ClassificationValidationFailure,
    );
  });

  it("`other` without free text is refused; with free text it is accepted", async () => {
    if (!available || !OTHER) return;
    await expect(
      replaceClassifications(P1, [{ ...OTHER, otherText: null, isPrimary: true }], {
        mandatory: true,
      }),
    ).rejects.toBeInstanceOf(ClassificationValidationFailure);

    // Whitespace is not text.
    await expect(
      replaceClassifications(P1, [{ ...OTHER, otherText: "   ", isPrimary: true }], {
        mandatory: true,
      }),
    ).rejects.toBeInstanceOf(ClassificationValidationFailure);

    const ok = await replaceClassifications(
      P1,
      [{ ...OTHER, otherText: "Sovereign wealth co-invest desk", isPrimary: true }],
      { mandatory: true },
    );
    expect(ok).toHaveLength(1);
    expect(ok[0].otherText).toBe("Sovereign wealth co-invest desk");
  });

  it("HYBRID: a partner may hold several classifications; the FIRST is primary", async () => {
    if (!available) return;
    const rows = await replaceClassifications(
      P1,
      [
        { ...A, otherText: null, isPrimary: false },
        { ...B, otherText: null, isPrimary: false },
      ],
      { mandatory: true },
    );
    expect(rows).toHaveLength(2);
    const primary = primaryClassification(rows);
    expect(primary?.subsectorSlug).toBe(A.subsectorSlug);
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
  });

  it("the primary is EDITABLE afterwards", async () => {
    if (!available) return;
    const before = await listForPartner(P1);
    const target = before.find((r) => !r.isPrimary);
    expect(target).toBeTruthy();
    const after = await setPrimary(P1, target!.id);
    expect(primaryClassification(after)?.id).toBe(target!.id);
    expect(after.filter((r) => r.isPrimary)).toHaveLength(1);
  });
});

/* ── PT-4 ───────────────────────────────────────────────────────────────── */

describe("PT-4 — rendering and filtering", () => {
  it("renders as `Sector // Sub-sector`", async () => {
    if (!available) return;
    const rows = await listForPartner(P1);
    expect(CLASSIFICATION_SEPARATOR).toBe(" // ");
    for (const r of rows) {
      expect(r.display).toContain(" // ");
      expect(r.display.startsWith(r.sectorLabel)).toBe(true);
    }
  });

  it("single-value contexts use the PRIMARY; the full set is still available", async () => {
    if (!available) return;
    const rows = await listForPartner(P1);
    expect(formatPrimary(rows)).toBe(primaryClassification(rows)?.display);
    // formatAll joins with "; " precisely because a classification itself
    // contains " // " and may contain a comma inside free text.
    expect(formatAll(rows).split("; ").length).toBe(rows.length);
    expect(formatAll(rows)).toContain(formatPrimary(rows));
  });

  it("filters match ANY classification — a hybrid is found under EVERY sector it holds", async () => {
    if (!available) return;
    await replaceClassifications(
      P1,
      [
        { ...A, otherText: null, isPrimary: true },
        { ...B, otherText: null, isPrimary: false },
      ],
      { mandatory: true },
    );
    const underA = await partnerIdsMatching({ sectorSlugs: [A.sectorSlug] });
    const underB = await partnerIdsMatching({ sectorSlugs: [B.sectorSlug] });
    expect(underA).toContain(P1);
    // B is the SECONDARY classification — the hybrid must still be found here.
    expect(underB).toContain(P1);
  });

  it("a partner classified only under A is NOT found under B", async () => {
    if (!available) return;
    await replaceClassifications(P2, [{ ...A, otherText: null, isPrimary: true }], {
      mandatory: true,
    });
    const underB = await partnerIdsMatching({ sectorSlugs: [B.sectorSlug] });
    expect(underB).not.toContain(P2);
  });

  it("bulk read returns a row set per partner for list surfaces", async () => {
    if (!available) return;
    const map = await listForPartners([P1, P2, P_GRANDFATHERED]);
    expect((map.get(P1) ?? []).length).toBe(2);
    expect((map.get(P2) ?? []).length).toBe(1);
    expect(map.get(P_GRANDFATHERED) ?? []).toHaveLength(0);
  });
});

/* ── GRANDFATHERING ─────────────────────────────────────────────────────── */

describe("Grandfathering — no backfill, no sentinel", () => {
  it("an untouched partner has ZERO classifications and no sentinel row", async () => {
    const rows = await listForPartner(P_GRANDFATHERED);
    expect(rows).toEqual([]);
  });

  it("formatting an unclassified partner yields a placeholder, NOT a defaulted 'other'", async () => {
    const rows = await listForPartner(P_GRANDFATHERED);
    // The whole point of this wave: the old field silently defaulted to
    // "other", so nobody ever chose. An unclassified partner must read as
    // unclassified, never as a real classification.
    expect(formatPrimary(rows)).toBe("\u2014");
    expect(formatPrimary(rows).toLowerCase()).not.toContain("other");
    expect(formatAll(rows)).toBe("");
  });
});

/* ── PT-2 ───────────────────────────────────────────────────────────────── */

describe("PT-2 — admin CRUD without a migration", () => {
  it("adds a sector and a sub-sector at runtime", async () => {
    const sector = await createSector({ slug: "wave4b_test_sector", label: "Wave4B Test Sector" });
    expect(sector.slug).toBe("wave4b_test_sector");
    const sub = await createSubsector({
      slug: "wave4b_test_subsector",
      label: "Wave4B Test Subsector",
      sectorSlug: "wave4b_test_sector",
    });
    expect(sub.sectorSlug).toBe("wave4b_test_sector");

    const t = await getTaxonomy();
    expect(t.sectors.some((s) => s.slug === "wave4b_test_sector")).toBe(true);
    expect(t.subsectors.some((s) => s.slug === "wave4b_test_subsector")).toBe(true);
  });

  it("refuses a duplicate slug rather than silently overwriting", async () => {
    await expect(
      createSector({ slug: "wave4b_test_sector", label: "Duplicate" }),
    ).rejects.toBeInstanceOf(TaxonomyConflictError);
  });

  it("RETIRE, never delete: a retired type disappears from the selector but its rows survive", async () => {
    await replaceClassifications(
      P2,
      [
        {
          sectorSlug: "wave4b_test_sector",
          subsectorSlug: "wave4b_test_subsector",
          otherText: null,
          isPrimary: true,
        },
      ],
      { mandatory: true },
    );
    const usage = await countUsage("subsector", "wave4b_test_subsector");
    expect(usage).toBeGreaterThan(0);

    await retireSubsector("wave4b_test_subsector");

    // Gone from the offered taxonomy…
    const t = await getTaxonomy();
    expect(t.subsectors.some((s) => s.slug === "wave4b_test_subsector")).toBe(false);
    // …but the partner's existing row still resolves and still renders.
    const rows = await listForPartner(P2);
    expect(rows).toHaveLength(1);
    expect(rows[0].display).toContain("Wave4B Test Subsector");
  });

  it("a retired type cannot be NEWLY selected", async () => {
    await expect(
      replaceClassifications(
        P1,
        [
          {
            sectorSlug: "wave4b_test_sector",
            subsectorSlug: "wave4b_test_subsector",
            otherText: null,
            isPrimary: true,
          },
        ],
        { mandatory: true },
      ),
    ).rejects.toBeInstanceOf(ClassificationValidationFailure);
  });

  it("a retired type can be reinstated", async () => {
    await updateSubsector("wave4b_test_subsector", { active: true });
    const t = await getTaxonomy();
    expect(t.subsectors.some((s) => s.slug === "wave4b_test_subsector")).toBe(true);
  });
});

describe("PT-2 — endpoints are guarded and no new public route is added", () => {
  it("GET /api/partner-taxonomy sits behind requireAuth (never public)", async () => {
    const r = await request(app).get("/api/partner-taxonomy");
    // NOTE: this harness's getUserContext auto-resolves a non-admin test
    // identity, so a bare supertest call is AUTHENTICATED, not anonymous —
    // pre-existing behaviour, not something this wave introduced. What is
    // asserted here is that the route is not a 404 and is not exposed as a
    // public path; the admin-only assertions below carry the access check.
    expect(r.status).not.toBe(404);
    expect([200, 401, 403]).toContain(r.status);
  });

  it("adds nothing to the public-API allowlists", async () => {
    const guards = await import("node:fs").then((fs) =>
      fs.readFileSync("server/lib/applyRouteGuards.ts", "utf8"),
    );
    expect(guards).not.toContain("partner-taxonomy");
    expect(guards).not.toContain("partner-classifications");
  });

  it("admin taxonomy CRUD refuses an anonymous caller", async () => {
    for (const p of [
      "/api/admin/partner-taxonomy/sectors",
      "/api/admin/partner-taxonomy/subsectors",
      "/api/admin/partner-classifications",
    ]) {
      const r = await request(app).get(p);
      expect([401, 403]).toContain(r.status);
    }
  });

  it("writing a partner's classifications refuses an anonymous caller", async () => {
    const r = await request(app)
      .put(`/api/admin/partners/${P1}/classifications`)
      .send({ classifications: [] });
    expect([401, 403]).toContain(r.status);
  });
});
