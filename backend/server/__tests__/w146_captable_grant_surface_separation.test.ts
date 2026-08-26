/* ════════════════════════════════════════════════════════════════════════════
   WAVE 146 — A CAP-TABLE VISIBILITY GRANT MUST GRANT THE CAP TABLE, AND
   NOTHING ELSE.
   ════════════════════════════════════════════════════════════════════════════
   WHAT WAS BROKEN (the REAL defect; the originally-briefed one was not live).
   `server/lib/capTableSinkScope.ts:195-206` ALREADY returns
   `allow / founder_granted_visibility` for a grant-only viewer — pinned by
   `w130_shareholder_register` F5, which this wave does not weaken. The live
   defect is one level up, in the consumer:

     server/routes.ts:2322   const invited = access.outcome !== "refuse";
     server/routes.ts:2323-2326
        canSeeRound = canSeeDataroom = canSeeSoftCircle = canSeeTermSheet = invited;

   ONE cap-table access decision was collapsed into FOUR unrelated surface
   grants, so:

   (a) a founder who shares a CAP TABLE unknowingly also shares the DATAROOM,
       the SOFT CIRCLES and the TERM SHEET; and
   (b) an SPV LP whose decision is `scope_to_self` / `spv_lp_own_only` — an LP
       entitled to see ONLY their own position — is not "refuse", so
       `invited` is true and the LP receives the company-wide gated surfaces.

   Both are confidentiality defects. Neither is fixed by touching the decision
   authority; both are fixed by making each surface an explicit decision.

   NOT RELAXED: the 404 at `routes.ts:2337-2339` still fires for `refuse`, so a
   stranger is unchanged. Grant holders and own-position LPs keep the cap-table
   access they have today — this wave removes only the three surfaces they were
   never granted.

   GROUP (Z) IS THE FAIL-BEFORE PROOF and asserts the OLD behaviour is gone.
   Before the fix, Z1/Z2 fail because every flag is `true`.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import {
  gatedSurfaceAccessFor,
  type CapTableSinkAccess,
} from "../lib/capTableSinkScope";

function access(over: Partial<CapTableSinkAccess>): CapTableSinkAccess {
  return {
    outcome: "refuse",
    scopedToUserId: null,
    reason: "no_relationship",
    ...over,
  } as CapTableSinkAccess;
}

describe("W146 · (Z) FAIL-BEFORE — one decision may not grant four surfaces", () => {
  it("Z1 · a cap-table GRANT does not open the dataroom, soft circles or the term sheet", () => {
    const g = gatedSurfaceAccessFor(
      access({
        outcome: "allow",
        scopedToUserId: null,
        reason: "founder_granted_visibility",
        grantedVisibility: {
          grantId: "g_1",
          subjectKind: "consortium_partner",
          subjectLabel: "Keiretsu Forum Canada",
          expiresAt: "2027-01-01T00:00:00.000Z",
        },
      }),
    );
    expect(g.canSeeRound).toBe(false);
    expect(g.canSeeDataroom).toBe(false);
    expect(g.canSeeSoftCircle).toBe(false);
    expect(g.canSeeTermSheet).toBe(false);
    /* The cap table itself is UNCHANGED — nothing is taken away. */
    expect(g.capTableAllowed).toBe(true);
    /* And the viewer is told WHY, in a machine code the client maps to prose. */
    expect(g.visibilityBasis).toBe("cap_table_grant");
  });

  it("Z2 · an SPV LP scoped to their own position does not get the company-wide surfaces", () => {
    const g = gatedSurfaceAccessFor(
      access({
        outcome: "scope_to_self",
        scopedToUserId: "u_lp",
        reason: "spv_lp_own_only",
      }),
    );
    expect(g.canSeeRound).toBe(false);
    expect(g.canSeeDataroom).toBe(false);
    expect(g.canSeeSoftCircle).toBe(false);
    expect(g.canSeeTermSheet).toBe(false);
    expect(g.capTableAllowed).toBe(true);
    expect(g.visibilityBasis).toBe("own_position_only");
  });
});

describe("W146 · (A) WHAT MUST NOT CHANGE", () => {
  it("A1 · a direct counterparty keeps all four surfaces", () => {
    const g = gatedSurfaceAccessFor(
      access({ outcome: "allow", scopedToUserId: null, reason: "direct_counterparty" }),
    );
    expect(g.canSeeRound).toBe(true);
    expect(g.canSeeDataroom).toBe(true);
    expect(g.canSeeSoftCircle).toBe(true);
    expect(g.canSeeTermSheet).toBe(true);
    expect(g.capTableAllowed).toBe(true);
    expect(g.visibilityBasis).toBe("full");
  });

  it("A2 · an SPV co-investor keeps all four surfaces (unchanged from today)", () => {
    const g = gatedSurfaceAccessFor(
      access({ outcome: "allow", scopedToUserId: null, reason: "spv_lp_co_investors" }),
    );
    expect(g.canSeeDataroom).toBe(true);
    expect(g.canSeeTermSheet).toBe(true);
    expect(g.visibilityBasis).toBe("full");
  });

  it("A3 · a REFUSED viewer is refused everywhere — the 404 path is not relaxed", () => {
    const g = gatedSurfaceAccessFor(access({}));
    expect(g.capTableAllowed).toBe(false);
    expect(g.canSeeRound).toBe(false);
    expect(g.canSeeDataroom).toBe(false);
    expect(g.canSeeSoftCircle).toBe(false);
    expect(g.canSeeTermSheet).toBe(false);
    expect(g.visibilityBasis).toBe("none");
  });
});

describe("W146 · (B) THE CONSUMER ACTUALLY USES IT", () => {
  it("B1 · routes.ts no longer derives four flags from one boolean", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/routes.ts", "utf8");
    /* Comments STRIPPED before any conclusion — the trap that has caught
       seven agents on this platform. */
    const live = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(live).toContain("gatedSurfaceAccessFor(access)");
    expect(live).not.toContain("const invited = access.outcome !== \"refuse\";");
    /* Each surface is assigned from its OWN named field, not from `invited`. */
    expect(live).toContain("canSeeDataroom = surfaces.canSeeDataroom");
    expect(live).toContain("canSeeTermSheet = surfaces.canSeeTermSheet");
  });
});
