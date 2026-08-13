// server/lib/esignatureStore.ts
//
// WAVE 11 / EN-9 — e-signature execution of LPA / subscription documents.
//
// WIRED-OR-BUILT: BUILT ENGINE, WIRED PROVIDER.
//   Verified at source before writing a line (trap #2 — ten times this wave's
//   predecessors found the thing already existed):
//     * `grep -rniE 'docusign|adobe_sign|signature_request' server/ client/src`
//       -> no integration. The notification kind
//       `spv.subscription_countersigned` exists at server/notificationsStore.ts
//       :57 and :99 and is listed in the admin composer at
//       client/src/pages/admin/NotificationComposer.tsx:65 — A RESERVED SLOT WITH
//       NO PRODUCER. This file becomes its first producer rather than inventing a
//       new notification kind.
//     * The typed-name click-through at
//       server/lib/partnerSelfServiceRoutes.ts POST /api/partner/me/agreement
//       hashes `pid|version|name|signedAt` into
//       contacts.partner_agreement_signature_hash. That is a REAL signing method
//       and it is preserved here as the DEFAULT provider
//       ("internal_attestation") — not replaced. What it could not do is
//       represent TWO parties against ONE document (an LP signs, the GP
//       countersigns), which is exactly what an LPA needs.
//     * Document bytes: the dataroom byte seam. `listFilesForCompany`
//       (server/dataroomStore.ts:513) exposes each file's `sha256`, so an
//       envelope can bind itself to the bytes it was sent against WITHOUT
//       copying them. If the file is later replaced, the hash recorded on the
//       envelope no longer matches and the mismatch is visible.
//
// THE SINK. Every status change on an envelope or recipient funnels through
// `transitionEnvelope` / `recordSignature` in THIS file; both write via
// `appendEsignEvent` in the same transaction, so no status can move without an
// audit row. Nothing else in the tree writes these three tables — proved by the
// second-path scan in the EN-9 test.
//
// FAIL-CLOSED PROVIDER RULE. `collective.esignature.provider` is read from
// platform_config at SEND time and frozen onto the envelope. If it names an
// EXTERNAL provider, the send is refused unless that provider is actually
// configured (credentials present AND an adapter registered). It is NEVER
// silently downgraded to a typed name: an LPA the owner believes DocuSign
// executed must not turn out to have been a text box.
//
// MONEY / PERCENT: this file handles neither. No amounts, no fractions.
// CLASSIFICATION: none. Nothing here reads or writes permissions or navigation
// (the PT-5 fence is untouched).
import { createHash, randomUUID } from "node:crypto";
import { rawDb } from "../db/connection";
import { isSqlite } from "../db/portable";
import { applyWave11SubscriptionSchema } from "./applyWave11SubscriptionSchema";
import { applyWave38EventLedgerSchema } from "./applyWave38EventLedgerSchema";
import {
  ensurePlatformConfigKey,
  readConfigRow,
  type ConfigRow,
} from "./platformConfigWriter";

export const ESIGN_PROVIDER_CONFIG_KEY = "collective.esignature.provider";
export const ESIGN_INTERNAL_PROVIDER = "internal_attestation";

export type EnvelopeStatus =
  | "draft"
  | "sent"
  | "partially_signed"
  | "completed"
  | "declined"
  | "voided"
  | "expired"
  | "failed";

export type RecipientRole = "signer" | "countersigner" | "cc";
export type RecipientStatus = "pending" | "sent" | "signed" | "declined" | "bounced";

export class EsignError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EsignError";
  }
}

export interface EnvelopeRow {
  id: string;
  subjectKind: string;
  subjectId: string;
  documentKind: string;
  documentRef: string;
  documentTitle: string;
  documentSha256: string | null;
  provider: string;
  providerEnvelopeId: string | null;
  status: EnvelopeStatus;
  createdBy: string | null;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  voidedAt: string | null;
  expiresAt: string | null;
  completionHash: string | null;
  lastError: string | null;
}

