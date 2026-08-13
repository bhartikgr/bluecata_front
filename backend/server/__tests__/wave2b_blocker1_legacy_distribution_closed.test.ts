/**
 * WAVE 2B / BLOCKER 1 — the legacy PLURAL distribution ledger is fail-closed
 * ON THE SERVER, and a valid managing-partner request writes ZERO rows.
 *
 * Review B (build_log/WAVES_012_REVIEW_B.md, BLOCKER 1) showed that WAVE 2's
 * UI disable (client/src/pages/partner/PartnerSpvDetail.tsx:323-359) left the
 * capability live: an authenticated managing partner could still `fetch()`
 *   POST /api/partner/me/spvs/:id/distributions
 * from DevTools and persist to the legacy PLURAL `spv_distributions` table,
 * which canonical singular (`spv_distribution`) reporting cannot read.
 *
 * WHAT THIS FILE PROVES
 *   1. A FULLY VALID managing-partner request — signed agreement, owned SPV,
 *      schema-valid body, I-2 headroom available — returns 409
 *      LEGACY_DISTRIBUTION_LEDGER_DISABLED.
 *   2. It writes ZERO rows: `SELECT COUNT(*) FROM spv_distributions` for that
 *      SPV is unchanged, and the SPV's `distributed_minor` denormal is unchanged.
 *   3. The closure runs BEFORE body parsing: a body that would otherwise 400
 *      (INVALID_BODY) and a body that would otherwise 422 (I-2 breach) BOTH get
 *      409 instead, which is only possible if we never reach `safeParse` or the
 *      store.
 *   4. It is a CAPABILITY closure, not an authentication one: the middleware
 *      chain is untouched, so a viewer still gets 403 and never sees the 409.
 *   5. The GET (read) side is untouched — nothing that existed is lost.
 *   6. The same closure is applied to the RETIRED
 *      `spvFundStore.registerSpvFundRoutes` registrar, so no future re-mount
 *      re-opens the door.
 *
 * Run: npx vitest run server/__tests__/wave2b_blocker1_legacy_distribution_closed.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { CONSORTIUM_AGREEMENT_VERSION } from "@shared/consortiumAgreement";

import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvLegacyAdapterRoutes } from "../spvLegacyAdapters";
import { registerSpvFundRoutes, spvFundStore, hydrateSpvFundStore } from "../spvFundStore";
import {
  seedTestPartnerSandbox,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { rawDb, getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { LEGACY_DISTRIBUTION_LEDGER_DISABLED } from "../lib/legacyDistributionLedger";

const MANAGING = TEST_PARTNER_USERS.managing.userId;
const VIEWER = TEST_PARTNER_USERS.viewer.userId;
const PARTNER_A = TEST_PARTNER_ID;

/** LIVE app: the registrar server/routes.ts:1134 actually mounts. */
let app: Express;
/** RETIRED registrar, mounted on its own app so the closure is proven there too. */
let retiredApp: Express;

let spvId: string;

function signPartner(partnerId: string, version = CONSORTIUM_AGREEMENT_VERSION): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO contacts
         (id, kind, legal_name, status, verification, created_at, updated_at,
          created_by, updated_by, version, prev_revision_hash, revision_hash,
          partner_agreement_version, partner_agreement_signed_at)
       VALUES (?, 'consortium_partner', ?, 'active', 'verified', ?, ?, 'u_test', 'u_test',
               1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         partner_agreement_version = excluded.partner_agreement_version,
         partner_agreement_signed_at = excluded.partner_agreement_signed_at`,
    )
    .run(partnerId, "WAVE 2B Blocker 1 Partner", now, now, "0".repeat(64), "0".repeat(64), version, now);
}

/** Row count in the LEGACY PLURAL ledger for one SPV. */
function pluralLedgerRowCount(id: string): number {
  const r = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM spv_distributions WHERE spv_id = ?`)
    .get(id) as { n: number };
  return r.n;
}

/** The denormalised running total the legacy write also mutates. */
function distributedMinor(id: string): number {
  const r = rawDb()
    .prepare(`SELECT distributed_minor AS d FROM spvs WHERE id = ?`)
    .get(id) as { d: number } | undefined;
  return r?.d ?? -1;
}

const VALID_BODY = {
  distribution_type: "dividend" as const,
  total_minor: 10_000_00,
  distributed_at: new Date().toISOString(),
};

beforeAll(async () => {
  process.env.CONSORTIUM_ENABLED = "1";
  process.env.ENABLE_DEMO_SEED = "1";

  await seedDemoData(getDb());
  await hydrateSpvFundStore();

  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvLegacyAdapterRoutes(app);

  retiredApp = express();
  retiredApp.use(express.json());
  registerSpvFundRoutes(retiredApp);

  seedTestPartnerSandbox({ force: true });
  signPartner(PARTNER_A);

  // An SPV with real I-2 headroom, so a distribution WOULD have succeeded.
  const spv = spvFundStore.createSpv({
    partnerId: PARTNER_A,
    name: "WAVE 2B Blocker 1 SPV",
    targetMinor: 1_000_000_00,
  });
  spvId = spv.id;
  spvFundStore.addCommitment({
    spvId,
    lpUserId: "u_wave2b_lp",
    amountMinor: 500_000_00,
  });
}, 30_000);

