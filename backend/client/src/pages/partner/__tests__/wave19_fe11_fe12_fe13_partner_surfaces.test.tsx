/**
 * WAVE 19 · FE-11 / FE-12 / FE-13 — three Partner-surface defects, one suite.
 *
 * All three were verified at source BEFORE any edit; none was taken on the
 * citation's word. What the citations said and what was actually there:
 *
 *   FE-11 "Partner deal-room empty state" — cited `partnerWorkspaceV19Store`.
 *         WRONG SINK. There is no partner-owned deal room: the partner shell's
 *         deal room IS `client/src/pages/collective/CollectiveDealRoom.tsx`,
 *         reading `GET /api/collective/dealroom/companies`. The V19 store is
 *         not on this path at all — which matters, because the V19 store is
 *         A-23-blocked and building "to the citation" would have meant either
 *         touching a blocked file or shipping nothing.
 *         THE REAL DEFECT: `companies = data?.companies ?? []`, and the empty
 *         branch was gated only on `!isLoading`. On a 403/500 the page rendered
 *         its red error line AND, underneath it, "No companies in Deal Room"
 *         with a paragraph explaining which statuses "will appear here" — a
 *         fabricated zero in explanatory copy.
 *
 *   FE-12 "Partner posts detail deeplink" — cited "posts store". The store is
 *         fine. THE REAL DEFECT is in the client route table: App.tsx pointed
 *         BOTH `/collective/partner/posts` and `/collective/partner/posts/:id`
 *         at `<PartnerPosts />`, which rendered only the feed. PostsFeed
 *         navigates a clicked post to `${postsBase}/posts/${id}`
 *         (PostsFeed.tsx:532) and copies that URL on share (`:523`, `:649`), so
 *         every partner post click and every shared partner link bounced back
 *         to the list with the `:id` discarded.
 *
 *   FE-13 "Partner messages empty state and start-a-DM (MSG-06)". Start-a-DM
 *         ALREADY EXISTS and works (`PartnerMessages.tsx`, W2M B2 — new-DM
 *         button, picker, 403/422 copy; `PartnerMessages.newDm.test.tsx` is
 *         green). Nothing to build there and it is not rebuilt here.
 *         THE REAL DEFECT is the empty state, and it is the Wave 18 W-4 defect
 *         on a shared component: `MessagesPage.tsx` derives its list through
 *         `asArray(channels.data)`, so a 403/500 collapses to `[]`, and the
 *         empty branch was gated only on `!isLoading`. A partner with live
 *         threads saw "No conversations yet" plus advice on how to acquire the
 *         threads they already have.
 *
 * RULE 2 — the second path, per item:
 *   FE-11: the only other reader of `/api/collective/dealroom/companies` is
 *          `CollectiveDealRoomDetail.tsx`; checked, and it has its own
 *          `isError` branch already, so it is not a second instance.
 *   FE-13: `MessagesPage.tsx` is shared by the partner, founder and investor
 *          shells, so fixing it here fixes all three sinks at once — and the
 *          SAME `?? []`-behind-an-`!isLoading`-gate shape occurs THREE times in
 *          that one file (channel list, thread body, dataroom picker). All
 *          three are fixed and all three are asserted below; the second and
 *          third were found by grepping the file for the shape, not by reading
 *          the row.
 *
 * MONEY: none of these three surfaces renders an amount. A post carries a body,
 * an author and counts; a channel carries a title and a preview; the deal-room
 * row carries a stage, a status and score labels. There is therefore no
 * minor-unit conversion here to get wrong, and that is asserted rather than
 * assumed — the last test in each block fences the rendered output against
 * currency and `/100`-shaped output, with a positive pole proving the fence can
 * fail. The mandatory JPY/KWD/USD fixtures live in the suites for the surfaces
 * that do carry money.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_test_partner_inc",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_avi_managing", email: "avi@example.com", name: "Test Partner Inc" },
    },
  }),
}));

vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return {
    ...actual,
    PartnerShell: ({ children, title }: { children: React.ReactNode; title?: string }) => (
      <div data-testid="partner-shell" data-shell-title={title}>{children}</div>
    ),
  };
});

/* A FULL-SHAPED UserContext, not a `{ userId }` stub. The stub version of this
   mock made two FE-12 tests fail with `Cannot read properties of undefined
   (reading 'capTablePositions')` from `hasCapTable` — a harness defect, not a
   product one, and exactly the class of thing that would otherwise have been
   "fixed" by weakening an assertion. */
