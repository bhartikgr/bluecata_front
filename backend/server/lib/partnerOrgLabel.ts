/**
 * server/lib/partnerOrgLabel.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.3 as corrected by v5 §D.
 *
 * THE PROBLEM. The Collective member directory renders every contact through
 * the privacy resolver in the `collectiveDirectory` context, whose default is
 * `visibleInCollectiveDirectory:false`. That is right for a natural person, but
 * a `consortium_partner` contact is an ORGANISATION: it has no natural-person
 * privacy interest, and its trading name is its public business identity. So
 * every partner in the directory rendered as "Private Investor" — an
 * organisation opted out of a preference it can never express.
 *
 * WHY NOT THE OBVIOUS FIX. v2/v3 of the strategy proposed routing partners
 * through `getConsortiumPartnerDisplayName()`. That reads `displayName` /
 * `legalName` off the same **contacts** row — i.e. potentially a natural
 * person's name — and would have re-shipped exactly the leak W3 #9 removed.
 * This module therefore never touches a contact or person display name at all.
 *
 * WHY NO `partner_team_members` HOP. v4 routed
 * `contact.id → partner_team_members.partner_id → partner_organizations.name`.
 * That hop is tautological: `consortiumApplyStore.ts:1000` mints ONE id and uses
 * it for both the `adminContacts` row and the `partner_organizations` row
 * (`createContact(..., preferredId)`, adminContactsStore.ts:514), so for a
 * `consortium_partner` contact `contact.id` IS the partner organization id. The
 * hop also adds a false negative — an organisation with no team rows yet would
 * fall back to "Private Investor" — and it is not even expressible, because
 * `partner_team_members` is runtime DDL in `partnerWorkspaceStore.ts` and is not
 * declared in `shared/schema.ts`. So we resolve DIRECTLY on the id.
 *
 * INVARIANTS (each has a test):
 *   • Labels ONLY when an ACTIVE `partner_organizations` row resolves.
 *   • Otherwise returns "Private Investor" — the same fail-closed default the
 *     directory already uses. Never null, never a raw `ac_…` id.
 *   • NEVER reads a contact / person display name, legal name or email.
 *   • Never mirrors `visibleToCoMembers` (default TRUE, a counterparty-context
 *     preference) onto this directory surface, which is governed by
 *     `visibleInCollectiveDirectory` (default FALSE).
 *   • Read-only, parameterised, `catch → "Private Investor"`.
 */
import { rawDb } from "../db/connection";
import { log } from "./logger";

/** The directory's existing fail-closed label. Never change this string lightly:
 *  the client and several tests key off it. */
export const PRIVATE_LABEL = "Private Investor";

export interface PartnerOrgLabelResult {
  /** The label to render. Always safe to show. */
  label: string;
  /** True only when an ACTIVE partner organization actually resolved. */
  resolved: boolean;
  /** Why it did not resolve — for diagnostics, never rendered. */
  reason?: "not_a_partner_contact" | "no_active_org" | "read_error" | "no_name";
}

/**
 * Resolve the display label for a `consortium_partner` contact.
 *
 * @param contactId the adminContacts row id, which for a consortium_partner IS
 *                  the `partner_organizations.id` (see module docs).
 * @param contactKind the contact's `kind`. Anything other than
 *                  `"consortium_partner"` is refused outright, so this can never
 *                  be pointed at an investor/person row by accident.
 */
export function resolvePartnerOrgLabel(
  contactId: string | null | undefined,
  contactKind: string | null | undefined,
): PartnerOrgLabelResult {
  if (contactKind !== "consortium_partner") {
    return { label: PRIVATE_LABEL, resolved: false, reason: "not_a_partner_contact" };
  }
  const id = (contactId ?? "").trim();
  if (!id) {
    return { label: PRIVATE_LABEL, resolved: false, reason: "no_active_org" };
  }
  try {
    // DIRECT resolution: partner_organizations.id = contact.id. `name` is
    // NOT NULL in the schema, but a whitespace-only value is still possible, so
    // an empty name is treated as unresolved rather than rendered blank.
    const row = rawDb()
      .prepare(
        `SELECT name FROM partner_organizations
          WHERE id = ? AND status = 'active'
          LIMIT 1`,
      )
      .get(id) as { name?: string } | undefined;
    if (!row) {
      return { label: PRIVATE_LABEL, resolved: false, reason: "no_active_org" };
    }
    const name = String(row.name ?? "").trim();
    if (!name) {
      return { label: PRIVATE_LABEL, resolved: false, reason: "no_name" };
    }
    return { label: name, resolved: true };
  } catch (err) {
    log.warn(
      "[partnerOrgLabel] partner_organizations read failed for",
      id,
      "-",
      (err as Error).message,
    );
    return { label: PRIVATE_LABEL, resolved: false, reason: "read_error" };
  }
}

/** Convenience wrapper for call sites that only need the string. */
export function partnerOrgLabel(
  contactId: string | null | undefined,
  contactKind: string | null | undefined,
): string {
  return resolvePartnerOrgLabel(contactId, contactKind).label;
}

export default partnerOrgLabel;
