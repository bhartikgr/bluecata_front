/**
 * WAVE 345 · ITEM 4 — THE THREE SQL `COALESCE(..., 'USD')` SITES.
 *
 * WHY THESE THREE FIRST. A census counted 207 currency-default sites across
 * three families. Two of the three SQL ones sat on MONEY SCREENS, which is the
 * worst place for an invented denomination: a partner reading their own ledger,
 * and an admin reading everybody's. They are also the smallest set, so they can
 * be proved rather than sampled.
 *
 *   SITE 1  server/lib/partnerSelfServiceRoutes.ts  GET /api/partner/me/spv-fees
 *   SITE 2  server/lib/partnerFeeAdminRoutes.ts     GET /api/admin/partner-pl
 *   SITE 3  server/partnerConsortiumRoutes.ts       GET /api/partner/me/billing
 *
 * ── HOW THIS FILE MEASURES ──────────────────────────────────────────────────
 * THE INSTRUMENT IS NOT THE PRODUCT. Sites 2 and 3 are proved through the REAL
 * HTTP routes over ROWS ACTUALLY STORED by `rawDb()`, and every database
 * assertion carries a `rows > 0` precondition, because a query that matches
 * nothing produces a green empty answer that proves nothing at all.
 *
 * A SOURCE-TEXT SECTION IS INCLUDED TOO, and it is deliberately secondary: it
 * exists to stop the specific literal coming back, not to stand in for the
 * behavioural proof above it.
 *
 * NOTHING HERE CONVERTS CURRENCY and no assertion sums across currencies.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { seedTestPartnerSandbox, partnerTeamStore } from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { hydratePartnerWorkspaceV19Store } from "../partnerWorkspaceV19Store";
import { storeCredential } from "../userCredentialsStore";
import { wave45Db } from "../lib/applyWave45PricingSchema";
import { registerPartnerFeeAdminRoutes } from "../lib/partnerFeeAdminRoutes";
import request from "supertest";

/* ── principals. `builder` is a tier with a REAL configured rate (3%), so the
      billing route answers 200 rather than the named 409 of an unrated tier. ── */
const PARTNER = "ac_consortium_partner_w345_ccy";
const MANAGING = "u_w345_ccy_managing";

/* Two deals in DIFFERENT currencies plus one with NO currency recorded — the
   three cases the old COALESCE flattened into "all dollars". */
const DEAL_USD = "sc_w345_usd";
const DEAL_CAD = "sc_w345_cad";
const DEAL_NONE = "sc_w345_no_currency";

const ENTRY_USD = "pbe_w345_usd";
const ENTRY_CAD = "pbe_w345_cad";
const ENTRY_NONE = "pbe_w345_none";

const MINOR_USD = 500_00;
const MINOR_CAD = 1_200_00;
const MINOR_NONE = 777_00;

let app: Express;
let server: http.Server;
let port = 0;
/* SITE 2's route is admin-scoped. Its registrar is mounted on its OWN bare app,
   which is exactly how the existing site-2 suite (w180_cross_currency_money_
   sweep) reaches it; this file adds no new admin principal and grants itself no
   authority it did not already have. */
let adminApp: Express;

function exec(sql: string, params: unknown[] = []) {
  rawDb().prepare(sql).run(...(params as any[]));
}

