/**
 * WAVE 18 · CP-MSG-05 (client half) — the 429 must be RENDERED, not hidden.
 *
 * The server refuses with `{error:"rate_limited", bucket, retryAfterMs}`
 * (`server/lib/rateLimit.ts` collectiveRateLimit). Before this wave the partner
 * Messages page routed that into the generic `Failed to start message` toast:
 * a transient element that disappears in seconds and takes the retry window
 * with it, leaving a partner re-clicking a button whose refusal they can no
 * longer read. The banner is a SIBLING element above the toolbar (never text
 * appended inside an existing node) and is driven only by the server's own
 * `retryAfterMs` — no invented countdown, no fabricated success.
 *
 * Poles asserted: the banner appears on 429; it does NOT appear on 403/422 or
 * on success; a 429 without a usable `retryAfterMs` still renders the refusal
 * but with no number.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerMessages from "../PartnerMessages";
import { ApiError } from "@/lib/queryClient";
import { RoleProvider } from "@/lib/role";

vi.mock("@/components/comms/MessagesPage", () => ({
  MessagesPage: () => <div data-testid="mock-messages-page" />,
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_1",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_partner_1", email: "partner@example.com", name: "Partner One" },
    },
  }),
}));

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

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <PartnerMessages />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** Open the picker and click the single contact, with `dmResult` as the outcome. */
async function attemptDm(dmResult: () => Promise<Response> | never) {
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    if (method === "GET" && url === "/api/comms/users") {
      return jsonResponse(200, [{ id: "u_2", legalName: "Aisha Patel" }]);
    }
    if (method === "POST" && url === "/api/comms/dm/start") return dmResult();
    throw new Error(`unexpected request ${method} ${url}`);
  });
  renderPage();
  fireEvent.click(screen.getByTestId("partner-new-dm-button"));
  await waitFor(() => expect(screen.getByTestId("partner-new-dm-pick-u_2")).toBeTruthy());
  fireEvent.click(screen.getByTestId("partner-new-dm-pick-u_2"));
}

const BANNER = "partner-messages-rate-limited";

describe("CP-MSG-05 — a rate-limited send is a rendered, persistent refusal", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    toastMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("no banner before anything has been refused", async () => {
    await attemptDm(async () => jsonResponse(200, { ok: true, channelId: "dm_1_2" }));
    await waitFor(() => expect(screen.queryByTestId("partner-new-dm-picker")).toBeNull());
    expect(screen.queryByTestId(BANNER)).toBeNull();
  });

  it("renders the banner on a 429 and stays on screen after the toast would have gone", async () => {
    await attemptDm(() => {
      throw new ApiError(429, "Too many requests — please wait a moment and try again.", "rate_limited", {
        error: "rate_limited",
        bucket: "write",
        retryAfterMs: 42_000,
      });
    });
    const banner = await screen.findByTestId(BANNER);
    expect(banner.textContent).toContain("too many messages");
    /* The wait comes from the server payload — 42s, rendered in seconds. */
    expect(banner.textContent).toMatch(/4[12] seconds/);
    /* It is a sibling of the toolbar, not text spliced into an existing node. */
    expect(banner.getAttribute("role")).toBe("status");
    expect(screen.getByTestId("partner-new-dm-button")).toBeTruthy();
    /* The toast still fires, for immediacy — but it is not the only signal. */
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Too many messages — please slow down" }),
    );
  });

  it("a 429 with no usable retryAfterMs renders the refusal WITHOUT inventing a number", async () => {
    await attemptDm(() => {
      throw new ApiError(429, "Too many requests", "rate_limited", { error: "rate_limited" });
    });
    const banner = await screen.findByTestId(BANNER);
    expect(banner.textContent).toContain("shortly");
    expect(banner.textContent).not.toMatch(/\d+ seconds/);
    expect(banner.textContent).not.toContain("NaN");
    expect(banner.textContent).not.toContain("undefined");
  });

  it("NEGATIVE POLE — 403 and 422 do not raise the rate-limit banner", async () => {
    await attemptDm(() => {
      throw new ApiError(403, "You don’t have permission to do that.", null, { ok: false });
    });
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "You can't message this person" }),
      ),
    );
    expect(screen.queryByTestId(BANNER)).toBeNull();
    cleanup();
    toastMock.mockReset();

    await attemptDm(() => {
      throw new ApiError(422, "Contact must accept first", "contact_not_provisioned", { ok: false });
    });
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Contact must accept their invitation first" }),
      ),
    );
    expect(screen.queryByTestId(BANNER)).toBeNull();
  });

  it("the banner clears once a send succeeds", async () => {
    /* First attempt 429s, second succeeds — within one mounted page. */
    let attempt = 0;
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/comms/users") {
        return jsonResponse(200, [{ id: "u_2", legalName: "Aisha Patel" }]);
      }
      if (method === "POST" && url === "/api/comms/dm/start") {
        attempt += 1;
        if (attempt === 1) {
          throw new ApiError(429, "Too many requests", "rate_limited", {
            error: "rate_limited",
            retryAfterMs: 30_000,
          });
        }
        return jsonResponse(200, { ok: true, channelId: "dm_1_2" });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    });

    renderPage();
    fireEvent.click(screen.getByTestId("partner-new-dm-button"));
    await waitFor(() => expect(screen.getByTestId("partner-new-dm-pick-u_2")).toBeTruthy());
    fireEvent.click(screen.getByTestId("partner-new-dm-pick-u_2"));
    await screen.findByTestId(BANNER);

    fireEvent.click(screen.getByTestId("partner-new-dm-button"));
    await waitFor(() => expect(screen.getByTestId("partner-new-dm-pick-u_2")).toBeTruthy());
    fireEvent.click(screen.getByTestId("partner-new-dm-pick-u_2"));
    await waitFor(() => expect(screen.queryByTestId(BANNER)).toBeNull());
  });

  it("the banner carries no money and no fabricated figures", async () => {
    await attemptDm(() => {
      throw new ApiError(429, "Too many requests", "rate_limited", {
        error: "rate_limited",
        retryAfterMs: 15_000,
      });
    });
    const banner = await screen.findByTestId(BANNER);
    const text = banner.textContent ?? "";
    for (const forbidden of ["$", "USD", "JPY", "0.00", "$0"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
