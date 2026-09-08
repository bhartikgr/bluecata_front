/**
 * server/recordArchiveStore.ts — WAVE 344 · ITEM 2. THE ARCHIVE MECHANISM.
 *
 * ── WHAT THE OWNER ASKED FOR ───────────────────────────────────────────────
 * "I do need your guidance on how I can 'archive' or remove them." He accepted the
 * recommendation NOT to delete. This module is the archive.
 *
 * ── THE FIVE RULES THIS MODULE EXISTS TO KEEP ──────────────────────────────
 *  1. ADDITIVE AND REVERSIBLE. Archiving writes ONE row into `record_archive`
 *     (migration 0234). It never writes, alters or moves the record itself, so the
 *     record, its history and any tamper-proof seal it carries are untouched.
 *     Un-archiving sets that row's state back to 'active' and stamps who and when;
 *     the row is never deleted, so the reversal is on the record too.
 *  2. IT NEVER TOUCHES MONEY OR A SEALED TABLE. The only table this module writes
 *     is `record_archive`. `ARCHIVE_WRITE_TABLES` below is the complete list, it
 *     has one member, and a test asserts that no other table's row count or
 *     content changes across an archive and an un-archive.
 *  3. REFUSE, NEVER HIDE ANYWAY. `resolveArchiveTarget` refuses BY DEFAULT. A kind
 *     of record that is not in the allowlist parsed out of the migration, or that
 *     is in the allowlist but whose working list does not yet filter on the
 *     registry, is REFUSED with a sentence a person can read. It is never accepted
 *     and quietly ignored, because an archive that hides nothing is worse than no
 *     archive: the owner would believe the record was put away.
 *  4. ARCHIVED RECORDS STAY VISIBLE IN AUDIT AND ADMIN VIEWS. The registry is the
 *     admin/audit surface, and it is deliberately a REGISTRY of archive decisions
 *     rather than a copy of record content — see the note on R285/R289 below.
 *  5. THE AUDIT IS WRITTEN FIRST, AND A FAILED AUDIT REFUSES THE ARCHIVE. The
 *     platform's `appendAudit` returns an empty-hash sentinel instead of throwing
 *     when it cannot write. Every path here checks that sentinel with
 *     `isAuditWriteFailure` and returns 503 WITHOUT writing the registry row, so an
 *     audit outage can never produce a record that is hidden with no trace of who
 *     hid it.
 *
 * ── WHY THE ADMIN SURFACE IS A REGISTRY AND NOT A RECORD VIEWER ────────────
 * Owner rulings R285/R289: an administrator may read founder CONTACT DETAILS but
 * NOT founder CRM RECORDS. "Archived records stay visible in admin views" and that
 * ruling are only compatible if what an administrator sees is the archive DECISION
 * — which kind of record, which id, when, by whom, and why — and not the CRM record
 * behind it. That is exactly what `listArchiveRegistry` returns, and
 * server/__tests__/w344_item3_admin_founder_crm_boundary.test.ts fails if any CRM
 * field can be reached through it.
 *
 * ── WHAT IS NOT WIRED YET, STATED HERE RATHER THAN IMPLIED ─────────────────
 * The migration's allowlist has eight kinds. A kind is only OFFERED once the
 * working list that would hide it actually filters on this registry. Today that is
 * `contact` (the founder investor CRM, `founder_crm_contacts`). The other seven are
 * in `ARCHIVE_BINDINGS` with `workingViewFiltered: false` and are REFUSED with a
 * message that says so. See build_log/ownerband2/OWNERBAND2_HANDOFF.md.
 */

import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { rawDb } from "./db/connection";
import { requireAuth, requireAdmin } from "./lib/authMiddleware";
import { appendAdminAudit, isAuditWriteFailure } from "./adminPlatformStore";
import { log } from "./lib/logger";
import {
  ARCHIVABLE_ENTITY_TYPES,
  ARCHIVE_REFUSED_CODE,
  ARCHIVE_REFUSED_MESSAGE,
  RECORD_ARCHIVE_TABLE,
  ensureRecordArchiveSchema,
  isArchivableEntityType,
} from "./lib/recordArchiveSchema";

