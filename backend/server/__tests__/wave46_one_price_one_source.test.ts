/**
 * server/__tests__/wave46_one_price_one_source.test.ts
 *
 * WAVE 46 — OWNER RULINGS **R21** and **R22**. "One price, one source."
 *
 * ── WHAT THIS FILE PROVES BY EXECUTION ─────────────────────────────────────
 *
 * R22 gave six required proofs. Each is one `it` below, named W46-P1..P6:
 *
 *   P1  draft SPV                              → NO fee
 *   P2  pushed live                            → EXACTLY ONE fee, at the
 *                                                console's value
 *   P3  live → wound down → live again         → STILL exactly one
 *   P4  draft created then removed             → NEVER charged
 *   P5  console value changed                  → the next push charges the NEW
 *                                                value (proving one source)
 *   P6  the row emptied                        → the push REFUSES rather than
 *                                                charging $0 or $5,000
 *
 * plus the class-level proofs the rulings imply: that the demoted seeded $0
 * bands can no longer decide (P7), that the deleted `$5,000` fallback is
 * genuinely unreachable rather than merely unused (P8), that a JPY
 * (exponent-0) fee is carried as the same integer and never divided (P9), that
 * a retained deliberate override still wins AND is disclosed (P10), and that
 * the two triggers funnel into one latch (P11).
 *
 * ── BOTH POLES, DELIBERATELY ───────────────────────────────────────────────
 * A refusal-only build passes "never charges the wrong amount" and stops all
 * revenue. So every refusal proof here is paired with a positive proof that the
 * correct amount IS charged immediately afterwards, in the same test where the
 * state is restored.
 *
 * ── NO MONEY LITERAL IS AN EXPECTATION ─────────────────────────────────────
 * The amounts written into `platform_fees` below are FIXTURES this test itself
 * authors (it plays the role of the admin console). Every assertion compares
 * the charge against the fixture the test just wrote — so the test cannot be
 * satisfied by any value compiled into the product. The one exception is P8,
 * which names `500000` as a FORBIDDEN output.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import {
  getEngineSpvDeploymentFeeBilling,
  __resetDeploymentFeeBillingLatchForTest,
} from "../lib/spvEngineDeploymentFeeHook";
import {
  AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY,
  AUTHORITATIVE_COMPUTED_VIA,
  SpvDeploymentFeeUnconfiguredError,
  resolveAuthoritativeSpvDeploymentFee,
  requireAuthoritativeSpvDeploymentFee,
  isLiveSpvStatus,
  isPushToLiveTransition,
  listSpvDeploymentFeeSourceDivergences,
} from "../lib/spvDeploymentFeeSource";
import {
  getSpvDeploymentFee,
  getSpvDeploymentFeeOrNull,
  setSpvDeploymentFee,
  DEFAULT_CONSORTIUM_SPV_DEPLOYMENT_FEE_MINOR,
} from "../consortiumFeesStore";
import { setCanonicalPartnerTier } from "../lib/partnerTierResolver";
import { currencyExponent } from "../lib/money";

const MANAGING = "u_avi_managing";
const PARTNER = "ac_consortium_partner_test_partner_inc";
let app: express.Express;

const post = (path: string, user: string, body: unknown) =>
  request(app).post(path).set("x-user-id", user).send(body);

/** The engine SPV table gained the deployment_fee_* columns in migration 0152;
 *  the `:memory:` bootstrap predates it, so add them if absent (same helper
 *  shape as wave3f_review_gate2.test.ts — no new mechanism). */
