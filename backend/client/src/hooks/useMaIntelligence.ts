/**
 * client/src/hooks/useMaIntelligence.ts — W7 (2026-07-14).
 *
 * SINGLE shared client access point for M&A intelligence, so every surface
 * (investor, Collective member, founder) reads the SAME source through the SAME
 * hook and shows IDENTICAL data — differing only in how each surface renders it.
 *
 * Two source endpoints exist (investor vs Collective), both backed by the same
 * server-side source (deriveMaIntelFromProfile) + gate (decideMaAccess) + parity
 * envelope (buildMaParityEnvelope). Pick the surface via `surface`.
 *
 * The hook normalizes the three outcomes into ONE shape:
 *   - available:  hasData && !redacted           → full/detail data present.
 *   - redacted:   hasData && redacted            → data exists, some/all withheld.
 *   - noData:     !hasData                        → entitled to view, nothing yet.
 *   - forbidden:  the per-company route returned 404-opaque (out of scope) OR the
 *                 investor route returned 403 → caller may not see this company.
 *
 * The `accessMessage` is the server-authored, member/founder-friendly copy; UIs
 * should prefer it verbatim so denial/empty wording stays consistent + on-tone.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { MaIntelligence } from "@shared/schema";

export type MaParityReason = "ok" | "aggregate" | "detail_partial" | "no_data";
export type MaAccessLevel = "FULL" | "DETAIL" | "AGGREGATE" | "NONE";

/** The unified parity envelope the server attaches to every M&A intel response. */
export interface MaParityEnvelope {
  hasData: boolean;
  redacted: boolean;
  accessLevel: MaAccessLevel;
  reason: MaParityReason;
  accessMessage: string;
}

/** Raw intel fields (superset; surface-specific fields optional). */
export type MaIntelData = Partial<MaIntelligence> & Record<string, unknown>;

export type MaIntelState =
  | { status: "loading" }
  | { status: "forbidden"; accessMessage: string }
  | { status: "no_data"; envelope: MaParityEnvelope }
  | { status: "redacted"; data: MaIntelData; envelope: MaParityEnvelope }
  | { status: "available"; data: MaIntelData; envelope: MaParityEnvelope }
  | { status: "error"; message: string };

const FORBIDDEN_COPY =
  "You don’t currently have access to this company’s M&A intelligence. Access is " +
  "granted by the company — typically to its own chapter members and to investors " +
  "holding a position in the company. If you believe you should have access, reach " +
  "out to the company or your chapter lead.";

function normalize(raw: any): MaIntelState {
  if (!raw || typeof raw !== "object") {
    return { status: "error", message: "Unexpected M&A intelligence response." };
  }
  // Server explicit forbidden (investor 403 path surfaces as ok:false + this error).
  if (raw.error === "ma_intel_forbidden") {
    return { status: "forbidden", accessMessage: FORBIDDEN_COPY };
  }
  const envelope: MaParityEnvelope | null =
    typeof raw.reason === "string"
      ? {
          hasData: !!raw.hasData,
          redacted: !!raw.redacted,
          accessLevel: (raw.accessLevel ?? "NONE") as MaAccessLevel,
          reason: raw.reason as MaParityReason,
          accessMessage: String(raw.accessMessage ?? ""),
        }
      : null;

  if (!envelope) {
    // No parity envelope (shouldn't happen post-W7) — treat as available raw data.
    return { status: "available", data: raw as MaIntelData, envelope: {
      hasData: true, redacted: false, accessLevel: "FULL", reason: "ok", accessMessage: "",
    } };
  }
  if (!envelope.hasData) return { status: "no_data", envelope };
  if (envelope.redacted) return { status: "redacted", data: raw as MaIntelData, envelope };
  return { status: "available", data: raw as MaIntelData, envelope };
}

export interface UseMaIntelligenceArgs {
  companyId: string | undefined;
  /** "investor" → /api/investor/ma/intelligence/:id; "collective" → /api/collective/ma-intel/:id */
  surface?: "investor" | "collective";
  enabled?: boolean;
}

export function useMaIntelligence({ companyId, surface = "investor", enabled = true }: UseMaIntelligenceArgs): MaIntelState {
  const path =
    surface === "collective"
      ? `/api/collective/ma-intel/${encodeURIComponent(companyId ?? "")}`
      : `/api/investor/ma/intelligence/${encodeURIComponent(companyId ?? "")}`;

  const q = useQuery<any>({
    queryKey: [surface === "collective" ? "/api/collective/ma-intel" : "/api/investor/ma/intelligence", companyId, "detail"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", path);
        return await res.json();
      } catch (err: any) {
        // apiRequest throws ApiError{status, code, payload} on non-2xx. Surface
        // the parity body when present (404 no-data carries an envelope), else
        // classify forbidden vs generic error.
        const payload = err?.payload;
        if (payload && typeof payload === "object") return payload;
        if (err?.status === 403) return { error: "ma_intel_forbidden" };
        if (err?.status === 404) return { error: "not_found" };
        throw err;
      }
    },
    enabled: enabled && Boolean(companyId),
    retry: false,
  });

  if (q.isLoading) return { status: "loading" };
  if (q.isError) return { status: "error", message: (q.error as Error)?.message ?? "Failed to load M&A intelligence." };
  // Opaque out-of-scope 404 (collective anti-enumeration) → forbidden UX.
  if (q.data?.error === "not_found") return { status: "forbidden", accessMessage: FORBIDDEN_COPY };
  return normalize(q.data);
}

export const MA_FORBIDDEN_COPY = FORBIDDEN_COPY;
