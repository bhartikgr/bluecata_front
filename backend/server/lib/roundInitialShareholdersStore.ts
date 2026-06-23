/**
 * v23.4.8 Phase 2 / BUG 012 — Manual shareholders in round wizard.
 *
 * Bug (Ozan, High): "Just before I can create a term sheet within the round
 * creation process, I do not have the opportunity to add investors (from my
 * CRM) into the round. Some companies may need to do this as they may be
 * working with non-Capavate investors."
 *
 * SACRED-FILE-SAFE PATH:
 * The round wizard already POSTs to /api/rounds via the SACRED roundsStore.
 * We DO NOT touch roundsStore.ts. Instead, this module exposes a separate
 * PATCH endpoint that records the founder's picked initial shareholders
 * (CRM contacts + manual non-Capavate entries) against the round id AFTER
 * the round has been created. The round-close cascade can pick these up at
 * close time via the exported `listInitialShareholders` helper.
 *
 * Endpoints:
 *   PATCH /api/founder/rounds/:roundId/initial-shareholders
 *     body: { shareholders: Array<{ name, email?, checkSize?, source: "crm"|"manual", crmContactId? }> }
 *     returns: { ok: true, roundId, count }
 *
 *   GET   /api/founder/rounds/:roundId/initial-shareholders
 *     returns: { ok: true, roundId, shareholders: [...] }
 *
 * Storage: in-memory map keyed by roundId, with best-effort write-through
 * to the audit log (same pattern as v23.4.7 reports/logo stores). No
 * mutation of any SACRED file; no schema change required for boot.
 */
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";
import { getUserContext } from "./userContext";
import { appendAdminAudit } from "../adminPlatformStore";
import { log } from "./logger";

export type InitialShareholderSource = "crm" | "manual";

export type InitialShareholder = {
  name: string;
  email?: string | null;
  checkSize?: string | null; // decimal-as-string (Sprint 25 precision rule)
  source: InitialShareholderSource;
  crmContactId?: string | null;
  addedAt: string;
};

const store = new Map<string, InitialShareholder[]>();

/** Test-only accessor. */
export const _initialShareholdersStoreForTest = store;

/** Public read API for downstream (round-close cascade etc.) — non-mutating. */
export function listInitialShareholders(roundId: string): readonly InitialShareholder[] {
  return store.get(roundId) ?? [];
}

/**
 * v25.11 NM3 — rebuild the Map on boot from kv shim. Registered in
 * HYDRATE_ORDER so initial shareholder lists survive deploys.
 */
export function hydrateRoundInitialShareholders(): number {
  let n = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { hydrateEntries } = require("./storePersistenceShim");
    const rows = hydrateEntries("roundInitialShareholders") as Array<[string, InitialShareholder[]]>;
    if (Array.isArray(rows)) {
      for (const [roundId, arr] of rows) {
        if (typeof roundId !== "string" || !Array.isArray(arr)) continue;
        store.set(roundId, arr);
        n += 1;
      }
    }
  } catch { /* first boot */ }
  return n;
}

function persistRoundInitialShareholders(roundId: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { persistEntry } = require("./storePersistenceShim");
    persistEntry("roundInitialShareholders", roundId, store.get(roundId) ?? []);
  } catch { /* non-fatal */ }
}

/**
 * v25.11 NM3 — ownership check: confirm caller's founder companies
 * include the round's owning company. We resolve company via roundsStore
 * lazily (require so we don't import the sacred path at module top).
 */
function callerOwnsRound(ctx: { userId?: string; founder?: { companies?: Array<{ companyId: string }> } }, roundId: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rs = require("../roundsStore");
    const round = typeof rs.getRoundById === "function" ? rs.getRoundById(roundId) : null;
    const companyId: string | undefined = round?.companyId;
    if (!companyId) return false;
    const companies = ctx?.founder?.companies ?? [];
    return Array.isArray(companies) && companies.some((c) => c?.companyId === companyId);
  } catch {
    return false;
  }
}

function tenantForCompany(companyId: string): string {
  return `tenant_co_${companyId}`;
}

function normaliseDecimalString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

export function registerRoundInitialShareholdersRoutes(app: Express): void {
  app.patch("/api/founder/rounds/:roundId/initial-shareholders", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const roundId = String(req.params.roundId ?? "");
    if (!roundId) return res.status(400).json({ ok: false, error: "missing_round_id" });

    /* v25.11 NM3 — round ownership gate. Previously any authenticated user
     * could overwrite any round's initial shareholders. Now we verify the
     * caller's founder companies include the round's owning company. Admin
     * still bypasses. */
    if (!ctx.isAdmin && !callerOwnsRound(ctx, roundId)) {
      return res.status(403).json({ ok: false, error: "not_round_owner" });
    }

    const body = req.body ?? {};
    const incoming = Array.isArray(body.shareholders) ? body.shareholders : [];
    if (incoming.length > 500) {
      return res.status(400).json({ ok: false, error: "TOO_MANY_SHAREHOLDERS", limit: 500 });
    }

    const now = new Date().toISOString();
    const normalised: InitialShareholder[] = [];
    for (const raw of incoming) {
      if (!raw || typeof raw.name !== "string" || !raw.name.trim()) continue;
      const source: InitialShareholderSource = raw.source === "crm" ? "crm" : "manual";
      normalised.push({
        name: String(raw.name).trim(),
        email: typeof raw.email === "string" && raw.email.trim() ? raw.email.trim() : null,
        checkSize: normaliseDecimalString(raw.checkSize),
        source,
        crmContactId: typeof raw.crmContactId === "string" ? raw.crmContactId : null,
        addedAt: now,
      });
    }

    store.set(roundId, normalised);
    persistRoundInitialShareholders(roundId);

    // Best-effort audit append. We don't have a companyId here directly, so
    // the audit row is keyed off the roundId. (The sacred roundsStore owns
    // the round→company map; we deliberately do NOT import it.)
    if (typeof body.companyId === "string" && body.companyId) {
      try {
        appendAdminAudit(
          ctx.userId ?? "u_unknown",
          `round:${roundId}`,
          "round.initial_shareholders.set",
          { roundId, count: normalised.length, source_breakdown: { crm: normalised.filter((s) => s.source === "crm").length, manual: normalised.filter((s) => s.source === "manual").length } },
          tenantForCompany(String(body.companyId)),
        );
      } catch (err) {
        log.warn("[roundInitialShareholdersStore] audit append failed:", (err as Error).message);
      }
    }

    return res.json({ ok: true, roundId, count: normalised.length });
  });

  app.get("/api/founder/rounds/:roundId/initial-shareholders", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const roundId = String(req.params.roundId ?? "");
    if (!roundId) return res.status(400).json({ ok: false, error: "missing_round_id" });
    const shareholders = store.get(roundId) ?? [];
    return res.json({ ok: true, roundId, shareholders });
  });
}
