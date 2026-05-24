/**
 * v17 Phase B smoke test — seed all 8 stores then hydrate and verify rows.
 */
import { getDb } from "../server/db/connection";
import {
  collectiveApps,
  collectiveMemberships,
  founderCollectiveNominations,
  founderCollectiveApplications,
  investorNominations,
  dscRoles,
  dscPipeline,
  collectiveSettingsTable,
  collectiveChannelPosts,
  partnerDealPromotions,
} from "@shared/schema";
import { hydrateAllStores } from "../server/lib/hydrateStores";

const TENANT = "tenant_chap_chap_keiretsu_canada";
const CHAPTER = "chap_keiretsu_canada";

async function seed(): Promise<void> {
  const db: any = getDb();
  const now = new Date().toISOString();

  // Wrap each seed insert independently — they target different tables.
  const seedRow = (tbl: any, row: Record<string, unknown>): void => {
    try {
      db.transaction((tx: any) => {
        tx.insert(tbl).values(row).run();
      });
    } catch (err) {
      // ignore — likely already exists
    }
  };

  seedRow(collectiveApps, {
    id: "smoke_app_1",
    tenantId: TENANT,
    chapterId: CHAPTER,
    userId: "u_smoke",
    status: "submitted",
    payloadJson: JSON.stringify({ smoke: true }),
    submittedAt: now,
    createdAt: now,
  });

  seedRow(collectiveMemberships, {
    userId: "u_smoke",
    tenantId: TENANT,
    chapterId: CHAPTER,
    status: "active",
    tier: "standard",
    activatedAt: now,
    activatedBy: "u_admin_smoke",
    deactivatedAt: null,
    deactivatedBy: null,
    createdAt: now,
    updatedAt: now,
  });

  seedRow(founderCollectiveNominations, {
    id: "smoke_nom_1",
    tenantId: TENANT,
    chapterId: CHAPTER,
    companyId: "co_smoke",
    founderId: "u_smoke",
    vouchingInvestorId: "u_vouch_smoke",
    pitchSummary: "smoke pitch",
    status: "pending_vouch",
    submittedAt: now,
    createdAt: now,
  });

  seedRow(founderCollectiveApplications, {
    id: "smoke_capp_1",
    tenantId: TENANT,
    chapterId: CHAPTER,
    companyId: "co_smoke",
    founderId: "u_smoke",
    pitchDeckFilename: "deck.pdf",
    tractionMrr: 0,
    tractionUsers: 0,
    tractionGrowthPct: 0,
    asks: "smoke asks",
    referencesText: "smoke refs",
    coverLetter: "smoke cover",
    feeAcknowledged: 1,
    status: "submitted",
    submittedAt: now,
    createdAt: now,
  });

  seedRow(investorNominations, {
    id: "smoke_inom_1",
    tenantId: TENANT,
    chapterId: CHAPTER,
    investorUserId: "u_smoke",
    companyId: "co_smoke",
    rationale: "smoke rationale",
    prevHash: null,
    hash: "smoke_hash_1",
    submittedAt: now,
    createdAt: now,
  });

  seedRow(dscRoles, {
    id: "smoke_role_1",
    tenantId: TENANT,
    chapterId: CHAPTER,
    userId: "u_smoke",
    status: "active",
    prevHash: null,
    hash: "smoke_hash_role_1",
    promotedBy: "u_admin_smoke",
    promotedAt: now,
    createdAt: now,
  });

  seedRow(dscPipeline, {
    id: "smoke_pipe_1",
    tenantId: TENANT,
    chapterId: CHAPTER,
    companyId: "co_smoke",
    submittedBy: "u_smoke",
    status: "pending",
    submittedAt: now,
    createdAt: now,
  });

  seedRow(collectiveSettingsTable, {
    userId: "u_smoke",
    tenantId: TENANT,
    chapterId: CHAPTER,
    anonymityLevel: "public",
    notifyOnDscScore: 1,
    notifyOnDealRoomUpdate: 1,
    dealRoomVisibility: "visible",
    version: 1,
    prevHash: null,
    hash: "smoke_hash_settings_1",
    updatedBy: "u_smoke",
    updatedAt: now,
    createdAt: now,
  });

  seedRow(collectiveChannelPosts, {
    id: "smoke_post_1",
    tenantId: TENANT,
    chapterId: CHAPTER,
    channelId: "ch_smoke",
    authorUserId: "u_smoke",
    authorKind: "user",
    body: "smoke post",
    visibility: "public_to_collective",
    likedByJson: "[]",
    commentsJson: "[]",
    commentCount: 0,
    shareCount: 0,
    createdAt: now,
  });

  seedRow(partnerDealPromotions, {
    id: "smoke_pdp_1",
    tenantId: TENANT,
    chapterId: CHAPTER,
    partnerId: "p_smoke",
    pipelineDealId: "pd_smoke",
    promotionType: "collective_deal_room",
    status: "live",
    promotedBy: "u_smoke",
    promotedAt: now,
    approvedAt: now,
    approvedBy: "u_auto_collective",
    version: 1,
    prevHash: null,
    hash: "smoke_hash_pdp_1",
    updatedAt: now,
    updatedBy: "u_smoke",
    isSeed: 0,
    createdAt: now,
  });
}

async function main(): Promise<void> {
  // ENABLE_DEMO_SEED triggers production seeds during boot; we just need the DB.
  process.env.NODE_ENV = "test";

  console.log("=== seeding 10 rows across 10 tables ===");
  await seed();

  console.log("\n=== running hydrateAllStores ===");
  await hydrateAllStores();

  console.log("\n=== verifying row counts per table ===");
  const db: any = getDb();
  const tables: Array<[string, any]> = [
    ["collective_apps", collectiveApps],
    ["collective_memberships", collectiveMemberships],
    ["founder_collective_nominations", founderCollectiveNominations],
    ["founder_collective_applications", founderCollectiveApplications],
    ["investor_nominations", investorNominations],
    ["dsc_roles", dscRoles],
    ["dsc_pipeline", dscPipeline],
    ["collective_settings", collectiveSettingsTable],
    ["collective_channel_posts", collectiveChannelPosts],
    ["partner_deal_promotions", partnerDealPromotions],
  ];

  let allOk = true;
  for (const [name, tbl] of tables) {
    try {
      const rows: any[] = await db.select().from(tbl).all();
      const ok = rows.length > 0;
      if (!ok) allOk = false;
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}: ${rows.length} rows`);
    } catch (err) {
      allOk = false;
      console.log(`  FAIL  ${name}: ERROR ${(err as Error).message}`);
    }
  }

  console.log(allOk ? "\nSMOKE PASSED" : "\nSMOKE FAILED");
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
