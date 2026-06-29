/**
 * v25.45.4 M-4 — Profile Wizard state store (DB-backed persistence).
 *
 * The founder Profile Wizard kept step values in in-memory React state only, so
 * values typed on Step 2/3 were gone by Step 4 Confirm (Tier 5 #28 / Tier 6 #48
 * violation). This store durably persists the wizard payload per
 * (company_id, user_id) so every Step Next saves and every step Load hydrates.
 *
 * DB is the read source — no Map cache. The state_json blob holds whatever the
 * client sends (all step fields); the server does not interpret individual
 * fields here, it just round-trips them faithfully (Save -> Restart -> Load).
 */
import type { Express, Request, Response } from "express";
import { rawDb } from "./db/connection";
import { requireAuth } from "./lib/authMiddleware";
import { getCompaniesForFounder } from "./multiCompanyStore";

export interface WizardState {
  companyId: string;
  userId: string;
  state: Record<string, unknown>;
  updatedAt: string;
}

/** Load the persisted wizard state for (companyId, userId). Returns an empty
 *  state object when nothing has been saved yet. */
export function loadWizardState(companyId: string, userId: string): WizardState {
  try {
    const row: any = rawDb()
      .prepare(`SELECT * FROM profile_wizard_state WHERE company_id = ? AND user_id = ?`)
      .get(companyId, userId);
    if (row) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(row.state_json ?? "{}");
      } catch {
        parsed = {};
      }
      return {
        companyId,
        userId,
        state: parsed,
        updatedAt: row.updated_at,
      };
    }
  } catch {
    /* fall through to empty */
  }
  return { companyId, userId, state: {}, updatedAt: new Date(0).toISOString() };
}

/** Merge + persist a partial wizard state. The incoming patch is shallow-merged
 *  over the existing persisted state so a single-step save never clobbers other
 *  steps' values. */
export function saveWizardState(
  companyId: string,
  userId: string,
  patch: Record<string, unknown>,
): WizardState {
  const existing = loadWizardState(companyId, userId).state;
  const merged = { ...existing, ...(patch ?? {}) };
  const updatedAt = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO profile_wizard_state (company_id, user_id, state_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(company_id, user_id) DO UPDATE SET
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`,
    )
    .run(companyId, userId, JSON.stringify(merged), updatedAt);
  return { companyId, userId, state: merged, updatedAt };
}

/**
 * v25.45.4 M-4 — wizard-state routes. GET hydrates the persisted draft; POST
 * shallow-merges a step patch. Both are ownership-scoped to the caller's
 * companies and keyed by (companyId, userId), so the Save -> Restart -> Load
 * round-trip survives a server restart.
 */
export function registerProfileWizardStateRoutes(app: Express): void {
  app.get("/api/founder/profile/wizard-state", requireAuth, (req: Request, res: Response) => {
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const userId = ctx?.userId ?? null;
    if (!userId) return res.status(401).json({ ok: false, error: "missing_identity" });
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : "";
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId_required" });
    const owned = getCompaniesForFounder(userId).some((c) => c.companyId === companyId);
    if (!owned) return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });
    const ws = loadWizardState(companyId, userId);
    return res.json({ ok: true, state: ws.state, updatedAt: ws.updatedAt });
  });

  app.post("/api/founder/profile/wizard-state", requireAuth, (req: Request, res: Response) => {
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const userId = ctx?.userId ?? null;
    if (!userId) return res.status(401).json({ ok: false, error: "missing_identity" });
    const companyId =
      (typeof req.query.companyId === "string" && req.query.companyId) ||
      (typeof req.body?.companyId === "string" && req.body.companyId) ||
      "";
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId_required" });
    const owned = getCompaniesForFounder(userId).some((c) => c.companyId === companyId);
    if (!owned) return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });
    const patch = (req.body?.state ?? req.body?.patch ?? {}) as Record<string, unknown>;
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      return res.status(400).json({ ok: false, error: "invalid_state_patch" });
    }
    const ws = saveWizardState(companyId, userId, patch);
    return res.json({ ok: true, state: ws.state, updatedAt: ws.updatedAt });
  });
}
