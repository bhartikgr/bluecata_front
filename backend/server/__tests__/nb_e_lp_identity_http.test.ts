/**
 * NUMBERS BAND · WAVE E (W328) — THE PLATFORM STOPPED THROWING AWAY AN LP'S NAME.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. One live LP appeared on the GP's LP Roster as the placeholder
 * "Pending member" and on the same GP's Fund Register as
 * "Reference MARK INVEST PARTNERS". Both screens were reading ONE subscription
 * row whose `investor_id` literally holds the string "Mark Invest Partners".
 * `resolveDisplayName` cannot resolve a token that is not a user id, so its
 * `humanizeFallback` replaced a readable name with a placeholder — DISCARDING A
 * VALUE IT HAD JUST BEEN HANDED. The LP Roster was the defective screen; the Fund
 * Register was merely shouting and mislabelling a correct name.
 *
 * ── POLE ORDER IS DELIBERATE. THE PRIVACY CONTROL IS PROVED FIRST. ──────────
 * §1 is the CONTROL and it runs before any pole that asserts a name appears. If
 * `lpVisibility` were weakened by this wave, §1 fails and the "the name renders"
 * poles below become irrelevant. §1 also asserts the DISAGREEMENT — the same
 * vehicle flipped to `co_investors` DOES disclose the co-investor — so a §1 pass
 * cannot be produced by an LP roster that shows nobody anything.
 *
 * ── ANTI-VACUITY, PER RULE 4 AND RULE 5 ─────────────────────────────────────
 * Every pole asserts its own preconditions before its claim: HTTP 200, the row
 * count, and the STORED `spv_subscription.investor_id` read straight out of
 * `rawDb()` — because a fixture that does not actually contain a name-shaped id
 * cannot distinguish the fix from the defect. Nothing here asserts through a
 * normalising helper: the expected strings are literals, and `investorRealDisplayName`
 * is never called inside an assertion about what it produced.
 *
 * ── MONEY, PER RULE 13 ──────────────────────────────────────────────────────
 * §5 pins the amounts, statuses, stage labels and the confirmed/soft-circled
 * split on both surfaces across a USD and a JPY vehicle, and asserts NO
 * cross-currency total appears. This wave touches display names; if a single
 * minor unit or currency moves, that is a failure of this wave regardless of the
 * names being right.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes, buildPartnerLpRosterPayload } from "../spvEngineRoutes";
import { registerPartnerWorkspaceV19Routes } from "../partnerWorkspaceV19Store";
import { registerPartnerExportRoutes } from "../partnerExportRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import { __setRuntimePersona } from "../lib/userContext";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const ACTOR_A = "u_avi_managing";

/** The live shape: a firm's NAME sitting in the id column. */
const NAME_IN_ID = "Nimbus Capital Partners";
/** A genuine storage id — must NEVER be printed as a name. */
const REAL_ID_LP = "u_nbe_lp_viewer";
/** A single-token value: the DECLARED FALSE NEGATIVE, asserted as such. */
const SINGLE_TOKEN = "Blackstone";

let app: express.Express;
let fundUsd = "";
let fundJpy = "";

function createFundBody(name: string, currency: string) {
  return {
    fundName: name,
    fundType: "closed_end",
    jurisdiction: "delaware",
    vintage: 2026,
    currency,
    status: "raising",
    signoffLegalName: "Managing Partner",
    signoffAccepted: true,
  };
}

async function createFund(name: string, currency: string): Promise<string> {
  const res = await request(app)
    .post("/api/partner/me/funds")
    .set("x-user-id", ACTOR_A)
    .send(createFundBody(name, currency));
  expect(res.status).toBe(201);
  const id = (res.body?.fund?.id ?? res.body?.spv?.id) as string;
  expect(typeof id).toBe("string");
  expect(id.length).toBeGreaterThan(0);
  return id;
}

function asPartner(r: request.Test): request.Test {
  return r.set("x-user-id", ACTOR_A).set("x-actor-user-id", ACTOR_A).set("x-role", "partner");
}

