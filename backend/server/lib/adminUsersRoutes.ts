/**
 * Sprint 17 D7 — admin user management API.
 *
 * v25.31.1 — Pure DB-backed. The legacy `userMap` Map and `auditTrail` array
 * (process-local state lost on PM2 reload) have been removed. The static
 * SEED_USERS array is kept ONLY behind the DEMO_SEED_ENABLED flag and is
 * treated as a read-only constant (a built-in demo persona seed for the
 * marketing/QA gate). All mutations write to `auth_users` and the durable
 * `audit_log` table.
 *
 * Source-of-truth rule (Ozan, 19-Jun): the only persistent state is the live
 * SQLite DB. No process-local Maps, arrays, or merge layers.
 *
 * Endpoints:
 *   GET    /api/admin/users                       — list, with optional ?q&role&status filters
 *   POST   /api/admin/users                       — invite (creates redeem token + auth_users shell)
 *   PATCH  /api/admin/users/:id                   — { status?, role? }
 *   POST   /api/admin/users/:id/force-logout      — revokes all sessions
 *   POST   /api/admin/users/:id/reset-password    — issues a redeem token, returns the link
 *   GET    /api/admin/users/audit/:id             — durable audit_log for the user
 *   GET    /api/admin/users/export                — CSV export
 */
import type { Express, Request, Response } from "express";
import * as crypto from "node:crypto";
import { rawDb } from "../db/connection";
import { emitMutation } from "./eventBus";
import { hashPassword } from "./auth";
import { DEMO_SEED_ENABLED } from "./demoGate";
import { appendAdminAudit } from "../adminPlatformStore";

/* SEED_USERS — Avi's original demo personas. v25.31.1 keeps this verbatim
 * but treats it as a read-only constant. It is used ONLY in demo mode to
 * populate the admin UI with friendly faces. Production starts with the seed
 * disabled (see DEMO_SEED_ENABLED) so the list comes entirely from
 * `auth_users`. */
const _seedUsers = [
  { id: "u_maya",  email: "maya@novapay.ai",  name: "Maya Chen",     role: "founder",  status: "active", tenant: "NovaPay AI",     mfa: true,  lastLogin: "2026-04-22T08:14:00Z" },
  { id: "u_dev",   email: "dev@novapay.ai",   name: "Devon Reyes",   role: "founder",  status: "active", tenant: "NovaPay AI",     mfa: true,  lastLogin: "2026-04-22T07:42:00Z" },
  { id: "u_sara",  email: "sara@boldvc.com",  name: "Sara Park",     role: "investor", status: "active", tenant: "Bold VC",        mfa: true,  lastLogin: "2026-04-22T08:01:00Z" },
  { id: "u_jane",  email: "jane@adelman.vc",  name: "Jane Adelman",  role: "investor", status: "active", tenant: "Adelman Angels", mfa: false, lastLogin: "2026-04-21T19:33:00Z" },
  { id: "u_aisha", email: "aisha@greenwood.capital", name: "Aisha Patel", role: "investor", status: "active", tenant: "Greenwood Capital", mfa: true, lastLogin: "2026-04-22T06:51:00Z" },
  { id: "u_lapsed", email: "lp@lapsed-fund.example", name: "LP (Lapsed)", role: "investor", status: "suspended", tenant: "Lapsed Fund", mfa: false, lastLogin: "2025-12-01T00:00:00Z" },
  { id: "u_admin", email: "ops@capavate.com", name: "Capavate Ops",  role: "admin",    status: "active", tenant: "Capavate",       mfa: true,  lastLogin: "2026-04-22T08:18:00Z" },
];
const SEED_USERS = DEMO_SEED_ENABLED ? _seedUsers : [];
type AdminUser = typeof _seedUsers[number];

function actorIdFromReq(req: Request): string {
  return (req as any).userContext?.userId || "";
}

/**
 * listAll — single DB read. Combines the read-only DEMO seed (only when the
 * demo gate is on) with every `auth_users` row. No process-local mutable
 * state is ever consulted or written.
 */
function listAll(): AdminUser[] {
  const db = rawDb();
  const rows = db.prepare(`SELECT id, email, role, status, last_login FROM auth_users`).all() as
    Array<{ id: string; email: string; role: string; status: string; last_login: string | null }>;

  const out: AdminUser[] = [];
  const seenIds = new Set<string>();

  for (const r of rows) {
    seenIds.add(r.id);
    out.push({
      id: r.id, email: r.email, name: r.email.split("@")[0]!,
      role: r.role, status: r.status, tenant: "—", mfa: false,
      lastLogin: r.last_login ?? new Date().toISOString(),
    });
  }

  // Layer the demo seed only for personas not already in auth_users.
  // SEED_USERS is empty in production (DEMO_SEED_ENABLED=false).
  for (const s of SEED_USERS) {
    if (!seenIds.has(s.id)) out.push({ ...s });
  }

  return out;
}

