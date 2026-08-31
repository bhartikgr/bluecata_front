-- 0215_wave187_collective_bridge_inbound.sql
--
-- WAVE 187 (R159.2 — the owner chose OPTION A: build a REAL Collective receiver).
--
-- The Collective's own durable record of every bridge envelope it has RECEIVED,
-- and what it DID with each one. Before this table the only inbound endpoint in
-- the tree was `/api/_mock_collective/inbound`, whose idempotency memory was a
-- process-local `Set` that forgot everything on restart, and which recorded no
-- outcome at all — an event was either 200'd or 409'd and then vanished.
--
-- THE PRIMARY KEY IS THE IDEMPOTENCY KEY. `id` holds the envelope's `eventId`,
-- which is exactly the value the outbound signer puts in the `idempotency-key`
-- header (server/lib/bridgeRuntime.ts). The receiver claims this row in the SAME
-- transaction as the apply, so a replay is refused by a database constraint
-- rather than by RAM. That is what makes "743 events will be delivered, and any
-- retry must be safe" true.
--
-- `outcome` is one of:
--   'processing' — transient, only visible inside an uncommitted transaction.
--   'applied'    — the event changed Collective state. `handler` names how.
--   'ignored'    — ACCEPTED-AND-IGNORED. Explicitly recorded, never a silent
--                  discard. `reason` always says why in plain words.
--   'rejected'   — the handler failed. The apply was rolled back; the sender
--                  retries and the existing dead-letter machinery takes over.
--
-- `reason` is NOT NULL for every terminal outcome. An event with no meaningful
-- destination must be recorded as accepted-and-ignored WITH the reason; a NULL
-- here would be the silent discard this table exists to prevent.
--
-- NO MONEY COLUMN. The receiver never reads, converts, or writes an amount.
-- `envelope_json` retains the payload verbatim as received, so a money-bearing
-- event is preserved for inspection without any figure ever being transcribed
-- into a second ledger.

CREATE TABLE IF NOT EXISTS collective_bridge_inbound (
  id              TEXT PRIMARY KEY NOT NULL,
  event_type      TEXT NOT NULL,
  aggregate_id    TEXT NOT NULL,
  aggregate_kind  TEXT NOT NULL,
  occurred_at     TEXT NOT NULL,
  received_at     TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  handler         TEXT,
  reason          TEXT NOT NULL,
  envelope_json   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cbi_outcome ON collective_bridge_inbound(outcome);
CREATE INDEX IF NOT EXISTS idx_cbi_type_agg ON collective_bridge_inbound(event_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_cbi_received ON collective_bridge_inbound(received_at);
