/**
 * v25.49 Phase-3A — Consortium Partner Clients CRM engine (SEPARATE store).
 *
 * Kept deliberately separate from crmStore / founderCrmStore / investorCrmStore
 * per Ozan's decision: the partner-clients CRM must NOT be folded into the
 * canonical engine, but it should gain the capabilities it lacked — durable
 * CRM stages + a client-scoped activity timeline. This is a PARALLEL, additive
 * layer over the existing partner_attributions data (Sacred Rule #78: nothing
 * existing is dropped or moved).
 *
 * Persistence pattern mirrors partnerWorkspaceStore's v24.4.1 RAM→DB write-
 * through: reads come from in-memory caches (rebuilt on boot by
 * hydratePartnerClientCrmStore()); writes flow through to the durable
 * partner_client_crm / partner_client_activity tables in the same call.
 *
 * FAIL-CLOSED: every read and write is scoped to a partnerId. Callers resolve
 * partnerId from the session (never the URL) via requirePartnerAuth, and the
 * route layer additionally verifies the companyId is attributed to that partner
 * before touching this store. Zero in-memory canonical state — the DB is the
 * source of truth; the caches are a rebuildable projection.
 */
import { randomUUID } from "crypto";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
import { resolveDisplayName } from "./lib/displayNameResolver"; /* W-COLLECTIVE Wave 1 (v4 §1.3) — never render a raw u_… id in an activity body */
import {
  PARTNER_CLIENT_DEFAULT_STAGE,
  isPartnerClientStage,
  type PartnerClientStage,
} from "../shared/crmStages";

/**
 * W-COLLECTIVE Wave 1 (v4 §1.3) — resolve a partner-team userId to a label that
 * is safe to embed in an activity body. `displayNameResolver` already guarantees
 * it never returns a raw `u_…` id; the regex below is a belt-and-braces check so
 * a future change there cannot reintroduce the leak here.
 *
 * Fail-safe: on any resolution failure returns a neutral label, NEVER the raw id.
 */
function resolveLeadLabel(userId: string): string {
  try {
    const name = String(resolveDisplayName(userId)?.name ?? "").trim();
    if (name && !/^u_[A-Za-z0-9_]*$/.test(name)) return name;
  } catch (err) {
    log.warn("[partnerClientCrmStore] lead name resolution failed:", (err as Error).message);
  }
  return "a team member";
}

export interface PartnerClientCrmRow {
  partnerId: string;
  companyId: string;
  stage: PartnerClientStage;
  updatedAt: string;
  updatedBy: string | null;
  /** w-partner (0115) — designated partner-team member owning this client. */
  leadUserId: string | null;
}

export interface PartnerClientActivity {
  id: string;
  partnerId: string;
  companyId: string;
  activityType: string;
  body: string | null;
  actorUserId: string | null;
  occurredAt: string;
  meta: Record<string, unknown> | null;
}

/* In-memory projections, keyed for O(1) partner-scoped reads. */
const crmByKey = new Map<string, PartnerClientCrmRow>(); // `${partnerId}::${companyId}`
const activityById = new Map<string, PartnerClientActivity>();

function key(partnerId: string, companyId: string): string {
  return `${partnerId}::${companyId}`;
}

function requirePid(partnerId: string): void {
  if (!partnerId || typeof partnerId !== "string") {
    throw new Error("PARTNER_ID_REQUIRED");
  }
}

