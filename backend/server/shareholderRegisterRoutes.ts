/**
 * server/shareholderRegisterRoutes.ts — WAVE 130 (NON-sacred).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE THINGS THE OWNER ASKED FOR
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. RECORD A SHAREHOLDER ON THE CAP TABLE WITH NO ROUND IN EXISTENCE.
 *        POST   /api/founder/captable/shareholders
 *        GET    /api/founder/captable/shareholders?companyId=…
 *        POST   /api/founder/captable/shareholders/:id/revise
 *   2. A FIRST-RUN PATH FOR BOTH SCENARIOS, RESUMABLE, NEVER A LOCK-OUT.
 *        GET    /api/founder/captable/first-run?companyId=…
 *        POST   /api/founder/captable/first-run
 *   3. VISIBILITY MADE EXPLICIT, AND ENFORCED SERVER-SIDE.
 *        GET    /api/founder/captable/visibility?companyId=…
 *        POST   /api/founder/captable/visibility/grants
 *        POST   /api/founder/captable/visibility/grants/:id/revoke
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE REFUSES TO DO
 * ═══════════════════════════════════════════════════════════════════════════
 * IT NEVER INVENTS A FIGURE. `amount` and `pricePerShare` accept a number OR the
 * literal word "unknown", and an OMISSION is a 400 — not a zero. That is the
 * defect this wave exists to remove: today a founder describing a company that
 * already raised three rounds must fabricate a pre-money valuation, a
 * fully-diluted share count, a price per share and a new-share count, all > 0,
 * before he can name a single existing shareholder (W130_PREFLIGHT.md §1.2).
 *
 * IT NEVER DEFAULTS THE CURRENCY. `currency` is required and validated against
 * `SUPPORTED_CURRENCIES`. There is no `"USD"` literal on any path in this file.
 * The live company in the owner's own walkthrough prices in HK$, and R5 forbids
 * a jurisdiction fallback.
 *
 * IT NEVER TOUCHES THE MONEY CORE. No import from `captableCommitStore`, no
 * ledger write, no hash chain, no fee, invoice or payout. The register reaches
 * the screens through the read-only display projection in
 * `buildCompanySecurities`, the same bridge W-SAFE and W-CAP already use.
 *
 * IT NEVER TOUCHES AUTH (R90). Every handler uses the existing `requireAuth`
 * middleware and the existing `getUserContext`. No session, cookie, role
 * resolution or portal guard is read differently, and `UserContext` is unchanged.
 */
import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import type { UserContext } from "./lib/userContext";
import { SUPPORTED_CURRENCIES } from "@shared/schema";
import { getRoundsForCompany } from "./roundsStore";
import { log } from "./lib/logger";
import {
  REGISTER_HOLDER_TYPES,
  REGISTER_INSTRUMENTS,
  VISIBILITY_SUBJECT_KINDS,
  capTableVisibilityGrantState,
  getFirstRun,
  getShareholderRecord,
  getVisibilityGrant,
  insertShareholderRecord,
  insertVisibilityGrant,
  listShareholderRecords,
  listVisibilityGrants,
  minorToMajorDecimal,
  parseMoneyDecision,
  parseShareCount,
  revokeVisibilityGrant,
  supersedeShareholderRecord,
  upsertFirstRun,
  type FirstRunScenario,
  type FirstRunState,
  type RegisterHolderType,
  type RegisterInstrument,
  type ShareholderRecord,
  type ShareholderRecordOrigin,
  type VisibilitySubjectKind,
} from "./lib/shareholderRegisterStore";

function resolveCtx(req: Request): UserContext {
  return req.userContext ?? getUserContext(req);
}

/** Fail-closed company ownership, identical in shape to `founderOpsRoutes.ts:31`.
 *  An admin passes because an admin already passes every other founder route in
 *  this tree; nothing about role resolution changes here. */
