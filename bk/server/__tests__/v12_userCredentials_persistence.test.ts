/**
 * Patch v12 — Phase B persistence test.
 *
 * Verifies the hybrid userCredentialsStore correctly persists to DB and
 * rehydrates the in-memory Maps after a "simulated restart".
 *
 * Scenario:
 *   1. storeCredential() inserts via Drizzle into user_credentials.
 *   2. Maps are populated as a side-effect.
 *   3. We clear the Maps (simulating a process restart that lost in-memory state).
 *   4. hydrateUserCredentialsStore() reads back from DB into the Maps.
 *   5. Both Maps must contain the credential again, and lookupByEmail still works.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  storeCredential,
  lookupByEmail,
  lookupByUserId,
  hydrateUserCredentialsStore,
  _testCredStore,
} from "../userCredentialsStore";

describe("v12 — userCredentialsStore DB persistence", () => {
  beforeAll(async () => {
    // Ensure the DB tables exist and any prior test rows are hydrated.
    await hydrateUserCredentialsStore();
  });

  it("storeCredential persists to DB and Maps; rehydration after Map.clear() repopulates from DB", async () => {
    const email = `v12_persist_${Date.now()}@example.com`;
    const userId = `u_v12_${Date.now()}`;

    storeCredential({ userId, email, name: "V12 Persist", password: "Pv12!secret" });

    // Maps populated.
    expect(_testCredStore._memStore.has(email.toLowerCase())).toBe(true);
    expect(_testCredStore._userIdIndex.get(userId)).toBe(email.toLowerCase());

    // Simulate restart by clearing the in-memory caches.
    _testCredStore._memStore.clear();
    _testCredStore._userIdIndex.clear();
    expect(_testCredStore._memStore.size).toBe(0);
    expect(_testCredStore._userIdIndex.size).toBe(0);

    // Hydrate from DB.
    await hydrateUserCredentialsStore();

    // Both Maps must contain our credential again.
    expect(_testCredStore._memStore.has(email.toLowerCase())).toBe(true);
    expect(_testCredStore._userIdIndex.get(userId)).toBe(email.toLowerCase());

    // Lookup APIs reflect the restored state.
    const handle = lookupByEmail(email);
    expect(handle).not.toBeNull();
    expect(handle!.userId).toBe(userId);
    expect(handle!.verifyPassword("Pv12!secret")).toBe(true);
    expect(handle!.verifyPassword("wrong")).toBe(false);

    const byId = lookupByUserId(userId);
    expect(byId).not.toBeNull();
    expect(byId!.email).toBe(email.toLowerCase());
  });

  it("lookupByEmail miss-path falls back to DB read even without a prior hydrate", async () => {
    const email = `v12_dbonly_${Date.now()}@example.com`;
    const userId = `u_v12_dbonly_${Date.now()}`;

    storeCredential({ userId, email, name: "V12 DB-only", password: "Pdb!secret" });

    // Wipe caches; do NOT hydrate.
    _testCredStore._memStore.clear();
    _testCredStore._userIdIndex.clear();

    const handle = lookupByEmail(email);
    expect(handle).not.toBeNull();
    expect(handle!.userId).toBe(userId);
    expect(handle!.verifyPassword("Pdb!secret")).toBe(true);

    // The miss-path populates the cache for next time.
    expect(_testCredStore._memStore.has(email.toLowerCase())).toBe(true);
  });
});
