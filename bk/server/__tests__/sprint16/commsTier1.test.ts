/**
 * Sprint 16 — Track C Tier 1: Cap-table peer (co-investor groups).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetCommsTiers,
  __getTelemetry,
  createCoInvestorGroup,
  postCoInvestorGroupMessage,
  requestCoInvestorIntro,
  coInvestorGroupChain,
} from "../../commsTiersStore";

describe("Sprint 16 C1 — Tier 1 cap-table peer (co_investor_group)", () => {
  beforeEach(() => __resetCommsTiers());

  it("creates a co-investor group with 2+ participants and emits telemetry", () => {
    const grp = createCoInvestorGroup({
      companyId: "co_novapay",
      participants: ["u_hydra", "u_forge"],
      actorId: "u_hydra",
    });
    expect(grp.id).toMatch(/^cig_/);
    expect(grp.companyId).toBe("co_novapay");
    expect(grp.participants).toEqual(["u_hydra", "u_forge"]);
    expect(__getTelemetry().some((e) => e.kind === "co_investor.group.created")).toBe(true);
  });

  it("posts a message into a co-investor group and appends to hash chain", () => {
    const grp = createCoInvestorGroup({
      companyId: "co_novapay",
      participants: ["u_a", "u_b"],
      actorId: "u_a",
    });
    const headBefore = coInvestorGroupChain.head;
    const msg = postCoInvestorGroupMessage({
      groupId: grp.id,
      authorUserId: "u_a",
      body: "Hi team",
    });
    expect(msg.body).toBe("Hi team");
    const headAfter = coInvestorGroupChain.head;
    expect(headAfter).not.toEqual(headBefore);
    expect(__getTelemetry().some((e) => e.kind === "co_investor.group.message.sent")).toBe(true);
  });

  it("requests an intro and emits co_investor.intro.requested", () => {
    const grp = createCoInvestorGroup({
      companyId: "co_novapay",
      participants: ["u_a", "u_b"],
      actorId: "u_a",
    });
    const r = requestCoInvestorIntro({ groupId: grp.id, requesterId: "u_a", targetId: "u_b" });
    expect(r.id).toMatch(/^intro_/);
    expect(r.status).toBe("requested");
    expect(__getTelemetry().some((e) => e.kind === "co_investor.intro.requested")).toBe(true);
  });

  it("rejects message into nonexistent group", () => {
    expect(() =>
      postCoInvestorGroupMessage({ groupId: "cig_missing", authorUserId: "u_a", body: "x" }),
    ).toThrow();
  });
});
