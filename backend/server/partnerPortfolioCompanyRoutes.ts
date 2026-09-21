/**
 * Wave B1 (v26.1.x Consortium Partner QA, slide 3a) — "Add Portfolio Company".
 *
 * Lets a Consortium Partner create a GENUINELY NET-NEW, INDEPENDENT Capavate
 * company from inside their own workspace, using the SAME underlying company
 * engine Capavate already uses (`addCompanyForFounder` + the canonical
 * subscription provisioning). The created company:
 *   - is a separate, independent entity with its OWN company id + subscription,
 *   - is OWNED by the founder (a deterministic pending-founder user id derived
 *     from the founder's email) \u2014 NEVER by the partner, so the founder can only
 *     ever access their own company workspace, never the partner section,
 *   - is TAGGED to the originating Consortium Partner via the existing
 *     `consortium_links` attribution (linkConsortiumPartner), so every surface
 *     can show the partner is leading the raise,
 *   - is added to the partner's Pipeline (invited stage) for tracking,
 *   - issues a founder OWNER invitation (same founder_team_invitations schema +
 *     /auth/redeem token flow) so the founder claims the account by email and
 *     finishes the full company profile in the canonical builder.
 *
 * SACRED: touches no sacred store. It COMPOSES existing non-sacred engines and
 * writes only the existing additive tables (companies via multiCompanyStore,
 * consortium_links, founder_team_invitations, partner pipeline). It NEVER
 * touches Airwallex/payments or the cap-table ledger (captableCommitStore).
 * No new migration (all tables already exist).
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import { addCompanyForFounder, rollbackFounderCompany, type FounderCompanyMembership } from "./multiCompanyStore";
import { createSubscriptionForNewCompany, updateSubscription } from "./subscriptionsStore";
import { linkConsortiumPartner, unlinkConsortiumPartner } from "./consortiumLinkStore";
import { partnerPipelineStore, partnerAttributionStore } from "./partnerWorkspaceStore";
import { upsertPortfolioProfile } from "./partnerPortfolioStore";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
/* WAVE 186 · R159.1 — see the audit block at the end of the create handler. */
import { appendAdminAudit, reportAuditWriteOutcome } from "./adminPlatformStore";
/* WAVE 214 · surface 1 — the third-party authority confirmation. The statement
   literal lives in `shared/` and is imported by BOTH this route and the screen
   that shows it, so the sha256 recorded here attests to the bytes the user read
   (R187.3: the previous e-signature envelope could prove nothing because no hash
   of the presented text was captured). */
import {
  evaluateTypedNameAuthority,
  recordAuthorityConfirmation,
} from "./lib/wave214ThirdPartyAuthorityStore";
import {
  WAVE214_AUTHORITY_SURFACES,
  WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
} from "../shared/wave214ThirdPartyAuthorityCopy";

/** Only these partner sub-roles may create a portfolio company (mirrors the
 *  pipeline write gate: managing_partner | associate | bd). */
const WRITE_ROLES = ["managing_partner", "associate", "bd"] as const;

function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/**
 * Deterministic pending-founder user id from the founder email. Using a stable
 * hash means re-inviting the same founder email resolves to the same owner id
 * (idempotent ownership), and the id is namespaced so it never collides with a
 * real minted `u_...` persona until the founder claims via /auth/redeem.
 */
function pendingFounderUserId(email: string): string {
  const h = createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
  return `u_pending_founder_${h}`;
}

/**
 * Defensive idempotent ensure for `founder_team_invitations` so the founder
 * owner-invite INSERT below never silently fails when this route runs before
 * `registerFounderTeamRoutes` has ensured the table (e.g. in isolated tests /
 * fresh :memory: DBs). Mirrors the founderTeamStore schema (CREATE IF NOT
 * EXISTS — no-op when the real table already exists).
 */
