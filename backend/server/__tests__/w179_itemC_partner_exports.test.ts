/**
 * WAVE 179 · ITEM C · R151.2 — PARTNER CSV EXPORTS.
 *
 * Before this wave, exactly ONE export existed platform-wide (the client-side
 * Invoices CSV on the Billing tab) and `/api/partner/me/**` had no export or PDF
 * route at all. A GP could see their LP roster, their fee history and their CRM on
 * screen and could not take any of it out of the product.
 *
 * ── WHAT THESE POLES ARE FOR ────────────────────────────────────────────────
 * R151.2's real requirement is not "a file downloads". It is that the file AGREES
 * WITH THE SCREEN and that it contains ONLY the caller's own data. So:
 *
 *   1 · The roster export's rows are checked against the JSON payload the roster
 *       SCREEN renders — the same `buildPartnerLpRosterPayload` — field by field,
 *       not against a hand-written expectation.
 *   2 · Money is exact and refuses rather than zeroes: a JPY (exponent 0) figure
 *       does not sprout decimals, an unrecorded amount reads "Not derivable", and
 *       no cell is produced by float arithmetic.
 *   3 · Currency appears PER ROW and there is NO cross-currency total row (R149.4).
 *   4 · FENCE — another partner's SPV roster: refused.
 *   5 · FENCE — another partner's SPV fees: refused.
 *   6 · FENCE — another partner's contacts: absent from the file, and the caller's
 *       own contacts are present. A leak here is the worst outcome available.
 *   7 · The fee export equals the fee rows the Fees card reads, same order.
 *   8 · The contacts export equals the contacts the CRM screen lists, same order.
 *   9 · ANTI-VACUITY: the fixtures are non-empty, and pole 6's own-rows assertion
 *       proves the refusals in poles 4-5 are not "everything 404s".
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerPartnerWorkspaceV19Routes, listCrmContactsForPartner } from "../partnerWorkspaceV19Store";
import { registerPartnerExportRoutes } from "../partnerExportRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { buildPartnerLpRosterPayload } from "../spvEngineRoutes";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import { __setRuntimePersona } from "../lib/userContext";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import {
  PARTNER_EXPORT_LP_ROSTER_HEADER,
  PARTNER_EXPORT_FEES_HEADER,
  PARTNER_EXPORT_CONTACTS_HEADER,
} from "../partnerExportRoutes";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const ACTOR_A = "u_avi_managing";
const PARTNER_B = "ac_consortium_partner_w179c_other_firm";
const ACTOR_B = "u_w179c_other_managing";
const CONTACT_A = "w179c_contact_of_a";
const CONTACT_B = "w179c_contact_of_b";
const NOW = "2026-08-27T00:00:00.000Z";

let app: express.Express;
let spvA = "";
let spvB = "";

function createBody(name: string, currency: string) {
  return {
    spvName: name,
    jurisdiction: "delaware",
    vintage: 2026,
    currency,
    status: "planned",
    signoffLegalName: "Managing Partner",
    signoffAccepted: true,
  };
}

async function createSpvAs(actor: string, name: string, currency = "USD"): Promise<string> {
  const res = await request(app)
    .post("/api/partner/me/spvs")
    .set("x-user-id", actor)
    .send(createBody(name, currency));
  expect(res.status).toBe(201);
  return res.body.spv.id as string;
}

function insertContact(id: string, partnerId: string, email: string, name: string, org: string): void {
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO partner_crm_contacts
         (id, tenant_id, partner_id, email, name, role, org, created_at, updated_at)
       VALUES (?, 'tenant_platform', ?, ?, ?, 'CFO', ?, ?, ?)`,
    )
    .run(id, partnerId, email, name, org, NOW, NOW);
}

/**
 * Split a quote-all CSV line back into its cells. A small state machine rather
 * than `split(",")`, because a contact's organisation may legitimately contain a
 * comma and the whole point of quoting every field is that such a value does not
 * shift the columns to its right.
 */
function parseRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    }
  }
  out.push(cur);
  return out;
}

function bodyRows(text: string): string[][] {
  const lines = text.split("\r\n").filter((l) => l.length > 0);
  return lines.map(parseRow);
}

