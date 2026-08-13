/**
 * server/__tests__/wave3f_review_gate2.test.ts
 *
 * WAVE 3F — the sinks closed against W10 REVIEW A, items 2, 4 and 5.
 * (ITEM 1 is pinned by the review's own reproduction, re-run in
 *  server/__tests__/w10_atomicity_repro.test.ts; ITEM 3 is pinned by
 *  wave3b_mc1_cent_conservation.test.ts PERSIST-5 / PERSIST-6.)
 *
 * Every test here is written to FAIL if the fix is reverted — see the mutation
 * matrix in build_log/WAVE3F_REPORT.md.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "fs";
import { join } from "path";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import {
  chargeEngineSpvDeploymentFee,
  retryEngineSpvDeploymentFee,
  getEngineSpvDeploymentFeeBilling,
  listPendingEngineSpvDeploymentFees,
} from "../lib/spvEngineDeploymentFeeHook";
import {
  resolveCanonicalPartnerTier,
  setCanonicalPartnerTier,
  PartnerTierResolutionError,
  PARTNER_TIER_TABLE,
} from "../lib/partnerTierResolver";
import { readDiscountFraction, InvalidDiscountWireValueError } from "../../client/src/lib/engineDemo";

const MANAGING = "u_avi_managing";
const PARTNER = "ac_consortium_partner_test_partner_inc";
let app: express.Express;

const post = (path: string, user: string, body: unknown) =>
  request(app).post(path).set("x-user-id", user).send(body);

const readSrc = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** EXECUTABLE source only. WAVE 3F deliberately archives each removed defect
 *  verbatim in a comment above its replacement, so a naive substring search
 *  would match the tombstone rather than live code. These assertions must be
 *  about what RUNS, so block and line comments are stripped first. */
