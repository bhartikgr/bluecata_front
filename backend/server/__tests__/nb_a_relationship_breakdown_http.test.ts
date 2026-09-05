/**
 * WAVE NB-A — THE RELATIONSHIP MAP SUMMARY FIGURES, OVER A REAL HTTP ROUTE,
 * AGAINST STORED ROWS.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `GET /api/partner/me/relationships` returned its four summary figures from
 * `surfaceBreakdown`, which counts the MATERIALISED `pcr_surface_presence`
 * spine. That spine has exactly ONE forward writer in the whole tree
 * (`partnerWorkspaceStore.writeTypedAttribution`, surface `"clients"`), so three
 * of the four tiles were frozen at migration 0136's one-shot backfill and the
 * clients tile was the only correct one. Measured on the live site on
 * 2026-09-04: `breakdown` said `{mfc:0, pipeline:0, clients:4, portfolio:2}`
 * while the partner's own four pages held one engagement, ten pipeline deals
 * over six companies, four clients and four portfolio rows.
 *
 * ── THE CONTROL COMES FIRST: DISAGREEMENT, THEN AGREEMENT ───────────────────
 * Case (1) proves the two counters DISAGREE on this fixture before anything
 * else is asserted, and that they AGREE on `clients` — the one surface with a
 * forward writer. That is the whole diagnosis reproduced in one assertion pair.
 * If a later refactor accidentally made the spine correct, case (1) would fail
 * and this file would be telling the truth about a fixture that no longer
 * distinguishes the fix from the defect, rather than passing vacuously.
 *
 * ── WHY THE COUNTERS CALL STORES AND NOT SQL ────────────────────────────────
 * Cases (5) and (6) are the two premises that killed the obvious
 * implementation. `partnerPipelineStore.create` persists ONLY through the kv
 * shim, never into `partner_deal_pipeline`; and the portfolio route drops
 * records per record through the W230 visibility filter. Counting either table
 * directly would have made the tile disagree with its own page — a new drift in
 * the wave meant to remove drift. (5) and (6) pin both, so a future wave cannot
 * "simplify" this back to SQL without a red test explaining why not.
 *
 * ── PRECONDITIONS ARE ASSERTED, NEVER ASSUMED ───────────────────────────────
 * The fixture is seeded here and every part of it is asserted present before
 * any count is compared, including the four things that make the grain
 * non-trivial: a company on TWO surfaces, TWO pipeline deals for the SAME
 * company, a pipeline deal with NO company at all, and a soft-deleted portfolio
 * row. A count assertion against an empty fixture proves nothing.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  seedTestPartnerSandbox,
  partnerTeamStore,
  partnerPipelineStore,
  partnerAttributionStore,
} from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { hydratePartnerWorkspaceV19Store } from "../partnerWorkspaceV19Store";
import { storeCredential } from "../userCredentialsStore";
import { surfaceBreakdown, reconcilePartner, PCR_SURFACES } from "../partnerCompanyRelationshipStore";
import { surfaceCompanyCounts } from "../partnerRelationshipSurfaceCounts";
import { listPortfolioCompanies } from "../partnerPortfolioStore";
import { managedFounderStore, hydrateManagedFounderStore } from "../managedFounderStore";

const PARTNER = "ac_consortium_partner_nba";
const MANAGING = "u_nba_managing";

/* Companies. CO_BOTH is deliberately on the pipeline AND the portfolio, so a
   count that accidentally deduplicated ACROSS surfaces would be caught. */
const CO_ONE = "co_nba_one";
const CO_TWO = "co_nba_two";
const CO_BOTH = "co_nba_both";
const CO_MFC = "co_nba_mfc";
const CO_PORT_DELETED = "co_nba_portfolio_deleted";

let app: Express;
let server: http.Server;
let port: number;

function n(sql: string, ...args: unknown[]): number {
  return Number((rawDb().prepare(sql).get(...args) as { n: number }).n);
}

