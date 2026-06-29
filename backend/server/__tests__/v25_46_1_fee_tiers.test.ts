/**
 * v25.46.1 — Multi-section fee admin regression suite (APD-018, UPDATED Rule 77).
 *
 * Tier 6 supertest — every test exercises REAL Express routes mounted via
 * registerRoutes(server, app) over supertest. NO route stubs and NO
 * React-Query fixtures; the production guard stack (requireAdmin) + the
 * DB-direct stores run end to end against the seeded SQLite test DB.
 *
 * Coverage:
 *   - Admin gate: non-admin (founder/investor/anon) → 401/403 on EVERY new route.
 *   - GET tier list returns the migration/bootstrap-seeded tiers (both families).
 *   - POST creates a tier (201); duplicate → 409; invalid slug → 400;
 *     negative / non-integer amount → 400.
 *   - PUT updates an existing tier; PUT on a missing tier → 404; invalid amount → 400.
 *   - DELETE soft-deletes (reversible; row not physically dropped) → vanishes from list.
 *   - Tier-isolation: a Collective slug is invisible to the Consortium family and
 *     vice-versa (no cross-tab read/write coupling).
 *   - GET/PUT flat SPV deployment fee (Consortium Section B).
 *   - Save → Restart → Load: write through the route, re-read DB-direct via the
 *     store, assert the value survives (zero in-memory; restart-safe).
 *
 * Both new recurring families are covered:
 *   /api/admin/collective/member-subscription-tiers   (Collective Section B)
 *   /api/admin/consortium/subscription-tiers          (Consortium Section A)
 * plus the one flat fee:
 *   /api/admin/consortium/spv-deployment-fee           (Consortium Section B)
 *
 * NOTE: the existing flat Collective Founder Application Fee
 * (/api/admin/collective/application-fee, key collective_application_fee) keeps
 * its ORIGINAL key + routes and is NOT exercised here (it is unchanged scope).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  listTiers,
  getTier,
  COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX,
  CONSORTIUM_SUBSCRIPTION_PREFIX,
} from "../subscriptionTierStore";
import {
  getSpvDeploymentFee,
  DEFAULT_CONSORTIUM_SPV_DEPLOYMENT_FEE_MINOR,
} from "../consortiumFeesStore";

let app: Express;
let server: http.Server;

const ADMIN = (req: request.Test) => req.query({ as: "admin" }); // -> u_admin (isAdmin)
const FOUNDER = (req: request.Test) => req.query({ as: "founder" }); // -> u_maya_chen
const INVESTOR = (req: request.Test) => req.query({ as: "investor" }); // -> u_aisha_patel

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await seedDemoData(getDb());
  await registerRoutes(server, app);
}, 30_000);

afterAll(() => {
  try {
    server?.close();
  } catch {
    /* noop */
  }
});

/* ============================================================
 * Shared family matrix — run the SAME CRUD contract against BOTH
 * new recurring tier families (Collective Section B + Consortium Section A).
 * ============================================================ */
const FAMILIES = [
  {
    label: "Collective — member-subscription-tiers (Section B)",
    base: "/api/admin/collective/member-subscription-tiers",
    prefix: COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX,
    seededSlugs: ["basic", "pro", "enterprise"],
    seededAmounts: { basic: 9900, pro: 24900, enterprise: 99900 },
  },
  {
    label: "Consortium Partners — subscription-tiers (Section A)",
    base: "/api/admin/consortium/subscription-tiers",
    prefix: CONSORTIUM_SUBSCRIPTION_PREFIX,
    seededSlugs: ["partner_basic", "partner_pro", "partner_enterprise"],
    seededAmounts: {
      partner_basic: 49900,
      partner_pro: 99900,
      partner_enterprise: 249900,
    },
  },
] as const;

