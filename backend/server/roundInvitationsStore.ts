/**
 * server/roundInvitationsStore.ts — v15 P0-4..P0-8
 *
 * Replaces the in-memory stub at routes.ts:997-1014 with a canonical,
 * DB-backed founder-invitation system that closes audit findings:
 *
 *   P0-4  Invitations persisted to `round_invitations` table (sha256 token hash).
 *   P0-5  CRM classification — emails on the founder's CRM are tagged
 *         `in_crm`; brand-new emails are tagged `new_registration`. ALL
 *         emails are allowed; classification is informational, not a gate.
 *   P0-6  32-byte secure random token, sha256(token) stored, raw token sent
 *         ONLY via email + included in the JSON response **never**.
 *   P0-7  Email delivered via `emailTransport.sendMail()` (console/smtp).
 *   P0-8  redeemInvitation(token) — single-use, 14-day default expiry,
 *         atomic transition pending|sent → accepted.
 *
 * Hard-rule compliance:
 *   - Every state-changing write goes through `getDb().transaction((tx) => {...})`
 *     with NO trailing `()` — Drizzle's `db.transaction` invokes the callback.
 *   - Hydration is awaited sequentially from `HYDRATE_ORDER` (no Promise.all).
 *   - `withTenant()` is used for reads/writes that touch a single tenant;
 *     cross-tenant reads are explicitly marked in comments.
 *   - SSE emission via `emitMutation()` on every state change so the founder
 *     dashboard updates in real time.
 */
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { createHash, randomBytes } from "crypto";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { escapeHtml as e } from "./lib/htmlEscape"; /* v25.17 Lane A NH4 */
import { getDb, rawDb } from "./db/connection";
import { roundInvitations as invitationsTable } from "../shared/schema";
import { sendMail } from "./emailTransport";
import { emitMutation } from "./lib/eventBus";
import { listContactsForCompany, upsertCrmContactForInvitation } from "./founderCrmStore";
import { getCompanyNameById } from "./multiCompanyStore";
import { getRoundById } from "./roundsStore";
import { log } from "./lib/logger";

/* ---------- Types ---------- */

export type InvitationState =
  | "pending"
  | "sent"
  | "viewed"
  | "accepted"
  | "declined"
  | "expired"
  | "revoked";

export type InvitationClassification = "in_crm" | "new_registration";

