/**
 * Wave 2.5 — GPT-5.5 security remediation regression tests.
 *
 * These lock in the four auth/PII fixes for the non-sacred Wave 2.5 interceptor
 * (server/wave25InvestorProfileRoutes.ts). The interceptor is registered BEFORE
 * the sacred profileStore routes (exactly as production wires them in
 * server/routes.ts), so these tests exercise the real interceptor→sacred
 * delegation chain.
 *
 * Because the sacred KYC handler has no ownership check and the sacred PATCH
 * checks identity only after the interceptor may respond, the interceptor MUST
 * be the fail-closed gate. Asserted here:
 *   1. cross-user KYC upload  → 403, NO file written, victim doc count unchanged.
 *   2. missing-identity KYC   → 401, NO file written.
 *   3. missing-identity all-invalid PATCH → 401 (not 400 Invalid patch).
 *   4. owner happy path       → KYC 200 + doc appears (+ storageKey) + persists;
 *                               owner per-field partial PATCH still saves valid
 *                               sub-fields and reports fieldErrors for bad ones.
 */
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { registerWave25InvestorProfileRoutes } from "../wave25InvestorProfileRoutes";
import { registerProfileRoutes, _testAccess } from "../profileStore";

type Identity = { userId: string; isAdmin?: boolean; email?: string } | null;

/** Build an app that stamps a per-request identity (or none) then wires the
 * interceptor + sacred routes in production order. */
function makeApp(identity: Identity) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (identity) {
      req.userContext = {
        userId: identity.userId,
        isAdmin: !!identity.isAdmin,
        identity: { email: identity.email ?? `${identity.userId}@test.local` },
      };
    }
    next();
  });
  registerWave25InvestorProfileRoutes(app);
  registerProfileRoutes(app);
  return app;
}

function seededInvestorId(): string {
  const keys = [...(_testAccess.investorProfiles as Map<string, unknown>).keys()];
  return keys[0];
}

function kycDocCount(id: string): number {
  const p = (_testAccess.investorProfiles as Map<string, any>).get(id);
  return p?.profile?.kycDocuments?.length ?? 0;
}

function listStorageFiles(dir: string): string[] {
  try {
    return (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) =>
      fs.statSync(path.join(dir, f)).isFile(),
    );
  } catch {
    return [];
  }
}

let storageDir: string;
let prevStorageEnv: string | undefined;

beforeEach(() => {
  prevStorageEnv = process.env.KYC_STORAGE_DIR;
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave25-authtest-"));
  process.env.KYC_STORAGE_DIR = storageDir;
});

afterEach(() => {
  if (prevStorageEnv === undefined) delete process.env.KYC_STORAGE_DIR;
  else process.env.KYC_STORAGE_DIR = prevStorageEnv;
});

describe("Wave 2.5 KYC upload — owner-only, auth before any write", () => {
  it("defect #1: cross-user upload is 403 and writes NO file", async () => {
    const victimId = seededInvestorId();
    const app = makeApp({ userId: "attacker-user", isAdmin: false });

    const before = kycDocCount(victimId);
    const res = await request(app)
      .post(`/api/investors/${victimId}/kyc`)
      .attach("files", Buffer.from("cross-user-pii"), {
        filename: "cross.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: "not_authorized" });
    // No profile mutation and no durable bytes.
    expect(kycDocCount(victimId)).toBe(before);
    expect(listStorageFiles(storageDir)).toHaveLength(0);
  });

  it("defect #2: missing-identity upload is 401 and writes NO file", async () => {
    const victimId = seededInvestorId();
    const app = makeApp(null); // anonymous

    const before = kycDocCount(victimId);
    const res = await request(app)
      .post(`/api/investors/${victimId}/kyc`)
      .attach("files", Buffer.from("anon-pii"), {
        filename: "anon.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ message: "missing_identity" });
    expect(kycDocCount(victimId)).toBe(before);
    expect(listStorageFiles(storageDir)).toHaveLength(0);
  });

  it("defect #4 + happy path: owner upload is 200, doc appears with storageKey, persists", async () => {
    const ownerId = seededInvestorId();
    const app = makeApp({ userId: ownerId, isAdmin: false });

    const before = kycDocCount(ownerId);
    const res = await request(app)
      .post(`/api/investors/${ownerId}/kyc`)
      .attach("files", Buffer.from("owner-doc"), {
        filename: "owner.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.added).toHaveLength(1);
    // Durable reference fields present (single authoritative enrich write).
    const doc = res.body.added[0];
    expect(doc.storageKey).toMatch(new RegExp(`^kyc/${ownerId}/`));
    expect(doc.backend).toBe("fs");
    expect(typeof doc.sha256).toBe("string");
    // Profile doc count grew by exactly one, and bytes are on disk.
    expect(kycDocCount(ownerId)).toBe(before + 1);
    const files = listStorageFiles(storageDir);
    expect(files.length).toBe(1);
    // The in-memory profile doc carries the same enriched storageKey (no divergence).
    const stored = (_testAccess.investorProfiles as Map<string, any>).get(ownerId);
    const lastDoc = stored.profile.kycDocuments.at(-1);
    expect(lastDoc.storageKey).toBe(doc.storageKey);
  });

  it("admin may upload on behalf of another investor (200)", async () => {
    const targetId = seededInvestorId();
    const app = makeApp({ userId: "admin-user", isAdmin: true });
    const res = await request(app)
      .post(`/api/investors/${targetId}/kyc`)
      .attach("files", Buffer.from("admin-doc"), {
        filename: "admin.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("Wave 2.5 PATCH — auth precedes validation", () => {
  it("defect #3: missing-identity all-invalid PATCH is 401, not 400", async () => {
    const id = seededInvestorId();
    const app = makeApp(null); // anonymous

    // An all-invalid body: mobileCountryCode '1' is a dial code, not ISO alpha-2.
    const res = await request(app)
      .patch(`/api/investors/${id}/profile`)
      .send({ contact: { mobileCountryCode: "1" } });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ message: "missing_identity" });
    // Must NOT be the interceptor's 400 Invalid patch.
    expect(res.body.message).not.toBe("Invalid patch");
  });

  it("cross-user all-invalid PATCH is 403, not 400", async () => {
    const id = seededInvestorId();
    const app = makeApp({ userId: "attacker-user", isAdmin: false });
    const res = await request(app)
      .patch(`/api/investors/${id}/profile`)
      .send({ contact: { mobileCountryCode: "1" } });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ message: "not_authorized" });
  });

  it("owner per-field partial patch still salvages valid fields + reports fieldErrors", async () => {
    const id = seededInvestorId();
    const app = makeApp({ userId: id, isAdmin: false });

    // One valid sub-field (role.screenName) + one invalid (bad mobileCountryCode).
    const res = await request(app)
      .patch(`/api/investors/${id}/profile`)
      .send({
        role: { screenName: "SalvageMe" },
        contact: { mobileCountryCode: "1" },
      });

    expect(res.status).toBe(200);
    // Valid field persisted…
    expect(res.body.role.screenName).toBe("SalvageMe");
    // …invalid field surfaced as a per-field error (no blanket revert).
    expect(res.body.fieldErrors).toBeTruthy();
    expect(Object.keys(res.body.fieldErrors)).toContain("contact.mobileCountryCode");
  });
});
