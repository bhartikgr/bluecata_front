/**
 * WAVE 179 · ITEM C · R151.2 — READ-ONLY CSV EXPORTS FOR A PARTNER'S OWN DATA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT WAS MISSING
 * ════════════════════════════════════════════════════════════════════════════
 * Wave 179's preflight established that exactly ONE export existed anywhere on the
 * partner surface — the Invoices CSV built client-side in `PartnerBilling.tsx` — and
 * that `/api/partner/**` contained no export or PDF route at all. A GP could see
 * their LP roster, their fee history and their CRM contacts on screen and could not
 * get any of it out. This module is the smallest correct answer to that: three GET
 * routes, no writes, no new figures.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE RULE THAT SHAPED EVERY LINE: THE EXPORT MUST NOT DISAGREE WITH THE SCREEN
 * ════════════════════════════════════════════════════════════════════════════
 * R151.2 states that an export which disagrees with the screen is worse than no
 * export. This module therefore DERIVES NOTHING. Each route calls the SAME
 * function the on-screen surface's own endpoint calls:
 *
 *   LP roster   → `buildPartnerLpRosterPayload` (server/spvEngineRoutes.ts), which is
 *                 literally the body of `GET /api/partner/me/spv/:spvId/lp-roster`,
 *                 lifted so that both callers share one computation.
 *   Fee history → `spvEngineStore.listFees`, the same call behind
 *                 `GET /api/partner/me/spv/:spvId/fees` and the Fees card.
 *   CRM contacts→ `listContacts` (server/partnerWorkspaceV19Store.ts), the same call
 *                 behind `GET /api/partner/me/crm/contacts` and PartnerContacts.tsx.
 *
 * There is no second query, no aggregate, and no total anywhere in this file. Every
 * cell is a value the corresponding screen already shows.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * MONEY
 * ════════════════════════════════════════════════════════════════════════════
 * Amounts are converted from minor units to a major-unit STRING by string surgery
 * on a `bigint`, in `minorToMajorCsvCell` below. No `Number()`, `parseInt`,
 * `parseFloat` or division touches an amount on this path, so nothing can be
 * misplaced by a factor of a hundred for a zero-exponent currency such as JPY, and
 * nothing can lose precision above `MAX_SAFE_INTEGER`.
 *
 * A CELL NEVER SAYS ZERO WHEN IT MEANS "WE DO NOT KNOW". Where a figure is not
 * derivable — an invited LP who has not committed has no commitment amount, and a
 * fee row can carry a null amount — the cell reads `Not derivable`, the platform's
 * existing convention (`client/src/components/partner/SpvK1Panel.tsx`). It never
 * emits `0`, and never emits a blank that a spreadsheet would sum as zero.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CURRENCY (R149.4)
 * ════════════════════════════════════════════════════════════════════════════
 * EVERY row carrying an amount also carries its own currency column, and NO route
 * in this file emits a total row of any kind. Two amounts in different currencies
 * are never added, because nothing here adds anything at all.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE FENCE
 * ════════════════════════════════════════════════════════════════════════════
 * The partner id comes from `req.partnerContext` — the SESSION — and never from the
 * URL or the query string. The SPV routes then resolve the vehicle through
 * `spvEngineStore.getSpv(partnerId, spvId)`, which returns null for a vehicle
 * belonging to any other partner, so a cross-partner request is a 404 with no
 * existence leak and no rows. The CRM route passes the session partner id straight
 * into the store's own partner-scoped query, so it can only ever return the
 * caller's own contacts. Negative controls in both directions are asserted in
 * `server/__tests__/w179_itemC_partner_exports.test.ts`.
 */
import type { Express, Request, Response } from "express";
import { requirePartnerAuth } from "./lib/requirePartnerAuth";
import { spvEngineStore } from "./spvEngineStore";
/* The ONE roster computation, shared with the JSON route the screen reads. */
import { buildPartnerLpRosterPayload } from "./spvEngineRoutes";
import { listCrmContactsForPartner } from "./partnerWorkspaceV19Store";
import { currencyExponent } from "./lib/currency";

/** The platform's existing spelling of "this figure is not derivable". */
const NOT_DERIVABLE_CELL = "Not derivable";

/**
 * RFC 4180 escaping, matching the one existing export on the partner surface
 * (`PartnerBilling.tsx`): every field is quoted, and an embedded quote is doubled.
 * Quoting unconditionally is deliberate — a contact's company name containing a
 * comma must not shift every column to its right.
 */
