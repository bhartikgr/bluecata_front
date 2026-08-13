/**
 * WAVE 30 · ENGINE 2 — `partner_company_relationship` (the "PCR spine").
 *
 * ── WHAT MIGRATION 0136 LEFT HALF-DONE ────────────────────────────────────
 * Wave C-2.h shipped the spine's SCHEMA and a one-shot BACKFILL, and nothing
 * else. Verified at source before this file was written: a tree-wide grep for
 * `partner_company_relationship` / `partnerCompanyRelationship` /
 * `pcr_surface_presence` (excluding node_modules, the built bundles, and
 * .g0-snapshot) returned only the two mirrored copies of migration 0136, the two
 * Drizzle schema files, `connection.ts`'s inline baseline, the self-heal
 * `applyWaveC2PcrSpineSchema.ts`, and the mirror-drift pin. **No reader, no
 * writer, no route, no UI.**
 *
 * That is worse than an unused table. Migration 0136's own header names a
 * "§3.3 forward-write helper contract that THIS backfill must leave in a
 * consistent state for" — and that helper was never built. So the spine is a
 * snapshot of the platform as it stood the day 0136 ran, and **every attribution
 * created since then is invisible to it**. A table that is silently and
 * permanently drifting out of date is a liability, not an asset: any future
 * feature that trusts it would be reading stale truth.
 *
 * This file is that missing §3.3 helper, plus the read model on top of it.
 *
 * ── WHAT THE SPINE IS FOR ─────────────────────────────────────────────────
 * The platform records a partner↔company relationship in four separate places
 * (`mf_engagement`, `partner_deal_pipeline`, `partner_attributions`,
 * `partner_portfolio_company`) with no single object tying them together. The
 * spine is that object: one row per `(partner_id, company_id)`, with
 * `pcr_surface_presence` recording WHICH of the four surfaces that relationship
 * currently appears on. It answers "what is our full relationship with this
 * company?" — a question the platform previously could not answer at all
 * without four separate queries and a manual join.
 *
 * ── APPEND-ONLY PRESENCE (0136 §3.2) ──────────────────────────────────────
 * `pcr_surface_presence` is APPEND-ONLY. Removing a relationship from a surface
 * sets `removed_at`; it NEVER deletes the row. This is deliberate and is
 * preserved here exactly: the history of "this company was in our pipeline in
 * March, became a client in June" is the entire point, and a DELETE would be a
 * silent drop of real information. `recordSurfaceRemoval` therefore issues an
 * UPDATE, and re-adding a previously-removed presence CLEARS `removed_at` on the
 * existing row rather than inserting a second one (the table's
 * `UNIQUE (pcr_id, surface, row_id)` would reject the second one anyway).
 */
import { randomUUID } from "node:crypto";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

/** The four canonical surfaces — migration 0136's own CHECK constraint. */
export const PCR_SURFACES = ["mfc", "pipeline", "clients", "portfolio"] as const;
export type PcrSurface = (typeof PCR_SURFACES)[number];

/** Human labels for the UI. Kept beside the constant so the two cannot drift. */
export const PCR_SURFACE_LABELS: Record<PcrSurface, string> = {
  mfc: "Managed Founder CRM",
  pipeline: "Deal pipeline",
  clients: "Client (attributed)",
  portfolio: "Portfolio",
};

export class PcrNotFoundError extends Error {
  constructor(message = "Relationship not found for this partner.") {
    super(message);
    this.name = "PcrNotFoundError";
  }
}

export class PcrValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PcrValidationError";
  }
}

export interface PcrSurfacePresenceRow {
  id: string;
  pcrId: string;
  surface: PcrSurface;
  rowId: string;
  addedAt: string;
  removedAt: string | null;
}

export interface PcrRow {
  id: string;
  partnerId: string;
  companyId: string;
  companyName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Surfaces the relationship is CURRENTLY on (`removed_at IS NULL`). */
  activeSurfaces: PcrSurface[];
  /** Surfaces it was once on but has since left — the history the UI shows. */
  pastSurfaces: PcrSurface[];
  presence: PcrSurfacePresenceRow[];
}

function isSurface(v: unknown): v is PcrSurface {
  return typeof v === "string" && (PCR_SURFACES as readonly string[]).includes(v);
}