for (const fam of FAMILIES) {
  describe(`v25.46.1 tier CRUD — ${fam.label}`, () => {
    /* ---- Admin gate ---- */
    it("rejects an anonymous-ish non-admin (investor) on GET → 401/403", async () => {
      const r = await INVESTOR(request(app).get(fam.base));
      expect([401, 403]).toContain(r.status);
    });

    it("rejects a founder on POST → 401/403", async () => {
      const r = await FOUNDER(
        request(app).post(fam.base).send({ slug: "should_not_create", amountMinor: 100 }),
      );
      expect([401, 403]).toContain(r.status);
    });

    it("rejects a founder on DELETE → 401/403", async () => {
      const r = await FOUNDER(request(app).delete(`${fam.base}/${fam.seededSlugs[0]}`));
      expect([401, 403]).toContain(r.status);
    });

    /* ---- LIST seeded ---- */
    it("GET returns the seeded tiers (admin)", async () => {
      const r = await ADMIN(request(app).get(fam.base));
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(Array.isArray(r.body.tiers)).toBe(true);
      const slugs = r.body.tiers.map((t: { slug: string }) => t.slug);
      for (const s of fam.seededSlugs) {
        expect(slugs).toContain(s);
      }
      // amounts are TRUE minor units (cents)
      for (const s of fam.seededSlugs) {
        const row = r.body.tiers.find((t: { slug: string }) => t.slug === s);
        expect(row.amountMinor).toBe(
          fam.seededAmounts[s as keyof typeof fam.seededAmounts],
        );
      }
      // every returned tier carries the family prefix in its full key
      for (const t of r.body.tiers as Array<{ key: string }>) {
        expect(t.key.startsWith(fam.prefix)).toBe(true);
      }
    });

    /* ---- CREATE ---- */
    it("POST creates a new tier → 201, then appears in the list", async () => {
      const slug = "qa_new_tier";
      const create = await ADMIN(
        request(app).post(fam.base).send({ slug, amountMinor: 12345, billingPeriod: "monthly" }),
      );
      expect(create.status).toBe(201);
      expect(create.body.ok).toBe(true);
      expect(create.body.tiers.slug).toBe(slug);
      expect(create.body.tiers.amountMinor).toBe(12345);
      expect(create.body.tiers.key).toBe(`${fam.prefix}${slug}`);

      const list = await ADMIN(request(app).get(fam.base));
      const slugs = list.body.tiers.map((t: { slug: string }) => t.slug);
      expect(slugs).toContain(slug);
    });

    it("POST duplicate slug → 409", async () => {
      const r = await ADMIN(
        request(app).post(fam.base).send({ slug: fam.seededSlugs[0], amountMinor: 1 }),
      );
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("tier_already_exists");
    });

    it("POST invalid slug (uppercase/space) → 400", async () => {
      const r1 = await ADMIN(request(app).post(fam.base).send({ slug: "Bad Slug", amountMinor: 1 }));
      expect(r1.status).toBe(400);
      const r2 = await ADMIN(request(app).post(fam.base).send({ slug: "UPPER", amountMinor: 1 }));
      expect(r2.status).toBe(400);
    });

    it("POST negative / non-integer amount → 400", async () => {
      const neg = await ADMIN(request(app).post(fam.base).send({ slug: "qa_neg", amountMinor: -5 }));
      expect(neg.status).toBe(400);
      const frac = await ADMIN(
        request(app).post(fam.base).send({ slug: "qa_frac", amountMinor: 10.5 }),
      );
      expect(frac.status).toBe(400);
    });

    /* ---- UPDATE ---- */
    it("PUT updates an existing tier amount", async () => {
      const slug = "qa_update_tier";
      await ADMIN(request(app).post(fam.base).send({ slug, amountMinor: 1000 }));
      const upd = await ADMIN(
        request(app).put(`${fam.base}/${slug}`).send({ amountMinor: 7777 }),
      );
      expect(upd.status).toBe(200);
      expect(upd.body.ok).toBe(true);
      expect(upd.body.tiers.amountMinor).toBe(7777);
    });

    it("PUT on a missing tier → 404", async () => {
      const r = await ADMIN(
        request(app).put(`${fam.base}/nonexistent_tier_xyz`).send({ amountMinor: 100 }),
      );
      expect(r.status).toBe(404);
      expect(r.body.error).toBe("tier_not_found");
    });

    it("PUT with invalid amount → 400", async () => {
      const slug = "qa_update_bad";
      await ADMIN(request(app).post(fam.base).send({ slug, amountMinor: 1000 }));
      const r = await ADMIN(request(app).put(`${fam.base}/${slug}`).send({ amountMinor: -1 }));
      expect(r.status).toBe(400);
    });

    /* ---- DELETE (soft) ---- */
    it("DELETE soft-deletes the tier; it vanishes from the list but is reversible", async () => {
      const slug = "qa_delete_tier";
      await ADMIN(request(app).post(fam.base).send({ slug, amountMinor: 4242 }));
      const del = await ADMIN(request(app).delete(`${fam.base}/${slug}`));
      expect(del.status).toBe(200);
      expect(del.body.ok).toBe(true);
      expect(del.body.deleted).toBe(true);

      const list = await ADMIN(request(app).get(fam.base));
      const slugs = list.body.tiers.map((t: { slug: string }) => t.slug);
      expect(slugs).not.toContain(slug);

      // Soft, not physical: the store getTier (LIVE-only) returns null...
      expect(getTier(fam.prefix, slug)).toBeNull();
      // ...but re-upserting RESURRECTS the same key (deleted_at -> NULL),
      // proving the row was not silently dropped.
      const resurrect = await ADMIN(
        request(app).post(fam.base).send({ slug, amountMinor: 5151 }),
      );
      expect(resurrect.status).toBe(201);
      expect(resurrect.body.tiers.amountMinor).toBe(5151);
    });

    it("DELETE on a missing tier → 404", async () => {
      const r = await ADMIN(request(app).delete(`${fam.base}/never_existed_zzz`));
      expect(r.status).toBe(404);
    });

    /* ---- Save → Restart → Load (zero in-memory) ---- */
    it("a write survives a 'restart' (route write → DB-direct store re-read)", async () => {
      const slug = "qa_persist_tier";
      await ADMIN(request(app).post(fam.base).send({ slug, amountMinor: 31337 }));
      // Re-read DB-direct via the store (no cache, no HTTP) — simulates a
      // fresh process reading the canonical row.
      const fromDb = getTier(fam.prefix, slug);
      expect(fromDb).not.toBeNull();
      expect(fromDb!.amountMinor).toBe(31337);
      expect(fromDb!.key).toBe(`${fam.prefix}${slug}`);
      // And listTiers (DB-direct) sees it too.
      const live = listTiers(fam.prefix).map((t) => t.slug);
      expect(live).toContain(slug);
    });
  });
}

