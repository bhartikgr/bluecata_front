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
import { and, eq, isNull, desc, asc, sql } from "drizzle-orm";
import { resolvePersonaId } from "./lib/userContext";
/* WAVE 22 · ITEM 2 (REVIEW B F-3, the one the reviewer called out by name) —
 * a consent record whose IP evidence the consenting party can forge with one
 * header has no evidentiary value, which is the entire point of the record.
 * Resolution goes through the single hardened resolver used by the limiters. */
import { resolveRateLimitClientIp } from "./lib/rateLimit";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import { LEGAL_VERSION } from "../client/src/lib/legalDocs";
/* WAVE 210 — the version identity a consent row records.
 *
 * BEFORE THIS WAVE `recordConsent` hard-coded the imported `LEGAL_VERSION` in
 * four places: the idempotency SELECT, the chain hash, the INSERT and the
 * returned object. A caller could not name the version it had displayed even if
 * it wanted to — version identity was not merely wrong, it was structurally
 * unexpressible. Meanwhile `/terms-of-service` served a DIFFERENT document with
 * a different date and no version at all, so a user read one text and their
 * consent row attested to another.
 *
 * `resolveActiveLegalCorpusVersion` reads the served version from
 * `platform_config` (hash-chained, undeletable history, atomically audited).
 * `LEGAL_VERSION` is deliberately still imported and still exported below: it is
 * the version every PRE-WAVE-210 row names, those rows are a record, and nothing
 * here rewrites them. Added beside, never rewritten. */
import {
  readActiveLegalCorpusVersion as resolveActiveLegalCorpusVersion,
  ensureLegalCorpusVersionKey,
} from "./lib/wave210LegalCorpusVersionStore";
import {
  isKnownLegalCorpusVersion,
  KNOWN_LEGAL_CORPUS_VERSIONS,
  ADOPTED_LEGAL_CORPUS_VERSION,
  ADOPTED_LEGAL_CORPUS_DATE_LABEL,
  SUPERSEDED_LEGAL_CORPUS_VERSIONS,
} from "../shared/wave210LegalCorpusVersion";
import { fitToGate, boundedFragment } from "../shared/refusalHeadlineGate";
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

/**
 * WAVE 210 — the version a consent row will name.
 *
 * Precedence: an explicitly supplied version (the caller displayed it and says
 * so) → the version `platform_config` says is served → the adopted version.
 * There is no path that yields undefined, empty or null: `document_version` is
 * `NOT NULL` in the schema and a consent that does not name the text it attests
 * to is worthless as a record. An unrecognised explicit version is REFUSED
 * rather than coerced, because silently recording a different version than the
 * one displayed is the exact defect this wave repairs.
 */
export function resolveConsentDocumentVersion(explicit?: string | null): string {
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    if (!isKnownLegalCorpusVersion(explicit)) {
      throw new Error(`unknown_legal_corpus_version:${explicit}`);
    }
    return explicit;
  }
  return resolveActiveLegalCorpusVersion();
}

/**
 * WAVE 210 — the refusal shown when a caller declares a version we do not know.
 *
 * Built through `fitToGate()` because the client's `looksHuman` gate in
 * `client/src/lib/queryClient.ts` discards any message of 240 characters or
 * more, and a refusal the user never sees is a silent failure. The version
 * string is caller-supplied and therefore unbounded, so it is the fragment that
 * gets budgeted. Measured in a wave-210 test rather than eyeballed.
 */
export function legalCorpusVersionRefusal(requested: string): string {
  return fitToGate((budget) => {
    const shown = boundedFragment(requested, budget);
    return `We cannot record your agreement against version “${shown}” because no legal document on this platform carries that version. The versions we can record are ${KNOWN_LEGAL_CORPUS_VERSIONS.join(", ")}. Nothing was written.`;
  });
}

