/**
 * Foundation Build — Partner CRM + SPV/Fund Record-Keeping REST surface.
 *
 * Two route families:
 *   - /api/admin/partners/*  — admin-only management (requireAdmin)
 *   - /api/partner/me/*       — partner workspace (requirePartnerAuth)
 *
 * Every mutation:
 *   - validates partnerId comes from SESSION (never URL)
 *   - enforces sub-role + tier gates at the route layer
 *   - calls store helpers that hash-chain + emit bridge events + audit
 *
 * Magic-link redemption: POST /api/auth/redeem-partner-invite/:token (mounted
 * at /api/auth/* so unauthenticated visitors can hit it; the redeeming user
 * must still be signed in — the flow is "sign up first, then redeem").
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
import { createHash, randomBytes } from "node:crypto"; /* v25.14 NC1 — secure team-invite redeem password */
import { requireAdmin, requireAuth } from "./lib/authMiddleware";
import { requirePartnerAuth, requirePartnerSelf, assertSubRole, assertTier, assertTierSeats, assertSeatCapacity } from "./lib/requirePartnerAuth";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
/* WAVE 194 · ITEM B · R165.4 — the two PATCHes below answered 200 for a write they
   dropped. Wave 193 named both from `spvVehiclePatchApplicability.ts`'s header and
   left them; this closes them with an accept-list mirroring each route's OWN key
   ladder, because reusing wave 193's nine-key store list would have accepted three
   keys neither route maps. See `server/lib/legacyVehiclePatchApplicability.ts`. */
import {
  assertLegacyVehiclePatchFullyApplied,
  isSpvPatchUnappliedError,
  LEGACY_SPV_PATCH_APPLIED_KEYS,
  LEGACY_FUND_PATCH_APPLIED_KEYS,
} from "./lib/legacyVehiclePatchApplicability";
/* WAVE 154 · ITEM K — the SPV eligibility gate: every company an SPV invests
   into must hold a current paid Capavate membership before the vehicle may be
   created/launched or take money in (R116.3). */
import { resolvePartnerEffectivePlan, EffectivePlanError } from "./lib/partnerEffectivePlan"; /* GROUP C (C5) — /api/partner/me surfaces the dynamic effective plan (price incl override, commission, report-only quota, rev-share) that drives the partner FE. */
import { getUserContext } from "./lib/userContext";
import { appendAdminAudit, reportAuditWriteOutcome } from "./adminPlatformStore"; /* WAVE 213 — wave 186's writer + its outcome guard; no second audit path is created. */
import {
  PUBLISH_ACK_FIELD,
  PUBLISH_ACK_MISSING_MESSAGE,
  PUBLISH_ACK_STALE_MESSAGE,
  PUBLISH_CLAUSE_ID,
  PUBLISH_CLAUSE_VERSION,
  publishAcknowledgementText,
} from "../shared/wave213PublishGoverningClause"; /* WAVE 213 · R188.4 item 3 — ONE definition of the sentence, read by the screen and re-derived here. */
import { emitBridgeEvent } from "./bridgeStore";
import { TIER_RANK, type PartnerTier, type PartnerType, type PartnerSubRole, getById } from "./adminContactsStoreShim";
import {
  partnerTeamStore,
  partnerTeamContactStore,
  partnerInvitationStore,
  partnerAttributionStore,
  ATTRIBUTION_SOURCES,
  isAttributionSource,
  partnerPipelineStore,
  partnerPipelineActivityStore,
  partnerNotesStore,
  partnerTasksStore,
  partnerFilesStore,
  partnerWorkspaceSettingsStore,
  partnerSpvStore,
  partnerFundsStore,
  partnerDashboardSnapshot,
  partnerDealPromotionsStore,
  PromotionConflictError,
  ALL_PIPELINE_STAGES,
  hashInviteToken,
  type PartnerTeamInvitation,
} from "./partnerWorkspaceStore";
import { getAllContacts, listContacts, updateContact, createContact, upsertConsortiumPartner } from "./adminContactsStore";
import { registerPersona, getUserContextForId } from "./lib/userContext";
import { resolveDisplayNames } from "./lib/displayNameResolver"; /* W2-G — shared userId->name resolver */
import { isPartnerTitle } from "../shared/partnerTitles"; /* 2a — display title enum (distinct from permission tier) */
/* WAVE 306 · WAVE 1 — the denomination refusal sentences, so this legacy create
   route can attach words to a code instead of shipping the code naked (R77). */
import { spvCurrencyRefusalCopy } from "../shared/currencyDomain";
import { recordSignoff, linkSignoffToSpv } from "./spvLaunchSignoffStore"; /* 1c — durable launch sign-off (also gates the legacy /spvs create path) */
/* WAVE 22 · ITEM 2 (REVIEW B F-3) — legacy SPV-create sign-off `ip` was the raw
 * forwarded header. One shared hardened resolver, not a second local copy. */
import { resolveRateLimitClientIp } from "./lib/rateLimit";
import { hashPassword } from "./lib/auth"; /* v25.49.3 R1 — partner-role auth_users seed hash */
import { storeCredential, lookupByUserId } from "./userCredentialsStore"; /* v25.49.3 R1 — durable bcrypt credential + hydration probe */
import { rawDb } from "./db/connection";
/* WAVE 185 · ITEM B — the SAME resolver and the SAME diagnostic the messaging
   read path uses, so the admin verification cannot report success about a path it
   did not actually exercise. */
import {
  resolvePartnerIdForUser,
  partnerIdResolvesToAPartner,
  diagnosePartnerAudienceEmptiness,
} from "./lib/partnerDelegatedContext";
import { log } from "./lib/logger"; /* w-partner F7 — non-fatal mirror warnings */
/* WAVE 214 · surface 3 — authority confirmation on the partner team invitation. */
import {
  evaluateTickAuthority,
  recordAuthorityConfirmation,
} from "./lib/wave214ThirdPartyAuthorityStore";
import {
  WAVE214_AUTHORITY_SURFACES,
  WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT,
} from "../shared/wave214ThirdPartyAuthorityCopy";
/* WAVE 56 (R21/R36) — the tier domain and the access ladder are DATA. */
import { partnerTierDomainSlugs } from "./lib/partnerTierResolver";
import { compareTierRank } from "./lib/partnerTierDomain";
/* WAVE 56b — distinguish Wave 56's named unresolved-commission-rate refusal
   from a transient failure, so /api/partner/me never 500s over it. */
import { isUnknownCommissionTierError } from "./lib/partnerCommissionRateResolver";
/* w-partner F-new3 — the SAME resolver the seat gate enforces with
   (requirePartnerAuth.ts:207), so the banner can never disagree with the 403. */
import { resolvePartnerSeatLimit } from "./lib/partnerFeeResolver";
/* WAVE 45 (R3) — human rendering of a three-state capability, so a null cap is
 * never displayed as 0. */
import { describeCapability } from "./lib/partnerTierCapabilityStore";
import { setSessionCookie } from "./lib/sessionCookie";
import { getCompanyRecordById } from "./multiCompanyStore";
import { getCompanyProfile } from "./companyProfileStore"; /* v25.15 NM5 — real snapshot data */
import { listFollowedCompanyIdsForMember } from "./collectiveInterestStore"; /* v25.50.0 Phase 2 — Following from Collective */
import {
  getPortfolioCompany,
  listPortfolioCompanies,
  upsertPortfolioProfile,
  parsePortfolioPatchDetailed,
  archivePortfolioCompany,
} from "./partnerPortfolioStore"; /* v25.50.0 Phase 3 — Private Portfolio company profiles */
import { PORTFOLIO_PROFILE_WRITE_ROLES } from "../shared/partnerRoles"; /* w-partner F-new2 — shared server/client write-role constant */
import { linkConsortiumPartner, unlinkConsortiumPartner, getConsortiumPartnerId } from "./consortiumLinkStore";
import { upsertInvestorContactFromPartner, removeInvestorContactForPartner } from "./founderCrmStore";
import { spvEngineStore, isSpvClosedToNewCapitalError, isSpvMixedCurrencyTotalError } from "./spvEngineStore"; /* Ozan #4 — legacy SPV routes shim THROUGH the canonical engine so no SPV is ever created outside it */
/* ═════════════════════════════════════════════════════════════════════════════
 * WAVE 182 · ITEM A · R152 — THE TWO SPV WRITE ROUTES IN THIS FILE ANSWER A CODE.
 * ═════════════════════════════════════════════════════════════════════════════
 * `POST /api/partner/me/spvs/:id/positions` and
 * `POST /api/partner/me/funds/:id/commitments` both catch every store error as
 * `res.status(400).json({ error: (e as Error).message })` — a bare machine code and
 * no words. That was survivable while the codes were internal, but wave 182's
 * closed-vehicle gate lives in the shared sink both routes call, so without this
 * the refusal a general partner reads on those two surfaces would be the literal
 * string `SPV_CLOSED_TO_NEW_LPS`. R152 item 3 forbids exactly that.
 *
 * ADDITIVE AND NARROWLY SCOPED: the `error` key and the pre-existing status keep
 * their exact values for every OTHER code, so no shipped assertion changes; only
 * the closed-vehicle refusal gains `message`/`guidance` and the 409 that says the
 * request was fine and the vehicle's state was not.
 * ═══════════════════════════════════════════════════════════════════════════ */
function respondSpvWriteRefusal(res: Response, e: unknown): Response {
  if (isSpvClosedToNewCapitalError(e)) {
    return res.status(409).json({
      error: e.message,
      message: e.refusalHeadline,
      guidance: e.refusalGuidance,
      closedToNewLps: { reason: e.closedReason },
    });
  }
  /* WAVE 189 · ITEM C · R159.6 — THE UNATTESTED-DRAFT REFUSAL, HERE TOO.

     WHY THIS FILE NEEDS ITS OWN BRANCH. There are TWO refusal responders in the
     tree: `err()` in `spvEngineRoutes.ts` and this one. `POST
     /api/partner/me/spvs/:id/positions` — a second, legacy-named door onto the very
     same `spvEngineStore.subscribe` sink — answers through THIS function. Without
     this branch the store's refusal would still hold (no capital attaches) but the
     general partner would be shown a bare 400 carrying the ALL-CAPS code, which is
     precisely what R159.6 item 4 forbids. The store gate is the enforcement; this is
     the difference between enforcing and explaining, and the owner asked for both.

     Byte-identical body shape to the `err()` branch, deliberately: 409, machine code
     in `error`, short sentence in `message`, unabridged in `guidance`, and the
     structured `attestation` field. One refusal cannot be reported two ways. */
  if (isSpvUnattestedDraftError(e)) {
    return res.status(409).json({
      error: e.message,
      message: e.refusalHeadline,
      guidance: e.refusalGuidance,
      attestation: { required: true, attaching: e.attachKind },
    });
  }
  /* WAVE 192 · ITEM B1 · R164.3 — AND THE CASE WHERE THE PLATFORM CANNOT TELL.
     `spvIsAttested` used to return ATTESTED whenever `spv_launch_signoffs` could
     not be read, so an unreadable table let capital attach to an unattested draft
     while reporting success. It now refuses. Reported separately from the branch
     above because the remedies differ — signing versus restoring a table — and
     `attestation.unreadable` lets a caller tell them apart without parsing prose.
     Same body shape as the two branches it sits beside; one refusal cannot be
     reported three ways. */
  if (isSpvAttestationUnreadableError(e)) {
    return res.status(409).json({
      error: e.message,
      message: e.refusalHeadline,
      guidance: e.refusalGuidance,
      attestation: { required: true, attaching: e.attachKind, unreadable: true },
    });
  }
  /* WAVE 277 · R224.1 · R77 — THE MIXED-CURRENCY REFUSAL, HERE TOO, AND A PREFIX.

     A FOURTH typed branch, for the reason the owner accepted the third: there are
     TWO refusal responders in this tree, and one refusal cannot be reported two
     ways. `assertSingleCurrencyTotal` throws from FIVE read paths in the engine
     store, and the read routes in THIS file that call them answered a bare HTTP 500
     with no body — so one accepted foreign-currency subscription made a vehicle's
     pages look destroyed instead of saying what had happened. Body shape is
     identical to `err()`'s branch in `spvEngineRoutes.ts`: 409, machine code in
     `error`, the short sentence in `message`, the unabridged one in `guidance`, and
     the structured `mixedCurrency` field so a caller can name the two conflicting
     currencies without parsing prose. 409, not 400: the request is well-formed and
     the vehicle's own recorded state is what cannot be stated as one number.

     THE PREFIX FALL-THROUGH BELOW is the second half. The store's newer refusals
     carry their diagnosis in the message (`CODE:detail:detail`) — wave 277's own
     `SUBSCRIPTION_CURRENCY_MISMATCH:<stated>:<vehicle>` among them — and the last
     line of this function answered them as a BARE CODE with no sentence, which is
     exactly the R77 violation `err()` fixed on its own side in wave 161.
     `POST /api/partner/me/spvs/:id/positions`, a second door onto the very same
     `spvEngineStore.subscribe` sink, answers through here. The status and the `error`
     string are UNCHANGED for every code, and a code with no registry sentence still
     falls to the line below untouched, so no shipped assertion moves. */
  if (isSpvMixedCurrencyTotalError(e)) {
    return res.status(409).json({
      error: e.message,
      message: e.refusalHeadline,
      guidance: e.refusalGuidance,
      mixedCurrency: { total: e.totalName, statedCurrencies: e.statedCurrencies },
    });
  }
  {
    const msg = String((e as Error)?.message ?? "");
    const head = msg.split(":")[0] ?? "";
    const headline = head !== msg ? spvSubscriptionRefusalHeadline(head) : null;
    if (headline) {
      return res.status(400).json({
        error: msg,
        message: headline,
        guidance: spvSubscriptionRefusalCopy(head) ?? undefined,
      });
    }
  }
  return res.status(400).json({ error: (e as Error).message });
}
/* WAVE 189 · ITEM C · R159.6 — imported from the same module the store sinks and
   `spvEngineRoutes.ts` use, so all three agree on what the refusal is. */
/* WAVE 192 · ITEM B1 · R164.3 — `isSpvAttestationUnreadableError` added to the
   import this file ALREADY had. */
import {
  isSpvUnattestedDraftError,
  isSpvAttestationUnreadableError,
} from "./lib/spvAttestationGate";
/* WAVE 277 — the ONE copy authority for subscription refusals, already read by
   `err()` in spvEngineRoutes.ts. Imported here so the second responder cannot
   drift from the first. */
import {
  spvSubscriptionRefusalHeadline,
  spvSubscriptionRefusalCopy,
} from "@shared/spvSubscriptionRefusalCopy";
import {
  partnerHasCompanyRelationship,
  partnerMayAttributeSpvToCompany,
  SPV_TARGET_COMPANY_NOT_YOURS,
  SPV_TARGET_COMPANY_NOT_YOURS_MESSAGE,
} from "./lib/partnerCompanyLinkGate"; /* WAVE 179 · ITEM A · R151.1 — one partner↔company predicate, shared with spvEngineRoutes */
import { setSpvLegalForm } from "./spvLegalFormStore"; /* WAVE 179 · ITEM B · R151.3 — OPTIONAL legal-form annotation on the legacy create path */
import { resolveSpvJurisdiction } from "../shared/spvEngine"; /* WAVE 4A follow-up 2 */
/* WAVE 230D — per-record test-data exclusion for display surfaces (R228, R230.6). */
import { wave230CompanyVisible, wave230HiddenCompanyIds } from "./lib/wave230DisplayExclusion";
/* NUMBERS BAND · WAVE E (W328) — the same LP name chain the LP Roster builder
   runs, so the Fund Register and the roster cannot name one row two ways. */
import { investorDisplayNameMap } from "./lib/investorDisplayName";
/* WAVE 198 · ITEM D — the four partner PATCH routes stop reporting success for a
   write their store would discard. See the module header for why three of the four
   refuse only provably-forced keys rather than an interface-derived accept-list. */
import {
  PARTNER_PATCH_UNAPPLIED_CODE,
  isPartnerPatchUnappliedError,
  assertAdminPartnerPatchFullyApplied,
  assertPartnerPipelinePatchFullyApplied,
  assertPartnerNotePatchFullyApplied,
  assertPartnerWorkspaceSettingsPatchFullyApplied,
} from "./lib/partnerPatchApplicability";

/* ============================================================
 * Helpers
 * ============================================================ */

function badRequest(res: Response, msg: string, details?: unknown): void {
  res.status(400).json({ error: "BAD_REQUEST", message: msg, details });
}
function isString(v: unknown): v is string { return typeof v === "string" && v.length > 0; }

/* v25.49.3 R1 — resolve/create a CONSORTIUM_PARTNER runtime identity for an
 * approved-partner magic-link redemption WITHOUT going through
 * registerPersona() (which lives in the SACRED userContext.ts and hard-codes
 * an INVESTOR persona + durable auth_users.role='investor'). The approved
 * partner's `users` row is provisioned at approval with role='consortium_partner'
 * (consortiumApplyStore); we reuse that identity. If none exists (or only an
 * auth_users row exists) we reuse/create it, but NEVER stamp an investor role.
 * The durable auth_users + users rows both carry role='consortium_partner' so
 * getDbUserRole / secureAuthRoutes redeem classify the session as a partner,
 * not an investor — fixing 2a (password-reset routing) end-to-end. Fail-closed:
 * an existing 'admin' identity is never downgraded. */