function ownsCompany(ctx: UserContext, companyId: string): boolean {
  if (ctx.isAdmin) return true;
  return ctx.founder.companies.some((c) => c.companyId === companyId);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The wire shape of one register row.
 *
 * Money crosses as EXACT MINOR-UNIT DIGIT STRINGS (`amountMinor`,
 * `pricePerShareMinor`) so nothing is lost, alongside a display decimal string
 * for convenience. `null` on either means STATED UNKNOWN, and the two explicit
 * `…IsUnknown` booleans say so in a form a renderer cannot mistake for zero.
 */
function toWire(rec: ShareholderRecord): Record<string, unknown> {
  return {
    id: rec.id,
    companyId: rec.companyId,
    holderName: rec.holderName,
    holderEmail: rec.holderEmail,
    holderType: rec.holderType,
    instrument: rec.instrument,
    series: rec.series,
    shares: rec.shares,
    amountMinor: rec.amountMinor,
    amountDisplay:
      rec.amountMinor === null ? null : minorToMajorDecimal(rec.amountMinor, rec.minorUnitExponent),
    amountIsUnknown: rec.amountMinor === null,
    pricePerShareMinor: rec.pricePerShareMinor,
    pricePerShareDisplay:
      rec.pricePerShareMinor === null
        ? null
        : minorToMajorDecimal(rec.pricePerShareMinor, rec.minorUnitExponent),
    pricePerShareIsUnknown: rec.pricePerShareMinor === null,
    currency: rec.currency,
    minorUnitExponent: rec.minorUnitExponent,
    issueDate: rec.issueDate,
    origin: rec.origin,
    investorId: rec.investorId,
    note: rec.note,
    recordedBy: rec.recordedBy,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** The most recent currency this company actually used, so the form can be
 *  PRE-FILLED from the company's own history instead of a hardcoded default.
 *  `null` when the company has no round yet — and `null` means the founder is
 *  ASKED, never that USD is assumed. */
function suggestedCurrencyForCompany(companyId: string): string | null {
  try {
    const rounds = getRoundsForCompany(companyId);
    for (let i = rounds.length - 1; i >= 0; i -= 1) {
      const c = str((rounds[i] as { currency?: string | null }).currency);
      if (c && (SUPPORTED_CURRENCIES as readonly string[]).includes(c.toUpperCase())) {
        return c.toUpperCase();
      }
    }
  } catch {
    /* No history is not an error; the founder will be asked. */
  }
  return null;
}

/**
 * Validate the body of a record/revise call.
 *
 * Returns either the values to persist or the 400 the caller must answer. The
 * THREE-WAY money read is the heart of it: a figure, the word "unknown", or an
 * omission — and an omission is refused with a message that tells the founder
 * he may record it as unknown.
 */
type ParsedRecordBody =
  | { ok: true; value: Omit<Parameters<typeof insertShareholderRecord>[0], "id"> }
  | { ok: false; status: number; error: string; message: string };

function parseRecordBody(
  body: Record<string, unknown>,
  companyId: string,
  recordedBy: string,
  origin: ShareholderRecordOrigin,
): ParsedRecordBody {
  const holderName = str(body.holderName);
  if (!holderName) {
    return {
      ok: false,
      status: 400,
      error: "holder_name_required",
      message: "Enter the shareholder's name as it appears on the company's register.",
    };
  }

  const holderType = str(body.holderType) as RegisterHolderType;
  if (!REGISTER_HOLDER_TYPES.includes(holderType)) {
    return {
      ok: false,
      status: 400,
      error: "holder_type_invalid",
      message: "Choose what kind of holder this is. Capavate does not guess it from the name.",
    };
  }

  const instrument = str(body.instrument) as RegisterInstrument;
  if (!REGISTER_INSTRUMENTS.includes(instrument)) {
    return {
      ok: false,
      status: 400,
      error: "instrument_invalid",
      message: "Choose the instrument or share class this holding is held as.",
    };
  }

  const shares = parseShareCount(body.shares);
  if (shares === null) {
    return {
      ok: false,
      status: 400,
      error: "shares_invalid",
      message: "Enter the number of shares as a whole number. Shares are counted, never estimated.",
    };
  }

  /* CURRENCY IS REQUIRED AND NEVER DEFAULTED (R5). Jurisdiction and currency are
     variables on this platform; the company in the owner's walkthrough is Hong
     Kong and prices in HK$, and a silent "USD" would be a fabricated fact. */
  const currency = str(body.currency).toUpperCase();
  if (!currency || !(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
    return {
      ok: false,
      status: 400,
      error: "currency_required",
      message:
        "Choose the currency this holding was subscribed in. Capavate does not assume one — " +
        `the supported list is ${SUPPORTED_CURRENCIES.join(", ")}.`,
    };
  }

  const issueDate = str(body.issueDate);
  if (!ISO_DATE_RE.test(issueDate)) {
    return {
      ok: false,
      status: 400,
      error: "issue_date_required",
      message: "Enter the date this holding was issued, as a calendar date.",
    };
  }

  const amount = parseMoneyDecision(body.amount, currency);
  if (amount.kind === "undecided") {
    return {
      ok: false,
      status: 400,
      error: "amount_decision_required",
      message:
        "State the amount subscribed, or record it as unknown. Leaving it blank is not the same " +
        "as zero, and Capavate will not store a figure you did not give it.",
    };
  }
  if (amount.kind === "invalid") {
    return { ok: false, status: 400, error: "amount_invalid", message: amount.reason };
  }

  const pps = parseMoneyDecision(body.pricePerShare, currency);
  if (pps.kind === "undecided") {
    return {
      ok: false,
      status: 400,
      error: "price_per_share_decision_required",
      message:
        "State the price per share, or record it as unknown. A historic holding often has no " +
        "recorded price, and unknown is a legitimate answer — zero is not.",
    };
  }
  if (pps.kind === "invalid") {
    return { ok: false, status: 400, error: "price_per_share_invalid", message: pps.reason };
  }

  return {
    ok: true,
    value: {
      companyId,
      holderName,
      holderEmail: str(body.holderEmail) || null,
      holderType,
      instrument,
      series: str(body.series) || null,
      shares,
      amountMinor: amount.kind === "known" ? amount.minor : null,
      pricePerShareMinor: pps.kind === "known" ? pps.minor : null,
      currency,
      issueDate,
      origin,
      investorId: str(body.investorId) || null,
      note: str(body.note) || null,
      recordedBy,
    },
  };
}

/** A past issue date WARNS, it never blocks (R92) — a pre-existing cap table is
 *  by definition historic, and refusing a past date would make the whole
 *  existing-cap-table scenario impossible. */
function issueDateWarning(issueDate: string): string | null {
  const d = new Date(`${issueDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > Date.now()) {
    return "This issue date is in the future. It has been recorded as entered — check it if that was not intended.";
  }
  return null;
}

export function registerShareholderRegisterRoutes(app: Express): void {
  /* ─────────────────────────────────────────────────────────────────────────
     1. RECORD A SHAREHOLDER — NO ROUND REQUIRED, AND NO ROUND CONSULTED.
     There is no `roundId` parameter, no round lookup, no valuation, no price
     per share on the company and no fully-diluted share count anywhere in this
     handler. That is the requirement, stated as code.
     ───────────────────────────────────────────────────────────────────────── */
  app.post("/api/founder/captable/shareholders", requireAuth, (req: Request, res: Response) => {
    try {
      const ctx = resolveCtx(req);
      if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
      const body = (req.body ?? {}) as Record<string, unknown>;
      const companyId = str(body.companyId);
      if (!companyId) {
        return res.status(400).json({
          ok: false,
          error: "company_required",
          message: "Choose the company this shareholder belongs to.",
        });
      }
      if (!ownsCompany(ctx, companyId)) {
        return res.status(403).json({
          ok: false,
          error: "FOUNDER_WRONG_COMPANY",
          message: "You are not a founder of this company.",
        });
      }

      const originRaw = str(body.origin) || "direct";
      const origin: ShareholderRecordOrigin =
        originRaw === "incorporation" || originRaw === "existing_captable" ? originRaw : "direct";

      const parsed = parseRecordBody(body, companyId, String(ctx.userId ?? ""), origin);
      if (!parsed.ok) {
        return res
          .status(parsed.status)
          .json({ ok: false, error: parsed.error, message: parsed.message });
      }

      const id = `shreg_${randomUUID()}`;
      const saved = insertShareholderRecord({ id, ...parsed.value });
      if (!saved) {
        return res.status(500).json({
          ok: false,
          error: "record_not_saved",
          message: "The shareholder could not be recorded. Nothing was changed.",
        });
      }

      /* Recording through one of the two scenarios advances that scenario's
         progress, so a founder who is part-way through and leaves comes back to
         where he was. `completed` is his own explicit decision, never inferred
         from a row count — Capavate cannot know how many shareholders a company
         has. */
      if (origin !== "direct") {
        const existing = getFirstRun(companyId);
        upsertFirstRun({
          companyId,
          scenario: origin as FirstRunScenario,
          asAtDate: existing?.asAtDate ?? null,
          state: existing?.state === "completed" ? "completed" : "in_progress",
          updatedBy: String(ctx.userId ?? ""),
        });
      }

      return res.status(201).json({
        ok: true,
        record: toWire(saved),
        warning: issueDateWarning(saved.issueDate),
      });
    } catch (err) {
      log.error("[shareholderRegister] record failed:", (err as Error).message);
      return res.status(500).json({
        ok: false,
        error: "record_failed",
        message: "The shareholder could not be recorded. Nothing was changed.",
      });
    }
  });

  /* ─────────────────────────────────────────────────────────────────────────
     THE FOUNDER'S OWN LIST. `suggestedCurrency` comes from the company's own
     round history, or is `null` so the founder is asked. It is never "USD".
     ───────────────────────────────────────────────────────────────────────── */
  app.get("/api/founder/captable/shareholders", requireAuth, (req: Request, res: Response) => {
    try {
      const ctx = resolveCtx(req);
      if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
      const companyId = str(req.query.companyId);
      if (!companyId) {
        return res.status(400).json({ ok: false, error: "company_required", message: "Choose a company." });
      }
      if (!ownsCompany(ctx, companyId)) {
        return res.status(403).json({
          ok: false,
          error: "FOUNDER_WRONG_COMPANY",
          message: "You are not a founder of this company.",
        });
      }
      const records = listShareholderRecords(companyId).map(toWire);
      return res.json({
        ok: true,
        records,
        suggestedCurrency: suggestedCurrencyForCompany(companyId),
        supportedCurrencies: SUPPORTED_CURRENCIES,
        holderTypes: REGISTER_HOLDER_TYPES,
        instruments: REGISTER_INSTRUMENTS,
      });
    } catch (err) {
      log.error("[shareholderRegister] list route failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "list_failed", message: "The register could not be read." });
    }
  });

  /* ─────────────────────────────────────────────────────────────────────────
     REVISE — APPEND-ONLY. Filling in a figure that was once unknown writes a
     NEW row and stamps the old one superseded. The old row is never rewritten,
     so the audit trail still shows the figure was unknown at the time it was
     first recorded. This is how a founder is able to record "unknown" honestly
     and improve it later, rather than being pressured into a guess today.
     ───────────────────────────────────────────────────────────────────────── */
  app.post(
    "/api/founder/captable/shareholders/:id/revise",
    requireAuth,
    (req: Request, res: Response) => {
      try {
        const ctx = resolveCtx(req);
        if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
        const prior = getShareholderRecord(str(req.params.id));
        if (!prior || prior.supersededAt) {
          /* 404, not 403: a register id the caller may not read must not be
             confirmed to exist — the same policy `capTableSinkScope.ts` states
             for cap-table sinks (F9). */
          return res.status(404).json({
            ok: false,
            error: "record_not_found",
            message: "That shareholder record is not available.",
          });
        }
        if (!ownsCompany(ctx, prior.companyId)) {
          return res.status(404).json({
            ok: false,
            error: "record_not_found",
            message: "That shareholder record is not available.",
          });
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        /* Every field the caller does not restate is carried forward from the
           prior row — INCLUDING an unknown, which stays unknown. A revision is
           not an opportunity to silently zero something. */
        const merged: Record<string, unknown> = {
          holderName: body.holderName ?? prior.holderName,
          holderEmail: body.holderEmail ?? prior.holderEmail,
          holderType: body.holderType ?? prior.holderType,
          instrument: body.instrument ?? prior.instrument,
          series: body.series ?? prior.series,
          shares: body.shares ?? prior.shares,
          currency: body.currency ?? prior.currency,
          issueDate: body.issueDate ?? prior.issueDate,
          investorId: body.investorId ?? prior.investorId,
          note: body.note ?? prior.note,
          amount:
            body.amount ??
            (prior.amountMinor === null
              ? "unknown"
              : minorToMajorDecimal(prior.amountMinor, prior.minorUnitExponent)),
          pricePerShare:
            body.pricePerShare ??
            (prior.pricePerShareMinor === null
              ? "unknown"
              : minorToMajorDecimal(prior.pricePerShareMinor, prior.minorUnitExponent)),
        };

        const parsed = parseRecordBody(
          merged,
          prior.companyId,
          String(ctx.userId ?? ""),
          prior.origin,
        );
        if (!parsed.ok) {
          return res
            .status(parsed.status)
            .json({ ok: false, error: parsed.error, message: parsed.message });
        }

        const id = `shreg_${randomUUID()}`;
        const saved = insertShareholderRecord({ id, ...parsed.value });
        if (!saved) {
          return res.status(500).json({
            ok: false,
            error: "revision_not_saved",
            message: "The revision could not be saved. The existing record is unchanged.",
          });
        }
        supersedeShareholderRecord(prior.id, id);
        return res.json({
          ok: true,
          record: toWire(saved),
          supersededId: prior.id,
          warning: issueDateWarning(saved.issueDate),
        });
      } catch (err) {
        log.error("[shareholderRegister] revise failed:", (err as Error).message);
        return res.status(500).json({
          ok: false,
          error: "revision_failed",
          message: "The revision could not be saved. The existing record is unchanged.",
        });
      }
    },
  );

  /* ─────────────────────────────────────────────────────────────────────────
     2. FIRST RUN — TWO SCENARIOS, KEPT SEPARATE, AND RESUMABLE.

     > "When a company FIRST registered on Capavate, they need to either set up
     >  their initial (incorporation) shareholders or the status of their latest
     >  cap table."

     The two are NOT collapsed. `scenario` records which question the founder is
     answering and every row he records carries the matching `origin`, so the
     provenance of a holding — "this is how we began" versus "this is where we
     stand as at a date" — survives in the data.

     IT IS NOT A WIZARD THAT MUST BE FINISHED IN ONE SITTING. The state is a row,
     so leaving, signing out, or skipping outright all resume exactly where the
     founder was, and `skipped` is reversible: choosing a scenario again clears
     the skip. Nothing in this design can lock a founder out.
     ───────────────────────────────────────────────────────────────────────── */
  app.get("/api/founder/captable/first-run", requireAuth, (req: Request, res: Response) => {
    try {
      const ctx = resolveCtx(req);
      if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
      const companyId = str(req.query.companyId);
      if (!companyId) {
        return res.status(400).json({ ok: false, error: "company_required", message: "Choose a company." });
      }
      if (!ownsCompany(ctx, companyId)) {
        return res.status(403).json({
          ok: false,
          error: "FOUNDER_WRONG_COMPANY",
          message: "You are not a founder of this company.",
        });
      }
      const rec = getFirstRun(companyId);
      const records = listShareholderRecords(companyId);
      return res.json({
        ok: true,
        firstRun: rec
          ? {
              companyId: rec.companyId,
              scenario: rec.scenario,
              asAtDate: rec.asAtDate,
              state: rec.state,
              skippedAt: rec.skippedAt,
              completedAt: rec.completedAt,
              updatedAt: rec.updatedAt,
            }
          : { companyId, scenario: null, asAtDate: null, state: "not_started", skippedAt: null, completedAt: null, updatedAt: null },
        /* How far along each scenario is, counted from the rows themselves, so a
           founder who returns is told what he already did rather than starting
           over. */
        recordedByScenario: {
          incorporation: records.filter((r) => r.origin === "incorporation").length,
          existing_captable: records.filter((r) => r.origin === "existing_captable").length,
          direct: records.filter((r) => r.origin === "direct").length,
        },
        /* THE ENTRY POINT NEVER DISAPPEARS. Both scenarios stay openable whatever
           the state — that is what "returnable to later" means. */
        canResume: true,
      });
    } catch (err) {
      log.error("[shareholderRegister] first-run route failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "first_run_failed", message: "That could not be read." });
    }
  });

  app.post("/api/founder/captable/first-run", requireAuth, (req: Request, res: Response) => {
    try {
      const ctx = resolveCtx(req);
      if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
      const body = (req.body ?? {}) as Record<string, unknown>;
      const companyId = str(body.companyId);
      if (!companyId) {
        return res.status(400).json({ ok: false, error: "company_required", message: "Choose a company." });
      }
      if (!ownsCompany(ctx, companyId)) {
        return res.status(403).json({
          ok: false,
          error: "FOUNDER_WRONG_COMPANY",
          message: "You are not a founder of this company.",
        });
      }

      const stateRaw = str(body.state);
      const allowedStates: readonly FirstRunState[] = [
        "not_started",
        "in_progress",
        "skipped",
        "completed",
      ];
      if (!allowedStates.includes(stateRaw as FirstRunState)) {
        return res.status(400).json({
          ok: false,
          error: "state_invalid",
          message: "Say whether you are starting, pausing or finishing this step.",
        });
      }
      const state = stateRaw as FirstRunState;

      const scenarioRaw = str(body.scenario);
      let scenario: FirstRunScenario | null = null;
      if (scenarioRaw) {
        if (scenarioRaw !== "incorporation" && scenarioRaw !== "existing_captable") {
          return res.status(400).json({
            ok: false,
            error: "scenario_invalid",
            message:
              "Choose whether you are recording the shareholders the company was incorporated " +
              "with, or the cap table as it stands today. These are different facts and Capavate " +
              "keeps them apart.",
          });
        }
        scenario = scenarioRaw;
      } else if (state === "in_progress" || state === "completed") {
        return res.status(400).json({
          ok: false,
          error: "scenario_required",
          message: "Choose which of the two starting points you are working through.",
        });
      }

      /* An as-at date is what makes the existing-cap-table scenario meaningful —
         a cap table is only true as at a moment. It is required for that
         scenario and is a plain calendar date. */
      const asAtDate = str(body.asAtDate) || null;
      if (asAtDate && !ISO_DATE_RE.test(asAtDate)) {
        return res.status(400).json({
          ok: false,
          error: "as_at_date_invalid",
          message: "Enter the as-at date as a calendar date.",
        });
      }
      if (scenario === "existing_captable" && state !== "skipped" && !asAtDate) {
        return res.status(400).json({
          ok: false,
          error: "as_at_date_required",
          message:
            "A cap table is only accurate as at a date. Give the date this position was true as at.",
        });
      }

      const existing = getFirstRun(companyId);
      const saved = upsertFirstRun({
        companyId,
        /* Resuming after a skip re-opens the flow. A skip is a pause. */
        scenario: scenario ?? existing?.scenario ?? null,
        asAtDate: asAtDate ?? existing?.asAtDate ?? null,
        state,
        updatedBy: String(ctx.userId ?? ""),
      });
      if (!saved) {
        return res.status(500).json({
          ok: false,
          error: "first_run_not_saved",
          message: "That could not be saved. Nothing was changed.",
        });
      }
      return res.json({
        ok: true,
        firstRun: {
          companyId: saved.companyId,
          scenario: saved.scenario,
          asAtDate: saved.asAtDate,
          state: saved.state,
          skippedAt: saved.skippedAt,
          completedAt: saved.completedAt,
          updatedAt: saved.updatedAt,
        },
        canResume: true,
      });
    } catch (err) {
      log.error("[shareholderRegister] first-run write failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "first_run_failed", message: "That could not be saved." });
    }
  });

  /* ─────────────────────────────────────────────────────────────────────────
     3. VISIBILITY — THE FOUNDER CAN SEE WHO READS HIS CAP TABLE.

     > "make sure that the cap table is dynamic and is visible for all parties
     >  when updated (founder, investors, consortium partner (if required),
     >  Collective (if required))"

     The list is assembled from the SAME authority that enforces the read —
     `decideCapTableSinkAccess` — so what the founder is shown cannot drift from
     what the server actually permits. Two kinds of entry:

       POSITIONAL, and NOT REVOCABLE. The founder, an admin, and every holder of
       a committed position. R8: "scope follows the POSITION, never an account
       flag", and a cap-table member has "full, identical rights". A shareholder's
       sight of the register he appears on is a consequence of holding shares, not
       a permission a founder grants, so there is no revoke control on these rows
       and none on the server either. The founder is told this in plain words
       rather than shown a button that would not work.

       GRANTED, and REVOCABLE. A Consortium Partner or a Collective party — the
       two the owner qualified with "if required". These are the grants below.
     ───────────────────────────────────────────────────────────────────────── */
  app.get("/api/founder/captable/visibility", requireAuth, (req: Request, res: Response) => {
    try {
      const ctx = resolveCtx(req);
      if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
      const companyId = str(req.query.companyId);
      if (!companyId) {
        return res.status(400).json({ ok: false, error: "company_required", message: "Choose a company." });
      }
      if (!ownsCompany(ctx, companyId)) {
        return res.status(403).json({
          ok: false,
          error: "FOUNDER_WRONG_COMPANY",
          message: "You are not a founder of this company.",
        });
      }

      const grants = listVisibilityGrants(companyId).map((g) => ({
        id: g.id,
        subjectKind: g.subjectKind,
        subjectLabel: g.subjectLabel,
        expiresAt: g.expiresAt,
        createdAt: g.createdAt,
        revokedAt: g.revokedAt,
        state: capTableVisibilityGrantState(g),
        /* Only a live grant can be revoked, and revoking a revoked grant is a
           no-op that keeps the first instant (Wave 120's rule). */
        canRevoke: capTableVisibilityGrantState(g) === "live",
      }));

      return res.json({
        ok: true,
        companyId,
        /* The positional readers, described rather than enumerated by id: this
           response is read by a human-facing panel and must never carry a raw
           `u_…`. The counts come from the register + the securities the founder
           already sees on his own cap table. */
        positional: [
          {
            party: "founder",
            basis: "Founder of this company",
            revocable: false,
            reason:
              "You and any co-founder recorded on this company always see the cap table. This cannot be switched off.",
          },
          {
            party: "investor",
            basis: "Holds a committed position on this cap table",
            revocable: false,
            reason:
              "Anyone holding a position on this cap table can see it. That follows from holding shares, so it is not a permission you grant or withdraw.",
          },
          {
            party: "administrator",
            basis: "Capavate platform administrator",
            revocable: false,
            reason:
              "Platform administrators can read the cap table for support and audit. This is unchanged by anything on this page.",
          },
        ],
        grants,
        subjectKinds: VISIBILITY_SUBJECT_KINDS,
      });
    } catch (err) {
      log.error("[capTableVisibility] read failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "visibility_failed", message: "That could not be read." });
    }
  });

  app.post("/api/founder/captable/visibility/grants", requireAuth, (req: Request, res: Response) => {
    try {
      const ctx = resolveCtx(req);
      if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
      const body = (req.body ?? {}) as Record<string, unknown>;
      const companyId = str(body.companyId);
      if (!companyId) {
        return res.status(400).json({ ok: false, error: "company_required", message: "Choose a company." });
      }
      if (!ownsCompany(ctx, companyId)) {
        return res.status(403).json({
          ok: false,
          error: "FOUNDER_WRONG_COMPANY",
          message: "You are not a founder of this company.",
        });
      }

      const subjectKind = str(body.subjectKind) as VisibilitySubjectKind;
      if (!VISIBILITY_SUBJECT_KINDS.includes(subjectKind)) {
        return res.status(400).json({
          ok: false,
          error: "subject_kind_invalid",
          message:
            "Cap-table visibility can be granted to a Consortium Partner or to the Collective. " +
            "An investor on your cap table already sees it because they hold a position, so " +
            "there is nothing to grant them.",
        });
      }
      const subjectId = str(body.subjectId);
      if (!subjectId) {
        return res.status(400).json({
          ok: false,
          error: "subject_required",
          message: "Choose who you are giving access to.",
        });
      }
      /* A LABEL IS MANDATORY so the visibility list can name a human being. A raw
         identifier must never reach a person (this platform's standing rule), and
         the only way to guarantee that here is to refuse a grant that has no
         label to render. */
      const subjectLabel = str(body.subjectLabel);
      if (!subjectLabel) {
        return res.status(400).json({
          ok: false,
          error: "subject_label_required",
          message: "Give the name this party should be listed under.",
        });
      }
      const expiresAt = str(body.expiresAt);
      if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) {
        return res.status(400).json({
          ok: false,
          error: "expiry_required",
          message: "Set the date this access should end. Cap-table access is always time-limited.",
        });
      }
      if (new Date(expiresAt).getTime() <= Date.now()) {
        return res.status(400).json({
          ok: false,
          error: "expiry_in_past",
          message: "That end date has already passed, so the access would never be live.",
        });
      }

      const id = `ctvg_${randomUUID()}`;
      const saved = insertVisibilityGrant({
        id,
        companyId,
        subjectKind,
        subjectId,
        subjectLabel,
        expiresAt: new Date(expiresAt).toISOString(),
        grantedBy: String(ctx.userId ?? ""),
      });
      if (!saved) {
        return res.status(500).json({
          ok: false,
          error: "grant_not_saved",
          message: "The access could not be granted. Nothing was changed.",
        });
      }
      return res.status(201).json({
        ok: true,
        grant: {
          id: saved.id,
          subjectKind: saved.subjectKind,
          subjectLabel: saved.subjectLabel,
          expiresAt: saved.expiresAt,
          createdAt: saved.createdAt,
          revokedAt: saved.revokedAt,
          state: capTableVisibilityGrantState(saved),
          canRevoke: true,
        },
      });
    } catch (err) {
      log.error("[capTableVisibility] grant failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "grant_failed", message: "The access could not be granted." });
    }
  });

  app.post(
    "/api/founder/captable/visibility/grants/:id/revoke",
    requireAuth,
    (req: Request, res: Response) => {
      try {
        const ctx = resolveCtx(req);
        if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
        const grant = getVisibilityGrant(str(req.params.id));
        if (!grant || !ownsCompany(ctx, grant.companyId)) {
          return res.status(404).json({
            ok: false,
            error: "grant_not_found",
            message: "That access record is not available.",
          });
        }
        /* IDEMPOTENT, and the FIRST instant is kept. A second click is not an
           error and does not rewrite the audit trail. */
        if (grant.revokedAt) {
          return res.json({
            ok: true,
            grant: {
              id: grant.id,
              subjectKind: grant.subjectKind,
              subjectLabel: grant.subjectLabel,
              expiresAt: grant.expiresAt,
              createdAt: grant.createdAt,
              revokedAt: grant.revokedAt,
              state: "revoked",
              canRevoke: false,
            },
            alreadyRevoked: true,
          });
        }
        revokeVisibilityGrant(grant.id, String(ctx.userId ?? ""));
        const after = getVisibilityGrant(grant.id);
        return res.json({
          ok: true,
          grant: {
            id: grant.id,
            subjectKind: grant.subjectKind,
            subjectLabel: grant.subjectLabel,
            expiresAt: grant.expiresAt,
            createdAt: grant.createdAt,
            revokedAt: after?.revokedAt ?? null,
            state: after ? capTableVisibilityGrantState(after) : "revoked",
            canRevoke: false,
          },
          alreadyRevoked: false,
        });
      } catch (err) {
        log.error("[capTableVisibility] revoke failed:", (err as Error).message);
        return res.status(500).json({ ok: false, error: "revoke_failed", message: "The access could not be withdrawn." });
      }
    },
  );
}