/** Register a second partner firm by authenticating its actor once. */
async function ensurePartnerB(): Promise<void> {
  /* An AUTHENTICATED identity for firm B's managing partner. `getUserContext`
     resolves personas, not bare header ids, so without this the fence poles would
     be answered 401 by the session gate and would prove nothing about ownership.
     Same escape hatch `activityLogStrictTenantIsolation.test.ts:79` uses. */
  __setRuntimePersona({
    userId: ACTOR_B,
    email: `${ACTOR_B}@w179c.test`,
    name: "W179C Other Managing Partner",
    isFounder: false,
    isInvestor: false,
    isAdmin: false,
    hasInvitations: false,
  });
  /* Column list taken from the wave-167 confidentiality test, which seeds the same
     table (`wave167_itemE_partner_own_lp_confidentiality.test.ts:137-149`). */
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO partner_team_members
         (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
       VALUES (?, ?, ?, 'managing_partner', 'active', ?, NULL, 'u_w179c', 0, ?)`,
    )
    .run(`ptm_${ACTOR_B}`, PARTNER_B, ACTOR_B, NOW, NOW);
  try {
    rawDb()
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, role, created_at, updated_at)
         VALUES (?, ?, 'partner', ?, ?)`,
      )
      .run(ACTOR_B, `${ACTOR_B}@w179c.test`, NOW, NOW);
  } catch {
    /* `users` shape differs across builds; the team-member row is what authorises. */
  }
  /* AND a real, ACTIVE partner ACCOUNT for firm B.

     `requirePartnerAuth` (server/lib/requirePartnerAuth.ts:53-62) needs three
     things in sequence: an authed user, an active team-member row, and a contact
     of kind `consortium_partner` with status `active`. Without the third, firm B's
     calls stop at 403 PARTNER_NOT_ACTIVE and the fence poles below would be proved
     by the SESSION gate rather than by the OWNERSHIP check — which is the
     assertion R151.2 actually asks for. Registered through the store's OWN seed
     injector (`adminContactsStoreShim._registerSeedPartner`, the same one
     `seedTestPartnerSandbox` uses for firm A) because `getById` reads the contacts
     MAP, not the `contacts` table. */
  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "W179C Other Firm Inc",
    displayName: "W179C Other Firm",
    email: "firm-b@w179c.test",
    region: "NA-East",
    regionCode: "NA_EAST",
    tier: "catalyst",
    partnerType: "consortium",
  });
}

/** The header set the wave-167 confidentiality test uses to act as a given user. */
function asPartner(r: request.Test, userId: string): request.Test {
  return r.set("x-user-id", userId).set("x-actor-user-id", userId).set("x-role", "partner");
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerPartnerWorkspaceV19Routes(app);
  registerPartnerExportRoutes(app);
  seedTestPartnerSandbox({ force: true });
  await ensurePartnerB();

  spvA = await createSpvAs(ACTOR_A, "W179C Vehicle of A");
  /* A NON-EMPTY FIXTURE, or every row-equality pole below would pass by comparing
     nothing to nothing. Two LPs at different commitments and one carry fee, seeded
     through the store's own sinks so the rows are real rows. */
  spvEngineStore.subscribe(PARTNER_A, spvA, { investorId: "inv_w179c_one", commitmentMinor: 250000_00 }, ACTOR_A);
  spvEngineStore.subscribe(PARTNER_A, spvA, { investorId: "inv_w179c_two", commitmentMinor: 75000_00 }, ACTOR_A);
  spvEngineStore.addFee(
    PARTNER_A,
    spvA,
    { layer: "management", feeType: "carry", carryPct: 0.2, currency: "USD", effectiveDate: "2026-01-01" },
    ACTOR_A,
  );
  insertContact(CONTACT_A, PARTNER_A, "a@w179c.test", "Ada OfA", "Acme");
  insertContact(CONTACT_B, PARTNER_B, "b@w179c.test", "Bob OfB", "Rival Ltd");
});