function call(method: string, apiPath: string, userId: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers: { "x-user-id": userId } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let b: any = null;
          try { b = JSON.parse(buf); } catch { /* keep null */ }
          resolve({ status: res.statusCode ?? 0, body: b });
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

beforeAll(async () => {
  await seedDemoData(getDb());
  seedTestPartnerSandbox({ force: true });

  _registerSeedPartner({
    id: PARTNER,
    legalName: "NB-A PARTNER, INC",
    displayName: "NB-A Partner",
    email: "ops@nba.example",
    region: "US",
    regionCode: "US",
    tier: "catalyst",
    partnerType: "angel_network",
  });
  partnerTeamStore.add(PARTNER, MANAGING, "managing_partner", "u_system_seed", { isSeed: true });
  storeCredential({
    userId: MANAGING,
    email: "managing@nba.example",
    name: "NB-A Managing",
    password: "test-password-nba",
  });

  await hydratePartnerWorkspaceV19Store();

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) =>
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    }),
  );

  /* ══════════════════════════════════════════════════════════════════════════
     THE FIXTURE IS SEEDED *AFTER* THE SERVER BOOTS, ON PURPOSE.
     `registerRoutes` runs the platform's hydrators, and two of them clear and
     repopulate the in-memory partner arrays from durable storage. A fixture
     seeded before that point is silently wiped, and the counts would then be
     measured against an empty partner — the vacuous green this build has been
     burned by. Measured, not assumed: the assertions at the end of this block
     fail loudly if any part of the fixture did not survive.
     ══════════════════════════════════════════════════════════════════════════ */
  const db: any = rawDb();
  const now = "2026-09-01T00:00:00.000Z";
  /* The spine references `partner_organizations(id)` and `foreign_keys` is ON, so
     without this row the forward-write for the clients surface fails soft and the
     control below would compare two zeroes. `_registerSeedPartner` creates a
     CONTACT, which is a different table. */
  db.prepare(
    `INSERT OR IGNORE INTO partner_organizations (id, tenant_id, name, status, created_at, updated_at)
     VALUES (?, 'tenant_platform', 'NB-A Partner', 'active', ?, ?)`,
  ).run(PARTNER, now, now);

  const insCompany = db.prepare(
    `INSERT OR IGNORE INTO companies (id, tenant_id, name) VALUES (?, 'tenant_platform', ?)`,
  );
  for (const [id, name] of [
    [CO_ONE, "NB-A Company One"],
    [CO_TWO, "NB-A Company Two"],
    [CO_BOTH, "NB-A Company On Two Surfaces"],
    [CO_MFC, "NB-A Managed Founder Co"],
    [CO_PORT_DELETED, "NB-A Removed Portfolio Co"],
  ]) {
    insCompany.run(id, name);
  }

  /* ── mfc: ONE engagement ─────────────────────────────────────────────────── */
  db.prepare(
    `INSERT OR IGNORE INTO mf_engagement (id, partner_id, company_id, mode, status, created_at, updated_at)
     VALUES (?, ?, ?, 'B', 'ACTIVE', ?, ?)`,
  ).run("mfe_nba_1", PARTNER, CO_MFC, now, now);

  /* ── portfolio: TWO live rows + ONE soft-deleted row ─────────────────────── */
  const insPort = db.prepare(
    `INSERT OR IGNORE INTO partner_portfolio_company
       (id, tenant_id, partner_id, company_id, profile_json, created_at, updated_at, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, '{}', ?, ?, ?)`,
  );
  insPort.run("ppc_nba_1", PARTNER, CO_ONE, now, now, null);
  insPort.run("ppc_nba_2", PARTNER, CO_BOTH, now, now, null);
  insPort.run("ppc_nba_3", PARTNER, CO_PORT_DELETED, now, now, now); /* soft-deleted */

  /* ── clients: TWO live attributions through the store's own public API ───── */
  /* `strict: true` deliberately: the typed-table write is what maintains the
     spine for this surface, and non-strict mode swallows its failure with a log
     line. A swallowed write here would leave the control below comparing two
     zeroes and passing vacuously. */
  partnerAttributionStore.create(PARTNER, CO_ONE, MANAGING, "admin_manual", null, { strict: true });
  partnerAttributionStore.create(PARTNER, CO_TWO, MANAGING, "admin_manual", null, { strict: true });

  /* ── pipeline: FOUR deals over TWO companies + one with NO company ───────── */
  for (const [name, companyId] of [
    ["NB-A Deal A", CO_BOTH],
    ["NB-A Deal B", CO_BOTH], /* SAME company as A — one company, two deals */
    ["NB-A Deal C", CO_TWO],
    ["NB-A Deal D — no company yet", null],
  ] as Array<[string, string | null]>) {
    partnerPipelineStore.create(PARTNER, { dealName: name, companyId, ownerUserId: MANAGING }, MANAGING);
  }

  /* The Managed Founder store serves its page from an in-memory map loaded by
     its OWN hydrator, not by reading `mf_engagement` per request. Calling the
     hydrator is therefore how a seeded engagement reaches the page's read path
     — and the fact that a direct table insert alone does NOT is a third piece of
     evidence that these four surfaces are stores, not tables. */
  await hydrateManagedFounderStore();

  /* ══════════ THE FIXTURE IS ASSERTED, PART BY PART ══════════ */
  expect(managedFounderStore.listEngagements(PARTNER).length).toBe(1);
  expect(n(`SELECT COUNT(*) n FROM mf_engagement WHERE partner_id = ?`, PARTNER)).toBe(1);
  expect(n(`SELECT COUNT(*) n FROM partner_portfolio_company WHERE partner_id = ?`, PARTNER)).toBe(3);
  expect(
    n(`SELECT COUNT(*) n FROM partner_portfolio_company WHERE partner_id = ? AND deleted_at IS NOT NULL`, PARTNER),
  ).toBe(1);
  expect(partnerAttributionStore.listByPartner(PARTNER).length).toBe(2);
  const deals = partnerPipelineStore.listByPartner(PARTNER);
  expect(deals.length).toBe(4);
  expect(deals.filter((d) => d.companyId === CO_BOTH).length).toBe(2);
  expect(deals.filter((d) => !d.companyId).length).toBe(1);
}, 60_000);

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** What the fixture means, computed independently of the code under test. */
const EXPECTED: Record<string, number> = {
  mfc: 1, /* one engagement, one company */
  pipeline: 2, /* four deals → CO_BOTH and CO_TWO; the no-company deal is not a relationship */
  clients: 2, /* two live attributions */
  portfolio: 2, /* three rows, one soft-deleted */
};

