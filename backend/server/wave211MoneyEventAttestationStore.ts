/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 211 · ITEM B — WHERE THE PARTNER'S MONEY-EVENT ATTESTATIONS ARE KEPT SO
 * THEY ARE PROVABLE YEARS LATER.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THE EVENT'S OWN ROW AND NOT A NEW TABLE — R171.1 cuts both ways, so this was
 * decided by reading the candidates rather than by preference:
 *
 *   1. `legal_consents` (`server/legalConsentStore.ts`) admits a CLOSED vocabulary
 *      of contexts — signup, new_company, onboarding, settings_update. None of the
 *      four money events is one of them, and widening that vocabulary would mean
 *      editing an area wave 210 is concurrently rewriting.
 *   2. `spv_launch_signoffs` (`server/spvLaunchSignoffStore.ts`) keeps the exact
 *      displayed text ON THE ROW it belongs to. That is the structure the brief
 *      tells this wave to follow, and it is adopted here — as a TEMPLATE, not as a
 *      destination, because that table is keyed to a vehicle launch.
 *   3. Wave 186's audit writer (`appendAdminAudit`) already exists and is the ONE
 *      audit path. It is reused, and no second audit path is created.
 *
 * So: no new table, no second consent store, no second audit path.
 *
 * WHY DEDICATED COLUMNS AND NOT A JSON BLOB. The SPV read routes re-spread hydrated
 * rows to LPs. A partner's typed legal name, IP address and user agent must not
 * travel with a distribution's figures. These columns are deliberately absent from
 * `shared/schema.ts`, so no existing drizzle select can pick them up and no existing
 * response shape changes.
 *
 * WHY THIS FILE OWNS ITS OWN DDL. `server/db/connection.ts` builds the SQLite test
 * and bootstrap databases from DDL inlined in THAT file rather than from the
 * numbered migrations, and it is SACRED. Without a self-heal, every in-memory test
 * database would lack these columns and this wave's own proofs would pass against
 * nothing — "a check that passed while checking nothing". The DDL is therefore READ
 * FROM migration 0220 itself, never re-typed here, so installer and migration cannot
 * drift.
 *
 * FAIL CLOSED, AND SAY SO. Every function reports an outcome. Nothing returns a
 * cheerful default. If the columns are unavailable, if the UPDATE matches no row, or
 * if the read-back does not equal what was written, the caller is told the
 * attestation was NOT recorded — and the route refuses on that basis. A gate that
 * fails open is worse than no gate, because it reports success.
 *
 * WRITE ONCE. Every UPDATE carries `WHERE <prefix>_version IS NULL`, so a recorded
 * attestation can never be overwritten by a later call. Nothing here deletes a row
 * or a column value (R195.5).
 *
 * NO FABRICATED EVIDENCE (R187.1). The timestamp is the server's. The IP address is
 * the server's own resolution of the peer; when that resolution yields nothing
 * usable, the address column stays NULL and a companion column records the field as
 * NOT CAPTURED. A signature record containing an invented value discredits every
 * other signature the platform has produced.
 *
 * RULINGS: R171.1, R176.1, R187.1, R187.3, R188.5, R195.5.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDbDriver, rawDb } from "./db/connection";
import { log } from "./lib/logger";

const MIGRATION_BASENAME = "0220_wave211_money_event_attestation.sql";

/** Recorded in the `*_ip_capture` column so a NULL ip is readable as evidence. */
export const W211_IP_CAPTURED = "captured";
export const W211_IP_NOT_CAPTURED = "not_captured";

/**
 * The four gated actions, each identified by the table it writes and the column
 * prefix its attestation occupies.
 *
 * `spv_lp_invite` appears TWICE with different prefixes. That is deliberate: one row
 * can be both the invitation that was sent and the commitment later recorded against
 * it, because `recordLpCommitIdentity` advances a matched invite in place. Sharing a
 * prefix would either let the commitment overwrite the invitation's attestation or —
 * because of the write-once latch — refuse the commitment outright.
 */
export type Wave211Slot = "distribution" | "capital_call" | "lp_invitation" | "lp_commitment";

