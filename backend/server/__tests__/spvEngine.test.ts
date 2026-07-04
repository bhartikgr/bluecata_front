/**
 * v25.49 Phase-4 — CANONICAL SPV Engine tests (REAL Express routes via supertest).
 *
 * Covers the security + correctness contract of the ONE-store-many-contexts SPV
 * engine (spvEngineStore / spvEngineRoutes):
 *   - GP CRUD + sub-role gating (viewer 403); carry_basis required (no default).
 *   - Cross-partner isolation: a GP can never read another partner's SPV (404,
 *     no existence leak).
 *   - Mandate + FAIL-CLOSED eligibility (a company with no canonical facts is
 *     excluded, never matched on a null).
 *   - Two-layer fees: management is GP-settable; platform via the partner route
 *     is 403 (admin-only) but succeeds via the admin route. Effective-dated
 *     amendment picks the latest fee. Plain investor fee breakdown.
 *   - Unified subscription flow + 3 progressive compliance gates enforced ONLY
 *     at commit (KYC → accreditation → e-sign). Investor register ownership %.
 *   - Deployment writes the SINGLE cap-table ledger line via the sacred
 *     commitFunded path (store never touches the ledger).
 *   - Distribution waterfall computes GP + platform carry off realized gain.
 *   - Distribution-scope visibility contexts: collective_only is FIRST-CLASS
 *     (collective context ONLY, never capavate); network is broad; private is
 *     never broadcast. Admin governance sees everything.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { recordPendingSubscription, activateByPaymentIntent } from "../subscriptionStore";
import { updateCompanyProfile } from "../companyProfileStore";
import { createRound } from "../roundsStore";

const MANAGING = "u_avi_managing";
const VIEWER = "u_avi_viewer";
const ADMIN = "u_admin";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const PARTNER_B = "ac_consortium_partner_spv_iso_b";

let app: express.Express;

function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}
function put(path: string, user: string, body?: unknown) {
  return request(app).put(path).set("x-user-id", user).send(body ?? {});
}
function patch(path: string, user: string, body?: unknown) {
  return request(app).patch(path).set("x-user-id", user).send(body ?? {});
}
function get(path: string, user: string) {
  return request(app).get(path).set("x-user-id", user);
}

/** Create a launched (non-draft) SPV for the test partner and return its id. */
async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name, jurisdiction: "delaware", carryBasis: "whole_spv", status: "open", ...extra,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

let coSeq = 0;
/** Build a company that PASSES fail-closed eligibility (paid subscriber + M&A
 *  profile + active round) and return its id + the ACTIVE round id (carrying an
 *  instrument unless instrument=null, used for the INSTRUMENT_NOT_IN_ROUND test). */
function makeEligibleCompanyWithRound(instrument: string | null = "safe"): { companyId: string; roundId: string } {
  const companyId = `co_ready_${Date.now()}_${coSeq++}`;
  const pi = `pi_${companyId}`;
  recordPendingSubscription({ companyId, tierId: "tier_growth", userId: "u_setup", billingCycle: "annual", paymentIntentId: pi, amountMinor: 100000, currency: "USD" });
  activateByPaymentIntent(pi, { expiresAt: "2099-01-01T00:00:00.000Z" });
  updateCompanyProfile(companyId, { sector: "fintech", stage: "seed", ma_stage: "exploring" }, "u_setup");
  const round = createRound({ companyId, name: "Seed", type: "seed", state: "active", targetAmount: 5000000, instrument, actorUserId: "u_setup" });
  return { companyId, roundId: round.id };
}

/** Give the SPV an open mandate matching the fintech eligible company. */
async function setFintechMandate(spvId: string) {
  const m = await put(`/api/partner/me/spv/${spvId}/mandate`, MANAGING, {
    mode: "open", sector: ["fintech"],
    ruleTree: { op: "and", rules: [{ field: "sector", op: "in", value: ["fintech"] }] },
  });
  expect(m.status).toBe(200);
}

