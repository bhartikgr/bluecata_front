/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 181 — THE AUDIT LOG WAS NEVER SILENT. THE SCREEN WAS.
 * R148.3 item 2 (audit gap) + R148.3 item 1 (bridge `CHAIN ✗ BROKEN AT #0`).
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE REPORT: `/admin/audit-log`, filtered 2026-08-25 → 2026-08-27, answered
 * "No audit entries match the current filters — 0 of 1314 total entries", and
 * the newest entry visible anywhere in the log read 26 May 2026 — while that
 * same day, on live, an SPV was created, an LP was invited, an LP committed
 * $9,000,000, a company was created, a CRM contact was created and a post was
 * published.
 *
 * THE FINDING: none of that was a write failure. Two read defects:
 *
 *   R1  `GET /api/admin/audit-log` ordered `created_at ASC` and the page asks
 *       for limit=100&offset=0 — so page 1 was the OLDEST 100 of 1314 rows and
 *       the "most recent entry in the whole log" was the 100th-OLDEST row.
 *   R2  `from`/`to` were never sent to the server. They were applied in a
 *       browser `useMemo` over the already-fetched page, while `total` was
 *       counted WITHOUT them. That is how a screen comes to report "0 of 1314":
 *       the 0 and the 1314 were computed over different row sets.
 *
 * Every test below is written so that it FAILS on the pre-wave-181 code. The
 * central one (§1) is the owner's stated acceptance criterion: insert a row
 * dated today, assert the DEFAULT view shows it. Each test's revert-proof is
 * recorded in build_log/wave181/W181_TESTS.md.
 *
 * The fixtures deliberately insert MORE THAN ONE PAGE of older rows. A test with
 * five rows in the table passes under both the old and new ordering and would
 * prove nothing — the bug only appears once the table is bigger than the page.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import {
  _testBridge,
  emitBridgeEvent,
  getOutbox,
} from "../bridgeStore";
import {
  resolveSpvAuditActor,
  UNRESOLVED_ACTOR,
} from "../lib/spvLifecycleAudit";

let app: Express;
let server: http.Server;
let port: number;

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

/** Strip block and line comments before drawing ANY conclusion from source text.
 *  Both assertions in the two tests below FIRST FAILED because this module's own
 *  prose says "never a bare `catch {}`" and "never calls `Number()`" — i.e. the
 *  documentation of the rule matched the search for violations of the rule. That
 *  is the standing grep hazard on this codebase, and it is why the stripper is
 *  itself verified below rather than trusted. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const TENANT = "tnt_w181";
const OTHER_TENANT = "tnt_w181_other";
const ADMIN = { "x-user-id": "u_admin" };

/** Today, in UTC, as the page's date inputs would submit it. */
const TODAY = new Date().toISOString().slice(0, 10);
/** An instant today that is unambiguously inside the UTC day. */
const TODAY_NOON = `${TODAY}T12:00:00.000Z`;
/** The last representable instant of today, UTC — the boundary an inclusive
 *  `to` must still admit. Wrong boundary handling here would silently drop the
 *  most recent hours of the log, which is a quieter version of the same bug. */
const TODAY_LAST_MS = `${TODAY}T23:59:59.999Z`;

/** Insert an audit_log row directly. Deliberately RAW: these tests must be able
 *  to place a row at an arbitrary timestamp, which `appendAudit` (correctly)
 *  refuses to do because it stamps `created_at` itself. This is TEST FIXTURE
 *  DATA in an in-memory DB — it is NOT a backfill of the production log, and
 *  wave 181 writes no historical rows anywhere. */
