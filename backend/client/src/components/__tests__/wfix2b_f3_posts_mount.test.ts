/**
 * W-FIX2b F3 — Network Posts showed empty on first mount until a post/refresh.
 *
 * Root cause: the feed's posts query inherited the global 30s staleTime, so a
 * stale empty/errored cache entry for the shared key could be served WITHOUT a
 * refetch on mount; and a failed first fetch fell through to the generic
 * "No posts yet" empty state (a silent-drop — indistinguishable from genuinely
 * empty).
 *
 * Fix contract (locked here, mirroring the repo's static-source test style for
 * this component — see PostsFeed.partnerBasePath.test.ts):
 *   1. the posts query forces a fresh fetch on mount (refetchOnMount:"always",
 *      staleTime:0) so a stale empty cache is never served;
 *   2. the empty state renders ONLY on a successful+empty result (isSuccess),
 *      never merely because loading finished;
 *   3. a fetch error surfaces its own branch (never silent).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(__dirname, "../comms/PostsFeed.tsx"),
  "utf8",
);

describe("W-FIX2b F3 — posts load on mount", () => {
  it("forces a fresh fetch on mount (no stale empty cache served)", () => {
    expect(src).toContain('refetchOnMount: "always"');
    expect(src).toContain("staleTime: 0");
  });

  it("gates the empty state on a SUCCESSFUL empty result (not just !isLoading)", () => {
    expect(src).toContain("posts.isSuccess && asArray(posts.data).length === 0");
    // the old silent condition must be gone
    expect(src).not.toContain("!posts.isLoading && asArray(posts.data).length === 0");
  });

  it("surfaces a fetch error distinctly (never silent-drops to empty)", () => {
    expect(src).toContain("posts.isError");
    expect(src).toContain('data-testid="posts-load-error"');
    expect(src).toContain('data-testid="button-posts-retry"');
  });
});