export interface RecipientRow {
  id: string;
  envelopeId: string;
  role: RecipientRole;
  signingOrder: number;
  partyKind: string;
  partyId: string | null;
  fullName: string;
  email: string;
  status: RecipientStatus;
  signedName: string | null;
  signatureHash: string | null;
  signedAt: string | null;
  declinedReason: string | null;
  createdAt: string;
}

export interface EsignEventRow {
  id: string;
  envelopeId: string;
  recipientId: string | null;
  eventKind: string;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string | null;
  detailJson: string | null;
  createdAt: string;
}

/* ==========================================================================
 * Provider adapters.
 *
 * An adapter is registered in code and ENABLED by configuration. The registry
 * starts with exactly one entry — the internal attestation, which is the method
 * the platform already uses — so a fresh install signs documents the same way it
 * always did, only now with an envelope, an order and an audit trail.
 *
 * `isConfigured()` is what makes an external provider fail closed. A provider
 * that is named in config but reports itself unconfigured cannot send.
 * ======================================================================== */
export interface EsignProviderAdapter {
  readonly name: string;
  readonly external: boolean;
  /** Credentials/endpoint present? External adapters MUST return false without them. */
  isConfigured(): boolean;
  /**
   * Hand the envelope to the provider. Returns the provider-side id when there
   * is one. The internal adapter has no remote side and returns null.
   */
  send(envelope: EnvelopeRow, recipients: RecipientRow[]): { providerEnvelopeId: string | null };
}

const internalAttestationAdapter: EsignProviderAdapter = {
  name: ESIGN_INTERNAL_PROVIDER,
  external: false,
  isConfigured: () => true,
  send: () => ({ providerEnvelopeId: null }),
};

const adapters = new Map<string, EsignProviderAdapter>([
  [internalAttestationAdapter.name, internalAttestationAdapter],
]);

/** Register an adapter (used by deployments that add a real vendor, and tests). */
export function registerEsignProvider(a: EsignProviderAdapter): void {
  adapters.set(a.name, a);
}
export function listEsignProviders(): Array<{ name: string; external: boolean; configured: boolean }> {
  /* Array.from, not a spread: the tsconfig target predates downlevelIteration
     and spreading a MapIterator adds a TS2802 to the frozen error budget. */
  return Array.from(adapters.values()).map((a) => ({
    name: a.name,
    external: a.external,
    configured: a.isConfigured(),
  }));
}
/** Test seam: drop everything except the built-in internal adapter. */
export function _resetEsignProvidersForTests(): void {
  adapters.clear();
  adapters.set(internalAttestationAdapter.name, internalAttestationAdapter);
}

/* ==========================================================================
 * Schema presence. A-22: the sacred bootstrap does NOT know these tables, so a
 * missing schema means the migration has not run; the installer
 * (applyWave11SubscriptionSchema) is the self-heal path.
 * ======================================================================== */
let schemaChecked = false;
let schemaPresent = false;
let healAttempted = false;

/**
 * A-22 SELF-HEAL. The sacred bootstrap (connection.ts) does not know migration
 * 0168, so on a database where the migration runner has not been through, the
 * tables are simply absent and every route would 503. The installer reads the
 * DDL from the migration FILE (never a second copy of the DDL in TypeScript,
 * which is how the two drift), so healing and migrating cannot disagree.
 */
function healSchemaOnce(): void {
  if (healAttempted) return;
  healAttempted = true;
  try {
    if (isSqlite()) {
      applyWave11SubscriptionSchema(rawDb());
      // WAVE 38 ROW 4 — 0183 adds the canonical ledger columns to
      // `esign_event`. The bootstrap path never runs 0183, so the heal must.
      applyWave38EventLedgerSchema(rawDb());
    }
  } catch {
    /* fail-soft: the migration runner is the primary path */
  }
}

