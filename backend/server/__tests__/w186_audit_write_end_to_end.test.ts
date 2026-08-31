/* ══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 186 · ITEM C · R159.1 — PROVE IT END TO END, NOT AT THE STORE
 * ══════════════════════════════════════════════════════════════════════════ *
 *
 *  R137 is the standing lesson on this platform: a fix passed every test and
 *  never reached the user. So nothing here calls a store directly. Every proof
 *  drives the REAL HTTP route the product uses, then reads the row back through
 *  the REAL endpoint the admin audit screen fetches
 *  (`GET /api/admin/audit-log`) — because "written but invisible" is the exact
 *  failure mode that fooled the owner for three months.
 *
 *  §1  every audited action produces a row, through the route
 *  §2  every row is visible through the READ endpoint the screen uses
 *  §3  the two writers wave 181 deferred (LP commit, LP invite)
 *  §4  NEGATIVE CONTROL — when the audit write is made to fail, the failure
 *      SURFACES instead of vanishing
 *  §5  the health signal itself
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import http from "node:http";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_ID } from "../partnerWorkspaceStore";
import { storeCredential } from "../userCredentialsStore";
import {
  getAuditWriteHealth,
  _resetAuditWriteHealthForTest,
  AUDIT_WRITE_STALE_AFTER_HOURS,
} from "../adminPlatformStore";
/* WAVE 214 — this route now requires the third-party authority confirmation
   (typed name + the verbatim statement, hashed server-side). These fixtures are
   updated to supply it because the ROUTE CONTRACT changed, not because the gate
   was weakened for tests: the gate itself is proved over HTTP in
   `server/__tests__/w214_third_party_authority_http.test.ts`. */
import {
  WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT as W214_STMT,
} from "../../shared/wave214ThirdPartyAuthorityCopy";
const W214_AUTH = { authorityTypedName: "Test Managing Partner", authorityStatementShown: W214_STMT };
/* WAVE 226 · R202 — wave 211 made an operator attestation MANDATORY on the LP
   invitation and LP commitment routes. `driveOwnerSequence()` drives both, so
   without the attestation both were refused 400, no audit row was written, and
   the two §3 proofs — `spv.lp_committed names a REAL actor` and `spv.lp_invited
   names a REAL actor` — found no row and failed on `toBeTruthy()`. They were
   MASKED: the assertions about WHO acted and WHAT amount crossed never ran.

   Same reasoning as the WAVE 214 note above, and the same shape: the ROUTE
   CONTRACT changed, so the fixture supplies what a real operator supplies. This
   is not a bypass — no flag, no direct store write, nothing narrowed. The gate
   itself is proved over HTTP in
   `server/__tests__/wave211_money_event_gate_http.test.ts`.

   Per `SLOTS` in `server/wave211MoneyEventAttestationStore.ts`: an INVITATION
   stores neither a basis nor a currency confirmation; a COMMITMENT stores the
   currency confirmation but no basis. Ticks are the boolean `true` — never `1`,
   never "true" — because wave 211 refuses a truthy-but-not-true tick on purpose. */
import {
  W211_BODY_KEY_VERSION,
  W211_BODY_KEY_SIGNED_NAME,
  W211_BODY_KEY_TICK_1,
  W211_BODY_KEY_TICK_2,
  W211_BODY_KEY_TICK_3,
  W211_BODY_KEY_CURRENCY_CONFIRMED,
  W211_LP_INVITE_ATTESTATION_VERSION,
  W211_LP_COMMIT_ATTESTATION_VERSION,
} from "../../shared/wave211MoneyEventAttestation";