function ensureFounderTeamInvitationsTable(): void {
  try {
    const db: any = rawDb();
    db.exec(`CREATE TABLE IF NOT EXISTS founder_team_invitations (
      id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT NOT NULL,
      invited_by_user_id TEXT NOT NULL,
      invited_email TEXT NOT NULL,
      invited_name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'pending',
      token_hash TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      accepted_at TEXT,
      deleted_at TEXT
    );`);
    // Mirror the real founderTeamStore ensure: idempotently add sent_at so this
    // defensive create matches the authoritative schema exactly.
    try { db.exec(`ALTER TABLE founder_team_invitations ADD COLUMN sent_at TEXT;`); } catch { /* column exists */ }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fti_company ON founder_team_invitations(company_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fti_email ON founder_team_invitations(invited_email);`);
  } catch (err) {
    log.warn("[partnerPortfolioCompanyRoutes] ensureFounderTeamInvitationsTable failed (continuing):", (err as Error).message);
  }
}

export function registerPartnerPortfolioCompanyRoutes(app: Express): void {
  app.post(
    "/api/partner/me/portfolio-companies",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
      const founderEmail = typeof body.founderEmail === "string" ? body.founderEmail.trim().toLowerCase() : "";
      const founderName = typeof body.founderName === "string" ? body.founderName.trim() : "";
      const legalName = typeof body.legalName === "string" ? body.legalName.trim() : "";
      const sector = typeof body.sector === "string" ? body.sector.trim() : "";
      const stage = typeof body.stage === "string" ? body.stage.trim() : "";
      const hq = typeof body.hq === "string" ? body.hq.trim() : "";

      if (!companyName) return res.status(400).json({ error: "COMPANY_NAME_REQUIRED" });
      // 3a: the company is founder-owned + claimed by email, so a valid founder
      // email is required (rule #12/#13 \u2014 we always capture who will own it).
      if (!isEmail(founderEmail)) return res.status(400).json({ error: "FOUNDER_EMAIL_REQUIRED" });

      /* ---------------------------------------------------------------------
         WAVE 214 · SURFACE 1 — THE AUTHORITY CONFIRMATION.

         This is the most exposed third-party-data surface on the platform: the
         partner supplies a company name and another person's email address, and
         the platform creates a real company account plus a claim invitation for
         a person who never asked to be here.

         The check sits HERE deliberately — after the two existing validity
         checks and BEFORE the first durable write (`addCompanyForFounder`
         below). Placing it after any write would leave a company created without
         a confirmation on the record, which is the exact defect.

         It is fail-closed: an absent or non-matching confirmation refuses with
         400. It adds no eligibility condition to WHO may create a company
         (R190.10) — every partner sub-role that could do this before still can;
         it adds a step, not a permission.
      --------------------------------------------------------------------- */
      const authority = evaluateTypedNameAuthority({
        req,
        body,
        surface: WAVE214_AUTHORITY_SURFACES.partnerPortfolioCompany,
        expectedStatement: WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
      });
      if (!authority.ok) {
        return res.status(authority.httpStatus).json({ error: authority.error, message: authority.message });
      }

      const companyId = `co_${randomBytes(6).toString("hex")}`;
      const ownerUserId = pendingFounderUserId(founderEmail);

      /* WAVE 214 — record the envelope (text + sha256 + server timestamp +
         server-observed IP + user agent) against the company and the invitee's
         email. Written BEFORE the company, so the confirmation exists on the
         ledger even if a later step rolls the company back: a confirmation that
         only survives on success would be missing for exactly the attempts
         somebody would later want to investigate. */
      recordAuthorityConfirmation({
        actor: `partner:${ctx.partnerId}:${ctx.userId}`,
        surface: WAVE214_AUTHORITY_SURFACES.partnerPortfolioCompany,
        subject: `company:${companyId}`,
        envelope: authority.envelope,
        route: "POST /api/partner/me/portfolio-companies",
        extra: { founderEmail, companyName, partnerId: ctx.partnerId },
      });

      // 1) Create the independent company via the canonical engine, owned by the
      //    pending-founder id (never the partner). Fail-closed: a persist failure
      //    aborts with 500 and nothing partial is reported as success.
      const company: FounderCompanyMembership = {
        companyId,
        companyName,
        legalName: legalName || `${companyName}, Inc.`,
        logoUrl: null,
        role: "founder",
        lastActiveAt: new Date().toISOString(),
        kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
        collective: { status: "none" },
        billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "\u2014", cardLast4: null, invoiceCount: 0 },
        sector,
        stage,
        hq,
      };
      try {
        addCompanyForFounder(ownerUserId, company);
      } catch (err) {
        log.error("[partnerPortfolioCompanyRoutes] company persist failed:", (err as Error).message);
        return res.status(500).json({ error: "COMPANY_PERSIST_FAILED" });
      }

      // 2) Provision the free subscription (idempotent; non-fatal on failure).
      try {
        const sub = createSubscriptionForNewCompany(companyId, {
          plan: "founder_free",
          actor: `partner:${ctx.partnerId}`,
        });
        if (sub.ok && sub.subscription.status === "pending_payment") {
          updateSubscription(companyId, { status: "active" }, "system:auto_activate_free");
        }
      } catch (err) {
        log.warn("[partnerPortfolioCompanyRoutes] subscription provisioning failed (continuing):", (err as Error).message);
      }

      // 3) Tag attribution to the originating Consortium Partner. REQUIRED +
      //    fail-closed WITH ROLLBACK: attribution is the whole point of 3a, so a
      //    durable-write failure must NOT leave an orphan company. We undo the
      //    just-created company (compensating soft-delete + cache eviction) and
      //    return 500 \u2014 nothing partial is reported as success.
      try {
        linkConsortiumPartner(companyId, ctx.partnerId);
      } catch (err) {
        log.error("[partnerPortfolioCompanyRoutes] attribution link failed \u2014 rolling back company:", (err as Error).message);
        rollbackFounderCompany(ownerUserId, companyId);
        return res.status(500).json({ error: "ATTRIBUTION_LINK_FAILED" });
      }

      // 3b) Record the ATTRIBUTION ROW. Step 3 only writes the company->partner
      //    link; the partner's Clients list, attribution reporting and every
      //    revenue-bearing downstream read come from partnerAttributionStore,
      //    which the portfolio flow never populated. STRICT + fail-closed for
      //    the same reason as step 3: an unattributed portfolio company is
      //    worse than no company. Rollback unwinds the link, then the company.
      try {
        partnerAttributionStore.create(
          ctx.partnerId,
          companyId,
          ctx.userId,
          "partner_portfolio",
          null,
          { strict: true },
        );
      } catch (err) {
        log.error("[partnerPortfolioCompanyRoutes] attribution create failed — rolling back link + company:", (err as Error).message);
        try { unlinkConsortiumPartner(companyId); } catch { /* best-effort */ }
        rollbackFounderCompany(ownerUserId, companyId);
        return res.status(500).json({ error: "ATTRIBUTION_CREATE_FAILED" });
      }

      // 4) Issue the founder OWNER invitation (same founder_team_invitations
      //    schema + /auth/redeem token as the founder-team flow) so the founder
      //    claims their account by email and finishes the canonical profile
      //    builder. This is REQUIRED: without a claim token the pending-founder-
      //    owned company can never be claimed. Fail-closed WITH ROLLBACK \u2014 on
      //    failure we undo BOTH the attribution and the company, then 500.
      let inviteToken: string;
      try {
        ensureFounderTeamInvitationsTable();
        const id = `fti_${Date.now()}_${randomBytes(4).toString("hex")}`;
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const now = new Date().toISOString();
        const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        rawDb()
          .prepare(
            `INSERT INTO founder_team_invitations (
               id, company_id, invited_by_user_id, invited_email, invited_name,
               role, status, token_hash, expires_at, created_at
             ) VALUES (?, ?, ?, ?, ?, 'owner', 'pending', ?, ?, ?)`,
          )
          .run(id, companyId, ctx.userId, founderEmail, founderName || null, tokenHash, expires, now);
        inviteToken = token; // returned ONCE so the partner can send the claim link
      } catch (err) {
        log.error("[partnerPortfolioCompanyRoutes] founder owner-invite failed \u2014 rolling back company + attribution:", (err as Error).message);
        /* w-partner F1 \u2014 step 3b now also wrote an attribution ROW; unwind it
           too or the rolled-back company leaves an orphan attribution. */
        try { partnerAttributionStore.revoke(ctx.partnerId, companyId, ctx.userId); } catch { /* best-effort */ }
        try { unlinkConsortiumPartner(companyId); } catch { /* best-effort */ }
        rollbackFounderCompany(ownerUserId, companyId);
        return res.status(500).json({ error: "FOUNDER_INVITE_FAILED" });
      }

      // 5) Add the company to the partner's pipeline (invited stage), linked by
      //    companyId so it tracks through the standard funnel. NON-FATAL: pipeline
      //    placement is a convenience view and is fully recoverable; the company,
      //    attribution, and claim token already exist durably, so we do not roll
      //    back the create if only the pipeline row fails.
      try {
        partnerPipelineStore.create(
          ctx.partnerId,
          { dealName: companyName, companyId, stage: "invited", sector: sector || null, ownerUserId: ctx.userId },
          ctx.userId,
        );
      } catch (err) {
        log.warn("[partnerPortfolioCompanyRoutes] pipeline link failed (continuing \u2014 company/attribution/invite are durable):", (err as Error).message);
      }

      // 5b) w-partner F1-b \u2014 seed the private portfolio profile so the editor
      //    opens pre-filled instead of blank. NON-FATAL and deliberately seeds
      //    ONLY companyName: `sector` is free text on this route but `industry`
      //    is the INDUSTRY_OPTIONS enum, so copying it across would write a
      //    value that companyProfilePatchSchema later rejects on save.
      try {
        upsertPortfolioProfile(ctx.partnerId, companyId, { contact: { companyName } }, ctx.userId);
      } catch (err) {
        log.warn("[partnerPortfolioCompanyRoutes] portfolio profile seed failed (continuing):", (err as Error).message);
      }

      /* ══ WAVE 186 · ITEM A · R159.1 — THE COMPANY'S OWN CREATION IS RECORDED ══
       * PROVED GAP, not a suspicion. R157.1 reports that a portfolio company was
       * created on live (`co_e60238e18fd2` — the `co_<12 hex>` shape minted at the
       * top of THIS handler) and produced no ledger row. Driving this route
       * locally over real HTTP produced three rows —
       * `subscription.auto_created_on_company_create`, `partner.attribution.created`
       * and `partner.pipeline.created` — every one of them a SIDE EFFECT. There was
       * no `company.created` event type anywhere in the codebase, so the ledger
       * could not answer the first question an auditor asks about a portfolio
       * company: who created it, and when.
       *
       * Recorded here, after all four fail-closed steps have committed (company,
       * subscription, attribution link, attribution row, founder claim token) and
       * before the response, so the row describes a company that certainly exists.
       * Every earlier failure path returns 500 and rolls back, and therefore
       * correctly writes nothing.
       *
       * NOT A BACKFILL: this records creations from now on. Companies created
       * before this ships have no row and will never be given one.
       *
       * The write outcome is CHECKED, not discarded — that discarding is the habit
       * that let a three-month ledger outage pass unnoticed. It does not refuse the
       * creation: the company, its attribution and its claim token are already
       * durable, and rolling all three back over a failed log line would destroy
       * more provenance than it preserves (W186_BUILD.md §3). */
      reportAuditWriteOutcome(
        appendAdminAudit(
          ctx.userId,
          `company:${companyId}`,
          "company.created",
          {
            companyId,
            companyName,
            legalName: company.legalName,
            founderEmail,
            founderName: founderName || null,
            ownerUserId,
            sector: sector || null,
            stage: stage || null,
            hq: hq || null,
            createdByPartnerId: ctx.partnerId,
            origin: "partner_portfolio",
            auditWave: 186,
          },
        ),
        { bearing: "identity", action: "company.created", route: "partner.portfolio-companies.create", subject: companyId },
      );

      res.status(201).json({
        ok: true,
        companyId,
        company,
        attributedPartnerId: ctx.partnerId,
        founderInvite: { email: founderEmail, claimUrl: `https://capavate.com/auth/redeem?token=${inviteToken}` },
      });
    },
  );
}
