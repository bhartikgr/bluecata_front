/**
 * server/lib/wave214CompanyPublicationNotice.ts — WAVE 214, item 3
 *
 * ===========================================================================
 * THE DEFECT THIS ANSWERS
 * ===========================================================================
 * Wave 213 established it precisely (R197.2): a consortium partner promotes a
 * company to the Collective; on approval, the platform notifies EVERY ACTIVE
 * CHAPTER MEMBER, and the company's revenue, ARR, margin, cap-table summary and
 * last valuation become visible to them. THE COMPANY IS NEVER TOLD. Wave 213
 * built the partner's confirmation that it has authority. A partner asserting
 * authority is not the same as the affected party knowing.
 *
 * ===========================================================================
 * WHY THIS IS NOT A SECOND NOTIFIER (R171.1)
 * ===========================================================================
 * It calls `emitNotification` — the SAME function, in the SAME sacred store
 * (`server/notificationsStore.ts`), that `notifyChapterMembersOfApproval`
 * already calls to tell every chapter member. Nothing new is delivered, nothing
 * new is queued, no transport is added. This module contains exactly two things
 * the existing notifier does not have: a RECIPIENT RESOLVER for the company, and
 * a REFUSAL when that resolver cannot find a safe one.
 *
 * ===========================================================================
 * THE RECIPIENT PROBLEM, AND WHY NO EMAIL ADDRESS IS EVER GUESSED
 * ===========================================================================
 * The brief's hard constraint: "If you cannot establish a safe recipient address
 * from data the platform already holds, DO NOT INVENT ONE... An email to a wrong
 * or guessed address is worse than no email."
 *
 * That risk is structurally absent here, and the reason is worth stating because
 * it was the deciding factor in the design. `emitNotification`'s default channel
 * set is `{ inApp: true, email: false, push: false }` — verified in the sacred
 * store. So the recipient of a notification on this platform is a **userId**,
 * not an address. There is no address to get wrong. The notice appears in the
 * company's own in-app notification feed, delivered over the existing SSE hub,
 * to accounts that already exist and already authenticate.
 *
 * The recipients are resolved from `company_members` — the durable membership
 * table written by `addCompanyForFounder` and by team-invite redemption — with
 * `is_active = 1 AND deleted_at IS NULL`, restricted to owning roles.
 *
 * ===========================================================================
 * THE ONE INERT CASE, AND WHY IT IS LEFT INERT RATHER THAN FORCED
 * ===========================================================================
 * `server/partnerPortfolioCompanyRoutes.ts` creates partner-originated companies
 * owned by `u_pending_founder_<sha256(email).slice(0,16)>` — a DERIVED
 * PLACEHOLDER for a person who has not claimed the account. It is not a real
 * identity: nobody can sign in as it, so nobody will ever read a notification
 * addressed to it. Delivering there would produce a row in a feed no human can
 * open, and a build report claiming the company had been told. That is worse
 * than reporting the gap.
 *
 * So: placeholder-only ownership => NO notice, and an explicit admin-visible
 * audit row naming the reason. This is the case the brief anticipated, and it is
 * reported to the owner rather than papered over.
 *
 * ===========================================================================
 * WHAT THE NOTICE MUST NOT SAY — THE LEAK CONSTRAINT
 * ===========================================================================
 * The body is built by `wave214CompanyPublicationNoticeBody(publisherName)` in
 * `shared/wave214ThirdPartyAuthorityCopy.ts` and interpolates EXACTLY ONE
 * variable: the publishing firm's display name. Nothing in this file reads
 * `listActiveChapterMemberUserIds`, `chapterMemberships`, any note, any viewer
 * list or any count of members, and the test
 * `w214_publication_notice_no_member_leak` asserts a notice generated while a
 * chapter is populated with distinctively-named members contains none of their
 * identifiers.
 *
 * ===========================================================================
 * R190.10 — NOTHING IS RESTRICTED
 * ===========================================================================
 * This module has no return value that any caller branches on to withhold
 * anything. It is invoked AFTER the moderation decision has been applied and
 * AFTER the chapter has been notified. Every field stays visible to everyone who
 * could see it before, the audience is unchanged, and no eligibility condition is
 * added. It adds notice. That is all it does.
 */