const ENT_CTX = {
  userId: "u_avi_managing",
  identity: { email: "avi@example.com", name: "Avi" },
  founder: { companies: [], activeCompanyId: null },
  investor: { invitedRounds: [], capTablePositions: [], state: "NONE" },
  collective: { status: "active", role: "partner", expiresAt: null },
  isAdmin: false,
  isAuthed: true,
  partner: { partnerId: "ac_consortium_partner_test_partner_inc", subRole: "managing_partner" },
};
vi.mock("@/lib/entitlement", async () => {
  const actual = await vi.importActual<typeof import("@/lib/entitlement")>("@/lib/entitlement");
  return { ...actual, useEntitlement: () => ({ data: ENT_CTX, isLoading: false, isError: false }) };
});

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import { ApiError } from "@/lib/queryClient";
import CollectiveDealRoom from "@/pages/collective/CollectiveDealRoom";
import PartnerPosts from "../PartnerPosts";
import PartnerMessages from "../PartnerMessages";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A QueryClient whose default queryFn goes through the SAME mock the pages'
 *  explicit queryFns use, so a component that relies on the default (as
 *  MessagesPage does for `/api/comms/channels`) is exercised, not skipped. */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        queryFn: async ({ queryKey }) => {
          const url = queryKey.filter((k) => typeof k === "string").join("/").replace(/\/+/g, "/");
          return (await apiRequestMock("GET", url)).json();
        },
      },
      mutations: { retry: false },
    },
  });
}

function renderAt(path: string, ui: React.ReactElement) {
  /* `history` is exposed so a test can assert where an in-app navigation
     LANDED. `window.location` is not the router's location under
     `memoryLocation`, and asserting on it silently reads "/" forever. */
  const { hook, history } = memoryLocation({ path, static: false, record: true });
  const qc = makeClient();
  (renderAt as any).lastHistory = history;
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <TooltipProvider>{ui}</TooltipProvider>
      </Router>
    </QueryClientProvider>,
  );
}

/** The rendered-money fence used by all three blocks. Returns the offending
 *  fragments so a failure names them. */
const MONEY_SHAPES = [/[$€£¥]\s?\d/, /\b\d+\.\d{2}\b/, /\bUSD\b|\bJPY\b|\bKWD\b/, /\bamountMinor\b/];
function moneyFragments(text: string): string[] {
  return MONEY_SHAPES.filter((re) => re.test(text)).map((re) => String(re));
}

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});
beforeEach(() => apiRequestMock.mockReset());