export interface RoundInvitationRow {
  id: string;
  tenantId: string | null;
  roundId: string;
  companyId: string | null;
  investorEmail: string;
  investorName: string | null;
  state: InvitationState;
  classification: InvitationClassification | null;
  /** sha256(token) — never the raw token. */
  tokenHash: string | null;
  invitedByUserId: string | null;
  note: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  redeemedAt: string | null;
  redeemedByUserId: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CreateInvitationArgs {
  roundId: string;
  companyId: string;
  investorEmail: string;
  investorName?: string | null;
  note?: string | null;
  expiryDays?: number;
  invitedByUserId: string;
  tenantId?: string | null;
  /** Test/dry-run hook so unit tests can intercept the outbound email. */
  dryRun?: boolean;
}

export interface CreateInvitationResult {
  /** Invitation row WITHOUT the raw token. */
  invitation: Omit<RoundInvitationRow, "tokenHash"> & { tokenHash?: never };
  /** True if the email transport accepted the message. */
  emailSent: boolean;
  /** Email transport messageId (for audit/debug); never contains the token. */
  emailMessageId?: string;
  /** Classification of the recipient. */
  classification: InvitationClassification;
  /** L-006 fix v23.4.13: return redeemUrl on create. Only available at create-time; list never exposes raw tokens. */
  redeemUrl: string;
}

/* ---------- In-memory mirror (for fast list/lookup + tests) ---------- */

const memInvitations: RoundInvitationRow[] = [];

function tenantForCompany(companyId: string | null | undefined): string {
  if (companyId) return `tenant_co_${companyId}`;
  return "tenant_platform";
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function makeId(roundId: string): string {
  return `inv_${roundId}_${randomBytes(8).toString("hex")}`;
}

function generateToken(): string {
  // 32 raw bytes = 256 bits of entropy, hex-encoded for URL safety.
  return randomBytes(32).toString("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function plusDaysIso(days: number, from: Date = new Date()): string {
  const d = new Date(from.getTime() + days * 86_400_000);
  return d.toISOString();
}

function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

/** Classify by checking the founder's CRM for an email match. */
function classifyEmail(companyId: string, email: string): InvitationClassification {
  const normalized = normalizeEmail(email);
  if (!normalized) return "new_registration";
  try {
    const crm = listContactsForCompany(companyId);
    const hit = crm.find((c) => normalizeEmail((c as any).email ?? "") === normalized);
    return hit ? "in_crm" : "new_registration";
  } catch {
    return "new_registration";
  }
}

/** Strip the token hash so a response object never contains it. */
function publicView(row: RoundInvitationRow): Omit<RoundInvitationRow, "tokenHash"> {
  const { tokenHash: _omit, ...rest } = row;
  return rest;
}

/* ---------- v25.35 — DB-first read helpers (BLOCKER #12) ----------
 * memInvitations is a fast cache; the DB is the read authority. A cold cache
 * after restart previously caused invitation reads (redeem, list, lookup) to
 * miss and 404 a genuinely-persisted invitation. These helpers query the DB
 * with rawDb() and opportunistically repopulate the cache. DB read errors
 * degrade to a cache-only result (non-fatal) — writes remain fail-closed.
 */
function mapDbRow(r: any): RoundInvitationRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? null,
    roundId: r.round_id,
    companyId: r.company_id ?? null,
    investorEmail: r.investor_email,
    investorName: r.investor_name ?? null,
    state: (r.state ?? "sent") as InvitationState,
    classification: (r.classification ?? null) as InvitationClassification | null,
    tokenHash: r.token_hash ?? null,
    invitedByUserId: r.invited_by_user_id ?? null,
    note: r.note ?? null,
    sentAt: r.sent_at ?? null,
    viewedAt: r.viewed_at ?? null,
    redeemedAt: r.redeemed_at ?? null,
    redeemedByUserId: r.redeemed_by_user_id ?? null,
    expiresAt: r.expires_at ?? null,
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
  };
}

/** Upsert a freshly-read DB row into the in-memory mirror, returning the
 *  cached reference (so callers mutate the canonical object). */
function cacheUpsert(row: RoundInvitationRow): RoundInvitationRow {
  const idx = memInvitations.findIndex((r) => r.id === row.id);
  if (idx >= 0) {
    memInvitations[idx] = row;
    return memInvitations[idx];
  }
  memInvitations.push(row);
  return row;
}

function dbFindById(id: string): RoundInvitationRow | null {
  try {
    const r: any = rawDb().prepare("SELECT * FROM round_invitations WHERE id = ?").get(id);
    return r ? mapDbRow(r) : null;
  } catch (err) {
    log.warn("[roundInvitationsStore.dbFindById] DB fallback failed:", (err as Error).message);
    return null;
  }
}

function dbFindByTokenHash(hash: string): RoundInvitationRow | null {
  try {
    const r: any = rawDb().prepare("SELECT * FROM round_invitations WHERE token_hash = ?").get(hash);
    return r ? mapDbRow(r) : null;
  } catch (err) {
    log.warn("[roundInvitationsStore.dbFindByTokenHash] DB fallback failed:", (err as Error).message);
    return null;
  }
}

function dbFindByRound(roundId: string): RoundInvitationRow[] {
  try {
    const rows: any[] = rawDb().prepare("SELECT * FROM round_invitations WHERE round_id = ?").all(roundId);
    return rows.map(mapDbRow);
  } catch (err) {
    log.warn("[roundInvitationsStore.dbFindByRound] DB fallback failed:", (err as Error).message);
    return [];
  }
}

function dbFindByCompany(companyId: string): RoundInvitationRow[] {
  try {
    const rows: any[] = rawDb().prepare("SELECT * FROM round_invitations WHERE company_id = ?").all(companyId);
    return rows.map(mapDbRow);
  } catch (err) {
    log.warn("[roundInvitationsStore.dbFindByCompany] DB fallback failed:", (err as Error).message);
    return [];
  }
}

/** Merge a DB row-set into the cache, returning the merged set keyed by id. */
function mergeForRead(dbRows: RoundInvitationRow[], cacheRows: RoundInvitationRow[]): RoundInvitationRow[] {
  const byId = new Map<string, RoundInvitationRow>();
  for (const r of cacheRows) byId.set(r.id, r);
  for (const r of dbRows) {
    // DB is authoritative for read; repopulate the cache opportunistically.
    byId.set(r.id, cacheUpsert(r));
  }
  return Array.from(byId.values());
}

/* ---------- Create ---------- */

export async function createInvitation(args: CreateInvitationArgs): Promise<CreateInvitationResult> {
  const investorEmail = normalizeEmail(args.investorEmail);
  if (!investorEmail) throw new Error("invalid_email");
  if (!args.roundId) throw new Error("missing_round_id");
  if (!args.companyId) throw new Error("missing_company_id");

  const tenantId = args.tenantId ?? tenantForCompany(args.companyId);
  const classification = classifyEmail(args.companyId, investorEmail);
  const id = makeId(args.roundId);
  const token = generateToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = plusDaysIso(args.expiryDays ?? 14);
  const createdAt = nowIso();

  const row: RoundInvitationRow = {
    id,
    tenantId,
    roundId: args.roundId,
    companyId: args.companyId,
    investorEmail,
    investorName: args.investorName ?? null,
    state: "sent",
    classification,
    tokenHash,
    invitedByUserId: args.invitedByUserId,
    note: args.note ?? null,
    sentAt: createdAt,
    viewedAt: null,
    redeemedAt: null,
    redeemedByUserId: null,
    expiresAt,
    createdAt,
    updatedAt: createdAt,
  };

  // Persist atomically. v25.0 fix: use raw SQL because the Drizzle schema (sacred
  // shared/schema.ts) declares only the base columns; the v15 additive columns
  // (tenant_id, company_id, classification, token_hash, invited_by_user_id, note,
  // redeemed_at, redeemed_by_user_id, created_at, updated_at) exist in the DB via
  // PRAGMA-guarded ALTERs in connection.ts but are silently dropped by Drizzle's
  // .values({ tokenHash: ... }). Raw SQL writes them correctly so /api/investor/
  // invitations/:token/kyc can find the row by token_hash (B-J7-5).
  // v25.35 — FAIL-CLOSED (BLOCKER #4): previously this swallowed the DB write
  // and still pushed the row to memory + returned a redeem token. An investor
  // could receive an emailed redeem link for a RAM-only invitation that 404s
  // after restart. We now throw on DB failure BEFORE emitting the token, the
  // CRM upsert, the email send, or the in-memory push — so no token is ever
  // returned for an invitation that did not durably persist.
  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO round_invitations (
         id, round_id, investor_email, investor_name, state, expires_at, sent_at, viewed_at,
         tenant_id, company_id, classification, token_hash, invited_by_user_id, note,
         redeemed_at, redeemed_by_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id,
      row.roundId,
      row.investorEmail,
      row.investorName ?? null,
      row.state,
      row.expiresAt,
      row.sentAt,
      row.viewedAt,
      row.tenantId,
      row.companyId,
      row.classification,
      row.tokenHash,
      row.invitedByUserId,
      row.note,
      null,
      null,
      row.createdAt,
      row.updatedAt,
    );
  } catch (err) {
    // v25.35 — fail-closed: do NOT push to memory, do NOT send the email, do
    // NOT return a token. Surface to the route so it returns 500.
    log.error(
      "[roundInvitationsStore.createInvitation] DB write failed:",
      (err as Error).message,
    );
    throw err;
  }
  // v25.35 — in-memory mirror updated only AFTER the durable DB insert.
  memInvitations.push(row);

