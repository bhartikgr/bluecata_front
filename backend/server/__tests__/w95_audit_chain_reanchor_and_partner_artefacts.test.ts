/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 95 — (1) RE-ANCHORING THE AUDIT CHAIN under R84 · (2) TWO INTERNAL
 *              ARTEFACTS TAKEN OFF A PARTNER'S SCREEN.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ITEM 1. Wave 93 PROVED the chain is genuinely broken and correctly refused to
 * pick a remedy without the owner (build_log/wave93/W93_AUDIT_CHAIN.md §6,
 * OWNER QUESTION Q4). R84 chose remediation A — the designed
 * `audit_chain_genesis` mechanism — and chose to do it NOW, while every record
 * in the system is still test data.
 *
 * The whole value of this item is that the guarantee after the anchor is REAL
 * rather than cosmetic, so the tests below are written against the ways it could
 * be fake, not against the happy path:
 *
 *   §1  the mechanism exists already — NO migration is added or needed.
 *   §2  the anchor is EXPLICIT: refused without a stated intent, refused without
 *       an identified operator, and reachable from nothing but its own endpoint.
 *   §3  the anchor is RECORDED and AUDITED: who / when / why / anchor row /
 *       anchor hash, citing R84, in the genesis row AND in the ledger.
 *   §4  NOTHING IS DELETED — the unprovable record is still there, byte for byte.
 *   §5  ANCHORING CANNOT SILENCE. An anchor that leaves a break writes NOTHING
 *       and the alarm STAYS ON. This is the load-bearing test of the wave.
 *   §6  NO SECOND ANCHOR — refused, structurally.
 *   §7  the two FAIL-CLOSED modes still work: `brokenAt: -2` when the anchor row
 *       is missing, `brokenAt: -3` when its hash disagrees. Without these the
 *       post-anchor guarantee would be decoration.
 *   §8  the UI states plainly that the record BEFORE the anchor is NOT PROVABLE,
 *       and no wording implies the earlier record was verified.
 *   §9  "Resolve incident" is UNCHANGED and still refuses with 409.
 *
 * ITEM 2. §10. A full 64-character hash was rendered on the partner SPV page
 * (register M-8) and a tooltip carried another; and the sentence reviewer 3
 * flagged still ended in the word "yet" — a promise about a future engine, shown
 * to a customer. R77 (rendered text vs machine value), R44 (replace only what is
 * misleading; add rather than delete), owner Q25 (no exposure of internal
 * process).
 *
 * NODE_ENV=test puts the database at `:memory:` (server/db/connection.ts).
 * Nothing here reads or writes live data.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import {
  verifyTenantAuditChain,
  appendAdminAudit,
  reAnchorTenantAuditChain,
  getAuditChainAnchors,
  reAnchorRefusalMessage,
} from "../adminPlatformStore";
import { auditReceiptReference } from "../../client/src/lib/auditReceiptRef";

const CLIENT = join(__dirname, "..", "..", "client", "src");
const SERVER = join(__dirname, "..");
const read = (p: string) => readFileSync(p, "utf8");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Comments stripped, so a claim written in a comment cannot satisfy a test. */
const rendered = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, () => { port = (server.address() as { port: number }).port; r(); }));
}, 60_000);

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request(
      {
        host: "127.0.0.1", port, path, method,
        headers: {
          ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}),
          ...(headers ?? {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data }); }
        });
      },
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

