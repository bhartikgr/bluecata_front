/**
 * Round Carry-Forward Routes — Sprint Patch 2
 *
 * Two endpoints:
 *   GET  /api/founder/companies/:companyId/carry-forward?roundType=safe|note|priced_equity
 *     Returns the CarryForwardResult for a proposed new round.
 *     READ-ONLY: pure computation, no state mutations.
 *     Returns 403 if user doesn't own the company.
 *     Returns 404 if company doesn't exist.
 *
 *   POST /api/founder/rounds/:roundId/carry-forward/accept
 *     Records the founder's decision (accept or override) for each suggested field.
 *     Appends an audit log entry, hash-chained to the previous entry.
 *     Returns the audit log entry id.
 *
 * Both routes require authentication via requireAuth.
 *
 * All monetary and share values are strings (investor-grade precision contract).
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { requireAuth } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import { companies } from "./mockData";
import {
  computeCarryForwardLive,
  type RoundType,
  type CarryForwardResult,
} from "./roundCarryForwardEngine";

// ─── Audit log ────────────────────────────────────────────────────────────

export interface AcceptedField {
  fieldName: string;
  suggestedValue: unknown;
  /** Same as suggestedValue when accepted; different value when overridden. */
  acceptedValue: unknown;
}

export interface OverriddenField {
  fieldName: string;
  suggestedValue: unknown;
  acceptedValue: unknown;
  overrideReason: string;
}

export interface CarryForwardAuditEntry {
  id: string;
  roundId: string;
  companyId: string;
  actor: string;
  timestamp: string;
  acceptedFields: AcceptedField[];
  overriddenFields: OverriddenField[];
  /** SHA-256 of the CarryForwardResult that was presented to the founder. */
  auditDigest: string;
  /** SHA-256 hash of this entry, chained to the previous entry. */
  entryHash: string;
  prevEntryHash: string;
}

/** In-memory audit log. In production: backed by append-only Postgres table. */
const auditLog: CarryForwardAuditEntry[] = [];
let lastEntryHash = "CARRY_FORWARD_GENESIS";

