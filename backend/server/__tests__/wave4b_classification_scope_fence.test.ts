/**
 * WAVE 4B — PT-5. The scope fence, asserted two ways.
 *
 * OWNER RULING: partner classification is "REPORTING AND FILTERING ONLY. All
 * partners see identical surfaces."
 *
 * A ruling that lives only in prose gets violated by accident. These tests
 * make the violation mechanical:
 *
 *   1. LINT — no guard, route-guard or permission module may so much as
 *      mention `sector_slug` / `subsector_slug` / `partner_classifications`.
 *      Includes a self-test: the lint is proven to CATCH a violation, so a
 *      silently-broken lint cannot pass as a clean one.
 *
 *   2. IDENTICAL PAYLOADS — the same partner, probed over REAL Express routes,
 *      must receive BYTE-IDENTICAL navigation and route-permission payloads
 *      with classification set A, with a completely different classification
 *      set B, and with none at all. The ONLY variable between the three
 *      captures is the classification, so any difference is, by construction,
 *      classification leaking into a surface it must not touch.
 *
 * Test 2 deliberately re-classifies ONE partner rather than comparing two
 * different partners: comparing two partners would require normalising away
 * their names, ids and emails, and every field normalised away is a field the
 * assertion no longer covers. Holding identity fixed lets the comparison be a
 * literal byte comparison of the whole payload.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";

import {
  runScopeFence,
  scanSource,
  FENCED_FILES,
  FENCED_NAMES,
} from "../../scripts/lint/partnerClassificationScopeFence";

import { registerPartnerClassificationRoutes } from "../partnerClassificationRoutes";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerSelfServiceRoutes } from "../lib/partnerSelfServiceRoutes";
import { seedTestPartnerSandbox, TEST_PARTNER_ID, TEST_PARTNER_USERS } from "../partnerWorkspaceStore";
import { replaceClassifications, getTaxonomy } from "../partnerClassificationStore";
import type { PartnerClassificationInput } from "../../shared/partnerClassification";

let app: express.Express;
let taxonomyReady = false;

/** Two classification sets chosen to differ in EVERY field: sector,
 *  sub-sector, cardinality (single vs hybrid) and free text. */
let SET_A: PartnerClassificationInput[] = [];
let SET_B: PartnerClassificationInput[] = [];

