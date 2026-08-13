/**
 * WAVE 4A — RS-1 / RS-2 restoration proof, plus the three Wave-3 follow-ups.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 * 1. RS-1 — an ADMIN can CREATE, EDIT and EXPIRE a Collective payment schedule
 *    end to end over the real Express stack (Tier-6 supertest, no stubs):
 *      POST   /api/admin/collective-payments/schedules
 *      PATCH  /api/admin/collective-payments/schedules/:id
 *      DELETE /api/admin/collective-payments/schedules/:id
 * 2. RS-2 — the same three verbs for partner fee schedules:
 *      POST   /api/admin/partner-fees
 *      PATCH  /api/admin/partner-fees/:id
 *      DELETE /api/admin/partner-fees/:id
 * 3. WIRING — the restored capability is reachable from a ROUTED page. Before
 *    this wave the endpoints above existed and worked; what was lost was any
 *    caller. So the endpoint tests alone would be green on the BROKEN tree.
 *    The source assertions below are the ones that actually fail on the broken
 *    tree: they require AdminFeesConsolidated.tsx (routed at /admin/fees) to
 *    call all six verbs, and require the two legacy admin URLs to resolve.
 * 4. Follow-up 2 — the server no longer coerces an unknown jurisdiction to
 *    "delaware".
 * 5. Follow-up 3 — computeDistributionSplit reads rates as FRACTIONS only.
 *    (The waterfall arithmetic itself is pinned in wfix1e_spv_core.test.ts.)
 *
 * Follow-up 1 (COMBINED_CARRY_EXCEEDS_CAP → 4xx, not 500) is asserted where the
 * refusal already had a test: wave3b_mc1_cent_conservation.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { computeDistributionSplit } from "../lib/spvOfflineOps";
import { resolveSpvJurisdiction } from "../../shared/spvEngine";

let app: Express;
let server: http.Server;

const ADMIN = (req: request.Test) => req.query({ as: "admin" });
const FOUNDER = (req: request.Test) => req.query({ as: "founder" });

const REPO = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf-8");

const CONSOLIDATED = "client/src/pages/admin/AdminFeesConsolidated.tsx";

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await seedDemoData(getDb());
  await registerRoutes(server, app);
}, 30_000);

afterAll(() => {
  try {
    server?.close();
  } catch {
    /* noop */
  }
});

/* ==========================================================================
 * RS-1 — Collective payment schedules: create → edit → expire
 * ======================================================================== */

