/**
 * server/marketingConsentStore.ts — WAVE 344 · ITEM 3. EXPRESS CONSENT.
 *
 * ── WHAT THE OWNER ASKED FOR, AND THE ONE THING HE CANNOT HAVE ─────────────
 * "Include express consent during signup… Users should also be able to change
 * their choice in their settings area. I want this to be easy, seamless, and have
 * users want to consent without any burden."
 *
 * THE SEAMLESS VERSION IS THE INVALID ONE, AND THAT HAS TO BE SAID PLAINLY. The
 * frictionless design — a box that arrives already ticked, or permission folded
 * into accepting the terms — is exactly the design the Canadian regulator names as
 * NOT express consent: "Express consent cannot be obtained through opt-out consent
 * mechanisms" (CRTC Compliance and Enforcement Information Bulletin 2012-548 ¶18).
 * So what is built is the version that is easy to UNDERSTAND and easy to SAY NO
 * TO. The burden that has been removed is the burden of DECLINING — declining is
 * doing nothing, and withdrawing later is one click in settings with no
 * confirmation step, no warning, and no "are you sure you want to miss out".
 *
 * ── THE FIVE THINGS THIS MODULE GUARANTEES ────────────────────────────────
 *  1. SIGNUP SUCCEEDS WITHOUT IT, STRUCTURALLY. There is no consent parameter on
 *     POST /api/auth/signup and this module is not imported by the signup
 *     handler. The signup screen records a decision AFTER the account exists, by
 *     calling POST /api/consent/marketing, and only when the person ticked the
 *     box. A consent failure therefore cannot fail a signup, because the two are
 *     different requests. server/__tests__/w344_item3_marketing_consent.test.ts
 *     asserts both the absence of the parameter and a successful signup with no
 *     consent field at all.
 *  2. THE BOX IS SEPARATE, UNTICKED AND OPTIONAL. It is not the terms checkbox and
 *     it is not bundled with it; the terms box stays required and this one stays
 *     optional. The screen ships it unchecked and there is no code path that
 *     defaults it to true.
 *  3. THE REQUEST CARRIES THE FOUR REQUIRED PARTS, AND THE RECORD KEEPS THE EXACT
 *     WORDING. Purposes, who is asking, a mailing address, and a statement that
 *     permission can be withdrawn (Bulletin 2012-548 ¶16, and 2012-549 on
 *     record-keeping). `buildDisclosure()` composes the sentence; the SERVER
 *     re-derives it and stores its own copy, so a caller cannot record a person as
 *     having agreed to wording nobody ever showed them.
 *  4. TWO SEPARATE THINGS, AND SERVICE MESSAGES ARE NEVER GATED. Marketing
 *     permission lives here. Service, security, transactional and platform
 *     messages are not represented here at all — there is no flag for them, the
 *     permission-kind list has one member, `isNeverConsentGated` refuses the
 *     spellings, and the database trigger refuses them independently. Withdrawing
 *     marketing can therefore never stop somebody's security email.
 *  5. WITHDRAWAL IS AS EASY AS GIVING IT. The same endpoint, the same one action,
 *     from a screen the person can already reach. No confirmation dialog, no
 *     re-authentication, no email round-trip, no "contact support".
 *
 * ── THE ONE FACT ONLY THE OWNER CAN SUPPLY, AND WHAT HAPPENS UNTIL HE DOES ──
 * The regulator requires the consent request to carry a MAILING ADDRESS. There is
 * no mailing address anywhere in this tree, and inventing one would be worse than
 * having none: it would produce a consent record that looks valid and is not, for
 * every person who ever ticks the box.
 *
 * So the address is configuration with NO DEFAULT, read from the environment
 * (MARKETING_CONSENT_MAILING_ADDRESS, plus the optional
 * MARKETING_CONSENT_REQUESTER_IDENTITY). Until it is set:
 *   · `consentAvailability()` reports unavailable with a reason a person can read;
 *   · the consent box DOES NOT RENDER on signup or in settings;
 *   · POST /api/consent/marketing REFUSES with 503 and stores nothing;
 *   · signup, sign-in and every service message are entirely unaffected;
 *   · no marketing permission exists, so no marketing may be sent.
 * That is stated in OWNERBAND2_FOR_THE_OWNER.md as an action for the owner.
 *
 * ── WAVE 345 (consentaddress) — VERIFICATION NOTE, APPENDED NOT REWRITTEN ───
 * THE MECHANISM ABOVE WAS RE-MEASURED BEFORE ANYTHING WAS CHANGED, and the
 * paragraph above it is correct as written. Specifically:
 *   · The name is `MARKETING_CONSENT_MAILING_ADDRESS`. Confirmed by reading this
 *     file, `.env.example`, and the two tests that reference it.
 *   · IT IS ALREADY CONFIGURATION, NOT A BUILD-TIME CONSTANT. `buildDisclosure()`
 *     reads `process.env` on EVERY call — it is not captured into a module-level
 *     constant at import time, and nothing bakes it into a component. So the owner
 *     can change the address without a code release. Nothing had to be converted;
 *     this wave verified the claim rather than assuming it, and the proof is a
 *     test that changes the variable at runtime and observes the request change.
 *   · The address is now SUPPLIED, in `.env`, as the owner ruled: Toronto first,
 *     Hong Kong beneath it, the entity name above each. The box is therefore live.
 *   · The inert path is NOT removed and NOT weakened. Blank the variable and the
 *     box goes inert again, exactly as before. That is proved by disarm.
 */