/**
 * The spine id is derived from the tuple, NOT random.
 *
 * This MUST match migration 0136's template byte for byte
 * (`'pcr_' || partner_id || '|' || company_id`), or a forward-write would mint a
 * SECOND spine row for a relationship the backfill already seeded, and the
 * `UNIQUE (partner_id, company_id)` constraint would then reject it — turning
 * every post-0136 attribution write into a hard failure.
 *
 * The '|' separator (not '_') is load-bearing and was itself a fix inside 0136:
 * partner and company ids may contain underscores, so an underscore separator is
 * NOT injective — ('p_1','2') and ('p','1_2') both collapse to 'pcr_p_1_2'. The
 * pipe is not a legal character in any id this platform generates, so the
 * derivation is injective over the real domain. `assertInjectableIds` below
 * enforces that precondition instead of assuming it.
 */
export function pcrIdFor(partnerId: string, companyId: string): string {
  return `pcr_${partnerId}|${companyId}`;
}

/**
 * 0136's injectivity argument holds only because platform ids never contain a
 * pipe. That is an ASSUMPTION about the id generators, and assumptions that are
 * never checked are how a silent-collision bug ships. Checking it costs nothing.
 */
function assertInjectableIds(partnerId: string, companyId: string): void {
  if (partnerId.includes("|") || companyId.includes("|")) {
    throw new PcrValidationError(
      "PCR_ID_SEPARATOR_COLLISION: partner_id/company_id must not contain '|' — " +
        "the spine id derivation would stop being injective.",
    );
  }
}

/* ─────────────────────────── the §3.3 forward-write helper ─────────────── */

/**
 * Ensure a spine row exists for `(partnerId, companyId)` and return its id.
 *
 * **Fail-soft by design.** This is called from inside other stores' write paths
 * (see `writeTypedAttribution` in `partnerWorkspaceStore.ts`). The spine is a
 * derived read model; an attribution write must NOT fail because its spine
 * mirror could not be maintained. `foreign_keys` is ON, so a partner or company
 * id that does not resolve to a live parent row would otherwise raise
 * `FOREIGN KEY constraint failed` and roll back the caller's real work.
 *
 * So unresolvable tuples are **skipped and logged to `c2_backfill_skip_log`** —
 * the exact same skip+log policy migration 0136 applies in its orphan pre-flight
 * (§2.1), reused rather than reinvented so the two paths agree. The function
 * returns `null` in that case, and callers treat null as "no spine, nothing to
 * record", never as an error.
 */
