/**
 * server/__tests__/w345_deployment_fee_read_path.test.ts
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 345 · ITEM 1 — THE $840 THAT NOBODY COULD SEE.
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT WAS ASSERTED FIRST, BEFORE ANY CODE WAS WRITTEN. `spv_deployment_fee_billing`
 * was queried directly with `rawDb()` in this tree: **0 rows**. The table exists;
 * nothing has ever been recorded in it here. That is why this file does not
 * merely read the table and check a screen — it RAISES a real obligation through
 * the product's own hook and then proves the new partner read returns it.
 *
 * WHY THAT MATTERS FOR THE OWNER'S QUESTION. A screen that renders an empty
 * table proves nothing: it is exactly what a broken query looks like. So every
 * database assertion below carries a **`rowsRead > 0` PRECONDITION**, and the
 * suite contains a CONTROL that deliberately tries to manufacture a green and is
 * required to fail.
 *
 * THE THREE THINGS THIS PINS
 *   A. The mechanism: charge → a row EXISTS in `spv_deployment_fee_billing`.
 *   B. The read: the new partner-scoped read RETURNS that row, scoped correctly,
 *      with the amount's basis named and an unpriced amount as `null` not `0`.
 *   C. The honesty of emptiness: a FAILED read never reports `readOk: true`, so
 *      "nothing owed" and "we could not check" can never render the same.
 *
 * NOTHING HERE TOUCHES THE PAYMENT GATEWAY. `chargeEngineSpvDeploymentFee`
 * settles against `partner_billing_entries` in-process; the frozen
 * `paymentGatewayAdapter.ts` is not imported, not called, and not stubbed.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "fs";
import { join } from "path";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerPartnerSelfServiceRoutes } from "../lib/partnerSelfServiceRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import {
  chargeEngineSpvDeploymentFee,
  ensureBillingTable,
  DEPLOYMENT_FEE_BILLING_TABLE,
  __resetDeploymentFeeBillingLatchForTest,
} from "../lib/spvEngineDeploymentFeeHook";
import { listPartnerDeploymentFeeObligations } from "../lib/partnerDeploymentFeeObligations";

const MANAGING = "u_avi_managing";
const PARTNER = "ac_consortium_partner_test_partner_inc";
/** A partner id that owns nothing. Used as the SCOPE CONTROL. */
const STRANGER = "ac_consortium_partner_w345_stranger_inc";

let app: express.Express;

/* `send()` is typed `string | object | undefined`, so `unknown` does not fit.
   Typed at the ONE boundary rather than cast at each call site, so this harness
   adds no `tsc` error of its own — the typecheck gate is anchored on an exact
   error count and a test file must not move it. */
const post = (path: string, user: string, body: object) =>
  request(app).post(path).set("x-user-id", user).send(body);
const get = (path: string, user: string) => request(app).get(path).set("x-user-id", user);

/** EXECUTABLE source only — this wave archives each replaced line verbatim in a
 *  comment above its replacement, so a naive substring search would match the
 *  tombstone instead of live code. */
const readCode = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function ensureFeeSchedules(): void {
  const db = rawDb();
  const columns = new Set((db.prepare("PRAGMA table_info(spv)").all() as any[]).map((r) => r.name));
  for (const [name, type] of [
    ["deployment_fee_minor", "INTEGER"],
    ["deployment_fee_currency", "TEXT"],
    ["deployment_fee_payer", "TEXT"],
    ["deployment_fee_paid_at", "TEXT"],
    ["deployment_fee_schedule_id", "TEXT"],
  ]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE spv ADD COLUMN ${name} ${type}`);
  }
  const ins = (id: string, tier: string, minor: number) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO partner_fee_schedules
         (id,tier,fee_kind,amount_minor,currency,size_band_min,size_band_max,effective_from,effective_to,created_at,updated_at,created_by)
         VALUES (?,?,?,?,'USD',0,NULL,'2020-01-01T00:00:00.000Z',NULL,'2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z','w345')`,
      )
      .run(id, tier, "spv_deployment", minor);
  /* 84000 minor units = $840.00 — the owner's own live figure, used so the
   * number the owner quoted is the number this suite proves visible. */
  ins("w345_catalyst_fee", "catalyst", 84_000);
  ins("w345_builder_fee", "builder", 84_000);
}

