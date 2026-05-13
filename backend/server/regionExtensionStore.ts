/**
 * Sprint 28 Wave 5 — Region Extension Store
 *
 * Fully-audited, hash-chained store for proposed and promoted new regions.
 * The frozen 9 canonical regions (US,CA,UK,SG,HK,CN,IN,JP,AU) stay frozen
 * in client/src/lib/regions.ts — this store handles ONLY NEW additions.
 *
 * Workflow: research → draft → review → approved → live
 *          any non-terminal → rejected | archived
 *          terminal: live, rejected, archived
 *
 * Key invariants:
 *  - Code must not collide with the frozen 9 or any existing extension.
 *  - Hash chain (SHA-256, prev=64 zeros for v1) on every extension.
 *  - Every mutation requires header `x-confirm: true` (double-verify-before-apply).
 *  - Every state transition calls appendAdminAudit + emitBridgeEvent.
 *  - research→draft requires ≥3 primarySources AND non-empty legalBasisSummary.
 *  - draft→review requires ≥1 proposedFormula.
 *  - review→approved requires reviewerNotes set.
 *  - approved→live is irreversible; after it, GET /api/regions returns 10+ entries.
 */

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import { REGIONS_ALL } from "../client/src/lib/regions";

/* ============================================================
 * Type definitions
 * ============================================================ */

export type RegionStatus =
  | "research"
  | "draft"
  | "review"
  | "approved"
  | "live"
  | "rejected"
  | "archived";

const TERMINAL_STATUSES: ReadonlySet<RegionStatus> = new Set([
  "live",
  "rejected",
  "archived",
]);

const VALID_TRANSITIONS: Record<RegionStatus, RegionStatus[]> = {
  research: ["draft", "rejected", "archived"],
  draft: ["review", "rejected", "archived"],
  review: ["approved", "rejected", "archived"],
  approved: ["live", "rejected", "archived"],
  live: [],
  rejected: [],
  archived: [],
};

export interface RegionResearch {
  legalBasisSummary: string;
  primarySources: Array<{ label: string; url: string }>;
  recommendedSAFE: boolean;
  recommendedConvertibleNote: boolean;
  recommendedEquity: boolean;
  taxResidencyNotes: string;
  esopFrameworkNotes: string;
  antiDilutionNotes: string;
  vestingDefaultMonths: number;
  vestingCliffMonths: number;
  filingAgencyName: string;
  signatureLawName: string;
}

export interface ProposedFormula {
  id: string;
  category: string;
  name: string;
  definition: string;
  citationSource: string;
  citationUrl: string;
}

export interface RegionDraft {
  code: string;
  name: string;
  jurisdictionLabel: string;
  currency: string;
  flag: string;
  defaultLegalEntityType: string;
  defaultIncorporationDocs: string[];
  proposedFormulas: ProposedFormula[];
  pricingMultiplier: number;
  defaultSubscriptionCurrency: string;
  termSheetTemplateRefs: string[];
}

export interface RegionExtension {
  id: string;
  status: RegionStatus;
  code: string;
  name: string;
  research: RegionResearch;
  draft: RegionDraft | null;
  reviewerNotes: string;
  approvedAt: string | null;
  approvedBy: string | null;
  liveAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
}

export interface RegionRevision {
  extensionId: string;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  changedBy: string;
  changedAt: string;
  snapshot: RegionExtension;
}

/* ============================================================
 * In-memory store
 * ============================================================ */

const extensions: RegionExtension[] = [];
const revisionHistory: Map<string, RegionRevision[]> = new Map();

/* ============================================================
 * Helpers
 * ============================================================ */

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const ZERO_HASH = "0".repeat(64);

function computeRevisionHash(ext: Omit<RegionExtension, "revisionHash">): string {
  const body = JSON.stringify({
    id: ext.id,
    version: ext.version,
    prevRevisionHash: ext.prevRevisionHash,
    status: ext.status,
    code: ext.code,
    name: ext.name,
    updatedAt: ext.updatedAt,
    updatedBy: ext.updatedBy,
    research: ext.research,
    draft: ext.draft,
    reviewerNotes: ext.reviewerNotes,
  });
  return sha256(body);
}

/** The codes of the canonical frozen 9 */
const FROZEN_CODES = new Set(REGIONS_ALL.map((r) => r.code.toUpperCase()));

function getActorFromRequest(req: Request): string {
  const ses = req.headers["x-admin-ses"] as string | undefined;
  const userId = req.headers["x-user-id"] as string | undefined;
  return ses ?? userId ?? "u_admin";
}

