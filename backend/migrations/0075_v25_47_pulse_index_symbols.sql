-- 0075_v25_47_pulse_index_symbols.sql
-- v25.47 APD-022 — Pulse index symbol registry.
-- ADDITIVE ONLY: CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE seed of the
-- canonical 10 symbols. Mirrors connection.ts applyV2547Schema.
CREATE TABLE IF NOT EXISTS pulse_index_symbols (
  symbol          TEXT PRIMARY KEY NOT NULL,
  label           TEXT,
  category        TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  refresh_seconds INTEGER NOT NULL DEFAULT 3600,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);
INSERT OR IGNORE INTO pulse_index_symbols (symbol, label, category, enabled, refresh_seconds, sort_order, updated_at) VALUES
  ('SPY',     'S&P 500 ETF',       'equity_index', 1, 3600, 0, '2026-06-30T00:00:00.000Z'),
  ('QQQ',     'Nasdaq 100 ETF',    'equity_index', 1, 3600, 1, '2026-06-30T00:00:00.000Z'),
  ('DIA',     'Dow Jones ETF',     'equity_index', 1, 3600, 2, '2026-06-30T00:00:00.000Z'),
  ('IWM',     'Russell 2000 ETF',  'equity_index', 1, 3600, 3, '2026-06-30T00:00:00.000Z'),
  ('XLK',     'Technology Sector', 'sector',       1, 3600, 4, '2026-06-30T00:00:00.000Z'),
  ('XLF',     'Financials Sector', 'sector',       1, 3600, 5, '2026-06-30T00:00:00.000Z'),
  ('BTC-USD', 'Bitcoin',           'crypto',       1, 3600, 6, '2026-06-30T00:00:00.000Z'),
  ('ETH-USD', 'Ethereum',          'crypto',       1, 3600, 7, '2026-06-30T00:00:00.000Z'),
  ('VIX',     'Volatility Index',  'volatility',   1, 3600, 8, '2026-06-30T00:00:00.000Z'),
  ('USD/EUR', 'US Dollar / Euro',  'fx',           1, 3600, 9, '2026-06-30T00:00:00.000Z');