import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { rawDb } from "./db/connection";
import { requireAuth } from "./lib/authMiddleware";
import { log } from "./lib/logger";
import {
  CONSENT_DECISIONS,
  MARKETING_CONSENT_KIND,
  MARKETING_CONSENT_TABLE,
  ensureMarketingConsentSchema,
  isNeverConsentGated,
} from "./lib/marketingConsentSchema";

/** THE COMPLETE LIST OF TABLES THIS FEATURE WRITES. One member. No money table,
 *  no cap-table table, no tamper-sealed table, and NOT `legal_consents`. */
export const CONSENT_WRITE_TABLES: readonly string[] = Object.freeze([
  MARKETING_CONSENT_TABLE,
]);

/** Bumped whenever the wording below changes. Stored on every record, ALONGSIDE
 *  the wording itself — a version tag alone is not enough, because the text a
 *  version refers to is exactly what gets lost. */
export const DISCLOSURE_VERSION = "w345-1";
/* WAVE 345 (consentaddress) — BUMPED FROM "w344-1", WITH THE REASON STATED.
 *
 * The tripwire in OWNERBAND2_HANDOFF §5 says: change the consent wording, bump
 * this. The wording changed in exactly one respect — the mailing address is no
 * longer folded into the middle of a sentence but stands as its OWN VERBATIM
 * BLOCK, line for line, with the sentence about how long it stays valid. That was
 * required because the address the owner supplied is a two-part postal address
 * (Toronto over Hong Kong) which cannot be rendered correctly inside a sentence.
 * Bumping means any page opened against the old wording is refused with 409
 * rather than recorded against text nobody showed that person. No stored row is
 * altered: rows keep the version and the wording that was on the screen. */

export interface Disclosure {
  version: string;
  /** The whole sentence, exactly as it is shown. This is what gets stored. */
  text: string;
  purposes: string;
  requesterIdentity: string;
  mailingAddress: string;
  withdrawalStatement: string;
}

export interface ConsentAvailability {
  available: boolean;
  /** Present only when unavailable. Written for a person, and it says that no
   *  permission is being collected rather than implying everything is fine. */
  reason?: string;
  disclosure?: Disclosure;
}

const PURPOSES =
  "occasional marketing emails about new features, upcoming events, and news about the platform";

/**
 * Compose the consent request.
 *
 * The four required parts are assembled into ONE sentence block, and that block is
 * what is shown and what is stored. The mailing address and the withdrawal
 * statement are substrings of it by construction, which is what lets the database
 * CHECK constraints verify that the stored wording really did contain them.
 */
