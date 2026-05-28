#!/usr/bin/env node
/**
 * Capavate v19 — Production admin CLI
 *
 * Creates (or updates) a platform admin user. Idempotent: re-running with
 * the same email is safe and rotates the password / promotes role to admin.
 *
 * Writes:
 *   1. `users` row (role = 'admin', isDemo = 0)
 *   2. `user_credentials` row (bcrypt password hash)
 *   3. `user_prefs` row (activeTenantId = admin tenant)
 *   4. `audit_log` row (action = 'admin.created' or 'admin.password_rotated')
 *
 * Usage:
 *   npx tsx scripts/create_admin.ts --email=ozan@capavate.io --password='S3cur3!Pass'
 *   npx tsx scripts/create_admin.ts --email=ozan@capavate.io --password='S3cur3!Pass' --name="Ozan Isinak"
 *
 * Why this exists:
 *   The 23-May admin login P0 root cause was that `users.role = 'admin'` was
 *   never read by the login path. This script writes BOTH `users.role='admin'`
 *   AND `user_credentials`, so the next /api/auth/login call hits Path 2 of
 *   verifyPassword(), which now calls getDbUserRole() and promotes the
 *   synthesized RUNTIME_PERSONAS entry to isAdmin: true.
 *
 * Cross-tenant note:
 *   This script writes to `users`, `user_credentials`, `user_prefs`, and
 *   `audit_log` without a tenant filter. That is intentional and audit-grade:
 *   admin identity is global by design (login-by-email happens before any
 *   tenant is resolved), and the audit_log entry uses the admin tenant
 *   (`tenant_admin_capavate`) for traceability.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db/connection";
import {
  users as usersTable,
  userPrefs as userPrefsTable,
  tenants as tenantsTable,
  auditLog as auditLogTable,
} from "../shared/schema";
import { storeCredential } from "../server/userCredentialsStore";

interface Args {
  email: string;
  password: string;
  name?: string;
  userId?: string;
  tenantId?: string;
}

function parseArgs(argv: string[]): Args {
  const map: Record<string, string> = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) map[m[1]] = m[2];
  }
  const email = map.email?.trim().toLowerCase();
  const password = map.password;
  if (!email || !password) {
    console.error(
      "Usage: npx tsx scripts/create_admin.ts --email=<email> --password=<password> [--name=<name>] [--userId=<id>] [--tenantId=<id>]",
    );
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("ERROR: password must be at least 12 characters.");
    process.exit(2);
  }
  return {
    email,
    password,
    name: map.name,
    userId: map.userId,
    tenantId: map.tenantId,
  };
}

function deterministicUserId(email: string): string {
  const h = createHash("sha256").update(`admin:${email}`).digest("hex").slice(0, 16);
  return `u_admin_${h}`;
}

async function createAdmin(args: Args): Promise<{
  userId: string;
  email: string;
  created: boolean;
  promoted: boolean;
  passwordRotated: boolean;
}> {
  const db = getDb();
  const email = args.email;
  const now = new Date().toISOString();
  const tenantId = args.tenantId ?? "tenant_admin_capavate";
  const name = args.name ?? "Platform Admin";

  // Ensure the admin tenant exists. Idempotent insert.
  await db
    .insert(tenantsTable)
    .values({
      id: tenantId,
      name: "Capavate Platform Admin",
      kind: "company",
      billingEmail: "ops@capavate.io",
      status: "active",
      isDemo: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .onConflictDoNothing({ target: tenantsTable.id });

  // Look up existing admin row by email — global lookup (cross-tenant by
  // design; admin identity is not tenant-scoped).
  const existing = (db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .all() as Array<{ id: string; role: string }>);

  let userId: string;
  let created = false;
  let promoted = false;

  if (existing.length > 0) {
    userId = existing[0].id;
    if (existing[0].role !== "admin") {
      await db
        .update(usersTable)
        .set({ role: "admin", name, tenantId })
        .where(eq(usersTable.id, userId));
      promoted = true;
    }
  } else {
    userId = args.userId ?? deterministicUserId(email);
    await db
      .insert(usersTable)
      .values({
        id: userId,
        tenantId,
        email,
        name,
        role: "admin",
        avatarUrl: null,
        isDemo: 0,
        deletedAt: null,
      })
      .onConflictDoNothing({ target: usersTable.id });
    created = true;
  }

  // Upsert credential (bcrypt-hashed).
  storeCredential({ userId, email, name, password: args.password });

  // Upsert user_prefs.activeTenantId.
  try {
    await db
      .insert(userPrefsTable)
      .values({
        userId,
        activeTenantId: tenantId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userPrefsTable.userId,
        set: { activeTenantId: tenantId, updatedAt: now },
      });
  } catch {
    // Some adapters lack onConflictDoUpdate; fall back to delete+insert.
    await db.delete(userPrefsTable).where(eq(userPrefsTable.userId, userId));
    await db.insert(userPrefsTable).values({
      userId,
      activeTenantId: tenantId,
      updatedAt: now,
    });
  }

  // Append an audit_log row. Hash-chain is maintained by the verifier — we
  // emit a self-contained entry; the next reconciler tick will splice it into
  // the chain. (We don't compute prevHash here to avoid contending with the
  // hash-chain writer in captableCommitStore.ts; that module is math-sacred.)
  // The `hash` column is NOT NULL on the schema, so we deterministically hash
  // (userId, timestamp, action) — the reconciler will overwrite this with the
  // proper hash-chain value on its next tick.
  const action = created ? "admin.created" : promoted ? "admin.promoted" : "admin.password_rotated";
  const auditId = `aud_${createHash("sha256").update(`${userId}:${now}:${action}`).digest("hex").slice(0, 24)}`;
  const placeholderHash = createHash("sha256").update(`${auditId}:${userId}:${action}:${now}`).digest("hex");
  try {
    await db.insert(auditLogTable).values({
      id: auditId,
      tenantId,
      actorId: userId,
      action,
      target: "user",
      targetId: userId,
      payloadJson: JSON.stringify({ email, name, source: "scripts/create_admin.ts" }),
      prevHash: null,
      hash: placeholderHash,
      createdAt: now,
      deletedAt: null,
    });
  } catch (e) {
    // Audit-log insert is best-effort; the user/credential writes above are
    // the source of truth. Log a warning and continue.
    console.warn(`[create_admin] audit_log insert failed: ${(e as Error).message}`);
  }

  return { userId, email, created, promoted, passwordRotated: !created && !promoted };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await createAdmin(args);
    const verb = result.created
      ? "CREATED"
      : result.promoted
        ? "PROMOTED"
        : "PASSWORD_ROTATED";
    console.log(JSON.stringify({ ok: true, verb, ...result }, null, 2));
    console.log("");
    console.log(`✔ Admin ready. Login at /admin/login with:`);
    console.log(`    email:    ${result.email}`);
    console.log(`    password: <as supplied>`);
    process.exit(0);
  } catch (e) {
    console.error(`[create_admin] FAILED: ${(e as Error).message}`);
    console.error((e as Error).stack);
    process.exit(3);
  }
}

// Run when invoked directly. When imported by tests, exports are used instead.
const isDirect = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isDirect) {
  void main();
}

export { createAdmin, parseArgs, deterministicUserId };
