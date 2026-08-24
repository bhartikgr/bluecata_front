/**
 * WAVE 106 — the ONE derivation of an external LP's investor id from an email.
 *
 * `POST /api/partner/me/spv/:spvId/lp-commit` seats an off-platform LP under a
 * deterministic id derived from their email, so that a re-commit of the same
 * person is idempotent rather than a second holder. That derivation used to be
 * inline in the route only, which is why the roster read had no way to walk
 * backwards from a subscription row to the human who was typed into the form.
 *
 * It lives here so that WRITER and READER agree by construction. Change this
 * function and every existing `ext_*` id changes with it — so do not.
 *
 * NORMALISATION: trim, then lower-case. Email is case-insensitive in its domain
 * part by standard and case-insensitive in practice in its local part for every
 * provider this platform deals with; treating "  Ozan@Capavate.com " and
 * "ozan@capavate.com" as two different limited partners is how one human ends up
 * holding two positions in the same vehicle.
 */
import { createHash } from "node:crypto";

/** Trim + lower-case. The single normal form for LP email comparison. */
export function normaliseLpEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * The deterministic investor id for an off-platform LP identified by email.
 * Returns "" for an unusable email — callers must refuse rather than seat an
 * LP under a hash of the empty string.
 */
export function lpInvestorIdForEmail(email: unknown): string {
  const normalised = normaliseLpEmail(email);
  if (!normalised) return "";
  return `ext_${createHash("sha256").update(normalised, "utf8").digest("hex").slice(0, 16)}`;
}

/**
 * WAVE 112 · FINDING 3 — the ONE derivation of an LP commitment's ledger
 * invitation id, for the same reason `lpInvestorIdForEmail` lives here.
 *
 * THE DEFECT THIS SERVES. `POST /api/partner/me/spv/:spvId/lp-commit` writes the
 * LP identity row (status `committed`) BEFORE it writes the sacred cap-table
 * ledger entry, and there is no transaction spanning the two stores. If the
 * ledger write fails, the identity row still says `committed` and no money
 * exists behind it — an LP rendered as committed while holding $0 (B-38,
 * Reviewer B). No rollback can be fabricated across a store this wave may not
 * edit, so the READ side is made unable to show a commitment without its ledger
 * entry: `GET .../lp-roster` looks the ledger up under this id.
 *
 * That makes the reader depend on the writer's key shape. Two inline copies of
 * this template is exactly how a reader silently stops finding the ledger line
 * and the roster starts lying again, so there is one copy and it is here.
 *
 * BYTE-COMPATIBILITY. The route already trimmed and lower-cased the email
 * before hashing it, so `sha256(normaliseLpEmail(e))` reproduces every
 * invitation id ever written. Change this function and every existing ledger
 * lookup breaks — so do not.
 *
 * Returns "" for an unusable email or spv id; callers must refuse rather than
 * look up a hash of the empty string.
 */
export function lpCommitInvitationId(spvId: unknown, email: unknown): string {
  const id = typeof spvId === "string" ? spvId.trim() : "";
  const normalised = normaliseLpEmail(email);
  if (!id || !normalised) return "";
  const stableKey = createHash("sha256").update(normalised, "utf8").digest("hex").slice(0, 16);
  return `spvlp_${id}_${stableKey}`;
}
