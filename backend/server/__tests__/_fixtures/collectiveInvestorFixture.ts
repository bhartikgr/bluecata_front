/**
 * WAVE 134 · CAUSE 1 — ONE shared fixture that seats a FULLY COMPLIANT Collective investor.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * `server/lib/requireCollectiveMember.ts` runs the W2 A1 four-step decision tree.
 * Step 4 is the first-sign-on ACCREDITATION CAPTURE: a member whose
 * `getAccreditationGateStatus(userId).status === "none"` is refused
 * **403 ACCREDITATION_DECLARATION_REQUIRED** on every Collective route.
 *
 * Every Collective fixture in the tree did:
 *     collectiveMembershipStore.activate(uid, "u_admin_test");
 *     upsertCapTablePositionForTests(uid);
 * and stopped there — satisfying steps 1-3 and never step 4. Wave 133 measured the
 * consequence: **121 failure blocks across 20 files**, all of them 403s raised
 * BEFORE the test reached its assertions. Those tests were not failing; they were
 * ABSENT — 121 blocks of Collective behaviour were not exercised in CI at all
 * (`build_log/wave133/FAILURE_TRIAGE_v26_23_0.md`, cause 1).
 *
 * ── THE GATE IS CORRECT AND IS NOT WEAKENED HERE ─────────────────────────────
 * Wave 133's verdict is TEST, not CODE: the gate is a deliberate, documented,
 * fail-closed compliance control and the fixtures predate it. So this helper does
 * NOT disable, stub, monkey-patch or bypass anything. It records a REAL
 * declaration through the SAME production primitive the live route uses —
 * `recordAccreditationDeclaration()` from `server/investorComplianceRoutes.ts`,
 * the shared capture primitive behind
 * `POST /api/investor/compliance/accreditation-declaration`. The fixture takes the
 * documented route through the gate; it does not go around it.
 *
 * ── SELF-CHECK (deliberate, and the point of the design) ─────────────────────
 * A helper that silently failed to record the declaration would convert 121
 * failing tests into 121 tests that prove nothing — strictly worse than the red
 * we started with. So `seatCompliantInvestor()` ASSERTS its own postcondition and
 * THROWS if the gate would still refuse. A broken fixture fails loudly.
 *
 * `seatCollectiveMemberWithoutDeclaration()` is exported for the negative case:
 * proof that the gate still refuses an undeclared member lives in
 * `server/__tests__/w134_collective_accreditation_fixture.test.ts`.
 *
 * Rulings: R98 (a stale test is updated to pin the CORRECT behaviour, never the
 * code reverted) and R99 (the 436 are a programme, fixed by root cause).
 */
import * as collectiveMembershipStore from "../../collectiveMembershipStore";
import { upsertCapTablePositionForTests } from "../../membershipStore";
import {
  recordAccreditationDeclaration,
  getAccreditationGateStatus,
} from "../../investorComplianceRoutes";
import { ACCREDITATION_CRITERIA } from "../../../shared/accreditationClause";

/** Default admin actor recorded as the approver of the test membership. */
export const FIXTURE_ADMIN = "u_admin_test";

/**
 * Server-authoritative criterion id, read from the served clause config rather
 * than hardcoded, so this fixture cannot drift from `ACCREDITATION_CRITERIA`.
 */
const DEFAULT_CRITERION = ACCREDITATION_CRITERIA[0]?.id ?? "us_income";

export interface SeatCollectiveMemberOptions {
  /** Admin user id recorded as the approver. Defaults to `FIXTURE_ADMIN`. */
  activatedBy?: string;
  /** Membership tier. Defaults to the store's own default (`"standard"`). */
  tier?: "standard" | "plus";
  /** Chapter to seat the member in. Defaults to the store's default chapter. */
  chapterId?: string;
  /** Pass `true` to seat an admin-bootstrapped, cap-table-EXEMPT member. */
  capTableExempt?: boolean;
  /** Company for the cap-table position (step 3). Defaults to the store default. */
  companyId?: string;
}

export interface SeatCompliantInvestorOptions extends SeatCollectiveMemberOptions {
  /** Typed legal signature on the self-declaration. */
  signatureName?: string;
  /** Eligibility criterion ids. Must be known ids for the served clause version. */
  criteria?: string[];
  /** Declared jurisdiction. */
  jurisdiction?: string;
}

