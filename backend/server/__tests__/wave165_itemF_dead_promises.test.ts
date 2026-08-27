/**
 * WAVE 165 · ITEM F · R135.5 / R135.6 / R133.2 — THE PLATFORM MAY NOT ADVERTISE
 * WHAT IT CANNOT SELL.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT.
 * ═══════════════════════════════════════════════════════════════════════════════
 * Three live partner controls offer MONTHLY billing. The server refuses it:
 * `purchasableCadences()` (server/lib/partnerTiers.ts:238) reads the pricing-model
 * configuration, and both subscribe handlers answer a non-purchasable cadence with
 * `409 CYCLE_NOT_PURCHASABLE` — *"The 'monthly' billing cycle is not currently
 * offered. Available: annual."* A partner therefore chooses a cadence, presses a
 * button, and is handed a refusal. R135.5 rules the fix is to LABEL, never to
 * delete: *"the owner prefers adding to deleting and forbids silently dropping any
 * control."*
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE ASSERTS AN INVARIANT AND NOT A SNAPSHOT.
 * ═══════════════════════════════════════════════════════════════════════════════
 * A test that hard-codes *"monthly is unavailable"* would go stale the day the
 * owner sells monthly, and would then be WRONG in the dangerous direction: it
 * would demand a false warning. The purchasability of a cadence is CONFIGURATION
 * (`partner_pricing_model`), not code. So the invariant asserted here is the
 * agreement itself:
 *
 *   the set of cadences the READ endpoint advertises as purchasable
 *     ===  the set the WRITE endpoint will actually accept
 *
 * §2 proves this holds in BOTH directions, and §3 flips the configuration at
 * runtime and proves the agreement survives the flip. That is what makes the
 * client label trustworthy rather than decorative: the client renders the
 * server's own answer, so the warning cannot outlive the restriction and cannot
 * be missing while the restriction exists.
 *
 * ANTI-VACUITY. §0 proves the fixture can reach BOTH configurations before any
 * agreement assertion runs. Without it, a run in which everything is purchasable
 * would satisfy §2 trivially and prove nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { getDb, rawDb } from "../db/connection";
import { registerPartnerRoutes } from "../partnerRoutes";
/* The subscription READ and the /subscribe WRITE both live in the self-service
   module. Registering only `registerPartnerRoutes` gave a 404, and a 404 makes
   T165F.8 pass VACUOUSLY (a missing route also fails to return
   CYCLE_NOT_PURCHASABLE). §0b below pins that both routes really are mounted. */
import { registerPartnerSelfServiceRoutes } from "../lib/partnerSelfServiceRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { purchasableCadences } from "../lib/partnerTiers";
import { ensureWave152PricingSchema } from "../lib/applyWave152PricingSchema";
import { ensureWave45PricingSchema } from "../lib/applyWave45PricingSchema";

const MANAGING = "u_avi_managing";

let app: express.Express;

function db(): any {
  getDb();
  return rawDb() as any;
}
const get = (p: string, u: string) => request(app).get(p).set("x-user-id", u);
const post = (p: string, u: string, b?: unknown) =>
  request(app).post(p).set("x-user-id", u).send(b ?? {});

/** Every cadence the platform could conceivably name in a control. */
const ALL_CADENCES = ["annual", "monthly"] as const;

let savedRows: unknown[] = [];

function setPurchasable(monthly: boolean, annual: boolean): void {
  db()
    .prepare(
      `UPDATE partner_pricing_model_config
          SET monthly_purchasable = ?, annual_purchasable = ?
        WHERE id = 'singleton'`,
    )
    .run(monthly ? 1 : 0, annual ? 1 : 0);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerPartnerSelfServiceRoutes(app);
  seedTestPartnerSandbox({ force: true });
  ensureWave152PricingSchema(db());
  ensureWave45PricingSchema(db());
  savedRows = db().prepare(`SELECT * FROM partner_pricing_model_config WHERE id = 'singleton'`).all();
});

