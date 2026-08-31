/**
 * server/lib/wave195CommitCurrencyDeclaration.ts
 *
 * WAVE 195 · ITEM A + ITEM B · R167 — THE OWNER'S USD DECLARATION, AS A RECORDED
 * FACT, AND THE RESOLVER THAT MAKES THE SACRED DEFAULT UNREACHABLE.
 *
 * ══ THE RULING ═══════════════════════════════════════════════════════════════
 * Owner, verbatim, 2026-08-28: **"They are all test data so declare them USD"**
 *
 * That selects path 1 of R165.2. `server/captableCommitStore.ts` is SACRED and
 * defaults every commit to USD regardless of its round's currency, so all 1017
 * existing cap-table commits carry USD. The ledger is hash-chained, so those rows
 * CANNOT be rewritten — rewriting them would break the chain that makes the
 * record trustworthy.
 *
 * The declaration falsifies nothing. Measured on this tree's database:
 *   captable_commits          1017 rows, currency = 'USD' on every one, seq 1..1017
 *   rounds                    1045 rows, currency IS NULL on every one
 *   funded_queue              0 rows
 * No non-USD round has ever existed, and the owner has confirmed repeatedly that
 * all platform data is test data (R156.4). So "these 1017 commits are USD" is a
 * true statement ABOUT the actual data.
 *
 * ══ A DECLARATION IS NOT A CODE COMMENT (R167.2) ═════════════════════════════
 * Someone must be able to ask later "why does the platform believe these commits
 * are USD?" and get an answer out of the DATA. So the declaration is stored as a
 * row, not written here as prose, and NOT invented as a new table.
 *
 * WHERE IT LIVES, AND WHY THIS AND NOT SOMETHING ELSE. Every existing candidate
 * was surveyed before choosing (the full table is in
 * build_log/wave195/W195_PREFLIGHT.md §2):
 *
 *   · `platform_config` + `platform_config_history`  ← CHOSEN
 *       The platform's existing declaration-of-record mechanism. Hash-chained
 *       (prev_revision_hash -> revision_hash), append-only history, carries
 *       created_by/updated_by and a description, and is defended by five SQLite
 *       triggers installed by the SACRED bootstrap at
 *       server/db/connection.ts:947 — including `trg_pc_no_delete`, so a
 *       declaration recorded here can never be deleted, and
 *       `trg_pc_atomic_audit`, so it can never be changed without a matching
 *       history row. A declaration ABOUT a hash-chained ledger is therefore held
 *       IN a hash-chained store, and nothing new had to be built to get that.
 *       Because the sacred bootstrap creates it, the table exists on every
 *       handle — live, dev and the in-memory test handle — so no migration is
 *       needed and none is added.
 *   · `percent_policy_record` (wave 5 / migration 0153) — the PRECEDENT that an
 *       owner ruling is recorded as data rather than hardcoded
 *       (server/lib/percentPolicy.ts: "recorded durably in
 *       `percent_policy_record` ... NOT hardcoded here"). Precedent adopted; the
 *       table itself rejected because its columns are percent-specific
 *       (storage_form / input_form / display_rule) and cannot describe a
 *       currency declaration without abusing them.
 *   · `commit_attestations` — per-INVITATION founder attestation. Wrong grain.
 *   · `audit_log` — used, but as the AUDIT (below), not as the store. An
 *       append-only event ledger answers "what happened", not "what does the
 *       platform currently hold to be true".
 *
 * THE WRITE GOES THROUGH WAVE 11's EXISTING AUDITED WRITER,
 * `ensurePlatformConfigKey()` in server/lib/platformConfigWriter.ts. No second
 * write path into `platform_config` is created here. That writer's own header
 * records why a new key is seeded from TypeScript rather than SQL: the genesis
 * revision hash cannot be computed in a migration.
 *
 * ══ AUDITED THROUGH WAVE 186'S WRITER, NOT A SECOND PATH (R167.2 item 2) ═════
 * Wave 186 established the audit ledger as the record of consequence and added
 * the call-site guard. A declaration about 1017 money rows belongs in it, so it
 * is appended with `appendAdminAudit()` and its outcome CHECKED with
 * `reportAuditWriteOutcome()` at bearing "money" — the habit wave 186 exists to
 * enforce. Exactly one audit row is written, at the moment the declaration is
 * first recorded; re-running the installer appends nothing, because the
 * declaration has not been made a second time.
 *
 * ══ IT MUTATES NOTHING (R167.2 item 3) ═══════════════════════════════════════
 * THE DECLARATION IS A STATEMENT ABOUT THE 1017 ROWS, NOT A MUTATION OF THEM.
 * That distinction is the entire reason the hash chain survives. This module
 * contains NO `UPDATE`, `INSERT`, `DELETE` or `ALTER` against `captable_commits`.
 * The table name appears here only inside `SELECT COUNT(*)`, `SELECT MAX(seq)`
 * and `SELECT MAX(ts)` — three reads taken once, to record how many rows the
 * declaration covers and where its boundary sits. Nothing is backfilled.
 *
 * ══ BOUNDED PRECISELY (R167.2 item 4) ════════════════════════════════════════
 * `coversMaxCommitSeq` is captured from `MAX(seq)` at the moment of declaration.
 * `isCoveredByDeclaration(seq)` is true only at or below it, so a commit
 * recorded tomorrow is NOT covered by this declaration and must derive its
 * currency from its round. `seq` is used rather than a timestamp because it is
 * the monotonic counter the hash chain itself is ordered by.
 *
 * ══ R156.2 — NEVER HARDCODE A CURRENCY, AND THE IRONY OF THIS WAVE ═══════════
 * This wave records a USD declaration. That is DATA THE OWNER DECLARED, not a
 * constant chosen by an engineer. So the string appears in exactly ONE place in
 * this wave: `DECLARED_CURRENCY_AS_DECLARED_BY_OWNER` below, whose only use is to
 * build the declaration ROW at first record. Every consumer — the resolver, the
 * routes, the provenance surface — reads the currency OUT OF THE RECORDED ROW.
 * There is no code path in wave 195 that resolves to USD without having read the
 * owner's declaration first, and if the declaration cannot be read the commit
 * REFUSES (`resolveCommitCurrency` branch 6). That is what separates a declared
 * currency from a hardcoded one.
 *
 * ══ R156.1 — NO CONVERSION ═══════════════════════════════════════════════════
 * Nothing here converts a currency, and nothing here performs arithmetic on
 * money. No `Number()`, `parseInt`, `parseFloat`, `Decimal` or `BigInt` appears.
 * `coversRowCount` / `coversMaxCommitSeq` are a row COUNT and a SEQUENCE NUMBER,
 * not amounts, and the only operation applied to them is an integer comparison.
 */
