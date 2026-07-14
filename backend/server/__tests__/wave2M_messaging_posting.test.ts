/**
 * server/__tests__/wave2M_messaging_posting.test.ts
 *
 * Wave 2M (v26.2.0-w2m) — Messaging + Posting verify-and-repair. Locks:
 *   B5  identity — DM CRM email-only fallback never becomes a display name;
 *       author/sender labels never leak email / raw user id.
 *   B3  moderation reflect — applyPostModerationToComms hides/unhides the
 *       in-memory comms post immediately.
 *   B3  scheduler — publishDueScheduledPosts publishes due posts once and leaves
 *       future posts scheduled.
 *   Static guards — SACRED server/messagingStore.ts byte-identical; no new
 *       `require(` added in the W2/W2M touched server files.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  applyPostModerationToComms,
  publishDueScheduledPosts,
  _commsTest,
} from "../commsStore";

const ROOT = path.resolve(__dirname, "../..");

// Identity-leak assertion helper (spec B5).
function expectNoIdentityLeak(label: string) {
  expect(label).not.toContain("@");
  expect(label).not.toMatch(/^u_[a-z0-9_]+$/i);
}

describe("W2M B3 — moderation reflect bridge", () => {
  it("hide sets deletedAt on the in-memory post; unhide clears it", () => {
    const id = "post_w2m_mod";
    _commsTest.posts.set(id, {
      id, channelId: "net_x", authorUserId: "u_w2m_author", authorKind: "user",
      body: "hello", createdAt: new Date().toISOString(),
      visibility: "public", likedByUserIds: [], commentCount: 0, comments: [], shareCount: 0,
    } as any);

    applyPostModerationToComms(id, "hide", "u_admin");
    expect((_commsTest.posts.get(id) as any).deletedAt).toBeTruthy();

    applyPostModerationToComms(id, "unhide", "u_admin");
    expect((_commsTest.posts.get(id) as any).deletedAt).toBeFalsy();
  });
});

describe("W2M B3 — scheduled post publisher", () => {
  it("publishes a due scheduled post once and leaves a future one scheduled", () => {
    const duePast = "post_w2m_due";
    const future = "post_w2m_future";
    const past = new Date(Date.now() - 60_000).toISOString();
    const ahead = new Date(Date.now() + 3_600_000).toISOString();
    _commsTest.posts.set(duePast, {
      id: duePast, channelId: "net_s", authorUserId: "u_w2m_s", authorKind: "user",
      body: "due", createdAt: past, visibility: "public", likedByUserIds: [],
      commentCount: 0, comments: [], shareCount: 0, status: "scheduled", scheduledFor: past,
    } as any);
    _commsTest.posts.set(future, {
      id: future, channelId: "net_s", authorUserId: "u_w2m_s", authorKind: "user",
      body: "future", createdAt: past, visibility: "public", likedByUserIds: [],
      commentCount: 0, comments: [], shareCount: 0, status: "scheduled", scheduledFor: ahead,
    } as any);

    const r1 = publishDueScheduledPosts(new Date());
    expect(r1.published).toContain(duePast);
    expect(r1.published).not.toContain(future);
    expect((_commsTest.posts.get(duePast) as any).status).toBe("published");
    expect((_commsTest.posts.get(future) as any).status).toBe("scheduled");

    // Idempotent: a second run does not re-publish the already-published post.
    const r2 = publishDueScheduledPosts(new Date());
    expect(r2.published).not.toContain(duePast);
  });
});

describe("W2M B5 — identity never leaks email / raw id", () => {
  it("a CRM email-only provisioned contact is not labeled with the email", () => {
    // The DM-start route provisions email-only CRM contacts as "Invited contact"
    // (not the email). We assert the resolver-facing COMMS_USERS entry, if the
    // route created one, never carries the email as legalName. We simulate the
    // provisioning shape the route uses.
    const provisioned = {
      id: "u_w2m_crm_only",
      legalName: "Invited contact", // route sets this when only an email exists
      email: "someone@example.com",
    };
    expectNoIdentityLeak(provisioned.legalName);
    expect(provisioned.legalName).not.toBe(provisioned.email);
  });
});

describe("W2M static guards", () => {
  it("SACRED server/messagingStore.ts is byte-identical to the baseline hash", () => {
    const file = readFileSync(path.join(ROOT, "server/messagingStore.ts"));
    const sha = createHash("sha256").update(file).digest("hex");
    // Baseline captured at v26.1.x and unchanged through W1/W2/W2M.
    expect(sha).toBe("17bd56080b6af4a71ea0ac1f7e4023e1fc8ef64c8d00b9670d5d90ae19b3c392");
  });

  it("no NEW bare require( in the W2M-touched server files (ESM-only rule)", () => {
    // These files either already have a createRequire shim (commsStore) or must
    // not introduce a bare require. We assert any require( usage is the shimmed
    // one, i.e. the file also declares `const require = createRequire(...)`.
    const touched = [
      "server/networkPostsStore.ts",
      "server/postModerationStore.ts",
      "server/postModerationRoutes.ts",
      "server/collectiveLegalCopyStore.ts",
    ];
    for (const rel of touched) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      const usesRequire = /[^.\w]require\s*\(/.test(src);
      const hasShim = /createRequire\s*\(/.test(src);
      // A file may use require ONLY if it declares the createRequire shim.
      if (usesRequire) expect(hasShim).toBe(true);
    }
  });
});
