/**
 * W3-B / C-5 — Investor accredited-investor SELF-DECLARATION capture.
 *
 * Individual-facing, fail-closed routes that let an authenticated user read the
 * current self-certification clause and submit a signed attestation. The
 * attestation is persisted APPEND-ONLY (never mutated) in
 * `investor_accreditation_declaration`, hash-chained per investor. A denormalized
 * fast-flag is mirrored onto the existing (non-sacred)
 * `investor_compliance_profile` via `upsertComplianceProfile` so the existing SPV
 * commit gate + gateStatus() stay consistent.
 *
 * Identity is ALWAYS taken from `req.userContext.userId` (set by requireAuth) — a
 * body-supplied investor id is never trusted.
 *
 * Routes:
 *   POST /api/investor/compliance/accreditation-declaration
 *   GET  /api/investor/compliance/accreditation-declaration
 *
 * Also exports the read helper the C-5 individual-membership gate consumes:
 *   getLatestDeclaration(userId), hasAccreditedDeclaration(userId),
 * and the shared capture helper reused by the Collective-application path:
 *   recordAccreditationDeclaration(userId, input).
 *
 * NOTE (corrected model): accreditation is a C-5 individual-MEMBERSHIP concern.
 * The C-4 founder-company application (founderCollectiveApplyStore.ts) has NO
 * accreditation gate and is intentionally untouched.
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { requireAuth } from "./lib/authMiddleware";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
import { appendAdminAudit } from "./adminPlatformStore";
import { spvEngineStore } from "./spvEngineStore";
import {
  ACCREDITATION_CLAUSE_VERSION,
  ACCREDITATION_CLAUSE_TEXT,
  ACCREDITATION_CLAUSE_ACK,
  ACCREDITATION_CRITERIA,
  ACCREDITATION_VALIDITY_DAYS,
} from "@shared/accreditationClause";

export interface AccreditationDeclarationRow {
  id: string;
  investorId: string;
  clauseVersion: string;
  criteria: string[];
  signatureName: string;
  signedAt: string;
  jurisdiction: string | null;
  createdAt: string;
}

function mapRow(r: any): AccreditationDeclarationRow {
  let criteria: string[] = [];
  try {
    const parsed = JSON.parse(r.criteria_json ?? "[]");
    if (Array.isArray(parsed)) criteria = parsed.map((c) => String(c));
  } catch { /* tolerate a malformed legacy blob → empty list */ }
  return {
    id: r.id,
    investorId: r.investor_id,
    clauseVersion: r.clause_version,
    criteria,
    signatureName: r.signature_name,
    signedAt: r.signed_at,
    jurisdiction: r.jurisdiction ?? null,
    createdAt: r.created_at,
  };
}

/** Latest attestation for an investor (append-only table ⇒ read the newest row). */
export function getLatestDeclaration(userId: string): AccreditationDeclarationRow | null {
  if (!userId) return null;
  const row = rawDb()
    .prepare(
      `SELECT * FROM investor_accreditation_declaration
        WHERE investor_id = ?
        ORDER BY signed_at DESC, rowid DESC
        LIMIT 1`,
    )
    .get(userId);
  return row ? mapRow(row) : null;
}

/**
 * C-5 read used by requireCollectiveMember. Throws are the CALLER's concern: the
 * gate wraps this so a read error is treated as "not declared" (deny in strict).
 *
 * GRACE semantics (rollout): an investor counts as having a valid declaration if
 * EITHER
 *   (a) they have a self-declaration row within the validity window, OR
 *   (b) their compliance profile already reads self_certified/verified (covers
 *       investors accredited before the capture path existed).
 * The whole accreditation sub-check is itself behind the SOFT-default
 * COLLECTIVE_C5_ACCRED_ENFORCE flag in the gate, so this only hard-denies once
 * an operator flips to strict.
 */
export function hasAccreditedDeclaration(userId: string): boolean {
  if (!userId) return false;
  const latest = getLatestDeclaration(userId);
  if (latest) {
    const signedMs = Date.parse(latest.signedAt);
    if (!Number.isNaN(signedMs)) {
      const ageDays = (Date.now() - signedMs) / (1000 * 60 * 60 * 24);
      if (ageDays <= ACCREDITATION_VALIDITY_DAYS) return true;
    } else {
      // Unparseable timestamp but a row exists → treat as present (grace).
      return true;
    }
  }
  // (b) denormalized fast-flag fallback.
  const prof = spvEngineStore.getComplianceProfile(userId);
  if (prof && (prof.accreditationStatus === "self_certified" || prof.accreditationStatus === "verified")) {
    return true;
  }
  return false;
}

