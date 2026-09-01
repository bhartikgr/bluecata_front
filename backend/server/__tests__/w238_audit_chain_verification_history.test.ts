/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 238 — THE PLATFORM VERIFIED THE CHAIN ON EVERY RESTART AND KEPT NO
 * RECORD THAT IT HAD.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The brief's original description was WRONG and is corrected here: the
 * platform DOES retain a verdict. `audit_chain_health` holds one row per
 * tenant, and the boot verifier overwrites it on every tick via
 * ON CONFLICT(key) DO UPDATE. What was missing is HISTORY — the sequence of
 * runs — which is why /admin/audit-chain-verify said
 * "Verification history: No past verifications recorded."
 *
 * `audit_chain_verifications` already existed in BOTH schema paths
 * (server/db/connection.ts:4368 inline bootstrap, which is what NODE_ENV=test
 * opens, and migrations/0002_slow_medusa.sql:10). NO MIGRATION was needed and
 * none was written. §A asserts both paths still declare it.
 *
 * R220.4 is honoured: the only writer of that table before this wave was
 * server/jobs/auditChainQuarterly.ts, which uses the FALSE-REDDING TWIN
 * `verifyChainForTable` and has ZERO callers. Wave 238 does not give it one,
 * does not import it and does not schedule it. §F asserts that.
 *
 * Everything below drives the REAL production registrar (`registerRoutes`)
 * over REAL HTTP against the REAL better-sqlite3 handle. Nothing here is a
 * replica of a route or of a verifier.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/* The twin is wrapped in a COUNTING proxy so the non-regression claim in §D is
   a call count on the twin itself, not an inference from a returned shape. The
   real implementation is still what runs — importOriginal, not a stub. */
const twin = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../lib/auditChainVerifier", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auditChainVerifier")>();
  return {
    ...actual,
    verifyChainForTable: (table: string, opts: any) => {
      twin.calls.push(table);
      return actual.verifyChainForTable(table, opts);
    },
  };
});

import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import {
  AUDIT_LOG_CHAIN_TABLE,
  AUDIT_CHAIN_VERIFIER_CANONICAL,
  AUDIT_CHAIN_HISTORY_RETENTION_PER_KEY,
} from "../../shared/auditChainHistory";

const ROOT = path.resolve(__dirname, "..", "..");
const readSource = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Strip block and line comments before drawing ANY conclusion from source
 *  text. Wave 238 adds long explanatory comments that quote the very strings
 *  some assertions below require to be ABSENT from the code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

let app: Express;
let server: http.Server;
let port = 0;

const ADMIN = { "x-user-id": "u_admin" };

function req(method: string, p: string, headers?: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: p, method, headers: { ...(headers ?? {}) } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }); }
        catch { resolve({ status: res.statusCode ?? 0, body: data }); }
      });
    });
    r.on("error", reject);
    r.end();
  });
}

/* ── fixture builders ─────────────────────────────────────────────────────── */

const TS0 = "2026-02-01T00:00:00.000Z";
const TS_A = "2026-02-01T00:00:00.000Z";
const TS_B = "2026-02-01T00:00:01.000Z";
const TS_C = "2026-02-01T00:00:02.000Z";
const TS_D = "2026-02-01T00:00:03.000Z";
const ACTION = "w238.fixture";
const TARGET = "platform:w238";
const PAYLOAD = "{}";

/** The v1 (pre-0188) hash body, byte-for-byte as adminPlatformStore computes it
 *  for a row whose hash_version is NULL. */
function v1Hash(prior: string, id: string, ts: string = TS0): string {
  return createHash("sha256").update(`${prior}|${id}|${ACTION}|${TARGET}|${ts}|${PAYLOAD}`).digest("hex");
}

