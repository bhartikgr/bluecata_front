/**
 * WAVE 190 · ITEM E — THE INVESTOR IS TOLD THEY ARE REACHABLE, AND NOTHING ABOUT
 * WHO CAN REACH THEM CHANGED.
 *
 * THE DEFECT THIS TEST FENCES. The owner reported that an investor account had no
 * way to know that other members of the network could open a conversation with
 * them — the composer said nothing, so the first inbound DM looked like a leak.
 * Item E is a DISCLOSURE, not a permission change.
 *
 * WHY THIS TEST IS ON RENDERED DOM (R137). A component that exists and renders
 * nothing has not shipped; wave 189's item B was fenced the same way for the same
 * reason. So the real `MessagesPage` is mounted and the notice is read out of the
 * emitted DOM, in both roles.
 *
 * ══ THE NEGATIVE CONTROL IS THE HALF THAT MATTERS ══
 * A disclosure that quietly widened or narrowed reach would be a privacy change
 * wearing a notice's clothes. §E-4 proves the SAME SET OF PEOPLE is reachable with
 * the notice as without it:
 *   · the rendered set of conversation rows is IDENTICAL between the role that
 *     gets the notice and the role that does not, given identical seeded data;
 *   · rendering the notice issues NO network request of any kind, so it cannot
 *     consult, widen or narrow a policy;
 *   · the component's own source imports no transport and no policy module.
 * The server-side half of the same claim is carried by the pre-existing reach
 * suite `server/__tests__/wave185_itemE_illegitimate_reach_attempts.test.ts`,
 * which enumerates who can reach whom and is re-run unchanged for this wave.
 *
 * MONEY. Nothing here asserts an amount, fee, price or currency.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

/** Every outbound call the page could make goes through `apiRequest`, so counting
 *  calls here is how §E-4 proves the notice is inert. */
const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import { MessagesPage } from "../MessagesPage";
import { InvestorReachabilityNotice } from "../InvestorReachabilityNotice";
import { RoleProvider } from "@/lib/role";

const NOTICE = "investor-reachability-notice";

/** Two counterparties, so "the set of reachable people" is a set and not a
 *  single row that could match by accident. */
const CHANNELS = [
  {
    id: "ch_w190_a",
    kind: "dm",
    displayTitle: "Ada Counterparty",
    title: "DM with Ada",
    participantUserIds: ["u_me", "u_ada"],
    unreadCount: 0,
    lastMessage: null,
  },
  {
    id: "ch_w190_b",
    kind: "dm",
    displayTitle: "Bede Counterparty",
    title: "DM with Bede",
    participantUserIds: ["u_me", "u_bede"],
    unreadCount: 0,
    lastMessage: null,
  },
];

function seed(qc: QueryClient) {
  qc.setQueryData(["/api/comms/channels"], CHANNELS);
  qc.setQueryData(["/api/comms/me"], { id: "u_me", legalName: "Me" });
  for (const c of CHANNELS) {
    qc.setQueryData(["/api/comms/channels", c.id], { channel: c, messages: [] });
    qc.setQueryData(["/api/comms/channels", c.id, "read-receipts"], { receipts: [] });
  }
}

function renderPage(role: "founder" | "investor") {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  seed(qc);
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <MessagesPage role={role} />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** The set of people the surface offers this viewer, read out of the DOM rather
 *  than out of the fixture — so a render that dropped or added a row is caught. */
function reachableFromDom(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="channel-row-"]'))
    .map((el) => el.getAttribute("data-testid") ?? "")
    .sort();
}

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockResolvedValue({ json: async () => ({}) });
  toastMock.mockReset();
});
afterEach(() => cleanup());

