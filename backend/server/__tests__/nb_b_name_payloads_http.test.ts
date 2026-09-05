/* ════════════════════════════════════════════════════════════════════════════
   WAVE NB-B — NAMES WHERE NAMES BELONG, PROVED OVER REAL HTTP.

   THREE READ SURFACES served a partner raw storage keys where a person expects
   a name. Every one of them already had the name reachable on the same row:

     · GET /api/partner/me/attributions/provenance  — no company name at all, and
       the actor arrived as the bare `u_…` id.
     · GET /api/partner/me/mfcrm/layers/:companyId  — `contact_ref` is the raw
       composite storage key `company:co_…`.
     · GET /api/partner/me/mfcrm/engagements (and the single-engagement route)
       — `companyId` only.

   WHAT THIS FILE ASSERTS, AND WHAT IT REFUSES TO ASSERT.
   It drives the real routes over a listening socket and reads the JSON a browser
   would receive. It asserts BOTH poles every time:
     · a company WITH a name and an actor WITH an email resolve;
     · a company with NO name and an actor with NO name and NO email resolve to
       null, so the screen can fall back to its existing wording. A test that only
       proved the happy pole would pass just as well against a function that
       invents a name, which is the failure this band exists to prevent.

   NO SECOND RESOLVER. The routes call `getCompanyRecordById` (already used by
   `GET /api/partner/me/clients`) and `resolveDisplayName(s)`
   (`server/lib/displayNameResolver.ts`). Case (9) asserts the resolved actor
   string is byte-identical to what the shared resolver returns, so a private
   copy of the logic inside a route would redden.

   FIXTURE ORDER MATTERS. `registerRoutes` runs hydrators that clear and reload
   the in-memory partner arrays, so the fixture is seeded AFTER the server boots
   and every part of it is asserted in `beforeAll` before any test runs.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  seedTestPartnerSandbox,
  partnerTeamStore,
  partnerAttributionStore,
} from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { hydratePartnerWorkspaceV19Store } from "../partnerWorkspaceV19Store";
import { storeCredential } from "../userCredentialsStore";
import { managedFounderStore, hydrateManagedFounderStore } from "../managedFounderStore";
import { addCompanyForFounder, getCompanyRecordById } from "../multiCompanyStore";
import { resolveDisplayName } from "../lib/displayNameResolver";

const PARTNER = "ac_consortium_partner_nbb";
/** The actor WITH an email on file but NO human name — the live shape. */
const MANAGING = "u_nbb_managing";
const MANAGING_EMAIL = "managing@nbb.example";
/** The actor with NEITHER a name NOR an email — the negative control. */
const NAMELESS_ACTOR = "u_redeemed_nbb_nameless";

/** A company WITH a name on file. */
const CO_NAMED = "co_nbb_named";
const CO_NAMED_NAME = "Kestrel Holdings Ltd";
/** A company with NO name anywhere — the floor case. */
const CO_UNNAMED = "co_nbb_unnamed";

