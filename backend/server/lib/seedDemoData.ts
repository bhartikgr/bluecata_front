/**
 * Capavate v12 — seedDemoData.ts
 *
 * Idempotent demo-data seeder. Reads no in-memory mocks; instead, uses real
 * Drizzle inserts against the same `getDb()` connection the runtime stores
 * hydrate from.
 *
 * Personas seeded (every row carries `is_demo = 1`):
 *
 *   Tenants:
 *     - t_maya_chen          kind=founder
 *     - t_aisha_patel        kind=investor
 *     - t_daniel_okafor      kind=founder
 *     - t_novapay            kind=company        (NovaPay AI)
 *     - t_arboreal           kind=company        (Arboreal Health)
 *     - t_kelvin             kind=company        (Kelvin Energy)
 *     - t_keiretsu_canada    kind=consortium_partner
 *
 *   Users:
 *     - u_maya_chen     -> t_maya_chen     (founder, primary demo user)
 *     - u_aisha_patel   -> t_aisha_patel   (investor)
 *     - u_daniel_okafor -> t_daniel_okafor (founder, co-founder of NovaPay)
 *
 *   Companies:
 *     - co_novapay      tenantId=t_novapay
 *     - co_arboreal     tenantId=t_arboreal
 *     - co_kelvin       tenantId=t_kelvin
 *
 *   companyMembers (founder seats):
 *     - cm_demo_maya_novapay   u_maya_chen     @ co_novapay       (founder)
 *     - cm_demo_maya_arboreal  u_maya_chen     @ co_arboreal      (co_founder)
 *     - cm_demo_maya_kelvin    u_maya_chen     @ co_kelvin        (founder)
 *     - cm_demo_daniel_novapay u_daniel_okafor @ co_novapay       (co_founder)
 *     - cm_demo_aisha_keiretsu u_aisha_patel   (no companyId; consortium) (partner_member)
 *
 *   userPrefs:
 *     - u_maya_chen     -> activeTenantId = t_novapay
 *     - u_aisha_patel   -> activeTenantId = t_keiretsu_canada
 *     - u_daniel_okafor -> activeTenantId = t_novapay
 *
 * Every insert uses `onConflictDoNothing` so re-running on a populated db is
 * safe. This file is wired into server/index.ts behind the DEMO_SEED_ENABLED
 * gate (NODE_ENV !== "production" && ENABLE_DEMO_SEED === "1").
 *
 * No in-memory writes, no /tmp fallback, no mock wiring. Real Drizzle only.
 */

import type { getDb as GetDbFn } from "../db/connection";
import {
  tenants,
  users,
  userPrefs,
  companies,
  companyMembers,
  chapters,
  chapterMemberships,
  chapterAnnouncements,
  chapterResources,
  chapterLeaderboardSnapshots,
} from "../../shared/schema";
import { createHash } from "node:crypto";
import { spvFundStore } from "../spvFundStore";
import { storeCredential } from "../userCredentialsStore";
// 23-May Fix 7 — partner seed helpers (Consortium Partner login demo persona)
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { partnerTeamStore } from "../partnerWorkspaceStore";
import { log, errorMeta } from "./logger";

type Db = ReturnType<typeof GetDbFn>;

const NOW = () => new Date().toISOString();

// Patch v12 — Multi-tenant identity model.
//
// Founder Ozan's spec: "Tenant = a company OR a consortium-partner. NOT a user."
// A user can have memberships across many tenants (Sarah is founder of Acme,
// founder of Beta, AND investor in Gamma). Hassan is lead of KF Canada AND
// founder of his own startup.
//
// Therefore:
//   - Tenant kinds are ONLY 'company' and 'consortium_partner'.
//   - Tenant IDs follow the canonical pattern 'tenant_co_<companyId>' for
//     companies (matches the backfill migration 0003 so seed + backfill
//     converge to a single tenant per company) and 'tenant_cp_<partnerId>'
//     for consortium partners.
//   - users.tenantId is the user's DEFAULT home tenant (the one they see
//     when they log in). It can change as they switch tenants.
//   - The active tenant per user is stored in user_prefs.activeTenantId.

/** Tenant rows — ONLY companies and consortium-partners are tenants. */
const DEMO_TENANTS = [
  { id: "tenant_co_co_novapay",  name: "NovaPay AI",            kind: "company",            billingEmail: "billing@novapay.example"       },
  { id: "tenant_co_co_arboreal", name: "Arboreal Health",       kind: "company",            billingEmail: "billing@arboreal.example"      },
  { id: "tenant_co_co_kelvin",   name: "Kelvin Energy",         kind: "company",            billingEmail: "billing@kelvin.example"        },
  { id: "tenant_cp_keiretsu_ca", name: "Keiretsu Forum Canada", kind: "consortium_partner", billingEmail: "ops@keiretsu-canada.example"   },
  /* 23-May Fix 1 — Platform admin tenant.
   * The static PERSONA u_admin (server/lib/userContext.ts) has been around
   * since Sprint 15 but never had a DB-backed tenant + user + credential. As
   * a result, the /admin/login form's email/password path never worked: the
   * credential lookup returned null. We seed a real users + user_credentials
   * row here so login resolves through Path 2 (verifyPassword) and grants
   * isAdmin: true via getDbUserRole(). */
  { id: "tenant_admin_capavate", name: "Capavate Platform Admin", kind: "company",            billingEmail: "ops@capavate.io"               },
] as const;

