/**
 * WAVE 38 · ROW 5 — PostsFeed partner deeplink, EXERCISED not described.
 *
 * ── WHY THIS FILE WAS REWRITTEN ─────────────────────────────────────────────
 * `PostsFeed.partnerBasePath.test.ts` (now deleted) asserted on SOURCE TEXT and
 * on a local `postDetailUrl()` mirror it had written itself. Review 3B planted
 *
 *     navigate(`/review3b-wrong/${id}`); return;
 *     navigate(`${postsBase}/posts/${id}`);
 *
 * in the shipped component — i.e. every click went to a wrong destination — and
 * the file stayed 5/5 GREEN. It searched for a string that was still present
 * one line below the code that actually ran. That is the same class as the four
 * self-referential tests already repaired this wave.
 *
 * ── WHAT THIS FILE DOES INSTEAD ─────────────────────────────────────────────
 * It RENDERS `PostsFeed`, CLICKS a post, and asserts on the argument wouter's
 * `navigate` was actually called with. A wrong destination anywhere on the
 * executed path fails, no matter what the surrounding source text still says.
 *
 * Poles asserted:
 *   A — partner basePath: one click → exactly `/collective/partner/posts/:id`.
 *   B — the doubling regression this file exists for is absent from the
 *       EXECUTED value, not merely from the source.
 *   C — the default (no basePath) still resolves under the role prefix, for
 *       both roles, so "delete the basePath feature" does not pass.
 *   D — the copy-link share URL, the other consumer of `postsBase`, composes
 *       the same path (Review 3B's mutation would also have gone unnoticed here).
 *   E — the destination the component produces is the route App.tsx registers,
 *       with the `:id` slot filled by the clicked post's real id.
 *
 * Preconditions are established here; nothing reads `process.env`. Static
 * imports only. No production file is written by this test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const navigateMock = vi.fn();
vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return { ...actual, useLocation: () => ["/collective/partner/posts", navigateMock] };
});

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/entitlement", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/entitlement");
  return {
    ...actual,
    useEntitlement: () => ({ data: { userId: "u_me", investor: { capTablePositions: [] } } }),
  };
});

import { PostsFeed } from "../comms/PostsFeed";

const ROOT = resolve(__dirname, "../../../..");
const POST_ID = "p_w38_row5";

/** The single post the feed will render. Shaped as `GET /api/comms/posts` answers. */
const POST = {
  id: POST_ID,
  channelId: "ch_network",
  body: "Wave 38 row 5 fixture post",
  authorUserId: "u_them",
  authorKind: "user",
  visibility: "network",
  createdAt: new Date().toISOString(),
  likedByUserIds: [],
  commentCount: 0,
  comments: [],
  shareCount: 0,
  authorLabel: "Someone Else",
  authorRoleBadge: "Investor",
  authorLocation: "Tel Aviv",
  authorCapavateAngelNetwork: false,
  isAnonymous: false,
};

let clipboardWrites: string[] = [];

beforeEach(() => {
  navigateMock.mockReset();
  apiRequestMock.mockReset();
  clipboardWrites = [];
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.startsWith("/api/comms/posts")) {
      return { json: async () => [POST], ok: true } as unknown as Response;
    }
    return { json: async () => ({}), ok: true } as unknown as Response;
  });
  Object.defineProperty(globalThis, "navigator", {
    value: {
      ...globalThis.navigator,
      clipboard: {
        writeText: (t: string) => {
          clipboardWrites.push(t);
          return Promise.resolve();
        },
      },
    },
    configurable: true,
  });
});

afterEach(() => cleanup());

function renderFeed(props: { role: "founder" | "investor"; basePath?: string }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  qc.setQueryData(["/api/comms/me"], { id: "u_me", legalName: "Me" });
  return render(
    <QueryClientProvider client={qc}>
      <PostsFeed role={props.role} basePath={props.basePath} />
    </QueryClientProvider>,
  );
}

/** Click the rendered post body. Returns false if the post never rendered, so a
 *  missing fixture can never be mistaken for a passing assertion. */
async function clickPost(): Promise<boolean> {
  const body = await waitFor(() => screen.getByTestId(`post-body-${POST_ID}`));
  if (!body) return false;
  fireEvent.click(body);
  return true;
}

