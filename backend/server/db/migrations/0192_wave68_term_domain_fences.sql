/* ═══════════════════════════════════════════════════════════════════════════
 * 0192 — WAVE 68 · THE DATABASE-LEVEL TERM FENCE.
 *        (1) THE `discount_pct` FENCE ACCEPTS NON-NUMERIC TEXT. (2) `extras_json`
 *        CARRIES EVERY ECONOMIC TERM OF A SAFE AND HAS NO FENCE AT ALL.
 *        AMENDED IN PLACE BY WAVE 68b AFTER A THREE-WAY REVIEW. NEVER APPLIED
 *        ANYWHERE BEFORE THAT AMENDMENT — see WAVE 68b below.
 * ═══════════════════════════════════════════════════════════════════════════
 * Authorised by OWNER RULING R49 ("Fix it"), overriding the recommendation to
 * defer. Spec: spec/WAVE68_MIGRATION_0192_SPEC.md.
 * Reports: build_log/wave68/ (first build) and build_log/wave68b/ (this one).
 *
 * ── WHAT WAS WRONG, IN TWO SENTENCES ──────────────────────────────────────
 * (C-3) 0190's two triggers abort when `CAST(NEW.discount_pct AS REAL)` is < 0
 *   or >= 100. IN SQLITE `CAST('abc' AS REAL)` IS 0.0, so 'abc' satisfies
 *   neither test and PASSES the fence. Executed here, not reasoned: 'abc' -> 0.0,
 *   '20abc' -> 20.0, '2026-07-07' -> 2026.0. A date became a discount.
 * (C-2) NO TRIGGER ANYWHERE NAMED `extras_json` before this file. Measured:
 *   only 0002 and 0014 mention the column at all, and neither fences it. Yet
 *   `server/roundsStore.ts:610-643` round-trips every economic term of a SAFE,
 *   a note and a warrant through it, and it is where `discount: 20260707` was
 *   stored on the corrupt live round `rnd_64e9d6ad728a`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WAVE 68b — THE FOUR THINGS THREE INDEPENDENT REVIEWS FOUND WRONG WITH THE
 * FIRST DRAFT OF THIS FILE. It had NOT shipped; it existed only in the tree.
 * ═══════════════════════════════════════════════════════════════════════════
 * B1 · JSON BOOLEANS SILENTLY BECAME NUMBERS.
 *   `json_extract('{"discount": true}', '$.discount')` returns INTEGER 1
 *   (`typeof` = integer). So `{"discount": true}` became a 1% DISCOUNT and the
 *   character grammar saw a perfectly valid number. THE COERCION HAPPENS BEFORE
 *   VALIDATION, so no character test could ever have caught it. All six fields
 *   accepted `true`; four accepted `false`.
 *   FIX: every fenced term is gated on `json_type(...)`. 'text', 'integer' and
 *   'real' are validated as numbers. 'true', 'false', 'object' and 'array' are
 *   REFUSED BY NAME and the refusal says which one arrived. A missing key and
 *   an explicit JSON `null` remain ABSENT — never coerced to 0.
 *
 * B2 · THE FENCE WAS EVADABLE. A NEW malformed blob was accepted on INSERT, and
 *   a row could be changed from one malformed blob to another, because both
 *   triggers began `WHEN ... json_valid(NEW.extras_json)`.
 *   FIX: `json_valid(NEW.extras_json)` is REQUIRED on INSERT, and on UPDATE
 *   whenever `extras_json` itself changes. `NULL` and the empty string keep the
 *   established ABSENT convention and are accepted.
 *   R41 IS UNCHANGED AND MUST STAY UNCHANGED: a row whose stored blob is
 *   ALREADY invalid still accepts an update to an unrelated column, and
 *   `SET extras_json = extras_json` on such a row is still a no-op. The
 *   distinction is EXISTING state (grandfathered) versus a NEW write (refused).
 *
 * B3 · REFUSALS AND THE RECEIVED VALUE — REVERSED BY WAVE 78. READ THIS BEFORE
 *   PUTTING THE DYNAMIC TAIL BACK.
 *   WAVE 68 recorded "RAISE takes a STRING LITERAL in SQLite" as a spec
 *   impossibility. WAVE 68b called that reason WRONG, because a built-up
 *   expression compiles on the SQLite the APP bundles (better-sqlite3 3.49.2),
 *   and appended `Capavate received the <type> value '<value>'.` to every
 *   refusal. That probe was correct about the app and BLIND to the host.
 *   WAVE 78 measured the HOST. `sqlite3(1)` on the deploy host is 3.46.1, and
 *   SQLite accepted a built-up RAISE argument only from 3.47.0 (2024-10-21):
 *   "Beginning with version 3.47.0 the error-message can be an SQL
 *   expression. In older versions of SQLite, the error-message was required
 *   to be a string literal." (sqlite.org/lang_createtrigger.html). The host
 *   sits ONE RELEASE BELOW that line: 3.46.1 (2024-08-13).
 *   The consequence was NOT a failed migration — it was worse. The app applied
 *   the migration and wrote triggers the host CLI CANNOT PARSE, after which
 *   EVERY host `sqlite3 data.db ...` command — `.schema`,
 *   `PRAGMA integrity_check`, the ledger counts, and both commands in the
 *   deploy runbook that prove `ccm_47f69199e7396a97` was unfrozen — answered
 *   `Error: malformed database schema (trg_...) - near "||": syntax error`.
 *   A developer would reasonably read that as a corrupted production database
 *   and restore the backup. Reproduced both ways in
 *   build_log/wave78/W78_HOST_CLI_PROOF.txt.
 *   SO: EVERY `RAISE(ABORT, ...)` ARGUMENT IN THIS FILE IS A SINGLE STRING
 *   LITERAL. No `||`, no COALESCE, no CASE, no quote(), no substr() inside a
 *   RAISE argument. `scripts/lint/raise_literal_fence.mjs` (wired into
 *   `npm run preflight`) fails the build if that is ever reintroduced.
 *   WHAT IS LOST, HONESTLY: the dynamic tail is gone and CANNOT be kept here.
 *   The STATIC half is unchanged and still names the field, the rule, the
 *   accepted domain and the screen path. The RECEIVED VALUE IS STILL REPORTED,
 *   BUT BY THE APPLICATION, NOT BY THIS TRIGGER: `shared/roundMathEngineAdapter.ts`
 *   returns it in the HTTP 400 body — `boundedNumericTerm` says
 *   `Capavate received "<value>"` for maturityMonths / expiryYears /
 *   valuationCap / strikePrice / fdPreMoneyShares, and
 *   `validateDiscountPercentAsWritten` / `validateInterestRatePercentAsWritten`
 *   quote the raw value in their `message`. That is the layer a human sees:
 *   W68B-B3d already asserts NOTHING in `client/` renders these trigger codes,
 *   so the dynamic tail never reached a founder in the first place. The one
 *   place with no application echo is `ROUND_EXTRAS_JSON_INVALID`, which only a
 *   raw SQL write can trigger; for that path the received blob is no longer
 *   reported anywhere, and that is a real loss, stated rather than papered over.
 *
 * B4 · THE FLOAT BOUNDARY, FIXED WHERE IT IS SAFE TO FIX AND STATED WHERE IT IS
 *   NOT. The two PERCENT fields are validated in the application by Decimal.js,
 *   exact decimal arithmetic. This fence evaluated through binary REAL, and
 *   `CAST('99.999999999999999' AS REAL)` is EXACTLY 100.0 — so the fence
 *   refused a discount the application accepts. Symmetrically, a negative with
 *   enough zeroes underflows to -0.0 and `< 0` accepted it.
 *   FIX: for `json_type = 'text'` — and for `captable_commits.discount_pct`,
 *   which is decimal-as-string — the percent bounds are compared ON THE DIGITS,
 *   exactly, with no float involved: `ip` is the integer digits with leading
 *   zeros removed, so `length(ip) >= 3` IS "value >= 100", and a mantissa
 *   carrying a '-' and any digit 1-9 IS "value < 0".
 *   The four NON-percent fields KEEP REAL DELIBERATELY. Their application
 *   validators use `Number(raw)` — the same binary double — so REAL is what
 *   makes the two layers agree, and an exact-decimal fence there would BREAK
 *   the agreement Review 3 verified field by field. Likewise, for `json_type`
 *   'integer'/'real' the JSON parser has already produced a double on both
 *   sides, so REAL is the faithful comparison and is kept.
 *   RESIDUAL, NOT HIDDEN: a TEXT value in EXPONENT notation still falls back to
 *   REAL. A 17-significant-digit boundary value written `9.9999...e1` therefore
 *   remains divergent. Neither round writer can produce it — both pass every
 *   fenced field through `Number()` before persisting — and closing it needs a
 *   decimal-point-shifting normaliser in SQL, which is the kind of fourth hole
 *   this amendment exists to avoid.
 *
 * ALSO, from the same reviews:
 *   · Change-detection compares the json TYPE as well as the value, because
 *     `json_extract(...true...) IS json_extract(...1...)` is TRUE — both are
 *     integer 1 — so a `true` -> `1` edit was invisible to a value-only test.
 *   · The dead predicate `x = ''` is gone from the grammar. It was unreachable
 *     in the six extras clauses and REDUNDANT in the two discount_pct clauses:
 *     `epos = 0 AND alldig = 0` already refuses the empty string. Proved by
 *     execution before removal.
 *   · The scratch tables are TEMP and are removed-if-present in the `temp`
 *     schema only, so this file can no longer delete a persistent table that
 *     happens to share a name with one of them.
 *   · The self-verification block now EXECUTES the installed predicate over a
 *     table of adversarial inputs with expected verdicts. Review 1: "the
 *     postconditions check markers, not behaviour; they all pass despite the
 *     defects." One mismatch now aborts the whole migration.
 *
 * ── WHAT THIS FILE DOES ───────────────────────────────────────────────────
 * FOUR triggers, TWO pairs, on TWO different columns:
 *   captable_commits.discount_pct  trg_captable_commits_discount_pct_ins/_upd
 *                                  — 0190's two, REPLACED (not supplemented:
 *                                  two fences on one column is how the next
 *                                  reader gets a contradiction).
 *   rounds.extras_json             trg_rounds_extras_terms_ins/_upd — NEW.
 * The numeric-text test is identical in all four. It is generated from ONE
 * source of truth so the eight copies cannot drift: see
 * build_log/wave68b/gen_0192.py, which emits this file.
 *
 * ── THE NUMERIC-TEXT TEST, AND THE ATTEMPTS THAT FAILED ───────────────────
 * Recorded so none is tried again. Every one was caught by EXECUTION, not by
 * reading — which is the point:
 *   ATTEMPT 1  `CAST(x AS REAL) = 0.0 AND TRIM(x) NOT IN ('0','0.0',...)`
 *              fails on '20abc': SQLite casts the leading numeric prefix and
 *              returns 20.0, so a partly-numeric string passes as a number.
 *   ATTEMPT 2  a character-set GLOB alone
 *              fails on '2026-07-07': every character is permitted and it casts
 *              to 2026. A date silently becoming a valuation.
 *   ATTEMPT 3  the spec's composed nine clauses
 *              accept eleven of twelve adversarial inputs ('1+2', 'E5', '.',
 *              '+', '-', '.e3', '1e-', '1e+', '5+', '1e1.5', '+.'), all of
 *              which SQLite CASTs to a number. Four clauses were added.
 *   ATTEMPT 4  the character grammar PLUS a REAL range test — the first draft
 *              of this file. It cannot see a JSON boolean (B1), because the
 *              boolean has already become the integer 1 before any character is
 *              examined; and its REAL range disagrees with Decimal.js at 17
 *              significant digits (B4). THREE SUCCESSIVE VERSIONS OF THIS
 *              EXPRESSION WERE WRONG. Assume a fifth hole exists.
 * No `GLOB`: `server/__tests__/wave0_2_strict_check_conventions_lint.test.ts`
 * went RED on the first draft because the AST lint's node-sql-parser does not
 * know the `GLOB` operator inside a trigger-body SELECT. Both GLOB clauses are
 * therefore expressed with `replace`/`length`/`instr`/`substr` only.
 * Full transcripts: build_log/wave68b/W68B_ADVERSARIAL_TRANSCRIPT.md.
 *
 * ── THE TRAP THIS FILE MUST NOT FALL INTO — READ R41 BEFORE EDITING ───────
 * Migration 0153 added 12 triggers to POPULATED tables WITHOUT censusing the
 * data. The consequence is on live today: the committed row
 * `ccm_47f69199e7396a97` holds `discount_pct = '20'`, which 0153's fraction
 * fence would REFUSE. The row predates the trigger, so the trigger silently
 * exempted the violation while BLOCKING EVERY FUTURE CORRECTION OF IT. The
 * platform cannot repair data it can no longer touch. THERE ARE 112 ROUNDS ON
 * LIVE and this file fences a column on that table.
 *
 * THEREFORE THE UPDATE TRIGGER VALIDATES **CHANGES**, NOT **STATE**:
 *
 *     WHERE json_extract(NEW.extras_json,'$.discount')
 *        IS NOT json_extract(OLD.extras_json,'$.discount')
 *       AND <the new value is invalid>
 *
 * `IS NOT`, never `<>`, so a NULL transition compares correctly (`<>` yields
 * NULL against a NULL side and the guard would silently never fire).
 *
 * DO NOT "SIMPLIFY" THIS INTO AN UNCONDITIONAL CHECK. That is the 0153 trap,
 * and the effect is not a loud failure: a founder editing the round NAME on a
 * round whose stored cap is bad would get a raw SQLite abort, and the bad cap
 * would become permanent. Pre-existing bad data MUST never block an unrelated
 * write — being writable is what keeps it repairable.
 *
 * B2 DID NOT WEAKEN THIS. Refusing a NEW invalid blob is a statement about the
 * value being WRITTEN, not about the value already stored. The regression suite
 * proves both halves on the same database: four rows carrying pre-existing
 * invalid terms — malformed JSON, NULL, the empty string, and valid JSON with a
 * bad term — each accept an update to an unrelated column, while a new
 * malformed blob is refused.
 *
 * The same reasoning is applied to `discount_pct`: 0190's UPDATE trigger fired
 * on any UPDATE naming that column even when the value was not changing, so
 * `SET discount_pct = discount_pct` on a bad row aborted. `NEW.discount_pct IS
 * NOT OLD.discount_pct` is added here. This is a DELIBERATE, DISCLOSED
 * difference from 0190 and it weakens nothing: every value actually written is
 * still validated.
 *
 * ── NOT ONE EXISTING ROW IS TOUCHED (R17) ─────────────────────────────────
 * There is no UPDATE, no DELETE and no backfill in this file. `discount_pct`
 * enters the commit hash body (`buildCommitBody`), so rewriting a committed
 * value would alter immutable history. 0190 held this discipline and this file
 * matches it. The postcondition block below PROVES it: it records the row count
 * of both tables and a digest of every `discount_pct` value before the triggers
 * are replaced, re-computes both afterwards, and ABORTS THE WHOLE MIGRATION if
 * either moved. The digest is a delimiter-joined string and is therefore NOT a
 * byte-injective hash — Review 1's L2, stated rather than overclaimed; the
 * byte-for-byte comparison of every column of every seeded row is done by
 * build_log/wave68b/apply_and_test.mjs, outside the migration.
 *
 * ── WHAT IS DELIBERATELY **NOT** FENCED ───────────────────────────────────
 *   optionPoolPostPercent  PERCENT-AS-WRITTEN (R27/R16, "15" = 15%). It is NOT
 *                          fenced as a fraction here. It is not fenced at all,
 *                          because its writer stores it as an exact STRING on
 *                          purpose and the create route already refuses a
 *                          malformed one; a second, differently-worded fence is
 *                          the R21 defect class. Recorded, not built.
 *   optionPoolMode         not numeric (pre/post placement).
 *   the two ISO date keys  not numeric.
 *   sharesAuthorized, poolSize, cap, mfn, proRata, liquidationPreference,
 *   antiDilutionType, useOfProceeds
 *                          UNIT CONVENTION NOT VERIFIABLE IN SOURCE. An
 *                          unfenced field is honest; a wrongly-fenced one
 *                          corrupts writes. Every one of them is enumerated
 *                          with its evidence in
 *                          build_log/wave68/W68_FIELD_DISPOSITION.md.
 * A SQLite trigger cannot WARN, only ABORT, so owner ruling R56's date-shaped
 * WARNING for `valuationCap` / `strikePrice` is NOT in this file and must never
 * be added to it — it would become a refusal and contradict the ruling. It
 * lives in `shared/roundMathEngineAdapter.ts` and the three round writers.
 *
 * ── LIMITS OF THIS FENCE, STATED SO NOBODY OVERCLAIMS IT ──────────────────
 * 1. NOTHING IN THIS FILE IS RENDERED TO A HUMAN BEING. These refusals are raw
 *    SQLite aborts. `client/src/pages/founder/Rounds.tsx:558` is
 *    `onError: () => toast({ title: "Save failed" })`, so a founder sees two
 *    words and no field name (owner ruling R58). This fence protects the DATA,
 *    which is its whole job — it does not inform the PERSON, and no component
 *    in this tree renders these strings.
 * 2. A magnitude fence CANNOT catch a date in a money field: 20260707 is a
 *    legitimate $20,260,707 cap (R55). `valuationCap` and `strikePrice` are
 *    therefore fenced for TYPE, TEXT and ABSURD MAGNITUDE only, and the 8-digit
 *    date shape is WARNED about in the application layer under R56.
 *    `maturityMonths` and `expiryYears` DO catch 20260707, by range.
 * 3. `fdPreMoneyShares` is a first-class column, not an `extras_json` key
 *    (`roundsStore.ts:581`), and is out of this file's scope.
 * 4. The grammar accepts a NARROWER set of spellings than the application does.
 *    Tab/newline/NBSP-wrapped numbers and `0x10` are refused here and accepted
 *    by `Number()`/Decimal.js. Neither writer can produce them (both normalise
 *    before persisting), so this is a stricter fence and not a disagreement
 *    about a value's meaning — but it is a difference, and it is recorded in
 *    build_log/wave68b/W68B_ADVERSARIAL_TRANSCRIPT.md rather than claimed away.
 * 5. This install is gated on the SQLite driver (`server/routes.ts`), and this
 *    file is SQLite dialect. On any non-SQLite driver `rounds.extras_json` has
 *    NO database fence at all.
 *
 * ── A HIDDEN COUPLING, FOUND BY THIS FILE'S OWN POSTCONDITIONS ────────────
 * `server/lib/applyWave58fDiscountDomain.ts` decides whether the INSTALLED
 * fence is the corrected one with a STRING TEST on the stored trigger SQL:
 *     flat.includes("AS REAL) >= 100") && !flat.includes("AS REAL) > 1")
 * The first draft of this file aliased the cast to `v`, so that literal text
 * vanished from the trigger and the 58f installer would have reported the
 * STRONGER fence as "old_fraction_domain_still_present" for ever. The two
 * `discount_pct` triggers below therefore write that range out IN FULL, and two
 * postconditions pin both halves of that string test. This is also why the
 * `interestRate` upper bound is written `100 < v` and every money ceiling uses
 * the alias `v`: `CAST(... AS REAL) > 1000000000000` CONTAINS the forbidden
 * substring `AS REAL) > 1`.
 *
 * IDEMPOTENT AND SAFE ON A POPULATED DATABASE. Every trigger is removed-if-
 * present and then created; the scratch tables are TEMP, removed-if-present in
 * the `temp` schema before use and removed again on success, so no diagnostic
 * table is left behind.
 * RUNNER CONTRACT: no BEGIN, no COMMIT, no PRAGMA (server/db/migrate.ts).
 * Mirrored BYTE-IDENTICALLY into server/db/migrations/.
 *
 * WORDING NOTE, and it is not cosmetic. This header deliberately never writes
 * the two words D-R-O-P T-R-I-G-G-E-R together in prose. The Wave 0 AST lint
 * pre-transform (server/__tests__/_wave0_ast_lint.ts:248) rewrites that phrase
 * to "SELECT 1" up to the next semicolon and is COMMENT-BLIND, so a comment
 * containing it swallows the statement that follows, trips the lint's own
 * statement-count invariant and makes the ENTIRE lint file fail to COLLECT —
 * 20+ assertions then report as no-tests-run, which looks like a pass. Wave 58f
 * lost two suites to exactly this.
 * ═══════════════════════════════════════════════════════════════════════════ */


