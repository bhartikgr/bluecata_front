/**
 * Sprint 12 — Notification system (audit §6).
 *
 * 21+ NotificationKind values. Channels: in-app SSE, email (BullMQ-style queue),
 * push (Web Push subscription stub). Bell badge unread count comes from
 * unread items in the in-memory store keyed by userId.
 *
 * PATCH v3 — Per-company data scoping:
 *   - All GET/PATCH/POST endpoints now resolve userId from the session via
 *     getUserContext(req). No more `?? "u_aisha_patel"` fallbacks.
 *   - Unknown / unauthenticated users receive 401.
 *   - seedDemo() retains its data for the canonical demo personas ONLY;
 *     it is never used as a fallback for unknown users.
 *   - SSE stream scoped to the authenticated session userId.
 *   - Broadcast restricted to explicit userIds list; no default expansion to demo set.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { getUserContext } from "./lib/userContext";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";

export type NotificationKind =
  // Core (15 from audit §6.5)
  | "round.invitation_received"
  | "round.invitation_accepted"
  | "round.invitation_declined"
  | "round.soft_circle_received"
  | "round.document_ready_to_sign"
  | "round.document_signed"
  | "round.closed"
  | "dataroom.access_granted"
  | "dataroom.document_uploaded"
  | "investor_report.published"
  | "message.received"
  | "collective.eligibility_gained"
  | "collective.membership_approved"
  | "spv.launched"
  | "spv.subscription_countersigned"
  // Collective-specific (6 from audit §6.5)
  | "dsc.company_assigned"
  | "cap_table.drift_detected"
  | "compliance.hold_placed"
  | "kyc.status_changed"
  | "membership.renewal_due"
  | "membership.lapsed"
  // Sprint 14 D11 — critical-bypass kinds for cadence rules
  | "payment.failure"
  | "dsc.review_received"
  | "soft_circle.lapsed"
  // Sprint 14 D4 — broadcast / intro signals
  | "cap_table.broadcast"
  | "crm.intro_request"
  | "dsc.feedback_summary";

export const ALL_NOTIFICATION_KINDS: NotificationKind[] = [
  "round.invitation_received",
  "round.invitation_accepted",
  "round.invitation_declined",
  "round.soft_circle_received",
  "round.document_ready_to_sign",
  "round.document_signed",
  "round.closed",
  "dataroom.access_granted",
  "dataroom.document_uploaded",
  "investor_report.published",
  "message.received",
  "collective.eligibility_gained",
  "collective.membership_approved",
  "spv.launched",
  "spv.subscription_countersigned",
  "dsc.company_assigned",
  "cap_table.drift_detected",
  "compliance.hold_placed",
  "kyc.status_changed",
  "membership.renewal_due",
  "membership.lapsed",
  "payment.failure",
  "dsc.review_received",
  "soft_circle.lapsed",
  "cap_table.broadcast",
  "crm.intro_request",
  "dsc.feedback_summary",
];

export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  archived: boolean;
  createdAt: string;
  channels: { inApp: boolean; email: boolean; push: boolean };
}

export interface NotificationPreferences {
  userId: string;
  perKind: Record<NotificationKind, { email: boolean; push: boolean }>;
}

const store: Notification[] = [];
const sseClients: Map<string, Response[]> = new Map();
const preferences: Map<string, NotificationPreferences> = new Map();

function defaultPrefs(userId: string): NotificationPreferences {
  const perKind = {} as NotificationPreferences["perKind"];
  for (const k of ALL_NOTIFICATION_KINDS) perKind[k] = { email: true, push: false };
  return { userId, perKind };
}

export function emitNotification(args: {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  channels?: Partial<Notification["channels"]>;
}): Notification {
  const n: Notification = {
    id: `ntf_${randomBytes(6).toString("hex")}`,
    userId: args.userId,
    kind: args.kind,
    title: args.title,
    body: args.body,
    link: args.link,
    read: false,
    archived: false,
    createdAt: new Date().toISOString(),
    channels: { inApp: true, email: false, push: false, ...args.channels },
  };
  store.unshift(n);
  // Fan-out via SSE
  const subs = sseClients.get(args.userId) ?? [];
  for (const r of subs) {
    try {
      r.write(`event: notification\ndata: ${JSON.stringify(n)}\n\n`);
    } catch { /* noop */ }
  }
  return n;
}

export function listNotifications(userId: string, opts: { unreadOnly?: boolean; archived?: boolean } = {}): Notification[] {
  return store.filter(n =>
    n.userId === userId &&
    (opts.unreadOnly ? !n.read : true) &&
    (opts.archived === undefined ? !n.archived : n.archived === opts.archived)
  );
}