/**
 * THE COMPLETE LIST OF TABLES THIS FEATURE WRITES. One member, and that is the
 * whole safety argument: no cap-table table, no tamper-sealed table and no money
 * table can appear in a write this module performs, because there is nowhere for
 * one to appear. Asserted by test.
 */
export const ARCHIVE_WRITE_TABLES: readonly string[] = Object.freeze([
  RECORD_ARCHIVE_TABLE,
]);

/** What a kind of record means, physically, and whether hiding it actually works. */
export interface ArchiveBinding {
  /** The physical table the working list reads. Resolved by TRACING the screen to
   *  its route to its store, not inferred from the table's name — there are six
   *  spellings of "contacts" in this database and two of "portfolio company". */
  table: string;
  /** The screen a person archives from, so a reader can check the claim. */
  surface: string;
  /** TRUE only when that working list actually leaves archived records out. While
   *  this is false the kind is REFUSED, because accepting it would tell the owner a
   *  record had been put away when it had not. */
  workingViewFiltered: boolean;
  /** Plain-word name used in messages a person reads. */
  plainWords: string;
  /* WAVE 346 · ITEM 3 — WHY THIS KIND IS STILL REFUSED, IN ONE SENTENCE.

     Wave 344 left seven kinds refused with `workingViewFiltered: false` and no
     record of what was actually in the way, and the open-items note that followed
     described extending them as "straightforward". Wave 346 traced all seven and
     that description is NOT correct for any of them: each one is blocked by a
     specific, checkable fact about the table or the screen. Those facts are now
     written next to the binding, because a refusal whose reason is not recorded is
     a refusal the next person will remove by guessing.

     `null` means the kind is wired and no blocker remains. */
  blocker: string | null;
}

export const ARCHIVE_BINDINGS: Readonly<Record<string, ArchiveBinding>> = Object.freeze({
  contact: {
    table: "founder_crm_contacts",
    surface: "client/src/pages/founder/CRM.tsx (GET /api/founder/investor-crm)",
    workingViewFiltered: true,
    plainWords: "contact",
    blocker: null,
  },
  pipeline_card: {
    table: "partner_deal_pipeline",
    surface: "partner deal board (GET /api/partner/me/pipeline, server/partnerRoutes.ts)",
    workingViewFiltered: false,
    plainWords: "pipeline card",
    blocker:
      "The list of pipeline cards is not only a screen. server/lib/partnerCompanyLinkGate.ts " +
      "treats having a pipeline card for a company as one of six proofs that a partner is " +
      "allowed to see that company at all, and server/spvEngineStore.ts reads the same list to " +
      "advance a deal's stage when a soft circle is recorded. Leaving archived cards out of that " +
      "list would quietly withdraw a partner's access to a company and stop a stage from " +
      "advancing. Hiding cards on the board alone is possible, but it has to be done at the board " +
      "itself and never in the shared list, and the board's per-stage counts have to say they " +
      "leave archived cards out before it can be turned on.",
  },
  note: {
    table: "pcrm_notes",
    surface: "NOT REACHABLE — no screen reads this table (see blocker)",
    workingViewFiltered: false,
    plainWords: "note",
    blocker:
      "This binding names a table the visible screen does not read. Wave 346 traced it: nothing " +
      "in server/ runs a query against pcrm_notes at all; server/crmStore.ts loads it once into a " +
      "list held in memory and serves it from GET /api/investor/crm/notes, and no page in " +
      "client/src calls that address. The notes a person actually writes on the investor CRM " +
      "screen are saved by server/investorCrmStore.ts onto the contact record itself. Wiring this " +
      "kind would tell the owner a note had been put away while the note they can see stayed " +
      "exactly where it was. The refusal is kept until the binding names the table the screen " +
      "really reads.",
  },
  task: {
    table: "pcrm_tasks",
    surface: "NOT REACHABLE — no screen reads this table (see blocker)",
    workingViewFiltered: false,
    plainWords: "task",
    blocker:
      "Same as notes, and traced the same way. No query in server/ reads pcrm_tasks; " +
      "server/crmStore.ts serves an in-memory copy from GET /api/investor/crm/tasks, which no " +
      "page calls, and the tasks on the investor CRM screen are stored by " +
      "server/investorCrmStore.ts on the contact record. Archiving here would hide nothing.",
  },
  post: {
    table: "network_posts",
    surface: "network feed (GET /api/comms/posts)",
    workingViewFiltered: false,
    plainWords: "post",
    blocker:
      "There is no per-tenant list of posts to filter. server/networkPostsStore.ts reads the " +
      "table once into a shared in-memory collection and only exposes a health endpoint; the feed " +
      "a person sees is served from a different place, and five other modules read the same rows " +
      "for audience checks, chapter membership and engagement counts. Until the feed reads the " +
      "table directly, an archived post would still appear.",
  },
  file: {
    table: "partner_files",
    surface: "partner workspace files",
    workingViewFiltered: false,
    plainWords: "file",
    blocker:
      "Individual files are not rows. The table holds one row per partner whose columns are " +
      "id, partner_id, file_json and updated_at, with every file kept inside the file_json blob " +
      "and no tenant column at all. There is no per-file identifier for the archive register to " +
      "point at, so a file cannot be archived without first giving files rows of their own.",
  },
  client: {
    table: "partner_client_crm",
    surface: "partner client list",
    workingViewFiltered: false,
    plainWords: "client",
    blocker:
      "The table has no id column. Its columns are partner_id, company_id, stage, updated_at, " +
      "updated_by and lead_user_id, so a client row is identified by the pair of partner and " +
      "company and cannot be named by the single record identifier the archive register stores. " +
      "This is in addition to the standing instruction not to archive clients without first " +
      "proving no money or sealed record depends on them.",
  },
  portfolio_company: {
    table: "partner_portfolio_companies",
    surface: "partner portfolio",
    workingViewFiltered: false,
    plainWords: "portfolio company",
    blocker:
      "Money and a sealed record both depend on these rows. The table carries " +
      "lead_invested_amount_minor, which is an amount of money, and prev_hash and curr_hash, " +
      "which are the tamper-evident seal. The standing instruction is to keep the refusal when " +
      "anything of that kind depends on a record, so this one is kept deliberately and is not a " +
      "gap to be closed later.",
  },
});