-- STEP 0 — record what must NOT move. Compared in STEP 4; a difference ABORTS
-- the migration and the runner's transaction rolls the whole file back.
-- TEMP, and removed-if-present in the `temp` schema ONLY: the first draft's
-- unqualified removal could have deleted a persistent operator table that
-- happened to share the name (Review 1, M3).
DROP TABLE IF EXISTS temp.w68_before;
CREATE TEMP TABLE w68_before (k TEXT PRIMARY KEY NOT NULL, v TEXT);
INSERT INTO w68_before (k, v) SELECT 'rounds_rows',            CAST(COUNT(*) AS TEXT) FROM rounds;
INSERT INTO w68_before (k, v) SELECT 'captable_commits_rows',  CAST(COUNT(*) AS TEXT) FROM captable_commits;
INSERT INTO w68_before (k, v)
SELECT 'discount_pct_digest',
       COALESCE((SELECT group_concat(d, '|') FROM
                  (SELECT id || '=' || COALESCE(discount_pct, char(30)) AS d
                     FROM captable_commits ORDER BY id)), '');


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1 — C-3. REPLACE 0190's TWO `discount_pct` TRIGGERS. Not a third pair.
-- ═══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_captable_commits_discount_pct_ins;
DROP TRIGGER IF EXISTS trg_captable_commits_discount_pct_upd;

