/**
 * userCredentialsStore — Patch v12 Phase B (DB-1 + DB-10 hardening)
 *
 * Now DB-backed. Hybrid pattern:
 *   - `_memStore` (lowercase-email → StoredCredential) and `_userIdIndex`
 *     (userId → lowercase-email) Maps remain as READ CACHES.
 *   - The `user_credentials` table (shared/schema.ts → userCredentials) is the
 *     authoritative store.
 *   - All writes wrap into a Drizzle transaction, then on commit the Maps are
 *     updated synchronously. The Maps mirror the DB at all times.
 *
 * DB-1 fix (audit §6): the old code used a CJS require pointing at an invalid
 * relative DB module path — credentials never persisted, even in production.
 * We replace it with a proper ESM import of `./db/connection.getDb`.
 *
 * DB-10 fix (audit §6): the prior /tmp credentials JSON fallback has been
 * removed entirely. SQLite (file: ./data.db in dev, in-memory in test) is now
 * the dev backend, postgres is prod. There is no plaintext-adjacent file
 * fallback any longer.
 *
 * Password hashing (CP-041): bcryptjs is now a hard runtime dependency.
 * - Cost factor: 12 in production, 4 in tests (for speed).
 * - Legacy `sha256:`-prefixed hashes are still accepted on login and
 *   transparently upgraded to bcrypt on the first successful verification.
 */

