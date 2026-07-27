/**
 * W-AVI65 FIX 2 — founder↔investor DM shows the real name (and ONLY when allowed).
 *
 * CONFIRMED: the live Messages UI reads GET /api/comms/channels and renders
 * `displayTitle`. commsStore.projectChannel → resolveIdentity already calls the
 * SACRED resolveDisplayName with an `isCoMember` flag, but that flag came from
 * SACRED areCoMembersOnAnyCapTable(), which self-joins captable_commits on
 * `investor_id` for BOTH sides — an INVESTOR↔INVESTOR-only rule. A FOUNDER is
 * never an investor_id row on their own cap table, so a founder never qualified
 * and every founder↔investor DM masked to "Private Investor".
 *
 * FIX: a NEW caller-side predicate (server/lib/dmCoMembership.ts) that ORs in
 * founder↔holder co-membership derived from company_members + captable_commits,
 * used for the DM case only. The sacred resolver and the sacred investor↔investor
 * helper are both untouched (the latter is called unchanged as one disjunct).
 *
 * The negative tests are the point of this file: widening isCoMember must NOT
 * leak a name to a non-co-member, and must NOT override an explicit opt-out.
 *
 * LIVE ENDPOINT UNDER TEST: the identity path behind GET /api/comms/channels
 * (`displayTitle`), exercised at the predicate + resolver level so no HTTP
 * fixture is needed.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { areDmCoMembers } from "../lib/dmCoMembership";
import { areCoMembersOnAnyCapTable } from "../lib/capTableMembership";
import { resolveDisplayName, writeUserPrivacy } from "../lib/userPrivacyResolver";
import { rawDb } from "../db/connection";

const STAMP = Date.now();
const FOUNDER = `u_wavi65_founder_${STAMP}`;
const HOLDER = `u_wavi65_investor_${STAMP}`;
const HOLDER2 = `u_wavi65_investor2_${STAMP}`;
const OPTED_OUT = `u_wavi65_optout_${STAMP}`;
const STRANGER = `u_wavi65_stranger_${STAMP}`;
const OTHER_FOUNDER = `u_wavi65_founder2_${STAMP}`;

const COMPANY = `co_wavi65dm_${STAMP}`;
const OTHER_COMPANY = `co_wavi65dm_other_${STAMP}`;

function db(): any {
  return rawDb();
}

function seedFounderMember(userId: string, companyId: string, role = "founder"): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO company_members
         (id, company_id, user_id, role, title, tenant_id, consortium_partner_id,
          is_active, joined_at, last_active_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL, ?, NULL, 1, ?, ?, NULL)`,
    )
    .run(
      `cm_${userId}_${companyId}`,
      companyId,
      userId,
      role,
      `tenant_${companyId}`,
      new Date().toISOString(),
      new Date().toISOString(),
    );
}

let seq = 0;
function seedCommit(companyId: string, investorId: string, state = "committed"): void {
  seq += 1;
  db()
    .prepare(
      `INSERT OR REPLACE INTO captable_commits
         (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
          amount, currency, shares, state, prev_hash, hash, reconcile_primary,
          reconcile_ref, reconcile_match, compliance_hold, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '100000', 'USD', '1000', ?, '0', ?, NULL, NULL, 1, 0, NULL)`,
    )
    .run(
      `cc_wavi65_${STAMP}_${seq}`,
      `tenant_${companyId}`,
      1000 + seq,
      new Date().toISOString(),
      `inv_wavi65_${STAMP}_${seq}`,
      `rnd_wavi65_${STAMP}`,
      companyId,
      investorId,
      state,
      `hash_wavi65_${STAMP}_${seq}`,
    );
}

beforeAll(() => {
  // COMPANY: FOUNDER founds it; HOLDER, HOLDER2 and OPTED_OUT hold on its cap table.
  seedFounderMember(FOUNDER, COMPANY);
  seedCommit(COMPANY, HOLDER);
  seedCommit(COMPANY, HOLDER2);
  seedCommit(COMPANY, OPTED_OUT);
  // OTHER_COMPANY: a completely unrelated tenant with no shared holders.
  seedFounderMember(OTHER_FOUNDER, OTHER_COMPANY);

  writeUserPrivacy(OPTED_OUT, { visibleToCoMembers: false, screenName: "" });
  writeUserPrivacy(HOLDER, { visibleToCoMembers: true, screenName: "" });
}, 30_000);

describe("W-AVI65 FIX 2 — the widened DM predicate recognises founder↔investor", () => {
  it("founder → committed holder on their own company is a co-member", () => {
    expect(areDmCoMembers(FOUNDER, HOLDER)).toBe(true);
  });

  it("is symmetric (holder → founder)", () => {
    expect(areDmCoMembers(HOLDER, FOUNDER)).toBe(true);
  });

  it("the SACRED investor↔investor rule still works and is one of the disjuncts", () => {
    expect(areCoMembersOnAnyCapTable(HOLDER, HOLDER2)).toBe(true);
    expect(areDmCoMembers(HOLDER, HOLDER2)).toBe(true);
  });

  it("the OLD investor-only rule could NOT see the founder — this is the bug being fixed", () => {
    // Regression anchor: if this ever becomes true, the sacred helper changed.
    expect(areCoMembersOnAnyCapTable(FOUNDER, HOLDER)).toBe(false);
  });

  it("a co-member founder now RESOLVES the investor's real name in the message context", () => {
    const name = resolveDisplayName(HOLDER, FOUNDER, "message", {
      legalName: "Priya Venkatesh",
      isCoMember: areDmCoMembers(HOLDER, FOUNDER),
    });
    expect(name).toBe("Priya Venkatesh");
  });
});

describe("W-AVI65 FIX 2 — NEGATIVE: no identity leak", () => {
  it("a user with NO cap-table relationship is NOT a co-member", () => {
    expect(areDmCoMembers(FOUNDER, STRANGER)).toBe(false);
    expect(areDmCoMembers(STRANGER, HOLDER)).toBe(false);
  });

  it("founder↔founder cold DM (no shared cap table) is NOT a co-member", () => {
    expect(areDmCoMembers(FOUNDER, OTHER_FOUNDER)).toBe(false);
  });

  it("a non-co-member still sees \"Private Investor\"", () => {
    const name = resolveDisplayName(HOLDER, STRANGER, "message", {
      legalName: "Priya Venkatesh",
      isCoMember: areDmCoMembers(HOLDER, STRANGER),
    });
    expect(name).toBe("Private Investor");
  });

  it("an OPTED-OUT investor still sees \"Private Investor\" EVEN as a real co-member", () => {
    // The opt-out is evaluated BEFORE isCoMember in the sacred resolver, so
    // widening isCoMember cannot unmask an opted-out subject.
    expect(areDmCoMembers(FOUNDER, OPTED_OUT)).toBe(true);
    const name = resolveDisplayName(OPTED_OUT, FOUNDER, "message", {
      legalName: "Do Not Show Me",
      isCoMember: true,
    });
    expect(name).toBe("Private Investor");
  });

  it("a founder on a DIFFERENT company gets nothing from that company's holders", () => {
    expect(areDmCoMembers(OTHER_FOUNDER, HOLDER)).toBe(false);
  });

  it("self-pairs and malformed ids are never co-members (fail-closed)", () => {
    expect(areDmCoMembers(FOUNDER, FOUNDER)).toBe(false);
    expect(areDmCoMembers("", HOLDER)).toBe(false);
    expect(areDmCoMembers(HOLDER, "   ")).toBe(false);
    expect(areDmCoMembers(undefined as any, HOLDER)).toBe(false);
  });

  it("a non-committed (e.g. pending) holding does NOT create co-membership", () => {
    const pending = `u_wavi65_pending_${STAMP}`;
    seedCommit(COMPANY, pending, "pending");
    expect(areDmCoMembers(FOUNDER, pending)).toBe(false);
  });

  it("an INACTIVE / soft-deleted company_members row does NOT create co-membership", () => {
    const exFounder = `u_wavi65_exfounder_${STAMP}`;
    seedFounderMember(exFounder, COMPANY);
    db()
      .prepare(`UPDATE company_members SET is_active = 0 WHERE user_id = ?`)
      .run(exFounder);
    expect(areDmCoMembers(exFounder, HOLDER)).toBe(false);

    db()
      .prepare(`UPDATE company_members SET is_active = 1, deleted_at = ? WHERE user_id = ?`)
      .run(new Date().toISOString(), exFounder);
    expect(areDmCoMembers(exFounder, HOLDER)).toBe(false);
  });

  it("a non-founder company_members role (e.g. employee) does NOT create co-membership", () => {
    const employee = `u_wavi65_employee_${STAMP}`;
    seedFounderMember(employee, COMPANY, "employee");
    expect(areDmCoMembers(employee, HOLDER)).toBe(false);
  });
});

describe("W-AVI65 FIX 2 — commsStore wiring contract", () => {
  const src = readFileSync(join(process.cwd(), "server", "commsStore.ts"), "utf8");

  it("resolveIdentity uses the widened predicate ONLY for the dm case", () => {
    expect(src).toContain("areDmCoMembers");
    expect(src).toContain('opts?.dm === true');
    // The legacy predicate is still used for every non-DM surface.
    expect(src).toContain("areCoMembersOnAnyCapTable(authorUserId, viewerUserId)");
  });

  it("the DM channel projection passes dm:true", () => {
    expect(src).toContain("{ dm: true }");
  });

  it("legalName is resolved from the DB when COMMS_USERS lacks the user", () => {
    expect(src).toContain("dbLegalNameFor(authorUserId, a.legalName)");
  });
});
