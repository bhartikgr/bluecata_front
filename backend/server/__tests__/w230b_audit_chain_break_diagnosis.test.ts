/**
 * WAVE 230B — DIAGNOSIS OF THE ONE BROKEN `audit_log` ROW REPORTED BY WAVE 230.
 *
 * Wave 230 reported, via `verifyAllChains()` from `server/lib/auditChainVerifier.ts`,
 * exactly ONE broken row in `audit_log` in the seeded `:memory:` bootstrap, and did
 * not chase it. The owner's question is binary and must be answered explicitly:
 *
 *     IS THIS A DATA ARTEFACT, OR A DEFECT IN THE CHAIN WRITER?
 *
 * This file answers it by measurement, not by reading code. It is a DIAGNOSTIC:
 * every assertion here is an assertion about the shape of the evidence, so if the
 * evidence ever changes shape the diagnosis in
 * `build_log/wave230b/AUDIT_CHAIN_BREAK_DIAGNOSIS.md` goes RED rather than stale.
 *
 * It writes NOTHING. It never mutates a row. It never marks anything.
 */
import { describe, it, expect, beforeAll } from "vitest";

import { rawDb } from "../db/connection";
import { verifyChainForTable } from "../lib/auditChainVerifier";
import {
  auditHashBody,
  verifyTenantAuditChain,
  AUDIT_HASH_VERSION_LEGACY,
  appendAdminAudit,
} from "../adminPlatformStore";
import { createHash } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const GENESIS64 = "0".repeat(64);

interface Row {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  action: string;
  target: string | null;
  payload_json: string | null;
  prev_hash: string | null;
  hash: string;
  hash_version: number | null;
  created_at: string;
}

let rows: Row[] = [];

/** The exact order the global walker uses: (created_at ASC, id ASC). */
function globalOrder(a: Row, b: Row): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

beforeAll(() => {
  /* Force the module-evaluation seed of adminPlatformStore to have happened and
     at least one canonical append to exist, so the population is never empty. */
  appendAdminAudit("u_w230b_diag", "diag:w230b", "w230b.diagnostic.read_only_probe", {
    note: "diagnostic append; proves the population is non-empty and the writer is exercised",
  });
  const db: any = rawDb();
  rows = db
    .prepare(
      `SELECT id, tenant_id, actor_id, action, target, payload_json, prev_hash, hash,
              hash_version, created_at
         FROM audit_log`,
    )
    .all() as Row[];
  rows.sort(globalOrder);
});

describe("W230B · 1 — the population is real", () => {
  it("there are audit_log rows to walk, across more than one tenant", () => {
    expect(rows.length, "audit_log is empty — this diagnostic would prove nothing").toBeGreaterThan(
      1,
    );
    const tenants = new Set(rows.map((r) => r.tenant_id));
    /* THE LOAD-BEARING FACT of the whole diagnosis. If this is 1, the global
       walker and the per-tenant writer agree by accident and the break must have
       another cause. It is asserted, not assumed. */
    expect(tenants.size, "only one tenant present — see §2, the diagnosis changes").toBeGreaterThan(
      1,
    );
  });
});

describe("W230B · 2 — the global walker's break, located exactly", () => {
  it("reports exactly one break, and it is at the first tenant boundary", () => {
    const res = verifyChainForTable("audit_log", { withDetails: true });
    expect(res.total_rows, "the walker inspected zero rows").toBeGreaterThan(1);
    expect(res.broken_at_row_id, "the walker no longer reports a break").not.toBeNull();

    const idx = res.broken_at_index!;
    const broken = rows[idx];
    const prior = rows[idx - 1];
    expect(broken.id, "walker's broken id does not match the reproduced ordering").toBe(
      res.broken_at_row_id,
    );

    /* THE ARITHMETIC OF THE MISMATCH. The walker expected the PREVIOUS GLOBAL
       ROW's hash. The row actually stores its own tenant's genesis token,
       because the writer chains per tenant. */
    expect(res.first_bad_field_hint).toBe(
      `prev_hash_mismatch:expected=${prior.hash} got=${broken.prev_hash}`,
    );
    expect(broken.prev_hash, "the break row does not store a genesis token").toBe(GENESIS64);
    expect(
      broken.tenant_id === prior.tenant_id,
      "the break is NOT at a tenant boundary — the diagnosis must be revisited",
    ).toBe(false);
  });
});