/**
 * Steps 1-3 ONLY: an ACTIVE Collective member with a cap-table position and
 * **no accreditation declaration**. This is exactly the state every fixture in
 * the tree used to leave a member in, and it is still refused 403
 * ACCREDITATION_DECLARATION_REQUIRED — which is correct.
 *
 * Exported so the negative test can assert the gate still fires, and so callers
 * that deliberately want the undeclared state say so explicitly.
 */
export function seatCollectiveMemberWithoutDeclaration(
  userId: string,
  opts: SeatCollectiveMemberOptions = {},
): void {
  collectiveMembershipStore.activate(
    userId,
    opts.activatedBy ?? FIXTURE_ADMIN,
    opts.tier ?? "standard",
    {
      ...(opts.chapterId ? { chapterId: opts.chapterId } : {}),
      ...(opts.capTableExempt === true ? { capTableExempt: true } : {}),
    },
  );
  if (opts.capTableExempt !== true) {
    if (opts.companyId) upsertCapTablePositionForTests(userId, opts.companyId);
    else upsertCapTablePositionForTests(userId);
  }
}

/**
 * ALL FOUR STEPS: seats a Collective investor who genuinely satisfies the whole
 * `requireCollectiveMember` decision tree — active membership, cap-table position
 * (or a durable exemption), AND a recorded W2-A1 accreditation self-declaration.
 *
 * Idempotent: safe to call twice for the same user (the declaration table is
 * append-only and hash-chained, so a second call simply extends the chain).
 *
 * @throws if the declaration could not be recorded, or if the gate would still
 *         refuse afterwards. Failing loudly is intentional — see the header.
 */
export function seatCompliantInvestor(
  userId: string,
  opts: SeatCompliantInvestorOptions = {},
): void {
  if (!userId) throw new Error("[w134 fixture] seatCompliantInvestor: userId is required");

  seatCollectiveMemberWithoutDeclaration(userId, opts);

  // Step 4 — the real capture primitive, the same one the POST route calls.
  const result = recordAccreditationDeclaration(userId, {
    signatureName: opts.signatureName ?? "Test Investor",
    criteria: opts.criteria ?? [DEFAULT_CRITERION],
    jurisdiction: opts.jurisdiction ?? "US",
  });
  if (!result.ok) {
    throw new Error(
      `[w134 fixture] accreditation declaration REFUSED for ${userId}: ` +
        `${result.error} — ${result.message}. The fixture has not seated a compliant ` +
        `investor and the Collective routes will still 403.`,
    );
  }

  // Postcondition. If this ever fails, the fixture is silently vacuous and every
  // test that depends on it would pass while proving nothing. Fail loudly instead.
  const status = getAccreditationGateStatus(userId).status;
  if (status === "none") {
    throw new Error(
      `[w134 fixture] POSTCONDITION FAILED for ${userId}: accreditation gate status ` +
        `is still "none" after a declaration was recorded. requireCollectiveMember ` +
        `would still refuse 403 ACCREDITATION_DECLARATION_REQUIRED.`,
    );
  }
}

/** Convenience: seat several fully compliant investors under one set of options. */
export function seatCompliantInvestors(
  userIds: readonly string[],
  opts: SeatCompliantInvestorOptions = {},
): void {
  for (const uid of userIds) seatCompliantInvestor(uid, opts);
}

/**
 * Records ONLY the accreditation self-declaration for a user whose membership and
 * cap-table position some other fixture already established (e.g. an
 * admin-bootstrap flow under test, whose activation path is the thing being
 * asserted and so must not be replaced).
 *
 * @throws on refusal, for the same reason as above.
 */
export function declareAccreditationForTests(
  userId: string,
  opts: Pick<SeatCompliantInvestorOptions, "signatureName" | "criteria" | "jurisdiction"> = {},
): void {
  const result = recordAccreditationDeclaration(userId, {
    signatureName: opts.signatureName ?? "Test Investor",
    criteria: opts.criteria ?? [DEFAULT_CRITERION],
    jurisdiction: opts.jurisdiction ?? "US",
  });
  if (!result.ok) {
    throw new Error(
      `[w134 fixture] accreditation declaration REFUSED for ${userId}: ` +
        `${result.error} — ${result.message}`,
    );
  }
}

export default seatCompliantInvestor;