/** Machine-readable codes. Named once so the endpoint and the screen agree. */
export const ARCHIVE_NOT_WIRED_CODE = "archive_not_available_for_this_kind";
export const ARCHIVE_AUDIT_UNAVAILABLE_CODE = "archive_audit_unavailable";

/** The sentence a person sees when the kind is allowlisted but its list does not
 *  yet leave archived records out. It says the record has NOT been hidden. */
export function archiveNotWiredMessage(entityType: string): string {
  const b = ARCHIVE_BINDINGS[entityType];
  const what = b ? `a ${b.plainWords}` : "this kind of record";
  /* WAVE 346 · ITEM 3 — WHY THE RECORDED REASON IS *NOT* APPENDED HERE.
     The obvious improvement is to add the binding's `blocker` sentence to this
     message so the person is told why. It is deliberately not done: every blocker
     names files, tables and column names, and this string is sent to a person in an
     HTTP response, which is exactly what `lint:internal-language-fence` exists to
     prevent. The reason therefore stays on the binding, where the build reports and
     the fence test read it, and the sentence a person sees is unchanged from Wave
     344 — it already states the important thing, which is that NOTHING was hidden.
     A plain-word version safe to show a person would be a new, separately reviewed
     string for each of the seven kinds and is left to the next wave. */
  return (
    `Archiving ${what} is not available yet, so nothing has been hidden and this ` +
    `record is unchanged. Only contacts can be archived at the moment. Ask for ` +
    `this to be enabled rather than deleting anything.`
  );
}

export interface ArchiveDecision {
  ok: boolean;
  /** HTTP status the caller should use. */
  status: number;
  code?: string;
  /** A sentence written for a person, not an error string. */
  message?: string;
}

/**
 * THE GATE. Refuses by default.
 *
 * Order matters: an unknown or money/audit kind is refused with the money message
 * (the strongest statement, and the one the owner needs to be able to rely on),
 * and only a kind that IS allowlisted can reach the "not wired yet" answer.
 */
