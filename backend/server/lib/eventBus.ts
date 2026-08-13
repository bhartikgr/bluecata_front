/**
 * Sprint 17 D4 — server-side event bus + realtime SSE distribution.
 *
 * Stores call `emitMutation({ aggregate, id, change })` after a write.
 * The bus fans out to:
 *   1. Outbound bridge (existing) — already wired upstream
 *   2. SSE subscribers via /api/events/stream — invalidation hints to
 *      React Query, so a founder edit shows up on the investor screen
 *      within ~1 second.
 */
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { getUserContext } from "./userContext";
import { founderOwnedCompanyIds, investorVisibleCompanyIds, companyIdForRound } from "./tenantAuth";
/* ── WAVE 33B · CP-MFC-20 — STATIC IMPORTS, AND WHY ──────────────────────────
 * This block used to be `createRequire(import.meta.url)` plus two lazy requires
 * inside `eventVisibleToCaller`. Both were resolved at CALL time against the
 * file the module was loaded from — which in production is the single bundled
 * `dist/index.cjs`, where neither `./eventBusPillarHelpers` nor
 * `../partnerWorkspaceStore` exists as a file. Proven by execution (see
 * `wave33_mfc20_crosspillar.test.ts`, group B): esbuild leaves an aliased
 * `requireCjs("./eventBusPillarHelpers")` call untouched — it does NOT bundle
 * what it cannot see as a static dependency — and resolving that specifier from
 * a bundle path throws MODULE_NOT_FOUND.
 *
 * The throw landed inside `try { … } catch { /* client gone *\/ }` in the
 * fan-out at the bottom of this file, so it was SWALLOWED: every
 * `partnerRepresentation` frame was dropped, on all four pillars, in production
 * only, with no log line. The Wave 32B `co-members` defect exactly — dev-green,
 * test-green, dead where it ships.
 *
 * Static imports now. The cycle the old comment feared
 * (eventBus → partnerWorkspaceStore → eventBus) is real but harmless in both
 * runtimes, because neither module touches the other's bindings at module-init
 * time — only inside functions. That is asserted BY EXECUTION in group C, in
 * both import orders and in a CJS bundle, rather than assumed. */
import {
  parsePartnerRepresentationId,
  hasActivePartnerAttribution,
  hasActivePartnerEngagement,
  isCapavatePortfolioCompany,
  isCollectiveMemberCompany,
} from "./eventBusPillarHelpers";
import { partnerTeamStore } from "../partnerWorkspaceStore";

export interface MutationEvent {
  aggregate: string;     // "company" | "round" | "softCircle" | etc.
  id: string;
  version?: number;
  change: "create" | "update" | "delete";
  tenantId?: string;
  ts: number;
}

const bus = new EventEmitter();
bus.setMaxListeners(1000);

export function emitMutation(e: Omit<MutationEvent, "ts"> & { ts?: number }): void {
  const evt: MutationEvent = { ts: Date.now(), ...e };
  bus.emit("mutation", evt);
}

export function onMutation(fn: (e: MutationEvent) => void): () => void {
  bus.on("mutation", fn);
  return () => bus.off("mutation", fn);
}

/* ============================================================
 *  /api/events/stream — SSE handler
 * ============================================================ */
