/* ════════════════════════════════════════════════════════════════════════════
   WAVE 154 · BATCH 2 · ITEM K.7 — SPV-ON-BEHALF NOW REQUIRES A SIGNED AGREEMENT.
                                                                        R116.3
   ════════════════════════════════════════════════════════════════════════════
   THE DEFECT. `POST /api/partner/me/mfcrm/spv-on-behalf`
   (server/managedFounderRoutes.ts) is one of the FIVE paths in this tree that
   create an SPV. The other three PARTNER create paths all require a signed
   Consortium Partner Agreement first:

       server/spvEngineRoutes.ts:319    POST /api/partner/me/spv
       server/partnerRoutes.ts:1815     POST /api/partner/me/spvs
       server/partnerRoutes.ts:1979     POST /api/partner/me/funds

   This one carried `requirePartnerAuth` + `assertSubRole(...WRITE_ROLES)` and
   NOTHING else. A partner who had never signed the agreement could create an SPV
   on a founder's behalf.

   THIS FILE IS DELIBERATELY SEPARATE from the membership eligibility gate built in
   the same wave. Different cause, different fix, its own commit and its own test:
   if the gate is ever reverted, this check must survive.

   Fail-before is recorded in build_log/wave154/W154_TESTS.md — with the middleware
   removed, the unsigned partner receives 201 and an SPV row exists.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerMfcrmRoutes } from "../managedFounderRoutes";
import { applyMfcrmSchema } from "../lib/mfcrmSchema";
import { managedFounderStore } from "../managedFounderStore";
import { seedTestPartnerSandbox, partnerAttributionStore } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const MANAGING = "u_avi_managing";
const CO = "co_k7_signed_agreement";

let app: express.Express;
let engagementId = "";

/** THROWS on failure — a swallowed fixture error is vacuous green. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[k7 fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

const setSigned = (signedAt: string | null): void => {
  run(
    `UPDATE contacts SET partner_agreement_signed_at = ? WHERE id = ? AND kind = 'consortium_partner'`,
    signedAt,
    PARTNER_A,
  );
};

const readSigned = (): unknown =>
  (
    rawDb()
      .prepare(
        `SELECT partner_agreement_signed_at AS s FROM contacts WHERE id = ? AND kind = 'consortium_partner'`,
      )
      .get(PARTNER_A) as { s: unknown } | undefined
  )?.s;

const createOnBehalf = () =>
  request(app)
    .post("/api/partner/me/mfcrm/spv-on-behalf")
    .set("x-user-id", MANAGING)
    .send({
      companyId: CO,
      engagementId,
      name: "K7 On-Behalf SPV",
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
    });

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerMfcrmRoutes(app);
  applyMfcrmSchema();
  seedTestPartnerSandbox({ force: true });
  partnerAttributionStore.create(PARTNER_A, CO, MANAGING);
  managedFounderStore.setCapabilityProfile(
    PARTNER_A,
    {
      classified: true,
      sourcesCapital: true,
      delegatedAgency: true,
      spvWriteAuthority: true,
      collectiveFronting: true,
    },
    MANAGING,
  );
  /* The engagement route is NOT agreement-gated (it is not a create-SPV path), so
     the fixture can be built regardless of signed state. */
  const eng = await request(app)
    .post("/api/partner/me/mfcrm/engagements")
    .set("x-user-id", MANAGING)
    .send({ companyId: CO });
  engagementId = String(eng.body?.engagement?.id ?? "");
  expect(engagementId.length, "fixture engagement must exist").toBeGreaterThan(0);
  /* SPV-on-behalf requires per-engagement delegated authority (Mode A, GATE 3) on
     top of everything else. The fixture grants it through the store's own setter
     with a real authority artifact and expiry, so the only variable left in the
     tests below is the AGREEMENT SIGNATURE. */
  managedFounderStore.setMode(
    PARTNER_A,
    engagementId,
    "A",
    {
      authorityArtifactRef: "doc_k7_authority_grant",
      authorityExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
    },
    MANAGING,
  );
});

describe("WAVE 154 · K-T10 — an UNSIGNED partner cannot create an SPV on a founder's behalf", () => {
  it("refuses with 403 AGREEMENT_NOT_SIGNED and a plain sentence plus a redirect", async () => {
    setSigned(null);
    expect(readSigned()).toBeFalsy(); // the fixture really is unsigned

    const res = await createOnBehalf();

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("AGREEMENT_NOT_SIGNED");
    /* R77 — the human-readable half is a sentence, not a code. */
    expect(res.body.message).toBe(
      "Please sign the Consortium Partner Agreement before making changes.",
    );
    expect(res.body.redirect).toBe("/collective/partner/agreement");
  });

  it("nothing was created — the refusal is before the write, not after it", async () => {
    setSigned(null);
    const before = (
      rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM spv WHERE target_company_id = ?`)
        .get(CO) as { n: number }
    ).n;
    const res = await createOnBehalf();
    expect(res.status).toBe(403);
    const after = (
      rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM spv WHERE target_company_id = ?`)
        .get(CO) as { n: number }
    ).n;
    expect(after).toBe(before);
  });

  it("a SIGNED partner is NOT refused by this check — the fix is a gate, not a wall", async () => {
    setSigned("2026-01-05T00:00:00.000Z");
    expect(readSigned()).toBe("2026-01-05T00:00:00.000Z");

    const res = await createOnBehalf();

    /* ANTI-VACUITY: the SAME request, changed only by the signature, must get past
       this middleware. Asserted as "not the agreement refusal" and, when the store
       accepts it, as a real 201 carrying a persisted SPV. */
    expect(res.body?.error, JSON.stringify(res.body)).not.toBe("AGREEMENT_NOT_SIGNED");
    expect(res.status, JSON.stringify(res.body)).not.toBe(403);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const n = (
      rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM spv WHERE target_company_id = ?`)
        .get(CO) as { n: number }
    ).n;
    expect(n).toBeGreaterThan(0);
  });

  it("READ routes are never gated — an unsigned partner is not bricked", async () => {
    setSigned(null);
    const r = await request(app)
      .get(`/api/partner/me/mfcrm/spv-on-behalf?companyId=${CO}`)
      .set("x-user-id", MANAGING);
    expect(r.status).not.toBe(403);
    expect(r.status).toBeLessThan(500);
  });

  it("the middleware sits after assertSubRole, exactly as on the other create paths", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "server/managedFounderRoutes.ts"),
      "utf8",
    );
    const at = src.indexOf('"/api/partner/me/mfcrm/spv-on-behalf"');
    expect(at).toBeGreaterThan(0);
    const chain = src.slice(at, at + 260);
    expect(chain).toContain("requirePartnerAuth");
    expect(chain).toContain("assertSubRole(...WRITE_ROLES)");
    expect(chain).toContain("requireSignedAgreement");
    expect(chain.indexOf("assertSubRole")).toBeLessThan(chain.indexOf("requireSignedAgreement"));
    expect(chain.indexOf("requirePartnerAuth")).toBeLessThan(chain.indexOf("requireSignedAgreement"));
  });
});