describe("WAVE 4A / RS-1 — an admin can create, edit and expire a Collective payment schedule", () => {
  let createdId = "";

  it("POST creates a schedule (201/200) and it appears in the active list", async () => {
    const res = await ADMIN(
      request(app).post("/api/admin/collective-payments/schedules"),
    ).send({
      scopeKind: "tier",
      tier: "premium",
      feeKind: "membership_dues",
      amountMinor: 125_000,
      currency: "USD",
      cadence: "annual",
      effectiveFrom: "2026-08-09T00:00:00.000Z",
    });
    expect(res.status).toBeLessThan(300);
    expect(res.body.ok).toBe(true);
    createdId = String(res.body.schedule?.id ?? res.body.id ?? "");
    expect(createdId).toBeTruthy();

    const list = await ADMIN(
      request(app).get("/api/admin/collective-payments/schedules?includeExpired=false"),
    );
    expect(list.status).toBe(200);
    const row = (list.body.schedules ?? []).find((s: any) => s.id === createdId);
    expect(row).toBeTruthy();
    expect(row.amount_minor).toBe(125_000);
  });

  it("PATCH edits the amount and cadence of the live row", async () => {
    const res = await ADMIN(
      request(app).patch(`/api/admin/collective-payments/schedules/${createdId}`),
    ).send({ amountMinor: 99_000, cadence: "quarterly" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const list = await ADMIN(
      request(app).get("/api/admin/collective-payments/schedules?includeExpired=false"),
    );
    const row = (list.body.schedules ?? []).find((s: any) => s.id === createdId);
    expect(row.amount_minor).toBe(99_000);
    expect(row.cadence).toBe("quarterly");
  });

  it("DELETE expires the row (soft): it leaves the active list", async () => {
    const res = await ADMIN(
      request(app).delete(`/api/admin/collective-payments/schedules/${createdId}`),
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const active = await ADMIN(
      request(app).get("/api/admin/collective-payments/schedules?includeExpired=false"),
    );
    expect((active.body.schedules ?? []).some((s: any) => s.id === createdId)).toBe(false);

    // …but the row itself is preserved (soft expire, reversible history).
    const all = await ADMIN(
      request(app).get("/api/admin/collective-payments/schedules?includeExpired=true"),
    );
    const row = (all.body.schedules ?? []).find((s: any) => s.id === createdId);
    expect(row).toBeTruthy();
    expect(row.effective_to).toBeTruthy();
  });

  it("the writes stay admin-only (a founder cannot create one)", async () => {
    const res = await FOUNDER(
      request(app).post("/api/admin/collective-payments/schedules"),
    ).send({ scopeKind: "platform", feeKind: "late_fee", amountMinor: 100, currency: "USD", cadence: "one_time" });
    expect([401, 403]).toContain(res.status);
  });
});

/* ==========================================================================
 * RS-2 — Partner fee schedules: create → edit → expire
 * ======================================================================== */

describe("WAVE 4A / RS-2 — an admin can create, edit and expire a partner fee schedule", () => {
  let createdId = "";

  it("POST creates a fee schedule and it appears in the active list", async () => {
    const res = await ADMIN(request(app).post("/api/admin/partner-fees")).send({
      feeKind: "subscription_monthly",
      tier: "builder",
      amountMinor: 45_000,
      currency: "USD",
      effectiveFrom: "2026-08-09T00:00:00.000Z",
    });
    expect(res.status).toBeLessThan(300);
    expect(res.body.ok).toBe(true);
    createdId = String(res.body.schedule?.id ?? res.body.id ?? "");
    expect(createdId).toBeTruthy();

    const list = await ADMIN(request(app).get("/api/admin/partner-fees?includeExpired=false"));
    expect(list.status).toBe(200);
    const row = (list.body.schedules ?? []).find((s: any) => s.id === createdId);
    expect(row).toBeTruthy();
    expect(row.amount_minor).toBe(45_000);
  });

  it("PATCH edits the amount of the live row", async () => {
    const res = await ADMIN(request(app).patch(`/api/admin/partner-fees/${createdId}`)).send({
      amountMinor: 39_000,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const list = await ADMIN(request(app).get("/api/admin/partner-fees?includeExpired=false"));
    const row = (list.body.schedules ?? []).find((s: any) => s.id === createdId);
    expect(row.amount_minor).toBe(39_000);
  });

  it("DELETE expires the row (soft): it leaves the active list, history is kept", async () => {
    const res = await ADMIN(request(app).delete(`/api/admin/partner-fees/${createdId}`));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const active = await ADMIN(request(app).get("/api/admin/partner-fees?includeExpired=false"));
    expect((active.body.schedules ?? []).some((s: any) => s.id === createdId)).toBe(false);

    const all = await ADMIN(request(app).get("/api/admin/partner-fees?includeExpired=true"));
    const row = (all.body.schedules ?? []).find((s: any) => s.id === createdId);
    expect(row).toBeTruthy();
    expect(row.effective_to).toBeTruthy();
  });

  it("the writes stay admin-only (a founder cannot create one)", async () => {
    const res = await FOUNDER(request(app).post("/api/admin/partner-fees")).send({
      feeKind: "subscription_monthly", amountMinor: 100, currency: "USD",
    });
    expect([401, 403]).toContain(res.status);
  });
});

/* ==========================================================================
 * THE WIRING — the assertions that fail on the pre-Wave-4A tree
 * ======================================================================== */

describe("WAVE 4A — the restored writes are reachable from a ROUTED page", () => {
  it("RS-1: AdminFeesConsolidated calls the full Collective schedule CRUD", () => {
    const src = readSrc(CONSOLIDATED);
    // this exact grep returned 0 before the wave (spec RS-1 evidence command)
    expect(src.split("collective-payments/schedules").length - 1).toBeGreaterThan(0);
    expect(src).toContain('apiRequest("POST", "/api/admin/collective-payments/schedules"');
    expect(src).toContain('apiRequest("PATCH", `/api/admin/collective-payments/schedules/${row.id}`');
    expect(src).toContain('apiRequest("DELETE", `/api/admin/collective-payments/schedules/${id}`');
  });

  it("RS-2: AdminFeesConsolidated calls the partner fee-schedule WRITES", () => {
    const src = readSrc(CONSOLIDATED);
    expect(src).toContain('apiRequest("POST", "/api/admin/partner-fees"');
    expect(src).toContain('apiRequest("PATCH", `/api/admin/partner-fees/${row.id}`');
    expect(src).toContain('apiRequest("DELETE", `/api/admin/partner-fees/${id}`');
  });

  it("the read-only partner fee count on the Promotions tab is left untouched", () => {
    const src = readSrc(CONSOLIDATED);
    expect(src).toContain('data-testid="partner-fee-schedule-count"');
  });

  it("both legacy admin URLs resolve to the consolidated page, not the 404 catch-all", () => {
    const app_ = readSrc("client/src/App.tsx");
    for (const p of ["/admin/collective-payment-schedules", "/admin/partner-fees"]) {
      expect(app_).toContain(`<Route path="${p}">`);
    }
    // …and they render the ONE consolidated page, deep-linked to the new tab —
    // NOT the orphaned standalone components, which stay unrouted.
    expect(app_).toContain('<AdminFeesConsolidated initialTab="fee-schedules" />');
    expect(app_).not.toContain('from "@/pages/admin/PartnerFeeSchedules"');
    expect(app_).not.toContain('from "@/pages/admin/CollectivePaymentSchedules"');
  });

  it("the sidebar signposts both restored surfaces again, with their original labels", () => {
    const shell = readSrc("client/src/components/AppShell.tsx");
    expect(shell).toContain('href: "/admin/collective-payment-schedules", label: "Collective Payment Schedules"');
    expect(shell).toContain('href: "/admin/partner-fees", label: "Partner Fees"');
  });

  it("the deferral register is EMPTY and neither ticket was allowlisted", () => {
    const reg = JSON.parse(readSrc("scripts/silent-drop-guard/deferrals.json"));
    expect(reg.deferrals).toEqual([]);
    const allow = readSrc("scripts/silent-drop-guard/allowlist.json");
    expect(allow).not.toContain("/admin/partner-fees");
    expect(allow).not.toContain("/admin/collective-payment-schedules");
  });
});

/* ==========================================================================
 * Follow-ups 2 and 3
 * ======================================================================== */

describe("WAVE 4A / follow-up 2 — the server stops inventing Delaware", () => {
  it("no server coercion site hard-codes a delaware fallback any more", () => {
    for (const f of [
      "server/spvEngineStore.ts",
      "server/partnerRoutes.ts",
      "server/lib/partnerFeeAdminRoutes.ts",
    ]) {
      const src = readSrc(f);
      expect(src).not.toContain('isSpvJurisdiction(jurisdiction) ? jurisdiction : "delaware"');
      expect(src).not.toContain('isSpvJurisdiction(b.jurisdiction) ? b.jurisdiction : "delaware"');
      expect(src).not.toContain('isSpvJurisdiction(j) ? j : "delaware"');
      expect(src).toContain("resolveSpvJurisdiction");
    }
  });

  it("the shared resolver — not a US-state guess — decides what unknown input means", () => {
    expect(resolveSpvJurisdiction("Netherlands")).toBe("netherlands");
    expect(resolveSpvJurisdiction("cayman")).toBe("cayman");
    expect(resolveSpvJurisdiction("wakanda")).toBe("other");
    expect(resolveSpvJurisdiction("")).toBe("other");
    expect(resolveSpvJurisdiction(null)).toBe("other");
    // a genuine Delaware vehicle is still Delaware
    expect(resolveSpvJurisdiction("delaware")).toBe("delaware");
  });

  it("server/spvEngineStore.ts:307 stays a VALIDATOR, not a coercion", () => {
    expect(readSrc("server/spvEngineStore.ts")).toContain(
      'if (!isSpvJurisdiction(data.jurisdiction)) throw new Error("INVALID_JURISDICTION")',
    );
  });
});

describe("WAVE 4A / follow-up 3 — computeDistributionSplit takes FRACTIONS only", () => {
  it("frac() no longer guesses between 0.2 and 20", () => {
    expect(readSrc("server/lib/spvOfflineOps.ts")).not.toContain("n > 1 ? n / 100 : n");
  });

  /* WAVE 37 — THE TEST WAS STALE, NOT THE CODE.
   *
   * This case previously asserted that a percent-scale carry SATURATES
   * (`carryPct: 20` -> clamped to 1.0 -> the GP takes the whole profit). That
   * expectation encodes the very behaviour the owner's percent ruling
   * deliberately abolished. `spec/PERCENT_POLICY_v2.md` §1.6 / the P-4 rule
   * recorded at `server/lib/spvOfflineOps.ts:92-108` is explicit: an
   * out-of-domain rate must be **REJECTED, never clamped** — "a wrong number
   * now surfaces as a loud error at the boundary instead of a quiet,
   * plausible, wrong split". `spec/PERCENT_POLICY_v2.md:851` states the
   * `spvOfflineOps.ts` carry site "throws instead of silently clamping".
   * Saturation was the P-4 money defect, not the remedy.
   *
   * The case is therefore re-aimed at the RULED behaviour and STRENGTHENED —
   * it now asserts three things the old one-liner could not distinguish:
   *   (a) the in-domain pole still computes the correct split (so a module
   *       that threw on everything would fail here),
   *   (b) the out-of-domain pole throws the NAMED policy error carrying the
   *       field name and the declared domain — a bare `toThrow()` would pass
   *       against an unrelated crash,
   *   (c) NOTHING is returned — i.e. the clamp cannot come back disguised.
   *       If the code regressed to `Math.min(1, n)` the call would return a
   *       split of 200_000/100_000 and (b) and (c) both fail. */
  it("a percent-scale carry is REJECTED, not saturated (P-4: never clamp)", () => {
    // (a) LOWER POLE — the honest fraction still works, exactly.
    const ok = computeDistributionSplit({
      grossProceedsMinor: 300_000,
      contributedMinor: 100_000,
      carryPct: 0.2,
    });
    expect(ok.gpTotalMinor).toBe(40_000); // 20% of the 200k profit
    expect(ok.lpTotalMinor).toBe(260_000);

    // (b) UPPER POLE — 20 is not 20% and is not 100% either. It is refused.
    let thrown: unknown = null;
    let returned: unknown = "NOTHING_RETURNED";
    try {
      returned = computeDistributionSplit({
        grossProceedsMinor: 300_000,
        contributedMinor: 100_000,
        carryPct: 20,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String((thrown as Error).message)).toContain("PERCENT_FIELD_OUT_OF_DOMAIN");
    expect(String((thrown as Error).message)).toContain("spv.carryPct");
    expect(String((thrown as Error).message)).toContain("[0,1]");

    // (c) THE ANTI-CLAMP POLE — the saturating result must not exist at all.
    expect(returned).toBe("NOTHING_RETURNED");
  });

  /* WAVE 37 — STALE SOURCE-TEXT PIN, live behaviour unchanged.
   *
   * The old assertion demanded the literal `body.hurdleRatePct =
   * parsePercent(hurdle);`. WAVE 10 / EN-5 retired the file-local rival parser
   * and routed the same call through the single canonical
   * `parsePercentInputToFraction`, which takes a field label so the refusal
   * names the field. The call is now `parsePercent(hurdle, "Hurdle rate")` —
   * the SAME quantity, still a fraction, still no `* 100`. Only the literal
   * moved.
   *
   * Re-aimed at the invariant rather than the character sequence, and
   * STRENGTHENED: it now also pins that the canonical parser is what is
   * imported (so a future edit cannot reinstate a local guesser and keep the
   * call site's spelling), and that no `* 100` / `/ 100` rescale sits on the
   * hurdle assignment in either direction. */
  it("the UI sends the FRACTION through the canonical parser — no rescale, either way", () => {
    const src = readSrc("client/src/components/partner/SpvDetailTabs.tsx");

    // The canonical parser is the one in play — not a file-local rival.
    expect(src).toContain("parsePercentInputToFraction");

    // The hurdle assignment exists and goes through it.
    const assign = src.match(/body\.hurdleRatePct\s*=\s*[^;\n]+/);
    expect(assign).not.toBeNull();
    const rhs = assign![0];
    expect(rhs).toContain("parsePercent(hurdle");

    // BOTH poles of the rescale ban: neither multiplying up nor dividing down.
    expect(rhs).not.toMatch(/\*\s*100/);
    expect(rhs).not.toMatch(/\/\s*100/);
    expect(src).not.toContain("parsePercent(hurdle) * 100");
  });
});
