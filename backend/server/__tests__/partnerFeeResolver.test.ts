/* v25.33 — partnerFeeResolver precedence tests.
 * Verifies the three-level precedence (per-partner override > per-tier default
 * > platform default), SPV size-band selection, time-windowing, and fail-closed
 * behaviour. All against the live SQLite DB via rawDb(); nothing in memory.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";
import { getDb, rawDb } from "../db/connection";
import {
  resolvePartnerFee,
  resolveCommissionOverridePct,
  FeeResolutionError,
} from "../lib/partnerFeeResolver";

const PID = `ct_test_pfr_${crypto.randomBytes(4).toString("hex")}`;
const TIER = "builder" as const;
const NOW = "2026-07-01T00:00:00Z";
const seededTierIds: string[] = [];

beforeAll(() => {
  getDb(); // boots DB + runs applyV2533PartnerPaymentSchema (seeds $0 platform defaults)
  const db = rawDb();
  // Insert a test consortium_partner contact.
  db.prepare(
    `INSERT OR REPLACE INTO contacts
       (id, kind, legal_name, display_name, status, verification, created_at, updated_at, created_by, updated_by, version, prev_revision_hash, revision_hash, tenant_id)
     VALUES (?, 'consortium_partner', 'PFR Test Partner', 'PFR Test Partner', 'active', 'verified', ?, ?, 'test', 'test', 1, '0', 'h0', 'tn_test')`
  ).run(PID, NOW, NOW);
});

afterAll(() => {
  const db = rawDb();
  db.prepare(`DELETE FROM contacts WHERE id = ?`).run(PID);
  for (const id of seededTierIds) db.prepare(`DELETE FROM partner_fee_schedules WHERE id = ?`).run(id);
});

describe("partnerFeeResolver — three-level precedence", () => {
  it("falls back to the seeded $0 PLATFORM default when nothing else configured", () => {
    const r = resolvePartnerFee(PID, TIER, "subscription_monthly", { atIso: NOW });
    expect(r.amountMinor).toBe(0);
    expect(r.currency).toBe("USD");
    expect(r.computedVia).toBe("platform_default");
    expect(r.feeScheduleId).toBe("pfs_def_sub_m");
  });

  it("prefers a per-TIER default over the platform default", () => {
    const id = `pfs_test_tier_${crypto.randomBytes(3).toString("hex")}`;
    seededTierIds.push(id);
    rawDb().prepare(
      `INSERT INTO partner_fee_schedules (id, tier, fee_kind, amount_minor, currency, effective_from, created_at, updated_at)
       VALUES (?, ?, 'subscription_monthly', 9900, 'USD', '2026-06-01T00:00:00Z', ?, ?)`
    ).run(id, TIER, NOW, NOW);
    const r = resolvePartnerFee(PID, TIER, "subscription_monthly", { atIso: NOW });
    expect(r.amountMinor).toBe(9900);
    expect(r.computedVia).toBe("tier_default");
    expect(r.feeScheduleId).toBe(id);
  });

  it("prefers a per-PARTNER override over both tier and platform", () => {
    rawDb().prepare(`UPDATE contacts SET fee_override_json = ? WHERE id = ?`).run(
      JSON.stringify({ subscription_monthly: { amountMinor: 4200, currency: "CAD" } }),
      PID,
    );
    const r = resolvePartnerFee(PID, TIER, "subscription_monthly", { atIso: NOW });
    expect(r.amountMinor).toBe(4200);
    expect(r.currency).toBe("CAD");
    expect(r.computedVia).toBe("partner_override");
    expect(r.feeScheduleId).toBeNull();
    // cleanup override for subsequent tests
    rawDb().prepare(`UPDATE contacts SET fee_override_json = NULL WHERE id = ?`).run(PID);
  });
});

describe("partnerFeeResolver — SPV deployment size bands", () => {
  it("selects band1 for a $100K SPV (10,000,000 minor)", () => {
    const r = resolvePartnerFee(PID, TIER, "spv_deployment", { atIso: NOW, sizeMinor: 10_000_000 });
    expect(r.feeScheduleId).toBe("pfs_def_spv_band1");
    expect(r.amountMinor).toBe(0);
  });
  it("selects band2 for a $500K SPV (50,000,000 minor)", () => {
    const r = resolvePartnerFee(PID, TIER, "spv_deployment", { atIso: NOW, sizeMinor: 50_000_000 });
    expect(r.feeScheduleId).toBe("pfs_def_spv_band2");
  });
  it("selects band3 for a $3M SPV (300,000,000 minor)", () => {
    const r = resolvePartnerFee(PID, TIER, "spv_deployment", { atIso: NOW, sizeMinor: 300_000_000 });
    expect(r.feeScheduleId).toBe("pfs_def_spv_band3");
  });
  it("selects band4 (open-ended) for a $10M SPV (1,000,000,000 minor)", () => {
    const r = resolvePartnerFee(PID, TIER, "spv_deployment", { atIso: NOW, sizeMinor: 1_000_000_000 });
    expect(r.feeScheduleId).toBe("pfs_def_spv_band4");
  });
  it("band boundary is half-open [min, max): exactly $250K (25,000,000) lands in band2", () => {
    const r = resolvePartnerFee(PID, TIER, "spv_deployment", { atIso: NOW, sizeMinor: 25_000_000 });
    expect(r.feeScheduleId).toBe("pfs_def_spv_band2");
  });
});

describe("partnerFeeResolver — fail-closed", () => {
  it("throws FeeResolutionError when a banded fee is requested with no size", () => {
    expect(() => resolvePartnerFee(PID, TIER, "spv_deployment", { atIso: NOW })).toThrow(FeeResolutionError);
  });
});

describe("resolveCommissionOverridePct", () => {
  it("returns null when no per-partner commission override is set", () => {
    expect(resolveCommissionOverridePct(PID)).toBeNull();
  });
  it("returns the per-partner override fraction when set", () => {
    rawDb().prepare(`UPDATE contacts SET commission_override_pct = 0.075 WHERE id = ?`).run(PID);
    expect(resolveCommissionOverridePct(PID)).toBeCloseTo(0.075, 6);
    rawDb().prepare(`UPDATE contacts SET commission_override_pct = NULL WHERE id = ?`).run(PID);
  });
});

import { chargeSpvDeploymentFee } from "../lib/spvDeploymentFee";
/* WAVE 133 · R98 — see the fixture note in the beforeAll below. */
import {
  setCanonicalPartnerTier,
  resolveCanonicalPartnerTier,
  PartnerTierResolutionError,
  E_TIER_UNRESOLVED,
  PARTNER_TIER_TABLE,
} from "../lib/partnerTierResolver";