export function registerAdminUsersRoutes(app: Express): void {
  app.get("/api/admin/users", (req: Request, res: Response) => {
    const q = String(req.query.q || "").toLowerCase();
    const role = String(req.query.role || "");
    const status = String(req.query.status || "");
    let users = listAll();
    if (q) users = users.filter(u =>
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.tenant.toLowerCase().includes(q));
    if (role && role !== "all") users = users.filter(u => u.role === role);
    if (status && status !== "all") users = users.filter(u => u.status === status);
    res.json({ users, total: users.length });
  });

  app.post("/api/admin/users", (req: Request, res: Response) => {
    const body = req.body as { email?: string; name?: string; role?: string; tenant?: string };
    if (!body?.email || !/.+@.+\..+/.test(body.email)) return res.status(400).json({ error: "bad_email" });
    const id = `u_${crypto.randomBytes(5).toString("hex")}`;
    const tokenRaw = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(tokenRaw).digest("hex");
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    rawDb().prepare(
      `INSERT INTO auth_redeem_tokens (id, token_hash, email, intent, expires_at, created_at)
       VALUES (?, ?, ?, 'invite', ?, ?)`
    ).run(`tk_${crypto.randomBytes(5).toString("hex")}`, tokenHash, body.email, expiresAt, now);

    /* v25.31.1 — durable invite. Writes `auth_users` shell so the invited
     * user survives PM2 reload. If the INSERT fails (e.g. duplicate email)
     * we return 409 — no in-memory fallback. */
    try {
      rawDb().prepare(
        `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, failed_attempts, created_at)
         VALUES (?, ?, '', 'pending', ?, 'pending', 0, ?)`
      ).run(id, body.email, body.role || "founder", now);
    } catch (e: any) {
      if (String(e?.message || "").includes("UNIQUE")) {
        return res.status(409).json({ error: "email_taken" });
      }
      return res.status(500).json({ error: "db_insert_failed", detail: String(e?.message || e) });
    }

    const created: AdminUser = {
      id, email: body.email, name: body.name || body.email.split("@")[0]!,
      role: body.role || "founder", status: "pending", tenant: body.tenant || "—",
      mfa: false, lastLogin: now,
    };

    /* Durable audit (hash-chained `audit_log` table). */
    try {
      appendAdminAudit(actorIdFromReq(req), `user:${id}`, "user.invite", { email: body.email });
    } catch {
      // appendAdminAudit failures must not block the response, but the DB row
      // is already written. Surface as a warning header for ops visibility.
      res.setHeader("X-Audit-Warning", "audit_log_write_failed");
    }
    emitMutation({ aggregate: "user", id, change: "create" });
    res.status(201).json({ user: created, redeemToken: tokenRaw });
  });

  app.patch("/api/admin/users/:id", (req: Request, res: Response) => {
    const id = req.params.id!;
    const body = req.body as { status?: string; role?: string; mfa?: boolean };
    const existing = listAll().find(u => u.id === id);
    if (!existing) return res.status(404).json({ error: "not_found" });
    const updated: AdminUser = {
      ...existing,
      status: body.status ?? existing.status,
      role: body.role ?? existing.role,
      mfa: body.mfa ?? existing.mfa,
    };
    /* v25.18 Lane D NC2 (hard close) — server-side self-lockout + last-admin guard.
       v25.17 added a client `isSelf()` guard, but the server PATCH was still wide
       open. Reject (a) any patch from an admin against their own row that would
       demote them or suspend them, and (b) any patch that would leave zero active
       admins on the platform. */
    const actor = actorIdFromReq(req);
    const isSelf = !!actor && actor === id;
    const wouldDemote = updated.role !== "admin" && existing.role === "admin";
    const wouldSuspend = updated.status !== "active" && existing.status === "active";
    if (isSelf && (wouldDemote || wouldSuspend)) {
      return res.status(409).json({ error: "cannot_modify_self", message: "You cannot demote or suspend your own admin account." });
    }
    if (wouldDemote || wouldSuspend) {
      const activeAdmins = listAll().filter((u) => u.role === "admin" && u.status === "active" && u.id !== id).length;
      if (activeAdmins === 0) {
        return res.status(409).json({ error: "last_active_admin", message: "Refusing to leave the platform with zero active admins." });
      }
    }
    /* v25.31.1 — DB-only write. Mirror to auth_users when the row exists.
     * Demo seed personas (u_maya, u_dev, …) are read-only constants — patches
     * against them are a no-op at the DB layer but still emit the mutation
     * event so the UI updates optimistically for the demo gate. */
    const upd = rawDb().prepare(`UPDATE auth_users SET status = ?, role = ? WHERE id = ?`).run(updated.status, updated.role, id);
    if (upd.changes === 0 && !SEED_USERS.find(s => s.id === id)) {
      return res.status(404).json({ error: "not_found_in_db" });
    }
    try {
      appendAdminAudit(actorIdFromReq(req), `user:${id}`, "user.update", body as Record<string, unknown>);
    } catch {
      res.setHeader("X-Audit-Warning", "audit_log_write_failed");
    }
    emitMutation({ aggregate: "user", id, change: "update" });
    res.json({ user: updated });
  });

  app.post("/api/admin/users/:id/force-logout", (req: Request, res: Response) => {
    const id = req.params.id!;
    const r = rawDb().prepare(`UPDATE auth_sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0`).run(id);
    try {
      appendAdminAudit(actorIdFromReq(req), `user:${id}`, "user.force_logout", { sessions: r.changes });
    } catch {
      res.setHeader("X-Audit-Warning", "audit_log_write_failed");
    }
    emitMutation({ aggregate: "user", id, change: "update" });
    res.json({ ok: true, sessionsRevoked: r.changes });
  });

  app.post("/api/admin/users/:id/reset-password", (req: Request, res: Response) => {
    const id = req.params.id!;
    const u = listAll().find(x => x.id === id);
    if (!u) return res.status(404).json({ error: "not_found" });
    const tokenRaw = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(tokenRaw).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    rawDb().prepare(
      `INSERT INTO auth_redeem_tokens (id, token_hash, email, intent, expires_at, created_at)
       VALUES (?, ?, ?, 'reset', ?, ?)`
    ).run(`tk_${crypto.randomBytes(5).toString("hex")}`, tokenHash, u.email, expiresAt, new Date().toISOString());
    try {
      appendAdminAudit(actorIdFromReq(req), `user:${id}`, "user.reset_password", {});
    } catch {
      res.setHeader("X-Audit-Warning", "audit_log_write_failed");
    }
    res.json({ ok: true, redeemToken: tokenRaw, expiresAt });
  });

  /* v25.31.1 Wave A #2 — pure durable read. Returns entries from the
   * hash-chained `audit_log` table only. No in-memory merge layer.
   * Response shape preserved: { entries: [{ ts, actor, action, targetId, meta? }] } */
  app.get("/api/admin/users/audit/:id", (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    try {
      const rows = rawDb().prepare(
        `SELECT id, created_at AS ts, actor_id AS actor, target, action, payload_json AS payload
         FROM audit_log
         WHERE deleted_at IS NULL
           AND (target_id = ? OR target = ? OR target LIKE ?)
         ORDER BY created_at DESC
         LIMIT 500`
      ).all(id, `user:${id}`, `%:${id}`) as Array<{
        id: string; ts: string; actor: string | null; target: string | null; action: string; payload: string | null;
      }>;
      const entries = rows.map((r) => {
        let meta: Record<string, unknown> | undefined;
        if (r.payload) { try { meta = JSON.parse(r.payload); } catch { /* ignore */ } }
        return { ts: r.ts, actor: r.actor ?? "", action: r.action, targetId: id, meta };
      });
      res.json({ entries });
    } catch (e) {
      // Genuine DB failure — surface honestly. No process-local fallback.
      res.status(500).json({ error: "audit_log_read_failed", detail: String((e as any)?.message || e) });
    }
  });

  app.get("/api/admin/users/export", (_req: Request, res: Response) => {
    const rows = listAll();
    const csv = [
      ["id", "email", "name", "role", "tenant", "status", "mfa", "lastLogin"].join(","),
      ...rows.map(u => [u.id, u.email, JSON.stringify(u.name), u.role, JSON.stringify(u.tenant), u.status, u.mfa, u.lastLogin].join(",")),
    ].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=users-${Date.now()}.csv`);
    res.send(csv);
  });

  // Helper: seed an auth_users row for the demo admin so secure-login works end-to-end
  // when the operator picks a known persona.
  app.post("/api/admin/users/seed-auth", (req: Request, res: Response) => {
    const { email, password, role } = (req.body || {}) as { email?: string; password?: string; role?: string };
    if (!email || !password || password.length < 10) return res.status(400).json({ error: "bad_input" });
    const id = `u_${crypto.randomBytes(5).toString("hex")}`;
    const hash = hashPassword(password);
    rawDb().prepare(
      `INSERT OR REPLACE INTO auth_users (id, email, password_hash, password_algo, role, status, failed_attempts, created_at)
       VALUES (?, ?, ?, 'scrypt-sha256', ?, 'active', 0, ?)`
    ).run(id, email, hash, role || "admin", new Date().toISOString());
    res.status(201).json({ id, email });
  });
}
