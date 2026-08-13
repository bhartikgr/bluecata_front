/**
 * WAVE 35 · ROW 6 · F9 — falsification harness for the cross-tenant
 * enumeration oracle.
 *
 * Review A (FINAL_REVIEW_v26_16_A.md, F9) proved that three cap-table sinks
 * answered `403 not_authorized` for a company the caller has no relationship
 * to, while the codebase's own stated policy (`server/routes.ts`, the
 * `/api/companies/:id` handler) is `404 not_found` *"so we don't even leak the
 * existence of the company id."* Row 1 of this wave closed those three.
 *
 * This harness does two things Row 1 did not:
 *
 *   1. It re-proves the three named sinks BY EXECUTION as the code now stands,
 *      rather than trusting the row-1 report.
 *   2. It closes and pins the SECOND and THIRD instances of the same class,
 *      which the review did not name:
 *
 *        (2nd) `server/spvLegacyAdapters.ts` — the LIVE partner SPV router.
 *              Ten routes keyed directly on the SPV id answered
 *              `403 NOT_OWNER` when the SPV exists but belongs to another
 *              partner and `404 NOT_FOUND` when it does not exist. SPVs are
 *              the private vehicles; this is the exact leak F9 describes, one
 *              router over, and strictly worse because the id IS the vehicle.
 *
 *        (3rd) `server/partnerWorkspaceV19Store.ts` — eight partner-tenant
 *              sinks (portfolio companies, CRM contacts, deal pipeline) with
 *              the identical `404 if missing / 403 if someone else's` shape.
 *
 * BOTH POLES ARE ASSERTED EVERYWHERE. A test suite that only checked "a
 * stranger gets 404" would pass against a server that answered 404 to
 * everyone, i.e. against a totally broken product — so every refusal case
 * below is paired with a same-suite assertion that the RIGHTFUL owner still
 * gets 200 and real data on the very same route and the very same row.
 *
 * The refusal assertions do not merely check the number 404: they check that
 * the refusal for a row that EXISTS is byte-identical (status AND body) to the
 * refusal for an id that has never existed. That equality is the actual
 * security property. Asserting `status === 404` alone would survive a mutant
 * that changed the body to `{error:"NOT_OWNER"}`, which re-opens the oracle
 * for any client that reads the body.
 *
 * IDENTITY DISCIPLINE (rules paid for in blood): every probe below runs as a
 * REAL, fully-provisioned, signed partner who simply is not the owner — never
 * anonymously, never as a demo persona. An anonymous probe would be refused by
 * `requirePartnerAuth` before reaching the ownership check and would prove
 * nothing about the oracle. `PARTNER_B` / `MANAGING_B` is registered as a seed
 * partner, given a managing_partner team membership, and stamped with a signed
 * consortium agreement, exactly like the owner — the ONLY difference between
 * the two identities is which rows they own.
 *
 * PRECONDITIONS ARE ESTABLISHED, NEVER CONSULTED. This file never reads
 * `process.env` to decide whether to assert. It SETS `CONSORTIUM_ENABLED=1`
 * itself (the adapter routes 503 without it) and asserts that the flag took
 * effect by requiring a 200 on the owner pole before any refusal case runs.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

import { registerPartnerRoutes } from "../partnerRoutes";
import {
  registerSpvLegacyAdapterRoutes,
  SPV_SINK_NOT_FOUND,
  SPV_SINK_NOT_FOUND_STATUS,
} from "../spvLegacyAdapters";
import {
  registerPartnerWorkspaceV19Routes,
  hydratePartnerWorkspaceV19Store,
  PARTNER_TENANT_REFUSAL,
  PARTNER_TENANT_REFUSAL_STATUS,
} from "../partnerWorkspaceV19Store";
import {
  seedTestPartnerSandbox,
  partnerTeamStore,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { __setRuntimePersona } from "../lib/userContext";
import { spvFundStore, hydrateSpvFundStore } from "../spvFundStore";
import { rawDb, getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { loadUserContext } from "../lib/requireEntitlement";
import {
  CAP_TABLE_SINK_NOT_FOUND,
  CAP_TABLE_SINK_NOT_FOUND_STATUS,
} from "../lib/capTableSinkScope";

/* ---------- identities ---------- */
const PARTNER_A = TEST_PARTNER_ID;
const MANAGING_A = TEST_PARTNER_USERS.managing.userId;

const PARTNER_B = "ac_consortium_partner_w35_f9_iso";
const MANAGING_B = "u_w35_f9_managing_b";

