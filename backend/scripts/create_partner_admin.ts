#!/usr/bin/env node
/**
 * Capavate v19 — Production partner-admin CLI.
 *
 * Provisions (or rotates the credentials for) an initial partner_admin user
 * against an EXISTING consortium-partner organization in adminContactsStore.
 * Idempotent: re-running with the same email rotates the password and ensures
 * the partner_team_members binding is present.
 *
 * Why this exists (vs. just create_admin.ts):
 *   In production, partner_admin users are normally minted automatically when
 *   POST /api/admin/consortium/applications/:id/review approves a partner
 *   application. This script is the EMERGENCY / OPS fallback when the
 *   approval flow can't be exercised (e.g. importing a legacy partner,
 *   recovering a locked-out partner_admin, or bootstrapping a partner in
 *   a fresh environment after a DB restore).
 *
 * Writes:
 *   1. `users` row (role = 'investor' — partner-ness derives from
 *      partner_team_members, not users.role; this mirrors the demo seed).
 *   2. `user_credentials` row (bcrypt hash; cost 12 in production,
 *      cost 4 in NODE_ENV=test for speed).
 *   3. `user_prefs` row (activeTenantId = partner org id).
 *   4. `partner_team_members` in-memory row (partnerTeamStore.add).
 *   5. `audit_log` row (action = 'partner_admin.created' | 'rotated').
 *
 * Usage:
 *   npx tsx scripts/create_partner_admin.ts \
 *       --email=ops@keiretsu.ca \
 *       --password='S3cur3!Pass!23' \
 *       --partnerId=tenant_cp_keiretsu_ca \
 *       --subRole=managing_partner \
 *       --name='Hassan Tanaka'
 *
 * Pre-condition:
 *   The partner org MUST already exist in adminContactsStore (kind =
 *   'consortium_partner'). If it doesn't, the script exits with code 4 and
 *   the message:
 *     "Partner organization not found — admin must approve consortium
 *      application first"
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
import { getById as getPartnerById, findContactByEmail } from "../server/adminContactsStoreShim";
// v24.4.1 Bug 2 — the script spawns a fresh Node process with an EMPTY
// in-memory contacts map. Without hydrating from the DB first, the script
// cannot see partners that were created at runtime via the consortium-apply
// approval flow. Hydrate before the getById() lookup below.
import { hydrateAdminContactsStore } from "../server/adminContactsStore";
import { partnerTeamStore, type SubRole } from "../server/partnerWorkspaceStore";

const VALID_SUB_ROLES: ReadonlySet<SubRole> = new Set<SubRole>([
  "managing_partner",
  "associate",
  "bd",
  "analyst",
  "viewer",
]);

interface Args {
  email: string;
  password: string;
  partnerId: string;
  subRole: SubRole;
  name?: string;
  userId?: string;
}

function parseArgs(argv: string[]): Args {
  const map: Record<string, string> = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) map[m[1]] = m[2];
  }
  const email = map.email?.trim().toLowerCase();
  const password = map.password;
  const partnerId = map.partnerId?.trim();
  const subRoleRaw = (map.subRole ?? "managing_partner").trim();

  const usage =
    "Usage: npx tsx scripts/create_partner_admin.ts " +
    "--email=<email> --password=<password> --partnerId=<tenant_cp_*> " +
    "[--subRole=managing_partner|associate|bd|analyst|viewer] [--name=<name>] [--userId=<id>]\n" +
    "  v24.5 GAP-5: if --partnerId lookup fails, the script falls back to\n" +
    "  looking up the contact by --email in adminContactsStore.\n" +
    "  Useful when re-onboarding a previously-archived partner with the same email.";

  if (!email || !password || !partnerId) {
    console.error(usage);
    process.exit(1);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("ERROR: invalid email address.");
    process.exit(2);
  }
  if (password.length < 12) {
    console.error("ERROR: password must be at least 12 characters.");
    process.exit(2);
  }
  if (!VALID_SUB_ROLES.has(subRoleRaw as SubRole)) {
    console.error(
      `ERROR: --subRole must be one of: ${[...VALID_SUB_ROLES].join(", ")} (got: ${subRoleRaw})`,
    );
    process.exit(2);
  }
  return {
    email,
    password,
    partnerId,
    subRole: subRoleRaw as SubRole,
    name: map.name,
    userId: map.userId,
  };
}

function deterministicUserId(email: string): string {
  const h = createHash("sha256").update(`partner-admin:${email}`).digest("hex").slice(0, 16);
  return `u_partner_${h}`;
}

export async function createPartnerAdmin(args: Args): Promise<{
  userId: string;
  email: string;
  partnerId: string;
  subRole: SubRole;
  created: boolean;
  bindingAdded: boolean;
  passwordRotated: boolean;
}> {
  const db = getDb();
  const now = new Date().toISOString();
  const name = args.name ?? "Partner Admin";

  // Pre-condition: the partner organization MUST exist. We intentionally do
  // NOT create one here — that path is reserved for the consortium application
  // review flow so the audit trail (application → review → org creation)
  // stays intact.
  //
  // v24.5 GAP-5 — Email-based fallback: when a contact email already exists
  // from a prior approval, the consortium-apply approval flow reuses that
  // contact but may return a different ID to the caller. If getPartnerById
  // fails, try to resolve the contact by the --email argument so operators
  // can re-onboard a previously-archived partner without needing to know
  // the canonical contact id.
  let partner = getPartnerById(args.partnerId);
  if (!partner || partner.kind !== "consortium_partner") {
    // Fallback: look up by the admin email supplied via --email.
    const byEmail = findContactByEmail(args.email);
    if (byEmail && byEmail.kind === "consortium_partner") {
      console.warn(
        `[create_partner_admin] --partnerId=${args.partnerId} not found; ` +
        `falling back to email-matched contact id=${byEmail.id} (${byEmail.displayName ?? byEmail.legalName})`,
      );
      partner = byEmail;
      // Repoint args.partnerId so downstream writes use the canonical id.
      args = { ...args, partnerId: byEmail.id };
    }
  }
  if (!partner || partner.kind !== "consortium_partner") {
    throw new Error(
      "Partner organization not found — admin must approve consortium application first",
    );
  }

  // Ensure the partner's tenant row exists. Idempotent.
  await db
    .insert(tenantsTable)
    .values({
      id: args.partnerId,
      name: partner.displayName ?? partner.legalName ?? args.partnerId,
      kind: "consortium_partner",
      billingEmail: partner.email ?? null,
      status: "active",
      isDemo: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .onConflictDoNothing({ target: tenantsTable.id });

  // Look up existing user row by email (global; partner identity is global
  // because login-by-email happens before tenant resolution).
  const existing = db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.email, args.email))
    .all() as Array<{ id: string; role: string }>;

  let userId: string;
  let created = false;

  if (existing.length > 0) {
    userId = existing[0].id;
    // Re-pin tenant + name. We deliberately do NOT touch `role`: in v19 the
    // canonical demo partner is `role='investor'`. partner-ness derives from
    // partner_team_members, not users.role.
    await db
      .update(usersTable)
      .set({ name, tenantId: args.partnerId })
      .where(eq(usersTable.id, userId));
  } else {
    userId = args.userId ?? deterministicUserId(args.email);
    await db
      .insert(usersTable)
      .values({
        id: userId,
        tenantId: args.partnerId,
        email: args.email,
        name,
        role: "investor",
        avatarUrl: null,
        isDemo: 0,
        deletedAt: null,
      })
      .onConflictDoNothing({ target: usersTable.id });
    created = true;
  }

  // Upsert credential (bcrypt). storeCredential() picks the cost based on
  // NODE_ENV (cost 4 in test, cost 12 in prod).
  storeCredential({ userId, email: args.email, name, password: args.password });

  // Upsert user_prefs.activeTenantId.
  try {
    await db
      .insert(userPrefsTable)
      .values({ userId, activeTenantId: args.partnerId, updatedAt: now })
      .onConflictDoUpdate({
        target: userPrefsTable.userId,
        set: { activeTenantId: args.partnerId, updatedAt: now },
      });
  } catch {
    await db.delete(userPrefsTable).where(eq(userPrefsTable.userId, userId));
    await db.insert(userPrefsTable).values({
      userId,
      activeTenantId: args.partnerId,
      updatedAt: now,
    });
  }

  // Ensure partner_team_members binding. partnerTeamStore.add is idempotent
  // on (partnerId, userId) and returns the existing row if already active.
  const before = partnerTeamStore.findByUserId(userId);
  partnerTeamStore.add(args.partnerId, userId, args.subRole, "u_system_cli", { isSeed: false });
  const bindingAdded = !before;

  // Audit log. Same caveat as create_admin.ts: the hash field is NOT NULL but
  // the canonical hash-chain reconciler will rewrite this on its next tick.
  const action = created
    ? "partner_admin.created"
    : bindingAdded
      ? "partner_admin.bound"
      : "partner_admin.password_rotated";
  const auditId = `aud_${createHash("sha256").update(`${userId}:${now}:${action}`).digest("hex").slice(0, 24)}`;
  const placeholderHash = createHash("sha256")
    .update(`${auditId}:${userId}:${action}:${now}`)
    .digest("hex");
  try {
    await db.insert(auditLogTable).values({
      id: auditId,
      tenantId: args.partnerId,
      actorId: userId,
      action,
      target: "partner_team_member",
      targetId: `${args.partnerId}:${userId}`,
      payloadJson: JSON.stringify({
        email: args.email,
        name,
        subRole: args.subRole,
        source: "scripts/create_partner_admin.ts",
      }),
      prevHash: null,
      hash: placeholderHash,
      createdAt: now,
      deletedAt: null,
    });
  } catch (e) {
    console.warn(`[create_partner_admin] audit_log insert failed: ${(e as Error).message}`);
  }

  return {
    userId,
    email: args.email,
    partnerId: args.partnerId,
    subRole: args.subRole,
    created,
    bindingAdded,
    passwordRotated: !created && !bindingAdded,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    // v24.4.1 Bug 2 — load the durable contacts cache from the database so
    // runtime-approved partners (HTTP review path) are visible to getById().
    // Idempotent and safe to re-run.
    await hydrateAdminContactsStore();

    const result = await createPartnerAdmin(args);
    const verb = result.created
      ? "CREATED"
      : result.bindingAdded
        ? "BOUND_EXISTING_USER"
        : "PASSWORD_ROTATED";
    console.log(JSON.stringify({ ok: true, verb, ...result }, null, 2));
    console.log("");
    console.log(`✔ Partner admin ready. Login at /#/partner/login with:`);
    console.log(`    email:    ${result.email}`);
    console.log(`    password: <as supplied>`);
    console.log(`    partner:  ${result.partnerId}`);
    console.log(`    role:     ${result.subRole}`);
    process.exit(0);
  } catch (e) {
    console.error(`[create_partner_admin] FAILED: ${(e as Error).message}`);
    if (
      (e as Error).message ===
      "Partner organization not found — admin must approve consortium application first"
    ) {
      process.exit(4);
    }
    console.error((e as Error).stack);
    process.exit(3);
  }
}

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

export { parseArgs, deterministicUserId, VALID_SUB_ROLES };