import { rawDb } from "../db/connection";
import { emitNotification } from "../notificationsStore";
import { appendAdminAudit, reportAuditWriteOutcome } from "../adminPlatformStore";
import { getById as getContactById } from "../adminContactsStoreShim";
import { log } from "./logger";
import {
  WAVE214_COMPANY_PUBLICATION_NOTICE_TITLE,
  WAVE214_NOTICE_INERT_REASONS,
  wave214CompanyPublicationNoticeBody,
  type Wave214NoticeInertReason,
} from "../../shared/wave214ThirdPartyAuthorityCopy";

/** The audit event names. Two outcomes, two spellings, both greppable. */
export const WAVE214_NOTICE_SENT_EVENT = "company.publication_notice.sent";
export const WAVE214_NOTICE_INERT_EVENT = "company.publication_notice.not_sent";

/**
 * The prefix `partnerPortfolioCompanyRoutes.pendingFounderUserId()` produces.
 * Duplicated as a constant here rather than imported, deliberately: importing a
 * route module into a notification helper would pull an Express registration
 * graph into this file for the sake of one string. The test
 * `w214_publication_notice_recipients` asserts this constant is a prefix of a
 * genuine id produced by that function, so the duplication cannot drift silently.
 */
export const WAVE214_PENDING_FOUNDER_PREFIX = "u_pending_founder_";

/** Roles in `company_members` that represent the company itself. */
const OWNING_DB_ROLES = ["founder", "co_founder", "admin"] as const;

export interface Wave214NoticeOutcome {
  /** Whether a notification was actually emitted to at least one account. */
  sent: boolean;
  /** The userIds notified. Empty when `sent` is false. */
  recipients: string[];
  /** Placeholder ids deliberately skipped. Reported, never notified. */
  skippedPlaceholders: string[];
  /** Set when `sent` is false. Named, never a bare boolean or a zero. */
  inertReason: Wave214NoticeInertReason | null;
  /** The admin-visible sentence for `inertReason`. */
  inertReasonText: string | null;
}

/**
 * Resolve the company's own accounts.
 *
 * Raw SQL on the same connection every other membership reader uses. It does not
 * go through `multiCompanyStore`'s cache: handbook §5.8 records that a cache can
 * be AHEAD of the database, and for the purpose of "who can actually read a
 * notification" the durable rows are the truth.
 */
