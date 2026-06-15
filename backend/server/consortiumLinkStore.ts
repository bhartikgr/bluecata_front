/**
 * v23.9 A4/CP-5 — Company ↔ Consortium-Partner sponsor links.
 *
 * A Capavate company can be sponsored by exactly one consortium partner.
 *
 * v25.2 RAM→DB fix: previously this store kept (companyId → partnerId) entirely
 * in a Map, meaning every server restart wiped all sponsor relationships and
 * broke the Track D cross-component attribution (founder-channels endpoint).
 * The Map is now a read cache fronting a DB table; every write goes to DB,
 * every read hits DB then refreshes the cache.
 */
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

const links = new Map<string, string>(); // companyId -> partnerId (read cache)

function ensureTable(): void {
  try {
    const db = rawDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS consortium_links (
        company_id TEXT PRIMARY KEY NOT NULL,
        partner_id TEXT NOT NULL,
        linked_at TEXT NOT NULL,
        unlinked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_clinks_partner ON consortium_links(partner_id);
    `);
  } catch (err) {
    log.warn("[consortiumLinkStore.ensureTable] failed:", (err as Error).message);
  }
}
ensureTable();

export function linkConsortiumPartner(companyId: string, partnerId: string): void {
  /* v25.23 NH-7 / NH-M (Lane D NH-7, Lane A NEW-6) — fail closed.
   * Previously this set the in-memory Map FIRST and then swallowed any DB-write
   * failure, so on a failed write the sponsor link lived only in RAM and
   * silently disappeared on the next restart (breaking Track D founder-channel
   * attribution that resolves through consortium_links). Now: write to the DB
   * FIRST and let a failure propagate (throw); only update the read-cache Map
   * AFTER the durable write succeeds. The DB is the source of truth. */
  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO consortium_links (company_id, partner_id, linked_at, unlinked_at)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(company_id) DO UPDATE SET
         partner_id = excluded.partner_id,
         linked_at = excluded.linked_at,
         unlinked_at = NULL`,
    ).run(companyId, partnerId, new Date().toISOString());
  } catch (err) {
    log.warn("[consortiumLinkStore.link] DB write failed:", (err as Error).message);
    throw new Error(
      `CONSORTIUM_LINK_PERSIST_FAILED: ${companyId}->${partnerId}: ${(err as Error).message}`,
    );
  }
  // Durable write succeeded — now refresh the read cache.
  links.set(companyId, partnerId);
}

export function unlinkConsortiumPartner(companyId: string): boolean {
  // v25.13 NL2 — was previously returning the Map.delete() boolean which
  // could be `false` simply because the link existed only in DB (the Map
  // had not yet been hydrated for this entry after a restart). Callers
  // interpreted that as failure even though the DB soft-delete succeeded.
  // Now: DB write is the source of truth; Map eviction is a side effect.
  links.delete(companyId);
  let dbOk = false;
  try {
    const db = rawDb();
    db.prepare(
      `UPDATE consortium_links SET unlinked_at = ? WHERE company_id = ? AND unlinked_at IS NULL`,
    ).run(new Date().toISOString(), companyId);
    dbOk = true;
  } catch (err) {
    log.warn("[consortiumLinkStore.unlink] DB write failed:", (err as Error).message);
  }
  return dbOk;
}

export function getConsortiumPartnerId(companyId: string): string | null {
  if (links.has(companyId)) return links.get(companyId) ?? null;
  try {
    const db = rawDb();
    const row = db.prepare(
      `SELECT partner_id FROM consortium_links WHERE company_id = ? AND unlinked_at IS NULL`,
    ).get(companyId) as { partner_id: string } | undefined;
    if (row?.partner_id) {
      links.set(companyId, row.partner_id);
      return row.partner_id;
    }
  } catch (err) {
    log.warn("[consortiumLinkStore.get] DB read failed:", (err as Error).message);
  }
  return null;
}

export function listConsortiumLinks(): Array<{ companyId: string; partnerId: string }> {
  try {
    const db = rawDb();
    const rows = db.prepare(
      `SELECT company_id, partner_id FROM consortium_links WHERE unlinked_at IS NULL`,
    ).all() as Array<{ company_id: string; partner_id: string }>;
    // refresh cache
    for (const r of rows) links.set(r.company_id, r.partner_id);
    return rows.map(r => ({ companyId: r.company_id, partnerId: r.partner_id }));
  } catch (err) {
    log.warn("[consortiumLinkStore.list] DB read failed:", (err as Error).message);
    return Array.from(links.entries()).map(([companyId, partnerId]) => ({ companyId, partnerId }));
  }
}

export function clearConsortiumLinks(): void {
  links.clear();
  try {
    const db = rawDb();
    db.prepare(`UPDATE consortium_links SET unlinked_at = ? WHERE unlinked_at IS NULL`).run(new Date().toISOString());
  } catch (err) {
    log.warn("[consortiumLinkStore.clear] DB write failed:", (err as Error).message);
  }
}

// Eager hydrate on module load so the first read after restart is fast.
try {
  const db = rawDb();
  const rows = db.prepare(
    `SELECT company_id, partner_id FROM consortium_links WHERE unlinked_at IS NULL`,
  ).all() as Array<{ company_id: string; partner_id: string }>;
  for (const r of rows) links.set(r.company_id, r.partner_id);
  if (rows.length > 0) log.info(`[consortiumLinkStore] hydrated ${rows.length} active links from DB`);
} catch (err) {
  log.warn("[consortiumLinkStore] hydrate failed:", (err as Error).message);
}
