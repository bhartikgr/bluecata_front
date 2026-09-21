/**
 * server/companyTaxonomyStore.ts — slide13b WAVE D.
 *
 * DB-direct store for the generic `taxonomy_terms` table (migration 0236).
 * First namespace: `company_sector` (45 seeded values). This is the ONLY
 * runtime source of company sectors after this wave; COLLECTIVE_SECTORS_45 is
 * retained as the seed/test oracle and is not read here for serving.
 *
 * CONTRACT (SOL Appendix A, D1/D2)
 *   • Bootstrap is FAIL-CLOSED: `ensureSchema()` throws a TaxonomyBootstrapError
 *     when the migration SQL is missing, fails to execute, leaves the table
 *     missing/misshapen, or leaves any of the 45 seed values absent. Success is
 *     memoised; failure is NOT, so the next call retries.
 *   • Dialect: SQLite only (explicit guard → UNSUPPORTED_DB_DIALECT). The
 *     PostgreSQL path is unverified and not claimed.
 *   • Read order is alphabetical: `label COLLATE NOCASE, label, value`.
 *   • `value` is IMMUTABLE. There is no rename. `label` is editable.
 *   • Retire, never delete. Retired rows stay resolvable for records that hold
 *     them; they just stop being offered.
 *   • Every mutation is ONE SQLite transaction: write → appendAdminAudit →
 *     (audit sentinel? THROW → rollback). Nothing runs after the audit, so a
 *     mutation with no audit row cannot become durable. Audit payloads carry
 *     `{ action, namespace, value, old, new }` (before/after mutable state).
 *     If the OUTER commit fails after the audit returned, the rolled-back audit
 *     entry is removed from the writer's read mirror (see transactWithAudit).
 *
 * NOT this store: partner_sectors / partner_subsectors (partner classification,
 * 0149) — separate taxonomy, separate store, separate admin page.
 */
import { rawDb } from "./db/connection";
import { isSqlite } from "./db/portable";
import { appendAdminAudit, getAuditLog, isAuditWriteFailure } from "./adminPlatformStore";
/** The writer's entry type is not exported; derive it so no unowned file is edited. */
type AuditEntry = ReturnType<typeof appendAdminAudit>;
import { log } from "./lib/logger";
import {
  applyCompanyTaxonomySchema,
  TaxonomyBootstrapError,
} from "./lib/applyCompanyTaxonomySchema";
import {
  isTaxonomyNamespace,
  validateTaxonomyText,
  type TaxonomyNamespace,
  type TaxonomyTermDto,
} from "../shared/companyTaxonomy";

/* ───────────────────────── errors ───────────────────────── */

export class TaxonomyUnknownNamespaceError extends Error {
  readonly code = "UNKNOWN_NAMESPACE" as const;
  constructor(ns: string) {
    super(`unknown taxonomy namespace: ${ns}`);
    this.name = "TaxonomyUnknownNamespaceError";
  }
}
export class TaxonomyTermNotFoundError extends Error {
  readonly code = "TERM_NOT_FOUND" as const;
  constructor(ns: string, value: string) {
    super(`no term "${value}" in namespace ${ns}`);
    this.name = "TaxonomyTermNotFoundError";
  }
}
export class TaxonomyConflictError extends Error {
  readonly code: "VALUE_EXISTS" | "LABEL_EXISTS" | "ALREADY_IN_STATE";
  constructor(code: "VALUE_EXISTS" | "LABEL_EXISTS" | "ALREADY_IN_STATE", message: string) {
    super(message);
    this.name = "TaxonomyConflictError";
    this.code = code;
  }
}
export class TaxonomyValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TaxonomyValidationError";
    this.code = code;
  }
}
/** Thrown when the audit row could not be written; the mutation was rolled back. */
export class TaxonomyAuditWriteError extends Error {
  readonly code = "AUDIT_WRITE_FAILED" as const;
  readonly durable = false;
  constructor(op: string) {
    super(`audit write failed for ${op}; the change was rolled back and is NOT durable`);
    this.name = "TaxonomyAuditWriteError";
  }
}
export { TaxonomyBootstrapError };

/* ───────────────────────── bootstrap ───────────────────────── */

let _ready = false;

