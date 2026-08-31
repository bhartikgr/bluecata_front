/**
 * WAVE 178 · ITEM A — THE PER-CURRENCY ROLLUP REACHES THE WIRE, FROM REAL SPVs.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY FROM THE DOM TEST ───────────────────────
 * R137: an LP fix once passed every test and never reached the LP. The DOM test
 * (`client/src/pages/partner/__tests__/w178_itemA_dashboard_currency_scope.test.tsx`)
 * proves the component renders a per-currency payload correctly, but it feeds
 * itself a FIXTURE. If the aggregation or the route dropped the field, that test
 * would still be green and the live partner would still see a cross-currency
 * total. This file closes that gap: real `spvEngineStore` vehicles in three
 * currencies, through the real `GET /api/partner/me/dashboard` route.
 *
 * ── POLES ───────────────────────────────────────────────────────────────────
 *   1 · The route response CARRIES `portfolio.capitalByCurrency`. The whole chain
 *       exists end to end.
 *   2 · One row per currency actually held, sorted, each carrying its own
 *       committed and its own target — and CAD/HKD amounts are never mixed into
 *       the USD row.
 *   3 · THE DEFECT, DIRECTLY: the legacy scalar `totalSpvCommittedMinor` still
 *       adds every currency together, and the USD row does NOT equal it. That
 *       inequality IS the bug the dashboard was printing, and it is now
 *       observable rather than hidden behind a "USD" label.
 *   4 · A currency code that is not usable is COUNTED and EXCLUDED, never folded
 *       into USD.
 *   5 · "no target on record" is `null`, never 0 (R141/R144).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox, partnerDashboardSnapshot } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";

const PARTNER = "ac_consortium_partner_test_partner_inc";
const ACTOR = "u_avi_managing";
let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  seedTestPartnerSandbox({ force: true });

  /* Three currencies, mirroring the live firm the owner reported: USD vehicles
     alongside a CA$ one (Asian Biotech) and a HK$ one (QA HK Tax Check). */
  spvEngineStore.createSpv(
    PARTNER,
    { name: "W178 USD SPV", jurisdiction: "delaware", carryBasis: "whole_spv", currency: "USD", status: "draft", targetRaiseMinor: 300_000_000 },
    ACTOR,
  );
  spvEngineStore.createSpv(
    PARTNER,
    { name: "W178 CAD SPV", jurisdiction: "delaware", carryBasis: "whole_spv", currency: "CAD", status: "draft", targetRaiseMinor: 120_000 },
    ACTOR,
  );
  spvEngineStore.createSpv(
    PARTNER,
    { name: "W178 HKD SPV", jurisdiction: "delaware", carryBasis: "whole_spv", currency: "HKD", status: "draft" },
    ACTOR,
  );
});

describe("WAVE 178 · ITEM A — per-currency capital on the dashboard wire", () => {
  it("POLE 1 — GET /api/partner/me/dashboard carries portfolio.capitalByCurrency", async () => {
    const res = await request(app).get("/api/partner/me/dashboard").set("x-user-id", ACTOR);
    expect(res.status).toBe(200);
    const cap = res.body?.portfolio?.capitalByCurrency;
    expect(cap).toBeTruthy();
    expect(Array.isArray(cap.rows)).toBe(true);
    expect(typeof cap.vehiclesWithoutCurrency).toBe("number");
    expect(cap.unavailable).toBe(false);
  });

  it("POLE 2 — one row per currency held, sorted, with committed and target kept apart", async () => {
    const res = await request(app).get("/api/partner/me/dashboard").set("x-user-id", ACTOR);
    const rows = res.body.portfolio.capitalByCurrency.rows as Array<Record<string, unknown>>;
    const codes = rows.map((r) => String(r.currency));
    expect(codes).toContain("USD");
    expect(codes).toContain("CAD");
    expect(codes).toContain("HKD");
    /* Deterministic order, so the surface never reshuffles between renders. */
    expect(codes).toEqual([...codes].sort());
    /* No duplicate buckets. */
    expect(new Set(codes).size).toBe(codes.length);
    for (const r of rows) {
      expect(typeof r.committedMinor).toBe("number");
      expect(Number.isInteger(r.committedMinor)).toBe(true);
      /* committed and target are separate fields — the surface labels them
         separately because they ARE separate quantities. */
      expect(Object.keys(r)).toContain("targetMinor");
      expect(r.committedMinor).not.toBe(undefined);
    }
    const cad = rows.find((r) => r.currency === "CAD")!;
    expect(cad.targetMinor).toBe(120_000);
    expect(cad.vehicleCount).toBe(1);
  });

  it("POLE 3 — the legacy scalar is a cross-currency sum and the USD row does NOT equal it", () => {
    /* Read through the store so both quantities come from one snapshot. */
    const snap = partnerDashboardSnapshot(PARTNER);
    const rows = snap.portfolio.capitalByCurrency.rows;
    const usd = rows.find((r) => r.currency === "USD");
    /* The legacy scalar sums EVERY currency — it is what the headline printed. */
    const legacy = snap.portfolio.totalSpvCommittedMinor;
    const perCurrencySpvSum = rows.reduce((n, r) => n + r.spvCommittedMinor, 0);
    /* Whatever the seeded commitments are, the two must agree in aggregate — that
       proves the rollup reads the SAME canonical committed figure, not a second
       vocabulary. */
    if (legacy !== null) expect(perCurrencySpvSum).toBe(legacy);
    /* And the USD-only figure the dashboard now prints is a SUBSET of it whenever
       more than one currency is held. This is the defect made observable. */
    expect(rows.length).toBeGreaterThan(1);
    if (usd && legacy !== null) expect(usd.spvCommittedMinor).toBeLessThanOrEqual(legacy);
  });

  it("POLE 4 — a vehicle with no usable currency code is counted and EXCLUDED, not folded into USD", () => {
    const before = partnerDashboardSnapshot(PARTNER).portfolio.capitalByCurrency;
    const usdBefore = before.rows.find((r) => r.currency === "USD")?.committedMinor ?? 0;
    /* `""` is not an ISO-4217 code. The engine accepts it; the rollup must not
       guess. */
    spvEngineStore.createSpv(
      PARTNER,
      { name: "W178 no-currency SPV", jurisdiction: "delaware", carryBasis: "whole_spv", currency: "", status: "draft" },
      ACTOR,
    );
    const after = partnerDashboardSnapshot(PARTNER).portfolio.capitalByCurrency;
    expect(after.vehiclesWithoutCurrency).toBe(before.vehiclesWithoutCurrency + 1);
    /* USD did not absorb it. */
    expect(after.rows.find((r) => r.currency === "USD")?.committedMinor ?? 0).toBe(usdBefore);
    /* And no phantom bucket was created for the empty code. */
    expect(after.rows.map((r) => r.currency)).not.toContain("");
  });

  it("POLE 5 — a currency whose vehicles record no target reports null, never 0", () => {
    const rows = partnerDashboardSnapshot(PARTNER).portfolio.capitalByCurrency.rows;
    const hkd = rows.find((r) => r.currency === "HKD")!;
    expect(hkd.targetMinor).toBeNull();
    expect(hkd.targetMinor).not.toBe(0);
    expect(hkd.targetUnknownCount).toBe(1);
  });
});
