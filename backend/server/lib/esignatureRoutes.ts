// server/lib/esignatureRoutes.ts
//
// WAVE 11 / EN-9 — HTTP surface for the e-signature engine.
//
// "AN ENGINE WITH NO ROUTE IS NOT SHIPPED." esignatureStore.ts is the engine;
// this file is its route, and SpvDetailTabs' twelfth tab is its UI.
//
// OWNERSHIP FENCE. Every partner-facing endpoint resolves the SPV's owning
// partner from `spvs.partner_id` (server/db/connection.ts:4371) and compares it
// to `req.partnerContext.partnerId`. A partner cannot address another partner's
// envelope, and a 404 (not 403) is returned on mismatch so ids cannot be
// enumerated — the same convention as
// server/dataroomStore.ts assertFounderOfCompany.
//
// THIS IS NOT A CLASSIFICATION SURFACE. Nothing here reads sector/sub-sector or
// touches permissions or navigation; the PT-5 fence is untouched.
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { mintRefusalIncidentCode } from "./refusalIncidentCode";
import { rawDb } from "../db/connection";
import { requirePartnerAuth, requirePartnerSubrole } from "./requirePartnerAuth";
import { requireSignedAgreement } from "./requireSignedAgreement";
import { sanitizeErrorMessage } from "./sanitize";
import { log } from "./logger";
import { appendAdminAudit } from "../adminPlatformStore";
import { emitNotification } from "../notificationsStore";
import {
  createEnvelope,
  sendEnvelope,
  recordSignature,
  declineSignature,
  voidEnvelope,
  envelopeDetail,
  listEnvelopesForSubject,
  listEsignProviders,
  readEsignProviderConfig,
  esignSchemaInstalled,
  EsignError,
  ESIGN_PROVIDER_CONFIG_KEY,
  type EnvelopeRow,
} from "./esignatureStore";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/* ══════════════════════════════════════════════════════════════════════════════
   WAVE 148 · THE INCIDENT CODE — WHY IT EXISTS AND WHY IT IS OPAQUE.
   ══════════════════════════════════════════════════════════════════════════════
   The panel tells a paying partner to "send support the reference below". Until
   this wave there was no reference to send: the generic arm logged the FIXED
   string `ESIGN_LIST_READ`, which is the same on every occurrence and therefore
   cannot join one ticket to one log line, and the typed arm logged NOTHING at all.
   A support operator holding a screenshot could not find the failure.

   `ESG-XXXXXXXX` is minted PER OCCURRENCE from crypto randomness, so it identifies
   ONE throw at ONE moment. It is deliberately OPAQUE: it names no table, no
   column, no internal code and no deployment, so rendering it to a user cannot
   breach R77 or the owner's Q25 objection to exposing our internal process — a
   random token carries no internal language. The internal code (ESIGN_LIST_UNAVAILABLE,
   ESIGN_SCHEMA_COLUMN_DRIFT, …) stays where R77 permits it: `error.code`, the JSON
   payload and the `data-*` attribute. The join is made in the LOG, which carries
   both the opaque code and the internal one, on BOTH arms.
   ════════════════════════════════════════════════════════════════════════════ */
/* WAVE 170 — THE FORMAT MOVED, THE OUTPUT DID NOT. `mintRefusalIncidentCode`
   (`server/lib/refusalIncidentCode.ts`) is the same expression this function
   held: `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}` with prefix
   "ESG". Wave 170 needed the identical token on the SPV refusal path, and two
   copies of a format is two places to change it, so this delegates rather than
   duplicates. Every caller, response body and shipped assertion sees the same
   `ESG-XXXXXXXX` it saw before. */
function mintEsignIncidentCode(): string {
  return mintRefusalIncidentCode("ESG");
}

/** Read paths whose failure means "this database cannot answer right now", not
 *  "the caller asked for something invalid". Every one of them is a 503 with a
 *  Retry-able meaning; answering 400 would blame the partner for our schema, and
 *  answering 500 (the pre-wave behaviour) tells them nothing at all.
 *
 *  ESIGN_SCHEMA_MISSING was the only code mapped to 503 before this wave, which
 *  meant every guard wave 148 added would have degraded a 500 into a 400 — a
 *  different wrong answer. */