function resolveOrCreateConsortiumPartnerId(email: string, seedPassword: string): string {
  const db = rawDb();
  const normEmail = email.trim().toLowerCase();

  // 1. Prefer the approval-created users row already stamped consortium_partner.
  const partnerRow = db
    .prepare(`SELECT id FROM users WHERE lower(email) = ? AND role = 'consortium_partner' ORDER BY rowid LIMIT 1`)
    .get(normEmail) as { id: string } | undefined;
  let userId = partnerRow?.id;

  // 2. Else reuse any existing auth identity for this (invited, email-gated) address.
  if (!userId) {
    const authRow = db
      .prepare(`SELECT id FROM auth_users WHERE lower(email) = ? ORDER BY rowid LIMIT 1`)
      .get(normEmail) as { id: string } | undefined;
    userId = authRow?.id;
  }

  if (!userId) userId = `u_partner_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  // Durable auth_users row — role MUST be consortium_partner, never investor.
  // On conflict, preserve an existing password_hash (partner may have set one)
  // and never demote an admin.
  try {
    db.prepare(
      `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, created_at)
       VALUES (?, ?, ?, 'scrypt', 'consortium_partner', 'active', ?)
       ON CONFLICT(id) DO UPDATE SET role = CASE WHEN auth_users.role = 'admin' THEN 'admin' ELSE 'consortium_partner' END`,
    ).run(userId, normEmail, hashPassword(seedPassword), now);
  } catch (err) {
    // Non-fatal (mirrors registerPersona best-effort posture); users-row role
    // below is the primary source for getDbUserRole.
  }

  // users row — primary role source for getDbUserRole; guarantee partner role.
  try {
    db.prepare(
      `INSERT INTO users (id, tenant_id, email, name, role, is_demo)
       VALUES (?, ?, ?, ?, 'consortium_partner', 0)
       ON CONFLICT(id) DO UPDATE SET role = CASE WHEN users.role = 'admin' THEN 'admin' ELSE 'consortium_partner' END, email = excluded.email`,
    ).run(userId, "tenant_capavate", normEmail, email);
  } catch (err) {
    /* best-effort */
  }

  // Ensure a durable bcrypt credential exists so getUserContextForId's DB
  // hydration resolves this session as authed (isAuthed:true) after redeem and
  // browser login works — this is what registerPersona did for new users. Only
  // seed a credential when NONE exists; never clobber a password the partner
  // may already have set via the set-password flow.
  try {
    if (!lookupByUserId(userId)) {
      storeCredential({ userId, email: normEmail, name: email, password: seedPassword });
    }
  } catch {
    /* best-effort — matches registerPersona */
  }

  return userId;
}
/* ══ NUMBERS BAND · WAVE E (W328) — ADD THE NAME, CHANGE NOTHING ELSE. ═══════
   Every existing key of every row is passed through by spread, in its original
   order and with its original value, and exactly ONE key is appended. A register
   row is money-bearing: this function reads no amount, no currency and no status,
   performs no arithmetic, and writes nothing anywhere.

   `investorName` is `string | null`. `null` means "no honest name exists" and the
   screen then renders its own existing floor; it is NEVER a placeholder word and
   NEVER the raw id. The name itself comes from `investorDisplayNameMap`, the one
   shared chain the LP Roster also uses.

   FAIL SOFT. If name resolution throws, the rows are returned exactly as the
   store produced them. A register that lists the GP's capital must not go dark
   because a display name could not be looked up. */
function withInvestorNames<T extends { investorId: string }>(
  partnerId: string,
  spvId: string,
  rows: T[],
): Array<T & { investorName: string | null }> {
  let names: Map<string, string | null>;
  try {
    /* ══ WAVE 338 — THE STORED DISPLAY NAME, THREADED IN FROM THE STORE. ════
       The register's own row shape (`SpvInvestorRegisterRow`) carries no name
       field, so the stored column is read here, from the SAME store call the
       roster uses, and handed to the SAME shared chain. That is deliberate: the
       whole point of `investorDisplayNameMap` is that the register and the
       roster cannot answer differently for one row, and a second read path
       would put that back at risk.

       INSIDE THE EXISTING try/catch, WHICH ALREADY FAILS SOFT. If the store
       read throws, `storedNames` stays empty, every row is UNKNOWN, and the
       chain is the pre-wave chain. A register that lists the GP's capital must
       not go dark because a display name could not be looked up. */
    const storedNames = new Map<string, string | null>();
    for (const sub of spvEngineStore.listSubscriptions(partnerId, spvId)) {
      const key = String(sub.investorId ?? "").trim();
      if (!key || storedNames.has(key)) continue;
      storedNames.set(key, sub.investorDisplayName ?? null);
    }
    names = investorDisplayNameMap(
      partnerId,
      spvId,
      rows.map((r) => r.investorId),
      storedNames,
    );
  } catch {
    names = new Map<string, string | null>();
  }
  return rows.map((r) => ({ ...r, investorName: names.get(String(r.investorId).trim()) ?? null }));
}

function isNumber(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function isISOCurrency(v: unknown): v is string {
  return typeof v === "string" && /^[A-Z]{3}$/.test(v);
}

/* ============================================================
 * Registration
 * ============================================================ */

export function registerPartnerRoutes(app: Express): void {

  /* ============================================================
   * ADMIN endpoints — /api/admin/partners/*
   * ============================================================ */

  app.get("/api/admin/partners", requireAdmin, (_req: Request, res: Response) => {
    const list = getAllContacts().filter((c) => c.kind === "consortium_partner");
    // v25.47 APD-036 (HIGH-10) — expose a numeric total so the admin Partners
    // page can render a count without re-deriving partners.length client-side.
    res.json({ partners: list, total: list.length });
  });

  /* ------------------------------------------------------------------
   * W-COLLECTIVE Wave 1 (v4 §1.4 / v5 §F) — admin-visible duplicate-seat report.
   *
   * A historical duplicate ACTIVE `partner_team_members` row for the same human
   * consumes a paid seat and makes the partner workspace show "2 seats" for one
   * person. `dedupeActiveTeamMembers()` has been able to DETECT this since W3.5
   * but nothing surfaced it, so the only way to find one was to be told by the
   * partner. This lists every affected organisation from the DURABLE roster so
   * an operator can work the list.
   *
   * READ-ONLY by design. It deliberately does NOT offer a merge/delete action:
   * collapsing a seat is a billing-visible change and the runbook
   * (docs/RUNBOOK_partner_seats.md) requires it be done deliberately, per
   * organisation, with the partner informed.
   *
   * MUST stay registered ABOVE `/api/admin/partners/:id`, or that route would
   * match "seat-report" as a partner id and 404.
   * ------------------------------------------------------------------ */
  app.get("/api/admin/partners/seat-report", requireAdmin, (_req: Request, res: Response) => {
    const partners = getAllContacts().filter((c) => c.kind === "consortium_partner");
    const rows = partners.map((p) => {
      const report = partnerTeamStore.seatReport(p.id);
      const { seatLimit, resolution, capability } = resolvePartnerSeatLimit(
        p.id,
        (p.tier as PartnerTier) ?? "catalyst",
      );
      return {
        partnerId: p.id,
        tier: p.tier ?? null,
        /* WAVE 45 — null means "no numeric cap applies". `seatLimitResolution`
           says WHICH of the two non-numeric cases it is, so a reader never has
           to guess whether null meant unlimited or unconfigured (R6). */
        seatLimit,
        seatLimitResolution: resolution,
        seatLimitDisplay: describeCapability(capability),
        activeSeats: report.activeSeats,
        distinctSeatUsers: report.distinctSeatUsers,
        duplicateSeatCount: report.duplicateSeatCount,
        duplicateSeatIdsByUserId: report.duplicateSeatIdsByUserId,
        seatCountSource: report.source,
        /* Only a CONFIGURED numeric cap can be exceeded. An unlimited tier is
           never over limit; an unconfigured one has no limit to be over, and
           reporting it as `true` would flag every such partner as in breach. */
        overLimit: seatLimit === null ? false : report.activeSeats > seatLimit,
      };
    });
    const affected = rows.filter((r) => r.duplicateSeatCount > 0);
    res.json({
      partners: rows,
      total: rows.length,
      affected,
      affectedTotal: affected.length,
      duplicateSeatTotal: affected.reduce((s, r) => s + r.duplicateSeatCount, 0),
      runbook: "docs/RUNBOOK_partner_seats.md",
    });
  });

  app.get("/api/admin/partners/:id", requireAdmin, (req: Request, res: Response) => {
    const c = getAllContacts().find((x) => x.id === String(req.params.id) && x.kind === "consortium_partner");
    if (!c) return res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    res.json({ partner: c });
  });

  /* ------------------------------------------------------------------
   * v23.9 A4/CP-5 — link a Capavate company to a consortium partner.
   * ------------------------------------------------------------------ */
  app.get("/api/admin/companies/:id", requireAdmin, (req: Request, res: Response) => {
    const companyId = String(req.params.id);
    const rec = getCompanyRecordById(companyId);
    if (!rec) return res.status(404).json({ error: "COMPANY_NOT_FOUND" });
    const consortiumPartnerId = getConsortiumPartnerId(companyId);
    const consortiumPartner = consortiumPartnerId
      ? getAllContacts().find((c) => c.id === consortiumPartnerId && c.kind === "consortium_partner") ?? null
      : null;
    res.json({ company: { ...rec, consortiumPartnerId, consortiumPartner } });
  });

  app.post("/api/admin/companies/:id/consortium-partner", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? "");
    if (!actor) return res.status(401).json({ error: "missing_identity" });
    const companyId = String(req.params.id);
    const partnerId = String((req.body ?? {}).partnerId ?? "");
    if (!partnerId) return badRequest(res, "partnerId required");
    const company = getCompanyRecordById(companyId);
    if (!company) return res.status(404).json({ error: "COMPANY_NOT_FOUND" });
    const partner = getAllContacts().find((c) => c.id === partnerId && c.kind === "consortium_partner");
    if (!partner) return res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    /* v25.23 NH-M — linkConsortiumPartner now fails closed (DB write first,
     * throws on persist failure). Surface a 500 instead of proceeding with a
     * lost link so the caller knows the sponsor attribution did not persist. */
    try {
      linkConsortiumPartner(companyId, partnerId);
    } catch (linkErr) {
      return res.status(500).json({ error: "CONSORTIUM_LINK_PERSIST_FAILED", message: (linkErr as Error).message });
    }
    // v23.9 C8/CP-6 — surface the sponsor in the founder's CRM.
    try {
      upsertInvestorContactFromPartner(companyId, {
        partnerId: partner.id,
        name: partner.displayName || partner.legalName,
        email: partner.email ?? "",
        region: (partner as { region?: string }).region ?? null,
      });
    } catch { /* non-fatal — link still succeeds */ }
    appendAdminAudit(actor, `company:${companyId}`, "company.consortium_partner_linked", { partnerId });
    // v25.14 NM1 / F7-NM1 — emit bridge event so Collective + Capavate can
    // react in real-time to consortium attribution changes.
    try {
      emitBridgeEvent({
        eventType: "partner.company_linked",
        aggregateId: companyId,
        aggregateKind: "company",
        payload: { companyId, partnerId, actor },
      });
    } catch { /* non-fatal */ }
    res.json({ ok: true, company: { ...company, consortiumPartnerId: partnerId, consortiumPartner: partner } });
  });

  app.delete("/api/admin/companies/:id/consortium-partner", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? "");
    if (!actor) return res.status(401).json({ error: "missing_identity" });
    const companyId = String(req.params.id);
    const company = getCompanyRecordById(companyId);
    if (!company) return res.status(404).json({ error: "COMPANY_NOT_FOUND" });
    /* v25.16 cross-comp NH1 — capture the partner id BEFORE the link is
       severed so we can correctly tear down the corresponding CRM contact
       and revoke the partner-attribution row. */
    const prevPartnerId = getConsortiumPartnerId(companyId);
    const removed = unlinkConsortiumPartner(companyId);
    let crmRemoved = false;
    let attributionRevoked = false;
    if (prevPartnerId) {
      try {
        crmRemoved = removeInvestorContactForPartner(companyId, prevPartnerId).removed;
      } catch { /* non-fatal */ }
      try {
        /* w-partner F1(g) — deliberately NON-strict. The link is already
           severed by this point; a durable-write failure must not abort the
           unlink and strand the company in a half-unlinked state. The kv
           dual-write still records the revocation. */
        partnerAttributionStore.revoke(prevPartnerId, companyId, actor);
        attributionRevoked = true;
      } catch (e) {
        // ATTRIBUTION_NOT_FOUND is expected when no attribution was ever
        // created (e.g. partner linked but never sourced a deal). Silently
        // continue; any other error is surfaced in the audit detail.
        const msg = (e as Error).message;
        if (msg !== "ATTRIBUTION_NOT_FOUND") {
          appendAdminAudit(actor, `company:${companyId}`, "company.consortium_partner_unlink_attr_warn", { partnerId: prevPartnerId, msg });
        }
      }
    }
    appendAdminAudit(actor, `company:${companyId}`, "company.consortium_partner_unlinked", {
      removed,
      prevPartnerId,
      crmRemoved,
      attributionRevoked,
    });
    // v25.14 NM1 / F7-NM1 — emit bridge event so downstream surfaces can
    // drop consortium attribution badges, etc.
    try {
      emitBridgeEvent({
        eventType: "partner.company_unlinked",
        aggregateId: companyId,
        aggregateKind: "company",
        payload: { companyId, removed, prevPartnerId, crmRemoved, attributionRevoked, actor },
      });
    } catch { /* non-fatal */ }
    res.json({ ok: true, company: { ...company, consortiumPartnerId: null, consortiumPartner: null } });
  });

  app.post("/api/admin/partners", requireAdmin, (req: Request, res: Response) => {
    const { legalName, displayName, email, region, partnerType, tier } = req.body ?? {};
    if (!isString(legalName) || !isString(email)) return badRequest(res, "legalName + email required");
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    const contact = createContact({
      kind: "consortium_partner",
      legalName,
      displayName: displayName ?? legalName,
      email,
      type: "partner_org",
      status: "active",
      verification: "pending",
      hqCity: "",
      hqCountry: region ?? "US",
      region: region ?? "US",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: [],
      stages: [],
      companyIds: [],
      partnerWeight: 1,
      partnerSince: new Date().toISOString(),
      phone: null,
      website: null,
      linkedinUrl: null,
      tags: [],
      notes: "",
      createdBy: actor,
      updatedBy: actor,
      // partner fields:
      tier: (tier as PartnerTier) ?? "catalyst",
      tierSince: new Date().toISOString(),
      foundingMember: false,
      partnerType: (partnerType as PartnerType) ?? "angel_network",
      regionCode: region ?? "US",
      preferredPayoutCurrency: "USD",
      configJson: null,
    }, actor);
    appendAdminAudit(actor, `partner:${contact.id}`, "partner.onboarded", { legalName, tier: contact.tier });
    emitBridgeEvent({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventType: "partner.onboarded" as any,
      aggregateId: contact.id,
      aggregateKind: "platform",
      payload: { partnerId: contact.id, legalName, tier: contact.tier, partnerType: contact.partnerType, onboardedBy: actor, idempotencyKey: contact.id },
    });
    res.status(201).json({ partner: contact });
  });

  app.patch("/api/admin/partners/:id", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    /* WAVE 198 · ITEM D-1 — ASSERTED BEFORE THE UPDATE, AND DELIBERATELY OUTSIDE
       THE try. `updateContact` -> `persistContact` writes named columns and a fixed
       metadata key set; anything else was accepted here and discarded on write while
       this route answered 200 with the object it had failed to change. The check
       runs before the call so nothing is half-written, and outside the try because
       that catch turns EVERY throw into `PARTNER_NOT_FOUND` — a refusal raised
       inside it would be reported to the admin as a missing partner, which is a
       second wrong answer rather than a fix. The 404 below is untouched. */
    try {
      assertAdminPartnerPatchFullyApplied(req.body ?? {});
    } catch (e) {
      if (isPartnerPatchUnappliedError(e)) {
        return res.status(400).json({
          error: PARTNER_PATCH_UNAPPLIED_CODE,
          refusalHeadline: e.refusalHeadline,
          refusalGuidance: e.refusalGuidance,
          message: e.refusalHeadline,
          unappliedFields: e.unappliedFields,
        });
      }
      throw e;
    }
    try {
      const updated = updateContact(String(req.params.id), req.body ?? {}, actor, "partner.updated");
      res.json({ partner: updated });
    } catch {
      res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    }
  });

  app.post("/api/admin/partners/:id/promote-tier", requireAdmin, (req: Request, res: Response) => {
    const { tier, rationale } = req.body ?? {};
    // WAVE 56 (R21/R36) — THE VALIDATION DOMAIN IS THE DATABASE.
    // This was a compiled-in array of five, and it is the reason a fully created
    // tier could not be ASSIGNED to a partner: measured through HTTP,
    // POST /api/admin/partners/:id/promote-tier {tier:"bridge"} answered 400
    // "tier must be one of catalyst|builder|amplifier|nexus|founding_member"
    // while the pricing page advertised bridge at its real price. The list now
    // comes from partner_tier_lifecycle, with the seeded five union'd in so an
    // existing tier can never drop out of the picker; an unknown slug is still
    // refused, and the refusal still names the tiers that do exist.
    const validTiers: string[] = partnerTierDomainSlugs();
    if (!isString(tier) || !validTiers.includes(tier)) {
      return badRequest(res, "tier must be one of " + validTiers.join("|"));
    }
    if (!isString(rationale)) return badRequest(res, "rationale required (audit reason)");
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    try {
      const updated = updateContact(String(req.params.id), { tier: tier as PartnerTier, tierSince: new Date().toISOString() } as Partial<Parameters<typeof updateContact>[1]>, actor, "partner.tier_changed");
      appendAdminAudit(actor, `partner:${String(req.params.id)}`, "partner.tier_changed", { newTier: tier, rationale });
      emitBridgeEvent({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eventType: "partner.tier_changed" as any,
        aggregateId: String(req.params.id),
        aggregateKind: "platform",
        payload: { partnerId: String(req.params.id), tier, rationale, changedAt: new Date().toISOString(), idempotencyKey: `${String(req.params.id)}|${tier}|${Date.now()}` },
      });
      res.json({ partner: updated });
    } catch {
      res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    }
  });

  app.post("/api/admin/partners/:id/suspend", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    try {
      const updated = updateContact(String(req.params.id), { status: "suspended" }, actor, "partner.suspended");
      // v25.14 F8-NM2 — emit bridge event so Collective / Capavate downstream
      // surfaces (deal feeds, attribution badges, etc.) can react instead of
      // waiting for a server restart re-hydration.
      try {
        emitBridgeEvent({
          eventType: "partner.suspended",
          aggregateId: String(req.params.id),
          aggregateKind: "platform",
          payload: { partnerId: String(req.params.id), suspendedBy: actor },
        });
      } catch { /* non-fatal */ }
      res.json({ partner: updated });
    } catch {
      res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    }
  });

  // v25.14 F8-NH3 — reactivate (unsuspend) endpoint. Without this, every
  // suspension was effectively permanent and admins needed raw SQL to
  // restore a partner. Mirror of suspend, sets status back to "active" and
  // emits the matching bridge event.
  app.post("/api/admin/partners/:id/reactivate", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? "");
    if (!actor) return res.status(401).json({ error: "missing_identity" });
    try {
      const updated = updateContact(String(req.params.id), { status: "active" }, actor, "partner.reactivated");
      try {
        emitBridgeEvent({
          eventType: "partner.reactivated",
          aggregateId: String(req.params.id),
          aggregateKind: "platform",
          payload: { partnerId: String(req.params.id), reactivatedBy: actor },
        });
      } catch { /* non-fatal */ }
      res.json({ partner: updated });
    } catch {
      res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    }
  });

  app.post("/api/admin/partners/:id/archive", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    try {
      const updated = updateContact(String(req.params.id), { status: "archived" }, actor, "partner.archived");
      // v25.14 F8-NM2 — emit bridge event on archive too (same gap as suspend).
      try {
        emitBridgeEvent({
          eventType: "partner.archived",
          aggregateId: String(req.params.id),
          aggregateKind: "platform",
          payload: { partnerId: String(req.params.id), archivedBy: actor },
        });
      } catch { /* non-fatal */ }
      res.json({ partner: updated });
    } catch {
      res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    }
  });

  /**
   * GET /api/admin/partners/:partnerId/workspace/audit
   *
   * v24.5 GAP-4 — Read-only audit snapshot of a partner workspace.
   * Admin-only. Returns team_members + notes + tasks + files from the DB
   * even when the partner status is "archived". Does NOT enforce any
   * partner-side workspace gate so archived partners remain fully auditable.
   *
   * Implementation note: the in-memory stores (loaded by
   * hydratePartnerWorkspaceStoreV241) already hold data for all partners
   * regardless of archive status. We also do a direct DB read so the
   * response stays correct after a restart even if the in-memory state
   * was not re-populated (e.g. a hot-swap deploy where only the new DB
   * row was written by a sibling process). The DB layer is the source of
   * truth; in-memory results supplement it.
   */
  app.get("/api/admin/partners/:partnerId/workspace/audit", requireAdmin, (req: Request, res: Response) => {
    const partnerId = String(req.params.partnerId || "").trim();
    if (!partnerId) return res.status(400).json({ error: "partnerId_required" });

    // Verify the partner exists in adminContactsStore (any status, including archived).
    const contact = getById(partnerId);
    if (!contact || contact.kind !== "consortium_partner") {
      return res.status(404).json({ error: "PARTNER_NOT_FOUND", partnerId });
    }

    // Read workspace data from in-memory stores (hydrated from DB on boot).
    const teamMembers = partnerTeamStore.listByPartner(partnerId);
    const notes       = partnerNotesStore.listByPartner(partnerId);
    const tasks       = partnerTasksStore.listByPartner(partnerId);
    const files       = partnerFilesStore.listByPartner(partnerId);

    // Supplement with a direct DB read so archived partners that were
    // never loaded into RAM (e.g. archived before server boot) are covered.
    let dbTeamMembers: unknown[] = [];
    let dbNotes:       unknown[] = [];
    let dbTasks:       unknown[] = [];
    let dbFiles:       unknown[] = [];
    try {
      const db = rawDb();
      dbTeamMembers = (db.prepare(
        `SELECT id, partner_id, user_id, sub_role, status, joined_at, removed_at FROM partner_team_members WHERE partner_id = ?`,
      ).all(partnerId) as unknown[]) ?? [];
      dbNotes = (db.prepare(
        `SELECT id, partner_id, note_json FROM partner_notes WHERE partner_id = ?`,
      ).all(partnerId) as Array<{ note_json: string }>).map((r) => {
        try { return JSON.parse(r.note_json); } catch { return r; }
      });
      dbTasks = (db.prepare(
        `SELECT id, partner_id, task_json FROM partner_tasks WHERE partner_id = ?`,
      ).all(partnerId) as Array<{ task_json: string }>).map((r) => {
        try { return JSON.parse(r.task_json); } catch { return r; }
      });
      /* v25.16 cross-comp NH3 — exclude tombstoned files from the admin audit
         view so soft-deleted rows (v25.15 NH2) do not resurface via this path. */
      dbFiles = (db.prepare(
        `SELECT id, partner_id, file_json FROM partner_files WHERE partner_id = ?`,
      ).all(partnerId) as Array<{ file_json: string }>)
        .map((r) => {
          try { return JSON.parse(r.file_json); } catch { return r; }
        })
        .filter((f: any) => !f || !f.deletedAt);
    } catch { /* DB may not be available — use in-memory data only */ }

    // Deduplicate: prefer in-memory rows (which carry richer runtime fields),
    // then append DB-only rows not yet in RAM.
    const memTeamIds = new Set(teamMembers.map((m) => m.id));
    const memNoteIds = new Set(notes.map((n) => n.id));
    const memTaskIds = new Set(tasks.map((t) => t.id));
    const memFileIds = new Set(files.map((f) => f.id));

    return res.json({
      ok: true,
      partnerId,
      partnerStatus: contact.status,
      auditedAt: new Date().toISOString(),
      teamMembers: [
        ...teamMembers,
        ...(dbTeamMembers as Array<{ id?: string }>).filter((r) => r.id && !memTeamIds.has(r.id)),
      ],
      /* ═══ WAVE 192 · ITEM C2 · R160.4 — TWO ADMIN SURFACES DISAGREED ON THE TEAM
         COUNT, AND THIS ONE WAS THE WRONG ONE.

         WHAT WAS ON SCREEN. This endpoint's `teamMembers` array had TWO rows
         (`ptm_9165f3f80152715d`, `ptm_662e6d2d8605977b`) and the admin partner
         detail page rendered its `.length` as "Team Members (2)", while the
         partner-facing team page reported "1 of 2 seats filled, 0 pending".

         WHY THIS ONE IS WRONG. `teamMembers` is deliberately a UNION of two
         reads: `partnerTeamStore.listByPartner()`, which filters to
         `status === "active"` (partnerWorkspaceStore.ts:1051), and the DB
         supplement above, whose SELECT has NO status and NO `removed_at` filter
         — by design, so an archived partner's rows stay auditable. That union is
         CORRECT as a LIST and wrong as a COUNT: `.length` counts removed and
         non-active rows as occupied seats. The partner side counts seats, and
         seats are what the word means.

         SO THE COUNT NOW COMES FROM THE ONE PLACE THAT DEFINES IT.
         `partnerTeamStore.countActiveSeats()` (partnerWorkspaceStore.ts:1222) is
         already the platform's seat definition: it is what
         `lib/requirePartnerAuth.ts:204` ENFORCES seat limits against, and what
         `GET /api/partner/me/team` returns as `activeSeats` — the number the
         partner-facing page renders. Admin and partner now derive the same number
         from the same function, so they cannot drift again.

         THE LIST IS NOT TRUNCATED. `teamMembers` above is unchanged, every row
         included, because an auditor needs to SEE the removed rows — they are
         exactly what made the old count look inflated. What changes is that the
         heading no longer calls them occupied seats.

         WHY THIS MATTERS BEYOND THE HEADING (R150.2 / R160.2). The owner's false
         tenant-id theory was reasoned from this inflated count: two rows on this
         screen implied the binding row existed, while `resolvePartnerIdForUser`
         (lib/partnerDelegatedContext.ts:50) requires `status='active' AND
         removed_at IS NULL` and was returning null. A count that ignores both
         predicates cannot tell you whether that binding exists. PROBABLE origin,
         not proven — there is no live access from this wave. */
      activeSeatCount: partnerTeamStore.countActiveSeats(partnerId),
      notes: [
        ...notes,
        ...(dbNotes as Array<{ id?: string }>).filter((r) => r.id && !memNoteIds.has(r.id)),
      ],
      tasks: [
        ...tasks,
        ...(dbTasks as Array<{ id?: string }>).filter((r) => r.id && !memTaskIds.has(r.id)),
      ],
      files: [
        ...files,
        ...(dbFiles as Array<{ id?: string }>).filter((r) => r.id && !memFileIds.has(r.id)),
      ],
    });
  });

  /* ════════════════════════════════════════════════════════════════════════════
     WAVE 177 · ITEM A · R148.1 — THE PARTNER IDENTITY BINDING, ADMIN-MANAGED.
     ════════════════════════════════════════════════════════════════════════════
     WHY THIS EXISTS. On live, `ozan@trendwellventures.com` sees "No eligible
     contacts." for every recipient search. R148.1 proved the cause against live
     data: `resolvePartnerIdForUser()` (lib/partnerDelegatedContext.ts:50) reads
     `partner_team_members WHERE user_id = ? AND status='active' AND removed_at IS
     NULL` and returns null, so BOTH `partner_own_lp_peers` AND
     `partner_team_peers` return `[]` by construction — the LP logic and the team
     logic never execute. Waves 167/168 shipped CORRECT code; the live DATABASE is
     missing the row that binds the logged-in human to their partner organisation.

     SO THE FIX IS A MANAGEMENT SURFACE, NOT A SEED. A seeded row for one partner
     id would make one symptom disappear and leave the platform unable to do this
     again for the next partner. Nothing below references a specific partner, user
     or membership id: the owner supplies the email, the platform resolves it.

     FOUR ROUTES, ALL `requireAdmin`, ALL DB-DRIVEN:
       GET  …/team/identity          — read the truth, with names WHERE DERIVABLE
       POST …/team/bind              — bind an existing platform user by email
       POST …/team/:memberId/deactivate — status/removed_at, NEVER a hard delete
       POST …/organization-name      — the registered name the owner TYPES

     NO MIGRATION. Every column written already exists:
     `partner_team_members(id, partner_id, user_id, sub_role, status, joined_at,
     removed_at, created_by, is_seed, updated_at)` — db/connection.ts:5090 — and
     `partner_organizations(id, tenant_id, name, …, created_at, updated_at)` —
     db/connection.ts:4535. The uniqueness the bind path relies on
     (`ux_ptm_partner_user_active`) landed in migration 0211. The email lookup uses
     the pre-existing `users_email_unique` index. Adding a no-op 0213 would only
     add two mirrored files and two more chances of the R144 unmirrored-migration
     failure.

     NO MONEY. Neither table has a money column. The only numbers here are integer
     SEAT COUNTS from `countActiveSeats()` / `resolvePartnerSeatLimit()` — the same
     pair `requirePartnerAuth.ts:204` enforces with, so this surface cannot
     disagree with the partner-side 403.
     ════════════════════════════════════════════════════════════════════════════ */

  /** The five permission tiers a membership may carry (partnerWorkspaceStore.ts:121). */
  const W177_BINDABLE_SUB_ROLES: PartnerSubRole[] = [
    "managing_partner", "associate", "bd", "analyst", "viewer",
  ];

  /* One shape for "what the platform can honestly say about this membership".
     `resolvedName` and `email` are `null` when NOT DERIVABLE — never a
     placeholder. `resolveDisplayName` returns "Pending member" / "Invited
     member" / "Public applicant" with `resolved:false` when it finds nothing
     (lib/displayNameResolver.ts:45-50), and printing one of those as if it were
     a person's name is exactly the invented name Item A.3 forbids. So the flag
     is read and the placeholder is DISCARDED; the client prints its own stated
     fallback next to the id. */
  function w177MembershipIdentity(partnerId: string) {
    let rows: Array<{
      id?: string; user_id?: string; sub_role?: string; status?: string;
      joined_at?: string; removed_at?: string | null; is_seed?: number;
    }> = [];
    try {
      rows = (rawDb().prepare(
        `SELECT id, user_id, sub_role, status, joined_at, removed_at, is_seed
           FROM partner_team_members
          WHERE partner_id = ?
          ORDER BY (status = 'active') DESC, joined_at ASC, id ASC`,
      ).all(partnerId) as typeof rows) ?? [];
    } catch {
      /* An unreadable table is reported as unreadable by the caller, never as an
         empty team — the two are different facts. */
      return null;
    }
    const resolved = resolveDisplayNames(
      rows.map((r) => String(r.user_id ?? "")).filter((s) => s.length > 0),
    );
    return rows.map((r) => {
      const userId = String(r.user_id ?? "").trim();
      const hit = userId ? resolved.get(userId) : undefined;
      return {
        memberId: String(r.id ?? ""),
        /* Empty string is reported as null so "no user on this row" and "a user
           whose name we cannot read" never look the same. */
        userId: userId.length > 0 ? userId : null,
        subRole: typeof r.sub_role === "string" && r.sub_role.trim().length > 0 ? r.sub_role.trim() : null,
        status: typeof r.status === "string" && r.status.trim().length > 0 ? r.status.trim() : null,
        joinedAt: typeof r.joined_at === "string" && r.joined_at.trim().length > 0 ? r.joined_at.trim() : null,
        removedAt: typeof r.removed_at === "string" && r.removed_at.trim().length > 0 ? r.removed_at.trim() : null,
        isSeed: r.is_seed === 1,
        resolvedName: hit?.resolved ? hit.name : null,
        email: hit?.email ?? null,
      };
    });
  }

  /** The partner organisation's registered name, or null. Same read as
   *  `resolvePartnerName` (lib/partnerDelegatedContext.ts:74), so this surface
   *  reports exactly what the messaging stamp will read. */
  function w177OrganizationName(partnerId: string): string | null {
    try {
      const row = rawDb()
        .prepare(`SELECT name FROM partner_organizations WHERE id = ? LIMIT 1`)
        .get(partnerId) as { name?: string } | undefined;
      const name = String(row?.name ?? "").trim();
      return name.length > 0 ? name : null;
    } catch {
      return null;
    }
  }

  function w177Seats(partnerId: string, tier: string | undefined) {
    try {
      const { seatLimit, resolution, capability } = resolvePartnerSeatLimit(
        partnerId,
        (tier as PartnerTier) ?? "catalyst",
      );
      return {
        activeSeats: partnerTeamStore.countActiveSeats(partnerId),
        seatLimit,
        seatLimitResolution: resolution,
        seatLimitDisplay: describeCapability(capability),
      };
    } catch {
      return null;
    }
  }

  app.get("/api/admin/partners/:partnerId/team/identity", requireAdmin, (req: Request, res: Response) => {
    const partnerId = String(req.params.partnerId || "").trim();
    if (!partnerId) return badRequest(res, "partnerId required");
    const contact = getById(partnerId);
    if (!contact || contact.kind !== "consortium_partner") {
      return res.status(404).json({ ok: false, error: "PARTNER_NOT_FOUND", partnerId });
    }
    const members = w177MembershipIdentity(partnerId);
    if (members === null) {
      return res.status(500).json({ ok: false, error: "MEMBERSHIP_TABLE_UNREADABLE", partnerId });
    }
    return res.json({
      ok: true,
      partnerId,
      organizationName: w177OrganizationName(partnerId),
      seats: w177Seats(partnerId, contact.tier as string | undefined),
      members,
      /* The permission tiers the bind form may offer. Data, not a hardcoded list
         in the client, so the two cannot drift apart. */
      bindableSubRoles: W177_BINDABLE_SUB_ROLES,
    });
  });

  /* ══════════════════════════════════════════════════════════════════════════
     WAVE 185 · ITEM B.2 · R156.5 — "WILL MESSAGING WORK FOR THIS PERSON, AND IF
     NOT, WHICH FACT IS MISSING?" ANSWERED WITHOUT READING A DATABASE.
     ══════════════════════════════════════════════════════════════════════════
     R156.5's "completely" means an admin can make messaging work on live WITHOUT
     anyone hand-editing rows. Wave 177 shipped the repair but no way to confirm
     it: an admin clicked "Link this person", saw a success toast, and had no way
     to know whether the partner could now actually address anybody. On the R150.2
     case the toast would never even have appeared — the bind was refused 409.

     THIS REUSES WAVE 177's DIAGNOSTIC RATHER THAN BUILDING A SECOND ONE.
     `diagnosePartnerAudienceEmptiness` is the single place that decides which
     fact is missing, it is already what the partner-facing empty state renders
     through `emptyReason`, and a second implementation here would be free to
     disagree with the sentence the partner is reading on their own screen. Wave
     185 EXTENDED it with the `partner_binding_unresolvable` cause instead.

     IT NAMES NO MACHINE TOKENS IN ITS PROSE. Wave 167's test P-2 established that
     an admin-facing diagnostic must not leak rule keys, column names or peer ids;
     the sentences come from the diagnostic, which is bound by that rule, and the
     only identifier this route echoes is the one the ADMIN just typed. It returns
     no peer ids and no LP names — only counts of the partner's OWN people. */
  app.get("/api/admin/partners/:partnerId/team/messaging-check", requireAdmin, (req: Request, res: Response) => {
    const partnerId = String(req.params.partnerId || "").trim();
    if (!partnerId) return badRequest(res, "partnerId required");
    const contact = getById(partnerId);
    if (!contact || contact.kind !== "consortium_partner") {
      return res.status(404).json({ ok: false, error: "PARTNER_NOT_FOUND", partnerId });
    }
    /* Addressed by email OR by user id, because an admin has the email in front
       of them and a support ticket has the id. */
    const emailParam = String((req.query.email as string) ?? "").trim().toLowerCase();
    const userIdParam = String((req.query.userId as string) ?? "").trim();
    if (!emailParam && !userIdParam) return badRequest(res, "email or userId required");

    let userId = userIdParam;
    if (!userId) {
      try {
        const row = rawDb()
          .prepare(`SELECT id FROM users WHERE lower(email) = ? AND deleted_at IS NULL LIMIT 1`)
          .get(emailParam) as { id?: string } | undefined;
        userId = String(row?.id ?? "").trim();
      } catch (err) {
        return res.status(500).json({ ok: false, error: "USER_LOOKUP_FAILED", message: (err as Error).message });
      }
    }
    if (!userId) {
      /* NOT a 404 and NOT a failure: "there is no platform account with this
         address" is itself the missing fact, and it is the most common one. */
      return res.json({
        ok: true,
        partnerId,
        email: emailParam || null,
        userId: null,
        messagingWillWork: false,
        cause: "no_platform_account",
        missingFact:
          "There is no platform account with this email address, so there is nothing to link yet. The person has to register before an administrator can link them.",
        boundPartnerId: null,
        boundPartnerIsARealPartner: null,
        boundToThisPartner: false,
        ownLpCount: 0,
        otherTeamMemberCount: 0,
      });
    }

    /* THE SAME RESOLVER THE MESSAGING PATH USES. Reporting anything else would
       make this surface capable of saying "it works" about a path it did not
       actually exercise. */
    const boundPartnerId = resolvePartnerIdForUser(userId);
    const boundPartnerIsARealPartner =
      boundPartnerId === null ? null : partnerIdResolvesToAPartner(boundPartnerId);
    const diagnosis = diagnosePartnerAudienceEmptiness(userId, "both");
    const boundToThisPartner = boundPartnerId === partnerId;

    /* MESSAGING WORKS only when the binding resolves to THIS partner AND that
       partner actually has somebody to reach. `not_empty` is the diagnostic's own
       word for "there is in fact an audience", so the two cannot disagree. */
    const messagingWillWork = boundToThisPartner && diagnosis.cause === "not_empty";

    /* One sentence, chosen by the diagnostic wherever the diagnostic has an
       opinion. The only case it cannot speak to is "bound to a DIFFERENT real
       partner", which is not an emptiness at all — from this page's point of view
       it is the missing fact. */
    const missingFact = messagingWillWork
      ? null
      : boundPartnerId !== null && boundPartnerIsARealPartner === true && !boundToThisPartner
        ? "This person's account is linked to a different partner organisation. Only an owner decision can move them, so the existing link has to be deactivated on that organisation's page first."
        : diagnosis.sentence;

    return res.json({
      ok: true,
      partnerId,
      email: emailParam || null,
      userId,
      messagingWillWork,
      cause: messagingWillWork ? "ready" : diagnosis.cause,
      missingFact,
      boundPartnerId,
      boundPartnerIsARealPartner,
      boundToThisPartner,
      /* Counts of the partner's OWN people only — never names, never ids. */
      ownLpCount: diagnosis.ownLpCount,
      otherTeamMemberCount: diagnosis.otherTeamMemberCount,
    });
  });

  app.post("/api/admin/partners/:partnerId/team/bind", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const partnerId = String(req.params.partnerId || "").trim();
    if (!partnerId) return badRequest(res, "partnerId required");
    const contact = getById(partnerId);
    if (!contact || contact.kind !== "consortium_partner") {
      return res.status(404).json({ ok: false, error: "PARTNER_NOT_FOUND", partnerId });
    }
    const body = (req.body ?? {}) as {
      email?: unknown;
      subRole?: unknown;
      /* WAVE 185 · ITEM B · R150.2 — explicit, opt-in, never a default. */
      supersedeUnresolvableBinding?: unknown;
    };
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) return badRequest(res, "email required");
    const subRole = String(body.subRole ?? "").trim();
    if (!W177_BINDABLE_SUB_ROLES.includes(subRole as PartnerSubRole)) {
      return badRequest(res, "subRole must be one of the platform's five permission tiers");
    }

    /* BIND AN EXISTING PLATFORM USER ONLY. This route repairs an identity
       binding; it does not create accounts. Inventing a user here would produce
       a membership pointing at an id nobody can log in as — the same class of
       unusable row this wave exists to fix. */
    let userRow: { id?: string; email?: string; name?: string } | undefined;
    try {
      userRow = rawDb()
        .prepare(`SELECT id, email, name FROM users WHERE lower(email) = ? AND deleted_at IS NULL LIMIT 1`)
        .get(email) as typeof userRow;
    } catch (err) {
      return res.status(500).json({ ok: false, error: "USER_LOOKUP_FAILED", message: (err as Error).message });
    }
    const userId = String(userRow?.id ?? "").trim();
    if (!userId) {
      return res.status(404).json({ ok: false, error: "PLATFORM_USER_NOT_FOUND", email });
    }

    /* ALREADY BOUND ELSEWHERE IS A REFUSAL, NOT A MOVE. `resolvePartnerIdForUser`
       takes the EARLIEST active row, so silently adding a second organisation
       would leave which partner a person acts for decided by a timestamp. Moving
       a human between partner organisations is an owner decision: deactivate the
       old membership first, deliberately. */
    let existingElsewhere: string | null = null;
    try {
      const row = rawDb()
        .prepare(
          `SELECT partner_id FROM partner_team_members
            WHERE user_id = ? AND status = 'active' AND removed_at IS NULL AND partner_id <> ?
            ORDER BY joined_at ASC LIMIT 1`,
        )
        .get(userId, partnerId) as { partner_id?: string } | undefined;
      const pid = String(row?.partner_id ?? "").trim();
      existingElsewhere = pid.length > 0 ? pid : null;
    } catch { /* treated as "none found"; the add() below is still fail-closed */ }
    /* WAVE 185 · ITEM B · R150.2 — TWO CASES WAVE 177 CONFLATED, NOW SEPARATED.

       WAVE 185 PREFLIGHT PROVED (probes P1-P4) that wave 177's repair does NOT
       resolve the live case. R150.2 measured `partner_team_members.partner_id`
       holding a TENANT id (`tenant_cp_keiretsu_ca`) where an
       `ac_consortium_partner_…` id belongs. That row is ACTIVE and OLDER than any
       repair, so:
         • `resolvePartnerIdForUser` is `ORDER BY joined_at ASC LIMIT 1` — the
           stale row wins forever, and a correct new binding can never outrank it;
         • the refusal below fired, naming a tenant id as "another partner", so the
           admin was HARD-BLOCKED before anything was written;
         • `w177MembershipIdentity` is `WHERE partner_id = ?`, so the obstructing
           row appears on NO partner page and has NO Deactivate control anywhere.
       A non-technical admin following LIVE_REPAIR_STEPS.md reached a dead end.

       SO THE REFUSAL IS SPLIT BY WHETHER THE EXISTING BINDING IS A PARTNER AT ALL.

       (1) IT IS A REAL PARTNER — refused exactly as before, byte-for-byte. Moving
           a human between two partner organisations stays an owner decision, and
           allowing it here is the one change that could leak partner A's LPs to
           partner B. Not weakened, not made supersedable.

       (2) IT IS NOT A PARTNER — a distinct error, and the admin may supersede it
           by opting in EXPLICITLY. Superseding deactivates (`status='removed'` +
           `removed_at`, never a hard delete: an identity claim that was once acted
           upon stays auditable) only rows whose `partner_id` resolves to no
           partner organisation. It therefore CANNOT move anyone between real
           partners — the fence cannot move by one person through this path. */
    if (existingElsewhere) {
      const existingIsARealPartner = partnerIdResolvesToAPartner(existingElsewhere);
      if (existingIsARealPartner) {
        return res.status(409).json({
          ok: false,
          error: "USER_ALREADY_BOUND_TO_ANOTHER_PARTNER",
          email,
          userId,
          boundPartnerId: existingElsewhere,
        });
      }
      const supersede = body.supersedeUnresolvableBinding === true;
      if (!supersede) {
        /* NOT a silent success and NOT a dead end: the admin is told the link
           points at something that is not a partner, and that they may replace
           it. `supersedable` is what the client keys its confirm control off, so
           the button cannot appear for case (1). */
        return res.status(409).json({
          ok: false,
          error: "USER_BOUND_TO_UNRESOLVABLE_PARTNER_ID",
          email,
          userId,
          boundPartnerId: existingElsewhere,
          supersedable: true,
          message:
            "This person's account is already linked to a record that is not a partner organisation. Replacing that link will deactivate it and link them to this partner instead.",
        });
      }
      /* THE SUPERSEDE. Scoped by the SAME predicate that classified the refusal,
         re-evaluated per row inside the loop rather than trusting the single row
         the pre-check happened to surface — there may be more than one, and a
         second stale row left behind would win the `joined_at ASC` race again and
         reproduce the whole defect one wave later. */
      let supersededMemberIds: string[] = [];
      try {
        const rows = (rawDb()
          .prepare(
            `SELECT id, partner_id FROM partner_team_members
              WHERE user_id = ? AND status = 'active' AND removed_at IS NULL AND partner_id <> ?`,
          )
          .all(userId, partnerId) as Array<{ id?: string; partner_id?: string }>) ?? [];
        const stmt = rawDb().prepare(
          `UPDATE partner_team_members
              SET status = 'removed', removed_at = ?, updated_at = ?
            WHERE id = ? AND status = 'active'`,
        );
        const stamp = new Date().toISOString();
        for (const r of rows) {
          const pid = String(r.partner_id ?? "").trim();
          const mid = String(r.id ?? "").trim();
          if (!mid || !pid) continue;
          /* THE GUARD THAT MAKES THIS SAFE. A real partner membership is never
             touched, even inside an explicitly opted-in supersede. */
          if (partnerIdResolvesToAPartner(pid)) continue;
          stmt.run(stamp, stamp, mid);
          supersededMemberIds.push(mid);
        }
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: "SUPERSEDE_PERSIST_FAILED",
          message: (err as Error).message,
        });
      }
      /* Audited, because deactivating a membership is a real administrative act
         and the owner must be able to see who did it and to what. */
      try {
        appendAdminAudit(
          actor,
          `partner:${partnerId}`,
          "partner.team_member.unresolvable_binding_superseded",
          { userId, email, supersededPartnerId: existingElsewhere, supersededMemberIds },
        );
      } catch { /* an audit sink failure must not strand the repair half-done */ }
      /* If nothing was actually deactivated the obstruction is still there, and
         reporting success would be the false claim this whole wave exists to
         stop. */
      if (supersededMemberIds.length === 0) {
        return res.status(409).json({
          ok: false,
          error: "SUPERSEDE_FOUND_NOTHING_TO_REPLACE",
          email,
          userId,
          boundPartnerId: existingElsewhere,
        });
      }
    }

    /* SEATS. A paid limit is a paid limit even on a repair, so an over-limit bind
       is refused with BOTH numbers named — the seat override editor is on this
       same page, so the refusal is actionable without leaving the screen. Only a
       CONFIGURED numeric cap can be exceeded (WAVE 45): null means unlimited or
       unconfigured, and neither is a breach. Already-active members are exempt
       because re-binding them adds no seat. */
    const seats = w177Seats(partnerId, contact.tier as string | undefined);
    let alreadyActiveHere = false;
    try {
      const row = rawDb()
        .prepare(
          `SELECT id FROM partner_team_members
            WHERE partner_id = ? AND user_id = ? AND status = 'active' AND removed_at IS NULL LIMIT 1`,
        )
        .get(partnerId, userId) as { id?: string } | undefined;
      alreadyActiveHere = !!row?.id;
    } catch { /* fall through — add() is idempotent for an existing active row */ }
    if (!alreadyActiveHere && seats && seats.seatLimit !== null && seats.activeSeats >= seats.seatLimit) {
      return res.status(409).json({
        ok: false,
        error: "SEAT_LIMIT_REACHED",
        activeSeats: seats.activeSeats,
        seatLimit: seats.seatLimit,
        seatLimitDisplay: seats.seatLimitDisplay,
      });
    }

    /* The write. `add()` persists with strict=true (fail-closed: it throws rather
       than leave a RAM-only membership), sets status='active', joined_at=now and
       removed_at=null, audits `partner.team_member.added` and emits
       `partner.team_member_added`. It returns the existing active row unchanged
       if one is already there, so a double-click cannot twin a membership. */
    let member;
    try {
      member = partnerTeamStore.add(partnerId, userId, subRole as PartnerSubRole, actor, { isSeed: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "BIND_PERSIST_FAILED", message: (err as Error).message });
    }
    appendAdminAudit(actor, `partner:${partnerId}`, "partner.identity_binding.bound", {
      partnerId, userId, email, subRole, memberId: member.id,
    });
    /* NO NEW BRIDGE EVENT TYPE. `partnerTeamStore.add()` already emits
       `partner.team_member_added` for this exact fact, and `OutboundEventType` is
       a closed union whose members are contracts with the Collective receiver.
       Minting a second event for one write would double-count the membership
       downstream — and per R148.2 the bridge currently has no real destination,
       so a new event type could not be verified end to end anyway. */
    const members = w177MembershipIdentity(partnerId);
    return res.json({
      ok: true,
      partnerId,
      boundUserId: userId,
      memberId: member.id,
      organizationName: w177OrganizationName(partnerId),
      seats: w177Seats(partnerId, contact.tier as string | undefined),
      members: members ?? [],
    });
  });

  app.post("/api/admin/partners/:partnerId/team/:memberId/deactivate", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const partnerId = String(req.params.partnerId || "").trim();
    const memberId = String(req.params.memberId || "").trim();
    if (!partnerId || !memberId) return badRequest(res, "partnerId + memberId required");
    const contact = getById(partnerId);
    if (!contact || contact.kind !== "consortium_partner") {
      return res.status(404).json({ ok: false, error: "PARTNER_NOT_FOUND", partnerId });
    }
    /* The membership id is resolved to its user id under the SAME partner id the
       URL names, so a member id from another organisation cannot be deactivated
       through this route even if one is guessed. */
    let row: { user_id?: string; status?: string } | undefined;
    try {
      row = rawDb()
        .prepare(`SELECT user_id, status FROM partner_team_members WHERE id = ? AND partner_id = ? LIMIT 1`)
        .get(memberId, partnerId) as typeof row;
    } catch (err) {
      return res.status(500).json({ ok: false, error: "MEMBERSHIP_LOOKUP_FAILED", message: (err as Error).message });
    }
    const userId = String(row?.user_id ?? "").trim();
    if (!userId) return res.status(404).json({ ok: false, error: "MEMBERSHIP_NOT_FOUND", memberId });

    /* NEVER A HARD DELETE. `remove()` sets status='removed' and removed_at, keeps
       the row, audits and emits. It refuses to remove the LAST managing_partner
       (LAST_MANAGING_PARTNER_CANNOT_BE_REMOVED, partnerWorkspaceStore.ts:1000)
       — surfaced as a 409 the admin can act on, not a 500. */
    let removed;
    try {
      removed = partnerTeamStore.remove(partnerId, userId, actor);
    } catch (err) {
      const message = (err as Error).message;
      if (message === "LAST_MANAGING_PARTNER_CANNOT_BE_REMOVED") {
        return res.status(409).json({ ok: false, error: message, memberId, userId });
      }
      return res.status(500).json({ ok: false, error: "DEACTIVATE_FAILED", message });
    }
    if (!removed) {
      return res.status(409).json({ ok: false, error: "MEMBERSHIP_NOT_ACTIVE", memberId, userId });
    }
    appendAdminAudit(actor, `partner:${partnerId}`, "partner.identity_binding.deactivated", {
      partnerId, userId, memberId, removedAt: removed.removedAt,
    });
    const members = w177MembershipIdentity(partnerId);
    return res.json({
      ok: true,
      partnerId,
      memberId,
      userId,
      removedAt: removed.removedAt,
      organizationName: w177OrganizationName(partnerId),
      seats: w177Seats(partnerId, contact.tier as string | undefined),
      members: members ?? [],
    });
  });

  app.post("/api/admin/partners/:partnerId/organization-name", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const partnerId = String(req.params.partnerId || "").trim();
    if (!partnerId) return badRequest(res, "partnerId required");
    const contact = getById(partnerId);
    if (!contact || contact.kind !== "consortium_partner") {
      return res.status(404).json({ ok: false, error: "PARTNER_NOT_FOUND", partnerId });
    }
    /* R148.3 item 4: `partner_organizations` is empty platform-wide, so
       `resolvePartnerName` returns null everywhere and every surface showing a
       partner falls back rather than naming it. The name is TYPED BY THE OWNER —
       deliberately NOT derived from `contact.legalName`, because an automatic
       backfill would put a guess into the field the messaging stamp reads and
       nobody would ever know it had been guessed. */
    const name = String(((req.body ?? {}) as { name?: unknown }).name ?? "").trim();
    if (!name) return badRequest(res, "name required");
    const previous = w177OrganizationName(partnerId);
    const tenantId = String((contact as { tenantId?: string }).tenantId ?? "").trim() || "tenant_platform";
    const stamp = new Date().toISOString();
    try {
      /* Additive upsert on the PRIMARY KEY. Only `name` and `updated_at` move; no
         other column of an existing row is rewritten, so a jurisdiction or
         status set elsewhere survives. */
      rawDb().prepare(
        `INSERT INTO partner_organizations (id, tenant_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      ).run(partnerId, tenantId, name, stamp, stamp);
    } catch (err) {
      return res.status(500).json({ ok: false, error: "ORGANIZATION_NAME_PERSIST_FAILED", message: (err as Error).message });
    }
    appendAdminAudit(actor, `partner:${partnerId}`, "partner.organization_name.set", {
      partnerId, previous, name,
    });
    return res.json({ ok: true, partnerId, organizationName: w177OrganizationName(partnerId), previous });
  });

  app.post("/api/admin/partners/:id/attributions", requireAdmin, (req: Request, res: Response) => {
    const { companyId, source, notes } = req.body ?? {};
    if (!isString(companyId)) return badRequest(res, "companyId required");
    /* w-partner F1(i) — the 0114 CHECK now rejects off-union sources at the DB
       layer, which would surface as an opaque 500. Validate here so the caller
       gets a 400 naming the allowed values. */
    if (source !== undefined && source !== null && !isAttributionSource(source)) {
      return badRequest(res, `source must be one of: ${ATTRIBUTION_SOURCES.join(", ")}`);
    }
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    const partnerId = String(req.params.id);
    /* WAVE 33 / CP-PIPE-06 — PROVENANCE CANNOT BE OMITTED.
       This read `source ?? "admin_manual"`. A caller who sent no source did not
       get a refusal — they got a row permanently asserting the attribution was
       an administrative decision, indistinguishable afterwards from a real one,
       in the table the spec designates the SSOT for who originated a
       relationship. Note that the validator directly above ALREADY rejected an
       *unknown* source with a 400: omission was the single case that received a
       fiction instead of an error. It is now the same refusal. */
    if (source === undefined || source === null || (typeof source === "string" && source.trim() === "")) {
      return badRequest(
        res,
        `source is required and is not assumed — one of: ${ATTRIBUTION_SOURCES.join(", ")}. An unstated source recorded as an administrative decision would fabricate provenance that later readers cannot tell from a real record.`,
      );
    }
    let a;
    try {
      a = partnerAttributionStore.create(partnerId, companyId, actor, source, notes ?? null);
    } catch (err) {
      /* CP-PIPE-06 — a refused acquisition is a 409: the request was
         well-formed, the state of the world forbids it. Nothing was written. */
      const msg = (err as Error).message ?? "";
      if (msg.startsWith("PROVENANCE_REFUSED:")) {
        return res.status(409).json({
          error: "PROVENANCE_REFUSED",
          verdict: (err as Error & { verdict?: string }).verdict ?? null,
          message: msg.slice(msg.indexOf(": ") + 2),
        });
      }
      throw err;
    }
    // v25.14 NM2 — notify the partner's managing_partner team members so
    // they don't have to poll the admin attribution page to discover a
    // newly-granted attribution.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { emitNotification } = require("./notificationsStore");
      const team = partnerTeamStore.listByPartner(partnerId);
      for (const tm of team) {
        if (tm.subRole === "managing_partner" && tm.status === "active") {
          try {
            emitNotification({
              userId: tm.userId,
              kind: "partner.attribution_granted",
              title: "New company attribution granted",
              body: `Your partner workspace was granted attribution for company ${companyId}.`,
              link: "/collective/partner/pipeline",
            });
          } catch { /* per-recipient failures non-fatal */ }
        }
      }
    } catch { /* notification optional; attribution itself already persisted */ }
    res.status(201).json({ attribution: a });
  });

  app.delete("/api/admin/partners/:id/attributions/:companyId", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    const partnerId = String(req.params.id);
    const companyId = String(req.params.companyId);
    try {
      /* w-partner F1(g) — STRICT. This is the deliberate admin revoke; unlike
         the unlink path there is no already-severed link to strand, so a
         durable-write failure must fail closed rather than leave the caller
         believing a revocation was recorded. */
      const a = partnerAttributionStore.revoke(partnerId, companyId, actor, { strict: true });
      // v25.14 NM2 — notify the partner's managing_partner team members
      // about revocation as well.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { emitNotification } = require("./notificationsStore");
        const team = partnerTeamStore.listByPartner(partnerId);
        for (const tm of team) {
          if (tm.subRole === "managing_partner" && tm.status === "active") {
            try {
              emitNotification({
                userId: tm.userId,
                kind: "partner.attribution_revoked",
                title: "Company attribution revoked",
                body: `Attribution for company ${companyId} was revoked from your partner workspace.`,
                link: "/collective/partner/pipeline",
              });
            } catch { /* per-recipient failures non-fatal */ }
          }
        }
      } catch { /* notification optional */ }
      res.json({ attribution: a });
    } catch (e) {
      /* w-partner F1(g) — a strict persist failure is NOT a missing row;
         reporting it as 404 would tell the admin the attribution never
         existed while it is in fact still live. */
      const msg = (e as Error).message ?? "";
      if (msg.startsWith("ATTRIBUTION_REVOKE_PERSIST_FAILED")) {
        return res.status(500).json({ error: "ATTRIBUTION_REVOKE_FAILED" });
      }
      res.status(404).json({ error: "ATTRIBUTION_NOT_FOUND" });
    }
  });

  /* ============================================================
   * PARTNER workspace endpoints — /api/partner/me/*
   * ============================================================ */

  /* GROUP F3 — `/me` is the ONE bootstrap read behind `requirePartnerSelf`
   * (the ONLY relaxation vs requirePartnerAuth is dropping the status==='active'
   * check) so a SUSPENDED partner can still load THIS route to see a status
   * banner. It grants NO data and NO writes; every OTHER /api/partner/me/*
   * route below keeps hard requirePartnerAuth. The payload is extended
   * ADDITIVELY: `status`, `commissionPct` (DISPLAY-ONLY — derived from the
   * EXISTING effectivePlan.commission.rate; no calc/ledger/payment change),
   * `partnerType`, `region`. Existing keys are unchanged. */
  app.get("/api/partner/me", requirePartnerSelf, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    /* GROUP C (C5) — dynamic effective plan drives the partner FE. Read-only
     * composition of the EXISTING resolvers. Fail-closed pricing throws
     * EffectivePlanError; we surface effectivePlan: null (never break /me) so a
     * mis-configured tier degrades gracefully rather than 500-ing the session. */
    let effectivePlan: ReturnType<typeof resolvePartnerEffectivePlan> | null = null;
    /* WAVE 56b — ADDITIVE. Why the session bootstrap could 500, and why it no
       longer does: `resolvePartnerEffectivePlan` calls `resolveCommissionRate`,
       which since Wave 56 THROWS `UnknownCommissionTierError` for a tier with
       no configured rate. That is not an `EffectivePlanError`, so the catch
       below rethrew it and Express answered a bare 500 on /api/partner/me —
       the partner's whole workspace failed to load, not one figure. The session
       now loads, `effectivePlan` stays null (no rate is guessed), and the
       reason is stated by NAME in this additive field rather than left as an
       unexplained null. Existing keys are untouched. */
    let effectivePlanError: { code: string; tier: string; message: string } | null = null;
    try {
      effectivePlan = resolvePartnerEffectivePlan(ctx.partnerId, ctx.tier);
    } catch (err) {
      if (isUnknownCommissionTierError(err)) {
        effectivePlan = null;
        effectivePlanError = {
          code: "PARTNER_COMMISSION_RATE_UNRESOLVED",
          tier: String(ctx.tier),
          message: (err as Error).message,
        };
        log.warn(
          `[partner] /me effective plan unavailable: no commission rate configured for tier=${String(ctx.tier)} ` +
            `partner=${ctx.partnerId} — set it in Admin \u2192 Fees & Billing \u2192 "Consortium Partner Promotions" \u2192 "Partner commission rates"`,
        );
      } else {
        if (!(err instanceof EffectivePlanError)) throw err;
        effectivePlan = null;
      }
    }
    /* Read admin-set reconciliation fields from the EXISTING partner contact
     * record (getById) — no new store, no body/query input. */
    const partner = getById(ctx.partnerId);
    const status = partner?.status ?? null;
    const partnerType = partner?.partnerType ?? null;
    const region = partner?.region ?? null;
    /* commissionPct is DISPLAY-ONLY: it renders the SAME commission rate the
     * existing resolver already returns (rate is a fraction, e.g. 0.12), scaled
     * to a percent for the FE. It NEVER drives any calculation, ledger or
     * payment path. null when no effective plan resolved (mis-config). */
    const commissionPct =
      effectivePlan ? effectivePlan.commission.rate * 100 : null;
    /* WAVE 7B FE-14 (DEF-060) — subscription STATE, additive and display-only.
     *
     * The dashboard printed the resolved tier price under the fixed heading
     * "Your subscription" for every partner. For a partner with no
     * `contacts.subscription_id` — a Path-1 partner, who is not billed a
     * subscription at all (server/lib/partnerSelfServiceRoutes.ts:106-124
     * returns `subscription: null` for exactly that case) — that heading is a
     * false statement about money: the number shown is the tier's ADVERTISED
     * price, not anything they pay.
     *
     * Resolved HERE rather than by having the dashboard call
     * /api/partner/me/subscription, because that route is gated to
     * `managing_partner` and every other sub-role would get a 403 and fall
     * back to the same wrong label. This is the ONE bootstrap read every
     * partner sub-role can already make, and it already reads the same
     * `contacts` row via getById(). No new store, no new auth surface, no new
     * query — one extra column off a row that is already loaded.
     *
     * DISPLAY-ONLY: nothing branches on this for pricing, billing, ledgers,
     * entitlement or access. It only chooses a label. */
    const subscriptionState: "subscribed" | "unsubscribed" | "unknown" = (() => {
      try {
        const row = rawDb()
          .prepare(`SELECT subscription_id FROM contacts WHERE id = ?`)
          .get(ctx.partnerId) as { subscription_id?: string | null } | undefined;
        if (!row) return "unknown";
        return row.subscription_id ? "subscribed" : "unsubscribed";
      } catch {
        /* Never break /me over a label. */
        return "unknown";
      }
    })();
    res.json({
      partnerId: ctx.partnerId,
      tier: ctx.tier,
      subRole: ctx.partnerSubRole,
      identity: { userId: ctx.userId, email: ctx.email, name: ctx.name },
      effectivePlan,
      /* WAVE 56b — additive: names the reason effectivePlan is null. */
      effectivePlanError,
      status,
      commissionPct,
      partnerType,
      region,
      subscriptionState,
    });
  });

  app.get("/api/partner/me/dashboard", requirePartnerAuth, (req: Request, res: Response) => {
    res.json(partnerDashboardSnapshot(req.partnerContext!.partnerId));
  });

  // CLIENTS — W2-A restore. The read-only `GET /api/partner/me/clients` +
  // `/clients/:id` surface was trimmed in v25.50.0 Phase 6 (spec 4a) WITHOUT
  // authorization (rule #78) while the entire data model, CRM engine, writes,
  // attribution store, dashboard count and boot hydration were DELIBERATELY
  // PRESERVED. These two endpoints are rebuilt from the preserved
  // partnerAttributionStore; both are read-only, requirePartnerAuth, and
  // fail-closed on attribution (the `:id` route 404s on any company not
  // attributed to THE SESSION's partner — never the URL — so there is no
  // cross-partner read). Shapes match what PartnerClients.tsx /
  // PartnerClientDetail.tsx consume.
  app.get("/api/partner/me/clients", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const clients = partnerAttributionStore
      .listByPartner(pid)
      .map((a) => ({
        id: a.id,
        companyId: a.companyId,
        /* w-partner F1(d) — the list rendered raw company ids because the
           name was never joined in. Additive field; the id stays. */
        companyName: getCompanyRecordById(a.companyId)?.companyName ?? null,
        attributionSource: a.attributionSource,
        attributedAt: a.attributedAt,
      }));
    res.json({ clients });
  });

  app.get("/api/partner/me/clients/:id", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = String(req.params.id);
    // Fail-closed: the company must be attributed to THIS partner. A miss
    // returns 404 without leaking whether the company exists elsewhere.
    const attribution = partnerAttributionStore
      .listByPartner(pid)
      .find((a) => a.companyId === companyId);
    if (!attribution) {
      return res.status(404).json({ error: "CLIENT_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    }
    const rec = getCompanyRecordById(companyId);
    const profile = getCompanyProfile(companyId);
    const snapshot = {
      sector: rec?.sector ?? null,
      stage: rec?.stage ?? null,
      valuationMinor: profile?.valuationMinor ?? null,
      lastRaiseAmount: profile?.lastRaiseAmount ?? null,
      lastRaiseDate: profile?.lastRaiseDate ?? null,
    };
    const notes = partnerNotesStore
      .listByPartner(pid, { scope: "client", scopeId: companyId })
      .map((n) => ({ id: n.id, title: n.title, body: n.body }));
    res.json({
      companyId,
      snapshot,
      attribution: { attributionSource: attribution.attributionSource, attributedAt: attribution.attributedAt },
      notes,
    });
  });

  /* ══ WAVE 179 · ITEM A · R151.1 — THE VEHICLES A MANAGED CLIENT ALREADY HAS ══
     R151.1 asks for a "Create SPV for this managed client" affordance whose result
     is READ BACK FROM PERSISTED DATA, not shown from an optimistic mutation
     response. Nothing could answer "which of my vehicles target this company":
     `spv.target_company_id` was written and read back per-SPV, but no route
     queried BY company. This is that read, and it is the only new read the
     affordance needs.

     DERIVES NOTHING. It filters `spvEngineStore.listByPartner` — the same store
     call the partner's own SPV list uses — on the persisted `targetCompanyId`.
     No figure is computed here.

     FAIL-CLOSED ON ATTRIBUTION, exactly like `/clients/:id` above and for the same
     reason: the company must be attributed to THE SESSION's partner, never to
     whoever the URL names, and a miss is a 404 that does not reveal whether the
     company exists elsewhere. `listByPartner` is already partner-scoped, so even a
     hypothetical attribution bug could not surface another partner's vehicle. */
  app.get("/api/partner/me/clients/:id/spvs", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = String(req.params.id);
    const attribution = partnerAttributionStore
      .listByPartner(pid)
      .find((a) => a.companyId === companyId);
    if (!attribution) {
      return res.status(404).json({ error: "CLIENT_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    }
    const spvs = spvEngineStore
      .listByPartner(pid)
      .filter((s) => s.targetCompanyId === companyId && !s.archivedAt)
      .map((s) => ({
        id: s.id,
        name: s.name,
        spvType: s.spvType,
        status: s.status,
        jurisdiction: s.jurisdiction,
        currency: s.currency,
        targetRaiseMinor: s.targetRaiseMinor,
        targetCompanyId: s.targetCompanyId,
        createdAt: s.createdAt,
      }));
    res.json({ companyId, spvs });
  });

  // PIPELINE
  app.get("/api/partner/me/pipeline", requirePartnerAuth, (req: Request, res: Response) => {
    res.json({ pipeline: partnerPipelineStore.listByPartner(req.partnerContext!.partnerId), stages: ALL_PIPELINE_STAGES });
  });

  // v25.50.0 Phase 2 (spec 2b) — "Following from Collective": companies this
  // partner (as a Collective member) has opened interest threads on. Read-only;
  // the UI links each row to the Collective company page in a new tab.
  app.get("/api/partner/me/following", requirePartnerAuth, (req: Request, res: Response) => {
    const userId = req.partnerContext!.userId;
    const companyIds = listFollowedCompanyIdsForMember(userId);
    const following = companyIds.map((companyId) => {
      const rec = getCompanyRecordById(companyId);
      return {
        companyId,
        companyName: rec?.companyName ?? null,
        logoUrl: rec?.logoUrl ?? null,
      };
    });
    res.json({ following });
  });

  // ============================================================
  // v25.50.0 Phase 3 (spec 3) — PRIVATE PORTFOLIO company profiles.
  // CP-scoped, non-sacred. Reuses the founder CompanyProfile taxonomy
  // (contact/address/legal/ma) via companyProfilePatchSchema, stored per
  // (partnerId, companyId) in partner_portfolio_company. Never touches the
  // sacred founder profile stores.
  // ============================================================

  /**
   * W1 H3/H4 (v26.2.0) — Partner↔company relationship proof for the portfolio
   * detail/upsert routes. Without this, GET leaked global company name/logo for
   * ANY companyId (enumeration) and PATCH created a private portfolio row for any
   * global company. A partner may access a company's portfolio only via a durable
   * relationship. Following (member personal interest) is intentionally NOT a proof.
   * Returns 404 (not 403) on failure so the route cannot be used as an existence oracle.
   */
  /* WAVE 179 · ITEM A · R151.1 — THE SIX PROOFS MOVED, NOT COPIED.
     The body of this predicate now lives in `lib/partnerCompanyLinkGate.ts` so
     that `spvEngineRoutes.ts` can gate a partner-supplied `targetCompanyId`
     against the SAME derivation instead of against a second copy of it. This
     name, its signature and its 404-not-403 contract are unchanged, and every
     existing caller below is untouched. */
  const partnerCanAccessCompanyPortfolio = (partnerId: string, companyId: string): boolean =>
    partnerHasCompanyRelationship(partnerId, companyId);

  // List all private-portfolio company profiles for this partner.
  app.get("/api/partner/me/portfolio", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    /* WAVE 230D · R230.2 — the partner portfolio is the surface on which "Test
       f", "SD-TEST Wave X Co", "Kestrel Holdings Ltd" and "Live Audit Client
       Ltd" are rendered side by side with real holdings. Marked records drop out
       here PER RECORD; the partner's relationship rows, the profiles and the
       companies themselves are untouched, and unmarking restores them. With
       nothing marked the set is empty and the list is byte-identical. */
    const w230Hidden = wave230HiddenCompanyIds();
    const items = listPortfolioCompanies(ctx.partnerId)
      .filter((p) => wave230CompanyVisible(w230Hidden, p.companyId))
      .map((p) => {
      const rec = getCompanyRecordById(p.companyId);
      return {
        companyId: p.companyId,
        companyName: rec?.companyName ?? null,
        logoUrl: rec?.logoUrl ?? null,
        profile: p.profile,
        updatedAt: p.updatedAt,
      };
    });
    res.json({ portfolio: items });
  });

  // Read a single private-portfolio profile.
  app.get("/api/partner/me/portfolio/:companyId", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    const companyId = String(req.params.companyId);
    // W1 H3 — require relationship BEFORE exposing any global company metadata.
    if (!partnerCanAccessCompanyPortfolio(ctx.partnerId, companyId)) {
      return res.status(404).json({ error: "PORTFOLIO_COMPANY_NOT_FOUND" });
    }
    const p = getPortfolioCompany(ctx.partnerId, companyId);
    const rec = getCompanyRecordById(companyId);
    res.json({
      companyId,
      companyName: rec?.companyName ?? null,
      logoUrl: rec?.logoUrl ?? null,
      profile: p?.profile ?? {},
      updatedAt: p?.updatedAt ?? null,
    });
  });

  // Upsert (create-or-merge) the partner's private profile for a company.
  app.patch(
    "/api/partner/me/portfolio/:companyId",
    requirePartnerAuth,
    // w-partner F-new2 — `bd` can already CREATE a portfolio company
    // (partnerPortfolioCompanyRoutes.ts:39); the shared constant keeps the
    // server guard and the client canEdit predicate from re-diverging.
    assertSubRole(...PORTFOLIO_PROFILE_WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const companyId = String(req.params.companyId);
      // W1 H4 — require relationship BEFORE body validation (no validation oracle) or upsert.
      if (!partnerCanAccessCompanyPortfolio(ctx.partnerId, companyId)) {
        return res.status(404).json({ error: "PORTFOLIO_COMPANY_NOT_FOUND" });
      }
      // w-partner F2-b — surface FIELD-LEVEL issues. A single bad value (e.g. a
      // free-text industry) previously 400'd the whole patch and silently
      // discarded all four sections with no indication of the offending field.
      const parsed = parsePortfolioPatchDetailed(req.body ?? {});
      if (!parsed.ok) {
        return res.status(400).json({ error: "INVALID_PROFILE_PATCH", details: parsed.issues });
      }
      const patch = parsed.data;
      try {
        const saved = upsertPortfolioProfile(ctx.partnerId, companyId, patch, ctx.userId);
        res.json({ companyId, profile: saved.profile, updatedAt: saved.updatedAt });
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    },
  );

  // Remove a company from the partner's private portfolio (soft-delete).
  app.delete(
    "/api/partner/me/portfolio/:companyId",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const companyId = String(req.params.companyId);
      try {
        const ok = archivePortfolioCompany(ctx.partnerId, companyId);
        if (!ok) return res.status(404).json({ error: "PORTFOLIO_NOT_FOUND" });
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    },
  );

  app.post(
    "/api/partner/me/pipeline",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { dealName, companyId, stage, estCheckSizeMinor, currency, sector, geography, expectedClose, notes } = req.body ?? {};
      if (!isString(dealName)) return badRequest(res, "dealName required");
      try {
        const deal = partnerPipelineStore.create(ctx.partnerId, {
          dealName,
          companyId: companyId ?? null,
          stage: stage ?? "invited",
          estCheckSizeMinor: isNumber(estCheckSizeMinor) ? estCheckSizeMinor : null,
          currency: currency ?? null,
          sector: sector ?? null,
          geography: geography ?? null,
          ownerUserId: ctx.userId,
          expectedClose: expectedClose ?? null,
          notes: notes ?? null,
        }, ctx.userId);
        res.status(201).json({ deal });
      } catch (e) {
        badRequest(res, (e as Error).message);
      }
    },
  );

  app.patch(
    "/api/partner/me/pipeline/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        /* WAVE 198 · ITEM D-2 — asserted BEFORE the update. Only the keys the store
           forces in its own spread tail are refused: a value sent for those is
           overwritten in the same statement that writes it, so accepting it and
           answering 200 told the partner their change had saved when it had not.
           Every other key is left alone, because `persistEntry` JSON-encodes the
           whole object and an unrecognised key durably round-trips — refusing it
           would block a write that works today. Handled inside this try, and
           discriminated first, so `DEAL_NOT_FOUND` and `INVALID_STAGE` keep their
           existing 404. */
        assertPartnerPipelinePatchFullyApplied(req.body ?? {});
        const deal = partnerPipelineStore.update(ctx.partnerId, String(req.params.id), req.body ?? {}, ctx.userId);
        res.json({ deal });
      } catch (e) {
        if (isPartnerPatchUnappliedError(e)) {
          return res.status(400).json({
            error: PARTNER_PATCH_UNAPPLIED_CODE,
            refusalHeadline: e.refusalHeadline,
            refusalGuidance: e.refusalGuidance,
            message: e.refusalHeadline,
            unappliedFields: e.unappliedFields,
          });
        }
        res.status(404).json({ error: (e as Error).message });
      }
    },
  );

  app.delete(
    "/api/partner/me/pipeline/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        partnerPipelineStore.archive(ctx.partnerId, String(req.params.id), ctx.userId);
        res.json({ ok: true });
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
      }
    },
  );

  app.post(
    "/api/partner/me/pipeline/:id/activities",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { activityType, body } = req.body ?? {};
      if (!isString(activityType) || !isString(body)) return badRequest(res, "activityType+body required");
      // Verify deal belongs to partner
      const deal = partnerPipelineStore.getById(ctx.partnerId, String(req.params.id));
      if (!deal) return res.status(404).json({ error: "DEAL_NOT_FOUND" });
      const validActivityTypes = ["email", "note", "call", "meeting", "stage_change"] as const;
      if (!validActivityTypes.includes(activityType as typeof validActivityTypes[number])) {
        return badRequest(res, "activityType must be one of " + validActivityTypes.join("|"));
      }
      const a = partnerPipelineActivityStore.add(String(req.params.id), activityType as typeof validActivityTypes[number], body, ctx.userId);
      res.status(201).json({ activity: a });
    },
  );

  /* WAVE 27 · CP-PIPE-04 — the read half of the pipeline activity log.

     THE GAP. `partnerPipelineActivityStore.listForPipeline` exists at
     `server/partnerWorkspaceStore.ts:2261` with NO route and NO client caller
     anywhere in the tree — an engine with no door, which the standing rules say
     is not shipped. Until now the log was WRITE-ONLY: the POST above records
     email/note/call/meeting entries, and `partnerWorkspaceStore.ts:2155` also
     writes a `stage_change` entry every time a deal moves stage, so partners
     have been silently accumulating deal history that nothing could ever read
     back. Data written and never surfaced is the same defect as data dropped.

     OWNERSHIP GUARD — note this is NOT redundant. `listForPipeline` filters on
     `pipelineId` ALONE; it has no notion of a partner. Exposing it without
     first resolving the deal through `partnerPipelineStore.getById(ctx.partnerId,
     ...)` would let any authenticated partner read any other partner's deal
     history by guessing an id. The POST above already guards this way and the
     GET must match it exactly — same lookup, same 404, so a foreign id is
     indistinguishable from a missing one and the route cannot be used to probe
     for the existence of other partners' deals.

     Sub-roles are deliberately WIDER than the writer: `viewer` may read the log
     but still cannot append to it.

     Ordering: newest first, tie-broken by id so the sequence is stable across
     calls when two entries share an `occurredAt` (the stage-change writer and a
     manual note can land in the same millisecond). */
  app.get(
    "/api/partner/me/pipeline/:id/activities",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd", "viewer"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const dealId = String(req.params.id);
      const deal = partnerPipelineStore.getById(ctx.partnerId, dealId);
      if (!deal) return res.status(404).json({ error: "DEAL_NOT_FOUND" });
      const activities = partnerPipelineActivityStore
        .listForPipeline(dealId)
        .slice()
        .sort((a, b) =>
          a.occurredAt === b.occurredAt
            ? b.id.localeCompare(a.id)
            : b.occurredAt.localeCompare(a.occurredAt),
        );
      res.json({ activities });
    },
  );

  // ============================================================
  // PROMOTIONS / REFERRALS (Promote-to-Collective + Refer-to-Capavate)
  // ============================================================

  // POST /api/partner/me/pipeline/:id/promote-to-collective
  // Promotes a partner-owned pipeline deal to the Collective Deal Room.
  /* WAVE 213 — the previous comment here said "Goes live immediately", which is
   * false and is one of the four ways the wave-213 brief's description of this
   * feature was wrong. `partnerDealPromotionsStore.create` writes
   * status="pending_collective_review" / moderationStatus="pending"; visibility
   * begins only when a chapter admin approves in promotionModerationRoutes.ts,
   * which is what calls ensurePromotionDirectoryListing. Corrected because a
   * false comment is how the misdescription propagated. */
  // Pending Collective review; becomes visible only on admin approval.
  // Idempotent via PromotionConflictError -> 409.
  /* WAVE 213 · GOVERNING CLAUSE AT THE POINT IT GOVERNS.
   * A partner publishes a THIRD PARTY's company profile — revenue, margin,
   * cap-table summary, readiness scores, recent activity — to a chapter of
   * investors, with their own firm named as the source, and the company is never
   * told. Before this wave the request carried `{notes?}` and the screen showed
   * no term at all. The acknowledgement is now REQUIRED HERE, on the server, so a
   * disabled button is not the control: a direct API call without it is refused.
   *
   * The text is re-derived from `shared/wave213PublishGoverningClause.ts` rather
   * than trusted from the request, so the recorded sentence is the shipped
   * sentence. `deal.dealName` is the subject because it is what the partner reads
   * on the screen AND what this route holds, so both sides produce identical
   * bytes; the audit row additionally carries companyId and the registered
   * company name, so the evidence identifies the real company.
   *
   * R190.10 — THIS ADDS NO BARRIER. assertSubRole and requireSignedAgreement are
   * unchanged, no field is withheld, no audience is narrowed, and the only new
   * refusal is cleared by one tick on the same screen. */
  app.post(
    "/api/partner/me/pipeline/:id/promote-to-collective",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const dealId = String(req.params.id);
      // Verify deal is owned by this partner (URL injection guard)
      const deal = partnerPipelineStore.getById(ctx.partnerId, dealId);
      if (!deal) return res.status(404).json({ error: "DEAL_NOT_FOUND" });
      // Wave B2 (3b) INVARIANT — a company must exist ON CAPAVATE (so its cap-table
      // and rounds management are operating) BEFORE it can be published to the
      // Collective. A bare name-only pipeline deal has no linked Capavate company
      // (no companyId / no company record), so promotion is refused with guidance
      // to add it as a real portfolio company first (Wave B1 "Add Portfolio
      // Company" creates the Capavate company + cap table + rounds surface).
      if (!deal.companyId || !getCompanyRecordById(deal.companyId)) {
        return res.status(409).json({
          error: "COMPANY_NOT_ON_CAPAVATE",
          message: "This deal is not yet a company on Capavate. Add it as a portfolio company (so its cap table and rounds are operating) before publishing to the Collective.",
        });
      }
      const { notes } = (req.body ?? {}) as { notes?: unknown };

      /* ── WAVE 213 · the acknowledgement, enforced before anything is written ──
       * Presence and TYPE are established first, and only then is anything
       * compared. A missing or non-string value never reaches the equality check,
       * so `undefined` can never be compared as though it were the sentence. */
      const ackRaw = (req.body ?? {}) as Record<string, unknown>;
      const ackEnvelope = ackRaw[PUBLISH_ACK_FIELD];
      const ack =
        ackEnvelope !== null && typeof ackEnvelope === "object"
          ? (ackEnvelope as Record<string, unknown>)
          : null;
      const ackVersion = ack ? ack.clauseVersion : undefined;
      const ackText = ack ? ack.text : undefined;
      if (!ack || !isString(ackVersion) || !isString(ackText)) {
        return res.status(400).json({
          error: "PUBLISH_ACKNOWLEDGEMENT_REQUIRED",
          message: PUBLISH_ACK_MISSING_MESSAGE,
        });
      }
      /* The sentence the platform SHIPS, rebuilt here. Never the client's copy. */
      const expectedAckText = publishAcknowledgementText(deal.dealName);
      if (ackVersion !== PUBLISH_CLAUSE_VERSION || ackText !== expectedAckText) {
        return res.status(400).json({
          error: "PUBLISH_ACKNOWLEDGEMENT_STALE",
          message: PUBLISH_ACK_STALE_MESSAGE,
        });
      }

      try {
        const p = partnerDealPromotionsStore.create(
          ctx.partnerId,
          dealId,
          {
            promotionType: "collective_deal_room",
            companyId: deal.companyId,
            notes: isString(notes) ? notes : null,
          },
          ctx.userId,
        );
        /* ── WAVE 213 · RECORD THE ACKNOWLEDGEMENT ─────────────────────────────
         * Wave 186's writer, into the platform's existing append-only,
         * hash-chained `audit_log` — the same store this route already writes
         * `partner.deal_promotion.created` into. NO second consent store and NO
         * second audit path.
         *
         * WHY NOT `legal_consents`. Structurally impossible without becoming a
         * second consent shape: its `documentId` is a five-value union with no id
         * that names publishing, its `documentVersion` is forced to the single
         * global LEGAL_VERSION so "PUBLISH-v1" cannot be recorded, it has no
         * field for the subject company, and `recordConsent` is idempotent on
         * (tenant, user, doc, version) — so the SECOND company a partner
         * published would produce no row at all. A per-event acknowledgement
         * cannot live in a per-document idempotent store.
         *
         * The audit write does NOT gate the business effect: wave 186 settled
         * that a failed audit must be reported loudly rather than turned into an
         * unaudited commitment plus a 500. It is safe here because the
         * acknowledgement was already ENFORCED above — no code path creates this
         * promotion without having matched the sentence first — so a lost audit
         * row loses evidence, never the control. */
        const ackEntry = appendAdminAudit(
          ctx.userId,
          `promotion:${p.id}`,
          "partner.deal_promotion.publish_disclosure_acknowledged",
          {
            promotionId: p.id,
            partnerId: ctx.partnerId,
            pipelineDealId: dealId,
            dealName: deal.dealName,
            companyId: deal.companyId,
            /* The company's own registered name, resolved from the record the
               route already looked up above. Kept ALONGSIDE dealName because the
               acknowledgement names the deal as the partner sees it, while the
               evidence must identify the real company. `?? null` because an
               unresolvable name is recorded as absent, never as an empty string
               that a later reader could compare as if it were a name. */
            companyName: getCompanyRecordById(deal.companyId)?.companyName ?? null,
            clauseId: PUBLISH_CLAUSE_ID,
            clauseVersion: PUBLISH_CLAUSE_VERSION,
            acknowledgementText: expectedAckText,
            ip: resolveRateLimitClientIp(req), /* WAVE 22 · ITEM 2 — trusted-hop resolution, never the raw header */
          },
        );
        reportAuditWriteOutcome(ackEntry, {
          bearing: "identity",
          action: "partner.deal_promotion.publish_disclosure_acknowledged",
          route: "POST /api/partner/me/pipeline/:id/promote-to-collective",
          subject: `promotion:${p.id}`,
        });
        res.status(201).json({ promotion: p });
      } catch (e) {
        if (e instanceof PromotionConflictError) {
          return res.status(409).json({ error: "PROMOTION_CONFLICT", message: e.message });
        }
        throw e;
      }
    },
  );

  // POST /api/partner/me/pipeline/:id/refer-to-capavate
  // Refers a partner-owned pipeline deal to Capavate for review.
  // Status=pending; an admin must approve via /api/admin/partner-referrals/:id/approve.
  app.post(
    "/api/partner/me/pipeline/:id/refer-to-capavate",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const dealId = String(req.params.id);
      const deal = partnerPipelineStore.getById(ctx.partnerId, dealId);
      if (!deal) return res.status(404).json({ error: "DEAL_NOT_FOUND" });
      const { targetEmail, targetCompanyId, notes } = (req.body ?? {}) as {
        targetEmail?: unknown;
        targetCompanyId?: unknown;
        notes?: unknown;
      };
      try {
        const p = partnerDealPromotionsStore.create(
          ctx.partnerId,
          dealId,
          {
            promotionType: "capavate_referral",
            companyId: isString(targetCompanyId) ? targetCompanyId : (deal.companyId ?? null),
            targetEmail: isString(targetEmail) ? targetEmail : null,
            notes: isString(notes) ? notes : null,
          },
          ctx.userId,
        );
        res.status(201).json({ promotion: p });
      } catch (e) {
        if (e instanceof PromotionConflictError) {
          return res.status(409).json({ error: "PROMOTION_CONFLICT", message: e.message });
        }
        throw e;
      }
    },
  );

  // GET /api/partner/me/promotions — list the calling partner's promotions
  app.get("/api/partner/me/promotions", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    res.json({ promotions: partnerDealPromotionsStore.listByPartner(ctx.partnerId) });
  });

  // POST /api/partner/me/promotions/:id/withdraw — managing_partner only
  app.post(
    "/api/partner/me/promotions/:id/withdraw",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const promoId = String(req.params.id);
      const existing = partnerDealPromotionsStore.getById(promoId);
      if (!existing) return res.status(404).json({ error: "PROMOTION_NOT_FOUND" });
      if (existing.partnerId !== ctx.partnerId) {
        // Cross-partner isolation guard
        return res.status(404).json({ error: "PROMOTION_NOT_FOUND" });
      }
      try {
        const p = partnerDealPromotionsStore.withdraw(ctx.partnerId, promoId, ctx.userId);
        res.json({ promotion: p });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return res.status(400).json({ error: "WITHDRAW_FAILED", message: msg });
      }
    },
  );

  // ============================================================
  // ADMIN: Partner Referrals (Capavate review queue)
  // ============================================================

  // GET /api/admin/partner-referrals — list pending capavate referrals
  app.get("/api/admin/partner-referrals", requireAdmin, (_req: Request, res: Response) => {
    res.json({ referrals: partnerDealPromotionsStore.listPendingCapavateReferrals() });
  });

  // POST /api/admin/partner-referrals/:id/approve
  app.post("/api/admin/partner-referrals/:id/approve", requireAdmin, (req: Request, res: Response) => {
    const promoId = String(req.params.id);
    const u = getUserContext(req);
    try {
      const p = partnerDealPromotionsStore.approve(promoId, u.userId);
      // v25.14 F3-NC1 — the referral approve path used to ONLY flip status
      // to "live" and write an audit row. The downstream Capavate referral
      // (founder invite + provisional attribution + cross-component bridge
      // event + recipient notification) never fired. We now do all four,
      // in best-effort try/catch so a failure in any one does not block
      // the approval itself (which is already persisted).
      try {
        if (p.promotionType === "capavate_referral" && p.targetEmail) {
          // 1. Provisional attribution: if a company is named on the
          //    referral, write an attribution row so the partner gets
          //    credit the moment the founder signs up against the same
          //    companyId. If only an email is known, write a
          //    provisional row keyed by email so the founder signup
          //    flow can promote it later.
          try {
            if (p.companyId) {
              // v25.14 — source must be a member of the attributionSource
              // union: admin_manual | referral_code | partner_claim.
              partnerAttributionStore.create(
                p.partnerId,
                p.companyId,
                u.userId,
                "partner_claim",
                `Referral promotion ${p.id} approved; targetEmail=${p.targetEmail}`,
              );
            } else {
              /* v25.16 cross-comp NM1 — email-only referral: persist a
                 provisional attribution row keyed by lowercased email so the
                 founder signup flow can promote it to a real attribution
                 when that account is created. Stored via the kv shim
                 (provisionalPartnerAttributions) so it survives restart
                 without requiring a new DB migration. */
              try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { persistEntry } = require("./lib/storePersistenceShim");
                const key = `${p.targetEmail.toLowerCase()}::${p.partnerId}`;
                persistEntry("provisionalPartnerAttributions", key, {
                  email: p.targetEmail.toLowerCase(),
                  partnerId: p.partnerId,
                  promotionId: p.id,
                  source: "partner_claim",
                  approvedBy: u.userId,
                  approvedAt: new Date().toISOString(),
                });
              } catch { /* non-fatal */ }
            }
          } catch { /* attribution may already exist; non-fatal */ }

          // 2. In-app notification to the target if they already have an
          //    account on the platform.
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { emitNotification } = require("./notificationsStore");
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { rawDb } = require("./db/connection");
            const db = rawDb();
            const row = db
              .prepare("SELECT user_id FROM user_credentials WHERE email = ? LIMIT 1")
              .get(p.targetEmail) as { user_id?: string } | undefined;
            if (row?.user_id) {
              emitNotification({
                userId: row.user_id,
                kind: "partner.referral_received",
                title: "You've been referred to Capavate",
                body: `A Consortium Partner has referred you to Capavate. Sign in or sign up to claim your invite.`,
                link: "/founder/dashboard",
              });
            }
          } catch { /* notification optional; non-fatal */ }

          // 3. Bridge event so Capavate / Collective downstream surfaces
          //    can react to the approved referral.
          try {
            emitBridgeEvent({
              eventType: "partner.referral.approved",
              aggregateId: p.id,
              aggregateKind: "platform",
              payload: {
                promotionId: p.id,
                partnerId: p.partnerId,
                targetEmail: p.targetEmail,
                companyId: p.companyId ?? null,
                approvedBy: u.userId,
              },
            });
          } catch { /* bridge optional */ }

          // 4. Best-effort outbound invite email. The sendEmail stub
          //    silently no-ops if SMTP is not configured.
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { sendEmail } = require("./lib/emailSender");
            const inviteUrl = `${(process.env.PUBLIC_BASE_URL ?? "https://capavate.com")}/auth/signup?ref=partner&promoId=${encodeURIComponent(p.id)}&email=${encodeURIComponent(p.targetEmail)}`;
            sendEmail({
              to: p.targetEmail,
              subject: "You've been referred to Capavate",
              text:
                `Hello,\n\nA Consortium Partner has referred you to Capavate. ` +
                `Use the link below to claim your invite:\n\n${inviteUrl}\n\nThanks,\nCapavate Team`,
            });
          } catch { /* email optional */ }
        }
      } catch { /* swallow — approval itself already succeeded */ }
      res.json({ promotion: p });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(400).json({ error: "APPROVE_FAILED", message: msg });
    }
  });

  // POST /api/admin/partner-referrals/:id/reject
  app.post("/api/admin/partner-referrals/:id/reject", requireAdmin, (req: Request, res: Response) => {
    const promoId = String(req.params.id);
    const u = getUserContext(req);
    const { reason } = (req.body ?? {}) as { reason?: unknown };
    if (!isString(reason)) return badRequest(res, "reason required");
    try {
      const p = partnerDealPromotionsStore.reject(promoId, u.userId, reason);
      res.json({ promotion: p });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(400).json({ error: "REJECT_FAILED", message: msg });
    }
  });

  // TEAM
  app.get("/api/partner/me/team", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    /* v25.16 NL1 — expose `email` alias alongside `invitedEmail` so callers
       using either name see the address. v25.16 NH5 — listByPartner now
       filters redeemed/expired by default. */
    const invitations = partnerInvitationStore.listByPartner(pid).map((inv) => ({
      ...inv,
      email: inv.invitedEmail,
    }));
    /* v25.50 Phase 7 (7a) — the store returns raw userIds with no identity. JOIN
       the canonical `users` table so the UI can render real name/email instead
       of the opaque id. Read-only; the sacred users store is never mutated.
       (7c) Merge partner-workspace-local contact overrides (mobile, contact
       email, position note) from the additive partner_team_member_contact
       table. */
    // W3.5 — collapse historical duplicate active seats for the same
    // (partnerId, userId) before identity/contact enrichment. Never drops
    // data: duplicateSeatCount + duplicateSeatIdsByUserId are reported in
    // `meta` so operators/cleanup tooling can see exactly what was hidden.
    /* W-COLLECTIVE Wave 1 (v4 §1.4 / v5 §F) — resolve identities BEFORE the
       collapse and hand the store an `emailByUserId` map, so two seat rows that
       are two userIds for the SAME human (the `u_834e8cd5998b` LIVE merge) show
       as one member instead of two. `listByPartner()` is still passed UNCHANGED
       and un-deduplicated — it backs F3 authz, promotion moderation and
       notification fan-out, and must never be collapsed at source. The EMAIL
       collapse applied here is DISPLAY-only.
       v26.7.3 FIX-4 (comment correction, MINOR-3) — the previous sentence
       "countActiveSeats() still counts rows" is no longer true: enforcement now
       collapses duplicate active rows by the canonical server-assigned `userId`
       (never by email). The email-keyed collapse here remains display-only and
       is NOT what the seat limit is enforced against; `activeSeats` below is. */
    const activeRoster = partnerTeamStore.listByPartner(pid);
    const rosterIdentityById = resolveDisplayNames(activeRoster.map((m) => m.userId));
    const emailByUserId = new Map<string, string | null>(
      activeRoster.map((m) => [m.userId, rosterIdentityById.get(m.userId)?.email ?? null]),
    );
    const { members: rawMembers, duplicateSeatCount, duplicateSeatIdsByUserId } =
      partnerTeamStore.dedupeActiveTeamMembers(activeRoster, { emailByUserId });
    const contactMap = partnerTeamContactStore.listByPartner(pid);
    const memberIds = rawMembers.map((m) => m.userId);
    /* W2-G — resolve identities through the shared displayNameResolver instead
       of a bare `users` JOIN. The prior JOIN missed synthetic ids (e.g. the
       `u_redeemed_*` personas minted in userContext.ts) and surfaced a null /
       raw id in place of a name. The resolver checks users -> credentials ->
       user-context and GUARANTEES it never returns a raw "u_..." id as a name. */
    const identityById = resolveDisplayNames(memberIds);
    const members = rawMembers.map((m) => {
      const idn = identityById.get(m.userId);
      const contact = contactMap.get(m.userId);
      // W-V44 FIX N8 — an ACTIVE member should never display the "Pending member"
      // placeholder (that label wrongly implies a not-yet-active seat and is
      // confusing next to the real managing partner). When the resolver could
      // not find a name/email (idn.resolved === false) for an ACTIVE member,
      // show a neutral "Team member" label instead; non-active unresolved seats
      // keep the resolver's status-appropriate placeholder.
      const resolvedName =
        idn && !idn.resolved && m.status === "active"
          ? "Team member"
          : (idn?.name ?? "Pending member");
      return {
        ...m,
        /* v25.56 GROUP-D — never null; resolver already guarantees a non-raw
           name, so a missing identity gets a stable placeholder not null. */
        name: resolvedName,
        email: idn?.email ?? null,
        mobile: contact?.mobile ?? null,
        contactEmail: contact?.contactEmail ?? null,
        positionNote: contact?.positionNote ?? null,
        /* 2a — display title for an active member (presentational). Stored in the
           partner-local contact override's positionNote field; null when unset.
           This is DISTINCT from `subRole` (the enforced permission tier). */
        title: contact?.positionNote ?? null,
      };
    });
    /* w-partner F-new3 — the EFFECTIVE seat cap (per-partner override, else tier
       default). Resolved server-side from the same function the invite gate
       enforces with so the banner can never disagree with the 403; the client
       must not carry its own copy of TIER_SEAT_LIMITS. */
    const { seatLimit, resolution: seatLimitResolution, capability: seatCapability } =
      resolvePartnerSeatLimit(pid, req.partnerContext!.tier);
    // v26.7.3 FIX-4 — expose the same server-owned, userId-deduplicated active
    // seat count used by dashboard and invite enforcement. The roster's existing
    // email-based display collapse remains intact (and still reports its cleanup
    // warning), but must not become the source of truth for the seat-limit banner.
    const activeSeats = partnerTeamStore.seatReport(pid).activeSeats;
    /* WAVE 229 — ONE QUANTITY, ONE DERIVATION: "pending invitations".

       The Team page derived its own pending count from the `invitations` array
       above. That array comes from `partnerInvitationStore.listByPartner()`,
       which filters a PROCESS-LOCAL RAM array. The Dashboard tile and the
       seat-limit enforcement path both use
       `partnerInvitationStore.countPendingByPartner()`, which reads the DURABLE
       table and takes `Math.max(durable, ram)` precisely because "that array is
       per-process: a freshly restarted server, or a second instance behind a
       load balancer, sees zero pending invitations and hands the partner a full
       tier's worth of extra seats" (WAVE 19 / SEAT-02, partnerWorkspaceStore.ts).

       WAVE 19 fixed the COUNT and never fixed the LIST. So one quantity had two
       derivations that can disagree, and the direction is the harmful one: the
       Team banner UNDER-reports, so a partner at their seat cap is told fewer
       invitations are outstanding than enforcement is counting, and the invite
       403 arrives unexplained.

       This exposes the enforcement figure so the banner can render it instead of
       re-deriving one. `countPendingByPartner` is CALLED, never modified — its
       predicate and signature are on the paid-seat-limit enforcement path
       (requirePartnerAuth.ts, and re-run inside the write lock) and moving
       either would move the paid limit for every partner. */
    const pendingCount = partnerInvitationStore.countPendingByPartner(pid);
    res.json({
      members,
      invitations,
      pendingCount,
      seatLimit,
      /* WAVE 45 — the banner must be able to say "Unlimited" or "Not
         configured" instead of rendering a null as 0. */
      seatLimitResolution,
      seatLimitDisplay: describeCapability(seatCapability),
      activeSeats,
      meta: { duplicateSeatCount, duplicateSeatIdsByUserId },
    });
  });

  /* v25.50 Phase 7 (7c) — edit a team member's partner-local contact info.
     Fail-closed: managing_partner only; the member must belong to THIS partner
     workspace (checked against the active roster) before any write. */
  app.patch(
    "/api/partner/me/team/:userId/contact",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const userId = String(req.params.userId);
      const member = partnerTeamStore
        .listByPartner(ctx.partnerId)
        .find((m) => m.userId === userId);
      if (!member) return res.status(404).json({ error: "TEAM_MEMBER_NOT_FOUND" });
      const { mobile, contactEmail, positionNote } = req.body ?? {};
      const norm = (v: unknown): string | null | undefined =>
        v === undefined ? undefined : v === null ? null : String(v).trim();
      const contact = partnerTeamContactStore.upsert(
        ctx.partnerId,
        userId,
        { mobile: norm(mobile), contactEmail: norm(contactEmail), positionNote: norm(positionNote) },
        ctx.userId,
      );
      res.json({ contact });
    },
  );

  app.post(
    "/api/partner/me/team/invitations",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { email, subRole, title } = req.body ?? {};
      if (!isString(email)) return badRequest(res, "email required");
      const allowed: PartnerSubRole[] = ["managing_partner", "associate", "bd", "analyst", "viewer"];
      if (!allowed.includes(subRole)) return badRequest(res, "subRole invalid");
      // 2a — optional DISPLAY title (distinct from the permission tier). Accept
      // only a known title from the shared list; unknown/empty => null (never a
      // permission, so a bad value is harmless — fail soft to null, not 400).
      const resolvedTitle: string | null = isPartnerTitle(title) ? title : null;
      const ip = (req.ip ?? "").toString();
      const ua = String(req.headers["user-agent"] ?? "");

      /* WAVE 214 surface 3 — authority tick; terse on purpose, see W214_BUILD.md
         (a 3500-char source window in wave 19's test starts at this path). */
      const authority = evaluateTickAuthority({
        req,
        body: (req.body ?? {}) as Record<string, unknown>,
        surface: WAVE214_AUTHORITY_SURFACES.partnerTeamInvitation,
        expectedStatement: WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT,
      });
      if (!authority.ok) {
        return res.status(authority.httpStatus).json({ error: authority.error, message: authority.message });
      }
      recordAuthorityConfirmation({
        actor: `partner:${ctx.partnerId}:${ctx.userId}`,
        surface: WAVE214_AUTHORITY_SURFACES.partnerTeamInvitation,
        subject: `partner:${ctx.partnerId}`,
        envelope: authority.envelope,
        route: "POST /api/partner/me/team/invitations",
        extra: { invitedEmail: String(email), subRole: String(subRole) },
      });
      /* WAVE 19 FE-19 (SEAT-04) — the seat check and the insert are now ONE
         transaction. Previously `assertTierSeats()` ran here and
         `partnerInvitationStore.create()` ran on the next line with no lock
         between them, so two simultaneous invitations could both claim the
         last seat of a paid tier. `createWithSeatGuard` re-reads the durable
         active + pending counts inside a better-sqlite3 IMMEDIATE transaction
         and applies the SAME policy function; the loser's insert rolls back.
         The 403 contract and its error string are unchanged, so the existing
         client copy still matches. */
      let invitation: PartnerTeamInvitation;
      let plainToken: string;
      try {
        ({ invitation, plainToken } = partnerInvitationStore.createWithSeatGuard(
          ctx.partnerId, email, subRole as PartnerSubRole, ctx.userId,
          (counts) => assertSeatCapacity(ctx.partnerId, counts),
          { ip, ua, title: resolvedTitle },
        ));
      } catch (e) {
        const msg = (e as Error).message ?? "";
        if (msg.includes("PARTNER_TIER_SEAT_LIMIT_REACHED") || msg.includes("PARTNER_NOT_FOUND")) {
          return res.status(403).json({
            error: msg.includes("PARTNER_NOT_FOUND") ? "PARTNER_NOT_FOUND" : "PARTNER_TIER_SEAT_LIMIT_REACHED",
          });
        }
        throw e;
      }
      // Plain token is returned ONCE to the inviter so they can copy/send via email
      res.status(201).json({ invitation, plainToken });
    },
  );

  app.post(
    "/api/partner/me/team/invitations/:id/redeem",
    requireAuth,
    (req: Request, res: Response) => {
      // Compatibility route: the canonical redemption uses /api/auth/redeem-partner-invite/:token
      // This route is for invites that have already been looked up by id.
      res.status(410).json({ error: "USE_CANONICAL_REDEEM_ROUTE" });
    },
  );

  app.delete(
    "/api/partner/me/team/:userId",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      /* v25.23 NL-U fix — surface the server-side last-managing_partner guard
       * (partnerTeamStore.remove throws LAST_MANAGING_PARTNER_CANNOT_BE_REMOVED)
       * with a 409 + machine-readable error so the UI can render the right copy. */
      try {
        const removed = partnerTeamStore.remove(ctx.partnerId, String(req.params.userId), ctx.userId);
        if (!removed) return res.status(404).json({ error: "TEAM_MEMBER_NOT_FOUND" });
        res.json({ member: removed });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "LAST_MANAGING_PARTNER_CANNOT_BE_REMOVED") {
          return res.status(409).json({
            error: msg,
            message:
              "This is the only managing partner left. Promote another team member to managing partner first.",
          });
        }
        throw e;
      }
    },
  );

  // NOTES
  app.get("/api/partner/me/notes", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    const scope = String(req.query.scope ?? "") || undefined;
    const scopeId = String(req.query.scopeId ?? "") || undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.json({ notes: partnerNotesStore.listByPartner(ctx.partnerId, { scope: scope as any, scopeId }) });
  });

  app.post(
    "/api/partner/me/notes",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { scope, scopeId, title, body } = req.body ?? {};
      if (!isString(title) || !isString(body)) return badRequest(res, "title + body required");
      const note = partnerNotesStore.create(ctx.partnerId, { scope: scope ?? "general", scopeId: scopeId ?? null, title, body }, ctx.userId);
      res.status(201).json({ note });
    },
  );

  app.delete(
    "/api/partner/me/notes/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      // Notes are soft-deleted by overwriting body to indicate deletion.
      // Full delete: remove from store by filtering out (store.listByPartner excludes it).
      // For now, just mark it archived by patching an internal flag.
      // The store doesn't support hard delete — we zero out the body as a tombstone.
      /* WAVE 200 ITEM B — R173.9.3. The comment above describes what this route
         used to do: it patched title and body to "[DELETED]", which ERASED the
         partner's own text irrecoverably, forced the scope to general, and
         recorded the erasure in the audit log as `partner.note.updated` with
         `changes: ["body","title","scope"]` — so nothing in the ledger said a
         note had been deleted. The owner ruled deletion is permitted but must be
         logged, and "I'd rather add than delete". `softDelete` therefore keeps
         the title, the original body and every entry, stops the note being
         listed, and writes a `partner.note.deleted` row through wave 186's
         checked audit path. The 404 behaviour below is unchanged. */
      try {
        const note = partnerNotesStore.softDelete(
          ctx.partnerId,
          String(req.params.id),
          ctx.userId,
          ctx.partnerSubRole === "managing_partner",
        );
        res.json({ ok: true, note });
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
      }
    },
  );

  app.patch(
    "/api/partner/me/notes/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        /* WAVE 198 · ITEM D-3 — asserted BEFORE the update, for the reason given on
           the pipeline route above: only the store's own forced spread-tail keys are
           refused, because `persistNote` JSON-encodes the whole object and any other
           unrecognised key durably round-trips. Discriminated ahead of the three
           existing outcomes so 404 / 410 / 403 are all preserved exactly. */
        assertPartnerNotePatchFullyApplied(req.body ?? {});
        const note = partnerNotesStore.update(ctx.partnerId, String(req.params.id), req.body ?? {}, ctx.userId, ctx.partnerSubRole === "managing_partner");
        res.json({ note });
      } catch (e) {
        if (isPartnerPatchUnappliedError(e)) {
          return res.status(400).json({
            error: PARTNER_PATCH_UNAPPLIED_CODE,
            refusalHeadline: e.refusalHeadline,
            refusalGuidance: e.refusalGuidance,
            message: e.refusalHeadline,
            unappliedFields: e.unappliedFields,
          });
        }
        // v25.14 NL2 — distinguish tombstoned (410) from forbidden (403) and
        // not-found (404) so the client can show a sensible error.
        const msg = (e as Error).message;
        if (msg === "NOTE_NOT_FOUND") return res.status(404).json({ error: msg });
        if (msg === "NOTE_TOMBSTONED") return res.status(410).json({ error: msg });
        res.status(403).json({ error: msg });
      }
    },
  );

  // TASKS + FILES — v25.50.0 Phase 6 (spec 5a/6a): the CP-facing Tasks and Files
  // pages are removed, so their `/api/partner/me/tasks*` and `/api/partner/me/files*`
  // route surfaces are deleted here. The underlying partnerTasksStore/partnerFilesStore
  // are retained (dormant) because the admin audit endpoint (/api/admin/partners/:id/audit)
  // and boot hydration still consume them for admin oversight; admin-side reconciliation
  // is handled in Phase 8 (see partner_v7_admin_delta.md).

  // WORKSPACE SETTINGS
  app.get("/api/partner/me/workspace-settings", requirePartnerAuth, (req: Request, res: Response) => {
    res.json({ settings: partnerWorkspaceSettingsStore.get(req.partnerContext!.partnerId) });
  });
  app.patch(
    "/api/partner/me/workspace-settings",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const patch = req.body ?? {};
      const wlKeys = ["brandColor", "logoUrl", "customDomain", "whiteLabelEnabled"] as const;
      const touchesWl = wlKeys.some((k) => k in patch);
      /* WAVE 56 (R21/R36) — THIS GATE ANSWERED SILENTLY WRONG FOR A NEW TIER.
         `TIER_RANK[ctx.tier]` was `undefined` for any tier outside the compiled-in
         five, and `undefined >= 4` is `false`, so white-label was denied with a
         403 that blamed the tier for being too junior when the truth was that the
         platform had no rank for it. `compareTierRank` reads the rank from the
         database (partner_tier_rank, set by the human who created the tier) and
         distinguishes "junior" from "unranked", which is logged below rather than
         rendered as a plain refusal. Behaviour for the five ranked tiers is
         unchanged. */
      const wlVerdict = compareTierRank(ctx.tier, "nexus");
      const whiteLabelAllowed = wlVerdict.allowed;
      if (touchesWl && !whiteLabelAllowed && wlVerdict.basis !== "ranked") {
        log.warn(
          `[partner] white-label gate could not compare ranks: tier=${String(ctx.tier)} ` +
            `basis=${wlVerdict.basis} tierRank=${String(wlVerdict.tierRank)} thresholdRank=${String(wlVerdict.thresholdRank)}`,
        );
      }
      if (touchesWl && !whiteLabelAllowed) {
        return res.status(403).json({ error: "PARTNER_TIER_INSUFFICIENT", details: { current: ctx.tier, required: "nexus" } });
      }
      /* WAVE 198 · ITEM D-4 — ASSERTED AFTER THE TIER GATE AND BEFORE THE PATCH.
         Ordering is deliberate: a partner below `nexus` who sends white-label keys
         must still get the existing 403 about their tier, because that is the true
         and more useful answer; a refusal about forced identity keys must not
         pre-empt it. Only the keys `persistWorkspaceSettings` forces in its own
         spread tail are refused. NOTHING ELSE IS, and that is the whole finding of
         this item: `client/src/pages/partner/PartnerSettings.tsx` sends a 13-key
         object of which twelve are absent from the `PartnerWorkspaceSettings`
         interface, and all twelve persist correctly because the store JSON-encodes
         the whole object into `settings_json`. An interface-derived accept-list
         would have 400'd every Partner Settings save for every partner. */
      try {
        assertPartnerWorkspaceSettingsPatchFullyApplied(patch);
      } catch (e) {
        if (isPartnerPatchUnappliedError(e)) {
          return res.status(400).json({
            error: PARTNER_PATCH_UNAPPLIED_CODE,
            refusalHeadline: e.refusalHeadline,
            refusalGuidance: e.refusalGuidance,
            message: e.refusalHeadline,
            unappliedFields: e.unappliedFields,
          });
        }
        throw e;
      }
      try {
        const s = partnerWorkspaceSettingsStore.patch(ctx.partnerId, patch, ctx.userId, { whiteLabelAllowed });
        /* w-partner F7 — mirror the workspace displayName onto the partner's
           contact record so admin/directory surfaces stop showing the stale
           name after a partner renames their workspace. NON-FATAL: the settings
           save has already succeeded and is the user's actual intent; a mirror
           failure must not turn a saved setting into an error response.
           displayName ONLY — legal_name is a legal identifier and is NEVER
           derived from a self-service display field. */
        if ("displayName" in patch) {
          try {
            updateContact(
              ctx.partnerId,
              { displayName: patch.displayName },
              ctx.userId,
              "partner.display_name.mirrored",
            );
          } catch (mirrorErr) {
            log.warn(
              `[partnerRoutes] displayName mirror to contact ${ctx.partnerId} failed (non-fatal):`,
              (mirrorErr as Error).message,
            );
          }
        }
        res.json({ settings: s });
      } catch (e) {
        res.status(403).json({ error: (e as Error).message });
      }
    },
  );

  // SPVs — LEGACY plural surface, now a COMPATIBILITY SHIM over the ONE canonical
  // engine (Ozan decision #4 / Blocker 1). Reads and writes go THROUGH
  // spvEngineStore so an SPV can NEVER be created outside the canonical `spv`
  // table (a legacy-path create is immediately canonical and shows up in the
  // Collective/Capavate context filters with no reboot). The legacy partnerSpvStore
  // rows are kept only as migrated read-only provenance (Sacred Rule #78 — nothing
  // is dropped, every route stays reachable).
  //
  // Legacy jurisdictions were free-text; the canonical engine requires a valid
  // enum. We normalise to a valid jurisdiction and preserve the original in
  // `terms.legacyJurisdiction` so no information is lost.
  const LEGACY_TO_CANONICAL_SPV_STATUS: Record<string, "draft" | "open" | "closed" | "wound_down"> = {
    planned: "draft", open: "open", closed: "closed", wound_down: "wound_down",
  };
  app.get("/api/partner/me/spvs", requirePartnerAuth, (req: Request, res: Response) => {
    res.json({ spvs: spvEngineStore.listByPartner(req.partnerContext!.partnerId) });
  });
  app.post(
    "/api/partner/me/spvs",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const body = req.body ?? {};
      /* WAVE 138 · DEFECT A — `targetSizeMinor` was NOT destructured here, so the
         one figure the client computed correctly (whole units → exact minor
         units, PartnerSpvs.tsx:105-108) was silently discarded and the SPV list
         rendered an em-dash for a target the partner had typed. Mapped below
         EXACTLY as the sibling fund route already does (`targetRaiseMinor:
         isNumber(targetSizeMinor) ? targetSizeMinor : null`, :1996) — same wire
         key in, same canonical column out, no new field invented. */
      const { spvName, jurisdiction, vintage, currency, status, targetSizeMinor, targetCompanyId, entityStructure, externalAdminProvider, externalAdminRef, notes } = body;
      if (!isString(spvName) || !isString(jurisdiction) || !isNumber(vintage) || !isISOCurrency(currency) || !isString(status)) {
        return badRequest(res, "spvName, jurisdiction, vintage, ISO 4217 currency, status required");
      }
      const validSpvStatus = ["planned", "open", "closed", "wound_down"] as const;
      if (!validSpvStatus.includes(status as typeof validSpvStatus[number])) {
        return badRequest(res, "status must be one of " + validSpvStatus.join("|"));
      }
      // 1c (per GPT-5.5 round-2 review) — this legacy create path must ALSO be
      // sign-off-gated so there is no partner-accessible way to create an SPV
      // without a durable, verifiable authorization record. Same contract as the
      // canonical POST /api/partner/me/spv: typed legal name + accepted
      // attestation required; record the sign-off FIRST (fail-closed 500 on
      // persist failure, no SPV created), then create + link.
      const signoffLegalName = typeof body.signoffLegalName === "string" ? body.signoffLegalName.trim() : "";
      const signoffAccepted = body.signoffAccepted === true;
      if (!signoffLegalName) return res.status(400).json({ error: "SIGNOFF_LEGAL_NAME_REQUIRED" });
      if (!signoffAccepted) return res.status(400).json({ error: "SIGNOFF_ATTESTATION_REQUIRED" });
      /* ── WAVE 179 · ITEM A · R151.1 — THE FENCE ───────────────────────────
         "A partner must never attribute an SPV to a client they do not manage."
         Until this wave nothing checked `targetCompanyId` on either create route,
         so a partner could attribute a vehicle to ANOTHER partner's managed
         client and it persisted and rendered. Checked BEFORE the sign-off is
         recorded and before anything is written, so a refusal leaves no sign-off
         row and no SPV — a refusal after the write would be a different defect.
         A blank/absent target is still allowed: the fence is on attribution, not
         a new requirement to attribute. */
      const targetGate = partnerMayAttributeSpvToCompany(ctx.partnerId, targetCompanyId);
      if (!targetGate.ok) {
        return res.status(404).json({
          error: SPV_TARGET_COMPANY_NOT_YOURS,
          message: SPV_TARGET_COMPANY_NOT_YOURS_MESSAGE,
        });
      }
      const attributableTargetCompanyId = targetGate.companyId;
      /* ══════════════════════════════════════════════════════════════
         WAVE 306 · WAVE 1 — THE VOCABULARY CHECK, ON THE DOOR A PAYING CLIENT
         ACTUALLY USES.
         ══════════════════════════════════════════════════════════════
         MEASURED, and it corrected a premise. This is the PLURAL route,
         `/api/partner/me/spvs`, and it is NOT the canonical wizard route
         `/api/partner/me/spv` — two routes whose names differ by one letter.
         `client/src/pages/partner/PartnerClientDetail.tsx` (the "Create SPV for
         this client" form on a paying client's own record page) posts HERE.

         `isISOCurrency` above is SHAPE-ONLY — `/^[A-Z]{3}$/`. It correctly
         refuses `NOTACURRENCY123`, an absent key and a number, which is why the
         live audit's typed garbage could not actually create a vehicle. What it
         cannot refuse is any OTHER three upper-case letters: `ZZZ`, `QQQ`, and
         the withdrawn codes `HRK` and `ZWL` all pass a shape check and none of
         them can denominate a vehicle for the rest of its life.

         WHY HERE AND NOT ONLY IN THE STORE: `recordSignoff` immediately below
         is this route's FIRST WRITE, exactly as on the canonical route. A
         store-only refusal would leave a signed ESIGN/UETA attestation behind
         for a vehicle that was never created. Same function the store calls, so
         there is one rule and it cannot drift. */
      try {
        spvEngineStore.validateCreateCurrency({ currency: currency as string });
      } catch (e) {
        const copy = spvCurrencyRefusalCopy((e as Error).message);
        /* Not one of ours — rethrow rather than swallow an unrelated failure. */
        if (!copy) throw e;
        return res.status(copy.status).json({
          error: (e as Error).message,
          message: copy.headline,
          guidance: copy.guidance,
        });
      }
      let legacySignoff;
      try {
        legacySignoff = recordSignoff({
          partnerId: ctx.partnerId,
          spvId: "",
          userId: ctx.userId,
          signerLegalName: signoffLegalName,
          signerSubRole: ctx.partnerSubRole ?? null,
          ip: resolveRateLimitClientIp(req), /* WAVE 22 · ITEM 2 — trusted-hop resolution, never the raw header */
          userAgent: (req.headers["user-agent"] as string) ?? null,
        });
      } catch {
        return res.status(500).json({ error: "SIGNOFF_PERSIST_FAILED" });
      }
      try {
        /* WAVE 4A / follow-up 2 — resolveSpvJurisdiction() (Wave 3C) replaces the
           hard-coded "delaware" fallback: unknown input becomes "other". */
        const canonicalJurisdiction = resolveSpvJurisdiction(jurisdiction);
        const spv = spvEngineStore.createSpv(
          ctx.partnerId,
          {
            name: spvName,
            jurisdiction: canonicalJurisdiction,
            // Legacy rows carry no explicit carry basis — assign whole_spv as
            // provenance (identical to the boot backfill), never a new-GP default.
            carryBasis: "whole_spv",
            currency,
            status: LEGACY_TO_CANONICAL_SPV_STATUS[status] ?? "draft",
            // WAVE 138 · DEFECT A — mirrors the fund route's mapping at :1996.
            targetRaiseMinor: isNumber(targetSizeMinor) ? targetSizeMinor : null,
            /* WAVE 179 · ITEM A · R151.1 — gated above. `attributableTargetCompanyId`
               is the value the fence approved, which is `null` for the (legitimate,
               common) no-target case and otherwise a company this partner really
               works with. The raw body value never reaches the store again. */
            targetCompanyId: attributableTargetCompanyId,
            terms: { legacyShim: true, vintage, entityStructure, externalAdminProvider, externalAdminRef, notes, legacyJurisdiction: jurisdiction },
          },
          ctx.userId,
        );
        linkSignoffToSpv(legacySignoff.id, spv.id);
        /* WAVE 179 · ITEM B · R151.3 — the OPTIONAL legal form, on the legacy create
           path too. Both partner-facing create routes accept it, or a GP who used
           this screen would silently have no way to state it. Validated against the
           jurisdiction the store PERSISTED (canonicalised from the legacy string by
           `resolveSpvJurisdiction`), never against the raw input, so the option set
           matches the vehicle that now exists. An absent key writes NULL and changes
           nothing anyone can see. */
        const legalForm = setSpvLegalForm(spv.id, spv.jurisdiction, body.legalForm);
        res.status(201).json({ spv, legalForm });
      } catch (e) {
        return badRequest(res, (e as Error).message);
      }
    },
  );
  /* ═══ WAVE 277 · R224.1 — AN UNGUARDED READ THAT ANSWERED A BARE 500. ══════
     `spvEngineStore.investorRegister` is called INSIDE the argument to `res.json`
     and this handler had no `try`/`catch`, so the MIXED_CURRENCY_COMMITTED_TOTAL
     refusal it raises by design — a total made of two currencies is not a number —
     escaped to Express and answered HTTP 500 with no body, on every load, for as
     long as the vehicle held one foreign-currency subscription. Reported now by
     this file's own responder in the same shape `err()` uses. Success path
     unchanged: same keys, same order, same values, one `res.json` call.
     THIS IS THE ROUTE THE SPV DETAIL PAGE ACTUALLY CALLS —
     `client/src/pages/partner/PartnerSpvDetail.tsx:232`. */
  app.get("/api/partner/me/spvs/:id", requirePartnerAuth, (req: Request, res: Response) => {
    try {
    const ctx = req.partnerContext!;
    const spv = spvEngineStore.getSpv(ctx.partnerId, String(req.params.id));
    if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    // Positions map onto the canonical investor register (per-LP commitment + %).
    res.json({
      spv,
      positions: spvEngineStore.investorRegister(ctx.partnerId, String(req.params.id)),
      /* WAVE 161 · BATCH 3 ITEM A (A22) — `positions` is UNCHANGED; the split says
         how much of it is confirmed capital. See shared/spvCommittedCapital.ts. */
      positionsSplit: spvEngineStore.investorRegisterWithSplit(ctx.partnerId, String(req.params.id)),
    });
    } catch (e) {
      return respondSpvWriteRefusal(res, e);
    }
  });
  app.patch(
    "/api/partner/me/spvs/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      // Blocker 1 (4D): mutate THROUGH the canonical engine so a legacy PATCH can
      // never diverge the legacy row from the canonical `spv` table. Legacy status
      // strings are normalised to canonical enums; `spvName` maps to `name`.
      const b = (req.body ?? {}) as Record<string, unknown>;
      /* ── WAVE 194 · ITEM B · R165.4 — REFUSED BEFORE ANYTHING IS WRITTEN ──────
         THE DEFECT. Every key this handler does not name below was read out of the
         body, silently discarded, and answered `200 { spv }` with the vehicle
         unchanged. A managing partner correcting a vehicle's currency, carry basis
         or jurisdiction — any of which is the UNIT or the LEGAL BASIS of every
         figure on it — was told the correction saved. It had not been. Wave 193 fixed
         the canonical PATCH and reported this one; a protection that stops at one of
         three doors is not a protection.

         PLACED BEFORE `updateSpv`, DELIBERATELY. A refused request must change
         NOTHING, so there is no partial write to explain and no half-applied patch
         to unwind. It also runs after all three auth guards, so an unauthorised
         caller still learns only that it is unauthorised.
         The accept-list mirrors the ladder immediately below, one key for one key. */
      /* The `try` opens HERE, one statement earlier than it used to, so the
         assertion's throw is caught by this handler's own catch and answered as a
         400 refusal instead of escaping to Express as a 500. The ladder it now
         encloses is pure assignment and cannot throw, so no other behaviour of
         this route changes. */
      try {
        assertLegacyVehiclePatchFullyApplied(b, LEGACY_SPV_PATCH_APPLIED_KEYS, "SPV");
        const patch: Record<string, unknown> = {};
        if (typeof b.spvName === "string") patch.name = b.spvName;
        if (typeof b.name === "string") patch.name = b.name;
        if (typeof b.status === "string") patch.status = LEGACY_TO_CANONICAL_SPV_STATUS[b.status] ?? b.status;
        /* WAVE 140 · BATCH 1 ITEM 1 — THE OTHER WRITER OF `cap_minor`, AND IT WAS
           UNTYPED. This legacy PATCH accepted whatever arrived. A blank field from
           any legacy caller arrives as `""`, and `""` stored through this door
           became a 0 cap — the exact defect ITEM 1 repairs on the wizard path, so
           fixing only the wizard would have left this door open. An empty string
           (and an explicit null) now mean NO CAP / NOT GIVEN and persist as SQL
           NULL. A DELIBERATE 0 IS NOT REWRITTEN: only `""` and null are
           normalised, because this route carries no provenance and cannot tell a
           typed 0 from a blank one. `server/spvTemplateStore.ts:203`
           (`normaliseMinor`) is the house precedent: `""` → null. */
        const blankToNull = (v: unknown) => (v === "" || v === null ? null : v);
        if (b.targetRaiseMinor !== undefined) patch.targetRaiseMinor = blankToNull(b.targetRaiseMinor);
        if (b.minCheckMinor !== undefined) patch.minCheckMinor = blankToNull(b.minCheckMinor);
        if (b.capMinor !== undefined) patch.capMinor = blankToNull(b.capMinor);
        if (b.closeDate !== undefined) patch.closeDate = b.closeDate;
        const spv = spvEngineStore.updateSpv(ctx.partnerId, String(req.params.id), patch, ctx.userId);
        res.json({ spv });
      } catch (e) {
        /* WAVE 194 · ITEM B — the refusal, in the SAME envelope wave 193 shipped at
           `server/spvEngineRoutes.ts:480-487`: the machine code stays in `error` so
           nothing that keys on a code changes (R44 — add, do not substitute),
           `message` is the short headline that survives `queryClient.ts`'s
           240-character `looksHuman` gate, `guidance` carries the unabridged
           sentence, and `unappliedFields` names the keys machine-readably so no
           caller has to parse prose. HTTP 400: the request is malformed for this
           route, and it is not a 404 — the vehicle was found and is untouched.
           NEVER an all-caps underscore code on screen (R152 item 3 / R165.4). */
        if (isSpvPatchUnappliedError(e)) {
          return res.status(400).json({
            error: (e as Error).message,
            message: e.refusalHeadline,
            guidance: e.refusalGuidance,
            unappliedFields: e.unappliedFields,
          });
        }
        res.status(404).json({ error: (e as Error).message });
      }
    },
  );
  /* ═══ WAVE 277 · R224.1 — AN UNGUARDED READ THAT ANSWERED A BARE 500. ══════
     `spvEngineStore.investorRegister` is called INSIDE the argument to `res.json`
     and this handler had no `try`/`catch`, so the MIXED_CURRENCY_COMMITTED_TOTAL
     refusal it raises by design — a total made of two currencies is not a number —
     escaped to Express and answered HTTP 500 with no body, on every load, for as
     long as the vehicle held one foreign-currency subscription. Reported now by
     this file's own responder in the same shape `err()` uses. Success path
     unchanged: same keys, same order, same values, one `res.json` call. */
  app.get("/api/partner/me/spvs/:id/positions", requirePartnerAuth, (req: Request, res: Response) => {
    try {
    const ctx = req.partnerContext!;
    const spv = spvEngineStore.getSpv(ctx.partnerId, String(req.params.id));
    if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    // Positions are the canonical investor register (per-LP commitment + %).
    res.json({
      positions: spvEngineStore.investorRegister(ctx.partnerId, String(req.params.id)),
      /* WAVE 161 · ITEM A (A23) — additive split; the rows are untouched. */
      positionsSplit: spvEngineStore.investorRegisterWithSplit(ctx.partnerId, String(req.params.id)),
    });
    } catch (e) {
      return respondSpvWriteRefusal(res, e);
    }
  });
  app.post(
    "/api/partner/me/spvs/:id/positions",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { lpContactId, positionAmountMinor, currency } = req.body ?? {};
      if (!isString(lpContactId) || !isNumber(positionAmountMinor) || !isISOCurrency(currency)) {
        return badRequest(res, "lpContactId, positionAmountMinor (int minor), ISO 4217 currency required");
      }
      // Blocker 1 (4D): a NEW position is written THROUGH the canonical engine as
      // a subscription (LP register) — never as a legacy partnerSpvStore position.
      try {
        const sub = spvEngineStore.subscribe(
          ctx.partnerId,
          String(req.params.id),
          { investorId: lpContactId, commitmentMinor: positionAmountMinor, currency },
          ctx.userId,
        );
        res.status(201).json({ position: sub });
      } catch (e) { respondSpvWriteRefusal(res, e); }
    },
  );

  // FUNDS — Blocker 1 (4D): a fund is just an SPV with spvType="fund". Every
  // fund create/read/update/commitment surface is a COMPATIBILITY SHIM over the
  // ONE canonical engine (spvEngineStore) so a fund can NEVER be created outside
  // the canonical `spv` table (no second system). The legacy partnerFundsStore
  // rows remain read-only provenance (Sacred Rule #78). Legacy fund statuses are
  // normalised to canonical SPV enums; fund-specific fields are preserved in
  // `terms` so no information is lost.
  const LEGACY_TO_CANONICAL_FUND_STATUS: Record<string, "draft" | "open" | "closed" | "wound_down"> = {
    planning: "draft", raising: "open", investing: "open", harvesting: "closed", wound_down: "wound_down",
  };
  app.get("/api/partner/me/funds", requirePartnerAuth, (req: Request, res: Response) => {
    const funds = spvEngineStore.listByPartner(req.partnerContext!.partnerId).filter((s) => s.spvType === "fund");
    res.json({ funds });
  });
  app.post(
    "/api/partner/me/funds",
    requirePartnerAuth,
    /* WAVE 150 · R111 Q11 (owner: "Yes.") — fund creation now demands the SAME
       legal sign-off as an SPV, and MANAGING PARTNER ONLY, matching the sibling
       SPV create route at `:1814`. `"associate"` was accepted here and is
       deliberately removed: an associate cannot give a firm's legal
       authorization for a new vehicle. The removal is SURFACED, not silent —
       `client/src/pages/partner/PartnerFunds.tsx` keeps the control visible and
       disabled with a plain sentence naming the requirement (same treatment the
       SPV screen already gives, PartnerSpvs.tsx `spvRoleNote`). No control is
       deleted. */
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      /* WAVE 150 — `body` is hoisted to a const (identical to the SPV route at
         `:1818`) so the sign-off fields below read from the same object the
         destructure below uses. The destructured key list is UNCHANGED. */
      const body = req.body ?? {};
      const { fundName, fundType, jurisdiction, vintage, currency, status, targetSizeMinor, externalAdminProvider, externalAdminRef, notes } = body;
      if (!isString(fundName) || !isString(fundType) || !isString(jurisdiction) || !isNumber(vintage) || !isISOCurrency(currency) || !isString(status)) {
        return badRequest(res, "fundName, fundType, jurisdiction, vintage, ISO 4217 currency, status required");
      }
      const validFundType = ["evergreen", "closed_end", "rolling"] as const;
      const validFundStatus = ["planning", "raising", "investing", "harvesting", "wound_down"] as const;
      if (!validFundType.includes(fundType as typeof validFundType[number])) {
        return badRequest(res, "fundType must be one of " + validFundType.join("|"));
      }
      if (!validFundStatus.includes(status as typeof validFundStatus[number])) {
        return badRequest(res, "status must be one of " + validFundStatus.join("|"));
      }
      /* WAVE 150 · R111 Q11 — the attestation gate, copied IN SHAPE from the SPV
         create path (`:1840-1857`): same wire field names, same error codes, the
         same `recordSignoff` call, and the same fail-closed 500. A fund is an SPV
         with `spvType="fund"` (one canonical engine), so it gets the one shipped
         attestation — `ATTESTATION_TEXT_V1` in `shared/spvAttestation.ts`, which
         `recordSignoff` writes verbatim. NO new legal copy is authored here, and
         no second version of the text exists to diverge.

         WAVE 169 CORRECTION, RECORDED RATHER THAN SMOOTHED OVER: reusing v1
         VERBATIM was the wrong call, and the paragraph above is why it survived
         unexamined. v1 says "authorized to launch this special-purpose vehicle",
         so every fund created through this route was attested with the name of a
         product the partner was not creating. R111 Q11's instruction — same
         attestation as an SPV, author no new legal copy — is still honoured: the
         sentence is unchanged except for the vehicle noun, which is substituted
         positionally out of the v1 bytes by `shared/spvAttestation.ts`. There is
         still exactly ONE authority for the copy and still no second sentence.

         ORDER MATTERS AND IS DELIBERATE: the sign-off is recorded BEFORE the fund
         row is created, exactly as the SPV path does, so a fund can never exist
         without its authorization record. If the durable INSERT fails the request
         is refused with 500 SIGNOFF_PERSIST_FAILED and no fund is created.

         STORAGE: the row lands in `spv_launch_signoffs` (migration 0108, self-
         healed at server/db/connection.ts:1327). Verified DDL: NO CHECK
         constraint on any subject kind, and `spv_id TEXT NOT NULL DEFAULT ''` —
         so `spvId: ""` pre-create is a supported value and fund rows fit the
         existing table. NO migration is required by this wave. */
      const signoffLegalName = typeof body.signoffLegalName === "string" ? body.signoffLegalName.trim() : "";
      const signoffAccepted = body.signoffAccepted === true;
      if (!signoffLegalName) return res.status(400).json({ error: "SIGNOFF_LEGAL_NAME_REQUIRED" });
      if (!signoffAccepted) return res.status(400).json({ error: "SIGNOFF_ATTESTATION_REQUIRED" });
      let fundSignoff;
      try {
        fundSignoff = recordSignoff({
          partnerId: ctx.partnerId,
          spvId: "",
          userId: ctx.userId,
          signerLegalName: signoffLegalName,
          signerSubRole: ctx.partnerSubRole ?? null,
          /* WAVE 169 · R77 — this route creates `spvType: "fund"` (:2064 below), so
             the recorded attestation must say FUND. Until this wave it recorded
             v1's "special-purpose vehicle" wording on every fund ever created
             here: a signed sentence naming a product the partner was not making.
             The literal is passed rather than derived because this route can only
             ever create a fund — the same reason `spvType: "fund"` is a literal at
             :2064 — and a test asserts the two agree. */
          spvType: "fund",
          ip: resolveRateLimitClientIp(req), /* WAVE 22 · ITEM 2 — trusted-hop resolution, never the raw header */
          userAgent: (req.headers["user-agent"] as string) ?? null,
        });
      } catch {
        return res.status(500).json({ error: "SIGNOFF_PERSIST_FAILED" });
      }
      try {
        /* WAVE 4A / follow-up 2 — resolveSpvJurisdiction() (Wave 3C) replaces the
           hard-coded "delaware" fallback: unknown input becomes "other". */
        const canonicalJurisdiction = resolveSpvJurisdiction(jurisdiction);
        const fund = spvEngineStore.createSpv(
          ctx.partnerId,
          {
            name: fundName,
            spvType: "fund",
            jurisdiction: canonicalJurisdiction,
            carryBasis: "whole_spv",
            currency,
            status: LEGACY_TO_CANONICAL_FUND_STATUS[status] ?? "draft",
            targetRaiseMinor: isNumber(targetSizeMinor) ? targetSizeMinor : null,
            terms: { legacyShim: true, fundType, vintage, externalAdminProvider, externalAdminRef, notes, legacyJurisdiction: jurisdiction, legacyFundStatus: status },
          },
          ctx.userId,
        );
        /* WAVE 150 — link the pre-create sign-off to the fund now that the row
           exists (precedent: the SPV path at `:1879`). */
        linkSignoffToSpv(fundSignoff.id, fund.id);
        res.status(201).json({ fund });
      } catch (e) { return badRequest(res, (e as Error).message); }
    },
  );
  /* ═══ WAVE 277 · R224.1 — AN UNGUARDED READ THAT ANSWERED A BARE 500. ══════
     `spvEngineStore.investorRegister` is called INSIDE the argument to `res.json`
     and this handler had no `try`/`catch`, so the MIXED_CURRENCY_COMMITTED_TOTAL
     refusal it raises by design — a total made of two currencies is not a number —
     escaped to Express and answered HTTP 500 with no body, on every load, for as
     long as the vehicle held one foreign-currency subscription. Reported now by
     this file's own responder in the same shape `err()` uses. Success path
     unchanged: same keys, same order, same values, one `res.json` call. */
  app.get("/api/partner/me/funds/:id", requirePartnerAuth, (req: Request, res: Response) => {
    try {
    const ctx = req.partnerContext!;
    const fund = spvEngineStore.getSpv(ctx.partnerId, String(req.params.id));
    if (!fund || fund.spvType !== "fund") return res.status(404).json({ error: "FUND_NOT_FOUND" });
    res.json({
      fund,
      /* ══ NUMBERS BAND · WAVE E (W328) — THE LP'S NAME, ADDED BESIDE ITS ID. ══
         This register's rows carry an `investorId` and NO name field, so the
         screen ran the id through `partyReferenceLabel` and printed
         "Reference MARK INVEST PARTNERS" — a human name shouted and mislabelled
         as an internal reference, because `spv_subscription.investor_id` for
         that LP literally holds the string "Mark Invest Partners".

         `investorName` is ADDITIVE and resolved by `investorDisplayNameMap`, the
         SAME chain the LP Roster builder uses (server/lib/investorDisplayName.ts),
         so the two GP screens cannot answer differently for one row. It is `null`
         — never a placeholder — when no honest name exists, and the screen keeps
         `partyReferenceLabel` as its floor for that case. `partyReferenceLabel`
         is NOT edited: 15 production files, 32 call sites.

         NOTHING ELSE MOVES. `spvEngineStore.investorRegister` is not modified and
         its rows are byte-identical for every existing key; no amount, status,
         stage, percentage or currency is read, defaulted or recomputed here; and
         `lpVisibility` is neither read nor written — this is a partner-scoped GP
         route over the GP's own vehicle. */
      commitments: withInvestorNames(
        ctx.partnerId,
        String(req.params.id),
        spvEngineStore.investorRegister(ctx.partnerId, String(req.params.id)),
      ),
      /* WAVE 161 · ITEM A (A24) — the Fund Commitment Register's split. The word
         "commitments" on this key is the reason the split matters most here: the
         rows include stages that are NOT commitments. */
      commitmentsSplit: spvEngineStore.investorRegisterWithSplit(ctx.partnerId, String(req.params.id)),
    });
    } catch (e) {
      return respondSpvWriteRefusal(res, e);
    }
  });
  app.patch(
    "/api/partner/me/funds/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const existing = spvEngineStore.getSpv(ctx.partnerId, String(req.params.id));
      if (!existing || existing.spvType !== "fund") return res.status(404).json({ error: "FUND_NOT_FOUND" });
      const b = (req.body ?? {}) as Record<string, unknown>;
      /* ── WAVE 194 · ITEM B · R165.4 — THE SAME DEFECT, THE FUND DOOR ──────────
         Identical shape to the SPV PATCH above and identically silent: anything not
         named in the five-key ladder below was dropped and answered `200 { fund }`.
         The accept-list is its OWN — `fundName` and `targetSizeMinor` are legacy
         names this route translates, and it maps neither `distributionScope` nor
         `lpVisibility` nor `terms`, so wave 193's store-shaped nine-key list would
         have accepted three keys this route discards. Refused BEFORE `updateSpv`,
         so a refused request leaves the fund exactly as it was. */
      /* The `try` opens HERE so the assertion's throw reaches this handler's catch
         and becomes a 400 refusal rather than an unhandled 500. The enclosed ladder
         is pure assignment and cannot throw. */
      try {
        assertLegacyVehiclePatchFullyApplied(b, LEGACY_FUND_PATCH_APPLIED_KEYS, "fund");
        const patch: Record<string, unknown> = {};
        if (typeof b.fundName === "string") patch.name = b.fundName;
        if (typeof b.name === "string") patch.name = b.name;
        if (typeof b.status === "string") patch.status = LEGACY_TO_CANONICAL_FUND_STATUS[b.status] ?? b.status;
        if (b.targetSizeMinor !== undefined) patch.targetRaiseMinor = b.targetSizeMinor;
        if (b.closeDate !== undefined) patch.closeDate = b.closeDate;
        const fund = spvEngineStore.updateSpv(ctx.partnerId, String(req.params.id), patch, ctx.userId);
        res.json({ fund });
      } catch (e) {
        /* WAVE 194 · ITEM B — same envelope as the SPV PATCH above and as wave
           193's canonical route. 400, not 404: the fund exists and is unchanged. */
        if (isSpvPatchUnappliedError(e)) {
          return res.status(400).json({
            error: (e as Error).message,
            message: e.refusalHeadline,
            guidance: e.refusalGuidance,
            unappliedFields: e.unappliedFields,
          });
        }
        res.status(404).json({ error: (e as Error).message });
      }
    },
  );
  /* ═══ WAVE 277 · R224.1 — AN UNGUARDED READ THAT ANSWERED A BARE 500. ══════
     `spvEngineStore.investorRegister` is called INSIDE the argument to `res.json`
     and this handler had no `try`/`catch`, so the MIXED_CURRENCY_COMMITTED_TOTAL
     refusal it raises by design — a total made of two currencies is not a number —
     escaped to Express and answered HTTP 500 with no body, on every load, for as
     long as the vehicle held one foreign-currency subscription. Reported now by
     this file's own responder in the same shape `err()` uses. Success path
     unchanged: same keys, same order, same values, one `res.json` call. */
  app.get("/api/partner/me/funds/:id/commitments", requirePartnerAuth, (req: Request, res: Response) => {
    try {
    const ctx = req.partnerContext!;
    const fund = spvEngineStore.getSpv(ctx.partnerId, String(req.params.id));
    if (!fund || fund.spvType !== "fund") return res.status(404).json({ error: "FUND_NOT_FOUND" });
    res.json({
      commitments: spvEngineStore.investorRegister(ctx.partnerId, String(req.params.id)),
      /* WAVE 161 · ITEM A (A25) — additive split; the rows are untouched. */
      commitmentsSplit: spvEngineStore.investorRegisterWithSplit(ctx.partnerId, String(req.params.id)),
    });
    } catch (e) {
      return respondSpvWriteRefusal(res, e);
    }
  });
  app.post(
    "/api/partner/me/funds/:id/commitments",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { lpContactId, commitmentMinor, currency } = req.body ?? {};
      if (!isString(lpContactId) || !isNumber(commitmentMinor) || !isISOCurrency(currency)) {
        return badRequest(res, "lpContactId, commitmentMinor (int minor), ISO 4217 currency required");
      }
      const fund = spvEngineStore.getSpv(ctx.partnerId, String(req.params.id));
      if (!fund || fund.spvType !== "fund") return res.status(404).json({ error: "FUND_NOT_FOUND" });
      // Blocker 1 (4D): a NEW commitment is written THROUGH the canonical engine
      // as a subscription (LP register) — never as a legacy partnerFundsStore row.
      try {
        const sub = spvEngineStore.subscribe(
          ctx.partnerId,
          String(req.params.id),
          { investorId: lpContactId, commitmentMinor, currency },
          ctx.userId,
        );
        res.status(201).json({ commitment: sub });
      } catch (e) { respondSpvWriteRefusal(res, e); }
    },
  );

  /* ==========================================================
   * v25.23 NC-A fix — SPV capital-calls + distributions.
   * The previous stub handlers here (registered first) WON Express
   * dispatch over the real DB-backed handlers in spvFundStore.ts:1341
   * / 1381, returning 201 without persisting anything. That violated
   * the NO-MOCK-DATA / NO-MEMORY-STORAGE standing rules and lost
   * financial records on the most sensitive money surface.
   *
   * The fix has two parts:
   *   1. Remove these stubs here so spvFundStore's real DB-backed
   *      handlers take effect (registered at routes.ts:640 via
   *      registerSpvFundRoutes).
   *   2. Add `assertSubRole("managing_partner")` to the real handlers
   *      in spvFundStore.ts (separate edit) so the financial gate is
   *      preserved — v25.14 NH3 only covered POST commitments; this
   *      wave covers PATCH commitments + capital-calls + distributions.
   *
   * The single source of truth is now spvFundStore.
   * ========================================================== */

  /* ============================================================
   * Magic-link redemption
   * v23.9 A5/CP-3 — PUBLIC. A freshly-invited consortium partner has no
   * account yet, so requiring auth here was a bootstrapping deadlock (they
   * could never onboard). The signed invite token IS the credential: we look
   * it up, mint/resolve a persona seeded from the invited email, set the
   * session cookie, then redeem — mirroring the public /api/auth/redeem flow.
   * ============================================================ */

  app.post("/api/auth/redeem-partner-invite/:token", (req: Request, res: Response) => {
    const token = String(req.params.token ?? "");
    if (!token) return res.status(400).json({ error: "MISSING_TOKEN" });

    // Resolve the invitation up-front so we know which email to mint against.
    const pending = partnerInvitationStore.findByTokenHash(hashInviteToken(token));
    if (!pending) {
      // A7 (v24.0) — consortium-approval fallback. Approved-partner invites are
      // minted into auth_redeem_tokens (intent='partner_invite', sha256 of raw),
      // a DIFFERENT store/hash scheme than partnerInvitationStore team invites.
      // Without this branch every approved-partner link returned
      // PARTNER_INVITATION_INVALID_TOKEN. Look the token up there and consume it.
      try {
        const approvalHash = createHash("sha256").update(token).digest("hex");
        const db = rawDb();
        const row = db
          .prepare(
            `SELECT id, email, intent, consumed_at, expires_at FROM auth_redeem_tokens WHERE token_hash = ? AND intent = 'partner_invite'`,
          )
          .get(approvalHash) as
          | { id: string; email: string; intent: string; consumed_at: string | null; expires_at: string }
          | undefined;
        if (!row) return res.status(404).json({ error: "PARTNER_INVITATION_INVALID_TOKEN" });
        if (row.consumed_at) return res.status(409).json({ error: "PARTNER_INVITATION_ALREADY_REDEEMED" });
        if (new Date(row.expires_at).getTime() < Date.now())
          return res.status(410).json({ error: "PARTNER_INVITATION_EXPIRED" });

        // Mint/resolve the persona for the invited email and consume the token.
        const existingCtx = getUserContext(req);
        /* v25.23 NC-B fix — email-binding gate (privilege escalation hole).
         * Previously: if the caller was already authenticated, we redeemed AS
         * that user even if their email did not match the invited email. A
         * Collective member or other-partner user who obtained the link could
         * join the target workspace bound to their own account. Single-use
         * tokens stop replay, not redirection. Now we require the authed
         * session's email to (case-insensitively) match the invited email, or
         * the redeem is rejected with PARTNER_INVITATION_EMAIL_MISMATCH so the
         * caller can log out and redeem cleanly. The audit chain (and the
         * partnerInvitationStore.redeem path below) already covers logging. */
        if (
          existingCtx.isAuthed &&
          (existingCtx.identity?.email ?? "").trim().toLowerCase() !== (row.email ?? "").trim().toLowerCase()
        ) {
          /* v25.32 P0 — include `invitedEmail` so the client recovery UI can
           * show the partner which mailbox the invite targeted. The recovery
           * "Log out and continue" action then clears the admin session and
           * re-fires the (unconsumed) token as anonymous. */
          return res.status(403).json({
            error: "PARTNER_INVITATION_EMAIL_MISMATCH",
            message: "This invitation was sent to a different email. Please log out and redeem with the invited address.",
            invitedEmail: row.email,
          });
        }
        /* v25.49.3 R1 — approved consortium-partner redemptions must NOT create
         * an investor-shaped persona. registerPersona() (SACRED userContext.ts)
         * hard-codes isInvestor + durable auth_users.role='investor'; that made
         * the post-redeem SESSION investor-shaped and re-broke partner password-
         * reset routing (2a). Instead resolve/create the consortium_partner
         * identity locally (never touching the sacred file). The single-use
         * token is still the credential; the strong random password is only a
         * placeholder the partner re-sets via the set-password flow. */
        const approvedUserId = existingCtx.isAuthed
          ? existingCtx.userId
          : resolveOrCreateConsortiumPartnerId(
              row.email,
              // Strong random password (C15) — the partner can re-set via the
              // set-password flow; the single-use token is the real credential.
              createHash("sha256").update(`${token}:${Date.now()}:${Math.random()}`).digest("hex"),
            );
        /* v25.24 NH-4 fix — atomic single-use consume on the consortium-approval
         * redeem branch. The v25.23 NH-L atomic redeem covered only the
         * partner-invite store (`partnerInvitationStore.redeem` via
         * better-sqlite3 IMMEDIATE tx). This branch (auth_redeem_tokens with
         * intent='partner_invite' from `mintPartnerInviteToken`) used a plain
         * `UPDATE ... WHERE id = ?` with NO `consumed_at IS NULL` guard. Two
         * concurrent redeems could both observe `row.consumed_at == null`,
         * both compute their userId in registerPersona, and both UPDATE the
         * same row — second wins, but BOTH responded 200 to their respective
         * callers. Now we use `WHERE id = ? AND consumed_at IS NULL` and
         * check `changes` (better-sqlite3 result) to detect lost-race; if
         * the conditional UPDATE doesn't affect a row, another caller won. */
        const consumeRes = db
          .prepare(
            `UPDATE auth_redeem_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`,
          )
          .run(new Date().toISOString(), row.id);
        if (consumeRes && typeof consumeRes.changes === "number" && consumeRes.changes === 0) {
          return res.status(409).json({ error: "PARTNER_INVITATION_ALREADY_REDEEMED" });
        }

        // Ensure partner-workspace authz records exist (idempotent with A8). The
        // approval path already creates these, but guarantee it here so redeem
        // never lands the user in a 403 partner workspace.
        let partnerId: string | null = null;
        try {
          const contact = upsertConsortiumPartner({ legalName: row.email, email: row.email }, approvedUserId);
          partnerTeamStore.upsertOwner(approvedUserId, contact.id, "managing_partner");
          partnerId = contact.id;
        } catch (authzErr) {
          // Non-fatal: an existing membership (from approval) still authorizes.
          const existingMember = partnerTeamStore.findByUserId(approvedUserId);
          partnerId = existingMember?.partnerId ?? null;
        }

        if (!existingCtx.isAuthed) setSessionCookie(res, approvedUserId);
        const ctx = getUserContextForId(approvedUserId);
        return res.json({ ok: true, partnerId, subRole: "managing_partner", ctx });
      } catch (fallbackErr) {
        return res.status(404).json({ error: "PARTNER_INVITATION_INVALID_TOKEN" });
      }
    }
    if (pending.redeemedAt) return res.status(409).json({ error: "PARTNER_INVITATION_ALREADY_REDEEMED" });
    if (Date.parse(pending.expiresAt) < Date.now()) return res.status(410).json({ error: "PARTNER_INVITATION_EXPIRED" });

    // If the caller is already authenticated, redeem as that user; otherwise
    // the token mints the partner's account.
    const existing = getUserContext(req);
    /* v25.23 NC-B fix — email-binding gate. Same rationale as the approved-
     * partner fallback branch above: single-use tokens stop replay, not
     * redirection. An authed caller with a non-matching email must log out
     * first. */
    if (
      existing.isAuthed &&
      (existing.identity?.email ?? "").trim().toLowerCase() !== (pending.invitedEmail ?? "").trim().toLowerCase()
    ) {
      /* v25.32 P0 — include `invitedEmail` so the client recovery UI can
       * display which mailbox owns this invite. See sibling branch above. */
      return res.status(403).json({
        error: "PARTNER_INVITATION_EMAIL_MISMATCH",
        message: "This invitation was sent to a different email. Please log out and redeem with the invited address.",
        invitedEmail: pending.invitedEmail,
      });
    }
    // v25.14 NC1 — was hardcoded to "changeme" giving full account takeover
    // to anyone who knew an invited team member's email. Now mints a strong
    // random password; the user is expected to use the invite link itself to
    // first-time-sign-in, and can reset via the password-reset flow after.
    const userId = existing.isAuthed
      ? existing.userId
      : registerPersona({
          email: pending.invitedEmail,
          name: pending.invitedEmail,
          password: createHash("sha256").update(randomBytes(32)).digest("hex"),
          invitationId: pending.id,
          roundId: "",
          companyId: "",
        });

    const ip = (req.ip ?? "").toString();
    const ua = String(req.headers["user-agent"] ?? "");
    try {
      /* v25.16 NH1 — close the TOCTOU seat race: re-check tier seat limit at
         redeem (not just at invite-create) so a downgrade-then-redeem or
         concurrent-redeem cannot blow past the tier seat ceiling. */
      try {
        assertTierSeats(pending.partnerId);
      } catch (seatErr) {
        return res.status(403).json({ error: (seatErr as Error).message ?? "TIER_SEAT_LIMIT_EXCEEDED" });
      }
      const inv = partnerInvitationStore.redeem(token, userId, { ip, ua });
      if (!existing.isAuthed) setSessionCookie(res, userId);
      const ctx = getUserContextForId(userId);
      res.json({ ok: true, partnerId: inv.partnerId, subRole: inv.subRole, ctx });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "PARTNER_INVITATION_EXPIRED") return res.status(410).json({ error: msg });
      if (msg === "PARTNER_INVITATION_ALREADY_REDEEMED") return res.status(409).json({ error: msg });
      res.status(400).json({ error: msg });
    }
  });
}
