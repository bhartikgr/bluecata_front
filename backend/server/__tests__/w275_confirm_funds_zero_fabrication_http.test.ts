/* ══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 275 · R224.1 — `confirm-funds` FABRICATED A $0 WIRE INTO THE AUDIT CHAIN
 * ══════════════════════════════════════════════════════════════════════════ *
 *
 *  THE DEFECT. `POST /api/partner/me/spv/:spvId/subscriptions/:investorId/confirm-funds`
 *  read `Number(b.receivedMinor)` with no validation. An absent, blank or
 *  non-numeric body became a confident `0`, the route answered **201**, and
 *  `spvEngineStore.confirmFundsReceived` wrote a hash-chained
 *  `spv.lp_funds_confirmed` row into `audit_log` plus a durable entry in
 *  `terms._fundsConfirmations`.
 *
 *  WHY THAT IS WORSE THAN A ZERO ON A SCREEN. The GP LP roster reads the
 *  confirmation bag's KEYS — presence, not amount (`spvEngineRoutes.ts:745-788`,
 *  and the comment there says so) — so a fabricated $0 made the platform render
 *  "Funds confirmed" for money that never arrived, put a $0 contribution line on
 *  a K-1 (`spvK1Store.ts:111-130`), and suppressed the honest
 *  `NO_FUNDS_CONFIRMATION` refusal (`spvK1.ts:256`).
 *
 *  WHAT THIS FILE PROVES, AND HOW. Nothing here calls a replica. Every proof
 *  drives the REAL route over HTTP through `registerRoutes`, and then asserts
 *  the STORED ROW — the `spv.terms_json` bag and the `audit_log` table read back
 *  with `rawDb()` — never the response body alone. A response body can be right
 *  while the write is wrong; that is the whole failure mode this wave exists to
 *  remove.
 *
 *  WHAT IS DELIBERATELY STILL ACCEPTED. `isSpvMoneyMinor(0)` is TRUE, so a GP
 *  asserting an honest "nothing has arrived yet, record that" is unchanged. §4
 *  asserts it. A guard that refused a real zero would have broken a working
 *  money action, which is a worse defect than the one being fixed.
 *
 *  MONEY. Every amount below is an integer minor unit passed straight through.
 *  This file performs no arithmetic on money, converts no currency and hardcodes
 *  no price.
 *
 *  MAIL. `server/lib/emailSender.ts` defaults `SMTP_MODE` to "smtp" and
 *  `work/.env` holds live credentials. §7 forces `SMTP_MODE=dry_run` AND injects
 *  a recording transport, then asserts the sender was inert — the assertion, not
 *  the setting, is the proof.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import http from "node:http";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_ID } from "../partnerWorkspaceStore";
import { storeCredential } from "../userCredentialsStore";
import { spvEngineStore } from "../spvEngineStore";
import { __setEmailTransportForTests, verifyTransport } from "../lib/emailSender";
import { getConfig as getMailTransportConfig, patchConfig as patchMailTransportConfig, sendMail } from "../emailTransport";
import {
  spvSubscriptionRefusalCopy,
  spvSubscriptionRefusalHeadline,
} from "@shared/spvSubscriptionRefusalCopy";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT as W214_STMT } from "../../shared/wave214ThirdPartyAuthorityCopy";
import {
  W211_BODY_KEY_VERSION,
  W211_BODY_KEY_SIGNED_NAME,
  W211_BODY_KEY_TICK_1,
  W211_BODY_KEY_TICK_2,
  W211_BODY_KEY_TICK_3,
  W211_BODY_KEY_CURRENCY_CONFIRMED,
  W211_LP_COMMIT_ATTESTATION_VERSION,
} from "../../shared/wave211MoneyEventAttestation";

const MANAGING = "u_avi_managing";
const CODE_PREFIX = "INVALID_WIRED_MINOR:receivedMinor:";

const COMMIT_ATT = {
  [W211_BODY_KEY_VERSION]: W211_LP_COMMIT_ATTESTATION_VERSION,
  [W211_BODY_KEY_SIGNED_NAME]: "Ada Managing Partner",
  [W211_BODY_KEY_TICK_1]: true,
  [W211_BODY_KEY_TICK_2]: true,
  [W211_BODY_KEY_TICK_3]: true,
  [W211_BODY_KEY_CURRENCY_CONFIRMED]: true,
} as const;

let app: express.Express;
let server: http.Server;
/** Every message any code path tried to send while this file ran. Asserted EMPTY. */
const mailAttempts: Array<{ to: string; subject: string }> = [];