export function esignSchemaInstalled(): boolean {
  if (schemaChecked) return schemaPresent;
  healSchemaOnce();
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM sqlite_master
          WHERE type='table' AND name IN ('esign_envelope','esign_recipient','esign_event')`,
      )
      .get();
    schemaPresent = Number(row?.n ?? 0) === 3;
  } catch {
    schemaPresent = false;
  }
  schemaChecked = true;
  return schemaPresent;
}
export function _resetEsignSchemaGuardForTests(): void {
  schemaChecked = false;
  schemaPresent = false;
  healAttempted = false;
}

function requireSchema(): void {
  if (!esignSchemaInstalled()) {
    throw new EsignError(
      "ESIGN_SCHEMA_MISSING",
      "The e-signature tables are not installed. Run migration 0168_wave11_esignature_envelope.sql (the Wave 11 installer applies it).",
    );
  }
}

/* ==========================================================================
 * Configuration. The provider key is created on first read through the audited
 * genesis path, so the value is owner-changeable from that moment on rather than
 * being a constant in code.
 * ======================================================================== */
export function readEsignProviderConfig(): {
  configuredName: string;
  row: ConfigRow | null;
  configMissing: boolean;
} {
  let row = readConfigRow(ESIGN_PROVIDER_CONFIG_KEY);
  if (!row) {
    try {
      row = ensurePlatformConfigKey({
        key: ESIGN_PROVIDER_CONFIG_KEY,
        valueJson: JSON.stringify(ESIGN_INTERNAL_PROVIDER),
        valueType: "string",
        description:
          "WAVE 11 / EN-9 — which e-signature provider executes LPA and subscription documents. Default: internal_attestation (typed-name, the method already in use). Naming an external provider that is not configured makes sends FAIL, never downgrade.",
        createdBy: "wave11:en9:installer",
      });
    } catch {
      row = null;
    }
  }
  if (!row) return { configuredName: ESIGN_INTERNAL_PROVIDER, row: null, configMissing: true };
  let name: unknown;
  try {
    name = JSON.parse(row.valueJson);
  } catch {
    name = null;
  }
  if (typeof name !== "string" || name.trim() === "") {
    return { configuredName: ESIGN_INTERNAL_PROVIDER, row, configMissing: true };
  }
  return { configuredName: name.trim(), row, configMissing: false };
}

/**
 * Resolve the adapter that may execute a send RIGHT NOW, or throw.
 * This is the fail-closed gate.
 */
export function resolveEsignAdapter(): EsignProviderAdapter {
  const { configuredName, configMissing } = readEsignProviderConfig();
  if (configMissing) {
    throw new EsignError(
      "ESIGN_PROVIDER_NOT_CONFIGURED",
      `platform_config['${ESIGN_PROVIDER_CONFIG_KEY}'] is missing or not a provider name. Refusing to send rather than guessing a signing method.`,
    );
  }
  const adapter = adapters.get(configuredName);
  if (!adapter) {
    throw new EsignError(
      "ESIGN_PROVIDER_UNKNOWN",
      `No adapter is registered for provider '${configuredName}'. Sends are refused — a document is NOT downgraded to typed-name attestation because the configured vendor is unavailable.`,
    );
  }
  if (!adapter.isConfigured()) {
    throw new EsignError(
      "ESIGN_PROVIDER_UNCONFIGURED",
      `Provider '${configuredName}' is registered but not configured (missing credentials or endpoint). Sends are refused, NOT downgraded.`,
    );
  }
  return adapter;
}

/* ==========================================================================
 * Reads.
 * ======================================================================== */
const ENVELOPE_COLS = `id, subject_kind AS subjectKind, subject_id AS subjectId,
        document_kind AS documentKind, document_ref AS documentRef,
        document_title AS documentTitle, document_sha256 AS documentSha256,
        provider, provider_envelope_id AS providerEnvelopeId, status,
        created_by AS createdBy, created_at AS createdAt, sent_at AS sentAt,
        completed_at AS completedAt, voided_at AS voidedAt, expires_at AS expiresAt,
        completion_hash AS completionHash, last_error AS lastError`;

const RECIPIENT_COLS = `id, envelope_id AS envelopeId, role, signing_order AS signingOrder,
        party_kind AS partyKind, party_id AS partyId, full_name AS fullName, email,
        status, signed_name AS signedName, signature_hash AS signatureHash,
        signed_at AS signedAt, declined_reason AS declinedReason, created_at AS createdAt`;

export function getEnvelope(id: string): EnvelopeRow | null {
  requireSchema();
  const db: any = rawDb();
  return (
    (db.prepare(`SELECT ${ENVELOPE_COLS} FROM esign_envelope WHERE id = ?`).get(id) as
      | EnvelopeRow
      | undefined) ?? null
  );
}

export function listEnvelopesForSubject(subjectKind: string, subjectId: string): EnvelopeRow[] {
  requireSchema();
  const db: any = rawDb();
  return db
    .prepare(
      `SELECT ${ENVELOPE_COLS} FROM esign_envelope
        WHERE subject_kind = ? AND subject_id = ?
        ORDER BY created_at DESC, id DESC`,
    )
    .all(subjectKind, subjectId) as EnvelopeRow[];
}

export function listRecipients(envelopeId: string): RecipientRow[] {
  requireSchema();
  const db: any = rawDb();
  return db
    .prepare(
      `SELECT ${RECIPIENT_COLS} FROM esign_recipient
        WHERE envelope_id = ? ORDER BY signing_order ASC, created_at ASC`,
    )
    .all(envelopeId) as RecipientRow[];
}

export function listEsignEvents(envelopeId: string): EsignEventRow[] {
  requireSchema();
  const db: any = rawDb();
  return db
    .prepare(
      `SELECT id, envelope_id AS envelopeId, recipient_id AS recipientId,
              event_kind AS eventKind, from_status AS fromStatus, to_status AS toStatus,
              actor, detail_json AS detailJson, created_at AS createdAt
         FROM esign_event WHERE envelope_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(envelopeId) as EsignEventRow[];
}

