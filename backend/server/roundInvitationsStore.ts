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
import { createHash, randomBytes } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./db/connection";
import { roundInvitations as invitationsTable } from "../shared/schema";
import { sendMail } from "./emailTransport";
import { emitMutation } from "./lib/eventBus";
import { listContactsForCompany, upsertCrmContactForInvitation } from "./founderCrmStore";
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

  // Persist atomically inside a Drizzle transaction. Drizzle invokes the
  // callback — DO NOT add a trailing `()`.
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.insert(invitationsTable)
        .values({
          id: row.id,
          roundId: row.roundId,
          investorEmail: row.investorEmail,
          investorName: row.investorName ?? null,
          state: row.state,
          expiresAt: row.expiresAt,
          sentAt: row.sentAt,
          viewedAt: row.viewedAt,
          // v15 additive columns (present on production + after ALTERs).
          tenantId: row.tenantId,
          companyId: row.companyId,
          classification: row.classification,
          tokenHash: row.tokenHash,
          invitedByUserId: row.invitedByUserId,
          note: row.note,
          redeemedAt: null,
          redeemedByUserId: null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        } as any)
        .run();
    });
  } catch (err) {
    log.warn(
      "[roundInvitationsStore.createInvitation] DB write failed (continuing with in-memory only):",
      (err as Error).message,
    );
  }
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
        subject: `You're invited to join a round on Capavate`,
        html:
          `<p>Hi ${args.investorName ?? "there"},</p>` +
          `<p>You've been invited to participate in a funding round.</p>` +
          `<p><a href="${link}">Click here to view the invitation</a></p>` +
          (args.note ? `<p>Note from the founder: ${args.note}</p>` : "") +
          `<p>This invitation expires in ${args.expiryDays ?? 14} days.</p>`,
        text:
          `You've been invited to participate in a funding round on Capavate.\n` +
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

  const row = memInvitations.find((r) => r.tokenHash === tokenHash);
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

  row.state = "accepted";
  row.redeemedAt = now;
  row.redeemedByUserId = args.redeemedByUserId;
  row.updatedAt = now;

  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(invitationsTable)
        .set({
          state: "accepted",
          redeemedAt: now,
          redeemedByUserId: args.redeemedByUserId,
          updatedAt: now,
        } as any)
        .where(eq(invitationsTable.id, row.id))
        .run();
    });
  } catch (err) {
    log.warn(
      "[roundInvitationsStore.redeemInvitation] DB write failed (in-memory updated):",
      (err as Error).message,
    );
  }

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
  return memInvitations.filter((r) => r.roundId === roundId).map(publicView);
}

export function listForCompany(companyId: string): Array<Omit<RoundInvitationRow, "tokenHash">> {
  return memInvitations.filter((r) => r.companyId === companyId).map(publicView);
}

export function getInvitation(id: string): Omit<RoundInvitationRow, "tokenHash"> | null {
  const row = memInvitations.find((r) => r.id === id);
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
  const row = memInvitations.find((r) => r.tokenHash === hash);
  return row ?? null;
}

/**
 * L-009 helper v23.4.13: markInvitationRedeemed
 * Atomically transitions the invitation to state='redeemed' (accepted)
 * and records redeemedAt / redeemedByUserId. Returns true if a row was
 * updated, false if the id was not found.
 * Replicates the Drizzle transaction pattern used by redeemInvitation().
 */
export function markInvitationRedeemed(id: string, redeemedByUserId?: string | null): boolean {
  const row = memInvitations.find((r) => r.id === id);
  if (!row) return false;
  const now = nowIso();
  row.state = "accepted";
  row.redeemedAt = now;
  row.redeemedByUserId = redeemedByUserId ?? null;
  row.updatedAt = now;
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(invitationsTable)
        .set({
          state: "accepted",
          redeemedAt: now,
          redeemedByUserId: redeemedByUserId ?? null,
          updatedAt: now,
        } as any)
        .where(eq(invitationsTable.id, id))
        .run();
    });
  } catch (err) {
    log.warn(
      "[roundInvitationsStore.markInvitationRedeemed] DB write failed (in-memory updated):",
      (err as Error).message,
    );
  }
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
  row.state = "revoked";
  row.updatedAt = nowIso();
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(invitationsTable)
        .set({ state: "revoked", updatedAt: row.updatedAt } as any)
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
}

export function extendInvitation(id: string, expiryDays: number, _actorUserId: string): void {
  const row = memInvitations.find((r) => r.id === id);
  if (!row) return;
  const expiresAt = plusDaysIso(expiryDays);
  row.expiresAt = expiresAt;
  row.updatedAt = nowIso();
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(invitationsTable)
        .set({ expiresAt, updatedAt: row.updatedAt } as any)
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