/* ── stored-state readers. These read the DATABASE, not a response body. ──── */

function auditRowCount(action: string): number {
  const row = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`)
    .get(action) as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

function auditRowsFor(action: string, spvId: string): Array<Record<string, any>> {
  return rawDb()
    .prepare(
      `SELECT id, actor_id AS actorId, action, target, payload_json AS payloadJson, prev_hash AS prevHash, hash
         FROM audit_log WHERE action = ? AND target = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(action, `spv:${spvId}`) as Array<Record<string, any>>;
}

/** The durable confirmation bag, read straight out of `spv.terms_json`. */
function storedConfirmations(spvId: string): Record<string, any> {
  const row = rawDb().prepare(`SELECT terms_json AS termsJson FROM spv WHERE id = ?`).get(spvId) as
    | { termsJson?: string | null }
    | undefined;
  if (!row?.termsJson) return {};
  const parsed = JSON.parse(String(row.termsJson)) as Record<string, unknown>;
  return (parsed._fundsConfirmations as Record<string, any>) ?? {};
}

function post(path: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", MANAGING).send(body ?? {});
}
function get(path: string) {
  return request(app).get(path).set("x-user-id", MANAGING);
}
function patch(path: string, body?: unknown) {
  return request(app).patch(path).set("x-user-id", MANAGING).send(body ?? {});
}

let spvId = "";
/** LP used for every refusal case. Must end the file with NO confirmation. */
let refusedLp = "";
/** LP used for the valid-wire case. */
let paidLp = "";
/** LP used for the honest explicit-zero case. */
let zeroLp = "";
/** A fourth LP's SUBSCRIPTION id, used only by the §7 regression on the :1640 precedent. */
let patchSubId = "";

async function createSpv(name: string): Promise<string> {
  const r = await post("/api/partner/me/spvs", {
    spvName: name,
    jurisdiction: "Delaware",
    vintage: 2026,
    currency: "USD",
    status: "open",
    targetSizeMinor: 100000000,
    signoffLegalName: "Ada Managing Partner",
    signoffAccepted: true,
  });
  expect(r.status, `SPV creation failed: ${JSON.stringify(r.body)}`).toBe(201);
  return String(r.body?.spv?.id ?? "");
}

async function commitLp(email: string, amountMajor: string): Promise<{ investorId: string; subId: string }> {
  const r = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
    investorEmail: email,
    holderFirstName: "Lena",
    holderLastName: "Pea",
    amount: amountMajor,
    shares: "2500",
    currency: "USD",
    ...COMMIT_ATT,
  });
  expect(r.status, `lp-commit failed: ${JSON.stringify(r.body)}`).toBe(201);
  return {
    investorId: String(r.body?.subscription?.investorId ?? ""),
    subId: String(r.body?.subscription?.id ?? ""),
  };
}

beforeAll(async () => {
  /* ══ MAIL — SCRUBBED, FORCED, AND THEN PROVED INERT (see §7) ══
     Three separate fences, because this tree has TWO independent send paths and
     one of them ignores the other's setting:
       1. `SMTP_MODE=dry_run` in the environment. Also passed on the command line,
          because ESM import side-effects (the demo seed) run BEFORE this hook.
       2. `patchConfig({ mode: "dry_run" })` on `server/emailTransport.ts`, whose
          config is CACHED on first read and therefore cannot be changed by the
          env var alone once something has already sent.
       3. An injected transport on `server/lib/emailSender.ts`.
     Fence 3 is NOT the proof: `sendEmail` returns inside its `dry_run` branch
     BEFORE the injected transport is consulted, so an empty attempt list there
     would be vacuous. §7 proves inertness by reading the LIVE resolved mode and
     by driving one send and asserting it produced a `dry_` id, never a socket. */
  process.env.SMTP_MODE = "dry_run";
  patchMailTransportConfig({ mode: "dry_run" });
  __setEmailTransportForTests({
    async send(msg: any) {
      mailAttempts.push({ to: String(msg?.to ?? ""), subject: String(msg?.subject ?? "") });
      return { ok: true, mode: "dry_run", messageId: "w275-inert" } as any;
    },
  } as any);

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  seedTestPartnerSandbox({ force: true });
  partnerTeamStore.add(TEST_PARTNER_ID, MANAGING, "managing_partner", "u_system_seed", { isSeed: true });
  storeCredential({
    userId: MANAGING,
    email: "w275.managing@test-partner.example",
    name: "Ada Managing Partner",
    password: "test-password-w275",
  });

  spvId = await createSpv("W275 Fabrication Proof SPV");
  expect(spvId).toMatch(/^spv_/);
  refusedLp = (await commitLp("w275.refused@example.com", "250000.00")).investorId;
  paidLp = (await commitLp("w275.paid@example.com", "200000.00")).investorId;
  zeroLp = (await commitLp("w275.zero@example.com", "100000.00")).investorId;
  const patchLp = await commitLp("w275.patch@example.com", "50000.00");
  patchSubId = patchLp.subId;
  expect(new Set([refusedLp, paidLp, zeroLp, patchLp.investorId]).size).toBe(4);
  expect(patchSubId.length).toBeGreaterThan(0);
}, 180_000);