describe("WAVE NB-A · CONTROL — the two counters DISAGREE, except on the one surface with a forward writer", () => {
  it("(1) the spine-based counter is wrong on three surfaces and right on clients — the diagnosis, reproduced", () => {
    const spine = surfaceBreakdown(PARTNER);
    const sources = surfaceCompanyCounts(PARTNER);

    /* Both sides non-empty: an assertion that two empty objects differ is not a
       control. */
    expect(Object.keys(spine).length).toBe(4);
    expect(Object.keys(sources).length).toBe(4);

    /* THE AGREEMENT — `clients` has a forward writer, so the spine kept up. */
    expect(spine.clients).toBe(sources.clients);
    expect(sources.clients).toBe(EXPECTED.clients);

    /* THE DISAGREEMENT — the three surfaces with no forward writer. Named
       individually so a failure says WHICH surface stopped distinguishing. */
    for (const surface of ["mfc", "pipeline", "portfolio"] as const) {
      expect(spine[surface], `spine should be stale on ${surface}`).not.toBe(sources[surface]);
      expect(spine[surface]).toBe(0);
      expect(sources[surface]).toBe(EXPECTED[surface]);
    }
  });
});

describe("WAVE NB-A — the route serves the derived figures", () => {
  it("(2) GET /api/partner/me/relationships returns a figure per surface, each equal to the surfaces' own companies", async () => {
    const r = await call("GET", "/api/partner/me/relationships", MANAGING);
    expect(r.status).toBe(200);
    expect(r.body?.breakdown).toBeTruthy();
    /* Every surface present — a missing key renders as "not counted" and would
       be a silent regression. */
    for (const surface of PCR_SURFACES) {
      expect(Object.prototype.hasOwnProperty.call(r.body.breakdown, surface)).toBe(true);
      expect(r.body.breakdown[surface], `surface ${surface}`).toBe(EXPECTED[surface]);
      expect(typeof r.body.breakdown[surface]).toBe("number");
    }
  });

  it("(3) SET EQUALITY, per surface — the figure is the size of the page's own company set, clients as the control", async () => {
    const r = await call("GET", "/api/partner/me/relationships", MANAGING);
    expect(r.status).toBe(200);

    /* Computed HERE from the four page reads, not from the code under test. */
    const expectedSets: Record<string, Set<string>> = {
      mfc: new Set(managedFounderStore.listEngagements(PARTNER).map((e) => e.companyId)),
      pipeline: new Set(
        partnerPipelineStore.listByPartner(PARTNER).map((d) => d.companyId).filter((c): c is string => !!c),
      ),
      clients: new Set(partnerAttributionStore.listByPartner(PARTNER).map((a) => a.companyId)),
      portfolio: new Set(listPortfolioCompanies(PARTNER).map((p) => p.companyId)),
    };
    for (const surface of PCR_SURFACES) {
      expect(expectedSets[surface].size, `${surface} set must be non-empty`).toBeGreaterThan(0);
      expect(r.body.breakdown[surface]).toBe(expectedSets[surface].size);
    }
    /* And the sets are genuinely different from one another, so equal sizes are
       not hiding a single set being compared to itself four times. */
    expect(expectedSets.mfc.has(CO_MFC)).toBe(true);
    expect(expectedSets.pipeline.has(CO_MFC)).toBe(false);
  });

  it("(4) GRAIN — two deals on one company count once, and a deal with no company counts not at all", () => {
    const deals = partnerPipelineStore.listByPartner(PARTNER);
    expect(deals.length).toBe(4); /* rows */
    expect(surfaceCompanyCounts(PARTNER).pipeline).toBe(2); /* companies */
  });
});

