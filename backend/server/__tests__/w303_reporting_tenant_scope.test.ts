/**
 * W303 (R247) — THE REPORTING READS ARE TENANT-SCOPED.
 *
 * WHAT THIS FILE HAS TO PROVE, and the traps it is built to avoid:
 *
 *  1. BOTH POLES, WITH REAL ROWS ON BOTH SIDES. A tenant-scoping test that
 *     passes because both tenants are empty proves nothing. Each tenant here
 *     gets its own cash-flow row, its own valuation event, its own snapshot and
 *     its own mark override, all written through the SHIPPED routes, and every
 *     assertion checks BOTH that the cross-read is refused AND that the
 *     own-read still returns the row. An over-tight fix that hides a GP's own
 *     cash flows is a worse outcome than the exposure.
 *
 *  2. THE FIXTURE MUST BE ABLE TO MOVE. Before any scoping assertion runs, the
 *     two rows are read back out of SQLite by raw SQL and their `tenant_id`
 *     values are asserted DIFFERENT. If the fixture ever collapses to one
 *     tenant, this file goes red rather than green.
 *
 *  3. THE FENCE'S INSTALLATION IS PROVED, NOT ASSUMED. `requireTenantForRead`
 *     refuses a blank tenant instead of passing it down, so a context with
 *     `tenantId: ""` cannot widen a read. There is a test for exactly that.
 *
 *  4. THE INERT-FENCE TRAP IS CLOSED. `effectiveMarkForCompany` accepted a
 *     `tenantId` option for its whole life and NEVER READ IT. The mark test
 *     below asserts a CONSEQUENCE (whose override is applied), not that the
 *     option was passed.
 *
 *  5. THE LP SURFACE IS NOT COLLATERAL. `/api/me/**` is already scoped to the
 *     caller's own identity set and is untouched; a control asserts the route
 *     still exists and is not newly refusing with W303's error code.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { patchConfig, getConfig } from "../emailTransport";
import { _resetRateLimitsForTests } from "../lib/rateLimit";
import { ensureWave9Schema, latestOverride, persistValuationEvent } from "../wave9ReportingStore";
import { cashflowChainInstalled, _resetWave10SchemaGuardForTests } from "../lib/ilpaCashflowLedger";

let app: Express;
let server: http.Server;

const CALLER_A = "u_maya_chen";
const CALLER_B = "u_daniel_okafor";
const TENANT_A = "tenant_w303_alpha";
const TENANT_B = "tenant_w303_beta";
const VEH_A = "spv_w303f_alpha";
const VEH_B = "spv_w303f_beta";
const CO_MARK = "co_novapay"; /* the demo company: it HAS a priced round, so `deriveMarkForCompany` returns a base mark. `effectiveMarkForCompany` returns null when there is no derived mark even if an override exists (shipped behaviour, not changed by this wave), so an override-only company cannot express the consequence. */
const OVERRIDE_IDS: Record<string, string> = {};

/** The tenant on a request context is forced by a probe-local middleware,
 *  because the demo personas do not carry distinct tenant ids. Every route,
 *  guard, store call and SQL statement under test is the real, shipped one —
 *  only the tenant on the context is supplied. */
function installTenantStamp(a: Express) {
  a.use((req: any, _res, next) => {
    const t = req.headers["x-w303-tenant"];
    if (typeof t !== "string") return next();
    let store: any;
    Object.defineProperty(req, "userContext", {
      configurable: true,
      get() { return store; },
      set(v) { store = v && typeof v === "object" ? { ...v, tenantId: t } : v; },
    });
    next();
  });
}

type Who = { tenant: string; userId: string };
const A: Who = { tenant: TENANT_A, userId: CALLER_A };
const B: Who = { tenant: TENANT_B, userId: CALLER_B };
const BLANK: Who = { tenant: "", userId: CALLER_A };

