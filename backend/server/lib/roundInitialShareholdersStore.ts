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
/* W-AVI64 FIX 1 — resolve a CRM pick's email from the authoritative
   founder_crm_contacts table when the client sent no email, so a CRM investor
   who has an email on file still gets a round invitation (no silent
   skippedNoEmail). Read-only; same DB handle used across this tree. */
import { rawDb } from "../db/connection";
/* v25.51 5a — static ESM import (no cycle: founderCrmStore's dep closure never
   reaches this file). Replaces the broken runtime require("../founderCrmStore")
   so the manual-investor → founder-CRM upsert-and-link actually runs. */
import { upsertFromRound } from "../founderCrmStore";

export type InitialShareholderSource = "crm" | "manual";

export type InitialShareholder = {
  name: string;
  // v25.51 5a — discrete identity fields (per Ozan). Persisted first-class
  // alongside the composed `name` display string. Nullable + optional so
  // existing kv-shim rows written before this wave (which lack them) still
  // hydrate cleanly and downstream readers tolerate null first/last/company.
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  email?: string | null;
  checkSize?: string | null; // decimal-as-string (Sprint 25 precision rule)
  // Wave C3 (Shadie 2a) — optional personal note injected into this investor's
  // invitation email (message only; never the round terms).
  note?: string | null;
  // W3 Shadie 3a — optional stage focus + invite expiry (days) captured in the
  // manual-investor modal and threaded into the round invitation. Nullable so
  // pre-existing rows / CRM picks stay valid.
  stageFocus?: string | null;
  expiryDays?: number | null;
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

/**
 * v25.51 5a — resolve the round's owning companyId via the SACRED roundsStore
 * (read-only). Lazy require keeps us off the sacred import graph at module top
 * (mirrors callerOwnsRound). Returns null when the round is unknown.
 */
function companyForRound(roundId: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rs = require("../roundsStore");
    const round = typeof rs.getRoundById === "function" ? rs.getRoundById(roundId) : null;
    return typeof round?.companyId === "string" ? round.companyId : null;
  } catch {
    return null;
  }
}

/**
 * W-AVI64 FIX 1 — best-effort lookup of a CRM contact's email from the
 * authoritative founder_crm_contacts table (company-scoped). Returns a trimmed
 * email string, or null when the contact has none / cannot be read. Never
 * throws — a lookup failure must not fail the shareholder save or invite loop.
 */
