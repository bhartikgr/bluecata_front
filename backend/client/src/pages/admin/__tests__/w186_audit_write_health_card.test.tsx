/**
 * WAVE 186 · ITEM B(3) · R159.1 — THE HEALTH SIGNAL AN ADMIN CAN ACTUALLY READ.
 *
 * The live defect was not only that audit writes failed. It is that NOTHING ON
 * ANY SCREEN SAID SO for three months. The two hash-chain badges on this page
 * report that the entries already written are internally consistent, and a
 * ledger that has stopped accepting rows answers that with a confident green
 * forever — which is precisely how the owner read this page all summer and saw
 * nothing wrong.
 *
 * These assertions are on RENDERED DOM (jsdom), not on source text: a card that
 * exists in the file but does not render is the R137 failure mode. Four states
 * are pinned — recording, FAILING, stale, and health-check-unavailable — because
 * the only dangerous one is a health signal that shows something reassuring when
 * it does not know.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import AdminAuditLog from "../AuditLog";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

type HealthPayload = Record<string, unknown> | "throw";

/** The page's THREE GETs. Only the write-health payload varies per case; the
 *  other two are held constant so any difference in the rendering is caused by
 *  the health payload and nothing else. */
function mountWith(health: HealthPayload) {
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.includes("/api/admin/audit-write-health")) {
      if (health === "throw") throw new Error("health endpoint unreachable");
      return jsonResponse({ ok: true, health });
    }
    if (url.includes("/api/admin/audit-log/verify")) {
      return jsonResponse({ ok: true, totalLinks: 1321, scope: "all", perTenant: [] });
    }
    return jsonResponse({ count: 0, total: 1321, limit: 50, offset: 0, items: [], order: "desc" });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <AdminAuditLog />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

const HEALTHY = {
  ok: true,
  status: "healthy",
  newestRowAt: new Date().toISOString(),
  newestRowAgeSeconds: 42,
  newestRowAction: "spv.lp_committed",
  rowsTotal: 1322,
  writesOkSinceBoot: 7,
  writeFailuresSinceBoot: 0,
  lastWriteOkAt: new Date().toISOString(),
  staleAfterHours: 48,
  readError: null,
};

beforeEach(() => {
  apiRequestMock.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("W186 — the audit-write health card renders on /admin/audit-log", () => {
  it("the card is present and names the question the chain badges do NOT answer", async () => {
    mountWith(HEALTHY);
    await waitFor(() => expect(screen.getByTestId("card-audit-write-health")).toBeTruthy());
    expect(screen.getByTestId("audit-write-health-title").textContent).toContain("Is this ledger still recording?");
    expect(screen.getByTestId("audit-write-health-explainer").textContent).toContain(
      "They stay green even when nothing new is being written.",
    );
  });

  it("healthy: reports recording, the newest entry's age, and no warning", async () => {
    mountWith(HEALTHY);
    await waitFor(() =>
      expect(screen.getByTestId("audit-write-health-status").textContent).toContain("recording"),
    );
    expect(screen.getByTestId("audit-write-health-newest").textContent).toContain("min ago");
    expect(screen.getByTestId("audit-write-health-failures").textContent).toContain("0");
    expect(screen.queryByTestId("audit-write-health-warning")).toBeNull();
  });

  it("FAILING: says writes are being lost and tells the admin what to check", async () => {
    mountWith({ ...HEALTHY, ok: false, status: "failing", writeFailuresSinceBoot: 3 });
    await waitFor(() =>
      expect(screen.getByTestId("audit-write-health-status").textContent).toContain("FAILING"),
    );
    const warning = screen.getByTestId("audit-write-health-warning").textContent ?? "";
    expect(warning).toContain("Audit writes are FAILING on this server right now.");
    expect(warning).toContain("DATABASE_URL");
    expect(screen.getByTestId("audit-write-health-failures").textContent).toContain("3");
  });

  it("STALE — the exact live shape: three months of silence must NOT read as healthy", async () => {
    const ninetyDays = 90 * 24 * 3600;
    mountWith({
      ...HEALTHY,
      ok: false,
      status: "stale",
      newestRowAt: "2026-05-26T23:37:58.000Z",
      newestRowAgeSeconds: ninetyDays,
      newestRowAction: "consortium.apply.approved",
    });
    await waitFor(() =>
      expect(screen.getByTestId("audit-write-health-status").textContent).toContain("no new entries for over"),
    );
    expect(screen.getByTestId("audit-write-health-newest").textContent).toContain("90 days ago");
    expect(screen.getByTestId("audit-write-health-status").textContent).not.toContain("recording status: recording");
    expect(screen.getByTestId("audit-write-health-warning").textContent).toContain(
      "they are not in this ledger",
    );
  });

  it("unreachable health check: renders UNKNOWN and explicitly refuses to imply healthy", async () => {
    mountWith("throw");
    await waitFor(() =>
      expect(screen.getByTestId("audit-write-health-status").textContent).toContain("unknown"),
    );
    const warning = screen.getByTestId("audit-write-health-warning").textContent ?? "";
    expect(warning).toContain("UNKNOWN");
    expect(warning).toContain("Do not read this as healthy.");
    expect(screen.getByTestId("audit-write-health-newest").textContent).toContain("unknown");
  });
});