function csvCell(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

/** One CSV line. CRLF is applied by the caller when the file is assembled. */
function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * MINOR UNITS → A MAJOR-UNIT STRING, EXACTLY, WITHOUT FLOATING POINT.
 *
 * The whole and fractional halves are cut out of the `bigint`'s DECIMAL DIGITS with
 * `toString()` and `padStart`, so the result is exact for any magnitude and for any
 * ISO-4217 exponent. JPY (exponent 0) yields "12345" and never "123.45"; USD
 * (exponent 2) yields "123.45".
 *
 * A null, undefined or non-integer input is NOT coerced to zero: it returns the
 * refusal cell, because "no amount is recorded" and "the amount is zero" are
 * different facts and a spreadsheet cannot tell them apart once one is printed as
 * the other.
 */
function minorToMajorCsvCell(minor: number | bigint | null | undefined, currency: string | null | undefined): string {
  if (minor === null || minor === undefined) return NOT_DERIVABLE_CELL;
  if (typeof minor === "number" && !Number.isInteger(minor)) return NOT_DERIVABLE_CELL;
  let asBig: bigint;
  try {
    /* `BigInt(number)` throws on a non-integer and never rounds; there is no
       arithmetic here, only a change of representation. */
    asBig = typeof minor === "bigint" ? minor : BigInt(minor);
  } catch {
    return NOT_DERIVABLE_CELL;
  }
  const exp = currencyExponent(currency ?? "");
  /* `BigInt(0)`, not `0n`: this project's `target` predates ES2020 bigint literals,
     and the same construction is used in the wave-178 money paths. */
  const zero = BigInt(0);
  const negative = asBig < zero;
  const digits = (negative ? zero - asBig : asBig).toString();
  const sign = negative ? "-" : "";
  if (exp <= 0) return `${sign}${digits}`;
  const padded = digits.padStart(exp + 1, "0");
  return `${sign}${padded.slice(0, padded.length - exp)}.${padded.slice(padded.length - exp)}`;
}

/**
 * A FRACTION → A PERCENTAGE CELL.
 *
 * Ownership arrives as a fraction (0.25 = 25%), exactly as the roster screen
 * receives it, and is multiplied by 100 at this render boundary and nowhere else —
 * the same rule `SpvK1Panel.tsx` states for the K-1 surface. This is a percentage,
 * not money: it is a ratio the server already computed, and no monetary precision
 * depends on it. `null` means the row has no confirmed-capital share (it is not
 * committed capital), which is NOT a share of zero, so it refuses.
 */
function pctCell(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return NOT_DERIVABLE_CELL;
  return (fraction * 100).toFixed(2);
}

/** Send an assembled CSV as a download. CRLF line endings, as the one existing export uses. */
function sendCsv(res: Response, filename: string, lines: string[]): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\r\n") + "\r\n");
}

export const PARTNER_EXPORT_LP_ROSTER_HEADER = [
  "Row type",
  "Name",
  "Email",
  "Commitment",
  "Currency",
  "Stage",
  "Ownership % of all stages",
  "Ownership % of confirmed capital",
] as const;

export const PARTNER_EXPORT_FEES_HEADER = [
  "Fee ID",
  "Layer",
  "Fee type",
  "Carry %",
  "Fixed amount",
  "Currency",
  "Effective date",
  "Set by",
] as const;

export const PARTNER_EXPORT_CONTACTS_HEADER = [
  "Contact ID",
  "Name",
  "Email",
  "Organisation",
  "Stage",
  "Tags",
  "Starred",
  "Created at",
] as const;