/** The STORED id for a subscription, straight out of SQLite. Rule 3. */
function storedInvestorIds(spvId: string): string[] {
  return (
    rawDb()
      .prepare(`SELECT investor_id FROM spv_subscription WHERE spv_id = ? ORDER BY rowid`)
      .all(spvId) as Array<{ investor_id: string }>
  ).map((r) => r.investor_id);
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerPartnerWorkspaceV19Routes(app);
  registerPartnerExportRoutes(app);
  seedTestPartnerSandbox({ force: true });

  /* The LP viewer needs a real authenticated identity, because the investor-context
     roster route reads the SESSION and would otherwise answer 401 — a 401 would
     make §1's "the co-investor is hidden" pass for the wrong reason. */
  __setRuntimePersona({
    userId: REAL_ID_LP,
    email: `${REAL_ID_LP}@nbe.test`,
    name: "NBE Roster Viewer",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });

  fundUsd = await createFund("NB-E USD Fund", "USD");
  fundJpy = await createFund("NB-E JPY Fund", "JPY");

  spvEngineStore.subscribe(PARTNER_A, fundUsd, { investorId: REAL_ID_LP, commitmentMinor: 500000 }, ACTOR_A);
  spvEngineStore.subscribe(PARTNER_A, fundUsd, { investorId: NAME_IN_ID, commitmentMinor: 250000 }, ACTOR_A);
  spvEngineStore.subscribe(PARTNER_A, fundUsd, { investorId: SINGLE_TOKEN, commitmentMinor: 125000 }, ACTOR_A);
  spvEngineStore.subscribe(PARTNER_A, fundJpy, { investorId: NAME_IN_ID, commitmentMinor: 3000000 }, ACTOR_A);
});

describe("NB-E §0 — PRECONDITIONS: the fixture reproduces the live data shape", () => {
  it("stores a firm NAME inside spv_subscription.investor_id, verbatim", () => {
    const ids = storedInvestorIds(fundUsd);
    expect(ids.length).toBe(3);
    /* If this ever fails, every pole below is void: the fixture would no longer be
       able to tell the fix from the defect (rule 4, mechanism #10). */
    expect(ids).toContain(NAME_IN_ID);
    expect(ids).toContain(REAL_ID_LP);
    expect(ids).toContain(SINGLE_TOKEN);
    expect(storedInvestorIds(fundJpy)).toEqual([NAME_IN_ID]);
  });

  it("the vehicles are distinct currencies and neither is defaulted", () => {
    expect(spvEngineStore.getSpv(PARTNER_A, fundUsd)?.currency).toBe("USD");
    expect(spvEngineStore.getSpv(PARTNER_A, fundJpy)?.currency).toBe("JPY");
  });
});

describe("NB-E §1 — CONTROL, RUN FIRST: lpVisibility still decides who is disclosed", () => {
  it("own_only HIDES the co-investor's name AND id from an LP viewer", async () => {
    spvEngineStore.updateSpv(PARTNER_A, fundUsd, { lpVisibility: "own_only" }, ACTOR_A);
    expect(spvEngineStore.getSpv(PARTNER_A, fundUsd)?.lpVisibility).toBe("own_only");

    const res = await request(app).get(`/api/spv/${fundUsd}/lp-roster`).set("x-user-id", REAL_ID_LP);
    expect(res.status).toBe(200); // not a 401/500 — the refusal must be the PRIVACY rule
    expect(res.body.lpVisibility).toBe("own_only");
    expect(res.body.entries.length).toBe(1);
    expect(res.body.entries[0].investorId).toBe(REAL_ID_LP);

    /* The whole serialised payload, not just the fields this wave knows about: if
       any future key carried the co-investor's name it would be caught here. */
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain(NAME_IN_ID);
    expect(wire).not.toContain(SINGLE_TOKEN);
    expect(wire.toLowerCase()).not.toContain("nimbus");
  });

  it("co_investors DOES disclose the co-investor — the control disagrees with itself on purpose", async () => {
    spvEngineStore.updateSpv(PARTNER_A, fundUsd, { lpVisibility: "co_investors" }, ACTOR_A);
    const res = await request(app).get(`/api/spv/${fundUsd}/lp-roster`).set("x-user-id", REAL_ID_LP);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBe(3);
    expect(JSON.stringify(res.body)).toContain(NAME_IN_ID);
  });

  it("own_only hides it again after the flip — the gate is the setting, not the request order", async () => {
    spvEngineStore.updateSpv(PARTNER_A, fundUsd, { lpVisibility: "own_only" }, ACTOR_A);
    const res = await request(app).get(`/api/spv/${fundUsd}/lp-roster`).set("x-user-id", REAL_ID_LP);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain(NAME_IN_ID);
    /* Restored to the live vehicle's setting for the poles below, which are all
       GP-context routes and therefore unaffected by it either way. */
    spvEngineStore.updateSpv(PARTNER_A, fundUsd, { lpVisibility: "co_investors" }, ACTOR_A);
  });

  it("a non-LP is still refused outright", async () => {
    __setRuntimePersona({
      userId: "u_nbe_stranger",
      email: "u_nbe_stranger@nbe.test",
      name: "NBE Stranger",
      isFounder: false,
      isInvestor: true,
      isAdmin: false,
      hasInvitations: false,
    });
    const res = await request(app).get(`/api/spv/${fundUsd}/lp-roster`).set("x-user-id", "u_nbe_stranger");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).not.toContain(NAME_IN_ID);
  });
});