/* ==================================================================== */
describe("FE-11 — a failed Deal Room load is never rendered as an empty Deal Room", () => {
  const EMPTY_COPY = "No companies in Deal Room";
  const DEALROOM_URL = "/api/collective/dealroom/companies";

  function mockDealroom(impl: () => Promise<Response>) {
    apiRequestMock.mockImplementation(async (_m: string, url: string) => {
      if (url === DEALROOM_URL) return impl();
      return jsonResponse({});
    });
  }

  it("a 403 renders the refusal and NOT the fabricated empty state", async () => {
    mockDealroom(async () => {
      throw new ApiError(403, "forbidden", null, { ok: false });
    });
    renderAt("/collective/dealroom", <CollectiveDealRoom />);
    const alert = await screen.findByTestId("dealroom-load-failed");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("not an empty Deal Room");
    /* THE defect: pre-fix this found the empty state under the error line. */
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryByTestId("empty-dealroom")).toBeNull();
  });

  it("a 500 behaves identically — a failure is a state, not an absence", async () => {
    mockDealroom(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderAt("/collective/dealroom", <CollectiveDealRoom />);
    await screen.findByTestId("dealroom-load-failed");
    expect(screen.queryByTestId("empty-dealroom")).toBeNull();
  });

  it("the PRE-EXISTING error copy is still rendered — the fix adds, never replaces", async () => {
    mockDealroom(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderAt("/collective/dealroom", <CollectiveDealRoom />);
    /* `error-dealroom` and its exact wording predate this wave. If a future
       edit collapses the two blocks into one, this goes red before the guard
       has to. */
    const legacy = await screen.findByTestId("error-dealroom");
    expect(legacy.textContent).toContain("Failed to load Deal Room data. Please refresh.");
  });

  it("on error the DOUBLE refusal is suppressed — one explanation, not two", async () => {
    /* HARNESS-DRIVEN ADDITION. The falsification run mutated the `error ? null`
       short-circuit away and every test stayed green, because `isSuccess` is
       false on error too, so the not-loaded clarifier simply rendered in the
       empty state's place. That made the short-circuit untested. It is not
       redundant: without it a failed load stacks the generic "not loaded"
       clarifier underneath the specific error copy, which reads as two
       different diagnoses of one event. */
    mockDealroom(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderAt("/collective/dealroom", <CollectiveDealRoom />);
    await screen.findByTestId("dealroom-load-failed");
    expect(screen.queryByTestId("dealroom-not-loaded")).toBeNull();
  });

  it("the refusal offers a retry that re-issues the request", async () => {
    let calls = 0;
    mockDealroom(async () => {
      calls += 1;
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderAt("/collective/dealroom", <CollectiveDealRoom />);
    await screen.findByTestId("dealroom-load-failed");
    const before = calls;
    fireEvent.click(screen.getByTestId("button-retry-dealroom"));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it("POSITIVE POLE — a genuine empty success still shows the empty state", async () => {
    mockDealroom(async () => jsonResponse({ companies: [], total: 0 }));
    renderAt("/collective/dealroom", <CollectiveDealRoom />);
    expect(await screen.findByTestId("empty-dealroom")).toBeTruthy();
    expect(screen.queryByTestId("dealroom-load-failed")).toBeNull();
  });

  it("POSITIVE POLE — rows render neither the empty state nor the refusal", async () => {
    mockDealroom(async () =>
      jsonResponse({
        companies: [
          {
            companyId: "c_1",
            companyName: "Northwind Labs",
            sector: "Climate",
            stage: "seed",
            transactionPrepStatus: "active",
          },
        ],
        total: 1,
      }),
    );
    renderAt("/collective/dealroom", <CollectiveDealRoom />);
    expect(await screen.findByText("Northwind Labs")).toBeTruthy();
    expect(screen.queryByTestId("empty-dealroom")).toBeNull();
    expect(screen.queryByTestId("dealroom-load-failed")).toBeNull();
  });

  it("an OFFLINE-PAUSED query renders neither — `isSuccess` is load-bearing, not decorative", async () => {
    /* Without `isSuccess` in the gate a paused query (pending, not fetching,
       not errored) still falls into the empty branch and restores the
       fabricated zero for a merely disconnected user. */
    onlineManager.setOnline(false);
    mockDealroom(async () => jsonResponse({ companies: [], total: 0 }));
    renderAt("/collective/dealroom", <CollectiveDealRoom />);
    await screen.findByTestId("dealroom-not-loaded");
    expect(screen.queryByTestId("empty-dealroom")).toBeNull();
    expect(screen.queryByTestId("dealroom-load-failed")).toBeNull();
  });

  it("the refusal states no count and no money", async () => {
    mockDealroom(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderAt("/collective/dealroom", <CollectiveDealRoom />);
    const alert = await screen.findByTestId("dealroom-load-failed");
    expect(moneyFragments(alert.textContent ?? "")).toEqual([]);
    expect(alert.textContent).not.toMatch(/\b0\b/);
  });

  it("FENCE POSITIVE POLE — the money fence can actually fail", () => {
    expect(moneyFragments("Balance $0.00 USD").length).toBeGreaterThan(0);
  });
});

/* ==================================================================== */
describe("FE-12 — the partner post-detail deeplink resolves to the post, not the feed", () => {
  const POST = {
    id: "p_42",
    channelId: "ch_network",
    authorUserId: "u_other",
    authorKind: "user" as const,
    body: "A specific post that only the detail view renders.",
    createdAt: new Date().toISOString(),
    visibility: "network" as const,
    likedByUserIds: [],
    commentCount: 0,
    comments: [],
    shareCount: 0,
    authorLabel: "Dana Okafor",
    authorRoleBadge: "Investor",
    authorLocation: "Lagos",
    authorCapavateAngelNetwork: false,
    isAnonymous: false,
  };

  function mockPosts() {
    apiRequestMock.mockImplementation(async (_m: string, url: string) => {
      if (url.startsWith("/api/comms/posts/")) {
        return jsonResponse({ post: POST, comments: [], reactionHistory: [] });
      }
      /* PostsFeed types this query as `PostView[]` and consumes the body
         directly (PostsFeed.tsx:139-146) — a bare array, NOT `{ posts }`.
         The first version of this mock returned the wrapper and the feed
         rendered zero cards, which is exactly how the click test below went
         missing from the falsification run. */
      if (url.startsWith("/api/comms/posts")) return jsonResponse([POST]);
      if (url.startsWith("/api/comms/me")) return jsonResponse({ id: "u_avi_managing", legalName: "Avi" });
      return jsonResponse({});
    });
  }

  it("THE DEFECT: at /collective/partner/posts/:id the detail page renders", async () => {
    mockPosts();
    renderAt("/collective/partner/posts/p_42", <PartnerPosts />);
    /* Pre-fix this test id did not exist on this path at all — the feed
       rendered instead and the id was discarded. */
    expect(await screen.findByTestId("page-post-detail")).toBeTruthy();
    expect(await screen.findByText(POST.body)).toBeTruthy();
  });

  it("the detail request carries the ID FROM THE URL — the route param is actually read", async () => {
    mockPosts();
    renderAt("/collective/partner/posts/p_42", <PartnerPosts />);
    await screen.findByTestId("page-post-detail");
    /* This is the assertion that would have caught the original bug even if a
       detail page had been mounted with a non-matching `useRoute` pattern:
       there, `postId` is "" and the query never fires. */
    const detailCalls = apiRequestMock.mock.calls.filter(
      (c) => typeof c[1] === "string" && (c[1] as string).startsWith("/api/comms/posts/"),
    );
    expect(detailCalls.length).toBeGreaterThan(0);
    expect(detailCalls.some((c) => (c[1] as string).includes("p_42"))).toBe(true);
  });

  it("the shell title switches to the singular — the partner is on a post, not a list", async () => {
    mockPosts();
    renderAt("/collective/partner/posts/p_42", <PartnerPosts />);
    const shell = await screen.findByTestId("partner-shell");
    expect(shell.getAttribute("data-shell-title")).toBe("Post");
  });

  it("a partner-shell back link is rendered as a SIBLING and points inside the shell", async () => {
    mockPosts();
    renderAt("/collective/partner/posts/p_42", <PartnerPosts />);
    const back = await screen.findByTestId("link-back-partner-posts");
    expect(back.getAttribute("href")).toBe("/collective/partner/posts");
    /* The shared page's own breadcrumb literal is untouched and still present —
       the fix must not have swallowed it (guard rule 5). */
    expect(screen.getByTestId("link-back-network-posts").textContent).toContain("Network Posts");
  });

  it("POSITIVE POLE — the list path still renders the FEED, not the detail page", async () => {
    mockPosts();
    renderAt("/collective/partner/posts", <PartnerPosts />);
    await waitFor(() => expect(screen.getByTestId("partner-shell")).toBeTruthy());
    expect(screen.queryByTestId("page-post-detail")).toBeNull();
    expect(screen.getByTestId("partner-shell").getAttribute("data-shell-title")).toBe("Posts");
  });

  it("POSITIVE POLE — a TRAILING SLASH with no id falls back to the feed, not a blank detail page", async () => {
    /* WAVE 19 CORRECTION OF THE RECORD. This test's first version asserted that
       "wouter matches `/posts/:id` against `/posts/` with an empty param", and
       treated the non-empty `id` guard in PartnerPosts.tsx as the thing that
       saved us. MEASURED, and it is FALSE: `regexparam`, which wouter compiles
       its patterns with, returns `null` for "/collective/partner/posts/" and a
       match only for "/collective/partner/posts/p_1" (verified directly against
       `parse()`). So `isDetail` is already false here and the length guard is
       unreachable belt-and-braces, not the load-bearing part.
       The BEHAVIOUR asserted below is still exactly what a partner must get, so
       the test stays; only the explanation was wrong. The falsification harness
       records the same correction and no longer claims a mutation for it. */
    mockPosts();
    renderAt("/collective/partner/posts/", <PartnerPosts />);
    await waitFor(() => expect(screen.getByTestId("partner-shell")).toBeTruthy());
    expect(screen.queryByTestId("page-post-detail")).toBeNull();
  });

  it("clicking a post in the FEED lands on the partner detail URL — `basePath` is load-bearing", async () => {
    /* HARNESS-DRIVEN ADDITION. Removing `basePath` from `<PostsFeed>` left the
       suite fully green, yet that prop is the entire reason a partner's post
       click stays inside the partner shell instead of jumping to
       /investor/posts/:id — the original FE-12 symptom. Nothing asserted it. */
    mockPosts();
    renderAt("/collective/partner/posts", <PartnerPosts />);
    /* PostsFeed makes the post body the navigation trigger (PostsFeed.tsx:706). */
    const body = await screen.findByTestId(`post-body-${POST.id}`);
    fireEvent.click(body);
    await screen.findByTestId("page-post-detail");
    const history = (renderAt as any).lastHistory as string[];
    expect(history[history.length - 1]).toBe(`/collective/partner/posts/${POST.id}`);
  });

  it("no money is rendered on the post detail surface", async () => {
    mockPosts();
    renderAt("/collective/partner/posts/p_42", <PartnerPosts />);
    const page = await screen.findByTestId("page-post-detail");
    expect(moneyFragments(page.textContent ?? "")).toEqual([]);
  });
});

/* ==================================================================== */
describe("FE-13 — a failed conversation load is never rendered as an empty inbox", () => {
  /* HARNESS-DRIVEN NOTE. Rewording this literal left the suite green, because
     every assertion referenced the constant rather than the shipped bytes. The
     string is now fenced against the source file below, so a silent copy drop
     — the exact class of change the guard exists to stop — goes red here. */
  const EMPTY_COPY = "No conversations yet.";

  /* WAVE 37 — THE HARNESS NEVER ESTABLISHED THE PARTNER PRECONDITION, and the
   * consequence was invisible until a case waited long enough to see it.
   *
   * `PartnerMessages` is gated: `client/src/pages/partner/PartnerMessages.tsx:109`
   * is `if (!role.ready || !role.identity) return null;`, and `role` comes from
   * `useRequirePartnerRole`, which queries `/api/partner/me`. This mock's
   * catch-all answered that bootstrap with `{}` — no `partnerId`, no identity —
   * so once the query settled the page correctly rendered NOTHING.
   *
   * The other error cases never noticed, because they assert in the window
   * before the bootstrap settles. The retry case does two round trips, so by
   * the time it looked for the button the whole tree had blanked: `findByTestId`
   * had already resolved with a node that was, by then, DETACHED from
   * `document.body` (observed: body `<div></div>`, `queryAllByTestId(...)` → 0).
   * The retry affordance was never missing; nothing was mounted to hold it.
   *
   * So the mock now supplies a real partner identity. This is the test
   * establishing its own precondition — not reading it from `process.env`, and
   * not weakening the gate to avoid needing it. */
  const W37_PARTNER_IDENTITY = {
    partnerId: "p_w37_fe13",
    tier: "builder",
    subRole: "managing_partner",
    identity: { userId: "u_avi_managing", email: "avi@w37.test", name: "Avi" },
    status: "active",
  };

  /* WAVE 37 — the real endpoint's shape. The catch-all `{}` was not a
   * harmless stub: `MessagingAudienceNotice` dereferences these arrays, and an
   * object without them crashed the render and unmounted the whole page (see
   * the CODE fix in `client/src/components/comms/MessagingAudienceNotice.tsx`).
   * Serving the true shape means these cases exercise the page a partner
   * actually gets, instead of a permanently-broken one. */
  const W37_AUDIENCE_POLICY = {
    viewerRole: "partner",
    rules: [],
    pendingOwnerDecision: [],
    delegatedContext: null,
  };

  function mockComms(channelsImpl: () => Promise<Response>) {
    apiRequestMock.mockImplementation(async (_m: string, url: string) => {
      if (url === "/api/comms/channels") return channelsImpl();
      if (url.startsWith("/api/partner/me")) return jsonResponse(W37_PARTNER_IDENTITY);
      if (url.startsWith("/api/comms/audience-policy")) return jsonResponse(W37_AUDIENCE_POLICY);
      if (url.startsWith("/api/comms/me")) return jsonResponse({ id: "u_avi_managing", legalName: "Avi" });
      if (url.startsWith("/api/comms/users")) return jsonResponse([]);
      return jsonResponse({});
    });
  }

  it("a 403 renders the refusal and NOT the fabricated empty inbox", async () => {
    mockComms(async () => {
      throw new ApiError(403, "forbidden", null, { ok: false });
    });
    renderAt("/collective/partner/messages", <PartnerMessages />);
    const alert = await screen.findByTestId("channels-load-failed");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("not an empty inbox");
    /* THE defect. */
    expect(screen.queryByTestId("empty-channels")).toBeNull();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it("a 500 behaves identically", async () => {
    mockComms(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderAt("/collective/partner/messages", <PartnerMessages />);
    await screen.findByTestId("channels-load-failed");
    expect(screen.queryByTestId("empty-channels")).toBeNull();
  });

  it("the refusal offers a retry that re-issues the request", async () => {
    let calls = 0;
    mockComms(async () => {
      calls += 1;
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderAt("/collective/partner/messages", <PartnerMessages />);
    const alert = await screen.findByTestId("channels-load-failed");

    /* WAVE 37 — ANTI-DETACHMENT. This is the assertion whose absence hid the
     * real problem for a whole wave: `findBy*` resolves with a node that was in
     * the document AT THE TIME IT MATCHED, and happily hands back a node that
     * has since been unmounted. Clicking a detached button fires no React
     * handler and re-issues nothing, and the failure surfaces as a confusing
     * "element not found" for the CHILD rather than "your page unmounted".
     * Requiring the refusal to still be connected turns that into a direct
     * statement about what went wrong. */
    expect(alert.isConnected).toBe(true);
    expect(document.body.contains(alert)).toBe(true);

    const before = calls;
    const retry = screen.getByTestId("button-retry-channels");
    // The affordance is a real, clickable control inside the refusal — not a
    // decorative element that happens to carry the test id.
    expect(retry.tagName).toBe("BUTTON");
    expect(alert.contains(retry)).toBe(true);

    fireEvent.click(retry);
    await waitFor(() => expect(calls).toBeGreaterThan(before));

    // ...and the refusal is still on screen after a retry that also failed:
    // a retry must not collapse the surface into the fabricated empty inbox,
    // which is the FE-13 defect this whole block exists to prevent.
    expect(await screen.findByTestId("channels-load-failed")).toBeTruthy();
    expect(screen.queryByTestId("empty-channels")).toBeNull();
  });

  it("POSITIVE POLE — a genuine empty success still shows the zero-conversation message", async () => {
    mockComms(async () => jsonResponse([]));
    renderAt("/collective/partner/messages", <PartnerMessages />);
    expect(await screen.findByTestId("empty-channels")).toBeTruthy();
    expect(screen.queryByTestId("channels-load-failed")).toBeNull();
  });

  it("POSITIVE POLE — real channels render neither state", async () => {
    mockComms(async () =>
      jsonResponse([
        {
          id: "ch_1",
          kind: "dm",
          displayTitle: "Dana Okafor",
          starred: false,
          unreadCount: 0,
          lastMessage: { preview: "hello", ts: new Date().toISOString(), senderLabel: "Dana" },
        },
      ]),
    );
    renderAt("/collective/partner/messages", <PartnerMessages />);
    expect(await screen.findByText("Dana Okafor")).toBeTruthy();
    expect(screen.queryByTestId("empty-channels")).toBeNull();
    expect(screen.queryByTestId("channels-load-failed")).toBeNull();
  });

  it("an OFFLINE-PAUSED query renders NEITHER — `isSuccess` is load-bearing", async () => {
    onlineManager.setOnline(false);
    mockComms(async () => jsonResponse([]));
    renderAt("/collective/partner/messages", <PartnerMessages />);
    await waitFor(() => expect(screen.getByTestId("partner-shell")).toBeTruthy());
    expect(screen.queryByTestId("empty-channels")).toBeNull();
    expect(screen.queryByTestId("channels-load-failed")).toBeNull();
  });

  it("START-A-DM ALREADY EXISTED and is not regressed by this change", async () => {
    /* MSG-06's other half. Recorded as an EXISTING capability (rule 4:
       prefer wiring, state what already exists) and kept as a live fence so an
       empty-state edit on this page cannot quietly remove it. */
    mockComms(async () => jsonResponse([]));
    renderAt("/collective/partner/messages", <PartnerMessages />);
    expect(await screen.findByTestId("partner-new-dm-button")).toBeTruthy();
  });

  it("the refusal states no count and no money", async () => {
    mockComms(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderAt("/collective/partner/messages", <PartnerMessages />);
    const alert = await screen.findByTestId("channels-load-failed");
    expect(moneyFragments(alert.textContent ?? "")).toEqual([]);
  });
});

/* ==================================================================== */
describe("FE-13 — the SAME sink shape occurs three times in MessagesPage; all three are fixed", () => {
  /* Found by grepping the file for `?? []` / `asArray(` behind an `!isLoading`
     gate, not by reading the row. A source fence is used for the two branches
     whose live render needs an active channel, because a fence that reads the
     source cannot be satisfied by a lucky mock — and it is proven to FIRE on a
     fixture containing the defective shape, so it is not a naive substring
     search. */
  const SOURCE = String(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("fs").readFileSync(
      require("path").resolve(__dirname, "../../../components/comms/MessagesPage.tsx"),
      "utf8",
    ),
  );

  function gateIsHardened(needle: string): boolean {
    const i = SOURCE.indexOf(needle);
    if (i < 0) return false;
    return /!\w+\.isLoading && !\w+\.isError && \w+\.isSuccess/.test(SOURCE.slice(i, i + 220));
  }

  it("the channel-list gate is hardened", () => {
    expect(gateIsHardened("{!channels.isLoading &&")).toBe(true);
  });

  it("the thread-body gate is hardened", () => {
    expect(gateIsHardened("{!channelDetail.isLoading &&")).toBe(true);
  });

  it("the dataroom-picker gate is hardened", () => {
    expect(gateIsHardened("{!dataroomFiles.isLoading &&")).toBe(true);
  });

  it("each of the three has a rendered refusal element, not just a tightened gate", () => {
    /* A tightened gate ALONE would be rule-3 non-compliance: it removes the
       fabricated empty state but shows nothing in its place. */
    for (const id of [
      "channels-load-failed",
      "channel-detail-load-failed",
      "dataroom-files-load-failed",
    ]) {
      expect(SOURCE).toContain(`data-testid="${id}"`);
    }
  });

  it("the PRE-EXISTING empty-state copy is byte-identical in the source", () => {
    /* HARNESS-DRIVEN ADDITION. Rewording "No conversations yet." to anything
       else left all 30 tests green, because every assertion compared against
       the test's own constant instead of the shipped literal. Under guard rule
       5 that reword is a copy REMOVAL, and this wave must not make one. */
    /* Anchored on the element that owns it, so a stray mention in a comment
       cannot satisfy the fence (the file has one at :432). */
    const i = SOURCE.indexOf('data-testid="empty-channels"');
    expect(i).toBeGreaterThan(-1);
    expect(SOURCE.slice(i, i + 120)).toContain("No conversations yet.");
  });

  it("COPY FENCE POSITIVE POLE — the copy fence reports FALSE on a reworded fixture", () => {
    const i = SOURCE.indexOf('data-testid="empty-channels"');
    const reworded = SOURCE.slice(0, i) + SOURCE.slice(i).replace("No conversations yet.", "Nothing here.");
    const j = reworded.indexOf('data-testid="empty-channels"');
    expect(reworded.slice(j, j + 120)).not.toContain("No conversations yet.");
  });

  it("FENCE POSITIVE POLE — the gate predicate reports FALSE on the pre-fix shape", () => {
    const pre = `{!channels.isLoading && filteredList.length === 0 && (`;
    expect(/!\w+\.isLoading && !\w+\.isError && \w+\.isSuccess/.test(pre)).toBe(false);
  });

  it("FENCE POSITIVE POLE — the predicate reports TRUE on a synthetic hardened shape", () => {
    const post = `{!foo.isLoading && !foo.isError && foo.isSuccess && list.length === 0 && (`;
    expect(/!\w+\.isLoading && !\w+\.isError && \w+\.isSuccess/.test(post)).toBe(true);
  });
});