CREATE TRIGGER trg_captable_commits_discount_pct_ins
BEFORE INSERT ON captable_commits
FOR EACH ROW
WHEN NEW.discount_pct IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'DISCOUNT_PCT_OUT_OF_DOMAIN: captable_commits.discount_pct must be a number, PERCENT-AS-WRITTEN (percentages are stored as written, so 20 means 20%), at least 0 and less than 100. The empty string, non-numeric text such as ''abc'' or ''20abc'', a BLOB, and a date such as ''2026-07-07'' or 20260707 are all refused. Correct the round''s discount before committing: Founder -> Rounds -> the round -> Edit terms -> Discount.')
    FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant
                            FROM (SELECT TRIM(CAST(NEW.discount_pct AS TEXT)) AS x,
                              typeof(NEW.discount_pct) AS t,
                              CAST(NEW.discount_pct AS TEXT) AS raw))))
   WHERE t NOT IN ('integer','real','text')
      OR (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        )
      OR (msgn = '-' AND nzmant <> '')
      OR (epos = 0 AND length(ip) >= 3)
      OR (epos > 0 AND CAST(TRIM(CAST(NEW.discount_pct AS TEXT)) AS REAL) >= 100);
END;

CREATE TRIGGER trg_captable_commits_discount_pct_upd
BEFORE UPDATE OF discount_pct ON captable_commits
FOR EACH ROW
WHEN NEW.discount_pct IS NOT NULL
 AND NEW.discount_pct IS NOT OLD.discount_pct
