/**
 * WAVE 143 · BATCH 1 · ITEM 4 — the owner's switch, RENDERED.   R108.1 item 3
 *
 * WHAT WAS WRONG. `POST /api/comms/audience-rules/:key` shipped in WAVE 33 behind
 * `requireAdmin` and had ZERO client callers: `grep -rn "audience-rules"
 * client/src` returned nothing before this wave. So "the owner rules on a pending
 * audience question" was reachable only from a shell. This file is the proof that
 * it is now reachable from the admin console, and — because a switch that LOOKS
 * flipped but is not is worse than one that refuses — that a failed write leaves
 * the switch where it was.
 *
 * WHY THE ASSERTIONS ARE WHAT THEY ARE
 *   · Rendered text and the ACTUAL fetch argument list are asserted. Searching
 *     the component's source for a URL would pass against a component that never
 *     calls it (the WAVE 38 Row 5 lesson).
 *   · The state badge and the switch are read from SERVER state, so each rule is
 *     asserted at BOTH POLES — enabled and disabled — on the same harness.
 *   · The held-off notice for `partner_engaged_company_people` is asserted as
 *     present, and asserted ABSENT on every other rule, so a blanket warning
 *     rendered on all six rows would fail.
 *   · The last case renders the REAL PlatformSurfaces page: the new tab must
 *     exist AND all six pre-existing triggers must survive, which is the drop
 *     gate stated as a test rather than trusted.
 *
 * jest-dom matchers are NOT registered in this repo, so DOM properties
 * (`.getAttribute`, `.textContent`) are asserted directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryCache, QueryClientProvider } from "@tanstack/react-query";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});

import { MessagingAudienceRulesPanel } from "../MessagingAudienceRulesPanel";

const HELD_OFF = "partner_engaged_company_people";
const TEAM = "partner_team_peers";
const LEGACY = ["channel_participant", "cap_table_peer", "chapter_peer", "follow_peer"];

/** The six rows migration 0181 seeds, in the shape GET /api/comms/audience-policy
 *  emits them (commsStore.ts:3498-3505). `partnerTeamEnabled` models the state
 *  before and after migration 0199. */
function policy(partnerTeamEnabled: boolean) {
  return {
    viewerRole: "admin",
    rules: [
      ...LEGACY.map((k) => ({
        ruleKey: k,
        appliesToViewerRole: "any",
        enabled: true,
        requiresOwnerDecision: false,
        description: `stored description for ${k}`,
        recommendedDefault: null,
      })),
      {
        ruleKey: HELD_OFF,
        appliesToViewerRole: "partner",
        enabled: false,
        requiresOwnerDecision: true,
        description: "stored description for the engaged-company rule",
        recommendedDefault: "stored recommendation: leave disabled until the payload is scoped",
        /* WAVE 144 · ITEM 5 — the three fields the policy endpoint now emits for
           a rule that crosses an organisation boundary
           (server/commsStore.ts audience-policy handler). */
        exposureWarning: "SERVER WARNING: opens another organisation's people; prerequisite outstanding.",
        requiresExplicitConfirmation: true,
        confirmationToken: "I_UNDERSTAND_THIS_EXPOSES_CLIENT_COMPANY_PEOPLE",
      },
      {
        ruleKey: TEAM,
        appliesToViewerRole: "partner",
        enabled: partnerTeamEnabled,
        requiresOwnerDecision: !partnerTeamEnabled,
        description: "stored description for the team-peer rule",
        recommendedDefault: "stored recommendation: enable — intra-organisation only",
      },
    ],
  };
}

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

/** Routes BY URL. A single blanket implementation would answer the POST with the
 *  policy body and the test would pass without a write ever being routed. */