export function resolveArchiveTarget(entityType: unknown): ArchiveDecision {
  if (typeof entityType !== "string" || entityType.trim() === "") {
    return {
      ok: false,
      status: 400,
      code: ARCHIVE_REFUSED_CODE,
      message: ARCHIVE_REFUSED_MESSAGE,
    };
  }
  if (!isArchivableEntityType(entityType)) {
    return {
      ok: false,
      status: 409,
      code: ARCHIVE_REFUSED_CODE,
      message: ARCHIVE_REFUSED_MESSAGE,
    };
  }
  const binding = ARCHIVE_BINDINGS[entityType];
  if (!binding || !binding.workingViewFiltered) {
    return {
      ok: false,
      status: 501,
      code: ARCHIVE_NOT_WIRED_CODE,
      message: archiveNotWiredMessage(entityType),
    };
  }
  return { ok: true, status: 200 };
}

/* ────────────────────────────── the handle ────────────────────────────── */

interface SqliteLike {
  prepare(sql: string): {
    all(...a: unknown[]): unknown[];
    get(...a: unknown[]): unknown;
    run(...a: unknown[]): unknown;
  };
  exec(sql: string): unknown;
}

let installedOn: unknown = null;

/**
 * Return the raw handle with migration 0234 installed on it, or null.
 *
 * `rawDb()` is the better-sqlite3 handle; `getDb()` is the Drizzle wrapper and has
 * no `.prepare`, so a `getDb().prepare` guard would silently no-op — the mistake
 * documented at server/founderCrmStore.ts:503.
 */
export function archiveDb(): SqliteLike | null {
  let db: SqliteLike | null = null;
  try {
    const handle = rawDb() as unknown as SqliteLike;
    if (handle && typeof handle.prepare === "function") db = handle;
  } catch (e) {
    log.warn("[recordArchiveStore] rawDb() unavailable:", (e as Error).message);
    return null;
  }
  if (!db) return null;
  // Re-install whenever the handle changes (each in-memory test database is a new
  // handle). Idempotent, so a repeat call on the same handle is cheap.
  if (installedOn !== db) {
    const r = ensureRecordArchiveSchema(db);
    if (r.failures.length) {
      log.error("[recordArchiveStore] schema install failed:", r.failures.join("; "));
      return null;
    }
    installedOn = db;
  }
  return db;
}

/* ───────────────────────────── read helpers ───────────────────────────── */

/** The ids currently archived for one tenant and one kind. The working lists use
 *  this and nothing else, so "hidden from the list" and "in the registry as
 *  archived" cannot drift apart. */
export function archivedRecordIds(tenantId: string, entityType: string): string[] {
  const db = archiveDb();
  if (!db) return [];
  try {
    return (
      db
        .prepare(
          `SELECT record_id FROM record_archive
            WHERE tenant_id = ? AND entity_type = ? AND state = 'archived'`,
        )
        .all(tenantId, entityType) as Array<{ record_id: string }>
    ).map((r) => String(r.record_id));
  } catch (e) {
    log.warn("[recordArchiveStore] archivedRecordIds failed:", (e as Error).message);
    return [];
  }
}

/** How many records of one kind are archived for one tenant. A real count, read
 *  back from the registry — never assumed, never defaulted to 0 on an error (an
 *  error returns null so the caller can say "not known" instead of "none"). */