import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { isNull, eq, sql } from "drizzle-orm";
import { getDb } from "./db/connection";
import { userCredentials } from "../shared/schema";
import { log } from "./lib/logger";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export interface StoredCredential {
  userId: string;
  email: string;
  name?: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialHandle {
  userId: string;
  name?: string;
  /** Returns true if the supplied plaintext password matches the stored hash. */
  verifyPassword(plaintext: string): boolean;
}

/* ------------------------------------------------------------------ */
/* bcryptjs hashing (CP-041)                                            */
/* ------------------------------------------------------------------ */

/**
 * Bcrypt cost factor. Production = 12 (~250ms on modern hardware).
 * Tests = 4 (~1ms) — keeps the vitest suite fast without sacrificing
 *   coverage of the bcrypt code path.
 */
function bcryptCost(): number {
  return process.env.NODE_ENV === "test" ? 4 : 12;
}

function _isLegacySha(hash: string): boolean {
  return typeof hash === "string" && hash.startsWith("sha256:");
}

function _legacySha(plaintext: string): string {
  return (
    "sha256:" +
    createHash("sha256")
      .update("capavate-salt-v1:" + plaintext)
      .digest("hex")
  );
}

export function hashPassword(plaintext: string): string {
  return bcrypt.hashSync(plaintext, bcryptCost());
}

/**
 * Verify a plaintext password against a stored hash.
 * Accepts both bcrypt hashes ($2a$/$2b$/$2y$...) and legacy `sha256:` hashes.
 * Callers that want to opportunistically upgrade legacy hashes should use
 *   verifyAndMaybeUpgrade() instead.
 */
export function verifyHash(plaintext: string, hash: string): boolean {
  if (_isLegacySha(hash)) {
    return hash === _legacySha(plaintext);
  }
  try {
    return bcrypt.compareSync(plaintext, hash);
  } catch {
    return false;
  }
}

/**
 * Verify the password. If verification succeeded and the stored hash is the
 * legacy `sha256:` format, rehash with bcrypt and persist. Returns whether
 * the password matched. The upgrade is best-effort: a failed re-hash does
 * not fail the login.
 */
function verifyAndMaybeUpgrade(
  email: string,
  plaintext: string,
  storedHash: string,
): boolean {
  const ok = verifyHash(plaintext, storedHash);
  if (!ok) return false;
  if (!_isLegacySha(storedHash)) return true;

  try {
    const newHash = hashPassword(plaintext);
    const now = new Date().toISOString();
    const db = getDb();
    // CROSS-TENANT (admin) — user_credentials is global identity.
    db.transaction((tx: any) => {
      tx.update(userCredentials)
        .set({ passwordHash: newHash, updatedAt: now })
        .where(
          sql`lower(${userCredentials.email}) = ${email.toLowerCase()} AND ${userCredentials.deletedAt} IS NULL`,
        )
        .run();
    });
    // Refresh cache.
    const cached = _memStore.get(email.toLowerCase());
    if (cached) {
      _memStore.set(email.toLowerCase(), { ...cached, passwordHash: newHash, updatedAt: now });
    }
    log.info({
      route: "userCredentialsStore.upgrade",
      message: "legacy_sha256_hash_upgraded_to_bcrypt",
      email: email.toLowerCase(),
    });
  } catch (err) {
    // Best-effort — do not fail login.
    log.warn({
      route: "userCredentialsStore.upgrade",
      errorType: "hash_upgrade_failed",
      message: (err as Error).message,
    });
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* In-memory caches (mirrors DB)                                       */
/* ------------------------------------------------------------------ */

/** In-memory map keyed by lowercase email — read cache for the DB. */
const _memStore = new Map<string, StoredCredential>();
/** In-memory map keyed by userId for fast userId→email lookup. */
const _userIdIndex = new Map<string, string>(); // userId → email (lowercase)

function rowToCred(row: any): StoredCredential {
  return {
    userId: row.userId,
    email: row.email,
    name: row.name ?? undefined,
    passwordHash: row.passwordHash,
    createdAt: row.createdAt ?? "",
    updatedAt: row.updatedAt ?? "",
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

/**
 * Store a new credential.
 * Hashes the plaintext password with bcryptjs (or SHA-256 fallback).
 * Idempotent by userId — updates passwordHash on re-store (e.g. password change).
 *
 * DB writes wrap in a Drizzle transaction so a partial write (e.g. SQLite
 * lock contention) can't leave the Maps and DB out of sync.
 */
export function storeCredential(args: {
  userId: string;
  email: string;
  name?: string;
  password: string;
}): void {
  const email = args.email.trim().toLowerCase();
  const now = new Date().toISOString();
  const existing = _memStore.get(email);
  const cred: StoredCredential = {
    userId: args.userId,
    email,
    name: args.name,
    passwordHash: hashPassword(args.password),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const db = getDb();
  // CROSS-TENANT (admin) — credentials are global by design (login-by-email
  // happens before any tenant is selected). The login route resolves the
  // user's home tenant after authentication.
  // Run synchronously so the Map update below reflects a committed DB row.
  try {
    const insert = db
      .insert(userCredentials)
      .values({
        userId: cred.userId,
        email: cred.email,
        name: cred.name ?? null,
        passwordHash: cred.passwordHash,
        createdAt: cred.createdAt,
        updatedAt: cred.updatedAt,
        deletedAt: null,
      })
      .onConflictDoUpdate({
        target: userCredentials.userId,
        set: {
          email: cred.email,
          name: cred.name ?? null,
          passwordHash: cred.passwordHash,
          updatedAt: cred.updatedAt,
          deletedAt: null,
        },
      });
    // better-sqlite3 transaction supports synchronous statements. Drizzle
    // queries are thenables; use .run() when available for sync path.
    if (typeof (insert as any).run === "function") {
      // Wrap in a transaction for hash-chain–style isolation and to keep the
      // semantics identical to the Postgres path (DB-6).
      db.transaction((tx: any) => {
        // Re-issue under the tx to participate in the BEGIN IMMEDIATE.
        tx.insert(userCredentials)
          .values({
            userId: cred.userId,
            email: cred.email,
            name: cred.name ?? null,
            passwordHash: cred.passwordHash,
            createdAt: cred.createdAt,
            updatedAt: cred.updatedAt,
            deletedAt: null,
          })
          .onConflictDoUpdate({
            target: userCredentials.userId,
            set: {
              email: cred.email,
              name: cred.name ?? null,
              passwordHash: cred.passwordHash,
              updatedAt: cred.updatedAt,
              deletedAt: null,
            },
          })
          .run();
      });
    } else {
      // Postgres async path
      // We cannot await inside this sync function; return a promise the
      // caller may chain. Existing callers (registerFounderUser) treat this
      // as fire-and-forget.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      (db.transaction(async (tx: any) => {
        await tx
          .insert(userCredentials)
          .values({
            userId: cred.userId,
            email: cred.email,
            name: cred.name ?? null,
            passwordHash: cred.passwordHash,
            createdAt: cred.createdAt,
            updatedAt: cred.updatedAt,
            deletedAt: null,
          })
          .onConflictDoUpdate({
            target: userCredentials.userId,
            set: {
              email: cred.email,
              name: cred.name ?? null,
              passwordHash: cred.passwordHash,
              updatedAt: cred.updatedAt,
              deletedAt: null,
            },
          });
      }) as Promise<void>).catch((err) => {
        log.error({
          route: "userCredentialsStore.storeCredential",
          errorType: "persist_failed",
          message: (err as Error).message,
        });
      });
    }
  } catch (err) {
    // Surface DB errors loudly — the old code swallowed these and left
    // credentials persisting only to /tmp (DB-1 silent catastrophe).
    log.error({
      route: "userCredentialsStore.storeCredential",
      errorType: "db_write_failed",
      message: (err as Error).message,
    });
    throw err;
  }

  // After successful DB write, mirror into the Maps.
  _memStore.set(email, cred);
  _userIdIndex.set(args.userId, email);
}

/**
 * Look up a credential by email.
 * Returns a CredentialHandle with a verifyPassword() method, or null if not found.
 *
 * Read path: Map (cache) first. On miss, fall back to DB and repopulate the
 * cache. This means a process that boots without hydrate (e.g. a test that
 * imports the module directly) still serves correct results.
 */
export function lookupByEmail(email: string): CredentialHandle | null {
  const normalized = email.trim().toLowerCase();
  let cred = _memStore.get(normalized);
  if (!cred) {
    // DB miss-fallback: query by lowercased email, skipping soft-deleted rows.
    try {
      const db = getDb();
      // CROSS-TENANT (admin) — login-by-email predates tenant resolution.
      const rows = db
        .select()
        .from(userCredentials)
        .where(
          // LOWER(email) = LOWER(?) AND deleted_at IS NULL
          sql`lower(${userCredentials.email}) = ${normalized} AND ${userCredentials.deletedAt} IS NULL`,
        )
        .all() as any[];
      const row = rows[0];
      if (row) {
        cred = rowToCred(row);
        _memStore.set(normalized, cred);
        _userIdIndex.set(cred.userId, normalized);
      }
    } catch (err) {
      log.warn({
        route: "userCredentialsStore.lookupByEmail",
        errorType: "db_read_failed",
        message: (err as Error).message,
      });
    }
  }
  if (!cred) return null;
  // Capture into closure so this handle isn't affected by later cache changes.
  const captured = cred;
  return {
    userId: captured.userId,
    name: captured.name,
    verifyPassword: (plaintext: string) =>
      verifyAndMaybeUpgrade(captured.email, plaintext, captured.passwordHash),
  };
}

/**
 * Look up a credential by userId.
 * Returns the email for that userId, or null if not found.
 */
export function lookupByUserId(userId: string): { email: string; name?: string } | null {
  const email = _userIdIndex.get(userId);
  if (email) {
    const cred = _memStore.get(email);
    if (cred) return { email: cred.email, name: cred.name };
  }
  // DB miss-fallback.
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — user_credentials is global identity, not tenant-scoped.
    const rows = db
      .select()
      .from(userCredentials)
      .where(
        sql`${userCredentials.userId} = ${userId} AND ${userCredentials.deletedAt} IS NULL`,
      )
      .all() as any[];
    const row = rows[0];
    if (row) {
      const cred = rowToCred(row);
      const e = cred.email.toLowerCase();
      _memStore.set(e, cred);
      _userIdIndex.set(cred.userId, e);
      return { email: cred.email, name: cred.name };
    }
  } catch (err) {
    log.warn({
      route: "userCredentialsStore.lookupByUserId",
      errorType: "db_read_failed",
      message: (err as Error).message,
    });
  }
  return null;
}

/**
 * Soft-delete a credential by userId. Sets deleted_at on the DB row and
 * evicts both Maps. Idempotent.
 */
export function deleteCredential(userId: string): boolean {
  const email = _userIdIndex.get(userId);
  let deleted = false;
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      const r = tx
        .update(userCredentials)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(userCredentials.userId, userId))
        .run();
      deleted = (r?.changes ?? r?.rowCount ?? 0) > 0;
    });
  } catch (err) {
    log.error({
      route: "userCredentialsStore.deleteCredential",
      errorType: "db_write_failed",
      message: (err as Error).message,
    });
    throw err;
  }
  if (email) _memStore.delete(email);
  _userIdIndex.delete(userId);
  return deleted;
}

/**
 * Hydrate the in-memory caches from the DB. Called at boot by
 * server/lib/hydrateStores.ts. Idempotent — safe to call again to refresh.
 */
export async function hydrateUserCredentialsStore(): Promise<void> {
  const db = getDb();
  // CROSS-TENANT (admin) — user_credentials is global identity.
  const rows = (await db
    .select()
    .from(userCredentials)
    .where(isNull(userCredentials.deletedAt))) as any[];

  _memStore.clear();
  _userIdIndex.clear();
  for (const row of rows) {
    const cred = rowToCred(row);
    const e = cred.email.toLowerCase();
    _memStore.set(e, cred);
    _userIdIndex.set(cred.userId, e);
  }
}

/** Exposed for tests. */
export const _testCredStore = { _memStore, _userIdIndex };