let app: Express;
let server: http.Server;
let port: number;

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
    legalName: "NB-B PARTNER, INC",
    displayName: "NB-B Partner",
    email: "ops@nbb.example",
    region: "US",
    regionCode: "US",
    tier: "catalyst",
    partnerType: "angel_network",
  });
  partnerTeamStore.add(PARTNER, MANAGING, "managing_partner", "u_system_seed", { isSeed: true });
  /* An EMAIL and no human name — exactly the live account's shape. The credential
     store's `name` is deliberately set to the email, because that is what the
     platform actually holds for this kind of account. */
  storeCredential({
    userId: MANAGING,
    email: MANAGING_EMAIL,
    name: MANAGING_EMAIL,
    password: "test-password-nbb",
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

  const db: any = rawDb();
  const now = "2026-09-01T00:00:00.000Z";
  db.prepare(
    `INSERT OR IGNORE INTO partner_organizations (id, tenant_id, name, status, created_at, updated_at)
     VALUES (?, 'tenant_platform', 'NB-B Partner', 'active', ?, ?)`,
  ).run(PARTNER, now, now);

  for (const [id, name] of [[CO_NAMED, CO_NAMED_NAME], [CO_UNNAMED, "NB-B Unnamed Row"]] as Array<[string, string]>) {
    db.prepare(`INSERT OR IGNORE INTO companies (id, tenant_id, name) VALUES (?, 'tenant_platform', ?)`).run(id, name);
  }

  /* ONLY the named company is registered in the record store the name lookup
     reads. CO_UNNAMED is deliberately absent from it, which is what makes the
     floor branch reachable rather than hypothetical. */
  addCompanyForFounder("u_nbb_founder", {
    companyId: CO_NAMED,
    companyName: CO_NAMED_NAME,
    legalName: "KESTREL HOLDINGS LIMITED",
    logoUrl: null,
    role: "founder",
    lastActiveAt: now,
    kpi: {
      capTableHolders: 0,
      activeRoundsCount: 0,
      raisedThisYearUsd: 0,
      dataroomFiles: 0,
      pendingSoftCircles: null,
    },
  } as any);

  /* Two attributions: one by the emailed actor, one by an actor with nothing on
     file. Both are needed — one proves the name arrives, the other proves the
     absence of a name is reported as an absence. */
  partnerAttributionStore.create(PARTNER, CO_NAMED, MANAGING, "admin_manual", null, { strict: true });
  partnerAttributionStore.create(PARTNER, CO_UNNAMED, NAMELESS_ACTOR, "admin_manual", null, { strict: true });

  /* An engagement on EACH company, so the engagements payload carries a
     resolvable and an unresolvable company at once. Inserted at the table the
     store hydrates from, because the public `createEngagement` path additionally
     requires a classified capability profile that is not part of what this wave
     changed. */
  const insEng = db.prepare(
    `INSERT OR IGNORE INTO mf_engagement
       (id, partner_id, company_id, mode, status, authority_artifact_ref, authority_expires_at,
        trial_expires_at, chapter_id, matter_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'B', 'ACTIVE', NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
  );
  insEng.run("mfeng_nbb_named", PARTNER, CO_NAMED, MANAGING, now, now);
  insEng.run("mfeng_nbb_unnamed", PARTNER, CO_UNNAMED, MANAGING, now, now);
  await hydrateManagedFounderStore();

  /* ── the fixture is asserted, part by part ───────────────────────────────── */
  expect(getCompanyRecordById(CO_NAMED)?.companyName).toBe(CO_NAMED_NAME);
  expect(getCompanyRecordById(CO_UNNAMED)).toBeUndefined();
  expect(resolveDisplayName(MANAGING).resolved).toBe(true);
  expect(resolveDisplayName(MANAGING).email).toBe(MANAGING_EMAIL);
  expect(resolveDisplayName(NAMELESS_ACTOR).resolved).toBe(false);
  expect(managedFounderStore.listEngagements(PARTNER).length).toBe(2);
  const attrs = partnerAttributionStore.listByPartner(PARTNER);
  expect(attrs.length).toBe(2);
  expect(attrs.map((a) => a.companyId).sort()).toEqual([CO_NAMED, CO_UNNAMED].sort());
}, 60_000);

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("WAVE NB-B · provenance payload — a name when there is one, an absence when there is not", () => {
  it("(1) every attribution carries companyName, and the NAMED company resolves to its real name", async () => {
    const r = await call("GET", "/api/partner/me/attributions/provenance", MANAGING);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.attributions)).toBe(true);
    expect(r.body.attributions.length).toBe(2);
    for (const a of r.body.attributions) {
      expect(Object.prototype.hasOwnProperty.call(a, "companyName")).toBe(true);
    }
    const named = r.body.attributions.find((a: any) => a.companyId === CO_NAMED);
    expect(named.companyName).toBe(CO_NAMED_NAME);
  });

  it("(2) THE FLOOR — a company with no name on file reports null, never a guess and never the id", async () => {
    const r = await call("GET", "/api/partner/me/attributions/provenance", MANAGING);
    const unnamed = r.body.attributions.find((a: any) => a.companyId === CO_UNNAMED);
    expect(unnamed.companyName).toBeNull();
    /* The critical assertion: the id must not be smuggled into the name field,
       which would defeat the screen's fallback and print a token as a name. */
    expect(unnamed.companyName).not.toBe(CO_UNNAMED);
  });

  it("(3) the actor with an EMAIL and no human name resolves to the email — a real identifier, not a fabrication", async () => {
    const r = await call("GET", "/api/partner/me/attributions/provenance", MANAGING);
    const named = r.body.attributions.find((a: any) => a.companyId === CO_NAMED);
    expect(named.attributedByName).toBe(MANAGING_EMAIL);
    expect(named.attributedByEmail).toBe(MANAGING_EMAIL);
    /* Nothing is derived FROM the email to make it look more like a person. */
    expect(named.attributedByName).not.toMatch(/^NB/);
    expect(String(named.attributedByName)).toContain("@");
  });

  it("(4) THE FLOOR — an actor with neither name nor email reports null, so the screen keeps its own wording", async () => {
    const r = await call("GET", "/api/partner/me/attributions/provenance", MANAGING);
    const unnamed = r.body.attributions.find((a: any) => a.companyId === CO_UNNAMED);
    expect(unnamed.attributedByName).toBeNull();
    expect(unnamed.attributedByEmail).toBeNull();
    /* And the humanised placeholder the resolver would return must NOT leak
       through as if it were the person's name. */
    expect(unnamed.attributedByName).not.toBe(resolveDisplayName(NAMELESS_ACTOR).name);
  });

  it("(5) THE RAW VALUES ARE STILL ON THE WIRE — support can still quote them, and no existing key changed", async () => {
    const r = await call("GET", "/api/partner/me/attributions/provenance", MANAGING);
    for (const a of r.body.attributions) {
      expect(typeof a.id).toBe("string");
      expect(typeof a.companyId).toBe("string");
      expect(typeof a.attributedBy).toBe("string");
      expect(typeof a.attributionSource).toBe("string");
      expect(typeof a.selfService).toBe("boolean");
      expect(typeof a.intact).toBe("boolean");
      expect(typeof a.copy).toBe("string");
    }
    expect(typeof r.body.summary).toBe("string");
    expect(r.body.total).toBe(2);
  });
});

describe("WAVE NB-B · managed-founder payloads", () => {
  it("(6) the layer rows carry contactName resolved from the composite ref, and keep contact_ref intact", async () => {
    /* Seeded through the store's own public API so the row is the shape the
       product writes, not one this test invented. */
    managedFounderStore.setLayerMembership(PARTNER, CO_NAMED, `company:${CO_NAMED}`, "partner", null);
    const r = await call("GET", `/api/partner/me/mfcrm/layers/${CO_NAMED}`, MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.layers.length).toBeGreaterThan(0);
    const row = r.body.layers.find((l: any) => l.contact_ref === `company:${CO_NAMED}`);
    expect(row).toBeTruthy();
    expect(row.contactName).toBe(CO_NAMED_NAME);
    /* The composite key is load-bearing storage data. It is NOT reformatted,
       stripped or replaced — it is still exactly what was stored. */
    expect(row.contact_ref).toBe(`company:${CO_NAMED}`);
    expect(row.company_id).toBe(CO_NAMED);
  });

  it("(7) THE FLOOR — a layer row whose company has no name reports contactName null", async () => {
    managedFounderStore.setLayerMembership(PARTNER, CO_UNNAMED, `company:${CO_UNNAMED}`, "partner", null);
    const r = await call("GET", `/api/partner/me/mfcrm/layers/${CO_UNNAMED}`, MANAGING);
    expect(r.status).toBe(200);
    const row = r.body.layers.find((l: any) => l.contact_ref === `company:${CO_UNNAMED}`);
    expect(row).toBeTruthy();
    expect(row.contactName).toBeNull();
    expect(row.contact_ref).toBe(`company:${CO_UNNAMED}`);
  });

  it("(8) the engagements list carries companyName on both poles at once", async () => {
    const r = await call("GET", "/api/partner/me/mfcrm/engagements", MANAGING);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.engagements)).toBe(true);
    /* PRECONDITION. Without this the loop below would iterate zero rows and pass
       against a route that adds nothing at all — the vacuous green this build
       has been caught by before. Measured: this assertion failed the first time
       it was run, which is how the empty fixture was found. */
    expect(r.body.engagements.length).toBe(2);
    const byId = new Map<string, any>(r.body.engagements.map((e: any) => [String(e.companyId), e]));
    expect(byId.get(CO_NAMED)?.companyName).toBe(CO_NAMED_NAME);
    expect(byId.get(CO_UNNAMED)?.companyName).toBeNull();
    for (const e of r.body.engagements) {
      expect(Object.prototype.hasOwnProperty.call(e, "companyName")).toBe(true);
      expect(typeof e.companyId).toBe("string");
      expect(e.companyName === null || typeof e.companyName === "string").toBe(true);
      /* Never the id dressed up as a name. */
      expect(e.companyName).not.toBe(e.companyId);
    }
  });

  it("(9) NO SECOND RESOLVER — the served actor name is byte-identical to the shared resolver's answer", async () => {
    const r = await call("GET", "/api/partner/me/attributions/provenance", MANAGING);
    const named = r.body.attributions.find((a: any) => a.companyId === CO_NAMED);
    const shared = resolveDisplayName(MANAGING);
    expect(shared.resolved).toBe(true);
    expect(named.attributedByName).toBe(shared.name);
    expect(named.attributedByEmail).toBe(shared.email);
  });

  it("(10) partner isolation is unchanged — the layers route still refuses a company this partner has not attributed", async () => {
    const r = await call("GET", "/api/partner/me/mfcrm/layers/co_nbb_not_mine", MANAGING);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED");
    /* No name of any kind is disclosed on the refusal path. */
    expect(JSON.stringify(r.body)).not.toContain(CO_NAMED_NAME);
  });
});