export function ensurePcr(partnerId: string, companyId: string): string | null {
  const pid = String(partnerId ?? "").trim();
  const cid = String(companyId ?? "").trim();
  if (!pid || !cid) return null;
  assertInjectableIds(pid, cid);

  const db: any = rawDb();
  const id = pcrIdFor(pid, cid);

  const existing = db
    .prepare(`SELECT id FROM partner_company_relationship WHERE id = ? LIMIT 1`)
    .get(id) as { id?: string } | undefined;
  if (existing?.id) return existing.id;

  /* Orphan pre-flight, mirroring 0136 §2.1 exactly: resolve BOTH parents before
     presenting the tuple to the FK-constrained INSERT. */
  const parentsOk = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM partner_organizations WHERE id = ?) AS p,
         (SELECT COUNT(*) FROM companies WHERE id = ?) AS c`,
    )
    .get(pid, cid) as { p: number; c: number };
  if (!parentsOk.p || !parentsOk.c) {
    logSkip(pid, cid, !parentsOk.p ? "partner_id" : "company_id");
    return null;
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO partner_company_relationship (id, partner_id, company_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, pid, cid, now, now);
  return id;
}

function logSkip(partnerId: string, companyId: string, missingFk: "partner_id" | "company_id"): void {
  try {
    rawDb()
      .prepare(
        `INSERT OR IGNORE INTO c2_backfill_skip_log
           (id, source_table, source_id, missing_fk, reason, skipped_at)
         VALUES (?, 'partner_company_relationship', ?, ?, ?, ?)`,
      )
      .run(
        `c2skip_w30_pcr_${partnerId}|${companyId}`,
        `${partnerId}|${companyId}`,
        missingFk,
        "forward_write_w30_unresolvable_parent",
        new Date().toISOString(),
      );
  } catch (err) {
    // The skip log is diagnostics. It must never be the thing that breaks a write.
    log.warn("[pcrStore] skip-log write failed:", (err as Error).message);
  }
}

/**
 * Record that `(partnerId, companyId)` is present on `surface` via `rowId`.
 *
 * Idempotent, and it REVIVES rather than duplicates: if the presence row exists
 * but was previously removed, `removed_at` is cleared. That is the correct
 * reading of an append-only table under `UNIQUE (pcr_id, surface, row_id)` — the
 * alternative (a second row) is not merely undesirable, it is rejected by the
 * constraint.
 */
export function recordSurfacePresence(
  partnerId: string,
  companyId: string,
  surface: PcrSurface,
  rowId: string,
  addedAt?: string,
): string | null {
  if (!isSurface(surface)) throw new PcrValidationError(`UNKNOWN_PCR_SURFACE: ${String(surface)}`);
  const rid = String(rowId ?? "").trim();
  if (!rid) throw new PcrValidationError("ROW_ID_REQUIRED");
  const pcrId = ensurePcr(partnerId, companyId);
  if (!pcrId) return null;

  const db: any = rawDb();
  const when = addedAt || new Date().toISOString();
  const existing = db
    .prepare(
      `SELECT id, removed_at FROM pcr_surface_presence
        WHERE pcr_id = ? AND surface = ? AND row_id = ? LIMIT 1`,
    )
    .get(pcrId, surface, rid) as { id?: string; removed_at?: string | null } | undefined;

  if (existing?.id) {
    if (existing.removed_at != null) {
      db.prepare(`UPDATE pcr_surface_presence SET removed_at = NULL WHERE id = ?`).run(existing.id);
      touch(pcrId);
    }
    return existing.id;
  }

  const id = `pcrsp_${randomUUID()}`;
  db.prepare(
    `INSERT OR IGNORE INTO pcr_surface_presence (id, pcr_id, surface, row_id, added_at, removed_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(id, pcrId, surface, rid, when);
  touch(pcrId);
  return id;
}

/**
 * Mark a presence as ended. **UPDATE, never DELETE** (0136 §3.2 append-only).
 * Returns false when there was no live presence to end, so callers can tell the
 * difference between "ended it" and "there was nothing there" — a boolean that
 * always returns true would make the append-only guarantee untestable.
 */
export function recordSurfaceRemoval(
  partnerId: string,
  companyId: string,
  surface: PcrSurface,
  rowId: string,
  removedAt?: string,
): boolean {
  if (!isSurface(surface)) throw new PcrValidationError(`UNKNOWN_PCR_SURFACE: ${String(surface)}`);
  const pcrId = pcrIdFor(String(partnerId ?? "").trim(), String(companyId ?? "").trim());
  const res = rawDb()
    .prepare(
      `UPDATE pcr_surface_presence SET removed_at = ?
        WHERE pcr_id = ? AND surface = ? AND row_id = ? AND removed_at IS NULL`,
    )
    .run(removedAt || new Date().toISOString(), pcrId, surface, String(rowId ?? "").trim());
  if (res.changes > 0) touch(pcrId);
  return res.changes > 0;
}