import { createHash } from "node:crypto";
import { rawDb } from "../db/connection";
import {
  ensurePlatformConfigKey,
  readConfigRow,
  PlatformConfigWriteError,
} from "./platformConfigWriter";
import { appendAdminAudit, reportAuditWriteOutcome } from "../adminPlatformStore";
import { log } from "./logger";

/* ─────────────────────────────────────────────────────────────────────────── */
/* THE DECLARATION'S IDENTITY                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

/** The `platform_config` key the declaration is recorded under. */
export const COMMIT_CURRENCY_DECLARATION_KEY =
  "captable.commit_currency.owner_declaration_r167";

/** The audit `action` wave 186's ledger records the declaration under. */
export const COMMIT_CURRENCY_DECLARATION_AUDIT_ACTION =
  "captable.commit_currency.owner_declaration_recorded";

/** The audit entity. `resolveTenantId()` maps anything without a `co_` id to
 *  `tenant_platform`, which is correct: this is a platform-level declaration. */
export const COMMIT_CURRENCY_DECLARATION_AUDIT_ENTITY =
  "platform:captable_commit_currency";

/**
 * THE OWNER'S WORDS. Recorded into the row so the answer to "why?" is the
 * owner's own sentence and not a paraphrase written by an engineer.
 */
export const OWNER_DECLARATION_QUOTE = "They are all test data so declare them USD";

/**
 * R156.2 — THE ONE PLACE THIS WAVE SPELLS A CURRENCY.
 *
 * Read the module header before touching this. This is the value the OWNER
 * declared in R167, transcribed once so it can be written into the declaration
 * ROW. It is referenced by `ensureCommitCurrencyDeclaration()` and by NOTHING
 * else — no resolver, route, response or surface reads it. Deleting the recorded
 * row does not fall back to this constant; it makes commits REFUSE.
 */
const DECLARED_CURRENCY_AS_DECLARED_BY_OWNER = "USD";

/** The reason the owner gave, which is what makes the declaration honest. */
const DECLARATION_REASON = "all platform data is test data";

/* ─────────────────────────────────────────────────────────────────────────── */
/* THE SHAPE OF THE RECORDED DECLARATION                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

export interface CommitCurrencyDeclaration {
  /** What was declared: the currency the covered rows are declared to be. */
  declaredCurrency: string;
  /** When it took effect — the moment it was first recorded. */
  effectiveAt: string;
  /** Who declared it. */
  declaredBy: string;
  declaredByRole: string;
  /** The ruling and the owner's verbatim words. */
  rulingRef: string;
  rulingQuote: string;
  /** Why it is honest. */
  reason: string;
  /** How many cap-table commit rows it covers. */
  coversRowCount: number;
  /** The precise boundary: the highest commit `seq` in existence when declared. */
  coversMaxCommitSeq: number;
  /** Secondary evidence of the boundary; null when there were no rows. */
  coversMaxCommitTs: string | null;
  /** Census recorded alongside, so the honesty argument is checkable later. */
  roundsTotalAtDeclaration: number;
  roundsWithoutCurrencyAtDeclaration: number;
  /** States, in the record itself, that this is not a mutation. */
  boundaryStatement: string;
  mutatesCommitRows: false;
}

