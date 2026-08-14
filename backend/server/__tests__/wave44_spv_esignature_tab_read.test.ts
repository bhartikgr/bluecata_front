/**
 * WAVE 44 · DEFECT 2 — the SPV E-signature tab rendered
 * "We couldn't find what you were looking for." on vehicles that exist.
 *
 * ROOT CAUSE, ESTABLISHED BY EXECUTION (not by reading code)
 * ---------------------------------------------------------
 * `GET /api/partner/me/spvs/:spvId/esignature` resolved the vehicle from the
 * LEGACY partner-workspace table `spvs`. The id the SPV detail tabs hold is the
 * CANONICAL ENGINE id from table `spv`. For two whole classes of vehicle no
 * `spvs` row exists under that id:
 *
 *   - boot-migrated SPVs, whose engine id is `spv_mig_<sha256(legacyId)>` while
 *     the legacy row keeps the ORIGINAL id (spvEngineStore.ts:2569);
 *   - boot-migrated FUNDS, which came from `partner_funds` and never had a
 *     `spvs` row at all (spvEngineStore.ts:2604);
 *   - plus any SPV whose non-fatal legacy shadow-persist failed
 *     (spvEngineStore.ts:448 warns and continues).
 *
 * so the read 404'd and the client mapped 404 to the not-found copy
 * (client/src/lib/queryClient.ts:36). An existing vehicle was reported missing.
 *
 * BOTH POLES ARE ASSERTED:
 *   POLE A (the fix)   — an engine-only vehicle owned by the caller resolves,
 *                        returns 200, and reports its EMPTINESS honestly
 *                        (`envelopes: []`), which is what the panel's existing
 *                        `spv-esign-empty` state renders. An empty state is not
 *                        an error state (R6).
 *   POLE B (the fence) — the widened read grants nothing. Another partner's
 *                        engine vehicle is still 404 (not 403, no enumeration),
 *                        an unknown id is still 404, and an archived engine
 *                        vehicle with no legacy mirror is still 404.
 *
 * ANTI-VACUITY: the RED state is demonstrated in the same run by querying the
 * legacy table directly and proving the row genuinely is not there — so POLE A
 * cannot pass for the wrong reason (e.g. a shadow row quietly existing).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";

import { registerEsignatureRoutes } from "../lib/esignatureRoutes";
import { rawDb } from "../db/connection";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";

/* The seeded sandbox partner and its two team members (managing / viewer) are
 * the only partner identities the production identity resolver knows in test
 * mode (server/lib/userContext.ts PERSONAS), so the fixture uses them rather
 * than inventing users the resolver would 401. */
const OWNER_PARTNER = "ac_consortium_partner_test_partner_inc";
const OTHER_PARTNER = "ac_consortium_partner_w44_other";
const MANAGING = "u_avi_managing";
const VIEWER = "u_avi_viewer";

let app: express.Express;

/** An ENGINE-ONLY vehicle: a row in `spv`, deliberately NO row in `spvs`.
 *  This is exactly the shape a boot-migrated SPV or fund has. */
function makeEngineOnlyVehicle(partnerId: string, opts: { archived?: boolean } = {}): string {
  const id = `spv_mig_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO spv (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
                        distribution_scope, currency, carry_basis, lp_visibility, created_at, updated_at,
                        archived_at, curr_hash)
       VALUES (?, ?, NULL, ?, 'spv', 'delaware', 'fundraising', 'private', 'USD', 'whole_spv', 'own_only', ?, ?, ?, ?)`,
    )
    .run(
      id,
      partnerId,
      `W44 Engine-Only Vehicle ${id.slice(-6)}`,
      now,
      now,
      opts.archived ? now : null,
      "0".repeat(64),
    );
  return id;
}