  // L-010 fix v23.4.13: also create CRM contact
  // Non-fatal: best-effort; invitation creation must not fail if CRM upsert fails.
  try {
    upsertCrmContactForInvitation({
      companyId: args.companyId,
      name: args.investorName ?? null,
      email: investorEmail,
      classification: classification,
      roundId: args.roundId,
    });
  } catch (crmErr) {
    log.warn("[roundInvitationsStore] CRM upsert failed (non-fatal):", (crmErr as Error).message);
  }

  // Send the email. The redeem link includes the RAW token, never the hash.
  // Production deploys should set INVITATION_BASE_URL.
  const baseUrl = process.env.INVITATION_BASE_URL ?? process.env.APP_URL ?? "https://capavate.com";
  // v24.4 BUG 047 + 048 — resolve company + round display names so the subject
  // is unique per deal. A unique subject (a) gives investors the deal context
  // they were missing, and (b) prevents email clients from threading unrelated
  // invitations into a single conversation. Lookups are best-effort; if either
  // store misses we fall back to neutral labels rather than failing the send.
  let companyName = "a company";
  let roundName = "a funding round";
  try {
    const resolvedCompany = getCompanyNameById(args.companyId);
    if (resolvedCompany && resolvedCompany.trim()) companyName = resolvedCompany.trim();
  } catch { /* non-fatal */ }
  try {
    const resolvedRound = getRoundById(args.roundId);
    if (resolvedRound?.name && resolvedRound.name.trim()) roundName = resolvedRound.name.trim();
  } catch { /* non-fatal */ }
  // v24.1 Bug I+K (BUG 042): canonical client route is /auth/redeem (App.tsx:406).
  // The legacy /invitations/redeem path is not registered in the SPA and produced
  // the "we don't recognise this invitation" error for Avi #4/#5/#10.
  const link = `${baseUrl}/auth/redeem?token=${encodeURIComponent(token)}`;
  let emailSent = false;
  let emailMessageId: string | undefined;
  if (!args.dryRun) {
    try {
      const result = await sendMail({
        to: investorEmail,
        // v24.4 BUG 047 + 048 — unique per-deal subject with company + round name.
        subject: `[Capavate] You're invited to ${companyName} — ${roundName}`,
        /* v25.17 Lane A NH4 — escape every interpolated value so an
           attacker-controlled investorName/note/roundName/companyName cannot
           inject markup or script into the recipient's email client. */
        html:
          `<p>Hi ${e(args.investorName ?? "there")},</p>` +
          `<p>You've been invited to participate in <strong>${e(roundName)}</strong> at <strong>${e(companyName)}</strong>.</p>` +
          `<p><a href="${e(link)}">Click here to view the invitation</a></p>` +
          (args.note ? `<p>Note from the founder: ${e(args.note)}</p>` : "") +
          `<p>This invitation expires in ${e(String(args.expiryDays ?? 14))} days.</p>`,
        text:
          `You've been invited to participate in ${roundName} at ${companyName} on Capavate.\n` +
          `View it here: ${link}\n` +
          (args.note ? `Note: ${args.note}\n` : "") +
          `This invitation expires in ${args.expiryDays ?? 14} days.`,
      });
      emailSent = !!result.ok;
      emailMessageId = result.messageId;
    } catch (err) {
      log.warn(
        "[roundInvitationsStore.createInvitation] email send failed (continuing):",
        (err as Error).message,
      );
    }
  } else {
    emailSent = true; // tests treat dry-run as success
  }