/* ==========================================================================
 * Writes. All of them.
 * ======================================================================== */
function nowIso(): string {
  return new Date().toISOString();
}

export function appendEsignEvent(input: {
  envelopeId: string;
  recipientId?: string | null;
  eventKind: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor?: string | null;
  detail?: unknown;
  idempotencyKey?: string | null;
}): string {
  requireSchema();
  const db: any = rawDb();
  const id = `ese_${randomUUID()}`;
  db.prepare(
    // WAVE 38 ROW 4 — canonical event columns (migration 0183). `actor_id` is
    // NOT NULL; provider-driven callbacks have no human actor, and 'system' is
    // the honest name for those rather than a fabricated user id. `seq` is
    // per-parent over `envelope_id`, derived in-statement.
    `INSERT INTO esign_event
       (id, envelope_id, recipient_id, event_kind, from_status, to_status, actor,
        detail_json, actor_id, idempotency_key, seq, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,
             (SELECT COALESCE(MAX(seq), 0) + 1 FROM esign_event WHERE envelope_id = ?),
             ?)`,
  ).run(
    id,
    input.envelopeId,
    input.recipientId ?? null,
    input.eventKind,
    input.fromStatus ?? null,
    input.toStatus ?? null,
    input.actor ?? null,
    input.detail === undefined ? null : JSON.stringify(input.detail),
    ((input.actor ?? "").trim() === "" ? "system" : (input.actor as string).trim()),
    input.idempotencyKey ?? null,
    input.envelopeId,
    nowIso(),
  );
  return id;
}

export interface CreateEnvelopeInput {
  subjectKind: string;
  subjectId: string;
  documentKind: string;
  documentRef: string;
  documentTitle: string;
  /** Bytes hash at send time — the dataroom byte seam. */
  documentSha256?: string | null;
  createdBy?: string | null;
  expiresAt?: string | null;
  recipients: Array<{
    role?: RecipientRole;
    signingOrder?: number;
    partyKind: string;
    partyId?: string | null;
    fullName: string;
    email: string;
  }>;
}

