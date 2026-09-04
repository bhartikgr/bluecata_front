/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 306 · PART 1 — SETTLING AND WAIVING A FEE OBLIGATION NOW LEAVE A DURABLE,
 * CHAINED AUDIT ROW, PROVED FROM SQLITE AND NOWHERE ELSE.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE GAP, STATED PRECISELY. Both money decisions ALREADY EMITTED:
 *   · `spvEngineStore.chargeFeeObligation` emits `spv.fee_obligation_paid`
 *   · `spvEngineStore.waiveFeeObligation`  emits `spv.fee_obligation_waived`
 * Neither wrote an audit row. `function emit` (`spvEngineStore.ts:406`) wraps its
 * whole body in a bare `catch` at `:410`, so a failed publish produced no row, no
 * throw and no log line. An emit is a delivery-queue envelope: drained,
 * dead-letterable, pruned by `clearBridgeOutbox()`, and NOT read by
 * `/admin/audit-log`. AN EMIT IS NOT AN AUDIT ROW. This file never asserts one.
 *
 * NEVER PROVE A REPLICA. Every assertion here
 *   · drives the REAL express route table over HTTP with supertest, and
 *   · reads the STORED `audit_log` row back out of SQLite with `rawDb()`.
 * No assertion reads the audited value out of a response body or a log line, and
 * none calls `auditSpvFeeObligationWaived` / `auditSpvFeeObligationSettled`
 * directly. The store's own readers read RAM, not SQLite, so they are not used
 * as evidence either.
 *
 * ANTI-INERTNESS (the brief's ten mechanisms).
 *   · §0 proves mail is inert POSITIVELY rather than assuming it.
 *   · Every §ction asserts its PRECONDITIONS FIRST — the fixture reached the
 *     state the proof needs — so a broken fixture fails loudly instead of
 *     vacuously passing (mechanism 9: "a RED that proves nothing").
 *   · Money and identity values are compared against figures READ BACK from the
 *     `spv_fee_obligation` row, never against a literal typed into this file
 *     (mechanism 10: "a fixture that cannot distinguish the fix from the
 *     defect"). The one exception is the amount HANDED TO the route, which must
 *     be a literal because something has to originate it; it is then checked
 *     against the stored obligation row before the audit row is compared to it.
 *   · The A4 fingerprint asserts `before.length > 0` BEFORE concluding that
 *     nothing pre-existing changed (prove an absence against a live baseline).
 *
 * MAIL SAFETY (R241.0, R243.1). `server/lib/emailSender.ts` defaults `SMTP_MODE`
 * to `"smtp"` and `work/.env` holds live credentials. Run with
 * `SMTP_MODE=dry_run` ON THE COMMAND LINE — import-time seeding can send before
 * `beforeAll` runs. §0 asserts inertness rather than trusting it.
 * ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { rawDb, getDb } from "../db/connection";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_ID } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { verifyTransport } from "../lib/emailSender";
import { getConfig, patchConfig, sendMail } from "../emailTransport";
import { _resetRateLimitsForTests } from "../lib/rateLimit";
import {
  auditHashBody,
  AUDIT_HASH_VERSION_ACTOR_BOUND,
  verifyTenantAuditChain,
} from "../adminPlatformStore";
import crypto from "node:crypto";

const MANAGING = "u_avi_managing";
const ADMIN = "u_admin";

let app: express.Express;
let server: http.Server;

const post = (p: string, user: string, body?: unknown) =>
  request(app).post(p).set("x-user-id", user).send(body ?? {});
const put = (p: string, user: string, body?: unknown) =>
  request(app).put(p).set("x-user-id", user).send(body ?? {});

/* ── STORED-ROW READERS. Not the response body, not the store's RAM. ──────── */
type Row = Record<string, any>;

function obligationRows(spvId: string): Row[] {
  getDb();
  return rawDb()
    .prepare(
      `SELECT id, layer, portion, timing, amount_minor AS amountMinor, currency, state,
              payment_ref AS paymentRef, waived_by AS waivedBy, waived_reason AS waivedReason,
              curr_hash AS revisionHash, distribution_id AS distributionId
         FROM spv_fee_obligation WHERE spv_id = ? ORDER BY id`,
    )
    .all(spvId) as Row[];
}

function fundingFixedRow(spvId: string): Row | undefined {
  return obligationRows(spvId).find((r) => r.timing === "funding" && r.portion === "fixed");
}

/** THE audit rows, straight out of SQLite. */
function auditRows(action: string): Row[] {
  getDb();
  return rawDb()
    .prepare(
      `SELECT id, tenant_id AS tenantId, actor_id AS actorId, action, target,
              payload_json AS payloadJson, created_at AS createdAt,
              prev_hash AS prevHash, hash, hash_version AS hashVersion
         FROM audit_log WHERE action = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(action) as Row[];
}

function rowFor(action: string, spvId: string): Row | undefined {
  return auditRows(action).find((r) => String(r.target) === `spv:${spvId}`);
}

/** W278b A4 — every audit row in the table as an immutable fingerprint, so the
 *  ABSOLUTE rule (nothing pre-existing is ever rewritten or deleted) is provable
 *  by byte-identity plus growth only. */
function auditFingerprint(): string[] {
  getDb();
  return (
    rawDb()
      .prepare(
        `SELECT id, tenant_id AS t, actor_id AS a, action, target, payload_json AS p,
                created_at AS c, prev_hash AS ph, hash
           FROM audit_log ORDER BY id`,
      )
      .all() as Row[]
  ).map((r) => `${r.id}|${r.t}|${r.a}|${r.action}|${r.target}|${r.c}|${r.ph}|${r.hash}|${r.p}`);
}

/** The tenant chain, oldest first, as the verifier orders it. */
function tenantChain(tenantId: string): Row[] {
  getDb();
  return rawDb()
    .prepare(
      `SELECT id, actor_id AS actorId, action, target, payload_json AS payloadJson,
              created_at AS createdAt, prev_hash AS prevHash, hash,
              hash_version AS hashVersion
         FROM audit_log WHERE tenant_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(tenantId) as Row[];
}

/* ── FIXTURE BUILDERS. Real routes only, W276's proved sequence. ──────────── */
async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
    minCheckMinor: 10000,
    currency: "USD",
    ...extra,
  });
  expect(`createSpv -> ${r.status} ${JSON.stringify(r.body?.error ?? "")}`).toBe(
    `createSpv -> 201 ""`,
  );
  return String(r.body.spv.id);
}