function legacyMirrorRowCount(spvId: string): number {
  const row = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM spvs WHERE id = ?`)
    .get(spvId) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

function get(path: string, user?: string) {
  const r = request(app).get(path);
  return user ? r.set("x-user-id", user) : r;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerEsignatureRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

describe("WAVE 44 · DEFECT 2 — SPV e-signature tab resolves the vehicle it is rendered for", () => {
  it("POLE A: an engine-only vehicle returns 200 with an HONEST EMPTY list, not a not-found error", async () => {
    const spvId = makeEngineOnlyVehicle(OWNER_PARTNER);

    // ANTI-VACUITY — prove the RED condition really holds: the legacy table the
    // route used to read has NO row for this id. If this were non-zero the
    // assertion below would pass for the wrong reason.
    expect(
      legacyMirrorRowCount(spvId),
      "the fixture must be engine-only or it does not reproduce the defect",
    ).toBe(0);
    const engineRow = rawDb()
      .prepare(`SELECT sponsor_partner_id AS pid FROM spv WHERE id = ?`)
      .get(spvId) as { pid: string } | undefined;
    expect(engineRow?.pid, "the vehicle must exist in the canonical engine table").toBe(OWNER_PARTNER);

    const res = await get(`/api/partner/me/spvs/${spvId}/esignature`, MANAGING);

    expect(res.status, `expected 200, body=${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.spvId).toBe(spvId);
    // Honest emptiness (R6): the panel is told "no envelopes", not "not found".
    expect(Array.isArray(res.body.envelopes)).toBe(true);
    expect(res.body.envelopes.length).toBe(0);
    expect(res.body.error, "an empty state must not carry an error").toBeUndefined();
    // The response must state WHICH honest zero this is: schema present and
    // nothing recorded, or schema not installed.
    expect(typeof res.body.schemaInstalled).toBe("boolean");
  });

  it("POLE A2: a legacy-only vehicle still resolves — the old seam is not broken", async () => {
    const legacyId = `spv_legacy_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const now = new Date().toISOString();
    rawDb()
      .prepare(
        `INSERT INTO spvs (id, tenant_id, partner_id, name, structure_type, status, target_minor, created_at, updated_at)
         VALUES (?, 'tenant_capavate', ?, ?, 'spv', 'fundraising', 0, ?, ?)`,
      )
      .run(legacyId, OWNER_PARTNER, "W44 Legacy-Only Vehicle", now, now);
    const engineCount = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM spv WHERE id = ?`)
      .get(legacyId) as { n: number };
    expect(Number(engineCount.n), "fixture must be legacy-only").toBe(0);

    const res = await get(`/api/partner/me/spvs/${legacyId}/esignature`, MANAGING);
    expect(res.status, `expected 200, body=${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.envelopes).toEqual([]);
  });

  it("POLE B: the widened read grants nothing — cross-partner, unknown and archived ids are still 404", async () => {
    const mine = makeEngineOnlyVehicle(OWNER_PARTNER);
    // control: the owner CAN read its own vehicle, so the refusals below are
    // about the fence and not about the route being dead again.
    expect((await get(`/api/partner/me/spvs/${mine}/esignature`, MANAGING)).status).toBe(200);

    const theirs = makeEngineOnlyVehicle(OTHER_PARTNER);
    const crossTenant = await get(`/api/partner/me/spvs/${theirs}/esignature`, MANAGING);
    expect(crossTenant.status, "cross-tenant refusal is 404, never 403").toBe(404);
    expect(crossTenant.body.error).toBe("not_found");

    const unknown = await get(`/api/partner/me/spvs/spv_does_not_exist_at_all/esignature`, MANAGING);
    expect(unknown.status).toBe(404);

    const archivedId = makeEngineOnlyVehicle(OWNER_PARTNER, { archived: true });
    expect(legacyMirrorRowCount(archivedId)).toBe(0);
    const archived = await get(`/api/partner/me/spvs/${archivedId}/esignature`, MANAGING);
    expect(archived.status, "an archived engine vehicle stays 404 — the soft-delete fence holds").toBe(404);
  });

  it("POLE B2: the subrole and auth gates are untouched — viewer 403, anonymous 401", async () => {
    const spvId = makeEngineOnlyVehicle(OWNER_PARTNER);
    const viewer = await get(`/api/partner/me/spvs/${spvId}/esignature`, VIEWER);
    /* A subrole refusal is 403 with its own code — NOT the 404 the live tab
       showed. This is the evidence that the live symptom came from the vehicle
       read and not from the managing_partner gate. */
    expect(viewer.status).toBe(403);
    expect(String(viewer.body.error)).toMatch(/SUBROLE|SUB_ROLE/);

    const anon = await get(`/api/partner/me/spvs/${spvId}/esignature`);
    expect([401, 403]).toContain(anon.status);
    expect(anon.status, "an unauthenticated caller must never receive vehicle data").not.toBe(200);
  });
});
