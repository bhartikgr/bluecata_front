-- migrations/0127_wave_c_fd_pre_money_shares.sql
-- Wave C v26.5.0 (Shadie Finding 1a) — decouple PPS denominator from
-- sharesAuthorized by adding a dedicated fully-diluted pre-money share
-- count column. This is only used to derive PPS (pre-money ÷ FD shares,
-- grossed up for any pool top-up). Existing rounds get NULL and remain
-- valid. Non-foundation priced rounds now enforce positive fdPreMoneyShares
-- at the wizard and server layers.
--
-- Additive: single nullable INTEGER column.
-- Idempotent: guarded by the platform migration runner's duplicate-column
-- handling and the inline self-heal in server/db/connection.ts, which
-- also uses a PRAGMA table_info check.

ALTER TABLE rounds ADD COLUMN fd_pre_money_shares INTEGER;