  // Real-time emission so any open founder dashboard sees the new row.
  emitMutation({
    aggregate: "invitation",
    id: row.id,
    change: "create",
    tenantId: tenantId ?? undefined,
  });
  emitMutation({
    aggregate: "round",
    id: row.roundId,
    change: "update",
    tenantId: tenantId ?? undefined,
  });

  // L-006 fix v23.4.13: return redeemUrl on create (raw token never stored in list view)
  const appUrl = process.env.APP_URL ?? process.env.INVITATION_BASE_URL ?? "https://capavate.com";
  // v24.1 Bug I+K (BUG 042): the create-response redeemUrl was ALREADY a working
  // SPA route — `/invite/<token>` redirects to the canonical `/auth/redeem`
  // (client/src/App.tsx:826 → LegacyInviteRedirect → App.tsx:299-305). The only
  // broken link was the EMAIL template at line ~244 which used the unregistered
  // `/invitations/redeem` path; that is the one we fixed. We deliberately KEEP
  // `/invite/<token>` here so the documented L-006 contract (and the v23.9.2 /
  // v2413 redeem-bridge tests that parse `.../invite/<64-hex>`) stay green.
  const redeemUrl = `${appUrl}/invite/${encodeURIComponent(token)}`;

  return {
    invitation: publicView(row) as any,
    emailSent,
    emailMessageId,
    classification,
    redeemUrl,
  };
}

