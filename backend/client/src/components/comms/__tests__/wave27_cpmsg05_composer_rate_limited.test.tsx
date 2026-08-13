/**
 * WAVE 27 · CP-MSG-05 (client half, shared composer) — the 429 that only became
 * reachable this wave must be RENDERED.
 *
 * Wave 18 gave `client/src/pages/partner/PartnerMessages.tsx` a 429 banner for
 * `POST /api/comms/dm/start`. It shipped a renderer for a response the server
 * could not produce: `/api/comms` carried no limiter (see
 * `server/__tests__/wave27_cpmsg05_comms_rate_limit.test.ts`). This wave mounts
 * `collectiveRateLimit` on the comms write paths, which makes 429 reachable —
 * and therefore makes the SHARED composer's missing 429 branch a live defect.
 * `MessagesPage` previously routed a 429 into `toast({title:"Send failed",
 * description: e.message})`: the wrong story (the message is fine, the window is
 * full) in a transient element that expires while the condition persists.
 *
 * Poles asserted: the banner appears on 429 and the draft survives; it does NOT
 * appear on 403, on a generic 500, or on success; a 429 with no usable
 * `retryAfterMs` renders the refusal WITHOUT inventing a countdown; and a
 * subsequent success clears it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import { MessagesPage } from "../MessagesPage";
import { RoleProvider } from "@/lib/role";

const CHANNEL_ID = "ch_w27";

/** Error shaped exactly like `ApiError` from `@/lib/queryClient`: the composer
 *  reads `.status` and `.payload`, so a bare `Error` would silently take the
 *  generic branch and make this test vacuous. */
function apiError(status: number, payload: unknown, message = "request failed") {
  const e = new Error(message) as Error & { status: number; payload: unknown };
  e.status = status;
  e.payload = payload;
  return e;
}

function seed(qc: QueryClient) {
  /* `useQuery<ChannelView[]>` at MessagesPage.tsx:155 — a bare array, not an
     envelope. Seeding the wrong shape crashes the list render, which would have
     made every assertion below unreachable rather than false. */
  const channel = {
    id: CHANNEL_ID,
    kind: "dm",
    // `displayTitle` is required: MessagesPage.tsx:493 calls `.split(" ")` on it
    // unguarded, so omitting it crashes the render.
    displayTitle: "Test Counterparty",
    title: "Test DM",
    participantUserIds: ["u_me", "u_them"],
    unreadCount: 0,
    lastMessage: null,
  };
  qc.setQueryData(["/api/comms/channels"], [channel]);
  qc.setQueryData(["/api/comms/me"], { id: "u_me", legalName: "Me" });
  qc.setQueryData(["/api/comms/channels", CHANNEL_ID], { channel, messages: [] });
  qc.setQueryData(["/api/comms/channels", CHANNEL_ID, "read-receipts"], { receipts: [] });
}

function renderComposer() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity }, mutations: { retry: false } },
  });
  seed(qc);
  const utils = render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <MessagesPage role="investor" />
      </RoleProvider>
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

/** Type into the composer and press Send. Returns false if the composer is not
 *  reachable in this environment, so a skipped interaction can never be
 *  mistaken for a passing assertion. */
async function trySend(text: string): Promise<boolean> {
  const input = screen.queryByTestId("input-message");
  if (!input) return false;
  fireEvent.change(input, { target: { value: text } });
  /* The draft is controlled state and Send is `disabled={!draft.trim() || ...}`.
     Clicking in the same tick clicks a still-disabled button, which is a silent
     no-op — the first version of this helper did exactly that and every
     assertion below failed for the wrong reason. Let the state settle, then
     refuse to proceed if Send is still disabled rather than "clicking" nothing. */
  await waitFor(() =>
    expect((screen.getByTestId("input-message") as HTMLTextAreaElement).value).toBe(text),
  );
  const send = screen.queryByTestId("button-send") as HTMLButtonElement | null;
  if (!send || send.disabled) return false;
  fireEvent.click(send);
  return true;
}

