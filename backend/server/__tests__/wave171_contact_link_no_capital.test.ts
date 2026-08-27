/**
 * WAVE 171 — A CONTACT CAN BE LINKED TO A VEHICLE, AND THAT LINK MOVES NO MONEY.
 *
 * WHAT THIS FILE IS FOR, IN ONE SENTENCE. The brief's hard requirement is not
 * "linking works" — it is "a link must not create or imply a commitment ... it
 * must move no capital figure, no committed total, no cap capacity, no fee band.
 * PROVE THAT BY TEST." So the centre of this file is group C, which SNAPSHOTS
 * every money-bearing field the platform holds for the vehicle, links a contact,
 * links a second one, removes one, and asserts the snapshot is byte-identical.
 *
 * WHY A SNAPSHOT AND NOT A SPOT-CHECK. Asserting `committedMinor === 0` after a
 * link would pass equally well against an implementation that moved
 * `calledMinor` instead. Group C reads the WHOLE row and compares serialised
 * JSON, so a change to any money column — including one added after this test was
 * written — fails it.
 *
 * FAIL-BEFORE. Every test in groups A-D fails before the wave-171 routes exist:
 * `POST /api/partner/me/crm/contacts/:id/links` 404s, so group A's 201 assertion
 * fails and `links` is absent from the detail payload. Recorded in
 * `build_log/wave171/W171_TESTS.md` with real output.
 *
 * NEVER MUTATES data.db / test.db. This uses the ordinary in-memory test handle
 * via `seedDemoData` + `seedTestPartnerSandbox`, exactly as
 * `groupF1_partner_crm_parity.test.ts` does.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  seedTestPartnerSandbox,
  partnerTeamStore,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { hydratePartnerWorkspaceV19Store } from "../partnerWorkspaceV19Store";
import { storeCredential } from "../userCredentialsStore";

const PARTNER_A = TEST_PARTNER_ID;
const MANAGING_A = TEST_PARTNER_USERS.managing.userId;

const PARTNER_B = "ac_consortium_partner_w171_b";
const MANAGING_B = "u_w171_b_managing";

/* The vehicles live in the ENGINE table `spv` (singular), keyed on
   `sponsor_partner_id` — the fence the brief names and the one
   `lib/partnerDelegatedContext.ts:211-246` calls "the whole fence". */
const SPV_MINE = "spv_w171_mine";
const SPV_THEIRS = "spv_w171_theirs";

let app: Express;
let server: http.Server;
let port: number;