interface SlotSpec {
  table: string;
  prefix: string;
  /** Money events carry draft 03's required "Basis of determination" free text. */
  hasBasis: boolean;
  /** Whether this slot stores the currency-confirmation tick the partner already gives. */
  hasCurrencyConfirmation: boolean;
}

const SLOTS: Record<Wave211Slot, SlotSpec> = {
  distribution: {
    table: "spv_distribution",
    prefix: "attestation",
    hasBasis: true,
    hasCurrencyConfirmation: true,
  },
  capital_call: {
    table: "spv_capital_calls",
    prefix: "attestation",
    hasBasis: true,
    hasCurrencyConfirmation: true,
  },
  lp_invitation: {
    table: "spv_lp_invite",
    prefix: "attestation",
    hasBasis: false,
    hasCurrencyConfirmation: false,
  },
  lp_commitment: {
    table: "spv_lp_invite",
    prefix: "commit_attestation",
    hasBasis: false,
    hasCurrencyConfirmation: true,
  },
};

export function wave211SlotSpec(slot: Wave211Slot): { table: string; prefix: string } {
  const s = SLOTS[slot];
  return { table: s.table, prefix: s.prefix };
}

/** The nine evidence columns every slot has, plus the slot's optional extras. */
function slotColumns(slot: Wave211Slot): string[] {
  const s = SLOTS[slot];
  const p = s.prefix;
  const cols = [
    `${p}_version`,
    `${p}_text`,
    `${p}_text_sha256`,
    `${p}_signed_name`,
    `${p}_signed_at`,
    `${p}_signed_by`,
    `${p}_ip`,
    `${p}_ip_capture`,
    `${p}_user_agent`,
  ];
  if (s.hasBasis) cols.push(`${p}_basis`);
  if (s.hasCurrencyConfirmation) {
    cols.push(`${p}_currency_confirmed`, `${p}_currency_confirmed_code`);
  }
  return cols;
}

export function wave211SlotColumns(slot: Wave211Slot): string[] {
  return slotColumns(slot);
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  SELF-HEAL — the DDL is read out of migration 0220, never re-typed
 * ═══════════════════════════════════════════════════════════════════════════ */

function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

/**
 * The `ALTER TABLE … ADD COLUMN …` statements, taken from migration 0220.
 *
 * Comment lines are dropped BEFORE any conclusion is drawn from the text — the
 * migration's header is prose and must never be executed or matched against. Each
 * statement is applied on its own, because SQLite adds one column per ALTER and
 * because a column that already exists must not abort the ones that follow.
 */
function readAlterStatements(): string[] {
  let sql: string | null = null;
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) {
        sql = fs.readFileSync(p, "utf8");
        break;
      }
    } catch {
      /* try the next candidate */
    }
  }
  if (sql == null) return [];
  const executable = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return executable
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /^ALTER\s+TABLE/i.test(s));
}

/** Which of a slot's columns the live table actually has. Inspected, never assumed. */
export function wave211PresentColumns(slot: Wave211Slot): string[] {
  if (getDbDriver() !== "sqlite") return [];
  const { table } = wave211SlotSpec(slot);
  try {
    const db: any = rawDb();
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    const have = new Set(info.map((c) => String(c.name)));
    return slotColumns(slot).filter((c) => have.has(c));
  } catch {
    return [];
  }
}

export type EnsureOutcome = { ok: true; added: string[] } | { ok: false; reason: string };

/**
 * Make the columns exist, idempotently, by INSPECTING the table — never by a
 * module-level boolean, which would answer "already done" for a second in-memory
 * database that has none of them.
 */