afterAll(() => {
  __setEmailTransportForTests(null);
  try { server.close(); } catch { /* nothing to close */ }
});

/* ═══════════════════════════════════════════════════════════════════════════
   §1 — AN EMPTY BODY IS REFUSED WITH WORDS, AND NOTHING IS WRITTEN
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W275 §1 — POST confirm-funds with an empty body", () => {
  it("answers 400 with the already-written INVALID_WIRED_MINOR copy, and writes NOTHING", async () => {
    const auditBefore = auditRowCount("spv.lp_funds_confirmed");
    /* POSITIVE POLE FIRST: the LP really is on this vehicle's register, so a
       later "no confirmation" assertion cannot pass because the LP is absent. */
    const rosterBefore = await get(`/api/partner/me/spv/${spvId}/lp-roster`);
    expect(rosterBefore.status).toBe(200);
    expect(
      (rosterBefore.body?.subscribers ?? []).map((s: any) => s.investorId),
      "the refused LP must already be on the roster for this proof to mean anything",
    ).toContain(refusedLp);

    const r = await post(`/api/partner/me/spv/${spvId}/subscriptions/${refusedLp}/confirm-funds`);

    /* CONSEQUENCE FIRST, SHAPE SECOND. The defect's harm was a stored row and an
       audit row, so those are asserted before the status code. Ordered this way,
       a disarm run reports the FABRICATION in its failure message rather than
       merely reporting a different HTTP number. */
    const auditDelta = auditRowCount("spv.lp_funds_confirmed") - auditBefore;
    expect(
      storedConfirmations(spvId)[refusedLp],
      `a confirmation was FABRICATED from an empty body: ${JSON.stringify(storedConfirmations(spvId)[refusedLp])}`,
    ).toBeUndefined();
    expect(auditDelta, `${auditDelta} hash-chained spv.lp_funds_confirmed audit row(s) were fabricated`).toBe(0);
    expect(auditRowsFor("spv.lp_funds_confirmed", spvId)).toHaveLength(0);

    expect(r.status, `response body: ${JSON.stringify(r.body)}`).toBe(400);
    expect(String(r.body?.error)).toContain(CODE_PREFIX);
    expect(r.body?.message).toBe(spvSubscriptionRefusalHeadline("INVALID_WIRED_MINOR"));
    expect(r.body?.guidance).toBe(spvSubscriptionRefusalCopy("INVALID_WIRED_MINOR"));
    expect(r.body?.fieldError).toBe("receivedMinor");
    /* The refusal must actually carry words, not just a code. */
    expect(String(r.body?.message ?? "").length).toBeGreaterThan(20);
    expect(String(r.body?.guidance ?? "")).toContain("Enter the amount received as a plain figure");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §2 — EVERY MALFORMED SHAPE, AND NOT ONE AUDIT ROW BETWEEN THEM
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W275 §2 — every malformed receivedMinor is refused and leaves no trace", () => {
  const CASES: Array<{ label: string; body: Record<string, unknown> }> = [
    { label: "non-numeric string", body: { receivedMinor: "abc" } },
    { label: "blank string (Number('  ') === 0 — the quiet one)", body: { receivedMinor: "  " } },
    { label: "negative", body: { receivedMinor: -1 } },
    { label: "fractional", body: { receivedMinor: 1.5 } },
    { label: "above MAX_SAFE_INTEGER", body: { receivedMinor: Number.MAX_SAFE_INTEGER + 1 } },
    { label: "null", body: { receivedMinor: null } },
    { label: "numeric string (a string is not a money minor)", body: { receivedMinor: "20000000" } },
  ];

  it("all seven shapes answer 400, and the audit-row count is unchanged across all of them", async () => {
    const auditBefore = auditRowCount("spv.lp_funds_confirmed");
    const statuses: Array<[string, number]> = [];
    for (const c of CASES) {
      const r = await post(
        `/api/partner/me/spv/${spvId}/subscriptions/${refusedLp}/confirm-funds`,
        c.body,
      );
      statuses.push([c.label, r.status]);
      /* Per-case stored check FIRST — the defect wrote a row per call, so a
         count-only assertion at the end could hide six of seven, and putting
         the consequence before the shape makes a disarm say what was written. */
      expect(
        storedConfirmations(spvId)[refusedLp],
        `${c.label} FABRICATED a confirmation: ${JSON.stringify(storedConfirmations(spvId)[refusedLp])}`,
      ).toBeUndefined();
      expect(
        auditRowCount("spv.lp_funds_confirmed") - auditBefore,
        `${c.label} fabricated audit row(s)`,
      ).toBe(0);
      expect(String(r.body?.error), c.label).toContain(CODE_PREFIX);
      expect(r.body?.guidance, c.label).toBe(spvSubscriptionRefusalCopy("INVALID_WIRED_MINOR"));
    }
    expect(statuses).toEqual(CASES.map((c) => [c.label, 400] as [string, number]));
    expect(auditRowCount("spv.lp_funds_confirmed")).toBe(auditBefore);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §3 — A VALID WIRE STILL WORKS. THIS IS THE ANTI-BLANKET-REFUSAL TEST.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W275 §3 — a real wire is recorded exactly, and audited exactly once", () => {
  it("201, the stored amount is the figure sent, and exactly one audit row appears", async () => {
    const before = auditRowsFor("spv.lp_funds_confirmed", spvId).length;
    const r = await post(`/api/partner/me/spv/${spvId}/subscriptions/${paidLp}/confirm-funds`, {
      receivedMinor: 20000000,
      reference: "W275-WIRE-1",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const stored = storedConfirmations(spvId)[paidLp];
    expect(stored, "no stored confirmation for a wire the route accepted").toBeTruthy();
    expect(stored.receivedMinor).toBe(20000000);
    expect(stored.expectedMinor).toBe(20000000);
    expect(stored.deltaMinor).toBe(0);
    expect(stored.status).toBe("matched");
    expect(stored.reference).toBe("W275-WIRE-1");
    expect(String(stored.confirmedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const rows = auditRowsFor("spv.lp_funds_confirmed", spvId);
    expect(rows.length - before).toBe(1);
    const payload = JSON.parse(String(rows[rows.length - 1].payloadJson));
    expect(payload.investorId).toBe(paidLp);
    expect(payload.receivedMinor).toBe("20000000");
    expect(payload.confirmationStatus).toBe("matched");
    expect(rows[rows.length - 1].actorId).toBe(MANAGING);
    expect(String(rows[rows.length - 1].hash ?? "")).toMatch(/^[0-9a-f]{16,}$/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §4 — AN HONEST EXPLICIT ZERO IS STILL ACCEPTED
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W275 §4 — the guard refuses non-money, NOT the number zero", () => {
  it("receivedMinor: 0 is accepted, stored as 0, and reported short — the GP's honest 'nothing yet'", async () => {
    const r = await post(`/api/partner/me/spv/${spvId}/subscriptions/${zeroLp}/confirm-funds`, {
      receivedMinor: 0,
      reference: "W275-ZERO",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const stored = storedConfirmations(spvId)[zeroLp];
    expect(stored).toBeTruthy();
    expect(stored.receivedMinor).toBe(0);
    /* The difference from the defect is INTENT, and it is recorded as a
       mismatch rather than smoothed away. */
    expect(stored.status).toBe("short");
    expect(stored.expectedMinor).toBe(10000000);
    expect(stored.deltaMinor).toBe(-10000000);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §5 — THE STORE GUARD. Second line of defence, proved at the store boundary.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W275 §5 — confirmFundsReceived refuses a non-money value even if a future caller skips the route", () => {
  it("throws INVALID_WIRED_MINOR:receivedMinor:<type> for NaN, a string, a fraction and a negative", () => {
    const attempts: Array<[string, unknown, string]> = [
      ["NaN", Number.NaN, "number"],
      ["string", "abc" as unknown as number, "string"],
      ["fraction", 1.5, "number"],
      ["negative", -1, "number"],
      ["undefined", undefined as unknown as number, "undefined"],
    ];
    for (const [label, value, typeName] of attempts) {
      expect(
        () =>
          spvEngineStore.confirmFundsReceived(
            TEST_PARTNER_ID,
            spvId,
            refusedLp,
            value as number,
            "W275-STORE",
            MANAGING,
          ),
        label,
      ).toThrow(`INVALID_WIRED_MINOR:receivedMinor:${typeName}`);
    }
    /* And it wrote nothing on the way out. */
    expect(storedConfirmations(spvId)[refusedLp]).toBeUndefined();
  });

  it("the same call with a valid figure DOES write — so the throw above is the guard, not a broken method", () => {
    const conf = spvEngineStore.confirmFundsReceived(
      TEST_PARTNER_ID,
      spvId,
      paidLp,
      20000000,
      "W275-STORE-OK",
      MANAGING,
    );
    expect(conf.receivedMinor).toBe(20000000);
    expect(storedConfirmations(spvId)[paidLp].reference).toBe("W275-STORE-OK");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §6 — R224.1: WHAT EVERY CONSUMING SURFACE RENDERS WHEN THE WIRE IS ABSENT
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W275 §6 — the absence renders as an absence, on every surface", () => {
  it("LP ROSTER — the refused LP is present and reads fundsConfirmed=false; the paid LP reads true", async () => {
    const r = await get(`/api/partner/me/spv/${spvId}/lp-roster`);
    expect(r.status).toBe(200);
    const rows: any[] = r.body?.subscribers ?? [];
    const refused = rows.find((s) => s.investorId === refusedLp);
    const paid = rows.find((s) => s.investorId === paidLp);
    /* Both poles in one test: a false that sits beside a true cannot be a
       field the route simply never populates. */
    expect(refused, "the refused LP vanished from the roster").toBeTruthy();
    expect(paid, "the paid LP vanished from the roster").toBeTruthy();
    expect(refused.fundsConfirmed).toBe(false);
    expect(paid.fundsConfirmed).toBe(true);
    /* `PartnerSpvDetail.tsx:1176` renders exactly this boolean as
       "Funds confirmed" / "Funds not yet confirmed". */
  });

  it("CAPITAL ACCOUNTS — the refused LP carries no confirmed receipt", async () => {
    const r = await get(`/api/partner/me/spv/${spvId}/capital-accounts`);
    expect(r.status).toBe(200);
    const rows: any[] = r.body?.rows ?? [];
    const refused = rows.find((x) => x.investorId === refusedLp);
    const paid = rows.find((x) => x.investorId === paidLp);
    expect(refused, "the refused LP vanished from capital accounts").toBeTruthy();
    expect(paid).toBeTruthy();
    expect(Number(refused.confirmedMinor ?? 0)).toBe(0);
    expect(Number(paid.confirmedMinor ?? -1)).toBe(20000000);
  });

  it("K-1 — a vehicle year with no confirmation for this LP refuses with NO_FUNDS_CONFIRMATION rather than a $0 line", async () => {
    const fresh = await createSpvForK1();
    const r = await get(`/api/partner/me/spv/${fresh.spvId}/k1?taxYear=${new Date().getUTCFullYear()}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const statements: any[] = r.body?.statements ?? [];
    const mine = statements.find((s) => s.investorId === fresh.lp);
    expect(mine, "no K-1 statement for an LP on the committed register").toBeTruthy();
    /* THE POINT: null-with-a-reason, never 0. */
    expect(mine.contributionsMinor).toBeNull();
    const codes = (mine.refusals ?? []).map((x: any) => x.code);
    expect(codes).toContain("NO_FUNDS_CONFIRMATION");
    /* And no zero has been smuggled in under another name. */
    expect(mine.contributionsMinor).not.toBe(0);
  });
});

/** A clean vehicle with one committed LP and NO confirmation, for the K-1 proof. */
async function createSpvForK1(): Promise<{ spvId: string; lp: string }> {
  const r = await post("/api/partner/me/spvs", {
    spvName: "W275 K1 Absence SPV",
    jurisdiction: "Delaware",
    vintage: 2026,
    currency: "USD",
    status: "open",
    targetSizeMinor: 50000000,
    signoffLegalName: "Ada Managing Partner",
    signoffAccepted: true,
  });
  expect(r.status).toBe(201);
  const id = String(r.body?.spv?.id ?? "");
  const commit = await post(`/api/partner/me/spv/${id}/lp-commit`, {
    investorEmail: "w275.k1@example.com",
    holderFirstName: "Kay",
    holderLastName: "One",
    amount: "150000.00",
    shares: "1500",
    currency: "USD",
    ...COMMIT_ATT,
  });
  expect(commit.status).toBe(201);
  return { spvId: id, lp: String(commit.body?.subscription?.investorId ?? "") };
}

/* ═══════════════════════════════════════════════════════════════════════════
   §7 — REGRESSION AND MAIL
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W275 §7 — the precedent I copied is undisturbed, and no mail was sent", () => {
  it("PATCH …/subscriptions/:subId still refuses a bad wiredMinor with 400 INVALID_WIRED_MINOR", async () => {
    const r = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${patchSubId}`, {
      to: "withdrawn",
      wiredMinor: "not-a-number",
    });
    expect(r.status).toBe(400);
    expect(String(r.body?.error)).toContain("INVALID_WIRED_MINOR:");
    expect(r.body?.message).toBe(spvSubscriptionRefusalHeadline("INVALID_WIRED_MINOR"));

    /* POSITIVE POLE, run second so the 400 above is measured on an untouched row:
       the SAME route with a WELL-FORMED wiredMinor and a legal transition
       succeeds. Without this, the 400 could be the route being unreachable. */
    const ok = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${patchSubId}`, {
      to: "withdrawn",
      wiredMinor: 5000000,
    });
    expect(ok.status, `the precedent route itself is broken: ${JSON.stringify(ok.body)}`).toBe(200);
  });

  /* ══ THE `err()` MAPPING QUESTION, ANSWERED EMPIRICALLY ══
     The engineering document flags as UNVERIFIED whether `err()`'s status map
     prefix-matches or exact-matches. It EXACT-matches (`map[msg]`). Prefixed
     codes are resolved by a SEPARATE map, `SPV_SUBSCRIPTION_PREFIX_STATUS`
     (`spvEngineRoutes.ts:~392`), keyed on `msg.split(":")[0]`. This test proves
     that over HTTP with a code the store raises and the exact map does NOT
     contain, so the W275 store guard's thrown
     `INVALID_WIRED_MINOR:receivedMinor:<type>` is known to arrive with words. */
  it("err() resolves a PREFIXED store code through the prefix map, with headline and guidance", async () => {
    const lp = await commitLp("w275.prefix@example.com", "25000.00");
    const r = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${lp.subId}`, {
      to: "wire_funded",
    });
    expect(r.status).toBe(409);
    expect(String(r.body?.error)).toMatch(/^ILLEGAL_SUBSCRIPTION_TRANSITION:/);
    expect(String(r.body?.error)).not.toBe("ILLEGAL_SUBSCRIPTION_TRANSITION");
    expect(String(r.body?.message ?? "").length).toBeGreaterThan(20);
    expect(String(r.body?.guidance ?? "").length).toBeGreaterThan(20);
    /* And the 240-char client gate (`queryClient.ts:60-65`) is respected. */
    expect(String(r.body?.message).length).toBeLessThan(240);
  });

  it("the mail sender was inert — proved by the LIVE resolved mode and one driven send, not by an empty list", async () => {
    expect(process.env.SMTP_MODE).toBe("dry_run");
    /* `server/emailTransport.ts` — the path whose console lines appear in this
       run's stdout during import-time demo seeding. Read LIVE, after the run. */
    expect(getMailTransportConfig().mode).toBe("dry_run");
    /* `server/lib/emailSender.ts` — its own resolved mode, read live. */
    const verified = await verifyTransport();
    expect(verified.mode).not.toBe("smtp");
    /* THE POSITIVE POLE. Drive one real send through the transport and assert it
       produced a dry-run id. This is what makes the two assertions above
       load-bearing: if the mode were `smtp`, this call would open a socket and
       the id would not start `dry_`. */
    const sent = await sendMail({
      to: "w275.inert@example.invalid",
      subject: "W275 inertness probe",
      html: "<p>This message must never leave the process.</p>",
      text: "This message must never leave the process.",
    });
    expect(sent.ok).toBe(true);
    expect(String(sent.messageId)).toMatch(/^dry_/);
    /* The injected `emailSender` transport recorded nothing, which is EXPECTED
       and is reported as such rather than presented as the proof. */
    expect(mailAttempts, `emailSender injected-transport attempts: ${JSON.stringify(mailAttempts)}`).toHaveLength(0);
  });
});