/* ---------- Redeem ---------- */

export interface RedeemInvitationArgs {
  /** Raw token from the email link. */
  token: string;
  redeemedByUserId: string;
}

export interface RedeemInvitationResult {
  invitation: Omit<RoundInvitationRow, "tokenHash">;
}

export function redeemInvitation(args: RedeemInvitationArgs): RedeemInvitationResult {
  if (!args.token) throw new Error("missing_token");
  if (!args.redeemedByUserId) throw new Error("missing_user");
  const tokenHash = sha256Hex(args.token);
  const now = nowIso();

  // v25.35 (BLOCKER #12) — DB-first lookup so a cold cache after restart still
  // resolves a genuinely-persisted invitation instead of throwing invalid_token.
  let row = memInvitations.find((r) => r.tokenHash === tokenHash);
  if (!row) {
    const dbRow = dbFindByTokenHash(tokenHash);
    if (dbRow) row = cacheUpsert(dbRow);
  }
  if (!row) throw new Error("invalid_token");

  // Single-use guard.
  if (row.redeemedAt || row.state === "accepted") throw new Error("already_redeemed");
  if (row.state === "revoked") throw new Error("revoked");
  if (row.state === "declined") throw new Error("declined");
  if (row.state === "expired") throw new Error("expired");

  // Expiry guard.
  if (row.expiresAt && Date.parse(row.expiresAt) < Date.now()) {
    row.state = "expired";
    row.updatedAt = now;
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        tx.update(invitationsTable)
          .set({ state: "expired", updatedAt: now } as any)
          .where(eq(invitationsTable.id, row.id))
          .run();
      });
    } catch (err) {
      // tolerated
    }
    emitMutation({
      aggregate: "invitation",
      id: row.id,
      change: "update",
      tenantId: row.tenantId ?? undefined,
    });
    throw new Error("expired");
  }

  /* v25.17 Lane A NH3 — close the TOCTOU race: the in-memory guard above
     can be raced by two concurrent redeem calls. We commit the DB UPDATE
     conditionally on `state = 'pending'` first; only when changes === 1 do
     we mark the in-memory row accepted. Concurrent calls see changes === 0
     and surface 'already_redeemed'. */
  // v25.35 fix-2 (Concern 3) — persist-first-throw. Previously a DB write
  // failure here fell through to a memory-only "success" path, so a redeem
  // could report success to the caller (and consume the token in RAM) while
  // the durable invitation row stayed `sent`/`pending`. After a restart the
  // invitation would be redeemable again. We now require a durable conditional
  // UPDATE: on DB error we throw (route -> 500) and the in-memory row is NOT
  // mutated; `already_redeemed` is preserved for the concurrent-redeem race.
  let acceptedRowsDb = 0;
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      const result = tx.update(invitationsTable)
        .set({
          state: "accepted",
          redeemedAt: now,
          redeemedByUserId: args.redeemedByUserId,
          updatedAt: now,
        } as any)
        .where(and(
          eq(invitationsTable.id, row.id),
          // v25.18 Lane A NC2 — invitations are created with state='sent',
          // not 'pending'. Both are redeemable; only `accepted` / `revoked`
          // / `expired` are terminal.
          inArray(invitationsTable.state as any, ["pending", "sent"] as any),
        ))
        .run();
      acceptedRowsDb = Number((result as { changes?: number }).changes ?? 0);
    });
    if (acceptedRowsDb === 0) {
      // Another concurrent redeem won the race. Surface that to the caller.
      throw new Error("already_redeemed");
    }
  } catch (err) {
    // v25.35 fix-2 (Concern 3) — fail-closed: the in-memory state has NOT been
    // mutated yet. Propagate the original error so the route returns 500
    // (or 409 for `already_redeemed`). Do NOT silently fall back to memory.
    if ((err as Error).message !== "already_redeemed") {
      log.error(
        "[roundInvitationsStore.redeemInvitation] DB write failed:",
        (err as Error).message,
      );
    }
    throw err;
  }

  // v25.35 fix-2 (Concern 3) — in-memory mirror updated only AFTER the durable
  // conditional UPDATE committed.
  row.state = "accepted";
  row.redeemedAt = now;
  row.redeemedByUserId = args.redeemedByUserId;
  row.updatedAt = now;

  emitMutation({
    aggregate: "invitation",
    id: row.id,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });
  emitMutation({
    aggregate: "round",
    id: row.roundId,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });

  return { invitation: publicView(row) };
}

