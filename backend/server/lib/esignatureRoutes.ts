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
import { rawDb } from "../db/connection";
import { requirePartnerAuth, requirePartnerSubrole } from "./requirePartnerAuth";
import { requireSignedAgreement } from "./requireSignedAgreement";
import { sanitizeErrorMessage } from "./sanitize";
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

function fail(res: Response, err: unknown): void {
  if (err instanceof EsignError) {
    const status =
      err.code === "ESIGN_ENVELOPE_NOT_FOUND" || err.code === "ESIGN_RECIPIENT_NOT_FOUND"
        ? 404
        : err.code === "ESIGN_SCHEMA_MISSING"
          ? 503
          : err.code.startsWith("ESIGN_PROVIDER")
            ? 409
            : 400;
    res.status(status).json({ error: err.code, message: err.message });
    return;
  }
  res.status(500).json({ error: "ESIGN_FAILED", message: sanitizeErrorMessage(err) });
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
  const row = db
    .prepare(`SELECT partner_id AS partnerId, name FROM spvs WHERE id = ? AND deleted_at IS NULL`)
    .get(spvId);
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
