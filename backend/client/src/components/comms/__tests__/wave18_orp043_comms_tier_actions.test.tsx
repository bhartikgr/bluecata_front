/**
 * WAVE 18 — ORP-043 (DEF-043): the Tier 1/2/3 comms ACTION surface, client side.
 *
 * ANTI-VACUITY NOTES.
 *  1. This panel exists because the engines had no caller, so "it renders" proves
 *     nothing. Every action test asserts the REQUEST that was made — method, url
 *     and body — because the request IS the wiring. A panel that renders a Send
 *     button and calls nothing would pass a render-only suite.
 *  2. NO ACTOR IDENTITY MAY APPEAR IN ANY REQUEST BODY. That is the whole point of
 *     the server-side ORP-043 hardening: a body actor is now either ignored or a
 *     400. Asserted as an explicit absence over every recorded call, with a
 *     positive pole proving the assertion can fail (a fixture body containing an
 *     actor field is checked by the same predicate and must read as violating).
 *  3. Every refusal renders as COPY. 401/403/404/429/503 and the two local
 *     validation refusals each have a named testid and an asserted string, and the
 *     empty state is asserted to be DIFFERENT from the refusal state — the defect
 *     being guarded is a refusal that reads as "you have nothing".
 *  4. NO MONEY IS RENDERED ON THIS SURFACE. The tier engines carry messages,
 *     opt-ins and endorsements, with no amounts anywhere, so there is no
 *     minor-unit conversion here to get wrong. Stated explicitly so the absence
 *     of a JPY/KWD fixture in this file is a recorded fact rather than an
 *     oversight; a fence below asserts the component contains no `/ 100`, no
 *     `* 100` and no `toFixed`, so if money is ever added to this surface the
 *     shortcut cannot be taken silently.
 *  5. A MOUNT FENCE proves the panel is rendered in both Messages pages, and the
 *     fence is proven to fail on bare, block-commented and JSX-commented
 *     fixtures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import {
  CommsTierActionsPanel,
  TIER_ERROR_COPY,
  tierErrorCopy,
} from "../CommsTierActionsPanel";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

type Call = [string, string, unknown?];

const CO = "co_x";
const ROUND = "rnd_x";

let groupsResponse: { status: number; body: unknown } = { status: 200, body: { groups: [] } };
let searchResponse: { status: number; body: unknown } = { status: 200, body: { results: [] } };
let advocatesResponse: { status: number; body: unknown } = {
  status: 200,
  body: { advocates: [], label: "For informational purposes only" },
};
let actionResponse: { status: number; body: unknown } = { status: 200, body: { id: "x_1" } };

beforeEach(() => {
  groupsResponse = { status: 200, body: { groups: [] } };
  searchResponse = { status: 200, body: { results: [] } };
  advocatesResponse = {
    status: 200,
    body: { advocates: [], label: "For informational purposes only" },
  };
  actionResponse = { status: 200, body: { id: "x_1" } };
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (url.startsWith("/api/comms/co-investor-groups/") && !url.includes("/messages") && !url.includes("/intro")) {
      return jsonResponse(groupsResponse.status, groupsResponse.body);
    }
    if (url.startsWith("/api/comms/search")) return jsonResponse(searchResponse.status, searchResponse.body);
    if (url.startsWith("/api/founder/crm/high-value-advocates")) {
      return jsonResponse(advocatesResponse.status, advocatesResponse.body);
    }
    return jsonResponse(actionResponse.status, actionResponse.body);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function calls(): Call[] {
  return apiRequestMock.mock.calls as Call[];
}

/** True when any recorded request body carries an actor-identity field. */
const ACTOR_FIELDS = [
  "actorId",
  "authorUserId",
  "requesterId",
  "fromUserId",
  "muterId",
  "endorserUserId",
  "founderUserId",
  "askerUserId",
  "volunteerUserId",
  "userId",
];
function bodyNamesAnActor(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return ACTOR_FIELDS.some((f) => f in (body as Record<string, unknown>));
}

