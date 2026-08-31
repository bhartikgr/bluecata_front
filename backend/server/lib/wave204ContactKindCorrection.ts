/* ════════════════════════════════════════════════════════════════════════════
   WAVE 204 — R178.8 · CORRECTION OF DIVERGENT CONTACT `kind` ROWS
   ════════════════════════════════════════════════════════════════════════════
   NON-SACRED. This file is the whole mechanism. The CLI in
   `scripts/wave204_contact_kind_correction.mts` is a thin front end so that
   tests exercise exactly the code the operator runs (handbook §8 — never prove
   a replica).

   THE OWNER'S RULING (R178.8): "the records are all test data. Fix them so they
   are the same as others."

   R178.4 STILL FORBIDS DELETION. This file contains no DELETE and no DROP, and
   a test asserts that by reading this source text. Nothing is removed; one
   column on already-existing rows is brought into agreement with the hash that
   row already carries.

   ── WHAT "DIVERGENT" MEANS HERE (established from code, not from the report) ─
   The comparison is:

       contacts.kind   vs   JSON.parse(snapshot_json).kind
                            of the contact's HIGHEST-version contact_revisions row

   NOT "the row vs the cache". The cache is a process-lifetime Map that no longer
   exists on any box that has restarted. R177.2's finding (cache AHEAD of the DB)
   describes the moment of the defect; the durable record of what the user
   submitted is the revision snapshot.

   ── WHY THE SNAPSHOT IS THE TRUSTWORTHY SIDE ────────────────────────────────
   Pre-wave-200, `persistContact`'s conflict `set` omitted `kind` but INCLUDED
   `revision_hash`. So on a kind change the row received the new version and the
   new hash — a hash computed over the NEW kind (`computeRevisionHash` hashes
   `kind`) — while keeping the OLD kind. The row therefore contradicts ITSELF.
   Writing `kind = snapshot.kind` introduces no new fact: it makes the row agree
   with the attestation the row already stores.

   ── RECOVERABILITY IS PROVED PER ROW, NEVER ASSUMED ─────────────────────────
   A divergent row is corrected only when all four checks pass:
     A  a revision row exists;
     B  latest.version === row.version                (this revision produced this row)
     C  latest.revision_hash === row.revision_hash    (row carries that revision's hash)
     D  computeRevisionHash(latest.snapshot) === latest.revision_hash
                                                      (snapshot unaltered, and its
                                                       `kind` is what was hashed)
   Any row failing A–D is UNRECOVERABLE: reported separately and LEFT ALONE.
   There is no flag that overrides this. A silently guessed contact type is worse
   than a visibly stale one.

   ── THE HASH IS THE PLATFORM'S OWN ──────────────────────────────────────────
   `computeRevisionHash` is imported from `server/adminContactsStore.ts`. It is
   NOT re-implemented here. A second copy of that formula would be a replica and
   could drift from the chain it is supposed to attest.
   ════════════════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import nodePath from "node:path";
import { createRequire } from "node:module";
import { rawDb, getDbDriver } from "../db/connection";
import {
  computeRevisionHash,
  verifyChain,
  type AdminContact,
} from "../adminContactsStore";
import { appendAdminAudit, reportAuditWriteOutcome } from "../adminPlatformStore";
import { isSeedRow, isQaEmail } from "./seedDataGuard";

/* This package is ESM (`"type": "module"`). `better-sqlite3` is loaded through
   the SAME shim shape `server/db/connection.ts` uses, so the backup verifier
   opens the file with the identical driver the platform writes with. */
function makeRequire(): NodeJS.Require {
  if (typeof require === "function") return require;
  try {
    const metaUrl = (import.meta as { url?: string }).url ?? "";
    if (metaUrl) return createRequire(metaUrl);
  } catch {
    /* fall through */
  }
  return createRequire(process.cwd() + "/_");
}
const _require: NodeJS.Require = makeRequire();

/* ── Types ────────────────────────────────────────────────────────────────── */

export type Recoverability =
  | "RECOVERABLE"
  | "UNRECOVERABLE_NO_REVISION"
  | "UNRECOVERABLE_VERSION_SKEW"
  | "UNRECOVERABLE_ROW_HASH_MISMATCH"
  | "UNRECOVERABLE_SNAPSHOT_HASH_MISMATCH";

