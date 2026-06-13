/**
 * Sprint 26 — Term-Sheet revision store + credentialed save endpoint.
 *
 * Patch v12 Day 2 Wave 2 (audit §3.14) — DB-BACKED.
 *
 * "Save using the highest credentials" requirements:
 *
 *   1. Authentication required — every write must carry a valid session cookie
 *      (cap_uid). Anonymous saves are rejected with 401.
 *
 *   2. Tamper-evident revision history — every save appends a new revision
 *      with a SHA-256 hash chained to the previous revision (Merkle-style).
 *      Each revision's `revisionHash = sha256(prevHash || canonicalBody)` so
 *      any tampering with an earlier revision invalidates the whole chain.
 *
 *   3. Audit trail — every save records `savedAt` (server timestamp),
 *      `savedBy` (session user id), and the full payload. The chain is
 *      independently verifiable via `verifyChain()`.
 *
 *   4. v12 DB-BACKED — revisions persist to `term_sheet_revisions`. The
 *      in-memory `revisionsByRound` Map is removed. Each save opens
 *      `db.transaction(...)` that reads the chainTip for the round,
 *      computes the next revision number + hash, and inserts atomically.
 *
 *   5. Signed records are LOCKED — once a revision has `signature` set, any
 *      further save against the same `roundId` is rejected with 409.
 *
 * Wire format follows Sprint 25's precision contract: all monetary / share
 * values inside the payload are strings; the server does not parse them as
 * numbers or coerce them.
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, asc, desc } from "drizzle-orm";
import { readSessionCookie } from "./lib/sessionCookie.js";
import { getDb } from "./db/connection";
import { termSheetRevisions as termSheetRevisionsTable } from "../shared/schema";
import { log } from "./lib/logger";
import { getRoundById } from "./roundsStore"; /* v25.19 Lane 1 NH2 */
import { getCompaniesForFounder } from "./multiCompanyStore"; /* v25.19 Lane 1 NH2 */
import { getUserContext } from "./lib/userContext"; /* v25.19 Lane 1 NH2 */

/* v25.19 Lane 1 NH2 — prior code only `requireAuth`-gated; any logged-in
   founder could read or write another company's term-sheet by supplying its
   roundId. We resolve the round→companyId and require ownership. */
async function assertRoundOwnership(req: Request, res: Response, roundId: string): Promise<boolean> {
  const ctx = await getUserContext(req);
  if (!ctx?.isAuthed) {
    res.status(401).json({ ok: false, error: "unauthenticated" });
    return false;
  }
  if (ctx.isAdmin) return true;
  const round = getRoundById(String(roundId));
  if (!round) {
    res.status(404).json({ ok: false, error: "round_not_found" });
    return false;
  }
  const owned = getCompaniesForFounder(ctx.userId);
  if (!owned.some((c) => c.companyId === round.companyId)) {
    res.status(403).json({ ok: false, error: "NOT_ROUND_OWNER" });
    return false;
  }
  return true;
}

/**
 * SectionDraft on the wire — mirrors the client's SectionDraft shape.
 */
export interface ServerClauseDescription {
  whatItMeans: string;
  whyItMatters: string;
  commonVariants?: string;
  founderWatchouts?: string;
  citation?: string;
}
export interface ServerSectionDraft {
  id: string;
  heading: string;
  body: string;
  edited: boolean;
  description?: ServerClauseDescription;
  descriptionEdited?: boolean;
}
export interface SaveTermSheetPayload {
  roundId: string;
  companyId: string;
  source: "generated" | "uploaded";
  region: string;
  instrument: string;
  templateId: string;
  templateName: string;
  sections: ServerSectionDraft[];
  citations: string[];
  status: "draft" | "signed";
  documentHash?: string;
  signature?: unknown;
  signedAt?: string;
  uploadFilename?: string;
  uploadMimeType?: string;
  extractedTerms?: unknown;
  reconciliation?: unknown;
  acknowledgedMismatches?: string[];
}

export interface TermSheetRevision {
  revision: number;            // 1-indexed per roundId
  roundId: string;
  companyId: string;
  savedAt: string;             // ISO timestamp (server)
  savedBy: string;             // session user id
  payload: SaveTermSheetPayload;
  prevRevisionHash: string;    // "GENESIS" for revision 1
  revisionHash: string;        // sha256 of prevHash || canonicalBody
}

function tenantForCompany(companyId: string): string {
  if (!companyId) return "tenant_unknown";
  if (companyId.startsWith("tenant_")) return companyId;
  return `tenant_co_${companyId}`;
}

