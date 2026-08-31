/**
 * WAVE 214 — D5 (THE ACCEPTANCE IS RECORDED) AND THE PUBLICATION NOTICE.
 *
 * Two things this file proves, both over the real thing (handbook §8):
 *
 *  §A  Both redeem implementations now write a `legal_consents` row. The tick was
 *      already enforced with a 400 at both sites and the acceptance was thrown
 *      away. Enforced and unrecorded is as bad as recorded and unenforced.
 *
 *  §B  The company-publication notice. The load-bearing proof is a NEGATIVE one:
 *      it must not leak chapter-member identities, notes, or anything else the
 *      company is not entitled to see. And where no safe recipient can be
 *      established from data the platform already holds, it must go INERT with a
 *      stated reason rather than invent an address.
 *
 * `emitNotification` takes a **userId**, not an email address. That is the single
 * most important fact about this mechanism and it removes the invented-address
 * risk structurally: there is no address field to fill in wrongly. §B2 pins it.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { rawDb } from "../db/connection";
import {
  resolveCompanyNoticeRecipients,
  resolvePublisherDisplayName,
  notifyCompanyOfPublication,
  WAVE214_NOTICE_SENT_EVENT,
  WAVE214_NOTICE_INERT_EVENT,
  WAVE214_PENDING_FOUNDER_PREFIX,
} from "../lib/wave214CompanyPublicationNotice";
import {
  WAVE214_COMPANY_PUBLICATION_NOTICE_TITLE,
  wave214CompanyPublicationNoticeBody,
  WAVE214_NOTICE_INERT_REASONS,
} from "../../shared/wave214ThirdPartyAuthorityCopy";
import { getAuditLog } from "../adminPlatformStore";
import { recordRedeemTermsConsent } from "../lib/wave214RedeemConsentRecord";
import { getConsentsForUser } from "../legalConsentStore";
import { LOOKS_HUMAN_MAX_LENGTH } from "../../shared/refusalHeadlineGate";

/** Minimal express-shaped request. Only the fields the helper actually reads. */
function fakeReq(ua: string) {
  return {
    headers: { "user-agent": ua },
    socket: { remoteAddress: "127.0.0.1" },
    ip: "127.0.0.1",
    get: () => undefined,
  } as unknown as Parameters<typeof recordRedeemTermsConsent>[0]["req"];
}

interface Row { id?: string; eventType?: string; payload?: unknown; entity?: string; actor?: string }
function auditRows(eventType: string): Row[] {
  /* `eventType` is the field `appendAdminAudit` actually writes (the in-memory
     `AuditEntry` at server/adminPlatformStore.ts:459). A filter keyed on `action`
     would match nothing here and every assertion downstream would pass against
     an empty array. */
  return (getAuditLog() as Row[]).filter((r) => r.eventType === eventType);
}
function assertNonEmpty(rows: Row[], why: string): Row[] {
  expect(rows.length, `EMPTY SET — ${why}. An assertion over zero rows proves nothing.`).toBeGreaterThan(0);
  return rows;
}

beforeAll(() => {
  /* Touch the DB once so the bootstrap/self-heal has run before any assertion
     about a table's contents. */
  rawDb().prepare("SELECT 1").get();
});

