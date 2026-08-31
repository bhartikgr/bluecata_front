/**
 * WAVE 223 — the audit-chain verification must be LOAD-BEARING.
 *
 * The point of this file is not that the chain verifies. It is that a
 * verification which cannot fail proves nothing (ENGINEERING_NOTES §7.5), so
 * every claim wave 223 makes is tested from both poles:
 *
 *   1. Rows written by the REAL exported writer verify under the REAL exported
 *      verifier. No fixture hand-writes a hash — a fixture no server mutation
 *      can move is one of the inert-proof mechanisms (§8).
 *   2. Tampering with a chained row's CONTENT (payload, actor, action, target,
 *      timestamp) makes the real verifier FAIL, at the exact index of the
 *      tampered row.
 *   3. Tampering with a chained row's LINKAGE (its hash) makes it FAIL.
 *   4. The real production route GET /api/admin/audit-log/verify — mounted by
 *      registerAdminPlatformRoutes from server/routes.ts — reports the failure
 *      over HTTP. Not a hand-called handler; the route as the platform serves
 *      it (§8: real routes over HTTP).
 *   5. The wave 223 script is read-only and does not reimplement the hash: its
 *      source is asserted to import the real verifier and to contain no write
 *      statement against audit_log and no clearing of the standing incident.
 *   6. The generic catalog verifier that the admin audit-chain page actually
 *      calls is INERT against a content tamper on audit_log. This is pinned
 *      here so the defect is visible in a runnable place rather than only in a
 *      report. If a later wave fixes the catalog verifier, this test turns red
 *      and should be updated to assert detection — a red here after a fix is
 *      the good outcome, not a regression.
 *
 * Wave 223 owns no write path. Nothing in this file touches a real database
 * file; every mutation happens on the in-memory handle vitest provisions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { rawDb } from "../db/connection";
import { appendAdminAudit, verifyTenantAuditChain } from "../adminPlatformStore";

const TENANT = "tenant_w223_probe";

type Row = { id: string; hash: string; prev_hash: string; payload_json: string };

function chainRows(tenantId: string): Row[] {
  return rawDb()
    .prepare(
      `SELECT id, hash, prev_hash, payload_json
         FROM audit_log
        WHERE tenant_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .all(tenantId) as Row[];
}

/**
 * Mutate exactly one column of exactly one row and HARD-ABORT otherwise. A
 * mutation that silently applied zero or two times would make every downstream
 * assertion meaningless.
 */
function tamperExactlyOnce(rowId: string, column: string, value: string): void {
  const allowed = ["payload_json", "actor_id", "action", "target", "created_at", "hash", "prev_hash"];
  if (!allowed.includes(column)) throw new Error(`w223: refusing to tamper column ${column}`);
  const info = rawDb()
    .prepare(`UPDATE audit_log SET ${column} = ? WHERE id = ?`)
    .run(value, rowId); /* w223 tamper write site */
  if (info.changes !== 1) {
    throw new Error(
      `w223 HARD ABORT: tamper on ${column} of ${rowId} applied ${info.changes} time(s), expected exactly 1`,
    );
  }
  const back = rawDb()
    .prepare(`SELECT ${column} AS v FROM audit_log WHERE id = ?`)
    .get(rowId) as { v: string } | undefined;
  if (!back || String(back.v) !== value) {
    throw new Error(`w223 HARD ABORT: tamper on ${column} of ${rowId} did not persist`);
  }
}

function restore(rowId: string, column: string, value: string): void {
  const info = rawDb()
    .prepare(`UPDATE audit_log SET ${column} = ? WHERE id = ?`)
    .run(value, rowId);
  if (info.changes !== 1) {
    throw new Error(`w223 HARD ABORT: restore of ${column} on ${rowId} changed ${info.changes} rows`);
  }
}

/* Seed a real chain through the real writer, once, before anything reads it. */
let seeded: Row[] = [];
beforeAll(() => {
  for (let i = 0; i < 6; i++) {
    appendAdminAudit(
      `u_w223_actor_${i}`,
      `w223_entity_${i}`,
      `w223.probe.event_${i}`,
      { step: i, note: `wave 223 chain probe ${i}` },
      TENANT,
    );
  }
  seeded = chainRows(TENANT);
});

describe("W223 · the chain the real writer produces verifies under the real verifier", () => {
  it("wrote six linked rows whose prev_hash follows the previous row's hash", () => {
    expect(seeded.length).toBe(6);
    expect(seeded[0].prev_hash).toBe("0".repeat(64));
    for (let i = 1; i < seeded.length; i++) {
      expect(seeded[i].prev_hash).toBe(seeded[i - 1].hash);
    }
  });

  it("verifies clean, with totalLinks equal to the rows actually written", () => {
    const r = verifyTenantAuditChain(rawDb(), TENANT);
    expect(r.tenantId).toBe(TENANT);
    expect(r.ok).toBe(true);
    expect(r.brokenAt).toBe(-1);
    expect(r.totalLinks).toBe(seeded.length);
  });
});

