/* GROUP C — per-Consortium-Partner dynamic plan/deal engine.
 *
 * Real, DB-backed coverage for:
 *   - resolvePartnerEffectivePlan: per-partner override price wins (incl. an
 *     explicit $0), annual cycle, fallback to the advertised tier, and
 *     FAIL-CLOSED when neither resolves.
 *   - commission resolution surfaced on the plan.
 *   - report-only quota counted over the current CALENDAR MONTH.
 *   - fixed rev-share materialised as an idempotent partner_billing_entries row
 *     (entry_kind 'revshare', deal_ref UNIQUE) — auto-trigger deferred.
 *   - admin Arrangement CRUD behind requireAdmin (real HTTP route).
 *   - migration 0105 additive column present + ALTER is idempotent.
 *
 * Everything runs against the live SQLite DB via rawDb(); nothing is mocked.
 * No Airwallex / payment code is exercised — the "paid" signal is read from the
 * capavate_subscriptions status the (untouched) webhook writes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";
import express, { type Express } from "express";
import http from "node:http";

import { getDb, rawDb } from "../db/connection";
import { registerRoutes } from "../routes";
import {
  resolvePartnerEffectivePlan,
  EffectivePlanError,
  countRegisteredThisPeriod,
} from "../lib/partnerEffectivePlan";
import {
  listRevShareCandidates,
  materializeRevShareEntries,
  revShareDealRef,
} from "../lib/partnerRevShare";

const NOW_ISO = "2026-07-09T00:00:00.000Z";
const NOW = new Date(NOW_ISO);
const TIER = "builder" as const;

const PID = `ct_gc_${crypto.randomBytes(4).toString("hex")}`;
const CO_THIS = `co_gc_this_${crypto.randomBytes(3).toString("hex")}`;
const CO_PRIOR = `co_gc_prior_${crypto.randomBytes(3).toString("hex")}`;
const CO_PAID = `co_gc_paid_${crypto.randomBytes(3).toString("hex")}`;
const CO_PENDING = `co_gc_pend_${crypto.randomBytes(3).toString("hex")}`;

let app: Express;
let server: http.Server;
let port: number;

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    if (payload) headers["content-length"] = String(Buffer.byteLength(payload));
    const r = http.request({ hostname: "127.0.0.1", port, path: apiPath, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: any = null;
        try { body = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function seedContact(id: string): void {
  rawDb().prepare(
    `INSERT OR REPLACE INTO contacts
       (id, kind, legal_name, display_name, status, verification, created_at, updated_at, created_by, updated_by, version, prev_revision_hash, revision_hash, tenant_id, metadata_json)
     VALUES (?, 'consortium_partner', 'GC Test Partner', 'GC Test Partner', 'active', 'verified', ?, ?, 'test', 'test', 1, '0', 'h0', 'tn_gc', ?)`,
  ).run(id, NOW_ISO, NOW_ISO, JSON.stringify({ tier: TIER }));
}

function seedPortfolioCompany(companyId: string, createdAtIso: string): void {
  rawDb().prepare(
    `INSERT OR REPLACE INTO partner_portfolio_company
       (id, tenant_id, partner_id, company_id, profile_json, prev_hash, curr_hash, created_at, updated_at, updated_by, deleted_at)
     VALUES (?, 'tn_gc', ?, ?, '{}', '0', 'h', ?, ?, 'test', NULL)`,
  ).run(`ppc_${crypto.randomBytes(4).toString("hex")}`, PID, companyId, createdAtIso, createdAtIso);
}

function seedSubscription(companyId: string, status: "active" | "pending", amountMinor: number): void {
  const id = `sub_${crypto.randomBytes(4).toString("hex")}`;
  rawDb().prepare(
    `INSERT OR IGNORE INTO capavate_subscriptions
       (id, company_id, tier_id, user_id, status, payment_intent_id, amount_minor, currency, billing_cycle, created_at, activated_at)
     VALUES (?, ?, 'partner_tier', 'u_owner', ?, ?, ?, 'USD', 'monthly', ?, ?)`,
  ).run(id, companyId, status, `pi_${id}`, amountMinor, NOW_ISO, status === "active" ? NOW_ISO : null);
}

beforeAll(async () => {
  getDb();
  // capavate_subscriptions is created lazily by subscriptionStore; ensure it
  // exists for the direct INSERTs (mirror server/subscriptionStore.ts:108).
  rawDb().exec(`CREATE TABLE IF NOT EXISTS capavate_subscriptions (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, tier_id TEXT NOT NULL,
    user_id TEXT NOT NULL, status TEXT NOT NULL, payment_intent_id TEXT NOT NULL UNIQUE,
    amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, billing_cycle TEXT NOT NULL,
    merchant_order_id TEXT, created_at TEXT NOT NULL, activated_at TEXT, expires_at TEXT
  );`);

  seedContact(PID);
  // Quota fixtures: one company registered THIS calendar month, one in a prior month.
  seedPortfolioCompany(CO_THIS, "2026-07-02T10:00:00.000Z");
  seedPortfolioCompany(CO_PRIOR, "2026-05-15T10:00:00.000Z");

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); });
  });
}, 30_000);

afterAll(async () => {
  const db = rawDb();
  db.prepare(`DELETE FROM partner_billing_entries WHERE partner_id = ?`).run(PID);
  db.prepare(`DELETE FROM partner_portfolio_company WHERE partner_id = ?`).run(PID);
  for (const c of [CO_THIS, CO_PRIOR, CO_PAID, CO_PENDING]) {
    db.prepare(`DELETE FROM capavate_subscriptions WHERE company_id = ?`).run(c);
  }
  db.prepare(`DELETE FROM contacts WHERE id = ?`).run(PID);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GROUP C — effective price", () => {
  it("per-partner override supersedes the advertised tier", () => {
    rawDb().prepare(`UPDATE contacts SET fee_override_json = ? WHERE id = ?`).run(
      JSON.stringify({ subscription_monthly: { amountMinor: 4200, currency: "CAD" } }), PID,
    );
    const plan = resolvePartnerEffectivePlan(PID, TIER, { now: NOW });
    expect(plan.effectivePrice.amountMinor).toBe(4200);
    expect(plan.effectivePrice.currency).toBe("CAD");
    expect(plan.effectivePrice.source).toBe("partner_override");
  });

  it("an EXPLICIT $0 override is honoured (not treated as unset)", () => {
    rawDb().prepare(`UPDATE contacts SET fee_override_json = ? WHERE id = ?`).run(
      JSON.stringify({ subscription_monthly: { amountMinor: 0, currency: "USD" } }), PID,
    );
    const plan = resolvePartnerEffectivePlan(PID, TIER, { now: NOW });
    expect(plan.effectivePrice.amountMinor).toBe(0);
    expect(plan.effectivePrice.source).toBe("partner_override");
  });

  it("annual cycle reads the subscription_annual override", () => {
    rawDb().prepare(`UPDATE contacts SET fee_override_json = ? WHERE id = ?`).run(
      JSON.stringify({
        subscription_monthly: { amountMinor: 4200, currency: "USD" },
        subscription_annual: { amountMinor: 45000, currency: "USD" },
      }), PID,
    );
    const plan = resolvePartnerEffectivePlan(PID, TIER, { cycle: "annual", now: NOW });
    expect(plan.cycle).toBe("annual");
    expect(plan.effectivePrice.amountMinor).toBe(45000);
    expect(plan.effectivePrice.source).toBe("partner_override");
  });

  it("falls back to the advertised tier price when no override is set", () => {
    rawDb().prepare(`UPDATE contacts SET fee_override_json = NULL WHERE id = ?`).run(PID);
    const plan = resolvePartnerEffectivePlan(PID, TIER, { now: NOW });
    expect(plan.effectivePrice.source).toBe("tier_advertised");
    expect(plan.advertisedPrice).not.toBeNull();
    expect(plan.effectivePrice.amountMinor).toBe(plan.advertisedPrice!.amountMinor);
    expect(plan.effectivePrice.currency).toBe(plan.advertisedPrice!.currency);
  });

  it("FAILS CLOSED when neither an override nor an advertised tier resolves", () => {
    rawDb().prepare(`UPDATE contacts SET fee_override_json = NULL WHERE id = ?`).run(PID);
    expect(() =>
      resolvePartnerEffectivePlan(PID, "no_such_tier_xyz" as any, { now: NOW }),
    ).toThrow(EffectivePlanError);
  });
});

describe("GROUP C — commission", () => {
  it("surfaces the resolved commission rate on the plan", () => {
    rawDb().prepare(`UPDATE contacts SET commission_override_pct = NULL WHERE id = ?`).run(PID);
    const plan = resolvePartnerEffectivePlan(PID, TIER, { now: NOW });
    expect(typeof plan.commission.rate).toBe("number");
    expect(typeof plan.commission.via).toBe("string");
  });

  it("reflects a per-partner commission override", () => {
    rawDb().prepare(`UPDATE contacts SET commission_override_pct = 0.075 WHERE id = ?`).run(PID);
    const plan = resolvePartnerEffectivePlan(PID, TIER, { now: NOW });
    expect(plan.commission.rate).toBeCloseTo(0.075, 6);
    expect(plan.commission.via).toBe("partner_override");
    rawDb().prepare(`UPDATE contacts SET commission_override_pct = NULL WHERE id = ?`).run(PID);
  });
});

describe("GROUP C — report-only quota (calendar month)", () => {
  it("counts only companies registered in the current calendar month", () => {
    expect(countRegisteredThisPeriod(PID, NOW)).toBe(1); // CO_THIS only, CO_PRIOR excluded
  });

  it("marks the quota met (report-only) when the threshold is reached", () => {
    rawDb().prepare(`UPDATE contacts SET arrangement_json = ? WHERE id = ?`).run(
      JSON.stringify({ quota: { metric: "registered_companies", threshold: 1, period: "monthly", enforcement: "report" } }), PID,
    );
    const plan = resolvePartnerEffectivePlan(PID, TIER, { now: NOW });
    expect(plan.quotaProgress.registeredThisPeriod).toBe(1);
    expect(plan.quotaProgress.threshold).toBe(1);
    expect(plan.quotaProgress.met).toBe(true);
    expect(plan.quotaProgress.enforcement).toBe("report");
  });

  it("has met=false with a null threshold when no quota is configured", () => {
    rawDb().prepare(`UPDATE contacts SET arrangement_json = NULL WHERE id = ?`).run(PID);
    const plan = resolvePartnerEffectivePlan(PID, TIER, { now: NOW });
    expect(plan.quotaProgress.threshold).toBeNull();
    expect(plan.quotaProgress.met).toBe(false);
  });
});

describe("GROUP C — fixed rev-share (idempotent billing entry)", () => {
  beforeAll(() => {
    // A paying attributed company + a pending (unpaid) one.
    seedPortfolioCompany(CO_PAID, NOW_ISO);
    seedPortfolioCompany(CO_PENDING, NOW_ISO);
    seedSubscription(CO_PAID, "active", 50000);
    seedSubscription(CO_PENDING, "pending", 50000);
    // Enable a fixed rev-share on the arrangement.
    rawDb().prepare(`UPDATE contacts SET arrangement_json = ? WHERE id = ?`).run(
      JSON.stringify({ revShare: { enabled: true, fixedAmountMinor: 25000, currency: "USD", appliesTo: "paying_company", source: "capavate" } }), PID,
    );
  });

  it("lists only PAID, rev-share-enabled attributed companies", () => {
    const cands = listRevShareCandidates(PID);
    const ids = cands.map((c) => c.companyId);
    expect(ids).toContain(CO_PAID);
    expect(ids).not.toContain(CO_PENDING); // pending subscription is not "paid"
    const paid = cands.find((c) => c.companyId === CO_PAID)!;
    expect(paid.fixedAmountMinor).toBe(25000);
    expect(paid.dealRef).toBe(revShareDealRef(PID, CO_PAID));
    expect(paid.alreadyRecorded).toBe(false);
  });

  it("materialises exactly one pending 'revshare' billing entry", () => {
    const r = materializeRevShareEntries(PID);
    expect(r.eligible).toBe(1);
    expect(r.created).toBe(1);
    const row = rawDb().prepare(
      `SELECT entry_kind, commission_minor, commission_pct, status FROM partner_billing_entries WHERE deal_ref = ?`,
    ).get(revShareDealRef(PID, CO_PAID)) as any;
    expect(row.entry_kind).toBe("revshare");
    expect(row.commission_minor).toBe(25000);
    expect(row.commission_pct).toBe(0);
    expect(row.status).toBe("pending");
  });

  it("is idempotent — re-running creates no duplicate (deal_ref UNIQUE)", () => {
    const r = materializeRevShareEntries(PID);
    expect(r.created).toBe(0);
    expect(r.alreadyRecorded).toBe(1);
    const count = rawDb().prepare(
      `SELECT COUNT(*) c FROM partner_billing_entries WHERE deal_ref = ?`,
    ).get(revShareDealRef(PID, CO_PAID)) as any;
    expect(count.c).toBe(1);
  });

  it("lists no candidates once rev-share is disabled", () => {
    rawDb().prepare(`UPDATE contacts SET arrangement_json = ? WHERE id = ?`).run(
      JSON.stringify({ revShare: { enabled: false } }), PID,
    );
    expect(listRevShareCandidates(PID).length).toBe(0);
  });
});

describe("GROUP C — admin Arrangement CRUD behind requireAdmin", () => {
  it("PUT fee-override persists arrangement_json and GET returns it (admin)", async () => {
    const put = await call("PUT", `/api/admin/partners/${PID}/fee-override`, {
      userId: "u_admin",
      body: {
        feeOverrideJson: { subscription_monthly: { amountMinor: 12300, currency: "USD" } },
        commissionOverridePct: 0.05,
        arrangementJson: {
          subscriptionModel: "flat",
          quota: { metric: "registered_companies", threshold: 3, period: "monthly", enforcement: "report" },
          revShare: { enabled: true, fixedAmountMinor: 15000, currency: "USD" },
          notes: "test arrangement",
        },
      },
    });
    expect(put.status).toBe(200);
    expect(put.body.ok).toBe(true);

    const get = await call("GET", `/api/admin/partners/${PID}/fee-override`, { userId: "u_admin" });
    expect(get.status).toBe(200);
    expect(get.body.arrangement.quota.threshold).toBe(3);
    expect(get.body.arrangement.revShare.fixedAmountMinor).toBe(15000);
    // reset so later assertions/other suites are unaffected
    await call("PUT", `/api/admin/partners/${PID}/fee-override`, {
      userId: "u_admin", body: { feeOverrideJson: null, arrangementJson: null, commissionOverridePct: null },
    });
  });

  it("rejects a negative rev-share amount (money guard)", async () => {
    const put = await call("PUT", `/api/admin/partners/${PID}/fee-override`, {
      userId: "u_admin",
      body: { arrangementJson: { revShare: { enabled: true, fixedAmountMinor: -1 } } },
    });
    expect(put.status).toBe(400);
  });

  it("rejects a non-admin caller (requireAdmin)", async () => {
    const res = await call("GET", `/api/admin/partners/${PID}/fee-override`);
    expect([401, 403]).toContain(res.status);
  });
});

describe("GROUP C — admin rev-share query/record route", () => {
  beforeAll(() => {
    rawDb().prepare(`UPDATE contacts SET arrangement_json = ? WHERE id = ?`).run(
      JSON.stringify({ revShare: { enabled: true, fixedAmountMinor: 25000, currency: "USD" } }), PID,
    );
  });

  it("GET /api/admin/partner-revshare returns candidates (admin)", async () => {
    const res = await call("GET", `/api/admin/partner-revshare?partnerId=${PID}`, { userId: "u_admin" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.candidates)).toBe(true);
  });

  it("POST /api/admin/partner-revshare/record is idempotent", async () => {
    const first = await call("POST", `/api/admin/partner-revshare/record`, { userId: "u_admin", body: { partnerId: PID } });
    expect(first.status).toBe(200);
    const second = await call("POST", `/api/admin/partner-revshare/record`, { userId: "u_admin", body: { partnerId: PID } });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(0);
  });

  it("rejects a non-admin caller (requireAdmin)", async () => {
    const res = await call("GET", `/api/admin/partner-revshare?partnerId=${PID}`);
    expect([401, 403]).toContain(res.status);
  });
});

describe("GROUP C — migration 0105 (additive + idempotent)", () => {
  it("contacts.arrangement_json column exists", () => {
    const cols = rawDb().prepare(`PRAGMA table_info(contacts)`).all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "arrangement_json")).toBe(true);
  });

  it("re-applying the ALTER is a swallowed duplicate-column no-op", () => {
    let threw = false;
    try {
      rawDb().exec(`ALTER TABLE contacts ADD COLUMN arrangement_json TEXT`);
    } catch (e) {
      threw = /duplicate column/i.test((e as Error).message || "");
      expect(threw).toBe(true); // the ONLY acceptable error is duplicate-column
    }
    // Either way the column is still present and usable.
    const cols = rawDb().prepare(`PRAGMA table_info(contacts)`).all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "arrangement_json")).toBe(true);
  });
});
