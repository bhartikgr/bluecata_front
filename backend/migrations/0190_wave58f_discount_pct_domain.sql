/* ═══════════════════════════════════════════════════════════════════════════
 * 0190 — WAVE 58f · F0. THE `captable_commits.discount_pct` DOMAIN IS
 *        PERCENT-AS-WRITTEN, NOT A FRACTION. THE 0153 TRIGGER WAS THE OUTLIER.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS WRONG, IN ONE SENTENCE
 *   Migration 0153 fenced `captable_commits.discount_pct` to a FRACTION in
 *   [0,1], but every writer and every reader of that column treats it as
 *   PERCENT-AS-WRITTEN ("20" = 20%). So the database rejected the exact value
 *   the platform is designed to store, and the first SAFE or convertible note
 *   committed with a discount would have failed with a raw SQLite abort.
 *
 * REPRODUCED BY EXECUTION (Wave 58f, against 0153's own trigger text):
 *     '20'   -> ABORT  DISCOUNT_PCT_OUT_OF_DOMAIN:expected fraction 0..1
 *     '0.2'  -> ACCEPTED        (0.2% under R30, silently accepted as "20%")
 *     '100'  -> ABORT
 *     ''     -> ABORT
 *   It has never fired in production only because the `securities` ledger is
 *   empty — nothing has ever been committed on any tenant.
 *
 * ── WHICH SIDE IS WRONG, AND WHY. NAMED, NOT ASSUMED. ─────────────────────
 * FOUR authorities describe this column. THREE say percent-as-written; ONE
 * says fraction, and one further one is dead documentation:
 *
 *   PERCENT-AS-WRITTEN (correct)
 *     · OWNER RULING R30 — storage is PERCENT-AS-WRITTEN; only the ENGINE WIRE
 *       is fractional. R16 forbids inferring a unit from a magnitude, so a
 *       stored "20" may never be re-read as 0.2 or rescaled.
 *     · `shared/schema.ts:1425` — `discountPct: text("discount_pct"),
 *       // Decimal-as-string (e.g. "20" = 20%)`.
 *     · THE WRITER — `server/captableCommitStore.ts:575` (SACRED, UNMODIFIED by
 *       this wave) writes `round.discount` VERBATIM, and `rounds.extras_json`
 *       holds percent-as-written (`"discount": 20` on live's two clean rounds).
 *     · THE READERS — `server/routes.ts:2127` and
 *       `server/captableSnapshotsStore.ts:109` project `Number(discountPct)`
 *       into the securities shape, and `shared/roundMathEngineAdapter.ts`'s
 *       `toWireDiscount` then divides by 100 exactly once to reach the wire.
 *       A stored 0.2 would price as a 0.2% discount, not 20%.
 *
 *   FRACTION (the outliers)
 *     · 0153's two triggers, corrected here.
 *     · `server/lib/percentPolicy.ts` `"captable.discountPct"` declares
 *       `inputForm: "fraction", min: 0, max: 1`. VERIFIED registry-only: that
 *       key has NO caller anywhere in the tree, so it fences nothing today. It
 *       is corrected in the same wave so the two cannot disagree on paper.
 *
 *   DEAD DOCUMENTATION
 *     · 0153's own header promises a parallel `discount_pct_scaled` INTEGER
 *       column "for arithmetic". VERIFIED: `discount_pct_scaled` does NOT
 *       EXIST anywhere in the tree — no DDL, no reader, no writer. The promise
 *       was never implemented. Nothing here creates it: an unused column on a
 *       hashed ledger is a second place for the same number to live, which is
 *       the R21 defect class. It is reported, not built.
 *
 * ── WHY THIS IS SAFE FOR ALREADY-COMMITTED ROWS ───────────────────────────
 * The new domain [0,100) STRICTLY CONTAINS the old domain [0,1]:
 *       0 <= x <= 1   IMPLIES   0 <= x < 100.
 * So NO row that the old fence accepted can be rejected by the new one, and
 * NOT ONE EXISTING ROW IS READ, REWRITTEN OR RE-HASHED by this migration.
 * That is deliberate: `discount_pct` ENTERS THE COMMIT HASH BODY
 * (`buildCommitBody`), so rewriting a committed value would alter immutable
 * history — forbidden by the R17 principle.
 *
 * THE ONE RESIDUAL RISK, STATED PLAINLY. If a row already exists whose
 * `discount_pct` was written as a FRACTION (e.g. "0.2" meaning 20%), widening
 * the domain does not fix it and this migration will not guess: under R16 the
 * magnitude "0.2" is not evidence of the unit, and after this migration it
 * reads as 0.2%. Wave 58f could not query production, so the following
 * READ-ONLY census must be run before this migration is applied to live:
 *
 *     SELECT COUNT(*)                       AS rows_with_discount,
 *            SUM(CAST(discount_pct AS REAL) <= 1) AS possibly_fractional
 *     FROM captable_commits
 *     WHERE discount_pct IS NOT NULL AND discount_pct <> '';
 *
 * If `rows_with_discount` is 0 — the expectation, since `securities` is empty —
 * there is nothing to interpret and this migration is unambiguous. If it is
 * NOT 0, STOP and escalate: the rows must be classified by hand, because the
 * fix is a matter of fact about what each counterparty agreed, not arithmetic.
 *
 * And the read-only query that CONFIRMS the old trigger is actually present on
 * live (its presence there is INFERRED from the migration ledger, never
 * observed by this wave):
 *
 *     SELECT name, sql FROM sqlite_master
 *      WHERE type='trigger' AND name LIKE 'trg_captable_commits_discount_pct%';
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 * NOT a removal of the fence. The column keeps a domain, enforced at the
 * table, in both directions (INSERT and UPDATE). Non-numeric text, the empty
 * string, negatives and >= 100 are all still ABORTED. The refusal code is
 * CHANGED so a future reader is never told "expected fraction 0..1" again.
 *
 * NOT a rescale. Nothing divides or multiplies. R16 stands.
 *
 * ── THE R21 ANTI-DUPLICATION NOTE ─────────────────────────────────────────
 * A SQLite trigger cannot import TypeScript, so the numeric bound 100 appears
 * both here and in `DISCOUNT_STORED_PERCENT_MAX` in
 * `shared/roundMathEngineAdapter.ts`. That is an unavoidable second statement
 * of one rule. It is fenced instead of ignored: the Wave 58f test
 * `W58F-F0d` READS THIS FILE and asserts its bound equals the shared
 * constant, so the two cannot drift silently.
 *
 * IDEMPOTENT. Each trigger is removed if present, then re-created (see the
 * statements below).
 *
 * A NOTE FOR WHOEVER WRITES 0191 -- THIS COST TWO ITERATIONS, SO IT IS RECORDED.
 * Do NOT write the two-word phrase "remove-a-trigger" (in its real SQL spelling)
 * inside a COMMENT in a migration file. The Wave 0 lint at
 * server/__tests__/_wave0_ast_lint.ts:248 pre-transforms migrations with a
 * regex that is COMMENT-BLIND and whose tail matches everything up to the next
 * semicolon. Written in prose, the phrase matches and the tail then consumes
 * forward across the comment and into the first real statement.
 *
 * The first draft of this file said it in prose and took two lint suites
 * (wave0_2_strict_check_conventions_lint, wave0_9_program_wide_replace_lint) to
 * a COLLECTION failure -- "lost statements: 6 before, 0 after". A collection
 * failure emits ZERO test names, so it LOOKED like four tests newly passing. It
 * was a regression, not an improvement. The second draft quoted the regex itself
 * in this very note and reproduced the fault. Reported in WAVE58F_REPORT.md as a
 * latent trap: the lint transform, not this migration, is the real defect.
 * Re-running is a no-op. Touches no rows and no other table.
 * ═══════════════════════════════════════════════════════════════════════════ */

