/**
 * v25.49 Phase-4C / Blocker 1 — ONE canonical SPV system (Ozan decision #4).
 *
 * The LEGACY plural surface (`/api/partner/me/spvs*`) is now a COMPATIBILITY
 * SHIM over the ONE canonical engine (spvEngineStore). This proves an SPV can
 * NEVER be created outside the canonical `spv` table: a create via the legacy
 * path lands in the canonical store and shows up in the canonical context
 * filters IMMEDIATELY (no reboot / no boot-time backfill), and it is subject to
 * the same fail-closed cross-partner isolation as the canonical route.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerPartnerFeeAdminRoutes } from "../lib/partnerFeeAdminRoutes";
import { seedTestPartnerSandbox, partnerSpvStore, partnerFundsStore } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const PARTNER_B = "ac_consortium_partner_spv_iso_b";

let app: express.Express;
function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}
function patch(path: string, user: string, body?: unknown) {
  return request(app).patch(path).set("x-user-id", user).send(body ?? {});
}
function get(path: string, user: string) {
  return request(app).get(path).set("x-user-id", user);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  // Admin SPV surface lives here — mounted so its canonical routing is testable.
  registerPartnerFeeAdminRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  // The admin SPV route validates the partner against the SQLite `contacts`
  // table (the canonical partner entity). The sandbox seeds an in-memory map,
  // so mirror a minimal consortium_partner row here for the admin-path tests.
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO contacts (id, kind, legal_name, display_name, email, status, verification, created_at, updated_at, created_by, updated_by, version, prev_revision_hash, revision_hash, tenant_id)
       VALUES (?, 'consortium_partner', 'TEST PARTNER, INC', 'TEST PARTNER, INC', 'ops@test-partner.example', 'active', 'verified', ?, ?, 'u_system_seed', 'u_system_seed', 1, ?, ?, 'tenant_platform')`,
    )
    .run(PARTNER_A, now, now, "0".repeat(64), "0".repeat(64));
});

describe("Blocker 1 — legacy SPV path is a shim over the ONE canonical engine", () => {
  it("a create via the LEGACY plural path lands in the canonical `spv` table", async () => {
    const r = await post("/api/partner/me/spvs", MANAGING, {
      spvName: "Legacy-Shim SPV",
      jurisdiction: "State of Delaware, USA", // legacy free-text is normalised
      vintage: 2025,
      currency: "USD",
      status: "open",
      // 1c — the legacy create path is now sign-off-gated (same as canonical).
      signoffLegalName: "Test Managing Partner",
      signoffAccepted: true,
    });
    expect(r.status).toBe(201);
    const spvId = r.body.spv.id as string;
    expect(spvId).toBeTruthy();
    // It IS in the canonical store (same object the canonical engine serves).
    const canonical = spvEngineStore.getSpv(PARTNER_A, spvId);
    expect(canonical).not.toBeNull();
    expect(canonical!.name).toBe("Legacy-Shim SPV");
    // Provenance preserved: original free-text jurisdiction kept in terms.
    expect((canonical!.terms as Record<string, unknown>).legacyShim).toBe(true);
    expect((canonical!.terms as Record<string, unknown>).legacyJurisdiction).toBe(
      "State of Delaware, USA",
    );
  });

  it("the legacy-created SPV shows up in the CANONICAL GP context filter with NO reboot", async () => {
    const created = await post("/api/partner/me/spvs", MANAGING, {
      spvName: "Canonical-Visible SPV",
      jurisdiction: "delaware",
      vintage: 2025,
      currency: "USD",
      status: "open",
      signoffLegalName: "Test Managing Partner",
      signoffAccepted: true,
    });
    expect(created.status).toBe(201);
    const spvId = created.body.spv.id as string;

    // Canonical engine route (NOT the legacy one) sees it immediately.
    const canonicalList = await get("/api/partner/me/spv", MANAGING);
    expect(canonicalList.status).toBe(200);
    expect(canonicalList.body.spvs.some((s: any) => s.id === spvId)).toBe(true);

    // And the canonical detail route resolves it.
    const canonicalDetail = await get(`/api/partner/me/spv/${spvId}`, MANAGING);
    expect(canonicalDetail.status).toBe(200);
    expect(canonicalDetail.body.spv.id).toBe(spvId);
  });

  it("the legacy list route now READS THROUGH the canonical store", async () => {
    const created = await post("/api/partner/me/spvs", MANAGING, {
      spvName: "Read-Through SPV",
      jurisdiction: "cayman",
      vintage: 2024,
      currency: "USD",
      status: "planned",
      signoffLegalName: "Test Managing Partner",
      signoffAccepted: true,
    });
    const spvId = created.body.spv.id as string;
    const legacyList = await get("/api/partner/me/spvs", MANAGING);
    expect(legacyList.status).toBe(200);
    expect(legacyList.body.spvs.some((s: any) => s.id === spvId)).toBe(true);
    // "planned" legacy status maps to canonical "draft".
    expect(created.body.spv.status).toBe("draft");
  });

  it("legacy-path creates are subject to canonical cross-partner isolation (fail-closed)", async () => {
    const created = await post("/api/partner/me/spvs", MANAGING, {
      spvName: "Isolated SPV",
      jurisdiction: "delaware",
      vintage: 2025,
      currency: "USD",
      status: "open",
      signoffLegalName: "Test Managing Partner",
      signoffAccepted: true,
    });
    const spvId = created.body.spv.id as string;
    // Partner B must NOT be able to see Partner A's legacy-created (canonical) SPV.
    expect(spvEngineStore.getSpv(PARTNER_B, spvId)).toBeNull();
  });
});

/**
 * Blocker 1 (4D) — EVERY SPV/fund surface routes through the canonical engine.
 * The round-2 review flagged three still-live NON-canonical write paths:
 *   • the ADMIN SPV create (/api/admin/partners/:partnerId/spvs),
 *   • the /api/partner/me/funds create, and
 *   • the legacy SPV update / position endpoints.
 * These tests prove each surface now lands in the canonical `spv` table and that
 * NO live route calls partnerSpvStore.create / .addPosition / partnerFundsStore.create.
 */
