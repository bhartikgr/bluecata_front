/**
 * WAVE 28 ITEM 2 — CP-CRM-04 · CRM duplicate-contact review queue.
 *
 * WHAT WAS MISSING
 * ----------------
 * `crm_dedup_review` was created by
 * `server/db/migrations/0097_v25_52_crm_dedup_backfill.sql` and then had ZERO
 * consumers — no reader, no writer, no route, no component. Wave 9's own
 * inventory records it as "migration DDL only"
 * (`0159_wave9_reporting_audit.sql:360`). 0097 writes rows into it and flags the
 * conflicting contacts `dedup_exempt = 1`, which makes 0098's partial UNIQUE
 * index SKIP them. So every conflict 0097 found is:
 *
 *   • sitting in a queue nobody can see,
 *   • holding its contacts permanently outside the uniqueness guarantee,
 *   • with no way for an admin to ever say "resolved".
 *
 * That is an engine with no route, which the owner rules class as NOT SHIPPED.
 * This module is the missing half: detection, reading, and resolution, all
 * DB-driven, plus the routes and (in `client/src/pages/admin/CrmDedupReview.tsx`)
 * the surface that renders them.
 *
 * THE CONTRACT COMES FROM 0097 ITSELF, verbatim:
 *   "When an admin later resolves the conflict, they clear dedup_exempt on the
 *    surviving row; the index then naturally covers it."
 *
 * TWO OUTCOMES, AND THEY ARE OPPOSITES
 * ------------------------------------
 *   MERGE    — the rows were one person. Keep one survivor, soft-delete the
 *              other live members, and CLEAR dedup_exempt on the survivor so
 *              0098's index covers it again.
 *   DISTINCT — a real shared inbox (ops@, founders@). Different people, same
 *              address. Both rows stay live and both stay dedup_exempt = 1
 *              FOREVER; clearing the flag here would make 0098's index reject a
 *              legitimate row. Only the queue entry is settled.
 *
 * WHY PARTNER MERGE IS REFUSED
 * ----------------------------
 * `partner_crm_contacts` is an audit hash-chain table
 * (`server/lib/auditChainVerifier.ts:411`) registered with `hasDeletedAt: true`
 * and no `chainPartitionByRowId`, so the verifier filters soft-deleted rows OUT
 * and then requires every remaining LIVE row's `prev_hash` to equal the previous
 * LIVE row's `curr_hash`. Soft-deleting a NON-TAIL row therefore removes a link
 * from the live walk and the next row fails `prev_hash_mismatch` — a merge would
 * CORRUPT the audit chain. 0097 reached the same conclusion and deliberately
 * never sets `deleted_at` on partner rows, deferring collapse to a chain-aware
 * follow-up (its Track 3.5.4, which does not exist in this tree).
 *
 * So `resolveDedupReview` REFUSES a partner merge with `partner_merge_chain_unsafe`
 * and the admin page renders that refusal in place of the merge control, with the
 * reason on screen. It is not silently disabled and it is not silently allowed.
 * `distinct` remains available for partner scope because it writes no
 * `deleted_at` and touches no chain column.
 *
 * IDEMPOTENT DETECTION
 * --------------------
 * `detectDedupConflicts()` re-derives conflicts from the LIVE contact rows, so
 * duplicates created after 0097 ran are queued too — the queue is live, not
 * frozen at migration time. A group already settled as 'distinct' with the same
 * membership is NOT re-queued (that is what migration 0175's `resolution` column
 * buys); if the membership CHANGES, the verdict no longer describes the group and
 * it is re-queued deliberately.
 *
 * NO IN-MEMORY STATE. Every function reads and writes SQLite through `rawDb()`
 * on each call. There is no cache to go stale and nothing to hydrate on boot.
 */
import type { Express, Request, Response } from "express";
import { rawDb } from "./db/connection";
import { appendAdminAudit } from "./adminPlatformStore";
import { log } from "./lib/logger";

/** The three CRM scopes 0097 covers. Order is stable for rendering. */
export const CRM_DEDUP_SCOPES = ["founder", "investor", "partner"] as const;
export type CrmDedupScope = (typeof CRM_DEDUP_SCOPES)[number];

/**
 * Per-scope table facts. `scopeColumn` is the owning-entity column 0097 grouped
 * by; it differs per table, which is exactly the sort of detail that gets
 * hard-coded wrongly if it is not stated once here.
 *
 * `chainProtected` marks the tables where a soft-delete would break an audit
 * hash chain. Only `partner_crm_contacts` is registered with the verifier.
 */
