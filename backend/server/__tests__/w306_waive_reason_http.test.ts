/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 306 · PART 2 — THE SERVER USED TO ACCEPT AN EMPTY WAIVE REASON.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. `POST /api/admin/consortium-spv/:spvId/fee-obligations/:obId/waive`
 * read `String((req.body ?? {}).reason ?? "")` and handed whatever came back to
 * the store. The ONLY thing requiring a reason was the admin screen's disabled
 * button, and a disabled button is cosmetic: `curl -d '{}'` permanently forgave
 * money the vehicle owed and recorded the reason as an empty string.
 *
 * WHAT IS PROVED HERE, AND HOW IT REFUSES TO PROVE IT.
 *   · The refusal is driven OVER HTTP through the real route table, never through
 *     `spvFeeWaiveReasonIsAcceptable` directly. A helper that refuses proves the
 *     helper refuses; it does not prove the route calls it.
 *   · Both directions. An empty (and blank, and non-string, and too-short) reason
 *     is REFUSED with 400, AND A VALID REASON STILL SUCCEEDS with 200 and still
 *     unblocks the vehicle. A one-directional proof cannot distinguish "the rule
 *     was installed" from "the route was broken".
 *   · The refusal is proved BY THE STORED ROW: after a refused waive the
 *     obligation is still `pending` in SQLite, and no `spv.fee_obligation_waived`
 *     audit row exists for it. A 400 status with a waived row behind it would be
 *     the worst outcome of all, and a response-body-only assertion would miss it.
 *   · THE RULE IS THE SCREEN'S OWN RULE, NOT A STRICTER ONE. §3 pins the number
 *     to the literal still living in `AdminPartnerBillingOps.tsx` (out of scope
 *     for this wave, so it keeps its own literal) and proves the exact boundary:
 *     nine characters refused, ten accepted.
 *
 * MAIL SAFETY. Run with `SMTP_MODE=dry_run` on the command line; §0 asserts it.
 * ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { registerRoutes } from "../routes";
import { rawDb, getDb } from "../db/connection";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_ID } from "../partnerWorkspaceStore";
import { verifyTransport } from "../lib/emailSender";
import { getConfig, patchConfig, sendMail } from "../emailTransport";
import { _resetRateLimitsForTests } from "../lib/rateLimit";
import {
  SPV_FEE_WAIVE_REASON_MIN_LENGTH,
  SPV_FEE_WAIVE_REASON_REFUSAL_CODE,
  SPV_FEE_WAIVE_REASON_REFUSAL_MESSAGE,
  spvFeeWaiveReasonIsAcceptable,
} from "@shared/spvFeeObligationRules";

const MANAGING = "u_avi_managing";
const ADMIN = "u_admin";
const MANAGING_NOT_ADMIN = MANAGING;

let app: express.Express;
let server: http.Server;

const post = (p: string, user: string, body?: unknown) =>
  request(app).post(p).set("x-user-id", user).send(body ?? {});
const put = (p: string, user: string, body?: unknown) =>
  request(app).put(p).set("x-user-id", user).send(body ?? {});

type Row = Record<string, any>;

function obligationRow(spvId: string): Row | undefined {
  getDb();
  return (
    rawDb()
      .prepare(
        `SELECT id, timing, portion, state, waived_by AS waivedBy, waived_reason AS waivedReason
           FROM spv_fee_obligation WHERE spv_id = ? ORDER BY id`,
      )
      .all(spvId) as Row[]
  ).find((r) => r.timing === "funding" && r.portion === "fixed");
}

function waiveAuditRowsFor(spvId: string): Row[] {
  getDb();
  return rawDb()
    .prepare(
      `SELECT id, payload_json AS payloadJson FROM audit_log
         WHERE action = 'spv.fee_obligation_waived' AND target = ?`,
    )
    .all(`spv:${spvId}`) as Row[];
}

async function createSpv(name: string): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
    minCheckMinor: 10000,
    currency: "USD",
  });
  expect(r.status).toBe(201);
  return String(r.body.spv.id);
}

