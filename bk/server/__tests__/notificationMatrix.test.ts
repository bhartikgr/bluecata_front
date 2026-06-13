/**
 * CP Phase C — notificationMatrix.test.ts (CP-035/036/037)
 *
 * Verifies the cross-platform notification fanout:
 *
 *   Trigger                                Recipients
 *   ─────────────────────────────────────── ────────────────────────────────────────
 *   Promotion moderation: approve          partner team + promoter + all chapter members
 *   Promotion moderation: reject           partner team + promoter (NO chapter fanout)
 *   Promotion moderation: request-changes  partner team + promoter (NO chapter fanout)
 *
 * The test exercises the real HTTP route (POST /api/admin/partner/promotions/:id/{approve,reject,request-changes})
 * and asserts the resulting in-app notifications via listNotifications().
 *
 * Notes:
 *   - The partner workspace sandbox seeds two team members
 *     (managing + viewer). Both are partner-team active.
 *   - The chapter we fan out to is DEFAULT_CHAPTER_ID (chap_keiretsu_canada);
 *     we seed a couple of synthetic chapter members so the assert is real.
 *   - We use kind="cap_table.broadcast" — the closest existing NotificationKind
 *     in the union; v20 may add a dedicated partner-moderation kind.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";

import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPromotionModerationRoutes } from "../promotionModerationRoutes";
import {
  partnerDealPromotionsStore,
  partnerPipelineStore,
  seedTestPartnerSandbox,
  _testPartnerStore,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { listNotifications } from "../notificationsStore";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import {
  chapterMemberships as chapterMembershipsTable,
} from "@shared/schema";

const PARTNER_A = TEST_PARTNER_ID;
const MANAGING = TEST_PARTNER_USERS.managing.userId;     // u_avi_managing
const VIEWER = TEST_PARTNER_USERS.viewer.userId;         // u_avi_viewer

const CHAPTER_ID = "chap_keiretsu_canada";
const TENANT_ID = "tenant_chap_chap_keiretsu_canada";

const CHAPTER_MEMBER_A = "u_notif_chap_a";
const CHAPTER_MEMBER_B = "u_notif_chap_b";

let app: express.Express;

function nowIso(): string {
  return new Date().toISOString();
}

function ensureChapterMembership(
  userId: string,
  chapterId: string,
  tenantId: string,
): void {
  const db: any = getDb();
  const existing = db
    .select({ id: (chapterMembershipsTable as any).id })
    .from(chapterMembershipsTable)
    .where(
      and(
        eq((chapterMembershipsTable as any).userId, userId),
        eq((chapterMembershipsTable as any).chapterId, chapterId),
      ),
    )
    .all() as any[];
  if (existing.length > 0) return;
  db.insert(chapterMembershipsTable)
    .values({
      id: `chmem_notif_${userId}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      chapterId,
      userId,
      role: "member",
      status: "active",
      joinedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    } as any)
    .run();
}

function freshPromotion() {
  const deal = partnerPipelineStore.create(
    PARTNER_A,
    {
      dealName: `Notif Matrix ${Date.now()}-${Math.random()}`,
      ownerUserId: MANAGING,
      sector: "fintech",
      estCheckSizeMinor: 25_000_00,
      currency: "USD",
    },
    MANAGING,
  );
  return partnerDealPromotionsStore.create(
    PARTNER_A,
    deal.id,
    {
      promotionType: "collective_deal_room",
      notes: "Matrix smoke",
    },
    MANAGING,
  );
}

beforeAll(async () => {
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();

  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  registerPartnerRoutes(app);
  registerPromotionModerationRoutes(app);

  _testPartnerStore.reset();
  seedTestPartnerSandbox({ force: true });

  ensureChapterMembership(CHAPTER_MEMBER_A, CHAPTER_ID, TENANT_ID);
  ensureChapterMembership(CHAPTER_MEMBER_B, CHAPTER_ID, TENANT_ID);
});

function countNotifs(userId: string, predicate?: (n: any) => boolean): number {
  const all = listNotifications(userId);
  return predicate ? all.filter(predicate).length : all.length;
}

describe("CP-035/036/037 — promotion moderation notification fanout", () => {
  it("approve fans out to partner team + promoter + ALL active chapter members", async () => {
    const p = freshPromotion();

    const beforeManaging = countNotifs(MANAGING);
    const beforeViewer = countNotifs(VIEWER);
    const beforeChapA = countNotifs(CHAPTER_MEMBER_A);
    const beforeChapB = countNotifs(CHAPTER_MEMBER_B);

    const r = await request(app)
      .post(`/api/admin/partner/promotions/${p.id}/approve`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ notes: "Looks good." });
    expect(r.status).toBe(200);

    // Partner team — both managing AND viewer must receive a notif.
    // (The promoter is MANAGING in this seed, so they get counted via the
    // promoter path, but the team-fan-out should also reach VIEWER.)
    expect(countNotifs(MANAGING)).toBeGreaterThan(beforeManaging);
    expect(countNotifs(VIEWER)).toBeGreaterThan(beforeViewer);

    // Chapter members fan-out — both should have received at least one notif.
    expect(countNotifs(CHAPTER_MEMBER_A)).toBeGreaterThan(beforeChapA);
    expect(countNotifs(CHAPTER_MEMBER_B)).toBeGreaterThan(beforeChapB);
  });

  it("reject fans out to partner team + promoter, but NOT to chapter members", async () => {
    const p = freshPromotion();

    const beforeManaging = countNotifs(MANAGING);
    const beforeViewer = countNotifs(VIEWER);
    const beforeChapA = countNotifs(CHAPTER_MEMBER_A);

    const r = await request(app)
      .post(`/api/admin/partner/promotions/${p.id}/reject`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ notes: "Out of scope." });
    expect(r.status).toBe(200);

    expect(countNotifs(MANAGING)).toBeGreaterThan(beforeManaging);
    expect(countNotifs(VIEWER)).toBeGreaterThan(beforeViewer);

    // No new chapter fan-out for reject.
    expect(countNotifs(CHAPTER_MEMBER_A)).toBe(beforeChapA);
  });

  it("request-changes fans out to partner team + promoter, but NOT to chapter members", async () => {
    const p = freshPromotion();

    const beforeManaging = countNotifs(MANAGING);
    const beforeViewer = countNotifs(VIEWER);
    const beforeChapA = countNotifs(CHAPTER_MEMBER_A);

    const r = await request(app)
      .post(`/api/admin/partner/promotions/${p.id}/request-changes`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ notes: "Please provide financials." });
    expect(r.status).toBe(200);

    expect(countNotifs(MANAGING)).toBeGreaterThan(beforeManaging);
    expect(countNotifs(VIEWER)).toBeGreaterThan(beforeViewer);

    expect(countNotifs(CHAPTER_MEMBER_A)).toBe(beforeChapA);
  });

  it("partner notification carries kind='cap_table.broadcast' and an actionable link", async () => {
    const p = freshPromotion();
    const before = listNotifications(MANAGING).length;

    await request(app)
      .post(`/api/admin/partner/promotions/${p.id}/approve`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ notes: "ok" });

    const after = listNotifications(MANAGING);
    expect(after.length).toBeGreaterThan(before);
    // The most-recent notification (store.unshift puts new ones at head).
    const newest = after[0];
    expect(newest.kind).toBe("cap_table.broadcast");
    expect(typeof newest.title).toBe("string");
    expect(newest.title.length).toBeGreaterThan(0);
    expect(typeof newest.link).toBe("string");
  });

  it("chapter-member notification points to the Deal Room (link contains 'dealroom')", async () => {
    const p = freshPromotion();
    const before = listNotifications(CHAPTER_MEMBER_A).length;

    await request(app)
      .post(`/api/admin/partner/promotions/${p.id}/approve`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ notes: "ok" });

    const after = listNotifications(CHAPTER_MEMBER_A);
    expect(after.length).toBeGreaterThan(before);
    const newest = after[0];
    expect(String(newest.link ?? "")).toMatch(/dealroom/i);
  });
});
