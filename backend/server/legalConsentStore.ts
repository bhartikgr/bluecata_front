/**
 * Sprint 28 Legal — Append-only consent ledger.
 *
 * Patch v12 Day 2 Wave 2 (audit §3.13) — DB-BACKED.
 *
 * The append-only ledger is now persisted to the `legal_consents` table.
 * No in-memory `ledger: LegalConsent[]` Map remains. Every `recordConsent`
 * call opens a `getDb().transaction(...)` that:
 *
 *   1. SELECTs the current chainTip for the tenant (deterministic by
 *      `ORDER BY accepted_at DESC, id DESC LIMIT 1`).
 *   2. Checks idempotency — if a row already exists for
 *      (tenantId, userId, documentId, documentVersion) we return it without
 *      extending the chain.
 *   3. Computes the new SHA-256 hash linking to prevHash.
 *   4. INSERTs the row.
 *
 * Reads are SELECT against the DB with `withTenant`-style filtering. The
 * test-only `_testLegalConsent.reset()` truncates the table for isolation.
 *
 * Hydration: lightweight — the boot-time hydrator only verifies the schema
 * is reachable; no in-memory Map needs filling.
 *
 * Endpoints (unchanged):
 *   POST /api/legal/consent
 *   GET  /api/legal/consent/mine
 *   GET  /api/admin/legal/consents
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, desc, asc } from "drizzle-orm";
import { resolvePersonaId } from "./lib/userContext";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import { LEGAL_VERSION } from "../client/src/lib/legalDocs";
import { getDb } from "./db/connection";
import { legalConsents as legalConsentsTable } from "../shared/schema";
import { log } from "./lib/logger";

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

/**
 * Single platform tenant for legal consents.
 *
 * Capavate legal documents are platform-wide (the Privacy/ToS bind every
 * user to Capavate, not to any specific company tenant). All consents
 * therefore chain into one tenant. v13 may split this if region-specific
 * legal terms diverge — the schema is already tenant-scoped, so a future
 * split is a config change, not a schema change.
 */
const DEFAULT_TENANT_ID = "tenant_platform";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function buildHash(prevHash: string, id: string, userId: string, documentId: string, documentVersion: string, acceptedAt: string): string {
  const snapshot = `${prevHash}|${id}|${userId}|${documentId}|${documentVersion}|${acceptedAt}`;
  return sha256(snapshot);
}

function rowToConsent(r: any): LegalConsent {
  return {
    id: r.id,
    userId: r.userId,
    documentId: r.documentId as LegalDocId,
    documentVersion: r.documentVersion,
    context: r.context as ConsentContext,
    acceptedAt: r.acceptedAt,
    ipAddress: r.ipAddress ?? null,
    userAgent: r.userAgent ?? null,
    prevHash: r.prevHash,
    hash: r.hash,
  };
}

// ─── Core store operations ────────────────────────────────────────────────────

/** Record consent — idempotent on (userId, documentId, documentVersion). */
export function recordConsent(args: {
  userId: string;
  documentId: LegalDocId;
  context: ConsentContext;
  ipAddress: string | null;
  userAgent: string | null;
  tenantId?: string;
}): { consent: LegalConsent; isNew: boolean } {
  const tenantId = args.tenantId ?? DEFAULT_TENANT_ID;

  let result: { consent: LegalConsent; isNew: boolean } | null = null;

  try {
    const db = getDb();
    // Patch v12 Day 2 Wave 2 — DB-6: BEGIN IMMEDIATE serialises concurrent
    // appenders on the per-tenant hash chain. Idempotency check + chainTip
    // read + INSERT all happen inside the same transaction so two parallel
    // posts of the same (userId, docId, version) can never both insert.
    // NOTE: no trailing `()` — Drizzle invokes the callback for us.
    db.transaction((tx: any) => {
      // 1. Idempotency check — same tenant+user+doc+version => existing
      const existingRows = tx
        .select()
        .from(legalConsentsTable)
        .where(and(
          eq(legalConsentsTable.tenantId, tenantId),
          eq(legalConsentsTable.userId, args.userId),
          eq(legalConsentsTable.documentId, args.documentId),
          eq(legalConsentsTable.documentVersion, LEGAL_VERSION),
          isNull(legalConsentsTable.deletedAt),
        ))
        .limit(1)
        .all() as any[];

      if (existingRows.length > 0) {
        result = { consent: rowToConsent(existingRows[0]), isNew: false };
        return;
      }

      // 2. Per-tenant chain tip
      // CROSS-TENANT (admin) — the chainTip read is intentionally scoped to a
      // SINGLE tenantId (the new row's own); we ignore deleted_at because the
      // consent ledger is append-only by contract.
      const tipRow = tx
        .select({ hash: legalConsentsTable.hash, acceptedAt: legalConsentsTable.acceptedAt })
        .from(legalConsentsTable)
        .where(eq(legalConsentsTable.tenantId, tenantId))
        .orderBy(desc(legalConsentsTable.acceptedAt), desc(legalConsentsTable.id))
        .limit(1)
        .all() as Array<{ hash: string }>;
      const prevHash = tipRow[0]?.hash ?? "0".repeat(64);

      // 3. Compute id + hash
      const id = `lc_${randomBytes(8).toString("hex")}`;
      const acceptedAt = new Date().toISOString();
      const hash = buildHash(prevHash, id, args.userId, args.documentId, LEGAL_VERSION, acceptedAt);

      // 4. INSERT
      tx.insert(legalConsentsTable)
        .values({
          id,
          tenantId,
          userId: args.userId,
          documentId: args.documentId,
          documentVersion: LEGAL_VERSION,
          context: args.context,
          acceptedAt,
          ipAddress: args.ipAddress,
          userAgent: args.userAgent,
          prevHash,
          hash,
          deletedAt: null,
        })
        .run();

      const consent: LegalConsent = {
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
      result = { consent, isNew: true };
    });
  } catch (err) {
    // We surface the failure loudly. There is no graceful in-memory fallback —
    // a consent that is not in the durable ledger MUST NOT be treated as recorded
    // by the route layer. The route handler will translate this into a 500.
    log.error("[legalConsentStore.recordConsent] DB write failed:", (err as Error).message);
    throw err;
  }

  if (!result) {
    throw new Error("legalConsentStore.recordConsent: transaction yielded no result");
  }
  return result;
}

/**
 * Returns all consents for a user. Reads directly from the DB and filters
 * out soft-deleted rows. `tenantId` is optional — when omitted the platform
 * tenant is used (current v12 behavior since all consents share one tenant).
 */
export function getConsentsForUser(userId: string, tenantId?: string): LegalConsent[] {
  const tid = tenantId ?? DEFAULT_TENANT_ID;
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(legalConsentsTable)
      .where(and(
        eq(legalConsentsTable.tenantId, tid),
        eq(legalConsentsTable.userId, userId),
        isNull(legalConsentsTable.deletedAt),
      ))
      .orderBy(asc(legalConsentsTable.acceptedAt))
      .all() as any[];
    return rows.map(rowToConsent);
  } catch (err) {
    log.warn("[legalConsentStore.getConsentsForUser] DB read failed:", (err as Error).message);
    return [];
  }
}