/** A vehicle with a live, blocking, PENDING fixed funding obligation. */
async function blockedVehicle(name: string, amountMinor: number, investorId: string) {
  const spvId = await createSpv(name);
  const fee = await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, {
    layer: "management",
    feeType: "fixed",
    fixedAmountMinor: amountMinor,
  });
  expect(fee.status).toBe(201);
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, {
    investorId,
    commitmentMinor: 100000,
  });
  expect(sub.status).toBe(201);
  const subId = String(sub.body.subscription.id);
  await put(`/api/partner/me/compliance/${investorId}`, MANAGING, {
    kycStatus: "verified",
    accreditationStatus: "self_certified",
  });
  const blocked = await post(
    `/api/partner/me/spv/${spvId}/subscriptions/${subId}/gp-confirm`,
    MANAGING,
    { documentsSigned: true, fundsReceived: true, subscriptionDocRef: `sig_${investorId}` },
  );
  /* PRECONDITION FIRST: there IS something to waive, and it is blocking. */
  expect(`${blocked.status} ${blocked.body?.error}`).toBe("409 FEES_UNPAID");
  const ob = obligationRow(spvId);
  expect(`ob=${Boolean(ob)} state=${ob?.state}`).toBe("ob=true state=pending");
  return { spvId, subId, obId: String(ob!.id) };
}