BEGIN
  SELECT RAISE(ABORT, 'DISCOUNT_PCT_OUT_OF_DOMAIN: captable_commits.discount_pct must be a number, PERCENT-AS-WRITTEN (percentages are stored as written, so 20 means 20%), at least 0 and less than 100. The empty string, non-numeric text such as ''abc'' or ''20abc'', a BLOB, and a date such as ''2026-07-07'' or 20260707 are all refused. Correct the round''s discount before committing: Founder -> Rounds -> the round -> Edit terms -> Discount.')
    FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant
                            FROM (SELECT TRIM(CAST(NEW.discount_pct AS TEXT)) AS x,
                              typeof(NEW.discount_pct) AS t,
                              CAST(NEW.discount_pct AS TEXT) AS raw))))
   WHERE t NOT IN ('integer','real','text')
      OR (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        )
      OR (msgn = '-' AND nzmant <> '')
      OR (epos = 0 AND length(ip) >= 3)
      OR (epos > 0 AND CAST(TRIM(CAST(NEW.discount_pct AS TEXT)) AS REAL) >= 100);
END;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2 — C-2. THE FIRST DATABASE FENCE `rounds.extras_json` HAS EVER HAD.
-- ONE pair, six fields, SEVEN statements each.
--
-- STATEMENT 1 is B2: a NEW blob that is not valid JSON is REFUSED BY NAME. The
-- first draft began `WHEN ... json_valid(NEW.extras_json)`, which silently
-- ACCEPTED every malformed blob. NULL and the empty string keep the established
-- ABSENT convention.
-- STATEMENTS 2-7 are the six fenced terms, each gated on `json_type` (B1) so a
-- JSON boolean can no longer arrive as the integer 1.
-- ═══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_rounds_extras_terms_ins;
DROP TRIGGER IF EXISTS trg_rounds_extras_terms_upd;

