/* ════════════════════════════════════════════════════════════════════════════
   WAVE 120 · FINDING 2 — ONE COMMITTED FIGURE PER SPV, INCLUDING ON THE PARTNER
   TILE THAT USED TO COMPUTE ITS OWN.
   ════════════════════════════════════════════════════════════════════════════
   WHAT WAS BROKEN. `client/src/components/partner/SpvDetailTabs.tsx:403` read

       const raised = register.reduce((a, r) => a + r.commitmentMinor, 0);

   over the server's `investorRegister`, whose filter is `status !== "withdrawn"`
   and whose own doc comment says it is "NOT for money gates". `review`,
   `soft_circled`, `founder_confirmed` and `wire_funded` subscriptions were
   therefore displayed as money RAISED, beside the target, under the label "Raise
   progress" — Wave 112's "one committed figure" was false on that surface.

   GROUP (A) pins the shared predicate. GROUP (B) is the DRIFT FENCE: it asserts
   the shared `committed` spelling is the same string as the server's own
   canonical `COMMITTED_SUBSCRIPTION_STATUS`, so "one predicate" cannot quietly
   become two again. GROUP (C) is the FAIL-BEFORE proof: the old expression is
   re-run over the same fixture and shown to report a larger figure that includes
   a soft circle. GROUP (D) reads the component source and pins that the tile now
   goes through the shared predicate and performs no float money arithmetic.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SPV_COMMITTED_SUBSCRIPTION_STATUS,
  SPV_UNCOMMITTED_PENDING_STATUSES,
  isCommittedSubscriptionRow,
  committedMinorFromSubscriptions,
  summariseCommittedCapital,
  pendingSubscriptionsStatement,
} from "@shared/spvCommittedCapital";
import { COMMITTED_SUBSCRIPTION_STATUS } from "../spvEngineStore";

/* The fixture is one of each declared status, with distinguishable amounts so a
   wrong predicate cannot accidentally produce the right total. */
const ROWS = [
  { investorId: "i_committed_a", status: "committed", commitmentMinor: 250_000_00 },
  { investorId: "i_committed_b", status: "committed", commitmentMinor: 100_000_00 },
  { investorId: "i_review", status: "review", commitmentMinor: 500_000_00 },
  { investorId: "i_soft", status: "soft_circled", commitmentMinor: 400_000_00 },
  { investorId: "i_confirmed", status: "founder_confirmed", commitmentMinor: 300_000_00 },
  { investorId: "i_wired", status: "wire_funded", commitmentMinor: 200_000_00 },
  { investorId: "i_withdrawn", status: "withdrawn", commitmentMinor: 900_000_00 },
];

/** $350,000.00 — the two `committed` rows and nothing else. */
const TRUE_COMMITTED_MINOR = BigInt(250_000_00 + 100_000_00);

describe("(A) the shared predicate counts committed capital and nothing else", () => {
  it("sums ONLY committed rows, in bigint", () => {
    const total = committedMinorFromSubscriptions(ROWS);
    expect(typeof total).toBe("bigint");
    expect(total).toBe(TRUE_COMMITTED_MINOR);
  });

  it("a soft_circled row does NOT raise the figure", () => {
    const withSoft = committedMinorFromSubscriptions(ROWS);
    const withoutSoft = committedMinorFromSubscriptions(ROWS.filter((r) => r.status !== "soft_circled"));
    expect(withSoft).toBe(withoutSoft);
  });

  it("a review row does NOT raise the figure", () => {
    const withReview = committedMinorFromSubscriptions(ROWS);
    const withoutReview = committedMinorFromSubscriptions(ROWS.filter((r) => r.status !== "review"));
    expect(withReview).toBe(withoutReview);
  });

  it("neither does founder_confirmed nor wire_funded — a wire is cash, not a commitment record", () => {
    const only = committedMinorFromSubscriptions(
      ROWS.filter((r) => r.status === "founder_confirmed" || r.status === "wire_funded"),
    );
    expect(only).toBe(BigInt(0));
  });

  it("names every pre-commitment status it excludes, so a surface can disclose them", () => {
    expect([...SPV_UNCOMMITTED_PENDING_STATUSES]).not.toContain("committed");
    expect([...SPV_UNCOMMITTED_PENDING_STATUSES]).not.toContain("withdrawn");
    expect([...SPV_UNCOMMITTED_PENDING_STATUSES]).toContain("soft_circled");
    expect([...SPV_UNCOMMITTED_PENDING_STATUSES]).toContain("review");
  });

  it("reports a committed row with NO recorded amount instead of counting it as zero", () => {
    const s = summariseCommittedCapital([
      { status: "committed", commitmentMinor: 100_00 },
      { status: "committed", commitmentMinor: null },
    ]);
    expect(s.committedMinor).toBe(BigInt(100_00));
    expect(s.committedRows).toBe(2);
    expect(s.unusableRows).toBe(1);
    expect(pendingSubscriptionsStatement(s)).toMatch(/no recorded amount/i);
  });

  it("discloses the pending rows in words, and says nothing when there are none", () => {
    const statement = pendingSubscriptionsStatement(summariseCommittedCapital(ROWS));
    expect(statement).toMatch(/Not counted as raised/);
    expect(statement).toMatch(/soft circled/);
    expect(pendingSubscriptionsStatement(summariseCommittedCapital([
      { status: "committed", commitmentMinor: 1 },
    ]))).toBeNull();
  });

  it("treats a missing subscription list as nothing to sum, not as a figure of zero to display", () => {
    /* The predicate returns 0n for no rows; it is the SURFACE's job to refuse.
       Group (D) pins that the tile does exactly that. */
    expect(committedMinorFromSubscriptions(undefined)).toBe(BigInt(0));
    expect(isCommittedSubscriptionRow(undefined)).toBe(false);
  });
});

