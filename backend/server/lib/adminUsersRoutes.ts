/**
 * Sprint 17 D7 — admin user management API.
 *
 * Backed by `auth_users` (real DB rows) PLUS a static seed of demo users
 * so the admin screen has rows immediately. Actions (suspend, force-logout,
 * reset-password) record into the audit log.
 *
 * Endpoints:
 *   GET    /api/admin/users                       — list, with optional ?q&role&status filters
 *   POST   /api/admin/users                       — invite (creates redeem token + user shell)
 *   PATCH  /api/admin/users/:id                   — { status?, role? }
 *   POST   /api/admin/users/:id/force-logout      — revokes all sessions
 *   POST   /api/admin/users/:id/reset-password    — issues a redeem token, returns the link
 *   GET    /api/admin/users/export                — CSV export
 */
import type { Express, Request, Response } from "express";
import * as crypto from "node:crypto";
import { rawDb } from "../db/connection";
import { emitMutation } from "./eventBus";
import { hashPassword } from "./auth";

const SEED_USERS = [
  { id: "u_maya",  email: "maya@novapay.ai",  name: "Maya Chen",     role: "founder",  status: "active", tenant: "NovaPay AI",     mfa: true,  lastLogin: "2026-04-22T08:14:00Z" },
  { id: "u_dev",   email: "dev@novapay.ai",   name: "Devon Reyes",   role: "founder",  status: "active", tenant: "NovaPay AI",     mfa: true,  lastLogin: "2026-04-22T07:42:00Z" },
  { id: "u_sara",  email: "sara@boldvc.com",  name: "Sara Park",     role: "investor", status: "active", tenant: "Bold VC",        mfa: true,  lastLogin: "2026-04-22T08:01:00Z" },
  { id: "u_jane",  email: "jane@adelman.vc",  name: "Jane Adelman",  role: "investor", status: "active", tenant: "Adelman Angels", mfa: false, lastLogin: "2026-04-21T19:33:00Z" },
  { id: "u_aisha", email: "aisha@greenwood.capital", name: "Aisha Patel", role: "investor", status: "active", tenant: "Greenwood Capital", mfa: true, lastLogin: "2026-04-22T06:51:00Z" },
  { id: "u_lapsed", email: "lp@lapsed-fund.example", name: "LP (Lapsed)", role: "investor", status: "suspended", tenant: "Lapsed Fund", mfa: false, lastLogin: "2025-12-01T00:00:00Z" },
  { id: "u_admin", email: "ops@capavate.com", name: "Capavate Ops",  role: "admin",    status: "active", tenant: "Capavate",       mfa: true,  lastLogin: "2026-04-22T08:18:00Z" },
];
type AdminUser = typeof SEED_USERS[number];
const userMap = new Map<string, AdminUser>(SEED_USERS.map(u => [u.id, { ...u }]));

const auditTrail: Array<{ ts: string; actor: string; action: string; targetId: string; meta?: Record<string, unknown> }> = [];
function audit(actor: string, action: string, targetId: string, meta?: Record<string, unknown>) {
  auditTrail.push({ ts: new Date().toISOString(), actor, action, targetId, meta });
}

function actorIdFromReq(req: Request): string {
  return (req.headers["x-user-id"] as string | undefined) || "u_admin";
}

function listAll(): AdminUser[] {
  // Merge in any auth_users rows
  const db = rawDb();
  const rows = db.prepare(`SELECT id, email, role, status, last_login FROM auth_users`).all() as
    Array<{ id: string; email: string; role: string; status: string; last_login: string | null }>;
  const merged = new Map<string, AdminUser>(userMap);
  for (const r of rows) {
    if (!merged.has(r.id)) {
      merged.set(r.id, {
        id: r.id, email: r.email, name: r.email.split("@")[0]!,
        role: r.role, status: r.status, tenant: "—", mfa: false,
        lastLogin: r.last_login ?? new Date().toISOString(),
      });
    }
  }
  return Array.from(merged.values());
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
    const created: AdminUser = {
      id, email: body.email, name: body.name || body.email.split("@")[0]!,
      role: body.role || "founder", status: "pending", tenant: body.tenant || "—",
      mfa: false, lastLogin: now,
    };
    userMap.set(id, created);
    audit(actorIdFromReq(req), "user.invite", id, { email: body.email });
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
    userMap.set(id, updated);
    // Mirror to auth_users when present
    rawDb().prepare(`UPDATE auth_users SET status = ?, role = ? WHERE id = ?`).run(updated.status, updated.role, id);
    audit(actorIdFromReq(req), "user.update", id, body as Record<string, unknown>);
    emitMutation({ aggregate: "user", id, change: "update" });
    res.json({ user: updated });
  });

  app.post("/api/admin/users/:id/force-logout", (req: Request, res: Response) => {
    const id = req.params.id!;
    const r = rawDb().prepare(`UPDATE auth_sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0`).run(id);
    audit(actorIdFromReq(req), "user.force_logout", id, { sessions: r.changes });
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
    audit(actorIdFromReq(req), "user.reset_password", id);
    res.json({ ok: true, redeemToken: tokenRaw, expiresAt });
  });

  app.get("/api/admin/users/audit/:id", (req: Request, res: Response) => {
    const trail = auditTrail.filter(a => a.targetId === req.params.id);
    res.json({ entries: trail });
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