/**
 * Returns all consents across all users. Used by the admin paginated view.
 * Cross-tenant by design (admin platform read).
 */
export function getAllConsents(): LegalConsent[] {
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — admin dashboard intentionally reads every tenant.
    const rows = db
      .select()
      .from(legalConsentsTable)
      .where(isNull(legalConsentsTable.deletedAt))
      .orderBy(asc(legalConsentsTable.acceptedAt), asc(legalConsentsTable.id))
      .all() as any[];
    return rows.map(rowToConsent);
  } catch (err) {
    log.warn("[legalConsentStore.getAllConsents] DB read failed:", (err as Error).message);
    return [];
  }
}

/**
 * Verify the append-only hash chain across the entire platform tenant.
 * Returns { ok, brokenAt } — brokenAt is the index of the first inconsistent
 * row (0-based) or -1 if the chain is valid.
 */
export function verifyChain(): { ok: boolean; brokenAt: number } {
  const all = getAllConsents();
  let prev = "0".repeat(64);
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    if (e.prevHash !== prev) return { ok: false, brokenAt: i };
    const expected = buildHash(prev, e.id, e.userId, e.documentId, e.documentVersion, e.acceptedAt);
    if (e.hash !== expected) return { ok: false, brokenAt: i };
    prev = e.hash;
  }
  return { ok: true, brokenAt: -1 };
}

/**
 * Hydrator — required by hydrateStores.HYDRATE_ORDER. Since we read on
 * demand there is no Map to populate; we just confirm the schema is
 * reachable and emit a diagnostic on the live-row count so operators can
 * spot empty DBs immediately.
 */
export async function hydrateLegalConsentStore(): Promise<void> {
  try {
    const db = getDb();
    const rows = db
      .select({ id: legalConsentsTable.id })
      .from(legalConsentsTable)
      .where(isNull(legalConsentsTable.deletedAt))
      .all() as any[];
    if (rows.length > 0) {
      log.info(`[hydrate] legalConsentStore: ${rows.length} live consents in ledger`);
    }
  } catch (err) {
    log.warn("[hydrate] legalConsentStore: DB read failed:", (err as Error).message);
  }
}

/** Test helper — reset the ledger. */
export const _testLegalConsent = {
  reset: () => {
    try {
      const db = getDb();
      // Test-only DELETE; production has no caller for this helper. Wrap in
      // raw .run() so it bypasses Drizzle's where requirement.
      db.delete(legalConsentsTable).run();
    } catch (err) {
      log.warn("[legalConsentStore._testLegalConsent.reset] DB reset failed:", (err as Error).message);
    }
  },
  // Maintained for backward-compatibility with v11 tests that expected to
  // read the in-memory array. Returns a fresh snapshot.
  get ledger() { return getAllConsents(); },
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
      let outcome: { consent: LegalConsent; isNew: boolean };
      try {
        outcome = recordConsent({
          userId,
          documentId: docId,
          context: context as ConsentContext,
          ipAddress,
          userAgent,
        });
      } catch (err) {
        return res.status(500).json({ ok: false, error: "consent_ledger_unavailable", message: (err as Error).message });
      }
      const { consent, isNew } = outcome;

      if (isNew) {
        // Audit log — lands in audit_log via Wave 1 DB-backed appendAdminAudit.
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
