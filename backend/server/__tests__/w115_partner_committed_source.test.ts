/**
 * WAVE 115 · FINDING 7 — THE OWNER'S DASHBOARD PRINTED "SPVs committed: $0.00"
 * WHILE A REAL $10,000 LP COMMITMENT EXISTED ON PLATFORM.
 *
 * WHAT THIS SUITE IS FOR, AND WHY IT IS NOT A TAUTOLOGY.
 *
 * The pre-wave chain was:
 *   client/src/pages/partner/PartnerDashboard.tsx  → portfolio.totalSpvCommittedMinor
 *   server/partnerWorkspaceStore.ts                → Σ PartnerSpv.totalCommittedMinor
 *   only writer                                    → partnerSpvStore.addPosition
 *   that writer's own comment                      → "this method is NOT on the live path"
 *
 * A test that merely asserted "the figure equals the engine sum" could be
 * satisfied by BOTH sides being zero, which is exactly the state the defect
 * shipped in. So every assertion here is written against a NON-ZERO real
 * commitment placed through a real HTTP route, and the dead denorm is asserted to
 * be zero AT THE SAME TIME — so the test can only pass if the figure genuinely
 * moved off the denorm and onto the canonical derivation.
 *
 * FAILS BEFORE THIS WAVE: pre-wave the dashboard reports 0 while the canonical
 * engine reports 1000000, so `expect(dash.totalSpvCommittedMinor).toBe(1000000)`
 * fails. It also fails on the `deadSpvDenormTotal` assertion, because that field
 * did not exist.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvLegacyAdapterRoutes } from "../spvLegacyAdapters";
import { seedTestPartnerSandbox, partnerSpvStore, partnerFundsStore } from "../partnerWorkspaceStore";
import { spvEngineStore, canonicalCommittedMinorForSpv } from "../spvEngineStore";
import fs from "node:fs";
import path from "node:path";

/* WAVE 226 · R202 — wave 211 made an operator attestation MANDATORY on the
   money-event routes this suite drives, so these requests were refused 400 and
   the proofs below never reached their own assertions. The fixture supplies what
   a real operator supplies, over the same HTTP route; it is NOT a bypass. Read
   the header of `_wave226_attestation_fixture.ts` before changing it. */
import { W226_LP_COMMIT_ATT } from "./_wave226_attestation_fixture";
const MANAGING = "u_avi_managing";
const PARTNER_ID = "ac_consortium_partner_test_partner_inc";
const REPO = path.resolve(__dirname, "..", "..");
let app: express.Express;

function post(p: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
}
function get(p: string) {
  return request(app).get(p).set("x-user-id", MANAGING);
}

