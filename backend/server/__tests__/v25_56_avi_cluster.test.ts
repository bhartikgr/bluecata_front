/**
 * v25.56 Avi cluster — real-Express-route tests.
 *
 * Item 4 (SACRED money-core gate swap): marking a soft-circle wire-funded now
 * requires the investor to have a SIGNED accreditation self-declaration instead
 * of completed KYC. We exercise the real route end to end:
 *   - soft-circle WITH investorUserId and NO declaration → 412 ACCREDITATION_REQUIRED
 *   - after recordAccreditationDeclaration(...) → 200 and a funded-queue row
 *     (KYC still incomplete, proving KYC no longer blocks funding)
 *   - admin caller bypasses the gate.
 *
 * Item 1a (NON-sacred avatar route): POST /api/investors/:id/avatar
 *   - owner (x-user-id === :id) uploads an image → 200 { ok:true }
 *   - a different authed user → 403 not_authorized
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { registerFounderUser } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";
import { createSoftCircle } from "../softCircleStore";
import { getFundedQueue } from "../captableCommitStore";
import { recordAccreditationDeclaration } from "../investorComplianceRoutes";

let app: Express;
let server: http.Server;
let port: number;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      baseUrl = `http://127.0.0.1:${port}`;
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
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
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
    email: `avi_${tag}_${Date.now()}@test.example`,
    name: `AVI ${tag}`,
    password: "testpassword123",
  });
  const companyId = `co_avi_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: `AVI ${tag} Corp`,
    legalName: `AVI ${tag} Corp, Inc.`,
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

describe("v25.56 item 4: accreditation self-declaration is the funding precondition (KYC no longer blocks)", () => {
  it("confirmed soft-circle WITH investorUserId and NO declaration → 412 ACCREDITATION_REQUIRED", async () => {
    const { userId, companyId } = makeFounderWithCompany("gate");
    const investorUserId = `inv_gate_${Date.now()}`;
    const roundId = `rnd_avi_gate_${Date.now()}`;
    const sc = createSoftCircle({
      roundId,
      companyId,
      investorName: "Ungated Angel",
      investorEmail: "ungated@test.example",
      investorUserId,
      amount: 40_000,
      status: "confirmed",
    });

    const before = getFundedQueue().filter((e) => e.roundId === roundId).length;
    const res = await call("POST", `/api/founder/rounds/${roundId}/soft-circle/${sc.id}/wire-funded`, { userId });

    expect(res.status).toBe(412);
    expect(res.body?.error).toBe("ACCREDITATION_REQUIRED");
    expect(res.body?.message).toContain("accredited-investor self-declaration");
    // Fail-closed: nothing reached the funded queue.
    const after = getFundedQueue().filter((e) => e.roundId === roundId).length;
    expect(after).toBe(before);
  });

  it("after signing the declaration → 200 and a funded-queue row (KYC still incomplete)", async () => {
    const { userId, companyId } = makeFounderWithCompany("signed");
    const investorUserId = `inv_signed_${Date.now()}`;
    const roundId = `rnd_avi_signed_${Date.now()}`;
    const sc = createSoftCircle({
      roundId,
      companyId,
      investorName: "Accredited Angel",
      investorEmail: "accredited@test.example",
      investorUserId,
      amount: 60_000,
      status: "confirmed",
    });

    // Record a valid self-declaration for the investor (no KYC docs uploaded).
    const decl = recordAccreditationDeclaration(investorUserId, {
      signatureName: "Accredited Angel",
      criteria: ["us_income"],
    });
    expect(decl.ok).toBe(true);

    const before = getFundedQueue().filter((e) => e.roundId === roundId).length;
    const res = await call("POST", `/api/founder/rounds/${roundId}/soft-circle/${sc.id}/wire-funded`, { userId });

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    const after = getFundedQueue().filter((e) => e.roundId === roundId);
    expect(after.length).toBe(before + 1);
  });
});

describe("v25.56 item 1a: investor avatar upload route", () => {
  function makeAuthedUser(tag: string): string {
    const { userId } = registerFounderUser({
      email: `ava_${tag}_${Date.now()}@test.example`,
      name: `AVA ${tag}`,
      password: "testpassword123",
    });
    return userId;
  }

  async function uploadAvatar(investorId: string, actingUserId: string) {
    const fd = new FormData();
    const blob = new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    fd.append("avatar", blob, "avatar.png");
    const res = await fetch(`${baseUrl}/api/investors/${investorId}/avatar`, {
      method: "POST",
      headers: { "x-user-id": actingUserId },
      body: fd,
    });
    let body: any = null;
    try { body = await res.json(); } catch { /* ignore */ }
    return { status: res.status, body };
  }

  it("owner uploads an image → 200 ok", async () => {
    const owner = makeAuthedUser("owner");
    const res = await uploadAvatar(owner, owner);
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.filename).toBe("avatar.png");
  });

  it("a different authed user → 403 not_authorized", async () => {
    const owner = makeAuthedUser("victim");
    const other = makeAuthedUser("attacker");
    const res = await uploadAvatar(owner, other);
    expect(res.status).toBe(403);
    expect(res.body?.message).toBe("not_authorized");
  });
});
