/**
 * WAVE 203 · ITEM A (R178.5, verbatim: "Newest first.") — PROVEN ON RENDERED DOM.
 *
 * THE DEFECT, EXACTLY. The server has ordered `created_at DESC, id DESC` since
 * wave 181 (server/adminPlatformStore.ts:3127, `const orderDesc = orderRaw !==
 * "asc"; // default: newest first`). The page's own client sort has been
 * descending since wave 181 too (AuditLog.tsx:329,
 * `return all.sort((a, b) => b.ts.localeCompare(a.ts));`). And then the render
 * loop did this:
 *
 *     {[...filtered].reverse().map((e) => (
 *
 * — undoing both, in the last of the three layers, directly beneath a badge that
 * told the reader "Newest first". That is why the owner was twice told his
 * permanent record was dead: the newest row was present and pushed to the far end
 * of the view.
 *
 * WHY THIS TEST MOUNTS THE REAL PAGE (handbook §8). A test that sorted a fixture
 * array and asserted the result would have passed happily for every wave the
 * defect existed, because the two upstream layers were already correct — the
 * mistake was in the third. Only the rendered document can catch that. Every
 * assertion below reads `document` after mounting `AdminAuditLog` itself.
 *
 * ORDER OF ASSERTION MATTERS: A1 reads the DOM row order and compares it against
 * the timestamps, rather than against an expected id sequence, so the test states
 * the ruling ("the first row is the most recent") and not an implementation.
 *
 * NOT PROVEN HERE, deliberately: nothing in this file touches the hash chain.
 * Chain safety is proven by re-running the existing chain-verification suites
 * unchanged (see W203_TESTS.md) — the display order and the chain sequence are
 * different things, and a DOM test asserting otherwise would be theatre.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/** Every audit-log GET the page makes, so pagination can be proved by request. */
const auditRequests: string[] = [];

/* Three rows whose timestamps are DELIBERATELY not in fixture order: the
   middle element of the fixture is the newest. A fixture already sorted newest
   first would let a `.reverse()` bug survive a "first row is rows[0]" test. */
const OLDEST = { id: "ev_oldest", ts: "2026-08-01T09:00:00.000Z" };
const MIDDLE = { id: "ev_middle", ts: "2026-08-14T09:00:00.000Z" };
const NEWEST = { id: "ev_newest", ts: "2026-08-28T09:00:00.000Z" };

function auditRow(seed: { id: string; ts: string }) {
  return {
    id: seed.id,
    ts: seed.ts,
    actor: "adm_real",
    eventType: "pricing.display_repoint_confirmed",
    entity: "pricing_display_repoint:spv_deployment",
    priorHash: "0".repeat(64),
    hash: seed.id.padEnd(64, "f"),
    payload: {},
    actorLabel: "An administrator",
    entityLabel: "A fee record",
  };
}

/* Fixture order: oldest, NEWEST, middle. */
const FIXTURE_ITEMS = [auditRow(OLDEST), auditRow(NEWEST), auditRow(MIDDLE)];
/** The real live figure quoted in the brief, so "total unchanged" means something. */
const SERVER_TOTAL = 1325;

vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn(), setQueryData: vi.fn(), getQueryData: vi.fn() },
  apiRequest: vi.fn(async (_method: string, url: string) => {
    let body: unknown = {};
    if (url.startsWith("/api/admin/audit-log?")) {
      auditRequests.push(url);
      body = { items: FIXTURE_ITEMS, total: SERVER_TOTAL };
    } else if (url.startsWith("/api/admin/audit-log/verify")) {
      body = { ok: true, totalLinks: SERVER_TOTAL, perTenant: [], scope: "all" };
    } else if (url.startsWith("/api/admin/audit-write-health")) {
      body = {
        status: "ok",
        newestRowAt: NEWEST.ts,
        writeFailuresSinceBoot: 0,
        staleAfterHours: 24,
      };
    }
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }),
  getQueryFn: () => async () => ({}),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import AdminAuditLog from "../AuditLog";
/* The REAL role provider, not a stub: the page's header renders glossary links
   through `useRole`, and replacing that context with a fake would mean the
   component under test is no longer the component that ships (handbook §8). */
import { RoleProvider } from "@/lib/role";