describe("chargeSpvDeploymentFee — additive SPV deployment fee", () => {
  const SPV = `spv_test_${crypto.randomBytes(4).toString("hex")}`;
  const FEE_PID = `ct_test_spvfee_${crypto.randomBytes(4).toString("hex")}`;
  /* A SECOND partner, seeded EXACTLY as this fixture used to seed its only one —
     a tier in `contacts.metadata_json` and nothing else — so the refusal that
     R22 requires is pinned rather than merely worked around. */
  const LEGACY_ONLY_PID = `ct_test_spvfee_legacy_${crypto.randomBytes(4).toString("hex")}`;

  beforeAll(() => {
    const db = rawDb();
    db.prepare(
      `INSERT OR REPLACE INTO contacts
         (id, kind, legal_name, display_name, status, verification, created_at, updated_at, created_by, updated_by, version, prev_revision_hash, revision_hash, tenant_id, metadata_json)
       VALUES (?, 'consortium_partner', 'SPV Fee Partner', 'SPV Fee Partner', 'active', 'verified', ?, ?, 'test', 'test', 1, '0', 'h0', 'tn_test', ?)`
    ).run(FEE_PID, NOW, NOW, JSON.stringify({ tier: "builder" }));
    /* ═══════════════════════════════════════════════════════════════════════
       WAVE 133 · R98 — STALE FIXTURE, NOT A STALE EXPECTATION, AND NOT A
       DEFECT IN THE CODE. FIXTURE CORRECTED.
       ═══════════════════════════════════════════════════════════════════════
       RULING: OWNER_RULINGS_2026_08_13.md R98, applying R22.

       WHAT WAS ESTABLISHED. This fixture seeded the partner's tier ONLY into
       `contacts.metadata_json` (the line directly above, kept deliberately).
       `resolveCanonicalPartnerTier` — which `chargeSpvDeploymentFee` calls at
       spvDeploymentFee.ts:122 — reads only the durable canon
       `partner_tier_current` and the canonical partner record, and DELIBERATELY
       does not consult `metadata_json`: that legacy blob pricing money off an
       untyped `as any` cast, and failing OPEN to the cheapest tier when absent,
       IS the W10-REVIEW-A wrong-tier-billing defect the module was written to
       kill (see its header, "WRONG SOURCE OF TRUTH" / "FAIL-OPEN"). Migration
       0161 lifted metadata_json into the durable table once, at migration time,
       and it is not a live billing input any more.

       SO: the CODE is right and the EXPECTATIONS ($500 charged, computed_via
       `tier_default`, idempotent second call) are right too. The FIXTURE is the
       stale artefact — it seeds a source that was retired underneath it, and
       PARTNER_TIER_UNRESOLVED is the correct, intended R22 refusal to that seed.
       Nothing here was made green by amending an expectation.

       The fixture now seeds the CANONICAL record through the module's own
       supported admin remedy, `setCanonicalPartnerTier`, bound to this test's
       raw handle. Nothing is weakened: the metadata_json seed is retained, the
       refusal it produces on its own is pinned by the new
       "refuses … metadata_json" test below, and both original tests now assert
       what they were always meant to assert. ═════════════════════════════ */
    setCanonicalPartnerTier(FEE_PID, "builder", "test_fixture", db);
    // The control partner: legacy blob only, no canonical tier anywhere.
    db.prepare(
      `INSERT OR REPLACE INTO contacts
         (id, kind, legal_name, display_name, status, verification, created_at, updated_at, created_by, updated_by, version, prev_revision_hash, revision_hash, tenant_id, metadata_json)
       VALUES (?, 'consortium_partner', 'SPV Fee Legacy Partner', 'SPV Fee Legacy Partner', 'active', 'verified', ?, ?, 'test', 'test', 1, '0', 'h0', 'tn_test', ?)`
    ).run(LEGACY_ONLY_PID, NOW, NOW, JSON.stringify({ tier: "builder" }));
    // Tier-specific spv_deployment band1 with a real $500 fee for builder tier.
    const id = `pfs_test_spvdep_${crypto.randomBytes(3).toString("hex")}`;
    seededTierIds.push(id);
    db.prepare(
      `INSERT INTO partner_fee_schedules (id, tier, fee_kind, amount_minor, currency, size_band_min, size_band_max, effective_from, created_at, updated_at)
       VALUES (?, 'builder', 'spv_deployment', 50000, 'USD', 0, 25000000, '2026-06-01T00:00:00Z', ?, ?)`
    ).run(id, NOW, NOW);
    db.prepare(
      `INSERT OR REPLACE INTO spvs (id, tenant_id, partner_id, name, structure_type, status, target_minor, committed_minor, called_minor, distributed_minor, prev_hash, curr_hash, created_at, updated_at, sourcing_partner_id)
       VALUES (?, 'tn_test', ?, 'Test SPV', 'spv', 'fundraising', 10000000, 10000000, 0, 0, '0', 'h', ?, ?, ?)`
    ).run(SPV, FEE_PID, NOW, NOW, FEE_PID);
  });

  afterAll(() => {
    const db = rawDb();
    db.prepare(`DELETE FROM spvs WHERE id = ?`).run(SPV);
    db.prepare(`DELETE FROM contacts WHERE id = ?`).run(FEE_PID);
    db.prepare(`DELETE FROM contacts WHERE id = ?`).run(LEGACY_ONLY_PID);
    db.prepare(`DELETE FROM partner_billing_entries WHERE spv_fund_id = ?`).run(SPV);
    // WAVE 133 · R98 — remove the durable canon row this fixture now seeds.
    for (const p of [FEE_PID, LEGACY_ONLY_PID]) {
      try { db.prepare(`DELETE FROM ${PARTNER_TIER_TABLE} WHERE partner_id = ?`).run(p); } catch { /* table may not exist */ }
    }
  });

  /* WAVE 133 · R98 / R22 — the pin that makes the fixture correction safe: a
     tier in the legacy `contacts.metadata_json` blob is NOT a billing tier, and
     the charge path refuses rather than guessing one. This is strictly stronger
     than the fixture it replaces, which asserted nothing about the source of
     truth at all. If anyone ever re-admits metadata_json as a pricing input,
     this fails — which is the whole point of R22. */
  it("refuses to charge when the tier exists ONLY in the legacy contacts.metadata_json blob (R22 fail-closed)", () => {
    expect(() => resolveCanonicalPartnerTier(LEGACY_ONLY_PID, rawDb())).toThrow(PartnerTierResolutionError);
    try {
      resolveCanonicalPartnerTier(LEGACY_ONLY_PID, rawDb());
      throw new Error("expected PARTNER_TIER_UNRESOLVED");
    } catch (e: any) {
      expect(e).toBeInstanceOf(PartnerTierResolutionError);
      expect(e.code).toBe(E_TIER_UNRESOLVED);
    }
    // And no row was written through for it: a refusal must not converge a guess.
    const row = rawDb().prepare(`SELECT tier FROM ${PARTNER_TIER_TABLE} WHERE partner_id = ?`).get(LEGACY_ONLY_PID);
    expect(row).toBeUndefined();
  });

  it("resolves the fixture partner's tier from the CANONICAL durable record, not from metadata_json", () => {
    expect(resolveCanonicalPartnerTier(FEE_PID, rawDb())).toBe("builder");
    const row = rawDb().prepare(`SELECT tier, source FROM ${PARTNER_TIER_TABLE} WHERE partner_id = ?`).get(FEE_PID) as any;
    expect(row?.tier).toBe("builder");
  });

  it("charges the resolved deployment fee and writes a billing entry", () => {
    const r = chargeSpvDeploymentFee({ rawTx: rawDb(), spvId: SPV, partnerId: FEE_PID, committedMinor: 10000000 });
    expect(r.charged).toBe(true);
    expect(r.amountMinor).toBe(50000);
    expect(r.currency).toBe("USD");
    const entry = rawDb().prepare(`SELECT entry_kind, commission_minor, computed_via FROM partner_billing_entries WHERE spv_fund_id = ?`).get(SPV) as any;
    expect(entry.entry_kind).toBe("spv_deployment_fee");
    expect(entry.commission_minor).toBe(50000);
    expect(entry.computed_via).toBe("tier_default");
    const spvRow = rawDb().prepare(`SELECT deployment_fee_minor FROM spvs WHERE id = ?`).get(SPV) as any;
    expect(spvRow.deployment_fee_minor).toBe(50000);
  });

  it("is idempotent — a second call does not double-charge", () => {
    const r = chargeSpvDeploymentFee({ rawTx: rawDb(), spvId: SPV, partnerId: FEE_PID, committedMinor: 10000000 });
    expect(r.charged).toBe(false);
    expect(r.reason).toBe("already_charged");
    const count = rawDb().prepare(`SELECT COUNT(*) c FROM partner_billing_entries WHERE spv_fund_id = ?`).get(SPV) as any;
    expect(count.c).toBe(1);
  });
});