function insertAuditRow(o: { id: string; ts: string; actor?: string; action?: string; target?: string; tenantId?: string }): void {
  rawDb().prepare(
    `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, target_id, payload_json, prev_hash, hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    o.id,
    o.tenantId ?? TENANT,
    o.actor ?? "u_w181_actor",
    o.action ?? "w181.fixture",
    o.target ?? "platform:w181",
    null,
    JSON.stringify({ w181: true }),
    "",
    `hash_${o.id}`,
    o.ts,
  );
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, () => { port = (server.address() as { port: number }).port; r(); }));

  /* ── THE FIXTURE THAT REPRODUCES THE REPORTED SYMPTOM ──────────────────
     140 OLD rows (more than one 100-row page) and exactly 3 rows dated today.
     Under the pre-wave-181 read, page 1 is the oldest 100 — every one of them
     old — so a range covering today matches nothing while `total` still counts
     143. That is R148.3 item 2, in miniature. */
  for (let i = 0; i < 140; i++) {
    const day = String((i % 27) + 1).padStart(2, "0");
    insertAuditRow({
      id: `aud_w181_old_${String(i).padStart(4, "0")}`,
      /* 2026-05 and earlier — the same era as the "26 May 2026" the owner saw. */
      ts: `2026-0${i % 2 === 0 ? "4" : "5"}-${day}T0${i % 10}:00:00.000Z`,
    });
  }
  insertAuditRow({ id: "aud_w181_today_a", ts: TODAY_NOON, action: "w181.today.commit" });
  insertAuditRow({ id: "aud_w181_today_b", ts: TODAY_LAST_MS, action: "w181.today.edge" });
  insertAuditRow({ id: "aud_w181_today_c", ts: `${TODAY}T00:00:00.000Z`, action: "w181.today.midnight" });
  /* A row in a DIFFERENT tenant, dated today, so the tenantId regression test
     below is meaningful rather than vacuous. */
  insertAuditRow({ id: "aud_w181_today_other", ts: TODAY_NOON, tenantId: OTHER_TENANT, action: "w181.today.other" });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * §1 — THE OWNER'S ACCEPTANCE CRITERION.
 * "Prove with a test that inserts a row dated today and asserts the default
 *  view shows it."
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W181 §1 — a row dated today appears in the DEFAULT view", () => {
  it("the default page the admin screen requests (limit=100&offset=0, no filters) contains today's rows", async () => {
    const r = await req("GET", "/api/admin/audit-log?limit=100&offset=0", undefined, ADMIN);
    expect(r.status).toBe(200);
    const ids = (r.body.items as Array<{ id: string }>).map((x) => x.id);
    /* PRE-WAVE-181: page 1 was the oldest 100 rows and NONE of these appeared. */
    expect(ids).toContain("aud_w181_today_a");
    expect(ids).toContain("aud_w181_today_b");
    expect(ids).toContain("aud_w181_today_c");
  });

  it("the FIRST row of the default page is the newest row in the table, not the oldest", async () => {
    const r = await req("GET", "/api/admin/audit-log?limit=100&offset=0", undefined, ADMIN);
    const items = r.body.items as Array<{ ts: string }>;
    expect(items.length).toBeGreaterThan(0);
    const maxTs = rawDb()
      .prepare("SELECT MAX(created_at) AS m FROM audit_log WHERE deleted_at IS NULL")
      .get() as { m: string };
    expect(items[0].ts).toBe(maxTs.m);
  });

  it("the page is ordered newest-first and the server SAYS so", async () => {
    const r = await req("GET", "/api/admin/audit-log?limit=100&offset=0", undefined, ADMIN);
    expect(r.body.order).toBe("desc");
    const ts = (r.body.items as Array<{ ts: string }>).map((x) => x.ts);
    const descending = [...ts].sort((a, b) => b.localeCompare(a));
    expect(ts).toEqual(descending);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * §2 — THE DATE RANGE REACHES THE DATABASE.
 * The exact filter the owner applied must now find the rows it should find,
 * and `total` must be counted over the SAME set as the rows returned.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W181 §2 — from/to are SQL filters, applied before paging", () => {
  it("filtering to today returns today's rows (the owner's filter, now working)", async () => {
    const r = await req("GET", `/api/admin/audit-log?from=${TODAY}&to=${TODAY}&limit=100&offset=0`, undefined, ADMIN);
    expect(r.status).toBe(200);
    const ids = (r.body.items as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain("aud_w181_today_a");
    expect(ids).toContain("aud_w181_today_c");
  });

  it("`total` is counted WITH the range — the '0 of 1314' contradiction is structurally impossible now", async () => {
    const r = await req("GET", `/api/admin/audit-log?from=${TODAY}&to=${TODAY}&limit=100&offset=0`, undefined, ADMIN);
    const ranged = rawDb().prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?",
    ).get(`${TODAY}T00:00:00.000Z`, new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() + 86_400_000).toISOString()) as { n: number };
    const unranged = rawDb().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE deleted_at IS NULL").get() as { n: number };
    /* The whole point: `total` follows the filter. */
    expect(r.body.total).toBe(ranged.n);
    expect(r.body.total).toBeLessThan(unranged.n);
    /* And a non-zero count can never sit beside zero rows. */
    expect(r.body.count).toBeGreaterThan(0);
    expect(r.body.total).toBeGreaterThan(0);
  });

  it("`to` is INCLUSIVE of the whole UTC day — 23:59:59.999 is not silently dropped", async () => {
    const r = await req("GET", `/api/admin/audit-log?from=${TODAY}&to=${TODAY}&limit=100&offset=0`, undefined, ADMIN);
    const ids = (r.body.items as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain("aud_w181_today_b"); // ts = 23:59:59.999Z
    expect(r.body.rangeToExclusive).toBe(
      new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() + 86_400_000).toISOString(),
    );
  });

  it("the range EXCLUDES rows outside it — the filter filters, it is not a no-op", async () => {
    const r = await req("GET", `/api/admin/audit-log?from=${TODAY}&to=${TODAY}&limit=1000&offset=0`, undefined, ADMIN);
    const ids = (r.body.items as Array<{ id: string }>).map((x) => x.id);
    expect(ids).not.toContain("aud_w181_old_0000");
    expect(ids.some((i) => i.startsWith("aud_w181_old_"))).toBe(false);
  });

  it("the applied window is REPORTED, so the screen cannot describe a filter it did not run", async () => {
    const r = await req("GET", `/api/admin/audit-log?from=${TODAY}&to=${TODAY}`, undefined, ADMIN);
    expect(r.body.rangeFrom).toBe(`${TODAY}T00:00:00.000Z`);
    expect(String(r.body.rangeBasis)).toContain("UTC");
  });

  it("an UNPARSEABLE date is refused and reported — never silently widened to 'everything'", async () => {
    const r = await req("GET", "/api/admin/audit-log?from=not-a-date&limit=5", undefined, ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.rangeRejected).toContain("from");
    expect(r.body.rangeFrom).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * §3 — REGRESSIONS. The filters that already worked must still work, and the
 * ascending order the chain-walking code depends on must remain reachable.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W181 §3 — nothing that worked before was traded away", () => {
  it("order=asc is still available and still ascending (chain-order callers keep their view)", async () => {
    const r = await req("GET", "/api/admin/audit-log?order=asc&limit=100&offset=0", undefined, ADMIN);
    expect(r.body.order).toBe("asc");
    const ts = (r.body.items as Array<{ ts: string }>).map((x) => x.ts);
    expect(ts).toEqual([...ts].sort((a, b) => a.localeCompare(b)));
  });

  it("?tenantId= still filters (Wave A-1 ADR-3 action 5) and now composes with the range", async () => {
    const r = await req("GET", `/api/admin/audit-log?tenantId=${OTHER_TENANT}&from=${TODAY}&to=${TODAY}&limit=100`, undefined, ADMIN);
    const ids = (r.body.items as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain("aud_w181_today_other");
    expect(ids).not.toContain("aud_w181_today_a");
  });

  it("?eventType= still filters (the LifecyclePolicies 'Edits (30d)' consumer)", async () => {
    const r = await req("GET", "/api/admin/audit-log?eventType=w181.today.commit&limit=100", undefined, ADMIN);
    const actions = (r.body.items as Array<{ eventType: string }>).map((x) => x.eventType);
    expect(actions.length).toBeGreaterThan(0);
    expect(new Set(actions)).toEqual(new Set(["w181.today.commit"]));
  });

  it("wave 93's resolved actor/entity labels survive the change", async () => {
    const r = await req("GET", "/api/admin/audit-log?limit=5", undefined, ADMIN);
    const first = (r.body.items as Array<Record<string, unknown>>)[0];
    expect(first).toHaveProperty("actorLabel");
    expect(first).toHaveProperty("entityLabel");
    expect(first).toHaveProperty("actor"); // raw id preserved alongside the label
  });

  it("paging still walks the whole table without repeating or losing rows", async () => {
    const p1 = await req("GET", "/api/admin/audit-log?limit=50&offset=0", undefined, ADMIN);
    const p2 = await req("GET", "/api/admin/audit-log?limit=50&offset=50", undefined, ADMIN);
    const a = (p1.body.items as Array<{ id: string }>).map((x) => x.id);
    const b = (p2.body.items as Array<{ id: string }>).map((x) => x.id);
    expect(a).toHaveLength(50);
    expect(b).toHaveLength(50);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * §4 — THE SCREEN. R137: a fix that never reaches the page an admin opens is
 * not a fix. These assert the CLIENT actually sends the range and renders
 * newest-first, because a correct server behind a client that still filters one
 * page in the browser reproduces the original symptom exactly.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W181 §4 — the fix reaches /admin/audit-log", () => {
  const page = () => require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "..", "client", "src", "pages", "admin", "AuditLog.tsx"), "utf8",
  ) as string;

  it("the page SENDS from/to to the server", () => {
    const src = page();
    expect(src).toMatch(/params\.set\("from"/);
    expect(src).toMatch(/params\.set\("to"/);
  });

  it("fromDate/toDate are in the queryParams dependency array (or the request never refetches)", () => {
    const src = page();
    const deps = src.match(/\}, \[entityPrefix, eventTypeFilter, actorFilter[^\]]*\]/);
    expect(deps).not.toBeNull();
    expect(deps![0]).toContain("fromDate");
    expect(deps![0]).toContain("toDate");
  });

  it("the table renders newest-first", () => {
    const src = page();
    expect(src).toMatch(/all\.sort\(\(a, b\) => b\.ts\.localeCompare\(a\.ts\)\)/);
  });

  it("the page states its ordering and range basis on screen", () => {
    const src = page();
    expect(src).toContain("Newest first");
    expect(src).toContain("UTC day boundaries");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * §5 — ITEM C: `CHAIN ✗ BROKEN AT #0`.
 *
 * The verdict this wave reached: the outbox is the QUEUE, not the chain.
 * `hydrateBridgeStore` restores only queued/delivering/archived, and
 * `clearBridgeOutbox` DELETEs dead_letter rows — so the earliest envelope still
 * in the queue normally does NOT begin at genesis. A break at index 0 therefore
 * means "the walk could not establish a starting point", which is structurally
 * incapable of being evidence of tampering: index 0 has no predecessor in the
 * walked set to disagree with.
 *
 * `ok`, `brokenAt` and `totalLinks` keep their exact previous values in every
 * test below. Only the DIAGNOSIS is new. Chain semantics were not altered.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W181 §5 — the bridge chain badge tells the truth", () => {
  const emit3 = () => {
    _testBridge.resetChain();
    for (let i = 0; i < 3; i++) {
      emitBridgeEvent({
        eventType: "company.created",
        aggregateId: `co_w181_${i}`,
        aggregateKind: "company",
        payload: { i },
      });
    }
  };

  it("an INTACT queue still verifies intact — the diagnosis did not weaken the check", async () => {
    emit3();
    const r = await req("GET", "/api/admin/bridge/verify-chain", undefined, ADMIN);
    expect(r.body.ok).toBe(true);
    expect(r.body.brokenAt).toBe(-1);
    expect(r.body.chainState).toBe("intact");
  });

  it("an EMPTY outbox no longer reports 'INTACT' over zero records", async () => {
    _testBridge.resetChain();
    const r = await req("GET", "/api/admin/bridge/verify-chain", undefined, ADMIN);
    /* Legacy semantics preserved verbatim: broken === -1, so ok is still true. */
    expect(r.body.ok).toBe(true);
    expect(r.body.brokenAt).toBe(-1);
    expect(r.body.totalLinks).toBe(0);
    /* But the state is named honestly, which is the whole fix. */
    expect(r.body.chainState).toBe("empty");
    expect(String(r.body.diagnosis)).toContain("nothing to verify");
  });

  it("a MISSING PREDECESSOR (delivered / dead-letter-cleared) reads as 'starts mid-chain', NOT as tampering", async () => {
    emit3();
    /* Exactly what hydrateBridgeStore + clearBridgeOutbox produce: the front of
       the queue is gone, its hash still referenced by the survivor's priorHash. */
    getOutbox().splice(0, 1);
    const r = await req("GET", "/api/admin/bridge/verify-chain", undefined, ADMIN);
    /* The legacy numbers are UNCHANGED — this is the live symptom, reproduced. */
    expect(r.body.ok).toBe(false);
    expect(r.body.brokenAt).toBe(0);
    /* And it is now correctly diagnosed. */
    expect(r.body.chainState).toBe("no_verifiable_start");
    expect(r.body.selfConsistentAtBreak).toBe(true);
    expect(String(r.body.diagnosis)).toContain("No tampering is indicated");
  });

  it("GENUINE corruption is still reported as broken — the alarm was not disarmed", async () => {
    emit3();
    /* Tamper with the SECOND envelope's hash: its bytes no longer recompute. */
    const box = getOutbox();
    box[1].envelope.auditChain!.hash = "f".repeat(64);
    const r = await req("GET", "/api/admin/bridge/verify-chain", undefined, ADMIN);
    expect(r.body.ok).toBe(false);
    expect(r.body.brokenAt).toBe(1);
    expect(r.body.chainState).toBe("broken");
    expect(String(r.body.diagnosis)).toContain("Escalate");
  });

  it("corruption of the FIRST envelope's own bytes is 'broken', not excused as a missing predecessor", async () => {
    emit3();
    const box = getOutbox();
    /* Break index 0 in a way a pruned predecessor CANNOT produce: its stored
       hash does not recompute from its own stored priorHash. This is the
       adversarial case — the fix must not launder real corruption at index 0. */
    box[0].envelope.auditChain!.priorHash = "a".repeat(64);
    box[0].envelope.auditChain!.hash = "b".repeat(64);
    const r = await req("GET", "/api/admin/bridge/verify-chain", undefined, ADMIN);
    expect(r.body.brokenAt).toBe(0);
    expect(r.body.selfConsistentAtBreak).toBe(false);
    expect(r.body.chainState).toBe("broken");
  });

  it("the Bridge page keeps the genuine-corruption wording byte-verbatim and adds the other states", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "client", "src", "pages", "admin", "Bridge.tsx"), "utf8",
    ) as string;
    /* R143.1 — the original literal is preserved exactly, for the one case where
       it is true. */
    expect(src).toContain("`BROKEN AT #${verify.data?.brokenAt}`");
    expect(src).toContain("INTACT");
    /* And the misleading reading is no longer the only one available. */
    expect(src).toContain("EMPTY · NOTHING TO VERIFY");
    expect(src).toContain("LINKS VERIFY · STARTS MID-CHAIN");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * §6 — ITEM B: the four SPV lifecycle events that were genuinely never audited.
 * "Never invent an actor — if the acting user cannot be resolved, record that
 *  fact explicitly rather than attributing to a placeholder."
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W181 §6 — SPV lifecycle audit writers, and the no-placeholder-actor rule", () => {
  it("a real actor is recorded as resolved, unchanged", () => {
    const a = resolveSpvAuditActor("u_real_gp");
    expect(a.actorId).toBe("u_real_gp");
    expect(a.actorResolved).toBe(true);
    expect(a.actorUnresolvedReason).toBeUndefined();
  });

  it("an ABSENT actor is recorded as UNRESOLVED with a stated reason — never a plausible-looking id", () => {
    for (const bad of [null, undefined, "", "   "]) {
      const a = resolveSpvAuditActor(bad);
      expect(a.actorResolved).toBe(false);
      expect(a.actorId).toBe(UNRESOLVED_ACTOR);
      expect(String(a.actorUnresolvedReason)).toContain("does NOT attribute");
      /* The sentinel must not impersonate any real actor namespace. */
      expect(a.actorId).not.toBe("u_admin");
      expect(a.actorId).not.toBe("u_system");
      expect(a.actorId).not.toBe("u_unknown");
    }
  });

  it("the four writers are wired at the store's own choke points, alongside the existing emit()", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "spvEngineStore.ts"), "utf8",
    ) as string;
    expect(src).toContain("auditSpvCreated({");
    expect(src).toContain("auditSpvFundsConfirmed({");
    expect(src).toContain("auditSpvClosedToNewLps({");
    expect(src).toContain("auditSpvReopened({");
  });

  it("every audit write CHECKS the failure sentinel — an audit write must never fail silently", () => {
    const raw = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "lib", "spvLifecycleAudit.ts"), "utf8",
    ) as string;
    const src = stripComments(raw);
    /* VERIFY THE STRIPPER STRIPPED, before trusting anything it produced. The
       module's prose contains the literal phrase below; code does not. */
    expect(raw).toContain("never a bare `catch {}`");
    expect(src).not.toContain("never a bare");
    expect(src).toContain("isAuditWriteFailure(entry)");
    expect(src).toMatch(/log\.error\?\.\(/);
    /* No bare swallow anywhere in the module's CODE. */
    expect(src).not.toMatch(/catch\s*\{\s*\}/);
    expect(src).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*\}/);
  });

  it("the module performs NO money arithmetic (minor units pass through as strings)", () => {
    const raw = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "lib", "spvLifecycleAudit.ts"), "utf8",
    ) as string;
    const src = stripComments(raw);
    /* Stripper self-check (the module's prose names the banned calls). */
    expect(raw).toMatch(/never calls `Number\(\)`/);
    expect(src).not.toMatch(/never calls/);
    expect(src).not.toMatch(/parseInt\(/);
    expect(src).not.toMatch(/parseFloat\(/);
    /* `Number(` is banned for money; the module's code uses String() only. */
    expect(src).not.toMatch(/[^.\w]Number\(/);
    /* And it does perform the pass-through it claims to. */
    expect(src).toContain("String(input.receivedMinor)");
  });
});