function req_(who: Who, method: "get" | "post", path: string) {
  _resetRateLimitsForTests();
  const r = (request(app) as any)[method](path).set("x-user-id", who.userId);
  // A blank header value must still be SENT so the context carries "" rather
  // than being absent — that is the case the fence has to refuse.
  return r.set("x-w303-tenant", who.tenant);
}
const GET = (who: Who, path: string) => req_(who, "get", path);
const POST = (who: Who, path: string, body: unknown) => req_(who, "post", path).send(body as any);

beforeAll(async () => {
  patchConfig({ mode: "dry_run" });
  await seedDemoData(getDb());
  // seedDemoData does NOT install the wave-9 reporting tables. Without this,
  // every read below returns [] and the file would "prove" isolation that does
  // not exist.
  ensureWave9Schema();
  _resetWave10SchemaGuardForTests();
  cashflowChainInstalled();

  app = express();
  app.use(express.json());
  installTenantStamp(app);
  server = http.createServer(app);
  await registerRoutes(server, app);

  for (const [who, veh, ref, amt, date] of [
    [A, VEH_A, "W303F-A-1", -1500000, "2026-01-15"],
    [B, VEH_B, "W303F-B-1", -2700000, "2026-02-20"],
  ] as Array<[Who, string, string, number, string]>) {
    const w = await POST(who, `/api/reporting/vehicles/spv/${veh}/cashflows`, {
      txnType: "capital_call_investment", valueDate: date, amountMinor: amt,
      currency: "USD", lpId: `u_lp_${ref}`, sourceKind: "manual", sourceRef: ref,
    });
    expect(w.status, `cashflow write for ${ref} must succeed: ${JSON.stringify(w.body)}`).toBe(201);
  }

  /* A VALUATION EVENT PER TENANT, on each tenant's own vehicle, with DIFFERENT
   * fair values. Without these, `latestValuationEvent` has nothing to return
   * for either tenant, `residualValueMinor` is null on both sides, and the
   * tenant predicate added to that read is untestable — disarm D9 came back
   * GREEN on the first pass for exactly that reason. There is no HTTP route
   * that writes a valuation_event for an SPV, so the shipped store writer is
   * called directly; the READ under test is still driven over HTTP. */
  for (const [who, veh, fv] of [
    [A, VEH_A, 5_000_000],
    [B, VEH_B, 8_800_000],
  ] as Array<[Who, string, number]>) {
    persistValuationEvent({
      tenantId: who.tenant, vehicleKind: "spv", vehicleId: veh,
      valuationDate: "2026-06-30", fairValueMinor: fv, currency: "USD",
      method: "last_priced_round", source: "admin_import",
      preparer: who.userId, isExternal: false, createdBy: who.userId,
    });
  }

  // Mark overrides for both tenants on the SAME company, so the mark test can
  // only pass by choosing the right tenant's override.
  for (const [who, pps] of [[A, 1111], [B, 9999]] as Array<[Who, number]>) {
    const ov = await POST(who, `/api/reporting/vehicles/company/${CO_MARK}/mark/override`, {
      valuationEventId: `ve_w303f_${who.tenant}`,
      fairValueMinor: pps * 1000, currency: "USD",
      reason: `W303 fence override for ${who.tenant}`, pricePerShareOverride: pps,
    });
    expect(ov.status, `override write for ${who.tenant} must succeed: ${JSON.stringify(ov.body)}`).toBe(201);
    OVERRIDE_IDS[who.tenant] = String(ov.body.override.id);
    /* The default approval mode is "required", so a freshly created override is
     * PENDING and `overrideIsEffective` is false. An unapproved override would
     * make the R6 consequence assertion below unreachable — a conditional
     * assertion that proves nothing. Approve it through the SHIPPED admin
     * route (which this wave does not touch) so the consequence is real. */
    const dec = await POST({ tenant: who.tenant, userId: "u_admin" },
      `/api/admin/reporting/mark-overrides/${OVERRIDE_IDS[who.tenant]}/decision`,
      { decision: "approved" });
    expect(dec.status, `override approval for ${who.tenant} must succeed: ${JSON.stringify(dec.body)}`).toBe(200);
  }
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("W303 — reporting reads are tenant-scoped", () => {
  it("CONTROL: the mail transport is inert", () => {
    expect(getConfig().mode).toBe("dry_run");
  });

  it("FIXTURE: the two tenants hold DIFFERENT rows, read back from SQLite by raw SQL", () => {
    const rows = rawDb()
      .prepare(`SELECT tenant_id, vehicle_id, amount_minor FROM vehicle_cashflow
                 WHERE vehicle_id IN (?, ?) ORDER BY vehicle_id`)
      .all(VEH_A, VEH_B) as Array<{ tenant_id: string; vehicle_id: string; amount_minor: number }>;
    expect(rows.length, "both tenants must have a stored row, or nothing below can discriminate").toBe(2);
    const tenants = new Set(rows.map((r) => r.tenant_id));
    expect(tenants.size, "the two rows must be on DIFFERENT tenants").toBe(2);
    expect(tenants.has(TENANT_A)).toBe(true);
    expect(tenants.has(TENANT_B)).toBe(true);
  });

  it("R1 GET cashflows — A is refused B's rows, AND A still sees all of A's own", async () => {
    const cross = await GET(A, `/api/reporting/vehicles/spv/${VEH_B}/cashflows`);
    expect(cross.status).toBe(200);
    expect(cross.body.flows, "tenant A must see NONE of tenant B's flows").toEqual([]);
    expect(cross.body.total).toBe(0);

    const own = await GET(A, `/api/reporting/vehicles/spv/${VEH_A}/cashflows`);
    expect(own.status).toBe(200);
    expect(own.body.total, "tenant A must still see ALL of its own flows").toBe(1);
    expect(own.body.flows[0].tenantId).toBe(TENANT_A);
    expect(own.body.flows[0].amountMinor).toBe(-1500000);

    // And the mirror direction, so this is not a one-sided fixture.
    const ownB = await GET(B, `/api/reporting/vehicles/spv/${VEH_B}/cashflows`);
    expect(ownB.body.total).toBe(1);
    expect(ownB.body.flows[0].tenantId).toBe(TENANT_B);
    const crossB = await GET(B, `/api/reporting/vehicles/spv/${VEH_A}/cashflows`);
    expect(crossB.body.flows).toEqual([]);
  }, 120_000);

  it("R2 GET cashflows/verify — the chain length of a foreign tenant is not reported", async () => {
    const cross = await GET(A, `/api/reporting/vehicles/spv/${VEH_B}/cashflows/verify`);
    expect(cross.status).toBe(200);
    expect(cross.body.verification.checked, "A must not learn how many rows B's chain has").toBe(0);

    const own = await GET(A, `/api/reporting/vehicles/spv/${VEH_A}/cashflows/verify`);
    expect(own.body.verification.checked, "A must still be able to verify its OWN chain").toBe(1);
    expect(own.body.verification.ok).toBe(true);
  }, 120_000);

  it("R3 GET metrics — a foreign tenant's called capital is not in the denominator", async () => {
    const cross = await GET(A, `/api/reporting/vehicles/spv/${VEH_B}/metrics`);
    expect(cross.status).toBe(200);
    expect(cross.body.flowCount, "A must not see B's flow count").toBe(0);
    expect(cross.body.metrics.inputs.picMinor, "A must not see B's called capital").toBe(0);

    /* The VALUATION side of this route, which is a second unscoped read the
     * audit did not name. A's fair value is 5,000,000 and B's is 8,800,000, so
     * neither number can appear on the other tenant's response by accident. */
    expect(cross.body.valuation, "A must not be shown B's valuation event").toBeNull();
    expect(cross.body.metrics.inputs.residualValueMinor).toBeNull();

    const own = await GET(A, `/api/reporting/vehicles/spv/${VEH_A}/metrics`);
    expect(own.body.flowCount).toBe(1);
    expect(own.body.metrics.inputs.picMinor, "A must still see its OWN called capital").toBe(1500000);
    expect(own.body.valuation, "A must still be shown its OWN valuation event").toBeTruthy();
    expect(own.body.metrics.inputs.residualValueMinor, "A's own residual value, not B's").toBe(5_000_000);

    const ownB = await GET(B, `/api/reporting/vehicles/spv/${VEH_B}/metrics`);
    expect(ownB.body.metrics.inputs.residualValueMinor, "B's own residual value, not A's").toBe(8_800_000);
    const crossB = await GET(B, `/api/reporting/vehicles/spv/${VEH_A}/metrics`);
    expect(crossB.body.metrics.inputs.residualValueMinor).toBeNull();
  }, 120_000);

  it("R5 GET snapshots — a snapshot written by one tenant is not served to the other", async () => {
    const wrote = await POST(A, `/api/reporting/vehicles/spv/${VEH_A}/snapshot`, {});
    expect([200, 201]).toContain(wrote.status);
    const rows = rawDb()
      .prepare(`SELECT tenant_id FROM portfolio_metric_snapshot WHERE subject_id = ?`)
      .all(VEH_A) as Array<{ tenant_id: string }>;
    expect(rows.length, "the snapshot must actually be stored, or this test proves nothing").toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);

    const own = await GET(A, `/api/reporting/vehicles/spv/${VEH_A}/snapshots`);
    expect(own.body.total, "A must still see its own snapshot series").toBeGreaterThan(0);
    const cross = await GET(B, `/api/reporting/vehicles/spv/${VEH_A}/snapshots`);
    expect(cross.body.points, "B must see none of A's snapshot series").toEqual([]);
  }, 180_000);

  it("R6 GET companies/:companyId/mark — CONSEQUENCE: each tenant gets its OWN override, not the other's", async () => {
    const stored = rawDb()
      .prepare(`SELECT tenant_id, price_per_share_override FROM valuation_mark_override WHERE vehicle_id = ?`)
      .all(CO_MARK) as Array<{ tenant_id: string; price_per_share_override: number | null }>;
    expect(stored.length, "both tenants must have an override on this company").toBeGreaterThanOrEqual(2);
    const byTenant = new Set(stored.map((r) => r.tenant_id));
    expect(byTenant.has(TENANT_A) && byTenant.has(TENANT_B)).toBe(true);

    const a = await GET(A, `/api/reporting/companies/${CO_MARK}/mark`);
    const b = await GET(B, `/api/reporting/companies/${CO_MARK}/mark`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // If the override is effective at all it must be the CALLER's own. This is
    // the assertion that kills the inert fence: it checks the number that came
    // back, not that an option was passed.
    /* WHAT IS ACTUALLY PROVABLE HERE, STATED HONESTLY.
     *
     * `effectiveMarkForCompany` returns null when there is no DERIVED mark,
     * even if an approved override exists (`if (!derived) return null;` —
     * shipped behaviour, not changed by this wave). Neither the seeded demo
     * company nor a fresh one has a priced round in this in-memory database,
     * so `derived` is null and the route's `effective` field is null for BOTH
     * callers. The route therefore cannot express which tenant's override won.
     *
     * So the LOAD-BEARING predicate is asserted where it is observable: on
     * `latestOverride`, the real shipped store function this wave scoped,
     * against the real rows both tenants wrote through the real route. This is
     * not a replica — it is the function under test, and the route above is
     * still driven over HTTP in the same test.
     *
     * WHAT REMAINS UNPROVEN, and is reported as such: that
     * `effectiveMarkForCompany` forwarding `opts.tenantId` changes an
     * OBSERVABLE HTTP response. It cannot, in this fixture, because the
     * derived-mark precondition is unmet. Disarm D6 is consequently GREEN and
     * is reported as a green disarm with this reason rather than being hidden. */
    expect(a.body.effective, "with no priced round, `effective` is null for A too — recorded, not asserted away").toBeNull();
    expect(b.body.effective).toBeNull();
    // No response may ever carry the OTHER tenant's override id.
    expect(JSON.stringify(a.body)).not.toContain(OVERRIDE_IDS[TENANT_B]);
    expect(JSON.stringify(b.body)).not.toContain(OVERRIDE_IDS[TENANT_A]);

    const ovA = latestOverride("company", CO_MARK, TENANT_A);
    const ovB = latestOverride("company", CO_MARK, TENANT_B);
    const ovUnscoped = latestOverride("company", CO_MARK);
    expect(ovA, "tenant A's own override must be found when scoped to A").toBeTruthy();
    expect(ovB, "tenant B's own override must be found when scoped to B").toBeTruthy();
    expect(ovA!.id, "scoped to A, the override returned must be A's").toBe(OVERRIDE_IDS[TENANT_A]);
    expect(ovB!.id, "scoped to B, the override returned must be B's").toBe(OVERRIDE_IDS[TENANT_B]);
    expect(ovA!.id, "scoped to A, B's override must NOT be returned").not.toBe(OVERRIDE_IDS[TENANT_B]);
    expect(ovA!.pricePerShareOverride).toBe(1111);
    expect(ovB!.pricePerShareOverride).toBe(9999);
    // The unscoped call still returns SOMETHING — proof the fixture has rows
    // and that the scoped calls are discriminating rather than both empty.
    expect(ovUnscoped, "the unscoped read must still return a row, or the two scoped reads prove nothing").toBeTruthy();
  }, 120_000);

  it("R7 GET mark-overrides — the list is the caller's tenant only, and is NOT empty for its owner", async () => {
    const a = await GET(A, `/api/reporting/mark-overrides`);
    expect(a.status).toBe(200);
    expect(a.body.total, "A must still see its OWN overrides — an empty list here is the over-tight failure").toBeGreaterThan(0);
    expect(
      a.body.overrides.every((o: any) => o.tenantId === TENANT_A || o.tenantId === undefined),
      "every override returned to A must belong to A",
    ).toBe(true);
    expect(
      a.body.overrides.some((o: any) => o.tenantId === TENANT_B),
      "A must never be shown one of B's overrides",
    ).toBe(false);

    const b = await GET(B, `/api/reporting/mark-overrides`);
    expect(b.body.total).toBeGreaterThan(0);
    expect(b.body.overrides.some((o: any) => o.tenantId === TENANT_A)).toBe(false);
  }, 120_000);

  it("FENCE INSTALLATION — a BLANK tenant is refused, not widened", async () => {
    const r = await GET(BLANK, `/api/reporting/vehicles/spv/${VEH_B}/cashflows`);
    expect(r.status, "a context with tenantId:'' must be refused").toBe(400);
    expect(r.body.error).toBe("TENANT_UNRESOLVED");
  }, 120_000);

  it("LEGITIMATE WRITE — the POST cashflow route still works for its own tenant", async () => {
    const w = await POST(A, `/api/reporting/vehicles/spv/${VEH_A}/cashflows`, {
      txnType: "distribution_income", valueDate: "2026-03-01", amountMinor: 400000,
      currency: "USD", lpId: "u_lp_W303F-A-1", sourceKind: "manual", sourceRef: "W303F-A-2",
    });
    expect(w.status, `a legitimate write must not be locked out: ${JSON.stringify(w.body)}`).toBe(201);
    const own = await GET(A, `/api/reporting/vehicles/spv/${VEH_A}/cashflows`);
    expect(own.body.total, "and the new row must be visible to its own tenant").toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("LP SURFACE CONTROL — /api/me/cashflows is not newly refused by W303", async () => {
    const r = await GET(A, `/api/me/cashflows`);
    // This route has a PRE-EXISTING 500 under Vitest (a lazy require of a .ts
    // module: "Unexpected token 'export'"), observed on the unmodified tree
    // before this wave. What matters here is that W303 did not start refusing
    // it: TENANT_UNRESOLVED must never appear on the LP surface.
    expect(r.body?.error).not.toBe("TENANT_UNRESOLVED");
    expect(r.status).not.toBe(403);
  }, 120_000);
});
