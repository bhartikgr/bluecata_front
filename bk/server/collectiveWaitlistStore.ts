/**
 * server/collectiveWaitlistStore.ts — v16 Fix 6.
 *
 * Honest "ship safely" persistence for the Collective subsystem.
 *
 * When `COLLECTIVE_ENABLED=0` (the Saturday-ship default), the existing
 * /api/collective/{applications,nominations,promote} endpoints return 503.
 * This store accepts the same form submissions via /api/collective/waitlist/*
 * and queues them for admin review. When chapters launch and the audit-cited
 * Tier-1 fixes have been validated end-to-end, admins can flip
 * COLLECTIVE_ENABLED=1 and migrate waitlist rows into the formal flow.
 *
 * Hybrid Map+DB pattern (per v15 build brief):
 *   - All writes wrapped in `getDb().transaction((tx) => {...})`.
 *   - Sequential hydration via HYDRATE_ORDER (after softCircleStore).
 *   - `withTenant` for tenant-scoped reads; `// CROSS-TENANT (admin)` marker
 *     on admin-aggregate views.
 *   - No `Promise.all`.
 */
import { randomBytes } from "crypto";
import { eq, isNull, and, desc } from "drizzle-orm";
import { getDb } from "./db/connection";
import { collectiveWaitlist as waitlistTable } from "../shared/schema";
import { log } from "./lib/logger";

export type WaitlistKind =
  | "investor_membership"
  | "founder_path_a"
  | "founder_path_b"
  | "cap_table_promote";

export type WaitlistStatus = "waitlist" | "accepted" | "declined";

export interface WaitlistRow {
  id: string;
  tenantId: string;
  kind: WaitlistKind;
  userId: string;
  companyId: string | null;
  payload: Record<string, unknown>;
  chapterHint: string | null;
  status: WaitlistStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  /**
   * v25.13 NM3 — admin review note. Persisted into `payload` so we don't
   * need a schema migration; surfaced explicitly here for ergonomic reads.
   */
  reviewNote?: string | null;
}

export interface CreateWaitlistArgs {
  kind: WaitlistKind;
  userId: string;
  companyId?: string | null;
  payload: Record<string, unknown>;
  chapterHint?: string | null;
  tenantId?: string;
}

/* ---------- In-memory mirror ---------- */
const memWaitlist: WaitlistRow[] = [];