export type TestDataVerdict = "TEST_DATA" | "NOT_PROVEN_TEST_DATA";

export interface DivergentRow {
  id: string;
  legalName: string;
  email: string;
  createdBy: string;
  updatedBy: string;
  rowKind: string;
  attestedKind: string | null;
  rowVersion: number;
  latestRevisionVersion: number | null;
  rowRevisionHash: string;
  latestRevisionHash: string | null;
  recoverability: Recoverability;
  recoverabilityDetail: string;
  testDataVerdict: TestDataVerdict;
  testDataSignals: string[];
  testDataObservations: string[];
  chainOkBefore: boolean;
  chainOkAfter: boolean | null;
  corrected: boolean;
}

export interface CorrectionCounts {
  contactsBefore: number;
  contactsAfter: number;
  revisionsBefore: number;
  revisionsAfter: number;
  scanned: number;
  divergent: number;
  recoverable: number;
  unrecoverable: number;
  corrected: number;
}

export interface CorrectionReport {
  mode: "dry-run" | "apply";
  applied: boolean;
  databasePath: string;
  driver: string;
  counts: CorrectionCounts;
  backupPath: string | null;
  backupError: string | null;
  hardStopTriggered: boolean;
  refusals: string[];
  rows: DivergentRow[];
  auditEntryIds: string[];
  auditWriteFailed: boolean;
  startedAt: string;
}

export interface CorrectionOptions {
  /** Write mode. DEFAULT IS FALSE — the caller must ask for it explicitly. */
  apply?: boolean;
  /** Recorded as the audit actor. */
  actor?: string;
  /** Directory for the pre-write backup. Defaults to alongside the database. */
  backupDir?: string;
}

/* ── Reserved / synthetic-data signals ────────────────────────────────────────
   The hard stop needs POSITIVE evidence that a row is test data. It cannot be
   inferred from "the name looks fake", and — this is the part that matters —
   it cannot be REFUTED by "the name looks real" either: `seedContacts()` in
   adminContactsStore.ts deliberately seeds REAL firm names and REAL email
   domains (`deals@sequoiacap.com`, `info@a16z.com`). A realness heuristic would
   therefore reject the platform's own test data. So realness is recorded as an
   OBSERVATION for the owner to read, and the verdict rests only on durable,
   explicit markers. Wave W3.1's `isSeedRow` / `isQaEmail` are reused rather
   than re-invented; it already refuses weak inference for the same reason.  */

const RESERVED_EMAIL_DOMAIN_RE =
  /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|net|org)|test|invalid|localhost|local)$/i;

const SYNTHETIC_ACTORS: ReadonlyArray<string> = ["u_system_seed"];

interface TestDataAssessment {
  verdict: TestDataVerdict;
  signals: string[];
  observations: string[];
}

/**
 * Per-row test-data assessment. Exported so the test suite can attack it
 * directly with a row that must trip the hard stop.
 */
export function assessTestData(row: {
  email?: string | null;
  legalName?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  metadataJson?: string | null;
}): TestDataAssessment {
  const signals: string[] = [];
  const observations: string[] = [];

  let meta: Record<string, unknown> = {};
  if (row.metadataJson) {
    try {
      const parsed: unknown = JSON.parse(row.metadataJson);
      if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
    } catch {
      observations.push("metadata_json is not valid JSON");
    }
  }

  if (isSeedRow({ isSeed: meta.isSeed, metadata: meta })) {
    signals.push("explicit seed marker in metadata_json (isSeed/seed === true)");
  }

  const email = (row.email ?? "").trim();
  if (isQaEmail(email)) {
    signals.push("reserved QA email domain @capavate-qa.local");
  } else if (email && RESERVED_EMAIL_DOMAIN_RE.test(email)) {
    signals.push("reserved non-routable email domain (RFC 2606 / RFC 6761)");
  }

  const createdBy = (row.createdBy ?? "").trim();
  const updatedBy = (row.updatedBy ?? "").trim();
  if (SYNTHETIC_ACTORS.indexOf(createdBy) !== -1) {
    signals.push(`created by the synthetic seed actor "${createdBy}"`);
  }

  if (email && !isQaEmail(email) && !RESERVED_EMAIL_DOMAIN_RE.test(email)) {
    observations.push(`email domain "${email.split("@")[1] ?? email}" is routable — could belong to a real organisation`);
  }
  if (!email) observations.push("no email address on the row");
  if (row.legalName) observations.push(`legal name on the row: "${row.legalName}"`);
  if (updatedBy && SYNTHETIC_ACTORS.indexOf(updatedBy) === -1) {
    observations.push(`last updated by "${updatedBy}" (not the seed actor)`);
  }

  return {
    verdict: signals.length > 0 ? "TEST_DATA" : "NOT_PROVEN_TEST_DATA",
    signals,
    observations,
  };
}

