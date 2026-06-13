/**
 * CP Phase A — bcryptjs upgrade tests (CP-041).
 *
 * Coverage:
 *   - NODE_ENV=test produces bcrypt hashes with cost factor 4 (encoded in
 *     the hash itself: $2a$04$... / $2b$04$...).
 *   - Legacy `sha256:` hashes upgrade to bcrypt on first verifyPassword call.
 *   - storeCredential + lookupByEmail round-trip works after seeding.
 *   - Wrong password is rejected; correct password is accepted.
 */

import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";

import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  hashPassword,
  verifyHash,
  storeCredential,
  lookupByEmail,
  hydrateUserCredentialsStore,
} from "../userCredentialsStore";
import { userCredentials } from "../../shared/schema";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  await seedDemoData(getDb());
}, 30_000);

describe("CP Phase A — bcryptjs upgrade (CP-041)", () => {
  /* ===================== 1. Cost factor 4 in test ===================== */

  it("hashPassword in NODE_ENV=test produces a bcrypt hash with cost factor 4", () => {
    expect(process.env.NODE_ENV).toBe("test");
    const hash = hashPassword("hello-world");
    // bcryptjs format: $2a$04$... where 04 = cost
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    // The hash should round-trip via bcrypt.compareSync.
    expect(bcrypt.compareSync("hello-world", hash)).toBe(true);
    expect(bcrypt.compareSync("wrong", hash)).toBe(false);
  });

  /* ===================== 2. verifyHash bcrypt + legacy sha256 ===================== */

  it("verifyHash accepts bcrypt hashes (positive) and rejects wrong passwords", () => {
    const hash = hashPassword("supersecret");
    expect(verifyHash("supersecret", hash)).toBe(true);
    expect(verifyHash("not-the-password", hash)).toBe(false);
  });

  it("verifyHash accepts legacy sha256: prefixed hashes", () => {
    // Compute a legacy sha256 hash using the same salt prefix the store uses.
    const { createHash } = require("node:crypto");
    const legacy = "sha256:" + createHash("sha256").update("capavate-salt-v1:legacy-pw").digest("hex");
    expect(verifyHash("legacy-pw", legacy)).toBe(true);
    expect(verifyHash("wrong-pw", legacy)).toBe(false);
  });

  /* ===================== 3. Legacy → bcrypt upgrade on login ===================== */

  it("verifyPassword upgrades legacy sha256: hash to bcrypt on first successful login", async () => {
    const userId = "u_legacy_upgrade_test";
    const email = "legacy-upgrade@cp-test.example";
    const password = "legacy-password-1";
    const now = new Date().toISOString();
    const { createHash } = require("node:crypto");
    const legacyHash = "sha256:" + createHash("sha256").update("capavate-salt-v1:" + password).digest("hex");

    // Insert a legacy credential directly into DB (bypass storeCredential which uses bcrypt).
    const db: any = getDb();
    db.transaction((tx: any) => {
      // Use raw SQL with INSERT OR REPLACE to ensure clean state.
      tx.run(sql`
        INSERT OR REPLACE INTO user_credentials (user_id, email, name, password_hash, created_at, updated_at, deleted_at)
        VALUES (${userId}, ${email}, ${null}, ${legacyHash}, ${now}, ${now}, ${null})
      `);
    });
    // Force the cache to pick it up.
    await hydrateUserCredentialsStore();

    const handle = lookupByEmail(email);
    expect(handle).not.toBeNull();
    expect(handle!.verifyPassword(password)).toBe(true);

    // After verifyPassword, the DB row's hash should be upgraded to bcrypt.
    const rows = db.all(sql`SELECT password_hash FROM user_credentials WHERE user_id = ${userId}`) as Array<{ password_hash: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].password_hash.startsWith("sha256:")).toBe(false);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
    // And the upgraded hash still verifies the same plaintext.
    expect(bcrypt.compareSync(password, rows[0].password_hash)).toBe(true);
  });

  /* ===================== 4. storeCredential → lookupByEmail round-trip ===================== */

  it("storeCredential persists a bcrypt-hashed credential and lookupByEmail verifies it", () => {
    const userId = "u_bcrypt_round_trip_test";
    const email = "bcrypt-rt@cp-test.example";
    const password = "round-trip-pw-42";
    storeCredential({ userId, email, name: "BCrypt RT", password });

    const handle = lookupByEmail(email);
    expect(handle).not.toBeNull();
    expect(handle!.userId).toBe(userId);
    expect(handle!.verifyPassword(password)).toBe(true);
    expect(handle!.verifyPassword("wrong-pw")).toBe(false);

    // Direct DB check: hash should be bcrypt format with cost 4.
    const db: any = getDb();
    const rows = db.all(sql`SELECT password_hash FROM user_credentials WHERE user_id = ${userId}`) as Array<{ password_hash: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$04\$/);
  });

  /* ===================== 5. lookupByEmail returns null for unknown email ===================== */

  it("lookupByEmail returns null for unknown email", () => {
    expect(lookupByEmail("nonexistent-user-xyz@nowhere.example")).toBeNull();
  });
});