/** User rows. users.tenantId is the user's DEFAULT home tenant. */
const DEMO_USERS = [
  { id: "u_maya_chen",     tenantId: "tenant_co_co_novapay",  email: "maya@novapay.example",   name: "Maya Chen",     role: "founder"  },
  { id: "u_aisha_patel",   tenantId: "tenant_cp_keiretsu_ca", email: "aisha@hydra.example",    name: "Aisha Patel",   role: "investor" },
  { id: "u_daniel_okafor", tenantId: "tenant_co_co_novapay",  email: "daniel@novapay.example", name: "Daniel Okafor", role: "founder"  },
  /* v18 Phase D — designated chapter admins for the three non-keiretsu demo chapters. */
  { id: "u_chadmin_toronto", tenantId: "tenant_chap_chap_toronto", email: "admin-toronto@capavate.example", name: "Rita Cho",         role: "investor" },
  { id: "u_chadmin_nyc",     tenantId: "tenant_chap_chap_nyc",     email: "admin-nyc@capavate.example",     name: "Sam Ortega",       role: "investor" },
  { id: "u_chadmin_sf",      tenantId: "tenant_chap_chap_sf",      email: "admin-sf@capavate.example",      name: "Priya Raghavan",   role: "investor" },
  /* 23-May Fix 1 — Platform admin user. role='admin' is the signal
   * verifyPassword() reads via getDbUserRole() to set ctx.isAdmin = true.
   * Credentials are seeded separately via storeCredential() below. */
  { id: "u_admin",           tenantId: "tenant_admin_capavate",    email: "admin@capavate.io",              name: "Platform Admin",   role: "admin"    },
  /* 23-May Fix 7 — Consortium Partner demo persona. Used by the dedicated
   * /partner/login front door (see client/src/pages/partner/PartnerLogin.tsx).
   * The partner_team_members binding + AdminContact (consortium_partner) row
   * are seeded separately below via _registerSeedPartner + partnerTeamStore.add. */
  /* users.role is the documented enum "founder" | "investor" | "admin" (see
   * shared/schema.ts line 50). The partner-ness comes from the
   * partner_team_members binding seeded below — NOT from users.role — which
   * is the same model Aisha Patel uses. */
  { id: "u_partner_keiretsu", tenantId: "tenant_cp_keiretsu_ca",    email: "partner@keiretsu.ca",            name: "Hassan Tanaka",     role: "investor" },
] as const;

/** Company rows. Each in its own tenant_co_<id> tenant. */
const DEMO_COMPANIES = [
  { id: "co_novapay",  tenantId: "tenant_co_co_novapay",  name: "NovaPay AI",      legalName: "NovaPay AI, Inc.",              sector: "Fintech / AI Payments", stage: "Seed",     hq: "San Francisco, CA" },
  { id: "co_arboreal", tenantId: "tenant_co_co_arboreal", name: "Arboreal Health", legalName: "Arboreal Health Sciences Ltd.", sector: "Digital Health",      stage: "Pre-Seed", hq: "Boston, MA"        },
  { id: "co_kelvin",   tenantId: "tenant_co_co_kelvin",   name: "Kelvin Energy",   legalName: "Kelvin Energy, Inc.",           sector: "Climate Tech",          stage: "Pre-Seed", hq: "Austin, TX"        },
] as const;

/** Membership seats. tenantId is what scopes the membership; companyId or
 *  consortiumPartnerId backfills the legacy column. */
const DEMO_MEMBERS = [
  { id: "cm_demo_maya_novapay",    companyId: "co_novapay",  userId: "u_maya_chen",     role: "founder",        title: "CEO & Co-founder",   tenantId: "tenant_co_co_novapay",  consortiumPartnerId: null                          },
  { id: "cm_demo_maya_arboreal",   companyId: "co_arboreal", userId: "u_maya_chen",     role: "co_founder",     title: "Co-founder",         tenantId: "tenant_co_co_arboreal", consortiumPartnerId: null                          },
  { id: "cm_demo_maya_kelvin",     companyId: "co_kelvin",   userId: "u_maya_chen",     role: "founder",        title: "Founder",            tenantId: "tenant_co_co_kelvin",   consortiumPartnerId: null                          },
  { id: "cm_demo_daniel_novapay",  companyId: "co_novapay",  userId: "u_daniel_okafor", role: "co_founder",     title: "CTO & Co-founder",   tenantId: "tenant_co_co_novapay",  consortiumPartnerId: null                          },
  { id: "cm_demo_aisha_keiretsu",  companyId: null,          userId: "u_aisha_patel",   role: "partner_member", title: "Investor Member",    tenantId: "tenant_cp_keiretsu_ca", consortiumPartnerId: "tenant_cp_keiretsu_ca"      },
] as const;

