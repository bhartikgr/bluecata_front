/**
 * v25.47 APD-022 — Pulse index symbol registry (DB-backed, no in-memory state).
 *
 * The Pulse watchlist is DB-driven: there is NO hardcoded symbol list in code.
 * Admins manage the catalog (add symbols, toggle enabled, set refresh cadence)
 * and the authed read path returns only enabled symbols in sort order.
 *
 * Storage (additive only — migration 0075 + connection.ts bootstrap):
 *   pulse_index_symbols(
 *     symbol TEXT PK, label TEXT, category TEXT, enabled INTEGER,
 *     refresh_seconds INTEGER, sort_order INTEGER, updated_at TEXT
 *   )
 */
import { rawDb } from "./db/connection";

export interface PulseSymbol {
  symbol: string;
  label: string | null;
  category: string | null;
  enabled: boolean;
  refreshSeconds: number;
  sortOrder: number;
  updatedAt: string;
}

function rowToSymbol(r: any): PulseSymbol {
  return {
    symbol: r.symbol,
    label: r.label ?? null,
    category: r.category ?? null,
    enabled: Boolean(r.enabled),
    refreshSeconds: r.refresh_seconds ?? 3600,
    sortOrder: r.sort_order ?? 0,
    updatedAt: r.updated_at,
  };
}

/** Symbol token: uppercase alnum plus dash/slash/dot; 1..24 chars (e.g. BTC-USD, USD/EUR). */
export function isValidSymbol(symbol: unknown): symbol is string {
  return typeof symbol === "string" && /^[A-Z0-9.\-/]{1,24}$/.test(symbol);
}

/** List ALL symbols (admin view), ordered by sort_order then symbol. */
export function listAllSymbols(): PulseSymbol[] {
  try {
    const rows: any[] = rawDb()
      .prepare(`SELECT * FROM pulse_index_symbols ORDER BY sort_order, symbol`)
      .all();
    return rows.map(rowToSymbol);
  } catch {
    return [];
  }
}

/** List ENABLED symbols only (authed read path), ordered by sort_order. */
export function listEnabledSymbols(): PulseSymbol[] {
  try {
    const rows: any[] = rawDb()
      .prepare(
        `SELECT * FROM pulse_index_symbols WHERE enabled = 1 ORDER BY sort_order, symbol`,
      )
      .all();
    return rows.map(rowToSymbol);
  } catch {
    return [];
  }
}

/** Read one symbol. Null if absent. */
export function getSymbol(symbol: string): PulseSymbol | null {
  if (!isValidSymbol(symbol)) return null;
  try {
    const row: any = rawDb()
      .prepare(`SELECT * FROM pulse_index_symbols WHERE symbol = ?`)
      .get(symbol);
    return row ? rowToSymbol(row) : null;
  } catch {
    return null;
  }
}

/** Create or update a symbol (upsert). */
export function upsertSymbol(args: {
  symbol: string;
  label?: string | null;
  category?: string | null;
  enabled?: boolean;
  refreshSeconds?: number;
  sortOrder?: number;
}): PulseSymbol {
  if (!isValidSymbol(args.symbol)) throw new Error("invalid_symbol");
  const prev = getSymbol(args.symbol);
  const label = args.label !== undefined ? args.label : prev?.label ?? null;
  const category = args.category !== undefined ? args.category : prev?.category ?? null;
  const enabled = args.enabled !== undefined ? args.enabled : prev?.enabled ?? true;
  const refreshSeconds = Math.max(
    1,
    Math.round(
      args.refreshSeconds !== undefined ? args.refreshSeconds : prev?.refreshSeconds ?? 3600,
    ),
  );
  const sortOrder = Math.round(
    args.sortOrder !== undefined ? args.sortOrder : prev?.sortOrder ?? 0,
  );
  const updatedAt = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO pulse_index_symbols
         (symbol, label, category, enabled, refresh_seconds, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         label           = excluded.label,
         category        = excluded.category,
         enabled         = excluded.enabled,
         refresh_seconds = excluded.refresh_seconds,
         sort_order      = excluded.sort_order,
         updated_at      = excluded.updated_at`,
    )
    .run(args.symbol, label, category, enabled ? 1 : 0, refreshSeconds, sortOrder, updatedAt);
  const out = getSymbol(args.symbol);
  if (!out) throw new Error("upsert_failed");
  return out;
}

/** Toggle the enabled flag for one symbol. Null if the symbol is absent. */
export function setSymbolEnabled(symbol: string, enabled: boolean): PulseSymbol | null {
  if (!isValidSymbol(symbol)) return null;
  if (!getSymbol(symbol)) return null;
  rawDb()
    .prepare(
      `UPDATE pulse_index_symbols SET enabled = ?, updated_at = ? WHERE symbol = ?`,
    )
    .run(enabled ? 1 : 0, new Date().toISOString(), symbol);
  return getSymbol(symbol);
}