const SCOPE_TABLES: Record<CrmDedupScope, { table: string; scopeColumn: string; chainProtected: boolean }> = {
  founder: { table: "founder_crm_contacts", scopeColumn: "company_id", chainProtected: false },
  investor: { table: "investor_crm_contacts", scopeColumn: "investor_id", chainProtected: false },
  partner: { table: "partner_crm_contacts", scopeColumn: "partner_id", chainProtected: true },
};

export type DedupReviewMember = {
  contactId: string;
  /** null (not "") when the contact has no name — an unknown name is not an empty name. */
  name: string | null;
  email: string | null;
  createdAt: string | null;
  /** true only when the row is currently flagged out of 0098's unique index. */
  dedupExempt: boolean;
  /** false once the row has been soft-deleted (by a merge, or by an admin elsewhere). */
  live: boolean;
};

export type DedupReviewRow = {
  id: string;
  crmScope: CrmDedupScope;
  scopeId: string;
  emailNorm: string;
  contactIds: string[];
  distinctNames: string[];
  status: "open" | "resolved";
  resolution: "merged" | "distinct" | null;
  survivorId: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** Hydrated live state of every contact in `contactIds`, in `contactIds` order. */
  members: DedupReviewMember[];
  /** Members still live right now. A group that has fallen to <2 is no longer a conflict. */
  liveMemberCount: number;
  /**
   * False for partner scope. The client uses this to render the refusal rather
   * than to hide the control, so the reason stays visible.
   */
  mergeAllowed: boolean;
  /** Non-null exactly when mergeAllowed is false. */
  mergeBlockedReason: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * A-22 CHECK, AND A SECOND DEFECT FOUND BY IT.
 *
 * Rule A-22 says to check the self-heal installer and `connection.ts`'s inline
 * baseline for anything that re-creates what a merge removes. Doing that check
 * turned up the opposite problem, and a worse one:
 *
 *   `server/db/connection.ts` — the inline baseline every non-migrated database
 *   is built from — creates NEITHER `crm_dedup_review` NOR the `dedup_exempt`
 *   columns. Both exist only inside migration 0097. The test/dev database is
 *   built from the inline baseline, so `SELECT * FROM crm_dedup_review` there
 *   fails with `no such table`. This was not a hypothesis: the ITEM 2 harness
 *   failed 15/15 on `no such table: crm_dedup_review` before this function
 *   existed. On any such database 0097's ENTIRE dedup mechanism is absent —
 *   including the `dedup_exempt` predicate 0098's partial UNIQUE index depends
 *   on.
 *
 * `connection.ts` is SACRED (read, never edit), so the fix cannot go there. It
 * goes here, using the pattern this tree already uses for exactly this situation
 * in `commsTiersStore.ts`, `bridgeStore.ts`, `bulkMessageStore.ts` and eight
 * other stores: an idempotent `CREATE TABLE IF NOT EXISTS` + guarded
 * `ADD COLUMN`, run before first use.
 *
 * The DDL below is 0097's and 0175's, character-for-character in column order,
 * type and default, so a migrated database and a self-healed one converge on the
 * same schema. `CREATE TABLE IF NOT EXISTS` is a no-op where 0097 already ran,
 * and every `ALTER` is wrapped so "duplicate column" is tolerated. No row is
 * ever written or rewritten by this function.
 */
/* WAVE 29 ITEM 2 — the corrected `uq_partner_crm_email_parity` definition,
 * character-identical to migration 0176. Kept as a single constant so the
 * migration and the self-heal cannot drift apart silently. */
const PARTNER_PARITY_INDEX_SQL =
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_crm_email_parity\n` +
  `  ON partner_crm_contacts (partner_id, lower(trim(email)))\n` +
  `  WHERE email IS NOT NULL\n` +
  `    AND trim(email) <> ''\n` +
  `    AND deleted_at IS NULL\n` +
  `    AND (dedup_exempt IS NULL OR dedup_exempt <> 1)`;

/** True when EVERY artifact this module installs is present on `handle`. */
function crmDedupSchemaComplete(handle: {
  prepare: (sql: string) => { get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[] };
}): boolean {
  try {
    const table = handle
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'crm_dedup_review'`)
      .get();
    if (!table) return false;
    for (const t of ["founder_crm_contacts", "investor_crm_contacts", "partner_crm_contacts"]) {
      const cols = handle.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name?: string }>;
      // A CRM table absent entirely is a different problem and not one this
      // module invented, so it does not count as "incomplete" here.
      if (cols.length === 0) continue;
      if (!cols.some((c) => c?.name === "dedup_exempt")) return false;
    }
    return parityIndexHasExemptPredicate(handle);
  } catch {
    // Any read failure means "cannot prove it is complete" -> re-run the ensure,
    // which is idempotent. Never report success on an unanswered question.
    return false;
  }
}