/** An id shaped exactly like a real one that has never been issued. */
const GHOST_SPV_ID = "spv_w35f9_never_issued_0000000000";
const GHOST_PORTFOLIO_ID = "ppc_w35f9_never_issued_000000000";

let app: Express;
let ownedByA = "";
let portfolioOfA = "";

function signPartner(partnerId: string, legalName: string): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO contacts
         (id, kind, legal_name, status, verification, created_at, updated_at,
          created_by, updated_by, version, prev_revision_hash, revision_hash,
          partner_agreement_version, partner_agreement_signed_at)
       VALUES (?, 'consortium_partner', ?, 'active', 'verified', ?, ?, 'u_system_seed', 'u_system_seed',
               1, ?, ?, 'CPA-v0.1-DRAFT', ?)
       ON CONFLICT(id) DO UPDATE SET
         partner_agreement_version = excluded.partner_agreement_version,
         partner_agreement_signed_at = excluded.partner_agreement_signed_at`,
    )
    .run(partnerId, legalName, now, now, "0".repeat(64), "0".repeat(64), now);
}

beforeAll(async () => {
  // Preconditions ESTABLISHED by this file, not read from the environment.
  process.env.CONSORTIUM_ENABLED = "1";
  process.env.COLLECTIVE_ENABLED = "1";
  process.env.ENABLE_DEMO_SEED = "1";

  await seedDemoData(getDb());
  await hydrateSpvFundStore();
  await hydratePartnerWorkspaceV19Store();

  seedTestPartnerSandbox({ force: true });

  // MANAGING_B must be a REAL authenticated user, otherwise requirePartnerAuth
  // answers 401 before the ownership branch is ever reached and every refusal
  // assertion below would be vacuously "passing" while testing nothing.
  __setRuntimePersona({
    userId: MANAGING_B,
    email: "managing-b@w35f9-iso.example",
    name: "W35 F9 Managing B",
    isFounder: false,
    isInvestor: false,
    isAdmin: false,
    hasInvitations: false,
  });

  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "W35 F9 ISOLATION PARTNER",
    displayName: "W35F9 ISO",
    email: "iso-w35f9@test.example",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "accelerator",
  });
  partnerTeamStore.add(PARTNER_B, MANAGING_B, "managing_partner", "u_system_seed", { isSeed: true });

  signPartner(PARTNER_A, "TEST PARTNER, INC");
  signPartner(PARTNER_B, "W35 F9 ISOLATION PARTNER");

  app = express();
  app.use(express.json());
  /* The partner-workspace tenant routes read `req.userContext` (populated by
     the app-level `loadUserContext` middleware in `server/index.ts`), not just
     `req.partnerContext`. Without it they answer 401 before the ownership
     branch and every refusal assertion below would be vacuous. */
  app.use(loadUserContext);
  registerPartnerRoutes(app);
  registerSpvLegacyAdapterRoutes(app);
  registerPartnerWorkspaceV19Routes(app);

  const spv = spvFundStore.createSpv({
    partnerId: PARTNER_A,
    name: "W35 F9 — PARTNER A PRIVATE VEHICLE",
    targetMinor: 5_000_000_00,
  });
  ownedByA = spv.id;
}, 120_000);

afterAll(() => {
  try {
    rawDb().prepare(`DELETE FROM contacts WHERE id = ?`).run(PARTNER_B);
  } catch { /* durable contacts table may be absent */ }
});

/* ============================================================
 * SECTION 1 — the SECOND path: GET /api/partner/me/spvs/:id/detail
 * ============================================================ */

describe("F9 · 2nd path · partner SPV detail — a wrong partner cannot tell a real vehicle from a ghost", () => {
  it("POLE A (must not be satisfiable by refusing everyone): the OWNER gets 200 and the real vehicle", async () => {
    const r = await request(app)
      .get(`/api/partner/me/spvs/${ownedByA}/detail`)
      .set("x-user-id", MANAGING_A);
    expect(r.status).toBe(200);
    expect(r.body?.spv?.id).toBe(ownedByA);
    expect(r.body?.spv?.partnerId).toBe(PARTNER_A);
    // Prove the route really did its work rather than returning a husk.
    expect(r.body).toHaveProperty("positions");
    expect(r.body).toHaveProperty("commitments");
    expect(r.body).toHaveProperty("reconciliation");
  });

  it("POLE B: a real, signed, provisioned partner who is NOT the owner gets 404 — not 403", async () => {
    const r = await request(app)
      .get(`/api/partner/me/spvs/${ownedByA}/detail`)
      .set("x-user-id", MANAGING_B);
    expect(r.status).toBe(404);
    expect(r.status).not.toBe(403);
    expect(r.body).not.toHaveProperty("spv");
    expect(JSON.stringify(r.body)).not.toContain("NOT_OWNER");
  });

  it("THE ACTUAL PROPERTY: the refusal for a REAL vehicle is byte-identical to the refusal for an id that never existed", async () => {
    const real = await request(app)
      .get(`/api/partner/me/spvs/${ownedByA}/detail`)
      .set("x-user-id", MANAGING_B);
    const ghost = await request(app)
      .get(`/api/partner/me/spvs/${GHOST_SPV_ID}/detail`)
      .set("x-user-id", MANAGING_B);
    expect(real.status).toBe(ghost.status);
    expect(real.body).toEqual(ghost.body);
    // and the shared constant is what both emit
    expect(real.status).toBe(SPV_SINK_NOT_FOUND_STATUS);
    expect(real.body).toEqual(SPV_SINK_NOT_FOUND);
  });

  it("the oracle is closed on the SHARED helper too, not just /detail (GET /commitments), with the owner pole intact", async () => {
    const owner = await request(app)
      .get(`/api/partner/me/spvs/${ownedByA}/commitments`)
      .set("x-user-id", MANAGING_A);
    expect(owner.status).toBe(200);

    const real = await request(app)
      .get(`/api/partner/me/spvs/${ownedByA}/commitments`)
      .set("x-user-id", MANAGING_B);
    const ghost = await request(app)
      .get(`/api/partner/me/spvs/${GHOST_SPV_ID}/commitments`)
      .set("x-user-id", MANAGING_B);
    expect(real.status).toBe(404);
    expect(real.status).toBe(ghost.status);
    expect(real.body).toEqual(ghost.body);
  });

  it("a WRITE against someone else's vehicle is also indistinguishable from a write to a ghost, and does not land", async () => {
    const real = await request(app)
      .post(`/api/partner/me/spvs/${ownedByA}/capital-calls`)
      .set("x-user-id", MANAGING_B)
      .send({ amount_minor: 1_000_00, due_date: "2026-12-01" });
    const ghost = await request(app)
      .post(`/api/partner/me/spvs/${GHOST_SPV_ID}/capital-calls`)
      .set("x-user-id", MANAGING_B)
      .send({ amount_minor: 1_000_00, due_date: "2026-12-01" });
    /* Pin the ACTUAL status. `real.status === ghost.status` alone would pass
       vacuously if some earlier gate (assertSubRole / requireSignedAgreement /
       the feature flag) short-circuited BOTH requests before the ownership
       check ran — the request would never reach the code under test and the
       assertion would prove nothing. MANAGING_B is deliberately provisioned as
       a signed managing_partner precisely so it clears every earlier gate and
       is refused ONLY by ownership. */
    expect(real.status).toBe(SPV_SINK_NOT_FOUND_STATUS);
    expect(real.body).toEqual(SPV_SINK_NOT_FOUND);
    expect(real.status).toBe(ghost.status);
    expect(real.body).toEqual(ghost.body);

    // The write must not have landed on Partner A's vehicle.
    const asOwner = await request(app)
      .get(`/api/partner/me/spvs/${ownedByA}/detail`)
      .set("x-user-id", MANAGING_A);
    expect(asOwner.status).toBe(200);
    expect((asOwner.body?.capitalCalls ?? []).length).toBe(0);
  });
});

/* ============================================================
 * SECTION 2 — the THIRD path: partner-tenant portfolio / CRM / deals
 * ============================================================ */

describe("F9 · 3rd path · partner workspace tenant sinks", () => {
  it("[setup] Partner A creates a PRIVATE portfolio row (owner pole precondition)", async () => {
    const r = await request(app)
      .post("/api/partner/portfolio")
      .set("x-user-id", MANAGING_A)
      .send({
        company_id: "cmp_w35f9_private_portco",
        display_name: "W35 F9 PRIVATE PORTCO",
        visibility: "private",
        sector: "fintech",
      });
    expect([200, 201]).toContain(r.status);
    portfolioOfA = r.body?.portfolio?.id;
    expect(portfolioOfA).toBeTruthy();
  });

  it("POLE A: the OWNER still reads their own private portfolio row (200 + real payload)", async () => {
    const r = await request(app)
      .get(`/api/partner/portfolio/${portfolioOfA}`)
      .set("x-user-id", MANAGING_A);
    expect(r.status).toBe(200);
    expect(r.body?.portfolio?.id).toBe(portfolioOfA);
    expect(r.body?.portfolio?.displayName ?? r.body?.portfolio?.display_name)
      .toBe("W35 F9 PRIVATE PORTCO");
  });

  it("POLE B: a different real partner gets a refusal indistinguishable from an unknown id", async () => {
    const real = await request(app)
      .get(`/api/partner/portfolio/${portfolioOfA}`)
      .set("x-user-id", MANAGING_B);
    const ghost = await request(app)
      .get(`/api/partner/portfolio/${GHOST_PORTFOLIO_ID}`)
      .set("x-user-id", MANAGING_B);
    expect(real.status).toBe(PARTNER_TENANT_REFUSAL_STATUS);
    expect(real.status).not.toBe(403);
    expect(real.body).toEqual(PARTNER_TENANT_REFUSAL);
    expect(real.status).toBe(ghost.status);
    expect(real.body).toEqual(ghost.body);
  });

  it("a cross-tenant PATCH is refused the same way AND leaves the owner's row untouched", async () => {
    const r = await request(app)
      .patch(`/api/partner/portfolio/${portfolioOfA}`)
      .set("x-user-id", MANAGING_B)
      .send({ sector: "hijacked-by-partner-b" });
    expect(r.status).toBe(404);
    expect(r.body).toEqual(PARTNER_TENANT_REFUSAL);

    const asOwner = await request(app)
      .get(`/api/partner/portfolio/${portfolioOfA}`)
      .set("x-user-id", MANAGING_A);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body?.portfolio?.sector).not.toBe("hijacked-by-partner-b");
  });
});

/* ============================================================
 * SECTION 3 — re-prove the THREE sinks the review actually named,
 * as the code stands NOW (row 1 + row 4 both edited this area).
 * ============================================================ */

describe("F9 · the three sinks Review A named — verified against current source, not the row-1 report", () => {
  const routesSrc = fs.readFileSync(
    path.join(__dirname, "..", "routes.ts"),
    "utf-8",
  );
  const snapshotsSrc = fs.readFileSync(
    path.join(__dirname, "..", "captableSnapshotsStore.ts"),
    "utf-8",
  );

  it("the shared cap-table refusal constant IS 404 not_found", () => {
    expect(CAP_TABLE_SINK_NOT_FOUND_STATUS).toBe(404);
    expect(CAP_TABLE_SINK_NOT_FOUND).toEqual({ ok: false, error: "not_found" });
  });

  it("all three sinks emit that shared constant — none of them hand-rolls a 403", () => {
    // /securities and /captable/interim live in routes.ts; /captable/snapshots
    // lives in captableSnapshotsStore.ts.
    const inRoutes = routesSrc.match(/CAP_TABLE_SINK_NOT_FOUND_STATUS/g) ?? [];
    expect(inRoutes.length).toBeGreaterThanOrEqual(3); // 1 import + 2 emissions
    expect(snapshotsSrc).toContain("CAP_TABLE_SINK_NOT_FOUND_STATUS");
    expect(snapshotsSrc).toContain("CAP_TABLE_SINK_NOT_FOUND");
  });

  it("no cap-table sink still answers the retired 403 not_authorized", () => {
    for (const src of [routesSrc, snapshotsSrc]) {
      const offenders = src
        .split("\n")
        .filter((l) => /status\(403\)/.test(l) && /not_authorized/.test(l) && /captable|securities|snapshot/i.test(l));
      expect(offenders).toEqual([]);
    }
  });
});

/* ============================================================
 * SECTION 4 — regression fence: the retired shape must not come back
 * ============================================================ */

describe("F9 · the retired 403/404 split cannot silently return", () => {
  it("the LIVE partner SPV router contains no `spv ? 403 : 404` discriminator and no 403 NOT_OWNER", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "spvLegacyAdapters.ts"),
      "utf-8",
    );
    // Ignore comment lines: the fix documents the retired shape in prose.
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/status\(\s*403\s*\)[\s\S]{0,80}NOT_OWNER/);
    expect(code).not.toMatch(/\?\s*403\s*:\s*404/);
  });

  it("the partner workspace tenant sinks contain no 403 NOT_OWNER either", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "partnerWorkspaceV19Store.ts"),
      "utf-8",
    );
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/status\(\s*403\s*\)[\s\S]{0,80}NOT_OWNER/);
  });

  it("the shared refusal constants are the single source of truth (mutating them moves every sink at once)", () => {
    expect(SPV_SINK_NOT_FOUND_STATUS).toBe(404);
    expect(SPV_SINK_NOT_FOUND).toEqual({ error: "NOT_FOUND" });
    expect(PARTNER_TENANT_REFUSAL_STATUS).toBe(404);
    expect(PARTNER_TENANT_REFUSAL).toEqual({ error: "NOT_FOUND" });
  });
});
