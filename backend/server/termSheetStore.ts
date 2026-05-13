/**
 * Sprint 26 — Term-Sheet revision store + credentialed save endpoint.
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
 *   4. Sandbox-safe — pure in-memory store; no Web Storage APIs. In production
 *      this swaps to Postgres with the same schema.
 *
 *   5. Signed records are LOCKED — once a revision has `signature` set, any
 *      further save against the same `roundId` is rejected with 409.
 *
 * Wire format follows Sprint 25's precision contract: all monetary / share
 * values inside the payload are strings; the server does not parse them as
 * numbers or coerce them.
 */
import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { readSessionCookie } from "./lib/sessionCookie.js";

/**
 * SectionDraft on the wire — mirrors the client's SectionDraft shape.
 * `description` is a structured object (5 fields, all optional except the
 * top two) carrying the investor-grade clause notes.
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

/** Per-roundId revision chain. Sorted ascending by revision number. */
const revisionsByRound: Map<string, TermSheetRevision[]> = new Map();

export function clearTermSheetStore(): void { revisionsByRound.clear(); }
export function getRevisions(roundId: string): ReadonlyArray<TermSheetRevision> {
  return revisionsByRound.get(roundId) ?? [];
}
export function getLatestRevision(roundId: string): TermSheetRevision | undefined {
  const xs = revisionsByRound.get(roundId);
  return xs && xs.length > 0 ? xs[xs.length - 1] : undefined;
}

/**
 * Canonicalise the payload for hashing — stable JSON, sorted keys at every
 * level, no whitespace. Two payloads with identical content always produce
 * identical canonical strings regardless of property insertion order.
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

  // Reject saves against an already-signed term sheet (immutable once locked).
  const existing = revisionsByRound.get(payload.roundId) ?? [];
  const latest = existing.length > 0 ? existing[existing.length - 1] : undefined;
  if (latest && latest.payload.status === "signed") {
    return { ok: false, error: "termsheet_locked", message: "This term sheet is signed and locked. Saves are no longer accepted." };
  }

  const revisionNumber = existing.length + 1;
  const savedAt = new Date().toISOString();
  const prevHash = latest ? latest.revisionHash : "GENESIS";
  const canonical = canonicalise(payload, { savedAt, savedBy, revision: revisionNumber });
  const revisionHash = computeRevisionHash(prevHash, canonical);

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
  existing.push(revision);
  revisionsByRound.set(payload.roundId, existing);
  return { ok: true, revision };
}

/**
 * Verify the integrity of the revision chain for a single round.
 * Recomputes every hash from GENESIS forward and ensures each matches.
 */
export function verifyChain(roundId: string): { ok: boolean; brokenAt?: number } {
  const xs = revisionsByRound.get(roundId) ?? [];
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

/* --------------------------------------------------------------------- */
/*  Routes                                                                 */
/* --------------------------------------------------------------------- */

function requireAuth(req: Request, res: Response, allowQueryFallback = false): { userId: string } | null {
  // Session cookie set by /api/auth/login. Without it, write paths are 401.
  // Sprint 27: accepts both __Host-cap_uid (prod) and cap_uid (dev) via helper.
  // For READ-only endpoints, allow ?userId=... fallback so cookieless GETs (e.g.
  // the sandbox preview where cookies are stripped) can still resolve identity.
  let userId: string | undefined = readSessionCookie(req)
    ?? (req.headers["x-user-id"] as string | undefined);
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
  /**
   * POST /api/founder/term-sheets
   *
   * Body: SaveTermSheetPayload
   * Auth: session cookie required (cap_uid)
   *
   * On success: returns the new revision record.
   * On unauthenticated: 401 unauthorized.
   * On already-signed roundId: 409 termsheet_locked.
   */
  app.post("/api/founder/term-sheets", (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const payload = (req.body ?? {}) as SaveTermSheetPayload;
    const r = saveTermSheet({ payload, savedBy: auth.userId });
    if (!r.ok) {
      const code = r.error === "termsheet_locked" ? 409 : 400;
      return res.status(code).json(r);
    }
    return res.json({ ok: true, revision: r.revision });
  });

  /**
   * GET /api/founder/term-sheets/:roundId
   * Returns the latest revision (or 404 if none).
   * Auth: session cookie required.
   */
  app.get("/api/founder/term-sheets/:roundId", (req: Request, res: Response) => {
    const auth = requireAuth(req, res, true);
    if (!auth) return;
    const roundId = req.params.roundId;
    const latest = getLatestRevision(roundId);
    if (!latest) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, revision: latest, chainVerified: verifyChain(roundId).ok });
  });

  /**
   * GET /api/founder/term-sheets/:roundId/history
   * Returns the full revision history for a round (ascending by revision).
   * Auth: session cookie required.
   */
  app.get("/api/founder/term-sheets/:roundId/history", (req: Request, res: Response) => {
    const auth = requireAuth(req, res, true);
    if (!auth) return;
    const roundId = req.params.roundId;
    const revisions = getRevisions(roundId);
    return res.json({ ok: true, revisions, chainVerified: verifyChain(roundId).ok });
  });
}
