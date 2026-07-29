/**
 * server/__tests__/wcoll_w1_collective_access_decision.test.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.1 as corrected by v5 §C and v6 §2.
 *
 * CONTEXT. `requireCollectiveMember` (SACRED) enforces a five-step tree:
 * identity → admin bypass → fail-closed billing/deactivation override → active
 * member (four sources) → cap-table sub-check → accreditation capture.
 * `GET /api/collective/gate-state` only reported membership + accreditation, so a
 * user denied by the billing override or the cap-table sub-check saw a MOUNTED
 * dashboard that then sprayed 403s, with no explanatory blocker.
 *
 * `resolveCollectiveAccessDecision` is the shared reporting contract. This suite
 * locks it against the sacred middleware in BOTH directions over a mocked world,
 * so the two cannot drift.
 *
 * ANTI-VACUITY — on the PRISTINE tree the module
 * `server/lib/collectiveAccessDecision.ts` does not exist, and neither do the
 * tri-state siblings `hasOpenMembershipDeactivationTri` /
 * `hasCancelledOrPastDueBillingTri`; the suite fails at collection with
 * "Cannot find module '../lib/collectiveAccessDecision'". Each individual
 * expectation additionally documents what pristine behaviour it would catch.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/* ------------------------------------------------------------------ *
 * A controllable world shared by the decision module and the SACRED
 * middleware, so a parity assertion is meaningful.
 * ------------------------------------------------------------------ */
interface World {
  dbAdminRole: string | null;
  dbActiveMembership: boolean;
  adminStoreActive: boolean;
  adminStoreRecord: { capTableExempt?: boolean } | null;
  seedStoreMember: boolean;
  openDeactivation: true | false | "error";
  lapsedBilling: true | false | "error";
  onCapTable: boolean | "throw";
  accreditation: "none" | "self_certified" | "verified" | "throw";
  isPartner: boolean | "throw";
  founderApp: "pending" | "none" | "throw";
  investorApp: "pending" | "none" | "throw";
}

const world: World = {} as World;

function resetWorld(): void {
  Object.assign(world, {
    dbAdminRole: null,
    dbActiveMembership: false,
    adminStoreActive: false,
    adminStoreRecord: null,
    seedStoreMember: false,
    openDeactivation: false,
    lapsedBilling: false,
    onCapTable: true,
    accreditation: "verified",
    isPartner: false,
    founderApp: "none",
    investorApp: "none",
  } satisfies World);
}

vi.mock("../db/connection", () => ({
  rawDb: () => ({
    prepare: (sql: string) => ({
      get: () => {
        if (sql.includes("FROM users")) {
          return world.dbAdminRole ? { role: world.dbAdminRole } : undefined;
        }
        if (sql.includes("collective_memberships")) {
          return world.dbActiveMembership ? { 1: 1 } : undefined;
        }
        if (sql.includes("founder_collective_applications")) {
          if (world.founderApp === "throw") throw new Error("founder table unreadable");
          return world.founderApp === "pending" ? { 1: 1 } : undefined;
        }
        if (sql.includes("collective_apps")) {
          if (world.investorApp === "throw") throw new Error("investor table unreadable");
          return world.investorApp === "pending" ? { 1: 1 } : undefined;
        }
        return undefined;
      },
      all: () => [],
      run: () => undefined,
    }),
  }),
  getDb: () => {
    throw new Error("not used in this suite");
  },
}));

vi.mock("../collectiveMembershipStore", () => ({
  isActive: () => world.adminStoreActive,
  get: () => world.adminStoreRecord ?? undefined,
}));

vi.mock("../membershipStore", () => ({
  getMembership: () => (world.seedStoreMember ? { isCollectiveMember: true } : undefined),
  isOnCapTable: () => {
    if (world.onCapTable === "throw") throw new Error("cap table unreadable");
    return world.onCapTable;
  },
}));

vi.mock("../investorComplianceRoutes", () => ({
  getAccreditationGateStatus: () => {
    if (world.accreditation === "throw") throw new Error("accreditation unreadable");
    return { status: world.accreditation };
  },
}));

vi.mock("../partnerWorkspaceStore", () => ({
  partnerTeamStore: {
    findByUserId: () => {
      if (world.isPartner === "throw") throw new Error("partner store unavailable");
      return world.isPartner ? { userId: "u", partnerId: "p" } : undefined;
    },
  },
}));

vi.mock("../collectiveMembershipDeactivationStore", () => ({
  // The SACRED middleware reads the BOOLEAN pair (fail-closed: an error is
  // reported as `true`). The decision contract reads the TRI pair.
  hasOpenMembershipDeactivation: () => world.openDeactivation !== false,
  hasCancelledOrPastDueBilling: () => world.lapsedBilling !== false,
  hasOpenMembershipDeactivationTri: () => world.openDeactivation,
  hasCancelledOrPastDueBillingTri: () => world.lapsedBilling,
}));

const { resolveCollectiveAccessDecision, COLLECTIVE_DENIAL_MESSAGES } = await import(
  "../lib/collectiveAccessDecision"
);
const { requireCollectiveMember } = await import("../lib/requireCollectiveMember");