function Wrap({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<QueryClient | null>(null);
  if (!ref.current) {
    ref.current = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
  }
  return (
    <QueryClientProvider client={ref.current}>
      <RoleProvider>{children}</RoleProvider>
    </QueryClientProvider>
  );
}

async function mountPage() {
  render(
    <Wrap>
      <AdminAuditLog />
    </Wrap>,
  );
  await waitFor(() => expect(screen.getByTestId(`row-audit-${NEWEST.id}`)).toBeTruthy());
}

/** The audit rows in the order the DOM actually holds them. */
function renderedRowIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="row-audit-"]'))
    .map((el) => el.getAttribute("data-testid") ?? "")
    .filter((t) => t !== "row-audit-empty")
    .map((t) => t.replace(/^row-audit-/, ""));
}

beforeEach(() => {
  auditRequests.length = 0;
});
afterEach(() => cleanup());

describe("WAVE 203 · A — the audit log opens on the most recent activity", () => {
  it("A1 THE RULING — the FIRST rendered row is the most recent, by timestamp", async () => {
    await mountPage();
    const ids = renderedRowIds();
    expect(ids.length).toBe(FIXTURE_ITEMS.length);

    /* Stated as the ruling, not as an id sequence: whichever row the DOM puts
       first must carry the maximum timestamp of the whole set. */
    const tsById = new Map(FIXTURE_ITEMS.map((r) => [r.id, r.ts]));
    const maxTs = FIXTURE_ITEMS.map((r) => r.ts).sort().at(-1)!;
    expect(tsById.get(ids[0])).toBe(maxTs);
    expect(ids[0]).toBe(NEWEST.id);

    /* And the whole column is monotonically non-increasing — a first-row-only
       assertion would pass on a list that was otherwise scrambled. */
    const order = ids.map((id) => tsById.get(id)!);
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1] >= order[i]).toBe(true);
    }
    /* The oldest row is last, which is the half of the claim a reversed list
       would still satisfy if only the first row were checked. */
    expect(ids.at(-1)).toBe(OLDEST.id);
  });

  it("A2 the page's own 'Newest first' badge is now TRUE rather than contradicted", async () => {
    await mountPage();
    /* This badge existed and was wrong. The test binds the promise to the fact. */
    const basis = screen.getByTestId("audit-order-basis");
    expect(basis.textContent).toContain("Newest first");
    expect(renderedRowIds()[0]).toBe(NEWEST.id);
  });

  it("A3 the total count is unchanged — reordering a view must not change the set", async () => {
    await mountPage();
    expect(screen.getByTestId("audit-total-server").textContent).toContain(String(SERVER_TOTAL));
    expect(screen.getByTestId("audit-page-count").textContent).toContain(
      String(FIXTURE_ITEMS.length),
    );
  });

  it("A4 pagination still works and still asks the server for the same window", async () => {
    await mountPage();
    const first = auditRequests.at(-1)!;
    expect(first).toContain("offset=0");
    const limit = /limit=(\d+)/.exec(first)![1];

    /* Prev is correctly disabled on the first page, Next is live. */
    expect((screen.getByTestId("audit-prev-page") as HTMLButtonElement).disabled).toBe(true);
    const next = screen.getByTestId("audit-next-page") as HTMLButtonElement;
    expect(next.disabled).toBe(false);

    fireEvent.click(next);
    await waitFor(() => expect(auditRequests.at(-1)).toContain(`offset=${limit}`));
    /* Page two is still newest-first within its window. */
    await waitFor(() => expect(renderedRowIds()[0]).toBe(NEWEST.id));
    /* And Prev has come alive, so the user can get back. */
    await waitFor(() =>
      expect((screen.getByTestId("audit-prev-page") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId("audit-prev-page"));
    await waitFor(() => expect(auditRequests.at(-1)).toContain("offset=0"));
  });

  it("A5 the render layer no longer reverses — asserted on the module source, as a second lock", async () => {
    /* A1–A4 are the real proof. This asserts the specific expression that caused
       the defect is gone, so a future refactor that reintroduces `.reverse()`
       in the tbody fails here with a message naming the cause. Comments AND
       string literals are stripped first, and the stripper is verified to have
       stripped, so this file's own prose cannot satisfy it. */
    const fs = await import("node:fs");
    const src = fs.readFileSync("client/src/pages/admin/AuditLog.tsx", "utf8");
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
    expect(src.length - stripped.length).toBeGreaterThan(500);
    expect(stripped).not.toContain("[...filtered].reverse()");
    expect(stripped).toContain("[...filtered].map(");
  });
});