export function buildDisclosure(): ConsentAvailability {
  const mailingAddress = (process.env.MARKETING_CONSENT_MAILING_ADDRESS ?? "").trim();
  const requesterIdentity = (
    process.env.MARKETING_CONSENT_REQUESTER_IDENTITY ?? "Capavate"
  ).trim();

  if (!mailingAddress) {
    return {
      available: false,
      reason:
        "Marketing permission is not being asked for yet, because the postal address " +
        "that the request has to include has not been set. Nothing is affected apart " +
        "from marketing email, and no marketing is being sent to anyone.",
    };
  }
  if (!requesterIdentity) {
    return {
      available: false,
      reason:
        "Marketing permission is not being asked for yet, because the name of the " +
        "business making the request has not been set. No marketing is being sent to anyone.",
    };
  }

  const withdrawalStatement =
    "You can withdraw this permission at any time from your account settings, in one step.";
  /* THE ADDRESS IS ITS OWN BLOCK, VERBATIM, LINE FOR LINE.

     WAVE 345. The address the owner supplied is a two-part postal address — a
     Toronto address with a Hong Kong address beneath it, each under the entity
     name — and a postal address is read as lines, not as a clause. Folded into a
     sentence it would render as one run-on line and would not be the address he
     ruled. So it is interpolated exactly as configured, between blank lines, and
     the screen renders it with the line breaks preserved.

     The 60-day sentence is not decoration. The regulator requires the address in
     the request to stay valid for at least sixty days after a message is sent;
     saying so in the request is what makes that promise part of what the person
     agreed to, and what the stored record then carries. */
  const text =
    `${requesterIdentity} would like to send you ${PURPOSES}. ` +
    `This is optional and separate from your account: you do not need to agree to it to ` +
    `use the platform, and messages we have to send you about your account and its ` +
    `security are not affected by this choice either way. ` +
    `This request is made by ${requesterIdentity}. Our mailing address, which stays valid ` +
    `for at least 60 days after any message we send you, is:\n\n` +
    `${mailingAddress}\n\n` +
    `${withdrawalStatement}`;

  /* ── THE FAIL-SAFE, AND WHY IT IS A SUBSTRING CHECK AND NOT A NULL CHECK ──

     A consent request that is missing any of the four required parts is not a
     weaker request; it is an INVALID one, and every record it produces is
     worthless. The absence check above catches the ordinary case (nobody has set
     the address yet). This catches the case that a null check cannot see: the
     address, the purposes, the identity or the withdrawal statement being present
     as a VARIABLE but absent from the SENTENCE — a composition edit that drops an
     interpolation, which reads as a green typecheck and a normal-looking screen.

     If that ever happens the box goes INERT again rather than asking badly. An
     inert box is honest. An incomplete one manufactures a record that looks valid
     and is not. Note this is the same property the database CHECK constraints
     enforce at the point of storage — this is the same rule enforced one step
     earlier, at the point of DISPLAY, so nothing incomplete is ever shown. */
  const missing = (
    [
      ["the purposes", PURPOSES],
      ["the name of the business making the request", requesterIdentity],
      ["the postal address", mailingAddress],
      ["the statement that permission can be withdrawn", withdrawalStatement],
    ] as ReadonlyArray<readonly [string, string]>
  )
    .filter(([, part]) => !part.trim() || !text.includes(part))
    .map(([label]) => label);
  if (missing.length > 0) {
    return {
      available: false,
      reason:
        "Marketing permission is not being asked for, because the request would not be " +
        `complete — it is missing ${missing.join(", ")}. Nothing is affected apart from ` +
        "marketing email, and no marketing is being sent to anyone.",
    };
  }

  return {
    available: true,
    disclosure: {
      version: DISCLOSURE_VERSION,
      text,
      purposes: PURPOSES,
      requesterIdentity,
      mailingAddress,
      withdrawalStatement,
    },
  };
}

export function consentAvailability(): ConsentAvailability {
  return buildDisclosure();
}

/* ────────────────────────────── the handle ────────────────────────────── */

interface SqliteLike {
  prepare(sql: string): {
    all(...a: unknown[]): unknown[];
    get(...a: unknown[]): unknown;
    run(...a: unknown[]): unknown;
  };
  exec(sql: string): unknown;
}

let installedOn: unknown = null;

/** The raw handle with migration 0235 installed, or null. `rawDb()` and not
 *  `getDb()`: the Drizzle wrapper has no `.prepare`, so a guard written against it
 *  would silently no-op. */