async function addManagementFee(spvId: string, fixedAmountMinor: number): Promise<void> {
  const r = await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, {
    layer: "management",
    feeType: "fixed",
    fixedAmountMinor,
  });
  expect(`addFee -> ${r.status} ${JSON.stringify(r.body?.error ?? "")}`).toBe(`addFee -> 201 ""`);
}

async function subscribeVerifiedLp(spvId: string, investorId: string): Promise<string> {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, {
    investorId,
    commitmentMinor: 100000,
  });
  expect(sub.status).toBe(201);
  await put(`/api/partner/me/compliance/${investorId}`, MANAGING, {
    kycStatus: "verified",
    accreditationStatus: "self_certified",
  });
  return String(sub.body.subscription.id);
}

function gpConfirm(spvId: string, subId: string, docRef: string) {
  return post(`/api/partner/me/spv/${spvId}/subscriptions/${subId}/gp-confirm`, MANAGING, {
    documentsSigned: true,
    fundsReceived: true,
    subscriptionDocRef: docRef,
  });
}

/** Build a vehicle whose fixed funding obligation EXISTS and is blocking.
 *  Returns the spv id and the STORED obligation row. */
async function blockedVehicle(name: string, amountMinor: number, investorId: string) {
  const spvId = await createSpv(name);
  await addManagementFee(spvId, amountMinor);
  const subId = await subscribeVerifiedLp(spvId, investorId);
  const blocked = await gpConfirm(spvId, subId, `sig_${investorId}`);
  /* PRECONDITION, ASSERTED FIRST: the obligation exists and the gate fired. A
     proof against a vehicle with no bill proves nothing. */
  expect(`${blocked.status} ${blocked.body?.error}`).toBe("409 FEES_UNPAID");
  const ob = fundingFixedRow(spvId);
  expect(`obligation row present=${Boolean(ob)} state=${ob?.state}`).toBe(
    "obligation row present=true state=pending",
  );
  /* The bill carries the vehicle's own figure — so the audit comparison below
     is against a STORED number, not against the literal we posted. */
  expect(ob!.amountMinor).toBe(amountMinor);
  return { spvId, subId, ob: ob! };
}

