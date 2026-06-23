/**
 * CP-008 Phase A — One-time backfill that stitches hash chains across all
 * existing partner_crm_contacts rows.
 *
 * Strategy:
 *   - Find all partner_crm_contacts rows with `curr_hash IS NULL OR curr_hash = ''`.
 *   - Group by partnerId; within each partner, sort by created_at ASC.
 *   - Walk the group, computing prev/curr hashes from a stable payload subset:
 *       (partner_id | contact_user_id | email | name | created_at | prev_hash)
 *     Genesis prev_hash for the first row of each partner is the literal
 *     `crm:0000000000000000000000000000000000000000000000000000000000000000`.
 *   - Persist results inside a single Drizzle transaction per partner.
 *   - Mark the migration as applied in `_migrations_applied` so the backfill
 *     becomes a no-op on subsequent boots.
 *
 * Idempotency: keyed by `cp_a_crm_chain_stitch_v1` in `_migrations_applied`.
 *   - If the key exists, the function exits early.
 *   - Even if forced to re-run, rows that already have a non-empty curr_hash
 *     are skipped (each partner's chain is only re-stitched if it has gaps).
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { log } from "./logger";

const MIGRATION_KEY = "cp_a_crm_chain_stitch_v1";
const GENESIS = "crm:0000000000000000000000000000000000000000000000000000000000000000";

function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

function hashInput(
  row: { partner_id: string; contact_user_id: string | null; email: string | null; name: string; created_at: string },
  prevHash: string | null,
): Record<string, unknown> {
  return {
    partnerId: row.partner_id,
    contactUserId: row.contact_user_id ?? "",
    email: row.email ?? "",
    name: row.name,
    createdAt: row.created_at,
    prevHash: prevHash ?? GENESIS,
  };
}

/**
 * Returns true if the migration has already been applied.
 */
function alreadyApplied(): boolean {
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — migration ledger is global.
    const rows = db
      .all(sql`SELECT key FROM _migrations_applied WHERE key = ${MIGRATION_KEY}`) as Array<{ key: string }>;
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    // Table missing → treat as not applied; the caller will create rows.
    return false;
  }
}

function markApplied(): void {
  const db: any = getDb();
  const now = new Date().toISOString();
  try {
    db.run(
      sql`INSERT OR IGNORE INTO _migrations_applied (key, applied_at) VALUES (${MIGRATION_KEY}, ${now})`,
    );
  } catch (err) {
    log.warn({
      route: "partnerCrmChainStitch.markApplied",
      errorType: "marker_insert_failed",
      message: (err as Error).message,
    });
  }
}

/**
 * Stitch hash chains for any partner_crm_contacts rows missing a curr_hash.
 * Safe to call on every boot — exits early if marker present and no gaps.
 */
export function stitchPartnerCrmChain(): { stitched: number; partnersTouched: number } {
  if (alreadyApplied()) {
    return { stitched: 0, partnersTouched: 0 };
  }

  const db: any = getDb();
  let allRows: Array<{
    id: string;
    partner_id: string;
    contact_user_id: string | null;
    email: string | null;
    name: string;
    created_at: string;
    curr_hash: string | null;
  }>;
  try {
    // CROSS-TENANT (admin) — stitching walks every partner's CRM history.
    allRows = db.all(sql`
      SELECT id, partner_id, contact_user_id, email, name, created_at, curr_hash
      FROM partner_crm_contacts
      ORDER BY partner_id ASC, created_at ASC
    `) as Array<{
      id: string;
      partner_id: string;
      contact_user_id: string | null;
      email: string | null;
      name: string;
      created_at: string;
      curr_hash: string | null;
    }>;
  } catch (err) {
    log.warn({
      route: "partnerCrmChainStitch.read",
      errorType: "read_failed",
      message: (err as Error).message,
    });
    // Marker still set so we don't retry every boot on a hard DB issue.
    markApplied();
    return { stitched: 0, partnersTouched: 0 };
  }

  if (allRows.length === 0) {
    markApplied();
    return { stitched: 0, partnersTouched: 0 };
  }

  // Group by partner.
  const grouped = new Map<string, typeof allRows>();
  for (const r of allRows) {
    if (!grouped.has(r.partner_id)) grouped.set(r.partner_id, []);
    grouped.get(r.partner_id)!.push(r);
  }

  let stitched = 0;
  let partnersTouched = 0;

  for (const [partnerId, rows] of Array.from(grouped.entries())) {
    // Determine if this partner needs any stitching at all.
    const needsStitch = rows.some((r) => !r.curr_hash || r.curr_hash === "");
    if (!needsStitch) continue;

    // Walk the partner's history in created_at order, computing chain.
    let prev: string | null = null;
    const updates: Array<{ id: string; prev: string | null; curr: string }> = [];
    for (const r of rows) {
      if (r.curr_hash && r.curr_hash !== "" && prev === null) {
        // Already-stitched prefix — adopt its currHash as the running prev.
        prev = r.curr_hash;
        continue;
      }
      if (r.curr_hash && r.curr_hash !== "") {
        prev = r.curr_hash;
        continue;
      }
      const curr = computeHash(prev, hashInput(r, prev));
      updates.push({ id: r.id, prev, curr });
      prev = curr;
    }
    if (updates.length === 0) continue;

    try {
      db.transaction((tx: any) => {
        for (const u of updates) {
          tx.run(sql`
            UPDATE partner_crm_contacts
            SET prev_hash = ${u.prev}, curr_hash = ${u.curr}
            WHERE id = ${u.id}
          `);
        }
      });
      stitched += updates.length;
      partnersTouched += 1;
    } catch (err) {
      log.error({
        route: "partnerCrmChainStitch.write",
        errorType: "write_failed",
        partnerId,
        message: (err as Error).message,
      });
    }
  }

  markApplied();
  log.info({
    route: "partnerCrmChainStitch.complete",
    stitched,
    partnersTouched,
  });
  return { stitched, partnersTouched };
}