afterAll(() => {
  rawDb().prepare(`DELETE FROM contacts WHERE id = ?`).run(PARTNER_A);
});

describe("WAVE 2B BLOCKER 1 — legacy plural distribution ledger is closed server-side", () => {
  it("a FULLY VALID managing-partner POST returns 409 LEGACY_DISTRIBUTION_LEDGER_DISABLED", async () => {
    const r = await request(app)
      .post(`/api/partner/me/spvs/${spvId}/distributions`)
      .set("x-user-id", MANAGING)
      .send(VALID_BODY);

    expect(r.status).toBe(409);
    expect(r.body.error).toBe(LEGACY_DISTRIBUTION_LEDGER_DISABLED);
    // The message must point the operator at the canonical singular route.
    expect(r.body.message).toContain("/api/partner/me/spv/:spvId/distributions");
  });

  it("that same request writes ZERO rows to the plural ledger and moves no denormal", async () => {
    const rowsBefore = pluralLedgerRowCount(spvId);
    const totalBefore = distributedMinor(spvId);

    // Five valid attempts, exactly as a DevTools replay loop would issue them.
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post(`/api/partner/me/spvs/${spvId}/distributions`)
        .set("x-user-id", MANAGING)
        .send({ ...VALID_BODY, total_minor: 1_000_00 * (i + 1) });
      expect(r.status).toBe(409);
      expect(r.body.distribution).toBeUndefined();
      expect(r.body.ok).toBeUndefined();
    }

    expect(pluralLedgerRowCount(spvId)).toBe(rowsBefore);
    expect(distributedMinor(spvId)).toBe(totalBefore);
    // Belt and braces: the in-memory cache the store also mutates is untouched.
    expect(spvFundStore.listDistributions(spvId).length).toBe(rowsBefore);
  });

  it("fails closed BEFORE body parsing — a would-be 400 body also gets 409", async () => {
    const r = await request(app)
      .post(`/api/partner/me/spvs/${spvId}/distributions`)
      .set("x-user-id", MANAGING)
      .send({ total_minor: -1, distribution_type: "not_a_real_enum_value" });
    // Reaching safeParse would have produced 400 INVALID_BODY. It does not.
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(LEGACY_DISTRIBUTION_LEDGER_DISABLED);
    expect(r.body.details).toBeUndefined();
  });

  it("fails closed BEFORE the store — a would-be 422 I-2 breach also gets 409", async () => {
    const r = await request(app)
      .post(`/api/partner/me/spvs/${spvId}/distributions`)
      .set("x-user-id", MANAGING)
      // Far in excess of committed_minor: the store would have thrown
      // INVARIANT_DISTRIBUTION_EXCEEDS_COMMITMENTS -> 422.
      .send({ distribution_type: "exit", total_minor: 99_999_999_00 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(LEGACY_DISTRIBUTION_LEDGER_DISABLED);
  });

  it("is a CAPABILITY closure, not an auth change — a viewer still gets 403, not 409", async () => {
    const r = await request(app)
      .post(`/api/partner/me/spvs/${spvId}/distributions`)
      .set("x-user-id", VIEWER)
      .send(VALID_BODY);
    expect(r.status).toBe(403);
    expect(r.body.error).not.toBe(LEGACY_DISTRIBUTION_LEDGER_DISABLED);
  });

  it("the READ side is untouched — GET /distributions still serves 200", async () => {
    const r = await request(app)
      .get(`/api/partner/me/spvs/${spvId}/distributions`)
      .set("x-user-id", MANAGING);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.distributions)).toBe(true);
  });

  it("the RETIRED registerSpvFundRoutes registrar is closed too (no re-mount reopens it)", async () => {
    const rowsBefore = pluralLedgerRowCount(spvId);
    const r = await request(retiredApp)
      .post(`/api/partner/me/spvs/${spvId}/distributions`)
      .set("x-user-id", MANAGING)
      .send(VALID_BODY);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(LEGACY_DISTRIBUTION_LEDGER_DISABLED);
    expect(pluralLedgerRowCount(spvId)).toBe(rowsBefore);
  });

  it("the CANONICAL singular engine route is NOT closed by this change", async () => {
    // Guard against over-reach: only the plural route may be affected. We assert
    // the singular path does not answer with the plural closure code. (Its own
    // business rules may still reject the request; that is not this test's
    // concern.)
    const r = await request(app)
      .post(`/api/partner/me/spv/${spvId}/distributions`)
      .set("x-user-id", MANAGING)
      .send({ event: "exit", grossProceedsMinor: 1_000_00, currency: "USD" });
    expect(r.body?.error).not.toBe(LEGACY_DISTRIBUTION_LEDGER_DISABLED);
  });
});
