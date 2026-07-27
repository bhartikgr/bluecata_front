/**
 * w-partner F9-B — a promotion reaching status 'live' must enrol the company
 * in the collective directory.
 *
 * ANTI-VACUITY: `ensurePromotionDirectoryListing` does not exist on the
 * pre-wave tree, so this suite cannot pass against baseline. The no-overwrite
 * assertion is the one that matters most: it is the guard that separates this
 * helper from `upsertDirectoryListing`, which DOES clobber.
 *
 * NO MONEY: directory rows only. No Airwallex, funding, or soft-circle calls,
 * and no moderation approvals are performed against live data.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { ensurePromotionDirectoryListing } from "../collectiveInterestStore";
import { registerPromotionModerationRoutes } from "../promotionModerationRoutes";
import {
  partnerDealPromotionsStore,
  partnerPipelineStore,
  seedTestPartnerSandbox,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { installV14TestIdentity } from "./_v14TestIdentity";

const CO_NEW = "co_wpf9b_unlisted";
const CO_EXISTING = "co_wpf9b_already_listed";

function db(): any {
  return rawDb();
}

beforeAll(async () => {
  await seedDemoData(getDb());
});

afterEach(() => {
  db()
    .prepare(`DELETE FROM collective_directory_listings WHERE company_id IN (?, ?)`)
    .run(CO_NEW, CO_EXISTING);
});

describe("w-partner F9-B — ensurePromotionDirectoryListing", () => {
  it("CREATES a listed row for a company that has none (the money assertion)", () => {
    const before = db()
      .prepare(`SELECT id FROM collective_directory_listings WHERE company_id = ?`)
      .get(CO_NEW);
    expect(before).toBeFalsy();

    const outcome = ensurePromotionDirectoryListing(CO_NEW, "pdp_wpf9b_1", "ch_default");
    expect(outcome).toBe("created");

    const row = db()
      .prepare(`SELECT * FROM collective_directory_listings WHERE company_id = ?`)
      .get(CO_NEW) as Record<string, any>;
    expect(row).toBeTruthy();
    expect(row.status).toBe("listed");
    expect(row.application_id).toBe("promo_pdp_wpf9b_1");
    expect(row.chapter).toBe("ch_default");
  });

  it("NO-OVERWRITE GUARD: an existing row is returned untouched, byte for byte", () => {
    db()
      .prepare(
        `INSERT INTO collective_directory_listings
           (id, company_id, application_id, chapter, stage, sector, listed_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'listed')`,
      )
      .run(
        "cdl_wpf9b_pre",
        CO_EXISTING,
        "app_from_founder_flow",
        "ch_founder",
        "series_a",
        "fintech",
        "2026-01-01T00:00:00.000Z",
      );

    const outcome = ensurePromotionDirectoryListing(CO_EXISTING, "pdp_wpf9b_2", "ch_promotion");
    expect(outcome).toBe("exists");

    const row = db()
      .prepare(`SELECT * FROM collective_directory_listings WHERE company_id = ?`)
      .get(CO_EXISTING) as Record<string, any>;
    // The richer founder-application row must survive verbatim; the promotion
    // must NOT downgrade application_id / chapter / stage / sector.
    expect(row.id).toBe("cdl_wpf9b_pre");
    expect(row.application_id).toBe("app_from_founder_flow");
    expect(row.chapter).toBe("ch_founder");
    expect(row.stage).toBe("series_a");
    expect(row.sector).toBe("fintech");
    expect(row.listed_at).toBe("2026-01-01T00:00:00.000Z");

    // And exactly one row — the guard returns, it does not also insert.
    const count = db()
      .prepare(`SELECT COUNT(*) AS n FROM collective_directory_listings WHERE company_id = ?`)
      .get(CO_EXISTING) as { n: number };
    expect(count.n).toBe(1);
  });

  it("is idempotent — a second call on the same company is a no-op", () => {
    expect(ensurePromotionDirectoryListing(CO_NEW, "pdp_wpf9b_3", "ch_default")).toBe("created");
    expect(ensurePromotionDirectoryListing(CO_NEW, "pdp_wpf9b_3", "ch_default")).toBe("exists");
    const count = db()
      .prepare(`SELECT COUNT(*) AS n FROM collective_directory_listings WHERE company_id = ?`)
      .get(CO_NEW) as { n: number };
    expect(count.n).toBe(1);
  });
});

/**
 * ROUTE WIRING (review finding L2) + the PROMOTION'S CHAPTER (review finding M1).
 *
 * Everything above tests the helper in isolation, so deleting the call in
 * promotionModerationRoutes entirely would leave the suite green — the enrolment
 * could silently stop happening. These tests drive the real admin approve route.
 *
 * M1: the call site passed DEFAULT_CHAPTER_ID rather than the promotion's own
 * chapterId. The two coincide today (create stamps DEFAULT_CHAPTER_ID), which is
 * why nothing caught it — so the promotion is moved to a non-default chapter
 * first, which is the only configuration that can tell the two apart. This
 * matters because the no-overwrite guard makes a wrong chapter PERMANENT: no
 * later call can correct it.
 *
 * ANTI-VACUITY: the assertion is on `chapter`, and it is a chapter that
 * DEFAULT_CHAPTER_ID is not. Against the pre-fix call site the row is created
 * with "ch_default" and the test fails.
 */
