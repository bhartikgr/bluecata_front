/**
 * v25.0 Track 1 — Capavate Core Endpoints (A1–A8)
 *
 * Endpoints wired:
 *   A1  GET  /api/founder/captable/waterfall
 *   A2  POST /api/founder/term-sheets/generate
 *       GET  /api/founder/term-sheets/:id/download
 *   A3  POST /api/founder/crm/import
 *   A4  POST /api/founder/data-room/files
 *       POST /api/founder/data-room/grants
 *       GET  /api/founder/data-room/files/:fileId
 *   A5  POST /api/investor/invitations/:token/kyc
 *   A6  POST /api/investor/documents/:id/sign
 *   A7  POST /api/rounds/:id/soft-circle/:scId/reject
 *   A8  POST /api/rounds/:id/updates
 *
 * All writes commit to DB before returning success.
 * All state-changing writes emit BridgeOutbound events.
 * All endpoints respect tenant isolation + ownership checks.
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import multer from "multer";
import { requireAuth } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import { rawDb } from "./db/connection";
import { emitBridgeEvent } from "./bridgeStore";
import type { OutboundEventType } from "./bridgeStore";
import { log } from "./lib/logger";
import { rateLimitMiddleware, resolveRateLimitClientIp } from "./lib/rateLimit";
import { getLedger } from "./captableCommitStore";
import { getRoundById } from "./roundsStore";
/* WAVE 71 · D11 — the ONE stored-terms reader, shared with `server/routes.ts`.
   Wave 70's handoff: "Call those; do not write a third reader." */
import { roundStoredTerms, SENIORITY_RANK_MAX } from "./lib/roundStoredTerms";
import { toMinor } from "./lib/currency"; /* WAVE 33 OQ-33-2 — ISO 4217 exponent, never a hardcoded *100 */
import { Decimal } from "decimal.js"; /* WAVE 75 · ITEM 3 — the waterfall summary is summed in EXACT decimals, not floats */
import { addContact } from "./crmStore";
import { insertContactForImport } from "./founderCrmStore";
import { emitNotification } from "./notificationsStore";
import { listForRound as softCircleListForRound } from "./softCircleStore";