/** Per-user active-tenant preferences (which tenant the user lands in on login). */
const DEMO_USER_PREFS = [
  { userId: "u_maya_chen",     activeTenantId: "tenant_co_co_novapay"  },
  { userId: "u_aisha_patel",   activeTenantId: "tenant_cp_keiretsu_ca" },
  { userId: "u_daniel_okafor", activeTenantId: "tenant_co_co_novapay"  },
] as const;

/**
 * v17 Phase A — Demo chapters.
 *
 * Per V19_BUILD_BRIEF.md §v17 Phase A: 4 demo chapters seeded with
 * `chap_keiretsu_canada` as the default (Maya/Aisha/Daniel belong here
 * for continuity with the v16 seed). Each chapter is its own tenant
 * (`tenant_chap_<id>`) for top-level isolation via withTenant().
 *
 * The default chapter row is ALSO inserted by the inline-backfill in
 * server/db/connection.ts::applyV12Backfill (so legacy non-demo deployments
 * with pre-existing Collective rows have a valid backfill target). Both
 * paths use the same id, so onConflictDoNothing makes them converge.
 */
const DEMO_CHAPTER_TENANTS = [
  { id: "tenant_chap_chap_keiretsu_canada", name: "Capavate Collective — Keiretsu Forum Canada", kind: "consortium_partner", billingEmail: null },
  { id: "tenant_chap_chap_toronto",         name: "Capavate Collective — Toronto",              kind: "consortium_partner", billingEmail: null },
  { id: "tenant_chap_chap_nyc",             name: "Capavate Collective — New York City",        kind: "consortium_partner", billingEmail: null },
  { id: "tenant_chap_chap_sf",              name: "Capavate Collective — San Francisco",        kind: "consortium_partner", billingEmail: null },
] as const;

const DEMO_CHAPTERS = [
  { id: "chap_keiretsu_canada", tenantId: "tenant_chap_chap_keiretsu_canada", name: "Capavate Collective — Keiretsu Forum Canada", region: "NA-East", city: "Toronto",       partnerOrgId: "tenant_cp_keiretsu_ca" },
  { id: "chap_toronto",         tenantId: "tenant_chap_chap_toronto",         name: "Capavate Collective — Toronto",              region: "NA-East", city: "Toronto",       partnerOrgId: null                     },
  { id: "chap_nyc",             tenantId: "tenant_chap_chap_nyc",             name: "Capavate Collective — New York City",        region: "NA-East", city: "New York",      partnerOrgId: null                     },
  { id: "chap_sf",              tenantId: "tenant_chap_chap_sf",              name: "Capavate Collective — San Francisco",        region: "NA-West", city: "San Francisco", partnerOrgId: null                     },
] as const;

/**
 * Default chapter memberships for the canonical demo personas.
 * Maya/Aisha/Daniel all start in chap_keiretsu_canada (continuity with v16).
 */
const DEMO_CHAPTER_MEMBERSHIPS = [
  { id: "chmem_maya_keiretsu",    chapterId: "chap_keiretsu_canada", tenantId: "tenant_chap_chap_keiretsu_canada", userId: "u_maya_chen",     role: "member" },
  { id: "chmem_aisha_keiretsu",   chapterId: "chap_keiretsu_canada", tenantId: "tenant_chap_chap_keiretsu_canada", userId: "u_aisha_patel",   role: "admin"  },
  { id: "chmem_daniel_keiretsu",  chapterId: "chap_keiretsu_canada", tenantId: "tenant_chap_chap_keiretsu_canada", userId: "u_daniel_okafor", role: "member" },
  /* v18 Phase D — one designated chapter_admin per remaining demo chapter. */
  { id: "chmem_chadmin_toronto", chapterId: "chap_toronto", tenantId: "tenant_chap_chap_toronto", userId: "u_chadmin_toronto", role: "admin" },
  { id: "chmem_chadmin_nyc",     chapterId: "chap_nyc",     tenantId: "tenant_chap_chap_nyc",     userId: "u_chadmin_nyc",     role: "admin" },
  { id: "chmem_chadmin_sf",      chapterId: "chap_sf",      tenantId: "tenant_chap_chap_sf",      userId: "u_chadmin_sf",      role: "admin" },
] as const;