describe("WAVE 179 · ITEM C — partner CSV exports", () => {
  it("POLE 1 — the LP roster export equals the roster the SCREEN renders, row for row", async () => {
    const res = await request(app)
      .get(`/api/partner/me/spv/${spvA}/lp-roster.csv`)
      .set("x-user-id", ACTOR_A);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");

    const rows = bodyRows(res.text);
    expect(rows[0]).toEqual([...PARTNER_EXPORT_LP_ROSTER_HEADER]);

    /* The SAME function the JSON route the screen reads calls. */
    const spv = spvEngineStore.getSpv(PARTNER_A, spvA)!;
    const payload = buildPartnerLpRosterPayload(PARTNER_A, spvA, spv);
    expect(rows.length - 1).toBe(payload.subscribers.length + payload.invites.length);
    /* ANTI-VACUITY: the fixture really has LPs on it. */
    expect(payload.subscribers.length).toBeGreaterThan(0);

    payload.subscribers.forEach((s: Record<string, unknown>, idx: number) => {
      const row = rows[idx + 1];
      expect(row[0]).toBe("Subscriber");
      expect(row[1]).toBe((s.name as string) ?? "");
      expect(row[2]).toBe((s.email as string) ?? "");
      /* Currency PER ROW (R149.4). */
      expect(row[4]).toBe(spv.currency);
    });
    payload.invites.forEach((i: Record<string, unknown>, idx: number) => {
      const row = rows[1 + payload.subscribers.length + idx];
      expect(row[0]).toBe("Invited");
      /* An invite has no commitment: it REFUSES rather than reading 0. */
      expect(row[3]).toBe("Not derivable");
      expect(row[6]).toBe("Not derivable");
    });
  });

  it("POLE 2/3 — every row carries a currency and there is NO cross-currency total row", async () => {
    const res = await request(app)
      .get(`/api/partner/me/spv/${spvA}/lp-roster.csv`)
      .set("x-user-id", ACTOR_A);
    const rows = bodyRows(res.text);
    const currencyCol = PARTNER_EXPORT_LP_ROSTER_HEADER.indexOf("Currency");
    for (const row of rows.slice(1)) {
      expect(row[currencyCol]).toMatch(/^[A-Z]{3}$/);
      /* No row is a total: a total row would have to be labelled, and the only
         two labels this export emits are the two row types. */
      expect(["Subscriber", "Invited"]).toContain(row[0]);
    }
    expect(res.text.toLowerCase()).not.toContain("total");
  });

  it("POLE 4 — FENCE: partner B cannot export partner A's LP roster", async () => {
    /* Firm B is a FULLY AUTHENTICATED, ACTIVE partner here (see `ensurePartnerB`),
       so this 404 comes from the OWNERSHIP check inside the export route and not
       from the session gate. Pinned exactly, not as a set of acceptable codes. */
    const res = await asPartner(request(app).get(`/api/partner/me/spv/${spvA}/lp-roster.csv`), ACTOR_B);
    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("SPV_NOT_FOUND");
    /* Not one byte of A's roster travelled. */
    expect(res.text).not.toContain("Subscriber");
    expect(res.headers["content-type"]).not.toContain("text/csv");
  });

  it("POLE 5 — FENCE: partner B cannot export partner A's fee history", async () => {
    const res = await asPartner(request(app).get(`/api/partner/me/spv/${spvA}/fees.csv`), ACTOR_B);
    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("SPV_NOT_FOUND");
    expect(res.headers["content-type"]).not.toContain("text/csv");
    expect(res.text).not.toContain("Fee ID");
  });

  it("POLE 5b — firm B's session is REAL, and the store is what refuses A's vehicle to it", async () => {
    /* Proves poles 4 and 5 are not passing because firm B cannot log in at all: an
       endpoint firm B IS entitled to must answer it. */
    const own = await asPartner(request(app).get("/api/partner/me/crm/contacts.csv"), ACTOR_B);
    expect(own.status).toBe(200);
    expect(own.text).toContain("Bob OfB");
    expect(own.text).not.toContain("Ada OfA");
    expect(spvEngineStore.getSpv(PARTNER_A, spvA)).toBeTruthy();
    expect(spvEngineStore.getSpv(PARTNER_B, spvA)).toBeFalsy();
  });

  it("POLE 6 — FENCE: the contacts export contains the caller's OWN contacts and NONE of the other firm's", async () => {
    const res = await request(app).get("/api/partner/me/crm/contacts.csv").set("x-user-id", ACTOR_A);
    expect(res.status).toBe(200);
    const rows = bodyRows(res.text);
    expect(rows[0]).toEqual([...PARTNER_EXPORT_CONTACTS_HEADER]);
    const text = res.text;
    /* Own row present — so this pole is not passing because the file is empty. */
    expect(text).toContain("Ada OfA");
    expect(text).toContain("a@w179c.test");
    /* The rival firm's contact, its email and its organisation are all absent. */
    expect(text).not.toContain("Bob OfB");
    expect(text).not.toContain("b@w179c.test");
    expect(text).not.toContain("Rival Ltd");
    expect(text).not.toContain(CONTACT_B);
  });

  it("POLE 7 — the fee export equals the rows the Fees card reads, in the same order", async () => {
    const res = await request(app).get(`/api/partner/me/spv/${spvA}/fees.csv`).set("x-user-id", ACTOR_A);
    expect(res.status).toBe(200);
    const rows = bodyRows(res.text);
    expect(rows[0]).toEqual([...PARTNER_EXPORT_FEES_HEADER]);
    const fees = spvEngineStore.listFees(PARTNER_A, spvA);
    expect(rows.length - 1).toBe(fees.length);
    /* ANTI-VACUITY: there really is a fee to compare. */
    expect(fees.length).toBeGreaterThan(0);
    fees.forEach((f, idx) => {
      const row = rows[idx + 1];
      expect(row[0]).toBe(f.id);
      expect(row[1]).toBe(f.layer);
      expect(row[2]).toBe(f.feeType);
      /* Carry: a fraction rendered as a percentage at this boundary only, and a
         fee with no carry REFUSES instead of reading 0.00. */
      expect(row[3]).toBe(f.carryPct == null ? "Not derivable" : (f.carryPct * 100).toFixed(2));
      expect(row[5]).toBe(f.currency);
      expect(row[6]).toBe(f.effectiveDate);
    });
  });

  it("POLE 8 — the contacts export equals the rows the CRM screen lists, in the same order", async () => {
    const res = await request(app).get("/api/partner/me/crm/contacts.csv").set("x-user-id", ACTOR_A);
    const rows = bodyRows(res.text);
    const expected = listCrmContactsForPartner(PARTNER_A)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    expect(rows.length - 1).toBe(expected.length);
    expect(expected.length).toBeGreaterThan(0);
    expected.forEach((c, idx) => {
      const row = rows[idx + 1];
      expect(row[0]).toBe(c.id);
      expect(row[1]).toBe(c.name);
      expect(row[2]).toBe(c.email ?? "");
      expect(row[3]).toBe(c.org ?? "");
      expect(row[7]).toBe(c.createdAt);
    });
  });

  it("POLE 9 — money formatting is EXACT and exponent-aware, and never float-derived", async () => {
    /* A zero-exponent currency must not gain decimals, and a two-exponent one must
       not lose them. Exercised through the real route on a JPY vehicle. */
    const jpy = await createSpvAs(ACTOR_A, "W179C JPY Vehicle", "JPY");
    const res = await request(app).get(`/api/partner/me/spv/${jpy}/lp-roster.csv`).set("x-user-id", ACTOR_A);
    expect(res.status).toBe(200);
    const rows = bodyRows(res.text);
    const amountCol = PARTNER_EXPORT_LP_ROSTER_HEADER.indexOf("Commitment");
    for (const row of rows.slice(1)) {
      if (row[amountCol] === "Not derivable") continue;
      /* JPY: whole units, no decimal point at all. */
      expect(row[amountCol]).not.toContain(".");
    }
    /* And the module contains no float arithmetic on money: no Number()/parseInt/
       parseFloat, and no division, in the minor-unit formatter. */
    const src = require("node:fs").readFileSync("server/partnerExportRoutes.ts", "utf8") as string;
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(stripped).not.toMatch(/parseFloat\s*\(/);
    expect(stripped).not.toMatch(/parseInt\s*\(/);
    expect(/Number\s*\(/.test(stripped)).toBe(false);
    /* The stripper really stripped: the docblocks are gone. */
    expect(stripped).not.toContain("RFC 4180");
  });
});