/* ── Database helpers ─────────────────────────────────────────────────────── */

interface ContactRowShape {
  id: string;
  kind: string;
  legal_name: string;
  email: string | null;
  created_by: string;
  updated_by: string;
  version: number;
  revision_hash: string;
  metadata_json: string | null;
}

interface RevisionRowShape {
  version: number;
  revision_hash: string;
  snapshot_json: string;
}

function countRows(db: any, table: string): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return Number(r.n);
}

function databasePathOf(db: any): string {
  const name: unknown = db && db.name;
  return typeof name === "string" ? name : "(unknown)";
}

/* ── Classification (read-only; this is what the dry run prints) ──────────── */

/**
 * Reads every contact row and its highest-version revision, and returns one
 * `DivergentRow` for each row whose `kind` disagrees with the attested one.
 * WRITES NOTHING.
 */
export function analyseContactKindDivergence(): { rows: DivergentRow[]; scanned: number } {
  const db = rawDb();
  const contactRows = db
    .prepare(
      `SELECT id, kind, legal_name, email, created_by, updated_by, version, revision_hash, metadata_json
         FROM contacts`,
    )
    .all() as ContactRowShape[];

  const latestRevStmt = db.prepare(
    `SELECT version, revision_hash, snapshot_json
       FROM contact_revisions
      WHERE contact_id = ?
      ORDER BY version DESC
      LIMIT 1`,
  );

  const out: DivergentRow[] = [];

  for (let i = 0; i < contactRows.length; i++) {
    const row = contactRows[i];
    const rev = latestRevStmt.get(row.id) as RevisionRowShape | undefined;

    let attestedKind: string | null = null;
    let snapshot: AdminContact | null = null;
    if (rev) {
      try {
        snapshot = JSON.parse(rev.snapshot_json) as AdminContact;
        attestedKind = typeof snapshot.kind === "string" ? snapshot.kind : null;
      } catch {
        snapshot = null;
        attestedKind = null;
      }
    }

    // Not divergent → not this wave's business. An unreadable snapshot is
    // reported (it cannot be compared, so it cannot be corrected).
    if (rev && attestedKind !== null && attestedKind === row.kind) continue;
    if (!rev && row.kind) {
      // No revision at all AND therefore nothing to compare: only report it if
      // the row could not possibly be verified. A contact with no revision is
      // not evidence of divergence, so it is skipped, not reported.
      continue;
    }

    let recoverability: Recoverability;
    let detail: string;
    if (!rev) {
      recoverability = "UNRECOVERABLE_NO_REVISION";
      detail = "no contact_revisions row exists for this contact";
    } else if (snapshot === null || attestedKind === null) {
      recoverability = "UNRECOVERABLE_SNAPSHOT_HASH_MISMATCH";
      detail = "snapshot_json could not be parsed, or carries no `kind`";
    } else if (Number(rev.version) !== Number(row.version)) {
      recoverability = "UNRECOVERABLE_VERSION_SKEW";
      detail = `latest revision version ${rev.version} != row version ${row.version} — something wrote this row outside updateContact()`;
    } else if (rev.revision_hash !== row.revision_hash) {
      recoverability = "UNRECOVERABLE_ROW_HASH_MISMATCH";
      detail = "the row's revision_hash is not the latest revision's hash — the row and the snapshot are not two halves of one write";
    } else if (computeRevisionHash(snapshot) !== rev.revision_hash) {
      recoverability = "UNRECOVERABLE_SNAPSHOT_HASH_MISMATCH";
      detail = "computeRevisionHash(snapshot) does not re-derive the stored hash — the snapshot cannot be trusted to state the submitted kind";
    } else {
      recoverability = "RECOVERABLE";
      detail = "row hash == latest revision hash, versions agree, and the snapshot re-derives that hash (which covers `kind`)";
    }

    const assessment = assessTestData({
      email: row.email,
      legalName: row.legal_name,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      metadataJson: row.metadata_json,
    });

    let chainOkBefore = false;
    try {
      chainOkBefore = verifyChain(row.id).ok;
    } catch {
      chainOkBefore = false;
    }

    out.push({
      id: row.id,
      legalName: row.legal_name,
      email: row.email ?? "",
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      rowKind: row.kind,
      attestedKind,
      rowVersion: Number(row.version),
      latestRevisionVersion: rev ? Number(rev.version) : null,
      rowRevisionHash: row.revision_hash,
      latestRevisionHash: rev ? rev.revision_hash : null,
      recoverability,
      recoverabilityDetail: detail,
      testDataVerdict: assessment.verdict,
      testDataSignals: assessment.signals,
      testDataObservations: assessment.observations,
      chainOkBefore,
      chainOkAfter: null,
      corrected: false,
    });
  }

  return { rows: out, scanned: contactRows.length };
}