describe("WAVE 27 · CP-MSG-05 — shared composer renders the rate-limit refusal", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    toastMock.mockReset();
  });
  afterEach(() => cleanup());

  it("renders the banner on 429 with the server's own countdown, and keeps the draft", async () => {
    apiRequestMock.mockRejectedValue(apiError(429, { error: "rate_limited", bucket: "write", retryAfterMs: 30_000 }));
    renderComposer();
    const clicked = await trySend("hello there");
    expect(clicked, "composer not reachable — assertions below would be vacuous").toBe(true);

    const banner = await screen.findByTestId("composer-rate-limited-banner");
    expect(banner.textContent).toMatch(/too many messages/i);
    // The countdown comes from the server payload, never from a guess.
    expect(banner.textContent).toMatch(/\b(29|30)\s+seconds/);
    // The draft is restored so the operator does not retype it.
    await waitFor(() => expect((screen.getByTestId("input-message") as HTMLTextAreaElement).value).toBe("hello there"));
    // And it is NOT delivered as the misleading generic failure.
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Send failed" }));
  });

  it("renders the refusal WITHOUT a countdown when retryAfterMs is missing or nonsense", async () => {
    apiRequestMock.mockRejectedValue(apiError(429, { error: "rate_limited", retryAfterMs: "soon" }));
    renderComposer();
    expect(await trySend("hi")).toBe(true);

    const banner = await screen.findByTestId("composer-rate-limited-banner");
    expect(banner.textContent).toMatch(/too many messages/i);
    expect(banner.textContent).toMatch(/shortly/);
    expect(banner.textContent).not.toMatch(/\d+\s+seconds/); // no fabricated number
  });

  it("does NOT render the banner on a 403 DM block — the existing blocked banner still owns that case", async () => {
    apiRequestMock.mockRejectedValue(apiError(403, { code: "CANNOT_DM_RECIPIENT" }));
    renderComposer();
    expect(await trySend("hi")).toBe(true);

    await screen.findByTestId("composer-blocked-banner");
    expect(screen.queryByTestId("composer-rate-limited-banner")).toBeNull();
  });

  it("does NOT render the banner on a generic 500 — that keeps the honest 'Send failed' toast", async () => {
    apiRequestMock.mockRejectedValue(apiError(500, null, "boom"));
    renderComposer();
    expect(await trySend("hi")).toBe(true);

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Send failed" })));
    expect(screen.queryByTestId("composer-rate-limited-banner")).toBeNull();
  });

  it("sends exactly the text on screen — the request BODY is asserted, not merely that a request happened", async () => {
    /* This case exists because every other case in this file asserts only which
       BANNER appeared. A send that transmitted the wrong string would satisfy
       all of them. Asserting the outgoing body closes that, and it is what
       kills mutation C6 (`draftRef` never updated).

       KNOWN COVERAGE GAP, STATED RATHER THAN PAPERED OVER: mutation C7 —
       making the `setDraft` wrapper ignore its UPDATER form (`(v as string)`)
       — still survives this file. Reaching it needs the `fileRef` deep-link at
       MessagesPage.tsx:222 (`setDraft((d) => d || "[File reference: ...]")`),
       which requires driving `useLocation`; nothing here does. `tsc` rejects
       the naive version of that regression (it was how the wrapper's original
       `string`-only signature was caught) but an explicit `as string` cast
       would silence it. See WAVE27_REPORT.md §2.4. */
    const bodies: unknown[] = [];
    apiRequestMock.mockImplementation((_m: string, url: string, body?: unknown) => {
      if (url.endsWith("/messages")) bodies.push(body);
      return Promise.resolve({ json: async () => ({ ok: true }) } as unknown as Response);
    });
    renderComposer();

    // Type, clear via the updater-shaped path, then retype: the ref must track
    // the visible textarea at every step.
    expect(await trySend("first body")).toBe(true);
    await waitFor(() => expect(bodies.length).toBe(1));
    expect((bodies[0] as { body: string }).body).toBe("first body");

    expect(await trySend("second body")).toBe(true);
    await waitFor(() => expect(bodies.length).toBe(2));
    expect((bodies[1] as { body: string }).body).toBe("second body");

    // The draft is cleared optimistically after each send, so a stale ref would
    // resend the PREVIOUS body here rather than the new one — asserted above.
    expect((bodies[0] as { body: string }).body).not.toBe((bodies[1] as { body: string }).body);
  });

  it("does NOT render the banner on success, and a later success clears an earlier 429", async () => {
    /* Route by URL, not by call order. The component also fires
       `POST /api/comms/channels/:id/read` on mount, and a `mockRejectedValueOnce`
       was being consumed by THAT call — so the send saw `undefined`, threw a
       TypeError on `res.json()`, and this test failed for a reason that had
       nothing to do with rate limiting. */
    let sends = 0;
    apiRequestMock.mockImplementation((_method: string, url: string) => {
      if (!url.endsWith("/messages")) return Promise.resolve({ json: async () => ({ ok: true }) } as unknown as Response);
      sends += 1;
      if (sends === 1) return Promise.reject(apiError(429, { error: "rate_limited", retryAfterMs: 30_000 }));
      return Promise.resolve({ json: async () => ({ ok: true }) } as unknown as Response);
    });
    renderComposer();
    expect(await trySend("first")).toBe(true);
    await screen.findByTestId("composer-rate-limited-banner");

    // The window reopens; the second send succeeds via the same router above.
    expect(await trySend("second")).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("composer-rate-limited-banner")).toBeNull());
  });
});