function lookupCrmContactEmail(companyId: string, crmContactId: string): string | null {
  if (!companyId || !crmContactId) return null;
  try {
    const driver = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
    if (!driver || typeof driver.prepare !== "function") return null;
    const row = driver
      .prepare(`SELECT email FROM founder_crm_contacts WHERE id = ? AND company_id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(crmContactId, companyId) as { email?: string | null } | undefined;
    const email = (row?.email ?? "").trim();
    return email ? email : null;
  } catch (err) {
    log.warn("[roundInitialShareholdersStore] CRM email lookup failed:", (err as Error).message);
    return null;
  }
}

function normaliseDecimalString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

export function registerRoundInitialShareholdersRoutes(app: Express): void {
  app.patch("/api/founder/rounds/:roundId/initial-shareholders", async (req: Request, res: Response) => {
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
      const optStr = (v: unknown): string | null =>
        typeof v === "string" && v.trim() ? v.trim() : null;
      normalised.push({
        name: String(raw.name).trim(),
        // v25.51 5a — persist discrete first/last/company when supplied.
        firstName: optStr(raw.firstName),
        lastName: optStr(raw.lastName),
        company: optStr(raw.company),
        email: optStr(raw.email),
        checkSize: normaliseDecimalString(raw.checkSize),
        note: optStr(raw.note),
        // W3 Shadie 3a — stage focus (free text) + expiry days (positive int).
        stageFocus: optStr(raw.stageFocus),
        expiryDays: (() => {
          const n = Number(raw.expiryDays);
          return Number.isInteger(n) && n > 0 && n <= 3650 ? n : null;
        })(),
        source,
        crmContactId: typeof raw.crmContactId === "string" ? raw.crmContactId : null,
        addedAt: now,
      });
    }

    /* v25.51 5a — round → founder CRM unification. For each MANUAL shareholder
     * that is not yet linked to a CRM contact, upsert-and-link a founder CRM
     * contact (dedupe by email, fallback first+last+company) and write the id
     * back onto the row so a re-PATCH links instead of creating a duplicate.
     * `source:"crm"` rows are assumed already linked (they carry crmContactId)
     * — we never create a new CRM row for them here. Cap-table is untouched.
     * Best-effort: a CRM write failure must not fail the shareholder save. */
    const companyId = companyForRound(roundId) ?? (typeof body.companyId === "string" ? body.companyId : null);
    if (companyId) {
      try {
        for (const row of normalised) {
          if (row.source !== "manual") continue;
          if (row.crmContactId) continue; // already linked → idempotent no-op
          const res = upsertFromRound({
            companyId,
            tenantId: tenantForCompany(companyId),
            firstName: row.firstName,
            lastName: row.lastName,
            companyName: row.company,
            email: row.email,
            roundId,
          }) as { id: string; created: boolean } | null;
          if (res?.id) row.crmContactId = res.id;
        }
      } catch (err) {
        log.warn("[roundInitialShareholdersStore] CRM upsert-link failed:", (err as Error).message);
      }
    }

    store.set(roundId, normalised);
    persistRoundInitialShareholders(roundId);

    /* Wave C2 (Shadie 1a/1b) — CRM/manual investors picked in round-creation
     * Step 4 must actually LAND on the round and be NOTIFIED. Previously this
     * endpoint only recorded initial-shareholder rows, so the pick never
     * appeared in the round's Invitations table and no email was sent. We now
     * issue a canonical round invitation (roundInvitationsStore.createInvitation)
     * for each picked investor that has a valid email — which both surfaces them
     * in the Invitations table AND sends the invitation email via the existing
     * path. Idempotent: an already-active invite throws `duplicate_invitation`
     * and is counted as a benign skip, so a re-PATCH never double-sends. A pick
     * without an email is skipped (recorded as a shareholder only). Per-invite
     * failures are collected and reported (never silently swallowed) but do not
     * fail the shareholder save that already persisted. */
    let invited = 0;
    let skippedNoEmail = 0;
    let skippedDuplicate = 0;
    const inviteErrors: Array<{ email: string; error: string }> = [];
    /* W-AVI64 FIX 1 — per-pick result array so the client can show the founder
     * exactly what happened to each investor they picked (invited / duplicate /
     * no-email / error), instead of the founder guessing. */
    const inviteResults: Array<{
      name: string;
      email: string | null;
      crmContactId: string | null;
      status: "invited" | "duplicate" | "no_email" | "error";
      error?: string;
    }> = [];
    // Lazy import to avoid a static circular import (matches this file's
    // existing lazy-require pattern for the sacred roundsStore boundary).
    // Guarded: if the module can't be loaded (e.g. an isolated test harness
    // that can't parse the .ts), we skip invite issuance without failing the
    // shareholder save that already persisted.
    let createInvitation:
      | ((a: {
          roundId: string; companyId: string; investorEmail: string;
          investorName?: string | null; investorFirstName?: string | null;
          investorLastName?: string | null; investorCompany?: string | null;
          note?: string | null;
          stageFocus?: string | null;
          expiryDays?: number;
          invitedByUserId: string; tenantId?: string | null;
        }) => Promise<unknown>)
      | null = null;
    try {
      createInvitation = require("../roundInvitationsStore").createInvitation ?? null;
    } catch (err) {
      log.warn("[roundInitialShareholdersStore] could not load roundInvitationsStore for invite issuance:", (err as Error).message);
    }
    if (companyId && createInvitation) {
      for (const row of normalised) {
        /* W-AVI64 FIX 1 — if a CRM pick arrived without an email but carries a
         * crmContactId, resolve the email from founder_crm_contacts before
         * deciding it is un-invitable. This is the root-cause fix: the client
         * sent email:"" for a CRM contact, so the invitation was silently
         * skipped even though the contact HAD an email on file. */
        let inviteEmail = row.email;
        if (!inviteEmail && row.crmContactId) {
          const resolved = lookupCrmContactEmail(companyId, row.crmContactId);
          if (resolved) inviteEmail = resolved;
        }
        if (!inviteEmail) {
          skippedNoEmail++;
          inviteResults.push({ name: row.name, email: null, crmContactId: row.crmContactId ?? null, status: "no_email" });
          continue;
        }
        try {
          await createInvitation({
            roundId,
            companyId,
            investorEmail: inviteEmail,
            investorName: row.name,
            investorFirstName: row.firstName,
            investorLastName: row.lastName,
            investorCompany: row.company,
            // Wave C3 (Shadie 2a) — personal note injected into the email.
            note: row.note ?? null,
            // W3 Shadie 3a — stage focus + expiry threaded into the invitation.
            stageFocus: row.stageFocus ?? null,
            ...(typeof row.expiryDays === "number" ? { expiryDays: row.expiryDays } : {}),
            invitedByUserId: ctx.userId ?? "founder",
            tenantId: tenantForCompany(companyId),
          });
          invited++;
          inviteResults.push({ name: row.name, email: inviteEmail, crmContactId: row.crmContactId ?? null, status: "invited" });
        } catch (err) {
          const msg = (err as Error).message ?? "invite_failed";
          // An already-active invitation for this (round, email) is a benign,
          // idempotent skip — the investor is already on the round + notified.
          if (msg === "duplicate_invitation") {
            skippedDuplicate++;
            inviteResults.push({ name: row.name, email: inviteEmail, crmContactId: row.crmContactId ?? null, status: "duplicate" });
            continue;
          }
          inviteErrors.push({ email: inviteEmail, error: msg });
          inviteResults.push({ name: row.name, email: inviteEmail, crmContactId: row.crmContactId ?? null, status: "error", error: msg });
          log.warn("[roundInitialShareholdersStore] invitation issue failed:", inviteEmail, msg);
        }
      }
    }

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

    return res.json({
      ok: true,
      roundId,
      count: normalised.length,
      // Wave C2 (Shadie 1a/1b) — invitation issuance summary so the client can
      // surface "N investors invited" and any failures.
      invited,
      skippedNoEmail,
      skippedDuplicate,
      inviteErrors,
      // W-AVI64 FIX 1 — per-pick outcome so the founder sees exactly which
      // investors were invited vs. skipped (no email) vs. failed.
      inviteResults,
    });
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
