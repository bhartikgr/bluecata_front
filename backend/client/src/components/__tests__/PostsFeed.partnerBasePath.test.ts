// v25.49 Phase-3B regression (GPT-5.5 rc1 blocker) — partner PostsFeed deeplinks.
//
// Bug: partner callers passed basePath="/collective/partner/posts" while PostsFeed
// appends "/posts/${id}", yielding "/collective/partner/posts/posts/:id" which does
// NOT match the registered "/collective/partner/posts/:id" route (broken deeplink).
// Fix: partner callers pass basePath="/collective/partner"; PostsFeed appends
// "/posts/${id}". This test locks the URL-composition contract so it can't regress.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../../..");

/** Mirror of PostsFeed's internal URL composition: postsBase + `/posts/${id}`. */
function postDetailUrl(basePath: string | undefined, role: string, id: string): string {
  const postsBase = basePath ?? `/${role || "investor"}`;
  return `${postsBase}/posts/${id}`;
}

describe("PostsFeed partner basePath contract", () => {
  it("partner basePath yields a single /posts/:id segment (no doubling)", () => {
    const url = postDetailUrl("/collective/partner", "investor", "p_123");
    expect(url).toBe("/collective/partner/posts/p_123");
    expect(url).not.toContain("/posts/posts/");
  });

  it("investor default (no basePath) still resolves under the role prefix", () => {
    expect(postDetailUrl(undefined, "investor", "p_9")).toBe("/investor/posts/p_9");
  });

  it("partner callers pass basePath='/collective/partner' (NOT '.../posts')", () => {
    const dash = readFileSync(resolve(root, "client/src/pages/partner/PartnerDashboard.tsx"), "utf8");
    const posts = readFileSync(resolve(root, "client/src/pages/partner/PartnerPosts.tsx"), "utf8");
    // Must use the shell-prefix basePath, never the collection-path form that doubled the segment.
    expect(dash).toContain('basePath="/collective/partner"');
    expect(posts).toContain('basePath="/collective/partner"');
    expect(dash).not.toContain('basePath="/collective/partner/posts"');
    expect(posts).not.toContain('basePath="/collective/partner/posts"');
  });

  it("the registered route matches the composed detail URL shape", () => {
    const app = readFileSync(resolve(root, "client/src/App.tsx"), "utf8");
    expect(app).toContain("/collective/partner/posts/:id");
  });
});
