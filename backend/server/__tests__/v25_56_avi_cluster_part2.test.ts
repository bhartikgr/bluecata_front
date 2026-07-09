/**
 * v25.56 Avi cluster — part 2 (post-verify hardening tests, real Express routes).
 *
 * Item 2 (NON-sacred provisioning): redeeming a round invitation now writes a
 * POPULATED durable investor profile (first/last/email from the invitation) so
 * the investor's contact validates + round-trips instead of synthesising blank.
 *   - issue a legacy invitation → redeem it via the real /api/invitations/redeem
 *     route → the profile GET returns firstName/lastName/email from the invite
 *   - a subsequent contact PATCH (city + stateProvince) persists + round-trips
 *
 * Item 3 (NON-sacred admin verify + PREVIEW-SAFETY, verifies Fix #1): a
 * `derived_inv_<invId>` contact is materialized into the real `contacts` table
 * ONLY on the applied (x-confirm) path:
 *   - preview verify (NO x-confirm) → 409 and NO real contacts row is created
 *   - confirmed verify (x-confirm: true) → 200 and a real row now exists as
 *     verification "verified"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { registerRoutes } from "../routes";
import { registerFounderUser } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";
import { createRound } from "../roundsStore";
import { _testAccessInvitations } from "../roundInvitationsStore";
import { getAllContacts } from "../adminContactsStore";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string; confirm?: boolean } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    if (opts.confirm) headers["x-confirm"] = "true";
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: any = null;
        try { body = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function makeFounderWithCompany(tag: string): { userId: string; companyId: string } {
  const { userId } = registerFounderUser({
    email: `avi2_${tag}_${Date.now()}@test.example`,
    name: `AVI2 ${tag}`,
    password: "testpassword123",
  });
  const companyId = `co_avi2_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: `AVI2 ${tag} Corp`,
    legalName: `AVI2 ${tag} Corp, Inc.`,
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: {
      capTableHolders: 0,
      activeRoundsCount: 0,
      raisedThisYearUsd: 0,
      dataroomFiles: 0,
      pendingSoftCircles: 0,
      ownershipPct: 1.0,
    },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
    sector: "SaaS",
    stage: "Pre-Seed",
    hq: "US",
  } as any);
  return { userId, companyId };
}

describe("v25.56 item 2: invitation redemption provisions a populated, round-trippable profile", () => {
  it("redeemed investor profile is populated from the invite and a contact PATCH persists", async () => {
    const { userId: founder, companyId } = makeFounderWithCompany("prov");
    const round = createRound({ companyId, name: "AVI2 Seed", type: "SAFE", state: "open" });

    const inviteeEmail = `redeem_${Date.now()}@investor.example`;
    const inviteeName = "Redeem Investor";

    // Founder issues a single-use invitation (legacy path returns the raw token).
    const issued = await call("POST", `/api/rounds/${round.id}/invitations/issue`, {
      userId: founder,
      body: { inviteeEmail, inviteeName },
    });
    expect(issued.status).toBe(200);
    const token = issued.body?.tokenForEmail as string;
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    // Investor redeems (PUBLIC — no auth). Response ctx carries the new userId.
    const redeemed = await call("POST", "/api/invitations/redeem", { body: { token } });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body?.ok).toBe(true);
    const investorId = redeemed.body?.ctx?.userId as string;
    expect(typeof investorId).toBe("string");
    expect(investorId.length).toBeGreaterThan(0);

    // Profile GET returns the POPULATED contact (first/last/email from the invite),
    // not a blank synthesised one.
    const prof = await call("GET", `/api/investors/${investorId}/profile`, { userId: investorId });
    expect(prof.status).toBe(200);
    expect(prof.body?.contact?.firstName).toBe("Redeem");
    expect(prof.body?.contact?.lastName).toBe("Investor");
    expect(prof.body?.contact?.email).toBe(inviteeEmail);

    // A subsequent contact PATCH (city + stateProvince) persists...
    const patched = await call("PATCH", `/api/investors/${investorId}/profile`, {
      userId: investorId,
      body: { contact: { city: "Austin", stateProvince: "Texas" } },
    });
    expect(patched.status).toBe(200);
    expect(patched.body?.contact?.city).toBe("Austin");
    expect(patched.body?.contact?.stateProvince).toBe("Texas");

    // ...and round-trips via a fresh GET.
    const reread = await call("GET", `/api/investors/${investorId}/profile`, { userId: investorId });
    expect(reread.status).toBe(200);
    expect(reread.body?.contact?.city).toBe("Austin");
    expect(reread.body?.contact?.stateProvince).toBe("Texas");
    // Identity from the invitation is preserved across the edit.
    expect(reread.body?.contact?.email).toBe(inviteeEmail);
    expect(reread.body?.contact?.firstName).toBe("Redeem");
  });
});

describe("v25.56 item 3: derived contact materializes ONLY on the applied (x-confirm) path", () => {
  function seedRedeemedInvitation(tag: string): { invId: string; derivedId: string; email: string } {
    const invId = `inv_avi2_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const email = `derived_${tag}_${Date.now()}@investor.example`;
    const now = new Date().toISOString();
    // Push an ACCEPTED invitation so getRedeemedRecords() surfaces the derived
    // contact `derived_inv_<invId>` (read-only projection, never persisted).
    _testAccessInvitations.rows.push({
      id: invId,
      tenantId: "tenant_co_test",
      roundId: `rnd_avi2_${tag}`,
      companyId: `co_avi2_${tag}`,
      investorEmail: email,
      investorName: "Derived Angel",
      state: "accepted",
      classification: "new_registration",
      tokenHash: randomBytes(32).toString("hex"),
      invitedByUserId: "u_founder_test",
      note: null,
      sentAt: now,
      viewedAt: null,
      redeemedAt: now,
      redeemedByUserId: "u_investor_derived",
      expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      createdAt: now,
      updatedAt: now,
    } as any);
    return { invId, derivedId: `derived_inv_${invId}`, email };
  }

  it("preview verify (NO x-confirm) → 409 and creates NO real contacts row", async () => {
    const { derivedId } = seedRedeemedInvitation("preview");

    // Sanity: not yet a real row.
    expect(getAllContacts().some((c) => c.id === derivedId)).toBe(false);

    const preview = await call("POST", `/api/admin/contacts/${derivedId}/verify`, {
      userId: "u_admin",
    });
    expect(preview.status).toBe(409);
    expect(preview.body?.error).toBe("confirmation_required");
    expect(preview.body?.proposedChange?.verification).toBe("verified");

    // Fix #1: the preview path must NOT have materialized a real row.
    expect(getAllContacts().some((c) => c.id === derivedId)).toBe(false);
  });

  it("confirmed verify (x-confirm: true) → 200 and a real verified contacts row exists", async () => {
    const { derivedId } = seedRedeemedInvitation("confirm");
    expect(getAllContacts().some((c) => c.id === derivedId)).toBe(false);

    const verified = await call("POST", `/api/admin/contacts/${derivedId}/verify`, {
      userId: "u_admin",
      confirm: true,
    });
    expect(verified.status).toBe(200);
    expect(verified.body?.ok).toBe(true);
    expect(verified.body?.contact?.verification).toBe("verified");

    // A real contacts row now exists (materialized on the applied path), verified.
    const row = getAllContacts().find((c) => c.id === derivedId);
    expect(row).toBeTruthy();
    expect(row?.verification).toBe("verified");
  });
});