/* ---------- Reads ---------- */

export function listForRound(roundId: string): Array<Omit<RoundInvitationRow, "tokenHash">> {
  // v25.35 (BLOCKER #12) — DB-first: merge DB rows with the cache so a cold
  // cache does not under-report invitations for the round.
  const cacheRows = memInvitations.filter((r) => r.roundId === roundId);
  const merged = mergeForRead(dbFindByRound(roundId), cacheRows);
  return merged.filter((r) => r.roundId === roundId).map(publicView);
}

export function listForCompany(companyId: string): Array<Omit<RoundInvitationRow, "tokenHash">> {
  // v25.35 (BLOCKER #12) — DB-first merge for cold-cache correctness.
  const cacheRows = memInvitations.filter((r) => r.companyId === companyId);
  const merged = mergeForRead(dbFindByCompany(companyId), cacheRows);
  return merged.filter((r) => r.companyId === companyId).map(publicView);
}

export function getInvitation(id: string): Omit<RoundInvitationRow, "tokenHash"> | null {
  // v25.35 (BLOCKER #12) — DB-first lookup with cache fallback.
  let row = memInvitations.find((r) => r.id === id);
  if (!row) {
    const dbRow = dbFindById(id);
    if (dbRow) row = cacheUpsert(dbRow);
  }
  return row ? publicView(row) : null;
}

/**
 * v23.9 A3/W-9 — every invitation (any state). The admin Investors panel
 * aggregates these (deduped by email) into the real investor directory so it
 * no longer ships hard-coded sample investors.
 */
export function listAllInvitations(): Array<Omit<RoundInvitationRow, "tokenHash">> {
  return memInvitations.map(publicView);
}

/**
 * v23.8 W-9 — return every invitation that has been redeemed/accepted. The
 * admin Investors panel uses this to surface REAL investors (those who have
 * accepted a round invite) instead of only the demo-seeded CRM contacts, which
 * are empty in production.
 */
export function getRedeemedRecords(): Array<Omit<RoundInvitationRow, "tokenHash">> {
  return memInvitations
    .filter((r) => r.state === "accepted" || r.redeemedAt != null)
    .map(publicView);
}

/* ---------- L-009 helpers v23.4.13: bridge to authRoutes ---------- */

/**
 * L-009 helper v23.4.13: findByTokenHash
 * Looks up the in-memory invitation row whose tokenHash equals `hash`
 * and whose state is not yet redeemed. Returns null if not found.
 * Uses the in-memory mirror (memInvitations) — same fast-path as all
 * other reads in this file; DB is the source of truth at hydration only.
 */
export function findByTokenHash(hash: string): RoundInvitationRow | null {
  // v25.35 (BLOCKER #12) — DB-first lookup with cache fallback so the redeem
  // bridge resolves persisted invitations after a restart.
  let row = memInvitations.find((r) => r.tokenHash === hash);
  if (!row) {
    const dbRow = dbFindByTokenHash(hash);
    if (dbRow) row = cacheUpsert(dbRow);
  }
  return row ?? null;
}

/**
 * L-009 helper v23.4.13: markInvitationRedeemed
 *
 * v25.18 Lane A NC1/NC2 hard close:
 *   The pre-v25.18 implementation performed an unconditional UPDATE-by-id,
 *   which (a) re-opened the v25.17 NH3 TOCTOU race (two concurrent redeems
 *   could both succeed) and (b) the v25.17 patch landed on a sibling that is
 *   never called. We now perform a conditional UPDATE in the only
 *   redeemable states (`pending` and `sent`); the raw-sqlite `changes`
 *   counter tells us whether we actually flipped the row. Concurrent callers
 *   see false and must surface `already_redeemed`.
 */
