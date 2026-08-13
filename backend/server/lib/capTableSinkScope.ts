/**
 * server/lib/capTableSinkScope.ts — WAVE 35 · F6 / F7 / F8 / F9.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Four routes authorise a cap-table read with the SAME predicate:
 *
 *     ctx.investor.capTablePositions.some(p => p.companyId === cid)
 *
 * That predicate is exactly what `gate("investor.onCapTableOf")` asks
 * (`server/lib/requireEntitlement.ts:135`). It is NOT a privacy control for
 * SPVs, and `spec/LP_SCOPED_VIEW_DESIGN.md` says so in its 2026-08-11
 * CORRECTION: an SPV is stored as a company in the sacred cap-table ledger and
 * every LP is written into it with `company_id = spv.id`, so **an LP
 * legitimately PASSES the gate for their own vehicle.** The gate is not the
 * control; the sink is.
 *
 * Review A (v26.16) proved by execution, probing as a real-but-wrong LP
 * identity against the full `registerRoutes` stack, that three sinks then
 * enumerate the ledger with no exclusion:
 *
 *   F6  GET /api/companies/:id/captable/snapshots   (captableSnapshotsStore.ts)
 *   F7  GET /api/companies/:id/captable/interim     (routes.ts)
 *   F8  GET /api/companies/:id/securities           (routes.ts, W-SAFE bridge)
 *
 * LP Alpha asked for their own vehicle and received LP Beta's NAME and a
 * $7,500,000 position. Six sinks of this class have now been found across four
 * sweeps, each fixed individually, each time letting the next one appear the
 * same way. Review A's recommendation, followed here: **ONE shared decision
 * helper applied at ALL FOUR `capTablePositions.some` sites**, so a seventh
 * sink cannot be introduced by copying a route that looks authorised.
 *
 * ── WHAT IT DECIDES ─────────────────────────────────────────────────────────
 *   allow          — admin, a founder of the company, or a genuine cap-table
 *                    counterparty of a REAL operating company. Unchanged
 *                    behaviour: this pole must keep working, and it is asserted
 *                    in the falsification harness.
 *   scope_to_self  — the company is SPV-backed and the caller reaches it only
 *                    through an investor relationship. They may see THEIR OWN
 *                    rows and nothing else. Honours `spv.lp_visibility`
 *                    (`own_only | co_investors`, connection.ts:5180) from the
 *                    DB rather than hardcoding the policy.
 *   refuse         — no relationship at all. Callers must answer **404
 *                    not_found**, not 403 (F9): 403 distinguishes "exists but
 *                    forbidden" from "does not exist" and therefore enumerates
 *                    SPV ids, which are the private vehicles. This mirrors the
 *                    policy the codebase already states at `routes.ts:1932`.
 *
 * ── FAILURE DIRECTION ───────────────────────────────────────────────────────
 * Every DB read here fails in the DENYING direction, matching the posture of
 * `spvBackedCompanies.ts`: an unreadable `spv` table means "treat as a vehicle,
 * scope to self", never "open the ledger". An unreadable `lp_visibility` means
 * `own_only`.
 *
 * ── STATIC IMPORTS ONLY ─────────────────────────────────────────────────────
 * A lazily-`require()`d dependency inside a privacy guard is a guard that
 * silently disappears on the runtime where it was tested — that is precisely
 * how the third sink stayed invisible (dead under both TS runtimes, live in the
 * bundled build) and how F4's partner-attribution block died. Both imports
 * below are static and the module is exercised by an executing harness.
 */
import { rawDb } from "../db/connection";
import { isSpvBackedCompany } from "./spvBackedCompanies";

export type CapTableSinkOutcome = "allow" | "scope_to_self" | "refuse";

export interface CapTableSinkAccess {
  outcome: CapTableSinkOutcome;
  /** Non-null only for `scope_to_self`: the ONLY investor id whose rows may be emitted. */
  scopedToUserId: string | null;
  reason:
  | "admin"
  | "founder"
  | "direct_counterparty"
  | "spv_lp_own_only"
  | "spv_lp_co_investors"
  | "no_relationship"
  | "unauthenticated";
}

/** Minimal shape this helper needs; keeps it usable from both typed and `any` call sites. */
export interface CapTableSinkContext {
  userId?: string;
  isAdmin?: boolean;
  isAuthed?: boolean;
  founder?: { companies?: Array<{ companyId?: string }> } | null;
  investor?: {
    capTablePositions?: Array<{ companyId?: string }>;
    /**
     * WAVE 36 · ROW 1 — present on the real ctx shape, DELIBERATELY NOT CONSULTED.
     * See the predicate below: an invitation is not a holding. Declared here only
     * so a caller passing the real ctx object type-checks; reading it in this file
     * is the defect Wave 36 removed.
     */
    invitedRounds?: Array<{ companyId?: string }>;
  } | null;
}

