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

function tenantForCompany(companyId: string): string {
  return `tenant_co_${companyId}`;
}

/**
 * W-AVI65 FIX 1 — DB-DIRECT round→company resolution.
 *
 * ROOT CAUSE (confirmed LIVE by network capture): PATCH
 * /api/founder/rounds/:roundId/initial-shareholders returned
 * 403 {"ok":false,"error":"not_round_owner"} for a founder who demonstrably
 * owns the round (POST /api/rounds/:id/invitations on the SAME founder + round
 * + company returned 200). The old `callerOwnsRound` / `companyForRound`
 * resolved the round through a LAZY `require("../roundsStore")` (the
 * createRequire shim above). In the PRODUCTION BUNDLE (dist/index.cjs) that
 * specifier does not resolve, so `round` was null → companyId undefined →
 * ownership false → 403 on every call. The working POST path uses a STATIC
 * import (routes.ts:99/220 `getRoundById as roundsStoreGetById`).
 *
 * Two independent failure modes are fixed by going DB-direct:
 *   1. bundle module-resolution failure (the observed live 403), and
 *   2. `roundsStore.getRoundById` reads the in-memory `ROUNDS_BY_ID` cache
 *      (roundsStore.ts:340), so under PM2 cluster mode a round created by one
 *      worker is invisible to another worker → the same spurious 403.
 *
 * We therefore read `rounds.company_id` straight from SQLite with the exact
 * convention already used inside roundsStore itself for DB-direct round reads
 * (roundsStore.ts:375 / :418), via the `rawDb` handle this file already imports
 * STATICALLY at the top (so it cannot fail to resolve in the bundle).
 *
 * Returns a TRI-STATE so callers can distinguish "the round genuinely has no
 * row" from "the read failed" — the difference matters for fail-closed
 * ownership (see resolveRoundOwnership).
 */
type RoundCompanyLookup =
  // `exists` distinguishes "the round id is genuinely absent from the table"
  // (exists:false → truly unowned, body.companyId may be trusted if owned) from
  // "the round exists but resolved to no usable company / was soft-deleted"
  // (exists:true, companyId:null → do NOT trust body.companyId; fail-closed).
  | { ok: true; companyId: string | null; exists?: boolean }
  | { ok: false; companyId: null };

function roundCompanyIdFromDb(roundId: string): RoundCompanyLookup {
  if (!roundId) return { ok: true, companyId: null };
  try {
    const driver = rawDb() as unknown as { prepare?: (sql: string) => { get: (...a: unknown[]) => unknown } };
    if (!driver || typeof driver.prepare !== "function") return { ok: false, companyId: null };
    // W-AVI65 REVISE (Opus blocker) — resolve the owning company REGARDLESS of
    // deleted_at, so a SOFT-DELETED round of another tenant is NOT mistaken for
    // a nonexistent (unowned) round. If we filtered `deleted_at IS NULL`, a
    // tenant-A round that was soft-deleted would return no row → the caller's
    // body.companyId branch could let tenant B write shareholder rows against
    // tenant A's round id. We MUST surface the real owner so the ownership gate
    // denies it. `alive` is returned for callers that still care about state.
    const row = driver
      .prepare(`SELECT company_id, deleted_at FROM rounds WHERE id = ? LIMIT 1`)
      .get(roundId) as { company_id?: string | null; deleted_at?: string | null } | undefined;
    if (!row) {
      // Genuinely no such round id in the table (any state) — truly unowned.
      return { ok: true, companyId: null, exists: false };
    }
    const companyId = (row.company_id ?? "").trim();
    return { ok: true, companyId: companyId ? companyId : null, exists: true };
  } catch (err) {
    log.warn("[roundInitialShareholdersStore] round→company DB lookup failed:", (err as Error).message);
    return { ok: false, companyId: null };
  }
}

/**
 * Legacy in-memory accessor, kept ONLY as a secondary source for test harnesses
 * and seed rounds that exist in the roundsStore cache but not in the `rounds`
 * table. Mirrors routes.ts:3067's canonical-seed fallback. Never authoritative:
 * `roundCompanyIdFromDb` is consulted FIRST and this is best-effort on top.
 */
function roundCompanyIdFromStoreCache(roundId: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rs = require("../roundsStore");
    const round = typeof rs.getRoundById === "function" ? rs.getRoundById(roundId) : null;
    return typeof round?.companyId === "string" && round.companyId ? round.companyId : null;
  } catch {
    return null;
  }
}

/**
 * v25.51 5a — resolve the round's owning companyId (read-only). W-AVI65 FIX 1:
 * DB-direct first (bundle-safe + cluster-safe), in-memory cache second.
 * Returns null when the round is unknown to BOTH sources.
 */
function companyForRound(roundId: string): string | null {
  const db = roundCompanyIdFromDb(roundId);
  if (db.ok && db.companyId) return db.companyId;
  return roundCompanyIdFromStoreCache(roundId);
}