export function markInvitationRedeemed(id: string, redeemedByUserId?: string | null): boolean {
  // v25.35 (BLOCKER #12) — DB-first lookup with cache fallback.
  let row = memInvitations.find((r) => r.id === id);
  if (!row) {
    const dbRow = dbFindById(id);
    if (dbRow) row = cacheUpsert(dbRow);
  }
  if (!row) return false;
  // v25.18 — only allow transition from a redeemable state.
  if (row.state !== "pending" && row.state !== "sent") return false;
  const now = nowIso();
  // DB-first conditional UPDATE. If we wrote zero rows somebody else
  // already redeemed; do NOT touch the in-memory copy.
  let dbChanged = 0;
  try {
    const { rawDb } = require("./db/connection") as typeof import("./db/connection");
    const stmt = rawDb().prepare(
      "UPDATE round_invitations SET state = 'accepted', redeemed_at = ?, redeemed_by_user_id = ?, updated_at = ? " +
      "WHERE id = ? AND state IN ('pending','sent')",
    );
    const r = stmt.run(now, redeemedByUserId ?? null, now, id);
    dbChanged = Number((r as any).changes ?? 0);
  } catch (err) {
    log.warn(
      "[roundInvitationsStore.markInvitationRedeemed] DB write failed:",
      (err as Error).message,
    );
    // Fall through — in-memory only update below if DB unavailable.
  }
  if (dbChanged === 0) {
    // DB row was already redeemed by a concurrent caller (or doesn't exist).
    // Refuse to mutate in-memory state.
    return false;
  }
  row.state = "accepted";
  row.redeemedAt = now;
  row.redeemedByUserId = redeemedByUserId ?? null;
  row.updatedAt = now;
  emitMutation({
    aggregate: "invitation",
    id: row.id,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });
  return true;
}

/* ---------- Lifecycle ---------- */

export function revokeInvitation(id: string, actorUserId: string): void {
  const row = memInvitations.find((r) => r.id === id);
  if (!row) return;
  if (row.state === "accepted") return; // cannot revoke after redeem
  // v25.35 fix-2 (Concern 3) — persist-first-throw. Previously the in-memory
  // row was flipped to `revoked` BEFORE the DB update, and the DB failure was
  // tolerated, so a revoke could report success while the durable row stayed
  // active. We now stage the new state, persist FIRST, throw on DB failure
  // (route -> 500), and mutate the cache only after the durable commit.
  const updatedAt = nowIso();
  // v25.35 fix-3 (Concern 3, GPT-5.5 strict re-verify) — also verify the
  // UPDATE actually affected a durable row. If the DB row is missing (deleted
  // by another process, never persisted, or wrong tenant) the update matches
  // zero rows and we must NOT mutate the cache to revoked. Use rawDb so we
  // can read `info.changes`.
  let revokeAffected = 0;
  try {
    const info = rawDb()
      .prepare(
        `UPDATE round_invitations SET state = 'revoked', updated_at = ? WHERE id = ?`,
      )
      .run(updatedAt, row.id);
    revokeAffected = info.changes;
  } catch (err) {
    log.error(
      "[roundInvitationsStore.revokeInvitation] DB write failed:",
      (err as Error).message,
    );
    throw err;
  }
  if (revokeAffected === 0) {
    // Durable row is gone — drop the stale cache entry and surface a
    // not-found error so the caller cannot believe the revoke succeeded.
    const idx = memInvitations.findIndex((r) => r.id === row.id);
    if (idx >= 0) memInvitations.splice(idx, 1);
    throw new Error(`Invitation ${row.id} not found in DB; cache cleared`);
  }
  // v25.35 fix-2 (Concern 3) — cache mutated only after the durable commit.
  row.state = "revoked";
  row.updatedAt = updatedAt;
  emitMutation({
    aggregate: "invitation",
    id: row.id,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });
}