const W226_TICKS = {
  [W211_BODY_KEY_SIGNED_NAME]: "Ada Managing Partner",
  [W211_BODY_KEY_TICK_1]: true,
  [W211_BODY_KEY_TICK_2]: true,
  [W211_BODY_KEY_TICK_3]: true,
} as const;
const W226_INVITE_ATT = {
  [W211_BODY_KEY_VERSION]: W211_LP_INVITE_ATTESTATION_VERSION,
  ...W226_TICKS,
} as const;
const W226_COMMIT_ATT = {
  [W211_BODY_KEY_VERSION]: W211_LP_COMMIT_ATTESTATION_VERSION,
  ...W226_TICKS,
  [W211_BODY_KEY_CURRENCY_CONFIRMED]: true,
} as const;

const MANAGING = "u_avi_managing";
const ADMIN = { "x-user-id": "u_admin" };

let app: express.Express;
let server: http.Server;

/** Rows straight out of the table — used only to assert PRESENCE and shape.
 *  Visibility is always proved separately through the read endpoint (§2). */
function auditRows(action: string): Array<Record<string, any>> {
  return rawDb()
    .prepare(`SELECT id, tenant_id AS tenantId, actor_id AS actorId, action, target, payload_json AS payloadJson, created_at AS createdAt FROM audit_log WHERE action = ? ORDER BY created_at DESC, id DESC`)
    .all(action) as Array<Record<string, any>>;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  seedTestPartnerSandbox({ force: true });
  partnerTeamStore.add(TEST_PARTNER_ID, MANAGING, "managing_partner", "u_system_seed", { isSeed: true });
  storeCredential({
    userId: MANAGING,
    email: "w186.managing@test-partner.example",
    name: "Ada Managing Partner",
    password: "test-password-w186",
  });
}, 180_000);

afterAll(() => {
  try { server.close(); } catch { /* nothing to close */ }
});

/** The whole owner-reported sequence, driven once through real HTTP. */
async function driveOwnerSequence() {
  const co = await request(app).post("/api/partner/me/portfolio-companies").set("x-user-id", MANAGING).send({
    companyName: "W186 Kestrel Holdings",
    founderEmail: "w186.founder@example.com",
    founderName: "Fred Founder",
    ...W214_AUTH,
  });
  const contact = await request(app).post("/api/partner/me/crm/contacts").set("x-user-id", MANAGING).send({
    first_name: "Lena",
    last_name: "Ledger",
    email: "w186.contact@example.com",
    org: "Ledger Capital",
  });
  const spv = await request(app).post("/api/partner/me/spvs").set("x-user-id", MANAGING).send({
    spvName: "W186 Proof SPV",
    jurisdiction: "Delaware",
    vintage: 2026,
    currency: "USD",
    status: "open",
    targetSizeMinor: 100000000,
    signoffLegalName: "Ada Managing Partner",
    signoffAccepted: true,
  });
  const spvId = String(spv.body?.spv?.id ?? "");
  const invite = await request(app).post(`/api/partner/me/spv/${spvId}/lp-invites`).set("x-user-id", MANAGING).send({
    email: "w186.invitee@example.com",
    firstName: "Ivo",
    lastName: "Invitee",
    ...W226_INVITE_ATT, /* WAVE 226 · R202 — see the note at the imports */
  });
  const commit = await request(app).post(`/api/partner/me/spv/${spvId}/lp-commit`).set("x-user-id", MANAGING).send({
    investorEmail: "w186.lp@example.com",
    holderFirstName: "Lena",
    holderLastName: "Pea",
    amount: "250000.00",
    shares: "2500",
    currency: "USD",
    ...W226_COMMIT_ATT, /* WAVE 226 · R202 — see the note at the imports */
  });
  const investorId = String(commit.body?.subscription?.investorId ?? "");
  const confirm = await request(app)
    .post(`/api/partner/me/spv/${spvId}/subscriptions/${investorId}/confirm-funds`)
    .set("x-user-id", MANAGING)
    .send({ receivedMinor: 25000000, reference: "W186REF" });
  const close = await request(app).post(`/api/partner/me/spv/${spvId}/close`).set("x-user-id", MANAGING).send({ closeDate: "2026-08-28" });
  const reopen = await request(app).post(`/api/partner/me/spv/${spvId}/reopen`).set("x-user-id", MANAGING).send({ rollingCloseWindowDays: 30 });
  return { co, contact, spv, spvId, invite, commit, investorId, confirm, close, reopen };
}

