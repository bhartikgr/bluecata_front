/**
 * server/lib/wave15Routes.ts
 *
 * WAVE 15 — REACHABILITY for the engines this wave wrote or found unwired.
 * "An engine with no route is NOT shipped." Every route below names its sink.
 *
 *   ORP-033  GET/PUT /api/founder/notification-preferences
 *              -> founder_notification_preference (enforced in notificationCadence)
 *   ORP-062  GET  /api/admin/orphan-surfaces          -> LIVE router x orphan_surface_disposition
 *   ORP-053  GET  /api/admin/ddl-column-dispositions  -> ddl_column_disposition + live schema proof
 *   A-2      GET  /api/admin/audit/incidents
 *            POST /api/admin/audit/incidents/:key/clear -> platform_audit_incident
 *            GET  /api/platform/audit-banner             -> the banner the client renders
 *   A-3b     GET  /api/admin/bridge/mode                 -> bridgeRuntime (READ ONLY) + GATE-A3
 *   CP-BRG-07 GET /api/partner/fee-schedule/aggregate     -> composed fee resolvers + SSE revision
 *
 * AUTHORISATION. Admin surfaces use `requireAdmin`. The partner aggregate uses
 * `requirePartnerAuth` and reads `partnerId` from `req.partnerContext`, never
 * from the client, so no partner can price another partner's account. The
 * founder preference routes act on the SESSION user id only — a body-supplied
 * user id is ignored, so one founder cannot mute another's notifications.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./authMiddleware";
import { requirePartnerAuth } from "./requirePartnerAuth";
import { getUserContext } from "./userContext";
import { log } from "./logger";
import {
  NOTIFICATION_PREF_KEYS,
  PREF_CHANNELS,
  listPreferences,
  setPreference,
  enforcementCoverage,
  NotificationPrefError,
} from "./founderNotificationPrefs";
import { ALL_NOTIFICATION_KINDS } from "../notificationsStore";
import {
  buildOrphanInventory,
  listDdlColumnDispositions,
  verifyDdlColumnRulings,
} from "./wave15OrphanSurfaces";
import {
  listIncidents,
  clearIncident,
  platformBannerState,
  AuditIncidentError,
} from "./wave15AuditIncidents";
import { bridgeModeDisclosure } from "./wave15BridgeMode";
import { buildFeeScheduleAggregate } from "./wave15FeeScheduleAggregate";
import { verifyTenantAuditChain } from "../adminPlatformStore";
import { rawDb } from "../db/connection";

/**
 * The LIVE audit-chain signal, computed the same way
 * `GET /api/admin/audit/chain/verify` computes it
 * (server/adminPlatformStore.ts:2018-2027): per-tenant verification through the
 * single shared verifier, ANDed. Deliberately NOT a new chain query — the
 * comment on that route warns that "any drift here forks the chain", and a
 * second, subtly different verifier is exactly the "second path to the same
 * conclusion" that makes one of them wrong.
 *
 * @returns ok, or null when verification could not run at all. NEVER `true` on
 *   failure: an unverifiable chain must not clear an audit incident.
 */
function liveAuditChainOk(tenantId?: string): { ok: boolean | null; detail: string } {
  try {
    const db = rawDb();
    if (tenantId) {
      const r = verifyTenantAuditChain(db, tenantId);
      return { ok: r.ok, detail: `tenant:${tenantId} links=${r.totalLinks} brokenAt=${r.brokenAt}` };
    }
    const tenants = db.prepare(`SELECT DISTINCT tenant_id FROM audit_log`).all() as Array<{ tenant_id: string }>;
    if (tenants.length === 0) {
      // No audit rows at all. That is not a verified chain, it is an absent one.
      return { ok: null, detail: "no audit_log rows: nothing to verify" };
    }
    const per = tenants.map((t) => verifyTenantAuditChain(db, t.tenant_id));
    const ok = per.every((p) => p.ok);
    const broken = per.filter((p) => !p.ok).map((p) => `${p.tenantId}@${p.brokenAt}`);
    return {
      ok,
      detail: `tenants=${per.length} links=${per.reduce((s, p) => s + p.totalLinks, 0)}${broken.length ? ` broken=[${broken.join(",")}]` : ""}`,
    };
  } catch (err) {
    return { ok: false, detail: `verifier unavailable: ${String(err)}` };
  }
}

function actorOf(req: Request): string {
  return String((req as any).user?.id ?? (req as any).userId ?? getUserContext(req)?.userId ?? "u_unknown");
}

