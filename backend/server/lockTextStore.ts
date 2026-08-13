/**
 * WAVE 33 · CP-PIPE-10 — LOCK 1 wording store (OQ-5, Part B).
 *
 * Durable, DB-driven storage for lock wording the owner supplies. NO TEXT IS
 * AUTHORED HERE. This file can store, read and version a lock's wording; it
 * cannot invent one, and the harness pins that by asserting no lock-like prose
 * exists anywhere in this module or the engine.
 *
 * All imports are STATIC. Wave 32B lost a cap-table path to a lazy
 * `require("./captableCommitStore")` that threw under both TS runtimes and was
 * swallowed into `[]` — dead in dev, invisible to tests, live in the bundled
 * production build. Nothing in this file is loaded lazily.
 */
import { randomBytes } from "node:crypto";
import { rawDb } from "./db/connection";
import { applyLockTextSchema } from "./lib/applyLockTextSchema";
import { describeLockNotice, LOCK1_TEXT_KEY, type LockNotice } from "./lib/lock1Provenance";

function db() {
  const d = rawDb();
  applyLockTextSchema(d as never);
  return d;
}

interface LockRow {
  key: string;
  text: string | null;
  set_by: string | null;
  set_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Read one lock's notice.
 *
 * A MISSING ROW AND AN UNSUPPLIED WORDING ARE THE SAME ANSWER TO THE SURFACE —
 * both mean "the exact text is not available, do not render an approximation" —
 * but they are NOT the same fact, so `exists` distinguishes them for the admin
 * view. Collapsing them would let a typo in a lock key read as a lock whose
 * wording is merely outstanding, and nobody would ever chase it.
 */
export function getLockNotice(key: string): LockNotice & { exists: boolean } {
  const k = (key ?? "").trim();
  if (!k) return { ...describeLockNotice({ key: "", text: null }), exists: false };
  const row = db()
    .prepare(`SELECT key, text, set_by, set_at, created_at, updated_at FROM platform_lock_text WHERE key = ?`)
    .get(k) as LockRow | undefined;
  if (!row) return { ...describeLockNotice({ key: k, text: null }), exists: false };
  return {
    ...describeLockNotice({ key: row.key, text: row.text, setBy: row.set_by, setAt: row.set_at }),
    exists: true,
  };
}

export function getLock1Notice(): LockNotice & { exists: boolean } {
  return getLockNotice(LOCK1_TEXT_KEY);
}

export function listLockNotices(): Array<LockNotice & { exists: boolean }> {
  const rows = db()
    .prepare(`SELECT key, text, set_by, set_at, created_at, updated_at FROM platform_lock_text ORDER BY key ASC`)
    .all() as LockRow[];
  return rows.map((row) => ({
    ...describeLockNotice({ key: row.key, text: row.text, setBy: row.set_by, setAt: row.set_at }),
    exists: true,
  }));
}

export class LockTextError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "LockTextError";
  }
}

/**
 * Supply or replace a lock's verbatim wording.
 *
 * THE TEXT IS STORED EXACTLY AS GIVEN. No trimming, no normalisation, no case
 * folding, no whitespace collapsing. A lock is reproduced or it is not a lock,
 * and "we only trimmed it" is how verbatim text stops being verbatim. The
 * emptiness check below inspects a trimmed COPY and never writes it.
 *
 * The revision row is inserted BEFORE the current value is updated. If the
 * update then fails, the history holds a record of an attempt that did not
 * land — recoverable. The reverse order can change the live wording of a legal
 * lock while recording nothing, which is the ordering defect this build has
 * already paid for once with money (an obligation committed before the row that
 * satisfied it existed).
 */
export function setLockText(args: { key: string; text: string; setBy: string }): LockNotice & { exists: boolean } {
  const key = (args.key ?? "").trim();
  if (!key) throw new LockTextError("LOCK_KEY_REQUIRED", "A lock key is required.");
  if (typeof args.text !== "string" || args.text.trim() === "") {
    throw new LockTextError(
      "LOCK_TEXT_REQUIRED",
      "Lock wording cannot be empty. To record that a lock's wording is outstanding, leave it unset rather than storing a blank.",
    );
  }
  const setBy = (args.setBy ?? "").trim();
  if (!setBy) {
    throw new LockTextError(
      "LOCK_ACTOR_REQUIRED",
      "The person supplying a lock's wording must be recorded. Legal text with no attributable author cannot be verified later.",
    );
  }

  const d = db();
  const now = new Date().toISOString();
  const revId = `lockrev_${randomBytes(8).toString("hex")}`;

  const tx = d.transaction(() => {
    d.prepare(
      `INSERT INTO platform_lock_text_revision (id, key, text, set_by, recorded_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(revId, key, args.text, setBy, now);
    d.prepare(
      `INSERT INTO platform_lock_text (key, text, set_by, set_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET text = excluded.text, set_by = excluded.set_by,
                                      set_at = excluded.set_at, updated_at = excluded.updated_at`,
    ).run(key, args.text, setBy, now, now, now);
  });
  tx();

  return getLockNotice(key);
}

export function listLockRevisions(key: string): Array<{ id: string; text: string | null; setBy: string | null; recordedAt: string }> {
  const k = (key ?? "").trim();
  if (!k) return [];
  const rows = db()
    .prepare(`SELECT id, text, set_by, recorded_at FROM platform_lock_text_revision WHERE key = ? ORDER BY recorded_at DESC, id DESC`)
    .all(k) as Array<{ id: string; text: string | null; set_by: string | null; recorded_at: string }>;
  return rows.map((r) => ({ id: r.id, text: r.text, setBy: r.set_by, recordedAt: r.recorded_at }));
}
