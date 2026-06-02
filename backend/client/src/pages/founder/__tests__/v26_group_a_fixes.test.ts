/**
 * v23.6 Group A regression guards:
 *
 * A.1 — B-505: Messages page reads ?contactId= and auto-opens DM thread
 * A.2 — C-006-client-refresh: invalidate /mine after Path B submit
 * A.3 — C-013: Admin Collective Applications row click opens Detail Dialog
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MESSAGES_SRC = readFileSync(
  resolve(__dirname, "../Messages.tsx"),
  "utf8",
);

const APPLY_SRC = readFileSync(
  resolve(__dirname, "../ApplyToCollective.tsx"),
  "utf8",
);

const ADMIN_APPS_SRC = readFileSync(
  resolve(__dirname, "../../admin/CollectiveApplications.tsx"),
  "utf8",
);

// ---- A.1 B-505 ----
describe("A.1 B-505: Messages page auto-opens DM from ?contactId=", () => {
  it("has B-505 marker comment", () => {
    expect(MESSAGES_SRC).toContain("B-505 fix v23.6");
  });

  it("reads contactId from URL search params", () => {
    expect(MESSAGES_SRC).toContain("contactId");
    expect(MESSAGES_SRC).toContain("URLSearchParams");
  });

  it("triggers startDm mutation when contactId present", () => {
    expect(MESSAGES_SRC).toContain("startDm.mutate(contactIdParam)");
  });

  it("uses useEffect for auto-trigger", () => {
    expect(MESSAGES_SRC).toContain("useEffect");
  });
});

// ---- A.2 C-006-client-refresh ----
describe("A.2 C-006-client-refresh: /mine invalidated after Path B submit", () => {
  it("has C-006-refresh marker comment", () => {
    expect(APPLY_SRC).toContain("C-006-refresh fix v23.6");
  });

  it("invalidates /mine query on success", () => {
    expect(APPLY_SRC).toContain("/api/founder/collective/applications/mine");
    expect(APPLY_SRC).toContain("invalidateQueries");
  });

  it("fetches /mine query for banner", () => {
    // Already present from v23.5
    expect(APPLY_SRC).toContain("banner-application-status");
  });

  // v23.6.1 completion: the v23.6 bundle QA still required a reload because the
  // banner query, having resolved to a 404->null on first load, was an idle
  // observer. refetchType: "all" forces the post-submit refetch so the banner
  // appears immediately.
  it("forces refetch of the idle /mine observer (refetchType: all)", () => {
    expect(APPLY_SRC).toContain("refetchType: \"all\"");
  });
});

// ---- A.3 C-013 ----
describe("A.3 C-013: Admin Collective Applications row click opens detail Dialog", () => {
  it("has C-013 marker comment", () => {
    expect(ADMIN_APPS_SRC).toContain("C-013 fix v23.6");
  });

  it("imports Dialog primitive", () => {
    expect(ADMIN_APPS_SRC).toContain("Dialog");
    expect(ADMIN_APPS_SRC).toContain("DialogContent");
    expect(ADMIN_APPS_SRC).toContain("DialogHeader");
  });

  it("row onClick sets selected state", () => {
    expect(ADMIN_APPS_SRC).toContain("setSelected(app)");
  });

  it("Dialog open prop driven by selected state", () => {
    expect(ADMIN_APPS_SRC).toContain("open={!!selected}");
  });

  it("has data-testid for detail panel", () => {
    expect(ADMIN_APPS_SRC).toContain('data-testid="detail-panel"');
  });

  it("has approve button in dialog", () => {
    expect(ADMIN_APPS_SRC).toContain('data-testid="button-approve"');
    expect(ADMIN_APPS_SRC).toContain("approveMutation.mutate(selected.id)");
  });

  it("has reject button in dialog", () => {
    expect(ADMIN_APPS_SRC).toContain('data-testid="button-reject"');
    expect(ADMIN_APPS_SRC).toContain("rejectMutation.mutate");
  });

  it("has admin notes textarea", () => {
    expect(ADMIN_APPS_SRC).toContain('data-testid="textarea-reject-notes"');
  });
});