function sessionUserId(req: Request): string {
  const ctx = getUserContext(req);
  return String(ctx?.userId ?? (req as any).user?.id ?? "");
}

function oops(res: Response, err: unknown, where: string): void {
  const msg = err instanceof Error ? err.message : String(err);
  log.error(`[wave15Routes] ${where}: ${msg}`);
  res.status(500).json({ ok: false, error: "WAVE15_ROUTE_FAILED", message: msg });
}

export function registerWave15Routes(app: Express): void {
  /* ══ ORP-033 — founder notification preferences ═══════════════════════════ */

  app.get("/api/founder/notification-preferences", (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: "AUTH_REQUIRED" });
      return;
    }
    try {
      res.json({
        ok: true,
        preferences: listPreferences(userId),
        channels: PREF_CHANNELS,
        catalog: NOTIFICATION_PREF_KEYS.map((d) => ({
          key: d.key,
          label: d.label,
          locked: d.locked,
          kinds: d.kinds,
          defaultEnabled: d.defaultEnabled,
        })),
        /* The HONEST coverage statement. The UI renders it verbatim rather than
           implying every notification honours these switches. */
        coverage: enforcementCoverage(ALL_NOTIFICATION_KINDS.length),
      });
    } catch (err) {
      oops(res, err, "GET notification-preferences");
    }
  });

  app.put("/api/founder/notification-preferences", (req: Request, res: Response) => {
    const userId = sessionUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: "AUTH_REQUIRED" });
      return;
    }
    const body = (req.body ?? {}) as { prefKey?: unknown; channel?: unknown; enabled?: unknown };
    if (typeof body.prefKey !== "string" || typeof body.channel !== "string" || typeof body.enabled !== "boolean") {
      res.status(400).json({
        ok: false,
        error: "NOTIFICATION_PREF_BAD_REQUEST",
        message: "prefKey (string), channel (string) and enabled (boolean) are required.",
      });
      return;
    }
    try {
      const preferences = setPreference({
        // NOTE: the session user, never a body-supplied id.
        userId,
        prefKey: body.prefKey,
        channel: body.channel,
        enabled: body.enabled,
        actorId: actorOf(req),
      });
      res.json({ ok: true, preferences });
    } catch (err) {
      if (err instanceof NotificationPrefError) {
        // 409 for LOCKED (a legitimate key the caller may not disable),
        // 400 for an unknown key or channel (a malformed request).
        const status = err.code === "NOTIFICATION_PREF_LOCKED" ? 409 : 400;
        res.status(status).json({ ok: false, error: err.code, message: err.message });
        return;
      }
      oops(res, err, "PUT notification-preferences");
    }
  });

  /* ══ ORP-062 — the live orphan-surface inventory ══════════════════════════ */

  app.get("/api/admin/orphan-surfaces", requireAdmin, (req: Request, res: Response) => {
    try {
      // Computed from THIS app instance, so it can never be stale.
      const inv = buildOrphanInventory(app);
      const silo = typeof req.query.silo === "string" ? req.query.silo : null;
      const disposition = typeof req.query.disposition === "string" ? req.query.disposition : null;
      const entries = inv.entries.filter(
        (e) => (!silo || e.silo === silo) && (!disposition || e.disposition === disposition),
      );
      res.json({
        ok: true,
        computedFrom: "live express router",
        mountedCount: inv.mountedCount,
        counts: inv.counts,
        siloCounts: inv.siloCounts,
        entries,
        orphanRulings: inv.orphanRulings,
        nonRouteRulings: inv.nonRouteRulings,
        note:
          "Dispositions are stored rulings; a mounted route with no ruling reports 'pending' by absence. " +
          "orphanRulings are stored rulings whose route is no longer mounted.",
      });
    } catch (err) {
      oops(res, err, "GET orphan-surfaces");
    }
  });

  /* ══ ORP-053 — DDL-only column rulings, published AND verified ════════════ */

  app.get("/api/admin/ddl-column-dispositions", requireAdmin, (_req: Request, res: Response) => {
    try {
      const rows = listDdlColumnDispositions();
      const verification = verifyDdlColumnRulings();
      // A `document` ruling whose column has vanished is a VIOLATED ruling, so
      // the response is a 409 rather than a 200 with a warning field the UI
      // might not render. Downgrading a real break to a warning is precisely how
      // an earlier wave shipped a schema failure with CI exiting 0.
      res.status(verification.ok ? 200 : 409).json({
        ok: verification.ok,
        rows,
        verification,
        error: verification.ok ? undefined : "DDL_RULING_VIOLATED",
      });
    } catch (err) {
      oops(res, err, "GET ddl-column-dispositions");
    }
  });

  /* ══ A-2 — platform audit incident banner ════════════════════════════════ */

  app.get("/api/admin/audit/incidents", requireAdmin, (req: Request, res: Response) => {
    try {
      const state = req.query.state === "open" || req.query.state === "cleared" ? req.query.state : undefined;
      res.json({ ok: true, incidents: listIncidents(state ? { state } : undefined) });
    } catch (err) {
      oops(res, err, "GET audit/incidents");
    }
  });

  app.post("/api/admin/audit/incidents/:key/clear", requireAdmin, (req: Request, res: Response) => {
    const key = String(req.params.key ?? "");
    const body = (req.body ?? {}) as { evidence?: unknown; tenantId?: unknown };
    if (typeof body.evidence !== "string" || body.evidence.trim().length < 20) {
      res.status(400).json({
        ok: false,
        error: "AUDIT_EVIDENCE_REQUIRED",
        message: "Provide at least 20 characters of evidence naming the artefact that clears this incident.",
      });
      return;
    }
    try {
      /* THE LIVE SIGNAL. The incident may only be cleared when the audit chain
         ACTUALLY verifies right now — the durable row is not allowed to be
         cleared on the strength of a claim. A previous incident record named a
         mitigation file that did not exist; that is why `clearIncident` also
         re-checks every path named in the evidence and rejects the clear when
         one is missing. */
      const tenantId = typeof body.tenantId === "string" && body.tenantId ? body.tenantId : undefined;
      const { ok: liveSignalOk, detail: liveSignalDetail } = liveAuditChainOk(tenantId);
      const incident = clearIncident({
        incidentKey: key,
        evidence: body.evidence,
        clearedBy: actorOf(req),
        liveSignalOk,
        liveSignalDetail,
      });
      res.json({ ok: true, incident, liveSignalOk, liveSignalDetail });
    } catch (err) {
      if (err instanceof AuditIncidentError) {
        res.status(err.code === "AUDIT_INCIDENT_NOT_FOUND" ? 404 : 409).json({
          ok: false,
          error: err.code,
          message: err.message,
          detail: (err as any).detail ?? undefined,
        });
        return;
      }
      oops(res, err, "POST audit/incidents/clear");
    }
  });

  /**
   * The banner the client actually renders. Authenticated but not admin-only:
   * the honest statement "audit-derived figures are unattested" is for whoever
   * is reading those figures, not only for admins.
   */
  app.get("/api/platform/audit-banner", (req: Request, res: Response) => {
    try {
      const tenantId = typeof req.query.tenantId === "string" && req.query.tenantId ? req.query.tenantId : undefined;
      const live = liveAuditChainOk(tenantId);
      res.json({ ok: true, banner: platformBannerState(live.ok), liveSignalDetail: live.detail });
    } catch (err) {
      oops(res, err, "GET platform/audit-banner");
    }
  });

  /* ══ A-3b — bridge mode DISCLOSURE (read-only; the flip is the owner's) ═══ */

  app.get("/api/admin/bridge/mode", requireAdmin, (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, disclosure: bridgeModeDisclosure() });
    } catch (err) {
      oops(res, err, "GET bridge/mode");
    }
  });

  /* ══ CP-BRG-07 — feeSchedule aggregate ═══════════════════════════════════ */

  app.get("/api/partner/fee-schedule/aggregate", requirePartnerAuth, (req: Request, res: Response) => {
    const partnerId = String((req as any).partnerContext?.partnerId ?? "");
    if (!partnerId) {
      res.status(403).json({ ok: false, error: "PARTNER_NOT_RESOLVED" });
      return;
    }
    try {
      const sizeRaw = req.query.committedMinor;
      const committedMinor =
        typeof sizeRaw === "string" && sizeRaw !== "" && Number.isSafeInteger(Number(sizeRaw))
          ? Number(sizeRaw)
          : undefined;
      const aggregate = buildFeeScheduleAggregate(partnerId, { committedMinor });
      res.json({ ok: true, aggregate, sseTopic: "partner-workspace", sseScope: partnerId });
    } catch (err) {
      oops(res, err, "GET fee-schedule/aggregate");
    }
  });
}