describe("Wave 38 · Row 5 — PostsFeed navigates to the composed detail URL (executed)", () => {
  it("ANTI-VACUITY — the fixture post really renders and a click really navigates", async () => {
    renderFeed({ role: "investor", basePath: "/collective/partner" });
    expect(await clickPost()).toBe(true);
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });

  it("POLE A — partner basePath produces exactly /collective/partner/posts/:id", async () => {
    renderFeed({ role: "investor", basePath: "/collective/partner" });
    await clickPost();
    expect(navigateMock).toHaveBeenCalledWith(`/collective/partner/posts/${POST_ID}`);
  });

  it("POLE B — the executed destination never doubles the /posts segment", async () => {
    renderFeed({ role: "investor", basePath: "/collective/partner" });
    await clickPost();
    const dest = String(navigateMock.mock.calls[0][0]);
    expect(dest).not.toContain("/posts/posts/");
    expect(dest.match(/\/posts\//g) ?? []).toHaveLength(1);
  });

  it("POLE C — with no basePath the destination falls back to the role prefix", async () => {
    renderFeed({ role: "investor" });
    await clickPost();
    expect(navigateMock).toHaveBeenCalledWith(`/investor/posts/${POST_ID}`);
    cleanup();
    navigateMock.mockReset();
    renderFeed({ role: "founder" });
    await clickPost();
    expect(navigateMock).toHaveBeenCalledWith(`/founder/posts/${POST_ID}`);
  });

  it("POLE D — the copy-link share URL uses the same resolved base", async () => {
    renderFeed({ role: "investor", basePath: "/collective/partner" });
    await waitFor(() => screen.getByTestId(`post-body-${POST_ID}`));
    const share = screen.getByTestId(`button-share-${POST_ID}`);
    fireEvent.click(share);
    await waitFor(() => expect(clipboardWrites.length).toBeGreaterThan(0));
    expect(clipboardWrites[0]).toBe(
      `${window.location.origin}/collective/partner/posts/${POST_ID}`,
    );
    expect(clipboardWrites[0]).not.toContain("/posts/posts/");
  });

  it("POLE E — the executed destination matches the route App.tsx registers", async () => {
    const app = readFileSync(resolve(ROOT, "client/src/App.tsx"), "utf8");
    expect(app).toContain("/collective/partner/posts/:id");
    renderFeed({ role: "investor", basePath: "/collective/partner" });
    await clickPost();
    expect(navigateMock.mock.calls[0][0]).toBe(
      "/collective/partner/posts/:id".replace(":id", POST_ID),
    );
  });
});

describe("Wave 38 · Row 5 — the partner callers still pass the base the feed expects", () => {
  /* Kept from the old file because it guards a DIFFERENT thing (what the two
     partner pages hand the feed) than the runtime cases above (what the feed
     does with it). Resolved through the shared constant rather than pinned to a
     literal, so Wave 19 / FE-12's constant is honoured. */
  const posts = readFileSync(resolve(ROOT, "client/src/pages/partner/PartnerPosts.tsx"), "utf8");
  const dash = readFileSync(resolve(ROOT, "client/src/pages/partner/PartnerDashboard.tsx"), "utf8");

  const resolveBasePath = (src: string): string | null => {
    const m = src.match(/<PostsFeed[^>]*\bbasePath=(?:"([^"]*)"|\{([A-Za-z_$][\w$]*)\})/);
    if (!m) return null;
    if (m[1] !== undefined) return m[1];
    const cm = src.match(new RegExp(`const\\s+${m[2]}\\s*=\\s*"([^"]+)"`));
    return cm ? cm[1] : null;
  };

  it("the shared constant and its two derivations are intact", () => {
    const base = posts.match(/export const PARTNER_POSTS_BASE\s*=\s*"([^"]+)"/);
    expect(base).not.toBeNull();
    expect(base![1]).toBe("/collective/partner");
    expect(posts).toContain("export const PARTNER_POSTS_LIST_PATH = `${PARTNER_POSTS_BASE}/posts`");
    expect(posts).toContain("export const PARTNER_POST_DETAIL_ROUTE = `${PARTNER_POSTS_BASE}/posts/:id`");
  });

  it("both partner callers resolve to '/collective/partner', not the collection path", () => {
    for (const [name, src] of [["PartnerDashboard", dash], ["PartnerPosts", posts]] as const) {
      const resolved = resolveBasePath(src);
      expect(resolved, `${name} must pass a resolvable basePath to <PostsFeed>`).toBe(
        "/collective/partner",
      );
      expect(src).not.toContain('basePath="/collective/partner/posts"');
    }
  });
});