function insertAudit(tenant: string, id: string, prevHash: string, hash: string, ts = TS0): void {
  rawDb().prepare(
    `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, payload_json, prev_hash, hash, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  ).run(id, tenant, ACTION, TARGET, PAYLOAD, prevHash, hash, ts);
}

/** A tenant whose chain the TWIN calls broken and the CANONICAL verifier calls
 *  clean. This is the entire point of Fix C: the two verifiers disagree, and
 *  only one of them is right about audit_log.
 *
 *  Row 1 declares a prev_hash that is NOT one of the twin's accepted genesis
 *  tokens (null / "GENESIS" / "0"*64), so the twin breaks at index 0. An
 *  audit_chain_genesis anchor pins row 1, so the canonical verifier starts AT
 *  row 2 and finds a clean chain — exactly the R84 re-anchored state. */
const T_CLEAN = "tenant_w238_rebased";
const PRE_GENESIS_PRIOR = "de".repeat(32);
const CLEAN_A = "aud_w238_rebase_a";
const CLEAN_B = "aud_w238_rebase_b";
let cleanAHash = "";
let cleanBHash = "";

/** A tenant whose chain is genuinely broken under the canonical verifier. */
const T_BROKEN = "tenant_w238_broken";
const BROKEN_A = "aud_w238_broken_a";
const BROKEN_B = "aud_w238_broken_b";
const BROKEN_C = "aud_w238_broken_c";
let brokenAHash = "";
let brokenBHash = "";

/** A tenant whose break is in the MIDDLE, not at the last link.
 *  T_BROKEN alone could not distinguish an honest broken_count of 1 from the
 *  fabricated `totalLinks - verified`: its break is at the final link, where the
 *  two happen to be equal. Disarm D6 came back GREEN against it, so this
 *  fixture exists. 4 links, break at index 1 → honest 1, fabricated 3. */
const T_BROKEN_MID = "tenant_w238_broken_mid";

/** A tenant used only for the retention proof. */
const T_RETAIN = "tenant_w238_retention";

const CHAPTER_CLEAN = "ch_w238_clean";
const CHAPTER_BROKEN = "ch_w238_broken";

function seedChapter(id: string, tenant: string): void {
  const cols = (rawDb().prepare(`PRAGMA table_info(chapters)`).all() as Array<{ name: string; notnull: number; dflt_value: any }>);
  const have = new Map(cols.map((c) => [c.name, c]));
  const vals: Record<string, any> = { id, tenant_id: tenant };
  if (have.has("name")) vals.name = `W238 ${id}`;
  if (have.has("slug")) vals.slug = id;
  if (have.has("country")) vals.country = "CA";
  if (have.has("status")) vals.status = "active";
  if (have.has("created_at")) vals.created_at = TS0;
  if (have.has("updated_at")) vals.updated_at = TS0;
  for (const c of cols) {
    if (c.notnull === 1 && c.dflt_value === null && !(c.name in vals)) vals[c.name] = "";
  }
  const keys = Object.keys(vals);
  rawDb().prepare(
    `INSERT OR REPLACE INTO chapters (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...keys.map((k) => vals[k]));
}

/** Pin an audit_chain_genesis anchor, filling whatever NOT NULL columns this
 *  schema build happens to declare. Written by introspection rather than a
 *  hardcoded column list because the inline bootstrap and the migration chain
 *  do not agree on the optional columns. */
function seedGenesis(tenant: string, anchorRowId: string, anchorHash: string): void {
  const cols = rawDb().prepare(`PRAGMA table_info(audit_chain_genesis)`).all() as Array<{ name: string; notnull: number; dflt_value: any }>;
  const vals: Record<string, any> = { tenant_id: tenant, anchor_row_id: anchorRowId, anchor_hash: anchorHash };
  for (const c of cols) {
    if (c.name in vals) continue;
    if (c.notnull !== 1 || c.dflt_value !== null) continue;
    vals[c.name] = /_at$|^created|^updated/.test(c.name) ? TS0 : "w238 fixture";
  }
  const keys = Object.keys(vals).filter((k) => cols.some((c) => c.name === k));
  rawDb().prepare(
    `INSERT OR REPLACE INTO audit_chain_genesis (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...keys.map((k) => vals[k]));
}

function historyRows(tenant: string): Array<any> {
  return rawDb()
    .prepare(`SELECT * FROM audit_chain_verifications WHERE tenant_id = ? ORDER BY started_at ASC, id ASC`)
    .all(tenant) as Array<any>;
}

beforeAll(async () => {
  const db = rawDb();

  /* Wipe only OUR fixture tenants. Nothing pre-existing is touched. */
  for (const t of [T_CLEAN, T_BROKEN, T_BROKEN_MID, T_RETAIN]) {
    db.prepare(`DELETE FROM audit_log WHERE tenant_id = ?`).run(t);
    try { db.prepare(`DELETE FROM audit_chain_verifications WHERE tenant_id = ?`).run(t); } catch { /* table absent */ }
    try { db.prepare(`DELETE FROM audit_chain_genesis WHERE tenant_id = ?`).run(t); } catch { /* table absent */ }
    try { db.prepare(`DELETE FROM audit_chain_health WHERE key = ?`).run(t); } catch { /* table absent */ }
  }

  cleanAHash = v1Hash(PRE_GENESIS_PRIOR, CLEAN_A, TS_A);
  cleanBHash = v1Hash(cleanAHash, CLEAN_B, TS_B);
  insertAudit(T_CLEAN, CLEAN_A, PRE_GENESIS_PRIOR, cleanAHash, TS_A);
  insertAudit(T_CLEAN, CLEAN_B, cleanAHash, cleanBHash, TS_B);
  seedGenesis(T_CLEAN, CLEAN_A, cleanAHash);

  /* Broken tenant: A is a real genesis row, B links correctly, C lies. */
  brokenAHash = v1Hash("0".repeat(64), BROKEN_A, TS_A);
  brokenBHash = v1Hash(brokenAHash, BROKEN_B, TS_B);
  insertAudit(T_BROKEN, BROKEN_A, "0".repeat(64), brokenAHash, TS_A);
  insertAudit(T_BROKEN, BROKEN_B, brokenAHash, brokenBHash, TS_B);
  insertAudit(T_BROKEN, BROKEN_C, "ff".repeat(32), v1Hash("ff".repeat(32), BROKEN_C, TS_C), TS_C);

  /* 4 rows: row 0 is a valid genesis, row 1 lies, rows 2 and 3 chain onward
     from row 1's stored hash so they are individually self-consistent. The
     walker stops at index 1 and never examines 2 or 3. */
  const midA = v1Hash("0".repeat(64), "aud_w238_mid_a", TS_A);
  insertAudit(T_BROKEN_MID, "aud_w238_mid_a", "0".repeat(64), midA, TS_A);
  const midBStored = v1Hash("ee".repeat(32), "aud_w238_mid_b", TS_B);
  insertAudit(T_BROKEN_MID, "aud_w238_mid_b", "ee".repeat(32), midBStored, TS_B);
  const midC = v1Hash(midBStored, "aud_w238_mid_c", TS_C);
  insertAudit(T_BROKEN_MID, "aud_w238_mid_c", midBStored, midC, TS_C);
  const midD = v1Hash(midC, "aud_w238_mid_d", TS_D);
  insertAudit(T_BROKEN_MID, "aud_w238_mid_d", midC, midD, TS_D);

  seedChapter(CHAPTER_CLEAN, T_CLEAN);
  seedChapter(CHAPTER_BROKEN, T_BROKEN);

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, () => { port = (server.address() as { port: number }).port; r(); }));
}, 120_000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
});

/* ═══════════════════════════════════════════════════════════════════════════
   §A — NO MIGRATION WAS NEEDED, AND NONE WAS WRITTEN.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W238 §A — the table already existed in both schema paths", () => {
  it("A1 — server/db/connection.ts declares audit_chain_verifications inline", () => {
    expect(readSource("server/db/connection.ts")).toMatch(
      /CREATE TABLE IF NOT EXISTS audit_chain_verifications/,
    );
  });

  it("A2 — migrations/0002_slow_medusa.sql declares it too", () => {
    expect(readSource("migrations/0002_slow_medusa.sql")).toMatch(/CREATE TABLE `audit_chain_verifications`/);
  });

  it("A3 — the live handle really has the table, with the columns wave 238 writes", () => {
    const cols = (rawDb().prepare(`PRAGMA table_info(audit_chain_verifications)`).all() as Array<{ name: string }>)
      .map((c) => c.name);
    for (const c of [
      "id", "tenant_id", "chapter_id", "table_name", "verified_count", "broken_count",
      "broken_first_id", "total_rows", "duration_ms", "started_at", "finished_at", "details_json",
    ]) {
      expect(cols).toContain(c);
    }
  });

  it("A4 — wave 238 added no migration file", () => {
    const files = fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => /w238|wave238|wave_238/i.test(f));
    expect(files).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §B — THE HISTORY IS RECORDED, AND IT NAMES THE CANONICAL VERIFIER.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W238 §B — a history of verification runs is retained", () => {
  it("B1 — before the fix there was NO history for these tenants; the boot verifier now records one per tenant per tick", async () => {
    expect(historyRows(T_CLEAN)).toEqual([]);
    expect(historyRows(T_BROKEN)).toEqual([]);
    expect(historyRows(T_BROKEN_MID)).toEqual([]);

    const { runAuditChainBootVerifier } = await import("../lib/hydrateStores");
    await runAuditChainBootVerifier({ maxTenants: Infinity });

    const clean = historyRows(T_CLEAN);
    const broken = historyRows(T_BROKEN);
    expect(clean.length).toBe(1);
    expect(broken.length).toBe(1);
    expect(historyRows(T_BROKEN_MID).length).toBe(1);
    expect(clean[0].table_name).toBe(AUDIT_LOG_CHAIN_TABLE);
    expect(broken[0].table_name).toBe(AUDIT_LOG_CHAIN_TABLE);
  });

  it("B2 — every row states which verifier produced it, and it is the CANONICAL one (R220.4)", () => {
    const row = historyRows(T_CLEAN)[0];
    const d = JSON.parse(String(row.details_json));
    expect(d.verifier).toBe(AUDIT_CHAIN_VERIFIER_CANONICAL);
    expect(d.verifier).toBe("verifyTenantAuditChain");
    expect(d.verifier).not.toBe("verifyChainForTable");
    expect(d.source).toBe("boot_verifier");
  });

  it("B3 — the counts come from the verifier and are not invented", () => {
    /* T_CLEAN: 2 rows in the table, 1 of them pre-genesis, 1 provable link. */
    const clean = historyRows(T_CLEAN)[0];
    expect(clean.total_rows).toBe(2);
    expect(clean.verified_count).toBe(1);
    expect(clean.broken_count).toBe(0);
    expect(JSON.parse(String(clean.details_json)).preGenesisRowCount).toBe(1);
    expect(JSON.parse(String(clean.details_json)).ok).toBe(true);

    /* T_BROKEN: 3 rows, no genesis, break at index 2 → 2 links verified. */
    const broken = historyRows(T_BROKEN)[0];
    expect(broken.total_rows).toBe(3);
    expect(broken.verified_count).toBe(2);
    expect(JSON.parse(String(broken.details_json)).brokenAtIndex).toBe(2);
  });

  it("B4 — a broken run records ONE break, not a guess at how many, and no fabricated row id", () => {
    /* THE DISCRIMINATING FIXTURE. T_BROKEN_MID breaks at index 1 of 4, so the
       honest count (1) and the fabricated count (totalLinks - verified = 3)
       are DIFFERENT numbers. Asserted first, because the assertion below on
       T_BROKEN cannot tell them apart — its break is at the last link, where
       both formulas give 1. Disarm D6 was GREEN until this existed. */
    const mid = historyRows(T_BROKEN_MID)[0];
    expect(mid.total_rows).toBe(4);
    expect(mid.verified_count).toBe(1);
    expect(mid.broken_count).toBe(1);
    expect(JSON.parse(String(mid.details_json)).brokenAtIndex).toBe(1);
    expect(mid.broken_count).not.toBe(mid.total_rows - mid.verified_count);

    const broken = historyRows(T_BROKEN)[0];
    /* The walker stops at the first bad link. Writing total_rows - verified
       here would claim knowledge of links it never examined. */
    expect(broken.broken_count).toBe(1);
    expect(broken.broken_first_id).toBeNull();
    const d = JSON.parse(String(broken.details_json));
    expect(d.brokenFirstIdReported).toBe(false);
    expect(d.walkerStopsAtFirstBreak).toBe(true);
    expect(d.ok).toBe(false);
  });

  it("B5 — durations and timestamps are real, not placeholders", () => {
    for (const row of [historyRows(T_CLEAN)[0], historyRows(T_BROKEN)[0]]) {
      expect(typeof row.duration_ms).toBe("number");
      expect(row.duration_ms).toBeGreaterThanOrEqual(0);
      expect(String(row.started_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(String(row.finished_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Date.parse(String(row.finished_at))).toBeGreaterThanOrEqual(Date.parse(String(row.started_at)));
    }
  });

  it("B6 — the health verdict, its two detail strings and its overwrite semantics are UNCHANGED", () => {
    const src = readSource("server/lib/hydrateStores.ts");
    expect(src).toContain("boot verifier tick: chain verified clean");
    expect(src).toContain("boot verifier tick: chain broken at link ");
    expect(src).toContain("ON CONFLICT(key) DO UPDATE SET");
    const health = rawDb().prepare(`SELECT status, detail FROM audit_chain_health WHERE key = ?`).get(T_CLEAN) as any;
    expect(health?.status).toBe("ok");
    expect(String(health?.detail)).toContain("boot verifier tick: chain verified clean");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §C — APPEND BESIDE, NEVER REWRITE.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W238 §C — historical rows are never rewritten, re-hashed or re-ordered", () => {
  it("C1 — a second tick APPENDS; the first row's every byte is unchanged", async () => {
    const before = historyRows(T_CLEAN);
    expect(before.length).toBe(1);
    const snapshot = JSON.stringify(before[0]);

    const { runAuditChainBootVerifier } = await import("../lib/hydrateStores");
    await runAuditChainBootVerifier({ maxTenants: Infinity });

    const after = historyRows(T_CLEAN);
    expect(after.length).toBe(2);
    /* Same id, same counts, same timestamps, same details_json — identical row. */
    expect(JSON.stringify(after[0])).toBe(snapshot);
    expect(after[1].id).not.toBe(after[0].id);
  });

  it("C2 — the insert has NO ON CONFLICT clause: an update of a history row is not expressible", () => {
    const raw = readSource("server/lib/hydrateStores.ts");
    const src = stripComments(raw);
    /* STRIPPER SANITY CHECK, both directions. Every "WAVE 238" marker in this
       file is inside a comment, so it must be present before stripping and
       absent after. A stripper that silently did nothing would make the
       ON CONFLICT assertions below pass over commented-out text. */
    expect(raw).toContain("WAVE 238");
    expect(src).not.toContain("WAVE 238");
    expect(src).not.toContain("Wave A-1 v2.3 (Opus v2.2 P3-A)");
    expect(src).toContain("INSERT INTO audit_chain_verifications");
    const insert = src.slice(src.indexOf("INSERT INTO audit_chain_verifications"));
    const stmtEnd = insert.indexOf("`", insert.indexOf("VALUES"));
    const stmt = insert.slice(0, stmtEnd);
    expect(stmt).not.toMatch(/ON CONFLICT/i);
    expect(stmt).not.toMatch(/DO UPDATE/i);
    expect(src).not.toMatch(/UPDATE\s+audit_chain_verifications/i);
  });

  it("C3 — retention is BOUNDED, and a row that recorded a break is never pruned", async () => {
    const db = rawDb();
    const N = AUDIT_CHAIN_HISTORY_RETENTION_PER_KEY;
    /* One clean audit_log row so the boot verifier visits this tenant. */
    const h = v1Hash("0".repeat(64), "aud_w238_retain");
    insertAudit(T_RETAIN, "aud_w238_retain", "0".repeat(64), h);

    /* N + 10 superseded CLEAN history rows, plus ONE that recorded a break —
       the oldest row in the table, and the one that must survive. */
    db.prepare(
      `INSERT INTO audit_chain_verifications
         (id, tenant_id, chapter_id, table_name, verified_count, broken_count, broken_first_id,
          total_rows, duration_ms, started_at, finished_at, details_json)
       VALUES (?, ?, NULL, ?, 0, 1, NULL, 1, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z', ?)`,
    ).run("acv_w238_incident_2026_08_10", T_RETAIN, AUDIT_LOG_CHAIN_TABLE, JSON.stringify({ verifier: "verifyTenantAuditChain", ok: false }));
    for (let i = 0; i < N + 10; i++) {
      db.prepare(
        `INSERT INTO audit_chain_verifications
           (id, tenant_id, chapter_id, table_name, verified_count, broken_count, broken_first_id,
            total_rows, duration_ms, started_at, finished_at, details_json)
         VALUES (?, ?, NULL, ?, 1, 0, NULL, 1, 1, ?, ?, ?)`,
      ).run(
        `acv_w238_old_${String(i).padStart(4, "0")}`,
        T_RETAIN,
        AUDIT_LOG_CHAIN_TABLE,
        `2026-08-11T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
        `2026-08-11T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
        JSON.stringify({ verifier: "verifyTenantAuditChain", ok: true }),
      );
    }
    expect(historyRows(T_RETAIN).length).toBe(N + 11);

    const { runAuditChainBootVerifier } = await import("../lib/hydrateStores");
    await runAuditChainBootVerifier({ maxTenants: Infinity });

    const rows = historyRows(T_RETAIN);
    const clean = rows.filter((r) => Number(r.broken_count) === 0);
    const broke = rows.filter((r) => Number(r.broken_count) > 0);
    /* Bounded: exactly N clean rows, including the one just written. */
    expect(clean.length).toBe(N);
    /* The break record survives, unmodified, however old it is. */
    expect(broke.length).toBe(1);
    expect(broke[0].id).toBe("acv_w238_incident_2026_08_10");
    expect(broke[0].started_at).toBe("2026-08-10T00:00:00.000Z");
    /* And the row that was pruned was an OLD clean one, not the new one. */
    expect(rows.some((r) => String(r.id).startsWith("acv_w238_old_0000"))).toBe(false);
  });

  it("C4 — the prune is scoped to clean rows only; the DELETE cannot reach a break record", () => {
    const src = stripComments(readSource("server/lib/hydrateStores.ts"));
    const del = src.slice(src.indexOf("DELETE FROM audit_chain_verifications"));
    const stmt = del.slice(0, del.indexOf("`", 10));
    expect(stmt).toContain("broken_count = 0");
    expect(stmt).toContain("ORDER BY started_at DESC");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §D — FIX C: THE audit_log ROUTE REACHES THE CANONICAL VERIFIER, AND ONLY IT.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W238 §D — one table moved to the canonical verifier; twenty-two did not", () => {
  it("D1 — GENESIS: a re-anchored ledger the TWIN calls broken is reported CLEAN, because the canonical verifier ran", async () => {
    /* Proof the fixture really does divide the two verifiers: run the twin
       directly and watch it break at index 0. */
    const actual = await import("../lib/auditChainVerifier");
    const twinResult = actual.verifyChainForTable(AUDIT_LOG_CHAIN_TABLE, { tenantId: T_CLEAN });
    expect(twinResult.broken_at_row_id).toBe(CLEAN_A);
    expect(twinResult.broken_at_index).toBe(0);

    twin.calls.length = 0;
    const r = await req("GET", `/api/admin/audit/verify-chain?table=${AUDIT_LOG_CHAIN_TABLE}&chapter_id=${CHAPTER_CLEAN}`, ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.result.table).toBe(AUDIT_LOG_CHAIN_TABLE);
    /* The canonical verdict: clean. This is the assertion that goes red if the
       route falls back to the twin. */
    expect(r.body.result.broken_at_row_id).toBeNull();
    expect(r.body.result.broken_at_index).toBeNull();
    expect(r.body.result.total_rows).toBe(2);
    expect(r.body.result.verified).toBe(1);
    /* CALL COUNT ON THE TWIN: it was not called for audit_log at all. */
    expect(twin.calls).not.toContain(AUDIT_LOG_CHAIN_TABLE);
    expect(twin.calls).toEqual([]);
  });

  it("D2 — a genuinely broken audit_log chain still reports BROKEN, with a REAL row id", async () => {
    const r = await req("GET", `/api/admin/audit/verify-chain?table=${AUDIT_LOG_CHAIN_TABLE}&chapter_id=${CHAPTER_BROKEN}`, ADMIN);
    expect(r.status).toBe(200);
    const res = r.body.result;
    /* AuditChainVerifyPage derives `ok: broken_at_row_id === null`. A null here
       for a broken chain would paint a green verdict over a real break. */
    expect(res.broken_at_row_id).toBe(BROKEN_C);
    expect(res.broken_at_index).toBe(2);
    expect(res.verified).toBe(2);
    expect(res.total_rows).toBe(3);
    /* Not fabricated: the verifier does not report a field hint, so it is NULL. */
    expect(res.first_bad_field_hint).toBeNull();
    /* Real, and read from the same rows the verifier walks. */
    expect(res.last_known_good_hash).toBe(brokenBHash);
  });

  it("D3 — NON-REGRESSION: another catalog table still reaches the TWIN, proved by call count", async () => {
    twin.calls.length = 0;
    const r = await req("GET", `/api/admin/audit/verify-chain?table=dsc_votes&chapter_id=${CHAPTER_CLEAN}`, ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.result.table).toBe("dsc_votes");
    expect(twin.calls).toEqual(["dsc_votes"]);
  });

  it("D4 — the twin is still the verifier for every table except audit_log", () => {
    const src = stripComments(readSource("server/auditChainRoutes.ts"));
    expect(src).toContain("verifyChainForTable(table, {");
    expect(src).toMatch(/table === AUDIT_LOG_CHAIN_TABLE/);
    /* One branch, one literal-free comparison — the table name comes from the
       shared constant, so writer and router cannot drift apart. */
    expect((src.match(/AUDIT_LOG_CHAIN_TABLE/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/table === ["']audit_log["']/);
  });

  it("D5 — verify-all is UNCHANGED and still sweeps the catalog through the twin; wave 238 does not claim otherwise", async () => {
    const src = stripComments(readSource("server/auditChainRoutes.ts"));
    expect(src).toContain("verifyAllChains({");
    /* And the corrected comment says so out loud, so nobody reads a verify-all
       audit_log verdict as re-based. */
    expect(readSource("server/lib/auditChainVerifier.ts")).toContain("Treat a verify-all audit_log verdict as UNRE-BASED.");
  });

  it("D6 — an unknown table is still refused, and a broken chain never becomes a 200 with a null id", async () => {
    const r = await req("GET", `/api/admin/audit/verify-chain?table=not_a_table&chapter_id=${CHAPTER_CLEAN}`, ADMIN);
    expect(r.status).toBe(404);
    const src = stripComments(readSource("server/auditChainRoutes.ts"));
    /* The refusal path: rather than return a result the screen would render
       green, the mapper throws. */
    expect(src).toContain("Refusing to return a result that would ");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §E — THE MANDATORY FILTER CHECK.

   The writer writes `table_name`; the reader filters on `?table=`. If those two
   strings ever disagree the history is invisible while both halves look
   correct. They come from ONE shared constant, and this section reads the
   history back over REAL HTTP using that constant.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W238 §E — writer and reader agree on the table name, from one constant", () => {
  it("E1 — the history route, filtered by the shared constant, returns the rows the writer wrote", async () => {
    const r = await req("GET", `/api/admin/audit/verification-history?table=${AUDIT_LOG_CHAIN_TABLE}&limit=500`, ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const mine = (r.body.rows as Array<any>).filter((x) => x.tenantId === T_CLEAN);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    for (const row of mine) {
      expect(row.tableName).toBe(AUDIT_LOG_CHAIN_TABLE);
      expect(JSON.parse(String(row.detailsJson)).verifier).toBe(AUDIT_CHAIN_VERIFIER_CANONICAL);
    }
  });

  it("E2 — the screen no longer says 'No past verifications recorded.' for a chain that has been verified", async () => {
    const r = await req("GET", `/api/admin/audit/verification-history?table=${AUDIT_LOG_CHAIN_TABLE}&limit=500`, ADMIN);
    expect((r.body.rows as Array<any>).length).toBeGreaterThan(0);
  });

  it("E3 — both the writer and the router import the name from shared/auditChainHistory", () => {
    for (const f of ["server/lib/hydrateStores.ts", "server/auditChainRoutes.ts"]) {
      const src = stripComments(readSource(f));
      expect(src).toMatch(/AUDIT_LOG_CHAIN_TABLE/);
      expect(src).toMatch(/shared\/auditChainHistory/);
      /* No private literal of its own in the SQL the writer runs. */
    }
    const writer = stripComments(readSource("server/lib/hydrateStores.ts"));
    const insert = writer.slice(writer.indexOf("INSERT INTO audit_chain_verifications"));
    expect(insert.slice(0, 1200)).not.toMatch(/["']audit_log["']/);
  });

  it("E4 — the shared constant IS the string the schema and the catalog use", () => {
    expect(AUDIT_LOG_CHAIN_TABLE).toBe("audit_log");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §F — R220.4: THE QUARTERLY TWIN JOB IS STILL UNWIRED.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W238 §F — the false-redding quarterly job was not wired to anything", () => {
  const jobExports = ["startAuditChainQuarterlyJob", "runAuditChainQuarterlySweep"];

  it("F1 — neither quarterly entry point has a single caller anywhere in the tree", () => {
    const dirs = ["client/src", "server", "shared", "scripts"];
    const hits: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === "public" || e.name === "dist") continue;
          walk(rel);
        } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
          if (rel === "server/jobs/auditChainQuarterly.ts") continue;
          if (rel.includes("__tests__")) continue;
          const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
          for (const n of jobExports) if (src.includes(n)) hits.push(`${rel}:${n}`);
        }
      }
    };
    for (const d of dirs) walk(d);
    expect(hits).toEqual([]);
  });

  it("F2 — wave 238's writer does not import the twin, the job, or the job's module", () => {
    const src = stripComments(readSource("server/lib/hydrateStores.ts"));
    expect(src).not.toContain("auditChainQuarterly");
    expect(src).not.toContain("verifyChainForTable");
    expect(src).not.toContain("startAuditChainQuarterlyJob");
    expect(src).toContain("verifyTenantAuditChain");
  });

  it("F3 — Fix E: the comment that falsely claimed all three endpoints used the re-base is gone", () => {
    const src = readSource("server/lib/auditChainVerifier.ts");
    /* The false sentence, in the exact wrapped form it had in the file. */
    expect(src).not.toContain("(which is what all");
    expect(src).not.toContain("three audit-log verifier endpoints now do post-Wave A-1 v2");
    expect(src).toContain("That was NOT TRUE when it was written");
    expect(src).toContain("as of wave 238 (was this walker before)");
    /* The original comment KEEPS everything that was true, so the pre-existing
       1500-character window assertion in wave_a1_adr3_audit_chain.test.ts:257
       still finds all four of its tokens. The correction is placed AFTER the
       audit_log catalog entry for exactly that reason: dropping 1.1kB of new
       comment inside the entry pushed `genesisHashes` out of that window and
       turned that neighbour red. Asserted here so it cannot silently drift. */
    const idx = src.indexOf('name: "audit_log"');
    const window = src.slice(idx, idx + 1500);
    expect(window).toMatch(/chain_genesis/i);
    expect(window).toMatch(/verifyTenantAuditChain/);
    expect(window).toMatch(/GENESIS/);
    expect(window).toMatch(/"0"\.repeat\(64\)/);
  });

  it("F4 — the canonical verifier and the twin were CALLED, never edited", () => {
    /* Both verifier bodies keep their pre-wave shape: wave 238 adds no
       parameter, no return field and no behaviour to either. */
    expect(readSource("server/adminPlatformStore.ts")).not.toContain("WAVE 238");
    const twinSrc = readSource("server/lib/auditChainVerifier.ts");
    /* The only wave-238 edit to the twin's file is inside a comment. */
    expect(stripComments(twinSrc)).not.toContain("WAVE 238");
    expect(stripComments(twinSrc)).not.toContain("238");
  });
});