describe("NB-E §2 — THE LP ROSTER RENDERS THE NAME THAT IS IN THE DATA", () => {
  it("GP roster route returns the stored firm name, not the placeholder", async () => {
    const res = await asPartner(request(app).get(`/api/partner/me/spv/${fundUsd}/lp-roster`));
    expect(res.status).toBe(200);
    const byId = new Map<string, { name: string | null }>(
      (res.body.subscribers as Array<{ investorId: string; name: string | null }>).map((s) => [s.investorId, s]),
    );
    expect(byId.size).toBe(3);
    expect(byId.get(NAME_IN_ID)?.name).toBe(NAME_IN_ID);
    /* The exact placeholder this wave removed, named as a literal. */
    expect(byId.get(NAME_IN_ID)?.name).not.toBe("Pending member");
  });

  it("a genuine u_ id is STILL never printed as a name — the resolver's guarantee is intact", async () => {
    const res = await asPartner(request(app).get(`/api/partner/me/spv/${fundUsd}/lp-roster`));
    const row = (res.body.subscribers as Array<{ investorId: string; name: string | null }>).find(
      (s) => s.investorId === REAL_ID_LP,
    );
    expect(row).toBeTruthy();
    expect(row!.name).not.toBe(REAL_ID_LP);
    expect(String(row!.name ?? "")).not.toContain("u_");
  });

  it("where no honest name exists, the honest placeholder still shows — never blank, never the token", async () => {
    const res = await asPartner(request(app).get(`/api/partner/me/spv/${fundUsd}/lp-roster`));
    const row = (res.body.subscribers as Array<{ investorId: string; name: string | null }>).find(
      (s) => s.investorId === SINGLE_TOKEN,
    );
    expect(row).toBeTruthy();
    /* DECLARED LIMIT, ASSERTED RATHER THAN HIDDEN: a one-word value is not proven
       to be a name, so it is deliberately NOT promoted. The cell is still a plain
       readable phrase and never empty. */
    expect(row!.name).toBe("Pending member");
    expect(String(row!.name)).not.toHaveLength(0);
  });

  it("the payload's own privacy field is untouched by this wave", async () => {
    const res = await asPartner(request(app).get(`/api/partner/me/spv/${fundUsd}/lp-roster`));
    expect(res.body.lpVisibility).toBe(spvEngineStore.getSpv(PARTNER_A, fundUsd)?.lpVisibility);
  });
});

describe("NB-E §3 — THE FUND REGISTER AND THE LP ROSTER NOW NAME ONE ROW THE SAME WAY", () => {
  it("the fund detail route carries investorName additively", async () => {
    const res = await asPartner(request(app).get(`/api/partner/me/funds/${fundUsd}`));
    expect(res.status).toBe(200);
    const rows = res.body.commitments as Array<{
      investorId: string;
      investorName: string | null;
      commitmentMinor: number;
      ownershipPct: number;
    }>;
    expect(rows.length).toBe(3);
    const named = rows.find((r) => r.investorId === NAME_IN_ID);
    expect(named?.investorName).toBe(NAME_IN_ID);
    /* Additive: every pre-existing key is still on every row. */
    for (const r of rows) {
      expect(typeof r.investorId).toBe("string");
      expect(typeof r.commitmentMinor).toBe("number");
      expect(typeof r.ownershipPct).toBe("number");
    }
    /* No honest name → null, so the SCREEN keeps its own floor. Never a
       placeholder word smuggled through the wire. */
    const unnamed = rows.find((r) => r.investorId === SINGLE_TOKEN);
    expect(unnamed?.investorName).toBeNull();
    const idRow = rows.find((r) => r.investorId === REAL_ID_LP);
    expect(idRow?.investorName === null || idRow?.investorName !== REAL_ID_LP).toBe(true);
  });

  it("the two GP surfaces agree, row for row — the actual defect", async () => {
    const roster = await asPartner(request(app).get(`/api/partner/me/spv/${fundUsd}/lp-roster`));
    const fund = await asPartner(request(app).get(`/api/partner/me/funds/${fundUsd}`));
    expect(roster.status).toBe(200);
    expect(fund.status).toBe(200);
    const rosterName = new Map(
      (roster.body.subscribers as Array<{ investorId: string; name: string | null }>).map((s) => [s.investorId, s.name]),
    );
    const fundName = new Map(
      (fund.body.commitments as Array<{ investorId: string; investorName: string | null }>).map((c) => [
        c.investorId,
        c.investorName,
      ]),
    );
    expect(fundName.size).toBeGreaterThan(0);
    /* Wherever the register holds a name, the roster shows THAT name. Before this
       wave the roster said "Pending member" while the register said the firm. */
    for (const [id, name] of fundName) {
      if (name !== null) expect(rosterName.get(id)).toBe(name);
    }
  });

  it("commitmentsSplit is byte-unchanged in shape — no investorName leaked into the money split", async () => {
    const res = await asPartner(request(app).get(`/api/partner/me/funds/${fundUsd}`));
    expect(res.body.commitmentsSplit).toBeTruthy();
    expect(JSON.stringify(res.body.commitmentsSplit)).not.toContain("investorName");
  });
});