const ESIGN_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "ESIGN_SCHEMA_MISSING",
  "ESIGN_SCHEMA_COLUMN_DRIFT",
  "ESIGN_LIST_UNAVAILABLE",
  "ESIGN_CONFIG_READ_UNAVAILABLE",
  "ESIGN_OWNER_LOOKUP_UNAVAILABLE",
]);

function fail(res: Response, err: unknown): void {
  const incidentCode = mintEsignIncidentCode();
  if (err instanceof EsignError) {
    const status =
      err.code === "ESIGN_ENVELOPE_NOT_FOUND" || err.code === "ESIGN_RECIPIENT_NOT_FOUND"
        ? 404
        : ESIGN_UNAVAILABLE_CODES.has(err.code)
          ? 503
          : err.code.startsWith("ESIGN_PROVIDER")
            ? 409
            : 400;
    /* WAVE 148 — the typed arm logged NOTHING. It is the arm an operator most
       needs, because every guard this wave added arrives here: the code, the
       status, the opaque incident code the client is shown, and the stack are all
       retained together so a support ticket quoting ESG-XXXXXXXX resolves to this
       one line. */
    log.error(
      `[esignature] ${err.code} (incident ${incidentCode}, http ${status}) — ` +
        `${err.message}\n${err.stack ?? "(no stack)"}`,
    );
    res.status(status).json({ error: err.code, message: err.message, incidentCode });
    return;
  }
  /* ══════════════════════════════════════════════════════════════════════════
     WAVE 127 · FINDING 1 — THE MISSING HALF OF THE SCRUBBER'S CONTRACT.
     ══════════════════════════════════════════════════════════════════════════
     `sanitizeErrorMessage` replaces the real error with a generic sentence when
     NODE_ENV=production, and server/lib/sanitize.ts's own doc contract says it
     must ALWAYS be paired with a server-side log.error(...) that keeps the full
     error for operators. That pairing was missing here, and the cost was
     concrete: the live E-signature tab rendered
     "An unexpected error occurred. Please try again." — the scrubber's default
     fallback, the only occurrence of that sentence in this codebase — and
     NOTHING on the server retained the throw. The fault was unknowable to us as
     well as to the client, which is exactly the outcome the scrubber is not
     supposed to produce.

     THIS IS NOT A SWALLOW. The status is still 500 and the client-facing body is
     byte-identical. Only the operator side gains the stack it was always owed.
     ESIGN_LIST_READ is the reference the panel tells the partner to quote, so a
     support ticket and this log line can be joined.

     The prime remaining suspect is named deliberately: spvOwner()'s SECOND
     query — the best-effort read of the legacy `spvs` mirror — is unguarded, so
     any error there arrives here as this generic 500. */
  log.error(
    `[esignature] ESIGN_FAILED (ref ESIGN_LIST_READ, incident ${incidentCode}) — the client received a scrubbed 500; ` +
    "the full error is retained here for operators: " +
    (err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? "(no stack)"}` : String(err)),
  );
  res.status(500).json({ error: "ESIGN_FAILED", message: sanitizeErrorMessage(err), incidentCode });
}

/** The owning partner of an SPV, or null if the SPV does not exist.
 *
 * WAVE 44 · DEFECT 2 — WHY THIS READS TWO TABLES.
 * ------------------------------------------------
 * The vehicle behind SpvDetailTabs is the CANONICAL ENGINE row in table `spv`
 * (`server/db/connection.ts:5166`, owner column `sponsor_partner_id`). The
 * legacy partner-workspace table `spvs` (connection.ts:4368, owner column
 * `partner_id`) is a SECOND, best-effort mirror: `spvEngineStore.createSpv`
 * shadow-persists into it keyed on the engine id, and that write is explicitly
 * non-fatal (spvEngineStore.ts:448 logs a warning and continues).
 *
 * Two whole classes of vehicle therefore have NO `spvs` row addressable by the
 * id the UI holds:
 *   1. Boot-migrated SPVs. `migrateLegacySpvsIntoEngine` mints the engine id as
 *      `spv_mig_<sha256(legacyId)>` (spvEngineStore.ts:2569) and keeps the
 *      legacy id only in `migrated_from` — so `spvs` has a row, under a
 *      DIFFERENT id.
 *   2. Boot-migrated FUNDS, which come from `partner_funds` and never had a
 *      `spvs` row at all (spvEngineStore.ts:2604).
 * Every one of the other 15 tabs calls `/api/partner/me/spv/...`, which resolves
 * through `spvEngineStore.getSpv` (the `spv` table), so they render. This one
 * route resolved through the mirror alone and returned `404 not_found`, which
 * the client maps to "We couldn't find what you were looking for."
 * (client/src/lib/queryClient.ts:36) — an EXISTING vehicle reported as missing.
 *
 * The fence is unchanged and is still applied per seam: the engine row must be
 * sponsored by the caller's partner, the legacy row must be owned by it, and a
 * mismatch or a genuinely unknown id is still 404 (never 403, no id
 * enumeration). This widens WHAT CAN BE FOUND, never WHO MAY SEE IT.
 */
function spvOwner(spvId: string): { partnerId: string; name: string } | null {
  const db: any = rawDb();
  // (1) Canonical engine row — the id the SPV detail tabs actually hold.
  try {
    const engine = db
      .prepare(
        `SELECT sponsor_partner_id AS partnerId, name FROM spv WHERE id = ? AND archived_at IS NULL`,
      )
      .get(spvId);
    if (engine && engine.partnerId) {
      return { partnerId: String(engine.partnerId), name: String(engine.name ?? spvId) };
    }
  } catch {
    // The engine table is absent on this database — fall through to the mirror
    // rather than 500. No swallowed ownership decision: a null result below is
    // still a hard 404.
  }
  // (2) Legacy partner-workspace mirror, for ids that only exist there.
  /* WAVE 148 · UNGUARDED READ #1 — THE PRIME SUSPECT WAVE 127 NAMED AND DID NOT
     FIX. The engine read above falls through on ANY error by design, so on a
     database where `spvs` is absent or column-drifted this second query is the one
     that throws, and it threw straight past the handler's catch into fail()'s
     generic arm: HTTP 500, body "An unexpected error occurred", no code, nothing
     an operator could act on. It gets its OWN code, distinct from every envelope
     read, because "we cannot determine who owns this vehicle" is a different fact
     from "we cannot read the envelope list".

     IT MUST NOT BECOME A 404. `if (!row) return null` makes the handler answer
     404 not_found, which is the correct, non-enumerating answer for an id that
     genuinely is not there. Letting an unreadable table reach that line would
     report an EXISTING vehicle as missing — the precise wave-44 defect this file
     already fixed once. An unreadable ownership record is refused (503), never
     answered as absence. The ownership fence is unchanged: nothing is granted. */
  let row: any;
  try {
    row = db
      .prepare(`SELECT partner_id AS partnerId, name FROM spvs WHERE id = ? AND deleted_at IS NULL`)
      .get(spvId);
  } catch (err) {
    throw new EsignError(
      "ESIGN_OWNER_LOOKUP_UNAVAILABLE",
      "The record of which partner owns this vehicle could not be read, so this request is refused rather than answered from a guess. Nothing about the vehicle, its envelopes or its signatures has changed. " +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  if (!row) return null;
  return { partnerId: String(row.partnerId), name: String(row.name ?? spvId) };
}

/**
 * Assert the caller's partner owns the SPV behind an envelope's subject.
 * Envelopes whose subject is the PARTNER itself are owned by that partner.
 */
function assertEnvelopeOwned(req: Request, res: Response, env: EnvelopeRow): boolean {
  const pid = req.partnerContext!.partnerId;
  if (env.subjectKind === "partner") {
    if (env.subjectId === pid) return true;
    res.status(404).json({ error: "not_found" });
    return false;
  }
  if (env.subjectKind === "spv") {
    const owner = spvOwner(env.subjectId);
    if (owner && owner.partnerId === pid) return true;
    res.status(404).json({ error: "not_found" });
    return false;
  }
  res.status(404).json({ error: "not_found" });
  return false;
}

export function registerEsignatureRoutes(app: Express): void {
  /* ==========================================================
   * GET /api/partner/me/esignature/config — which provider will execute, and
   * whether it CAN. Surfaced so the owner sees "internal attestation" rather
   * than assuming a vendor is in the loop. Read-only; any partner role.
   * ========================================================== */
  app.get(
    "/api/partner/me/esignature/config",
    requirePartnerAuth,
    (_req: Request, res: Response) => {
      try {
        const cfg = readEsignProviderConfig();
        res.json({
          configKey: ESIGN_PROVIDER_CONFIG_KEY,
          provider: cfg.configuredName,
          configMissing: cfg.configMissing,
          schemaInstalled: esignSchemaInstalled(),
          providers: listEsignProviders(),
        });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  /* ==========================================================
   * GET /api/partner/me/spvs/:spvId/esignature — every envelope on an SPV, with
   * recipients, audit trail and next action. Ownership-fenced.
   * ========================================================== */
  app.get(
    "/api/partner/me/spvs/:spvId/esignature",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const spvId = String(req.params.spvId ?? "");
      try {
        const owner = spvOwner(spvId);
        if (!owner || owner.partnerId !== pid) {
          return res.status(404).json({ error: "not_found" });
        }
        if (!esignSchemaInstalled()) {
          return res.json({
            spvId,
            schemaInstalled: false,
            envelopes: [],
            message:
              "The e-signature tables are not installed on this database yet (migration 0168).",
          });
        }
        const envelopes = listEnvelopesForSubject("spv", spvId).map((e) => envelopeDetail(e.id));
        const cfg = readEsignProviderConfig();
        res.json({
          spvId,
          schemaInstalled: true,
          provider: cfg.configuredName,
          providerConfigMissing: cfg.configMissing,
          envelopes,
        });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  /* ==========================================================
   * POST /api/partner/me/spvs/:spvId/esignature — create a DRAFT envelope for an
   * LPA / subscription document and (unless draftOnly) send it.
   * Body: { documentKind, documentRef, documentTitle, documentSha256?,
   *         expiresAt?, draftOnly?, recipients: [...] }
   * ========================================================== */
  app.post(
    "/api/partner/me/spvs/:spvId/esignature",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const spvId = String(req.params.spvId ?? "");
      const body = (req.body ?? {}) as Record<string, unknown>;
      try {
        const owner = spvOwner(spvId);
        if (!owner || owner.partnerId !== pid) {
          return res.status(404).json({ error: "not_found" });
        }
        if (!isNonEmptyString(body.documentKind)) {
          return res.status(400).json({ error: "DOCUMENT_KIND_REQUIRED" });
        }
        if (!isNonEmptyString(body.documentRef)) {
          return res.status(400).json({ error: "DOCUMENT_REF_REQUIRED" });
        }
        if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
          return res.status(400).json({ error: "RECIPIENTS_REQUIRED" });
        }
        const recipients = (body.recipients as Array<Record<string, unknown>>).map((r) => ({
          role: (isNonEmptyString(r.role) ? r.role : "signer") as "signer" | "countersigner" | "cc",
          signingOrder: typeof r.signingOrder === "number" ? r.signingOrder : undefined,
          partyKind: isNonEmptyString(r.partyKind) ? r.partyKind : "lp",
          partyId: isNonEmptyString(r.partyId) ? r.partyId : null,
          fullName: String(r.fullName ?? ""),
          email: String(r.email ?? ""),
        }));

        let envelope = createEnvelope({
          subjectKind: "spv",
          subjectId: spvId,
          documentKind: String(body.documentKind),
          documentRef: String(body.documentRef),
          documentTitle: isNonEmptyString(body.documentTitle)
            ? String(body.documentTitle)
            : String(body.documentRef),
          documentSha256: isNonEmptyString(body.documentSha256) ? String(body.documentSha256) : null,
          createdBy: `partner:${pid}`,
          expiresAt: isNonEmptyString(body.expiresAt) ? String(body.expiresAt) : null,
          recipients,
        });

        if (body.draftOnly !== true) {
          envelope = sendEnvelope(envelope.id, `partner:${pid}`);
        }
        appendAdminAudit(`partner:${pid}`, `esign:${envelope.id}`, "esignature.envelope_created", {
          spvId,
          documentKind: envelope.documentKind,
          documentRef: envelope.documentRef,
          provider: envelope.provider,
          status: envelope.status,
        });
        res.status(201).json(envelopeDetail(envelope.id));
      } catch (err) {
        fail(res, err);
      }
    },
  );

  /* ==========================================================
   * POST /api/partner/me/esignature/:envelopeId/send — send a draft.
   * ========================================================== */
  app.post(
    "/api/partner/me/esignature/:envelopeId/send",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const id = String(req.params.envelopeId ?? "");
      try {
        const detail = envelopeDetail(id);
        if (!detail) return res.status(404).json({ error: "not_found" });
        if (!assertEnvelopeOwned(req, res, detail.envelope)) return;
        const envelope = sendEnvelope(id, `partner:${pid}`);
        res.json(envelopeDetail(envelope.id));
      } catch (err) {
        fail(res, err);
      }
    },
  );

  /* ==========================================================
   * POST /api/partner/me/esignature/:envelopeId/sign — record a signature or a
   * COUNTERSIGNATURE. Signing order is enforced in the store.
   * Body: { recipientId, signedName }
   *
   * This is the FIRST PRODUCER of the `spv.subscription_countersigned`
   * notification kind (server/notificationsStore.ts:57), which had existed as a
   * slot with nothing emitting it.
   * ========================================================== */
  app.post(
    "/api/partner/me/esignature/:envelopeId/sign",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const id = String(req.params.envelopeId ?? "");
      const body = (req.body ?? {}) as Record<string, unknown>;
      try {
        const before = envelopeDetail(id);
        if (!before) return res.status(404).json({ error: "not_found" });
        if (!assertEnvelopeOwned(req, res, before.envelope)) return;
        if (!isNonEmptyString(body.recipientId)) {
          return res.status(400).json({ error: "RECIPIENT_ID_REQUIRED" });
        }
        if (!isNonEmptyString(body.signedName)) {
          return res.status(400).json({ error: "SIGNATURE_NAME_REQUIRED" });
        }
        const out = recordSignature({
          envelopeId: id,
          recipientId: String(body.recipientId),
          signedName: String(body.signedName),
          ipAddress: req.ip ?? null,
          userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
          actor: `partner:${pid}`,
        });
        appendAdminAudit(`partner:${pid}`, `esign:${id}`, "esignature.signed", {
          recipientId: out.recipient.id,
          role: out.recipient.role,
          signingOrder: out.recipient.signingOrder,
          signatureHash: out.recipient.signatureHash,
          completed: out.completed,
        });
        /* The reserved notification slot finally gets a producer. Best-effort:
           a notification failure must not unwind a recorded signature. */
        if (out.recipient.role === "countersigner" || out.completed) {
          try {
            emitNotification({
              userId: `partner:${pid}`,
              kind: "spv.subscription_countersigned",
              title: out.completed ? "Document fully executed" : "Document countersigned",
              body: `${out.envelope.documentTitle} — ${out.recipient.fullName} signed as ${out.recipient.role}.`,
              link: `/collective/partner/spvs/${out.envelope.subjectId}`,
            });
          } catch {
            /* noop — see above */
          }
        }
        res.json(envelopeDetail(id));
      } catch (err) {
        fail(res, err);
      }
    },
  );

  /* ==========================================================
   * POST /api/partner/me/esignature/:envelopeId/decline
   * POST /api/partner/me/esignature/:envelopeId/void
   * ========================================================== */
  app.post(
    "/api/partner/me/esignature/:envelopeId/decline",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const id = String(req.params.envelopeId ?? "");
      const body = (req.body ?? {}) as Record<string, unknown>;
      try {
        const detail = envelopeDetail(id);
        if (!detail) return res.status(404).json({ error: "not_found" });
        if (!assertEnvelopeOwned(req, res, detail.envelope)) return;
        if (!isNonEmptyString(body.recipientId)) {
          return res.status(400).json({ error: "RECIPIENT_ID_REQUIRED" });
        }
        declineSignature({
          envelopeId: id,
          recipientId: String(body.recipientId),
          reason: isNonEmptyString(body.reason) ? String(body.reason) : "declined",
          actor: `partner:${pid}`,
        });
        res.json(envelopeDetail(id));
      } catch (err) {
        fail(res, err);
      }
    },
  );

  app.post(
    "/api/partner/me/esignature/:envelopeId/void",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const id = String(req.params.envelopeId ?? "");
      const body = (req.body ?? {}) as Record<string, unknown>;
      try {
        const detail = envelopeDetail(id);
        if (!detail) return res.status(404).json({ error: "not_found" });
        if (!assertEnvelopeOwned(req, res, detail.envelope)) return;
        voidEnvelope(id, isNonEmptyString(body.reason) ? String(body.reason) : "voided", `partner:${pid}`);
        res.json(envelopeDetail(id));
      } catch (err) {
        fail(res, err);
      }
    },
  );
}