const waive = (spvId: string, obId: string, body: unknown, user = ADMIN) =>
  post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/waive`, user, body);

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
   §0 — mail is inert, proved positively.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W306 P2 §0 — mail is inert", () => {
  it("both transports are non-smtp and a driven send returns a dry_ id", async () => {
    expect(process.env.SMTP_MODE).toBe("dry_run");
    expect(getConfig().mode).toBe("dry_run");
    expect((await verifyTransport()).mode).not.toBe("smtp");
    const out = await sendMail({ to: "nobody@capavate.test", subject: "probe", html: "<p>p</p>" });
    expect(String(out.messageId)).toMatch(/^dry_/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §1 — THE REFUSAL, OVER HTTP, PROVED BY THE STORED ROW.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W306 P2 §1 — the route refuses a reasonless waive over HTTP", () => {
  it("a body with NO reason at all is refused 400 and the obligation is untouched in SQLite", async () => {
    const v = await blockedVehicle("W306 P2 No Reason", 5000, "inv_w306_p2a");
    const res = await waive(v.spvId, v.obId, {});
    expect(`${res.status} ${res.body?.error}`).toBe(`400 ${SPV_FEE_WAIVE_REASON_REFUSAL_CODE}`);
    /* R77 — a person is told what to do, not handed a bare code. */
    expect(res.body?.message).toBe(SPV_FEE_WAIVE_REASON_REFUSAL_MESSAGE);
    expect(String(res.body?.message)).toContain(String(SPV_FEE_WAIVE_REASON_MIN_LENGTH));

    /* THE LOAD-BEARING ASSERTION: the STORED row did not move, and nothing was
       audited as waived. A 400 in front of a waived row would be worse than the
       defect, and a response-body check alone cannot see that. */
    const ob = obligationRow(v.spvId)!;
    expect(`state=${ob.state} waivedBy=${ob.waivedBy} reason=${ob.waivedReason}`).toBe(
      "state=pending waivedBy=null reason=null",
    );
    expect(waiveAuditRowsFor(v.spvId).length).toBe(0);
  });

  it("an EMPTY string, whitespace, and a too-short reason are all refused, row still pending", async () => {
    const v = await blockedVehicle("W306 P2 Empty Variants", 5000, "inv_w306_p2b");
    const attempts: Array<[string, unknown]> = [
      ["empty string", ""],
      ["single space", " "],
      ["whitespace only", "          "],
      ["nine characters", "123456789"],
      ["nine after trim", "  123456789  "],
    ];
    const seen: string[] = [];
    for (const [label, reason] of attempts) {
      const res = await waive(v.spvId, v.obId, { reason });
      seen.push(`${label}=${res.status} ${res.body?.error}`);
    }
    expect(seen.join(" | ")).toBe(
      attempts
        .map(([label]) => `${label}=400 ${SPV_FEE_WAIVE_REASON_REFUSAL_CODE}`)
        .join(" | "),
    );
    const ob = obligationRow(v.spvId)!;
    expect(ob.state).toBe("pending");
    expect(waiveAuditRowsFor(v.spvId).length).toBe(0);
  });

  it("a NON-STRING reason is refused rather than coerced — String({}) is 15 plausible characters", async () => {
    const v = await blockedVehicle("W306 P2 Non String", 5000, "inv_w306_p2c");
    const seen: string[] = [];
    for (const reason of [null, 1234567890123, true, ["a reason here"], { reason: "long enough" }]) {
      const res = await waive(v.spvId, v.obId, { reason });
      seen.push(`${res.status} ${res.body?.error}`);
    }
    expect(seen.join(" | ")).toBe(
      new Array(5).fill(`400 ${SPV_FEE_WAIVE_REASON_REFUSAL_CODE}`).join(" | "),
    );
    expect(obligationRow(v.spvId)!.state).toBe("pending");
  });

  it("a NON-ADMIN is still told 403, not handed a hint about the body shape", async () => {
    const v = await blockedVehicle("W306 P2 Not Admin", 5000, "inv_w306_p2d");
    const res = await waive(v.spvId, v.obId, {}, MANAGING_NOT_ADMIN);
    expect(`${res.status} ${res.body?.error}`).toBe("403 ADMIN_REQUIRED");
    expect(obligationRow(v.spvId)!.state).toBe("pending");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §2 — AND A VALID REASON STILL SUCCEEDS. Without this the refusal above could
   equally be a broken route.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W306 P2 §2 — a valid reason still succeeds and still unblocks the vehicle", () => {
  it("200, the stored row is waived with the reason verbatim, and the commitment then lands", async () => {
    const v = await blockedVehicle("W306 P2 Valid Reason", 8000, "inv_w306_p2e");
    const REASON = "sponsor credit approved by the investment committee";

    /* PRECONDITION: the same route refuses first, on the SAME obligation, so the
       success below is not a different fixture answering a different question. */
    const refused = await waive(v.spvId, v.obId, { reason: "" });
    expect(refused.status).toBe(400);

    const ok = await waive(v.spvId, v.obId, { reason: REASON });
    expect(`${ok.status} ${ok.body?.error ?? ""}`).toBe("200 ");

    const ob = obligationRow(v.spvId)!;
    expect(`state=${ob.state} waivedBy=${ob.waivedBy}`).toBe("state=waived waivedBy=u_admin");
    /* Verbatim and untruncated in the STORED row. */
    expect(ob.waivedReason).toBe(REASON);

    /* Part 1 and Part 2 agree: exactly one audit row, carrying that same reason. */
    const rows = waiveAuditRowsFor(v.spvId);
    expect(rows.length).toBe(1);
    expect(JSON.parse(String(rows[0].payloadJson)).waivedReason).toBe(REASON);

    /* And the vehicle is genuinely unblocked. */
    const commit = await post(
      `/api/partner/me/spv/${v.spvId}/subscriptions/${v.subId}/gp-confirm`,
      MANAGING,
      { documentsSigned: true, fundsReceived: true, subscriptionDocRef: "sig_w306_p2e2" },
    );
    getDb();
    const sub = rawDb()
      .prepare("SELECT status FROM spv_subscription WHERE id = ?")
      .get(v.subId) as Row;
    expect(`${commit.status} status=${sub?.status}`).toBe("200 status=committed");
  });

  it("EXACTLY the boundary: nine characters refused, ten accepted, over HTTP", async () => {
    const nine = "abcdefghi";
    const ten = "abcdefghij";
    expect(`${nine.length}/${ten.length}`).toBe(`9/10`);
    expect(ten.length).toBe(SPV_FEE_WAIVE_REASON_MIN_LENGTH);

    const a = await blockedVehicle("W306 P2 Boundary Nine", 5000, "inv_w306_p2f");
    const refused = await waive(a.spvId, a.obId, { reason: nine });
    expect(`${refused.status}`).toBe("400");
    expect(obligationRow(a.spvId)!.state).toBe("pending");

    const b = await blockedVehicle("W306 P2 Boundary Ten", 5000, "inv_w306_p2g");
    const accepted = await waive(b.spvId, b.obId, { reason: ten });
    expect(`${accepted.status}`).toBe("200");
    expect(obligationRow(b.spvId)!.state).toBe("waived");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §3 — `w306_waive_reason_rule_binding`. THE SERVER RULE IS THE SCREEN'S RULE.
   `AdminPartnerBillingOps.tsx` was explicitly out of scope this wave, so it keeps
   its own literal `10`. That is exactly why this binding has to be asserted: two
   copies of a number silently drift. If either side moves, this fails.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W306 P2 §3 — w306_waive_reason_rule_binding", () => {
  const screen = path.resolve(__dirname, "../../client/src/pages/admin/AdminPartnerBillingOps.tsx");

  it("the admin screen file exists and is readable — a proof against a missing file proves nothing", () => {
    expect(fs.existsSync(screen)).toBe(true);
    expect(fs.readFileSync(screen, "utf8").length > 0).toBe(true);
  });

  /* THE INSTRUMENT. Keyed to the WAIVE control's own state bag (`reason[...]`),
     NOT to `.trim().length <` on its own. This matters and was caught by this
     test failing on its first run: the same screen carries TWO such rules —
     `(note[p.id] ?? "").trim().length < 5` on the payout-moderation notes (two
     buttons) — and an unkeyed pattern read the FIRST one and asserted that the
     waive minimum was five. A grep producing a number is proved on a known case
     in both directions below before anything is concluded from it. */
  const WAIVE_DISABLE_RE = /reason\[[^\]]+\]\s*\?\?\s*""\)\.trim\(\)\.length\s*<\s*(\d+)/;

  it("the grep instrument is proved in BOTH directions on known cases FIRST", () => {
    /* POSITIVE control — the real waive line's shape is matched, and the number
       extracted is the one in it. */
    const positive = 'disabled={waive.isPending || (reason[o.id] ?? "").trim().length < 10}';
    expect(Number(positive.match(WAIVE_DISABLE_RE)![1])).toBe(10);
    /* NEGATIVE control — the OTHER rule on the same screen, which an unkeyed
       pattern matched by mistake, must not match at all. */
    const otherRule = 'disabled={moderate.isPending || (note[p.id] ?? "").trim().length < 5}';
    expect(otherRule.match(WAIVE_DISABLE_RE)).toBeNull();
    /* And a drifted number must be distinguishable, so this test CAN fail. */
    expect(
      Number('(reason[o.id] ?? "").trim().length < 25'.match(WAIVE_DISABLE_RE)![1]),
    ).not.toBe(SPV_FEE_WAIVE_REASON_MIN_LENGTH);
    /* A rule WITHOUT the trim must not match either: trimming is half the rule. */
    expect('(reason[o.id] ?? "").length < 10'.match(WAIVE_DISABLE_RE)).toBeNull();
  });

  it("the screen's disable rule and this wave's constant are the SAME number", () => {
    const src = fs.readFileSync(screen, "utf8");
    /* Exactly one waive-keyed rule on the screen, so there is no ambiguity about
       which line this assertion is reading. */
    const all = Array.from(src.matchAll(new RegExp(WAIVE_DISABLE_RE.source, "g")));
    expect(`waive-keyed length rules on the screen=${all.length}`).toBe(
      "waive-keyed length rules on the screen=1",
    );
    expect(Number(all[0][1])).toBe(SPV_FEE_WAIVE_REASON_MIN_LENGTH);

    /* And the placeholder a person actually reads says the same number. */
    const placeholder = src.match(/Reason \(required, min (\d+) chars\)/);
    expect(placeholder, "the screen's `min N chars` placeholder was not found").toBeTruthy();
    expect(Number(placeholder![1])).toBe(SPV_FEE_WAIVE_REASON_MIN_LENGTH);
  });

  it("the shared predicate agrees with the boundary it claims, including on non-strings", () => {
    expect(spvFeeWaiveReasonIsAcceptable("abcdefghij")).toBe(true);
    expect(spvFeeWaiveReasonIsAcceptable("abcdefghi")).toBe(false);
    expect(spvFeeWaiveReasonIsAcceptable("   abcdefghij   ")).toBe(true);
    expect(spvFeeWaiveReasonIsAcceptable("          ")).toBe(false);
    expect(spvFeeWaiveReasonIsAcceptable(undefined)).toBe(false);
    expect(spvFeeWaiveReasonIsAcceptable(null)).toBe(false);
    expect(spvFeeWaiveReasonIsAcceptable({})).toBe(false);
    expect(spvFeeWaiveReasonIsAcceptable(["a long enough reason"])).toBe(false);
    expect(spvFeeWaiveReasonIsAcceptable(1234567890123)).toBe(false);
  });
});