/**
 * Seed all demo personas + companies + memberships + prefs.
 *
 * Idempotent: every insert uses `onConflictDoNothing` on the primary key.
 * Re-runs are no-ops. Returns a summary suitable for boot-log output.
 *
 * Caller is responsible for the demo gate; this function does NOT consult
 * DEMO_SEED_ENABLED. (server/index.ts gates the call.)
 */
export async function seedDemoData(db: Db): Promise<{
  tenantsInserted: number;
  usersInserted: number;
  companiesInserted: number;
  membersInserted: number;
  userPrefsInserted: number;
  chaptersInserted: number;
  chapterMembershipsInserted: number;
  announcementsInserted: number;
  resourcesInserted: number;
  leaderboardSnapshotsInserted: number;
}> {
  const now = NOW();
  let tenantsInserted = 0;
  let usersInserted = 0;
  let companiesInserted = 0;
  let membersInserted = 0;
  let userPrefsInserted = 0;
  let chaptersInserted = 0;
  let chapterMembershipsInserted = 0;
  let announcementsInserted = 0;
  let resourcesInserted = 0;
  let leaderboardSnapshotsInserted = 0;

  // ---- tenants ----
  for (const t of DEMO_TENANTS) {
    const res: any = await db
      .insert(tenants)
      .values({
        id: t.id,
        name: t.name,
        kind: t.kind,
        billingEmail: t.billingEmail,
        status: "active",
        isDemo: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .onConflictDoNothing({ target: tenants.id });
    if (typeof res?.changes === "number") tenantsInserted += res.changes;
    else if (typeof res?.rowCount === "number") tenantsInserted += res.rowCount;
  }

  // ---- users ----
  for (const u of DEMO_USERS) {
    const res: any = await db
      .insert(users)
      .values({
        id: u.id,
        tenantId: u.tenantId,
        email: u.email,
        name: u.name,
        role: u.role,
        avatarUrl: null,
        isDemo: 1,
        deletedAt: null,
      })
      .onConflictDoNothing({ target: users.id });
    if (typeof res?.changes === "number") usersInserted += res.changes;
    else if (typeof res?.rowCount === "number") usersInserted += res.rowCount;
  }

  // ---- companies ----
  for (const c of DEMO_COMPANIES) {
    const res: any = await db
      .insert(companies)
      .values({
        id: c.id,
        tenantId: c.tenantId,
        name: c.name,
        legalName: c.legalName,
        sector: c.sector,
        stage: c.stage,
        hq: c.hq,
        websiteUrl: null,
        description: null,
        logoUrl: null,
        founded: null,
        employees: null,
        isDemo: 1,
        deletedAt: null,
      })
      .onConflictDoNothing({ target: companies.id });
    if (typeof res?.changes === "number") companiesInserted += res.changes;
    else if (typeof res?.rowCount === "number") companiesInserted += res.rowCount;
  }

  // ---- companyMembers ----
  for (const m of DEMO_MEMBERS) {
    const res: any = await db
      .insert(companyMembers)
      .values({
        id: m.id,
        companyId: m.companyId,
        userId: m.userId,
        role: m.role,
        title: m.title,
        tenantId: m.tenantId,
        consortiumPartnerId: m.consortiumPartnerId,
        isActive: 1,
        joinedAt: now,
        lastActiveAt: now,
        deletedAt: null,
      })
      .onConflictDoNothing({ target: companyMembers.id });
    if (typeof res?.changes === "number") membersInserted += res.changes;
    else if (typeof res?.rowCount === "number") membersInserted += res.rowCount;
  }

  // ---- userPrefs ----
  for (const p of DEMO_USER_PREFS) {
    const res: any = await db
      .insert(userPrefs)
      .values({
        userId: p.userId,
        activeTenantId: p.activeTenantId,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: userPrefs.userId });
    if (typeof res?.changes === "number") userPrefsInserted += res.changes;
    else if (typeof res?.rowCount === "number") userPrefsInserted += res.rowCount;
  }

  // ---- v17 Phase A: chapter tenants (one tenant per chapter) ----
  // CROSS-TENANT (admin) — justified because seedDemoData writes across
  // multiple tenants in one boot pass (matches the rest of this file).
  for (const t of DEMO_CHAPTER_TENANTS) {
    const res: any = await db
      .insert(tenants)
      .values({
        id: t.id,
        name: t.name,
        kind: t.kind,
        billingEmail: t.billingEmail,
        status: "active",
        isDemo: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .onConflictDoNothing({ target: tenants.id });
    if (typeof res?.changes === "number") tenantsInserted += res.changes;
    else if (typeof res?.rowCount === "number") tenantsInserted += res.rowCount;
  }

  // ---- v17 Phase A: chapters ----
  for (const c of DEMO_CHAPTERS) {
    const res: any = await db
      .insert(chapters)
      .values({
        id: c.id,
        tenantId: c.tenantId,
        name: c.name,
        region: c.region,
        city: c.city,
        status: "active",
        adminUserId: null,
        partnerOrgId: c.partnerOrgId,
        membershipFeeAnnualMinor: 0,
        founded: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .onConflictDoNothing({ target: chapters.id });
    if (typeof res?.changes === "number") chaptersInserted += res.changes;
    else if (typeof res?.rowCount === "number") chaptersInserted += res.rowCount;
  }

  // ---- v17 Phase A: chapter memberships (Maya/Aisha/Daniel → chap_keiretsu_canada) ----
  for (const m of DEMO_CHAPTER_MEMBERSHIPS) {
    const res: any = await db
      .insert(chapterMemberships)
      .values({
        id: m.id,
        tenantId: m.tenantId,
        chapterId: m.chapterId,
        userId: m.userId,
        role: m.role,
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .onConflictDoNothing({ target: chapterMemberships.id });
    if (typeof res?.changes === "number") chapterMembershipsInserted += res.changes;
    else if (typeof res?.rowCount === "number") chapterMembershipsInserted += res.rowCount;
  }

  // ---- v19 Phase A: chapter announcements / resources / leaderboard ----
  // Seed for every chapter so per-chapter UIs have data on cold boot.
  // Hash chain is per (chapter, row); each row uses a deterministic
  // sha256 over (prev_hash, payload-as-JSON) — same algorithm as the
  // store at server/chapterAnnouncementsStore.ts.
  const chainHash = (prev: string | null, payload: Record<string, unknown>): string => {
    const h = createHash("sha256");
    h.update(prev ?? "GENESIS");
    h.update("|");
    h.update(JSON.stringify(payload));
    return h.digest("hex");
  };

  /* ----- Announcements ------------------------------------------ */
  // chap_keiretsu_canada: 1 pinned, 1 expired (in the past), 1 high-priority
  // active. Other 3 demo chapters: ≥1 active announcement each.
  const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const expiredAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

  const DEMO_ANNOUNCEMENTS = [
    {
      id: "anc_seed_kf_pinned",
      tenantId: "tenant_chap_chap_keiretsu_canada",
      chapterId: "chap_keiretsu_canada",
      authorUserId: "u_aisha_patel",
      title: "Welcome to the Keiretsu Forum Canada chapter",
      body: "Pinned post — bookmark this page. Our monthly screening calendar, partner network resources, and chapter governance docs all live in the Resources Library.",
      pinned: 1,
      priority: "normal",
      audience: "all",
      expiresAt: null,
      createdAt: past,
    },
    {
      id: "anc_seed_kf_expired",
      tenantId: "tenant_chap_chap_keiretsu_canada",
      chapterId: "chap_keiretsu_canada",
      authorUserId: "u_aisha_patel",
      title: "RSVP closing soon — March pitch night",
      body: "This announcement is intentionally expired in the demo seed to validate the expiry filter on the list endpoint.",
      pinned: 0,
      priority: "normal",
      audience: "members",
      expiresAt: expiredAt,
      createdAt: past,
    },
    {
      id: "anc_seed_kf_urgent",
      tenantId: "tenant_chap_chap_keiretsu_canada",
      chapterId: "chap_keiretsu_canada",
      authorUserId: "u_aisha_patel",
      title: "Reminder: Q2 LP capital call due May 31",
      body: "All Premium-tier members with active SPV commitments should review the capital call schedule in the SPV admin console. Reach out to the chapter admins with any questions.",
      pinned: 0,
      priority: "high",
      audience: "members",
      expiresAt: futureExpiry,
      createdAt: now,
    },
    {
      id: "anc_seed_toronto",
      tenantId: "tenant_chap_chap_toronto",
      chapterId: "chap_toronto",
      authorUserId: "u_chadmin_toronto",
      title: "Toronto chapter launches expert Q&A circle",
      body: "We're opening a peer-driven Q&A surface for Toronto chapter members. Reputation tracking is now live.",
      pinned: 1,
      priority: "normal",
      audience: "all",
      expiresAt: null,
      createdAt: now,
    },
    {
      id: "anc_seed_nyc",
      tenantId: "tenant_chap_chap_nyc",
      chapterId: "chap_nyc",
      authorUserId: "u_chadmin_nyc",
      title: "NYC chapter — May screening events lineup",
      body: "Five companies on the calendar for May. RSVP via the Events Calendar.",
      pinned: 0,
      priority: "normal",
      audience: "all",
      expiresAt: null,
      createdAt: now,
    },
    {
      id: "anc_seed_sf",
      tenantId: "tenant_chap_chap_sf",
      chapterId: "chap_sf",
      authorUserId: "u_chadmin_sf",
      title: "SF chapter — new resource library is live",
      body: "Templates for SAFEs, term sheets, and pro-rata side letters now in the Resources Library.",
      pinned: 0,
      priority: "normal",
      audience: "members",
      expiresAt: null,
      createdAt: now,
    },
  ] as const;

  for (const a of DEMO_ANNOUNCEMENTS) {
    const hash = chainHash(null, {
      id: a.id,
      tenantId: a.tenantId,
      chapterId: a.chapterId,
      authorUserId: a.authorUserId,
      title: a.title,
      action: "seed",
    });
    const res: any = await db
      .insert(chapterAnnouncements)
      .values({
        id: a.id,
        tenantId: a.tenantId,
        chapterId: a.chapterId,
        authorUserId: a.authorUserId,
        title: a.title,
        body: a.body,
        pinned: a.pinned,
        priority: a.priority,
        audience: a.audience,
        expiresAt: a.expiresAt,
        prevHash: null,
        currHash: hash,
        createdAt: a.createdAt,
        updatedAt: a.createdAt,
        deletedAt: null,
      })
      .onConflictDoNothing({ target: chapterAnnouncements.id });
    if (typeof res?.changes === "number") announcementsInserted += res.changes;
    else if (typeof res?.rowCount === "number") announcementsInserted += res.rowCount;
  }

  /* ----- Resources ---------------------------------------------- */
  const DEMO_RESOURCES = [
    {
      id: "res_seed_kf_safe_template",
      tenantId: "tenant_chap_chap_keiretsu_canada",
      chapterId: "chap_keiretsu_canada",
      uploaderUserId: "u_aisha_patel",
      title: "Standard SAFE template (post-money, 2024 edition)",
      description: "Y Combinator post-money SAFE annotated with Canadian PSE-jurisdiction notes from the chapter's legal partner.",
      resourceType: "template",
      url: "https://www.ycombinator.com/documents/post-money-safe-discount-only.docx",
      visibility: "members",
      status: "active",
      tags: ["safe", "templates", "legal"],
    },
    {
      id: "res_seed_kf_due_diligence",
      tenantId: "tenant_chap_chap_keiretsu_canada",
      chapterId: "chap_keiretsu_canada",
      uploaderUserId: "u_aisha_patel",
      title: "Due diligence checklist — seed / pre-seed",
      description: "Chapter-curated diligence checklist covering financial, legal, technical, and team risk dimensions.",
      resourceType: "document",
      url: "https://capavate.example/resources/dd-checklist.pdf",
      visibility: "members",
      status: "active",
      tags: ["due-diligence", "checklist"],
    },
    {
      id: "res_seed_kf_pending",
      tenantId: "tenant_chap_chap_keiretsu_canada",
      chapterId: "chap_keiretsu_canada",
      uploaderUserId: "u_maya_chen",
      title: "Founder fundraising playbook (member-submitted, pending review)",
      description: "A founder-perspective fundraising playbook submitted by Maya. Awaiting chapter-admin approval — demonstrates the moderation flow.",
      resourceType: "guide",
      url: "https://capavate.example/resources/founder-fundraising-playbook.pdf",
      visibility: "members",
      status: "pending",
      tags: ["fundraising", "founder"],
    },
    {
      id: "res_seed_toronto_workshop",
      tenantId: "tenant_chap_chap_toronto",
      chapterId: "chap_toronto",
      uploaderUserId: "u_chadmin_toronto",
      title: "Pitch workshop recording — March 2026",
      description: "Recording of the March Toronto chapter pitch workshop. 90 minutes covering deck structure and Q&A response patterns.",
      resourceType: "video",
      url: "https://capavate.example/recordings/toronto-pitch-workshop-2026-03.mp4",
      visibility: "members",
      status: "active",
      tags: ["workshop", "pitch"],
    },
    {
      id: "res_seed_nyc_term_sheet",
      tenantId: "tenant_chap_chap_nyc",
      chapterId: "chap_nyc",
      uploaderUserId: "u_chadmin_nyc",
      title: "NYC chapter standard term sheet",
      description: "NYC chapter standard term sheet template used in syndicated rounds led by the chapter.",
      resourceType: "template",
      url: "https://capavate.example/resources/nyc-term-sheet.docx",
      visibility: "members",
      status: "active",
      tags: ["term-sheet", "templates"],
    },
    {
      id: "res_seed_sf_blog_link",
      tenantId: "tenant_chap_chap_sf",
      chapterId: "chap_sf",
      uploaderUserId: "u_chadmin_sf",
      title: "Pro-rata mechanics — Fred Wilson, AVC",
      description: "External link to Fred Wilson's classic post on pro-rata mechanics for follow-on rounds.",
      resourceType: "link",
      url: "https://avc.com/2014/11/why-pro-rata-rights-matter/",
      visibility: "public",
      status: "active",
      tags: ["pro-rata", "theory"],
    },
  ] as const;

  for (const r of DEMO_RESOURCES) {
    const hash = chainHash(null, {
      id: r.id,
      tenantId: r.tenantId,
      chapterId: r.chapterId,
      uploaderUserId: r.uploaderUserId,
      title: r.title,
      url: r.url,
      status: r.status,
      action: "seed",
    });
    const res: any = await db
      .insert(chapterResources)
      .values({
        id: r.id,
        tenantId: r.tenantId,
        chapterId: r.chapterId,
        uploaderUserId: r.uploaderUserId,
        title: r.title,
        description: r.description,
        resourceType: r.resourceType,
        url: r.url,
        fileSizeBytes: null,
        mimeType: null,
        tags: JSON.stringify(r.tags),
        visibility: r.visibility,
        status: r.status,
        rejectionReason: null,
        flagReason: null,
        flaggedByUserId: null,
        flaggedAt: null,
        downloadCount: 0,
        prevHash: null,
        currHash: hash,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .onConflictDoNothing({ target: chapterResources.id });
    if (typeof res?.changes === "number") resourcesInserted += res.changes;
    else if (typeof res?.rowCount === "number") resourcesInserted += res.rowCount;
  }

  /* ----- Leaderboard initial snapshots --------------------------- */
  // One all-time snapshot per chapter so the LeaderboardPage renders
  // immediately on cold boot. Entries are empty placeholders — the
  // first GET against /api/collective/leaderboard recomputes from live
  // data inside a sync tx.
  const epoch = "1970-01-01T00:00:00.000Z";
  const DEMO_LEADERBOARD_CHAPTERS: ReadonlyArray<{ chapterId: string; tenantId: string }> = [
    { chapterId: "chap_keiretsu_canada", tenantId: "tenant_chap_chap_keiretsu_canada" },
    { chapterId: "chap_toronto",         tenantId: "tenant_chap_chap_toronto"         },
    { chapterId: "chap_nyc",             tenantId: "tenant_chap_chap_nyc"             },
    { chapterId: "chap_sf",              tenantId: "tenant_chap_chap_sf"              },
  ];
  for (const c of DEMO_LEADERBOARD_CHAPTERS) {
    const res: any = await db
      .insert(chapterLeaderboardSnapshots)
      .values({
        id: `lbs_seed_${c.chapterId}_all`,
        tenantId: c.tenantId,
        chapterId: c.chapterId,
        period: "all-time",
        periodStart: epoch,
        periodEnd: now,
        data: "[]",
        generatedAt: now,
      })
      .onConflictDoNothing({ target: chapterLeaderboardSnapshots.id });
    if (typeof res?.changes === "number") leaderboardSnapshotsInserted += res.changes;
    else if (typeof res?.rowCount === "number") leaderboardSnapshotsInserted += res.rowCount;
  }

  /* ----- CP Phase A — SPV demo seed ------------------------------
   * Seeds 1 SPV for each demo chapter that has a partner_org_id wired
   * up. In the v17/v19 demo dataset only `chap_keiretsu_canada` has
   * `partnerOrgId = tenant_cp_keiretsu_ca`; the other chapters
   * (chap_toronto / chap_nyc / chap_sf) carry `partnerOrgId: null`
   * (they are standalone Capavate Collective chapters with no external
   * partner organization). Those are skipped here so we don't fabricate
   * a partner record that isn't reflected anywhere else in the seed.
   *
   * Idempotent: skip if any SPV with the demo name already exists for
   * the partner. Best-effort: a failure here must not abort the rest
   * of the demo seed (logged via the structured logger).
   * --------------------------------------------------------------- */
  const DEMO_SPV_SEED: ReadonlyArray<{
    chapterId: string;
    partnerId: string;
    name: string;
    leadCompanyId: string | null;
    structureType: "spv" | "fund" | "syndicate";
    status: "forming" | "fundraising" | "active" | "wound_down";
    targetMinor: number;
    gpUserId: string | null;
    terms: Record<string, unknown>;
  }> = [
    {
      chapterId: "chap_keiretsu_canada",
      partnerId: "tenant_cp_keiretsu_ca",
      name: "Keiretsu Canada NovaPay SPV 2026",
      leadCompanyId: "co_novapay",
      structureType: "spv",
      status: "fundraising",
      // $250,000 CAD target (cents): 250_000 * 100
      targetMinor: 25_000_000,
      gpUserId: "u_aisha_patel",
      terms: {
        currency: "CAD",
        managementFeeBps: 200,    // 2.00%
        carryBps: 2000,           // 20.00%
        hurdleBps: 800,           // 8.00%
        jurisdiction: "Ontario, Canada",
      },
    },
  ];
  for (const seed of DEMO_SPV_SEED) {
    try {
      const existing = spvFundStore.listByPartner(seed.partnerId);
      if (existing.some((s) => s.name === seed.name)) continue;
      spvFundStore.createSpv({
        partnerId: seed.partnerId,
        name: seed.name,
        leadCompanyId: seed.leadCompanyId,
        structureType: seed.structureType,
        status: seed.status,
        targetMinor: seed.targetMinor,
        gpUserId: seed.gpUserId,
        terms: seed.terms,
      });
    } catch (e) {
      log.warn(errorMeta("seedDemoData.spvFund", e, {
        chapterId: seed.chapterId,
        partnerId: seed.partnerId,
        name: seed.name,
      }));
    }
  }

  /* ----------------------------------------------------------------
   * 23-May Fix 1 — Seed credentials for the platform admin demo user.
   *
   * The admin user row was inserted above (DEMO_USERS) with role='admin'.
   * storeCredential() persists a bcrypt-hashed password into the
   * user_credentials table (idempotent on userId) so that the
   * /api/auth/login → verifyPassword() Path 2 finds the credential, then
   * getDbUserRole(u_admin) returns 'admin', and the synthesized
   * RUNTIME_PERSONAS entry is created with isAdmin: true.
   *
   * Production note: this only runs when DEMO_SEED_ENABLED is true. Real
   * production admins are created via scripts/create_admin.ts.
   * ---------------------------------------------------------------- */
  try {
    storeCredential({
      userId: "u_admin",
      email: "admin@capavate.io",
      name: "Platform Admin",
      password: "adminpass",
    });
  } catch (e) {
    log.warn(errorMeta("seedDemoData.adminCredential", e, {
      userId: "u_admin",
      email: "admin@capavate.io",
    }));
  }

  /* ----------------------------------------------------------------
   * 23-May Fix 7 — Seed Consortium Partner demo persona end-to-end.
   *
   * To make /partner/login work for the demo user partner@keiretsu.ca,
   * three rows are required (the users row is already inserted above):
   *
   *   1. AdminContact (consortium_partner) record — the partner
   *      organization itself. Identified by id = tenant_cp_keiretsu_ca
   *      so requirePartnerAuth’s getContactById() lookup resolves.
   *      Seeded via _registerSeedPartner (test-only injector that
   *      bypasses the public createContact API to pin the id).
   *
   *   2. partner_team_members row binding u_partner_keiretsu →
   *      tenant_cp_keiretsu_ca with subRole=‘managing_partner’.
   *      This is what requirePartnerAuth.findByUserId() looks up.
   *
   *   3. user_credentials row for password sign-in. Mirrors the admin
   *      credential seed: storeCredential() persists a bcrypt hash so
   *      that verifyPassword()’s Path 2 hits on partner@keiretsu.ca.
   *
   * All three are idempotent on their primary key, so re-runs are no-ops.
   * ---------------------------------------------------------------- */
  try {
    _registerSeedPartner({
      id: "tenant_cp_keiretsu_ca",
      legalName: "Keiretsu Forum Canada, Inc.",
      displayName: "Keiretsu Forum Canada",
      email: "ops@keiretsu-canada.example",
      region: "CA",
      regionCode: "CA",
      tier: "builder",
      partnerType: "angel_network",
    });
  } catch (e) {
    log.warn(errorMeta("seedDemoData.partnerContact", e, {
      partnerId: "tenant_cp_keiretsu_ca",
    }));
  }
  try {
    partnerTeamStore.add(
      "tenant_cp_keiretsu_ca",
      "u_partner_keiretsu",
      "managing_partner",
      "u_system_seed",
      { isSeed: true },
    );
  } catch (e) {
    log.warn(errorMeta("seedDemoData.partnerTeamMember", e, {
      userId: "u_partner_keiretsu",
      partnerId: "tenant_cp_keiretsu_ca",
    }));
  }
  try {
    storeCredential({
      userId: "u_partner_keiretsu",
      email: "partner@keiretsu.ca",
      name: "Hassan Tanaka",
      password: "password123",
    });
  } catch (e) {
    log.warn(errorMeta("seedDemoData.partnerCredential", e, {
      userId: "u_partner_keiretsu",
      email: "partner@keiretsu.ca",
    }));
  }

  return {
    tenantsInserted,
    usersInserted,
    companiesInserted,
    membersInserted,
    userPrefsInserted,
    chaptersInserted,
    chapterMembershipsInserted,
    announcementsInserted,
    resourcesInserted,
    leaderboardSnapshotsInserted,
  };
}

/**
 * Test-only export of the seed catalog so unit tests can assert that the
 * canonical demo personas exist after a `seedDemoData()` call without having
 * to round-trip through the store APIs. Read-only / frozen.
 */
export const _demoSeedCatalog = Object.freeze({
  tenants: DEMO_TENANTS,
  users: DEMO_USERS,
  companies: DEMO_COMPANIES,
  members: DEMO_MEMBERS,
  userPrefs: DEMO_USER_PREFS,
  chapterTenants: DEMO_CHAPTER_TENANTS,
  chapters: DEMO_CHAPTERS,
  chapterMemberships: DEMO_CHAPTER_MEMBERSHIPS,
});
