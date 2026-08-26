/**
 * WAVE 143 · BATCH 1 · ITEM 4 — the new tab is MOUNTED, and nothing was dropped
 * to make room for it.                                        R108.1 item 3
 *
 * The panel's own behaviour is covered by
 * `client/src/components/admin/__tests__/wave143_audience_rules_panel.test.tsx`.
 * This file answers the other question: can the owner actually REACH it, and did
 * mounting it cost any existing surface?
 *
 * The second half is the drop gate stated as a test. The wave-143 edit appends a
 * seventh `TabsTrigger` at the END of an existing list; inserting mid-list would
 * renumber every positional path after it, and REPLACING siblings with one
 * conditional is exactly the silent drop this repo's gate exists to catch. So all
 * six pre-existing triggers are asserted present, by testid, alongside the new one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryCache, QueryClientProvider } from "@tanstack/react-query";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});

import PlatformSurfaces from "../PlatformSurfaces";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

/** The six triggers that existed BEFORE wave 143. */
const PRE_EXISTING = [
  "tab-surfaces-routes",
  "tab-surfaces-columns",
  "tab-surfaces-audit",
  "tab-surfaces-bridge",
  "tab-surfaces-mark-reviews",
  "tab-surfaces-lock-text",
];

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

function renderPage() {
  const qc = new QueryClient({
    queryCache: new QueryCache({ onError: () => {} }),
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <PlatformSurfaces />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
  /* Every panel on the page reads something; an empty-but-successful answer is
     enough for a tab-presence assertion and keeps the harness honest about which
     URLs the page actually calls. */
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (url === "/api/comms/audience-policy") return jsonResponse({ viewerRole: "admin", rules: [] });
    return jsonResponse({ ok: true, entries: [], rulings: [], incidents: [], columns: [], reviews: [] });
  });
});
afterEach(() => {
  cleanup();
});

describe("WAVE 143 · T — the messaging-audience tab on PlatformSurfaces", () => {
  it("T1 the new trigger is present and reachable by the owner", async () => {
    renderPage();
    const trigger = await waitFor(() => screen.getByTestId("tab-surfaces-audience-rules"));
    expect((trigger.textContent ?? "").toLowerCase()).toContain("messaging audience");
  });

  it("T2 DROP GATE — all SIX pre-existing tabs survive alongside it", async () => {
    renderPage();
    await waitFor(() => screen.getByTestId("tab-surfaces-audience-rules"));
    for (const id of PRE_EXISTING) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    /* Seven triggers, not six-with-one-swapped. */
    const all = [...PRE_EXISTING, "tab-surfaces-audience-rules"];
    expect(new Set(all.map((id) => screen.getByTestId(id))).size).toBe(7);
  });

  it("T3 the tab is the LAST trigger — nothing was renumbered to insert it", async () => {
    renderPage();
    const trigger = await waitFor(() => screen.getByTestId("tab-surfaces-audience-rules"));
    const list = trigger.parentElement!;
    const ids = Array.from(list.children).map((el) => el.getAttribute("data-testid"));
    expect(ids[ids.length - 1]).toBe("tab-surfaces-audience-rules");
    /* And the pre-existing six keep their original order. */
    expect(ids.slice(0, PRE_EXISTING.length)).toEqual(PRE_EXISTING);
  });
});
