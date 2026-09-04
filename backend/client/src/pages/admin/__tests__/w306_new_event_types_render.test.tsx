/**
 * WAVE 306 · PART 1 / R224.1 — EVERY CONSUMING SURFACE RENDERS THE NEW ROWS.
 *
 * Part 1 makes two event types appear in `audit_log` for the first time:
 *   · `spv.fee_obligation_waived`  (an administrator forgave money owed)
 *   · `spv.fee_obligation_paid`    (an obligation was settled)
 * An audit row no screen shows is a row nobody can see. R224.1 requires the
 * consuming surface to be PROVED against rendered DOM, not read off the source —
 * wave 137's failure mode was exactly "present in the file, absent from the
 * screen".
 *
 * WHAT IS ASSERTED
 *   1. Both new types appear in the ACTION COLUMN of their own row — POSITION,
 *      by scoped query, not "the string exists somewhere on the page".
 *   2. The actor, the action and the vehicle all render on the row.
 *   3. A MEASURED LIMITATION, found by this file failing on its first run and
 *      reported rather than worked around: this surface does NOT render the
 *      payload at all, so the waive reason and the money figure are durable and
 *      served but not readable on the audit screen. The current behaviour is
 *      PINNED here so the statement of the gap in W306_FOR_THE_OWNER.md cannot
 *      silently go stale.
 *   4. Both are OFFERED in the event-type filter, which the page derives from
 *      live rows, so an admin can isolate them.
 *   5. A CONTROL ROW carrying a type NO WAVE HAS EVER WRITTEN is fed in
 *      alongside and must render IDENTICALLY. This is the assertion that decides
 *      whether the mechanism is "this page renders any string" (open by
 *      construction — good, and what W278b established) or "this page was taught
 *      these words" (an allow-list, in which case W306 owes a client change).
 *
 * NO CLIENT SOURCE FILE IS EDITED FOR PART 1. This file exists to prove that
 * decision was correct rather than convenient.
 *
 * THE SHIM BELOW IS LOAD-BEARING. jsdom has no layout engine, so Radix's
 * <Select> throws on `scrollIntoView` / `hasPointerCapture` the moment an item is
 * chosen; without the shim the page unmounts into an error boundary and every
 * "the row is gone" assertion passes against an EMPTY body — a RED that proves
 * nothing and its green twin. W278b measured this before fixing it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import AdminAuditLog from "../AuditLog";

if (typeof Element.prototype.scrollIntoView !== "function") {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}
if (typeof Element.prototype.hasPointerCapture !== "function") {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
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

/* The row shape `GET /api/admin/audit-log` really returns — the same keys
   `AuditLog.tsx` maps at its `dbAudit.map`. Nothing invented. */