const readCode = (rel: string) =>
  readSrc(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function ensureFeeSchedules(): void {
  const db = rawDb();
  const columns = new Set(db.prepare("PRAGMA table_info(spv)").all().map((r: any) => r.name));
  for (const [name, type] of [
    ["deployment_fee_minor", "INTEGER"], ["deployment_fee_currency", "TEXT"],
    ["deployment_fee_payer", "TEXT"], ["deployment_fee_paid_at", "TEXT"],
    ["deployment_fee_schedule_id", "TEXT"],
  ]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE spv ADD COLUMN ${name} ${type}`);
  }
  const ins = (id: string, tier: string, minor: number) =>
    db.prepare(
      `INSERT OR REPLACE INTO partner_fee_schedules
       (id,tier,fee_kind,amount_minor,currency,size_band_min,size_band_max,effective_from,effective_to,created_at,updated_at,created_by)
       VALUES (?,?,?,?,'USD',0,NULL,'2020-01-01T00:00:00.000Z',NULL,'2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z','w3f')`,
    ).run(id, tier, "spv_deployment", minor);
  ins("w3f_catalyst_fee", "catalyst", 11_100);
  ins("w3f_builder_fee", "builder", 22_200);
}

async function newSpv(name: string): Promise<string> {
  const created = await post("/api/partner/me/spv", MANAGING, {
    name, jurisdiction: "delaware", carryBasis: "per_deployment", status: "open",
    targetRaiseMinor: 100_000, signoffLegalName: "Avi Managing", signoffAccepted: true,
  });
  expect(created.status).toBe(201);
  return created.body.spv.id as string;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  ensureFeeSchedules();
});

afterAll(() => {
  try { rawDb().exec(`DELETE FROM ${PARTNER_TIER_TABLE} WHERE partner_id LIKE 'w3f_%'`); } catch { /* ignore */ }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 2 — the hardcoded `catalyst` tier fallback is gone; resolution is
 *          canonical and FAILS CLOSED.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 3F / ITEM 2 — canonical partner tier, fail closed", () => {
  it("W3F-2A — the literal fallback tier is no longer in the fee source", () => {
    const code = readCode("server/lib/spvDeploymentFee.ts");
    // The three `return "catalyst"` statements of the frozen artifact are gone
    // from EXECUTABLE code; only the archival tombstone comment mentions them.
    expect(code).not.toMatch(/return\s+"catalyst"/);
    expect(code).not.toContain("function readPartnerTier");
    expect(code).not.toContain("metadata_json");
    expect(code).toContain("resolveCanonicalPartnerTier");
  });

  it("W3F-2B — the review's exact scenario now bills BUILDER 22200, not CATALYST 11100", async () => {
    const db = rawDb();
    const spvId = await newSpv("W3F tier — canonical builder");
    // The review's premise, verbatim: canonical partner tier is `builder` while
    // the legacy contacts.metadata_json holds NOTHING.
    const meta = db.prepare("SELECT metadata_json FROM contacts WHERE id = ?").get(PARTNER) as any;
    expect(meta?.metadata_json ?? null).toBeNull();

    const result = chargeEngineSpvDeploymentFee(spvId, PARTNER);
    expect(result.charged).toBe(true);
    const billed = db.prepare(
      `SELECT tier_at_funding, commission_minor FROM partner_billing_entries
        WHERE spv_fund_id = ? AND entry_kind = 'spv_deployment_fee'`,
    ).get(spvId);
    expect(billed).toEqual({ tier_at_funding: "builder", commission_minor: 22_200 });
  });

  it("W3F-2C — an unknown partner FAILS CLOSED instead of defaulting to catalyst", () => {
    expect(() => resolveCanonicalPartnerTier("w3f_partner_with_no_tier_anywhere"))
      .toThrow(PartnerTierResolutionError);
    try {
      resolveCanonicalPartnerTier("w3f_partner_with_no_tier_anywhere");
    } catch (e) {
      expect((e as PartnerTierResolutionError).code).toBe("PARTNER_TIER_UNRESOLVED");
    }
  });

  it("W3F-2D — a tier outside the DB-enforced domain is rejected, never coerced", () => {
    expect(() => setCanonicalPartnerTier("w3f_bad_tier_partner", "platinum")).toThrow(/TIER_NOT_IN_DOMAIN|PARTNER_TIER_UNRESOLVED/);
    expect(() => setCanonicalPartnerTier("w3f_bad_tier_partner", 3 as unknown)).toThrow();
  });

  it("W3F-2E — the durable canon is written through and then read back", () => {
    setCanonicalPartnerTier("w3f_amplifier_partner", "amplifier", "admin");
    expect(resolveCanonicalPartnerTier("w3f_amplifier_partner")).toBe("amplifier");
    const row = rawDb().prepare(`SELECT tier, source FROM ${PARTNER_TIER_TABLE} WHERE partner_id = ?`)
      .get("w3f_amplifier_partner") as any;
    expect(row.tier).toBe("amplifier");
  });

  it("W3F-2F — the durable canon disagreeing with the canonical record BLOCKS billing", () => {
    // The canonical partner record says `builder` (seeded sandbox). Force the
    // durable row to something else: inconsistent tier data must stop, not pick.
    setCanonicalPartnerTier(PARTNER, "nexus", "admin");
    try {
      expect(() => resolveCanonicalPartnerTier(PARTNER)).toThrow(PartnerTierResolutionError);
      try { resolveCanonicalPartnerTier(PARTNER); } catch (e) {
        expect((e as PartnerTierResolutionError).code).toBe("PARTNER_TIER_INCONSISTENT");
      }
    } finally {
      rawDb().prepare(`DELETE FROM ${PARTNER_TIER_TABLE} WHERE partner_id = ?`).run(PARTNER);
    }
  });

  it("W3F-2G — a blocked tier does NOT charge money; it records a pending bill", async () => {
    const spvId = await newSpv("W3F tier — blocked");
    const out = chargeEngineSpvDeploymentFee(spvId, "w3f_partner_with_no_tier_anywhere");
    expect(out.charged).toBe(false);
    expect(out.reason).toBe("PARTNER_TIER_UNRESOLVED");
    const billedRows = rawDb().prepare(
      `SELECT COUNT(*) AS n FROM partner_billing_entries WHERE spv_fund_id = ?`,
    ).get(spvId) as any;
    expect(billedRows.n).toBe(0);
    const billing = getEngineSpvDeploymentFeeBilling(spvId);
    expect(billing?.state).toBe("pending");
    expect(billing?.lastReason).toBe("PARTNER_TIER_UNRESOLVED");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 4 — a failed deployment fee is durable and idempotently retryable.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 3F / ITEM 4 — durable pending billing + idempotent retry", () => {
  it("W3F-4A — a failed charge leaves a PENDING row in the retry queue", async () => {
    const spvId = await newSpv("W3F billing — pending");
    const out = chargeEngineSpvDeploymentFee(spvId, "w3f_unknown_partner_4a");
    expect(out.charged).toBe(false);
    const billing = getEngineSpvDeploymentFeeBilling(spvId);
    expect(billing).not.toBeNull();
    expect(billing!.state).toBe("pending");
    expect(billing!.attempts).toBeGreaterThanOrEqual(1);
    expect(billing!.partnerId).toBe("w3f_unknown_partner_4a");
    expect(listPendingEngineSpvDeploymentFees().some((r) => r.spvId === spvId)).toBe(true);
  });

  it("W3F-4B — the retry FIXES the failure and collects the fee (the money is not lost)", async () => {
    const spvId = await newSpv("W3F billing — retry succeeds");
    // First attempt fails: the partner has no resolvable tier.
    expect(chargeEngineSpvDeploymentFee(spvId, "w3f_retry_partner").charged).toBe(false);
    expect(getEngineSpvDeploymentFeeBilling(spvId)!.state).toBe("pending");
    // Admin remedy: set the canonical tier, then retry — no deployment replay.
    setCanonicalPartnerTier("w3f_retry_partner", "builder", "admin");
    const retried = retryEngineSpvDeploymentFee(spvId);
    expect(retried.charged).toBe(true);
    expect(retried.amountMinor).toBe(22_200);
    expect(getEngineSpvDeploymentFeeBilling(spvId)!.state).toBe("charged");
    expect(listPendingEngineSpvDeploymentFees().some((r) => r.spvId === spvId)).toBe(false);
  });

  it("W3F-4C — the retry is IDEMPOTENT: repeated calls never double-charge", async () => {
    const spvId = await newSpv("W3F billing — idempotent");
    setCanonicalPartnerTier("w3f_idem_partner", "catalyst", "admin");
    expect(chargeEngineSpvDeploymentFee(spvId, "w3f_idem_partner").charged).toBe(true);
    for (let i = 0; i < 5; i++) {
      const r = retryEngineSpvDeploymentFee(spvId);
      expect(r.charged).toBe(false);
      expect(r.reason).toBe("already_charged");
    }
    const rows = rawDb().prepare(
      `SELECT COUNT(*) AS n, SUM(commission_minor) AS total FROM partner_billing_entries
        WHERE spv_fund_id = ? AND entry_kind = 'spv_deployment_fee'`,
    ).get(spvId) as any;
    expect(rows.n).toBe(1);
    expect(rows.total).toBe(11_100);
  });

  it("W3F-4D — the retry operation the review said did not exist is now routed", () => {
    const src = readCode("server/spvEngineRoutes.ts");
    expect(src).toContain('"/api/admin/consortium-spv/:spvId/deployment-fee/retry"');
    expect(src).toContain('"/api/admin/consortium-spv/deployment-fee/pending"');
    expect(src).toContain("retryEngineSpvDeploymentFee");
  });

  it("W3F-4E — the retry route is admin-only", async () => {
    const res = await post("/api/admin/consortium-spv/spv_nonexistent/deployment-fee/retry", MANAGING, {});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("ADMIN_REQUIRED");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 5 — the `n > 1 ? n / 100 : n` percent guess is gone from the artifact.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 3F / ITEM 5 — no percent-magnitude guessing", () => {
  it("W3F-5A — engineDemo.ts no longer rescales by magnitude", () => {
    const code = readCode("client/src/lib/engineDemo.ts");
    // All three live heuristics are gone from EXECUTABLE code.
    expect(code).not.toContain("s.discount > 1");
    expect(code).not.toContain("(s.discount / 100).toString()");
    expect(code).not.toMatch(/>\s*1\s*\?[^:]*\/\s*100/);
    expect(code).toContain("readDiscountFraction");
  });

  it("W3F-5B — RoundCarryForwardPanel renders through percentDisplay, not an inline ×100", () => {
    const code = readCode("client/src/components/RoundCarryForwardPanel.tsx");
    expect(code).not.toContain("pctFmt(n / 100)");
    expect(code).not.toMatch(/n\s*>\s*1\s*&&/);
    expect(code).toContain("formatFractionAsPercent");
  });

  it("W3F-5C — a fractional discount is accepted UNCHANGED (1 means 100%, not 1%)", () => {
    expect(readDiscountFraction(0.2, "s1")).toBe(0.2);
    expect(readDiscountFraction(1, "s1")).toBe(1);      // 100%, never rescaled
    expect(readDiscountFraction(0, "s1")).toBe(0);
    expect(readDiscountFraction(null, "s1")).toBeUndefined();
    expect(readDiscountFraction(undefined, "s1")).toBeUndefined();
  });

  it("W3F-5D — a percent-scale wire value is REJECTED, not divided by 100", () => {
    expect(() => readDiscountFraction(20, "s2")).toThrow(InvalidDiscountWireValueError);
    expect(() => readDiscountFraction(100, "s2")).toThrow(InvalidDiscountWireValueError);
    expect(() => readDiscountFraction(-0.1, "s2")).toThrow(InvalidDiscountWireValueError);
    expect(() => readDiscountFraction(Number.NaN, "s2")).toThrow(InvalidDiscountWireValueError);
    // The critical distinction the heuristic could not make:
    expect(readDiscountFraction(1, "s3")).toBe(1);        // 100%
    expect(() => readDiscountFraction(1.0001, "s3")).toThrow(); // not a fraction
  });
});