function computeEntryHash(prevHash: string, entry: Omit<CarryForwardAuditEntry, "entryHash">): string {
  const canonical = stableStringify({ ...entry, prevEntryHash: prevHash });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + (value as unknown[]).map(stableStringify).join(",") + "]";
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

export function getCarryForwardAuditLog(): ReadonlyArray<CarryForwardAuditEntry> {
  return auditLog;
}

export function clearCarryForwardAuditLog(): void {
  auditLog.length = 0;
  lastEntryHash = "CARRY_FORWARD_GENESIS";
}

export function appendCarryForwardAuditEntry(
  params: {
    roundId: string;
    companyId: string;
    actor: string;
    acceptedFields: AcceptedField[];
    overriddenFields: OverriddenField[];
    auditDigest: string;
  },
): CarryForwardAuditEntry {
  const partial: Omit<CarryForwardAuditEntry, "entryHash"> = {
    id: randomBytes(12).toString("hex"),
    roundId: params.roundId,
    companyId: params.companyId,
    actor: params.actor,
    timestamp: new Date().toISOString(),
    acceptedFields: params.acceptedFields,
    overriddenFields: params.overriddenFields,
    auditDigest: params.auditDigest,
    prevEntryHash: lastEntryHash,
  };
  const entryHash = computeEntryHash(lastEntryHash, partial);
  const entry: CarryForwardAuditEntry = { ...partial, entryHash };
  auditLog.push(entry);
  lastEntryHash = entryHash;
  return entry;
}

// ─── Route registration ───────────────────────────────────────────────────

export function registerRoundCarryForwardRoutes(app: Express): void {
  /**
   * GET /api/founder/companies/:companyId/carry-forward?roundType=safe|note|priced_equity
   *
   * Returns a carry-forward suggestion object for the proposed new round.
   * PURE READ — no state mutations.
   */
  app.get(
    "/api/founder/companies/:companyId/carry-forward",
    requireAuth,
    (req: Request, res: Response) => {
      const { companyId } = req.params;
      const roundType = req.query["roundType"] as string | undefined;

      // Auth: must own the company (requireAuth already checked session)
      const ctx = getUserContext(req);
      const ownsCompany =
        ctx?.founder.companies.some((c) => c.companyId === companyId) ?? false;
      if (!ownsCompany && !ctx?.isAdmin) {
        return res.status(403).json({
          ok: false,
          error: "FORBIDDEN",
          message: "You do not own this company.",
        });
      }

      // B-301 fix v23.4.13: graceful empty carry-forward
      // Newly created companies are not in the static seed `companies` array.
      // Return 200 + empty-but-valid result shape (NOT null) so the client's
      // `Object.keys(result.fields)` reducer keeps working. v23.4.13 follow-up
      // (L-012 fix): use the full CarryForwardResult shape instead of null to
      // avoid "Cannot convert undefined or null to object" on the wizard.
      const company = companies.find((c) => c.id === companyId);

      // Validate roundType (do this BEFORE the new-company shortcut so we keep
      // returning 400 for malformed requests on both paths).
      const validTypes: RoundType[] = ["safe", "note", "priced_equity"];
      if (!roundType || !validTypes.includes(roundType as RoundType)) {
        return res.status(400).json({
          ok: false,
          error: "INVALID_ROUND_TYPE",
          message: `roundType query param must be one of: ${validTypes.join(", ")}`,
        });
      }

      if (!company) {
        const emptyResult: CarryForwardResult = {
          companyId,
          proposedRoundType: roundType as RoundType,
          computedAt: new Date().toISOString(),
          fields: {},
          unrealizedInstruments: [],
          warnings: ["New company — no prior rounds to carry forward."],
          auditDigest: "",
        };
        return res.status(200).json({ ok: true, result: emptyResult });
      }

      const result: CarryForwardResult = computeCarryForwardLive({
        companyId,
        proposedRoundType: roundType as RoundType,
      });

      return res.status(200).json({ ok: true, result });
    },
  );

  /**
   * POST /api/founder/rounds/:roundId/carry-forward/accept
   *
   * Body: {
   *   companyId: string,
   *   auditDigest: string,           — digest of the suggestion shown to the founder
   *   acceptedFields: Array<{ fieldName, suggestedValue, acceptedValue }>,
   *   overriddenFields: Array<{ fieldName, suggestedValue, acceptedValue, overrideReason }>
   * }
   *
   * Appends an audit log entry. Returns the entry id.
   */
  app.post(
    "/api/founder/rounds/:roundId/carry-forward/accept",
    requireAuth,
    (req: Request, res: Response) => {
      const { roundId } = req.params;
      const body = req.body ?? {};

      const { companyId, auditDigest, acceptedFields, overriddenFields } = body as {
        companyId?: string;
        auditDigest?: string;
        acceptedFields?: AcceptedField[];
        overriddenFields?: OverriddenField[];
      };

      // Validate required fields
      if (!companyId || typeof companyId !== "string") {
        return res.status(400).json({ ok: false, error: "MISSING_COMPANY_ID" });
      }
      if (!auditDigest || typeof auditDigest !== "string") {
        return res.status(400).json({ ok: false, error: "MISSING_AUDIT_DIGEST" });
      }
      if (!Array.isArray(acceptedFields)) {
        return res.status(400).json({ ok: false, error: "MISSING_ACCEPTED_FIELDS" });
      }
      if (!Array.isArray(overriddenFields)) {
        return res.status(400).json({ ok: false, error: "MISSING_OVERRIDDEN_FIELDS" });
      }

      // Auth: must own the company
      const ctx = getUserContext(req);
      const ownsCompany =
        ctx?.founder.companies.some((c) => c.companyId === companyId) ?? false;
      if (!ownsCompany && !ctx?.isAdmin) {
        return res.status(403).json({
          ok: false,
          error: "FORBIDDEN",
          message: "You do not own this company.",
        });
      }

      // Validate override reasons are present for every overridden field
      for (const override of overriddenFields) {
        if (!override.fieldName || !override.overrideReason) {
          return res.status(400).json({
            ok: false,
            error: "INVALID_OVERRIDE",
            message: "Each overridden field must include fieldName and overrideReason.",
          });
        }
      }

      const actor =
        ctx?.identity.email ?? `founder:${companyId}`; /* v14 — no x-actor-email header */

      const entry = appendCarryForwardAuditEntry({
        roundId,
        companyId,
        actor,
        acceptedFields,
        overriddenFields,
        auditDigest,
      });

      return res.status(201).json({
        ok: true,
        auditEntryId: entry.id,
        entryHash: entry.entryHash,
        prevEntryHash: entry.prevEntryHash,
        timestamp: entry.timestamp,
      });
    },
  );
}