/**
 * Create a DRAFT envelope with its recipients. No provider is contacted here and
 * nothing is signable yet — `sendEnvelope` is the transition that resolves and
 * freezes the provider.
 */
export function createEnvelope(input: CreateEnvelopeInput): EnvelopeRow {
  requireSchema();
  if (input.recipients.length === 0) {
    throw new EsignError("ESIGN_NO_RECIPIENTS", "An envelope needs at least one recipient.");
  }
  const signers = input.recipients.filter((r) => (r.role ?? "signer") !== "cc");
  if (signers.length === 0) {
    throw new EsignError(
      "ESIGN_NO_SIGNERS",
      "An envelope needs at least one signer or countersigner; cc-only cannot execute a document.",
    );
  }
  for (const r of input.recipients) {
    if (!r.fullName.trim()) throw new EsignError("ESIGN_RECIPIENT_NAME_REQUIRED", "Each recipient needs a full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim())) {
      throw new EsignError("ESIGN_RECIPIENT_EMAIL_INVALID", `'${r.email}' is not a usable email address.`);
    }
  }
  /* The provider is resolved at SEND time, but it is checked HERE too so a
     draft is not created against a signing method that cannot execute. */
  const provider = resolveEsignAdapter().name;

  const db: any = rawDb();
  const id = `esv_${randomUUID()}`;
  const created = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO esign_envelope
         (id, subject_kind, subject_id, document_kind, document_ref, document_title,
          document_sha256, provider, provider_envelope_id, status, created_by,
          created_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,NULL,'draft',?,?,?)`,
    ).run(
      id,
      input.subjectKind,
      input.subjectId,
      input.documentKind,
      input.documentRef,
      input.documentTitle,
      input.documentSha256 ?? null,
      provider,
      input.createdBy ?? null,
      created,
      input.expiresAt ?? null,
    );
    let order = 0;
    for (const r of input.recipients) {
      order += 1;
      db.prepare(
        `INSERT INTO esign_recipient
           (id, envelope_id, role, signing_order, party_kind, party_id, full_name,
            email, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,'pending',?)`,
      ).run(
        `esr_${randomUUID()}`,
        id,
        r.role ?? "signer",
        r.signingOrder ?? order,
        r.partyKind,
        r.partyId ?? null,
        r.fullName.trim(),
        r.email.trim().toLowerCase(),
        created,
      );
    }
    appendEsignEvent({
      envelopeId: id,
      eventKind: "envelope.created",
      toStatus: "draft",
      actor: input.createdBy ?? null,
      detail: {
        provider,
        documentKind: input.documentKind,
        documentRef: input.documentRef,
        recipientCount: input.recipients.length,
      },
    });
  });
  tx();
  return getEnvelope(id)!;
}

/** The single status-transition sink. */
function transitionEnvelope(input: {
  envelope: EnvelopeRow;
  to: EnvelopeStatus;
  eventKind: string;
  actor?: string | null;
  detail?: unknown;
  sentAt?: string | null;
  completedAt?: string | null;
  voidedAt?: string | null;
  completionHash?: string | null;
  providerEnvelopeId?: string | null;
  lastError?: string | null;
}): EnvelopeRow {
  const db: any = rawDb();
  const from = input.envelope.status;
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE esign_envelope
          SET status = ?,
              sent_at = COALESCE(?, sent_at),
              completed_at = COALESCE(?, completed_at),
              voided_at = COALESCE(?, voided_at),
              completion_hash = COALESCE(?, completion_hash),
              provider_envelope_id = COALESCE(?, provider_envelope_id),
              last_error = ?
        WHERE id = ?`,
    ).run(
      input.to,
      input.sentAt ?? null,
      input.completedAt ?? null,
      input.voidedAt ?? null,
      input.completionHash ?? null,
      input.providerEnvelopeId ?? null,
      input.lastError ?? null,
      input.envelope.id,
    );
    appendEsignEvent({
      envelopeId: input.envelope.id,
      eventKind: input.eventKind,
      fromStatus: from,
      toStatus: input.to,
      actor: input.actor ?? null,
      detail: input.detail,
    });
  });
  tx();
  return getEnvelope(input.envelope.id)!;
}