function rowToRevision(r: any): TermSheetRevision {
  return {
    revision: r.revision,
    roundId: r.roundId,
    companyId: r.companyId,
    savedAt: r.savedAt,
    savedBy: r.savedBy,
    payload: JSON.parse(r.payloadJson) as SaveTermSheetPayload,
    prevRevisionHash: r.prevRevisionHash,
    revisionHash: r.revisionHash,
  };
}

/** Test-only reset — truncates the term_sheet_revisions table. */
export function clearTermSheetStore(): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.delete(termSheetRevisionsTable).run();
    });
  } catch (err) {
    log.warn("[termSheetStore.clearTermSheetStore] DB delete failed:", (err as Error).message);
  }
}

export function getRevisions(roundId: string): ReadonlyArray<TermSheetRevision> {
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(termSheetRevisionsTable)
      .where(eq(termSheetRevisionsTable.roundId, roundId))
      .orderBy(asc(termSheetRevisionsTable.revision))
      .all() as any[];
    return rows.map(rowToRevision);
  } catch (err) {
    log.warn("[termSheetStore.getRevisions] DB read failed:", (err as Error).message);
    return [];
  }
}

export function getLatestRevision(roundId: string): TermSheetRevision | undefined {
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(termSheetRevisionsTable)
      .where(eq(termSheetRevisionsTable.roundId, roundId))
      .orderBy(desc(termSheetRevisionsTable.revision))
      .limit(1)
      .all() as any[];
    return rows.length > 0 ? rowToRevision(rows[0]) : undefined;
  } catch (err) {
    log.warn("[termSheetStore.getLatestRevision] DB read failed:", (err as Error).message);
    return undefined;
  }
}

/**
 * Canonicalise the payload for hashing — stable JSON, sorted keys at every
 * level, no whitespace.
 */
function canonicalise(payload: SaveTermSheetPayload, meta: { savedAt: string; savedBy: string; revision: number }): string {
  function sort(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) out[k] = sort(o[k]);
      return out;
    }
    return v;
  }
  return JSON.stringify(sort({ payload, meta }));
}

export function computeRevisionHash(prevHash: string, canonical: string): string {
  return createHash("sha256").update(`${prevHash}|${canonical}`).digest("hex");
}

export type SaveResult =
  | { ok: true; revision: TermSheetRevision }
  | { ok: false; error: string; message?: string };

export function saveTermSheet(args: { payload: SaveTermSheetPayload; savedBy: string }): SaveResult {
  const { payload, savedBy } = args;
  if (!payload.roundId) return { ok: false, error: "missing_round_id" };
  if (!payload.companyId) return { ok: false, error: "missing_company_id" };
  if (!Array.isArray(payload.sections)) return { ok: false, error: "missing_sections" };

  let result: SaveResult | null = null;

  try {
    const db = getDb();
    // Patch v12 Day 2 Wave 2 — DB-7: chainTip + lock-check + INSERT all atomic.
    // Two parallel saves on the same round can never both succeed at revision N.
    db.transaction((tx: any) => {
      // Per-round chain tip.
      const tipRow = tx
        .select({
          revision: termSheetRevisionsTable.revision,
          revisionHash: termSheetRevisionsTable.revisionHash,
          payloadJson: termSheetRevisionsTable.payloadJson,
        })
        .from(termSheetRevisionsTable)
        .where(eq(termSheetRevisionsTable.roundId, payload.roundId))
        .orderBy(desc(termSheetRevisionsTable.revision))
        .limit(1)
        .all() as Array<{ revision: number; revisionHash: string; payloadJson: string }>;

      if (tipRow.length > 0) {
        const latestPayload = JSON.parse(tipRow[0].payloadJson) as SaveTermSheetPayload;
        if (latestPayload.status === "signed") {
          result = {
            ok: false,
            error: "termsheet_locked",
            message: "This term sheet is signed and locked. Saves are no longer accepted.",
          };
          return;
        }
      }

      const revisionNumber = (tipRow[0]?.revision ?? 0) + 1;
      const prevHash = tipRow[0]?.revisionHash ?? "GENESIS";
      const savedAt = new Date().toISOString();
      const canonical = canonicalise(payload, { savedAt, savedBy, revision: revisionNumber });
      const revisionHash = computeRevisionHash(prevHash, canonical);
      const id = `tsr_${randomBytes(8).toString("hex")}`;

      tx.insert(termSheetRevisionsTable)
        .values({
          id,
          tenantId: tenantForCompany(payload.companyId),
          roundId: payload.roundId,
          companyId: payload.companyId,
          revision: revisionNumber,
          savedAt,
          savedBy,
          payloadJson: JSON.stringify(payload),
          prevRevisionHash: prevHash,
          revisionHash,
        })
        .run();

      const revision: TermSheetRevision = {
        revision: revisionNumber,
        roundId: payload.roundId,
        companyId: payload.companyId,
        savedAt,
        savedBy,
        payload,
        prevRevisionHash: prevHash,
        revisionHash,
      };
      result = { ok: true, revision };
    });
  } catch (err) {
    log.error("[termSheetStore.saveTermSheet] DB write failed:", (err as Error).message);
    return { ok: false, error: "db_write_failed", message: (err as Error).message };
  }

  if (!result) return { ok: false, error: "transaction_yielded_no_result" };
  return result;
}

