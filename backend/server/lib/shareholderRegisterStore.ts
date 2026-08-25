/**
 * server/lib/shareholderRegisterStore.ts — WAVE 130.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SHAREHOLDER REGISTER: the record of holdings a company ALREADY HAD when
 * it arrived on Capavate, plus any holding a founder records directly rather
 * than through a fundraising round.
 *
 * IT IS NOT A MONEY PATH. `server/captableCommitStore.ts` is SACRED and records
 * a TRANSACTION — money moved, on a round, reconciled two independent ways,
 * hashed into an append-only chain. Nothing in this file enters the ledger, the
 * hash chain, or any fee, invoice or payout path. See `W130_PREFLIGHT.md §1.4`
 * for the full statement of the boundary and §2.2 for the sacred-file list.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * UNKNOWN IS NOT ZERO (owner ruling R6, R47)
 * ═══════════════════════════════════════════════════════════════════════════
 * `amountMinor` and `pricePerShareMinor` are `string | null`, and `null` means
 * THE FOUNDER STATED HE DOES NOT KNOW. It never means zero, and it is never
 * produced by an omission: `parseMoneyDecision` returns a discriminated
 * `known | unknown | undecided`, and the route REFUSES `undecided`. That is the
 * whole point of the wave — the platform must never make a founder invent a
 * number to describe his own company.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MONEY IS EXACT MINOR UNITS, PARSED AS STRINGS INTO BigInt
 * ═══════════════════════════════════════════════════════════════════════════
 * `parseMajorToMinor` is pure string manipulation and `BigInt` — there is no
 * `Number()`, no `parseInt` and no `parseFloat` anywhere on the money path in
 * this file. The ISO-4217 exponent comes from `currencyExponent()`, never a
 * literal 100: JPY is exponent 0 and BHD is exponent 3, and the live company in
 * the owner's walkthrough prices in HK$. Shares are non-negative integers,
 * likewise parsed from a digit string into `BigInt`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE TABLES ARE SELF-HEALED
 * ═══════════════════════════════════════════════════════════════════════════
 * `migrations/0194_wave130_shareholder_register.sql` creates all three tables on
 * the numbered-runner path. `server/db/connection.ts`, which creates tables
 * inline for dev/test, is SACRED under ratified WAIVER-6 and is NOT touched, so
 * `ensureShareholderRegisterTables()` re-issues the same idempotent
 * `CREATE TABLE IF NOT EXISTS` statements before the first read or write. This
 * is the pattern migration 0188 documents for WAIVER-6 and Wave 120 reused for
 * `data_room_grants`.
 */
import { rawDb } from "../db/connection";
import { currencyExponent } from "./currency";
import { log } from "./logger";

/* ═══════════════════════════════════════════════════════════════════════════
   THE TWO SCENARIOS THE OWNER NAMED, KEPT SEPARATE.

   > "they need to either set up their initial (incorporation) shareholders OR
   >  the status of their latest cap table (in the scenario where a company
   >  registers after they have raised several rounds and have investors on
   >  their cap table)"

   These are genuinely different facts about a company and they are NOT
   collapsed into one "setup" flow. An incorporation split asserts "this is how
   the company began"; an existing cap table asserts "this is where the company
   stands as at a date". A founder who chooses one is not answering the other,
   and the stored `origin` on every row says which question it answered.
   ═══════════════════════════════════════════════════════════════════════════ */
export type ShareholderRecordOrigin = "incorporation" | "existing_captable" | "direct";
export const SHAREHOLDER_RECORD_ORIGINS: readonly ShareholderRecordOrigin[] = [
  "incorporation",
  "existing_captable",
  "direct",
];

export type FirstRunScenario = "incorporation" | "existing_captable";
export type FirstRunState = "not_started" | "in_progress" | "skipped" | "completed";

/** Holder kinds. `holderType` is CHOSEN BY THE FOUNDER and never inferred from a
 *  name, a magnitude or a heuristic (R16) — inference is exactly what produced
 *  the false `0.00%` founder figure Wave 125 removed. */