function persistCrm(row: PartnerClientCrmRow): void {
  try {
    rawDb().prepare(
      `INSERT INTO partner_client_crm (partner_id, company_id, stage, updated_at, updated_by, lead_user_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(partner_id, company_id) DO UPDATE SET
         stage = excluded.stage,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    ).run(
      row.partnerId, row.companyId, row.stage, row.updatedAt,
      row.updatedBy ?? null, row.leadUserId ?? null,
    );
  } catch (err) {
    log.warn("[partnerClientCrmStore] crm write-through failed:", (err as Error).message);
    throw new Error(`STRICT_PERSIST_FAILED: partner_client_crm.${row.partnerId}/${row.companyId}: ${(err as Error).message}`);
  }
}

/**
 * w-partner F3 — lead_user_id is deliberately ABSENT from persistCrm's
 * ON CONFLICT SET list: `excluded` derives from the row the caller built, and
 * setStage builds a row from the stage transition alone. Listing it there would
 * NULL the lead on every stage change. The INSERT column list DOES carry it so
 * a row created by setLead is born with its lead; changing the lead on an
 * EXISTING row goes through this targeted UPDATE instead.
 */
function persistLead(row: PartnerClientCrmRow): void {
  try {
    rawDb().prepare(
      `UPDATE partner_client_crm
          SET lead_user_id = ?, updated_at = ?, updated_by = ?
        WHERE partner_id = ? AND company_id = ?`,
    ).run(row.leadUserId ?? null, row.updatedAt, row.updatedBy ?? null, row.partnerId, row.companyId);
  } catch (err) {
    log.warn("[partnerClientCrmStore] lead write-through failed:", (err as Error).message);
    throw new Error(`STRICT_PERSIST_FAILED: partner_client_crm.lead.${row.partnerId}/${row.companyId}: ${(err as Error).message}`);
  }
}

/**
 * w-partner CODE-REVIEW B2 (second half) — read the DURABLE stage straight from
 * the DB. `setLead` must not derive `stage` from the RAM projection: on a cold or
 * degraded boot RAM can be empty while the DB row holds a real, advanced stage,
 * and `persistCrm`'s ON CONFLICT overwrites `stage = excluded.stage`. Building the
 * row from a DB read means assigning a lead can never silently reset a client's
 * stage back to the default. Returns null when the company has no row yet.
 */
function readStageFromDb(partnerId: string, companyId: string): PartnerClientStage | null {
  try {
    const r = rawDb()
      .prepare(`SELECT stage FROM partner_client_crm WHERE partner_id = ? AND company_id = ?`)
      .get(partnerId, companyId) as { stage?: string } | undefined;
    return (r?.stage as PartnerClientStage) ?? null;
  } catch (err) {
    log.warn("[partnerClientCrmStore] stage read-back failed:", (err as Error).message);
    return null;
  }
}

function persistActivity(a: PartnerClientActivity): void {
  try {
    rawDb().prepare(
      `INSERT INTO partner_client_activity (id, partner_id, company_id, activity_type, body, actor_user_id, occurred_at, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      a.id, a.partnerId, a.companyId, a.activityType, a.body ?? null,
      a.actorUserId ?? null, a.occurredAt, a.meta ? JSON.stringify(a.meta) : null,
    );
  } catch (err) {
    log.warn("[partnerClientCrmStore] activity write-through failed:", (err as Error).message);
    throw new Error(`STRICT_PERSIST_FAILED: partner_client_activity.${a.id}: ${(err as Error).message}`);
  }
}

export const partnerClientCrmStore = {
  /** Durable stage for one attributed company (defaults to prospect if unset). */
  getStage(partnerId: string, companyId: string): PartnerClientStage {
    requirePid(partnerId);
    return crmByKey.get(key(partnerId, companyId))?.stage ?? PARTNER_CLIENT_DEFAULT_STAGE;
  },

  /** Stage map for every company this partner has ever staged. */
  listStages(partnerId: string): Record<string, PartnerClientStage> {
    requirePid(partnerId);
    const out: Record<string, PartnerClientStage> = {};
    for (const row of Array.from(crmByKey.values())) {
      if (row.partnerId === partnerId) out[row.companyId] = row.stage;
    }
    return out;
  },

  /** Idempotent stage transition; records a stage_changed activity when it moves. */
  setStage(partnerId: string, companyId: string, stage: string, actor: string): PartnerClientCrmRow {
    requirePid(partnerId);
    if (!companyId) throw new Error("COMPANY_ID_REQUIRED");
    if (!isPartnerClientStage(stage)) throw new Error("INVALID_STAGE");
    const existing = crmByKey.get(key(partnerId, companyId));
    const prev = existing?.stage ?? null;
    const now = new Date().toISOString();
    // CARRY FORWARD: this row REPLACES the cached projection wholesale below, so
    // omitting leadUserId here would drop the designated lead from memory on
    // every stage change even though the DB column is untouched.
    const row: PartnerClientCrmRow = {
      partnerId,
      companyId,
      stage,
      updatedAt: now,
      updatedBy: actor ?? null,
      leadUserId: existing?.leadUserId ?? null,
    };
    persistCrm(row);
    crmByKey.set(key(partnerId, companyId), row);
    if (prev !== stage) {
      this.addActivity(partnerId, companyId, {
        activityType: "stage_changed",
        body: prev ? `Stage: ${prev} → ${stage}` : `Stage set to ${stage}`,
        actorUserId: actor ?? null,
        meta: { from: prev, to: stage },
      });
    }
    return row;
  },

  /** Designated partner-team lead for one attributed company (null if unset). */
  getLead(partnerId: string, companyId: string): string | null {
    requirePid(partnerId);
    return crmByKey.get(key(partnerId, companyId))?.leadUserId ?? null;
  },

  /** Lead map for every company this partner has ever staged or assigned. */
  listLeads(partnerId: string): Record<string, string> {
    requirePid(partnerId);
    const out: Record<string, string> = {};
    for (const row of Array.from(crmByKey.values())) {
      if (row.partnerId === partnerId && row.leadUserId) out[row.companyId] = row.leadUserId;
    }
    return out;
  },

  /**
   * Assign (or clear, with null) the designated lead. Creates the CRM row at
   * the default stage if this company has never been staged, so assigning a
   * lead does not require a prior stage transition. Records a lead_assigned
   * activity when the value actually moves.
   */
  setLead(
    partnerId: string,
    companyId: string,
    leadUserId: string | null,
    actor: string,
  ): PartnerClientCrmRow {
    requirePid(partnerId);
    if (!companyId) throw new Error("COMPANY_ID_REQUIRED");
    const existing = crmByKey.get(key(partnerId, companyId));
    const prev = existing?.leadUserId ?? null;
    const next = leadUserId ?? null;
    const now = new Date().toISOString();
    // B2 (second half): resolve the stage from RAM if present, else from the DB,
    // and only fall back to the default when NEITHER has a row. This prevents a
    // cold-projection lead assignment from resetting the client's durable stage
    // via persistCrm's `stage = excluded.stage` ON CONFLICT clause.
    const resolvedStage =
      existing?.stage ?? readStageFromDb(partnerId, companyId) ?? PARTNER_CLIENT_DEFAULT_STAGE;
    const row: PartnerClientCrmRow = {
      partnerId,
      companyId,
      stage: resolvedStage,
      updatedAt: now,
      updatedBy: actor ?? null,
      leadUserId: next,
    };
    // persistCrm creates the row (its INSERT carries lead_user_id) or refreshes
    // stage/updated_* on an existing one; persistLead then moves the lead column
    // itself, which persistCrm's ON CONFLICT deliberately leaves alone.
    persistCrm(row);
    // w-partner CODE-REVIEW B2: `existing` is read from the RAM projection, but the
    // lead column is a DB question. On a cold/degraded boot RAM can be empty while the
    // DB row exists; guarding persistLead on `existing` then (a) never moves the
    // lead_user_id column (persistCrm's ON CONFLICT deliberately leaves it alone), and
    // (b) worse, persistCrm's INSERT-or-conflict path resets the durable `stage` to the
    // default because `existing?.stage` was undefined. Always persist the lead: on the
    // freshly-inserted path persistLead simply rewrites the same value (harmless).
    persistLead(row);
    crmByKey.set(key(partnerId, companyId), row);
    if (prev !== next) {
      /* W-COLLECTIVE Wave 1 (v4 §1.3) — the body was `Lead assigned to ${next}`,
         i.e. a raw `u_…` platform id rendered into the client timeline that
         partner staff read. `resolveDisplayName` is guaranteed never to return a
         raw id (it degrades to "Pending member"). `meta.from` / `meta.to` keep
         the RAW ids — they are the machine-readable record every downstream
         consumer joins on, and rewriting them would be a silent data change. */
      this.addActivity(partnerId, companyId, {
        activityType: "lead_assigned",
        body: next ? `Lead assigned to ${resolveLeadLabel(next)}` : "Lead cleared",
        actorUserId: actor ?? null,
        meta: { from: prev, to: next },
      });
    }
    return row;
  },

  /** Append a client-scoped activity/timeline entry. */
  addActivity(
    partnerId: string,
    companyId: string,
    data: { activityType: string; body?: string | null; actorUserId?: string | null; meta?: Record<string, unknown> | null },
  ): PartnerClientActivity {
    requirePid(partnerId);
    if (!companyId) throw new Error("COMPANY_ID_REQUIRED");
    if (!data.activityType) throw new Error("ACTIVITY_TYPE_REQUIRED");
    const a: PartnerClientActivity = {
      id: `pcact_${randomUUID()}`,
      partnerId,
      companyId,
      activityType: data.activityType,
      body: data.body ?? null,
      actorUserId: data.actorUserId ?? null,
      occurredAt: new Date().toISOString(),
      meta: data.meta ?? null,
    };
    persistActivity(a);
    activityById.set(a.id, a);
    return a;
  },

  /** Newest-first activity timeline for a single attributed company. */
  listActivity(partnerId: string, companyId: string): PartnerClientActivity[] {
    requirePid(partnerId);
    return Array.from(activityById.values())
      .filter((a) => a.partnerId === partnerId && a.companyId === companyId)
      .sort((x, y) => (x.occurredAt < y.occurredAt ? 1 : -1));
  },
};

/**
 * Rebuild the in-memory projections from the durable tables on boot.
 *
 * CLEAR-AFTER-SUCCESSFUL-READ: each projection is built into a temp map and the
 * live cache is only cleared and swapped once its SELECT has returned. The
 * catch below is non-fatal by design, so clearing first meant any SELECT
 * failure — e.g. a missing lead_user_id column on a DB that got the CREATE
 * TABLE self-heal but not the ADD COLUMN one — completed boot with an EMPTY
 * cache, silently wiping every partner's CRM projection. Now a failed read
 * leaves the previous projection in place instead of destroying it.
 */
export async function hydratePartnerClientCrmStore(): Promise<void> {
  const db = rawDb();
  try {
    const nextCrm = new Map<string, PartnerClientCrmRow>();
    const crmRows = db.prepare(
      `SELECT partner_id, company_id, stage, updated_at, updated_by, lead_user_id FROM partner_client_crm`,
    ).all() as Array<{ partner_id: string; company_id: string; stage: string; updated_at: string; updated_by: string | null; lead_user_id: string | null }>;
    for (const r of crmRows) {
      if (!isPartnerClientStage(r.stage)) continue; // defensive: skip unknown vocab
      nextCrm.set(key(r.partner_id, r.company_id), {
        partnerId: r.partner_id,
        companyId: r.company_id,
        stage: r.stage,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
        leadUserId: r.lead_user_id ?? null,
      });
    }
    crmByKey.clear(); // only reached once the read above succeeded
    for (const [k, v] of Array.from(nextCrm)) crmByKey.set(k, v);

    const nextActivity = new Map<string, PartnerClientActivity>();
    const actRows = db.prepare(
      `SELECT id, partner_id, company_id, activity_type, body, actor_user_id, occurred_at, meta_json FROM partner_client_activity`,
    ).all() as Array<{
      id: string; partner_id: string; company_id: string; activity_type: string;
      body: string | null; actor_user_id: string | null; occurred_at: string; meta_json: string | null;
    }>;
    for (const r of actRows) {
      let meta: Record<string, unknown> | null = null;
      if (r.meta_json) {
        try { meta = JSON.parse(r.meta_json) as Record<string, unknown>; } catch { meta = null; }
      }
      nextActivity.set(r.id, {
        id: r.id,
        partnerId: r.partner_id,
        companyId: r.company_id,
        activityType: r.activity_type,
        body: r.body,
        actorUserId: r.actor_user_id,
        occurredAt: r.occurred_at,
        meta,
      });
    }
    activityById.clear(); // only reached once the read above succeeded
    for (const [k, v] of Array.from(nextActivity)) activityById.set(k, v);
    log.info?.(`[partnerClientCrmStore] hydrated ${crmByKey.size} stage row(s), ${activityById.size} activity row(s)`);
  } catch (err) {
    log.warn("[partnerClientCrmStore] hydrate failed (non-fatal):", (err as Error).message);
  }
}