/**
 * Apply-or-verify migration 0236 against the live handle. Memoised on SUCCESS
 * ONLY. Throws TaxonomyBootstrapError (fail-closed) — callers map it to 503.
 */
export function ensureCompanyTaxonomySchema(): void {
  if (_ready) return;
  if (!isSqlite()) {
    throw new TaxonomyBootstrapError(
      "UNSUPPORTED_DB_DIALECT",
      "company taxonomy is verified for SQLite only in this wave; the PostgreSQL path is not claimed",
    );
  }
  const result = applyCompanyTaxonomySchema(rawDb());
  if (result.applied) {
    log.info("[slide13b:D] taxonomy_terms installed from migration 0236 (bootstrap)");
  }
  _ready = true;
}

/** Test seam only — forces the next call to re-run apply-or-verify. */
export function __resetCompanyTaxonomyBootstrapForTests(): void {
  _ready = false;
}

function requireNamespace(ns: string): TaxonomyNamespace {
  if (!isTaxonomyNamespace(ns)) throw new TaxonomyUnknownNamespaceError(ns);
  return ns;
}

/* ───────────────────────── rows ───────────────────────── */

interface Row {
  namespace: string;
  value: string;
  label: string;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function toDto(r: Row): TaxonomyTermDto {
  return {
    namespace: r.namespace as TaxonomyNamespace,
    value: r.value,
    label: r.label,
    active: r.active === 1,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Canonical read order. Exported so tests can assert the exact SQL contract. */
export const TAXONOMY_ORDER_BY = "ORDER BY label COLLATE NOCASE, label, value";

/* ───────────────────────── reads ───────────────────────── */

export function listTaxonomyTerms(
  namespaceRaw: string,
  opts: { includeRetired?: boolean } = {},
): TaxonomyTermDto[] {
  const ns = requireNamespace(namespaceRaw);
  ensureCompanyTaxonomySchema();
  const where = opts.includeRetired ? "namespace = ?" : "namespace = ? AND active = 1";
  const rows = rawDb()
    .prepare(`SELECT namespace, value, label, active, sort_order, created_at, updated_at
              FROM taxonomy_terms WHERE ${where} ${TAXONOMY_ORDER_BY}`)
    .all(ns) as Row[];
  return rows.map(toDto);
}

export function getTaxonomyTerm(namespaceRaw: string, value: string): TaxonomyTermDto | null {
  const ns = requireNamespace(namespaceRaw);
  ensureCompanyTaxonomySchema();
  const row = rawDb()
    .prepare(`SELECT namespace, value, label, active, sort_order, created_at, updated_at
              FROM taxonomy_terms WHERE namespace = ? AND value = ?`)
    .get(ns, value) as Row | undefined;
  return row ? toDto(row) : null;
}

/* ───────────────────────── mutations ───────────────────────── */

export interface TaxonomyMutationContext {
  /** Who is acting — email or userId; written to the audit row. */
  actor: string;
}

function auditEntity(ns: TaxonomyNamespace, value: string): string {
  return `taxonomy_term:${ns}:${value}`;
}

/** What a mutation's `work` hands back: its result and the before/after audit payload (D-B2). */
interface AuditedWork<T> {
  out: T;
  /** Forensic payload: `{ namespace, value, old, new }` — built from the row as read INSIDE the transaction. */
  payload: { namespace: TaxonomyNamespace; value: string; old: Record<string, unknown> | null; new: Record<string, unknown> };
}

/**
 * Test-only seam (D-B3 proof). When set, runs INSIDE the outer transaction
 * AFTER the audit append has returned success and BEFORE COMMIT. A test uses
 * it to make the real COMMIT fail (deferred FK violation) and proves that the
 * taxonomy row, the audit DB row AND the audit mirror entry all disappear.
 * Product code never sets it.
 */
let _afterAuditHookForTests: (() => void) | null = null;
export function __setAfterAuditHookForTests(fn: (() => void) | null): void {
  _afterAuditHookForTests = fn;
}

/**
 * Runs `work` and the audit append inside ONE raw SQLite transaction.
 *
 *   • `work` performs the write and returns the before/after payload.
 *   • `appendAdminAudit` runs LAST inside the transaction; its own drizzle
 *     transaction nests as a SAVEPOINT on the same handle (getDb() and rawDb()
 *     are one connection), so the audit_log row is part of the outer commit.
 *   • Audit sentinel (`isAuditWriteFailure`) → THROW → better-sqlite3 rolls the
 *     taxonomy write back. Nothing durable, nothing mirrored (the writer does
 *     not mirror sentinels).
 *   • OUTER COMMIT FAILURE (D-B3): `appendAdminAudit` pushes the entry into its
 *     in-memory read mirror as soon as ITS savepoint releases — before our
 *     COMMIT. If COMMIT then fails, the DB rows are gone but the mirror would
 *     still show the event, and the admin audit page falls back to that mirror
 *     when its DB read fails. So on ANY throw after the audit returned a real
 *     entry we remove EXACTLY that entry (by object identity, then by id) from
 *     the mirror. No other audit entry is touched. `adminPlatformStore` itself
 *     is not edited (not owned by this wave).
 *
 * RESIDUAL (documented, not hidden): `appendAdminAudit` also bumps its private
 * write-health success counter before our COMMIT; that counter is a health
 * signal, not an audit entry, and is not reachable from outside the module.
 */
function transactWithAudit<T>(
  op: string,
  ctx: TaxonomyMutationContext,
  ns: TaxonomyNamespace,
  value: string,
  work: () => AuditedWork<T>,
): T {
  const db = rawDb();
  let auditEntry: AuditEntry | null = null;
  const run = db.transaction(() => {
    const { out, payload } = work();
    // Explicit platform tenant: taxonomy_terms is a GLOBAL registry (schema, admin
    // context). Without this, adminPlatformStore's implicit resolver derives a
    // fabricated `tenant_co_…` from any stored value containing "co_" (Opus final
    // D post-control finding).
    const entry = appendAdminAudit(ctx.actor, auditEntity(ns, value), op, { action: op, ...payload }, "tenant_platform");
    if (isAuditWriteFailure(entry)) {
      throw new TaxonomyAuditWriteError(op);
    }
    auditEntry = entry;
    if (_afterAuditHookForTests) _afterAuditHookForTests();
    return out;
  });
  try {
    return run() as T;
  } catch (err) {
    if (auditEntry) unmirrorAuditEntry(auditEntry);
    throw err;
  }
}

/** Remove exactly one (rolled-back) entry from the audit read mirror. Never touches any other entry. */
function unmirrorAuditEntry(entry: AuditEntry): void {
  const mirror = getAuditLog();
  let i = mirror.indexOf(entry);
  if (i < 0) i = mirror.findIndex((e) => e.id === entry.id && e.hash === entry.hash);
  if (i >= 0) {
    mirror.splice(i, 1);
    log.warn(`[slide13b:D] taxonomy mutation ${entry.eventType} rolled back after audit append; removed audit ${entry.id} from the read mirror (DB row rolled back with the transaction)`);
  }
}

function readRow(ns: TaxonomyNamespace, value: string): Row | undefined {
  return rawDb()
    .prepare(`SELECT namespace, value, label, active, sort_order, created_at, updated_at
              FROM taxonomy_terms WHERE namespace = ? AND value = ?`)
    .get(ns, value) as Row | undefined;
}

function labelTaken(ns: TaxonomyNamespace, label: string, exceptValue?: string): Row | undefined {
  return rawDb()
    .prepare(`SELECT namespace, value, label, active, sort_order, created_at, updated_at
              FROM taxonomy_terms
              WHERE namespace = ? AND label = ? COLLATE NOCASE
                AND (? IS NULL OR value <> ?)`)
    .get(ns, label, exceptValue ?? null, exceptValue ?? null) as Row | undefined;
}

export function createTaxonomyTerm(
  namespaceRaw: string,
  input: { value: unknown; label?: unknown },
  ctx: TaxonomyMutationContext,
): TaxonomyTermDto {
  const ns = requireNamespace(namespaceRaw);
  ensureCompanyTaxonomySchema();
  const v = validateTaxonomyText(input.value, "value");
  if (!v.ok) throw new TaxonomyValidationError(v.code, v.message);
  // Label defaults to the value (mirrors the seed convention value == label).
  const l = validateTaxonomyText(input.label === undefined || input.label === "" ? v.text : input.label, "label");
  if (!l.ok) throw new TaxonomyValidationError(l.code, l.message);

  return transactWithAudit(
    "company_taxonomy.term.create",
    ctx,
    ns,
    v.text,
    () => {
      if (readRow(ns, v.text)) {
        throw new TaxonomyConflictError("VALUE_EXISTS", `a term with value "${v.text}" already exists`);
      }
      const dupe = labelTaken(ns, l.text);
      if (dupe) {
        throw new TaxonomyConflictError(
          "LABEL_EXISTS",
          `label "${l.text}" is already used by value "${dupe.value}" (labels are unique case-insensitively)`,
        );
      }
      const now = new Date().toISOString();
      const next = (rawDb()
        .prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM taxonomy_terms WHERE namespace = ?`)
        .get(ns) as { n: number }).n;
      rawDb()
        .prepare(`INSERT INTO taxonomy_terms (namespace, value, label, active, sort_order, created_at, updated_at)
                  VALUES (?, ?, ?, 1, ?, ?, ?)`)
        .run(ns, v.text, l.text, next, now, now);
      const created = readRow(ns, v.text)!;
      return {
        out: toDto(created),
        payload: { namespace: ns, value: v.text, old: null, new: { label: created.label, active: true, sort_order: created.sort_order } },
      };
    },
  );
}

/** Edits the DISPLAY label only. `value` is immutable by construction: there is no API to change it. */
export function updateTaxonomyTermLabel(
  namespaceRaw: string,
  value: string,
  labelRaw: unknown,
  ctx: TaxonomyMutationContext,
): TaxonomyTermDto {
  const ns = requireNamespace(namespaceRaw);
  ensureCompanyTaxonomySchema();
  const l = validateTaxonomyText(labelRaw, "label");
  if (!l.ok) throw new TaxonomyValidationError(l.code, l.message);

  return transactWithAudit(
    "company_taxonomy.term.relabel",
    ctx,
    ns,
    value,
    () => {
      const cur = readRow(ns, value);
      if (!cur) throw new TaxonomyTermNotFoundError(ns, value);
      const dupe = labelTaken(ns, l.text, value);
      if (dupe) {
        throw new TaxonomyConflictError(
          "LABEL_EXISTS",
          `label "${l.text}" is already used by value "${dupe.value}" (labels are unique case-insensitively)`,
        );
      }
      rawDb()
        .prepare(`UPDATE taxonomy_terms SET label = ?, updated_at = ? WHERE namespace = ? AND value = ?`)
        .run(l.text, new Date().toISOString(), ns, value);
      const after = readRow(ns, value)!;
      return {
        out: toDto(after),
        payload: { namespace: ns, value, old: { label: cur.label }, new: { label: after.label } },
      };
    },
  );
}

function setActive(
  namespaceRaw: string,
  value: string,
  active: boolean,
  ctx: TaxonomyMutationContext,
): TaxonomyTermDto {
  const ns = requireNamespace(namespaceRaw);
  ensureCompanyTaxonomySchema();
  const op = active ? "company_taxonomy.term.reactivate" : "company_taxonomy.term.retire";
  return transactWithAudit(op, ctx, ns, value, () => {
    const cur = readRow(ns, value);
    if (!cur) throw new TaxonomyTermNotFoundError(ns, value);
    if ((cur.active === 1) === active) {
      throw new TaxonomyConflictError(
        "ALREADY_IN_STATE",
        `term "${value}" is already ${active ? "active" : "retired"}`,
      );
    }
    rawDb()
      .prepare(`UPDATE taxonomy_terms SET active = ?, updated_at = ? WHERE namespace = ? AND value = ?`)
      .run(active ? 1 : 0, new Date().toISOString(), ns, value);
    const after = readRow(ns, value)!;
    return {
      out: toDto(after),
      payload: { namespace: ns, value, old: { active: cur.active === 1 }, new: { active: after.active === 1 } },
    };
  });
}

/** Retire (active → 0). Rows holding the value keep resolving; it is no longer offered. */
export function retireTaxonomyTerm(ns: string, value: string, ctx: TaxonomyMutationContext): TaxonomyTermDto {
  return setActive(ns, value, false, ctx);
}

/** Reactivate (active → 1). */
export function reactivateTaxonomyTerm(ns: string, value: string, ctx: TaxonomyMutationContext): TaxonomyTermDto {
  return setActive(ns, value, true, ctx);
}