/**
 * DB-driven LP visibility for a vehicle. `own_only` (the schema default) means
 * an LP sees only their own subscription; `co_investors` is an EXPLICIT opt-in
 * recorded by the sponsor. Anything else — including a missing row, a missing
 * column or a throwing read — resolves to `own_only`.
 */
export function spvLpVisibility(companyId: string): "own_only" | "co_investors" {
  try {
    const row = rawDb()
      .prepare(`SELECT lp_visibility AS v FROM spv WHERE id = ? LIMIT 1`)
      .get(String(companyId ?? "").trim()) as { v?: string } | undefined;
    return String(row?.v ?? "").trim() === "co_investors" ? "co_investors" : "own_only";
  } catch {
    return "own_only";
  }
}

/**
 * THE shared decision for every cap-table sink guarded by a
 * `capTablePositions.some(...)` equality check.
 */
export function decideCapTableSinkAccess(
  ctx: CapTableSinkContext | null | undefined,
  companyId: string,
): CapTableSinkAccess {
  const cid = String(companyId ?? "").trim();
  if (!ctx?.isAuthed) return { outcome: "refuse", scopedToUserId: null, reason: "unauthenticated" };
  if (ctx.isAdmin) return { outcome: "allow", scopedToUserId: null, reason: "admin" };

  const isFounder = !!ctx.founder?.companies?.some((c) => c?.companyId === cid);
  if (isFounder) return { outcome: "allow", scopedToUserId: null, reason: "founder" };

  // ── WAVE 36 · ROW 1 — THE PREDICATE IS `capTablePositions` ONLY ─────────────
  // Wave 35 shipped `capTablePositions.some(...) || invitedRounds.some(...)`.
  // The `invitedRounds` disjunct was NEVER part of the pre-Wave-35 predicate at
  // any of the four sites (each was `ctx.investor.capTablePositions.some(...)`),
  // and the Wave 35 report never mentions it. Its effect was that a person merely
  // INVITED to a round — holding nothing, owning nothing — read the entire
  // cap-table ledger of an operating company: other holders' names, emails,
  // investor ids and amounts. Two independent reviewers proved it.
  //
  // An invitation is a prospect relationship, not a holding. It confers no right
  // to the ledger. The ONLY intended semantic change introduced by this helper
  // relative to pre-Wave-35 behaviour is the SPV exclusion below.
  const hasInvestorRelationship = !!ctx.investor?.capTablePositions?.some(
    (p) => p?.companyId === cid,
  );
  if (!hasInvestorRelationship) {
    return { outcome: "refuse", scopedToUserId: null, reason: "no_relationship" };
  }

  // The relationship is real. The question the gate cannot answer is whether the
  // "company" is actually a vehicle whose other members are strangers.
  if (isSpvBackedCompany(cid)) {
    if (spvLpVisibility(cid) === "co_investors") {
      return { outcome: "allow", scopedToUserId: null, reason: "spv_lp_co_investors" };
    }
    return {
      outcome: "scope_to_self",
      scopedToUserId: String(ctx.userId ?? ""),
      reason: "spv_lp_own_only",
    };
  }
  return { outcome: "allow", scopedToUserId: null, reason: "direct_counterparty" };
}

/**
 * Apply a decision to a list of ledger-shaped rows. `allow` passes the list
 * through untouched (the genuine-counterparty pole); `scope_to_self` keeps only
 * rows belonging to the caller; `refuse` yields nothing (callers should have
 * already answered 404 and never reached here).
 */
export function scopeCapTableRows<T>(
  access: CapTableSinkAccess,
  rows: readonly T[],
  investorIdOf: (row: T) => string | null | undefined,
): T[] {
  if (access.outcome === "allow") return rows.slice();
  if (access.outcome === "refuse") return [];
  const self = String(access.scopedToUserId ?? "");
  if (!self) return [];
  return rows.filter((r) => String(investorIdOf(r) ?? "") === self);
}

/**
 * The single refusal shape for this class. **404, not 403** — see F9 above.
 * Exported as a constant so the three sibling routes cannot drift apart again.
 */
export const CAP_TABLE_SINK_NOT_FOUND = { ok: false as const, error: "not_found" as const };
export const CAP_TABLE_SINK_NOT_FOUND_STATUS = 404;
