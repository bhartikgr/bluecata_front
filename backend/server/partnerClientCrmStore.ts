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
import {
  PARTNER_CLIENT_DEFAULT_STAGE,
  isPartnerClientStage,
  type PartnerClientStage,
} from "../shared/crmStages";

export interface PartnerClientCrmRow {
  partnerId: string;
  companyId: string;
  stage: PartnerClientStage;
  updatedAt: string;
  updatedBy: string | null;
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
      `INSERT INTO partner_client_crm (partner_id, company_id, stage, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(partner_id, company_id) DO UPDATE SET
         stage = excluded.stage,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    ).run(row.partnerId, row.companyId, row.stage, row.updatedAt, row.updatedBy ?? null);
  } catch (err) {
    log.warn("[partnerClientCrmStore] crm write-through failed:", (err as Error).message);
    throw new Error(`STRICT_PERSIST_FAILED: partner_client_crm.${row.partnerId}/${row.companyId}: ${(err as Error).message}`);
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
    const prev = crmByKey.get(key(partnerId, companyId))?.stage ?? null;
    const now = new Date().toISOString();
    const row: PartnerClientCrmRow = { partnerId, companyId, stage, updatedAt: now, updatedBy: actor ?? null };
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

/** Rebuild the in-memory projections from the durable tables on boot. */
export async function hydratePartnerClientCrmStore(): Promise<void> {
  const db = rawDb();
  try {
    crmByKey.clear();
    const crmRows = db.prepare(
      `SELECT partner_id, company_id, stage, updated_at, updated_by FROM partner_client_crm`,
    ).all() as Array<{ partner_id: string; company_id: string; stage: string; updated_at: string; updated_by: string | null }>;
    for (const r of crmRows) {
      if (!isPartnerClientStage(r.stage)) continue; // defensive: skip unknown vocab
      crmByKey.set(key(r.partner_id, r.company_id), {
        partnerId: r.partner_id,
        companyId: r.company_id,
        stage: r.stage,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
      });
    }

    activityById.clear();
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
      activityById.set(r.id, {
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
    log.info?.(`[partnerClientCrmStore] hydrated ${crmByKey.size} stage row(s), ${activityById.size} activity row(s)`);
  } catch (err) {
    log.warn("[partnerClientCrmStore] hydrate failed (non-fatal):", (err as Error).message);
  }
}
