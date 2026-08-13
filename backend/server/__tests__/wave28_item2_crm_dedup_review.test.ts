/**
 * WAVE 28 · ITEM 2 — CP-CRM-04 · `crm_dedup_review` had zero consumers.
 *
 * ── WHAT WAS MISSING ───────────────────────────────────────────────────────
 * Migration 0097 (v25.52) creates `crm_dedup_review`, writes shared-inbox
 * conflicts into it, and flags every conflicting contact `dedup_exempt = 1` so
 * 0098's partial UNIQUE index skips them. Nothing in `server/` or `client/` ever
 * read or wrote that table — Wave 9's own inventory records it as "migration DDL
 * only" (`0159_wave9_reporting_audit.sql:360`). An engine with no route.
 *
 * ── WHY THIS FILE DOES NOT READ THE SOURCE ─────────────────────────────────
 * A test that asserts "the file `crmDedupReviewStore.ts` exists" or that greps
 * for a route string is exactly the shape of check that passed sixteen times in
 * this build while checking nothing. Every assertion below drives REAL rows
 * through the REAL SQLite database and then reads the result back OUT OF THE DB
 * — never out of the return value of the function that just claimed to write it.
 *
 * ── THE SINK ───────────────────────────────────────────────────────────────
 * The sink for a merge is THREE writes that must all land together:
 *   1. `deleted_at` set on every losing contact row,
 *   2. `dedup_exempt` CLEARED on the survivor (0097's stated contract — this is
 *      what lets 0098's partial UNIQUE index cover the row again),
 *   3. the queue row marked resolved with its outcome.
 * Every one of the three is verified by an independent SELECT, because a
 * function that returned `{ok:true}` after doing only the first two would pass a
 * test that trusted its return value.
 *
 * ── BOTH POLES ─────────────────────────────────────────────────────────────
 *   · merge REMOVES the losers            AND leaves the survivor live
 *   · merge CLEARS the survivor's flag    AND 'distinct' PRESERVES the flags
 *   · detection QUEUES a new conflict     AND does NOT re-queue a settled one
 *   · partner merge is REFUSED            AND partner 'distinct' is ALLOWED
 *   · a refusal returns ok:false          AND changes nothing in the database
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import { signSessionValue, LEGACY_SESSION_COOKIE } from "../lib/sessionCookie";
import {
  ensureCrmDedupReviewSchema,
  CRM_DEDUP_SCOPES,
  listDedupReviews,
  getDedupReview,
  dedupReviewCounts,
  detectDedupConflicts,
  resolveDedupReview,
  reopenDedupReview,
} from "../crmDedupReviewStore";

const CO = "co_w28_dedup";
const INV = "inv_w28_dedup";
const PTR = "ptr_w28_dedup";
const EMAIL = "ops@w28dedup.example";
const adminCookie = `${LEGACY_SESSION_COOKIE}=${signSessionValue("u_admin")}`;

function db() {
  return rawDb() as {
    prepare: (sql: string) => { get: (...a: unknown[]) => any; all: (...a: unknown[]) => any[]; run: (...a: unknown[]) => any };
    exec: (sql: string) => void;
  };
}

/** Read a contact row straight from SQLite. Never from a store return value. */
function readContact(table: string, id: string): { deleted_at: unknown; dedup_exempt: unknown } | undefined {
  return db().prepare(`SELECT deleted_at, dedup_exempt FROM ${table} WHERE id = ?`).get(id);
}

function readReviewRaw(id: string): Record<string, unknown> | undefined {
  return db().prepare(`SELECT * FROM crm_dedup_review WHERE id = ?`).get(id);
}

function insertContact(table: string, scopeCol: string, scopeVal: string, id: string, name: string, exempt: 0 | 1): void {
  const cols = db().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
  const names = new Set(cols.map((c) => c.name));
  const row: Record<string, unknown> = {
    id,
    [scopeCol]: scopeVal,
    name,
    email: EMAIL,
    created_at: new Date().toISOString(),
    dedup_exempt: exempt,
  };
  // Satisfy any NOT NULL column without a default that we do not know about,
  // so this fixture keeps working as the CRM tables grow columns.
  for (const c of cols) {
    if (c.notnull === 1 && c.dflt_value === null && !(c.name in row)) row[c.name] = "";
  }
  const keys = Object.keys(row).filter((k) => names.has(k));
  db()
    .prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .run(...keys.map((k) => row[k]));
}