export function consentDb(): SqliteLike | null {
  let db: SqliteLike | null = null;
  try {
    const handle = rawDb() as unknown as SqliteLike;
    if (handle && typeof handle.prepare === "function") db = handle;
  } catch (e) {
    log.warn("[marketingConsentStore] rawDb() unavailable:", (e as Error).message);
    return null;
  }
  if (!db) return null;
  if (installedOn !== db) {
    const r = ensureMarketingConsentSchema(db);
    if (r.failures.length) {
      log.error("[marketingConsentStore] schema install failed:", r.failures.join("; "));
      return null;
    }
    installedOn = db;
  }
  return db;
}

/* ───────────────────────────── read the state ─────────────────────────── */

export interface ConsentState {
  /** null means NEVER ASKED, which is a different fact from "asked and said no".
   *  Neither one is permission. */
  decision: string | null;
  decidedAt: string | null;
  channel: string | null;
  disclosureVersion: string | null;
  /** The wording this person actually saw, when they last decided. */
  disclosureText: string | null;
  /** True only for an explicit, current 'granted'. */
  allowsMarketing: boolean;
}

/**
 * A person's CURRENT permission: the most recent decision they made.
 *
 * Read as the latest row rather than as a mutable flag, because that is what makes
 * "agreed on the 3rd, withdrew on the 11th" a fact the platform can still state.
 */
export function currentConsent(tenantId: string, userId: string): ConsentState {
  const empty: ConsentState = {
    decision: null,
    decidedAt: null,
    channel: null,
    disclosureVersion: null,
    disclosureText: null,
    allowsMarketing: false,
  };
  const db = consentDb();
  if (!db) return empty;
  try {
    const row = db
      .prepare(
        `SELECT decision, decided_at AS decidedAt, channel,
                disclosure_version AS disclosureVersion,
                disclosure_text AS disclosureText
           FROM marketing_consent_event
          WHERE tenant_id = ? AND user_id = ? AND consent_kind = ?
          ORDER BY decided_at DESC, rowid DESC
          LIMIT 1`,
      )
      .get(tenantId, userId, MARKETING_CONSENT_KIND) as
      | Omit<ConsentState, "allowsMarketing">
      | undefined;
    if (!row) return empty;
    return { ...row, allowsMarketing: row.decision === "granted" };
  } catch (e) {
    log.warn("[marketingConsentStore] currentConsent failed:", (e as Error).message);
    return empty;
  }
}

/**
 * THE ONLY QUESTION A MARKETING SENDER MAY ASK.
 *
 * Default is NO. Never asked is NO. Unreadable is NO. A service, security,
 * transactional or platform message must NOT call this — it has no business
 * asking, and `mayReceiveServiceMessage` below is the honest answer for that case.
 */
export function marketingConsentAllows(tenantId: string, userId: string): boolean {
  return currentConsent(tenantId, userId).allowsMarketing;
}

/**
 * THE ANSWER FOR SERVICE MESSAGES, WRITTEN DOWN SO IT CANNOT DRIFT.
 *
 * Always true, deliberately and unconditionally. It takes no arguments, reads
 * nothing, and cannot be made to depend on a marketing preference. It exists so
 * that a future author reaching for `marketingConsentAllows` before sending a
 * password reset finds this instead, and so a test can assert the guarantee rather
 * than trusting a comment.
 *
 * WHY UNCONDITIONAL AND NOT "EXEMPT": the research this was built from rates the
 * statutory exemption for this class of message MEDIUM confidence, not high,
 * because the statutory text itself could not be retrieved. So the safe rule is
 * built — service messages are simply never consent-gated — rather than relying on
 * a broad exemption that has not been verified from primary text.
 */
export function mayReceiveServiceMessage(): true {
  return true;
}

/* ───────────────────────────── record a decision ──────────────────────── */

export interface RecordConsentResult {
  ok: boolean;
  status: number;
  code?: string;
  message?: string;
  state?: ConsentState;
}