describe("NB-E §4 — THE CSV EXPORT AGREES WITH THE SCREEN (it shares the builder)", () => {
  it("the roster CSV carries the real name, not the placeholder", async () => {
    const res = await asPartner(request(app).get(`/api/partner/me/spv/${fundUsd}/lp-roster.csv`));
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(0);
    expect(res.text).toContain(NAME_IN_ID);
    /* The row for the one-word token still reads the honest placeholder, so the
       file and the screen say the same thing about the same row. */
    expect(res.text).toContain("Pending member");
  });

  it("the exported payload is the same builder the screen calls", () => {
    const spv = spvEngineStore.getSpv(PARTNER_A, fundUsd)!;
    const payload = buildPartnerLpRosterPayload(PARTNER_A, fundUsd, spv);
    const names = (payload.subscribers as Array<{ investorId: string; name: string | null }>);
    expect(names.length).toBe(3);
    expect(names.find((s) => s.investorId === NAME_IN_ID)?.name).toBe(NAME_IN_ID);
  });
});

describe("NB-E §5 — MONEY AND CURRENCY DID NOT MOVE", () => {
  it("every amount, stage and split value is exactly what was subscribed (USD)", async () => {
    const roster = await asPartner(request(app).get(`/api/partner/me/spv/${fundUsd}/lp-roster`));
    const subs = roster.body.subscribers as Array<{
      investorId: string;
      commitmentMinor: number;
      status: string;
      stageLabel: string;
      isConfirmedCapital: boolean;
    }>;
    const amounts = new Map(subs.map((s) => [s.investorId, s.commitmentMinor]));
    expect(amounts.get(REAL_ID_LP)).toBe(500000);
    expect(amounts.get(NAME_IN_ID)).toBe(250000);
    expect(amounts.get(SINGLE_TOKEN)).toBe(125000);
    for (const s of subs) {
      expect(s.isConfirmedCapital).toBe(false);
      expect(s.stageLabel.length).toBeGreaterThan(0);
    }
    expect(roster.body.split.confirmedCapitalMinor).toBe(0);
    expect(roster.body.split.softCircledInterestMinor).toBe(875000);
    expect(roster.body.split.allStagesMinor).toBe(875000);
  });

  it("the JPY vehicle keeps its own currency and its own denominator — nothing summed across currencies", async () => {
    const roster = await asPartner(request(app).get(`/api/partner/me/spv/${fundJpy}/lp-roster`));
    expect(roster.status).toBe(200);
    expect(roster.body.split.allStagesMinor).toBe(3000000);
    const fund = await asPartner(request(app).get(`/api/partner/me/funds/${fundJpy}`));
    expect(fund.body.fund.currency).toBe("JPY");
    const rows = fund.body.commitments as Array<{ investorId: string; investorName: string | null; commitmentMinor: number }>;
    expect(rows.length).toBe(1);
    expect(rows[0].commitmentMinor).toBe(3000000);
    /* The SAME name resolves in a non-USD vehicle: the chain is currency-blind, as
       it must be, and it did not fall back to a USD-shaped assumption. */
    expect(rows[0].investorName).toBe(NAME_IN_ID);
    /* And the USD figures are nowhere in this vehicle's payload. */
    expect(roster.body.split.allStagesMinor).not.toBe(875000);
  });

  it("the STORED rows are unchanged by any read — rawDb, not the instrument", () => {
    const rows = rawDb()
      .prepare(`SELECT investor_id, commitment_minor, currency FROM spv_subscription WHERE spv_id = ? ORDER BY rowid`)
      .all(fundUsd) as Array<{ investor_id: string; commitment_minor: number; currency: string | null }>;
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.commitment_minor).reduce((a, b) => a + b, 0)).toBe(875000);
    /* THE OWNER DECISION, PINNED AS EVIDENCE: this wave did NOT migrate the data.
       The name is still stored in the id column, exactly as it was found. */
    expect(rows.some((r) => r.investor_id === NAME_IN_ID)).toBe(true);
  });
});
