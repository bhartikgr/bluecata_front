/**
 * server/lib/investorCrmInvitationSeed.ts — v25.48 B1.
 *
 * PARALLEL module for bi-directional CRM auto-seed (investor side).
 *
 * Founder-side CRM already auto-seeds at invitation (upsertCrmContactForInvitation
 * in roundInvitationsStore). B1 adds the INVESTOR side: when an investor redeems
 * an invitation (i.e. joins a company's round), seed a row in the INVESTOR's CRM
 * for the founder/company they were invited to — tagged "invitation-sourced".
 *
 * Sacred boundary: `server/investorCrmStore.ts` (Tier-1B) is NEVER edited. This
 * module writes DIRECTLY to the additive-safe `investor_crm_contacts` table
 * (created by migration 0012, already present) using the same schema the sacred
 * store hydrates from, so the sacred store's boot hydrate picks the row up. The
 * write is idempotent per (investor_id, company_id) and non-fatal (best-effort;
 * a redeem must never fail because of a CRM seed).
 *
 * "New investor → at registration; existing → at invitation WITH an
 *  invitation-sourced tag": the redeem endpoint both creates the persona (new
 *  investor) AND is the invitation event for an existing investor, so seeding
 *  at redeem covers both. Every seeded row carries the `invitation-sourced` tag;
 *  a pre-existing manually-created row for the same (investor, company) is left
 *  untouched (INSERT ... WHERE NOT EXISTS).
 */
import { randomBytes } from "node:crypto";
import { rawDb } from "../db/connection";
import { DEFAULT_CHAPTER_TENANT_ID } from "./chapterDefaults";
import { log } from "./logger";

export interface InvestorCrmSeedInput {
  investorId: string;               // the redeeming investor's user id (persona id)
  companyId: string | null;
  companyName?: string | null;
  founderName?: string | null;
  founderEmail?: string | null;
  roundId?: string | null;
  tenantId?: string | null;
}

/**
 * Seed the investor's CRM row for the founder/company they were invited to.
 * Idempotent: if a row already exists for (investor_id, company_id) it is left
 * as-is (we do not clobber an investor's own edits). Returns the row id when a
 * new row was created, or null when skipped / on error (non-fatal).
 */
export function seedInvestorCrmFromInvitation(input: InvestorCrmSeedInput): string | null {
  if (!input.investorId || !input.companyId) return null;
  try {
    const db = rawDb();
    // Skip if the investor already has a CRM row for this company (any state,
    // not soft-deleted) — never clobber existing investor-owned data.
    const existing = db
      .prepare(
        `SELECT id FROM investor_crm_contacts
           WHERE investor_id = ? AND company_id = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .get(input.investorId, input.companyId) as { id?: string } | undefined;
    if (existing?.id) return null;

    const id = `icrm_${randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();
    const tenantId = input.tenantId ?? DEFAULT_CHAPTER_TENANT_ID;
    const name = (input.founderName && input.founderName.trim())
      || (input.companyName && input.companyName.trim())
      || "Founder";
    const tags = JSON.stringify(["invitation-sourced"]);

    db.prepare(
      `INSERT INTO investor_crm_contacts
         (id, tenant_id, investor_id, platform_user_id, name, role, email, affiliation,
          stage, tags, notes, note_log, tasks, starred, created_at, updated_at,
          company_id, company_name, founder_name, founder_email, sector, region,
          check_size_usd, notes_updated_at, deleted_at)
       VALUES
         (@id, @tenantId, @investorId, NULL, @name, 'founder', @founderEmail, @companyName,
          'invited', @tags, NULL, NULL, NULL, 0, @now, @now,
          @companyId, @companyName, @founderName, @founderEmail, NULL, NULL,
          NULL, NULL, NULL)`,
    ).run({
      id,
      tenantId,
      investorId: input.investorId,
      name,
      founderEmail: input.founderEmail ?? null,
      companyName: input.companyName ?? null,
      tags,
      now,
      companyId: input.companyId,
      founderName: input.founderName ?? null,
    });
    return id;
  } catch (err) {
    // Non-fatal — a redeem must never fail because of a CRM seed.
    log.warn("[investorCrmInvitationSeed.seedInvestorCrmFromInvitation] seed failed (non-fatal):", (err as Error).message);
    return null;
  }
}
