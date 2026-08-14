#!/usr/bin/env node
/**
 * Wave B FIX 13 (C-BUG-001) — Production demo seed CLI.
 *
 * Writes the canonical Capavate demo users (founder Maya, investor Aisha,
 * founder Daniel, admin, partner_admin) directly into the production DB
 * (`users` + `user_credentials`), so QA / demo / investor walkthroughs
 * can sign in with `password123` even on builds that have
 * DEMO_SEED_ENABLED=0.
 *
 * Idempotent: re-running the script rotates passwords and re-asserts
 * roles. Safe to wire into the deployment runbook.
 *
 * Usage:
 *   npm run db:seed:demo
 *
 *   # Or directly:
 *   npx tsx scripts/seed_demo.ts
 *
 *   # Custom password (rare):
 *   npx tsx scripts/seed_demo.ts --password='S0meOtherP@ss'
 *
 * Writes:
 *   1. `users` row per demo user (idempotent on conflict on id)
 *   2. `user_credentials` row per demo user (bcrypt-hashed; rotates on conflict)
 *   3. `audit_log` row per user (action = 'demo.seeded') — WAVE 51 · ITEM 4:
 *      written ONLY through `appendAdminAudit()`, the canonical hash-chain
 *      writer. If that write fails, NO row is written and the refusal is
 *      counted and printed. This script never fabricates a `prev_hash`/`hash`
 *      pair. Before Wave 51 it wrote a 64-zero `prev_hash` with a foreign hash
 *      formula AND — because it used non-existent column names under an `as any`
 *      cast — silently wrote no row at all.
 *
 * Cross-tenant note: same rationale as scripts/create_admin.ts — identity
 * tables are global; admins are scoped to `tenant_admin_capavate` only for
 * audit traceability.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../server/db/connection";
import { users as usersTable } from "../shared/schema";
import { storeCredential } from "../server/userCredentialsStore";

/**
 * WAVE 51 · ITEM 4 — the tenant whose audit chain these seed rows extend.
 *
 * Named, because the value matters: this is the tenant that carried the live
 * `"boot verifier tick: chain broken at link 0 of 1"` incident, and it is the
 * only hardcoded tenant among the audit writers in `scripts/`. Rows are appended
 * to its chain through the canonical writer or not at all.
 */
const DEMO_SEED_TENANT_ID = "tenant_admin_capavate";

interface DemoUser {
  id: string;
  email: string;
  name: string;
  role: "founder" | "investor" | "admin" | "partner_admin";
  tenantId: string;
}

const DEMO_USERS: DemoUser[] = [
  { id: "u_maya_chen",      email: "maya@novapay.example",   name: "Maya Chen",      role: "founder",       tenantId: "tenant_co_novapay" },
  { id: "u_daniel_okafor",  email: "daniel@novapay.example", name: "Daniel Okafor",  role: "founder",       tenantId: "tenant_co_novapay" },
  { id: "u_aisha_patel",    email: "aisha@greenwood.capital", name: "Aisha Patel",   role: "investor",      tenantId: "tenant_inv_greenwood" },
  { id: "u_admin",          email: "admin@capavate.io",      name: "Capavate Admin", role: "admin",         tenantId: "tenant_admin_capavate" },
  { id: "u_partner_admin",  email: "partner@keiretsu.ca",    name: "Keiretsu Partner Admin", role: "partner_admin", tenantId: "tenant_partner_keiretsu_canada" },
];

function parseArgs(argv: string[]): { password: string } {
  let password = "password123";
  for (const a of argv) {
    if (a.startsWith("--password=")) password = a.slice("--password=".length);
  }
  return { password };
}