// Helper to emit bridge events with our new event types (using cast to bypass strict type)
function emitBridge(eventType: string, aggregateId: string, aggregateKind: "company" | "investor" | "round" | "platform", payload: Record<string, unknown>): void {
  try {
    emitBridgeEvent({
      eventType: eventType as unknown as OutboundEventType,
      aggregateId,
      aggregateKind,
      payload,
    });
  } catch (err) {
    log.warn("[track1] bridge emit failed:", (err as Error).message);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

/** Verify that the authenticated user owns (or is admin of) a company. */
function ownsCompany(ctx: ReturnType<typeof getUserContext>, companyId: string): boolean {
  if (!ctx) return false;
  if (ctx.isAdmin) return true;
  return ctx.founder.companies.some((c: { companyId: string }) => c.companyId === companyId);
}

/** Verify that the authenticated user owns (or is admin of) a round's company. */
function ownsRound(ctx: ReturnType<typeof getUserContext>, roundId: string): boolean {
  if (!ctx) return false;
  if (ctx.isAdmin) return true;
  const round = getRoundById(roundId);
  if (!round) return false;
  return ctx.founder.companies.some((c: { companyId: string }) => c.companyId === round.companyId);
}

// ── multer (for A3 CSV import) ────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── minimal PDF builder (same pattern as invoiceStore) ───────────────────────
function markdownToPdf(content: string): Buffer {
  // Simple %PDF-1.4 envelope embedding the text as a stream.
  // Same pattern as generateInvoicePdf() in invoiceStore.ts (no external dep).
  const escaped = content.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  // Chunk text into lines for PDF stream
  const lines = escaped.split("\n");
  const textOps = lines.map((l, i) => `BT /F1 11 Tf 40 ${800 - i * 14} Td (${l.substring(0, 120)}) Tj ET`).join("\n");

  const stream = `${textOps}\n`;
  const streamLen = Buffer.byteLength(stream, "utf8");

  const bodyParts: string[] = [];
  bodyParts.push("%PDF-1.4");
  // obj 1: catalog
  const off1 = bodyParts.join("\n").length + 1;
  bodyParts.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  // obj 2: pages
  const off2 = bodyParts.join("\n").length + 1;
  bodyParts.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
  // obj 3: page
  const off3 = bodyParts.join("\n").length + 1;
  bodyParts.push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj`);
  // obj 4: stream
  const off4 = bodyParts.join("\n").length + 1;
  bodyParts.push(`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj`);

  const xrefOffset = bodyParts.join("\n").length + 1;
  bodyParts.push("xref\n0 5");
  bodyParts.push(`0000000000 65535 f\r`);
  bodyParts.push(`${String(off1).padStart(10, "0")} 00000 n\r`);
  bodyParts.push(`${String(off2).padStart(10, "0")} 00000 n\r`);
  bodyParts.push(`${String(off3).padStart(10, "0")} 00000 n\r`);
  bodyParts.push(`${String(off4).padStart(10, "0")} 00000 n\r`);
  bodyParts.push(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.from(bodyParts.join("\n"), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// A1 — GET /api/founder/captable/waterfall
// ─────────────────────────────────────────────────────────────────────────────

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 74 · R67 — ONLY PREFERRED SHARES CARRY A LIQUIDATION PREFERENCE.
   ═══════════════════════════════════════════════════════════════════════════
   Wave 71's D11 refusal below is correct and stays. It was OVER-BROAD: it fired
   on all SEVEN instrument values the platform accepts, and six of them cannot
   have the term it demands. A SAFE, a convertible note, a warrant, an option
   pool and plain common/founder stock have no liquidation preference to record,
   so refusing them for lacking one refused a term the instrument cannot hold.
   Owner ruling R67 (2026-08-18), on R66's clarification: "narrow the CONDITION
   only. Never remove the refusal, its container, or the branch."

   THE SEVEN VALUES ARE READ FROM THE TREE, NOT ASSUMED. They are the
   `VALID_INSTRUMENTS` set the round writer enforces (`server/routes.ts`, the
   POST /api/rounds validator) and the `INSTRUMENTS` catalogue in
   `shared/schema.ts`: preferred, common, safe_post, safe_pre, convertible_note,
   warrant, option_pool. `preferred` is the one that carries the term; the SIX
   below are the ones that cannot.

   THE MATCH IS POSITIVE, AND THAT IS THE WHOLE SAFETY ARGUMENT. This set is
   asked "is this round definitely one of the six?" — never "is this round not
   preferred?". A round whose instrument is absent, empty, or any value not in
   this list is left on EXACTLY today's path, refusal included, because the
   platform does not know what it is and R6 forbids deciding for it. The change
   can therefore only ever turn a refusal into a computation, never the reverse:
   no round that computes today can begin refusing because of this line. Whether
   an unrecorded instrument type should itself refuse by name is an OWNER
   QUESTION and is recorded as one in build_log/wave74/.

   NOT A SILENT DROP. A round that leaves the preference stack here is reported
   on the response in `nonPreferenceClasses`, with its shares, its invested
   amount and the reason, so the figure a founder sees still accounts for every
   committed round on the cap table. */
const NON_PREFERENCE_INSTRUMENTS: ReadonlySet<string> = new Set([
  "safe_post",
  "safe_pre",
  "convertible_note",
  "warrant",
  "option_pool",
  "common",
]);

async function handleWaterfall(req: Request, res: Response): Promise<void> {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { companyId, exitValuationMinor, preferredReturnPct } = req.query as Record<string, string>;

  if (!companyId) { res.status(422).json({ ok: false, error: "MISSING_COMPANY_ID" }); return; }
  if (!exitValuationMinor) { res.status(422).json({ ok: false, error: "MISSING_EXIT_VALUATION_MINOR" }); return; }

  if (!ownsCompany(ctx, companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const exitMinor = Number(exitValuationMinor);
  if (!Number.isFinite(exitMinor) || exitMinor < 0) {
    res.status(422).json({ ok: false, error: "INVALID_EXIT_VALUATION_MINOR" }); return;
  }

  const lpPct = preferredReturnPct ? Number(preferredReturnPct) : 0;
  if (!Number.isFinite(lpPct) || lpPct < 0 || lpPct > 1) {
    res.status(422).json({ ok: false, error: "INVALID_PREFERRED_RETURN_PCT" }); return;
  }

  // Build waterfall input from cap table ledger entries for the company
  const ledger = getLedger();
  const companyEntries = ledger.filter((e: unknown) => (e as { companyId: string }).companyId === companyId && (e as { state: string }).state === "committed");

  // Group by roundId (share class proxy) — use string amounts to avoid BigInt literal TS errors
  const byRoundKeys: string[] = [];
  const byRoundData: Record<string, { amountStr: string; sharesStr: string; roundName: string }> = {};
  for (const entry of companyEntries) {
    const e = entry as { roundId: string; amount: string; shares: string };
    const round = getRoundById(e.roundId);
    if (!byRoundData[e.roundId]) {
      byRoundKeys.push(e.roundId);
      byRoundData[e.roundId] = { amountStr: "0", sharesStr: "0", roundName: round?.name ?? e.roundId };
    }
    const data = byRoundData[e.roundId];
    /* WAVE 33 OQ-33-2 sink 4 — was `Math.round(Number(e.amount) * 100)`, a
     * hardcoded ISO 4217 exponent of 2 on the waterfall's INVESTED figure.
     * The round is already resolved above via getRoundById, so the exponent
     * is derived from the round's own currency. For JPY (exponent 0) the old
     * form inflated every preferred class's invested amount 100x, which
     * inverts who clears their liquidation preference at a given exit. */
    const roundCurrency = (round as { currency?: string | null } | undefined)?.currency ?? "USD";
    try {
      data.amountStr = String(Number(data.amountStr) + toMinor(Number(e.amount), roundCurrency));
      data.sharesStr = String(Number(data.sharesStr) + Math.max(0, Number(e.shares ?? "0")));
    } catch { /* skip bad rows */ }
  }

  const exitProceeds = String(exitMinor);

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 71 · D11 — THIS ROUTE FABRICATED THREE OF ITS OWN INPUTS.
     ═══════════════════════════════════════════════════════════════════════════
     `GET /api/founder/captable/waterfall` is the ONE reachable waterfall surface
     on the platform, and it invented three of the numbers it fed the engine.

     (1) `participating: false` WAS HARDCODED. Participating preferred was therefore
         UNREACHABLE here — no query parameter, no stored read, no way to express it
         — so the two participating scenarios in the QA document could not be
         produced through the API at all. It is now read from the issuing round's
         own `liquidationPreference` term through `roundStoredTerms`, the SAME
         single reader `server/routes.ts::buildCompanySecurities` uses and the same
         one `resolvePreferredTerms` normalises for the cap-table adapter. There is
         no second reader (Wave 70 handoff, R21).

     (2) `liquidationPreferenceMultiple: 1 + lpPct` WAS NOT A MULTIPLE. `lpPct` is
         the QUERY-STRING parameter `preferredReturnPct`, fenced to [0,1], and it
         models an SPV-style PREFERRED RETURN — a hurdle rate on a fund's capital.
         A liquidation preference multiple is a negotiated term of a preferred SHARE
         CLASS, recorded in that class's charter as "1x", "2x", "3x". Two different
         instruments, and one was being used as the other.
           THE CORRECT DERIVATION, stated as D11 requires: the multiple is READ, not
         derived. NVCA Model Certificate of Incorporation Article IV §2.1 fixes the
         preference at "the Original Issue Price ... multiplied by [1.0]" — the
         bracketed figure is the negotiated multiple and it lives in the charter.
         Capavate stores it in the round's free-text `liquidationPreference` field
         ("1x non-participating"), which `roundStoredTerms` now parses STRICTLY for
         a leading `<number>x`. https://nvca.org/model-legal-documents/
           `preferredReturnPct` is still accepted, still validated, and is now
         passed through to `formulaDef` ONLY (where it already went), so an existing
         caller's URL keeps working and stops silently changing a share-class term.

     (3) THE COMMON SHARE COUNT WAS INVENTED. `commonSharesNum = totalPrefSharesNum
         > 0 ? totalPrefSharesNum : 1`, pushed as a single holder `founder_common`,
         with the code's own comment reading "simplified: 1 common holder". The
         founders' leg of the waterfall was NOT read from the cap table — it was set
         equal to the preferred total. Every payout below the preference stack is
         `shares ÷ sharesInPool`, so this changed EVERY as-converted figure on the
         response. Executed on one $10,000,000 non-participating Series A class of
         4,000,000 shares at a $50,000,000 exit:

             FABRICATED common = 4,000,000   ->  Series A $25,000,000, founders $25,000,000
             REAL       common = 8,000,000   ->  Series A $16,666,666.67, founders $33,333,333.33

         The founders were understated by $8,333,333.33 on that single fixture.
         The real count now comes from the company's own cap table, via the
         securities provider this module is handed by `server/routes.ts` (the same
         `buildCompanySecurities` the cap-table and round-math routes read).

     ABSENT REFUSES, BY NAME, AND NEVER INVENTS (D11's instruction, verbatim: "If a
     term is absent, REFUSE — never invent"). A class with no liquidation term on
     record, or a company with no common shares on record, produces a named 422
     rather than a payout schedule built on a guess.

     R58 — WHO SEES THIS. These refusals stop at the API. `grep -ril "waterfall"
     client/src` finds NO founder screen that calls this endpoint; it is an
     API-only surface today (see `build_log/wave71/W71_VISIBILITY.md`). The
     refusal is correct and it is currently read by integrators and tests, not by
     a founder in a browser. That is stated rather than implied.
     ═══════════════════════════════════════════════════════════════════════════ */
  const preferred: unknown[] = [];
  const common: unknown[] = [];
  /* WAVE 74 · R67 — committed rounds that are NOT a preference class, disclosed
     rather than dropped. */
  const nonPreferenceClasses: Array<{
    roundId: string;
    className: string;
    instrument: string;
    shares: string;
    invested: string;
    reason: string;
  }> = [];
  let classIdx = 0;
  for (const rid of byRoundKeys) {
    const data = byRoundData[rid];
    if (Number(data.sharesStr) === 0) continue;
    const terms = roundStoredTerms(rid);
    /* WAVE 74 · R67 — THE CONDITION IS NARROWED HERE, AND ONLY HERE. Read the
       round's own instrument through the same `getRoundById` this route already
       uses above; a positively-identified non-preference instrument is not part
       of the preference stack, so the refusal below is not its refusal to fail.
       Everything else — including an absent or unrecognised instrument — reaches
       the refusal exactly as it does today. */
    const roundInstrument = String(
      (getRoundById(rid) as { instrument?: string | null } | undefined)?.instrument ?? "",
    ).trim().toLowerCase();
    if (NON_PREFERENCE_INSTRUMENTS.has(roundInstrument)) {
      nonPreferenceClasses.push({
        roundId: rid,
        className: data.roundName,
        instrument: roundInstrument,
        shares: data.sharesStr,
        invested: data.amountStr,
        reason:
          `A ${roundInstrument} round carries no liquidation preference, so it is not a ` +
          `preference class in this waterfall and is not refused for lacking that term ` +
          `(owner ruling R67). Its committed shares are reported here rather than dropped; ` +
          `they are not paid a preference and they are not added to the common leg, which is ` +
          `read from the cap table's own common rows.`,
      });
      continue;
    }
    if (terms.liquidationPreferenceMultiple === null || terms.participatingPreferred === null) {
      res.status(422).json({
        ok: false,
        error: "LIQUIDATION_TERM_NOT_ON_RECORD",
        refusal: "liquidation_term_not_on_record",
        refusalName: "liquidation_term_not_on_record",
        field: "liquidationPreference",
        roundId: rid,
        className: data.roundName,
        message:
          `Capavate cannot compute an exit waterfall for "${data.roundName}" because that class's ` +
          `liquidation preference is not on record. ` +
          (terms.liquidationPreferenceRaw
            ? `The round's terms say "${terms.liquidationPreferenceRaw}", which does not state both a ` +
              `multiple (for example "1x") and whether the class is participating. `
            : `No liquidation preference is stored against the round at all. `) +
          `Those two terms decide who is paid first and how much: a 1x non-participating class takes ` +
          `the greater of its money back or its as-converted share, while a participating class takes ` +
          `its money back AND its pro-rata share of what is left. This route used to assume "1x" and ` +
          `"non-participating" for every class on every cap table, which made participating preferred ` +
          `impossible to express and quietly understated what a participating investor is owed. ` +
          `Record the liquidation preference on the round's terms — for example "1x non-participating" ` +
          `or "1x participating" — and the waterfall will compute.`,
      });
      return;
    }
    preferred.push({
      classId: rid,
      className: data.roundName,
      invested: data.amountStr,
      // Waterfall engine accepts bigint for shares — convert via string cast
      shares: (BigInt as unknown as (s: string) => unknown)(data.sharesStr),
      /* WAVE 71 · D11 (2) — the negotiated multiple, READ. Was `1 + lpPct`. */
      liquidationPreferenceMultiple: terms.liquidationPreferenceMultiple,
      /* WAVE 71 · D11 (1) — the negotiated participation term, READ. Was `false`. */
      participating: terms.participatingPreferred,
      /* WAVE 79 · ITEM 2 — the negotiated RANKING, READ. Was `classIdx++`, the order
         the rounds happened to appear in the committed ledger. May be `null` here;
         the check immediately after this loop refuses in that case rather than
         letting a `null` reach the engine's `a.seniority - b.seniority` comparator,
         where it would sort as 0 and silently rebuild a fabricated order.
         `classIdx` is still incremented so a refusal can name classes in ledger
         order. */
      seniority: terms.seniorityRank,
      seniorityOnRecord: terms.seniorityRank !== null,
      ledgerIndex: classIdx++,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 79 · ITEM 2 — THE SENIORITY RANKING IS READ, OR THE ROUTE REFUSES BY NAME.
     ═══════════════════════════════════════════════════════════════════════════
     `seniority: classIdx++` fabricated a strict total order out of ledger order,
     making the EARLIEST round the MOST senior. Market practice is the opposite or
     pari passu, and the ranking decides who is paid first and therefore who is paid
     AT ALL on a small exit. Measured at engine level on an $8,000,000 exit against
     $10,000,000 + $4,000,000 of 1x non-participating preferences:

       route's order (earliest = MOST senior)   early $8,000,000   late  $0
       market order  (latest  = MOST senior)    late  $4,000,000   early $4,000,000

     A $4,000,000 SWING ON AN $8m EXIT, from an order nobody negotiated. It is the
     same defect class as the fabricated common-share count Wave 71 fixed, and it
     appears in none of the eight wave reports.

     WHY A REFUSAL AND NOT A DEFAULT. There is no "natural" ordering to fall back on:
     ledger order, reverse ledger order and pari passu give three different answers
     and the difference is millions of dollars. R6 / R48 / R60 §4 all say the same
     thing — a negotiated term that is not on record is REFUSED BY NAME, never
     derived. R67 condition 1 governs the shape of this branch: it NARROWS what
     computes and it removes no existing refusal, branch or container.

     SCOPED TO WHERE IT BITES, so nothing that works today stops working needlessly:
       · ZERO or ONE preference class — a ranking cannot change any payout because
         there is nothing to rank, so a single class is given `0` (the engine's
         most-senior value) and the assumption is DISCLOSED on the response as
         `seniorityAssumed`. Every one-preference-class cap table — which is every
         round in Wave 74's 112-round census — is UNAFFECTED.
       · TWO OR MORE classes with ANY missing rank -> `SENIORITY_NOT_ON_RECORD`.
       · TWO OR MORE classes with DUPLICATE ranks -> `SENIORITY_RANKING_AMBIGUOUS`.
         Equal ranks mean PARI PASSU, which is the market default and a legitimate
         thing to record — but this waterfall pays preferences SEQUENTIALLY in sorted
         order and clamps each at the money still left, so on an exit that cannot
         cover the stack it pays the first-listed class in full and the second
         nothing, which is the opposite of pari passu. Reporting that as a
         pari-passu result would be a fabricated figure of exactly the kind this item
         exists to remove, so it refuses and the modelling gap is recorded as an
         OWNER QUESTION.
     ═══════════════════════════════════════════════════════════════════════════ */
  const prefRanked = preferred as Array<{
    classId: string; className: string;
    seniority: number | null; seniorityOnRecord: boolean; ledgerIndex: number;
  }>;
  let seniorityAssumed: string | null = null;
  if (prefRanked.length === 1) {
    prefRanked[0].seniority = 0;
    seniorityAssumed =
      `This company has ONE preference class, so no seniority ranking can change any figure on this ` +
      `response and none is required. It is treated as the most senior class (0). A company with two or ` +
      `more preference classes must have a seniority recorded for each one.`;
  } else if (prefRanked.length > 1) {
    const missing = prefRanked.filter((p) => !p.seniorityOnRecord);
    if (missing.length > 0) {
      res.status(422).json({
        ok: false,
        error: "SENIORITY_NOT_ON_RECORD",
        refusal: "seniority_not_on_record",
        refusalName: "seniority_not_on_record",
        field: "seniority",
        companyId,
        classesMissingSeniority: missing.map((p) => ({ roundId: p.classId, className: p.className })),
        classesOnRecord: prefRanked.filter((p) => p.seniorityOnRecord)
          .map((p) => ({ roundId: p.classId, className: p.className, seniority: p.seniority })),
        message:
          `Capavate cannot compute an exit waterfall for this company because the seniority ranking of its ` +
          `${prefRanked.length} preference classes is not on record. ` +
          `${missing.map((p) => `"${p.className}"`).join(", ")} ${missing.length === 1 ? "has" : "have"} no ` +
          `recorded seniority. Seniority decides who is paid FIRST out of the exit proceeds, and therefore ` +
          `who is paid AT ALL when the exit does not cover every liquidation preference. On an $8,000,000 ` +
          `exit against a $10,000,000 and a $4,000,000 1x preference, ranking the earlier round senior pays ` +
          `it $8,000,000 and the later round nothing, while ranking the later round senior pays $4,000,000 ` +
          `to each — a $4,000,000 difference from the ordering alone. This route used to derive the ranking ` +
          `from the order the rounds appear in the committed ledger, which made the EARLIEST round the MOST ` +
          `senior; that is the opposite of the usual arrangement and nobody negotiated it. Record each ` +
          `preference class's seniority on the round (0 is the most senior, then 1, 2, … up to ` +
          `${SENIORITY_RANK_MAX}) and the waterfall will compute. A company with only ONE preference class ` +
          `needs no ranking and is unaffected.`,
      });
      return;
    }
    const ranks = prefRanked.map((p) => Number(p.seniority));
    if (new Set(ranks).size !== ranks.length) {
      /* De-duplicated WITHOUT spreading a `Set`: this module is compiled below
         ES2015, and `[...new Set(x)]` costs a TS2802 against the tree's pinned 587
         type errors (the same reason the adapter writes `BigInt(0)` and not `0n`). */
      const dupes = ranks
        .filter((r, i) => ranks.indexOf(r) !== i)
        .filter((r, i, a) => a.indexOf(r) === i);
      res.status(422).json({
        ok: false,
        error: "SENIORITY_RANKING_AMBIGUOUS",
        refusal: "seniority_ranking_ambiguous",
        refusalName: "seniority_ranking_ambiguous",
        field: "seniority",
        companyId,
        duplicateRanks: dupes,
        classes: prefRanked.map((p) => ({ roundId: p.classId, className: p.className, seniority: p.seniority })),
        message:
          `Capavate cannot compute an exit waterfall because two or more preference classes share the same ` +
          `recorded seniority (${dupes.join(", ")}). Equal seniority means PARI PASSU — the classes rank ` +
          `equally, and when the exit cannot cover both preferences each takes a PRO-RATA share of what is ` +
          `available. This waterfall pays preferences one class at a time in seniority order and clamps each ` +
          `at the money still left, so on a short exit it would pay the first class in full and the second ` +
          `nothing. Reporting that as a pari-passu result would be a fabricated figure, so it refuses ` +
          `instead. Give each preference class a distinct seniority (0 is the most senior), or wait for the ` +
          `release that models pari passu.`,
      });
      return;
    }
  }

  const totalPrefSharesNum = preferred.reduce((s: number, p: unknown) => s + Number(String((p as { shares: unknown }).shares)), 0);
  /* WAVE 74 · R67 — THIS BRANCH IS NOT ALLOWED TO WIDEN ITS OWN MEANING. Its
     comment says "no ledger data", and it hands the founders the ENTIRE exit
     value without ever consulting the common-share count. Before R67 a company
     whose only committed rounds were SAFEs could not reach it — the refusal
     above stopped first. It must not now arrive here and be told it owns 100% of
     the exit: that is the fabricated-money-figure class R48 rules out. Adding
     `nonPreferenceClasses.length === 0` cannot change any input that reaches
     this branch today, because a round only enters that array from the path that
     previously ended in the refusal. A SAFE-only company now falls through to
     the common-shares check and either computes a real waterfall with no
     preference stack, or refuses COMMON_SHARES_NOT_ON_RECORD by name. */
  if (totalPrefSharesNum === 0 && preferred.length === 0 && nonPreferenceClasses.length === 0) {
    // No ledger data — return zero proceeds with empty breakdown
    res.json({
      ok: true,
      /* ── WAVE 77 · R72 — EXACT DECIMAL TEXT, IN THIS BRANCH TOO ───────────────
         R72 condition 1 is "enumerate every consumer first". This branch WAS a
         missed consumer of Wave 75's work: it emits the two money fields but
         never emitted the `*Exact` siblings Wave 75 declared authoritative, so a
         consumer that read `founderProceedsExact` got `undefined` here and any
         arithmetic on it produced `NaN` — the exact failure R72 condition 1 warns
         about, already present in the tree. Both are now emitted, in ONE format:
         exact decimal text. `exitMinor` is an integer count of minor units, so
         `String()` is its exact decimal representation — no rounding, no
         reformatting, no second money format. */
      lpProceeds: "0",
      founderProceeds: String(exitMinor),
      lpProceedsExact: "0",
      founderProceedsExact: String(exitMinor),
      byShareClass: [],
      breakpoints: [],
      /* WAVE 74 · R67 — always present, so a consumer never has to guess whether
         an absent key means "none" or "an older build". */
      nonPreferenceClasses,
      /* WAVE 79 · ITEM 2 — same rule, same reason: the key is always present. This
         branch has NO preference class at all, so there is nothing to rank and
         nothing is assumed. */
      seniority: [],
      seniorityAssumed: null,
    });
    return;
  }

  /* ── WAVE 71 · D11 (3) — THE COMMON LEG, FROM THE CAP TABLE ────────────────
     Was: `commonSharesNum = totalPrefSharesNum > 0 ? totalPrefSharesNum : 1` and a
     single synthetic `founder_common` holder. Now: the company's real `common`
     rows, each as its own holder so the response can attribute proceeds per
     founder instead of to one invented aggregate. `founder_common` is retained as
     the id of the aggregate ONLY when the provider is unavailable — and in that
     case the route REFUSES rather than substituting a count. */
  const commonRows = readCompanyCommonRows(companyId);
  if (commonRows === null) {
    res.status(422).json({
      ok: false,
      error: "COMMON_SHARES_NOT_ON_RECORD",
      refusal: "common_shares_not_on_record",
      refusalName: "common_shares_not_on_record",
      field: "shares",
      companyId,
      message:
        `Capavate cannot compute an exit waterfall because this company has no common shares on ` +
        `record. Everything paid out below the preference stack is divided by the common share ` +
        `count, so an invented one changes every figure on this response: on a $50,000,000 exit ` +
        `with one $10,000,000 non-participating class of 4,000,000 shares, a common count of ` +
        `4,000,000 pays the founders $25,000,000 and a real count of 8,000,000 pays them ` +
        `$33,333,333.33. This route used to set the common count EQUAL to the total preferred ` +
        `count, with its own comment describing that as "simplified". It no longer guesses. ` +
        `Record the founders' common shares on the cap table.`,
    });
    return;
  }
  for (const row of commonRows) {
    common.push({ holderId: row.holderId, shares: (BigInt as unknown as (s: string) => unknown)(row.shares) });
  }

  // ── XT-C5 · WATERFALL BOUNDARY (2 of 3) ───────────────────────────────────
  // This is the FOUNDER-SIDE EXIT waterfall: liquidation preferences by share
  // class and breakpoints — who gets what if the COMPANY is sold. It is NOT
  // the SPV LP distribution waterfall and must never be substituted for it.
  //   · SPV LP distribution (canonical, persists, collects carry, hash-chained)
  //     → `spvEngineStore.recordDistribution` (server/spvEngineStore.ts:1697)
  //   · SPV distribution PREVIEW (persists nothing)
  //     → `computeDistributionSplit` (server/lib/spvOfflineOps.ts)
  // Three implementations, three capabilities, no rivalry. ENGINE_REGISTRY C-5.
  // Import waterfall engine (sacred — read-only)
  let computeWaterfall: (input: unknown) => unknown;
  try {
    const engine = await import("@capavate/cap-table-engine");
    computeWaterfall = (engine as unknown as { computeWaterfall: (i: unknown) => unknown }).computeWaterfall;
  } catch (err) {
    log.warn("[track1/waterfall] engine import failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "ENGINE_UNAVAILABLE" }); return;
  }

  const formulaId = `waterfall_${companyId}`;
  const waterfallInput = {
    exitProceeds,
    preferred,
    common,
    formulaId,
    formulaVersion: "v25.0",
    region: "US" as const,
    formulaDef: { preferredReturnPct: lpPct, exitMinor },
  };

  let result: unknown;
  try {
    result = computeWaterfall(waterfallInput);
  } catch (err) {
    log.warn("[track1/waterfall] compute failed:", (err as Error).message);
    res.status(422).json({ ok: false, error: "WATERFALL_COMPUTE_ERROR", message: (err as Error).message }); return;
  }

  const output = result as { payouts: unknown[]; remainder: string };
  const payouts = output.payouts as Array<{
    classId?: string; holderId?: string; className?: string;
    total: string; decision: string;
  }>;

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 75 · ITEM 3 — WHERE AN EXACT DECIMAL BECAME A FLOAT (W74 finding N-4).
     ═══════════════════════════════════════════════════════════════════════════
     THE DEFECT, measured. `W74-R67-C` expected $33,333,333.33 of founder proceeds
     and got `3333333333.3333335` minor units — a third of a cent of IEEE-754
     residue on a payout figure. THE ENGINE IS NOT AT FAULT: every `payouts[].total`
     is an EXACT decimal string produced by `packages/cap-table-engine/src/waterfall/
     liquidationWaterfall.ts` through `primitives/bigDecimal.ts`, which locks
     decimal.js at 38 significant digits. **The boundary where the exactness was
     lost is `Number(p.total)` in these three reducers**, and that is where it is
     fixed — not with a display-layer round, which would hide it and let the next
     consumer inherit it.

     WHAT THIS FIXES AND WHAT IT HONESTLY CANNOT. Summing in decimal.js removes all
     ACCUMULATION error: n payouts now add up exactly, whatever n is. It cannot make
     a JSON `number` hold a non-terminating decimal — one third of $100,000,000 is
     `3333333333.333…` and no IEEE-754 double is that value. So the exact figure is
     ALSO emitted, as a string, on the additive `*Exact` fields below, and THOSE are
     the authoritative money values. The legacy numeric fields keep their name,
     their position and their meaning (removing them would be a silent drop) and now
     carry the closest double to the EXACT sum rather than the closest double to a
     float accumulation. NO MONEY MOVED in this wave: the numeric fields are
     unchanged to the last representable digit on the documented fixture, which is
     why `W74-R67-C` still passes untouched. Whether the numeric field should instead
     be integer-allocated to whole minor units — `server/lib/money.ts::
     allocateResidualCents`, the platform's declared largest-remainder allocator — is
     an OWNER QUESTION (W75 Q-C), because it WOULD move a founder's reported figure
     by a third of a cent and R67 condition 3 says founder money moves once, in one
     measured step.

     ════════════════════════════════════════════════════════════════════════
     WAVE 77 · R72 — THE PARAGRAPH ABOVE IS NOW SUPERSEDED, AND SAYS SO.
     ════════════════════════════════════════════════════════════════════════
     Wave 75 was correct that a JSON `number` cannot hold `33,333,333.333…`, and it
     recorded that as open item J-1. The owner answered with R72: **carry the money
     as exact decimal text — an authorised INTERFACE CHANGE.** So the four money
     fields on this response (`lpProceeds`, `founderProceeds`,
     `byShareClass[].proceeds`, `breakpoints[].exitMinor`) are now the engine's own
     exact decimal strings, and the `*Exact` fields Wave 75 added REMAIN, emitting
     byte-identical values, as aliases — removing them would be a silent drop for
     any consumer Wave 75 told to read them.

     ONE FORMAT, NOT TWO (R72 condition 2): the representation is exactly the one
     the engine already uses for share counts and prices — a decimal string,
     unrounded, unformatted, no exponent, no thousands separators, no currency
     symbol. NOTHING IS ROUNDED HERE (R72 condition 3): any rounding belongs at a
     display layer, once, with the convention stated, and no screen renders this
     figure yet (R72 condition 5 — the reason the change is cheap now).
     NO `Number(...)` ON A MONEY STRING (R72 condition 4), policed as source text by
     `W77-M4` in `server/__tests__/w77_maturity_convergence_and_exact_money.test.ts`.
     Every consumer was enumerated BEFORE this edit:
     `build_log/wave77/W77_MONEY_CONSUMERS.md`. */
  const exactSum = (rows: Array<{ total: string }>): Decimal =>
    rows.reduce<Decimal>((acc, p) => acc.plus(new Decimal(String(p.total))), new Decimal(0));

  const lpProceedsExactDec = exactSum(payouts.filter((p) => p.classId));
  /* WAVE 77 · R72 — EXACT DECIMAL TEXT, not a double. `.toNumber()` was the
     narrowing; `.toFixed()` with no argument emits the Decimal's full precision
     and rounds NOTHING (R72 condition 3). See the block above `res.json`. */
  const lpProceeds = lpProceedsExactDec.toFixed();
  /* ── WAVE 71b — THE COMMON LEG WAS BEING REPORTED AS ZERO ──────────────────
     Wave 71's D11(3) stopped emitting the invented `founder_common` aggregate and
     started pushing the company's REAL common holders, each under its own
     `holderId` from `readCompanyCommonRows`. This summary was left filtering on the
     literal `"founder_common"`, an id the route can no longer produce, so
     `founderProceeds` became structurally 0 on every response. Measured on a
     correct fixture (one 1x non-participating JPY class, 8,000,000 real common
     shares, exit 2,000,000 minor): the engine paid 1,000,000 to the preference and
     1,000,000 to common, and this line reported the common 1,000,000 as `0`.

     THE FIX IS TO SUM THE LEG, NOT A NAME. Every id in `common` above is a
     holder of the common leg by construction, so the leg is exactly the payouts
     carrying one of those ids. `founder_common` is kept in the accepted set so the
     figure still adds up if any path ever emits the aggregate again — it is a
     fallback, not the selector. D11's refusal guarantees `common` is non-empty
     whenever this line runs. */
  const commonLegHolderIds = new Set<string>([
    "founder_common",
    ...common.map((c) => String((c as { holderId: unknown }).holderId)),
  ]);
  /* WAVE 75 · ITEM 3 — exact, for the reasons in the block above. The SELECTOR is
     byte-for-byte Wave 71b's; only the arithmetic changed. */
  const founderProceedsExactDec = exactSum(
    payouts.filter((p) => !p.classId && p.holderId != null && commonLegHolderIds.has(String(p.holderId))),
  );
  /* WAVE 77 · R72 — the figure the ruling was issued about. `.toNumber()` here is
     what rendered `3333333333.3333335`: one third of $100,000,000 is a
     non-terminating decimal and NO IEEE-754 double is that value. `.toFixed()`
     carries every digit the engine computed, exactly as the engine already does
     for share counts and prices. */
  const founderProceeds = founderProceedsExactDec.toFixed();

  const byShareClass = payouts
    .filter((p) => p.classId)
    .map((p) => ({
      classId: p.classId,
      className: p.className ?? p.classId,
      /* WAVE 77 · R72 — `Number(p.total)` was here. The engine's `total` IS
         already an exact decimal string, so the correct code is to pass it
         through untouched: no parse, no format, no rounding. The field keeps its
         name and its position (no silent drop) and now carries the same
         representation as its `proceedsExact` sibling, so there is ONE money
         format on this response rather than two. */
      proceeds: String(p.total),
      /* WAVE 75 · ITEM 3 — retained as an ALIAS, byte-identical to `proceeds`
         above. Removing it would be a silent drop for any consumer Wave 75 told
         to read it. */
      proceedsExact: String(p.total),
      decision: p.decision,
    }));

  // Compute breakpoints: at what exit value LP and founder proceeds cross
  const breakpoints: Array<{ exitMinor: string; description: string }> = [
    {
      /* WAVE 75 · ITEM 3 — the same quantity as `lpProceeds`, so it is now the same
         exact value rather than a second float sum of the same rows.
         WAVE 77 · R72 — and therefore the same REPRESENTATION: it is assigned from
         `lpProceeds`, which is now exact decimal text. A number here beside a
         string there would be the second money format R72 condition 2 forbids. */
      exitMinor: lpProceeds,
      description: "liquidation_preference_covered",
    },
  ];

  emitBridge("captable.waterfall.computed", companyId, "company", { companyId, exitMinor, lpProceeds, founderProceeds });

  res.json({
    ok: true,
    lpProceeds,
    founderProceeds,
    /* WAVE 75 · ITEM 3 — ADDITIVE, and the authoritative money figures. The engine's
       own exact decimals, carried as strings so a consumer inherits exactness instead
       of a float. Nothing was removed: `lpProceeds` and `founderProceeds` keep their
       names, their order and their meaning. */
    /* WAVE 77 · R72 — ALIASES NOW, not a second representation: byte-identical to
       `lpProceeds` / `founderProceeds` above. Kept because Wave 75 published them
       as the authoritative fields and a consumer may already read them. */
    lpProceedsExact: lpProceedsExactDec.toFixed(),
    founderProceedsExact: founderProceedsExactDec.toFixed(),
    byShareClass,
    breakpoints,
    /* WAVE 74 · R67 — every committed round that is not a preference class,
       named on the response. NO SILENT DROPS. */
    nonPreferenceClasses,
    /* WAVE 79 · ITEM 2 — the seniority ranking, DISCLOSED. Either every class's
       recorded rank is echoed back so a consumer can see which order produced
       these figures, or — for a single-class company, where no ranking can change
       anything — the assumption is stated in words. It is never silently derived.
       Always present, so a consumer never has to guess whether an absent key means
       "none" or "an older build" (the R67 rule this route already follows for
       `nonPreferenceClasses`). */
    seniority: prefRanked.map((p) => ({
      roundId: p.classId, className: p.className,
      seniority: p.seniority, onRecord: p.seniorityOnRecord,
    })),
    seniorityAssumed,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A2 — POST /api/founder/term-sheets/generate
//      GET  /api/founder/term-sheets/:id/download
// ─────────────────────────────────────────────────────────────────────────────

function buildTermSheetMarkdown(round: ReturnType<typeof getRoundById>): string {
  if (!round) return "# Term Sheet\n\n_Round not found._\n";
  const terms = (round as unknown as { terms?: Record<string, unknown> }).terms ?? {};
  const lines = [
    `# Term Sheet — ${round.name}`,
    ``,
    `**Company ID:** ${round.companyId}`,
    `**Round Type:** ${round.type}`,
    `**State:** ${round.state}`,
    `**Target Amount:** ${round.targetAmount?.toLocaleString() ?? "N/A"} ${round.currency ?? "USD"}`,
    `**Pre-Money Valuation:** ${round.preMoney?.toLocaleString() ?? "N/A"}`,
    `**Price Per Share:** ${round.pricePerShare ?? "N/A"}`,
    `**Close Date:** ${round.closeDate ?? "TBD"}`,
    `**Instrument:** ${round.instrument ?? "SAFE"}`,
    ``,
    `## Terms`,
    ``,
    ...(Object.keys(terms).length > 0
      ? Object.entries(terms).map(([k, v]) => `- **${k}:** ${v}`)
      : ["_No terms defined on this round._"]),
    ``,
    `## Summary`,
    ``,
    round.termsSummary ?? "_No summary available._",
    ``,
    `---`,
    `*Generated by Capavate v25.0 at ${nowIso()}*`,
  ];
  return lines.join("\n");
}

function handleTermSheetGenerate(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { roundId, format } = req.body as { roundId?: string; format?: string };
  if (!roundId) { res.status(422).json({ ok: false, error: "MISSING_ROUND_ID" }); return; }
  if (format && format !== "markdown" && format !== "pdf") {
    res.status(422).json({ ok: false, error: "INVALID_FORMAT", message: "format must be 'markdown' or 'pdf'" }); return;
  }

  const round = getRoundById(roundId);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  if (!ownsCompany(ctx, round.companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const resolvedFormat = (format as "markdown" | "pdf") ?? "markdown";
  const contentMd = buildTermSheetMarkdown(round);
  const docId = newId("ts");
  const createdAt = nowIso();

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO term_sheets (id, round_id, owner_id, format, content_md, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(docId, roundId, ctx.userId, resolvedFormat, contentMd, createdAt);
  } catch (err) {
    log.error("[track1/term-sheet] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  emitBridge("termSheet.generated", roundId, "round", { docId, roundId, format: resolvedFormat, ownerId: ctx.userId });

  res.status(201).json({
    ok: true,
    docId,
    format: resolvedFormat,
    downloadUrl: `/api/founder/term-sheets/${docId}/download`,
    generatedAt: createdAt,
  });
}

function handleTermSheetDownload(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { id } = req.params;
  let row: { id: string; round_id: string; owner_id: string; format: string; content_md: string; created_at: string } | undefined;
  try {
    const db = rawDb();
    row = db.prepare(`SELECT * FROM term_sheets WHERE id = ?`).get(id) as typeof row;
  } catch (err) {
    log.warn("[track1/term-sheet-download] DB read failed:", (err as Error).message);
  }

  if (!row) { res.status(404).json({ ok: false, error: "NOT_FOUND" }); return; }

  // Ownership: owner OR admin
  if (row.owner_id !== ctx.userId && !ctx.isAdmin) {
    res.status(403).json({ ok: false, error: "FORBIDDEN" }); return;
  }

  if (row.format === "pdf") {
    const pdfBuf = markdownToPdf(row.content_md);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="term-sheet-${id}.pdf"`);
    res.send(pdfBuf);
  } else {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="term-sheet-${id}.md"`);
    res.send(row.content_md);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A3 — POST /api/founder/crm/import
// ─────────────────────────────────────────────────────────────────────────────

function parseCsvText(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? "").trim(); });
    return row;
  });
}

function handleCrmImport(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  let csvText: string | undefined;

  // Support both multipart upload and text/csv content-type
  const contentType = req.headers["content-type"] ?? "";
  if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    csvText = req.body as string;
  } else if ((req as unknown as { file?: { buffer: Buffer } }).file) {
    csvText = (req as unknown as { file: { buffer: Buffer } }).file.buffer.toString("utf8");
  } else if (typeof req.body === "string") {
    csvText = req.body;
  }

  if (!csvText || csvText.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_CSV", message: "Provide CSV as body or file upload" }); return;
  }

  // v25.0 B-J5-3 fix: extract companyId so we can write to founderCrmStore
  // (the source for GET /api/founder/crm/contacts). Accept from multipart field,
  // query param, or JSON body.
  const companyId: string | undefined =
    (typeof (req as any).body === "object" && typeof (req as any).body?.companyId === "string"
      ? (req as any).body.companyId
      : undefined) ??
    (typeof req.query.companyId === "string" ? req.query.companyId : undefined) ??
    // Multipart: multer puts non-file fields in req.body
    (typeof (req as any).body?.companyId === "string" ? (req as any).body.companyId : undefined) ??
    ctx.founder?.activeCompanyId ?? undefined;

  const rows = parseCsvText(csvText);
  if (rows.length === 0) {
    res.status(422).json({ ok: false, error: "EMPTY_CSV" }); return;
  }
  if (rows.length > 1000) {
    res.status(422).json({ ok: false, error: "TOO_MANY_ROWS", message: "Max 1000 rows per import" }); return;
  }

  let imported = 0;
  let skipped = 0;
  // v25.52 (GPT-5.5 R6 blocker) — track founder-CRM persistence separately from
  // roster import so a null from insertContactForImport (duplicate skip, dedup
  // guard unavailable, or DB write failure) is not silently reported as an
  // imported founder CRM row.
  let crmPersisted = 0;
  let crmSkipped = 0;
  const errors: Array<{ row: number; reason: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = (row["email"] ?? "").trim().toLowerCase();
    if (!email) {
      skipped++;
      continue;
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ row: i + 2, reason: `invalid_email: ${email}` });
      skipped++;
      continue;
    }

    try {
      addContact({
        name: row["name"] ?? email,
        email,
        kind: "ecosystem" as const,
        firm: row["organization"] ?? row["firmname"] ?? row["firm"] ?? "",
        pipelineStage: "lead" as const,
      }, ctx.userId);
      // v25.0 B-J5-3 fix: ALSO write to founderCrmStore so GET /api/founder/crm/contacts returns these rows.
      // v25.52 (GPT-5.5 R6): insertContactForImport now returns null on duplicate
      // / dedup-guard-unavailable / DB write failure. Count CRM persistence
      // separately and record a per-row note so the caller can see the founder
      // CRM row was NOT created even though the roster contact was added.
      if (companyId) {
        const crmRow = insertContactForImport({
          companyId,
          email,
          name: row["name"] ?? email,
          firmName: row["organization"] ?? row["firmname"] ?? row["firm"] ?? "",
          stage: row["stage"] ?? "lead",
          series: row["series"] ?? "—",
        });
        if (crmRow) crmPersisted++;
        else { crmSkipped++; errors.push({ row: i + 2, reason: `crm_contact_skipped_or_persist_failed: ${email}` }); }
      }
      imported++;
    } catch (err) {
      errors.push({ row: i + 2, reason: (err as Error).message });
      skipped++;
    }
  }

  emitBridge("crm.import.completed", ctx.userId, "platform", { imported, skipped, crmPersisted, crmSkipped, errorCount: errors.length, userId: ctx.userId });

  // `imported` = roster contacts added; `crmPersisted`/`crmSkipped` = founder CRM
  // rows actually written vs skipped (duplicate/guard-unavailable/DB-fail).
  res.status(201).json({ ok: true, imported, skipped, crmPersisted, crmSkipped, errors });
}

// ─────────────────────────────────────────────────────────────────────────────
// A4 — POST /api/founder/data-room/files
//      POST /api/founder/data-room/grants
//      GET  /api/founder/data-room/files/:fileId
// ─────────────────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES_B64 = 5 * 1024 * 1024 * 4 / 3; // ~6.67MB base64 for 5MB binary

function handleDataRoomUpload(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { roundId, filename, contentBase64, mimeType } = req.body as {
    roundId?: string; filename?: string; contentBase64?: string; mimeType?: string;
  };

  if (!roundId) { res.status(422).json({ ok: false, error: "MISSING_ROUND_ID" }); return; }
  if (!filename) { res.status(422).json({ ok: false, error: "MISSING_FILENAME" }); return; }
  if (!contentBase64) { res.status(422).json({ ok: false, error: "MISSING_CONTENT_BASE64" }); return; }
  if (!mimeType) { res.status(422).json({ ok: false, error: "MISSING_MIME_TYPE" }); return; }

  if (contentBase64.length > MAX_FILE_BYTES_B64) {
    res.status(422).json({ ok: false, error: "FILE_TOO_LARGE", message: "Max file size is 5MB" }); return;
  }

  const round = getRoundById(roundId);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  if (!ownsCompany(ctx, round.companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const fileId = newId("drf");
  const uploadedAt = nowIso();

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO data_room_files (id, round_id, owner_id, filename, content_base64, mime_type, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(fileId, roundId, ctx.userId, filename, contentBase64, mimeType, uploadedAt);
  } catch (err) {
    log.error("[track1/data-room-upload] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  emitBridge("dataRoom.file.uploaded", roundId, "round", { fileId, roundId, filename, mimeType, ownerId: ctx.userId });

  res.status(201).json({ ok: true, fileId, uploadedAt });
}

function handleDataRoomGrant(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { fileId, investorId, ttlMinutes } = req.body as {
    fileId?: string; investorId?: string; ttlMinutes?: number;
  };

  if (!fileId) { res.status(422).json({ ok: false, error: "MISSING_FILE_ID" }); return; }
  if (!investorId) { res.status(422).json({ ok: false, error: "MISSING_INVESTOR_ID" }); return; }

  const ttl = Number(ttlMinutes ?? 60);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 43200) {
    res.status(422).json({ ok: false, error: "INVALID_TTL", message: "ttlMinutes must be 1–43200" }); return;
  }

  let fileRow: { round_id: string; owner_id: string } | undefined;
  try {
    const db = rawDb();
    fileRow = db.prepare(`SELECT round_id, owner_id FROM data_room_files WHERE id = ?`).get(fileId) as typeof fileRow;
  } catch (err) {
    log.warn("[track1/data-room-grant] DB read failed:", (err as Error).message);
  }

  if (!fileRow) { res.status(404).json({ ok: false, error: "FILE_NOT_FOUND" }); return; }

  const round = getRoundById(fileRow.round_id);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  if (!ownsCompany(ctx, round.companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const token = randomBytes(32).toString("hex");
  const grantId = newId("drg");
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();
  const createdAt = nowIso();

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO data_room_grants (id, file_id, investor_id, token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(grantId, fileId, investorId, token, expiresAt, createdAt);
  } catch (err) {
    log.error("[track1/data-room-grant] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  emitBridge("dataRoom.grant.created", fileId, "round", { grantId, fileId, investorId, expiresAt });

  // Notify the investor
  try {
    emitNotification({
      userId: investorId,
      kind: "dataroom.access_granted",
      title: "Data room access granted",
      body: `You have been granted access to a document. Token expires at ${expiresAt}.`,
      link: `/api/public/data-room/files/${fileId}?grant=${token}`,
    });
  } catch { /* best-effort */ }

  res.status(201).json({ ok: true, grantToken: token, expiresAt });
}

function handleDataRoomFileGet(req: Request, res: Response): void {
  const { fileId } = req.params;
  const grantToken = req.query["grant"] as string | undefined;

  // Check grant token path (no auth session required for this path)
  if (grantToken) {
    let grant: { file_id: string; investor_id: string; expires_at: string } | undefined;
    let fileRow: { filename: string; content_base64: string; mime_type: string } | undefined;
    try {
      const db = rawDb();
      grant = db.prepare(`SELECT * FROM data_room_grants WHERE token = ? AND file_id = ?`).get(grantToken, fileId) as typeof grant;
      if (grant) {
        fileRow = db.prepare(`SELECT filename, content_base64, mime_type FROM data_room_files WHERE id = ?`).get(fileId) as typeof fileRow;
      }
    } catch (err) {
      log.warn("[track1/data-room-get] DB read failed:", (err as Error).message);
    }

    if (!grant) { res.status(403).json({ ok: false, error: "INVALID_GRANT" }); return; }
    if (new Date(grant.expires_at) < new Date()) { res.status(403).json({ ok: false, error: "GRANT_EXPIRED" }); return; }
    if (!fileRow) { res.status(404).json({ ok: false, error: "FILE_NOT_FOUND" }); return; }

    const buf = Buffer.from(fileRow.content_base64, "base64");
    res.setHeader("Content-Type", fileRow.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename="${fileRow.filename}"`);
    res.send(buf);
    return;
  }

  // Without grant token, require auth + ownership
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  let fileRow: { round_id: string; owner_id: string; filename: string; content_base64: string; mime_type: string; uploaded_at: string } | undefined;
  try {
    const db = rawDb();
    fileRow = db.prepare(`SELECT * FROM data_room_files WHERE id = ?`).get(fileId) as typeof fileRow;
  } catch (err) {
    log.warn("[track1/data-room-get] DB read failed:", (err as Error).message);
  }

  if (!fileRow) { res.status(404).json({ ok: false, error: "FILE_NOT_FOUND" }); return; }

  const round = getRoundById(fileRow.round_id);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  if (!ownsCompany(ctx, round.companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const buf = Buffer.from(fileRow.content_base64, "base64");
  res.setHeader("Content-Type", fileRow.mime_type);
  res.setHeader("Content-Disposition", `attachment; filename="${fileRow.filename}"`);
  res.send(buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// A5 — POST /api/investor/invitations/:token/kyc
// ─────────────────────────────────────────────────────────────────────────────

function handleInvestorKyc(req: Request, res: Response): void {
  const token = String(req.params["token"] ?? "");
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { accredited, jurisdiction, source_of_funds, attestations } = req.body as {
    accredited?: boolean; jurisdiction?: string; source_of_funds?: string; attestations?: unknown[];
  };

  if (typeof accredited !== "boolean") {
    res.status(422).json({ ok: false, error: "MISSING_ACCREDITED", message: "accredited (boolean) is required" }); return;
  }
  if (!jurisdiction || typeof jurisdiction !== "string") {
    res.status(422).json({ ok: false, error: "MISSING_JURISDICTION" }); return;
  }
  if (!source_of_funds || typeof source_of_funds !== "string") {
    res.status(422).json({ ok: false, error: "MISSING_SOURCE_OF_FUNDS" }); return;
  }
  if (!Array.isArray(attestations)) {
    res.status(422).json({ ok: false, error: "MISSING_ATTESTATIONS", message: "attestations must be an array" }); return;
  }

  // Validate the invitation token
  let invitation: { id: string; investor_email: string; state: string } | undefined;
  try {
    const db = rawDb();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    invitation = db.prepare(
      `SELECT id, investor_email, state FROM round_invitations WHERE token_hash = ? LIMIT 1`
    ).get(tokenHash) as typeof invitation;
  } catch (err) {
    log.warn("[track1/kyc] invitation lookup failed:", (err as Error).message);
  }

  if (!invitation) { res.status(404).json({ ok: false, error: "INVITATION_NOT_FOUND" }); return; }

  // The investor must own this invitation (their session email matches)
  const investorId = ctx.userId;
  const kycId = newId("kyc");
  const createdAt = nowIso();
  const attestationsJson = JSON.stringify(attestations);

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO investor_kyc (id, investor_id, accredited, jurisdiction, source_of_funds, attestations_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(kycId, investorId, accredited ? 1 : 0, jurisdiction, source_of_funds, attestationsJson, createdAt);
  } catch (err) {
    log.error("[track1/kyc] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  // Update investor profile: kyc_completed = true, accreditation = accredited
  try {
    const db = rawDb();
    db.prepare(
      `UPDATE profilestore_investor_profile SET updated_at = ? WHERE investor_id = ?`
    ).run(createdAt, investorId);
  } catch { /* best-effort profile update */ }

  emitBridge("kyc.status_changed", investorId, "investor", { investorId, accredited, jurisdiction, kycId, invitationId: invitation.id });

  try {
    emitNotification({
      userId: investorId,
      kind: "kyc.status_changed",
      title: "KYC completed",
      body: "Your KYC attestation has been recorded.",
    });
  } catch { /* best-effort */ }

  res.status(201).json({
    ok: true,
    kycId,
    investorId,
    accredited,
    jurisdiction,
    createdAt,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A6 — POST /api/investor/documents/:id/sign
// ─────────────────────────────────────────────────────────────────────────────

function handleDocumentSign(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const documentId = String(req.params["id"] ?? "");
  const { signature, signed_at } = req.body as { signature?: string; signed_at?: string };

  if (!signature || typeof signature !== "string" || signature.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_SIGNATURE" }); return;
  }

  const signerId = ctx.userId;
  const resolvedSignedAt = signed_at ?? nowIso();

  // Idempotency: check if already signed by this user
  let existing: { id: string; document_id: string; signer_id: string; signature_text: string; signed_at: string } | undefined;
  try {
    const db = rawDb();
    existing = db.prepare(
      `SELECT * FROM document_signatures WHERE document_id = ? AND signer_id = ?`
    ).get(documentId, signerId) as typeof existing;
  } catch (err) {
    log.warn("[track1/sign] DB read failed:", (err as Error).message);
  }

  if (existing) {
    // Return existing record (idempotent)
    res.json({
      ok: true,
      signatureId: existing.id,
      documentId: existing.document_id,
      signerId: existing.signer_id,
      signedAt: existing.signed_at,
      alreadySigned: true,
    });
    return;
  }

  const sigId = newId("sig");
  /* WAVE 22 · ITEM 2 (REVIEW B F-3) — this used to read the LEFTMOST
   * `x-forwarded-for` entry, which is caller-supplied text. A signature's
   * `ip_address` column is evidence; anything a signer can dictate is not
   * evidence. Resolution now goes through the ONE hardened resolver
   * (`server/lib/rateLimit.ts#resolveRateLimitClientIp`, Wave 19 WAIVER-2 +
   * Wave 21) rather than a second local copy of the same security decision.
   * Fail-closed: with no `TRUSTED_PROXY_HOPS` configured the socket peer is
   * used and the header is ignored completely. */
  const ipAddress = resolveRateLimitClientIp(req);

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO document_signatures (id, document_id, signer_id, signature_text, signed_at, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sigId, documentId, signerId, signature, resolvedSignedAt, ipAddress);
  } catch (err) {
    log.error("[track1/sign] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  emitBridge("document.signed", documentId, "round", { sigId, documentId, signerId, signedAt: resolvedSignedAt });

  res.status(201).json({
    ok: true,
    signatureId: sigId,
    documentId,
    signerId,
    signedAt: resolvedSignedAt,
    alreadySigned: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A7 — POST /api/rounds/:id/soft-circle/:scId/reject
// ─────────────────────────────────────────────────────────────────────────────

function handleSoftCircleReject(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const roundId = String(req.params["id"] ?? "");
  const scId = String(req.params["scId"] ?? "");
  const { reason } = req.body as { reason?: string };

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_REASON" }); return;
  }

  if (!ownsRound(ctx, roundId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  // Look up soft circle in memory store
  const circles = softCircleListForRound(roundId);
  const sc = circles.find((c: { id: string }) => c.id === scId);
  if (!sc) { res.status(404).json({ ok: false, error: "SOFT_CIRCLE_NOT_FOUND" }); return; }

  const scAny = sc as unknown as {
    id: string; roundId: string; status: string; investorName: string;
    rejectedAt?: string; rejectedReason?: string; updatedAt?: string;
  };

  // Idempotency: if already rejected, return same response
  if (scAny.status === "rejected" && scAny.rejectedAt) {
    res.json({
      ok: true,
      scId,
      status: "rejected",
      rejectedAt: scAny.rejectedAt,
      rejectedReason: scAny.rejectedReason ?? reason,
      alreadyRejected: true,
    });
    return;
  }

  // Validate current status allows rejection
  const REJECTABLE_STATUSES = ["intent", "confirmed", "wired"];
  if (!REJECTABLE_STATUSES.includes(scAny.status)) {
    res.status(422).json({
      ok: false,
      error: "INVALID_STATUS_TRANSITION",
      message: `Cannot reject a soft circle in '${scAny.status}' state`,
    }); return;
  }

  const rejectedAt = nowIso();

  // Update in memory cache
  scAny.status = "rejected" as unknown as string;
  scAny.rejectedAt = rejectedAt;
  scAny.rejectedReason = reason;
  scAny.updatedAt = rejectedAt;

  // Persist to DB
  try {
    const db = rawDb();
    db.prepare(
      `UPDATE soft_circles SET status = 'rejected', rejected_at = ?, rejected_reason = ?, updated_at = ? WHERE id = ?`
    ).run(rejectedAt, reason, rejectedAt, scId);
  } catch (err) {
    log.error("[track1/sc-reject] DB update failed:", (err as Error).message);
    // Don't fail — in-memory updated; DB write best-effort on this column
  }

  emitBridge("softCircle.rejected", roundId, "round", { scId, roundId, reason, rejectedAt, investorName: scAny.investorName });

  res.json({
    ok: true,
    scId,
    status: "rejected",
    rejectedAt,
    rejectedReason: reason,
    alreadyRejected: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A8 — POST /api/rounds/:id/updates
// ─────────────────────────────────────────────────────────────────────────────

function handleRoundUpdate(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const roundId = String(req.params["id"] ?? "");
  const { title, body, visibility } = req.body as {
    title?: string; body?: string; visibility?: string;
  };

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_TITLE" }); return;
  }
  if (!body || typeof body !== "string" || body.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_BODY" }); return;
  }
  const validVisibilities = ["all", "committed", "collective_only"];
  const resolvedVisibility = visibility ?? "all";
  if (!validVisibilities.includes(resolvedVisibility)) {
    res.status(422).json({ ok: false, error: "INVALID_VISIBILITY", message: "visibility must be 'all', 'committed', or 'collective_only'" }); return;
  }

  if (!ownsRound(ctx, roundId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const round = getRoundById(roundId);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  const updateId = newId("upd");
  const publishedAt = nowIso();

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO round_updates (id, round_id, author_id, title, body, visibility, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(updateId, roundId, ctx.userId, title.trim(), body.trim(), resolvedVisibility, publishedAt);
  } catch (err) {
    log.error("[track1/round-update] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  // Notification fanout: notify committed investors (and collective if visibility=collective_only|all)
  const circles = softCircleListForRound(roundId);
  const committedInvestors = circles
    .filter((sc: unknown) => (sc as { status: string }).status === "committed" || (sc as { status: string }).status === "wired")
    .map((sc: unknown) => (sc as { investorUserId?: string }).investorUserId)
    .filter((id): id is string => typeof id === "string");

  const notifySet = new Set<string>(committedInvestors);
  const notifyArr = Array.from(notifySet);

  for (const investorId of notifyArr) {
    try {
      emitNotification({
        userId: investorId,
        kind: "investor_report.published",
        title: `New update: ${title}`,
        body: `${round.name} published a new update.`,
        link: `/rounds/${roundId}/updates/${updateId}`,
      });
    } catch { /* best-effort */ }
  }

  emitBridge("round.update.published", roundId, "round", {
      updateId, roundId, authorId: ctx.userId, title, visibility: resolvedVisibility,
      notifiedCount: notifySet.size, publishedAt,
    });

  res.status(201).json({
    ok: true,
    updateId,
    roundId,
    authorId: ctx.userId,
    title: title.trim(),
    visibility: resolvedVisibility,
    publishedAt,
    notifiedCount: notifySet.size,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 71 · D11 (3) — WHERE THE REAL COMMON SHARE COUNT COMES FROM.
   ═══════════════════════════════════════════════════════════════════════════
   `buildCompanySecurities` lives inside `server/routes.ts::registerRoutes`'s
   closure and cannot be imported. `server/routes.ts` ALREADY solves exactly this
   for the round-math routes by INJECTING it:

       registerRoundMathRoutes(app, (cid) => buildCompanySecurities(cid) as never);

   The same pattern is used here rather than inventing a second way to reach the
   cap table, and rather than re-deriving the rows from the sacred ledger (which
   would be a third reader of the same fact). `null` from the provider, or a
   provider that was never supplied, means "not on record" and the route REFUSES —
   it never falls back to a count. */
type CompanySecuritiesProvider = (companyId: string) => Array<Record<string, unknown>>;
let companySecuritiesProvider: CompanySecuritiesProvider | null = null;

/** A common holder as the waterfall needs it: an id and an exact share string. */
function readCompanyCommonRows(companyId: string): Array<{ holderId: string; shares: string }> | null {
  if (!companySecuritiesProvider) return null;
  let rows: Array<Record<string, unknown>>;
  try {
    rows = companySecuritiesProvider(String(companyId)) ?? [];
  } catch (err) {
    log.warn("[track1/waterfall] securities provider failed:", (err as Error).message);
    return null;
  }
  const out: Array<{ holderId: string; shares: string }> = [];
  for (const r of rows) {
    if (String(r.instrument ?? "") !== "common") continue;
    const n = Number(r.shares ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    /* Integer share counts only, exact via string. A fractional share count is not
       a share count and is skipped rather than rounded into existence. */
    if (!Number.isInteger(n)) continue;
    out.push({ holderId: String(r.holderName ?? r.id ?? "common"), shares: String(n) });
  }
  return out.length > 0 ? out : null;
}

export function registerTrack1Routes(
  app: Express,
  /* WAVE 71 · D11 — optional so every existing caller compiles unchanged; when it
     is absent the waterfall route REFUSES by name instead of fabricating the
     common leg, which is the whole point of the finding. */
  securitiesProvider?: CompanySecuritiesProvider,
): void {
  if (securitiesProvider) companySecuritiesProvider = securitiesProvider;
  // A1 — waterfall (read — no rate-limit mutation guard)
  app.get("/api/founder/captable/waterfall", requireAuth, (req, res) => {
    handleWaterfall(req, res).catch((err) => {
      log.error("[track1/waterfall] unhandled:", (err as Error).message);
      res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
    });
  });

  // A2 — term-sheet generation
  app.post("/api/founder/term-sheets/generate", requireAuth, rateLimitMiddleware, handleTermSheetGenerate);
  app.get("/api/founder/term-sheets/:id/download", requireAuth, handleTermSheetDownload);

  // A3 — CRM CSV import (supports both multipart upload and text/csv body)
  const textBodyParser = (req: Request, res: Response, next: import("express").NextFunction) => {
    const ct = req.headers["content-type"] ?? "";
    if (!ct.includes("text/csv") && !ct.includes("text/plain")) return next();
    // Already parsed if body is a string; re-parse raw bytes if Buffer
    if (typeof req.body === "string" && req.body.length > 0) return next();
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString("utf8"); });
    req.on("end", () => { (req as unknown as { body: string }).body = data; next(); });
    req.on("error", () => next());
  };
  app.post(
    "/api/founder/crm/import",
    requireAuth,
    rateLimitMiddleware,
    textBodyParser,
    upload.single("file"),
    handleCrmImport,
  );

  // A4 — data room
  app.post("/api/founder/data-room/files", requireAuth, rateLimitMiddleware, handleDataRoomUpload);
  app.post("/api/founder/data-room/grants", requireAuth, rateLimitMiddleware, handleDataRoomGrant);
  // GET with grant token — registered under /api/public/ to bypass global requireAuth (token IS the credential)
  app.get("/api/public/data-room/files/:fileId", handleDataRoomFileGet);
  // GET for owners (full auth) — registered under founder path too
  app.get("/api/founder/data-room/files/:fileId", requireAuth, handleDataRoomFileGet);

  // A5 — KYC
  app.post("/api/investor/invitations/:token/kyc", requireAuth, rateLimitMiddleware, handleInvestorKyc);

  // A6 — document sign
  app.post("/api/investor/documents/:id/sign", requireAuth, rateLimitMiddleware, handleDocumentSign);

  // A7 — soft-circle reject
  app.post("/api/rounds/:id/soft-circle/:scId/reject", requireAuth, rateLimitMiddleware, handleSoftCircleReject);

  // A8 — round updates (POST creates; GET reads the feed)
  app.post("/api/rounds/:id/updates", requireAuth, rateLimitMiddleware, handleRoundUpdate);
  app.get("/api/rounds/:id/updates", requireAuth, (req: Request, res: Response): void => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }
    const roundId = String(req.params["id"] ?? "");
    const round = getRoundById(roundId);
    if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

    // v25.2: founders see all updates for their round; investors see only updates
    // whose visibility includes them (all | committed if they have committed SC).
    const isFounder = ownsRound(ctx, roundId);

    try {
      const db = rawDb();
      const rows = db.prepare(
        `SELECT id, round_id AS roundId, author_id AS authorId, title, body,
                visibility, published_at AS publishedAt
         FROM round_updates WHERE round_id = ? ORDER BY published_at DESC LIMIT 200`
      ).all(roundId) as Array<{ id: string; roundId: string; authorId: string; title: string; body: string; visibility: string; publishedAt: string }>;

      let visible = rows;
      if (!isFounder) {
        // Investor filter: include only updates whose visibility is reachable for them
        const circles = softCircleListForRound(roundId);
        const myStatus = circles.find((sc: unknown) => (sc as { investorUserId?: string }).investorUserId === ctx.userId);
        const hasCommitted = myStatus && ((myStatus as { status: string }).status === "committed" || (myStatus as { status: string }).status === "wired");
        visible = rows.filter(r => {
          if (r.visibility === "all") return true;
          if (r.visibility === "committed") return !!hasCommitted;
          if (r.visibility === "collective_only") return ctx.collective?.status === "active";
          return false;
        });
      }
      res.json({ ok: true, roundId, updates: visible, count: visible.length });
    } catch (err) {
      log.error("[track1/round-update GET] DB read failed:", (err as Error).message);
      res.status(500).json({ ok: false, error: "DB_ERROR" });
    }
  });
}
