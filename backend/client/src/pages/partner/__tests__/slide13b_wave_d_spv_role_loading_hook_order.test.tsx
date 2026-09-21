/**
 * slide13b WAVE D — regression: PartnerSpvEngine must survive the real
 * role-gate transition loading → resolved WITHOUT a React hook-order error.
 *
 * Main's compiled whole-page pass at /collective/partner/spv-engine hit the
 * ErrorBoundary with React minified #310 ("Rendered more hooks than during the
 * previous render"). Cause: `useCompanySectorTaxonomy()` (Wave D) was called
 * AFTER the pre-existing early `if (!role.ready || !role.identity) return null;`
 * so the first (loading) render registered N hooks and the resolved render N+k.
 * The bounded chip tests mocked the role as ready from the first render and so
 * could not see it. This test drives the actual transition with the actual
 * component and fails on ANY render error.
 *
 * Positive control: the same fixture, resolved from the first render, mounts.
 */
import { Component, useState, type ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));
vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>("@/components/partner/PartnerShell");
  return { ...actual, PartnerShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

const RESOLVED = {
  ready: true, error: null,
  identity: {
    partnerId: "ac_consortium_partner_slide13b_d", tier: "builder", subRole: "managing_partner",
    identity: { userId: "u_slide13b_d", email: "d@example.com", name: "Wave D Partner" },
  },
};
const LOADING = { ready: false, error: null, identity: null };
let roleState: typeof RESOLVED | typeof LOADING = LOADING;
let setRoleState: ((s: typeof RESOLVED | typeof LOADING) => void) | null = null;

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  // A REAL hook (useState) so the transition happens inside React's own render
  // cycle, exactly like the live auth resolver, not via a test-side rerender.
  useRequirePartnerRole: () => {
    const [s, setS] = useState(roleState);
    setRoleState = setS;
    return s;
  },
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  const json = (status: number, body: unknown) =>
    ({ ok: status < 400, status, statusText: String(status), json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
  return {
    ...actual,
    apiRequest: async (method: string, url: string) =>
      url.includes("/company-taxonomy/")
        ? json(200, { ok: true, namespace: "company_sector", terms: [] })
        : json(200, method === "GET" ? { spvs: [] } : {}),
  };
});

import { queryClient } from "@/lib/queryClient";
import PartnerSpvEngine from "../PartnerSpvEngine";

class Boundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: Error) { return { err: e.message }; }
  render() { return this.state.err ? <div data-testid="boundary-error">{this.state.err}</div> : this.props.children; }
}

afterEach(() => { cleanup(); roleState = LOADING; setRoleState = null; queryClient.clear(); });

const mount = () =>
  render(<QueryClientProvider client={queryClient}><Boundary><PartnerSpvEngine /></Boundary></QueryClientProvider>);

describe("PartnerSpvEngine · role gate loading → resolved keeps hook order stable (React #310 regression)", () => {
  it("first render LOADING (role gate returns null), then RESOLVED inside React — no render error, page mounts", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    roleState = LOADING;
    mount();
    expect(screen.queryByTestId("boundary-error")).toBeNull();
    expect(setRoleState).not.toBeNull();
    await act(async () => { setRoleState!(RESOLVED); });
    const boundary = screen.queryByTestId("boundary-error");
    expect(boundary?.textContent ?? null).toBeNull();
    const hookOrder = errSpy.mock.calls.flat().map(String).filter((m) => /hooks than|Rendered more hooks|Minified React error #310|change in the order of Hooks/i.test(m));
    expect(hookOrder).toEqual([]);
    // The resolved page actually rendered its content.
    expect(document.body.textContent ?? "").not.toBe("");
    errSpy.mockRestore();
  });

  it("control: RESOLVED from the first render mounts (same fixture)", async () => {
    roleState = RESOLVED;
    mount();
    expect(screen.queryByTestId("boundary-error")).toBeNull();
    expect(document.body.textContent ?? "").not.toBe("");
  });
});