/* ── Backup ──────────────────────────────────────────────────────────────── */

export interface BackupResult {
  path: string | null;
  error: string | null;
}

/**
 * Takes a consistent copy of the SQLite database BEFORE any write, using
 * `VACUUM INTO` (synchronous, and it produces a single self-contained file even
 * in WAL mode — a bare file copy would not). The copy is then re-opened and its
 * `contacts` count compared with the live one; a backup nobody verified is not a
 * backup. Returns `{ path: null, error }` on ANY failure, and the caller REFUSES
 * to write when that happens.
 */
export function backupDatabase(backupDir?: string): BackupResult {
  const db = rawDb();
  const livePath = databasePathOf(db);
  if (livePath === ":memory:" || livePath === "" || livePath === "(unknown)") {
    return {
      path: null,
      error: `cannot back up an in-memory or unidentifiable database (path: "${livePath}")`,
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = backupDir ?? nodePath.dirname(nodePath.resolve(livePath));
  const target = nodePath.join(dir, `${nodePath.basename(livePath)}.wave204-backup-${stamp}.db`);

  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(target)) {
      return { path: null, error: `backup target already exists, refusing to overwrite: ${target}` };
    }
    const liveContacts = countRows(db, "contacts");
    const liveRevisions = countRows(db, "contact_revisions");

    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* not fatal — VACUUM INTO reads the WAL too */
    }
    db.prepare(`VACUUM INTO ?`).run(target);

    if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
      return { path: null, error: `backup file was not created or is empty: ${target}` };
    }

    // Verify the copy actually contains the rows.
    const Database = _require("better-sqlite3");
    const check = new Database(target, { readonly: true });
    let copiedContacts = -1;
    let copiedRevisions = -1;
    try {
      copiedContacts = countRows(check, "contacts");
      copiedRevisions = countRows(check, "contact_revisions");
    } finally {
      check.close();
    }
    if (copiedContacts !== liveContacts || copiedRevisions !== liveRevisions) {
      return {
        path: null,
        error:
          `backup verification FAILED: live contacts=${liveContacts} revisions=${liveRevisions}, ` +
          `backup contacts=${copiedContacts} revisions=${copiedRevisions}`,
      };
    }
    return { path: target, error: null };
  } catch (err) {
    return { path: null, error: (err as Error).message };
  }
}

/* ── The correction ──────────────────────────────────────────────────────── */

const AUDIT_ROUTE = "wave204ContactKindCorrection";
const AUDIT_ACTION = "contact.kind.corrected";
const AUDIT_SUMMARY_ACTION = "contact.kind.correction.run";

/**
 * DRY RUN IS THE DEFAULT. `apply: true` is the only way to write, and even then
 * the run refuses unless: a backup succeeded, every divergent row is provably
 * test data, and every UPDATE affects exactly one row with both table counts
 * unchanged (checked inside the transaction, so a mismatch ROLLS BACK).
 */