/** Does the live parity index carry 0176's `dedup_exempt` predicate? */
function parityIndexHasExemptPredicate(handle: {
  prepare: (sql: string) => { get: (...a: unknown[]) => unknown };
}): boolean {
  const row = handle
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'uq_partner_crm_email_parity'`,
    )
    .get() as { sql?: string } | undefined;
  // Index absent => nothing to repair; the table may simply not exist here.
  if (!row) return true;
  return typeof row.sql === "string" && /dedup_exempt/i.test(row.sql);
}

let schemaEnsured = false;
export function ensureCrmDedupReviewSchema(force = false): void {
  const handle = rawDb();
  if (!handle || typeof handle.exec !== "function") {
    throw new Error("rawDb().exec unavailable — crm dedup review schema cannot be ensured");
  }
  if (schemaEnsured && !force) {
    // The cache must not outlive the table. A bare `if (schemaEnsured) return`
    // makes the self-heal a ONE-SHOT: anything that swaps or rebuilds the
    // database inside the same process (test harnesses do exactly this) would
    // then hit `no such table` forever with the flag still claiming success —
    // a check that passes while checking nothing. One indexed sqlite_master
    // lookup is cheap enough to pay on every call to avoid that.
    // WAVE 29 — this used to check ONLY that `crm_dedup_review` existed. That
    // is not the same question as "is the schema this module needs present",
    // and the gap was reachable: on a database where the table exists but the
    // additive `dedup_exempt` columns or the corrected parity index do NOT
    // (a partially-migrated DB, or one swapped in mid-process after a previous
    // full ensure), the early return skipped the ALTERs and the index repair
    // while still reporting success. Same family as the one-shot bug Wave 28's
    // own harness masked. The check now covers every artifact this function is
    // responsible for; it is three indexed sqlite_master/pragma reads, which is
    // cheap enough to pay per call.
    if (crmDedupSchemaComplete(handle)) return;
    schemaEnsured = false;
  }
  // 0097 (0) — the queue table, verbatim.
  handle.exec(
    `CREATE TABLE IF NOT EXISTS crm_dedup_review (
       id            TEXT PRIMARY KEY,
       crm_scope     TEXT NOT NULL,
       scope_id      TEXT NOT NULL,
       email_norm    TEXT NOT NULL,
       contact_ids   TEXT NOT NULL,
       distinct_names TEXT NOT NULL,
       status        TEXT NOT NULL DEFAULT 'open',
       created_at    TEXT NOT NULL,
       resolved_at   TEXT,
       resolved_by   TEXT
     )`,
  );
  handle.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_dedup_review_key
       ON crm_dedup_review (crm_scope, scope_id, email_norm)
       WHERE status = 'open'`,
  );
  // 0175 — the resolution outcome columns, plus 0097 (0a)'s dedup_exempt flag on
  // each CRM table. Guarded individually: a partially-applied schema must heal
  // the parts that are missing without the present ones aborting the rest.
  const alters = [
    `ALTER TABLE crm_dedup_review ADD COLUMN resolution TEXT`,
    `ALTER TABLE crm_dedup_review ADD COLUMN survivor_id TEXT`,
    `ALTER TABLE crm_dedup_review ADD COLUMN resolution_note TEXT`,
    `ALTER TABLE founder_crm_contacts  ADD COLUMN dedup_exempt INTEGER`,
    `ALTER TABLE investor_crm_contacts ADD COLUMN dedup_exempt INTEGER`,
    `ALTER TABLE partner_crm_contacts  ADD COLUMN dedup_exempt INTEGER`,
  ];
  for (const sql of alters) {
    try {
      handle.exec(sql);
    } catch (err) {
      const msg = (err as Error).message || "";
      // "duplicate column" = already applied. "no such table" = that CRM table
      // does not exist on this database at all, which is a different problem and
      // not one this module invented. Anything else is worth seeing.
      if (/duplicate column|already exists|no such table/i.test(msg)) continue;
      log.warn(`[crmDedupReview] schema ensure failed for "${sql}":`, msg);
    }
  }
  handle.exec(
    `CREATE INDEX IF NOT EXISTS idx_crm_dedup_review_status_scope
       ON crm_dedup_review (status, crm_scope, scope_id, email_norm)`,
  );

  /* WAVE 29 ITEM 2 — repair `uq_partner_crm_email_parity`.
   *
   * 0106 created it WITHOUT a `dedup_exempt` predicate while its two siblings
   * from 0098 have one, so on partner_crm_contacts the parity index alone
   * vetoed 0097's exemption and made partner duplicates impossible. Migration
   * 0176 fixes migrated databases; this fixes the ones built from
   * `connection.ts`'s inline baseline, which still emits the old definition at
   * :2161 and is SACRED. Same approach Wave 24 used for the mark-override
   * default.
   *
   * The DROP is load-bearing. SQLite has no ALTER INDEX, and a bare
   * `CREATE UNIQUE INDEX IF NOT EXISTS` is a silent no-op wherever the OLD
   * index already exists — that is, on exactly the databases that have the bug.
   *
   * Guarded by a predicate read so the drop happens only when the live index is
   * genuinely the old one. Recreating an already-correct index every call would
   * be wasted work on a hot path and, more importantly, would open a window in
   * which the table momentarily has no uniqueness constraint at all. */
  try {
    if (!parityIndexHasExemptPredicate(handle)) {
      handle.exec(`DROP INDEX IF EXISTS uq_partner_crm_email_parity`);
      handle.exec(PARTNER_PARITY_INDEX_SQL);
    }
  } catch (err) {
    const msg = (err as Error).message || "";
    // "no such table" = partner CRM is not on this database. Anything else is
    // worth seeing rather than swallowing.
    if (!/no such table/i.test(msg)) {
      log.warn(`[crmDedupReview] parity index repair failed:`, msg);
    }
  }

  schemaEnsured = true;
}

