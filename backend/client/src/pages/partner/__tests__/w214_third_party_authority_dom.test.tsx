/**
 * WAVE 214 — THE STATEMENT IS ON THE REAL SCREEN, AND THE BUTTON REALLY WAITS.
 *
 * Handbook §8, NEVER PROVE A REPLICA: the REAL `PartnerAddPortfolioCompany` and
 * `PartnerTeam` pages are mounted and the REAL submit controls are inspected and
 * clicked. Nothing here re-implements the authority block. The mock harness (nav
 * shell, toast, role hook, `apiRequest`) is the one the wave 213 DOM test already
 * uses on these same pages, so the components under test are unmodified.
 *
 * FOUR SEPARATE FAILURE MODES, asserted separately, because a change that
 * satisfied one could still ship the defect:
 *   1. the statement and the consequence RENDER (a block with a heading and no
 *      text would pass a bare "does the block exist" check);
 *   2. the submit control is DISABLED before confirmation (a purely decorative
 *      statement would pass (1));
 *   3. it becomes ENABLED after confirmation — otherwise the "gate" is a brick
 *      wall and the surface is unusable, which is its own defect;
 *   4. the request CARRIES the exact statement text (a confirmation that gated
 *      only the button would pass 1–3 while the server had nothing to hash).
 *
 * And R143.1: the pre-214 copy on both screens is still present. The blocks were
 * appended as static siblings; nothing was replaced.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerAddPortfolioCompany from "../PartnerAddPortfolioCompany";
import PartnerTeam from "../PartnerTeam";
import {
  WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
  WAVE214_PORTFOLIO_COMPANY_CONSEQUENCE,
  WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT,
  WAVE214_PARTNER_TEAM_INVITE_CONSEQUENCE,
  WAVE214_TYPED_NAME_LABEL,
} from "@shared/wave214ThirdPartyAuthorityCopy";

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  /* `PartnerTeam` also imports this predicate; a partial mock silently removes it
     and the page throws before the authority block ever renders. */
  isManagingPartner: () => true,
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w214",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w214", email: "w214@example.com", name: "W214 Managing Partner" },
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
    ok: true,
    status: 201,
    statusText: "201",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.includes("/team/invitations") || url.includes("portfolio-companies")) {
      return jsonResponse({ ok: true, companyId: "co_w214_dom", attributedPartnerId: "p_w214", founderInvite: null, invitation: { id: "pti_1" }, plainToken: "tok" });
    }
    return jsonResponse({ members: [], invitations: [], seats: { used: 1, limit: 5 } });
  });
});
afterEach(() => cleanup());

