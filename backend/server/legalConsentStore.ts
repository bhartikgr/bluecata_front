/**
 * Sprint 28 Legal — Append-only consent ledger.
 *
 * Hash-chained, audited, bridged. Every consent record is immutable once
 * written. Idempotent re-submission of the same (userId, docId, version)
 * returns the existing record without extending the chain.
 *
 * Endpoints:
 *   POST /api/legal/consent           — record consent for authenticated user
 *   GET  /api/legal/consent/mine      — calling user's own consent trail
 *   GET  /api/admin/legal/consents    — paginated admin read-only view (admin only)
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { resolvePersonaId } from "./lib/userContext";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import { LEGAL_VERSION } from "../client/src/lib/legalDocs";

// ─── Types ───────────────────────────────────────────────────────────────────

export type LegalDocId =
  | "privacy"
  | "terms"
  | "cookies"
  | "acceptable-use"
  | "disclaimer";

export type ConsentContext =
  | "signup"
  | "new_company"
  | "onboarding"
  | "settings_update";

export interface LegalConsent {
  id: string;                  // lc_<random>
  userId: string;
  documentId: LegalDocId;
  documentVersion: string;     // LEGAL_VERSION constant
  context: ConsentContext;
  acceptedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  prevHash: string;
  hash: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const VALID_DOC_IDS: LegalDocId[] = [
  "privacy",
  "terms",
  "cookies",
  "acceptable-use",
  "disclaimer",
];

const VALID_CONTEXTS: ConsentContext[] = [
  "signup",
  "new_company",
  "onboarding",
  "settings_update",
];

/** Append-only ledger — never modify entries after creation. */
const ledger: LegalConsent[] = [];
let chainTip = "0".repeat(64);

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function buildHash(prevHash: string, id: string, userId: string, documentId: string, documentVersion: string, acceptedAt: string): string {
  const snapshot = `${prevHash}|${id}|${userId}|${documentId}|${documentVersion}|${acceptedAt}`;
  return sha256(snapshot);
}

// ─── Core store operations ────────────────────────────────────────────────────

/** Record consent — idempotent on (userId, documentId, documentVersion). */
export function recordConsent(args: {
  userId: string;
  documentId: LegalDocId;
  context: ConsentContext;
  ipAddress: string | null;
  userAgent: string | null;
}): { consent: LegalConsent; isNew: boolean } {
  // Idempotency check: same (userId, docId, version) → return existing
  const existing = ledger.find(
    (e) =>
      e.userId === args.userId &&
      e.documentId === args.documentId &&
      e.documentVersion === LEGAL_VERSION,
  );
  if (existing) return { consent: existing, isNew: false };

  const id = `lc_${randomBytes(8).toString("hex")}`;
  const acceptedAt = new Date().toISOString();
  const prevHash = chainTip;
  const hash = buildHash(prevHash, id, args.userId, args.documentId, LEGAL_VERSION, acceptedAt);

  const entry: LegalConsent = {
    id,
    userId: args.userId,
    documentId: args.documentId,
    documentVersion: LEGAL_VERSION,
    context: args.context,
    acceptedAt,
    ipAddress: args.ipAddress,
    userAgent: args.userAgent,
    prevHash,
    hash,
  };

  ledger.push(entry);
  chainTip = hash;

  return { consent: entry, isNew: true };
}

export function getConsentsForUser(userId: string): LegalConsent[] {
  return ledger.filter((e) => e.userId === userId);
}

export function getAllConsents(): LegalConsent[] {
  return [...ledger];
}

/** Verify the append-only hash chain. Returns { ok, brokenAt }. */
export function verifyChain(): { ok: boolean; brokenAt: number } {
  let prev = "0".repeat(64);
  for (let i = 0; i < ledger.length; i++) {
    const e = ledger[i];
    if (e.prevHash !== prev) return { ok: false, brokenAt: i };
    const expected = buildHash(prev, e.id, e.userId, e.documentId, e.documentVersion, e.acceptedAt);
    if (e.hash !== expected) return { ok: false, brokenAt: i };
    prev = e.hash;
  }
  return { ok: true, brokenAt: -1 };
}