/**
 * Hand a draft envelope to its provider.
 *
 * FAIL CLOSED, AND RECORD THE FAILURE. If the adapter refuses or throws, the
 * envelope moves to `failed` with the reason on the row — it does NOT stay
 * `draft` looking untouched, and it is NOT downgraded to another provider.
 */
export function sendEnvelope(envelopeId: string, actor?: string | null): EnvelopeRow {
  requireSchema();
  const env = getEnvelope(envelopeId);
  if (!env) throw new EsignError("ESIGN_ENVELOPE_NOT_FOUND", `No envelope '${envelopeId}'.`);
  if (env.status !== "draft") {
    throw new EsignError(
      "ESIGN_NOT_DRAFT",
      `Envelope '${envelopeId}' is '${env.status}'; only a draft can be sent.`,
    );
  }
  const recipients = listRecipients(envelopeId);
  let adapter: EsignProviderAdapter;
  try {
    adapter = resolveEsignAdapter();
  } catch (err) {
    transitionEnvelope({
      envelope: env,
      to: "failed",
      eventKind: "envelope.send_refused",
      actor,
      lastError: err instanceof Error ? err.message : String(err),
      detail: { reason: err instanceof EsignError ? err.code : "UNKNOWN" },
    });
    throw err;
  }
  /* The provider was frozen on the row at creation. If configuration changed in
     between, the envelope is NOT quietly re-pointed at the new vendor. */
  if (adapter.name !== env.provider) {
    const msg = `Envelope was created for provider '${env.provider}' but configuration now names '${adapter.name}'. Create a new envelope; an existing one is not re-pointed.`;
    transitionEnvelope({
      envelope: env,
      to: "failed",
      eventKind: "envelope.send_refused",
      actor,
      lastError: msg,
      detail: { reason: "ESIGN_PROVIDER_CHANGED", was: env.provider, now: adapter.name },
    });
    throw new EsignError("ESIGN_PROVIDER_CHANGED", msg);
  }

  let providerEnvelopeId: string | null = null;
  try {
    providerEnvelopeId = adapter.send(env, recipients).providerEnvelopeId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    transitionEnvelope({
      envelope: env,
      to: "failed",
      eventKind: "envelope.send_failed",
      actor,
      lastError: msg,
      detail: { provider: adapter.name },
    });
    throw new EsignError("ESIGN_SEND_FAILED", msg);
  }

  const sentAt = nowIso();
  const db: any = rawDb();
  db.prepare(
    `UPDATE esign_recipient SET status='sent'
      WHERE envelope_id = ? AND status='pending' AND role <> 'cc'`,
  ).run(envelopeId);
  return transitionEnvelope({
    envelope: env,
    to: "sent",
    eventKind: "envelope.sent",
    actor,
    sentAt,
    providerEnvelopeId,
    detail: { provider: adapter.name, recipients: recipients.length },
  });
}

/**
 * The signature itself.
 *
 * SIGNING ORDER IS ENFORCED: a countersigner at order 2 cannot sign before the
 * signer at order 1. Without that an LPA could be "countersigned" against a
 * document nobody had signed.
 *
 * The hash binds name + envelope + document bytes + timestamp, the same
 * construction the partner-agreement attestation uses, extended with the
 * document hash so a signature cannot be transplanted onto another file.
 */
