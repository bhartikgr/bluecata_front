/**
 * W2M B5 — identity display safety in admin Post Moderation.
 *
 * GET /api/admin/posts only returns the raw `authorUserId` (no server-resolved
 * display label). The primary "Author" cell must therefore NEVER render that
 * raw id (which can look like an email or a `u_...` id) directly — it must
 * show a safe generic label, with the raw id demoted to a secondary
 * muted/monospace subtext. This asserts the primary cell text never contains
 * "@" and never matches /^u_[a-z0-9_]+$/, for posts with and without an
 * authorUserId.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PostsModeration from "../PostsModeration";
import { RoleProvider } from "@/lib/role";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

const NOT_EMAIL_OR_RAW_ID = /^u_[a-z0-9_]+$/;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <PostsModeration />
      </RoleProvider>
    </QueryClientProvider>
  );
}

describe("PostsModeration — identity display safety (W2M B5)", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("never renders the raw authorUserId as the primary author name", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/admin/posts") {
        return jsonResponse(200, {
          ok: true,
          posts: [
            {
              id: "post_1",
              authorUserId: "u_a1b2c3d4",
              body: "Hello network",
              createdAt: "2026-07-01T00:00:00Z",
              hidden: false,
              deletedAt: null,
            },
            {
              id: "post_2",
              authorUserId: "someone@example.com",
              body: "Another update",
              createdAt: "2026-07-02T00:00:00Z",
              hidden: false,
              deletedAt: null,
            },
            {
              id: "post_3",
              authorUserId: null,
              body: "Anonymous-ish post",
              createdAt: "2026-07-03T00:00:00Z",
              hidden: false,
              deletedAt: null,
            },
          ],
        });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("posts-moderation-table")).toBeTruthy());

    for (const postId of ["post_1", "post_2", "post_3"]) {
      const primaryName = screen.getByTestId(`author-name-${postId}`);
      const text = primaryName.textContent ?? "";
      expect(text).not.toContain("@");
      expect(NOT_EMAIL_OR_RAW_ID.test(text)).toBe(false);
      expect(text).toBe("Collective member");
    }

    // The raw id must still be available somewhere, but only in a secondary,
    // clearly-labeled (muted/monospace) location — never as the primary name.
    expect(screen.getByTestId("author-id-post_1").textContent).toBe("u_a1b2c3d4");
    expect(screen.getByTestId("author-id-post_2").textContent).toBe("someone@example.com");
    expect(screen.getByTestId("author-id-post_1").className).toMatch(/font-mono/);
  });
});