export function archivedCount(tenantId: string, entityType: string): number | null {
  const db = archiveDb();
  if (!db) return null;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM record_archive
          WHERE tenant_id = ? AND entity_type = ? AND state = 'archived'`,
      )
      .get(tenantId, entityType) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } catch (e) {
    log.warn("[recordArchiveStore] archivedCount failed:", (e as Error).message);
    return null;
  }
}

export interface ArchiveRegistryRow {
  id: string;
  tenantId: string;
  entityType: string;
  recordId: string;
  state: string;
  archivedAt: string;
  archivedByUserId: string;
  archiveReason: string | null;
  unarchivedAt: string | null;
  unarchivedByUserId: string | null;
}

/**
 * The admin/audit surface. Registry rows ONLY — no field of the archived record is
 * read, joined or returned, so this cannot become a way for an administrator to
 * read a founder's CRM record (owner rulings R285/R289).
 *
 * Both states are returned, INCLUDING records that have been brought back, because
 * "this was archived on the 4th and restored on the 6th" is the part an auditor
 * needs and the part a delete destroys.
 */
export function listArchiveRegistry(opts: {
  tenantId?: string;
  entityType?: string;
  limit?: number;
} = {}): ArchiveRegistryRow[] {
  const db = archiveDb();
  if (!db) return [];
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.tenantId) {
    where.push("tenant_id = ?");
    args.push(opts.tenantId);
  }
  if (opts.entityType) {
    where.push("entity_type = ?");
    args.push(opts.entityType);
  }
  const limit = Math.min(Math.max(Number(opts.limit ?? 500), 1), 2000);
  try {
    /* TENANT-SCOPE-EXEMPT: W344_ARCHIVE_AUDIT_REGISTRY_IS_CROSS_TENANT */
    return (
      db
        .prepare(
          `SELECT id, tenant_id AS tenantId, entity_type AS entityType,
                  record_id AS recordId, state,
                  archived_at AS archivedAt, archived_by_user_id AS archivedByUserId,
                  archive_reason AS archiveReason,
                  unarchived_at AS unarchivedAt,
                  unarchived_by_user_id AS unarchivedByUserId
             FROM record_archive
             ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
             ORDER BY archived_at DESC
             LIMIT ${limit}`,
        )
        .all(...args) as ArchiveRegistryRow[]
    );
  } catch (e) {
    log.warn("[recordArchiveStore] listArchiveRegistry failed:", (e as Error).message);
    return [];
  }
}

/* ───────────────────────────── write paths ────────────────────────────── */

export interface ArchiveWriteResult extends ArchiveDecision {
  /** The registry row after the call, read back from the database. */
  row?: ArchiveRegistryRow;
}

/**
 * Put one record away.
 *
 * The caller is responsible for having established that this actor may act on this
 * record — this module deliberately does not guess at ownership, because the
 * correct ownership check differs per surface and a generic one would be a weaker
 * one. The founder contact surface uses `resolveFounderCompanyIdForCaller`.
 */
export function archiveRecord(opts: {
  tenantId: string;
  entityType: string;
  recordId: string;
  actorUserId: string;
  reason?: string | null;
  /** The audit entity/actor label for the ledger. */
  auditEntity: string;
}): ArchiveWriteResult {
  const gate = resolveArchiveTarget(opts.entityType);
  if (!gate.ok) return gate;

  const db = archiveDb();
  if (!db) {
    return {
      ok: false,
      status: 503,
      code: "archive_unavailable",
      message:
        "The archive could not be reached just now, so nothing has been hidden. Please try again.",
    };
  }
  if (!opts.actorUserId || !opts.actorUserId.trim()) {
    return {
      ok: false,
      status: 401,
      code: "archive_actor_required",
      message: "Nothing was archived, because the platform could not tell who asked.",
    };
  }

  /* THE AUDIT GOES FIRST, AND A FAILED AUDIT REFUSES THE ARCHIVE. `appendAudit`
     returns an empty-hash sentinel rather than throwing when the ledger cannot be
     written; `isAuditWriteFailure` is the platform's named check for it. Writing
     the registry row first would allow a record to be hidden with no trace of who
     hid it, which is the one outcome an archive must never produce. */
  const requested = appendAdminAudit(
    opts.actorUserId,
    opts.auditEntity,
    "record.archive.requested",
    {
      entityType: opts.entityType,
      recordId: opts.recordId,
      reason: opts.reason ?? null,
      table: ARCHIVE_BINDINGS[opts.entityType]?.table ?? null,
    },
    opts.tenantId,
  );
  if (isAuditWriteFailure(requested)) {
    return {
      ok: false,
      status: 503,
      code: ARCHIVE_AUDIT_UNAVAILABLE_CODE,
      message:
        "Nothing was archived. The activity record could not be written, and a record " +
        "must never be hidden without a trace of who hid it. Please try again.",
    };
  }

  const now = new Date().toISOString();
  try {
    const existing = db
      .prepare(
        `SELECT id, state FROM record_archive
          WHERE tenant_id = ? AND entity_type = ? AND record_id = ?`,
      )
      .get(opts.tenantId, opts.entityType, opts.recordId) as
      | { id: string; state: string }
      | undefined;

    if (existing && existing.state === "archived") {
      // Already put away. Idempotent, and it does NOT rewrite the original stamp
      // (trg_record_archive_stamp_frozen would refuse anyway).
      return { ok: true, status: 200, row: readRow(db, opts.tenantId, existing.id) };
    }
    if (existing) {
      // A record that was archived, brought back, and is now being archived again.
      // The original stamp is frozen, so the re-archive is recorded by clearing the
      // un-archive stamp and returning the state. Nothing is deleted.
      db.prepare(
        `UPDATE record_archive
            SET state = 'archived', unarchived_at = NULL, unarchived_by_user_id = NULL,
                archive_reason = COALESCE(?, archive_reason)
          WHERE id = ?`,
      ).run(opts.reason ?? null, existing.id);
    } else {
      db.prepare(
        `INSERT INTO record_archive
           (id, tenant_id, entity_type, record_id, state, archived_at,
            archived_by_user_id, archive_reason)
         VALUES (?, ?, ?, ?, 'archived', ?, ?, ?)`,
      ).run(
        randomUUID(),
        opts.tenantId,
        opts.entityType,
        opts.recordId,
        now,
        opts.actorUserId,
        opts.reason ?? null,
      );
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    /* The database's own refusals arrive here. They are surfaced as a refusal a
       person can read rather than as a 500, because "the platform will not do this
       and here is why" is a different fact from "the platform broke". */
    if (/ARCHIVE_REFUSED_MONEY_OR_AUDIT_RECORD|CHECK constraint failed: entity_type/.test(msg)) {
      return {
        ok: false,
        status: 409,
        code: ARCHIVE_REFUSED_CODE,
        message: ARCHIVE_REFUSED_MESSAGE,
      };
    }
    log.error("[recordArchiveStore] archive write failed:", msg);
    return {
      ok: false,
      status: 500,
      code: "archive_write_failed",
      message: "Nothing was archived. The change could not be saved, so this record is unchanged.",
    };
  }

  const row = readRow(db, opts.tenantId, undefined, {
    entityType: opts.entityType,
    recordId: opts.recordId,
  });
  const done = appendAdminAudit(
    opts.actorUserId,
    opts.auditEntity,
    "record.archived",
    {
      entityType: opts.entityType,
      recordId: opts.recordId,
      registryId: row?.id ?? null,
      reason: opts.reason ?? null,
    },
    opts.tenantId,
  );
  if (isAuditWriteFailure(done)) {
    // The record IS archived and the request event IS on the ledger, so this is
    // reported, not concealed, and it is not a fabricated success.
    log.error("[recordArchiveStore] archive outcome audit write failed (record IS archived)");
  }
  return { ok: true, status: 200, row };
}

/**
 * Bring one record back. This is what makes the archive an archive.
 *
 * It does NOT delete the registry row — `trg_record_archive_no_delete` would refuse
 * — so the fact that the record was archived, by whom, when and why survives the
 * reversal, and so does the reversal itself.
 */
export function unarchiveRecord(opts: {
  tenantId: string;
  entityType: string;
  recordId: string;
  actorUserId: string;
  auditEntity: string;
}): ArchiveWriteResult {
  const gate = resolveArchiveTarget(opts.entityType);
  if (!gate.ok) return gate;

  const db = archiveDb();
  if (!db) {
    return {
      ok: false,
      status: 503,
      code: "archive_unavailable",
      message: "The archive could not be reached just now. This record has not changed.",
    };
  }
  if (!opts.actorUserId || !opts.actorUserId.trim()) {
    return {
      ok: false,
      status: 401,
      code: "archive_actor_required",
      message: "Nothing was restored, because the platform could not tell who asked.",
    };
  }

  const existing = db
    .prepare(
      `SELECT id, state FROM record_archive
        WHERE tenant_id = ? AND entity_type = ? AND record_id = ?`,
    )
    .get(opts.tenantId, opts.entityType, opts.recordId) as
    | { id: string; state: string }
    | undefined;
  if (!existing) {
    return {
      ok: false,
      status: 404,
      code: "archive_entry_not_found",
      message: "This record is not archived, so there was nothing to bring back.",
    };
  }
  if (existing.state === "active") {
    return { ok: true, status: 200, row: readRow(db, opts.tenantId, existing.id) };
  }

  const requested = appendAdminAudit(
    opts.actorUserId,
    opts.auditEntity,
    "record.unarchive.requested",
    { entityType: opts.entityType, recordId: opts.recordId, registryId: existing.id },
    opts.tenantId,
  );
  if (isAuditWriteFailure(requested)) {
    return {
      ok: false,
      status: 503,
      code: ARCHIVE_AUDIT_UNAVAILABLE_CODE,
      message:
        "Nothing was restored. The activity record could not be written, and a change " +
        "to what a list shows must never happen without a trace of who made it. Please try again.",
    };
  }

  try {
    db.prepare(
      `UPDATE record_archive
          SET state = 'active', unarchived_at = ?, unarchived_by_user_id = ?
        WHERE id = ?`,
    ).run(new Date().toISOString(), opts.actorUserId, existing.id);
  } catch (e) {
    log.error("[recordArchiveStore] unarchive write failed:", String((e as Error)?.message ?? e));
    return {
      ok: false,
      status: 500,
      code: "archive_write_failed",
      message: "Nothing was restored. The change could not be saved.",
    };
  }

  const done = appendAdminAudit(
    opts.actorUserId,
    opts.auditEntity,
    "record.unarchived",
    { entityType: opts.entityType, recordId: opts.recordId, registryId: existing.id },
    opts.tenantId,
  );
  if (isAuditWriteFailure(done)) {
    log.error("[recordArchiveStore] unarchive outcome audit write failed (record IS restored)");
  }
  return { ok: true, status: 200, row: readRow(db, opts.tenantId, existing.id) };
}

/**
 * READS ONE REGISTRY ROW, ALWAYS INSIDE ONE TENANT.
 *
 * `tenantId` is REQUIRED even on the by-id path. The id is this table's own
 * primary key and the callers below have all just resolved it under tenant
 * scope, so an unscoped `WHERE id = ?` would have returned the same row in
 * practice — but it would also have been a read of a tenant-scoped table with no
 * tenant predicate, which `npm run lint:tenant-scope-fence` reports and which is
 * the shape that later becomes a leak when somebody passes an id in from a
 * request. Scoping it costs one argument.
 */
function readRow(
  db: SqliteLike,
  tenantId: string,
  id?: string,
  by?: { entityType: string; recordId: string },
): ArchiveRegistryRow | undefined {
  try {
    const sel = `SELECT id, tenant_id AS tenantId, entity_type AS entityType,
                        record_id AS recordId, state,
                        archived_at AS archivedAt, archived_by_user_id AS archivedByUserId,
                        archive_reason AS archiveReason,
                        unarchived_at AS unarchivedAt,
                        unarchived_by_user_id AS unarchivedByUserId
                   FROM record_archive
                  WHERE tenant_id = ?`;
    if (id) {
      /* The tenant predicate lives in `sel` itself, not appended here, so that a
         reader — and the tenant-scope fence, which reads the statement text —
         sees every path through this function carrying it. */
      return db
        .prepare(`${sel} AND id = ?`)
        .get(tenantId, id) as ArchiveRegistryRow | undefined;
    }
    if (by) {
      return db
        .prepare(`${sel} AND entity_type = ? AND record_id = ?`)
        .get(tenantId, by.entityType, by.recordId) as ArchiveRegistryRow | undefined;
    }
  } catch (e) {
    log.warn("[recordArchiveStore] readRow failed:", (e as Error).message);
  }
  return undefined;
}

/* ───────────────────────────── the routes ─────────────────────────────── */

export function registerRecordArchiveRoutes(app: Express): void {
  /**
   * GET /api/admin/archive — the administrator and audit view.
   *
   * Registry rows only. No CRM field is read or returned (R285/R289). Both states
   * are included, so a restored record is still on the record as having been
   * archived once.
   */
  app.get("/api/admin/archive", requireAuth, requireAdmin, (req: Request, res: Response) => {
    const entityType =
      typeof req.query.entityType === "string" ? req.query.entityType : undefined;
    const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
    const rows = listArchiveRegistry({ entityType, tenantId });
    res.json({
      ok: true,
      /* Named so an operator reading this response is not left to assume it is a
         record viewer. It is not, and it must not become one. */
      surface: "archive-decisions-only",
      archivableKinds: ARCHIVABLE_ENTITY_TYPES,
      rows,
      archivedCount: rows.filter((r) => r.state === "archived").length,
      restoredCount: rows.filter((r) => r.state === "active").length,
    });
  });
}