/* ══ E-1 — IT RENDERS, FOR AN INVESTOR ══════════════════════════════════ */
describe("W190 E-1 — the notice renders on the investor's own messages surface", () => {
  it("appears in the composer for role=investor", async () => {
    renderPage("investor");
    await waitFor(() => expect(screen.getByTestId(NOTICE)).toBeTruthy());
  });

  it("says, in plain language, that other members can start a conversation", async () => {
    renderPage("investor");
    const text = (await screen.findByTestId(NOTICE)).textContent ?? "";
    expect(text).toContain("Other members of this network can start a conversation with you here");
    /* Plain language: no machine token, no ALL-CAPS code, in the words an
       investor reads. */
    expect(text).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
    expect(text.trim().length).toBeGreaterThan(40);
  });

  it("is a STATIC sibling — it renders with no data of its own and cannot fail to load", () => {
    /* R143.1: appended as a static sibling. Rendered bare, with no provider and no
       transport, it still produces its text — which is exactly why there is no
       loading, empty or error state to get wrong. */
    const { container } = render(<InvestorReachabilityNotice />);
    expect(container.querySelector(`[data-testid="${NOTICE}"]`)).toBeTruthy();
    expect(container.textContent ?? "").toContain("can start a conversation with you here");
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});

/* ══ E-2 — IT DOES NOT RENDER FOR ANY OTHER ROLE ════════════════════════ */
describe("W190 E-2 — no other role is shown the investor's disclosure", () => {
  it("does NOT appear for role=founder", async () => {
    const { container } = renderPage("founder");
    /* Absence only means something once the surface has actually rendered, so a
       settled sibling is awaited first — otherwise this assertion would pass on an
       empty tree. */
    await waitFor(() => expect(container.querySelector('[data-testid="pane-messages"]')).toBeTruthy());
    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });

  it("the founder surface is otherwise fully rendered — the absence is the gate, not a crash", async () => {
    const { container } = renderPage("founder");
    await waitFor(() => expect(container.querySelector('[data-testid="input-message"]')).toBeTruthy());
    expect(container.querySelector('[data-testid="button-send"]')).toBeTruthy();
    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });
});

/* ══ E-3 — THE NOTICE IS A DISCLOSURE, NOT A CONTROL ════════════════════ */
describe("W190 E-3 — the notice offers no action and touches no policy", () => {
  it("renders no button, link, input or form — nothing an investor can click to change reach", () => {
    const { container } = render(<InvestorReachabilityNotice />);
    expect(container.querySelectorAll("button").length).toBe(0);
    expect(container.querySelectorAll("a").length).toBe(0);
    expect(container.querySelectorAll("input,textarea,select,form").length).toBe(0);
  });

  it("its SOURCE imports no transport and no messaging policy", () => {
    /* The guard fingerprints source text, and so does this: a future edit that
       gave the notice a fetch would have to come through here. */
    const file = path.resolve(
      __dirname,
      "..",
      "InvestorReachabilityNotice.tsx",
    );
    const raw = fs.readFileSync(file, "utf8");
    expect(raw.length).toBeGreaterThan(0);
    /* Comments are stripped first, because the file's own header DISCUSSES
       `messagingPolicy.ts` in order to record why the behaviour was left alone.
       Prose about a module is not a dependency on it, and a scan that could not
       tell the difference would force future waves to delete their reasoning. */
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toContain("export function InvestorReachabilityNotice");
    /* Exactly one import, and it is an icon. */
    const imports = src.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual(['import { Users } from "lucide-react";']);
    for (const forbidden of [
      "apiRequest",
      "useQuery",
      "useMutation",
      "fetch(",
      "messagingPolicy",
      "canDM",
      "/api/",
    ]) {
      expect(src, `the notice must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* ══ E-4 — NEGATIVE CONTROL: REACH DID NOT CHANGE ═══════════════════════ */
describe("W190 E-4 — NEGATIVE CONTROL: the same people are reachable, notice or no notice", () => {
  it("the rendered set of conversations is IDENTICAL with the notice (investor) and without it (founder)", async () => {
    const investor = renderPage("investor");
    await waitFor(() => expect(screen.getByTestId(NOTICE)).toBeTruthy());
    const withNotice = reachableFromDom(investor.container);
    cleanup();

    const founder = renderPage("founder");
    await waitFor(() =>
      expect(founder.container.querySelector('[data-testid="pane-messages"]')).toBeTruthy(),
    );
    const withoutNotice = reachableFromDom(founder.container);

    /* The fixture offers two counterparties; if either render silently showed
       none, both sets would be empty and this comparison would be vacuous. */
    expect(withNotice.length).toBe(CHANNELS.length);
    expect(withNotice).toEqual(withoutNotice);
  });

  it("rendering the notice issues NO request, so it cannot consult or alter a policy", () => {
    apiRequestMock.mockClear();
    render(<InvestorReachabilityNotice />);
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  it("mounting the page as an investor makes no reach-related call the founder render does not also make", async () => {
    const investor = renderPage("investor");
    await waitFor(() => expect(screen.getByTestId(NOTICE)).toBeTruthy());
    const investorCalls = apiRequestMock.mock.calls.map((c) => JSON.stringify(c)).sort();
    cleanup();

    apiRequestMock.mockClear();
    const founder = renderPage("founder");
    await waitFor(() =>
      expect(founder.container.querySelector('[data-testid="pane-messages"]')).toBeTruthy(),
    );
    const founderCalls = apiRequestMock.mock.calls.map((c) => JSON.stringify(c)).sort();

    /* Any call present only in the investor render would be a candidate for a
       reach change; there is none. */
    const extra = investorCalls.filter((c) => !founderCalls.includes(c));
    expect(extra).toEqual([]);
    for (const call of investorCalls) {
      expect(call).not.toContain("/api/comms/dm/start");
      expect(call).not.toContain("/api/comms/users");
    }
  });

  it("the composer's own send path is untouched — the notice is the LAST static sibling, not a wrapper", async () => {
    /* If the notice had been inserted around the composer rather than after it,
       the send controls would move inside it and the composer contract would have
       changed. Both controls remain present and outside the notice. */
    const { container } = renderPage("investor");
    await waitFor(() => expect(screen.getByTestId(NOTICE)).toBeTruthy());
    const notice = screen.getByTestId(NOTICE);
    expect(notice.querySelector('[data-testid="input-message"]')).toBeNull();
    expect(notice.querySelector('[data-testid="button-send"]')).toBeNull();
    expect(container.querySelector('[data-testid="input-message"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="button-send"]')).toBeTruthy();
  });
});
