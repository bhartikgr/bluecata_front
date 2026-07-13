/**
 * 1c (v26.1.x Consortium Partner QA) — SPV launch sign-off store (NON-sacred).
 *
 * Records an institutional-grade electronic attestation captured BEFORE an SPV
 * is launched from the Consortium Partner SPV Engine. This is the "verifiable
 * and recorded" evidence that the acting GP affirmed the vehicle's terms under
 * an ESIGN/UETA-style attestation:
 *   - typed full legal name (wet-signature equivalent)
 *   - explicit checkbox assent to a VERSIONED attestation text
 *   - UTC timestamp + the authenticated signer's identity (session only)
 *   - IP / user-agent audit trail
 *
 * SACRED: this file touches no sacred store. It writes its OWN additive table
 * `spv_launch_signoffs` (migration 0108, mirrored + self-healed in
 * connection.ts) via rawDb. It NEVER touches Airwallex/payments or the
 * cap-table ledger (captableCommitStore).
 */
import { randomBytes } from "node:crypto";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

/**
 * The canonical, versioned attestation text shown to and agreed by the signer.
 * VERSIONED so the exact wording that was assented to is provable. If the copy
 * ever changes, bump ATTESTATION_VERSION and add the new text — never mutate a
 * shipped version in place.
 */
export const ATTESTATION_VERSION = "v1";
export const ATTESTATION_TEXT_V1 =
  "I certify that I am authorized to launch this special-purpose vehicle on " +
  "behalf of this Consortium Partner. I confirm that the information entered " +
  "— including jurisdiction, legal structure, mandate, fees, carry, and terms " +
  "— is accurate and complete to the best of my knowledge. I understand this " +
  "action creates a recorded, timestamped commitment on the Capavate " +
  "platform, and I consent to the use of my electronic signature as the legal " +
  "equivalent of a handwritten signature under applicable e-signature law " +
  "(ESIGN/UETA).";

export interface SpvLaunchSignoff {
  id: string;
  partnerId: string;
  spvId: string;
  userId: string;
  signerLegalName: string;
  signerSubRole: string | null;
  attestationText: string;
  attestationVersion: string;
  signedAt: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

function newId(): string {
  return `sof_${randomBytes(10).toString("hex")}`;
}

/**
 * Persist a launch sign-off. `signerLegalName` MUST be a non-empty typed full
 * legal name (rule #13 — a real name is always captured). Returns the stored
 * record.
 *
 * FAIL-CLOSED (1c): the sign-off must be VERIFIABLE and RECORDED. If the durable
 * INSERT fails, this THROWS `SIGNOFF_PERSIST_FAILED` — it does NOT swallow the
 * error and return an in-memory record. The caller is responsible for ensuring
 * an SPV is never left created without a durable sign-off (see the route: the
 * sign-off is written inside the same DB transaction as SPV creation, so a
 * throw here rolls the SPV back).
 */
export function recordSignoff(input: {
  partnerId: string;
  spvId: string;
  userId: string;
  signerLegalName: string;
  signerSubRole?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): SpvLaunchSignoff {
  const now = new Date().toISOString();
  const rec: SpvLaunchSignoff = {
    id: newId(),
    partnerId: String(input.partnerId),
    spvId: String(input.spvId ?? ""),
    userId: String(input.userId),
    signerLegalName: String(input.signerLegalName).trim(),
    signerSubRole: input.signerSubRole ?? null,
    attestationText: ATTESTATION_TEXT_V1,
    attestationVersion: ATTESTATION_VERSION,
    signedAt: now,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    createdAt: now,
  };
  try {
    rawDb()
      .prepare(
        `INSERT INTO spv_launch_signoffs
           (id, partner_id, spv_id, user_id, signer_legal_name, signer_sub_role,
            attestation_text, attestation_version, signed_at, ip, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.id, rec.partnerId, rec.spvId, rec.userId, rec.signerLegalName,
        rec.signerSubRole, rec.attestationText, rec.attestationVersion,
        rec.signedAt, rec.ip, rec.userAgent, rec.createdAt,
      );
  } catch (err) {
    // FAIL-CLOSED: do not swallow. A launch without a durable sign-off is not
    // acceptable (the sign-off is the legal record of authorization).
    log.warn("[spvLaunchSignoffStore.recordSignoff] durable persist FAILED:", (err as Error).message);
    throw new Error("SIGNOFF_PERSIST_FAILED");
  }
  return rec;
}

/**
 * 1c fail-closed helper: link a durable sign-off row to the real SPV id after
 * the SPV is created. The sign-off is recorded FIRST (so a persist failure
 * throws before any SPV exists); this second step attaches the true spvId.
 * A failure here is non-fatal (the sign-off is already durably recorded and
 * partner-scoped); we log and continue so a successful launch is not undone by
 * a link-update hiccup. Returns true on success.
 */
export function linkSignoffToSpv(signoffId: string, spvId: string): boolean {
  try {
    rawDb()
      .prepare(`UPDATE spv_launch_signoffs SET spv_id = ? WHERE id = ?`)
      .run(String(spvId), String(signoffId));
    return true;
  } catch (err) {
    log.warn("[spvLaunchSignoffStore.linkSignoffToSpv] link failed (continuing):", (err as Error).message);
    return false;
  }
}

/** List sign-offs for a given SPV (most recent first). Partner-scoped by the
 *  caller (route passes the session partnerId); this is a defensive AND. */
export function listSignoffsForSpv(partnerId: string, spvId: string): SpvLaunchSignoff[] {
  try {
    const rows = rawDb()
      .prepare(
        `SELECT * FROM spv_launch_signoffs
          WHERE partner_id = ? AND spv_id = ?
          ORDER BY signed_at DESC`,
      )
      .all(String(partnerId), String(spvId)) as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  } catch (err) {
    log.warn("[spvLaunchSignoffStore.listSignoffsForSpv] read failed:", (err as Error).message);
    return [];
  }
}

function mapRow(row: Record<string, unknown>): SpvLaunchSignoff {
  return {
    id: String(row.id),
    partnerId: String(row.partner_id),
    spvId: String(row.spv_id ?? ""),
    userId: String(row.user_id),
    signerLegalName: String(row.signer_legal_name),
    signerSubRole: row.signer_sub_role != null ? String(row.signer_sub_role) : null,
    attestationText: String(row.attestation_text),
    attestationVersion: String(row.attestation_version),
    signedAt: String(row.signed_at),
    ip: row.ip != null ? String(row.ip) : null,
    userAgent: row.user_agent != null ? String(row.user_agent) : null,
    createdAt: String(row.created_at),
  };
}
