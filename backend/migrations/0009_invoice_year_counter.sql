-- Patch v12 Day 2 Wave 2 — invoice_year_counter.
-- Optional auxiliary table. The store actually derives the next number via
-- MAX(invoice_number) WHERE invoice_number LIKE 'CAP-{year}-%' inside the
-- create-invoice transaction, which eliminates any race entirely. This
-- table is the persisted cache that hydrates the in-memory counter Map.

CREATE TABLE IF NOT EXISTS invoice_year_counter (
  year INTEGER PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