/**
 * Insert a crm_dedup_review row directly.
 *
 * Needed for the PARTNER cases because of the defect pinned in case (15): the
 * inline baseline's `uq_partner_crm_email_parity` index makes two LIVE partner
 * rows sharing an email impossible on this database, so partner conflicts cannot
 * be manufactured through the contacts table. On a legacy database that predates
 * that index they exist and 0097 wrote exactly these rows, so this is the honest
 * fixture for the state the refusal path has to handle.
 */
function insertReviewRow(id: string, scope: string, scopeId: string, ids: string[], names: string[]): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO crm_dedup_review
         (id, crm_scope, scope_id, email_norm, contact_ids, distinct_names, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(id, scope, scopeId, EMAIL, JSON.stringify(ids), JSON.stringify(names), new Date().toISOString());
}

function wipeFixture(): void {
  db().prepare(`DELETE FROM crm_dedup_review WHERE email_norm = ?`).run(EMAIL);
  db().prepare(`DELETE FROM founder_crm_contacts WHERE company_id = ?`).run(CO);
  db().prepare(`DELETE FROM investor_crm_contacts WHERE investor_id = ?`).run(INV);
  db().prepare(`DELETE FROM partner_crm_contacts WHERE partner_id = ?`).run(PTR);
}

type DedupReviewWire = { id: string; scopeId: string; members: Array<{ contactId: string }> };

let app: Express;
let server: http.Server;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  // readSessionCookie() reads req.cookies, which supertest does not populate.
  // Same inline parser used by v25_49_3_partner_persona.test.ts. Without it the
  // admin cookie below silently resolves to anonymous and every "as admin"
  // assertion would be testing the 403 path while claiming to test the 200 one.
  app.use((req, _res, next) => {
    const r = req as typeof req & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const header = req.headers.cookie;
      const out: Record<string, string> = {};
      if (typeof header === "string" && header.length > 0) {
        for (const part of header.split(";")) {
          const eq = part.indexOf("=");
          if (eq === -1) continue;
          const k = part.slice(0, eq).trim();
          const v = part.slice(eq + 1).trim();
          if (k.length > 0) {
            try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
          }
        }
      }
      r.cookies = out;
    }
    next();
  });
  server = http.createServer(app);
  await registerRoutes(server, app);
  // The test database is built from connection.ts's inline baseline, which does
  // NOT contain crm_dedup_review or dedup_exempt (see the A-22 note in
  // crmDedupReviewStore.ts — 15/15 of these cases failed on "no such table"
  // before that was found). Calling the ensure explicitly here means the harness
  // fails LOUDLY if self-heal ever stops working, rather than each case failing
  // with a confusing SQL error.
  ensureCrmDedupReviewSchema(true);
});

beforeEach(() => {
  wipeFixture();
});