/** What the resolver returns. Read `ok` first. */
export type CommitCurrencyResolution =
  | {
      ok: true;
      currency: string;
      /** `round_record` — the round's own recorded currency was used.
       *  `owner_declaration` — the round had none and the owner's declared
       *  currency was applied, with the attribution below. */
      provenance: "round_record" | "owner_declaration";
      roundId: string;
      /** Present only for `owner_declaration`. Never a bare currency. */
      attribution: {
        declarationKey: string;
        rulingRef: string;
        declaredBy: string;
        effectiveAt: string;
        basis: "legacy_round_predates_declaration" | "round_record_absent";
      } | null;
    }
  | {
      ok: false;
      code:
        | "ROUND_CURRENCY_NOT_SET"
        | "ROUND_CURRENCY_UNREADABLE"
        | "ROUND_REFERENCE_UNUSABLE"
        | "CURRENCY_DECLARATION_UNAVAILABLE";
      /** Human sentence. Asserted `< 240` chars so it survives the client's
       *  `looksHuman` gate (client/src/lib/queryClient.ts:60-65). */
      message: string;
      /** The missing fact, named. */
      missingFact: string;
      roundId: string;
    };

/* ─────────────────────────────────────────────────────────────────────────── */
/* READING THE CENSUS — SELECT ONLY. NOTHING HERE WRITES A COMMIT ROW.         */
/* ─────────────────────────────────────────────────────────────────────────── */

interface CommitCensus {
  rowCount: number;
  maxSeq: number;
  maxTs: string | null;
}

/**
 * The three reads that define the declaration's coverage. Deliberately the ONLY
 * place in wave 195 that names `captable_commits`, and every statement is a
 * SELECT. A read failure returns a zero census rather than throwing, so a
 * declaration is still recorded (covering nothing) instead of failing boot.
 */
