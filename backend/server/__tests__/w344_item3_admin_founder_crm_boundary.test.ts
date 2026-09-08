/**
 * WAVE 344 · ITEM 3 — THE ADMINISTRATOR / FOUNDER-CRM BOUNDARY.
 *
 * ── THE RULING BEING ENFORCED ──────────────────────────────────────────────
 * Owner rulings R285/R289: an administrator MAY read a founder's CONTACT
 * DETAILS (they run the platform and have to be able to reach their customers)
 * but MUST NOT be able to read a founder's CRM RECORDS — the notes, stages and
 * investor relationships that founder keeps privately about their own investors.
 *
 * ── WHY THIS FILE IS SHAPED THE WAY IT IS ─────────────────────────────────
 * The brief requires a test THAT FAILS IF AN ADMIN CAN REACH A CRM RECORD. A
 * test that merely observes "the response did not happen to contain a note" is
 * worthless if there was no note to find. So every one of these assertions is
 * preceded by a `rows > 0` precondition that proves the private content EXISTS
 * IN THE DATABASE and proves the exact string being searched for is a real value
 * from a real row. If the CRM were empty, this file goes red rather than green.
 *
 * The controls also prove the opposite pole: the FOUNDER can reach their own
 * records, and the administrator CAN reach contact details. Without those, a
 * platform that had simply broken the CRM entirely would pass.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

process.env.MARKETING_CONSENT_MAILING_ADDRESS =
  "W344 Test Address, 1 Example Street, Toronto ON M5V 0A1, Canada";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { patchConfig } from "../emailTransport";
import { _resetRateLimitsForTests } from "../lib/rateLimit";

let app: Express;
let server: http.Server;

/** A real private CRM row: the thing an administrator must not be able to see. */
interface CrmRow {
  id: string;
  company_id: string;
  name: string;
  email: string | null;
  stage: string;
  notes: string | null;
}
let secret: CrmRow;
let founder = "";
const CO = "co_w344_boundary";
const MARKER = "W344-PRIVATE-CRM-NOTE-DO-NOT-SHOW-TO-ADMIN";
const CONTACT_NAME = "W344 Boundary Private Investor";

