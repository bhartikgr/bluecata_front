/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 276 — A FIXED OR HYBRID MANAGEMENT FEE PERMANENTLY BLOCKED EVERY
 * COMMITMENT, AND THE BILL THAT BLOCKED IT DID NOT EXIST.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG.
 *   `advanceSubscription` accrued the fixed portion of a fixed/hybrid fee at ONE
 *   place only — `to === "wire_funded"`. The subscription ladder permits a
 *   RECORDED forward skip (R136.2), and `gp-confirm`
 *   (`spvEngineRoutes.ts:1577`) advances straight to `committed`. So on that
 *   path the fee gate immediately below read a bill nothing had written:
 *   `hasUnsettledFixedFees` is fail-closed on the fee CONFIG, so it answered
 *   `true` forever, `FEES_UNPAID` refused every commitment, and
 *   `GET …/fee-obligations` returned an EMPTY list — a blocking obligation
 *   rendered as nothing (R224.1). Nothing could be paid, waived or seen.
 *
 * WHAT THE FIX IS. One statement: accrue, THEN check — the identical two-line
 *   shape already present at `createDeployment` and `advanceDeployment`.
 *
 * WHAT THE FIX IS NOT, AND THESE TESTS PIN ALL THREE.
 *   · It does not wire the payment gateway. §8 asserts the charge route still
 *     answers 503 `PAYMENT_GATEWAY_UNAVAILABLE`.
 *   · It does not weaken the `FEES_UNPAID` gate. §1/§2 assert the commitment is
 *     STILL refused while the obligation is unsettled — the change is that the
 *     obligation now EXISTS, with its real figure, and can be discharged. §6
 *     then drives the discharge and the commitment through.
 *   · It does not remove or narrow a fee option. §7 asserts all three fee types
 *     are still accepted.
 *
 * EVIDENCE STANDARD (handbook §8 — never prove a replica).
 *   Every assertion drives the REAL routes through `registerRoutes` over HTTP
 *   with supertest, and every money claim is read back from the STORED ROW in
 *   `spv_fee_obligation` / `spv_subscription` with `rawDb()`. A route can say
 *   "accrued" and write nothing.
 *
 * MAIL SAFETY (R241.0, R243.1). `server/lib/emailSender.ts` defaults
 *   `SMTP_MODE` to `"smtp"` with no test guard and `work/.env` holds live Gmail
 *   credentials. Run this file with `SMTP_MODE=dry_run` on the command line —
 *   import-time seeding can send before `beforeAll` runs. §0 asserts inertness
 *   positively rather than assuming it.
 * ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { registerRoutes } from "../routes";
import { rawDb, getDb } from "../db/connection";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_ID } from "../partnerWorkspaceStore";
import { storeCredential } from "../userCredentialsStore";
import { spvEngineStore } from "../spvEngineStore";
import { recordFeeHydration } from "../lib/spvFeeHydrationState";
import { verifyTransport } from "../lib/emailSender";
import { getConfig, patchConfig, sendMail } from "../emailTransport";
import { SPV_FEE_TYPES } from "@shared/spvEngine";
import { _resetRateLimitsForTests } from "../lib/rateLimit";

const MANAGING = "u_avi_managing";
const ADMIN = "u_admin";

let app: express.Express;
let server: http.Server;

function post(p: string, user: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", user).send(body ?? {});
}
function put(p: string, user: string, body?: unknown) {
  return request(app).put(p).set("x-user-id", user).send(body ?? {});
}
function patch(p: string, user: string, body?: unknown) {
  return request(app).patch(p).set("x-user-id", user).send(body ?? {});
}
function get(p: string, user: string) {
  return request(app).get(p).set("x-user-id", user);
}

/* ── STORED-ROW READERS. Not the response body. ───────────────────────────── */
type Row = Record<string, unknown>;

function obligationRows(spvId: string): Row[] {
  getDb();
  return rawDb()
    .prepare(
      `SELECT id, layer, portion, timing, amount_minor, currency, state
         FROM spv_fee_obligation WHERE spv_id = ? ORDER BY id`,
    )
    .all(spvId) as Row[];
}

function fundingFixedRows(spvId: string): Row[] {
  return obligationRows(spvId).filter((r) => r.timing === "funding" && r.portion === "fixed");
}

function subStatusRow(subId: string): string {
  getDb();
  const r = rawDb()
    .prepare("SELECT status FROM spv_subscription WHERE id = ?")
    .get(subId) as { status?: string } | undefined;
  return String(r?.status ?? "__NO_ROW__");
}