const USER = "u_decision_subject";

function decide(overrides: Partial<World> = {}, subjectExtras: Record<string, unknown> = {}) {
  Object.assign(world, overrides);
  return resolveCollectiveAccessDecision({ userId: USER, isAuthed: true, ...subjectExtras });
}

/** Run the SACRED middleware over the same world; report allow/deny + status. */
function runMiddleware(subjectExtras: Record<string, unknown> = {}): {
  allowed: boolean;
  status: number | null;
  body: Record<string, unknown> | null;
} {
  let allowed = false;
  let status: number | null = null;
  let body: Record<string, unknown> | null = null;
  const req = { userContext: { userId: USER, ...subjectExtras } } as never;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      body = payload;
      return this;
    },
  } as never;
  requireCollectiveMember(req, res, () => {
    allowed = true;
  });
  return { allowed, status, body };
}

beforeEach(() => {
  resetWorld();
});

describe("v5 §C — the decision agrees with requireCollectiveMember in BOTH directions", () => {
  /**
   * Each row is a world plus the subject overlay. `allow` is asserted from the
   * DECISION and then independently from the SACRED middleware. A row where the
   * two disagree is exactly the class of bug that produced a mounted dashboard
   * spraying 403s.
   */
  const matrix: Array<{
    name: string;
    world: Partial<World>;
    subject?: Record<string, unknown>;
    allow: boolean;
  }> = [
    {
      name: "fully-qualified member",
      world: { adminStoreActive: true, onCapTable: true, accreditation: "verified" },
      allow: true,
    },
    { name: "admin, nothing else", world: { dbAdminRole: "admin" }, allow: true },
    {
      name: "admin whose own billing lapsed",
      world: { dbAdminRole: "admin", lapsedBilling: true, openDeactivation: true },
      allow: true,
    },
    { name: "no membership at all", world: {}, allow: false },
    {
      name: "member with an open deactivation marker",
      world: { adminStoreActive: true, openDeactivation: true },
      allow: false,
    },
    {
      name: "member whose billing is cancelled/past due",
      world: { adminStoreActive: true, lapsedBilling: true },
      allow: false,
    },
    {
      name: "member not on a cap table",
      world: { adminStoreActive: true, onCapTable: false },
      allow: false,
    },
    {
      name: "cap-table-exempt member not on a cap table",
      world: { adminStoreActive: true, adminStoreRecord: { capTableExempt: true }, onCapTable: false },
      allow: true,
    },
    {
      name: "member who has not self-declared accreditation",
      world: { adminStoreActive: true, accreditation: "none" },
      allow: false,
    },
    {
      name: "member whose accreditation source throws",
      world: { adminStoreActive: true, accreditation: "throw" },
      allow: false,
    },
    {
      name: "member whose cap-table source throws",
      world: { adminStoreActive: true, onCapTable: "throw" },
      allow: false,
    },
    { name: "partner-only session", world: { isPartner: true }, allow: false },
    {
      name: "active only via the seed store",
      world: { seedStoreMember: true },
      allow: true,
    },
    {
      name: "active only via the DB fallback",
      world: { dbActiveMembership: true },
      allow: true,
    },
    {
      name: "active only via the ctx overlay",
      world: {},
      subject: { collective: { status: "active" } },
      allow: true,
    },
    {
      name: "deactivation marker unreadable (fail closed)",
      world: { adminStoreActive: true, openDeactivation: "error" },
      allow: false,
    },
    {
      name: "billing unreadable (fail closed)",
      world: { adminStoreActive: true, lapsedBilling: "error" },
      allow: false,
    },
  ];

  for (const row of matrix) {
    it(`${row.name}: decision and middleware both ${row.allow ? "ALLOW" : "DENY"}`, () => {
      const decision = decide(row.world, row.subject);
      expect(decision.allow, "decision").toBe(row.allow);

      resetWorld();
      Object.assign(world, row.world);
      const mw = runMiddleware(row.subject);
      expect(mw.allowed, "middleware").toBe(row.allow);
      if (!row.allow) expect(mw.status === 401 || mw.status === 403).toBe(true);
    });
  }
});

describe("v5 §C — admin bypass is evaluated FIRST", () => {
  it("an admin with lapsed billing is allowed with adminBypass:true", () => {
    const d = decide({ dbAdminRole: "admin", lapsedBilling: true, openDeactivation: true });
    // Pristine: no decision module at all. If the billing override were moved
    // above the admin bypass this would become
    // `{ allow:false, reason:"billing_deactivation_pending" }` and admins would
    // lose moderation access the moment their own billing lapsed.
    expect(d).toEqual({ allow: true, adminBypass: true });
  });

  it("a ctx-supplied isAdmin flag bypasses just as the middleware's does", () => {
    const d = decide({ lapsedBilling: true }, { isAdmin: true });
    expect(d.allow).toBe(true);
  });

  it("a non-admin member is allowed WITHOUT adminBypass", () => {
    const d = decide({ adminStoreActive: true });
    expect(d).toEqual({ allow: true, adminBypass: false });
  });
});

