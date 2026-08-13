/**
 * WAVE 33 · CP-MSG-01 — the audience notice renders the OPEN QUESTION.
 *
 * A component that exists but renders nothing is not shipped, and a component
 * that renders a reassuring blank when the policy cannot be read is worse than
 * one that renders nothing. Both are asserted here on EMITTED DOM, with the
 * fetch stubbed so each branch is reached deliberately.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { MessagingAudienceNotice } from "../MessagingAudienceNotice";

const PENDING = {
  viewerRole: "partner",
  rules: [],
  pendingOwnerDecision: [
    {
      ruleKey: "partner_engaged_company_people",
      description: "A Consortium Partner team member may be offered the active members of any company the partner holds an ACTIVE mf_engagement for.",
      recommendedDefault: "RECOMMENDED: enable. The engagement is the commercial relationship.",
    },
  ],
  delegatedContext: {
    partnerId: "pt_1",
    partnerName: null,
    engagements: [{ engagementId: "mfe_1", companyId: "co_1", companyName: "Engaged Co" }],
  },
};

function renderWith(response: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify(response),
      json: async () => response,
      clone() { return this; },
    })) as unknown as typeof fetch,
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MessagingAudienceNotice />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("MessagingAudienceNotice", () => {
  it("U1 states the open owner decision, its rule key and the recommendation", async () => {
    renderWith(PENDING);
    await waitFor(() =>
      expect(screen.getByTestId("audience-pending-owner-decision")).toBeTruthy(),
    );
    const el = screen.getByTestId("audience-pending-partner_engaged_company_people");
    expect(el.textContent).toContain("partner_engaged_company_people");
    expect(el.textContent).toContain("RECOMMENDED");
    /* It says WHY the list is short — the pole against rendering an empty
       picker with no explanation. */
    expect(screen.getByTestId("audience-pending-owner-decision").textContent).toContain(
      "not an error",
    );
  });

  it("U2 renders the delegated context, with a STATED fallback for a missing org name", async () => {
    renderWith(PENDING);
    await waitFor(() => expect(screen.getByTestId("audience-delegated-context")).toBeTruthy());
    const t = screen.getByTestId("audience-delegated-context").textContent ?? "";
    expect(t).toContain("name not on file"); // never invented
    expect(t).toContain("Engaged Co");
  });

  it("U3 POLE — nothing pending and no delegation renders NOTHING at all", async () => {
    const { container } = renderWith({
      viewerRole: "investor",
      rules: [],
      pendingOwnerDecision: [],
      delegatedContext: null,
    });
    await waitFor(() => expect(container.querySelector("[data-testid]")).toBeNull());
    expect(screen.queryByTestId("audience-policy-notice")).toBeNull();
  });

  it("U4 POLE — a failed read renders a STATED failure, never a reassuring blank", async () => {
    renderWith({ message: "boom" }, false);
    await waitFor(() =>
      expect(screen.getByTestId("audience-policy-unavailable")).toBeTruthy(),
    );
    expect(screen.getByTestId("audience-policy-unavailable").textContent).toContain(
      "read failure",
    );
  });

  /* WAVE 37 — the branch U4 did NOT cover, and the one that actually bit.
   *
   * U4 proves a non-2xx read is stated. But the endpoint can also answer 200
   * with a body that is not a policy, and until this wave that path did not
   * reach the refusal at all: `const { pendingOwnerDecision } = q.data` gave
   * `undefined`, `.length` threw a TypeError out of render, and with no error
   * boundary above this component React tore down the WHOLE root. Every
   * Messages surface went blank — the failure mode this file's header calls
   * "worse than one that renders nothing", arrived at by a different door.
   *
   * It was found because `wave19_fe11_fe12_fe13_partner_surfaces.test.tsx`
   * could not click the FE-13 retry button: the button was fine, the page had
   * been unmounted underneath it.
   *
   * Both poles are asserted: the malformed payload must produce the STATED
   * refusal AND leave the tree standing, and the valid payload must NOT be
   * downgraded into that refusal. Together they fail if the guard is removed
   * (crash) or made over-broad (false refusal). */
  const MALFORMED: Array<[string, unknown]> = [
    ["an empty object", {}],
    ["a null body", null],
    [
      "arrays replaced by objects",
      { viewerRole: "partner", rules: {}, pendingOwnerDecision: {}, delegatedContext: null },
    ],
    ["pendingOwnerDecision missing", { viewerRole: "partner", rules: [], delegatedContext: null }],
    ["rules missing", { viewerRole: "partner", pendingOwnerDecision: [], delegatedContext: null }],
  ];

  it.each(MALFORMED)(
    "U5 POLE — a 200 with %s is a STATED read failure and does NOT unmount the page",
    async (_label, body) => {
      const { container } = renderWith(body, true);
      await waitFor(() =>
        expect(screen.getByTestId("audience-policy-unavailable")).toBeTruthy(),
      );
      expect(screen.getByTestId("audience-policy-unavailable").textContent).toContain(
        "read failure",
      );
      /* THE regression: the tree survived. A thrown render leaves this empty. */
      expect(container.innerHTML.length).toBeGreaterThan(0);
      expect(screen.getByTestId("audience-policy-unavailable").isConnected).toBe(true);
      /* ...and it must not silently claim the audience is merely empty. */
      expect(screen.queryByTestId("audience-policy-notice")).toBeNull();
    },
  );

  it("U6 OPPOSITE POLE — a well-formed payload is never downgraded to the read failure", async () => {
    renderWith(PENDING);
    await waitFor(() =>
      expect(screen.getByTestId("audience-pending-owner-decision")).toBeTruthy(),
    );
    /* If the shape check were over-broad, this valid policy would be refused. */
    expect(screen.queryByTestId("audience-policy-unavailable")).toBeNull();
    expect(screen.getByTestId("audience-delegated-context")).toBeTruthy();
  });
});