/** Raw better-sqlite3 handle. Throws (never returns a no-op) when unavailable. */
function db(): {
  prepare: (sql: string) => {
    get: (...a: unknown[]) => unknown;
    all: (...a: unknown[]) => unknown[];
    run: (...a: unknown[]) => unknown;
  };
  transaction: (fn: (...a: unknown[]) => unknown) => (...a: unknown[]) => unknown;
  exec: (sql: string) => void;
} {
  ensureCrmDedupReviewSchema();
  const handle = rawDb();
  if (!handle || typeof handle.prepare !== "function") {
    // Fail loudly. A silent fallback here would be a resolution path that
    // reports success while clearing nothing — the exact defect this wave is
    // about.
    throw new Error("rawDb().prepare unavailable — crm dedup review cannot run");
  }
  return handle;
}

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function isScope(v: unknown): v is CrmDedupScope {
  return typeof v === "string" && (CRM_DEDUP_SCOPES as readonly string[]).includes(v);
}

/** Stable set signature for a group's membership, so re-detection can compare. */
function membershipKey(ids: readonly string[]): string {
  return Array.from(new Set(ids)).sort().join("|");
}

/**
 * Read the live state of the named contacts from their scope's table.
 * Returns a map keyed by contact id; ids with no row are simply absent, and the
 * caller renders them as not-live rather than inventing a placeholder.
 */
function loadMembers(scope: CrmDedupScope, contactIds: readonly string[]): Map<string, DedupReviewMember> {
  const out = new Map<string, DedupReviewMember>();
  if (contactIds.length === 0) return out;
  const { table } = SCOPE_TABLES[scope];
  const placeholders = contactIds.map(() => "?").join(",");
  const rows = db()
    .prepare(
      `SELECT id, name, email, created_at, deleted_at, dedup_exempt
         FROM ${table}
        WHERE id IN (${placeholders})`,
    )
    .all(...contactIds) as Array<Record<string, unknown>>;
  for (const r of rows) {
    const nameRaw = typeof r.name === "string" ? r.name.trim() : "";
    out.set(String(r.id), {
      contactId: String(r.id),
      // Unknown name is null, not "". The client renders a refusal string for
      // null rather than an empty cell that reads as "this person has no name".
      name: nameRaw === "" ? null : nameRaw,
      email: typeof r.email === "string" && r.email.trim() !== "" ? r.email.trim() : null,
      createdAt: typeof r.created_at === "string" ? r.created_at : null,
      dedupExempt: Number(r.dedup_exempt ?? 0) === 1,
      live: r.deleted_at === null || r.deleted_at === undefined,
    });
  }
  return out;
}

function hydrate(raw: Record<string, unknown>): DedupReviewRow {
  const scopeRaw = String(raw.crm_scope ?? "");
  const scope: CrmDedupScope = isScope(scopeRaw) ? scopeRaw : "founder";
  const contactIds = parseJsonArray(raw.contact_ids);
  const memberMap = loadMembers(scope, contactIds);
  const members = contactIds.map(
    (id) =>
      memberMap.get(id) ?? {
        contactId: id,
        name: null,
        email: null,
        createdAt: null,
        dedupExempt: false,
        live: false,
      },
  );
  const chainProtected = SCOPE_TABLES[scope].chainProtected;
  const statusRaw = String(raw.status ?? "open");
  const resolutionRaw = raw.resolution === "merged" || raw.resolution === "distinct" ? raw.resolution : null;
  return {
    id: String(raw.id),
    crmScope: scope,
    scopeId: String(raw.scope_id ?? ""),
    emailNorm: String(raw.email_norm ?? ""),
    contactIds,
    distinctNames: parseJsonArray(raw.distinct_names),
    status: statusRaw === "resolved" ? "resolved" : "open",
    resolution: resolutionRaw,
    survivorId: typeof raw.survivor_id === "string" ? raw.survivor_id : null,
    resolutionNote: typeof raw.resolution_note === "string" ? raw.resolution_note : null,
    createdAt: String(raw.created_at ?? ""),
    resolvedAt: typeof raw.resolved_at === "string" ? raw.resolved_at : null,
    resolvedBy: typeof raw.resolved_by === "string" ? raw.resolved_by : null,
    members,
    liveMemberCount: members.filter((m) => m.live).length,
    mergeAllowed: !chainProtected,
    mergeBlockedReason: chainProtected
      ? "partner_crm_contacts is an audit hash-chain table: soft-deleting a non-tail row breaks the live-row prev_hash walk. Merge is refused until a chain-aware collapse exists."
      : null,
  };
}