function feeRow(spvId: string, layer: string): Row | undefined {
  getDb();
  return rawDb()
    .prepare(
      `SELECT fee_type, fixed_amount_minor, carry_pct, currency FROM spv_fee
         WHERE spv_id = ? AND layer = ? ORDER BY effective_date DESC LIMIT 1`,
    )
    .get(spvId, layer) as Row | undefined;
}

/* ── FIXTURE BUILDERS. Real routes only; no store shortcuts. ──────────────── */
async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
    minCheckMinor: 10000,
    ...extra,
  });
  expect(r.status).toBe(201);
  return String(r.body.spv.id);
}

/** A management fee, set through the real partner fees route. NO amount is
 *  hardcoded in the assertions: every expected figure is read back from the fee
 *  row the route wrote, so this file cannot pass by agreeing with itself. */
async function addManagementFee(
  spvId: string,
  feeType: "fixed" | "hybrid" | "carry",
  fixedAmountMinor: number | null,
  carryPct: number | null,
): Promise<void> {
  const body: Record<string, unknown> = { layer: "management", feeType };
  if (fixedAmountMinor !== null) body.fixedAmountMinor = fixedAmountMinor;
  if (carryPct !== null) body.carryPct = carryPct;
  const r = await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, body);
  expect(`addFee ${feeType} -> ${r.status} ${JSON.stringify(r.body?.error ?? "")}`).toBe(
    `addFee ${feeType} -> 201 ""`,
  );
}

/** Subscribe an LP and clear KYC + accreditation, so the ONLY remaining commit
 *  blocker is the fixed-fee obligation. Leaves the row at `review`. */
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

/** The real GP-confirm route: the dual affirmation plus the advance to
 *  `committed`, SKIPPING `wire_funded`. This is the defect path. */
function gpConfirm(spvId: string, subId: string, docRef: string) {
  return post(`/api/partner/me/spv/${spvId}/subscriptions/${subId}/gp-confirm`, MANAGING, {
    documentsSigned: true,
    fundsReceived: true,
    subscriptionDocRef: docRef,
  });
}

beforeAll(async () => {
  /* Inertness established BEFORE any route is registered. */
  patchConfig({ mode: "dry_run" });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  seedTestPartnerSandbox({ force: true });
  partnerTeamStore.add(TEST_PARTNER_ID, MANAGING, "managing_partner", "u_system_seed", {
    isSeed: true,
  });
  storeCredential({
    userId: MANAGING,
    email: "w276.managing@test-partner.example",
    name: "Avi Managing Partner",
    password: "test-password-w276",
  });
});

/* The production per-route write limiter is 10/min and every `POST
 * /api/partner/me/spv` in this file shares one bucket, so a fixture-heavy file
 * 429s on its own setup. Reset the REAL limiter's durable store between tests
 * with the store's own test helper — the limiter itself is untouched. */
beforeEach(() => {
  _resetRateLimitsForTests();
});

/* Any test that poisons the fee-hydration verdict must not leak it. */
afterEach(() => {
  recordFeeHydration("ok", 1, null);
});

