/**
 * Slide 13b B — durable, partner-scoped relationship candidates.
 *
 * This is the read authority for the new Portfolio registration projection and
 * its owned detail/write gates. It mirrors the existing six-proof policy without
 * scanning the company catalog or depending on process-local hydrated arrays.
 */
import { rawDb } from "../db/connection";

export function readDurablePartnerCompanyCandidates(partnerId: string): Set<string> {
  if (!partnerId) throw new Error("PARTNER_ID_REQUIRED");
  const db = rawDb();
  const ids = new Set<string>();
  const addRows = (rows: Array<{ company_id?: unknown }>) => {
    for (const row of rows) {
      const companyId = String(row.company_id ?? "").trim();
      if (companyId) ids.add(companyId);
    }
  };

  // 1) live partner-owned private portfolio profile
  addRows(db.prepare(`
    SELECT company_id FROM partner_portfolio_company
    WHERE partner_id = ? AND deleted_at IS NULL
      AND (
        tenant_id IS NULL
        OR tenant_id IN (
          SELECT DISTINCT tenant_id FROM partner_portfolio_company
          WHERE partner_id = ? AND tenant_id IS NOT NULL
        )
      )
  `).all(partnerId, partnerId) as Array<{ company_id: string }>);
  // 2) live attribution
  addRows(db.prepare(`
    SELECT company_id FROM partner_attributions
    WHERE partner_id = ? AND revoked_at IS NULL
  `).all(partnerId) as Array<{ company_id: string }>);
  // 3) live consortium sponsor link
  addRows(db.prepare(`
    SELECT company_id FROM consortium_links
    WHERE partner_id = ? AND unlinked_at IS NULL
  `).all(partnerId) as Array<{ company_id: string }>);
  // 4) durable JSON row used by partnerPipelineStore itself. The KV table is
  // lazily created; absence means no durable pipeline row has existed.
  const hasPipelineTable = !!db.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'kv_partnerPipeline'
  `).get();
  if (hasPipelineTable) {
    addRows(db.prepare(`
      SELECT json_extract(payload_json, '$.companyId') AS company_id
      FROM kv_partnerPipeline
      WHERE deleted_at IS NULL
        AND json_extract(payload_json, '$.partnerId') = ?
    `).all(partnerId) as Array<{ company_id: string | null }>);
  }
  // 5) live partner deal promotion
  addRows(db.prepare(`
    SELECT company_id FROM partner_deal_promotions
    WHERE partner_id = ? AND deleted_at IS NULL AND company_id IS NOT NULL
      AND status NOT IN ('rejected', 'withdrawn', 'archived')
      AND tenant_id IN (
        SELECT DISTINCT tenant_id FROM partner_deal_promotions
        WHERE partner_id = ?
      )
  `).all(partnerId, partnerId) as Array<{ company_id: string }>);
  // 6) live partner-sponsored canonical SPV target
  addRows(db.prepare(`
    SELECT target_company_id AS company_id FROM spv
    WHERE sponsor_partner_id = ? AND archived_at IS NULL
      AND target_company_id IS NOT NULL
  `).all(partnerId) as Array<{ company_id: string }>);

  return ids;
}

export function durablePartnerHasCompanyRelationship(partnerId: string, companyId: string): boolean {
  if (!partnerId || !companyId) return false;
  return readDurablePartnerCompanyCandidates(partnerId).has(companyId);
}