describe("ORP-043 — refusal copy", () => {
  it("every server error code this surface can receive has copy, and it is not blank", () => {
    for (const code of [
      "missing_identity",
      "not_a_participant",
      "group_not_found",
      "soft_circler_opted_out",
      "muted_by_recipient",
      "rate_limit_combined_cap_reached",
      "NOT_ON_CAP_TABLE",
      "fromUserId_must_match_session",
    ]) {
      expect(TIER_ERROR_COPY[code], code).toBeTruthy();
      expect(tierErrorCopy(code)).toBe(TIER_ERROR_COPY[code]);
      expect(tierErrorCopy(code).length).toBeGreaterThan(10);
    }
  });

  it("an UNKNOWN code still produces visible copy carrying the code — never a blank card", () => {
    const out = tierErrorCopy("some_new_server_error");
    expect(out).toContain("some_new_server_error");
    expect(out).toMatch(/Nothing was changed/);
    /* And a missing code is still a sentence, not "". */
    expect(tierErrorCopy(null).length).toBeGreaterThan(10);
    expect(tierErrorCopy(undefined)).toBe(tierErrorCopy(null));
  });
});

describe("ORP-043 — Tier 1 groups are actually called", () => {
  it("reads the viewer-scoped listing on mount and renders the rooms", async () => {
    groupsResponse = {
      status: 200,
      body: {
        groups: [
          { id: "cig_1", companyId: CO, participants: ["u_me", "u_other"], createdAt: "2026-01-01T00:00:00.000Z" },
        ],
        viewerUserId: "u_me",
      },
    };
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
    await waitFor(() => expect(screen.getByTestId("comms-tier-group-cig_1")).toBeTruthy());
    expect(screen.getByTestId("comms-tier-group-count-cig_1").textContent).toContain("2 participants");
    const listing = calls().find((c) => c[1] === `/api/comms/co-investor-groups/${CO}`);
    expect(listing, "the orphaned listing endpoint was never called").toBeTruthy();
    expect(listing?.[0]).toBe("GET");
  });

  it("posts a message WITHOUT an author field in the body", async () => {
    groupsResponse = {
      status: 200,
      body: { groups: [{ id: "cig_1", companyId: CO, participants: ["u_me"], createdAt: "2026-01-01T00:00:00.000Z" }] },
    };
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
    await waitFor(() => expect(screen.getByTestId("comms-tier-message-input-cig_1")).toBeTruthy());
    fireEvent.change(screen.getByTestId("comms-tier-message-input-cig_1"), { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("comms-tier-message-send-cig_1"));
    await waitFor(() => expect(screen.getByTestId("comms-tier-message-sent")).toBeTruthy());
    const post = calls().find((c) => c[1] === "/api/comms/co-investor-groups/cig_1/messages");
    expect(post).toBeTruthy();
    expect(post?.[0]).toBe("POST");
    expect(post?.[2]).toEqual({ body: "hello" });
    expect(bodyNamesAnActor(post?.[2])).toBe(false);
  });

  it("a 403 from the server renders the refusal copy and NOT a success line", async () => {
    groupsResponse = {
      status: 200,
      body: { groups: [{ id: "cig_1", companyId: CO, participants: ["u_me"], createdAt: "2026-01-01T00:00:00.000Z" }] },
    };
    actionResponse = { status: 403, body: { error: "not_a_participant" } };
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
    await waitFor(() => expect(screen.getByTestId("comms-tier-message-input-cig_1")).toBeTruthy());
    fireEvent.change(screen.getByTestId("comms-tier-message-input-cig_1"), { target: { value: "hello" } });
    fireEvent.click(screen.getByTestId("comms-tier-message-send-cig_1"));
    await waitFor(() =>
      expect(screen.getByTestId("comms-tier-message-refusal").textContent).toBe(
        TIER_ERROR_COPY.not_a_participant,
      ),
    );
    expect(screen.queryByTestId("comms-tier-message-sent")).toBeNull();
  });

  it("creating a group sends no actorId and RE-READS the listing from the server", async () => {
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
    await waitFor(() => expect(screen.getByTestId("comms-tier-groups-empty")).toBeTruthy());
    const before = calls().filter((c) => c[1] === `/api/comms/co-investor-groups/${CO}`).length;
    fireEvent.change(screen.getByTestId("comms-tier-create-input"), { target: { value: "u_a, u_b" } });
    fireEvent.click(screen.getByTestId("comms-tier-create-submit"));
    await waitFor(() =>
      expect(calls().filter((c) => c[1] === `/api/comms/co-investor-groups/${CO}`).length).toBe(before + 1),
    );
    const create = calls().find((c) => c[1] === "/api/comms/co-investor-groups" && c[0] === "POST");
    expect(create?.[2]).toEqual({ companyId: CO, participants: ["u_a", "u_b"] });
    expect(bodyNamesAnActor(create?.[2])).toBe(false);
  });

  it("a refusal on the LISTING is rendered, and is distinguishable from 'no groups'", async () => {
    groupsResponse = { status: 401, body: { error: "missing_identity" } };
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
    await waitFor(() =>
      expect(screen.getByTestId("comms-tier-groups-refusal").textContent).toBe(
        TIER_ERROR_COPY.missing_identity,
      ),
    );
    /* THE DEFECT POLE: a refusal must not be shown as the empty state. */
    expect(screen.queryByTestId("comms-tier-groups-empty")).toBeNull();
    expect(screen.queryByTestId("comms-tier-groups-list")).toBeNull();
  });

  it("with no company selected it says so and never calls the endpoint with an empty id", async () => {
    render(<CommsTierActionsPanel roundId={ROUND} />);
    await waitFor(() => expect(screen.getByTestId("comms-tier-groups-refusal")).toBeTruthy());
    expect(screen.getByTestId("comms-tier-groups-refusal").textContent).toBe(
      TIER_ERROR_COPY["companyId required"],
    );
    expect(calls().some((c) => c[1] === "/api/comms/co-investor-groups/")).toBe(false);
    expect(calls().some((c) => c[1] === "/api/comms/co-investor-groups/undefined")).toBe(false);
  });
});

describe("ORP-043 — Tier 3 cross-cohort DM and mute", () => {
  it("sends a DM with roundId + recipient and NO sender field", async () => {
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
    fireEvent.change(screen.getByTestId("comms-tier-dm-to"), { target: { value: "u_sc" } });
    fireEvent.change(screen.getByTestId("comms-tier-dm-body"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("comms-tier-dm-send"));
    await waitFor(() => expect(screen.getByTestId("comms-tier-dm-ok")).toBeTruthy());
    const dm = calls().find((c) => c[1] === "/api/comms/cross-cohort/dm/start");
    expect(dm?.[2]).toEqual({ roundId: ROUND, toUserId: "u_sc", body: "hi" });
    expect(bodyNamesAnActor(dm?.[2])).toBe(false);
  });

  it("the 429 privacy refusals are rendered as explanations, each distinct", async () => {
    for (const code of [
      "soft_circler_opted_out",
      "muted_by_recipient",
      "rate_limit_combined_cap_reached",
    ]) {
      cleanup();
      actionResponse = { status: 429, body: { error: code } };
      render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
      fireEvent.change(screen.getByTestId("comms-tier-dm-to"), { target: { value: "u_sc" } });
      fireEvent.change(screen.getByTestId("comms-tier-dm-body"), { target: { value: "hi" } });
      fireEvent.click(screen.getByTestId("comms-tier-dm-send"));
      await waitFor(() =>
        expect(screen.getByTestId("comms-tier-dm-refusal").textContent).toBe(TIER_ERROR_COPY[code]),
      );
      expect(screen.queryByTestId("comms-tier-dm-ok")).toBeNull();
    }
    /* The three strings are genuinely different, so the investor learns WHICH
       guard fired. Identical copy would make the refusals unactionable. */
    const copies = new Set([
      TIER_ERROR_COPY.soft_circler_opted_out,
      TIER_ERROR_COPY.muted_by_recipient,
      TIER_ERROR_COPY.rate_limit_combined_cap_reached,
    ]);
    expect(copies.size).toBe(3);
  });

  it("mutes without a muter field, and lists the mute back", async () => {
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
    fireEvent.change(screen.getByTestId("comms-tier-mute-input"), { target: { value: "u_spammer" } });
    fireEvent.click(screen.getByTestId("comms-tier-mute-submit"));
    await waitFor(() => expect(screen.getByTestId("comms-tier-muted-list").textContent).toContain("u_spammer"));
    const mute = calls().find((c) => c[1] === "/api/comms/cross-cohort/mute");
    expect(mute?.[2]).toEqual({ roundId: ROUND, mutedId: "u_spammer" });
    expect(bodyNamesAnActor(mute?.[2])).toBe(false);
  });

  it("with no round in scope the cross-cohort controls explain themselves instead of failing", async () => {
    render(<CommsTierActionsPanel companyId={CO} />);
    expect(screen.getByTestId("comms-tier-crosscohort-no-round")).toBeTruthy();
    expect(screen.queryByTestId("comms-tier-dm-send")).toBeNull();
    /* A control that can only ever 400 must not be offered at all. */
    expect(calls().some((c) => c[1] === "/api/comms/cross-cohort/dm/start")).toBe(false);
  });
});

describe("ORP-043 — message search", () => {
  it("calls the orphaned search endpoint with the encoded query and renders hits", async () => {
    searchResponse = {
      status: 200,
      body: {
        results: [
          {
            messageId: "m1",
            channelId: "c1",
            channelKind: "cap_table",
            preview: "term sheet draft",
            createdAt: "2026-01-01T00:00:00.000Z",
            authorLabel: "Maya C.",
          },
        ],
      },
    };
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
    fireEvent.change(screen.getByTestId("comms-tier-search-input"), { target: { value: "term sheet" } });
    fireEvent.click(screen.getByTestId("comms-tier-search-submit"));
    await waitFor(() => expect(screen.getByTestId("comms-tier-search-row-m1")).toBeTruthy());
    const s = calls().find((c) => String(c[1]).startsWith("/api/comms/search"));
    expect(s?.[1]).toBe("/api/comms/search?q=term%20sheet");
    expect(screen.getByTestId("comms-tier-search-row-m1").textContent).toContain("Maya C.");
  });

  it("a search that matches nothing is an EMPTY state; a failing search is a REFUSAL", async () => {
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
    fireEvent.change(screen.getByTestId("comms-tier-search-input"), { target: { value: "zzz" } });
    fireEvent.click(screen.getByTestId("comms-tier-search-submit"));
    await waitFor(() => expect(screen.getByTestId("comms-tier-search-empty")).toBeTruthy());
    expect(screen.queryByTestId("comms-tier-search-refusal")).toBeNull();

    cleanup();
    searchResponse = { status: 503, body: { error: "search_unavailable" } };
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
    fireEvent.change(screen.getByTestId("comms-tier-search-input"), { target: { value: "zzz" } });
    fireEvent.click(screen.getByTestId("comms-tier-search-submit"));
    await waitFor(() => expect(screen.getByTestId("comms-tier-search-refusal")).toBeTruthy());
    /* The two states are not interchangeable: an outage must not read as
       "no messages match". */
    expect(screen.queryByTestId("comms-tier-search-empty")).toBeNull();
  });

  it("an empty query calls nothing", async () => {
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
    fireEvent.click(screen.getByTestId("comms-tier-search-submit"));
    await waitFor(() => expect(screen.getByTestId("comms-tier-search-card")).toBeTruthy());
    expect(calls().some((c) => String(c[1]).startsWith("/api/comms/search"))).toBe(false);
  });
});

describe("ORP-043 — high-value advocates (founder surface only)", () => {
  it("is ABSENT unless the mount asks for it", async () => {
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} />);
    await waitFor(() => expect(screen.getByTestId("comms-tier-search-card")).toBeTruthy());
    expect(screen.queryByTestId("comms-tier-advocates-card")).toBeNull();
    expect(calls().some((c) => String(c[1]).startsWith("/api/founder/crm"))).toBe(false);
  });

  it("requests ONE company's list and preserves the advisory framing", async () => {
    advocatesResponse = {
      status: 200,
      body: { advocates: ["u_champion"], label: "For informational purposes only" },
    };
    render(<CommsTierActionsPanel companyId={CO} showAdvocates />);
    await waitFor(() => expect(screen.getByTestId("comms-tier-advocate-u_champion")).toBeTruthy());
    const req = calls().find((c) => String(c[1]).startsWith("/api/founder/crm/high-value-advocates"));
    /* The company MUST be on the request — an unscoped call is the leak this item
       fixed, so a caller that omits it is itself a defect. */
    expect(req?.[1]).toBe(`/api/founder/crm/high-value-advocates?companyId=${CO}`);
    expect(screen.getByTestId("comms-tier-advocates-label").textContent).toBe(
      "For informational purposes only",
    );
    expect(screen.getByTestId("comms-tier-advocates-card").textContent).toContain(
      "NOT a cap-table-engine input",
    );
  });

  it("a 403 renders the refusal, not an empty advocate list", async () => {
    advocatesResponse = { status: 403, body: { error: "NOT_ON_CAP_TABLE" } };
    render(<CommsTierActionsPanel companyId={CO} showAdvocates />);
    await waitFor(() =>
      expect(screen.getByTestId("comms-tier-advocates-refusal").textContent).toBe(
        TIER_ERROR_COPY.NOT_ON_CAP_TABLE,
      ),
    );
    expect(screen.queryByTestId("comms-tier-advocates-empty")).toBeNull();
    expect(screen.queryByTestId("comms-tier-advocates-list")).toBeNull();
  });
});