describe("W186 §1 — every audited action writes a row, driven through the real HTTP route", () => {
  let seq: Awaited<ReturnType<typeof driveOwnerSequence>>;

  beforeAll(async () => {
    _resetAuditWriteHealthForTest();
    seq = await driveOwnerSequence();
  }, 180_000);

  it("the routes themselves all succeeded (a proof against a refused route proves nothing)", () => {
    expect(seq.co.status).toBe(201);
    expect(seq.contact.status).toBe(201);
    expect(seq.spv.status).toBe(201);
    expect(seq.spvId).toMatch(/^spv_/);
    expect(seq.invite.status).toBe(201);
    expect(seq.commit.status).toBe(201);
    expect(seq.confirm.status).toBe(201);
    expect(seq.close.status).toBe(200);
    expect(seq.reopen.status).toBe(200);
  });

  it("company.created — WAVE 186: the route that mints co_<hex> had NO audit call at all", () => {
    const rows = auditRows("company.created");
    const row = rows.find((r) => String(r.target) === `company:${seq.co.body.companyId}`);
    expect(row, "no company.created row for the company the route just created").toBeTruthy();
    expect(row!.actorId).toBe(MANAGING);
    expect(String(row!.createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const payload = JSON.parse(String(row!.payloadJson));
    expect(payload.companyName).toBe("W186 Kestrel Holdings");
    expect(payload.createdByPartnerId).toBe(TEST_PARTNER_ID);
  });

  it("partner_crm_contact.created — WAVE 186: the partner CRM had NO audit call at all", () => {
    const rows = auditRows("partner_crm_contact.created");
    const row = rows.find((r) => String(r.target) === `partner_crm_contact:${seq.contact.body.contact.id}`);
    expect(row, "no partner_crm_contact.created row for the contact the route just created").toBeTruthy();
    expect(row!.actorId).toBe(MANAGING);
    const payload = JSON.parse(String(row!.payloadJson));
    expect(payload.email).toBe("w186.contact@example.com");
  });

  it("wave 181's four SPV lifecycle writers actually fire through the routes", () => {
    for (const action of ["spv.created", "spv.lp_funds_confirmed", "spv.closed_to_new_lps", "spv.reopened_rolling_close"]) {
      const row = auditRows(action).find((r) => String(r.target) === `spv:${seq.spvId}`);
      expect(row, `no ${action} row for spv:${seq.spvId}`).toBeTruthy();
      expect(row!.actorId).toBe(MANAGING);
      const payload = JSON.parse(String(row!.payloadJson));
      expect(payload.actorResolved).toBe(true);
      expect(payload.auditWriter).toBe("spvLifecycleAudit");
    }
  });
});

describe("W186 §2 — the row is VISIBLE through the read endpoint the admin screen uses", () => {
  let seq: Awaited<ReturnType<typeof driveOwnerSequence>>;

  beforeAll(async () => {
    seq = await driveOwnerSequence();
  }, 180_000);

  it("GET /api/admin/audit-log returns the newly written rows, newest first, without a fallback", async () => {
    const resp = await request(app).get("/api/admin/audit-log?limit=200").set(ADMIN);
    expect(resp.status).toBe(200);
    /* `fallback: true` means the endpoint served the in-memory mirror instead of
       the table. A proof that passes on the mirror proves nothing about the
       durable ledger. */
    expect(resp.body.fallback).not.toBe(true);
    expect(resp.body.order).toBe("desc");
    const actions = (resp.body.items as Array<{ eventType: string }>).map((i) => i.eventType);
    for (const action of [
      "company.created",
      "partner_crm_contact.created",
      "spv.created",
      "spv.lp_invited",
      "spv.lp_committed",
      "spv.lp_funds_confirmed",
      "spv.closed_to_new_lps",
      "spv.reopened_rolling_close",
    ]) {
      expect(actions, `${action} is in the table but NOT visible through the read endpoint`).toContain(action);
    }
  });

  it("the LP commitment is visible with the acting partner user and the exact minor amount as a string", async () => {
    const resp = await request(app).get("/api/admin/audit-log?limit=200&eventType=spv.lp_committed").set(ADMIN);
    expect(resp.status).toBe(200);
    const item = (resp.body.items as Array<any>).find((i) => i.entity === `spv:${seq.spvId}`);
    expect(item, "the commitment row is not reachable through the read endpoint").toBeTruthy();
    expect(item.actor).toBe(MANAGING);
    expect(item.payload.amountMinor).toBe("25000000");
    expect(typeof item.payload.amountMinor).toBe("string");
  });
});

describe("W186 §3 — the two writers wave 181 deferred (W181_BUILD.md §5.1)", () => {
  let seq: Awaited<ReturnType<typeof driveOwnerSequence>>;

  beforeAll(async () => {
    seq = await driveOwnerSequence();
  }, 180_000);

  it("spv.lp_committed names a REAL actor, not the u_unresolved sentinel", () => {
    const matching = auditRows("spv.lp_committed").filter((r) => String(r.target) === `spv:${seq.spvId}`);
    /* WAVE 226 — EXACTLY ONE. A count assertion, not a `find`, so this proof fails
       on an empty set AND on a duplicate. One attested money event must produce
       one audit row: two rows would double-count the money seat of the ledger. */
    expect(matching.length, "expected exactly one spv.lp_committed row for this SPV").toBe(1);
    const row = matching[0];
    expect(row, "no spv.lp_committed row — this is the money seat of the ledger").toBeTruthy();
    expect(row!.actorId).toBe(MANAGING);
    expect(row!.actorId).not.toBe("u_unresolved");
    const payload = JSON.parse(String(row!.payloadJson));
    expect(payload.actorResolved).toBe(true);
    expect(payload.auditWaveCompleted).toBe(186);
    /* Money crosses as a STRING and is never re-derived. */
    expect(payload.amountMinor).toBe("25000000");
    expect(payload.currency).toBe("USD");
    expect(payload.investorEmail).toBe("w186.lp@example.com");
  });

  it("spv.lp_invited names a REAL actor and the invited email", () => {
    const matching = auditRows("spv.lp_invited").filter((r) => String(r.target) === `spv:${seq.spvId}`);
    /* WAVE 226 — EXACTLY ONE, for the same reason as the lp_committed proof above. */
    expect(matching.length, "expected exactly one spv.lp_invited row for this SPV").toBe(1);
    const row = matching[0];
    expect(row, "no spv.lp_invited row").toBeTruthy();
    expect(row!.actorId).toBe(MANAGING);
    const payload = JSON.parse(String(row!.payloadJson));
    expect(payload.actorResolved).toBe(true);
    expect(payload.investorEmail).toBe("w186.invitee@example.com");
    expect(payload.auditWaveCompleted).toBe(186);
  });
});

describe("W186 §4 — NEGATIVE CONTROL: a failed audit write must SURFACE, not vanish", () => {
  it("with audit_log unwritable, the action still completes AND the failure is reported by the health signal", async () => {
    _resetAuditWriteHealthForTest();
    const before = getAuditWriteHealth();
    expect(before.writeFailuresSinceBoot).toBe(0);
    expect(before.status).not.toBe("failing");

    /* THE REAL FAILURE, NOT A MOCK. Renaming the table reproduces the class of
       failure wave 186 reproduced against the live configuration (a database
       the server process cannot write): the INSERT throws inside `appendAudit`,
       whose catch returns the empty-hash sentinel and never throws. */
    rawDb().exec(`ALTER TABLE audit_log RENAME TO audit_log_w186_disabled`);
    let created: any;
    try {
      created = await request(app).post("/api/partner/me/crm/contacts").set("x-user-id", MANAGING).send({
        first_name: "Nadia",
        last_name: "Negative",
        email: "w186.negative@example.com",
        org: "Control Group",
      });
    } finally {
      rawDb().exec(`ALTER TABLE audit_log_w186_disabled RENAME TO audit_log`);
    }

    /* The action is NOT refused — that is the deliberate decision recorded in
       W186_BUILD.md §3, and this assertion pins it so a future wave cannot
       change a GP-visible behaviour by accident. */
    expect(created.status).toBe(201);

    const after = getAuditWriteHealth();
    expect(after.writeFailuresSinceBoot).toBeGreaterThan(0);
    expect(after.status).toBe("failing");
    expect(after.ok).toBe(false);
    expect(after.lastWriteFailure).toBeTruthy();
    expect(String(after.lastWriteFailure!.message).length).toBeGreaterThan(0);

    /* And it surfaces on the endpoint the admin screen reads — not only in a
       process log line nobody tails. THAT is the three-month defect. */
    const resp = await request(app).get("/api/admin/audit-write-health").set(ADMIN);
    expect(resp.status).toBe(200);
    expect(resp.body.health.status).toBe("failing");
    expect(resp.body.health.ok).toBe(false);
    expect(resp.body.health.writeFailuresSinceBoot).toBeGreaterThan(0);

    /* No row was written for the contact that was created. NOT BACKFILLED. */
    const rows = auditRows("partner_crm_contact.created");
    expect(rows.some((r) => String(r.payloadJson).includes("w186.negative@example.com"))).toBe(false);
  }, 120_000);
});

describe("W186 §5 — the health signal itself", () => {
  it("reports the newest row's age, and calls a long-silent ledger STALE rather than healthy", async () => {
    _resetAuditWriteHealthForTest();
    await request(app).post("/api/partner/me/crm/contacts").set("x-user-id", MANAGING).send({
      first_name: "Hana",
      last_name: "Health",
      email: "w186.health@example.com",
    });
    const fresh = getAuditWriteHealth();
    expect(fresh.status).toBe("healthy");
    expect(fresh.ok).toBe(true);
    expect(fresh.newestRowAt).toBeTruthy();
    expect(fresh.newestRowAgeSeconds).not.toBeNull();
    expect(fresh.newestRowAgeSeconds!).toBeLessThan(AUDIT_WRITE_STALE_AFTER_HOURS * 3600);
    expect(fresh.writesOkSinceBoot).toBeGreaterThan(0);

    /* THE LIVE SHAPE. Ask the same question from a point in time far after the
       newest row — exactly the position an admin was in all summer — and the
       answer must be STALE, not "healthy". Nothing on the platform used to say
       this, which is the whole reason the outage lasted three months. */
    const newest = Date.parse(String(fresh.newestRowAt));
    const muchLater = new Date(newest + (AUDIT_WRITE_STALE_AFTER_HOURS + 24) * 3600 * 1000);
    const stale = getAuditWriteHealth(muchLater);
    expect(stale.status).toBe("stale");
    expect(stale.ok).toBe(false);
    expect(stale.newestRowAgeSeconds!).toBeGreaterThan(AUDIT_WRITE_STALE_AFTER_HOURS * 3600);
  }, 120_000);

  it("never appends: asking whether auditing works does not itself write to the ledger", async () => {
    const before = (rawDb().prepare(`SELECT COUNT(*) AS n FROM audit_log`).get() as { n: number }).n;
    await request(app).get("/api/admin/audit-write-health").set(ADMIN);
    await request(app).get("/api/admin/audit-write-health").set(ADMIN);
    const after = (rawDb().prepare(`SELECT COUNT(*) AS n FROM audit_log`).get() as { n: number }).n;
    expect(after).toBe(before);
  }, 60_000);
});