describe("WAVE NB-A — the two premises that ruled out counting the four tables directly", () => {
  it("(5) a pipeline deal created through the store's public API is NOT in partner_deal_pipeline — the table is not the pipeline page's source", () => {
    /* Four deals exist and the pipeline page shows them. If they were in the
       typed table, `reconcilePartner`'s own query would be a valid source. They
       are not: the store persists them as kv blobs. */
    expect(partnerPipelineStore.listByPartner(PARTNER).length).toBe(4);
    expect(n(`SELECT COUNT(*) n FROM partner_deal_pipeline WHERE partner_id = ?`, PARTNER)).toBe(0);
  });

  it("(6) the portfolio table holds a row the portfolio page hides, so the table is not the portfolio page's source either", () => {
    /* Three rows in the table for this partner; the page's own read shows two,
       because one is soft-deleted. The W230 visibility filter removes more still
       on the live site. Counting the table would exceed the page. */
    expect(n(`SELECT COUNT(*) n FROM partner_portfolio_company WHERE partner_id = ?`, PARTNER)).toBe(3);
    expect(listPortfolioCompanies(PARTNER).length).toBe(2);
    expect(surfaceCompanyCounts(PARTNER).portfolio).toBe(2);
  });
});

describe("WAVE NB-A — an unreadable surface is null, never a zero", () => {
  it("(7) when a surface's own read throws, that surface is null and the other three keep their figures", () => {
    const spy = vi
      .spyOn(managedFounderStore, "listEngagements")
      .mockImplementation(() => {
        throw new Error("NB-A probe: mfc read failed");
      });
    try {
      const counts = surfaceCompanyCounts(PARTNER);
      expect(counts.mfc).toBeNull();
      expect(counts.mfc).not.toBe(0); /* stated explicitly: null is not zero */
      expect(counts.pipeline).toBe(EXPECTED.pipeline);
      expect(counts.clients).toBe(EXPECTED.clients);
      expect(counts.portfolio).toBe(EXPECTED.portfolio);
    } finally {
      spy.mockRestore();
    }
    /* THE OTHER POLE, on the same surface: restored, it is a number again — so
       the null above was caused by the failure and not by the surface being
       permanently unreadable in this fixture. */
    expect(surfaceCompanyCounts(PARTNER).mfc).toBe(EXPECTED.mfc);
  });

  it("(8) a TRUTHFUL zero is still a zero — a partner with no rows at all gets 0, not null", () => {
    const EMPTY = "ac_consortium_partner_nba_empty";
    const counts = surfaceCompanyCounts(EMPTY);
    for (const surface of PCR_SURFACES) {
      expect(counts[surface], `surface ${surface}`).toBe(0);
      expect(counts[surface]).not.toBeNull();
    }
  });
});