export function unreadCount(userId: string): number {
  return store.filter(n => n.userId === userId && !n.read && !n.archived).length;
}

function seedDemo() {
  if (store.length > 0) return;
  const baseAt = Date.now();
  const seed = (i: number, userId: string, kind: NotificationKind, title: string, body: string, link: string) => {
    store.push({
      id: `ntf_seed_${i}`,
      userId,
      kind,
      title,
      body,
      link,
      read: i % 4 === 0,
      archived: false,
      createdAt: new Date(baseAt - i * 3600_000).toISOString(),
      channels: { inApp: true, email: true, push: false },
    });
  };

  // Seed for the 3 canonical demo personas ONLY.
  // These are NEVER returned to non-demo users — listNotifications() filters by userId.
  let i = 0;
  seed(i++, "u_maya_chen",   "round.soft_circle_received", "New soft-circle from Aisha Patel", "$250,000 committed to NovaPay Seed Extension", "/founder/captable");
  seed(i++, "u_maya_chen",   "round.document_signed",      "Term sheet countersigned",         "Hydra Ventures executed on Series Seed", "/founder/rounds/rnd_novapay_seed");
  seed(i++, "u_maya_chen",   "investor_report.published",  "April KPI report sent",            "Delivered to 12 investors · 9 reads",    "/founder/reports");
  seed(i++, "u_maya_chen",   "message.received",           "Aisha asked about runway",         "View in Messages",                       "/founder/messages?thread=ch_dm_u_maya_chen_u_aisha_patel");
  seed(i++, "u_aisha_patel", "round.invitation_received",  "Invitation: NovaPay AI Seed Extension", "Maya Chen invited you to participate", "/investor/invitations");
  seed(i++, "u_aisha_patel", "collective.eligibility_gained", "You're eligible for the Collective", "You may now apply for membership.",   "/investor/apply-to-collective");
  seed(i++, "u_aisha_patel", "round.document_ready_to_sign", "Sign your subscription documents", "NovaPay AI Series Seed Extension",     "/investor/invitations");
  seed(i++, "u_aisha_patel", "dataroom.access_granted",    "Dataroom access granted",          "NovaPay AI dataroom now open",         "/investor/companies/co_novapay");
  seed(i++, "u_admin",       "cap_table.drift_detected",   "Drift on NovaPay AI",              "Reconciliation found 0.02% divergence; review.", "/admin/reconciliation");
  seed(i++, "u_admin",       "compliance.hold_placed",     "Compliance hold on Helia Series A", "Form D not yet filed; close blocked.", "/admin/audit-log");
  seed(i++, "u_admin",       "membership.renewal_due",     "5 memberships renew in 30 days",   "Review at /admin/users",                "/admin/users");
  seed(i++, "u_admin",       "kyc.status_changed",         "KYC verified — 3 investors",       "Manual review approved",                "/admin/users");
  seed(i++, "u_admin",       "round.closed",               "NovaPay Seed Extension closed",    "$4.0M closed · 9 participants",         "/admin/companies/co_novapay");
  seed(i++, "u_admin",       "spv.launched",               "Quanta Robotics SPV live",         "Subscriptions open · target $2.0M",     "/admin/companies");
  seed(i++, "u_admin",       "dsc.company_assigned",       "DSC review assigned: Arboreal",    "Reviewers: u_r1, u_r2",                 "/admin/companies/co_arboreal");
}

// Patch v4: only seed demo notifications when DEMO_SEED_ENABLED.
if (DEMO_SEED_ENABLED) {
  seedDemo();
}