/** List the queue. DB-driven on every call; no cache. */
export function listDedupReviews(opts?: {
  status?: "open" | "resolved" | "all";
  scope?: CrmDedupScope;
  limit?: number;
}): DedupReviewRow[] {
  const status = opts?.status ?? "open";
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 200));
  const where: string[] = [];
  const args: unknown[] = [];
  if (status !== "all") {
    where.push("status = ?");
    args.push(status);
  }
  if (opts?.scope) {
    where.push("crm_scope = ?");
    args.push(opts.scope);
  }
  const sql =
    `SELECT * FROM crm_dedup_review` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY status ASC, created_at DESC, id ASC LIMIT ?`;
  const rows = db().prepare(sql).all(...args, limit) as Array<Record<string, unknown>>;
  return rows.map(hydrate);
}

export function getDedupReview(id: string): DedupReviewRow | undefined {
  const row = db().prepare(`SELECT * FROM crm_dedup_review WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? hydrate(row) : undefined;
}

/** Counts for the queue header. Computed in SQL, never by length of a cached array. */
export function dedupReviewCounts(): { open: number; resolved: number; merged: number; distinct: number } {
  const g = (sql: string, ...a: unknown[]) =>
    Number((db().prepare(sql).get(...a) as { n?: unknown } | undefined)?.n ?? 0);
  return {
    open: g(`SELECT COUNT(*) AS n FROM crm_dedup_review WHERE status = 'open'`),
    resolved: g(`SELECT COUNT(*) AS n FROM crm_dedup_review WHERE status = 'resolved'`),
    merged: g(`SELECT COUNT(*) AS n FROM crm_dedup_review WHERE resolution = 'merged'`),
    distinct: g(`SELECT COUNT(*) AS n FROM crm_dedup_review WHERE resolution = 'distinct'`),
  };
}

/**
 * Re-derive conflicts from LIVE contact rows and queue any that are not already
 * open or already settled as 'distinct' with the same membership.
 *
 * Mirrors 0097's own grouping exactly, per scope:
 *   • founder / investor — a conflict is 2+ live rows sharing a normalized email
 *     with more than one DISTINCT non-blank name (same-name duplicates were
 *     safe-collapsed by 0097 and would be collapsed the same way again).
 *   • partner — ANY 2+ live rows sharing a normalized email, regardless of name,
 *     because 0097 refuses to auto-collapse partner rows at all (chain safety),
 *     so even a same-name partner duplicate needs a human.
 *
 * Returns what it did rather than a bare count, so a caller can tell "found
 * nothing" from "found things and skipped them all".
 */