export function runContactKindCorrection(opts: CorrectionOptions = {}): CorrectionReport {
  const apply = opts.apply === true;
  const actor = opts.actor ?? "wave204_correction_script";
  const startedAt = new Date().toISOString();
  const refusals: string[] = [];

  const driver = getDbDriver() ?? "unknown";
  if (driver !== "sqlite") {
    return {
      mode: apply ? "apply" : "dry-run",
      applied: false,
      databasePath: "(not opened)",
      driver,
      counts: {
        contactsBefore: 0, contactsAfter: 0, revisionsBefore: 0, revisionsAfter: 0,
        scanned: 0, divergent: 0, recoverable: 0, unrecoverable: 0, corrected: 0,
      },
      backupPath: null,
      backupError: null,
      hardStopTriggered: false,
      refusals: [`driver is "${driver}", not sqlite — this correction is only demonstrated and only supported on SQLite`],
      rows: [],
      auditEntryIds: [],
      auditWriteFailed: false,
      startedAt,
    };
  }

  const db = rawDb();
  const databasePath = databasePathOf(db);
  const contactsBefore = countRows(db, "contacts");
  const revisionsBefore = countRows(db, "contact_revisions");

  const analysis = analyseContactKindDivergence();
  const rows = analysis.rows;
  const recoverable = rows.filter((r) => r.recoverability === "RECOVERABLE");
  const unrecoverable = rows.filter((r) => r.recoverability !== "RECOVERABLE");

  // HARD STOP — assessed over EVERY divergent row, recoverable or not, because
  // the question "is this real data?" is not conditional on recoverability.
  const notProven = rows.filter((r) => r.testDataVerdict === "NOT_PROVEN_TEST_DATA");
  const hardStopTriggered = notProven.length > 0;
  if (hardStopTriggered) {
    refusals.push(
      `HARD STOP: ${notProven.length} divergent row(s) carry no durable test-data marker ` +
        `(${notProven.map((r) => r.id).join(", ")}). No row is written. Show this to the owner ` +
        `before anything is corrected.`,
    );
  }

  const baseCounts: CorrectionCounts = {
    contactsBefore,
    contactsAfter: contactsBefore,
    revisionsBefore,
    revisionsAfter: revisionsBefore,
    scanned: analysis.scanned,
    divergent: rows.length,
    recoverable: recoverable.length,
    unrecoverable: unrecoverable.length,
    corrected: 0,
  };

  if (!apply) {
    return {
      mode: "dry-run",
      applied: false,
      databasePath,
      driver,
      counts: baseCounts,
      backupPath: null,
      backupError: null,
      hardStopTriggered,
      refusals,
      rows,
      auditEntryIds: [],
      auditWriteFailed: false,
      startedAt,
    };
  }

  if (hardStopTriggered || recoverable.length === 0) {
    if (recoverable.length === 0 && !hardStopTriggered) {
      refusals.push("nothing to correct: no divergent row has a recoverable attested kind");
    }
    return {
      mode: "apply",
      applied: false,
      databasePath,
      driver,
      counts: baseCounts,
      backupPath: null,
      backupError: null,
      hardStopTriggered,
      refusals,
      rows,
      auditEntryIds: [],
      auditWriteFailed: false,
      startedAt,
    };
  }

  /* ── BACKUP FIRST. No backup, no write. ── */
  const backup = backupDatabase(opts.backupDir);
  if (backup.path === null) {
    refusals.push(`REFUSING TO WRITE — the database backup failed: ${backup.error ?? "unknown error"}`);
    return {
      mode: "apply",
      applied: false,
      databasePath,
      driver,
      counts: baseCounts,
      backupPath: null,
      backupError: backup.error,
      hardStopTriggered,
      refusals,
      rows,
      auditEntryIds: [],
      auditWriteFailed: false,
      startedAt,
    };
  }

  /* ── One transaction. Any surprise rolls the whole thing back. ── */
  const update = db.prepare(`UPDATE contacts SET kind = ? WHERE id = ? AND kind = ?`);
  const applyAll = db.transaction(() => {
    for (let i = 0; i < recoverable.length; i++) {
      const r = recoverable[i];
      const res = update.run(r.attestedKind, r.id, r.rowKind);
      if (Number(res.changes) !== 1) {
        throw new Error(
          `ABORT: UPDATE for ${r.id} affected ${res.changes} row(s), expected exactly 1. ` +
            `Nothing has been written — the transaction is rolled back.`,
        );
      }
    }
    const cAfter = countRows(db, "contacts");
    const rAfter = countRows(db, "contact_revisions");
    if (cAfter !== contactsBefore) {
      throw new Error(`ABORT: contacts count changed ${contactsBefore} -> ${cAfter}. Rolled back.`);
    }
    if (rAfter !== revisionsBefore) {
      throw new Error(`ABORT: contact_revisions count changed ${revisionsBefore} -> ${rAfter}. Rolled back.`);
    }
  });

  try {
    applyAll();
  } catch (err) {
    refusals.push((err as Error).message);
    return {
      mode: "apply",
      applied: false,
      databasePath,
      driver,
      counts: {
        ...baseCounts,
        contactsAfter: countRows(db, "contacts"),
        revisionsAfter: countRows(db, "contact_revisions"),
      },
      backupPath: backup.path,
      backupError: null,
      hardStopTriggered,
      refusals,
      rows,
      auditEntryIds: [],
      auditWriteFailed: false,
      startedAt,
    };
  }

  for (let i = 0; i < recoverable.length; i++) {
    recoverable[i].corrected = true;
    try {
      recoverable[i].chainOkAfter = verifyChain(recoverable[i].id).ok;
    } catch {
      recoverable[i].chainOkAfter = false;
    }
  }

  /* ── Audit through wave 186's existing writer. No second audit path. ── */
  const auditEntryIds: string[] = [];
  let auditWriteFailed = false;
  for (let i = 0; i < recoverable.length; i++) {
    const r = recoverable[i];
    const entry = appendAdminAudit(actor, `contact:${r.id}`, AUDIT_ACTION, {
      ruling: "R178.8",
      wave: 204,
      column: "kind",
      from: r.rowKind,
      to: r.attestedKind,
      attestedBy: `contact_revisions v${r.latestRevisionVersion} revision_hash ${r.latestRevisionHash}`,
      rowVersionUnchanged: r.rowVersion,
      backupPath: backup.path,
    });
    if (!reportAuditWriteOutcome(entry, {
      bearing: "identity",
      action: AUDIT_ACTION,
      route: AUDIT_ROUTE,
      subject: `contact:${r.id}`,
    })) {
      auditWriteFailed = true;
    } else {
      auditEntryIds.push(entry.id);
    }
  }

  const contactsAfter = countRows(db, "contacts");
  const revisionsAfter = countRows(db, "contact_revisions");

  const summary = appendAdminAudit(actor, "contacts:wave204", AUDIT_SUMMARY_ACTION, {
    ruling: "R178.8",
    wave: 204,
    databasePath,
    backupPath: backup.path,
    scanned: analysis.scanned,
    divergent: rows.length,
    corrected: recoverable.length,
    leftAlone: unrecoverable.length,
    contactsBefore,
    contactsAfter,
    revisionsBefore,
    revisionsAfter,
    correctedIds: recoverable.map((r) => r.id),
  });
  if (!reportAuditWriteOutcome(summary, {
    bearing: "identity",
    action: AUDIT_SUMMARY_ACTION,
    route: AUDIT_ROUTE,
    subject: "contacts:wave204",
  })) {
    auditWriteFailed = true;
  } else {
    auditEntryIds.push(summary.id);
  }

  return {
    mode: "apply",
    applied: true,
    databasePath,
    driver,
    counts: {
      contactsBefore,
      contactsAfter,
      revisionsBefore,
      revisionsAfter,
      scanned: analysis.scanned,
      divergent: rows.length,
      recoverable: recoverable.length,
      unrecoverable: unrecoverable.length,
      corrected: recoverable.length,
    },
    backupPath: backup.path,
    backupError: null,
    hardStopTriggered,
    refusals,
    rows,
    auditEntryIds,
    auditWriteFailed,
    startedAt,
  };
}