DROP TRIGGER IF EXISTS trg_captable_commits_discount_pct_ins;
DROP TRIGGER IF EXISTS trg_captable_commits_discount_pct_upd;

CREATE TRIGGER IF NOT EXISTS trg_captable_commits_discount_pct_ins
  BEFORE INSERT ON captable_commits
  WHEN NEW.discount_pct IS NOT NULL
   AND (NEW.discount_pct = ''
        OR CAST(NEW.discount_pct AS REAL) < 0
        OR CAST(NEW.discount_pct AS REAL) >= 100)
  BEGIN SELECT RAISE(ABORT, 'DISCOUNT_PCT_OUT_OF_DOMAIN:expected percent-as-written 0..<100 (R30); 20 means 20%'); END;

CREATE TRIGGER IF NOT EXISTS trg_captable_commits_discount_pct_upd
  BEFORE UPDATE OF discount_pct ON captable_commits
  WHEN NEW.discount_pct IS NOT NULL
   AND (NEW.discount_pct = ''
        OR CAST(NEW.discount_pct AS REAL) < 0
        OR CAST(NEW.discount_pct AS REAL) >= 100)
  BEGIN SELECT RAISE(ABORT, 'DISCOUNT_PCT_OUT_OF_DOMAIN:expected percent-as-written 0..<100 (R30); 20 means 20%'); END;
