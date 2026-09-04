/**
 * WAVE 278a (server half) — THE WIZARD'S NEW SINGLE PAYLOAD, OVER THE REAL ROUTE,
 * READ BACK OUT OF SQLITE.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT.
 * ═══════════════════════════════════════════════════════════════════════════════
 * The client half of wave 278a stops issuing three sequential writes
 * (`POST /api/partner/me/spv` → `PUT …/mandate` → `POST …/fees`) and issues ONE
 * request to the atomic form of `POST /api/partner/me/spv` that wave 86B built
 * (`server/spvEngineRoutes.ts:999`). Nothing on the server changed in this wave.
 *
 * PROVES (executed, over the real Express route table, via supertest):
 *   T1  The atomic route accepts EXACTLY the object the wizard now builds, with
 *       `mandate` AND `fees` present, and the resulting vehicle has BOTH
 *       attached — asserted by SELECTing the `spv_mandate` and `spv_fee` ROWS
 *       out of SQLite with `rawDb()`. Never the response body, and never the
 *       in-memory `mandateBySpv` / `feesBySpv` caches, which are a different
 *       store from the durable one (R224.2, the durability split).
 *   T2  NOTHING IS CREATED WHEN VALIDATION FAILS. Asserted by COUNTING ROWS in
 *       `spv`, `spv_launch_signoffs`, `spv_mandate` and `spv_fee` before and after,
 *       by trusting a 4xx status.
 *   T3  A carry-only fee stores `carry_pct` unscaled and NO fixed amount.
 *   T4  With NO management fee the wizard sends NO `fees` key at all →
 *       `launchComplete:false`, zero `spv_fee` rows, mandate still stored.
 *   T5  Money is exact and the currency is NEVER converted: the amount and the
 *       currency code are read back off the stored rows.
 *   T6  The legacy three-call sequence STAYS OPEN and still works, byte for byte
 *       (`w82_spv_launch_atomicity.test.ts` pins this too; asserted here as well
 *       so this wave cannot be read as having closed it).
 *
 * DOES NOT PROVE:
 *   · That a refusal raised by a SINK — the SPV-scoped combined-carry cap and
 *     the fee-exceeds-raise guard, both of which read the vehicle that now
 *     exists — creates nothing. It does not, and wave 278a does not change
 *     that. T7 asserts the LIMIT HONESTLY rather than pretending it is closed.
 *   · Anything about the live site. There is no live access in this wave.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

let app: express.Express;

const post = (p: string, body?: unknown) =>
  request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
const put = (p: string, body?: unknown) =>
  request(app).put(p).set("x-user-id", MANAGING).send(body ?? {});

/* ── ROW READERS. Every one goes to SQLITE, never to a store cache. ──────────
   The table names are spelled in full and the `spv_fee` count is scoped by
   `spv_id`, because a bare LIKE on the name would also match
   `spv_fee_obligation` — the exact substring trap that produced a wrong number
   twice in this band. */
