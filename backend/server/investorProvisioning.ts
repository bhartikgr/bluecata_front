/**
 * server/investorProvisioning.ts — v25.56 Avi wave item 2 (NON-sacred).
 *
 * When a round invitation is redeemed, the investor gets a synthetic persona
 * (`u_redeemed_<ts>`, minted in sacred userContext.ts) but their investor
 * profile was only ever *synthesised blank* on first GET (empty firstName /
 * lastName / email). That blank contact then fails the strict
 * `investorContactSchema` (names `.min(1)`, `email().email()`) on autosave, and
 * the stored blank email trips the read-only-email 403 when the form submits a
 * real email.
 *
 * Fix (escalation-free — no sacred edit): at redemption we write a POPULATED
 * durable investor-profile row (firstName / lastName / email taken from the
 * invitation record) into the existing `profilestore_investor_profile` table,
 * then re-hydrate the in-memory profile Map (via the exported hydrateProfileStore)
 * so the GET route serves the populated profile instead of re-synthesising a
 * blank one. This also resolves the KYC-upload 404 (item 1b), because the
 * `investorProfiles.get(id)` lookup in the sacred KYC POST now succeeds.
 *
 * We deliberately do NOT weaken the schema (rule #13 first+last required) —
 * provisioning supplies real names from the invitation.
 */
import { rawDb } from "./db/connection";
import { hydrateProfileStore } from "./profileStore";
import { makeEmptyInvestorProfile } from "./lib/emptyInvestorProfile";
import { SEED_INVESTOR_PROFILE } from "../client/src/lib/profile/seed";
import { log } from "./lib/logger";

/** Split a full display name into first/last, best-effort. */
export function splitInvestorName(name: string | null | undefined): { firstName: string; lastName: string } {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Provision a populated durable investor profile for a freshly-redeemed
 * investor, then re-hydrate the profile Map so the live endpoints resolve it.
 *
 * Idempotent: if a durable row already exists for `investorId` we leave it
 * untouched (never clobber investor edits with invitation defaults).
 * Non-fatal: any failure is logged and swallowed — redemption must still
 * succeed even if provisioning cannot write.
 */
export async function provisionRedeemedInvestorProfile(args: {
  investorId: string;
  email: string;
  name?: string | null;
}): Promise<void> {
  const { investorId, email } = args;
  if (!investorId) return;
  try {
    const db = rawDb();

    // Idempotency: don't overwrite an existing (possibly edited) profile.
    const existing = db
      .prepare(
        `SELECT investor_id FROM profilestore_investor_profile WHERE investor_id = ? AND deleted_at IS NULL`,
      )
      .get(investorId) as { investor_id?: string } | undefined;
    if (existing?.investor_id) {
      // Ensure the Map reflects the durable row and stop.
      await hydrateProfileStore();
      return;
    }

    const { firstName, lastName } = splitInvestorName(args.name);
    // Start from the schema-complete blank profile the GET route would have
    // synthesised (same tenant), then overlay the invitation identity so the
    // stored contact is valid and the stored email matches the invitation.
    const profile = makeEmptyInvestorProfile(investorId, SEED_INVESTOR_PROFILE.tenantId, email);
    profile.contact = {
      ...profile.contact,
      firstName,
      lastName,
      email: email ?? "",
    };

    // Same UPSERT the sacred profileStore.writeInvestorProfileDurable uses — we
    // write directly (rather than editing the sacred file to export it) to keep
    // this path fully NON-sacred.
    db.prepare(
      `INSERT INTO profilestore_investor_profile (investor_id, profile_json, updated_at, deleted_at)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(investor_id) DO UPDATE SET
         profile_json = excluded.profile_json,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    ).run(investorId, JSON.stringify(profile), new Date().toISOString());

    // Overlay the new durable row into the in-memory Map so GET/PATCH/KYC-POST
    // resolve it immediately (without waiting for a server restart).
    await hydrateProfileStore();
  } catch (err) {
    log.warn("[investorProvisioning] provisionRedeemedInvestorProfile failed (non-fatal):", (err as Error).message);
  }
}