async function main() {
  const { password } = parseArgs(process.argv.slice(2));
  const db = getDb();
  /* WAVE 51 · ITEM 4 — the local `now` this function used to hold is gone with
   * the hand-rolled audit insert. `appendAdminAudit()` timestamps the row itself,
   * inside the same transaction that reads the chain tip, so the timestamp that
   * goes into the hash is the timestamp that is stored. A caller-supplied `now`
   * could disagree with it. */

  // v23.4.1 Task F — Production data guard.
  // Refuse to seed demo data if real (non-demo) users already exist.
  // This is defense-in-depth: even if ENABLE_DEMO_SEED is accidentally set
  // in a real environment, the seed will not pollute production data.
  // Callers must run 'npm run db:purge:demo' first if they truly want to reset.
  try {
    const realUsers = db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isDemo, 0))
      .all() as Array<{ id: string }>;
    if (realUsers.length > 0) {
      console.error(
        `[db:seed:demo] Refusing to seed — production data detected (${realUsers.length} non-demo user${realUsers.length === 1 ? "" : "s"}). Run db:purge:demo first if you really want to reset, or use a clean database.`,
      );
      process.exit(1);
    }
  } catch {
    // Table may not exist yet (fresh DB); proceed with seeding
  }

  let created = 0;
  let rotated = 0;
  /* WAVE 51 · ITEM 4 — audit outcomes are COUNTED and reported, so "it wrote
   * nothing" can never again be invisible. */
  let auditsAppended = 0;
  let auditsRefused = 0;

  for (const u of DEMO_USERS) {
    // 1. Upsert users row.
    try {
      const existing = db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, u.id))
        .all() as Array<{ id: string }>;

      if (existing.length === 0) {
        db.insert(usersTable)
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
          .run();
        created++;
      } else {
        // Make sure role + email are current.
        db.update(usersTable)
          .set({ email: u.email, name: u.name, role: u.role, deletedAt: null })
          .where(eq(usersTable.id, u.id))
          .run();
      }
    } catch (err) {
      console.error(`[seed_demo] users upsert failed for ${u.email}:`, (err as Error).message);
      continue;
    }

    // 2. Upsert credentials with bcrypt-hashed password (rotates on conflict).
    try {
      storeCredential({ userId: u.id, email: u.email, name: u.name, password });
      rotated++;
    } catch (err) {
      console.error(`[seed_demo] storeCredential failed for ${u.email}:`, (err as Error).message);
      continue;
    }

    /* ═════════════════════════════════════════════════════════════════════════
     * 3. AUDIT ROW — WAVE 51 · ITEM 4.
     * ═════════════════════════════════════════════════════════════════════════
     *
     * WHAT THIS BLOCK USED TO DO — TWO defects, one of which hid the other:
     *
     *     const prevHash = "0".repeat(64); // simplified; full chain handled by
     *                                      // appendAdminAudit at runtime
     *     const currHash = sha256(prevHash + JSON.stringify(audit) + now);
     *     db.insert(auditLogTable).values({
     *       tenantId: "tenant_admin_capavate",
     *       targetType: "user", payload: …, prevHash, currHash, …
     *     } as any).onConflictDoNothing().run();
     *     } catch { /* non-fatal; audit chain is informational here *\/ }
     *
     * (1) THE HASH WAS FABRICATED. `prev_hash` was pinned to 64 zeros — the
     *     GENESIS prior — for every row and every run, and the hash came from a
     *     formula (`sha256(prev + json + ts)`) that `verifyTenantAuditChain()`
     *     does not use. Its comment said the chain was "handled by
     *     appendAdminAudit at runtime"; appendAdminAudit does not revisit rows
     *     written by anyone else, and no reconciler exists. Into a tenant that
     *     already has history, such a row verifies as broken at the link it
     *     occupies — the mechanism behind the live
     *     `tenant_admin_capavate` incident, reproduced in
     *     build_log/wave51/W51_item4_diagnose_BEFORE.json.
     *
     * (2) IT ALSO NEVER WROTE ANYTHING, AND SAID NOTHING. `targetType`,
     *     `payload` and `currHash` are NOT columns of `shared/schema.ts:auditLog`
     *     — the columns are `target`, `payload_json` and `hash`, and `hash` is
     *     NOT NULL. The `as any` cast silenced the type error, drizzle dropped
     *     the unknown keys, SQLite raised
     *     `NOT NULL constraint failed: audit_log.hash`, and the bare `catch {}`
     *     swallowed it. MEASURED, not inferred: see probe `3b` in
     *     build_log/wave51/W51_item4_diagnose_BEFORE.json. So this seeder has
     *     silently audited nothing, while looking in review like a writer that
     *     needed only its field names corrected — which would have started
     *     landing broken rows immediately.
     *
     * THE FIX: the canonical writer, which computes `prev_hash` and `hash`
     * itself inside BEGIN IMMEDIATE from the tenant's real chain tip, or NO ROW
     * AT ALL with the failure stated. A seeder is not exempt: an unverifiable
     * row written by a seed script is indistinguishable from tampering to every
     * verifier that reads it afterwards. */
    try {
      const { appendAdminAudit } = await import("../server/adminPlatformStore");
      appendAdminAudit(
        "system:seed_demo",
        `user:${u.id}`,
        "demo.seeded",
        { email: u.email, role: u.role, password_rotated: true, source: "scripts/seed_demo.ts" },
        DEMO_SEED_TENANT_ID,
      );
      auditsAppended++;
    } catch (err) {
      /* LOUD, and no row. The seed's user/credential writes above are the
       * point of this script and remain valid; what must never happen is a
       * fabricated chain link, so nothing is written on this path. */
      auditsRefused++;
      console.error(
        `[seed_demo] AUDIT NOT WRITTEN for ${u.email}: ${(err as Error).message}\n` +
          `  No audit_log row was created. This script will NOT fabricate a prev_hash/hash\n` +
          `  pair — an unverifiable row breaks verifyTenantAuditChain() for ` +
          `${DEMO_SEED_TENANT_ID}\n  permanently (audit_log is append-only). ` +
          `See build_log/wave51/AUDIT_CHAIN_REPAIR.md.`,
      );
    }

    console.log(`  \u2713 ${u.email.padEnd(36)} (role=${u.role})`);
  }

  console.log("");
  console.log(`Seeded ${DEMO_USERS.length} demo users (${created} new, ${rotated} credentials rotated).`);
  /* WAVE 51 · ITEM 4 — the audit outcome is REPORTED. The previous version could
   * not have told you it had written nothing, because it never looked. */
  console.log(
    `Audit rows appended via appendAdminAudit(): ${auditsAppended}` +
      (auditsRefused > 0 ? ` — ${auditsRefused} REFUSED (see errors above)` : ""),
  );
  console.log("Demo password:", password);
  console.log("");
  console.log("Try:");
  console.log("  curl -X POST http://localhost:5000/api/auth/login \\");
  console.log("       -H 'content-type: application/json' \\");
  console.log(`       -d '{\"email\":\"aisha@greenwood.capital\",\"password\":\"${password}\"}'`);
}

main().catch((err) => {
  console.error("[seed_demo] failed:", err);
  process.exit(1);
});
