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
      if (!req.userContext?.isAuthed) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { companyId } = req.body as { companyId?: string };
      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }
      // In production this would enqueue a task; for now return optimistic response.
      return res.json({ requested: true, eta: "2 business days" });
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
      // loadUserContext middleware already populated req.userContext.
      if (!req.userContext?.isAuthed) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      // Tax exports are not yet available; inform the client gracefully.
      return res.status(404).json({
        available: false,
        message: "Tax exports open Q1 2027. No package is available yet.",
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
      const userId = ctx?.userId ?? (req.headers["x-user-id"] as string | undefined);
      if (!userId || !ctx?.isAuthed) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { companyId } = req.params;

      // Seed data: representative engagement history for known investors.
      const HISTORY: Record<
        string,
        Array<{
          id: string;
          date: string;
          roundName: string;
          action: string;
          amount?: number;
          currency?: string;
          capTablePosition?: string;
        }>
      > = {
        u_aisha_patel: [
          {
            id: "he_001",
            date: "2025-09-01T10:00:00Z",
            roundName: "NovaPay Seed",
            action: "invitation_received",
            amount: undefined,
          },
          {
            id: "he_002",
            date: "2025-09-10T12:00:00Z",
            roundName: "NovaPay Seed",
            action: "soft_circle",
            amount: 50000,
            currency: "USD",
          },
          {
            id: "he_003",
            date: "2025-10-05T09:00:00Z",
            roundName: "NovaPay Seed",
            action: "signed",
            amount: 50000,
            currency: "USD",
            capTablePosition: "Angel — Series Seed",
          },
        ],
      };

      const investorHistory = HISTORY[userId] ?? [];

      // Filter by companyId using a simplistic company-name map.
      const COMPANY_ROUND_PREFIXES: Record<string, string[]> = {
        co_novapay: ["novapay", "NovaPay"],
        co_arboreal: ["arboreal", "Arboreal"],
        co_quanta: ["quanta", "Quanta"],
        co_beacon: ["beacon", "Beacon"],
        co_tideline: ["tideline", "Tideline"],
      };
      const prefixes = COMPANY_ROUND_PREFIXES[companyId] ?? [];
      const filtered = prefixes.length
        ? investorHistory.filter((e) =>
            prefixes.some((p) =>
              e.roundName.toLowerCase().includes(p.toLowerCase()),
            ),
          )
        : [];

      return res.json({
        companyId,
        investorId: userId,
        events: filtered,
      });
    },
  );
}
