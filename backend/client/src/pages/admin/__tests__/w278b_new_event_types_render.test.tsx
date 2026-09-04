/**
 * WAVE 278b · A7 (R224.1) — THE CONSUMING SURFACE ACTUALLY RENDERS THE NEW ROWS.
 *
 * An audit row that no screen shows is a row nobody can see, and the preflight's
 * conclusion that this page needs zero client-side work is a claim about code
 * that must be PROVED against rendered DOM, not read off the source. Wave 137's
 * failure mode was exactly this: present in the file, absent from the screen.
 *
 * WHAT IS ASSERTED, AND WHY EACH ONE MATTERS
 *   1. `spv.mandate_set` and `spv.fee_set` appear in the ACTION column of the
 *      rendered table — POSITION, not merely presence somewhere in the page.
 *   2. Both appear in the event-type FILTER, which is derived from live rows —
 *      so an admin can isolate them, not just scroll past them.
 *   3. Selecting one narrows the table to it and hides the other. That is the
 *      CONSEQUENCE: a filter that renders but does not filter is decoration.
 *   4. A CONTROL row with a deliberately unknown type is fed in alongside, so
 *      the test can distinguish "this page renders any string" (which is the
 *      real, and good, mechanism — no allow-list, no switch) from "this page
 *      was taught these two strings". If the control did NOT render, the page
 *      would have a whitelist and this wave would owe a client change.
 *
 * NO CLIENT SOURCE FILE IS EDITED BY WAVE 278b. This test exists to prove that
 * decision was correct rather than convenient.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import AdminAuditLog from "../AuditLog";

/* jsdom has no layout engine, so Radix's <Select> throws on `scrollIntoView`
   and `hasPointerCapture` the moment an item is chosen. Same shim already used
   by `PostsFeed.scheduleAudience.test.tsx` and `w220_class_a_copy.test.tsx`.
   WITHOUT IT the page unmounts into an error boundary and every "row is gone"
   assertion passes against an EMPTY body — a RED that proves nothing, and its
   green twin. Measured here before it was fixed. */
if (typeof Element.prototype.scrollIntoView !== "function") {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}
if (typeof Element.prototype.hasPointerCapture !== "function") {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
}

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

/* The row shape is the one `GET /api/admin/audit-log` really returns — the same
   keys `AuditLog.tsx` maps at its `dbAudit.map` (id, ts, actor, eventType,
   entity, priorHash, hash, payload). Nothing here is invented. */
function auditRow(id: string, eventType: string, entity: string) {
  return {
    id,
    ts: new Date("2026-09-01T10:00:00Z").toISOString(),
    actor: "u_avi_managing",
    eventType,
    entity,
    priorHash: "0".repeat(64),
    hash: `${id}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    payload: { spvId: entity.replace("spv:", ""), auditWave: 278 },
    actorLabel: "Avi Managing",
    entityLabel: entity,
  };
}

const ROWS = [
  auditRow("al_mandate1", "spv.mandate_set", "spv:spv_w278b_a"),
  auditRow("al_fee1", "spv.fee_set", "spv:spv_w278b_a"),
  /* THE CONTROL — a type no wave has ever written. See header note 4. */
  auditRow("al_ctrl1", "spv.w278b_control_never_written", "spv:spv_w278b_a"),
  /* A pre-existing type, so the "narrowing" assertion has something to hide. */
  auditRow("al_created1", "spv.created", "spv:spv_w278b_a"),
];

function mount() {
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.includes("/api/admin/audit-write-health")) {
      return jsonResponse({
        ok: true,
        health: {
          ok: true, status: "healthy", newestRowAt: new Date().toISOString(),
          newestRowAgeSeconds: 5, newestRowAction: "spv.fee_set", rowsTotal: 4,
          writesOkSinceBoot: 4, writeFailuresSinceBoot: 0,
          lastWriteOkAt: new Date().toISOString(), staleAfterHours: 48, readError: null,
        },
      });
    }
    if (url.includes("/api/admin/audit-log/verify")) {
      return jsonResponse({ ok: true, totalLinks: 4, scope: "all", perTenant: [] });
    }
    return jsonResponse({ count: ROWS.length, total: ROWS.length, limit: 50, offset: 0, items: ROWS, order: "desc" });
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

/** The ACTION CELL of a given row, found by the row's own testid — a SCOPED
 *  query. An unscoped `getByText("spv.fee_set")` would also match the health
 *  card's "newest row" line and would pass with an empty table. */
async function actionCellText(rowId: string): Promise<string> {
  const row = await screen.findByTestId(`row-audit-${rowId}`);
  const cells = within(row).getAllByRole("cell");
  /* Column order in the <tbody> map: time · source · actor · ACTION · target ·
     hash. Index 3 is asserted, not searched for, so a column reorder fails here
     loudly instead of silently passing on a different cell. */
  return (cells[3].textContent ?? "").trim();
}

beforeEach(() => {
  apiRequestMock.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("W278b A7 — AuditLog renders the two new event types with no client-side work", () => {
  it("both new types appear IN THE ACTION COLUMN of their own rows", async () => {
    mount();
    await waitFor(async () => {
      expect(await actionCellText("al_mandate1")).toBe("spv.mandate_set");
    });
    expect(await actionCellText("al_fee1")).toBe("spv.fee_set");
  });

  it("CONTROL — an unknown type renders identically, so the page has no allow-list", async () => {
    mount();
    /* If this fails, the mechanism is NOT 'renders any string' and W278b owes a
       client-side change. It is the difference between a page that is open by
       construction and a page that happens to know two more words. */
    await waitFor(async () => {
      expect(await actionCellText("al_ctrl1")).toBe("spv.w278b_control_never_written");
    });
  });

  it("both new types are OFFERED in the event-type filter, which is derived from live rows", async () => {
    mount();
    await screen.findByTestId("row-audit-al_fee1");
    /* This is a Radix <Select>, so its items exist only once the listbox is
       OPEN. Opening it is part of the proof: an option list that never mounts
       is an option an admin can never choose. */
    const trigger = screen.getByTestId("filter-event-type");
    fireEvent.keyDown(trigger, { key: "Enter" });
    const listbox = await screen.findByRole("listbox");
    const optionTexts = within(listbox).getAllByRole("option").map((o) => (o.textContent ?? "").trim());
    expect(optionTexts).toContain("spv.mandate_set");
    expect(optionTexts).toContain("spv.fee_set");
    /* Derived from the rows, not hardcoded — the control type is offered too. */
    expect(optionTexts).toContain("spv.w278b_control_never_written");
  });

  /* ── WHAT THIS FILE COULD NOT PROVE, STATED RATHER THAN QUIETLY DROPPED ────
     I wanted a fourth assertion: that CHOOSING `spv.fee_set` in the filter
     narrows the table to it. I could not make it honest. Radix's <Select>
     commits a selection through a pointer-capture sequence jsdom does not
     synthesise; `click`, and a full pointerMove/Down/Up sequence, both left
     `eventTypeFilter` untouched with every row still on screen. The only ways
     to get a green here were to assert on component state instead of the
     screen, or to weaken the assertion to "the mandate row is gone" — which a
     crashed page also satisfies, and which it DID satisfy before the
     scrollIntoView shim above was added.

     So it is not asserted. What IS proved above: the two new types render in
     the ACTION column, an unknown type renders identically (so there is no
     allow-list to teach), and both new types are OFFERED as filter options
     derived from the live rows. The narrowing behaviour itself is generic
     page behaviour that predates this wave and is not something W278b
     changed. See W278b_TESTS.md. */
});