describe("w-partner F9-B — approve route enrols under the PROMOTION's chapter", () => {
  const ALT_CHAPTER = "ch_wpf9b_alt_chapter";
  const CO_ROUTE = "co_wpf9b_route_wired";
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    installV14TestIdentity(app, { defaultIdentity: true });
    registerPromotionModerationRoutes(app);
    seedTestPartnerSandbox({ force: true });
  });

  afterEach(() => {
    db().prepare(`DELETE FROM collective_directory_listings WHERE company_id = ?`).run(CO_ROUTE);
  });

  function livePromotionInAltChapter(): { id: string } {
    const deal = partnerPipelineStore.create(
      TEST_PARTNER_ID,
      {
        dealName: `F9B Route Deal ${Date.now()}-${Math.random()}`,
        ownerUserId: TEST_PARTNER_USERS.managing.userId,
        sector: "fintech",
        estCheckSizeMinor: 10_000_00,
        currency: "USD",
      },
      TEST_PARTNER_USERS.managing.userId,
    );
    const promo = partnerDealPromotionsStore.create(
      TEST_PARTNER_ID,
      deal.id,
      { promotionType: "collective_deal_room", notes: "F9B route wiring" },
      TEST_PARTNER_USERS.managing.userId,
    );
    /* Per-promotion chapter selection has not shipped from the UI yet, so create
       always stamps DEFAULT_CHAPTER_ID. The store keeps RAM as the source of
       truth and applyModeration spreads the live row, so setting the field here
       is how a non-default chapter is reachable at all today — and without it
       this test cannot distinguish the fix from the bug. companyId must also be
       set: the route only enrols when `updated.companyId` is truthy. */
    promo.chapterId = ALT_CHAPTER;
    promo.companyId = CO_ROUTE;
    return promo;
  }

  it("creates the directory row on approve, filed under the promotion's chapter", async () => {
    const promo = livePromotionInAltChapter();
    expect(
      db().prepare(`SELECT id FROM collective_directory_listings WHERE company_id = ?`).get(CO_ROUTE),
    ).toBeFalsy();

    const r = await request(app)
      .post(`/api/admin/partner/promotions/${promo.id}/approve`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ notes: "F9B wiring" });
    expect(r.status).toBe(200);
    expect(r.body.promotion.status).toBe("live");

    // L2 — proves the route actually calls the helper; deleting the wiring fails here.
    const row = db()
      .prepare(`SELECT * FROM collective_directory_listings WHERE company_id = ?`)
      .get(CO_ROUTE) as Record<string, any>;
    expect(row).toBeTruthy();
    expect(row.status).toBe("listed");
    expect(row.application_id).toBe(`promo_${promo.id}`);

    // M1 — the promotion's own chapter, NOT the global default.
    expect(row.chapter).toBe(ALT_CHAPTER);
    expect(row.chapter).not.toBe("ch_default");
  });

  it("does NOT enrol a promotion that is rejected rather than approved", async () => {
    const promo = livePromotionInAltChapter();

    const r = await request(app)
      .post(`/api/admin/partner/promotions/${promo.id}/reject`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ notes: "not a fit" });
    expect(r.status).toBe(200);
    expect(r.body.promotion.status).not.toBe("live");

    // The enrolment is gated on status === 'live'; a blanket call would fail here.
    expect(
      db().prepare(`SELECT id FROM collective_directory_listings WHERE company_id = ?`).get(CO_ROUTE),
    ).toBeFalsy();
  });
});
