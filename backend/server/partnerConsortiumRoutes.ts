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

import { randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { requirePartnerAuth, requirePartnerSubrole } from "./lib/requirePartnerAuth";
import { rawDb } from "./db/connection";
import { partnerFundsStore } from "./partnerWorkspaceStore";
import type { PartnerTier } from "./adminContactsStoreShim";

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
        let   totalCommittedMinor  = 0;
        let   totalFundedMinor     = 0;

        // byMonth: { month: "YYYY-MM", dealsSourced, committedMinor, fundedMinor }
        const monthMap: Record<string, { dealsSourced: number; committedMinor: number; fundedMinor: number }> = {};
        // byTier: single entry (this partner's tier)
        const tierEntry = { tier, commissionPct: pct * 100, dealsSourced: 0, committedMinor: 0, fundedMinor: 0, commissionMinor: 0 };

        /* v25.16 NM1 — capture per-currency totals so a partner whose
           soft-circles span USD + CAD does not see a meaningless mixed-sum.
           The single `totalCommittedMinor` field is preserved for backward
           compatibility but a new `byCurrency` array is added to the
           response. Currencies are case-normalized to upper. */
        const currencyMap: Record<string, { committedMinor: number; fundedMinor: number }> = {};
        const currenciesSeen = new Set<string>();

        for (const r of rows) {
          const committed = ["confirmed", "committed", "funded"].includes(r.status);
          const funded    = r.status === "funded";
          const cur       = (r.currency || "USD").toUpperCase();
          currenciesSeen.add(cur);
          if (!currencyMap[cur]) currencyMap[cur] = { committedMinor: 0, fundedMinor: 0 };
          if (committed) currencyMap[cur].committedMinor += r.amount_minor;
          if (funded)    currencyMap[cur].fundedMinor    += r.amount_minor;

          if (committed) totalCommittedMinor += r.amount_minor;
          if (funded)    totalFundedMinor    += r.amount_minor;

          // Month bucket
          const month = (r.created_at ?? "").slice(0, 7); // "YYYY-MM"
          if (!monthMap[month]) monthMap[month] = { dealsSourced: 0, committedMinor: 0, fundedMinor: 0 };
          monthMap[month].dealsSourced += 1;
          if (committed) monthMap[month].committedMinor += r.amount_minor;
          if (funded)    monthMap[month].fundedMinor    += r.amount_minor;

          // Tier rollup
          tierEntry.dealsSourced += 1;
          if (committed) tierEntry.committedMinor += r.amount_minor;
          if (funded)    tierEntry.fundedMinor    += r.amount_minor;
        }

        // Commission earned = pct * totalFunded
        const commissionEarnedMinor = Math.floor(totalFundedMinor * pct);
        tierEntry.commissionMinor = commissionEarnedMinor;

        // Payout pending = unpaid billing entries
        let payoutPendingMinor = 0;
        try {
          const pending = db.prepare(`
            SELECT COALESCE(SUM(commission_minor), 0) AS total
            FROM partner_billing_entries
            WHERE partner_id = ? AND status = 'pending'
          `).get(pid) as { total: number };
          payoutPendingMinor = pending.total ?? 0;
        } catch { /* table may not exist yet on fresh DB */ }

        const byMonth = Object.entries(monthMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, v]) => ({ month, ...v }));

        /* v25.16 NM1 — expose per-currency rollup so the client can warn when
           the headline `totalCommittedMinor` is mixed across currencies. */
        const byCurrency = Object.entries(currencyMap)
          .map(([currency, v]) => ({ currency, ...v }))
          .sort((a, b) => a.currency.localeCompare(b.currency));
        const currencies = Array.from(currenciesSeen).sort();

        res.json({
          totalDealsSourced,
          totalCommittedMinor,
          totalFundedMinor,
          commissionEarnedMinor,
          payoutPendingMinor,
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
   * C4 — GET /api/partner/me/portfolio
   *
   * Lists companies sourced by this partner via partner_sourced_founders.
   * Auth: any partner subrole except viewer.
   * ========================================================== */
  app.get(
    "/api/partner/me/portfolio",
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
   * Admin/test helper: tag a soft_circle as sourced by this partner.
   * Creates a synthetic funded soft_circle for billing/P&L testing.
   * Auth: managing_partner only.
   * ========================================================== */
  app.post(
    "/api/partner/me/soft-circles/source",
    requirePartnerAuth,
    requirePartnerSubrole(["managing_partner"]),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const pid  = ctx.partnerId;
      const { amountMinor, currency, status, companyId } = req.body ?? {};

      if (typeof amountMinor !== "number") {
        return res.status(400).json({ error: "BAD_REQUEST", message: "amountMinor (integer) required" });
      }

      try {
        const db  = rawDb();
        const now = new Date().toISOString();
        const cur = isString(currency) ? currency : "USD";
        const st  = isString(status)   ? status   : "funded";
        const compId = isString(companyId) ? companyId : null;
        /* v25.16 NM2 — make this idempotent. Use deterministic id derived from
           (partner, company, currency, status, amount) so a retry/double-click
           collapses to one row instead of duplicating P&L data. */
        const idemKey = `${pid}:${compId ?? "-"}:${cur}:${st}:${amountMinor}`;
        const idHash  = require("node:crypto").createHash("sha1").update(idemKey).digest("hex").slice(0, 16);
        const id  = `sc_${idHash}`;

        db.prepare(`
          INSERT OR IGNORE INTO soft_circles
            (id, round_id, investor_name, amount, amount_minor, currency, status,
             source_type, source_id, company_id, created_at, updated_at,
             collective_visible)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'partner', ?, ?, ?, ?, 1)
        `).run(id, "round_partner_test", "Partner-Sourced Investor", amountMinor / 100, amountMinor, cur, st, pid, compId, now, now);

        res.status(201).json({ ok: true, softCircleId: id, amountMinor, currency: cur, status: st });
      } catch (err) {
        res.status(500).json({ error: "SOURCE_SC_FAILED", message: (err as Error).message });
      }
    },
  );
}