describe("W230B · 3 — the row's OWN hash is correct, so the writer is not at fault", () => {
  it("the break row's stored hash is exactly what the writer's formula produces", () => {
    const res = verifyChainForTable("audit_log", {});
    const broken = rows.find((r) => r.id === res.broken_at_row_id)!;
    expect(broken, "could not locate the break row").toBeTruthy();

    const expected = sha256(
      auditHashBody({
        version: Number(broken.hash_version ?? AUDIT_HASH_VERSION_LEGACY),
        prevHash: broken.prev_hash ?? GENESIS64,
        id: broken.id,
        eventType: broken.action,
        entity: broken.target ?? "",
        ts: broken.created_at,
        payloadStr: broken.payload_json ?? "{}",
        actorId: broken.actor_id,
      }),
    );
    /* Recomputed BY HAND from the stored fields. If this passes, the stored hash,
       the field list and the row's own data are all sound; only the walker's
       choice of predecessor is wrong. */
    expect(expected, "the break row's own fingerprint does not reconcile").toBe(broken.hash);
  });

  it("the break row is the FIRST row of its own tenant, so its genesis token is correct", () => {
    const res = verifyChainForTable("audit_log", {});
    const broken = rows.find((r) => r.id === res.broken_at_row_id)!;
    const own = rows.filter((r) => r.tenant_id === broken.tenant_id);
    expect(own[0].id, "the break row is not its tenant's genesis row").toBe(broken.id);
  });
});

describe("W230B · 4 — every tenant verifies CLEAN under the canonical per-tenant verifier", () => {
  it("verifyTenantAuditChain reports ok for every tenant that has rows", () => {
    const db: any = rawDb();
    const tenants = [...new Set(rows.map((r) => r.tenant_id))];
    const bad = tenants
      .map((t) => verifyTenantAuditChain(db, t))
      .filter((r) => !r.ok)
      .map((r) => `${r.tenantId}@link${r.brokenAt}/${r.totalLinks}`);
    expect(bad, `tenant chains that do NOT verify: ${bad.join(", ")}`).toEqual([]);
  });

  it("and the SAME global walker, once SCOPED per tenant, also reports no break", () => {
    const tenants = [...new Set(rows.map((r) => r.tenant_id))];
    const bad = tenants
      .map((t) => verifyChainForTable("audit_log", { tenantId: t }))
      .filter((r) => r.broken_at_row_id !== null)
      .map((r) => `${r.table}@${r.broken_at_row_id}`);
    /* This is the decisive comparison: identical code, identical bytes, identical
       rows — the ONLY difference is the tenant scope. Unscoped it reds; scoped it
       is clean. The defect is therefore in the SCOPE OF THE QUESTION, not in the
       data and not in the writer. */
    expect(bad, `scoped walks that still break: ${bad.join(", ")}`).toEqual([]);
  });
});

describe("W230B · 5 — the break count is an artefact of stop-at-first-mismatch", () => {
  it("the number of tenant boundaries in the global order exceeds one", () => {
    let boundaries = 0;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].tenant_id !== rows[i - 1].tenant_id) boundaries += 1;
    }
    /* "ONE broken row" was never a count of defective rows. The walker breaks and
       RETURNS at the first mismatch, so it can only ever report one. Every one of
       these boundaries would red under a global walk. */
    expect(boundaries, "no tenant boundaries in the global ordering").toBeGreaterThan(0);
  });
});