function touch(pcrId: string): void {
  rawDb()
    .prepare(`UPDATE partner_company_relationship SET updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), pcrId);
}

/* ───────────────────────────────── read model ──────────────────────────── */

function loadPresence(pcrIds: string[]): Map<string, PcrSurfacePresenceRow[]> {
  const out = new Map<string, PcrSurfacePresenceRow[]>();
  if (pcrIds.length === 0) return out;
  const placeholders = pcrIds.map(() => "?").join(",");
  const rows = rawDb()
    .prepare(
      `SELECT id, pcr_id, surface, row_id, added_at, removed_at
         FROM pcr_surface_presence
        WHERE pcr_id IN (${placeholders})
        ORDER BY added_at ASC, id ASC`,
    )
    .all(...pcrIds) as Array<Record<string, any>>;
  for (const r of rows) {
    const list = out.get(String(r.pcr_id)) ?? [];
    if (!isSurface(r.surface)) continue; // CHECK-constrained, but do not trust it blindly
    list.push({
      id: String(r.id),
      pcrId: String(r.pcr_id),
      surface: r.surface,
      rowId: String(r.row_id),
      addedAt: String(r.added_at),
      removedAt: r.removed_at ?? null,
    });
    out.set(String(r.pcr_id), list);
  }
  return out;
}

function hydrate(base: Array<Record<string, any>>): PcrRow[] {
  const presenceByPcr = loadPresence(base.map((r) => String(r.id)));
  return base.map((r) => {
    const presence = presenceByPcr.get(String(r.id)) ?? [];
    const active = new Set<PcrSurface>();
    const ever = new Set<PcrSurface>();
    for (const p of presence) {
      ever.add(p.surface);
      if (p.removedAt == null) active.add(p.surface);
    }
    return {
      id: String(r.id),
      partnerId: String(r.partner_id),
      companyId: String(r.company_id),
      companyName: r.company_name ?? null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      activeSurfaces: PCR_SURFACES.filter((s) => active.has(s)),
      // "past" means every surface it has EVER been on minus the live ones, so a
      // surface it left and later rejoined shows only as active — which is right.
      pastSurfaces: PCR_SURFACES.filter((s) => ever.has(s) && !active.has(s)),
      presence,
    };
  });
}

/**
 * Every relationship this partner has, across all four surfaces.
 *
 * `partner_id = ?` is the tenant boundary and it is the ONLY way in — there is
 * deliberately no "list all relationships" export on this module for a route to
 * accidentally reach for.
 */
export function listRelationshipsForPartner(partnerId: string): PcrRow[] {
  const pid = String(partnerId ?? "").trim();
  if (!pid) throw new PcrValidationError("PARTNER_ID_REQUIRED");
  const base = rawDb()
    .prepare(
      `SELECT r.id, r.partner_id, r.company_id, r.created_at, r.updated_at, co.name AS company_name
         FROM partner_company_relationship r
         LEFT JOIN companies co ON co.id = r.company_id
        WHERE r.partner_id = ?
        ORDER BY r.updated_at DESC, r.id ASC`,
    )
    .all(pid) as Array<Record<string, any>>;
  return hydrate(base);
}

/**
 * One relationship, by spine id.
 *
 * Cross-tenant reads raise `PcrNotFoundError` — which the route layer maps to
 * **404, not 403** (Wave 29 precedent). A 403 here would confirm that the spine
 * id exists, and because spine ids are DERIVED from `partner_id|company_id`
 * rather than random, that confirmation is unusually damaging: an attacker who
 * can distinguish 403 from 404 can test arbitrary
 * `pcr_<partner>|<company>` guesses and map out which firms work with which
 * companies. Derived ids make the enumeration-oracle risk worse than usual, so
 * the refusal must be uniform.
 */
export function getRelationship(partnerId: string, pcrId: string): PcrRow {
  const pid = String(partnerId ?? "").trim();
  const rid = String(pcrId ?? "").trim();
  if (!pid) throw new PcrValidationError("PARTNER_ID_REQUIRED");
  if (!rid) throw new PcrValidationError("PCR_ID_REQUIRED");
  const base = rawDb()
    .prepare(
      `SELECT r.id, r.partner_id, r.company_id, r.created_at, r.updated_at, co.name AS company_name
         FROM partner_company_relationship r
         LEFT JOIN companies co ON co.id = r.company_id
        WHERE r.id = ? AND r.partner_id = ?`,
    )
    .all(rid, pid) as Array<Record<string, any>>;
  const rows = hydrate(base);
  if (rows.length === 0) throw new PcrNotFoundError();
  return rows[0];
}

/** The same lookup addressed by company rather than by spine id. */
export function getRelationshipByCompany(partnerId: string, companyId: string): PcrRow {
  const pid = String(partnerId ?? "").trim();
  const cid = String(companyId ?? "").trim();
  if (!pid || !cid) throw new PcrValidationError("PARTNER_ID_AND_COMPANY_ID_REQUIRED");
  assertInjectableIds(pid, cid);
  return getRelationship(pid, pcrIdFor(pid, cid));
}

/**
 * Counts per surface for this partner's relationship map — the summary strip.
 * Every surface is present in the result with an explicit 0 rather than being
 * absent, so the UI renders "0" instead of a blank that reads as "unknown".
 */
export function surfaceBreakdown(partnerId: string): Record<PcrSurface, number> {
  const pid = String(partnerId ?? "").trim();
  if (!pid) throw new PcrValidationError("PARTNER_ID_REQUIRED");
  const out = { mfc: 0, pipeline: 0, clients: 0, portfolio: 0 } as Record<PcrSurface, number>;
  const rows = rawDb()
    .prepare(
      `SELECT p.surface AS surface, COUNT(DISTINCT r.id) AS n
         FROM pcr_surface_presence p
         JOIN partner_company_relationship r ON r.id = p.pcr_id
        WHERE r.partner_id = ? AND p.removed_at IS NULL
        GROUP BY p.surface`,
    )
    .all(pid) as Array<{ surface: string; n: number }>;
  for (const r of rows) if (isSurface(r.surface)) out[r.surface] = Number(r.n);
  return out;
}

/**
 * Reconcile the spine against the four surfaces for ONE partner.
 *
 * Migration 0136 backfilled once and left no way to do it again. Any row written
 * before the forward-write helper existed — which is every surface row created
 * between 0136 and this wave — is missing from the spine. This is the repair
 * path for that gap, and it is scoped to a single partner so it can be run from
 * the partner's own workspace rather than requiring a platform-wide job.
 *
 * It is READ-ONLY with respect to the four surface tables: it only ever inserts
 * spine and presence rows. It never writes `pcr_id` back onto a surface row,
 * because those columns sit outside the surfaces' hash chains and this wave has
 * no mandate to touch hash-chained tables.
 */
export function reconcilePartner(partnerId: string): {
  scanned: number;
  relationshipsCreated: number;
  presenceRecorded: number;
} {
  const pid = String(partnerId ?? "").trim();
  if (!pid) throw new PcrValidationError("PARTNER_ID_REQUIRED");
  const db: any = rawDb();

  /* Live-row grain per surface, taken from 0136's own predicates rather than
     re-derived: attributions use revoked_at, pipeline and portfolio use
     deleted_at, and mf_engagement has no soft-delete column in its base DDL. */
  const sources: Array<{ surface: PcrSurface; sql: string }> = [
    { surface: "mfc", sql: `SELECT id, company_id, created_at FROM mf_engagement WHERE partner_id = ?` },
    {
      surface: "pipeline",
      sql: `SELECT id, company_id, created_at FROM partner_deal_pipeline WHERE partner_id = ? AND deleted_at IS NULL`,
    },
    {
      surface: "clients",
      sql: `SELECT id, company_id, attributed_at AS created_at FROM partner_attributions WHERE partner_id = ? AND revoked_at IS NULL`,
    },
    {
      surface: "portfolio",
      sql: `SELECT id, company_id, created_at FROM partner_portfolio_company WHERE partner_id = ? AND deleted_at IS NULL`,
    },
  ];

  let scanned = 0;
  let presenceRecorded = 0;
  const before = Number(
    (db.prepare(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ?`).get(pid) as { n: number }).n,
  );

  for (const src of sources) {
    let rows: Array<Record<string, any>>;
    try {
      rows = db.prepare(src.sql).all(pid);
    } catch (err) {
      /* A surface table absent on this deployment is not a reconcile failure.
         mf_engagement in particular is created by a LATER installer than the one
         that creates the spine, so on a fresh boot it may genuinely not be there
         yet — 0136's own header documents that exact ordering hazard. */
      log.warn(`[pcrStore] reconcile skipped surface ${src.surface}:`, (err as Error).message);
      continue;
    }
    for (const r of rows) {
      scanned += 1;
      const cid = String(r.company_id ?? "").trim();
      if (!cid) continue;
      const id = recordSurfacePresence(pid, cid, src.surface, String(r.id), r.created_at ?? undefined);
      if (id) presenceRecorded += 1;
    }
  }

  const after = Number(
    (db.prepare(`SELECT COUNT(*) n FROM partner_company_relationship WHERE partner_id = ?`).get(pid) as { n: number }).n,
  );
  return { scanned, relationshipsCreated: after - before, presenceRecorded };
}