CREATE TRIGGER trg_rounds_extras_terms_ins
BEFORE INSERT ON rounds
FOR EACH ROW
WHEN NEW.extras_json IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'ROUND_EXTRAS_JSON_INVALID: rounds.extras_json must be valid JSON. This write would store a blob that is not. Every writer in the platform builds it with JSON.stringify, so a malformed blob here means a raw SQL write or a client sending a fragment. A row whose blob is ALREADY invalid is untouched by this fence and stays editable — only a NEW invalid blob is refused.')
   WHERE NEW.extras_json IS NOT NULL
     AND CAST(NEW.extras_json AS TEXT) <> ''
     AND NOT json_valid(NEW.extras_json);
  SELECT RAISE(ABORT, 'ROUND_TERM_DISCOUNT_REFUSED: extras_json $.discount must be a number, PERCENT-AS-WRITTEN (percentages are stored as written, so 20 means 20%), at least 0 and less than 100. Non-numeric text, a JSON boolean, object or array, and an 8-digit date such as 20260707 are refused. Fix it on the round: Founder -> Rounds -> the round -> Edit terms -> Discount.')
    FROM (SELECT x, t, raw, v, jv, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp
            FROM (SELECT x, t, raw, v, jv, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant
                    FROM (SELECT x, t, raw, jv,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant
                            FROM (SELECT TRIM(CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS TEXT)) AS x,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS t,
                              CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS TEXT) AS raw,
                              /* WAVE 71b B5 - the EXTRACTED value, not its TEXT round-trip.
                                 SQLite renders a REAL as TEXT with 15 significant digits, so
                                 `x` (and therefore `v`) turns the JSON number
                                 99.99999999999999 into the text '100.0', and this fence
                                 REFUSED a value Decimal.js ACCEPTS - the one direction that is
                                 forbidden, because a database stricter than the application is
                                 an unexplained "Save failed". `jv` is used ONLY in the
                                 t IN ('integer','real') branch of the outer WHERE; the 'text'
                                 branch keeps B4's exact-decimal digit test unchanged.
                                 The UPDATE trigger needs no such column: it already carries
                                 the extracted value as `nv` for its change detection. */
                              json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS jv
                               WHERE json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') IS NOT NULL
                                 AND json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') <> 'null'
                                 AND (json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') NOT IN ('integer','real')
                                   OR (CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS REAL) < 0 OR CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS REAL) >= 100))))))
   WHERE t IS NOT NULL
     AND t <> 'null'
     AND (t NOT IN ('integer','real','text') OR x <> '')
     AND ( t IN ('true','false','object','array')
        OR (t = 'text' AND (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        ))
        OR ((t = 'text' AND ((msgn = '-' AND nzmant <> '') OR (epos = 0 AND length(ip) >= 3) OR (epos > 0 AND v >= 100))) OR (t IN ('integer','real') AND (jv < 0 OR jv >= 100))) );
  SELECT RAISE(ABORT, 'ROUND_TERM_INTEREST_RATE_REFUSED: extras_json $.interestRate must be a number, PERCENT-AS-WRITTEN (percentages are stored as written, so 6 means 6% a year), at least 0 and no more than 100. Non-numeric text, a JSON boolean, object or array, and an 8-digit date such as 20261231 are refused. Fix it on the round: Founder -> Rounds -> the round -> Edit terms -> Interest rate.')
    FROM (SELECT x, t, raw, v, jv, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp
            FROM (SELECT x, t, raw, v, jv, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant
                    FROM (SELECT x, t, raw, jv,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant
                            FROM (SELECT TRIM(CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS TEXT)) AS x,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS t,
                              CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS TEXT) AS raw,
                              /* WAVE 71b B5 - the EXTRACTED value, not its TEXT round-trip.
                                 SQLite renders a REAL as TEXT with 15 significant digits, so
                                 `x` (and therefore `v`) turns the JSON number
                                 99.99999999999999 into the text '100.0', and this fence
                                 REFUSED a value Decimal.js ACCEPTS - the one direction that is
                                 forbidden, because a database stricter than the application is
                                 an unexplained "Save failed". `jv` is used ONLY in the
                                 t IN ('integer','real') branch of the outer WHERE; the 'text'
                                 branch keeps B4's exact-decimal digit test unchanged.
                                 The UPDATE trigger needs no such column: it already carries
                                 the extracted value as `nv` for its change detection. */
                              json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS jv
                               WHERE json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') IS NOT NULL
                                 AND json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') <> 'null'
                                 AND (json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') NOT IN ('integer','real')
                                   OR (CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS REAL) < 0 OR 100 < CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS REAL)))))))
   WHERE t IS NOT NULL
     AND t <> 'null'
     AND (t NOT IN ('integer','real','text') OR x <> '')
     AND ( t IN ('true','false','object','array')
        OR (t = 'text' AND (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        ))
        OR ((t = 'text' AND ((msgn = '-' AND nzmant <> '') OR (epos = 0 AND (length(ip) > 3 OR (length(ip) = 3 AND (ip <> '100' OR fp <> '')))) OR (epos > 0 AND 100 < v))) OR (t IN ('integer','real') AND (jv < 0 OR 100 < jv))) );
  SELECT RAISE(ABORT, 'ROUND_TERM_VALUATION_CAP_REFUSED: extras_json $.valuationCap must be a number greater than 0 and no more than 1000000000000, in WHOLE CURRENCY UNITS (8000000 is an $8m cap). A JSON boolean, object or array is refused. An UNCAPPED instrument is recorded by leaving the cap EMPTY, never by 0. Fix it on the round: Founder -> Rounds -> the round -> Edit terms -> Valuation cap.')
    FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant
                            FROM (SELECT TRIM(CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') AS TEXT)) AS x,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') AS t,
                              CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') AS TEXT) AS raw
                               WHERE json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') IS NOT NULL
                                 AND json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') <> 'null'
                                 AND (json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') NOT IN ('integer','real')
                                   OR (CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') AS REAL) <= 0 OR CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') AS REAL) > 1000000000000))))))
   WHERE t IS NOT NULL
     AND t <> 'null'
     AND (t NOT IN ('integer','real','text') OR x <> '')
     AND ( t IN ('true','false','object','array')
        OR (t = 'text' AND (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        ))
        OR (v <= 0 OR v > 1000000000000) );
  SELECT RAISE(ABORT, 'ROUND_TERM_STRIKE_PRICE_REFUSED: extras_json $.strikePrice must be a number greater than 0 and no more than 1000000000, per share, in the round currency. A JSON boolean, object or array is refused. Leave it EMPTY when there is no strike; a zero strike is a free share, not a price. Fix it on the round: Founder -> Rounds -> the round -> Edit terms -> Strike price.')
    FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant
                            FROM (SELECT TRIM(CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') AS TEXT)) AS x,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') AS t,
                              CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') AS TEXT) AS raw
                               WHERE json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') IS NOT NULL
                                 AND json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') <> 'null'
                                 AND (json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') NOT IN ('integer','real')
                                   OR (CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') AS REAL) <= 0 OR CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') AS REAL) > 1000000000))))))
   WHERE t IS NOT NULL
     AND t <> 'null'
     AND (t NOT IN ('integer','real','text') OR x <> '')
     AND ( t IN ('true','false','object','array')
        OR (t = 'text' AND (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        ))
        OR (v <= 0 OR v > 1000000000) );
  SELECT RAISE(ABORT, 'ROUND_TERM_MATURITY_MONTHS_REFUSED: extras_json $.maturityMonths must be a number of MONTHS between 0 and 600 (50 years); 24 means two years. A JSON boolean, object or array is refused. An 8-digit value here is a date typed into a numeric field. Fix it on the round: Founder -> Rounds -> the round -> Edit terms -> Maturity (months).')
    FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant
                            FROM (SELECT TRIM(CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') AS TEXT)) AS x,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') AS t,
                              CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') AS TEXT) AS raw
                               WHERE json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') IS NOT NULL
                                 AND json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') <> 'null'
                                 AND (json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') NOT IN ('integer','real')
                                   OR (CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') AS REAL) < 0 OR CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') AS REAL) > 600))))))
   WHERE t IS NOT NULL
     AND t <> 'null'
     AND (t NOT IN ('integer','real','text') OR x <> '')
     AND ( t IN ('true','false','object','array')
        OR (t = 'text' AND (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        ))
        OR (v < 0 OR v > 600) );
  SELECT RAISE(ABORT, 'ROUND_TERM_EXPIRY_YEARS_REFUSED: extras_json $.expiryYears must be a number of YEARS between 0 and 50; 10 means ten years. A JSON boolean, object or array is refused. An 8-digit value here is a date typed into a numeric field. Fix it on the round: Founder -> Rounds -> the round -> Edit terms -> Expiry (years).')
    FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant
                            FROM (SELECT TRIM(CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') AS TEXT)) AS x,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') AS t,
                              CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') AS TEXT) AS raw
                               WHERE json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') IS NOT NULL
                                 AND json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') <> 'null'
                                 AND (json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') NOT IN ('integer','real')
                                   OR (CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') AS REAL) < 0 OR CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') AS REAL) > 50))))))
   WHERE t IS NOT NULL
     AND t <> 'null'
     AND (t NOT IN ('integer','real','text') OR x <> '')
     AND ( t IN ('true','false','object','array')
        OR (t = 'text' AND (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        ))
        OR (v < 0 OR v > 50) );
END;


-- THE R41-SAFE UPDATE TRIGGER. It fires only when `extras_json` itself changes,
-- and each field is then checked ONLY when that field's value or its json TYPE
-- actually CHANGES (`IS NOT`, never `<>`). A round carrying a pre-existing bad
-- term — including a pre-existing MALFORMED blob — stays fully editable, which
-- is what lets it be repaired; every NEW write of a fenced field, and every NEW
-- malformed blob, is still refused. Read the R41 section of the header before
-- touching this.

