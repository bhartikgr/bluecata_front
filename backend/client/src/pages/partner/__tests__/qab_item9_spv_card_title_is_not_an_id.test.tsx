/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA ITEM 9 (worst case) — an SPV card was TITLED with its primary key.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * QA read `spv_e08dcbdd2921a89c` where an SPV name belongs. The cause was
 * `{s.spvName ?? s.name ?? s.id}` — a fallback chain that ended at the storage
 * key. RENDERED TEXT is asserted here, from the real page.
 *
 * Two failure modes are separated so neither assertion can pass vacuously:
 *   · an SPV WITHOUT a name must describe itself, and must not echo the id;
 *   · an SPV WITH a name must be untouched — a fix that replaced every title
 *     with a refusal would pass the first test and destroy the screen.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerPipeline from "../PartnerPipeline";

const SPV_ID = "spv_e08dcbdd2921a89c";   // the exact id QA read off the screen
const NAMED_SPV_ID = "spv_named_1";

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_qab9",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_qab9", email: "qab9@example.com", name: "QAB9 Partner" },
    },
  }),
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true, status: 200, statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url === "/api/partner/me/pipeline") return jsonResponse({ pipeline: [], stages: [] });
    if (url === "/api/partner/me/promotions") return jsonResponse({ promotions: [] });
    if (url === "/api/partner/me/spv") {
      return jsonResponse({
        spvs: [
          /* The reported row: no name of any kind. */
          { id: SPV_ID, spvName: null, name: null, spvType: "Series A SPV", status: "draft" },
          /* A healthy row, so the fix can be shown NOT to overwrite good data. */
          { id: NAMED_SPV_ID, spvName: "Northwind Series A SPV", name: null, spvType: "Series A SPV", status: "draft" },
        ],
      });
    }
    if (url === "/api/partner/me/following") return jsonResponse({ following: [] });
    return jsonResponse({});
  });
});
afterEach(() => cleanup());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerPipeline />
    </QueryClientProvider>,
  );
}

describe("QA ITEM 9 · the SPV card title", () => {
  it("1 · CONTROL — both SPV cards really rendered", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId(`spv-card-${SPV_ID}`)).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByTestId(`spv-card-${NAMED_SPV_ID}`)).toBeTruthy();
  });

  it("2 · a nameless SPV DESCRIBES ITSELF instead of printing its primary key", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId(`spv-name-${SPV_ID}`)).toBeTruthy(), { timeout: 8000 });
    const title = screen.getByTestId(`spv-name-${SPV_ID}`);
    expect((title.textContent ?? "").trim()).toBe("Unnamed vehicle");
    /* THE DEFECT, pinned: the title slot must never contain the id. */
    expect(title.textContent ?? "").not.toContain(SPV_ID);
    expect(title.textContent ?? "").not.toContain("spv_");
    /* NOTHING BECAME UNREACHABLE — the id is on the tooltip, and the card's own
       test id still carries it. */
    expect(title.getAttribute("title")).toBe(SPV_ID);
  });

  it("3 · a NAMED SPV is untouched — the fix does not overwrite good data", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId(`spv-name-${NAMED_SPV_ID}`)).toBeTruthy(), { timeout: 8000 });
    expect((screen.getByTestId(`spv-name-${NAMED_SPV_ID}`).textContent ?? "").trim())
      .toBe("Northwind Series A SPV");
  });
});
