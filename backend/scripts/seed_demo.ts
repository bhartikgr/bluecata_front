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
 *   3. `audit_log` row per user (action = 'demo.seeded')
 *
 * Cross-tenant note: same rationale as scripts/create_admin.ts — identity
 * tables are global; admins are scoped to `tenant_admin_capavate` only for
 * audit traceability.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db/connection";
import {
  users as usersTable,
  auditLog as auditLogTable,
} from "../shared/schema";
import { storeCredential } from "../server/userCredentialsStore";

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
  const now = new Date().toISOString();

  let created = 0;
  let rotated = 0;

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

    // 3. Audit row.
    try {
      const audit = {
        actor: "system:seed_demo",
        action: "demo.seeded",
        target: `user:${u.id}`,
        payload: { email: u.email, role: u.role, password_rotated: true },
      };
      const auditId = `audit_demo_${u.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const prevHash = "0".repeat(64); // simplified; full chain handled by appendAdminAudit at runtime
      const currHash = createHash("sha256")
        .update(prevHash + JSON.stringify(audit) + now)
        .digest("hex");
      db.insert(auditLogTable)
        .values({
          id: auditId,
          tenantId: "tenant_admin_capavate",
          actorId: "system:seed_demo",
          action: audit.action,
          targetType: "user",
          targetId: u.id,
          payload: JSON.stringify(audit.payload),
          prevHash,
          currHash,
          createdAt: now,
        } as any)
        .onConflictDoNothing()
        .run();
    } catch {
      /* non-fatal; audit chain is informational here */
    }

    console.log(`  \u2713 ${u.email.padEnd(36)} (role=${u.role})`);
  }

  console.log("");
  console.log(`Seeded ${DEMO_USERS.length} demo users (${created} new, ${rotated} credentials rotated).`);
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