function stampSignedAgreement(partnerId: string, legalName: string): void {
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

/** Insert an engine SPV with REAL money on it, so a snapshot has something to
    protect. A vehicle whose totals are all zero cannot prove a total did not
    move. */
function insertEngineSpv(id: string, sponsorPartnerId: string, name: string): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO spv
         (id, sponsor_partner_id, name, spv_type, jurisdiction, status,
          distribution_scope, target_raise_minor, min_check_minor, cap_minor,
          currency, carry_basis, lp_visibility, created_at, updated_at, curr_hash)
       VALUES (?, ?, ?, 'spv', 'delaware', 'fundraising', 'private',
               5000000, 2500000, 7500000, 'USD', 'committed', 'own_only', ?, ?, ?)`,
    )
    .run(id, sponsorPartnerId, name, now, now, "0".repeat(64));
}

/** Every money-bearing column on the vehicle, plus the commitment ledger for it.
    Serialised so a diff in ANY of them fails the comparison. */
function moneySnapshot(spvId: string): string {
  /* DISCOVERED, NOT HARDCODED. An earlier draft of this helper named the columns
     it wanted and broke on `deployment_fee_minor`, which exists on the live
     schema but not in the test bootstrap's inline DDL. Naming them was also the
     weaker test: a money column added to `spv` after today would not have been
     watched. So the column list is read from the schema at run time and every
     money-shaped column is captured, whatever it is called. */
  const allCols = (
    rawDb().prepare(`PRAGMA table_info('spv')`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  const moneyCols = allCols.filter((c) =>
    /minor|amount|currenc|fee|carry|nav|price|raise|cap\b|terms|status/i.test(c),
  );
  /* If this ever selects nothing the comparison would be vacuously true, so the
     caller asserts on the CONTENT of the snapshot as well. */
  const spv = rawDb()
    .prepare(`SELECT ${moneyCols.map((c) => `"${c}"`).join(", ")} FROM spv WHERE id = ?`)
    .get(spvId);
  let commitments: unknown[] = [];
  try {
    commitments = rawDb()
      .prepare(
        `SELECT id, lp_user_id, amount_minor, status FROM spv_commitments
          WHERE spv_id = ? ORDER BY id`,
      )
      .all(spvId);
  } catch {
    /* Table shape differs across bootstraps; an absent ledger is still a valid
       snapshot — it just means there is nothing there to move either. */
    commitments = [];
  }
  return JSON.stringify({ watchedColumns: moneyCols, spv, commitments });
}

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request({ hostname: "127.0.0.1", port, path: apiPath, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let b: any = null;
        try {
          b = JSON.parse(buf);
        } catch {
          /* keep null */
        }
        resolve({ status: res.statusCode ?? 0, body: b });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function createContact(userId: string, first: string, last: string, email: string): Promise<string> {
  const res = await call("POST", "/api/partner/me/crm/contacts", {
    userId,
    body: { first_name: first, last_name: last, email },
  });
  expect([200, 201]).toContain(res.status);
  return String(res.body?.contact?.id ?? "");
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  seedTestPartnerSandbox({ force: true });

  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "W171 PARTNER B, INC",
    displayName: "W171 PARTNER B",
    email: "ops@w171-b.example",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "accelerator",
  });
  partnerTeamStore.add(PARTNER_B, MANAGING_B, "managing_partner", "u_system_seed", { isSeed: true });
  stampSignedAgreement(PARTNER_B, "W171 PARTNER B, INC");
  storeCredential({
    userId: MANAGING_B,
    email: "managing-b@w171-b.example",
    name: "W171 B Managing",
    password: "test-password-w171-b",
  });

  insertEngineSpv(SPV_MINE, PARTNER_A, "W171 My Vehicle");
  insertEngineSpv(SPV_THEIRS, PARTNER_B, "W171 Their Vehicle");

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
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

/* ════════════════════════════════════════════════════════════════════════════
 * GROUP A — THE CONTROL EXISTS AT ALL. This is what wave 171 was asked for.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("wave171 · A — a contact can be linked to a vehicle the partner sponsors", () => {
  it("A1: the link-targets endpoint offers only the partner's OWN sponsored SPVs", async () => {
    const res = await call("GET", "/api/partner/me/crm/link-targets", { userId: MANAGING_A });
    expect(res.status).toBe(200);
    const ids = (res.body?.spvs ?? []).map((s: any) => s.id);
    expect(ids).toContain(SPV_MINE);
    // ANTI-VACUITY: the other partner's vehicle genuinely exists in the table…
    const exists = rawDb().prepare(`SELECT id FROM spv WHERE id = ?`).get(SPV_THEIRS);
    expect(exists).toBeTruthy();
    // …and is still absent from this partner's offer. That is the fence, not an
    // empty fixture.
    expect(ids).not.toContain(SPV_THEIRS);
  });

  it("A2: POST creates the link and it comes back on the contact detail", async () => {
    const contactId = await createContact(MANAGING_A, "Ada", "Linkwell", "ada.linkwell@w171.example");
    const created = await call("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
      userId: MANAGING_A,
      body: { target_kind: "spv", target_id: SPV_MINE, relationship: "prospective_lp", note: "Met at demo day" },
    });
    expect(created.status).toBe(201);
    expect(created.body?.links?.length).toBe(1);

    const detail = await call("GET", `/api/partner/me/crm/contacts/${contactId}`, { userId: MANAGING_A });
    expect(detail.status).toBe(200);
    expect(detail.body?.links?.[0]?.targetId).toBe(SPV_MINE);
    expect(detail.body?.links?.[0]?.targetName).toBe("W171 My Vehicle");
    expect(detail.body?.links?.[0]?.relationship).toBe("prospective_lp");
    // The pre-existing CONNECTIONS payload is untouched and still present.
    expect(detail.body?.connections).toBeTruthy();
    expect(Array.isArray(detail.body?.connections?.spvLpMemberships)).toBe(true);
  });

  it("A3: a duplicate link is refused with a plain sentence, not just a code", async () => {
    const contactId = await createContact(MANAGING_A, "Dup", "Twice", "dup.twice@w171.example");
    const first = await call("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
      userId: MANAGING_A,
      body: { target_kind: "spv", target_id: SPV_MINE },
    });
    expect(first.status).toBe(201);
    const second = await call("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
      userId: MANAGING_A,
      body: { target_kind: "spv", target_id: SPV_MINE },
    });
    expect(second.status).toBe(409);
    expect(second.body?.error).toBe("LINK_ALREADY_EXISTS");
    /* R77 — COPY BEFORE THE THROW. A refusal a person can read, not an enum. */
    expect(typeof second.body?.message).toBe("string");
    expect(second.body.message.length).toBeGreaterThan(60);
    expect(second.body.message).toContain("already linked");
  });

  it("A4: a link can be removed and then legitimately re-added", async () => {
    const contactId = await createContact(MANAGING_A, "Round", "Trip", "round.trip@w171.example");
    const made = await call("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
      userId: MANAGING_A,
      body: { target_kind: "spv", target_id: SPV_MINE },
    });
    const linkId = made.body.links[0].id;
    const gone = await call("DELETE", `/api/partner/me/crm/contacts/${contactId}/links/${linkId}`, {
      userId: MANAGING_A,
    });
    expect(gone.status).toBe(200);
    expect(gone.body.links.length).toBe(0);
    // The partial unique index is on LIVE rows only, so this must be accepted.
    const again = await call("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
      userId: MANAGING_A,
      body: { target_kind: "spv", target_id: SPV_MINE },
    });
    expect(again.status).toBe(201);
    // Removing an already-removed link is a readable 404, not a 500.
    const stale = await call("DELETE", `/api/partner/me/crm/contacts/${contactId}/links/${linkId}`, {
      userId: MANAGING_A,
    });
    expect(stale.status).toBe(404);
    expect(stale.body?.message).toContain("no longer there");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * GROUP B — THE FENCE. `spv.sponsor_partner_id`, asserted in BOTH directions.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("wave171 · B — the fence is spv.sponsor_partner_id and it holds both ways", () => {
  it("B1: linking to ANOTHER partner's SPV is refused as not-found, never 403", async () => {
    const contactId = await createContact(MANAGING_A, "Fence", "Test", "fence.test@w171.example");
    const res = await call("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
      userId: MANAGING_A,
      body: { target_kind: "spv", target_id: SPV_THEIRS },
    });
    /* 404 and NOT 403: a 403 would confirm that another partner's vehicle exists
       under that id, which is the disclosure the refusal is meant to prevent. */
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(res.body?.error).toBe("LINK_TARGET_NOT_FOUND");
    expect(res.body?.message).toContain("not one of");
    // ANTI-VACUITY: nothing was written.
    const rows = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM partner_crm_contact_links WHERE contact_id = ?`)
      .get(contactId) as { n: number };
    expect(rows.n).toBe(0);
  });

  it("B2: the OTHER partner is offered their own vehicle and not ours (reverse direction)", async () => {
    const res = await call("GET", "/api/partner/me/crm/link-targets", { userId: MANAGING_B });
    expect(res.status).toBe(200);
    const ids = (res.body?.spvs ?? []).map((s: any) => s.id);
    expect(ids).toContain(SPV_THEIRS);
    expect(ids).not.toContain(SPV_MINE);
  });

  it("B3: another partner cannot read or write links on a contact that is not theirs", async () => {
    const contactId = await createContact(MANAGING_A, "Mine", "Only", "mine.only@w171.example");
    await call("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
      userId: MANAGING_A,
      body: { target_kind: "spv", target_id: SPV_MINE },
    });
    const read = await call("GET", `/api/partner/me/crm/contacts/${contactId}/links`, { userId: MANAGING_B });
    expect(read.status).toBe(404);
    const write = await call("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
      userId: MANAGING_B,
      body: { target_kind: "spv", target_id: SPV_THEIRS },
    });
    expect(write.status).toBe(404);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * GROUP C — THE POINT OF THE WAVE. A LINK MOVES NO MONEY.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("wave171 · C — a link moves no capital figure, committed total, cap capacity or fee band", () => {
  it("C1: the vehicle's ENTIRE money footprint is byte-identical across link, second link and remove", async () => {
    const before = moneySnapshot(SPV_MINE);
    /* ANTI-VACUITY: the snapshot must actually contain money, or "unchanged" is
       a statement about nothing. */
    expect(before).toContain("5000000");
    expect(before).toContain("7500000");

    const c1 = await createContact(MANAGING_A, "Cap", "One", "cap.one@w171.example");
    const c2 = await createContact(MANAGING_A, "Cap", "Two", "cap.two@w171.example");

    const l1 = await call("POST", `/api/partner/me/crm/contacts/${c1}/links`, {
      userId: MANAGING_A,
      body: { target_kind: "spv", target_id: SPV_MINE, relationship: "prospective_lp" },
    });
    expect(l1.status).toBe(201);
    expect(moneySnapshot(SPV_MINE)).toBe(before);

    const l2 = await call("POST", `/api/partner/me/crm/contacts/${c2}/links`, {
      userId: MANAGING_A,
      body: { target_kind: "spv", target_id: SPV_MINE, relationship: "introducer" },
    });
    expect(l2.status).toBe(201);
    expect(moneySnapshot(SPV_MINE)).toBe(before);

    const del = await call("DELETE", `/api/partner/me/crm/contacts/${c1}/links/${l1.body.links[0].id}`, {
      userId: MANAGING_A,
    });
    expect(del.status).toBe(200);
    expect(moneySnapshot(SPV_MINE)).toBe(before);
  });

  it("C2: the link table has NO money column, so no figure can be read from it as capital", () => {
    const cols = (
      rawDb().prepare(`PRAGMA table_info('partner_crm_contact_links')`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols.length).toBeGreaterThan(0); // the table really is there
    for (const forbidden of ["amount_minor", "amount", "minor", "currency", "cap_minor", "fee_minor", "fee_bps"]) {
      expect(cols).not.toContain(forbidden);
    }
    /* Stronger than a name list: nothing money-shaped at all. */
    expect(cols.filter((c) => /minor|amount|currenc|fee|carry|nav|price/i.test(c))).toEqual([]);
  });

  it("C3: linking a contact creates NO commitment row and no LP membership appears", async () => {
    const contactId = await createContact(MANAGING_A, "NotAn", "Lp", "notan.lp@w171.example");
    let commitsBefore = 0;
    try {
      commitsBefore = (
        rawDb().prepare(`SELECT COUNT(*) AS n FROM spv_commitments WHERE spv_id = ?`).get(SPV_MINE) as {
          n: number;
        }
      ).n;
    } catch {
      commitsBefore = 0;
    }
    const res = await call("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
      userId: MANAGING_A,
      body: { target_kind: "spv", target_id: SPV_MINE, relationship: "prospective_lp" },
    });
    expect(res.status).toBe(201);
    let commitsAfter = 0;
    try {
      commitsAfter = (
        rawDb().prepare(`SELECT COUNT(*) AS n FROM spv_commitments WHERE spv_id = ?`).get(SPV_MINE) as {
          n: number;
        }
      ).n;
    } catch {
      commitsAfter = 0;
    }
    expect(commitsAfter).toBe(commitsBefore);

    /* The DERIVED connections payload — the one that DOES speak for capital — is
       still empty for this person. A link must not show up there. */
    const detail = await call("GET", `/api/partner/me/crm/contacts/${contactId}`, { userId: MANAGING_A });
    expect(detail.body.connections.spvLpMemberships).toEqual([]);
    expect(detail.body.connections.capTableHoldings).toEqual([]);
    // …while the link itself is present, in its own field.
    expect(detail.body.links.length).toBe(1);
  });

  it("C4: no relationship label is a commitment or invitation state", async () => {
    const contactId = await createContact(MANAGING_A, "Label", "Check", "label.check@w171.example");
    /* KEEPING THE THREE LADDERS DISTINCT. These are the words the commitment and
       subscription ladders use. None of them may be accepted as a relationship,
       or a reader could not tell a note from a position. */
    for (const forbidden of ["committed", "soft_circled", "invited", "accepted", "signed", "funded", "pending"]) {
      const res = await call("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
        userId: MANAGING_A,
        body: { target_kind: "spv", target_id: SPV_MINE, relationship: forbidden },
      });
      expect(res.status).toBe(400);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * GROUP D — WRITE GATING. Linking is a partner WRITE and is gated like one.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("wave171 · D — linking is gated exactly like every other CRM write", () => {
  it("D1: an unauthenticated caller cannot link", async () => {
    const contactId = await createContact(MANAGING_A, "No", "Auth", "no.auth@w171.example");
    const res = await call("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
      body: { target_kind: "spv", target_id: SPV_MINE },
    });
    expect(res.status).not.toBe(201);
    expect([401, 403, 404]).toContain(res.status);
  });

  it("D2: a malformed body is refused before anything is written", async () => {
    const contactId = await createContact(MANAGING_A, "Bad", "Body", "bad.body@w171.example");
    for (const body of [{}, { target_kind: "spv" }, { target_kind: "planet", target_id: SPV_MINE }, { target_kind: "spv", target_id: "" }]) {
      const res = await call("POST", `/api/partner/me/crm/contacts/${contactId}/links`, {
        userId: MANAGING_A,
        body,
      });
      expect(res.status).toBe(400);
    }
    const rows = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM partner_crm_contact_links WHERE contact_id = ?`)
      .get(contactId) as { n: number };
    expect(rows.n).toBe(0);
  });
});
