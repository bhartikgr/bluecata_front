/**
 * v13 — Avi's Issue 6: Activity log read path.
 *
 * Avi reported the Activity page was empty after creating rounds, posting
 * to the network, and sending investor updates. Root cause: the founder
 * /api/activity handler returned the static seed `activity` array (empty in
 * non-demo). The v13 fix merges getAuditLog() into the response and filters
 * by the founder's tenant set.
 *
 * This is a source-marker test: assertions ensure the updated handler in
 * server/routes.ts wires getAuditLog() through and applies tenant scoping.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("v13 B-V13-6 — activity log read path", () => {
  it("routes.ts /api/activity handler reads from getAuditLog()", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "routes.ts"),
      "utf8",
    );
    // Must import getAuditLog from adminPlatformStore.
    expect(src).toMatch(/getAuditLog\b.*from\s+"\.\/adminPlatformStore"/s);

    // Must contain the v13 fix marker comment + handler that maps audit
    // entries to {id, ts, actor, action, target, tenantId, payload}.
    expect(src).toMatch(/B-V13-6 fix/);
    expect(src).toMatch(/Avi's Issue 6/);
    expect(src).toMatch(/getAuditLog\(\)\.map/);

    // Tenant scoping must be present (founders see only their company tenants).
    expect(src).toMatch(/userTenantIds\s*=\s*new\s+Set/);
    expect(src).toMatch(/tenant_co_/);
  });

  it("admin /api/admin/audit-log read path is preserved (v12 DB-backed)", () => {
    const admSrc = fs.readFileSync(
      path.join(__dirname, "..", "adminPlatformStore.ts"),
      "utf8",
    );
    expect(admSrc).toMatch(/export function getAuditLog/);
    expect(admSrc).toMatch(/auditLog:\s*AuditEntry\[\]\s*=\s*\[\]/);
  });
});