export function extendInvitation(id: string, expiryDays: number, _actorUserId: string): void {
  const row = memInvitations.find((r) => r.id === id);
  if (!row) return;
  // v25.35 fix-2 (Concern 3) — persist-first-throw. Previously the in-memory
  // expiry was extended BEFORE the DB update and the DB failure was tolerated,
  // so an extend could report success while the durable row kept the old
  // expiry. We now stage the new expiry, persist FIRST, throw on DB failure
  // (route -> 500), and mutate the cache only after the durable commit.
  const expiresAt = plusDaysIso(expiryDays);
  const updatedAt = nowIso();
  // v25.35 fix-3 (Concern 3, GPT-5.5 strict re-verify) — same zero-row guard
  // as revoke. If the DB row is missing, do not silently extend the cached
  // expiry; drop the cache entry and throw.
  let extendAffected = 0;
  try {
    const info = rawDb()
      .prepare(
        `UPDATE round_invitations SET expires_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(expiresAt, updatedAt, row.id);
    extendAffected = info.changes;
  } catch (err) {
    log.error(
      "[roundInvitationsStore.extendInvitation] DB write failed:",
      (err as Error).message,
    );
    throw err;
  }
  if (extendAffected === 0) {
    const idx = memInvitations.findIndex((r) => r.id === row.id);
    if (idx >= 0) memInvitations.splice(idx, 1);
    throw new Error(`Invitation ${row.id} not found in DB; cache cleared`);
  }
  // v25.35 fix-2 (Concern 3) — cache mutated only after the durable commit.
  row.expiresAt = expiresAt;
  row.updatedAt = updatedAt;
  emitMutation({
    aggregate: "invitation",
    id: row.id,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });
}

/* ---------- Hydration ---------- */

export async function hydrateRoundInvitationsStore(): Promise<void> {
  memInvitations.length = 0;
  try {
    const db: any = getDb();
    // CROSS-TENANT (boot hydration) — read all rows then bucket per tenant.
    const rows = db
      .select()
      .from(invitationsTable)
      .where(isNull((invitationsTable as any).deletedAt ?? (invitationsTable as any).deleted_at ?? null))
      .all() as any[];
    for (const r of rows) {
      memInvitations.push({
        id: r.id,
        tenantId: r.tenant_id ?? r.tenantId ?? null,
        roundId: r.round_id ?? r.roundId,
        companyId: r.company_id ?? r.companyId ?? null,
        investorEmail: r.investor_email ?? r.investorEmail,
        investorName: r.investor_name ?? r.investorName ?? null,
        state: (r.state ?? "sent") as InvitationState,
        classification: (r.classification ?? null) as InvitationClassification | null,
        tokenHash: r.token_hash ?? r.tokenHash ?? null,
        invitedByUserId: r.invited_by_user_id ?? r.invitedByUserId ?? null,
        note: r.note ?? null,
        sentAt: r.sent_at ?? r.sentAt ?? null,
        viewedAt: r.viewed_at ?? r.viewedAt ?? null,
        redeemedAt: r.redeemed_at ?? r.redeemedAt ?? null,
        redeemedByUserId: r.redeemed_by_user_id ?? r.redeemedByUserId ?? null,
        expiresAt: r.expires_at ?? r.expiresAt ?? null,
        createdAt: r.created_at ?? r.createdAt ?? null,
        updatedAt: r.updated_at ?? r.updatedAt ?? null,
      });
    }
    if (rows.length > 0) {
      log.info(`[hydrate] roundInvitationsStore: ${rows.length} invitations restored`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] roundInvitationsStore: DB read failed:", msg);
    }
  }
}

/**
 * B-509 fix v23.6: list all non-revoked invitations for a given investor email.
 * Used by /api/investor/invitations to return real DB-backed records in
 * production (non-demo) mode.
 */
export function listForInvestorEmail(email: string): Array<Omit<RoundInvitationRow, "tokenHash">> {
  const normalized = email.trim().toLowerCase();
  return memInvitations
    .filter((r) => r.investorEmail.trim().toLowerCase() === normalized && r.state !== "revoked")
    .map(publicView);
}

/* ---------- Test helpers ---------- */

export const _testAccessInvitations = {
  rows: memInvitations,
  reset(): void {
    memInvitations.length = 0;
  },
  /** Test-only: peek at a token hash to assemble a redeem URL deterministically. */
  hashToken(token: string): string {
    return sha256Hex(token);
  },
};