/* ═══════════════════════════════════════════════════════════════════════════
   §0 — NO MAIL LEAVES THIS RUN, PROVED RATHER THAN ASSUMED.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W276 §0 — mail is inert", () => {
  it("both transports report a non-smtp mode and a driven send returns a dry_ id", async () => {
    expect(process.env.SMTP_MODE).toBe("dry_run");
    expect(getConfig().mode).toBe("dry_run");
    expect((await verifyTransport()).mode).not.toBe("smtp");
    const out = await sendMail({
      to: "nobody@capavate.test",
      subject: "W276 inertness probe",
      html: "<p>probe</p>",
    });
    expect(String(out.messageId)).toMatch(/^dry_/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §1 — T1. FIXED FEE, GP-CONFIRM SKIPPING `wire_funded`.
   THE LOAD-BEARING ASSERTION: the obligation ROW EXISTS after the attempt.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W276 §1 — a fixed management fee accrues its obligation on the commit path", () => {
  it("the stored obligation row exists, with the fee row's own figure and currency", async () => {
    const spvId = await createSpv("W276 T1 Fixed Fee Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "fixed", 5000, null);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t1");

    /* The defect state, asserted so a disarm prints it: nothing accrued yet. */
    expect(`before rows=${fundingFixedRows(spvId).length}`).toBe("before rows=0");
    expect(subStatusRow(subId)).toBe("review");

    const r = await gpConfirm(spvId, subId, "sig_w276_t1");

    /* ─── CONSEQUENCE FIRST. This is the assertion the whole wave stands on: a
       fixed-fee vehicle whose commitment was attempted now HAS a bill. Without
       the accrual this line reads `rows=0` and the test names the defect. */
    const rows = fundingFixedRows(spvId);
    const fee = feeRow(spvId, "management")!;
    expect(
      `rows=${rows.length} ${JSON.stringify(
        rows.map((x) => ({ amount: x.amount_minor, ccy: x.currency, state: x.state, layer: x.layer })),
      )}`,
    ).toBe(
      `rows=1 ${JSON.stringify([
        { amount: fee.fixed_amount_minor, ccy: fee.currency, state: "pending", layer: "management" },
      ])}`,
    );

    /* The figure is the vehicle's own, in the vehicle's own currency, and is a
       safe integer in MINOR units. No conversion, no rounding, no hardcode. */
    expect(fee.currency).toBe("USD");
    expect(Number.isSafeInteger(rows[0].amount_minor as number)).toBe(true);
    expect(rows[0].amount_minor).toBe(fee.fixed_amount_minor);
    expect(rows[0].currency).toBe(fee.currency);

    /* THE GATE IS NOT WEAKENED. The commitment is still refused while the bill
       is unsettled, and the stored subscription did NOT move. */
    expect(`${r.status} ${r.body?.error}`).toBe("409 FEES_UNPAID");
    expect(subStatusRow(subId)).toBe("review");

    /* AND THE BILL IS NOW VISIBLE on the surface that showed an empty list. */
    const list = await get(`/api/partner/me/spv/${spvId}/fee-obligations`, MANAGING);
    expect(list.status).toBe(200);
    const listed = (list.body.obligations as Row[]).filter(
      (o) => o.timing === "funding" && o.portion === "fixed",
    );
    expect(`listed=${listed.length} amount=${listed[0]?.amountMinor} ccy=${listed[0]?.currency}`).toBe(
      `listed=1 amount=${fee.fixed_amount_minor} ccy=${fee.currency}`,
    );
  });

  it("a non-USD vehicle accrues in ITS OWN currency and exponent — no conversion", async () => {
    /* JPY is ISO-4217 exponent 0. A hardcoded /100 anywhere on this path would
       pass every USD test in the repository and fail here. */
    const spvId = await createSpv("W276 T1b JPY Fixed Fee Vehicle", { currency: "JPY" });
    await addManagementFee(spvId, "fixed", 750000, null);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t1b");
    await gpConfirm(spvId, subId, "sig_w276_t1b");

    const rows = fundingFixedRows(spvId);
    const fee = feeRow(spvId, "management")!;
    expect(`rows=${rows.length} amount=${rows[0]?.amount_minor} ccy=${rows[0]?.currency}`).toBe(
      `rows=1 amount=${fee.fixed_amount_minor} ccy=JPY`,
    );
    expect(fee.currency).toBe("JPY");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §2 — T2. HYBRID FEE. Identical, and it is the second structure the wizard
   offers, so it is tested rather than argued from the fixed case.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W276 §2 — a hybrid management fee accrues its fixed portion too", () => {
  it("accrues exactly the FIXED portion, and the carry portion is not accrued at funding", async () => {
    const spvId = await createSpv("W276 T2 Hybrid Fee Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "hybrid", 8250, 0.2);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t2");
    expect(`before rows=${fundingFixedRows(spvId).length}`).toBe("before rows=0");

    const r = await gpConfirm(spvId, subId, "sig_w276_t2");

    const rows = fundingFixedRows(spvId);
    const fee = feeRow(spvId, "management")!;
    expect(`rows=${rows.length} amount=${rows[0]?.amount_minor} ccy=${rows[0]?.currency} state=${rows[0]?.state}`).toBe(
      `rows=1 amount=${fee.fixed_amount_minor} ccy=${fee.currency} state=pending`,
    );
    expect(fee.fee_type).toBe("hybrid");
    /* Only the funding-fixed portion. No carry obligation is minted here. */
    const all = obligationRows(spvId);
    expect(`total=${all.length} nonFundingFixed=${all.length - rows.length}`).toBe(
      "total=1 nonFundingFixed=0",
    );
    expect(`${r.status} ${r.body?.error}`).toBe("409 FEES_UNPAID");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §3 — T3. IDEMPOTENCY. This is the test that proves a real partner is never
   double-billed, and it moves the fixture: one vehicle that DID pass
   `wire_funded` first, so the pre-existing row must be found and left alone.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W276 §3 — the accrual never double-bills", () => {
  it("two GP-confirm attempts leave exactly one obligation row, byte-identical", async () => {
    const spvId = await createSpv("W276 T3 Idempotency Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "fixed", 4100, null);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t3");

    await gpConfirm(spvId, subId, "sig_w276_t3a");
    const first = JSON.stringify(fundingFixedRows(spvId));
    await gpConfirm(spvId, subId, "sig_w276_t3b");
    const second = JSON.stringify(fundingFixedRows(spvId));

    expect(`count=${fundingFixedRows(spvId).length}`).toBe("count=1");
    /* Same id, same amount, same state — not merely the same count. */
    expect(second).toBe(first);
  });

  it("a vehicle that DID pass wire_funded is untouched — no second row, no rewrite", async () => {
    const spvId = await createSpv("W276 T3b Wire-Funded Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "fixed", 6300, null);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t3b");

    /* The pre-fix ladder path: this is where the obligation always accrued. */
    const wf = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, {
      to: "wire_funded",
    });
    expect(wf.status).toBe(200);
    const before = JSON.stringify(fundingFixedRows(spvId));
    expect(fundingFixedRows(spvId).length).toBe(1);

    await gpConfirm(spvId, subId, "sig_w276_t3b2");

    expect(`count=${fundingFixedRows(spvId).length}`).toBe("count=1");
    expect(JSON.stringify(fundingFixedRows(spvId))).toBe(before);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §4 — T4. THE DECLARED BEHAVIOUR CHANGE. On an untrusted fee view the accrual
   REFUSES rather than guessing a zero, and the route answers 503, not 409 and
   not 500. A swallowed accrual failure would silently restore the old
   409-forever behaviour, so this is the test that pins the refusal is loud.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W276 §4 — an untrusted fee view refuses loudly", () => {
  it("returns 503 FEE_STATE_UNKNOWN and writes no obligation row", async () => {
    const spvId = await createSpv("W276 T4 Unreliable Fee View Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "fixed", 9900, null);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t4");

    /* Poison the DURABLE hydration verdict and give the DB a fee row the
       in-memory map does not have — the real post-failed-hydration state. */
    getDb();
    rawDb()
      .prepare(
        `INSERT OR REPLACE INTO spv_fee (id, spv_id, layer, fee_type, fixed_amount_minor, carry_pct,
           currency, effective_date, set_by, created_at, prev_hash, curr_hash)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        `fee_orphan_w276_${spvId}`, spvId, "platform", "fixed", 5000, null, "USD",
        "2026-01-01T00:00:00.000Z", "test", new Date().toISOString(),
        "0".repeat(64), `h_orphan_w276_${spvId}`,
      );
    recordFeeHydration("failed", 0, "injected: spv_fee SELECT threw");

    const r = await gpConfirm(spvId, subId, "sig_w276_t4");

    expect(`${r.status} ${r.body?.error}`).toBe("503 FEE_STATE_UNKNOWN");
    expect(`rows=${fundingFixedRows(spvId).length}`).toBe("rows=0");
    expect(subStatusRow(subId)).toBe("review");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §5 — T5. A CARRY-ONLY VEHICLE IS UNAFFECTED. A carry fee is not a funding
   obligation, and the billing EMPTY STATE (protected work) must remain empty
   and correct for it. A guard that is always shut is a silent removal of
   working functionality, not a fix.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W276 §5 — a carry-only vehicle commits, and accrues nothing", () => {
  it("GP-confirm succeeds, the stored row reads committed, and no obligation is minted", async () => {
    const spvId = await createSpv("W276 T5 Carry Only Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "carry", null, 0.2);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t5");

    const r = await gpConfirm(spvId, subId, "sig_w276_t5");

    expect(`${r.status} status=${subStatusRow(subId)} rows=${obligationRows(spvId).length}`).toBe(
      "200 status=committed rows=0",
    );
    const list = await get(`/api/partner/me/spv/${spvId}/fee-obligations`, MANAGING);
    expect(list.body.obligations).toEqual([]);
  });

  it("a vehicle with NO fee at all still commits and accrues nothing", async () => {
    const spvId = await createSpv("W276 T5b No Fee Vehicle", { currency: "USD" });
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t5b");
    const r = await gpConfirm(spvId, subId, "sig_w276_t5b");
    expect(`${r.status} status=${subStatusRow(subId)} rows=${obligationRows(spvId).length}`).toBe(
      "200 status=committed rows=0",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §6 — T6. THE BILL IS DISCHARGEABLE, AND THEN THE COMMITMENT SUCCEEDS. This
   is the end-to-end answer to "every commitment is refused": the escape is no
   longer an invisible dead end. Both admin discharge paths are driven.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W276 §6 — the newly accrued obligation can be discharged, and then the commitment lands", () => {
  it("admin WAIVE clears it and the stored subscription reaches committed", async () => {
    const spvId = await createSpv("W276 T6 Waive Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "fixed", 7000, null);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t6");

    const blocked = await gpConfirm(spvId, subId, "sig_w276_t6a");
    expect(`${blocked.status} rows=${fundingFixedRows(spvId).length}`).toBe("409 rows=1");
    const obId = String(fundingFixedRows(spvId)[0].id);

    const waive = await post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/waive`, ADMIN, {
      reason: "sponsor credit",
    });
    expect(`${waive.status} ${waive.body?.obligation?.state}`).toBe("200 waived");
    expect(fundingFixedRows(spvId)[0].state).toBe("waived");

    const ok = await gpConfirm(spvId, subId, "sig_w276_t6b");
    expect(`${ok.status} status=${subStatusRow(subId)}`).toBe("200 status=committed");
  });

  it("admin SETTLE clears it too, and the amount charged is the accrued amount", async () => {
    const spvId = await createSpv("W276 T6b Settle Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "fixed", 12345, null);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t6b");

    await gpConfirm(spvId, subId, "sig_w276_t6b1");
    const row = fundingFixedRows(spvId)[0];
    const fee = feeRow(spvId, "management")!;
    expect(row.amount_minor).toBe(fee.fixed_amount_minor);

    const settle = await post(
      `/api/admin/consortium-spv/${spvId}/fee-obligations/${row.id}/settle`,
      ADMIN,
      { outcome: "succeeded", reason: "wire received off-platform" },
    );
    expect(`${settle.status} ${settle.body?.obligation?.state}`).toBe("200 paid");
    expect(fundingFixedRows(spvId)[0].state).toBe("paid");
    /* The settled amount is still the accrued amount — nothing re-priced. */
    expect(fundingFixedRows(spvId)[0].amount_minor).toBe(fee.fixed_amount_minor);

    const ok = await gpConfirm(spvId, subId, "sig_w276_t6b2");
    expect(`${ok.status} status=${subStatusRow(subId)}`).toBe("200 status=committed");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §7 — T7. NO FEE OPTION WAS REMOVED, NARROWED OR HIDDEN. The owner requires
   full back-end pricing flexibility, so this is an owner-authority guard.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W276 §7 — all three fee structures are still offered and still accepted", () => {
  it("the fees route accepts carry, fixed AND hybrid, and each stores its own type", async () => {
    const seen: string[] = [];
    for (const t of ["carry", "fixed", "hybrid"] as const) {
      const spvId = await createSpv(`W276 T7 ${t} Vehicle`, { currency: "USD" });
      await addManagementFee(
        spvId,
        t,
        t === "carry" ? null : 5000,
        t === "fixed" ? null : 0.2,
      );
      seen.push(String(feeRow(spvId, "management")?.fee_type));
    }
    expect(seen.join(",")).toBe("carry,fixed,hybrid");
  });

  it("the GP fee panel still offers all three, from the canonical shared enum", () => {
    /* The panel's selector is driven by `SPV_FEE_TYPES`, so the enum and the
       panel's use of it are what "the wizard offers three" actually means. */
    expect(Array.from(SPV_FEE_TYPES).slice().sort().join(",")).toBe("carry,fixed,hybrid");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../client/src/components/partner/SpvDetailTabs.tsx"),
      "utf8",
    );
    expect(src.includes("SPV_FEE_TYPES")).toBe(true);
    expect(src.includes('feeType === "hybrid"')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §8 — THE GATEWAY WAS NOT WIRED, AND THE 503 IS STILL THERE. The 503 is a
   deliberate, correct refusal (R242.3). This wave must not have softened it.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W276 §8 — the payment gateway is still not wired, deliberately", () => {
  it("the partner charge route on a freshly accrued obligation still answers 503", async () => {
    const spvId = await createSpv("W276 T8 Gateway Fence Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "fixed", 5500, null);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t8");
    await gpConfirm(spvId, subId, "sig_w276_t8");
    const obId = String(fundingFixedRows(spvId)[0].id);

    const charge = await post(
      `/api/partner/me/spv/${spvId}/fee-obligations/${obId}/charge`,
      MANAGING,
      { outcome: "succeeded" },
    );
    expect(`${charge.status} ${charge.body?.error}`).toBe("503 PAYMENT_GATEWAY_UNAVAILABLE");
    /* And the obligation was NOT marked paid by the attempt. */
    expect(fundingFixedRows(spvId)[0].state).not.toBe("paid");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §9 — POSITION AND CONSEQUENCE, BEHAVIOURALLY. Not "the call exists" but
   "the call is in the committed branch and above the gate". Both are proved by
   what the system DOES, so a hoist or a reorder is caught by behaviour rather
   than by reading the file.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W276 §9 — the accrual sits inside the committed branch, above the gate", () => {
  it("does NOT fire on a non-committing transition — a soft-circle bills nobody", async () => {
    /* CONSEQUENCE OF POSITION. If the accrual were hoisted above the
       `to === "committed"` branch it would fire here, and a GP moving a row to
       `soft_circled` would incur a charge — which R136.2 forbids, because it
       changes WHEN a partner is billed. */
    const spvId = await createSpv("W276 T9 Soft Circle Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "fixed", 4400, null);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t9");

    const sc = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, {
      to: "soft_circled",
    });
    expect(`${sc.status} status=${subStatusRow(subId)} rows=${fundingFixedRows(spvId).length}`).toBe(
      "200 status=soft_circled rows=0",
    );
  });

  it("the accrual runs BEFORE the gate — a refused commit still leaves the bill behind", async () => {
    /* CONSEQUENCE OF ORDER. If the accrual were placed AFTER the
       `FEES_UNPAID` throw it would never execute on a blocked vehicle, and the
       obligation list would stay empty — the exact defect. The proof is that a
       409 leaves a row behind. */
    const spvId = await createSpv("W276 T9b Order Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "fixed", 4700, null);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t9b");
    const r = await gpConfirm(spvId, subId, "sig_w276_t9b");
    expect(`${r.status} rows=${fundingFixedRows(spvId).length}`).toBe("409 rows=1");
  });

  it("the PATCH ladder route reaches the same store gate — one fix, both doors", async () => {
    /* W277's lesson (R245.2): a guard placed at one door is walked around at
       the other. The fix is in the STORE, so the plain PATCH-to-committed door
       must accrue too. Measured, not reasoned. */
    const spvId = await createSpv("W276 T9c PATCH Door Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "fixed", 3300, null);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t9c");
    const r = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, {
      to: "committed",
      subscriptionDocRef: "sig_w276_t9c",
    });
    expect(`${r.status} ${r.body?.error} rows=${fundingFixedRows(spvId).length}`).toBe(
      "409 FEES_UNPAID rows=1",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §10 — THE ACCRUAL IS THE STORE'S OWN, SHARED WITH THE TWO DEPLOYMENT CALL
   SITES. Not a copy. If a future wave forks the accrual, the deployment path
   and the commit path would drift apart, and that is exactly the class of
   defect this wave existed to close.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W276 §10 — one accrual implementation, three call sites", () => {
  it("the commit path and the deployment path mint the SAME obligation row", async () => {
    const spvId = await createSpv("W276 T10 Shared Accrual Vehicle", { currency: "USD" });
    await addManagementFee(spvId, "fixed", 2600, null);
    const subId = await subscribeVerifiedLp(spvId, "inv_w276_t10");

    await gpConfirm(spvId, subId, "sig_w276_t10");
    const fromCommit = JSON.stringify(fundingFixedRows(spvId));
    expect(fundingFixedRows(spvId).length).toBe(1);

    /* Now drive the deployment path, whose accrue-then-check pair predates this
       wave. It must find the same row rather than mint a second. */
    let threw = "";
    try {
      spvEngineStore.accrueFundingFeeObligations(TEST_PARTNER_ID, spvId);
    } catch (e) {
      threw = (e as Error).message;
    }
    expect(threw).toBe("");
    expect(`count=${fundingFixedRows(spvId).length}`).toBe("count=1");
    expect(JSON.stringify(fundingFixedRows(spvId))).toBe(fromCommit);
  });
});
