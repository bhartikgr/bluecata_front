#!/usr/bin/env bash
# scripts/sacred_check.sh — G-2
#
# Sacred-file byte check. MUST run before every code change in every later
# wave (`npm run sacred`). Exit 0 = every sacred file is byte-identical to its
# frozen hash. Exit 1 = at least one sacred file drifted, is missing, or the
# manifest is not exactly 47 entries.
#
# THE MANIFEST IS 47 ENTRIES:
#
#   40  the pre-existing base manifest, read verbatim from
#       sacred_baseline/SACRED_SHA256.txt (that file is NOT modified by this
#       item; it is an input). Two of the 40 rows are overridden by the
#       KNOWN_DRIFT freeze below — see WAIVER-1.
#    7  governance artefacts added by G-2, declared inline in this script
#       (see ADDED_47 below and the assumption note beneath it).
#
# KNOWN_DRIFT FREEZE (WAIVER-1, owner ruling 2026-08-09, spec/OWNER_RULINGS_2026_08_09.md,
# item G-4 / DEF-081): LearnSection.jsx and PricingSection.jsx have drifted from
# their recorded 2026-07 hashes. The owner ruled: ADOPT THE CURRENT BYTES AS
# FROZEN. The old hashes are recorded here permanently so the drift is on the
# record rather than erased, and the base manifest file itself stays untouched.
# From now on these two files are checked against the NEW frozen hash: any
# further change to them fails, exactly like every other sacred file.
#
# WAIVER-2 (owner ruling 2026-08-11, CP-MSG-05 — Wave 19). Reason:
# **attacker-controlled `x-forwarded-for` used as the rate-limit key.** Both key
# builders in server/lib/rateLimit.ts read that request header directly and
# preferred it over the socket peer, with no `trust proxy` configuration
# anywhere in server/, so rotating the header minted a fresh bucket per request
# and the limiter did not limit — measured at 63 consecutive 200s against a
# 60/min bucket. The same defect keyed `authLoginRateLimit` and
# `authSignupRateLimit`, i.e. the credential-spray throttles. The owner granted
# an edit waiver for THIS ONE FILE. Approved by: Ozan Isinak (owner), 2026-08-11.
# Fix: one central `resolveRateLimitClientIp`, fail-closed — the header is
# ignored entirely unless `TRUSTED_PROXY_HOPS` is explicitly configured. No
# limit was changed. Proof: server/__tests__/wave19_waiver2_ratelimit_key.test.ts.
# The old hash stays on the record below; the new bytes are now frozen, so any
# further unwaived edit fails exactly as before. NO OTHER SACRED ENTRY MOVED.
#
# WAIVER-3 (owner ruling 2026-08-11, DELEGATED AUTHORITY — Wave 23 ITEM 1).
# Covers server/db/migrate.ts. Reason: **isNonFatalIndexError let a real schema
# failure exit 0 and be recorded as applied.** The predicate classified EVERY
# missing-table/missing-column error from `CREATE INDEX` *or*
# `CREATE UNIQUE INDEX` as a performance-only warning, and `applyOne()` then
# inserted the filename into `__drizzle_migrations_applied`, so the failure was
# both SILENT and UNRETRYABLE. Two consequences: a uniqueness CONSTRAINT could
# be absent while the installer reported success, and no later run could ever
# repair it. Reproduced by FINAL REVIEW A against the real runner
# (finalA/repro_migrate_exit0.ts: index absent, SHELL_EXIT=0, file recorded).
# Fix, minimal and in place — the runner is NOT restructured:
#   • a failing CREATE UNIQUE INDEX is now FATAL (and is no longer swallowed by
#     the `UNIQUE constraint failed` idempotency clause, which exists for
#     backfill INSERT OR IGNORE races, not for duplicate-blocked indexes);
#   • a failing plain CREATE INDEX still warns, but the migration is NOT
#     recorded, so the next run retries it (`RunResult.deferred`).
# No limit, no ordering and no idempotency rule changed. Proof:
# scripts/wave23/item1_migrate_index_harness.ts (30 asserts, 6 poles) and
# scripts/wave23/item1_mutations.py (8/8 mutations caught).
#
# ENFORCEMENT NOTE, recorded rather than glossed: server/db/migrate.ts is NOT
# one of the 40 paths in sacred_baseline/SACRED_SHA256.txt, so a KNOWN_DRIFT row
# alone would have been a decorative entry that checked nothing. It is therefore
# verified as an EXTRA frozen-hash check outside the 47-entry manifest (see
# EXTRA_FROZEN below): the count stays 47/47, and the file is genuinely fenced.
#
# WAVE 38 · ROW 6 — THE FIFTH FIELD: RATIFICATION STATE.
# A KNOWN_DRIFT row records that an edit to a sacred file is FROZEN. It did not
# record whether a human ever agreed to it. WAIVER-5 (client/src/pages/founder/
# Billing.tsx) was taken under DELEGATED authority and is still PENDING OWNER
# RATIFICATION — and an operator reading `SACRED OK: 47/47` had no way to learn
# that, because the summary line reported only how many rows were frozen. A
# green line that conceals an unratified edit to a sacred file is exactly the
# class of "check that passed while checking nothing" this codebase keeps
# paying for.
# Every row now carries field 5, one of:
#     RATIFIED                      — an owner signed this waiver off
#     PENDING-OWNER-RATIFICATION    — taken under delegated authority, unsigned
# The summary line, the --list output, the --json output and the FAILURE output
# all DERIVE the pending set from the array, so it cannot fall behind the way
# the hand-written legend did (W31-A3). A row with a missing or unrecognised
# field 5 aborts the run (exit 3) rather than being silently read as ratified:
# unknown provenance is never reported as approval.
#
# Flags:
#   --list        print the resolved 47-entry manifest and exit 0
#   --json        machine-readable result
#   --quiet       only print on failure
#
# Env:
#   SPEC_ROOT     where `spec/...` entries resolve (default: <repo>/../spec)