describe("Blocker 1 (4D) — no live route creates a non-canonical SPV/fund", () => {
  it("the ADMIN SPV create lands in the canonical `spv` table (not partnerSpvStore)", async () => {
    const spy = vi.spyOn(partnerSpvStore, "create");
    const r = await post(`/api/admin/partners/${PARTNER_A}/spvs`, "u_admin", {
      spvName: "Admin Canonical SPV",
      jurisdiction: "State of Delaware, USA",
      vintage: 2025,
      currency: "USD",
      status: "open",
    });
    expect(r.status).toBe(201);
    const spvId = r.body.spv.id as string;
    const canonical = spvEngineStore.getSpv(PARTNER_A, spvId);
    expect(canonical).not.toBeNull();
    expect(canonical!.name).toBe("Admin Canonical SPV");
    expect((canonical!.terms as Record<string, unknown>).legacyShim).toBe(true);
    // The non-canonical legacy store was NEVER written.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("the admin SPV list reads THROUGH the canonical engine", async () => {
    const created = await post(`/api/admin/partners/${PARTNER_A}/spvs`, "u_admin", {
      spvName: "Admin Listed SPV", jurisdiction: "delaware", vintage: 2025, currency: "USD", status: "open",
    });
    const spvId = created.body.spv.id as string;
    const list = await get(`/api/admin/partners/${PARTNER_A}/spvs`, "u_admin");
    expect(list.status).toBe(200);
    expect(list.body.spvs.some((s: any) => s.id === spvId)).toBe(true);
  });

  it("a /funds create lands as a canonical SPV with spvType='fund' (not partnerFundsStore)", async () => {
    const spy = vi.spyOn(partnerFundsStore, "create");
    const r = await post("/api/partner/me/funds", MANAGING, {
      fundName: "Canonical Fund I",
      fundType: "closed_end",
      jurisdiction: "delaware",
      vintage: 2025,
      currency: "USD",
      status: "raising",
      targetSizeMinor: 5000000,
    });
    expect(r.status).toBe(201);
    const fundId = r.body.fund.id as string;
    const canonical = spvEngineStore.getSpv(PARTNER_A, fundId);
    expect(canonical).not.toBeNull();
    expect(canonical!.spvType).toBe("fund");
    expect(canonical!.status).toBe("open"); // "raising" → canonical "open"
    expect((canonical!.terms as Record<string, unknown>).legacyShim).toBe(true);
    expect((canonical!.terms as Record<string, unknown>).fundType).toBe("closed_end");
    // The canonical fund shows up in the /funds list AND the canonical SPV list.
    const funds = await get("/api/partner/me/funds", MANAGING);
    expect(funds.body.funds.some((f: any) => f.id === fundId)).toBe(true);
    const spvList = await get("/api/partner/me/spv", MANAGING);
    expect(spvList.body.spvs.some((s: any) => s.id === fundId)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("the legacy SPV PATCH mutates the canonical row (no divergent legacy row)", async () => {
    const created = await post("/api/partner/me/spvs", MANAGING, {
      spvName: "Patch Target SPV", jurisdiction: "delaware", vintage: 2025, currency: "USD", status: "planned",
      signoffLegalName: "Test Managing Partner", signoffAccepted: true,
    });
    const spvId = created.body.spv.id as string;
    expect(created.body.spv.status).toBe("draft");
    const upd = await patch(`/api/partner/me/spvs/${spvId}`, MANAGING, { spvName: "Patched SPV Name", status: "open" });
    expect(upd.status).toBe(200);
    const canonical = spvEngineStore.getSpv(PARTNER_A, spvId);
    expect(canonical!.name).toBe("Patched SPV Name");
    expect(canonical!.status).toBe("open");
  });

  it("a legacy POSITION create writes THROUGH the canonical engine as a subscription (not addPosition)", async () => {
    const spy = vi.spyOn(partnerSpvStore, "addPosition");
    const created = await post("/api/partner/me/spvs", MANAGING, {
      spvName: "Position Host SPV", jurisdiction: "delaware", vintage: 2025, currency: "USD", status: "open",
      signoffLegalName: "Test Managing Partner", signoffAccepted: true,
    });
    const spvId = created.body.spv.id as string;
    const pos = await post(`/api/partner/me/spvs/${spvId}/positions`, MANAGING, {
      lpContactId: "inv_legacy_pos", positionAmountMinor: 100000, currency: "USD",
    });
    expect(pos.status).toBe(201);
    // The position is a canonical subscription in the investor register.
    const register = spvEngineStore.investorRegister(PARTNER_A, spvId);
    expect(register.some((x) => x.investorId === "inv_legacy_pos")).toBe(true);
    // The non-canonical legacy position store was NEVER written.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
