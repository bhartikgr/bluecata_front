/**
 * v23.5 — Admin Collective Pages regression guards (C-002, C-003, C-009).
 *
 * Static source analysis guards confirming:
 * 1. CollectiveApplications.tsx: bridge marker, both mutations, testids
 * 2. CollectiveMembers.tsx: members endpoint, deactivate testid
 * 3. CollectiveSettings.tsx: placeholder marker
 * 4. AppShell.tsx: Collective nav section + 3 sidebar links
 * 5. App.tsx: 3 routes registered + v25Marker import
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APPS_DIR = resolve(__dirname, "..");
const COMP_DIR = resolve(__dirname, "../../../components");
const ROOT_SRC = resolve(__dirname, "../../../App.tsx");

const APPS_SRC = readFileSync(resolve(APPS_DIR, "CollectiveApplications.tsx"), "utf8");
const MEMBERS_SRC = readFileSync(resolve(APPS_DIR, "CollectiveMembers.tsx"), "utf8");
const SETTINGS_SRC = readFileSync(resolve(APPS_DIR, "CollectiveSettings.tsx"), "utf8");
const SHELL_SRC = readFileSync(resolve(COMP_DIR, "AppShell.tsx"), "utf8");
const APP_SRC = readFileSync(ROOT_SRC, "utf8");

describe("v23.5 C-003: CollectiveApplications page", () => {
  it("has C-009 bridge comment in query key", () => {
    expect(APPS_SRC).toContain("C-009");
  });

  it("fetches from /api/admin/collective/applications", () => {
    expect(APPS_SRC).toContain("/api/admin/collective/applications");
  });

  it("has approve mutation calling /approve endpoint", () => {
    expect(APPS_SRC).toContain("/approve");
  });

  it("has reject mutation calling /reject endpoint", () => {
    expect(APPS_SRC).toContain("/reject");
  });

  it("has data-testid for approve button", () => {
    expect(APPS_SRC).toContain('data-testid="button-approve"');
  });

  it("has data-testid for reject button", () => {
    expect(APPS_SRC).toContain('data-testid="button-reject"');
  });

  it("has filter chips for status", () => {
    expect(APPS_SRC).toContain('data-testid="filter-chips"');
  });

  it("has admin notes textarea for rejection reason", () => {
    expect(APPS_SRC).toContain('data-testid="textarea-reject-notes"');
  });
});

describe("v23.5 C-003: CollectiveMembers page", () => {
  it("fetches from /api/admin/collective/members", () => {
    expect(MEMBERS_SRC).toContain("/api/admin/collective/members");
  });

  it("has deactivate button testid", () => {
    expect(MEMBERS_SRC).toContain("button-deactivate-");
  });

  it("has members-table testid", () => {
    expect(MEMBERS_SRC).toContain('data-testid="members-table"');
  });
});

describe("v23.5 C-003: CollectiveSettings placeholder", () => {
  it("has Coming soon text", () => {
    expect(SETTINGS_SRC).toContain("Coming soon");
  });

  it("has placeholder testid", () => {
    expect(SETTINGS_SRC).toContain('data-testid="collective-settings-placeholder"');
  });
});

describe("v23.5 C-002: Admin sidebar Collective section", () => {
  it("has Collective title in adminNav", () => {
    expect(SHELL_SRC).toContain('"Collective"');
  });

  it("has Collective Applications link", () => {
    expect(SHELL_SRC).toContain("/admin/collective/applications");
    expect(SHELL_SRC).toContain('"Collective Applications"');
  });

  it("has Collective Members link", () => {
    expect(SHELL_SRC).toContain("/admin/collective/members");
    expect(SHELL_SRC).toContain('"Collective Members"');
  });

  it("has Collective Settings link", () => {
    expect(SHELL_SRC).toContain("/admin/collective/settings");
    expect(SHELL_SRC).toContain('"Collective Settings"');
  });
});

describe("v23.5: App.tsx routes + v25Marker", () => {
  it("registers /admin/collective/applications route", () => {
    expect(APP_SRC).toContain('"/admin/collective/applications"');
  });

  it("registers /admin/collective/members route", () => {
    expect(APP_SRC).toContain('"/admin/collective/members"');
  });

  it("registers /admin/collective/settings route", () => {
    expect(APP_SRC).toContain('"/admin/collective/settings"');
  });

  it("imports v25Marker and uses AdminCollectiveApplications", () => {
    expect(APP_SRC).toContain("v25Marker");
    expect(APP_SRC).toContain("V25_COLLECTIVE_SHIPPED");
    expect(APP_SRC).toContain("AdminCollectiveApplications");
  });

  it("has C-003 comment marking the new routes", () => {
    expect(APP_SRC).toContain("C-003");
  });
});
