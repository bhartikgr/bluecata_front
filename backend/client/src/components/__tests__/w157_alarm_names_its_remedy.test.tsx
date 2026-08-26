/* ════════════════════════════════════════════════════════════════════════════
   WAVE 157 · R124.3 — AN ALARM THAT DOES NOT NAME ITS REMEDY IS THE DEFECT.
   ════════════════════════════════════════════════════════════════════════════
   The red audit-chain banner said "immediate review required" on every admin
   page and never said WHERE the review happens. The screen that resolves it —
   /admin/audit-chain-verify — has existed all along; it was simply unreachable
   from the alarm.

   THIS IS NAVIGATION ONLY, and the test is written so it cannot be satisfied by
   weakening the alarm:

     POLE A — incident open  → the banner still says what it always said, AND now
                               carries a link whose href is the resolution screen.
                               Asserted on RENDERED DOM (jsdom), not source text.
     POLE B — chain healthy  → the component still renders NOTHING. Adding a link
                               must not make the alarm appear when it should not.
     POLE C — the trigger is untouched: the incident rows are still listed with
                               their key, status and detail.
     POLE D — the destination is real: /admin/audit-chain-verify is routed to the
                               verification page in App.tsx.
     POLE E — the second surface (PlatformSurfaces.tsx) links to the same screen,
                               and its trigger `banner?.incident` is unchanged.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";
import { join } from "path";
import { AuditChainP0Banner } from "../AuditChainP0Banner";

const RESOLUTION_PATH = "/admin/audit-chain-verify";

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

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/* Comments are stripped before any source-text conclusion — a docblock is not
   evidence of behaviour. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}
const ROOT = process.cwd();
const APP = stripComments(readFileSync(join(ROOT, "client/src/App.tsx"), "utf8"));
const SURFACES = stripComments(
  readFileSync(join(ROOT, "client/src/pages/admin/PlatformSurfaces.tsx"), "utf8"),
);

beforeEach(() => apiRequestMock.mockReset());
afterEach(() => cleanup());

describe("W157 — the audit-chain P0 banner points at its own fix", () => {
  it("POLE A: with an incident open, the alarm renders AND links to the repair screen", async () => {
    apiRequestMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        incident: true,
        rows: [{ key: "admin_audit", status: "broken", detail: "link 0 of 1", updatedAt: null }],
      }),
    );
    wrap(<AuditChainP0Banner />);

    await waitFor(() => expect(screen.getByTestId("audit-chain-p0-banner")).toBeTruthy());
    /* The alarm itself is NOT weakened. */
    expect(
      screen.getByText(/Audit chain integrity incident — immediate review required/),
    ).toBeTruthy();

    const link = screen.getByTestId("link-audit-chain-p0-resolve") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(RESOLUTION_PATH);
    /* Plain language (R77): the link names the destination and the action. */
    expect(link.textContent ?? "").toMatch(/Audit chain verification/i);
    expect(link.textContent ?? "").toMatch(/repair/i);
    /* It must not promise to clear the incident — the platform refuses to clear a
       real mismatch, and the banner already says so. */
    expect(link.textContent ?? "").not.toMatch(/dismiss|clear this/i);
  });

  it("POLE B: with a healthy chain the component still renders nothing at all", async () => {
    apiRequestMock.mockResolvedValue(jsonResponse({ ok: true, incident: false, rows: [] }));
    const { container } = wrap(<AuditChainP0Banner />);
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalled());
    expect(screen.queryByTestId("audit-chain-p0-banner")).toBeNull();
    expect(screen.queryByTestId("link-audit-chain-p0-resolve")).toBeNull();
    expect(container.textContent ?? "").toBe("");
  });

  it("POLE C: the incident rows are still listed — the trigger and detail are intact", async () => {
    apiRequestMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        incident: true,
        rows: [
          { key: "admin_audit", status: "broken", detail: "link 0 of 1", updatedAt: null },
          { key: "other_ledger", status: "ok", detail: null, updatedAt: null },
        ],
      }),
    );
    wrap(<AuditChainP0Banner />);
    await waitFor(() => expect(screen.getByTestId("audit-chain-incident-admin_audit")).toBeTruthy());
    expect(screen.getByTestId("audit-chain-incident-admin_audit").textContent).toContain(
      "link 0 of 1",
    );
    /* A healthy row is still filtered out, exactly as before. */
    expect(screen.queryByTestId("audit-chain-incident-other_ledger")).toBeNull();
  });

  it("POLE D: the destination is a real routed screen, not a dead href", () => {
    expect(APP).toContain(`<Route path="${RESOLUTION_PATH}">`);
    const idx = APP.indexOf(`<Route path="${RESOLUTION_PATH}">`);
    expect(APP.slice(idx, idx + 400)).toContain("AuditChainVerifyPage");
  });

  it("POLE E: the second alarm surface links to the same screen, trigger unchanged", () => {
    expect(SURFACES).toContain("Audit chain integrity incident is OPEN.");
    expect(SURFACES).toContain('data-testid="link-audit-incident-resolve"');
    expect(SURFACES).toContain(`href="${RESOLUTION_PATH}"`);
    /* The trigger condition is still the durable incident flag. */
    expect(SURFACES).toContain("{banner?.incident && (");
  });
});