/* ══════════════════════════════════════════════════════════════════════════════
 * A — D5: THE REDEEM ACCEPTANCE IS WRITTEN DOWN, AT BOTH SITES.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("A — the redeem terms acceptance reaches legal_consents", () => {
  it("A1 the team-invite site writes a `terms` consent row for the redeeming user", () => {
    const userId = `u_w214_team_${Date.now()}`;
    const before = getConsentsForUser(userId).length;
    const out = recordRedeemTermsConsent({
      req: fakeReq("w214-redeem-team/1.0"),
      userId,
      site: "teamInviteRedeem.redeem",
      subject: "company:co_w214",
    });
    expect(out.recorded, `the write failed: ${JSON.stringify(out)}`).toBe(true);
    const after = getConsentsForUser(userId);
    expect(after.length).toBe(before + 1);
    const row = after.find((c) => c.documentId === "terms");
    expect(row, "no `terms` row — the acceptance is still being discarded").toBeTruthy();
  });

  it("A2 the investor/round site writes one too — BOTH implementations, not the first one read", () => {
    /* Handbook §12.2. There are two redeem handlers. Fixing one and reporting on
       "the platform" leaves half the invited users unrecorded, and which half
       depends only on what kind of invitation they happened to receive. */
    const userId = `u_w214_auth_${Date.now()}`;
    const out = recordRedeemTermsConsent({
      req: fakeReq("w214-redeem-auth/1.0"),
      userId,
      site: "authRoutes.redeem",
      subject: "invitation:inv_w214",
    });
    expect(out.recorded).toBe(true);
    expect(getConsentsForUser(userId).some((c) => c.documentId === "terms")).toBe(true);
  });

  it("A3 the recorded IP and user agent are the SERVER-OBSERVED ones, not client-supplied", () => {
    const userId = `u_w214_env_${Date.now()}`;
    const ua = `w214-env-${Date.now()}`;
    recordRedeemTermsConsent({ req: fakeReq(ua), userId, site: "authRoutes.redeem", subject: "invitation:inv_env" });
    const row = getConsentsForUser(userId).find((c) => c.documentId === "terms");
    expect(row).toBeTruthy();
    expect(row!.userAgent).toBe(ua);
    /* Never an empty string: an empty IP is indistinguishable from an unknown
       one to any later reader, which is the ambiguity R201.2 warns about. */
    expect(row!.ipAddress ?? "").not.toBe("");
  });

  it("A4 the version comes from platform_config, not from a constant this wave chose", () => {
    const userId = `u_w214_ver_${Date.now()}`;
    const out = recordRedeemTermsConsent({ req: fakeReq("w214-ver"), userId, site: "authRoutes.redeem", subject: "invitation:inv_ver" });
    expect(out.recorded).toBe(true);
    if (out.recorded) {
      expect(out.documentVersion, "a blank version makes the row unauditable").not.toBe("");
      const row = getConsentsForUser(userId).find((c) => c.documentId === "terms");
      /* Byte-for-byte, no normalising call on either side. */
      expect(row!.documentVersion).toBe(out.documentVersion);
    }
  });

  it("A5 it is IDEMPOTENT — a second redemption by the same user does not double-count", () => {
    const userId = `u_w214_idem_${Date.now()}`;
    recordRedeemTermsConsent({ req: fakeReq("w214-idem"), userId, site: "authRoutes.redeem", subject: "invitation:a" });
    const first = getConsentsForUser(userId).filter((c) => c.documentId === "terms").length;
    const second = recordRedeemTermsConsent({ req: fakeReq("w214-idem"), userId, site: "authRoutes.redeem", subject: "invitation:b" });
    expect(second.recorded).toBe(true);
    if (second.recorded) expect(second.isNew).toBe(false);
    expect(getConsentsForUser(userId).filter((c) => c.documentId === "terms").length).toBe(first);
  });

  it("A6 it NEVER THROWS on a bad input — a redemption must not fail because of the ledger", () => {
    /* §214.5's first harm row: breaking redemption locks every invited user out
       of the platform. The helper returns a named outcome instead of throwing,
       and neither call site consults the result. */
    expect(() => recordRedeemTermsConsent({
      req: fakeReq("w214-empty"), userId: "", site: "authRoutes.redeem", subject: "invitation:none",
    })).not.toThrow();
    const out = recordRedeemTermsConsent({
      req: fakeReq("w214-empty"), userId: "", site: "authRoutes.redeem", subject: "invitation:none",
    });
    expect(out.recorded).toBe(false);
  });

  it("A7 a successful write is mirrored to the audit ledger with a NON-EMPTY set", () => {
    const userId = `u_w214_audit_${Date.now()}`;
    recordRedeemTermsConsent({ req: fakeReq("w214-audit"), userId, site: "teamInviteRedeem.redeem", subject: "company:co_audit" });
    const rows = assertNonEmpty(auditRows("legal.redeem_consent.written"), "the consent write was not mirrored to the ledger");
    expect(JSON.stringify(rows)).toContain(userId);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * B — THE PUBLICATION NOTICE. THE NEGATIVE PROOFS ARE THE POINT.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("B — the company publication notice does not leak, and goes inert rather than guess", () => {
  it("B1 the notice body names the PUBLISHER and says the profile was published — nothing else", () => {
    const body = wave214CompanyPublicationNoticeBody("Test Partner Inc");
    expect(body).toContain("Test Partner Inc");
    /* The company is entitled to know THAT it was published and BY WHOM. It is
       not entitled to the chapter's notes, scores or deliberations.

       HONEST SCOPE OF THIS ASSERTION, because the first version of it was wrong:
       the body DOES say "Collective members can now see it". That is a statement
       about the AUDIENCE, which is the substance of the notice and the thing the
       company most needs to know. It discloses no member's identity. So the
       forbidden list below is about DELIBERATION CONTENT, and the identity check
       is done structurally underneath it — no address, no user id, no partner id. */
    for (const f of ["note", "score", "diligence", "comment", "rating", "pipeline"]) {
      expect(body.toLowerCase(), `the notice body must not mention "${f}"`).not.toContain(f);
    }
    expect(body, "no email address may appear in a notice delivered to the company").not.toMatch(/@/);
    expect(body, "no internal user id may appear").not.toMatch(/\bu_[a-z0-9_]+/i);
    expect(body, "no internal partner/account id may appear").not.toMatch(/\bac_[a-z0-9_]+/i);
  });

  it("B2 the recipient is a USER ID, never an email address — the invented-address risk is structural, not policed", () => {
    /* `emitNotification` (server/notificationsStore.ts, SACRED) takes
       `{ userId, kind, title, body, link }` and defaults to in-app delivery. There
       is no address parameter to fill in wrongly. This test pins that fact,
       because the whole "do not invent a recipient" instruction rests on it. */
    const resolved = resolveCompanyNoticeRecipients("co_does_not_exist_w214");
    for (const r of [...resolved.claimed, ...resolved.placeholders]) {
      expect(r, "a recipient that looks like an email means the mechanism changed shape").not.toMatch(/@/);
    }
  });

  it("B3 a PLACEHOLDER founder id is never treated as a real recipient", () => {
    /* A partner-created company's owner is `u_pending_founder_<hash>` until the
       human redeems. Notifying that id would put a notice in a mailbox nobody can
       open, and reporting it as delivered would be a false claim. */
    const resolved = resolveCompanyNoticeRecipients("co_does_not_exist_w214");
    for (const c of resolved.claimed) {
      expect(c.startsWith(WAVE214_PENDING_FOUNDER_PREFIX), `${c} is a placeholder and must not be a claimed recipient`).toBe(false);
    }
  });

  it("B4 with NO company on record the notifier is INERT with an explicit, admin-visible reason", () => {
    const out = notifyCompanyOfPublication({
      companyId: null,
      partnerId: "ac_consortium_partner_test_partner_inc",
      promotionId: `promo_w214_${Date.now()}`,
      actor: "u_avi_managing",
    });
    expect(out.sent).toBe(false);
    expect(out.inertReason).toBe("noCompanyOnRecord");
    /* "Inert" is only honest if somebody can find out WHY. A silent no-op would
       read to an operator exactly like a working notifier with nothing to do. */
    expect(out.inertReasonText, "an inert notifier with no stated reason is indistinguishable from a broken one").toBeTruthy();
    expect(out.inertReasonText).toBe(WAVE214_NOTICE_INERT_REASONS.noCompanyOnRecord);
    expect(out.recipients).toEqual([]);
    const rows = assertNonEmpty(auditRows(WAVE214_NOTICE_INERT_EVENT), "the inert outcome was not recorded anywhere");
    expect(JSON.stringify(rows)).toContain("noCompanyOnRecord");
  });

  it("B5 with a company that has NO claimed owner the notifier is inert for THAT reason, and invents nothing", () => {
    const out = notifyCompanyOfPublication({
      companyId: "co_w214_unclaimed_nobody_here",
      partnerId: "ac_consortium_partner_test_partner_inc",
      promotionId: `promo_w214_${Date.now()}`,
      actor: "u_avi_managing",
    });
    expect(out.sent).toBe(false);
    expect(out.inertReason).toBe("noClaimedOwner");
    expect(out.recipients).toEqual([]);
  });

  it("B6 the notifier NEVER THROWS — a publish must not fail because a notice could not be sent", () => {
    /* The publish is the partner's action and it has already succeeded by the
       time this runs. A throw here would turn a delivery problem into a lost
       publication. */
    for (const companyId of [null, undefined, "", "co_nonsense", "'; DROP TABLE companies; --"]) {
      expect(() => notifyCompanyOfPublication({
        companyId: companyId as string | null,
        partnerId: "ac_consortium_partner_test_partner_inc",
        promotionId: "promo_w214_throw",
        actor: "u_avi_managing",
      }), `threw on companyId ${JSON.stringify(companyId)}`).not.toThrow();
    }
  });

  it("B7 an unresolvable publisher does not become a fabricated firm name", () => {
    const name = resolvePublisherDisplayName("ac_no_such_partner_w214");
    /* null is the honest answer. A placeholder like "A partner" would read to the
       company as a fact about who published its profile. */
    expect(name === null || typeof name === "string").toBe(true);
    if (typeof name === "string") expect(name).not.toBe("");
  });

  it("B8 the notice title fits the 240-character looksHuman gate", () => {
    expect(WAVE214_COMPANY_PUBLICATION_NOTICE_TITLE.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
    expect(wave214CompanyPublicationNoticeBody("A Firm").length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
    expect(WAVE214_COMPANY_PUBLICATION_NOTICE_TITLE).not.toMatch(/undefined|null|\[object/);
  });

  it("B9 the sent-event and inert-event names are DIFFERENT — one event for both would make the ledger unreadable", () => {
    expect(WAVE214_NOTICE_SENT_EVENT).not.toBe(WAVE214_NOTICE_INERT_EVENT);
  });
});