describe("(B) DRIFT FENCE — the shared spelling IS the server's canonical spelling", () => {
  it("shared SPV_COMMITTED_SUBSCRIPTION_STATUS === server COMMITTED_SUBSCRIPTION_STATUS", () => {
    expect(SPV_COMMITTED_SUBSCRIPTION_STATUS).toBe(COMMITTED_SUBSCRIPTION_STATUS);
  });
});

describe("(C) FAIL-BEFORE — the tile's old expression, over the same fixture", () => {
  it("the register-wide sum reports MORE than the committed figure, and a soft circle raises it", () => {
    /* Verbatim behaviour of the deleted line, including the `number` arithmetic. */
    const legacyRegister = ROWS.filter((r) => r.status !== "withdrawn");
    const legacyRaised = legacyRegister.reduce((a, r) => a + (r.commitmentMinor ?? 0), 0);

    expect(BigInt(legacyRaised)).toBeGreaterThan(TRUE_COMMITTED_MINOR);
    /* $1,750,000 claimed as raised against $350,000 genuinely committed. */
    expect(legacyRaised).toBe(1_750_000_00);

    const legacyWithoutSoft = legacyRegister
      .filter((r) => r.status !== "soft_circled")
      .reduce((a, r) => a + (r.commitmentMinor ?? 0), 0);
    expect(legacyWithoutSoft).toBeLessThan(legacyRaised);

    /* The shared predicate is indifferent to the soft circle, which is the fix. */
    expect(committedMinorFromSubscriptions(ROWS)).toBe(
      committedMinorFromSubscriptions(ROWS.filter((r) => r.status !== "soft_circled")),
    );
  });
});

describe("(D) the shipped tile goes through the predicate and never parses money", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../client/src/components/partner/SpvDetailTabs.tsx"),
    "utf8",
  );

  it("the old register sum is gone from the component as CODE", () => {
    /* The expression survives only inside the block comment that explains why it
       was wrong — quoted at nine spaces of indentation, never at statement
       depth. A live statement would sit at two spaces. */
    expect(src).not.toMatch(/\n {1,6}const raised = register\.reduce/);
    /* and it IS still quoted in the explanation, so the record of the defect is
       not lost either. */
    expect(src).toMatch(/\n {7,}const raised = register\.reduce/);
  });

  it("the figure comes from the shared predicate and renders through the bigint formatter", () => {
    expect(src).toContain('from "@shared/spvCommittedCapital"');
    expect(src).toContain("summariseCommittedCapital(subs)");
    expect(src).toContain("displayCompanyMinor(committedMinor, currency)");
  });

  it("refuses in words rather than printing a confident zero when no register arrived", () => {
    expect(src).toContain("committedReported");
    expect(src).toContain("that is unknown, not zero");
  });

  it("no Number(), parseInt or parseFloat is applied to the committed figure", () => {
    const window = src.slice(src.indexOf("const committedSummary"), src.indexOf("const committedSummary") + 800);
    expect(window).not.toMatch(/Number\(/);
    expect(window).not.toMatch(/parseInt|parseFloat/);
  });
});