set -uo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SPEC_ROOT="${SPEC_ROOT:-$(cd "$REPO_ROOT/.." 2>/dev/null && pwd)/spec}"
BASE_MANIFEST="$REPO_ROOT/sacred_baseline/SACRED_SHA256.txt"

EXPECTED_ENTRIES=47
BASE_EXPECTED=40
ADDED_EXPECTED=7

LIST_ONLY=0; JSON=0; QUIET=0
for a in "$@"; do
  case "$a" in
    --list)  LIST_ONLY=1 ;;
    --json)  JSON=1 ;;
    --quiet) QUIET=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# KNOWN_DRIFT freeze. Format: <path>|<old_hash>|<frozen_new_hash>|<waiver-id>
# The old hash is retained as evidence; the frozen hash is what is enforced.
#
# W31-A3 — THE FOURTH FIELD IS NEW, AND IT IS WHY THIS FILE STOPPED LYING.
# This array had FIVE entries while three separate places reported the legend as
# a HAND-WRITTEN string reading "WAIVER-1 x2, WAIVER-2 x1, WAIVER-3 x1" — five
# counted, four named. `server/lib/capTableMembership.ts` under WAIVER-4 was
# enforced but INVISIBLE in every summary line the operator actually reads,
# including the one the deploy gate prints. WAIVER-4 is not a cosmetic entry: it
# covers a live privacy exposure between passive LPs in a shared SPV.
#
# The old shape could not have been fixed by editing those strings, because
# nothing tied them to the array — the next waiver would desynchronise them
# again, exactly as WAIVER-4 did. Each row now CARRIES its own waiver id and the
# legend is DERIVED by `waiver_legend()`, so the count and the names come from
# one source. A structural assertion below refuses to run if they disagree.
# ---------------------------------------------------------------------------
KNOWN_DRIFT=(
"client/src/components/home3compo/LearnSection.jsx|13ed3d64d16694aac64c3de6732b15ad58426fba301b7cfa37bf192b9e03b3bf|63ff0c9fd78e8bc749661c28f7bb5825f648ab7db0efd39cb90d48fa8eb9dc33|WAIVER-1|RATIFIED"
"client/src/components/home3compo/PricingSection.jsx|2184064be1f0336e4d0c94ecdb26753dd275614bea5c9a7e29a979c8a800b865|e8da7f99a1eba63b3ad2099a9cbe5dba9ec3f10ce00d68f7efe4399c10fa8b6a|WAIVER-1|RATIFIED"
# WAIVER-4 — owner-signed 2026-08-11 ("Signatures confirmed"), X-C1 / P1-8.
#   A LIVE PRIVACY EXPOSURE, not a theoretical one (ENGINE_REGISTRY's own words).
#   SPVs are stored as companies in the sacred captable_commits ledger by design
#   (ENGINE_REGISTRY C-1). `areCoMembersOnAnyCapTable()` derived co-membership from
#   company_id equality alone, so two PASSIVE LPs who merely subscribed to the same
#   vehicle resolved as counterparties — and SIX live callers (messagingPolicy,
#   networkPostAudience, commsStore x2, collectiveWaveAStore, routes.ts) treat that
#   as authorisation to reveal them to each other. Co-investors in a syndicate
#   frequently must not learn of one another at all.
#   The policy this gate implements (its own header, Ozan 2026-06-25) is about KNOWN
#   COUNTERPARTIES collaborating to help portfolio companies. Two LPs in one SPV are
#   not that.
#   FIX: one AND-clause, `notSpvBackedSql("ca")`, shared with the list-form second
#   path in commsUserDirectory.ts (fixed in Wave 25) so the two cannot drift.
#   SPV-hood is asked of the DB, never inferred from an id prefix, so a new SPV is
#   excluded on insert with no code change. Fails in the DENYING direction.
#   The write site could NOT be the fix: captable_commits is append-only and
#   hash-chained; rewriting rows breaks verifyChain() irreversibly.
#   PROOF, both poles (server/__tests__/xc1_spv_comembership_privacy.test.ts, 7/7):
#     - two LPs in the same SPV are NOT co-members
#     - two investors in a REAL company ARE still co-members (no over-correction —
#       an over-broad fix would silently kill messaging for six callers)
#     - WITHOUT the guard the two LPs DO resolve as co-members (the defect was real)
#     - a company newly registered as an SPV is excluded with no code change
#     - a genuine shared company still authorises even when both also share an SPV
#   HASH LINEAGE (nothing erased):
#     original  35d313025ca6651562dbb96e3928c0c976ca610238f05d3a8f7fe50f442b2718
"server/lib/capTableMembership.ts|35d313025ca6651562dbb96e3928c0c976ca610238f05d3a8f7fe50f442b2718|688b555426544527534afa12ce54e34069480db989c74c85d7d9020b9a45d750|WAIVER-4|RATIFIED"
# WAIVER-2 — owner-granted 2026-08-11, CP-MSG-05. See the header block above.
# WAVE 21 RE-FREEZE (2026-08-11). WAIVER-2 covers server/lib/rateLimit.ts and
# remains in force; Wave 21 made two further edits UNDER THE SAME WAIVER:
#   ITEM 1 — `trustedProxyHopCount()` clamped an out-of-range TRUSTED_PROXY_HOPS
#            down to 8 instead of failing closed, so `TRUSTED_PROXY_HOPS=9999`
#            plus a crafted chain let the attacker choose the key. A
#            misconfiguration must never widen trust; it now falls back to the
#            socket peer and logs loudly.
#   ITEM 4 — the five process-local Maps (buckets, failures, lockouts,
#            authBuckets, collectiveBuckets) were replaced by durable rows
#            (migration 0173), so quotas and the 5-strike auth lockout survive a
#            restart. No limit value changed.
# HASH LINEAGE (nothing erased):
#   original   50abd000…60124  (pre-WAIVER-2 bytes)
#   Wave 19    cda4a32e…3951e8  (WAIVER-2 fix; superseded by this re-freeze)
#   Wave 21    c76574f9facd9ac02b7ce80de3c4300b54ede06d0761c7272c4c927165ffd507  (superseded by the Wave 23 re-freeze)
# WAVE 23 RE-FREEZE (2026-08-11). WAIVER-2 remains in force; Wave 23 made ONE
# further edit UNDER THE SAME WAIVER:
#   ITEM 2 — FINAL REVIEW A filed as CRITICAL that TRUSTED_PROXY_HOPS=1 or 8
#            lets a crafted `x-forwarded-for` choose the bucket key. On
#            inspection that is true if and only if a caller can open a socket
#            to this process directly — the standard, and until now UNENFORCED,
#            assumption behind every proxy-aware limiter including Express
#            `trust proxy`. The hop ALGORITHM is correct and was NOT changed.
#            What changed is that the assumption is now an enforced check: when
#            hops > 0 the header is honoured only if the DIRECT SOCKET PEER is
#            itself a trusted proxy (default: loopback + RFC1918 + IPv6
#            loopback/ULA/link-local; overridable by TRUSTED_PROXY_PEERS or the
#            programmatic `_setTrustedProxyPeerOverride` hook for DB-driven
#            config). An untrusted peer has its header ignored ENTIRELY and is
#            keyed on its socket address. Fails closed on an unknown peer, on a
#            malformed allow-list entry, and on an explicitly empty allow-list.
#            No limit value changed; exactly one executable read of the header
#            still exists in the file.
# HASH LINEAGE (nothing erased):
#   original   50abd000…60124  (pre-WAIVER-2 bytes)
#   Wave 19    cda4a32e…3951e8  (WAIVER-2 fix)
#   Wave 21    c76574f9…ffd507  (hops fail-closed + durable buckets)
#   Wave 23    0c2f117299ea503b31356da2f9267f8bd9577345c7d718ad646ebf74b92bccfc  (ENFORCED)
# Proof: scripts/wave21/item1_proxy_hops_harness.ts (21 asserts, 7/7 mutations),
# scripts/wave21/item4_durable_ratelimit_harness.ts (67 asserts, 16/16
# mutations), and scripts/wave23/item2_trusted_peer_harness.ts (69 asserts, both
# poles) with scripts/wave23/item2_mutations.py (10/10 mutations caught). Any
# further unwaived edit fails exactly as before.
"server/lib/rateLimit.ts|50abd00004a5f09722a5a75bf4152ee0fa2ab37f6706450601d8f444d8460124|0c2f117299ea503b31356da2f9267f8bd9577345c7d718ad646ebf74b92bccfc|WAIVER-2|RATIFIED"
# WAIVER-3 — owner-granted 2026-08-11 (delegated). See the header block above.
# Reason: isNonFatalIndexError let a real schema failure exit 0 and be recorded
# as applied.
# HASH LINEAGE (nothing erased):
#   pre-WAIVER-3  f48b530c17d23bcccc00d768e874975ad7cbfab63b8a23cf4b3889719d557883  (bytes reviewed by FINAL REVIEW A; verified against finalA/install, finalB/snaprepo and reviewA/work_copy — all three agree)
#   Wave 23       5790f11d1182be1c5af8b59a52a4314dd3e1ad5f9a6d0049986bc42d1ee1a44c  (ENFORCED)
"server/db/migrate.ts|f48b530c17d23bcccc00d768e874975ad7cbfab63b8a23cf4b3889719d557883|5790f11d1182be1c5af8b59a52a4314dd3e1ad5f9a6d0049986bc42d1ee1a44c|WAIVER-3|RATIFIED"
# WAIVER-5 — WAVE 34 TASK 1, DELEGATED AUTHORITY, **PENDING OWNER RATIFICATION**.
#   Covers client/src/pages/founder/Billing.tsx. Recorded here rather than
#   glossed: this edit was DIRECTED BY NAME AND BY LINE NUMBER in the Wave 34
#   brief ("client/src/pages/founder/Billing.tsx:77, :79 ... These are INVOICING
#   and BILLING — money rendered directly to a paying customer"), and the same
#   brief's read-never-edit list does NOT name this file. The collision with the
#   frozen manifest is therefore an oversight in the brief, not a licence, and
#   it is flagged for the owner in build_log/WAVE34_REPORT.md rather than
#   settled by a subagent. If the owner declines, restore the pre-wave bytes
#   (hash below) and delete this row; nothing else in the wave depends on it.
#   REASON THE EDIT WAS MADE: `fmtMoney()` rendered every invoice figure with
#   `(minor / 100).toFixed(2)` — a hardcoded ISO-4217 exponent of 2. JPY and KRW
#   are exponent 0, so a ¥1,200,000 invoice displayed as "¥12,000.00" on the
#   founder's own billing page: understated by a factor of 100, on the screen a
#   paying customer uses to check what they were charged.
#   FIX: delegate to the shared helper — `formatMinor(minor, currency)` from
#   client/src/lib/currency.ts, which reads the exponent from the ISO override
#   table. USD output is byte-identical; only non-exponent-2 currencies change.
#   PROOF, both poles (client/src/pages/founder/__tests__/wave34_billing_money_exponent.test.tsx, 9/9):
#     - a JPY invoice renders ¥1,200,000 as 1,200,000 and NOT as 12,000
#     - a USD invoice still renders 120000 minor as $1,200.00 (no over-correction)
#     - the shipped source no longer contains a literal `/ 100`
#   HASH LINEAGE (nothing erased):
#     pre-WAVE-34  813de79077e1e0f73ee6572091826cb6e2bec7aa520dee31df588640cf66d692
#     Wave 34      ddbc591cc49b8b95ac9bfea90062486bc13e2eed134687235506e5e06d57ce5f  (ENFORCED)
"client/src/pages/founder/Billing.tsx|813de79077e1e0f73ee6572091826cb6e2bec7aa520dee31df588640cf66d692|ddbc591cc49b8b95ac9bfea90062486bc13e2eed134687235506e5e06d57ce5f|WAIVER-5|PENDING-OWNER-RATIFICATION"
)