export function wave211EnsureColumns(slot: Wave211Slot): EnsureOutcome {
  if (getDbDriver() !== "sqlite") {
    /* On Postgres the numbered migration is the only installer. This file does not
       attempt DDL there, and says so rather than reporting a false success. */
    return { ok: false, reason: "NOT_SQLITE_MIGRATION_OWNS_DDL" };
  }
  const { table } = wave211SlotSpec(slot);
  const want = slotColumns(slot);
  const present = new Set(wave211PresentColumns(slot));
  const missing = want.filter((c) => !present.has(c));
  if (missing.length === 0) return { ok: true, added: [] };

  const statements = readAlterStatements();
  if (statements.length === 0) {
    return { ok: false, reason: `MIGRATION_NOT_READABLE:${MIGRATION_BASENAME}` };
  }
  const added: string[] = [];
  const db: any = rawDb();
  for (const stmt of statements) {
    /* Only this slot's table is touched by this call. A statement for another
       table is skipped here and applied by that slot's own ensure. */
    if (!new RegExp(`ALTER\\s+TABLE\\s+${table}\\b`, "i").test(stmt)) continue;
    const col = /ADD\s+COLUMN\s+([A-Za-z0-9_]+)/i.exec(stmt)?.[1];
    if (col == null || !want.includes(col) || present.has(col)) continue;
    try {
      db.prepare(stmt).run();
      added.push(col);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      /* "duplicate column name" means another caller won the race. Not a failure. */
      if (!/duplicate column/i.test(msg)) {
        log.error(`[wave211AttestationStore] ALTER failed for ${col}:`, msg);
      }
    }
  }
  const stillMissing = slotColumns(slot).filter((c) => !wave211PresentColumns(slot).includes(c));
  if (stillMissing.length > 0) {
    return { ok: false, reason: `COLUMNS_MISSING:${stillMissing.join(",")}` };
  }
  return { ok: true, added };
}

/**
 * Is the evidence storage usable for this slot?
 *
 * The gate calls this FIRST, before it looks at anything the partner typed. That
 * ordering is the single most important safety property of this wave: if storage
 * were checked last, a storage fault would be reported to the partner as a problem
 * with their name or their ticks.
 */
export function wave211StorageAvailable(slot: Wave211Slot): { ok: true } | { ok: false; reason: string } {
  const ensured = wave211EnsureColumns(slot);
  const present = wave211PresentColumns(slot);
  const missing = slotColumns(slot).filter((c) => !present.includes(c));
  if (missing.length === 0) return { ok: true };
  return { ok: false, reason: ensured.ok ? `COLUMNS_MISSING:${missing.join(",")}` : ensured.reason };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  WRITE
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface Wave211AttestationInput {
  slot: Wave211Slot;
  /** The primary key of the row the attestation belongs to. */
  rowId: string;
  /** The signature, already validated and whitespace-folded by the shared module. */
  signedName: string;
  /** The frozen version identifier of the text that was shown. */
  version: string;
  /** The exact text that was shown, verbatim. */
  attestationText: string;
  /** The acting user's id, as the SERVER resolved it. Never client-supplied. */
  signedBy: string;
  /** The server's own resolution of the peer address, or `null`. */
  observedIp: string | null;
  /** The request's user agent, or `null` when the request carried none. */
  userAgent: string | null;
  /** Draft 03's basis of determination. Required for money events, else `null`. */
  basis?: string | null;
  /** Whether the partner gave the currency-confirmation tick, and against what code. */
  currencyConfirmed?: boolean;
  currencyConfirmedCode?: string | null;
}

export interface Wave211AttestationRecord {
  slot: Wave211Slot;
  rowId: string;
  version: string;
  attestationText: string;
  attestationTextSha256: string;
  signedName: string;
  signedAt: string;
  signedBy: string;
  ip: string | null;
  ipCapture: string;
  userAgent: string | null;
  basis: string | null;
  currencyConfirmed: string | null;
  currencyConfirmedCode: string | null;
}

export type Wave211RecordOutcome =
  | { ok: true; record: Wave211AttestationRecord }
  | { ok: false; code: string; detail: string };

/** SHA-256 of the stored text, hex. R187.3 — the text AND a digest of it. */
export function wave211TextSha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * An address is only recorded when the server actually observed one. The rate-limit
 * resolver returns the literal string `unknown` when it has nothing, and `unknown`
 * is not an address — storing it would put a word where evidence belongs.
 */
export function wave211UsableObservedIp(raw: string | null | undefined): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s.length === 0) return null;
  if (s.toLowerCase() === "unknown") return null;
  return s;
}