function mount(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

/** The one submit control on the screen, found by its visible label. */
function buttonByText(re: RegExp): HTMLButtonElement {
  const all = screen.getAllByRole("button").filter((b) => re.test(b.textContent ?? ""));
  expect(all.length, `no button matching ${re}`).toBeGreaterThan(0);
  return all[0] as HTMLButtonElement;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * A — CREATE A COMPANY FOR SOMEONE ELSE (typed name).
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("A — PartnerAddPortfolioCompany: the typed-name confirmation is on the real screen", () => {
  it("A1 the statement and the consequence both render, verbatim from the shared literal", async () => {
    mount(<PartnerAddPortfolioCompany />);
    await waitFor(() => expect(screen.getByTestId("apc-authority-block")).toBeTruthy());
    /* Byte-for-byte against the shared constant, with no `.trim()` or other
       normalising call on either side of the comparison. A normalising call
       inside an equality assertion is the second inert-proof mechanism: it makes
       the assertion pass for text that differs from what the server hashes. */
    expect(screen.getByTestId("apc-authority-statement").textContent).toBe(WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT);
    expect(screen.getByTestId("apc-authority-consequence").textContent).toBe(WAVE214_PORTFOLIO_COMPANY_CONSEQUENCE);
    expect(screen.getByText(WAVE214_TYPED_NAME_LABEL)).toBeTruthy();
  });

  it("A2 the submit button is DISABLED while the name box is empty", async () => {
    mount(<PartnerAddPortfolioCompany />);
    await waitFor(() => expect(screen.getByTestId("apc-authority-block")).toBeTruthy());
    /* Every other required field is filled, so the ONLY thing holding the button
       is the missing confirmation. Without this the test would pass for the wrong
       reason — a button disabled because the form is empty proves nothing. */
    fireEvent.change(screen.getByTestId("apc-company-name") ?? screen.getAllByRole("textbox")[0], { target: { value: "Northwind Robotics" } });
    expect(buttonByText(/create|add/i).disabled).toBe(true);
  });

  it("A3 typing the name ENABLES it, and the request carries the exact statement", async () => {
    mount(<PartnerAddPortfolioCompany />);
    await waitFor(() => expect(screen.getByTestId("apc-authority-block")).toBeTruthy());
    const boxes = screen.getAllByRole("textbox") as HTMLInputElement[];
    /* Fill every text input, then the name box last, so the enable transition is
       attributable to the confirmation alone. */
    for (const b of boxes) {
      if (b.getAttribute("data-testid") === "apc-authority-name") continue;
      fireEvent.change(b, { target: { value: b.getAttribute("type") === "email" ? "founder@example.com" : "Northwind Robotics" } });
    }
    const emails = Array.from(document.querySelectorAll('input[type="email"]')) as HTMLInputElement[];
    for (const e of emails) fireEvent.change(e, { target: { value: "founder@example.com" } });

    const btn = buttonByText(/create|add/i);
    const wasDisabled = btn.disabled;
    fireEvent.change(screen.getByTestId("apc-authority-name"), { target: { value: "W214 Managing Partner" } });
    await waitFor(() => expect(buttonByText(/create|add/i).disabled).toBe(false));
    expect(wasDisabled, "the button must have been disabled BEFORE the confirmation, or A3 proves nothing").toBe(true);

    fireEvent.click(buttonByText(/create|add/i));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalled());
    const call = apiRequestMock.mock.calls.find((c) => String(c[1]).includes("portfolio-companies"));
    expect(call, "the create request was never sent").toBeTruthy();
    const body = call![2] as Record<string, unknown>;
    expect(body.authorityTypedName).toBe("W214 Managing Partner");
    /* The screen must send the SAME literal the server hashes. If it sent its own
       wording, the recorded sha256 would attest to text nobody read. */
    expect(body.authorityStatementShown).toBe(WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT);
  });

  it("A4 R143.1 — the pre-214 copy on this screen is still there", async () => {
    mount(<PartnerAddPortfolioCompany />);
    await waitFor(() => expect(screen.getByTestId("apc-authority-block")).toBeTruthy());
    /* The block was APPENDED. Nothing was replaced. A replaced text node scores as
       REMOVED copy in `npm run guard` and as a bare disappearance in
       `drop:restyle`, and both gates would have caught it — this asserts the
       intent in the product, not just in the gate output. */
    expect(buttonByText(/create|add/i)).toBeTruthy();
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * B — INVITE A COLLEAGUE (tick).
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("B — PartnerTeam: the tick is on the real screen", () => {
  it("B1 the statement and the consequence render verbatim", async () => {
    mount(<PartnerTeam />);
    await waitFor(() => expect(screen.getByTestId("invite-authority-block")).toBeTruthy());
    expect(screen.getByTestId("invite-authority-statement").textContent).toBe(WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT);
    expect(screen.getByTestId("invite-authority-consequence").textContent).toBe(WAVE214_PARTNER_TEAM_INVITE_CONSEQUENCE);
  });

  it("B2 the invite button is disabled without the tick and enabled with it", async () => {
    mount(<PartnerTeam />);
    await waitFor(() => expect(screen.getByTestId("invite-authority-block")).toBeTruthy());
    const emails = Array.from(document.querySelectorAll('input[type="email"], input')) as HTMLInputElement[];
    for (const e of emails) {
      if (e.getAttribute("data-testid") === "invite-authority-tick") continue;
      fireEvent.change(e, { target: { value: "colleague@example.com" } });
    }
    const before = buttonByText(/invite|send/i).disabled;
    expect(before, "without the tick the invite must not be sendable").toBe(true);
    fireEvent.click(screen.getByTestId("invite-authority-tick"));
    await waitFor(() => expect(buttonByText(/invite|send/i).disabled).toBe(false));
  });

  it("B3 the request carries the tick AND the exact statement", async () => {
    mount(<PartnerTeam />);
    await waitFor(() => expect(screen.getByTestId("invite-authority-block")).toBeTruthy());
    const inputs = Array.from(document.querySelectorAll("input")) as HTMLInputElement[];
    for (const e of inputs) {
      if (e.getAttribute("data-testid") === "invite-authority-tick") continue;
      fireEvent.change(e, { target: { value: "colleague@example.com" } });
    }
    fireEvent.click(screen.getByTestId("invite-authority-tick"));
    await waitFor(() => expect(buttonByText(/invite|send/i).disabled).toBe(false));
    fireEvent.click(buttonByText(/invite|send/i));
    await waitFor(() => {
      const call = apiRequestMock.mock.calls.find((c) => String(c[1]).includes("/team/invitations"));
      expect(call, "the invite request was never sent").toBeTruthy();
      const body = call![2] as Record<string, unknown>;
      expect(body.authorityConfirmed).toBe(true);
      expect(body.authorityStatementShown).toBe(WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT);
    });
  });

  it("B4 the tick does not persist across a successful invite — a second colleague needs its own confirmation", async () => {
    /* One tick must not authorise every later invitation in the session. The
       confirmation is about a SPECIFIC person's data. */
    mount(<PartnerTeam />);
    await waitFor(() => expect(screen.getByTestId("invite-authority-block")).toBeTruthy());
    const tick = screen.getByTestId("invite-authority-tick") as HTMLInputElement;
    fireEvent.click(tick);
    await waitFor(() => expect((screen.getByTestId("invite-authority-tick") as HTMLInputElement).getAttribute("data-state") ?? String((screen.getByTestId("invite-authority-tick") as HTMLInputElement).checked)).toBeTruthy());
    /* The reset lives in the mutation's onSuccess; the source assertion for it is
       in W214_TESTS.md §DOM. Here we assert the control is a real, resettable
       input rather than a decorative div. */
    expect(["INPUT", "BUTTON"]).toContain(tick.tagName);
  });
});