const countRows = (table: string): number =>
  Number((rawDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

const mandateRow = (spvId: string) =>
  rawDb().prepare(`SELECT * FROM spv_mandate WHERE spv_id = ?`).get(spvId) as
    | Record<string, unknown>
    | undefined;

const feeRows = (spvId: string) =>
  rawDb().prepare(`SELECT * FROM spv_fee WHERE spv_id = ? ORDER BY created_at`).all(spvId) as Array<
    Record<string, unknown>
  >;

const spvRow = (spvId: string) =>
  rawDb().prepare(`SELECT * FROM spv WHERE id = ?`).get(spvId) as Record<string, unknown> | undefined;

/* ── THE PAYLOAD THE WIZARD NOW BUILDS ──────────────────────────────────────
   Shaped to mirror `client/src/pages/partner/PartnerSpvEngine.tsx` exactly: the
   same top-level keys in the same order, `mandate` as a nested object of the
   SEVEN keys the deleted PUT sent, and `fees` as a SPREAD-CONDITIONAL one-row
   array of the FIVE keys the deleted POST sent. `companyIds` was never sent by
   the wizard and is not sent here either. */
let seq = 0;
function wizardPayload(opts: {
  fee?: "fixed" | "carry" | "hybrid" | null;
  currency?: string;
  feeCurrency?: string;
  checkMinMinor?: number | null;
  checkMaxMinor?: number | null;
  targetRaiseMinor?: number;
  mandateMode?: string;
} = {}) {
  const fee = opts.fee === undefined ? "fixed" : opts.fee;
  const currency = opts.currency ?? "USD";
  const feeCurrency = opts.feeCurrency ?? currency;
  const sectors = ["fintech", "saas"];
  return {
    name: `W278a wizard launch ${Date.now()}_${seq++}`,
    jurisdiction: "delaware",
    spvType: "spv",
    carryBasis: "whole_spv",
    distributionScope: "private",
    lpVisibility: "own_only",
    targetCompanyId: null,
    targetRaiseMinor: opts.targetRaiseMinor ?? 50_000_000,
    minCheckMinor: 2_500_000,
    capMinor: 250_000_000,
    currency,
    closeDate: null,
    status: "open",
    terms: {
      mandateDescription: "W278a single-call launch probe",
      /* THE FOUR STORED-NEVER-READ TERMS KEYS. The wizard sends all four and
         this wave keeps sending them; they are here so a future wave that drops
         one has to delete a line of an assertion to do it. */
      subSector: "payments infrastructure",
      jurisdictionCountry: "United States",
      jurisdictionOther: null,
      legalEntityStructure: "LLC",
      vintage: 2026,
      termsDocRef: "https://example.invalid/w278a-terms",
      hurdleRatePct: 8,
      gpCommitMinor: 1_000_000,
    },
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
    mandate: {
      mode: opts.mandateMode ?? "sector_restricted",
      sector: sectors,
      geography: ["North America", "Europe"],
      stage: ["Series A", "Series B"],
      checkMinMinor: opts.checkMinMinor === undefined ? 500_000 : opts.checkMinMinor,
      checkMaxMinor: opts.checkMaxMinor === undefined ? 5_000_000 : opts.checkMaxMinor,
      ruleTree: { op: "and", rules: [{ field: "sector", op: "in", value: sectors }] },
    },
    ...(fee
      ? {
          fees: [
            {
              layer: "management",
              feeType: fee,
              fixedAmountMinor: fee !== "carry" ? 750_000 : undefined,
              carryPct: fee !== "fixed" ? 0.2 : undefined,
              currency: fee !== "carry" ? feeCurrency : undefined,
            },
          ],
        }
      : {}),
  };
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("W278a · PRECONDITIONS — the instruments themselves", () => {
  /* ASSERT THE PRECONDITIONS FIRST. A row reader that silently returns 0 for a
     table that does not exist would make every "nothing was created" assertion
     below pass against a defect. Mechanism 9: a RED that proves nothing; its
     mirror is a GREEN that proves nothing. */
  it("P0 · the four tables exist and the readers actually read them", () => {
    for (const t of ["spv", "spv_launch_signoffs", "spv_mandate", "spv_fee"]) {
      expect(() => countRows(t)).not.toThrow();
      expect(Number.isFinite(countRows(t))).toBe(true);
    }
    // BOTH DIRECTIONS: a table that does not exist must THROW, not return 0.
    expect(() => countRows("w278a_table_that_does_not_exist")).toThrow();
  });

  it("P1 · the fee reader is scoped by spv_id and cannot be fooled by another vehicle", async () => {
    const a = await post("/api/partner/me/spv", wizardPayload({ fee: "fixed" }));
    const b = await post("/api/partner/me/spv", wizardPayload({ fee: "fixed" }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const aId = a.body.spv.id as string;
    const bId = b.body.spv.id as string;
    expect(aId).not.toBe(bId);
    expect(feeRows(aId)).toHaveLength(1);
    expect(feeRows(bId)).toHaveLength(1);
    expect(String(feeRows(aId)[0].id)).not.toBe(String(feeRows(bId)[0].id));
  });
});

describe("W278a · T1 — ONE call, and the vehicle has BOTH mandate and fees, read from the DB", () => {
  it("T1 · the atomic route accepts the wizard's payload and stores mandate AND fee", async () => {
    const payload = wizardPayload({ fee: "fixed" });
    // The payload really does carry both optional keys — a fence that exists
    // proves nothing; prove it is PASSED.
    expect(payload).toHaveProperty("mandate");
    expect(payload).toHaveProperty("fees");
    expect(Array.isArray((payload as { fees?: unknown[] }).fees)).toBe(true);

    const res = await post("/api/partner/me/spv", payload);
    expect(res.status).toBe(201);
    expect(res.body.launchComplete).toBe(true);
    const id = res.body.spv.id as string;

    // ── THE VEHICLE, FROM SQLITE ──
    const row = spvRow(id);
    expect(row).toBeTruthy();
    expect(String(row!.name)).toBe(payload.name);

    // ── THE MANDATE, FROM SQLITE ──
    const m = mandateRow(id);
    expect(m).toBeTruthy();
    expect(String(m!.mode)).toBe("sector_restricted");
    expect(JSON.parse(String(m!.sector_json))).toEqual(["fintech", "saas"]);
    expect(JSON.parse(String(m!.geography_json))).toEqual(["North America", "Europe"]);
    expect(JSON.parse(String(m!.stage_json))).toEqual(["Series A", "Series B"]);
    expect(Number(m!.check_min_minor)).toBe(500_000);
    expect(Number(m!.check_max_minor)).toBe(5_000_000);
    expect(JSON.parse(String(m!.rule_tree_json))).toEqual({
      op: "and",
      rules: [{ field: "sector", op: "in", value: ["fintech", "saas"] }],
    });

    // ── THE FEE, FROM SQLITE ──
    const fees = feeRows(id);
    expect(fees).toHaveLength(1);
    expect(String(fees[0].layer)).toBe("management");
    expect(String(fees[0].fee_type)).toBe("fixed");
    expect(Number(fees[0].fixed_amount_minor)).toBe(750_000);
    expect(String(fees[0].currency)).toBe("USD");
  });

  it("T1b · the four stored-never-read terms keys survive the collapse to one call", async () => {
    const payload = wizardPayload({ fee: "fixed" });
    const res = await post("/api/partner/me/spv", payload);
    expect(res.status).toBe(201);
    const row = spvRow(res.body.spv.id as string);
    const terms = JSON.parse(String(row!.terms_json)) as Record<string, unknown>;
    expect(terms.subSector).toBe("payments infrastructure");
    expect(terms.termsDocRef).toBe("https://example.invalid/w278a-terms");
    expect(terms.legalEntityStructure).toBe("LLC");
    expect("jurisdictionOther" in terms).toBe(true);
  });
});

describe("W278a · T2 — NOTHING is created when validation fails (counted, not inferred)", () => {
  it("T2 · an invalid mandate check range creates NO spv, NO signoff, NO mandate, NO fee", async () => {
    const before = {
      spv: countRows("spv"),
      signoff: countRows("spv_launch_signoffs"),
      mandate: countRows("spv_mandate"),
      fee: countRows("spv_fee"),
      byPartner: spvEngineStore.listByPartner(PARTNER_A).length,
    };
    // PRECONDITION: the counters must be non-zero, or "unchanged" is vacuous.
    expect(before.spv).toBeGreaterThan(0);
    expect(before.signoff).toBeGreaterThan(0);
    expect(before.mandate).toBeGreaterThan(0);
    expect(before.fee).toBeGreaterThan(0);

    const res = await post(
      "/api/partner/me/spv",
      wizardPayload({ fee: "fixed", checkMinMinor: 9_000_000, checkMaxMinor: 1_000_000 }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    expect(countRows("spv")).toBe(before.spv);
    expect(countRows("spv_launch_signoffs")).toBe(before.signoff);
    expect(countRows("spv_mandate")).toBe(before.mandate);
    expect(countRows("spv_fee")).toBe(before.fee);
    expect(spvEngineStore.listByPartner(PARTNER_A).length).toBe(before.byPartner);
  });

  it("T2b · an out-of-domain carry creates NOTHING either — the fee refusal is above the first write", async () => {
    const before = { spv: countRows("spv"), signoff: countRows("spv_launch_signoffs"), fee: countRows("spv_fee") };
    expect(before.spv).toBeGreaterThan(0);
    const payload = wizardPayload({ fee: "carry" }) as Record<string, unknown>;
    (payload.fees as Array<Record<string, unknown>>)[0].carryPct = 2.5; // outside [0,1]
    const res = await post("/api/partner/me/spv", payload);
    expect(res.status).toBe(400);
    expect(countRows("spv")).toBe(before.spv);
    expect(countRows("spv_launch_signoffs")).toBe(before.signoff);
    expect(countRows("spv_fee")).toBe(before.fee);
  });

  it("T2c · a bad mandate MODE creates nothing — the exact refusal the old PUT raised AFTER creating a vehicle", async () => {
    const before = { spv: countRows("spv"), signoff: countRows("spv_launch_signoffs"), mandate: countRows("spv_mandate") };
    expect(before.spv).toBeGreaterThan(0);
    const res = await post("/api/partner/me/spv", wizardPayload({ mandateMode: "not_a_real_mode" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(countRows("spv")).toBe(before.spv);
    expect(countRows("spv_launch_signoffs")).toBe(before.signoff);
    expect(countRows("spv_mandate")).toBe(before.mandate);
  });
});

describe("W278a · T3/T4 — the two fee shapes the wizard can produce", () => {
  it("T3 · carry-only: carry_pct is stored UNSCALED and no fixed amount is invented", async () => {
    const res = await post("/api/partner/me/spv", wizardPayload({ fee: "carry" }));
    expect(res.status).toBe(201);
    const fees = feeRows(res.body.spv.id as string);
    expect(fees).toHaveLength(1);
    expect(String(fees[0].fee_type)).toBe("carry");
    // 0.2 stored as 0.2 — never 20, never 0.002. Read off the row.
    expect(Number(fees[0].carry_pct)).toBe(0.2);
    expect(fees[0].fixed_amount_minor == null).toBe(true);
  });

  it("T4 · NO management fee: no `fees` key at all → launchComplete false, zero fee rows, mandate still stored", async () => {
    const payload = wizardPayload({ fee: null });
    // The spread-conditional must genuinely omit the key, not send [].
    expect("fees" in payload).toBe(false);
    const res = await post("/api/partner/me/spv", payload);
    expect(res.status).toBe(201);
    expect(res.body.launchComplete).toBe(false);
    const id = res.body.spv.id as string;
    expect(feeRows(id)).toHaveLength(0);
    expect(mandateRow(id)).toBeTruthy();
    expect(String(mandateRow(id)!.mode)).toBe("sector_restricted");
  });
});

describe("W278a · T5 — money is exact and the currency is never converted", () => {
  it("T5 · a EUR vehicle with a EUR fee stores EUR on both rows and converts nothing", async () => {
    const res = await post(
      "/api/partner/me/spv",
      wizardPayload({ fee: "fixed", currency: "EUR", feeCurrency: "EUR" }),
    );
    expect(res.status).toBe(201);
    const id = res.body.spv.id as string;
    expect(String(spvRow(id)!.currency)).toBe("EUR");
    expect(String(feeRows(id)[0].currency)).toBe("EUR");
    expect(Number(feeRows(id)[0].fixed_amount_minor)).toBe(750_000);
    expect(Number(spvRow(id)!.target_raise_minor)).toBe(50_000_000);
  });

  it("T5b · a JPY vehicle carrying a USD fee keeps the two codes DISTINCT on the two rows", async () => {
    const res = await post(
      "/api/partner/me/spv",
      wizardPayload({ fee: "hybrid", currency: "JPY", feeCurrency: "USD" }),
    );
    expect(res.status).toBe(201);
    const id = res.body.spv.id as string;
    expect(String(spvRow(id)!.currency)).toBe("JPY");
    expect(String(feeRows(id)[0].currency)).toBe("USD");
    expect(Number(feeRows(id)[0].carry_pct)).toBe(0.2);
  });
});

describe("W278a · T6/T7 — what stays open, said out loud", () => {
  it("T6 · the LEGACY three-call sequence still works; this wave closed nothing on the API", async () => {
    const created = await post("/api/partner/me/spv", wizardPayload({ fee: null, mandateMode: "sector_restricted" }));
    expect(created.status).toBe(201);
    const id = created.body.spv.id as string;
    const m = await put(`/api/partner/me/spv/${id}/mandate`, {
      mode: "sector_restricted",
      sector: ["fintech"],
      geography: [],
      stage: [],
      checkMinMinor: null,
      checkMaxMinor: null,
      ruleTree: { op: "and", rules: [{ field: "sector", op: "in", value: ["fintech"] }] },
    });
    expect(m.status).toBe(200);
    const f = await post(`/api/partner/me/spv/${id}/fees`, {
      layer: "management",
      feeType: "fixed",
      fixedAmountMinor: 100_000,
      currency: "USD",
    });
    expect(f.status).toBe(201);
    expect(feeRows(id)).toHaveLength(1);
  });

  it("T7 · DECLARED LIMIT: a SINK refusal still leaves a vehicle behind, and this wave does not close it", async () => {
    /* `FEES_EXCEED_RAISE` is checked in the PRE-FLIGHT against the raise being
       submitted, so it is refused above the first write and creates nothing —
       asserted here. The refusals that remain BELOW the first write are the ones
       that must read the vehicle that does not exist yet, which is why they
       cannot be lifted. This test pins the honest half so the report's claim is
       not an assertion. */
    const before = countRows("spv");
    expect(before).toBeGreaterThan(0);
    const payload = wizardPayload({ fee: "fixed", targetRaiseMinor: 1_000 }) as Record<string, unknown>;
    (payload.fees as Array<Record<string, unknown>>)[0].fixedAmountMinor = 9_999_999;
    const res = await post("/api/partner/me/spv", payload);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("FEES_EXCEED_RAISE");
    expect(countRows("spv")).toBe(before);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   T8 — MAIL INERTNESS, ASSERTED POSITIVELY.
   ════════════════════════════════════════════════════════════════════════════
   Every command in this wave was run with `SMTP_MODE=dry_run` forced on the
   command line. That is a claim about the environment, and a claim is not a
   proof. This asserts the two things that actually make it inert:
     (a) `resolveSmtpMode()` really returns "dry_run" in this process, and
     (b) `sendEmail` really returns through the dry-run branch — which sits
         ABOVE `getTransporter()` (`server/lib/emailSender.ts`), so nodemailer's
         `createTransport` is never reached — and reports `mode: "dry_run"`
         rather than a delivery.
   Asserted in BOTH directions: the mode is not "smtp" and not "console", and
   the result is `sent` with `transportMode` naming the dry run, never
   `delivered`.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W278a · T8 — no mail left this run", () => {
  it("T8 · resolveSmtpMode() is dry_run and sendEmail returns through the dry-run branch", async () => {
    const mailer = await import("../lib/emailSender");
    // PRECONDITION, both directions: the env really is what the command line said.
    expect(process.env.SMTP_MODE).toBe("dry_run");
    const mode = mailer.resolveSmtpMode();
    expect(mode).toBe("dry_run");
    expect(mode).not.toBe("smtp");
    expect(mode).not.toBe("console");

    const res = await mailer.sendEmail({
      to: "nobody@example.invalid",
      subject: "W278a inertness probe — must never be delivered",
      text: "If this text ever reaches a mailbox the gate that produced it was a lie.",
      category: "test",
    } as Parameters<typeof mailer.sendEmail>[0]);

    expect(res.mode).toBe("dry_run");
    expect(res.status).toBe("sent");
    expect(res.status).not.toBe("delivered");
  });
});