/** Record consent — idempotent on (userId, documentId, documentVersion). */
export function recordConsent(args: {
  userId: string;
  documentId: LegalDocId;
  context: ConsentContext;
  ipAddress: string | null;
  userAgent: string | null;
  tenantId?: string;
  /* WAVE 210 — the version of the text ACTUALLY DISPLAYED to this user.
   * Optional so that no existing caller breaks; when omitted the served version
   * is read from `platform_config` rather than assumed from a constant. */
  documentVersion?: string | null;
}): { consent: LegalConsent; isNew: boolean } {
  const tenantId = args.tenantId ?? DEFAULT_TENANT_ID;
  const documentVersion = resolveConsentDocumentVersion(args.documentVersion);

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
          eq(legalConsentsTable.documentVersion, documentVersion),
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
        // OWNWAVE TRIAGE (c): tie-break on rowid (insertion order), NOT on the
        // random `id`. `accepted_at` is only millisecond-precise, so two
        // consents recorded in the same ms (e.g. privacy+terms at signup) tie;
        // with a random tie-break the "tip" could be an earlier row, forking
        // the append-only chain and making verifyChain() report broken.
        .orderBy(desc(legalConsentsTable.acceptedAt), sql`rowid desc`)
        .limit(1)
        .all() as Array<{ hash: string }>;
      const prevHash = tipRow[0]?.hash ?? "0".repeat(64);

      // 3. Compute id + hash
      const id = `lc_${randomBytes(8).toString("hex")}`;
      const acceptedAt = new Date().toISOString();
      const hash = buildHash(prevHash, id, args.userId, args.documentId, documentVersion, acceptedAt);

      // 4. INSERT
      tx.insert(legalConsentsTable)
        .values({
          id,
          tenantId,
          userId: args.userId,
          documentId: args.documentId,
          documentVersion,
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
        documentVersion,
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
      .orderBy(asc(legalConsentsTable.acceptedAt), sql`rowid asc`)
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
      // Insertion order (rowid), not random-id order — the ledger is a hash
      // chain, so the read order MUST match the order the rows were appended
      // even when `accepted_at` ties to the millisecond. See recordConsent.
      .orderBy(asc(legalConsentsTable.acceptedAt), sql`rowid asc`)
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
  /* WAVE 210 — seed `legal.corpus.active_version` once, at route registration.
   * Idempotent: `ensurePlatformConfigKey` returns any existing row untouched, so
   * a version an operator has deliberately moved is never overwritten by a boot.
   * Wrapped because a config-store failure must not stop the consent routes from
   * registering — the version read has its own fail-safe. */
  try {
    ensureLegalCorpusVersionKey("wave210");
  } catch (err) {
    log.warn("[wave210] could not seed legal.corpus.active_version:", (err as Error).message);
  }

  /**
   * WAVE 210 — GET /api/legal/corpus/active
   *
   * PUBLIC and unauthenticated, deliberately: the served legal documents are
   * public, so which version is served is public too. This is the endpoint that
   * lets a legal page state its own version identity, and it is what closes the
   * loop the wave exists to close — the page names a version, the consent row
   * names the same version.
   *
   * It returns the superseded register as well. Nothing is deleted: a version
   * that stops being served does not stop being a version rows attest to.
   */
  app.get("/api/legal/corpus/active", (_req: Request, res: Response) => {
    const activeVersion = resolveActiveLegalCorpusVersion();
    res.status(200).json({
      ok: true,
      activeVersion,
      adoptedVersion: ADOPTED_LEGAL_CORPUS_VERSION,
      adoptedDateLabel: ADOPTED_LEGAL_CORPUS_DATE_LABEL,
      supersededVersions: SUPERSEDED_LEGAL_CORPUS_VERSIONS,
      knownVersions: KNOWN_LEGAL_CORPUS_VERSIONS,
    });
  });

  /**
   * WAVE 210 — GET /api/legal/consent/acknowledgement
   *
   * THE RE-CONSENT DECISION, AS AN ENDPOINT. This route reports whether the
   * signed-in user has ever recorded a consent naming the version now served. It
   * is a READ. It never blocks, never refuses and never gates a route: a 500
   * here must leave the platform fully usable, which is why every failure path
   * returns `needsAcknowledgement: false`.
   *
   * WHY NOT A BLOCKING RE-CONSENT GATE. The adopted corpus IS the text the
   * signup consent already attested to, with the party-name spelling corrected
   * and two clauses that disclose MORE, not less. No user's rights are reduced,
   * so the legal trigger for compelled re-consent is absent. A blocking
   * interstitial on every existing user's next login is the most disruptive
   * change available and the owner asked us not to break anything. The
   * acknowledgement still records WHICH VERSION was accepted, so the trail is
   * complete either way — that is the part that actually mattered.
   */
  app.get("/api/legal/consent/acknowledgement", (req: Request, res: Response) => {
    const activeVersion = resolveActiveLegalCorpusVersion();
    const userId = resolvePersonaId(req);
    if (!userId) {
      return res.status(200).json({ ok: true, activeVersion, needsAcknowledgement: false, acknowledgedVersions: [] });
    }
    try {
      const mine = getConsentsForUser(userId);
      const acknowledgedVersions = Array.from(new Set(mine.map((c) => c.documentVersion)));
      return res.status(200).json({
        ok: true,
        activeVersion,
        adoptedDateLabel: ADOPTED_LEGAL_CORPUS_DATE_LABEL,
        acknowledgedVersions,
        /* Only ever true for a user who HAS a consent trail and whose trail does
         * not include the served version. A user with no trail at all is not
         * nagged here — the signup consent owns that case. */
        needsAcknowledgement: mine.length > 0 && !acknowledgedVersions.includes(activeVersion),
      });
    } catch (err) {
      log.warn("[wave210] acknowledgement read failed:", (err as Error).message);
      return res.status(200).json({ ok: true, activeVersion, needsAcknowledgement: false, acknowledgedVersions: [] });
    }
  });

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

    const { documentIds, context, documentVersion } = req.body ?? {};
    /* WAVE 210 — an OPTIONAL declaration by the caller of the version it
     * displayed. Refused when unrecognised: recording a version no document
     * corresponds to would be worse than recording none, because it would look
     * like evidence. When absent the served version is read from
     * `platform_config` rather than assumed. A consent row can therefore never
     * fail to name a version. */
    if (documentVersion !== undefined && documentVersion !== null && !isKnownLegalCorpusVersion(documentVersion)) {
      return res.status(400).json({
        ok: false,
        error: "unknown_legal_corpus_version",
        message: legalCorpusVersionRefusal(String(documentVersion)),
      });
    }
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

    /* WAVE 22 · ITEM 2 (REVIEW B F-3) — was: leftmost `x-forwarded-for`, i.e.
     * whatever the caller typed. Now: trusted-hop resolution, fail-closed to
     * the socket peer when no `TRUSTED_PROXY_HOPS` is configured. */
    const ipAddress = resolveRateLimitClientIp(req);
    const userAgent = req.headers["user-agent"] ?? null;

    const recorded: string[] = [];
    /* WAVE 210 — seeded from the resolver so the response is correct even when
     * `documentIds` is empty; every row in one POST names the same version. */
    let writtenVersion: string = resolveConsentDocumentVersion(
      typeof documentVersion === "string" ? documentVersion : null,
    );
    for (const docId of documentIds as LegalDocId[]) {
      let outcome: { consent: LegalConsent; isNew: boolean };
      try {
        outcome = recordConsent({
          userId,
          documentId: docId,
          context: context as ConsentContext,
          ipAddress,
          userAgent,
          documentVersion: typeof documentVersion === "string" ? documentVersion : null,
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
          /* WAVE 210 — the version ACTUALLY WRITTEN to the row, not a constant.
           * The audit trail and the ledger must agree or neither is evidence. */
          documentVersion: consent.documentVersion,
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
            documentVersion: consent.documentVersion,
            context,
          },
        });
      }

      recorded.push(consent.id);
      writtenVersion = consent.documentVersion;
    }

    /* WAVE 210 — `recorded` keeps its existing shape (an array of consent ids);
     * other suites assert that and it is not this wave's to change. The version
     * actually written is reported BESIDE it, as a new field, so a caller can
     * verify that what it displayed is what the ledger now names. */
    res.status(200).json({ ok: true, recorded, documentVersion: writtenVersion });
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