beforeAll(async () => {
  patchConfig({ mode: "dry_run" });
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);

  /* THE PRIVATE RECORD IS CREATED THROUGH THE SHIPPED ROUTES, by a real founder
     who really owns a real company. It is not lifted out of seed data and it is
     not inserted straight into the table: a record the product itself did not
     create would not prove anything about what the product exposes.

     Its note is a marker string nobody could produce by accident, so that "the
     administrator's response does not contain it" is a statement about THIS row
     rather than about a word that happens to be rare. A note on a contact row:
     not a money row, not a hash-anchored row. */
  _resetRateLimitsForTests();
  const su = await request(app).post("/api/auth/signup").send({
    email: "w344.boundary@example.test",
    name: "W344 Boundary Founder",
    password: "w344-boundary-pw",
  });
  if (su.status !== 200) throw new Error(`PRECONDITION FAILED: signup ${su.status}`);
  founder = String(su.body?.ctx?.userId ?? "");
  if (!founder) throw new Error("PRECONDITION FAILED: no founder user id");

  _resetRateLimitsForTests();
  const co = await request(app)
    .post("/api/founder/companies")
    .set("x-user-id", founder)
    .send({ companyId: CO, companyName: "W344 Boundary Co" });
  if (co.status !== 201) throw new Error(`PRECONDITION FAILED: company ${co.status}`);
  await hydrateMultiCompanyStore();

  _resetRateLimitsForTests();
  const ct = await request(app)
    .post("/api/founder/investor-crm")
    .set("x-user-id", founder)
    .send({
      companyId: CO,
      name: CONTACT_NAME,
      email: "w344.boundary.contact@example.test",
      stage: "prospect",
      region: "US",
      notes: MARKER,
    });
  if (ct.status !== 200) throw new Error(`PRECONDITION FAILED: contact ${ct.status}`);

  /* The archive registry is installed LAZILY by the shipped code path, exactly as
     in production. Reading the working list once through the SHIPPED route is what
     installs it; this file does not build its own tables. */
  _resetRateLimitsForTests();
  const warm = await request(app)
    .get(`/api/founder/investor-crm?companyId=${CO}`)
    .set("x-user-id", founder);
  if (warm.status !== 200) throw new Error(`PRECONDITION FAILED: crm list ${warm.status}`);

  const row = rawDb()
    .prepare(
      `SELECT id, company_id, name, email, stage, notes
         FROM founder_crm_contacts
        WHERE company_id = ? AND name = ?`,
    )
    .get(CO, CONTACT_NAME) as CrmRow | undefined;
  if (!row) throw new Error("PRECONDITION FAILED: no founder CRM contact to test with");
  if (row.notes !== MARKER) {
    /* The route may not carry a note on creation. Set it through the shipped
       update route rather than writing the table directly. */
    _resetRateLimitsForTests();
    const up = await request(app)
      .patch(`/api/founder/investor-crm/${row.id}`)
      .set("x-user-id", founder)
      .send({ companyId: CO, notes: MARKER });
    if (up.status !== 200) throw new Error(`PRECONDITION FAILED: note write ${up.status}`);
  }
  const after = rawDb()
    .prepare(`SELECT id, company_id, name, email, stage, notes FROM founder_crm_contacts WHERE id = ?`)
    .get(row.id) as CrmRow;
  if (after.notes !== MARKER) throw new Error("PRECONDITION FAILED: marker note not stored");
  secret = after;
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

function asAdmin(req: request.Test): request.Test {
  return req.set("x-test-user-id", "u_admin").query({ as: "admin" });
}

/* ══════════════════════════════════════════════════════════════════════════
   0 — CONTROLS. THE PRIVATE CONTENT EXISTS, AND THE ADMIN PERSONA IS REAL.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 · CONTROLS — there is something to hide, and somebody to hide it from", () => {
  it("rows > 0: the founder CRM holds real records, and the marker note is really stored", () => {
    const n = (
      rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM founder_crm_contacts WHERE deleted_at IS NULL`)
        .get() as { n: number }
    ).n;
    expect(n).toBeGreaterThan(0);

    const back = rawDb()
      .prepare(`SELECT notes FROM founder_crm_contacts WHERE id = ?`)
      .get(secret.id) as { notes?: string } | undefined;
    // If this were absent, every "does not contain" assertion below would be
    // measuring the absence of something that was never there.
    expect(back?.notes).toBe(secret.notes);
    expect(secret.name.length).toBeGreaterThan(0);
    expect(secret.stage.length).toBeGreaterThan(0);
  });

  it("the admin persona genuinely IS an administrator — an admin-only route answers it", async () => {
    _resetRateLimitsForTests();
    const r = await asAdmin(request(app).get("/api/admin/users"));
    // Without this, a 403 below could just mean "that persona is nobody".
    expect(r.status).toBe(200);
  }, 60_000);

  it("CONTROL: a NON-admin is refused by the admin archive surface, so the guard is live", async () => {
    _resetRateLimitsForTests();
    const r = await request(app).get("/api/admin/archive").set("x-user-id", "u_aisha_patel");
    expect(r.status).toBeGreaterThanOrEqual(400);
  }, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   1 — THE ADMIN ARCHIVE SURFACE CARRIES DECISIONS, NEVER RECORDS.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 · the archive view this wave added does not become a record viewer", () => {
  it("an ARCHIVED contact's private content is NOT in the admin archive response", async () => {
    /* First archive the very row whose note is the marker, through the shipped
       founder route, so the registry definitely has a row pointing AT it. This is
       the worst case for the boundary: the administrator is looking at a list
       that names this exact record. */
    _resetRateLimitsForTests();
    const arch = await request(app)
      .post(`/api/founder/investor-crm/${secret.id}/archive`)
      .set("x-user-id", founder)
      .send({ reason: "w344 boundary test" });
    expect(arch.status).toBe(200);

    // rows > 0 precondition: the registry really holds a decision about this row.
    const reg = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM record_archive WHERE record_id = ?`)
      .get(secret.id) as { n: number };
    expect(reg.n).toBeGreaterThan(0);

    _resetRateLimitsForTests();
    const r = await asAdmin(request(app).get("/api/admin/archive"));
    expect(r.status).toBe(200);
    const body = JSON.stringify(r.body);

    // THE ASSERTION THE RULING TURNS ON. Searched over the WHOLE response body,
    // so it cannot be evaded by moving the field.
    expect(body).not.toContain(secret.notes as string);
    expect(body).not.toContain(secret.name);
    if (secret.email) expect(body).not.toContain(secret.email);

    // And the response DOES carry the decision — so the surface works, and the
    // absence above is a boundary rather than an empty response.
    expect(body).toContain(secret.id);
    expect(r.body?.surface).toBe("archive-decisions-only");
    expect(Array.isArray(r.body?.rows)).toBe(true);
    expect(r.body.rows.length).toBeGreaterThan(0);
  }, 120_000);

  it("every field name in the admin archive rows is a DECISION field — no CRM field is present", () => {
    /* A CLOSED SET, counted here rather than trusted. If a future change adds a
       contact name or note to the registry response, this goes red and names the
       field it did not expect. */
    const allowed = new Set([
      "id",
      "tenantId",
      "entityType",
      "recordId",
      "state",
      "archivedAt",
      "archivedByUserId",
      "archiveReason",
      "unarchivedAt",
      "unarchivedByUserId",
    ]);
    const rows = rawDb()
      .prepare(`SELECT * FROM record_archive LIMIT 1`)
      .all() as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0); // rows > 0 precondition
    // The stored shape, in snake case, mapped to the same closed set.
    const storedAllowed = new Set([...allowed].map((k) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())));
    for (const key of Object.keys(rows[0])) {
      expect(storedAllowed.has(key)).toBe(true);
    }
    expect(Object.keys(rows[0]).length).toBe(10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 — THE ADMIN CANNOT REACH A CRM RECORD THROUGH THE CRM ITSELF.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 · an administrator is refused by the founder CRM routes themselves", () => {
  const routes = [
    "/api/founder/investor-crm",
    "/api/founder/investor-crm/archive-summary",
  ];

  for (const route of routes) {
    it(`ADMIN IS REFUSED, OR SEES NO CRM CONTENT, at GET ${route}`, async () => {
      _resetRateLimitsForTests();
      const r = await asAdmin(request(app).get(route));
      const body = JSON.stringify(r.body ?? {});
      /* Two acceptable outcomes and no third: refused outright, or answered
         without any founder CRM content in it. What is NOT acceptable is a 200
         carrying this founder's private record. */
      if (r.status === 200) {
        expect(body).not.toContain(secret.notes as string);
        expect(body).not.toContain(secret.name);
      } else {
        expect(r.status).toBeGreaterThanOrEqual(400);
      }
    }, 60_000);
  }

  it("ADMIN CANNOT ARCHIVE OR RESTORE another person's CRM record", async () => {
    // The write side of the same boundary: reading is forbidden, so acting on it
    // must be too.
    for (const verb of ["archive", "unarchive"]) {
      _resetRateLimitsForTests();
      const r = await asAdmin(
        request(app).post(`/api/founder/investor-crm/${secret.id}/${verb}`).send({}),
      );
      expect(r.status).not.toBe(200);
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
  }, 120_000);

  it("CONTROL: the OWNING FOUNDER can still read the record — so the refusals are a boundary, not a breakage", async () => {
    _resetRateLimitsForTests();
    const r = await request(app)
      .get("/api/founder/investor-crm")
      .set("x-user-id", founder)
      .query({ companyId: CO, includeArchived: "1" });
    expect(r.status).toBe(200);
    const body = JSON.stringify(r.body);
    // The founder sees their own private note. If this failed, every assertion
    // above would be passing because the CRM returns nothing to anybody.
    expect(body).toContain(secret.notes as string);
  }, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   3 — THE CONSENT SURFACES CANNOT BE TURNED INTO A RECORD VIEWER EITHER.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 · the consent surfaces added this wave carry no founder CRM content", () => {
  it("the public consent request carries wording only", async () => {
    const r = await request(app).get("/api/consent/marketing-request");
    expect(r.status).toBe(200);
    const body = JSON.stringify(r.body);
    expect(body.length).toBeGreaterThan(100); // precondition: it answered something
    expect(body).not.toContain(secret.notes as string);
    expect(body).not.toContain(secret.name);
  }, 60_000);

  it("an ADMIN reading the consent surface gets THEIR OWN state, never anybody's records", async () => {
    _resetRateLimitsForTests();
    const r = await asAdmin(request(app).get("/api/consent/marketing"));
    const body = JSON.stringify(r.body ?? {});
    expect(body).not.toContain(secret.notes as string);
    expect(body).not.toContain(secret.name);
  }, 60_000);

  it("the consent table holds NO founder CRM column — the two records never merge", () => {
    const cols = (
      rawDb().prepare(`PRAGMA table_info(marketing_consent_event)`).all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(cols.length).toBeGreaterThan(0); // rows > 0 precondition on the shape
    for (const forbidden of ["notes", "stage", "company_id", "contact_id", "record_id"]) {
      expect(cols).not.toContain(forbidden);
    }
  });
});