export type RegisterHolderType =
  | "founder"
  | "investor"
  | "employee"
  | "advisor"
  | "entity"
  | "option_pool";
export const REGISTER_HOLDER_TYPES: readonly RegisterHolderType[] = [
  "founder",
  "investor",
  "employee",
  "advisor",
  "entity",
  "option_pool",
];

/** Instruments the cap-table engine already understands
 *  (`shared/roundMathEngineAdapter.ts` :: `adaptSecuritiesToEngine`). The
 *  register does not invent an instrument the engine cannot compute with. */
export type RegisterInstrument = "common" | "preferred" | "option" | "warrant" | "safe" | "note";
export const REGISTER_INSTRUMENTS: readonly RegisterInstrument[] = [
  "common",
  "preferred",
  "option",
  "warrant",
  "safe",
  "note",
];

export interface ShareholderRecord {
  id: string;
  companyId: string;
  holderName: string;
  holderEmail: string | null;
  holderType: RegisterHolderType;
  instrument: RegisterInstrument;
  series: string | null;
  /** Decimal digits of a non-negative integer. */
  shares: string;
  /** Exact minor units as decimal digits, or `null` = STATED UNKNOWN. */
  amountMinor: string | null;
  pricePerShareMinor: string | null;
  currency: string;
  minorUnitExponent: number;
  issueDate: string;
  origin: ShareholderRecordOrigin;
  investorId: string | null;
  note: string | null;
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
  supersededAt: string | null;
  supersededBy: string | null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MONEY AND SHARES — STRING → BigInt, NO FLOAT ANYWHERE
   ═══════════════════════════════════════════════════════════════════════════ */

/** A founder's answer to a money question. Three outcomes, and `undecided` is
 *  the one the route refuses: an omission must never silently become a zero. */
export type MoneyDecision =
  | { kind: "known"; minor: string }
  | { kind: "unknown" }
  | { kind: "undecided" }
  | { kind: "invalid"; reason: string };

const MAJOR_RE = /^\d{1,18}(\.\d{1,8})?$/;

/**
 * Convert a major-unit decimal STRING to exact integer minor units, using the
 * currency's own ISO-4217 exponent. Pure string manipulation plus `BigInt` —
 * no `Number()`, no `parseInt`, no `parseFloat`, and no literal 100.
 *
 * Returns `null` when the input is not a well-formed non-negative decimal, or
 * when it carries more fraction digits than the currency has minor units — a
 * value that cannot be represented exactly is REFUSED rather than rounded,
 * because silently rounding a founder's figure is a fabrication.
 */
export function parseMajorToMinor(input: string, currency: string): string | null {
  const raw = String(input ?? "").trim().replace(/,/g, "");
  if (!MAJOR_RE.test(raw)) return null;
  const exp = currencyExponent(currency);
  const dot = raw.indexOf(".");
  const whole = dot === -1 ? raw : raw.slice(0, dot);
  const frac = dot === -1 ? "" : raw.slice(dot + 1);
  if (frac.length > exp) return null;
  const padded = frac + "0".repeat(exp - frac.length);
  /* BigInt over the concatenated digit string: exact for any magnitude, and it
     normalises a leading-zero input ("007.50") to canonical digits. */
  try {
    return BigInt(whole + padded).toString();
  } catch {
    return null;
  }
}

/** The inverse, for display and for exports. String → string, `BigInt` only. */
export function minorToMajorDecimal(minor: string, exponent: number): string | null {
  const raw = String(minor ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  if (exponent <= 0) return raw.replace(/^0+(?=\d)/, "");
  const padded = raw.padStart(exponent + 1, "0");
  const cut = padded.length - exponent;
  return `${padded.slice(0, cut).replace(/^0+(?=\d)/, "")}.${padded.slice(cut)}`;
}

/**
 * Read a founder's money answer. `"unknown"` (in any case, and `"not known"` /
 * `"unavailable"` as synonyms a human might type) is an EXPLICIT statement and
 * is recorded as such. An absent field is `undecided` and the caller must
 * refuse it. There is no default and no coalesce.
 */
export function parseMoneyDecision(value: unknown, currency: string): MoneyDecision {
  if (value === undefined || value === null) return { kind: "undecided" };
  const raw = String(value).trim();
  if (!raw) return { kind: "undecided" };
  if (/^(unknown|not known|not-known|unavailable|no record)$/i.test(raw)) return { kind: "unknown" };
  const minor = parseMajorToMinor(raw, currency);
  if (minor === null) {
    return {
      kind: "invalid",
      reason:
        `That is not a figure this register can hold exactly in ${currency.toUpperCase()}. ` +
        `Enter it with at most ${currencyExponent(currency)} decimal place(s), or record it as unknown — ` +
        `Capavate will not round a figure you gave it, and it will not invent one you did not.`,
    };
  }
  return { kind: "known", minor };
}

/** Shares: a non-negative integer, exact, via `BigInt`. `null` on refusal.
 *  A share count is a COUNT, not money — a genuine zero is legitimate here (an
 *  option pool authorised but unissued), so zero is accepted and means zero. */
export function parseShareCount(value: unknown): string | null {
  const raw = String(value ?? "").trim().replace(/,/g, "");
  if (!/^\d{1,24}$/.test(raw)) return null;
  try {
    return BigInt(raw).toString();
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TABLE SELF-HEAL (WAIVER-6 parity — connection.ts is SACRED and untouched)
   ═══════════════════════════════════════════════════════════════════════════ */
let tablesChecked = false;

const DDL = [
  `CREATE TABLE IF NOT EXISTS company_shareholder_records (
     id TEXT PRIMARY KEY, company_id TEXT NOT NULL, holder_name TEXT NOT NULL,
     holder_email TEXT, holder_type TEXT NOT NULL, instrument TEXT NOT NULL,
     series TEXT, shares TEXT NOT NULL, amount_minor TEXT,
     price_per_share_minor TEXT, currency TEXT NOT NULL,
     minor_unit_exponent INTEGER NOT NULL, issue_date TEXT NOT NULL,
     origin TEXT NOT NULL, investor_id TEXT, note TEXT, recorded_by TEXT NOT NULL,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
     superseded_at TEXT, superseded_by TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS company_captable_first_run (
     company_id TEXT PRIMARY KEY, scenario TEXT, as_at_date TEXT,
     state TEXT NOT NULL, skipped_at TEXT, completed_at TEXT,
     updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS captable_visibility_grants (
     id TEXT PRIMARY KEY, company_id TEXT NOT NULL, subject_kind TEXT NOT NULL,
     subject_id TEXT NOT NULL, subject_label TEXT NOT NULL, expires_at TEXT NOT NULL,
     granted_by TEXT NOT NULL, created_at TEXT NOT NULL,
     revoked_at TEXT, revoked_by TEXT
   )`,
];

export function ensureShareholderRegisterTables(): void {
  if (tablesChecked) return;
  try {
    const db = rawDb();
    for (const stmt of DDL) db.exec(stmt);
    tablesChecked = true;
  } catch (err) {
    log.warn("[shareholderRegister] table check failed:", (err as Error).message);
  }
}

/** Test seam: forget the cached check so a fresh in-memory database re-creates. */
export function resetShareholderRegisterTableCheck(): void {
  tablesChecked = false;
}

/* ═══════════════════════════════════════════════════════════════════════════
   READS
   ═══════════════════════════════════════════════════════════════════════════ */

type Row = Record<string, unknown>;

function mapRow(r: Row): ShareholderRecord {
  const expRaw = r.minor_unit_exponent;
  /* The exponent is a COUNT of digits read back from a schema-typed INTEGER
     column, not money. It is never used to scale a monetary value by a literal;
     `minorToMajorDecimal` shifts a digit string by it. */
  const exponent = typeof expRaw === "number" ? expRaw : currencyExponent(String(r.currency ?? ""));
  return {
    id: String(r.id ?? ""),
    companyId: String(r.company_id ?? ""),
    holderName: String(r.holder_name ?? ""),
    holderEmail: r.holder_email == null ? null : String(r.holder_email),
    holderType: String(r.holder_type ?? "investor") as RegisterHolderType,
    instrument: String(r.instrument ?? "common") as RegisterInstrument,
    series: r.series == null ? null : String(r.series),
    shares: String(r.shares ?? "0"),
    amountMinor: r.amount_minor == null ? null : String(r.amount_minor),
    pricePerShareMinor: r.price_per_share_minor == null ? null : String(r.price_per_share_minor),
    currency: String(r.currency ?? ""),
    minorUnitExponent: exponent,
    issueDate: String(r.issue_date ?? ""),
    origin: String(r.origin ?? "direct") as ShareholderRecordOrigin,
    investorId: r.investor_id == null ? null : String(r.investor_id),
    note: r.note == null ? null : String(r.note),
    recordedBy: String(r.recorded_by ?? ""),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    supersededAt: r.superseded_at == null ? null : String(r.superseded_at),
    supersededBy: r.superseded_by == null ? null : String(r.superseded_by),
  };
}

/**
 * Every LIVE register row for a company, oldest issue date first.
 *
 * A superseded row is excluded: it has been replaced by a revision and is kept
 * only so that the fact a figure was once unknown is not erased. There is
 * exactly ONE definition of "live" and it is this predicate, so the cap-table
 * projection, the founder's list, the PDF and the tests cannot disagree.
 */
export function listShareholderRecords(companyId: string): ShareholderRecord[] {
  ensureShareholderRegisterTables();
  const cid = String(companyId ?? "").trim();
  if (!cid) return [];
  try {
    const rows = rawDb()
      .prepare(
        `SELECT * FROM company_shareholder_records
          WHERE company_id = ? AND superseded_at IS NULL
          ORDER BY issue_date ASC, created_at ASC`,
      )
      .all(cid) as Row[];
    return rows.map(mapRow);
  } catch (err) {
    /* Fail-CLOSED to an empty register: an unreadable register is not evidence
       of a holding, and it must never break the cap-table read for the rows
       that ARE readable (the same fail-open-to-base posture the W-SAFE and
       W-CAP bridges take in `buildCompanySecurities`). */
    log.warn("[shareholderRegister] list failed:", (err as Error).message);
    return [];
  }
}

export function getShareholderRecord(id: string): ShareholderRecord | null {
  ensureShareholderRegisterTables();
  try {
    const row = rawDb()
      .prepare(`SELECT * FROM company_shareholder_records WHERE id = ? LIMIT 1`)
      .get(String(id ?? "").trim()) as Row | undefined;
    return row ? mapRow(row) : null;
  } catch (err) {
    log.warn("[shareholderRegister] get failed:", (err as Error).message);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   WRITES
   ═══════════════════════════════════════════════════════════════════════════ */

export interface InsertShareholderRecordInput {
  id: string;
  companyId: string;
  holderName: string;
  holderEmail: string | null;
  holderType: RegisterHolderType;
  instrument: RegisterInstrument;
  series: string | null;
  shares: string;
  amountMinor: string | null;
  pricePerShareMinor: string | null;
  currency: string;
  issueDate: string;
  origin: ShareholderRecordOrigin;
  investorId: string | null;
  note: string | null;
  recordedBy: string;
}

export function insertShareholderRecord(input: InsertShareholderRecordInput): ShareholderRecord | null {
  ensureShareholderRegisterTables();
  const now = new Date().toISOString();
  try {
    rawDb()
      .prepare(
        `INSERT INTO company_shareholder_records
           (id, company_id, holder_name, holder_email, holder_type, instrument, series,
            shares, amount_minor, price_per_share_minor, currency, minor_unit_exponent,
            issue_date, origin, investor_id, note, recorded_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.companyId,
        input.holderName,
        input.holderEmail,
        input.holderType,
        input.instrument,
        input.series,
        input.shares,
        input.amountMinor,
        input.pricePerShareMinor,
        input.currency,
        currencyExponent(input.currency),
        input.issueDate,
        input.origin,
        input.investorId,
        input.note,
        input.recordedBy,
        now,
        now,
      );
  } catch (err) {
    log.error("[shareholderRegister] insert failed:", (err as Error).message);
    return null;
  }
  return getShareholderRecord(input.id);
}

/**
 * Append-only supersede. Filling in a figure that was recorded as unknown writes
 * a NEW row and stamps the old one; the old row is never rewritten, so the audit
 * trail still says the figure was once unknown. This is the same discipline the
 * money core's append-only ledger keeps, applied to a register.
 */
export function supersedeShareholderRecord(oldId: string, newId: string): boolean {
  ensureShareholderRegisterTables();
  try {
    const res = rawDb()
      .prepare(
        `UPDATE company_shareholder_records
            SET superseded_at = ?, superseded_by = ?, updated_at = ?
          WHERE id = ? AND superseded_at IS NULL`,
      )
      .run(new Date().toISOString(), newId, new Date().toISOString(), oldId) as { changes?: number };
    return (res?.changes ?? 0) > 0;
  } catch (err) {
    log.error("[shareholderRegister] supersede failed:", (err as Error).message);
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FIRST-RUN STATE — RESUMABLE, AND A SKIP IS NEVER A LOCK-OUT
   ═══════════════════════════════════════════════════════════════════════════
   The owner's two scenarios must both be "reachable after registration and
   returnable to later", and a founder who skips must not be locked out. So the
   state lives in a row, not in a wizard's component state: leaving the page,
   signing out, or skipping outright all leave the flow exactly where it was, and
   the entry point on the cap table never disappears.
   ═══════════════════════════════════════════════════════════════════════════ */
export interface FirstRunRecord {
  companyId: string;
  scenario: FirstRunScenario | null;
  asAtDate: string | null;
  state: FirstRunState;
  skippedAt: string | null;
  completedAt: string | null;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export function getFirstRun(companyId: string): FirstRunRecord | null {
  ensureShareholderRegisterTables();
  const cid = String(companyId ?? "").trim();
  if (!cid) return null;
  try {
    const r = rawDb()
      .prepare(`SELECT * FROM company_captable_first_run WHERE company_id = ? LIMIT 1`)
      .get(cid) as Row | undefined;
    if (!r) return null;
    return {
      companyId: String(r.company_id ?? ""),
      scenario: r.scenario == null ? null : (String(r.scenario) as FirstRunScenario),
      asAtDate: r.as_at_date == null ? null : String(r.as_at_date),
      state: String(r.state ?? "not_started") as FirstRunState,
      skippedAt: r.skipped_at == null ? null : String(r.skipped_at),
      completedAt: r.completed_at == null ? null : String(r.completed_at),
      updatedBy: String(r.updated_by ?? ""),
      createdAt: String(r.created_at ?? ""),
      updatedAt: String(r.updated_at ?? ""),
    };
  } catch (err) {
    log.warn("[shareholderRegister] first-run read failed:", (err as Error).message);
    return null;
  }
}

export function upsertFirstRun(input: {
  companyId: string;
  scenario: FirstRunScenario | null;
  asAtDate: string | null;
  state: FirstRunState;
  updatedBy: string;
}): FirstRunRecord | null {
  ensureShareholderRegisterTables();
  const now = new Date().toISOString();
  const existing = getFirstRun(input.companyId);
  /* Resuming clears a previous skip: a skip is a pause, never a door that locks.
     A completion instant, once recorded, is kept. */
  const skippedAt = input.state === "skipped" ? now : null;
  const completedAt =
    input.state === "completed" ? existing?.completedAt ?? now : existing?.completedAt ?? null;
  try {
    const db = rawDb();
    if (existing) {
      db.prepare(
        `UPDATE company_captable_first_run
            SET scenario = ?, as_at_date = ?, state = ?, skipped_at = ?, completed_at = ?,
                updated_by = ?, updated_at = ?
          WHERE company_id = ?`,
      ).run(
        input.scenario,
        input.asAtDate,
        input.state,
        skippedAt,
        completedAt,
        input.updatedBy,
        now,
        input.companyId,
      );
    } else {
      db.prepare(
        `INSERT INTO company_captable_first_run
           (company_id, scenario, as_at_date, state, skipped_at, completed_at,
            updated_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        input.companyId,
        input.scenario,
        input.asAtDate,
        input.state,
        skippedAt,
        completedAt,
        input.updatedBy,
        now,
        now,
      );
    }
  } catch (err) {
    log.error("[shareholderRegister] first-run write failed:", (err as Error).message);
    return null;
  }
  return getFirstRun(input.companyId);
}

/* ═══════════════════════════════════════════════════════════════════════════
   VISIBILITY GRANTS — WAVE 120's MODEL, REUSED RATHER THAN RE-INVENTED
   ═══════════════════════════════════════════════════════════════════════════
   `server/track1Routes.ts:3848-3873` (Wave 120) is the pattern: additive
   `revoked_at` / `revoked_by`, ONE spelling of "no longer live" shared by the
   read path and the listing, a fixed refusal order, an idempotent revoke that
   keeps the FIRST instant, and a read path that re-reads the row on every
   request so a revocation bites immediately.

   WHAT IS NOT HERE, AND WHY. An INVESTOR is never a grant. R8 is binding: a
   cap-table member has "full, identical rights" and "scope follows the
   POSITION, never an account flag". A revoke button that could strip a
   shareholder of sight of his own cap table would contradict a ratified ruling,
   so only the two parties the owner qualified with "if required" — a Consortium
   Partner and a Collective party — can be the subject of a grant.
   ═══════════════════════════════════════════════════════════════════════════ */
export type VisibilitySubjectKind = "consortium_partner" | "collective";
export const VISIBILITY_SUBJECT_KINDS: readonly VisibilitySubjectKind[] = [
  "consortium_partner",
  "collective",
];

export type VisibilityGrantState = "live" | "revoked" | "expired";

export interface VisibilityGrant {
  id: string;
  companyId: string;
  subjectKind: VisibilitySubjectKind;
  subjectId: string;
  subjectLabel: string;
  expiresAt: string;
  grantedBy: string;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

/** THE one spelling of "this grant is no longer live", so the enforcement path
 *  and the founder's list cannot drift apart. Revoked is checked BEFORE expired
 *  so a founder is told which of the two happened. */
export function capTableVisibilityGrantState(
  grant: { expiresAt?: string | null; revokedAt?: string | null },
  now: Date = new Date(),
): VisibilityGrantState {
  if (grant.revokedAt) return "revoked";
  if (!grant.expiresAt || new Date(grant.expiresAt) < now) return "expired";
  return "live";
}

function mapGrant(r: Row): VisibilityGrant {
  return {
    id: String(r.id ?? ""),
    companyId: String(r.company_id ?? ""),
    subjectKind: String(r.subject_kind ?? "consortium_partner") as VisibilitySubjectKind,
    subjectId: String(r.subject_id ?? ""),
    subjectLabel: String(r.subject_label ?? ""),
    expiresAt: String(r.expires_at ?? ""),
    grantedBy: String(r.granted_by ?? ""),
    createdAt: String(r.created_at ?? ""),
    revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
    revokedBy: r.revoked_by == null ? null : String(r.revoked_by),
  };
}

export function listVisibilityGrants(companyId: string): VisibilityGrant[] {
  ensureShareholderRegisterTables();
  const cid = String(companyId ?? "").trim();
  if (!cid) return [];
  try {
    const rows = rawDb()
      .prepare(
        `SELECT * FROM captable_visibility_grants WHERE company_id = ? ORDER BY created_at DESC`,
      )
      .all(cid) as Row[];
    return rows.map(mapGrant);
  } catch (err) {
    log.warn("[capTableVisibility] list failed:", (err as Error).message);
    return [];
  }
}

export function getVisibilityGrant(id: string): VisibilityGrant | null {
  ensureShareholderRegisterTables();
  try {
    const r = rawDb()
      .prepare(`SELECT * FROM captable_visibility_grants WHERE id = ? LIMIT 1`)
      .get(String(id ?? "").trim()) as Row | undefined;
    return r ? mapGrant(r) : null;
  } catch (err) {
    log.warn("[capTableVisibility] get failed:", (err as Error).message);
    return null;
  }
}

export function insertVisibilityGrant(input: {
  id: string;
  companyId: string;
  subjectKind: VisibilitySubjectKind;
  subjectId: string;
  subjectLabel: string;
  expiresAt: string;
  grantedBy: string;
}): VisibilityGrant | null {
  ensureShareholderRegisterTables();
  try {
    rawDb()
      .prepare(
        `INSERT INTO captable_visibility_grants
           (id, company_id, subject_kind, subject_id, subject_label, expires_at, granted_by, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.companyId,
        input.subjectKind,
        input.subjectId,
        input.subjectLabel,
        input.expiresAt,
        input.grantedBy,
        new Date().toISOString(),
      );
  } catch (err) {
    log.error("[capTableVisibility] insert failed:", (err as Error).message);
    return null;
  }
  return getVisibilityGrant(input.id);
}

/** Idempotent, and it KEEPS THE FIRST `revoked_at` — an audit trail is not
 *  overwritten by a second click (Wave 120's rule, verbatim). */
export function revokeVisibilityGrant(id: string, revokedBy: string): boolean {
  ensureShareholderRegisterTables();
  try {
    rawDb()
      .prepare(
        `UPDATE captable_visibility_grants
            SET revoked_at = ?, revoked_by = ?
          WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(new Date().toISOString(), String(revokedBy ?? ""), String(id ?? "").trim());
    const after = getVisibilityGrant(id);
    return !!after?.revokedAt;
  } catch (err) {
    log.error("[capTableVisibility] revoke failed:", (err as Error).message);
    return false;
  }
}

/**
 * Does a LIVE grant admit this subject to this company's cap table?
 *
 * Consulted by `decideCapTableSinkAccess` ONLY AFTER every existing branch has
 * declined, so it can turn a `refuse` into an `allow` and can NEVER remove
 * access anybody has today. Fails in the DENYING direction on any error, matching
 * the posture of every other read in `capTableSinkScope.ts`.
 */
export function hasLiveCapTableVisibilityGrant(
  companyId: string,
  subjectIds: readonly string[],
  now: Date = new Date(),
): VisibilityGrant | null {
  const cid = String(companyId ?? "").trim();
  if (!cid) return null;
  const wanted = new Set(subjectIds.map((s) => String(s ?? "").trim()).filter(Boolean));
  if (wanted.size === 0) return null;
  for (const g of listVisibilityGrants(cid)) {
    if (!wanted.has(g.subjectId)) continue;
    if (capTableVisibilityGrantState(g, now) === "live") return g;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE PROJECTION — HOW A REGISTER ROW REACHES EVERY READING SURFACE AT ONCE
   ═══════════════════════════════════════════════════════════════════════════
   `buildCompanySecurities` (`server/routes.ts:2436`) is the SINGLE builder of
   `ApiSecurity` rows in this tree, and it is injected into the round-math
   routes (`routes.ts:1268`), the founder-ownership and holder-count engine
   (`:1276`) and the exit waterfall (`:8155`) — that last one with the comment
   "so there is one reader of `buildCompanySecurities` and not a second".

   So the register is projected HERE, in the ApiSecurity shape, and appended by
   that one builder. A recorded holder therefore appears on the founder cap
   table, its CSV/Excel/print exports, the founder dashboard's ownership tile,
   the holder count (through Wave 125's `computeCapTableHolderCount` — no ninth
   counting rule), the capitalisation journey, the INVESTOR's own view (which
   calls the same `runEngine`, so the percentages agree by construction), the
   round-math route, the close-gate reconciliation and the exit waterfall — with
   no cache and no second reader.

   AN UNKNOWN FIGURE STAYS UNKNOWN ACROSS THE PROJECTION. `pricePerShare` and
   `investmentAmount` are `number | null` on `ApiSecurity`, and a stated-unknown
   register figure projects as `null`, which every renderer in this tree already
   shows as an explicit refusal (`fmtPct(null)`, `formatMinorOrUnavailable`,
   `moneyOrNotProvided`). It is NEVER projected as 0.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The stable, greppable id prefix a projected register row carries. Nothing else
 *  in the tree produces it, so the projection is always distinguishable from a
 *  ledger-derived row and from a base security. */
export const REGISTER_SECURITY_ID_PREFIX = "shreg_sec_";

/**
 * A register row's exact money, carried alongside the lossy display number so a
 * consumer that needs exactness (an export, a report) has it without re-reading
 * the table. Minor units as digit strings; `null` means STATED UNKNOWN.
 */
export interface RegisterExactMoney {
  amountMinor: string | null;
  pricePerShareMinor: string | null;
  currency: string;
  minorUnitExponent: number;
}

/**
 * THE ONE PLACE an exact register figure becomes the lossy `number` the
 * `ApiSecurity` wire shape requires.
 *
 * NO ARITHMETIC HAPPENS HERE and none happens downstream on this value: it is a
 * pure representation change at the DISPLAY boundary, which is exactly where the
 * two ledger bridges already sitting in `buildCompanySecurities`
 * (`server/routes.ts:2456` W-SAFE, `:2519` W-CAP) do the same thing, for the same
 * reason — `ApiSecurity.investmentAmount` and `.pricePerShare` are typed
 * `number | null` and changing that type would rewrite the engine's wire format
 * across the whole tree.
 *
 * THE EXACT VALUE IS NOT DISCARDED. Every projected row carries its untouched
 * minor units on `registerExactMoney`, so any consumer that must be exact —
 * an export, a report, a reconciliation — reads those and never this.
 *
 * `null` in means STATED UNKNOWN and `null` comes out. It is never 0.
 */
function displayNumberFromExactMajor(major: string | null): number | null {
  if (major === null) return null;
  const n = Number(major);
  /* A magnitude the wire format cannot carry is refused, not silently mangled:
     `null` renders as "Not provided" and the exact figure is still on the row. */
  return Number.isFinite(n) ? n : null;
}

/**
 * Project the live register into `ApiSecurity`-shaped rows.
 *
 * The exact minor units travel untouched on `registerExactMoney`. A
 * stated-unknown figure crosses as `null`.
 */
export function projectRegisterToSecurities(companyId: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const rec of listShareholderRecords(companyId)) {
    const majorAmount =
      rec.amountMinor === null ? null : minorToMajorDecimal(rec.amountMinor, rec.minorUnitExponent);
    const majorPps =
      rec.pricePerShareMinor === null
        ? null
        : minorToMajorDecimal(rec.pricePerShareMinor, rec.minorUnitExponent);
    out.push({
      id: `${REGISTER_SECURITY_ID_PREFIX}${rec.id}`,
      companyId: rec.companyId,
      holderName: rec.holderName,
      /* CHOSEN by the founder, never inferred. This is what keeps Wave 125's
         founder-ownership tile honest for a register-recorded founder block. */
      holderType: rec.holderType,
      instrument: rec.instrument,
      series: rec.series,
      /* A share count is a COUNT, not money — an integer on both sides. */
      shares: Number.isFinite(Number(rec.shares)) ? Number(rec.shares) : 0,
      pricePerShare: displayNumberFromExactMajor(majorPps),
      investmentAmount: displayNumberFromExactMajor(majorAmount),
      cap: null,
      discount: null,
      issuedAt: rec.issueDate,
      /* NO ROUND. This is the entire point of the wave: a holding on the register
         is not attached to a round and does not need one to exist. */
      roundId: null,
      roundName: null,
      holderEmail: rec.holderEmail,
      investorId: rec.investorId,
      accruedInterest: null,
      currency: rec.currency,
      shareholderRegisterId: rec.id,
      shareholderRegisterOrigin: rec.origin,
      amountIsUnknown: rec.amountMinor === null,
      pricePerShareIsUnknown: rec.pricePerShareMinor === null,
      registerExactMoney: {
        amountMinor: rec.amountMinor,
        pricePerShareMinor: rec.pricePerShareMinor,
        currency: rec.currency,
        minorUnitExponent: rec.minorUnitExponent,
      } satisfies RegisterExactMoney,
    });
  }
  return out;
}