/** Read an attestation back out of the row it was written to. */
export function wave211ReadAttestation(slot: Wave211Slot, rowId: string): Wave211AttestationRecord | null {
  if (getDbDriver() !== "sqlite") return null;
  const { table, prefix } = wave211SlotSpec(slot);
  const spec = SLOTS[slot];
  const present = wave211PresentColumns(slot);
  if (!present.includes(`${prefix}_version`)) return null;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT ${present.join(", ")} FROM ${table} WHERE id = ?`)
      .get(rowId) as Record<string, unknown> | undefined;
    if (row == null) return null;
    const version = row[`${prefix}_version`];
    /* Presence and type BEFORE any equality comparison (R176.1). A row with no
       attestation returns null, and null is never compared as if it were a value. */
    if (typeof version !== "string" || version.length === 0) return null;
    const asText = (k: string): string | null => {
      const v = row[k];
      return typeof v === "string" ? v : null;
    };
    return {
      slot,
      rowId,
      version,
      attestationText: asText(`${prefix}_text`) ?? "",
      attestationTextSha256: asText(`${prefix}_text_sha256`) ?? "",
      signedName: asText(`${prefix}_signed_name`) ?? "",
      signedAt: asText(`${prefix}_signed_at`) ?? "",
      signedBy: asText(`${prefix}_signed_by`) ?? "",
      ip: asText(`${prefix}_ip`),
      ipCapture: asText(`${prefix}_ip_capture`) ?? W211_IP_NOT_CAPTURED,
      userAgent: asText(`${prefix}_user_agent`),
      basis: spec.hasBasis ? asText(`${prefix}_basis`) : null,
      currencyConfirmed: spec.hasCurrencyConfirmation ? asText(`${prefix}_currency_confirmed`) : null,
      currencyConfirmedCode: spec.hasCurrencyConfirmation
        ? asText(`${prefix}_currency_confirmed_code`)
        : null,
    };
  } catch {
    return null;
  }
}

/**
 * Record the attestation, then READ IT BACK and compare field by field.
 *
 * A write that reports success while the row still holds the old value is the
 * §5.10 failure class. The read-back is how this wave refuses to take the driver's
 * word for it, and the digest self-check at the end is how it refuses to take its
 * own word for it either.
 */
export function wave211RecordAttestation(input: Wave211AttestationInput): Wave211RecordOutcome {
  const available = wave211StorageAvailable(input.slot);
  if (!available.ok) {
    return { ok: false, code: "W211_ATTESTATION_STORAGE_UNAVAILABLE", detail: available.reason };
  }

  const text = input.attestationText;
  if (typeof text !== "string" || text.trim().length === 0) {
    /* ITEM B — an attestation with no stored text is not an attestation. Refused
       here as well as at the gate, because this function is the last line before
       the disk. */
    return { ok: false, code: "W211_ATTESTATION_TEXT_MISSING", detail: "no text supplied" };
  }
  const signedName = input.signedName;
  if (typeof signedName !== "string" || signedName.trim().length === 0) {
    return { ok: false, code: "W211_ATTESTATION_SIGNED_NAME_MISSING", detail: "no signature supplied" };
  }

  const { table, prefix } = wave211SlotSpec(input.slot);
  const spec = SLOTS[input.slot];

  const signedAt = new Date().toISOString(); /* server clock, never the client's */
  const ip = wave211UsableObservedIp(input.observedIp);
  const ipCapture = ip == null ? W211_IP_NOT_CAPTURED : W211_IP_CAPTURED;
  const sha = wave211TextSha256(text);
  const basis = spec.hasBasis ? (typeof input.basis === "string" ? input.basis : null) : null;
  /* The tick is stored as the string 'true' or left NULL. It is never stored as a
     zero or a 'false', so an absence stays readable as an absence (R176.1). */
  const currencyConfirmed = spec.hasCurrencyConfirmation
    ? input.currencyConfirmed === true
      ? "true"
      : null
    : null;
  const currencyConfirmedCode = spec.hasCurrencyConfirmation
    ? typeof input.currencyConfirmedCode === "string" && /^[A-Za-z]{3}$/.test(input.currencyConfirmedCode.trim())
      ? input.currencyConfirmedCode.trim().toUpperCase()
      : null
    : null;

  const sets: string[] = [
    `${prefix}_version = ?`,
    `${prefix}_text = ?`,
    `${prefix}_text_sha256 = ?`,
    `${prefix}_signed_name = ?`,
    `${prefix}_signed_at = ?`,
    `${prefix}_signed_by = ?`,
    `${prefix}_ip = ?`,
    `${prefix}_ip_capture = ?`,
    `${prefix}_user_agent = ?`,
  ];
  const args: (string | null)[] = [
    input.version,
    text,
    sha,
    signedName,
    signedAt,
    input.signedBy,
    ip,
    ipCapture,
    input.userAgent,
  ];
  if (spec.hasBasis) {
    sets.push(`${prefix}_basis = ?`);
    args.push(basis);
  }
  if (spec.hasCurrencyConfirmation) {
    sets.push(`${prefix}_currency_confirmed = ?`, `${prefix}_currency_confirmed_code = ?`);
    args.push(currencyConfirmed, currencyConfirmedCode);
  }
  args.push(input.rowId);

  try {
    const db: any = rawDb();
    const res = db
      .prepare(
        `UPDATE ${table}
            SET ${sets.join(",\n                ")}
          WHERE id = ?
            AND ${prefix}_version IS NULL`,
      )
      .run(...args);
    /* Exactly one row, or nothing happened.

       `changes` is a ROW COUNT, not money — but wave 211 does not use `Number()`
       anywhere at all, so that a reviewer grepping this wave for a money parse gets
       a clean zero and does not have to judge each hit. The count is type-checked
       and compared directly, which is also stricter: a driver returning a string
       "1" or a bigint is a driver contract change and should be a refusal, not
       something coerced into looking correct. Presence and type BEFORE the equality
       comparison (R176.1). */
    const changed: unknown = res?.changes;
    if (typeof changed !== "number" || changed !== 1) {
      return {
        ok: false,
        code: "W211_ATTESTATION_WRITE_MATCHED_NO_ROW",
        detail: `changes=${String(res?.changes)}`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      code: "W211_ATTESTATION_WRITE_FAILED",
      detail: String((err as Error)?.message ?? err),
    };
  }

  const readBack = wave211ReadAttestation(input.slot, input.rowId);
  if (readBack == null) {
    return {
      ok: false,
      code: "W211_ATTESTATION_READBACK_EMPTY",
      detail: "row read back without an attestation",
    };
  }
  const mismatched: string[] = [];
  if (readBack.version !== input.version) mismatched.push("version");
  if (readBack.attestationText !== text) mismatched.push("text");
  if (readBack.attestationTextSha256 !== sha) mismatched.push("sha256");
  if (readBack.signedName !== signedName) mismatched.push("signed_name");
  if (readBack.signedAt !== signedAt) mismatched.push("signed_at");
  if (readBack.signedBy !== input.signedBy) mismatched.push("signed_by");
  if (readBack.ip !== ip) mismatched.push("ip");
  if (readBack.ipCapture !== ipCapture) mismatched.push("ip_capture");
  if (readBack.userAgent !== input.userAgent) mismatched.push("user_agent");
  if (spec.hasBasis && readBack.basis !== basis) mismatched.push("basis");
  if (spec.hasCurrencyConfirmation) {
    if (readBack.currencyConfirmed !== currencyConfirmed) mismatched.push("currency_confirmed");
    if (readBack.currencyConfirmedCode !== currencyConfirmedCode) {
      mismatched.push("currency_confirmed_code");
    }
  }
  if (mismatched.length > 0) {
    return { ok: false, code: "W211_ATTESTATION_READBACK_MISMATCH", detail: mismatched.join(",") };
  }
  if (wave211TextSha256(readBack.attestationText) !== readBack.attestationTextSha256) {
    return {
      ok: false,
      code: "W211_ATTESTATION_DIGEST_MISMATCH",
      detail: "stored digest does not describe stored text",
    };
  }
  return { ok: true, record: readBack };
}