/**
 * v25.11 NM3 / W-AVI65 FIX 1 — ownership check: the caller's founder companies
 * must include the round's owning company.
 *
 * FAIL-CLOSED contract (no cross-tenant write is possible):
 *   - Round's company resolved (DB or cache) → ownership is EXACTLY
 *     `resolvedCompanyId ∈ ctx.founder.companies`. A client-supplied
 *     `body.companyId` can never override or widen this.
 *   - Round resolved to NO row anywhere (a brand-new wizard round that has not
 *     landed in `rounds` yet) → we accept `body.companyId` ONLY IF the founder
 *     owns that company. The round belongs to no tenant, so this cannot reach
 *     another tenant's data, and the founder is still confined to their own
 *     company.
 *   - The DB read FAILED (not "no row") → we do NOT trust `body.companyId` at
 *     all, because the round might really belong to another tenant and we have
 *     no proof either way. Ownership is denied unless the cache proves it.
 *
 * `effectiveCompanyId` is the company the rest of the handler must use (CRM
 * upsert, invitations, audit) so it is always an OWNED company id.
 */
function resolveRoundOwnership(
  ctx: { isAdmin?: boolean; userId?: string; founder?: { companies?: Array<{ companyId: string }> } },
  roundId: string,
  bodyCompanyId: string | null,
): { owns: boolean; effectiveCompanyId: string | null } {
  const companies = Array.isArray(ctx?.founder?.companies) ? ctx.founder!.companies! : [];
  const ownsCompany = (companyId: string | null): boolean =>
    !!companyId && companies.some((c) => c?.companyId === companyId);

  const db = roundCompanyIdFromDb(roundId);
  const cached = roundCompanyIdFromStoreCache(roundId);
  const resolved = (db.ok ? db.companyId : null) ?? cached;

  if (resolved) {
    return { owns: ownsCompany(resolved), effectiveCompanyId: resolved };
  }
  // W-AVI65 REVISE (Opus blocker) — the round resolved to NO usable company.
  // Only trust the client's body.companyId for a round that GENUINELY does not
  // exist yet (a brand-new wizard round not persisted). If the id EXISTS in the
  // table (e.g. a soft-deleted round of ANOTHER tenant) we must NOT trust
  // body.companyId — that would let tenant B write against tenant A's round id.
  // Also require the store-cache to have no record of it (belt-and-suspenders).
  const genuinelyAbsent = db.ok && db.exists === false && cached === null;
  if (genuinelyAbsent && ownsCompany(bodyCompanyId)) {
    return { owns: true, effectiveCompanyId: bodyCompanyId };
  }
  return { owns: false, effectiveCompanyId: null };
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

    const body = req.body ?? {};
    const bodyCompanyId = typeof body.companyId === "string" && body.companyId.trim()
      ? body.companyId.trim()
      : null;

    /* v25.11 NM3 — round ownership gate. Previously any authenticated user
     * could overwrite any round's initial shareholders. Now we verify the
     * caller's founder companies include the round's owning company. Admin
     * still bypasses.
     * W-AVI65 FIX 1 — ownership no longer depends on the bundle-fragile lazy
     * require("../roundsStore"); it resolves the round's company DB-direct and
     * fails closed. See resolveRoundOwnership for the full contract. */
    const ownership = resolveRoundOwnership(ctx, roundId, bodyCompanyId);
    if (!ctx.isAdmin && !ownership.owns) {
      return res.status(403).json({ ok: false, error: "not_round_owner" });
    }

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
    /* W-AVI65 FIX 1 — use the company id the ownership gate actually validated,
     * so every downstream write (CRM upsert-link, round invitations, audit) is
     * confined to a company this caller owns. For an admin (who bypasses the
     * gate) fall back to the resolved round company, then the supplied one. */
    const companyId = ownership.effectiveCompanyId
      ?? (ctx.isAdmin ? (companyForRound(roundId) ?? bodyCompanyId) : null);
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
    /* W-AVI65 FIX 1 — audit against the VALIDATED company id (which resolves
     * DB-direct) rather than only the client-supplied one, so the audit row is
     * still written when the wizard omits companyId from the body. */
    const auditCompanyId = companyId ?? bodyCompanyId;
    if (auditCompanyId) {
      try {
        appendAdminAudit(
          ctx.userId ?? "u_unknown",
          `round:${roundId}`,
          "round.initial_shareholders.set",
          { roundId, count: normalised.length, source_breakdown: { crm: normalised.filter((s) => s.source === "crm").length, manual: normalised.filter((s) => s.source === "manual").length } },
          tenantForCompany(auditCompanyId),
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
    /* W-AVI65 FIX 1 (isolation) — this READ previously had NO ownership gate, so
     * any authenticated user could enumerate another tenant's picked initial
     * shareholders (names + emails) by guessing a roundId. It now uses the same
     * fail-closed gate as the PATCH twin. There is no client caller of this GET
     * (grep: client/src has none), so nothing is silently dropped. */
    const ownership = resolveRoundOwnership(ctx, roundId, null);
    if (!ctx.isAdmin && !ownership.owns) {
      return res.status(403).json({ ok: false, error: "not_round_owner" });
    }
    const shareholders = store.get(roundId) ?? [];
    return res.json({ ok: true, roundId, shareholders });
  });
}