describe("W223 · tampering is DETECTED, at the right row", () => {
  it("a payload_json edit fails verification at the tampered index", () => {
    const idx = 3;
    const target = seeded[idx];
    const original = target.payload_json;
    tamperExactlyOnce(target.id, "payload_json", `${original.slice(0, -1)},"tampered":true}`);
    try {
      const r = verifyTenantAuditChain(rawDb(), TENANT);
      expect(r.ok).toBe(false);
      expect(r.brokenAt).toBe(idx);
      expect(r.totalLinks).toBe(seeded.length);
    } finally {
      restore(target.id, "payload_json", original);
    }
    /* the restore must put the chain back exactly */
    expect(verifyTenantAuditChain(rawDb(), TENANT).ok).toBe(true);
  });

  it("an actor_id edit fails verification — the chain is actor-bound at hash version 2", () => {
    const idx = 2;
    const target = seeded[idx];
    const original = (
      rawDb().prepare(`SELECT actor_id AS v FROM audit_log WHERE id = ?`).get(target.id) as {
        v: string;
      }
    ).v;
    tamperExactlyOnce(target.id, "actor_id", `${original}_TAMPERED`);
    try {
      const r = verifyTenantAuditChain(rawDb(), TENANT);
      expect(r.ok).toBe(false);
      expect(r.brokenAt).toBe(idx);
    } finally {
      restore(target.id, "actor_id", original);
    }
    expect(verifyTenantAuditChain(rawDb(), TENANT).ok).toBe(true);
  });

  it("an action edit fails verification", () => {
    const idx = 1;
    const target = seeded[idx];
    const original = (
      rawDb().prepare(`SELECT action AS v FROM audit_log WHERE id = ?`).get(target.id) as {
        v: string;
      }
    ).v;
    tamperExactlyOnce(target.id, "action", `${original}.tampered`);
    try {
      expect(verifyTenantAuditChain(rawDb(), TENANT).brokenAt).toBe(idx);
    } finally {
      restore(target.id, "action", original);
    }
    expect(verifyTenantAuditChain(rawDb(), TENANT).ok).toBe(true);
  });

  it("a created_at edit fails verification — the timestamp is inside the hash", () => {
    const idx = 4;
    const target = seeded[idx];
    const original = (
      rawDb().prepare(`SELECT created_at AS v FROM audit_log WHERE id = ?`).get(target.id) as {
        v: string;
      }
    ).v;
    /* keep ordering identical so the failure is the hash, not a re-sort */
    tamperExactlyOnce(target.id, "created_at", original.replace(/\dZ$/, "9Z"));
    try {
      const r = verifyTenantAuditChain(rawDb(), TENANT);
      expect(r.ok).toBe(false);
    } finally {
      restore(target.id, "created_at", original);
    }
    expect(verifyTenantAuditChain(rawDb(), TENANT).ok).toBe(true);
  });

  it("a stored-hash edit fails at the edited row, caught by the recompute", () => {
    /* NOTE on which check catches this. The walker recomputes the body from the
       row's own fields using ITS OWN running `prior`, not the row's stored
       prev_hash, so editing `hash` alone leaves linkage satisfied at this index
       and is caught by the hash comparison. The linkage comparison is exercised
       separately in the next test — a disarm run proved that without that
       second test, disabling the linkage check left this suite GREEN. */
    const idx = 2;
    const target = seeded[idx];
    tamperExactlyOnce(target.id, "hash", `${target.hash.slice(0, 63)}${target.hash[63] === "a" ? "b" : "a"}`);
    try {
      const r = verifyTenantAuditChain(rawDb(), TENANT);
      expect(r.ok).toBe(false);
      expect(r.brokenAt).toBe(idx);
    } finally {
      restore(target.id, "hash", target.hash);
    }
    expect(verifyTenantAuditChain(rawDb(), TENANT).ok).toBe(true);
  });

  it("a prev_hash edit fails at the edited row — this isolates the LINKAGE check", () => {
    /* Editing only `prev_hash` cannot be caught by the recompute, because the
       recompute feeds itself the previous row's real hash. If this test passes,
       the linkage comparison in verifyTenantAuditChain is genuinely running.
       Re-ordering or splicing rows out of a chain is the attack this catches. */
    const idx = 4;
    const target = seeded[idx];
    const original = seeded[idx - 1].hash;
    expect(target.prev_hash).toBe(original);
    tamperExactlyOnce(target.id, "prev_hash", "0".repeat(64));
    try {
      const r = verifyTenantAuditChain(rawDb(), TENANT);
      expect(r.ok).toBe(false);
      expect(r.brokenAt).toBe(idx);
    } finally {
      restore(target.id, "prev_hash", original);
    }
    expect(verifyTenantAuditChain(rawDb(), TENANT).ok).toBe(true);
  });
});