describe("WAVE 28 ITEM 2 — CP-CRM-04 dedup review queue", () => {
  // ── (0) CONTROL. If this fails, every other case in the file is vacuous. ──
  it("(0) CONTROL — the fixture really creates colliding live rows, and the harness can see them", () => {
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 1);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "Bob Brown", 1);
    const live = db()
      .prepare(`SELECT id FROM founder_crm_contacts WHERE company_id = ? AND deleted_at IS NULL`)
      .all(CO);
    expect(live.map((r: any) => r.id).sort()).toEqual(["c_a", "c_b"]);
    // Negative pole: the harness must also be able to observe ABSENCE.
    wipeFixture();
    expect(
      db().prepare(`SELECT id FROM founder_crm_contacts WHERE company_id = ?`).all(CO),
    ).toHaveLength(0);
  });

  // ── (1) The table now has consumers, proven by using them, not by grepping. ──
  it("(1) the queue is readable and counted from SQL, and reflects a row inserted behind its back", () => {
    const before = dedupReviewCounts().open;
    db()
      .prepare(
        `INSERT INTO crm_dedup_review (id, crm_scope, scope_id, email_norm, contact_ids, distinct_names, status, created_at)
         VALUES ('ddr_w28_probe','founder',?,?,'["c_a","c_b"]','["Alice Adams","Bob Brown"]','open',?)`,
      )
      .run(CO, EMAIL, new Date().toISOString());
    expect(dedupReviewCounts().open).toBe(before + 1);
    const found = listDedupReviews({ status: "open" }).find((r) => r.id === "ddr_w28_probe");
    expect(found).toBeDefined();
    expect(found?.emailNorm).toBe(EMAIL);
    // Negative pole: it must NOT appear in the resolved view.
    expect(listDedupReviews({ status: "resolved" }).some((r) => r.id === "ddr_w28_probe")).toBe(false);
  });

  // ── (2) Detection: queues a real conflict. ──
  it("(2) detection queues a founder conflict that did not exist before, and flags its rows exempt", () => {
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 0);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "Bob Brown", 0);
    expect(listDedupReviews({ status: "all" }).filter((r) => r.scopeId === CO)).toHaveLength(0);

    const result = detectDedupConflicts();
    expect(result.inserted).toBeGreaterThanOrEqual(1);

    const queued = listDedupReviews({ status: "open" }).filter((r) => r.scopeId === CO);
    expect(queued).toHaveLength(1);
    expect(queued[0].contactIds.sort()).toEqual(["c_a", "c_b"]);
    // The flag write is a SEPARATE sink — read it back from the table.
    expect(Number(readContact("founder_crm_contacts", "c_a")?.dedup_exempt)).toBe(1);
    expect(Number(readContact("founder_crm_contacts", "c_b")?.dedup_exempt)).toBe(1);
  });

  // ── (3) Detection negative pole: same NAME is not a conflict for founder/investor. ──
  it("(3) detection does NOT queue same-name founder duplicates (0097 safe-collapses those)", () => {
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 0);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "alice adams", 0);
    detectDedupConflicts();
    expect(listDedupReviews({ status: "all" }).filter((r) => r.scopeId === CO)).toHaveLength(0);
  });

  // ── (4) Idempotence, both poles. ──
  it("(4) a second scan does not duplicate an open entry, and a settled 'distinct' verdict is never re-queued", () => {
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 0);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "Bob Brown", 0);
    detectDedupConflicts();
    const first = listDedupReviews({ status: "open" }).filter((r) => r.scopeId === CO);
    expect(first).toHaveLength(1);

    const second = detectDedupConflicts();
    expect(second.alreadyOpen).toBeGreaterThanOrEqual(1);
    expect(listDedupReviews({ status: "open" }).filter((r) => r.scopeId === CO)).toHaveLength(1);

    // Settle it as "different people", then rescan. Without migration 0175's
    // `resolution` column this is the case that makes the queue unclearable.
    const r = resolveDedupReview({ reviewId: first[0].id, action: "distinct", actor: "tester" });
    expect(r.ok).toBe(true);
    const third = detectDedupConflicts();
    expect(third.skippedSettled).toBeGreaterThanOrEqual(1);
    expect(listDedupReviews({ status: "open" }).filter((r2) => r2.scopeId === CO)).toHaveLength(0);
  });

  // ── (5) Membership change RE-queues. The other pole of (4). ──
  it("(5) a settled group whose membership CHANGES is re-queued, because the old verdict no longer describes it", () => {
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 0);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "Bob Brown", 0);
    detectDedupConflicts();
    const rv = listDedupReviews({ status: "open" }).filter((r) => r.scopeId === CO)[0];
    resolveDedupReview({ reviewId: rv.id, action: "distinct", actor: "tester" });
    expect(listDedupReviews({ status: "open" }).filter((r) => r.scopeId === CO)).toHaveLength(0);

    insertContact("founder_crm_contacts", "company_id", CO, "c_c", "Carol Chen", 0);
    const after = detectDedupConflicts();
    expect(after.inserted).toBeGreaterThanOrEqual(1);
    const reopened = listDedupReviews({ status: "open" }).filter((r) => r.scopeId === CO);
    expect(reopened).toHaveLength(1);
    expect(reopened[0].contactIds.sort()).toEqual(["c_a", "c_b", "c_c"]);
  });

  // ── (6) MERGE — all three sinks, each read back from SQLite. ──
  it("(6) merge soft-deletes the losers, keeps the survivor live, and CLEARS the survivor's dedup_exempt", () => {
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 1);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "Bob Brown", 1);
    detectDedupConflicts();
    const rv = listDedupReviews({ status: "open" }).filter((r) => r.scopeId === CO)[0];

    // Pre-state, from the DB.
    expect(readContact("founder_crm_contacts", "c_a")?.deleted_at).toBeNull();
    expect(Number(readContact("founder_crm_contacts", "c_a")?.dedup_exempt)).toBe(1);
    expect(Number(readContact("founder_crm_contacts", "c_b")?.dedup_exempt)).toBe(1);

    const res = resolveDedupReview({ reviewId: rv.id, action: "merge", survivorId: "c_a", actor: "tester", note: "same person" });
    expect(res.ok).toBe(true);

    // SINK 1 — loser soft-deleted.
    expect(readContact("founder_crm_contacts", "c_b")?.deleted_at).not.toBeNull();
    // SINK 1, other pole — survivor still live.
    expect(readContact("founder_crm_contacts", "c_a")?.deleted_at).toBeNull();
    // SINK 2 — 0097's contract: the flag is CLEARED so 0098's index covers it.
    expect(readContact("founder_crm_contacts", "c_a")?.dedup_exempt).toBeNull();
    // SINK 3 — the queue row records the outcome, read raw.
    const raw = readReviewRaw(rv.id)!;
    expect(raw.status).toBe("resolved");
    expect(raw.resolution).toBe("merged");
    expect(raw.survivor_id).toBe("c_a");
    expect(raw.resolution_note).toBe("same person");
    expect(raw.resolved_by).toBe("tester");
    expect(raw.resolved_at).toBeTruthy();
  });

  // ── (7) DISTINCT — the OPPOSITE outcome. Nothing deleted, no flag cleared. ──
  it("(7) 'distinct' deletes nothing and PRESERVES dedup_exempt on every live row", () => {
    insertContact("investor_crm_contacts", "investor_id", INV, "i_a", "Alice Adams", 0);
    insertContact("investor_crm_contacts", "investor_id", INV, "i_b", "Bob Brown", 0);
    detectDedupConflicts();
    const rv = listDedupReviews({ status: "open" }).filter((r) => r.scopeId === INV)[0];
    expect(rv).toBeDefined();

    const res = resolveDedupReview({ reviewId: rv.id, action: "distinct", actor: "tester", note: "shared inbox" });
    expect(res.ok).toBe(true);

    expect(readContact("investor_crm_contacts", "i_a")?.deleted_at).toBeNull();
    expect(readContact("investor_crm_contacts", "i_b")?.deleted_at).toBeNull();
    // Both must STAY exempt — clearing here would make 0098's index reject a
    // legitimate second person on a shared address.
    expect(Number(readContact("investor_crm_contacts", "i_a")?.dedup_exempt)).toBe(1);
    expect(Number(readContact("investor_crm_contacts", "i_b")?.dedup_exempt)).toBe(1);
    const raw = readReviewRaw(rv.id)!;
    expect(raw.resolution).toBe("distinct");
    expect(raw.survivor_id).toBeNull();
  });

  // ── (8) PARTNER MERGE IS REFUSED — and the refusal changes nothing. ──
  it("(8) partner merge is refused for hash-chain safety, and NO row is touched by the refusal", () => {
    insertContact("partner_crm_contacts", "partner_id", PTR, "p_a", "Alice Adams", 1);
    insertReviewRow("ddr_w28_partner", "partner", PTR, ["p_a", "p_b"], ["Alice Adams", "Bob Brown"]);
    const rv = getDedupReview("ddr_w28_partner")!;
    expect(rv.crmScope).toBe("partner");
    expect(rv.mergeAllowed).toBe(false);
    expect(rv.mergeBlockedReason).toMatch(/hash-chain/i);

    const res = resolveDedupReview({ reviewId: rv.id, action: "merge", survivorId: "p_a", actor: "tester" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("partner_merge_chain_unsafe");

    // The refusal must be INERT on the data. Read every sink back.
    expect(readContact("partner_crm_contacts", "p_a")?.deleted_at).toBeNull();
    expect(Number(readContact("partner_crm_contacts", "p_a")?.dedup_exempt)).toBe(1);
    expect(readReviewRaw(rv.id)!.status).toBe("open");
    expect(readReviewRaw(rv.id)!.resolution).toBeNull();

    // POSITIVE CONTROL - the identical merge on a FOUNDER group succeeds, so the
    // refusal above is about the scope and not about the harness.
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 1);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "Bob Brown", 1);
    insertReviewRow("ddr_w28_founder_ctl", "founder", CO, ["c_a", "c_b"], ["Alice Adams", "Bob Brown"]);
    const ok = resolveDedupReview({ reviewId: "ddr_w28_founder_ctl", action: "merge", survivorId: "c_a", actor: "tester" });
    expect(ok.ok).toBe(true);
  });

  // ── (9) …but partner 'distinct' IS allowed. The other pole of (8). ──
  it("(9) partner 'distinct' IS allowed - it writes no deleted_at and touches no chain column", () => {
    insertContact("partner_crm_contacts", "partner_id", PTR, "p_a", "Alice Adams", 1);
    insertReviewRow("ddr_w28_partner2", "partner", PTR, ["p_a", "p_b"], ["Alice Adams", "Bob Brown"]);
    const before = readContact("partner_crm_contacts", "p_a");
    const res = resolveDedupReview({ reviewId: "ddr_w28_partner2", action: "distinct", actor: "tester" });
    expect(res.ok).toBe(true);
    // No deleted_at written => the audit-chain live walk is unchanged.
    const after = readContact("partner_crm_contacts", "p_a");
    expect(after?.deleted_at).toBeNull();
    expect(before?.deleted_at).toBeNull();
    // And the exempt flag is PRESERVED, not cleared.
    expect(Number(after?.dedup_exempt)).toBe(1);
    expect(readReviewRaw("ddr_w28_partner2")!.resolution).toBe("distinct");
  });

  // ── (10) Every other refusal is also inert on the data. ──
  it("(10) survivor validation refuses out-of-group / already-deleted survivors and changes nothing", () => {
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 1);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "Bob Brown", 1);
    detectDedupConflicts();
    const rv = listDedupReviews({ status: "open" }).filter((r) => r.scopeId === CO)[0];

    for (const [survivorId, expected] of [
      ["", "survivor_required"],
      ["c_zzz_not_in_group", "survivor_not_in_group"],
    ] as const) {
      const res = resolveDedupReview({ reviewId: rv.id, action: "merge", survivorId, actor: "tester" });
      expect(res.ok).toBe(false);
      expect(res.ok === false && res.error).toBe(expected);
    }
    // Nothing moved.
    expect(readContact("founder_crm_contacts", "c_b")?.deleted_at).toBeNull();
    expect(readReviewRaw(rv.id)!.status).toBe("open");

    // Now the "already deleted survivor" pole.
    db().prepare(`UPDATE founder_crm_contacts SET deleted_at = ? WHERE id = 'c_a'`).run(new Date().toISOString());
    const res2 = resolveDedupReview({ reviewId: rv.id, action: "merge", survivorId: "c_a", actor: "tester" });
    expect(res2.ok).toBe(false);
    expect(res2.ok === false && res2.error).toBe("survivor_not_live");

    // And the positive control: a VALID survivor on the same entry succeeds, so
    // the refusals above are not just "this entry can never be resolved".
    const res3 = resolveDedupReview({ reviewId: rv.id, action: "merge", survivorId: "c_b", actor: "tester" });
    expect(res3.ok).toBe(true);
    expect(readContact("founder_crm_contacts", "c_b")?.dedup_exempt).toBeNull();
  });

  // ── (11) Double-resolution is refused; reopen rules are two-sided. ──
  it("(11) a resolved entry cannot be resolved twice; 'distinct' can be reopened but 'merged' cannot", () => {
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 1);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "Bob Brown", 1);
    detectDedupConflicts();
    const rv = listDedupReviews({ status: "open" }).filter((r) => r.scopeId === CO)[0];

    expect(resolveDedupReview({ reviewId: rv.id, action: "distinct", actor: "t" }).ok).toBe(true);
    const twice = resolveDedupReview({ reviewId: rv.id, action: "distinct", actor: "t" });
    expect(twice.ok).toBe(false);
    expect(twice.ok === false && twice.error).toBe("already_resolved");

    // 'distinct' reopens.
    expect(reopenDedupReview(rv.id, "t").ok).toBe(true);
    expect(readReviewRaw(rv.id)!.status).toBe("open");
    expect(readReviewRaw(rv.id)!.resolution).toBeNull();

    // 'merged' does not — undeleting rows is a different operation and
    // pretending otherwise would leave the losers deleted under an "open" entry.
    expect(resolveDedupReview({ reviewId: rv.id, action: "merge", survivorId: "c_a", actor: "t" }).ok).toBe(true);
    const re = reopenDedupReview(rv.id, "t");
    expect(re.ok).toBe(false);
    expect(re.ok === false && re.error).toBe("merged_not_reopenable");
    // And the loser really is still deleted, i.e. the refusal is honest.
    expect(readContact("founder_crm_contacts", "c_b")?.deleted_at).not.toBeNull();
  });

  // ── (12) Unknown names are null, never "". ──
  it("(12) a contact with no name hydrates as null (not an empty string) so the UI can refuse to render it", () => {
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 1);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "   ", 1);
    db()
      .prepare(
        `INSERT INTO crm_dedup_review (id, crm_scope, scope_id, email_norm, contact_ids, distinct_names, status, created_at)
         VALUES ('ddr_w28_null','founder',?,?,'["c_a","c_b"]','["Alice Adams"]','open',?)`,
      )
      .run(CO, EMAIL, new Date().toISOString());
    const rv = getDedupReview("ddr_w28_null")!;
    expect(rv.members.find((m) => m.contactId === "c_b")?.name).toBeNull();
    // Positive pole — a real name survives intact.
    expect(rv.members.find((m) => m.contactId === "c_a")?.name).toBe("Alice Adams");
  });

  // ── (13) THE ROUTES EXIST AND ARE REACHED. Not grepped — requested. ──
  it("(13) the four endpoints are registered, admin-gated, and actually serve data", async () => {
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 1);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "Bob Brown", 1);

    // POLE 1 - unauthenticated callers are refused by requireAdmin (403), NOT
    // 404. A 403 already proves the route is registered and reached.
    for (const p of [
      "/api/admin/crm-dedup-review",
      "/api/admin/crm-dedup-review/detect",
      "/api/admin/crm-dedup-review/x/resolve",
      "/api/admin/crm-dedup-review/x/reopen",
    ]) {
      const r = p === "/api/admin/crm-dedup-review" ? await request(app).get(p) : await request(app).post(p).send({});
      expect(r.status).toBe(403);
    }

    // CONTROL - a sibling path that was never registered. It must be checked AS
    // AN ADMIN: requireAdmin is mounted on the whole /api/admin prefix, so an
    // anonymous request to a NON-EXISTENT admin path also returns 403 and would
    // make the pole above meaningless. Past the gate, unregistered really 404s.
    expect(
      (await request(app).get("/api/admin/crm-dedup-review-does-not-exist").set("Cookie", adminCookie)).status,
    ).toBe(404);
    // ...and the real path, as the same admin, does NOT 404.
    expect((await request(app).get("/api/admin/crm-dedup-review").set("Cookie", adminCookie)).status).toBe(200);

    // POLE 2 - as an admin, the endpoints serve real data end to end.
    const detect = await request(app)
      .post("/api/admin/crm-dedup-review/detect")
      .set("Cookie", adminCookie)
      .send({});
    expect(detect.status).toBe(200);
    expect(detect.body.ok).toBe(true);

    const list = await request(app).get("/api/admin/crm-dedup-review?status=open").set("Cookie", adminCookie);
    expect(list.status).toBe(200);
    const mine = (list.body.reviews as DedupReviewWire[]).filter((r) => r.scopeId === CO);
    expect(mine).toHaveLength(1);
    expect(mine[0].members.map((m) => m.contactId).sort()).toEqual(["c_a", "c_b"]);

    // Resolve over HTTP, then verify the SINK in SQLite - not the response body.
    const resolve = await request(app)
      .post(`/api/admin/crm-dedup-review/${encodeURIComponent(mine[0].id)}/resolve`)
      .set("Cookie", adminCookie)
      .send({ action: "merge", survivorId: "c_a", note: "over http" });
    expect(resolve.status).toBe(200);
    expect(readContact("founder_crm_contacts", "c_b")?.deleted_at).not.toBeNull();
    expect(readContact("founder_crm_contacts", "c_a")?.dedup_exempt).toBeNull();
    expect(readReviewRaw(mine[0].id)!.resolution).toBe("merged");

    // A bad action is rejected with 400 rather than quietly doing nothing.
    const bad = await request(app)
      .post(`/api/admin/crm-dedup-review/${encodeURIComponent(mine[0].id)}/resolve`)
      .set("Cookie", adminCookie)
      .send({ action: "obliterate" });
    expect(bad.status).toBe(400);
  });

  // ── (14) The scope table is complete and correct. ──
  it("(14) all three CRM scopes are covered, and only partner is chain-protected", () => {
    expect(Array.from(CRM_DEDUP_SCOPES)).toEqual(["founder", "investor", "partner"]);
    for (const scope of CRM_DEDUP_SCOPES) {
      const table = { founder: "founder_crm_contacts", investor: "investor_crm_contacts", partner: "partner_crm_contacts" }[scope];
      const cols = (db().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
      // The whole mechanism depends on this column existing in all three.
      expect(cols).toContain("dedup_exempt");
      expect(cols).toContain("deleted_at");
    }
    // Migration 0175's columns must actually be present, or resolution silently
    // records nothing.
    const rc = (db().prepare(`PRAGMA table_info(crm_dedup_review)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(rc).toEqual(expect.arrayContaining(["resolution", "survivor_id", "resolution_note"]));
  });

  // -- (15) A SECOND DEFECT, PINNED BY EXECUTION. --------------------------
  //
  // 0097 deliberately keeps partner duplicate groups LIVE and flags them
  // dedup_exempt = 1 so 0098's partial UNIQUE index SKIPS them. But
  // connection.ts's inline baseline (and migration 0106) also create
  // `uq_partner_crm_email_parity`, a partial UNIQUE index on
  // (partner_id, lower(trim(email))) WHERE deleted_at IS NULL that has NO
  // dedup_exempt predicate. 0106's own comment says so out loud:
  //   "does NOT reference the dedup_exempt column (which is ...)"
  //
  // The two indexes therefore contradict each other: 0097 requires the exempt
  // rows to coexist, and uq_partner_crm_email_parity forbids it. This case
  // proves the contradiction by trying the insert rather than by reading the
  // comment, and pins BOTH poles, so the day the parity index gains the exempt
  // predicate this test fails and tells the next wave the situation changed.
  it("(15) partner duplicates follow 0097 (exempt pairs coexist) once uq_partner_crm_email_parity honours dedup_exempt — W29 fixed this; branch reads the live index definition, not its mere presence", () => {
    // Pole A - two live FOUNDER rows on one email: allowed, because 0098's index
    // honours dedup_exempt and both rows carry it.
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 1);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "Bob Brown", 1);
    const liveFounders = db()
      .prepare(`SELECT id FROM founder_crm_contacts WHERE company_id = ? AND deleted_at IS NULL`)
      .all(CO);
    expect(liveFounders).toHaveLength(2);

    // Pole B - the SAME shape on PARTNER: refused by the parity index, exempt
    // flag or not. A plain INSERT (not INSERT OR REPLACE) must throw.
    insertContact("partner_crm_contacts", "partner_id", PTR, "p_a", "Alice Adams", 1);
    /* WAVE 29 CORRECTION #2 — this used to be a RAW INSERT naming only six
     * columns. `partner_crm_contacts` has NOT NULL columns without defaults
     * (tenant_id, updated_at) that it did not supply, so it threw
     * "NOT NULL constraint failed" every single time — which the assertion's
     * /UNIQUE|constraint/i pattern happily matched. Pole B therefore never
     * exercised the uniqueness constraint it claimed to be proving; it proved a
     * missing column. Routed through the same `insertContact` helper the rest
     * of this file uses, which fills unknown NOT NULL columns, so the only
     * thing left that can throw is the index. */
    const attempt = () => insertContact("partner_crm_contacts", "partner_id", PTR, "p_b", "Bob Brown", 1);

    /* WAVE 29 CORRECTION — this branch used to test whether the parity index was
     * PRESENT. That is the wrong question, and it made the case a latent false
     * green: Wave 29 added the `dedup_exempt` predicate to the index (migration
     * 0176 + the self-heal installer), the index is obviously still present, so
     * the old condition kept steering into the "contradiction" branch and the
     * case kept passing while no longer testing what its own comment promises
     * ("the day the parity index gains the exempt predicate this test fails").
     * A pin that cannot fire is Rule 1's exact failure family, so the condition
     * now reads the index DEFINITION. */
    const parityRow = db()
      .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='uq_partner_crm_email_parity'`)
      .get() as { sql?: string } | undefined;
    const parityIndexContradicts =
      !!parityRow && !/dedup_exempt/i.test(String(parityRow.sql ?? ""));

    if (parityIndexContradicts) {
      // The contradiction, demonstrated.
      expect(attempt).toThrow(/UNIQUE/i); // W29: was /UNIQUE|constraint/i, which matched NOT NULL errors too
      expect(
        db().prepare(`SELECT id FROM partner_crm_contacts WHERE partner_id = ? AND deleted_at IS NULL`).all(PTR),
      ).toHaveLength(1);
    } else {
      // The index is gone or was FIXED - then the insert must SUCCEED. Wave 29
      // fixed it, so this is now the live branch and WAVE28_REPORT.md section
      // 2.5 is superseded by WAVE29_REPORT.md section 2.
      expect(attempt).not.toThrow();
    }
  });

  // -- (16) THE SELF-HEAL IS LAZY, NOT JUST A beforeAll CALL. ---------------
  //
  // MUTATION N8 (delete the ensure call inside db()) SURVIVED the first run of
  // this harness. That was a HARNESS BUG, not a coverage gap in the code: the
  // beforeAll above calls ensureCrmDedupReviewSchema(true) explicitly, which
  // masked the lazy call the production paths actually depend on. This case
  // closes it by removing the table and then using a normal public API with no
  // explicit ensure in between - which is exactly what a fresh boot does.
  it("(16) a public API call self-heals a MISSING crm_dedup_review table with no explicit ensure", () => {
    // Pole A - the table really is gone. If this fails, the rest is vacuous.
    db().exec("DROP TABLE IF EXISTS crm_dedup_review");
    const gone = db()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='crm_dedup_review'`)
      .all();
    expect(gone).toHaveLength(0);

    // Pole B - a plain read works anyway, and the table is back.
    expect(() => listDedupReviews({ status: "open" })).not.toThrow();
    const back = db()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='crm_dedup_review'`)
      .all();
    expect(back).toHaveLength(1);

    // ...and the healed schema carries migration 0175's columns too, not just
    // 0097's, so a resolution written against it is actually recorded.
    const cols = (db().prepare(`PRAGMA table_info(crm_dedup_review)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["resolution", "survivor_id", "resolution_note", "status", "resolved_by"]));

    // End to end on the healed table: detect, then resolve, then read the sink.
    insertContact("founder_crm_contacts", "company_id", CO, "c_a", "Alice Adams", 0);
    insertContact("founder_crm_contacts", "company_id", CO, "c_b", "Bob Brown", 0);
    detectDedupConflicts();
    const rv = listDedupReviews({ status: "open" }).filter((r) => r.scopeId === CO)[0];
    expect(rv).toBeDefined();
    expect(resolveDedupReview({ reviewId: rv.id, action: "merge", survivorId: "c_a", actor: "t" }).ok).toBe(true);
    expect(readContact("founder_crm_contacts", "c_a")?.dedup_exempt).toBeNull();
  });
});
