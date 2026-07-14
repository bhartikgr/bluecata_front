/**
 * v25.42 (Bucket A) — shared /api/auth/me consumer hook.
 *
 * The Hero card (W1), Membership badges strip (W2) and the admin Operations
 * console (W8) all read identity + role context from the canonical
 * GET /api/auth/me endpoint (server/routes.ts). That endpoint is DB-backed
 * (re-reads the `users` table for canonical name/email) and returns the
 * persona context including `isAdmin`, `collective.{status,role}`,
 * `founder.companies` and `investor.capTablePositions`.
 *
 * No in-memory state — every render derives from the live query.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { safePersonDisplayName } from "@/lib/personName"; /* W3.2 — never render email/opaque id as a person name */

export interface MeResponse {
  isAuthed?: boolean;
  userId?: string | null;
  name?: string;
  identity?: { name?: string; email?: string; displayName?: string | null } | null;
  isAdmin?: boolean;
  collective?: { status?: string | null; role?: string | null; expiresAt?: string | null };
  founder?: { companies?: Array<{ companyId: string; companyName: string }>; activeCompanyId?: string | null };
  investor?: { capTablePositions?: Array<{ companyId: string; companyName: string; ownershipPct: number }>; state?: string };
}

export function useMe() {
  return useQuery<MeResponse>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => (await apiRequest("GET", "/api/auth/me")).json(),
    staleTime: 30_000,
  });
}

/** Resolve a friendly display name from the me payload. W3.2 — guarded so an
 *  email-like or raw opaque-id value can never surface as the dashboard
 *  greeting; falls through candidates in priority order, then "Member". */
export function meDisplayName(m?: MeResponse): string {
  const candidates = [m?.identity?.displayName, m?.identity?.name, m?.name];
  for (const c of candidates) {
    const safe = safePersonDisplayName(c, "");
    if (safe) return safe;
  }
  return "Member";
}

export type BadgeKey =
  | "in_good_standing"
  | "dsc_committee"
  | "admin"
  | "founder"
  | "fund_admin";

/**
 * Derive which membership badges apply from the live me payload. Only badges
 * that apply are returned (W2 contract).
 */
export function deriveBadges(m?: MeResponse): BadgeKey[] {
  if (!m) return [];
  const out: BadgeKey[] = [];
  const role = (m.collective?.role ?? "").toLowerCase();
  if (m.collective?.status === "active") out.push("in_good_standing");
  if (role.includes("dsc") || role.includes("committee")) out.push("dsc_committee");
  if (m.isAdmin === true) out.push("admin");
  if ((m.founder?.companies?.length ?? 0) > 0) out.push("founder");
  if (role === "fund_admin" || role.includes("fund")) out.push("fund_admin");
  return out;
}