function requireConfirm(req: Request, res: Response, proposedChange: unknown): boolean {
  const confirm = req.headers["x-confirm"];
  if (confirm === "true") return true;
  res.status(409).json({
    error: "confirmation_required",
    message: "Send the same request with header `x-confirm: true` to apply.",
    proposedChange,
  });
  return false;
}

function addRevision(ext: RegionExtension, changedBy: string): void {
  if (!revisionHistory.has(ext.id)) revisionHistory.set(ext.id, []);
  revisionHistory.get(ext.id)!.push({
    extensionId: ext.id,
    version: ext.version,
    prevRevisionHash: ext.prevRevisionHash,
    revisionHash: ext.revisionHash,
    changedBy,
    changedAt: ext.updatedAt,
    snapshot: JSON.parse(JSON.stringify(ext)),
  });
}

/* ============================================================
 * Public test access hook
 * ============================================================ */

export const _testRegionExtensions = {
  getAll: () => extensions,
  getHistory: (id: string) => revisionHistory.get(id) ?? [],
  reset: () => {
    extensions.length = 0;
    revisionHistory.clear();
  },
};

/* ============================================================
 * CRUD operations
 * ============================================================ */

/** Build the list of regions available at runtime: frozen 9 + live extensions */
export function getRuntimeRegions(): Array<{
  code: string;
  name: string;
  jurisdiction: string;
  currency: string;
  flag: string;
  source: "canonical" | "extension";
}> {
  const canonical = REGIONS_ALL.map((r) => ({
    code: r.code,
    name: r.name,
    jurisdiction: r.jurisdiction,
    currency: r.currency,
    flag: r.flag,
    source: "canonical" as const,
  }));

  const live = extensions
    .filter((e) => e.status === "live" && e.draft !== null)
    .map((e) => ({
      code: e.draft!.code,
      name: e.draft!.name,
      jurisdiction: e.draft!.jurisdictionLabel,
      currency: e.draft!.currency,
      flag: e.draft!.flag,
      source: "extension" as const,
    }));

  return [...canonical, ...live];
}