/**
 * Verify the integrity of the revision chain for a single round.
 * Recomputes every hash from GENESIS forward and ensures each matches.
 */
export function verifyChain(roundId: string): { ok: boolean; brokenAt?: number } {
  const xs = getRevisions(roundId);
  let prev = "GENESIS";
  for (let i = 0; i < xs.length; i++) {
    const r = xs[i];
    if (r.prevRevisionHash !== prev) return { ok: false, brokenAt: i + 1 };
    const canonical = canonicalise(r.payload, { savedAt: r.savedAt, savedBy: r.savedBy, revision: r.revision });
    const expected = computeRevisionHash(prev, canonical);
    if (expected !== r.revisionHash) return { ok: false, brokenAt: i + 1 };
    prev = r.revisionHash;
  }
  return { ok: true };
}

/** Lightweight hydrator — verifies schema is reachable. */
export async function hydrateTermSheetStore(): Promise<void> {
  try {
    const db = getDb();
    const rows = db.select({ id: termSheetRevisionsTable.id }).from(termSheetRevisionsTable).all() as any[];
    log.info(`[termSheetStore.hydrate] revisions=${rows.length}`);
  } catch (err) {
    log.warn("[termSheetStore.hydrate] DB read failed:", (err as Error).message);
  }
}

/* --------------------------------------------------------------------- */
/*  Routes                                                                 */
/* --------------------------------------------------------------------- */

function requireAuth(req: Request, res: Response, allowQueryFallback = false): { userId: string } | null {
  /* v14 — cookie remains the canonical production session source. The v14 test
   * harness shim (installV14TestIdentity) maps an x-user-id header onto
   * req.__v14_explicit_user_id so callers can opt-in to the harness identity
   * without re-enabling x-user-id reads in production code. */
  const explicit = (req as Request & { __v14ExplicitUserId?: string }).__v14ExplicitUserId;
  let userId: string | undefined = readSessionCookie(req) ?? explicit ?? undefined;
  if (!userId && allowQueryFallback && typeof req.query.userId === "string") {
    userId = req.query.userId;
  }
  if (!userId) {
    res.status(401).json({ ok: false, error: "unauthorized", message: "Sign in to save term sheets." });
    return null;
  }
  return { userId };
}

export function registerTermSheetRoutes(app: Express): void {
  app.post("/api/founder/term-sheets", async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const payload = (req.body ?? {}) as SaveTermSheetPayload;
    /* v25.19 Lane 1 NH2 — require round ownership on writes. */
    if (payload?.roundId && !(await assertRoundOwnership(req, res, String(payload.roundId)))) return;
    const r = saveTermSheet({ payload, savedBy: auth.userId });
    if (!r.ok) {
      const code = r.error === "termsheet_locked" ? 409 : 400;
      return res.status(code).json(r);
    }
    return res.json({ ok: true, revision: r.revision });
  });

  app.get("/api/founder/term-sheets/:roundId", async (req: Request, res: Response) => {
    const auth = requireAuth(req, res, true);
    if (!auth) return;
    const roundId = String(req.params.roundId);
    /* v25.19 Lane 1 NH2 — require round ownership on reads. */
    if (!(await assertRoundOwnership(req, res, roundId))) return;
    const latest = getLatestRevision(roundId);
    if (!latest) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, revision: latest, chainVerified: verifyChain(roundId).ok });
  });

  app.get("/api/founder/term-sheets/:roundId/history", async (req: Request, res: Response) => {
    const auth = requireAuth(req, res, true);
    if (!auth) return;
    const roundId = String(req.params.roundId);
    /* v25.19 Lane 1 NH2 — require round ownership on history reads. */
    if (!(await assertRoundOwnership(req, res, roundId))) return;
    const revisions = getRevisions(roundId);
    return res.json({ ok: true, revisions, chainVerified: verifyChain(roundId).ok });
  });
}