export function resolveCompanyNoticeRecipients(companyId: string): {
  claimed: string[];
  placeholders: string[];
} {
  const claimed: string[] = [];
  const placeholders: string[] = [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT user_id AS userId FROM company_members
           WHERE company_id = ?
             AND is_active = 1
             AND deleted_at IS NULL
             AND role IN (${OWNING_DB_ROLES.map(() => "?").join(", ")})`,
      )
      .all(companyId, ...OWNING_DB_ROLES) as Array<{ userId?: string }>;
    for (const r of rows) {
      const uid = typeof r.userId === "string" ? r.userId : "";
      if (!uid) continue;
      if (uid.startsWith(WAVE214_PENDING_FOUNDER_PREFIX)) placeholders.push(uid);
      else claimed.push(uid);
    }
  } catch (err) {
    log.warn("[wave214Notice] recipient resolution failed:", (err as Error).message);
  }
  return { claimed, placeholders };
}

/**
 * The publishing firm's display name, or null.
 *
 * Returning null rather than a plausible substitute is the R201.2 discipline: a
 * notice that says a made-up firm published your data is a fabrication with a
 * legal edge on it. When the name cannot be resolved the notice is NOT sent and
 * the reason is recorded — see the caller below.
 */
export function resolvePublisherDisplayName(partnerId: string): string | null {
  try {
    const contact = getContactById(partnerId);
    const name = contact?.displayName || contact?.legalName || "";
    return name.length > 0 ? name : null;
  } catch (err) {
    log.warn("[wave214Notice] publisher name resolution failed:", (err as Error).message);
    return null;
  }
}

/**
 * Notify a company that its profile was published to the Collective.
 *
 * Call AFTER the publication has been applied and after the chapter has been
 * notified. Never throws: a notification failure must not roll back a moderation
 * decision that has already taken effect, and must not be able to make the
 * publish path refuse — that would be a restriction, which R190.10 forbids.
 */
export function notifyCompanyOfPublication(args: {
  companyId: string | null | undefined;
  partnerId: string;
  promotionId: string;
  actor: string;
  link?: string;
}): Wave214NoticeOutcome {
  const { companyId, partnerId, promotionId, actor } = args;
  const link = args.link ?? "/founder/company";

  const inert = (reason: Wave214NoticeInertReason, recipients: string[], placeholders: string[]): Wave214NoticeOutcome => {
    const text = WAVE214_NOTICE_INERT_REASONS[reason];
    try {
      const entry = appendAdminAudit(
        actor,
        companyId ? `company:${companyId}` : `promotion:${promotionId}`,
        WAVE214_NOTICE_INERT_EVENT,
        {
          promotionId,
          partnerId,
          companyId: companyId ?? null,
          inertReason: reason,
          inertReasonText: text,
          skippedPlaceholderCount: placeholders.length,
          skippedPlaceholders: placeholders,
        },
      );
      reportAuditWriteOutcome(entry, {
        bearing: "identity",
        action: WAVE214_NOTICE_INERT_EVENT,
        route: "promotion.moderation.approve",
        subject: companyId ?? promotionId,
      });
    } catch (err) {
      log.error("[wave214Notice] inert-reason audit failed:", (err as Error).message);
    }
    return { sent: false, recipients, skippedPlaceholders: placeholders, inertReason: reason, inertReasonText: text };
  };

  if (!companyId) return inert("noCompanyOnRecord", [], []);

  const { claimed, placeholders } = resolveCompanyNoticeRecipients(companyId);
  if (claimed.length === 0) return inert("noClaimedOwner", [], placeholders);

  const publisher = resolvePublisherDisplayName(partnerId);
  if (publisher === null) return inert("notifierFailed", [], placeholders);

  const body = wave214CompanyPublicationNoticeBody(publisher);
  const delivered: string[] = [];
  for (const uid of claimed) {
    try {
      emitNotification({
        userId: uid,
        /* The kind is an EXISTING member of the closed `NotificationKind` union
           in the sacred notifications store. Adding a kind would require editing
           a frozen file, and there is no tenth waiver. `partner.promotion_approved`
           is the correct existing kind: this notice IS the approval of a partner
           promotion, seen from the other side. */
        kind: "partner.promotion_approved",
        title: WAVE214_COMPANY_PUBLICATION_NOTICE_TITLE,
        body,
        link,
      });
      delivered.push(uid);
    } catch (err) {
      log.warn("[wave214Notice] emitNotification failed for one recipient:", (err as Error).message);
    }
  }

  if (delivered.length === 0) return inert("notifierFailed", [], placeholders);

  try {
    const entry = appendAdminAudit(
      actor,
      `company:${companyId}`,
      WAVE214_NOTICE_SENT_EVENT,
      {
        promotionId,
        partnerId,
        companyId,
        publisherDisplayName: publisher,
        recipientCount: delivered.length,
        recipients: delivered,
        skippedPlaceholders: placeholders,
        noticeTitle: WAVE214_COMPANY_PUBLICATION_NOTICE_TITLE,
        noticeBody: body,
      },
    );
    reportAuditWriteOutcome(entry, {
      bearing: "identity",
      action: WAVE214_NOTICE_SENT_EVENT,
      route: "promotion.moderation.approve",
      subject: companyId,
    });
  } catch (err) {
    log.error("[wave214Notice] sent-notice audit failed:", (err as Error).message);
  }

  return { sent: true, recipients: delivered, skippedPlaceholders: placeholders, inertReason: null, inertReasonText: null };
}