/* ── Owner-readable rendering ────────────────────────────────────────────── */

/**
 * Plain-language report. The owner is not an engineer, so every line has to say
 * what it means, and the dry-run version has to make clear that nothing has
 * happened yet.
 */
export function formatReportForOwner(report: CorrectionReport): string {
  const L: string[] = [];
  const rule = "".padEnd(78, "=");
  L.push(rule);
  L.push("WAVE 204 - CONTACT TYPE CORRECTION" + (report.mode === "dry-run" ? "   (DRY RUN - NOTHING WAS CHANGED)" : "   (WRITE MODE)"));
  L.push(rule);
  L.push(`Started:        ${report.startedAt}`);
  L.push(`Database:       ${report.databasePath}   (driver: ${report.driver})`);
  L.push(`Backup:         ${report.backupPath ?? (report.mode === "dry-run" ? "not needed - a dry run writes nothing" : "NONE")}`);
  if (report.backupError) L.push(`Backup error:   ${report.backupError}`);
  L.push("");
  L.push("ROW COUNTS - these prove nothing was lost:");
  L.push(`  contacts            before ${report.counts.contactsBefore}   after ${report.counts.contactsAfter}`);
  L.push(`  contact history      before ${report.counts.revisionsBefore}   after ${report.counts.revisionsAfter}`);
  L.push("");
  L.push(`Contacts examined:                 ${report.counts.scanned}`);
  L.push(`Contacts with the wrong type:      ${report.counts.divergent}`);
  L.push(`  ... where the right type is known and proven:  ${report.counts.recoverable}`);
  L.push(`  ... where it is NOT known (left untouched):    ${report.counts.unrecoverable}`);
  L.push(`Contacts actually changed:         ${report.counts.corrected}`);
  L.push("");

  if (report.rows.length === 0) {
    L.push("No contact has a type that disagrees with its own saved history.");
    L.push("There is nothing to correct. (Running this again is always safe.)");
  }

  for (let i = 0; i < report.rows.length; i++) {
    const r = report.rows[i];
    L.push("-".padEnd(78, "-"));
    L.push(`${i + 1}. ${r.legalName || "(no name)"}    [${r.id}]`);
    L.push(`   email:                ${r.email || "(none)"}`);
    L.push(`   type stored on record: ${r.rowKind}`);
    L.push(`   type last submitted:   ${r.attestedKind ?? "(cannot be determined)"}`);
    if (r.recoverability === "RECOVERABLE") {
      L.push(`   VERDICT: the submitted type is PROVEN by this record's own security hash.`);
      L.push(`            ${report.mode === "dry-run" ? "WOULD CHANGE" : r.corrected ? "CHANGED" : "NOT CHANGED"}: "${r.rowKind}" -> "${r.attestedKind}"`);
    } else {
      L.push(`   VERDICT: LEFT ALONE - the correct type cannot be proven.`);
      L.push(`            reason: ${r.recoverabilityDetail}`);
      L.push(`            A guessed contact type would be worse than a visibly stale one.`);
    }
    L.push(`   is this test data?     ${r.testDataVerdict === "TEST_DATA" ? "YES" : "*** NOT PROVEN - THIS STOPS THE WHOLE RUN ***"}`);
    for (let s = 0; s < r.testDataSignals.length; s++) L.push(`            proof:       ${r.testDataSignals[s]}`);
    for (let o = 0; o < r.testDataObservations.length; o++) L.push(`            note:        ${r.testDataObservations[o]}`);
    L.push(`   history intact:        before ${r.chainOkBefore ? "yes" : "NO"}${r.chainOkAfter === null ? "" : `   after ${r.chainOkAfter ? "yes" : "NO"}`}`);
  }

  if (report.refusals.length > 0) {
    L.push("");
    L.push("!".padEnd(78, "!"));
    L.push("THE SCRIPT REFUSED TO PROCEED:");
    for (let i = 0; i < report.refusals.length; i++) L.push(`  - ${report.refusals[i]}`);
    L.push("!".padEnd(78, "!"));
  }

  if (report.auditEntryIds.length > 0) {
    L.push("");
    L.push(`Audit entries written to the permanent log: ${report.auditEntryIds.length}`);
  }
  if (report.auditWriteFailed) {
    L.push("WARNING: at least one audit entry did NOT reach the log. Check GET /api/admin/audit-write-health.");
  }

  if (report.mode === "dry-run") {
    L.push("");
    L.push("This was a DRY RUN. Nothing in the database was changed.");
    L.push("To apply these changes, re-run the same command with --apply.");
  }
  L.push(rule);
  return L.join("\n");
}