describe("W223 · the REAL production route reports it over HTTP", () => {
  let app: Express;
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    const { registerRoutes } = await import("../routes");
    app = express();
    app.use(express.json());
    server = http.createServer(app);
    await registerRoutes(server, app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  function get(apiPath: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: apiPath,
          method: "GET",
          /* the real router-level requireAdmin gate at server/routes.ts applies;
             this is the same admin identity the existing banner-resolve suite
             uses, so the route is exercised as the platform serves it */
          headers: { "x-user-id": "u_admin" },
        },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            let body: unknown = null;
            try {
              body = JSON.parse(buf);
            } catch {
              body = buf;
            }
            resolve({ status: res.statusCode ?? 0, body });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("reports ok for the clean probe chain", async () => {
    const res = await get(`/api/admin/audit-log/verify?tenantId=${TENANT}`);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe(`tenant:${TENANT}`);
    expect(res.body.ok).toBe(true);
    expect(res.body.totalLinks).toBe(seeded.length);
  });

  it("reports NOT ok, with the divergent index, once a row is tampered", async () => {
    const idx = 5;
    const target = seeded[idx];
    const original = target.payload_json;
    tamperExactlyOnce(target.id, "payload_json", `${original.slice(0, -1)},"http_tamper":true}`);
    try {
      const res = await get(`/api/admin/audit-log/verify?tenantId=${TENANT}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.brokenAt).toBe(idx);
    } finally {
      restore(target.id, "payload_json", original);
    }
    const after = await get(`/api/admin/audit-log/verify?tenantId=${TENANT}`);
    expect(after.body.ok).toBe(true);
  });
});

describe("W223 · the script is read-only and reuses the one verifier", () => {
  const scriptPath = path.resolve(__dirname, "../../scripts/wave223_audit_chain_verification.mts");

  /** Strip block and line comments so a prohibition is not satisfied by prose. */
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
      .join("\n");
  }

  let code = "";
  beforeAll(() => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    code = stripComments(fs.readFileSync(scriptPath, "utf8"));
    /* prove the stripper stripped */
    expect(code).not.toContain("READ-ONLY.");
  });

  it("imports the real exported verifier from the real store", () => {
    expect(code).toContain("verifyTenantAuditChain");
    expect(code).toMatch(/adminPlatformStore\.js/);
  });

  it("computes no hash of its own", () => {
    expect(code).not.toMatch(/createHash|sha256|auditHashBody/);
  });

  it("contains no write statement", () => {
    /* uppercase with word boundaries: prose such as "altered" must not be
       mistaken for the ALTER keyword, in either direction */
    for (const kw of ["INSERT", "UPDATE", "DELETE", "ALTER", "DROP", "REPLACE", "PRAGMA", "VACUUM"]) {
      expect(code).not.toMatch(new RegExp(`\\b${kw}\\b`));
    }
  });

  it("does not clear, resolve or re-anchor anything", () => {
    for (const forbidden of [
      "resolveAuditChainHealth",
      "reAnchor",
      "re-anchor",
      "clearAuditChainIncident",
      "appendAudit",
      "appendAdminAudit",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("touches the incident and anchor tables only inside a SELECT", () => {
    /* `cleared_at` and `platform_audit_incident` legitimately appear: the run
       REPORTS the standing incident. What must never appear is a statement
       that changes one. Every SQL statement in the file is checked. */
    const keywords = code.match(/\b(SELECT|INSERT|UPDATE|DELETE|ALTER|DROP|REPLACE)\b/g) ?? [];
    expect(keywords.length).toBeGreaterThan(0);
    for (const kw of keywords) expect(kw).toBe("SELECT");
    for (const table of ["audit_chain_genesis", "audit_chain_verifications", "audit_chain_health"]) {
      expect(code).not.toContain(table);
    }
  });

  it("names the database file it read, so a result is never scope-free", () => {
    expect(code).toContain("databaseFile");
    expect(code).toContain("Database read:");
  });
});

describe("W223 · PINNED DEFECT — the verifier the admin page calls cannot see a content tamper", () => {
  it("reports audit_log as fully verified while a row is tampered", async () => {
    const { verifyChainForTable } = await import("../lib/auditChainVerifier");
    const idx = 3;
    const target = seeded[idx];
    const original = target.payload_json;

    const before = verifyChainForTable("audit_log", { tenantId: TENANT, withDetails: false });
    tamperExactlyOnce(target.id, "payload_json", `${original.slice(0, -1)},"catalog_blind":true}`);
    try {
      /* the real verifier sees it */
      expect(verifyTenantAuditChain(rawDb(), TENANT).ok).toBe(false);

      /* the catalog verifier does not */
      const after = verifyChainForTable("audit_log", { tenantId: TENANT, withDetails: false });
      expect(after.broken_at_row_id).toBeNull();
      expect(after.verified).toBe(before.verified);
      expect(after.last_known_good_hash).toBe(before.last_known_good_hash);
    } finally {
      restore(target.id, "payload_json", original);
    }
    expect(verifyTenantAuditChain(rawDb(), TENANT).ok).toBe(true);
  });

  it("declares no insert-payload recompute for audit_log, which is why", async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../lib/auditChainVerifier.ts"),
      "utf8",
    );
    const start = src.indexOf('name: "audit_log"');
    expect(start).toBeGreaterThan(-1);
    /* the catalog entry runs to the next entry's `name:` key */
    const next = src.indexOf("name: \"", start + 20);
    const entry = src.slice(start, next === -1 ? start + 2000 : next);
    expect(entry).not.toContain("insertPayload");
  });
});