/**
 * W2 A2 (v26.2.0-w2) — gate-facing accreditation status used by the Collective
 * first-sign-on capture. Unlike the boolean `hasAccreditedDeclaration`, this
 * distinguishes verified vs self_certified vs none and reports the source, so
 * the gate can (a) block only genuine "none" members and (b) never downgrade a
 * verified investor. Reads the SAME store path as `hasAccreditedDeclaration`
 * (compliance profile + latest declaration). Throws are the CALLER's concern:
 * the gate wraps this and fails CLOSED (deny) on a read error.
 */
export type AccreditationGateStatus = "none" | "self_certified" | "verified";

export function getAccreditationGateStatus(userId: string): {
  status: AccreditationGateStatus;
  signedCurrent: boolean;
  declaration: AccreditationDeclarationRow | null;
  source: "profile" | "declaration" | "none";
} {
  if (!userId) {
    return { status: "none", signedCurrent: false, declaration: null, source: "none" };
  }

  // Rule 1 — read the compliance profile through the same store path.
  const prof = spvEngineStore.getComplianceProfile(userId);
  const latest = getLatestDeclaration(userId);

  // Rule 2 — verified wins outright; never downgraded by a self-cert row.
  if (prof && prof.accreditationStatus === "verified") {
    return {
      status: "verified",
      signedCurrent: true,
      declaration: latest,
      source: "profile",
    };
  }

  // Rule 3 — profile self_certified.
  if (prof && prof.accreditationStatus === "self_certified") {
    return {
      status: "self_certified",
      signedCurrent: true,
      declaration: latest,
      source: "profile",
    };
  }

  // Rule 4 — else inspect the latest declaration + validity window.
  if (latest) {
    const signedMs = Date.parse(latest.signedAt);
    if (!Number.isNaN(signedMs)) {
      const ageDays = (Date.now() - signedMs) / (1000 * 60 * 60 * 24);
      if (ageDays <= ACCREDITATION_VALIDITY_DAYS) {
        return { status: "self_certified", signedCurrent: true, declaration: latest, source: "declaration" };
      }
    } else {
      // Legacy grace (mirrors hasAccreditedDeclaration): an unparseable signed
      // timestamp with a row present is treated as current. Preserved to avoid
      // behavior drift; logged so operators can spot bad timestamps.
      log.warn(
        "[getAccreditationGateStatus] unparseable signed_at for",
        userId,
        "- applying legacy grace (treated as self_certified).",
      );
      return { status: "self_certified", signedCurrent: true, declaration: latest, source: "declaration" };
    }
  }

  // Rule 5 — nothing current.
  return { status: "none", signedCurrent: false, declaration: latest, source: "none" };
}

export interface RecordDeclarationInput {
  signatureName: string;
  criteria: unknown;
  jurisdiction?: unknown;
}

export type RecordDeclarationResult =
  | { ok: true; declaration: AccreditationDeclarationRow }
  | { ok: false; error: string; message: string };

/**
 * Shared capture primitive — validates + persists an append-only, hash-chained
 * self-declaration row and mirrors the compliance fast-flag. Reused by BOTH the
 * dedicated POST route and the individual Collective-application path (so the
 * declaration is captured at apply time, mirroring W2's sign-at-application).
 *
 * Server-authoritative: the clause version and criterion ids come from the
 * served config, never from a client-supplied text blob.
 */