export function detectDedupConflicts(): {
  inserted: number;
  alreadyOpen: number;
  skippedSettled: number;
  scanned: number;
} {
  const handle = db();
  let inserted = 0;
  let alreadyOpen = 0;
  let skippedSettled = 0;
  let scanned = 0;
  const ts = nowIso();

  for (const scope of CRM_DEDUP_SCOPES) {
    const { table, scopeColumn, chainProtected } = SCOPE_TABLES[scope];
    // Partner: every duplicate group. Founder/investor: only groups whose live
    // rows disagree about the name (0097's "shared inbox" case).
    const having = chainProtected
      ? `HAVING COUNT(*) > 1`
      : `HAVING COUNT(*) > 1 AND COUNT(DISTINCT lower(trim(coalesce(name,'')))) > 1`;
    let groups: Array<Record<string, unknown>>;
    try {
      groups = handle
        .prepare(
          `SELECT ${scopeColumn} AS scope_id,
                  lower(trim(email)) AS email_norm,
                  group_concat(id, char(31)) AS ids,
                  group_concat(DISTINCT trim(coalesce(name,''))) AS names
             FROM ${table}
            WHERE deleted_at IS NULL AND email IS NOT NULL AND trim(email) <> ''
            GROUP BY ${scopeColumn}, lower(trim(email))
            ${having}`,
        )
        .all() as Array<Record<string, unknown>>;
    } catch (err) {
      // A missing table on a partially-migrated DB must not take the whole scan
      // down, but it must be visible. Skip this scope and keep going.
      log.warn(`[crmDedupReview] scan of ${table} failed (skipping scope):`, (err as Error).message);
      continue;
    }

    for (const g of groups) {
      scanned += 1;
      const scopeId = String(g.scope_id ?? "");
      const emailNorm = String(g.email_norm ?? "");
      const ids = String(g.ids ?? "")
        .split(String.fromCharCode(31))
        .filter((s) => s !== "");
      if (ids.length < 2) continue;
      const names = String(g.names ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");

      const openRow = handle
        .prepare(
          `SELECT id FROM crm_dedup_review
            WHERE crm_scope = ? AND scope_id = ? AND email_norm = ? AND status = 'open' LIMIT 1`,
        )
        .get(scope, scopeId, emailNorm) as { id?: unknown } | undefined;
      if (openRow) {
        alreadyOpen += 1;
        continue;
      }

      // Settled as 'distinct' with the SAME membership => a human already ruled
      // on exactly this group. Re-queueing it would make the queue unclearable.
      // A CHANGED membership means the ruling no longer describes the group, so
      // it is re-queued on purpose.
      const settled = handle
        .prepare(
          `SELECT contact_ids FROM crm_dedup_review
            WHERE crm_scope = ? AND scope_id = ? AND email_norm = ?
              AND status = 'resolved' AND resolution = 'distinct'
            ORDER BY resolved_at DESC`,
        )
        .all(scope, scopeId, emailNorm) as Array<Record<string, unknown>>;
      const key = membershipKey(ids);
      if (settled.some((s) => membershipKey(parseJsonArray(s.contact_ids)) === key)) {
        skippedSettled += 1;
        continue;
      }

      handle
        .prepare(
          `INSERT INTO crm_dedup_review
             (id, crm_scope, scope_id, email_norm, contact_ids, distinct_names, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
        )
        .run(
          `ddr_${scope}_${scopeId}_${emailNorm}_${ts}`,
          scope,
          scopeId,
          emailNorm,
          JSON.stringify(ids),
          JSON.stringify(names),
          ts,
        );
      inserted += 1;

      // Every live member of a newly-queued conflict must be exempt from 0098's
      // index for as long as the conflict is open, or a second live row with the
      // same email could not exist at all. This mirrors 0097's flag step.
      const ph = ids.map(() => "?").join(",");
      handle
        .prepare(`UPDATE ${table} SET dedup_exempt = 1 WHERE deleted_at IS NULL AND id IN (${ph})`)
        .run(...ids);
    }
  }
  return { inserted, alreadyOpen, skippedSettled, scanned };
}

export type ResolveResult =
  | { ok: true; review: DedupReviewRow; softDeleted: string[]; exemptCleared: string[] }
  | { ok: false; error: string; message: string };

/**
 * Resolve one queue entry.
 *
 * MERGE   (founder/investor only): survivor stays live and has dedup_exempt
 *         CLEARED; every other LIVE member is soft-deleted. One transaction, so
 *         a half-merge cannot be committed.
 * DISTINCT: nothing is deleted; every live member is (re-)flagged
 *         dedup_exempt = 1 so 0098's index keeps skipping them.
 */
export function resolveDedupReview(args: {
  reviewId: string;
  action: "merge" | "distinct";
  survivorId?: string;
  note?: string;
  actor: string;
}): ResolveResult {
  const review = getDedupReview(args.reviewId);
  if (!review) return { ok: false, error: "not_found", message: "No such dedup review entry." };
  if (review.status === "resolved") {
    return { ok: false, error: "already_resolved", message: "This conflict has already been resolved." };
  }

  const { table } = SCOPE_TABLES[review.crmScope];
  const handle = db();
  const ts = nowIso();
  const liveIds = review.members.filter((m) => m.live).map((m) => m.contactId);

  if (args.action === "merge") {
    // The chain refusal. Checked from SCOPE_TABLES, not from the caller's word.
    if (!review.mergeAllowed) {
      return {
        ok: false,
        error: "partner_merge_chain_unsafe",
        message: review.mergeBlockedReason ?? "Merge is not available for this CRM scope.",
      };
    }
    const survivorId = typeof args.survivorId === "string" ? args.survivorId.trim() : "";
    if (!survivorId) {
      return { ok: false, error: "survivor_required", message: "Choose which contact to keep." };
    }
    if (!review.contactIds.includes(survivorId)) {
      return {
        ok: false,
        error: "survivor_not_in_group",
        message: "The chosen survivor is not one of the conflicting contacts.",
      };
    }
    if (!liveIds.includes(survivorId)) {
      return {
        ok: false,
        error: "survivor_not_live",
        message: "The chosen survivor has already been deleted; pick a contact that still exists.",
      };
    }
    const losers = liveIds.filter((id) => id !== survivorId);

    try {
      handle.transaction(() => {
        for (const id of losers) {
          handle
            .prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
            .run(ts, id);
        }
        // 0097's stated contract, executed: clear the flag so 0098's partial
        // UNIQUE index covers the survivor again. NULL (0097's own "normal"
        // value), not 0, so the column reads the same as a row that was never
        // flagged.
        handle.prepare(`UPDATE ${table} SET dedup_exempt = NULL WHERE id = ?`).run(survivorId);
        handle
          .prepare(
            `UPDATE crm_dedup_review
                SET status = 'resolved', resolution = 'merged', survivor_id = ?,
                    resolution_note = ?, resolved_at = ?, resolved_by = ?
              WHERE id = ?`,
          )
          .run(survivorId, args.note ?? null, ts, args.actor, review.id);
      })();
    } catch (err) {
      log.error("[crmDedupReview] merge failed — nothing committed:", (err as Error).message);
      return { ok: false, error: "merge_failed", message: "The merge could not be completed. Nothing was changed." };
    }

    try {
      appendAdminAudit(args.actor, `crm_dedup_review:${review.id}`, "crm.dedup.merged", {
        crmScope: review.crmScope,
        scopeId: review.scopeId,
        emailNorm: review.emailNorm,
        survivorId,
        softDeleted: losers,
      });
    } catch (err) {
      // The merge is already committed; a failed audit line must not un-commit
      // it or report failure. Logged loudly instead of swallowed.
      log.error("[crmDedupReview] merge audit append failed:", (err as Error).message);
    }
    return {
      ok: true,
      review: getDedupReview(review.id) as DedupReviewRow,
      softDeleted: losers,
      exemptCleared: [survivorId],
    };
  }

  // DISTINCT — nothing is deleted and no flag is cleared.
  try {
    handle.transaction(() => {
      for (const id of liveIds) {
        handle.prepare(`UPDATE ${table} SET dedup_exempt = 1 WHERE id = ? AND deleted_at IS NULL`).run(id);
      }
      handle
        .prepare(
          `UPDATE crm_dedup_review
              SET status = 'resolved', resolution = 'distinct', survivor_id = NULL,
                  resolution_note = ?, resolved_at = ?, resolved_by = ?
            WHERE id = ?`,
        )
        .run(args.note ?? null, ts, args.actor, review.id);
    })();
  } catch (err) {
    log.error("[crmDedupReview] distinct resolution failed — nothing committed:", (err as Error).message);
    return { ok: false, error: "resolve_failed", message: "The conflict could not be settled. Nothing was changed." };
  }

  try {
    appendAdminAudit(args.actor, `crm_dedup_review:${review.id}`, "crm.dedup.distinct", {
      crmScope: review.crmScope,
      scopeId: review.scopeId,
      emailNorm: review.emailNorm,
      keptLive: liveIds,
    });
  } catch (err) {
    log.error("[crmDedupReview] distinct audit append failed:", (err as Error).message);
  }
  return { ok: true, review: getDedupReview(review.id) as DedupReviewRow, softDeleted: [], exemptCleared: [] };
}

/** Put a settled entry back in the queue (an admin changed their mind). */
export function reopenDedupReview(reviewId: string, actor: string): ResolveResult {
  const review = getDedupReview(reviewId);
  if (!review) return { ok: false, error: "not_found", message: "No such dedup review entry." };
  if (review.status === "open") {
    return { ok: false, error: "already_open", message: "This conflict is already open." };
  }
  if (review.resolution === "merged") {
    // Reopening a merge would imply undeleting rows. That is a different,
    // larger operation and pretending otherwise would leave a "reopened"
    // conflict whose losers are still deleted.
    return {
      ok: false,
      error: "merged_not_reopenable",
      message: "A merged conflict cannot be reopened; the merged-away contacts were soft-deleted.",
    };
  }
  // uq_crm_dedup_review_key is UNIQUE over OPEN rows only, so reopening while
  // another open row holds the same key would throw. Refuse with a readable
  // reason instead of surfacing a constraint error.
  const clash = db()
    .prepare(
      `SELECT id FROM crm_dedup_review
        WHERE crm_scope = ? AND scope_id = ? AND email_norm = ? AND status = 'open' AND id <> ? LIMIT 1`,
    )
    .get(review.crmScope, review.scopeId, review.emailNorm, review.id) as { id?: unknown } | undefined;
  if (clash) {
    return {
      ok: false,
      error: "open_conflict_exists",
      message: "Another open review already covers this email; resolve that one instead.",
    };
  }
  try {
    db()
      .prepare(
        `UPDATE crm_dedup_review
            SET status = 'open', resolution = NULL, survivor_id = NULL,
                resolved_at = NULL, resolved_by = NULL
          WHERE id = ?`,
      )
      .run(review.id);
  } catch (err) {
    log.error("[crmDedupReview] reopen failed:", (err as Error).message);
    return { ok: false, error: "reopen_failed", message: "The conflict could not be reopened." };
  }
  try {
    appendAdminAudit(actor, `crm_dedup_review:${review.id}`, "crm.dedup.reopened", {
      crmScope: review.crmScope,
      scopeId: review.scopeId,
      emailNorm: review.emailNorm,
    });
  } catch (err) {
    log.error("[crmDedupReview] reopen audit append failed:", (err as Error).message);
  }
  return { ok: true, review: getDedupReview(review.id) as DedupReviewRow, softDeleted: [], exemptCleared: [] };
}

function actorOf(req: Request): string {
  const ctx = (req as unknown as { userContext?: { userId?: string; email?: string } }).userContext;
  return ctx?.email || ctx?.userId || "admin";
}

/**
 * Routes. Mounted under /api/admin, which `app.use("/api/admin", requireAdmin)`
 * at routes.ts:555 covers — that mount was verified NON-inert by this wave's own
 * prefix sweep (354 routes claimed, 0 missed), so these endpoints really are
 * admin-only rather than nominally so.
 */
export function registerCrmDedupReviewRoutes(app: Express): void {
  // GET /api/admin/crm-dedup-review — the queue.
  app.get("/api/admin/crm-dedup-review", (req: Request, res: Response) => {
    try {
      const statusRaw = String(req.query.status ?? "open");
      const status = statusRaw === "resolved" || statusRaw === "all" ? statusRaw : "open";
      const scopeRaw = req.query.scope;
      const scope = isScope(scopeRaw) ? scopeRaw : undefined;
      const rows = listDedupReviews({ status, scope, limit: Number(req.query.limit ?? 200) });
      return res.json({ ok: true, reviews: rows, counts: dedupReviewCounts(), scopes: CRM_DEDUP_SCOPES });
    } catch (err) {
      log.error("[crmDedupReview GET] failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "crm_dedup_review_unavailable" });
    }
  });

  // POST /api/admin/crm-dedup-review/detect — rescan live rows for new conflicts.
  app.post("/api/admin/crm-dedup-review/detect", (req: Request, res: Response) => {
    try {
      const result = detectDedupConflicts();
      appendAdminAudit(actorOf(req), "crm_dedup_review", "crm.dedup.scanned", { ...result });
      return res.json({ ok: true, ...result, counts: dedupReviewCounts() });
    } catch (err) {
      log.error("[crmDedupReview detect] failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "crm_dedup_scan_failed" });
    }
  });

  // POST /api/admin/crm-dedup-review/:id/resolve
  app.post("/api/admin/crm-dedup-review/:id/resolve", (req: Request, res: Response) => {
    const action = req.body?.action;
    if (action !== "merge" && action !== "distinct") {
      return res.status(400).json({ ok: false, error: "invalid_action", message: "action must be merge or distinct." });
    }
    let result: ResolveResult;
    try {
      result = resolveDedupReview({
        reviewId: String(req.params.id),
        action,
        survivorId: typeof req.body?.survivorId === "string" ? req.body.survivorId : undefined,
        note: typeof req.body?.note === "string" && req.body.note.trim() !== "" ? req.body.note.trim() : undefined,
        actor: actorOf(req),
      });
    } catch (err) {
      log.error("[crmDedupReview resolve] threw:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "crm_dedup_resolve_failed" });
    }
    if (!result.ok) {
      const code =
        result.error === "not_found"
          ? 404
          : result.error === "partner_merge_chain_unsafe"
            ? 409
            : result.error === "already_resolved"
              ? 409
              : result.error.endsWith("_failed")
                ? 500
                : 400;
      return res.status(code).json(result);
    }
    return res.json({ ...result, counts: dedupReviewCounts() });
  });

  // POST /api/admin/crm-dedup-review/:id/reopen
  app.post("/api/admin/crm-dedup-review/:id/reopen", (req: Request, res: Response) => {
    let result: ResolveResult;
    try {
      result = reopenDedupReview(String(req.params.id), actorOf(req));
    } catch (err) {
      log.error("[crmDedupReview reopen] threw:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "crm_dedup_reopen_failed" });
    }
    if (!result.ok) {
      return res.status(result.error === "not_found" ? 404 : 409).json(result);
    }
    return res.json({ ...result, counts: dedupReviewCounts() });
  });
}
