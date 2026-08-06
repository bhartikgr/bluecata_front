/**
 * Sprint 17 D4 — client-side realtime invalidation hook.
 *
 * Connects to /api/events/stream and translates server-side mutation
 * events into queryClient.invalidateQueries() calls. Silent fallback if
 * SSE isn't available (proxy env, no URL rewrite for EventSource).
 *
 * Map: aggregate → query keys to invalidate.
 */
import { useEffect } from "react";
import { queryClient } from "./queryClient";

const AGGREGATE_TO_KEYS: Record<string, string[]> = {
  company:           ["/api/companies", "/api/admin/companies"],
  round:             ["/api/rounds", "/api/captable"],
  capTablePosition:  ["/api/captable", "/api/rounds"],
  softCircle:        ["/api/rounds", "/api/founder/crm"],
  // Sprint 22 Wave 2: user aggregate now also invalidates /api/auth/me (DEF-F17)
  user:              ["/api/admin/users", "/api/auth/secure/me", "/api/auth/me"],
  termSheet:         ["/api/termsheets", "/api/rounds"],
  pcrmContact:       ["/api/founder/crm", "/api/investor/crm"],
  post:              ["/api/comms/posts"],
  commsThread:       ["/api/comms/channels", "/api/comms/me"],
  dataroom:          ["/api/founder/dataroom/files", "/api/founder/dataroom/engagement"],
  // Sprint 21 Wave C: report aggregate also invalidates per-company updates feed
  report:            ["/api/founder/reports2", "/api/investor/companies"],
  invitation:        ["/api/rounds", "/api/investor/invitations"],
  // Sprint 21 Wave C: captable_position changes invalidate per-company portfolio view
  captable_position: ["/api/companies", "/api/cap-table", "/api/holders", "/api/investor/portfolio2"],
  collective_nomination: ["/api/investor/companies"],
  notificationPrefs: ["/api/notifications"],
  auditEntry:        ["/api/admin/audit-log"],
  // Sprint 21 Wave D: investor CRM realtime refresh
  investor_crm:      ["/api/investor/crm"],
  // Sprint 22 Wave 2: new aggregates (DEF-F17)
  notification:      ["/api/notifications"],
  collective_application: ["/api/collective/applications", "/api/founder/collective/applications"],
  crm_contact:       ["/api/investor/crm", "/api/founder/investor-crm"],
  /* D2 LOCK 4 (§15.4, V32-M1) — partnerRepresentation. Ozan requirement #5:
   * one partner-driven stage change invalidates the right queries on all four
   * pillars. Server-side `eventVisibleToCaller` has ALREADY decided which
   * clients receive the frame, so this list is the UNION of the four pillars'
   * keys; a recipient simply has no registered query for the other pillars'
   * keys and `queryClient.invalidateQueries` on an unregistered key is a no-op
   * (no fetch, no error). See ASSUMPTIONS_D2.md A-D2-02.
   *
   * REQUIRED, not cosmetic: without this entry `AGGREGATE_TO_KEYS[e.aggregate] ?? []`
   * at :83 resolves to `[]`, so every delivered partnerRepresentation frame would
   * invalidate nothing and be silently dropped on all four pillars.
   *
   * `/api/admin/mfcrm/stages-overview` (§16.3) is deliberately OMITTED — grep-verified
   * absent from client/src today; adding it now would be an invented key. It belongs to
   * the wave that ships §16.3. */
  partnerRepresentation: [
    // pillar 3 — Consortium Partner's own workspace (the three §15.4 surfaces)
    "/api/partner/me/pipeline",
    "/api/partner/me/portfolio",
    "/api/partner/me/portfolio/positions",
    "/api/partner/me/clients",
    "/api/partner/me/mfcrm/engagements",
    "/api/partner/me/mfcrm/dashboard",
    // pillar 2 — Capavate direct
    "/api/companies",
    "/api/founder/crm",
    // pillar 1 — Collective admin / DSC
    "/api/collective/dsc/pipeline",
    "/api/collective/companies",
    // pillar 4 — Admin superuser
    "/api/admin/companies",
    "/api/admin/audit-log",
  ],
};

interface MutationEvent {
  aggregate: string;
  id: string;
  change: "create" | "update" | "delete";
  ts: number;
}

/**
 * D2 LOCK 4 — the aggregate string the four pillars subscribe to for
 * partner-driven stage changes. Exported as a const so no pillar's component can
 * typo it (a typo'd string silently never fires, which is the worst failure mode
 * for a cross-integration guarantee).
 *
 * `evt.id` is `${partnerId}:${companyId}`; consumers that need the pair should
 * split on ":" and fail closed on anything that is not exactly two non-empty
 * halves — the same rule the server's `parsePartnerRepresentationId` applies.
 * The frame carries NO stage payload by design (one JSON frame is shared by every
 * recipient, so per-recipient redaction is impossible at `eventBus.ts:91`); each
 * pillar re-reads its own scoped endpoint. See ASSUMPTIONS_D2.md TOUGH QUESTION 4.
 */
export const PARTNER_REPRESENTATION_AGGREGATE = "partnerRepresentation";

type MutationHandler = (evt: MutationEvent) => void;
const mutationHandlers: Map<string, Set<MutationHandler>> = new Map();

/**
 * Subscribe to a specific aggregate mutation event.
 * Returns an unsubscribe function — call it in useEffect cleanup.
 */
export function subscribeToMutation(
  aggregate: string,
  handler: MutationHandler,
): () => void {
  if (!mutationHandlers.has(aggregate)) {
    mutationHandlers.set(aggregate, new Set());
  }
  mutationHandlers.get(aggregate)!.add(handler);
  return () => {
    mutationHandlers.get(aggregate)?.delete(handler);
  };
}

/** React hook — opens the SSE stream once and keeps it alive. */
export function useRealtimeSync(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apiBase = ("__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__");
    // Skip SSE in deployed proxy env (EventSource doesn't get URL rewriting).
    if (!apiBase && /sites\.pplx\.app/.test(window.location.hostname)) return;
    let es: EventSource | null = null;
    let closed = false;
    try {
      es = new EventSource(`${apiBase}/api/events/stream`);
      es.addEventListener("mutation", (evt: MessageEvent) => {
        try {
          const e: MutationEvent = JSON.parse(evt.data);
          // Invalidate query keys for this aggregate
          const keys = AGGREGATE_TO_KEYS[e.aggregate] ?? [];
          for (const k of keys) {
            queryClient.invalidateQueries({ queryKey: [k] });
          }
          // Fan out to targeted subscribers (components that need per-event logic)
          const handlers = mutationHandlers.get(e.aggregate);
          if (handlers) {
            for (const h of handlers) {
              try { h(e); } catch { /* swallow */ }
            }
          }
        } catch { /* swallow */ }
      });
      es.onerror = () => {
        // Silent fallback — close to prevent retry storms / console spam
        if (!closed && es) {
          closed = true;
          try { es.close(); } catch { /* noop */ }
        }
      };
    } catch {
      /* fall back to polling-only */
    }
    return () => {
      closed = true;
      if (es) { try { es.close(); } catch { /* noop */ } }
    };
  }, []);
}