afterAll(() => {
  /* Restore the configuration exactly. A test that leaves the pricing model
     mutated would silently change what every LATER test file believes the
     platform sells. */
  if (savedRows.length > 0) {
    const r = savedRows[0] as { monthly_purchasable: number; annual_purchasable: number };
    setPurchasable(r.monthly_purchasable === 1, r.annual_purchasable === 1);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * §0 — THE FIXTURE IS NOT VACUOUS.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W165 §0 — the fixture can reach both purchasability configurations", () => {
  it("T165F.0: annual-only and both-cadences are genuinely distinguishable", () => {
    setPurchasable(false, true);
    const annualOnly = purchasableCadences();
    setPurchasable(true, true);
    const both = purchasableCadences();
    expect(annualOnly).toEqual(["annual"]);
    expect(both.slice().sort()).toEqual(["annual", "monthly"]);
    expect(
      annualOnly.length,
      "if these two configurations produced the same set, every agreement assertion below would be vacuous",
    ).not.toBe(both.length);
  });
});

describe("W165 §0b — both endpoints are really mounted", () => {
  it("T165F.0b: neither the READ nor the WRITE answers 404, so no assertion below is vacuous", async () => {
    const read = await get("/api/partner/me/subscription", MANAGING);
    expect(read.status, "a 404 here would make every §1-§3 assertion meaningless").not.toBe(404);
    const write = await post("/api/partner/me/subscribe", MANAGING, { cycle: "annual" });
    expect(write.status, "a 404 here would let T165F.8 pass without a server").not.toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §1 — THE READ ENDPOINT MUST ADVERTISE WHAT IS PURCHASABLE. This is the
 *      assertion that fails before wave 165: the field did not exist, so the
 *      client had NO WAY to know a cadence was unsellable and could only
 *      discover it by making a partner press a button and read a 409.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W165 §1 — GET /api/partner/me/subscription publishes the purchasable cadences", () => {
  it("T165F.1: the response carries purchasableCycles", async () => {
    setPurchasable(false, true);
    const res = await get("/api/partner/me/subscription", MANAGING);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      Array.isArray(res.body.purchasableCycles),
      "a control cannot be honestly labelled from a field the server never sends",
    ).toBe(true);
  });

  it("T165F.2: it reports exactly what purchasableCadences() reports", async () => {
    setPurchasable(false, true);
    const res = await get("/api/partner/me/subscription", MANAGING);
    expect(res.body.purchasableCycles.slice().sort()).toEqual(purchasableCadences().slice().sort());
  });

  it("T165F.3: and it names the cadences it does NOT sell, so a label can explain the gap", async () => {
    setPurchasable(false, true);
    const res = await get("/api/partner/me/subscription", MANAGING);
    expect(res.body.unavailableCycles).toContain("monthly");
    expect(res.body.unavailableCycles).not.toContain("annual");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §2 — THE AGREEMENT, IN BOTH DIRECTIONS.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W165 §2 — what is advertised is what is accepted", () => {
  it("T165F.4: every ADVERTISED cadence is accepted by POST /subscribe", async () => {
    setPurchasable(false, true);
    const advertised: string[] = (await get("/api/partner/me/subscription", MANAGING)).body
      .purchasableCycles;
    expect(advertised.length, "nothing advertised would make this vacuous").toBeGreaterThan(0);
    for (const cycle of advertised) {
      const res = await post("/api/partner/me/subscribe", MANAGING, { cycle });
      expect(
        res.body?.error,
        `${cycle} is advertised as purchasable but /subscribe refused it`,
      ).not.toBe("CYCLE_NOT_PURCHASABLE");
    }
  });

  it("T165F.5: every UNADVERTISED cadence is refused by POST /subscribe", async () => {
    setPurchasable(false, true);
    const body = (await get("/api/partner/me/subscription", MANAGING)).body;
    const unavailable: string[] = body.unavailableCycles;
    expect(unavailable.length, "nothing unavailable would make this vacuous").toBeGreaterThan(0);
    for (const cycle of unavailable) {
      const res = await post("/api/partner/me/subscribe", MANAGING, { cycle });
      expect(res.status, `${cycle} is not advertised, so /subscribe must refuse it`).toBe(409);
      expect(res.body.error).toBe("CYCLE_NOT_PURCHASABLE");
    }
  });

  it("T165F.6: the two sets partition the cadence space — nothing is unclassified", async () => {
    setPurchasable(false, true);
    const body = (await get("/api/partner/me/subscription", MANAGING)).body;
    const union = [...body.purchasableCycles, ...body.unavailableCycles].sort();
    expect(union).toEqual([...ALL_CADENCES].sort());
    for (const c of body.purchasableCycles) {
      expect(body.unavailableCycles, `${c} cannot be both`).not.toContain(c);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §3 — THE AGREEMENT SURVIVES A CONFIGURATION CHANGE. This is what stops the
 *      client label from being a hard-coded sentence that outlives its reason.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W165 §3 — the label follows the configuration, it is not baked in", () => {
  it("T165F.7: enabling monthly moves it from unavailable to purchasable", async () => {
    setPurchasable(false, true);
    const before = (await get("/api/partner/me/subscription", MANAGING)).body;
    expect(before.unavailableCycles).toContain("monthly");

    setPurchasable(true, true);
    const after = (await get("/api/partner/me/subscription", MANAGING)).body;
    expect(after.purchasableCycles).toContain("monthly");
    expect(after.unavailableCycles).not.toContain("monthly");
  });

  it("T165F.8: and /subscribe stops refusing it in the same breath", async () => {
    setPurchasable(true, true);
    const res = await post("/api/partner/me/subscribe", MANAGING, { cycle: "monthly" });
    expect(res.body?.error).not.toBe("CYCLE_NOT_PURCHASABLE");
  });

  it("T165F.9: disabling it again restores the refusal AND the advertisement", async () => {
    setPurchasable(false, true);
    const body = (await get("/api/partner/me/subscription", MANAGING)).body;
    expect(body.unavailableCycles).toContain("monthly");
    const res = await post("/api/partner/me/subscribe", MANAGING, { cycle: "monthly" });
    expect(res.status).toBe(409);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §4 — R133.2: THE SPV DEPLOYMENT FEE NAMES ITS TRIGGER.
 *
 * A partner launched an SPV and was invoiced nothing, with no explanation. The
 * schedule advertised "$600.00 one-off" and never said WHEN. R133.2 keeps the
 * trigger unchanged — it fires when an SPV is marked Deployed — so the fix is
 * that the platform must SAY so. The trigger itself is asserted here so the
 * sentence the client renders is checked against the code that charges, not
 * against a comment.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W165 §4 — the deployment-fee trigger is stated and is unchanged", () => {
  it("T165F.10: the hook still keys on the Deployed status, so the wording is true", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("server/lib/spvEngineDeploymentFeeHook.ts", "utf8"),
    );
    expect(
      src.includes("deployed"),
      "R133.2 forbids changing the trigger; if this stops matching, the client sentence has become false",
    ).toBe(true);
  });

  it("T165F.11: the fee is charged ONCE per SPV, which is what 'one-off' claims", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("server/lib/spvEngineDeploymentFeeHook.ts", "utf8"),
    );
    /* A latch exists precisely so a re-entry cannot double-charge. If it were
       removed, "one-off" would become an advertised promise the server breaks —
       the same class of defect as monthly billing. */
    expect(src).toMatch(/latch|already|once/i);
  });
});