function call(
  method: string,
  apiPath: string,
  opts: { userId?: string } = {},
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request({ hostname: "127.0.0.1", port, path: apiPath, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let b: any = null;
        try { b = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body: b, raw: buf });
      });
    });
    r.on("error", reject);
    r.end();
  });
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  wave45Db();
  seedTestPartnerSandbox({ force: true });

  _registerSeedPartner({
    id: PARTNER,
    legalName: "W345 CURRENCY PARTNER, INC",
    displayName: "W345 Currency",
    email: "ops@w345-ccy.example",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "angel_network",
  });
  partnerTeamStore.add(PARTNER, MANAGING, "managing_partner", "u_system_seed", { isSeed: true });
  storeCredential({
    userId: MANAGING,
    email: "managing@w345-ccy.example",
    name: "W345 Currency Managing",
    password: "test-password-w345-ccy",
  });
  await hydratePartnerWorkspaceV19Store();

  /* ══ THE FIXTURE, WRITTEN THROUGH rawDb() ═════════════════════════════════
     A PREMISE THIS FILE RE-MEASURED AND CORRECTED BEFORE BUILDING ON IT.
     The brief's picture of site 3 was "a legacy row missing its currency". It
     cannot be: `soft_circles.currency` is declared `TEXT NOT NULL DEFAULT
     'USD'` (asserted below), so the column is never null for a row that exists.
     The COALESCE therefore fired on a MISSING JOIN — a referral entry whose
     `deal_ref` resolves to no soft-circle row at all — and in that case the
     platform holds NO currency for the money anywhere. That is the case
     fixtured here, and it is the honest one.

     (The NOT NULL DEFAULT 'USD' on the column itself is a WRITE default in the
     schema, which is a separate and larger finding: it is reported, not changed,
     because changing it needs a migration and the brief takes none.) ══ */
  const scCols = rawDb().prepare(`PRAGMA table_info(soft_circles)`).all() as Array<{
    name: string; notnull: number; dflt_value: unknown;
  }>;
  const ccyCol = scCols.find((c) => c.name === "currency");
  expect(ccyCol, "PRECONDITION: soft_circles has no currency column").toBeTruthy();
  expect(ccyCol!.notnull).toBe(1);
  expect(String(ccyCol!.dflt_value)).toContain("USD");

  /* Two deals that DO exist, in two different currencies. */
  for (const [id, ccy] of [[DEAL_USD, "USD"], [DEAL_CAD, "CAD"]] as Array<[string, string]>) {
    exec(
      `INSERT OR REPLACE INTO soft_circles
         (id, round_id, investor_name, amount, amount_minor, currency, status, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, "rnd_w345_ccy", "W345 Fixture Investor", 10000, 1_000_000, ccy, "confirmed",
       "2026-09-01T00:00:00.000Z"],
    );
  }
  /* DEAL_NONE is DELIBERATELY NOT INSERTED. Its billing entry therefore joins to
     nothing and no currency exists for it anywhere in the platform. */
  exec(`DELETE FROM soft_circles WHERE id = ?`, [DEAL_NONE]);

  for (const [id, deal, minor, status] of [
    [ENTRY_USD, DEAL_USD, MINOR_USD, "pending"],
    [ENTRY_CAD, DEAL_CAD, MINOR_CAD, "paid"],
    [ENTRY_NONE, DEAL_NONE, MINOR_NONE, "pending"],
  ] as Array<[string, string, number, string]>) {
    exec(
      `INSERT OR REPLACE INTO partner_billing_entries
         (id, partner_id, deal_ref, entry_kind, amount_funded_minor, tier_at_funding,
          commission_pct, commission_minor, status, computed_via, created_at)
       VALUES (?,?,?, 'referral_commission', ?, 'builder', 0.03, ?, ?, 'w345_fixture', ?)`,
      [id, PARTNER, deal, minor * 33, minor, status, "2026-09-01T00:00:00.000Z"],
    );
  }

  adminApp = express();
  adminApp.use(express.json());
  registerPartnerFeeAdminRoutes(adminApp);

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
}, 90_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

/* ════════════════════════════════════════════════════════════════════════════
   §0 — THE INSTRUMENT, AND A CONTROL, BEFORE ANY PRODUCT CLAIM.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W345 §0 — instrument", () => {
  it("§0A the fixture rows EXIST and are shaped as this file claims (rows > 0)", () => {
    const deals = rawDb()
      .prepare(`SELECT id, currency FROM soft_circles WHERE id IN (?,?,?)`)
      .all(DEAL_USD, DEAL_CAD, DEAL_NONE) as Array<{ id: string; currency: string | null }>;
    /* TWO, not three: the third deliberately does not exist. */
    expect(deals.length, "PRECONDITION: wrong number of deal rows — assertions below would be vacuous").toBe(2);
    const byId = new Map(deals.map((d) => [d.id, d.currency]));
    expect(byId.get(DEAL_USD)).toBe("USD");
    expect(byId.get(DEAL_CAD)).toBe("CAD");
    /* THE CASE THE OLD COALESCE LIED ABOUT: no row, so no currency anywhere. */
    expect(byId.has(DEAL_NONE)).toBe(false);

    const entries = rawDb()
      .prepare(`SELECT id, commission_minor AS m FROM partner_billing_entries WHERE partner_id = ?`)
      .all(PARTNER) as Array<{ id: string; m: number }>;
    expect(entries.length, "PRECONDITION: no billing rows").toBe(3);
    expect(entries.reduce((n, e) => n + (e.m > 0 ? 1 : 0), 0)).toBe(3);
  });

  it("§0B CONTROL — a manufactured green is refused: the forbidden mixed sum is NOT anywhere in either response", async () => {
    /* Adding the three commissions gives a number that is not money in any
       currency. If either endpoint ever emits it, that is the defect back. */
    const FORBIDDEN = MINOR_USD + MINOR_CAD + MINOR_NONE;
    const partner = await call("GET", "/api/partner/me/billing", { userId: MANAGING });
    const admin = await request(adminApp).get(`/api/admin/partner-pl?partnerId=${PARTNER}`);
    expect(partner.status).toBe(200);
    expect(JSON.stringify(partner.body.totalsByStatus)).not.toContain(String(FORBIDDEN));
    expect(admin.status).toBe(200);
    expect(JSON.stringify(admin.body.totals)).not.toContain(String(FORBIDDEN));
    /* And the control proves itself: the number really is what the old code
       would have produced, so this is not an assertion about nothing. */
    expect(FORBIDDEN).toBe(2477_00);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §1 — SITE 3, THROUGH THE PARTNER'S OWN MONEY SCREEN'S ROUTE.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W345 §1 — SITE 3 · GET /api/partner/me/billing", () => {
  it("§1A the route returns the stored rows (rows > 0) and does NOT relabel the unrecorded one USD", async () => {
    const r = await call("GET", "/api/partner/me/billing", { userId: MANAGING });
    expect(r.status).toBe(200);
    const entries = r.body.entries as Array<{ id: string; currency: string | null }>;
    expect(entries.length, "PRECONDITION: route returned no rows").toBeGreaterThan(0);
    const byId = new Map(entries.map((e) => [e.id, e.currency]));
    expect(byId.get(ENTRY_USD)).toBe("USD");
    expect(byId.get(ENTRY_CAD)).toBe("CAD");
    /* THE FIX. This used to arrive as "USD" and there was no way to tell. */
    expect(byId.get(ENTRY_NONE)).toBeNull();
  });

  it("§1B a status spanning two currencies has NO single total — null, never a sum and never a zero", async () => {
    const r = await call("GET", "/api/partner/me/billing", { userId: MANAGING });
    /* `pending` holds the USD entry and the unlabelled one, so it is not one
       figure. `paid` holds only CAD, so it IS one figure — and it is labelled. */
    expect(r.body.totalsByStatus.pending).toBeNull();
    expect(r.body.totalsByStatusCurrency.pending).toBeNull();
    expect(r.body.totalsByStatus.paid).toBe(MINOR_CAD);
    expect(r.body.totalsByStatusCurrency.paid).toBe("CAD");
    /* A null is not a zero. The distinction is the whole of rule 12. */
    expect(r.body.totalsByStatus.pending).not.toBe(0);
  });

  it("§1C the per-currency truth is carried, each figure untouched", async () => {
    const r = await call("GET", "/api/partner/me/billing", { userId: MANAGING });
    const pending = r.body.totalsByStatusAndCurrency.pending as Array<{ currency: string; minor: number }>;
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.find((x) => x.currency === "USD")!.minor).toBe(MINOR_USD);
    /* No CAD in pending: the CAD entry is settled. Status keying survives. */
    expect(pending.find((x) => x.currency === "CAD")).toBeUndefined();
    const paid = r.body.totalsByStatusAndCurrency.paid as Array<{ currency: string; minor: number }>;
    expect(paid.find((x) => x.currency === "CAD")!.minor).toBe(MINOR_CAD);
  });

  it("§1D money with no denomination is REPORTED, not absorbed and not dropped", async () => {
    const r = await call("GET", "/api/partner/me/billing", { userId: MANAGING });
    expect(r.body.entriesWithoutRecordedCurrency).toBe(1);
    expect(r.body.unrecordedCurrencyMinorByStatus.pending).toBe(MINOR_NONE);
    /* And it is NOT inside any ISO bucket. */
    const pending = r.body.totalsByStatusAndCurrency.pending as Array<{ currency: string; minor: number }>;
    for (const b of pending) expect(b.minor).not.toBe(MINOR_USD + MINOR_NONE);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §2 — SITE 2, THROUGH THE ADMIN MONEY SCREEN'S ROUTE.
   `/api/admin/partner-pl` is read here only; the reconciliation route is NOT
   touched by this wave and is not called anywhere in this file.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W345 §2 — SITE 2 · GET /api/admin/partner-pl", () => {
  it("§2A referral entries with no recorded denomination are counted, not silently dollarised", async () => {
    const r = await request(adminApp).get(`/api/admin/partner-pl?partnerId=${PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.total, "PRECONDITION: admin route returned no rows").toBeGreaterThan(0);
    /* These three referral entries have no `spv_fund_id`, so the join finds no
       vehicle and NO currency is recorded for any of them anywhere. Before this
       wave all three were labelled USD. */
    expect(r.body.entriesWithoutRecordedCurrency).toBe(r.body.total);
    /* Every entry's currency arrives as stored: null. */
    for (const e of r.body.entries as Array<{ currency: string | null }>) {
      expect(e.currency).toBeNull();
    }
  });

  it("§2B with NO labelled money at all, no total is invented — and the true amount is still stated", async () => {
    const r = await request(adminApp).get(`/api/admin/partner-pl?partnerId=${PARTNER}`);
    /* Old behaviour: three USD buckets and a confident dollar total. */
    expect(r.body.totals.all).toBeNull();
    expect(r.body.totalsCurrency).toBeNull();
    expect(r.body.totalsAvailable).toBe(false);
    /* But the money is NOT hidden: it is stated in minor units, in its own
       field, which is the difference between honesty and silence. */
    expect(r.body.unrecordedCurrencyMinor.all).toBe(MINOR_USD + MINOR_CAD + MINOR_NONE);
    expect(r.body.unrecordedCurrencyMinor.paid).toBe(MINOR_CAD);
    expect(r.body.unrecordedCurrencyMinor.pending).toBe(MINOR_USD + MINOR_NONE);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §3 — SOURCE FENCE. Secondary to everything above, on purpose.
   ════════════════════════════════════════════════════════════════════════════ */
const ROOT = path.resolve(__dirname, "..", "..");
function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
/** Strip line and block comments so a literal QUOTED IN AN EXPLANATION is not
    mistaken for a live one. Validated on a known input below. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("W345 §3 — the SQL literal cannot come back", () => {
  it("§3A the comment stripper works (validated before it is trusted)", () => {
    expect(stripComments("/* COALESCE(x,'USD') */ const a = 1;")).not.toContain("COALESCE");
    expect(stripComments("const a = 1; // COALESCE(x,'USD')")).not.toContain("COALESCE");
    /* And it does NOT eat live code — the failure mode that matters more. */
    expect(stripComments("COALESCE(y,'USD')")).toContain("COALESCE(y,'USD')");
  });

  it("§3B none of the three files contains a live COALESCE currency default", () => {
    const files = [
      "server/lib/partnerSelfServiceRoutes.ts",
      "server/lib/partnerFeeAdminRoutes.ts",
      "server/partnerConsortiumRoutes.ts",
    ];
    expect(files.length).toBe(3);
    for (const f of files) {
      const live = stripComments(read(f));
      expect(live, `${f} still defaults a currency in SQL`).not.toMatch(/COALESCE\s*\([^)]*,\s*'USD'\s*\)/i);
    }
  });

  it("§3C and neither aggregator re-introduces the default in JavaScript", () => {
    const admin = stripComments(read("server/lib/partnerFeeAdminRoutes.ts"));
    expect(admin).not.toContain('String(e.currency || "USD")');
    const partner = stripComments(read("server/partnerConsortiumRoutes.ts"));
    /* The un-keyed accumulator that produced a cross-currency sum. */
    expect(partner).not.toMatch(/totalsByStatus\[e\.status\]\s*=\s*\(totalsByStatus\[e\.status\]\s*\?\?\s*0\)/);
  });
});