# ---------------------------------------------------------------------------
# The 7 entries G-2 adds to reach 47. Per CONSORTIUM_PARTNER_BUILD_v7.md §9.4.7
# they are: the G-0 snapshot manifest, the four vN tooling scripts, the
# exclusion-class registry, and the coverage gap baseline.
#
# ASSUMPTION (recorded in build_log/WAVE0_REPORT.md): §9.4.7 names the *v7*
# tooling scripts. This build is v8, so the four tooling scripts are resolved to
# their v8 successors — coverage, critical-path, citation-check and reuse-proof.
# The exclusion-class registry and the coverage gap baseline have no v8
# successor in spec/, so the v7 files remain the artefacts of record.
# `spec/...` paths resolve under $SPEC_ROOT, everything else under $REPO_ROOT.
# ---------------------------------------------------------------------------
ADDED_47=(
"cf80bef62f6f6ef8eef8ce39cde49b6bbdcc12a532b087198faf6dc9538607b0|.g0-snapshot/G0_MANIFEST.sha256"
"21711b0ba55bb289a075510672bfedbfc6708d4f42fcf90f17c984cc960284eb|spec/_v8_coverage.py"
"4a7aa59ebc75ebc1e537a4ff4304aaca291b14a98be09c5c3f94d5b9fbd1ebeb|spec/_v8_critical_path.py"
"d7e48be06983fc376fd1c161961e1301007d7471c976436da7ef0c16eadf9755|spec/_v8_citecheck.py"
"7a334701f46cb4aad4b55fa6e4771f47394b8b34d91d1527d77876abfa6bf3b3|spec/_v8_reuse_proof.sh"
"623a009e1200befc7b92f2bd5dda17412ff2e09408e3ffa86f6f70f7ec17fbfe|spec/_v7_exclusion_classes.tsv"
"20b4c93ea83a73f3033a1fc46b01ff03f90b860b542561d71a043849fe622399|spec/_v7_coverage_gap_baseline.txt"
)

