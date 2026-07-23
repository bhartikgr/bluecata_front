/**
 * W-FIX4 Item 7 — small, read-only build/version marker.
 *
 * Prefers the authoritative runtime value from `/api/healthz` (public, no auth),
 * falling back to the build-time markers injected by vite (VITE_BUILD_SHA /
 * VITE_BUILD_TIME, "unknown" when git was unavailable at build). Purely
 * informational — surfaces "what's live" for admins/ops. No secrets are shown.
 */
import { useQuery } from "@tanstack/react-query";

type Healthz = {
  version?: string;
  buildSha?: string;
  buildTime?: string;
};

const BUILD_SHA = (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? "unknown";
const BUILD_TIME = (import.meta.env.VITE_BUILD_TIME as string | undefined) ?? "unknown";

export function BuildVersionMarker() {
  const { data } = useQuery<Healthz>({
    queryKey: ["/api/healthz"],
    queryFn: async () => {
      const res = await fetch("/api/healthz", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`healthz ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const version = data?.version ?? "unknown";
  const buildSha = data?.buildSha ?? BUILD_SHA;
  const buildTime = data?.buildTime ?? BUILD_TIME;

  return (
    <div
      className="mt-6 text-[10px] text-muted-foreground text-center select-text"
      data-testid="build-version-marker"
    >
      <span data-testid="build-version">v{version}</span>
      {" · "}
      <span data-testid="build-sha">build {buildSha}</span>
      {" · "}
      <span data-testid="build-time">{buildTime}</span>
    </div>
  );
}