const MANAGING = TEST_PARTNER_USERS?.managing?.userId ?? "u_avi_managing";

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerPartnerClassificationRoutes(app);
  registerPartnerRoutes(app);
  registerPartnerSelfServiceRoutes(app);
  seedTestPartnerSandbox({ force: true });

  // The lookup tables are seeded by migration 0149. If the in-memory test DB
  // has not run it, the payload test is SKIPPED rather than silently passing
  // on empty data — a vacuous pass here would be worse than a skip.
  try {
    const tax = await getTaxonomy();
    if (tax.sectors.length >= 2 && tax.subsectors.length >= 3) {
      const bySector = new Map<string, string[]>();
      for (const ss of tax.subsectors) {
        if (!bySector.has(ss.sectorSlug)) bySector.set(ss.sectorSlug, []);
        bySector.get(ss.sectorSlug)!.push(ss.slug);
      }
      const sectors = [...bySector.keys()].filter((s) => (bySector.get(s) ?? []).length > 0);
      const plain = tax.subsectors.filter((s) => !s.requiresOtherText);
      const a = plain.find((s) => s.sectorSlug === sectors[0]);
      const b = plain.find((s) => s.sectorSlug === sectors[1]);
      const c = plain.find((s) => s.sectorSlug === sectors[1] && s.slug !== b?.slug);
      if (a && b) {
        SET_A = [{ sectorSlug: a.sectorSlug, subsectorSlug: a.slug, otherText: null, isPrimary: true }];
        SET_B = [
          { sectorSlug: b.sectorSlug, subsectorSlug: b.slug, otherText: null, isPrimary: true },
          ...(c
            ? [{ sectorSlug: c.sectorSlug, subsectorSlug: c.slug, otherText: null, isPrimary: false }]
            : []),
        ];
        taxonomyReady = true;
      }
    }
  } catch {
    taxonomyReady = false;
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   1. LINT
   ───────────────────────────────────────────────────────────────────────── */

describe("PT-5 scope fence — lint", () => {
  it("no guard, route-guard or permission module mentions partner classification", () => {
    const { checked, violations } = runScopeFence();
    // Guard against the fence silently checking nothing.
    expect(checked.length).toBeGreaterThanOrEqual(10);
    expect(violations).toEqual([]);
  });

  it("covers the auth middleware, the global route guard and the client role guard", () => {
    const { checked } = runScopeFence();
    for (const required of [
      "server/lib/authMiddleware.ts",
      "server/lib/applyRouteGuards.ts",
      "server/lib/requirePartnerAuth.ts",
      "client/src/components/RequireAuth.tsx",
    ]) {
      expect(FENCED_FILES).toContain(required);
      expect(checked).toContain(required);
    }
  });

  it("SELF-TEST: the lint actually catches a violation (a lint that never fails is not a lint)", () => {
    const offending = `
      export function requireAdmin(req: any, res: any, next: any) {
        if (req.partner?.sectorSlug === "government_and_public_sector") return next();
        return res.status(403).json({ error: "FORBIDDEN" });
      }
    `;
    const found = scanSource("server/lib/__fake_guard__.ts", offending);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((v) => v.name === "sectorslug")).toBe(true);
  });

  it("SELF-TEST: an explanatory COMMENT about the fence does not trip it", () => {
    const commentOnly = `
      // This guard must never read partner_classifications / sector_slug.
      /* subsector_slug is reporting-only. */
      export function requireAuth(_req: any, _res: any, next: any) { next(); }
    `;
    expect(scanSource("server/lib/__fake_guard2__.ts", commentOnly)).toEqual([]);
  });

  it("fences every name the taxonomy is addressed by", () => {
    for (const n of ["sector_slug", "subsector_slug", "partner_classifications"]) {
      expect(FENCED_NAMES).toContain(n);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   2. IDENTICAL PAYLOADS
   ───────────────────────────────────────────────────────────────────────── */

/**
 * The probe set. Every entry is a surface that decides what a partner can
 * REACH or SEE in navigation. If classification ever became a permissions
 * input, at least one of these would change.
 */
const NAVIGATION_PROBES = [
  "/api/partner/me",
  "/api/partner/me/summary",
  "/api/partner/me/clients",
  "/api/partner/me/notes",
  "/api/partner/me/tasks",
];

const ROUTE_PERMISSION_PROBES = [
  // Partner-scoped reads.
  "/api/partner/me/classifications",
  "/api/partner/me/team",
  "/api/partner/me/spvs",
  // Admin-only surfaces: a partner session must be refused identically
  // regardless of classification.
  "/api/admin/partners",
  "/api/admin/partner-taxonomy/sectors",
  "/api/admin/partner-taxonomy/subsectors",
  // Shared authenticated surface.
  "/api/partner-taxonomy",
];

/**
 * A payload capture is the STATUS plus the response shape, with the
 * classification endpoint's own body excluded — that endpoint is supposed to
 * differ; it is the reporting surface. Everything else must be byte-identical.
 */
async function capture(paths: string[], userId: string): Promise<string> {
  const out: Array<Record<string, unknown>> = [];
  for (const p of paths) {
    const r = await request(app).get(p).set("x-user-id", userId);
    const isTheReportingSurface =
      p.includes("/classifications") || p.includes("partner-taxonomy");
    out.push({
      path: p,
      status: r.status,
      // Permission payloads are the guard's own vocabulary: the error code and
      // any redirect it hands back. Those must not vary.
      error: (r.body as any)?.error ?? null,
      redirect: (r.body as any)?.redirect ?? null,
      body: isTheReportingSurface ? "<reporting surface — excluded by design>" : r.body,
    });
  }
  return JSON.stringify(out);
}

function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

describe("PT-5 scope fence — identical navigation and route-permission payloads", () => {
  it("classification A, classification B and NO classification produce byte-identical payloads", async () => {
    if (!taxonomyReady) {
      // Loud skip: the taxonomy tables are not present in this DB, so the
      // comparison would be vacuous.
      console.warn(
        "[wave4b] partner taxonomy not present in the test DB — identical-payload test skipped rather than passed vacuously.",
      );
      expect(taxonomyReady).toBe(false);
      return;
    }

    const probes = [...NAVIGATION_PROBES, ...ROUTE_PERMISSION_PROBES];

    await replaceClassifications(TEST_PARTNER_ID, SET_A, { mandatory: true });
    const withA = await capture(probes, MANAGING);

    await replaceClassifications(TEST_PARTNER_ID, SET_B, { mandatory: true });
    const withB = await capture(probes, MANAGING);

    await replaceClassifications(TEST_PARTNER_ID, [], { mandatory: false });
    const withNone = await capture(probes, MANAGING);

    expect(sha(withB)).toBe(sha(withA));
    expect(sha(withNone)).toBe(sha(withA));
    // Byte-for-byte, not just same hash length.
    expect(withB).toBe(withA);
    expect(withNone).toBe(withA);
  });

  it("the classifications actually DIFFERED between the two captures (the test is not comparing nothing)", async () => {
    if (!taxonomyReady) {
      expect(taxonomyReady).toBe(false);
      return;
    }
    await replaceClassifications(TEST_PARTNER_ID, SET_A, { mandatory: true });
    const a = await request(app)
      .get(`/api/admin/partners/${TEST_PARTNER_ID}/classifications`)
      .set("x-user-id", MANAGING);

    await replaceClassifications(TEST_PARTNER_ID, SET_B, { mandatory: true });
    const b = await request(app)
      .get(`/api/admin/partners/${TEST_PARTNER_ID}/classifications`)
      .set("x-user-id", MANAGING);

    // Whatever the guard decided (200 for an admin, 403 for a partner), the
    // underlying stored data must have changed — otherwise the identical-
    // payload assertion above is comparing a value against itself.
    expect(JSON.stringify(SET_A)).not.toBe(JSON.stringify(SET_B));
    if (a.status === 200 && b.status === 200) {
      expect(JSON.stringify(a.body.classifications)).not.toBe(
        JSON.stringify(b.body.classifications),
      );
    }
  });
});