# W31-A3 — THE ENFORCED HASH IS NOW READ BY POSITION, NOT AS "THE LAST FIELD".
# This read `${e##*|}`, i.e. everything after the final `|`. With a waiver id
# appended that would have returned the string "WAIVER-4" AS THE EXPECTED SHA256
# — no file would ever match it, and the failure would look like universal drift
# rather than a parser bug. Field 3 is addressed explicitly so the row can carry
# extra columns without the enforcement silently changing meaning.
drift_new_hash() {
  local p="$1" e
  for e in "${KNOWN_DRIFT[@]}"; do
    [ "${e%%|*}" = "$p" ] && { printf '%s' "$e" | cut -d'|' -f3; return 0; }
  done
  return 1
}
# The waiver id governing a KNOWN_DRIFT path, or empty if it is not frozen.
drift_waiver() {
  local p="$1" e w
  for e in "${KNOWN_DRIFT[@]}"; do
    if [ "${e%%|*}" = "$p" ]; then w="$(printf '%s' "$e" | cut -d'|' -f4)"; echo "$w"; return 0; fi
  done
  return 1
}

# WAVE 38 · ROW 6 — ratification state of a KNOWN_DRIFT row, by position.
drift_ratification() {
  local p="$1" e r
  for e in "${KNOWN_DRIFT[@]}"; do
    if [ "${e%%|*}" = "$p" ]; then r="$(printf '%s' "$e" | cut -d'|' -f5)"; echo "$r"; return 0; fi
  done
  return 1
}