export function registerPartnerExportRoutes(app: Express): void {
  /* ═══ 1 · LP ROSTER / CAP TABLE FOR ONE SPV ═══════════════════════════════
     R151.2's first priority. Rows are the roster's OWN rows, in the roster's own
     order: every subscriber, then every unseated invite, exactly as the screen
     lists them.

     AN INVITE HAS NO COMMITMENT AND NO OWNERSHIP, and those cells say so rather
     than reading 0 — the screen renders an em dash there for the same reason. An
     invited person is not a limited partner holding nothing; they are a person who
     has not subscribed, and a spreadsheet that sums a column of zeros for them
     would understate nothing but would still assert something false about each. */
  app.get(
    "/api/partner/me/spv/:spvId/lp-roster.csv",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const spvId = String(req.params.spvId);
      /* THE FENCE. Partner id from the session; `getSpv` is partner-scoped and
         returns null for another partner's vehicle. */
      const spv = spvEngineStore.getSpv(ctx.partnerId, spvId);
      if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
      const payload = buildPartnerLpRosterPayload(ctx.partnerId, spvId, spv);
      const currency = spv.currency;
      const lines = [csvRow([...PARTNER_EXPORT_LP_ROSTER_HEADER])];
      for (const s of payload.subscribers) {
        lines.push(
          csvRow([
            "Subscriber",
            s.name ?? "",
            s.email ?? "",
            minorToMajorCsvCell(s.commitmentMinor, currency),
            currency,
            s.stageLabel ?? s.status,
            pctCell(s.ownershipPctOfAllStages),
            /* null for a row that is not confirmed capital — refuses, never 0. */
            pctCell(s.ownershipPctOfConfirmedCapital),
          ]),
        );
      }
      for (const i of payload.invites) {
        lines.push(
          csvRow([
            "Invited",
            [i.firstName, i.lastName].filter(Boolean).join(" "),
            i.email ?? "",
            NOT_DERIVABLE_CELL,
            currency,
            i.status,
            NOT_DERIVABLE_CELL,
            NOT_DERIVABLE_CELL,
          ]),
        );
      }
      sendCsv(res, `lp-roster-${spvId}.csv`, lines);
    },
  );

  /* ═══ 2 · FEE HISTORY FOR ONE SPV ═════════════════════════════════════════
     The same `listFees` rows the Fees card renders, in the same order. `rate` and
     `amountMinor` are BOTH carried because a fee is recorded as one or the other:
     a percentage fee has no amount until it is charged, and printing 0 in its
     amount column would assert that nothing is payable. */
  app.get(
    "/api/partner/me/spv/:spvId/fees.csv",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const spvId = String(req.params.spvId);
      const spv = spvEngineStore.getSpv(ctx.partnerId, spvId);
      if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
      const fees = spvEngineStore.listFees(ctx.partnerId, spvId);
      const lines = [csvRow([...PARTNER_EXPORT_FEES_HEADER])];
      for (const f of fees) {
        lines.push(
          csvRow([
            f.id,
            f.layer,
            f.feeType,
            /* A CARRY FEE HAS NO FIXED AMOUNT AND A FIXED FEE HAS NO CARRY %, so each
               column refuses on the rows where its figure genuinely does not exist.
               The card on screen makes the same distinction by omitting the part that
               is null rather than printing a zero for it. The carry fraction is
               multiplied by 100 at this boundary only, exactly as the card does. */
            pctCell(f.carryPct),
            minorToMajorCsvCell(f.fixedAmountMinor, f.currency),
            f.currency,
            f.effectiveDate,
            f.setBy ?? "",
          ]),
        );
      }
      sendCsv(res, `spv-fees-${spvId}.csv`, lines);
    },
  );

  /* ═══ 3 · CRM CONTACTS ════════════════════════════════════════════════════
     The firm's OWN Layer-1 CRM contacts, from the same partner-scoped store query
     the contacts screen reads. No amounts, so no currency column: there is nothing
     monetary on a contact row to state a currency for. */
  app.get(
    "/api/partner/me/crm/contacts.csv",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      /* THE FENCE. The store's query is partner-scoped and the id is the session's.
         This is the SAME function `GET /api/partner/me/crm/contacts` now calls, so
         the exported rows are the screen's rows and cannot drift from them. */
      const contacts = listCrmContactsForPartner(ctx.partnerId);
      /* THE SCREEN'S ORDER, so a GP reading the file down the page sees what the
         page showed: `GET /api/partner/me/crm/contacts` applies exactly this sort
         after the same read. */
      contacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const lines = [csvRow([...PARTNER_EXPORT_CONTACTS_HEADER])];
      for (const c of contacts) {
        lines.push(
          csvRow([
            c.id,
            c.name,
            c.email ?? "",
            c.org ?? "",
            c.stage ?? "",
            (c.tags ?? []).join("; "),
            c.starred ? "yes" : "no",
            c.createdAt,
          ]),
        );
      }
      sendCsv(res, "crm-contacts.csv", lines);
    },
  );
}