export function recordSignature(input: {
  envelopeId: string;
  recipientId: string;
  signedName: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  actor?: string | null;
}): { envelope: EnvelopeRow; recipient: RecipientRow; completed: boolean } {
  requireSchema();
  const env = getEnvelope(input.envelopeId);
  if (!env) throw new EsignError("ESIGN_ENVELOPE_NOT_FOUND", `No envelope '${input.envelopeId}'.`);
  if (env.status !== "sent" && env.status !== "partially_signed") {
    throw new EsignError(
      "ESIGN_NOT_SIGNABLE",
      `Envelope '${input.envelopeId}' is '${env.status}'; it is not open for signature.`,
    );
  }
  const name = input.signedName.trim();
  if (!name) throw new EsignError("ESIGN_SIGNATURE_NAME_REQUIRED", "A signature needs a typed name.");

  const recipients = listRecipients(input.envelopeId);
  const me = recipients.find((r) => r.id === input.recipientId);
  if (!me) throw new EsignError("ESIGN_RECIPIENT_NOT_FOUND", `No recipient '${input.recipientId}' on this envelope.`);
  if (me.role === "cc") {
    throw new EsignError("ESIGN_CC_CANNOT_SIGN", "A cc recipient is not a signatory.");
  }
  if (me.status === "signed") {
    throw new EsignError("ESIGN_ALREADY_SIGNED", "This recipient has already signed.");
  }
  if (me.status === "declined") {
    throw new EsignError("ESIGN_ALREADY_DECLINED", "This recipient declined; the envelope must be re-issued.");
  }
  const blockers = recipients.filter(
    (r) => r.role !== "cc" && r.signingOrder < me.signingOrder && r.status !== "signed",
  );
  if (blockers.length > 0) {
    throw new EsignError(
      "ESIGN_OUT_OF_ORDER",
      `Signing order ${me.signingOrder} is blocked: ${blockers.length} earlier signatory/ies have not signed.`,
    );
  }

  const signedAt = nowIso();
  const signatureHash = createHash("sha256")
    .update(
      [
        env.id,
        env.documentKind,
        env.documentRef,
        env.documentSha256 ?? "",
        String(me.signingOrder),
        me.email,
        name,
        signedAt,
      ].join("|"),
    )
    .digest("hex");

  const db: any = rawDb();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE esign_recipient
          SET status='signed', signed_name=?, signature_hash=?, signed_at=?,
              ip_address=?, user_agent=?
        WHERE id = ? AND status <> 'signed'`,
    ).run(
      name,
      signatureHash,
      signedAt,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.recipientId,
    );
    appendEsignEvent({
      envelopeId: env.id,
      recipientId: input.recipientId,
      eventKind: me.role === "countersigner" ? "recipient.countersigned" : "recipient.signed",
      actor: input.actor ?? me.email,
      detail: { signingOrder: me.signingOrder, signatureHash },
    });
  });
  tx();

  const after = listRecipients(input.envelopeId);
  const signatories = after.filter((r) => r.role !== "cc");
  const allSigned = signatories.every((r) => r.status === "signed");

  let envelope: EnvelopeRow;
  if (allSigned) {
    /* Completion hash chains the signatures IN SIGNING ORDER, so the executed
       document has one verifiable identity covering every party. */
    const chain = signatories
      .slice()
      .sort((a, b) => a.signingOrder - b.signingOrder)
      .reduce(
        (acc, r) => createHash("sha256").update(`${acc}|${r.signatureHash ?? ""}`).digest("hex"),
        env.documentSha256 ?? env.documentRef,
      );
    envelope = transitionEnvelope({
      envelope: env,
      to: "completed",
      eventKind: "envelope.completed",
      actor: input.actor ?? null,
      completedAt: signedAt,
      completionHash: chain,
      detail: { signatories: signatories.length },
    });
  } else {
    envelope = transitionEnvelope({
      envelope: env,
      to: "partially_signed",
      eventKind: "envelope.partially_signed",
      actor: input.actor ?? null,
      detail: {
        signed: signatories.filter((r) => r.status === "signed").length,
        of: signatories.length,
      },
    });
  }

  return {
    envelope,
    recipient: after.find((r) => r.id === input.recipientId)!,
    completed: allSigned,
  };
}

export function declineSignature(input: {
  envelopeId: string;
  recipientId: string;
  reason: string;
  actor?: string | null;
}): EnvelopeRow {
  requireSchema();
  const env = getEnvelope(input.envelopeId);
  if (!env) throw new EsignError("ESIGN_ENVELOPE_NOT_FOUND", `No envelope '${input.envelopeId}'.`);
  if (env.status !== "sent" && env.status !== "partially_signed") {
    throw new EsignError("ESIGN_NOT_SIGNABLE", `Envelope is '${env.status}'.`);
  }
  const db: any = rawDb();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE esign_recipient SET status='declined', declined_reason=?
        WHERE id = ? AND envelope_id = ? AND status <> 'signed'`,
    ).run(input.reason, input.recipientId, input.envelopeId);
    appendEsignEvent({
      envelopeId: env.id,
      recipientId: input.recipientId,
      eventKind: "recipient.declined",
      actor: input.actor ?? null,
      detail: { reason: input.reason },
    });
  });
  tx();
  return transitionEnvelope({
    envelope: env,
    to: "declined",
    eventKind: "envelope.declined",
    actor: input.actor ?? null,
    detail: { recipientId: input.recipientId },
  });
}