describe("WAVE NB-A — reconcile still only adds, and the figures no longer depend on it", () => {
  it("(9) reconcile does not change any of the four figures, and does not reduce the stored spine", async () => {
    const before = await call("GET", "/api/partner/me/relationships", MANAGING);
    expect(before.status).toBe(200);
    const spineRowsBefore = n(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ?`, PARTNER);
    const presenceBefore = n(
      `SELECT COUNT(*) n FROM pcr_surface_presence p
        JOIN partner_company_relationship r ON r.id = p.pcr_id
       WHERE r.partner_id = ?`,
      PARTNER,
    );
    const removedBefore = n(
      `SELECT COUNT(*) n FROM pcr_surface_presence p
        JOIN partner_company_relationship r ON r.id = p.pcr_id
       WHERE r.partner_id = ? AND p.removed_at IS NOT NULL`,
      PARTNER,
    );

    reconcilePartner(PARTNER);

    const after = await call("GET", "/api/partner/me/relationships", MANAGING);
    expect(after.status).toBe(200);
    /* THE FIGURES ARE DERIVED, so reconcile cannot move them. */
    expect(after.body.breakdown).toEqual(before.body.breakdown);

    /* AND RECONCILE ONLY ADDS — the stored rows never decrease and nothing is
       marked removed. This is asserted on STORED ROWS, not on the response. */
    expect(
      n(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ?`, PARTNER),
    ).toBeGreaterThanOrEqual(spineRowsBefore);
    expect(
      n(
        `SELECT COUNT(*) n FROM pcr_surface_presence p
          JOIN partner_company_relationship r ON r.id = p.pcr_id
         WHERE r.partner_id = ?`,
        PARTNER,
      ),
    ).toBeGreaterThanOrEqual(presenceBefore);
    expect(
      n(
        `SELECT COUNT(*) n FROM pcr_surface_presence p
          JOIN partner_company_relationship r ON r.id = p.pcr_id
         WHERE r.partner_id = ? AND p.removed_at IS NOT NULL`,
        PARTNER,
      ),
    ).toBe(removedBefore);
  });

  it("(10) reconcile STILL HAS A PURPOSE — the relationship list it maintains is not derived and grows", async () => {
    /* The dated per-company history below the tiles is the one thing only the
       spine holds. It is served from `listRelationshipsForPartner`, which still
       reads the spine — so reconcile's narrower job is real, and the panel says
       only that. */
    const r = await call("GET", "/api/partner/me/relationships", MANAGING);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.relationships)).toBe(true);
    expect(r.body.relationships.length).toBeGreaterThan(0);
    const withPresence = r.body.relationships.filter(
      (row: any) => Array.isArray(row.presence) && row.presence.length > 0,
    );
    expect(withPresence.length).toBeGreaterThan(0);
  });
});