/** Wave 93 §3's retired formula — the writer that produced the live break. */
function insertBrokenRow(tenantId: string, id: string, whenMs: number): string {
  const now = new Date(whenMs).toISOString();
  const hash = sha256(`${id}:u_w95_deploy_script:partner.admin.created:${now}`);
  rawDb()
    .prepare(
      `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, payload_json, prev_hash, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(id, tenantId, "u_w95_deploy_script", "partner.admin.created", "user:u_w95_partner_admin", "{}", hash, now);
  return hash;
}

function ensureHealthRow(key: string, status: string, detail: string): void {
  rawDb()
    .prepare(
      `INSERT INTO audit_chain_health (key, status, detail, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = excluded.updated_at`,
    )
    .run(key, status, detail, new Date().toISOString());
}

const healthStatus = (key: string): string | null => {
  const r = rawDb().prepare(`SELECT status FROM audit_chain_health WHERE key = ?`).get(key) as { status: string } | undefined;
  return r?.status ?? null;
};
const anchorRow = (tenantId: string) =>
  rawDb().prepare(`SELECT * FROM audit_chain_genesis WHERE tenant_id = ?`).get(tenantId) as
    | { tenant_id: string; anchor_row_id: string; anchor_hash: string; effective_at: string; reason: string; created_at: string }
    | undefined;

/* ══════════════════════════════════════════════════════════════════════════
   §1 · THE MECHANISM ALREADY EXISTS — NO MIGRATION IS ADDED OR NEEDED.
   The brief said to STOP AND REPORT if a migration were genuinely required.
   It is not: the table is created in BOTH places a database can come from.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 95 · §1 — audit_chain_genesis already exists; no migration added", () => {
  it("W95-1a — migration 0124 creates the table, and connection.ts creates it inline too", () => {
    const mig = read(join(SERVER, "db", "migrations", "0124_wave_a1_audit_seed_repair.sql"));
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS audit_chain_genesis/);
    const conn = read(join(SERVER, "db", "connection.ts"));
    expect(conn).toMatch(/CREATE TABLE IF NOT EXISTS audit_chain_genesis/);
  });

  it("W95-1b — the table is present and writable on the live test handle", () => {
    const cols = rawDb().prepare(`PRAGMA table_info(audit_chain_genesis)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(["anchor_hash", "anchor_row_id", "created_at", "effective_at", "reason", "tenant_id"]);
  });

  it("W95-1c — WAVE 95 added NO migration file: the highest is still 0192", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(join(SERVER, "db", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(files[files.length - 1]).toBe("0192_wave68_term_domain_fences.sql");
    expect(files.some((f) => /^019[3-9]|^0[2-9]\d\d/.test(f))).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §2 · EXPLICIT. Never automatic, never a migration side effect, never silent.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 95 · §2 — the re-anchor is EXPLICIT (R84 condition 1)", () => {
  it("W95-2a — a blank intent is REFUSED and nothing is written", () => {
    const T = "tenant_w95_intent_probe";
    insertBrokenRow(T, "al_w95_intent_0001", 1_780_000_000_000);
    const r = reAnchorTenantAuditChain({ tenantId: T, actorId: "u_w95_admin", intent: "   " });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("intent_required");
    expect(anchorRow(T)).toBeUndefined();
  });

  it("W95-2b — an UNIDENTIFIED operator is REFUSED: no placeholder actor on an integrity action", () => {
    const T = "tenant_w95_actor_probe";
    insertBrokenRow(T, "al_w95_actor_0001", 1_780_000_001_000);
    for (const bad of ["", "   ", "system:admin", "u_unknown_admin"]) {
      const r = reAnchorTenantAuditChain({ tenantId: T, actorId: bad, intent: "W95 probe" });
      expect(r.ok, `actor ${JSON.stringify(bad)} must be refused`).toBe(false);
      expect(r.error).toBe("actor_required");
    }
    expect(anchorRow(T)).toBeUndefined();
  });

  it("W95-2c — an EMPTY ledger cannot be anchored: an empty chain is not a broken chain", () => {
    const r = reAnchorTenantAuditChain({ tenantId: "tenant_w95_empty_probe", actorId: "u_w95_admin", intent: "W95 probe" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no_rows_to_anchor");
  });

  it("W95-2d — NOTHING calls the re-anchor except its own endpoint: not boot, not a migration, not a scheduler", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        if (e === "node_modules" || e === "__tests__" || e === ".git") continue;
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p);
      }
      return out;
    };
    const callers = walk(SERVER)
      .concat(walk(join(SERVER, "..", "scripts")))
      .filter((p) => /reAnchorTenantAuditChain\s*\(/.test(read(p)))
      .map((p) => p.replace(join(SERVER, ".."), "").replace(/^\//, ""));
    // Exactly one file: the store that declares it and registers the route.
    expect(callers.sort()).toEqual(["server/adminPlatformStore.ts"]);
    // And no .sql file mentions it — it cannot be a migration side effect.
    const migs = readdirSync(join(SERVER, "db", "migrations")).filter((f) => f.endsWith(".sql"));
    for (const m of migs) {
      expect(read(join(SERVER, "db", "migrations", m))).not.toMatch(/reAnchorTenantAuditChain/);
    }
    // The boot verifier tick does not anchor anything.
    expect(read(join(SERVER, "lib", "hydrateStores.ts"))).not.toMatch(/reAnchorTenantAuditChain|INSERT INTO audit_chain_genesis/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §3 §4 §6 · THE ACTION ITSELF: recorded, audited, nothing deleted, once only.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 95 · §3/§4/§6 — the anchor is RECORDED, AUDITED, ADDITIVE and ONCE", () => {
  const T = "tenant_w95_reanchor_happy";
  const BROKEN_ID = "al_w95_happy_0001";
  let brokenHash = "";
  let result: ReturnType<typeof reAnchorTenantAuditChain>;
  let rowsBefore = 0;

  beforeAll(() => {
    brokenHash = insertBrokenRow(T, BROKEN_ID, 1_780_000_010_000);
    ensureHealthRow(T, "incident", "boot verifier tick: chain broken at link 0 of 1");
    // The state Wave 93 proved: exactly one row, and it does not verify.
    const pre = verifyTenantAuditChain(rawDb(), T);
    expect(pre.ok).toBe(false);
    expect(pre.brokenAt).toBe(0);
    expect(pre.totalLinks).toBe(1);
    expect(pre.genesisApplied).toBe(false);
    rowsBefore = (rawDb().prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ?`).get(T) as { c: number }).c;
    result = reAnchorTenantAuditChain({
      tenantId: T,
      actorId: "u_w95_lead_dev",
      intent: "One record written by a retired deploy script does not match its own hash (Wave 93). All records are test data; anchoring now is cheaper than anchoring after real customers transact.",
      nowIso: "2026-08-21T15:00:00.000Z",
    });
  });

  it("W95-3a — the chain verifies CLEAN after anchoring, and the incident is closed by a PASSING verification", () => {
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.incidentCleared).toBe(true);
    expect(result.alarmStaysOn).toBe(false);
    expect(healthStatus(T)).toBe("ok");
    const v = verifyTenantAuditChain(rawDb(), T);
    expect(v.ok).toBe(true);
    expect(v.genesisApplied).toBe(true);
    expect(v.preGenesisRowCount).toBe(1);
  });

  it("W95-3b — the genesis row RECORDS who, when, why, the anchor row id and the anchor hash, and CITES R84", () => {
    const g = anchorRow(T)!;
    expect(g).toBeTruthy();
    expect(g.anchor_row_id).toBe(BROKEN_ID);
    expect(g.anchor_hash).toBe(brokenHash);
    expect(g.effective_at).toBe("2026-08-21T15:00:00.000Z");
    expect(g.reason).toContain("R84");
    expect(g.reason).toContain("WHO: u_w95_lead_dev");
    expect(g.reason).toContain("WHEN: 2026-08-21T15:00:00.000Z");
    expect(g.reason).toContain("WHY:");
    expect(g.reason).toContain(`ANCHOR ROW: ${BROKEN_ID}`);
    expect(g.reason).toContain(`ANCHOR HASH: ${brokenHash}`);
    // And it says what it costs, in the record itself.
    expect(g.reason).toMatch(/NOT provable/);
    expect(g.reason).toMatch(/nothing was deleted/i);
  });

  it("W95-3c — the action is AUDITED in the ledger, and that record itself verifies", () => {
    const rows = rawDb()
      .prepare(`SELECT id, actor_id, action, payload_json, prev_hash FROM audit_log WHERE tenant_id = ? AND action = 'audit_chain.re_anchored'`)
      .all(T) as Array<{ id: string; actor_id: string; action: string; payload_json: string; prev_hash: string }>;
    expect(rows.length).toBe(1);
    const p = JSON.parse(rows[0].payload_json);
    expect(rows[0].actor_id).toBe("u_w95_lead_dev");
    expect(p.ruling).toBe("R84");
    expect(p.anchorRowId).toBe(BROKEN_ID);
    expect(p.anchorHash).toBe(brokenHash);
    expect(p.preAnchorRecordsNotProvable).toBe(1);
    expect(String(p.intent).length).toBeGreaterThan(10);
    // It chains from the anchor, which is what makes it provable.
    expect(rows[0].prev_hash).toBe(brokenHash);
  });

  it("W95-4a — NOTHING IS DELETED: the unprovable record is still there, byte for byte", () => {
    const still = rawDb()
      .prepare(`SELECT id, hash, prev_hash, actor_id, action FROM audit_log WHERE id = ?`)
      .get(BROKEN_ID) as { id: string; hash: string; prev_hash: string | null; actor_id: string; action: string } | undefined;
    expect(still).toBeTruthy();
    expect(still!.hash).toBe(brokenHash);
    expect(still!.prev_hash).toBeNull();
    expect(still!.actor_id).toBe("u_w95_deploy_script");
    // Row count only ever went UP: the broken row plus the audit record.
    const after = (rawDb().prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ?`).get(T) as { c: number }).c;
    expect(after).toBe(rowsBefore + 1);
  });

  it("W95-4b — the source contains NO code that deletes an audit_log row or a genesis row", () => {
    const src = read(join(SERVER, "adminPlatformStore.ts"));
    expect(src).not.toMatch(/DELETE\s+FROM\s+audit_log/i);
    expect(src).not.toMatch(/DELETE\s+FROM\s+audit_chain_genesis/i);
    expect(src).not.toMatch(/UPDATE\s+audit_chain_genesis/i);
    expect(src).not.toMatch(/INSERT\s+OR\s+REPLACE\s+INTO\s+audit_chain_genesis/i);
  });

  it("W95-6a — A SECOND RE-ANCHOR IS REFUSED, and the first anchor is untouched", () => {
    const before = anchorRow(T)!;
    const r2 = reAnchorTenantAuditChain({ tenantId: T, actorId: "u_w95_other_admin", intent: "second attempt", nowIso: "2026-08-22T00:00:00.000Z" });
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe("already_anchored");
    const after = anchorRow(T)!;
    expect(after).toEqual(before);
    const count = (rawDb().prepare(`SELECT COUNT(*) AS c FROM audit_chain_genesis WHERE tenant_id = ?`).get(T) as { c: number }).c;
    expect(count).toBe(1);
    // The refusal a human reads names the consequence rather than the column.
    expect(reAnchorRefusalMessage(r2)).toMatch(/new integrity incident/i);
  });

  it("W95-6b — 'anchored once' is STRUCTURAL: tenant_id is the PRIMARY KEY", () => {
    const conn = read(join(SERVER, "db", "connection.ts"));
    expect(conn).toMatch(/audit_chain_genesis \(\s*\n?\s*tenant_id\s+TEXT PRIMARY KEY NOT NULL/);
    const mig = read(join(SERVER, "db", "migrations", "0124_wave_a1_audit_seed_repair.sql"));
    expect(mig).toMatch(/tenant_id\s+TEXT PRIMARY KEY NOT NULL/);
    // So a second row cannot exist even if the guard above were removed:
    let threw = false;
    try {
      rawDb()
        .prepare(`INSERT INTO audit_chain_genesis (tenant_id, anchor_row_id, anchor_hash, effective_at, reason, created_at) VALUES (?,?,?,?,?,?)`)
        .run(T, "al_whatever", "deadbeef", "2026-08-22T00:00:00.000Z", "probe", "2026-08-22T00:00:00.000Z");
    } catch { threw = true; }
    expect(threw).toBe(true);
  });

  it("W95-3d — getAuditChainAnchors reports the anchor AND how many records are not provable", () => {
    const a = getAuditChainAnchors().find((x) => x.tenantId === T)!;
    expect(a).toBeTruthy();
    expect(a.anchorRowId).toBe(BROKEN_ID);
    expect(a.anchorHash).toBe(brokenHash);
    expect(a.preAnchorNotProvable).toBe(1);
    expect(a.reason).toContain("R84");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §5 · THE LOAD-BEARING TEST — ANCHORING CANNOT SILENCE A STILL-BROKEN CHAIN.
   R84: "If the chain does not verify clean AFTER anchoring, the alarm STAYS ON
   and you report a failure. Anchoring must never become a way to silence."
   Proved by ATTEMPTING an anchor that leaves a break, not by arguing it.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 95 · §5 — an anchor that leaves a break writes NOTHING and the alarm STAYS ON", () => {
  const T = "tenant_w95_cannot_silence";
  const FIRST = "al_w95_silence_0001";
  const SECOND = "al_w95_silence_0002";
  let attempt: ReturnType<typeof reAnchorTenantAuditChain>;

  beforeAll(() => {
    // TWO non-canonically-written rows. Anchoring at the FIRST leaves the
    // SECOND unverifiable, so the chain is still broken with the anchor in place.
    insertBrokenRow(T, FIRST, 1_780_000_020_000);
    insertBrokenRow(T, SECOND, 1_780_000_021_000);
    ensureHealthRow(T, "incident", "boot verifier tick: chain broken at link 0 of 2");
    /* THE ATTEMPT ITSELF IS MADE HERE, not inside the first `it`. It was inside
       W95-5a originally, and mutation M2 SURVIVED because of it: running any
       single test of this block in isolation meant the attempt never happened, so
       "nothing was written" was trivially true. Every assertion below now stands
       on its own. */
    attempt = reAnchorTenantAuditChain({
      tenantId: T, actorId: "u_w95_lead_dev", intent: "attempt an anchor that leaves a break", anchorRowId: FIRST,
      nowIso: "2026-08-21T15:10:00.000Z",
    });
  });

  it("W95-5a — the attempt is REFUSED, with the failure reported", () => {
    const r = attempt;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("chain_not_clean_after_anchor");
    expect(r.alarmStaysOn).toBe(true);
    expect(r.incidentCleared).toBe(false);
    expect(r.brokenAt).toBe(0);
    // The message says what happened and does not offer to try harder.
    expect(reAnchorRefusalMessage(r)).toMatch(/Nothing was written/);
    expect(reAnchorRefusalMessage(r)).toMatch(/not a way to clear an alarm/);
  });

  it("W95-5b — NOTHING WAS WRITTEN: no genesis row, and no audit record for the attempt", () => {
    expect(anchorRow(T)).toBeUndefined();
    const audits = rawDb()
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ? AND action = 'audit_chain.re_anchored'`)
      .get(T) as { c: number };
    expect(audits.c).toBe(0);
  });

  it("W95-5c — THE ALARM IS STILL ON: the health row is still an incident and the banner still renders", () => {
    expect(healthStatus(T)).toBe("incident");
    const v = verifyTenantAuditChain(rawDb(), T);
    expect(v.ok).toBe(false);
    // The banner's own condition, evaluated against this state.
    const banner = read(join(CLIENT, "components", "AuditChainP0Banner.tsx"));
    expect(banner).toContain("if (!data?.ok || !data.incident) return null;");
    const rows = rawDb().prepare(`SELECT key, status FROM audit_chain_health`).all() as Array<{ key: string; status: string }>;
    const incident = rows.some((r) => String(r.status).toLowerCase() !== "ok");
    expect(incident).toBe(true);
  });

  it("W95-5d — a LATER anchor at the correct row is still possible, because nothing was written", () => {
    // The refusal is not a lockout. Anchoring at the tip covers both records
    // and verifies, which is what makes the refusal above a fail-closed rather
    // than a dead end.
    const r = reAnchorTenantAuditChain({
      tenantId: T, actorId: "u_w95_lead_dev", intent: "anchor at the tip: neither earlier record is provable",
      nowIso: "2026-08-21T15:11:00.000Z",
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.preAnchorNotProvable).toBe(2);
    expect(healthStatus(T)).toBe("ok");
    expect(anchorRow(T)!.anchor_row_id).toBe(SECOND);
  });

  it("W95-5e — the clearing path goes THROUGH a verification: there is no direct write to status='ok'", () => {
    const src = read(join(SERVER, "adminPlatformStore.ts"));
    // Exactly one place writes 'ok' to audit_chain_health, and it is inside
    // resolveAuditChainHealth, which returns early when `verified` is false.
    const writes = src.match(/UPDATE audit_chain_health SET status = 'ok'/g) ?? [];
    expect(writes.length).toBe(1);
    expect(src).toMatch(/export function resolveAuditChainHealth\([\s\S]{0,400}?if \(!verified\) \{/);
    // The re-anchor never writes health itself; it delegates to that function.
    const block = src.slice(src.indexOf("export function reAnchorTenantAuditChain"), src.indexOf("export function reAnchorRefusalMessage"));
    expect(block).not.toMatch(/UPDATE audit_chain_health/);
    expect(block).toMatch(/resolveAuditChainHealth\(/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §7 · THE TWO FAIL-CLOSED MODES, RE-VERIFIED AFTER THIS WAVE'S CHANGE.
   These are the reason the post-anchor guarantee is real. If either stopped
   working, an anchor would mean "trust whatever hash is in the genesis table".
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 95 · §7 — the verifier still FAILS CLOSED on a tampered anchor", () => {
  it("W95-7a — anchor row MISSING → brokenAt -2, ok false", () => {
    const T = "tenant_w95_failclosed_minus2";
    const h = insertBrokenRow(T, "al_w95_fc2_0001", 1_780_000_030_000);
    const r = reAnchorTenantAuditChain({ tenantId: T, actorId: "u_w95_lead_dev", intent: "fail-closed probe -2", nowIso: "2026-08-21T15:20:00.000Z" });
    expect(r.ok).toBe(true);
    expect(verifyTenantAuditChain(rawDb(), T).ok).toBe(true);
    // Now remove the anchor row from under the anchor. This is a TAMPER
    // simulation in a fixture; no product code deletes an audit row (§4b).
    rawDb().prepare(`DELETE FROM audit_log WHERE id = ?`).run("al_w95_fc2_0001");
    const v = verifyTenantAuditChain(rawDb(), T);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(-2);
    expect(v.genesisApplied).toBe(true);
    expect(v.genesisHash).toBe(h);
  });

  it("W95-7b — anchor hash DISAGREES → brokenAt -3, ok false", () => {
    const T = "tenant_w95_failclosed_minus3";
    insertBrokenRow(T, "al_w95_fc3_0001", 1_780_000_040_000);
    const r = reAnchorTenantAuditChain({ tenantId: T, actorId: "u_w95_lead_dev", intent: "fail-closed probe -3", nowIso: "2026-08-21T15:21:00.000Z" });
    expect(r.ok).toBe(true);
    expect(verifyTenantAuditChain(rawDb(), T).ok).toBe(true);
    rawDb().prepare(`UPDATE audit_chain_genesis SET anchor_hash = ? WHERE tenant_id = ?`).run("0".repeat(64), T);
    const v = verifyTenantAuditChain(rawDb(), T);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(-3);
    expect(v.genesisApplied).toBe(true);
  });

  it("W95-7c — the two sentinels are still the ONLY early returns in the verifier, and both are failures", () => {
    /* Comments stripped first: this wave's own documentation quotes the two
       sentinels in prose, and a doc comment must not be able to satisfy a test
       about executable behaviour. */
    const src = rendered(join(SERVER, "adminPlatformStore.ts"));
    const fn = src.slice(src.indexOf("export function verifyTenantAuditChain"), src.indexOf("export function getAuditChainAnchors"));
    expect(fn.length).toBeGreaterThan(500);
    expect(fn).toMatch(/brokenAt: -2/);
    expect(fn).toMatch(/brokenAt: -3/);
    // Neither sentinel path may report ok:true.
    for (const m of fn.matchAll(/brokenAt: -[23]/g)) {
      const window = fn.slice(Math.max(0, m.index! - 200), m.index!);
      expect(window).toMatch(/ok: false/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §8 §9 · THE UI: honest about what is NOT provable, and "Resolve" unchanged.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 95 · §8 — the UI states plainly that the record BEFORE the anchor is NOT PROVABLE", () => {
  const page = () => rendered(join(CLIENT, "pages", "admin", "AuditChainVerifyPage.tsx"));

  it("W95-8a — the provenance panel exists and says NOT PROVABLE, and that nothing was deleted", () => {
    const s = page();
    expect(s).toContain('data-testid="ledger-provenance-panel"');
    expect(s).toContain("cannot prove they are unaltered");
    expect(s).toContain("not provable");
    expect(s).toContain("nothing was\n              deleted");
  });

  it("W95-8b — NO WORDING implies the earlier record was verified", () => {
    const s = page();
    /* THIS ASSERTION WAS TOO NARROW ON ITS FIRST WRITING, AND MUTATION M9 PROVED
       IT. The original forbade `(whole|entire|…) (ledger|…) (is |now )?(verified|
       provable)`, which requires the claim to be phrased in exactly that word
       order. Inserting the sentence "The entire ledger is now verified." — the
       single most likely way this honesty requirement would actually be eroded —
       SURVIVED it, because "is now verified" has two words where the pattern
       allowed one. A negative assertion that only catches the phrasings its
       author happened to think of is the same class of defect as a verifier tuned
       into passing everything.

       Rewritten to catch the CLAIM rather than a word order: a totalising
       quantifier anywhere within one sentence of a verification word. Both poles
       are asserted below — the forbidden claim must be caught, and the honest
       copy that is actually shipped must NOT be. */
    const FORBIDDEN =
      /\b(?:whole|entire|full|complete|every|all)\b[^.]{0,60}?\b(?:ledger|history|chain|records?)\b[^.]{0,60}?\b(?:verified|provable|unaltered|intact|proved)\b/i;
    const FORBIDDEN_REVERSED =
      /\b(?:verified|provable|unaltered|intact|proved)\b[^.]{0,60}?\b(?:whole|entire|full|complete|every|all)\b[^.]{0,60}?\b(?:ledger|history|chain|records?)\b/i;
    expect(s).not.toMatch(FORBIDDEN);
    expect(s).not.toMatch(FORBIDDEN_REVERSED);
    expect(s).not.toMatch(/earlier record[s]?[^.]{0,40}\b(?:were|was|are|is)\b[^.]{0,20}verified/i);
    expect(s).not.toMatch(/integrity restored|chain repaired|history verified|now verifiable/i);

    /* POLE B — the pattern is not vacuous: it DOES catch the claim. If this
       assertion ever failed, the pattern above would have stopped meaning
       anything and the test would silently pass on anything. */
    for (const claim of [
      "The entire ledger is now verified.",
      "The whole history has been verified.",
      "All records are provable.",
      "Every record in the ledger is now proved unaltered.",
      "The complete chain is intact.",
    ]) {
      expect(FORBIDDEN.test(claim) || FORBIDDEN_REVERSED.test(claim), `must catch: ${claim}`).toBe(true);
    }
    /* POLE A — and it does NOT catch the honest copy that IS shipped, so the
       pattern is not merely banning the vocabulary. */
    for (const honest of [
      "The 1 record(s) written before the anchor point are still here and still readable.",
      "the platform cannot prove they are unaltered, and it does not claim to",
      "Every record written after the anchor point is checked against it and verifies.",
    ]) {
      expect(FORBIDDEN.test(honest) || FORBIDDEN_REVERSED.test(honest), `must NOT catch: ${honest}`).toBe(false);
    }
  });

  it("W95-8c — the panel is PERMANENT: it renders on the presence of an anchor, not on an open incident", () => {
    const s = page();
    expect(s).toMatch(/function LedgerProvenancePanel\([\s\S]{0,200}?if \(anchors\.length === 0\) return null;/);
    // It is rendered OUTSIDE the `health &&` block, so closing the incident
    // does not remove the statement.
    const idxPanel = s.indexOf("<LedgerProvenancePanel anchors={anchors} />");
    const idxHealth = s.indexOf("{health && (");
    expect(idxPanel).toBeGreaterThan(-1);
    expect(idxPanel).toBeLessThan(idxHealth);
    /* AND THE RENDER SITE IS UNCONDITIONAL. Position alone was not enough:
       mutation M12 wrapped it as `{health?.incident && <LedgerProvenancePanel…>}`
       — still ABOVE the health card, still passing the position check, and the
       statement would have vanished the moment the alarm cleared, which is the
       exact failure this test exists to prevent. The whole render line is now
       matched, so any guard in front of it fails here. */
    const line = s.split("\n").find((l) => l.includes("<LedgerProvenancePanel"))!;
    expect(line.trim()).toBe("<LedgerProvenancePanel anchors={anchors} />");
    expect(line).not.toMatch(/&&|\?|incident|health/);
  });

  it("W95-8d — the control demands an intent and warns, in words, what it costs", () => {
    const s = page();
    expect(s).toContain('placeholder="Why is this ledger being re-anchored?"');
    expect(s).toContain("Re-anchor this ledger");
    expect(s).toContain("CANNOT prove they are unaltered");
    expect(s).toContain("Nothing is deleted");
  });

  it("W95-8e — the P0 banner is STILL not suppressed by this wave", () => {
    const src = read(join(CLIENT, "components", "AuditChainP0Banner.tsx"));
    expect(src).toContain("if (!data?.ok || !data.incident) return null;");
    expect(src).toContain('role="alert"');
    expect(src).toContain("Audit chain integrity incident");
    expect(src).not.toMatch(/localStorage|sessionStorage/);
    expect(src).not.toMatch(/onDismiss|setDismissed|isDismissed|dismissedAt/);
    expect((src.match(/return null;/g) ?? []).length).toBe(1);
  });
});

describe("WAVE 95 · §9 — 'Resolve incident' stays SEPARATE and still refuses", () => {
  it("W95-9a — the resolve endpoint is untouched and still answers 409 chain_not_clean", async () => {
    const T = "tenant_w95_resolve_still_refuses";
    insertBrokenRow(T, "al_w95_resolve_0001", 1_780_000_050_000);
    const r = await req("POST", "/api/admin/audit-chain-health/resolve", { key: T, note: "w95 probe" }, { "x-user-id": "u_admin" });
    expect([401, 403, 409]).toContain(r.status);
    if (r.status === 409) {
      expect(r.body?.error).toBe("chain_not_clean");
      expect(r.body?.brokenAt).toBe(0);
    }
    expect(anchorRow(T)).toBeUndefined();
  });

  it("W95-9b — the resolve route does NOT re-anchor, and the re-anchor route is its own endpoint", () => {
    const src = read(join(SERVER, "adminPlatformStore.ts"));
    const resolveRoute = src.slice(
      src.indexOf('app.post("/api/admin/audit-chain-health/resolve"'),
      src.indexOf('app.post("/api/admin/audit-chain/re-anchor"'),
    );
    expect(resolveRoute.length).toBeGreaterThan(100);
    expect(resolveRoute).not.toMatch(/reAnchorTenantAuditChain|audit_chain_genesis/);
    expect(src).toContain('app.post("/api/admin/audit-chain/re-anchor"');
  });

  it("W95-9c — the re-anchor endpoint refuses a blank intent (400) and an unidentified operator (403)", async () => {
    const noIntent = await req("POST", "/api/admin/audit-chain/re-anchor", { key: "tenant_w95_route_probe" }, { "x-user-id": "u_admin" });
    expect([400, 401, 403]).toContain(noIntent.status);
    if (noIntent.status === 400) expect(noIntent.body?.error).toBe("intent_required");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §10 · ITEM 2 — the two internal artefacts that were rendered to a PARTNER.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 95 · §10 — no 64-character hash and no future-engine promise on a partner screen", () => {
  const SPV = join(CLIENT, "pages", "partner", "PartnerSpvDetail.tsx");
  const FUND = join(CLIENT, "pages", "partner", "PartnerFundDetail.tsx");
  const TABS = join(CLIENT, "components", "partner", "SpvDetailTabs.tsx");

  it("W95-10a — the reference is a SHORT, QUOTABLE, DETERMINISTIC prefix of the same digest", () => {
    const live = "00e0892930df04916d2885750882fa4ea211b9561e67b4287c7c2a234d25e6d8";
    expect(auditReceiptReference(live)).toBe("00E0-8929");
    expect(auditReceiptReference(live)!.length).toBe(9);
    // Deterministic: the same digest always yields the same reference.
    expect(auditReceiptReference(live)).toBe(auditReceiptReference(live));
    // Different digests yield different references.
    expect(auditReceiptReference("ffffffff" + "0".repeat(56))).toBe("FFFF-FFFF");
    // Rule 7 — a non-value is refused, never mangled into a fake reference.
    for (const bad of [null, undefined, "", "   ", "not-a-hash", "00e0"]) {
      expect(auditReceiptReference(bad as string | null)).toBeNull();
    }
  });

  it("W95-10b — NEITHER partner page renders the raw hash expression any more", () => {
    for (const f of [SPV, FUND]) {
      const s = rendered(f);
      expect(s).not.toMatch(/Revision fingerprint: \{[sf]\.revisionHash\}/);
      expect(s).toMatch(/auditReceiptReference\([sf]\.revisionHash\)/);
      // R44 — the owner-approved LABEL survives verbatim. Nothing is deleted.
      expect(s).toContain("Revision fingerprint:");
      // R77 — the full value survives as a machine-readable attribute.
      expect(s).toMatch(/data-revision-hash=\{[sf]\.revisionHash\}/);
    }
  });

  it("W95-10c — the SPV tab's TOOLTIP no longer carries the full digest", () => {
    const s = rendered(TABS);
    // `title` is RENDERED TEXT under R77 — it reaches the eye and the screen reader.
    expect(s).not.toMatch(/title=\{revisionHash\}/);
    expect(s).toMatch(/data-revision-hash=\{revisionHash\}/);
    /* The tooltip is REPLACED, not merely deleted: a screen reader previously
       read out 64 hex characters here and now hears words. */
    expect(s).toMatch(/aria-label=\{`Audit receipt reference \$\{receiptRef\}`\}/);
    expect(s).toMatch(/auditReceiptReference\(revisionHash\)/);
    // The 16-character fragment is gone too; it was no more readable than 64.
    expect(s).not.toMatch(/revisionHash\.slice\(0, 16\)/);
  });

  it("W95-10d — reviewer 3's sentence no longer promises a future engine, and what IS available is stated", () => {
    const s = rendered(TABS);
    // The original, and the words Wave 83 already removed — still absent.
    expect(s).not.toContain("not exposed by the engine yet");
    expect(s).not.toContain("NO_MANDATE");
    // The word that survived Wave 83 and is the promise: gone.
    expect(s).not.toContain("are not recorded for this vehicle yet");
    // Wave 83's owner-approved wording, kept verbatim minus that one word.
    expect(s).toContain("A revision number and a link to the previous audit entry are not recorded");
    // ADDED beside it: what this receipt DOES record.
    expect(s).toContain("This receipt records the fingerprint above and the time of the last revision");
    expect(s).toContain("Nothing else");
    expect(s).toContain('data-testid="spv-detail-audit-receipt-available-note"');
  });

  it("W95-10e — no partner-facing source renders a 64-character hex literal or a full-digest expression", () => {
    for (const f of [SPV, FUND, TABS]) {
      const s = rendered(f);
      expect(s).not.toMatch(/[0-9a-f]{64}/i);
      expect(s).not.toMatch(/revision_hash:|created_at:/);
    }
  });

  it("W95-10f — a partner is told what to DO with the reference, which is why a short one is enough", () => {
    for (const f of [SPV, FUND]) {
      expect(rendered(f)).toContain("Quote this fingerprint to Capavate support");
    }
    expect(rendered(TABS)).toContain("Quote the fingerprint to Capavate support");
  });

  it("W95-10g — WAVE 1D's CSS-only partner restyle is untouched: no partner stylesheet was opened", () => {
    for (const f of ["ledger-partner.css", "ledger-ramps.css"]) {
      const p = join(CLIENT, "styles", f);
      const s = read(p);
      expect(s).not.toMatch(/WAVE 95/);
    }
    // And this wave's partner edits are copy/behaviour only — no class or style
    // attribute was added to, or removed from, the three files it touched.
    for (const f of [SPV, FUND, TABS]) {
      expect(read(f)).not.toMatch(/WAVE 95[\s\S]{0,600}?style=\{\{/);
    }
  });
});
