-- ═══════════════════════════════════════════════════════════════════════════════
-- WAVE 211 · D1/D2/C4/C5 — THE PARTNER MONEY GATES, ON THE ROWS THEY GATE.
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT THE OWNER ASKED FOR
--   A live audit found the most severe unguarded action on the platform: "Record
--   Distribution" on the standalone SPV admin page states that "Distributions are
--   append-only and cannot be edited or deleted once recorded" — and then requires
--   nothing at all. Also unguarded: "Record Capital Call", "Invite an LP" and
--   "Commit an LP to the cap table": real financial commitments with no
--   accreditation step, no consent and no disclosure.
--
-- WHAT WAS TRUE BEFORE THIS MIGRATION, MEASURED — NOT ASSUMED
--   Four routes, verified by reading them and by proving which registrar the
--   production tree actually calls (build_log/wave211/W211_PREFLIGHT.md §"The four
--   actions"):
--     POST /api/partner/me/spv/:spvId/distributions   spvEngineRoutes.ts:1672
--     POST /api/partner/me/spvs/:id/capital-calls     spvLegacyAdapters.ts:498
--     POST /api/partner/me/spv/:spvId/lp-invites      spvEngineRoutes.ts:1889
--     POST /api/partner/me/spv/:spvId/lp-commit       spvEngineRoutes.ts:1960
--   Note the trap this wave had to survive: the capital call posts to the PLURAL
--   family (the legacy adapter, mounted at routes.ts:1907) while the distribution
--   posts to the SINGULAR family (the engine, mounted at routes.ts:1687). One
--   letter apart, two registrars. A gate on the engine alone would have left
--   capital calls ungated. A third registrar, registerSpvFundRoutes, also declares
--   a capital-call path but is a DORMANT TWIN with no production import or call —
--   waveB_retirement_guard.test.ts asserts it stays dormant — so gating it would
--   have repeated the wave-189 mistake of proving a gate against dead code.
--   Each route had role, agreement and vehicle-state gating. NONE had an operator
--   attestation. assertSpvAttestedForNewCapital is the near-miss: it tests the
--   VEHICLE's launch attestation state, not the operator's attestation of THIS
--   money event.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ────────────────────────────────────────────
--   It creates NO table. It inserts NO row. It updates NO existing row. It deletes
--   nothing and expires nothing. It creates no second consent store: `legal_consents`
--   already exists but its context vocabulary is closed (signup / new_company /
--   onboarding / settings_update) and wave 210 is rewriting that area, so adding an
--   SPV money-event context there would have created a second consent vocabulary
--   inside a store another wave is moving. `spv_launch_signoffs` is keyed to a
--   vehicle launch and is adopted as the STRUCTURAL TEMPLATE, not as the
--   destination. The attestation therefore lives on the event's own row, which is
--   also what the build doc's wave-211 section specifies.
--
--   Every column added is NULLABLE with no default, so every distribution, capital
--   call and invite that already exists keeps exactly the values it has, and a
--   reader can still tell "this entry predates the gate" (NULL) from "this entry
--   was signed for" — an absence is never turned into a value (R176.1).
--
--   It adds no column to `shared/schema.ts`, deliberately: an IP address and a user
--   agent placed anywhere drizzle can see would be echoed to LPs by the read
--   routes that re-spread hydrated rows. These columns are written and read by ONE
--   module, `server/wave211MoneyEventAttestationStore.ts`, and by nothing else.
--
--   It adds no upsert concern. Enumerated mechanically for §5.10: there are ZERO
--   `onConflictDoUpdate` writers and ZERO raw `ON CONFLICT` writers against
--   `spv_distribution`, `spv_capital_calls` and `spv_lp_invite`. All three are
--   plain INSERTs; `spv_lp_invite` additionally has a plain
--   `UPDATE ... SET status, first_name` which names no attestation column and so
--   cannot clobber one. There is no conflict `set` clause anywhere that needs
--   extending.
--
-- ── WHAT IT DOES ───────────────────────────────────────────────────────────────
--   Nine nullable TEXT columns per gated action. The first four are the build doc's
--   §211 list (version, text, signed name, signed-at); the rest are what ITEM B of
--   the wave brief requires for the record to be PROVABLE later.
--
--     *_attestation_version      The frozen text version identifier, e.g.
--                                W211-MONEY-EVENT-ATT-v1. A wording change is a NEW
--                                version, never an edit to a stored row. This column
--                                is also the write-once latch: the store's UPDATE
--                                carries `WHERE *_attestation_version IS NULL`, so a
--                                recorded attestation can never be replaced.
--     *_attestation_text         The exact text that was on the partner's screen,
--                                verbatim. The record must prove what was SHOWN, not
--                                what a version number implies.
--     *_attestation_text_sha256  Hex SHA-256 of that text (R187.3 — store the exact
--                                text or its hash; this stores both).
--     *_attestation_signed_name  The typed full legal name, whitespace-folded, NEVER
--                                truncated. A silently shortened legal name is a
--                                forged legal name, so an over-long name is refused
--                                at the gate instead.
--     *_attestation_signed_at    Server-observed ISO-8601 UTC timestamp. NEVER
--                                client-supplied (R187.1).
--     *_attestation_signed_by    The authenticated user id the server resolved.
--     *_attestation_ip           Server-observed IP, or NULL.
--     *_attestation_ip_capture   'captured' or 'not_captured'. This column exists so
--                                that a NULL ip can be read as "the server could not
--                                observe one" rather than as "nobody looked". A
--                                fabricated address is never written (R187.1).
--     *_attestation_user_agent   The request's user agent as received, or NULL.
--
--   Money events additionally get:
--     *_attestation_basis        Draft 03's "Basis of determination" free text: the
--                                document, resolution, notice or calculation the
--                                entry is based on. Required at the gate.
--
--   The currency-confirmation tick the partner already gives is stored rather than
--   discarded, per the build doc; its TEXT is unchanged by this wave.
--     *_currency_confirmed       'true' when the tick was given, else NULL.
--     *_currency_confirmed_code  The currency code the tick was given against. No
--                                currency is ever assumed, converted or hardcoded.
--
--   `spv_lp_invite` carries TWO independent families, because one row can be both
--   the invitation that was sent and the commitment that was later recorded against
--   it (recordLpCommitIdentity advances a matched invite in place). Sharing one
--   family would let a commitment overwrite the invitation's attestation, or the
--   write-once latch would refuse the commitment outright. Hence
--   `attestation_*` for the invitation and `commit_attestation_*` for the
--   commitment.
--
--   `server/db/connection.ts` is SACRED, so these columns cannot be added to its
--   DDL. The store self-heals by reading the ALTER statements below out of this
--   file, which is why every statement is one line, one ALTER, one column.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Distributions: POST /api/partner/me/spv/:spvId/distributions ───────────────
ALTER TABLE spv_distribution ADD COLUMN attestation_version TEXT;
ALTER TABLE spv_distribution ADD COLUMN attestation_text TEXT;
ALTER TABLE spv_distribution ADD COLUMN attestation_text_sha256 TEXT;
ALTER TABLE spv_distribution ADD COLUMN attestation_signed_name TEXT;
ALTER TABLE spv_distribution ADD COLUMN attestation_signed_at TEXT;
ALTER TABLE spv_distribution ADD COLUMN attestation_signed_by TEXT;
ALTER TABLE spv_distribution ADD COLUMN attestation_ip TEXT;
ALTER TABLE spv_distribution ADD COLUMN attestation_ip_capture TEXT;
ALTER TABLE spv_distribution ADD COLUMN attestation_user_agent TEXT;
ALTER TABLE spv_distribution ADD COLUMN attestation_basis TEXT;
ALTER TABLE spv_distribution ADD COLUMN attestation_currency_confirmed TEXT;
ALTER TABLE spv_distribution ADD COLUMN attestation_currency_confirmed_code TEXT;

-- ── Capital calls: POST /api/partner/me/spvs/:id/capital-calls ─────────────────
ALTER TABLE spv_capital_calls ADD COLUMN attestation_version TEXT;
ALTER TABLE spv_capital_calls ADD COLUMN attestation_text TEXT;
ALTER TABLE spv_capital_calls ADD COLUMN attestation_text_sha256 TEXT;
ALTER TABLE spv_capital_calls ADD COLUMN attestation_signed_name TEXT;
ALTER TABLE spv_capital_calls ADD COLUMN attestation_signed_at TEXT;
ALTER TABLE spv_capital_calls ADD COLUMN attestation_signed_by TEXT;
ALTER TABLE spv_capital_calls ADD COLUMN attestation_ip TEXT;
ALTER TABLE spv_capital_calls ADD COLUMN attestation_ip_capture TEXT;
ALTER TABLE spv_capital_calls ADD COLUMN attestation_user_agent TEXT;
ALTER TABLE spv_capital_calls ADD COLUMN attestation_basis TEXT;
ALTER TABLE spv_capital_calls ADD COLUMN attestation_currency_confirmed TEXT;
ALTER TABLE spv_capital_calls ADD COLUMN attestation_currency_confirmed_code TEXT;

-- ── LP invitation: POST /api/partner/me/spv/:spvId/lp-invites ──────────────────
ALTER TABLE spv_lp_invite ADD COLUMN attestation_version TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN attestation_text TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN attestation_text_sha256 TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN attestation_signed_name TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN attestation_signed_at TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN attestation_signed_by TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN attestation_ip TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN attestation_ip_capture TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN attestation_user_agent TEXT;

-- ── Cap-table commitment: POST /api/partner/me/spv/:spvId/lp-commit ────────────
ALTER TABLE spv_lp_invite ADD COLUMN commit_attestation_version TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN commit_attestation_text TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN commit_attestation_text_sha256 TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN commit_attestation_signed_name TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN commit_attestation_signed_at TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN commit_attestation_signed_by TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN commit_attestation_ip TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN commit_attestation_ip_capture TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN commit_attestation_user_agent TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN commit_attestation_currency_confirmed TEXT;
ALTER TABLE spv_lp_invite ADD COLUMN commit_attestation_currency_confirmed_code TEXT;
