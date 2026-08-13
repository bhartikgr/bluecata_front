/**
 * v25.0 Track 3 — Consortium Partner Endpoints (C1–C5) + Subrole Enforcement (C6).
 *
 * NEW endpoints:
 *   C1  GET /api/partner/me/pnl
 *   C2  GET /api/partner/me/billing
 *   C3  GET /api/partner/me/clients     (replaces stub — now DB-backed)
 *   C4  GET /api/partner/me/portfolio
 *   C5  POST /api/partner/me/funds/:fundId/activate
 *       GET  /api/partner/me/funds      (augmented with activeFundId marker)
 *
 * Admin seeding helpers:
 *   POST /api/partner/me/clients/seed          (test: source an investor)
 *   POST /api/partner/me/portfolio/seed        (test: source a company)
 *
 * Subrole gates enforced on new and existing write endpoints.
 *
 * Commission rates (industry-standard angel-network economics):
 *   catalyst       2%
 *   builder        3%
 *   amplifier      4%
 *   nexus          5%
 *   founding_member 6%
 *
 * All money: integer minor units (no floating point). Commission floored.
 */
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Express, Request, Response } from "express";
import { requirePartnerAuth, requirePartnerSubrole } from "./lib/requirePartnerAuth";
import {
  addToBucket,
  bucketsToArray,
  scaleBuckets,
  singleCurrencyScalar,
  scaleScalar,
  type CurrencyBuckets,
  type MoneyScalar,
} from "./lib/currencyScalar";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import { getUserContext } from "./lib/userContext";
import { getCompanyRecordById } from "./multiCompanyStore";
import { rawDb } from "./db/connection";
import { partnerAttributionStore, partnerFundsStore } from "./partnerWorkspaceStore";
import { assertLock1CoWrite } from "./lib/lock1Provenance";
import { fromMinor } from "./lib/money";
import type { PartnerTier } from "./adminContactsStoreShim";
/* v25.41 Q1 (Avi authorized = A): DB-driven per-tier commission rate resolver.
   ADDITIVE import only — Avi's COMMISSION_RATE literal table below stays
   byte-identical and remains the ultimate fallback. */
import { getCommissionRate as resolveCommissionRateFromDb } from "./lib/partnerCommissionRateResolver";

/* ============================================================
 * Commission rate table (industry standard angel-network economics)
 * All rates stored as a fraction (e.g. 0.02 = 2%).
 * ============================================================ */
const COMMISSION_RATE: Record<PartnerTier, number> = {
  catalyst:       0.02,
  builder:        0.03,
  amplifier:      0.04,
  nexus:          0.05,
  founding_member: 0.06,
};