function auditRow(id: string, eventType: string, payload: Record<string, unknown>) {
  const entity = "spv:spv_w306_a";
  return {
    id,
    ts: new Date("2026-09-02T10:00:00Z").toISOString(),
    actor: "u_admin",
    eventType,
    entity,
    priorHash: "0".repeat(64),
    hash: `${id}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    payload,
    actorLabel: "Platform Admin",
    entityLabel: entity,
  };
}

/* The payloads below mirror the shape the two new writers produce: money as a
   STRING, currency verbatim, `auditWaveCompleted: 306`. */
const WAIVED_PAYLOAD = {
  spvId: "spv_w306_a",
  obligationId: "spvfeeob_w306_a",
  state: "waived",
  amountMinor: "7000",
  currency: "USD",
  waivedBy: "u_admin",
  waivedReason: "sponsor credit agreed with the GP in writing",
  auditWaveCompleted: 306,
};
const PAID_PAYLOAD = {
  spvId: "spv_w306_a",
  obligationId: "spvfeeob_w306_b",
  state: "paid",
  amountMinor: "12345",
  currency: "USD",
  paymentRef: "pay_w306_b",
  authorizationSource: "platform_admin",
  auditWaveCompleted: 306,
};

const ROWS = [
  auditRow("al_w306_waived", "spv.fee_obligation_waived", WAIVED_PAYLOAD),
  auditRow("al_w306_paid", "spv.fee_obligation_paid", PAID_PAYLOAD),
  /* THE CONTROL — a type no wave has ever written, or ever will. */
  auditRow("al_w306_ctrl", "spv.w306_control_never_written", {
    spvId: "spv_w306_a",
    amountMinor: "999",
    currency: "USD",
  }),
  /* A pre-existing type, so the row set is not entirely novel. */
  auditRow("al_w306_created", "spv.created", { spvId: "spv_w306_a" }),
];

function mount() {
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.includes("/api/admin/audit-write-health")) {
      return jsonResponse({
        ok: true,
        health: {
          ok: true,
          status: "healthy",
          newestRowAt: new Date().toISOString(),
          newestRowAgeSeconds: 5,
          newestRowAction: "spv.fee_obligation_waived",
          rowsTotal: ROWS.length,
          writesOkSinceBoot: ROWS.length,
          writeFailuresSinceBoot: 0,
          lastWriteOkAt: new Date().toISOString(),
          staleAfterHours: 48,
          readError: null,
        },
      });
    }
    if (url.includes("/api/admin/audit-log/verify")) {
      return jsonResponse({ ok: true, totalLinks: ROWS.length, scope: "all", perTenant: [] });
    }
    return jsonResponse({
      count: ROWS.length,
      total: ROWS.length,
      limit: 50,
      offset: 0,
      items: ROWS,
      order: "desc",
    });
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

/** The ACTION CELL of a given row, by the row's own testid — a SCOPED query.
 *  An unscoped `getByText(...)` would also match the health card's "newest row"
 *  line and would pass against an empty table. */
async function actionCellText(rowId: string): Promise<string> {
  const row = await screen.findByTestId(`row-audit-${rowId}`);
  const cells = within(row).getAllByRole("cell");
  /* Column order in the <tbody> map: time · source · actor · ACTION · target ·
     hash. Index 3 is asserted, not searched for, so a column reorder fails
     loudly instead of quietly passing on a different cell. */
  return (cells[3].textContent ?? "").trim();
}

beforeEach(() => {
  apiRequestMock.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("W306 R224.1 — AuditLog renders the two new money event types", () => {
  it("PRECONDITION — the table really rendered: a pre-existing type is on screen first", async () => {
    mount();
    /* A proof against an empty table proves nothing. Establish the surface works
       before concluding anything about the new types. */
    await waitFor(async () => {
      expect(await actionCellText("al_w306_created")).toBe("spv.created");
    });
  });

  it("both new types appear IN THE ACTION COLUMN of their own rows", async () => {
    mount();
    await waitFor(async () => {
      expect(await actionCellText("al_w306_waived")).toBe("spv.fee_obligation_waived");
    });
    expect(await actionCellText("al_w306_paid")).toBe("spv.fee_obligation_paid");
  });

  it("CONTROL — a type no wave ever wrote renders IDENTICALLY, so there is no allow-list", async () => {
    mount();
    /* If this fails, the mechanism is not "renders any string" and W306 owes a
       client-side change to the audit screen. */
    await waitFor(async () => {
      expect(await actionCellText("al_w306_ctrl")).toBe("spv.w306_control_never_written");
    });
    /* IDENTICALLY means structurally the same, not merely present: the control
       row has the same cell count and the same column occupied as a real row. */
    const control = await screen.findByTestId("row-audit-al_w306_ctrl");
    const real = await screen.findByTestId("row-audit-al_w306_waived");
    expect(within(control).getAllByRole("cell").length).toBe(
      within(real).getAllByRole("cell").length,
    );
  });

  it("the WHO, the WHAT and the WHICH-VEHICLE all render on the row", async () => {
    mount();
    const row = await screen.findByTestId("row-audit-al_w306_waived");
    const text = row.textContent ?? "";
    /* PRECONDITION: the row is not empty, so the assertions below are not
       vacuous. */
    expect(text.length > 0).toBe(true);
    /* The three things an auditor looks for first. Scoped to this row. */
    expect(text).toContain("Platform Admin");
    expect(text).toContain("spv.fee_obligation_waived");
    expect(text).toContain("spv:spv_w306_a");
  });

  it("MEASURED LIMITATION, PINNED NOT ASSUMED — this surface does NOT render the payload", async () => {
    /* Discovered by this test failing on its first run, and reported rather than
       worked around: `AuditLog.tsx` never renders `payload` anywhere (it maps it
       into its row model at `:302` and displays time, source, actor, action,
       target and hash only). So the waive REASON and the money FIGURE are stored,
       chained and served by the API, but are not readable on the admin audit
       screen today.

       W306 was told not to build outside its four parts, and rendering payloads
       is a new admin surface, not part of them. The gap is therefore left open
       and declared in W306_FOR_THE_OWNER.md. This assertion PINS the current
       behaviour so the claim in that document stays true: if a future wave starts
       rendering payloads, this test fails and the document gets corrected.

       The reason IS proved to be durably stored — from SQLite, over HTTP — in
       `server/__tests__/w306_fee_obligation_audit_http.test.ts` §1 and in
       `w306_waive_reason_http.test.ts` §2. */
    mount();
    const row = await screen.findByTestId("row-audit-al_w306_waived");
    const text = row.textContent ?? "";
    /* Absence proved against a LIVE baseline: the row rendered real content. */
    expect(text).toContain("spv.fee_obligation_waived");
    expect(text.length > 20).toBe(true);
    /* And yet none of the payload is on screen. */
    expect(text).not.toContain("7000");
    expect(text).not.toContain("sponsor credit agreed with the GP in writing");
  });

  it("both new types are OFFERED in the event-type filter, derived from live rows", async () => {
    mount();
    await screen.findByTestId("row-audit-al_w306_waived");
    /* A Radix <Select>: its items exist only once the listbox is OPEN, and an
       option list that never mounts is an option an admin can never choose. */
    const trigger = screen.getByTestId("filter-event-type");
    fireEvent.keyDown(trigger, { key: "Enter" });
    const listbox = await screen.findByRole("listbox");
    const optionTexts = within(listbox)
      .getAllByRole("option")
      .map((o) => (o.textContent ?? "").trim());
    expect(optionTexts).toContain("spv.fee_obligation_waived");
    expect(optionTexts).toContain("spv.fee_obligation_paid");
    /* Derived from the rows rather than hardcoded — the control is offered too. */
    expect(optionTexts).toContain("spv.w306_control_never_written");
  });

  /* ── WHAT THIS FILE DOES NOT PROVE ────────────────────────────────────────
     That CHOOSING a filter option narrows the table. W278b established this is
     not honestly assertable in jsdom: Radix commits a selection through a
     pointer-capture sequence jsdom does not synthesise, and the only greens
     available were assertions on component state or a "the other row is gone"
     check that a CRASHED page also satisfies. Narrowing is generic page
     behaviour that predates this wave and W306 did not change it. See
     W306_TESTS.md. */
});