function createExtension(
  code: string,
  name: string,
  createdBy: string
): RegionExtension {
  const id = `rex_${randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();

  const emptyResearch: RegionResearch = {
    legalBasisSummary: "",
    primarySources: [],
    recommendedSAFE: false,
    recommendedConvertibleNote: false,
    recommendedEquity: false,
    taxResidencyNotes: "",
    esopFrameworkNotes: "",
    antiDilutionNotes: "",
    vestingDefaultMonths: 48,
    vestingCliffMonths: 12,
    filingAgencyName: "",
    signatureLawName: "",
  };

  const partial: Omit<RegionExtension, "revisionHash"> = {
    id,
    status: "research",
    code: code.toUpperCase(),
    name,
    research: emptyResearch,
    draft: null,
    reviewerNotes: "",
    approvedAt: null,
    approvedBy: null,
    liveAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    version: 1,
    prevRevisionHash: ZERO_HASH,
  };

  const revisionHash = computeRevisionHash(partial);
  const ext: RegionExtension = { ...partial, revisionHash };

  extensions.push(ext);
  addRevision(ext, createdBy);

  appendAdminAudit(createdBy, `region:${id}`, "region.proposed", {
    id,
    code: ext.code,
    name: ext.name,
    status: "research",
  });

  emitBridgeEvent({
    eventType: "region.proposed",
    aggregateId: id,
    aggregateKind: "platform",
    actor: { userId: createdBy },
    payload: { extensionId: id, code: ext.code, name: ext.name },
  });

  return ext;
}

function patchExtension(
  id: string,
  patch: { research?: Partial<RegionResearch>; draft?: Partial<RegionDraft> | null; name?: string },
  updatedBy: string
): RegionExtension | { error: string } {
  const ext = extensions.find((e) => e.id === id);
  if (!ext) return { error: "not_found" };

  if (TERMINAL_STATUSES.has(ext.status)) {
    return { error: "terminal_status", message: `Cannot modify a region in ${ext.status} status` };
  }

  const prevHash = ext.revisionHash;
  const now = new Date().toISOString();

  if (patch.name !== undefined) ext.name = patch.name;
  if (patch.research) ext.research = { ...ext.research, ...patch.research };
  if (patch.draft !== undefined) {
    if (patch.draft === null) {
      ext.draft = null;
    } else {
      ext.draft = ext.draft ? { ...ext.draft, ...patch.draft } : (patch.draft as RegionDraft);
    }
  }

  ext.version += 1;
  ext.updatedAt = now;
  ext.updatedBy = updatedBy;
  ext.prevRevisionHash = prevHash;
  ext.revisionHash = computeRevisionHash({
    id: ext.id,
    status: ext.status,
    code: ext.code,
    name: ext.name,
    research: ext.research,
    draft: ext.draft,
    reviewerNotes: ext.reviewerNotes,
    approvedAt: ext.approvedAt,
    approvedBy: ext.approvedBy,
    liveAt: ext.liveAt,
    createdAt: ext.createdAt,
    updatedAt: ext.updatedAt,
    createdBy: ext.createdBy,
    updatedBy: ext.updatedBy,
    version: ext.version,
    prevRevisionHash: ext.prevRevisionHash,
  });

  addRevision(ext, updatedBy);

  appendAdminAudit(updatedBy, `region:${id}`, "region.research_updated", {
    extensionId: id,
    version: ext.version,
    patchKeys: Object.keys(patch),
  });

  return ext;
}

function transitionExtension(
  id: string,
  to: RegionStatus,
  actor: string,
  reviewerNotes?: string
): RegionExtension | { error: string; reason?: string } {
  const ext = extensions.find((e) => e.id === id);
  if (!ext) return { error: "not_found" };

  const allowed = VALID_TRANSITIONS[ext.status];
  if (!allowed.includes(to)) {
    return {
      error: "invalid_transition",
      reason: `Cannot transition from '${ext.status}' to '${to}'. Allowed: ${allowed.join(", ") || "none (terminal)"}`,
    };
  }

  // Guard: research → draft
  if (ext.status === "research" && to === "draft") {
    if (ext.research.primarySources.length < 3) {
      return { error: "transition_blocked", reason: "At least 3 primarySources required to move from research to draft." };
    }
    if (!ext.research.legalBasisSummary.trim()) {
      return { error: "transition_blocked", reason: "legalBasisSummary must not be empty to move from research to draft." };
    }
  }

  // Guard: draft → review
  if (ext.status === "draft" && to === "review") {
    if (!ext.draft || ext.draft.proposedFormulas.length < 1) {
      return { error: "transition_blocked", reason: "At least 1 proposedFormula required to submit for review." };
    }
    const d = ext.draft;
    if (!d.name.trim() || !d.code.trim() || !d.jurisdictionLabel.trim() || !d.currency.trim()) {
      return { error: "transition_blocked", reason: "Draft fields (name, code, jurisdictionLabel, currency) must be non-empty." };
    }
  }

  // Guard: review → approved
  if (ext.status === "review" && to === "approved") {
    const notes = reviewerNotes ?? ext.reviewerNotes;
    if (!notes.trim()) {
      return { error: "transition_blocked", reason: "reviewerNotes must be set before approval." };
    }
  }

  const prevHash = ext.revisionHash;
  const now = new Date().toISOString();

  ext.status = to;
  if (reviewerNotes !== undefined) ext.reviewerNotes = reviewerNotes;
  if (to === "approved") {
    ext.approvedAt = now;
    ext.approvedBy = actor;
  }
  if (to === "live") {
    ext.liveAt = now;
  }
  ext.version += 1;
  ext.updatedAt = now;
  ext.updatedBy = actor;
  ext.prevRevisionHash = prevHash;
  ext.revisionHash = computeRevisionHash({
    id: ext.id,
    status: ext.status,
    code: ext.code,
    name: ext.name,
    research: ext.research,
    draft: ext.draft,
    reviewerNotes: ext.reviewerNotes,
    approvedAt: ext.approvedAt,
    approvedBy: ext.approvedBy,
    liveAt: ext.liveAt,
    createdAt: ext.createdAt,
    updatedAt: ext.updatedAt,
    createdBy: ext.createdBy,
    updatedBy: ext.updatedBy,
    version: ext.version,
    prevRevisionHash: ext.prevRevisionHash,
  });

  addRevision(ext, actor);

  // Audit event type mapping
  const auditEventMap: Partial<Record<RegionStatus, string>> = {
    draft: "region.drafted",
    review: "region.review_submitted",
    approved: "region.approved",
    live: "region.gone_live",
    rejected: "region.rejected",
    archived: "region.archived",
  };
  const auditEvent = auditEventMap[to] ?? `region.transitioned_to_${to}`;

  appendAdminAudit(actor, `region:${id}`, auditEvent, {
    extensionId: id,
    from: ext.status === to ? "(previous)" : ext.status,
    to,
    version: ext.version,
  });

  // Bridge events for specific transitions
  const bridgeEventMap: Partial<Record<RegionStatus, "region.proposed" | "region.review_submitted" | "region.approved" | "region.gone_live" | "region.rejected">> = {
    review: "region.review_submitted",
    approved: "region.approved",
    live: "region.gone_live",
    rejected: "region.rejected",
  };
  const bridgeEvent = bridgeEventMap[to];
  if (bridgeEvent) {
    emitBridgeEvent({
      eventType: bridgeEvent,
      aggregateId: id,
      aggregateKind: "platform",
      actor: { userId: actor },
      payload: {
        extensionId: id,
        code: ext.code,
        name: ext.name,
        status: to,
        version: ext.version,
      },
    });
  }

  return ext;
}

function verifyChain(id: string): { ok: boolean; brokenAt: number; totalLinks: number } {
  const history = revisionHistory.get(id) ?? [];
  let prior = ZERO_HASH;
  for (let i = 0; i < history.length; i++) {
    const rev = history[i];
    if (rev.prevRevisionHash !== prior) return { ok: false, brokenAt: i, totalLinks: history.length };
    const expected = computeRevisionHash({
      id: rev.snapshot.id,
      status: rev.snapshot.status,
      code: rev.snapshot.code,
      name: rev.snapshot.name,
      research: rev.snapshot.research,
      draft: rev.snapshot.draft,
      reviewerNotes: rev.snapshot.reviewerNotes,
      approvedAt: rev.snapshot.approvedAt,
      approvedBy: rev.snapshot.approvedBy,
      liveAt: rev.snapshot.liveAt,
      createdAt: rev.snapshot.createdAt,
      updatedAt: rev.snapshot.updatedAt,
      createdBy: rev.snapshot.createdBy,
      updatedBy: rev.snapshot.updatedBy,
      version: rev.snapshot.version,
      prevRevisionHash: rev.snapshot.prevRevisionHash,
    });
    if (rev.revisionHash !== expected) return { ok: false, brokenAt: i, totalLinks: history.length };
    prior = rev.revisionHash;
  }
  return { ok: true, brokenAt: -1, totalLinks: history.length };
}

/* ============================================================
 * Route registration
 * ============================================================ */

export function registerRegionExtensionRoutes(app: Express): void {
  const BASE = "/api/admin/regions/extensions";

  /* ------------------------------------------------------------------
   * GET /api/regions — runtime merged list (canonical 9 + live extensions)
   * ------------------------------------------------------------------ */
  app.get("/api/regions", (_req: Request, res: Response) => {
    res.json({ regions: getRuntimeRegions() });
  });

  /* ------------------------------------------------------------------
   * GET /api/admin/regions/extensions — list with optional status filter
   * ------------------------------------------------------------------ */
  app.get(BASE, (req: Request, res: Response) => {
    const { status, code, name } = req.query as Record<string, string | undefined>;

    let result = [...extensions];
    if (status) result = result.filter((e) => e.status === status);
    if (code) result = result.filter((e) => e.code.toLowerCase().includes(code.toLowerCase()));
    if (name) result = result.filter((e) => e.name.toLowerCase().includes(name.toLowerCase()));

    const stats = {
      total: extensions.length,
      byStatus: {
        research: extensions.filter((e) => e.status === "research").length,
        draft: extensions.filter((e) => e.status === "draft").length,
        review: extensions.filter((e) => e.status === "review").length,
        approved: extensions.filter((e) => e.status === "approved").length,
        live: extensions.filter((e) => e.status === "live").length,
        rejected: extensions.filter((e) => e.status === "rejected").length,
        archived: extensions.filter((e) => e.status === "archived").length,
      },
    };

    res.json({ total: result.length, stats, extensions: result });
  });

  /* ------------------------------------------------------------------
   * GET /api/admin/regions/extensions/:id — single
   * ------------------------------------------------------------------ */
  app.get(`${BASE}/:id`, (req: Request, res: Response) => {
    const ext = extensions.find((e) => e.id === req.params.id);
    if (!ext) return res.status(404).json({ error: "not_found" });
    res.json(ext);
  });

  /* ------------------------------------------------------------------
   * GET /api/admin/regions/extensions/:id/history — revision list + chain verify
   * ------------------------------------------------------------------ */
  app.get(`${BASE}/:id/history`, (req: Request, res: Response) => {
    const ext = extensions.find((e) => e.id === req.params.id);
    if (!ext) return res.status(404).json({ error: "not_found" });

    const history = revisionHistory.get(req.params.id) ?? [];
    const chainResult = verifyChain(req.params.id);

    res.json({
      extensionId: req.params.id,
      chainVerify: chainResult,
      totalRevisions: history.length,
      revisions: history,
    });
  });

  /* ------------------------------------------------------------------
   * POST /api/admin/regions/extensions — create at research stage
   * ------------------------------------------------------------------ */
  app.post(BASE, (req: Request, res: Response) => {
    const { code, name } = req.body ?? {};

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      return res.status(400).json({ error: "validation_error", reason: "code is required (2-letter ISO 3166-1 alpha-2)" });
    }
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "validation_error", reason: "name is required" });
    }

    const normalised = code.trim().toUpperCase();
    if (normalised.length !== 2) {
      return res.status(400).json({ error: "validation_error", reason: "code must be exactly 2 characters (ISO 3166-1 alpha-2)" });
    }

    // Check collision with frozen 9
    if (FROZEN_CODES.has(normalised)) {
      return res.status(400).json({
        error: "code_collision",
        reason: `Code '${normalised}' is one of the frozen canonical 9 regions (${Array.from(FROZEN_CODES).join(", ")}). Use a different code.`,
      });
    }

    // Check collision with existing extensions
    const existing = extensions.find((e) => e.code === normalised);
    if (existing) {
      return res.status(409).json({
        error: "code_already_exists",
        reason: `An extension with code '${normalised}' already exists (id: ${existing.id}, status: ${existing.status}).`,
        existingId: existing.id,
      });
    }

    const proposedChange = { code: normalised, name: name.trim() };
    if (!requireConfirm(req, res, proposedChange)) return;

    const actor = getActorFromRequest(req);
    const ext = createExtension(normalised, name.trim(), actor);

    res.status(201).json(ext);
  });

  /* ------------------------------------------------------------------
   * PATCH /api/admin/regions/extensions/:id — update research or draft fields
   * ------------------------------------------------------------------ */
  app.patch(`${BASE}/:id`, (req: Request, res: Response) => {
    const ext = extensions.find((e) => e.id === req.params.id);
    if (!ext) return res.status(404).json({ error: "not_found" });

    if (TERMINAL_STATUSES.has(ext.status)) {
      return res.status(400).json({ error: "terminal_status", reason: `Cannot modify a region in '${ext.status}' status.` });
    }

    const { research, draft, name } = req.body ?? {};
    const proposedChange = { research, draft, name };

    if (!requireConfirm(req, res, proposedChange)) return;

    const actor = getActorFromRequest(req);
    const result = patchExtension(req.params.id, { research, draft, name }, actor);

    if ("error" in result) {
      const statusCode = result.error === "not_found" ? 404 : 400;
      return res.status(statusCode).json(result);
    }

    res.json(result);
  });

  /* ------------------------------------------------------------------
   * POST /api/admin/regions/extensions/:id/transition — state machine
   * ------------------------------------------------------------------ */
  app.post(`${BASE}/:id/transition`, (req: Request, res: Response) => {
    const ext = extensions.find((e) => e.id === req.params.id);
    if (!ext) return res.status(404).json({ error: "not_found" });

    const { to, reviewerNotes } = req.body ?? {};

    if (!to) {
      return res.status(400).json({ error: "validation_error", reason: "'to' status is required" });
    }

    const allStatuses: RegionStatus[] = ["research", "draft", "review", "approved", "live", "rejected", "archived"];
    if (!allStatuses.includes(to)) {
      return res.status(400).json({ error: "validation_error", reason: `Invalid target status '${to}'. Valid: ${allStatuses.join(", ")}` });
    }

    if (!requireConfirm(req, res, { from: ext.status, to, extensionId: req.params.id })) return;

    const actor = getActorFromRequest(req);
    const result = transitionExtension(req.params.id, to, actor, reviewerNotes);

    if ("error" in result) {
      const statusCode =
        result.error === "not_found" ? 404 :
        result.error === "transition_blocked" ? 400 :
        result.error === "invalid_transition" ? 400 : 400;
      return res.status(statusCode).json(result);
    }

    res.json(result);
  });

  /* ------------------------------------------------------------------
   * POST /api/admin/regions/extensions/:id/archive — convenience shortcut
   * ------------------------------------------------------------------ */
  app.post(`${BASE}/:id/archive`, (req: Request, res: Response) => {
    const ext = extensions.find((e) => e.id === req.params.id);
    if (!ext) return res.status(404).json({ error: "not_found" });

    if (!requireConfirm(req, res, { extensionId: req.params.id, action: "archive" })) return;

    const actor = getActorFromRequest(req);
    const result = transitionExtension(req.params.id, "archived", actor);

    if ("error" in result) {
      return res.status(400).json(result);
    }

    appendAdminAudit(actor, `region:${req.params.id}`, "region.archived", {
      extensionId: req.params.id,
      code: ext.code,
      name: ext.name,
    });

    res.json(result);
  });
}