function tenantForRow(args: CreateWaitlistArgs): string {
  if (args.tenantId) return args.tenantId;
  if (args.companyId) return `tenant_co_${args.companyId}`;
  return `tenant_user_${args.userId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(kind: WaitlistKind): string {
  return `wl_${kind}_${randomBytes(6).toString("hex")}`;
}

/* ---------- Writes ---------- */

export function createWaitlistEntry(args: CreateWaitlistArgs): WaitlistRow {
  if (!args.userId) throw new Error("missing_user_id");
  if (!args.kind) throw new Error("missing_kind");
  const tenantId = tenantForRow(args);
  const row: WaitlistRow = {
    id: makeId(args.kind),
    tenantId,
    kind: args.kind,
    userId: args.userId,
    companyId: args.companyId ?? null,
    payload: args.payload ?? {},
    chapterHint: args.chapterHint ?? null,
    status: "waitlist",
    createdAt: nowIso(),
    reviewedAt: null,
    reviewedBy: null,
  };

  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.insert(waitlistTable)
        .values({
          id: row.id,
          tenantId: row.tenantId,
          kind: row.kind,
          userId: row.userId,
          companyId: row.companyId,
          payload: JSON.stringify(row.payload),
          chapterHint: row.chapterHint,
          status: row.status,
          createdAt: row.createdAt,
          reviewedAt: row.reviewedAt,
          reviewedBy: row.reviewedBy,
        } as any)
        .run();
    });
  } catch (err) {
    log.warn(
      "[collectiveWaitlistStore.createWaitlistEntry] DB write failed (memory only):",
      (err as Error).message,
    );
  }
  memWaitlist.push(row);
  return row;
}

/**
 * v25.12 NH-4 — hydrate a single row from the DB on demand when it is
 * absent from the in-memory mirror. Without this, any waitlist row created
 * before the current server process started (or after a hot restart between
 * the create and the review) would 404 on the admin review endpoint even
 * though it exists in the DB. Returns the freshly-hydrated row or null.
 */
function hydrateOneFromDb(id: string): WaitlistRow | null {
  try {
    const db: any = getDb();
    const r: any = db
      .select()
      .from(waitlistTable)
      .where(eq(waitlistTable.id, id))
      .get();
    if (!r) return null;
    let parsedPayload: Record<string, unknown> = {};
    try { parsedPayload = JSON.parse(r.payload ?? "{}"); } catch { /* keep empty */ }
    const row: WaitlistRow = {
      id: r.id,
      tenantId: r.tenant_id ?? r.tenantId ?? "",
      kind: (r.kind ?? "investor_membership") as WaitlistKind,
      userId: r.user_id ?? r.userId,
      companyId: r.company_id ?? r.companyId ?? null,
      payload: parsedPayload,
      chapterHint: r.chapter_hint ?? r.chapterHint ?? null,
      status: (r.status ?? "waitlist") as WaitlistStatus,
      createdAt: r.created_at ?? r.createdAt,
      reviewedAt: r.reviewed_at ?? r.reviewedAt ?? null,
      reviewedBy: r.reviewed_by ?? r.reviewedBy ?? null,
      // v25.13 NM3 — surface persisted review note from payload.
      reviewNote: (parsedPayload.reviewNote as string | undefined) ?? null,
    };
    memWaitlist.push(row);
    return row;
  } catch (err) {
    log.warn("[collectiveWaitlistStore.hydrateOneFromDb] failed:", (err as Error).message);
    return null;
  }
}

export function reviewWaitlistEntry(
  id: string,
  status: WaitlistStatus,
  reviewedBy: string,
  /**
   * v25.13 NM3 — the admin review note. Previously the route accepted a
   * `note` field, echoed it in the response, and threw it away. Now it is
   * persisted via the `payload.reviewNote` slot (no schema migration).
   */
  reviewNote?: string | null,
): WaitlistRow | null {
  let row = memWaitlist.find((r) => r.id === id);
  /* v25.12 NH-4 — fall back to a one-shot DB read when the row is not in
   * the in-memory mirror (post-restart, or cross-process). Previously this
   * function returned null without checking the DB, so admin review of any
   * row not in the current process's cache returned 404. */
  if (!row) {
    row = hydrateOneFromDb(id) ?? undefined;
  }
  if (!row) return null;
  row.status = status;
  row.reviewedAt = nowIso();
  row.reviewedBy = reviewedBy;
  // v25.13 NM3 — persist note into payload + a top-level reviewNote field.
  if (typeof reviewNote === "string") {
    row.reviewNote = reviewNote;
    row.payload = { ...(row.payload ?? {}), reviewNote };
  }
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(waitlistTable)
        .set({
          status: row!.status,
          reviewedAt: row!.reviewedAt,
          reviewedBy: row!.reviewedBy,
          // v25.13 NM3 — the payload column is the source of truth for the
          // review note; updated alongside the status to keep them atomic.
          payload: JSON.stringify(row!.payload ?? {}),
        } as any)
        .where(eq(waitlistTable.id, row!.id))
        .run();
    });
  } catch (err) {
    log.warn(
      "[collectiveWaitlistStore.reviewWaitlistEntry] DB write failed:",
      (err as Error).message,
    );
  }
  return row;
}

/* ---------- Reads ---------- */

export function listWaitlist(filter?: {
  kind?: WaitlistKind;
  status?: WaitlistStatus;
}): WaitlistRow[] {
  // CROSS-TENANT (admin) — admin surface lists every tenant's waitlist.
  let rows = memWaitlist.slice();
  if (filter?.kind) rows = rows.filter((r) => r.kind === filter.kind);
  if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
  // newest first
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows;
}

export function getWaitlistEntry(id: string): WaitlistRow | null {
  /* v25.12 NH-4 — DB fallback path for single-row reads. */
  const inMem = memWaitlist.find((r) => r.id === id);
  if (inMem) return inMem;
  return hydrateOneFromDb(id);
}

export function listWaitlistForUser(userId: string): WaitlistRow[] {
  return memWaitlist.filter((r) => r.userId === userId);
}

/* ---------- Hydration ---------- */

export async function hydrateCollectiveWaitlistStore(): Promise<void> {
  memWaitlist.length = 0;
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(waitlistTable)
      .where(isNull((waitlistTable as any).deletedAt ?? (waitlistTable as any).deleted_at ?? null))
      .all() as any[];
    for (const r of rows) {
      let parsedPayload: Record<string, unknown> = {};
      try { parsedPayload = JSON.parse(r.payload ?? "{}"); } catch { /* keep empty */ }
      memWaitlist.push({
        id: r.id,
        tenantId: r.tenant_id ?? r.tenantId ?? "",
        kind: (r.kind ?? "investor_membership") as WaitlistKind,
        userId: r.user_id ?? r.userId,
        companyId: r.company_id ?? r.companyId ?? null,
        payload: parsedPayload,
        chapterHint: r.chapter_hint ?? r.chapterHint ?? null,
        status: (r.status ?? "waitlist") as WaitlistStatus,
        createdAt: r.created_at ?? r.createdAt,
        reviewedAt: r.reviewed_at ?? r.reviewedAt ?? null,
        reviewedBy: r.reviewed_by ?? r.reviewedBy ?? null,
        // v25.13 NM3 — surface persisted review note from payload.
        reviewNote: (parsedPayload.reviewNote as string | undefined) ?? null,
      });
    }
    if (rows.length > 0) {
      log.info(`[hydrate] collectiveWaitlistStore: ${rows.length} entries restored`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] collectiveWaitlistStore: DB read failed:", msg);
    }
  }
  // Suppress unused-import warning for `and` / `desc` (they're available for
  // future tenant-scoped reads via withTenant).
  void and; void desc;
}

/* ---------- Test helpers ---------- */
export const _testAccessWaitlist = {
  rows: memWaitlist,
  reset(): void { memWaitlist.length = 0; },
};