/** Test helper — reset the ledger. */
export const _testLegalConsent = {
  reset: () => {
    ledger.length = 0;
    chainTip = "0".repeat(64);
  },
  ledger,
  verifyChain,
};

// ─── Route registration ───────────────────────────────────────────────────────

export function registerLegalConsentRoutes(app: Express): void {
  /**
   * POST /api/legal/consent
   * Body: { documentIds: string[], context: string }
   * Auth: required — resolves userId from session/header.
   */
  app.post("/api/legal/consent", (req: Request, res: Response) => {
    const userId = resolvePersonaId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "unauthenticated" });
    }

    const { documentIds, context } = req.body ?? {};
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json({ ok: false, error: "documentIds must be a non-empty array" });
    }
    if (!context || !VALID_CONTEXTS.includes(context as ConsentContext)) {
      return res.status(400).json({ ok: false, error: `context must be one of: ${VALID_CONTEXTS.join(", ")}` });
    }

    const invalidIds = (documentIds as string[]).filter((id) => !VALID_DOC_IDS.includes(id as LegalDocId));
    if (invalidIds.length > 0) {
      return res.status(400).json({ ok: false, error: `invalid documentIds: ${invalidIds.join(", ")}` });
    }

    const ipAddress = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? null;
    const userAgent = req.headers["user-agent"] ?? null;

    const recorded: string[] = [];
    for (const docId of documentIds as LegalDocId[]) {
      const { consent, isNew } = recordConsent({
        userId,
        documentId: docId,
        context: context as ConsentContext,
        ipAddress,
        userAgent,
      });

      if (isNew) {
        // Audit log
        appendAdminAudit(userId, `consent:${consent.id}`, "legal_consent.recorded", {
          consentId: consent.id,
          userId,
          documentId: docId,
          documentVersion: LEGAL_VERSION,
          context,
          acceptedAt: consent.acceptedAt,
        });

        // Bridge event
        emitBridgeEvent({
          eventType: "legal_consent.recorded",
          aggregateId: consent.id,
          aggregateKind: "platform",
          tenantId: "tnt_capavate_us",
          actor: { userId, ip: ipAddress ?? undefined },
          payload: {
            consentId: consent.id,
            userId,
            documentId: docId,
            documentVersion: LEGAL_VERSION,
            context,
          },
        });
      }

      recorded.push(consent.id);
    }

    res.status(200).json({ ok: true, recorded });
  });

  /**
   * GET /api/legal/consent/mine
   * Returns the calling user's consent trail.
   */
  app.get("/api/legal/consent/mine", (req: Request, res: Response) => {
    const userId = resolvePersonaId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "unauthenticated" });
    }
    const consents = getConsentsForUser(userId);
    res.json({ ok: true, consents });
  });

  /**
   * GET /api/admin/legal/consents
   * Admin-only read-only paginated view of all consent records.
   */
  app.get("/api/admin/legal/consents", (req: Request, res: Response) => {
    const userId = resolvePersonaId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "unauthenticated" });
    }
    // Admin check — only personas with userId "u_admin" or x-admin-ses header
    const adminSes = req.headers["x-admin-ses"] as string | undefined;
    const isAdmin = userId === "u_admin" || (adminSes && adminSes.length >= 8);
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "admin only" });
    }

    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
    const all = getAllConsents();
    const total = all.length;
    const rows = all.slice((page - 1) * limit, page * limit).map((e) => ({
      id: e.id,
      userId: e.userId,
      documentId: e.documentId,
      documentVersion: e.documentVersion,
      context: e.context,
      acceptedAt: e.acceptedAt,
      ipAddress: e.ipAddress,
    }));

    res.json({ ok: true, total, page, limit, rows });
  });
}