/**
 * Record one decision. Inserts; never updates, never deletes.
 *
 * The caller supplies the DECISION and nothing else that matters. The wording is
 * re-derived here on the server and the server's copy is what is stored, so a
 * caller cannot record a person as having agreed to text that was never on their
 * screen. The stored version tag is checked against the caller's so that a stale
 * open tab, showing older wording, is refused rather than recorded against the
 * newer text.
 */
export function recordConsentDecision(opts: {
  tenantId: string;
  userId: string;
  decision: string;
  channel: string;
  /** The version the screen believes it displayed. */
  clientDisclosureVersion?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): RecordConsentResult {
  if (!CONSENT_DECISIONS.includes(opts.decision)) {
    return {
      ok: false,
      status: 400,
      code: "consent_decision_not_recognised",
      message: "Nothing was recorded, because that choice was not one of the options.",
    };
  }
  if (opts.channel !== "signup" && opts.channel !== "settings") {
    return {
      ok: false,
      status: 400,
      code: "consent_channel_not_recognised",
      message: "Nothing was recorded, because it is not clear where this choice was made.",
    };
  }
  if (!opts.userId || !opts.userId.trim()) {
    return {
      ok: false,
      status: 401,
      code: "consent_user_required",
      message: "Nothing was recorded, because the platform could not tell whose choice this is.",
    };
  }
  /* The tripwire. It cannot fire through the routes below, which hard-code the one
     kind; it exists for the future caller who adds a second one. */
  if (isNeverConsentGated(MARKETING_CONSENT_KIND)) {
    return {
      ok: false,
      status: 500,
      code: "consent_kind_must_never_be_gated",
      message: "Nothing was recorded. Messages about your account are never optional.",
    };
  }

  const avail = buildDisclosure();
  if (!avail.available || !avail.disclosure) {
    return {
      ok: false,
      status: 503,
      code: "consent_request_incomplete",
      message: avail.reason ?? "Marketing permission is not being asked for yet.",
    };
  }
  if (
    opts.clientDisclosureVersion &&
    opts.clientDisclosureVersion !== avail.disclosure.version
  ) {
    return {
      ok: false,
      status: 409,
      code: "consent_wording_changed",
      message:
        "Nothing was recorded, because the wording of this request has changed since " +
        "this page was opened. Please reload the page and choose again.",
    };
  }

  const db = consentDb();
  if (!db) {
    return {
      ok: false,
      status: 503,
      code: "consent_unavailable",
      message: "Nothing was recorded. Your choice could not be saved just now — please try again.",
    };
  }

  const d = avail.disclosure;
  try {
    db.prepare(
      `INSERT INTO marketing_consent_event
         (id, tenant_id, user_id, consent_kind, decision, decided_at, channel,
          disclosure_version, disclosure_text, purposes_text, requester_identity,
          requester_mailing_address, withdrawal_statement, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      opts.tenantId,
      opts.userId,
      MARKETING_CONSENT_KIND,
      opts.decision,
      new Date().toISOString(),
      opts.channel,
      d.version,
      d.text,
      d.purposes,
      d.requesterIdentity,
      d.mailingAddress,
      d.withdrawalStatement,
      opts.ipAddress ?? null,
      opts.userAgent ?? null,
    );
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    log.error("[marketingConsentStore] insert failed:", msg);
    if (/SERVICE_MESSAGES_ARE_NEVER_CONSENT_GATED/.test(msg)) {
      return {
        ok: false,
        status: 409,
        code: "consent_kind_must_never_be_gated",
        message: "Nothing was recorded. Messages about your account are never optional.",
      };
    }
    return {
      ok: false,
      status: 500,
      code: "consent_write_failed",
      message: "Nothing was recorded. Your choice could not be saved — please try again.",
    };
  }

  return { ok: true, status: 200, state: currentConsent(opts.tenantId, opts.userId) };
}

/* ───────────────────────────── the routes ─────────────────────────────── */

/**
 * THE TENANT A CONSENT RECORD BELONGS TO IS THE PERSON, NOT THEIR COMPANY.
 *
 * Derived from the user id and nothing else, deliberately. A founder can belong to
 * several companies and switch between them; if the consent row were stamped with
 * whichever company happened to be active, the same person's permission would look
 * different depending on which company they had selected, and withdrawing it in
 * one place would leave it standing in another. Permission to email a human being
 * is that human being's, so it is keyed to them. This matches the shape
 * server/lib/userContext.ts already uses for a person's own tenant.
 */
export function consentTenantForUser(userId: string): string {
  return `tenant_user_${userId}`;
}
function userOf(req: Request): string {
  const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
  return String(ctx?.userId ?? "");
}
function tenantOf(req: Request): string {
  return consentTenantForUser(userOf(req));
}

export function registerMarketingConsentRoutes(app: Express): void {
  /**
   * GET /api/consent/marketing-request — THE REQUEST ITSELF, AND NOTHING PERSONAL.
   *
   * WHY THIS EXISTS SEPARATELY, WHICH IS NOT AN ARBITRARY CHOICE. The consent box
   * has to appear ON THE SIGNUP FORM, and on the signup form nobody is signed in
   * yet, so an authenticated endpoint cannot supply the wording. This platform
   * applies a default-deny auth guard to every /api route
   * (server/lib/applyRouteGuards.ts), and that guard matches on PATH, not on
   * method — so opening up the read on the main endpoint would have opened up the
   * WRITE as well, and anyone could have recorded a consent decision.
   *
   * This path is therefore read-only and returns ONLY the request that would be
   * shown to anybody: the purposes, who is asking, the postal address, and the
   * withdrawal statement. There is no user id in scope here, no personal state is
   * read, and none is returned. It is the public text of an offer, which is
   * exactly the kind of thing the regulator requires to be plainly stated.
   */
  app.get("/api/consent/marketing-request", (_req: Request, res: Response) => {
    const avail = consentAvailability();
    res.json({
      ok: true,
      available: avail.available,
      reason: avail.reason ?? null,
      disclosure: avail.disclosure ?? null,
      /* Never a person's answer. This endpoint has no person. */
      checked: false,
      decision: null,
      decidedAt: null,
      serviceMessagesAlwaysDelivered: mayReceiveServiceMessage(),
    });
  });

  /**
   * GET /api/consent/marketing — what to show, and what this person last chose.
   *
   * `checked` is the person's own current decision and nothing else. There is no
   * branch that returns true for somebody who has not decided, which is what makes
   * the box arrive unticked for a new user without the screen having to remember
   * to leave it that way.
   */
  app.get("/api/consent/marketing", requireAuth, (req: Request, res: Response) => {
    const avail = consentAvailability();
    const state = currentConsent(tenantOf(req), userOf(req));
    res.json({
      ok: true,
      available: avail.available,
      reason: avail.reason ?? null,
      disclosure: avail.disclosure ?? null,
      checked: state.allowsMarketing,
      decision: state.decision,
      decidedAt: state.decidedAt,
      /* Stated in the payload, not only in a comment, so the screen can tell the
         person plainly that this choice does not touch their account email. */
      serviceMessagesAlwaysDelivered: mayReceiveServiceMessage(),
    });
  });

  /**
   * POST /api/consent/marketing — record a decision.
   *
   * ONE endpoint for giving and for withdrawing, with one field. That is what
   * makes withdrawal exactly as easy as giving: the same request, the same click
   * count, no confirmation step and no extra hoop for the person saying no.
   *
   * This endpoint is NOT part of signing up. It is called after an account exists.
   * A failure here cannot fail a signup.
   */
  app.post("/api/consent/marketing", requireAuth, (req: Request, res: Response) => {
    const out = recordConsentDecision({
      tenantId: tenantOf(req),
      userId: userOf(req),
      decision: String(req.body?.decision ?? ""),
      channel: String(req.body?.channel ?? "settings"),
      clientDisclosureVersion:
        typeof req.body?.disclosureVersion === "string" ? req.body.disclosureVersion : null,
      ipAddress: typeof req.ip === "string" ? req.ip : null,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
    });
    if (!out.ok) {
      return res.status(out.status).json({ ok: false, error: out.code, message: out.message });
    }
    return res.json({
      ok: true,
      checked: out.state?.allowsMarketing ?? false,
      decision: out.state?.decision ?? null,
      decidedAt: out.state?.decidedAt ?? null,
      serviceMessagesAlwaysDelivered: mayReceiveServiceMessage(),
    });
  });
}