function commissionPct(tier: PartnerTier): number {
  // v25.41 Q1 (Avi authorized): DB-driven via partnerCommissionRateResolver wins
  // when present; the literal table above is the byte-identical fallback. This
  // is the single commission-rate helper used by BOTH the P&L summary path and
  // the partner_billing_entries ledger-insert path (commissionForLedgerInsert),
  // so wrapping it here makes both DB-driven per Avi's unifying directive.
  try {
    const resolved = resolveCommissionRateFromDb(tier);
    if (typeof resolved?.rate === "number" && resolved.source === "db") return resolved.rate;
  } catch { /* fall through to literal */ }
  return COMMISSION_RATE[tier] ?? 0.02;
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/* ============================================================
 * Registration
 * ============================================================ */
export function registerPartnerConsortiumRoutes(app: Express): void {

  /* ==========================================================
   * C1 — GET /api/partner/me/pnl
   *
   * Aggregates P&L from soft_circles where source_type='partner'
   * and source_id = partner.id. Joins with partner tier for commission.
   * Auth: managing_partner, associate, bd only.
   * ========================================================== */
  app.get(
    "/api/partner/me/pnl",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner", "associate", "bd"]),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const pid  = ctx.partnerId;
      const tier = ctx.tier as PartnerTier;
      const pct  = commissionPct(tier);

      try {
        const db = rawDb();

        // All soft_circles sourced by this partner
        const rows = db.prepare(`
          SELECT
            sc.id,
            sc.company_id,
            sc.round_id,
            sc.amount_minor,
            sc.currency,
            sc.status,
            sc.created_at,
            sc.updated_at
          FROM soft_circles sc
          WHERE sc.source_type = 'partner'
            AND sc.source_id   = ?
            AND sc.deleted_at IS NULL
        `).all(pid) as Array<{
          id: string;
          company_id: string | null;
          round_id: string;
          amount_minor: number;
          currency: string;
          status: string;
          created_at: string;
          updated_at: string | null;
        }>;

        const totalDealsSourced    = rows.length;

        /* ============================================================
         * WAVE 21 · ITEM 2 site 1 (REVIEW A CRITICAL, was :135-178 / :211-223)
         *
         * WAS: this loop built `currencyMap` correctly and THEN also did
         *   `totalCommittedMinor += r.amount_minor`
         *   `totalFundedMinor    += r.amount_minor`
         *   `monthMap[m].committedMinor += r.amount_minor`
         *   `tierEntry.committedMinor   += r.amount_minor`
         * across every currency, and line 178 computed
         *   `commissionEarnedMinor = Math.floor(totalFundedMinor * pct)`
         * from that mixed sum. A partner with JPY and USD soft-circles got a
         * headline number and a commission figure that denominate nothing.
         *
         * NOW: EVERY accumulator is a per-currency bucket map. The scalar
         * fields are still emitted (clients depend on the keys) but they are
         * `MoneyScalar`s: a real amount only when exactly one currency is
         * present, otherwise `available:false, reason:"needs_fx_conversion"`
         * with `currency:null, minor:null`. Commission is computed PER
         * CURRENCY (`commissionByCurrency`) and the scalar commission is
         * derived from the scalar funded total, so it is unavailable exactly
         * when its input is. No FX rate is invented — none exists here.
         * ============================================================ */
        const committedBuckets: CurrencyBuckets = {};
        const fundedBuckets: CurrencyBuckets = {};
        const monthMap: Record<string, {
          dealsSourced: number;
          committed: CurrencyBuckets;
          funded: CurrencyBuckets;
        }> = {};
        let tierDealsSourced = 0;
        const currenciesSeen = new Set<string>();

        for (const r of rows) {
          const committed = ["confirmed", "committed", "funded"].includes(r.status);
          const funded    = r.status === "funded";
          const cur       = (r.currency || "USD").toUpperCase();
          currenciesSeen.add(cur);

          if (committed) addToBucket(committedBuckets, cur, r.amount_minor);
          if (funded)    addToBucket(fundedBuckets,    cur, r.amount_minor);

          // Month bucket — per-currency, never merged.
          const month = (r.created_at ?? "").slice(0, 7); // "YYYY-MM"
          if (!monthMap[month]) monthMap[month] = { dealsSourced: 0, committed: {}, funded: {} };
          monthMap[month].dealsSourced += 1;
          if (committed) addToBucket(monthMap[month].committed, cur, r.amount_minor);
          if (funded)    addToBucket(monthMap[month].funded,    cur, r.amount_minor);

          tierDealsSourced += 1;
        }

        // Scalars: real only when a single currency is involved.
        const totalCommitted: MoneyScalar = singleCurrencyScalar(committedBuckets, "USD");
        const totalFunded: MoneyScalar    = singleCurrencyScalar(fundedBuckets, "USD");
        // Commission PER CURRENCY — pct is a dimensionless fraction, so it may
        // be applied inside each currency independently. The scalar form is
        // derived from the scalar funded total and inherits its availability.
        const commissionBuckets = scaleBuckets(fundedBuckets, pct);
        const commissionEarned: MoneyScalar = scaleScalar(totalFunded, pct);

        const totalCommittedMinor = totalCommitted.available ? totalCommitted.minor : null;
        const totalFundedMinor    = totalFunded.available    ? totalFunded.minor    : null;
        const commissionEarnedMinor = commissionEarned.available ? commissionEarned.minor : null;

        const tierEntry = {
          tier,
          commissionPct: pct * 100,
          dealsSourced: tierDealsSourced,
          // Scalars are null when mixed; the per-currency arrays are always authoritative.
          committedMinor: totalCommittedMinor,
          fundedMinor: totalFundedMinor,
          commissionMinor: commissionEarnedMinor,
          committedByCurrency: bucketsToArray(committedBuckets),
          fundedByCurrency: bucketsToArray(fundedBuckets),
          commissionByCurrency: bucketsToArray(commissionBuckets),
        };

        // Payout pending = unpaid billing entries
        let payoutPendingMinor = 0;
        try {
          /* v25.33 — filter to referral commissions only.
           * partner_billing_entries is now a multi-purpose table that also holds
           * SPV deployment fees (entry_kind='spv_deployment_fee') and other
           * partner-OWED fees. Those must NOT be summed into payoutPendingMinor
           * (which represents money OWED TO the partner). COALESCE handles legacy
           * rows that predate the entry_kind column.
           */
          const pending = db.prepare(`
            SELECT COALESCE(SUM(commission_minor), 0) AS total
            FROM partner_billing_entries
            WHERE partner_id = ? AND status = 'pending'
            AND COALESCE(entry_kind, 'referral_commission') = 'referral_commission'
          `).get(pid) as { total: number };
          payoutPendingMinor = pending.total ?? 0;
        } catch { /* table may not exist yet on fresh DB */ }

        /* WAVE 21 · ITEM 2 — each month carries per-currency arrays plus
           null-when-mixed scalars. A month whose deals are all USD still gets
           a usable scalar; a mixed month reports unavailable rather than a sum. */
        const byMonth = Object.entries(monthMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, v]) => {
            const c = singleCurrencyScalar(v.committed, "USD");
            const f = singleCurrencyScalar(v.funded, "USD");
            return {
              month,
              dealsSourced: v.dealsSourced,
              committedMinor: c.available ? c.minor : null,
              fundedMinor: f.available ? f.minor : null,
              committedByCurrency: bucketsToArray(v.committed),
              fundedByCurrency: bucketsToArray(v.funded),
              currency: c.available ? c.currency : null,
              currencyUnavailableReason: c.available ? null : c.reason,
            };
          });

        /* v25.16 NM1 — per-currency rollup. WAVE 21: this is now the
           AUTHORITATIVE shape; the scalars above are convenience only. */
        const currencyKeys = Array.from(
          new Set([...Object.keys(committedBuckets), ...Object.keys(fundedBuckets)]),
        ).sort();
        const byCurrency = currencyKeys.map((currency) => ({
          currency,
          committedMinor: committedBuckets[currency] ?? 0,
          fundedMinor: fundedBuckets[currency] ?? 0,
          commissionMinor: commissionBuckets[currency] ?? 0,
        }));
        const currencies = Array.from(currenciesSeen).sort();

        res.json({
          totalDealsSourced,
          // Scalars: number when single-currency, null when mixed. NEVER a
          // cross-currency sum, and never labelled with a currency that was
          // not the source currency.
          totalCommittedMinor,
          totalFundedMinor,
          commissionEarnedMinor,
          payoutPendingMinor,
          /* Explicit, renderable unavailability. The client MUST branch on
             `available` and show the per-currency breakdown instead of a
             headline number when it is false. */
          totalCommitted,
          totalFunded,
          commissionEarned,
          totalsCurrency: totalCommitted.available ? totalCommitted.currency : null,
          totalsUnavailableReason: totalCommitted.available ? null : totalCommitted.reason,
          commissionPct: pct * 100,
          tier,
          byMonth,
          byTier: [tierEntry],
          byCurrency,
          currencies,
          mixedCurrencyWarning: currencies.length > 1,
        });
      } catch (err) {
        res.status(500).json({ error: "PNL_QUERY_FAILED", message: (err as Error).message });
      }
    },
  );

  /* ==========================================================
   * C2 — GET /api/partner/me/billing
   *
   * Lists billing entries for funded deals sourced by this partner.
   * Auto-populates billing_entries from soft_circles on read (idempotent).
   * Auth: managing_partner only (financial data).
   *
   * v25.32 P1g — TODO(avi-alignment): This endpoint surfaces COMMISSION /
   * payout billing (what the consortium owes the partner for funded deals),
   * NOT a partner-tier *subscription* charge (what a partner would pay to
   * Capavate for a seat). As of v25.32 there is no partner subscription
   * payment flow in the codebase — partners are not charged a subscription;
   * they earn commissions. The five-field read-only "subscription billing"
   * surface specified for founders/collective members (amount paid, plan,
   * payment date, period_end, status) has no partner equivalent because no
   * partner subscription is minted in capavate_subscriptions or invoices.
   * Per the v25.32 brief, NO new payment flow was invented here. If/when a
   * partner-tier subscription product is introduced, wire its read-only
   * billing onto the partner workspace (mirror CollectiveMembership.tsx) and
   * source it from capavate_subscriptions + invoices like the founder flow.
   * ========================================================== */
  app.get(
    "/api/partner/me/billing",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const pid  = ctx.partnerId;
      const tier = ctx.tier as PartnerTier;
      const pct  = commissionPct(tier);

      try {
        const db = rawDb();

        /* v25.12 NL-1 — the original implementation bootstrapped billing
         * entries on every GET without a transaction, allowing two
         * concurrent GETs from the same partner session to race the
         * INSERT OR IGNORE pair. We now wrap the catch-up upsert in a
         * single transaction so each (deal_ref) lands exactly once.
         * Long-term, this catch-up should be moved to the funded-event
         * webhook handler so GET stays side-effect-free; tracked. */
        const funded = db.prepare(`
          SELECT id, amount_minor, created_at
          FROM soft_circles
          WHERE source_type = 'partner'
            AND source_id   = ?
            AND status      = 'funded'
            AND deleted_at IS NULL
        `).all(pid) as Array<{ id: string; amount_minor: number; created_at: string }>;

        if (funded.length > 0) {
          const tx = db.transaction((rows: typeof funded) => {
            const insert = db.prepare(`
              INSERT OR IGNORE INTO partner_billing_entries
                (id, partner_id, deal_ref, amount_funded_minor, tier_at_funding, commission_pct, commission_minor, status, paid_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)
            `);
            for (const sc of rows) {
              insert.run(
                newId("pbe"),
                pid,
                sc.id,
                sc.amount_minor,
                tier,
                pct,
                Math.floor(sc.amount_minor * pct),
                sc.created_at,
              );
            }
          });
          try { tx(funded); } catch { /* concurrent GET handled idempotently */ }
        }

        /* v25.32 final — join in `soft_circles.currency` so the UI no longer
         * hardcodes USD when partner deals are multi-currency. The source
         * row already has currency; partner_billing_entries doesn't replicate
         * it, so we LEFT JOIN at read time. Falls back to 'USD' only if the
         * source row is missing currency (legacy data). */
        const entries = db.prepare(`
          SELECT
            pbe.id,
            pbe.deal_ref      AS dealId,
            pbe.created_at    AS date,
            pbe.amount_funded_minor AS amountFundedMinor,
            pbe.tier_at_funding AS tier,
            pbe.commission_pct  AS commissionPct,
            pbe.commission_minor AS commissionMinor,
            pbe.status,
            pbe.paid_at         AS paidAt,
            COALESCE(sc.currency, 'USD') AS currency
          FROM partner_billing_entries pbe
          LEFT JOIN soft_circles sc ON sc.id = pbe.deal_ref
          WHERE pbe.partner_id = ?
            /* v25.33 final — isolate referral commissions from the new
             * SPV/subscription/closing-bonus entries introduced by the
             * Consortium Partner Payment Model. Without this filter, the
             * new entry_kinds (spv_deployment, spv_management, etc.)
             * would leak into the referral table and display with wrong
             * tier/commission_pct semantics. The other streams have
             * dedicated endpoints in partnerSelfServiceRoutes.ts.
             *
             * COALESCE handles legacy rows that predate the entry_kind
             * column (default in DDL is 'referral_commission' but defensive
             * here for fresh-deploy and migrated-data edge cases). */
            AND COALESCE(pbe.entry_kind, 'referral_commission') = 'referral_commission'
          ORDER BY pbe.created_at DESC
        `).all(pid) as Array<{
          id: string;
          dealId: string;
          date: string;
          amountFundedMinor: number;
          tier: string;
          commissionPct: number;
          commissionMinor: number;
          status: "pending" | "paid";
          paidAt: string | null;
          currency: string;
        }>;

        // Totals by status
        const totalsByStatus: Record<string, number> = {};
        for (const e of entries) {
          totalsByStatus[e.status] = (totalsByStatus[e.status] ?? 0) + e.commissionMinor;
        }

        res.json({ entries, totalsByStatus });
      } catch (err) {
        res.status(500).json({ error: "BILLING_QUERY_FAILED", message: (err as Error).message });
      }
    },
  );

  /* ==========================================================
   * C3 — GET /api/partner/me/sourced-investors
   *
   * Lists investors sourced by this partner via partner_sourced_investors.
   * Auth: managing_partner, associate, bd.
   *
   * v25.14 NC2 — was previously registered at /api/partner/me/clients,
   * which shadowed the partnerRoutes.ts attribution handler. The two
   * routes return different data (sourced investors vs attribution-based
   * clients) and the client UI reads `data.clients`, which was always
   * empty because this route returned `{ investors: [...] }`. Renamed to
   * a non-colliding path so both data surfaces are reachable.
   * ========================================================== */
  app.get(
    "/api/partner/me/sourced-investors",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner", "associate", "bd"]),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const pid  = ctx.partnerId;

      try {
        const db = rawDb();

        // Join sourced investors with soft_circles to get commitment stats
        const sourced = db.prepare(`
          SELECT
            psi.investor_id AS id,
            psi.sourced_at  AS sourcedAt,
            psi.status,
            COALESCE(uc.email, psi.investor_id) AS email,
            COALESCE(uc.name,  psi.investor_id) AS name,
            COALESCE(SUM(CASE WHEN sc.status IN ('confirmed','committed','funded') THEN sc.amount_minor ELSE 0 END), 0) AS totalCommittedMinor,
            COALESCE(SUM(CASE WHEN sc.status = 'funded' THEN sc.amount_minor ELSE 0 END), 0) AS totalFundedMinor
          FROM partner_sourced_investors psi
          LEFT JOIN user_credentials uc ON uc.user_id = psi.investor_id
          LEFT JOIN soft_circles sc
            ON sc.investor_user_id = psi.investor_id
            AND sc.deleted_at IS NULL
          WHERE psi.partner_id = ?
          GROUP BY psi.investor_id, psi.sourced_at, psi.status
          ORDER BY psi.sourced_at DESC
        `).all(pid) as Array<{
          id: string;
          sourcedAt: string;
          status: string;
          email: string;
          name: string;
          totalCommittedMinor: number;
          totalFundedMinor: number;
        }>;

        res.json({ investors: sourced });
      } catch (err) {
        res.status(500).json({ error: "CLIENTS_QUERY_FAILED", message: (err as Error).message });
      }
    },
  );

  /* ==========================================================
   * POST /api/partner/me/sourced-investors
   *
   * Admin/test helper: record that this partner sourced an investor.
   * Auth: managing_partner only.
   * v25.14 NC2 — renamed from /api/partner/me/clients/source for parity
   * with the GET above; old path kept as deprecated alias below.
   * ========================================================== */
  app.post(
    "/api/partner/me/sourced-investors",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const pid  = ctx.partnerId;
      const { investorId } = req.body ?? {};
      if (!isString(investorId)) return res.status(400).json({ error: "BAD_REQUEST", message: "investorId required" });

      try {
        const db  = rawDb();
        const now = new Date().toISOString();
        const id  = newId("psi");
        db.prepare(`
          INSERT OR IGNORE INTO partner_sourced_investors (id, partner_id, investor_id, sourced_at, status)
          VALUES (?, ?, ?, ?, 'active')
        `).run(id, pid, investorId, now);
        res.status(201).json({ ok: true, investorId, sourcedAt: now });
      } catch (err) {
        res.status(500).json({ error: "SOURCE_FAILED", message: (err as Error).message });
      }
    },
  );

  /* ==========================================================
   * C4 — GET /api/partner/me/sourced-founders
   *   (v25.52 Track 2.6 / BUG P-1 fix — path moved off
   *    /api/partner/me/portfolio)
   *
   * Lists companies sourced by this partner via partner_sourced_founders.
   * Auth: any partner subrole except viewer. Returns { founders: [...] }.
   *
   * PRIOR BUG (P-1): this handler was registered at
   * "/api/partner/me/portfolio" and, because registerPartnerConsortiumRoutes()
   * runs BEFORE registerPartnerRoutes() in server/routes.ts (793 vs 801), it
   * SHADOWED the Private Portfolio LIST handler in server/partnerRoutes.ts
   * (which returns { portfolio: [...] } from partner_portfolio_company). On
   * live, a partner's Private Portfolio list therefore rendered BLANK even
   * though data was saved (the detail endpoint /portfolio/:companyId, owned by
   * partnerRoutes, still worked — hence the confusing symptom). The two
   * features are DISTINCT (sourced-founders vs private-portfolio profiles) and
   * only ever collided on the shared path. Moving this C4 list to its own
   * "/api/partner/me/sourced-founders" path un-shadows the Private Portfolio
   * list WITHOUT dropping either feature (Rule #78). No client consumed this
   * C4 list route (grep: only PartnerPortfolioProfileDialog.tsx uses
   * /portfolio + /portfolio/:companyId, which are the Private Portfolio
   * endpoints); the POST /api/partner/me/portfolio/source helper is unchanged
   * and still lives under partnerRoutes' /portfolio/:companyId sibling space
   * without colliding (it is a POST, not the GET list).
   * ========================================================== */
  app.get(
    "/api/partner/me/sourced-founders",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner", "associate", "bd", "analyst"]),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const pid  = ctx.partnerId;

      try {
        const db = rawDb();

        const companies = db.prepare(`
          SELECT
            psf.company_id    AS companyId,
            psf.sourced_at    AS sourcedAt,
            psf.status,
            COALESCE(c.display_name, c.legal_name, psf.company_id) AS companyName,
            COALESCE(
              (SELECT MAX(sc.updated_at)
               FROM soft_circles sc
               WHERE sc.company_id = psf.company_id
                 AND sc.deleted_at IS NULL), psf.sourced_at
            ) AS lastActivityAt,
            COALESCE(
              (SELECT SUM(sc.amount_minor)
               FROM soft_circles sc
               WHERE sc.company_id = psf.company_id
                 AND sc.source_type = 'partner'
                 AND sc.source_id   = psf.partner_id
                 AND sc.deleted_at IS NULL), 0
            ) AS totalSourcedRaiseMinor
          FROM partner_sourced_founders psf
          LEFT JOIN contacts c ON c.id = psf.company_id
          WHERE psf.partner_id = ?
          ORDER BY psf.sourced_at DESC
        `).all(pid) as Array<{
          companyId: string;
          sourcedAt: string;
          status: string;
          companyName: string;
          lastActivityAt: string;
          totalSourcedRaiseMinor: number;
        }>;

        res.json({ founders: companies });
      } catch (err) {
        res.status(500).json({ error: "PORTFOLIO_QUERY_FAILED", message: (err as Error).message });
      }
    },
  );

  /* ==========================================================
   * POST /api/partner/me/portfolio/source
   *
   * Admin/test helper: record that this partner sourced a company.
   * Auth: managing_partner only.
   * ========================================================== */
  app.post(
    "/api/partner/me/portfolio/source",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const pid  = ctx.partnerId;
      const { companyId } = req.body ?? {};
      if (!isString(companyId)) return res.status(400).json({ error: "BAD_REQUEST", message: "companyId required" });

      try {
        const db  = rawDb();
        const now = new Date().toISOString();
        const id  = newId("psf");
        db.prepare(`
          INSERT OR IGNORE INTO partner_sourced_founders (id, partner_id, company_id, sourced_at, status)
          VALUES (?, ?, ?, ?, 'active')
        `).run(id, pid, companyId, now);
        res.status(201).json({ ok: true, companyId, sourcedAt: now });
      } catch (err) {
        res.status(500).json({ error: "SOURCE_FAILED", message: (err as Error).message });
      }
    },
  );

  /* ==========================================================
   * C5a — POST /api/partner/me/funds/:fundId/activate
   *
   * Switch the partner's active fund context. Persists active_fund_id
   * on the contacts row. Per-partner (not per-user), since partner_team_members
   * share one partner context. Auth: managing_partner only.
   * ========================================================== */
  app.post(
    "/api/partner/me/funds/:fundId/activate",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx    = req.partnerContext!;
      const pid    = ctx.partnerId;
      const fundId = String(req.params.fundId ?? "");

      if (!fundId) return res.status(400).json({ error: "BAD_REQUEST", message: "fundId required" });

      // Verify fund belongs to this partner
      const fund = partnerFundsStore.getById(pid, fundId);
      if (!fund) return res.status(404).json({ error: "FUND_NOT_FOUND" });

      try {
        const db = rawDb();
        db.prepare(`UPDATE contacts SET active_fund_id = ? WHERE id = ?`).run(fundId, pid);
        res.json({ ok: true, activeFundId: fundId, fund });
      } catch (err) {
        res.status(500).json({ error: "ACTIVATE_FUND_FAILED", message: (err as Error).message });
      }
    },
  );

  /* ==========================================================
   * C5b — GET /api/partner/me/funds  (augmented)
   *
   * Returns all funds for this partner with an `isActive` marker on
   * the currently-active fund (if one is set).
   * Auth: all partner subroles (open read).
   * ========================================================== */
  app.get(
    "/api/partner/me/funds/with-active",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const pid  = ctx.partnerId;

      try {
        const db = rawDb();

        // Read active_fund_id from contacts row
        const row = db.prepare(`SELECT active_fund_id FROM contacts WHERE id = ?`).get(pid) as
          | { active_fund_id: string | null }
          | undefined;
        const activeFundId = row?.active_fund_id ?? null;

        const funds = partnerFundsStore.listByPartner(pid).map((f) => ({
          ...f,
          isActive: f.id === activeFundId,
        }));

        res.json({ funds, activeFundId });
      } catch (err) {
        res.status(500).json({ error: "FUNDS_QUERY_FAILED", message: (err as Error).message });
      }
    },
  );

  /* ==========================================================
   * POST /api/partner/me/soft-circles/source
   *
   * Admin/test helper: create a synthetic funded soft_circle for billing/P&L
   * testing (source_type='partner', collective_visible=1).
   *
   * W1 H5 (v26.2.0) — SECURITY: this route USED to be exposed to any
   * managing_partner and validated only that amountMinor was a number, letting a
   * production partner mint synthetic FUNDED, collective-visible rows that pollute
   * funded totals / P&L and bypass the canonical commit path. It is now
   * ADMIN-ONLY with strict validation. No client/test consumes the old partner
   * behaviour, so this is a clean lock-down (no functionality legitimately lost).
   * The route path is unchanged for backward-compatible denial; non-admins get 403.
   * ========================================================== */
  const softCircleSourceSchema = z.object({
    partnerId: z.string().trim().min(1),
    amountMinor: z.number().int().positive().max(100_000_000_000),
    currency: z.enum(["USD", "CAD", "GBP", "EUR", "SGD"]),
    status: z.enum(["soft_circled", "confirmed", "committed", "funded"]),
    companyId: z.string().trim().min(1),
  }).strict();

  app.post(
    "/api/partner/me/soft-circles/source",
    (req: Request, res: Response) => {
      // Admin-only: authenticate + require platform admin BEFORE anything else.
      const uctx = getUserContext(req);
      if (!uctx?.isAuthed) return res.status(401).json({ error: "AUTH_REQUIRED" });
      if (!uctx.isAdmin) return res.status(403).json({ error: "ADMIN_REQUIRED" });

      const parsed = softCircleSourceSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "INVALID_SOFT_CIRCLE_SOURCE", issues: parsed.error.flatten() });
      }
      const { partnerId: pid, amountMinor, currency: cur, status: st, companyId: compId } = parsed.data;

      // Company must exist (minimum visibility proof) before minting a visible row.
      if (!getCompanyRecordById(compId)) {
        return res.status(404).json({ error: "COMPANY_NOT_VISIBLE" });
      }

      /* ── WAVE 33 · CP-PIPE-10 — LOCK 1 CO-WRITE ────────────────────────
         This is the ONLY writer of a partner-sourced soft circle in the tree,
         and until now it wrote `source_type='partner'` / `source_id=<pid>` and
         NEVER touched `sourced_from_partner_id` or
         `sourced_from_partner_attribution_id` — the two columns migration 0133
         created for exactly this purpose. 0132's own header states the rule:
         "LOCK 1 only imposes a CO-WRITE discipline on the APPLICATION LAYER for
         these pre-existing columns." Nothing enforced it, so the columns the
         lock governs were populated by nobody while the table, the index and
         the migration all existed. The single-write path looked built from
         every angle except the one that matters.

         The attribution is resolved from the durable store rather than accepted
         from the request body: a caller who could name their own attribution id
         could pair a partner with provenance they do not hold, which is the
         acquisition CP-PIPE-06 closes one table over. */
      const incumbentAttribution =
        partnerAttributionStore.listActiveByCompany(compId).find((a) => a.partnerId === pid) ?? null;
      const lock1 = assertLock1CoWrite({
        sourceType: "partner",
        sourcedFromPartnerId: pid,
        companyId: compId,
        attribution: incumbentAttribution
          ? {
              id: incumbentAttribution.id,
              partnerId: incumbentAttribution.partnerId,
              companyId: incumbentAttribution.companyId,
              revokedAt: incumbentAttribution.revokedAt ?? null,
            }
          : null,
      });
      if (!lock1.ok || !lock1.coWrite) {
        // Fail-closed BEFORE any row exists. A partner-sourced row without its
        // provenance pair is the state LOCK 1 exists to prevent, so it must not
        // be reachable even once.
        return res.status(409).json({ error: lock1.refusal ?? "LOCK1_REFUSED", message: lock1.copy });
      }

      /* ── WAVE 33B · CP-PIPE-10 — FK PRE-FLIGHT, FOUND BY EXECUTION ──────
         The co-write above was correct and DEAD. Both provenance columns carry
         foreign keys — `sourced_from_partner_id → partner_organizations(id)`
         and `sourced_from_partner_attribution_id → partner_attributions(id)`
         (`applyWaveC2ProvenanceColumnsSchema.ts:153`) — and `foreign_keys` is
         ON. `partner_organizations` is EMPTY: nothing in the server writes it
         (verified by grep, and by counting rows in the live `data.db`, the
         seeded test DB and the demo sandbox — all zero), because consortium
         partners are registered in `contacts`. So the very first attempt to
         honour LOCK 1 raised `FOREIGN KEY constraint failed` and the route
         answered 500. Writing NULL provenance never touched the FK, which is
         why the columns being unpopulated had hidden this for two migrations.

         This is the wave's lesson once more: the rule compiled, refused
         correctly, was reviewed, and could not write a single row. Nothing
         short of executing it could show that — no source assertion can see
         what a prepared statement binds.

         The parents are therefore resolved BEFORE the INSERT (the same shape
         as 0136 §2.1's orphan pre-flight in `partnerCompanyRelationshipStore`),
         and an unsatisfiable pair is a STATED 409 rather than an opaque 500.
         It is deliberately NOT a downgrade to a NULL-provenance write: that
         would be the exact state LOCK 1 exists to prevent, arrived at by
         accident. It is deliberately NOT a silent creation of the missing
         partner_organizations row either — that row carries a tenant, a legal
         name and a status this route does not know, and inventing it would put
         fabricated registration data behind a provenance claim.

         See OQ-33-3 in the wave report: making LOCK 1 land in production is a
         partner-registration data question, not a code question. */
      {
        const pdb = rawDb();
        const parents = pdb
          .prepare(
            `SELECT (SELECT COUNT(*) FROM partner_organizations WHERE id = ?) AS org,
                    (SELECT COUNT(*) FROM partner_attributions   WHERE id = ?) AS attr`,
          )
          .get(
            lock1.coWrite.sourcedFromPartnerId,
            lock1.coWrite.sourcedFromPartnerAttributionId,
          ) as { org: number; attr: number };
        if (!parents.org || !parents.attr) {
          return res.status(409).json({
            error: "LOCK1_PROVENANCE_NOT_PERSISTABLE",
            message: !parents.org
              ? "This partner has no registered partner organisation, so the provenance this soft circle requires cannot be recorded against it. The soft circle has not been created: recording it without its provenance is the state this lock exists to prevent."
              : "The attribution behind this soft circle is not present in the durable attribution table, so the provenance pair cannot be recorded. The soft circle has not been created.",
            missing: !parents.org ? "partner_organizations" : "partner_attributions",
          });
        }
      }

      try {
        const db  = rawDb();
        const now = new Date().toISOString();
        /* v25.16 NM2 — idempotent: deterministic id from validated values only so a
           retry collapses to one row instead of duplicating P&L data. */
        const idemKey = `${pid}:${compId}:${cur}:${st}:${amountMinor}`;
        /* WAVE 33 — was `require("node:crypto").createHash(...)`. A lazy require
           in a live write path is the Wave 32B defect exactly: one that throws
           only under the bundled production runtime, where nobody is looking.
           `createHash` is now a static import, and `randomBytes` was already
           imported statically two lines above it — the lazy call was redundant
           as well as unsafe. */
        const idHash  = createHash("sha1").update(idemKey).digest("hex").slice(0, 16);
        const id  = `sc_${idHash}`;

        db.prepare(`
          INSERT OR IGNORE INTO soft_circles
            (id, round_id, investor_name, amount, amount_minor, currency, status,
             source_type, source_id, company_id, created_at, updated_at,
             collective_visible, sourced_from_partner_id, sourced_from_partner_attribution_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'partner', ?, ?, ?, ?, 1, ?, ?)
        `).run(
          id, "round_partner_test", "Partner-Sourced Investor",
          /* WAVE 33 — was `amountMinor / 100`, a hardcoded exponent-2 assumption
             writing a major-units figure. Same class as the CP-SPV-31 sinks;
             `fromMinor` is exponent-driven and returns the same numeric
             type the REAL column already held, so no reader's arithmetic
             changes. This route's currency enum
             happens to hold only exponent-2 currencies today, so the division
             is not wrong for present inputs — it is wrong the moment JPY is
             added to that enum, and it would be wrong silently. */
          fromMinor(amountMinor, cur),
          amountMinor, cur, st, pid, compId, now, now,
          lock1.coWrite.sourcedFromPartnerId,
          lock1.coWrite.sourcedFromPartnerAttributionId,
        );

        res.status(201).json({
          ok: true, softCircleId: id, amountMinor, currency: cur, status: st,
          companyId: compId, partnerId: pid,
          provenance: lock1.coWrite,
        });
      } catch (err) {
        res.status(500).json({ error: "SOURCE_SC_FAILED", message: (err as Error).message });
      }
    },
  );
}