# WAVE 38 · ROW 6 — the DERIVED set of waivers that no owner has ratified.
# Emits e.g. `WAIVER-5 (client/src/pages/founder/Billing.tsx)`, empty if none.
# Aborts on a row whose field 5 is absent or unrecognised: an unreadable
# provenance must never be reported as approval.
unratified_waivers() {
  local e p w r out=""
  for e in "${KNOWN_DRIFT[@]}"; do
    p="$(printf '%s' "$e" | cut -d'|' -f1)"
    w="$(printf '%s' "$e" | cut -d'|' -f4)"
    r="$(printf '%s' "$e" | cut -d'|' -f5)"
    case "$r" in
      RATIFIED) ;;
      PENDING-OWNER-RATIFICATION) out="${out:+$out, }$w ($p)" ;;
      *) echo "BUG: KNOWN_DRIFT row for $p has no recognised ratification state (field 5 = '"'"'$r'"'"')" >&2; exit 3 ;;
    esac
  done
  echo "$out"
}

unratified_count() {
  local e r n=0
  for e in "${KNOWN_DRIFT[@]}"; do
    r="$(printf '%s' "$e" | cut -d'|' -f5)"
    [ "$r" = "PENDING-OWNER-RATIFICATION" ] && n=$((n+1))
  done
  echo "$n"
}

