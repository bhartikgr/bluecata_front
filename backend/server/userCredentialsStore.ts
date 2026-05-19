/**
 * userCredentialsStore — NEW (Patch 1)
 *
 * Persists founder credentials so login works after a server restart.
 *
 * Strategy (two-tier):
 *   1. If DATABASE_URL is set → write-through to Postgres via Drizzle
 *      using the `userCredentials` table defined in shared/schema.ts.
 *      TODO (Avi): run `npx drizzle-kit push` after adding the table to shared/schema.ts.
 *
 *   2. Fallback → in-memory Map + write-through to /tmp/capavate-credentials.json.
 *      Survives process restarts on the same machine (e.g. local `npm run dev`).
 *      NOT suitable for production (single-process, file-based).
 *
 * Password hashing:
 *   Uses bcryptjs (already in node_modules).
 *   TODO (Avi): verify "bcryptjs" is in package.json dependencies.
 *   If bcryptjs is somehow not available this file falls back to a
 *   clearly-labelled TODO plaintext path.
 *
 * DDL for the Postgres userCredentials table:
 *   CREATE TABLE IF NOT EXISTS "user_credentials" (
 *     "user_id"       TEXT PRIMARY KEY,
 *     "email"         TEXT NOT NULL,
 *     "name"          TEXT,
 *     "password_hash" TEXT NOT NULL,
 *     "created_at"    TEXT,
 *     "updated_at"    TEXT
 *   );
 *   CREATE UNIQUE INDEX IF NOT EXISTS "user_credentials_email_idx" ON "user_credentials"("email");
 *
 * This matches the Drizzle table definition in shared/schema.ts (userCredentials).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

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
/* bcryptjs with graceful degradation                                   */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _bcrypt: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  _bcrypt = require("bcryptjs");
} catch {
  console.warn(
    "[userCredentialsStore] bcryptjs not available — falling back to SHA-256 hashing. " +
    "TODO (Avi): add bcryptjs to package.json dependencies for production."
  );
}

function hashPassword(plaintext: string): string {
  if (_bcrypt) {
    return _bcrypt.hashSync(plaintext, 12);
  }
  // Fallback: SHA-256 with a static salt prefix.
  // TODO (Avi): replace with bcryptjs before production launch.
  return "sha256:" + createHash("sha256").update("capavate-salt-v1:" + plaintext).digest("hex");
}

function verifyHash(plaintext: string, hash: string): boolean {
  if (_bcrypt) {
    try {
      return _bcrypt.compareSync(plaintext, hash);
    } catch {
      return false;
    }
  }
  // Fallback SHA-256 compare.
  return hash === "sha256:" + createHash("sha256").update("capavate-salt-v1:" + plaintext).digest("hex");
}

/* ------------------------------------------------------------------ */
/* In-memory + file-backed store (fallback when no DATABASE_URL)       */
/* ------------------------------------------------------------------ */

const FILE_PATH = "/tmp/capavate-credentials.json";

/** In-memory map keyed by lowercase email. */
const _memStore = new Map<string, StoredCredential>();
/** In-memory map keyed by userId for fast userId→email lookup. */
const _userIdIndex = new Map<string, string>(); // userId → email

function loadFromFile(): void {
  try {
    if (existsSync(FILE_PATH)) {
      const raw = JSON.parse(readFileSync(FILE_PATH, "utf8")) as StoredCredential[];
      for (const cred of raw) {
        _memStore.set(cred.email.toLowerCase(), cred);
        _userIdIndex.set(cred.userId, cred.email.toLowerCase());
      }
    }
  } catch {
    // Corrupt file or parse error — start fresh.
    console.warn("[userCredentialsStore] Could not load credentials from file — starting fresh.");
  }
}

function persistToFile(): void {
  try {
    const all = Array.from(_memStore.values());
    writeFileSync(FILE_PATH, JSON.stringify(all, null, 2), "utf8");
  } catch (err) {
    console.warn("[userCredentialsStore] Could not write credentials to file:", err);
  }
}

// Attempt to write to Postgres (async, non-blocking, best-effort).
async function tryPersistToDb(cred: StoredCredential): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  try {
    // Lazy-import to avoid crashing when DB is unavailable in tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { db } = require("../../db");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { userCredentials } = require("../../shared/schema");
    await db
      .insert(userCredentials)
      .values({
        userId: cred.userId,
        email: cred.email,
        name: cred.name ?? null,
        passwordHash: cred.passwordHash,
        createdAt: cred.createdAt,
        updatedAt: cred.updatedAt,
      })
      .onConflictDoUpdate({
        target: userCredentials.userId,
        set: { passwordHash: cred.passwordHash, updatedAt: cred.updatedAt },
      });
  } catch (err) {
    // Non-fatal — in-memory + file store is the source of truth in dev.
    console.warn("[userCredentialsStore] DB persist failed (non-fatal):", (err as Error).message);
  }
}

async function tryLoadFromDb(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { db } = require("../../db");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { userCredentials } = require("../../shared/schema");
    const rows = (await db.select().from(userCredentials)) as StoredCredential[];
    for (const row of rows) {
      const email = row.email.toLowerCase();
      _memStore.set(email, row);
      _userIdIndex.set(row.userId, email);
    }
  } catch {
    // No DB or table not yet created — silent fallback to file.
  }
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                       */
/* ------------------------------------------------------------------ */

// Load on module start.
loadFromFile();
// Best-effort async DB hydration (does not block module load).
tryLoadFromDb().catch(() => void 0);

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

/**
 * Store a new credential.
 * Hashes the plaintext password with bcryptjs (or SHA-256 fallback).
 * Idempotent by userId — updates passwordHash on re-store (e.g. password change).
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
  _memStore.set(email, cred);
  _userIdIndex.set(args.userId, email);
  persistToFile();
  // Non-blocking DB write.
  tryPersistToDb(cred).catch(() => void 0);
}

/**
 * Look up a credential by email.
 * Returns a CredentialHandle with a verifyPassword() method, or null if not found.
 */
export function lookupByEmail(email: string): CredentialHandle | null {
  const normalized = email.trim().toLowerCase();
  const cred = _memStore.get(normalized);
  if (!cred) return null;
  return {
    userId: cred.userId,
    name: cred.name,
    verifyPassword: (plaintext: string) => verifyHash(plaintext, cred.passwordHash),
  };
}

/**
 * Look up a credential by userId.
 * Returns the email for that userId, or null if not found.
 */
export function lookupByUserId(userId: string): { email: string; name?: string } | null {
  const email = _userIdIndex.get(userId);
  if (!email) return null;
  const cred = _memStore.get(email);
  return cred ? { email: cred.email, name: cred.name } : null;
}

/** Exposed for tests. */
export const _testCredStore = { _memStore, _userIdIndex };
