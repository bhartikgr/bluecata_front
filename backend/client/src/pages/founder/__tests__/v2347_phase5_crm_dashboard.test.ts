/**
 * v23.4.7 Phase 5 — BUGs 025 / 026 / B-102 source-level guarantees.
 *
 * Vitest config in this tree only globs `.test.ts` (no jsdom), so we do source
 * grep style assertions like the v23.4.5/v23.4.6 client phase tests
 * (see client/src/components/__tests__/LegalConsentCheckbox.test.ts).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DASHBOARD = readFileSync(
  resolve(__dirname, "..", "Dashboard.tsx"),
  "utf8",
);
const CRM = readFileSync(resolve(__dirname, "..", "CRM.tsx"), "utf8");

describe("v23.4.7 Phase 5 — Dashboard activity feed actor formatting (B-102)", () => {
  it("declares the formatActorDashboard helper", () => {
    expect(DASHBOARD).toMatch(/function formatActorDashboard\(/);
  });

  it("uses the helper to render activity actor in BOTH the bento and the activity log preview", () => {
    const matches = DASHBOARD.match(/formatActorDashboard\(a\.actor/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("no longer renders the raw {a.actor} expression in JSX", () => {
    // The naked actor (without formatActorDashboard wrapping) should not appear
    // in JSX-style braces. We allow only the wrapped form.
    const naked = DASHBOARD.match(/>\s*\{a\.actor\}\s*</g) ?? [];
    expect(naked.length).toBe(0);
  });

  it("queries /api/auth/me so it can resolve selfId/selfName", () => {
    expect(DASHBOARD).toMatch(/queryKey:\s*\[\s*"\/api\/auth\/me"/);
    expect(DASHBOARD).toMatch(/const selfId\s*=/);
    expect(DASHBOARD).toMatch(/const selfName\s*=/);
  });

  it("covers both the canonical usr_ prefix and legacy u_ prefix", () => {
    expect(DASHBOARD).toMatch(/actor\.startsWith\("usr_"\)/);
    expect(DASHBOARD).toMatch(/actor\.startsWith\("u_"\)/);
  });
});

describe("v23.4.7 Phase 5 — CRM delete UX (BUG 025)", () => {
  it("imports the AlertDialog primitives", () => {
    expect(CRM).toMatch(/from "@\/components\/ui\/alert-dialog"/);
    expect(CRM).toMatch(/AlertDialogAction/);
    expect(CRM).toMatch(/AlertDialogCancel/);
  });

  it("removes the window.confirm path entirely", () => {
    expect(CRM).not.toMatch(/window\.confirm\(/);
  });

  it("stages the contact through pendingDelete state instead of confirming inline", () => {
    expect(CRM).toMatch(/setPendingDelete\(c\)/);
    expect(CRM).toMatch(/pendingDelete/);
  });

  it("renders an AlertDialog with confirm + cancel testids", () => {
    expect(CRM).toMatch(/data-testid="alert-delete-contact"/);
    expect(CRM).toMatch(/data-testid="button-delete-confirm"/);
    expect(CRM).toMatch(/data-testid="button-delete-cancel"/);
  });
});

describe("v23.4.7 Phase 5 — CRM friendly 403/404 toasts (BUGs 025/026)", () => {
  it("delete mutation branches on status 403 with a permission message", () => {
    // crude but effective: ensure the delete onError surfaces a permission copy.
    expect(CRM).toMatch(/don.t have permission to delete this contact/);
  });

  it("update mutation branches on status 403 with a permission message", () => {
    expect(CRM).toMatch(/don.t have permission to edit this contact/);
  });

  it("both mutations also handle 404 explicitly", () => {
    const fourOhFours = CRM.match(/status === 404/g) ?? [];
    expect(fourOhFours.length).toBeGreaterThanOrEqual(2);
  });
});