# W31-A3 — the legend is DERIVED from the array, never hand-written.
# Emits e.g. `WAIVER-1 x2, WAIVER-2 x1, WAIVER-3 x1, WAIVER-4 x1`. Because the
# tally is built by walking the same array the count `${#KNOWN_DRIFT[@]}` comes
# from, the two cannot disagree — which is the entire defect this item fixes.
waiver_legend() {
  local e w seen tag n out="" total=0 ordered
  seen=""
  # Sort the distinct waiver ids so the legend reads WAIVER-1..4 regardless of
  # the order rows happen to sit in the array (they are grouped by file).
  ordered="$(for e in "${KNOWN_DRIFT[@]}"; do printf '%s\n' "$e" | cut -d'|' -f4; done | sort -u)"
  for w in $ordered; do
    [ -z "$w" ] && w="UNTAGGED"
    n=0
    for tag in "${KNOWN_DRIFT[@]}"; do
      [ "$(printf '%s' "$tag" | cut -d'|' -f4)" = "$w" ] && n=$((n+1))
    done
    total=$((total+n))
    out="${out:+$out, }$w x$n"
  done
  # STRUCTURAL ASSERTION. If a row is malformed or a waiver id goes missing, the
  # legend would under-count exactly as the old hand-written string did. Refuse
  # to report rather than report a number that is not the number enforced.
  if [ "$total" != "${#KNOWN_DRIFT[@]}" ]; then
    echo "BUG: waiver legend totals $total but KNOWN_DRIFT holds ${#KNOWN_DRIFT[@]}" >&2
    exit 3
  fi
  echo "$out"
}
drift_old_hash() {
  local p="$1" e mid
  for e in "${KNOWN_DRIFT[@]}"; do
    if [ "${e%%|*}" = "$p" ]; then mid="${e#*|}"; echo "${mid%%|*}"; return 0; fi
  done
  return 1
}
resolve_path() {
  case "$1" in
    spec/*) echo "$SPEC_ROOT/${1#spec/}" ;;
    *)      echo "$REPO_ROOT/$1" ;;
  esac
}

# ---------------------------------------------------------------------------
# WAVE 38 · ROW 6 — STRUCTURAL VALIDATION, RUN IN THE MAIN SHELL.
#
# Found by falsification, and worth the comment: `unratified_waivers()` and
# `waiver_legend()` both abort with `exit 3` on a malformed row — but every
# caller invokes them inside `$( … )`, and `exit` in a command substitution
# kills only the SUBSHELL. With field 5 deleted from the WAIVER-5 row the script
# printed its BUG line to stderr and then reported
# `SACRED OK: 47/47 … all 6 waivers OWNER-RATIFIED` and exited 0: a green gate
# built on a row it had just declared unreadable. The guards inside those
# functions are left in place as belt-and-braces, but the authoritative check is
# HERE, at the top level, where a failure can actually stop the run.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# WAVE 39 · CLOSURE OF WAVE 38 ROW 6's DISCLOSED RESIDUAL TOLERANCE.
#
# Wave 38 Row 6 moved the structural check to the top level so it could stop the
# run. It validated field CONTENT (field 4 looks like a waiver id, field 5 is a
# recognised ratification state) but never validated the row's SHAPE. Reviews 4A
# (finding N2) and 4B (P1) independently planted the same mutant and proved the
# gate fails open:
#
#   M1  a 6th field appended to an existing row  -> gate exit 0 (suite caught it,
#       but only by an arithmetic accident: the Tier-1 regex drops the malformed
#       row, taking the parsed count from 6 to 5 and tripping a `>= 6` FLOOR.
#       That is a COUNT, not an identity — the exact failure mode Wave 38's own
#       Row 3 documented when it found pins re-pinned to numbers.)
#   M2  the same malformation on a SEVENTH waiver -> gate exit 0 AND 33/33 green.
#       Invisible to all three Tier-1 enforcement points, and reported to the
#       operator as a healthy `WAIVER-6 x1`. Latent today; live the moment
#       another waiver is granted.
#
# The validator below therefore checks SHAPE FIRST and checks it on EVERY row,
# not on a fixed set of known rows, so a newly added seventh waiver is validated
# on exactly the same terms as the first:
#
#   field count  exactly 5 pipe-separated fields (the shape all three Tier-1
#                parsers declare; server/__tests__/wave18_cpmsg05_rate_limit_identity.test.ts
#                asserts `.toBe(5)` on the same row)
#   field 1      a repository-relative path: no leading '/', no '..' segment,
#                no whitespace, drawn from a conservative charset
#   field 2      the pre-waiver hash — lowercase hex, exactly 64 chars
#   field 3      the frozen hash      — lowercase hex, exactly 64 chars
#   field 4      a waiver id from a CLOSED VOCABULARY (see the contiguity check
#                after the loop): WAIVER-<n>, n a positive integer, no leading
#                zero, and the set of distinct ids must be exactly 1..N
#   field 5      a ratification state from the CLOSED VOCABULARY
#                { RATIFIED, PENDING-OWNER-RATIFICATION }
#
# Plus two identity checks the old code could not make: no path may appear
# twice (drift_old_hash/drift_new_hash resolve first-match-wins, so a duplicate
# path silently disables the second row), and the waiver-id vocabulary must be
# contiguous from 1 (so `WAIVER-16` typed for `WAIVER-6` is rejected rather than
# silently accepted as a new waiver).
#
# THIS RUNS IN THE GATE, not only in the tests. The gate is what runs on the
# server; a fence that lives only in the suite is not on the deployment path
# (`npm run preflight` and pre_deploy_gate_v26_7_2.sh call this script and do
# NOT call wave18_cpmsg05).
# ---------------------------------------------------------------------------
STRUCT_BAD=0
KD_ROW_NO=0
KD_SEEN_PATHS=""
KD_WAIVER_IDS=""
for e in "${KNOWN_DRIFT[@]}"; do
  KD_ROW_NO=$((KD_ROW_NO+1))

  # --- SHAPE: exactly 5 pipe-separated fields. Counted with awk NF so that a
  #     6th field cannot be silently discarded by `cut -f5`, and a 4-field row
  #     cannot present an empty field 5 as if it were merely unreadable.
  kn="$(printf '%s' "$e" | awk -F'|' '{print NF}')"
  if [ "$kn" != "5" ]; then
    echo "FAIL: KNOWN_DRIFT row $KD_ROW_NO has $kn pipe-separated fields, expected EXACTLY 5." >&2
    echo "      row: $e" >&2
    echo "      Shape is path|old-sha256|frozen-sha256|WAIVER-n|RATIFICATION-STATE." >&2
    echo "      A row of any other width is not a waiver this gate can enforce; it is refused." >&2
    STRUCT_BAD=1
    continue
  fi

  IFS='|' read -r kp kold knew kw kr <<<"$e"

  # --- field 1: a repository-relative path.
  case "$kp" in
    "")   echo "FAIL: KNOWN_DRIFT row $KD_ROW_NO has an EMPTY path in field 1." >&2; STRUCT_BAD=1 ;;
    /*)   echo "FAIL: KNOWN_DRIFT row $KD_ROW_NO path '$kp' is absolute; rows must be repo-relative." >&2; STRUCT_BAD=1 ;;
    *..*) echo "FAIL: KNOWN_DRIFT row $KD_ROW_NO path '$kp' contains a '..' segment." >&2; STRUCT_BAD=1 ;;
    *)
      if ! printf '%s' "$kp" | grep -Eq '^[A-Za-z0-9._/-]+$'; then
        echo "FAIL: KNOWN_DRIFT row $KD_ROW_NO path '$kp' contains characters outside [A-Za-z0-9._/-]." >&2
        STRUCT_BAD=1
      fi
      ;;
  esac

  # --- fields 2 and 3: two lowercase hex sha256 digests.
  if ! printf '%s' "$kold" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "FAIL: KNOWN_DRIFT row for '$kp' field 2 (pre-waiver hash) is not a lowercase 64-char sha256 (got '$kold')." >&2
    STRUCT_BAD=1
  fi
  if ! printf '%s' "$knew" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "FAIL: KNOWN_DRIFT row for '$kp' field 3 (frozen hash) is not a lowercase 64-char sha256 (got '$knew')." >&2
    STRUCT_BAD=1
  fi

  # --- field 4: waiver id, canonical grammar.
  if printf '%s' "$kw" | grep -Eq '^WAIVER-[1-9][0-9]*$'; then
    KD_WAIVER_IDS="$KD_WAIVER_IDS ${kw#WAIVER-}"
  else
    echo "FAIL: KNOWN_DRIFT row for '$kp' field 4 is not a canonical waiver id (got '$kw'; expected WAIVER-<n>, n>=1, no leading zero)." >&2
    STRUCT_BAD=1
  fi

  # --- field 5: closed vocabulary. An unreadable provenance is NOT approval.
  case "$kr" in
    RATIFIED|PENDING-OWNER-RATIFICATION) ;;
    *) echo "FAIL: KNOWN_DRIFT row for '$kp' ($kw) has no recognised ratification state in field 5 (got '$kr')." >&2
       echo "      Expected RATIFIED or PENDING-OWNER-RATIFICATION. An unreadable provenance is NOT approval." >&2
       STRUCT_BAD=1 ;;
  esac

  # --- identity: one row per path. drift_old_hash()/drift_new_hash() return the
  #     FIRST match, so a duplicate path would enforce one row and silently
  #     ignore the other.
  case " $KD_SEEN_PATHS " in
    *" $kp "*)
      echo "FAIL: KNOWN_DRIFT lists '$kp' more than once; the later row would never be enforced." >&2
      STRUCT_BAD=1 ;;
    *) KD_SEEN_PATHS="$KD_SEEN_PATHS $kp" ;;
  esac
done

# --- CLOSED VOCABULARY for field 4, checked as an identity rather than a count.
#     The distinct waiver ids must be exactly WAIVER-1 .. WAIVER-N with no gap
#     and no repeat of the sequence. A seventh waiver is admitted automatically
#     as WAIVER-6/7/... with no edit here; a typo (WAIVER-16, WAIVER-0) is not.
if [ "$STRUCT_BAD" = "0" ]; then
  KD_VOCAB="$(printf '%s\n' $KD_WAIVER_IDS | sort -n -u)"
  KD_N="$(printf '%s\n' "$KD_VOCAB" | grep -c '^[0-9]')"
  KD_EXPECT="$(seq 1 "$KD_N" 2>/dev/null)"
  if [ "$KD_VOCAB" != "$KD_EXPECT" ]; then
    echo "FAIL: KNOWN_DRIFT waiver ids are not a closed, contiguous vocabulary." >&2
    echo "      distinct ids present : $(printf '%s' "$KD_VOCAB" | tr '\n' ' ')" >&2
    echo "      expected WAIVER-1..-$KD_N : $(printf '%s' "$KD_EXPECT" | tr '\n' ' ')" >&2
    echo "      A gap or an out-of-range id means a waiver was mistyped or a row was lost." >&2
    STRUCT_BAD=1
  fi
fi

if [ "$STRUCT_BAD" != "0" ]; then
  echo "SACRED CHECK ABORTED — the waiver table itself is malformed; refusing to report a result." >&2
  exit 3
fi

# --- build the resolved 47-entry manifest: "<expected_hash>|<path>|<origin>"
MANIFEST=()
if [ ! -f "$BASE_MANIFEST" ]; then
  echo "FAIL: base manifest missing: $BASE_MANIFEST" >&2; exit 1
fi
BASE_COUNT=0
while read -r h p; do
  [ -z "${p:-}" ] && continue
  BASE_COUNT=$((BASE_COUNT+1))
  if nh="$(drift_new_hash "$p")"; then
    # W31-A3: label the row with ITS OWN waiver. Hardcoding "WAIVER-1" here
    # reported rateLimit.ts, migrate.ts and capTableMembership.ts as WAIVER-1.
    MANIFEST+=("$nh|$p|BASE($(drift_waiver "$p") frozen; was $h)")
  else
    MANIFEST+=("$h|$p|BASE")
  fi
done < "$BASE_MANIFEST"

ADDED_COUNT=0
for e in "${ADDED_47[@]}"; do
  ADDED_COUNT=$((ADDED_COUNT+1))
  MANIFEST+=("${e%%|*}|${e##*|}|G-2")
done

TOTAL=${#MANIFEST[@]}

# --- EXTRA_FROZEN (WAIVER-3, Wave 23) --------------------------------------
# A KNOWN_DRIFT row for a path that is NOT in the base manifest would otherwise
# check nothing at all. Those rows are verified here as EXTRA frozen-hash
# checks: they can FAIL the run, but they are deliberately NOT added to
# MANIFEST, so the manifest stays exactly 47 entries and the 47/47 count keeps
# meaning what it has always meant.
EXTRA_FROZEN=()
for e in "${KNOWN_DRIFT[@]}"; do
  ep="${e%%|*}"
  in_base=0
  for m in "${MANIFEST[@]}"; do
    [ "$(echo "$m" | cut -d'|' -f2)" = "$ep" ] && { in_base=1; break; }
  done
  # W31-A3: field 3 by position, not "the last field" — the row now ends in a
  # waiver id, and `${e##*|}` would have made that the expected hash.
  [ "$in_base" = "0" ] && EXTRA_FROZEN+=("$(printf '%s' "$e" | cut -d'|' -f3)|$ep|KNOWN_DRIFT($(printf '%s' "$e" | cut -d'|' -f4) extra)")
done

if [ "$LIST_ONLY" = "1" ]; then
  printf '%s\n' "SACRED MANIFEST — $TOTAL entries ($BASE_COUNT base + $ADDED_COUNT added by G-2)"
  for m in "${MANIFEST[@]}"; do
    IFS='|' read -r h p o <<<"$m"; printf '%s  %-70s  %s\n' "$h" "$p" "$o"
  done
  echo
  if [ ${#EXTRA_FROZEN[@]} -gt 0 ]; then
    printf '%s\n' "EXTRA_FROZEN — enforced, NOT part of the 47-entry manifest:"
    for m in "${EXTRA_FROZEN[@]}"; do
      IFS='|' read -r h p o <<<"$m"; printf '  %s  %-60s  %s\n' "$h" "$p" "$o"
    done
    echo
  fi
  # W31-A3: legend derived, and each row states the waiver that actually governs
  # it. Previously every row was labelled "frozen (WAIVER-1)" regardless of which
  # waiver it fell under, so WAIVER-2/3/4 files were mis-attributed in the --list
  # output as well as omitted from the summary count.
  echo "KNOWN_DRIFT ($(waiver_legend)) — current bytes adopted as frozen:"
  for e in "${KNOWN_DRIFT[@]}"; do
    IFS='|' read -r p old new wv rat <<<"$e"
    printf '  %s\n    old (2026-07 manifest): %s\n    frozen (%-9s)   : %s\n    ratification          : %s\n' "$p" "$old" "$wv" "$new" "$rat"
  done
  UNRAT="$(unratified_waivers)"
  if [ -n "$UNRAT" ]; then
    echo
    echo "!! UNRATIFIED WAIVERS IN FORCE ($(unratified_count)): $UNRAT"
    echo "   These sacred-file edits were taken under DELEGATED authority and are"
    echo "   awaiting owner sign-off. The bytes are enforced; the DECISION is not final."
  fi
  exit 0
fi

FAILED=(); MISSING=(); OK_N=0
for m in "${MANIFEST[@]}"; do
  IFS='|' read -r want p origin <<<"$m"
  abs="$(resolve_path "$p")"
  if [ ! -f "$abs" ]; then MISSING+=("$p"); continue; fi
  got="$(sha256sum "$abs" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then FAILED+=("$p|$want|$got"); else OK_N=$((OK_N+1)); fi
done

# EXTRA_FROZEN rows are enforced but not counted toward the 47.
EXTRA_OK=0
for m in "${EXTRA_FROZEN[@]}"; do
  IFS='|' read -r want p origin <<<"$m"
  abs="$(resolve_path "$p")"
  if [ ! -f "$abs" ]; then MISSING+=("$p"); continue; fi
  got="$(sha256sum "$abs" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then FAILED+=("$p|$want|$got"); else EXTRA_OK=$((EXTRA_OK+1)); fi
done

STRUCT_OK=1
[ "$TOTAL"      = "$EXPECTED_ENTRIES" ] || STRUCT_OK=0
[ "$BASE_COUNT" = "$BASE_EXPECTED"    ] || STRUCT_OK=0
[ "$ADDED_COUNT" = "$ADDED_EXPECTED"  ] || STRUCT_OK=0

RC=0
[ ${#FAILED[@]} -gt 0 ] && RC=1
[ ${#MISSING[@]} -gt 0 ] && RC=1
[ "$STRUCT_OK" = "0" ] && RC=1

if [ "$JSON" = "1" ]; then
  printf '{"entries":%d,"base":%d,"added":%d,"ok":%d,"extra_frozen":%d,"extra_frozen_ok":%d,"drifted":%d,"missing":%d,"structure_ok":%s,"unratified_waivers":%d,"unratified":"%s","exit":%d}\n' \
    "$TOTAL" "$BASE_COUNT" "$ADDED_COUNT" "$OK_N" "${#EXTRA_FROZEN[@]}" "$EXTRA_OK" "${#FAILED[@]}" "${#MISSING[@]}" \
    "$([ $STRUCT_OK = 1 ] && echo true || echo false)" "$(unratified_count)" "$(unratified_waivers)" "$RC"
  exit $RC
fi

if [ "$RC" = "0" ]; then
  # W31-A3: the legend is derived from KNOWN_DRIFT, so the names can no longer
  # fall behind the count. The old string named four waivers for five entries.
  # WAVE 38 · ROW 6 — the pending set is DERIVED and printed on the SAME summary
  # line an operator reads. A green 47/47 no longer conceals an unratified
  # waiver; when every waiver is signed off the line says so explicitly, so the
  # absence of a warning is itself an assertion rather than a silence.
  UNRAT="$(unratified_waivers)"
  if [ -n "$UNRAT" ]; then
    RAT_NOTE="; UNRATIFIED: $(unratified_count) PENDING OWNER RATIFICATION — $UNRAT"
  else
    RAT_NOTE="; all $(printf '%s' "${#KNOWN_DRIFT[@]}") waivers OWNER-RATIFIED"
  fi
  [ "$QUIET" = "1" ] || echo "SACRED OK: $OK_N/$TOTAL files byte-identical (${#KNOWN_DRIFT[@]} under KNOWN_DRIFT freeze: $(waiver_legend); $EXTRA_OK of them enforced outside the $TOTAL-entry manifest$RAT_NOTE)"
  if [ -n "$UNRAT" ] && [ "$QUIET" != "1" ]; then
    echo "   ^ these sacred-file edits are ENFORCED byte-for-byte but NOT yet signed off by the owner."
  fi
  exit 0
fi

echo "========================================================================"
echo "SACRED CHECK FAILED — build BLOCKED"
echo "========================================================================"
if [ "$STRUCT_OK" = "0" ]; then
  echo "manifest structure wrong: $TOTAL entries (expected $EXPECTED_ENTRIES)," \
       "$BASE_COUNT base (expected $BASE_EXPECTED), $ADDED_COUNT added (expected $ADDED_EXPECTED)"
fi
if [ ${#MISSING[@]} -gt 0 ]; then
  echo; echo "MISSING (${#MISSING[@]}):"
  for p in "${MISSING[@]}"; do echo "   - $p"; done
fi
if [ ${#FAILED[@]} -gt 0 ]; then
  echo; echo "DRIFTED (${#FAILED[@]}):"
  for f in "${FAILED[@]}"; do
    IFS='|' read -r p want got <<<"$f"
    echo "   - $p"; echo "       expected $want"; echo "       actual   $got"
    # W31-A3: name the waiver that actually governs THIS path, rather than
    # printing the set "WAIVER-1/2/3" — which also silently excluded WAIVER-4.
    if old="$(drift_old_hash "$p")"; then echo "       (KNOWN_DRIFT frozen file — $(drift_waiver "$p"), $(drift_ratification "$p"); pre-waiver hash was $old)"; fi
  done
fi
echo
echo "A sacred file changed. Restore the bytes. Do NOT re-freeze without an"
echo "owner waiver recorded in spec/OWNER_RULINGS_2026_08_09.md."
exit 1

# WAVE 38 · ROW 6 — unreachable in the success path above (it exits 0), kept as
# a guard for any future edit that falls through to the end of the script.
exit $RC
