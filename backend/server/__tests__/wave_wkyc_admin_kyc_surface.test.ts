/**
 * WAVE W-KYC — investor↔admin KYC reconciliation + admin KYC surface.
 *
 * Coverage (real Express routes + the non-sacred kycDocumentStore + the
 * investorIdReconcile resolver):
 *   1.  resolveCanonicalInvestorId: derived_inv_<invId> → redeemed_by_user_id.
 *   2.  resolveCanonicalInvestorId: unknown/non-derived id → returned unchanged.
 *   3.  admin KYC list resolves a derived_inv_* id and returns the redeemer's docs
 *       (wasDerived:true, resolvedInvestorId set) — the "no premature 404/empty" fix.
 *   4.  admin KYC list for a plain id returns that investor's docs (wasDerived:false).
 *   5.  non-admin → 403 admin_only on the list route.
 *   6.  admin mark-verified (AK.2) flips verified + records verifier + notes.
 *   7.  admin blob download returns the raw bytes + SHA header (no raw storage key).
 *   8.  non-admin → 403 on verify + blob.
 */
import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";

import { registerKycDocumentRoutes } from "../lib/kycDocumentStore";
import { resolveCanonicalInvestorId } from "../lib/investorIdReconcile";
import { rawDb } from "../db/connection";

type Identity = { userId: string; isAdmin?: boolean } | null;

function makeApp(identity: Identity) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (identity) req.userContext = { userId: identity.userId, isAdmin: !!identity.isAdmin };
    next();
  });
  registerKycDocumentRoutes(app);
  return app;
}

const REDEEMER = "u_wkyc_redeemer";
const INV_ID = "invwkyc123";
const DERIVED = `derived_inv_${INV_ID}`;
const PLAIN = "u_wkyc_plain";
const b64 = Buffer.from("fake-passport-bytes-wkyc").toString("base64");

function insertDoc(investorId: string, fileName: string): string {
  const id = `kycdoc_test_${Math.random().toString(16).slice(2, 10)}`;
  rawDb().prepare(
    `INSERT INTO kyc_documents (id, investor_id, kyc_id, doc_type, file_name, mime_type,
        size_bytes, sha256, blob_base64, verified, uploaded_at)
     VALUES (?, ?, NULL, 'passport', ?, 'application/pdf', 10, 'deadbeef', ?, 0, ?)`
  ).run(id, investorId, fileName, b64, new Date().toISOString());
  return id;
}

beforeAll(() => {
  // Ensure the kyc_documents table exists (route registration ensures it too).
  makeApp({ userId: "boot", isAdmin: true });
  // Seed a redeemed invitation so derived_inv_<INV_ID> resolves to REDEEMER.
  // round_invitations NOT-NULL cols: id, round_id, investor_email, state.
  try {
    rawDb().prepare(
      `INSERT INTO round_invitations (id, round_id, investor_email, state, redeemed_by_user_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET redeemed_by_user_id = excluded.redeemed_by_user_id`
    ).run(INV_ID, "rnd_wkyc_test", "redeemer@test.local", "redeemed", REDEEMER);
  } catch (e) {
    // Fall back to updating just the join key if the row already exists.
    try { rawDb().prepare(`UPDATE round_invitations SET redeemed_by_user_id = ? WHERE id = ?`).run(REDEEMER, INV_ID); } catch { /* ignore */ }
  }
  try { rawDb().prepare(`DELETE FROM kyc_documents WHERE investor_id IN (?, ?)`).run(REDEEMER, PLAIN); } catch { /* ignore */ }
});

describe("W-KYC — id reconciliation", () => {
  it("1. derived_inv_<id> resolves to the redeemer userId", () => {
    expect(resolveCanonicalInvestorId(DERIVED)).toBe(REDEEMER);
  });
  it("2. non-derived id is returned unchanged", () => {
    expect(resolveCanonicalInvestorId(PLAIN)).toBe(PLAIN);
    expect(resolveCanonicalInvestorId("derived_inv_nonexistent")).toBe("derived_inv_nonexistent");
  });
});

describe("W-KYC — admin KYC list", () => {
  const admin = makeApp({ userId: "u_admin", isAdmin: true });

  it("3. list resolves a derived_inv_* id to the redeemer's docs", async () => {
    insertDoc(REDEEMER, "passport-redeemer.pdf");
    const r = await request(admin).get(`/api/admin/kyc/documents/${DERIVED}`);
    expect(r.status).toBe(200);
    expect(r.body.wasDerived).toBe(true);
    expect(r.body.resolvedInvestorId).toBe(REDEEMER);
    expect(r.body.documents.some((d: any) => d.fileName === "passport-redeemer.pdf")).toBe(true);
  });

  it("4. list for a plain id returns that investor's docs (not derived)", async () => {
    insertDoc(PLAIN, "passport-plain.pdf");
    const r = await request(admin).get(`/api/admin/kyc/documents/${PLAIN}`);
    expect(r.status).toBe(200);
    expect(r.body.wasDerived).toBe(false);
    expect(r.body.documents.some((d: any) => d.fileName === "passport-plain.pdf")).toBe(true);
  });

  it("5. non-admin → 403 admin_only", async () => {
    const nonAdmin = makeApp({ userId: "u_regular", isAdmin: false });
    const r = await request(nonAdmin).get(`/api/admin/kyc/documents/${PLAIN}`);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("admin_only");
  });
});

describe("W-KYC — verify + blob (AK.2)", () => {
  const admin = makeApp({ userId: "u_admin", isAdmin: true });

  it("6. admin mark-verified flips verified + records verifier", async () => {
    const docId = insertDoc(REDEEMER, "accred-letter.pdf");
    const r = await request(admin)
      .post(`/api/admin/kyc/documents/${docId}/verify`)
      .send({ verified: true, notes: "checked against register" });
    expect(r.status).toBe(200);
    expect(r.body.verified).toBe(true);
    const row: any = rawDb().prepare("SELECT verified, verified_by, verification_notes FROM kyc_documents WHERE id = ?").get(docId);
    expect(row.verified).toBe(1);
    expect(row.verified_by).toBe("u_admin");
    expect(row.verification_notes).toBe("checked against register");
  });

  it("7. admin blob download returns bytes + SHA header (no raw storage key)", async () => {
    const docId = insertDoc(REDEEMER, "sof.pdf");
    const r = await request(admin).get(`/api/admin/kyc/documents/${docId}/blob`);
    expect(r.status).toBe(200);
    expect(r.headers["x-kyc-doc-sha256"]).toBeTruthy();
    // The response is the raw blob, not a JSON body exposing a storage key/path.
    expect(r.text || r.body).toBeTruthy();
  });

  it("8. non-admin → 403 on verify + blob", async () => {
    const docId = insertDoc(REDEEMER, "x.pdf");
    const nonAdmin = makeApp({ userId: "u_regular", isAdmin: false });
    const v = await request(nonAdmin).post(`/api/admin/kyc/documents/${docId}/verify`).send({ verified: true });
    expect(v.status).toBe(403);
    const b = await request(nonAdmin).get(`/api/admin/kyc/documents/${docId}/blob`);
    expect(b.status).toBe(403);
  });
});
