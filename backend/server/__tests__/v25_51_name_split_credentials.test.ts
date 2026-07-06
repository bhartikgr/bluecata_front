/**
 * v25.51 name-split (Phase 2) — credential store invariants.
 *
 * The platform now captures discrete First/Last names, but every existing
 * reader still relies on the COMPOSED `name` field being a non-empty
 * "First Last". These tests lock that contract for the credential store:
 *
 *   1. When explicit firstName/lastName are supplied, the composed `name`
 *      is derived as "First Last" and the discrete columns are persisted.
 *   2. When only a composed `name` is supplied (legacy callers such as the
 *      SACRED registerFounderUser), it is auto-split into first/last WITHOUT
 *      mutating the composed `name` — so downstream readers are byte-stable.
 */
import { describe, it, expect } from "vitest";
import { storeCredential, _testCredStore } from "../userCredentialsStore";

describe("v25.51 name-split — userCredentialsStore composed-invariant", () => {
  it("explicit first/last compose a non-empty name and persist discrete fields", () => {
    const email = `ns_explicit_${Date.now()}@example.com`;
    const userId = `u_ns_explicit_${Date.now()}`;

    storeCredential({
      userId,
      email,
      firstName: "Maya",
      lastName: "Chen",
      password: "Pv2551!secret",
    });

    const cred = _testCredStore._memStore.get(email.toLowerCase());
    expect(cred).toBeDefined();
    // Discrete columns persisted.
    expect(cred!.firstName).toBe("Maya");
    expect(cred!.lastName).toBe("Chen");
    // Composed name is a non-empty "First Last" — the invariant every reader relies on.
    expect(cred!.name).toBe("Maya Chen");
    expect((cred!.name ?? "").length).toBeGreaterThan(0);
  });

  it("legacy composed name auto-splits into first/last, leaving composed name byte-stable", () => {
    const email = `ns_legacy_${Date.now()}@example.com`;
    const userId = `u_ns_legacy_${Date.now()}`;

    // This mirrors the SACRED registerFounderUser path, which only ever passes `name`.
    storeCredential({ userId, email, name: "Ada Lovelace", password: "Pv2551!secret" });

    const cred = _testCredStore._memStore.get(email.toLowerCase());
    expect(cred).toBeDefined();
    // Composed name MUST be untouched.
    expect(cred!.name).toBe("Ada Lovelace");
    // Auto-split populated the discrete columns.
    expect(cred!.firstName).toBe("Ada");
    expect(cred!.lastName).toBe("Lovelace");
  });

  it("single-token legacy name splits to first only, last null, name non-empty", () => {
    const email = `ns_single_${Date.now()}@example.com`;
    const userId = `u_ns_single_${Date.now()}`;

    storeCredential({ userId, email, name: "Cher", password: "Pv2551!secret" });

    const cred = _testCredStore._memStore.get(email.toLowerCase());
    expect(cred).toBeDefined();
    expect(cred!.name).toBe("Cher");
    expect(cred!.firstName).toBe("Cher");
    expect(cred!.lastName).toBeNull();
  });
});