CREATE TRIGGER trg_rounds_extras_terms_upd
BEFORE UPDATE OF extras_json ON rounds
FOR EACH ROW
WHEN NEW.extras_json IS NOT OLD.extras_json
BEGIN
  SELECT RAISE(ABORT, 'ROUND_EXTRAS_JSON_INVALID: rounds.extras_json must be valid JSON. This write would store a blob that is not. Every writer in the platform builds it with JSON.stringify, so a malformed blob here means a raw SQL write or a client sending a fragment. A row whose blob is ALREADY invalid is untouched by this fence and stays editable — only a NEW invalid blob is refused.')
   WHERE NEW.extras_json IS NOT NULL
     AND CAST(NEW.extras_json AS TEXT) <> ''
     AND NOT json_valid(NEW.extras_json)
     AND NEW.extras_json IS NOT OLD.extras_json;
  SELECT RAISE(ABORT, 'ROUND_TERM_DISCOUNT_REFUSED: extras_json $.discount must be a number, PERCENT-AS-WRITTEN (percentages are stored as written, so 20 means 20%), at least 0 and less than 100. Non-numeric text, a JSON boolean, object or array, and an 8-digit date such as 20260707 are refused. Fix it on the round: Founder -> Rounds -> the round -> Edit terms -> Discount.')
    FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp, nv, ov, nt, ot
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant, nv, ov, nt, ot
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant, nv, ov, nt, ot
                            FROM (SELECT TRIM(CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS TEXT)) AS x,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS t,
                              CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS TEXT) AS raw,
                              json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS nv,
                              json_extract(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.discount') AS ov,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS nt,
                              json_type(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.discount') AS ot
                               WHERE json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') IS NOT NULL
                                 AND json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') <> 'null'
                                 AND (json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') NOT IN ('integer','real')
                                   OR (CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS REAL) < 0 OR CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') AS REAL) >= 100))
                                 AND (json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') IS NOT json_extract(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.discount')
                                   OR json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.discount') IS NOT json_type(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.discount'))))))
   WHERE t IS NOT NULL
     AND t <> 'null'
     AND (nv IS NOT ov OR nt IS NOT ot)
     AND (t NOT IN ('integer','real','text') OR x <> '')
     AND ( t IN ('true','false','object','array')
        OR (t = 'text' AND (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        ))
        OR ((t = 'text' AND ((msgn = '-' AND nzmant <> '') OR (epos = 0 AND length(ip) >= 3) OR (epos > 0 AND v >= 100))) OR (t IN ('integer','real') AND (nv < 0 OR nv >= 100))) );
  SELECT RAISE(ABORT, 'ROUND_TERM_INTEREST_RATE_REFUSED: extras_json $.interestRate must be a number, PERCENT-AS-WRITTEN (percentages are stored as written, so 6 means 6% a year), at least 0 and no more than 100. Non-numeric text, a JSON boolean, object or array, and an 8-digit date such as 20261231 are refused. Fix it on the round: Founder -> Rounds -> the round -> Edit terms -> Interest rate.')
    FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp, nv, ov, nt, ot
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant, nv, ov, nt, ot
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant, nv, ov, nt, ot
                            FROM (SELECT TRIM(CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS TEXT)) AS x,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS t,
                              CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS TEXT) AS raw,
                              json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS nv,
                              json_extract(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.interestRate') AS ov,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS nt,
                              json_type(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.interestRate') AS ot
                               WHERE json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') IS NOT NULL
                                 AND json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') <> 'null'
                                 AND (json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') NOT IN ('integer','real')
                                   OR (CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS REAL) < 0 OR 100 < CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') AS REAL)))
                                 AND (json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') IS NOT json_extract(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.interestRate')
                                   OR json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.interestRate') IS NOT json_type(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.interestRate'))))))
   WHERE t IS NOT NULL
     AND t <> 'null'
     AND (nv IS NOT ov OR nt IS NOT ot)
     AND (t NOT IN ('integer','real','text') OR x <> '')
     AND ( t IN ('true','false','object','array')
        OR (t = 'text' AND (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        ))
        OR ((t = 'text' AND ((msgn = '-' AND nzmant <> '') OR (epos = 0 AND (length(ip) > 3 OR (length(ip) = 3 AND (ip <> '100' OR fp <> '')))) OR (epos > 0 AND 100 < v))) OR (t IN ('integer','real') AND (nv < 0 OR 100 < nv))) );
  SELECT RAISE(ABORT, 'ROUND_TERM_VALUATION_CAP_REFUSED: extras_json $.valuationCap must be a number greater than 0 and no more than 1000000000000, in WHOLE CURRENCY UNITS (8000000 is an $8m cap). A JSON boolean, object or array is refused. An UNCAPPED instrument is recorded by leaving the cap EMPTY, never by 0. Fix it on the round: Founder -> Rounds -> the round -> Edit terms -> Valuation cap.')
    FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp, nv, ov, nt, ot
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant, nv, ov, nt, ot
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant, nv, ov, nt, ot
                            FROM (SELECT TRIM(CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') AS TEXT)) AS x,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') AS t,
                              CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') AS TEXT) AS raw,
                              json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') AS nv,
                              json_extract(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.valuationCap') AS ov,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') AS nt,
                              json_type(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.valuationCap') AS ot
                               WHERE json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') IS NOT NULL
                                 AND json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') <> 'null'
                                 AND (json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') NOT IN ('integer','real')
                                   OR (CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') AS REAL) <= 0 OR CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') AS REAL) > 1000000000000))
                                 AND (json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') IS NOT json_extract(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.valuationCap')
                                   OR json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.valuationCap') IS NOT json_type(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.valuationCap'))))))
   WHERE t IS NOT NULL
     AND t <> 'null'
     AND (nv IS NOT ov OR nt IS NOT ot)
     AND (t NOT IN ('integer','real','text') OR x <> '')
     AND ( t IN ('true','false','object','array')
        OR (t = 'text' AND (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        ))
        OR (v <= 0 OR v > 1000000000000) );
  SELECT RAISE(ABORT, 'ROUND_TERM_STRIKE_PRICE_REFUSED: extras_json $.strikePrice must be a number greater than 0 and no more than 1000000000, per share, in the round currency. A JSON boolean, object or array is refused. Leave it EMPTY when there is no strike; a zero strike is a free share, not a price. Fix it on the round: Founder -> Rounds -> the round -> Edit terms -> Strike price.')
    FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp, nv, ov, nt, ot
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant, nv, ov, nt, ot
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant, nv, ov, nt, ot
                            FROM (SELECT TRIM(CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') AS TEXT)) AS x,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') AS t,
                              CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') AS TEXT) AS raw,
                              json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') AS nv,
                              json_extract(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.strikePrice') AS ov,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') AS nt,
                              json_type(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.strikePrice') AS ot
                               WHERE json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') IS NOT NULL
                                 AND json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') <> 'null'
                                 AND (json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') NOT IN ('integer','real')
                                   OR (CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') AS REAL) <= 0 OR CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') AS REAL) > 1000000000))
                                 AND (json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') IS NOT json_extract(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.strikePrice')
                                   OR json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.strikePrice') IS NOT json_type(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.strikePrice'))))))
   WHERE t IS NOT NULL
     AND t <> 'null'
     AND (nv IS NOT ov OR nt IS NOT ot)
     AND (t NOT IN ('integer','real','text') OR x <> '')
     AND ( t IN ('true','false','object','array')
        OR (t = 'text' AND (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        ))
        OR (v <= 0 OR v > 1000000000) );
  SELECT RAISE(ABORT, 'ROUND_TERM_MATURITY_MONTHS_REFUSED: extras_json $.maturityMonths must be a number of MONTHS between 0 and 600 (50 years); 24 means two years. A JSON boolean, object or array is refused. An 8-digit value here is a date typed into a numeric field. Fix it on the round: Founder -> Rounds -> the round -> Edit terms -> Maturity (months).')
    FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp, nv, ov, nt, ot
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant, nv, ov, nt, ot
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant, nv, ov, nt, ot
                            FROM (SELECT TRIM(CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') AS TEXT)) AS x,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') AS t,
                              CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') AS TEXT) AS raw,
                              json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') AS nv,
                              json_extract(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.maturityMonths') AS ov,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') AS nt,
                              json_type(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.maturityMonths') AS ot
                               WHERE json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') IS NOT NULL
                                 AND json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') <> 'null'
                                 AND (json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') NOT IN ('integer','real')
                                   OR (CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') AS REAL) < 0 OR CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') AS REAL) > 600))
                                 AND (json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') IS NOT json_extract(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.maturityMonths')
                                   OR json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.maturityMonths') IS NOT json_type(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.maturityMonths'))))))
   WHERE t IS NOT NULL
     AND t <> 'null'
     AND (nv IS NOT ov OR nt IS NOT ot)
     AND (t NOT IN ('integer','real','text') OR x <> '')
     AND ( t IN ('true','false','object','array')
        OR (t = 'text' AND (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        ))
        OR (v < 0 OR v > 600) );
  SELECT RAISE(ABORT, 'ROUND_TERM_EXPIRY_YEARS_REFUSED: extras_json $.expiryYears must be a number of YEARS between 0 and 50; 10 means ten years. A JSON boolean, object or array is refused. An 8-digit value here is a date typed into a numeric field. Fix it on the round: Founder -> Rounds -> the round -> Edit terms -> Expiry (years).')
    FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp, nv, ov, nt, ot
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant, nv, ov, nt, ot
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant, nv, ov, nt, ot
                            FROM (SELECT TRIM(CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') AS TEXT)) AS x,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') AS t,
                              CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') AS TEXT) AS raw,
                              json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') AS nv,
                              json_extract(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.expiryYears') AS ov,
                              json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') AS nt,
                              json_type(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.expiryYears') AS ot
                               WHERE json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') IS NOT NULL
                                 AND json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') <> 'null'
                                 AND (json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') NOT IN ('integer','real')
                                   OR (CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') AS REAL) < 0 OR CAST(json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') AS REAL) > 50))
                                 AND (json_extract(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') IS NOT json_extract(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.expiryYears')
                                   OR json_type(iif(json_valid(NEW.extras_json), NEW.extras_json, '{}'), '$.expiryYears') IS NOT json_type(iif(json_valid(OLD.extras_json), OLD.extras_json, '{}'), '$.expiryYears'))))))
   WHERE t IS NOT NULL
     AND t <> 'null'
     AND (nv IS NOT ov OR nt IS NOT ot)
     AND (t NOT IN ('integer','real','text') OR x <> '')
     AND ( t IN ('true','false','object','array')
        OR (t = 'text' AND (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        ))
        OR (v < 0 OR v > 50) );
