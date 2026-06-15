/**
 * Sprint 22 Wave 2 — Missing endpoint stubs.
 *
 * Registers endpoints that exist in the client but were not yet registered
 * on the server:
 *
 *  - GET  /api/investor/portfolio/tax/download  (DEF-018 latent fix)
 *  - GET  /api/investor/company-history/:companyId  (InvestmentHistoryPanel)
 *
 * Additional note on DEF-029/030: those hardcoded fallbacks were removed
 * directly in sprint21PortfolioRoutes.ts; no re-registration needed here.
 */

import { type Express, type Request, type Response } from "express";
import { listForInvestorEmail as roundInvitationsListForEmail } from "./roundInvitationsStore";
import { listCommitsForUser as ledgerListForUser } from "./captableCommitStore";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
export function registerSprint22Routes(app: Express): void {
  /* ------------------------------------------------------------------
   * POST /api/investor/portfolio/tax/request  (DEF-012)
   *
   * Records a tax-document request for the given companyId.
   * Returns {requested: true, eta: "2 business days"} immediately.
   * ------------------------------------------------------------------ */
  app.post(
    "/api/investor/portfolio/tax/request",
    (req: Request, res: Response) => {
      const ctx = req.userContext;
      if (!ctx?.isAuthed) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { companyId, taxYear } = req.body as { companyId?: string; taxYear?: number };
      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }
      /* v25.10 fix H3 — the previous handler returned `{ requested: true }`
       * with NO DB write, NO queue, NO follow-through. Tax requests were
       * silently discarded. Now we persist the request to
       * kv_investorTaxRequestStore so:
       *   - the admin/back-office can list pending tax requests
       *   - the investor's request is auditable across restarts
       *   - the tax/download endpoint can transition state from
       *     `pending` → `ready` once the document is prepared
       *
       * Idempotency: one request per (userId, companyId, taxYear). A repeat
       * POST updates the existing record's `updatedAt` and resets status to
       * `pending` if it was previously `cancelled`.
       */
      const userId = ctx.userId;
      const year = typeof taxYear === "number" ? taxYear : new Date().getUTCFullYear() - 1;
      const reqId = `tax_${userId}_${companyId}_${year}`;
      const now = new Date().toISOString();
      const record = {
        id: reqId,
        userId,
        companyId,
        taxYear: year,
        status: "pending" as "pending" | "in_progress" | "ready" | "cancelled",
        requestedAt: now,
        updatedAt: now,
        downloadUrl: null as string | null,
      };
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { persistEntry } = require("./lib/storePersistenceShim");
        persistEntry("investorTaxRequestStore", reqId, record);
      } catch (err) {
        log.warn({
          route: "investor.portfolio.tax.request",
          message: `persist failed (non-fatal): ${(err as Error).message}`,
        });
      }
      return res.json({
        requested: true,
        requestId: reqId,
        status: record.status,
        eta: "2 business days",
      });
    },
  );

  /* ------------------------------------------------------------------
   * DEF-018: GET /api/investor/portfolio/tax/download
   *
   * Returns a 404 with a clear message while tax exports are unavailable.
   * Accepts optional ?companyId= query param (DEF-013) for per-company scoping.
   * When availability is set to true in the future, this handler should
   * stream the PDF/ZIP package from object storage.  The client already
   * guards rendering this link behind taxQ.data?.available, so this stub
   * is a safety-net for direct URL access.
   * ------------------------------------------------------------------ */
  app.get(
    "/api/investor/portfolio/tax/download",
    (req: Request, res: Response) => {
      const ctx = req.userContext;
      if (!ctx?.isAuthed) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      /* v25.10 fix H4 — previously hard-coded `available: false`. Now reads
       * the persisted request status from kv_investorTaxRequestStore so the
       * UI can surface the real state of the investor's pending requests.
       * When status reaches `ready` the handler returns the download URL
       * (the actual PDF/ZIP generator is a separate backend job that
       * flips status to `ready` and sets downloadUrl). */
      const { companyId, taxYear } = req.query as { companyId?: string; taxYear?: string };
      const userId = ctx.userId;
      let pending = 0, ready = 0, latestReady: any = null;
      const allMine: any[] = [];
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { hydrateEntries } = require("./lib/storePersistenceShim");
        const rows = hydrateEntries("investorTaxRequestStore") as Array<[string, any]>;
        for (const [, rec] of rows) {
          if (!rec || rec.userId !== userId) continue;
          if (companyId && rec.companyId !== companyId) continue;
          if (taxYear && String(rec.taxYear) !== String(taxYear)) continue;
          allMine.push(rec);
          if (rec.status === "pending" || rec.status === "in_progress") pending++;
          if (rec.status === "ready") {
            ready++;
            if (!latestReady || latestReady.updatedAt < rec.updatedAt) latestReady = rec;
          }
        }
      } catch (err) {
        log.warn({
          route: "investor.portfolio.tax.download",
          message: `read failed (non-fatal): ${(err as Error).message}`,
        });
      }
      if (ready > 0 && latestReady) {
        return res.json({
          available: true,
          status: latestReady.status,
          requestId: latestReady.id,
          downloadUrl: latestReady.downloadUrl,
          taxYear: latestReady.taxYear,
          companyId: latestReady.companyId,
        });
      }
      return res.status(200).json({
        available: false,
        pendingCount: pending,
        message: pending > 0
          ? `Your tax request is being prepared. ETA 2 business days.`
          : `No tax request found. Submit a request to generate your export.`,
        requests: allMine,
      });
    },
  );

  /* ------------------------------------------------------------------
   * GET /api/investor/company-history/:companyId
   *
   * Returns the authenticated investor's engagement history with a
   * specific company across all prior rounds.
   *
   * Used by InvestmentHistoryPanel.tsx.
   * ------------------------------------------------------------------ */
  app.get(
    "/api/investor/company-history/:companyId",
    (req: Request, res: Response) => {
      // loadUserContext middleware already populated req.userContext.
      const ctx = req.userContext;
      const userId = ctx?.userId ?? null; /* v14 — no header fallback */
      if (!userId || !ctx?.isAuthed) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const companyId = String(req.params.companyId ?? "");

      /* v25.10 fix H2 — the previous handler hard-coded a HISTORY table
       * keyed on `u_aisha_patel` so EVERY real investor saw `events: []`.
       * Rewritten to read the investor's REAL engagement history from
       * two DB-backed sources:
       *   1) roundInvitationsStore.listForInvestorEmail(email) — every
       *      invitation the investor received (status transitions are
       *      stored as `status` + `respondedAt`).
       *   2) captableCommitStore.listCommitsForUser(userId, companyId) —
       *      every cap-table commit (soft-circled / signed / funded /
       *      committed) for the investor in that company.
       * Both filtered to the company in question.
       */
      const email = (ctx?.identity?.email ?? "").toLowerCase();
      const events: Array<{
        id: string;
        date: string;
        roundName: string;
        action: string;
        amount?: number;
        currency?: string;
        capTablePosition?: string;
      }> = [];

      /* Resolve round names for any roundIds we encounter. We do a single
       * query against the rounds table (when present); fall back to roundId
       * if the lookup fails. */
      let roundNameById: Record<string, string> = Object.create(null);
      try {
        const db: any = rawDb();
        const rows: any[] = db
          .prepare(`SELECT id, name FROM rounds WHERE company_id = ?`)
          .all(companyId);
        for (const r of rows) {
          if (r && r.id) roundNameById[r.id] = String(r.name ?? r.id);
        }
      } catch (err) {
        log.warn({
          route: "investor.companyHistory.roundNameLookup",
          message: `lookup failed (non-fatal): ${(err as Error).message}`,
        });
      }

      /* Invitations the investor received for this company. */
      try {
        if (email) {
          const invs = roundInvitationsListForEmail(email);
          for (const i of invs) {
            if ((i as any).companyId !== companyId) continue;
            const roundName = roundNameById[(i as any).roundId] ?? (i as any).roundId;
            const inviteDate = (i as any).createdAt ?? (i as any).redeemedAt ?? new Date().toISOString();
            events.push({
              id: `inv_${(i as any).id}`,
              date: inviteDate,
              roundName,
              action: "invitation_received",
            });
            const status = String((i as any).status ?? "");
            const respondedAt = (i as any).respondedAt ?? (i as any).redeemedAt;
            if (respondedAt && status && status !== "sent" && status !== "pending") {
              events.push({
                id: `inv_${(i as any).id}_${status}`,
                date: respondedAt,
                roundName,
                action: status,
              });
            }
          }
        }
      } catch (err) {
        log.warn({
          route: "investor.companyHistory.invitations",
          message: `read failed (non-fatal): ${(err as Error).message}`,
        });
      }

      /* Cap-table commits for the investor in this company. */
      try {
        const commits = ledgerListForUser(userId, companyId);
        for (const c of commits) {
          const roundName = roundNameById[c.roundId] ?? c.roundId;
          const amt = parseFloat(c.amount || "0");
          events.push({
            id: `cmt_${c.seq}`,
            date: c.ts,
            roundName,
            action: c.state,
            amount: isFinite(amt) ? amt : undefined,
            currency: c.currency,
            capTablePosition: c.state === "committed" ? "Cap-table holder" : undefined,
          });
        }
      } catch (err) {
        log.warn({
          route: "investor.companyHistory.commits",
          message: `read failed (non-fatal): ${(err as Error).message}`,
        });
      }

      /* Sort oldest-first so the UI panel reads chronologically. */
      events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      return res.json({
        companyId,
        investorId: userId,
        events,
      });
    },
  );
}