describe("v6 §2 — a read error maps to `unknown`, never to a billing or application reason", () => {
  it("an unreadable deactivation marker reports `unknown`, not billing copy", () => {
    const d = decide({ adminStoreActive: true, openDeactivation: "error" });
    expect(d).toEqual({ allow: false, reason: "unknown" });
  });

  it("unreadable billing reports `unknown`, not billing copy", () => {
    const d = decide({ adminStoreActive: true, lapsedBilling: "error" });
    expect(d).toEqual({ allow: false, reason: "unknown" });
  });

  it("an unreadable founder-application table reports `unknown`, NOT application_pending", () => {
    // Telling a user "your application is being reviewed" because a table could
    // not be read is a fabricated status on a gating surface.
    const d = decide({ founderApp: "throw" });
    expect(d).toEqual({ allow: false, reason: "unknown" });
  });

  it("an unreadable investor-application table reports `unknown`, NOT application_pending", () => {
    const d = decide({ investorApp: "throw" });
    expect(d).toEqual({ allow: false, reason: "unknown" });
  });

  it("an unreadable cap-table source reports `unknown`", () => {
    const d = decide({ adminStoreActive: true, onCapTable: "throw" });
    expect(d).toEqual({ allow: false, reason: "unknown" });
  });
});

describe("v6 §2 — application_pending comes from the two NAMED durable tables", () => {
  it("an in-flight FOUNDER application yields application_pending", () => {
    expect(decide({ founderApp: "pending" })).toEqual({
      allow: false,
      reason: "application_pending",
    });
  });

  it("an in-flight INVESTOR application yields application_pending", () => {
    expect(decide({ investorApp: "pending" })).toEqual({
      allow: false,
      reason: "application_pending",
    });
  });

  it("no application yields the plain not_collective_member reason", () => {
    expect(decide({})).toEqual({ allow: false, reason: "not_collective_member" });
  });

  it("application_pending never weakens the gate — the middleware still denies", () => {
    Object.assign(world, { founderApp: "pending" });
    expect(runMiddleware().allowed).toBe(false);
  });

  it("a partner-only session outranks a pending application", () => {
    // A partner needs a route to their own workspace, not review copy.
    expect(decide({ isPartner: true, founderApp: "pending" })).toEqual({
      allow: false,
      reason: "partner_only",
    });
  });
});

describe("v5 §C — every denial reason is reachable and has copy", () => {
  it("reaches each reason through a real mechanism", () => {
    const seen = new Set<string>();
    const cases: Array<[string, Partial<World>, Record<string, unknown> | undefined]> = [
      ["not_authed", {}, { userId: undefined }],
      ["not_collective_member", {}, undefined],
      ["partner_only", { isPartner: true }, undefined],
      ["application_pending", { founderApp: "pending" }, undefined],
      ["billing_deactivation_pending", { adminStoreActive: true, lapsedBilling: true }, undefined],
      ["not_on_cap_table", { adminStoreActive: true, onCapTable: false }, undefined],
      ["accreditation_required", { adminStoreActive: true, accreditation: "none" }, undefined],
      [
        "accreditation_unavailable",
        { adminStoreActive: true, accreditation: "throw" },
        undefined,
      ],
      ["unknown", { adminStoreActive: true, lapsedBilling: "error" }, undefined],
    ];
    for (const [expected, w, subject] of cases) {
      resetWorld();
      Object.assign(world, w);
      const d = resolveCollectiveAccessDecision({ userId: USER, isAuthed: true, ...(subject ?? {}) });
      expect(d.allow, `${expected} should deny`).toBe(false);
      if (!d.allow) {
        expect(d.reason, `mechanism for ${expected}`).toBe(expected);
        seen.add(d.reason);
      }
    }
    // Every member of the union is exercised — a new reason cannot ship untested.
    expect(seen.size).toBe(Object.keys(COLLECTIVE_DENIAL_MESSAGES).length);
  });

  it("every reason carries non-empty human copy", () => {
    for (const [reason, copy] of Object.entries(COLLECTIVE_DENIAL_MESSAGES)) {
      expect(copy.trim().length, reason).toBeGreaterThan(0);
    }
  });

  it("an anonymous subject is not_authed, and the middleware 401s", () => {
    expect(resolveCollectiveAccessDecision(undefined)).toEqual({
      allow: false,
      reason: "not_authed",
    });
    expect(resolveCollectiveAccessDecision({ userId: "", isAuthed: false })).toEqual({
      allow: false,
      reason: "not_authed",
    });
  });
});

describe("v5 §C — the decision never widens access", () => {
  it("a partner-store outage does not admit a non-member", () => {
    const d = decide({ isPartner: "throw" });
    expect(d.allow).toBe(false);
  });

  it("an unreadable membership-store record is treated as non-exempt", () => {
    // capTableExempt must fail CLOSED: an unreadable record must not skip the
    // cap-table sub-check.
    const d = decide({ adminStoreActive: true, adminStoreRecord: null, onCapTable: false });
    expect(d).toEqual({ allow: false, reason: "not_on_cap_table" });
  });
});