beforeAll(async () => {
  patchConfig({ mode: "dry_run" });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  seedTestPartnerSandbox({ force: true });
  partnerTeamStore.add(TEST_PARTNER_ID, MANAGING, "managing_partner", "u_system_seed", {
    isSeed: true,
  });
});

beforeEach(() => {
  _resetRateLimitsForTests();
});

/* ═══════════════════════════════════════════════════════════════════════════
   §0 — NO MAIL LEAVES THIS RUN, PROVED POSITIVELY.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W306 §0 — mail is inert", () => {
  it("both transports report a non-smtp mode and a driven send returns a dry_ id", async () => {
    expect(process.env.SMTP_MODE).toBe("dry_run");
    expect(getConfig().mode).toBe("dry_run");
    expect((await verifyTransport()).mode).not.toBe("smtp");
    const out = await sendMail({
      to: "nobody@capavate.test",
      subject: "W306 inertness probe",
      html: "<p>probe</p>",
    });
    expect(String(out.messageId)).toMatch(/^dry_/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §1 — THE WAIVE. An administrator forgives money the vehicle owed, over HTTP,
   and a durable `spv.fee_obligation_waived` row is READ BACK OUT OF SQLITE.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W306 §1 — waiving over HTTP writes a durable spv.fee_obligation_waived row", () => {
  let spvId = "";
  let stored: Row;
  let auditRow: Row;
  let beforeFingerprint: string[] = [];
  const REASON = "sponsor credit agreed with the GP in writing";

  beforeAll(async () => {
    const v = await blockedVehicle("W306 S1 Waive Vehicle", 7000, "inv_w306_s1");
    spvId = v.spvId;

    /* THE LIVE BASELINE. Asserted non-empty BEFORE anything is concluded from
       comparing against it — an empty baseline makes every later "unchanged"
       claim vacuous. */
    beforeFingerprint = auditFingerprint();
    expect(beforeFingerprint.length > 0).toBe(true);

    /* THE DEFECT STATE, asserted so a disarm prints it. */
    expect(rowFor("spv.fee_obligation_waived", spvId)).toBeUndefined();

    const waive = await post(
      `/api/admin/consortium-spv/${spvId}/fee-obligations/${v.ob.id}/waive`,
      ADMIN,
      { reason: REASON },
    );
    expect(`${waive.status} ${waive.body?.error ?? ""}`).toBe("200 ");

    stored = fundingFixedRow(spvId)!;
    auditRow = rowFor("spv.fee_obligation_waived", spvId)!;
  });

  it("the row exists in audit_log, is the only one for this vehicle, and names the admin", () => {
    expect(
      `rows=${auditRows("spv.fee_obligation_waived").filter((r) => r.target === `spv:${spvId}`).length}`,
    ).toBe("rows=1");
    expect(auditRow.actorId).toBe(ADMIN);
    expect(auditRow.action).toBe("spv.fee_obligation_waived");
    expect(auditRow.target).toBe(`spv:${spvId}`);
    /* Stamped by the database write, not by this file. */
    expect(String(auditRow.createdAt).length > 0).toBe(true);
  });

  it("the payload describes the PERSISTED row — money as a string, never \"0\", never converted", () => {
    /* PRECONDITION: the store really moved the row. */
    expect(stored.state).toBe("waived");
    const p = JSON.parse(String(auditRow.payloadJson));

    /* Every money and identity value compared against the STORED obligation
       row, so this cannot pass by agreeing with a literal in this file. */
    expect(p.obligationId).toBe(stored.id);
    expect(p.state).toBe(stored.state);
    expect(p.layer).toBe(stored.layer);
    expect(p.portion).toBe(stored.portion);
    expect(p.timing).toBe(stored.timing);
    expect(p.currency).toBe(stored.currency);
    expect(p.waivedBy).toBe(stored.waivedBy);
    expect(p.waivedReason).toBe(stored.waivedReason);
    expect(p.revisionHash).toBe(stored.revisionHash);
    expect(p.auditWaveCompleted).toBe(306);

    /* R231 — money is a STRING of the stored minor amount, and is not "0". */
    expect(typeof p.amountMinor).toBe("string");
    expect(p.amountMinor).toBe(String(stored.amountMinor));
    expect(p.amountMinor).not.toBe("0");
    /* No conversion: the audited currency is the vehicle's own stored currency. */
    expect(p.currency).toBe("USD");
    /* The reason is verbatim and untruncated. */
    expect(p.waivedReason).toBe(REASON);
  });

  it("it JOINS the existing hash chain: prev_hash is the prior tip and its own hash recomputes", () => {
    const chain = tenantChain(String(auditRow.tenantId));
    expect(chain.length > 1).toBe(true);
    const idx = chain.findIndex((r) => r.id === auditRow.id);
    expect(idx > 0).toBe(true);
    /* LINKED: its prev_hash is literally the hash of the row before it. */
    expect(auditRow.prevHash).toBe(chain[idx - 1].hash);
    /* AND the link is not merely copied — the hash recomputes from the row's own
       bytes with the platform's own hash body, at the actor-bound version. */
    expect(Number(auditRow.hashVersion)).toBe(AUDIT_HASH_VERSION_ACTOR_BOUND);
    const recomputed = crypto
      .createHash("sha256")
      .update(
        auditHashBody({
          version: Number(auditRow.hashVersion),
          prevHash: String(auditRow.prevHash),
          id: String(auditRow.id),
          eventType: String(auditRow.action),
          entity: String(auditRow.target),
          ts: String(auditRow.createdAt),
          payloadStr: String(auditRow.payloadJson),
          actorId: String(auditRow.actorId),
        }),
      )
      .digest("hex");
    expect(recomputed).toBe(auditRow.hash);
    /* And the platform's OWN verifier agrees the whole tenant chain is intact. */
    const v = verifyTenantAuditChain(rawDb(), String(auditRow.tenantId));
    expect(`ok=${v.ok} brokenAt=${v.brokenAt}`).toBe("ok=true brokenAt=-1");
  });

  it("W278b A4 — nothing pre-existing was rewritten or deleted: byte-identity plus growth only", () => {
    const after = auditFingerprint();
    expect(beforeFingerprint.length > 0).toBe(true);
    expect(after.length > beforeFingerprint.length).toBe(true);
    /* Byte-identical prefix: the same rows, in the same order, unchanged. */
    expect(after.slice(0, beforeFingerprint.length)).toEqual(beforeFingerprint);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §2 — THE SETTLE. Admin settlement over HTTP, audited from the persisted row.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W306 §2 — settling over HTTP writes a durable spv.fee_obligation_paid row", () => {
  let spvId = "";
  let stored: Row;
  let auditRow: Row;
  let beforeFingerprint: string[] = [];
  const SETTLE_REASON = "wire received off-platform, reconciled by treasury";

  beforeAll(async () => {
    const v = await blockedVehicle("W306 S2 Settle Vehicle", 12345, "inv_w306_s2");
    spvId = v.spvId;

    beforeFingerprint = auditFingerprint();
    expect(beforeFingerprint.length > 0).toBe(true);
    expect(rowFor("spv.fee_obligation_paid", spvId)).toBeUndefined();

    const settle = await post(
      `/api/admin/consortium-spv/${spvId}/fee-obligations/${v.ob.id}/settle`,
      ADMIN,
      { outcome: "succeeded", reason: SETTLE_REASON },
    );
    expect(`${settle.status} ${settle.body?.error ?? ""}`).toBe("200 ");

    stored = fundingFixedRow(spvId)!;
    /* A NAMED COUNT, not a dereference. Without this the disarm's RED is a
       TypeError on `undefined.action` — a RED that proves the harness crashed,
       not that the row is missing. This states the fact directly. */
    expect(
      `paid_audit_rows=${auditRows("spv.fee_obligation_paid").filter((r) => r.target === `spv:${spvId}`).length}`,
    ).toBe("paid_audit_rows=1");
    auditRow = rowFor("spv.fee_obligation_paid", spvId)!;
  });

  it("the row exists and describes the persisted settled obligation", () => {
    /* PRECONDITION: the store really settled it. */
    expect(stored.state).toBe("paid");
    expect(`audit_row_present=${auditRow !== undefined}`).toBe("audit_row_present=true");
    expect(auditRow.action).toBe("spv.fee_obligation_paid");
    expect(auditRow.target).toBe(`spv:${spvId}`);

    const p = JSON.parse(String(auditRow.payloadJson));
    expect(p.obligationId).toBe(stored.id);
    expect(p.state).toBe(stored.state);
    expect(p.currency).toBe(stored.currency);
    expect(p.paymentRef).toBe(stored.paymentRef);
    expect(p.auditWaveCompleted).toBe(306);
    /* R231 — string money, off the stored row, never "0". */
    expect(typeof p.amountMinor).toBe("string");
    expect(p.amountMinor).toBe(String(stored.amountMinor));
    expect(p.amountMinor).not.toBe("0");
    /* The settlement authorization's provenance, from the durable row. */
    expect(p.authorizationSource === null || typeof p.authorizationSource === "string").toBe(true);
    expect(p.authorizationReason).toBe(SETTLE_REASON);
  });

  it("the settled amount was NOT re-priced: the audit, the obligation and the fee row agree", () => {
    getDb();
    const fee = rawDb()
      .prepare(
        `SELECT fixed_amount_minor AS fixedAmountMinor, currency FROM spv_fee
           WHERE spv_id = ? AND layer = 'management' ORDER BY effective_date DESC LIMIT 1`,
      )
      .get(spvId) as Row;
    const p = JSON.parse(String(auditRow.payloadJson));
    expect(stored.amountMinor).toBe(fee.fixedAmountMinor);
    expect(p.amountMinor).toBe(String(fee.fixedAmountMinor));
    expect(p.currency).toBe(fee.currency);
  });

  it("it joins the chain and rewrites nothing", () => {
    const chain = tenantChain(String(auditRow.tenantId));
    const idx = chain.findIndex((r) => r.id === auditRow.id);
    expect(idx > 0).toBe(true);
    expect(auditRow.prevHash).toBe(chain[idx - 1].hash);
    const v = verifyTenantAuditChain(rawDb(), String(auditRow.tenantId));
    expect(`ok=${v.ok}`).toBe("ok=true");

    const after = auditFingerprint();
    expect(after.length > beforeFingerprint.length).toBe(true);
    expect(after.slice(0, beforeFingerprint.length)).toEqual(beforeFingerprint);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §3 — THE AUDIT WRITE DID NOT CHANGE WHAT THE PRODUCT DOES. A waived or
   settled obligation still unblocks the commitment, and the gate is not weakened
   for an obligation that is still standing.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W306 §3 — the money paths still behave exactly as before", () => {
  it("after a waive the commitment lands, and the stored subscription says so", async () => {
    const v = await blockedVehicle("W306 S3 Waive Then Commit", 4500, "inv_w306_s3a");
    const w = await post(
      `/api/admin/consortium-spv/${v.spvId}/fee-obligations/${v.ob.id}/waive`,
      ADMIN,
      { reason: "waived under the sponsor arrangement" },
    );
    expect(w.status).toBe(200);
    const ok = await gpConfirm(v.spvId, v.subId, "sig_w306_s3a2");
    getDb();
    const sub = rawDb()
      .prepare("SELECT status FROM spv_subscription WHERE id = ?")
      .get(v.subId) as Row;
    expect(`${ok.status} status=${sub?.status}`).toBe("200 status=committed");
  });

  it("an UNSETTLED obligation still refuses the commitment — the gate was not touched", async () => {
    const v = await blockedVehicle("W306 S3 Still Blocked", 6000, "inv_w306_s3b");
    const again = await gpConfirm(v.spvId, v.subId, "sig_w306_s3b2");
    expect(`${again.status} ${again.body?.error}`).toBe("409 FEES_UNPAID");
    /* And no settled/waived audit row was written for a vehicle where neither
       happened — the writers are on the decisions, not on the reads. */
    expect(rowFor("spv.fee_obligation_waived", v.spvId)).toBeUndefined();
    expect(rowFor("spv.fee_obligation_paid", v.spvId)).toBeUndefined();
  });

  it("the partner charge route still answers 503 — the payment gateway is NOT wired", async () => {
    const v = await blockedVehicle("W306 S3 Gateway Frozen", 5000, "inv_w306_s3c");
    const charge = await post(
      `/api/partner/me/spv/${v.spvId}/fee-obligations/${v.ob.id}/charge`,
      MANAGING,
      {},
    );
    expect(`${charge.status} ${charge.body?.error}`).toBe("503 PAYMENT_GATEWAY_UNAVAILABLE");
  });
});