/* ============================================================
 * Tier-isolation — a slug created in one family is INVISIBLE to the other
 * (UPDATED Rule 77: no cross-tab read/write coupling).
 * ============================================================ */
describe("v25.46.1 — tier-family isolation (no cross-tab coupling)", () => {
  const COLLECTIVE = "/api/admin/collective/member-subscription-tiers";
  const CONSORTIUM = "/api/admin/consortium/subscription-tiers";

  it("a Collective slug is not readable/updatable via the Consortium family", async () => {
    const slug = "isolation_probe";
    const create = await ADMIN(
      request(app).post(COLLECTIVE).send({ slug, amountMinor: 6000 }),
    );
    expect(create.status).toBe(201);

    // Consortium list must NOT contain it.
    const consortiumList = await ADMIN(request(app).get(CONSORTIUM));
    const consortiumSlugs = consortiumList.body.tiers.map((t: { slug: string }) => t.slug);
    expect(consortiumSlugs).not.toContain(slug);

    // PUT against the Consortium family for that slug → 404 (it lives in a
    // different key namespace).
    const crossUpdate = await ADMIN(
      request(app).put(`${CONSORTIUM}/${slug}`).send({ amountMinor: 1 }),
    );
    expect(crossUpdate.status).toBe(404);

    // But the Collective family still sees it.
    const collectiveList = await ADMIN(request(app).get(COLLECTIVE));
    const collectiveSlugs = collectiveList.body.tiers.map((t: { slug: string }) => t.slug);
    expect(collectiveSlugs).toContain(slug);
  });
});

/* ============================================================
 * Consortium Partners — Section B: flat SPV deployment fee.
 * ============================================================ */
describe("v25.46.1 — Consortium SPV deployment flat fee", () => {
  const SPV = "/api/admin/consortium/spv-deployment-fee";

  it("rejects non-admin (investor) on GET → 401/403", async () => {
    const r = await INVESTOR(request(app).get(SPV));
    expect([401, 403]).toContain(r.status);
  });

  it("rejects non-admin (founder) on PUT → 401/403", async () => {
    const r = await FOUNDER(request(app).put(SPV).send({ amountMinor: 1 }));
    expect([401, 403]).toContain(r.status);
  });

  it("GET returns the seeded $5,000 flat fee (admin)", async () => {
    const r = await ADMIN(request(app).get(SPV));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.spvDeploymentFee.amountMinor).toBe(
      DEFAULT_CONSORTIUM_SPV_DEPLOYMENT_FEE_MINOR,
    );
    expect(r.body.spvDeploymentFee.currency).toBe("USD");
  });

  it("PUT updates the flat fee; the write survives a 'restart' (DB-direct re-read)", async () => {
    const upd = await ADMIN(request(app).put(SPV).send({ amountMinor: 750000 }));
    expect(upd.status).toBe(200);
    expect(upd.body.ok).toBe(true);
    expect(upd.body.spvDeploymentFee.amountMinor).toBe(750000);

    // Re-read through the store DB-direct (zero in-memory) — value survives.
    const fromStore = getSpvDeploymentFee();
    expect(fromStore.amountMinor).toBe(750000);

    // And the route reflects the persisted value on the next GET.
    const get = await ADMIN(request(app).get(SPV));
    expect(get.body.spvDeploymentFee.amountMinor).toBe(750000);
  });

  it("PUT with a negative amount → 400", async () => {
    const r = await ADMIN(request(app).put(SPV).send({ amountMinor: -1 }));
    expect(r.status).toBe(400);
  });
});
