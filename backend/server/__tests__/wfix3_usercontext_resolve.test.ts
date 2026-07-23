/**
 * W-FIX3 Item 3 (Bug#4 Option B) — the owner-authorized ADDITIVE sacred edit to
 * server/lib/userContext.ts. Both invited-rounds hydration sites now resolve a
 * null invitation companyId from the round it was addressed to, so a legacy
 * null-companyId invite still enters the investor's entitlement set.
 *
 * Locks the exact contract from the brief:
 *  (1) a null-companyId invitation whose round HAS a companyId now appears in
 *      ctx.investor.invitedRounds with the RESOLVED id → investorVisibleCompanyIds
 *      includes it (this Set is the exact predicate canAccessCompany delegates to);
 *  (2) a genuinely company-less row (round missing / round.companyId null) stays
 *      EXCLUDED — no over-inclusion, no fabricated id;
 *  (3) a non-null-companyId invitation is UNCHANGED — the `??` short-circuits and
 *      the round's (deliberately different) companyId is never consulted.
 *
 * Runs against the static investor persona u_lapsed_lp (email
 * lp@lapsed-fund.example — no demo identity overlay, deterministic). Rows are
 * pushed straight into the in-memory mirror buildInvitedRounds reads
 * (listForInvestorEmail → memInvitations); createInvitation cannot persist a null
 * companyId (its W-FIX2 F1 write-path backfills). All assertions use ONE ctx
 * build because RUNTIME_INVITATIONS caches per-user after first hydration.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "../db/connection";
import { createRound } from "../roundsStore";
import { _testAccessInvitations } from "../roundInvitationsStore";
import { getUserContextForId } from "../lib/userContext";
import { investorVisibleCompanyIds } from "../lib/tenantAuth";

const INVESTOR_ID = "u_lapsed_lp";
const INVESTOR_EMAIL = "lp@lapsed-fund.example";
const STAMP = Date.now();

const RESOLVABLE_COMPANY_ID = `co_uc_ok_${STAMP}`;
const EXPLICIT_COMPANY_ID = `co_uc_explicit_${STAMP}`;
const ROUND_OTHER_COMPANY_ID = `co_uc_roundother_${STAMP}`;

function pushInvitation(id: string, roundId: string, companyId: string | null) {
  const now = new Date().toISOString();
  _testAccessInvitations.rows.push({
    id,
    tenantId: `tenant_${STAMP}`,
    roundId,
    companyId,
    investorEmail: INVESTOR_EMAIL,
    investorName: "Lapsed LP",
    investorFirstName: null,
    investorLastName: null,
    state: "sent",
    classification: null,
    tokenHash: `hash_${id}`,
    invitedByUserId: null,
    note: null,
    sentAt: now,
    viewedAt: null,
    redeemedAt: null,
    redeemedByUserId: null,
    expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
    createdAt: now,
    updatedAt: now,
  } as any);
}

let visible: Set<string>;
let invitedCompanyIds: string[];

beforeAll(() => {
  getDb();

  // (1) null-companyId invite whose round HAS a companyId → resolvable.
  const okRound = createRound({
    companyId: RESOLVABLE_COMPANY_ID,
    name: `UC OK Round ${STAMP}`,
    type: "seed",
    instrument: "priced_equity",
    pricePerShare: 1,
    targetAmount: 1_000_000,
  } as any);
  pushInvitation(`rinv_uc_ok_${STAMP}`, okRound.id, null);

  // (2) null-companyId invite whose round does NOT resolve → excluded.
  pushInvitation(`rinv_uc_orphan_${STAMP}`, `rnd_uc_missing_${STAMP}`, null);

  // (3) non-null invite whose round has a DIFFERENT companyId → must stay on the
  //     explicit id (proves the `??` short-circuits and never reads the round).
  const otherRound = createRound({
    companyId: ROUND_OTHER_COMPANY_ID,
    name: `UC Other Round ${STAMP}`,
    type: "seed",
    instrument: "priced_equity",
    pricePerShare: 1,
    targetAmount: 1_000_000,
  } as any);
  pushInvitation(`rinv_uc_explicit_${STAMP}`, otherRound.id, EXPLICIT_COMPANY_ID);

  // Single ctx build — RUNTIME_INVITATIONS caches after the first hydration.
  const ctx = getUserContextForId(INVESTOR_ID);
  invitedCompanyIds = (ctx.investor?.invitedRounds ?? []).map((r) => r.companyId);
  visible = investorVisibleCompanyIds(ctx as any);
});

describe("W-FIX3 Item 3 — userContext resolves null invitation companyId from the round", () => {
  it("(1) surfaces the resolved companyId; investorVisibleCompanyIds includes it", () => {
    expect(invitedCompanyIds).toContain(RESOLVABLE_COMPANY_ID);
    expect(visible.has(RESOLVABLE_COMPANY_ID)).toBe(true);
  });

  it("(2) excludes a genuinely company-less row (round missing / no companyId)", () => {
    // orphan invite had companyId null and an unresolvable round → nothing to add.
    expect(visible.has("")).toBe(false);
    // and no fabricated id leaked in for the orphan
    expect(invitedCompanyIds.filter((c) => !c || c.length === 0)).toEqual([]);
  });

  it("(3) leaves a non-null invitation unchanged (?? short-circuits, round not consulted)", () => {
    expect(invitedCompanyIds).toContain(EXPLICIT_COMPANY_ID);
    expect(visible.has(EXPLICIT_COMPANY_ID)).toBe(true);
    // the round's different companyId must NOT have been substituted
    expect(invitedCompanyIds).not.toContain(ROUND_OTHER_COMPANY_ID);
    expect(visible.has(ROUND_OTHER_COMPANY_ID)).toBe(false);
  });
});
