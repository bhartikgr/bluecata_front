/**
 * WAVE 30 · ENGINE 1 — REST surface for `partner_crm_contact_client_scope`.
 *
 * The store (`partnerCrmContactClientScopeStore.ts`) is the engine; this is the
 * surface that makes it reachable. An engine with no route is not shipped.
 *
 * ENDPOINTS (all partner-workspace, all session-scoped)
 *   GET    /api/partner/me/crm-client-scope/by-company/:companyId   requirePartnerAuth
 *          Contacts scoped to this client, PLUS the DB-driven roster of this
 *          partner's contacts that are not yet scoped to it (the picker options).
 *   GET    /api/partner/me/crm-client-scope/by-contact/:contactId   requirePartnerAuth
 *          The reverse direction — which clients this person is on.
 *   GET    /api/partner/me/crm-client-scope-counts                  requirePartnerAuth
 *          { contactId: n } for badge rendering on the contacts list.
 *   POST   /api/partner/me/crm-client-scope                         write-gated
 *          { contactId, companyId } — idempotent; 200 + created:false on repeat.
 *   DELETE /api/partner/me/crm-client-scope/:id                     write-gated
 *
 * AUTHORIZATION, and what each layer actually asserts
 * ---------------------------------------------------
 *   - `requirePartnerAuth` answers "is this an authenticated member of an ACTIVE
 *     consortium partner?" and populates `req.partnerContext.partnerId` from the
 *     SESSION. The partnerId is never read from the URL or the body — that is the
 *     data-isolation guarantee, and it is why there is no `:partnerId` path param
 *     anywhere in this file.
 *   - `assertSubRole(...)` answers "may this member WRITE?". Scoping a contact onto
 *     a client is a pipeline-editing act, so it carries the same three sub-roles
 *     the rest of the partner CRM writes carry (managing_partner / associate / bd).
 *     Viewers read and cannot write — asserted in both poles by the harness.
 *   - `requireSignedAgreement` is the standard partner WRITE gate. Reads are never
 *     gated by it, so an unsigned partner is never bricked.
 *
 * CROSS-TENANT REFUSALS ARE 404, NOT 403 (Wave 29 precedent, deliberate).
 * A 403 on another firm's contact id would confirm the id exists, which makes the
 * status code an enumeration oracle over other firms' CRM records. Every
 * `ScopeNotFoundError` the store raises — wrong-partner contact, wrong-partner
 * attribution, wrong-partner scope row, and genuinely-absent id alike — arrives
 * here as an indistinguishable 404.
 *
 * No new public route: nothing is added to PUBLIC_API_PREFIXES or
 * PUBLIC_API_EXACT_PATHS.
 */
import type { Express, Request, Response } from "express";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  listScopesForCompany,
  listScopesForContact,
  listScopableContacts,
  scopeContactToClient,
  unscopeContactFromClient,
  scopeCountsByContact,
  ScopeNotFoundError,
  ScopeValidationError,
} from "./partnerCrmContactClientScopeStore";

const TAG = "[partner-crm-client-scope]";

/** Map store errors onto stable HTTP codes. Never leaks a raw message. */
function fail(res: Response, err: unknown): Response {
  if (err instanceof ScopeNotFoundError) {
    // 404, NOT 403 — see the header note. Same code for "not yours" and "absent".
    return res.status(404).json({ ok: false, error: "SCOPE_NOT_FOUND", message: err.message });
  }
  if (err instanceof ScopeValidationError) {
    return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: err.message });
  }
  log.error(`${TAG} unhandled`, sanitizeErrorMessage(err));
  return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
}

/* The three sub-roles that may edit partner CRM / pipeline state, matching
 * partnerClientCrmRoutes and partnerWorkspaceV19Store's CRM_WRITE. Declared once
 * so a future change cannot leave the two write routes disagreeing. */
const SCOPE_WRITE = [
  requirePartnerAuth,
  assertSubRole("managing_partner", "associate", "bd"),
  requireSignedAgreement,
] as const;

export function registerPartnerCrmContactClientScopeRoutes(app: Express): void {
  /* ── Read: which contacts are on this client, and who else could be ──────── */
  app.get(
    "/api/partner/me/crm-client-scope/by-company/:companyId",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      try {
        const pid = req.partnerContext!.partnerId;
        const companyId = String(req.params.companyId);
        res.json({
          ok: true,
          companyId,
          scopes: listScopesForCompany(pid, companyId),
          // The picker's options come from the DB, scoped to this partner and
          // already excluding anyone scoped. The client never filters a roster.
          availableContacts: listScopableContacts(pid, companyId),
        });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  /* ── Read: which clients is this contact on ─────────────────────────────── */
  app.get(
    "/api/partner/me/crm-client-scope/by-contact/:contactId",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      try {
        const pid = req.partnerContext!.partnerId;
        const contactId = String(req.params.contactId);
        res.json({ ok: true, contactId, scopes: listScopesForContact(pid, contactId) });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  /* ── Read: counts per contact, for list badges ──────────────────────────── */
  app.get(
    "/api/partner/me/crm-client-scope-counts",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      try {
        res.json({ ok: true, counts: scopeCountsByContact(req.partnerContext!.partnerId) });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  /* ── Write: scope a contact onto a client ───────────────────────────────── */
  app.post("/api/partner/me/crm-client-scope", ...SCOPE_WRITE, (req: Request, res: Response) => {
    try {
      const pid = req.partnerContext!.partnerId;
      const actor = req.partnerContext!.userId;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = scopeContactToClient({
        partnerId: pid,
        contactId: String(body.contactId ?? ""),
        companyId: String(body.companyId ?? ""),
        actorUserId: actor,
      });
      // 201 only when a row was actually created; a repeat is a 200 stating the
      // state already held, so a retrying client can tell the two apart without
      // either being an error.
      res.status(result.created ? 201 : 200).json({ ok: true, ...result });
    } catch (err) {
      fail(res, err);
    }
  });

  /* ── Write: remove a scope ──────────────────────────────────────────────── */
  app.delete(
    "/api/partner/me/crm-client-scope/:id",
    ...SCOPE_WRITE,
    (req: Request, res: Response) => {
      try {
        const pid = req.partnerContext!.partnerId;
        const removed = unscopeContactFromClient(pid, String(req.params.id));
        res.json({ ok: true, removed });
      } catch (err) {
        fail(res, err);
      }
    },
  );
}