function serve(opts: {
  policyBody?: unknown;
  policyFails?: boolean;
  write?: { ok: boolean; status?: number; body: unknown };
}) {
  apiRequestMock.mockImplementation(async (method: string, url: string, body?: unknown) => {
    if (url === "/api/comms/audience-policy") {
      if (opts.policyFails) throw new Error("policy read failed");
      return jsonResponse(opts.policyBody ?? policy(false));
    }
    if (url.startsWith("/api/comms/audience-rules/")) {
      lastWrite = { method, url, body };
      const w = opts.write ?? { ok: true, body: { ok: true } };
      return jsonResponse(w.body, w.ok, w.status ?? (w.ok ? 200 : 500));
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
}

let lastWrite: { method: string; url: string; body?: unknown } | null = null;

function renderPanel() {
  const qc = new QueryClient({
    queryCache: new QueryCache({ onError: () => {} }),
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MessagingAudienceRulesPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
  lastWrite = null;
});
afterEach(() => {
  cleanup();
});

describe("WAVE 143 · S — the panel shows every rule and its real state", () => {
  it("S1 all SIX rules are listed with the server's own description and recommendation", async () => {
    serve({ policyBody: policy(false) });
    renderPanel();
    await waitFor(() => screen.getByTestId("admin-audience-rules-list"));
    for (const k of [...LEGACY, HELD_OFF, TEAM]) {
      expect(screen.getByTestId(`admin-audience-rule-${k}`)).toBeTruthy();
      /* Verbatim server data — the panel authors no rule description. */
      expect(screen.getByTestId(`admin-audience-rule-description-${k}`).textContent).toContain(
        `stored description for ${k === HELD_OFF ? "the engaged-company rule" : k === TEAM ? "the team-peer rule" : k}`,
      );
      /* Every rule states what it OPENS, so scope is not inferred from a key. */
      expect(
        (screen.getByTestId(`admin-audience-rule-opens-${k}`).textContent ?? "").length,
      ).toBeGreaterThan(20);
    }
    expect(screen.getByTestId(`admin-audience-rule-recommendation-${TEAM}`).textContent).toContain(
      "intra-organisation only",
    );
    expect(screen.queryByTestId("admin-audience-rules-empty")).toBeNull();
    expect(screen.queryByTestId("admin-audience-rules-unavailable")).toBeNull();
  });

  it("S2 BOTH POLES of the enabled state are rendered, and the role scope is shown", async () => {
    serve({ policyBody: policy(false) });
    renderPanel();
    await waitFor(() => screen.getByTestId(`admin-audience-rule-state-${TEAM}`));
    expect(screen.getByTestId(`admin-audience-rule-state-${TEAM}`).textContent).toContain("DISABLED");
    expect(screen.getByTestId(`admin-audience-rule-state-channel_participant`).textContent).toContain(
      "ENABLED",
    );
    expect(screen.getByTestId(`admin-audience-rule-role-${TEAM}`).textContent).toContain("partner");
    expect(screen.getByTestId(`admin-audience-rule-role-follow_peer`).textContent).toContain("any");
    /* Pending flag rendered only where the row carries it. */
    expect(screen.getByTestId(`admin-audience-rule-pending-${TEAM}`)).toBeTruthy();
    expect(screen.queryByTestId(`admin-audience-rule-pending-follow_peer`)).toBeNull();
    cleanup();

    /* Post-0199 state: the same rule reads ENABLED and is no longer pending. */
    serve({ policyBody: policy(true) });
    renderPanel();
    await waitFor(() => screen.getByTestId(`admin-audience-rule-state-${TEAM}`));
    expect(screen.getByTestId(`admin-audience-rule-state-${TEAM}`).textContent).toContain("ENABLED");
    expect(screen.getByTestId(`admin-audience-rule-toggle-${TEAM}`).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.queryByTestId(`admin-audience-rule-pending-${TEAM}`)).toBeNull();
  });

  it("S3 the FIRST client caller — toggling posts to the rule's own endpoint", async () => {
    /* Fails before this wave: there were zero client callers of this route, so
       `lastWrite` would stay null. */
    serve({ policyBody: policy(false) });
    renderPanel();
    const sw = await waitFor(() => screen.getByTestId(`admin-audience-rule-toggle-${TEAM}`));
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await waitFor(() => expect(lastWrite).not.toBeNull());
    expect(lastWrite!.method).toBe("POST");
    expect(lastWrite!.url).toBe(`/api/comms/audience-rules/${TEAM}`);
    expect(lastWrite!.body).toEqual({ enabled: true });
  });

  /* WAVE 144 · ITEM 5 · R98 RE-PIN. The second half of this case used to assert
     that clicking the HELD-OFF rule's switch posted `{enabled:true}` STRAIGHT
     AWAY — i.e. it pinned the finding Review 2 raised: the rule R108.1 holds off
     on confidentiality grounds was one click from live, operated exactly like
     `follow_peer`. The property worth keeping is R108.1 item 3's: the owner must
     be able to revisit EITHER partner rule without a developer. That is still
     asserted — via the confirmation, in S11 — so this case now pins only the
     part that did not change (a DISABLE writes immediately, with no
     confirmation) and asserts that the held-off rule does NOT write on the first
     click. Assertions: 4 -> 5. */
  it("S4 turning a rule OFF writes immediately, and the held-off rule does NOT", async () => {
    serve({ policyBody: policy(true) });
    renderPanel();
    const sw = await waitFor(() => screen.getByTestId(`admin-audience-rule-toggle-${TEAM}`));
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => expect(lastWrite).not.toBeNull());
    expect(lastWrite!.body).toEqual({ enabled: false });

    lastWrite = null;
    fireEvent.click(screen.getByTestId(`admin-audience-rule-toggle-${HELD_OFF}`));
    /* The click opens the confirmation instead of writing. */
    await waitFor(() => screen.getByTestId(`admin-audience-rule-confirm-${HELD_OFF}`));
    expect(lastWrite).toBeNull();
  });

  it("S11 the held-off rule needs an EXPLICIT confirmation, which carries the server's token", async () => {
    /* R108.1 item 3: the owner is INFORMED, not prevented. Two acts, then live. */
    serve({ policyBody: policy(true) });
    renderPanel();
    const sw = await waitFor(() => screen.getByTestId(`admin-audience-rule-toggle-${HELD_OFF}`));
    fireEvent.click(sw);
    const box = await waitFor(() => screen.getByTestId(`admin-audience-rule-confirm-${HELD_OFF}`));
    /* The warning is the SERVER's own text, rendered verbatim. */
    expect(box.textContent).toContain("opens another organisation's people");
    expect(box.textContent).toContain("prerequisite outstanding");
    expect(lastWrite).toBeNull();

    fireEvent.click(screen.getByTestId(`admin-audience-rule-confirm-yes-${HELD_OFF}`));
    await waitFor(() => expect(lastWrite).not.toBeNull());
    expect(lastWrite!.url).toBe(`/api/comms/audience-rules/${HELD_OFF}`);
    expect(lastWrite!.body).toEqual({
      enabled: true,
      confirmExposure: "I_UNDERSTAND_THIS_EXPOSES_CLIENT_COMPANY_PEOPLE",
    });
  });

  it("S12 CANCELLING the confirmation writes nothing at all", async () => {
    serve({ policyBody: policy(true) });
    renderPanel();
    fireEvent.click(await waitFor(() => screen.getByTestId(`admin-audience-rule-toggle-${HELD_OFF}`)));
    await waitFor(() => screen.getByTestId(`admin-audience-rule-confirm-${HELD_OFF}`));
    fireEvent.click(screen.getByTestId(`admin-audience-rule-confirm-cancel-${HELD_OFF}`));
    await waitFor(() =>
      expect(screen.queryByTestId(`admin-audience-rule-confirm-${HELD_OFF}`)).toBeNull(),
    );
    expect(lastWrite).toBeNull();
    /* And the switch never moved: it renders from server state. */
    expect(
      screen.getByTestId(`admin-audience-rule-toggle-${HELD_OFF}`).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("S13 the server's exposure warning is on the row BEFORE any click, and only on that row", async () => {
    serve({ policyBody: policy(true) });
    renderPanel();
    const warn = await waitFor(() => screen.getByTestId(`admin-audience-rule-exposure-${HELD_OFF}`));
    expect(warn.textContent).toContain("SERVER WARNING");
    for (const k of [...LEGACY, TEAM]) {
      expect(screen.queryByTestId(`admin-audience-rule-exposure-${k}`)).toBeNull();
    }
    /* A rule with no server warning still toggles in ONE act. */
    fireEvent.click(screen.getByTestId(`admin-audience-rule-toggle-${TEAM}`));
    await waitFor(() => expect(lastWrite).not.toBeNull());
  });

  it("S5 a 404 unknown_rule does NOT move the switch", async () => {
    serve({
      policyBody: policy(false),
      write: { ok: false, status: 404, body: { error: "unknown_rule" } },
    });
    renderPanel();
    const sw = await waitFor(() => screen.getByTestId(`admin-audience-rule-toggle-${TEAM}`));
    fireEvent.click(sw);
    await waitFor(() => expect(lastWrite).not.toBeNull());
    /* No optimistic state: the switch renders from server state, which did not
       change. An audience gate that looks flipped but is not would be worse than
       a refusal. */
    await waitFor(() =>
      expect(
        screen.getByTestId(`admin-audience-rule-toggle-${TEAM}`).getAttribute("aria-checked"),
      ).toBe("false"),
    );
    expect(screen.getByTestId(`admin-audience-rule-state-${TEAM}`).textContent).toContain("DISABLED");
  });

  it("S6 a 500 write_failed also leaves the state as the server reports it", async () => {
    serve({
      policyBody: policy(false),
      write: { ok: false, status: 500, body: { error: "write_failed" } },
    });
    renderPanel();
    fireEvent.click(await waitFor(() => screen.getByTestId(`admin-audience-rule-toggle-${TEAM}`)));
    await waitFor(() => expect(lastWrite).not.toBeNull());
    await waitFor(() =>
      expect(
        screen.getByTestId(`admin-audience-rule-toggle-${TEAM}`).getAttribute("aria-checked"),
      ).toBe("false"),
    );
  });

  it("S7 a failed policy READ states a refusal rather than rendering a blank panel", async () => {
    /* A blank panel reads as "no audience rules exist", which is a lie about a
       confidentiality gate. */
    serve({ policyFails: true });
    renderPanel();
    const msg = await waitFor(() => screen.getByTestId("admin-audience-rules-unavailable"));
    expect(msg.textContent).toContain("could not be read");
    expect(msg.textContent).toContain("Nothing has been changed");
    expect(screen.queryByTestId("admin-audience-rules-list")).toBeNull();
  });

  it("S8 an EMPTY rules array is stated too, and is distinguishable from a failure", async () => {
    serve({ policyBody: { viewerRole: "admin", rules: [] } });
    renderPanel();
    const msg = await waitFor(() => screen.getByTestId("admin-audience-rules-empty"));
    expect(msg.textContent).toContain("no rows");
    expect(screen.queryByTestId("admin-audience-rules-unavailable")).toBeNull();
  });

  it("S9 the R108.1 held-off notice appears on ONE rule only, and names the harm", async () => {
    serve({ policyBody: policy(true) });
    renderPanel();
    const notice = await waitFor(() =>
      screen.getByTestId(`admin-audience-rule-held-off-${HELD_OFF}`),
    );
    const text = notice.textContent ?? "";
    expect(text).toContain("HELD OFF DELIBERATELY");
    expect(text).toContain("R108.1");
    expect(text).toContain("cap-table");
    expect(text).toContain("not an oversight");
    /* Not a blanket warning: no other rule carries it. */
    for (const k of [...LEGACY, TEAM]) {
      expect(screen.queryByTestId(`admin-audience-rule-held-off-${k}`)).toBeNull();
    }
  });

  it("S10 the panel states that rules are read uncached, so the effect needs no deploy", async () => {
    serve({ policyBody: policy(false) });
    renderPanel();
    const intro = await waitFor(() => screen.getByTestId("admin-audience-rules-intro"));
    expect(intro.textContent).toContain("comms_audience_rules");
    expect(intro.textContent).toContain("no caching");
    expect(intro.textContent).toContain("needs no deploy");
  });
});
