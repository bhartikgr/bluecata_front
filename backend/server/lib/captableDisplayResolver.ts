/* W-FIX1a (2026-07-19) — cap-table DISPLAY resolver (A1 + A2).
 *
 * Read-only, additive, fail-open projection helpers used by the cap-table
 * display bridges in `server/routes.ts` (the /securities and /captable/interim
 * endpoints) to resolve friendly investor name + email and a human round NAME,
 * so those surfaces never leak a raw `u_…` / `rnd_…` id.
 *
 * SACRED files are only CALLED here, never modified:
 *   - getUserContextForId  (server/lib/userContext.ts) — DB-hydrated identity
 *   - getRoundById         (server/roundsStore.ts)     — round metadata
 *
 * Every function is defensive (try/catch + safe fallbacks): a resolution miss
 * must degrade to a friendly placeholder, never throw and never break the read.
 */
import { getUserContextForId } from "./userContext";
import { getRoundById as roundsGetById } from "../roundsStore";

export type HolderDisplay = { name: string; email: string };

/** True when the string looks like a raw internal entity id we must never show. */
function looksLikeRawId(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^(u_|co_|rnd_|company:|cmp_|inv_|spv_)/i.test(v.trim());
}

/**
 * Resolve an investor's display name + email for a cap-table row.
 * Preference order:
 *   1. ledger-stored holder first/last name (already on the entry)
 *   2. DB-hydrated identity via getUserContextForId (SACRED, read-only)
 *   3. friendly placeholder "Investor (pending profile)" — NEVER a raw id
 */
export function resolveHolderDisplay(
  investorId: string | null | undefined,
  holderFirstName?: string | null,
  holderLastName?: string | null,
): HolderDisplay {
  const ledgerName = `${holderFirstName ?? ""} ${holderLastName ?? ""}`.trim();
  let name = ledgerName;
  let email = "";
  try {
    const id = String(investorId ?? "").trim();
    if (id) {
      const ctx = getUserContextForId(id);
      if (ctx?.isAuthed) {
        if (ctx.identity?.email) email = ctx.identity.email;
        if (!name && ctx.identity?.name) name = ctx.identity.name.trim();
        if (!name && ctx.identity?.screenName) name = ctx.identity.screenName.trim();
      }
    }
  } catch { /* fail-open to placeholder */ }
  if (!name || looksLikeRawId(name)) name = "Investor (pending profile)";
  return { name, email };
}

/**
 * Resolve a round's human NAME from its id.
 * Falls back to a short-id label "Round <last6>" (never the bare raw id) so the
 * UI is always legible even if the round row is missing.
 */
export function resolveRoundName(roundId: string | null | undefined): string {
  const id = String(roundId ?? "").trim();
  if (!id) return "—";
  try {
    const rnd = roundsGetById(id) as any;
    const nm = (rnd?.name ?? rnd?.series ?? "").toString().trim();
    if (nm) return nm;
  } catch { /* fall through */ }
  const short = id.replace(/^rnd_/i, "").slice(-6);
  return short ? `Round ${short}` : "—";
}

/**
 * Compute committed ownership % for a holder (holderShares ÷ totalCommittedShares).
 * Returns null when the basis is zero/unknown so the FE can render "pending".
 */
export function computeOwnershipPct(
  holderShares: number,
  totalCommittedShares: number,
): number | null {
  if (!Number.isFinite(holderShares) || !Number.isFinite(totalCommittedShares)) return null;
  if (totalCommittedShares <= 0 || holderShares <= 0) return null;
  return (holderShares / totalCommittedShares) * 100;
}
