/**
 * W2M B4 — styled schedule datetime field + companyId/partial-failure handling.
 *
 * Covers:
 *  - the schedule field is the styled DateTimeLocalField (data-testid
 *    "post-schedule-datetime"), not the native unstyled input, and keeps the
 *    same value/onChange contract (typing updates the value).
 *  - creating a `followers` post sends `companyId` from the active-company
 *    context.
 *  - a `followers`/`cap_table` audience is disabled when no active company
 *    is known (never silently posts without companyId).
 *  - a 500 POST_PERSIST_FAILED response shows a destructive toast, keeps the
 *    composer text intact, and does NOT show a success toast.
 *  - a partial failure on the "both" split shows a partial-failure toast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PostsFeed } from "../PostsFeed";
import { ApiError } from "@/lib/queryClient";
import { RoleProvider } from "@/lib/role";

// jsdom doesn't implement these DOM APIs that Radix UI's <Select> uses
// internally (scroll-into-view on open, pointer-capture during pointer
// interactions). Polyfill them as no-ops purely so the Radix portal content
// can mount/interact in tests — this does not affect app behavior.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
} else {
  Element.prototype.scrollIntoView = vi.fn();
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

let entitlementCtx: any = {
  userId: "u_founder_1",
  founder: { companies: [], activeCompanyId: "co_acme" },
  investor: { invitedRounds: [], capTablePositions: [], state: "NONE" },
  collective: { status: "none", role: null, expiresAt: null },
  isAdmin: false,
  isAuthed: true,
};
vi.mock("@/lib/entitlement", async () => {
  const actual = await vi.importActual<typeof import("@/lib/entitlement")>("@/lib/entitlement");
  return {
    ...actual,
    useEntitlement: () => ({ data: entitlementCtx, isLoading: false }),
  };
});

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  };
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

function renderFeed() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Mirrors the app's real default queryFn (apiRequest("GET", key[0]).json())
        // so bare `useQuery({ queryKey: [...] })` calls (e.g. /api/comms/me) resolve
        // through the same apiRequestMock instead of warning "No queryFn".
        queryFn: async ({ queryKey }) => {
          const [url] = queryKey as [string];
          const r = await apiRequestMock("GET", url);
          return r.json();
        },
      },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <PostsFeed role="founder" />
      </RoleProvider>
    </QueryClientProvider>
  );
}

describe("PostsFeed — schedule field + companyId + partial-failure (W2M B4)", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    toastMock.mockReset();
    entitlementCtx = {
      userId: "u_founder_1",
      founder: { companies: [], activeCompanyId: "co_acme" },
      investor: { invitedRounds: [], capTablePositions: [], state: "NONE" },
      collective: { status: "none", role: null, expiresAt: null },
      isAdmin: false,
      isAuthed: true,
    };
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url.startsWith("/api/comms/posts")) return jsonResponse(200, []);
      if (method === "GET" && url === "/api/comms/me") return jsonResponse(200, { id: "u_founder_1", legalName: "Founder One" });
      throw new Error(`unhandled ${method} ${url}`);
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the styled DateTimeLocalField (not the native datetime-local input)", () => {
    renderFeed();
    const field = screen.getByTestId("post-schedule-datetime") as HTMLInputElement;
    expect(field).toBeTruthy();
    expect(field.tagName).toBe("INPUT");
    expect(field.type).toBe("datetime-local");
    fireEvent.change(field, { target: { value: "2026-08-01T10:00" } });
    expect(field.value).toBe("2026-08-01T10:00");
  });

  it("includes companyId for a followers post from the active-company context", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string, body?: unknown) => {
      if (method === "GET" && url.startsWith("/api/comms/posts")) return jsonResponse(200, []);
      if (method === "GET" && url === "/api/comms/me") return jsonResponse(200, { id: "u_founder_1", legalName: "Founder One" });
      if (method === "POST" && url === "/api/comms/posts") {
        expect((body as any).companyId).toBe("co_acme");
        return jsonResponse(200, { id: "post_1" });
      }
      throw new Error(`unhandled ${method} ${url}`);
    });

    renderFeed();
    fireEvent.change(screen.getByTestId("input-post-draft"), { target: { value: "Update for followers" } });

    const visibilitySelect = screen.getByTestId("select-post-visibility");
    fireEvent.click(visibilitySelect);
    const followersOption = await screen.findByTestId("select-post-visibility-followers");
    fireEvent.click(followersOption);

    fireEvent.click(screen.getByTestId("button-post-submit"));

    await waitFor(() => {
      const followerCalls = apiRequestMock.mock.calls.filter(
        (c) => c[0] === "POST" && c[1] === "/api/comms/posts"
      );
      expect(followerCalls.length).toBeGreaterThan(0);
    });
  });

  it("disables followers/cap_table audiences when no active company is known", () => {
    entitlementCtx = {
      userId: "u_founder_1",
      founder: { companies: [], activeCompanyId: null },
      investor: { invitedRounds: [], capTablePositions: [], state: "NONE" },
      collective: { status: "none", role: null, expiresAt: null },
      isAdmin: false,
      isAuthed: true,
    };
    renderFeed();
    fireEvent.click(screen.getByTestId("select-post-visibility"));
    const followersOption = screen.getByTestId("select-post-visibility-followers");
    // Radix marks disabled items with aria-disabled="true" and a (value-less)
    // data-disabled attribute — check both presence forms.
    expect(
      followersOption.getAttribute("aria-disabled") === "true" ||
        followersOption.hasAttribute("data-disabled")
    ).toBe(true);
    expect(followersOption.textContent).toContain("no active company");
  });

  it("shows a destructive toast and keeps composer text on a 500 POST_PERSIST_FAILED — no false success", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url.startsWith("/api/comms/posts")) return jsonResponse(200, []);
      if (method === "GET" && url === "/api/comms/me") return jsonResponse(200, { id: "u_founder_1", legalName: "Founder One" });
      if (method === "POST" && url === "/api/comms/posts") {
        throw new ApiError(500, "Your post could not be saved. Please try again.", "POST_PERSIST_FAILED", { ok: false });
      }
      throw new Error(`unhandled ${method} ${url}`);
    });

    renderFeed();
    const draftField = screen.getByTestId("input-post-draft") as HTMLTextAreaElement;
    fireEvent.change(draftField, { target: { value: "My important update" } });
    fireEvent.click(screen.getByTestId("button-post-submit"));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Post failed", variant: "destructive" })
      );
    });
    // Composer text must remain intact — no false success, no silent clear.
    expect(draftField.value).toBe("My important update");
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Post published" }));
  });

  it('shows a partial-failure toast with retry copy when the "both" split partially fails', async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string, body?: unknown) => {
      if (method === "GET" && url.startsWith("/api/comms/posts")) return jsonResponse(200, []);
      if (method === "GET" && url === "/api/comms/me") return jsonResponse(200, { id: "u_founder_1", legalName: "Founder One" });
      if (method === "POST" && url === "/api/comms/posts") {
        const visibility = (body as any)?.visibility;
        if (visibility === "followers") {
          throw new ApiError(500, "Your post could not be saved. Please try again.", "POST_PERSIST_FAILED", { ok: false });
        }
        return jsonResponse(200, { id: "post_ok" });
      }
      throw new Error(`unhandled ${method} ${url}`);
    });

    renderFeed();
    fireEvent.change(screen.getByTestId("input-post-draft"), { target: { value: "Both audiences update" } });
    fireEvent.click(screen.getByTestId("select-post-visibility"));
    fireEvent.click(await screen.findByTestId("select-post-visibility-both"));
    fireEvent.click(screen.getByTestId("button-post-submit"));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Post partially failed", variant: "destructive" })
      );
    });
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Post published" }));
  });
});
