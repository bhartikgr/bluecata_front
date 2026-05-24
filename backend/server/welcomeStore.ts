/**
 * Sprint 18 Phase 2 — T1.2 Welcome ack persistence.
 *
 * Stores the welcome-ack flag per-user in-memory. Mirrors auth_users.welcome_ack
 * column. Deliberately lightweight — production would write through to the DB.
 */
import type { Express, Request, Response } from "express";
import { getUserContext } from "./lib/userContext";

const ackByUser = new Map<string, boolean>();

export function registerWelcomeRoutes(app: Express): void {
  app.get("/api/founder/welcome", async (req: Request, res: Response) => {
    const ctx = await getUserContext(req);
    const userId = ctx?.userId || "anonymous";
    const displayName = ctx?.displayName || "Founder";
    const firstName = displayName.split(" ")[0] || "Founder";
    res.json({
      welcomeAck: ackByUser.get(userId) === true,
      firstName,
    });
  });

  app.post("/api/founder/welcome/ack", async (req: Request, res: Response) => {
    const ctx = await getUserContext(req);
    const userId = ctx?.userId || "anonymous";
    ackByUser.set(userId, true);
    res.json({ ok: true, welcomeAck: true });
  });

  app.post("/api/founder/welcome/reset", async (req: Request, res: Response) => {
    const ctx = await getUserContext(req);
    const userId = ctx?.userId || "anonymous";
    ackByUser.set(userId, false);
    res.json({ ok: true, welcomeAck: false });
  });
}

export function _resetWelcomeStoreForTests(): void {
  ackByUser.clear();
}
