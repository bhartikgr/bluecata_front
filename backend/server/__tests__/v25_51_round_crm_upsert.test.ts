/**
 * v25.51 Phase 3 (5a) — round → founder CRM upsert-and-link idempotency.
 *
 * Ozan: manual (non-Capavate) investors added to a round's initial
 * shareholders must also become founder CRM contacts so the round and the
 * CRM are one dataset. This locks the core contract:
 *   1. First upsert CREATES a contact and returns its id.
 *   2. Re-upsert with the SAME email links to the SAME id (no duplicate).
 *   3. Re-upsert with no email but the SAME first+last+company links to the
 *      SAME id (fallback dedupe).
 *   4. A different identity creates a DIFFERENT contact.
 * Cap-table is never touched by this helper.
 *
 * v25.51 REVISE — the unit-level tests above alone were insufficient: the
 * GPT-5.5 blocker was that the round PATCH route resolved founderCrmStore via a
 * runtime require() that THREW and was swallowed, so a manual-investor PATCH
 * returned 200 WITHOUT ever creating/linking a CRM contact. The unit test
 * (which imports upsertFromRound directly) could not catch that. The
 * "REAL route" describe block below drives the actual Express
 * PATCH /api/founder/rounds/:roundId/initial-shareholders and asserts a
 * founder_crm_contacts row is genuinely created + linked (not a no-op) and that
 * a re-PATCH does NOT duplicate — this fails if the require/import is broken.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import {
  upsertFromRound,
  _testAccessFounderCrm,
  listContactsForCompany,
} from "../founderCrmStore";
import { registerRoundInitialShareholdersRoutes } from "../lib/roundInitialShareholdersStore";
import { founderCrmContacts } from "@shared/schema";
import { getDb } from "../db/connection";

const COMPANY = "co_round_crm_test";

function reset() {
  _testAccessFounderCrm.contacts.length = 0;
  try {
    getDb().delete(founderCrmContacts).run();
  } catch {
    /* ignore */
  }
}