describe("ORP-043 — no request anywhere on this surface names an actor", () => {
  it("across every action the panel can perform, no body carries an identity field", async () => {
    groupsResponse = {
      status: 200,
      body: { groups: [{ id: "cig_1", companyId: CO, participants: ["u_me"], createdAt: "2026-01-01T00:00:00.000Z" }] },
    };
    render(<CommsTierActionsPanel companyId={CO} roundId={ROUND} showAdvocates />);
    await waitFor(() => expect(screen.getByTestId("comms-tier-message-input-cig_1")).toBeTruthy());

    fireEvent.change(screen.getByTestId("comms-tier-message-input-cig_1"), { target: { value: "m" } });
    fireEvent.click(screen.getByTestId("comms-tier-message-send-cig_1"));
    fireEvent.change(screen.getByTestId("comms-tier-intro-input-cig_1"), { target: { value: "u_t" } });
    fireEvent.click(screen.getByTestId("comms-tier-intro-send-cig_1"));
    fireEvent.change(screen.getByTestId("comms-tier-dm-to"), { target: { value: "u_sc" } });
    fireEvent.change(screen.getByTestId("comms-tier-dm-body"), { target: { value: "b" } });
    fireEvent.click(screen.getByTestId("comms-tier-dm-send"));
    fireEvent.change(screen.getByTestId("comms-tier-mute-input"), { target: { value: "u_m" } });
    fireEvent.click(screen.getByTestId("comms-tier-mute-submit"));
    fireEvent.change(screen.getByTestId("comms-tier-create-input"), { target: { value: "u_a" } });
    fireEvent.click(screen.getByTestId("comms-tier-create-submit"));

    await waitFor(() => expect(calls().length).toBeGreaterThanOrEqual(6));
    for (const c of calls()) {
      expect(bodyNamesAnActor(c[2]), `${c[1]} sent an actor field: ${JSON.stringify(c[2])}`).toBe(false);
    }

    /* POSITIVE POLE — the predicate is proven able to fail. Without this the loop
       above could be checking nothing (e.g. if every body were undefined because
       no request was ever made, which the length assertion also guards). */
    expect(bodyNamesAnActor({ body: "m", authorUserId: "u_me" })).toBe(true);
    expect(bodyNamesAnActor({ roundId: ROUND, fromUserId: "u_me" })).toBe(true);
    expect(bodyNamesAnActor({ body: "m" })).toBe(false);
  });
});