END;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3 — THE BEHAVIOURAL PROBE. Review 1's L1: "the self-verification checks
-- markers, not behaviour — those checks all pass despite H1-H4." So the SAME
-- generated predicate is now EXECUTED over a table of adversarial inputs with
-- expected verdicts. It is evaluated OUTSIDE a trigger, so a mismatch becomes a
-- postcondition failure that names itself instead of an un-catchable abort.
-- Both scratch tables are TEMP and are removed on the way out.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS temp.w68_probe;
CREATE TEMP TABLE w68_probe (raw_input TEXT NOT NULL, expect_refused INTEGER NOT NULL);
INSERT INTO w68_probe (raw_input, expect_refused) VALUES
       ('20', 0),
       ('0', 0),
       ('99.999', 0),
       ('0.0', 0),
       ('.0', 0),
       ('0.', 0),
       ('12.', 0),
       ('+5', 0),
       ('-0', 0),
       ('1e1', 0),
       ('1E1', 0),
       ('1e-3', 0),
       ('  20  ', 0),
       ('0.5', 0),
       ('99.999999999999999', 0),
       ('99.99999999999999', 0),
       ('100', 1),
       ('100.0', 1),
       ('100.000000000000000001', 1),
       ('-0.1', 1),
       ('-0.00000000000000000000000000000000000000001', 1),
       ('', 1),
       ('abc', 1),
       ('20abc', 1),
       ('2026-07-07', 1),
       ('20260707', 1),
       ('1.2.3', 1),
       ('--5', 1),
       ('1e', 1),
       ('20%', 1),
       ('20 dollars', 1),
       ('NaN', 1),
       ('1+2', 1),
       ('E5', 1),
       ('.', 1),
       ('+', 1),
       ('-', 1),
       ('.e3', 1),
       ('1e-', 1),
       ('1e+', 1),
       ('5-', 1),
       ('5+', 1),
       ('1e1.5', 1),
       ('+.', 1),
       ('0x10', 1),
       ('inf', 1),
       ('infinity', 1),
       ('1_000', 1),
       ('١٢', 1),
       ('１２', 1),
       ('9999999999999999999999999999999999999999', 1),
       ('00000000000000000000000000000000000000001', 0);

