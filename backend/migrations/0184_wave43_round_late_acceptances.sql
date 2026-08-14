-- WAVE 43 · OWNER RULING R7 — THE LATE-ACCEPTANCE LEDGER.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS TABLE EXISTS
-- ─────────────────────────────────────────────────────────────────────────────
-- The live audit of 2026-08-13 (finding F-7) found two rounds whose decision
-- windows had closed on 3 and 6 August still rendering an enabled
-- "Submit soft-circle ($250,000)" button on 13 August, and the API behind that
-- button accepting the commitment without a word. The owner's ruling:
--
--   "Go with your recommendation to enforce the close.
--    Accepting late commitments should be allowed."
--
-- So the close is now enforced on the server, and this table is the ONLY way
-- past it. It is not a flag on the round and not a column on `soft_circles`:
-- it is an append-only ledger of deliberate founder decisions, because the
-- whole point of the ruling is that
--
--   THE MONEY IS ALLOWED IN, BUT THE RECORD MUST NEVER LOOK LIKE IT ARRIVED
--   ON TIME.
--
-- A boolean `late` column on the commitment would record the symptom and lose
-- the decision: who allowed it, when they allowed it, what the deadline they
-- overrode actually was, and why. Every one of those is a row here.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THE LATE MARKER IS DERIVED AND `soft_circles` IS UNTOUCHED
-- ─────────────────────────────────────────────────────────────────────────────
-- `server/captableCommitStore.ts` is SACRED — the hash-chained cap-table ledger
-- of record may not be edited by this wave, and a late commitment must
-- nevertheless be visible as late ON THE CAP TABLE. The route around it: this
-- ledger plus the round's close window is sufficient to DERIVE "accepted after
-- close" for any commitment, so the marker is computed at projection time
-- (server/lib/roundCloseEnforcement.ts) and joined into the cap-table,
-- founder and investor payloads. No sacred file changes, no commitment row is
-- rewritten, and the derivation cannot drift out of sync with the ledger
-- because there is nothing to keep in sync.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE TWO CAPABILITIES, AND WHY THEY ARE DIFFERENT ROWS
-- ─────────────────────────────────────────────────────────────────────────────
--   kind = 'reopen'
--     The founder reopens the whole round until `reopen_until`. Anyone still
--     invited may commit while that window is live. Commitments made inside a
--     reopen are STILL after the original close and are STILL marked late —
--     `closed_at` on this row preserves the deadline that was passed, so the
--     marker survives even after the reopen window itself has elapsed.
--
--   kind = 'late_commitment'
--     The founder accepts ONE specific investor's commitment without reopening
--     the round to anybody else. Single-use: the first commitment that consumes
--     the grant stamps `consumed_at` and `soft_circle_id`, and the grant cannot
--     admit a second one. A grant that is never used expires with the round and
--     admits nothing.
--
-- Both are DELIBERATE by construction: a row exists only because a founder sent
-- an explicit POST carrying `confirm: true`. Nothing here is created by viewing
-- a page, by a default parameter, or as a side effect of any read.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- APPEND-ONLY
-- ─────────────────────────────────────────────────────────────────────────────
-- Rows are never deleted and never re-attributed. Withdrawal is `revoked_at`,
-- forward-only, so the history of "this was allowed for eleven minutes" is
-- still readable afterwards. `consumed_at` / `soft_circle_id` are the single
-- permitted post-insert write, and only from null.
--
-- NO MONEY COLUMN. Deliberate: an amount here could disagree with the
-- commitment's own `amount_minor`, and two numbers for one commitment is how a
-- money bug is born. This row points AT the commitment; the commitment remains
-- the only place its amount is stored.

CREATE TABLE IF NOT EXISTS round_late_acceptances (
  id                   TEXT PRIMARY KEY NOT NULL,
  -- Tenant scope, mirroring `soft_circles.tenant_id`. Nullable for the same
  -- reason it is nullable there: pre-tenant rows exist in this tree.
  tenant_id            TEXT,
  round_id             TEXT NOT NULL,
  company_id           TEXT,
  kind                 TEXT NOT NULL CHECK (kind IN ('reopen', 'late_commitment')),
  -- Required for 'late_commitment' (which invitation is being let in), always
  -- NULL for 'reopen' (which is round-wide). Enforced by the CHECK below.
  invitation_id        TEXT,
  -- Filled when a 'late_commitment' grant is consumed. NULL until then.
  soft_circle_id       TEXT,
  -- THE DEADLINE THAT WAS ALREADY PAST when this acceptance was granted. This
  -- is what makes the record say "after close" rather than merely "accepted",
  -- and it is why the marker outlives the reopen window.
  closed_at            TEXT NOT NULL,
  -- ATTRIBUTION. `accepted_by_user_id` is taken from the authenticated session,
  -- never from the request body.
  accepted_by_user_id  TEXT NOT NULL,
  accepted_by_name     TEXT,
  accepted_at          TEXT NOT NULL,
  reason               TEXT,
  -- 'reopen' only: the instant the reopened window itself closes again.
  reopen_until         TEXT,
  consumed_at          TEXT,
  revoked_at           TEXT,
  created_at           TEXT NOT NULL,
  -- A reopen must carry its new deadline and must not name an invitation; a
  -- late-commitment grant must name one and must not carry a reopen deadline.
  -- Declared here rather than left to the store so a direct SQL writer cannot
  -- create a row whose kind and payload disagree.
  CHECK (
    (kind = 'reopen'          AND invitation_id IS NULL     AND reopen_until IS NOT NULL)
    OR
    (kind = 'late_commitment' AND invitation_id IS NOT NULL AND reopen_until IS NULL)
  )
);

-- The enforcement read: "does this round have a live grant right now?" runs on
-- every soft-circle attempt against a closed round.
CREATE INDEX IF NOT EXISTS idx_round_late_acceptances_round
  ON round_late_acceptances(round_id);

-- The per-invitation grant lookup, and the projection read that marks one
-- commitment late.
CREATE INDEX IF NOT EXISTS idx_round_late_acceptances_invitation
  ON round_late_acceptances(invitation_id)
  WHERE invitation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_round_late_acceptances_soft_circle
  ON round_late_acceptances(soft_circle_id)
  WHERE soft_circle_id IS NOT NULL;

-- A given commitment can be marked late by at most one grant. Without this a
-- retry storm could attach two grants to one soft-circle and the cap table
-- would show the same commitment admitted twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_round_late_acceptances_soft_circle
  ON round_late_acceptances(soft_circle_id)
  WHERE soft_circle_id IS NOT NULL;