function ensureSpvFeeColumns(): void {
  const db = rawDb();
  const columns = new Set(
    (db.prepare("PRAGMA table_info(spv)").all() as any[]).map((r: any) => r.name),
  );
  for (const [name, type] of [
    ["deployment_fee_minor", "INTEGER"],
    ["deployment_fee_currency", "TEXT"],
    ["deployment_fee_payer", "TEXT"],
    ["deployment_fee_paid_at", "TEXT"],
    ["deployment_fee_schedule_id", "TEXT"],
  ]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE spv ADD COLUMN ${name} ${type}`);
  }
}

/**
 * THE FIXTURE THAT MAKES THIS WAVE'S POINT. We delete every TIER-LEVEL
 * `spv_deployment` row so that levels 1-2 of the resolver abstain, and we leave
 * the SEEDED PLATFORM-DEFAULT ($0, `tier IS NULL`) bands exactly where they are.
 *
 * Before Wave 46 that combination billed **$0.00** — the seeded bands were the
 * decision of last resort. After Wave 46 the authoritative `platform_fees` row
 * decides instead, so the very same DB state now bills the console's value. The
 * $0 rows are RETAINED (R3: the banded machinery survives), just demoted out of
 * the decision, and P7 asserts they are still physically present.
 */
function clearTierLevelSpvDeploymentRows(): void {
  rawDb().exec(
    `DELETE FROM partner_fee_schedules WHERE fee_kind = 'spv_deployment' AND tier IS NOT NULL`,
  );
}

function seededZeroPlatformBands(): { id: string; amount_minor: number }[] {
  return rawDb()
    .prepare(
      `SELECT id, amount_minor FROM partner_fee_schedules
        WHERE fee_kind = 'spv_deployment' AND tier IS NULL`,
    )
    .all() as { id: string; amount_minor: number }[];
}

/** Play the admin console: write the ONE authoritative row. */
function setConsoleFee(amountMinor: number, currency = "USD"): void {
  setSpvDeploymentFee({ amountMinor, currency, updatedByUserId: "u_owner_wave46" });
}

/** Empty the authoritative row entirely (an un-seeded / de-configured deploy). */
function emptyConsoleFeeRow(): void {
  rawDb()
    .prepare(`DELETE FROM platform_fees WHERE key = ?`)
    .run(AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY);
}

interface BillingEntry {
  id: string;
  commission_minor: number;
  computed_via: string | null;
  fee_schedule_id: string | null;
  tier_at_funding: string | null;
}

function deploymentFeeEntries(spvId: string): BillingEntry[] {
  return rawDb()
    .prepare(
      `SELECT id, commission_minor, computed_via, fee_schedule_id, tier_at_funding
         FROM partner_billing_entries
        WHERE spv_fund_id = ? AND entry_kind = 'spv_deployment_fee'`,
    )
    .all(spvId) as BillingEntry[];
}

function spvFeeStamp(spvId: string): { deployment_fee_minor: number | null; deployment_fee_currency: string | null } {
  return (rawDb()
    .prepare(`SELECT deployment_fee_minor, deployment_fee_currency FROM spv WHERE id = ?`)
    .get(spvId) as any) ?? { deployment_fee_minor: null, deployment_fee_currency: null };
}

/** Create a DRAFT engine SPV through the real partner route. */
async function newDraftSpv(name: string): Promise<string> {
  const created = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "per_deployment",
    status: "draft",
    targetRaiseMinor: 100_000,
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(created.status).toBe(201);
  const id = created.body.spv.id as string;
  const row = rawDb().prepare(`SELECT status FROM spv WHERE id = ?`).get(id) as { status: string };
  expect(row.status).toBe("draft");
  return id;
}

/** THE PUSH TO LIVE — the real client-facing mutation, not a private helper. */
function pushLive(spvId: string, status = "open") {
  return spvEngineStore.updateSpv(PARTNER, spvId, { status } as any, MANAGING);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  ensureSpvFeeColumns();
  __resetDeploymentFeeBillingLatchForTest();
  clearTierLevelSpvDeploymentRows();
  // A canonical, durable tier is a precondition of billing (WAVE 3F / ITEM 2).
  setCanonicalPartnerTier(PARTNER, "builder", "wave46:test");
});

beforeEach(() => {
  // Every test authors its own authoritative amount; none inherits one.
  setConsoleFee(24_000);
});

afterAll(() => {
  try {
    setConsoleFee(24_000);
  } catch {
    /* ignore */
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE SIX RULING-MANDATED PROOFS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 46 / R22 — the SPV deployment fee has ONE source and is wired to push-to-live", () => {
  it("W46-P1 — a DRAFT SPV is never charged", async () => {
    const spvId = await newDraftSpv("W46 P1 draft stays free");
    expect(deploymentFeeEntries(spvId)).toHaveLength(0);
    expect(getEngineSpvDeploymentFeeBilling(spvId)).toBeNull();
    expect(spvFeeStamp(spvId).deployment_fee_minor).toBeNull();
    // The trigger predicate agrees, independently of the wiring.
    expect(isLiveSpvStatus("draft")).toBe(false);
    expect(isPushToLiveTransition("draft", "draft")).toBe(false);
  });

  it("W46-P2 — pushed live charges EXACTLY ONE fee, at the value the console holds", async () => {
    const spvId = await newDraftSpv("W46 P2 push charges once");
    const authoritative = resolveAuthoritativeSpvDeploymentFee();
    expect(authoritative).not.toBeNull();

    const after = pushLive(spvId);
    expect(after.status).toBe("open");

    const entries = deploymentFeeEntries(spvId);
    expect(entries).toHaveLength(1);
    // The charged amount IS the authoritative row's amount — read from the DB,
    // not written into this assertion.
    expect(entries[0].commission_minor).toBe(authoritative!.amountMinor);
    // …and its provenance names the authoritative source, so an auditor can see
    // WHICH row decided without re-deriving it.
    expect(entries[0].computed_via).toBe(AUTHORITATIVE_COMPUTED_VIA);
    expect(entries[0].fee_schedule_id).toBeNull();
    expect(entries[0].tier_at_funding).toBe("builder");

    const stamp = spvFeeStamp(spvId);
    expect(stamp.deployment_fee_minor).toBe(authoritative!.amountMinor);
    expect(stamp.deployment_fee_currency).toBe(authoritative!.currency);

    const latch = getEngineSpvDeploymentFeeBilling(spvId);
    expect(latch?.state).toBe("charged");
    expect(latch?.amountMinor).toBe(authoritative!.amountMinor);
  });

  it("W46-P3 — live → wound down → live again is STILL exactly one fee", async () => {
    const spvId = await newDraftSpv("W46 P3 republish charges once");
    pushLive(spvId);
    const firstEntries = deploymentFeeEntries(spvId);
    expect(firstEntries).toHaveLength(1);
    const firstId = firstEntries[0].id;

    spvEngineStore.archiveSpv(PARTNER, spvId, MANAGING);
    expect(
      (rawDb().prepare(`SELECT status FROM spv WHERE id = ?`).get(spvId) as any).status,
    ).toBe("wound_down");

    /* The re-push DOES cross the trigger edge again (wound_down is not live), so
     * the latch — not the trigger condition — is what stops the second charge.
     * That is the stronger arrangement: exactly-once is proved where a real
     * duplicate would have to get through. */
    expect(isPushToLiveTransition("wound_down", "open")).toBe(true);
    pushLive(spvId);

    const entries = deploymentFeeEntries(spvId);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(firstId);
    expect(getEngineSpvDeploymentFeeBilling(spvId)?.state).toBe("charged");
  });

  it("W46-P4 — a draft created and then removed is NEVER charged", async () => {
    const spvId = await newDraftSpv("W46 P4 draft then gone");
    // There is no hard-delete path for an SPV (Rule #78 retention floor), so a
    // draft's two possible ends are: archived without ever going live, or the
    // row being removed outright. NEITHER can charge, because neither crosses a
    // not-live → live edge. Both are exercised.
    spvEngineStore.archiveSpv(PARTNER, spvId, MANAGING);
    expect(deploymentFeeEntries(spvId)).toHaveLength(0);
    expect(getEngineSpvDeploymentFeeBilling(spvId)).toBeNull();

    rawDb().prepare(`DELETE FROM spv WHERE id = ?`).run(spvId);
    expect(deploymentFeeEntries(spvId)).toHaveLength(0);
    expect(getEngineSpvDeploymentFeeBilling(spvId)).toBeNull();
    // wound_down is not live, so archiving a draft is not a push.
    expect(isPushToLiveTransition("draft", "wound_down")).toBe(false);
  });

  it("W46-P5 — change the console value and the NEXT push charges the NEW value (one source)", async () => {
    const firstFixture = 24_000;
    const secondFixture = 30_000;
    setConsoleFee(firstFixture);
    const a = await newDraftSpv("W46 P5 first price");
    pushLive(a);
    expect(deploymentFeeEntries(a)[0].commission_minor).toBe(firstFixture);

    // The owner edits the console. Nothing else changes — no deploy, no code.
    setConsoleFee(secondFixture);
    expect(getSpvDeploymentFee().amountMinor).toBe(secondFixture);

    const b = await newDraftSpv("W46 P5 second price");
    pushLive(b);
    const bEntries = deploymentFeeEntries(b);
    expect(bEntries).toHaveLength(1);
    expect(bEntries[0].commission_minor).toBe(secondFixture);
    expect(bEntries[0].computed_via).toBe(AUTHORITATIVE_COMPUTED_VIA);

    // The already-charged SPV is NOT retro-repriced: a fee is frozen when charged.
    expect(deploymentFeeEntries(a)[0].commission_minor).toBe(firstFixture);
  });

  it("W46-P6 — with the row emptied the push REFUSES: no $0 entry, no $5,000, a retryable pending latch", async () => {
    const spvId = await newDraftSpv("W46 P6 refusal");
    emptyConsoleFeeRow();

    // The read surfaces refuse first, so nothing downstream can see a number.
    expect(getSpvDeploymentFeeOrNull()).toBeNull();
    expect(() => getSpvDeploymentFee()).toThrow(SpvDeploymentFeeUnconfiguredError);
    expect(() => requireAuthoritativeSpvDeploymentFee()).toThrow(/SPV_DEPLOYMENT_FEE_UNCONFIGURED/);

    // The push still SUCCEEDS as a status change — a fee gap must never roll
    // back the partner's write — but bills nothing.
    const after = pushLive(spvId);
    expect(after.status).toBe("open");

    expect(deploymentFeeEntries(spvId)).toHaveLength(0);
    expect(spvFeeStamp(spvId).deployment_fee_minor).toBeNull();

    // The obligation is DURABLE and NAMED, not an absence.
    const latch = getEngineSpvDeploymentFeeBilling(spvId);
    expect(latch).not.toBeNull();
    expect(latch!.state).toBe("pending");
    expect(latch!.lastReason).toBe("SPV_DEPLOYMENT_FEE_UNCONFIGURED");
    expect(latch!.amountMinor).toBeNull();

    /* ── THE OTHER POLE ── restore the price and the same SPV bills correctly on
     * retry. A build that refused everything would pass every assertion above. */
    setConsoleFee(24_000);
    const { retryEngineSpvDeploymentFee } = await import("../lib/spvEngineDeploymentFeeHook");
    const retried = retryEngineSpvDeploymentFee(spvId);
    expect(retried.charged).toBe(true);
    expect(retried.amountMinor).toBe(24_000);
    const entries = deploymentFeeEntries(spvId);
    expect(entries).toHaveLength(1);
    expect(entries[0].commission_minor).toBe(24_000);
    expect(getEngineSpvDeploymentFeeBilling(spvId)?.state).toBe("charged");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE CLASS-LEVEL PROOFS — why the defect can no longer recur
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 46 / R21+R22 — the demoted and deleted sources are genuinely unreachable", () => {
  it("W46-P7 — the seeded $0 platform-default bands are RETAINED but can no longer decide", async () => {
    // Retained (R3): the rows are physically present and still $0…
    const bands = seededZeroPlatformBands();
    expect(bands.length).toBeGreaterThan(0);
    for (const b of bands) expect(b.amount_minor).toBe(0);

    // …and yet the charge is the console's value, not $0. THIS is the fix: the
    // same DB state that used to bill $0.00 now bills the authoritative amount.
    const spvId = await newDraftSpv("W46 P7 zero bands ignored");
    pushLive(spvId);
    const entries = deploymentFeeEntries(spvId);
    expect(entries).toHaveLength(1);
    expect(entries[0].commission_minor).toBe(24_000);
    expect(entries[0].commission_minor).not.toBe(0);
    expect(entries[0].computed_via).toBe(AUTHORITATIVE_COMPUTED_VIA);
    expect(entries[0].computed_via).not.toBe("platform_default");
  });

  it("W46-P8 — the deleted $5,000 fallback is unreachable, not merely unused", () => {
    emptyConsoleFeeRow();
    try {
      // No read path can produce the historical seed amount when the row is gone.
      expect(getSpvDeploymentFeeOrNull()).toBeNull();
      expect(resolveAuthoritativeSpvDeploymentFee()).toBeNull();
      let thrown: unknown = null;
      try {
        getSpvDeploymentFee();
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SpvDeploymentFeeUnconfiguredError);
      expect(String((thrown as Error).message)).not.toContain(
        String(DEFAULT_CONSORTIUM_SPV_DEPLOYMENT_FEE_MINOR),
      );
      // The constant still EXISTS (tests name the seed by it) but nothing returns it.
      expect(DEFAULT_CONSORTIUM_SPV_DEPLOYMENT_FEE_MINOR).toBe(500_000);
    } finally {
      setConsoleFee(24_000);
    }
    // Positive pole restored.
    expect(getSpvDeploymentFee().amountMinor).toBe(24_000);
  });

  it("W46-P9 — an UNTOUCHED ZERO is an absence; a DELIBERATE zero is a real free fee (R6)", async () => {
    // Untouched zero (no operator ever entered it) → refusal.
    rawDb()
      .prepare(
        `INSERT INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id)
         VALUES (?, 0, 'USD', ?, NULL)
         ON CONFLICT(key) DO UPDATE SET amount_minor = 0, updated_by_user_id = NULL, updated_at = excluded.updated_at`,
      )
      .run(AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY, new Date().toISOString());
    expect(getSpvDeploymentFeeOrNull()).toBeNull();

    // Deliberate zero (an operator set it) → a real, charged $0.00 fee. R6 is
    // explicit that a genuine zero renders as zero and MEANS it.
    setConsoleFee(0);
    const deliberate = getSpvDeploymentFeeOrNull();
    expect(deliberate).not.toBeNull();
    expect(deliberate!.amountMinor).toBe(0);
    const spvId = await newDraftSpv("W46 P9 deliberate free");
    pushLive(spvId);
    const entries = deploymentFeeEntries(spvId);
    expect(entries).toHaveLength(1);
    expect(entries[0].commission_minor).toBe(0);
    expect(entries[0].computed_via).toBe(AUTHORITATIVE_COMPUTED_VIA);
  });

  it("W46-P10 — JPY (exponent 0) is carried as the SAME integer and never divided", async () => {
    /* The money rule with teeth: a JPY amount has no minor subdivision, so any
     * `/100` or `*100` anywhere on this path would be off by two orders of
     * magnitude. ¥24,000 is stored, charged and stamped as 24000 — identical to
     * the integer for $240.00 USD, which is exactly the point of minor units. */
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
    setConsoleFee(24_000, "JPY");
    const fee = getSpvDeploymentFeeOrNull();
    expect(fee!.currency).toBe("JPY");
    expect(fee!.amountMinor).toBe(24_000);

    const spvId = await newDraftSpv("W46 P10 jpy");
    pushLive(spvId);
    const entries = deploymentFeeEntries(spvId);
    expect(entries).toHaveLength(1);
    expect(entries[0].commission_minor).toBe(24_000);
    const stamp = spvFeeStamp(spvId);
    expect(stamp.deployment_fee_currency).toBe("JPY");
    expect(stamp.deployment_fee_minor).toBe(24_000);
    // Not 240, not 2400000 — no exponent was applied in either direction.
    expect(stamp.deployment_fee_minor).not.toBe(240);
    expect(stamp.deployment_fee_minor).not.toBe(2_400_000);
    setConsoleFee(24_000, "USD");
  });

  it("W46-P11 — a RETAINED per-tier override still wins (R3) and is DISCLOSED (R22)", async () => {
    const overrideMinor = 41_700; // a fixture, deliberately unlike any product value
    const now = new Date().toISOString();
    rawDb()
      .prepare(
        `INSERT OR REPLACE INTO partner_fee_schedules
           (id,tier,fee_kind,amount_minor,currency,size_band_min,size_band_max,
            effective_from,effective_to,created_at,updated_at,created_by)
         VALUES ('w46_builder_override','builder','spv_deployment',?,'USD',0,NULL,
                 '2020-01-01T00:00:00.000Z',NULL,?,?,'wave46:test')`,
      )
      .run(overrideMinor, now, now);
    try {
      const spvId = await newDraftSpv("W46 P11 tier override wins");
      pushLive(spvId);
      const entries = deploymentFeeEntries(spvId);
      expect(entries).toHaveLength(1);
      // The tiered machinery SURVIVES and still decides when it is configured.
      expect(entries[0].commission_minor).toBe(overrideMinor);
      expect(entries[0].computed_via).toBe("tier_default");

      // …and the divergence from the authoritative value is DISCLOSED, so a
      // shadowing override can never be discovered for the first time on an
      // invoice. That reporting is the actual cure for the "several sources"
      // class: overrides are legitimate, silence was not.
      const divergences = listSpvDeploymentFeeSourceDivergences();
      const mine = divergences.find((d) => d.feeScheduleId === "w46_builder_override");
      expect(mine).toBeTruthy();
      expect(mine!.scope).toBe("tier");
      expect(mine!.subject).toBe("builder");
      expect(mine!.amountMinor).toBe(overrideMinor);
      expect(mine!.authoritativeAmountMinor).toBe(24_000);
    } finally {
      rawDb().prepare(`DELETE FROM partner_fee_schedules WHERE id = 'w46_builder_override'`).run();
    }

    // Other pole: with the override gone, the authoritative row decides again
    // and there is nothing to disclose.
    const spvId = await newDraftSpv("W46 P11 authoritative again");
    pushLive(spvId);
    expect(deploymentFeeEntries(spvId)[0].commission_minor).toBe(24_000);
    expect(
      listSpvDeploymentFeeSourceDivergences().some((d) => d.feeScheduleId === "w46_builder_override"),
    ).toBe(false);
  });

  it("W46-P12 — the push-to-live and markDeployed triggers funnel into ONE latch", async () => {
    const spvId = await newDraftSpv("W46 P12 two triggers one charge");
    pushLive(spvId, "open");
    expect(deploymentFeeEntries(spvId)).toHaveLength(1);
    // Walking the rest of the lifecycle re-crosses nothing and re-charges nothing.
    pushLive(spvId, "closed");
    pushLive(spvId, "deployed");
    pushLive(spvId, "distributing");
    expect(deploymentFeeEntries(spvId)).toHaveLength(1);
    expect(getEngineSpvDeploymentFeeBilling(spvId)?.attempts).toBeGreaterThanOrEqual(1);
    // live → live is not a push.
    expect(isPushToLiveTransition("open", "closed")).toBe(false);
    expect(isPushToLiveTransition("closed", "deployed")).toBe(false);
  });
});