export function recordAccreditationDeclaration(
  userId: string,
  input: RecordDeclarationInput,
): RecordDeclarationResult {
  // Rule #13 — full legal name (typed signature) is MANDATORY.
  const signatureName = typeof input.signatureName === "string" ? input.signatureName.trim() : "";
  if (signatureName.length < 2) {
    return {
      ok: false,
      error: "SIGNATURE_REQUIRED",
      message: "Type your full legal name to sign the accreditation self-certification.",
    };
  }

  // At least one eligibility criterion must be checked, and every submitted id
  // must be a known criterion for the served clause version (server-authoritative).
  const knownIds = new Set(ACCREDITATION_CRITERIA.map((c) => c.id));
  const rawCriteria = Array.isArray(input.criteria) ? input.criteria : [];
  const criteria = rawCriteria.map((c) => String(c)).filter((c) => knownIds.has(c));
  if (criteria.length === 0) {
    return {
      ok: false,
      error: "CRITERIA_REQUIRED",
      message: "Select at least one eligibility criterion that applies to you.",
    };
  }

  const jurisdiction =
    typeof input.jurisdiction === "string" && input.jurisdiction.trim()
      ? input.jurisdiction.trim()
      : null;

  const id = `iad_${randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();
  const criteriaJson = JSON.stringify(criteria);

  let row: AccreditationDeclarationRow;
  try {
    const db = rawDb();
    // Per-investor hash chain over the append-only rows (tamper-evidence).
    const prevRow = db
      .prepare(
        `SELECT curr_hash FROM investor_accreditation_declaration
          WHERE investor_id = ? ORDER BY signed_at DESC, rowid DESC LIMIT 1`,
      )
      .get(userId) as { curr_hash?: string } | undefined;
    const prevHash = prevRow?.curr_hash ?? null;
    const currHash = createHash("sha256")
      .update([prevHash ?? "", id, userId, ACCREDITATION_CLAUSE_VERSION, criteriaJson, signatureName, now].join("|"))
      .digest("hex");

    db.prepare(
      `INSERT INTO investor_accreditation_declaration
         (id, investor_id, clause_version, criteria_json, signature_name, signed_at, jurisdiction, created_at, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, userId, ACCREDITATION_CLAUSE_VERSION, criteriaJson, signatureName, now, jurisdiction, now, prevHash, currHash);

    row = {
      id,
      investorId: userId,
      clauseVersion: ACCREDITATION_CLAUSE_VERSION,
      criteria,
      signatureName,
      signedAt: now,
      jurisdiction,
      createdAt: now,
    };
  } catch (err) {
    // Fail-closed: do not report success if the durable write failed.
    log.error("[investorCompliance] declaration persist failed:", (err as Error).message);
    return {
      ok: false,
      error: "DECLARATION_PERSIST_FAILED",
      message: "Could not record your certification; please retry.",
    };
  }

  // Mirror the denormalized fast-flag so gateStatus()/SPV commit gate agree.
  // Non-fatal: the declaration row is the source of truth.
  try {
    spvEngineStore.upsertComplianceProfile(userId, {
      accreditationStatus: "self_certified",
      accreditationCertifiedAt: now,
      ...(jurisdiction ? { jurisdiction } : {}),
    });
  } catch (err) {
    log.warn("[investorCompliance] compliance-profile mirror failed (non-fatal):", (err as Error).message);
  }

  try {
    appendAdminAudit(userId, "investor_accreditation_declaration", "accreditation_self_certified", {
      declarationId: row.id,
      clauseVersion: ACCREDITATION_CLAUSE_VERSION,
      criteria,
      jurisdiction,
    });
  } catch { /* audit is best-effort; never blocks the attestation */ }

  return { ok: true, declaration: row };
}

export function registerInvestorAccreditationRoutes(app: Express): void {
  // GET — the clause to display + this user's current declaration status.
  app.get("/api/investor/compliance/accreditation-declaration", requireAuth, (req: Request, res: Response) => {
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const userId = ctx?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    let latest: AccreditationDeclarationRow | null = null;
    let accredited = false;
    try {
      latest = getLatestDeclaration(userId);
      accredited = hasAccreditedDeclaration(userId);
    } catch (err) {
      // Fail-closed on the STATUS read: report not-accredited rather than crash.
      log.error("[investorCompliance.GET] declaration read failed (fail-closed):", (err as Error).message);
    }
    const signedCurrent = !!latest && latest.clauseVersion === ACCREDITATION_CLAUSE_VERSION;
    return res.json({
      ok: true,
      clause: {
        version: ACCREDITATION_CLAUSE_VERSION,
        text: ACCREDITATION_CLAUSE_TEXT,
        ack: ACCREDITATION_CLAUSE_ACK,
        criteria: ACCREDITATION_CRITERIA,
        validityDays: ACCREDITATION_VALIDITY_DAYS,
      },
      accredited,
      signedCurrent,
      declaration: latest,
    });
  });

  // POST — record a signed self-certification (append-only).
  app.post("/api/investor/compliance/accreditation-declaration", requireAuth, (req: Request, res: Response) => {
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const userId = ctx?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const body = (req.body ?? {}) as {
      signatureName?: unknown;
      criteria?: unknown;
      jurisdiction?: unknown;
    };

    const result = recordAccreditationDeclaration(userId, {
      signatureName: typeof body.signatureName === "string" ? body.signatureName : "",
      criteria: body.criteria,
      jurisdiction: body.jurisdiction,
    });

    if (!result.ok) {
      const status = result.error === "DECLARATION_PERSIST_FAILED" ? 500 : 400;
      return res.status(status).json(result);
    }
    return res.status(201).json({ ok: true, declaration: result.declaration });
  });
}

export default registerInvestorAccreditationRoutes;