export function realtimeStreamHandler(req: Request, res: Response) {
  // B15 (v24.0 LOCKDOWN) — the SSE stream previously had NO auth and wrote
  // EVERY mutation event (aggregate + id + change for every tenant) to EVERY
  // connected client, leaking which companies/rounds/invitations changed across
  // tenant boundaries. We now (1) require an authenticated session, and (2)
  // filter each event so a client only receives events for resources it can
  // see. The event payload is only a cache-invalidation hint, but the ids it
  // carries are themselves tenant-sensitive.
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed || !ctx.userId) {
    res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    return;
  }
  const isAdmin = !!ctx.isAdmin;
  // Pre-compute the caller's accessible company set + tenant set.
  const accessibleCompanies = new Set<string>();
  founderOwnedCompanyIds(ctx).forEach((id) => accessibleCompanies.add(id));
  investorVisibleCompanyIds(ctx).forEach((id) => accessibleCompanies.add(id));
  const accessibleTenants = new Set<string>();
  accessibleCompanies.forEach((cid) => accessibleTenants.add(`tenant_co_${cid}`));

  // Decide whether a single mutation event is visible to THIS caller.
  const eventVisibleToCaller = (evt: MutationEvent): boolean => {
    if (isAdmin) return true;
    // Tenant match (events that carry an explicit tenantId).
    if (evt.tenantId && accessibleTenants.has(evt.tenantId)) return true;
    // Resolve the event's company by aggregate type.
    if (evt.aggregate === "company") return accessibleCompanies.has(evt.id);
    if (evt.aggregate === "round") {
      const cid = companyIdForRound(evt.id);
      return !!cid && accessibleCompanies.has(cid);
    }
    /* ============================================================================
     * D2 LOCK 4 — partnerRepresentation: cross-pillar visibility (§15.4, V32-M1,
     * V33-F2 active-attribution check, V33-1-B3 ESM shim; D2.5 four-pillar extension).
     *
     * Ozan requirement #5, "cross-integrated: change in one area propagates
     * everywhere". When a Consortium Partner moves a founder A -> B, ONE event must
     * light up up to four surfaces. `evt.id` is `${partnerId}:${companyId}`.
     *
     *   pillar 4  Admin superuser  -> already satisfied by `if (isAdmin) return true`
     *                                 at :64 above. NOT re-implemented here; that line
     *                                 is byte-preserved and is the whole Admin rule
     *                                 ("always sees the event").
     *   pillar 3  emitting Consortium Partner -> team membership AND active attribution
     *   pillar 2  Capavate direct   -> caller entitled to the company AND the company
     *                                  is a Capavate direct portfolio company
     *   pillar 1  Collective admin  -> caller is an active Collective DSC principal AND
     *                                  the company is a Collective member company
     *
     * Fail-closed everywhere. Every predicate is a fresh indexed SELECT per call
     * (no cache, Ozan requirement #4) so a revoke landing between two SSE ticks is
     * observed by the very next tick.
     * ============================================================================ */
    if (evt.aggregate === "partnerRepresentation") {

      // Fail closed on a malformed id (missing ':', empty half, or 3+ segments).
      const parsed = parsePartnerRepresentationId(evt.id);
      if (!parsed) return false;
      const { partnerId: emittedPartnerId, companyId: emittedCompanyId } = parsed;

      /* ---- pillar 3: the emitting Consortium Partner's own dashboard ---------- */
      // Real method: partnerWorkspaceStore.ts:1035 (object exported at :875).
      const teamMember = partnerTeamStore.findByUserId(ctx.userId);
      if (teamMember) {
        // A partner-side caller is resolved ONLY through the partner pillar. Never
        // fall through to the Capavate/Collective pillars: that would let partner A's
        // team read partner B's stage moves via a shared founder (scope leak).
        if (teamMember.partnerId !== emittedPartnerId) return false;
        // V33-F2: team membership alone is NOT enough. An attribution that has been
        // revoked (or never existed) for this exact pair must not deliver.
        return hasActivePartnerAttribution(emittedPartnerId, emittedCompanyId);
      }

      /* ---- cross-pillar precondition: the mandate must still be live ---------- */
      // Non-partner pillars are told "a partner moved your founder" only while that
      // partner actually holds the engagement. Revoked/terminated mid-event => the
      // partner may still see its own workspace row (above), but propagation to
      // Capavate direct and Collective is DENIED.
      if (!hasActivePartnerEngagement(emittedPartnerId, emittedCompanyId)) return false;

      /* ---- pillar 2: Capavate direct ----------------------------------------- */
      // Two conjuncts, both required: (a) this caller is entitled to the company at
      // all (reuses the already-computed accessibleCompanies set at :56-58 — no new
      // entitlement surface invented), and (b) the company really is a Capavate
      // direct portfolio company.
      if (accessibleCompanies.has(emittedCompanyId) && isCapavatePortfolioCompany(emittedCompanyId)) {
        return true;
      }

      /* ---- pillar 1: Collective admin ---------------------------------------- */
      // `ctx.collective` is { status, role, expiresAt } (lib/userContext.ts:182-186).
      // 'dsc' is the Collective's own screening/administration principal
      // (CollectiveRole = 'standard' | 'dsc' | 'consortium_partner' | null, :137-141).
      if (
        ctx.collective?.status === "active" &&
        ctx.collective?.role === "dsc" &&
        isCollectiveMemberCompany(emittedCompanyId)
      ) {
        return true;
      }

      // No pillar matched -> fail closed. This is the "founder is NEITHER Capavate
      // nor Collective" case: only the emitting partner (above) and Admin (:64) see it.
      return false;
    }
    // For aggregates we cannot resolve to a company/tenant (e.g. user-scoped
    // events whose id IS the caller's own userId), only forward when the id is
    // the caller themselves; otherwise fail closed.
    if (evt.id === ctx.userId) return true;
    return false;
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // Open with a hello frame so the client knows we're up
  res.write(`event: hello\ndata: {"ok":true,"ts":${Date.now()}}\n\n`);

  const off = onMutation(evt => {
    try {
      // B15 — tenant/company filter before writing to this client's stream.
      if (!eventVisibleToCaller(evt)) return;
      res.write(`event: mutation\ndata: ${JSON.stringify(evt)}\n\n`);
    } catch { /* client gone */ }
  });

  // Heartbeat every 25s keeps proxies happy
  const beat = setInterval(() => {
    try { res.write(`event: ping\ndata: ${Date.now()}\n\n`); } catch { /* gone */ }
  }, 25_000);

  req.on("close", () => {
    off();
    clearInterval(beat);
    try { res.end(); } catch { /* noop */ }
  });
}

export const realtimeBus = bus;