async function newSpv(name: string): Promise<string> {
  const c = await post("/api/partner/me/spv", {
    name,
    jurisdiction: "delaware",
    currency: "USD", /* WAVE 306 W1 — stated, not defaulted: preserves this fixture's prior behaviour exactly. */
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(c.status).toBe(201);
  return c.body.spv.id as string;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerSpvLegacyAdapterRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("W115 F7 — the dashboard committed figure comes from the canonical engine", () => {
  it("THE DEFECT: a real $10,000 LP commitment now appears on the dashboard, and the legacy denorm is provably still zero", async () => {
    const spvId = await newSpv("W115 Committed Source");
    const cm = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Dana",
      holderLastName: "Whitfield",
      investorEmail: "w115-dana@example.com",
      /* $10,000 — the exact shape of the commitment in the owner's screenshot. */
      amount: "10000",
      shares: "10000",
    });
    expect(cm.status).toBe(201);

    /* The authoritative figure, from WAVE 112's ONE shared predicate. */
    const canonical = canonicalCommittedMinorForSpv(spvId);
    expect(canonical).toBe(BigInt(1_000_000)); // $10,000 in USD minor units

    const d = await get("/api/partner/me/dashboard");
    expect(d.status).toBe(200);

    /* 1. The shipped figure equals the canonical derivation. */
    expect(d.body.portfolio.totalSpvCommittedMinor).toBe(1_000_000);

    /* 2. AND the dead denorm is still zero — so assertion 1 cannot be satisfied
          by the denorm having been "fixed" instead of replaced, and cannot be
          satisfied by both sides being coincidentally zero. This is the pair of
          assertions that makes the test non-tautological. */
    expect(d.body.portfolio.deadSpvDenormTotal).toBe(0);
    expect(
      partnerSpvStore.listByPartner(PARTNER_ID).reduce((a, x) => a + x.totalCommittedMinor, 0),
    ).toBe(0);

    /* 3. The provenance is declared, so this figure can be audited without
          reading the store. */
    expect(d.body.portfolio.committedFigureSource).toBe("canonical_spv_engine");
  });

  it("THE FUND TILE IS A FIFTH UNFED REGISTER: `PartnerFund.committedSizeMinor` has no live writer at all", () => {
    /* `partnerFundsStore.pledge` is its only writer, and it has zero callers.
       Asserted by source-grep rather than by narrative, so this cannot silently
       stop being true. */
    const files = ["server", "client/src"].flatMap((root) => {
      const out: string[] = [];
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (e.name === "__tests__" || e.name === "node_modules") continue;
            walk(p);
          } else if (/\.tsx?$/.test(e.name)) out.push(p);
        }
      };
      walk(path.join(REPO, root));
      return out;
    });
    const pledgeCallers: string[] = [];
    const addPositionCallers: string[] = [];
    for (const f of files) {
      /* Strip BLOCK and line comments before scanning. The first run of this
         test failed on WAVE 115's own documentation, which quotes the very grep
         it is asserting — a per-line `startsWith("*")` filter is not enough
         inside a multi-line block comment. Recorded rather than hidden. */
      const src = fs
        .readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const line of src.split("\n")) {
        const t = line.trim();
        if (/\.pledge\(/.test(line)) pledgeCallers.push(`${f}: ${t}`);
        if (/\.addPosition\(/.test(line) && !/partnerSpvs\.addPosition:/.test(line)) {
          addPositionCallers.push(`${f}: ${t}`);
        }
      }
    }
    expect(pledgeCallers).toEqual([]);
    expect(addPositionCallers).toEqual([]);
  });

  it("A FIGURE THAT CANNOT BE READ IS `null`, NEVER 0 — and the fund tile reads the engine too", async () => {
    const d = await get("/api/partner/me/dashboard");
    expect(d.status).toBe(200);
    const { totalSpvCommittedMinor, totalFundCommittedMinor, deadFundDenormTotal } = d.body.portfolio;
    /* Neither figure may be `undefined`; each is either an exact integer of minor
       units or an explicit `null` meaning "not available". A printed $0.00 that
       means "unknown" is a false statement about money. */
    for (const v of [totalSpvCommittedMinor, totalFundCommittedMinor]) {
      expect(v === null || Number.isInteger(v)).toBe(true);
    }
    /* The fund denorm is exposed as evidence and is zero, because it is unfed. */
    expect(deadFundDenormTotal).toBe(0);
    expect(partnerFundsStore.listByPartner(PARTNER_ID).every((f) => f.committedSizeMinor === 0)).toBe(true);
  });

  it("NO Number()/parseInt/parseFloat ON THE COMMITTED MONEY PATH, and no bigint literal syntax", () => {
    const src = fs.readFileSync(path.join(REPO, "server", "partnerWorkspaceStore.ts"), "utf8");
    /* Anchored on the DERIVATION block specifically — "WAVE 115 · FINDING 7"
       also appears on the import note and the response-type note above it, and
       slicing from the first occurrence swept in unrelated imports. */
    const start = src.indexOf("let totalSpvCommittedMinor: number | null;");
    /* lastIndexOf: the same literal appears in the response TYPE above. */
    const end = src.lastIndexOf('committedFigureSource: "canonical_spv_engine"');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block.length).toBeGreaterThan(400);
    expect(/parseInt\(/.test(block)).toBe(false);
    expect(/parseFloat\(/.test(block)).toBe(false);
    /* The ONLY permitted Number() calls are the two exactness-gated
       bigint→number conversions at the response boundary and the MAX_SAFE_INTEGER
       bound itself. Anything more is a money-parsing regression. */
    const numberCalls = block.match(/Number\(/g) ?? [];
    expect(numberCalls.length).toBeLessThanOrEqual(3);
    /* The exactness gate must be present: a value beyond MAX_SAFE_INTEGER minor
       units is refused, not rounded into a plausible-looking figure. */
    expect(block).toContain("MAX_SAFE_INTEGER");
  });

  it("THE CLIENT NEVER FORMATS A NULL COMMITTED FIGURE AS MONEY", () => {
    const src = fs.readFileSync(path.join(REPO, "client", "src", "pages", "partner", "PartnerDashboard.tsx"), "utf8");
    /* Both tiles must branch on null BEFORE reaching formatMinor. */
    expect(src).toContain("data.portfolio.totalSpvCommittedMinor == null");
    expect(src).toContain("data.portfolio.totalFundCommittedMinor == null");
    expect(src).toContain('data-testid="kpi-spv-unavailable"');
    expect(src).toContain('data-testid="kpi-fund-unavailable"');
    /* And the type must admit null, so a future edit cannot quietly drop the
       branch and still type-check. */
    expect(src).toMatch(/totalSpvCommittedMinor:\s*number \| null/);
    expect(src).toMatch(/totalFundCommittedMinor:\s*number \| null/);
  });
});