/** Blocker 4 — fully commit an LP (subscribe → verify compliance → e-sign →
 *  `committed`) so its capital counts toward deployment readiness / the
 *  waterfall. Only committed capital is real capital. */
async function commitLp(spvId: string, investorId: string, commitmentMinor: number): Promise<string> {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId, commitmentMinor });
  expect(sub.status).toBe(201);
  await put(`/api/partner/me/compliance/${investorId}`, MANAGING, { kycStatus: "verified", accreditationStatus: "self_certified" });
  const adv = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${sub.body.subscription.id}`, MANAGING, { to: "committed", subscriptionDocRef: `sig_${investorId}` });
  expect(adv.status).toBe(200);
  expect(adv.body.subscription.status).toBe("committed");
  return sub.body.subscription.id as string;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("SPV Engine — GP CRUD + sub-role gating", () => {
  it("managing_partner creates an SPV (carry_basis chosen) → 201", async () => {
    const r = await post("/api/partner/me/spv", MANAGING, {
      name: "Alpha SPV", jurisdiction: "delaware", carryBasis: "per_deployment",
    });
    expect(r.status).toBe(201);
    expect(r.body.spv.carryBasis).toBe("per_deployment");
    expect(r.body.spv.sponsorPartnerId).toBe(PARTNER_A);
    expect(r.body.spv.status).toBe("draft"); // default when not launched
  });

  it("carry_basis is REQUIRED (no default) → 400 CARRY_BASIS_REQUIRED", async () => {
    const r = await post("/api/partner/me/spv", MANAGING, {
      name: "No Carry SPV", jurisdiction: "delaware",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("CARRY_BASIS_REQUIRED");
  });

  it("invalid jurisdiction → 400 INVALID_JURISDICTION", async () => {
    const r = await post("/api/partner/me/spv", MANAGING, {
      name: "Bad Juris", jurisdiction: "atlantis", carryBasis: "whole_spv",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_JURISDICTION");
  });

  it("viewer CANNOT create an SPV → 403", async () => {
    const r = await post("/api/partner/me/spv", VIEWER, {
      name: "Viewer SPV", jurisdiction: "delaware", carryBasis: "whole_spv",
    });
    expect(r.status).toBe(403);
  });

  it("list returns the partner's own SPVs", async () => {
    const r = await get("/api/partner/me/spv", MANAGING);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.spvs)).toBe(true);
    expect(r.body.spvs.some((s: any) => s.name === "Alpha SPV")).toBe(true);
  });

  it("wizard defaults expose GP identity + enums + carry-basis help", async () => {
    const r = await get("/api/partner/me/spv-wizard/defaults", MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.gp.partnerId).toBe(PARTNER_A);
    expect(r.body.enums.carryBases).toContain("per_deployment");
    expect(typeof r.body.carryBasisHelp.per_deployment).toBe("string");
  });
});

describe("SPV Engine — cross-partner isolation (ADVERSARIAL)", () => {
  it("a GP cannot read another partner's SPV → 404 (no leak)", async () => {
    // Partner B owns an SPV created directly in the store.
    const bSpv = spvEngineStore.createSpv(
      PARTNER_B,
      { name: "Partner B SPV", jurisdiction: "cayman", carryBasis: "whole_spv" },
      "u_b_gp",
    );
    const r = await get(`/api/partner/me/spv/${bSpv.id}`, MANAGING);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("SPV_NOT_FOUND");
  });

  it("a GP cannot mutate another partner's SPV → 404", async () => {
    const bSpv = spvEngineStore.createSpv(
      PARTNER_B,
      { name: "Partner B SPV 2", jurisdiction: "bvi", carryBasis: "whole_spv" },
      "u_b_gp",
    );
    const r = await patch(`/api/partner/me/spv/${bSpv.id}`, MANAGING, { name: "hijack" });
    expect(r.status).toBe(404);
  });
});

describe("SPV Engine — mandate + FAIL-CLOSED eligibility", () => {
  it("eligibility is fail-closed for a company with no canonical facts", async () => {
    const id = await createSpv("Mandate SPV");
    const m = await put(`/api/partner/me/spv/${id}/mandate`, MANAGING, {
      mode: "open",
      sector: ["fintech"],
      ruleTree: { op: "and", rules: [{ field: "sector", op: "in", value: ["fintech"] }] },
    });
    expect(m.status).toBe(200);
    const e = await get(`/api/partner/me/spv/${id}/eligibility/co_nonexistent_xyz`, MANAGING);
    expect(e.status).toBe(200);
    expect(e.body.eligible).toBe(false);
    expect(e.body.reasons).toEqual(
      expect.arrayContaining(["NOT_PAID_SUBSCRIBER", "NO_MA_PROFILE", "NO_ACTIVE_ROUND"]),
    );
  });

  it("eligibility on an SPV without a mandate → NO_MANDATE (fail-closed)", async () => {
    const id = await createSpv("No Mandate SPV");
    const e = await get(`/api/partner/me/spv/${id}/eligibility/co_whatever`, MANAGING);
    expect(e.status).toBe(200);
    expect(e.body.eligible).toBe(false);
    expect(e.body.reasons).toContain("NO_MANDATE");
  });
});

describe("SPV Engine — two-layer fees", () => {
  it("management fee is GP-settable; platform fee via partner route is 403", async () => {
    const id = await createSpv("Fee SPV");
    const mgmt = await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
      layer: "management", feeType: "fixed", fixedAmountMinor: 5000,
    });
    expect(mgmt.status).toBe(201);
    const plat = await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
      layer: "platform", feeType: "fixed", fixedAmountMinor: 1000,
    });
    expect(plat.status).toBe(403);
    expect(plat.body.error).toBe("PLATFORM_FEE_ADMIN_ONLY");
  });

  it("plain-language fee breakdown reflects the management fixed fee", async () => {
    const id = await createSpv("Breakdown SPV", { minCheckMinor: 100000 });
    await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
      layer: "management", feeType: "fixed", fixedAmountMinor: 5000,
    });
    const r = await get(`/api/partner/me/spv/${id}/fee-breakdown?commitmentMinor=100000`, MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.breakdown.managementFeeMinor).toBe(5000);
    expect(r.body.breakdown.netDeployedMinor).toBe(95000);
  });

  it("effective-dated amendment: latest management fee wins", async () => {
    const id = await createSpv("Amend SPV");
    await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
      layer: "management", feeType: "fixed", fixedAmountMinor: 5000, effectiveDate: "2026-01-01T00:00:00.000Z",
    });
    await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
      layer: "management", feeType: "fixed", fixedAmountMinor: 8000, effectiveDate: "2026-06-01T00:00:00.000Z",
    });
    const r = await get(`/api/partner/me/spv/${id}/fee-breakdown?commitmentMinor=100000`, MANAGING);
    expect(r.body.breakdown.managementFeeMinor).toBe(8000);
  });

  it("platform fee CAN be set through the admin governance route", async () => {
    const id = await createSpv("Admin Fee SPV");
    const r = await post(`/api/admin/consortium-spv/${id}/platform-fee`, ADMIN, {
      sponsorPartnerId: PARTNER_A, feeType: "carry", carryPct: 0.05,
    });
    expect(r.status).toBe(201);
    expect(r.body.fee.layer).toBe("platform");
  });
});

describe("SPV Engine — subscription flow + 3 compliance gates", () => {
  it("commit is fail-closed through KYC → accreditation → e-sign gates", async () => {
    const id = await createSpv("Sub SPV", { minCheckMinor: 10000 });
    const investorId = "inv_gate_test";
    const sub = await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, {
      investorId, commitmentMinor: 50000, investorPersona: "capavate_investor",
    });
    expect(sub.status).toBe(201);
    const subId = sub.body.subscription.id;

    // No compliance profile yet → KYC gate blocks commit.
    let adv = await patch(`/api/partner/me/spv/${id}/subscriptions/${subId}`, MANAGING, { to: "committed" });
    expect(adv.status).toBe(422);
    expect(adv.body.error).toBe("GATE_KYC_REQUIRED");

    // KYC verified → next gate is accreditation.
    await put(`/api/partner/me/compliance/${investorId}`, MANAGING, { kycStatus: "verified" });
    adv = await patch(`/api/partner/me/spv/${id}/subscriptions/${subId}`, MANAGING, { to: "committed" });
    expect(adv.status).toBe(422);
    expect(adv.body.error).toBe("GATE_ACCREDITATION_REQUIRED");

    // Accreditation self-certified → next gate is e-sign.
    await put(`/api/partner/me/compliance/${investorId}`, MANAGING, { accreditationStatus: "self_certified" });
    adv = await patch(`/api/partner/me/spv/${id}/subscriptions/${subId}`, MANAGING, { to: "committed" });
    expect(adv.status).toBe(422);
    expect(adv.body.error).toBe("GATE_SUBSCRIPTION_ESIGN_REQUIRED");

    // Provide the signed subscription doc ref → commit succeeds.
    adv = await patch(`/api/partner/me/spv/${id}/subscriptions/${subId}`, MANAGING, {
      to: "committed", subscriptionDocRef: "sig_abc123",
    });
    expect(adv.status).toBe(200);
    expect(adv.body.subscription.status).toBe("committed");
  });

  it("below min-check is rejected; investor register computes ownership %", async () => {
    const id = await createSpv("Register SPV", { minCheckMinor: 10000 });
    const low = await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, {
      investorId: "inv_low", commitmentMinor: 5000,
    });
    expect(low.status).toBe(400);
    expect(low.body.error).toBe("BELOW_MIN_CHECK");

    await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, { investorId: "inv_x", commitmentMinor: 30000 });
    await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, { investorId: "inv_y", commitmentMinor: 10000 });
    const detail = await get(`/api/partner/me/spv/${id}`, MANAGING);
    const reg = detail.body.register as Array<{ investorId: string; ownershipPct: number }>;
    const x = reg.find((r) => r.investorId === "inv_x")!;
    expect(x.ownershipPct).toBeCloseTo(0.75, 5);
  });
});

describe("SPV Engine — Blocker 5: deployment readiness gates (ADVERSARIAL)", () => {
  it("no mandate → deployment refused (NO_MANDATE, 404)", async () => {
    const id = await createSpv("NoMandate Deploy SPV");
    const { companyId, roundId } = makeEligibleCompanyWithRound();
    const dep = await post(`/api/partner/me/spv/${id}/deployments`, MANAGING, {
      companyId, companyRoundId: roundId, amountMinor: 100000,
    });
    expect(dep.status).toBe(404);
    expect(dep.body.error).toBe("NO_MANDATE");
  });

  it("ineligible company (no canonical facts) → COMPANY_NOT_ELIGIBLE (409)", async () => {
    const id = await createSpv("Ineligible Deploy SPV");
    await setFintechMandate(id);
    await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, { investorId: "inv_ne", commitmentMinor: 500000 });
    const dep = await post(`/api/partner/me/spv/${id}/deployments`, MANAGING, {
      companyId: "co_no_facts_xyz", companyRoundId: "rnd_whatever", amountMinor: 100000,
    });
    expect(dep.status).toBe(409);
    expect(dep.body.error).toBe("COMPANY_NOT_ELIGIBLE");
  });

  it("companyRoundId not an ACTIVE round → NO_ACTIVE_ROUND (409)", async () => {
    const id = await createSpv("BadRound Deploy SPV");
    await setFintechMandate(id);
    const { companyId } = makeEligibleCompanyWithRound(); // company IS eligible…
    await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, { investorId: "inv_br", commitmentMinor: 500000 });
    const dep = await post(`/api/partner/me/spv/${id}/deployments`, MANAGING, {
      companyId, companyRoundId: "rnd_not_a_real_round", amountMinor: 100000, // …but this round id isn't active
    });
    expect(dep.status).toBe(409);
    expect(dep.body.error).toBe("NO_ACTIVE_ROUND");
  });

  it("committed LP capital below deployment amount → INSUFFICIENT_COMMITTED_CAPITAL (409)", async () => {
    const id = await createSpv("Underfunded Deploy SPV", { minCheckMinor: 1000 });
    await setFintechMandate(id);
    const { companyId, roundId } = makeEligibleCompanyWithRound();
    await commitLp(id, "inv_uf", 50000); // only 50000 is COMMITTED capital
    const dep = await post(`/api/partner/me/spv/${id}/deployments`, MANAGING, {
      companyId, companyRoundId: roundId, amountMinor: 500000, // exceeds committed 50000
    });
    expect(dep.status).toBe(409);
    expect(dep.body.error).toBe("INSUFFICIENT_COMMITTED_CAPITAL");
  });

  it("wire-funded-but-UNCOMMITTED capital does NOT satisfy readiness → INSUFFICIENT_COMMITTED_CAPITAL (409)", async () => {
    const id = await createSpv("Uncommitted Deploy SPV", { minCheckMinor: 1000 });
    await setFintechMandate(id);
    const { companyId, roundId } = makeEligibleCompanyWithRound();
    // Subscribe + advance to wire_funded, but NEVER commit — must not count.
    const sub = await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, { investorId: "inv_wfu", commitmentMinor: 500000 });
    expect(sub.status).toBe(201);
    const wf = await patch(`/api/partner/me/spv/${id}/subscriptions/${sub.body.subscription.id}`, MANAGING, { to: "wire_funded" });
    expect(wf.status).toBe(200);
    const dep = await post(`/api/partner/me/spv/${id}/deployments`, MANAGING, {
      companyId, companyRoundId: roundId, amountMinor: 100000, // < 500000 wired, but 0 COMMITTED
    });
    expect(dep.status).toBe(409);
    expect(dep.body.error).toBe("INSUFFICIENT_COMMITTED_CAPITAL");
  });

  it("round carries no instrument → INSTRUMENT_NOT_IN_ROUND (409)", async () => {
    const id = await createSpv("NoInstrument Deploy SPV");
    await setFintechMandate(id);
    const { companyId, roundId } = makeEligibleCompanyWithRound(null); // active round, no instrument
    await commitLp(id, "inv_ni", 500000); // committed capital covers the amount
    const dep = await post(`/api/partner/me/spv/${id}/deployments`, MANAGING, {
      companyId, companyRoundId: roundId, amountMinor: 100000,
    });
    expect(dep.status).toBe(409);
    expect(dep.body.error).toBe("INSTRUMENT_NOT_IN_ROUND");
  });
});

/** Build a fully-ready deployment advanced to `wired` (founder-confirmed +
 *  wired), instrument sourced from the round. Docs are added at the SPV level
 *  unless withDocs=false (to exercise the DOCS_REQUIRED commit gate). */
async function buildWiredDeployment(name: string, withDocs = true): Promise<{ spvId: string; depId: string }> {
  const spvId = await createSpv(name, { minCheckMinor: 1000 });
  await setFintechMandate(spvId);
  const { companyId, roundId } = makeEligibleCompanyWithRound("safe");
  // Blocker 4 — the LP must be COMMITTED for its capital to satisfy readiness.
  await commitLp(spvId, "inv_wd", 500000);
  const dep = await post(`/api/partner/me/spv/${spvId}/deployments`, MANAGING, {
    companyId, companyRoundId: roundId, amountMinor: 500000,
  });
  expect(dep.status).toBe(201);
  expect(dep.body.deployment.instrument).toBe("safe"); // sourced from the round, never the client
  const depId = dep.body.deployment.id as string;
  if (withDocs) {
    await post(`/api/partner/me/spv/${spvId}/documents`, MANAGING, { docType: "subscription", storageKey: "s3://sub.pdf" });
  }
  await patch(`/api/partner/me/spv/${spvId}/deployments/${depId}`, MANAGING, { to: "founder_confirmed" });
  // Blocker 2 — `wired` requires a REAL payment ref (money actually moved).
  await patch(`/api/partner/me/spv/${spvId}/deployments/${depId}`, MANAGING, { to: "wired", wirePaymentRef: "wire_ref_001", closingDocRef: "closing_001" });
  return { spvId, depId };
}

describe("SPV Engine — Blocker 2: cap-table ledger commit is FAIL-CLOSED", () => {
  it("full readiness + wired + founder-confirmed + docs → commits ONE ledger line", async () => {
    const { spvId, depId } = await buildWiredDeployment("Deploy Happy SPV");
    const commit = await post(`/api/partner/me/spv/${spvId}/deployments/${depId}/commit`, MANAGING, { shares: "1000" });
    expect(commit.status).toBe(200);
    expect(commit.body.deployment.status).toBe("deployed");
    expect(commit.body.deployment.capTableLedgerRef).toBeTruthy();
    expect(commit.body.ledger.hash).toBeTruthy();
  });

  it("commit before wired (pending) → 409 DEPLOYMENT_NOT_WIRED", async () => {
    const spvId = await createSpv("Deploy Pending SPV", { minCheckMinor: 1000 });
    await setFintechMandate(spvId);
    const { companyId, roundId } = makeEligibleCompanyWithRound("safe");
    await commitLp(spvId, "inv_p", 500000);
    const dep = await post(`/api/partner/me/spv/${spvId}/deployments`, MANAGING, {
      companyId, companyRoundId: roundId, amountMinor: 500000,
    });
    const commit = await post(`/api/partner/me/spv/${spvId}/deployments/${dep.body.deployment.id}/commit`, MANAGING, { shares: "1000" });
    expect(commit.status).toBe(409);
    expect(commit.body.error).toBe("DEPLOYMENT_NOT_WIRED");
  });

  it("wired but NO closing docs → 409 DOCS_REQUIRED", async () => {
    const { spvId, depId } = await buildWiredDeployment("Deploy NoDocs SPV", false);
    const commit = await post(`/api/partner/me/spv/${spvId}/deployments/${depId}/commit`, MANAGING, { shares: "1000" });
    expect(commit.status).toBe(409);
    expect(commit.body.error).toBe("DOCS_REQUIRED");
  });

  it("double-commit is idempotent-safe → 409 ALREADY_COMMITTED", async () => {
    const { spvId, depId } = await buildWiredDeployment("Deploy Double SPV");
    const first = await post(`/api/partner/me/spv/${spvId}/deployments/${depId}/commit`, MANAGING, { shares: "1000" });
    expect(first.status).toBe(200);
    const second = await post(`/api/partner/me/spv/${spvId}/deployments/${depId}/commit`, MANAGING, { shares: "1000" });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("ALREADY_COMMITTED");
  });

  it("commit with malformed shares → 400 INVALID_SHARES", async () => {
    const { spvId, depId } = await buildWiredDeployment("Deploy BadShares SPV");
    const commit = await post(`/api/partner/me/spv/${spvId}/deployments/${depId}/commit`, MANAGING, { shares: "12.5" });
    expect(commit.status).toBe(400);
    expect(commit.body.error).toBe("INVALID_SHARES");
  });

  it("Blocker 2 — advancing to `wired` WITHOUT a payment ref is rejected (fail-closed)", async () => {
    const spvId = await createSpv("Deploy NoWireRef SPV", { minCheckMinor: 1000 });
    await setFintechMandate(spvId);
    const { companyId, roundId } = makeEligibleCompanyWithRound("safe");
    await commitLp(spvId, "inv_nwr", 500000);
    const dep = await post(`/api/partner/me/spv/${spvId}/deployments`, MANAGING, { companyId, companyRoundId: roundId, amountMinor: 500000 });
    const depId = dep.body.deployment.id as string;
    await post(`/api/partner/me/spv/${spvId}/documents`, MANAGING, { docType: "subscription", storageKey: "s3://sub.pdf" });
    await patch(`/api/partner/me/spv/${spvId}/deployments/${depId}`, MANAGING, { to: "founder_confirmed" });
    // No wirePaymentRef → wired transition must fail closed; status stays not-wired.
    const wired = await patch(`/api/partner/me/spv/${spvId}/deployments/${depId}`, MANAGING, { to: "wired" });
    expect(wired.status).toBe(409);
    expect(wired.body.error).toBe("WIRE_PAYMENT_REF_REQUIRED");
    // …and the commit is refused (never wired, no funding proof persisted).
    const commit = await post(`/api/partner/me/spv/${spvId}/deployments/${depId}/commit`, MANAGING, { shares: "1000" });
    expect(commit.status).toBe(409);
    expect(commit.body.error).toBe("DEPLOYMENT_NOT_WIRED");
  });

  it("Blocker 2 — a successful wire PERSISTS the payment ref on the deployment", async () => {
    const { spvId, depId } = await buildWiredDeployment("Deploy WireRef SPV");
    const detail = await get(`/api/partner/me/spv/${spvId}`, MANAGING);
    const dep = (detail.body.deployments as Array<{ id: string; wirePaymentRef: string | null; closingDocRef: string | null }>).find((d) => d.id === depId)!;
    expect(dep.wirePaymentRef).toBe("wire_ref_001");
    expect(dep.closingDocRef).toBe("closing_001");
  });
});

describe("SPV Engine — distribution waterfall + carry", () => {
  it("computes GP carry off realized gain at the management carry rate", async () => {
    const id = await createSpv("Dist SPV", { minCheckMinor: 1000 });
    await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
      layer: "management", feeType: "carry", carryPct: 0.2,
    });
    await commitLp(id, "inv_lp1", 100000); // Blocker 4 — only committed LPs allocate
    const r = await post(`/api/partner/me/spv/${id}/distributions`, MANAGING, {
      event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 0,
    });
    expect(r.status).toBe(201);
    expect(r.body.distribution.gpCarryMinor).toBe(200000);
    expect(Array.isArray(r.body.distribution.waterfall)).toBe(true);
  });
});

describe("SPV Engine — distribution-scope visibility contexts", () => {
  it("collective_only appears in the collective context but NEVER in capavate", async () => {
    await createSpv("Collective Only SPV", { distributionScope: "collective_only" });
    const coll = await get("/api/collective/spvs", MANAGING);
    const cap = await get("/api/capavate/spvs", MANAGING);
    expect(coll.status).toBe(200);
    expect(cap.status).toBe(200);
    expect(coll.body.spvs.some((s: any) => s.name === "Collective Only SPV")).toBe(true);
    expect(cap.body.spvs.some((s: any) => s.name === "Collective Only SPV")).toBe(false);
  });

  it("network scope is visible in BOTH broad contexts", async () => {
    await createSpv("Network SPV", { distributionScope: "network" });
    const coll = await get("/api/collective/spvs", MANAGING);
    const cap = await get("/api/capavate/spvs", MANAGING);
    expect(coll.body.spvs.some((s: any) => s.name === "Network SPV")).toBe(true);
    expect(cap.body.spvs.some((s: any) => s.name === "Network SPV")).toBe(true);
  });

  it("private scope is never broadcast to a discovery context", async () => {
    await createSpv("Private SPV", { distributionScope: "private" });
    const cap = await get("/api/capavate/spvs", MANAGING);
    expect(cap.body.spvs.some((s: any) => s.name === "Private SPV")).toBe(false);
  });

  it("admin governance sees every SPV across partners (incl. draft)", async () => {
    const r = await get("/api/admin/consortium-spv", ADMIN);
    expect(r.status).toBe(200);
    // Both partner A and partner B SPVs are present in the admin view.
    const sponsors = new Set(r.body.spvs.map((s: any) => s.sponsorPartnerId));
    expect(sponsors.has(PARTNER_A)).toBe(true);
    expect(sponsors.has(PARTNER_B)).toBe(true);
  });
});