function readCommitCensus(): CommitCensus {
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n, MAX(seq) AS maxSeq, MAX(ts) AS maxTs
           FROM captable_commits
          WHERE deleted_at IS NULL`,
      )
      .get() as { n?: number; maxSeq?: number | null; maxTs?: string | null } | undefined;
    const n = typeof row?.n === "number" ? row.n : 0;
    const maxSeq = typeof row?.maxSeq === "number" ? row.maxSeq : 0;
    const maxTs = typeof row?.maxTs === "string" ? row.maxTs : null;
    return { rowCount: n, maxSeq, maxTs };
  } catch (err) {
    log.warn(
      "[wave195CommitCurrencyDeclaration] commit census read failed:",
      (err as Error).message,
    );
    return { rowCount: 0, maxSeq: 0, maxTs: null };
  }
}

/** The rounds census, recorded alongside so the honesty argument stays checkable. */
function readRoundsCensus(): { total: number; withoutCurrency: number } {
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN currency IS NULL OR TRIM(currency) = '' THEN 1 ELSE 0 END) AS noCcy
           FROM rounds`,
      )
      .get() as { total?: number; noCcy?: number | null } | undefined;
    return {
      total: typeof row?.total === "number" ? row.total : 0,
      withoutCurrency: typeof row?.noCcy === "number" ? row.noCcy : 0,
    };
  } catch (err) {
    log.warn(
      "[wave195CommitCurrencyDeclaration] rounds census read failed:",
      (err as Error).message,
    );
    return { total: 0, withoutCurrency: 0 };
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* RECORDING THE DECLARATION (ITEM A.1 + A.2)                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Record the owner's declaration, once, as data — and audit it.
 *
 * IDEMPOTENT. `ensurePlatformConfigKey()` returns the existing row untouched if
 * the key is already present, so this is safe to call on every boot (the sacred
 * bootstrap re-runs on every boot, and A-22 requires that). The audit row is
 * appended ONLY on the boot that actually records the declaration: a declaration
 * is made once, so it is audited once.
 *
 * Returns the recorded declaration, or `null` if it could not be recorded — in
 * which case `resolveCommitCurrency()` will REFUSE rather than assume USD.
 */
export function ensureCommitCurrencyDeclaration(
  now: Date = new Date(),
): CommitCurrencyDeclaration | null {
  const already = readCommitCurrencyDeclaration();
  if (already) return already;

  const commits = readCommitCensus();
  const rounds = readRoundsCensus();

  const declaration: CommitCurrencyDeclaration = {
    declaredCurrency: DECLARED_CURRENCY_AS_DECLARED_BY_OWNER,
    effectiveAt: now.toISOString(),
    declaredBy: "owner",
    declaredByRole: "owner",
    rulingRef: "R167",
    rulingQuote: OWNER_DECLARATION_QUOTE,
    reason: DECLARATION_REASON,
    coversRowCount: commits.rowCount,
    coversMaxCommitSeq: commits.maxSeq,
    coversMaxCommitTs: commits.maxTs,
    roundsTotalAtDeclaration: rounds.total,
    roundsWithoutCurrencyAtDeclaration: rounds.withoutCurrency,
    boundaryStatement:
      "Covers only cap-table commit rows in existence at effectiveAt, identified by " +
      "seq <= coversMaxCommitSeq. A commit recorded after this derives its currency " +
      "from its round and does not inherit this declaration. No commit row was read " +
      "for anything other than this census, and none was altered.",
    mutatesCommitRows: false,
  };

  let recorded: CommitCurrencyDeclaration | null = null;
  try {
    ensurePlatformConfigKey({
      key: COMMIT_CURRENCY_DECLARATION_KEY,
      valueJson: JSON.stringify(declaration),
      valueType: "json",
      description:
        "R167 (owner, 2026-08-28): the cap-table commit rows that existed when this " +
        "was recorded are declared to be in declaredCurrency. A statement about those " +
        "rows, not a mutation of them; the hash-chained ledger is untouched.",
      createdBy: "owner:r167_declaration",
    });
    recorded = readCommitCurrencyDeclaration();
  } catch (err) {
    const code =
      err instanceof PlatformConfigWriteError ? err.code : "CONFIG_WRITE_FAILED";
    log.error(
      `[wave195CommitCurrencyDeclaration] the owner's USD declaration could NOT be ` +
        `recorded (${code}): ${(err as Error).message}. Cap-table commits that cannot ` +
        `resolve a currency from their round will REFUSE rather than assume a currency.`,
    );
    return null;
  }

  if (!recorded) {
    log.error(
      "[wave195CommitCurrencyDeclaration] the declaration write reported success but " +
        "the row could not be read back. Refusing to report the declaration as recorded.",
    );
    return null;
  }

  /* ══ ITEM A.2 — AUDITED THROUGH WAVE 186'S WRITER, NOT A SECOND PATH ══════
     A declaration about 1017 money rows is a money-bearing event, so the
     bearing is "money" and the write outcome is CHECKED rather than discarded.
     Discarding it is the habit that let a three-month ledger outage pass
     unnoticed (R159.1). It does not refuse anything: the declaration row is
     already durable in an undeletable, trigger-defended table by the time this
     runs, so throwing here would strand a recorded declaration behind a failed
     log line. */
  reportAuditWriteOutcome(
    appendAdminAudit(
      "owner",
      COMMIT_CURRENCY_DECLARATION_AUDIT_ENTITY,
      COMMIT_CURRENCY_DECLARATION_AUDIT_ACTION,
      {
        declarationKey: COMMIT_CURRENCY_DECLARATION_KEY,
        declaredCurrency: recorded.declaredCurrency,
        declaredBy: recorded.declaredBy,
        effectiveAt: recorded.effectiveAt,
        rulingRef: recorded.rulingRef,
        rulingQuote: recorded.rulingQuote,
        reason: recorded.reason,
        coversRowCount: recorded.coversRowCount,
        coversMaxCommitSeq: recorded.coversMaxCommitSeq,
        coversMaxCommitTs: recorded.coversMaxCommitTs,
        roundsTotalAtDeclaration: recorded.roundsTotalAtDeclaration,
        roundsWithoutCurrencyAtDeclaration: recorded.roundsWithoutCurrencyAtDeclaration,
        commitRowsMutated: 0,
        backfilled: false,
        storedIn: "platform_config",
        auditWave: 195,
      },
    ),
    {
      bearing: "money",
      action: COMMIT_CURRENCY_DECLARATION_AUDIT_ACTION,
      route: "boot.wave195.commit_currency_declaration",
      subject: COMMIT_CURRENCY_DECLARATION_KEY,
    },
  );

  log.info(
    `[wave195CommitCurrencyDeclaration] recorded the owner's R167 declaration: ` +
      `${recorded.coversRowCount} cap-table commit row(s) up to seq ` +
      `${recorded.coversMaxCommitSeq} declared ${recorded.declaredCurrency}, ` +
      `effective ${recorded.effectiveAt}. No row was modified.`,
  );

  return recorded;
}

/**
 * Read the recorded declaration. Returns `null` when it is absent, unreadable,
 * or structurally wrong — every one of which makes the resolver REFUSE.
 */
export function readCommitCurrencyDeclaration(): CommitCurrencyDeclaration | null {
  let row;
  try {
    row = readConfigRow(COMMIT_CURRENCY_DECLARATION_KEY);
  } catch (err) {
    log.warn(
      "[wave195CommitCurrencyDeclaration] declaration read failed:",
      (err as Error).message,
    );
    return null;
  }
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.valueJson);
  } catch {
    log.error(
      "[wave195CommitCurrencyDeclaration] the declaration row is not readable JSON. " +
        "Treating the declaration as ABSENT so no commit can inherit a guessed currency.",
    );
    return null;
  }
  const d = parsed as Partial<CommitCurrencyDeclaration> | null;
  if (
    !d ||
    typeof d.declaredCurrency !== "string" ||
    !/^[A-Z]{3}$/.test(d.declaredCurrency) ||
    typeof d.effectiveAt !== "string" ||
    d.effectiveAt.length === 0 ||
    typeof d.coversMaxCommitSeq !== "number" ||
    typeof d.coversRowCount !== "number"
  ) {
    log.error(
      "[wave195CommitCurrencyDeclaration] the declaration row is present but does not " +
        "carry a readable currency, effective date and coverage. Treating it as ABSENT.",
    );
    return null;
  }
  return {
    declaredCurrency: d.declaredCurrency,
    effectiveAt: d.effectiveAt,
    declaredBy: typeof d.declaredBy === "string" ? d.declaredBy : "owner",
    declaredByRole: typeof d.declaredByRole === "string" ? d.declaredByRole : "owner",
    rulingRef: typeof d.rulingRef === "string" ? d.rulingRef : "R167",
    rulingQuote: typeof d.rulingQuote === "string" ? d.rulingQuote : OWNER_DECLARATION_QUOTE,
    reason: typeof d.reason === "string" ? d.reason : DECLARATION_REASON,
    coversRowCount: d.coversRowCount,
    coversMaxCommitSeq: d.coversMaxCommitSeq,
    coversMaxCommitTs: typeof d.coversMaxCommitTs === "string" ? d.coversMaxCommitTs : null,
    roundsTotalAtDeclaration:
      typeof d.roundsTotalAtDeclaration === "number" ? d.roundsTotalAtDeclaration : 0,
    roundsWithoutCurrencyAtDeclaration:
      typeof d.roundsWithoutCurrencyAtDeclaration === "number"
        ? d.roundsWithoutCurrencyAtDeclaration
        : 0,
    boundaryStatement: typeof d.boundaryStatement === "string" ? d.boundaryStatement : "",
    mutatesCommitRows: false,
  };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* THE BOUNDARY (ITEM A.4)                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Is this commit row covered by the owner's declaration?
 *
 * TRUE only for rows that existed AS AT the declaration — `seq` at or below the
 * boundary captured when it was recorded. A row created afterwards is NOT
 * covered and must derive its currency from its round, which is exactly what
 * R167.2 item 4 requires and what wave 195's test asserts.
 *
 * `seq` is an integer sequence number, not money; the only operation is an
 * integer comparison.
 */