DROP TABLE IF EXISTS temp.w68_probe_result;
CREATE TEMP TABLE w68_probe_result AS
SELECT raw_input, expect_refused,
       CASE WHEN (
             (
             stray <> ''
          OR dots > 1
          OR negs > 1
          OR plusses > 1
          OR (negpos > 1 AND prevneg <> 'E')
          OR (pluspos > 1 AND prevplus <> 'E')
          OR ecnt > 1
          OR lastch = 'E'
          OR (epos = 0 AND alldig = 0)
          OR (epos > 0 AND alldig - expdig = 0)
          OR (epos > 0 AND expdig = 0)
          OR (epos > 0 AND edot > 0)
        )
          OR (msgn = '-' AND nzmant <> '')
          OR (epos = 0 AND length(ip) >= 3)
          OR (epos > 0 AND CAST(TRIM(CAST(raw_input AS TEXT)) AS REAL) >= 100)
        ) THEN 1 ELSE 0 END AS refused
  FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, msgn, nzmant,
                 ltrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, 1, instr(mabs,'.')-1)
                            ELSE mabs END, '0') AS ip,
                 rtrim(CASE WHEN instr(mabs,'.') > 0
                            THEN substr(mabs, instr(mabs,'.')+1)
                            ELSE '' END, '0') AS fp, raw_input, expect_refused
            FROM (SELECT x, t, raw, v, stray, dots, negs, plusses, ecnt, lastch, epos, negpos,
                 pluspos, prevneg, prevplus, alldig, expdig, edot, mant,
                 substr(mant, 1, 1) AS msgn,
                 CASE WHEN substr(mant,1,1) IN ('-','+')
                      THEN substr(mant, 2) ELSE mant END AS mabs,
                 replace(replace(replace(replace(mant,'0',''),'.',''),'+',''),'-','') AS nzmant, raw_input, expect_refused
                    FROM (SELECT x, t, raw,
                 CAST(x AS REAL) AS v,
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''),'.',''),'e',''),'E',''),'+',''),'-','') AS stray,
                 length(x) - length(replace(x,'.','')) AS dots,
                 length(x) - length(replace(x,'-','')) AS negs,
                 length(x) - length(replace(x,'+','')) AS plusses,
                 length(x) - length(replace(upper(x),'E','')) AS ecnt,
                 upper(substr(x, length(x), 1)) AS lastch,
                 instr(upper(x),'E') AS epos,
                 instr(x,'-') AS negpos,
                 instr(x,'+') AS pluspos,
                 upper(substr(x, instr(x,'-')-1, 1)) AS prevneg,
                 upper(substr(x, instr(x,'+')-1, 1)) AS prevplus,
                 (length(x) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(x,'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS alldig,
                 (length(substr(x, instr(upper(x),'E')+1)) - length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(substr(x, instr(upper(x),'E')+1),'0',''),'1',''),'2',''),'3',''),'4',''),'5',''),'6',''),'7',''),'8',''),'9',''))) AS expdig,
                 instr(substr(x, instr(upper(x),'E')+1), '.') AS edot,
                 CASE WHEN instr(upper(x),'E') > 0
                      THEN substr(x, 1, instr(upper(x),'E')-1) ELSE x END AS mant, raw_input, expect_refused
                            FROM (SELECT TRIM(CAST(raw_input AS TEXT)) AS x,
                              typeof(raw_input) AS t,
                              CAST(raw_input AS TEXT) AS raw,
                              raw_input, expect_refused
                                FROM w68_probe))));


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4 — SELF-VERIFICATION, the 0191 pattern. Each INSERT writes 1 when the
-- postcondition holds and 0 when it does not; `ok INTEGER CHECK (ok = 1)` then
-- aborts the statement, and the runner's transaction rolls the ENTIRE file back.
-- A fence that silently failed to attach is worse than a refusal, so this
-- refuses. The scratch tables are removed on success: no diagnostic table is
-- left behind.
-- ═══════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS temp.w68_postcondition;
CREATE TEMP TABLE w68_postcondition (check_name TEXT PRIMARY KEY NOT NULL, ok INTEGER NOT NULL CHECK (ok = 1));

INSERT INTO w68_postcondition (check_name, ok)
SELECT 'four_triggers_installed', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_captable_commits_discount_pct_ins','trg_captable_commits_discount_pct_upd','trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd')) = 4 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'exactly_two_discount_pct_triggers', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_captable_commits_discount_pct%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'exactly_two_triggers_name_extras_json', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND sql LIKE '%extras_json%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'discount_pct_text_test_present', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_captable_commits_discount_pct%' AND sql LIKE '%AS stray%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'discount_pct_percent_as_written_domain_kept', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_captable_commits_discount_pct%' AND sql LIKE '%AS REAL) >= 100%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'discount_pct_no_fraction_domain_string', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_captable_commits_discount_pct%' AND sql LIKE '%AS REAL) > 1%') = 0 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'extras_fences_discount', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%$.discount%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'extras_fences_interestRate', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%$.interestRate%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'extras_fences_valuationCap', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%$.valuationCap%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'extras_fences_strikePrice', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%$.strikePrice%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'extras_fences_maturityMonths', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%$.maturityMonths%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'extras_fences_expiryYears', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%$.expiryYears%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'extras_triggers_carry_numeric_text_test', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%AS stray%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'update_trigger_validates_changes_not_state', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='trg_rounds_extras_terms_upd' AND sql LIKE '%IS NOT ov%') = 1 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'no_optionPoolPostPercent_fence', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND sql LIKE '%optionPoolPostPercent%') = 0 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'b1_all_four_triggers_gate_on_json_or_typeof', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%json_type(%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'b1_boolean_types_named_in_every_extras_fence', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%IN (''true'',''false'',''object'',''array'')%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'b1_discount_pct_refuses_non_scalar_storage_class', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_captable_commits_discount_pct%' AND sql LIKE '%typeof(NEW.discount_pct)%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'b2_new_malformed_json_refused_by_name', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%ROUND_EXTRAS_JSON_INVALID%') = 2 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'b2_insert_trigger_no_longer_gated_on_json_valid', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='trg_rounds_extras_terms_ins' AND sql LIKE '%WHEN NEW.extras_json IS NOT NULL%json_valid(NEW.extras_json)%BEGIN%') = 0 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'w78_b3_no_dynamic_raise_tail_survives', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_captable_commits_discount_pct_ins','trg_captable_commits_discount_pct_upd','trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%Capavate received%') = 0 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'w78_no_concatenated_raise_argument', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_captable_commits_discount_pct_ins','trg_captable_commits_discount_pct_upd','trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND replace(replace(sql, char(10), ' '), char(13), ' ') LIKE '%RAISE(ABORT,%''%''%||%') = 0 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'w78_q25_no_internal_ruling_identifier_in_refusal_text', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_captable_commits_discount_pct_ins','trg_captable_commits_discount_pct_upd','trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%owner ruling%') = 0 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'w78_q25_percent_as_written_rule_still_stated', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND sql LIKE '%PERCENT-AS-WRITTEN (percentages are stored as written, so 20 means 20%%)%') = 4 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'b4_exact_decimal_comparison_present_in_all_four', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_captable_commits_discount_pct_ins','trg_captable_commits_discount_pct_upd','trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%AS ip%') = 4 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'd8_dead_empty_string_predicate_removed', CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_captable_commits_discount_pct_ins','trg_captable_commits_discount_pct_upd','trg_rounds_extras_terms_ins','trg_rounds_extras_terms_upd') AND sql LIKE '%x = ''''%') = 0 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'behavioural_probe_no_mismatch', CASE WHEN (SELECT COUNT(*) FROM w68_probe_result WHERE refused <> expect_refused) = 0 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'behavioural_probe_ran_every_case', CASE WHEN (SELECT COUNT(*) FROM w68_probe_result) = 52 THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'rounds_rows_untouched', CASE WHEN (SELECT COUNT(*) FROM rounds) = CAST((SELECT v FROM w68_before WHERE k='rounds_rows') AS INTEGER) THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'captable_commits_rows_untouched', CASE WHEN (SELECT COUNT(*) FROM captable_commits) = CAST((SELECT v FROM w68_before WHERE k='captable_commits_rows') AS INTEGER) THEN 1 ELSE 0 END;
INSERT INTO w68_postcondition (check_name, ok)
SELECT 'discount_pct_values_byte_identical', CASE WHEN COALESCE((SELECT group_concat(d, '|') FROM (SELECT id || '=' || COALESCE(discount_pct, char(30)) AS d FROM captable_commits ORDER BY id)), '') = (SELECT v FROM w68_before WHERE k='discount_pct_digest') THEN 1 ELSE 0 END;


DROP TABLE w68_postcondition;
DROP TABLE w68_probe_result;
DROP TABLE w68_probe;
DROP TABLE w68_before;
