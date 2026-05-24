/**
 * Sprint 4 — shared API-shape types for the frontend.
 * Mirrors what `server/routes.ts` returns from /api/rounds.
 */
export type ApiRound = {
  id: string;
  companyId?: string;
  company?: string;
  name: string;
  type: string;
  state: string;
  targetAmount: number;
  raisedAmount: number;
  preMoney?: number;
  postMoney?: number;
  pricePerShare?: number | null;
  minTicket?: number;
  closeDate?: string;
  openDate?: string;
  termsSummary?: string;
  leadInvestor?: string;
  investorCount?: number;
};