export function voidEnvelope(envelopeId: string, reason: string, actor?: string | null): EnvelopeRow {
  requireSchema();
  const env = getEnvelope(envelopeId);
  if (!env) throw new EsignError("ESIGN_ENVELOPE_NOT_FOUND", `No envelope '${envelopeId}'.`);
  if (env.status === "completed") {
    throw new EsignError(
      "ESIGN_COMPLETED_CANNOT_VOID",
      "A fully executed envelope cannot be voided; issue an amendment instead.",
    );
  }
  return transitionEnvelope({
    envelope: env,
    to: "voided",
    eventKind: "envelope.voided",
    actor: actor ?? null,
    voidedAt: nowIso(),
    detail: { reason },
  });
}

/**
 * Reporting projection: envelope + recipients + audit, plus a plain-language
 * `nextAction`. REPORTING ONLY — it grants nothing and gates nothing.
 */
export function envelopeDetail(envelopeId: string): {
  envelope: EnvelopeRow;
  recipients: RecipientRow[];
  events: EsignEventRow[];
  nextAction: string;
  documentHashBound: boolean;
} | null {
  requireSchema();
  const envelope = getEnvelope(envelopeId);
  if (!envelope) return null;
  const recipients = listRecipients(envelopeId);
  const signatories = recipients.filter((r) => r.role !== "cc");
  const pending = signatories
    .filter((r) => r.status !== "signed")
    .sort((a, b) => a.signingOrder - b.signingOrder);
  let nextAction: string;
  switch (envelope.status) {
    case "draft":
      nextAction = `Not sent yet. ${signatories.length} signatory/ies will be invited in order.`;
      break;
    case "sent":
    case "partially_signed":
      nextAction = pending[0]
        ? `Awaiting ${pending[0].role === "countersigner" ? "countersignature" : "signature"} from ${pending[0].fullName} (order ${pending[0].signingOrder}).`
        : "All signatures recorded; completion pending.";
      break;
    case "completed":
      nextAction = "Fully executed. No further action.";
      break;
    case "declined":
      nextAction = "Declined. Re-issue a new envelope to proceed.";
      break;
    case "voided":
      nextAction = "Voided.";
      break;
    case "expired":
      nextAction = "Expired before execution. Re-issue to proceed.";
      break;
    default:
      nextAction = envelope.lastError
        ? `Send failed: ${envelope.lastError}`
        : "Send failed.";
  }
  return {
    envelope,
    recipients,
    events: listEsignEvents(envelopeId),
    nextAction,
    documentHashBound: !!envelope.documentSha256,
  };
}

/** Provenance for the wave report. */
export const _en9Provenance = {
  item: "EN-9",
  sink: "server/lib/esignatureStore.ts transitionEnvelope + recordSignature",
  reusedSlot: "server/notificationsStore.ts:57 spv.subscription_countersigned (no prior producer)",
  documentSeam: "server/dataroomStore.ts:513 listFilesForCompany -> DRFile.sha256",
  preservedMethod: "server/lib/partnerSelfServiceRoutes.ts POST /api/partner/me/agreement typed-name attestation",
} as const;
