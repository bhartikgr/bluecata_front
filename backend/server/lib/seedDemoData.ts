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
} from "../../shared/schema";

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
] as const;

/** User rows. users.tenantId is the user's DEFAULT home tenant. */
const DEMO_USERS = [
  { id: "u_maya_chen",     tenantId: "tenant_co_co_novapay",  email: "maya@novapay.example",   name: "Maya Chen",     role: "founder"  },
  { id: "u_aisha_patel",   tenantId: "tenant_cp_keiretsu_ca", email: "aisha@hydra.example",    name: "Aisha Patel",   role: "investor" },
  { id: "u_daniel_okafor", tenantId: "tenant_co_co_novapay",  email: "daniel@novapay.example", name: "Daniel Okafor", role: "founder"  },
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
}> {
  const now = NOW();
  let tenantsInserted = 0;
  let usersInserted = 0;
  let companiesInserted = 0;
  let membersInserted = 0;
  let userPrefsInserted = 0;

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

  return {
    tenantsInserted,
    usersInserted,
    companiesInserted,
    membersInserted,
    userPrefsInserted,
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
});