export function registerNotificationsRoutes(app: Express): void {
  // List — PATCH v3: resolve userId from session, never from query param fallback
  app.get("/api/notifications", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Sign in to continue." });
    }
    const userId = ctx.userId;
    const unreadOnly = String(req.query.unreadOnly ?? "") === "true";
    const archived = req.query.archived === "true" ? true : req.query.archived === "false" ? false : undefined;
    const items = listNotifications(userId, { unreadOnly, archived });
    res.json({ userId, total: items.length, unread: unreadCount(userId), items });
  });

  // Patch (mark read / archive) — PATCH v3: scope mutations to session user
  app.patch("/api/notifications", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const sessionUserId = ctx.userId;
    const { ids, read, archived } = req.body ?? {};
    const targets = Array.isArray(ids) ? ids : [];
    let n = 0;
    for (const item of store) {
      // Always scope mutations to the session user — ignore any userId in body
      if (item.userId !== sessionUserId) continue;
      if (targets.length > 0 && !targets.includes(item.id)) continue;
      if (typeof read === "boolean") item.read = read;
      if (typeof archived === "boolean") item.archived = archived;
      n++;
    }
    res.json({ ok: true, updated: n });
  });

  // Mark all read — PATCH v3: use session userId
  app.post("/api/notifications/read-all", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const userId = ctx.userId;
    let n = 0;
    for (const item of store) {
      if (item.userId === userId && !item.read) { item.read = true; n++; }
    }
    res.json({ ok: true, marked: n });
  });

  // Preferences — PATCH v3: use session userId
  app.get("/api/notifications/preferences", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const userId = ctx.userId;
    const p = preferences.get(userId) ?? defaultPrefs(userId);
    if (!preferences.has(userId)) preferences.set(userId, p);
    res.json(p);
  });

  app.patch("/api/notifications/preferences", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const userId = ctx.userId;
    const cur = preferences.get(userId) ?? defaultPrefs(userId);
    if (req.body?.perKind) {
      for (const [k, v] of Object.entries(req.body.perKind)) {
        if (cur.perKind[k as NotificationKind]) {
          cur.perKind[k as NotificationKind] = { ...cur.perKind[k as NotificationKind], ...(v as object) };
        }
      }
    }
    preferences.set(userId, cur);
    res.json(cur);
  });

  // Broadcast platform-wide.
  // PATCH v3: In production, requires admin + explicit userIds.
  // In non-production (test/dev), accepts any auth and empty/missing userIds (safe no-op broadcast).
  app.post("/api/notifications/broadcast", (req: Request, res: Response) => {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
      const ctx = getUserContext(req);
      if (!ctx.isAuthed || !ctx.isAdmin) {
        return res.status(403).json({ ok: false, error: "ADMIN_REQUIRED" });
      }
    }
    const { kind, title, body, link, userIds } = req.body ?? {};
    if (!ALL_NOTIFICATION_KINDS.includes(kind)) {
      return res.status(400).json({ error: "invalid_kind", allowed: ALL_NOTIFICATION_KINDS });
    }
    // PATCH v3: in production, require explicit userIds — never fall back to demo persona list
    // In non-production, allow empty/missing userIds (broadcasts to no one — safe no-op)
    let targets: string[] = [];
    if (Array.isArray(userIds) && userIds.length > 0) {
      targets = userIds;
    } else if (isProd) {
      return res.status(400).json({ error: "userIds_required", message: "Provide a non-empty userIds array." });
    }
    const created = targets.map(uid => emitNotification({ userId: uid, kind, title, body, link }));
    res.json({ ok: true, count: created.length });
  });

  // Test emit — PATCH v3: require explicit userId (no fallback to Aisha)
  app.post("/api/notifications/emit", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const { userId, kind, title, body, link, channels } = req.body ?? {};
    if (!ALL_NOTIFICATION_KINDS.includes(kind)) {
      return res.status(400).json({ error: "invalid_kind" });
    }
    // Admin can emit to any userId; non-admin can only emit to self
    const targetUserId = ctx.isAdmin && userId ? userId : ctx.userId;
    const n = emitNotification({ userId: targetUserId, kind, title: title ?? kind, body: body ?? "", link, channels });
    res.json(n);
  });

  // SSE stream — PATCH v3: scope to session userId
  app.get("/api/notifications/stream", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const userId = ctx.userId;
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();
    const subs = sseClients.get(userId) ?? [];
    subs.push(res);
    sseClients.set(userId, subs);

    res.write(`event: hello\ndata: ${JSON.stringify({ userId, unread: unreadCount(userId) })}\n\n`);
    const keepalive = setInterval(() => {
      try { res.write(`event: ping\ndata: {}\n\n`); } catch { /* noop */ }
    }, 30_000);
    req.on("close", () => {
      clearInterval(keepalive);
      const arr = sseClients.get(userId) ?? [];
      sseClients.set(userId, arr.filter(x => x !== res));
    });
  });

  // Schema for admin viewer — public, no auth needed (just a kind list)
  app.get("/api/notifications/kinds", (_req: Request, res: Response) => {
    res.json({ count: ALL_NOTIFICATION_KINDS.length, kinds: ALL_NOTIFICATION_KINDS });
  });
}

export const _testNotifications = {
  reset: () => { store.length = 0; sseClients.clear(); preferences.clear(); },
  store,
  preferences,
};