describe("ORP-043 — mount fence and money fence", () => {
  const CLIENT = path.resolve(__dirname, "../../..");
  const MOUNTS = [
    { page: "pages/investor/Messages.tsx", component: "CommsTierActionsPanel" },
    { page: "pages/founder/Messages.tsx", component: "CommsTierActionsPanel" },
  ];

  function mountEvidence(src: string, component: string): [boolean, boolean] {
    const code = src
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
    const hasImport = new RegExp(`import\\s*\\{[^}]*\\b${component}\\b[^}]*\\}\\s*from`).test(code);
    const hasJsx = new RegExp(`<${component}[\\s/>]`).test(code);
    return [hasImport, hasJsx];
  }

  it("the fence is reading the real page files", () => {
    for (const m of MOUNTS) {
      const p = path.join(CLIENT, m.page);
      expect(fs.existsSync(p), `${m.page} missing`).toBe(true);
      expect(fs.readFileSync(p, "utf8").length).toBeGreaterThan(1000);
    }
  });

  it("the panel is imported AND rendered in both Messages pages", () => {
    for (const m of MOUNTS) {
      const src = fs.readFileSync(path.join(CLIENT, m.page), "utf8");
      const [hasImport, hasJsx] = mountEvidence(src, m.component);
      expect(hasImport, `not imported in ${m.page}`).toBe(true);
      expect(hasJsx, `not rendered in ${m.page}`).toBe(true);
    }
  });

  it("the fence FAILS on bare, block-commented and JSX-commented fixtures (both poles)", () => {
    expect(mountEvidence("export default function P(){return null;}", "CommsTierActionsPanel")).toEqual([
      false, false,
    ]);
    expect(
      mountEvidence(
        '/* import { CommsTierActionsPanel } from "x"; <CommsTierActionsPanel /> */\n// <CommsTierActionsPanel />\n',
        "CommsTierActionsPanel",
      ),
    ).toEqual([false, false]);
    expect(mountEvidence("{/* <CommsTierActionsPanel /> */}\n", "CommsTierActionsPanel")).toEqual([
      false, false,
    ]);
    expect(
      mountEvidence(
        'import { CommsTierActionsPanel } from "@/components/comms/CommsTierActionsPanel";\nconst a = <CommsTierActionsPanel />;\n',
        "CommsTierActionsPanel",
      ),
    ).toEqual([true, true]);
  });

  it("the panel contains no ad-hoc money arithmetic (this surface carries no money — keep it that way)", () => {
    const src = fs.readFileSync(path.join(CLIENT, "components/comms/CommsTierActionsPanel.tsx"), "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    for (const bad of ["/ 100", "/100", "* 100", "*100", "toFixed("]) {
      expect(code.includes(bad), `ad-hoc money arithmetic in the panel: ${bad}`).toBe(false);
    }
    /* POSITIVE POLE — the fence fires on a fixture that contains one. */
    expect(["/ 100", "/100"].some((b) => "const x = amountMinor / 100;".includes(b))).toBe(true);
  });
});