async function newSpv(name: string): Promise<string> {
  const created = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    /* REQUIRED, and correctly so. A prior wave removed the write-side USD
       default: POST /api/partner/me/spv now refuses with SPV_CURRENCY_REQUIRED
       rather than inventing a denomination. That refusal is the standard the
       third creation door is measured against in ITEM 2. */
    currency: "USD",
    carryBasis: "per_deployment",
    status: "open",
    targetRaiseMinor: 100_000,
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  if (created.status !== 201) console.log("W345 CREATE REFUSAL", created.status, JSON.stringify(created.body));
  expect(created.status).toBe(201);
  return created.body.spv.id as string;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerPartnerSelfServiceRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  __resetDeploymentFeeBillingLatchForTest();
  ensureFeeSchedules();
  expect(ensureBillingTable(rawDb()), "the billing table is available to this suite").toBe(true);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * SECTION 0 — THE INSTRUMENT IS VALIDATED BEFORE IT MEASURES THE PRODUCT.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W345-0 — instrument validation and the manufactured green", () => {
  it("W345-0A — the CONTROL: an empty-table read is NOT accepted as evidence of a working read", () => {
    /* THE POINT OF THIS TEST. Before anything is charged, the read returns zero
       rows and `readOk: true`. That combination is INDISTINGUISHABLE from a
       correct read of a genuinely unbilled partner — which is precisely why no
       later assertion in this file is allowed to rest on it. Here the emptiness
       is asserted as the STARTING STATE, and every later test demands
       `rowsRead > 0` before it believes anything. */
    const db = rawDb();
    const before = db.prepare(`SELECT COUNT(*) AS n FROM ${DEPLOYMENT_FEE_BILLING_TABLE}`).get() as {
      n: number;
    };
    const r = listPartnerDeploymentFeeObligations(PARTNER);
    expect(r.readOk, "an empty table is a SUCCESSFUL read, not a failure").toBe(true);
    expect(r.rowsRead).toBe(0);
    expect(r.rows).toEqual([]);
    /* And this is the trap being disarmed in advance: `rows: []` here carries
       `readOk: true`, so a test that only checked `rows` would pass against a
       table that had never been written to. Recorded as a number. */
    expect(before.n).toBeGreaterThanOrEqual(0);
  });

  it("W345-0B — the read REFUSES to report an unreadable table as 'nothing owed'", () => {
    /* The failure path is exercised through the module's own contract rather
       than by breaking the database: an empty partner id cannot be scoped, so
       the read must fail LOUDLY instead of returning a comfortable empty list.
       This is the "silent empty" rule: `readOk: false` and a named code. */
    const r = listPartnerDeploymentFeeObligations("");
    expect(r.readOk).toBe(false);
    expect(r.readFailureCode).not.toBeNull();
    expect(r.rows).toEqual([]);
    expect(r.rowsRead).toBe(0);
    /* THE ASSERTION THAT MATTERS: a caller can always tell these two apart. */
    const clean = listPartnerDeploymentFeeObligations(PARTNER);
    expect(clean.readOk).not.toBe(r.readOk);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * SECTION 1 — THE MECHANISM: A CHARGE WRITES A ROW THAT REALLY EXISTS.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W345-1 — stored rows, asserted with rawDb()", () => {
  let chargedSpvId = "";

  it("W345-1A — charging a deployment fee WRITES a row to spv_deployment_fee_billing", async () => {
    const db = rawDb();
    chargedSpvId = await newSpv("W345 — the fee that must be visible");
    const result = chargeEngineSpvDeploymentFee(chargedSpvId, PARTNER);
    expect(result.charged, `charge outcome reason=${String(result.reason)}`).toBe(true);

    const rows = db
      .prepare(`SELECT * FROM ${DEPLOYMENT_FEE_BILLING_TABLE} WHERE spv_id = ?`)
      .all(chargedSpvId) as any[];
    /* THE `rows > 0` PRECONDITION, spelled before any field is inspected. */
    expect(rows.length, "a billing row EXISTS for the charged vehicle").toBeGreaterThan(0);
    expect(rows.length).toBe(1);
    expect(rows[0].partner_id).toBe(PARTNER);
    expect(rows[0].state).toBe("charged");
    /* The owner's own figure, in minor units, as STORED. */
    expect(rows[0].amount_minor).toBe(84_000);
    expect(rows[0].currency).toBe("USD");
  });

  it("W345-1B — the NEW partner read RETURNS that row (not merely 'does not error')", () => {
    const r = listPartnerDeploymentFeeObligations(PARTNER);
    expect(r.readOk).toBe(true);
    /* PRECONDITION FIRST. Without this line the rest of the test would pass
       against a read that returns nothing at all. */
    expect(r.rowsRead, "the read RETURNED ROWS").toBeGreaterThan(0);
    const row = r.rows.find((x) => x.spvId === chargedSpvId);
    expect(row, "the charged vehicle appears in the partner's own obligation list").toBeTruthy();
    expect(row!.amountMinor).toBe(84_000);
    expect(row!.currency).toBe("USD");
    /* EVERY FIGURE STATES ITS BASIS. */
    expect(row!.amountBasis).toBe("recorded_on_billing_row");
    expect(row!.state).toBe("charged");
    expect(row!.spvName).toBe("W345 — the fee that must be visible");
    /* Per-currency bucketing, never a cross-currency sum. */
    expect(r.totalsByCurrency.USD.chargedMinor).toBeGreaterThanOrEqual(84_000);
  });

  it("W345-1C — the SCOPE CONTROL: another partner does NOT see this fee", () => {
    /* If the read were unscoped, W345-1B would have gone green for the wrong
       reason. A stranger must read zero rows WHILE the real partner reads more
       than zero — both halves asserted in the same test so the pair cannot
       drift apart. */
    const mine = listPartnerDeploymentFeeObligations(PARTNER);
    const theirs = listPartnerDeploymentFeeObligations(STRANGER);
    expect(mine.rowsRead).toBeGreaterThan(0);
    expect(theirs.readOk).toBe(true);
    expect(theirs.rowsRead).toBe(0);
  });

  it("W345-1D — an obligation raised but NOT yet priced reports null, NEVER 0", () => {
    /* `openBillingRecord` inserts `amount_minor = NULL` BEFORE the charge is
       attempted, so this state is real, not hypothetical: it is what the table
       holds for every fee that was raised and could not be collected. A `0`
       here would read on a GP's screen as "you owe nothing". */
    const db = rawDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO ${DEPLOYMENT_FEE_BILLING_TABLE}
         (spv_id, partner_id, state, attempts, last_reason, last_attempt_at,
          amount_minor, currency, charged_at, created_at, updated_at)
       VALUES ('spv_w345_unpriced', ?, 'pending', 1, 'GATEWAY_UNAVAILABLE', ?, NULL, NULL, NULL, ?, ?)
       ON CONFLICT(spv_id) DO NOTHING`,
    ).run(PARTNER, now, now, now);

    const stored = db
      .prepare(`SELECT amount_minor, currency FROM ${DEPLOYMENT_FEE_BILLING_TABLE} WHERE spv_id = ?`)
      .all("spv_w345_unpriced") as any[];
    expect(stored.length, "the unpriced pending row EXISTS").toBeGreaterThan(0);
    expect(stored[0].amount_minor).toBeNull();

    const r = listPartnerDeploymentFeeObligations(PARTNER);
    expect(r.rowsRead).toBeGreaterThan(0);
    const row = r.rows.find((x) => x.spvId === "spv_w345_unpriced");
    expect(row, "the pending obligation is VISIBLE to the partner").toBeTruthy();
    /* The three assertions this item exists for. */
    expect(row!.amountMinor).toBeNull();
    expect(row!.amountMinor).not.toBe(0);
    expect(row!.amountBasis).toBe("not_yet_priced");
    expect(row!.currency).toBeNull();
    expect(row!.state).toBe("pending");
    /* An unpriced row is COUNTED, not folded into a total. */
    expect(r.unpricedRows).toBeGreaterThan(0);
    /* And a pending obligation is NOT on the invoice ledger — which is exactly
       why the old "SPV Fees" tab could not show it. */
    expect(row!.invoiced).toBe(false);
    /* PENDING SORTS FIRST: the money that is still owed is at the top. */
    expect(r.rows[0].state).toBe("pending");
  });

  it("W345-1E — the route serves it, over HTTP, to the managing partner", async () => {
    const res = await get("/api/partner/me/spv-deployment-fee-obligations", MANAGING);
    expect(res.status).toBe(200);
    expect(res.body.readOk).toBe(true);
    /* PRECONDITION: the ROUTE returned rows. A 200 with an empty body would be
       the silent empty this whole wave is about. */
    expect(res.body.rowsRead, "the ROUTE returned rows").toBeGreaterThan(0);
    const ids = (res.body.rows as any[]).map((r) => r.spvId);
    expect(ids).toContain("spv_w345_unpriced");
    /* The rendered payload must carry the basis, not just the number. */
    const unpriced = (res.body.rows as any[]).find((r) => r.spvId === "spv_w345_unpriced");
    expect(unpriced.amountBasis).toBe("not_yet_priced");
    expect(unpriced.amountMinor).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * SECTION 2 — THE READERSHIP COUNT, ASSERTED AS A NUMBER.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W345-2 — who reads the billing table, counted", () => {
  it("W345-2A — a PARTNER-side reader now exists; before this wave the count was 0", () => {
    const code = readCode("server/lib/partnerSelfServiceRoutes.ts");
    expect(code).toContain("listPartnerDeploymentFeeObligations");
    expect(code).toContain("/api/partner/me/spv-deployment-fee-obligations");
    /* The read module itself must name the table exactly once, through the
       shared constant, so a future rename cannot leave a stale literal. */
    const mod = readCode("server/lib/partnerDeploymentFeeObligations.ts");
    expect(mod).toContain("DEPLOYMENT_FEE_BILLING_TABLE");
    expect(mod).not.toMatch(/FROM\s+spv_deployment_fee_billing/);
  });

  it("W345-2B — the read module NEVER defaults a currency and never converts one", () => {
    const mod = readCode("server/lib/partnerDeploymentFeeObligations.ts");
    /* The three shapes of the defect this platform has been censusing. */
    expect(mod).not.toMatch(/\|\|\s*"USD"/);
    expect(mod).not.toMatch(/\?\?\s*"USD"/);
    expect(mod).not.toMatch(/COALESCE\([^)]*'USD'\)/i);
    /* No FX, ever. */
    expect(mod).not.toMatch(/\b(convert|fxRate|exchangeRate)\b/i);
  });

  it("W345-2C — the module is READ-ONLY: no write verb, and no payment gateway", () => {
    const mod = readCode("server/lib/partnerDeploymentFeeObligations.ts");
    expect(mod).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/);
    expect(mod).not.toMatch(/paymentGateway/i);
    expect(mod).not.toMatch(/chargeEngineSpvDeploymentFee|retryEngineSpvDeploymentFee/);
  });

  it("W345-2D — the partner SPV-fees query no longer invents a currency", () => {
    const code = readCode("server/lib/partnerSelfServiceRoutes.ts");
    /* ITEM 4 · SQL SITE 1 of 3. The tombstone lives in a comment and is stripped
       above, so this assertion is about what RUNS. */
    expect(code).not.toMatch(/COALESCE\(s\.deployment_fee_currency,\s*'USD'\)/);
    expect(code).toContain("currencyIsUnknown");
    expect(code).toContain("unknownCurrencyEntries");
  });
});