describe("v25.51 Phase 3 — upsertFromRound idempotent link", () => {
  beforeEach(() => reset());

  it("creates on first call, links (same id, no duplicate) on repeat by email", () => {
    const first = upsertFromRound({
      companyId: COMPANY,
      firstName: "Maya",
      lastName: "Chen",
      companyName: "Greenwood Capital",
      email: "maya@greenwood.vc",
      roundId: "rnd_1",
    });
    expect(first).not.toBeNull();
    expect(first!.created).toBe(true);

    const second = upsertFromRound({
      companyId: COMPANY,
      firstName: "Maya",
      lastName: "Chen",
      companyName: "Greenwood Capital",
      email: "maya@greenwood.vc",
      roundId: "rnd_1",
    });
    expect(second!.created).toBe(false);
    expect(second!.id).toBe(first!.id);

    // Exactly ONE contact row for this identity.
    const rows = listContactsForCompany(COMPANY).filter(
      (c) => c.email.toLowerCase() === "maya@greenwood.vc",
    );
    expect(rows.length).toBe(1);
    // Discrete fields persisted; composed name kept as "First Last".
    expect(rows[0].firstName).toBe("Maya");
    expect(rows[0].lastName).toBe("Chen");
    expect(rows[0].name).toBe("Maya Chen");
  });

  it("dedupes by first+last+company when no email is present", () => {
    const a = upsertFromRound({
      companyId: COMPANY,
      firstName: "Sam",
      lastName: "Okoro",
      companyName: "Harbor Angels",
    });
    expect(a!.created).toBe(true);

    const b = upsertFromRound({
      companyId: COMPANY,
      firstName: "Sam",
      lastName: "Okoro",
      companyName: "Harbor Angels",
    });
    expect(b!.created).toBe(false);
    expect(b!.id).toBe(a!.id);

    const rows = listContactsForCompany(COMPANY).filter(
      (c) => (c.firstName ?? "") === "Sam" && (c.lastName ?? "") === "Okoro",
    );
    expect(rows.length).toBe(1);
  });

  it("creates distinct contacts for distinct identities", () => {
    const a = upsertFromRound({ companyId: COMPANY, firstName: "A", lastName: "One", email: "a@x.test" });
    const b = upsertFromRound({ companyId: COMPANY, firstName: "B", lastName: "Two", email: "b@x.test" });
    expect(a!.id).not.toBe(b!.id);
    expect(a!.created).toBe(true);
    expect(b!.created).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
 * REAL ROUTE — PATCH /api/founder/rounds/:roundId/initial-shareholders
 * This is the surface that was silently broken (require threw + swallowed).
 * ------------------------------------------------------------------------- */
const ROUTE_COMPANY = "co_round_crm_route_test";
const ROUND = "rnd_route_5a";
const ADMIN = "u_admin"; // PERSONAS entry with isAdmin:true → bypasses ownership gate

let app: Express;
let server: http.Server;
let port: number;

function routeReset() {
  _testAccessFounderCrm.contacts.length = 0;
  try {
    getDb().delete(founderCrmContacts).run();
  } catch {
    /* ignore */
  }
}

async function patchShareholders(
  roundId: string,
  body: unknown,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/founder/rounds/${roundId}/initial-shareholders`,
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-user-id": ADMIN, // Vitest-only persona header (resolvePersonaId)
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json: any = null;
          try { json = data ? JSON.parse(data) : null; } catch { json = data; }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("v25.51 Phase 3 (5a) — REAL PATCH route creates + links founder CRM contact", () => {
  beforeAll(async () => {
    app = express();
    app.use(express.json());
    registerRoundInitialShareholdersRoutes(app);
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => routeReset());

  it("a manual investor row on PATCH actually creates a founder_crm_contacts row", async () => {
    // Precondition: no contact for this company yet.
    expect(listContactsForCompany(ROUTE_COMPANY).length).toBe(0);

    const r = await patchShareholders(ROUND, {
      companyId: ROUTE_COMPANY,
      shareholders: [
        {
          name: "Maya Chen",
          firstName: "Maya",
          lastName: "Chen",
          company: "Greenwood Capital",
          email: "maya@greenwood.vc",
          source: "manual",
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.count).toBe(1);

    // PROOF the CRM contact was genuinely created + linked (not a swallowed
    // no-op): a real founder_crm_contacts row exists for the company.
    const contacts = listContactsForCompany(ROUTE_COMPANY);
    const found = contacts.find((c) => c.email.toLowerCase() === "maya@greenwood.vc");
    expect(found).toBeTruthy();
    expect(found!.firstName).toBe("Maya");
    expect(found!.lastName).toBe("Chen");
    expect(found!.name).toBe("Maya Chen"); // composed "First Last" preserved
  });

  it("re-PATCH with the same manual investor does NOT duplicate the CRM contact", async () => {
    const payload = {
      companyId: ROUTE_COMPANY,
      shareholders: [
        {
          name: "Maya Chen",
          firstName: "Maya",
          lastName: "Chen",
          company: "Greenwood Capital",
          email: "maya@greenwood.vc",
          source: "manual",
        },
      ],
    };

    const r1 = await patchShareholders(ROUND, payload);
    expect(r1.status).toBe(200);
    const afterFirst = listContactsForCompany(ROUTE_COMPANY).filter(
      (c) => c.email.toLowerCase() === "maya@greenwood.vc",
    );
    expect(afterFirst.length).toBe(1);
    const firstId = afterFirst[0].id;

    // Re-PATCH the identical payload (client resends without crmContactId).
    const r2 = await patchShareholders(ROUND, payload);
    expect(r2.status).toBe(200);
    const afterSecond = listContactsForCompany(ROUTE_COMPANY).filter(
      (c) => c.email.toLowerCase() === "maya@greenwood.vc",
    );
    // Still exactly ONE row, same id → dedupe held across the real route.
    expect(afterSecond.length).toBe(1);
    expect(afterSecond[0].id).toBe(firstId);
  });

  it("a source:crm row that already carries crmContactId creates NO new CRM contact", async () => {
    // The case name presupposes a contact that ALREADY exists — seed it, so the
    // payload carries a real crmContactId instead of a dangling one. (The
    // original bare `length === 0` assertion only held while round-invite
    // issuance was dead: a live invitation legitimately auto-seeds a CRM lead
    // via roundInvitationsStore → upsertCrmContactForInvitation, L-010
    // v23.4.13. Counting *all* contacts therefore measured invite issuance,
    // not the round→CRM upsert this case is about.)
    const seeded = upsertFromRound({
      companyId: ROUTE_COMPANY,
      firstName: "Already",
      lastName: "Linked",
      email: "linked@existing.vc",
    });
    expect(seeded!.created).toBe(true);
    const before = listContactsForCompany(ROUTE_COMPANY);
    expect(before.length).toBe(1);

    const r = await patchShareholders(ROUND, {
      companyId: ROUTE_COMPANY,
      shareholders: [
        {
          name: "Already Linked",
          firstName: "Already",
          lastName: "Linked",
          email: "linked@existing.vc",
          source: "crm",
          crmContactId: seeded!.id,
        },
      ],
    });
    expect(r.status).toBe(200);
    // crm-source rows are assumed already linked → no NEW contact minted, and
    // the pre-existing row is linked in place rather than replaced.
    const after = listContactsForCompany(ROUTE_COMPANY);
    expect(after.length).toBe(1);
    expect(after[0].id).toBe(seeded!.id);
  });
});
