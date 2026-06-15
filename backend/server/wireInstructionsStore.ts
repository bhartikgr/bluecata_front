/**
 * v24.3 — Round wire-transfer instructions store.
 *
 * Avi's main complaint for v24.3: v24.2 added a founder-side "Mark wire funded"
 * button, but the INVESTOR had no way to see WHERE to send the funds. When a
 * soft-circle is `confirmed` (signed), the investor needs the founder company's
 * bank wire instructions.
 *
 * This store persists one row PER ROUND (roundId UNIQUE) holding the bank wire
 * details the founder publishes for that round's investors.
 *
 * Persistence: a dedicated `round_wire_instructions` table created lazily via
 * CREATE TABLE IF NOT EXISTS using the better-sqlite3 raw driver (rawDb()),
 * mirroring the subscriptionStore / founderCrmStore / captableCommitStore
 * pattern. The sacred `shared/schema.ts` is NOT modified. On the Postgres
 * backend (where rawDb() throws) and in no-DB sandboxes the store degrades to an
 * in-memory map so the flow still functions hermetically; the in-memory cache is
 * the authority for reads either way.
 *
 * DEMO MODE: account numbers are stored/returned as-is (no encryption). This is
 * intentional for the demo build and flagged in the v24.3 report. A production
 * build must encrypt-at-rest + mask on read.
 */
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

export interface WireInstructions {
  roundId: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  routingNumber: string | null;
  swift: string | null;
  reference: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface SetWireInstructionsInput {
  roundId: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  routingNumber?: string | null;
  swift?: string | null;
  reference?: string | null;
  notes?: string | null;
}

/* ---------- In-memory authority (also the cache over the DB) ---------- */
const instructions = new Map<string, WireInstructions>(); // keyed by roundId

let tableReady = false;

function db(): { exec: (s: string) => void; prepare: (s: string) => any } | null {
  try {
    return rawDb();
  } catch {
    // Postgres backend (rawDb throws) or no-DB sandbox — in-memory only.
    return null;
  }
}

function ensureTable(): void {
  if (tableReady) return;
  const driver = db();
  if (!driver) {
    // No raw SQLite driver; in-memory store is authoritative.
    tableReady = true;
    return;
  }
  try {
    driver.exec(`CREATE TABLE IF NOT EXISTS round_wire_instructions (
      round_id TEXT PRIMARY KEY NOT NULL,
      bank_name TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      routing_number TEXT,
      swift TEXT,
      reference TEXT,
      notes TEXT,
      updated_at TEXT NOT NULL
    );`);
    tableReady = true;
  } catch (err) {
    log.warn("[wireInstructionsStore.ensureTable] CREATE TABLE failed (non-fatal):", (err as Error).message);
    tableReady = true; // fall back to in-memory; don't retry every call
  }
}

function rowToInstructions(r: any): WireInstructions {
  return {
    roundId: r.round_id,
    bankName: r.bank_name,
    accountName: r.account_name,
    accountNumber: r.account_number,
    routingNumber: r.routing_number ?? null,
    swift: r.swift ?? null,
    reference: r.reference ?? null,
    notes: r.notes ?? null,
    updatedAt: r.updated_at,
  };
}

/**
 * Upsert the wire instructions for a round (roundId is UNIQUE — one row per
 * round). Returns the persisted row.
 */
export function setWireInstructions(input: SetWireInstructionsInput): WireInstructions {
  ensureTable();
  const row: WireInstructions = {
    roundId: input.roundId,
    bankName: input.bankName,
    accountName: input.accountName,
    accountNumber: input.accountNumber,
    routingNumber: input.routingNumber ?? null,
    swift: input.swift ?? null,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    updatedAt: new Date().toISOString(),
  };

  instructions.set(row.roundId, row);

  const driver = db();
  if (driver) {
    try {
      driver
        .prepare(
          `INSERT INTO round_wire_instructions
             (round_id, bank_name, account_name, account_number, routing_number, swift, reference, notes, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(round_id) DO UPDATE SET
             bank_name = excluded.bank_name,
             account_name = excluded.account_name,
             account_number = excluded.account_number,
             routing_number = excluded.routing_number,
             swift = excluded.swift,
             reference = excluded.reference,
             notes = excluded.notes,
             updated_at = excluded.updated_at`,
        )
        .run(
          row.roundId,
          row.bankName,
          row.accountName,
          row.accountNumber,
          row.routingNumber,
          row.swift,
          row.reference,
          row.notes,
          row.updatedAt,
        );
    } catch (err) {
      log.warn("[wireInstructionsStore.setWireInstructions] persist failed (kept in-memory):", (err as Error).message);
    }
  }

  return row;
}

/**
 * Read the wire instructions for a round, or null if none have been set.
 * The in-memory cache is authoritative; the DB is hydrated lazily on miss.
 */
export function getWireInstructions(roundId: string): WireInstructions | null {
  ensureTable();
  const cached = instructions.get(roundId);
  if (cached) return cached;

  const driver = db();
  if (driver) {
    try {
      const r = driver
        .prepare(`SELECT * FROM round_wire_instructions WHERE round_id = ?`)
        .get(roundId);
      if (r) {
        const parsed = rowToInstructions(r);
        instructions.set(roundId, parsed);
        return parsed;
      }
    } catch (err) {
      log.warn("[wireInstructionsStore.getWireInstructions] read failed:", (err as Error).message);
    }
  }
  return null;
}

/** Test-only reset of the in-memory cache. */
export const _testAccessWireInstructions = {
  clear(): void {
    instructions.clear();
    tableReady = false;
  },
};