export function isCoveredByDeclaration(seq: number): boolean {
  const d = readCommitCurrencyDeclaration();
  if (!d) return false;
  if (!Number.isInteger(seq) || seq < 1) return false;
  return seq <= d.coversMaxCommitSeq;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* THE REFUSAL COPY (ITEM B.2 + B.5)                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * WAVE 192's LESSON, ENCODED. A 244-character headline silently failed the
 * client's 240-character `looksHuman` gate, so its named subject never reached a
 * screen. The gate, verbatim from client/src/lib/queryClient.ts:60-65:
 *
 *     serverMessage.length > 0 && serverMessage.length < 240 && /[a-z]/.test(...)
 *
 * `< 240`, strictly. Every message below is built from a short fixed sentence
 * plus a BOUNDED interpolation, and a test asserts the assembled length for the
 * worst case rather than trusting this comment.
 */
export const LOOKS_HUMAN_MAX_LENGTH = 240;

/**
 * The longest identifier fragment allowed into a refusal sentence.
 *
 * MEASURED, NOT GUESSED. The first draft of this module used 48 with slightly
 * longer prose, and the worst case came out at **247 characters** — wave 192's
 * failure reproduced exactly, inside a wave written to avoid it. The budget below
 * is the measured value that keeps every message under the gate, and
 * `fitToGate()` re-checks at runtime so a future edit to the wording cannot
 * silently reintroduce the bug.
 */
const MAX_ID_FRAGMENT = 32;

/** Progressively tighter budgets `fitToGate()` falls back through. */
const ID_FRAGMENT_BUDGETS: readonly number[] = [MAX_ID_FRAGMENT, 24, 16, 8, 0];

/** Bound an untrusted identifier so an absurd id cannot push a message over the
 *  gate and get silently swallowed on the client. */
function boundedFragment(raw: string, budget: number): string {
  const s = String(raw ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (s.length === 0) return "(none given)";
  if (budget <= 0) return "(omitted, too long)";
  if (s.length <= budget) return s;
  return `${s.slice(0, budget - 1)}\u2026`;
}

/**
 * BUILD A REFUSAL THAT ACTUALLY REACHES A SCREEN.
 *
 * Assembles the message at the widest identifier budget that still lands under
 * the client's 240-character `looksHuman` limit, tightening the identifier rather
 * than letting it push the whole sentence over the edge — where the client
 * discards it and shows a generic fallback instead of the named missing fact.
 * The final budget of 0 omits the identifier entirely, so even a pathological
 * input still yields a short, readable, human sentence.
 */
/* WAVE 197 / R166.2 — exported, unchanged. The 240-character gate has now
   silently swallowed a message twice (waves 192 and 195); wave 195 built this as
   the structural fix, so wave 197 reuses it for its sanitised failure copy
   rather than writing a second length discipline. Export only: no behaviour,
   signature or prose in this function is altered. */
export function fitToGate(build: (idBudget: number) => string): string {
  for (let i = 0; i < ID_FRAGMENT_BUDGETS.length; i += 1) {
    const candidate = build(ID_FRAGMENT_BUDGETS[i]);
    if (candidate.length < LOOKS_HUMAN_MAX_LENGTH) return candidate;
  }
  /* Unreachable with the current prose — the fixed text alone is far under the
     gate — but a truncation still beats a message nobody can read. */
  return build(0).slice(0, LOOKS_HUMAN_MAX_LENGTH - 1);
}

export function roundCurrencyNotSetMessage(roundId: string): string {
  return fitToGate(
    (b) =>
      "No currency is recorded for this round, so nothing was committed. " +
      "Set the round's currency and commit again. The owner's declaration covers " +
      "only rounds that existed when it was made. Round: " +
      `${boundedFragment(roundId, b)}.`,
  );
}

export function roundCurrencyUnreadableMessage(roundId: string, value: string): string {
  return fitToGate(
    (b) =>
      "This round's recorded currency is not a readable three-letter code, so " +
      "nothing was committed. Correct it on the round and commit again. Round: " +
      `${boundedFragment(roundId, b)}. Recorded value: ${boundedFragment(value, b)}.`,
  );
}

/**
 * ADDED BY THE ADVERSARIAL PASS, NOT BY THE ORIGINAL DESIGN.
 *
 * The first build handed any request back to the sacred handler when it could not
 * read a string `roundId` (`if (!companyId || !roundId) return next()`), on the
 * reasoning that inventing a 400 there would take a response away from the sacred
 * handler. Attack X1h disproved that reasoning by exercise: `roundId: 12345` and
 * `roundId: ["r"]` were ACCEPTED by the sacred handler, which returned 200 and
 * wrote a commit row whose currency came from the very `?? "USD"` line this wave
 * exists to starve - and whose stored round reference did not round-trip, so
 * `verifyChain()` then reported the ledger broken.
 *
 * A round reference that is PRESENT but not a string is not a missing id the
 * sacred handler can validate; it is an unusable one, and the currency question
 * cannot even be asked about it. So it is refused here and named, which is what
 * B.2 requires: refuse and name the missing fact, never quietly become USD.
 *
 * An ABSENT or EMPTY id is still handed back untouched, because the sacred handler
 * already answers those itself - measured, not assumed: in X1h `undefined`, `null`
 * and `""` each returned 400 before this refusal existed, and still do.
 */
export function roundReferenceUnusableMessage(kind: string): string {
  return fitToGate(
    (b) =>
      "This commit did not name a round in a form the platform can read, so " +
      "nothing was committed. Send the round's identifier as text and try again. " +
      `Received: ${boundedFragment(kind, b)}.`,
  );
}

export function declarationUnavailableMessage(): string {
  return (
    "The platform cannot read the owner's currency declaration, so nothing was " +
    "committed. A cap-table commit is never recorded with a guessed currency. " +
    "Ask an administrator to restore the declaration, then try again."
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* THE RESOLVER (ITEM B.1 + B.2 + B.3)                                         */
/* ─────────────────────────────────────────────────────────────────────────── */

interface RoundCurrencyRow {
  currency: string | null;
  createdAt: string | null;
}

/** Read the round's own record. SELECT only. `undefined` means no such row. */
function readRoundCurrencyRow(roundId: string): RoundCurrencyRow | undefined {
  try {
    const db: any = rawDb();
    const r = db
      .prepare(`SELECT currency, created_at AS createdAt FROM rounds WHERE id = ?`)
      .get(roundId) as { currency?: string | null; createdAt?: string | null } | undefined;
    if (!r) return undefined;
    return {
      currency: typeof r.currency === "string" ? r.currency : null,
      createdAt: typeof r.createdAt === "string" ? r.createdAt : null,
    };
  } catch (err) {
    log.warn(
      "[wave195CommitCurrencyDeclaration] round currency read failed:",
      (err as Error).message,
    );
    return undefined;
  }
}

/**
 * Resolve the currency a cap-table commit must be recorded in — BEFORE the
 * sacred store ever needs its `?? "USD"` default.
 *
 * ══ THE SIX BRANCHES, AND WHY THIS LINE AND NOT A STRICTER ONE ═══════════════
 * The judgement call R167.3 leaves open is what to do when a round has no
 * currency. Rounds are 1045/1045 NULL, so a strict refusal would block commits
 * on EVERY existing round. Wave 193 faced the same tension and chose: refuse on
 * a genuine contradiction, resolve when the record is merely absent. The same
 * line is taken here, with one branch the brief could not have anticipated
 * (branch 5), added because it was MEASURED:
 *
 *  1. round exists, currency is a readable 3-letter code
 *        -> USE IT. The record always wins. This is the forward fix.
 *  2. round exists, currency present but NOT a 3-letter code
 *        -> REFUSE. A malformed currency is a contradiction, not an absence.
 *  3. round exists, currency blank/NULL, created at or before effectiveAt
 *        (or created_at unknown)
 *        -> the DECLARED currency, read out of the recorded declaration, with
 *           attribution. Legacy state; all 1045 existing rounds land here.
 *  4. round exists, currency blank/NULL, created AFTER effectiveAt
 *        -> REFUSE and name the missing fact. Wave 191 made currency settable
 *           and required on new rounds, so this is a GENUINE GAP, not legacy
 *           state. This is the branch that makes the sacred default UNREACHABLE
 *           rather than removed.
 *  5. no round row at all
 *        -> the DECLARED currency, attributed as `round_record_absent`.
 *           MEASURED, not assumed: one of the 1017 live commits already
 *           references a round with no row, and 50 pre-existing green tests
 *           commit against synthetic round ids that have no row either
 *           (sprint25_captable_batch, captableCommit, v15_captable_auth,
 *           v24_2_wire_funded). Refusing here would block money on legacy state
 *           and turn 50 green tests red — the precise harm the brief warns
 *           against. It is also unknowable whether such a commit is
 *           post-declaration, and fail-closed on an unknowable means blocking
 *           capital.
 *  6. the declaration itself cannot be read
 *        -> REFUSE. This is the branch that makes 3 and 5 honest. There is no
 *           path in wave 195 that produces a currency without having read the
 *           owner's recorded declaration first.
 *
 * WHY BRANCHES 3 AND 5 ARE NOT "QUIETLY BECOMING USD": the value is read from
 * the declaration ROW, never from a literal in this code path; if the row is
 * gone the commit refuses; and every such resolution carries `attribution`
 * naming the declaration key, the ruling, the declarer and the effective date,
 * which the routes put on the response and the provenance surface reports. A
 * silent USD is one nobody can trace. This one names its authority.
 */
export function resolveCommitCurrency(roundId: string): CommitCurrencyResolution {
  const id = String(roundId ?? "");
  const round = readRoundCurrencyRow(id);

  /* Branch 1 / 2 — the round's OWN record, which always outranks a declaration. */
  if (round && round.currency !== null && round.currency.trim().length > 0) {
    const raw = round.currency.trim();
    const upper = raw.toUpperCase();
    if (/^[A-Z]{3}$/.test(upper)) {
      return {
        ok: true,
        currency: upper,
        provenance: "round_record",
        roundId: id,
        attribution: null,
      };
    }
    return {
      ok: false,
      code: "ROUND_CURRENCY_UNREADABLE",
      message: roundCurrencyUnreadableMessage(id, raw),
      missingFact: `rounds.currency for round ${id} is '${raw}', which is not a three-letter currency code`,
      roundId: id,
    };
  }

  /* Branch 6 — no declaration, no authority for a currency, no commit. */
  const d = readCommitCurrencyDeclaration();
  if (!d) {
    return {
      ok: false,
      code: "CURRENCY_DECLARATION_UNAVAILABLE",
      message: declarationUnavailableMessage(),
      missingFact: `the owner's currency declaration '${COMMIT_CURRENCY_DECLARATION_KEY}' is not recorded or not readable`,
      roundId: id,
    };
  }

  /* Branch 5 — no round record at all. */
  if (!round) {
    return {
      ok: true,
      currency: d.declaredCurrency,
      provenance: "owner_declaration",
      roundId: id,
      attribution: {
        declarationKey: COMMIT_CURRENCY_DECLARATION_KEY,
        rulingRef: d.rulingRef,
        declaredBy: d.declaredBy,
        effectiveAt: d.effectiveAt,
        basis: "round_record_absent",
      },
    };
  }

  /* Branch 4 — created AFTER the declaration with no currency: a genuine gap.
     String comparison of two ISO-8601 UTC timestamps is a correct chronological
     comparison and involves no date arithmetic. An unparseable or absent
     created_at falls through to branch 3, because "unknown" must not be read as
     "after". */
  if (round.createdAt !== null && isStrictlyAfter(round.createdAt, d.effectiveAt)) {
    return {
      ok: false,
      code: "ROUND_CURRENCY_NOT_SET",
      message: roundCurrencyNotSetMessage(id),
      missingFact: `rounds.currency is not set for round ${id}, which was created at ${round.createdAt}, after the owner's declaration took effect at ${d.effectiveAt}`,
      roundId: id,
    };
  }

  /* Branch 3 — legacy round that predates the declaration. */
  return {
    ok: true,
    currency: d.declaredCurrency,
    provenance: "owner_declaration",
    roundId: id,
    attribution: {
      declarationKey: COMMIT_CURRENCY_DECLARATION_KEY,
      rulingRef: d.rulingRef,
      declaredBy: d.declaredBy,
      effectiveAt: d.effectiveAt,
      basis: "legacy_round_predates_declaration",
    },
  };
}

/**
 * Chronological comparison of two ISO-8601 instants, done on the parsed epoch
 * milliseconds so a `+00:00` offset and a `Z` suffix compare correctly. Returns
 * FALSE when either side is unparseable — "unknown" must never be read as
 * "after the declaration", because that would refuse a legacy round.
 *
 * These are timestamps, not amounts. `Date.parse` is not money arithmetic and
 * the money rule (never Number/parseInt/parseFloat for arithmetic) is untouched:
 * no amount is read, converted or compared anywhere in this module.
 */
function isStrictlyAfter(candidate: string, reference: string): boolean {
  const a = Date.parse(candidate);
  const b = Date.parse(reference);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a > b;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* THE PROVENANCE SURFACE (ITEM A.5)                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

export interface CommitCurrencyProvenance {
  /** Is a declaration recorded at all? */
  declared: boolean;
  declarationKey: string;
  /** The one-sentence answer to "why does the platform believe these are USD?" */
  statement: string;
  declaredCurrency: string | null;
  declaredBy: string | null;
  effectiveAt: string | null;
  rulingRef: string | null;
  rulingQuote: string | null;
  reason: string | null;
  coversRowCount: number | null;
  coversMaxCommitSeq: number | null;
  /** Stated explicitly, because it is the thing that keeps the chain intact. */
  commitRowsModified: 0;
  backfilled: false;
  /** How many of the rows on THIS response are covered by the declaration, and
   *  how many were recorded after it and therefore carry their own provenance. */
  coveredOnThisResponse?: number;
  notCoveredOnThisResponse?: number;
}

/**
 * The lightest honest placement (Item A.5). One object, attached to the payloads
 * that already report cap-table amounts and their currency, and served on its own
 * endpoint so the question can be asked directly. Not shouted on a screen; not
 * hidden either.
 *
 * `seqs` is optional: when the caller passes the sequence numbers on the payload,
 * the counts make the boundary visible in the same breath as the amounts.
 */
export function commitCurrencyProvenance(seqs?: readonly number[]): CommitCurrencyProvenance {
  const d = readCommitCurrencyDeclaration();
  if (!d) {
    return {
      declared: false,
      declarationKey: COMMIT_CURRENCY_DECLARATION_KEY,
      statement:
        "No owner currency declaration is recorded on this platform. Historical " +
        "cap-table commit currencies are as recorded, with no declaration behind them.",
      declaredCurrency: null,
      declaredBy: null,
      effectiveAt: null,
      rulingRef: null,
      rulingQuote: null,
      reason: null,
      coversRowCount: null,
      coversMaxCommitSeq: null,
      commitRowsModified: 0,
      backfilled: false,
    };
  }
  const base: CommitCurrencyProvenance = {
    declared: true,
    declarationKey: COMMIT_CURRENCY_DECLARATION_KEY,
    statement:
      `The ${d.coversRowCount} cap-table commit row(s) that existed on ` +
      `${d.effectiveAt} are ${d.declaredCurrency} by ${d.declaredBy} declaration ` +
      `(${d.rulingRef}), not by their own round's record: the round's currency was ` +
      `never recorded on them. Reason given: ${d.reason}. The rows themselves were ` +
      `not changed — the hash-chained ledger is byte-for-byte as it was. Commits ` +
      `recorded after ${d.effectiveAt} take their currency from their round.`,
    declaredCurrency: d.declaredCurrency,
    declaredBy: d.declaredBy,
    effectiveAt: d.effectiveAt,
    rulingRef: d.rulingRef,
    rulingQuote: d.rulingQuote,
    reason: d.reason,
    coversRowCount: d.coversRowCount,
    coversMaxCommitSeq: d.coversMaxCommitSeq,
    commitRowsModified: 0,
    backfilled: false,
  };
  if (!seqs) return base;
  let covered = 0;
  let notCovered = 0;
  seqs.forEach((s) => {
    if (Number.isInteger(s) && s >= 1 && s <= d.coversMaxCommitSeq) covered += 1;
    else notCovered += 1;
  });
  return { ...base, coveredOnThisResponse: covered, notCoveredOnThisResponse: notCovered };
}

/**
 * A stable fingerprint of the declaration row, so a test — or an auditor — can
 * show the declaration has not been altered without re-reading its whole body.
 */
export function declarationFingerprint(): string | null {
  const row = readConfigRow(COMMIT_CURRENCY_DECLARATION_KEY);
  if (!row) return null;
  return createHash("sha256")
    .update(`${row.key}\u0000${row.version}\u0000${row.valueJson}\u0000${row.revisionHash}`)
    .digest("hex")
    .slice(0, 24);
}
